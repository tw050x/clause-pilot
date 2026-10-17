/**
 * Real-world test contracts: Common Paper's published agreements (CC BY 4.0,
 * downloaded unchanged into test-contracts/originals), plus counterparty drafts
 * of them with realistic edits as Word tracked changes and comments.
 *
 * The drafts reuse the app's own redline engine with the counterparty as the
 * author, so the result is a real Word redline on the real document: their
 * formatting, numbering and cover-page tables intact.
 *
 *   npm run test-contracts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/main/ingest/parse'
import { splitClauses } from '../src/main/ingest/clauses'
import { buildRedline } from '../src/main/redline/docx'
import type { Clause, Decision, ReviewSession } from '../src/shared/types'

const ROOT = join(import.meta.dirname, '..', 'test-contracts')

interface Edit {
  /** Clause number ("4"), or the start of an unnumbered clause such as a cover-page row ("Governing Law"). */
  clause: string
  /** The clause as the counterparty wants it (empty with `remove`). */
  to?: string
  remove?: boolean
  /** Their margin comment explaining the change. Leave out for a silent edit. */
  comment?: string
}

interface Draft {
  from: string
  out: string
  author: string
  edits: Edit[]
}

const DRAFTS: Draft[] = [
  {
    // A prospective partner returns Common Paper's mutual NDA: cover page filled in, plus the
    // edits Common Paper itself publishes as common asks (affiliates, residuals, assignment),
    // and one silent edit that weakens the compelled-disclosure notice.
    from: 'CommonPaper-Mutual-NDA-1.0.docx',
    out: 'Northwind-Mutual-NDA-redlined.docx',
    author: 'Northwind Legal',
    edits: [
      { clause: 'Purpose', to: 'Purpose How Confidential Information may be used — Evaluating a potential integration partnership between the parties.' },
      { clause: 'Effective Date', to: 'Effective Date — 1 November 2026' },
      { clause: 'Governing Law', to: 'Governing Law — The laws of the State of Delaware.', comment: 'Northwind contracts under Delaware law as standard.' },
      { clause: 'Jurisdiction', to: 'Jurisdiction — The state and federal courts located in New Castle County, Delaware.' },
      {
        clause: '2',
        to: 'Use and Protection of Confidential Information. The Receiving Party shall: (a) use Confidential Information solely for the Purpose; (b) not disclose Confidential Information to third parties without the Disclosing Party’s prior written approval, except that the Receiving Party may disclose Confidential Information to its affiliates that are controlled by or under common control with the Receiving Party, and to its and their employees, agents, advisors, contractors and other representatives having a reasonable need to know for the Purpose, provided these representatives are bound by confidentiality obligations no less protective than the applicable terms in this MNDA and the Receiving Party remains responsible for their compliance with this MNDA; and (c) protect Confidential Information using at least the same protections the Receiving Party uses for its own similar information but no less than a reasonable standard of care.',
        comment: 'Our evaluation team sits in a group company, so affiliates need access.'
      },
      {
        clause: '3',
        to: 'Exceptions. The Receiving Party’s obligations in this MNDA do not apply to information that it can demonstrate: (a) is or becomes publicly available through no fault of the Receiving Party; (b) it rightfully knew or possessed prior to receipt from the Disclosing Party without confidentiality restrictions; (c) it rightfully obtained from a third party without confidentiality restrictions; or (d) it independently developed without using or referencing the Confidential Information. In addition, each Disclosing Party agrees that this MNDA will not restrict the Receiving Party’s use of Residuals, so long as the Receiving Party complies with its other obligations under this MNDA. “Residuals” means information in non-tangible form that is unintentionally remembered by an individual in their unaided memory and without reference to the Confidential Information.',
        comment: 'Standard for us: our engineers cannot unlearn what they have seen.'
      },
      {
        // Silent: the notice and cooperation obligation quietly disappears.
        clause: '4',
        to: 'Disclosures Required by Law. The Receiving Party may disclose Confidential Information to the extent required by law, regulation or regulatory authority, subpoena or court order.'
      },
      {
        clause: '11',
        to: 'General. Neither party has an obligation under this MNDA to disclose Confidential Information to the other or proceed with any proposed transaction. Neither party may assign this MNDA without the prior written consent of the other party, except that either party may assign this MNDA to an affiliate controlled by or under common control with the assigning party, or in connection with a merger, reorganization, acquisition, or other transfer of all or substantially all its assets or voting securities. Any assignment in violation of this Section is null and void. This MNDA will bind and inure to the benefit of each party’s permitted successors and assigns. Waivers must be signed by the waiving party’s authorized representative and cannot be implied from conduct. If any provision of this MNDA is held unenforceable, it will be limited to the minimum extent necessary so the rest of this MNDA remains in effect. This MNDA (including the Cover Page) constitutes the entire agreement of the parties with respect to its subject matter, and supersedes all prior and contemporaneous understandings, agreements, representations, and warranties, whether written or oral, regarding such subject matter. This MNDA may only be amended, modified, waived, or supplemented by an agreement in writing signed by both parties. Notices, requests and approvals under this MNDA must be sent in writing to the email or postal addresses on the Cover Page and are deemed delivered on receipt. This MNDA may be executed in counterparts, including electronic copies, each of which is deemed an original and which together form the same agreement.',
        comment: 'We restructure regularly; intra-group assignment must not need consent.'
      }
    ]
  },
  {
    // A customer's procurement team returns the provider's cloud service agreement: their law,
    // a fixed cap, a stronger warranty, termination for convenience and no change-of-control assignment.
    from: 'CommonPaper-Cloud-Service-Agreement-2.1.docx',
    out: 'Contoso-Cloud-Service-Agreement-redlined.docx',
    author: 'Contoso Procurement',
    edits: [
      { clause: 'Governing Law', to: 'Governing Law — The laws of the State of New York', comment: 'All Contoso supplier contracts are under New York law.' },
      {
        clause: '5.3',
        to: 'Termination. Either party may terminate the Framework Terms or an Order Form immediately: (a) if the other party fails to cure a material breach of the Framework Terms or an Order Form following 30 days notice; (b) upon notice if the other party (i) materially breaches the Framework Terms or an Order Form in a manner that cannot be cured; (ii) dissolves or stops conducting business without a successor; (iii) makes an assignment for the benefit of creditors; or (iv) becomes the debtor in insolvency, receivership, or bankruptcy proceedings that continue for more than 60 days. Customer may also terminate any Order Form for convenience on 30 days’ notice, and Provider will refund any prepaid Fees for the remainder of the Subscription Period.',
        comment: 'Our policy requires termination for convenience in all SaaS contracts.'
      },
      {
        clause: '6.3',
        to: 'From Provider. Provider represents and warrants to Customer that it will not materially reduce the general functionality of the Cloud Service during the Subscription Period, and that the Cloud Service will perform materially in accordance with its documentation and will not contain any virus or other malicious code.'
      },
      {
        clause: '12.6',
        to: 'Assignment. Neither party may assign any rights or obligations under this Agreement without the prior written consent of the other party. Any attempted but non-permitted assignment is void. This Agreement will be binding upon and inure to the benefit of the parties and their permitted successors and assigns.',
        comment: 'We need to approve any change of supplier, including on a change of control.'
      },
      {
        clause: '4.1',
        to: 'Fees. Unless the Order Form specifies a different currency, all Fees are in U.S. Dollars and are inclusive of taxes. Except for the prorated refund of prepaid Fees allowed with specific termination rights given in the Agreement, Fees are non-refundable.'
      }
    ]
  }
]

const find = (clauses: Clause[], key: string) =>
  /^\d+(\.\d+)*$/.test(key) ? clauses.find((c) => c.number === key) : clauses.find((c) => !c.number && c.text.startsWith(key))

mkdirSync(join(ROOT, 'redlined'), { recursive: true })
for (const d of DRAFTS) {
  const path = join(ROOT, 'originals', d.from)
  const doc = await parseFile(path)
  const clauses = splitClauses(doc.lines, doc.lineMeta)
  const decisions: Record<string, Decision> = {}
  const at = new Date('2026-10-14T09:30:00Z').toISOString()
  for (const e of d.edits) {
    const c = find(clauses, e.clause)
    if (!c) throw new Error(`${d.from}: no clause "${e.clause}"`)
    decisions[c.id] = { clauseId: c.id, decision: 'rejected', note: e.comment ?? '', redline: e.to ?? '', removal: !!e.remove, nominate: false, by: d.author, at }
  }
  const session = {
    id: d.out, docName: d.from, filePath: path, sourceType: doc.sourceType, contractType: 'general', fileSha256: doc.sha256, mode: 'live', createdAt: at,
    clauses, match: {}, precedents: {}, overrides: { status: 'done' }, playbook: {}, injection: {}, aiInjectionReports: [], decisions
  } as unknown as ReviewSession
  const { bytes, stats } = await buildRedline(session, d.author, readFileSync(path), { commentsOnlyWhenGiven: true })
  if (stats.unmatched.length) throw new Error(`${d.from}: couldn't place ${stats.unmatched.join(', ')}`)
  writeFileSync(join(ROOT, 'redlined', d.out), bytes)
  console.log(`${d.out}: ${stats.replaced} edits, ${stats.comments} comments`)
}
