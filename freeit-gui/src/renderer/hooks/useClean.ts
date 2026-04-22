import { useState, useCallback, useEffect, useRef } from 'react'
import type { CleanOptions, JunkPresetSummary } from '../../main/types'

interface CleanState {
  scanning: boolean
  currentPreset: string | null
  summaries: JunkPresetSummary[] | null
  error: string | null
}

interface CleanActions {
  scan: (opts?: CleanOptions) => void
  cancel: () => void
  trashAll: (
    paths: string[],
    onEach?: (done: number, total: number) => void
  ) => Promise<number>
}

export function useClean(): CleanState & CleanActions {
  const [state, setState] = useState<CleanState>({
    scanning: false,
    currentPreset: null,
    summaries: null,
    error: null
  })

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const scan = useCallback((opts?: CleanOptions) => {
    unsubRef.current?.()

    setState({
      scanning: true,
      currentPreset: null,
      summaries: null,
      error: null
    })

    const unsub = window.freeit.clean.onMessage((msg) => {
      if (msg.type === 'progress') {
        setState((s) => ({ ...s, currentPreset: msg.preset }))
      } else if (msg.type === 'result') {
        setState({
          scanning: false,
          currentPreset: null,
          summaries: msg.data,
          error: null
        })
      } else if (msg.type === 'error') {
        setState((s) => ({
          ...s,
          scanning: false,
          currentPreset: null,
          error: msg.message
        }))
      }
    })

    unsubRef.current = unsub
    void window.freeit.clean.start(opts ?? {})
  }, [])

  const cancel = useCallback(() => {
    void window.freeit.clean.cancel()
    unsubRef.current?.()
    unsubRef.current = null
    setState((s) => ({ ...s, scanning: false, currentPreset: null }))
  }, [])

  const trashAll = useCallback(
    async (
      paths: string[],
      onEach?: (done: number, total: number) => void
    ): Promise<number> => {
      let success = 0
      const total = paths.length
      for (let i = 0; i < total; i++) {
        const ok = await window.freeit.fs.trashItem(paths[i])
        if (ok) success += 1
        onEach?.(i + 1, total)
      }
      return success
    },
    []
  )

  return { ...state, scan, cancel, trashAll }
}
