import type { TrackedSegment } from './types'

export interface DiffOp {
  /** Character range of `old` to delete (empty for a pure insertion). */
  from: number
  to: number
  /** Text inserted after that range. */
  insert: string
}

/**
 * Word-level diff from `old` to `next`, as replacements over character ranges
 * of `old`. Used both to show our edits on screen and to write them into the
 * Word file as tracked changes, so the two always agree.
 */
export function diffWords(old: string, next: string, wholeWords = false): DiffOp[] {
  const tok = (s: string) => {
    const out: { word: string; text: string; at: number }[] = []
    for (const m of s.matchAll(/\S+\s*/g)) out.push({ word: m[0].trim(), text: m[0], at: m.index! })
    return out
  }
  const a = tok(old)
  const b = tok(next)
  // LCS table on words.
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i].word === b[j].word ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  let cur: { from: number; to: number; ins: string[] } | null = null
  const flush = () => {
    if (cur && (cur.to > cur.from || cur.ins.length)) ops.push({ from: cur.from, to: cur.to, insert: cur.ins.join('') })
    cur = null
  }
  const pos = (k: number) => (k < a.length ? a[k].at : old.length)
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      flush()
      i++
      j++
    } else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) {
      cur ??= { from: pos(i), to: pos(i), ins: [] }
      cur.ins.push(b[j].text)
      j++
    } else {
      cur ??= { from: pos(i), to: pos(i), ins: [] }
      cur.to = pos(i + 1)
      i++
    }
  }
  flush()
  // Spacing: an insertion at the very end of text with no trailing space needs a leading one.
  for (const op of ops) {
    if (!op.insert) continue
    const atEnd = op.to >= old.length
    if (atEnd && old && op.to === op.from && !/\s$/.test(old)) op.insert = ' ' + op.insert.trimEnd()
    else if (!atEnd && !/\s$/.test(op.insert)) op.insert += ' '
  }
  // Within a replaced word, mark only the characters that changed ("regarded" → "regar": "ded"
  // struck), as Word does. Only shared runs of two or more characters are kept.
  if (wholeWords) return ops
  for (const op of ops) {
    if (op.to === op.from || !op.insert) continue
    const gone = old.slice(op.from, op.to)
    let p = 0
    while (p < gone.length && p < op.insert.length && gone[p] === op.insert[p]) p++
    if (p < 2) p = 0
    let q = 0
    while (q < gone.length - p && q < op.insert.length - p && gone[gone.length - 1 - q] === op.insert[op.insert.length - 1 - q]) q++
    if (q < 2) q = 0
    op.from += p
    op.to -= q
    op.insert = op.insert.slice(p, op.insert.length - q)
  }
  return ops.filter((op) => op.to > op.from || op.insert)
}

/** One run of text as shown: their redline and ours, layered. */
export interface Mark {
  text: string
  theirs?: 'ins' | 'del'
  ours?: 'ins' | 'del'
  author?: string
  date?: string
  /** Which of their changes it is (index in the paragraph's redline), for theirs. */
  seg?: number
}

/**
 * Their redline with our edit on top. `segments` is their tracked changes (or
 * plain text); `ours` is our wording for the text as they proposed it. Their
 * deletions stay as they are; our deletions and insertions are laid over what
 * they proposed, the way Word shows two reviewers' changes.
 */
export function overlay(segments: TrackedSegment[], ours: string | undefined): Mark[] {
  const segOf = (s: TrackedSegment, k: number) => (s.op === 'same' ? undefined : (s.i ?? k))
  if (ours === undefined) return segments.map((s, k) => ({ text: s.text, theirs: s.op === 'same' ? undefined : s.op, author: s.author, date: s.date, seg: segOf(s, k) }))
  // Proposed characters, each with the redline it came from.
  type Ch = { c: string; seg: TrackedSegment; k: number }
  const items: ({ kind: 'del'; seg: TrackedSegment; k: number } | { kind: 'ch'; ch: Ch })[] = []
  segments.forEach((seg, k) => {
    if (seg.op === 'del') items.push({ kind: 'del', seg, k })
    else for (const c of seg.text) items.push({ kind: 'ch', ch: { c, seg, k } })
  })
  const proposed = segments.filter((s) => s.op !== 'del').map((s) => s.text).join('')
  const ops = diffWords(proposed, ours)
  const struck = new Uint8Array(proposed.length)
  const inserts = new Map<number, string>()
  for (const op of ops) {
    struck.fill(1, op.from, op.to)
    if (op.insert) inserts.set(op.to, (inserts.get(op.to) ?? '') + op.insert)
  }
  const out: Mark[] = []
  const push = (m: Mark) => {
    const last = out[out.length - 1]
    if (last && last.theirs === m.theirs && last.ours === m.ours && last.author === m.author && last.seg === m.seg) last.text += m.text
    else out.push(m)
  }
  let at = 0
  for (const it of items) {
    if (it.kind === 'del') {
      push({ text: it.seg.text, theirs: 'del', author: it.seg.author, date: it.seg.date, seg: segOf(it.seg, it.k) })
      continue
    }
    // Our insertion goes right after the text we struck (or at its point, if we struck nothing).
    const ins = inserts.get(at)
    if (ins) {
      push({ text: ins, ours: 'ins' })
      inserts.delete(at)
    }
    const s = it.ch.seg
    push({ text: it.ch.c, theirs: s.op === 'ins' ? 'ins' : undefined, ours: struck[at] ? 'del' : undefined, author: s.author, date: s.date, seg: segOf(s, it.ch.k) })
    at++
  }
  for (const v of inserts.values()) push({ text: v, ours: 'ins' }) // at the very end
  return out
}

/** A word-level diff from `old` to `next`, as redline segments (for changes found by comparison). */
export function diffSegments(old: string, next: string, author?: string, wholeWords = false): TrackedSegment[] {
  const out: TrackedSegment[] = []
  const push = (op: TrackedSegment['op'], text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push(op === 'same' ? { op, text } : { op, text, author })
  }
  let at = 0
  for (const op of diffWords(old, next, wholeWords)) {
    push('same', old.slice(at, op.from))
    push('del', old.slice(op.from, op.to))
    push('ins', op.insert)
    at = op.to
  }
  push('same', old.slice(at))
  return out
}
