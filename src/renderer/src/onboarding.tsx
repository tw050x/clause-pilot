import type { Tour, TourStep } from './lib/tour'

// ---- DOM helpers for targets and completion checks -----------------------------

const q = (sel: string) => document.querySelector(sel)
const all = (sel: string) => Array.from(document.querySelectorAll(sel))
const withText = (sel: string, text: string) => all(sel).find((e) => e.textContent?.includes(text)) ?? null

/** A change in the document (its first paragraph), by where it is ("§2.4") or how its text starts ("Signed for"). */
const change = (where: string) =>
  all('.dr-row[data-change]')
    .find((e) => {
      const w = e.getAttribute('data-change') ?? ''
      return w.split(' ')[0] === where || w.startsWith(where)
    })
    ?.querySelector('.dr-block') ?? null
/** The change open in the card below the list. */
const openChange = () => q('.dr-card .rp-h')?.firstChild?.textContent ?? ''
const isOpen = (where: string) => openChange().split(' ')[0] === where || openChange().startsWith(where)
const status = (where: string, st: 'accepted' | 'countered' | 'flagged') => !!change(where)?.classList.contains(`st-${st}`)
/** A paragraph of the contract by its printed number. */
const para = (label: string) => all('.dr-block').find((e) => e.querySelector('.dr-label')?.textContent?.replace(/\.$/, '') === label) ?? null
const card = (sel: string) => q(`.dr-card ${sel}`)
const cardButton = (text: string) => withText('.dr-card button', text)
const navItem = (label: string) => withText('.nav-item', label)
const pageTitle = () => q('.page h1')?.textContent ?? ''

const reviewPanel: TourStep['prepare'] = (ctx) => {
  ctx.showReviewPanels()
  ctx.setRightTab('review')
}

/** First action in every contract demo: the demo's own "upload". */
const simulateUpload = (body: string): TourStep => ({
  title: 'Simulate the upload',
  body,
  target: () => q('.demo-upload'),
  placement: 'bottom',
  action: 'Click Simulate upload.',
  done: () => !!q('.dr-wrap')
})

const openStep = (where: string, title: string, body: React.ReactNode): TourStep => ({
  title,
  body,
  target: () => change(where),
  placement: 'right',
  action: where.startsWith('§') ? `Click ${where.slice(1)} in the document.` : 'Click it in the document.',
  done: () => isOpen(where),
  prepare: reviewPanel
})

const askAi = (body: React.ReactNode): TourStep[] => [
  {
    title: 'Ask the AI about this change',
    body,
    target: () => q('.dr-card .dr-ai'),
    placement: 'left',
    action: 'Click Ask AI.',
    done: () => !!card('.dr-ai-card')
  }
]

const draftEmail = (body: React.ReactNode): TourStep[] => [
  {
    title: 'Draft the response',
    body,
    target: () => withText('.dr-bar .btn', 'Draft response'),
    placement: 'left',
    action: 'Click Draft response.',
    done: () => !!q('.modal'),
    prepare: reviewPanel
  },
  {
    title: 'An email built from your decisions',
    body: 'Each change you answered becomes a numbered point, with your comments as the reason. Changes you accepted are acknowledged in a line, and anything flagged for internal review is left out. Edit it, then copy it into your email client.',
    target: () => q('.modal'),
    placement: 'left',
    action: 'Close the email to continue.',
    done: () => !q('.modal')
  }
]

const markedUpCopy = (body: React.ReactNode): TourStep[] => [
  {
    title: 'And a marked-up copy',
    body: 'Lawyers reply in Word. The same edits and comments mark up their own document, ready to attach to the email.',
    target: () => withText('.dr-bar .btn', 'Marked-up copy'),
    placement: 'left',
    action: 'Click Marked-up copy.',
    done: () => !!q('.redline-modal'),
    prepare: reviewPanel
  },
  {
    title: 'Our changes, in their Word file',
    body,
    target: () => q('.redline-modal'),
    placement: 'left',
    action: 'Close the marked-up copy to continue.',
    done: () => !q('.redline-modal')
  }
]

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
    {
      title: 'The contract, as written',
      body: 'This is the contract as it appears in their file, not chopped into clauses. Grey text is unchanged; anything that needs your attention is highlighted.',
      target: () => q('.dr-doc'),
      placement: 'right'
    },
    {
      title: 'Compared with our wording',
      body: 'There are no tracked changes, but the document is on our paper, so every paragraph was compared with our approved wording. 18 match word for word. Only 3 differ, and they’re listed as changes to decide.',
      target: () => q('.dr-baseline'),
      placement: 'left',
      prepare: reviewPanel
    },
    openStep('§2.2', 'One clause was reworded', 'The party details and the signature block are different in every deal. Clause 2.2 is the interesting one.'),
    {
      title: 'Exactly what differs',
      body: 'It is shown as a redline against our approved “Standard of care” clause, so you can see every word that changed, even though Initech didn’t track anything.',
      target: () => card('.dr-card-redline'),
      placement: 'left'
    },
    ...askAi('Nothing in this contract has been sent to the AI so far. Ask, and this one change goes to Claude with the whole contract for context.'),
    {
      title: 'Same meaning, different words',
      body: 'The AI explains what the change does, who it favours and whether it conflicts with our playbook. It only advises: nothing changes until you act.',
      target: () => card('.dr-ai-card'),
      placement: 'left'
    },
    {
      title: 'Accept it',
      body: 'If you agree, accept their wording.',
      target: () => card('.dr-card-actions .btn.accept'),
      placement: 'top',
      action: 'Click Accept theirs.',
      done: () => status('§2.2', 'accepted')
    },
    {
      title: 'Now the party details',
      body: 'Check the names and addresses against the deal, then accept them.',
      target: () => change('This Agreement'),
      placement: 'right',
      action: 'Click the party details at the top of the contract, then Accept theirs.',
      done: () => status('This Agreement', 'accepted')
    },
    {
      title: 'And the signature block',
      body: 'Last one.',
      target: () => change('Signed for'),
      placement: 'right',
      action: 'Click the signature block at the end of the contract, then Accept theirs.',
      done: () => status('Signed for', 'accepted')
    },
    ...draftEmail('Nothing needed changing, so the response is a simple “happy to proceed”.'),
    {
      title: 'Three things, not twenty-seven paragraphs',
      body: 'Everything that is word for word our approved wording stayed in the background. You decided three things, and asked the AI about one of them.'
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
      body: 'Acme has returned our mutual NDA with tracked changes and comments. Some are fine and some aren’t. This demo shows how to answer a redline in place, using what we agreed before.'
    },
    simulateUpload('This is the contract’s page for Acme’s NDA. Uploading their redlined draft creates version 1.'),
    {
      title: 'Their redline, as in Word',
      body: 'The contract is shown as their Word file shows it: their insertions underlined and deletions struck through in blue. Your own changes will be red. Unchanged text is greyed so the changes stand out, and the speech bubbles show where they commented.',
      target: () => q('.dr-doc'),
      placement: 'right'
    },
    {
      title: 'Grouped into changes',
      body: 'Every edit in a paragraph, and the paragraphs of one clause, are a single change to decide, however many edits it has: their new section 5 (heading and clause) is one change, not two. The top of the sidebar counts them; below it, the sidebar shows whatever you select in the document.',
      target: () => q('.dr-bar'),
      placement: 'left',
      prepare: reviewPanel
    },
    openStep('§3.3', 'They deleted one of our clauses', 'Deletions are the easiest edits to miss when reading a redline.'),
    {
      title: 'Our standard wording, deleted',
      body: 'The card shows it was our approved “No warranty” clause. Put it back with Restore original: that is written into their file as our tracked change.',
      target: () => card('.dr-card-actions'),
      placement: 'left',
      action: 'Click Restore original.',
      done: () => status('§3.3', 'countered')
    },
    openStep('§2.4', 'A residuals clause', '“Notwithstanding clause 2.1, either party shall be free to use… Residuals”. Acme inserted it, with a comment explaining why.'),
    {
      title: 'We’ve seen this before',
      body: 'Earlier negotiations are searched for the same change. Residuals clauses were rejected with Hooli and Vandelay, with a note that the General Counsel confirmed “no residuals, in any form”. Every decision you make is recorded here for next time.',
      target: () => card('.dr-seen'),
      placement: 'left'
    },
    ...askAi('The AI gets this change, the whole contract, our playbook and those earlier negotiations, as one request.'),
    {
      title: 'What it touches',
      body: 'It recommends restoring our wording (striking the clause), and points to the paragraphs the change affects: it overrides 2.1 and undermines 3.2. Click either to see it in the contract.',
      target: () => card('.dr-ai-card'),
      placement: 'left'
    },
    {
      title: 'Apply it',
      body: 'Its suggestion becomes your edit only when you apply it: the clause is struck as your tracked change.',
      target: () => cardButton('Apply as my edit'),
      placement: 'left',
      action: 'Click Apply as my edit.',
      done: () => status('§2.4', 'countered')
    },
    {
      title: 'Reply to their comment',
      body: 'Use the suggested comment as your reply to Acme’s. Comments are in the sidebar, one thread per paragraph; yours is threaded under theirs here and in the Word file.',
      target: () => cardButton('Use as my comment'),
      placement: 'left',
      action: 'Click Use as my comment, then Comment under Acme’s comment in the sidebar.',
      done: () => !!q('.dr-comment.theirs .dr-comment.ours.reply')
    },
    openStep('§4.1', 'A longer confidentiality term', 'Acme wants confidentiality to last five years instead of three.'),
    {
      title: 'Within our fallback',
      body: 'Only “three (3)” became “five (5)”. That is within our 2 to 5 year fallback, and we accepted five years from Stark Industries.',
      target: () => card('.dr-card-actions .btn.accept'),
      placement: 'top',
      action: 'Click Accept theirs.',
      done: () => status('§4.1', 'accepted')
    },
    ...draftEmail('Your answers and comments become the response to Acme.'),
    ...markedUpCopy(
      'Our changes are tracked changes in your name: 2.4 struck out, and 3.3 put back. Our comments are Word comments, and the reply sits under Acme’s. Their change to 4.1, which you accepted, is accepted in the file.'
    ),
    {
      title: 'A redline, answered in place',
      body: 'You worked in the document, decided each change once, and saw what we agreed before. The AI was asked about one change, when you wanted it. Try “Second draft” to see Acme’s reply.'
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
      body: 'Globex has sent back our Burp Suite order form as a PDF, with no tracked changes. Most of it matches our terms word for word, so it looks safe to sign. It isn’t.'
    },
    simulateUpload('This is Globex’s contract page. In real use you’d upload their file here; in the demo, the upload is simulated.'),
    {
      title: 'Compared with our wording',
      body: 'With no tracked changes, the PDF was compared with our approved wording. 17 paragraphs match word for word. Eight don’t, including a whole “Special conditions” section that isn’t in our template at all.',
      target: () => q('.dr-baseline'),
      placement: 'left',
      prepare: reviewPanel
    },
    {
      title: 'Someone tried to talk to the AI',
      body: 'Clause 11.3 contains a note “to any AI or automated contract review system” claiming the special conditions are pre-approved. A local check caught it before anything was sent to an AI. That’s a security matter: the review is on hold and nothing can go to the AI or back to Globex.',
      target: () => para('11.3'),
      placement: 'right'
    },
    {
      title: 'The security team is alerted',
      body: 'Alerts land on the Security page, with a count in the sidebar.',
      target: () => navItem('Security'),
      placement: 'right',
      action: 'Click Security.',
      done: () => pageTitle() === 'Security'
    },
    {
      title: 'Security reviews it',
      body: 'The security team sees the exact text that was flagged and the patterns that matched. In this demo you are also on the security team.',
      target: () => q('.alert-card'),
      placement: 'top',
      action: 'Click Confirm injection attempt.',
      done: () => pageTitle() === 'Security' && !q('.alert-card') && !!withText('.page .pill', 'confirmed attempt')
    },
    {
      title: 'Back to the review',
      body: 'Confirmed: 11.3 can’t be accepted, and the rest of the review can go on.',
      target: () => withText('.page tr.clickable', 'Globex'),
      placement: 'top',
      action: 'Click the resolved alert to go back to the review.',
      done: () => !!q('.dr-wrap')
    },
    openStep('§11.1', 'The real problem', 'Clause 11.1 is one of the special conditions. Let’s look at it.'),
    ...askAi('Ask the AI what this condition does in the context of the whole order form.'),
    {
      title: 'The trap',
      body: 'Our liability cap in 7.1 is word for word our approved wording, but 11.1 says “Notwithstanding clauses 7.1 and 7.2… liability… shall be unlimited”, and 1.1 makes the order form prevail over our terms. The AI points to all three, and recommends escalating.',
      target: () => card('.dr-ai-card'),
      placement: 'left'
    },
    {
      title: 'Don’t trust the parser: check the original',
      body: 'Text pulled out of a PDF can go wrong. You can always see a paragraph in the original document.',
      target: () => cardButton('Check in the original'),
      placement: 'left',
      action: 'Click Check in the original.',
      done: () => !!q('.dr-original mark.orig-hl')
    },
    {
      title: 'There it is in the PDF',
      body: 'This is the actual PDF Globex sent, with the paragraph highlighted. If its text couldn’t be found, you’d see a warning.',
      target: () => q('.dr-original'),
      placement: 'left',
      action: 'Close it to continue.',
      done: () => !q('.dr-original')
    },
    {
      title: 'Strike it',
      body: 'It isn’t in our template, so answering it means striking it. That goes into the marked-up copy as your tracked change.',
      target: () => card('.dr-card-actions'),
      placement: 'left',
      action: 'Click Strike it.',
      done: () => status('§11.1', 'countered')
    },
    ...draftEmail('With the blockers answered, the response to Globex can be drafted.'),
    {
      title: 'That’s the trap',
      body: 'A contract that looked like our standard terms, with one clause at the back that undid the liability cap and another trying to talk the AI round. Comparing with our wording surfaced both, and the security team was brought in before any AI saw the text.'
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
      body: 'You reviewed Acme’s first draft and sent your marked-up copy (we’ve done that part for you). Their reply is a clean document: no tracked changes. Normally that means reading it all again.',
      target: () => q('.version-row'),
      placement: 'bottom'
    },
    simulateUpload('Uploading their reply makes it version 2.'),
    {
      title: 'Compared with what we sent',
      body: 'Version 2 was compared with what we sent back: their text with our edits. They took our wording in 3.3, 5.1 and 6.8. One paragraph was changed without Track Changes.',
      target: () => q('.dr-baseline'),
      placement: 'left',
      prepare: reviewPanel
    },
    {
      title: 'Only what changed',
      body: 'Fold away everything that is as we sent it.',
      target: () => q('.dr-toggle'),
      placement: 'left',
      action: 'Tick Only what changed.',
      done: () => !!q('.dr-fold')
    },
    openStep('§6.9', 'A change they didn’t track', 'Clause 6.9 isn’t what we sent, and it wasn’t shown as a tracked change.'),
    {
      title: 'They put New York back',
      body: 'The redline is against what we sent: our English-courts wording replaced by New York again. The card shows what we proposed last round, and our comment.',
      target: () => card('.dr-last'),
      placement: 'left'
    },
    {
      title: 'Answer it the same way',
      body: 'This exact change was seen before (in version 1), and we restored our wording. One click answers it the same way again.',
      target: () => card('.dr-seen'),
      placement: 'left',
      action: 'Click Answer the same way.',
      done: () => status('§6.9', 'countered')
    },
    ...draftEmail('The email also tells Acme that 6.9 was changed without being tracked.'),
    {
      title: 'A second draft in minutes',
      body: 'Instead of re-reading the contract, you checked one paragraph: the one that wasn’t as we sent it. Try “Third draft” to see the next round.'
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
    simulateUpload('Upload version 3. It’s compared with what we sent for version 2.'),
    {
      title: 'The last fix landed',
      body: 'They took our English-courts wording in 6.9. But one paragraph was added without Track Changes.',
      target: () => q('.dr-baseline'),
      placement: 'left',
      prepare: reviewPanel
    },
    openStep('§6.10', 'Something new appeared', 'A clause that wasn’t in what we sent. Easy to miss in a late round, when everyone assumes the contract is done.'),
    ...askAi('Ask the AI what the new clause does.'),
    {
      title: 'One-sided publicity',
      body: 'Acme could name PortSwigger in investor materials and customer communications without consent, with no equivalent right for us.',
      target: () => card('.dr-ai-card'),
      placement: 'left'
    },
    {
      title: 'Strike it',
      body: 'Apply the AI’s suggestion: the clause is struck as your tracked change.',
      target: () => cardButton('Apply as my edit'),
      placement: 'left',
      action: 'Click Apply as my edit.',
      done: () => status('§6.10', 'countered')
    },
    {
      title: 'One paragraph to read in round three',
      body: 'In the third round you read one new clause, not the whole contract, and nothing could change quietly: anything different from what we sent shows up, tracked or not.'
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
      body: 'The library is the wording we’ve already approved. Paragraphs that match it word for word stay in the background: nobody needs to read them. This demo adds wording to it.'
    },
    simulateUpload('Upload Initech’s NDA. It’s almost all our standard wording.'),
    openStep('§2.2', 'One clause was reworded', 'Clause 2.2 differs from our approved “Standard of care” wording, but says the same thing.'),
    {
      title: 'Accept it',
      body: 'Their wording is fine.',
      target: () => card('.dr-card-actions .btn.accept'),
      placement: 'top',
      action: 'Click Accept theirs.',
      done: () => status('§2.2', 'accepted')
    },
    {
      title: 'Nominate it',
      body: 'If this wording is fine every time, nominate it. Accepting it in one deal isn’t the same as approving it for every deal, so it goes to the library owner.',
      target: () => card('.dr-nominate'),
      placement: 'left',
      action: 'Click Nominate this wording for the library, then Nominate.',
      done: () => !!withText('.dr-card .dr-nominate', 'Nominated')
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
      body: 'Open the library to see it.',
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
      title: 'Matched automatically from now on',
      body: 'The next contract with this exact wording won’t show it as a change at all. The library grows from real decisions, one approval at a time.'
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
      body: 'The playbook is what we accept on each topic, the fallback, and the red flags. When you ask the AI about a change, it checks the change against these positions. Let’s add one.',
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
      title: 'Used whenever you ask',
      body: 'From now on, every change you ask the AI about is checked against this position too. Every change to the playbook is approved and recorded in the audit log.'
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
      body: 'Clause Pilot shows a contract as written and highlights only what changed: their tracked changes, and anything that differs from what we sent or from our approved wording. You answer in place, and it writes the marked-up Word copy and the email. The AI is there when you ask for it.'
    },
    {
      title: 'Your reviews and the knowledge behind them',
      body: 'The sidebar lists the active client’s contracts; each has a page with every draft you’ve reviewed. Below that is the knowledge the review uses (the library of approved wording, our playbook and earlier negotiations), Approvals for changes waiting to be signed off, Security and the audit log. During a review, a second panel on the right holds the list of changes and Ask AI.',
      target: () => q('.nav'),
      placement: 'right'
    },
    {
      title: 'One client at a time',
      body: 'You work on one client account at a time. Choose it here (or press ⌘K). Its contracts appear in the sidebar, and opening contracts needs an account to be chosen.',
      target: () => q('.account-switch'),
      placement: 'bottom'
    },
    {
      title: 'Demo mode or live mode',
      body: 'This pill shows which mode you’re in, and clicking it switches. Demo mode uses sample contracts with recorded AI responses, so nothing leaves this computer. Live mode lets you review your own contracts.',
      target: () => q('.titlebar .mode-pill:not(.offline)'),
      placement: 'bottom'
    },
    {
      title: 'Reviewing your own contracts',
      body: (
        <>
          In live mode, choose a client, then <b>Open a contract…</b> on this page (in the setup checklist until your first review), or upload a new draft from a contract’s page. Reviewing needs nothing else. To ask the AI about a change you need an{' '}
          <b>Anthropic API key</b> (added in Settings), and when you ask, the <b>contract’s text is sent to Anthropic’s API</b>. Only do that with documents you’re allowed to share outside the company. Everything else stays on this computer.
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
