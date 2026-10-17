import type { DocBlock, EmailDraft, ReviewSession } from '@shared/types'
import { changeKey, marksFor, segmentsOf, shownText } from '@shared/changes'
import { labelOf } from '@shared/numbering'

/**
 * The cover email for a document review, built from what was done in the document: one
 * numbered point per paragraph where we rejected changes of theirs, edited, added or
 * commented, in document order, with our comments as the reasons. Their changes we
 * accepted are acknowledged in a line.
 */
export function docEmail(s: ReviewSession, reviewer: string): EmailDraft {
  const d = s.doc!
  const name = s.docName.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ')
  // Where a point is: how the paragraph starts (works for any format), with its printed
  // number in front when it has one. No page numbers: Word paginates differently everywhere.
  const whereOf = (b: DocBlock) => {
    const text = (b.ours ? (d.edits[b.id] ?? '') : b.text).replace(/\s+/g, ' ').trim()
    const words = text.split(' ')
    const opening = words.length > 7 ? `${words.slice(0, 7).join(' ')}…` : text
    const l = labelOf(d, b)?.replace(/\.$/, '')
    const num = l ? (/^\d/.test(l) ? `clause ${l}` : `item ${l}`) : ''
    if (b.ours) return `${num ? `New ${num}` : 'A new paragraph'}${opening ? ` ("${opening}")` : ''}`
    if (num) return `${num.charAt(0).toUpperCase()}${num.slice(1)} ("${opening}")`
    return `The paragraph beginning "${opening}"`
  }
  const quote = (t: string) => {
    const x = t.replace(/\s+/g, ' ').trim()
    return `"${x.length > 120 ? `${x.slice(0, 120).trimEnd()}…` : x}"`
  }
  const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

  const points: string[] = []
  const acceptedIn: string[] = []
  for (const b of d.blocks) {
    const segs = segmentsOf(b)
    const decided = (outcome: 'accepted' | 'rejected') =>
      segs.map((x, i) => ({ x, r: d.resolved?.[changeKey(b.id, i)] })).filter((y) => y.r === outcome && y.x.op !== 'same').map((y) => y.x)
    const rejected = decided('rejected')
    const accepted = decided('accepted')
    const notes = d.comments.filter((c) => c.blockId === b.id).map((c) => c.text)
    const edit = d.edits[b.id]
    // Wording of ours beyond what rejecting their changes already says.
    const plain = shownText(marksFor({ ...d, edits: {} }, b))
    const ourWording = edit !== undefined && edit.replace(/\s+/g, ' ').trim() !== plain.replace(/\s+/g, ' ').trim() ? edit : undefined

    const lines: string[] = []
    if (rejected.length) {
      const what = rejected.map((x) => `your ${x.op === 'ins' ? 'insertion of' : 'deletion of'} ${quote(x.text)}`)
      lines.push(`We can't accept ${list(what)}, so ${rejected.length === 1 ? 'it has' : 'they have'} been rejected.`)
    }
    if (rejected.length && accepted.length) lines.push(`We accept your other ${accepted.length === 1 ? 'change' : 'changes'} here.`)
    if (b.ours && ourWording?.trim()) lines.push(`We propose adding a new ${labelOf(d, b) ? 'clause' : 'paragraph'}: ${quote(ourWording)}`)
    else if (ourWording !== undefined && !ourWording.trim()) lines.push(b.kind === 'deleted' ? '' : 'We ask for this to be removed.')
    else if (ourWording !== undefined && b.kind === 'deleted') lines.push('We have reinstated this paragraph.')
    else if (ourWording !== undefined) lines.push(`We propose: ${quote(ourWording)}`)
    lines.push(...notes)
    const body = lines.filter(Boolean)
    if (body.length) points.push([whereOf(b), ...body.map((l) => `   ${l}`)].join('\n'))
    else if (accepted.length) acceptedIn.push(labelOf(d, b) ? labelOf(d, b)!.replace(/\.$/, '') : whereOf(b))
  }

  // Changes they made without Track Changes since our last draft: worth saying, politely.
  const silent = d.blocks.filter((b) => b.untracked === 'sent').map((b) => whereOf(b).replace(/^The paragraph/, 'the paragraph'))
  const note = silent.length
    ? `\n\nOne more thing: ${list(silent)} ${silent.length === 1 ? 'was' : 'were'} changed without being shown as tracked changes. Please make sure every change is tracked in the next draft so nothing is missed on either side.`
    : ''
  const acceptedLine = acceptedIn.length
    ? `We have accepted your changes to ${acceptedIn.every((x) => /^\d/.test(x)) ? `${acceptedIn.length === 1 ? 'clause' : 'clauses'} ` : ''}${list(acceptedIn)}.`
    : ''
  const numbered = points.map((p, i) => `${i + 1}. ${p}`).join('\n\n')
  const subject = points.length ? `${name}: PortSwigger comments` : `${name}: approved`
  const body = points.length
    ? `Hello,\n\nThank you for sending this through. We have reviewed the draft. ${acceptedLine ? `${acceptedLine} ` : ''}Our changes are marked up as tracked changes in the attached copy, with comments explaining them. In summary:\n\n${numbered}${note}\n\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
    : `Hello,\n\nThank you for sending this through. We have reviewed the draft${acceptedLine ? ` and accepted your changes` : ''} and are happy to proceed on it as it stands. Please send it for signature when ready.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
  return { subject, body, generatedBy: 'template' }
}
