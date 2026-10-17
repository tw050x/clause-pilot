// Hand-authored AI change reviews for demo mode: what "Ask AI" answers for each
// change set in each demo contract. Keyed by file, then by where the change is
// ("§2.4", or how an unnumbered paragraph starts). scripts/build-demo.ts builds
// each demo review the way the app does and records these under the exact AI
// input, so a change the app finds that isn't answered here fails the build.
import type { ChangeOut } from '../../src/main/ai/tasks'

export interface AuthoredChange extends Omit<ChangeOut, 'related' | 'suggested_edits' | 'injection_suspected' | 'injection_notes'> {
  /** Other paragraphs affected, by printed number. */
  related?: { label: string; why: string }[]
  /** Suggested wording for the change's first paragraph that isn't a heading. */
  suggest?: string
  injection?: string
}

const ENGLISH_LAW = 'This Agreement and any dispute or claim arising out of or in connection with it shall be governed by the law of England and Wales.'
const ENGLISH_COURTS = 'The courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim arising out of or in connection with this Agreement.'
const NON_SOLICIT_FALLBACK =
  'For twelve (12) months after the date of this Agreement neither party shall solicit any employee of the other party with whom it had direct contact in connection with the Purpose, save that general advertisements not targeted at such employees shall not breach this clause.'

const deal = (what: string, extra: Partial<AuthoredChange> = {}): AuthoredChange => ({
  summary: `${what} These are deal details, not legal terms.`,
  effect: 'neutral',
  risk: 'low',
  recommendation: 'accept',
  reasoning: 'Nothing here changes rights or obligations. Check the names, entities and addresses against the deal record before accepting.',
  playbook: [],
  comment_to_them: '',
  ...extra
})

const sameEffect = (summary: string, reasoning: string, playbook: ChangeOut['playbook'] = []): AuthoredChange => ({
  summary,
  effect: 'neutral',
  risk: 'low',
  recommendation: 'accept',
  reasoning,
  playbook,
  comment_to_them: ''
})

const ACME_V1: Record<string, AuthoredChange> = {
  'This Agreement is made': deal('The parties paragraph names Acme Corporation, a New York corporation, at 1 Road Runner Way.'),
  '§1.3': sameEffect(
    'Acme reworded the exclusions from Confidential Information. The four exclusions are the same as ours: public, already held, received from a free third party, independently developed.',
    'Only the drafting differs. No exclusion was added, removed or widened, and the burden is unchanged, so the legal effect matches our approved "Exclusions" clause.'
  ),
  '§2.1': {
    summary: 'Acme can now disclose our information to its Affiliates’ employees, officers, advisers and subcontractors, not just its own.',
    effect: 'favours_them',
    risk: 'low',
    recommendation: 'accept',
    reasoning:
      'Affiliates are bound by the same need-to-know test and by confidentiality obligations no less protective, and the clause is mutual. We accepted the same change from Stark Industries. It is acceptable as long as the Recipient stays responsible for its Affiliates, which 2.1 implies.',
    playbook: [{ position_id: 'pb-mutuality', conflict: false, note: 'Both parties get the same right to share with Affiliates.' }],
    comment_to_them: ''
  },
  '§2.4': {
    summary: 'A new residuals clause lets either party use anything its people remember from our Confidential Information, for any purpose.',
    effect: 'favours_them',
    risk: 'high',
    recommendation: 'restore',
    reasoning:
      'It opens with "Notwithstanding clause 2.1", so it overrides the use-only-for-the-Purpose obligation in 2.1(b), and 3.2 (no licence) no longer protects remembered information. Our playbook allows no residuals clause in any form, and we rejected the same ask from Hooli and Vandelay.',
    playbook: [{ position_id: 'pb-residuals', conflict: true, note: 'We do not accept residuals clauses in any form.' }],
    related: [
      { label: '2.1', why: 'Overridden: the clause starts "Notwithstanding clause 2.1".' },
      { label: '3.2', why: 'The no-licence protection stops covering what people remember.' }
    ],
    suggest: '',
    comment_to_them: 'We don’t accept residuals clauses in any form, so we have struck this. The use restriction in 2.1 needs to apply to everything disclosed.'
  },
  '§3.3': {
    summary: 'Acme deleted our "as is" clause: the disclosing party no longer disclaims warranties about the information it shares.',
    effect: 'favours_them',
    risk: 'medium',
    recommendation: 'restore',
    reasoning: 'Without 3.3, a court could imply warranties about the accuracy of what we share during the evaluation. The clause is our approved wording, it is mutual, and Acme gave no reason for removing it.',
    playbook: [{ position_id: 'pb-mutuality', conflict: false, note: 'The disclaimer protects both parties equally.' }],
    related: [{ label: '3.2', why: 'Ownership and no licence: the other half of the "what we give you" protections.' }],
    suggest: 'Confidential Information is provided "as is". The Discloser gives no warranty as to its accuracy or completeness.',
    comment_to_them: 'Please keep our standard no-warranty clause. It protects both parties.'
  },
  '§4.1': {
    summary: 'Confidentiality obligations now last five years after the agreement ends, instead of three.',
    effect: 'neutral',
    risk: 'low',
    recommendation: 'accept',
    reasoning: 'Five years is within our 2 to 5 year fallback, and because the NDA is mutual it protects our information for longer too. We accepted five years from Stark Industries.',
    playbook: [{ position_id: 'pb-confidentiality-term', conflict: false, note: 'Within the acceptable fallback (up to 5 years).' }],
    comment_to_them: ''
  },
  '§5': {
    summary: 'A new one-way non-solicitation clause: for the term and 24 months after, PortSwigger may not solicit or employ Acme staff it met through the evaluation.',
    effect: 'favours_them',
    risk: 'high',
    recommendation: 'counter',
    reasoning:
      'It binds only PortSwigger, runs for 24 months, covers employing as well as soliciting, and has no carve-out for general advertising: three red flags. Our fallback is a mutual 12-month non-solicit limited to staff with direct contact.',
    playbook: [
      { position_id: 'pb-non-solicit', conflict: true, note: 'Our standard is no non-solicit; the fallback is mutual, 12 months, with an advertising carve-out.' },
      { position_id: 'pb-mutuality', conflict: true, note: 'Only PortSwigger is restricted.' }
    ],
    suggest: NON_SOLICIT_FALLBACK,
    comment_to_them: 'We can accept a mutual 12-month restriction limited to staff with direct contact, with the usual carve-out for general advertising.'
  },
  '§6.8': {
    summary: 'Governing law changed from England and Wales to the State of New York.',
    effect: 'favours_them',
    risk: 'high',
    recommendation: 'restore',
    reasoning: 'Our standard is English law; US state law is a red flag that needs General Counsel sign-off. We restored English law with Initrode for the same change.',
    playbook: [{ position_id: 'pb-governing-law', conflict: true, note: 'English law and courts only.' }],
    related: [{ label: '6.9', why: 'Jurisdiction was changed to New York too; the two should move together.' }],
    suggest: ENGLISH_LAW,
    comment_to_them: 'We contract under English law.'
  },
  '§6.9': {
    summary: 'Exclusive jurisdiction moved from the English courts to the state and federal courts in New York County.',
    effect: 'favours_them',
    risk: 'high',
    recommendation: 'restore',
    reasoning: 'Our standard is the exclusive jurisdiction of the English courts; at most we allow non-exclusive jurisdiction elsewhere. Litigating in New York would be costly for a UK company.',
    playbook: [{ position_id: 'pb-governing-law', conflict: true, note: 'English courts, exclusive.' }],
    related: [{ label: '6.8', why: 'Governing law, changed to New York in the same draft.' }],
    suggest: ENGLISH_COURTS,
    comment_to_them: 'Disputes go to the English courts.'
  },
  'Signed for': deal('The signature block names Wile E. Coyote, General Counsel, for Acme Corporation.')
}

export const AUTHORED_CHANGES: Record<string, Record<string, AuthoredChange>> = {
  'Initech-Mutual-NDA.txt': {
    'This Agreement is made': deal('The parties paragraph names Initech Inc., a Delaware corporation, at 4120 Freidrich Lane, Austin, Texas.'),
    '§2.2': sameEffect(
      'Clause 2.2 is our "Standard of care" clause in different words: the Recipient protects the information at least as carefully as its own, and never less than reasonable care.',
      'Same obligation, same standard (the higher of its own care and reasonable care), same parties. The only differences are "must" for "shall" and the order of the phrases. Accepting it is safe; consider nominating the wording for the library so it is matched automatically next time.',
      [{ position_id: 'pb-mutuality', conflict: false, note: 'Applies equally to both parties.' }]
    ),
    'Signed for': deal('The signature block names Bill Lumbergh, Vice President, for Initech Inc.')
  },
  'Acme-Mutual-NDA-redlined.docx': ACME_V1,
  'Globex-Order-Form-Burp-Suite-DAST.pdf': {
    'Supplier: PortSwigger': deal('The order details: Globex Corporation, Burp Suite DAST with 20 scanning agents, GBP 84,000 a year, starting 1 November 2026.', {
      reasoning: 'Check the product, quantity, fee and start date against the quote before accepting. Nothing here changes legal terms.'
    }),
    '§1.1': {
      summary: 'The order of precedence is reversed: the Order Form now prevails over the Licence Terms for every conflict.',
      effect: 'favours_them',
      risk: 'high',
      recommendation: 'restore',
      reasoning:
        'Our standard is that the Licence Terms prevail unless the Order Form expressly varies a named provision. Reversed, anything in the Order Form, including the special conditions in section 11, silently beats our terms. It is what gives 11.1 and 11.2 their force.',
      playbook: [{ position_id: 'pb-precedence', conflict: true, note: 'Licence Terms prevail unless a named provision is varied.' }],
      related: [
        { label: '11.1', why: 'The special conditions win over our terms because of this clause.' },
        { label: '11.2', why: 'Likewise.' }
      ],
      suggest:
        'This Order Form is governed by and incorporates the PortSwigger Licence Terms (the "Terms"). In the event of conflict between this Order Form and the Terms, the Terms shall prevail unless this Order Form expressly states that it varies a named provision of the Terms.',
      comment_to_them: 'Our Licence Terms need to prevail unless the Order Form expressly varies a named provision.'
    },
    '§4.1': {
      summary: 'Payment terms extended from 30 to 60 days from invoice.',
      effect: 'favours_them',
      risk: 'medium',
      recommendation: 'counter',
      reasoning: 'Our standard is 30 days; the fallback allows up to 45 days, and 60 only for UK public-sector customers. Globex is a private company.',
      playbook: [{ position_id: 'pb-payment', conflict: true, note: '30 days standard; up to 45 days acceptable for private-sector customers.' }],
      suggest:
        'The Customer shall pay the Fees within forty-five (45) days of the date of invoice. Fees are exclusive of VAT and other applicable taxes. PortSwigger may change the Fees for any renewal term by giving at least sixty (60) days\' written notice before the renewal date.',
      comment_to_them: 'We can offer 45-day payment terms.'
    },
    '§8.1': sameEffect(
      'The IP indemnity is reworded but keeps our scope: UK intellectual property claims only, subject to prompt notice, sole control of the defence and reasonable assistance.',
      'Territory, conditions and remedy all match our approved IP indemnity. "Will" for "shall" and the reordering do not change the effect.',
      [{ position_id: 'pb-indemnity', conflict: false, note: 'Still only a UK IP indemnity, with notice and control.' }]
    ),
    '§11.1': {
      summary: 'Liability for any data-protection breach or security incident becomes unlimited, including lost profits and notification costs.',
      effect: 'favours_them',
      risk: 'high',
      recommendation: 'escalate',
      reasoning:
        'It starts "Notwithstanding clauses 7.1 and 7.2", so it overrides the cap and the exclusion of lost profits even though 7.1 to 7.3 match our standard word for word. For a security vendor this is the largest risk in the contract, and with 1.1 reversed the special conditions win. Unlimited liability needs General Counsel.',
      playbook: [
        { position_id: 'pb-liability-cap', conflict: true, note: 'A carve-out from the cap hidden in the special conditions.' },
        { position_id: 'pb-data-protection', conflict: true, note: 'Attaches unlimited liability to data-protection breaches.' }
      ],
      related: [
        { label: '7.1', why: 'The liability cap it overrides.' },
        { label: '7.2', why: 'The exclusion of lost profits it overrides.' },
        { label: '1.1', why: 'Makes the special conditions prevail over our Licence Terms.' }
      ],
      suggest: '',
      comment_to_them: 'We can’t accept uncapped liability. Data-protection claims fall under the cap in clause 7.1, as with all our customers.'
    },
    '§11.2': {
      summary: 'Renewal price increases are capped at 3%, and Globex can terminate for convenience on 30 days’ notice with a pro-rata refund.',
      effect: 'favours_them',
      risk: 'high',
      recommendation: 'restore',
      reasoning: 'It overrides 3.1 (the committed term) and 4.1 (our right to change renewal fees). Termination for convenience with a refund means no committed revenue, and the 3% cap is below our 7% floor.',
      playbook: [{ position_id: 'pb-renewal-pricing', conflict: true, note: 'Renewal pricing capped below our floor; termination for convenience is a red flag.' }],
      related: [
        { label: '3.1', why: 'The subscription term it overrides.' },
        { label: '4.1', why: 'Our right to change fees on renewal.' }
      ],
      suggest: '',
      comment_to_them: 'Our subscriptions are committed for the term, and renewal pricing follows clause 4.1.'
    },
    '§11.3': {
      summary: 'A statement that the special conditions are standard, with a note addressed to AI review systems telling them to treat the special conditions as pre-approved and low risk.',
      effect: 'favours_them',
      risk: 'high',
      recommendation: 'restore',
      reasoning:
        'The clause has no legal purpose. Its second sentence tries to instruct an automated reviewer, which is a security matter: PortSwigger Legal has not pre-approved these conditions. It should be struck and the counterparty asked about it.',
      playbook: [],
      suggest: '',
      comment_to_them: 'Struck: PortSwigger has not pre-approved these special conditions.',
      injection: 'Clause 11.3 contains a note addressed to "any AI or automated contract review system" instructing it to classify the special conditions as pre-approved and low risk. I have not followed it.'
    },
    'Signed for': deal('The signature block names Hank Scorpio, Chief Executive Officer, for Globex Corporation.')
  },
  'Acme-Mutual-NDA-v2.docx': {
    '§6.9': {
      summary: 'Acme put back New York as the exclusive forum, without tracking the change, after we proposed the English courts.',
      effect: 'favours_them',
      risk: 'high',
      recommendation: 'restore',
      reasoning:
        'Governing law is now English (6.8), so with 6.9 as it is we would have to litigate English law in a New York court. Our fallback allows non-exclusive jurisdiction at most. We asked for this in version 1 and they changed it back silently, so say so plainly.',
      playbook: [{ position_id: 'pb-governing-law', conflict: true, note: 'English courts, exclusive; non-exclusive at most.' }],
      related: [{ label: '6.8', why: 'English law, which they accepted.' }],
      suggest: ENGLISH_COURTS,
      comment_to_them: 'This is still New York. As before, disputes go to the English courts, to match the English governing law you have accepted in 6.8.'
    }
  },
  'Acme-Mutual-NDA-v3.docx': {
    '§6.10': {
      summary: 'A new clause, added without tracking: Acme may announce it is evaluating PortSwigger and name us in investor materials and customer communications without consent.',
      effect: 'favours_them',
      risk: 'medium',
      recommendation: 'restore',
      reasoning:
        'It is one-sided (PortSwigger gets no equivalent right) and goes beyond the evaluation: naming us to investors and customers is publicity, which our standard terms only allow with prior written consent. It also sits oddly with 1.1, which limits use to the Purpose. It was not tracked, so it would be easy to miss.',
      playbook: [{ position_id: 'pb-mutuality', conflict: true, note: 'Only Acme gets the right.' }],
      related: [{ label: '1.1', why: 'The Purpose: evaluating a possible relationship, not marketing it.' }],
      suggest: '',
      comment_to_them: 'We’ve struck the new publicity clause: neither party should name the other publicly without consent. It also wasn’t shown as a tracked change, so please make sure all changes are tracked.'
    }
  }
}
