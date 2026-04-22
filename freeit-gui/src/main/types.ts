export interface ScanOptions {
  path: string
  maxDepth: number
  includeFiles: boolean
  includeHidden: boolean
  noCrossDevice: boolean
  minSize: number
}

export interface EntryNode {
  path: string
  name: string
  size: number
  isDir: boolean
  children: EntryNode[]
  error?: string
  fileCount: number
  dirCount: number
}

export type ScanMessage =
  | { type: 'progress'; scanned: number; total: number; currentPath: string }
  | { type: 'result'; entry: EntryNode }
  | { type: 'error'; message: string }

export type WorkerRequest = { action: 'scan'; options: ScanOptions }

// -----------------------------------------------------------------------------
// Features déléguées au CLI Python via sous-process (dupes / stale / clean)
// -----------------------------------------------------------------------------

export interface DupeGroup {
  size: number
  full_hash: string // hex
  paths: string[]
  recoverable_bytes: number
}

export interface StaleFile {
  path: string
  size: number
  atime: number
  mtime: number
  age_days: number
}

export interface JunkPresetSummary {
  id: string
  label: string
  description: string
  safe: boolean
  min_age_days: number | null
  count: number
  total_bytes: number
  paths: string[]
}

export interface DupesOptions {
  path: string
  minSize?: number
  followSymlinks?: boolean
  noCache?: boolean
}

export interface StaleOptions {
  path: string
  minAgeDays?: number
  minSize?: number
  followSymlinks?: boolean
}

export interface CleanOptions {
  presetId?: string
}

export type DupesMessage =
  | { type: 'progress'; step: 'scan' | 'partial' | 'full'; processed: number; total: number }
  | { type: 'result'; data: DupeGroup[] }
  | { type: 'error'; message: string }

export type StaleMessage =
  | { type: 'progress'; scanned: number }
  | { type: 'result'; data: StaleFile[] }
  | { type: 'error'; message: string }

export type CleanMessage =
  | { type: 'progress'; preset: string; message?: string }
  | { type: 'result'; data: JunkPresetSummary[] }
  | { type: 'error'; message: string }
