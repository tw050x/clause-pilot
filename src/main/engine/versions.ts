import type { Clause, RemovedClause, ReviewSession, VersionLink } from '@shared/types'
import { clauseLabel, flagsFor, isCleared } from '@shared/derive'
import { canonical, similarity, wordDiff } from './text'

/** Wording is "the same" if it is identical after normalising case, spacing, quotes and numbering. */
const same = (a: string, b: string) => canonical(a) === canonical(b)
const CLOSE_ENOUGH = 0.45

type PrevStatus = NonNullable<VersionLink['prevStatus']>

function statusIn(prev: ReviewSession, c: Clause): { status: PrevStatus; note?: string; redline?: string } {
  const d = prev.decisions[c.id]
  if (d) return { status: d.decision === 'accepted' ? 'accepted' : 'rejected', note: d.note || undefined, redline: d.redline || undefined }
  return { status: isCleared(flagsFor(prev, c)) ? 'pre-approved' : 'open' }
}

/**
 * Line up a new draft against the previous version of the same contract:
 * identical wording first (wherever it moved to), then the closest remaining
 * clause (preferring the same clause number), and everything left over is new
 * (in this draft) or removed (from the last one).
 */
export function compareVersions(prev: ReviewSession, clauses: Clause[]): { links: Record<string, VersionLink>; removed: RemovedClause[] } {
  const links: Record<string, VersionLink> = {}
  const unmatchedPrev = new Set(prev.clauses.map((c) => c.id))
  const byId = new Map(prev.clauses.map((c) => [c.id, c]))

  const link = (c: Clause, p: Clause, kind: 'unchanged' | 'changed') => {
    unmatchedPrev.delete(p.id)
    const st = statusIn(prev, p)
    links[c.id] = {
      kind,
      prevClauseId: p.id,
      prevLabel: clauseLabel(p),
      prevText: p.text,
      prevStatus: st.status,
      prevNote: st.note,
      prevRedline: st.redline,
      diff: kind === 'changed' ? wordDiff(p.text, c.text) : undefined,
      matchesOurRedline: kind === 'changed' && !!st.redline && same(st.redline, c.text)
    }
  }

  // 1. Identical wording.
  for (const c of clauses) {
    const p = prev.clauses.find((x) => unmatchedPrev.has(x.id) && same(x.text, c.text))
    if (p) link(c, p, 'unchanged')
  }
  // 2. Closest remaining clause, preferring the same number.
  for (const c of clauses) {
    if (links[c.id]) continue
    let best: { p: Clause; score: number } | null = null
    for (const id of unmatchedPrev) {
      const p = byId.get(id)!
      const score = similarity(p.text, c.text).score + (p.number && p.number === c.number ? 0.15 : 0)
      if (score >= CLOSE_ENOUGH && (!best || score > best.score)) best = { p, score }
    }
    if (best) link(c, best.p, 'changed')
    else links[c.id] = { kind: 'new' }
  }
  // 3. Whatever is left in the previous draft was removed.
  const removed: RemovedClause[] = [...unmatchedPrev].map((id) => {
    const p = byId.get(id)!
    const st = statusIn(prev, p)
    return { prevClauseId: id, label: clauseLabel(p), text: p.text, prevStatus: st.status, prevNote: st.note }
  })
  return { links, removed }
}
