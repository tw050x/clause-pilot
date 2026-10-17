import { useState } from 'react'
import type { AiAction, AiAnswerPart, ReviewSession } from '@shared/types'
import { ourText } from '@shared/changes'
import { diffSegments } from '@shared/diff'
import { Markdown } from './Markdown'
import { Redline } from './Redline'
import { Icon } from '../lib/icons'

/**
 * An AI answer: its text, and a card per finding with a verdict, a link to the paragraphs it is
 * about, and what can be done (the suggested wording, shown as a redline against the paragraph
 * as it stands, to apply as our edit; a comment to add). Shown on the AI card in the review
 * column and in Ask AI.
 */
export function AiAnswer({
  parts,
  session,
  onChange,
  onShow
}: {
  parts: AiAnswerPart[]
  session: ReviewSession
  onChange: (s: ReviewSession) => void
  /** Point at these paragraphs in the document. */
  onShow: (blockIds: string[]) => void
}) {
  return (
    <div className="ai-answer">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <Markdown key={i} text={p.markdown} />
        ) : (
          <div key={i} className={`ai-finding ${p.tone}`}>
            <div className="ai-finding-head">
              <strong>{p.title}</strong>
              <span className={`ai-verdict ${p.tone}`}>{p.verdict}</span>
            </div>
            {p.where && (
              <button className="msg-link ai-where" onClick={() => onShow(p.where!.blockIds)} title="Show in the document">
                <Icon name="link" size={12} /> {p.where.label === p.title ? 'Show in the document' : p.where.label}
              </button>
            )}
            {p.body && <Markdown text={p.body} />}
            {p.actions.map((a, n) => (
              <Action key={n} action={a} session={session} onChange={onChange} />
            ))}
          </div>
        )
      )}
    </div>
  )
}

const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

function Action({ action: a, session, onChange }: { action: AiAction; session: ReviewSession; onChange: (s: ReviewSession) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const d = session.doc!
  const b = d.blocks.find((x) => x.id === a.blockId)
  if (!b) return null
  const now = ourText(d, b)
  const done = a.type === 'apply-wording' ? now === tidy(a.text) : d.comments.some((c) => c.blockId === a.blockId && tidy(c.text) === tidy(a.text))
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      onChange(a.type === 'apply-wording' ? await window.api.doc.edit(session.id, a.blockId, a.text) : await window.api.doc.comment(session.id, { blockId: a.blockId, quote: '', text: a.text }))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ai-action">
      <div className="ai-action-label">{a.type === 'apply-wording' ? `${a.label ?? 'Suggested wording'} for ${a.where}` : `Suggested comment to them on ${a.where}`}</div>
      <div className="ai-action-text rl-ours">{a.type === 'apply-wording' && !done ? <Proposed now={now} next={a.text} /> : a.text}</div>
      <div className="ai-action-foot">
        {done ? (
          <span className="ai-done">
            <Icon name="check" size={13} stroke={2.4} /> {a.type === 'apply-wording' ? `Applied to ${a.where}` : 'Comment added'}
          </span>
        ) : (
          <button className="btn sm primary" disabled={busy} onClick={run}>
            {a.type === 'apply-wording' ? `Apply to ${a.where}` : 'Add comment'}
          </button>
        )}
        {error && <span className="dr-small dr-err">{error}</span>}
      </div>
    </div>
  )
}

/**
 * Suggested wording against the paragraph as it stands: a word-level redline when it is an edit,
 * or the new wording on its own when most of the paragraph is rewritten (a redline striking
 * nearly everything is harder to read than the wording itself).
 */
function Proposed({ now, next }: { now: string; next: string }) {
  const segments = diffSegments(now, next, undefined, true)
  const kept = segments.filter((x) => x.op === 'same').reduce((n, x) => n + x.text.length, 0)
  if (kept < next.length * 0.4) return <>{next}</>
  return <Redline segments={segments} />
}
