import type { ReviewSession, ReviewSummary } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'

export type View = 'home' | 'accounts' | 'review' | 'reviews' | 'library' | 'playbook' | 'history' | 'queue' | 'security' | 'audit' | 'settings'

interface Props {
  open: boolean
  view: View
  setView: (v: View) => void
  session: ReviewSession | null
  pendingNominations: number
  openAlerts: number
  reviews: ReviewSummary[]
  onOpenReview: (id: string) => void
}

export function NavDrawer({ open, view, setView, session, pendingNominations, openAlerts, reviews, onOpenReview }: Props) {
  const item = (v: View, icon: string, label: string, extra?: React.ReactNode) => (
    <button className={`nav-item ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
      <Icon name={icon} />
      <span style={{ minWidth: 0 }}>
        {label}
      </span>
      {extra}
      <span className="nav-chevron">
        <Chevron />
      </span>
    </button>
  )
  return (
    <nav className={`nav ${open ? '' : 'closed'}`} aria-hidden={!open}>
      {item('home', 'home', 'Start')}
      {item('accounts', 'users', 'Accounts')}
      <div className="nav-section">Recent reviews</div>
      {/* Fills the space between the top items and Knowledge; scrolls when there are many. */}
      <div className="nav-recent">
        {reviews.length === 0 && <p className="nav-empty">No reviews yet.</p>}
        {reviews.map((r) => (
          <button
            key={r.id}
            className={`nav-item recent ${view === 'review' && session?.id === r.id ? 'active' : ''}`}
            onClick={() => onOpenReview(r.id)}
            title={r.docName}
          >
            <span style={{ minWidth: 0 }}>
              <span className="recent-name">{r.accountName ? `${r.accountName} · ${r.contractTitle}` : r.docName.replace(/\.[a-z]+$/i, '')}</span>
              <span className="sub">
                {r.version ? `Version ${r.version} · ` : ''}
                {new Date(r.createdAt).toLocaleDateString()}
                {r.rejected > 0 && ` · ${r.rejected} rejected`}
              </span>
            </span>
            <span className="nav-chevron">
              <Chevron />
            </span>
          </button>
        ))}
      </div>
      {item('reviews', 'list', 'All reviews')}
      <div className="nav-section">Knowledge</div>
      {item('library', 'book', 'Library')}
      {item('playbook', 'scales', 'Playbook')}
      {item('history', 'history', 'Precedents')}
      {item('queue', 'inbox', 'Approvals', pendingNominations ? <span className="count">{pendingNominations}</span> : null)}
      <div className="nav-section">Governance</div>
      {item('security', 'alert', 'Security', openAlerts ? <span className="count danger">{openAlerts}</span> : null)}
      {item('audit', 'shield', 'Audit')}
      {item('settings', 'settings', 'Settings')}
    </nav>
  )
}
