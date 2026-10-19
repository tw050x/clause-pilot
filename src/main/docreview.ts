import { randomUUID } from 'node:crypto'
import type { ChangeReview, ContractType, DocBlock, DocReview, IntentCheck, LibraryClause, PlaybookPosition, ReviewSession, SeenHit } from '@shared/types'
import { beforeTheirs, proposedText, type ChangeSet } from '@shared/changes'
import { RESPONSE } from './engine/seen'
import { compareWithSent, compareWithTemplate } from './engine/baseline'
import { injectionHits } from './engine/injection'
import { LibrarySearch } from './engine/matcher'
import type { ChangeInput, ChangeOut, IntentInput, IntentOut } from './ai/tasks'
import type { ParsedDocument } from './ingest/parse'
import { guessContractType } from './ingest/headings'

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
  /**
   * prev: the version this draft is compared with (the one we sent back, or the original we sent).
   * paper: for a first draft, whose paper the reviewer says it is. Only 'ours' compares it with
   * our approved clauses as if they were what we sent; 'theirs' only notes paragraphs that are word
   * for word ours. Unsaid (the demos), it's judged from how much of it is our wording.
   */
  opts: { prev?: ReviewSession; library: LibraryClause[]; paper?: 'ours' | 'theirs' }
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
    doc: { blocks, edits: {}, comments: [], decisions: {}, ai: {}, ...(doc.font ? { font: doc.font } : {}) }
  }
  const d = s.doc!
  if (opts.prev?.doc) {
    // A later draft: compare with what we sent, so changes made without Track Changes show too.
    const r = compareWithSent(opts.prev, blocks)
    Object.assign(d, { blocks: r.blocks, lastRound: r.lastRound, baseline: r.baseline })
    d.blocks = compareWithTemplate(d.blocks, opts.library).blocks.map((b, i) => ({ ...d.blocks[i], approved: b.approved, wasApproved: b.wasApproved }))
  } else if (opts.paper === 'theirs') {
    // Their paper: nothing is assumed to be ours. Paragraphs that are word for word ours are noted.
    const r = compareWithTemplate(blocks, opts.library)
    d.blocks = blocks.map((b, i) => ({ ...b, approved: r.blocks[i].approved, wasApproved: r.blocks[i].wasApproved }))
  } else if (opts.paper === 'ours') {
    // Ours, with no original to hand: our approved clauses stand in for what we sent.
    const r = compareWithTemplate(blocks, opts.library, true)
    d.blocks = r.blocks
    if (r.baseline) d.baseline = r.baseline
  } else {
    // A first draft: compare with our standard wording when it's on our paper.
    const r = compareWithTemplate(blocks, opts.library)
    d.blocks = r.blocks
    if (r.baseline) d.baseline = r.baseline
  }
  // Paragraphs that aren't our wording (their paper): a shortlist of our closest clauses, so the
  // AI can be asked whether they mean the same. Found by keywords, locally; nothing is decided by it.
  if (opts.library.length) {
    const search = new LibrarySearch(opts.library.filter((c) => c.contractType === 'general' || s.contractType === 'general' || c.contractType === s.contractType))
    d.blocks = d.blocks.map((b) => {
      if (b.ours || b.approved || b.standard || b.wasApproved || (b.kind !== 'para' && b.kind !== 'row') || b.text.split(/\s+/).length < 8) return b
      const matches = search.closest(b.text)
      return matches.length ? { ...b, matches } : b
    })
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

/**
 * What the AI is asked for a paragraph: does it mean the same as the approved clause it differs
 * from, or (their paper) as one of our clauses closest to it by keywords?
 */
export function intentInput(d: DocReview, b: DocBlock, library: LibraryClause[]): IntentInput | null {
  const title = b.standard ?? b.wasApproved
  const libs = title ? library.filter((c) => c.title === title).slice(0, 1) : (b.matches ?? []).map((id) => library.find((c) => c.id === id)).filter((c): c is LibraryClause => !!c)
  if (!libs.length) return null
  return { clause: { number: b.label ?? null, heading: null, text: proposedText(d, b) }, candidates: libs.map((c) => ({ id: c.id, title: c.title, text: c.text })) }
}

/**
 * The AI's answer, checked in code: it only counts as "same meaning" if the model says so with
 * confidence, names the clause, finds nothing that favours the counterparty and suspects no
 * injection. The model's opinion alone never clears a paragraph.
 */
export function intentResult(input: IntentInput, out: IntentOut): Omit<IntentCheck, 'status' | 'at'> {
  // The clause it matched has to be one we offered: an id it made up counts for nothing.
  const lib = input.candidates.find((c) => c.id === out.best_match_id) ?? input.candidates[0]
  const offered = input.candidates.some((c) => c.id === out.best_match_id)
  const against = out.material_differences.filter((x) => x.favours === 'counterparty')
  let note = ''
  if (!offered) note = input.candidates.length > 1 ? 'The AI found none of our approved clauses means the same.' : 'The AI did not match it to our approved clause.'
  else if (!out.aligned) note = `The legal effect differs from our approved “${lib.title}”.`
  else if (out.confidence === 'low') note = 'The AI’s confidence was too low.'
  else if (against.length) note = `${against.length} difference${against.length === 1 ? '' : 's'} favour${against.length === 1 ? 's' : ''} the counterparty.`
  else if (out.injection_suspected) note = 'Possible text addressed to an AI reviewer.'
  return {
    text: input.clause.text,
    same: !note,
    title: offered ? lib.title : undefined,
    confidence: out.confidence,
    reasoning: out.reasoning,
    differences: out.material_differences,
    note: note || `Same legal effect as our approved “${lib.title}”.`
  }
}
