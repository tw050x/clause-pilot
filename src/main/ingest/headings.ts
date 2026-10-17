import type { ContractType } from '@shared/types'

export function isHeading(text: string): boolean {
  const words = text.split(/\s+/)
  if (words.length > 8) return false
  if (/[.;:]$/.test(text)) return false
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length > 0 && letters === letters.toUpperCase()
}

/** "2. Service", "4. Privacy & Security": a short, unpunctuated title after a top-level number is a section heading. */
export function isSectionTitle(number: string, text: string): boolean {
  return !number.includes('.') && text.split(/\s+/).length <= 6 && !/[.;:,]$/.test(text) && /^[A-Z]/.test(text)
}

export function guessContractType(lines: string[]): ContractType {
  const head = lines.slice(0, 12).join(' ').toLowerCase()
  if (/non-disclosure|confidentiality agreement|\bnda\b/.test(head)) return 'nda'
  if (/order form|licence|license|subscription/.test(head)) return 'order-form'
  return 'general'
}
