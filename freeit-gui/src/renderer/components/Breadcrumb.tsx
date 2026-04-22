import { useState, useRef, useEffect } from 'react'
import { ChevronRight, HardDrive } from 'lucide-react'

interface BreadcrumbProps {
  currentPath: string
  onNavigate: (path: string) => void
}

export function Breadcrumb({ currentPath, onNavigate }: BreadcrumbProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(currentPath)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(currentPath)
  }, [currentPath])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const parts = currentPath.split('/').filter(Boolean)

  const handleSubmit = () => {
    setEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentPath) {
      onNavigate(trimmed)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-full bg-transparent outline-none mono text-xs px-1 py-0.5 rounded"
        style={{
          color: 'var(--text-primary)',
          background: 'var(--bg-raised)',
        }}
        spellCheck={false}
      />
    )
  }

  return (
    <div
      className="flex items-center gap-0 min-w-0 cursor-text rounded px-1 py-0.5"
      onClick={() => setEditing(true)}
      style={{ transition: 'background 0.1s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-raised)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onNavigate('/') }}
        className="btn-icon"
        style={{ padding: 3 }}
      >
        <HardDrive size={12} />
      </button>

      {parts.map((part, idx) => {
        const pathUpTo = '/' + parts.slice(0, idx + 1).join('/')
        const isLast = idx === parts.length - 1

        return (
          <div key={pathUpTo} className="flex items-center min-w-0">
            <ChevronRight size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(pathUpTo) }}
              className={`text-xs px-1 py-0.5 rounded truncate max-w-[160px] transition-colors ${isLast ? 'font-medium' : ''}`}
              style={{
                color: isLast ? 'var(--text-primary)' : 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isLast) e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                if (!isLast) e.currentTarget.style.color = 'var(--text-dim)'
              }}
              title={pathUpTo}
            >
              {part}
            </button>
          </div>
        )
      })}
    </div>
  )
}
