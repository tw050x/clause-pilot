import type { Clause, ContractType, DocComment, TrackedSegment } from '@shared/types'
import type { ParsedDocument } from './parse'

// "4", "4.", "4.2", "4.2.1", optionally followed by a heading or body text.
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(?=[A-Z("'“])/
// "(a)", "(iv)" style sub-items stay inside their parent clause.
const SCHEDULE = /^(SCHEDULE|ANNEX|APPENDIX|EXHIBIT)\b/i
const SIGNATURE = /^(SIGNED|IN WITNESS|Signed for and on behalf|Executed)/i

function isHeading(text: string): boolean {
  const words = text.split(/\s+/)
  if (words.length > 8) return false
  if (/[.;:]$/.test(text)) return false
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length > 0 && letters === letters.toUpperCase()
}

/**
 * Split document lines into clauses. Each numbered item (any depth) becomes a
 * clause; a numbered line that is only a heading ("9. LIMITATION OF LIABILITY")
 * becomes the heading for the clauses that follow. Text before the first number
 * is kept as preamble clauses so nothing in the document goes unreviewed.
 */
export function splitClauses(lines: string[], lineMeta?: ParsedDocument['lineMeta']): Clause[] {
  const clauses: Clause[] = []
  let heading: string | null = null
  type Pending = { number: string | null; heading: string | null; parts: string[]; tracked: TrackedSegment[]; changed: boolean; comments: DocComment[] }
  let current: Pending | null = null

  const flush = () => {
    const cur = current as Pending | null
    if (cur && cur.parts.length) {
      const text = cur.parts.join(' ').replace(/\s+/g, ' ').trim()
      if (text)
        clauses.push({
          id: `c${clauses.length}`,
          index: clauses.length,
          number: cur.number,
          heading: cur.heading,
          text,
          tracked: cur.changed ? cur.tracked : undefined,
          comments: cur.comments.length ? cur.comments : undefined
        })
    }
    current = null
  }
  // Attach a line's redline and comments to the clause it belongs to.
  const attach = (i: number, numberPrefix: number) => {
    const meta = lineMeta?.[i]
    const cur = current as Pending | null
    if (!cur) return
    if (meta?.comments) cur.comments.push(...meta.comments)
    const segs = meta?.tracked ?? [{ op: 'same' as const, text: lines[i].trim() }]
    if (meta?.tracked) cur.changed = true
    // Drop the printed clause number from the redline, as it is from the text.
    let skip = numberPrefix
    const trimmed: TrackedSegment[] = []
    for (const s of segs) {
      if (skip > 0 && s.op !== 'del') {
        if (s.text.length <= skip) {
          skip -= s.text.length
          continue
        }
        trimmed.push({ ...s, text: s.text.slice(skip) })
        skip = 0
      } else trimmed.push({ ...s })
    }
    if (cur.tracked.length) cur.tracked.push({ op: 'same', text: ' ' })
    cur.tracked.push(...trimmed)
  }
  const start = (number: string | null, heading: string | null, part: string): Pending => ({ number, heading, parts: part ? [part] : [], tracked: [], changed: false, comments: [] })

  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line) continue

    if (SCHEDULE.test(line) && line.length < 90) {
      flush()
      heading = line.toUpperCase()
      continue
    }

    const m = line.match(NUMBERED)
    if (m) {
      const rest = line.slice(m[0].length).trim()
      if (isHeading(rest)) {
        flush()
        heading = rest.toUpperCase()
        continue
      }
      flush()
      current = start(m[1], heading, rest)
      attach(i, line.length - rest.length)
      continue
    }

    if (!current && isHeading(line)) {
      flush()
      heading = line.toUpperCase()
      continue
    }

    if (SIGNATURE.test(line)) {
      flush()
      current = start(null, 'EXECUTION', line)
      attach(i, 0)
      continue
    }

    if (!current) current = start(null, heading, '')
    ;(current as Pending).parts.push(line)
    attach(i, 0)
  }
  flush()
  return clauses
}

export function guessContractType(lines: string[]): ContractType {
  const head = lines.slice(0, 12).join(' ').toLowerCase()
  if (/non-disclosure|confidentiality agreement|\bnda\b/.test(head)) return 'nda'
  if (/order form|licence|license|subscription/.test(head)) return 'order-form'
  return 'general'
}
