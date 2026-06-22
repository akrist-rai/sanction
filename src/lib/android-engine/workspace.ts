// Android workspace management — localStorage + Tauri FS (no Go engine needed)

import { exists, mkdir } from '@tauri-apps/plugin-fs'

const WS_KEY = 'sanction-workspace-path'
const RECENT_KEY = 'sanction-recent-workspaces'
const MAX_RECENT = 10

// Default workspace on Android: user's sdcard Documents folder
function defaultWorkspacePath(): string {
  return '/sdcard/Documents/SANCTION'
}

export async function handleWorkspaceEnsureDefault() {
  const path = defaultWorkspacePath()
  try {
    if (!(await exists(path))) {
      await mkdir(path, { recursive: true })
    }
    return { success: true, path }
  } catch (e: any) {
    // Fallback to app-accessible path
    return { success: false, error: e?.message, path }
  }
}

export async function handleWorkspaceGet() {
  const path = localStorage.getItem(WS_KEY)
  return { path: path ?? null }
}

export async function handleWorkspaceSave(workspacePath: string) {
  localStorage.setItem(WS_KEY, workspacePath)
  return { success: true }
}

export async function handleWorkspaceRecentGet(): Promise<string[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export async function handleWorkspaceRecentAdd(workspacePath: string) {
  const recent = await handleWorkspaceRecentGet()
  const filtered = recent.filter(p => p !== workspacePath)
  filtered.unshift(workspacePath)
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)))
  return { success: true }
}
