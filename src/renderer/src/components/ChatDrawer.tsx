import { useEffect, useRef, useState } from 'react'
import type { ChatConversation, ReviewSession } from '@shared/types'
import { Markdown } from './Markdown'

const SUGGESTIONS = ['What are the biggest risks?', 'Are there any overrides?', 'Is there any prompt injection?', 'Summarise this contract']

/**
 * The Agent: one conversation per contract, across its versions, kept by the main process (so it
 * survives restarts). The AI cards in the review column are separate: their answers stay on the
 * cards, and reach the conversation only as part of the review state the AI is sent. What the AI
 * is sent is managed in the main process: older messages are summarised once the conversation grows long.
 */
export function ChatPanel({ session }: { session: ReviewSession | null }) {
  const [chat, setChat] = useState<ChatConversation | null>(null)
  /** Answers streaming in, by request id. */
  const [streams, setStreams] = useState<Record<string, string>>({})
  const [input, setInput] = useState('')
  /** A question waiting on its answer. */
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
  /** Requests whose model is thinking before it answers. */
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  useEffect(() => window.api.chat.onThinking(({ requestId }) => setThinking((x) => new Set([...x, requestId]))), [])

  // AI card questions saved here by earlier versions of the app are left out: they live on the cards.
  const entries = (chat?.entries ?? []).filter((e) => !e.runId)
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries.length, streams])

  const send = async (text: string, again = false) => {
    if (!session || !text.trim() || asking) return
    if (!again) setInput('')
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

  const waiting = (id: string) => (
    <div className="msg assistant">
      {streams[id] ? (
        <Markdown text={streams[id]} />
      ) : (
        <span className="chat-waiting">
          <span className="spinner" style={{ display: 'inline-block', color: 'var(--processing)' }} />
          {thinking.has(id) && <span className="faint">Thinking…</span>}
        </span>
      )}
    </div>
  )

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
                <div className="msg user">{e.content}</div>
              ) : (
                // The AI's answer: in the flow of the page, not in a bubble.
                <div className={`msg assistant ${e.failed || !e.content.trim() ? 'failed' : ''}`}>
                  {/* An empty answer (saved before empty answers were caught): say so. */}
                  {e.content.trim() ? <Markdown text={e.content} /> : <p>No answer came back from the AI.</p>}
                  {/* A failed answer to the latest question: ask it again. */}
                  {(e.failed || !e.content.trim()) && e === last && prev?.role === 'user' && (
                    <button className="btn sm msg-again" disabled={!!asking} onClick={() => send(prev.content, true)}>
                      Ask again
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {asking && last?.role === 'user' && waiting(asking)}
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
