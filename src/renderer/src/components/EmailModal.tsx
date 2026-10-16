import { useEffect, useState } from 'react'
import type { EmailDraft, ReviewSession } from '@shared/types'
import { flagsFor, isCleared } from '@shared/derive'
import { Icon } from '../lib/icons'

export function EmailModal({ session, onClose }: { session: ReviewSession; onClose: () => void }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = () => {
    setDraft(null)
    setError(null)
    window.api.email.draft(session.id).then(setDraft, (e) => setError(String(e)))
  }
  useEffect(generate, [session.id])

  const rejected = Object.values(session.decisions).filter((d) => d.decision === 'rejected').length
  // Cleared clauses are accepted by default, so only the rest can be undecided.
  const undecided = session.clauses.filter((c) => { const f = flagsFor(session, c); return !f.decision && !isCleared(f) }).length

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="mail" />
          <h3>Response to counterparty</h3>
          {draft && <span className={`pill ${draft.generatedBy === 'ai' ? 'intent' : 'neutral'}`}>{draft.generatedBy === 'ai' ? 'AI draft' : 'template draft (demo/offline)'}</span>}
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          {undecided > 0 && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              <Icon name="alert" /> {undecided} clause{undecided === 1 ? '' : 's'} still undecided. The email covers only the {rejected} rejected clause{rejected === 1 ? '' : 's'} so far.
            </div>
          )}
          {error && <div className="banner danger">{error}</div>}
          {!draft && !error && (
            <div className="row-gap muted">
              <span className="spinner" style={{ color: 'var(--processing)' }} /> Drafting from your decisions, notes and redlines…
            </div>
          )}
          {draft && (
            <>
              <div className="field" style={{ maxWidth: 'none' }}>
                <label>Subject</label>
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
              <div className="field" style={{ maxWidth: 'none', marginBottom: 0 }}>
                <label>Body</label>
                <textarea rows={18} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={generate}>
            Regenerate
          </button>
          <button
            className="btn primary"
            disabled={!draft}
            onClick={async () => {
              await navigator.clipboard.writeText(`Subject: ${draft!.subject}\n\n${draft!.body}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Icon name="copy" /> {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
