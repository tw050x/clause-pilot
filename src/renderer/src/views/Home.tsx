import { useEffect, useState } from 'react'
import type { Account, ReviewSummary, Settings } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'
import type { View } from '../components/NavDrawer'
import { AddClauseModal, AddPositionModal } from '../components/SetupModals'

export function Home({
  onNavigate,
  onOpenLive,
  account,
  accounts,
  onChooseAccount,
  onOpenReview
}: {
  onOpenReview: (id: string) => void
  /** The client being worked on. Opening contracts needs one. */
  account: Account | null
  accounts: Account[]
  onChooseAccount: () => void
  /** Ask which account and contract, then pick the file. */
  onOpenLive: () => void
  onNavigate: (v: View) => void
}) {
  const [ws, setWs] = useState<{ library: number; playbook: number; precedents: number; reviews: number; nominations: number; playbookProposed: number } | null>(null)
  // Adding a clause or a playbook position from the setup steps.
  const [adding, setAdding] = useState<'clause' | 'position' | null>(null)
  const refreshWs = () => void window.api.workspace.summary().then(setWs)
  const [settings, setSettings] = useState<Settings | null>(null)
  // Until the first review, the setup checklist is the way in: it explains what opening a contract involves.
  const needsFirstReview = !!ws && ws.reviews === 0
  const ai = settings ? (settings.demoMode ? 'demo' : settings.aiProvider) : 'claude'
  const aiReady = !!settings && (ai === 'vllm' ? !!(settings.vllmUrl && settings.vllmModel) : ai === 'demo' ? !!settings.demoUrl : settings.hasApiKey)
  const aiName = ai === 'vllm' ? 'your vLLM server' : ai === 'demo' ? 'the demo server' : 'Anthropic’s API'

  useEffect(() => {
    window.api.workspace.summary().then(setWs)
    window.api.settings.get().then(setSettings)
  }, [])

  const browse = onOpenLive
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SETUP_DISMISSED) === '1'
    } catch {
      return false
    }
  })
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(SETUP_DISMISSED, '1')
    } catch {
      /* not remembered; hidden until the app restarts */
    }
  }

  return (
    <div className="page">
      <h1>Contract review</h1>
      <p className="lede">
        Open a contract as an editable document, like Word with Track Changes on. Their changes are shown to accept or reject, anything that differs from what we sent or from our approved wording is marked, and your edits and comments become the marked-up copy and the cover email. The AI checks intent and answers questions when you ask.
      </p>

      {!account && !needsFirstReview ? (
        <ChooseAccount onChoose={onChooseAccount} />
      ) : !needsFirstReview ? (
        <div className="home-upload-block" style={{ marginBottom: 28, width: 'fit-content', maxWidth: 640 }}>
          <div className="row-gap">
            <button className="btn primary home-upload" onClick={browse}>
              <Icon name="upload" /> Open a contract for {account?.name}…
            </button>
            <span className="faint">PDF, Word (.docx) or text</span>
          </div>
          <p className="upload-note">
            Reviewing works without AI. When you ask the AI about something, the contract’s text is sent to {aiName}, so only open documents you’re allowed to share with it.
          </p>
        </div>
      ) : null}

      <InProgress onOpen={onOpenReview} />

      {adding === 'clause' && <AddClauseModal onClose={() => setAdding(null)} onAdded={refreshWs} />}
      {adding === 'position' && <AddPositionModal onClose={() => setAdding(null)} onAdded={refreshWs} />}

      {/* For a new team setting up: not in demo mode, whose workspace is already set up. */}
      {ws && !dismissed && !settings?.demoMode && (
        <SetupChecklist
          onDismiss={dismiss}
          items={[
            {
              title: 'Choose or create a client account',
              detail: 'You work on one client at a time. Their contracts, drafts and reviews live under their account.',
              done: !!account,
              cta: { label: 'Choose account', onClick: onChooseAccount }
            },
            {
              title: 'Set up the AI',
              detail: 'Claude (with an Anthropic API key) or your own vLLM server. Needed for the questions on highlighted text, the change review and the Agent; everything else works without it.',
              done: aiReady,
              cta: { label: 'Open Settings', onClick: () => onNavigate('settings') }
            },
            {
              title: 'Add a clause',
              detail: 'Our approved wording for a topic (for example governing law). Contracts are compared with it: matching wording needs no reading, and the AI checks whether anything else means the same.',
              done: ws.library > 0,
              cta: { label: 'Add a clause', onClick: () => setAdding('clause') }
            },
            {
              title: 'Add to the playbook',
              detail:
                ws.playbook === 0 && ws.playbookProposed > 0
                  ? 'Proposed, and waiting for approval: approve it on the Approvals page and it joins the playbook.'
                  : 'Your standard position on a topic (for example governing law or the liability cap). Every contract is checked against each approved position.',
              done: ws.playbook > 0,
              cta: ws.playbook === 0 && ws.playbookProposed > 0 ? { label: 'Open Approvals', onClick: () => onNavigate('queue') } : { label: 'Add a position', onClick: () => setAdding('position') }
            },
            {
              title: 'Review your first contract',
              detail:
                `Word, PDF or text. Their tracked changes are shown to decide; nothing is sent anywhere unless you ask the AI (which sends the contract’s text to ${aiName}).`,
              done: ws.reviews > 0,
              cta: account ? { label: 'Open a contract…', onClick: browse } : { label: 'Choose account first', onClick: onChooseAccount }
            }
          ]}
        />
      )}

    </div>
  )
}

/**
 * The reviews still in progress, most recently worked on first, for quick access: the latest
 * version of each contract (an earlier one is superseded), not closed, its contract not archived.
 * Any client's: opening one switches to its client.
 */
function InProgress({ onOpen }: { onOpen: (id: string) => void }) {
  // Read afresh each time the Start page opens, so "last worked on" is current.
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  useEffect(() => {
    window.api.review.list().then(setReviews)
  }, [])
  const latest = new Map<string, ReviewSummary>()
  for (const r of reviews.filter((x) => !x.original)) {
    const key = r.contractId ?? r.id
    const have = latest.get(key)
    if (!have || (r.version ?? 0) > (have.version ?? 0)) latest.set(key, r)
  }
  const open = [...latest.values()].filter((r) => !r.closed && !r.contractArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (!open.length) return null
  const shown = open.slice(0, MAX_RECENT)
  return (
    <section className="home-recent">
      <h2 className="home-h">
        In progress <span className="faint">{open.length > shown.length ? `${shown.length} most recent of ${open.length}` : open.length}</span>
      </h2>
      <div className="recent-list">
        {shown.map((r) => (
          <button key={r.id} className="recent-review" onClick={() => onOpen(r.id)}>
            <span className="recent-main">
              <strong>{r.contractTitle ?? r.docName}</strong>
              <span className="faint">
                {[r.accountName, r.version ? `Version ${r.version}` : null, r.docName].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="recent-progress">
              {r.clauses ? (
                <>
                  <span className="recent-bar" aria-hidden>
                    <span style={{ width: `${Math.round((r.decided / r.clauses) * 100)}%` }} />
                  </span>
                  <span className="faint">
                    {r.decided} of {r.clauses} decided
                  </span>
                </>
              ) : (
                <span className="faint">No changes to decide</span>
              )}
            </span>
            <span className="recent-when faint" title={new Date(r.updatedAt).toLocaleString()}>
              {ago(r.updatedAt)}
            </span>
            <Chevron size={12} />
          </button>
        ))}
      </div>
    </section>
  )
}

const MAX_RECENT = 6

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86400) return 'yesterday'
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`
  return new Date(iso).toLocaleDateString()
}

interface ChecklistItem {
  title: string
  detail: string
  done: boolean
  cta?: { label: string; onClick: () => void }
}

/** Remembers that the finished setup card was dismissed. Clear all data forgets it. */
export const SETUP_DISMISSED = 'cp.setupDismissed'

/** Live-mode setup, ticked from the workspace's real state rather than by hand. Once every step is done it can be dismissed. */
function SetupChecklist({ items, onDismiss }: { items: ChecklistItem[]; onDismiss: () => void }) {
  const done = items.filter((i) => i.done).length
  const complete = done === items.length
  const next = items.findIndex((i) => !i.done)
  return (
    <section className="checklist">
      <div className="checklist-head">
        <div>
          <h3>{complete ? 'You’re set up' : 'Get set up'}</h3>
          <p className="faint">
            {complete
              ? 'Your AI is set up and your workspace has a playbook, so every review can be checked against our standard positions.'
              : 'The workspace starts from scratch, as it would for a real team. These steps make reviews useful.'}
          </p>
        </div>
        {complete ? (
          <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={onDismiss}>
            <Icon name="x" size={16} />
          </button>
        ) : (
          <span className="faint checklist-count">
            {done} of {items.length} done
          </span>
        )}
      </div>
      <div className="progress" style={{ margin: '10px 0 6px' }}>
        <div style={{ width: `${(done / items.length) * 100}%`, background: 'var(--exact)' }} />
      </div>
      {!complete && (
        <ol className="checklist-items">
          {items.map((it, i) => (
            <li key={it.title} className={`${it.done ? 'done' : ''} ${i === next ? 'next' : ''}`}>
              <span className="check" aria-hidden>
                {it.done ? <Icon name="check" size={13} stroke={2.4} /> : i + 1}
              </span>
              <div className="checklist-text">
                <strong>{it.title}</strong>
                {!it.done && <span>{it.detail}</span>}
              </div>
              {!it.done && it.cta && (
                <button className={`btn sm ${i === next ? 'primary' : ''}`} onClick={it.cta.onClick}>
                  {it.cta.label} <Chevron />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Shown in place of "Open a contract" until a client is chosen. */
function ChooseAccount({ onChoose }: { onChoose: () => void }) {
  return (
    <section className="choose-account">
      <div>
        <h3>Choose a client to work on</h3>
        <p className="faint">Contracts, drafts and reviews belong to a client account. Pick one (or create one) to open contracts and see its reviews.</p>
        <button className="btn primary" onClick={onChoose}>
          Choose account <Chevron />
        </button>
        </div>
    </section>
  )
}
