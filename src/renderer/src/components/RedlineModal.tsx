import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { RedlineComment, RedlineStats, ReviewSession } from '@shared/types'
import { Icon } from '../lib/icons'
import { highlightText } from '../lib/highlight'

const PAGE_WIDTH = 794 // A4 at 96 dpi

/**
 * The marked-up copy we send back: their contract with our changes as Word
 * tracked changes and our reasons as comments. Previewed here as Word lays it
 * out, then saved as a .docx to attach to the email.
 */
export function RedlineModal({ session, onClose }: { session: ReviewSession; onClose: () => void }) {
  const pages = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [built, setBuilt] = useState<{ stats: RedlineStats; comments: RedlineComment[]; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.redline.preview(session.id).then(
      async ({ bytes, stats, comments, name }) => {
        if (cancelled || !pages.current) return
        await renderAsync(bytes, pages.current, undefined, { inWrapper: true, breakPages: true, renderChanges: true, renderComments: false, className: 'docx' })
        pages.current.querySelectorAll('a').forEach((a) => a.removeAttribute('href'))
        const avail = (viewport.current?.clientWidth ?? PAGE_WIDTH) - 32
        pages.current.style.zoom = String(Math.min(1, avail / PAGE_WIDTH))
        setBuilt({ stats, comments, name })
      },
      (e) => setError(String(e))
    )
    return () => {
      cancelled = true
    }
  }, [session.id])

  // Scroll the preview to a clause and mark it (the text matched as in the original-document view).
  const show = (quote: string) => {
    const host = pages.current
    if (!host || !quote) return
    host.querySelectorAll('mark.orig-hl').forEach((m) => m.replaceWith(...Array.from(m.childNodes)))
    highlightText(host, quote)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const s = built?.stats
  const parts = s
    ? [
        s.replaced && `${s.replaced} ${session.doc ? 'paragraph' : 'clause'}${s.replaced === 1 ? '' : 's'} reworded`,
        s.removed && `${s.removed} struck out`,
        s.reinstated && `${s.reinstated} reinstated`,
        s.commentedOnly && `${s.commentedOnly} comment-only`,
        s.acceptedChanges && `their changes accepted in ${s.acceptedChanges} ${session.doc ? 'place' : 'clause'}${s.acceptedChanges === 1 ? '' : 's'}`
      ].filter(Boolean)
    : []

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal redline-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="doc" />
          <h3>Marked-up copy</h3>
          {built && <span className="faint" style={{ fontSize: 12.5 }}>{built.name}</span>}
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="redline-body">
          <div className="redline-pages" ref={viewport}>
            {!built && !error && (
              <div className="row-gap muted" style={{ padding: 16 }}>
                <span className="spinner" style={{ color: 'var(--processing)' }} /> Marking up the contract…
              </div>
            )}
            {error && <div className="banner danger" style={{ margin: 16 }}>{error}</div>}
            <div className="orig-pages" ref={pages} />
          </div>
          <aside className="redline-side">
            {s && (
              <>
                <p style={{ margin: 0 }}>
                  {parts.length ? `${parts.join(' · ')}.` : 'No changes from us.'} Our edits are tracked changes in your name, so they can accept or reject each one in Word.
                </p>
                {s.source === 'generated' && (
                  <div className="banner info">
                    <Icon name="alert" /> They sent a {session.sourceType.toUpperCase()}, so this copy is built from its text. The wording matches; the layout won’t.
                  </div>
                )}
                {s.unmatched.length > 0 && (
                  <div className="banner danger">
                    <Icon name="alert" /> Couldn’t place {s.unmatched.join(', ')} in the document. Those points are in the email only.
                  </div>
                )}
                <h4>Comments ({built.comments.length})</h4>
                {built.comments.map((c, i) => (
                  <button key={i} className="redline-comment" onClick={() => show(c.quote)} title="Show in the document">
                    <div className="faint">{c.where}</div>
                    {c.replyTo && (
                      <div className="redline-their">
                        <strong>{c.replyTo.author}:</strong> {c.replyTo.text}
                      </div>
                    )}
                    <div>
                      {c.replyTo && <span className="faint">↳ </span>}
                      {c.text}
                    </div>
                  </button>
                ))}
              </>
            )}
          </aside>
        </div>
        <div className="modal-foot">
          {saved && (
            <span className="faint" style={{ marginRight: 'auto', fontSize: 12.5, alignSelf: 'center', wordBreak: 'break-all' }}>
              Saved to {saved} ·{' '}
              <button className="link-btn" onClick={() => window.api.redline.open(saved)}>
                Open
              </button>
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={!built}
            onClick={async () => {
              const p = await window.api.redline.save(session.id).catch((e) => {
                setError(String(e))
                return null
              })
              if (p) setSaved(p)
            }}
          >
            <Icon name="doc" /> Save .docx…
          </button>
        </div>
      </div>
    </div>
  )
}
