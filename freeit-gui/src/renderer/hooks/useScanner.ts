import { useState, useCallback, useEffect, useRef } from 'react'
import type { EntryNode, ScanOptions, ProgressInfo } from '../lib/types'

interface ScanState {
  scanning: boolean
  progress: ProgressInfo | null
  result: EntryNode | null
  error: string | null
}

interface ScanActions {
  scan: (options: ScanOptions) => void
  cancel: () => void
}

export function useScanner(): ScanState & ScanActions {
  const [state, setState] = useState<ScanState>({
    scanning: false,
    progress: null,
    result: null,
    error: null
  })

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const scan = useCallback((options: ScanOptions) => {
    unsubRef.current?.()

    setState({ scanning: true, progress: null, result: null, error: null })

    const unsub = window.freeit.scan.onMessage((msg) => {
      if (msg.type === 'progress') {
        setState((s) => ({
          ...s,
          progress: { scanned: msg.scanned, total: msg.total, currentPath: msg.currentPath }
        }))
      } else if (msg.type === 'result') {
        setState({ scanning: false, progress: null, result: msg.entry, error: null })
      } else if (msg.type === 'error') {
        setState((s) => ({ ...s, scanning: false, error: msg.message }))
      }
    })

    unsubRef.current = unsub
    window.freeit.scan.start(options)
  }, [])

  const cancel = useCallback(() => {
    window.freeit.scan.cancel()
    unsubRef.current?.()
    unsubRef.current = null
    setState((s) => ({ ...s, scanning: false }))
  }, [])

  return { ...state, scan, cancel }
}
