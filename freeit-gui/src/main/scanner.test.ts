import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runScan, getDuSizeForTest } from './scanner'
import type { ScanMessage, ScanOptions } from './types'

function makeScanContext() {
  const messages: ScanMessage[] = []
  return {
    ctx: {
      cancelled: () => false,
      onMessage: (m: ScanMessage) => messages.push(m),
    },
    messages,
  }
}

const defaultOpts: Omit<ScanOptions, 'path'> = {
  maxDepth: 1,
  includeFiles: true,
  includeHidden: false,
  noCrossDevice: false,
  minSize: 0,
}

describe('getDuSize', () => {
  it('Test A — bug: du échoue avec stdout vide (cycle symlink) → fallback -x', async () => {
    // Simule le comportement de /Users avec OrbStack : du sans -x échoue stdout vide,
    // du avec -x réussit et retourne une taille
    let callCount = 0
    const mockExecFile = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      callCount++
      if (args.some((a: string) => a.includes('x'))) {
        // Fallback avec -x réussit
        return Promise.resolve({ stdout: '307200\t/Users\n' })
      }
      // Premier appel sans -x : échec avec stdout vide (cycle symlink)
      return Promise.reject(Object.assign(new Error('symlink cycle detected'), { code: 1, stdout: '', stderr: 'du: /Users/ubuntu:20.04/boot: Too many levels of symbolic links' }))
    })

    const size = await getDuSizeForTest('/Users', false, undefined, mockExecFile)
    expect(size).toBe(307200 * 1024)
  })

  it('Test B — du échoue avec stdout non-vide (permission denied classiques)', async () => {
    // du exit code 1 mais stdout contient quand même la taille
    const mockExecFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('permission denied'), {
        code: 1,
        stdout: '307200\t/path\n',
        stderr: 'du: /path/secret: Permission denied\n'
      })
    )

    const size = await getDuSizeForTest('/path', false, undefined, mockExecFile)
    expect(size).toBe(307200 * 1024)
  })

  it('Test C — cas nominal: du réussit', async () => {
    const mockExecFile = vi.fn().mockResolvedValue({ stdout: '307200\t/path\n' })

    const size = await getDuSizeForTest('/path', false, undefined, mockExecFile)
    expect(size).toBe(307200 * 1024)
  })
})

describe('scanner', () => {
  let tmpDir: string

  beforeAll(() => {
    // Crée une structure de test :
    //   tmpDir/
    //     real-dir/
    //       file.txt   (1024 bytes)
    //     link-to-dir  -> real-dir/  (symlink)
    //     regular.txt  (512 bytes)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeit-test-'))

    const realDir = path.join(tmpDir, 'real-dir')
    fs.mkdirSync(realDir)
    fs.writeFileSync(path.join(realDir, 'file.txt'), 'x'.repeat(1024))

    fs.symlinkSync(realDir, path.join(tmpDir, 'link-to-dir'))

    fs.writeFileSync(path.join(tmpDir, 'regular.txt'), 'y'.repeat(512))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('symlink vers un dossier doit avoir une taille > 0 et isDir: true', async () => {
    const { ctx } = makeScanContext()
    const result = await runScan({ ...defaultOpts, path: tmpDir }, ctx)

    expect(result).not.toBeNull()
    const linkEntry = result!.children.find((c) => c.name === 'link-to-dir')

    expect(linkEntry).toBeDefined()
    // Le bug actuel : le symlink est traité comme un fichier avec knownSize = taille du lien (~quelques octets)
    // Le comportement attendu : isDir: true et size > 0 (calculé via du)
    expect(linkEntry!.isDir).toBe(true)
    expect(linkEntry!.size).toBeGreaterThan(0)
  })

  it('dossier réel doit toujours fonctionner', async () => {
    const { ctx } = makeScanContext()
    const result = await runScan({ ...defaultOpts, path: tmpDir }, ctx)

    expect(result).not.toBeNull()
    const realDir = result!.children.find((c) => c.name === 'real-dir')

    expect(realDir).toBeDefined()
    expect(realDir!.isDir).toBe(true)
    expect(realDir!.size).toBeGreaterThan(0)
  })

  it('fichier régulier doit rester un fichier', async () => {
    const { ctx } = makeScanContext()
    const result = await runScan({ ...defaultOpts, path: tmpDir }, ctx)

    expect(result).not.toBeNull()
    const regular = result!.children.find((c) => c.name === 'regular.txt')

    expect(regular).toBeDefined()
    expect(regular!.isDir).toBe(false)
    expect(regular!.size).toBe(512)
  })
})
