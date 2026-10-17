# Clause Pilot

A desktop app that takes the reading out of routine contract review. It reads a contract, clears the clauses the legal team has already approved, and gives the lawyer everything they need to decide on the rest: what changed, what we agreed last time, and whether anything in the document quietly undoes the parts that look standard.

## Run it

```bash
npm install
npm run dev          # launches the Electron app
```

The app opens in **demo mode**: three demo contracts with recorded AI responses, no API key and no network needed. To run live, open **Settings**, add an Anthropic API key (or set `ANTHROPIC_API_KEY`) and switch demo mode off.

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build && npm start` | Production build and preview |
| `npm run typecheck` | Type-check main, preload and renderer |
| `npm run demo:build` | Regenerate seed data, demo contracts and demo recordings |
| `npm run pack` | Build an unpacked app for this machine (in `release/`) |
| `npm run release` | Build installers for this machine (in `release/`) |

## Where data is stored

Settings, the encrypted API key, and the demo and live workspaces live in the app's data folder:

| Running | Folder (macOS; other platforms use their usual app-data location) |
|---|---|
| Installed app | `~/Library/Application Support/Clause Pilot` |
| From source (`npm run dev`, `npm start`) | `~/Library/Application Support/Clause Pilot (Dev)` |

Set `CLAUSEPILOT_USER_DATA=/some/folder` to use a different folder, for example for a throwaway test run.

## CI and releases

- **Prerequisites** (`.github/workflows/prerequisites.yml`) runs on every push to every branch. It installs dependencies, typechecks, builds, and runs `demo:build`, which reviews the demo contracts the way the app does and fails if any change the app finds has no recorded AI answer (or an answer is for a change that no longer exists).
- **Release** (`.github/workflows/release.yml`) runs when a version tag is pushed (`git tag v0.2.0 && git push --tags`) or manually from the Actions tab. It builds a macOS `.dmg` (Apple silicon and Intel), a Windows installer and a Linux AppImage, and attaches them to a draft GitHub release.

Builds are not code-signed yet. On macOS, right-click the app and choose Open the first time; on Windows, choose "More info → Run anyway".

## Demos

The **Demos** page (linked from Start; opening it switches to demo mode) has short, focused guided demos. Each starts from a freshly reset demo workspace, with earlier drafts reviewed for you where the story needs them, so they can be run in any order. **Simulate upload** skips the tour and goes straight to the review. Demo mode replays recorded AI answers, so nothing leaves the computer.

| Demo | Shows |
|---|---|
| Initech: the fast lane | Our NDA signed back with no tracked changes: compared with our approved wording, three paragraphs differ out of twenty-seven |
| Acme: a redlined NDA | Their tracked changes answered in place: restore, strike, reply to their comment, accept; "seen before" and Ask AI on the residuals clause |
| Globex: the hidden trap | A PDF with no tracked changes: special conditions that aren't in our template undo the liability cap, and a prompt-injection attempt puts the review on security hold |
| Second draft | Acme's clean reply, compared with what we sent: one paragraph changed back without tracking, answered the same way as before in one click |
| Third draft | Our wording is in, but a one-sided publicity clause appeared without tracking |
| Add to the library | Accept and nominate wording, approve it, and future drafts are compared with it |
| Add to the playbook | Propose a standard position and approve it as the owner |

## Real-world test contracts

`test-contracts/` holds real published agreements (Common Paper, CC BY 4.0) and counterparty drafts of them with tracked changes, for trying the app on documents it wasn't written around. See `test-contracts/README.md`.

## How a review works

The contract is shown **as written**, paragraph by paragraph, the way their Word file or PDF shows it. It is never split into clauses. What needs reading is highlighted; everything else is greyed (or folded away with **Show only what changed**).

```
file ─▶ paragraphs (Word XML: numbering, key-terms rows, tracked changes, comments; PDF / text: lines)
     ─▶ local prompt-injection screen
     ─▶ their changes: tracked in Word, or found by comparing with a baseline
            later draft of a contract  ─▶ what we sent back last time (their text with our edits)
            first draft, on our paper  ─▶ our approved wording (the library)
     ─▶ grouped into change sets (every edit in a paragraph, and consecutive paragraphs of one clause)
     ─▶ you: accept · restore original · edit in place · comment · flag for review
            (Seen before: the same or a similar change in earlier negotiations, and how we answered it)
            (Ask AI: on request, one change set per request, with the whole contract for context)
     ─▶ marked-up .docx (our tracked changes and comments) + cover email + audit log + negotiation history
```

- **Change sets.** All their edits in one paragraph, and consecutive changed paragraphs in the same numbered section (2.1 and its (a), (b)), are one thing to decide, however many edits it has. A changed heading takes its sub-clauses with it (an inserted "5. NON-SOLICITATION" and its 5.1 are one change). Key-terms rows and unnumbered paragraphs found by comparison stand alone.
- **Untracked changes.** A later draft is lined up with what we sent (paragraph alignment, then a word diff), so anything they changed, added or removed without Track Changes shows as a change marked **not tracked**, next to what we proposed last round. A first draft that is mostly our approved wording is compared with the library the same way. The response email asks them to track changes next time.
- **Editing in place.** Double-click a paragraph (or ✎) to edit it as text. Your wording is shown and exported as tracked changes in your name, layered over theirs. Restore original writes the reversal of their change as your redline. Any paragraph can be edited, not just their changes.
- **Comments** go in the margin next to the paragraph, as replies when they commented. They become Word comments (threaded replies) and the reasons in the email.
- **Seen before.** Every change you accept or answer is saved: what they proposed, what was there, how we answered and why. A later change with the same wording (or the same words added elsewhere) is shown as **same change**, with **Answer the same way**; similar ones are found by keyword search (BM25).
- **AI on request.** Nothing goes to a model unless you ask. **Ask AI** on a change sends that change set as one request: the whole contract (cached, so asking about several changes is cheap), the change before and after with their comments, our playbook, and the earlier negotiations found for it. It answers what the change does, who it favours, playbook conflicts, which other paragraphs it affects, and suggested wording and a comment, which only take effect if you apply them. **Ask AI about N open changes** does the same for every open change.

### Our response as a marked-up copy

**Marked-up copy (.docx)** turns the review into the document lawyers actually send back, previewed in the app and saved for attaching to the email:

- **Our edits** become a word-level redline in the reviewer's name: only the words that differ are marked, and the printed number is never touched.
- **Accepted changes** have their tracked changes accepted in the file. **Undecided** changes are left exactly as sent.
- **Paragraphs they deleted** that we restore have their deletion rejected; paragraphs they removed **without** tracking are inserted back as our tracked insertion.
- **Comments** become Word comments; replies to theirs are threaded.
- **Formats:** a Word upload is edited in place, so their formatting, numbering and redline survive. PDF and text uploads have no Word original, so a plain `.docx` is built from the paragraphs and marked up the same way. Track Changes is switched on in the file, so their next edits are tracked too.
- Saving is blocked while the review is on security hold. Each save is in the audit log with the file's SHA-256.

## Accounts, contracts and versions

You work on **one client account at a time**, chosen with the switcher at the top left (⌘K). The sidebar lists that client's **contracts**; each has its own page with every draft reviewed so far and an upload button for the next. The library, playbook, precedents, approvals, security and audit are shared across clients.

Each uploaded draft becomes a new **version** of its contract, compared with what we sent back for the previous one (see above): the summary says which of our edits they took, and how many paragraphs changed without Track Changes.

### Design decisions

- **The document, not clauses.** Splitting real contracts into clauses reliably is close to impossible (auto-numbering, cover-page tables, schedules, sub-items). Showing the document as written and grouping only what changed avoids the problem, and is how lawyers read a redline anyway.
- **Reduce what has to be read.** Unchanged text from the previous round or from our approved wording stays in the background. Only differences, tracked or not, need a decision.
- **AI only when asked, per change set.** No model runs on upload. When asked, each change set is one request with the whole contract as a cached prefix, so a clause with twelve edits over several lines is reviewed as one change in context, and the cost is proportional to what you ask about.
- **The AI never changes anything.** Its suggestions are applied only by the reviewer, the model's output is schema-constrained, and paragraph ids it returns are checked (suggested edits must be inside the change).
- **Contracts are untrusted input.** Counterparty text is wrapped in tags and the model is told it is data. A local screen flags text addressed to an AI *before* anything could be sent; the review then goes on security hold (no AI, nothing sent back) until the security team has looked at it.
- **The knowledge base learns, with a human gate.** Every decision becomes negotiation history for "seen before". Accepted wording can be *nominated*; promoting it to the library is a separate, audited approval.
- **Record/replay.** Every live AI response is saved, keyed by a hash of its task and the contract and change it was about. That gives demo mode, offline replay, and a fixed baseline for evaluating prompt or model changes.
- **Auditability.** An append-only JSONL log in which each entry includes the hash of the previous one. The app verifies the chain and exports a per-review record (each change, how it was answered, by whom) as Markdown.
- **Local-first.** Data is plain JSON in the app's user-data folder. The API key is encrypted with the OS keychain (Electron `safeStorage`) and never reaches the renderer. The renderer is sandboxed and context-isolated, with a strict CSP.

## Documentation

- [`docs/intent-matching.md`](docs/intent-matching.md): the AI meaning check: the request, the complete JSON Schema the model must answer in, what the API enforces, and the checks in code. CI fails if it drifts from the code (`npm run docs:check`).

## Code map

```
src/main/
  ingest/parse.ts        PDF, DOCX and TXT to text
  ingest/docxTracked.ts  Word XML: paragraphs, numbering, key-terms rows, tracked changes, comments
  ingest/blocks.ts       the contract as paragraphs (DocBlocks)
  engine/baseline.ts     untracked changes: comparison with what we sent / our approved wording
  engine/seen.ts         negotiation history: recording decided changes, "seen before" lookup
  engine/text.ts         normalisation, similarity, word diff
  engine/matcher.ts      precedent index (BM25 via MiniSearch)
  engine/injection.ts    local prompt-injection screen
  docreview.ts           creating a review; the AI input for a change set, and checking its answer
  ai/                    task schemas (Zod), prompts, Claude provider, replay provider, recorder
  redline/docx.ts        our response as a marked-up .docx (tracked changes and comments)
  email.ts, chat.ts      cover email; the chat panel's context
  store.ts, audit.ts     JSON store; hash-chained audit log
  index.ts               Electron main + IPC
src/shared/
  changes.ts             change sets and their status
  diff.ts                word diff, and our edit layered over their redline
src/renderer/            React UI (views/DocReview.tsx is the review screen)
scripts/                 seed data, demo contracts, demo builder, test contracts; dev/ has small CLI checks
demo/authored/           hand-written demo AI answers, compiled into demo/recordings by demo:build
```

`npx tsx --tsconfig tsconfig.node.json scripts/dev/sets.ts <files…>` prints the change sets the app finds in contracts (`--history` treats the files as consecutive versions of the Acme demo).

## Limitations

- Editing is a paragraph at a time (as text), not live typing into the redline. Comments are anchored to the paragraph; the quoted text is kept but not highlighted in Word.
- Grouping uses numbering (typed, or Word's automatic numbering). Unnumbered continuation paragraphs join the change above them. Scanned PDFs would need OCR. Legacy `.doc` files are rejected with a "save as .docx" message.
- Paragraph alignment between drafts uses a similarity threshold (0.45) tuned on the demo set only.
- Demo recordings are authored, not captured from a live model. Run live with recording on to capture real ones.
- Single user, local data. A team deployment needs a shared store and identity for the audit log.
