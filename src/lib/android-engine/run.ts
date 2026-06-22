// Android code execution engine.
// Python → Pyodide WASM (CDN; works when device has internet)
// JS/JSX → WebWorker sandbox (works offline)
// TS/TSX → type-strip then WebWorker sandbox
// Go/C/C++ → Tauri shell (needs Termux installed on device)

export interface RunLog {
  type: 'log' | 'error' | 'return' | 'run-err'
  val: string
  ts: number
}

export interface RunResult {
  logs: RunLog[]
  error: string | null
  ms: number
}

// ── Pyodide (lazy-loaded, CDN) ────────────────────────────────

let _py: any = null
let _pyLoading: Promise<any> | null = null

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js'
const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/'

async function loadPyodide(onProgress?: (msg: string) => void): Promise<any> {
  if (_py) return _py
  if (_pyLoading) return _pyLoading

  _pyLoading = (async () => {
    onProgress?.('Downloading Python runtime (first use)…')
    if (!(window as any).loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = PYODIDE_CDN
        script.onload = () => resolve()
        script.onerror = () => reject(new Error(
          'Could not load Python runtime. Check your internet connection.'
        ))
        document.head.appendChild(script)
      })
    }
    onProgress?.('Initialising Python…')
    const py = await (window as any).loadPyodide({ indexURL: PYODIDE_INDEX })
    _py = py
    _pyLoading = null
    onProgress?.('Python ready')
    return py
  })()

  return _pyLoading
}

// ── Python runner ──────────────────────────────────────────────

export async function runPython(
  code: string,
  onProgress?: (msg: string) => void,
): Promise<RunResult> {
  const t0 = Date.now()
  const logs: RunLog[] = []
  try {
    const py = await loadPyodide(onProgress)

    // Redirect stdout/stderr to StringIO so we can capture prints
    py.runPython(`
import sys, io as _io
_stdout_buf = _io.StringIO()
_stderr_buf = _io.StringIO()
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
`)

    let retVal: any = undefined
    let runError: string | null = null
    try {
      retVal = py.runPython(code)
    } catch (e: any) {
      runError = String(e?.message ?? e)
    }

    const out: string = py.runPython('_stdout_buf.getvalue()') || ''
    const err: string = py.runPython('_stderr_buf.getvalue()') || ''

    // Reset buffers for next run
    py.runPython(`
_stdout_buf = _io.StringIO()
_stderr_buf = _io.StringIO()
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
`)

    for (const line of out.split('\n')) {
      if (line.trim()) logs.push({ type: 'log', val: line, ts: 0 })
    }
    for (const line of err.split('\n')) {
      if (line.trim()) logs.push({ type: 'error', val: line, ts: 0 })
    }
    if (runError) {
      logs.push({ type: 'error', val: runError, ts: 0 })
    }
    if (retVal !== undefined && retVal !== null) {
      const s = String(retVal)
      if (s && s !== 'None') logs.push({ type: 'return', val: s, ts: 0 })
    }

    return { logs, error: runError, ms: Date.now() - t0 }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    logs.push({ type: 'run-err', val: msg, ts: 0 })
    return { logs, error: msg, ms: Date.now() - t0 }
  }
}

// ── TypeScript type-stripper ───────────────────────────────────
// Removes the most common TS-only syntax so the output can run
// as plain JS in a WebWorker. Handles everyday code, not edge cases.

function stripTypes(code: string): string {
  return code
    // Remove interface and type alias declarations (single-line and block)
    .replace(/^\s*(export\s+)?(declare\s+)?(interface|type)\s+\w[\s\S]*?\n(?=\s*(?:export|const|let|var|function|class|\/\/|$))/gm, '\n')
    // Remove 'as' type assertions: expr as Type
    .replace(/\bas\s+(?:\w+(?:<[^>]*>)?(?:\[\])?)/g, '')
    // Remove angle-bracket type assertions: (<Type>expr)
    .replace(/<(?:[A-Z]\w*|any|string|number|boolean|unknown|never)(?:\[\])?>/g, '')
    // Remove generic parameters on function calls: fn<Type>(...)
    .replace(/(\w+)<[A-Z]\w*(?:,\s*[A-Z]\w*)*>(?=\s*\()/g, '$1')
    // Remove access modifiers in class bodies
    .replace(/\b(public|private|protected|readonly|abstract|override)\s+/g, '')
    // Remove return-type annotations: ): ReturnType {
    .replace(/\)\s*:\s*(?:[\w<>\[\]|& ]+)\s*(?=\{|=>)/g, ')')
    // Remove parameter type annotations: (param: Type, ...)
    .replace(/(\w+)\s*\??\s*:\s*(?:[\w<>\[\]|& ]+)(?=\s*[,)=])/g, '$1')
    // Remove variable type annotations: const x: Type =
    .replace(/(const|let|var)\s+(\w+)\s*:\s*(?:[\w<>\[\]|& ]+)\s*=/g, '$1 $2 =')
    // Remove 'export type' re-exports
    .replace(/^export\s+type\s+\{[^}]*\};?\s*$/gm, '')
    // Remove '@ts-*' directives
    .replace(/\/\/\s*@ts-\w+.*$/gm, '')
    // Remove import type statements
    .replace(/^import\s+type\s+.*?;?\s*$/gm, '')
    // Strip module-style exports so Worker can evaluate top-level code
    .replace(/^export\s+(default\s+)?/gm, '')
}

// ── JS/TS WebWorker runner ────────────────────────────────────

function buildWorkerSrc(isTS: boolean): string {
  const tsStripperFn = isTS ? `
function _stripTypes(code) {
  return code
    .replace(/^\\s*(export\\s+)?(declare\\s+)?(interface|type)\\s+\\w[\\s\\S]*?\\n(?=\\s*(?:export|const|let|var|function|class|\\/\\/|$))/gm, '\\n')
    .replace(/\\bas\\s+(?:\\w+(?:<[^>]*>)?(?:\\[\\])?)/g, '')
    .replace(/<(?:[A-Z]\\w*|any|string|number|boolean|unknown|never)(?:\\[\\])?>/g, '')
    .replace(/(\\w+)<[A-Z]\\w*(?:,\\s*[A-Z]\\w*)*>(?=\\s*\\()/g, '$1')
    .replace(/\\b(public|private|protected|readonly|abstract|override)\\s+/g, '')
    .replace(/\\)\\s*:\\s*(?:[\\w<>\\[\\]|& ]+)\\s*(?=\\{|=>)/g, ')')
    .replace(/(\\w+)\\s*\\??\\s*:\\s*(?:[\\w<>\\[\\]|& ]+)(?=\\s*[,)=])/g, '$1')
    .replace(/(const|let|var)\\s+(\\w+)\\s*:\\s*(?:[\\w<>\\[\\]|& ]+)\\s*=/g, '$1 $2 =')
    .replace(/^export\\s+type\\s+\\{[^}]*\\};?\\s*$/gm, '')
    .replace(/^\\/\\/\\s*@ts-\\w+.*$/gm, '')
    .replace(/^import\\s+type\\s+.*?;?\\s*$/gm, '')
    .replace(/^export\\s+(default\\s+)?/gm, '')
}
` : ''

  return `
${tsStripperFn}
self.onmessage = function(e) {
  const logs = [];
  const ts = () => Date.now();
  const _origLog = console.log.bind(console);
  const _origErr = console.error.bind(console);
  const _origWarn = console.warn.bind(console);
  console.log  = (...a) => { logs.push({type:'log',   val:a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' '), ts:ts()}); _origLog(...a);  };
  console.error= (...a) => { logs.push({type:'error', val:a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' '), ts:ts()}); _origErr(...a); };
  console.warn = (...a) => { logs.push({type:'error', val:'warn: '+a.map(String).join(' '), ts:ts()}); _origWarn(...a); };
  const code = ${isTS ? '_stripTypes(e.data.code)' : 'e.data.code'};
  try {
    const fn = new Function(code);
    const ret = fn();
    if (ret instanceof Promise) {
      ret.then(v => {
        if (v !== undefined) logs.push({type:'return', val:String(v), ts:ts()});
        self.postMessage({logs, error:null});
      }).catch(err => {
        logs.push({type:'error', val:String(err?.message ?? err), ts:ts()});
        self.postMessage({logs, error:String(err?.message ?? err)});
      });
    } else {
      if (ret !== undefined) logs.push({type:'return', val:String(ret), ts:ts()});
      self.postMessage({logs, error:null});
    }
  } catch(err) {
    logs.push({type:'error', val:String(err?.message ?? err), ts:ts()});
    self.postMessage({logs, error:String(err?.message ?? err)});
  }
};
`
}

function runInWorker(code: string, isTS: boolean): Promise<RunResult> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const blob = new Blob([buildWorkerSrc(isTS)], { type: 'application/javascript' })
    const url  = URL.createObjectURL(blob)
    const worker = new Worker(url)

    const timer = setTimeout(() => {
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({
        logs: [{ type: 'run-err', val: 'Execution timed out after 30 seconds', ts: 0 }],
        error: 'timeout',
        ms: Date.now() - t0,
      })
    }, 30_000)

    worker.onmessage = (e) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({ ...e.data, ms: Date.now() - t0 })
    }

    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({
        logs: [{ type: 'error', val: e.message || 'Worker error', ts: 0 }],
        error: e.message,
        ms: Date.now() - t0,
      })
    }

    worker.postMessage({ code })
  })
}

export function runJavaScript(code: string): Promise<RunResult> {
  return runInWorker(code, false)
}

export function runTypeScript(code: string): Promise<RunResult> {
  return runInWorker(code, true)
}

// ── Termux runner (Python, Go, C, C++ — requires Termux on device) ──────

const TERMUX_TMP = '/sdcard/.sanction-run'

function buildRunScript(
  lang: string,
  codeFile: string,
  outFile: string,
  exitFile: string,
  doneFile: string,
): string {
  const binOut = `${TERMUX_TMP}/bin_out`
  const head = `#!/data/data/com.termux/files/usr/bin/bash\nexport PATH="/data/data/com.termux/files/usr/bin:$PATH"\n`

  const bodies: Record<string, string> = {
    py:  `python '${codeFile}' > '${outFile}' 2>&1\necho $? > '${exitFile}'`,
    go:  `go run '${codeFile}' > '${outFile}' 2>&1\necho $? > '${exitFile}'`,
    c:   `clang '${codeFile}' -o '${binOut}' -lm > '${outFile}' 2>&1 && '${binOut}' >> '${outFile}' 2>&1\necho $? > '${exitFile}'`,
    cpp: `clang++ '${codeFile}' -o '${binOut}' > '${outFile}' 2>&1 && '${binOut}' >> '${outFile}' 2>&1\necho $? > '${exitFile}'`,
  }

  const body = bodies[lang] ?? `echo "Unsupported: ${lang}" > '${outFile}'\necho 1 > '${exitFile}'`
  return `${head}${body}\ntouch '${doneFile}'\n`
}

async function runViaTermux(
  lang: string,
  code: string,
  onProgress?: (msg: string) => void,
): Promise<RunResult> {
  const t0 = Date.now()
  const { writeTextFile, readTextFile, mkdir, remove } = await import('@tauri-apps/plugin-fs')
  const { invoke } = await import('@tauri-apps/api/core')

  const codeFile   = `${TERMUX_TMP}/code.${lang}`
  const scriptFile = `${TERMUX_TMP}/run.sh`
  const outFile    = `${TERMUX_TMP}/out.txt`
  const exitFile   = `${TERMUX_TMP}/exit.txt`
  const doneFile   = `${TERMUX_TMP}/done`

  try {
    await mkdir(TERMUX_TMP, { recursive: true }).catch(() => {})
    // Clear stale files from previous run
    await remove(doneFile).catch(() => {})
    await remove(outFile).catch(() => {})
    await remove(exitFile).catch(() => {})

    await writeTextFile(codeFile, code)
    await writeTextFile(scriptFile, buildRunScript(lang, codeFile, outFile, exitFile, doneFile))

    onProgress?.('Sending to Termux…')
    await invoke('launch_termux_script', { scriptPath: scriptFile })

    // Poll until Termux touches the done marker (500ms × 60 = 30s max)
    onProgress?.('Running in Termux…')
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      try { await readTextFile(doneFile); break } catch { /* not done yet */ }
      if (i === 59) {
        return {
          logs: [{ type: 'run-err', val: 'Timeout: code exceeded 30 seconds', ts: 0 }],
          error: 'timeout',
          ms: Date.now() - t0,
        }
      }
    }

    const output  = await readTextFile(outFile).catch(() => '')
    const exitStr = await readTextFile(exitFile).catch(() => '-1')
    const exitCode = parseInt(exitStr.trim(), 10)

    const logs: RunLog[] = output
      .split('\n')
      .filter(l => l.trim())
      .map(l => ({ type: (exitCode === 0 ? 'log' : 'error') as RunLog['type'], val: l, ts: 0 }))

    if (!logs.length) logs.push({ type: 'log', val: '(no output)', ts: 0 })

    return {
      logs,
      error: exitCode !== 0 ? `exit code ${exitCode}` : null,
      ms: Date.now() - t0,
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    let display = msg
    if (msg.includes('PERMISSION_DENIED')) {
      display = '⚠ Enable "Allow External Apps" in Termux → Settings → Allow External Apps'
    } else if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
      display = '⚠ Termux not installed. Get it from F-Droid, then: pkg install python golang clang'
    }
    return {
      logs: [{ type: 'run-err', val: display, ts: 0 }],
      error: msg,
      ms: Date.now() - t0,
    }
  }
}

// ── Unified entry point ────────────────────────────────────────

export async function runCode(
  lang: string,
  code: string,
  onProgress?: (msg: string) => void,
): Promise<RunResult> {
  switch (lang) {
    case 'js':
    case 'jsx':
      return runJavaScript(code)
    case 'ts':
    case 'tsx':
      return runTypeScript(code)
    case 'py':
    case 'go':
    case 'c':
    case 'cpp':
      return runViaTermux(lang, code, onProgress)
    case 'md':
    case 'unknown':
      return {
        logs: [{ type: 'run-err', val: 'No runner for this file type. Open a .py, .js, .ts, or .go file.', ts: 0 }],
        error: 'unsupported',
        ms: 0,
      }
    default:
      return {
        logs: [{ type: 'run-err', val: `Cannot run '${lang}' on Android.`, ts: 0 }],
        error: 'unsupported',
        ms: 0,
      }
  }
}
