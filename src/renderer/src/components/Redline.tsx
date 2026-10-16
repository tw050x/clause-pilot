import type { TrackedSegment } from '@shared/types'

/** A Word redline: their insertions underlined, their deletions struck through. */
export function Redline({ segments }: { segments: TrackedSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.op === 'same' ? (
          <span key={i}>{s.text}</span>
        ) : s.op === 'ins' ? (
          <ins key={i} className="rl-ins" title={by(s, 'Inserted')}>
            {s.text}
          </ins>
        ) : (
          <del key={i} className="rl-del" title={by(s, 'Deleted')}>
            {s.text}
          </del>
        )
      )}
    </>
  )
}

const by = (s: TrackedSegment, what: string) => `${what}${s.author ? ` by ${s.author}` : ''}${s.date ? `, ${new Date(s.date).toLocaleDateString()}` : ''}`
