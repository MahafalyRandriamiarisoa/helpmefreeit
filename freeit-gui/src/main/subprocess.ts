/**
 * Wrapper subprocess pour le CLI Python `freeit`.
 *
 * Spawn le binaire avec --json et parse stdout ligne par ligne comme JSON,
 * en streaming via ctx.onMessage. Gère AbortSignal (SIGTERM puis SIGKILL
 * après 2s), résolution du binaire (which / chemins connus / fallback
 * python3 -m helpmefreeit) avec cache module-level.
 */
import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(nodeExecFile)

export interface SubprocessMessage {
  type: 'progress' | 'result' | 'error' | 'log'
  [key: string]: unknown
}

export interface SubprocessContext {
  onMessage: (msg: SubprocessMessage) => void
  signal?: AbortSignal
}

export interface ResolvedFreeit {
  cmd: string
  baseArgs: string[]
}

/** Signature compatible `child_process.spawn` (subset utilisé). */
export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptions
) => ChildProcess

/** Délai entre SIGTERM et SIGKILL si le process ne se termine pas. */
const KILL_GRACE_MS = 2000

let resolvedCache: Promise<ResolvedFreeit> | null = null

/**
 * Reset du cache module-level. Réservé aux tests.
 */
export function __resetResolveCacheForTest(): void {
  resolvedCache = null
}

async function canExecute(path: string): Promise<boolean> {
  try {
    // -V est court et supporté par Click ; suffit pour valider l'exécutable.
    await execFileAsync(path, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function whichFreeit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', ['freeit'], { timeout: 5000 })
    const first = stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
    return first ?? null
  } catch {
    return null
  }
}

async function resolveFreeitImpl(): Promise<ResolvedFreeit> {
  // 1. which freeit
  const whichPath = await whichFreeit()
  if (whichPath) {
    return { cmd: whichPath, baseArgs: [] }
  }

  // 2. Chemins connus
  const candidates = [join(homedir(), '.local', 'bin', 'freeit'), '/opt/homebrew/bin/freeit']
  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return { cmd: candidate, baseArgs: [] }
    }
  }

  // 3. Fallback : python3 -m helpmefreeit
  try {
    await execFileAsync('python3', ['-m', 'helpmefreeit', '--version'], { timeout: 5000 })
    return { cmd: 'python3', baseArgs: ['-m', 'helpmefreeit'] }
  } catch {
    // continue
  }

  throw new Error(
    "Impossible de localiser le binaire freeit (ni dans PATH, ni dans ~/.local/bin, " +
      "ni dans /opt/homebrew/bin, ni via python3 -m helpmefreeit)."
  )
}

/**
 * Localise le binaire `freeit` à utiliser, avec cache module-level.
 * - which freeit
 * - ~/.local/bin/freeit
 * - /opt/homebrew/bin/freeit
 * - fallback : python3 -m helpmefreeit
 */
export async function resolveFreeitCommand(): Promise<ResolvedFreeit> {
  if (!resolvedCache) {
    resolvedCache = resolveFreeitImpl().catch((err) => {
      // Évite de cacher un échec — la prochaine tentative ré-essayera.
      resolvedCache = null
      throw err
    })
  }
  return resolvedCache
}

/**
 * Lance freeit avec les `args` fournis (--json injecté si absent), parse
 * stdout en JSON ligne par ligne et appelle ctx.onMessage. Les lignes non
 * JSON sont remontées comme {type: 'log', raw}. stderr est accumulé et
 * inclus dans le message d'erreur en cas d'exit != 0.
 */
export async function spawnFreeit(args: string[], ctx: SubprocessContext): Promise<void> {
  return spawnFreeitForTest(args, ctx, nodeSpawn as SpawnFn)
}

/**
 * Variante testable de spawnFreeit avec spawn injectable.
 */
export async function spawnFreeitForTest(
  args: string[],
  ctx: SubprocessContext,
  spawnFn: SpawnFn
): Promise<void> {
  const resolved = await resolveFreeitCommand()

  // Injecte --json si absent.
  const hasJson = args.includes('--json')
  const finalArgs = [...resolved.baseArgs, ...args, ...(hasJson ? [] : ['--json'])]

  return new Promise<void>((resolve, reject) => {
    let proc: ChildProcess
    try {
      proc = spawnFn(resolved.cmd, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let killTimer: NodeJS.Timeout | null = null
    let aborted = false
    let settled = false

    const onAbort = (): void => {
      aborted = true
      try {
        proc.kill('SIGTERM')
      } catch {
        // process déjà mort
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, KILL_GRACE_MS)
    }

    if (ctx.signal) {
      if (ctx.signal.aborted) {
        onAbort()
      } else {
        ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      if (ctx.signal) {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    }

    const flushLine = (line: string): void => {
      if (line.length === 0) return
      try {
        const parsed = JSON.parse(line) as unknown
        if (parsed && typeof parsed === 'object' && 'type' in (parsed as object)) {
          ctx.onMessage(parsed as SubprocessMessage)
        } else {
          ctx.onMessage({ type: 'log', raw: line })
        }
      } catch {
        ctx.onMessage({ type: 'log', raw: line })
      }
    }

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        let idx: number
        // Séparation ligne par ligne, les lignes incomplètes restent dans le buffer.
        while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
          const rawLine = stdoutBuffer.slice(0, idx)
          stdoutBuffer = stdoutBuffer.slice(idx + 1)
          // Trim CR éventuels (Windows / lignes mixtes)
          flushLine(rawLine.replace(/\r$/, ''))
        }
      })
    }

    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk
      })
    }

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    })

    proc.on('close', (code, signal) => {
      if (settled) return
      settled = true
      // Flush du dernier morceau si pas de \n final.
      if (stdoutBuffer.length > 0) {
        flushLine(stdoutBuffer.replace(/\r$/, ''))
        stdoutBuffer = ''
      }
      cleanup()

      if (aborted) {
        const err = new Error('freeit interrompu (AbortSignal)')
        ;(err as Error & { aborted?: boolean }).aborted = true
        reject(err)
        return
      }

      if (code === 0) {
        resolve()
        return
      }

      const reason =
        signal != null
          ? `signal ${signal}`
          : code != null
            ? `code ${code}`
            : 'inconnu'
      const stderrSnippet = stderrBuffer.trim()
      const detail = stderrSnippet.length > 0 ? `\n${stderrSnippet}` : ''
      reject(new Error(`freeit s'est terminé en erreur (${reason})${detail}`))
    })
  })
}
