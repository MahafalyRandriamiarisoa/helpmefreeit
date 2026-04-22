import { useState, useMemo, useCallback } from 'react'
import type { JSX } from 'react'
import {
  Trash2,
  AlertTriangle,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2
} from 'lucide-react'
import { useClean } from '../hooks/useClean'
import { formatSize, sizeColor } from '../lib/format'
import type { JunkPresetSummary } from '../../main/types'

interface CleanViewProps {
  className?: string
}

interface ConfirmState {
  paths: string[]
  totalBytes: number
}

interface TrashProgress {
  done: number
  total: number
}

export function CleanView({ className }: CleanViewProps): JSX.Element {
  const {
    scanning,
    currentPreset,
    summaries,
    error,
    scan,
    cancel,
    trashAll
  } = useClean()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [trashing, setTrashing] = useState<TrashProgress | null>(null)

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedSummaries = useMemo<JunkPresetSummary[]>(() => {
    if (!summaries) return []
    return summaries.filter((s) => selected.has(s.id))
  }, [summaries, selected])

  const selectionTotals = useMemo(() => {
    const paths: string[] = []
    let totalBytes = 0
    for (const s of selectedSummaries) {
      paths.push(...s.paths)
      totalBytes += s.total_bytes
    }
    return { paths, totalBytes }
  }, [selectedSummaries])

  const handleStartScan = useCallback(() => {
    setSelected(new Set())
    setExpanded(new Set())
    setConfirm(null)
    scan()
  }, [scan])

  const handleShowInFinder = useCallback((path: string) => {
    void window.freeit.fs.showInFinder(path)
  }, [])

  const handleTrashSinglePath = useCallback(
    async (path: string) => {
      setTrashing({ done: 0, total: 1 })
      await trashAll([path], (done, total) => setTrashing({ done, total }))
      setTrashing(null)
      scan()
    },
    [trashAll, scan]
  )

  const handleAskConfirm = useCallback(() => {
    if (selectionTotals.paths.length === 0) return
    setConfirm({
      paths: selectionTotals.paths,
      totalBytes: selectionTotals.totalBytes
    })
  }, [selectionTotals])

  const handleConfirmTrash = useCallback(async () => {
    if (!confirm) return
    const paths = confirm.paths
    setConfirm(null)
    setTrashing({ done: 0, total: paths.length })
    await trashAll(paths, (done, total) => setTrashing({ done, total }))
    setTrashing(null)
    setSelected(new Set())
    scan()
  }, [confirm, trashAll, scan])

  return (
    <div
      className={['flex flex-col h-full', className].filter(Boolean).join(' ')}
      style={{ background: 'var(--bg-base)' }}
    >
      {/* En-tête */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-dim)'
        }}
      >
        {!scanning ? (
          <button onClick={handleStartScan} className="btn-primary">
            <Trash2 size={13} />
            Analyser les presets
          </button>
        ) : (
          <button onClick={cancel} className="btn-pill">
            Annuler
          </button>
        )}

        {scanning && (
          <div className="flex items-center gap-2">
            <Loader2
              size={13}
              className="animate-spin"
              style={{ color: 'var(--accent)' }}
            />
            <span
              className="text-[11px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {currentPreset
                ? <>Analyse… <span className="mono">{currentPreset}</span></>
                : 'Analyse en cours…'}
            </span>
          </div>
        )}

        {!scanning && summaries && (
          <span
            className="text-[11px]"
            style={{ color: 'var(--text-dim)' }}
          >
            {summaries.length} preset{summaries.length > 1 ? 's' : ''} analysé
            {summaries.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Erreur */}
      {error && (
        <div
          className="px-4 py-2 text-[11px] shrink-0"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--color-size-huge)',
            borderBottom: '1px solid var(--border-dim)'
          }}
        >
          <AlertTriangle size={12} className="inline mr-2" />
          {error}
        </div>
      )}

      {/* Liste des presets */}
      <div className="flex-1 overflow-auto p-4">
        {!summaries && !scanning && !error && (
          <div
            className="flex items-center justify-center py-16 text-sm"
            style={{ color: 'var(--text-dim)' }}
          >
            Lance l'analyse pour voir les presets junk disponibles.
          </div>
        )}

        {summaries && summaries.length === 0 && (
          <div
            className="flex items-center justify-center py-16 text-sm"
            style={{ color: 'var(--text-dim)' }}
          >
            Aucun preset n'a retourné de chemins.
          </div>
        )}

        {summaries && summaries.length > 0 && (
          <div className="flex flex-col gap-2 pb-24">
            {summaries.map((preset) => {
              const isExpanded = expanded.has(preset.id)
              const isSelected = selected.has(preset.id)
              const Icon = preset.safe ? Trash2 : AlertTriangle
              const iconColor = preset.safe
                ? 'var(--accent)'
                : 'var(--color-size-medium)'
              const ChevIcon = isExpanded ? ChevronDown : ChevronRight
              const firstPath = preset.paths[0]

              return (
                <div
                  key={preset.id}
                  className="rounded-lg overflow-hidden"
                  style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${
                      isSelected
                        ? 'var(--accent-dim)'
                        : 'var(--border-dim)'
                    }`
                  }}
                >
                  <div className="flex items-start gap-3 p-3">
                    {/* Case à cocher */}
                    <button
                      onClick={() => toggleSelect(preset.id)}
                      className="mt-0.5 flex items-center justify-center shrink-0"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: `1px solid ${
                          isSelected
                            ? 'var(--accent)'
                            : 'var(--border-normal)'
                        }`,
                        background: isSelected
                          ? 'var(--accent)'
                          : 'transparent',
                        cursor: 'pointer'
                      }}
                      aria-label={
                        isSelected
                          ? 'Désélectionner ce preset'
                          : 'Sélectionner ce preset'
                      }
                    >
                      {isSelected && (
                        <Check size={12} style={{ color: '#000' }} />
                      )}
                    </button>

                    {/* Icône preset */}
                    <Icon
                      size={16}
                      className="mt-0.5 shrink-0"
                      style={{ color: iconColor }}
                    />

                    {/* Contenu */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-semibold text-sm"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {preset.label}
                        </span>
                        <span
                          className="mono font-bold"
                          style={{
                            fontSize: 14,
                            color: sizeColor(preset.total_bytes)
                          }}
                        >
                          {formatSize(preset.total_bytes)}
                        </span>
                        {!preset.safe && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{
                              background: 'rgba(234, 179, 8, 0.1)',
                              color: 'var(--color-size-medium)'
                            }}
                          >
                            Prudence
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[11px] mt-0.5"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {preset.description}
                      </div>
                      <button
                        onClick={() => toggleExpand(preset.id)}
                        className="mt-1.5 flex items-center gap-1 text-[11px]"
                        style={{
                          color: 'var(--text-secondary)',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer'
                        }}
                      >
                        <ChevIcon size={11} />
                        {preset.count} chemin{preset.count > 1 ? 's' : ''}
                      </button>
                    </div>

                    {/* Action Finder */}
                    {firstPath && (
                      <button
                        onClick={() => handleShowInFinder(firstPath)}
                        className="btn-pill shrink-0"
                        title="Voir dans le Finder"
                      >
                        <FolderOpen size={11} />
                        Finder
                      </button>
                    )}
                  </div>

                  {/* Liste dépliée */}
                  {isExpanded && preset.paths.length > 0 && (
                    <div
                      className="px-3 pb-3"
                      style={{
                        borderTop: '1px solid var(--border-dim)'
                      }}
                    >
                      <div className="flex flex-col gap-1 mt-2">
                        {preset.paths.map((p) => (
                          <div
                            key={p}
                            className="flex items-center gap-2 px-2 py-1 rounded"
                            style={{ background: 'var(--bg-raised)' }}
                          >
                            <span
                              className="mono text-[11px] truncate flex-1"
                              style={{ color: 'var(--text-secondary)' }}
                              title={p}
                            >
                              {p}
                            </span>
                            <button
                              onClick={() => handleShowInFinder(p)}
                              className="btn-icon"
                              title="Voir dans le Finder"
                            >
                              <FolderOpen size={12} />
                            </button>
                            <button
                              onClick={() => handleTrashSinglePath(p)}
                              className="btn-icon"
                              title="Mettre à la corbeille"
                              disabled={trashing !== null}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Barre flottante de sélection */}
      {selectedSummaries.length > 0 && !confirm && !trashing && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg animate-fade-in"
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-normal)'
          }}
        >
          <span
            className="text-[12px]"
            style={{ color: 'var(--text-primary)' }}
          >
            {selectedSummaries.length} preset
            {selectedSummaries.length > 1 ? 's' : ''} sélectionné
            {selectedSummaries.length > 1 ? 's' : ''}
            <span style={{ color: 'var(--text-dim)' }}>
              {' '}
              · {selectionTotals.paths.length} chemin
              {selectionTotals.paths.length > 1 ? 's' : ''}
            </span>
            {' · '}
            <span
              className="mono font-semibold"
              style={{ color: sizeColor(selectionTotals.totalBytes) }}
            >
              {formatSize(selectionTotals.totalBytes)}
            </span>
          </span>
          <button
            onClick={handleAskConfirm}
            className="btn-primary"
            style={{ background: 'var(--color-size-huge)', color: '#fff' }}
          >
            <Trash2 size={13} />
            Mettre à la corbeille
          </button>
        </div>
      )}

      {/* Progression de la corbeille */}
      {trashing && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 px-4 py-3 rounded-lg shadow-lg"
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-normal)',
            minWidth: 320
          }}
        >
          <div className="flex items-center gap-2">
            <Loader2
              size={13}
              className="animate-spin"
              style={{ color: 'var(--accent)' }}
            />
            <span
              className="text-[12px]"
              style={{ color: 'var(--text-primary)' }}
            >
              Mise à la corbeille…{' '}
              <span className="mono">
                {trashing.done} / {trashing.total}
              </span>
            </span>
          </div>
          <div
            style={{
              height: 4,
              background: 'var(--bg-hover)',
              borderRadius: 2,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${
                  trashing.total > 0
                    ? (trashing.done / trashing.total) * 100
                    : 0
                }%`,
                background: 'var(--accent)',
                transition: 'width 0.2s ease-out'
              }}
            />
          </div>
        </div>
      )}

      {/* Dialogue de confirmation */}
      {confirm && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 50 }}
          onClick={() => setConfirm(null)}
        >
          <div
            className="rounded-lg p-5 animate-fade-in"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-normal)',
              minWidth: 360,
              maxWidth: 480
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle
                size={18}
                style={{ color: 'var(--color-size-medium)' }}
              />
              <h3
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Confirmer la suppression
              </h3>
            </div>
            <p
              className="text-[12px] mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              Confirmer la suppression de{' '}
              <span className="mono font-semibold">
                {confirm.paths.length}
              </span>{' '}
              chemin{confirm.paths.length > 1 ? 's' : ''} (
              <span
                className="mono"
                style={{ color: sizeColor(confirm.totalBytes) }}
              >
                {formatSize(confirm.totalBytes)}
              </span>
              ) ? Les éléments iront dans la corbeille macOS.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="btn-ghost"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmTrash}
                className="btn-primary"
                style={{
                  background: 'var(--color-size-huge)',
                  color: '#fff'
                }}
              >
                <Trash2 size={13} />
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
