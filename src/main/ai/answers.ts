import type { AiAction, AiAnswerPart, ChangeReview, IntentCheck, PlaybookPosition } from '@shared/types'
import type { IntentOut, PositionOut } from './tasks'

/**
 * The answers to the AI tasks on highlighted text, built from what the server returned: a line
 * of text, then a card per finding with what can be done about it (apply the suggested wording,
 * add the suggested comment). The same parts show on the card in the review column and in Ask
 * AI; `answerMarkdown` writes them as Markdown for the chat's context.
 */

type Part = AiAnswerPart
type Finding = Extract<Part, { type: 'finding' }>

const FAVOURS = { us: 'favours us', counterparty: 'favours them', neutral: 'neutral' } as const
const text = (markdown: string): Part => ({ type: 'text', markdown })
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** Models write "None" or "No change required" where they mean nothing. */
const nothing = (t: string) => !t.trim() || /^(none|n\/a|no change( required| needed)?|not applicable)\.?$/i.test(t.trim())

/** Intent: per paragraph, our verdict (after the checks in code), why, and our approved wording to use instead. */
export function intentAnswer(
  results: { where: string; blockId: string; check?: Omit<IntentCheck, 'status' | 'at'>; out?: IntentOut; error?: string; approved?: { title: string; text: string } }[]
): Part[] {
  if (!results.length) return [text('None of the highlighted paragraphs has an approved clause of ours to compare with.')]
  const same = results.filter((r) => r.check?.same).length
  const failed = results.filter((r) => r.error || !r.check).length
  const parts: Part[] = []
  if (results.length > 1) parts.push(text([same && `${count(same, 'paragraph')} with the same intent`, results.length - same - failed && `${results.length - same - failed} that differ`, failed && `${failed} not checked`].filter(Boolean).join(', ') + '.'))
  for (const { where, blockId, check, out, error, approved } of results) {
    const at = { label: where, blockIds: [blockId] }
    if (error || !check || !out) {
      parts.push({ type: 'finding', title: where, verdict: 'Not checked', tone: 'bad', where: at, body: error ?? 'No answer.', actions: [] })
      continue
    }
    const lines = [check.title ? `Compared with our approved **${check.title}** · ${out.confidence} confidence.` : `${out.confidence} confidence.`]
    if (!check.same) lines.push('', `**Why it isn't cleared:** ${check.note}`)
    lines.push('', out.reasoning)
    if (out.material_differences.length) lines.push('', ...out.material_differences.map((x) => `- ${x.description} *(${FAVOURS[x.favours]})*`))
    const actions: AiAction[] = !check.same && approved ? [{ type: 'apply-wording', blockId, where, text: approved.text, label: 'Use our approved wording' }] : []
    parts.push({ type: 'finding', title: check.title ?? where, verdict: check.same ? 'Same intent' : 'Differs', tone: check.same ? 'good' : 'bad', where: at, body: lines.join('\n'), actions })
  }
  return parts
}

/** Playbook: a card per position the highlighted text touches, worst first; the rest in one line. */
export function playbookAnswer(
  results: { position: PlaybookPosition; out?: PositionOut; error?: string }[],
  place: (ids: string[]) => { label: string; blockIds: string[] } | undefined,
  prose: (t: string) => string
): Part[] {
  if (!results.length) return [text('No playbook positions apply to this kind of contract.')]
  const rank = (r: (typeof results)[number]) => (r.error || !r.out ? 3 : r.out.status === 'deviation' ? (r.out.within_fallback ? 2 : r.out.severity === 'high' ? 0 : 1) : r.out.status === 'compliant' ? 4 : 5)
  const sorted = [...results].sort((a, b) => rank(a) - rank(b))
  const shown = sorted.filter((r) => r.error || !r.out || r.out.status === 'deviation' || r.out.status === 'compliant')
  const quiet = sorted.filter((r) => !shown.includes(r)).map((r) => r.position.title)
  const deviates = shown.filter((r) => r.out?.status === 'deviation').length
  const meets = shown.filter((r) => r.out?.status === 'compliant').length
  const parts: Part[] = []
  parts.push(
    text(
      shown.length
        ? `${[deviates && `${count(deviates, 'position')} not met`, meets && `${count(meets, 'position')} met`, shown.length - deviates - meets && `${shown.length - deviates - meets} not checked`].filter(Boolean).join(', ')}.`
        : 'The highlighted text doesn’t touch any of our playbook positions.'
    )
  )
  for (const { position, out, error } of shown) {
    if (error || !out) {
      parts.push({ type: 'finding', title: position.title, verdict: 'Not checked', tone: 'bad', body: error ?? 'No answer.', actions: [] })
      continue
    }
    const at = place(out.clause_ids)
    const finding: Finding = { type: 'finding', title: position.title, verdict: 'Meets our standard', tone: 'good', where: at, actions: [] }
    if (out.status === 'deviation') {
      finding.verdict = out.within_fallback ? 'Within our fallback' : `Deviates · ${out.severity}`
      finding.tone = out.within_fallback ? 'warn' : 'bad'
      const lines = [out.within_fallback ? 'Not our standard, but within our acceptable fallback.' : '**Outside our acceptable fallback.**']
      if (!nothing(out.deviation)) lines.push('', prose(out.deviation.trim()))
      finding.body = lines.join('\n')
      const target = at?.blockIds[0]
      if (target && !nothing(out.suggested_redline)) finding.actions.push({ type: 'apply-wording', blockId: target, where: place([target])!.label, text: out.suggested_redline.trim() })
    }
    parts.push(finding)
  }
  if (quiet.length) parts.push(text(`*Not covered by the highlighted text:* ${quiet.join(', ')}.`))
  return parts
}

const RECOMMEND = { accept: 'Accept', counter: 'Counter-propose', restore: 'Restore our wording', escalate: 'Escalate' } as const
const EFFECT = { 'favours-us': 'favours us', neutral: 'neutral', 'favours-them': 'favours them' } as const
const RISK_TONE = { high: 'bad', medium: 'warn', low: 'neutral' } as const

/** Their changes: a card per change, with what it does, who it favours, and the wording and comment to use. */
export function changesAnswer(results: { where: string; blockIds: string[]; review?: ChangeReview; error?: string }[], whereOf: (blockId: string) => string): Part[] {
  if (!results.length) return [text('There are no open changes of theirs in the highlighted text.')]
  return results.map(({ where, blockIds, review, error }): Part => {
    const at = { label: where, blockIds }
    if (error || !review) return { type: 'finding', title: where, verdict: 'Not checked', tone: 'bad', where: at, body: error ?? 'No answer.', actions: [] }
    const lines = [`**${review.risk} risk** · ${EFFECT[review.effect]}`, '', review.summary, '', review.reasoning]
    const conflicts = review.playbook.filter((p) => p.conflict)
    if (conflicts.length) lines.push('', '**Playbook:**', ...conflicts.map((p) => `- ${p.title}: ${p.note}`))
    if (review.related.length) lines.push('', '**Also affects:**', ...review.related.map((r) => `- ${r.where}: ${r.why}`))
    const actions: AiAction[] = review.suggested.filter((x) => !nothing(x.text)).map((x) => ({ type: 'apply-wording', blockId: x.blockId, where: whereOf(x.blockId), text: x.text.trim() }))
    if (!nothing(review.comment)) actions.push({ type: 'comment', blockId: review.suggested[0]?.blockId ?? blockIds[0], where, text: review.comment.trim() })
    return { type: 'finding', title: where, verdict: RECOMMEND[review.recommendation], tone: review.recommendation === 'accept' ? 'good' : RISK_TONE[review.risk], where: at, body: lines.join('\n'), actions }
  })
}

/** The parts as Markdown: the answer as text (kept on the run), and the fallback for display. */
export function answerMarkdown(parts: Part[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.markdown
      const lines = [`### ${p.title} · ${p.verdict}`]
      if (p.where && p.where.label !== p.title) lines.push('', `In ${p.where.label}`)
      if (p.body) lines.push('', p.body)
      for (const a of p.actions)
        lines.push('', a.type === 'apply-wording' ? `**${a.label ?? 'Suggested wording'} for ${a.where}:**` : `**Suggested comment to them on ${a.where}:**`, '', `> ${a.text}`)
      return lines.join('\n')
    })
    .join('\n\n')
}
