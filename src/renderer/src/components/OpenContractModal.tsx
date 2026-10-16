import { useEffect, useState } from 'react'
import type { Account, ContractRecord } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * Before a contract is opened in live mode: which client is it for, and is it a
 * new contract or a new draft of one we've already reviewed? A new draft is
 * compared with the previous version, so settled clauses don't need reading again.
 */
export function OpenContractModal({
  initialContractId,
  initialAccountId,
  onOpen,
  onClose
}: {
  initialContractId?: string
  /** Pre-selects this account (the active account) when no contract is given. */
  initialAccountId?: string | null
  onOpen: (path: string, contractId: string) => void
  onClose: () => void
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [accountId, setAccountId] = useState<string>('')
  const [newAccount, setNewAccount] = useState('')
  const [contractId, setContractId] = useState<string>('')
  const [newContract, setNewContract] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.api.accounts.list(), window.api.contracts.list()]).then(([a, c]) => {
      setAccounts(a)
      setContracts(c)
      const initial = c.find((x) => x.id === initialContractId)
      const preferred = a.find((x) => x.id === initialAccountId)?.id
      setAccountId(initial?.accountId ?? preferred ?? a[0]?.id ?? 'new')
      setContractId(initial?.id ?? 'new')
    })
  }, [initialContractId])

  const forAccount = contracts.filter((c) => c.accountId === accountId)
  useEffect(() => {
    if (contractId !== 'new' && !forAccount.some((c) => c.id === contractId)) setContractId(forAccount[0]?.id ?? 'new')
  }, [accountId, contracts.length])

  const ready = (accountId !== 'new' || newAccount.trim()) && (contractId !== 'new' || newContract.trim())

  const choose = async () => {
    setError(null)
    try {
      let aid = accountId
      if (aid === 'new') aid = (await window.api.accounts.create(newAccount)).id
      let cid = contractId
      if (cid === 'new') cid = (await window.api.contracts.create(aid, newContract)).id
      const path = await window.api.file.open()
      if (path) onOpen(path, cid)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  const existing = contracts.find((c) => c.id === contractId)

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="upload" />
          <h3>Open a contract</h3>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ maxWidth: 'none' }}>
            <label>Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="new">+ New account…</option>
            </select>
            {accountId === 'new' && <input autoFocus placeholder="Client name, e.g. Acme Corporation" value={newAccount} onChange={(e) => setNewAccount(e.target.value)} />}
          </div>
          <div className="field" style={{ maxWidth: 'none' }}>
            <label>Contract</label>
            <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
              {forAccount.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} (new draft)
                </option>
              ))}
              <option value="new">+ New contract…</option>
            </select>
            {contractId === 'new' && <input placeholder="e.g. Mutual NDA" value={newContract} onChange={(e) => setNewContract(e.target.value)} />}
            <span className="hint">
              {existing
                ? 'It will be compared with the latest version of this contract: clauses you settled last time are skipped, and you’ll see what changed.'
                : 'The first version of a new contract is reviewed in full.'}
            </span>
          </div>
          <p className="upload-note" style={{ marginTop: 0 }}>
            Needs an Anthropic API key (Settings). The contract’s text is sent to Anthropic’s API for the AI checks, so only open documents you’re allowed to share outside the company.
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
