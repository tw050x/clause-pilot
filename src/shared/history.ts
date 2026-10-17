import type { DocBlock, DocReview, HistoryAction, OurComment } from './types'

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
    } else if (kind === 'com') {
      d.comments = d.comments.filter((c) => c.id !== id)
      if (v !== null) d.comments.push(v as OurComment)
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
const scope = (k: string) => (k.startsWith('com:') ? k : k.split(':')[1])

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
    return b.ours ? 'a new paragraph' : b.label ? `§${b.label.replace(/\.$/, '')}` : b.kind === 'heading' ? 'a heading' : 'a paragraph'
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
  const coms = keys.filter((k) => k.startsWith('com:'))
  const cAdded = coms.filter((k) => a.after[k] !== null)
  if (cAdded.length) parts.push(`commented on ${places(cAdded.map((k) => (a.after[k] as OurComment).blockId))}`)
  if (coms.length - cAdded.length) parts.push(`deleted ${coms.length - cAdded.length === 1 ? 'a comment' : 'comments'}`)
  const text = parts.join('; ') || 'No change'
  return text.charAt(0).toUpperCase() + text.slice(1)
}
