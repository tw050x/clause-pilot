import { useState } from 'react'
import type { ReviewSummary } from '@shared/types'

/** Every review on this machine, newest first. */
export function ReviewsView({ reviews, accountName, onOpen }: { reviews: ReviewSummary[]; accountName?: string; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const shown = reviews.filter((r) => !q || r.docName.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            All reviews <span className="faint" style={{ fontWeight: 400 }}>{reviews.length}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            {accountName ? `Every review for ${accountName}. Choose “All accounts” at the top left to see everyone’s.` : 'Every contract reviewed on this machine.'} Open one to see its
            analysis and decisions as they were recorded.
          </p>
        </div>
        <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!reviews.length ? (
        <p className="faint">No reviews yet. Open a contract from the Start page.</p>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Contract</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 200 }}>Decisions</th>
                <th style={{ width: 190 }}>Started</th>
                <th style={{ width: 80 }}>Mode</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                  <td>
                    <strong>{r.accountName ? `${r.accountName} · ${r.contractTitle} · v${r.version}` : r.docName}</strong>
                    {r.accountName && <div className="faint">{r.docName}</div>}
                  </td>
                  <td className="muted">{r.contractType === 'nda' ? 'NDA' : r.contractType === 'order-form' ? 'Order form' : 'Contract'}</td>
                  <td className="muted">
                    {r.decided} of {r.clauses} decided
                    {r.rejected > 0 && <span className="pill rejected" style={{ marginLeft: 6 }}>{r.rejected} rejected</span>}
                  </td>
                  <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                  <td>
                    <span className="pill neutral">{r.mode}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
