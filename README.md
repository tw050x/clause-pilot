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

## CI and releases

- **Prerequisites** (`.github/workflows/prerequisites.yml`) runs on every push to every branch. It installs dependencies, typechecks, builds, and runs `demo:build`, which runs the real pipeline over the demo contracts and fails if demo mode would be missing an AI answer.
- **Release** (`.github/workflows/release.yml`) runs when a version tag is pushed (`git tag v0.2.0 && git push --tags`) or manually from the Actions tab. It builds a macOS `.dmg` (Apple silicon and Intel), a Windows installer and a Linux AppImage, and attaches them to a draft GitHub release.

Builds are not code-signed yet. On macOS, right-click the app and choose Open the first time; on Windows, choose "More info → Run anyway".

## The demo contracts

| Contract | Format | What it shows |
|---|---|---|
| Initech, mutual NDA | .txt | The fast lane. Every clause is either word-for-word ours or an AI-verified paraphrase. Only the party details and signature block need a human. |
| Acme, mutual NDA (redlined) | .docx | Counterparty edits. Residuals, a longer term, a one-way non-solicit and New York law, each shown with what we agreed in past negotiations. |
| Globex, order form | .pdf | The trap. The liability clauses match our standard exactly, but a special condition at the back makes liability unlimited, and another clause tries to instruct the AI. |

## How a review works

```
file ─▶ parse (pdf.js / mammoth) ─▶ split into clauses ─▶ local prompt-injection screen
                                                         │
     ┌───────────────────────────────────────────────────┼──────────────────────────────┐
     ▼                                                   ▼                              ▼
(a) Library match, per clause                  (c) Overrides, whole doc       (d) Standard positions
    exact (normalised hash) ─▶ cleared             one AI call: which clause      one AI call PER position
    lexical candidates ─▶ AI: same intent?         neutralises which?             (contract held in a
       └▶ deterministic gate ─▶ cleared / review                                   cached prompt prefix)
    nothing close ─▶ review
          │
          ▼
(b) Precedent search (BM25) for every clause still needing review
     │
     ▼
Human: accept / reject (+ note, redline, nominate) ─▶ negotiation history, library nominations,
                                                      response email, hash-chained audit log
```

**A clause is accepted automatically** only if it is word for word our approved wording, *and* no override, playbook deviation or injection flag touches it, *and* the whole-document checks have finished. An AI "same meaning" verdict always goes to a person to confirm.

### Design decisions

- **Deterministic steps run first, AI only on the residue.** Exact matching and lexical similarity are free and instant. The AI is asked only about clauses that are close to approved wording but not identical.
- **One question per AI call.** Overrides and each playbook position are separate calls. A prompt asked to check ten things tends to miss some. Single-purpose calls are also easier to evaluate one at a time.
- **The AI never approves anything.** Intent verdicts pass through a code gate: an intent match is rejected if the model's confidence is low, if any difference favours the counterparty, if the model can't name which approved clause it matched, or if it suspects injection. Output is schema-constrained, and clause ids returned by the model are checked to exist.
- **Contracts are untrusted input.** Counterparty text is wrapped in tags and the model is told it is data. A local regex screen flags text addressed to an AI *before* any model call, so a successful injection can't suppress its own warning. Flagged clauses always go to a human.
- **Matched is not the same as safe.** A word-for-word standard liability cap is worthless if a special condition says "notwithstanding clause 7.1". Override detection (c) exists because exact matching (a) can't see this.
- **The knowledge base learns, with a human gate.** Every decision becomes negotiation history for precedent search. Accepted clauses can be *nominated*; promoting a nomination to the pre-approved library is a separate, audited decision.
- **Record/replay.** Every live AI response is saved, keyed by a hash of its task and semantic input. That one mechanism gives demo mode, offline replay of past reviews, and a fixed baseline for evaluating prompt or model changes.
- **Auditability.** An append-only JSONL log in which each entry includes the hash of the previous one. The app verifies the chain and exports a per-review record (decisions table plus full trail) as Markdown.
- **Local-first.** Data is plain JSON in the app's user-data folder, so it is readable and diffable and could live in git. The API key is encrypted with the OS keychain (Electron `safeStorage`) and never reaches the renderer. The renderer is sandboxed and context-isolated, with a strict CSP.

## Code map

```
src/main/
  ingest/parse.ts      PDF, DOCX and TXT to lines
  ingest/clauses.ts    lines to numbered clauses with headings
  engine/text.ts       normalisation, similarity (phrases, word order, vocabulary, length), word diff
  engine/matcher.ts    library index (exact + candidates), precedent index (BM25 via MiniSearch)
  engine/injection.ts  local prompt-injection screen
  ai/tasks.ts          task inputs and output schemas (Zod)
  ai/prompts.ts        prompts
  ai/provider.ts       Claude provider, replay provider, recorder
  pipeline.ts          orchestration: steps (a) to (d), gates, live progress events
  store.ts, audit.ts   JSON store; hash-chained audit log
  index.ts             Electron main + IPC
src/renderer/          React UI (review grid with pinned clauses and connectors, drawers, views)
src/shared/            types and the status logic shared by UI and main
scripts/               seed library/playbook/history, demo contracts, demo builder
demo/authored/         hand-written demo AI answers, compiled into demo/recordings by demo:build
```

## Limitations

- Clause splitting relies on typed numbering ("4.2"). Word auto-numbering is not extracted by mammoth, and scanned PDFs would need OCR. Legacy `.doc` files are rejected with a "save as .docx" message.
- Lexical thresholds (`CANDIDATE_THRESHOLD = 0.45`) were tuned on the demo set only. They need measuring against real contracts.
- Demo recordings are authored, not captured from a live model. Run live with recording on to capture real ones.
- Single user, local data. A team deployment needs a shared store and identity for the audit log.
