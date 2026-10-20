import { useState } from 'react'
import type { ReviewSummary } from '@shared/types'
import { CardList, ItemCard } from '../components/ItemCards'
import { ReviewAction, StatePill } from './ContractView'

/**
 * Every review for the active client, newest first. Closed reviews, and reviews of archived
 * contracts, are hidden unless you ask to see them; nothing is ever deleted.
 */
export function ReviewsView({ reviews, accountName, onOpen, onChanged }: { reviews: ReviewSummary[]; accountName?: string; onOpen: (id: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const hidden = (r: ReviewSummary) => !!r.closed || !!r.contractArchived
  // The original we sent with a first draft isn't a review: it's on its contract's page.
  const listed = reviews.filter((r) => !r.original)
  const hiddenCount = listed.filter(hidden).length
  const shown = listed.filter((r) => (showHidden || !hidden(r)) && (!q || r.docName.toLowerCase().includes(q.toLowerCase()) || (r.contractTitle ?? '').toLowerCase().includes(q.toLowerCase())))
  const toggle = async (r: ReviewSummary) => {
    await window.api.review.close(r.id, !r.closed)
    onChanged()
  }
  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            All reviews <span className="faint" style={{ fontWeight: 400 }}>{listed.length - hiddenCount}</span>
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
      {!listed.length ? (
        <p className="faint">No reviews yet. Open a contract from the Start page.</p>
      ) : !shown.length ? (
        <p className="faint">No open reviews{q ? ' match the filter' : ''}.</p>
      ) : (
        <CardList>
          {shown.map((r) => (
            <ItemCard
              key={r.id}
              onClick={() => onOpen(r.id)}
              muted={hidden(r)}
              title={r.accountName ? `${r.accountName} · ${r.contractTitle} · v${r.version}` : r.docName}
              badges={
                <>
                  <StatePill state={r.ai} />
                  {r.closed && <span className="pill neutral">closed</span>}
                  {r.contractArchived && <span className="pill neutral">contract archived</span>}
                </>
              }
              sub={r.accountName ? r.docName : undefined}
              actions={
                <>
                  <ReviewAction review={r} />
                  <button className="btn sm" onClick={() => toggle(r)}>
                    {r.closed ? 'Reopen' : 'Close'}
                  </button>
                </>
              }
              facts={[
                { label: 'Type', value: r.contractType === 'nda' ? 'NDA' : r.contractType === 'order-form' ? 'Order form' : 'Contract' },
                { label: 'Started', value: new Date(r.createdAt).toLocaleString() },
                r.ai && { label: 'Review', value: r.ai.detail, wide: true }
              ]}
            />
          ))}
        </CardList>
      )}
    </div>
  )
}
