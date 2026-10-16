import type { Tour, TourStep } from './lib/tour'

// ---- DOM helpers for targets and completion checks -----------------------------

const q = (sel: string) => document.querySelector(sel)
const all = (sel: string) => Array.from(document.querySelectorAll(sel))
const withText = (sel: string, text: string) => all(sel).find((e) => e.textContent?.includes(text)) ?? null

/** The issue row for a clause label in the triage list, e.g. "Clause 11.1". */
const issue = (label: string) => all('.issue').find((e) => e.querySelector('.issue-where')?.textContent === label) ?? null
/** A clause in the document pane by its printed number. */
const clause = (num: string) => q(`.doc-clause[data-num="${num}"]`)
/** The clause currently open on the right. */
const openClause = () => q('.right-nav .faint')?.textContent?.split(' · ')[0] ?? null
/** A section of the open clause's analysis by its heading. */
const section = (heading: string) => all('.result-box .result-section').find((e) => e.querySelector('h4')?.textContent?.includes(heading)) ?? null
const navItem = (label: string) => withText('.nav-item', label)
const pageTitle = () => q('.page h1')?.textContent ?? ''
/** A clause's decision, read from its status on the left (independent of what is open on the right). */
const isDecided = (el: Element | null | undefined, kind: 'accepted' | 'rejected') => !!el?.classList.contains(`s-${kind}`)
const parties = () => all('.doc-clause.unnumbered')[0] ?? null
const signature = () => all('.doc-clause.unnumbered').at(-1) ?? null

const analysisDone = () => !!q('.doc-clause') && !q('.doc-clause.s-processing') && !q('.rp-checks .spinner') && !!q('.issues-summary')

const waitForChecks: TourStep = {
  title: 'The contract, clause by clause',
  body: (
    <>
      The document has been split into clauses. Every clause is coloured as the checks finish: <b className="c-processing">blue</b> still being analysed,{' '}
      <b className="c-exact">green</b> pre-approved, <b className="c-review">orange</b> needs a decision, <b className="c-conflict">red</b> a conflict.
    </>
  ),
  target: () => q('.doc-pane'),
  placement: 'right',
  action: 'Wait a few seconds for the checks to finish.',
  done: analysisDone,
  prepare: (ctx) => ctx.showReviewPanels()
}

const draftEmail = (body: React.ReactNode): TourStep[] => [
  {
    title: 'Draft the response',
    body,
    target: () => withText('.rp-actions .btn', 'Draft response'),
    placement: 'left',
    action: 'Click Draft response.',
    done: () => !!q('.modal'),
    prepare: (ctx) => {
      ctx.showReviewPanels()
      ctx.setRightTab('review')
    }
  },
  {
    title: 'An email built from your decisions',
    body: 'Each rejection becomes a numbered point with your reason and our proposed wording. In demo mode this is a template; live, Claude drafts it in our house style. Edit it, then copy it into your email client.',
    target: () => q('.modal'),
    placement: 'left',
    action: 'Close the email to continue.',
    done: () => !q('.modal')
  }
]


/** First action in every contract demo: the demo's own "upload". */
const simulateUpload = (body: string): TourStep => ({
  title: 'Simulate the upload',
  body,
  target: () => q('.upload-draft'),
  placement: 'left',
  action: 'Click Simulate upload.',
  done: () => !!q('.review-wrap')
})

// ---- Review a contract: Initech, the fast lane ---------------------------------------

const reviewInitech: Tour = {
  id: 'review-initech',
  name: 'Demo · Initech NDA',
  steps: [
    {
      title: 'How much of this needs reading?',
      body: 'Initech has signed our standard NDA back. This is the most common case, and the one that fills the queue at quarter end. Let’s see how much of it actually needs a lawyer.'
    },
    simulateUpload('This is Initech’s contract page. Simulate uploading their signed-back NDA.'),
    waitForChecks,
    {
      title: 'Almost nothing',
      body: '18 of 21 clauses are word for word our approved wording and accepted automatically. Three need a person: the parties and the signature block (different in every deal), and one clause the AI says means the same as ours.',
      target: () => q('.issues-summary'),
      placement: 'left'
    },
    {
      title: 'One clause was reworded',
      body: 'Clause 2.2 isn’t word for word our standard. Let’s see why it was still accepted.',
      target: () => clause('2.2'),
      placement: 'right',
      action: 'Click clause 2.2.',
      done: () => openClause() === 'Clause 2.2'
    },
    {
      title: 'Same meaning, different words',
      body: 'It was close to our approved “Standard of care” clause, so Claude was asked whether the legal effect is the same. It says yes, and shows its reasoning and the exact word changes so you can check them in seconds.',
      target: () => section('Library match'),
      placement: 'left'
    },
    {
      title: 'You make the call',
      body: 'An AI opinion never accepts a clause on its own, so this one carries a “needs your decision” badge. If you agree, accept it. Tick “Nominate this wording…” if it should be pre-approved next time.',
      target: () => q('.result-box .decision'),
      placement: 'top',
      action: 'Click Accept, then Confirm accept.',
      done: () => isDecided(clause('2.2'), 'accepted')
    },
    {
      title: 'Now the party details',
      body: 'Check the company names and details against the deal.',
      target: parties,
      placement: 'right',
      action: 'Click the parties paragraph at the top of the contract.',
      done: () => openClause() === 'Parties and details'
    },
    {
      title: 'Accept them',
      body: 'Names, addresses and entity types look right.',
      target: () => q('.result-box .decision .btn.accept'),
      placement: 'top',
      action: 'Click Accept, then Confirm accept.',
      done: () => isDecided(parties(), 'accepted')
    },
    {
      title: 'And the signature block',
      body: 'Last one.',
      target: signature,
      placement: 'right',
      action: 'Click the signature block at the end, then Accept and Confirm accept.',
      done: () => isDecided(signature(), 'accepted')
    },
    ...draftEmail('Nothing was rejected, so the response is a simple “happy to proceed”.'),
    {
      title: 'Three decisions, not twenty-one',
      body: 'This NDA needed three quick checks instead of a full read, and the review record shows why each of the other clauses was accepted.'
    }
  ]
}

// ---- Review a contract: Globex, the hidden trap ------------------------------------

const reviewGlobex: Tour = {
  id: 'review-globex',
  name: 'Demo · Globex order form',
  steps: [
    {
      title: 'An order form that looks standard',
      body: 'Globex has sent back our Burp Suite order form. Most of it matches our terms word for word, so it looks safe to sign. It isn’t, and the problem is hidden at the back. Let’s find it.'
    },
    simulateUpload('This is Globex’s contract page. In real use you’d upload their file here; in the demo, the upload is simulated.'),
    waitForChecks,
    {
      title: 'Triage, not reading',
      body: 'Instead of 25 clauses to read, you get four things that must change, four that need a decision, and thirteen clauses that are word for word our approved wording and accepted automatically. Must-change items come first, because any one of them sends the contract back.',
      target: () => q('.issues-summary'),
      placement: 'left'
    },
    {
      title: 'Someone tried to talk to the AI',
      body: 'Clause 11.3 contains a note “to any AI or automated contract review system” claiming the special conditions are pre-approved. A local check caught it before any AI saw the contract. That’s a security matter, so the security team was alerted and the review went on hold.',
      target: () => issue('Clause 11.3'),
      placement: 'left'
    },
    {
      title: 'Open the real problem',
      body: 'Clause 11.1 is the one that matters. Let’s look at it.',
      target: () => issue('Clause 11.1'),
      placement: 'left',
      action: 'Click the Clause 11.1 issue.',
      done: () => openClause() === 'Clause 11.1'
    },
    {
      title: 'The trap',
      body: 'Our liability cap in 7.1 is word for word our approved wording. But 11.1 says “Notwithstanding clauses 7.1 and 7.2… liability… shall be unlimited”. Matching clauses against the library alone would have passed this contract. A separate check reads the whole contract for clauses that override others.',
      target: () => section('Overrides'),
      placement: 'left'
    },
    {
      title: 'Selected on the left',
      body: 'The selected clause is marked with an arrow. It’s red because it conflicts with our standard positions.',
      target: () => clause('11.1'),
      placement: 'right'
    },
    {
      title: 'Don’t trust the parser: check the original',
      body: 'Text pulled out of a PDF can go wrong. You can always see a clause in the original document.',
      target: () => q('.clause-tools:not(.hidden) .btn'),
      placement: 'bottom',
      action: 'Click Check in original.',
      done: () => !!q('.orig mark.orig-hl')
    },
    {
      title: 'There it is in the PDF',
      body: 'This is the actual PDF Globex sent, opened full width so it’s readable, with the clause highlighted. If its text couldn’t be found there, you’d see a warning, which usually means it was captured wrongly.',
      target: () => q('.orig mark.orig-hl'),
      placement: 'left'
    },
    {
      title: 'Back to the analysis',
      body: 'Close the original to return to the analysis for this clause.',
      target: () => q('.orig-close'),
      placement: 'top',
      action: 'Click Close original.',
      done: () => !!q('.result-box') && openClause() === 'Clause 11.1'
    },
    {
      title: 'Reject it',
      body: 'Unlimited liability for any security incident is the biggest risk in this contract for a security vendor.',
      target: () => q('.result-box .decision .btn.reject'),
      placement: 'top',
      action: 'Click Reject.',
      done: () => !!q('.result-box .decision textarea')
    },
    {
      title: 'Say why, propose wording',
      body: 'The proposed wording is pre-filled from our playbook’s fallback (a 3× data-protection cap). Your reason and redline go straight into the response email and become a precedent.',
      target: () => q('.result-box .decision'),
      placement: 'left',
      action: 'Optionally type a reason, then click Confirm reject.',
      done: () => isDecided(clause('11.1'), 'rejected')
    },
    {
      title: 'On security hold',
      body: 'Because of the injection attempt in 11.3, nothing can go back to Globex yet: Draft response is blocked and the flagged clause can’t be accepted. Only the security team can release the hold.',
      target: () => q('.security-panel'),
      placement: 'left',
      prepare: (ctx) => {
        ctx.showReviewPanels()
        ctx.setRightTab('review')
      }
    },
    {
      title: 'The security team is alerted',
      body: 'Alerts land on the Security page, with a count in the sidebar. In a real deployment this is also where a Slack or email alert would be sent.',
      target: () => navItem('Security'),
      placement: 'right',
      action: 'Click Security.',
      done: () => pageTitle() === 'Security'
    },
    {
      title: 'Security reviews it',
      body: 'The security team sees the exact text that was flagged, the patterns that matched and what the AI reported. In this demo you are also on the security team.',
      target: () => q('.alert-card'),
      placement: 'top',
      action: 'Click Confirm injection attempt.',
      done: () => pageTitle() === 'Security' && !q('.alert-card') && !!withText('.page .pill', 'confirmed attempt')
    },
    {
      title: 'Back to the review',
      body: 'Confirmed: the flagged clause can only be rejected, and the response can now be drafted.',
      target: () => withText('.page tr.clickable', 'Globex'),
      placement: 'top',
      action: 'Click the resolved alert to go back to the review.',
      done: () => !!q('.review-wrap')
    },
    {
      title: 'Checked against our playbook',
      body: 'Each standard position (liability cap, renewal pricing, payment terms and so on) is checked in its own focused AI call, so one check can’t crowd out another. Click any of them to jump to the clause involved.',
      target: () => q('.rp-checks'),
      placement: 'left',
      prepare: (ctx) => ctx.showReviewPanels()
    },
    ...draftEmail('Once the blockers are rejected, the response to Globex can be drafted.'),
    {
      title: 'That’s the trap',
      body: 'A contract that looked like our standard terms, with one clause at the back that undid the liability cap and another trying to talk the AI round. Both were found without reading every clause, and the security team was brought in.'
    }
  ]
}

// ---- Review a contract: Acme, a redlined NDA -----------------------------------------

const reviewAcme: Tour = {
  id: 'review-acme',
  name: 'Demo · Acme NDA',
  steps: [
    {
      title: 'An NDA with edits',
      body: 'Acme has returned our mutual NDA with changes. Some are fine, some aren’t. This demo shows how earlier negotiations help you decide quickly and consistently, and how the system learns from your decisions.'
    },
    simulateUpload('This is the contract’s page for Acme’s NDA. Uploading their redlined draft creates version 1.'),
    waitForChecks,
    {
      title: 'Three things to fix, six to decide',
      body: 'The edits have been sorted for you. Let’s start with the worst one.',
      target: () => q('.issues-summary'),
      placement: 'left'
    },
    {
      title: 'A residuals clause',
      body: '“Notwithstanding clause 2.1, either party shall be free to use… Residuals”. It lets Acme’s people reuse anything they remember.',
      target: () => issue('Clause 2.4'),
      placement: 'left',
      action: 'Click the Clause 2.4 issue.',
      done: () => openClause() === 'Clause 2.4'
    },
    {
      title: 'We’ve seen this before',
      body: 'Precedent search found two earlier negotiations where residuals clauses were rejected, including a note that the General Counsel confirmed “no residuals, in any form”. You don’t need to work this out again.',
      target: () => section('Precedents'),
      placement: 'left'
    },
    {
      title: 'Reject it',
      body: 'Following precedent.',
      target: () => q('.result-box .decision .btn.reject'),
      placement: 'top',
      action: 'Click Reject.',
      done: () => !!q('.result-box .decision textarea')
    },
    {
      title: 'Confirm',
      body: 'The redline (“Delete clause 2.4 in its entirety”) is pre-filled from the playbook.',
      target: () => q('.result-box .decision'),
      placement: 'left',
      action: 'Click Confirm reject.',
      done: () => isDecided(clause('2.4'), 'rejected')
    },
    {
      title: 'Back to the list',
      body: 'Now a change that we can probably live with.',
      target: () => q('.right-nav .link-btn'),
      placement: 'bottom',
      action: 'Click ← All issues.',
      done: () => !!q('.issues')
    },
    {
      title: 'A longer confidentiality term',
      body: 'Acme wants confidentiality to last five years instead of three.',
      target: () => issue('Clause 4.1'),
      placement: 'left',
      action: 'Click the Clause 4.1 issue.',
      done: () => openClause() === 'Clause 4.1'
    },
    {
      title: 'Exactly what changed',
      body: 'Compared with our approved wording, only “three (3)” became “five (5)”. That’s within our 2-5 year fallback, and we accepted the same change from Stark Industries last year.',
      target: () => section('Library match'),
      placement: 'left'
    },
    {
      title: 'Accept it',
      body: 'It’s within the fallback and there’s a precedent.',
      target: () => q('.result-box .decision .btn.accept'),
      placement: 'top',
      action: 'Click Accept, then Confirm accept.',
      done: () => isDecided(clause('4.1'), 'accepted')
    },
    ...draftEmail('Your rejections, reasons and proposed wording become the response to Acme.'),
    {
      title: 'A redline, decided on precedent',
      body: 'Each change was shown against our approved wording and against what we agreed before, so you could decide in seconds and consistently. Try “Second draft” to see what happens when Acme replies.'
    }
  ]
}

// ---- Second draft ----------------------------------------------------------------------------

const secondDraft: Tour = {
  id: 'second-draft',
  name: 'Demo · Second draft',
  steps: [
    {
      title: 'Acme has replied',
      body: 'You reviewed Acme’s first draft and sent your comments (we’ve done that part for you). Version 1 is listed here with your decisions. Today, their reply means reading the whole contract again.',
      target: () => q('.version-row'),
      placement: 'bottom'
    },
    simulateUpload('Uploading their reply makes it version 2, compared clause by clause with version 1.'),
    {
      ...waitForChecks,
      title: 'Version 2, checked',
      body: 'All the usual checks run on the new draft, and every clause is matched to its counterpart in version 1.'
    },
    {
      title: 'Only what changed',
      body: 'Clauses you settled in version 1 that came back word for word are skipped: you don’t read them again. That includes the five-year term you accepted. What’s left is what changed, what’s new and anything they ignored.',
      target: () => q('.version-summary'),
      placement: 'left'
    },
    {
      title: 'They removed the residuals clause',
      body: 'You rejected it in version 1, and it’s gone. Removed clauses are listed so nothing disappears silently, including clauses you had accepted.',
      target: () => q('.removed-list'),
      placement: 'left'
    },
    {
      title: 'And moved to our fallback',
      body: 'The non-solicitation clause has changed. You can see exactly what changed since version 1, and it is now within our playbook fallback: mutual, 12 months, with an advertising carve-out.',
      target: () => issue('Clause 5.1'),
      placement: 'left',
      action: 'Click the Clause 5.1 issue.',
      done: () => openClause() === 'Clause 5.1'
    },
    {
      title: 'What changed, at a glance',
      body: 'The comparison with version 1 shows their edit word by word, so you don’t have to work it out.',
      target: () => q('.version-section'),
      placement: 'left'
    },
    {
      title: 'Back to the list',
      body: 'One more thing to check.',
      target: () => q('.right-nav .link-btn'),
      placement: 'bottom',
      action: 'Click ← All issues.',
      done: () => !!q('.issues')
    },
    {
      title: 'They ignored one',
      body: 'You rejected the exclusive New York courts clause in version 1 and they sent it back word for word. That’s flagged as must-change, with your original note, so it can’t slip through.',
      target: () => issue('Clause 6.9'),
      placement: 'left'
    },
    {
      title: 'A second draft in minutes',
      body: 'Instead of re-reading 22 clauses, you check what changed, what was removed and what they ignored. Try “Third draft” to see the next round.'
    }
  ]
}

// ---- Third draft ----------------------------------------------------------------------------

const thirdDraft: Tour = {
  id: 'third-draft',
  name: 'Demo · Third draft',
  steps: [
    {
      title: 'Round three',
      body: 'Two drafts are already reviewed (done for you). After version 2, only one issue was open: Acme still wanted the New York courts. Here comes their next reply.',
      target: () => q('.page .card'),
      placement: 'bottom'
    },
    simulateUpload('Upload version 3. It’s compared with version 2.'),
    {
      ...waitForChecks,
      title: 'Version 3, checked',
      body: 'The checks run again, and every clause is matched to version 2.'
    },
    {
      title: 'Almost everything is settled',
      body: 'Nearly every clause was settled in an earlier round and came back unchanged, so it’s skipped. Two things need a look: one changed clause, and one new one.',
      target: () => q('.version-summary'),
      placement: 'left'
    },
    {
      title: 'The last fix landed',
      body: 'Clause 6.9 changed. Open it to see how.',
      target: () => clause('6.9'),
      placement: 'right',
      action: 'Click clause 6.9 in the contract.',
      done: () => openClause() === 'Clause 6.9'
    },
    {
      title: 'Exactly the wording you proposed',
      body: 'The new 6.9 is the English-courts wording you proposed in version 2, word for word, so it is accepted automatically.',
      target: () => q('.version-section'),
      placement: 'left'
    },
    {
      title: 'But something new appeared',
      body: 'A clause that wasn’t in version 2. New clauses always get a full review.',
      target: () => clause('6.10'),
      placement: 'right',
      action: 'Click clause 6.10 in the contract.',
      done: () => openClause() === 'Clause 6.10'
    },
    {
      title: 'One-sided publicity',
      body: 'Acme could name PortSwigger in investor materials without consent, with no equivalent right for us. Easy to miss in a late round, when everyone assumes the contract is done.',
      target: () => section('Standard positions'),
      placement: 'left'
    },
    {
      title: 'Reject it',
      body: 'The suggested wording (no publicity without consent, both ways) is pre-filled.',
      target: () => q('.result-box .decision .btn.reject'),
      placement: 'top',
      action: 'Click Reject, then Confirm reject.',
      done: () => isDecided(clause('6.10'), 'rejected')
    },
    {
      title: 'One clause to read in round three',
      body: 'In the third round you read one new clause, not the whole contract, and nothing settled earlier could quietly come back.'
    }
  ]
}

// ---- Add to the library ------------------------------------------------------------------------

const libraryDemo: Tour = {
  id: 'library',
  name: 'Demo · Add to the library',
  steps: [
    {
      title: 'Teach it your wording',
      body: 'The library is the wording we’ve already approved: a clause that matches it word for word is accepted without anyone reading it. This demo adds a clause to it.'
    },
    simulateUpload('Upload Initech’s NDA. It’s almost all our standard wording.'),
    waitForChecks,
    {
      title: 'One clause was reworded',
      body: 'Clause 2.2 isn’t word for word our standard. Let’s see why it was still accepted.',
      target: () => clause('2.2'),
      placement: 'right',
      action: 'Click clause 2.2.',
      done: () => openClause() === 'Clause 2.2'
    },
    {
      title: 'Same meaning, different words',
      body: 'It was close to our approved “Standard of care” clause, so Claude was asked whether the legal effect is the same. It says yes, and shows its reasoning and the exact word changes so you can check them in seconds.',
      target: () => section('Library match'),
      placement: 'left'
    },
    {
      title: 'Accept it, and nominate it',
      body: 'If this wording is fine every time, nominate it. A reviewer accepting it in one deal isn’t the same as approving it for every deal, so it goes to the owner for approval.',
      target: () => q('.result-box .decision'),
      placement: 'top',
      action: 'Click Accept, tick “Nominate this wording…”, then Confirm accept.',
      done: () => isDecided(clause('2.2'), 'accepted') && !!withText('.result-box .decision .who', 'nominated for library')
    },
    {
      title: 'Approvals',
      body: 'Library changes don’t take effect just because a reviewer nominated them. The owner approves them first.',
      target: () => navItem('Approvals'),
      placement: 'right',
      action: 'Click Approvals.',
      done: () => pageTitle() === 'Approvals'
    },
    {
      title: 'Promote it',
      body: 'This is the wording you just nominated, with where it came from. In this demo you are also the owner, so you can approve it.',
      target: () => withText('.page .card', 'Nominated by'),
      placement: 'top',
      action: 'Click Promote to pre-approved.',
      done: () => !!all('.page .pill').find((p) => p.textContent === 'promoted')
    },
    {
      title: 'Now part of the library',
      body: 'The five-year term is now pre-approved. The next NDA that contains it will be accepted automatically, without needing an AI check.',
      target: () => navItem('Library'),
      placement: 'right',
      action: 'Click Library.',
      done: () => pageTitle().startsWith('Library')
    },
    {
      title: 'There it is',
      body: 'At the end of the list, approved by you, today.',
      target: () => all('.page table.t tbody tr').at(-1) ?? null,
      placement: 'top'
    },
    {
      title: 'Accepted automatically from now on',
      body: 'Any future contract with this exact wording clears without an AI check or a reader. The library grows from real decisions, one approval at a time.'
    }
  ]
}

// ---- Add to the playbook ------------------------------------------------------------------------

const playbookDemo: Tour = {
  id: 'playbook',
  name: 'Demo · Add to the playbook',
  steps: [
    {
      title: 'Our standard positions',
      body: 'The playbook is what we accept on each topic, the fallback, and the red flags. Every contract is checked against each position in its own AI check. Let’s add one.',
      target: () => q('.page h1'),
      placement: 'bottom'
    },
    {
      title: 'Propose a position',
      body: 'Anyone can propose a change. It only takes effect once the playbook owner approves it.',
      target: () => withText('.page .btn', 'Propose new position'),
      placement: 'left',
      action: 'Click Propose new position.',
      done: () => !!q('.position-form')
    },
    {
      title: 'Describe it',
      body: (
        <>
          For example: topic <b>Publicity</b>; standard <b>No public announcements without both parties’ written consent</b>; fallback <b>Customer may name us in a customer list</b>; red
          flags <b>One-sided publicity rights</b>, <b>Use in investor materials</b>. Add a reason, then send it for approval.
        </>
      ),
      target: () => q('.position-form'),
      placement: 'left',
      action: 'Fill in the form and click Send for approval.',
      done: () => !q('.position-form') && !!withText('.page p', 'awaiting approval')
    },
    {
      title: 'Approvals',
      body: 'Playbook changes wait here for the owner. In this demo you are the owner too.',
      target: () => navItem('Approvals'),
      placement: 'right',
      action: 'Click Approvals.',
      done: () => pageTitle() === 'Approvals'
    },
    {
      title: 'Approve it',
      body: 'The owner sees exactly what would change and why it was proposed.',
      target: () => q('.page .card'),
      placement: 'top',
      action: 'Click Approve.',
      done: () => !!withText('.page .pill', 'approved')
    },
    {
      title: 'It’s in the playbook',
      body: 'Open the Playbook to see it, at version 1, with who approved it.',
      target: () => navItem('Playbook'),
      placement: 'right',
      action: 'Click Playbook.',
      done: () => pageTitle().startsWith('Playbook')
    },
    {
      title: 'Checked in every review',
      body: 'From the next contract on, this position gets its own AI check. Every change to the playbook is approved and recorded in the audit log.'
    }
  ]
}

export const DEMO_TOURS: Record<string, Tour> = {
  'review-initech': reviewInitech,
  'review-acme': reviewAcme,
  'review-globex': reviewGlobex,
  'second-draft': secondDraft,
  'third-draft': thirdDraft,
  library: libraryDemo,
  playbook: playbookDemo
}

export const WELCOME_TOUR: Tour = {
  id: 'welcome',
  name: 'Welcome',
  steps: [
    {
      title: 'Welcome to Clause Pilot',
      body: 'Clause Pilot reads routine contracts so the legal team doesn’t have to read every clause. It accepts what we’ve already approved, finds what needs changing, and shows how we handled the same issue before.'
    },
    {
      title: 'Your reviews and the knowledge behind them',
      body: 'The sidebar lists the active client’s contracts; each has a page with every draft you’ve reviewed. Below that is the knowledge the checks use (the library of pre-approved wording, our playbook and precedents), Approvals for changes waiting to be signed off, Security and the audit log. During a review, a second panel on the right holds the review controls and Ask AI.',
      target: () => q('.nav'),
      placement: 'right'
    },
    {
      title: 'One client at a time',
      body: 'You work on one client account at a time. Choose it here (or press ⌘K). Its contracts appear in the sidebar, and opening contracts needs an account to be chosen. Starting a guided demo chooses its client for you.',
      target: () => q('.account-switch'),
      placement: 'bottom'
    },
    {
      title: 'Demo mode or live mode',
      body: 'This pill shows which mode you’re in, and clicking it switches. Demo mode uses three sample contracts with recorded AI responses, so nothing leaves this computer. Live mode lets you review your own contracts with Claude.',
      target: () => q('.titlebar .mode-pill:not(.offline)'),
      placement: 'bottom'
    },
    {
      title: 'Reviewing your own contracts',
      body: (
        <>
          In live mode, choose a client, then <b>Open a contract…</b> on this page (in the setup checklist until your first review), or upload a new draft from a contract’s page. Two things to know first: it needs an <b>Anthropic API key</b> (added in Settings), and the
          contract’s text is <b>sent to Anthropic’s API</b> for the AI checks. Only use documents you’re allowed to share outside the company. The library, precedent search
          and your decisions stay on this computer.
        </>
      ),
      target: () => q('.home-upload-block') ?? q('.checklist') ?? q('.titlebar .mode-pill:not(.offline)'),
      placement: 'bottom'
    },
    {
      title: 'Try it with the demos',
      body: 'The guided demos run in demo mode, so you can explore without an API key and without sending anything anywhere.',
      target: () => q('.titlebar .mode-pill:not(.offline)'),
      placement: 'bottom',
      action: 'Click the pill to turn demo mode on.',
      done: () => !!q('.titlebar .mode-pill.demo')
    },
    {
      title: 'Guided demos',
      body: 'Short demos, each on one thing: reviewing a contract, the second and third drafts of a contract, adding to the library and adding to the playbook. Open the Demos page to start one.',
      target: () => q('.demos-link'),
      placement: 'bottom'
    }
  ]
}
