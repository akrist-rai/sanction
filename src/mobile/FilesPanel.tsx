import FileExplorer from '../components/FileExplorer'
import { api } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useGitStore } from '../stores/gitStore'
import { useUIStore } from '../stores/uiStore'

interface Props {
  rootPath: string | null
  onOpenFile: (node: any) => void
  onRootChange: (path: string) => void
  onScanImports: (path: string) => void
  onTerminalCd: (cwd: string) => void
}

export default function FilesPanel({ rootPath, onOpenFile, onRootChange, onScanImports, onTerminalCd }: Props) {
  const { explorerRefreshKey } = useWorkspaceStore()
  const { gitStatus } = useGitStore()
  const { themeMode } = useUIStore()
  const brutal = themeMode === 'brutal'

  const handleOpenFolder = async () => {
    if (!api?.dialog) return
    const folder = await api.dialog.openFolder()
    if (folder) onRootChange(folder)
  }

  // Build gitStatus map for FileExplorer
  const gitStatusMap: Record<string, string> = {}
  if (gitStatus?.files) {
    for (const f of gitStatus.files) {
      const key = f.file ?? f.path
      if (key) gitStatusMap[key] = f.status
    }
  }

  const folderName = rootPath
    ? rootPath.split('/').filter(Boolean).pop() ?? rootPath
    : null

  return (
    <div className="m-panel">
      {/* Header */}
      <div className="m-files-header">
        <span className="m-files-header-path" onPointerDown={handleOpenFolder}>
          {folderName ?? 'No folder open'}
        </span>
        <button className="m-icon-btn" onPointerDown={handleOpenFolder} title="Open folder">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>

      {/* File tree */}
      <div className="m-files-body">
        {rootPath ? (
          <FileExplorer
            rootPath={rootPath}
            brutal={brutal}
            onOpenFile={onOpenFile}
            onOpenFolder={handleOpenFolder}
            onScanImports={onScanImports}
            onTerminalCd={onTerminalCd}
            refreshKey={explorerRefreshKey}
            gitStatus={gitStatusMap}
          />
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32,
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center', lineHeight: 1.6 }}>
              NO FOLDER OPEN
            </div>
            <button className="m-welcome-btn" onPointerDown={handleOpenFolder}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              OPEN FOLDER
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
