# Demo 3: a supplier's agreement, as it looks in Word (one round)

**Harbourline Hosting** sent their own Master Services Agreement, laid out as a real one is:
- a logo in the header, and a footer with a version stamp and page numbers;
- address blocks for both parties;
- Word's own multilevel numbering (1., 1.1, (a));
- a pricing table with merged cells.

After a call, their lawyers made four tracked changes, one of them inside the table, and left a comment.

This demo shows a contract reviewed as it looks in Word, pages and all, however it's formatted.

## In this folder

| File | What it is | When you use it |
|---|---|---|
| `library.json` | PortSwigger's approved clauses (38) | Setup |
| `playbook.json` | PortSwigger's standard positions (11) | Setup |
| `Harbourline-Master-Services-Agreement.docx` | Their agreement, with their tracked changes | Review |

## Setup (about 2 minutes)

1. Open **Library** and press **Import…**. Choose `library.json`. Then open **Playbook**, press **Import…** and choose `playbook.json`.

   If you've already imported them for another demo, the pages say they're already up to date. That's fine.

2. Press the account switcher at the top of the left sidebar (or press ⌘K). Press **+ New account**, type **Harbourline Hosting** and press Enter.
3. In the sidebar, press **+ New contract**. Name it **Master Services Agreement** and press **Create contract**.

The AI is optional here. Set it up in **Settings** to try the questions in step 9.

## Review

4. On the contract page, press **Upload first draft** and choose `Harbourline-Master-Services-Agreement.docx`. The app asks **Where did this draft start?** and suggests **Theirs**, since little of it is our wording. Keep it and press **Open review**.

5. The contract opens as Word shows it:
   - **Header:** their logo and title.
   - **Address blocks:** line by line.
   - **Numbering:** clauses numbered by Word, with hanging indents, and (a)/(b) items under 2.2.
   - **The pricing table:** with its merged cells.
   - **Footer:** "Page 1 of 1".

   Their tracked changes are shown as in Word. The bars and labels in the left margin say where each paragraph stands: **To decide** for their changes, **To read** for their wording.

6. Click **99.5%** in 2.1. The change is selected: **Accept** and **Reject** appear at the foot of the right-hand column. Press **Reject**. The page is laid out again with 99.9% back, and 2.1's label changes.

7. Click **sixty (60)** in 2.2. The change is selected, and their comment on it shows underneath in the right-hand column: *Our release cycle needs a longer cure period.* Accept or reject the change, or reply to the comment.

8. Click **£1,450** in the table. It's one of their changes like any other: accept it or reject it.

9. Optional, with the AI set up: select 4.1 (the liability cap) and press **Ask** on *Does it meet our playbook?*.

10. Type into the page. Click at the end of 3.1 and type *, within 30 days of the invoice date*. What you type is your tracked change, in your name, and after a moment 3.1 is labelled **Edited**.

11. Press **Marked-up copy**. It's their own file, with your decisions and edits as tracked changes in your name, ready to save and send.
