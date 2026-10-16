import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * Overlay for choosing the active account: search, arrow keys, Enter to pick,
 * Esc to close. "All accounts" clears the selection. In live mode a search
 * with no match offers to create the account.
 */
export function AccountPicker({
  accounts,
  activeId,
  canCreate,
  onPick,
  onCreate,
  onClose
}: {
  accounts: Account[]
  activeId: string | null
  canCreate: boolean
  onPick: (id: string | null) => void
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  type Option = { kind: 'all' } | { kind: 'account'; account: Account } | { kind: 'create'; name: string }
  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLowerCase()
    const matches = accounts.filter((a) => !term || a.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name))
    const out: Option[] = []
    if (!term) out.push({ kind: 'all' })
    out.push(...matches.map((account) => ({ kind: 'account' as const, account })))
    if (canCreate && term && !accounts.some((a) => a.name.toLowerCase() === term)) out.push({ kind: 'create', name: q.trim() })
    return out
  }, [q, accounts, canCreate])

  useEffect(() => setCursor(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (o: Option | undefined) => {
    if (!o) return
    if (o.kind === 'all') onPick(null)
    else if (o.kind === 'account') onPick(o.account.id)
    else onCreate(o.name)
  }

  return (
    <div className="modal-back picker-back" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose account">
        <div className="picker-search">
          <Icon name="users" />
          <input
            autoFocus
            value={q}
            placeholder="Search accounts…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, options.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') choose(options[cursor])
              else if (e.key === 'Escape') onClose()
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="picker-list" ref={listRef}>
          {options.map((o, i) => {
            const active = o.kind === 'all' ? activeId === null : o.kind === 'account' ? o.account.id === activeId : false
            return (
              <button
                key={o.kind === 'account' ? o.account.id : o.kind}
                data-i={i}
                className={`picker-item ${i === cursor ? 'cursor' : ''}`}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(o)}
              >
                {o.kind === 'all' && <span className="muted">All accounts</span>}
                {o.kind === 'account' && <span>{o.account.name}</span>}
                {o.kind === 'create' && (
                  <span>
                    + Create account “<b>{o.name}</b>”
                  </span>
                )}
                {active && <Icon name="check" size={14} />}
              </button>
            )
          })}
          {!options.length && <p className="faint picker-empty">No accounts match “{q}”.</p>}
        </div>
      </div>
    </div>
  )
}
