import { useEffect, useState } from 'react'
import type { Account, ContractRecord, ReviewSummary, ReviewState } from '@shared/types'
import { CardList, ItemCard } from '../components/ItemCards'
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
  onUploadDraft,
  onChanged
}: {
  contract: ContractRecord
  account: Account
  reviews: ReviewSummary[]
  onOpenReview: (id: string) => void
  onUploadDraft: (contractId: string) => void
  onChanged: () => void
}) {
  const archive = async (archived: boolean) => {
    await window.api.contracts.archive(contract.id, archived)
    onChanged()
  }
  const versions = reviews.filter((r) => r.contractId === contract.id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
  // Drafts reviewed (the original we sent, if uploaded, is listed with them but isn't one).
  const drafts = versions.filter((v) => !v.original)

  return (
    <div className="page">
      <div className="crumbs">{account.name}</div>
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>{contract.title}</h1>
          <p className="lede" style={{ margin: 0 }}>
            {drafts.length ? `${drafts.length} version${drafts.length === 1 ? '' : 's'} reviewed` : 'No drafts yet'}
            {contract.contractType !== 'general' && ` · ${contract.contractType === 'nda' ? 'NDA' : 'Order form'}`}
          </p>
        </div>
        <div className="row-gap">
          <button className="btn" onClick={() => archive(!contract.archived)} title={contract.archived ? 'Back in the sidebar and on the Reviews page' : 'Keep it, but out of the sidebar and the Reviews page'}>
            {contract.archived ? 'Unarchive' : 'Archive contract'}
          </button>
          {!contract.archived && (
            <button className="btn primary upload-draft" onClick={() => onUploadDraft(contract.id)}>
              <Icon name="upload" /> {drafts.length ? 'Upload new draft' : 'Upload first draft'}
            </button>
          )}
        </div>
      </div>
      {contract.archived && (
        <div className="banner info" style={{ marginBottom: 16, maxWidth: 760 }}>
          Archived by {contract.archived.by} on {new Date(contract.archived.at).toLocaleDateString()}. It’s kept with all its reviews, but not in the sidebar or on the Reviews page.
        </div>
      )}
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
        <CardList>
          {versions.map((v) =>
            v.original ? (
              <ItemCard
                key={v.id}
                onClick={() => onOpenReview(v.id)}
                title="Original"
                badges={<span className="pill neutral">ours</span>}
                sub={v.docName}
                facts={[
                  { label: 'What it is', value: 'What we sent: the first draft is compared with it', wide: true },
                  { label: 'Uploaded', value: new Date(v.createdAt).toLocaleString() }
                ]}
              />
            ) : (
              <ItemCard
                key={v.id}
                onClick={() => onOpenReview(v.id)}
                title={`Version ${v.version}`}
                badges={
                  <>
                    <StatePill state={v.ai} />
                    {v.closed && <span className="pill neutral">closed</span>}
                  </>
                }
                sub={v.docName}
                actions={
                  <>
                    <ReviewAction review={v} />
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await window.api.review.close(v.id, !v.closed)
                        onChanged()
                      }}
                    >
                      {v.closed ? 'Reopen' : 'Close'}
                    </button>
                  </>
                }
                facts={[v.ai && { label: 'Review', value: v.ai.detail, wide: true }, { label: 'Uploaded', value: new Date(v.createdAt).toLocaleString() }]}
              />
            )
          )}
        </CardList>
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
  onNew,
  onChanged
}: {
  account: Account
  contracts: ContractRecord[]
  reviews: ReviewSummary[]
  canCreate: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onChanged: () => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const archivedCount = contracts.filter((c) => c.archived).length
  const shown = contracts.filter((c) => showArchived || !c.archived)
  const latest = (id: string) => reviews.filter((r) => r.contractId === id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
  return (
    <div className="page">
      <div className="crumbs">{account.name}</div>
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            All contracts <span className="faint" style={{ fontWeight: 400 }}>{contracts.length - archivedCount}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>Every contract with {account.name}. Open one to see its drafts or upload the next.</p>
        </div>
        {canCreate && (
          <button className="btn primary" onClick={onNew}>
            + New contract
          </button>
        )}
      </div>
      {archivedCount > 0 && (
        <label className="row-gap faint" style={{ fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived contracts ({archivedCount})
        </label>
      )}
      {!shown.length ? (
        <div className="empty-state">No {contracts.length ? 'open ' : ''}contracts with {account.name}{contracts.length ? '' : ' yet'}.</div>
      ) : (
        <CardList>
          {shown.map((c) => {
            const v = latest(c.id)
            return (
              <ItemCard
                key={c.id}
                onClick={() => onOpen(c.id)}
                muted={!!c.archived}
                title={c.title}
                badges={
                  <>
                    {v && <StatePill state={v.ai} />}
                    {c.archived && <span className="pill neutral">archived</span>}
                  </>
                }
                sub={c.contractType === 'nda' ? 'NDA' : c.contractType === 'order-form' ? 'Order form' : 'Contract'}
                actions={
                  <>
                    {v && !c.archived && <ReviewAction review={v} />}
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await window.api.contracts.archive(c.id, !c.archived)
                        onChanged()
                      }}
                    >
                      {c.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </>
                }
                facts={[
                  { label: 'Latest version', value: v ? `Version ${v.version}` : 'No drafts yet' },
                  { label: 'Updated', value: v ? new Date(v.createdAt).toLocaleDateString() : new Date(c.createdAt).toLocaleDateString() },
                  v?.ai && { label: 'Review', value: v.ai.detail, wide: true }
                ]}
              />
            )
          })}
        </CardList>
      )}
    </div>
  )
}

/**
 * The AI review's next step from a list, without opening the review (reviews run in the
 * background, several at once): Start a planned one, Continue one that stopped or paused. A
 * review ready for manual review is checked in the review itself, so it has none.
 */
export function ReviewAction({ review }: { review: ReviewSummary }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = review.ai?.state
  const label = state === 'planned' ? 'Start AI review' : state === 'paused' || state === 'stopped' || state === 'failed' ? 'Continue AI review' : null
  // Busy until the review's state moves on (the list catches up from the review's updates).
  useEffect(() => setBusy(false), [state])
  if (!label || review.original || review.closed) return null
  return (
    <button
      className={`btn sm ${state === 'planned' ? 'primary' : ''}`}
      disabled={busy}
      title={error ?? (state === 'planned' ? 'Review the parts as planned, in the background: it runs on its own until the findings are ready for manual review' : 'Go on from where it stopped')}
      onClick={async () => {
        setBusy(true)
        setError(null)
        try {
          await window.api.pipeline.continue(review.id)
        } catch (e) {
          setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
          setBusy(false)
        }
      }}
    >
      {busy ? <span className="spinner sm" /> : <Icon name="sparkle" size={13} />} {error ? 'Couldn’t start' : label}
    </button>
  )
}

/** Where a draft's AI review stands, in a word (for a card's title). */
export function StatePill({ state }: { state?: ReviewState }) {
  if (!state) return null
  return (
    <span className={`rs-pill ${state.state}`}>
      {(state.state === 'planning' || state.state === 'reviewing') && <span className="spinner tl-spin" />}
      {state.label}
    </span>
  )
}
