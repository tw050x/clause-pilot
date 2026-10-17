import { useEffect, useState } from 'react'
import type { EmailDraft, ReviewSession } from '@shared/types'
import { changeSets, statusOf } from '@shared/changes'
import { Icon } from '../lib/icons'

export function EmailModal({ session, onClose, onMarkup }: { session: ReviewSession; onClose: () => void; onMarkup: () => void }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = () => {
    setDraft(null)
    setError(null)
    window.api.email.draft(session.id).then(setDraft, (e) => setError(String(e)))
  }
  useEffect(generate, [session.id])

  const doc = session.doc
  const sets = doc ? changeSets(doc) : []
  const undecided = doc ? sets.filter((x) => statusOf(doc, x) === 'open').length : 0
  const flagged = doc ? sets.filter((x) => statusOf(doc, x) === 'flagged').length : 0
  const answered = !!doc && (sets.some((x) => statusOf(doc, x) === 'countered') || Object.keys(doc.edits).length > 0 || doc.comments.length > 0)

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="mail" />
          <h3>Response to counterparty</h3>
          {draft && <span className={`pill ${draft.generatedBy === 'ai' ? 'intent' : 'neutral'}`}>{draft.generatedBy === 'ai' ? 'AI draft' : 'built from your decisions'}</span>}
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          {undecided > 0 && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              <Icon name="alert" />{' '}
              {`${undecided} of their change${undecided === 1 ? '' : 's'} still to decide. The email covers what you've answered so far.`}
            </div>
          )}
          {flagged > 0 && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              <Icon name="alert" /> {flagged} change{flagged === 1 ? ' is' : 's are'} flagged for internal review and left out of the email.
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
          {answered && (
            <span className="faint" style={{ marginRight: 'auto', alignSelf: 'center', fontSize: 12.5 }}>
              Attach the{' '}
              <button className="link-btn" onClick={onMarkup}>
                marked-up copy (.docx)
              </button>{' '}
              the email refers to.
            </span>
          )}
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
