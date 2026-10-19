import { useEffect, useRef, useState } from 'react'
import type { PipelineRun, PipelineStep, ReviewPart, ReviewSession } from '@shared/types'
import { groupOf, marksFor, segmentsOf, shownText } from '@shared/changes'
import { diffSegments } from '@shared/diff'
import { Icon } from '../lib/icons'
import { Redline } from './Redline'

/**
 * The automated review, as a timeline in the review column: Start review (with its budget), then
 * each step as it runs. Top-level steps run in order; a step's sub-items (a part's checks) are
 * indented under it, in their own order. What each step used is shown beside it, and the run's
 * total against its budget at the top.
 */
export function Timeline({
  session,
  onChange,
  onJump,
  focusBlock,
  onMarkup,
  onEmail
}: {
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  onJump: (blockId: string) => void
  focusBlock?: string | null
  /** Open the marked-up copy, and the email to them. */
  onMarkup: () => void
  onEmail: () => void
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
  const [budget, setBudget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.pipeline.defaults().then((x) => {
      setDefaults(x)
      // A run's own budget, to raise when going on; otherwise the default.
      const b = run?.budget ?? x.budget
      setBudget(String(x.provider === 'anthropic' ? (b.usd ?? x.budget.usd) : Math.round(b.tokens / 1000)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])
  const [questions, setQuestions] = useState<{ id: string; title: string }[]>([])
  useEffect(() => void window.api.questions.list().then((q) => setQuestions(q.map((x) => ({ id: x.id, title: x.title })))), [])
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
  const budgetOf = () => {
    const n = Number(budget)
    if (!defaults || !(n > 0)) return null
    return defaults.provider === 'anthropic' ? { usd: n, tokens: defaults.budget.tokens } : { tokens: n * 1000 }
  }
  const start = () => {
    const b = budgetOf()
    if (!b) return setError('Set a budget above zero.')
    void act(window.api.pipeline.start(session.id, b))
  }
  const goOn = () => {
    const b = budgetOf()
    if (!b) return setError('Set a budget above zero.')
    void act(window.api.pipeline.continue(session.id, b))
  }
  const resumable = run && (run.status === 'paused' || run.status === 'error' || run.status === 'stopped')
  const running = run?.status === 'running'
  const claude = defaults?.provider === 'anthropic'

  return (
    <section className="rc-section tl" ref={box}>
      <div className="tl-head">
        <div className="dr-mini-h">AI review</div>
        {run && <RunStatus run={run} />}
      </div>
      {!run && (
        <p className="faint dr-small tl-intro">
          The AI reads the contract’s structure, checks each part as closely as it needs (skipping the parts with nothing to check), brings what it finds together, and asks you to approve each change before writing the new draft and email.
        </p>
      )}
      {run && <Spent run={run} />}
      {run?.note && <p className={`dr-small tl-note ${run.status}`}>{run.note}</p>}

      {run && (
        <ol className="tl-steps">
          {run.steps.map((st) => (
            <Step key={st.id} step={st} run={run} session={session} onJump={onJump} onChange={onChange} focusPart={focusPart} />
          ))}
        </ol>
      )}

      {run?.status === 'done' && run.steps.some((x) => x.id === 'draft' && x.status === 'done') && (
        <div className="tl-done">
          <button className="btn" onClick={onMarkup}>
            <Icon name="doc" size={14} /> Open marked-up copy
          </button>
          <button className="btn primary" onClick={onEmail}>
            <Icon name="mail" size={14} /> Open the email
          </button>
        </div>
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

      {!running && defaults && (
        <div className="tl-start">
          <label className="tl-budget" title={claude ? 'The most this run may spend on Claude: it pauses there, keeping what it has done.' : 'The most this run may use: it pauses there, keeping what it has done.'}>
            <span>Budget</span>
            {claude && <span className="faint">$</span>}
            <input type="number" min={1} step={claude ? 1 : 100} value={budget} onChange={(e) => setBudget(e.target.value)} />
            {!claude && <span className="faint">k tokens</span>}
          </label>
          {resumable ? (
            <div className="row-gap">
              <button className="btn sm ghost" disabled={busy || !defaults.ready} onClick={start} title="Start over: the structure is read again and every part reviewed again">
                Start again
              </button>
              <button className="btn primary" disabled={busy || !defaults.ready} onClick={goOn} title="Go on from where it stopped, with this budget">
                Continue
              </button>
            </div>
          ) : (
            <button className="btn primary" disabled={busy || !defaults.ready} onClick={start} title={defaults.why}>
              <Icon name="sparkle" size={14} /> {run ? 'Start again' : 'Start review'}
            </button>
          )}
        </div>
      )}
      {running && (
        <div className="tl-start">
          <button className="btn" disabled={busy} onClick={() => act(window.api.pipeline.stop(session.id))}>
            Stop
          </button>
        </div>
      )}
      {defaults && !defaults.ready && <p className="dr-small dr-err">{defaults.why}</p>}
      {error && <p className="dr-small dr-err">{error}</p>}
      {defaults && (
        <p className="faint dr-small tl-model">
          {claude ? 'Claude' : 'vLLM'} · {defaults.model}
        </p>
      )}
    </section>
  )
}

function RunStatus({ run }: { run: PipelineRun }) {
  const label = { running: 'Running', paused: 'Paused', stopped: 'Stopped', done: 'Done', error: 'Failed' }[run.status]
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
        {run.estimate && run.status !== 'done' && ` · next: about ${run.estimate.calls} calls, ${k(run.estimate.tokens)} tokens${run.estimate.usd !== undefined ? `, $${run.estimate.usd.toFixed(2)}` : ''}`}
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
  // Under "Your approval": the part's proposal, to decide.
  const proposal = part?.proposal && /^approve(-\d+)?:/.test(step.id) && part.proposal.status === 'pending' ? part : undefined
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
          {step.detail && !proposal && <div className="tl-detail faint">{step.detail}</div>}
          {step.error && <div className="tl-detail dr-err">{step.error}</div>}
          {proposal && <ProposalCard part={proposal} session={session} onChange={onChange} onJump={onJump} />}
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
 * A part's proposal, to decide: what it does and why, the new wording as a redline against how the
 * paragraph now reads, their changes to accept or reject, and a comment to them. Approve applies
 * it all as the reviewer's tracked edits and decisions, as one action (undone together); Reject
 * drops it; Ask for changes sends it back with what they want.
 */
function ProposalCard({ part, session, onChange, onJump }: { part: ReviewPart; session: ReviewSession; onChange: (s: ReviewSession) => void; onJump: (blockId: string) => void }) {
  const p = part.proposal!
  const d = session.doc!
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const block = (id: string) => d.blocks.find((b) => b.id === id)
  const label = (id: string) => block(id)?.label ?? ''
  const run = async (fn: () => Promise<ReviewSession>) => {
    setBusy(true)
    setError(null)
    try {
      onChange(await fn())
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const approve = () =>
    run(async () => {
      const group = `ai:${p.id}`
      let s = session
      // Their changes first, then the new wording over them, then the comment: one action.
      for (const x of p.decisions) {
        const b = block(x.blockId)
        if (!b) continue
        for (const seg of groupOf(b, x.seg).length ? groupOf(b, x.seg) : [x.seg]) s = await window.api.doc.resolve(session.id, x.blockId, seg, x.outcome, group)
      }
      for (const w of p.wording) s = await window.api.doc.edit(session.id, w.blockId, w.text, group)
      if (p.comment) s = await window.api.doc.comment(session.id, { blockId: p.comment.blockId, quote: '', text: p.comment.text }, group)
      void s
      return window.api.pipeline.decide(session.id, part.id, 'approved')
    })
  return (
    <div className="tl-proposal">
      <p className="tl-prop-summary">{p.summary}</p>
      {p.wording.map((w, i) => {
        const b = block(w.blockId)
        const now = b ? shownText(marksFor(d, b)) : ''
        return (
          <div key={i} className="tl-prop-item rl-ours">
            <button className="link-btn tl-prop-where" onClick={() => onJump(w.blockId)}>
              {label(w.blockId) ? `§${label(w.blockId).replace(/\.$/, '')}` : 'Paragraph'}
            </button>{' '}
            <Redline segments={diffSegments(now, w.text)} />
            {w.why && <div className="faint tl-prop-why">{w.why}</div>}
          </div>
        )
      })}
      {p.decisions.map((x, i) => {
        const b = block(x.blockId)
        const seg = b ? segmentsOf(b)[x.seg] : undefined
        return (
          <div key={`d${i}`} className="tl-prop-item">
            <span className={`sel-st ${x.outcome}`}>{x.outcome === 'accepted' ? 'Accept' : 'Reject'}</span> their {seg?.op === 'ins' ? 'insertion' : 'deletion'}
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
      {asking ? (
        <div className="tl-prop-ask">
          <textarea rows={3} value={note} placeholder="What should change?" onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="row-gap">
            <button className="btn sm ghost" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn sm primary" disabled={busy || !note.trim()} onClick={() => run(() => window.api.pipeline.decide(session.id, part.id, 'changes', note))}>
              Send back
            </button>
          </div>
        </div>
      ) : (
        <div className="tl-prop-btns">
          <button className="btn sm ghost" disabled={busy} onClick={() => run(() => window.api.pipeline.decide(session.id, part.id, 'rejected'))}>
            Reject
          </button>
          <button className="btn sm" disabled={busy} onClick={() => setAsking(true)}>
            Ask for changes
          </button>
          <button className="btn sm primary" disabled={busy} onClick={approve}>
            {busy ? <span className="spinner sm" /> : <Icon name="check" size={13} />} Approve
          </button>
        </div>
      )}
      {error && <p className="dr-small dr-err">{error}</p>}
    </div>
  )
}
