import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import {
  spawnFreeitForTest,
  resolveFreeitCommand,
  __resetResolveCacheForTest,
  type SubprocessMessage,
  type SpawnFn
} from './subprocess'

/**
 * Mocks `node:child_process.execFile` (utilisé par `resolveFreeitCommand`).
 * Les tests qui n'ont pas besoin d'une résolution spécifique se rabattent sur
 * un comportement par défaut qui fait croire que `which freeit` renvoie
 * `/usr/local/bin/freeit`.
 */
type ExecFileMock = (
  cmd: string,
  args: ReadonlyArray<string>
) => { stdout: string; stderr: string }

let execFileImpl: ExecFileMock = (cmd, args) => {
  if (cmd === 'which' && args[0] === 'freeit') {
    return { stdout: '/usr/local/bin/freeit\n', stderr: '' }
  }
  // --version sur les chemins candidats / python3 -m helpmefreeit
  if (args.includes('--version')) {
    return { stdout: 'freeit 0.1.0\n', stderr: '' }
  }
  throw Object.assign(new Error('execFile mock default reject'), { code: 1 })
}

vi.mock('node:child_process', () => {
  return {
    execFile: (
      cmd: string,
      args: ReadonlyArray<string>,
      _opts: unknown,
      cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void
    ) => {
      try {
        const res = execFileImpl(cmd, args)
        process.nextTick(() => cb(null, res))
      } catch (err) {
        process.nextTick(() => cb(err as Error))
      }
      return {} as unknown
    },
    // spawn n'est pas utilisé directement par les tests (on injecte spawnFn),
    // mais on l'expose au cas où.
    spawn: vi.fn()
  }
})

/**
 * Crée un faux ChildProcess minimal contrôlable.
 */
interface FakeProc extends EventEmitter {
  stdout: Readable
  stderr: Readable
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  pushStdout: (chunk: string) => void
  pushStderr: (chunk: string) => void
  endStdout: () => void
  endStderr: () => void
  exit: (code: number | null, signal?: NodeJS.Signals | null) => void
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  proc.stdout = stdout
  proc.stderr = stderr
  proc.killed = false
  proc.kill = vi.fn(() => {
    proc.killed = true
    return true
  })
  proc.pushStdout = (chunk: string) => stdout.push(chunk)
  proc.pushStderr = (chunk: string) => stderr.push(chunk)
  proc.endStdout = () => stdout.push(null)
  proc.endStderr = () => stderr.push(null)
  proc.exit = (code, signal = null) => {
    // Attendre un tick pour laisser les chunks atteindre les listeners.
    setImmediate(() => {
      proc.emit('close', code, signal)
    })
  }
  return proc
}

function makeSpawnFn(proc: FakeProc): { spawnFn: SpawnFn; calls: Array<{ cmd: string; args: ReadonlyArray<string> }> } {
  const calls: Array<{ cmd: string; args: ReadonlyArray<string> }> = []
  const spawnFn: SpawnFn = (cmd, args) => {
    calls.push({ cmd, args })
    return proc as unknown as ReturnType<SpawnFn>
  }
  return { spawnFn, calls }
}

beforeEach(() => {
  __resetResolveCacheForTest()
  // Reset à l'impl par défaut (which freeit OK).
  execFileImpl = (cmd, args) => {
    if (cmd === 'which' && args[0] === 'freeit') {
      return { stdout: '/usr/local/bin/freeit\n', stderr: '' }
    }
    if (args.includes('--version')) {
      return { stdout: 'freeit 0.1.0\n', stderr: '' }
    }
    throw Object.assign(new Error('execFile mock default reject'), { code: 1 })
  }
})

describe('spawnFreeit — parsing stdout', () => {
  it('parse les lignes JSON et appelle ctx.onMessage pour chacune', async () => {
    const proc = makeFakeProc()
    const { spawnFn } = makeSpawnFn(proc)
    const messages: SubprocessMessage[] = []

    const promise = spawnFreeitForTest(['scan', '/tmp'], { onMessage: (m) => messages.push(m) }, spawnFn)

    proc.pushStdout('{"type":"progress","scanned":1}\n')
    proc.pushStdout('{"type":"result","entry":{"name":"x"}}\n')
    proc.exit(0)

    await promise

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ type: 'progress', scanned: 1 })
    expect(messages[1]).toEqual({ type: 'result', entry: { name: 'x' } })
  })

  it("recompose une ligne JSON splittée en deux chunks", async () => {
    const proc = makeFakeProc()
    const { spawnFn } = makeSpawnFn(proc)
    const messages: SubprocessMessage[] = []

    const promise = spawnFreeitForTest(['scan'], { onMessage: (m) => messages.push(m) }, spawnFn)

    proc.pushStdout('{"type":"progr')
    proc.pushStdout('ess","scanned":42}\n')
    proc.exit(0)

    await promise

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({ type: 'progress', scanned: 42 })
  })

  it("remonte les lignes non-JSON comme {type:'log', raw}", async () => {
    const proc = makeFakeProc()
    const { spawnFn } = makeSpawnFn(proc)
    const messages: SubprocessMessage[] = []

    const promise = spawnFreeitForTest(['scan'], { onMessage: (m) => messages.push(m) }, spawnFn)

    proc.pushStdout('coucou pas du tout du JSON\n')
    proc.pushStdout('{"type":"progress","scanned":3}\n')
    proc.exit(0)

    await promise

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ type: 'log', raw: 'coucou pas du tout du JSON' })
    expect(messages[1]).toEqual({ type: 'progress', scanned: 3 })
  })
})

describe('spawnFreeit — gestion de la fin de process', () => {
  it('exit code 0 → la promesse résout', async () => {
    const proc = makeFakeProc()
    const { spawnFn, calls } = makeSpawnFn(proc)

    const promise = spawnFreeitForTest(['scan', '/tmp'], { onMessage: () => {} }, spawnFn)
    proc.exit(0)

    await expect(promise).resolves.toBeUndefined()
    // --json doit être ajouté automatiquement
    expect(calls[0].args).toContain('--json')
  })

  it('exit non-zéro → reject avec stderr inclus dans le message', async () => {
    const proc = makeFakeProc()
    const { spawnFn } = makeSpawnFn(proc)

    const promise = spawnFreeitForTest(['scan'], { onMessage: () => {} }, spawnFn)
    proc.pushStderr('Traceback: boom\n')
    proc.exit(2)

    await expect(promise).rejects.toThrow(/code 2/)
    await expect(promise).rejects.toThrow(/Traceback: boom/)
  })
})

describe('spawnFreeit — AbortSignal', () => {
  it('AbortSignal déclenche kill SIGTERM', async () => {
    vi.useFakeTimers()
    try {
      const proc = makeFakeProc()
      const { spawnFn } = makeSpawnFn(proc)
      const controller = new AbortController()

      const promise = spawnFreeitForTest(
        ['scan'],
        { onMessage: () => {}, signal: controller.signal },
        spawnFn
      )
      // Attache un handler immédiat pour éviter l'unhandled rejection si la
      // promesse se rejette avant que le `await expect(...).rejects` ne soit
      // installé (les timers fake déclenchent tout de façon synchrone).
      const captured = promise.catch((e: unknown) => e)

      // Laisse spawnFreeit s'installer (résolution + setup listeners).
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()

      controller.abort()
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM')

      // Avant les 2s, pas de SIGKILL
      vi.advanceTimersByTime(1000)
      expect(proc.kill).toHaveBeenCalledTimes(1)

      // Après les 2s, SIGKILL est appelé
      vi.advanceTimersByTime(1500)
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL')

      // Le process se termine — on attend le rejet
      proc.exit(null, 'SIGKILL')
      await vi.runAllTimersAsync()

      const err = await captured
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/interrompu/)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('resolveFreeitCommand', () => {
  it('résout via `which freeit` quand le binaire est dans le PATH', async () => {
    execFileImpl = (cmd, args) => {
      if (cmd === 'which' && args[0] === 'freeit') {
        return { stdout: '/usr/local/bin/freeit\n', stderr: '' }
      }
      throw new Error('not expected')
    }

    const resolved = await resolveFreeitCommand()
    expect(resolved).toEqual({ cmd: '/usr/local/bin/freeit', baseArgs: [] })
  })

  it('fallback python3 -m helpmefreeit si rien d\'autre ne marche', async () => {
    execFileImpl = (cmd, args) => {
      if (cmd === 'which' && args[0] === 'freeit') {
        throw Object.assign(new Error('not found'), { code: 1 })
      }
      // ~/.local/bin/freeit --version → KO
      // /opt/homebrew/bin/freeit --version → KO
      if (cmd.endsWith('/freeit') && args[0] === '--version') {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      // python3 -m helpmefreeit --version → OK
      if (cmd === 'python3' && args[0] === '-m' && args[1] === 'helpmefreeit') {
        return { stdout: 'freeit 0.1.0\n', stderr: '' }
      }
      throw Object.assign(new Error('unexpected'), { code: 1 })
    }

    const resolved = await resolveFreeitCommand()
    expect(resolved.cmd).toBe('python3')
    expect(resolved.baseArgs).toEqual(['-m', 'helpmefreeit'])
  })
})
