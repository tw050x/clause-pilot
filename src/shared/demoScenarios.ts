/**
 * The demos on the Demos page. Each starts from a freshly reset demo workspace;
 * `history` lists earlier drafts that are reviewed for you first (with the
 * decisions below), so e.g. the third-draft demo doesn't depend on you having
 * run the second-draft one.
 */

/**
 * A response to one of their changes, found by where it is ("§2.4") or how its
 * text starts ("Signed for"). Mirrors what a reviewer does on the document screen.
 */
export interface ScriptedChange {
  at: string
  action: 'accept' | 'restore' | 'edit' | 'strike' | 'flag'
  /** Our wording, for 'edit'. */
  text?: string
  /** Our margin comment (a reply, when they commented). */
  comment?: string
  note?: string
}

export interface DemoScenario {
  id: string
  group: 'review' | 'drafts' | 'knowledge'
  title: string
  description: string
  accountId: string
  contractId: string
  /** Earlier drafts reviewed for you before the demo starts. */
  history: { file: string; changes: ScriptedChange[] }[]
  /** The draft "Simulate upload" opens (none for the playbook demo). */
  upload?: string
  /** Where the guided demo starts. */
  startAt: 'contract' | 'playbook'
}

const ENGLISH_LAW = 'This Agreement and any dispute or claim arising out of or in connection with it shall be governed by the law of England and Wales.'
const ENGLISH_COURTS = 'The courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim arising out of or in connection with this Agreement.'
const NON_SOLICIT_FALLBACK =
  'For twelve (12) months after the date of this Agreement neither party shall solicit any employee of the other party with whom it had direct contact in connection with the Purpose, save that general advertisements not targeted at such employees shall not breach this clause.'

/** Our review of Acme's first draft, as the second- and third-draft demos assume it went. */
const ACME_V1: ScriptedChange[] = [
  { at: 'This Agreement is made', action: 'accept', note: 'Entities checked.' },
  { at: '§1.3', action: 'accept', note: 'Same exclusions, different words.' },
  { at: '§2.1', action: 'accept', note: 'Disclosure to Affiliates is fine; Acme stays responsible for them.' },
  { at: '§2.4', action: 'strike', comment: 'We do not accept residuals clauses in any form, so we have struck this.' },
  { at: '§3.3', action: 'restore', comment: 'Please keep our standard no-warranty clause.' },
  { at: '§4.1', action: 'accept', note: 'Five years is within our fallback.' },
  { at: '§5', action: 'edit', text: NON_SOLICIT_FALLBACK, comment: 'We can accept a mutual 12-month restriction, not a one-way 24-month one.' },
  { at: '§6.8', action: 'edit', text: ENGLISH_LAW, comment: 'We contract under English law.' },
  { at: '§6.9', action: 'edit', text: ENGLISH_COURTS, comment: 'Disputes go to the English courts.' },
  { at: 'Signed for', action: 'accept', note: 'Signatories checked.' }
]

/** Our review of their reply: everything resolved except the New York courts. */
const ACME_V2: ScriptedChange[] = [{ at: '§6.9', action: 'edit', text: ENGLISH_COURTS, comment: 'This is still New York. As before, disputes go to the English courts.' }]

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'review-initech',
    group: 'review',
    title: 'Initech: the fast lane',
    description: 'Our standard NDA, signed back with one reworded clause. See how little needs a person.',
    accountId: 'ac-initech',
    contractId: 'ct-initech-nda',
    history: [],
    upload: 'Initech-Mutual-NDA.txt',
    startAt: 'contract'
  },
  {
    id: 'review-acme',
    group: 'review',
    title: 'Acme: a redlined NDA',
    description: 'Our NDA with the counterparty’s edits. Decide quickly, with what we agreed in past negotiations.',
    accountId: 'ac-acme',
    contractId: 'ct-acme-nda',
    history: [],
    upload: 'Acme-Mutual-NDA-redlined.docx',
    startAt: 'contract'
  },
  {
    id: 'review-globex',
    group: 'review',
    title: 'Globex: the hidden trap',
    description: 'An order form that looks standard. One clause undoes the liability cap; another tries to talk to the AI.',
    accountId: 'ac-globex',
    contractId: 'ct-globex-order',
    history: [],
    upload: 'Globex-Order-Form-Burp-Suite-DAST.pdf',
    startAt: 'contract'
  },
  {
    id: 'second-draft',
    group: 'drafts',
    title: 'Second draft: Acme replies',
    description: 'You’ve reviewed Acme’s NDA and sent your comments. Their reply only needs reading where something changed.',
    accountId: 'ac-acme',
    contractId: 'ct-acme-nda',
    history: [{ file: 'Acme-Mutual-NDA-redlined.docx', changes: ACME_V1 }],
    upload: 'Acme-Mutual-NDA-v2.docx',
    startAt: 'contract'
  },
  {
    id: 'third-draft',
    group: 'drafts',
    title: 'Third draft: nearly there',
    description: 'One issue was still open. Acme fixes it, but slips a new clause into the same draft.',
    accountId: 'ac-acme',
    contractId: 'ct-acme-nda',
    history: [
      { file: 'Acme-Mutual-NDA-redlined.docx', changes: ACME_V1 },
      { file: 'Acme-Mutual-NDA-v2.docx', changes: ACME_V2 }
    ],
    upload: 'Acme-Mutual-NDA-v3.docx',
    startAt: 'contract'
  },
  {
    id: 'library',
    group: 'knowledge',
    title: 'Add to the library',
    description: 'Teach the system: nominate wording you’ve accepted, approve it, and it’s accepted automatically from then on.',
    accountId: 'ac-initech',
    contractId: 'ct-initech-nda',
    history: [],
    upload: 'Initech-Mutual-NDA.txt',
    startAt: 'contract'
  },
  {
    id: 'playbook',
    group: 'knowledge',
    title: 'Add to the playbook',
    description: 'Propose a new standard position, approve it as the owner, and every future contract is checked against it.',
    accountId: 'ac-acme',
    contractId: 'ct-acme-nda',
    history: [],
    startAt: 'playbook'
  }
]
