import type { DocBlock, DocReview, TrackedSegment } from '@shared/types'
import { marksFor, segmentsOf, shownText, theyChanged } from '@shared/changes'
import { diffSegments } from '@shared/diff'

/** One step in how a paragraph came to read as it does, with only that step's changes marked. */
export interface Stage {
  key: 'original' | 'theirs' | 'yours'
  name: string
  /** What it says about the step ("Brightwater Legal's tracked changes"). */
  detail: string
  segments: TrackedSegment[]
}

const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

/**
 * A paragraph too layered to read in one view (their changes and yours on top, or a great many
 * changes): its stages, so they can be read one at a time. Null for any other paragraph.
 */
export function stagesOf(d: DocReview, b: DocBlock): Stage[] | null {
  if (b.ours || b.kind === 'deleted' || b.kind === 'heading' || b.kind === 'row' || !theyChanged(b)) return null
  const segs = segmentsOf(b)
  const original = segs.filter((s) => s.op !== 'ins').map((s) => s.text).join('')
  const proposed = segs.filter((s) => s.op !== 'del').map((s) => s.text).join('')
  const now = shownText(marksFor(d, b))
  const changes = marksFor(d, b).filter((m) => m.theirs || m.ours).length
  const yoursChanged = tidy(now) !== tidy(proposed)
  if (!(yoursChanged && d.edits[b.id] !== undefined) && changes < 8) return null
  const authors = [...new Set(segs.filter((s) => s.op !== 'same').map((s) => s.author).filter(Boolean))]
  const first =
    b.untracked === 'template'
      ? { name: 'Our approved wording', detail: b.standard ? `Our approved “${b.standard}”` : 'Our standard wording' }
      : b.untracked === 'sent'
        ? { name: 'What we sent', detail: 'As we sent it last round' }
        : { name: 'Before their changes', detail: 'The paragraph without their tracked changes' }
  return [
    { key: 'original', ...first, segments: [{ op: 'same', text: original }] },
    {
      key: 'theirs',
      name: 'Their changes',
      detail: b.untracked ? `What ${authors[0] ?? 'they'} changed (found by comparison)` : `${authors.join(', ') || 'Their'} tracked changes`,
      segments: segs
    },
    {
      key: 'yours',
      name: 'Your changes',
      detail: yoursChanged ? 'Your decisions and edits, on their version' : 'No changes of yours',
      segments: diffSegments(proposed, now)
    }
  ]
}
