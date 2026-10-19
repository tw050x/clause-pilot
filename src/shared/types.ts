// Domain types shared by the main process (pipeline) and the renderer (UI).

export type SourceType = 'pdf' | 'docx' | 'txt'
export type ContractType = 'nda' | 'order-form' | 'general'

/** A run of a Word redline: unchanged, or a tracked insertion/deletion by someone. */
export interface TrackedSegment {
  op: 'same' | 'ins' | 'del'
  text: string
  author?: string
  date?: string
  /** Its index in the paragraph's redline as received (kept when some changes are resolved). */
  i?: number
}

/** A margin comment in a Word document. */
export interface DocComment {
  id: string
  author: string
  date?: string
  text: string
  /** The text in this paragraph the comment is anchored to in Word (its comment range), as proposed. */
  quote?: string
  /** Marked resolved ("done") in their file. */
  done?: boolean
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
  // Document reviews record the change itself, so the same ask can be recognised next time.
  /** Where it was ("§2.4"). */
  where?: string
  /** The wording before their change (`text` is what they proposed). */
  before?: string
  /** The words they added, to recognise the same ask in a differently worded clause. */
  inserted?: string
  /** How we answered it. */
  response?: 'accepted' | 'countered' | 'restored' | 'struck'
  /** Our wording, per paragraph of the change (null: left as they proposed). */
  ours?: (string | null)[]
}

export interface PrecedentHit extends Precedent {
  score: number
  terms: string[]
}

/** A change seen in earlier negotiations: the identical change, or a similar one. */
export interface SeenHit extends PrecedentHit {
  match: 'identical' | 'similar'
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
  /** Our proposed replacement wording (empty when we ask for removal or just reject). */
  redline: string
  /** We ask the counterparty to remove the clause rather than reword it. */
  removal?: boolean
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
  /** Archived: kept, but out of the sidebar, and its reviews hidden on the Reviews page. */
  archived?: { by: string; at: string }
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

// ---- Document review: the contract as written, decorated with changes ------------------------

/** One paragraph (or key-terms table row) of the contract, as received. */
export interface DocBlock {
  id: string
  kind: 'para' | 'heading' | 'row' | 'deleted'
  /** The printed number ("2.1", "a."), shown but never edited. */
  label?: string
  /** As received, without the label: their insertions in, their deletions out. For 'deleted', the text they deleted. */
  text: string
  /** Their redline, as tracked changes (without the label). */
  segments?: TrackedSegment[]
  comments?: DocComment[]
  /** The Word paragraphs it came from (document order), for writing the marked-up copy. */
  paras?: number[]
  center?: boolean
  bold?: boolean
  /** List depth, for indenting. */
  level?: number
  /**
   * Their change found by comparison rather than tracked in Word: with what we sent last
   * time ('sent') or with our standard wording ('template'). `segments` then holds that diff.
   */
  untracked?: 'sent' | 'template'
  /** Our pre-approved wording this paragraph was compared with (template comparison). */
  standard?: string
  /** The paragraph as received is word for word this pre-approved clause. */
  approved?: string
  /** Before their change it was word for word this pre-approved clause. */
  wasApproved?: string
  /**
   * Not our wording (their paper): ids of the library clauses closest to it by keywords, for
   * the AI to compare intent with. Found locally on upload; nothing is decided by it.
   */
  matches?: string[]
  /** A paragraph we added (by pressing Enter): its wording is in `edits`, all of it our insertion. */
  ours?: boolean
  /** A paragraph we added in a numbered list: numbered like its neighbours (see shared/numbering.ts). */
  list?: ListStyle
}

/** How a paragraph we added is numbered: a decimal level ("2.4" is depth 2), or a lettered / roman item. */
export interface ListStyle {
  kind: 'dec' | 'alpha' | 'Alpha' | 'roman'
  depth: number
  open?: string
  close?: string
}

/** A comment of ours, in the margin. */
export interface OurComment {
  id: string
  blockId: string
  /** The text it's on, when made on a selection. */
  quote?: string
  text: string
  /** Their comment (id) this replies to. */
  replyTo?: string
  by: string
  at: string
  /** Changed after it was written (it can be, until the review is sent on). */
  edited?: { by: string; at: string }
}

/**
 * accepted: their change stands. countered: we answer it with our own edits (made in the document).
 * flagged: someone else needs to look at it before we answer.
 */
export type ChangeStatus = 'accepted' | 'countered' | 'flagged'

export interface ChangeDecision {
  status: ChangeStatus
  note?: string
  by: string
  at: string
}

/** What we proposed for a paragraph in the previous round. */
export interface LastRound {
  /** The wording we sent back. */
  sent: string
  /** It was our edit (not their wording, or the original, left alone). */
  ourEdit: boolean
  /** Our comments on it. */
  comments: string[]
}

/** What a new draft was compared with, to find changes they didn't track. */
export interface Baseline {
  kind: 'sent' | 'template'
  /** Version compared with ('sent'). */
  version?: number
  /** Paragraphs where they took our wording (as "§6.8"). */
  ourEditsAccepted: string[]
  /** Paragraphs changed, added or removed without Track Changes. */
  untracked: number
  /** Paragraphs that are word for word our pre-approved wording ('template'). */
  approved?: number
}

/** The AI's review of one change set, in the context of the whole contract. Only run when asked. */
export interface ChangeReview {
  summary: string
  effect: 'favours-us' | 'neutral' | 'favours-them'
  risk: 'high' | 'medium' | 'low'
  recommendation: 'accept' | 'counter' | 'restore' | 'escalate'
  reasoning: string
  playbook: { positionId: string; title: string; conflict: boolean; note: string }[]
  /** Other passages this change affects or depends on. */
  related: { blockId: string; where: string; why: string }[]
  /** Suggested wording per paragraph, to apply as our edits. */
  suggested: { blockId: string; text: string }[]
  /** A suggested comment to them. */
  comment: string
  injectionSuspected: boolean
  at: string
}

export interface DocReview {
  /** A PDF's main typeface ("Calibri"), for the Word file the page and the marked-up copy are built as. */
  font?: string
  blocks: DocBlock[]
  /** Our wording per block (without the label). Empty: we strike the paragraph. */
  edits: Record<string, string>
  comments: OurComment[]
  /** Keyed by change-set id (its first block's id). */
  decisions: Record<string, ChangeDecision>
  baseline?: Baseline
  /** Per block: what we proposed for it last round ('sent' baseline). */
  lastRound?: Record<string, LastRound>
  /** AI reviews, per change set, made on request. */
  ai?: Record<string, Step<ChangeReview>>
  /** Change sets whose accepted wording was nominated for the library. */
  nominated?: string[]
  /** Their individual tracked changes accepted or rejected, keyed "blockId:segmentIndex". */
  resolved?: Record<string, 'accepted' | 'rejected'>
  /** What was done, action by action, for undo and redo (see shared/history.ts). */
  history?: HistoryAction[]
  /** AI checks, on request, of whether a paragraph means the same as our approved wording. */
  intent?: Record<string, IntentCheck>
  /**
   * Comment threads resolved (or reopened) here, by the id of the thread's first comment, theirs
   * or ours. As in Word, a resolved comment stays in the document, greyed out and unhighlighted.
   * `done: false` reopens one they had resolved in their file.
   */
  commentsDone?: Record<string, CommentDone>
  /** Paragraphs with nothing to accept or reject that the reviewer has read and marked as checked. */
  checked?: Record<string, CheckedMark>
  /** AI tasks run on highlighted text (the question cards in the review column), newest last. */
  aiRuns?: AiTaskRun[]
}

/**
 * An AI answer as shown: Markdown text, and finding cards (one per paragraph, position or change)
 * that carry actions such as applying the suggested wording.
 */
export type AiAnswerPart =
  | { type: 'text'; markdown: string }
  | {
      type: 'finding'
      title: string
      /** A word or two: "Deviates", "Meets our standard", "Same intent". */
      verdict: string
      tone: 'good' | 'warn' | 'bad' | 'neutral'
      /** The paragraphs it is about, as a link to them. */
      where?: { label: string; blockIds: string[] }
      /** Markdown. */
      body?: string
      actions: AiAction[]
    }

export type AiAction =
  /** Make this our wording for the paragraph (a tracked edit, like typing it). */
  | { type: 'apply-wording'; blockId: string; where: string; text: string; label?: string }
  /** Add this comment to them on the paragraph. */
  | { type: 'comment'; blockId: string; where: string; text: string }

/** The questions the app starts with (and their ids). Runs saved before questions were editable carry one of these as their kind. */
export type AiTaskKind = 'intent' | 'playbook' | 'changes' | 'explain'

/**
 * How a question is asked of the highlighted text:
 * - once: one request, about the highlight
 * - paragraphs: one request per highlighted paragraph we have approved wording for, compared with it
 *   (a paragraph found to mean the same is marked so in the review)
 * - positions: one request per playbook position that applies to the contract
 * - changes: one request per change of theirs in the highlight, read against the whole contract
 *   (the answer is kept on the change too)
 */
export type QuestionMethod = 'once' | 'paragraphs' | 'positions' | 'changes'

/** What can be sent with a question, besides the highlighted text (always sent). */
export type QuestionData = 'contract' | 'paragraphs' | 'changes' | 'edits' | 'library' | 'playbook' | 'precedents' | 'findings'

/** A question that can be asked of highlighted text in a review: a card in the review's AI section. */
export interface AiQuestion {
  id: string
  /** Shown after "Ask:" on the card, e.g. "Does it meet our playbook?". */
  title: string
  /** The card's second line. */
  detail: string
  /** The instructions: what to do with the data, and how to answer. */
  prompt: string
  method: QuestionMethod
  data: QuestionData[]
  /** For questions asked once: a written answer, or findings (a verdict per point, with suggested wording to apply). The other methods always answer with findings. */
  answer: 'text' | 'findings'
  /** For questions asked once and answered as cards: the JSON Schema of the answer (none: the app's default). See @shared/schema. */
  schema?: Record<string, unknown>
  /** Prioritised: a card in the review's AI section. The rest are offered under "More questions". */
  priority: boolean
  /** The question the app started with that this was (it can be reset to that). */
  origin?: AiTaskKind
  updatedBy?: string
  updatedAt?: string
}

/**
 * One question asked of highlighted text: what was asked, and what the server answered, as
 * Markdown and as returned.
 */
export interface AiTaskRun {
  id: string
  /** The question asked (runs from before questions were editable: see `kind`). */
  questionId?: string
  /** Its title when asked. */
  title?: string
  /** Runs from before questions were editable: the built-in question asked (its id now). */
  kind?: AiTaskKind
  /** The paragraphs the highlight covered, and its text. */
  blockIds: string[]
  quote: string
  /** The question, as asked: its title, where, and the highlighted text. */
  question: string
  status: 'running' | 'done' | 'error'
  by: string
  at: string
  /** The answer, in Markdown, written from the server's response. */
  answer?: string
  /** The same answer, structured for display: text, and a card per finding with what can be done about it. */
  parts?: AiAnswerPart[]
  /** The server's response(s), exactly as returned (structured tasks: the JSON). */
  raw?: unknown
  error?: string
}

/** A comment thread resolved or reopened, by whom and when. */
export interface CommentDone {
  done: boolean
  by: string
  at: string
}

/** A reviewer marked a paragraph as checked; it stands while the paragraph reads `text`. */
export interface CheckedMark {
  by: string
  at: string
  text: string
}

/** The AI's view of whether a paragraph has the same legal effect as our approved clause. */
export interface IntentCheck {
  status: 'running' | 'done' | 'error'
  /** The paragraph text that was checked; the result stands only while the text is the same. */
  text: string
  /** Same legal effect, and passed the checks in code (see main/docreview.ts). */
  same?: boolean
  /** Our approved clause it was compared with. */
  title?: string
  confidence?: 'high' | 'medium' | 'low'
  reasoning?: string
  differences?: { description: string; favours: 'us' | 'counterparty' | 'neutral' }[]
  /** Why it was or wasn't counted as the same. */
  note?: string
  error?: string
  at: string
}

/** One action in a review's undo history: the state it changed, before and after. */
export interface HistoryAction {
  id: string
  /** Actions with the same group, one straight after another, are one action (a selection, typing in one paragraph). */
  group?: string
  at: string
  by: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  undone?: boolean
}

export interface ReviewSession {
  id: string
  accountId?: string
  contractId?: string
  version?: number
  /** The review of the previous version this one was compared with. */
  previous?: { sessionId: string; version: number }
  /**
   * The original we sent (version 0), uploaded with a first draft on our paper so the draft can be
   * compared with it exactly. Kept for comparison; there is nothing to review in it.
   */
  original?: boolean
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
  /** Document review: present on reviews made with the document screen (no clause pipeline). */
  doc?: DocReview
  /** Closed: kept, but hidden on the Reviews page. */
  closed?: { by: string; at: string }
}

/** A comment we put in the marked-up response. */
export interface RedlineComment {
  where: string
  author: string
  text: string
  /** The clause text the comment is on (to find it in the preview). */
  quote: string
  /** Their comment this replies to. */
  replyTo?: { author: string; text: string }
}

/** What went into a marked-up response (.docx). */
export interface RedlineStats {
  /** 'original': their Word file, marked up. 'generated': built from the clauses (PDF / text uploads). */
  source: 'original' | 'generated'
  replaced: number
  removed: number
  commentedOnly: number
  reinstated: number
  /** Accepted clauses whose tracked changes we accepted. */
  acceptedChanges: number
  comments: number
  /** Decided clauses that couldn't be located in the document (should be 0). */
  unmatched: string[]
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
  /** When it was last saved (anything done in it). */
  updatedAt: string
  mode: 'live' | 'demo'
  contractType: ContractType
  /** Paragraphs they changed, and how many of those are decided (all their changes accepted or rejected). */
  clauses: number
  decided: number
  rejected: number
  closed?: boolean
  /** The original we sent (version 0): kept for comparison, not a review. */
  original?: boolean
  /** Its contract is archived. */
  contractArchived?: boolean
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
  /** Can resolve security alerts and release a review from security hold. */
  securityReviewer: boolean
  /** Which AI answers the AI steps: Claude (Anthropic API) or a vLLM server. */
  aiProvider: 'claude' | 'vllm'
  /** Claude model. */
  model: string
  hasApiKey: boolean
  /** vLLM server address (OpenAI-compatible API), e.g. http://192.168.1.20:8000. */
  vllmUrl: string
  /** Model name as the vLLM server serves it. */
  vllmModel: string
  hasVllmKey: boolean
  recordLiveResponses: boolean
  /** Debug mode: shows what is normally hidden, such as each AI answer as the server returned it. */
  debug: boolean
}


export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** One message in a contract's Agent conversation, as kept. */
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: string
  /** Who asked (user messages). */
  by?: string
  /** The review (version) it was asked in. */
  sessionId: string
  version?: number
  /** From an AI card: the task it asked and answered. A one-off: not part of the conversation's thread. */
  runId?: string
  /** A typed question following up an AI card's answer (its run): that answer goes with it. */
  about?: string
  /** An answer that failed: shown, but not sent to the AI as context. */
  failed?: boolean
  /** An answer as the server returned it, with how it was asked (shown in Debug mode). */
  raw?: unknown
}

/**
 * The Agent for one contract: a single conversation across its versions. Everything is kept and
 * shown; what goes to the AI is the summary of older messages plus the newer ones verbatim.
 */
export interface ChatConversation {
  /** The contract's id (or the review's, for a review not filed under a contract). */
  key: string
  entries: ChatEntry[]
  /** Older messages, summarised for the AI once the conversation outgrew its budget. */
  summary?: { text: string; through: string; at: string }
}

export interface EmailDraft {
  subject: string
  body: string
  generatedBy: 'ai' | 'template'
}

/**
 * Where a first draft started, as the reviewer says when opening it:
 * - original: ours, and here is the document we sent (compared with it exactly)
 * - ours: ours, but no original to hand (compared with our approved clauses)
 * - theirs: their paper (nothing is assumed to be ours; close clauses are offered to compare)
 */
export type DraftOrigin = { kind: 'original'; path: string } | { kind: 'ours' } | { kind: 'theirs' }

/** What a first draft looks like before it's opened: how much of it is our approved wording. */
export interface DraftProbe {
  /** Paragraphs of 8 words or more. */
  paragraphs: number
  /** Of those, word for word one of our approved clauses. */
  approved: number
  /** Enough of it is our wording that it looks like our paper. */
  looksOurs: boolean
}
