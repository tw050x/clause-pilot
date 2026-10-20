import { useEffect, useRef, useState } from 'react'
import type { PipelineRun, PipelineStep, ReviewPart, ReviewSession } from '@shared/types'
import { segmentsOf } from '@shared/changes'
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
  onHold
}: {
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  onJump: (blockId: string) => void
  focusBlock?: string | null
  /** On security hold: the AI review can't be started or gone on with. */
  onHold?: boolean
}) {
  const run = session.doc?.pipeline
  // A paragraph clicked in the document: its part, brought into view in the timeline.
  const box = useRef<HTMLElement>(null)
  const focusPart = focusBlock ? run?.parts?.find((p) => p.blockIds.includes(focusBlock))?.id : undefined
  useEffect(() => {
    if (!focusPart) return
    const els = [...(box.current?.querySelectorAll<HTMLElement>(`[data-part="${focusPart}"]`) ?? [])]
    // The latest mention of it (its proposal, if it has one).
    els[els.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusPart])
  const [defaults, setDefaults] = useState<Awaited<ReturnType<typeof window.api.pipeline.defaults>> | null>(null)
  useEffect(() => void window.api.pipeline.defaults().then(setDefaults), [session.id])
  const [questions, setQuestions] = useState<{ id: string; title: string }[]>([])
  useEffect(() => void window.api.questions.list().then((q) => setQuestions(q.map((x) => ({ id: x.id, title: x.title })))), [])

  return (
    <section className="rc-section tl" ref={box}>
      {/* Everything here stays in place: the rows are there from the start and their text changes
          (a step's result, the run's state); only what results add (later rounds, a part's
          problems, questions worth asking) is added, and nothing is taken away. */}
      <div className="tl-head">
        <div className="dr-mini-h">AI review</div>
        <RunControls session={session} onChange={onChange} disabled={onHold} />
        <RunStatus run={run} />
      </div>
      <Spent run={run} />
      <p className={`dr-small tl-note ${run?.status ?? 'none'}`}>{noteOf(run, defaults)}</p>

      {(
        <ol className="tl-steps">
          {(run?.steps ?? PLANNED_STEPS).map((st) => (
            GATES.has(st.id) ? (
              <Gate key={st.id} step={st} session={session} onChange={onChange} disabled={onHold || !run} />
            ) : (
              <Step key={st.id} step={st} run={run ?? EMPTY_RUN} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} />
            )
          ))}
        </ol>
      )}

      {run?.questions && run.questions.length > 0 && (
        <div className="tl-questions">
          <div className="dr-mini-h">Worth asking too</div>
          {run.questions.map((q, i) => {
            const part = run.parts?.find((p) => p.id === q.partId)
            return (
              <div key={i} className="tl-question dr-small">
                <strong>{questions.find((x) => x.id === q.questionId)?.title ?? q.questionId}</strong>
                {part && (
                  <>
                    {' '}
                    on{' '}
                    <button className="link-btn" onClick={() => onJump(part.blockIds[0])}>
                      {part.title}
                    </button>
                  </>
                )}
                <span className="faint">: {q.why}</span>
              </div>
            )
          })}
        </div>
      )}

      <p className="faint dr-small tl-model">{defaults ? `${defaults.name} · ${defaults.model}` : '\u00a0'}</p>
    </section>
  )
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
  ['approve', 'Make the changes'],
  ['check', 'Your check of the findings'],
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
  approve: 'Each change made to the draft.',
  check: 'Once the changes are made.',
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

function Spent({ run }: { run?: PipelineRun }) {
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

function Step({ step, run, session, onJump, onChange, focusPart }: { step: PipelineStep; run: PipelineRun; session: ReviewSession; onJump: (blockId: string) => void; onChange: (s: ReviewSession) => void; focusPart?: string }) {
  // A step's items (a part's checks) on request; otherwise only those with a result for the
  // reviewer (something found, a failure): those stay. Its progress is in its own line.
  const [all, setAll] = useState(false)
  const kids = step.children ?? []
  const shown = all ? kids : kids.filter((c) => c.status === 'needs-you' || c.status === 'error')
  const finished = kids.filter((c) => c.status !== 'waiting' && c.status !== 'running').length
  const detail = step.status === 'running' && kids.length ? `${finished} of ${kids.length} done…` : (step.detail ?? aboutOf(step.id))
  const part = step.partId ? run.parts?.find((p) => p.id === step.partId) : undefined
  const usage = step.usage && step.usage.input + step.usage.cached + step.usage.output
  // Under "Make the changes": what the part's change did (opened from its row).
  const [open, setOpen] = useState(false)
  const proposal = part?.proposal && /^approve(-\d+)?:/.test(step.id) && part.proposal.status === 'approved' ? part : undefined
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
            <Step key={c.id} step={c} run={run} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} />
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
    </div>
  )
}

/** The reviewer's gates in the timeline: start the review (from the plan), check the findings (before the draft). */
const GATES = new Set(['start', 'check'])
const GATE_BUTTON: Record<string, { label: string; icon: string; tip: string }> = {
  start: { label: 'Start AI review', icon: 'sparkle', tip: 'Review the parts as planned. It runs on its own until the findings are for you to check.' },
  check: { label: 'Write new draft and email', icon: 'mail', tip: 'Write the new draft and the email to them, from the review as it now stands' }
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
function Gate({ step, session, onChange, disabled }: { step: PipelineStep; session: ReviewSession; onChange: (s: ReviewSession) => void; disabled?: boolean }) {
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
          <div className="tl-gate-act">
            {passed ? (
              <span className="tl-gate-passed">
                <Icon name="check" size={13} stroke={2.4} /> {step.by ? `${step.id === 'start' ? 'Started' : 'Checked'} by ${step.by} · ${when(step.endedAt)}` : 'Passed'}
              </span>
            ) : (
              <button className={`btn sm ${waiting ? 'primary' : ''}`} disabled={!waiting || busy || disabled} onClick={() => act(window.api.pipeline.continue(session.id))} title={b?.tip}>
                {busy ? <span className="spinner sm" /> : <Icon name={b?.icon ?? 'next'} size={14} />} {b?.label}
              </button>
            )}
          </div>
          {error && <p className="dr-small dr-err">{error}</p>}
        </div>
      </div>
    </li>
  )
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
