import type {
  Account, ContractRecord, AiTaskKind,
  AuditEntry, ChatConversation, SeenHit, EmailDraft, LibraryClause, Nomination,
  PlaybookPosition, PlaybookProposal, Precedent, ListStyle, RedlineComment, ChangeStatus, OurComment, RedlineStats, ReviewSession, ReviewSummary, SecurityAlert, Settings
} from '../shared/types'

type Unsub = () => void

export interface Api {
  settings: {
    get(): Promise<Settings>
    save(patch: Partial<Omit<Settings, 'hasApiKey' | 'hasVllmKey'>>): Promise<Settings>
    setApiKey(key: string | null): Promise<Settings>
    setVllmKey(key: string | null): Promise<Settings>
  }
  ai: {
    vllmModels(url: string): Promise<string[]>
    /** Run an AI task on highlighted text; the answer arrives as session updates (Explain also streams, as chat deltas with the run's id). */
    run(id: string, task: { kind: AiTaskKind; blockIds: string[]; quote: string }): Promise<{ session: ReviewSession; runId: string }>
  }
  workspace: {
    summary(): Promise<{ library: number; playbook: number; precedents: number; reviews: number; nominations: number }>
    /** Delete every account, contract, review and the knowledge base (settings and keys are kept); the window reloads. */
    clear(): Promise<boolean>
  }
  accounts: {
    list(): Promise<Account[]>
    create(name: string): Promise<Account>
  }
  contracts: {
    list(): Promise<ContractRecord[]>
    create(accountId: string, title: string): Promise<ContractRecord>
    versions(contractId: string): Promise<ReviewSummary[]>
    /** Archive (true) or bring back (false) a contract; returns all contracts. */
    archive(contractId: string, archived: boolean): Promise<ContractRecord[]>
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
    /** Close (true) or reopen (false) a review. */
    close(id: string, closed: boolean): Promise<ReviewSession>
    onUpdate(cb: (s: ReviewSession) => void): Unsub
  }
  email: { draft(id: string): Promise<EmailDraft> }
  doc: {
    /** Our wording for a paragraph; null clears it. */
    edit(id: string, blockId: string, text: string | null, group?: string): Promise<ReviewSession>
    /** Undo their changes in a change set, as our redline. */
    revert(id: string, setId: string): Promise<ReviewSession>
    decide(id: string, setId: string, status: ChangeStatus | null, note?: string): Promise<ReviewSession>
    comment(id: string, c: Pick<OurComment, 'blockId' | 'quote' | 'text' | 'replyTo'>): Promise<ReviewSession>
    uncomment(id: string, commentId: string): Promise<ReviewSession>
    /** Resolve a comment thread (theirs or ours), or reopen it. */
    resolveComment(id: string, commentId: string, done: boolean): Promise<ReviewSession>
    /** Enter: split a paragraph at the caret; the rest goes into a new paragraph of ours. */
    split(id: string, blockId: string, head: string, tail: string, newId?: string, list?: ListStyle | null): Promise<{ session: ReviewSession; id: string }>
    /** Number a paragraph we added (null: unnumbered). */
    setList(id: string, blockId: string, list: ListStyle | null): Promise<ReviewSession>
    /** Accept or reject one of their changes (segment index in the paragraph's redline); null reopens it. */
    resolve(id: string, blockId: string, seg: number, outcome: 'accepted' | 'rejected' | null, group?: string): Promise<ReviewSession>
    /** Undo one of our own changes (mark index in the paragraph as shown). */
    undoOurs(id: string, blockId: string, mark: number, group?: string): Promise<ReviewSession>
    /** Undo an action in the history (and later ones that depend on it). */
    undo(id: string, actionId: string): Promise<ReviewSession>
    redo(id: string, actionId: string): Promise<ReviewSession>
    /** Mark paragraphs with nothing to accept or reject as checked (or unmark them). */
    check(id: string, blockIds: string[], on: boolean): Promise<ReviewSession>
    /** Remove a paragraph we added. */
    unsplit(id: string, blockId: string): Promise<ReviewSession>
    /** Earlier negotiations per change set (identical first, then similar). */
    seen(id: string): Promise<Record<string, SeenHit[]>>
    /** Ask the AI about these change sets (one request each). Results arrive as session updates. */
    ask(id: string, setIds: string[]): Promise<ReviewSession>
    /** Nominate an accepted change's wording for the pre-approved library. */
    nominate(id: string, setId: string, note: string): Promise<ReviewSession>
  }
  redline: {
    /** Build the marked-up .docx without saving it (for the in-app preview). */
    preview(id: string): Promise<{ bytes: Uint8Array; stats: RedlineStats; comments: RedlineComment[]; name: string }>
    /** Build it and ask where to save it. Returns the saved path, or null if cancelled. */
    save(id: string): Promise<string | null>
    open(path: string): Promise<void>
  }
  /** Ask AI: one conversation per contract, kept in the main process. */
  chat: {
    get(id: string): Promise<ChatConversation>
    /** Ask a question (following up an AI card's answer: its run id); the question and the answer are added to the conversation (the answer streams as deltas). */
    send(id: string, question: string, requestId: string, about?: string): Promise<void>
    clear(id: string): Promise<void>
    onDelta(cb: (d: { requestId: string; text: string }) => void): Unsub
    /** A reasoning model started thinking before it answers (the thinking isn't shown). */
    onThinking(cb: (d: { requestId: string }) => void): Unsub
    /** The conversation for this contract (`key`) changed. */
    onChanged(cb: (d: { key: string }) => void): Unsub
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
    /** Save the library or the playbook as a JSON file; returns the path (null if cancelled). */
    export(kind: 'library' | 'playbook'): Promise<string | null>
    /** Import a library or playbook file, merged by id; null if cancelled. */
    import(kind: 'library' | 'playbook'): Promise<{ added: number; updated: number; unchanged: number } | null>
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
