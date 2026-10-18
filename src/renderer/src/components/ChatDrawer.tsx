import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AiTaskRun, ChatConversation, ChatEntry, ReviewSession } from '@shared/types'
import { Markdown } from './Markdown'
import { AiAnswer } from './AiAnswer'
import { Chevron, Icon } from '../lib/icons'

const SUGGESTIONS = ['What are the biggest risks?', 'Are there any overrides?', 'Is there any prompt injection?', 'Summarise this contract']

/**
 * Ask AI: one conversation per contract, across its versions, kept by the main process (so it
 * survives restarts). The AI cards' questions and answers show here too, but each is a one-off:
 * not part of the conversation unless a question follows it up (Ask a follow-up). What the AI is
 * sent is managed in the main process: older messages are summarised once the conversation grows long.
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
  /** AI card exchanges shown open (the rest are folded). */
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set())
  /** The AI card answer the next question follows up (its run id). */
  const [followUp, setFollowUp] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const key = session ? (session.contractId ?? session.id) : null
  const sessionId = session?.id

  useEffect(() => {
    setChat(null)
    setClearing(false)
    setFollowUp(null)
    setOpenRuns(new Set())
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
  // A card asked now (still running) shows open; earlier ones are folded.
  const runningIds = entries.filter((e) => e.role === 'user' && e.runId && session?.doc?.aiRuns?.find((r) => r.id === e.runId)?.status === 'running').map((e) => e.runId!)
  const runningKey = runningIds.join(',')
  useEffect(() => {
    if (runningIds.length) setOpenRuns((x) => (runningIds.every((id) => x.has(id)) ? x : new Set([...x, ...runningIds])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningKey])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries.length, streams])

  const send = async (text: string) => {
    if (!session || !text.trim() || asking) return
    setInput('')
    const about = followUp ?? undefined
    setFollowUp(null)
    const requestId = crypto.randomUUID()
    setAsking(requestId)
    try {
      await window.api.chat.send(session.id, text.trim(), requestId, about)
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

  // A card's question without its quote: "Does this meet our playbook? (§2.4)".
  const questionOf = (runId: string) => (entries.find((x) => x.runId === runId && x.role === 'user')?.content ?? '').split('\n\n> ')[0]

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
          // A card's answer is shown in its question's fold.
          if (e.role === 'assistant' && e.runId) return null
          const prev = entries[i - 1]
          const version = e.version && prev?.version !== undefined && e.version !== prev.version ? <div className="chat-divider">Version {e.version}</div> : null
          const summarised = chat?.summary && prev?.id === chat.summary.through ? <div className="chat-divider" title="To keep each request a manageable size, the AI is sent a summary of the messages above, then the rest as written.">Earlier messages are summarised for the AI</div> : null
          const reply = e.runId ? entries.find((x) => x.role === 'assistant' && x.runId === e.runId) : undefined
          return (
            <div key={e.id} className="chat-entry">
              {summarised}
              {version}
              {e.runId ? (
                <TaskFold
                  question={e}
                  reply={reply}
                  run={runOf(e.runId)}
                  open={openRuns.has(e.runId)}
                  onOpen={(on) =>
                    setOpenRuns((x) => {
                      const n = new Set(x)
                      if (on) n.add(e.runId!)
                      else n.delete(e.runId!)
                      return n
                    })
                  }
                  pending={!reply && runOf(e.runId)?.status === 'running' ? waiting(streams[e.runId]) : null}
                  answer={reply ? answer(reply) : null}
                  following={followUp === e.runId}
                  onFollowUp={() => {
                    setFollowUp(e.runId!)
                    inputRef.current?.focus()
                  }}
                  onShowText={onShowText}
                />
              ) : e.role === 'user' ? (
                <div className="msg user">
                  {e.about && <FollowedUp text={questionOf(e.about)} />}
                  {e.content}
                </div>
              ) : (
                // The AI's answer: in the flow of the page, not in a bubble.
                <div className={`msg assistant ${e.failed ? 'failed' : ''}`}>{answer(e)}</div>
              )}
              {/* A card's answer, until the conversation goes on: back to the review, where it's on the card too. */}
              {reply && reply === last && !asking && (
                <button className="btn sm msg-return" onClick={onReturn}>
                  <span className="back-chevron">
                    <Chevron size={10} />
                  </span>{' '}
                  Return to review
                </button>
              )}
            </div>
          )
        })}
        {asking && last?.role === 'user' && !last.runId && waiting(streams[asking])}
      </div>
      {followUp && (
        <div className="chat-following">
          <span>
            Following up: <strong>{questionOf(followUp)}</strong>
          </span>
          <button className="icon-btn sm" title="Not a follow-up" aria-label="Not a follow-up" onClick={() => setFollowUp(null)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={2}
          placeholder={followUp ? 'Ask about that answer…' : 'Ask a question…'}
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
 * An AI card's question and answer in Ask AI: a one-off, not part of the conversation, so it
 * folds away. Folded, a thin row: the question, a line of the answer, and a bar to hold to open
 * it (the bar fills from where it's pressed; when full it opens). Open, the bar at the bottom
 * closes it with a click.
 */
function TaskFold({
  question,
  reply,
  run,
  open,
  onOpen,
  pending,
  answer,
  following,
  onFollowUp,
  onShowText
}: {
  question: ChatEntry
  reply?: ChatEntry
  run?: AiTaskRun
  open: boolean
  onOpen: (on: boolean) => void
  pending: ReactNode
  answer: ReactNode
  following: boolean
  onFollowUp: () => void
  onShowText: (blockIds: string[], quote: string) => void
}) {
  const q = question.content.split('\n\n> ')[0]
  const m = q.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  return (
    <section className={`task-fold ${open ? 'open' : ''}`}>
      {open ? (
        <div className="task-fold-body">
          <div className="msg user">
            <CardQuestion text={question.content} run={run} onShowText={onShowText} />
          </div>
          {pending}
          {reply && (
            <div className={`msg assistant ${reply.failed ? 'failed' : ''}`}>
              {answer}
              {!reply.failed && (
                <button className={`btn sm msg-follow ${following ? 'on' : ''}`} onClick={onFollowUp} title="Ask about this answer: it goes into the conversation with your question">
                  <Icon name="chat" size={13} /> Ask a follow-up
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="task-fold-head">
          <Icon name="sparkle" size={13} />
          <div className="task-fold-text">
            <strong>
              {m ? m[1] : q}
              {m && <span className="faint"> · {m[2]}</span>}
            </strong>
            <span className={`faint ${reply?.failed ? 'dr-err' : ''}`}>{reply ? overview(reply, run) : pending ? 'Working on it…' : 'No answer.'}</span>
          </div>
        </div>
      )}
      {open ? (
        <button className="task-fold-bar" onClick={() => onOpen(false)}>
          <span className="task-fold-chev up">
            <Chevron size={10} />
          </span>
          Close
        </button>
      ) : (
        <HoldBar onDone={() => onOpen(true)} />
      )}
    </section>
  )
}

/** A line of the answer: its summary, or the start of its text. */
function overview(reply: ChatEntry, run?: AiTaskRun): string {
  const text = run?.parts?.find((p) => p.type === 'text')?.markdown ?? reply.content
  const line = text
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .split('\n')
    .map((x) => x.trim())
    .find(Boolean) ?? ''
  return line.length > 140 ? `${line.slice(0, 140).trimEnd()}…` : line
}

const HOLD_MS = 550

/**
 * Hold to open: while pressed, a tint spreads from the pointer to every corner of the bar; when
 * it covers the bar, `onDone`. Let go early and it drains away. Enter or Space opens at once.
 */
function HoldBar({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [fill, setFill] = useState<{ x: number; y: number; r: number; on: boolean } | null>(null)
  const timer = useRef(0)
  const start = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const box = ref.current!.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    // Far enough to reach the furthest corner.
    const r = Math.max(Math.hypot(x, y), Math.hypot(box.width - x, y), Math.hypot(x, box.height - y), Math.hypot(box.width - x, box.height - y))
    ref.current!.setPointerCapture(e.pointerId)
    setFill({ x, y, r, on: false })
    requestAnimationFrame(() => setFill((f) => (f ? { ...f, on: true } : f)))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setFill(null)
      onDone()
    }, HOLD_MS)
  }
  const stop = () => {
    window.clearTimeout(timer.current)
    setFill((f) => (f ? { ...f, on: false } : f))
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      ref={ref}
      className="task-fold-bar hold"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onDone()
        }
      }}
      title="Press and hold to open"
    >
      {fill && (
        <span
          className="task-fold-fill"
          style={{
            left: fill.x - fill.r,
            top: fill.y - fill.r,
            width: fill.r * 2,
            height: fill.r * 2,
            transform: `scale(${fill.on ? 1 : 0})`,
            transitionDuration: fill.on ? `${HOLD_MS}ms` : '180ms'
          }}
          aria-hidden
        />
      )}
      <span className="task-fold-label">
        <span className="task-fold-chev">
          <Chevron size={10} />
        </span>
        Hold to open
      </span>
    </button>
  )
}

/** On a question that follows up a card's answer: which one. */
function FollowedUp({ text }: { text: string }) {
  return <div className="msg-followed">↪ {text}</div>
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
