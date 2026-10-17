import { useEffect, useRef, useState } from 'react'
import type { AiTaskRun, ChatConversation, ChatEntry, ReviewSession } from '@shared/types'
import { Markdown } from './Markdown'
import { AiAnswer } from './AiAnswer'
import { Chevron, Icon } from '../lib/icons'

const SUGGESTIONS = ['What are the biggest risks?', 'Are there any overrides?', 'Is there any prompt injection?', 'Summarise this contract']

/**
 * Ask AI: one conversation per contract, across its versions, kept by the main process (so it
 * survives restarts). The AI cards' questions and answers are part of it. What the AI is sent is
 * managed there too: older messages are summarised once the conversation grows long.
 */
export function ChatPanel({
  session,
  onReturn,
  onShowText,
  onChange
}: {
  session: ReviewSession | null
  /** The review after an action in an answer (applying suggested wording). */
  onChange: (s: ReviewSession) => void
  /** Back to the Review tab. */
  onReturn: () => void
  /** Back to the review, with this text highlighted again (and these paragraphs within it pointed at). */
  onShowText: (blockIds: string[], quote: string, flash?: string[]) => void
}) {
  const [chat, setChat] = useState<ChatConversation | null>(null)
  /** Answers streaming in, by request id (a typed question) or run id (a card's Explain). */
  const [streams, setStreams] = useState<Record<string, string>>({})
  const [input, setInput] = useState('')
  /** A typed question waiting on its answer. */
  const [asking, setAsking] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const key = session ? (session.contractId ?? session.id) : null
  const sessionId = session?.id

  useEffect(() => {
    setChat(null)
    setClearing(false)
    if (!sessionId) return
    let live = true
    const load = () => window.api.chat.get(sessionId).then((c) => live && setChat(c))
    load()
    const off = window.api.chat.onChanged((d) => d.key === key && load())
    return () => {
      live = false
      off()
    }
  }, [sessionId, key])

  useEffect(() => window.api.chat.onDelta(({ requestId, text }) => setStreams((x) => ({ ...x, [requestId]: (x[requestId] ?? '') + text }))), [])

  const entries = chat?.entries ?? []
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries.length, streams])

  const send = async (text: string) => {
    if (!session || !text.trim() || asking) return
    setInput('')
    const requestId = crypto.randomUUID()
    setAsking(requestId)
    try {
      await window.api.chat.send(session.id, text.trim(), requestId)
    } finally {
      setAsking(null)
      setStreams((x) => {
        const { [requestId]: _, ...rest } = x
        return rest
      })
    }
  }

  const runOf = (id?: string) => (id ? session?.doc?.aiRuns?.find((r) => r.id === id) : undefined)
  const answered = new Set(entries.filter((e) => e.role === 'assistant' && e.runId).map((e) => e.runId))
  const waiting = (text?: string) => (
    <div className="msg assistant">{text ? <Markdown text={text} /> : <span className="spinner" style={{ display: 'inline-block', color: 'var(--processing)' }} />}</div>
  )

  // A card's answer, with its finding cards and actions (when it was asked in this version); anything else as Markdown.
  const answer = (e: ChatEntry) => {
    const run = runOf(e.runId)
    if (!run?.parts || !session || e.failed) return <Markdown text={e.content} />
    return <AiAnswer parts={run.parts} session={session} onChange={onChange} onShow={(ids) => onShowText(run.blockIds, run.quote, ids)} />
  }

  const last = entries[entries.length - 1]
  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {!entries.length && !asking && (
          <div className="muted" style={{ fontSize: 13 }}>
            <p style={{ marginTop: 0 }}>
              One conversation for this contract, across its versions. The assistant can see the contract as it now reads and everything the checks found. It cannot make decisions; you do.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.length > 0 && (
          <div className="chat-tools">
            {clearing ? (
              <>
                <span className="faint">Clear the whole conversation?</span>
                <button
                  className="link-btn danger-link"
                  onClick={async () => {
                    if (session) await window.api.chat.clear(session.id)
                    setClearing(false)
                  }}
                >
                  Clear
                </button>
                <button className="link-btn" onClick={() => setClearing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="link-btn" onClick={() => setClearing(true)} disabled={!!asking}>
                Clear conversation
              </button>
            )}
          </div>
        )}
        {entries.map((e, i) => {
          const prev = entries[i - 1]
          const version = e.version && prev?.version !== undefined && e.version !== prev.version ? <div className="chat-divider">Version {e.version}</div> : null
          const summarised = chat?.summary && prev?.id === chat.summary.through ? <div className="chat-divider" title="To keep each request a manageable size, the AI is sent a summary of the messages above, then the rest as written.">Earlier messages are summarised for the AI</div> : null
          return (
            <div key={e.id} className="chat-entry">
              {summarised}
              {version}
              {e.role === 'user' ? (
                <div className="msg user">{e.runId ? <CardQuestion text={e.content} run={runOf(e.runId)} onShowText={onShowText} /> : e.content}</div>
              ) : (
                // The AI's answer: in the flow of the page, not in a bubble.
                <div className={`msg assistant ${e.failed ? 'failed' : ''}`}>
                  {answer(e)}
                  {/* An answer to a card, until the conversation goes on: back to the review, where it's on the card too. */}
                  {e.runId && e === last && !asking && (
                    <button className="btn sm msg-return" onClick={onReturn}>
                      <span className="back-chevron">
                        <Chevron size={10} />
                      </span>{' '}
                      Return to review
                    </button>
                  )}
                </div>
              )}
              {/* A card's question still being answered. */}
              {e.role === 'user' && e.runId && !answered.has(e.runId) && runOf(e.runId)?.status === 'running' && waiting(streams[e.runId])}
            </div>
          )
        })}
        {asking && last?.role === 'user' && !last.runId && waiting(streams[asking])}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder="Ask a question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
        />
        <button className="btn primary" disabled={!!asking || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

/**
 * A question posted from an AI card: the question, and a link to the text it was about (rather
 * than a copy of it), which highlights that text in the review again.
 */
function CardQuestion({ text, run, onShowText }: { text: string; run?: AiTaskRun; onShowText: (blockIds: string[], quote: string) => void }) {
  const at = text.indexOf('\n\n> ')
  const question = at < 0 ? text : text.slice(0, at)
  // "Does the intent match our approved wording? (§1.3)": the places go on the link.
  const m = question.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  return (
    <>
      {m ? m[1] : question}
      {run && (
        <button className="msg-link" onClick={() => onShowText(run.blockIds, run.quote)} title="Show this text in the review, highlighted">
          <Icon name="link" size={12} /> {m ? m[2] : 'The highlighted text'}
        </button>
      )}
    </>
  )
}
