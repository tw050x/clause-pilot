import { useEffect, useState } from 'react'
import type { Account, ContractRecord, DemoContract, ReviewSummary } from '@shared/types'
import { Chevron, Icon } from '../lib/icons'

/**
 * Accounts (clients) → their contracts → each contract's versions. Uploading a
 * new draft of a contract creates the next version and compares it with the last.
 */
export function AccountsView({
  demoMode,
  reviews,
  at,
  onNavigate,
  onOpenReview,
  onUploadDraft,
  onStartDemo
}: {
  demoMode: boolean
  reviews: ReviewSummary[]
  /** Which level is showing: all accounts, one account, or one contract. */
  at: { accountId?: string; contractId?: string }
  onNavigate: (at: { accountId?: string; contractId?: string }) => void
  onOpenReview: (id: string) => void
  onUploadDraft: (contractId: string) => void
  onStartDemo: (path: string, contractId: string) => void
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [demos, setDemos] = useState<DemoContract[]>([])
  const [newName, setNewName] = useState('')

  const load = () => {
    window.api.accounts.list().then(setAccounts)
    window.api.contracts.list().then(setContracts)
  }
  useEffect(() => {
    load()
    window.api.demo.list().then(setDemos)
  }, [demoMode])

  const account = accounts.find((a) => a.id === at.accountId)
  const contract = contracts.find((c) => c.id === at.contractId)
  const versionsOf = (contractId: string) => reviews.filter((r) => r.contractId === contractId).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))

  // ---- one contract: its versions ----
  if (contract && account) {
    const versions = versionsOf(contract.id)
    const latest = versions[0]
    // In demo mode, drafts come from the bundled chain for this contract (version 1, then its follow-ups).
    const chain: DemoContract[] = []
    for (let d = demos.find((x) => x.contractId === contract.id && !x.followUpOf); d; d = demos.find((x) => x.followUpOf === d!.file)) chain.push(d)
    const demoNext = demoMode ? chain[versions.length] : undefined
    return (
      <div className="page">
        <Crumbs items={[{ label: 'Accounts', go: () => onNavigate({}) }, { label: account.name, go: () => onNavigate({ accountId: account.id }) }, { label: contract.title }]} />
        <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <h1>{contract.title}</h1>
            <p className="lede" style={{ margin: 0 }}>
              {account.name} · {versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'} reviewed` : 'No versions yet'}
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
          <div className="empty-state">Upload the first draft to start reviewing this contract.</div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Version</th>
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

  // ---- one account: its contracts ----
  if (account) {
    const mine = contracts.filter((c) => c.accountId === account.id)
    return (
      <div className="page">
        <Crumbs items={[{ label: 'Accounts', go: () => onNavigate({}) }, { label: account.name }]} />
        <h1>{account.name}</h1>
        <p className="lede">Contracts with this client. Open one to see its versions or upload a new draft.</p>
        <NewContract
          disabled={demoMode}
          onCreate={async (title) => {
            const c = await window.api.contracts.create(account.id, title)
            load()
            onNavigate({ accountId: account.id, contractId: c.id })
          }}
        />
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <tbody>
              {mine.map((c) => {
                const v = versionsOf(c.id)
                return (
                  <tr key={c.id} className="clickable contract-row" onClick={() => onNavigate({ accountId: account.id, contractId: c.id })}>
                    <td>
                      <strong>{c.title}</strong>
                    </td>
                    <td className="muted" style={{ width: 160 }}>
                      {c.contractType === 'nda' ? 'NDA' : c.contractType === 'order-form' ? 'Order form' : 'Contract'}
                    </td>
                    <td className="muted" style={{ width: 200 }}>
                      {v.length ? `Version ${v[0].version} · ${new Date(v[0].createdAt).toLocaleDateString()}` : 'No versions yet'}
                    </td>
                    <td style={{ width: 30 }}>
                      <Chevron />
                    </td>
                  </tr>
                )
              })}
              {!mine.length && (
                <tr>
                  <td className="faint">No contracts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ---- all accounts ----
  return (
    <div className="page">
      <h1>Accounts</h1>
      <p className="lede">The clients we contract with. Each contract keeps every draft you’ve reviewed, so a new draft only needs reading where something changed.</p>
      {!demoMode && (
        <div className="row-gap" style={{ marginBottom: 16 }}>
          <input placeholder="New account name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button
            className="btn"
            disabled={!newName.trim()}
            onClick={async () => {
              const a = await window.api.accounts.create(newName)
              setNewName('')
              load()
              onNavigate({ accountId: a.id })
            }}
          >
            Add account
          </button>
        </div>
      )}
      {!accounts.length ? (
        <div className="empty-state">No accounts yet. Add one here, or create one when you open your first contract.</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="t">
            <tbody>
              {accounts.map((a) => {
                const n = contracts.filter((c) => c.accountId === a.id).length
                const r = reviews.filter((x) => x.accountId === a.id).length
                return (
                  <tr key={a.id} className="clickable account-row" onClick={() => onNavigate({ accountId: a.id })}>
                    <td>
                      <strong>{a.name}</strong>
                    </td>
                    <td className="muted" style={{ width: 160 }}>
                      {n} contract{n === 1 ? '' : 's'}
                    </td>
                    <td className="muted" style={{ width: 160 }}>
                      {r} review{r === 1 ? '' : 's'}
                    </td>
                    <td style={{ width: 30 }}>
                      <Chevron />
                    </td>
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

function Crumbs({ items }: { items: { label: string; go?: () => void }[] }) {
  return (
    <div className="crumbs">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="faint"> / </span>}
          {it.go ? (
            <button className="link-btn" onClick={it.go}>
              {it.label}
            </button>
          ) : (
            <span>{it.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}

function NewContract({ disabled, onCreate }: { disabled: boolean; onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('')
  if (disabled) return null
  return (
    <div className="row-gap" style={{ marginBottom: 16 }}>
      <input placeholder="New contract, e.g. Mutual NDA" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button
        className="btn"
        disabled={!title.trim()}
        onClick={() => {
          onCreate(title)
          setTitle('')
        }}
      >
        Add contract
      </button>
    </div>
  )
}
