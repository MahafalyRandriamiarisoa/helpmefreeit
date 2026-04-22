import { useState, useCallback, useEffect, useRef } from 'react'
import type { StaleFile, StaleOptions } from '../../main/types'

interface StaleState {
  scanning: boolean
  progress: { scanned: number } | null
  files: StaleFile[] | null
  error: string | null
}

interface StaleActions {
  scan: (options: StaleOptions) => void
  cancel: () => void
  removeFile: (path: string) => void
}

export function useStale(): StaleState & StaleActions {
  const [state, setState] = useState<StaleState>({
    scanning: false,
    progress: null,
    files: null,
    error: null
  })

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const scan = useCallback((options: StaleOptions) => {
    unsubRef.current?.()

    setState({ scanning: true, progress: null, files: null, error: null })

    const unsub = window.freeit.stale.onMessage((msg) => {
      if (msg.type === 'progress') {
        setState((s) => ({ ...s, progress: { scanned: msg.scanned } }))
      } else if (msg.type === 'result') {
        setState({ scanning: false, progress: null, files: msg.data, error: null })
      } else if (msg.type === 'error') {
        setState((s) => ({ ...s, scanning: false, error: msg.message }))
      }
    })

    unsubRef.current = unsub
    window.freeit.stale.start(options)
  }, [])

  const cancel = useCallback(() => {
    window.freeit.stale.cancel()
    unsubRef.current?.()
    unsubRef.current = null
    setState((s) => ({ ...s, scanning: false }))
  }, [])

  const removeFile = useCallback((path: string) => {
    setState((s) => {
      if (!s.files) return s
      return { ...s, files: s.files.filter((f) => f.path !== path) }
    })
  }, [])

  return { ...state, scan, cancel, removeFile }
}
