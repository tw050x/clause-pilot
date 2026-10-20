import type { DocReview, HistoryAction } from './types'

/**
 * The reviewer's own edits once the AI review has done its work, and where they override it.
 *
 * Everything done to the draft is an action in its history; the AI review's are grouped by the
 * proposal they made (`ai:<proposal id>`), so the rest are the reviewer's. An edit of theirs to a
 * paragraph the AI changed (after it did), or was proposing to change (after it proposed it),
 * overrides it: worked out from the history as it stands, so undoing the edit undoes the override.
 */

/** An action of the reviewer's (not the AI review's), still in effect. */
export const isManual = (a: HistoryAction) => !a.undone && !a.group?.startsWith('ai:')

/** The paragraphs an action changed the content of (wording, their changes, paragraphs added or removed). */
export function blocksTouched(a: HistoryAction): string[] {
  const ids = new Set<string>()
  for (const k of Object.keys(a.after)) {
    const [kind, ...rest] = k.split(':')
    if (kind === 'edit' || kind === 'para') ids.add(rest.join(':'))
    else if (kind === 'res') ids.add(rest[0])
  }
  return [...ids]
}

/**
 * A part's AI change overridden by the reviewer: a change it proposed (not made yet), or one it
 * made to the draft; and the action of theirs that overrode it (the latest, if several).
 */
export interface Override {
  actionId: string
  at: string
  kind: 'proposal' | 'change'
}

/** By part: the AI change (or proposed change) each one's own edit overrode. */
export function overridesOf(d: DocReview): Record<string, Override> {
  const run = d.pipeline
  const out: Record<string, Override> = {}
  if (!run?.parts) return out
  const manual = (d.history ?? []).filter(isManual)
  if (!manual.length) return out
  for (const part of run.parts) {
    const p = part.proposal
    if (!p) continue
    const made = p.status === 'approved' && !!p.appliedAt
    const waiting = !p.appliedAt && (p.status === 'pending' || p.status === 'approved')
    if (!made && !waiting) continue
    const since = made ? p.appliedAt! : (p.madeAt ?? run.startedAt)
    const blocks = new Set([...p.wording.map((w) => w.blockId), ...p.decisions.map((x) => x.blockId)])
    const hit = manual.filter((a) => a.at > since && blocksTouched(a).some((id) => blocks.has(id))).at(-1)
    if (hit) out[part.id] = { actionId: hit.id, at: hit.at, kind: made ? 'change' : 'proposal' }
  }
  return out
}

/** The AI review is working on the draft (started and running): it can't be edited meanwhile. */
export const lockedForAi = (d?: DocReview) => d?.pipeline?.status === 'running' && !!d.pipeline.confirmed
