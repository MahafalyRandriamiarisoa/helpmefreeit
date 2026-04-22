import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'node:os'
import type {
  ScanOptions,
  ScanMessage,
  DupesOptions,
  DupesMessage,
  StaleOptions,
  StaleMessage,
  CleanOptions,
  CleanMessage
} from '../main/types'

export interface FreeitAPI {
  scan: {
    start: (options: ScanOptions) => Promise<void>
    cancel: () => Promise<void>
    onMessage: (callback: (msg: ScanMessage) => void) => () => void
  }
  dupes: {
    start: (options: DupesOptions) => Promise<void>
    cancel: () => Promise<void>
    onMessage: (callback: (msg: DupesMessage) => void) => () => void
  }
  stale: {
    start: (options: StaleOptions) => Promise<void>
    cancel: () => Promise<void>
    onMessage: (callback: (msg: StaleMessage) => void) => () => void
  }
  clean: {
    start: (options: CleanOptions) => Promise<void>
    cancel: () => Promise<void>
    onMessage: (callback: (msg: CleanMessage) => void) => () => void
  }
  fs: {
    showInFinder: (path: string) => Promise<void>
    copyPath: (path: string) => Promise<void>
    openTerminal: (path: string) => Promise<void>
    trashItem: (path: string) => Promise<boolean>
  }
  dialog: {
    openDirectory: () => Promise<string | null>
  }
  env: {
    homedir: string
  }
}

const api: FreeitAPI = {
  scan: {
    start: (options: ScanOptions) => ipcRenderer.invoke('scan:start', options),
    cancel: () => ipcRenderer.invoke('scan:cancel'),
    onMessage: (callback: (msg: ScanMessage) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: ScanMessage): void => {
        callback(msg)
      }
      ipcRenderer.on('scan:message', handler)
      return () => ipcRenderer.removeListener('scan:message', handler)
    }
  },
  dupes: {
    start: (options: DupesOptions) => ipcRenderer.invoke('dupes:start', options),
    cancel: () => ipcRenderer.invoke('dupes:cancel'),
    onMessage: (callback: (msg: DupesMessage) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: DupesMessage): void => {
        callback(msg)
      }
      ipcRenderer.on('dupes:message', handler)
      return () => ipcRenderer.removeListener('dupes:message', handler)
    }
  },
  stale: {
    start: (options: StaleOptions) => ipcRenderer.invoke('stale:start', options),
    cancel: () => ipcRenderer.invoke('stale:cancel'),
    onMessage: (callback: (msg: StaleMessage) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: StaleMessage): void => {
        callback(msg)
      }
      ipcRenderer.on('stale:message', handler)
      return () => ipcRenderer.removeListener('stale:message', handler)
    }
  },
  clean: {
    start: (options: CleanOptions) => ipcRenderer.invoke('clean:start', options),
    cancel: () => ipcRenderer.invoke('clean:cancel'),
    onMessage: (callback: (msg: CleanMessage) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: CleanMessage): void => {
        callback(msg)
      }
      ipcRenderer.on('clean:message', handler)
      return () => ipcRenderer.removeListener('clean:message', handler)
    }
  },
  fs: {
    showInFinder: (path: string) => ipcRenderer.invoke('fs:showInFinder', path),
    copyPath: (path: string) => ipcRenderer.invoke('fs:copyPath', path),
    openTerminal: (path: string) => ipcRenderer.invoke('fs:openTerminal', path),
    trashItem: (path: string) => ipcRenderer.invoke('fs:trashItem', path)
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory')
  },
  env: {
    homedir: homedir()
  }
}

contextBridge.exposeInMainWorld('freeit', api)
