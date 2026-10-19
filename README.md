# Clause Pilot

A desktop app that takes the reading out of routine contract review. It reads a contract, clears the clauses the legal team has already approved, and gives the lawyer everything they need to decide on the rest: what changed, what we agreed last time, and whether anything in the document quietly undoes the parts that look standard.

## Run it

```bash
npm install
npm run dev          # launches the Electron app
```

Reviewing, editing, the marked-up copy and the email work without any AI. The AI steps (questions on highlighted text, change review, the Agent) run only when you ask, on the AI chosen in **Settings → AI**:

- **Claude:** add an Anthropic API key (or set `ANTHROPIC_API_KEY`) and pick the model.
- **vLLM:** your own model on a vLLM server (OpenAI-compatible API), for example on your local network. Enter its address (for example `http://192.168.1.20:8000`), press **Connect** to list the models it serves and pick one. An API key is optional (only if the server was started with `--api-key`; or set `VLLM_API_KEY`). Answers are constrained to each task's JSON Schema through vLLM's structured output and validated again in code.

The title bar shows which AI is in use.

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build && npm start` | Production build and preview |
| `npm run typecheck` | Type-check main, preload and renderer |
| `npm run demo:build` | Regenerate the demo files (`demo/`): library, playbook and contracts |
| `npm run docs:check` | Check the documented AI schemas match the code |
| `npm run pack` | Build an unpacked app for this machine (in `release/`) |
| `npm run release` | Build installers for this machine (in `release/`) |
| `npm run icon` | Remake the app icons from `build/icon.svg`: `icon.icns` (macOS), `icon.ico` (Windows), `icon.png` (Linux) and `icon-mac.png` (the Dock in development). Needs macOS (for `iconutil`) |

## Where data is stored

Settings, the encrypted API keys and the workspace (reviews, library, playbook, precedents, approvals, audit log, recorded AI answers) live in the app's data folder:

| Running | Folder (macOS; other platforms use their usual app-data location) |
|---|---|
| Installed app | `~/Library/Application Support/Clause Pilot` |
| From source (`npm run dev`, `npm start`) | `~/Library/Application Support/Clause Pilot (Dev)` |

Set `CLAUSEPILOT_USER_DATA=/some/folder` to use a different folder, for example for a throwaway test run.

**Settings → Data → Clear all data…** deletes the workspace (accounts, contracts, reviews, library, playbook, precedents, approvals, alerts, recorded AI answers and the audit log) and resets the AI settings and API keys, so the app starts again as on first run. Your name and the other settings are kept. It asks for confirmation first.

## CI and releases

- **Prerequisites** (`.github/workflows/prerequisites.yml`) runs on every push to every branch. It installs dependencies, typechecks, builds, and checks that the documented AI schemas match the code.
- **Release** (`.github/workflows/release.yml`) runs when a version tag is pushed (`git tag v0.2.0 && git push --tags`) or manually from the Actions tab. It builds a macOS `.dmg` (Apple silicon and Intel), a Windows installer and a Linux AppImage, and attaches them to a draft GitHub release.

Builds are not code-signed yet. On macOS, right-click the app and choose Open the first time; on Windows, choose "More info → Run anyway".

## Demos

The app starts with an empty workspace, as a real team would. [`demo/`](demo/README.md) has three demos to follow step by step, with real AI. Each folder has the library and playbook to import, the contract files to open from the filesystem, and a guide:

- **[1. Our NDA, redlined by the client](demo/1-our-nda-two-rounds/README.md) (two rounds):** our mutual NDA as a client redlined it (tracked changes, comments, and changes made without Track Changes), then the client's next draft, which is compared with what you actually sent back.
- **[2. A contract on the client's own paper](demo/2-client-paper/README.md) (one round):** a confidentiality agreement with a different structure. Nothing matches our wording, so the intent check compares each paragraph with the closest of our clauses, and the playbook check reviews the whole contract against our positions.
- **[3. A supplier's agreement, as it looks in Word](demo/3-supplier-msa/README.md) (one round):** a Master Services Agreement with a logo, address blocks, Word numbering, a table with merged cells, header and footer, reviewed in the Word layout.

## Library and playbook: import and export

**Import…** and **Export…** on the Library and Playbook pages move the knowledge base between machines or teams as JSON (`{"format": "clause-pilot/library", "version": 1, "clauses": [...]}`, and `clause-pilot/playbook` with `positions`). Imports are validated (Zod, `src/main/transfer.ts`) and merged by id: new entries are added, changed ones updated (a playbook position gets a new version), identical ones left alone, and nothing is removed. Every import and export is in the audit log.

## How a review works

The contract is shown **as it looks in Word**: pages, headers and footers, tables, numbering, fonts and images, laid out by [SuperDoc](https://www.superdoc.dev) entirely on this computer (its telemetry is switched off; nothing is fetched). What's shown is the review as it stands: their file with our decisions, edits and comments in it, as the marked-up copy has them, laid out again after each change. Changes they made without Track Changes (found by comparison) are written into the page as their tracked changes, in the name on their redlines, so the paragraph itself shows what they changed silently (in the marked-up copy they stay as they were, since they're already in their file). Each Word paragraph carries an id naming the review paragraph it is, so our bars, gutter labels and AI markers sit beside it, clicking a change selects it for **Accept** / **Reject**, clicking commented text opens its comments, and selecting text offers the AI questions. A paragraph with comments still open has a comment marker in the right margin all the time (the comment icon and how many, lined up with the AI markers and under them); one without gets the marker when text in it is selected. Either shows the paragraph's comments in the review column, where one can be added on the selected text. Typing into the page is suggesting: what you type shows as your tracked change, and after a pause the paragraph's new wording is saved to the review as your edit (one History action per paragraph you type in), placed from the end of the paragraph so a renumbered clause number can't become an edit. Enter splits the paragraph: the rest becomes a new paragraph of ours, numbered like its neighbours (Tab / Shift-Tab change its level); merging one of ours back with Backspace removes it. PDFs and text files are shown the same way, as the plain Word file the marked-up copy is built from. From a PDF the app keeps what it can read from where the text sits on the page: centred lines, bold lines, lines broken on purpose (addresses, labels with their values), headings set in the margin beside their paragraph, superscripts ("1st"), the main typeface, and ligatures drawn without letters (recovered, see `src/main/ingest/ligatures.ts`). Underlines, tables and images in a PDF are drawings, not text, and aren't kept. A document SuperDoc can't lay out is shown as text instead, paragraph by paragraph, with the same review around it (and a button to try the Word layout again). The contract is never split into clauses. A bar under the document has **History**, **Marked-up copy** and **Draft response**. The review column is a card beside it, full height; its foot has **Accept** / **Reject** for the changes of theirs in the selection (only while it has some to decide) and **Show key**, which fills the column with the key: how the draft stands and what it was compared with, each bar and label beside the paragraphs (with how many paragraphs are in each state), and what the marks in the page mean (tracked changes, comment highlights, the AI markers).

```
file ─▶ paragraphs (Word XML: numbering, key-terms rows, tracked changes, comments; PDF / text: lines)
     ─▶ local prompt-injection screen
     ─▶ their changes: tracked in Word, or found by comparing with a baseline
            later draft of a contract  ─▶ what we sent back last time (their text with our edits)
            first draft, ours, with the original we sent  ─▶ that original (kept as the contract's original)
            first draft, ours, no original  ─▶ our approved wording (the library)
            first draft, theirs  ─▶ nothing (word-for-word matches with the library are noted)
     ─▶ grouped into change sets (every edit in a paragraph, and consecutive paragraphs of one clause)
     ─▶ you: accept · restore original · edit in place · comment · flag for review
            (Seen before: the same or a similar change in earlier negotiations, and how we answered it)
            (questions on highlighted text: intent, playbook, their changes, explain, and your own)
     ─▶ marked-up .docx (our tracked changes and comments) + cover email + audit log + negotiation history
```

- **Change sets.** All their edits in one paragraph, and consecutive changed paragraphs in the same numbered section (2.1 and its (a), (b)), are one thing to decide, however many edits it has. A changed heading takes its sub-clauses with it (an inserted "5. NON-SOLICITATION" and its 5.1 are one change). Key-terms rows and unnumbered paragraphs found by comparison stand alone.
- **Untracked changes.** A later draft is lined up with what we sent (paragraph alignment, then a word diff), so anything they changed, added or removed without Track Changes shows as a change, with a dashed bar; the review column says it was made without Track Changes, next to what we proposed last round. A first draft asks **Where did this draft start?** (suggesting an answer from how much of it is our approved wording word for word, since common clauses can match on anyone's paper): **ours, with the original we sent** (uploaded with it, kept on the contract page as the **Original**, and compared exactly, as a later draft is), **ours, without the original** (compared with the library instead: a paragraph close to one of our clauses shows how it differs, and the review column says *Differs from our approved …*, which may not be their change if we sent other wording), or **theirs** (nothing is assumed to be ours). The response email asks them to track changes next time.
- **Their paper.** A contract that isn't our wording has nothing to compare with, so every paragraph shows as **to read** (grey bar). On upload each paragraph gets a shortlist of the closest of our approved clauses (keyword search, locally). The AI card **Does the intent match?** asks whether it means the same as one of them (dashed green if so), and **Does it meet our playbook?** checks the highlighted text (select everything to check the whole contract) against each position that applies. A person clears each paragraph with **Mark as checked** (in the history, so it can be undone).
- **The left gutter.** Each paragraph's bar shows where it stands (click it to select the paragraph, or drag from it up or down to select several, as if the text were selected); consecutive paragraphs with the same bar are drawn as one. Each run of paragraphs in the same state is labelled once, in the bar's colour, and the label stays in view while the run scrolls past: **Unchanged** (reads **exactly** as our approved wording, or exactly as we sent it last round), **Checked** (its changes decided, or marked as checked by a reviewer: a judgement, not a match), **Same intent** (the AI found it means the same as our wording), **To decide**, **Edited** (yours) and **To read**. Hovering a label explains it. Text with AI answers has a marker in the right margin, level with the paragraph it starts in, saying how many questions were asked of it ("2 Asks"; one marker per highlight, so two highlights in one paragraph get one each); hovering it tints the text in one colour, redlines and comment highlights in it set aside (the words are found in the paragraph as it reads now, as they proposed it, or as it first read, since a question may have been asked of any of them; a marker for wording the paragraph no longer has at all says *earlier* (dashed) and tints the paragraph as a whole), and clicking it selects the text again, so the review column shows its answers.
- **Editing in place.** Type into the page: your wording is shown and exported as tracked changes in your name, layered over theirs. Restore original writes the reversal of their change as your redline. Any paragraph can be edited, not just their changes.
- **Comments** are anchored to text, as in Word: their comments highlight the words they're on (from the comment's range in their file), and yours highlight the text you selected. Click highlighted text to see its comments. Your comments and replies in the review can be reworded with **Edit** (shown as edited, and in History); theirs, and yours from earlier rounds that come back in their file, stay as they are. **Delete** removes one of yours. **Resolve** keeps a thread but marks it done, as in Word: it's greyed out, its text is no longer highlighted, it's left out of the email, and it goes into the marked-up copy marked done; **Reopen** undoes it. Comments they resolved in Word arrive resolved. In the marked-up copy your comments become Word comments on the same words (threaded replies to theirs), and the reasons in the email.
- **Seen before.** Every change you accept or answer is saved: what they proposed, what was there, how we answered and why. A later change with the same wording (or the same words added elsewhere) is shown as **same change**, with **Answer the same way**; similar ones are found by keyword search (BM25).
- **AI on request, on what you highlight.** Nothing goes to a model unless you ask. The **AI** section of the review column says *Select text for options*; once text is highlighted it offers every question that fits it: the prioritised ones as cards, then **More questions**, a menu of the rest (a question picked there is asked, and its card joins the others for that text). The questions are set on the **Questions** page (under Knowledge); the app starts with four, all prioritised:
  - **Does the intent match?** (when it differs from, or is close to, our approved wording): the structured intent check, per paragraph, checked in code before anything shows as the same.
  - **Does it meet our playbook?** Each standard position that applies, against the highlighted text.
  - **What do their changes do?** (when it has open changes of theirs): one request per change, with the whole contract (cached), our playbook and earlier negotiations: what it does, who it favours, what to do, suggested wording and a comment.
  - **What does this mean?** In plain English: what it means for us.

  On the **Questions** page every question can be edited, prioritised (a card) or not (in the menu), reordered or removed, and new ones added (not prioritised until you say so). A question has a title and a second line (the card), a prompt (the instructions, sent after the material), what is sent with it (always the highlighted text; optionally the whole contract, the highlighted paragraphs in full, their changes in the highlight, our edits, our closest approved clauses, our playbook, precedents, and what other questions found), and how it is asked:
  - **Once, about the highlight:** one request, answered in writing (streamed) or as cards. By default the cards are a summary, then a verdict per point with the paragraphs it is about, suggested wording to apply and a comment to them; a question can give its own **response schema** (JSON Schema) instead. The app builds the answer from the fields it recognises: a top-level `summary`; each object or list of objects becomes cards from `title`, `verdict`, `tone` (good, warn, bad, neutral), `clause_ids` (the link to the paragraphs, and where actions go), `explanation`, `suggested_wording` (**Apply to §x**) and `comment_to_them` (**Add comment**); any other field shows as a labelled line, labelled by the property's `title`. Before it is sent, every object is closed and its fields required unless the schema says which, constraints the providers can't enforce (lengths, ranges) are left out, and `injection_suspected` / `injection_notes` are added, so text addressed to an AI reviewer still goes to Security. The answer is checked against the schema before any card is built.
  - **For each paragraph, against our approved wording:** the intent check; a paragraph found to mean the same is marked dashed green.
  - **For each playbook position:** one request per position that applies.
  - **For each of their changes:** one request per change, with the whole contract; the answer is kept on the change too.

  The last three keep the answer's shape fixed (the review's cards and marks are built from it); the prompt and the extra material are the question's. The untrusted-text warning is always added. Changes take effect at once and are in the audit log with the question before and after; a question the app started with can be **Reset to default**. Questions can be exported and imported as JSON (`clause-pilot/questions`), like the library and playbook, so a team can share them or add them to a demo.

  Using a card asks the AI and the answer comes back on the card (asking again, once it has an answer for that text, first asks you to confirm, in a dialog in the middle of the window: it costs another request and the new answer replaces the old one on the card, though the old one stays in the review's record), in the **Review** tab; the cards run independently, so you can start several at once (each shows a spinner until its answer arrives; a written answer streams in as it is written). The answer is a line of text and a card per finding (a paragraph, playbook position or change): its verdict, a link that points at the paragraphs in the document, the explanation, and what to do about it. Suggested wording is shown as a redline against the paragraph as it stands, with **Apply to §x** to make it our tracked edit; a suggested comment to them has **Add comment**. The server's response as returned is kept with the review; with **Debug mode** on (Settings → Debugging), each card has **Raw response**, which opens it in a dialog in the middle of the window (with **Copy**). Each answer in the Agent has the same button, showing the provider and model, how much was sent, token use, the text, and the error if it failed. The **Agent** (the second tab of the review column) is one conversation per contract, across its versions, saved with the workspace (so it survives restarts; **Clear conversation** starts again); only your messages are in bubbles. The question cards are not in it: each is a one-off request, sent what its question says, never the conversation. What they found reaches the conversation as part of the review state (below), so you can ask the Agent about it. Every request is built most-stable-first, so the providers' prompt caches can reuse it: the instructions and the contract (the system prompt, the same all review), then the typed conversation (it only grows), then the review as it stands (their changes and our decisions, our edits, the latest finding of each question) with the question. On Claude both the system prompt and the end of the conversation are cache breakpoints; a vLLM server with prefix caching reuses the same prefix; token and cache use is in the audit log (`chat.usage`). Once the conversation passes a budget (about 6,000 tokens for vLLM, 40,000 for Claude) the older messages are summarised by the same model and the summary is sent in their place, followed by the last two exchanges word for word; the whole conversation stays on screen, with a marker where the summary ends.

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
- **Recording.** With recording on, every AI answer is saved, keyed by a hash of its task and input. That gives a fixed baseline for evaluating prompt or model changes, for example Claude against a vLLM model.
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
  ai/                    task schemas (Zod), prompts, Claude and vLLM providers, recorder
  redline/docx.ts        our response as a marked-up .docx (tracked changes and comments)
  email.ts, chat.ts      cover email; the chat panel's context
  transfer.ts            library and playbook import / export (file format, validation, merge)
  store.ts, audit.ts     JSON store; hash-chained audit log
  index.ts               Electron main + IPC
src/shared/
  changes.ts             change sets and their status
  diff.ts                word diff, and our edit layered over their redline
src/renderer/            React UI (views/DocReview.tsx is the review screen)
scripts/                 demo/ (generates the demo files), docs check; dev/ has small CLI checks
```

`npx tsx --tsconfig tsconfig.node.json scripts/dev/sets.ts <files…>` prints the change sets the app finds in contracts.

## Limitations

- Typing into the page is saved paragraph by paragraph after a pause; formatting you apply in the page (bold, styles) isn't kept, only wording. Each decision lays the page out again (about half a second). SuperDoc 2.24 can't lay out a header with an image on the same line as tabbed text; such a document is shown as text. Comments are anchored to text by finding the words: if the commented words have since been changed, the highlight (in the app) falls away and the exported comment covers the whole paragraph.
- Grouping uses numbering (typed, or Word's automatic numbering). Unnumbered continuation paragraphs join the change above them. Scanned PDFs would need OCR. Legacy `.doc` files are rejected with a "save as .docx" message.
- Paragraph alignment between drafts uses a similarity threshold (0.45) tuned on the sample contracts only.
- Single user, local data. A team deployment needs a shared store and identity for the audit log.

## License

Clause Pilot is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). Its source is public on GitHub. The document view is built on [SuperDoc](https://www.superdoc.dev), which is also AGPL-3.0.
