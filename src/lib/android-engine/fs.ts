// Android FS engine — uses @tauri-apps/plugin-fs directly.
// No Go binary needed. All file I/O goes through Tauri's native FS plugin.

import {
  readTextFile, writeTextFile, readDir, mkdir, remove,
  rename, copyFile, exists, stat, readFile, writeFile,
} from '@tauri-apps/plugin-fs'

// ── Tree walker ────────────────────────────────────────────────

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache', 'target', 'out', 'vendor'])

export interface FsNode {
  id: string
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FsNode[]
}

async function walkDir(dirPath: string, depth: number, maxDepth: number): Promise<FsNode[]> {
  if (depth > maxDepth) return []
  let entries
  try { entries = await readDir(dirPath) } catch { return [] }
  const nodes: FsNode[] = []
  for (const e of entries) {
    if (!e.name || e.name.startsWith('.') || SKIP.has(e.name)) continue
    const fullPath = `${dirPath}/${e.name}`
    if (e.isDirectory) {
      const children = await walkDir(fullPath, depth + 1, maxDepth)
      nodes.push({ id: fullPath, name: e.name, path: fullPath, type: 'folder', children })
    } else {
      nodes.push({ id: fullPath, name: e.name, path: fullPath, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

// ── Flat file lister ───────────────────────────────────────────

async function listAllFlat(dirPath: string, result: string[], maxFiles: number) {
  if (result.length >= maxFiles) return
  let entries
  try { entries = await readDir(dirPath) } catch { return }
  for (const e of entries) {
    if (!e.name || e.name.startsWith('.') || SKIP.has(e.name)) continue
    const fp = `${dirPath}/${e.name}`
    if (e.isDirectory) {
      await listAllFlat(fp, result, maxFiles)
    } else {
      result.push(fp)
      if (result.length >= maxFiles) return
    }
  }
}

// ── Import scanner (lightweight) ───────────────────────────────

function extractImports(code: string, filePath: string): string[] {
  const deps: string[] = []
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) deps.push(m[1])
  for (const m of code.matchAll(/import\s+['"](\.[^'"]+)['"]/g)) deps.push(m[1])
  for (const m of code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) deps.push(m[1])
  return deps.map(d => {
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '']
    for (const ext of exts) {
      const candidate = `${dir}/${d}${ext}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
      return candidate
    }
    return `${dir}/${d}`
  })
}

// ── Exported handlers ──────────────────────────────────────────

export async function handleFsTree(rootPath: string, maxDepth = 4) {
  const tree = await walkDir(rootPath, 0, maxDepth)
  return { tree }
}

export async function handleFsRead(filePath: string) {
  try {
    const content = await readTextFile(filePath)
    return { content }
  } catch (e: any) {
    return { error: e?.message ?? 'read failed' }
  }
}

export async function handleFsWrite(filePath: string, content: string) {
  try {
    await writeTextFile(filePath, content)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsCreateFile(filePath: string) {
  try {
    await writeTextFile(filePath, '')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsCreateDir(folderPath: string) {
  try {
    await mkdir(folderPath, { recursive: true })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsDelete(itemPath: string) {
  try {
    await remove(itemPath, { recursive: true })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsRename(oldPath: string, newPath: string) {
  try {
    await rename(oldPath, newPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsCopyFile(srcPath: string, destPath: string) {
  try {
    await copyFile(srcPath, destPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsCopyFolder(srcPath: string, destPath: string) {
  try {
    await mkdir(destPath, { recursive: true })
    const entries = await readDir(srcPath)
    for (const e of entries) {
      if (!e.name) continue
      const src = `${srcPath}/${e.name}`
      const dest = `${destPath}/${e.name}`
      if (e.isDirectory) {
        await handleFsCopyFolder(src, dest)
      } else {
        await copyFile(src, dest)
      }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleFsListAll(rootPath: string, maxFiles = 500) {
  const files: string[] = []
  await listAllFlat(rootPath, files, maxFiles)
  return { files }
}

export async function handleFsSearch(rootPath: string, query: string, maxResults = 50, caseSensitive = false) {
  const files: string[] = []
  await listAllFlat(rootPath, files, 2000)
  const q = caseSensitive ? query : query.toLowerCase()
  const results: Array<{ file: string; line: number; text: string }> = []
  const TEXT_EXT = new Set(['ts','tsx','js','jsx','py','go','c','cpp','md','txt','json','yaml','yml','sh','css','html'])
  outer: for (const f of files) {
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    if (!TEXT_EXT.has(ext)) continue
    let content: string
    try { content = await readTextFile(f) } catch { continue }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = caseSensitive ? lines[i] : lines[i].toLowerCase()
      if (line.includes(q)) {
        results.push({ file: f, line: i + 1, text: lines[i].trim() })
        if (results.length >= maxResults) break outer
      }
    }
  }
  return { results }
}

export async function handleFsScanImports(rootPath: string) {
  const files: string[] = []
  await listAllFlat(rootPath, files, 500)
  const tsFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f))
  const nodeMap = new Map<string, { id: string; label: string; filepath: string; type: string; is_main: boolean; x: number; y: number }>()
  const edges: Array<{ id: string; source: string; target: string }> = []
  let ei = 0
  for (const f of tsFiles) {
    const name = f.split('/').pop() ?? f
    const id = `n${nodeMap.size}`
    const isMain = /^(index|main|app)\.(ts|tsx|js|jsx)$/.test(name)
    nodeMap.set(f, {
      id, label: name, filepath: f,
      type: isMain ? 'entry' : 'function',
      is_main: isMain,
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 600,
    })
  }
  for (const f of tsFiles) {
    let code: string
    try { code = await readTextFile(f) } catch { continue }
    const src = nodeMap.get(f)
    if (!src) continue
    const deps = extractImports(code, f)
    for (const dep of deps) {
      for (const [targetPath, tgt] of nodeMap) {
        if (targetPath.startsWith(dep) || dep.startsWith(targetPath.replace(/\.[^.]+$/, ''))) {
          edges.push({ id: `e${ei++}`, source: src.id, target: tgt.id })
          break
        }
      }
    }
  }
  return { nodes: [...nodeMap.values()], edges }
}

// ── Scripts getter ─────────────────────────────────────────────

export async function handleFsGetScripts(rootPath: string) {
  try {
    const pkgPath = `${rootPath}/package.json`
    if (!(await exists(pkgPath))) return { scripts: {} }
    const raw = await readTextFile(pkgPath)
    const pkg = JSON.parse(raw)
    return { scripts: pkg.scripts ?? {} }
  } catch {
    return { scripts: {} }
  }
}

// ── Code formatter (basic) ─────────────────────────────────────

export async function handleFsFormat(code: string, lang: string) {
  // No external formatter available on Android; return code as-is
  return { formatted: code, error: null }
}

// ── isomorphic-git FS adapter (used by git.ts) ────────────────

export const gitFsAdapter = {
  promises: {
    readFile: async (path: string, options?: any): Promise<Uint8Array | string> => {
      try {
        if (options?.encoding === 'utf8' || options?.encoding === 'utf-8') {
          return await readTextFile(path)
        }
        return await readFile(path)
      } catch (e: any) {
        const err: any = new Error(e?.message ?? 'ENOENT')
        err.code = 'ENOENT'
        throw err
      }
    },
    writeFile: async (path: string, data: Uint8Array | string, _options?: any): Promise<void> => {
      if (typeof data === 'string') {
        await writeTextFile(path, data)
      } else {
        await writeFile(path, data)
      }
    },
    unlink: async (path: string): Promise<void> => {
      await remove(path)
    },
    readdir: async (path: string): Promise<string[]> => {
      try {
        const entries = await readDir(path)
        return entries.map(e => e.name).filter(Boolean) as string[]
      } catch (e: any) {
        const err: any = new Error(e?.message ?? 'ENOENT')
        err.code = 'ENOENT'
        throw err
      }
    },
    mkdir: async (path: string, _options?: any): Promise<void> => {
      await mkdir(path, { recursive: true })
    },
    rmdir: async (path: string): Promise<void> => {
      await remove(path, { recursive: true })
    },
    stat: async (path: string): Promise<any> => {
      try {
        const s = await stat(path)
        return {
          type: s.isDirectory ? 'dir' : 'file',
          size: s.size ?? 0,
          mode: s.isDirectory ? 0o40755 : 0o100644,
          mtimeMs: s.mtime?.getTime() ?? Date.now(),
          ctimeMs: s.mtime?.getTime() ?? Date.now(),
          isFile: () => s.isFile,
          isDirectory: () => s.isDirectory,
          isSymbolicLink: () => s.isSymlink,
        }
      } catch (e: any) {
        const err: any = new Error(e?.message ?? 'ENOENT')
        err.code = 'ENOENT'
        throw err
      }
    },
    lstat: async (path: string): Promise<any> => {
      try {
        const s = await stat(path)
        return {
          type: s.isDirectory ? 'dir' : 'file',
          size: s.size ?? 0,
          mode: s.isDirectory ? 0o40755 : 0o100644,
          mtimeMs: s.mtime?.getTime() ?? Date.now(),
          ctimeMs: s.mtime?.getTime() ?? Date.now(),
          isFile: () => s.isFile,
          isDirectory: () => s.isDirectory,
          isSymbolicLink: () => s.isSymlink,
        }
      } catch (e: any) {
        const err: any = new Error(e?.message ?? 'ENOENT')
        err.code = 'ENOENT'
        throw err
      }
    },
    rename: async (oldPath: string, newPath: string): Promise<void> => {
      await rename(oldPath, newPath)
    },
    symlink: async (): Promise<void> => {
      throw Object.assign(new Error('symlinks not supported'), { code: 'ENOSYS' })
    },
    readlink: async (): Promise<string> => {
      throw Object.assign(new Error('symlinks not supported'), { code: 'ENOSYS' })
    },
    chmod: async (): Promise<void> => { /* no-op on Android */ },
  },
}
