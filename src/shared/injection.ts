/**
 * Local, deterministic screen for text that looks like it is addressed to an AI
 * system rather than to the other party. It runs before any model sees the
 * contract and is independent of the model, so a successful injection cannot
 * also suppress its own warning. Shared so the UI can highlight exactly what matched.
 */
const PATTERNS: { label: string; re: RegExp }[] = [
  {
    label: 'Addresses an AI / automated reviewer',
    re: /\b(note to|attention|instructions? (to|for))\b.{0,40}\b(AI|automated|reviewer|model|system)\b|\b(AI|LLM|language model|automated (review|reviewer|system))\b.{0,80}\b(you|please|must|should)\b/i
  },
  { label: 'Instruction-override phrasing', re: /\b(ignore|disregard|override|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instruction|prompt|rule|guidance)s?/i },
  { label: 'Asserts pre-approval', re: /\b(pre-?approved|already approved|has been approved by)\b.{0,60}\b(legal|portswigger|counsel)\b/i },
  { label: 'Asks for classification outcome', re: /\b(classify|mark|treat|report)\b.{0,60}\b(as )?(standard|compliant|approved|acceptable|low risk)\b/i },
  { label: 'Hidden-text markers', re: /[​-‏⁠﻿]/ }
]

export function injectionHits(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label)
}

/**
 * Character ranges to highlight: each match widened to its whole sentence, so the
 * reviewer sees the instruction in context. Overlapping ranges are merged.
 */
export function injectionSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')
    for (const m of text.matchAll(re)) {
      let start = m.index ?? 0
      let end = start + m[0].length
      while (start > 0 && !/[.;:]\s/.test(text.slice(start - 2, start))) start--
      const stop = text.slice(end).search(/[.;](\s|$)/)
      end = stop === -1 ? text.length : end + stop + 1
      spans.push({ start, end })
    }
  }
  spans.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  return merged
}
