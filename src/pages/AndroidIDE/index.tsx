// @ts-nocheck
import './mobile.css'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import MobileLayout, { TabId } from '../../mobile/MobileLayout'
import GraphPanel, { GraphNode, GraphEdge, GraphGroup } from '../../mobile/GraphPanel'
import EditorPanel from '../../mobile/EditorPanel'
import FilesPanel from '../../mobile/FilesPanel'
import GitPanel from '../../mobile/GitPanel'
import MorePanel from '../../mobile/MorePanel'
import FileFinderModal from '../../features/modals/FileFinderModal'
import { api } from '../../lib/api'
import { detectLang } from '../../lib/engine'
import { useEditorStore } from '../../stores/editorStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'
import { useGitStore } from '../../stores/gitStore'
import { useTerminalStore } from '../../stores/terminalStore'

// ── Persistence ────────────────────────────────────────────
const LS_KEY = 'sanction-ide-v1'

function loadSaved(): { nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[] } {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (d.nodes?.length) return { nodes: d.nodes, edges: d.edges || [], groups: d.groups || [] }
    }
  } catch {}
  return { nodes: [], edges: [], groups: [] }
}

// ── Helpers ────────────────────────────────────────────────
function getFileColor(name: string): string {
  const ext = (name || '').split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    js: '#f2c12e', mjs: '#f2c12e', jsx: '#f2c12e', ts: '#4285f4', tsx: '#4285f4',
    py: '#28f1c3', go: '#89ddff', rs: '#ff8080', c: '#ff8080', cpp: '#ff8080',
    md: '#c792ea', json: '#ffc410', css: '#89b4fa', html: '#e06c75', sh: '#10b981',
  }
  return map[ext ?? ''] ?? '#888'
}

function guessType(name: string, code: string): string {
  if (/^(index|main|app)\.(j|t)sx?$/.test(name)) return 'entry'
  if (/\bclass\s+\w+/.test(code)) return 'class'
  if (/\.(md|txt)$/.test(name)) return 'doc'
  if (/\.(jsx|tsx)$/.test(name) || /useState|useEffect|React/.test(code)) return 'module'
  return 'function'
}

const TYPE_THEME: Record<string, number> = { entry: 0, function: 5, class: 6, module: 4, doc: 11 }

// ══════════════════════════════════════════════════════════
//  ANDROID IDE — Main Component
// ══════════════════════════════════════════════════════════

export default function AndroidIDE() {
  // ── Tab state ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('graph')

  // ── Graph state ───────────────────────────────────────
  const _saved = useMemo(() => loadSaved(), [])
  const nodesRef  = useRef<GraphNode[]>(_saved.nodes)
  const edgesRef  = useRef<GraphEdge[]>(_saved.edges)
  const groupsRef = useRef<GraphGroup[]>(_saved.groups)
  const saveTimerRef = useRef(null)
  const [, _setRt] = useState(0)
  const forceRender = useCallback(() => _setRt(t => t + 1), [])
  const wakePhysicsRef = useRef<() => void>(() => {})

  // ── Stores ────────────────────────────────────────────
  const {
    openTabs, openTab, closeTab, activeTabId, setActiveTabId,
    globalEditorPalette,
  } = useEditorStore()

  const {
    explorerRoot, setExplorerRoot, explorerRefreshKey, triggerRefresh,
  } = useWorkspaceStore()

  const { themeMode } = useUIStore()
  const { setGitStatus, setGitLog, setGitBranch } = useGitStore()
  const { setTermCwd } = useTerminalStore()

  // ── Engine URL for WebSocket ──────────────────────────
  const [wsUrl, setWsUrl] = useState('ws://127.0.0.1:49373')

  // ── Modals ────────────────────────────────────────────
  const [showCmd, setShowCmd] = useState(false)
  const [showFileFinder, setShowFileFinder] = useState(false)

  // ── Persistence: auto-save graph to localStorage ──────
  useEffect(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          nodes: nodesRef.current,
          edges: edgesRef.current,
          groups: groupsRef.current,
        }))
      } catch {}
    }, 800)
  })

  // ── Init: workspace folder + engine URL ──────────────
  useEffect(() => {
    ;(async () => {
      // Resolve engine WebSocket URL
      if (api?.engine?.wsUrl) setWsUrl(api.engine.wsUrl)

      if (!api?.fs) return
      const [defaultRes, savedRes] = await Promise.all([
        api.fs.ensureDefaultWorkspace?.() ?? Promise.resolve(null),
        api.fs.getWorkspace?.() ?? Promise.resolve(null),
      ])
      const folder = savedRes?.path || (defaultRes?.success ? defaultRes.path : null)
      if (!folder) return
      setExplorerRoot(folder)
      ;(window as any).__forbiddenCwd = folder
      setTermCwd(folder)
    })()
  }, [])

  // ── Init git status when cwd is set ──────────────────
  useEffect(() => {
    if (!explorerRoot || !api?.git) return
    ;(async () => {
      try {
        const [status, log, branch] = await Promise.all([
          api.git.status(explorerRoot),
          api.git.log(explorerRoot),
          api.git.branch(explorerRoot),
        ])
        setGitStatus(status)
        setGitLog(log)
        setGitBranch(branch)
      } catch {}
    })()
  }, [explorerRoot])

  // ── Open node in editor ───────────────────────────────
  const openNodeInEditor = useCallback(async (id: string) => {
    const node = nodesRef.current.find(n => n.id === id)
    if (!node) return
    // Lazy-load code if not yet loaded
    if (!node.code && node.filepath && api?.fs) {
      const res = await api.fs.readFile(node.filepath).catch(() => null)
      if (res?.content !== undefined) {
        node.code = res.content
        forceRender()
      }
    }
    openTab(id)
    setActiveTabId(id)
    setActiveTab('editor')
  }, [openTab, setActiveTabId, forceRender])

  // ── Open file from FileExplorer ───────────────────────
  const handleOpenFile = useCallback(async (fileNode: any) => {
    const filepath = fileNode.path || fileNode.filepath || fileNode.fullPath
    const name = fileNode.name || fileNode.label || filepath.split('/').pop()
    if (!filepath) return

    // Check if already a node
    const existing = nodesRef.current.find(n => n.filepath === filepath)
    if (existing) {
      openNodeInEditor(existing.id)
      return
    }

    // Create new node from file
    let code = ''
    if (api?.fs) {
      const res = await api.fs.readFile(filepath).catch(() => null)
      if (res?.content !== undefined) code = res.content
    }

    const type = guessType(name, code)
    const newNode: GraphNode = {
      id: 'f' + Date.now(),
      label: name,
      filepath,
      type,
      isMain: false,
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 400,
      vx: 0, vy: 0,
      themeIdx: TYPE_THEME[type] ?? 1,
      classId: null,
      code,
      modified: false,
    }

    nodesRef.current = [...nodesRef.current, newNode]
    forceRender()
    wakePhysicsRef.current()
    openNodeInEditor(newNode.id)
  }, [openNodeInEditor, forceRender])

  // ── Code change ───────────────────────────────────────
  const handleCodeChange = useCallback((id: string, code: string) => {
    nodesRef.current = nodesRef.current.map(n =>
      n.id === id ? { ...n, code, modified: true } : n
    )
  }, [])

  // ── Save file ─────────────────────────────────────────
  const handleSave = useCallback((id: string) => {
    nodesRef.current = nodesRef.current.map(n =>
      n.id === id ? { ...n, modified: false } : n
    )
    forceRender()
  }, [forceRender])

  // ── Folder change ─────────────────────────────────────
  const handleRootChange = useCallback((folder: string) => {
    setExplorerRoot(folder)
    ;(window as any).__forbiddenCwd = folder
    setTermCwd(folder)
    api?.fs?.saveWorkspace?.(folder)
    api?.fs?.addRecentWorkspace?.(folder)
    // Refresh git
    if (api?.git) {
      Promise.all([
        api.git.status(folder),
        api.git.log(folder),
        api.git.branch(folder),
      ]).then(([status, log, branch]) => {
        setGitStatus(status)
        setGitLog(log)
        setGitBranch(branch)
      }).catch(() => {})
    }
  }, [setExplorerRoot, setTermCwd, setGitStatus, setGitLog, setGitBranch])

  // ── Tab close ─────────────────────────────────────────
  const handleCloseTab = useCallback((id: string) => {
    closeTab(id)
  }, [closeTab])

  // ── Scan imports ──────────────────────────────────────
  const handleScanImports = useCallback(async (rootPath: string) => {
    if (!api?.fs) return
    try {
      const result = await api.fs.scanImports(rootPath)
      if (result?.nodes) {
        nodesRef.current = result.nodes.map((n: any) => ({
          id: n.id, label: n.label, filepath: n.filepath,
          type: n.type || 'function', isMain: n.is_main || false,
          x: n.x || (Math.random() - 0.5) * 800,
          y: n.y || (Math.random() - 0.5) * 600,
          vx: 0, vy: 0,
          themeIdx: n.theme_idx ?? (TYPE_THEME[n.type] ?? 1),
          classId: n.class_id ?? null,
          code: '', modified: false,
        }))
        edgesRef.current = (result.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target,
        }))
        forceRender()
        wakePhysicsRef.current()
      }
    } catch {}
  }, [forceRender])

  // ── Derived ───────────────────────────────────────────
  const activeEditorNode = nodesRef.current.find(n => n.id === activeTabId) ?? null
  const folderName = explorerRoot
    ? explorerRoot.split('/').filter(Boolean).pop() ?? explorerRoot
    : ''

  return (
    <>
      <MobileLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        folderName={folderName}
        onOpenFolder={async () => {
          if (!api?.dialog) return
          const folder = await api.dialog.openFolder()
          if (folder) handleRootChange(folder)
        }}
        onSearch={() => setShowCmd(true)}
      >
        {/* Graph Panel */}
        <div className="m-panel" data-active={activeTab === 'graph'}>
          <GraphPanel
            isActive={activeTab === 'graph'}
            nodesRef={nodesRef}
            edgesRef={edgesRef}
            groupsRef={groupsRef}
            forceRender={forceRender}
            wakePhysicsRef={wakePhysicsRef}
            onOpenNode={openNodeInEditor}
            onAddFiles={async () => {
              if (!api?.dialog) return
              const folder = await api.dialog.openFolder()
              if (folder) {
                handleRootChange(folder)
                handleScanImports(folder)
              }
            }}
          />
        </div>

        {/* Editor Panel */}
        <div className="m-panel" data-active={activeTab === 'editor'}>
          <EditorPanel
            nodes={nodesRef.current}
            onCodeChange={handleCodeChange}
            onSave={handleSave}
            onOpenTab={openNodeInEditor}
            onCloseTab={handleCloseTab}
          />
        </div>

        {/* Files Panel */}
        <div className="m-panel" data-active={activeTab === 'files'}>
          <FilesPanel
            rootPath={explorerRoot}
            onOpenFile={handleOpenFile}
            onRootChange={handleRootChange}
            onScanImports={handleScanImports}
            onTerminalCd={(cwd) => {
              setTermCwd(cwd)
              ;(window as any).__forbiddenCwd = cwd
            }}
          />
        </div>

        {/* Git Panel */}
        <div className="m-panel" data-active={activeTab === 'git'}>
          <GitPanel
            cwd={explorerRoot}
            onOpenFile={async (filepath: string) => {
              const name = filepath.split('/').pop() ?? filepath
              await handleOpenFile({ path: filepath, name })
            }}
          />
        </div>

        {/* More Panel */}
        <div className="m-panel" data-active={activeTab === 'more'}>
          <MorePanel
            activeNode={activeEditorNode}
            cwd={explorerRoot}
            wsUrl={wsUrl}
            isActive={activeTab === 'more'}
          />
        </div>
      </MobileLayout>

      {/* File finder */}
      {showCmd && (
        <div className="m-modal-backdrop" onPointerDown={() => setShowCmd(false)}>
          <div onPointerDown={e => e.stopPropagation()}>
            <FileFinderModal
              isOpen={showCmd}
              onClose={() => setShowCmd(false)}
              onOpenFile={(file) => { setShowCmd(false); handleOpenFile(file) }}
              rootPath={explorerRoot}
            />
          </div>
        </div>
      )}
    </>
  )
}
