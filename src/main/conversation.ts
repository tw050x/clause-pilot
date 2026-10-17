import type { ChatConversation, ChatEntry, ChatMessage } from '@shared/types'

/**
 * What a contract's Ask AI conversation sends to the AI. Neither provider keeps a conversation
 * for us (each request carries the history), so the app manages its size: once the messages
 * since the last summary pass a budget, the older ones are summarised by the same model and
 * the summary goes first, followed by the newest messages verbatim. The contract itself is in
 * the system prompt on every request, as it now reads, so the history never needs to carry it.
 */

/** Rough token count: about four characters a token for English prose. */
export const tokens = (t: string) => Math.ceil(t.length / 4)

/** History budget per provider, in tokens, beyond the system prompt (which holds the contract). */
export const HISTORY_BUDGET = { anthropic: 40_000, vllm: 6_000 } as const
/** Messages always sent verbatim, however long: the last two exchanges. */
export const KEEP = 4

/** The messages since the summary that go to the AI as they were written. */
export function live(c: ChatConversation): ChatEntry[] {
  const from = c.summary ? c.entries.findIndex((e) => e.id === c.summary!.through) + 1 : 0
  return c.entries.slice(from).filter((e) => !e.failed && e.content.trim())
}

/** Whether the live messages (plus a question about to be asked) are over budget. */
export function needsCompacting(c: ChatConversation, budget: number, question = ''): boolean {
  const kept = live(c)
  return kept.length > KEEP && kept.reduce((n, e) => n + tokens(e.content), tokens(question)) > budget
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

/**
 * The history for the AI: the summary (as an exchange, so the roles alternate), then the live
 * messages, then the new question. A message from a different version from the one before it
 * says so; consecutive messages from the same side (a failed answer left out) are joined.
 */
export function contextFor(c: ChatConversation, question: string, version?: number): ChatMessage[] {
  const out: ChatMessage[] = []
  const push = (m: ChatMessage) => {
    const last = out[out.length - 1]
    if (last?.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ ...m })
  }
  if (c.summary) {
    push({ role: 'user', content: `(Summary of our conversation about this contract so far.)\n\n${c.summary.text}` })
    push({ role: 'assistant', content: 'Noted. I have the summary and the contract as it now reads.' })
  }
  let seen: number | undefined
  for (const e of live(c)) {
    const note = e.role === 'user' && e.version && seen !== undefined && e.version !== seen ? `(Now looking at version ${e.version} of the contract.)\n\n` : ''
    if (e.version) seen = e.version
    push({ role: e.role, content: note + e.content })
  }
  if (question) push({ role: 'user', content: (version && seen !== undefined && version !== seen ? `(Now looking at version ${version} of the contract.)\n\n` : '') + question })
  return out
}
