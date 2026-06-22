import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Detect Android and use the right engine.
// Tauri's @tauri-apps/plugin-os is not available at module-load time on Android,
// so we read the Tauri internal platform string via invoke() and branch accordingly.
async function boot() {
  const { invoke } = await import('@tauri-apps/api/core')
  let platform = 'unknown'
  try { platform = await invoke<string>('get_platform') } catch {}

  if (platform === 'android') {
    const { initAndroidEngine } = await import('./lib/android-engine/index')
    await initAndroidEngine()
  } else {
    const { initTauriAPI } = await import('./lib/tauriAPI')
    await initTauriAPI()
  }
}

boot().catch(e => console.error('[main] boot failed:', e))
