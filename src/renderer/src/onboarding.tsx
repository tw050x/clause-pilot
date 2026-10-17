import type { Tour } from './lib/tour'

// ---- DOM helpers for targets and completion checks -----------------------------

const q = (sel: string) => document.querySelector(sel)
const withText = (sel: string, text: string) => Array.from(document.querySelectorAll(sel)).find((e) => e.textContent?.includes(text)) ?? null
const navItem = (label: string) => withText('.nav-item', label)
const pageTitle = () => q('.page h1')?.textContent ?? ''

// The contract-review tours are being rebuilt for the editable document; the demos
// can still be opened with "Open the demo contract".

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
  playbook: playbookDemo
}

export const WELCOME_TOUR: Tour = {
  id: 'welcome',
  name: 'Welcome',
  steps: [
    {
      title: 'Welcome to Clause Pilot',
      body: 'Clause Pilot opens a contract as an editable document, like Word with Track Changes on: their changes in blue, anything they changed without tracking marked, and what you type in red. It writes the marked-up Word copy and the cover email from your edits and comments.'
    },
    {
      title: 'Your reviews and the knowledge behind them',
      body: 'The sidebar lists the active client’s contracts; each has a page with every draft you’ve reviewed. Below that is the knowledge the review uses (the library of approved wording, our playbook and earlier negotiations), Approvals for changes waiting to be signed off, Security and the audit log. During a review, the column on the right shows the review and the paragraph you’re in, and Ask AI.',
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
