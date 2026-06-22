import { ReactNode } from 'react'
import { useGitStore } from '../stores/gitStore'

export type TabId = 'graph' | 'editor' | 'files' | 'git' | 'more'

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  folderName: string
  onOpenFolder: () => void
  onSearch: () => void
  children: ReactNode
}

export default function MobileLayout({ activeTab, onTabChange, folderName, onOpenFolder, onSearch, children }: Props) {
  const { gitStatus } = useGitStore()
  const changedCount = gitStatus?.files?.length ?? 0

  return (
    <>
      {/* Top App Bar */}
      <div className="m-top-bar">
        <span className="m-top-bar-title">SANCTION</span>
        {folderName && (
          <span className="m-top-bar-folder" onClick={onOpenFolder}>
            {folderName}
          </span>
        )}
        <button className="m-icon-btn" onClick={onSearch} title="Search">
          <SearchIcon />
        </button>
        <button className="m-icon-btn" onClick={onOpenFolder} title="Open folder">
          <FolderIcon />
        </button>
      </div>

      {/* Content */}
      <div className="m-content">
        {children}
      </div>

      {/* Bottom Nav */}
      <nav className="m-bottom-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`m-nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id as TabId)}
          >
            {tab.id === 'git' && changedCount > 0 && (
              <span className="m-nav-badge">{changedCount > 99 ? '99+' : changedCount}</span>
            )}
            <tab.Icon />
            {tab.label}
          </button>
        ))}
      </nav>
    </>
  )
}

const TABS = [
  { id: 'graph', label: 'GRAPH', Icon: GraphIcon },
  { id: 'editor', label: 'CODE', Icon: CodeIcon },
  { id: 'files', label: 'FILES', Icon: FilesIcon },
  { id: 'git', label: 'GIT', Icon: GitIcon },
  { id: 'more', label: 'MORE', Icon: MoreIcon },
]

function GraphIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/>
      <line x1="6" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="12" y2="15"/>
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  )
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function GitIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <path d="M6 9v6"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/>
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
