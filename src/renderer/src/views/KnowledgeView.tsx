import { useEffect, useState } from 'react'
import type { LibraryClause, Precedent } from '@shared/types'
import { useTransfer } from '../components/Transfer'
import { CardList, ItemCard } from '../components/ItemCards'

/** Shared page frame: title, one-line explanation, count and a filter box. */
function KnowledgePage({ title, lede, count, q, setQ, actions, children }: {
  title: string
  actions?: React.ReactNode
  lede: string
  count: number
  q: string
  setQ: (q: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            {title} <span className="faint" style={{ fontWeight: 400 }}>{count}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>{lede}</p>
        </div>
        <div className="row-gap">
          <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          {actions}
        </div>
      </div>
      {children}
    </div>
  )
}

const matcher = (q: string) => (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q.toLowerCase()))

export function LibraryView() {
  const [library, setLibrary] = useState<LibraryClause[]>([])
  const [q, setQ] = useState('')
  const load = () => void window.api.kb.library().then(setLibrary)
  useEffect(load, [])
  const transfer = useTransfer('library', load)
  const match = matcher(q)
  return (
    <KnowledgePage
      title="Clauses"
      lede="Wording we have already approved. A draft on our paper is compared with it: paragraphs that match word for word stay in the background, and the rest show as changes."
      count={library.length}
      q={q}
      setQ={setQ}
      actions={transfer.buttons}
    >
      {transfer.banner}
      {library.length === 0 && (
        <div className="empty-state">
          No approved wording yet. Import a clauses file, or when you accept a change during a review, nominate its wording for Clauses and approve it on the Approvals page. From then on, drafts are compared with it.
        </div>
      )}
      <CardList>
        {library
          .filter((c) => match(c.title, c.text, c.category))
          .map((c) => (
            <ItemCard
              key={c.id}
              title={c.title}
              badges={<span className="pill neutral">{c.contractType}</span>}
              sub={<span className="mono">{c.id}</span>}
              body={<div className="doc">{c.text}</div>}
              facts={[
                { label: 'Category', value: c.category },
                { label: 'Approved', value: [c.approvedOn, c.approvedBy].filter(Boolean).join(' · ') }
              ]}
            />
          ))}
      </CardList>
    </KnowledgePage>
  )
}

export function HistoryView() {
  const [history, setHistory] = useState<Precedent[]>([])
  const [q, setQ] = useState('')
  useEffect(() => void window.api.kb.precedents().then(setHistory), [])
  const match = matcher(q)
  return (
    <KnowledgePage
      title="Precedents"
      lede="How changes were handled in past negotiations: what they proposed, how we answered and why. Every change you accept or answer in a review is added here, and shown as “seen before” the next time it comes up."
      count={history.length}
      q={q}
      setQ={setQ}
    >
      {history.length === 0 && (
        <div className="empty-state">No precedents yet. Every change you accept or answer in a review is added here, so the next reviewer can see how it was handled.</div>
      )}
      <CardList>
        {[...history]
          .sort((a, b) => b.date.localeCompare(a.date))
          .filter((p) => match(p.counterparty, p.text, p.notes, p.category))
          .map((p) => (
            <ItemCard
              key={p.id}
              title={p.counterparty}
              badges={
                <>
                  <span className={`pill ${p.outcome}`}>{p.response ? { accepted: 'accepted', countered: 'countered', restored: 'restored ours', struck: 'struck' }[p.response] : p.outcome}</span>
                  {p.source === 'review' && <span className="pill intent">from a review</span>}
                </>
              }
              sub={`${p.date} · ${p.category}${p.where ? ` · ${p.where}` : ''}`}
              body={<div className="doc">{p.text}</div>}
              facts={[p.ours?.some((t) => t) && { label: 'We answered', value: p.ours.filter((t) => t).join(' '), wide: true }, !!p.notes && { label: 'Why', value: p.notes, wide: true }]}
            />
          ))}
      </CardList>
    </KnowledgePage>
  )
}
