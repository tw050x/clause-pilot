import { useState } from 'react'
import type { Account, ContractRecord, ReviewSummary } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * One contract with the active client: every draft reviewed so far, and the
 * button to upload the next one (which is compared with the latest version).
 */
export function ContractView({
  contract,
  account,
  reviews,
  onOpenReview,
  onUploadDraft
}: {
  contract: ContractRecord
  account: Account
  reviews: ReviewSummary[]
  onOpenReview: (id: string) => void
  onUploadDraft: (contractId: string) => void
}) {
  const versions = reviews.filter((r) => r.contractId === contract.id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
  const latest = versions[0]

  return (
    <div className="page">
      <div className="crumbs">{account.name}</div>
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>{contract.title}</h1>
          <p className="lede" style={{ margin: 0 }}>
            {versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'} reviewed` : 'No drafts yet'}
            {contract.contractType !== 'general' && ` · ${contract.contractType === 'nda' ? 'NDA' : 'Order form'}`}
          </p>
        </div>
        <button className="btn primary upload-draft" onClick={() => onUploadDraft(contract.id)}>
          <Icon name="upload" /> {versions.length ? 'Upload new draft' : 'Upload first draft'}
        </button>
      </div>
      {versions.length > 0 && (
        <p className="faint" style={{ marginTop: 0 }}>
          Each new draft is compared with what we sent back last time, so changes they didn’t track show up too, next to what we proposed.
        </p>
      )}
      {!versions.length ? (
        <div className="empty-state">
          Upload the first draft to start reviewing this contract. Nothing leaves this computer unless you ask the AI about it.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Version</th>
                <th>File</th>
                <th style={{ width: 220 }}>Decisions</th>
                <th style={{ width: 190 }}>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="clickable version-row" onClick={() => onOpenReview(v.id)}>
                  <td>
                    <strong>Version {v.version}</strong>
                    {v.id === latest?.id && <span className="pill intent" style={{ marginLeft: 6 }}>latest</span>}
                  </td>
                  <td>{v.docName}</td>
                  <td className="muted">
                    {v.decided} decided
                    {v.rejected > 0 && <span className="pill rejected" style={{ marginLeft: 6 }}>{v.rejected} rejected</span>}
                  </td>
                  <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Create a contract for the active client; it then gets its own page. */
export function NewContractView({ account, onCreated }: { account: Account; onCreated: (c: ContractRecord) => void }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    try {
      onCreated(await window.api.contracts.create(account.id, title))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }
  return (
    <div className="page">
      <div className="crumbs">{account.name}</div>
      <h1>New contract</h1>
      <p className="lede">A contract with {account.name}, e.g. their NDA or an order form. Each draft you upload becomes a new version on its page.</p>
      <div className="field">
        <label>Contract name</label>
        <input
          autoFocus
          value={title}
          placeholder="e.g. Mutual NDA"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && create()}
        />
      </div>
      {error && <div className="banner danger" style={{ marginBottom: 12, maxWidth: 520 }}>{error}</div>}
      <button className="btn primary" disabled={!title.trim()} onClick={create}>
        Create contract
      </button>
    </div>
  )
}

/** Every contract with the active client, with its latest version. */
export function ContractsListView({
  account,
  contracts,
  reviews,
  canCreate,
  onOpen,
  onNew
}: {
  account: Account
  contracts: ContractRecord[]
  reviews: ReviewSummary[]
  canCreate: boolean
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const latest = (id: string) => reviews.filter((r) => r.contractId === id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
  return (
    <div className="page">
      <div className="crumbs">{account.name}</div>
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            All contracts <span className="faint" style={{ fontWeight: 400 }}>{contracts.length}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>Every contract with {account.name}. Open one to see its drafts or upload the next.</p>
        </div>
        {canCreate && (
          <button className="btn primary" onClick={onNew}>
            + New contract
          </button>
        )}
      </div>
      {!contracts.length ? (
        <div className="empty-state">No contracts with {account.name} yet.</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Contract</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 150 }}>Latest version</th>
                <th style={{ width: 200 }}>Decisions</th>
                <th style={{ width: 160 }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const v = latest(c.id)
                return (
                  <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                    <td>
                      <strong>{c.title}</strong>
                    </td>
                    <td className="muted">{c.contractType === 'nda' ? 'NDA' : c.contractType === 'order-form' ? 'Order form' : 'Contract'}</td>
                    <td className="muted">{v ? `Version ${v.version}` : 'No drafts yet'}</td>
                    <td className="muted">
                      {v ? `${v.decided} decided` : '–'}
                      {v && v.rejected > 0 && <span className="pill rejected" style={{ marginLeft: 6 }}>{v.rejected} rejected</span>}
                    </td>
                    <td className="muted">{v ? new Date(v.createdAt).toLocaleDateString() : new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
