// Hand-authored answers for the AI meaning check in demo mode: does a paragraph that differs
// from our approved wording mean the same? Keyed by file, then the paragraph's printed number.
// scripts/build-demo.ts records them under the exact AI input, and fails if a paragraph the app
// would offer to check has no answer here.
import type { IntentOut } from '../../src/main/ai/tasks'

const same = (reasoning: string): Omit<IntentOut, 'best_match_id'> => ({
  aligned: true,
  confidence: 'high',
  material_differences: [],
  reasoning,
  injection_suspected: false,
  injection_notes: ''
})
const differs = (reasoning: string, differences: IntentOut['material_differences']): Omit<IntentOut, 'best_match_id'> => ({
  aligned: false,
  confidence: 'high',
  material_differences: differences,
  reasoning,
  injection_suspected: false,
  injection_notes: ''
})

export const AUTHORED_INTENT: Record<string, Record<string, Omit<IntentOut, 'best_match_id'>>> = {
  'Initech-Mutual-NDA.txt': {
    '2.2': same(
      'Both require the Recipient to protect the information with at least the care it gives its own confidential information, and never less than reasonable care. "Must" for "shall" and the reordering of the phrases do not change the obligation or who it binds.'
    )
  },
  'Acme-Mutual-NDA-redlined.docx': {
    '1.3': same(
      'The same four exclusions (public, already held, received from a free third party, independently developed) in different words. Nothing is added, removed or widened, and the burden stays on the Recipient.'
    ),
    '2.1': differs('Acme may also disclose to its Affiliates’ staff and advisers. That widens who can see our information.', [
      { description: 'Permitted disclosure extended to Affiliates’ employees, officers, advisers and subcontractors', favours: 'counterparty' }
    ]),
    '4.1': differs('Confidentiality obligations last five years after the agreement ends instead of three.', [
      { description: 'Survival period five years instead of three', favours: 'neutral' }
    ]),
    '6.8': differs('Governing law changed from England and Wales to the State of New York.', [{ description: 'New York law instead of English law', favours: 'counterparty' }]),
    '6.9': differs('Exclusive jurisdiction moved from the English courts to the courts of New York County.', [
      { description: 'New York courts instead of the English courts', favours: 'counterparty' }
    ])
  },
  'Globex-Order-Form-Burp-Suite-DAST.pdf': {
    '1.1': differs('The order of precedence is reversed: the Order Form prevails over our Licence Terms in every conflict.', [
      { description: 'Order Form prevails over the Licence Terms', favours: 'counterparty' }
    ]),
    '4.1': differs('Payment is due within 60 days of invoice instead of 30.', [{ description: 'Payment terms 60 days instead of 30', favours: 'counterparty' }]),
    '8.1': same(
      'Still a UK intellectual property indemnity only, subject to prompt notice, sole control of the defence and reasonable assistance. "Will" for "shall" and the reordering do not change the scope, the conditions or the remedy.'
    )
  },
  'Acme-Mutual-NDA-v2.docx': {
    '6.9': differs('Exclusive jurisdiction is with the courts of New York County, not the English courts we proposed.', [
      { description: 'New York courts instead of the English courts', favours: 'counterparty' }
    ])
  }
}
