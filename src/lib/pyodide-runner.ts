// Lazy Python execution via Pyodide (Python 3 compiled to WASM).
// Loads from CDN on first use (~8MB), then cached by the browser.

export interface PyOutput {
  type: 'stdout' | 'stderr' | 'return' | 'error'
  val: string
}

let pyodideInstance: any = null
let loading: Promise<any> | null = null

async function getPyodide(onProgress?: (msg: string) => void): Promise<any> {
  if (pyodideInstance) return pyodideInstance
  if (loading) return loading

  loading = (async () => {
    onProgress?.('Loading Python runtime… (first time only)')

    // Load Pyodide UMD script into page if not already present
    await new Promise<void>((resolve, reject) => {
      if ((window as any).loadPyodide) { resolve(); return }
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load Pyodide from CDN — check internet connection'))
      document.head.appendChild(s)
    })

    const py = await (window as any).loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/',
      stdout: () => {},  // we redirect via sys.stdout
      stderr: () => {},
    })

    pyodideInstance = py
    loading = null
    return py
  })()

  return loading
}

export async function runPython(
  code: string,
  onOutput: (entry: PyOutput) => void,
  onProgress?: (msg: string) => void,
): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now()
  try {
    const py = await getPyodide(onProgress)

    // Redirect stdout/stderr via io.StringIO
    py.runPython(`
import sys, io as _io
_stdout_buf = _io.StringIO()
_stderr_buf = _io.StringIO()
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
`)

    let retVal: any = undefined
    try {
      retVal = py.runPython(code)
    } catch (e: any) {
      // Syntax/runtime errors come here
      onOutput({ type: 'error', val: String(e.message ?? e) })
    }

    // Collect stdout
    const stdout: string = py.runPython('_stdout_buf.getvalue(); _stdout_buf.truncate(0); _stdout_buf.seek(0); _stdout_buf.getvalue()') || ''
    const stderr: string = py.runPython('_stderr_buf.getvalue(); _stderr_buf.truncate(0); _stderr_buf.seek(0); _stderr_buf.getvalue()') || ''

    // Actually just read once properly
    const out: string = py.runPython('_stdout_buf.getvalue()') || ''
    const err: string = py.runPython('_stderr_buf.getvalue()') || ''

    for (const line of out.split('\n')) {
      if (line !== '') onOutput({ type: 'stdout', val: line })
    }
    for (const line of err.split('\n')) {
      if (line !== '') onOutput({ type: 'stderr', val: line })
    }
    if (retVal !== undefined && retVal !== null && typeof retVal.toString === 'function') {
      const s = retVal.toString()
      if (s && s !== 'None') onOutput({ type: 'return', val: s })
    }

    // Reset buffers for next run
    py.runPython('_stdout_buf = _io.StringIO(); sys.stdout = _stdout_buf; _stderr_buf = _io.StringIO(); sys.stderr = _stderr_buf')

    return { ok: true, ms: Date.now() - t0 }
  } catch (e: any) {
    onOutput({ type: 'error', val: String(e.message ?? e) })
    return { ok: false, ms: Date.now() - t0 }
  }
}

export function isPyodideReady() {
  return pyodideInstance != null
}
