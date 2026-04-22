import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Home, RotateCw } from 'lucide-react'
import { useScanner } from './hooks/useScanner'
import { Toolbar, type ViewMode } from './components/Toolbar'
import { Breadcrumb } from './components/Breadcrumb'
import { Explorer } from './components/Explorer'
import { Treemap } from './components/Treemap'
import { DupesView } from './components/DupesView'
import { StaleView } from './components/StaleView'
import { CleanView } from './components/CleanView'
import { ScanProgress } from './components/ScanProgress'
import { formatSize } from './lib/format'
import type {} from './lib/types' // import for global Window augmentation

export default function App() {
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [includeHidden, setIncludeHidden] = useState(false)
  const [includeFiles, setIncludeFiles] = useState(true)
  const [noCrossDevice, setNoCrossDevice] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  // Les modes table/treemap explorent un dossier ; dupes/stale/clean sont des
  // outils dédiés avec leur propre scan interne.
  const isExploreMode = viewMode === 'table' || viewMode === 'treemap'

  const { scanning, progress, result, error, scan, cancel } = useScanner()

  const doScan = useCallback((path: string) => {
    setCurrentPath(path)
    setSearchQuery('')
    scan({
      path,
      maxDepth: 1,
      includeFiles,
      includeHidden,
      noCrossDevice,
      minSize: 0
    })
  }, [scan, includeFiles, includeHidden, noCrossDevice])

  const navigate = useCallback((path: string) => {
    if (currentPath) {
      setHistory((h) => [...h, currentPath])
    }
    doScan(path)
  }, [currentPath, doScan])

  const goBack = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    doScan(prev)
  }, [history, doScan])

  const goHome = useCallback(() => {
    navigate(window.freeit.env.homedir)
  }, [navigate])

  const refresh = useCallback(() => {
    if (currentPath) doScan(currentPath)
  }, [currentPath, doScan])

  const handleOpenDirectory = useCallback(async () => {
    const dir = await window.freeit.dialog.openDirectory()
    if (dir) navigate(dir)
  }, [navigate])

  // Re-scan when filter options change
  useEffect(() => {
    if (currentPath) doScan(currentPath)
  }, [includeFiles, includeHidden, noCrossDevice]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'r') {
        e.preventDefault()
        refresh()
      }
      if (e.key === 'Backspace' && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        goBack()
      }
      if (e.metaKey && e.shiftKey && e.key === 'o') {
        e.preventDefault()
        handleOpenDirectory()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [refresh, goBack, handleOpenDirectory])

  return (
    <div className="flex flex-col h-full">
      {/* ── Title bar ── */}
      <div
        className="drag-region flex items-center shrink-0"
        style={{
          height: 'var(--titlebar-h)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-dim)',
          paddingLeft: 80,
          paddingRight: 16,
          gap: 6,
        }}
      >
        {/* Nav buttons */}
        <div className="no-drag flex items-center gap-0.5">
          <button
            onClick={goBack}
            disabled={history.length === 0}
            className="btn-icon"
            title="Retour (Backspace)"
          >
            <ArrowLeft size={15} />
          </button>
          <button onClick={goHome} className="btn-icon" title="Accueil">
            <Home size={14} />
          </button>
          <button onClick={refresh} disabled={!currentPath} className="btn-icon" title="Rafraîchir (⌘R)">
            <RotateCw size={13} />
          </button>
        </div>

        <div className="sep" />

        {/* Breadcrumb / title */}
        <div className="no-drag flex-1 min-w-0">
          {currentPath ? (
            <Breadcrumb currentPath={currentPath} onNavigate={navigate} />
          ) : (
            <span className="text-xs font-medium" style={{ color: 'var(--text-dim)' }}>
              freeit
            </span>
          )}
        </div>

        {/* Total size badge (mode explore uniquement) */}
        {isExploreMode && result && (
          <div
            className="no-drag mono text-[10px] px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
          >
            {formatSize(result.size)}
          </div>
        )}
      </div>

      {/* ── Toolbar ── */}
      <Toolbar
        includeHidden={includeHidden}
        setIncludeHidden={setIncludeHidden}
        includeFiles={includeFiles}
        setIncludeFiles={setIncludeFiles}
        noCrossDevice={noCrossDevice}
        setNoCrossDevice={setNoCrossDevice}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onOpenDirectory={handleOpenDirectory}
      />

      {/* ── Scan progress (mode explore uniquement) ── */}
      {isExploreMode && scanning && (
        <ScanProgress
          scanned={progress?.scanned}
          total={progress?.total}
          currentPath={progress?.currentPath}
          onCancel={cancel}
        />
      )}

      {/* ── Error (mode explore uniquement ; les outils gèrent leurs erreurs en interne) ── */}
      {isExploreMode && error && (
        <div
          className="px-4 py-2 text-xs"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-size-huge)' }}
        >
          Erreur : {error}
        </div>
      )}

      {/* ── Welcome screen (mode explore, aucun dossier choisi) ── */}
      {isExploreMode && !currentPath && !scanning && (
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
          <div className="text-center">
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              freeit
            </h1>
            <p className="text-sm mt-2" style={{ color: 'var(--text-dim)' }}>
              Explore et libère ton espace disque
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleOpenDirectory} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
              Choisir un dossier
            </button>
            <button onClick={goHome} className="btn-ghost">
              Mon dossier personnel
            </button>
          </div>
          <span className="mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
            ⌘⇧O ouvrir &nbsp;·&nbsp; ⌘R rafraîchir &nbsp;·&nbsp; ⌫ retour
          </span>
        </div>
      )}

      {/* ── Mode explore — rendu des vues du scan ── */}
      {isExploreMode && result && result.children.length > 0 && (
        viewMode === 'table' ? (
          <Explorer
            entries={result.children}
            parentSize={result.size}
            searchQuery={searchQuery}
            onNavigate={navigate}
            onRefresh={refresh}
          />
        ) : (
          <Treemap
            entries={result.children}
            parentSize={result.size}
            onNavigate={navigate}
            onRefresh={refresh}
          />
        )
      )}

      {/* ── Mode doublons ── */}
      {viewMode === 'dupes' && (
        <DupesView
          defaultPath={currentPath ?? window.freeit.env.homedir}
          className="flex-1 overflow-auto"
        />
      )}

      {/* ── Mode fichiers anciens ── */}
      {viewMode === 'stale' && (
        <StaleView
          defaultPath={currentPath ?? window.freeit.env.homedir}
          className="flex-1 overflow-auto"
        />
      )}

      {/* ── Mode nettoyage (presets junk) ── */}
      {viewMode === 'clean' && (
        <CleanView className="flex-1 overflow-auto" />
      )}

      {/* ── Status bar (mode explore uniquement) ── */}
      {isExploreMode && result && result.children.length > 0 && (
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: 28,
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-dim)',
            fontSize: 10,
            color: 'var(--text-dim)',
          }}
        >
          <span>
            {result.children.length} éléments
            {searchQuery && ` (filtré)`}
          </span>
          <span className="mono truncate ml-4">{currentPath}</span>
        </div>
      )}
    </div>
  )
}
