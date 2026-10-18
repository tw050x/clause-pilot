import type { ChatConversation, ChatEntry, ChatMessage } from '@shared/types'

/**
 * What goes to the AI from a contract's Ask AI. Neither provider keeps a conversation for us
 * (each request carries what the AI needs), so every request is built the same way, most
 * stable first so the providers' prompt caches can reuse it:
 *
 *   system:  instructions and the contract          the same for the whole review: cached
 *   thread:  the typed conversation so far          only grows (until compacted): cached up to here
 *   last:    the review as it stands, then the question or the card's task
 *
 * The AI cards are one-off tasks, kept on their cards: they get the system prompt and the review
 * state, never the thread, and are not part of the thread either. Their findings reach the
 * conversation as part of the review state.
 *
 * The thread is compacted once it passes a budget: the older messages are summarised by the
 * same model, and the summary goes first, followed by the newest messages verbatim.
 */

/** Rough token count: about four characters a token for English prose. */
export const tokens = (t: string) => Math.ceil(t.length / 4)

/** History budget per provider, in tokens, beyond the system prompt (which holds the contract). */
export const HISTORY_BUDGET = { anthropic: 40_000, vllm: 6_000 } as const
/** Messages always sent verbatim, however long: the last two exchanges. */
export const KEEP = 4

/** The thread: typed questions and their answers (not failures, nor AI card tasks saved here by earlier versions). */
export const inThread = (e: ChatEntry) => !e.runId && !e.failed && !!e.content.trim()

/** The thread since the summary, as it goes to the AI verbatim. */
export function live(c: ChatConversation): ChatEntry[] {
  const from = c.summary ? c.entries.findIndex((e) => e.id === c.summary!.through) + 1 : 0
  return c.entries.slice(from).filter(inThread)
}

/** Whether the live thread is over budget. */
export function needsCompacting(c: ChatConversation, budget: number): boolean {
  const kept = live(c)
  return kept.length > KEEP && kept.reduce((n, e) => n + tokens(e.content), 0) > budget
}

/** The messages to summarise now (all but the newest few), or none. */
export function toSummarise(c: ChatConversation): ChatEntry[] {
  const kept = live(c)
  return kept.length > KEEP ? kept.slice(0, kept.length - KEEP) : []
}

export const SUMMARY_SYSTEM = `You keep notes on a conversation between a lawyer and an AI assistant about one contract under review.
Write a summary that lets the assistant carry on the conversation without the earlier messages.
Keep: what was asked and concluded, paragraph numbers, wording that was suggested or agreed, open questions, and the lawyer's stated preferences or decisions. Note which version of the contract a point was about when that is given.
Leave out pleasantries and anything the contract itself says (the assistant always has the contract).
Write plain Markdown bullet points, at most about 400 words.`

/** The request that writes the new summary: the previous summary, then the messages it now covers. */
export function summaryRequest(c: ChatConversation, older: ChatEntry[]): ChatMessage[] {
  const transcript = older.map((e) => `${e.role === 'user' ? 'Lawyer' : 'Assistant'}${e.version ? ` (version ${e.version})` : ''}: ${e.content}`).join('\n\n')
  return [
    {
      role: 'user',
      content: `${c.summary ? `Summary so far:\n${c.summary.text}\n\nLater messages:\n` : 'Messages:\n'}${transcript}\n\nWrite the updated summary.`
    }
  ]
}

/** The review as it stands, ahead of what is being asked. */
export const withState = (state: string, ask: string) => `<review_state>\n${state}\n</review_state>\n\n${ask}`

/** A typed question as the AI reads it: with a note if the version changed. */
function asked(e: ChatEntry, before: number | undefined): string {
  const note = e.version && before !== undefined && e.version !== before ? `(Now looking at version ${e.version} of the contract.)\n\n` : ''
  return note + e.content
}

/**
 * The thread for the AI: the summary (as an exchange, so the roles alternate), then the live
 * messages; consecutive messages from one side (an unanswered question) are joined.
 */
export function threadFor(c: ChatConversation): ChatMessage[] {
  const out: ChatMessage[] = []
  const push = (m: ChatMessage) => {
    const last = out[out.length - 1]
    // The same question again (asked again after a failed answer): once.
    if (last?.role === m.role && last.content === m.content) return
    if (last?.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ ...m })
  }
  if (c.summary) {
    push({ role: 'user', content: `(Summary of our conversation about this contract so far.)\n\n${c.summary.text}` })
    push({ role: 'assistant', content: 'Noted. I have the summary and the contract.' })
  }
  let seen: number | undefined
  for (const e of live(c)) {
    push({ role: e.role, content: e.role === 'user' ? asked(e, seen) : e.content })
    if (e.version) seen = e.version
  }
  return out
}

/**
 * A typed question's request: the thread before it, then one message with the review state and
 * the question (the newest entry). The state goes last so a change to it never invalidates the
 * cached thread.
 */
export function chatRequest(c: ChatConversation, state: string): ChatMessage[] {
  const question = c.entries[c.entries.length - 1]
  const before: ChatConversation = { ...c, entries: c.entries.slice(0, -1) }
  const thread = threadFor(before)
  const prev = [...live(before)].reverse().find((e) => e.version)?.version
  const text = asked(question, prev)
  // Asked again after a failed answer: the unanswered copy goes.
  if (thread[thread.length - 1]?.role === 'user' && thread[thread.length - 1].content.endsWith(text)) {
    const t = thread[thread.length - 1]
    t.content = t.content.slice(0, -text.length).trimEnd()
    if (!t.content) thread.pop()
  }
  thread.push({ role: 'user', content: withState(state, text) })
  // An unanswered question before it (its answer failed): one user message.
  const n = thread.length
  if (n > 1 && thread[n - 2].role === 'user') thread.splice(n - 2, 2, { role: 'user', content: `${thread[n - 2].content}\n\n${thread[n - 1].content}` })
  return thread
}
