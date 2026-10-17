import { useEffect, useState } from 'react'
import type { Account, ContractRecord } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * Before a file is opened in live mode: which of the active client's contracts
 * is it a draft of (or is it a new contract)? A new draft of an existing
 * contract is compared with its latest version.
 */
export function OpenContractModal({
  account,
  initialContractId,
  onOpen,
  onClose
}: {
  account: Account
  initialContractId?: string
  onOpen: (path: string, contractId: string) => void
  onClose: () => void
}) {
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [contractId, setContractId] = useState<string>('new')
  const [newContract, setNewContract] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.contracts.list().then((all) => {
      const mine = all.filter((c) => c.accountId === account.id)
      setContracts(mine)
      setContractId(mine.find((c) => c.id === initialContractId)?.id ?? mine[0]?.id ?? 'new')
    })
  }, [account.id, initialContractId])

  const ready = contractId !== 'new' || newContract.trim()
  const existing = contracts.find((c) => c.id === contractId)

  const choose = async () => {
    setError(null)
    try {
      const cid = contractId === 'new' ? (await window.api.contracts.create(account.id, newContract)).id : contractId
      const path = await window.api.file.open()
      if (path) onOpen(path, cid)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="upload" />
          <h3>Open a contract for {account.name}</h3>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
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
                ? 'It will be compared with what we sent back for the latest version, so you see only what changed, tracked or not.'
                : 'The first version of a new contract is reviewed in full.'}
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
          <button className="btn primary" disabled={!ready} onClick={choose}>
            Choose file… <Icon name="next" />
          </button>
        </div>
      </div>
    </div>
  )
}
