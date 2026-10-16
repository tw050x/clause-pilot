import type { Tour, TourStep } from './lib/tour'

// ---- DOM helpers for targets and completion checks -----------------------------

const q = (sel: string) => document.querySelector(sel)
const all = (sel: string) => Array.from(document.querySelectorAll(sel))
const withText = (sel: string, text: string) => all(sel).find((e) => e.textContent?.includes(text)) ?? null

/** The issue row for a clause label in the triage list, e.g. "Clause 11.1". */
const issue = (label: string) => all('.issue').find((e) => e.querySelector('.issue-where')?.textContent === label) ?? null
/** A clause in the document pane by its printed number. */
const clause = (num: string) => all('.doc-clause').find((e) => e.querySelector('.doc-num')?.textContent === num) ?? null
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

// ---- Globex: the hidden trap ------------------------------------------------------

const globex: Tour = {
  id: 'globex',
  name: 'Guided demo · Globex order form',
  steps: [
    {
      title: 'An order form that looks standard',
      body: 'Globex has sent back our Burp Suite order form. Most of it matches our terms word for word, so it looks safe to sign. It isn’t, and the problem is hidden at the back. Let’s find it.'
    },
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
      body: 'The clause is highlighted in the original PDF. If its text couldn’t be found there, you’d see a warning, which usually means it was captured wrongly.',
      target: () => q('.orig mark.orig-hl'),
      placement: 'left'
    },
    {
      title: 'Back to the analysis',
      body: 'Switch back to the analysis for this clause.',
      target: () => q('.clause-tools:not(.hidden) .btn'),
      placement: 'bottom',
      action: 'Click Back to analysis.',
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
      target: () => q('.nav-item.recent'),
      placement: 'right',
      action: 'Click the Globex review in the sidebar.',
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
      title: 'Ask about the contract',
      body: 'The assistant can see the contract and everything the checks found, but it can’t make decisions.',
      target: () => withText('.rightbar-switch button', 'Ask AI'),
      placement: 'left',
      action: 'Click Ask AI.',
      done: () => (q('.rightbar-chat') as HTMLElement | null)?.style.display !== 'none' && !!q('.rightbar-chat')
    },
    {
      title: 'Ask a question',
      body: 'In demo mode, answers come from the analysis on screen; live, Claude answers.',
      target: () => q('.suggestions'),
      placement: 'left',
      action: 'Click “What are the biggest risks?”',
      done: () => !!q('.msg.assistant')
    },
    {
      title: 'Everything is recorded',
      body: 'Every AI result and every decision is written to a tamper-evident audit log.',
      target: () => navItem('Audit'),
      placement: 'right',
      action: 'Click Audit.',
      done: () => pageTitle() === 'Audit',
      prepare: (ctx) => ctx.setRightTab('review')
    },
    {
      title: 'Tamper-evident',
      body: 'Each entry includes the hash of the one before, so editing or deleting history breaks the chain, and the app tells you. Your rejection of 11.1 is in here, with who and when.',
      target: () => q('.page .card'),
      placement: 'top'
    },
    {
      title: 'That’s the trap',
      body: 'A contract that looked like our standard terms, with one clause at the back that undid the liability cap and another trying to talk the AI round. Both were found without reading every clause. Try the Acme NDA next to see how past negotiations help you decide.'
    }
  ]
}

// ---- Acme: learning from past negotiations -----------------------------------------

const acme: Tour = {
  id: 'acme',
  name: 'Guided demo · Acme NDA',
  steps: [
    {
      title: 'An NDA with edits',
      body: 'Acme has returned our mutual NDA with changes. Some are fine, some aren’t. This demo shows how earlier negotiations help you decide quickly and consistently, and how the system learns from your decisions.'
    },
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
      action: 'Click Accept.',
      done: () => !!q('.result-box .decision textarea')
    },
    {
      title: 'Teach the system',
      body: 'If this wording is acceptable every time, nominate it for the library. Once approved, future contracts with this wording are accepted automatically.',
      target: () => q('.result-box .decision'),
      placement: 'left',
      action: 'Tick “Nominate this wording…” and click Confirm accept.',
      done: () => openClause() === 'Clause 4.1' && !!withText('.result-box .decision .who', 'nominated for library')
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
      title: 'And your decisions became precedent',
      body: 'Both decisions you made, the rejected residuals clause and the accepted five-year term, are now precedents the next reviewer will see.',
      target: () => navItem('Precedents'),
      placement: 'right',
      action: 'Click Precedents.',
      done: () => pageTitle().startsWith('Precedents')
    },
    {
      title: 'Learning from every review',
      body: 'Entries tagged “from a review” came from your decisions. The library, the precedents and the playbook improve with each contract, and every change is approved and audited.',
      target: () => withText('.page table.t tbody tr', 'from a review'),
      placement: 'top'
    },
    {
      title: 'Acme has replied',
      body: 'You sent Acme your comments. A few days later they send back a new draft. This is where most of the time goes today: reading the whole contract again to find what changed. Let’s upload their reply.'
    },
    {
      title: 'Contracts live under accounts',
      body: 'Every review belongs to a client account and a contract, and each uploaded draft becomes a new version.',
      target: () => navItem('Accounts'),
      placement: 'right',
      action: 'Click Accounts.',
      done: () => pageTitle() === 'Accounts'
    },
    {
      title: 'Acme Corporation',
      body: 'Open the account.',
      target: () => withText('.account-row', 'Acme'),
      placement: 'bottom',
      action: 'Click Acme Corporation.',
      done: () => pageTitle() === 'Acme Corporation'
    },
    {
      title: 'The Mutual NDA',
      body: 'Open the contract to see its versions.',
      target: () => withText('.contract-row', 'Mutual NDA'),
      placement: 'bottom',
      action: 'Click Mutual NDA.',
      done: () => pageTitle() === 'Mutual NDA'
    },
    {
      title: 'Upload their reply',
      body: 'Version 1 is the draft you just reviewed. Uploading the reply makes it version 2, compared clause by clause with version 1.',
      target: () => q('.upload-draft'),
      placement: 'left',
      action: 'Click Upload new draft.',
      done: () => !!q('.review-wrap') && !!withText('.rp-version', 'Version 2')
    },
    {
      ...waitForChecks,
      title: 'Version 2, checked',
      body: 'All the usual checks run on the new draft, and every clause is also matched to its counterpart in version 1.'
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
      title: 'A second draft in minutes',
      body: 'Instead of re-reading 22 clauses, you check a handful: what changed, what’s new, and what they didn’t fix (here, the New York courts in 6.9 are still exclusive). Try the Initech NDA to see the fast lane, or Globex to see a hidden trap.'
    }
  ]
}

// ---- Initech: the fast lane --------------------------------------------------------------

const initech: Tour = {
  id: 'initech',
  name: 'Guided demo · Initech NDA',
  steps: [
    {
      title: 'How much of this needs reading?',
      body: 'Initech has signed our standard NDA back. This is the most common case, and the one that fills the queue at quarter end. Let’s see how much of it actually needs a lawyer.'
    },
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
      body: 'This NDA needed three quick checks instead of a full read, and the review record shows why each of the other clauses was accepted. That’s where the time goes back to the legal team. Try the Globex order form to see what happens when a contract only looks standard.'
    }
  ]
}

export const CONTRACT_TOURS: Record<string, Tour> = {
  'Globex-Order-Form-Burp-Suite-DAST.pdf': globex,
  'Acme-Mutual-NDA-redlined.docx': acme,
  'Initech-Mutual-NDA.txt': initech
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
      body: 'The sidebar lists your recent reviews, with every review under All reviews. Below that is the knowledge the checks use (the library of pre-approved wording, our playbook and precedents), Approvals for changes waiting to be signed off, and the audit log. During a review, a second panel on the right holds the review controls and Ask AI.',
      target: () => q('.nav'),
      placement: 'right'
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
          In live mode, <b>Open a contract…</b> on this page (in the setup checklist until your first review) loads a PDF, Word or text file. Two things to know first: it needs an <b>Anthropic API key</b> (added in Settings), and the
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
      title: 'Three guided demos',
      body: 'Each contract shows a different part of the workflow: the fast lane (Initech), learning from past negotiations (Acme), and finding a hidden trap (Globex). Click Guided demo on any of them.',
      target: () => q('.demo-grid'),
      placement: 'bottom'
    }
  ]
}
