import { useEffect, useState } from 'react'
import type { ContractType, PlaybookPosition } from '@shared/types'
import { PositionForm } from '../views/PlaybookView'
import { Icon } from '../lib/icons'

/** A dialog in the middle of the window: Escape or a click outside closes it. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal setup-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

const TYPES: { id: ContractType; label: string }[] = [
  { id: 'nda', label: 'NDA' },
  { id: 'order-form', label: 'Order form' },
  { id: 'general', label: 'Any contract' }
]

/**
 * Add a clause to the library by hand: our approved wording for a topic, which contracts are
 * compared with. Added as approved by the reviewer adding it.
 */
export function AddClauseModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<ContractType>('nda')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.kb.addClause({ title, category, contractType: type, text })
      onAdded()
      onClose()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Add a clause to the library" onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        Our approved wording for a topic. Contracts are compared with it: wording that matches it word for word needs no reading, and the AI checks whether anything else means the same.
      </p>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Governing law" autoFocus />
      </div>
      <div className="row-gap" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Boilerplate" />
        </div>
        <div className="field">
          <label>Contract type</label>
          <select value={type} onChange={(e) => setType(e.target.value as ContractType)}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Wording</label>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="The clause exactly as we approve it (without its number)" />
      </div>
      {error && <p className="dr-small dr-err">{error}</p>}
      <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !title.trim() || !text.trim()} onClick={add}>
          Add to the library
        </button>
      </div>
    </Modal>
  )
}

/**
 * Add a position to the playbook by hand: proposed, as on the Playbook page, and in the playbook
 * once approved (on the Approvals page).
 */
export function AddPositionModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const submit = async (after: PlaybookPosition, reason: string) => {
    setError(null)
    try {
      await window.api.kb.proposePlaybook({ kind: 'add', positionId: null, after, reason })
      onAdded()
      onClose()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    }
  }
  return (
    <Modal title="Add to the playbook" onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        Our standard position on a topic, what we can accept instead, and the red flags. Every contract is checked against it. It’s sent for approval and joins the playbook once approved.
      </p>
      <PositionForm onCancel={onClose} onSubmit={submit} />
      {error && <p className="dr-small dr-err">{error}</p>}
    </Modal>
  )
}
