import { createHash } from 'node:crypto'
import type { DiffToken } from '@shared/types'

/**
 * Canonical form used for exact matching. Deliberately conservative: it only
 * erases differences that cannot change meaning (case, whitespace, quote and
 * dash styles, a leading clause number, trailing full stop).
 */
export function canonical(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/^\s*\d+(\.\d+)*\.?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]$/, '')
    .toLowerCase()
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function tokens(text: string): string[] {
  return canonical(text)
    .replace(/[^a-z0-9'%£$€\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function shingles(toks: string[], n = 3): Set<string> {
  const out = new Set<string>()
  if (toks.length < n) {
    out.add(toks.join(' '))
    return out
  }
  for (let i = 0; i <= toks.length - n; i++) out.add(toks.slice(i, i + n).join(' '))
  return out
}

/** Length of the longest common token subsequence (word order aware). */
function lcsLength(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0)
  const cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

export interface Similarity {
  score: number
  shingleJaccard: number
  orderedOverlap: number
  contentOverlap: number
  lengthRatio: number
}

const STOPWORDS = new Set(
  'the a an and or of to in on for by with as at be is are was were shall will may any all such this that its it their which from under than other each party parties agreement not no'.split(' ')
)

function contentWords(toks: string[]): Set<string> {
  return new Set(toks.filter((w) => w.length > 2 && !STOPWORDS.has(w)))
}

/**
 * Lexical similarity blending four signals:
 *  - 3-word shingle Jaccard: shared runs of words (phrasing)
 *  - LCS ratio: same words in the same order
 *  - content-word Dice: same vocabulary regardless of order (catches paraphrase)
 *  - length ratio: penalises a short clause matching a long one
 */
export function similarity(a: string, b: string): Similarity {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return { score: 0, shingleJaccard: 0, orderedOverlap: 0, contentOverlap: 0, lengthRatio: 0 }
  const sa = shingles(ta)
  const sb = shingles(tb)
  let inter = 0
  for (const s of sa) if (sb.has(s)) inter++
  const shingleJaccard = inter / (sa.size + sb.size - inter)
  const orderedOverlap = lcsLength(ta, tb) / Math.max(ta.length, tb.length)
  const ca = contentWords(ta)
  const cb = contentWords(tb)
  let shared = 0
  for (const w of ca) if (cb.has(w)) shared++
  const contentOverlap = ca.size + cb.size ? (2 * shared) / (ca.size + cb.size) : 0
  const lengthRatio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length)
  const score = 0.3 * shingleJaccard + 0.3 * orderedOverlap + 0.3 * contentOverlap + 0.1 * lengthRatio
  return { score, shingleJaccard, orderedOverlap, contentOverlap, lengthRatio }
}

/** Word-level diff (from -> to) for showing what a counterparty changed. */
export function wordDiff(from: string, to: string): DiffToken[] {
  const a = from.replace(/\s+/g, ' ').trim().split(' ')
  const b = to.replace(/\s+/g, ' ').trim().split(' ')
  const key = (w: string) => w.toLowerCase().replace(/[^a-z0-9%£$]/g, '')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const out: DiffToken[] = []
  const push = (op: DiffToken['op'], w: string) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += ' ' + w
    else out.push({ op, text: w })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      push('same', b[j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++])
    else push('add', b[j++])
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return out
}
