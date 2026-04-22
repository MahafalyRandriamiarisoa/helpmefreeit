import type { FreeitAPI } from '../../preload/index'

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

export interface ScanOptions {
  path: string
  maxDepth: number
  includeFiles: boolean
  includeHidden: boolean
  noCrossDevice: boolean
  minSize: number
}

export interface ProgressInfo {
  scanned: number
  total: number
  currentPath: string
}

declare global {
  interface Window {
    freeit: FreeitAPI
  }
}
