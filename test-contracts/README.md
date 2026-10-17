# Test contracts (real-world documents)

Real, published contracts for trying Clause Pilot outside the demo. They are not PortSwigger documents and aren't written for our industry. They're here because they are real: Word auto-numbering, cover-page tables, fill-in blanks, drafting notes and long agreements, not documents written to suit the app.

Upload them under a test account. Reviewing needs nothing else; the AI steps need the AI set up in Settings (Claude or your vLLM server).

## `originals/`: unchanged, as published

| File | What it is | Good for testing |
| --- | --- | --- |
| `CommonPaper-Mutual-NDA-1.0.docx` | Common Paper Mutual NDA v1.0: cover page and standard terms | Cover-page key terms (a table) as separate rows; Word auto-numbering; blanks such as "[fill in state]" |
| `CommonPaper-Mutual-NDA-1.0.pdf` | The same NDA as a PDF | The PDF path; compare it with the .docx |
| `CommonPaper-Cloud-Service-Agreement-2.1.docx` | Common Paper Cloud Service Agreement v2.1: order form and standard terms (about 230 paragraphs) | A long SaaS agreement close to how PortSwigger sells; liability caps, payment, SLA |
| `CommonPaper-Software-License-Agreement-1.1.docx` | Common Paper Software License Agreement v1.1 | Licensed software terms |
| `CommonPaper-Data-Processing-Agreement-1.1.docx` | Common Paper DPA v1.1, with annexes | Annex tables, privacy terms, checkbox-style options |

## `redlined/`: counterparty drafts of those documents

Built by `npm run test-contracts` (`scripts/build-test-contracts.ts`) from the originals with the app's own redline engine, as Word **tracked changes** and **comments** by a fictional counterparty, on the real document with its formatting intact.

**`Northwind-Mutual-NDA-redlined.docx`** (author "Northwind Legal"). Their edits are mostly Common Paper's own published "common changes" for this NDA:
- Cover page filled in: purpose, effective date, Delaware law and courts (with a comment).
- §2: disclosure to affiliates added (with a comment).
- §3: a residuals clause added, worded exactly as Common Paper publishes it (with a comment).
- §4: the notice-and-cooperation duty for compelled disclosure **silently deleted** (no comment). This is the edit a hurried reader misses.
- §11: assignment to affiliates without consent (with a comment).

**`Contoso-Cloud-Service-Agreement-redlined.docx`** (author "Contoso Procurement"). A customer pushing back on the provider's terms:
- Governing law: New York (with a comment).
- §4.1: fees made **inclusive** of taxes, a one-word change with no comment.
- §5.3(b): termination for convenience with a refund (with a comment).
- §6.3: a broader performance and no-malware warranty, silently.
- §12.6: the right to assign on a change of control removed (with a comment).

Things to check with these:
1. Every tracked change and comment shows on the right paragraph, including cover-page rows, and each edit is one change to decide.
2. Silent edits (§4 in the NDA, §4.1 and §6.3 in the CSA) are flagged as their changes, even with no comment.
3. The marked-up copy (our response) is written onto their redline: their changes stay attributed to them, and ours are added in the reviewer's name.
4. A second draft: answer some changes, save the marked-up copy, open it in Word, accept some of our changes, quietly edit a paragraph with Track Changes off, save, and upload it as version 2 of the same contract. The quiet edit should show as "not tracked".

## Attribution and licence

The documents in `originals/`, and the text of the drafts in `redlined/`, are from **[Common Paper](https://commonpaper.com/standards/)** and are licensed under **[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)**:

- Common Paper Mutual Non-Disclosure Agreement, Version 1.0: <https://commonpaper.com/standards/mutual-nda/1.0>
- Common Paper Cloud Service Agreement, Version 2.1: <https://commonpaper.com/standards/cloud-service-agreement/>
- Common Paper Software License Agreement, Version 1.1: <https://commonpaper.com/standards/software-license-agreement/>
- Common Paper Data Processing Agreement, Version 1.1: <https://commonpaper.com/standards/data-processing-agreement/>

**Changes made:** the originals are unchanged (downloaded October 2026). The redlined drafts add tracked changes and comments by fictional parties (Northwind, Contoso). The NDA residuals, affiliate and assignment wording comes from Common Paper's published alternatives ([residuals](https://commonpaper.com/standards/mutual-nda/mutual-right-to-use-residual-information/), [affiliates](https://commonpaper.com/standards/mutual-nda/share-confidential-information-with-affiliates/), [assignment](https://commonpaper.com/standards/mutual-nda/permit-assignment-to-any-affiliate)); the other edits are ours. Common Paper does not endorse this project or these drafts.
