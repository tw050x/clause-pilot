import type { Account, ContractRecord, ReviewSession, ReviewSummary } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'
import { StatePill } from '../views/ContractView'

export type View = 'home' | 'contracts' | 'contract' | 'new-contract' | 'review' | 'reviews' | 'library' | 'playbook' | 'questions' | 'history' | 'queue' | 'security' | 'audit' | 'settings' | 'work'

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
      <button className={`account-switch ${account ? '' : 'none'}`} onClick={p.onChooseAccount} title="Choose the active account (⌘K)">
        <Icon name="users" size={15} />
        <span>{account?.name ?? 'Choose an account'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
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
        {account && !p.contracts.some((c) => !c.archived) && <p className="nav-empty">No {p.contracts.length ? 'open ' : ''}contracts for {account.name}{p.contracts.length ? '' : ' yet'}.</p>}
        {account &&
          // Archived contracts stay out of the sidebar (they're under All contracts).
          p.contracts.filter((c) => !c.archived).map((c) => {
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
                  </span>
                  {/* Where its latest draft's AI review stands (AI reviewing, Planned, Ready for manual review…). */}
                  {v?.ai && !v.closed && (
                    <span className="nav-state">
                      <StatePill state={v.ai} plain />
                    </span>
                  )}
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
      {item('contracts', 'doc', 'All contracts', undefined, !account)}
      {item('reviews', 'list', 'All reviews', undefined, !account)}
      <div className="nav-section">Knowledge</div>
      {item('library', 'book', 'Clauses')}
      {item('playbook', 'scales', 'Playbook')}
      {item('questions', 'question', 'Questions')}
      {item('history', 'history', 'Precedents')}
      {item('queue', 'inbox', 'Approvals', p.pendingNominations ? <span className="count">{p.pendingNominations}</span> : null)}
      <div className="nav-section">Governance</div>
      {item('security', 'alert', 'Security', p.openAlerts ? <span className="count danger">{p.openAlerts}</span> : null)}
      {item('audit', 'shield', 'Audit')}
      {item('settings', 'settings', 'Settings')}
    </nav>
  )
}
