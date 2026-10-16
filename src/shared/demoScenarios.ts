/**
 * The demos on the Demos page. Each starts from a freshly reset demo workspace;
 * `history` lists earlier drafts that are reviewed for you first (with the
 * decisions below), so e.g. the third-draft demo doesn't depend on you having
 * run the second-draft one.
 */

/** A decision on a clause, by printed number, or 'parties' / 'signature' for the unnumbered blocks. */
export interface ScriptedDecision {
  clause: string
  decision: 'accepted' | 'rejected'
  note: string
  redline?: string
}

export interface DemoScenario {
  id: string
  group: 'review' | 'drafts' | 'knowledge'
  title: string
  description: string
  accountId: string
  contractId: string
  /** Earlier drafts reviewed for you before the demo starts. */
  history: { file: string; decisions: ScriptedDecision[] }[]
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
const ACME_V1: ScriptedDecision[] = [
  { clause: 'parties', decision: 'accepted', note: 'Entities checked.' },
  { clause: '1.3', decision: 'accepted', note: 'Same exclusions, different words.' },
  { clause: '2.1', decision: 'accepted', note: 'Disclosure to Affiliates is fine; Acme stays responsible for them.' },
  { clause: '2.4', decision: 'rejected', note: 'We do not accept residuals clauses in any form.', redline: 'Delete clause 2.4 in its entirety.' },
  { clause: '4.1', decision: 'accepted', note: 'Five years is within our fallback.' },
  { clause: '5.1', decision: 'rejected', note: 'One-way and too long. We can accept a mutual 12-month restriction.', redline: NON_SOLICIT_FALLBACK },
  { clause: '6.8', decision: 'rejected', note: 'We contract under English law.', redline: ENGLISH_LAW },
  { clause: '6.9', decision: 'rejected', note: 'Disputes go to the English courts.', redline: ENGLISH_COURTS },
  { clause: 'signature', decision: 'accepted', note: 'Signatories checked.' }
]

/** Our review of their reply: everything resolved except the New York courts. */
const ACME_V2: ScriptedDecision[] = [
  { clause: 'parties', decision: 'accepted', note: 'Unchanged.' },
  { clause: '1.3', decision: 'accepted', note: 'Same exclusions, different words.' },
  { clause: '5.1', decision: 'accepted', note: 'Now our fallback wording.' },
  { clause: '6.9', decision: 'rejected', note: 'Still New York. Disputes go to the English courts.', redline: ENGLISH_COURTS },
  { clause: 'signature', decision: 'accepted', note: 'Unchanged.' }
]

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
    history: [{ file: 'Acme-Mutual-NDA-redlined.docx', decisions: ACME_V1 }],
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
      { file: 'Acme-Mutual-NDA-redlined.docx', decisions: ACME_V1 },
      { file: 'Acme-Mutual-NDA-v2.docx', decisions: ACME_V2 }
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
