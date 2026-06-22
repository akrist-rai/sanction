import { useRef, useEffect, useCallback, useState, MutableRefObject, memo } from 'react'
import GraphMinimap from '../features/graph/GraphMinimap'
import { convexHull } from '../features/graph/convexHull'
import { useUIStore } from '../stores/uiStore'

export interface GraphNode {
  id: string
  label: string
  filepath: string
  type: string
  isMain: boolean
  x: number
  y: number
  vx: number
  vy: number
  themeIdx: number
  classId: string | null
  code: string
  modified: boolean
}

export interface GraphEdge {
  id: string
  source: string
  target: string
}

export interface GraphGroup {
  id: string
  name: string
  color: string
  nodeIds: string[]
}

interface Props {
  isActive: boolean
  nodesRef: MutableRefObject<GraphNode[]>
  edgesRef: MutableRefObject<GraphEdge[]>
  groupsRef: MutableRefObject<GraphGroup[]>
  forceRender: () => void
  wakePhysicsRef: MutableRefObject<() => void>
  onOpenNode: (id: string) => void
  onAddFiles: () => void
}

// ── Simple touch-optimized node (replaces desktop MangaNode) ─────────────────

const NODE_COLORS: Record<string, string> = {
  entry: '#ff2a38', function: '#00e5ff', class: '#ccff00',
  module: '#a78bfa', doc: '#f59e0b', default: '#888',
}

interface MobileNodeProps {
  node: GraphNode
  brutal: boolean
  onRegisterEl: (id: string, el: HTMLDivElement) => void
  onUnregisterEl: (id: string) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
}

const MobileNode = memo(function MobileNode({
  node, brutal, onRegisterEl, onUnregisterEl, onPointerDown, onPointerMove, onPointerUp,
}: MobileNodeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const color = NODE_COLORS[node.type] ?? NODE_COLORS.default
  const W = node.isMain ? 108 : 90
  const H = node.isMain ? 44 : 36

  useEffect(() => {
    if (ref.current) onRegisterEl(node.id, ref.current)
    return () => onUnregisterEl(node.id)
  }, [node.id])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        width: W, height: H,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: brutal ? '#111' : '#0d0d0d',
        border: `${node.isMain ? 2 : 1.5}px solid ${color}`,
        borderRadius: brutal ? 0 : 6,
        boxShadow: `0 0 ${node.isMain ? 12 : 6}px ${color}55`,
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        padding: '0 8px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {node.modified && (
        <span style={{
          position: 'absolute', top: 3, right: 5,
          width: 5, height: 5, borderRadius: '50%',
          background: '#ff2a38',
        }} />
      )}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: node.isMain ? 11 : 10,
        color,
        fontWeight: node.isMain ? 700 : 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}>
        {node.label}
      </span>
    </div>
  )
})

export default function GraphPanel({
  isActive, nodesRef, edgesRef, groupsRef,
  forceRender, wakePhysicsRef, onOpenNode, onAddFiles,
}: Props) {
  const { themeMode } = useUIStore()
  const brutal = themeMode === 'brutal'

  // Canvas transform (pan + zoom)
  const transformRef = useRef({ x: 0, y: 0, scale: 1 })
  const [transformTick, setTransformTick] = useState(0)
  const setTransform = useCallback((fn: (t: typeof transformRef.current) => typeof transformRef.current) => {
    transformRef.current = fn(transformRef.current)
    setTransformTick(t => t + 1)
  }, [])

  // Multi-touch pointer tracking
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastPinchDistRef = useRef<number | null>(null)
  const isPanningRef = useRef(false)
  const lastPanPosRef = useRef({ x: 0, y: 0 })

  // Node dragging
  const draggingNodeRef = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null)
  const nodeElsRef = useRef<Map<string, HTMLDivElement>>(new Map())

  // Double-tap detection per node
  const lastTapRef = useRef<{ id: string; time: number } | null>(null)

  // Long-press detection
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressNodeRef = useRef<string | null>(null)
  const [contextNode, setContextNode] = useState<string | null>(null)
  const [showSheet, setShowSheet] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  // ── Render tick for edge SVG ─────────────────────────
  const [, setEdgeTick] = useState(0)
  const forceEdgeRender = useCallback(() => setEdgeTick(t => t + 1), [])

  const registerNodeEl = useCallback((id: string, el: HTMLDivElement) => {
    nodeElsRef.current.set(id, el)
  }, [])
  const unregisterNodeEl = useCallback((id: string) => {
    nodeElsRef.current.delete(id)
  }, [])

  // ── Physics simulation ───────────────────────────────
  useEffect(() => {
    if (!isActive) return
    let rafId: number
    let idleFrames = 0
    let lastRenderMs = 0
    let wasDragging = false

    const tick = (now: number) => {
      const isDragging = !!draggingNodeRef.current
      const shouldRender = now - lastRenderMs >= 1000 / 30
      let updated = false
      const nds = nodesRef.current
      const eds = edgesRef.current

      const nodeMap = new Map<string, GraphNode>()
      for (let i = 0; i < nds.length; i++) nodeMap.set(nds[i].id, nds[i])

      const adj = new Map<string, string[]>()
      for (let i = 0; i < eds.length; i++) {
        const { source, target } = eds[i]
        if (!adj.has(source)) adj.set(source, [])
        if (!adj.has(target)) adj.set(target, [])
        adj.get(source)!.push(target)
        adj.get(target)!.push(source)
      }

      let mainX = 0, mainY = 0
      for (let i = 0; i < nds.length; i++) {
        if (nds[i].isMain) { mainX = nds[i].x; mainY = nds[i].y; break }
      }

      // Repulsion
      for (let i = 0; i < nds.length; i++) {
        for (let j = i + 1; j < nds.length; j++) {
          const dx = nds[j].x - nds[i].x, dy = nds[j].y - nds[i].y
          const distSq = dx * dx + dy * dy || 1
          const dist = Math.sqrt(distSq)
          const force = 7000 / distSq
          nds[i].vx -= (dx / dist) * force; nds[i].vy -= (dy / dist) * force
          nds[j].vx += (dx / dist) * force; nds[j].vy += (dy / dist) * force
        }
      }

      // Springs
      for (let i = 0; i < eds.length; i++) {
        const src = nodeMap.get(eds[i].source), tgt = nodeMap.get(eds[i].target)
        if (!src || !tgt) continue
        const dx = tgt.x - src.x, dy = tgt.y - src.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 150) * 0.12
        src.vx += (dx / dist) * force; src.vy += (dy / dist) * force
        tgt.vx -= (dx / dist) * force; tgt.vy -= (dy / dist) * force
      }

      // Gravity
      for (let i = 0; i < nds.length; i++) {
        const n = nds[i]
        if (n.isMain) {
          n.vx += (0 - n.x) * 0.006; n.vy += (0 - n.y) * 0.006
        } else {
          n.vx += (mainX - n.x) * 0.014; n.vy += (mainY - n.y) * 0.014
        }
      }

      // Integrate + dampen
      for (let i = 0; i < nds.length; i++) {
        const n = nds[i]
        n.vx *= 0.80; n.vy *= 0.80
        n.x += n.vx; n.y += n.vy
        if (Math.abs(n.vx) > 0.05 || Math.abs(n.vy) > 0.05) updated = true
      }

      // Dragged node pin + neighbor impulse
      if (isDragging) {
        const d = draggingNodeRef.current!
        const dn = nodeMap.get(d.id)
        if (dn) {
          const moveX = d.x - dn.x, moveY = d.y - dn.y
          dn.x = d.x; dn.y = d.y; dn.vx = 0; dn.vy = 0
          updated = true
          const neighbors = adj.get(d.id) || []
          for (let k = 0; k < neighbors.length; k++) {
            const nb = nodeMap.get(neighbors[k])
            if (nb) { nb.vx += moveX * 0.55; nb.vy += moveY * 0.55 }
          }
        }
      }

      // Direct DOM update for 60fps
      const t = transformRef.current
      const els = nodeElsRef.current
      for (let i = 0; i < nds.length; i++) {
        const n = nds[i], el = els.get(n.id)
        if (!el) continue
        const W = n.isMain ? 108 : 90, H = n.isMain ? 44 : 36
        el.style.left = (n.x - W / 2) + 'px'
        el.style.top  = (n.y - H / 2) + 'px'
      }

      if (wasDragging && !isDragging) {
        forceEdgeRender(); lastRenderMs = now
      } else if (updated && shouldRender) {
        forceEdgeRender(); lastRenderMs = now
      }

      idleFrames = updated ? 0 : idleFrames + 1
      wasDragging = isDragging

      if (updated || isDragging || idleFrames < 8) {
        rafId = requestAnimationFrame(tick)
      }
    }

    wakePhysicsRef.current = () => {
      idleFrames = 0
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafId); wakePhysicsRef.current = () => {} }
  }, [isActive])

  // ── Pointer event handlers ───────────────────────────

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const t = transformRef.current
    return {
      x: (clientX - rect.left - t.x) / t.scale,
      y: (clientY - rect.top  - t.y) / t.scale,
    }
  }

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only if tap hit the canvas itself (not a node)
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 1) {
      isPanningRef.current = true
      lastPanPosRef.current = { x: e.clientX, y: e.clientY }
    }
    lastPinchDistRef.current = null
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const ptrs = Array.from(pointersRef.current.values())

    if (ptrs.length === 2) {
      isPanningRef.current = false
      clearLongPress()
      const [p1, p2] = ptrs
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (lastPinchDistRef.current !== null) {
        const delta = dist / lastPinchDistRef.current
        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2
        setTransform(prev => {
          const newScale = Math.max(0.15, Math.min(4, prev.scale * delta))
          const sx = (midX - prev.x) / prev.scale
          const sy = (midY - prev.y) / prev.scale
          return { scale: newScale, x: midX - sx * newScale, y: midY - sy * newScale }
        })
      }
      lastPinchDistRef.current = dist
    } else if (ptrs.length === 1 && isPanningRef.current) {
      const dx = e.clientX - lastPanPosRef.current.x
      const dy = e.clientY - lastPanPosRef.current.y
      // Cancel long press if moved
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) clearLongPress()
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
      lastPanPosRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) lastPinchDistRef.current = null
    if (pointersRef.current.size === 0) isPanningRef.current = false
    clearLongPress()
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Node drag handlers (called from MangaNode via onNodeDrag* props)
  const onNodePointerDown = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation()
    const canvas = toCanvas(e.clientX, e.clientY)
    draggingNodeRef.current = { id, x: canvas.x, y: canvas.y, pointerId: e.pointerId }
    wakePhysicsRef.current()

    // Long press for context menu
    longPressNodeRef.current = id
    longPressTimerRef.current = setTimeout(() => {
      setContextNode(id)
      setShowSheet(true)
      draggingNodeRef.current = null
    }, 500)
  }, [])

  const onNodePointerMove = useCallback((id: string, e: React.PointerEvent) => {
    if (draggingNodeRef.current?.id !== id) return
    const moved = Math.hypot(e.movementX, e.movementY)
    if (moved > 3) clearLongPress()
    const canvas = toCanvas(e.clientX, e.clientY)
    draggingNodeRef.current = { ...draggingNodeRef.current!, x: canvas.x, y: canvas.y }
  }, [])

  const onNodePointerUp = useCallback((id: string, e: React.PointerEvent) => {
    clearLongPress()
    const wasDragging = draggingNodeRef.current?.id === id
    draggingNodeRef.current = null

    if (!wasDragging) {
      // Tap — check double-tap
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.id === id && now - last.time < 300) {
        onOpenNode(id)
        lastTapRef.current = null
      } else {
        lastTapRef.current = { id, time: now }
      }
    }
  }, [onOpenNode])

  // ── Computed ─────────────────────────────────────────
  const t = transformRef.current
  const nodes = nodesRef.current
  const edges = edgesRef.current
  const groups = groupsRef.current

  return (
    <div className="m-graph-canvas" ref={canvasRef}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerUp}
    >
      <div className="m-graph-dither" />

      {/* Node + edge count badge */}
      {nodes.length > 0 && (
        <div className="m-node-count">
          {nodes.length}N · {edges.length}E
        </div>
      )}

      {/* Canvas inner — transforms here */}
      <div
        ref={innerRef}
        className="m-graph-canvas-inner"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, transformOrigin: '0 0' }}
      >
        {/* Group convex hulls */}
        {groups.map(g => {
          const gNodes = nodes.filter(n => g.nodeIds.includes(n.id))
          if (gNodes.length < 2) return null
          const pts = gNodes.map(n => [n.x, n.y] as [number, number])
          const hull = convexHull(pts)
          if (!hull.length) return null
          const d = hull.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + 'Z'
          return (
            <svg key={g.id} style={{ position: 'absolute', inset: '-2000px', pointerEvents: 'none', overflow: 'visible' }}>
              <path d={d} fill={g.color + '18'} stroke={g.color + '55'} strokeWidth={2} strokeDasharray="6 3" />
            </svg>
          )
        })}

        {/* Edge SVG */}
        <svg
          style={{ position: 'absolute', inset: '-2000px', pointerEvents: 'none', overflow: 'visible' }}
          width={1} height={1}
        >
          {edges.map(e => {
            const src = nodes.find(n => n.id === e.source)
            const tgt = nodes.find(n => n.id === e.target)
            if (!src || !tgt) return null
            const mx = (src.x + tgt.x) / 2
            const my = (src.y + tgt.y) / 2 - 30
            return (
              <path
                key={e.id}
                d={`M${src.x},${src.y} Q${mx},${my} ${tgt.x},${tgt.y}`}
                stroke="rgba(255,42,56,0.3)"
                strokeWidth={1.5}
                fill="none"
                strokeLinecap="round"
              />
            )
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(n => (
          <MobileNode
            key={n.id}
            node={n}
            brutal={brutal}
            onRegisterEl={registerNodeEl}
            onUnregisterEl={unregisterNodeEl}
            onPointerDown={(e: React.PointerEvent) => onNodePointerDown(n.id, e)}
            onPointerMove={(e: React.PointerEvent) => onNodePointerMove(n.id, e)}
            onPointerUp={(e: React.PointerEvent) => onNodePointerUp(n.id, e)}
          />
        ))}
      </div>

      {/* Minimap (small, bottom-left) */}
      {nodes.length > 0 && (
        <div style={{ position: 'absolute', bottom: 80, left: 12, opacity: 0.6, pointerEvents: 'none' }}>
          <GraphMinimap nodes={nodes} />
        </div>
      )}

      {/* Zoom controls */}
      <div className="m-graph-controls">
        <button className="m-graph-ctrl-btn" onPointerDown={e => { e.preventDefault(); setTransform(p => ({ ...p, scale: Math.min(4, p.scale * 1.25) })) }}>+</button>
        <button className="m-graph-ctrl-btn" onPointerDown={e => { e.preventDefault(); setTransform(p => ({ ...p, scale: Math.max(0.15, p.scale * 0.8) })) }}>−</button>
        <button className="m-graph-ctrl-btn" onPointerDown={e => { e.preventDefault(); setTransform(() => ({ x: 0, y: 0, scale: 1 })) }}>⌂</button>
      </div>

      {/* FAB */}
      <button className="m-fab" onPointerDown={e => { e.preventDefault(); onAddFiles() }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="m-welcome">
          <div className="m-welcome-logo">SANCTION</div>
          <div className="m-welcome-sub">Graph-based mobile IDE</div>
          <button className="m-welcome-btn" onPointerDown={e => { e.preventDefault(); onAddFiles() }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            OPEN FOLDER
          </button>
        </div>
      )}

      {/* Node context bottom sheet */}
      {showSheet && contextNode && (
        <>
          <div className="m-sheet-backdrop" onPointerDown={() => setShowSheet(false)} />
          <div className="m-sheet">
            <div className="m-sheet-handle" />
            <div className="m-sheet-title">
              {nodes.find(n => n.id === contextNode)?.label ?? contextNode}
            </div>
            <button className="m-sheet-item" onPointerDown={() => { setShowSheet(false); onOpenNode(contextNode) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              Open in Editor
            </button>
            <button className="m-sheet-item" style={{ color: 'var(--red)' }} onPointerDown={() => {
              setShowSheet(false)
              const id = contextNode
              nodesRef.current = nodesRef.current.filter(n => n.id !== id)
              edgesRef.current = edgesRef.current.filter(e => e.source !== id && e.target !== id)
              forceRender()
              wakePhysicsRef.current()
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
              Delete Node
            </button>
          </div>
        </>
      )}
    </div>
  )
}
