import type { Clause, Decision, MatchKind, OverrideFinding, PlaybookFinding, ReviewSession, VersionLink } from './types'

export type Visual = 'processing' | 'exact' | 'intent' | 'review' | 'conflict' | 'accepted' | 'rejected'

export interface ClauseFlags {
  processing: boolean
  match: MatchKind | null
  overriding: OverrideFinding[] // this clause overrides others
  overriddenBy: OverrideFinding[] // this clause is overridden
  playbook: PlaybookFinding[] // deviations involving this clause
  injection: string[]
  decision: Decision | undefined
  docChecksPending: boolean
  /** How this clause relates to the previous version of the contract, if there is one. */
  version: VersionLink | undefined
}

export function docChecksPending(s: ReviewSession): boolean {
  return s.overrides.status === 'running' || s.overrides.status === 'idle' || Object.values(s.playbook).some((p) => p.status === 'running' || p.status === 'idle')
}

export function flagsFor(s: ReviewSession, c: Clause): ClauseFlags {
  const m = s.match[c.id]
  const p = s.precedents[c.id]
  const overrides = s.overrides.data ?? []
  const playbook = Object.values(s.playbook)
    .map((x) => x.data)
    .filter((f): f is PlaybookFinding => !!f && (f.status === 'deviation') && f.clauseIds.includes(c.id))
  return {
    processing: m?.status === 'running' || m?.status === 'idle' || p?.status === 'running',
    match: m?.status === 'done' ? m.data!.kind : null,
    overriding: overrides.filter((o) => o.overridingClauseId === c.id),
    overriddenBy: overrides.filter((o) => o.overriddenClauseIds.includes(c.id)),
    playbook,
    injection: s.injection[c.id] ?? [],
    decision: s.decisions[c.id],
    docChecksPending: docChecksPending(s),
    version: s.versionLinks?.[c.id]
  }
}

export function hasConflict(f: ClauseFlags): boolean {
  return f.overriding.length > 0 || f.overriddenBy.length > 0 || f.playbook.length > 0 || f.injection.length > 0
}

/**
 * Cleared = accepted without anyone reading it: word for word our approved wording and
 * nothing else touches it. An AI "same meaning" verdict is never enough on its own;
 * a person confirms those (and can nominate the wording so it is exact next time).
 */
export function isCleared(f: ClauseFlags): boolean {
  if (f.docChecksPending) return false
  // Someone explicitly accepted this exact wording last time, having seen its playbook notes.
  // Only something new (another clause overriding it, an injection flag) reopens it.
  if (acceptedBefore(f)) return !f.overriddenBy.length && !f.overriding.length && !f.injection.length
  return (f.match === 'exact' || settledBefore(f)) && !hasConflict(f)
}

/** Explicitly accepted in the last version, and sent back word for word. */
export function acceptedBefore(f: ClauseFlags): boolean {
  return f.version?.kind === 'unchanged' && f.version.prevStatus === 'accepted'
}

/** Word for word what was in the last version, where it was accepted or pre-approved. */
export function settledBefore(f: ClauseFlags): boolean {
  return f.version?.kind === 'unchanged' && (f.version.prevStatus === 'accepted' || f.version.prevStatus === 'pre-approved')
}

export function visualFor(f: ClauseFlags): Visual {
  if (f.decision) return f.decision.decision
  if (f.processing) return 'processing'
  if (acceptedBefore(f) && isCleared(f)) return 'exact'
  if (hasConflict(f)) return 'conflict'
  if (f.match === 'exact') return 'exact'
  if (f.match === 'intent') return 'intent'
  return 'review'
}

export function summarise(s: ReviewSession) {
  const counts = { total: s.clauses.length, processing: 0, exact: 0, intent: 0, review: 0, conflict: 0, accepted: 0, rejected: 0, cleared: 0 }
  for (const c of s.clauses) {
    const f = flagsFor(s, c)
    counts[visualFor(f)]++
    if (!f.decision && isCleared(f)) counts.cleared++
  }
  return counts
}

export function clauseLabel(c: Clause): string {
  if (c.number) return `Clause ${c.number}`
  if (c.heading === 'EXECUTION') return 'Signature block'
  return c.index === 0 ? 'Parties and details' : `Unnumbered paragraph ${c.index + 1}`
}

// ---- Triage: what must change, what needs a decision, what is covered ----------

export type Tier = 'must' | 'decide' | 'affected' | 'pending' | 'cleared' | 'decided'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Issue {
  clauseId: string | null // null = whole-contract issue (e.g. a missing protection)
  tier: Tier
  severity: Severity
  title: string
  detail: string
  more: number // further issues rooted in the same clause
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const TIER_RANK: Record<Tier, number> = { must: 0, decide: 1, affected: 2, pending: 3, cleared: 4, decided: 5 }

/**
 * Root-cause triage. Each problem is listed once, on the clause that causes it:
 * an override on the overriding clause, a playbook deviation on the clause that
 * deviates (preferring an overriding clause when the finding names several).
 * Standard clauses that are merely affected are listed separately: they clear
 * when the root issue is fixed, so they are not extra work.
 */
export function triage(s: ReviewSession): Issue[] {
  const label = (id: string) => clauseLabel(s.clauses.find((c) => c.id === id)!)
  const overrides = s.overrides.data ?? []
  const overriding = new Set(overrides.map((o) => o.overridingClauseId))
  const rooted = new Map<string, (Omit<Issue, 'more'> & { fromPlaybook?: boolean })[]>()
  const add = (i: Omit<Issue, 'more'> & { fromPlaybook?: boolean }) => {
    const k = i.clauseId ?? '__doc'
    rooted.set(k, [...(rooted.get(k) ?? []), i])
  }
  const tierFor = (sev: Severity, fallback = false): Tier => (fallback || sev === 'low' ? 'decide' : sev === 'medium' ? 'decide' : 'must')

  for (const c of s.clauses) {
    const hits = s.injection[c.id]
    if (hits?.length) add({ clauseId: c.id, tier: 'must', severity: 'critical', title: 'Prompt injection: security review required', detail: 'Text addressed to an AI reviewer: ' + hits.join(', ') })
  }
  // Something we rejected last time that comes back word for word: they haven't addressed it.
  const prevV = s.previous?.version
  for (const c of s.clauses) {
    const v = s.versionLinks?.[c.id]
    if (v?.kind === 'unchanged' && v.prevStatus === 'rejected')
      add({ clauseId: c.id, tier: 'must', severity: 'high', title: `Not changed: you rejected this in version ${prevV}`, detail: v.prevNote ? `Your note: ${v.prevNote}` : 'They sent it back without changes.' })
  }
  for (const o of overrides)
    add({ clauseId: o.overridingClauseId, tier: tierFor(o.severity), severity: o.severity, title: `Overrides ${o.overriddenClauseIds.map(label).join(', ')}`, detail: o.summary })
  for (const p of Object.values(s.playbook)) {
    const d = p.data
    if (!d || d.status === 'compliant' || d.status === 'not-applicable') continue
    const sev: Severity = d.withinFallback ? 'low' : d.severity
    const where = d.clauseIds.find((id) => overriding.has(id)) ?? d.clauseIds[0] ?? null
    add({
      clauseId: where,
      tier: tierFor(d.severity, d.withinFallback),
      severity: sev,
      title: d.status === 'missing' ? `Missing: ${d.positionTitle}` : `${d.positionTitle}${d.withinFallback ? ' (within fallback)' : ''}`,
      detail: d.deviation,
      fromPlaybook: true
    })
  }

  const out: Issue[] = []
  const worst = (list: Omit<Issue, 'more'>[]) =>
    [...list].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || SEV_RANK[a.severity] - SEV_RANK[b.severity])
  for (const c of s.clauses) {
    const f = flagsFor(s, c)
    const own = rooted.get(c.id) ?? []
    if (f.decision) {
      out.push({ clauseId: c.id, tier: 'decided', severity: 'low', title: f.decision.decision === 'accepted' ? 'Accepted' : 'Rejected', detail: f.decision.note, more: 0 })
    } else if (f.processing) {
      out.push({ clauseId: c.id, tier: 'pending', severity: 'low', title: 'Analysing', detail: s.match[c.id]?.reason ?? '', more: 0 })
    } else if (own.length && !(acceptedBefore(f) && isCleared(f) && own.every((i) => i.fromPlaybook))) {
      const [top, ...rest] = worst(own)
      out.push({ ...top, more: rest.length })
    } else if (settledBefore(f) && isCleared(f)) {
      // Settled in the last version and sent back word for word: nothing to read again.
      out.push({ clauseId: c.id, tier: 'cleared', severity: 'low', title: `Settled in version ${prevV}, unchanged`, detail: '', more: 0 })
    } else if (f.match === 'none') {
      // Its own wording isn't approved: a decision, whatever else touches it.
      const m = s.match[c.id]?.data
      const title = f.version?.matchesOurRedline
        ? 'Now matches the wording you proposed'
        : !c.number
          ? clauseLabel(c)
          : m?.candidates.length
            ? 'Differs from pre-approved wording'
            : 'No pre-approved match'
      const also = hasConflict(f) ? ` Also affected by ${f.overriddenBy[0] ? label(f.overriddenBy[0].overridingClauseId) : f.playbook[0]?.positionTitle}.` : ''
      const changed = f.version?.kind === 'changed' ? `Changed since version ${prevV}. ` : f.version?.kind === 'new' && prevV ? `New in this version. ` : ''
      out.push({ clauseId: c.id, tier: 'decide', severity: 'low', title, detail: changed + (m?.verdict?.reasoning ?? s.match[c.id]?.reason ?? '') + also, more: 0 })
    } else if (f.match === 'intent' && !hasConflict(f)) {
      const m = s.match[c.id]?.data
      out.push({ clauseId: c.id, tier: 'decide', severity: 'low', title: 'Same meaning as approved wording (AI): confirm', detail: m?.verdict?.reasoning ?? '', more: 0 })
    } else if (hasConflict(f)) {
      // Standard wording, changed by another clause: fixed when that clause is fixed.
      const cause = f.overriddenBy[0] ? label(f.overriddenBy[0].overridingClauseId) : f.playbook[0]?.positionTitle ?? 'another clause'
      out.push({ clauseId: c.id, tier: 'affected', severity: 'low', title: `Affected by ${cause}`, detail: '', more: 0 })
    } else {
      out.push({ clauseId: c.id, tier: 'cleared', severity: 'low', title: f.match === 'exact' ? 'Exact match' : `Settled in version ${prevV}, unchanged`, detail: '', more: 0 })
    }
  }
  for (const i of rooted.get('__doc') ?? []) out.push({ ...i, more: 0 })
  return out.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || SEV_RANK[a.severity] - SEV_RANK[b.severity])
}

/** Does this clause need someone to do something? Drives the badge on each clause. */
export function needsAction(f: ClauseFlags): 'pending' | 'action' | 'none' | 'rejected' {
  if (f.decision) return f.decision.decision === 'rejected' ? 'rejected' : 'none'
  if (f.processing) return 'pending'
  // Word-for-word match waiting only on the whole-contract checks: not yet known, not yet an action.
  if (f.docChecksPending && (f.match === 'exact' || settledBefore(f)) && !hasConflict(f)) return 'pending'
  return isCleared(f) ? 'none' : 'action'
}

/** All per-clause and whole-contract checks finished? */
export function analysisComplete(s: ReviewSession): { done: number; total: number; complete: boolean } {
  const all = [...Object.values(s.match), s.overrides, ...Object.values(s.playbook).filter((p) => p.status !== 'skipped')]
  const done = all.filter((x) => x.status === 'done' || x.status === 'error').length
  const precedentsRunning = Object.values(s.precedents).some((p) => p.status === 'running')
  return { done, total: all.length, complete: done === all.length && !precedentsRunning }
}
