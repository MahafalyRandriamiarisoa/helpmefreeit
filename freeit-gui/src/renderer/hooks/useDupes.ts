import { useState, useCallback, useEffect, useRef } from 'react'
import type { DupeGroup, DupesMessage, DupesOptions } from '../../main/types'

interface DupesProgress {
  step: string
  processed: number
  total: number
}

interface DupesState {
  scanning: boolean
  progress: DupesProgress | null
  groups: DupeGroup[] | null
  error: string | null
}

interface DupesActions {
  scan: (options: DupesOptions) => void
  cancel: () => void
  removeFromGroups: (path: string) => void
}

export function useDupes(): DupesState & DupesActions {
  const [state, setState] = useState<DupesState>({
    scanning: false,
    progress: null,
    groups: null,
    error: null
  })

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const scan = useCallback((options: DupesOptions) => {
    unsubRef.current?.()

    setState({ scanning: true, progress: null, groups: null, error: null })

    const unsub = window.freeit.dupes.onMessage((msg: DupesMessage) => {
      if (msg.type === 'progress') {
        setState((s) => ({
          ...s,
          progress: { step: msg.step, processed: msg.processed, total: msg.total }
        }))
      } else if (msg.type === 'result') {
        setState({ scanning: false, progress: null, groups: msg.data, error: null })
      } else if (msg.type === 'error') {
        setState((s) => ({ ...s, scanning: false, error: msg.message }))
      }
    })

    unsubRef.current = unsub
    void window.freeit.dupes.start(options)
  }, [])

  const cancel = useCallback(() => {
    void window.freeit.dupes.cancel()
    unsubRef.current?.()
    unsubRef.current = null
    setState((s) => ({ ...s, scanning: false }))
  }, [])

  // Retire un chemin de tous les groupes (utile après trash). Si un groupe
  // descend à moins de 2 chemins, on le retire entièrement. On recalcule
  // recoverable_bytes pour refléter le nouveau nombre de copies restantes.
  const removeFromGroups = useCallback((path: string) => {
    setState((s) => {
      if (!s.groups) return s
      const updated: DupeGroup[] = []
      for (const g of s.groups) {
        const filtered = g.paths.filter((p) => p !== path)
        if (filtered.length < 2) continue
        updated.push({
          ...g,
          paths: filtered,
          recoverable_bytes: g.size * (filtered.length - 1)
        })
      }
      return { ...s, groups: updated }
    })
  }, [])

  return { ...state, scan, cancel, removeFromGroups }
}
