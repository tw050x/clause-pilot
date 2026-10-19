import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account } from '@shared/types'
import { Icon } from '../lib/icons'

/**
 * Overlay for choosing the active account: search, arrow keys, Enter to pick,
 * Esc to close. You always work on one account at a time. "+ New account" is always
 * at the bottom: with a name typed it creates that account; without one it asks for the name.
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
  onPick: (id: string) => void
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // "+ New account" pressed with nothing typed: the search box asks for the client's name.
  const [naming, setNaming] = useState(false)

  type Option = { kind: 'account'; account: Account } | { kind: 'create'; name: string }
  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLowerCase()
    // Naming a new account (after "+ New account"): only that, so Enter creates it rather than
    // picking an existing account whose name contains what was typed.
    const matches = naming ? [] : accounts.filter((a) => !term || a.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name))
    const out: Option[] = []
    out.push(...matches.map((account) => ({ kind: 'account' as const, account })))
    if (canCreate && !accounts.some((a) => a.name.toLowerCase() === term)) out.push({ kind: 'create', name: q.trim() })
    return out
  }, [q, accounts, canCreate, naming])

  useEffect(() => setCursor(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (o: Option | undefined) => {
    if (!o) return
    if (o.kind === 'account') onPick(o.account.id)
    else if (o.name) onCreate(o.name)
    else {
      setNaming(true)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="modal-back picker-back" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose account">
        <div className="picker-search">
          <Icon name="users" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            placeholder={naming ? 'The client’s name, then Enter' : canCreate ? 'Search or create an account…' : 'Search accounts…'}
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
          {!options.some((o) => o.kind === 'account') && (
            <p className="faint picker-empty">{accounts.length ? `No accounts match “${q}”.` : canCreate ? 'No accounts yet. Type a client’s name to create one.' : 'No accounts.'}</p>
          )}
          {options.map((o, i) => {
            const active = o.kind === 'account' && o.account.id === activeId
            return (
              <button
                key={o.kind === 'account' ? o.account.id : 'create'}
                data-i={i}
                className={`picker-item ${o.kind === 'create' ? 'create' : ''} ${i === cursor ? 'cursor' : ''}`}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(o)}
              >
                {o.kind === 'account' && <span>{o.account.name}</span>}
                {o.kind === 'create' && (
                  <span className="picker-create">
                    {o.name ? (
                      <>
                        + Create account “<b>{o.name}</b>”
                      </>
                    ) : (
                      '+ New account'
                    )}
                  </span>
                )}
                {active && <Icon name="check" size={14} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
