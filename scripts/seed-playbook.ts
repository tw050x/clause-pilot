// Seed standard positions ("the playbook") and negotiation history. `npm run demo:build` writes them to data/seed/.
import type { PlaybookPosition, Precedent } from '../src/shared/types'

export const PLAYBOOK: PlaybookPosition[] = [
  {
    id: 'pb-governing-law',
    title: 'Governing law and jurisdiction',
    appliesTo: ['nda', 'order-form'],
    standard: 'Law of England and Wales, with the courts of England and Wales having exclusive jurisdiction.',
    acceptableFallback: 'Law of Ireland or Scotland; or English law with non-exclusive jurisdiction. Any US state law needs General Counsel sign-off.',
    redFlags: ['Any US state law', 'Exclusive jurisdiction of courts outside the UK', 'Arbitration seated outside London']
  },
  {
    id: 'pb-confidentiality-term',
    title: 'Duration of confidentiality obligations',
    appliesTo: ['nda'],
    standard: 'Obligations survive for 3 years after termination or expiry; trade secrets protected for as long as they remain trade secrets.',
    acceptableFallback: 'Anywhere from 2 to 5 years after termination.',
    redFlags: ['Perpetual obligations for all information', 'Less than 2 years', 'No survival clause']
  },
  {
    id: 'pb-mutuality',
    title: 'Mutuality',
    appliesTo: ['nda'],
    standard: 'Every confidentiality obligation, restriction and remedy applies equally to both parties.',
    acceptableFallback: 'None. A one-way NDA must be on our one-way template.',
    redFlags: ['Obligations that bind only PortSwigger', 'Remedies or indemnities available to one party only']
  },
  {
    id: 'pb-residuals',
    title: 'Residuals',
    appliesTo: ['nda'],
    standard: 'No residuals clause. The Recipient may not use Confidential Information retained in memory outside the Purpose.',
    acceptableFallback: 'None. We have never accepted a residuals clause; escalate to General Counsel.',
    redFlags: ['Right to use information retained in unaided memory', 'Any "notwithstanding" language that frees use of Confidential Information']
  },
  {
    id: 'pb-non-solicit',
    title: 'Non-solicitation of staff',
    appliesTo: ['nda', 'order-form'],
    standard: 'No non-solicitation clause.',
    acceptableFallback: 'Mutual, no more than 12 months, limited to staff directly involved, with a carve-out for general job advertisements.',
    redFlags: ['One-way restriction on PortSwigger', 'Longer than 12 months', 'Liquidated damages or hiring fees', 'No carve-out for general advertising']
  },
  {
    id: 'pb-liability-cap',
    title: 'Limitation of liability',
    appliesTo: ['order-form'],
    standard: 'Mutual cap at 12 months\' fees; indirect and consequential loss excluded; only liability that cannot be limited by law is uncapped.',
    acceptableFallback: 'Cap up to 2x annual fees; a separate data-protection super-cap of up to 3x annual fees.',
    redFlags: ['Unlimited liability for data breaches, security incidents or confidentiality', 'Caps based on total multi-year contract value', 'Carve-outs from the cap hidden in schedules or special conditions']
  },
  {
    id: 'pb-renewal-pricing',
    title: 'Renewal and pricing',
    appliesTo: ['order-form'],
    standard: '12-month auto-renewal unless either party gives 30 days\' notice; PortSwigger may change fees for a renewal on 60 days\' notice.',
    acceptableFallback: 'Renewal price increases capped at no less than 7% per year; non-renewal notice of up to 60 days.',
    redFlags: ['Price freezes or caps below 7%', 'Customer termination for convenience mid-term', 'Pro-rata refunds on termination for convenience', 'Multi-year lock-in at fixed prices']
  },
  {
    id: 'pb-payment',
    title: 'Payment terms',
    appliesTo: ['order-form'],
    standard: 'Payment within 30 days of invoice.',
    acceptableFallback: 'Up to 45 days; up to 60 days for UK public sector bodies only.',
    redFlags: ['More than 45 days for a private-sector customer', 'Payment conditional on acceptance testing', 'Customer set-off rights']
  },
  {
    id: 'pb-precedence',
    title: 'Order of precedence',
    appliesTo: ['order-form'],
    standard: 'The PortSwigger Licence Terms prevail over the Order Form unless the Order Form expressly varies a named provision.',
    acceptableFallback: 'Order Form prevails only for commercial details (product, quantity, price, dates).',
    redFlags: ['Order Form or Special Conditions generally prevailing over the Terms', 'Customer purchase-order terms applying']
  },
  {
    id: 'pb-indemnity',
    title: 'Indemnities',
    appliesTo: ['order-form'],
    standard: 'PortSwigger gives only a UK IP infringement indemnity, subject to notice and control of the defence. No other indemnities.',
    acceptableFallback: 'IP indemnity extended to US/EU IP rights.',
    redFlags: ['General indemnity for any breach', 'Indemnity for data breaches or security incidents', 'Indemnities outside the liability cap']
  },
  {
    id: 'pb-data-protection',
    title: 'Data protection',
    appliesTo: ['order-form'],
    standard: 'PortSwigger\'s Data Processing Addendum applies.',
    acceptableFallback: 'Customer DPA only after review by the privacy team.',
    redFlags: ['Customer DPA imposed without review', 'On-site audit rights', 'Unlimited liability for data protection breaches']
  }
]

const p = (
  id: string,
  contractType: Precedent['contractType'],
  category: string,
  counterparty: string,
  date: string,
  outcome: Precedent['outcome'],
  text: string,
  notes: string
): Precedent => ({ id, contractType, category, counterparty, date, outcome, text, notes, source: 'seed' })

export const PRECEDENTS: Precedent[] = [
  p('pr-001', 'nda', 'Residuals', 'Hooli Inc.', '2025-06-12', 'rejected',
    'Notwithstanding the foregoing, either party may use for any purpose the residuals resulting from access to Confidential Information, being information retained in the unaided memory of its personnel.',
    'Rejected outright. Residuals clauses would let a competitor reuse our product roadmap. Hooli dropped it on the first push-back.'),
  p('pr-002', 'nda', 'Residuals', 'Vandelay Industries', '2026-02-03', 'rejected',
    'Each party shall be free to use Residuals for any purpose, provided that this does not grant a licence under any patent or copyright. "Residuals" means information retained in the unaided memory of individuals who have had access to Confidential Information.',
    'Narrower version (no patent or copyright licence) still rejected. GC confirmed: no residuals, in any form.'),
  p('pr-003', 'nda', 'Term', 'Stark Industries', '2025-09-22', 'accepted',
    'The obligations in this Agreement shall continue for five (5) years from the date of termination or expiry.',
    'Accepted. Five years is within the fallback, and the obligation is mutual, so it also protects us.'),
  p('pr-004', 'nda', 'Term', 'Tyrell Corporation', '2025-11-08', 'rejected',
    'The obligations of confidentiality in this Agreement shall continue in perpetuity.',
    'Rejected perpetual obligations. Agreed 5 years plus trade secrets for as long as they remain secret.'),
  p('pr-005', 'nda', 'Confidentiality', 'Stark Industries', '2025-09-22', 'accepted',
    'The Recipient shall not disclose Confidential Information to any person except its and its Affiliates\' employees, officers, professional advisers and subcontractors who need to know it for the Purpose.',
    'Accepted. Disclosure to Affiliates is fine provided the Recipient stays liable for them. We added "the Recipient is responsible for any breach by its Affiliates".'),
  p('pr-006', 'general', 'Governing law', 'Initrode LLC', '2025-04-17', 'rejected',
    'This Agreement shall be governed by and construed in accordance with the laws of the State of New York.',
    'Rejected New York law. Counter-proposed English law; Initrode accepted.'),
  p('pr-007', 'general', 'Governing law', 'Umbrella Corporation', '2026-01-14', 'accepted',
    'This Agreement shall be governed by the laws of the State of Delaware, and the parties submit to the non-exclusive jurisdiction of the Delaware courts.',
    'Exception approved by General Counsel for a strategic enterprise deal (>£250k ARR). Not a precedent for routine deals.'),
  p('pr-008', 'general', 'Governing law', 'Dunder Mifflin plc', '2025-07-30', 'accepted',
    'This Agreement shall be governed by the laws of Ireland and the Irish courts shall have exclusive jurisdiction.',
    'Irish law is within the fallback. Accepted without escalation.'),
  p('pr-009', 'general', 'Jurisdiction', 'Initrode LLC', '2025-04-17', 'rejected',
    'The state and federal courts located in New York County, New York shall have exclusive jurisdiction over any dispute.',
    'Rejected together with New York governing law.'),
  p('pr-010', 'nda', 'Non-solicitation', 'Cyberdyne Systems', '2025-10-02', 'accepted',
    'For twelve (12) months after the date of this Agreement neither party shall solicit any employee of the other party with whom it had direct contact in connection with the Purpose, save that general advertisements not targeted at such employees shall not breach this clause.',
    'Accepted. Mutual, 12 months, limited to staff directly involved, with an advertising carve-out: exactly our fallback.'),
  p('pr-011', 'nda', 'Non-solicitation', 'Massive Dynamic', '2026-03-19', 'rejected',
    'PortSwigger shall not, for a period of twenty-four (24) months, solicit or employ any employee of Massive Dynamic.',
    'Rejected: one-way and 24 months. Offered our mutual 12-month fallback, which was accepted.'),
  p('pr-012', 'order-form', 'Liability', 'Soylent Corp', '2025-08-11', 'rejected',
    'Notwithstanding any other provision, the Supplier\'s liability for any breach of data protection obligations or any security incident shall be unlimited.',
    'Rejected unlimited data-breach liability. Agreed a data-protection super-cap at 3x annual fees.'),
  p('pr-013', 'order-form', 'Liability', 'Massive Dynamic', '2026-03-19', 'accepted',
    'The Supplier\'s total liability for breach of the data protection provisions shall not exceed three (3) times the Fees paid or payable in the twelve (12) months preceding the claim.',
    'Accepted. A 3x super-cap is the top of our fallback.'),
  p('pr-014', 'order-form', 'Fees and payment', 'NHS Digital Trust', '2025-12-01', 'accepted',
    'The Customer shall pay each undisputed invoice within sixty (60) days of receipt.',
    'Accepted only because the customer is a UK public sector body. Not acceptable for private-sector customers.'),
  p('pr-015', 'order-form', 'Fees and payment', 'Initrode LLC', '2025-04-17', 'rejected',
    'The Customer shall pay the Fees within sixty (60) days of the date of invoice.',
    'Rejected 60 days for a private-sector customer. Settled at 45 days.'),
  p('pr-016', 'order-form', 'Term and renewal', 'Soylent Corp', '2025-08-11', 'accepted',
    'Any increase in the Fees on renewal shall not exceed seven percent (7%) of the Fees for the preceding term.',
    'Accepted. A 7% cap is within the pricing fallback.'),
  p('pr-017', 'order-form', 'Term and renewal', 'Wayne Enterprises', '2026-05-06', 'rejected',
    'The Customer may terminate this Order Form for convenience on thirty (30) days\' written notice, in which case PortSwigger shall refund a pro-rata share of any prepaid Fees.',
    'Rejected termination for convenience with refund. Revenue recognition issue; Finance will not accept.'),
  p('pr-018', 'order-form', 'Term and renewal', 'Wayne Enterprises', '2026-05-06', 'rejected',
    'Fees shall remain fixed for the initial term and any renewal term and shall not increase by more than three percent (3%).',
    'Rejected a 3% cap. Agreed 7%.'),
  p('pr-019', 'order-form', 'Order of precedence', 'Hooli Inc.', '2025-06-12', 'rejected',
    'In the event of any conflict between this Order Form and the Terms, this Order Form shall prevail.',
    'Rejected. A general "Order Form prevails" clause lets special conditions override the Terms. Limited it to commercial details only.'),
  p('pr-020', 'order-form', 'Data protection', 'Tyrell Corporation', '2025-11-08', 'rejected',
    'The Customer may, on reasonable notice, conduct an on-site audit of the Supplier\'s premises and systems to verify compliance with this Order Form.',
    'Rejected on-site audit. Offered our SOC 2 report and security questionnaire responses instead.'),
  p('pr-021', 'order-form', 'Indemnity', 'Cyberdyne Systems', '2025-10-02', 'accepted',
    'PortSwigger shall defend the Customer against any claim that the Software infringes the intellectual property rights of a third party in the United Kingdom, the European Union or the United States.',
    'Accepted. Extending the IP indemnity to EU/US rights is within the fallback.'),
  p('pr-022', 'order-form', 'Indemnity', 'Soylent Corp', '2025-08-11', 'rejected',
    'The Supplier shall indemnify the Customer against all losses arising from any breach of this Agreement by the Supplier.',
    'Rejected general indemnity. IP indemnity only.')
]
