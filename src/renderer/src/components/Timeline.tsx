import { useEffect, useRef, useState } from 'react'
import type { HistoryAction, PipelineRun, PipelineStep, ReviewPart, ReviewSession } from '@shared/types'
import { describe, details } from '@shared/history'
import { isManual, blocksTouched, overridesOf, type Override } from '@shared/overrides'
import { marksFor, segmentsOf, shownText } from '@shared/changes'
import { diffSegments } from '@shared/diff'
import { Redline } from './Redline'
import { Icon } from '../lib/icons'

/**
 * The automated review, as a timeline in the review column: planned on upload, then each step as
 * it runs. Top-level steps run in order; a step's sub-items (a part's checks) are indented under
 * it, in their own order. The reviewer's gates (start the review; check the findings before the
 * new draft) are in the timeline, their button inline while waiting, then kept with who passed
 * them and when. What each step used is shown beside it, and the run's total against its budget
 * at the top.
 */
export function Timeline({
  session,
  onChange,
  onJump,
  focusBlock,
  onHold,
  jump,
  highlighted
}: {
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  onJump: (blockId: string) => void
  focusBlock?: string | null
  /** On security hold: the AI review can't be started or gone on with. */
  onHold?: boolean
  /** A part's marker in the document's margin clicked: its change (or its review), brought into view. */
  jump?: { partId: string; n: number } | null
  /** Text highlighted in the document (its paragraphs): the timeline folds to what's about it. */
  highlighted?: string[] | null
}) {
  const run = session.doc?.pipeline
  // A paragraph clicked in the document: its part, brought into view in the timeline.
  const box = useRef<HTMLElement>(null)
  const focusPart = jump?.partId ?? (focusBlock ? run?.parts?.find((p) => p.blockIds.includes(focusBlock))?.id : undefined)
  useEffect(() => {
    if (!focusPart) return
    const els = [...(box.current?.querySelectorAll<HTMLElement>(`[data-part="${focusPart}"]`) ?? [])]
    // The latest mention of it (its proposal, if it has one).
    els[els.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusPart])
  // Its marker clicked (again): its change brought into view, outlined for a few moments with
  // rings pulsing out from it, to catch the eye.
  useEffect(() => {
    if (!jump) return
    const els = [...(box.current?.querySelectorAll<HTMLElement>(`[data-part="${jump.partId}"]`) ?? [])]
    const el = els.find((x) => x.classList.contains('ck-item')) ?? els[els.length - 1]
    if (!el) return
    // Its top at the top of the column (room left for the outline and its rings), filling as
    // much of the column as it can.
    el.style.scrollMarginTop = '16px'
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    for (const x of box.current?.querySelectorAll('.tl-spot') ?? []) x.classList.remove('tl-spot')
    void el.offsetWidth
    el.classList.add('tl-spot')
    const done = (e: AnimationEvent) => {
      if (e.target !== el || e.animationName !== 'tl-spot') return
      el.classList.remove('tl-spot')
      el.removeEventListener('animationend', done)
    }
    el.addEventListener('animationend', done)
  }, [jump?.n])
  // Highlighted text: only the parts it's in (and the steps about them), until Show everything.
  const [everything, setEverything] = useState(false)
  const hlKey = highlighted?.join(',') ?? ''
  useEffect(() => setEverything(false), [hlKey])
  const only = highlighted?.length && !everything && run?.parts ? new Set(run.parts.filter((p) => p.blockIds.some((id) => highlighted.includes(id))).map((p) => p.id)) : null
  const onlyBlocks = only ? new Set(run!.parts!.filter((p) => only.has(p.id)).flatMap((p) => p.blockIds)) : null
  // The reviewer's own edits, among the AI review's steps; and the AI changes they overrode.
  const manual = (session.doc?.history ?? []).filter(isManual)
  const overrides = session.doc ? overridesOf(session.doc) : {}
  const [defaults, setDefaults] = useState<Awaited<ReturnType<typeof window.api.pipeline.defaults>> | null>(null)
  useEffect(() => void window.api.pipeline.defaults().then(setDefaults), [session.id])
  const [questions, setQuestions] = useState<{ id: string; title: string }[]>([])
  useEffect(() => void window.api.questions.list().then((q) => setQuestions(q.map((x) => ({ id: x.id, title: x.title })))), [])

  return (
    <section className="rc-section tl" ref={box}>
      {/* Everything here stays in place: the rows are there from the start and their text changes
          (a step's result, the run's state); only what results add (later rounds, a part's
          problems) is added, and nothing is taken away. */}
      <div className="tl-head">
        <div className="dr-mini-h">AI review</div>
        <RunControls session={session} onChange={onChange} disabled={onHold} />
        <RunStatus run={run} />
      </div>
      <p className={`dr-small tl-note ${run?.status ?? 'none'}`}>{noteOf(run, defaults)}</p>
      {only && (
        <div className="tl-filter dr-small">
          <span>
            Showing what’s about the highlighted text
            {only.size ? `: ${[...only].map((id) => run?.parts?.find((p) => p.id === id)?.title).filter(Boolean).join(', ')}` : ' (no part of the review is about it)'}
          </span>
          <button className="link-btn" onClick={() => setEverything(true)}>
            Show everything
          </button>
        </div>
      )}

      {(
        <ol className="tl-steps">
          {withEdits(run?.steps ?? PLANNED_STEPS, manual)
            .filter((x) => (x.kind === 'step' ? !only || about(x.step, only) || (x.step.id === 'check' && x.step.status === 'needs-you') : !onlyBlocks || blocksTouched(x.action).some((id) => onlyBlocks.has(id))))
            .map((x) =>
              x.kind === 'edit' ? (
                <ManualEntry key={x.action.id} action={x.action} session={session} overrides={overrides} onJump={onJump} />
              ) : GATES.has(x.step.id) ? (
                <Gate key={x.step.id} step={x.step} session={session} onChange={onChange} disabled={onHold || !run} questions={questions} onJump={onJump} only={only} focusPart={focusPart} overrides={overrides} />
              ) : (
                <Step key={x.step.id} step={x.step} run={run ?? EMPTY_RUN} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} only={only} overrides={overrides} />
              )
            )}
        </ol>
      )}

      <p className="faint dr-small tl-model">{defaults ? `${defaults.name} · ${defaults.model}` : '\u00a0'}</p>
    </section>
  )
}

/** Whether a step (or one of its items) is about one of these parts. */
function about(st: PipelineStep, parts: Set<string>): boolean {
  return (!!st.partId && parts.has(st.partId)) || (st.children ?? []).some((c) => about(c, parts))
}

/** The steps a run has, before there is one (the draft not planned yet): shown waiting. */
const PLANNED_STEPS: PipelineStep[] = [
  ['security', 'Check for hidden instructions'],
  ['structure', 'Read the contract’s structure'],
  ['plan', 'Plan the review'],
  ['start', 'Start the review'],
  ['review', 'Review each part'],
  ['crosscheck', 'Check the findings together'],
  ['consolidate', 'Bring the findings together'],
  ['check', 'Your check of the changes'],
  ['approve', 'Make the changes'],
  ['draft', 'New draft and email']
].map(([id, title]) => ({ id, title, status: 'waiting' }))
const EMPTY_RUN = { steps: [], parts: [] } as unknown as PipelineRun

/** What each step does, shown until it has a result (so the row doesn't grow when one comes). */
const ABOUT: Record<string, string> = {
  security: 'Text addressed to an AI reviewer.',
  structure: 'The parts, and how closely to check each.',
  plan: 'What the review is estimated to use.',
  start: 'Once the plan is ready.',
  review: 'Each part against our standards.',
  crosscheck: 'Clashes and knock-on effects across parts.',
  consolidate: 'One change per part, from the findings.',
  approve: 'The changes you kept, made to the draft.',
  check: 'Keep or drop each change, or send it back.',
  draft: 'The marked-up copy and the email.'
}
const aboutOf = (id: string) => ABOUT[id.replace(/-\d+$/, '')] ?? ''

/** The run's state in a sentence, in a line that's always there. */
function noteOf(run: PipelineRun | undefined, defaults: { ready: boolean; why?: string } | null) {
  if (!run) return defaults && !defaults.ready ? (defaults.why ?? 'The AI isn’t set up.') : 'The draft is planned when it’s uploaded or first opened.'
  if (run.note) return run.note
  if (run.status === 'running') return run.confirmed ? 'Reviewing: it runs on its own until the findings are for you to check.' : 'Reading the draft and planning its review…'
  return { planned: 'Planned.', paused: 'Paused.', stopped: 'Stopped.', done: 'Done.', error: 'Something went wrong.' }[run.status] ?? ''
}

function RunStatus({ run }: { run?: PipelineRun }) {
  if (!run) return <span className="tl-pill none">Not planned</span>
  const label = { running: run.confirmed ? 'Running' : 'Planning', planned: 'Planned', paused: run.steps.some((x) => x.id === 'check' && x.status === 'needs-you') ? 'Manual review' : 'Paused', stopped: 'Stopped', done: 'Done', error: 'Failed' }[run.status]
  return <span className={`tl-pill ${run.status}`}>{run.status === 'running' && <span className="spinner tl-spin" />}{label}</span>
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** What the AI review has used against its budget (fixed at the foot of the review column). */
export function Spent({ run }: { run?: PipelineRun }) {
  if (!run)
    return (
      <div className="tl-spent">
        <div className="tl-spent-bar" />
        <span className="faint dr-small">No AI used yet</span>
      </div>
    )
  const tokens = run.spent.input + run.spent.cached + run.spent.output
  const share = run.provider === 'anthropic' && run.budget.usd ? (run.spent.usd ?? 0) / run.budget.usd : tokens / run.budget.tokens
  return (
    <div className="tl-spent">
      <div className="tl-spent-bar">
        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <span className="faint dr-small">
        {run.provider === 'anthropic' ? `$${(run.spent.usd ?? 0).toFixed(2)} of $${(run.budget.usd ?? 0).toFixed(2)} · ` : ''}
        {k(tokens)} tokens{run.provider === 'anthropic' ? '' : ` of ${k(run.budget.tokens)}`}
        {run.estimate && ` · estimate ${k(run.estimate.tokens)}${run.estimate.usd !== undefined ? ` ($${run.estimate.usd.toFixed(2)})` : ''}`}
      </span>
    </div>
  )
}

function StatusIcon({ status }: { status: PipelineStep['status'] }) {
  if (status === 'running') return <span className="tl-icon running"><span className="spinner tl-spin" /></span>
  const icon = { waiting: null, done: 'check', skipped: null, 'needs-you': 'alert', error: 'x' }[status]
  return <span className={`tl-icon ${status}`}>{icon ? <Icon name={icon} size={11} stroke={2.6} /> : status === 'skipped' ? '–' : null}</span>
}

function Step({ step, run, session, onJump, onChange, focusPart, only, overrides }: { step: PipelineStep; run: PipelineRun; session: ReviewSession; onJump: (blockId: string) => void; onChange: (s: ReviewSession) => void; focusPart?: string; only?: Set<string> | null; overrides?: Record<string, Override> }) {
  // A step's items (a part's checks) on request; otherwise only failures (what was found is at the
  // reviewer's check), and the part asked about (its marker clicked; the highlighted text's). Its
  // progress is in its own line.
  const [all, setAll] = useState(false)
  const kids = step.children ?? []
  const shown = only ? kids.filter((c) => about(c, only)) : all ? kids : kids.filter((c) => c.status === 'error' || (c.partId && c.partId === focusPart))
  const finished = kids.filter((c) => c.status !== 'waiting' && c.status !== 'running').length
  const detail = step.status === 'running' && kids.length ? `${finished} of ${kids.length} done…` : (step.detail ?? aboutOf(step.id))
  const part = step.partId ? run.parts?.find((p) => p.id === step.partId) : undefined
  const usage = step.usage && step.usage.input + step.usage.cached + step.usage.output
  // Under "Make the changes": what the part's change did (opened from its row).
  const [open, setOpen] = useState(false)
  const proposal = part?.proposal && /^approve(-\d+)?:/.test(step.id) && part.proposal.status === 'approved' ? part : undefined
  useEffect(() => {
    if (proposal && proposal.id === focusPart) setOpen(true)
  }, [focusPart, !!proposal])
  return (
    <li className={`tl-step ${step.status} ${part && part.id === focusPart ? 'focus' : ''}`} data-part={part?.id}>
      <div className="tl-row">
        <StatusIcon status={step.status} />
        <div className="tl-body">
          <div className="tl-title">
            {part ? (
              <button className="link-btn tl-part" onClick={() => onJump(part.blockIds[0])} title="Show it in the document">
                {step.title}
              </button>
            ) : (
              step.title
            )}
            {kids.length > 0 && (
              <button className="link-btn tl-count" onClick={() => setAll(!all)} title={all ? 'Show only what needs something' : 'Show all of them'}>
                {all ? `${kids.length} ▾` : shown.length ? `${shown.length} of ${kids.length} ▸` : `${kids.length} ▸`}
              </button>
            )}
            {usage ? (
              <span className="tl-usage faint">
                {k(usage)} tokens{step.usage?.usd !== undefined ? ` · $${step.usage.usd.toFixed(3)}` : ''}
              </span>
            ) : null}
          </div>
          {detail ? <div className="tl-detail faint">{detail}</div> : null}
          {step.error && <div className="tl-detail dr-err">{step.error}</div>}
          {proposal && overrides?.[proposal.id]?.kind === 'change' && <OverriddenLabel o={overrides[proposal.id]} what="this change" />}
          {proposal && (
            <button className="link-btn tl-count" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide what changed ▾' : 'What changed ▸'}
            </button>
          )}
          {proposal && open && <ProposalCard part={proposal} session={session} onJump={onJump} />}
        </div>
      </div>
      {shown.length > 0 && (
        <ol className="tl-steps tl-sub">
          {shown.map((c) => (
            <Step key={c.id} step={c} run={run} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} only={only} overrides={overrides} />
          ))}
        </ol>
      )}
    </li>
  )
}

/**
 * What a part's change did (made by the AI review, one action in the review's history): the new
 * wording, their changes accepted or rejected, the comment to them, each with why.
 */
function ProposalCard({ part, session, onJump }: { part: ReviewPart; session: ReviewSession; onJump: (blockId: string) => void }) {
  const p = part.proposal!
  const d = session.doc!
  const block = (id: string) => d.blocks.find((b) => b.id === id)
  const where = (id: string) => (block(id)?.label ? `§${block(id)!.label!.replace(/\.$/, '')}` : 'Paragraph')
  return (
    <div className="tl-proposal">
      {p.wording.map((w, i) => (
        <div key={i} className="tl-prop-item rl-ours">
          <button className="link-btn tl-prop-where" onClick={() => onJump(w.blockId)}>
            {where(w.blockId)}
          </button>{' '}
          reworded
          {w.why && <div className="faint tl-prop-why">{w.why}</div>}
        </div>
      ))}
      {p.decisions.map((x, i) => {
        const b = block(x.blockId)
        const seg = b ? segmentsOf(b)[x.seg] : undefined
        return (
          <div key={`d${i}`} className="tl-prop-item">
            <span className={`sel-st ${x.outcome}`}>{x.outcome === 'accepted' ? 'Accepted' : 'Rejected'}</span> their {seg?.op === 'ins' ? 'insertion' : 'deletion'} in{' '}
            <button className="link-btn tl-prop-where" onClick={() => onJump(x.blockId)}>
              {where(x.blockId)}
            </button>
            {seg && (
              <>
                {': '}
                {seg.op === 'ins' ? <ins className="th-ins">{seg.text.slice(0, 160)}</ins> : <del className="th-del">{seg.text.slice(0, 160)}</del>}
              </>
            )}
            {x.why && <div className="faint tl-prop-why">{x.why}</div>}
          </div>
        )
      })}
      {p.comment && (
        <div className="tl-prop-item">
          <span className="faint">Comment to them:</span> <span className="hist-comment">“{p.comment.text}”</span>
        </div>
      )}
      {(p.replies ?? []).map((r) => (
        <div key={r.commentId} className="tl-prop-item">
          <span className="faint">Reply to their comment:</span> <span className="hist-comment">“{r.text}”</span>
        </div>
      ))}
    </div>
  )
}

/** The reviewer's gates in the timeline: start the review (from the plan), check the findings (before the draft). */
const GATES = new Set(['start', 'check'])
const GATE_BUTTON: Record<string, { label: string; icon: string; tip: string }> = {
  start: { label: 'Start AI review', icon: 'sparkle', tip: 'Review the parts as planned. It runs on its own until the findings are for you to check.' },
  check: { label: 'Apply & write draft', icon: 'mail', tip: 'Make the changes kept, then write the new draft and the email' }
}

/** Calls to the AI review from the timeline: the session it returns, or what went wrong. */
function useRunAct(onChange: (s: ReviewSession) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (p: Promise<ReviewSession>) => {
    setBusy(true)
    setError(null)
    try {
      onChange(await p)
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, act }
}

/**
 * A gate: waiting, its button inline (going on is the reviewer's decision); passed, kept in the
 * timeline with who passed it and when.
 */
function Gate({
  step,
  session,
  onChange,
  disabled,
  questions,
  onJump,
  only,
  focusPart,
  overrides
}: {
  step: PipelineStep
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  disabled?: boolean
  questions: { id: string; title: string }[]
  onJump: (blockId: string) => void
  only?: Set<string> | null
  focusPart?: string
  overrides?: Record<string, Override>
}) {
  const { busy, error, act } = useRunAct(onChange)
  const waiting = step.status === 'needs-you'
  const passed = step.status === 'done'
  const b = GATE_BUTTON[step.id]
  // The same box in every state: its line, then its button (until reached: not yet; waiting: go
  // on; passed: who and when, in the button's place).
  return (
    <li className={`tl-step tl-gate ${step.status}`}>
      <div className="tl-row">
        <StatusIcon status={step.status} />
        <div className="tl-body">
          <div className="tl-title">{step.title}</div>
          <div className="tl-detail faint">{step.detail ?? aboutOf(step.id)}</div>
          {step.id === 'check' && waiting && <CheckReview session={session} onChange={onChange} disabled={disabled} questions={questions} onJump={onJump} only={only} focusPart={focusPart} overrides={overrides ?? {}} />}
          {!(step.id === 'check' && waiting) && <div className="tl-gate-act">
            {passed ? (
              <span className="tl-gate-passed">
                <Icon name="check" size={13} stroke={2.4} /> {step.by ? `${step.id === 'start' ? 'Started' : 'Checked'} by ${step.by} · ${when(step.endedAt)}` : 'Passed'}
              </span>
            ) : (
              <button className={`btn sm ${waiting ? 'primary' : ''}`} disabled={!waiting || busy || disabled} onClick={() => act(window.api.pipeline.continue(session.id))} title={b?.tip}>
                {busy ? <span className="spinner sm" /> : <Icon name={b?.icon ?? 'next'} size={14} />} {b?.label}
              </button>
            )}
          </div>}
          {error && <p className="dr-small dr-err">{error}</p>}
        </div>
      </div>
    </li>
  )
}

/**
 * The reviewer's check: every change proposed, each to approve (nothing is made to the draft
 * unless approved) or send back with a note; the questions the review suggests asking, to tick
 * for another round. What was approved in an earlier round stays approved, folded away: a later
 * round asks only about what changed in it. Changes like ones approved before on other
 * contracts (the same ask, answered the same way) are suggested for approval.
 */
function CheckReview({
  session,
  onChange,
  disabled,
  questions,
  onJump,
  only,
  focusPart,
  overrides
}: {
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  disabled?: boolean
  questions: { id: string; title: string }[]
  onJump: (blockId: string) => void
  /** The parts the highlighted text is in: only their changes and questions shown. */
  only?: Set<string> | null
  focusPart?: string
  /** Proposed changes the reviewer has since made their own edit over: set aside, folded. */
  overrides: Record<string, Override>
}) {
  const run = session.doc!.pipeline!
  const d = session.doc!
  const round = run.round ?? 1
  const all = (run.parts ?? []).filter((p) => p.proposal && !p.proposal.appliedAt && (p.proposal.status === 'pending' || p.proposal.status === 'approved'))
  const overridden = all.filter((p) => overrides[p.id]?.kind === 'proposal')
  const waitingOn = all.filter((p) => !overridden.includes(p))
  // Approved in an earlier round and not sent back since: nothing new to look at.
  const earlier = waitingOn.filter((p) => p.proposal!.status === 'approved' && (p.proposal!.round < round || !!p.proposal!.carriedFrom))
  const current = waitingOn.filter((p) => !earlier.includes(p))
  const shownParts = (list: ReviewPart[]) => (only ? list.filter((p) => only.has(p.id)) : list)
  // The same question suggested for several parts: one line, asked of all of them if ticked.
  const suggested = groupQuestions((run.questions ?? []).filter((q) => !q.asked && !q.dismissed && (!only || only.has(q.partId))))
  // Approved as they're ticked, and kept as they go (the page's left margin turns green for them).
  const approved = new Set(waitingOn.filter((p) => p.proposal!.status === 'approved').map((p) => p.id))
  const approve = (ids: string[], on: boolean) => act(window.api.pipeline.approve(session.id, ids, on))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noting, setNoting] = useState<Set<string>>(new Set())
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [showEarlier, setShowEarlier] = useState(false)
  const [before, setBefore] = useState<Awaited<ReturnType<typeof window.api.pipeline.approvedBefore>>>({})
  useEffect(() => {
    void window.api.pipeline.approvedBefore(session.id).then(setBefore).catch(() => setBefore({}))
  }, [session.id, round])
  const { busy, error, act } = useRunAct(onChange)
  // Opened: brought into view (it's what's waiting).
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.closest('.tl-gate')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])
  const flip = <T,>(set: Set<T>, x: T) => {
    const next = new Set(set)
    if (next.has(x)) next.delete(x)
    else next.add(x)
    return next
  }
  const noted = (id: string) => !!notes[id]?.trim()
  const asked = suggested.filter((q) => ticked.has(q.questionId)).flatMap((q) => q.partIds.map((partId) => ({ questionId: q.questionId, partId })))
  const sentBack = Object.values(notes).filter((n) => n.trim()).length + ticked.size
  const approving = waitingOn.filter((p) => approved.has(p.id) && !noted(p.id))
  const unapproved = current.filter((p) => !approved.has(p.id) && !noted(p.id)).length
  const suggestible = current.filter((p) => before[p.id] && !approved.has(p.id) && !noted(p.id))
  const block = (id: string) => d.blocks.find((b) => b.id === id)
  const where = (id: string) => (block(id)?.label ? `§${block(id)!.label!.replace(/\.$/, '')}` : 'Paragraph')
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  const RESPONSE = { accepted: 'Accepted', countered: 'Answered with our wording', restored: 'Our wording kept', struck: 'Struck' } as const

  const card = (part: ReviewPart, folded: boolean) => {
    const p = part.proposal!
    const ok = approved.has(part.id) && !noted(part.id)
    const like = before[part.id]
    return (
      <div key={part.id} className={`ck-item ${ok ? 'approved' : ''} ${folded ? 'folded' : ''} ${part.id === focusPart ? 'focus' : ''}`} data-part={part.id}>
        <div className="ck-head">
          <button className="link-btn tl-part" onClick={() => onJump(part.blockIds[0])} title="Show it in the document">
            {part.title}
          </button>
          {ok && <span className="ck-badge">{folded ? `Approved in round ${p.carriedFrom ?? p.round}` : 'Approved'}</span>}
        </div>
        {folded && p.carriedFrom && <p className="faint dr-small ck-carried">Looked at again for your question: the same change, so your approval stands.</p>}
        {!folded && part.approvedEarlier && p.status !== 'approved' && <ChangedSinceApproved part={part} session={session} />}
        <p className="ck-summary">{p.summary}</p>
        {!folded && (
          <>
            {p.wording.map((w, i) => {
              const b = block(w.blockId)
              return (
                <div key={i} className="ck-detail">
                  <span className="faint">{where(w.blockId)}:</span> <Redline segments={diffSegments(b ? shownText(marksFor(d, b)) : '', w.text)} />
                </div>
              )
            })}
            {grouped(p.decisions).map((g) => (
              <div key={`${g.blockId}|${g.outcome}`} className="ck-detail">
                <span className={`sel-st ${g.outcome}`}>{g.outcome === 'accepted' ? 'Accept' : 'Reject'}</span> {g.count === 1 ? 'their change' : `${g.count} of their changes`} in {where(g.blockId)}
                <span className="faint">: {g.whys.join(' ')}</span>
              </div>
            ))}
            {p.comment && (
              <div className="ck-detail">
                <span className="faint">Comment to them:</span> “{p.comment.text}”
              </div>
            )}
            {(p.replies ?? []).map((r) => (
              <div key={r.commentId} className="ck-detail">
                <span className="faint">Reply to their comment:</span> “{r.text}”
              </div>
            ))}
            {like && (
              <div className="ck-like">
                <Icon name="history" size={12} /> Like {like.length === 1 ? 'a change' : 'changes'} approved before:{' '}
                {like.map((h, i) => (
                  <span key={i}>
                    {i ? '; ' : ''}
                    {RESPONSE[h.response].toLowerCase()} for {h.counterparty}
                    {h.where ? ` (${h.where})` : ''}, {fmtDate(h.date)}
                  </span>
                ))}
                .
              </div>
            )}
          </>
        )}
        {noting.has(part.id) && (
          <textarea
            className="ck-note"
            rows={2}
            autoFocus
            placeholder="What should change? It goes back for another round."
            value={notes[part.id] ?? ''}
            onChange={(e) => setNotes({ ...notes, [part.id]: e.target.value })}
          />
        )}
        <div className="ck-foot">
          <label className={`ck-approve ${ok ? 'on' : ''}`} title={noted(part.id) ? 'Sent back with your note: it’s reviewed again' : undefined}>
            <input type="checkbox" checked={ok} disabled={noted(part.id) || busy} onChange={() => approve([part.id], !approved.has(part.id))} /> Approve
          </label>
          {!folded && !noting.has(part.id) && (
            <button className="link-btn ck-add-note" onClick={() => setNoting(flip(noting, part.id))}>
              Send back with a note
            </button>
          )}
        </div>
      </div>
    )
  }

  const now = shownParts(current)
  const folded = shownParts(earlier)
  return (
    <div className="ck" ref={box}>
      {suggestible.length > 0 && (
        <div className="ck-suggest">
          <span>
            {suggestible.length === 1 ? 'One change is' : `${suggestible.length} changes are`} like ones approved before on other contracts.
          </span>
          <button className="btn sm" disabled={busy} onClick={() => approve(suggestible.map((p) => p.id), true)}>
            <Icon name="check" size={13} /> Approve {suggestible.length === 1 ? 'it' : `those ${suggestible.length}`}
          </button>
        </div>
      )}
      {now.map((part) => card(part, false))}
      {shownParts(overridden).map((part) => (
        <div key={part.id} className="ck-item overridden" data-part={part.id}>
          <div className="ck-head">
            <button className="link-btn tl-part" onClick={() => onJump(part.blockIds[0])} title="Show it in the document">
              {part.title}
            </button>
            <span className="ck-badge muted">Overridden</span>
          </div>
          <OverriddenLabel o={overrides[part.id]} what="the change proposed here" />
        </div>
      ))}
      {only && !now.length && !folded.length && <p className="faint dr-small">No changes proposed for the highlighted text.</p>}
      {folded.length > 0 && (
        <div className="ck-earlier">
          <button className="link-btn tl-count" onClick={() => setShowEarlier((v) => !v)}>
            {showEarlier || folded.some((p) => p.id === focusPart) ? '▾' : '▸'} Approved in an earlier round ({folded.length}): nothing new in them
          </button>
          {(showEarlier || folded.some((p) => p.id === focusPart)) && folded.map((part) => card(part, true))}
        </div>
      )}
      {suggested.length > 0 && (
        <div className="ck-questions">
          <div className="dr-mini-h">Worth asking too</div>
          {suggested.map((q) => {
            const parts = q.partIds.map((id) => run.parts?.find((p) => p.id === id)).filter((p): p is ReviewPart => !!p)
            return (
              <label key={q.questionId} className="ck-question">
                <input type="checkbox" checked={ticked.has(q.questionId)} onChange={() => setTicked(flip(ticked, q.questionId))} />
                <span>
                  <strong>{questions.find((x) => x.id === q.questionId)?.title ?? q.questionId}</strong>
                  {parts.length > 0 && <span className="faint"> on {parts.length === 1 ? parts[0].title : `${parts.length} parts: ${parts.map((p) => p.title).join(', ')}`}</span>}
                  <span className="faint dr-small ck-why">{q.why}</span>
                </span>
              </label>
            )
          })}
        </div>
      )}
      <div className="ck-actions">
        <button
          className="btn sm"
          disabled={busy || disabled || !sentBack}
          title={sentBack ? 'Review what you sent back again, with your notes and questions, and propose its changes again. Your approvals are kept.' : 'Write a note on a change, or tick a question, to send it back'}
          onClick={() =>
            act(
              window.api.pipeline.iterate(session.id, {
                notes: Object.fromEntries(Object.entries(notes).filter(([, n]) => n.trim())),
                questions: asked,
                approved: approving.map((p) => p.id)
              })
            )
          }
        >
          Run another round{sentBack ? ` (${sentBack})` : ''}
        </button>
        <button className="btn sm primary" disabled={busy || disabled || sentBack > 0} title={sentBack ? 'Some changes are sent back: run another round first' : undefined} onClick={() => act(window.api.pipeline.apply(session.id, approving.map((p) => p.id)))}>
          {busy ? <span className="spinner sm" /> : <Icon name="mail" size={13} />} {approving.length ? `Apply ${approving.length} approved & write draft` : 'Write draft and email'}
        </button>
      </div>
      {unapproved > 0 && !sentBack && (
        <p className="faint dr-small ck-left-out">
          {unapproved} change{unapproved === 1 ? '' : 's'} not approved: left out of the draft if you apply now.
        </p>
      )}
      {error && <p className="dr-small dr-err">{error}</p>}
    </div>
  )
}

/**
 * A change the reviewer approved, looked at again for a question they asked, and proposed
 * differently this time: what they approved, and how this round's differs, to approve again.
 */
function ChangedSinceApproved({ part, session }: { part: ReviewPart; session: ReviewSession }) {
  const was = part.approvedEarlier!
  const now = part.proposal!
  const d = session.doc!
  const where = (id: string) => {
    const b = d.blocks.find((x) => x.id === id)
    return b?.label ? `§${b.label.replace(/\.$/, '')}` : 'Paragraph'
  }
  const current = (id: string) => {
    const b = d.blocks.find((x) => x.id === id)
    return b ? shownText(marksFor(d, b)) : ''
  }
  const blocks = [...new Set([...was.wording.map((w) => w.blockId), ...now.wording.map((w) => w.blockId)])]
  const differs = blocks.filter((id) => (was.wording.find((w) => w.blockId === id)?.text ?? '') !== (now.wording.find((w) => w.blockId === id)?.text ?? ''))
  const decided = (p: typeof was) => new Set(p.decisions.map((x) => `${x.blockId}:${x.seg}:${x.outcome}`))
  const a = decided(was)
  const b = decided(now)
  const decisionsDiffer = a.size !== b.size || [...a].some((k) => !b.has(k))
  return (
    <div className="ck-changed dr-small">
      <div>
        <strong>Changed since you approved it in round {was.carriedFrom ?? was.round}</strong> (looked at again for your question). Approve it again if this round’s change is right.
      </div>
      {differs.map((id) => (
        <div key={id} className="ck-detail">
          <span className="faint">{where(id)}, from what you approved:</span>{' '}
          <Redline segments={diffSegments(was.wording.find((w) => w.blockId === id)?.text ?? current(id), now.wording.find((w) => w.blockId === id)?.text ?? current(id))} />
        </div>
      ))}
      {decisionsDiffer && <div className="faint">Its decisions on their changes are different too (below).</div>}
    </div>
  )
}

/** Bring one of the reviewer's edits in the timeline into view, and mark it for a moment. */
function showAction(id: string) {
  const el = document.querySelector<HTMLElement>(`.tl [data-action="${id}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('tl-flash')
  void el.offsetWidth
  el.classList.add('tl-flash')
}

/** On an AI change (made, or proposed) the reviewer's own edit overrode: says so, and links to the edit. */
function OverriddenLabel({ o, what }: { o: Override; what: string }) {
  return (
    <div className="tl-overridden dr-small">
      <Icon name="users" size={12} /> Your edit replaced {what}.{' '}
      <button className="link-btn" onClick={() => showAction(o.actionId)}>
        See your edit
      </button>
    </div>
  )
}

/** The review's steps with the reviewer's own edits among them, each after the step it followed. */
function withEdits(steps: PipelineStep[], edits: HistoryAction[]): ({ kind: 'step'; step: PipelineStep } | { kind: 'edit'; action: HistoryAction })[] {
  const out: ({ kind: 'step'; step: PipelineStep } | { kind: 'edit'; action: HistoryAction })[] = []
  const after = (a: HistoryAction) => {
    let at = -1
    steps.forEach((st, i) => {
      if (st.startedAt && st.startedAt <= a.at) at = i
    })
    return at
  }
  const placed = edits.map((a) => ({ a, at: after(a) }))
  for (const x of placed.filter((p) => p.at < 0)) out.push({ kind: 'edit', action: x.a })
  steps.forEach((st, i) => {
    out.push({ kind: 'step', step: st })
    for (const x of placed.filter((p) => p.at === i)) out.push({ kind: 'edit', action: x.a })
  })
  return out
}

/**
 * One of the reviewer's own edits, in the timeline like the AI review's steps: what they did, and
 * where it overrode the AI: a change it made (shown, with the edit after it) or one it proposed.
 */
function ManualEntry({ action, session, overrides, onJump }: { action: HistoryAction; session: ReviewSession; overrides: Record<string, Override>; onJump: (blockId: string) => void }) {
  const d = session.doc!
  const run = d.pipeline
  const over = Object.entries(overrides)
    .filter(([, o]) => o.actionId === action.id)
    .map(([partId, o]) => ({ part: run?.parts?.find((p) => p.id === partId), kind: o.kind }))
    .filter((x): x is { part: ReviewPart; kind: Override['kind'] } => !!x.part)
  const items = details(d, action).filter((x) => x.kind === 'edited' || x.kind === 'resolved' || x.kind === 'paragraph')
  const changed = over.filter((x) => x.kind === 'change')
  const proposed = over.filter((x) => x.kind === 'proposal')
  const showPart = (partId: string) => {
    const el = document.querySelector<HTMLElement>(`.tl .ck-item[data-part="${partId}"], .tl [data-part="${partId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return (
    <li className="tl-step done manual" data-action={action.id}>
      <div className="tl-row">
        <span className="tl-icon manual">
          <Icon name="users" size={11} stroke={2.4} />
        </span>
        <div className="tl-body">
          <div className="tl-title">
            {describe(d, action)}
            {over.length > 0 && <span className="tl-override-tag">Overrides the AI</span>}
          </div>
          <div className="tl-detail faint">
            {action.by} · {when(action.at)}
          </div>
          {changed.map(({ part }) => (
            <div key={part.id} className="tl-override-box">
              <div className="dr-small faint">
                First the AI review changed{' '}
                <button className="link-btn" onClick={() => onJump(part.blockIds[0])}>
                  {part.title}
                </button>
                {part.proposal?.appliedAt ? ` (${when(part.proposal.appliedAt)})` : ''}:
              </div>
              <p className="ck-summary">{part.proposal?.summary}</p>
              <ProposalCard part={part} session={session} onJump={onJump} />
              <div className="dr-small faint tl-then">Then your edit, over it:</div>
            </div>
          ))}
          {proposed.map(({ part }) => (
            <div key={part.id} className="dr-small tl-instead">
              Instead of the change proposed for{' '}
              <button className="link-btn" onClick={() => showPart(part.id)}>
                {part.title}
              </button>
              : that proposal is set aside.
            </div>
          ))}
          {items.slice(0, 4).map((x, i) => (
            <div key={i} className="tl-prop-item">
              <button className="link-btn tl-prop-where" onClick={() => onJump(x.blockId)}>
                {x.where}
              </button>
              {': '}
              {x.kind === 'edited' ? (
                <Redline segments={diffSegments(x.before, x.after)} />
              ) : x.kind === 'resolved' ? (
                <>
                  <span className={`sel-st ${x.outcome ?? ''}`}>{x.outcome === 'accepted' ? 'Accepted' : x.outcome === 'rejected' ? 'Rejected' : 'Reopened'}</span> their {x.op === 'ins' ? 'insertion' : 'deletion'} “{x.text.slice(0, 120)}”
                </>
              ) : (
                <span>
                  {x.added ? 'added' : 'removed'} “{x.text.slice(0, 120)}”
                </span>
              )}
            </div>
          ))}
          {items.length > 4 && <div className="faint dr-small">and {items.length - 4} more</div>}
        </div>
      </div>
    </li>
  )
}

/** Suggested questions, one line each however many parts they're suggested for. */
function groupQuestions(list: { questionId: string; partId: string; why: string }[]) {
  const out: { questionId: string; partIds: string[]; why: string }[] = []
  for (const q of list) {
    const g = out.find((x) => x.questionId === q.questionId)
    if (g) g.partIds.push(q.partId)
    else out.push({ questionId: q.questionId, partIds: [q.partId], why: q.why })
  }
  return out
}

/** Their changes decided the same way in the same paragraph, together: how many, and the different reasons. */
function grouped(decisions: { blockId: string; outcome: 'accepted' | 'rejected'; why: string }[]) {
  const out: { blockId: string; outcome: 'accepted' | 'rejected'; count: number; whys: string[] }[] = []
  for (const x of decisions) {
    const g = out.find((y) => y.blockId === x.blockId && y.outcome === x.outcome)
    if (!g) out.push({ blockId: x.blockId, outcome: x.outcome, count: 1, whys: x.why ? [x.why] : [] })
    else {
      g.count++
      if (x.why && !g.whys.includes(x.why) && g.whys.length < 3) g.whys.push(x.why)
    }
  }
  return out
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * The AI review's other controls, under its note: Stop while it runs, Continue when it stopped
 * (a reached budget is raised by the default again), Review again once it's done, and Start for
 * a draft that wasn't planned (no AI when it was uploaded). Waiting at a gate, the gate's button.
 */
function RunControls({ session, onChange, disabled }: { session: ReviewSession; onChange: (s: ReviewSession) => void; disabled?: boolean }) {
  const run = session.doc?.pipeline
  const [defaults, setDefaults] = useState<Awaited<ReturnType<typeof window.api.pipeline.defaults>> | null>(null)
  useEffect(() => void window.api.pipeline.defaults().then(setDefaults), [session.id])
  const { busy, error, act } = useRunAct(onChange)
  if (!defaults || session.original) return <span className="tl-controls" />
  const off = busy || disabled || !defaults.ready
  const tip = !defaults.ready ? defaults.why : `${defaults.name} · ${defaults.model}`
  const atGate = run?.steps.some((x) => GATES.has(x.id) && x.status === 'needs-you')
  // Going on: a budget that ran out is raised by the default again.
  const more = () => {
    if (!run) return undefined
    const spent = run.spent.input + run.spent.cached + run.spent.output
    const out = spent >= run.budget.tokens || (run.budget.usd !== undefined && (run.spent.usd ?? 0) >= run.budget.usd)
    return out ? { tokens: run.budget.tokens + defaults.budget.tokens, usd: run.budget.usd !== undefined ? run.budget.usd + (defaults.budget.usd ?? 0) : undefined } : undefined
  }
  const button = (() => {
    if (atGate || run?.status === 'planned' || (run?.status === 'running' && !run.confirmed)) return null
    if (run?.status === 'running')
      return (
        <button className="link-btn tl-ctl" disabled={busy} onClick={() => act(window.api.pipeline.stop(session.id))} title="Stop the AI review: what it has done is kept">
          Stop
        </button>
      )
    if (run && (run.status === 'paused' || run.status === 'error' || run.status === 'stopped'))
      return (
        <button className="link-btn tl-ctl" disabled={off} onClick={() => act(window.api.pipeline.continue(session.id, more()))} title={tip}>
          Continue
        </button>
      )
    return (
      <button className="link-btn tl-ctl" disabled={off} onClick={() => act(window.api.pipeline.start(session.id, defaults.budget))} title={run ? 'Plan and review it again from the start' : tip}>
        {run ? 'Review again' : 'Start'}
      </button>
    )
  })()
  return (
    <span className="tl-controls" title={error ?? undefined}>
      {error && <Icon name="alert" size={13} />}
      {button}
    </span>
  )
}
