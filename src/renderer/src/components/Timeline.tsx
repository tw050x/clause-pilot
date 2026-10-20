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
      <div className="tl-head">
        <div className="dr-mini-h">AI review</div>
        {run && <RunStatus run={run} />}
      </div>
      {!run && (
        <p className="faint dr-small tl-intro">
          Each draft is planned when it’s uploaded. The AI review reads the contract’s structure, checks each part as closely as it needs (skipping the parts with nothing to check), and makes the changes it finds are needed (each can be undone in History). Then it waits for you to check them before writing the new draft and the email.
        </p>
      )}
      {run && <Spent run={run} />}
      {run?.note && <p className={`dr-small tl-note ${run.status}`}>{run.note}</p>}
      <RunControls session={session} onChange={onChange} disabled={onHold} />

      {run && (
        <ol className="tl-steps">
          {run.steps.map((st) => (
            GATES.has(st.id) ? (
              <Gate key={st.id} step={st} session={session} onChange={onChange} disabled={onHold} />
            ) : (
              <Step key={st.id} step={st} run={run} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} />
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

      {defaults && !defaults.ready && <p className="dr-small dr-err">{defaults.why}</p>}
      {defaults && (
        <p className="faint dr-small tl-model">
          {defaults.name} · {defaults.model}
        </p>
      )}
    </section>
  )
}

function RunStatus({ run }: { run: PipelineRun }) {
  const label = { running: run.confirmed ? 'Running' : 'Planning', planned: 'Planned', paused: run.steps.some((x) => x.id === 'check' && x.status === 'needs-you') ? 'Your turn' : 'Paused', stopped: 'Stopped', done: 'Done', error: 'Failed' }[run.status]
  return <span className={`tl-pill ${run.status}`}>{run.status === 'running' && <span className="spinner tl-spin" />}{label}</span>
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function Spent({ run }: { run: PipelineRun }) {
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
        {run.estimate && run.status === 'planned' && ` · the review: about ${run.estimate.calls} calls, ${k(run.estimate.tokens)} tokens${run.estimate.usd !== undefined ? `, $${run.estimate.usd.toFixed(2)}` : ''}`}
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
  // A finished step shows only its items still needing something (for you, failed, running); the
  // rest on request, so what's waiting for the reviewer isn't buried under what's done.
  const done = step.status === 'done' || step.status === 'skipped'
  const [chosen, setChosen] = useState<boolean | null>(null)
  const all = chosen ?? !done
  const kids = step.children ?? []
  const shown = all ? kids : kids.filter((c) => c.status === 'needs-you' || c.status === 'error' || c.status === 'running')
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
              <button className="link-btn tl-count" onClick={() => setChosen(!all)} title={all ? 'Show only what needs something' : 'Show all of them'}>
                {all ? `${kids.length} ▾` : shown.length ? `${shown.length} of ${kids.length} ▸` : `${kids.length} ▸`}
              </button>
            )}
            {usage ? (
              <span className="tl-usage faint">
                {k(usage)} tokens{step.usage?.usd !== undefined ? ` · $${step.usage.usd.toFixed(3)}` : ''}
              </span>
            ) : null}
          </div>
          {step.detail && <div className="tl-detail faint">{step.detail}</div>}
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
  const b = GATE_BUTTON[step.id]
  return (
    <li className={`tl-step tl-gate ${step.status}`}>
      <div className="tl-row">
        <StatusIcon status={waiting ? 'needs-you' : step.status} />
        <div className="tl-body">
          <div className="tl-title">{step.title}</div>
          {step.status === 'done' && step.by ? (
            <div className="tl-detail faint">
              {step.id === 'start' ? 'Started' : 'Checked'} by {step.by} · {when(step.endedAt)}
            </div>
          ) : (
            step.detail && <div className="tl-detail faint">{step.detail}</div>
          )}
          {waiting && b && (
            <div className="tl-gate-act">
              <button className="btn sm primary" disabled={busy || disabled} onClick={() => act(window.api.pipeline.continue(session.id))} title={b.tip}>
                {busy ? <span className="spinner sm" /> : <Icon name={b.icon} size={14} />} {b.label}
              </button>
            </div>
          )}
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
  if (!defaults || session.original) return null
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
    if (atGate || run?.status === 'planned') return null
    if (run?.status === 'running')
      return run.confirmed ? (
        <button className="btn sm" disabled={busy} onClick={() => act(window.api.pipeline.stop(session.id))} title="Stop the AI review: what it has done is kept">
          Stop
        </button>
      ) : null
    if (run && (run.status === 'paused' || run.status === 'error' || run.status === 'stopped'))
      return (
        <button className="btn sm primary" disabled={off} onClick={() => act(window.api.pipeline.continue(session.id, more()))} title={tip}>
          <Icon name="sparkle" size={14} /> Continue AI review
        </button>
      )
    return (
      <button className={`btn sm ${run ? '' : 'primary'}`} disabled={off} onClick={() => act(window.api.pipeline.start(session.id, defaults.budget))} title={run ? 'Plan and review it again from the start' : tip}>
        <Icon name="sparkle" size={14} /> {run ? 'Review again' : 'Start AI review'}
      </button>
    )
  })()
  if (!button && !error) return null
  return (
    <div className="tl-controls">
      {button}
      {error && <span className="dr-small dr-err">{error}</span>}
    </div>
  )
}
