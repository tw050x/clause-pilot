import { useState } from 'react'
import type { SecurityAlert } from '@shared/types'
import { Icon } from '../lib/icons'
import { Highlighted } from '../components/Highlighted'

/**
 * Suspected prompt-injection attempts, for the security team. A review with an
 * open alert is on hold: its flagged clauses can't be accepted and no response
 * can go back to the counterparty until the alert is resolved here.
 */
export function SecurityView({
  alerts,
  canResolve,
  onChange,
  onOpenReview
}: {
  alerts: SecurityAlert[]
  canResolve: boolean
  onChange: (a: SecurityAlert[]) => void
  onOpenReview: (sessionId: string) => void
}) {
  const open = alerts.filter((a) => a.status === 'open')
  const done = alerts.filter((a) => a.status !== 'open').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
  return (
    <div className="page">
      <h1>Security</h1>
      <p className="lede">
        Contract text that appears to be addressed to an AI reviewer rather than to us. It is flagged by a local check before any AI sees the contract, and the review is put on hold until the
        security team has looked at it.
      </p>
      {!canResolve && (
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Icon name="shield" /> You can see alerts, but only the security team can resolve them. (Settings → “I’m on the security team”.)
        </div>
      )}

      <h3 className="approvals-h">
        Open <span className="faint">{open.length}</span>
      </h3>
      {!open.length && <p className="faint">No open alerts.</p>}
      <div style={{ display: 'grid', gap: 12, marginBottom: 28 }}>
        {open.map((a) => (
          <AlertCard key={a.id} a={a} canResolve={canResolve} onChange={onChange} onOpenReview={onOpenReview} />
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h3 className="approvals-h">Resolved</h3>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="t">
              <tbody>
                {done.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => onOpenReview(a.sessionId)}>
                    <td style={{ width: 170 }}>
                      <span className={`pill ${a.status === 'malicious' ? 'high' : 'accepted'}`}>{a.status === 'malicious' ? 'confirmed attempt' : 'false positive'}</span>
                    </td>
                    <td>
                      <strong>{a.docName}</strong> · {a.clauses.map((c) => c.label).join(', ')}
                      {a.note && <div className="muted">{a.note}</div>}
                    </td>
                    <td className="muted" style={{ width: 220 }}>
                      {a.resolvedBy} · {a.resolvedAt && new Date(a.resolvedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function AlertCard({
  a,
  canResolve,
  onChange,
  onOpenReview
}: {
  a: SecurityAlert
  canResolve: boolean
  onChange: (a: SecurityAlert[]) => void
  onOpenReview: (sessionId: string) => void
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resolve = async (outcome: 'malicious' | 'false-positive') => {
    try {
      onChange(await window.api.security.resolve(a.id, outcome, note))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }
  return (
    <div className="card alert-card">
      <div className="row-gap" style={{ marginBottom: 6 }}>
        <span className="pill high">
          <Icon name="shield" size={12} /> possible prompt injection
        </span>
        <strong>{a.docName}</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          raised {new Date(a.raisedAt).toLocaleString()}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => onOpenReview(a.sessionId)}>
          Open review
        </button>
      </div>
      {a.clauses.map((c) => (
        <div key={c.clauseId} className="alert-clause">
          <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
            {c.label} · detected: {c.hits.join(', ')}
          </div>
          <div className="quote" style={{ color: 'var(--text)' }}>
            <Highlighted text={c.text} />
          </div>
        </div>
      ))}
      {a.aiNotes.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>What the AI reported</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {a.aiNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="banner danger" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row-gap" style={{ marginTop: 12 }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required for a false positive)" style={{ flex: 1 }} disabled={!canResolve} />
        <button className="btn reject on" disabled={!canResolve} onClick={() => resolve('malicious')}>
          Confirm injection attempt
        </button>
        <button className="btn" disabled={!canResolve || !note.trim()} onClick={() => resolve('false-positive')}>
          False positive: release hold
        </button>
      </div>
    </div>
  )
}
