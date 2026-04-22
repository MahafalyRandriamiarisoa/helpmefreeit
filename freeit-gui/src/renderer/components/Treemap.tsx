import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { treemap, hierarchy, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import { formatSize, sizeColor } from '../lib/format'
import { ContextMenu } from './ContextMenu'
import type { EntryNode } from '../lib/types'

type TreemapDatum = EntryNode & { value: number }

interface TreemapProps {
  entries: EntryNode[]
  parentSize: number
  onNavigate: (path: string) => void
  onRefresh: () => void
}

interface CtxState {
  x: number
  y: number
  entry: EntryNode
}

export function Treemap({ entries, parentSize, onNavigate, onRefresh }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 500 })
  const [hovered, setHovered] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDims({ width: Math.floor(width), height: Math.floor(height) })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const nodes = useMemo(() => {
    const root = {
      name: 'root',
      children: entries.filter((e) => e.size > 0).map((e) => ({
        ...e,
        value: e.size
      }))
    } as unknown as TreemapDatum

    const h = hierarchy<TreemapDatum>(root)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    treemap<TreemapDatum>()
      .size([dims.width, dims.height])
      .padding(2)
      .round(true)
      .tile(treemapSquarify)(h)

    return h.leaves() as HierarchyRectangularNode<TreemapDatum>[]
  }, [entries, dims])

  const handleClick = useCallback((entry: EntryNode) => {
    if (entry.isDir) onNavigate(entry.path)
  }, [onNavigate])

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden relative" style={{ background: 'var(--bg-base)' }}>
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

      <svg width={dims.width} height={dims.height}>
        {nodes.map((node) => {
          const d = node.data
          const w = node.x1 - node.x0
          const h = node.y1 - node.y0
          if (w < 2 || h < 2) return null

          const color = sizeColor(d.size)
          const isHovered = hovered === d.path
          const showLabel = w > 50 && h > 24

          return (
            <g
              key={d.path}
              transform={`translate(${node.x0},${node.y0})`}
              onClick={() => handleClick(d)}
              onDoubleClick={() => handleClick(d)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu({ x: e.clientX, y: e.clientY, entry: d })
              }}
              onMouseEnter={() => setHovered(d.path)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: d.isDir ? 'pointer' : 'default' }}
            >
              <rect
                width={w}
                height={h}
                rx={3}
                fill={color}
                opacity={isHovered ? 0.4 : 0.2}
                stroke={isHovered ? color : 'var(--border-dim)'}
                strokeWidth={isHovered ? 1.5 : 0.5}
                style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
              />
              {showLabel && (
                <>
                  <text
                    x={6}
                    y={15}
                    fill="var(--text-primary)"
                    fontSize={11}
                    fontWeight={d.isDir ? 600 : 400}
                    style={{ pointerEvents: 'none' }}
                  >
                    {d.name.length > Math.floor(w / 7) ? d.name.slice(0, Math.floor(w / 7) - 1) + '…' : d.name}
                  </text>
                  {h > 36 && (
                    <text
                      x={6}
                      y={29}
                      fill={color}
                      fontSize={10}
                      fontFamily="'JetBrains Mono', monospace"
                      style={{ pointerEvents: 'none' }}
                    >
                      {formatSize(d.size)}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>

      {hovered && (() => {
        const node = nodes.find((n) => n.data.path === hovered)
        if (!node) return null
        const d = node.data
        const ratio = parentSize > 0 ? d.size / parentSize : 0

        return (
          <div
            className="absolute bottom-3 left-3 px-3 py-2 rounded-lg text-xs pointer-events-none animate-fade-in"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-normal)',
              backdropFilter: 'blur(12px)'
            }}
          >
            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.name}</div>
            <div className="mono mt-0.5" style={{ color: sizeColor(d.size) }}>
              {formatSize(d.size)} ({(ratio * 100).toFixed(1)}%)
            </div>
            <div className="mono mt-0.5 truncate max-w-xs" style={{ color: 'var(--text-dim)' }}>
              {d.path}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
