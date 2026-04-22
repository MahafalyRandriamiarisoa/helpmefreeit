import { useState, useMemo, useCallback } from 'react'
import { Folder, File, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'
import { SizeBar } from './SizeBar'
import { ContextMenu } from './ContextMenu'
import { formatSize, sizeColor } from '../lib/format'
import type { EntryNode } from '../lib/types'

type SortKey = 'name' | 'size'
type SortDir = 'asc' | 'desc'

interface ExplorerProps {
  entries: EntryNode[]
  parentSize: number
  searchQuery: string
  onNavigate: (path: string) => void
  onRefresh: () => void
}

interface CtxState {
  x: number
  y: number
  entry: EntryNode
}

export function Explorer({ entries, parentSize, searchQuery, onNavigate, onRefresh }: ExplorerProps) {
  const [sortKey, setSortKey] = useState<SortKey>('size')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null)

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'size' ? 'desc' : 'asc')
    }
  }, [sortKey])

  const filtered = useMemo(() => {
    let items = [...entries]
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter((e) => e.name.toLowerCase().includes(q))
    }
    items.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'size') {
        cmp = a.size - b.size
      } else {
        cmp = a.name.localeCompare(b.name)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return items
  }, [entries, searchQuery, sortKey, sortDir])

  const maxSize = parentSize > 0 ? parentSize : 1

  const SortIcon = sortDir === 'asc' ? ArrowUp : ArrowDown

  return (
    <div className="flex-1 overflow-auto">
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          path={ctxMenu.entry.path}
          isDir={ctxMenu.entry.isDir}
          onClose={() => setCtxMenu(null)}
          onRefresh={onRefresh}
          onDeleted={onRefresh}
        />
      )}

      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 10 }}>
            <th className="w-8 py-2 pl-4" />
            <th
              className="text-left py-2 px-2 cursor-pointer select-none"
              onClick={() => toggleSort('name')}
              style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              <span className="flex items-center gap-1">
                Nom
                {sortKey === 'name' && <SortIcon size={10} />}
              </span>
            </th>
            <th
              className="text-right py-2 px-2 w-24 cursor-pointer select-none"
              onClick={() => toggleSort('size')}
              style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              <span className="flex items-center justify-end gap-1">
                Taille
                {sortKey === 'size' && <SortIcon size={10} />}
              </span>
            </th>
            <th className="text-right py-2 px-2 w-14" style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 500 }}>%</th>
            <th className="py-2 px-2 w-40" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((entry) => {
            const ratio = entry.size / maxSize
            const pct = (ratio * 100).toFixed(1)
            const color = sizeColor(entry.size)
            const isSelected = selected === entry.path

            return (
              <tr
                key={entry.path}
                className="explorer-row cursor-pointer"
                data-selected={isSelected}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => {
                  if (entry.isDir) onNavigate(entry.path)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSelected(entry.path)
                  setCtxMenu({ x: e.clientX, y: e.clientY, entry })
                }}
              >
                <td className="py-1.5 pl-4">
                  {entry.isDir
                    ? <Folder size={13} style={{ color: 'var(--accent)' }} />
                    : <File size={13} style={{ color: 'var(--text-dim)' }} />
                  }
                </td>
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={entry.isDir ? 'font-medium' : ''}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {entry.name}
                    </span>
                    {entry.error && (
                      <AlertTriangle size={10} style={{ color: 'var(--color-size-medium)' }} />
                    )}
                  </div>
                </td>
                <td className="py-1.5 px-2 text-right mono" style={{ color }}>
                  {formatSize(entry.size)}
                </td>
                <td className="py-1.5 px-2 text-right mono" style={{ color: 'var(--text-dim)' }}>
                  {pct}
                </td>
                <td className="py-1.5 px-2">
                  <SizeBar ratio={ratio} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <div className="flex items-center justify-center py-16 text-sm"
          style={{ color: 'var(--text-dim)' }}>
          {searchQuery ? 'Aucun résultat pour ce filtre' : 'Aucun élément trouvé'}
        </div>
      )}
    </div>
  )
}
