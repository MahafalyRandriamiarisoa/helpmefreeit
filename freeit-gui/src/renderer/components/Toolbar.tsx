import {
  Eye, EyeOff, File, Folder, HardDrive, Search, X, LayoutGrid, List,
  Copy, Clock, Sparkles,
} from 'lucide-react'

export type ViewMode = 'table' | 'treemap' | 'dupes' | 'stale' | 'clean'

interface ToolbarProps {
  includeHidden: boolean
  setIncludeHidden: (v: boolean) => void
  includeFiles: boolean
  setIncludeFiles: (v: boolean) => void
  noCrossDevice: boolean
  setNoCrossDevice: (v: boolean) => void
  searchQuery: string
  setSearchQuery: (v: string) => void
  viewMode: ViewMode
  setViewMode: (v: ViewMode) => void
  onOpenDirectory: () => void
}

export function Toolbar({
  includeHidden, setIncludeHidden,
  includeFiles, setIncludeFiles,
  noCrossDevice, setNoCrossDevice,
  searchQuery, setSearchQuery,
  viewMode, setViewMode,
  onOpenDirectory
}: ToolbarProps) {
  return (
    <div
      className="flex items-center gap-2 px-4 shrink-0 flex-wrap"
      style={{
        height: 40,
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-dim)',
      }}
    >
      <button onClick={onOpenDirectory} className="btn-primary" style={{ padding: '3px 10px' }}>
        <Folder size={12} />
        Ouvrir
      </button>

      <div className="sep" />

      <button
        onClick={() => setIncludeHidden(!includeHidden)}
        className="btn-pill"
        data-active={includeHidden}
        title="Afficher les fichiers cachés"
      >
        {includeHidden ? <Eye size={12} /> : <EyeOff size={12} />}
        <span className="hidden sm:inline">Cachés</span>
      </button>
      <button
        onClick={() => setIncludeFiles(!includeFiles)}
        className="btn-pill"
        data-active={includeFiles}
        title="Inclure les fichiers"
      >
        <File size={12} />
        <span className="hidden sm:inline">Fichiers</span>
      </button>
      <button
        onClick={() => setNoCrossDevice(!noCrossDevice)}
        className="btn-pill"
        data-active={noCrossDevice}
        title="Rester sur le même volume"
      >
        <HardDrive size={12} />
        <span className="hidden sm:inline">Même volume</span>
      </button>

      <div className="sep" />

      <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border-dim)' }}>
        <button
          onClick={() => setViewMode('table')}
          className="view-toggle-btn"
          data-active={viewMode === 'table'}
          title="Vue liste"
        >
          <List size={13} />
        </button>
        <button
          onClick={() => setViewMode('treemap')}
          className="view-toggle-btn"
          data-active={viewMode === 'treemap'}
          title="Vue treemap"
        >
          <LayoutGrid size={13} />
        </button>
      </div>

      <div className="sep" />

      <button
        onClick={() => setViewMode('dupes')}
        className="btn-pill"
        data-active={viewMode === 'dupes'}
        title="Doublons — trouver les fichiers identiques"
      >
        <Copy size={12} />
        <span className="hidden sm:inline">Doublons</span>
      </button>
      <button
        onClick={() => setViewMode('stale')}
        className="btn-pill"
        data-active={viewMode === 'stale'}
        title="Fichiers anciens et volumineux"
      >
        <Clock size={12} />
        <span className="hidden sm:inline">Anciens</span>
      </button>
      <button
        onClick={() => setViewMode('clean')}
        className="btn-pill"
        data-active={viewMode === 'clean'}
        title="Nettoyage — caches, node_modules, …"
      >
        <Sparkles size={12} />
        <span className="hidden sm:inline">Nettoyage</span>
      </button>

      <div className="flex-1" />

      <div className="search-box">
        <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filtrer…"
          spellCheck={false}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="btn-icon"
            style={{ padding: 2 }}
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
