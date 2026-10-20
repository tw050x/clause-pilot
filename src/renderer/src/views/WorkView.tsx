import type { BackgroundJob, ReviewSummary } from '@shared/types'
import { Icon } from '../lib/icons'

const KIND: Record<BackgroundJob['kind'], string> = { plan: 'Planning', review: 'AI review', ask: 'Question' }

/** A review whose AI review waits for the reviewer to move it on (start it, check its findings, go on). */
export const FOR_YOU = new Set(['planned', 'your-turn', 'paused', 'stopped', 'failed'])
export const forYou = (reviews: ReviewSummary[]) => reviews.filter((r) => !r.original && !r.closed && !r.contractArchived && r.ai && FOR_YOU.has(r.ai.state))

/**
 * Background work: what the AI is doing now (reviews planned or run, questions asked of
 * highlighted text) and what's waiting its turn (reviews to be planned), with where each has got
 * to. Opened from the header's Working pill; it follows along as the work goes on.
 */
export function WorkView({ jobs, reviews, onOpenReview }: { jobs: BackgroundJob[]; reviews: ReviewSummary[]; onOpenReview: (id: string) => void }) {
  const running = jobs.filter((j) => j.status === 'running')
  const waiting = jobs.filter((j) => j.status === 'waiting')
  const busy = new Set(jobs.map((j) => j.sessionId))
  // Waiting for the reviewer (not running meanwhile): their turn first, then ready to start, then the rest.
  const order = ['your-turn', 'planned', 'paused', 'stopped', 'failed']
  const mine: BackgroundJob[] = forYou(reviews)
    .filter((r) => !busy.has(r.id))
    .sort((a, b) => order.indexOf(a.ai!.state) - order.indexOf(b.ai!.state) || b.updatedAt.localeCompare(a.updatedAt))
    .map((r) => ({ id: `you:${r.id}`, kind: 'review', status: 'waiting', sessionId: r.id, accountName: r.accountName, contractTitle: r.contractTitle, version: r.version, docName: r.docName, title: r.ai!.label, detail: r.ai!.detail, startedAt: r.updatedAt }))
  const table = (list: BackgroundJob[], empty: string, you = false) =>
    !list.length ? (
      <div className="empty-state">{empty}</div>
    ) : (
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Fixed columns: Running and Waiting line up. */}
        <table className="t" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 190 }}>What</th>
              <th style={{ width: '34%' }}>Contract</th>
              <th>Where it’s got to</th>
              <th style={{ width: 90 }}>{you ? 'Since' : 'Started'}</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => onOpenReview(j.sessionId)}>
                <td>
                  <span className={`work-kind ${you ? 'you' : j.status}`}>{you ? j.title : KIND[j.kind]}</span>
                </td>
                <td>
                  <strong>{j.contractTitle ?? j.docName}</strong>
                  <div className="faint dr-small">
                    {[j.accountName, j.version !== undefined ? `Version ${j.version}` : null].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  {!you && <div>{j.title}</div>}
                  <div className={you ? '' : 'faint dr-small'}>{j.detail}</div>
                </td>
                <td className="muted">{j.startedAt ? (you ? new Date(j.startedAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : new Date(j.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '–'}</td>
                <td>
                  <button className="btn sm row-action" onClick={(e) => (e.stopPropagation(), onOpenReview(j.sessionId))}>
                    Open <Icon name="next" size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  return (
    <div className="page">
      <h1>
        Background work <span className="faint">{jobs.length + mine.length || ''}</span>
      </h1>
      <p className="lede">What the AI is doing now, what’s waiting its turn, and the reviews waiting for you to move them on. Drafts are planned as soon as they’re uploaded; open one to see its review.</p>
      <h3 className="work-h">Running</h3>
      {table(running, 'Nothing running now.')}
      <h3 className="work-h">Waiting its turn</h3>
      {table(waiting, 'Nothing waiting.')}
      <h3 className="work-h">Waiting for you</h3>
      {table(mine, 'Nothing waiting for you.', true)}
    </div>
  )
}
