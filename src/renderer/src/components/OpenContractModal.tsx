import { useEffect, useState } from 'react'
import type { Account, ContractRecord, DraftOrigin, DraftProbe } from '@shared/types'
import { Icon } from '../lib/icons'

const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * Before a file is opened in live mode: which of the active client's contracts
 * is it a draft of (or is it a new contract)? A new draft of an existing
 * contract is compared with its latest version. A first draft asks where it
 * started: ours (ideally with the original we sent, to compare it with exactly)
 * or theirs.
 */
export function OpenContractModal({
  account,
  initialContractId,
  onOpen,
  onClose
}: {
  account: Account
  initialContractId?: string
  onOpen: (path: string, contractId: string, origin?: DraftOrigin) => void
  onClose: () => void
}) {
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [contractId, setContractId] = useState<string>('new')
  const [newContract, setNewContract] = useState('')
  const [error, setError] = useState<string | null>(null)
  // A first draft, chosen: where it started.
  const [draft, setDraft] = useState<{ path: string; probe: DraftProbe } | null>(null)
  const [origin, setOrigin] = useState<DraftOrigin['kind']>('theirs')
  const [original, setOriginal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.contracts.list().then((all) => {
      const mine = all.filter((c) => c.accountId === account.id)
      setContracts(mine)
      setContractId(mine.find((c) => c.id === initialContractId)?.id ?? mine[0]?.id ?? 'new')
    })
  }, [account.id, initialContractId])

  const ready = contractId !== 'new' || newContract.trim()
  const existing = contracts.find((c) => c.id === contractId)

  const open = async (path: string, how?: DraftOrigin) => {
    const cid = contractId === 'new' ? (await window.api.contracts.create(account.id, newContract)).id : contractId
    onOpen(path, cid, how)
  }

  const choose = async () => {
    setError(null)
    try {
      const path = await window.api.file.open()
      if (!path) return
      // A later draft is compared with what we sent back for the last version.
      const first = !existing || !(await window.api.contracts.versions(existing.id)).length
      if (!first) return open(path)
      setBusy(true)
      const probe = await window.api.review.probe(path)
      setDraft({ path, probe })
      setOrigin(probe.looksOurs ? 'original' : 'theirs')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const chooseOriginal = async () => {
    setError(null)
    const path = await window.api.file.open()
    if (path) setOriginal(path)
  }

  const start = async () => {
    if (!draft) return
    setError(null)
    try {
      await open(draft.path, origin === 'original' ? { kind: 'original', path: original! } : { kind: origin })
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(600px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="upload" />
          <h3>Open a contract for {account.name}</h3>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {!draft ? (
          <>
            <div className="modal-body">
              <div className="field" style={{ maxWidth: 'none' }}>
                <label>Contract</label>
                <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} (new draft)
                    </option>
                  ))}
                  <option value="new">+ New contract…</option>
                </select>
                {contractId === 'new' && <input autoFocus placeholder="e.g. Mutual NDA" value={newContract} onChange={(e) => setNewContract(e.target.value)} />}
                <span className="hint">
                  {existing
                    ? 'A new draft is compared with what we sent back for the latest version, so you see only what changed, tracked or not.'
                    : 'For the first draft you’ll be asked where it started: from us, or from them.'}
                </span>
              </div>
              <p className="upload-note" style={{ marginTop: 0 }}>
                Reviewing works without AI. When you ask the AI about something, the contract’s text is sent to the AI set in Settings (Claude, or your vLLM server), so only open documents you’re allowed to share with it.
              </p>
              {error && <div className="banner danger">{error}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={!ready || busy} onClick={choose}>
                {busy ? 'Reading…' : 'Choose file…'} <Icon name="next" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="field" style={{ maxWidth: 'none' }}>
                <label>Where did this draft start?</label>
                <span className="hint" style={{ marginTop: 0 }}>
                  {fileName(draft.path)}:{' '}
                  {draft.probe.paragraphs
                    ? `${draft.probe.approved} of ${draft.probe.paragraphs} paragraphs are word for word our approved wording${draft.probe.looksOurs ? ', so it looks like ours.' : '.'}`
                    : 'no paragraphs long enough to compare with our approved wording.'}{' '}
                  Common clauses can match even on their paper, so say which it is.
                </span>
                <div className="choice-list" style={{ marginTop: 6 }}>
                  <label className={`choice ${origin === 'original' ? 'on' : ''}`}>
                    <input type="radio" name="origin" checked={origin === 'original'} onChange={() => setOrigin('original')} />
                    <span>
                      <strong>Ours, and I have the original we sent</strong>
                      <span className="faint">Their draft is compared with it exactly: anything they changed shows, tracked or not. The original is kept with the contract.</span>
                      {origin === 'original' && (
                        <span className="row-gap" style={{ marginTop: 4 }}>
                          <button className="btn sm" onClick={chooseOriginal}>
                            <Icon name="upload" size={13} /> {original ? 'Choose another…' : 'Choose the original…'}
                          </button>
                          {original && <span className="dr-small">{fileName(original)}</span>}
                        </span>
                      )}
                    </span>
                  </label>
                  <label className={`choice ${origin === 'ours' ? 'on' : ''}`}>
                    <input type="radio" name="origin" checked={origin === 'ours'} onChange={() => setOrigin('ours')} />
                    <span>
                      <strong>Ours, but I don’t have the original</strong>
                      <span className="faint">
                        Compared with our approved clauses instead. A paragraph close to one of ours shows how it differs, as if they had changed it, which may not be so if we sent other wording.
                      </span>
                    </span>
                  </label>
                  <label className={`choice ${origin === 'theirs' ? 'on' : ''}`}>
                    <input type="radio" name="origin" checked={origin === 'theirs'} onChange={() => setOrigin('theirs')} />
                    <span>
                      <strong>Theirs</strong>
                      <span className="faint">
                        Nothing is assumed to be ours. Paragraphs that are word for word our approved wording are marked; for the rest you can compare with our closest clauses, or ask the AI whether they mean the same.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              {error && <div className="banner danger">{error}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDraft(null)}>
                Back
              </button>
              <button className="btn primary" disabled={origin === 'original' && !original} onClick={start}>
                Open review <Icon name="next" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
