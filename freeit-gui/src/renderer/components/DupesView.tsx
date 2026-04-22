import { useState, useCallback, useMemo } from 'react'
import type { JSX } from 'react'
import {
  Play,
  X as CancelIcon,
  File as FileIcon,
  FolderOpen,
  Trash2,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { useDupes } from '../hooks/useDupes'
import { formatSize, sizeColor, parseSize } from '../lib/format'

interface DupesViewProps {
  defaultPath: string
  className?: string
}

// Tronque un chemin par le milieu pour rester lisible quand c'est trop long.
function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const keep = max - 1
  const left = Math.ceil(keep / 2)
  const right = Math.floor(keep / 2)
  return s.slice(0, left) + '…' + s.slice(s.length - right)
}

export function DupesView({ defaultPath, className }: DupesViewProps): JSX.Element {
  const { scanning, progress, groups, error, scan, cancel, removeFromGroups } = useDupes()
  const [minSizeInput, setMinSizeInput] = useState('1M')

  const totalRecoverable = useMemo(() => {
    if (!groups) return 0
    return groups.reduce((acc, g) => acc + g.recoverable_bytes, 0)
  }, [groups])

  const startScan = useCallback(() => {
    const parsed = parseSize(minSizeInput)
    const minSize = parsed > 0 ? parsed : 0
    scan({ path: defaultPath, minSize })
  }, [scan, defaultPath, minSizeInput])

  const handleShow = useCallback((p: string) => {
    void window.freeit.fs.showInFinder(p)
  }, [])

  const handleTrash = useCallback(async (p: string) => {
    const ok = await window.freeit.fs.trashItem(p)
    if (ok) removeFromGroups(p)
  }, [removeFromGroups])

  const rootClass = ['flex flex-col flex-1 min-h-0', className].filter(Boolean).join(' ')

  return (
    <div className={rootClass}>
      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-4 shrink-0 flex-wrap"
        style={{
          minHeight: 40,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border-dim)'
        }}
      >
        {!scanning ? (
          <button
            onClick={startScan}
            className="btn-primary"
            style={{ padding: '3px 10px' }}
            title="Lancer la détection de doublons"
          >
            <Play size={12} />
            {groups ? 'Relancer' : 'Lancer'}
          </button>
        ) : (
          <button
            onClick={cancel}
            className="btn-pill"
            style={{ padding: '3px 10px' }}
            title="Annuler le scan en cours"
          >
            <CancelIcon size={12} />
            Annuler
          </button>
        )}

        <div className="sep" />

        <label
          className="flex items-center gap-2 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span>Taille min.</span>
          <input
            type="text"
            value={minSizeInput}
            onChange={(e) => setMinSizeInput(e.target.value)}
            disabled={scanning}
            className="mono"
            spellCheck={false}
            placeholder="1M"
            style={{
              width: 64,
              padding: '2px 6px',
              fontSize: 11,
              borderRadius: 4,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-dim)',
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />
        </label>

        {progress && (
          <div
            className="flex items-center gap-1 text-[11px] mono"
            style={{ color: 'var(--text-dim)' }}
          >
            <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>{progress.step}</span>
            <span>
              {' '}
              <span style={{ color: 'var(--text-primary)' }}>{progress.processed}</span>
              {' / '}
              {progress.total}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {groups && groups.length > 0 && (
          <span
            className="mono text-[10px] px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
            title="Espace récupérable en gardant 1 copie par groupe"
          >
            {groups.length} groupe{groups.length > 1 ? 's' : ''}
            {' · récup. '}
            <span style={{ color: 'var(--accent)' }}>{formatSize(totalRecoverable)}</span>
          </span>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          className="px-4 py-2 text-xs flex items-center gap-2 shrink-0"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-size-huge)' }}
        >
          <AlertCircle size={12} />
          <span>Erreur : {error}</span>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">
        {groups === null && !scanning && !error && (
          <div
            className="flex items-center justify-center py-16 text-sm"
            style={{ color: 'var(--text-dim)' }}
          >
            Lance un scan pour commencer
          </div>
        )}

        {groups !== null && groups.length === 0 && !scanning && (
          <div
            className="flex items-center justify-center py-16 text-sm"
            style={{ color: 'var(--text-dim)' }}
          >
            Aucun doublon trouvé
          </div>
        )}

        {groups !== null && groups.length > 0 && (
          <div className="flex flex-col gap-3 p-4">
            {groups.map((g) => (
              <div
                key={g.full_hash}
                className="rounded-lg animate-fade-in"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-dim)'
                }}
              >
                {/* Header */}
                <div
                  className="flex items-center gap-3 px-3 py-2"
                  style={{ borderBottom: '1px solid var(--border-dim)' }}
                >
                  <span className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
                    🗎
                  </span>
                  <span
                    className="mono text-xs font-medium"
                    style={{ color: sizeColor(g.size) }}
                  >
                    {formatSize(g.size)}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    × {g.paths.length} copies
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    récup.{' '}
                    <span className="mono" style={{ color: 'var(--accent)' }}>
                      {formatSize(g.recoverable_bytes)}
                    </span>
                  </span>
                  <span
                    className="mono text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-raised)', color: 'var(--text-dim)' }}
                    title={g.full_hash}
                  >
                    {g.full_hash.slice(0, 8)}
                  </span>
                </div>

                {/* Paths */}
                <div>
                  {g.paths.map((p) => (
                    <div
                      key={p}
                      className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                      style={{ borderTop: '1px solid var(--border-dim)' }}
                    >
                      <FileIcon
                        size={12}
                        style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                      />
                      <span
                        className="mono flex-1 truncate"
                        style={{ color: 'var(--text-primary)' }}
                        title={p}
                      >
                        {truncateMiddle(p, 96)}
                      </span>
                      <button
                        onClick={() => handleShow(p)}
                        className="btn-pill"
                        style={{ padding: '2px 8px', fontSize: 10 }}
                        title="Voir dans le Finder"
                      >
                        <FolderOpen size={11} />
                        Finder
                      </button>
                      <button
                        onClick={() => {
                          void handleTrash(p)
                        }}
                        className="btn-pill"
                        style={{
                          padding: '2px 8px',
                          fontSize: 10,
                          color: 'var(--color-size-huge)',
                          borderColor: 'var(--border-dim)'
                        }}
                        title="Mettre à la corbeille"
                      >
                        <Trash2 size={11} />
                        Corbeille
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
