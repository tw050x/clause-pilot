# Demo 1: our NDA, redlined by the client (two rounds)

PortSwigger sent its standard mutual NDA to **Brightwater Robotics**. Their lawyers redlined it in Word and sent it back. You review their changes and send a response. They reply with a new draft, and you review that too.

This demo shows the app on our own paper. Most of the document is our approved wording and needs no reading, so only the client's changes need a decision. That includes the changes they made without Track Changes.

## In this folder

| File | What it is | When you use it |
|---|---|---|
| `library.json` | PortSwigger's approved clauses (38) | Setup |
| `playbook.json` | PortSwigger's standard positions (11) | Setup |
| `Brightwater-Mutual-NDA-v1-client-redline.docx` | Their redline of our NDA | Round 1 |
| `Brightwater-Mutual-NDA-v2-client-response.docx` | Their next draft, replying to what we sent | Round 2 |

## Setup (about 2 minutes)

1. Open **Settings**. Under **AI**, choose **Claude** and paste an Anthropic API key, or choose **vLLM**, enter your server's address, press **Connect** and pick a model. The AI steps need this; everything else works without it.
2. Open **Library** and press **Import…**. Choose `library.json`. The page should say *Imported: 38 clauses added.*
3. Open **Playbook** and press **Import…**. Choose `playbook.json`. The page should say *Imported: 11 positions added.*

   If you've already imported them for the other demo, the page says they're already up to date. That's fine.

4. Press the account switcher at the top of the left sidebar (it shows the current account, or **Choose an account**; or press ⌘K). Press **+ New account**, type **Brightwater Robotics** and press Enter.
5. In the sidebar, press **+ New contract**. Name it **Mutual NDA** and press **Create contract**.

## Round 1: their redline

6. On the contract page, press **Upload first draft** and choose `Brightwater-Mutual-NDA-v1-client-redline.docx`.

   The document opens like Word with Track Changes. The bar beside each paragraph shows its state:
   - **Green:** our approved wording, word for word. Nothing to check.
   - **Blue:** their change, to decide.
   - **Red:** your edits.

7. Look at the right-hand column. It should say that most paragraphs match our approved wording. These paragraphs have changes:

   | Where | What they did | What you see |
   |---|---|---|
   | Parties paragraph | Their company details | Not in our template |
   | 1.3 | Reworded our exclusions, with the same meaning | Tracked change and a comment |
   | 2.1 | Added "Affiliates" to who may see the information | Tracked change and a comment |
   | 2.2 | Reworded our standard of care **without Track Changes**, with the same meaning | Marked *not our standard* |
   | 2.4 | Inserted a residuals clause | Tracked insertion and a comment |
   | 3.3 | Deleted our "No warranty" clause | Tracked deletion |
   | 4.1 | Changed the survival period from three years to five | Tracked change and a comment |
   | 5.4 | Removed "such consent not to be unreasonably withheld" **without Track Changes** | Marked *not our standard* |
   | 5.8, 5.9 | Changed the governing law and the courts to New York | Tracked changes and a comment |
   | 5.10 | Inserted a non-solicitation clause | Tracked insertion |
   | Signature paragraph | Their signatory | Not in our template |

8. Press **Intent check with AI**. The AI compares each changed paragraph with the approved clause it started from. 1.3 and 2.2 should turn **dashed green**, meaning the AI thinks they still mean the same. It only advises: they stay unaccepted until you decide.
9. Decide each change. Select some text (a word, a paragraph or several paragraphs), and the right-hand column lists the changes in the selection with one **Accept** and one **Reject** for all of them. Clicking inside a change selects the whole change. To match the client's round-2 reply, decide as follows:
   - **Accept** the parties paragraph, 1.3, 2.1, 2.2 and the signature paragraph.
   - **Reject** 2.4, 3.3, 5.4, 5.8, 5.9 and 5.10.
   - **Reject** 4.1. Then click into 4.1, select **three (3)** and type **four (4)**. Your wording appears in red.
10. Add comments. Select text, press the comment button that appears in the margin, and type in the right-hand column:
    - On 2.4: *We cannot accept a residuals clause.*
    - On 4.1: *We can meet you at four years.*
    - On 5.8: *English law is our standard for NDAs.*
    Their comments are highlighted in yellow on the words they're about, and yours get an amber underline. Click highlighted text to see its comments. Once you've dealt with one of their comments, press ✓ on it to **resolve** it: it stays, greyed out, and its text is no longer highlighted.
11. Optional: press **History** to see each action, with a preview. You can undo any of them and redo it again.
12. Press **Marked-up copy**. The preview shows their Word file with your decisions applied, your edits as tracked changes in your name, and your comments. Press **Save .docx…** to keep it.
13. Press **Draft response**. The email lists what you rejected and why (your comments), your four-year proposal ("four (4)" in place of "three (3)"), the restored assignment wording, and the changes you accepted.

## Round 2: their next draft

14. Go back to the contract (**Mutual NDA** in the sidebar). Press **Upload new draft** and choose `Brightwater-Mutual-NDA-v2-client-response.docx`.

    This draft is compared with **what you actually sent in round 1**. Anything they left as you sent it is green; only what changed needs a decision.

15. The right-hand column should say *5 paragraphs with changes to decide* and *1 of them without Track Changes*:

    | Where | What they did | What you see |
    |---|---|---|
    | 4.1 | Took our "four (4)" | Green |
    | 5.8 | Accepted English law | Green, with their comment "English law is fine." |
    | 2.3 | Removed "and reasonable assistance to seek a protective order" | Tracked change and a comment |
    | 2.4 | Put back a narrower residuals clause | Tracked insertion and a comment |
    | 5.4 | Quietly put their strict assignment wording back | **Not tracked**, with what we proposed last round |
    | 5.9 | Made the English courts' jurisdiction non-exclusive | Tracked change and a comment |
    | 5.10 | Added an anti-bribery clause | Tracked insertion and a comment |

16. Click into 5.4. The right-hand column shows the change and, under **Last round we proposed**, the wording we sent. Reject it again.
17. Decide the rest as you see fit. Edit, comment, and use the intent check on anything you select.
18. Create the response: **Marked-up copy** and **Draft response**. Because of 5.4, the email also asks them to track every change in their next draft.

If you made different decisions in round 1, the paragraphs you decided differently show in round 2 as changes made without Track Changes. That's the comparison working: the client's draft differs from what you sent.

## Afterwards

- **All reviews** in the sidebar lists both versions. **Close** a review to hide it there; nothing is deleted.
- The **Audit** page has every action, including the imports and each AI request.
