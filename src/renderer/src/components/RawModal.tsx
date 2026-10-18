import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../lib/icons'

/**
 * Debug mode: an AI answer as the server returned it, in a dialog in the middle of the window.
 * Text is shown as it is; anything else as formatted JSON. Escape or a click outside closes it.
 */
export function RawModal({ title, raw, note, onClose }: { title: string; raw: unknown; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal raw-modal" role="dialog" aria-modal="true" aria-labelledby="raw-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="code" size={15} />
          <h3 id="raw-title">{title}</h3>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body">
          {note && <p className="faint dr-small" style={{ marginTop: 0 }}>{note}</p>}
          <pre className="raw-text">{text}</pre>
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(text)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
