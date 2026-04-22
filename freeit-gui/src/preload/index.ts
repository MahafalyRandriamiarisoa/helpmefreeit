import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'node:os'
import type { ScanOptions, ScanMessage } from '../main/types'

export interface FreeitAPI {
  scan: {
    start: (options: ScanOptions) => Promise<void>
    cancel: () => Promise<void>
    onMessage: (callback: (msg: ScanMessage) => void) => () => void
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
