import type { ChangeStatus, DocBlock, DocReview, TrackedSegment } from './types'

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
    const key: string | null = sectionKey(b.label) ?? (b.kind === 'row' ? b.id : section)
    if (sectionKey(b.label)) section = key
    if (!theyChanged(b)) {
      current = null
      continue
    }
    // Same section; or the section under a heading they changed (an inserted "5. NON-SOLICITATION" and its 5.1).
    const under = current?.set.blocks[0].kind === 'heading' && key?.startsWith(`${current.section}.`)
    if (current && key !== null && (key === current.section || under) && b.kind !== 'row') {
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
export const ourText = (doc: DocReview, b: DocBlock) => doc.edits[b.id] ?? (b.kind === 'deleted' ? '' : b.text)
