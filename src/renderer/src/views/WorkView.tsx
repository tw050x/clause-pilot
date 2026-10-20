import type { BackgroundJob } from '@shared/types'
import { Icon } from '../lib/icons'

const KIND: Record<BackgroundJob['kind'], string> = { plan: 'Planning', review: 'AI review', ask: 'Question' }

/**
 * Background work: what the AI is doing now (reviews planned or run, questions asked of
 * highlighted text) and what's waiting its turn (reviews to be planned), with where each has got
 * to. Opened from the header's Working pill; it follows along as the work goes on.
 */
export function WorkView({ jobs, onOpenReview }: { jobs: BackgroundJob[]; onOpenReview: (id: string) => void }) {
  const running = jobs.filter((j) => j.status === 'running')
  const waiting = jobs.filter((j) => j.status === 'waiting')
  const table = (list: BackgroundJob[], empty: string) =>
    !list.length ? (
      <div className="empty-state">{empty}</div>
    ) : (
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Fixed columns: Running and Waiting line up. */}
        <table className="t" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 120 }}>What</th>
              <th style={{ width: '34%' }}>Contract</th>
              <th>Where it’s got to</th>
              <th style={{ width: 90 }}>Started</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => onOpenReview(j.sessionId)}>
                <td>
                  <span className={`work-kind ${j.status}`}>{KIND[j.kind]}</span>
                </td>
                <td>
                  <strong>{j.contractTitle ?? j.docName}</strong>
                  <div className="faint dr-small">
                    {[j.accountName, j.version !== undefined ? `Version ${j.version}` : null].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  <div>{j.title}</div>
                  <div className="faint dr-small">{j.detail}</div>
                </td>
                <td className="muted">{j.startedAt ? new Date(j.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–'}</td>
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
        Background work <span className="faint">{jobs.length || ''}</span>
      </h1>
      <p className="lede">What the AI is doing now and what’s waiting its turn. Drafts are planned as soon as they’re uploaded; open one to see its review.</p>
      <h3 className="work-h">Running</h3>
      {table(running, 'Nothing running now.')}
      <h3 className="work-h">Waiting</h3>
      {table(waiting, 'Nothing waiting.')}
    </div>
  )
}
