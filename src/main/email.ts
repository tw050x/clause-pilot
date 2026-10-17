import type { DocBlock, EmailDraft, ReviewSession } from '@shared/types'
import { beforeTheirs, changeSets, statusOf, type ChangeSet } from '@shared/changes'
import { labelOf } from '@shared/numbering'

/**
 * The cover email for a document review: one numbered point per change of
 * theirs we answered, and per edit or comment of ours elsewhere, each with our
 * comments as the reason. Their changes we accepted are acknowledged in a
 * line; changes flagged for internal review are left out.
 */
export function docEmail(s: ReviewSession, reviewer: string): EmailDraft {
  const d = s.doc!
  const name = s.docName.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ')
  const sets = changeSets(d)
  const inSet = new Map(sets.flatMap((set) => set.blocks.map((b) => [b.id, set] as const)))
  const notesFor = (ids: string[]) => d.comments.filter((c) => ids.includes(c.blockId)).map((c) => c.text)
  const whereOf = (b: DocBlock) => (labelOf(d, b) ? `Clause ${labelOf(d, b)!.replace(/\.$/, '')}` : b.ours ? 'A new paragraph' : b.label ? `Clause ${b.label.replace(/\.$/, '')}` : b.kind === 'row' ? b.text.split(' — ')[0] : `"${b.text.slice(0, 40)}…"`)

  const points: string[] = []
  const covered = new Set<string>()
  for (const set of sets) {
    const status = statusOf(d, set)
    if (status !== 'countered') continue
    const ids = set.blocks.map((b) => b.id)
    ids.forEach((id) => covered.add(id))
    const edited = set.blocks.filter((b) => d.edits[b.id] !== undefined)
    const removal = edited.length > 0 && edited.every((b) => d.edits[b.id] === '')
    const restored = edited.length > 0 && edited.every((b) => d.edits[b.id] === (b.kind === 'deleted' ? b.text : beforeTheirs(b)))
    const added = set.blocks.every((b) => !beforeTheirs(b))
    const ask = removal && added
      ? 'We can’t accept this addition and have struck it.'
      : restored
        ? 'We can’t accept this change and have restored the original wording.'
        : removal
          ? 'We ask for this to be removed.'
        : `We propose instead: "${edited.map((b) => d.edits[b.id]).join(' ')}"`
    points.push([`${whereOfSet(set)}`, ...notesFor(ids).map((n) => `   ${n}`), `   ${ask}`].join('\n'))
  }
  // Our own edits and comments outside their changes.
  for (const b of d.blocks) {
    if (covered.has(b.id)) continue
    const set = inSet.get(b.id)
    if (set && statusOf(d, set) === 'accepted') continue
    const edit = d.edits[b.id]
    const notes = notesFor([b.id])
    if (edit === undefined && !notes.length) continue
    const ask = edit === undefined ? '' : !edit.trim() ? (b.ours ? '' : 'We ask for this to be removed.') : b.ours ? `We propose adding a new ${labelOf(d, b) ? 'clause' : 'paragraph'}: "${edit.trim()}"` : `We propose: "${edit.trim()}"`
    if (b.ours && !edit?.trim() && !notes.length) continue
    points.push([whereOf(b), ...notes.map((n) => `   ${n}`), ask && `   ${ask}`].filter(Boolean).join('\n'))
  }
  const accepted = sets.filter((set) => statusOf(d, set) === 'accepted').length
  // Changes they made without Track Changes since our last draft: worth saying, politely.
  const silent = sets.filter((set) => set.blocks.some((b) => b.untracked === 'sent')).map(whereOfSet)
  const note = silent.length
    ? `\n\nOne more thing: ${silent.join(', ')} ${silent.length === 1 ? 'was' : 'were'} changed without being shown as tracked changes. Please make sure every change is tracked in the next draft so nothing is missed on either side.`
    : ''
  const numbered = points.map((p, i) => `${i + 1}. ${p}`).join('\n\n')
  const subject = points.length ? `${name}: PortSwigger comments` : `${name}: approved`
  const body = points.length
    ? `Hello,\n\nThank you for sending this through. We have reviewed the draft${accepted ? ' and accepted most of your changes' : ''}. Our changes are marked up as tracked changes in the attached copy, with comments explaining them. In summary:\n\n${numbered}${note}\n\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
    : `Hello,\n\nThank you for sending this through. We have reviewed the draft and are happy to proceed on it as it stands. Please send it for signature when ready.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
  return { subject, body, generatedBy: 'template' }

  function whereOfSet(set: ChangeSet) {
    return set.where.startsWith('§') ? `Clause ${set.where.slice(1)}` : set.where
  }
}
