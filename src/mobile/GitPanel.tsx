import GitPanelV2 from '../components/GitPanelV2'
import { useGitStore } from '../stores/gitStore'
import { useAiStore } from '../stores/aiStore'
import { api } from '../lib/api'

interface Props {
  cwd: string | null
  onOpenFile: (path: string) => void
}

export default function GitPanel({ cwd, onOpenFile }: Props) {
  const { gitBranch, gitStatus } = useGitStore()
  const { aiProvider, aiKeys, aiModels } = useAiStore()

  const handlePull = async () => {
    if (!cwd || !api?.git) return
    await api.git.pull(cwd).catch(() => {})
  }

  const handlePush = async () => {
    if (!cwd || !api?.git) return
    await api.git.push(cwd).catch(() => {})
  }

  const changedCount = gitStatus?.files?.length ?? 0

  return (
    <div className="m-panel">
      {/* Header */}
      <div className="m-git-header">
        <span className="m-branch-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M6 9v6"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/>
          </svg>
          {gitBranch ?? 'main'}
          {changedCount > 0 && (
            <span style={{
              marginLeft: 6,
              background: 'rgba(255,42,56,0.2)',
              color: 'var(--red)',
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
            }}>
              {changedCount} changed
            </span>
          )}
        </span>
        <button className="m-icon-btn" onPointerDown={e => { e.preventDefault(); handlePull() }} title="Pull">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button className="m-icon-btn" onPointerDown={e => { e.preventDefault(); handlePush() }} title="Push">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
      </div>

      {/* Git panel body */}
      <div className="m-git-body">
        {cwd ? (
          <GitPanelV2
            cwd={cwd}
            aiProvider={aiProvider}
            aiKeys={aiKeys}
            aiModels={aiModels}
            onOpenFile={onOpenFile}
          />
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: 32, textAlign: 'center',
          }}>
            OPEN A FOLDER TO USE GIT
          </div>
        )}
      </div>
    </div>
  )
}
