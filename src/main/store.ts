import { rejectedCount, stillOpen, theyChanged } from '@shared/changes'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defaultQuestions } from '@shared/questions'
import { DEFAULT_PROMPTS } from './ai/prompts'
import type { ReviewState, AiQuestion, Account, ChatConversation, ContractRecord, LibraryClause, Nomination, PlaybookPosition, PlaybookProposal, Precedent, ReviewSession, ReviewSummary, SecurityAlert } from '@shared/types'

const SEEDED = ['library.json', 'precedents.json', 'playbook.json', 'accounts.json', 'contracts.json']

/**
 * Plain JSON files on local disk. The data volume for a small legal team is tiny,
 * and JSON keeps the knowledge base human-readable and diffable (it can live in git).
 */
export class Store {
  constructor(readonly dir: string, seedDir: string) {
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    for (const f of SEEDED) if (!existsSync(join(dir, f))) copyFileSync(join(seedDir, f), join(dir, f))
    if (!existsSync(join(dir, 'nominations.json'))) this.write('nominations.json', [])
    if (!existsSync(join(dir, 'playbook-proposals.json'))) this.write('playbook-proposals.json', [])
    if (!existsSync(join(dir, 'security-alerts.json'))) this.write('security-alerts.json', [])
  }

  private read<T>(file: string): T {
    return JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as T
  }

  /** Atomic write: a crash mid-write never leaves a half-written knowledge base. */
  private write(file: string, data: unknown): void {
    const p = join(this.dir, file)
    writeFileSync(p + '.tmp', JSON.stringify(data, null, 2))
    renameSync(p + '.tmp', p)
  }

  library = () => this.read<LibraryClause[]>('library.json')
  precedents = () => this.read<Precedent[]>('precedents.json')
  playbook = () => this.read<PlaybookPosition[]>('playbook.json')
  nominations = () => this.read<Nomination[]>('nominations.json')
  playbookProposals = () => this.read<PlaybookProposal[]>('playbook-proposals.json')
  securityAlerts = () => this.read<SecurityAlert[]>('security-alerts.json')
  accounts = () => this.read<Account[]>('accounts.json')
  contracts = () => this.read<ContractRecord[]>('contracts.json')

  /** The questions asked of highlighted text, in the order offered (the app's own until any are changed). */
  questions(): AiQuestion[] {
    if (!existsSync(join(this.dir, 'questions.json'))) return defaultQuestions(DEFAULT_PROMPTS)
    // Saved before questions were prioritised: the ones shown as cards are the prioritised ones.
    return this.read<(AiQuestion & { shown?: boolean })[]>('questions.json').map(({ shown, ...q }) => ({ ...q, priority: q.priority ?? shown ?? false }))
  }

  saveQuestions(q: AiQuestion[]): void {
    this.write('questions.json', q)
  }

  saveAccounts(a: Account[]): void {
    this.write('accounts.json', a)
  }

  saveContracts(c: ContractRecord[]): void {
    this.write('contracts.json', c)
  }

  /** All reviews (versions) of one contract, oldest first. */
  versionsOf(contractId: string): ReviewSession[] {
    return readdirSync(join(this.dir, 'sessions'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(this.dir, 'sessions', f), 'utf8')) as ReviewSession)
      .filter((s) => s.contractId === contractId)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
  }

  /** A contract's Agent conversation (empty until the first question). */
  chat(key: string): ChatConversation {
    const f = join(this.dir, 'chats', `${key.replace(/[^\w.-]/g, '_')}.json`)
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ChatConversation) : { key, entries: [] }
  }

  saveChat(c: ChatConversation): void {
    mkdirSync(join(this.dir, 'chats'), { recursive: true })
    this.write(join('chats', `${c.key.replace(/[^\w.-]/g, '_')}.json`), c)
  }

  saveSecurityAlerts(a: SecurityAlert[]): void {
    this.write('security-alerts.json', a)
  }

  savePlaybook(p: PlaybookPosition[]): void {
    this.write('playbook.json', p)
  }

  savePlaybookProposals(p: PlaybookProposal[]): void {
    this.write('playbook-proposals.json', p)
  }

  saveLibrary(c: LibraryClause[]): void {
    this.write('library.json', c)
  }

  addLibraryClause(c: LibraryClause): void {
    this.write('library.json', [...this.library(), c])
  }

  upsertPrecedent(p: Precedent): void {
    this.write('precedents.json', [...this.precedents().filter((x) => x.id !== p.id), p])
  }

  removePrecedent(id: string): void {
    this.write('precedents.json', this.precedents().filter((x) => x.id !== id))
  }

  saveNominations(n: Nomination[]): void {
    this.write('nominations.json', n)
  }

  saveSession(s: ReviewSession): void {
    this.write(join('sessions', `${s.id}.json`), s)
  }

  loadSession(id: string): ReviewSession | null {
    const p = join(this.dir, 'sessions', `${id}.json`)
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ReviewSession) : null
  }

  listSessions(): ReviewSummary[] {
    const accounts = new Map(this.accounts().map((a) => [a.id, a.name]))
    const contracts = new Map(this.contracts().map((c) => [c.id, c]))
    return readdirSync(join(this.dir, 'sessions'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const file = join(this.dir, 'sessions', f)
        const s = JSON.parse(readFileSync(file, 'utf8')) as ReviewSession
        const decisions = Object.values(s.decisions)
        // Document reviews: paragraphs they changed, and how many are fully decided.
        const d = s.doc
        const changed = d ? d.blocks.filter(theyChanged) : []
        const contract = s.contractId ? contracts.get(s.contractId) : undefined
        return {
          id: s.id,
          accountId: s.accountId,
          accountName: s.accountId ? accounts.get(s.accountId) : undefined,
          contractId: s.contractId,
          contractTitle: contract?.title,
          version: s.version,
          docName: s.docName,
          createdAt: s.createdAt,
          updatedAt: statSync(file).mtime.toISOString(),
          mode: s.mode,
          contractType: s.contractType,
          clauses: d ? changed.length : s.clauses.length,
          decided: d ? changed.filter((b) => !stillOpen(d, b)).length : decisions.length,
          rejected: d ? rejectedCount(d) : decisions.filter((x) => x.decision === 'rejected').length,
          closed: !!s.closed,
          original: s.original || undefined,
          contractArchived: !!contract?.archived,
          ai: s.original ? undefined : reviewState(s)
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r, _i, all) => {
        // Not planned, and won't be: an earlier round (a later draft came), or closed.
        if (r.ai?.state !== 'not-planned') return r
        const later = all.filter((x) => x.contractId && x.contractId === r.contractId && (x.version ?? 0) > (r.version ?? 0)).length
        if (later) return { ...r, ai: { state: 'not-planned', label: 'Earlier round', detail: 'A later draft came; it’s reviewed instead.' } }
        if (r.closed) return { ...r, ai: { state: 'not-planned', label: 'Closed', detail: 'Closed without an AI review.' } }
        return r
      })
  }

}

/** Where a review's AI review stands, for lists (the contract's page, All contracts). */
export function reviewState(s: ReviewSession): ReviewState {
  const run = s.doc?.pipeline
  if (!run) return { state: 'not-planned', label: 'Not planned', detail: 'Planned in the background shortly.' }
  const parts = (run.parts ?? []).filter((p) => p.depth !== 'skip').length
  const review = run.steps.filter((x) => /^review(-\d+)?$/.test(x.id)).at(-1)
  const kids = review?.children ?? []
  const reviewed = kids.filter((c) => c.status !== 'waiting' && c.status !== 'running').length
  const changes = (run.parts ?? []).filter((p) => p.proposal?.status === 'approved').length
  const found = (run.parts ?? []).filter((p) => (p.findings ?? []).some((f) => f.severity !== 'info')).length
  const atCheck = run.steps.some((x) => x.id === 'check' && x.status === 'needs-you')
  if (run.status === 'running' && !run.confirmed) return { state: 'planning', label: 'Planning', detail: 'Reading its structure and planning the review.' }
  if (run.status === 'planned') return { state: 'planned', label: 'Planned', detail: `${parts} part${parts === 1 ? '' : 's'} to review${run.estimate ? `, about ${run.estimate.calls} AI calls` : ''}. Ready to start.` }
  if (run.status === 'running') return { state: 'reviewing', label: 'AI reviewing', detail: kids.length ? `${reviewed} of ${kids.length} parts reviewed.` : 'Under way.' }
  if (run.status === 'paused' && atCheck)
    return { state: 'your-turn', label: 'Ready for manual review', detail: changes ? `${changes} change${changes === 1 ? '' : 's'} made, to check before the new draft.` : found ? `${found} part${found === 1 ? '' : 's'} with findings to look at.` : 'Nothing to change: check, then write the new draft.' }
  if (run.status === 'paused') return { state: 'paused', label: 'Paused', detail: run.note ?? 'Waiting to go on.' }
  if (run.status === 'stopped') return { state: 'stopped', label: 'Stopped', detail: run.note ?? 'Stopped before it finished.' }
  if (run.status === 'error') return { state: 'failed', label: 'Failed', detail: run.note ?? 'Something went wrong.' }
  return { state: 'done', label: 'Reviewed', detail: run.email ? `${changes} change${changes === 1 ? '' : 's'} made; the new draft and email are ready.` : `${changes} change${changes === 1 ? '' : 's'} made.` }
}
