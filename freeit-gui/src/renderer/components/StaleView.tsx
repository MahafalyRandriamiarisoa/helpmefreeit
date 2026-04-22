import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import {
  File,
  FolderOpen,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Calendar,
  Loader2,
  Play
} from 'lucide-react'
import { useStale } from '../hooks/useStale'
import { formatSize, sizeColor } from '../lib/format'
import type { StaleFile } from '../../main/types'

// -----------------------------------------------------------------------------
// Constantes
// -----------------------------------------------------------------------------

const DEFAULT_MIN_AGE_DAYS = 90
const DEFAULT_MIN_SIZE = 100 * 1024 ** 2 // 100 Mo

interface SizePreset {
  label: string
  value: number
}

const SIZE_PRESETS: SizePreset[] = [
  { label: '100 Mo', value: 100 * 1024 ** 2 },
  { label: '500 Mo', value: 500 * 1024 ** 2 },
  { label: '1 Go', value: 1 * 1024 ** 3 },
  { label: '5 Go', value: 5 * 1024 ** 3 }
]

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type SortKey = 'age' | 'size' | 'atime' | 'path'
type SortDir = 'asc' | 'desc'

function truncateMiddle(str: string, max: number): string {
  if (str.length <= max) return str
  const half = Math.floor((max - 2) / 2)
  return str.slice(0, half) + '…' + str.slice(-half)
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

function ageColor(days: number): string {
  return days >= 180 ? 'var(--color-size-medium)' : 'var(--color-size-normal)'
}

// -----------------------------------------------------------------------------
// Context menu interne (minimal, pour éviter le conflit avec ContextMenu.tsx)
// -----------------------------------------------------------------------------

interface StaleCtxState {
  x: number
  y: number
  path: string
}

interface StaleContextMenuProps {
  state: StaleCtxState
  onClose: () => void
  onTrashed: (path: string) => void
}

function StaleContextMenu({ state, onClose, onTrashed }: StaleContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const onShow = async (): Promise<void> => {
    await window.freeit.fs.showInFinder(state.path)
    onClose()
  }
  const onCopy = async (): Promise<void> => {
    await window.freeit.fs.copyPath(state.path)
    onClose()
  }
  const onTrash = async (): Promise<void> => {
    const deleted = await window.freeit.fs.trashItem(state.path)
    onClose()
    if (deleted) onTrashed(state.path)
  }

  const adjustedX = Math.min(state.x, window.innerWidth - 240)
  const adjustedY = Math.min(state.y, window.innerHeight - 140)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-lg shadow-2xl animate-fade-in"
      style={{
        left: adjustedX,
        top: adjustedY,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-normal)',
        minWidth: 220,
        backdropFilter: 'blur(20px)'
      }}
    >
      <button onClick={onShow} className="ctx-item">
        <FolderOpen size={13} />
        <span className="flex-1 text-left">Voir dans le Finder</span>
      </button>
      <button onClick={onCopy} className="ctx-item">
        <Copy size={13} />
        <span className="flex-1 text-left">Copier le chemin</span>
      </button>
      <div className="mx-2 my-1" style={{ borderTop: '1px solid var(--border-dim)' }} />
      <button onClick={onTrash} className="ctx-item" data-danger="true">
        <Trash2 size={13} />
        <span className="flex-1 text-left">Mettre à la corbeille</span>
      </button>
      <div className="mx-2 mt-1 mb-0.5" style={{ borderTop: '1px solid var(--border-dim)' }} />
      <div
        className="px-3 py-1 text-[10px] mono truncate"
        style={{ color: 'var(--text-dim)' }}
        title={state.path}
      >
        {state.path}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Barre de contrôle (inputs + bouton Lancer/Annuler + progress)
// -----------------------------------------------------------------------------

interface ControlBarProps {
  minAgeDays: number
  setMinAgeDays: (v: number) => void
  minSize: number
  setMinSize: (v: number) => void
  scanning: boolean
  scanned: number | null
  onStart: () => void
  onCancel: () => void
}

function ControlBar({
  minAgeDays,
  setMinAgeDays,
  minSize,
  setMinSize,
  scanning,
  scanned,
  onStart,
  onCancel
}: ControlBarProps): JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 shrink-0"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-dim)'
      }}
    >
      <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <Calendar size={12} style={{ color: 'var(--text-dim)' }} />
        Âge min.
        <input
          type="number"
          min={1}
          value={minAgeDays}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            setMinAgeDays(Number.isFinite(v) && v > 0 ? v : 1)
          }}
          disabled={scanning}
          className="mono"
          style={{
            width: 60,
            padding: '3px 6px',
            borderRadius: 6,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-primary)',
            fontSize: 11,
            outline: 'none'
          }}
        />
        <span style={{ color: 'var(--text-dim)' }}>j</span>
      </label>

      <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Taille min.
        <select
          value={minSize}
          onChange={(e) => setMinSize(parseInt(e.target.value, 10))}
          disabled={scanning}
          style={{
            padding: '3px 6px',
            borderRadius: 6,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-primary)',
            fontSize: 11,
            outline: 'none'
          }}
        >
          {SIZE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex-1" />

      {scanning ? (
        <>
          <span
            className="flex items-center gap-2 text-[11px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />
            Scan{' '}
            <span className="mono">{scanned ?? 0}</span>
            <span style={{ color: 'var(--text-dim)' }}>fichiers</span>
          </span>
          <button onClick={onCancel} className="btn-pill" style={{ padding: '2px 10px', fontSize: 10 }}>
            Annuler
          </button>
        </>
      ) : (
        <button
          onClick={onStart}
          className="btn-primary"
          style={{ padding: '4px 14px', fontSize: 12 }}
        >
          <Play size={12} />
          Lancer
        </button>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Vue principale
// -----------------------------------------------------------------------------

export interface StaleViewProps {
  defaultPath: string
  className?: string
}

export function StaleView({ defaultPath, className }: StaleViewProps): JSX.Element {
  const { scanning, progress, files, error, scan, cancel, removeFile } = useStale()

  const [minAgeDays, setMinAgeDays] = useState<number>(DEFAULT_MIN_AGE_DAYS)
  const [minSize, setMinSize] = useState<number>(DEFAULT_MIN_SIZE)
  const [sortKey, setSortKey] = useState<SortKey>('age')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<StaleCtxState | null>(null)

  const handleStart = useCallback((): void => {
    setSelected(null)
    scan({
      path: defaultPath,
      minAgeDays,
      minSize
    })
  }, [scan, defaultPath, minAgeDays, minSize])

  const toggleSort = useCallback(
    (key: SortKey): void => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir(key === 'path' ? 'asc' : 'desc')
      }
    },
    [sortKey]
  )

  const sortedFiles = useMemo<StaleFile[]>(() => {
    if (!files) return []
    const items = [...files]
    items.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'age':
          cmp = a.age_days - b.age_days
          break
        case 'size':
          cmp = a.size - b.size
          break
        case 'atime':
          cmp = a.atime - b.atime
          break
        case 'path':
          cmp = a.path.localeCompare(b.path)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return items
  }, [files, sortKey, sortDir])

  const totalBytes = useMemo<number>(
    () => (files ? files.reduce((s, f) => s + f.size, 0) : 0),
    [files]
  )

  const SortIcon = sortDir === 'asc' ? ArrowUp : ArrowDown

  const thBase = {
    color: 'var(--text-dim)',
    fontSize: 10,
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em'
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${className ?? ''}`}>
      {/* Erreur */}
      {error && (
        <div
          className="px-4 py-2 text-xs shrink-0"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-size-huge)' }}
        >
          Erreur : {error}
        </div>
      )}

      {/* Contrôles */}
      <ControlBar
        minAgeDays={minAgeDays}
        setMinAgeDays={setMinAgeDays}
        minSize={minSize}
        setMinSize={setMinSize}
        scanning={scanning}
        scanned={progress?.scanned ?? null}
        onStart={handleStart}
        onCancel={cancel}
      />

      {/* Contenu */}
      <div className="flex-1 overflow-auto relative">
        {ctxMenu && (
          <StaleContextMenu
            state={ctxMenu}
            onClose={() => setCtxMenu(null)}
            onTrashed={(path) => {
              removeFile(path)
              if (selected === path) setSelected(null)
            }}
          />
        )}

        {files && files.length > 0 && (
          <table
            className="w-full text-xs"
            style={{ borderCollapse: 'separate', borderSpacing: 0 }}
          >
            <thead>
              <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                <th className="w-8 py-2 pl-4" />
                <th
                  className="text-right py-2 px-2 w-20 cursor-pointer select-none"
                  onClick={() => toggleSort('age')}
                  style={thBase}
                >
                  <span className="flex items-center justify-end gap-1">
                    Âge
                    {sortKey === 'age' && <SortIcon size={10} />}
                  </span>
                </th>
                <th
                  className="text-right py-2 px-2 w-24 cursor-pointer select-none"
                  onClick={() => toggleSort('size')}
                  style={thBase}
                >
                  <span className="flex items-center justify-end gap-1">
                    Taille
                    {sortKey === 'size' && <SortIcon size={10} />}
                  </span>
                </th>
                <th
                  className="text-right py-2 px-2 w-28 cursor-pointer select-none"
                  onClick={() => toggleSort('atime')}
                  style={thBase}
                >
                  <span className="flex items-center justify-end gap-1">
                    Dernier accès
                    {sortKey === 'atime' && <SortIcon size={10} />}
                  </span>
                </th>
                <th
                  className="text-left py-2 px-2 cursor-pointer select-none"
                  onClick={() => toggleSort('path')}
                  style={thBase}
                >
                  <span className="flex items-center gap-1">
                    Chemin
                    {sortKey === 'path' && <SortIcon size={10} />}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.map((f) => {
                const isSelected = selected === f.path
                return (
                  <tr
                    key={f.path}
                    className="explorer-row cursor-pointer"
                    data-selected={isSelected}
                    onClick={() => setSelected(f.path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelected(f.path)
                      setCtxMenu({ x: e.clientX, y: e.clientY, path: f.path })
                    }}
                  >
                    <td className="py-1.5 pl-4">
                      <File size={13} style={{ color: 'var(--text-dim)' }} />
                    </td>
                    <td
                      className="py-1.5 px-2 text-right mono"
                      style={{ color: ageColor(f.age_days) }}
                    >
                      {f.age_days} j
                    </td>
                    <td
                      className="py-1.5 px-2 text-right mono"
                      style={{ color: sizeColor(f.size) }}
                    >
                      {formatSize(f.size)}
                    </td>
                    <td
                      className="py-1.5 px-2 text-right mono"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {formatDate(f.atime)}
                    </td>
                    <td
                      className="py-1.5 px-2 mono"
                      style={{ color: 'var(--text-dim)' }}
                      title={f.path}
                    >
                      {truncateMiddle(f.path, 90)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* État vide */}
        {files && files.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-2 text-center px-6"
            style={{ color: 'var(--text-dim)' }}
          >
            <span className="text-sm">Aucun fichier ne répond aux critères</span>
            <span className="text-[11px] mono">
              âge ≥ {minAgeDays} j · taille ≥ {formatSize(minSize)}
            </span>
          </div>
        )}

        {/* Aucun scan lancé */}
        {!files && !scanning && !error && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-2 text-center px-6"
            style={{ color: 'var(--text-dim)' }}
          >
            <span className="text-sm">Lance un scan pour trouver les fichiers anciens et volumineux</span>
            <span className="text-[11px] mono">
              défauts : ≥ {DEFAULT_MIN_AGE_DAYS} j · ≥ {formatSize(DEFAULT_MIN_SIZE)}
            </span>
          </div>
        )}
      </div>

      {/* Totaux */}
      {files && files.length > 0 && (
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: 28,
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-dim)',
            fontSize: 10,
            color: 'var(--text-dim)'
          }}
        >
          <span>
            {files.length} fichier{files.length > 1 ? 's' : ''} · total{' '}
            <span className="mono" style={{ color: 'var(--text-secondary)' }}>
              {formatSize(totalBytes)}
            </span>
          </span>
          <span className="mono truncate ml-4">{defaultPath}</span>
        </div>
      )}
    </div>
  )
}
