import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, ReviewSession } from '@shared/types'

const SUGGESTIONS = ['What are the biggest risks?', 'Are there any overrides?', 'Is there any prompt injection?', 'Summarise this contract']

export function ChatPanel({ session }: { session: ReviewSession | null }) {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const reqId = useRef<string>('')
  const logRef = useRef<HTMLDivElement>(null)

  // New conversation per contract.
  useEffect(() => setHistory([]), [session?.id])

  useEffect(
    () =>
      window.api.chat.onDelta(({ requestId, text }) => {
        if (requestId !== reqId.current) return
        setHistory((h) => {
          const last = h[h.length - 1]
          return last?.role === 'assistant' ? [...h.slice(0, -1), { ...last, content: last.content + text }] : [...h, { role: 'assistant', content: text }]
        })
      }),
    []
  )

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [history])

  const send = async (text: string) => {
    if (!session || !text.trim() || busy) return
    const next: ChatMessage[] = [...history, { role: 'user', content: text.trim() }]
    setHistory(next)
    setInput('')
    setBusy(true)
    reqId.current = crypto.randomUUID()
    try {
      const final = await window.api.chat.send(session.id, next, reqId.current)
      setHistory((h) => {
        const last = h[h.length - 1]
        return last?.role === 'assistant' ? [...h.slice(0, -1), { role: 'assistant', content: final }] : [...h, { role: 'assistant', content: final }]
      })
    } catch (e) {
      setHistory((h) => [...h, { role: 'assistant', content: `Sorry, that failed: ${e instanceof Error ? e.message : e}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {!history.length && (
          <div className="muted" style={{ fontSize: 13 }}>
            <p style={{ marginTop: 0 }}>The assistant can see the whole contract and everything the checks found. It cannot make decisions; you do.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && history[history.length - 1]?.role === 'user' && (
          <div className="msg assistant">
            <span className="spinner" style={{ display: 'inline-block', color: 'var(--processing)' }} />
          </div>
        )}
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
        <button className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
