import type { DocBlock, Precedent, ReviewSession, SeenHit } from '@shared/types'
import { beforeTheirs, changeSets, segmentsOf, statusOf, type ChangeSet } from '@shared/changes'
import { PrecedentIndex } from './matcher'
import { canonical } from './text'

/**
 * "Seen before": a change set looked up in earlier negotiations. Every change
 * we decide is recorded (what they proposed, what was there, how we answered),
 * so the identical ask is recognised next time (same wording, or the same words
 * added to a different clause), and similar ones are found by keyword search.
 */

export const proposedOf = (set: ChangeSet) => set.blocks.filter((b) => b.kind !== 'deleted').map((b) => b.text).join('\n')
export const beforeOf = (set: ChangeSet) => set.blocks.map(beforeTheirs).filter(Boolean).join('\n')
/** The words they added and took out: what the change is about, for matching and search. */
export const insertedOf = (set: ChangeSet) => wordsOf(set.blocks, 'ins')
const deletedOf = (set: ChangeSet) => wordsOf(set.blocks, 'del')
const wordsOf = (blocks: DocBlock[], op: 'ins' | 'del') =>
  blocks
    .flatMap((b) => segmentsOf(b).filter((s) => s.op === op).map((s) => s.text.trim()))
    .filter(Boolean)
    .join(' … ')

const precedentId = (s: ReviewSession, set: ChangeSet) => `rv-${s.id.slice(0, 8)}-${set.id}`

/** The section heading a change sits under, as a category ("Non-solicitation"). */
function categoryOf(s: ReviewSession, set: ChangeSet): string {
  const blocks = s.doc!.blocks
  const at = blocks.indexOf(set.blocks[0])
  for (let i = at; i >= 0; i--) {
    const b = blocks[i]
    if (b.kind === 'heading' && b.text.trim()) return b.text.charAt(0) + b.text.slice(1).toLowerCase()
  }
  return 'General'
}

/**
 * Record (or withdraw) a change set as negotiation history, from how it now stands:
 * accepted, or answered with our wording. Open and flagged changes aren't history yet.
 */
export function precedentFor(s: ReviewSession, set: ChangeSet, counterparty: string): { id: string; precedent: Precedent | null } {
  const d = s.doc!
  const id = precedentId(s, set)
  const status = statusOf(d, set)
  if (status !== 'accepted' && status !== 'countered') return { id, precedent: null }
  const ours = set.blocks.map((b) => d.edits[b.id] ?? null)
  const restored = ours.every((t, i) => t === null || canonical(t) === canonical(beforeTheirs(set.blocks[i])))
  const struck = ours.every((t) => t === null || t === '')
  const response = status === 'accepted' ? 'accepted' : struck ? 'struck' : restored ? 'restored' : 'countered'
  const ids = new Set(set.blocks.map((b) => b.id))
  const notes = [d.decisions[set.id]?.note, ...d.comments.filter((c) => ids.has(c.blockId)).map((c) => c.text)].filter(Boolean).join(' ')
  const at = d.decisions[set.id]?.at ?? new Date().toISOString()
  return {
    id,
    precedent: {
      id,
      contractType: s.contractType,
      category: categoryOf(s, set),
      counterparty,
      date: at.slice(0, 10),
      text: proposedOf(set) || beforeOf(set),
      outcome: status === 'accepted' ? 'accepted' : 'rejected',
      notes: notes || `${RESPONSE[response]} in the review of ${s.docName}.`,
      source: 'review',
      where: set.where,
      before: beforeOf(set),
      inserted: insertedOf(set) || undefined,
      response,
      ours: status === 'accepted' ? undefined : ours
    }
  }
}

export const RESPONSE = { accepted: 'Accepted', countered: 'Countered with our wording', restored: 'Restored our original wording', struck: 'Struck' } as const

/** Earlier negotiations for each change set in a review: identical changes first, then similar ones. */
export function seenBefore(s: ReviewSession, precedents: Precedent[]): Record<string, SeenHit[]> {
  const own = `rv-${s.id.slice(0, 8)}-`
  const pool = precedents.filter((p) => !p.id.startsWith(own))
  const index = new PrecedentIndex(pool)
  const out: Record<string, SeenHit[]> = {}
  for (const set of changeSets(s.doc!)) {
    const proposed = canonical(proposedOf(set))
    const inserted = canonical(insertedOf(set))
    const identical = pool.filter(
      (p) => (proposed && canonical(p.text) === proposed && (!p.before || canonical(p.before) === canonical(beforeOf(set)) || !theyAdded(set))) || (inserted.length > 20 && p.inserted && canonical(p.inserted) === inserted)
    )
    const query = [insertedOf(set), deletedOf(set)].filter(Boolean).join(' ') || proposedOf(set)
    const similar = index
      .searchText(query, 4)
      .filter((h) => !identical.some((p) => p.id === h.id) && h.score >= 0.5 && h.terms.length >= 3)
      .slice(0, 3)
    const hits: SeenHit[] = [...identical.map((p) => ({ ...p, score: 1, terms: [], match: 'identical' as const })), ...similar.map((h) => ({ ...h, match: 'similar' as const }))]
    if (hits.length) out[set.id] = hits
  }
  return out
}

const theyAdded = (set: ChangeSet) => set.blocks.some((b) => segmentsOf(b).some((x) => x.op === 'ins'))
