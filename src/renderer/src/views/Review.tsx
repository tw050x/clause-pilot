import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReviewSession, SecurityAlert } from '@shared/types'
import { clauseLabel, summarise, triage, type Visual } from '@shared/derive'
import { Chevron, Icon } from '../lib/icons'
import { ReviewGrid, type ReviewGridHandle, type RightMode } from '../components/ReviewGrid'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'

interface Props {
  session: ReviewSession
  /** Right sidebar element the review controls are rendered into. */
  panel: HTMLElement | null
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  /** The security alert for this review, if text addressed to an AI reviewer was found. */
  alert: SecurityAlert | null
  onOpenSecurity: () => void
  accountName?: string
  contractTitle?: string
  onOpenReview: (id: string) => void
}

const STATUSES: { key: Visual; label: string }[] = [
  { key: 'processing', label: 'Analysing' },
  { key: 'exact', label: 'Exact match' },
  { key: 'intent', label: 'AI match: confirm' },
  { key: 'review', label: 'Needs review' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' }
]

export function Review({ session, panel, onChange, onNominationsChanged, alert, onOpenSecurity, accountName, contractTitle, onOpenReview }: Props) {
  const [mode, setMode] = useState<RightMode>('issues')
  const [selected, setSelected] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [redlineOpen, setRedlineOpen] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const grid = useRef<ReviewGridHandle>(null)

  useEffect(() => {
    setMode('issues')
    setSelected(null)
    setExported(null)
  }, [session.id])

  const counts = summarise(session)
  const steps = useMemo(() => {
    const all = [...Object.values(session.match), session.overrides, ...Object.values(session.playbook).filter((p) => p.status !== 'skipped')]
    return { done: all.filter((s) => s.status === 'done' || s.status === 'error').length, total: all.length }
  }, [session])
  const running = steps.done < steps.total

  const jump = (id: string | undefined) => {
    if (id) grid.current?.openClause(id)
  }

  // Next undecided issue in triage order (must-change first), after the current one.
  const nextAttention = () => {
    const list = triage(session)
      .filter((i) => (i.tier === 'must' || i.tier === 'decide') && i.clauseId)
      .map((i) => i.clauseId!)
    if (!list.length) return setMode('issues')
    const at = selected ? list.indexOf(selected) : -1
    jump(list[(at + 1) % list.length])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === 'n') nextAttention()
      if (e.key === 'Escape') setMode('issues')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const positions = Object.entries(session.playbook).filter(([, p]) => p.status !== 'skipped')
  const injected = Object.keys(session.injection)
  const decided = Object.keys(session.decisions).length
  const rejected = Object.values(session.decisions).filter((d) => d.decision === 'rejected').length
  const label = (id: string) => clauseLabel(session.clauses.find((c) => c.id === id)!)
  const ov = session.overrides
  const ovPending = ov.status === 'running' || ov.status === 'idle'

  const sidebar = (
    <div className="rp">
      <section className="rp-section">
        <div className="rp-doc">
          <Icon name="doc" size={18} />
          <div style={{ minWidth: 0 }}>
            {session.version ? (
              <>
                <div className="rp-docname">
                  {accountName} · {contractTitle}
                </div>
                <div className="rp-version">
                  Version {session.version}
                  {session.previous && (
                    <>
                      {' '}
                      · compared with{' '}
                      <button className="link" onClick={() => onOpenReview(session.previous!.sessionId)}>
                        version {session.previous.version}
                      </button>
                    </>
                  )}
                </div>
                <div className="faint" style={{ fontSize: 12, wordBreak: 'break-word' }}>
                  {session.docName}
                </div>
              </>
            ) : (
              <div className="rp-docname">{session.docName}</div>
            )}
            <div className="row-gap" style={{ marginTop: 4 }}>
              <span className="pill neutral">{session.contractType === 'nda' ? 'NDA' : session.contractType === 'order-form' ? 'Order form' : 'Contract'}</span>
              <span className="pill neutral">{session.sourceType.toUpperCase()}</span>
              {session.mode === 'demo' && <span className="pill processing">demo</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="rp-section">
        <h4 className="rp-h">
          Progress
          <span className="faint">
            {counts.total} clauses · {decided} decided
          </span>
        </h4>
        {running && (
          <div className="progress" title={`${steps.done} of ${steps.total} checks complete`} style={{ marginBottom: 10 }}>
            <div style={{ width: `${(steps.done / Math.max(steps.total, 1)) * 100}%` }} />
          </div>
        )}
        <div className="rp-statuses">
          {STATUSES.filter((s) => counts[s.key] > 0).map((s) => (
            <div key={s.key} className="rp-status">
              <span className="dot" style={{ background: `var(--${s.key === 'intent' ? 'review' : s.key})` }} />
              <span>{s.label}</span>
              <strong>{counts[s.key]}</strong>
            </div>
          ))}
        </div>
        {!running && counts.total > 0 && (
          <p className="faint" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
            {Math.round(((counts.exact + counts.intent + counts.accepted) / counts.total) * 100)}% of clauses needed no reading.
          </p>
        )}
      </section>

      <section className="rp-section rp-actions">
        <button className="btn" onClick={nextAttention} title="Jump to the next clause that needs a human">
          <Icon name="next" /> Next issue <span className="kbd" style={{ marginLeft: 'auto' }}>N</span>
        </button>
        <button
          className="btn primary"
          onClick={() => setEmailOpen(true)}
          disabled={running || alert?.status === 'open'}
          title={alert?.status === 'open' ? 'On security hold: nothing goes back to the counterparty until the security team has reviewed it' : undefined}
        >
          <Icon name="mail" /> Draft response{rejected ? ` (${rejected})` : ''}
        </button>
        <button
          className="btn"
          onClick={() => setRedlineOpen(true)}
          disabled={running || alert?.status === 'open'}
          title={alert?.status === 'open' ? 'On security hold: nothing goes back to the counterparty until the security team has reviewed it' : 'Their contract with our changes as tracked changes and our reasons as comments'}
        >
          <Icon name="doc" /> Marked-up copy (.docx)
        </button>
        <button
          className="btn"
          onClick={async () => {
            const p = await window.api.audit.export(session.id)
            if (p) setExported(p)
          }}
        >
          <Icon name="shield" /> Export review record
        </button>
        {exported && <p className="faint" style={{ margin: 0, fontSize: 12, wordBreak: 'break-all' }}>Exported to {exported}</p>}
      </section>

      {alert && (
        <section className="rp-section">
          <div className={`security-panel s-${alert.status}`}>
            <div className="security-panel-head">
              <Icon name="shield" />
              <strong>{alert.status === 'open' ? 'Security hold' : alert.status === 'malicious' ? 'Injection attempt confirmed' : 'Security hold released'}</strong>
            </div>
            <p>
              Text addressed to an AI reviewer was found in{' '}
              {alert.clauses.map((c, i) => (
                <span key={c.clauseId}>
                  {i > 0 && ', '}
                  <button className="link" onClick={() => jump(c.clauseId)}>
                    {c.label}
                  </button>
                </span>
              ))}
              . It was caught by a local check before any AI saw the contract.
            </p>
            {alert.status === 'open' && (
              <p>
                <b>The security team has been alerted.</b> Flagged clauses can’t be accepted and no response can be drafted until they’ve reviewed it.
              </p>
            )}
            {alert.status === 'malicious' && (
              <p>
                Confirmed by {alert.resolvedBy}
                {alert.note ? `: “${alert.note}”` : '.'} Reject the flagged clause and raise it with the counterparty.
              </p>
            )}
            {alert.status === 'false-positive' && (
              <p>
                Released by {alert.resolvedBy}: “{alert.note}”. The review can continue normally.
              </p>
            )}
            <button className="btn sm" onClick={onOpenSecurity}>
              {alert.status === 'open' ? 'View alert' : 'View in Security'} <Chevron />
            </button>
          </div>
        </section>
      )}

      <section className="rp-section">
        <h4 className="rp-h">Whole-contract checks</h4>
        <ul className="rp-checks">
          <li
            className={ovPending ? '' : ov.data?.length ? 'bad' : ov.status === 'error' ? 'warn' : 'good'}
            onClick={() => jump(ov.data?.[0]?.overridingClauseId)}
            title={ov.error ?? ov.reason}
          >
            {ovPending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name={ov.data?.length ? 'alert' : 'check'} size={14} />}
            <span>Clause overrides</span>
            {!!ov.data?.length && <span className="rp-count">{ov.data.length}</span>}
          </li>
          {positions.map(([id, p]) => {
            const f = p.data
            const cls = !f ? (p.status === 'error' ? 'warn' : '') : f.status === 'compliant' || f.status === 'not-applicable' ? 'good' : f.withinFallback || f.severity === 'low' ? 'warn' : 'bad'
            return (
              <li key={id} className={cls} onClick={() => jump(f?.clauseIds[0])} title={f ? `${f.status}${f.deviation ? ': ' + f.deviation : ''}` : p.error ?? p.reason}>
                {p.status === 'running' || p.status === 'idle' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name={cls === 'good' ? 'check' : 'alert'} size={14} />}
                <span>{f?.positionTitle ?? id.replace('pb-', '').replace(/-/g, ' ')}</span>
                {f?.status === 'missing' && <span className="rp-count">missing</span>}
                {f?.withinFallback && f.status === 'deviation' && <span className="rp-count">fallback</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )

  return (
    <>
      <ReviewGrid
        ref={grid}
        session={session}
        selected={selected}
        mode={mode}
        onSelect={setSelected}
        onMode={setMode}
        onChange={onChange}
        onNominationsChanged={onNominationsChanged}
        alert={alert}
      />
      {panel && createPortal(sidebar, panel)}
      {emailOpen && <EmailModal session={session} onClose={() => setEmailOpen(false)} onMarkup={() => setRedlineOpen(true)} />}
      {redlineOpen && <RedlineModal session={session} onClose={() => setRedlineOpen(false)} />}
    </>
  )
}
