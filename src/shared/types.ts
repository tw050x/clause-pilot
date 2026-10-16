// Domain types shared by the main process (pipeline) and the renderer (UI).

export type SourceType = 'pdf' | 'docx' | 'txt'
export type ContractType = 'nda' | 'order-form' | 'general'

/** A run of a Word redline: unchanged, or a tracked insertion/deletion by someone. */
export interface TrackedSegment {
  op: 'same' | 'ins' | 'del'
  text: string
  author?: string
  date?: string
}

/** A margin comment in a Word document. */
export interface DocComment {
  id: string
  author: string
  date?: string
  text: string
}

export interface Clause {
  id: string // stable within a session: "c0", "c1", ...
  index: number
  number: string | null // "4.2" as printed in the document
  heading: string | null // nearest heading, e.g. "CONFIDENTIALITY"
  /** The text as proposed: tracked insertions in, tracked deletions out. */
  text: string
  /** The Word redline for this clause, if it has tracked changes. */
  tracked?: TrackedSegment[]
  /** Margin comments anchored on this clause. */
  comments?: DocComment[]
}

/** A whole clause deleted as a tracked change. */
export interface TrackedDeletion {
  number: string | null
  text: string
  author?: string
  date?: string
  /** Set when the deleted text was word for word one of our pre-approved clauses. */
  libraryTitle?: string
}

export type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped'

export interface Step<T> {
  status: StepStatus
  data?: T
  error?: string
  /** Human-readable explanation shown next to the spinner / result. */
  reason?: string
}

// ---- (a) Library match -------------------------------------------------------

export interface LibraryClause {
  id: string
  contractType: ContractType
  category: string
  title: string
  text: string
  approvedBy: string
  approvedOn: string
}

export interface DiffToken {
  op: 'same' | 'add' | 'del'
  text: string
}

export interface MatchCandidate {
  libraryId: string
  title: string
  category: string
  text: string
  score: number // 0..1 lexical similarity
  diff: DiffToken[] // library text -> contract text
}

export interface IntentVerdict {
  aligned: boolean
  bestMatchId: string | null
  confidence: 'high' | 'medium' | 'low'
  materialDifferences: { description: string; favours: 'us' | 'counterparty' | 'neutral' }[]
  reasoning: string
  injectionSuspected: boolean
}

export type MatchKind = 'exact' | 'intent' | 'none'

export interface MatchResult {
  kind: MatchKind
  libraryId?: string
  candidates: MatchCandidate[]
  verdict?: IntentVerdict
  /** Why the deterministic gate accepted/rejected the AI verdict. */
  gateNote?: string
}

// ---- (b) Precedent search -----------------------------------------------------

export type Outcome = 'accepted' | 'rejected'

export interface Precedent {
  id: string
  contractType: ContractType
  category: string
  counterparty: string
  date: string
  text: string
  outcome: Outcome
  notes: string
  source: 'seed' | 'review'
}

export interface PrecedentHit extends Precedent {
  score: number
  terms: string[]
}

// ---- (c) Override detection ---------------------------------------------------

export interface OverrideFinding {
  id: string
  overridingClauseId: string
  overriddenClauseIds: string[]
  mechanism: 'notwithstanding' | 'order-of-precedence' | 'definition-change' | 'carve-out' | 'other'
  summary: string
  effect: string
  severity: 'high' | 'medium' | 'low'
  quote: string
}

// ---- (d) Playbook / standard positions ----------------------------------------

export interface PlaybookPosition {
  id: string
  title: string
  appliesTo: ContractType[]
  standard: string // our position, in plain English
  acceptableFallback: string
  redFlags: string[]
  version?: number
  updatedBy?: string
  updatedAt?: string
}

/** A proposed change to the playbook. Proposed by one person, approved by another (the owner). */
export interface PlaybookProposal {
  id: string
  kind: 'add' | 'edit' | 'delete'
  positionId: string | null // null for 'add' until approved
  before: PlaybookPosition | null
  after: PlaybookPosition | null
  reason: string
  proposedBy: string
  proposedAt: string
  status: 'pending' | 'approved' | 'declined'
  decidedBy?: string
  decidedAt?: string
  decisionNote?: string
}

export interface PlaybookFinding {
  positionId: string
  positionTitle: string
  status: 'compliant' | 'deviation' | 'missing' | 'not-applicable'
  clauseIds: string[]
  deviation: string
  severity: 'high' | 'medium' | 'low'
  suggestedRedline: string
  withinFallback: boolean
}

// ---- Human review --------------------------------------------------------------

export interface Decision {
  clauseId: string
  decision: Outcome
  note: string
  redline: string
  nominate: boolean // accepted clause nominated for the pre-approved library
  by: string
  at: string
}

// ---- Accounts, contracts and versions ----------------------------------------

/** A client we contract with. */
export interface Account {
  id: string
  name: string
  createdAt: string
}

/** A contract with an account. Each uploaded draft is a version (a review). */
export interface ContractRecord {
  id: string
  accountId: string
  title: string
  contractType: ContractType
  createdAt: string
}

/** How a clause relates to the previous version of the same contract. */
export interface VersionLink {
  kind: 'unchanged' | 'changed' | 'new'
  prevClauseId?: string
  prevLabel?: string
  prevText?: string
  /** What happened to it in the previous version. */
  prevStatus?: 'accepted' | 'pre-approved' | 'rejected' | 'open'
  prevNote?: string
  prevRedline?: string
  /** Word diff from the previous version's text to this one (changed clauses). */
  diff?: DiffToken[]
  /** The new text is the wording we proposed last time. */
  matchesOurRedline?: boolean
}

export interface RemovedClause {
  prevClauseId: string
  label: string
  text: string
  prevStatus: 'accepted' | 'pre-approved' | 'rejected' | 'open'
  prevNote?: string
}

export interface ReviewSession {
  id: string
  accountId?: string
  contractId?: string
  version?: number
  /** The review of the previous version this one was compared with. */
  previous?: { sessionId: string; version: number }
  versionLinks?: Record<string, VersionLink>
  removed?: RemovedClause[]
  /** Clauses deleted as tracked changes in this draft (Word redlines). */
  trackedDeletions?: TrackedDeletion[]
  docName: string
  filePath: string
  sourceType: SourceType
  contractType: ContractType
  fileSha256: string
  mode: 'live' | 'demo'
  createdAt: string
  clauses: Clause[]
  match: Record<string, Step<MatchResult>>
  precedents: Record<string, Step<PrecedentHit[]>>
  overrides: Step<OverrideFinding[]>
  playbook: Record<string, Step<PlaybookFinding>> // keyed by position id
  injection: Record<string, string[]> // clause id -> local heuristic hits
  aiInjectionReports: string[] // notes from the model when it believes it saw an injection attempt
  decisions: Record<string, Decision>
}

export interface ReviewSummary {
  id: string
  accountId?: string
  accountName?: string
  contractId?: string
  contractTitle?: string
  version?: number
  docName: string
  createdAt: string
  mode: 'live' | 'demo'
  contractType: ContractType
  clauses: number
  decided: number
  rejected: number
}

// ---- Library promotion queue -----------------------------------------------------

export interface Nomination {
  id: string
  text: string
  category: string
  contractType: ContractType
  fromDoc: string
  counterparty: string
  nominatedBy: string
  nominatedAt: string
  note: string
  status: 'pending' | 'promoted' | 'dismissed'
}

// ---- Audit -------------------------------------------------------------------------

export interface AuditEntry {
  seq: number
  ts: string
  actor: string
  type: string
  sessionId: string | null
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

// ---- Settings / misc ----------------------------------------------------------------

/** Raised when contract text appears to be addressed to an AI reviewer. Resolved by the security team. */
export interface SecurityAlert {
  id: string
  sessionId: string
  docName: string
  raisedAt: string
  clauses: { clauseId: string; label: string; text: string; hits: string[] }[]
  aiNotes: string[]
  status: 'open' | 'malicious' | 'false-positive'
  resolvedBy?: string
  resolvedAt?: string
  note?: string
}

export interface Settings {
  reviewerName: string
  /** Can resolve security alerts (in demo mode the user also acts as the security team). */
  securityReviewer: boolean
  demoMode: boolean
  model: string
  hasApiKey: boolean
  recordLiveResponses: boolean
}

export interface DemoContract {
  file: string
  accountId: string
  contractId: string
  /** A later draft of another demo contract (offered as "Upload new draft", not on the Start page). */
  followUpOf?: string
  title: string
  description: string
  path: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface EmailDraft {
  subject: string
  body: string
  generatedBy: 'ai' | 'template'
}
