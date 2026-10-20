import type { DocBlock, DocReview } from '@shared/types'
import { aiSame, changeKey, hasOpenChanges, isCleared, marksFor, needsReading, segmentsOf, shownText, theyChanged } from '@shared/changes'

/**
 * Where a paragraph stands, as its bar beside it shows it. Shared by the document views (the Word
 * layout and the text view), so both draw the same bars and gutter labels.
 */

/** A paragraph's state as its bar shows it, labelled in the left gutter once per run. */
export type GutterState = 'unchanged' | 'checked' | 'same' | 'decide' | 'edited' | 'read' | 'injection'

export const GUTTER: Record<GutterState, { label: string; tip: string }> = {
  unchanged: { label: 'Unchanged', tip: 'Reads exactly as our approved wording, or as we last sent it. Nothing to check.' },
  checked: { label: 'Checked', tip: 'Nothing left to check: their changes here are decided, or a reviewer marked it as checked.' },
  same: { label: 'Same intent', tip: 'The AI found it means the same as our approved wording. It only advises: decide it yourself.' },
  decide: { label: 'To decide', tip: 'Their changes, tracked or found by comparison: accept or reject them.' },
  edited: { label: 'Edited', tip: 'Your edits: they go to them as tracked changes in the marked-up copy.' },
  read: { label: 'To read', tip: 'Not our wording and nothing to accept or reject: read it, then mark it as checked.' },
  injection: { label: 'AI instructions', tip: 'Text addressed to an AI reviewer was found here (it may be hidden on the page). See Security.' }
}

const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

/** The paragraph as it reads with none of our wording: what an edit is measured against. */
export const plainText = (d: DocReview, b: DocBlock) => shownText(marksFor({ ...d, edits: {} }, b))

export interface ParagraphState {
  /** The bar's classes: chg-theirs, chg-ours, chg-checked, chg-read, chg-ai, chg-untracked. */
  bar: string
  /** The gutter label for it, if any. */
  state: GutterState | null
  /** Nothing left to show: their deletion accepted, or their inserted paragraph rejected. */
  gone: boolean
}

/**
 * A paragraph's bar and label. `text` is the paragraph as it now reads, `marks` how many redline
 * marks it shows, and `plain` the paragraph with none of our wording (see plainText).
 */
export function paragraphState(d: DocReview, b: DocBlock, text: string, marks: number, plain: string): ParagraphState {
  const open = hasOpenChanges(d, b)
  // Their changes here have all been decided: checked.
  const decided = !open && theyChanged(b) && segmentsOf(b).some((x, i) => x.op !== 'same' && d.resolved?.[changeKey(b.id, i)])
  const edited = !!b.ours || tidy(text) !== tidy(plain)
  const gone = !b.ours && (b.kind === 'deleted' || theyChanged(b)) && !marks && !text
  // Nothing to look at: its changes all decided, or (untouched) it's our approved wording
  // word for word, or exactly what we sent last round.
  const checked = !open && !edited && (decided || isCleared(d, b))
  // The AI found it means the same as our approved wording: dashed green until you decide it.
  // (Their paper: a paragraph to read that the AI found means the same as one of ours, too.)
  const reading = needsReading(d, b)
  // Their changes still to decide show over our edits (the bar's stripes say there's something to
  // do, and the label says what): an edited paragraph is "Edited" once nothing of theirs is open.
  const bar = `${(open || reading) && !edited && aiSame(d, b) ? 'chg-ai' : open ? 'chg-theirs' : reading && !edited ? 'chg-read' : ''} ${edited && !open ? 'chg-ours' : checked ? 'chg-checked' : ''} ${b.untracked && open ? 'chg-untracked' : ''}`
    .replace(/\s+/g, ' ')
    .trim()
  // Exactly our approved wording, or exactly what we sent last round: "Unchanged".
  // (Not one a reviewer marked as checked: that's a judgement, not a match.)
  const exact = !open && !edited && !gone && b.kind !== 'deleted' && !b.ours && !theyChanged(b) && (!!b.approved || (d.baseline?.kind === 'sent' && !!d.lastRound?.[b.id]))
  // The label for its bar (as the bar: their changes to decide, then your edits).
  const state: GutterState | null = gone
    ? null
    : bar.includes('chg-ours')
      ? 'edited'
      : bar.includes('chg-ai')
        ? 'same'
        : bar.includes('chg-theirs')
          ? 'decide'
          : bar.includes('chg-read')
            ? 'read'
            : exact
              ? 'unchanged'
              : bar.includes('chg-checked')
                ? 'checked'
                : null
  return { bar, state, gone }
}
