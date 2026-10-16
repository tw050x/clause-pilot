import { injectionSpans } from '@shared/injection'

/** Clause text with any suspected prompt-injection sentences highlighted. */
export function Highlighted({ text }: { text: string }) {
  const spans = injectionSpans(text)
  if (!spans.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(text.slice(at, s.start))
    parts.push(
      <mark key={i} className="inj-hl" title="Looks like it is addressed to an AI reviewer">
        {text.slice(s.start, s.end)}
      </mark>
    )
    at = s.end
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}
