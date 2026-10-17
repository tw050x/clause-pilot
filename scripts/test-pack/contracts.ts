// The test contracts. Paragraphs built with lib() are word for word PortSwigger's approved
// clauses (library.ts); everything else is the client's drafting. See test-pack/README.md for
// what each one is meant to test.
import { lib } from './library'

/** A paragraph of a contract, and how it arrives: as typed, or as one of their tracked changes. */
export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string; inserted?: boolean }
  | {
      kind: 'para'
      /** The printed number, typed at the start of the paragraph ("2.1", "Section 1.01"). */
      number?: string
      text: string
      /**
       * Their Track Changes: `base` is the text they edited from (word-level redline),
       * `inserted` / `deleted` the whole paragraph.
       */
      tracked?: { base?: string; inserted?: boolean; deleted?: boolean }
      /** Their margin comment on the paragraph. */
      comment?: string
    }

export interface ContractFile {
  file: string
  /** Who made the tracked changes and comments in it. */
  author: string
  date: string
  blocks: Block[]
}

const title = (text: string): Block => ({ kind: 'title', text })
const h = (text: string, inserted?: boolean): Block => ({ kind: 'heading', text, inserted })
const p = (number: string | undefined, text: string, comment?: string): Block => ({ kind: 'para', number, text, comment })
/** They edited it with Track Changes on, from `base`. */
const edited = (number: string, base: string, text: string, comment?: string): Block => ({ kind: 'para', number, text, tracked: { base }, comment })
const inserted = (number: string, text: string, comment?: string): Block => ({ kind: 'para', number, text, tracked: { inserted: true }, comment })
const deleted = (number: string, text: string): Block => ({ kind: 'para', number, text, tracked: { deleted: true } })

// ---------------------------------------------------------------------------------------------
// Test 1: our own mutual NDA, which Brightwater Robotics redlined and sent back (two rounds).
// ---------------------------------------------------------------------------------------------

const PARTIES =
  'This Agreement is made between PortSwigger Ltd, a company registered in England and Wales ("PortSwigger"), and Brightwater Robotics Inc., a Delaware corporation whose principal office is at 200 Harbor Drive, Boston, Massachusetts ("Brightwater").'
const SIGN = 'Signed for and on behalf of PortSwigger Ltd by [Authorised Signatory], Director. Signed for and on behalf of Brightwater Robotics Inc. by Dana Whitfield, General Counsel.'

/** Their rewording of our exclusions: same legal effect (the intent check should agree). */
const EXCLUSIONS_REWORDED =
  "Information shall not be Confidential Information if it: (a) is or becomes public other than as a result of a breach of this Agreement; (b) was already lawfully held by the Recipient prior to disclosure; (c) is lawfully obtained from a third party who is free to disclose it; or (d) is developed independently by the Recipient without reference to the Discloser's Confidential Information."
/** Adds Affiliates to who may receive Confidential Information. */
const OBLIGATIONS_AFFILIATES =
  "The Recipient shall: (a) keep the Discloser's Confidential Information confidential; (b) use it only for the Purpose; and (c) not disclose it to any person except its and its Affiliates' employees, officers, professional advisers and subcontractors who need to know it for the Purpose and who are bound by confidentiality obligations no less protective than those in this Agreement."
/** Their rewording of our standard of care, made WITHOUT Track Changes. Same effect. */
const CARE_REWORDED =
  "The Recipient must protect the Discloser's Confidential Information with no less than the degree of care it applies to its own confidential information and, in any event, with at least reasonable care."
const RESIDUALS =
  'Notwithstanding clause 2.1, either party shall be free to use for any purpose the Residuals resulting from access to or work with the Confidential Information of the other party. "Residuals" means information in non-tangible form which may be retained in the unaided memory of persons who have had access to the Confidential Information.'
const TERM_FIVE =
  'This Agreement starts on the date of last signature and continues for two (2) years. The obligations in this Agreement shall continue for five (5) years from the date of termination or expiry, except in relation to trade secrets, which shall be protected for as long as they remain trade secrets.'
/** Our counter-offer in round 1 (the README asks the tester to make this edit). */
const TERM_FOUR = TERM_FIVE.replace('five (5)', 'four (4)')
/** Our assignment clause with the consent qualifier quietly removed (no Track Changes). */
const ASSIGNMENT_STRICT = lib('gen-assignment').replace(', such consent not to be unreasonably withheld', '')
const NON_SOLICIT =
  'Non-solicitation. During the term of this Agreement and for twenty-four (24) months after it ends, PortSwigger shall not directly or indirectly solicit, employ or engage any employee of Brightwater with whom it has had contact in connection with the Purpose.'
const LAW_NY = 'This Agreement and any dispute or claim arising out of or in connection with it shall be governed by the laws of the State of New York.'
const COURTS_NY = 'The state and federal courts located in New York County, New York shall have exclusive jurisdiction to settle any dispute or claim arising out of or in connection with this Agreement.'

/** Round 1: what Brightwater sent back. */
export const BRIGHTWATER_V1: ContractFile = {
  file: 'Brightwater-Mutual-NDA-v1-client-redline.docx',
  author: 'Brightwater Legal',
  date: '2026-10-12T14:30:00Z',
  blocks: [
    title('MUTUAL NON-DISCLOSURE AGREEMENT'),
    p(undefined, PARTIES),
    h('1. DEFINITIONS AND PURPOSE'),
    p('1.1', lib('nda-purpose')),
    p('1.2', lib('nda-definition')),
    edited('1.3', lib('nda-exclusions'), EXCLUSIONS_REWORDED, 'Tidied the drafting; no change in substance intended.'),
    h('2. OBLIGATIONS'),
    edited('2.1', lib('nda-obligations'), OBLIGATIONS_AFFILIATES, 'Our engineering team sits in a subsidiary, so Affiliates need access.'),
    p('2.2', CARE_REWORDED),
    p('2.3', lib('nda-compelled')),
    inserted('2.4', RESIDUALS, 'Standard in all Brightwater NDAs: our engineers cannot unlearn what they have seen.'),
    h('3. RETURN AND OWNERSHIP'),
    p('3.1', lib('nda-return')),
    p('3.2', lib('nda-ownership')),
    deleted('3.3', lib('nda-no-warranty')),
    h('4. TERM'),
    edited('4.1', lib('nda-term'), TERM_FIVE, 'Our board requires a five-year term for all supplier NDAs.'),
    h('5. GENERAL'),
    p('5.1', lib('nda-remedies')),
    p('5.2', lib('nda-no-commitment')),
    p('5.3', lib('gen-entire')),
    p('5.4', ASSIGNMENT_STRICT),
    p('5.5', lib('gen-notices')),
    p('5.6', lib('gen-third-parties')),
    p('5.7', lib('gen-counterparts')),
    edited('5.8', lib('gen-law'), LAW_NY, 'We contract under New York law as standard.'),
    edited('5.9', lib('gen-jurisdiction'), COURTS_NY),
    inserted('5.10', NON_SOLICIT),
    p(undefined, SIGN)
  ]
}

/** What we sent back, if the tester follows the README's round 1 (their next draft starts from this). */
const SENT = {
  exclusions: EXCLUSIONS_REWORDED,
  obligations: OBLIGATIONS_AFFILIATES,
  care: CARE_REWORDED,
  term: TERM_FOUR
}

const COMPELLED_NO_ASSIST = lib('nda-compelled').replace(' and reasonable assistance to seek a protective order', '')
const RESIDUALS_NARROW =
  'Notwithstanding clause 2.1, either party may use the Residuals resulting from access to the Confidential Information of the other party, provided that this clause grants no licence under any patent or copyright of the other party and does not apply to source code, security vulnerability information or personal data. "Residuals" means general ideas, concepts and know-how retained in the unaided memory of persons who have had access to the Confidential Information.'
const COURTS_NON_EXCLUSIVE = lib('gen-jurisdiction').replace('exclusive jurisdiction', 'non-exclusive jurisdiction')
const ANTI_BRIBERY =
  'Anti-bribery. Each party shall comply with all applicable anti-bribery and anti-corruption laws, including the Bribery Act 2010 and the US Foreign Corrupt Practices Act, in connection with this Agreement.'

/** Round 2: Brightwater's next draft, starting from what we sent. */
export const BRIGHTWATER_V2: ContractFile = {
  file: 'Brightwater-Mutual-NDA-v2-client-response.docx',
  author: 'Brightwater Legal',
  date: '2026-10-20T10:15:00Z',
  blocks: [
    title('MUTUAL NON-DISCLOSURE AGREEMENT'),
    p(undefined, PARTIES),
    h('1. DEFINITIONS AND PURPOSE'),
    p('1.1', lib('nda-purpose')),
    p('1.2', lib('nda-definition')),
    p('1.3', SENT.exclusions),
    h('2. OBLIGATIONS'),
    p('2.1', SENT.obligations),
    p('2.2', SENT.care),
    edited('2.3', lib('nda-compelled'), COMPELLED_NO_ASSIST, 'We will always give notice where we can, but we cannot commit to helping with protective orders.'),
    inserted('2.4', RESIDUALS_NARROW, 'Narrowed in response to your comments: no patent or copyright licence, and it excludes source code, vulnerability details and personal data.'),
    h('3. RETURN AND OWNERSHIP'),
    p('3.1', lib('nda-return')),
    p('3.2', lib('nda-ownership')),
    p('3.3', lib('nda-no-warranty')),
    h('4. TERM'),
    p('4.1', SENT.term),
    h('5. GENERAL'),
    p('5.1', lib('nda-remedies')),
    p('5.2', lib('nda-no-commitment')),
    p('5.3', lib('gen-entire')),
    // Quietly put back their strict version, without Track Changes.
    p('5.4', ASSIGNMENT_STRICT),
    p('5.5', lib('gen-notices')),
    p('5.6', lib('gen-third-parties')),
    p('5.7', lib('gen-counterparts')),
    p('5.8', lib('gen-law'), 'English law is fine.'),
    edited('5.9', lib('gen-jurisdiction'), COURTS_NON_EXCLUSIVE, 'We accept English courts, but we need to be able to enforce in the US as well.'),
    inserted('5.10', ANTI_BRIBERY, 'Our compliance team requires this in every agreement.'),
    p(undefined, SIGN)
  ]
}

// ---------------------------------------------------------------------------------------------
// Test 2: Kestrel Health Systems' own confidentiality agreement (their paper, their structure).
// Nothing in it is our wording. Some sections mean the same as our clauses; some break our playbook.
// ---------------------------------------------------------------------------------------------

export const KESTREL: ContractFile = {
  file: 'Kestrel-Confidentiality-Agreement-client-paper.docx',
  author: 'Kestrel Legal',
  date: '2026-10-14T09:00:00Z',
  blocks: [
    title('MUTUAL CONFIDENTIALITY AGREEMENT'),
    p(
      undefined,
      'THIS MUTUAL CONFIDENTIALITY AGREEMENT (this "Agreement") is entered into as of the Effective Date by and between Kestrel Health Systems, Inc., a Delaware corporation with offices at 1450 Market Street, Philadelphia, Pennsylvania ("Kestrel"), and PortSwigger Ltd, a company incorporated in England and Wales ("Company"). Kestrel and Company are each a "Party" and together the "Parties".'
    ),
    p(
      undefined,
      'WHEREAS, the Parties wish to explore a potential commercial relationship concerning the testing of Kestrel\'s web applications (the "Transaction") and, in connection with the Transaction, each Party may disclose certain confidential information to the other; NOW, THEREFORE, the Parties agree as follows:'
    ),
    h('ARTICLE I – DEFINITIONS'),
    p(
      'Section 1.01',
      '"Confidential Information" means any non-public information, in whatever form, disclosed by a Party (the "Disclosing Party") or its Representatives to the other Party (the "Receiving Party") or its Representatives, whether before or after the Effective Date, including technical, financial, commercial and product information, and any information marked as confidential or that a reasonable person would understand to be confidential.'
    ),
    p('Section 1.02', '"Representatives" means a Party\'s Affiliates and its and their directors, officers, employees, agents, contractors, consultants, financing sources and professional advisers.'),
    p('Section 1.03', '"Affiliate" means any entity that directly or indirectly controls, is controlled by or is under common control with a Party, where "control" means ownership of more than fifty percent (50%) of the voting securities of an entity.'),
    h('ARTICLE II – CONFIDENTIALITY'),
    p(
      'Section 2.01',
      'The Receiving Party shall (a) hold the Disclosing Party\'s Confidential Information in confidence, (b) use it solely to evaluate and pursue the Transaction, and (c) disclose it only to those of its Representatives who need to know it for that purpose and who are under obligations of confidentiality at least as protective as this Agreement. The Receiving Party is responsible for any breach of this Agreement by its Representatives.'
    ),
    p(
      'Section 2.02',
      'The obligations in Section 2.01 do not apply to information that the Receiving Party can show (a) is or becomes generally available to the public other than through a breach of this Agreement, (b) was lawfully known to it before receipt from the Disclosing Party, (c) is received from a third party who is not under a duty of confidentiality, or (d) is independently developed without use of the Disclosing Party\'s Confidential Information.'
    ),
    p('Section 2.03', 'The Receiving Party shall safeguard the Confidential Information with the same degree of care it uses for its own information of a similar nature, which shall in no event be less than a reasonable degree of care.'),
    p(
      'Section 2.04',
      'If the Receiving Party is required by law, regulation, subpoena or court order to disclose any Confidential Information, it may do so, provided that, to the extent legally permitted, it promptly notifies the Disclosing Party so that the Disclosing Party may seek a protective order, and discloses only the portion legally required.'
    ),
    p(
      'Section 2.05',
      'Nothing in this Agreement shall restrict either Party from using, for any purpose, any information retained in the unaided memory of its Representatives who had access to Confidential Information, including ideas, concepts, know-how and techniques contained therein.'
    ),
    h('ARTICLE III – TERM AND TERMINATION'),
    p(
      'Section 3.01',
      'This Agreement shall commence on the Effective Date and remain in effect for three (3) years, unless terminated earlier by either Party on thirty (30) days\' written notice. The Receiving Party\'s obligations with respect to Confidential Information shall survive for five (5) years after expiry or termination of this Agreement.'
    ),
    p(
      'Section 3.02',
      'Upon the Disclosing Party\'s written request, the Receiving Party shall within ten (10) business days return or destroy all Confidential Information in its possession, except that it may retain copies in automatic electronic archives or as required by applicable law, which shall remain subject to this Agreement.'
    ),
    h('ARTICLE IV – MISCELLANEOUS'),
    p('Section 4.01', 'All Confidential Information remains the property of the Disclosing Party. No licence or other right under any patent, copyright, trade secret or other intellectual property is granted by this Agreement, except the limited right to use the Confidential Information for the Transaction.'),
    p('Section 4.02', 'ALL CONFIDENTIAL INFORMATION IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, AND THE DISCLOSING PARTY MAKES NO REPRESENTATION AS TO ITS ACCURACY OR COMPLETENESS.'),
    p('Section 4.03', 'Each Party agrees that a breach of this Agreement may cause irreparable harm for which monetary damages would not be a sufficient remedy, and that the non-breaching Party shall be entitled to seek equitable relief, including an injunction or specific performance, in addition to any other remedy.'),
    p(
      'Section 4.04',
      'For a period of twelve (12) months from the Effective Date, Company shall not, directly or indirectly, solicit for employment or hire any employee of Kestrel with whom Company had contact in connection with the Transaction, provided that general advertisements not targeted at Kestrel employees shall not breach this Section.'
    ),
    p('Section 4.05', 'Neither Party is obligated by this Agreement to proceed with the Transaction or to enter into any further agreement.'),
    p(
      'Section 4.06',
      'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws principles. Each Party irrevocably submits to the exclusive jurisdiction of the state and federal courts located in Wilmington, Delaware.'
    ),
    p('Section 4.07', 'Neither Party may assign this Agreement without the prior written consent of the other Party, except that Kestrel may assign it without consent to any Affiliate or to a successor in connection with a merger, acquisition or sale of all or substantially all of its assets.'),
    p('Section 4.08', 'This Agreement constitutes the entire understanding of the Parties regarding its subject matter and supersedes all prior discussions and agreements, whether written or oral, relating to that subject matter.'),
    p('Section 4.09', 'This Agreement may be executed in counterparts, each of which shall be deemed an original, and signatures delivered electronically or by PDF shall be effective as originals.'),
    p(undefined, 'IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date. KESTREL HEALTH SYSTEMS, INC. By: Marcus Hale, Chief Legal Officer. PORTSWIGGER LTD By: [Authorised Signatory], Director.')
  ]
}

export const CONTRACTS = [BRIGHTWATER_V1, BRIGHTWATER_V2, KESTREL]
