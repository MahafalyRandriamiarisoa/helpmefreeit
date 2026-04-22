/**
 * Scanner worker — thin wrapper around scanner.ts for worker_threads.
 */
import { parentPort } from 'node:worker_threads'
import { runScan } from './scanner'
import type { ScanMessage, WorkerRequest } from './types'

let cancelled = false
let abortController: AbortController | null = null

parentPort?.on('message', (msg: WorkerRequest | { action: 'cancel' }) => {
  if (msg.action === 'cancel') {
    cancelled = true
    abortController?.abort()
    return
  }
  if (msg.action === 'scan') {
    cancelled = false
    abortController = new AbortController()

    runScan(msg.options, {
      cancelled: () => cancelled,
      signal: abortController.signal,
      onMessage: (m: ScanMessage) => parentPort?.postMessage(m)
    })
  }
})
