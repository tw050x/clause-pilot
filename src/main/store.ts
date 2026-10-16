import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, ContractRecord, LibraryClause, Nomination, PlaybookPosition, PlaybookProposal, Precedent, ReviewSession, ReviewSummary, SecurityAlert } from '@shared/types'

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

  saveSecurityAlerts(a: SecurityAlert[]): void {
    this.write('security-alerts.json', a)
  }

  savePlaybook(p: PlaybookPosition[]): void {
    this.write('playbook.json', p)
  }

  savePlaybookProposals(p: PlaybookProposal[]): void {
    this.write('playbook-proposals.json', p)
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
    const contracts = new Map(this.contracts().map((c) => [c.id, c.title]))
    return readdirSync(join(this.dir, 'sessions'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const s = JSON.parse(readFileSync(join(this.dir, 'sessions', f), 'utf8')) as ReviewSession
        const decisions = Object.values(s.decisions)
        return {
          id: s.id,
          accountId: s.accountId,
          accountName: s.accountId ? accounts.get(s.accountId) : undefined,
          contractId: s.contractId,
          contractTitle: s.contractId ? contracts.get(s.contractId) : undefined,
          version: s.version,
          docName: s.docName,
          createdAt: s.createdAt,
          mode: s.mode,
          contractType: s.contractType,
          clauses: s.clauses.length,
          decided: decisions.length,
          rejected: decisions.filter((d) => d.decision === 'rejected').length
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

}
