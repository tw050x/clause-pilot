import type { Account, ContractRecord, ReviewSession, ReviewSummary } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'

export type View = 'home' | 'contract' | 'new-contract' | 'review' | 'reviews' | 'library' | 'playbook' | 'history' | 'queue' | 'security' | 'audit' | 'settings'

interface Props {
  open: boolean
  view: View
  setView: (v: View) => void
  session: ReviewSession | null
  pendingNominations: number
  openAlerts: number
  /** The client being worked on; its contracts are listed. */
  account: Account | null
  contracts: ContractRecord[]
  reviews: ReviewSummary[]
  /** The contract whose page (or one of whose versions) is open. */
  currentContractId: string | null
  canCreateContract: boolean
  onOpenContract: (id: string) => void
  onNewContract: () => void
  onChooseAccount: () => void
}

export function NavDrawer(p: Props) {
  const { open, view, setView, account } = p
  const item = (v: View, icon: string, label: string, extra?: React.ReactNode, disabled = false) => (
    <button
      className={`nav-item ${view === v ? 'active' : ''}`}
      onClick={() => setView(v)}
      disabled={disabled}
      title={disabled ? 'Choose an account first (top left)' : undefined}
    >
      <Icon name={icon} />
      <span style={{ minWidth: 0 }}>{label}</span>
      {extra}
      <span className="nav-chevron">
        <Chevron />
      </span>
    </button>
  )
  const latest = (contractId: string) =>
    p.reviews.filter((r) => r.contractId === contractId).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]

  return (
    <nav className={`nav ${open ? '' : 'closed'}`} aria-hidden={!open}>
      {item('home', 'home', 'Start')}
      <div className="nav-section">Contracts</div>
      {/* The active client's contracts fill the space between the top items and Knowledge. */}
      <div className="nav-recent">
        {!account && (
          <p className="nav-empty">
            <button className="link-btn" onClick={p.onChooseAccount}>
              Choose an account
            </button>{' '}
            to see its contracts.
          </p>
        )}
        {account && p.contracts.length === 0 && <p className="nav-empty">No contracts for {account.name} yet.</p>}
        {account &&
          p.contracts.map((c) => {
            const v = latest(c.id)
            return (
              <button
                key={c.id}
                className={`nav-item recent contract-item ${p.currentContractId === c.id && (view === 'contract' || view === 'review') ? 'active' : ''}`}
                onClick={() => p.onOpenContract(c.id)}
                title={c.title}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="recent-name">{c.title}</span>
                  <span className="sub">
                    {v ? `Version ${v.version} · ${new Date(v.createdAt).toLocaleDateString()}` : 'No drafts yet'}
                    {v && v.rejected > 0 && ` · ${v.rejected} rejected`}
                  </span>
                </span>
                <span className="nav-chevron">
                  <Chevron />
                </span>
              </button>
            )
          })}
        {account && p.canCreateContract && (
          <button className={`nav-item recent new-contract ${view === 'new-contract' ? 'active' : ''}`} onClick={p.onNewContract}>
            <span>+ New contract</span>
          </button>
        )}
      </div>
      {item('reviews', 'list', 'All reviews', undefined, !account)}
      <div className="nav-section">Knowledge</div>
      {item('library', 'book', 'Library')}
      {item('playbook', 'scales', 'Playbook')}
      {item('history', 'history', 'Precedents')}
      {item('queue', 'inbox', 'Approvals', p.pendingNominations ? <span className="count">{p.pendingNominations}</span> : null)}
      <div className="nav-section">Governance</div>
      {item('security', 'alert', 'Security', p.openAlerts ? <span className="count danger">{p.openAlerts}</span> : null)}
      {item('audit', 'shield', 'Audit')}
      {item('settings', 'settings', 'Settings')}
    </nav>
  )
}
