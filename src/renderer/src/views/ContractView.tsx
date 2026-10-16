import { useEffect, useState } from 'react'
import type { Account, ContractRecord, DemoContract, ReviewSummary } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * One contract with the active client: every draft reviewed so far, and the
 * button to upload the next one (which is compared with the latest version).
 */
export function ContractView({
  contract,
  account,
  demoMode,
  reviews,
  onOpenReview,
  onUploadDraft,
  onStartDemo
}: {
  contract: ContractRecord
  account: Account
  demoMode: boolean
  reviews: ReviewSummary[]
  onOpenReview: (id: string) => void
  onUploadDraft: (contractId: string) => void
  onStartDemo: (path: string, contractId: string) => void
}) {
  const [demos, setDemos] = useState<DemoContract[]>([])
  useEffect(() => void window.api.demo.list().then(setDemos), [demoMode])

  const versions = reviews.filter((r) => r.contractId === contract.id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
  const latest = versions[0]
  // In demo mode, drafts come from the bundled chain for this contract (version 1, then its follow-ups).
  const chain: DemoContract[] = []
  for (let d = demos.find((x) => x.contractId === contract.id && !x.followUpOf); d; d = demos.find((x) => x.followUpOf === d!.file)) chain.push(d)
  const demoNext = demoMode ? chain[versions.length] : undefined

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
        {!demoMode ? (
          <button className="btn primary upload-draft" onClick={() => onUploadDraft(contract.id)}>
            <Icon name="upload" /> {versions.length ? 'Upload new draft' : 'Upload first draft'}
          </button>
        ) : demoNext ? (
          <button className="btn primary upload-draft" onClick={() => onStartDemo(demoNext.path, contract.id)}>
            <Icon name="upload" /> {versions.length ? `Upload new draft: ${demoNext.title.split(', ').pop()}` : 'Upload first draft'}
          </button>
        ) : null}
      </div>
      {demoMode && versions.length > 0 && !demoNext && <p className="faint">There are no more demo drafts for this contract.</p>}
      {versions.length > 0 && (
        <p className="faint" style={{ marginTop: 0 }}>
          Each new draft is compared with the version before it: clauses you settled are skipped, and anything you rejected that comes back unchanged is flagged.
        </p>
      )}
      {!versions.length ? (
        <div className="empty-state">
          Upload the first draft to start reviewing this contract. {!demoMode && 'The contract’s text is sent to Anthropic’s API for the AI checks, so only upload documents you’re allowed to share outside the company.'}
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
