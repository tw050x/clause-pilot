import type { AiAction, AiAnswerPart, ChangeReview, IntentCheck, PlaybookPosition } from '@shared/types'
import type { IntentOut, PositionOut } from './tasks'
import type { JsonSchema } from '@shared/schema'

/**
 * The answers to the AI tasks on highlighted text, built from what the server returned: a line
 * of text, then a card per finding with what can be done about it (apply the suggested wording,
 * add the suggested comment), shown on the question's card in the review column; `answerMarkdown`
 * writes them as Markdown.
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

type Place = (ids: string[]) => { label: string; blockIds: string[] } | undefined
const TONES = ['good', 'warn', 'bad', 'neutral'] as const
const RANK = { bad: 0, warn: 1, neutral: 2, good: 3 } as const
/** Fields read for the app's own features, on a card and at the top. */
const CARD = ['title', 'name', 'verdict', 'tone', 'clause_ids', 'explanation', 'suggested_wording', 'comment_to_them']
const HIDDEN = ['injection_suspected', 'injection_notes']

/** A property's label: its title in the schema, or its name in words. */
const labelOf = (key: string, node?: JsonSchema) => (typeof node?.title === 'string' && node.title) || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const propsOf = (node?: JsonSchema) => (node?.properties ?? {}) as Record<string, JsonSchema>
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Any other value as Markdown: a labelled line, or a labelled list. */
function line(label: string, v: unknown, prose: (t: string) => string): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && nothing(v))) return null
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== null && x !== '').map((x) => (isRecord(x) ? Object.values(x).join(' · ') : String(x)))
    return items.length ? `**${label}:**\n${items.map((x) => `- ${prose(x)}`).join('\n')}` : null
  }
  if (isRecord(v)) return `**${label}:** ${Object.entries(v).map(([k, x]) => `${labelOf(k)}: ${String(x)}`).join('; ')}`
  if (typeof v === 'boolean') return `**${label}:** ${v ? 'Yes' : 'No'}`
  return `**${label}:** ${prose(String(v))}`
}

/** One card from an object in the answer: the fields the app knows, then the rest as lines. */
function cardOf(item: Record<string, unknown>, node: JsonSchema | undefined, fallback: string, place: Place, prose: (t: string) => string): Finding {
  const str = (k: string) => (typeof item[k] === 'string' ? (item[k] as string) : '')
  const tone = TONES.includes(item.tone as (typeof TONES)[number]) ? (item.tone as Finding['tone']) : 'neutral'
  const ids = Array.isArray(item.clause_ids) ? item.clause_ids.filter((x): x is string => typeof x === 'string') : []
  const at = place(ids)
  const target = at?.blockIds[0]
  const body: string[] = []
  if (!nothing(str('explanation'))) body.push(prose(str('explanation').trim()))
  for (const [k, v] of Object.entries(item)) {
    if (CARD.includes(k)) continue
    const l = line(labelOf(k, propsOf(node)[k]), v, prose)
    if (l) body.push(l)
  }
  const actions: AiAction[] = []
  if (target && !nothing(str('suggested_wording'))) actions.push({ type: 'apply-wording', blockId: target, where: place([target])!.label, text: str('suggested_wording').trim() })
  if (target && !nothing(str('comment_to_them'))) actions.push({ type: 'comment', blockId: target, where: place([target])!.label, text: str('comment_to_them').trim() })
  return { type: 'finding', title: prose(str('title') || str('name') || fallback), verdict: prose(str('verdict')), tone, where: at, body: body.length ? body.join('\n\n') : undefined, actions }
}

/**
 * An answer in the shape of a question's JSON Schema, as text and cards: the top level's
 * summary first, then its other values as labelled lines, and each object (or list of objects)
 * as cards, worst first. See @shared/schema for the fields the app recognises.
 */
export function schemaAnswer(out: unknown, schema: JsonSchema, place: Place, prose: (t: string) => string): Part[] {
  if (!isRecord(out)) return [text(prose(String(out)))]
  const props = propsOf(schema)
  const parts: Part[] = []
  if (typeof out.summary === 'string' && !nothing(out.summary)) parts.push(text(prose(out.summary.trim())))
  const lines: string[] = []
  const cards: Finding[] = []
  // In the schema's order, then anything it didn't name.
  const keys = [...new Set([...Object.keys(props), ...Object.keys(out)])].filter((k) => k !== 'summary' && !HIDDEN.includes(k) && k in out)
  for (const k of keys) {
    const v = out[k]
    const node = props[k]
    if (Array.isArray(v) && v.length && v.every(isRecord)) {
      const items = node?.items as JsonSchema | undefined
      cards.push(...v.map((x, i) => cardOf(x, items, `${labelOf(k, node)} ${i + 1}`, place, prose)))
    } else if (isRecord(v)) cards.push(cardOf(v, node, labelOf(k, node), place, prose))
    else {
      const l = line(labelOf(k, node), v, prose)
      if (l) lines.push(l)
    }
  }
  if (lines.length) parts.push(text(lines.join('\n\n')))
  parts.push(...cards.sort((a, b) => RANK[a.tone] - RANK[b.tone]))
  return parts.length ? parts : [text('The AI found nothing to report.')]
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
