import { ipcMain, shell, clipboard, dialog, BrowserWindow } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import type {
  ScanOptions,
  ScanMessage,
  DupesOptions,
  DupesMessage,
  StaleOptions,
  StaleMessage,
  CleanOptions,
  CleanMessage
} from './types'
import { spawnFreeit, type SubprocessMessage } from './subprocess'

let activeWorker: Worker | null = null
let activeDupesAbort: AbortController | null = null
let activeStaleAbort: AbortController | null = null
let activeCleanAbort: AbortController | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle('scan:start', (_event, options: ScanOptions) => {
    // Kill previous worker if any
    if (activeWorker) {
      activeWorker.postMessage({ action: 'cancel' })
      activeWorker.terminate()
      activeWorker = null
    }

    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return

    const workerPath = join(__dirname, 'scanner-worker.js')
    activeWorker = new Worker(workerPath)

    activeWorker.on('message', (msg: ScanMessage) => {
      if (win.isDestroyed()) return
      win.webContents.send('scan:message', msg)
    })

    activeWorker.on('error', (err) => {
      if (!win.isDestroyed()) {
        win.webContents.send('scan:message', {
          type: 'error',
          message: err.message
        } satisfies ScanMessage)
      }
    })

    activeWorker.on('exit', () => {
      activeWorker = null
    })

    activeWorker.postMessage({ action: 'scan', options })
  })

  ipcMain.handle('scan:cancel', () => {
    if (activeWorker) {
      activeWorker.postMessage({ action: 'cancel' })
      activeWorker.terminate()
      activeWorker = null
    }
  })

  // ---------------------------------------------------------------------------
  // dupes — délégué au CLI Python via sous-process
  // ---------------------------------------------------------------------------
  ipcMain.handle('dupes:start', (_event, options: DupesOptions) => {
    if (activeDupesAbort) {
      activeDupesAbort.abort()
      activeDupesAbort = null
    }

    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return

    const args: string[] = ['dupes', options.path]
    if (options.minSize !== undefined) {
      args.push('--min-size', String(options.minSize))
    }
    if (options.followSymlinks) {
      args.push('--follow-symlinks')
    }
    if (options.noCache) {
      args.push('--no-cache')
    }

    const abort = new AbortController()
    activeDupesAbort = abort

    const send = (msg: DupesMessage): void => {
      if (!win.isDestroyed()) {
        win.webContents.send('dupes:message', msg)
      }
    }

    spawnFreeit(args, {
      signal: abort.signal,
      onMessage: (raw: SubprocessMessage) => {
        send(raw as unknown as DupesMessage)
      }
    })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'error', message })
      })
      .finally(() => {
        if (activeDupesAbort === abort) {
          activeDupesAbort = null
        }
      })
  })

  ipcMain.handle('dupes:cancel', () => {
    if (activeDupesAbort) {
      activeDupesAbort.abort()
      activeDupesAbort = null
    }
  })

  // ---------------------------------------------------------------------------
  // stale — délégué au CLI Python via sous-process
  // ---------------------------------------------------------------------------
  ipcMain.handle('stale:start', (_event, options: StaleOptions) => {
    if (activeStaleAbort) {
      activeStaleAbort.abort()
      activeStaleAbort = null
    }

    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return

    const args: string[] = ['stale', options.path]
    if (options.minAgeDays !== undefined) {
      args.push('--min-age', String(options.minAgeDays))
    }
    if (options.minSize !== undefined) {
      args.push('--min-size', String(options.minSize))
    }
    if (options.followSymlinks) {
      args.push('--follow-symlinks')
    }

    const abort = new AbortController()
    activeStaleAbort = abort

    const send = (msg: StaleMessage): void => {
      if (!win.isDestroyed()) {
        win.webContents.send('stale:message', msg)
      }
    }

    spawnFreeit(args, {
      signal: abort.signal,
      onMessage: (raw: SubprocessMessage) => {
        send(raw as unknown as StaleMessage)
      }
    })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'error', message })
      })
      .finally(() => {
        if (activeStaleAbort === abort) {
          activeStaleAbort = null
        }
      })
  })

  ipcMain.handle('stale:cancel', () => {
    if (activeStaleAbort) {
      activeStaleAbort.abort()
      activeStaleAbort = null
    }
  })

  // ---------------------------------------------------------------------------
  // clean — délégué au CLI Python via sous-process
  // ---------------------------------------------------------------------------
  ipcMain.handle('clean:start', (_event, options: CleanOptions) => {
    if (activeCleanAbort) {
      activeCleanAbort.abort()
      activeCleanAbort = null
    }

    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return

    const args: string[] = ['clean']
    if (options?.presetId !== undefined) {
      args.push('--preset', options.presetId)
    }

    const abort = new AbortController()
    activeCleanAbort = abort

    const send = (msg: CleanMessage): void => {
      if (!win.isDestroyed()) {
        win.webContents.send('clean:message', msg)
      }
    }

    spawnFreeit(args, {
      signal: abort.signal,
      onMessage: (raw: SubprocessMessage) => {
        send(raw as unknown as CleanMessage)
      }
    })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'error', message })
      })
      .finally(() => {
        if (activeCleanAbort === abort) {
          activeCleanAbort = null
        }
      })
  })

  ipcMain.handle('clean:cancel', () => {
    if (activeCleanAbort) {
      activeCleanAbort.abort()
      activeCleanAbort = null
    }
  })

  ipcMain.handle('fs:showInFinder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('fs:copyPath', (_event, filePath: string) => {
    clipboard.writeText(filePath)
  })

  ipcMain.handle('fs:openTerminal', (_event, dirPath: string) => {
    exec(`open -a Terminal "${dirPath}"`)
  })

  ipcMain.handle('fs:trashItem', async (_event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return false

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Annuler', 'Mettre à la corbeille'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmer la suppression',
      message: `Mettre à la corbeille ?\n${filePath}`
    })

    if (response === 1) {
      await shell.trashItem(filePath)
      return true
    }
    return false
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })

    return canceled ? null : filePaths[0] ?? null
  })
}
