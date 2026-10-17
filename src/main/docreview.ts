import { randomUUID } from 'node:crypto'
import type { ChangeReview, ContractType, DocBlock, LibraryClause, PlaybookPosition, ReviewSession, SeenHit } from '@shared/types'
import { beforeTheirs, changeSets, type ChangeSet } from '@shared/changes'
import { RESPONSE } from './engine/seen'
import { compareWithSent, compareWithTemplate } from './engine/baseline'
import { injectionHits } from './engine/injection'
import type { ChangeInput, ChangeOut } from './ai/tasks'
import type { ParsedDocument } from './ingest/parse'
import { guessContractType } from './ingest/headings'
import type { ScriptedChange } from '@shared/demoScenarios'
export type { ScriptedChange }

/**
 * A document review: the contract as written, paragraph by paragraph, with
 * their changes found (tracked, or by comparison with a baseline). Everything
 * here is local; the AI is only asked about a change when the reviewer asks.
 */
export function createDocSession(
  doc: ParsedDocument,
  blocks: DocBlock[],
  filePath: string,
  mode: 'live' | 'demo',
  opts: { prev?: ReviewSession; library: LibraryClause[] }
): ReviewSession {
  const s: ReviewSession = {
    id: randomUUID(),
    docName: doc.name,
    filePath,
    sourceType: doc.sourceType,
    contractType: guessContractType(doc.lines),
    fileSha256: doc.sha256,
    mode,
    createdAt: new Date().toISOString(),
    clauses: [],
    match: {},
    precedents: {},
    overrides: { status: 'idle' },
    playbook: {},
    injection: {},
    aiInjectionReports: [],
    decisions: {},
    doc: { blocks, edits: {}, comments: [], decisions: {}, ai: {} }
  }
  const d = s.doc!
  if (opts.prev?.doc) {
    // A later draft: compare with what we sent, so changes made without Track Changes show too.
    const r = compareWithSent(opts.prev, blocks)
    Object.assign(d, { blocks: r.blocks, lastRound: r.lastRound, baseline: r.baseline })
    d.blocks = compareWithTemplate(d.blocks, opts.library).blocks.map((b, i) => ({ ...d.blocks[i], approved: b.approved, wasApproved: b.wasApproved }))
  } else {
    // A first draft: compare with our standard wording when it's on our paper.
    const r = compareWithTemplate(blocks, opts.library)
    d.blocks = r.blocks
    if (r.baseline) d.baseline = r.baseline
  }
  // Local prompt-injection screen, before anything could go to a model.
  for (const b of d.blocks) {
    const hits = injectionHits(b.text)
    if (hits.length) s.injection[b.id] = hits
  }
  return s
}

const where = (b: DocBlock) => (b.label ? `§${b.label.replace(/\.$/, '')}` : b.text.slice(0, 40))

/** What the model is given for one change set: the whole contract, the change, our playbook and history. */
export function changeInput(s: ReviewSession, set: ChangeSet, positions: PlaybookPosition[], seen: SeenHit[]): ChangeInput {
  const d = s.doc!
  return {
    contract: d.blocks.filter((b) => b.kind !== 'deleted').map((b) => ({ id: b.id, ...(b.label ? { label: b.label } : {}), text: b.text })),
    change: {
      where: set.where,
      untracked: set.blocks.some((b) => b.untracked),
      blocks: set.blocks.map((b) => ({
        id: b.id,
        ...(b.label ? { label: b.label } : {}),
        before: beforeTheirs(b),
        after: b.kind === 'deleted' ? '' : b.text,
        their_comments: (b.comments ?? []).map((c) => c.text)
      }))
    },
    positions,
    seen: seen.slice(0, 4).map((h) => ({
      counterparty: h.counterparty,
      response: h.response ? RESPONSE[h.response] : h.outcome,
      text: h.text,
      ...(h.ours?.some((t) => t) ? { ours: h.ours.filter((t) => t !== null).join('\n') || '(struck)' } : {}),
      notes: h.notes
    }))
  }
}

/** The model's answer, checked against the review: ids must exist, and suggestions stay inside the change. */
export function toChangeReview(s: ReviewSession, set: ChangeSet, positions: PlaybookPosition[], out: ChangeOut): ChangeReview {
  const blocks = new Map(s.doc!.blocks.map((b) => [b.id, b]))
  const inSet = new Set(set.blocks.map((b) => b.id))
  const titles = new Map(positions.map((p) => [p.id, p.title]))
  return {
    summary: out.summary,
    effect: out.effect === 'favours_us' ? 'favours-us' : out.effect === 'favours_them' ? 'favours-them' : 'neutral',
    risk: out.risk,
    recommendation: out.recommendation,
    reasoning: out.reasoning,
    playbook: out.playbook.filter((p) => titles.has(p.position_id)).map((p) => ({ positionId: p.position_id, title: titles.get(p.position_id)!, conflict: p.conflict, note: p.note })),
    related: out.related.filter((r) => blocks.has(r.block_id) && !inSet.has(r.block_id)).map((r) => ({ blockId: r.block_id, where: where(blocks.get(r.block_id)!), why: r.why })),
    suggested: out.suggested_edits.filter((e) => inSet.has(e.block_id)).map((e) => ({ blockId: e.block_id, text: e.text.trim() })),
    comment: out.comment_to_them.trim(),
    injectionSuspected: out.injection_suspected,
    at: new Date().toISOString()
  }
}

export function applicable(playbook: PlaybookPosition[], type: ContractType): PlaybookPosition[] {
  return playbook.filter((p) => type === 'general' || p.appliesTo.includes(type))
}

export function findSet(sets: ChangeSet[], at: string): ChangeSet | undefined {
  return sets.find((x) => x.where.split(' ')[0] === at) ?? sets.find((x) => x.blocks[0].text.startsWith(at))
}

/** Apply scripted responses (demo set-up) the way the document screen would. Returns the change sets touched. */
export function applyScriptedChanges(s: ReviewSession, list: ScriptedChange[], by: string): ChangeSet[] {
  const d = s.doc!
  const at = new Date().toISOString()
  const touched: ChangeSet[] = []
  for (const c of list) {
    const set = findSet(changeSets(d), c.at)
    if (!set) throw new Error(`Demo set-up: no change at ${c.at} in ${s.docName}`)
    const first = set.blocks.find((b) => b.kind !== 'heading') ?? set.blocks[0]
    if (c.action === 'accept' || c.action === 'flag') d.decisions[set.id] = { status: c.action === 'accept' ? 'accepted' : 'flagged', note: c.note, by, at }
    if (c.action === 'restore') for (const b of set.blocks) d.edits[b.id] = b.kind === 'deleted' ? b.text : beforeTheirs(b)
    if (c.action === 'strike') for (const b of set.blocks) d.edits[b.id] = ''
    if (c.action === 'edit') d.edits[first.id] = c.text ?? ''
    if (c.comment) {
      const theirs = set.blocks.flatMap((b) => (b.comments ?? []).map((t) => ({ b, t })))[0]
      d.comments.push({ id: `oc-${d.comments.length}`, blockId: theirs?.b.id ?? first.id, text: c.comment, replyTo: theirs?.t.id, by, at })
    }
    touched.push(set)
  }
  return touched
}
