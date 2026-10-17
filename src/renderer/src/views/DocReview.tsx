import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DocBlock, DocComment, OurComment, ReviewSession, SecurityAlert } from '@shared/types'
import { authorsOf, segmentsOf, theyChanged } from '@shared/changes'
import { Icon } from '../lib/icons'
import { AutoTextarea } from '../lib/AutoTextarea'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'
import { DocEditor } from '../components/DocEditor'

interface Props {
  session: ReviewSession
  panel: HTMLElement | null
  onChange: (s: ReviewSession) => void
  alert: SecurityAlert | null
  onOpenSecurity: () => void
  accountName?: string
  contractTitle?: string
  onOpenReview: (id: string) => void
  onNominationsChanged: () => void
}

type Draft = { blockId: string; quote?: string; replyTo?: string }

/**
 * A review: the contract as an editable document (their changes in blue, yours
 * in red, as tracked changes), and a right-hand column for the review as a whole
 * and the paragraph the caret is in.
 */
export function DocReview({ session, panel, onChange, alert, onOpenSecurity, accountName, contractTitle, onOpenReview }: Props) {
  const d = session.doc!
  const [focus, setFocus] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [redlineOpen, setRedlineOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFocus(null)
    setDraft(null)
  }, [session.id])

  const act = useCallback(
    async (p: Promise<ReviewSession>) => {
      try {
        onChange(await p)
        setError(null)
        return true
      } catch (e) {
        setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
        return false
      }
    },
    [onChange]
  )
  const onFocusBlock = useCallback((id: string | null) => setFocus(id), [])

  const changed = useMemo(() => d.blocks.filter(theyChanged), [d])
  const authors = authorsOf(changed.filter((b) => !b.untracked))
  const untracked = changed.filter((b) => b.untracked).length
  const ourEdits = Object.keys(d.edits).length
  const onHold = alert?.status === 'open'
  const block = focus ? (d.blocks.find((b) => b.id === focus) ?? null) : null

  const column = (
    <div className="rc">
      <section className="rc-section">
        <div className="rc-title">{session.version ? `${accountName} · ${contractTitle}` : session.docName}</div>
        {session.version && (
          <div className="faint rc-sub">
            Version {session.version}
            {session.previous && (
              <>
                {' '}
                · after{' '}
                <button className="link" onClick={() => onOpenReview(session.previous!.sessionId)}>
                  version {session.previous.version}
                </button>
              </>
            )}{' '}
            · {session.docName}
          </div>
        )}
        <div className="rc-stats">
          <span>
            <i className="dot theirs" /> {changed.length} paragraph{changed.length === 1 ? '' : 's'} changed{authors.length ? ` by ${authors.join(', ')}` : ''}
          </span>
          {untracked > 0 && (
            <span>
              <i className="dot untracked" /> {untracked} of them without Track Changes
            </span>
          )}
          <span>
            <i className="dot ours" /> {ourEdits} edited by you
          </span>
        </div>
        {d.baseline && (
          <p className="faint rc-note">
            {d.baseline.kind === 'sent'
              ? `Compared with what we sent for version ${d.baseline.version}.`
              : `On our paper: compared with our approved wording (${d.baseline.approved} paragraphs match it word for word).`}
          </p>
        )}
        {onHold && (
          <div className="banner danger">
            <Icon name="shield" /> On security hold: text addressed to an AI reviewer was found.{' '}
            <button className="link-btn" onClick={onOpenSecurity}>
              Security
            </button>
          </div>
        )}
        <div className="rc-actions">
          <button className="btn sm" onClick={() => setRedlineOpen(true)} disabled={onHold}>
            <Icon name="doc" size={14} /> Marked-up copy
          </button>
          <button className="btn sm primary" onClick={() => setEmailOpen(true)} disabled={onHold}>
            <Icon name="mail" size={14} /> Draft response
          </button>
        </div>
      </section>

      {block ? (
        <ParagraphPanel key={block.id} session={session} b={block} draft={draft?.blockId === block.id ? draft : null} setDraft={setDraft} act={act} />
      ) : (
        <section className="rc-section rc-empty">Click in the document to see that paragraph here: what changed in it, and its comments.</section>
      )}
    </div>
  )

  return (
    <div className="ed-wrap">
      {error && (
        <div className="banner danger dr-error">
          <Icon name="alert" /> {error}
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
      <DocEditor
        key={session.id}
        session={session}
        act={act}
        onFocusBlock={onFocusBlock}
        onComment={(blockId, quote) => {
          setFocus(blockId)
          setDraft({ blockId, quote })
        }}
      />
      {panel && createPortal(column, panel)}
      {emailOpen && <EmailModal session={session} onClose={() => setEmailOpen(false)} onMarkup={() => setRedlineOpen(true)} />}
      {redlineOpen && <RedlineModal session={session} onClose={() => setRedlineOpen(false)} />}
    </div>
  )
}

// ---- the paragraph the caret is in ------------------------------------------------------------

function ParagraphPanel({
  session,
  b,
  draft,
  setDraft,
  act
}: {
  session: ReviewSession
  b: DocBlock
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  act: (p: Promise<ReviewSession>) => Promise<boolean>
}) {
  const d = session.doc!
  const edit = d.edits[b.id]
  const theirs = b.comments ?? []
  const ours = d.comments.filter((c) => c.blockId === b.id)
  const loose = ours.filter((c) => !c.replyTo || !theirs.some((t) => t.id === c.replyTo))
  const authors = [...new Set(segmentsOf(b).filter((s) => s.op !== 'same').map((s) => s.author ?? 'Unknown'))]
  const last = d.lastRound?.[b.id]
  const where = b.ours ? 'New paragraph' : b.label ? `§${b.label.replace(/\.$/, '')}` : b.kind === 'heading' ? 'Heading' : 'Paragraph'
  const done = async (text?: string) => {
    if (text !== undefined && draft && !(await act(window.api.doc.comment(session.id, { ...draft, text })))) return
    setDraft(null)
  }

  return (
    <section className="rc-section">
      <h4 className="rp-h">{where}</h4>
      <div className="dr-facts">
        {b.ours && <span className="dr-fact">Added by you</span>}
        {!b.ours && b.kind === 'deleted' && <span className="dr-fact warn">Deleted{authors.length ? ` by ${authors.join(', ')}` : ''}</span>}
        {!b.ours && b.kind !== 'deleted' && theyChanged(b) && !b.untracked && <span className="dr-fact warn">Changed by {authors.join(', ')} (tracked)</span>}
        {b.untracked === 'sent' && <span className="dr-fact warn">Changed since we sent it, without Track Changes</span>}
        {b.untracked === 'template' && <span className="dr-fact warn">{b.standard ? `Differs from our approved “${b.standard}”` : 'Not in our standard wording'}</span>}
        {b.wasApproved && <span className="dr-fact">Was our approved “{b.wasApproved}”</span>}
        {b.approved && <span className="dr-fact ok">Our approved “{b.approved}”, word for word</span>}
        {!b.ours && edit !== undefined && <span className="dr-fact">{edit.trim() ? 'Edited by you' : 'Struck by you'}</span>}
        {!b.ours && !theyChanged(b) && edit === undefined && !b.approved && <span className="dr-fact">Unchanged</span>}
      </div>
      {last && (last.ourEdit || last.comments.length > 0) && (
        <div className="dr-last">
          <div className="dr-mini-h">Last round we proposed</div>
          <div className="dr-last-text">{last.sent}</div>
        </div>
      )}
      <div className="dr-card-actions">
        {b.kind === 'deleted' && edit === undefined && (
          <button className="btn sm" onClick={() => act(window.api.doc.edit(session.id, b.id, b.text))}>
            Restore paragraph
          </button>
        )}
        {!b.ours && edit !== undefined && (
          <button className="btn sm ghost" onClick={() => act(window.api.doc.edit(session.id, b.id, null))}>
            Undo my edits here
          </button>
        )}
        {b.ours && (
          <button className="btn sm ghost" onClick={() => act(window.api.doc.unsplit(session.id, b.id))}>
            Remove paragraph
          </button>
        )}
      </div>

      <div className="dr-mini-h rc-comments-h">
        Comments
        {!draft && (
          <button className="btn sm" onClick={() => setDraft({ blockId: b.id, replyTo: theirs[0]?.id })}>
            <Icon name="chat" size={13} /> {theirs.length ? 'Reply' : 'Add'}
          </button>
        )}
      </div>
      {!theirs.length && !ours.length && !draft && <p className="faint dr-small">None. Comments go to them in the marked-up copy. Select text to comment on part of the paragraph.</p>}
      <div className="dr-threads">
        {theirs.map((c) => (
          <TheirComment key={c.id} c={c}>
            {ours
              .filter((o) => o.replyTo === c.id)
              .map((o) => (
                <OurCommentCard key={o.id} c={o} reply onDelete={() => act(window.api.doc.uncomment(session.id, o.id))} />
              ))}
            {draft?.replyTo === c.id ? (
              <CommentForm placeholder={`Reply to ${c.author}`} onDone={done} />
            ) : (
              <button className="link-btn dr-reply" onClick={() => setDraft({ blockId: b.id, replyTo: c.id })}>
                Reply
              </button>
            )}
          </TheirComment>
        ))}
        {loose.map((o) => (
          <OurCommentCard key={o.id} c={o} onDelete={() => act(window.api.doc.uncomment(session.id, o.id))} />
        ))}
        {draft && !draft.replyTo && (
          <div className="dr-comment ours">
            {draft.quote && <div className="dr-quote">“{draft.quote}”</div>}
            <CommentForm placeholder="Comment (goes to them in the marked-up copy)" onDone={done} />
          </div>
        )}
      </div>
    </section>
  )
}

function TheirComment({ c, children }: { c: DocComment; children: ReactNode }) {
  return (
    <div className="dr-comment theirs">
      <div className="dr-comment-head">
        <strong>{c.author}</strong>
        {c.date && <span className="faint">{new Date(c.date).toLocaleDateString()}</span>}
      </div>
      <div>{c.text}</div>
      {children}
    </div>
  )
}

function OurCommentCard({ c, reply, onDelete }: { c: OurComment; reply?: boolean; onDelete: () => void }) {
  return (
    <div className={`dr-comment ours ${reply ? 'reply' : ''}`}>
      <div className="dr-comment-head">
        <strong>{c.by}</strong>
        <span className="faint">{new Date(c.at).toLocaleDateString()}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" title="Delete comment" onClick={onDelete}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {c.quote && <div className="dr-quote">“{c.quote}”</div>}
      <div>{c.text}</div>
    </div>
  )
}

function CommentForm({ placeholder, onDone }: { placeholder: string; onDone: (text?: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="dr-comment-form">
      <AutoTextarea
        autoFocus
        rows={2}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(undefined)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onDone(text)
        }}
      />
      <div className="row-gap">
        <button className="btn sm primary" disabled={!text.trim()} onClick={() => onDone(text)}>
          Comment
        </button>
        <button className="btn sm ghost" onClick={() => onDone(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
