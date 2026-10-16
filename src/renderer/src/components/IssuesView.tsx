import type { ReviewSession, SecurityAlert } from '@shared/types'
import { analysisComplete, clauseLabel, triage, type Issue, type Tier } from '@shared/derive'
import { Icon } from '../lib/icons'

const GROUPS: { tier: Tier; title: string; hint: string }[] = [
  { tier: 'must', title: 'Must change', hint: 'Blockers. Any one of these means the contract goes back, so raise them first.' },
  { tier: 'decide', title: 'Needs a decision', hint: 'Not word for word our standard, but may be acceptable. AI same-meaning matches are here too: confirm them.' },
  { tier: 'pending', title: 'Still analysing', hint: '' }
]

/** Default right-hand view: what has been covered and what hasn't, worst first. */
export function IssuesView({
  session,
  onOpen,
  alert
}: {
  session: ReviewSession
  onOpen: (clauseId: string) => void
  alert: SecurityAlert | null
}) {
  const progress = analysisComplete(session)
  // Until every check is in, the ranking isn't final: show placeholders rather than a list that reshuffles.
  if (!progress.complete) return <IssuesLoading done={progress.done} total={progress.total} />

  const issues = triage(session)
  const cleared = issues.filter((i) => i.tier === 'cleared')
  const decided = issues.filter((i) => i.tier === 'decided')
  const affected = issues.filter((i) => i.tier === 'affected')
  const label = (i: Issue) => (i.clauseId ? clauseLabel(session.clauses.find((c) => c.id === i.clauseId)!) : 'Whole contract')

  return (
    <div className="issues">
      {alert?.status === 'open' && (
        <div className="security-banner s-open" style={{ marginBottom: 14 }}>
          <div className="security-panel-head">
            <Icon name="shield" />
            <strong>On security hold</strong>
          </div>
          <p style={{ marginBottom: 0 }}>
            Possible prompt injection in {alert.clauses.map((c) => c.label).join(', ')}. The security team has been alerted; you can keep reviewing, but nothing goes back to the counterparty
            until they’ve looked at it.
          </p>
        </div>
      )}
      <div className="issues-summary">
        {(['must', 'decide', 'cleared', 'decided'] as Tier[]).map((t) => {
          const n = issues.filter((i) => i.tier === t).length
          return (
            <div key={t} className={`issues-stat t-${t}`}>
              <strong>{n}</strong>
              <span>{{ must: 'must change', decide: 'to decide', cleared: 'pre-approved', decided: 'decided', pending: '', affected: '' }[t]}</span>
            </div>
          )
        })}
      </div>

      {GROUPS.map((g) => {
        const list = issues.filter((i) => i.tier === g.tier)
        if (!list.length) return null
        return (
          <section key={g.tier} className="issues-group">
            <h3 className={`t-${g.tier}`}>
              {g.title} <span className="faint">{list.length}</span>
            </h3>
            {g.hint && <p className="faint issues-hint">{g.hint}</p>}
            {list.map((i, k) => (
              <button key={k} className={`issue sev-${i.severity}`} disabled={!i.clauseId} onClick={() => i.clauseId && onOpen(i.clauseId)}>
                <span className="issue-where">{label(i)}</span>
                <span className="issue-title">
                  {i.title}
                  {i.more > 0 && <span className="faint"> +{i.more} more</span>}
                </span>
                {i.detail && <span className="issue-detail">{i.detail}</span>}
                <span className={`pill ${i.severity === 'critical' || i.severity === 'high' ? 'high' : i.severity === 'medium' ? 'medium' : 'low'}`}>
                  {i.tier === 'pending' ? 'analysing' : i.severity}
                </span>
              </button>
            ))}
          </section>
        )
      })}

      {affected.length > 0 && (
        <section className="issues-group">
          <h3>
            Affected <span className="faint">{affected.length}</span>
          </h3>
          <p className="faint issues-hint">Standard wording changed by another clause above. These clear when that clause is fixed.</p>
          <div className="affected">
            {affected.map((i) => (
              <button key={i.clauseId} className="link-btn" onClick={() => onOpen(i.clauseId!)} title={i.title}>
                {label(i)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="issues-group">
        <h3 className="t-cleared">
          Pre-approved <span className="faint">{cleared.length}</span>
        </h3>
        <p className="faint issues-hint">Accepted automatically: word for word our approved wording, with nothing else touching it. Nothing to do unless you want to reject one.</p>
      </section>

      {decided.length > 0 && (
        <section className="issues-group">
          <h3>
            Decided <span className="faint">{decided.length}</span>
          </h3>
          {decided
            .filter((i) => i.title === 'Rejected')
            .map((i, k) => (
              <button key={k} className="issue sev-low" onClick={() => onOpen(i.clauseId!)}>
                <span className="issue-where">{label(i)}</span>
                <span className="issue-title">Rejected</span>
                {i.detail && <span className="issue-detail">{i.detail}</span>}
                <span className="pill rejected">rejected</span>
              </button>
            ))}
          <p className="faint issues-hint">{decided.filter((i) => i.title === 'Accepted').length} accepted.</p>
        </section>
      )}
    </div>
  )
}

function IssuesLoading({ done, total }: { done: number; total: number }) {
  return (
    <div className="issues" aria-busy="true">
      <div className="issues-loading">
        <span className="spinner" style={{ color: 'var(--processing)' }} />
        <span>
          Checking the contract… <span className="faint">{done} of {total} checks complete</span>
        </span>
      </div>
      <div className="progress" style={{ margin: '8px 0 16px' }}>
        <div style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
      </div>
      <div className="issues-summary">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="issues-stat">
            <div className="skeleton" style={{ width: 28, height: 20 }} />
            <div className="skeleton" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 10 }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="issue skeleton-issue">
          <div className="skeleton" style={{ width: 70 }} />
          <div className="skeleton" style={{ width: '55%', height: 12 }} />
          <div className="skeleton" style={{ width: '90%' }} />
        </div>
      ))}
    </div>
  )
}
