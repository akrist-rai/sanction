import { useState } from 'react'
import AiChatPanel from '../features/sidebar/AiChatPanel'
import MobileTerminal from './terminal/MobileTerminal'
import { useAiStore, DEFAULT_MODELS } from '../stores/aiStore'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import type { ThemeMode } from '../stores/types'
import type { GraphNode } from './GraphPanel'

type SubTab = 'terminal' | 'ai' | 'settings'

interface Props {
  activeNode: GraphNode | null
  cwd: string | null
  wsUrl: string
  isActive: boolean
}

export default function MorePanel({ activeNode, cwd, wsUrl, isActive }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('terminal')

  const { aiProvider, setAiProvider, aiKeys, setAiKey, aiModels, setAiModel } = useAiStore()
  const { formatOnSave, setFormatOnSave } = useEditorStore()
  const { themeMode, setThemeMode } = useUIStore()
  const [fontSize, setFontSize] = useState(13)

  return (
    <div className="m-panel">
      {/* Segment control */}
      <div className="m-more-seg">
        {(['terminal', 'ai', 'settings'] as SubTab[]).map(id => (
          <button
            key={id}
            className={`m-seg-btn ${subTab === id ? 'active' : ''}`}
            onPointerDown={() => setSubTab(id)}
          >
            {id === 'terminal' ? 'TERM' : id === 'ai' ? 'AI' : 'CFG'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="m-more-body">
        {subTab === 'terminal' && (
          <MobileTerminal
            wsUrl={wsUrl}
            cwd={cwd ?? '/sdcard'}
            isActive={isActive && subTab === 'terminal'}
          />
        )}

        {subTab === 'ai' && (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <AiChatPanel
              activeNode={activeNode ? { label: activeNode.label, code: activeNode.code } : null}
              explorerRoot={cwd}
              onOpenSettings={() => setSubTab('settings')}
            />
          </div>
        )}

        {subTab === 'settings' && (
          <Settings
            aiProvider={aiProvider}
            setAiProvider={setAiProvider}
            aiKeys={aiKeys}
            setAiKey={setAiKey}
            aiModels={aiModels}
            setAiModel={setAiModel}
            fontSize={fontSize}
            setFontSize={setFontSize}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            formatOnSave={formatOnSave}
            setFormatOnSave={setFormatOnSave}
          />
        )}
      </div>
    </div>
  )
}

interface SettingsProps {
  aiProvider: string
  setAiProvider: (p: string) => void
  aiKeys: Record<string, string>
  setAiKey: (provider: string, key: string) => void
  aiModels: Record<string, string>
  setAiModel: (provider: string, model: string) => void
  fontSize: number
  setFontSize: (n: number) => void
  themeMode: ThemeMode
  setThemeMode: (t: ThemeMode) => void
  formatOnSave: boolean
  setFormatOnSave: (v: boolean) => void
}

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama']

function Settings({ aiProvider, setAiProvider, aiKeys, setAiKey, aiModels, setAiModel, fontSize, setFontSize, themeMode, setThemeMode, formatOnSave, setFormatOnSave }: SettingsProps) {
  return (
    <div className="m-settings">
      {/* AI Provider */}
      <div className="m-settings-section">
        <div className="m-settings-section-title">AI PROVIDER</div>
        <div className="m-settings-row">
          <div className="m-provider-pills">
            {PROVIDERS.map(p => (
              <button
                key={p}
                className={`m-provider-pill ${aiProvider === p ? 'active' : ''}`}
                onPointerDown={() => setAiProvider(p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Key for active provider */}
      {aiProvider !== 'ollama' && (
        <div className="m-settings-section">
          <div className="m-settings-section-title">{aiProvider.toUpperCase()} KEY</div>
          <div className="m-settings-row">
            <input
              type="password"
              className="m-settings-input"
              placeholder={`${aiProvider} API key`}
              value={aiKeys[aiProvider] ?? ''}
              onChange={e => setAiKey(aiProvider, e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Model */}
      <div className="m-settings-section">
        <div className="m-settings-section-title">MODEL</div>
        <div className="m-settings-row">
          <input
            type="text"
            className="m-settings-input"
            placeholder={DEFAULT_MODELS[aiProvider] ?? 'model name'}
            value={aiModels[aiProvider] ?? ''}
            onChange={e => setAiModel(aiProvider, e.target.value)}
          />
        </div>
      </div>

      {/* Editor font size */}
      <div className="m-settings-section">
        <div className="m-settings-section-title">EDITOR</div>
        <div className="m-settings-row">
          <span className="m-settings-label">Font Size</span>
          <div className="m-stepper">
            <button className="m-stepper-btn" onPointerDown={() => setFontSize(Math.max(10, fontSize - 1))}>−</button>
            <span className="m-stepper-val">{fontSize}</span>
            <button className="m-stepper-btn" onPointerDown={() => setFontSize(Math.min(22, fontSize + 1))}>+</button>
          </div>
        </div>
        <div className="m-settings-row">
          <span className="m-settings-label">Format on Save</span>
          <button
            className={`m-provider-pill ${formatOnSave ? 'active' : ''}`}
            onPointerDown={() => setFormatOnSave(!formatOnSave)}
          >
            {formatOnSave ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Theme */}
      <div className="m-settings-section">
        <div className="m-settings-section-title">THEME</div>
        <div className="m-settings-row">
          <div className="m-provider-pills">
            {(['cyber', 'brutal'] as ThemeMode[]).map(t => (
              <button
                key={t}
                className={`m-provider-pill ${themeMode === t ? 'active' : ''}`}
                onPointerDown={() => setThemeMode(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ollama URL */}
      {aiProvider === 'ollama' && (
        <div className="m-settings-section">
          <div className="m-settings-section-title">OLLAMA URL</div>
          <div className="m-settings-row">
            <input
              type="text"
              className="m-settings-input"
              placeholder="http://localhost:11434"
              value={aiKeys['ollama'] ?? ''}
              onChange={e => setAiKey('ollama', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
