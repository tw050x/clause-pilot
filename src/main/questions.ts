import type { DocBlock, LibraryClause, PlaybookPosition, Precedent, QuestionData, ReviewSession } from '@shared/types'
import { beforeTheirs, changeSets, hasOpenChanges, marksFor, ourText, segmentsOf, shownText, theyChanged } from '@shared/changes'
import { whereOf } from '@shared/numbering'
import { paragraphsBlock } from './ai/prompts'
import { applicable, changeInput, intentInput } from './docreview'
import { seenBefore } from './engine/seen'
import { latestFindings } from './chat'

/**
 * The material a question asks to be sent with it, as tagged blocks ahead of its instructions.
 * The highlighted text always goes; the rest is what the question's data says. A method sends
 * some of it in its own way (a change's before and after, the position being checked), so
 * those are left out here (`skip`).
 */

const esc = (t: string) => t.replace(/"/g, "'")
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t)

export interface Knowledge {
  library: LibraryClause[]
  playbook: PlaybookPosition[]
  precedents: Precedent[]
}

/** The highlighted paragraphs' numbers, for the question as recorded and for the AI. */
export function placesOf(s: ReviewSession, blocks: DocBlock[]): string {
  const d = s.doc!
  const named = [...new Set(blocks.filter((b) => b.kind !== 'heading').map((b) => whereOf(d, b)))]
  return named.length <= 5 ? named.join(', ') : `${named[0]} to ${named[named.length - 1]}, ${named.length} paragraphs`
}

export function highlightBlock(s: ReviewSession, blocks: DocBlock[], quote: string): string {
  return `The lawyer highlighted this text (in ${placesOf(s, blocks)}):\n<highlight>\n${quote}\n</highlight>`
}

/** The highlighted paragraphs in full, as they now read. */
export function paragraphsOf(s: ReviewSession, blocks: DocBlock[]): string {
  const d = s.doc!
  return `<highlighted_paragraphs>\n${blocks
    .filter((b) => b.kind !== 'deleted')
    .map((b) => `<p id="${b.id}"${b.label ? ` number="${esc(b.label)}"` : ''}>${shownText(marksFor(d, b))}</p>`)
    .join('\n')}\n</highlighted_paragraphs>`
}

/** The whole contract, paragraph by paragraph. */
export const contractOf = (s: ReviewSession) => paragraphsBlock(s.doc!.blocks.filter((b) => b.kind !== 'deleted').map((b) => ({ id: b.id, label: b.label, text: b.text })))

export function contextFor(s: ReviewSession, blocks: DocBlock[], data: QuestionData[], k: Knowledge, skip: QuestionData[] = []): string {
  const d = s.doc!
  const want = (x: QuestionData) => data.includes(x) && !skip.includes(x)
  const ids = blocks.map((b) => b.id)
  const sets = changeSets(d).filter((x) => x.blocks.some((b) => ids.includes(b.id)) && x.blocks.some((b) => hasOpenChanges(d, b)))
  const out: string[] = []
  if (want('contract')) out.push(contractOf(s))
  if (want('paragraphs')) out.push(paragraphsOf(s, blocks))
  if (want('changes'))
    out.push(
      sets.length
        ? `Their changes in the highlight:\n${sets
            .map((x) => `<change where="${esc(x.where)}">\n${x.blocks.map((b) => `<changed_paragraph id="${b.id}"${b.label ? ` number="${esc(b.label)}"` : ''}>\n<before>${beforeTheirs(b) || '(added by them)'}</before>\n<after>${b.kind === 'deleted' ? '(deleted by them)' : b.text}</after>${(b.comments ?? []).map((c) => `\n<their_comment>${c.text}</their_comment>`).join('')}\n</changed_paragraph>`).join('\n')}\n</change>`)
            .join('\n')}`
        : 'Their changes in the highlight: none open.'
    )
  if (want('edits')) {
    const edits = Object.entries(d.edits).map(([id, text]) => {
      const b = d.blocks.find((x) => x.id === id)
      return `<our_edit paragraph="${b ? esc(whereOf(d, b)) : id}">${text ? clip(text, 600) : '(struck by us)'}</our_edit>`
    })
    out.push(edits.length ? `Our edits so far:\n${edits.join('\n')}` : 'Our edits so far: none.')
  }
  if (want('library')) {
    const seen = new Set<string>()
    const clauses = blocks.flatMap((b) => intentInput(d, b, k.library)?.candidates ?? []).filter((c) => !seen.has(c.id) && seen.add(c.id))
    out.push(clauses.length ? `Our approved clauses closest to the highlight:\n${clauses.map((c) => `<approved_clause id="${c.id}" title="${esc(c.title)}">\n${c.text}\n</approved_clause>`).join('\n')}` : 'Our approved clauses closest to the highlight: none.')
  }
  if (want('playbook')) {
    const ps = applicable(k.playbook, s.contractType)
    out.push(
      ps.length
        ? `Our standard positions:\n${ps.map((p) => `<standard_position id="${p.id}" title="${esc(p.title)}">\nOur standard: ${p.standard}\nAcceptable fallback: ${p.acceptableFallback}\nRed flags: ${p.redFlags.join('; ')}\n</standard_position>`).join('\n')}`
        : 'Our standard positions: none recorded.'
    )
  }
  if (want('precedents')) {
    const seen = seenBefore(s, k.precedents)
    const hits = sets.flatMap((x) => changeInput(s, x, [], seen[x.id] ?? []).seen ?? [])
    out.push(
      hits.length
        ? `How we answered the same or similar changes before:\n${hits.map((h) => `<earlier_negotiation counterparty="${esc(h.counterparty)}" our_response="${h.response}">\nThey proposed: ${h.text}${h.ours ? `\nWe answered with: ${h.ours}` : ''}\nNotes: ${h.notes}\n</earlier_negotiation>`).join('\n')}`
        : 'How we answered similar changes before: nothing found.'
    )
  }
  if (want('findings')) {
    const f = latestFindings(d)
    out.push(f.length ? `What other questions found in this review:\n${f.join('\n')}` : 'What other questions found in this review: nothing yet.')
  }
  return out.join('\n\n')
}

/**
 * Where the highlighted paragraphs stand in the review, sent with every question so answers build
 * on each other instead of repeating or contradicting: each paragraph as it now reads (our edits
 * and decisions in), as they sent it, and before their changes; and what earlier questions on the
 * same text answered (their findings, and wording they suggested, applied or not). Any wording
 * suggested is to be the whole paragraph as it should read, starting from how it now reads.
 */
export function standingOf(s: ReviewSession, blocks: DocBlock[], exceptRun?: string): string {
  const d = s.doc!
  const ids = new Set(blocks.map((b) => b.id))
  const paras = blocks
    .filter((b) => b.kind !== 'heading')
    .map((b) => {
      const now = b.kind === 'deleted' && d.edits[b.id] === undefined ? '(deleted by them)' : shownText(marksFor(d, b))
      const sent = b.kind === 'deleted' ? '(deleted by them)' : segmentsOf(b).filter((x) => x.op !== 'del').map((x) => x.text).join('')
      return `<paragraph id="${b.id}" number="${esc(whereOf(d, b))}">\n<now>${now}</now>${theyChanged(b) ? `\n<as_they_sent_it>${sent}</as_they_sent_it>\n<before_their_changes>${beforeTheirs(b) || '(not there: they added it)'}</before_their_changes>` : ''}${d.edits[b.id] !== undefined ? '\n<note>We have edited it: <now> includes our wording.</note>' : ''}\n</paragraph>`
    })
  const earlier = (d.aiRuns ?? [])
    .filter((r) => r.id !== exceptRun && r.status === 'done' && r.blockIds.some((x) => ids.has(x)))
    .slice(-6)
    .map((r) => {
      const findings = (r.parts ?? []).flatMap((p) =>
        p.type === 'finding'
          ? [
              `- ${p.title}${p.verdict ? ` (${p.verdict})` : ''}${p.actions
                .map((a) => {
                  if (a.type !== 'apply-wording') return `; suggested comment: "${clip(a.text, 300)}"`
                  const b = d.blocks.find((x) => x.id === a.blockId)
                  const applied = !!b && ourText(d, b) === a.text.replace(/\s+/g, ' ').trim()
                  return `; suggested wording for ${a.where} (${applied ? 'APPLIED: it is the paragraph now' : 'not applied'}): "${clip(a.text, 600)}"`
                })
                .join('')}`
            ]
          : []
      )
      const text = findings.length ? findings.join('\n') : clip((r.answer ?? '').replace(/\s+/g, ' '), 600)
      return `<earlier_answer question="${esc(r.title ?? r.question.split('\n')[0])}" asked="${r.at.slice(0, 16)}">\n${text}\n</earlier_answer>`
    })
  return [
    `Where the highlighted paragraphs stand in this review now (our edits and decisions are in <now>; work from <now>, not from the text as they sent it):\n${paras.join('\n')}`,
    earlier.length
      ? `Earlier questions asked of this text, and what they answered:\n${earlier.join('\n')}\nBuild on these: don't repeat a finding or suggestion already made, and if you disagree with one, say so and why. Wording already applied is part of <now>.`
      : '',
    'If you suggest wording for a paragraph, give the whole paragraph as it should read, starting from <now> and keeping the changes already made there unless you say why not.'
  ]
    .filter(Boolean)
    .join('\n\n')
}
