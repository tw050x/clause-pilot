import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, ReviewSession } from '@shared/types'
import { Markdown } from './Markdown'
import { Chevron } from '../lib/icons'

/** A message as shown: from a card, an assistant message waits for its AI task (`runId`). */
type Shown = ChatMessage & { runId?: string; pending?: boolean }

/** A question posted from an AI card in the review column: the task is already running. */
export interface ChatInject {
  runId: string
  question: string
}

const SUGGESTIONS = ['What are the biggest risks?', 'Are there any overrides?', 'Is there any prompt injection?', 'Summarise this contract']

export function ChatPanel({ session, inject, onReturn }: { session: ReviewSession | null; inject: ChatInject | null; onReturn: () => void }) {
  const [history, setHistory] = useState<Shown[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const reqId = useRef<string>('')
  const logRef = useRef<HTMLDivElement>(null)

  // New conversation per contract.
  useEffect(() => setHistory([]), [session?.id])

  useEffect(
    () =>
      window.api.chat.onDelta(({ requestId, text }) => {
        setHistory((h) => {
          // An answer streaming for a card's task (Explain).
          const i = h.findIndex((m) => m.runId === requestId && m.pending)
          if (i >= 0) return h.map((m, n) => (n === i ? { ...m, content: m.content + text } : m))
          if (requestId !== reqId.current) return h
          const last = h[h.length - 1]
          return last?.role === 'assistant' ? [...h.slice(0, -1), { ...last, content: last.content + text }] : [...h, { role: 'assistant', content: text }]
        })
      }),
    []
  )

  // A card's question: posted as asked, with its answer to follow from the task.
  useEffect(() => {
    if (!inject) return
    setHistory((h) => (h.some((m) => m.runId === inject.runId) ? h : [...h, { role: 'user', content: inject.question }, { role: 'assistant', content: '', runId: inject.runId, pending: true }]))
  }, [inject])

  // The task's answer, as written from the server's response, once it's in.
  useEffect(() => {
    const runs = session?.doc?.aiRuns ?? []
    setHistory((h) =>
      h.some((m) => m.pending)
        ? h.map((m) => {
            const r = m.pending ? runs.find((x) => x.id === m.runId) : undefined
            if (!r || r.status === 'running') return m
            return { ...m, pending: false, content: r.status === 'done' ? (r.answer ?? '') : `Sorry, that failed: ${r.error}` }
          })
        : h
    )
  }, [session])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [history])

  const send = async (text: string) => {
    if (!session || !text.trim() || busy) return
    const next: Shown[] = [...history, { role: 'user', content: text.trim() }]
    setHistory(next)
    setInput('')
    setBusy(true)
    reqId.current = crypto.randomUUID()
    try {
      // The conversation so far, including the cards' questions and answers, as context.
      const context = next.filter((m) => !m.pending && m.content.trim()).map(({ role, content }) => ({ role, content }))
      const final = await window.api.chat.send(session.id, context, reqId.current)
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
        {history.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg user">
              <UserText text={m.content} />
            </div>
          ) : (
            // The AI's answer: Markdown, in the flow of the page, not in a bubble.
            <div key={i} className="msg assistant">
              {m.pending && !m.content ? <span className="spinner" style={{ display: 'inline-block', color: 'var(--processing)' }} /> : <Markdown text={m.content} />}
              {/* An answer to a card: back to the review, where it's on the card too. */}
              {m.runId && !m.pending && (
                <button className="btn sm msg-return" onClick={onReturn}>
                  <span className="back-chevron">
                    <Chevron size={10} />
                  </span>{' '}
                  Return to review
                </button>
              )}
            </div>
          )
        )}
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

/** Your message; a quoted passage (from a card: "> the highlighted text") is set off below it. */
function UserText({ text }: { text: string }) {
  const at = text.indexOf('\n\n> ')
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <div className="msg-quote">{text.slice(at + 4)}</div>
    </>
  )
}
