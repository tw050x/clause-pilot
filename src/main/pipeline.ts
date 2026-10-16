import { randomUUID } from 'node:crypto'
import type {
  Clause,
  ContractType,
  LibraryClause,
  OverrideFinding,
  PlaybookFinding,
  PlaybookPosition,
  Precedent,
  ReviewSession
} from '@shared/types'
import { LibraryIndex, PrecedentIndex } from './engine/matcher'
import { injectionHits } from './engine/injection'
import type { AiProvider } from './ai/provider'
import type { ClauseRef } from './ai/tasks'
import type { ParsedDocument } from './ingest/parse'
import { splitClauses, guessContractType } from './ingest/clauses'

export interface PipelineDeps {
  ai: AiProvider
  library: LibraryClause[]
  precedents: Precedent[]
  playbook: PlaybookPosition[]
  /** Called whenever the session changes, so the UI can re-render. */
  emit: (s: ReviewSession) => void
  audit: (type: string, payload: Record<string, unknown>) => void
  concurrency?: number
}

export function createSession(doc: ParsedDocument, filePath: string, mode: 'live' | 'demo'): ReviewSession {
  const clauses = splitClauses(doc.lines)
  return {
    id: randomUUID(),
    docName: doc.name,
    filePath,
    sourceType: doc.sourceType,
    contractType: guessContractType(doc.lines),
    fileSha256: doc.sha256,
    mode,
    createdAt: new Date().toISOString(),
    clauses,
    match: Object.fromEntries(clauses.map((c) => [c.id, { status: 'idle' as const }])),
    precedents: {},
    overrides: { status: 'idle' },
    playbook: {},
    injection: {},
    aiInjectionReports: [],
    decisions: {}
  }
}

export const clauseRefs = (clauses: Clause[]): ClauseRef[] =>
  clauses.map((c) => ({ id: c.id, number: c.number, heading: c.heading, text: c.text }))

export function applicablePositions(playbook: PlaybookPosition[], type: ContractType): PlaybookPosition[] {
  return playbook.filter((p) => type === 'general' || p.appliesTo.includes(type))
}

/** Tiny promise pool so we never fire dozens of API calls at once. */
function pool(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runPipeline(s: ReviewSession, deps: PipelineDeps): Promise<void> {
  const { ai, emit, audit } = deps
  const run = pool(deps.concurrency ?? 4)
  const lib = new LibraryIndex(deps.library.filter((c) => s.contractType === 'general' || c.contractType === 'general' || c.contractType === s.contractType))
  const prec = new PrecedentIndex(deps.precedents)
  const update = () => emit(s)
  const noteInjection = (suspected: boolean, notes: string, where: string) => {
    if (suspected && notes.trim()) s.aiInjectionReports.push(`${where}: ${notes.trim()}`)
  }

  audit('pipeline.started', { clauses: s.clauses.length, contractType: s.contractType, provider: ai.kind })

  // Local, model-independent prompt-injection screen.
  for (const c of s.clauses) {
    const hits = injectionHits(c.text)
    if (hits.length) s.injection[c.id] = hits
  }
  if (Object.keys(s.injection).length) audit('injection.local-flags', { clauses: s.injection })

  // ---- (b) precedent search: only for clauses that end up needing a human ----
  const searchPrecedents = (c: Clause) => {
    s.precedents[c.id] = { status: 'running', reason: 'Searching past negotiations for similar wording' }
    update()
    const hits = prec.search(c)
    s.precedents[c.id] = {
      status: 'done',
      data: hits,
      reason: hits.length ? `${hits.length} similar clause(s) seen in previous negotiations` : 'No precedents for similar wording'
    }
    update()
  }

  // ---- (a) library match per clause: exact -> lexical candidates -> AI intent ----
  const matchClause = async (c: Clause) => {
    s.match[c.id] = { status: 'running', reason: 'Looking for an exact match in the pre-approved library' }
    update()

    // Unnumbered blocks are party details, commercial terms and signatures: unique to every
    // deal, so there is nothing to match. A human checks them against the deal record.
    if (!c.number) {
      s.match[c.id] = {
        status: 'done',
        data: { kind: 'none', candidates: [] },
        reason: c.heading === 'EXECUTION' ? 'Signature block: check signatories and entities' : 'Deal-specific details: check names, product, price and dates against the order'
      }
      return
    }

    const exact = lib.exact(c)
    if (exact) {
      s.match[c.id] = {
        status: 'done',
        data: { kind: 'exact', libraryId: exact.id, candidates: [] },
        reason: `Word-for-word match with pre-approved "${exact.title}"`
      }
      update()
      return
    }

    const candidates = lib.candidates(c)
    if (!candidates.length) {
      s.match[c.id] = {
        status: 'done',
        data: { kind: 'none', candidates: [] },
        reason: 'Nothing in the pre-approved library is close to this wording'
      }
      searchPrecedents(c)
      return
    }

    s.match[c.id] = {
      status: 'running',
      data: { kind: 'none', candidates },
      reason: `Close to "${candidates[0].title}" (${pct(candidates[0].score)} similar) - asking AI whether the intent is the same`
    }
    update()

    try {
      const v = await run(() =>
        ai.intent({
          clause: { number: c.number, heading: c.heading, text: c.text },
          candidates: candidates.map((k) => ({ id: k.libraryId, title: k.title, text: k.text }))
        })
      )
      noteInjection(v.injection_suspected, v.injection_notes, `Intent check on ${c.number ?? c.id}`)
      const verdict = {
        aligned: v.aligned,
        bestMatchId: candidates.some((k) => k.libraryId === v.best_match_id) ? v.best_match_id : null,
        confidence: v.confidence,
        materialDifferences: v.material_differences,
        reasoning: v.reasoning,
        injectionSuspected: v.injection_suspected
      }
      // Deterministic gate: the model's opinion alone never clears a clause.
      const againstUs = verdict.materialDifferences.filter((d) => d.favours === 'counterparty')
      let gateNote: string
      let pass = false
      if (!verdict.aligned) gateNote = 'AI found the legal effect differs from the approved clause'
      else if (!verdict.bestMatchId) gateNote = 'AI did not identify which approved clause it matches'
      else if (verdict.confidence === 'low') gateNote = 'AI confidence too low to auto-clear'
      else if (againstUs.length) gateNote = `${againstUs.length} difference(s) favour the counterparty`
      else if (verdict.injectionSuspected) gateNote = 'Possible prompt-injection text - sent to a human'
      else {
        pass = true
        gateNote = 'Same legal effect, confidence ' + verdict.confidence
      }
      const best = candidates.find((k) => k.libraryId === verdict.bestMatchId) ?? candidates[0]
      s.match[c.id] = {
        status: 'done',
        data: { kind: pass ? 'intent' : 'none', libraryId: pass ? best.libraryId : undefined, candidates, verdict, gateNote },
        reason: pass ? `Same intent as pre-approved "${best.title}" (AI-verified)` : `Needs review: ${gateNote.toLowerCase()}`
      }
      audit('ai.intent', { clauseId: c.id, number: c.number, aligned: v.aligned, confidence: v.confidence, cleared: pass, gateNote })
    } catch (e) {
      s.match[c.id] = { status: 'done', data: { kind: 'none', candidates }, reason: 'AI intent check unavailable - needs review', error: errMsg(e) }
      audit('ai.intent.error', { clauseId: c.id, error: errMsg(e) })
    }
    update()
    if (s.match[c.id].data?.kind === 'none') searchPrecedents(c)
  }

  // ---- (c) overrides within the document ----
  const refs = clauseRefs(s.clauses)
  const ids = new Set(s.clauses.map((c) => c.id))
  const detectOverrides = async () => {
    s.overrides = { status: 'running', reason: 'AI is reading the whole contract for clauses that override other clauses' }
    update()
    try {
      const out = await run(() => ai.overrides({ clauses: refs }))
      noteInjection(out.injection_suspected, out.injection_notes, 'Override check')
      const findings: OverrideFinding[] = out.findings
        .filter((f) => ids.has(f.overriding_clause_id))
        .map((f, i) => ({
          id: `ov${i}`,
          overridingClauseId: f.overriding_clause_id,
          overriddenClauseIds: f.overridden_clause_ids.filter((x) => ids.has(x) && x !== f.overriding_clause_id),
          mechanism: f.mechanism,
          summary: f.summary,
          effect: f.effect,
          severity: f.severity,
          quote: f.quote
        }))
        .filter((f) => f.overriddenClauseIds.length > 0)
      s.overrides = {
        status: 'done',
        data: findings,
        reason: findings.length ? `${findings.length} override(s) found` : 'No clause overrides another'
      }
      audit('ai.overrides', { findings: findings.map((f) => ({ by: f.overridingClauseId, of: f.overriddenClauseIds, severity: f.severity })) })
    } catch (e) {
      s.overrides = { status: 'error', error: errMsg(e), reason: 'Override check failed' }
      audit('ai.overrides.error', { error: errMsg(e) })
    }
    update()
  }

  // ---- (d) standard positions: one focused call per position ----
  const positions = applicablePositions(deps.playbook, s.contractType)
  for (const p of deps.playbook) {
    s.playbook[p.id] = positions.includes(p)
      ? { status: 'idle', reason: `Queued: check against our position on ${p.title.toLowerCase()}` }
      : { status: 'skipped', reason: 'Not applicable to this contract type' }
  }
  const checkPosition = async (p: PlaybookPosition) => {
    s.playbook[p.id] = { status: 'running', reason: `Checking the contract against our position on ${p.title.toLowerCase()}` }
    update()
    try {
      const out = await run(() => ai.position({ clauses: refs, position: p }))
      noteInjection(out.injection_suspected, out.injection_notes, `Playbook check "${p.title}"`)
      const finding: PlaybookFinding = {
        positionId: p.id,
        positionTitle: p.title,
        status: out.status,
        clauseIds: out.clause_ids.filter((x) => ids.has(x)),
        deviation: out.deviation,
        severity: out.severity,
        suggestedRedline: out.suggested_redline,
        withinFallback: out.within_fallback
      }
      s.playbook[p.id] = { status: 'done', data: finding, reason: finding.status }
      audit('ai.position', { positionId: p.id, status: finding.status, clauseIds: finding.clauseIds, severity: finding.severity })
    } catch (e) {
      s.playbook[p.id] = { status: 'error', error: errMsg(e), reason: 'Check failed' }
      audit('ai.position.error', { positionId: p.id, error: errMsg(e) })
    }
    update()
  }

  update()
  await Promise.all([...s.clauses.map(matchClause), detectOverrides(), ...positions.map(checkPosition)])

  const stats = Object.values(s.match).reduce<Record<string, number>>((acc, m) => {
    const k = m.data?.kind ?? 'error'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  audit('pipeline.completed', { match: stats, overrides: s.overrides.data?.length ?? null, aiInjectionReports: s.aiInjectionReports.length })
  update()
}
