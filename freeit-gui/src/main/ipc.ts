import { ipcMain, shell, clipboard, dialog, BrowserWindow } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import type { ScanOptions, ScanMessage } from './types'

let activeWorker: Worker | null = null

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
