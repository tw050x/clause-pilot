import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DocBlock, DocComment, OurComment, ReviewSession, SecurityAlert } from '@shared/types'
import { authorsOf, changeKey, hasOpenChanges, isCleared, marksFor, segmentsOf, theyChanged } from '@shared/changes'
import { Icon } from '../lib/icons'
import { AutoTextarea } from '../lib/AutoTextarea'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'
import { DocEditor, type SelectedChange } from '../components/DocEditor'
import { canRedo, dependents, describe, details, type ActionItem } from '@shared/history'
import { whereOf } from '@shared/numbering'
import { diffSegments } from '@shared/diff'
import type { TrackedSegment } from '@shared/types'
import { Redline } from '../components/Redline'

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
  const [picked, setPicked] = useState<SelectedChange[] | null>(null)
  /** Each new selection is a new action: everything decided in it undoes together. */
  const [selection, setSelection] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const onSelectChanges = useCallback((x: SelectedChange[] | null) => {
    setPicked(x)
    if (x) {
      setSelection((n) => n + 1)
      setShowHistory(false)
    }
  }, [])

  useEffect(() => {
    setFocus(null)
    setDraft(null)
    setPicked(null)
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

  const changed = useMemo(() => d.blocks.filter((b) => hasOpenChanges(d, b)), [d])
  const decided = Object.keys(d.resolved ?? {}).length
  const authors = authorsOf(changed.filter((b) => !b.untracked))
  const untracked = changed.filter((b) => b.untracked).length
  const ourEdits = Object.keys(d.edits).length
  const cleared = d.blocks.filter((b) => b.kind !== 'heading' && !hasOpenChanges(d, b) && d.edits[b.id] === undefined && (isCleared(d, b) || segmentsOf(b).some((x, i) => x.op !== 'same' && d.resolved?.[changeKey(b.id, i)]))).length
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
            <i className="dot theirs" /> {changed.length} paragraph{changed.length === 1 ? '' : 's'} with changes to decide{authors.length ? ` by ${authors.join(', ')}` : ''}
          </span>
          {decided > 0 && (
            <span>
              <i className="dot decided" /> {decided} of their changes accepted or rejected
            </span>
          )}
          {untracked > 0 && (
            <span>
              <i className="dot untracked" /> {untracked} of them without Track Changes
            </span>
          )}
          <span>
            <i className="dot ours" /> {ourEdits} edited by you
          </span>
        </div>
        <div className="rc-key" title="The bar beside each paragraph">
          <span>
            <i className="bar checked" /> Nothing to check ({cleared})
          </span>
          <span>
            <i className="bar theirs" /> To decide
          </span>
          <span>
            <i className="bar ours" /> Your edits
          </span>
          <span>
            <i className="bar none" /> Not checked
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
          <button className={`btn sm ${showHistory ? 'on' : ''}`} onClick={() => setShowHistory((v) => !v)} title="Everything you've done in this review: undo or redo any of it">
            <Icon name="history" size={14} /> History{d.history?.length ? ` (${d.history.length})` : ''}
          </button>
          <button className="btn sm" onClick={() => setRedlineOpen(true)} disabled={onHold}>
            <Icon name="doc" size={14} /> Marked-up copy
          </button>
          <button className="btn sm primary" onClick={() => setEmailOpen(true)} disabled={onHold}>
            <Icon name="mail" size={14} /> Draft response
          </button>
        </div>
      </section>

      {showHistory ? (
        <HistoryPanel
          session={session}
          act={act}
          onClose={() => setShowHistory(false)}
          onJump={(blockId) => {
            document.querySelector(`p[data-block="${blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            setFocus(blockId)
          }}
        />
      ) : picked && picked.length > 0 ? (
        <SelectionPanel session={session} picked={picked} act={act} group={`sel:${session.id}:${selection}`} />
      ) : block ? (
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
        onSelectChanges={onSelectChanges}
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

// ---- the redlines in a selection ---------------------------------------------------------------


const snippet = (t: string) => (t.length > 140 ? `${t.slice(0, 140).trimEnd()}…` : t)

/**
 * The redlines in a selection, decided together: one Accept or Reject for all of theirs,
 * and one Revert for any of yours. To decide one change on its own, select just that.
 */
function SelectionPanel({ session, picked, act, group }: { session: ReviewSession; picked: SelectedChange[]; act: (p: Promise<ReviewSession>) => Promise<boolean>; group: string }) {
  const d = session.doc!
  const blocks = new Map(d.blocks.map((b) => [b.id, b]))
  const items = picked.filter((x) => blocks.has(x.blockId))
  const theirs = items.filter((x): x is Extract<SelectedChange, { kind: 'theirs' }> => x.kind === 'theirs')
  const ours = items.filter((x): x is Extract<SelectedChange, { kind: 'ours' }> => x.kind === 'ours')
  const statusOf = (x: Extract<SelectedChange, { kind: 'theirs' }>) => {
    const r = d.resolved?.[changeKey(x.blockId, x.seg)]
    if (r) return r
    // A change found by comparison is rejected by striking (or restoring) it with our edit.
    const b = blocks.get(x.blockId)!
    const ms = marksFor(d, b).filter((m) => m.seg === x.seg)
    if (b.untracked && ms.length && ms.every((m) => (m.theirs === 'ins' ? m.ours === 'del' : false))) return 'rejected'
    return 'open'
  }
  const open = theirs.filter((x) => statusOf(x) === 'open')
  const accepted = theirs.filter((x) => statusOf(x) === 'accepted').length
  const rejected = theirs.filter((x) => statusOf(x) === 'rejected').length
  const oursLeft = ours.filter((x) => marksFor(d, blocks.get(x.blockId)!).some((m) => m.ours === x.op && m.text === x.text))
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const decide = (outcome: 'accepted' | 'rejected') =>
    run(async () => {
      for (const x of open) if (!(await act(window.api.doc.resolve(session.id, x.blockId, x.seg, outcome, group)))) return
    })
  // Each revert shifts the rest, so each is looked up again in the paragraph as it then is.
  const revert = () =>
    run(async () => {
      let s = session
      for (const x of oursLeft) {
        const at = marksFor(s.doc!, s.doc!.blocks.find((b) => b.id === x.blockId)!).findIndex((m) => m.ours === x.op && m.text === x.text)
        if (at >= 0) s = await window.api.doc.undoOurs(session.id, x.blockId, at, group)
      }
      await act(Promise.resolve(s))
    })
  // What's been done with this selection is one action, undone together.
  const action = d.history?.find((a) => a.group === group && !a.undone)
  const counts = [
    theirs.length && `${theirs.length} of theirs`,
    ours.length && `${ours.length} of yours`
  ].filter(Boolean)

  return (
    <section className="rc-section">
      <h4 className="rp-h">
        {items.length === 1 ? '1 change selected' : `${items.length} changes selected`}
        {action && (
          <button className="btn sm" title={describe(d, action)} onClick={() => act(window.api.doc.undo(session.id, action.id))}>
            Undo
          </button>
        )}
      </h4>
      {items.length > 1 && <p className="faint dr-small">{counts.join(', ')}</p>}
      {theirs.length > 0 &&
        (open.length ? (
          <div className="dr-card-actions">
            <button className="btn sm accept" disabled={busy} onClick={() => decide('accepted')}>
              <Icon name="check" size={13} /> Accept{open.length > 1 ? ` all ${open.length}` : ''}
            </button>
            <button className="btn sm reject" disabled={busy} onClick={() => decide('rejected')}>
              Reject{open.length > 1 ? ` all ${open.length}` : ''}
            </button>
          </div>
        ) : (
          <p className={`dr-small sel-done ${rejected && !accepted ? 'rejected' : accepted && !rejected ? 'accepted' : ''}`}>
            {accepted && rejected ? `${accepted} accepted, ${rejected} rejected` : accepted ? (accepted === 1 ? 'Accepted' : `All ${accepted} accepted`) : rejected === 1 ? 'Rejected' : `All ${rejected} rejected`}
          </p>
        ))}
      {oursLeft.length > 0 && (
        <button className="btn sm ghost" disabled={busy} onClick={revert}>
          Revert your {oursLeft.length === 1 ? 'change' : `${oursLeft.length} changes`}
        </button>
      )}
      {open.length > 0 && open.length < theirs.length && <p className="faint dr-small">The rest of their changes here are already decided.</p>}
      <div className="sel-preview">
        {items.map((x, i) => {
          const b = blocks.get(x.blockId)!
          if (x.kind === 'theirs') {
            const seg = segmentsOf(b)[x.seg]
            const st = statusOf(x)
            return (
              <div key={i} className={`sel-line st-${st}`}>
                <span className="hist-where">{whereOf(d, b)}</span>
                {seg.op === 'ins' ? <ins className="th-ins">{snippet(seg.text)}</ins> : <del className="th-del">{snippet(seg.text)}</del>}
                {st !== 'open' && <span className={`sel-st ${st}`}> {st === 'accepted' ? 'Accepted' : 'Rejected'}</span>}
              </div>
            )
          }
          return (
            <div key={i} className="sel-line">
              <span className="hist-where">{whereOf(d, b)}</span>
              {x.op === 'ins' ? <ins className="us-ins">{snippet(x.text)}</ins> : <del className="us-del">{snippet(x.text)}</del>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---- history: undo and redo by action ------------------------------------------------------------

/** Just the changed parts of a redline, with a little context either side. */
function excerpt(segs: TrackedSegment[], context = 28): TrackedSegment[] {
  return segs.map((x, i) => {
    if (x.op !== 'same' || x.text.length <= context * 2) return x
    const first = i === 0
    const last = i === segs.length - 1
    if (first) return { ...x, text: '…' + x.text.slice(-context) }
    if (last) return { ...x, text: x.text.slice(0, context) + '…' }
    return { ...x, text: x.text.slice(0, context) + ' … ' + x.text.slice(-context) }
  })
}

const OUTCOME = { accepted: 'Accepted', rejected: 'Rejected' } as const

/** One thing an action did: where, and the text, marked up as it was changed. */
function ItemView({ item, onJump }: { item: ActionItem; onJump?: (blockId: string) => void }) {
  const where = onJump ? (
    <button
      className="link-btn hist-where"
      onClick={(e) => {
        e.stopPropagation()
        onJump(item.blockId)
      }}
    >
      {item.where}
    </button>
  ) : (
    <span className="hist-where">{item.where}</span>
  )
  const short = (t: string) => (t.length > 160 ? `${t.slice(0, 160).trimEnd()}…` : t)
  if (item.kind === 'resolved')
    return (
      <div className="hist-row">
        {where} <span className={`sel-st ${item.outcome ?? ''}`}>{item.outcome ? OUTCOME[item.outcome] : 'Reopened'}</span> their {item.op === 'ins' ? 'insertion' : 'deletion'}:{' '}
        {item.op === 'ins' ? <ins className="th-ins">{short(item.text)}</ins> : <del className="th-del">{short(item.text)}</del>}
      </div>
    )
  if (item.kind === 'edited')
    return (
      <div className="hist-row rl-ours">
        {where} <Redline segments={excerpt(diffSegments(item.before, item.after))} />
      </div>
    )
  if (item.kind === 'paragraph')
    return (
      <div className="hist-row">
        {where} {item.added ? 'added' : 'removed'}: {item.added ? <ins className="us-ins">{short(item.text)}</ins> : <del className="us-del">{short(item.text)}</del>}
      </div>
    )
  return (
    <div className="hist-row">
      {where} {item.added ? 'comment' : 'comment deleted'}: <span className="hist-comment">“{short(item.text)}”</span>
    </div>
  )
}

function HistoryPanel({ session, act, onClose, onJump }: { session: ReviewSession; act: (p: Promise<ReviewSession>) => Promise<boolean>; onClose: () => void; onJump: (blockId: string) => void }) {
  const d = session.doc!
  const history = [...(d.history ?? [])].reverse()
  const [confirm, setConfirm] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="rc-section">
      <h4 className="rp-h">
        History
        <button className="link-btn" onClick={onClose}>
          Close
        </button>
      </h4>
      {!history.length && <p className="faint dr-small">Nothing yet. Each selection you accept or reject in, and each stretch of typing in a paragraph, becomes one action here that you can undo.</p>}
      <div className="hist-list">
        {history.map((a) => {
          const deps = a.undone ? [] : dependents(d.history!, a)
          const redoable = a.undone && canRedo(d, a)
          const items = details(d, a)
          const expanded = open === a.id
          return (
            <div key={a.id} className={`hist-item ${a.undone ? 'undone' : ''} ${expanded ? 'open' : ''}`} onClick={() => setOpen(expanded ? null : a.id)}>
              <div className="hist-label">{describe(d, a)}</div>
              <div className="hist-items">
                {(expanded ? items : items.slice(0, 2)).map((x, i) => (
                  <ItemView key={i} item={x} onJump={expanded ? onJump : undefined} />
                ))}
                {!expanded && items.length > 2 && <div className="faint hist-more">+ {items.length - 2} more · click to see all</div>}
              </div>
              <div className="hist-meta faint">
                {a.by} · {new Date(a.at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                {a.undone && ' · undone'}
              </div>
              {confirm === a.id ? (
                <div className="hist-confirm" onClick={(e) => e.stopPropagation()}>
                  <p className="dr-small">
                    Later action{deps.length === 1 ? '' : 's'} changed the same text, so {deps.length === 1 ? 'it has' : 'they have'} to be undone too:
                  </p>
                  <ul>
                    {deps.map((x) => (
                      <li key={x.id}>{describe(d, x)}</li>
                    ))}
                  </ul>
                  <div className="row-gap">
                    <button
                      className="btn sm primary"
                      onClick={async () => {
                        if (await act(window.api.doc.undo(session.id, a.id))) setConfirm(null)
                      }}
                    >
                      Undo all {deps.length + 1}
                    </button>
                    <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row-gap" onClick={(e) => e.stopPropagation()}>
                  {!a.undone && (
                    <button className="btn sm" onClick={() => (deps.length ? setConfirm(a.id) : act(window.api.doc.undo(session.id, a.id)))}>
                      Undo{deps.length ? ` (+${deps.length} later)` : ''}
                    </button>
                  )}
                  {a.undone && (
                    <button
                      className="btn sm"
                      disabled={!redoable}
                      title={redoable ? undefined : 'Something has changed the same text since, so this can’t be redone.'}
                      onClick={() => act(window.api.doc.redo(session.id, a.id))}
                    >
                      Redo
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
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
  const done = async (text?: string) => {
    if (text !== undefined && draft && !(await act(window.api.doc.comment(session.id, { ...draft, text })))) return
    setDraft(null)
  }

  return (
    <section className="rc-section">
      <h4 className="rp-h">{whereOf(d, b)}</h4>
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
            Revert my edits here
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
