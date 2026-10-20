import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AiQuestion, AiTaskRun, DocBlock, DocComment, LibraryClause, OurComment, ReviewSession, SecurityAlert } from '@shared/types'
import { aiSame, changeKey, commentResolved, groupOf, hasOpenChanges, openChanges, intentCandidate, isCleared, markedChecked, marksFor, needsReading, segmentsOf, stillOpen, theyChanged } from '@shared/changes'
import { Chevron, Icon } from '../lib/icons'
import { AutoTextarea } from '../lib/AutoTextarea'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'
import { DocEditor, flashParagraphs, type Highlight, type SelectedChange } from '../components/DocEditor'
import { WordView } from '../components/WordView'
import { Spent, Timeline } from '../components/Timeline'
import { AiAnswer } from '../components/AiAnswer'
import { RawModal } from '../components/RawModal'
import { canRedo, dependents, describe, details, stateAt, type ActionItem } from '@shared/history'
import { whereOf } from '@shared/numbering'
import { DEFAULTS, questionIdOf } from '@shared/questions'
import { diffSegments, type Mark } from '@shared/diff'
import type { TrackedSegment } from '@shared/types'
import { Redline } from '../components/Redline'
import { Markdown } from '../components/Markdown'

interface Props {
  session: ReviewSession
  panel: HTMLElement | null
  /** The bar under the document and the review column: the review's actions, and Accept / Reject. */
  bar: HTMLElement | null
  /** The foot of the review column: Accept / Reject for the selected changes. */
  foot: HTMLElement | null
  /** The head of the right sidebar, above its Review / Agent switch: what's being reviewed. */
  head: HTMLElement | null
  onChange: (s: ReviewSession) => void
  alert: SecurityAlert | null
  onOpenSecurity: () => void
  accountName?: string
  contractTitle?: string
  onOpenReview: (id: string) => void
  onNominationsChanged: () => void
  /** The reviewer's name (Settings): our changes and comments in the Word layout are theirs. */
  reviewer: string
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
export function DocReview({ session, panel, bar, foot, head, reviewer, onChange, alert, onOpenSecurity, accountName, contractTitle, onOpenReview, debug }: Props) {
  const d = session.doc!
  const [focus, setFocus] = useState<string | null>(null)
  // The original we sent: their first draft, the review it leads to.
  const [firstDraft, setFirstDraft] = useState<string | null>(null)
  useEffect(() => {
    setFirstDraft(null)
    if (!session.original) return
    void window.api.review.list().then((all) => setFirstDraft(all.find((r) => r.contractId === session.contractId && r.version === 1 && !r.original)?.id ?? null))
  }, [session.id])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [redlineOpen, setRedlineOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<SelectedChange[] | null>(null)
  /** Each new selection is a new action: everything decided in it undoes together. */
  const [selection, setSelection] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  /** The right of the bottom bar, where the selection's Accept and Reject go. */
  const [decideSlot, setDecideSlot] = useState<HTMLDivElement | null>(null)
  /** New draft only: the page with every change applied, to read it as it would be. */
  const [finalView, setFinalView] = useState(false)
  /**
   * A paragraph as it stood at a point in its history (See it then, in the history): the action
   * it's shown just after, or null for as it was received. Shown over the paragraph on the page.
   */
  const [past, setPast] = useState<{ blockId: string; actionId: string | null } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  useEffect(() => setPast(null), [session.id])
  /** Close review was pressed: asking first. */
  const [confirmClose, setConfirmClose] = useState(false)
  // The document as it looks in Word (pages, tables, headers). As text, paragraph by paragraph,
  // only when it can't be laid out (the reviewing is the same either way).
  const [layout, setLayout] = useState<'word' | 'text'>('word')
  /** Why it couldn't be laid out (SuperDoc's message), shown with the text view. */
  const [layoutError, setLayoutError] = useState('')
  useEffect(() => setLayout('word'), [session.id])
  /** Text you highlighted (not a caret placed in a change): the paragraph it starts in, and the text. */
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const highlighted = !!highlight
  /** A paragraph whose comments were asked for (its comment badge). */
  const [commentsFor, setCommentsFor] = useState<string | null>(null)
  /**
   * A margin marker was clicked: the column shows only what it's for (the questions asked of
   * that text, or the paragraph's comments) until "Show everything" or another click on the page.
   */
  const [only, setOnly] = useState<'ai' | 'comments' | null>(null)
  const onSelectChanges = useCallback((x: SelectedChange[] | null, hl?: Highlight) => {
    setOnly(null)
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
    setOnly(null)
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
    setOnly(null)
    setFocus(id)
    setCommentsFor((c) => (c === id ? c : null))
  }, [])

  useEffect(() => {
    libraryCache = null
  }, [session.id])
  const changed = useMemo(() => d.blocks.filter((b) => stillOpen(d, b)), [d])
  const toRead = d.blocks.filter((b) => needsReading(d, b)).length
  const ourEdits = Object.keys(d.edits).length
  const cleared = d.blocks.filter((b) => b.kind !== 'heading' && !hasOpenChanges(d, b) && d.edits[b.id] === undefined && (isCleared(d, b) || segmentsOf(b).some((x, i) => x.op !== 'same' && d.resolved?.[changeKey(b.id, i)]))).length
  const onHold = alert?.status === 'open'
  // Paragraphs the AI could check for meaning that it hasn't checked as they now read.
  const aiOk = d.blocks.filter((b) => intentCandidate(d, b) && aiSame(d, b)).length
  const block = focus ? (d.blocks.find((b) => b.id === focus) ?? null) : null
  // To a paragraph: the page (Word layout or text) scrolls to it.
  const jumpTo = (blockId: string) => {
    flashParagraphs([blockId])
    setFocus(blockId)
  }
  const hlBlock = highlight ? (d.blocks.find((b) => b.id === highlight.blockId) ?? null) : null
  // Changes selected in one paragraph that has comments: its comments show with them (often their reasons).
  const pickedIds = [...new Set((picked ?? []).map((x) => x.blockId))]
  const pickedBlock =
    pickedIds.length === 1 ? (d.blocks.find((b) => b.id === pickedIds[0] && (b.comments?.length || d.comments.some((c) => c.blockId === b.id))) ?? null) : null

  // The paragraphs the selection is about (the selected text and changes, or the caret's paragraph).
  const textIds = [...new Set([...(highlight?.blockIds ?? []), ...(picked ?? []).map((x) => x.blockId), ...(!highlight && !picked?.length && block ? [block.id] : [])])]
  // A paragraph's history, step by step: as received, then just after each action (still in
  // effect) that changed it. The one shown, its paragraphs (an action may span several) as they
  // stood then, and what restoring it would undo.
  const pastView = useMemo(() => {
    if (!past) return null
    const history = d.history ?? []
    const touches = (a: (typeof history)[number]) => details(d, a).some((x) => x.blockId === past.blockId)
    // Actions in one group (a selection, typing in a paragraph) are one step: its last action.
    const acts = history.filter((a, i) => !a.undone && touches(a) && !(a.group && history[i + 1]?.group === a.group && touches(history[i + 1])))
    const steps: (string | null)[] = [null, ...acts.map((a) => a.id)]
    const at = Math.max(0, steps.indexOf(past.actionId))
    const action = past.actionId ? history.find((a) => a.id === past.actionId) : undefined
    const first = acts[0]
    const state = action ? stateAt(d, action) : first ? stateAt(d, first, true) : d
    const ids = action ? [...new Set(details(d, action).map((x) => x.blockId))] : [past.blockId]
    const blocks = ids.flatMap((id) => {
      const b = state.blocks.find((x) => x.id === id)
      return b ? [{ blockId: id, marks: marksFor(state, b) }] : []
    })
    const later = acts.slice(at).filter((a) => !a.undone)
    return { steps, at, action, blocks, later, latest: at === steps.length - 1 && !action?.undone }
  }, [past, d])
  const pastBar = pastView && past && (
    <div className="past-bar">
      <div className="past-what">
        <strong>{pastView.action ? describe(d, pastView.action) : 'As received'}</strong>
        <span className="faint">
          {pastView.action
            ? `${pastView.action.by} · ${new Date(pastView.action.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${pastView.action.undone ? ' · undone' : ''}`
            : 'Before anything was done to it'}
          {' · '}step {pastView.at + 1} of {pastView.steps.length}
        </span>
      </div>
      <div className="past-btns">
        <button className="btn sm" disabled={pastView.at === 0} onClick={() => setPast({ blockId: past.blockId, actionId: pastView.steps[pastView.at - 1] })}>
          ‹ Earlier
        </button>
        <button className="btn sm" disabled={pastView.at >= pastView.steps.length - 1} onClick={() => setPast({ blockId: past.blockId, actionId: pastView.steps[pastView.at + 1] })}>
          Later ›
        </button>
        <button className="btn sm" disabled={pastView.latest || !pastView.later.length} onClick={() => setConfirmRestore(true)} title="Undo everything done to it since this point">
          Restore to this point
        </button>
        <button className="btn sm primary" onClick={() => setPast(null)}>
          Back to now
        </button>
      </div>
    </div>
  )

  // What's being reviewed and how it stands: above the column's Review / Agent switch (head).
  const header = (
    <section className="rc-section rc-head">
      <div className="rc-title-row">
        <div className="rc-title">{session.version !== undefined && contractTitle ? `${accountName} · ${contractTitle}` : session.docName}</div>
      </div>
      {session.closed && (
        <div className="banner info">
          Closed by {session.closed.by} on {new Date(session.closed.at).toLocaleDateString()}. It’s kept, but hidden on the Reviews page.
        </div>
      )}
      {session.original && (
        <div className="banner info" style={{ display: 'block' }}>
          The original we sent them, kept to compare their drafts with. It’s ours, so there’s nothing to review in it.
          {firstDraft && (
            <div style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => onOpenReview(firstDraft)}>
                Open their first draft <Icon name="next" size={12} />
              </button>
            </div>
          )}
        </div>
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
        {!session.original && <div className="rc-key-short">
          <span>
            {changed.length} to decide{toRead ? ` · ${toRead} to read` : ''} · {ourEdits} edited by you
          </span>
        </div>}
      {onHold && (
        <div className="banner danger">
          <Icon name="shield" /> On security hold: text addressed to an AI reviewer was found.{' '}
          <button className="link-btn" onClick={onOpenSecurity}>
            Security
          </button>
        </div>
      )}
    </section>
  )
  const column = (
    <div className="rc">
      {!head && header}
      {/* The review: the automated review's timeline (the History panel instead while it's open). */}
      {session.original ? null : showHistory ? (
        <HistoryPanel session={session} act={act} onClose={() => setShowHistory(false)} onJump={jumpTo} onPast={(blockId, actionId) => setPast({ blockId, actionId })} />
      ) : (
        <Timeline session={session} onChange={onChange} onJump={jumpTo} focusBlock={focus} onHold={onHold} />
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
      {layout === 'word' ? (
        <WordView key={session.id} session={session} reviewer={reviewer} reference={!!session.original} final={finalView} onFocusBlock={onFocusBlock} onSelectChanges={onSelectChanges}
          act={act}
          onOpenComments={(blockId) => {
            // Only the paragraph's comments ("Show everything" brings the rest back).
            setFocus(blockId)
            setCommentsFor(blockId)
            setPicked(null)
            setHighlight(null)
            setShowHistory(false)
            setOnly('comments')
          }}
          onOpenAi={(hl) => {
            // Only the questions asked of that text.
            setFocus(hl.blockId)
            setPicked([])
            setHighlight(hl)
            setShowHistory(false)
            setSelection((n) => n + 1)
            setOnly('ai')
          }}
          onShowComments={(id) => {
            setFocus(id)
            setCommentsFor(id)
            setPicked(null)
            setHighlight(null)
          }}
          onShowText={(why) => {
            setLayoutError(why)
            setLayout('text')
          }}
        />
      ) : (
      <>
      <div className="banner info wv-fallback">
        <span>
          This document couldn’t be laid out as in Word, so it’s shown as text. Reviewing works the same.
          {layoutError && <span className="faint dr-small"> ({layoutError})</span>}
        </span>
        <button className="btn sm" onClick={() => setLayout('word')}>
          Try the Word layout again
        </button>
      </div>
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
      </>
      )}
      {panel && createPortal(column, panel)}
      {emailOpen && <EmailModal session={session} onClose={() => setEmailOpen(false)} onMarkup={() => setRedlineOpen(true)} />}
      {redlineOpen && <RedlineModal session={session} onClose={() => setRedlineOpen(false)} />}
    </div>
      {/* In the bar under the document: what you do with the review as a whole. */}
      {bar &&
        !session.original &&
        createPortal(
          <>
            <div className="bottombar-group">
        <button className={`btn sm ${showHistory ? 'on' : ''}`} onClick={() => setShowHistory((v) => !v)} title="Everything you've done in this review: undo or redo any of it (in the review column)">
          <Icon name="history" size={14} /> <span className="bb-label">History{d.history?.length ? ` (${d.history.length})` : ''}</span>
        </button>
        <button className="btn sm" onClick={() => setRedlineOpen(true)} disabled={onHold}>
          <Icon name="doc" size={14} /> <span className="bb-label">Marked-up copy</span>
        </button>
        <button className={`btn sm ${session.doc?.pipeline?.email ? 'primary' : ''}`} onClick={() => setEmailOpen(true)} disabled={onHold} title="The email to the counterparty the AI wrote with the new draft">
          <Icon name="mail" size={14} /> <span className="bb-label">View response</span>
        </button>
            </div>
            {layout === 'word' && (
              <button
                className={`btn sm bottombar-final ${finalView ? 'on' : ''}`}
                aria-pressed={finalView}
                onClick={() => setFinalView((v) => !v)}
                title="Read the draft as it would be: every change applied, nothing struck through or marked"
              >
                <Icon name="file" size={14} /> <span className="bb-label">New draft only</span>
              </button>
            )}
            {/* Done with the review: closed (asked first), or reopened. */}
            <button
              className="btn sm rc-close"
              title={session.closed ? 'Show it on the Reviews page again' : 'Done with it: hide it on the Reviews page (nothing is deleted)'}
              onClick={() => (session.closed ? act(window.api.review.close(session.id, false)) : setConfirmClose(true))}
            >
              {session.closed ? 'Reopen review' : 'Close review'}
            </button>
          </>,
          bar
        )}
      {head && createPortal(header, head)}
      {pastView && pastBar && <PastModal bar={pastBar} blocks={pastView.blocks} labels={new Map(d.blocks.map((b) => [b.id, b.label ?? '']))} onClose={() => setPast(null)} />}
      {confirmRestore && pastView && (
        <ConfirmRestore
          where={past ? whereOf(d, d.blocks.find((b) => b.id === past.blockId) ?? d.blocks[0]) : ''}
          undo={[...pastView.later, ...(pastView.later[0] ? dependents(d.history!, pastView.later[0]).filter((x) => !pastView.later.includes(x)) : [])].map((a) => describe(d, a))}
          onCancel={() => setConfirmRestore(false)}
          onConfirm={async () => {
            setConfirmRestore(false)
            const first = pastView.later[0]
            if (first && (await act(window.api.doc.undo(session.id, first.id)))) setPast(null)
          }}
        />
      )}
      {confirmClose && (
        <ConfirmClose
          open={changed.length}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false)
            void act(window.api.review.close(session.id, true))
          }}
        />
      )}
      {/* At the foot of the review column: Accept / Reject for the selected changes, and the key. */}
      {foot &&
        !session.original &&
        createPortal(
          <>
            {/* What the AI review has used, always here; Accept / Reject beside it while changes are picked. */}
            <Spent run={session.doc?.pipeline} />
            <div className="bottombar-group" ref={setDecideSlot} />
          </>,
          foot
        )}
    </div>
  )
}

/**
 * Accept and Reject in the bottom bar, under the review column: for the changes of theirs in the
 * selection that are still open, all at once. Only there while the selection has some.
 */
function DecideButtons({ open, busy, onDecide }: { open: number; busy?: boolean; onDecide: (outcome: 'accepted' | 'rejected') => void }) {
  return (
    <>
      <button className="btn sm accept" disabled={busy} onClick={() => onDecide('accepted')}>
        <Icon name="check" size={13} /> Accept{open > 1 ? ` all ${open}` : ''}
      </button>
      <button className="btn sm reject" disabled={busy} onClick={() => onDecide('rejected')}>
        <Icon name="x" size={13} /> Reject{open > 1 ? ` all ${open}` : ''}
      </button>
    </>
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
  highlighted,
  slot
}: {
  session: ReviewSession
  picked: SelectedChange[]
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  group: string
  highlighted: boolean
  /** Where Accept and Reject go: the right of the bottom bar. */
  slot: HTMLElement | null
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
      {slot && open.length > 0 && createPortal(<DecideButtons open={open.length} busy={busy} onDecide={decide} />, slot)}
      {theirs.length > 0 &&
        (open.length ? (
          <p className="faint dr-small">
            {open.length === 1 ? 'Accept or reject it' : `Accept or reject all ${open.length}`} with the buttons below.
          </p>
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

/**
 * The history of some paragraphs (the selected text, or the paragraph the caret is in), newest
 * first: what was done to them (decisions, edits, comments, checks: each action's parts that touch
 * them) and the questions asked of them. Several paragraphs read as one timeline, each entry
 * naming where it is.
 */
/** In a history entry: show the text as it stood just after it, on the page. */
function SeeThen({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="link-btn hist-then"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      See it then
    </button>
  )
}

function TextHistory({ session, blockIds, onJump, onPast }: { session: ReviewSession; blockIds: string[]; onJump: (blockId: string) => void; onPast: (blockId: string, actionId: string) => void }) {
  const d = session.doc!
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const ids = new Set(blockIds)
  type Event = { at: string; by: string; key: string } & ({ kind: 'action'; undone: boolean; label: string; items: ActionItem[] } | { kind: 'ask'; title: string; where: string; blockId: string })
  const events: Event[] = [
    ...(d.history ?? []).flatMap((a): Event[] => {
      const items = details(d, a).filter((x) => ids.has(x.blockId))
      return items.length ? [{ kind: 'action', key: a.id, at: a.at, by: a.by, undone: !!a.undone, label: describe(d, a), items }] : []
    }),
    ...(d.aiRuns ?? []).flatMap((r): Event[] => {
      const blockId = r.blockIds.find((x) => ids.has(x))
      const b = blockId ? d.blocks.find((x) => x.id === blockId) : undefined
      if (r.status !== 'done' || !b) return []
      return [{ kind: 'ask', key: r.id, at: r.at, by: r.by, title: r.title ?? DEFAULTS.find((q) => q.id === questionIdOf(r))?.title ?? r.question.split('\n')[0], where: whereOf(d, b), blockId: b.id }]
    })
  ].sort((x, y) => y.at.localeCompare(x.at))
  const shown = all ? events : events.slice(0, 6)
  const when = (at: string) => new Date(at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  return (
    <section className="rc-section text-history">
      <div className="dr-mini-h">History{blockIds.length > 1 ? ` · ${blockIds.length} paragraphs` : ''}</div>
      {!events.length && <p className="faint dr-small">Nothing done here yet: decisions, edits, comments and questions asked will show here.</p>}
      <div className="hist-list">
        {shown.map((e) =>
          e.kind === 'action' ? (
            <div key={e.key} className={`hist-item ${e.undone ? 'undone' : ''} ${open === e.key ? 'open' : ''}`} onClick={() => setOpen(open === e.key ? null : e.key)}>
              <div className="hist-items">
                {(open === e.key ? e.items : e.items.slice(0, 3)).map((x, i) => (
                  <ItemView key={i} item={x} onJump={onJump} />
                ))}
                {open !== e.key && e.items.length > 3 && <div className="faint hist-more">+ {e.items.length - 3} more · click to see all</div>}
              </div>
              <div className="hist-meta faint">
                {e.by} · {when(e.at)}
                {e.undone && ' · undone'}
                {!e.undone && <SeeThen onClick={() => onPast(e.items[0].blockId, e.key)} />}
              </div>
            </div>
          ) : (
            <div key={e.key} className="hist-item">
              <div className="hist-items">
                <div className="hist-row">
                  <button className="link-btn hist-where" onClick={() => onJump(e.blockId)}>
                    {e.where}
                  </button>{' '}
                  asked the AI: <span className="hist-comment">{e.title}</span>
                </div>
              </div>
              <div className="hist-meta faint">
                {e.by} · {when(e.at)}
              </div>
            </div>
          )
        )}
      </div>
      {events.length > shown.length && (
        <button className="link-btn dr-small" onClick={() => setAll(true)}>
          Show all {events.length}
        </button>
      )}
    </section>
  )
}

function HistoryPanel({ session, act, onClose, onJump, onPast }: { session: ReviewSession; act: (p: Promise<ReviewSession>) => Promise<boolean>; onClose: () => void; onJump: (blockId: string) => void; onPast: (blockId: string, actionId: string) => void }) {
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
                {items[0] && !a.undone && <SeeThen onClick={() => onPast(items[0].blockId, a.id)} />}
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
  quote,
  onPick
}: {
  session: ReviewSession
  b: DocBlock
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  /** Comments show only when something is referenced: highlighted text, or the comment badge. */
  showComments?: boolean
  quote?: string
  /** Select changes (its changes still to decide), as clicking them would. */
  onPick?: (picked: SelectedChange[]) => void
}) {
  const d = session.doc!
  // Their changes here still to decide, a replacement counted once.
  const todo = [...new Set(openChanges(d, b).map((i) => groupOf(b, i)[0] ?? i))]
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
      {todo.length > 0 && (
        <div className="dr-todo">
          <span>
            {todo.length === 1 ? '1 change of theirs' : `${todo.length} changes of theirs`} still to decide
          </span>
          {onPick && (
            <button className="btn sm primary" onClick={() => onPick(todo.map((seg) => ({ blockId: b.id, kind: 'theirs' as const, seg })))}>
              Select {todo.length === 1 ? 'it' : 'them'}
            </button>
          )}
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
  debug,
  asked
}: {
  session: ReviewSession
  highlight: Highlight | null
  onHold: boolean
  /** Only the questions already asked of it (its AI marker was clicked). */
  asked?: boolean
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
  // Offered if it fits this text, and always if it's been asked of it (once answered, it may no
  // longer fit: their changes decided, the intent check done; the card and its answer stay).
  const offered = questions.filter((q) => fits(q) || latest(q))
  // Prioritised questions, and others once asked of this text, are cards; the rest are in the menu.
  const cards = offered.filter((q) => (asked ? latest(q) : q.priority || latest(q)))
  const more = asked ? [] : offered.filter((q) => !cards.includes(q))
  return (
    <section className="rc-section ai-section">
      <div className="dr-mini-h">{asked ? 'Asked of this text' : 'AI'}</div>
      {onHold && <p className="dr-small dr-err">On security hold: nothing from this contract goes to the AI.</p>}
      {!offered.length && <p className="faint dr-small">No questions fit this text. Add questions on the Questions page.</p>}
      {cards.map((q) => (
        <AiCard key={q.id} title={q.title} detail={detail(q)} result={latest(q)} disabled={onHold} onRun={() => run(q.id)} session={session} onChange={onChange} debug={debug} />
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
  // The answer is open until closed with the header; a new answer opens it again.
  const [open, setOpen] = useState(true)
  useEffect(() => setOpen(true), [result?.id])
  const running = result?.status === 'running'
  const stream = useStream(running ? result!.id : undefined)
  // Asking again costs another request and replaces the answer on the card: confirm it first.
  const ask = () => (result?.status === 'done' ? setConfirming(true) : onRun())
  const hasBody = !!result && (result.status !== 'running' || !!stream.text || !!stream.thinking)
  const heading = (
    <>
      <Icon name="sparkle" size={14} />
      <span className="ai-card-text">
        <span className="ai-card-title">
          <strong>{title}</strong>
          {/* Whether it's been asked, seen with the answer closed too. */}
          {result?.status === 'done' && (
            <span className="ai-card-state done" title={`Answered for ${result.by}, ${new Date(result.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}>
              Answered
            </span>
          )}
          {running && <span className="ai-card-state running">Asking…</span>}
          {result?.status === 'error' && <span className="ai-card-state failed">Failed</span>}
        </span>
        <span className="faint">{detail}</span>
      </span>
    </>
  )
  return (
    <div className={`ai-card ${result ? 'has-result' : ''} ${hasBody && !open ? 'closed' : ''}`}>
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
      <div className="ai-card-top">
        {hasBody ? (
          <button className="ai-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? 'Close the answer' : 'Show the answer'}>
            {heading}
          </button>
        ) : (
          <div className="ai-card-head">{heading}</div>
        )}
        <button className="btn sm ai-card-ask" disabled={disabled || running} onClick={ask} title={result?.status === 'done' ? 'Ask again (asks you to confirm: it replaces this answer)' : 'Ask the AI'}>
          {running ? <span className="spinner sm" /> : 'Ask'}
        </button>
        {/* Opens and closes the answer, as the header does (its place kept when there's no answer). */}
        {hasBody ? (
          <button className={`ai-card-go ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Close the answer' : 'Show the answer'} title={open ? 'Close the answer' : 'Show the answer'}>
            <Chevron size={11} />
          </button>
        ) : (
          <span className="ai-card-go" aria-hidden="true" />
        )}
      </div>
      {open && result?.status === 'done' && (
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
      {open && running && (stream.text || stream.thinking) && (
        <div className="ai-card-body">{stream.text ? <Markdown text={stream.text} /> : <span className="faint dr-small">Thinking…</span>}</div>
      )}
      {open && result?.status === 'error' && <p className="dr-small dr-err ai-card-body">{result.error}</p>}
    </div>
  )
}

/**
 * A paragraph (or the paragraphs an action spans) as it stood at a point in its history, in the
 * middle of the window over a mask; the review column stays above the mask, so another history
 * entry can be picked. A click on the mask, Back to now or Escape closes it. The text is set in
 * the document's typeface.
 */
function PastModal({ bar, blocks, labels, onClose }: { bar: ReactNode; blocks: { blockId: string; marks: Mark[] }[]; labels: Map<string, string>; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.confirm-modal') && onClose()
    document.addEventListener('keydown', esc)
    document.body.classList.add('past-open')
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.classList.remove('past-open')
    }
  }, [onClose])
  const run = document.querySelector('.wv-host .superdoc-text-run')
  const font = run ? getComputedStyle(run).fontFamily : undefined
  // Centred in the window left of the review column (which stays above the mask).
  const column = document.querySelector('.rightbar')?.getBoundingClientRect()
  const right = column ? window.innerWidth - column.left : 0
  return createPortal(
    <div className="past-mask" style={{ paddingRight: right }} onClick={onClose}>
      <div className="past-modal" role="dialog" aria-modal="true" style={{ width: `min(760px, calc(100vw - ${right + 60}px))` }} onClick={(e) => e.stopPropagation()}>
        {bar}
        <div className="past-body" style={{ fontFamily: font }}>
          {blocks.map((pb) => (
            <p key={pb.blockId} className="past-para">
              {labels.get(pb.blockId) && <strong>{labels.get(pb.blockId)} </strong>}
              {pb.marks.length ? (
                pb.marks.map((m, i) => {
                  const del = m.ours === 'del' || (m.theirs === 'del' && !m.ours)
                  const ins = !del && (m.ours === 'ins' || m.theirs === 'ins')
                  return (
                    <span key={i} className={del ? `wv-st-del ${m.ours ? 'yours' : 'theirs'}` : ins ? `wv-st-ins ${m.ours ? 'yours' : 'theirs'}` : undefined}>
                      {m.text}
                    </span>
                  )
                })
              ) : (
                <em className="wv-st-none">Not there then.</em>
              )}
            </p>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Confirm restoring a paragraph to a point in its history: says what's undone (it can be redone). */
function ConfirmRestore({ where, undo, onCancel, onConfirm }: { where: string; undo: string[]; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  return createPortal(
    <div className="modal-back" onClick={onCancel}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="restore-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="history" size={15} />
          <h3 id="restore-title">Restore {where} to this point?</h3>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>This undoes what’s been done to it since{undo.length > 1 ? ', and what depends on it' : ''}:</p>
          <ul className="restore-list">
            {undo.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>You can redo it from the history.</p>
        </div>
        <div className="modal-foot">
          <button ref={cancel} className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={onConfirm}>
            Restore
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * Confirm closing the review: it's hidden on the Reviews page (nothing is deleted, and it can be
 * reopened here). Says how many changes are still to decide. Cancel has the focus.
 */
function ConfirmClose({ open, onCancel, onConfirm }: { open: number; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  return createPortal(
    <div className="modal-back" onClick={onCancel}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="close-review-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="check" size={15} />
          <h3 id="close-review-title">Close this review?</h3>
        </div>
        <div className="modal-body">
          {open > 0 && (
            <p style={{ marginTop: 0 }}>
              <strong>
                It still has {open} change{open === 1 ? '' : 's'} to decide.
              </strong>
            </p>
          )}
          <p style={{ marginTop: open ? undefined : 0, marginBottom: 0 }}>
            Closing marks it as done and hides it on the Reviews page. Nothing is deleted: you can open it from its contract and reopen it here at any time.
          </p>
        </div>
        <div className="modal-foot">
          <button ref={cancel} className="btn" onClick={onCancel}>
            Keep it open
          </button>
          <button className="btn primary" onClick={onConfirm}>
            Close review
          </button>
        </div>
      </div>
    </div>,
    document.body
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
