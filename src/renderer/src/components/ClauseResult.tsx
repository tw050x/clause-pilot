import { useState } from 'react'
import type { Clause, DiffToken, ReviewSession, SecurityAlert } from '@shared/types'
import { Highlighted } from './Highlighted'
import { clauseLabel, isCleared, type ClauseFlags, type Visual } from '@shared/derive'
import { Icon } from '../lib/icons'

interface Props {
  session: ReviewSession
  clause: Clause
  flags: ClauseFlags
  visual: Visual
  onJump: (clauseId: string) => void
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  alert: SecurityAlert | null
}

const TITLES: Record<Visual, string> = {
  processing: 'Analysing',
  exact: 'Exact match: pre-approved',
  intent: 'Same meaning as approved wording (AI): please confirm',
  review: 'Needs human review',
  conflict: 'Conflict found',
  accepted: 'Accepted',
  rejected: 'Rejected'
}

const ICONS: Record<Visual, string> = {
  processing: '',
  exact: 'check',
  intent: 'scales',
  review: 'scales',
  conflict: 'alert',
  accepted: 'check',
  rejected: 'x'
}

export function ClauseResult({ session, clause, flags, visual, onJump, onChange, onNominationsChanged, alert }: Props) {
  const match = session.match[clause.id]
  const prec = session.precedents[clause.id]
  const m = match?.data
  const label = (id: string) => clauseLabel(session.clauses.find((c) => c.id === id)!)
  const reason = match?.status === 'running' ? match.reason : prec?.status === 'running' ? prec.reason : match?.reason

  return (
    <>
      <div className="result-head">
        {visual === 'processing' ? <span className="spinner" /> : <Icon name={ICONS[visual]} />}
        <span>{TITLES[visual]}</span>
        <span className="clause-tag">{clauseLabel(clause)}</span>
      </div>
      {reason && visual !== 'accepted' && visual !== 'rejected' && (
        <div className="result-section" style={{ borderTop: 'none', paddingTop: 0, paddingBottom: 8 }}>
          <span className="why muted">{reason}</span>
          {visual === 'processing' && (
            <>
              <div className="skeleton" style={{ width: '90%' }} />
              <div className="skeleton" style={{ width: '70%' }} />
            </>
          )}
        </div>
      )}

      {flags.docChecksPending && !flags.decision && (
        <div className="result-section">
          <h4>
            <span className="spinner" style={{ width: 11, height: 11, color: 'var(--processing)' }} /> Checking the whole contract
          </h4>
          <p className="faint" style={{ fontSize: 12.5 }}>Looking for clauses that override this one and checking it against our playbook…</p>
          <div className="skeleton-block">
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '92%' }} />
            <div className="skeleton" style={{ width: '78%' }} />
          </div>
        </div>
      )}

      {flags.injection.length > 0 && (
        <div className={`security-banner s-${alert?.status ?? 'open'}`}>
          <div className="security-panel-head">
            <Icon name="shield" />
            <strong>
              {alert?.status === 'malicious' ? 'Confirmed prompt-injection attempt' : alert?.status === 'false-positive' ? 'Security hold released (false positive)' : 'Security hold: possible prompt injection'}
            </strong>
          </div>
          <p>This clause contains text addressed to an AI reviewer rather than to us:</p>
          <div className="quote" style={{ color: 'var(--text)' }}>
            <Highlighted text={clause.text} />
          </div>
          <p className="faint" style={{ fontSize: 12.5 }}>
            Detected by a local check before any AI saw the contract ({flags.injection.join(', ')}). The AI was told to treat contract text as data and ignore instructions in it, and this
            clause is never accepted automatically.
          </p>
          <p style={{ marginBottom: 0 }}>
            {alert?.status === 'malicious'
              ? `Confirmed by the security team (${alert.resolvedBy}). It can only be rejected.`
              : alert?.status === 'false-positive'
                ? `Released by ${alert.resolvedBy}: “${alert.note}”. Decide on it as normal.`
                : 'The security team has been alerted. It can’t be accepted until they’ve reviewed it.'}
          </p>
        </div>
      )}

      {(flags.overriding.length > 0 || flags.overriddenBy.length > 0) && (
        <div className="result-section">
          <h4>
            <Icon name="link" size={13} /> Overrides
          </h4>
          {flags.overriding.map((o) => (
            <div key={o.id} className={`finding ${o.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${o.severity}`}>{o.severity}</span>
                <strong>Overrides</strong>
                {o.overriddenClauseIds.map((id) => (
                  <button key={id} className="link" onClick={() => onJump(id)}>
                    {label(id)}
                  </button>
                ))}
              </div>
              <p>{o.summary}</p>
              <p className="muted">{o.effect}</p>
              <div className="quote">"{o.quote}"</div>
            </div>
          ))}
          {flags.overriddenBy.map((o) => (
            <div key={o.id} className={`finding ${o.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${o.severity}`}>{o.severity}</span>
                <strong>Overridden by</strong>
                <button className="link" onClick={() => onJump(o.overridingClauseId)}>
                  {label(o.overridingClauseId)}
                </button>
              </div>
              <p>
                {m?.kind === 'exact' || m?.kind === 'intent'
                  ? 'This clause matches our standard wording, but another clause changes what it does. '
                  : ''}
                {o.summary}
              </p>
            </div>
          ))}
        </div>
      )}

      {flags.playbook.length > 0 && (
        <div className="result-section">
          <h4>
            <Icon name="book" size={13} /> Standard positions
          </h4>
          {flags.playbook.map((p) => (
            <div key={p.positionId} className={`finding ${p.withinFallback ? 'low' : p.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${p.withinFallback ? 'low' : p.severity}`}>{p.withinFallback ? 'within fallback' : p.severity}</span>
                <strong>{p.positionTitle}</strong>
              </div>
              <p>{p.deviation}</p>
              {p.suggestedRedline && (
                <details>
                  <summary>Suggested redline</summary>
                  <div className="quote">{p.suggestedRedline}</div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {m && m.kind !== 'exact' && clause.number && <MatchDetail session={session} clauseId={clause.id} />}

      {prec && (prec.status === 'done' || prec.status === 'running') && (
        <div className="result-section">
          <h4>
            <Icon name="history" size={13} /> Precedents
          </h4>
          {prec.status === 'running' && <div className="skeleton" />}
          {prec.data?.length === 0 && <p className="faint">No precedents for similar wording.</p>}
          {prec.data?.map((p) => (
            <div key={p.id} className="precedent">
              <div className="meta">
                <span className={`pill ${p.outcome}`}>{p.outcome}</span>
                <strong style={{ color: 'var(--text)' }}>{p.counterparty}</strong>
                <span>{p.date}</span>
                <span>· {p.category}</span>
                <span className="faint" style={{ marginLeft: 'auto' }} title={`Matched on: ${p.terms.join(', ')}`}>
                  relevance {Math.round(p.score * 100)}%
                </span>
              </div>
              <div className="note">{p.notes}</div>
              <details>
                <summary>Their wording</summary>
                <div className="txt" style={{ marginTop: 4 }}>
                  {p.text}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}

      <DecisionPanel
        session={session}
        clause={clause}
        flags={flags}
        onChange={onChange}
        onNominationsChanged={onNominationsChanged}
        acceptBlocked={flags.injection.length > 0 && alert?.status !== 'false-positive'}
      />
    </>
  )
}

function MatchDetail({ session, clauseId }: { session: ReviewSession; clauseId: string }) {
  const m = session.match[clauseId].data!
  const v = m.verdict
  const best = m.candidates.find((c) => c.libraryId === (m.libraryId ?? v?.bestMatchId)) ?? m.candidates[0]
  if (!best) {
    return (
      <div className="result-section">
        <h4>
          <Icon name="book" size={13} /> Library match
        </h4>
        <p className="faint">Nothing in the pre-approved library resembles this clause. This is new drafting.</p>
      </div>
    )
  }
  return (
    <div className="result-section">
      <h4>
        <Icon name="book" size={13} /> Library match
      </h4>
      <div className="row-gap" style={{ marginBottom: 6 }}>
        <span>
          Closest approved clause: <strong>{best.title}</strong>
        </span>
        <span className="pill neutral">{Math.round(best.score * 100)}% lexical</span>
        {v && <span className={`pill ${m.kind === 'intent' ? 'intent' : 'review'}`}>{m.kind === 'intent' ? 'same intent' : 'different effect'}</span>}
      </div>
      {v && (
        <>
          <p>{v.reasoning}</p>
          {v.materialDifferences.length > 0 && (
            <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
              {v.materialDifferences.map((d, i) => (
                <li key={i}>
                  {d.description}{' '}
                  <span className={`pill ${d.favours === 'counterparty' ? 'high' : d.favours === 'us' ? 'accepted' : 'neutral'}`}>
                    {d.favours === 'us' ? 'favours us' : d.favours === 'counterparty' ? 'favours them' : 'neutral'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {m.gateNote && (
            <p className="faint" style={{ fontSize: 12 }}>
              Gate: {m.gateNote} · AI confidence {v.confidence}
            </p>
          )}
        </>
      )}
      {session.match[clauseId].error && <p className="faint">AI unavailable: {session.match[clauseId].error}</p>}
      <details open>
        <summary>Changes from approved wording</summary>
        <div className="diff" style={{ marginTop: 6 }}>
          <Diff tokens={best.diff} />
        </div>
      </details>
    </div>
  )
}

function Diff({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {t.op === 'same' ? t.text : t.op === 'add' ? <ins>{t.text}</ins> : <del>{t.text}</del>}
        </span>
      ))}
    </>
  )
}

function DecisionPanel({
  session,
  clause,
  flags,
  onChange,
  onNominationsChanged,
  acceptBlocked
}: {
  session: ReviewSession
  clause: Clause
  flags: ClauseFlags
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  acceptBlocked: boolean
}) {
  const [mode, setMode] = useState<'accepted' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [redline, setRedline] = useState('')
  const [nominate, setNominate] = useState(false)
  const d = flags.decision
  const suggested = flags.playbook.find((p) => p.suggestedRedline)?.suggestedRedline ?? ''
  const cleared = isCleared(flags)
  const exact = flags.match === 'exact'

  if (d) {
    return (
      <div className="decision">
        <div className="row-gap">
          <span className={`pill ${d.decision}`}>{d.decision}</span>
          <span className="who">
            by {d.by} · {new Date(d.at).toLocaleString()}
            {d.nominate && ' · nominated for library'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm ghost"
            onClick={async () => {
              onChange(await window.api.review.undo(session.id, clause.id))
              onNominationsChanged()
            }}
          >
            Undo
          </button>
        </div>
        {d.note && <div style={{ fontSize: 13 }}>{d.note}</div>}
        {d.redline && <div className="quote">{d.redline}</div>}
      </div>
    )
  }

  if (flags.processing) return null

  // Green: pre-approved wording with nothing else touching it. Accepted by default;
  // the only action offered is the exception.
  if (cleared && mode !== 'rejected') {
    return (
      <div className="decision">
        <div className="row-gap">
          <span className="pill accepted">accepted</span>
          <span className="who">Pre-approved wording. No action needed.</span>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm reject"
            onClick={() => {
              setRedline(suggested)
              setMode('rejected')
            }}
          >
            <Icon name="x" size={13} /> Reject
          </button>
        </div>
      </div>
    )
  }

  const submit = async (decision: 'accepted' | 'rejected') => {
    onChange(await window.api.review.decide(session.id, { clauseId: clause.id, decision, note, redline: decision === 'rejected' ? redline : '', nominate: decision === 'accepted' && nominate }))
    if (nominate) onNominationsChanged()
    setMode(null)
  }

  return (
    <div className="decision">
      {!mode && (
        <div className="row-gap">
          <button
            className="btn sm accept"
            onClick={() => setMode('accepted')}
            disabled={acceptBlocked}
            title={acceptBlocked ? 'On security hold: only the security team can release this clause' : undefined}
          >
            <Icon name="check" size={13} /> Accept
          </button>
          <button
            className="btn sm reject"
            onClick={() => {
              setRedline(suggested)
              setMode('rejected')
            }}
          >
            <Icon name="x" size={13} /> Reject
          </button>
        </div>
      )}
      {mode && (
        <>
          <textarea
            rows={2}
            autoFocus
            placeholder={mode === 'accepted' ? 'Why is this acceptable? (becomes a precedent)' : 'Reason (shared with the counterparty in the email)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {mode === 'rejected' && (
            <textarea rows={3} placeholder="Our proposed wording (optional)" value={redline} onChange={(e) => setRedline(e.target.value)} />
          )}
          {mode === 'accepted' && !exact && (
            <label className="row-gap" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={nominate} onChange={(e) => setNominate(e.target.checked)} /> Nominate this wording for the pre-approved library
            </label>
          )}
          <div className="row-gap">
            <button className={`btn sm ${mode === 'accepted' ? 'accept on' : 'reject on'}`} onClick={() => submit(mode)}>
              Confirm {mode === 'accepted' ? 'accept' : 'reject'}
            </button>
            <button className="btn sm ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
