import { useEffect, useState } from 'react'
import type { PipelineRun, PipelineStep, ReviewSession } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * The automated review, as a timeline in the review column: Start review (with its budget), then
 * each step as it runs. Top-level steps run in order; a step's sub-items (a part's checks) are
 * indented under it, in their own order. What each step used is shown beside it, and the run's
 * total against its budget at the top.
 */
export function Timeline({ session, onChange, onJump }: { session: ReviewSession; onChange: (s: ReviewSession) => void; onJump: (blockId: string) => void }) {
  const run = session.doc?.pipeline
  const [defaults, setDefaults] = useState<Awaited<ReturnType<typeof window.api.pipeline.defaults>> | null>(null)
  const [budget, setBudget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.pipeline.defaults().then((x) => {
      setDefaults(x)
      setBudget(String(x.provider === 'anthropic' ? x.budget.usd : Math.round(x.budget.tokens / 1000)))
    })
  }, [session.id])
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
  const start = () => {
    if (!defaults) return
    const n = Number(budget)
    if (!(n > 0)) return setError('Set a budget above zero.')
    void act(window.api.pipeline.start(session.id, defaults.provider === 'anthropic' ? { usd: n, tokens: defaults.budget.tokens } : { tokens: n * 1000 }))
  }
  const running = run?.status === 'running'
  const claude = defaults?.provider === 'anthropic'

  return (
    <section className="rc-section tl">
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
            <Step key={st.id} step={st} run={run} session={session} onJump={onJump} />
          ))}
        </ol>
      )}

      {!running && defaults && (
        <div className="tl-start">
          <label className="tl-budget" title={claude ? 'The most this run may spend on Claude: it pauses there, keeping what it has done.' : 'The most this run may use: it pauses there, keeping what it has done.'}>
            <span>Budget</span>
            {claude && <span className="faint">$</span>}
            <input type="number" min={1} step={claude ? 1 : 100} value={budget} onChange={(e) => setBudget(e.target.value)} />
            {!claude && <span className="faint">k tokens</span>}
          </label>
          <button className="btn primary" disabled={busy || !defaults.ready} onClick={start} title={defaults.why}>
            <Icon name="sparkle" size={14} /> {run ? 'Start again' : 'Start review'}
          </button>
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

function Step({ step, run, session, onJump }: { step: PipelineStep; run: PipelineRun; session: ReviewSession; onJump: (blockId: string) => void }) {
  const [open, setOpen] = useState(true)
  const part = step.partId ? run.parts?.find((p) => p.id === step.partId) : undefined
  const usage = step.usage && step.usage.input + step.usage.cached + step.usage.output
  return (
    <li className={`tl-step ${step.status}`}>
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
            {step.children && step.children.length > 0 && (
              <button className="link-btn tl-count" onClick={() => setOpen((v) => !v)}>
                {step.children.length} {open ? '▾' : '▸'}
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
        </div>
      </div>
      {open && step.children && step.children.length > 0 && (
        <ol className="tl-steps tl-sub">
          {step.children.map((c) => (
            <Step key={c.id} step={c} run={run} session={session} onJump={onJump} />
          ))}
        </ol>
      )}
    </li>
  )
}
