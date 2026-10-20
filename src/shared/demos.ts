/**
 * The demos: each sets the app up for one thing to show, from nothing. Loading one resets the
 * demo workspace and keeps only its clients and contracts (with their history), plus our clauses
 * and playbook, then sets the scene (a draft uploaded, items to approve) and opens where it starts.
 */
export type DemoId = 'round-1' | 'round-2' | 'client-paper' | 'markup' | 'order-form' | 'approvals' | 'portfolio'

/** How a demo sets the scene, beyond its contracts' history. */
export type DemoSetup = 'round-1' | 'round-2' | 'client-paper' | 'markup' | 'approvals'

export interface DemoDef {
  id: DemoId
  title: string
  detail: string
  /** Who it's with, in a line. */
  who: string
  icon: string
  /** The contracts it has (their clients come with them); null: every one with history. */
  contracts: string[] | null
  setup?: DemoSetup
}

export const DEMOS: DemoDef[] = [
  {
    id: 'round-1',
    title: 'Our NDA, redlined by the client',
    detail: 'Brightwater sent back our mutual NDA with their changes, some tracked and some not. The draft is planned already: start the AI review and see what it finds against the original we sent.',
    who: 'Brightwater Robotics · Mutual NDA',
    icon: 'doc',
    contracts: ['ct-demo-brightwater'],
    setup: 'round-1'
  },
  {
    id: 'round-2',
    title: 'Their next draft (round 2)',
    detail: 'Round 1 is done and Brightwater replied. Their new draft is compared with what we sent back, so only what changed since needs looking at.',
    who: 'Brightwater Robotics · Mutual NDA',
    icon: 'history',
    contracts: ['ct-demo-brightwater'],
    setup: 'round-2'
  },
  {
    id: 'client-paper',
    title: 'The client’s own paper',
    detail: 'Kestrel sent their confidentiality agreement, not ours. Nothing to compare with: each part is checked against our approved clauses and playbook.',
    who: 'Kestrel Health Systems · Confidentiality Agreement',
    icon: 'file',
    contracts: ['ct-demo-kestrel'],
    setup: 'client-paper'
  },
  {
    id: 'markup',
    title: 'Ready to send: marked-up copy and email',
    detail: 'A supplier’s agreement with the decisions made and a comment added: open the marked-up copy and draft the response.',
    who: 'Harbourline Hosting · Master Services Agreement',
    icon: 'mail',
    contracts: ['ct-demo-harbourline'],
    setup: 'markup'
  },
  {
    id: 'order-form',
    title: 'An order form with commercial asks',
    detail: 'Brightwater redlined our Burp Suite Enterprise order form: longer payment terms, a higher cap, a new security clause. Half decided already.',
    who: 'Brightwater Robotics · Enterprise order form',
    icon: 'list',
    contracts: ['ct-demo-brightwater-order']
  },
  {
    id: 'approvals',
    title: 'Approving changes to what we know',
    detail: 'A colleague nominated a clause for Clauses and proposed a new playbook position. Approve or reject them.',
    who: 'Kestrel Health Systems',
    icon: 'inbox',
    contracts: ['ct-demo-kestrel-data'],
    setup: 'approvals'
  },
  {
    id: 'portfolio',
    title: 'A busy team',
    detail: 'Seven clients and their contracts: reviews in progress, closed and archived, earlier rounds, order forms and supplier agreements. For the lists, contract pages and the queue.',
    who: 'Seven clients · 14 contracts',
    icon: 'users',
    contracts: null
  }
]

/** Where the window goes once a demo is loaded: a review, or a page; and whose (the active client). */
export interface DemoLanding {
  view: 'review' | 'queue' | 'work'
  sessionId?: string
  accountId?: string
}
