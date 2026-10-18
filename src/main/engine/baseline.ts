import type { Baseline, DocBlock, LastRound, LibraryClause, ReviewSession } from '@shared/types'
import { beforeTheirs, ourText, theyChanged } from '@shared/changes'
import { diffSegments } from '@shared/diff'
import { canonical, similarity } from './text'

/**
 * Changes they didn't track. A draft can come back with edits made without
 * Track Changes, so each new draft is compared with a baseline:
 *
 *  - 'sent': the wording we sent back last round (their text with our edits),
 *    when this is a later version of a contract we've reviewed here;
 *  - 'template': our pre-approved wording, when the draft is on our paper
 *    (much of it is word for word our library) and there's no earlier round.
 *
 * Paragraphs that differ get the difference as their redline, marked untracked,
 * so they show up as changes to decide like any tracked change. Nothing here is
 * AI: it's paragraph alignment and a word diff.
 */

const CLOSE = 0.45
const sameText = (a: string, b: string) => canonical(a) === canonical(b)
const where = (label?: string, text = '') => (label ? `§${label.replace(/\.$/, '')}` : text.slice(0, 40))

interface Sent {
  label?: string
  text: string
  ourEdit: boolean
  comments: string[]
}

/** What we sent back: every paragraph as we left it (struck ones gone, restored ones back). */
export function whatWeSent(prev: ReviewSession): Sent[] {
  const d = prev.doc!
  const out: Sent[] = []
  for (const b of d.blocks) {
    const text = ourText(d, b)
    if (!text.trim()) continue
    out.push({ label: b.label, text, ourEdit: d.edits[b.id] !== undefined, comments: d.comments.filter((c) => c.blockId === b.id).map((c) => c.text) })
  }
  return out
}

/** Paragraph-level LCS on exact wording: the anchors between which changed paragraphs are paired up. */
function anchors(a: string[], b: string[]): [number, number][] {
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push([i++, j++])
    else if (L[i + 1][j] >= L[i][j + 1]) i++
    else j++
  }
  return out
}

/**
 * Compare a new draft with what we sent. Returns the blocks (with untracked
 * changes as redlines, and paragraphs they removed silently as deleted blocks),
 * what we proposed for each paragraph last round, and a summary.
 */
export function compareWithSent(prev: ReviewSession, blocks: DocBlock[]): { blocks: DocBlock[]; lastRound: Record<string, LastRound>; baseline: Baseline } {
  const sent = whatWeSent(prev)
  // Their tracked insertions weren't in what we sent; compare everything else as it stood before their new changes.
  const cmp = blocks.filter((b) => b.kind !== 'heading' || !isInserted(b))
  const before = cmp.map((b) => canonical(beforeTheirs(b)))
  const pairs = anchors(
    sent.map((s) => canonical(s.text)),
    before
  )
  const match = new Map<DocBlock, Sent>()
  const removed: { after: DocBlock | null; s: Sent }[] = []

  // Pair up what's left between consecutive anchors: the closest paragraph, else added / removed.
  const gaps: [number, number, number, number][] = []
  let pi = 0
  let pj = 0
  for (const [i, j] of [...pairs, [sent.length, cmp.length] as [number, number]]) {
    gaps.push([pi, i, pj, j])
    if (i < sent.length) match.set(cmp[j], sent[i])
    pi = i + 1
    pj = j + 1
  }
  for (const [i0, i1, j0, j1] of gaps) {
    const left = new Set<number>()
    for (let i = i0; i < i1; i++) left.add(i)
    for (let j = j0; j < j1; j++) {
      const b = cmp[j]
      if (isInserted(b)) continue
      let best: { i: number; score: number } | null = null
      for (const i of left) {
        const score = similarity(sent[i].text, beforeTheirs(b)).score + (sent[i].label && sent[i].label === b.label ? 0.15 : 0)
        if (score >= CLOSE && (!best || score > best.score)) best = { i, score }
      }
      if (best) {
        match.set(b, sent[best.i])
        left.delete(best.i)
      }
    }
    for (const i of left) removed.push({ after: j0 > 0 ? cmp[j0 - 1] : null, s: sent[i] })
  }

  const lastRound: Record<string, LastRound> = {}
  const accepted: string[] = []
  let untracked = 0
  const out: DocBlock[] = []
  let synth = 0
  const pushRemoved = (after: DocBlock | null) => {
    for (const r of removed.filter((x) => x.after === after)) {
      untracked++
      const id = `x${synth++}`
      out.push({ id, kind: 'deleted', label: r.s.label, text: r.s.text, segments: [{ op: 'del', text: r.s.text }], untracked: 'sent' })
      lastRound[id] = { sent: r.s.text, ourEdit: r.s.ourEdit, comments: r.s.comments }
    }
  }
  pushRemoved(null)
  for (const b of blocks) {
    const s = match.get(b)
    let next = b
    if (s) {
      lastRound[b.id] = { sent: s.text, ourEdit: s.ourEdit, comments: s.comments }
      if (!sameText(s.text, beforeTheirs(b))) {
        // Changed since we sent it, without Track Changes: show it against what we sent.
        untracked++
        next = { ...b, kind: b.kind === 'deleted' ? 'deleted' : b.kind, segments: diffSegments(s.text, b.kind === 'deleted' ? '' : b.text), untracked: 'sent' }
        if (b.kind === 'deleted') next.segments = [{ op: 'del', text: s.text }]
      } else if (s.ourEdit && !theyChanged(b)) accepted.push(where(b.label, b.text))
    } else if (!isInserted(b) && b.kind !== 'heading' && b.text.trim()) {
      // Not in what we sent at all, and not a tracked insertion: added silently.
      untracked++
      next = { ...b, segments: [{ op: 'ins', text: b.text }], untracked: 'sent' }
    }
    out.push(next)
    pushRemoved(b)
  }
  return { blocks: out, lastRound, baseline: { kind: 'sent', version: prev.version, ourEditsAccepted: accepted, untracked } }
}

const isInserted = (b: DocBlock) => !!b.segments?.length && b.segments.every((s) => s.op === 'ins' || !s.text.trim())

/** How much of a draft must be word for word our library for it to count as "on our paper". */
const ON_OUR_PAPER = 0.4
const MIN_WORDS = 8

/** How much of a draft is word for word our approved wording (substantial paragraphs only). */
export function paperCheck(blocks: DocBlock[], library: LibraryClause[]): { paragraphs: number; approved: number; looksOurs: boolean } {
  const byText = new Set(library.map((c) => canonical(c.text)))
  const eligible = blocks.filter((b) => (b.kind === 'para' || b.kind === 'row') && b.text.split(/\s+/).length >= MIN_WORDS)
  const approved = eligible.filter((b) => byText.has(canonical(b.text)) || (theyChanged(b) && byText.has(canonical(beforeTheirs(b))))).length
  return { paragraphs: eligible.length, approved, looksOurs: !!library.length && !!eligible.length && approved / eligible.length >= ON_OUR_PAPER }
}

/**
 * Compare a first draft with our pre-approved wording. Paragraphs that are
 * word for word ours are noted; paragraphs close to one of ours but different
 * become an untracked change against it; on our paper, paragraphs that aren't
 * ours at all are shown as added. Drafts that aren't on our paper are left alone,
 * unless `ours` (the reviewer said it's ours).
 */
export function compareWithTemplate(blocks: DocBlock[], library: LibraryClause[], ours = false): { blocks: DocBlock[]; baseline: Baseline | null } {
  const byText = new Map(library.map((c) => [canonical(c.text), c]))
  // Tracked changes are already shown; note when they change, or produce, our approved wording.
  const out = blocks.map((b): DocBlock => {
    const approved = b.kind !== 'deleted' ? byText.get(canonical(b.text))?.title : undefined
    const was = theyChanged(b) ? byText.get(canonical(beforeTheirs(b)))?.title : undefined
    return approved || was ? { ...b, approved, wasApproved: was !== approved ? was : undefined } : b
  })
  const eligible = out.filter((b) => (b.kind === 'para' || b.kind === 'row') && b.text.split(/\s+/).length >= MIN_WORDS)
  if (!library.length || !eligible.length) return { blocks: out, baseline: null }
  const exact = eligible.filter((b) => b.approved || b.wasApproved).length
  // On our paper: the reviewer said so, or enough of it is our wording word for word.
  if (!ours && exact / eligible.length < ON_OUR_PAPER) return { blocks: out, baseline: null }

  let untracked = 0
  const result = out.map((b) => {
    if (!eligible.includes(b) || theyChanged(b) || b.approved) return b
    let best: { c: LibraryClause; score: number } | null = null
    for (const c of library) {
      const score = similarity(c.text, b.text).score
      if (score >= CLOSE && (!best || score > best.score)) best = { c, score }
    }
    untracked++
    if (best) return { ...b, segments: diffSegments(best.c.text, b.text), untracked: 'template' as const, standard: best.c.title }
    return { ...b, segments: [{ op: 'ins' as const, text: b.text }], untracked: 'template' as const }
  })
  return { blocks: result, baseline: { kind: 'template', ourEditsAccepted: [], untracked, approved: exact } }
}
