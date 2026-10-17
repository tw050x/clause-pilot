# Demo 2: a contract on the client's own paper (one round)

**Kestrel Health Systems** sent their own mutual confidentiality agreement instead of signing ours. It is laid out differently from ours: Articles, "Section 1.01" numbering, and defined terms such as "Representatives" and "Transaction". It has no tracked changes.

This demo shows the app when nothing matches our wording, so every paragraph needs reading. The AI helps in two ways, but only when you ask:
- **Intent check:** it compares each paragraph with the closest of our approved clauses.
- **Playbook check:** it checks the whole contract against our standard positions.

There is no second round.

## In this folder

| File | What it is | When you use it |
|---|---|---|
| `library.json` | PortSwigger's approved clauses (38) | Setup |
| `playbook.json` | PortSwigger's standard positions (11) | Setup |
| `Kestrel-Confidentiality-Agreement-client-paper.docx` | Their agreement | Review |

## Setup (about 2 minutes)

1. Open **Settings**. Under **AI**, choose **Claude** and paste an Anthropic API key, or choose **vLLM**, enter your server's address, press **Connect** and pick a model. This demo is mostly about the AI steps, so it needs one.
2. Open **Library** and press **Import…**. Choose `library.json`. The page should say *Imported: 38 clauses added*.
3. Open **Playbook** and press **Import…**. Choose `playbook.json`. The page should say *Imported: 11 positions added*.

   If you've already imported them for the other demo, the page says they're already up to date. That's fine.

4. Press the account switcher at the top of the left sidebar (it shows the current account, or **Choose an account**; or press ⌘K). Press **+ New account**, type **Kestrel Health Systems** and press Enter.
5. In the sidebar, press **+ New contract**. Name it **Confidentiality Agreement** and press **Create contract**.

## Review

6. On the contract page, press **Upload first draft** and choose `Kestrel-Confidentiality-Agreement-client-paper.docx`.

   Nothing here is our wording, so almost every paragraph has a **grey bar** ("To read"). The right-hand column says *Not on our paper* and counts the paragraphs to read. When the file was opened, the app found the closest of our approved clauses for each paragraph, up to three, by keywords and on your machine. Nothing was sent anywhere.

7. Select the whole agreement (click in it and press ⌘A). The **AI** section of the right-hand column, which says *Select text for options* until you select something, now offers cards. Press **Is the intent the same?**. Each paragraph goes to the AI with its shortlist of our clauses; the question appears in **Ask AI** and the answer comes back there and on the card (go back to the **Review** tab to see it). Paragraphs it finds equivalent to one of ours turn **dashed green**.

   Expect these to pass:

   | Their section | Our clause |
   |---|---|
   | 1.01 | Definition of Confidential Information |
   | 2.01 | Confidentiality obligations |
   | 2.02 | Exclusions from Confidential Information |
   | 2.03 | Standard of care |
   | 2.04 | Compelled disclosure |
   | 3.02 | Return or destruction |
   | 4.01 | Ownership and no licence |
   | 4.02 | No warranty |
   | 4.03 | Equitable remedies |
   | 4.05 | No obligation to transact |
   | 4.08 | Entire agreement |
   | 4.09 | Counterparts and e-signature |

   Expect these to stay grey, because they differ from anything of ours:

   | Their section | Why |
   |---|---|
   | 2.05 | A residuals clause |
   | 3.01 | Obligations survive five years |
   | 4.04 | Non-solicitation |
   | 4.06 | Delaware law and courts |
   | 4.07 | Only Kestrel may assign in a merger |

8. Select the text of one paragraph, for example Section 2.03, and press **Is the intent the same?** again: the card shows which of our clauses it matched, how confident the AI is, its reasoning, and any differences and who they favour. **Raw response** shows exactly what the server returned.
9. Select the whole agreement again and press **Check against our playbook**. The selected text is checked against each position that applies to an NDA, one request per position. The answer lists the positions worst first, with the sections each is about.

   Expect deviations on:
   - **Residuals:** Section 2.05.
   - **Duration of confidentiality obligations:** Section 3.01, five years where our standard is three.
   - **Non-solicitation of staff:** Section 4.04.
   - **Governing law and jurisdiction:** Section 4.06, Delaware.

   Try **Explain in plain English** on a paragraph too, and ask your own questions in **Ask AI**.

10. Now read the agreement. The AI only advises; a person clears each paragraph:
    - **If a paragraph is fine as it is** (for example the dashed-green ones, once you've read them), click into it and press **Mark as checked** in the right-hand column. The bar turns solid green.
    - **If it needs to change**, type your wording into the document (it shows in red as your tracked change) and add a comment saying why. Select text and press the comment button in the margin. For example:
      - Section 3.01: change **five (5) years** to **three (3) years**.
      - Section 4.06: change **the State of Delaware** to **England and Wales**, and the courts to **the courts of England and Wales**.
      - Section 2.05: strike the whole paragraph (select it and delete) and comment *We cannot accept a residuals clause.*
      - Section 4.07: make the merger exception apply to either party.
11. Press **History** to see everything you did, including each paragraph you marked as checked. Any of it can be undone.
12. After editing, select the agreement and press **Check against our playbook** (now *Ask again*). It checks the contract as it now reads, with your edits.
13. Create the response:
    - **Marked-up copy** is their Word file with your edits as tracked changes and your comments. Press **Save .docx…** to keep it.
    - **Draft response** is the cover email listing each change you propose and why.
