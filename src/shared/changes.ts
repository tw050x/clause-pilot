import type { ChangeStatus, DocBlock, DocReview, TrackedSegment } from './types'
import { overlay, type Mark } from './diff'

/** Their redline on a block (plain text when they didn't change it). */
export const segmentsOf = (b: DocBlock): TrackedSegment[] =>
  b.kind === 'deleted' ? [{ op: 'del', text: b.text, author: b.segments?.[0]?.author, date: b.segments?.[0]?.date }] : b.segments ?? [{ op: 'same', text: b.text }]

/** Did they change this block? */
export const theyChanged = (b: DocBlock) => b.kind === 'deleted' || !!b.segments?.some((s) => s.op !== 'same')

/** The block as it was before their changes: their insertions out, their deletions back in. */
export const beforeTheirs = (b: DocBlock) =>
  segmentsOf(b)
    .filter((s) => s.op !== 'ins')
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

/** Who made a block's changes (for "Edited by Acme Legal"). */
export const authorsOf = (blocks: DocBlock[]) => [...new Set(blocks.flatMap((b) => segmentsOf(b).filter((s) => s.op !== 'same').map((s) => s.author ?? 'Unknown')))]

export interface ChangeSet {
  /** Its first block's id; decisions are keyed by it. */
  id: string
  blocks: DocBlock[]
  /** "§2.1", "Cover: Governing Law" — where it is, for lists and the email. */
  where: string
}

/** The section a block belongs to, for grouping: "2.1" for 2.1, 2.1.3 and the (a), (b) lines under them. */
function sectionKey(label: string | undefined): string | null {
  if (!label || !/^\d/.test(label)) return null
  const parts = label.replace(/\.$/, '').split('.')
  return parts.slice(0, 2).join('.')
}

/**
 * Their changes, grouped into change sets: everything they changed in one
 * paragraph, and consecutive changed paragraphs in the same numbered section
 * (2.1 and the (a), (b) lines under it), are one thing to decide. A heading,
 * an unchanged paragraph or a new section ends a set. Grouping only uses the
 * numbering; nothing depends on splitting the contract into clauses.
 */
export function changeSets(doc: DocReview): ChangeSet[] {
  const sets: ChangeSet[] = []
  let section: string | null = null
  let current: { set: ChangeSet; section: string | null } | null = null
  for (const b of doc.blocks) {
    if (b.kind === 'heading') {
      section = null
      current = null
      if (!theyChanged(b)) continue
    }
    // Rows, and unnumbered paragraphs found by comparison (party details, a signature block), stand alone.
    const alone = b.kind === 'row' || (!b.label && !!b.untracked)
    const key: string | null = sectionKey(b.label) ?? (alone ? null : section)
    if (sectionKey(b.label)) section = key
    if (!theyChanged(b)) {
      current = null
      continue
    }
    // Same section; or the section under a heading they changed (an inserted "5. NON-SOLICITATION" and its 5.1).
    const under = current?.set.blocks[0].kind === 'heading' && key?.startsWith(`${current.section}.`)
    if (current && key !== null && !alone && (key === current.section || under)) {
      current.set.blocks.push(b)
    }
    else {
      current = { set: { id: b.id, blocks: [b], where: whereOf(b, key) }, section: key }
      sets.push(current.set)
    }
  }
  return sets
}

function whereOf(b: DocBlock, section: string | null): string {
  if (b.kind === 'row') return b.text.split(' — ')[0].slice(0, 40)
  // A heading names its section: "§5 Non-solicitation".
  if (b.kind === 'heading' && b.label) return `§${b.label.replace(/\.$/, '')} ${b.text.charAt(0)}${b.text.slice(1).toLowerCase()}`
  if (b.label && /^\d/.test(b.label)) return `§${b.label.replace(/\.$/, '')}`
  if (section) return `§${section}`
  return b.text.slice(0, 40) + (b.text.length > 40 ? '…' : '')
}

export type SetStatus = ChangeStatus | 'open'

/** A change set's status: decided explicitly, or countered as soon as we edit any of it. */
export function statusOf(doc: DocReview, set: ChangeSet): SetStatus {
  const d = doc.decisions[set.id]
  if (d) return d.status
  if (set.blocks.some((b) => doc.edits[b.id] !== undefined)) return 'countered'
  return 'open'
}

/** Our edits outside any change set: changes we're making to text they didn't touch. */
export function ourOtherEdits(doc: DocReview, sets: ChangeSet[]): DocBlock[] {
  const inSets = new Set(sets.flatMap((s) => s.blocks.map((b) => b.id)))
  return doc.blocks.filter((b) => doc.edits[b.id] !== undefined && !inSets.has(b.id))
}

/** The block as we'd have it (our edit, or as received). */
/**
 * The paragraph as we send it back: their changes as we accepted or rejected them, with our
 * wording over that. Changes left undecided go back as they proposed them.
 */
export const ourText = (doc: DocReview, b: DocBlock) => shownText(marksFor(doc, b)).replace(/\s+/g, ' ').trim()

// ---- individual changes: accept / reject, as in Word -------------------------------------

export const changeKey = (blockId: string, seg: number) => `${blockId}:${seg}`

/**
 * Their redline with the changes we've accepted or rejected resolved: an accepted insertion
 * or rejected deletion becomes plain text, an accepted deletion or rejected insertion goes.
 * Each segment keeps its index in the redline as received.
 */
export function effectiveSegments(doc: DocReview, b: DocBlock): TrackedSegment[] {
  const out: TrackedSegment[] = []
  let resolved = false
  segmentsOf(b).forEach((s, i) => {
    const r = s.op === 'same' ? undefined : doc.resolved?.[changeKey(b.id, i)]
    if (!r) return out.push({ ...s, i })
    resolved = true
    const keep = (s.op === 'ins') === (r === 'accepted')
    if (keep) out.push({ op: 'same', text: s.text, i })
  })
  if (!resolved) return out
  // The text as it now reads: plain runs joined, and no double spaces where something went.
  const tidy: TrackedSegment[] = []
  for (const s of out) {
    const last = tidy[tidy.length - 1]
    if (last && last.op === 'same' && s.op === 'same') last.text += s.text
    else tidy.push({ ...s })
  }
  let prevSpace = true // the start of the paragraph counts as a space
  for (const s of tidy) {
    if (s.op === 'del') continue
    s.text = s.text.replace(/\s+/g, ' ')
    if (prevSpace) s.text = s.text.replace(/^ /, '')
    if (s.text) prevSpace = s.text.endsWith(' ')
  }
  return tidy.filter((s) => s.text)
}

/** Does the paragraph still have changes of theirs to decide (tracked or found by comparison)? */
export const hasOpenChanges = (doc: DocReview, b: DocBlock) => effectiveSegments(doc, b).some((s) => s.op !== 'same')

/** A paragraph as shown: their redline (as resolved) with our wording over it. */
export function marksFor(doc: DocReview, b: DocBlock): Mark[] {
  const edit = doc.edits[b.id]
  if (b.ours) return edit ? [{ text: edit, ours: 'ins' }] : []
  const segs = effectiveSegments(doc, b)
  if (b.kind === 'deleted' && segs.every((s) => s.op === 'del')) {
    // Their deletion of the whole paragraph; restoring it lays our wording over nothing.
    const struck = segs.map((s) => ({ text: s.text, theirs: 'del' as const, author: s.author, seg: s.i }))
    return edit === undefined ? struck : [...struck, ...(edit ? [{ text: ' ' + edit, ours: 'ins' as const }] : [])]
  }
  return overlay(segs, edit)
}

/** The text a paragraph shows (struck text left out). */
export const shownText = (marks: Mark[]) => marks.filter((m) => m.theirs !== 'del' && m.ours !== 'del').map((m) => m.text).join('')

/**
 * The paragraph's text with some marks flipped: one of our insertions taken out or one of our
 * deletions put back (undoing it), or their change `seg` taken out (rejected insertion) or
 * put back (rejected deletion).
 */
export function textWithout(marks: Mark[], pick: (m: Mark, i: number) => boolean): string {
  return marks
    .map((m, i) => {
      const visible = m.theirs !== 'del' && m.ours !== 'del'
      if (!pick(m, i)) return visible ? m.text : ''
      if (m.ours === 'ins') return ''
      if (m.ours === 'del') return m.text
      if (m.theirs === 'ins') return ''
      if (m.theirs === 'del') return m.text
      return m.text
    })
    .join('')
}

/**
 * Nothing left to read: word for word our approved wording, exactly what we sent last round,
 * or marked as checked by the reviewer (while it still reads the same).
 */
export const isCleared = (doc: DocReview, b: DocBlock) =>
  !theyChanged(b) && !b.ours && (!!b.approved || (doc.baseline?.kind === 'sent' && !!doc.lastRound?.[b.id]) || markedChecked(doc, b))

/** The reviewer marked it as checked, and it hasn't changed since. */
export const markedChecked = (doc: DocReview, b: DocBlock) => {
  const m = doc.checked?.[b.id]
  return !!m && m.text === proposedText(doc, b)
}

/** A paragraph with nothing to accept or reject that hasn't been cleared: someone has to read it. */
export const needsReading = (doc: DocReview, b: DocBlock) =>
  b.kind !== 'deleted' && b.kind !== 'heading' && !b.ours && !hasOpenChanges(doc, b) && doc.edits[b.id] === undefined && !theyChanged(b) && !isCleared(doc, b)

/**
 * Paragraphs the AI can check for meaning: changed (tracked or not) from one of our approved
 * clauses, or (their paper) not yet read and close by keywords to some of our clauses.
 */
export const intentCandidate = (doc: DocReview, b: DocBlock) =>
  b.kind !== 'deleted' &&
  !b.ours &&
  doc.edits[b.id] === undefined &&
  ((!!(b.standard ?? b.wasApproved) && hasOpenChanges(doc, b)) || (!!b.matches?.length && needsReading(doc, b)))

/** The paragraph as they propose it now (their changes, as decided so far; none of our wording). */
export const proposedText = (doc: DocReview, b: DocBlock) => shownText(marksFor({ ...doc, edits: {} }, b))

/** The AI found it means the same as our approved wording, for the text as it now stands. */
export const aiSame = (doc: DocReview, b: DocBlock) => {
  const r = doc.intent?.[b.id]
  return !!r && r.status === 'done' && !!r.same && r.text === proposedText(doc, b)
}

/**
 * Their changes in a paragraph as the reader sees them: a deletion straight followed by an
 * insertion (nothing but a space between) is one replacement, decided together. Each group
 * is the segment indexes in it; the first is its id.
 */
export function changeGroups(b: DocBlock): number[][] {
  const segs = segmentsOf(b)
  const groups: number[][] = []
  let last: number[] | null = null
  let gap = true // only whitespace since the last change
  segs.forEach((s, i) => {
    if (s.op === 'same') {
      if (s.text.trim()) gap = false
      return
    }
    const prev = last ? segs[last[last.length - 1]] : null
    if (last && last.length === 1 && gap && prev && prev.op !== s.op) last.push(i)
    else groups.push((last = [i]))
    gap = true
  })
  return groups
}

/** The group (replacement or single change) a segment belongs to. */
export const groupOf = (b: DocBlock, seg: number) => changeGroups(b).find((g) => g.includes(seg)) ?? [seg]

/**
 * Their changes here still to decide. A change found by comparison (not tracked in their file)
 * is rejected by restoring the wording with our edit, so a paragraph we put back exactly as
 * it was before their change is decided too.
 */
export const stillOpen = (doc: DocReview, b: DocBlock) => {
  if (!hasOpenChanges(doc, b)) return false
  const edit = doc.edits[b.id]
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
  return !(b.untracked && edit !== undefined && norm(edit) === norm(beforeTheirs(b)))
}

/** Their changes we rejected, counted as the reader sees them (a replacement is one). */
export const rejectedCount = (doc: DocReview) =>
  doc.blocks.reduce((n, b) => n + changeGroups(b).filter((g) => doc.resolved?.[changeKey(b.id, g[0])] === 'rejected').length, 0)

/**
 * Is a comment thread resolved? Our decision here if there is one, else what their file said.
 * Replies follow the comment they reply to.
 */
export function commentResolved(doc: DocReview, c: { id: string; done?: boolean; replyTo?: string }): boolean {
  const root = c.replyTo ?? c.id
  const here = doc.commentsDone?.[root]
  if (here) return here.done
  if (c.replyTo) {
    const parent = doc.blocks.flatMap((b) => b.comments ?? []).find((x) => x.id === c.replyTo)
    return !!parent?.done
  }
  return !!c.done
}
