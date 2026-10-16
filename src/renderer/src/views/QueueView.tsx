import { useState } from 'react'
import type { Nomination, PlaybookPosition, PlaybookProposal } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * Everything waiting for an owner's decision. Playbook changes and library
 * nominations both change how every future contract is reviewed, so neither
 * takes effect on the say-so of the person who suggested it.
 * (No accounts in this demo: the same user can approve, but the flow is real.)
 */
export function ApprovalsView({
  nominations,
  proposals,
  onNominations,
  onProposals
}: {
  nominations: Nomination[]
  proposals: PlaybookProposal[]
  onNominations: (n: Nomination[]) => void
  onProposals: (p: PlaybookProposal[]) => void
}) {
  const pendingNoms = nominations.filter((n) => n.status === 'pending')
  const pendingProps = proposals.filter((p) => p.status === 'pending')
  const done = [
    ...proposals.filter((p) => p.status !== 'pending').map((p) => ({ at: p.decidedAt ?? p.proposedAt, what: `Playbook: ${p.kind} "${(p.after ?? p.before)?.title}"`, status: p.status, by: p.decidedBy ?? '' })),
    ...nominations.filter((n) => n.status !== 'pending').map((n) => ({ at: n.nominatedAt, what: `Library: ${n.text.slice(0, 90)}…`, status: n.status, by: '' }))
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="page">
      <h1>Approvals</h1>
      <p className="lede">Changes that affect every future review wait here for the owner's decision. Approving applies the change and records who approved it.</p>

      <h3 className="approvals-h">
        Playbook changes <span className="faint">{pendingProps.length}</span>
      </h3>
      {!pendingProps.length && <p className="faint">Nothing waiting. Suggest a change from the Playbook page.</p>}
      <div style={{ display: 'grid', gap: 12, marginBottom: 28 }}>
        {pendingProps.map((p) => (
          <ProposalCard key={p.id} p={p} onProposals={onProposals} />
        ))}
      </div>

      <h3 className="approvals-h">
        Library nominations <span className="faint">{pendingNoms.length}</span>
      </h3>
      {!pendingNoms.length && <p className="faint">Nothing waiting. Nominate a clause when you accept it during a review.</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {pendingNoms.map((n) => (
          <NominationCard key={n.id} n={n} onChange={onNominations} />
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h3 className="approvals-h" style={{ marginTop: 28 }}>
            Decided
          </h3>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="t">
              <tbody>
                {done.map((d, i) => (
                  <tr key={i}>
                    <td style={{ width: 110 }}>
                      <span className={`pill ${d.status === 'approved' || d.status === 'promoted' ? 'accepted' : 'neutral'}`}>{d.status}</span>
                    </td>
                    <td>{d.what}</td>
                    <td className="muted" style={{ width: 200 }}>
                      {new Date(d.at).toLocaleString()}
                      {d.by && ` · ${d.by}`}
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

const FIELDS: { key: keyof PlaybookPosition; label: string }[] = [
  { key: 'title', label: 'Topic' },
  { key: 'appliesTo', label: 'Applies to' },
  { key: 'standard', label: 'Standard' },
  { key: 'acceptableFallback', label: 'Fallback' },
  { key: 'redFlags', label: 'Red flags' }
]

const show = (v: unknown) => (Array.isArray(v) ? v.join(' · ') : String(v ?? ''))

function ProposalCard({ p, onProposals }: { p: PlaybookProposal; onProposals: (p: PlaybookProposal[]) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const decide = async (approve: boolean) => {
    try {
      onProposals((await window.api.kb.decidePlaybook(p.id, approve, note)).proposals)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }
  const title = (p.after ?? p.before)?.title
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row-gap" style={{ marginBottom: 6 }}>
        <span className={`pill ${p.kind === 'delete' ? 'high' : p.kind === 'add' ? 'accepted' : 'medium'}`}>{{ add: 'new position', edit: 'change', delete: 'removal' }[p.kind]}</span>
        <strong>{title}</strong>
        {p.before && <span className="faint" style={{ fontSize: 12 }}>against v{p.before.version ?? 1}</span>}
      </div>
      <p className="faint" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
        Proposed by {p.proposedBy} on {new Date(p.proposedAt).toLocaleString()}
      </p>
      <p style={{ margin: '0 0 12px' }}>
        <span className="muted">Reason:</span> {p.reason}
      </p>
      <table className="t change-table">
        <tbody>
          {FIELDS.map(({ key, label }) => {
            const before = p.before ? show(p.before[key]) : ''
            const after = p.after ? show(p.after[key]) : ''
            if (p.kind === 'edit' && before === after) return null
            return (
              <tr key={key}>
                <th style={{ width: 110 }}>{label}</th>
                <td>
                  {before && p.kind !== 'add' && <div className="was">{before}</div>}
                  {after && <div className="now">{after}</div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <div className="banner danger" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row-gap" style={{ marginTop: 12 }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => decide(true)}>
          <Icon name="check" /> Approve
        </button>
        <button className="btn" onClick={() => decide(false)}>
          Decline
        </button>
      </div>
    </div>
  )
}

function NominationCard({ n, onChange }: { n: Nomination; onChange: (n: Nomination[]) => void }) {
  const [title, setTitle] = useState(n.category.charAt(0) + n.category.slice(1).toLowerCase())
  const [category, setCategory] = useState(n.category.charAt(0) + n.category.slice(1).toLowerCase())
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row-gap faint" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Nominated by {n.nominatedBy} on {new Date(n.nominatedAt).toLocaleDateString()} from <strong className="muted">{n.fromDoc}</strong>
      </div>
      <div className="quote" style={{ fontSize: 15, color: 'var(--text)' }}>
        {n.text}
      </div>
      {n.note && <p className="muted">Reviewer note: {n.note}</p>}
      <div className="row-gap" style={{ marginTop: 10 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Library title" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
        <button className="btn primary" onClick={async () => onChange(await window.api.kb.promote(n.id, title, category))}>
          <Icon name="check" /> Promote to pre-approved
        </button>
        <button className="btn" onClick={async () => onChange(await window.api.kb.dismiss(n.id))}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
