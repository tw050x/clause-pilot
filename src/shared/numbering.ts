import type { DocBlock, DocReview, ListStyle } from './types'

/**
 * Clause numbers as they now read, with the paragraphs we've added.
 *
 * A paragraph we add in a numbered list gets the next number at its level, and the
 * paragraphs after it move up, as Word's automatic numbering does: adding a clause after
 * 2.3 makes it 2.4, the old 2.4 becomes 2.5, and clauses under a renumbered heading follow
 * it (3.1 becomes 4.1 when a new clause 3 goes in before it). Decimal numbers ("2", "2.3.1")
 * and lettered or roman sub-items ("(a)", "(iv)") under them are handled; anything else
 * keeps its printed number.
 */

type Parsed =
  | { kind: 'dec'; parts: number[]; dot: boolean }
  | { kind: 'alpha' | 'Alpha' | 'roman'; n: number; open: string; close: string }

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
]
const toRoman = (n: number) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v } return s }, '')
const fromRoman = (s: string) => {
  let n = 0
  let rest = s
  for (const [v, r] of ROMAN) while (rest.startsWith(r)) { n += v; rest = rest.slice(r.length) }
  return rest ? 0 : n
}

/** A printed number, understood. `afterRoman`: the sub-items before it were roman, so "(i)" is roman too. */
export function parseLabel(label: string | undefined, afterRoman = false): Parsed | null {
  if (!label) return null
  const dec = label.match(/^(\d+(?:\.\d+)*)(\.?)$/)
  if (dec) return { kind: 'dec', parts: dec[1].split('.').map(Number), dot: !!dec[2] }
  const sub = label.match(/^(\(?)([a-zA-Z]+)([.)])$/)
  if (!sub) return null
  const [, open, body, close] = sub
  const roman = /^[ivxlc]+$/.test(body) && fromRoman(body) > 0 && (afterRoman || body === 'i' || body.length > 1)
  if (roman) return { kind: 'roman', n: fromRoman(body), open, close }
  if (body.length !== 1) return null
  const upper = body === body.toUpperCase()
  return { kind: upper ? 'Alpha' : 'alpha', n: body.toLowerCase().charCodeAt(0) - 96, open, close }
}

const subLabel = (kind: 'alpha' | 'Alpha' | 'roman', n: number, open: string, close: string) => {
  const body = kind === 'roman' ? toRoman(n) : String.fromCharCode(96 + Math.max(1, Math.min(26, n)))
  return `${open}${kind === 'Alpha' ? body.toUpperCase() : body}${close}`
}

/** The list style a new paragraph continues, from the paragraph it was added after (Enter). */
export function listAfter(d: DocReview, b: DocBlock): ListStyle | undefined {
  if (b.ours) return b.list
  const label = labelsOf(d).get(b.id) ?? b.label
  const p = parseLabel(label)
  if (!p) return undefined
  // After a heading ("5. NON-SOLICITATION"), the first clause under it (5.1).
  if (p.kind === 'dec') return { kind: 'dec', depth: p.parts.length + (b.kind === 'heading' ? 1 : 0) }
  return { kind: p.kind, depth: 0, open: p.open, close: p.close }
}

const cache = new WeakMap<DocReview, Map<string, string>>()

/** Every numbered paragraph's number as it now reads (paragraph id → label). */
export function labelsOf(d: DocReview): Map<string, string> {
  const hit = cache.get(d)
  if (hit) return hit
  const out = new Map<string, string>()
  const shift = new Map<string, number>() // effective parent ("2") → clauses we've added under it so far
  const remap = new Map<string, string>() // printed number → number as it now reads
  let last: number[] = []
  let topDot = true
  let sawTop = false
  type Sub = { kind: 'alpha' | 'Alpha' | 'roman'; n: number; open: string; close: string; added: number }
  let sub: Sub | null = null
  for (const b of d.blocks) {
    if (b.ours) {
      const l = b.list
      if (!l) continue
      if (l.kind === 'dec') {
        const depth = Math.max(1, l.depth)
        const parts = last.slice(0, depth - 1)
        while (parts.length < depth - 1) parts.push(1)
        parts.push((last.length >= depth ? last[depth - 1] : 0) + 1)
        const parent = parts.slice(0, -1).join('.')
        shift.set(parent, (shift.get(parent) ?? 0) + 1)
        last = parts
        sub = null
        out.set(b.id, parts.join('.') + (depth === 1 && topDot ? '.' : ''))
      } else {
        const prev: Sub | null = sub
        const same: boolean = !!prev && prev.kind === l.kind
        const next: Sub = { kind: l.kind, n: (same ? prev!.n : 0) + 1, open: l.open ?? prev?.open ?? '(', close: l.close ?? prev?.close ?? ')', added: (same ? prev!.added : 0) + 1 }
        sub = next
        out.set(b.id, subLabel(next.kind, next.n, next.open, next.close))
      }
      continue
    }
    const p = parseLabel(b.label, sub?.kind === 'roman')
    if (!p) continue
    if (p.kind === 'dec') {
      if (p.parts.length === 1 && !sawTop) {
        topDot = p.dot
        sawTop = true
      }
      const parentPrinted = p.parts.slice(0, -1).join('.')
      const parent = parentPrinted ? (remap.get(parentPrinted) ?? parentPrinted) : ''
      const own = p.parts[p.parts.length - 1] + (shift.get(parent) ?? 0)
      const parts = [...(parent ? parent.split('.').map(Number) : []), own]
      remap.set(p.parts.join('.'), parts.join('.'))
      last = parts
      sub = null
      out.set(b.id, parts.join('.') + (p.dot ? '.' : ''))
    } else {
      const prev: Sub | null = sub
      const added = prev && prev.kind === p.kind ? prev.added : 0
      sub = { kind: p.kind, n: p.n + added, open: p.open, close: p.close, added }
      out.set(b.id, subLabel(p.kind, sub.n, p.open, p.close))
    }
  }
  cache.set(d, out)
  return out
}

/** A paragraph's number as it now reads (undefined: unnumbered). */
export const labelOf = (d: DocReview, b: DocBlock) => labelsOf(d).get(b.id) ?? (b.ours ? undefined : b.label)

/** "§2.4", or a description when it has no number. */
export function whereOf(d: DocReview, b: DocBlock): string {
  const l = labelOf(d, b)
  if (l) return /^\d/.test(l) ? `§${l.replace(/\.$/, '')}` : /^[A-Z][a-z]+ \d/.test(l) ? l.replace(/\.$/, '') : `Item ${l}`
  return b.ours ? 'New paragraph' : b.kind === 'heading' ? 'Heading' : 'Paragraph'
}
