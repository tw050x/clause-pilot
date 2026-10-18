import type { CheckedMark, CommentDone, DocBlock, DocReview, HistoryAction, OurComment } from './types'
import { marksFor, segmentsOf, shownText } from './changes'
import { whereOf } from './numbering'

/**
 * Undo history for a document review, by action.
 *
 * The review's editable state is a set of "facets": our wording per paragraph, each of their
 * changes we accepted or rejected, each comment of ours, each paragraph we added. An action
 * records the facets it changed, before and after. Undoing puts the "before" values back.
 *
 * An older action can be undone on its own unless a later action (not undone) changed one
 * of the same facets: that later action depends on it, so it has to be undone first (the UI
 * says which, and undoes them together). Redo puts "after" back, if nothing has changed
 * those facets since.
 */

export type Facets = Record<string, unknown>

/** The review's editable state, flattened to facets. */
export function snapshot(d: DocReview): Facets {
  const f: Facets = {}
  for (const [id, text] of Object.entries(d.edits)) f[`edit:${id}`] = text
  for (const [key, r] of Object.entries(d.resolved ?? {})) f[`res:${key}`] = r
  for (const c of d.comments) f[`com:${c.id}`] = c
  for (const [id, m] of Object.entries(d.checked ?? {})) f[`chk:${id}`] = m
  for (const [id, m] of Object.entries(d.commentsDone ?? {})) f[`cdone:${id}`] = m
  d.blocks.forEach((b, i) => {
    if (b.ours) f[`para:${b.id}`] = { block: b, after: d.blocks[i - 1]?.id ?? null }
  })
  return f
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** What changed between two snapshots, as before/after values (null: absent). */
export function diff(before: Facets, after: Facets): { before: Facets; after: Facets } {
  const out = { before: {} as Facets, after: {} as Facets }
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[k], after[k])) continue
    out.before[k] = before[k] ?? null
    out.after[k] = after[k] ?? null
  }
  return out
}

/** Set facets on the review (null removes). Paragraphs first, so wording has somewhere to go. */
export function apply(d: DocReview, values: Facets) {
  const keys = Object.keys(values).sort((a, b) => Number(b.startsWith('para:')) - Number(a.startsWith('para:')))
  for (const k of keys) {
    const v = values[k]
    const [kind, ...rest] = k.split(':')
    const id = rest.join(':')
    if (kind === 'edit') {
      if (v === null) delete d.edits[id]
      else d.edits[id] = v as string
    } else if (kind === 'res') {
      d.resolved ??= {}
      if (v === null) delete d.resolved[id]
      else d.resolved[id] = v as 'accepted' | 'rejected'
    } else if (kind === 'cdone') {
      d.commentsDone ??= {}
      if (v === null) delete d.commentsDone[id]
      else d.commentsDone[id] = v as CommentDone
    } else if (kind === 'chk') {
      d.checked ??= {}
      if (v === null) delete d.checked[id]
      else d.checked[id] = v as CheckedMark
    } else if (kind === 'com') {
      // In place, so undoing an edit doesn't move the comment to the end of its thread.
      const at = d.comments.findIndex((c) => c.id === id)
      if (v === null) d.comments = d.comments.filter((c) => c.id !== id)
      else if (at >= 0) d.comments[at] = v as OurComment
      else d.comments.push(v as OurComment)
    } else if (kind === 'para') {
      d.blocks = d.blocks.filter((b) => b.id !== id)
      if (v !== null) {
        const { block, after } = v as { block: DocBlock; after: string | null }
        const at = after ? d.blocks.findIndex((b) => b.id === after) + 1 : 0
        d.blocks.splice(at, 0, block)
      }
    }
  }
}

/**
 * What a facet is about, for dependencies: the paragraph (its wording and the changes in it
 * go together: an edit made after accepting a change builds on it), or the comment itself.
 */
const scope = (k: string) => (k.startsWith('com:') || k.startsWith('cdone:') ? k : k.split(':')[1])

/** Actions after `a`, still in effect, that changed the same paragraphs (and their dependents, and so on). */
export function dependents(history: HistoryAction[], a: HistoryAction): HistoryAction[] {
  const touched = new Set(Object.keys(a.after).map(scope))
  const out: HistoryAction[] = []
  for (const x of history.slice(history.indexOf(a) + 1)) {
    if (x.undone) continue
    if (!Object.keys(x.after).some((k) => touched.has(scope(k)))) continue
    out.push(x)
    for (const k of Object.keys(x.after)) touched.add(scope(k))
  }
  return out
}

/** Can an undone action be redone? Only if the paragraphs it changed are still as it found them. */
export function canRedo(d: DocReview, a: HistoryAction): boolean {
  const now = snapshot(d)
  if (!Object.keys(a.before).every((k) => same(now[k], a.before[k]))) return false
  // Nothing done since (and still in effect) in the same paragraphs.
  const touched = new Set(Object.keys(a.after).map(scope))
  const history = d.history ?? []
  return !history.slice(history.indexOf(a) + 1).some((x) => !x.undone && Object.keys(x.after).some((k) => touched.has(scope(k))))
}

/** "Accepted 3 and rejected 1 of their changes in §1.3", "Edited §2.1", … */
export function describe(d: DocReview, a: HistoryAction): string {
  const blocks = new Map(d.blocks.map((b) => [b.id, b]))
  const where = (id: string) => {
    const b = blocks.get(id) ?? ((a.before[`para:${id}`] ?? a.after[`para:${id}`]) as { block: DocBlock } | null)?.block
    if (!b) return 'a paragraph'
    const w = whereOf(d, b)
    return w.startsWith('§') || w.startsWith('Item') ? w : `a ${w.toLowerCase()}`
  }
  const places = (ids: string[]) => {
    const w = [...new Set(ids.map(where))]
    return w.length > 3 ? `${w.slice(0, 3).join(', ')} and ${w.length - 3} more` : w.join(', ')
  }
  const keys = Object.keys(a.after)
  const res = keys.filter((k) => k.startsWith('res:'))
  const parts: string[] = []
  if (res.length) {
    const n = (v: string | null) => res.filter((k) => (a.after[k] ?? null) === v).length
    const bits = [n('accepted') && `accepted ${n('accepted')}`, n('rejected') && `rejected ${n('rejected')}`, n(null) && `reopened ${n(null)}`].filter(Boolean)
    const ids = res.map((k) => k.split(':')[1])
    const total = res.length
    if (total === 1) parts.push(`${n('accepted') ? 'accepted' : n('rejected') ? 'rejected' : 'reopened'} their change in ${places(ids)}`)
    else parts.push(`${bits.join(' and ')} of their changes in ${places(ids)}`)
  }
  const paras = keys.filter((k) => k.startsWith('para:'))
  const added = paras.filter((k) => a.after[k] !== null).length
  const removed = paras.length - added
  if (added) parts.push(`added ${added === 1 ? 'a paragraph' : `${added} paragraphs`}`)
  if (removed) parts.push(`removed ${removed === 1 ? 'a paragraph' : `${removed} paragraphs`}`)
  const edits = keys.filter((k) => k.startsWith('edit:') && !paras.includes(`para:${k.slice(5)}`)).map((k) => k.slice(5))
  if (edits.length && !res.length) parts.push(`edited ${places(edits)}`)
  const chk = keys.filter((k) => k.startsWith('chk:'))
  const chkOn = chk.filter((k) => a.after[k] !== null).map((k) => k.slice(4))
  const chkOff = chk.filter((k) => a.after[k] === null).map((k) => k.slice(4))
  if (chkOn.length) parts.push(`marked ${places(chkOn)} as checked`)
  if (chkOff.length) parts.push(`unmarked ${places(chkOff)}`)
  const cdone = keys.filter((k) => k.startsWith('cdone:'))
  const resolvedN = cdone.filter((k) => (a.after[k] as CommentDone | null)?.done).length
  if (resolvedN) parts.push(`resolved ${resolvedN === 1 ? 'a comment' : `${resolvedN} comments`}`)
  if (cdone.length - resolvedN) parts.push(`reopened ${cdone.length - resolvedN === 1 ? 'a comment' : `${cdone.length - resolvedN} comments`}`)
  const coms = keys.filter((k) => k.startsWith('com:'))
  const cAdded = coms.filter((k) => a.after[k] !== null && a.before[k] === null)
  const cEdited = coms.filter((k) => a.after[k] !== null && a.before[k] !== null)
  const cDeleted = coms.filter((k) => a.after[k] === null)
  if (cAdded.length) parts.push(`commented on ${places(cAdded.map((k) => (a.after[k] as OurComment).blockId))}`)
  if (cEdited.length) parts.push(`edited ${cEdited.length === 1 ? 'a comment' : `${cEdited.length} comments`}`)
  if (cDeleted.length) parts.push(`deleted ${cDeleted.length === 1 ? 'a comment' : 'comments'}`)
  const text = parts.join('; ') || 'No change'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One thing an action did, for showing it. */
export type ActionItem =
  | { kind: 'resolved'; blockId: string; where: string; outcome: 'accepted' | 'rejected' | null; op: 'ins' | 'del'; text: string }
  | { kind: 'edited'; blockId: string; where: string; before: string; after: string }
  | { kind: 'paragraph'; blockId: string; where: string; added: boolean; text: string }
  | { kind: 'comment'; blockId: string; where: string; added: boolean; text: string; was?: string }
  | { kind: 'checked'; blockId: string; where: string; added: boolean; text: string }
  | { kind: 'resolvedComment'; blockId: string; where: string; done: boolean; text: string }

/** What an action did, item by item, in document order. */
export function details(d: DocReview, a: HistoryAction): ActionItem[] {
  const blocks = new Map(d.blocks.map((b) => [b.id, b]))
  const order = new Map(d.blocks.map((b, i) => [b.id, i]))
  const paraOf = (id: string) => (a.after[`para:${id}`] ?? a.before[`para:${id}`]) as { block: DocBlock } | null | undefined
  const where = (id: string) => {
    const b = blocks.get(id) ?? paraOf(id)?.block
    if (!b) return 'Paragraph'
    return whereOf(d, b)
  }
  // The paragraph's text with no wording of ours: what an edit started from when there was none.
  const plain = (id: string) => {
    const b = blocks.get(id)
    return b ? shownText(marksFor({ ...d, edits: {} }, b)) : ''
  }
  const items: ActionItem[] = []
  for (const k of Object.keys(a.after)) {
    const [kind, ...rest] = k.split(':')
    if (kind === 'res') {
      const [blockId, seg] = rest
      const b = blocks.get(blockId)
      const s = b ? segmentsOf(b)[Number(seg)] : undefined
      if (!s || s.op === 'same') continue
      items.push({ kind: 'resolved', blockId, where: where(blockId), outcome: (a.after[k] as 'accepted' | 'rejected' | null) ?? null, op: s.op, text: s.text })
    } else if (kind === 'edit') {
      const id = rest.join(':')
      if (`para:${id}` in a.after) continue // shown as the paragraph added or removed
      const before = (a.before[k] as string | null) ?? plain(id)
      const after = (a.after[k] as string | null) ?? plain(id)
      items.push({ kind: 'edited', blockId: id, where: where(id), before, after })
    } else if (kind === 'para') {
      const id = rest.join(':')
      const added = a.after[k] !== null
      const text = ((added ? a.after[`edit:${id}`] : a.before[`edit:${id}`]) as string | null) ?? ''
      items.push({ kind: 'paragraph', blockId: id, where: 'New paragraph', added, text })
    } else if (kind === 'cdone') {
      const id = rest.join(':')
      const theirs = d.blocks.find((b) => b.comments?.some((c) => c.id === id))
      const ours = d.comments.find((c) => c.id === id)
      const blockId = theirs?.id ?? ours?.blockId ?? ''
      const text = theirs?.comments?.find((c) => c.id === id)?.text ?? ours?.text ?? ''
      const after = a.after[k] as CommentDone | null
      items.push({ kind: 'resolvedComment', blockId, where: where(blockId), done: !!after?.done, text })
    } else if (kind === 'chk') {
      const id = rest.join(':')
      const m = (a.after[k] ?? a.before[k]) as CheckedMark
      items.push({ kind: 'checked', blockId: id, where: where(id), added: a.after[k] !== null, text: m.text })
    } else if (kind === 'com') {
      const c = (a.after[k] ?? a.before[k]) as OurComment
      const was = a.after[k] !== null && a.before[k] !== null ? (a.before[k] as OurComment).text : undefined
      items.push({ kind: 'comment', blockId: c.blockId, where: where(c.blockId), added: a.after[k] !== null, text: c.text, was })
    }
  }
  return items.sort((x, y) => (order.get(x.blockId) ?? 1e9) - (order.get(y.blockId) ?? 1e9))
}
