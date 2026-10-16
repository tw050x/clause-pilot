import type {
  Account, ContractRecord,
  AuditEntry, ChatMessage, Decision, DemoContract, EmailDraft, LibraryClause, Nomination,
  PlaybookPosition, PlaybookProposal, Precedent, ReviewSession, ReviewSummary, SecurityAlert, Settings
} from '../shared/types'

type Unsub = () => void

export interface Api {
  settings: {
    get(): Promise<Settings>
    save(patch: Partial<Omit<Settings, 'hasApiKey'>>): Promise<Settings>
    setApiKey(key: string | null): Promise<Settings>
  }
  demo: { list(): Promise<DemoContract[]>; reset(): Promise<boolean>; prepare(scenarioId: string): Promise<boolean> }
  workspace: { summary(): Promise<{ mode: 'demo' | 'live'; library: number; playbook: number; precedents: number; reviews: number; nominations: number }> }
  accounts: {
    list(): Promise<Account[]>
    create(name: string): Promise<Account>
  }
  contracts: {
    list(): Promise<ContractRecord[]>
    create(accountId: string, title: string): Promise<ContractRecord>
    versions(contractId: string): Promise<ReviewSummary[]>
  }
  security: {
    list(): Promise<SecurityAlert[]>
    resolve(id: string, outcome: 'malicious' | 'false-positive', note: string): Promise<SecurityAlert[]>
    onUpdate(cb: () => void): Unsub
  }
  file: { open(): Promise<string | null>; bytes(path: string): Promise<Uint8Array> }
  review: {
    start(path: string, contractId?: string): Promise<ReviewSession>
    get(id: string): Promise<ReviewSession>
    list(): Promise<ReviewSummary[]>
    decide(id: string, d: Omit<Decision, 'by' | 'at'>): Promise<ReviewSession>
    undo(id: string, clauseId: string): Promise<ReviewSession>
    onUpdate(cb: (s: ReviewSession) => void): Unsub
  }
  email: { draft(id: string): Promise<EmailDraft> }
  chat: {
    send(id: string, history: ChatMessage[], requestId: string): Promise<string>
    onDelta(cb: (d: { requestId: string; text: string }) => void): Unsub
  }
  kb: {
    library(): Promise<LibraryClause[]>
    playbook(): Promise<PlaybookPosition[]>
    precedents(): Promise<Precedent[]>
    nominations(): Promise<Nomination[]>
    promote(id: string, title: string, category: string): Promise<Nomination[]>
    dismiss(id: string): Promise<Nomination[]>
    playbookProposals(): Promise<PlaybookProposal[]>
    proposePlaybook(p: { kind: PlaybookProposal['kind']; positionId: string | null; after: PlaybookPosition | null; reason: string }): Promise<PlaybookProposal[]>
    decidePlaybook(id: string, approve: boolean, note: string): Promise<{ proposals: PlaybookProposal[]; playbook: PlaybookPosition[] }>
  }
  audit: {
    list(sessionId?: string): Promise<AuditEntry[]>
    verify(): Promise<{ ok: boolean; entries: number; brokenAt?: number }>
    export(sessionId: string): Promise<string | null>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
