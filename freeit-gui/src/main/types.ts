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
