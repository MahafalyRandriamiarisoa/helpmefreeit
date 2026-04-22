import { Loader2 } from 'lucide-react'

interface ScanProgressProps {
  scanned?: number
  total?: number
  currentPath?: string
  onCancel: () => void
}

export function ScanProgress({ scanned, total, currentPath, onCancel }: ScanProgressProps) {
  const hasProgress = scanned != null && total != null && total > 0
  const pct = hasProgress ? Math.round((scanned! / total!) * 100) : 0

  const shortPath = currentPath && currentPath.length > 50
    ? '…' + currentPath.slice(-48)
    : currentPath

  return (
    <div
      className="animate-fade-in shrink-0"
      style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-dim)' }}
    >
      {hasProgress && (
        <div style={{ height: 2, background: 'var(--bg-hover)' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--accent)',
              transition: 'width 0.3s ease-out',
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-1.5">
        <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {hasProgress
            ? <>
                Scan…{' '}
                <span className="mono">{scanned}</span>
                <span style={{ color: 'var(--text-dim)' }}> / {total}</span>
              </>
            : 'Scan en cours…'
          }
        </span>
        {shortPath && (
          <span
            className="text-[10px] mono truncate flex-1"
            style={{ color: 'var(--text-dim)' }}
            title={currentPath}
          >
            {shortPath}
          </span>
        )}
        {!shortPath && <div className="flex-1" />}
        <button onClick={onCancel} className="btn-pill" style={{ padding: '2px 8px', fontSize: 10 }}>
          Annuler
        </button>
      </div>
    </div>
  )
}
