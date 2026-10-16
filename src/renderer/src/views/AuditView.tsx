import { useEffect, useState } from 'react'
import type { AuditEntry, ReviewSession } from '@shared/types'
import { Icon } from '../lib/icons'

export function AuditView({ session }: { session: ReviewSession | null }) {
  const [scope, setScope] = useState<'session' | 'all'>(session ? 'session' : 'all')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [chain, setChain] = useState<{ ok: boolean; entries: number; brokenAt?: number } | null>(null)
  const [onlyHuman, setOnlyHuman] = useState(false)

  useEffect(() => {
    window.api.audit.list(scope === 'session' ? session?.id : undefined).then(setEntries)
    window.api.audit.verify().then(setChain)
  }, [scope, session?.id])

  const shown = entries.filter((e) => !onlyHuman || e.actor !== 'system').reverse()

  return (
    <div className="page">
      <h1>Audit</h1>
      <p className="lede">
        Every AI result and every human decision, append-only. Each entry includes the hash of the previous one, so editing or deleting history breaks the chain.
      </p>
      <div className="row-gap" style={{ marginBottom: 14 }}>
        {chain && (
          <span className={`pill ${chain.ok ? 'accepted' : 'high'}`}>
            <Icon name="shield" size={12} /> {chain.ok ? `Chain intact · ${chain.entries} entries` : `Chain broken at #${chain.brokenAt}`}
          </span>
        )}
        <div className="seg">
          <button className={scope === 'session' ? 'on' : ''} disabled={!session} onClick={() => setScope('session')}>
            This review
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            Everything
          </button>
        </div>
        <label className="row-gap" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={onlyHuman} onChange={(e) => setOnlyHuman(e.target.checked)} /> Human actions only
        </label>
        <div style={{ flex: 1 }} />
        {session && (
          <button className="btn" onClick={() => window.api.audit.export(session.id)}>
            Export review record
          </button>
        )}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th>
              <th style={{ width: 170 }}>When</th>
              <th style={{ width: 120 }}>Who</th>
              <th style={{ width: 190 }}>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.seq}>
                <td className="mono faint">{e.seq}</td>
                <td className="muted">{new Date(e.ts).toLocaleString()}</td>
                <td>{e.actor === 'system' ? <span className="faint">system</span> : <strong>{e.actor}</strong>}</td>
                <td>
                  <code>{e.type}</code>
                </td>
                <td className="mono" style={{ fontSize: 11.5, wordBreak: 'break-word', color: 'var(--text-2)' }}>
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="empty" style={{ height: 120 }}>No entries yet.</div>}
      </div>
    </div>
  )
}
