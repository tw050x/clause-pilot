import type { DocBlock, LibraryClause, PlaybookPosition, Precedent, QuestionData, ReviewSession } from '@shared/types'
import { beforeTheirs, changeSets, hasOpenChanges, marksFor, shownText } from '@shared/changes'
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
