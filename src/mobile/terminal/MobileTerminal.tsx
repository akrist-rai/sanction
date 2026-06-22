import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  wsUrl: string
  cwd: string
  isActive: boolean
}

interface Span {
  text: string
  color: string
  bold: boolean
  bg: string
}

interface Line {
  spans: Span[]
}

// 16-color ANSI palette (terminal standard)
const ANSI_COLORS = [
  '#1a1a1a', '#ff5252', '#69ff47', '#ffd740',
  '#448aff', '#e040fb', '#18ffff', '#e0e0e0',
  '#757575', '#ff5252', '#69ff47', '#ffd740',
  '#448aff', '#ea80fc', '#84ffff', '#ffffff',
]

function parseAnsi(raw: string): Line[] {
  const lines: Line[] = []
  let currentLine: Span[] = []
  let fg = '#c8ffc8'
  let bg = 'transparent'
  let bold = false
  let i = 0

  const pushChar = (ch: string) => {
    const last = currentLine[currentLine.length - 1]
    if (last && last.color === fg && last.bg === bg && last.bold === bold) {
      last.text += ch
    } else {
      currentLine.push({ text: ch, color: fg, bg, bold })
    }
  }

  const pushNewLine = () => {
    lines.push({ spans: currentLine })
    currentLine = []
  }

  while (i < raw.length) {
    if (raw[i] === '\x1b' && raw[i + 1] === '[') {
      // CSI sequence
      i += 2
      let seq = ''
      while (i < raw.length && !/[A-Za-z]/.test(raw[i])) seq += raw[i++]
      const cmd = raw[i++]

      if (cmd === 'm') {
        // SGR — color/style
        const parts = seq.split(';').map(Number)
        for (let pi = 0; pi < parts.length; pi++) {
          const n = parts[pi]
          if (n === 0 || seq === '') { fg = '#c8ffc8'; bg = 'transparent'; bold = false }
          else if (n === 1) bold = true
          else if (n === 2) bold = false
          else if (n >= 30 && n <= 37) fg = ANSI_COLORS[n - 30]
          else if (n === 39) fg = '#c8ffc8'
          else if (n >= 40 && n <= 47) bg = ANSI_COLORS[n - 40]
          else if (n === 49) bg = 'transparent'
          else if (n >= 90 && n <= 97) fg = ANSI_COLORS[n - 90 + 8]
          else if (n >= 100 && n <= 107) bg = ANSI_COLORS[n - 100 + 8]
          else if (n === 38 && parts[pi + 1] === 5) { fg = ANSI_COLORS[parts[pi + 2] % 16] ?? fg; pi += 2 }
          else if (n === 48 && parts[pi + 1] === 5) { bg = ANSI_COLORS[parts[pi + 2] % 16] ?? bg; pi += 2 }
        }
      } else if (cmd === 'J') {
        // Clear screen
        lines.length = 0
        currentLine = []
      }
      // All other CSI sequences: ignore
    } else if (raw[i] === '\r') {
      i++
    } else if (raw[i] === '\n') {
      pushNewLine()
      i++
    } else if (raw[i] === '\x08') {
      // Backspace
      const last = currentLine[currentLine.length - 1]
      if (last && last.text.length > 1) last.text = last.text.slice(0, -1)
      else if (last) currentLine.pop()
      i++
    } else if (raw[i] === '\x07') {
      // Bell — ignore
      i++
    } else {
      pushChar(raw[i++])
    }
  }
  if (currentLine.length > 0) lines.push({ spans: currentLine })
  return lines
}

const MAX_LINES = 3000
const TERM_COLS = 80
const TERM_ROWS = 30

export default function MobileTerminal({ wsUrl, cwd, isActive }: Props) {
  const wsRef = useRef<WebSocket | null>(null)
  const linesRef = useRef<Line[]>([])
  const [, setTick] = useState(0)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pendingRef = useRef('')
  const ctrlModeRef = useRef(false)

  const rerender = useCallback(() => setTick(t => t + 1), [])

  const appendOutput = useCallback((text: string) => {
    const newLines = parseAnsi(text)
    if (newLines.length === 0) return
    const all = linesRef.current
    if (all.length > 0 && newLines.length > 0) {
      // Merge first new line into last existing
      const lastLine = all[all.length - 1]
      const firstNew = newLines.shift()!
      lastLine.spans.push(...firstNew.spans)
    }
    all.push(...newLines)
    if (all.length > MAX_LINES) all.splice(0, all.length - MAX_LINES)
    linesRef.current = [...all]
    rerender()
  }, [rerender])

  useEffect(() => {
    if (!isActive) return

    const sessionId = Math.random().toString(36).slice(2)
    const url = `${wsUrl}/ws/pty?id=${sessionId}&cols=${TERM_COLS}&rows=${TERM_ROWS}&cwd=${encodeURIComponent(cwd || '/sdcard')}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onmessage = (evt) => {
      const text = evt.data instanceof ArrayBuffer
        ? new TextDecoder().decode(evt.data)
        : evt.data
      appendOutput(text)
    }

    ws.onclose = () => {
      appendOutput('\r\n\x1b[33m[session closed]\x1b[0m\r\n')
    }

    ws.onerror = () => {
      appendOutput('\r\n\x1b[31m[connection error — is the engine running?]\x1b[0m\r\n')
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [isActive, wsUrl, cwd])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [linesRef.current.length])

  const send = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: text }))
    }
  }, [])

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const val = ta.value
    const added = val.slice(pendingRef.current.length)
    pendingRef.current = val
    if (added) send(added)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      pendingRef.current = ''
      e.currentTarget.value = ''
      send('\r')
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      const ta = e.currentTarget
      ta.value = ta.value.slice(0, -1)
      pendingRef.current = ta.value
      send('\x7f')
    }
  }

  const softKey = (seq: string) => {
    if (seq === 'TAB') send('\t')
    else if (seq === 'UP') send('\x1b[A')
    else if (seq === 'DOWN') send('\x1b[B')
    else if (seq === 'LEFT') send('\x1b[D')
    else if (seq === 'RIGHT') send('\x1b[C')
    else if (seq === 'CTRL_C') send('\x03')
    else if (seq === 'CTRL_D') send('\x04')
    else if (seq === 'CTRL_L') { send('\x0c'); linesRef.current = []; rerender() }
    else send(seq)
    inputRef.current?.focus()
  }

  const focusInput = () => inputRef.current?.focus()

  return (
    <div className="m-term" onClick={focusInput}>
      {/* Hidden input capture */}
      <textarea
        ref={inputRef}
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '1px',
          height: '1px',
          opacity: 0,
        }}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />

      {/* Output */}
      <div ref={outputRef} className="m-term-output">
        {linesRef.current.length === 0 ? (
          <span style={{ color: 'rgba(200,255,200,0.3)' }}>
            {wsUrl ? 'Connecting...' : 'No engine URL'}
          </span>
        ) : (
          linesRef.current.map((line, li) => (
            <div key={li}>
              {line.spans.map((sp, si) => (
                <span
                  key={si}
                  style={{
                    color: sp.color,
                    background: sp.bg !== 'transparent' ? sp.bg : undefined,
                    fontWeight: sp.bold ? 700 : undefined,
                  }}
                >
                  {sp.text}
                </span>
              ))}
            </div>
          ))
        )}
        {/* Blinking cursor */}
        <span style={{ animation: 'blink 1s step-end infinite', color: '#00e676' }}>▋</span>
      </div>

      {/* Soft keyboard row */}
      <div className="m-term-soft-keys">
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('TAB') }}>Tab</button>
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('UP') }}>↑</button>
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('DOWN') }}>↓</button>
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('LEFT') }}>←</button>
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('RIGHT') }}>→</button>
        <button className="m-term-key danger" onPointerDown={e => { e.preventDefault(); softKey('CTRL_C') }}>^C</button>
        <button className="m-term-key danger" onPointerDown={e => { e.preventDefault(); softKey('CTRL_D') }}>^D</button>
        <button className="m-term-key" onPointerDown={e => { e.preventDefault(); softKey('CTRL_L') }}>CLR</button>
      </div>
    </div>
  )
}
