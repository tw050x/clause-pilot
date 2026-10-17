import type { ChangeReview, IntentCheck, PlaybookPosition } from '@shared/types'
import type { IntentOut, PositionOut } from './tasks'

/**
 * The answers to the AI tasks on highlighted text, written as Markdown from what the server
 * returned. The same text goes on the card in the review column and into Ask AI.
 */

const FAVOURS = { us: 'favours us', counterparty: 'favours them', neutral: 'neutral' } as const

/** Intent: per paragraph, our verdict (after the checks in code) and what the model said. */
export function intentAnswer(results: { where: string; check?: Omit<IntentCheck, 'status' | 'at'>; out?: IntentOut; error?: string }[]): string {
  if (!results.length) return 'None of the highlighted paragraphs has an approved clause of ours to compare with.'
  return results
    .map(({ where, check, out, error }) => {
      if (error || !check || !out) return `### ${where} · failed\n\n${error ?? 'No answer.'}`
      const lines = [`### ${where} · ${check.same ? 'same intent' : 'differs'}`, '', check.title ? `Compared with our approved **${check.title}** · ${out.confidence} confidence` : `${out.confidence} confidence`]
      if (!check.same) lines.push('', `**Why not cleared:** ${check.note}`)
      lines.push('', out.reasoning)
      if (out.material_differences.length) lines.push('', ...out.material_differences.map((x) => `- ${x.description} *(${FAVOURS[x.favours]})*`))
      return lines.join('\n')
    })
    .join('\n\n')
}

const STATUS = { compliant: 'meets our standard', deviation: 'deviates', missing: 'not covered', 'not-applicable': 'not applicable' } as const

/** Playbook: each position the highlighted text touches, worst first; the rest in one line. */
export function playbookAnswer(results: { position: PlaybookPosition; out?: PositionOut; error?: string; where: (ids: string[]) => string }[]): string {
  if (!results.length) return 'No playbook positions apply to this kind of contract.'
  const rank = (r: (typeof results)[number]) => (r.error ? 3 : r.out!.status === 'deviation' ? (r.out!.severity === 'high' ? 0 : r.out!.severity === 'medium' ? 1 : 2) : r.out!.status === 'compliant' ? 4 : 5)
  const sorted = [...results].sort((a, b) => rank(a) - rank(b))
  const shown = sorted.filter((r) => r.error || r.out!.status === 'deviation' || r.out!.status === 'compliant')
  const quiet = sorted.filter((r) => !shown.includes(r)).map((r) => r.position.title)
  const parts = shown.map(({ position, out, error, where }) => {
    if (error || !out) return `### ${position.title} · failed\n\n${error ?? 'No answer.'}`
    const head = `### ${position.title} · ${STATUS[out.status]}${out.status === 'deviation' ? ` (${out.severity})` : ''}`
    const lines = [head]
    if (out.clause_ids.length) lines.push('', `In ${where(out.clause_ids)}`)
    if (out.status === 'deviation') lines.push('', out.within_fallback ? 'Within our acceptable fallback.' : 'Outside our acceptable fallback.')
    if (out.deviation.trim()) lines.push('', out.deviation.trim())
    if (out.suggested_redline.trim()) lines.push('', '**Suggested wording:**', '', `> ${out.suggested_redline.trim()}`)
    return lines.join('\n')
  })
  if (!shown.length) parts.push('The highlighted text doesn’t touch any of our playbook positions.')
  if (quiet.length) parts.push(`*Not covered by the highlighted text:* ${quiet.join(', ')}.`)
  return parts.join('\n\n')
}

const RECOMMEND = { accept: 'Accept', counter: 'Counter-propose', restore: 'Restore our wording', escalate: 'Escalate' } as const
const EFFECT = { 'favours-us': 'favours us', neutral: 'neutral', 'favours-them': 'favours them' } as const

/** Their changes: per change, what it does, who it favours, and what to do. */
export function changesAnswer(results: { where: string; review?: ChangeReview; error?: string }[]): string {
  if (!results.length) return 'There are no open changes of theirs in the highlighted text.'
  return results
    .map(({ where, review, error }) => {
      if (error || !review) return `### ${where} · failed\n\n${error ?? 'No answer.'}`
      const lines = [`### ${where} · ${RECOMMEND[review.recommendation]}`, '', `**${review.risk} risk** · ${EFFECT[review.effect]}`, '', review.summary, '', review.reasoning]
      const conflicts = review.playbook.filter((p) => p.conflict)
      if (conflicts.length) lines.push('', '**Playbook:**', ...conflicts.map((p) => `- ${p.title}: ${p.note}`))
      if (review.related.length) lines.push('', '**Also affects:**', ...review.related.map((r) => `- ${r.where}: ${r.why}`))
      const wording = review.suggested.filter((x) => x.text.trim())
      if (wording.length) lines.push('', '**Suggested wording:**', ...wording.flatMap((x) => ['', `> ${x.text.trim()}`]))
      if (review.comment.trim()) lines.push('', `**Suggested comment to them:** ${review.comment.trim()}`)
      return lines.join('\n')
    })
    .join('\n\n')
}
