/**
 * Core scan logic — extracted from scanner-worker for testability.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { EntryNode, ScanMessage, ScanOptions } from './types'

const execFileAsync = promisify(execFile)

interface PendingItem {
  name: string
  fullPath: string
  isDir: boolean
  knownSize: number | null
  hidden: boolean
}

export interface ScanContext {
  cancelled: () => boolean
  signal?: AbortSignal
  onMessage: (msg: ScanMessage) => void
}

type ExecFileFn = (cmd: string, args: string[], opts: object) => Promise<{ stdout: string }>

function parseDuOutput(stdout: string): number {
  const lastLine = stdout.trim().split('\n').pop() ?? ''
  const match = lastLine.match(/^(\d+)/)
  return match ? parseInt(match[1]) * 1024 : 0
}

async function getDuSizeImpl(
  targetPath: string,
  noCrossDevice: boolean,
  signal: AbortSignal | undefined,
  exec: ExecFileFn
): Promise<number> {
  const baseArgs = ['-skH']
  if (noCrossDevice) baseArgs.push('-x')
  baseArgs.push(targetPath)

  async function runDu(flags: string[]): Promise<number | null> {
    try {
      const { stdout } = await exec('du', flags, { timeout: 120_000, signal })
      return parseDuOutput(stdout)
    } catch (err: any) {
      // du exit non-zero mais a quand même produit une sortie (permission denied classiques)
      if (err?.stdout) {
        const size = parseDuOutput(err.stdout)
        if (size > 0) return size
      }
      return null // échec complet (stdout vide → cycle symlink, etc.)
    }
  }

  // Tentative 1 : scan complet
  const size = await runDu(baseArgs)
  if (size !== null) return size

  // Tentative 2 : fallback avec -x pour éviter les cycles cross-device (OrbStack, etc.)
  if (!noCrossDevice) {
    const fallbackSize = await runDu(['-skHx', targetPath])
    if (fallbackSize !== null) return fallbackSize
  }

  return 0
}

async function getDuSize(targetPath: string, noCrossDevice: boolean, signal?: AbortSignal): Promise<number> {
  return getDuSizeImpl(targetPath, noCrossDevice, signal, execFileAsync as unknown as ExecFileFn)
}

/** Export for unit tests only */
export function getDuSizeForTest(
  targetPath: string,
  noCrossDevice: boolean,
  signal: AbortSignal | undefined,
  exec: ExecFileFn
): Promise<number> {
  return getDuSizeImpl(targetPath, noCrossDevice, signal, exec)
}

export async function runScan(opts: ScanOptions, ctx: ScanContext): Promise<EntryNode | null> {
  const resolvedPath = path.resolve(opts.path)
  ctx.onMessage({ type: 'progress', scanned: 0, total: 0, currentPath: resolvedPath })

  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(resolvedPath, { withFileTypes: true })
  } catch (e) {
    ctx.onMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    return null
  }

  const allItems: PendingItem[] = []

  for (const d of dirents) {
    if (ctx.cancelled()) return null
    const fullPath = path.join(resolvedPath, d.name)
    const isHidden = d.name.startsWith('.')

    let isDir: boolean
    let isLink: boolean
    try {
      const st = fs.lstatSync(fullPath)
      isDir = st.isDirectory()
      isLink = st.isSymbolicLink()

      if (isLink) {
        try {
          const targetSt = fs.statSync(fullPath) // follows symlink
          if (targetSt.isDirectory()) {
            allItems.push({ name: d.name, fullPath, isDir: true, knownSize: null, hidden: isHidden })
          } else {
            allItems.push({ name: d.name, fullPath, isDir: false, knownSize: targetSt.size, hidden: isHidden })
          }
        } catch {
          // Broken symlink — fall back to lstat size
          allItems.push({ name: d.name, fullPath, isDir: false, knownSize: st.size, hidden: isHidden })
        }
        continue
      }

      if (isDir) {
        allItems.push({ name: d.name, fullPath, isDir: true, knownSize: null, hidden: isHidden })
      } else {
        allItems.push({ name: d.name, fullPath, isDir: false, knownSize: st.size, hidden: isHidden })
      }
    } catch {
      continue
    }
  }

  // Count items that need du (directories)
  const dirsNeedingDu = allItems.filter((i) => i.knownSize === null)
  const totalSteps = dirsNeedingDu.length
  let completed = 0

  ctx.onMessage({ type: 'progress', scanned: 0, total: totalSteps, currentPath: resolvedPath })

  // Resolve all known-size items instantly
  const resolvedItems: Array<PendingItem & { size: number }> = []
  for (const item of allItems) {
    if (item.knownSize !== null) {
      resolvedItems.push({ ...item, size: item.knownSize })
    }
  }

  // Compute directory sizes with parallel du (8 concurrent)
  const PARALLEL = 8
  for (let i = 0; i < dirsNeedingDu.length; i += PARALLEL) {
    if (ctx.cancelled()) return null

    const batch = dirsNeedingDu.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (item) => {
        const size = await getDuSize(item.fullPath, opts.noCrossDevice, ctx.signal)
        return { ...item, size }
      })
    )

    for (const r of results) {
      if (ctx.cancelled()) return null
      resolvedItems.push(r)
      completed++
      ctx.onMessage({ type: 'progress', scanned: completed, total: totalSteps, currentPath: r.name })
    }
  }

  if (ctx.cancelled()) return null

  // Build children list (visible items only) and compute parent total (all items)
  const children: EntryNode[] = []
  let parentSize = 0

  for (const item of resolvedItems) {
    parentSize += item.size

    const showInUI = item.hidden ? opts.includeHidden : true
    const showFiles = item.isDir || opts.includeFiles
    if (showInUI && showFiles) {
      children.push({
        path: item.fullPath,
        name: item.name,
        size: item.size,
        isDir: item.isDir,
        children: [],
        fileCount: 0,
        dirCount: 0
      })
    }
  }

  const entry: EntryNode = {
    path: resolvedPath,
    name: path.basename(resolvedPath) || resolvedPath,
    size: parentSize,
    isDir: true,
    children,
    fileCount: children.filter((c) => !c.isDir).length,
    dirCount: children.filter((c) => c.isDir).length
  }

  if (opts.minSize > 0) {
    entry.children = entry.children.filter((c) => c.size >= opts.minSize)
  }

  ctx.onMessage({ type: 'result', entry })
  return entry
}
