import MiniSearch from 'minisearch'
import type { Clause, LibraryClause, MatchCandidate, Precedent, PrecedentHit } from '@shared/types'
import { canonical, sha256, similarity, wordDiff } from './text'

/** Clauses scoring at or above this are close enough to ask the AI about intent. */
export const CANDIDATE_THRESHOLD = 0.45
export const MAX_CANDIDATES = 3

export class LibraryIndex {
  private byHash = new Map<string, LibraryClause>()

  constructor(private library: LibraryClause[]) {
    for (const c of library) this.byHash.set(sha256(canonical(c.text)), c)
  }

  exact(clause: Clause): LibraryClause | undefined {
    return this.byHash.get(sha256(canonical(clause.text)))
  }

  candidates(clause: Clause): MatchCandidate[] {
    return this.library
      .map((lib) => ({ lib, sim: similarity(lib.text, clause.text) }))
      .filter((x) => x.sim.score >= CANDIDATE_THRESHOLD)
      .sort((a, b) => b.sim.score - a.sim.score)
      .slice(0, MAX_CANDIDATES)
      .map(({ lib, sim }) => ({
        libraryId: lib.id,
        title: lib.title,
        category: lib.category,
        text: lib.text,
        score: Math.round(sim.score * 1000) / 1000,
        diff: wordDiff(lib.text, clause.text)
      }))
  }
}

const STOP = new Set(
  'the a an and or of to in on for by with as at be is are was were shall will may any all such this that its it their his her which from under than other each party parties agreement'.split(' ')
)

/** BM25 keyword search over clauses seen in previous negotiations. */
export class PrecedentIndex {
  private ms: MiniSearch<Precedent>

  constructor(precedents: Precedent[]) {
    this.ms = new MiniSearch<Precedent>({
      fields: ['text', 'category'],
      storeFields: ['id'],
      processTerm: (t) => {
        const term = t.toLowerCase()
        return term.length < 3 || STOP.has(term) ? null : term
      },
      searchOptions: { boost: { category: 2 }, fuzzy: 0.15, prefix: true, combineWith: 'OR' }
    })
    this.ms.addAll(precedents)
    this.byId = new Map(precedents.map((p) => [p.id, p]))
  }

  private byId: Map<string, Precedent>

  search(clause: Clause, limit = 4): PrecedentHit[] {
    return this.searchText([clause.heading ?? '', clause.text].join(' '), limit)
  }

  /** Search by free text (the words a change added and removed). */
  searchText(query: string, limit = 4): PrecedentHit[] {
    if (!query.trim()) return []
    const results = this.ms.search(query)
    if (!results.length) return []
    const top = results[0].score
    return results
      .filter((r) => r.score >= top * 0.35)
      .slice(0, limit)
      .map((r) => ({
        ...this.byId.get(r.id as string)!,
        score: Math.round((r.score / top) * 100) / 100,
        terms: r.terms.slice(0, 8)
      }))
  }
}
