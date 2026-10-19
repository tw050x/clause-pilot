import type { TrackedSegment } from './types'

export interface DiffOp {
  /** Character range of `old` to delete (empty for a pure insertion). */
  from: number
  to: number
  /** Text inserted after that range. */
  insert: string
}

/** Changes this close together (unchanged words between them) read as one: "~~shall be free~~ any right". */
const MERGE_GAP_WORDS = 2
/** Past this share of the paragraph changed, it's a rewrite: shown as one replacement. */
const REWRITE_SHARE = 0.5

/**
 * Word-level diff from `old` to `next`, as replacements over character ranges
 * of `old`. Used both to show our edits on screen and to write them into the
 * Word file as tracked changes, so the two always agree. Changes are whole words
 * (never part of one), changes a word or two apart are one change, and a
 * paragraph mostly rewritten is one replacement (the words it starts and ends
 * with aside, if they're the same): the old struck as a block, the new after it.
 */
// (`wholeWords` is kept for callers; changes are always whole words now.)
export function diffWords(old: string, next: string, _wholeWords = false): DiffOp[] {
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
  // Changes a word or two apart: one change, the words between them struck and written again.
  const words = (from: number, to: number) => (old.slice(from, to).match(/\S+/g) ?? []).length
  for (let k = ops.length - 1; k > 0; k--) {
    const x = ops[k - 1]
    const y = ops[k]
    if (words(x.to, y.from) > MERGE_GAP_WORDS) continue
    ops.splice(k - 1, 2, { from: x.from, to: y.to, insert: x.insert + old.slice(x.to, y.from) + y.insert })
  }
  // Mostly rewritten: one replacement, between the words it starts and ends with unchanged.
  const gone = ops.reduce((n, op) => n + (op.to - op.from), 0)
  const added = ops.reduce((n, op) => n + op.insert.length, 0)
  if (ops.length > 1 && (gone / (old.length || 1) + added / (next.length || 1)) / 2 > REWRITE_SHARE) {
    let pre = 0
    while (pre < a.length && pre < b.length && a[pre].word === b[pre].word) pre++
    let suf = 0
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].word === b[b.length - 1 - suf].word) suf++
    const from = pre < a.length ? a[pre].at : old.length
    const to = suf ? a[a.length - suf].at : old.length
    const insert = b.slice(pre, b.length - suf).map((t) => t.text).join('')
    ops.splice(0, ops.length, { from, to, insert })
  }
  // Spacing: an insertion at the very end of text with no trailing space needs a leading one.
  for (const op of ops) {
    if (!op.insert) continue
    const atEnd = op.to >= old.length
    if (atEnd && old && op.to === op.from && !/\s$/.test(old)) op.insert = ' ' + op.insert.trimEnd()
    else if (!atEnd && !/\s$/.test(op.insert)) op.insert += ' '
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
