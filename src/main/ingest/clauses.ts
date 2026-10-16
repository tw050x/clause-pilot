import type { Clause, ContractType } from '@shared/types'

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
export function splitClauses(lines: string[]): Clause[] {
  const clauses: Clause[] = []
  let heading: string | null = null
  let current: { number: string | null; heading: string | null; parts: string[] } | null = null

  const flush = () => {
    if (current && current.parts.length) {
      const text = current.parts.join(' ').replace(/\s+/g, ' ').trim()
      if (text) clauses.push({ id: `c${clauses.length}`, index: clauses.length, number: current.number, heading: current.heading, text })
    }
    current = null
  }

  for (const raw of lines) {
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
      current = { number: m[1], heading, parts: [rest] }
      continue
    }

    if (!current && isHeading(line)) {
      flush()
      heading = line.toUpperCase()
      continue
    }

    if (SIGNATURE.test(line)) {
      flush()
      current = { number: null, heading: 'EXECUTION', parts: [line] }
      continue
    }

    if (!current) current = { number: null, heading, parts: [] }
    current.parts.push(line)
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
