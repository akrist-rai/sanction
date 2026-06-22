import { useEffect, useState, useCallback } from 'react'
import CodeMirrorEditor from '../components/CodeMirrorEditor'
import { useEditorStore } from '../stores/editorStore'
import { PALETTES } from '../constants/palettes'
import { detectLang } from '../lib/engine'
import { api } from '../lib/api'
import type { RunResult } from '../lib/android-engine/run'
import type { GraphNode } from './GraphPanel'

interface Props {
  nodes: GraphNode[]
  onCodeChange: (id: string, code: string) => void
  onSave: (id: string) => void
  onOpenTab: (id: string) => void
  onCloseTab: (id: string) => void
}

export default function EditorPanel({ nodes, onCodeChange, onSave, onOpenTab, onCloseTab }: Props) {
  const {
    openTabs, activeTabId, setActiveTabId,
    globalEditorPalette,
  } = useEditorStore()

  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState('')
  const [showOutput, setShowOutput] = useState(false)

  // Detect virtual keyboard via visualViewport
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const kbH = window.innerHeight - vv.height - vv.offsetTop
      setKeyboardHeight(kbH > 100 ? kbH : 0)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const activeNode = nodes.find(n => n.id === activeTabId) ?? null
  const palette = globalEditorPalette ?? PALETTES[0]

  const insertText = useCallback((text: string) => {
    document.dispatchEvent(new CustomEvent('sanction:insert-text', { detail: text }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!activeNode) return
    if (activeNode.filepath?.startsWith('/') && api?.fs) {
      await api.fs.writeFile(activeNode.filepath, activeNode.code ?? '')
      onSave(activeNode.id)
    }
  }, [activeNode, onSave])

  const handleRun = useCallback(async () => {
    if (!activeNode || running) return
    const lang = detectLang(activeNode.label || '')
    setRunning(true)
    setShowOutput(true)
    setRunResult(null)
    setRunMsg('Starting…')
    try {
      const { runCode } = await import('../lib/android-engine/run')
      const result = await runCode(lang, activeNode.code ?? '', (msg) => setRunMsg(msg))
      setRunResult(result)
    } catch (e: any) {
      setRunResult({
        logs: [{ type: 'error', val: String(e?.message ?? e), ts: 0 }],
        error: String(e?.message ?? e),
        ms: 0,
      })
    } finally {
      setRunning(false)
      setRunMsg('')
    }
  }, [activeNode, running])

  // Output panel height: 0 when hidden, 220px when showing
  const outputH = showOutput ? 220 : 0

  const toolbarBottom = keyboardHeight > 0
    ? `calc(var(--safe-bottom) + ${keyboardHeight}px)`
    : undefined

  // Editor height: total panel minus tabs(44) minus toolbar(46) minus output
  const editorHeightStyle = keyboardHeight > 0
    ? `calc(100% - 44px - 46px - ${keyboardHeight}px - ${outputH}px)`
    : `calc(100% - 44px - 46px - ${outputH}px)`

  return (
    <div className="m-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div className="m-editor-tabs">
        {openTabs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            NO OPEN FILES
          </div>
        ) : openTabs.map(id => {
          const node = nodes.find(n => n.id === id)
          if (!node) return null
          return (
            <button
              key={id}
              className={`m-editor-tab ${activeTabId === id ? 'active' : ''}`}
              onPointerDown={() => {
                setActiveTabId(id)
                onOpenTab(id)
              }}
            >
              {node.modified && <span className="m-editor-tab-dot" />}
              {node.label}
              <span
                className="m-editor-tab-close"
                onPointerDown={e => { e.stopPropagation(); onCloseTab(id) }}
              >
                ✕
              </span>
            </button>
          )
        })}
      </div>

      {/* Editor body */}
      <div className="m-editor-body" style={{ height: editorHeightStyle }}>
        {activeNode ? (
          <CodeMirrorEditor
            node={activeNode}
            externalPalette={palette}
            onChange={code => onCodeChange(activeNode.id, code)}
            onSave={handleSave}
          />
        ) : (
          <div className="m-editor-empty">
            <div className="m-editor-empty-title">CODE</div>
            <div className="m-editor-empty-hint">Open a file from the graph or files panel</div>
          </div>
        )}
      </div>

      {/* Run output panel */}
      {showOutput && (
        <div className="m-run-output">
          <div className="m-run-header">
            <span className="m-run-header-title">OUTPUT</span>
            {runResult && (
              <span className="m-run-header-time">{runResult.ms}ms</span>
            )}
            <span className="m-run-header-spacer" />
            <button
              className="m-run-close"
              onPointerDown={() => setShowOutput(false)}
            >✕</button>
          </div>
          <div className="m-run-body">
            {running ? (
              <div className="m-run-status">{runMsg || 'Running…'}</div>
            ) : runResult?.logs.length ? (
              runResult.logs.map((log, i) => (
                <div key={i} className={`m-run-log log-${log.type}`}>
                  {log.type === 'error' ? '⚠ ' : log.type === 'return' ? '→ ' : ''}{log.val}
                </div>
              ))
            ) : (
              <div className="m-run-status">No output</div>
            )}
          </div>
        </div>
      )}

      {/* Code toolbar — floats above keyboard */}
      <div
        className="m-code-toolbar"
        style={toolbarBottom ? {
          position: 'fixed',
          bottom: toolbarBottom,
          left: 'var(--safe-left)',
          right: 'var(--safe-right)',
          zIndex: 80,
        } : {
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <button className={`m-tb-key run${running ? ' running' : ''}`} onPointerDown={e => { e.preventDefault(); handleRun() }}>
          {running ? '⏳' : '▶'} RUN
        </button>
        <div className="m-tb-sep" />
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('\t') }}>Tab</button>
        <div className="m-tb-sep" />
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('{') }}>{'{'}</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('}') }}>{'}'}</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('(') }}>{'('}</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText(')') }}>{')'}</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('[') }}>{'['}</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText(']') }}>]</button>
        <div className="m-tb-sep" />
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText(';') }}>;</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('"') }}>"</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText("'") }}>'</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('`') }}>`</button>
        <div className="m-tb-sep" />
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText(':') }}>:</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('=') }}>=</button>
        <button className="m-tb-key" onPointerDown={e => { e.preventDefault(); insertText('=>') }}>=&gt;</button>
        <div className="m-tb-sep" />
        <button className="m-tb-key red" onPointerDown={e => { e.preventDefault(); handleSave() }}>SAVE</button>
      </div>
    </div>
  )
}
