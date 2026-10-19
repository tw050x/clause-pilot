import { useEffect, useState } from 'react'
import { useTransfer } from '../components/Transfer'
import type { ContractType, PlaybookPosition, PlaybookProposal } from '@shared/types'
import { Icon } from '../lib/icons'

type Draft = { mode: 'add' } | { mode: 'edit'; position: PlaybookPosition } | { mode: 'delete'; position: PlaybookPosition }

const TYPES: { id: ContractType; label: string }[] = [
  { id: 'nda', label: 'NDA' },
  { id: 'order-form', label: 'Order form' }
]

/**
 * Our standard positions. Changes are proposed here and approved on the
 * Approvals page, so the playbook only ever changes through an audited decision.
 */
export function PlaybookView({ onProposalsChanged }: { onProposalsChanged: () => void }) {
  const [playbook, setPlaybook] = useState<PlaybookPosition[]>([])
  const [proposals, setProposals] = useState<PlaybookProposal[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    window.api.kb.playbook().then(setPlaybook)
    window.api.kb.playbookProposals().then(setProposals)
  }, [])
  const transfer = useTransfer('playbook', () => void window.api.kb.playbook().then(setPlaybook))

  const pendingFor = (id: string) => proposals.filter((p) => p.status === 'pending' && p.positionId === id).length
  const pendingNew = proposals.filter((p) => p.status === 'pending' && p.kind === 'add').length
  const match = (...f: string[]) => !q || f.some((x) => x.toLowerCase().includes(q.toLowerCase()))

  const submit = async (kind: PlaybookProposal['kind'], positionId: string | null, after: PlaybookPosition | null, reason: string) => {
    setProposals(await window.api.kb.proposePlaybook({ kind, positionId, after, reason }))
    setDraft(null)
    setNotice('Proposal sent for approval. Approve it on the Approvals page to apply it.')
    onProposalsChanged()
  }

  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            Playbook <span className="faint" style={{ fontWeight: 400 }}>{playbook.length}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            Our standard position on each topic, what we can accept as a fallback, and the red flags. Every contract is checked against each position separately. Changes are proposed here and take effect once approved.
          </p>
        </div>
        <div className="row-gap">
          <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          {transfer.buttons}
          <button className="btn primary" onClick={() => setDraft({ mode: 'add' })}>
            Propose new position
          </button>
        </div>
      </div>

      {transfer.banner}
      {notice && (
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Icon name="check" /> {notice}
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={() => setNotice(null)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      {pendingNew > 0 && <p className="faint" style={{ marginTop: 0 }}>{pendingNew} new position{pendingNew === 1 ? '' : 's'} awaiting approval.</p>}

      {draft?.mode === 'add' && <PositionForm onCancel={() => setDraft(null)} onSubmit={(after, reason) => submit('add', null, after, reason)} />}

      {playbook.length === 0 && draft?.mode !== 'add' && (
        <div className="empty-state">
          No standard positions yet, so when you ask the AI about a change it has nothing of ours to check it against. Import a playbook file, or use “Propose new position” to add one (for example,
          governing law or a liability cap). Each approved position is checked in every review.
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {playbook
          .filter((p) => match(p.title, p.standard, p.acceptableFallback, ...p.redFlags))
          .map((p) =>
            draft?.mode === 'edit' && draft.position.id === p.id ? (
              <PositionForm key={p.id} initial={p} onCancel={() => setDraft(null)} onSubmit={(after, reason) => submit('edit', p.id, after, reason)} />
            ) : (
              <div key={p.id} className="card" style={{ padding: 16 }}>
                <div className="row-gap" style={{ marginBottom: 8 }}>
                  <h3 style={{ fontSize: 15 }}>{p.title}</h3>
                  {p.appliesTo.map((a) => (
                    <span key={a} className="pill neutral">
                      {a}
                    </span>
                  ))}
                  <span className="faint" style={{ fontSize: 12 }}>
                    v{p.version ?? 1}
                    {p.updatedBy && ` · updated by ${p.updatedBy}`}
                  </span>
                  {pendingFor(p.id) > 0 && <span className="pill medium">{pendingFor(p.id)} pending change</span>}
                  <div style={{ flex: 1 }} />
                  <button className="btn sm" onClick={() => setDraft({ mode: 'edit', position: p })}>
                    Suggest change
                  </button>
                  <button className="btn sm ghost" onClick={() => setDraft({ mode: 'delete', position: p })}>
                    Propose removal
                  </button>
                </div>
                <dl className="kv" style={{ fontSize: 13.5 }}>
                  <dt>Standard</dt>
                  <dd>{p.standard}</dd>
                  <dt>Fallback</dt>
                  <dd>{p.acceptableFallback}</dd>
                  <dt>Red flags</dt>
                  <dd>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {p.redFlags.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </dd>
                </dl>
                {draft?.mode === 'delete' && draft.position.id === p.id && (
                  <RemovalForm onCancel={() => setDraft(null)} onSubmit={(reason) => submit('delete', p.id, null, reason)} />
                )}
              </div>
            )
          )}
      </div>
    </div>
  )
}

export function PositionForm({ initial, onSubmit, onCancel }: { initial?: PlaybookPosition; onSubmit: (p: PlaybookPosition, reason: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [appliesTo, setAppliesTo] = useState<ContractType[]>(initial?.appliesTo ?? ['nda', 'order-form'])
  const [standard, setStandard] = useState(initial?.standard ?? '')
  const [fallback, setFallback] = useState(initial?.acceptableFallback ?? '')
  const [flags, setFlags] = useState((initial?.redFlags ?? []).join('\n'))
  const [reason, setReason] = useState('')
  const valid = title.trim() && standard.trim() && appliesTo.length && reason.trim()

  return (
    <div className="card position-form">
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>{initial ? `Suggest a change to "${initial.title}"` : 'Propose a new position'}</h3>
      <div className="field">
        <label>Topic</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Audit rights" />
      </div>
      <div className="field">
        <label>Applies to</label>
        <div className="row-gap">
          {TYPES.map((t) => (
            <label key={t.id} className="row-gap" style={{ fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={appliesTo.includes(t.id)}
                onChange={(e) => setAppliesTo(e.target.checked ? [...appliesTo, t.id] : appliesTo.filter((x) => x !== t.id))}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Our standard</label>
        <textarea rows={2} value={standard} onChange={(e) => setStandard(e.target.value)} placeholder="What we want the contract to say" />
      </div>
      <div className="field">
        <label>Acceptable fallback</label>
        <textarea rows={2} value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="What we can live with if they push back" />
      </div>
      <div className="field">
        <label>Red flags</label>
        <textarea rows={3} value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="One per line" />
        <span className="hint">The AI checks every contract against these. Be specific.</span>
      </div>
      <div className="field">
        <label>Why?</label>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (shown to the approver)" />
      </div>
      <div className="row-gap">
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() =>
            onSubmit(
              {
                id: initial?.id ?? '',
                title: title.trim(),
                appliesTo,
                standard: standard.trim(),
                acceptableFallback: fallback.trim(),
                redFlags: flags.split('\n').map((f) => f.trim()).filter(Boolean),
                version: initial?.version
              },
              reason.trim()
            )
          }
        >
          Send for approval
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function RemovalForm({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="removal-form">
      <div className="field" style={{ maxWidth: 'none' }}>
        <label>Why should this position be removed?</label>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
      <div className="row-gap">
        <button className="btn sm reject on" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>
          Send removal for approval
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
