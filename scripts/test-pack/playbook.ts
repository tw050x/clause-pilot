// PortSwigger's standard positions (the playbook) for the test pack. `npm run test-pack` writes test-pack/playbook.json (import it on the Playbook page).
import type { PlaybookPosition } from '../../src/shared/types'

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
