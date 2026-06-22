// Android terminal — WebSocket bridge to the Go engine if running,
// or falls back to a command-by-command Tauri shell executor.
// The Go engine binary (libsanction_engine.so) is still shipped in the APK
// as a best-effort sidecar. This module also provides a graceful fallback.

import { Command } from '@tauri-apps/plugin-shell'

// ── Engine health check ────────────────────────────────────────

let _engineUrl: string | null = null
let _wsUrl: string | null = null

export async function probeEngine(baseUrl = 'http://127.0.0.1:49373', timeoutMs = 3000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/status`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) {
      _engineUrl = baseUrl
      _wsUrl = baseUrl.replace(/^http/, 'ws')
      return true
    }
  } catch {}
  return false
}

export function getEngineUrl(): string | null { return _engineUrl }
export function getWsUrl(): string | null { return _wsUrl }

// ── Tauri shell exec (fallback when engine not running) ─────────

export async function execCommand(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const output = await Command.create('sh', ['-c', cmd], { cwd }).execute()
    return { stdout: output.stdout ?? '', stderr: output.stderr ?? '' }
  } catch (e: any) {
    return { stdout: '', stderr: String(e?.message ?? e) }
  }
}

// ── PTY WebSocket URL builder (uses engine if available) ────────

export function buildPtyWsUrl(
  engineWsUrl: string,
  id: string,
  cols: number,
  rows: number,
  cwd: string,
): string {
  const p = new URLSearchParams({ id, cols: String(cols), rows: String(rows), cwd })
  return `${engineWsUrl}/ws/pty?${p}`
}
