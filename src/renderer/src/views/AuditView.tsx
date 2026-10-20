import { useEffect, useState } from 'react'
import type { AuditEntry, ReviewSession } from '@shared/types'
import { Icon } from '../lib/icons'
import { CardList, ItemCard } from '../components/ItemCards'

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
      {!shown.length ? (
        <div className="empty-state">No entries yet.</div>
      ) : (
        <CardList compact>
          {shown.map((e) => (
            <ItemCard
              key={e.seq}
              title={<code>{e.type}</code>}
              badges={e.actor === 'system' ? <span className="pill neutral">system</span> : <span className="pill intent">{e.actor}</span>}
              sub={`#${e.seq} · ${new Date(e.ts).toLocaleString()}`}
              body={<div className="mono audit-payload">{JSON.stringify(e.payload)}</div>}
            />
          ))}
        </CardList>
      )}
    </div>
  )
}
