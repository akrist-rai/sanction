// Android Git engine — pure JS via isomorphic-git.
// No system git binary required. Works fully offline.

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { gitFsAdapter } from './fs'

const fs = gitFsAdapter

// ── Helpers ────────────────────────────────────────────────────

function shortHash(h: string) { return h.slice(0, 7) }

async function getAuthor(cwd: string) {
  try {
    const name = await git.getConfig({ fs, dir: cwd, path: 'user.name' }) ?? 'SANCTION'
    const email = await git.getConfig({ fs, dir: cwd, path: 'user.email' }) ?? 'sanction@local'
    return { name: String(name), email: String(email) }
  } catch {
    return { name: 'SANCTION', email: 'sanction@local' }
  }
}

// ── Status ─────────────────────────────────────────────────────

export async function handleGitStatus(cwd: string) {
  try {
    const statusMatrix = await git.statusMatrix({ fs, dir: cwd })
    const files: Array<{ path: string; status: string }> = []
    for (const [filepath, head, workdir, stage] of statusMatrix) {
      let status = 'unmodified'
      if (head === 0 && workdir === 2) status = '??'           // untracked
      else if (head === 1 && workdir === 1 && stage === 0) status = 'D'  // deleted (unstaged)
      else if (head === 1 && workdir === 2 && stage === 2) status = 'M'  // modified staged
      else if (head === 1 && workdir === 2 && stage === 1) status = ' M' // modified unstaged
      else if (head === 0 && workdir === 2 && stage === 2) status = 'A'  // added staged
      else if (head === 1 && workdir === 0 && stage === 1) status = ' D' // deleted unstaged
      if (status !== 'unmodified') files.push({ path: filepath, status })
    }
    const branch = await git.currentBranch({ fs, dir: cwd }) ?? 'HEAD'
    return { branch, files, clean: files.length === 0 }
  } catch (e: any) {
    return { branch: 'unknown', files: [], clean: true, error: e?.message }
  }
}

// ── Log ────────────────────────────────────────────────────────

export async function handleGitLog(cwd: string) {
  try {
    const commits = await git.log({ fs, dir: cwd, depth: 30 })
    return commits.map(c => ({
      hash: c.oid,
      short: shortHash(c.oid),
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
    }))
  } catch {
    return []
  }
}

// ── Log graph (simplified) ─────────────────────────────────────

export async function handleGitLogGraph(cwd: string, limit = 20) {
  try {
    const commits = await git.log({ fs, dir: cwd, depth: limit })
    return commits.map((c, i) => ({
      hash: c.oid,
      short: shortHash(c.oid),
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      parents: c.commit.parent,
      refs: i === 0 ? ['HEAD'] : [],
    }))
  } catch {
    return []
  }
}

// ── Branch ─────────────────────────────────────────────────────

export async function handleGitBranch(cwd: string) {
  try {
    return { current: await git.currentBranch({ fs, dir: cwd }) ?? 'HEAD' }
  } catch {
    return { current: 'unknown' }
  }
}

export async function handleGitBranches(cwd: string) {
  try {
    const local = await git.listBranches({ fs, dir: cwd })
    const current = await git.currentBranch({ fs, dir: cwd }) ?? 'HEAD'
    return { branches: local.map(b => ({ name: b, current: b === current, remote: false })) }
  } catch {
    return { branches: [] }
  }
}

// ── Stage / Unstage ────────────────────────────────────────────

export async function handleGitStage(cwd: string, files: string[]) {
  try {
    for (const f of files) {
      await git.add({ fs, dir: cwd, filepath: f })
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleGitUnstage(cwd: string, files: string[]) {
  try {
    for (const f of files) {
      await git.resetIndex({ fs, dir: cwd, filepath: f })
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Commit ─────────────────────────────────────────────────────

export async function handleGitCommit(cwd: string, message: string) {
  try {
    const author = await getAuthor(cwd)
    const sha = await git.commit({ fs, dir: cwd, message, author })
    return { success: true, sha }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Checkout ───────────────────────────────────────────────────

export async function handleGitCheckout(cwd: string, branch: string) {
  try {
    await git.checkout({ fs, dir: cwd, ref: branch })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Push ───────────────────────────────────────────────────────

export async function handleGitPush(cwd: string) {
  try {
    const remote = await git.getConfig({ fs, dir: cwd, path: 'remote.origin.url' })
    if (!remote) return { success: false, error: 'No remote origin configured' }
    await git.push({ fs, dir: cwd, http, remote: 'origin' })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Pull ───────────────────────────────────────────────────────

export async function handleGitPull(cwd: string) {
  try {
    const author = await getAuthor(cwd)
    await git.pull({ fs, dir: cwd, http, author })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Init ───────────────────────────────────────────────────────

export async function handleGitInit(cwd: string) {
  try {
    await git.init({ fs, dir: cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Discard (restore file to HEAD) ────────────────────────────

export async function handleGitDiscard(cwd: string, file: string) {
  try {
    await git.checkout({ fs, dir: cwd, filepaths: [file] })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Diff (simplified: show current content vs HEAD) ────────────

export async function handleGitDiff(cwd: string, file: string, staged = false) {
  try {
    let headContent = ''
    try {
      const blob = await git.readBlob({ fs, dir: cwd, oid: 'HEAD', filepath: file })
      headContent = new TextDecoder().decode(blob.blob)
    } catch { /* new file */ }
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const workContent = await readTextFile(`${cwd}/${file}`)
    return { diff: `--- HEAD/${file}\n+++ working/${file}\n${headContent !== workContent ? 'File changed' : 'No changes'}`, headContent, workContent }
  } catch (e: any) {
    return { diff: '', error: e?.message }
  }
}

// ── Blame (simplified) ────────────────────────────────────────

export async function handleGitBlame(cwd: string, file: string) {
  try {
    const commits = await git.log({ fs, dir: cwd, depth: 50, filepath: file })
    return { blame: commits.map(c => ({
      hash: c.oid,
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      message: c.commit.message.trim(),
    }))}
  } catch (e: any) {
    return { blame: [], error: e?.message }
  }
}

// ── Stash (not natively supported by isomorphic-git — emulate) ─

const STASH_KEY = 'sanction-git-stash'

export async function handleGitStash(cwd: string) {
  try {
    const statusResult = await handleGitStatus(cwd)
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const saved: Record<string, string> = {}
    for (const f of statusResult.files) {
      try { saved[f.path] = await readTextFile(`${cwd}/${f.path}`) } catch {}
      await git.checkout({ fs, dir: cwd, filepaths: [f.path] }).catch(() => {})
    }
    const existing = JSON.parse(localStorage.getItem(STASH_KEY) ?? '[]')
    existing.push({ cwd, files: saved, date: new Date().toISOString() })
    localStorage.setItem(STASH_KEY, JSON.stringify(existing))
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleGitStashPop(cwd: string) {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const stashes = JSON.parse(localStorage.getItem(STASH_KEY) ?? '[]')
    const idx = stashes.findLastIndex?.((s: any) => s.cwd === cwd) ?? -1
    if (idx === -1) return { success: false, error: 'No stash found' }
    const stash = stashes.splice(idx, 1)[0]
    localStorage.setItem(STASH_KEY, JSON.stringify(stashes))
    for (const [path, content] of Object.entries(stash.files)) {
      await writeTextFile(`${cwd}/${path}`, content as string)
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleGitStashList(cwd: string) {
  try {
    const stashes = JSON.parse(localStorage.getItem(STASH_KEY) ?? '[]')
    return { stashes: stashes.filter((s: any) => s.cwd === cwd) }
  } catch {
    return { stashes: [] }
  }
}

// ── Create/delete branch ───────────────────────────────────────

export async function handleGitCreateBranch(cwd: string, branch: string) {
  try {
    await git.branch({ fs, dir: cwd, ref: branch })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

export async function handleGitDeleteBranch(cwd: string, branch: string) {
  try {
    await git.deleteBranch({ fs, dir: cwd, ref: branch })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Fetch ──────────────────────────────────────────────────────

export async function handleGitFetch(cwd: string) {
  try {
    await git.fetch({ fs, dir: cwd, http })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Remote list ────────────────────────────────────────────────

export async function handleGitRemoteList(cwd: string) {
  try {
    const remotes = await git.listRemotes({ fs, dir: cwd })
    return { remotes }
  } catch {
    return { remotes: [] }
  }
}

// ── Reset soft (move HEAD back one commit) ─────────────────────

export async function handleGitResetSoft(cwd: string) {
  try {
    const commits = await git.log({ fs, dir: cwd, depth: 2 })
    if (commits.length < 2) return { success: false, error: 'No previous commit' }
    await git.writeRef({ fs, dir: cwd, ref: 'HEAD', value: commits[1].oid, force: true })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// ── Ahead/behind ───────────────────────────────────────────────

export async function handleGitAheadBehind(cwd: string) {
  // isomorphic-git doesn't have a direct ahead/behind API; return defaults
  return { ahead: 0, behind: 0 }
}
