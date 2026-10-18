import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AiQuestion, AiTaskRun, DocBlock, DocComment, LibraryClause, OurComment, ReviewSession, SecurityAlert } from '@shared/types'
import { aiSame, authorsOf, changeKey, groupOf, hasOpenChanges, intentCandidate, isCleared, markedChecked, marksFor, needsReading, segmentsOf, stillOpen, theyChanged, commentResolved } from '@shared/changes'
import { Chevron, Icon } from '../lib/icons'
import { AutoTextarea } from '../lib/AutoTextarea'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'
import { DocEditor, flashParagraphs, type Highlight, type SelectedChange } from '../components/DocEditor'
import { AiAnswer } from '../components/AiAnswer'
import { RawModal } from '../components/RawModal'
import { canRedo, dependents, describe, details, type ActionItem } from '@shared/history'
import { whereOf } from '@shared/numbering'
import { questionIdOf } from '@shared/questions'
import { diffSegments } from '@shared/diff'
import type { TrackedSegment } from '@shared/types'
import { Redline } from '../components/Redline'
import { Markdown } from '../components/Markdown'

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
  /** Debug mode (Settings): show raw AI responses. */
  debug: boolean
}

type Draft = { blockId: string; quote?: string; replyTo?: string }

/** Our library, for naming the clauses a paragraph was matched with. Loaded once per review screen. */
let libraryCache: Promise<LibraryClause[]> | null = null
function useLibrary(): Map<string, LibraryClause> {
  const [lib, setLib] = useState<Map<string, LibraryClause>>(new Map())
  useEffect(() => {
    libraryCache ??= window.api.kb.library()
    libraryCache.then((l) => setLib(new Map(l.map((c) => [c.id, c]))))
  }, [])
  return lib
}

/**
 * A review: the contract as an editable document (their changes in blue, yours
 * in red, as tracked changes), and a right-hand column for the review as a whole
 * and the paragraph the caret is in.
 */
export function DocReview({ session, panel, onChange, alert, onOpenSecurity, accountName, contractTitle, onOpenReview, debug }: Props) {
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
  // The stats and the key to the bars take room at the top; they can be folded to one line.
  // Remembered on this machine (a convenience only).
  const [showKey, setShowKey] = useState(() => {
    try {
      return localStorage.getItem('cp.showKey') !== '0'
    } catch {
      return true
    }
  })
  const toggleKey = (on: boolean) => {
    setShowKey(on)
    try {
      localStorage.setItem('cp.showKey', on ? '1' : '0')
    } catch {
      /* not stored: still works for this session */
    }
  }
  /** Text you highlighted (not a caret placed in a change): the paragraph it starts in, and the text. */
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const highlighted = !!highlight
  /** A paragraph whose comments were asked for (its comment badge). */
  const [commentsFor, setCommentsFor] = useState<string | null>(null)
  const onSelectChanges = useCallback((x: SelectedChange[] | null, hl?: Highlight) => {
    setPicked(x)
    setHighlight(x && hl ? hl : null)
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
  const onFocusBlock = useCallback((id: string | null) => {
    setFocus(id)
    setCommentsFor((c) => (c === id ? c : null))
  }, [])

  useEffect(() => {
    libraryCache = null
  }, [session.id])
  const changed = useMemo(() => d.blocks.filter((b) => stillOpen(d, b)), [d])
  const toRead = d.blocks.filter((b) => needsReading(d, b)).length
  const decided = Object.keys(d.resolved ?? {}).length
  const authors = authorsOf(changed.filter((b) => !b.untracked))
  const untracked = changed.filter((b) => b.untracked).length
  const ourEdits = Object.keys(d.edits).length
  const cleared = d.blocks.filter((b) => b.kind !== 'heading' && !hasOpenChanges(d, b) && d.edits[b.id] === undefined && (isCleared(d, b) || segmentsOf(b).some((x, i) => x.op !== 'same' && d.resolved?.[changeKey(b.id, i)]))).length
  const onHold = alert?.status === 'open'
  // Paragraphs the AI could check for meaning that it hasn't checked as they now read.
  const aiOk = d.blocks.filter((b) => intentCandidate(d, b) && aiSame(d, b)).length
  const block = focus ? (d.blocks.find((b) => b.id === focus) ?? null) : null
  const jumpTo = (blockId: string) => {
    document.querySelector(`p[data-block="${blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFocus(blockId)
  }
  const hlBlock = highlight ? (d.blocks.find((b) => b.id === highlight.blockId) ?? null) : null

  const column = (
    <div className="rc">
      <section className="rc-section">
        <div className="rc-title-row">
          <div className="rc-title">{session.version ? `${accountName} · ${contractTitle}` : session.docName}</div>
          <button
            className="btn sm ghost"
            title={session.closed ? 'Show it on the Reviews page again' : 'Done with it: hide it on the Reviews page (nothing is deleted)'}
            onClick={() => act(window.api.review.close(session.id, !session.closed))}
          >
            {session.closed ? 'Reopen' : 'Close review'}
          </button>
        </div>
        {session.closed && (
          <div className="banner info">
            Closed by {session.closed.by} on {new Date(session.closed.at).toLocaleDateString()}. It’s kept, but hidden on the Reviews page.
          </div>
        )}
        {session.original && (
          <div className="banner info">The original we sent them, kept to compare their first draft with. There’s nothing to review in it.</div>
        )}
        {session.version !== undefined && (
          <div className="faint rc-sub">
            {session.original ? 'Original' : `Version ${session.version}`}
            {session.previous && (
              <>
                {' '}
                · after{' '}
                <button className="link" onClick={() => onOpenReview(session.previous!.sessionId)}>
                  {session.previous.version === 0 ? 'the original we sent' : `version ${session.previous.version}`}
                </button>
              </>
            )}{' '}
            · {session.docName}
          </div>
        )}
        {showKey ? (
          <>
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
              {toRead > 0 && (
                <span title="Paragraphs not in our approved wording and with nothing to accept or reject: read them, then mark them as checked">
                  <i className="dot none" /> {toRead} paragraph{toRead === 1 ? '' : 's'} to read
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
                <i className="bar ai" /> Intent check passed, by AI ({aiOk})
              </span>
              <span>
                <i className="bar theirs" /> To decide
              </span>
              <span>
                <i className="bar ours" /> Your edits
              </span>
              <span>
                <i className="bar none" /> To read (not our wording)
              </span>
            </div>
            {d.baseline && (
              <p className="faint rc-note">
                {d.baseline.kind === 'sent'
                  ? d.baseline.version === 0
                    ? 'Compared with the original we sent: anything they changed shows, tracked or not.'
                    : `Compared with what we sent for version ${d.baseline.version}.`
                  : `On our paper: compared with our approved wording (${d.baseline.approved} paragraphs match it word for word).`}
              </p>
            )}
            {!d.baseline && toRead > 0 && (
              <p className="faint rc-note">
                Their paper: paragraphs that aren’t word for word our approved wording need reading. The intent check compares each with the closest of our clauses; mark each one checked once you’ve read it.
              </p>
            )}
            <button className="link-btn rc-key-toggle" onClick={() => toggleKey(false)}>
              Hide key
            </button>
          </>
        ) : (
          <div className="rc-key-short">
            <span>
              {changed.length} to decide{toRead ? ` · ${toRead} to read` : ''} · {ourEdits} edited by you
            </span>
            <button className="link-btn rc-key-toggle" onClick={() => toggleKey(true)}>
              Show key
            </button>
          </div>
        )}
        {onHold && (
          <div className="banner danger">
            <Icon name="shield" /> On security hold: text addressed to an AI reviewer was found.{' '}
            <button className="link-btn" onClick={onOpenSecurity}>
              Security
            </button>
          </div>
        )}
      </section>

      {!showHistory && (
        <AiSection
          session={session}
          highlight={highlight}
          onHold={onHold}
          onChange={onChange}
          debug={debug}
          run={async (questionId) => {
            if (!highlight) return
            // The question is asked; its answer arrives on the card as session updates. Several can run at once.
            await act(window.api.ai.run(session.id, { questionId, blockIds: highlight.blockIds, quote: highlight.quote }).then((r) => r.session))
          }}
        />
      )}

      {showHistory ? (
        <HistoryPanel session={session} act={act} onClose={() => setShowHistory(false)} onJump={jumpTo} />
      ) : picked && picked.length > 0 ? (
        <>
          <SelectionPanel session={session} picked={picked} act={act} group={`sel:${session.id}:${selection}`} highlighted={highlighted} />
          {highlight && hlBlock && (
            <section className="rc-section">
              <CommentsBlock session={session} b={hlBlock} quote={highlight.quote} draft={draft?.blockId === hlBlock.id ? draft : null} setDraft={setDraft} act={act} />
            </section>
          )}
        </>
      ) : highlight && hlBlock ? (
        <ParagraphPanel key={hlBlock.id} session={session} b={hlBlock} quote={highlight.quote} showComments draft={draft?.blockId === hlBlock.id ? draft : null} setDraft={setDraft} act={act} />
      ) : block ? (
        <ParagraphPanel
          key={block.id}
          session={session}
          b={block}
          showComments={commentsFor === block.id || draft?.blockId === block.id}
          draft={draft?.blockId === block.id ? draft : null}
          setDraft={setDraft}
          act={act}
        />
      ) : (
        <section className="rc-section rc-empty">Click in the document to see that paragraph here: what changed in it, and its comments.</section>
      )}
    </div>
  )

  return (
    <div className="dr-main">
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
        onShowComments={(id) => {
          setFocus(id)
          setCommentsFor(id)
          setPicked(null)
          setHighlight(null)
        }}
        onComment={(blockId, quote) => {
          setFocus(blockId)
          setDraft({ blockId, quote })
        }}
      />
      {panel && createPortal(column, panel)}
      {emailOpen && <EmailModal session={session} onClose={() => setEmailOpen(false)} onMarkup={() => setRedlineOpen(true)} />}
      {redlineOpen && <RedlineModal session={session} onClose={() => setRedlineOpen(false)} />}
    </div>
      {/* Fixed at the bottom of the document: what you do with the review as a whole. */}
      <div className="doc-footer">
        <button className={`btn sm ${showHistory ? 'on' : ''}`} onClick={() => setShowHistory((v) => !v)} title="Everything you've done in this review: undo or redo any of it (in the review column)">
          <Icon name="history" size={14} /> History{d.history?.length ? ` (${d.history.length})` : ''}
        </button>
        <button className="btn sm" onClick={() => setRedlineOpen(true)} disabled={onHold}>
          <Icon name="doc" size={14} /> Marked-up copy
        </button>
        <button className="btn sm primary" onClick={() => setEmailOpen(true)} disabled={onHold}>
          <Icon name="mail" size={14} /> Draft response
        </button>
      </div>
    </div>
  )
}

// ---- the redlines in a selection ---------------------------------------------------------------


const snippet = (t: string) => (t.length > 140 ? `${t.slice(0, 140).trimEnd()}…` : t)

/**
 * The redlines in a selection, decided together: one Accept or Reject for all of theirs,
 * and one Revert for any of yours. To decide one change on its own, select just that.
 */
function SelectionPanel({
  session,
  picked,
  act,
  group,
  highlighted
}: {
  session: ReviewSession
  picked: SelectedChange[]
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  group: string
  highlighted: boolean
}) {
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
    const ms = marksFor(d, b).filter((m) => m.seg === x.seg && m.theirs === 'ins')
    if (b.untracked && !ms.length) {
      const g = groupOf(b, x.seg)
      const ins = marksFor(d, b).filter((m) => m.seg !== undefined && g.includes(m.seg) && m.theirs === 'ins')
      if (ins.length && ins.every((m) => m.ours === 'del')) return 'rejected'
      return 'open'
    }
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
      // A replacement is one change: its deletion and insertion are decided together.
      for (const x of open)
        for (const seg of groupOf(blocks.get(x.blockId)!, x.seg)) if (!(await act(window.api.doc.resolve(session.id, x.blockId, seg, outcome, group)))) return
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
            const st = statusOf(x)
            return (
              <div key={i} className={`sel-line st-${st}`}>
                <span className="hist-where">{whereOf(d, b)}</span>
                {groupOf(b, x.seg).map((k, n) => {
                  const seg = segmentsOf(b)[k]
                  return (
                    <span key={k}>
                      {n > 0 && ' → '}
                      {seg.op === 'ins' ? <ins className="th-ins">{snippet(seg.text)}</ins> : <del className="th-del">{snippet(seg.text)}</del>}
                    </span>
                  )
                })}
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
  if (item.kind === 'checked')
    return (
      <div className="hist-row">
        {where} {item.added ? 'marked as checked' : 'unmarked'}: <span className="faint">{short(item.text)}</span>
      </div>
    )
  if (item.kind === 'resolvedComment')
    return (
      <div className="hist-row">
        {where} {item.done ? 'comment resolved' : 'comment reopened'}: <span className="hist-comment">“{short(item.text)}”</span>
      </div>
    )
  return (
    <div className="hist-row">
      {where} {item.was !== undefined ? 'comment edited' : item.added ? 'comment' : 'comment deleted'}:{' '}
      {item.was !== undefined && (
        <>
          <span className="hist-comment del">“{short(item.was)}”</span> →{' '}
        </>
      )}
      <span className="hist-comment">“{short(item.text)}”</span>
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
  act,
  showComments,
  quote
}: {
  session: ReviewSession
  b: DocBlock
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  /** Comments show only when something is referenced: highlighted text, or the comment badge. */
  showComments?: boolean
  quote?: string
}) {
  const d = session.doc!
  const edit = d.edits[b.id]
  const authors = [...new Set(segmentsOf(b).filter((s) => s.op !== 'same').map((s) => s.author ?? 'Unknown'))]
  const last = d.lastRound?.[b.id]
  const toRead = needsReading(d, b)
  const checked = markedChecked(d, b) ? d.checked![b.id] : null
  // Resolved comments aren't highlighted, so there's nothing to click: offer them here.
  const resolvedHere = [...(b.comments ?? []), ...d.comments.filter((c) => c.blockId === b.id && !c.replyTo)].filter((c) => commentResolved(d, c)).length
  const [showResolved, setShowResolved] = useState(false)

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
        {!b.ours && !theyChanged(b) && edit === undefined && !b.approved && !checked && !toRead && <span className="dr-fact">Unchanged</span>}
        {toRead && <span className="dr-fact warn">Not our wording: to read</span>}
        {checked && (
          <span className="dr-fact ok">
            Checked by {checked.by}, {new Date(checked.at).toLocaleDateString()}
          </span>
        )}
      </div>
      {last && (last.ourEdit || last.comments.length > 0) && (
        <div className="dr-last">
          <div className="dr-mini-h">Last round we proposed</div>
          <div className="dr-last-text">{last.sent}</div>
        </div>
      )}
      <div className="dr-card-actions">
        {toRead && (
          <button className="btn sm primary" title="You've read it and it's fine as it is: the bar turns green" onClick={() => act(window.api.doc.check(session.id, [b.id], true))}>
            <Icon name="check" size={13} /> Mark as checked
          </button>
        )}
        {checked && (
          <button className="btn sm ghost" onClick={() => act(window.api.doc.check(session.id, [b.id], false))}>
            Unmark
          </button>
        )}
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

      {!showComments && !showResolved && resolvedHere > 0 && (
        <button className="link-btn dr-small" onClick={() => setShowResolved(true)}>
          {resolvedHere} resolved comment{resolvedHere === 1 ? '' : 's'}
        </button>
      )}
      {(showComments || showResolved) && <CommentsBlock session={session} b={b} quote={quote} draft={draft} setDraft={setDraft} act={act} />}
    </section>
  )
}

/** A paragraph's comments: theirs (with our replies) and ours, and adding one (on the highlighted text, if any). */
function CommentsBlock({
  session,
  b,
  quote,
  draft,
  setDraft,
  act
}: {
  session: ReviewSession
  b: DocBlock
  quote?: string
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  act: (p: Promise<ReviewSession>) => Promise<boolean>
}) {
  const d = session.doc!
  const theirs = b.comments ?? []
  const ours = d.comments.filter((c) => c.blockId === b.id)
  const loose = ours.filter((c) => !c.replyTo || !theirs.some((t) => t.id === c.replyTo))
  // "Reply" at the top answers their first open comment; with none open, it adds a new one.
  const openTheirs = theirs.find((t) => !commentResolved(d, t))
  const done = async (text?: string) => {
    if (text !== undefined && draft && !(await act(window.api.doc.comment(session.id, { ...draft, text })))) return
    setDraft(null)
  }
  return (
    <>
      <div className="dr-mini-h rc-comments-h">
        Comments
        {!draft && (
          <button className="btn sm" onClick={() => setDraft(quote ? { blockId: b.id, quote } : { blockId: b.id, replyTo: openTheirs?.id })}>
            <Icon name="chat" size={13} /> {quote ? 'Comment on the highlighted text' : openTheirs ? 'Reply' : 'Add'}
          </button>
        )}
      </div>
      {!theirs.length && !ours.length && !draft && <p className="faint dr-small">None. Comments go to them in the marked-up copy. Select text to comment on part of the paragraph.</p>}
      <div className="dr-threads">
        {theirs.map((c) => {
          const isDone = commentResolved(d, c)
          return (
            <TheirComment key={c.id} c={c} done={isDone ? (d.commentsDone?.[c.id] ?? { by: c.author }) : null} onResolve={(v) => act(window.api.doc.resolveComment(session.id, c.id, v))}>
              {ours
                .filter((o) => o.replyTo === c.id)
                .map((o) => (
                  <OurCommentCard
                    key={o.id}
                    c={o}
                    reply
                    onEdit={(text) => act(window.api.doc.editComment(session.id, o.id, text))}
                    onDelete={() => act(window.api.doc.uncomment(session.id, o.id))}
                  />
                ))}
              {isDone ? null : draft?.replyTo === c.id ? (
                <CommentForm placeholder={`Reply to ${c.author}`} onDone={done} />
              ) : (
                <button className="link-btn dr-reply" onClick={() => setDraft({ blockId: b.id, replyTo: c.id })}>
                  Reply
                </button>
              )}
            </TheirComment>
          )
        })}
        {loose.map((o) => (
          <OurCommentCard
            key={o.id}
            c={o}
            done={commentResolved(d, o) ? (d.commentsDone?.[o.id] ?? null) : null}
            onResolve={(v) => act(window.api.doc.resolveComment(session.id, o.id, v))}
            onEdit={(text) => act(window.api.doc.editComment(session.id, o.id, text))}
            onDelete={() => act(window.api.doc.uncomment(session.id, o.id))}
          />
        ))}
        {draft && !draft.replyTo && (
          <div className="dr-comment ours">
            {draft.quote && <div className="dr-quote">“{draft.quote}”</div>}
            <CommentForm placeholder="Comment (goes to them in the marked-up copy)" onDone={done} />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Resolve or reopen a comment thread, as in Word. A resolved thread stays, greyed out, with who
 * resolved it; its text is no longer highlighted in the document.
 */
function ResolveControl({ done, onResolve, thread }: { done: { by: string } | null; onResolve: (done: boolean) => void; thread?: boolean }) {
  return done ? null : (
    <button
      className="link-btn dr-comment-act"
      title={`Mark this ${thread ? 'thread' : 'comment'} as done. It stays in the review and goes into the marked-up copy marked resolved, greyed out, and its text is no longer highlighted. You can reopen it.`}
      onClick={() => onResolve(true)}
    >
      Resolve
    </button>
  )
}

/** Under a resolved comment: who resolved it, and Reopen. */
function ResolvedLine({ done, onResolve }: { done: { by: string } | null; onResolve: (done: boolean) => void }) {
  if (!done) return null
  return (
    <div className="dr-resolved">
      <Icon name="check" size={12} /> Resolved by {done.by} ·{' '}
      <button className="link-btn" onClick={() => onResolve(false)}>
        Reopen
      </button>
    </div>
  )
}

function TheirComment({ c, done, onResolve, children }: { c: DocComment; done: { by: string } | null; onResolve: (done: boolean) => void; children: ReactNode }) {
  return (
    <div className={`dr-comment theirs ${done ? 'resolved' : ''}`}>
      <div className="dr-comment-head">
        <strong>{c.author}</strong>
        {c.date && <span className="faint">{new Date(c.date).toLocaleDateString()}</span>}
        <span style={{ flex: 1 }} />
        <ResolveControl done={done} onResolve={onResolve} thread />
      </div>
      {c.quote && <div className="dr-quote">“{snippet(c.quote)}”</div>}
      <div>{c.text}</div>
      {children}
      <ResolvedLine done={done} onResolve={onResolve} />
    </div>
  )
}

function OurCommentCard({
  c,
  reply,
  done = null,
  onResolve,
  onEdit,
  onDelete
}: {
  c: OurComment
  reply?: boolean
  /** Not for replies: a reply is resolved with the comment it replies to. */
  done?: { by: string } | null
  onResolve?: (done: boolean) => void
  /** Ours in this review can be reworded (theirs, and ours from earlier rounds, can't). */
  onEdit: (text: string) => Promise<boolean>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const what = reply ? 'reply' : 'comment'
  return (
    <div className={`dr-comment ours ${reply ? 'reply' : ''} ${done ? 'resolved' : ''}`}>
      <div className="dr-comment-head">
        <strong>{c.by}</strong>
        <span className="faint" title={c.edited ? `Edited by ${c.edited.by} on ${new Date(c.edited.at).toLocaleString()}` : undefined}>
          {new Date(c.at).toLocaleDateString()}
          {c.edited && ' · edited'}
        </span>
        <span style={{ flex: 1 }} />
        {!editing && !done && (
          <button className="link-btn dr-comment-act" title={`Change the wording of this ${what}. It goes to them as it reads when you send the marked-up copy.`} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {!editing && onResolve && <ResolveControl done={done} onResolve={onResolve} />}
        {!editing && (
          <button
            className="link-btn dr-comment-act danger"
            title={`Remove this ${what} from the review, so it isn't sent to them. You can undo it from History.`}
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
      {c.quote && <div className="dr-quote">“{snippet(c.quote)}”</div>}
      {editing ? (
        <CommentForm
          initial={c.text}
          action="Save"
          placeholder={`Your ${what}`}
          onDone={async (text) => {
            if (text !== undefined && !(await onEdit(text))) return
            setEditing(false)
          }}
        />
      ) : (
        <div>{c.text}</div>
      )}
      {onResolve && <ResolvedLine done={done} onResolve={onResolve} />}
    </div>
  )
}

function CommentForm({ placeholder, onDone, initial = '', action = 'Comment' }: { placeholder: string; onDone: (text?: string) => void; initial?: string; action?: string }) {
  const [text, setText] = useState(initial)
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
        <button className="btn sm primary" disabled={!text.trim() || text.trim() === initial.trim()} onClick={() => onDone(text)}>
          {action}
        </button>
        <button className="btn sm ghost" onClick={() => onDone(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---- AI tasks on highlighted text ------------------------------------------------------------------

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** The questions offered for highlighted text, as set on the Questions page (kept up to date). */
function useQuestions(): AiQuestion[] {
  const [questions, setQuestions] = useState<AiQuestion[]>([])
  useEffect(() => {
    const load = () => void window.api.questions.list().then(setQuestions)
    load()
    return window.api.questions.onChanged(load)
  }, [])
  return questions
}

/**
 * The AI section: a card for each prioritised question (set on the Questions page) that fits the
 * highlighted text, then any other question already asked of it, then More questions: a menu of
 * the rest, which asks the one picked (its card then shows here too). Using a card asks the AI, and the answer, written from the server's response, comes
 * back onto the card, with the response as returned. The cards run independently, so several
 * can be asked at once; their answers stay here (the Agent sees their findings as part of the
 * review, not as messages).
 */
function AiSection({
  session,
  highlight,
  onHold,
  run,
  onChange,
  debug
}: {
  session: ReviewSession
  highlight: Highlight | null
  onHold: boolean
  run: (questionId: string) => Promise<unknown>
  onChange: (s: ReviewSession) => void
  debug: boolean
}) {
  const d = session.doc!
  const lib = useLibrary()
  const questions = useQuestions()
  if (!highlight?.quote)
    return (
      <section className="rc-section ai-section">
        <div className="dr-mini-h">AI</div>
        <p className="faint dr-small">Select text for options.</p>
      </section>
    )
  const blocks = d.blocks.filter((b) => highlight.blockIds.includes(b.id) && b.kind !== 'deleted')
  const candidates = blocks.filter((b) => intentCandidate(d, b))
  const against = [...new Set(candidates.flatMap((b) => (b.standard ?? b.wasApproved ? [b.standard ?? b.wasApproved!] : (b.matches ?? []).map((id) => lib.get(id)?.title ?? id))))]
  const fits = (q: AiQuestion) => (q.method === 'paragraphs' ? candidates.length > 0 : q.method === 'changes' ? d.blocks.some((b) => highlight.blockIds.includes(b.id) && hasOpenChanges(d, b)) : true)
  // Compared with approved wording: name what it's compared with.
  const detail = (q: AiQuestion) =>
    q.method === 'paragraphs' && against.length ? `Compares it with our ${against.slice(0, 3).map((t) => `“${t}”`).join(', ')}${against.length > 3 ? ` and ${against.length - 3} more` : ''}` : q.detail
  // The last time this was asked of these paragraphs. A question asked once is about the exact
  // words; the others work on whole paragraphs, so a run still fits after the wording or
  // selection within them changed.
  const latest = (q: AiQuestion) => {
    const runs = [...(d.aiRuns ?? [])].reverse().filter((r) => questionIdOf(r) === q.id && sameIds(r.blockIds, highlight.blockIds))
    return runs.find((r) => r.quote === highlight.quote) ?? (q.method === 'once' ? undefined : runs[0])
  }
  const offered = questions.filter(fits)
  // Prioritised questions, and others once asked of this text, are cards; the rest are in the menu.
  const cards = offered.filter((q) => q.priority || latest(q))
  const more = offered.filter((q) => !cards.includes(q))
  return (
    <section className="rc-section ai-section">
      <div className="dr-mini-h">AI</div>
      {onHold && <p className="dr-small dr-err">On security hold: nothing from this contract goes to the AI.</p>}
      {!offered.length && <p className="faint dr-small">No questions fit this text. Add questions on the Questions page.</p>}
      {cards.map((q) => (
        <AiCard key={q.id} title={`Ask: ${q.title}`} detail={detail(q)} result={latest(q)} disabled={onHold} onRun={() => run(q.id)} session={session} onChange={onChange} debug={debug} />
      ))}
      {more.length > 0 && <MoreQuestions questions={more} detail={detail} disabled={onHold} onPick={(q) => run(q.id)} />}
    </section>
  )
}

/** More questions: a button that opens a menu of the questions that aren't prioritised; picking one asks it. */
function MoreQuestions({ questions, detail, disabled, onPick }: { questions: AiQuestion[]; detail: (q: AiQuestion) => string; disabled: boolean; onPick: (q: AiQuestion) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="ai-more" ref={ref}>
      <button className={`ai-more-btn ${open ? 'on' : ''}`} disabled={disabled} onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="sparkle" size={13} />
        <span>More questions</span>
        <span className="faint">{questions.length}</span>
        <span className={`ai-more-chev ${open ? 'up' : ''}`}>
          <Chevron size={10} />
        </span>
      </button>
      {open && (
        <div className="ai-more-menu" role="menu">
          {questions.map((q) => (
            <button
              key={q.id}
              role="menuitem"
              className="ai-more-item"
              onClick={() => {
                setOpen(false)
                onPick(q)
              }}
            >
              <strong>Ask: {q.title}</strong>
              {detail(q) && <span className="faint">{detail(q)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AiCard({
  title,
  detail,
  result,
  disabled,
  onRun,
  session,
  onChange,
  debug
}: {
  title: string
  detail: string
  result?: AiTaskRun
  disabled: boolean
  onRun: () => void
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  debug: boolean
}) {
  const [raw, setRaw] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const running = result?.status === 'running'
  const stream = useStream(running ? result!.id : undefined)
  // Asking again costs another request and replaces the answer on the card: confirm it first.
  const ask = () => (result?.status === 'done' ? setConfirming(true) : onRun())
  return (
    <div className={`ai-card ${result ? 'has-result' : ''}`}>
      {confirming && result && (
        <AskAgain
          title={title}
          result={result}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            onRun()
          }}
        />
      )}
      <button className="ai-card-head" disabled={disabled || running} onClick={ask} title={result ? 'Ask again' : 'Ask the AI'}>
        <Icon name="sparkle" size={14} />
        <span className="ai-card-text">
          <strong>{title}</strong>
          <span className="faint">{detail}</span>
        </span>
        <span className="ai-card-go">{running ? <span className="spinner sm" /> : <Chevron size={11} />}</span>
      </button>
      {result?.status === 'done' && (
        <div className="ai-card-body">
          {result.parts ? <AiAnswer parts={result.parts} session={session} onChange={onChange} onShow={flashParagraphs} /> : <Markdown text={result.answer ?? ''} />}
          <div className="ai-card-foot">
            <span className="faint">
              {result.by} · {new Date(result.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            {debug && (
              <button className="link-btn" onClick={() => setRaw(true)}>
                Raw response
              </button>
            )}
          </div>
          {debug && raw && <RawModal title={`Raw response: ${title}`} raw={result.raw ?? null} note={`As the server returned it, ${result.by} · ${new Date(result.at).toLocaleString()}.`} onClose={() => setRaw(false)} />}
        </div>
      )}
      {running && (stream.text || stream.thinking) && (
        <div className="ai-card-body">{stream.text ? <Markdown text={stream.text} /> : <span className="faint dr-small">Thinking…</span>}</div>
      )}
      {result?.status === 'error' && <p className="dr-small dr-err ai-card-body">{result.error}</p>}
    </div>
  )
}

/**
 * Confirm asking a question again, in the middle of the window: it sends new requests to the AI
 * (which cost money) and the new answer replaces the one on the card. Cancel has the focus, so
 * Enter or Escape straight away does nothing.
 */
function AskAgain({ title, result, onCancel, onConfirm }: { title: string; result: AiTaskRun; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  const when = new Date(result.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return createPortal(
    <div className="modal-back" onClick={onCancel}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="ask-again-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="sparkle" size={15} />
          <h3 id="ask-again-title">Ask “{title.replace(/^Ask:\s*/, '')}” again?</h3>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>
            This text already has an answer, from {result.by} on {when}.
          </p>
          <p style={{ marginBottom: 0 }}>Asking again sends new requests to the AI, which costs money, and the new answer replaces this one on the card. The earlier answer stays in the review’s record.</p>
        </div>
        <div className="modal-foot">
          <button ref={cancel} className="btn" onClick={onCancel}>
            Keep this answer
          </button>
          <button className="btn primary" onClick={onConfirm}>
            Ask again
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** A card's answer as it streams in (Explain), and whether the model is thinking first. */
function useStream(runId: string | undefined) {
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  useEffect(() => {
    setText('')
    setThinking(false)
    if (!runId) return
    const offDelta = window.api.chat.onDelta((d) => d.requestId === runId && setText((t) => t + d.text))
    const offThinking = window.api.chat.onThinking((d) => d.requestId === runId && setThinking(true))
    return () => {
      offDelta()
      offThinking()
    }
  }, [runId])
  return { text, thinking }
}
