// ══════════════════════════════════════════════════════════════
//  SANCTION ANDROID ENGINE — pure TypeScript, no Go binary
//
//  Stack:
//    File system  → @tauri-apps/plugin-fs  (native Android FS)
//    Git          → isomorphic-git         (pure JS, no binary)
//    Python       → Pyodide WASM           (local bundle → CDN fallback)
//    JS/TS        → WebWorker sandbox
//    AI           → direct provider fetch  (no proxy)
//    Terminal     → Go engine WS (if running) → Tauri shell fallback
// ══════════════════════════════════════════════════════════════

import { invoke } from '@tauri-apps/api/core'
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog'

import {
  handleFsTree, handleFsRead, handleFsWrite, handleFsCreateFile,
  handleFsCreateDir, handleFsDelete, handleFsRename, handleFsCopyFile,
  handleFsCopyFolder, handleFsListAll, handleFsSearch, handleFsScanImports,
  handleFsGetScripts, handleFsFormat,
} from './fs'

import {
  handleGitStatus, handleGitLog, handleGitLogGraph, handleGitBranch,
  handleGitBranches, handleGitStage, handleGitUnstage, handleGitCommit,
  handleGitCheckout, handleGitPush, handleGitPull, handleGitStash,
  handleGitStashPop, handleGitStashList, handleGitInit, handleGitDiscard,
  handleGitDiff, handleGitBlame, handleGitCreateBranch, handleGitDeleteBranch,
  handleGitFetch, handleGitRemoteList, handleGitResetSoft, handleGitAheadBehind,
} from './git'

import { runCode } from './run'

import {
  handleWorkspaceEnsureDefault, handleWorkspaceGet, handleWorkspaceSave,
  handleWorkspaceRecentGet, handleWorkspaceRecentAdd,
} from './workspace'

import { handleAiChat, handleOllamaModels } from './ai'

import { probeEngine, getWsUrl, execCommand, buildPtyWsUrl } from './terminal'

// ── Engine URL (Go sidecar — best-effort on Android) ──────────

let WS = 'ws://127.0.0.1:49373'
let engineAlive = false

async function initEngineConnection(): Promise<void> {
  // Try to get URL from Rust (the Go sidecar may still be running)
  try {
    const url = await invoke<string>('get_engine_url')
    if (url) {
      const wsUrl = url.replace(/^http/, 'ws')
      engineAlive = await probeEngine(url, 2500)
      if (engineAlive) WS = wsUrl
    }
  } catch {}
  if (!engineAlive) {
    engineAlive = await probeEngine('http://127.0.0.1:49373', 2000)
    if (engineAlive) WS = 'ws://127.0.0.1:49373'
  }
}

// ── Menu event bus ─────────────────────────────────────────────

type MenuCallback = (...args: unknown[]) => void
const menuListeners = new Map<string, Set<MenuCallback>>()

// ── Main init ──────────────────────────────────────────────────

export async function initAndroidEngine(): Promise<void> {
  // Fire-and-forget engine probe (doesn't block UI init)
  initEngineConnection().catch(() => {})

  const homeDir: string = await invoke<string>('get_home_dir').catch(() => '/sdcard')

  const electronAPI = {
    platform: 'android',
    homeDir,
    engine: {
      get url()   { return engineAlive ? (WS.replace(/^ws/, 'http')) : 'http://127.0.0.1:49373' },
      get wsUrl() { return WS },
      get host()  { return '127.0.0.1:49373' },
    },

    // ── Code execution ────────────────────────────────────────
    run: {
      code: async (lang: string, code: string, stdin = '') => {
        const result = await runCode(lang, code)
        return result
      },
    },

    runInTerminal: async (ptyId: string, lang: string, code: string, cwd: string) => {
      // If Go engine is alive, delegate to it (PTY injection)
      if (engineAlive) {
        try {
          const res = await fetch(`${WS.replace(/^ws/, 'http')}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ptyId, lang, code, cwd }),
          })
          return res.json()
        } catch {}
      }
      // Fallback: run and return result
      const result = await runCode(lang, code)
      return { success: true, output: result.logs.map(l => l.val).join('\n') }
    },

    // ── PTY WebSocket ─────────────────────────────────────────
    pty: {
      wsUrl: (id: string, cols: number, rows: number, cwd: string) =>
        buildPtyWsUrl(WS, id, cols, rows, cwd),
      write: async (id: string, text: string) => {
        if (!engineAlive) return { success: false }
        return fetch(`${WS.replace(/^ws/, 'http')}/api/pty/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, text }),
        }).then(r => r.json()).catch(() => ({ success: false }))
      },
    },

    // ── File watcher ──────────────────────────────────────────
    watch: {
      wsUrl: (root: string) => `${WS}/ws/watch?root=${encodeURIComponent(root)}`,
    },

    // ── Window controls (no-op on Android) ───────────────────
    window: {
      minimize: () => Promise.resolve(),
      maximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
      onMaximizeChange: (_cb: any) => {},
      offMaximizeChange: (_cb: any) => {},
    },

    // ── Dialogs ───────────────────────────────────────────────
    dialog: {
      openFolder: async () => {
        const result = await dialogOpen({ directory: true, multiple: false })
        if (!result) return null
        return typeof result === 'string' ? result : (result as string[])[0] ?? null
      },
      saveFile: async (defaultName: string, content: string) => {
        const filePath = await dialogSave({ defaultPath: defaultName })
        if (!filePath) return { success: false }
        const r = await handleFsWrite(filePath, content)
        return { success: r.success, filePath }
      },
      openFiles: async () => {
        const result = await dialogOpen({
          multiple: true,
          filters: [
            { name: 'Code', extensions: ['js','ts','jsx','tsx','py','c','cpp','go','md','json','yaml','yml','sh','html','css'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        })
        if (!result) return []
        const paths = Array.isArray(result) ? result : [result as string]
        return Promise.all(paths.map(async (p: string) => {
          const r = await handleFsRead(p)
          return { path: p, name: p.split('/').pop() ?? p, content: (r as any)?.content ?? '' }
        }))
      },
      showItem: async (_path: string) => ({ success: false }),
    },

    // ── Git (isomorphic-git — no binary) ─────────────────────
    git: {
      status:      (cwd: string)                  => handleGitStatus(cwd),
      log:         (cwd: string)                  => handleGitLog(cwd),
      logGraph:    (cwd: string, limit: number)   => handleGitLogGraph(cwd, limit),
      branch:      (cwd: string)                  => handleGitBranch(cwd),
      branches:    (cwd: string)                  => handleGitBranches(cwd),
      commit:      (cwd: string, message: string) => handleGitCommit(cwd, message),
      stage:       (cwd: string, files: string[]) => handleGitStage(cwd, files),
      unstage:     (cwd: string, files: string[]) => handleGitUnstage(cwd, files),
      checkout:    (cwd: string, branch: string)  => handleGitCheckout(cwd, branch),
      push:        (cwd: string)                  => handleGitPush(cwd),
      pull:        (cwd: string)                  => handleGitPull(cwd),
      stash:       (cwd: string)                  => handleGitStash(cwd),
      stashPop:    (cwd: string)                  => handleGitStashPop(cwd),
      stashList:   (cwd: string)                  => handleGitStashList(cwd),
      init:        (cwd: string)                  => handleGitInit(cwd),
      discard:     (cwd: string, file: string)    => handleGitDiscard(cwd, file),
      diff:        (cwd: string, file: string, staged?: boolean) => handleGitDiff(cwd, file, staged),
      createBranch:(cwd: string, branch: string)  => handleGitCreateBranch(cwd, branch),
      deleteBranch:(cwd: string, branch: string)  => handleGitDeleteBranch(cwd, branch),
      fetch:       (cwd: string)                  => handleGitFetch(cwd),
      remoteList:  (cwd: string)                  => handleGitRemoteList(cwd),
      resetSoft:   (cwd: string)                  => handleGitResetSoft(cwd),
      aheadBehind: (cwd: string)                  => handleGitAheadBehind(cwd),
    },

    gitEx: {
      blame: (cwd: string, file: string) => handleGitBlame(cwd, file),
    },

    // ── File system (Tauri plugin-fs — native Android) ────────
    fs: {
      readTree:               (rootPath: string, maxDepth?: number) => handleFsTree(rootPath, maxDepth),
      readFile:               (filePath: string)                    => handleFsRead(filePath),
      writeFile:              (filePath: string, content: string)   => handleFsWrite(filePath, content),
      createFile:             (filePath: string)                    => handleFsCreateFile(filePath),
      createFolder:           (folderPath: string)                  => handleFsCreateDir(folderPath),
      deleteItem:             (itemPath: string)                    => handleFsDelete(itemPath),
      renameItem:             (oldPath: string, newPath: string)    => handleFsRename(oldPath, newPath),
      copyFolder:             (srcPath: string, destPath: string)   => handleFsCopyFolder(srcPath, destPath),
      copyFile:               (srcPath: string, destPath: string)   => handleFsCopyFile(srcPath, destPath),
      showInFolder:           (_path: string)                       => Promise.resolve(),
      scanImports:            (rootPath: string)                    => handleFsScanImports(rootPath),
      ensureDefaultWorkspace: ()                                    => handleWorkspaceEnsureDefault(),
      getWorkspace:           ()                                    => handleWorkspaceGet(),
      saveWorkspace:          (workspacePath: string)               => handleWorkspaceSave(workspacePath),
      getRecentWorkspaces:    ()                                    => handleWorkspaceRecentGet(),
      addRecentWorkspace:     (p: string)                           => handleWorkspaceRecentAdd(p),
      listAllFiles:           (rootPath: string, maxFiles?: number) => handleFsListAll(rootPath, maxFiles),
      searchInFiles:          (rootPath: string, query: string, maxResults?: number, caseSensitive?: boolean) =>
                                handleFsSearch(rootPath, query, maxResults, caseSensitive),
    },

    // ── AI (direct provider fetch — no Go proxy) ──────────────
    ai: {
      chat: (messages: unknown[], apiKey: string, model: string, system: string, provider: string) =>
        handleAiChat(messages as any, apiKey, model, system, provider),
      streamUrl: () => engineAlive
        ? `${WS.replace(/^ws/, 'http')}/api/ai/stream`
        : '',
      ollamaModels: (host: string) => handleOllamaModels(host),
    },

    // ── Code tools ────────────────────────────────────────────
    tools: {
      formatCode: (code: string, lang: string) => handleFsFormat(code, lang),
      getScripts:  (rootPath: string)           => handleFsGetScripts(rootPath),
    },

    // ── Terminal (Tauri shell) ────────────────────────────────
    terminal: {
      exec: (cmd: string, cwd: string) => execCommand(cmd, cwd),
    },

    // ── Menu event bus ────────────────────────────────────────
    on: (channel: string, cb: MenuCallback) => {
      if (!menuListeners.has(channel)) menuListeners.set(channel, new Set())
      menuListeners.get(channel)!.add(cb)
    },
    off: (channel: string, cb: MenuCallback) => {
      menuListeners.get(channel)?.delete(cb)
    },
  }

  ;(window as any).electronAPI = electronAPI
}
