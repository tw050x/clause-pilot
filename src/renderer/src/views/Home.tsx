import { useEffect, useState } from 'react'
import type { Account, DemoContract } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'
import type { View } from '../components/NavDrawer'

export function Home({
  demoMode,
  onOpenDemos,
  onWelcome,
  onNavigate,
  onOpenLive,
  account,
  accounts,
  onChooseAccount
}: {
  demoMode: boolean
  /** The client being worked on. Opening contracts needs one. */
  account: Account | null
  accounts: Account[]
  onChooseAccount: () => void
  onOpenDemos: () => void
  /** Live mode: ask which account and contract, then pick the file. */
  onOpenLive: () => void
  onWelcome: () => void
  onNavigate: (v: View) => void
}) {
  const [demos, setDemos] = useState<DemoContract[]>([])
  const [ws, setWs] = useState<{ library: number; playbook: number; precedents: number; reviews: number; nominations: number } | null>(null)
  const [hasKey, setHasKey] = useState(true)
  // Until the first live review, the setup checklist is the way in: it explains what opening a contract involves.
  const needsFirstReview = !demoMode && !!ws && ws.reviews === 0

  useEffect(() => {
    window.api.demo.list().then(setDemos)
    window.api.workspace.summary().then(setWs)
    window.api.settings.get().then((st) => setHasKey(st.hasApiKey))
  }, [demoMode])

  const browse = onOpenLive

  return (
    <div className="page">
      <h1>Contract review</h1>
      <p className="lede">
        Load a contract. Clause Pilot checks every clause against the pre-approved library, shows what happened in past negotiations, looks for clauses that quietly override others, and checks the contract against our standard positions. You read what needs reading and decide.
      </p>

      <section className="welcome-box">
        <div>
          <h3>New here?</h3>
          <p className="faint">A one-minute introduction to the app, demo mode and reviewing your own contracts.</p>
          <button className="btn" onClick={onWelcome}>
            Show the welcome tour
          </button>
        </div>
      </section>

      <section className="demos-link">
        <div>
          <h3>Demos</h3>
          <p className="faint">
            Short guided demos with sample contracts: reviewing a contract, the second and third drafts of a contract, adding to the library and adding to the playbook.
            {!demoMode && ' Opening them switches to demo mode; your own data is kept separately.'}
          </p>
          <button className={`btn ${demoMode ? 'primary' : ''}`} onClick={onOpenDemos}>
            Open demos <Chevron />
          </button>
        </div>
      </section>

      {demoMode ? null : !account && !needsFirstReview ? (
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
            Needs an Anthropic API key (Settings). The contract’s text is sent to Anthropic’s API for the AI checks, so only open documents you’re allowed to share outside the company.
          </p>
        </div>
      ) : null}

      {!demoMode && ws && (
        <SetupChecklist
          items={[
            {
              title: 'Choose or create a client account',
              detail: 'You work on one client at a time. Their contracts, drafts and reviews live under their account.',
              done: !!account,
              cta: { label: 'Choose account', onClick: onChooseAccount }
            },
            {
              title: 'Add your Anthropic API key',
              detail: 'Needed for the AI checks and Ask AI. It is stored encrypted on this computer.',
              done: hasKey,
              cta: { label: 'Open Settings', onClick: () => onNavigate('settings') }
            },
            {
              title: 'Add a playbook position',
              detail: 'Your standard position on a topic (for example governing law or the liability cap). Every contract is checked against each approved position.',
              done: ws.playbook > 0,
              cta: { label: 'Open Playbook', onClick: () => onNavigate('playbook') }
            },
            {
              title: 'Review your first contract',
              detail:
                'Word, PDF or text. Their tracked changes are listed to decide; nothing is sent anywhere unless you ask the AI about a change (that needs an API key, and sends the contract’s text to Anthropic’s API).',
              done: ws.reviews > 0,
              cta: account ? { label: 'Open a contract…', onClick: browse } : { label: 'Choose account first', onClick: onChooseAccount }
            },
            {
              title: 'Nominate wording for the library',
              detail: 'When you accept a change whose wording is fine every time, choose “Nominate this wording for the library”. Once approved, contracts on our paper are compared with it.',
              done: ws.nominations > 0 || ws.library > 0
            },
            {
              title: 'Approve it into the library',
              detail: 'Approved wording is accepted automatically in every future contract.',
              done: ws.library > 0,
              cta: { label: 'Open Approvals', onClick: () => onNavigate('queue') }
            }
          ]}
        />
      )}

    </div>
  )
}

interface ChecklistItem {
  title: string
  detail: string
  done: boolean
  cta?: { label: string; onClick: () => void }
}

/** Live-mode setup, ticked from the workspace's real state rather than by hand. */
function SetupChecklist({ items }: { items: ChecklistItem[] }) {
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
              ? 'Your workspace has a playbook and approved wording, so drafts on our paper are compared with it and only the differences need reading.'
              : 'Live mode starts from scratch, as it would for a real team. These steps make reviews useful.'}
          </p>
        </div>
        <span className="faint checklist-count">
          {done} of {items.length} done
        </span>
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
      <Icon name="users" size={20} />
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
