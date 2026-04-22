import { useEffect, useRef } from 'react'
import { Copy, FolderOpen, Terminal, Trash2, RefreshCw } from 'lucide-react'

interface ContextMenuProps {
  x: number
  y: number
  path: string
  isDir: boolean
  onClose: () => void
  onRefresh: () => void
  onDeleted: () => void
}

interface MenuItem {
  icon: React.ReactNode
  label: string
  shortcut?: string
  danger?: boolean
  action: () => void
}

export function ContextMenu({ x, y, path, isDir, onClose, onRefresh, onDeleted }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const items: MenuItem[] = [
    {
      icon: <Copy size={13} />,
      label: 'Copier le chemin',
      shortcut: '⌘C',
      action: () => { window.freeit.fs.copyPath(path); onClose() }
    },
    {
      icon: <FolderOpen size={13} />,
      label: 'Ouvrir dans le Finder',
      shortcut: '⌘⇧F',
      action: () => { window.freeit.fs.showInFinder(path); onClose() }
    },
    ...(isDir ? [{
      icon: <Terminal size={13} />,
      label: 'Ouvrir un terminal ici',
      shortcut: '⌘T',
      action: () => { window.freeit.fs.openTerminal(path); onClose() }
    }] : []),
    {
      icon: <RefreshCw size={13} />,
      label: 'Rafraîchir',
      shortcut: '⌘R',
      action: () => { onRefresh(); onClose() }
    },
    {
      icon: <Trash2 size={13} />,
      label: 'Mettre à la corbeille',
      shortcut: '⌘⌫',
      danger: true,
      action: async () => {
        const deleted = await window.freeit.fs.trashItem(path)
        onClose()
        if (deleted) onDeleted()
      }
    }
  ]

  const adjustedX = Math.min(x, window.innerWidth - 240)
  const adjustedY = Math.min(y, window.innerHeight - items.length * 34 - 40)

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
        backdropFilter: 'blur(20px)',
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.danger && (
            <div className="mx-2 my-1" style={{ borderTop: '1px solid var(--border-dim)' }} />
          )}
          <button
            onClick={item.action}
            className="ctx-item"
            data-danger={item.danger || undefined}
          >
            {item.icon}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}

      <div className="mx-2 mt-1 mb-0.5" style={{ borderTop: '1px solid var(--border-dim)' }} />
      <div className="px-3 py-1 text-[10px] mono truncate" style={{ color: 'var(--text-dim)' }} title={path}>
        {path}
      </div>
    </div>
  )
}
