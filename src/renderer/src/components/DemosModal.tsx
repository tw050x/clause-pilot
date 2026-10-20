import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { DEMOS, type DemoId } from '@shared/demos'
import { Icon } from '../lib/icons'

/** Where the window goes once a demo has loaded (kept over the reload that follows it). */
export const DEMO_LANDING_KEY = 'clausepilot.demoLanding'

/**
 * Demo mode's dialog: the demos (each sets the app up for one thing to show, from nothing: the
 * demo workspace reset to only its clients and contracts) and the clients in the one loaded, to
 * switch between (demo mode's account picker). Until a demo is chosen it can't be closed.
 */
export function DemosModal({
  current,
  accounts,
  activeId,
  onPickAccount,
  onClose
}: {
  current: DemoId | null
  accounts: Account[]
  activeId: string | null
  onPickAccount: (id: string) => void
  onClose: () => void
}) {
  const [loading, setLoading] = useState<DemoId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closable = !!current && !loading
  useEffect(() => {
    if (!closable) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [closable, onClose])
  const load = async (id: DemoId) => {
    setLoading(id)
    setError(null)
    try {
      const landing = await window.api.demo.load(id)
      // The app starts again in that state: the window reloads, then goes where the demo starts.
      try {
        sessionStorage.setItem(DEMO_LANDING_KEY, JSON.stringify(landing))
      } catch {
        /* it opens at the Start page instead */
      }
      await window.api.demo.reload()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
      setLoading(null)
    }
  }
  return (
    <div className="modal-back" onClick={() => closable && onClose()}>
      <div className="modal demos-modal" role="dialog" aria-modal="true" aria-label="Demos" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Demos</h3>
          {closable && (
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <div className="modal-body">
          {/* The demo loaded: its clients first (to switch between), then the demos to load instead. */}
          {current && accounts.length > 0 && (
            <>
              <h4 className="demos-h first">Clients in {DEMOS.find((d) => d.id === current)?.title ?? 'this demo'}</h4>
              <div className="demos-accounts">
                {accounts.map((a) => (
                  <button key={a.id} className={`demos-account ${a.id === activeId ? 'on' : ''}`} onClick={() => onPickAccount(a.id)}>
                    <Icon name="users" size={14} /> {a.name}
                  </button>
                ))}
              </div>
              <h4 className="demos-h">Load a demo</h4>
            </>
          )}
          <p className="faint demos-lede">
            Each demo starts the app afresh with only what it needs: its clients and contracts, our clauses and playbook. Loading one replaces whatever demo was there.
          </p>
          <div className="demos-list">
            {DEMOS.map((d) => (
              <div key={d.id} className={`demos-card ${current === d.id ? 'current' : ''}`}>
                <span className="demos-icon">
                  <Icon name={d.icon} size={16} />
                </span>
                <div className="demos-body">
                  <h4>
                    {d.title}
                    {current === d.id && <span className="pill neutral">Loaded</span>}
                  </h4>
                  <p className="demos-detail">{d.detail}</p>
                  <p className="faint demos-who">{d.who}</p>
                </div>
                <button className={`btn sm ${current === d.id ? '' : 'primary'}`} disabled={!!loading} onClick={() => load(d.id)}>
                  {loading === d.id ? <span className="spinner sm" /> : null} {current === d.id ? 'Start again' : 'Load'}
                </button>
              </div>
            ))}
          </div>
          {error && <p className="dr-small dr-err">{error}</p>}
        </div>
      </div>
    </div>
  )
}
