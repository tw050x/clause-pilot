import { useState } from 'react'
import type { ReviewSummary } from '@shared/types'

/**
 * Every review for the active client, newest first. Closed reviews, and reviews of archived
 * contracts, are hidden unless you ask to see them; nothing is ever deleted.
 */
export function ReviewsView({ reviews, accountName, onOpen, onChanged }: { reviews: ReviewSummary[]; accountName?: string; onOpen: (id: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const hidden = (r: ReviewSummary) => !!r.closed || !!r.contractArchived
  const hiddenCount = reviews.filter(hidden).length
  const shown = reviews.filter((r) => (showHidden || !hidden(r)) && (!q || r.docName.toLowerCase().includes(q.toLowerCase()) || (r.contractTitle ?? '').toLowerCase().includes(q.toLowerCase())))
  const toggle = async (r: ReviewSummary) => {
    await window.api.review.close(r.id, !r.closed)
    onChanged()
  }
  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            All reviews <span className="faint" style={{ fontWeight: 400 }}>{reviews.length - hiddenCount}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            Every open review for {accountName}, newest first. Close a review when you’re done with it; it’s kept, just out of the way.
          </p>
        </div>
        <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {hiddenCount > 0 && (
        <label className="row-gap faint" style={{ fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show closed reviews and reviews of archived contracts ({hiddenCount})
        </label>
      )}
      {!reviews.length ? (
        <p className="faint">No reviews yet. Open a contract from the Start page.</p>
      ) : !shown.length ? (
        <p className="faint">No open reviews{q ? ' match the filter' : ''}.</p>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Contract</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 200 }}>Decided</th>
                <th style={{ width: 190 }}>Started</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`clickable ${hidden(r) ? 'row-hidden' : ''}`} onClick={() => onOpen(r.id)}>
                  <td>
                    <strong>{r.accountName ? `${r.accountName} · ${r.contractTitle} · v${r.version}` : r.docName}</strong>
                    {r.closed && <span className="pill neutral" style={{ marginLeft: 6 }}>closed</span>}
                    {r.contractArchived && <span className="pill neutral" style={{ marginLeft: 6 }}>contract archived</span>}
                    {r.accountName && <div className="faint">{r.docName}</div>}
                  </td>
                  <td className="muted">{r.contractType === 'nda' ? 'NDA' : r.contractType === 'order-form' ? 'Order form' : 'Contract'}</td>
                  <td className="muted">
                    {r.clauses ? `${r.decided} of ${r.clauses} changed paragraphs` : 'No changes'}
                    {r.rejected > 0 && <span className="pill rejected" style={{ marginLeft: 6 }}>{r.rejected} rejected</span>}
                  </td>
                  <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm row-action" onClick={() => toggle(r)}>
                      {r.closed ? 'Reopen' : 'Close'}
                    </button>
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
