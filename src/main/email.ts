import type { DocBlock, EmailDraft, ReviewSession } from '@shared/types'
import { changeGroups, changeKey, commentResolved, marksFor, segmentsOf, shownText } from '@shared/changes'
import { labelOf } from '@shared/numbering'
import { wordDiff } from './engine/text'

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
    const num = l ? (/^\d/.test(l) ? `clause ${l}` : /^[A-Z][a-z]+ \d/.test(l) ? l : `item ${l}`) : ''
    if (b.ours) return `${num ? `New ${num}` : 'A new paragraph'}${opening ? ` ("${opening}")` : ''}`
    if (num) return `${num.charAt(0).toUpperCase()}${num.slice(1)} ("${opening}")`
    return `The paragraph beginning "${opening}"`
  }
  const quote = (t: string) => {
    const x = t.replace(/\s+/g, ' ').trim()
    return `"${x.length > 120 ? `${x.slice(0, 120).trimEnd()}…` : x}"`
  }
  /**
   * Our wording for a paragraph: the words we changed, when that's a few edits in a long
   * paragraph (a quote cut short would hide them), otherwise the whole wording.
   */
  const proposal = (from: string, to: string) => {
    // Whole words, so a quote never stops half way through one ("four (4" for "four (4)").
    const segs = wordDiff(from, to)
    const edits: string[] = []
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.op === 'same') continue
      const next = segs[i + 1]
      if (s.op === 'del' && next?.op === 'add') {
        edits.push(`${quote(next.text)} in place of ${quote(s.text)}`)
        i++
      } else edits.push(s.op === 'add' ? `adding ${quote(s.text)}` : `removing ${quote(s.text)}`)
    }
    const changed = segs.filter((s) => s.op !== 'same').reduce((n, s) => n + s.text.length, 0)
    if (to.length > 120 && edits.length && edits.length <= 3 && changed < to.length / 3) return `We propose ${list(edits)}.`
    return `We propose: ${quote(to)}`
  }
  const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

  const points: string[] = []
  const acceptedIn: string[] = []
  for (const b of d.blocks) {
    const segs = segmentsOf(b)
    // Their changes as the reader sees them: a replacement (deletion + insertion) is one change.
    const decided = (outcome: 'accepted' | 'rejected') => changeGroups(b).filter((g) => d.resolved?.[changeKey(b.id, g[0])] === outcome).map((g) => g.map((i) => segs[i]))
    const rejected = decided('rejected')
    const accepted = decided('accepted')
    // Our comments as the reasons; ones we've resolved are settled, so they're left out.
    const notes = d.comments.filter((c) => c.blockId === b.id && !commentResolved(d, c)).map((c) => c.text)
    const edit = d.edits[b.id]
    // Wording of ours beyond what rejecting their changes already says.
    const plain = shownText(marksFor({ ...d, edits: {} }, b))
    const ourWording = edit !== undefined && edit.replace(/\s+/g, ' ').trim() !== plain.replace(/\s+/g, ' ').trim() ? edit : undefined

    const lines: string[] = []
    if (rejected.length) {
      const what = rejected.map((g) => {
        const del = g.find((x) => x.op === 'del')
        const ins = g.find((x) => x.op === 'ins')
        if (del && ins) return `your change of ${quote(del.text)} to ${quote(ins.text)}`
        return ins ? `your insertion of ${quote(ins.text)}` : `your deletion of ${quote(del!.text)}`
      })
      lines.push(`We can't accept ${list(what)}, so ${rejected.length === 1 ? 'it has' : 'they have'} been rejected.`)
    }
    if (rejected.length && accepted.length) lines.push(`We accept your other ${accepted.length === 1 ? 'change' : 'changes'} here.`)
    if (b.ours && ourWording?.trim()) lines.push(`We propose adding a new ${labelOf(d, b) ? 'clause' : 'paragraph'}: ${quote(ourWording)}`)
    else if (ourWording !== undefined && !ourWording.trim()) lines.push(b.kind === 'deleted' ? '' : 'We ask for this to be removed.')
    else if (ourWording !== undefined && b.kind === 'deleted') lines.push('We have reinstated this paragraph.')
    else if (ourWording !== undefined) lines.push(proposal(plain, ourWording))
    lines.push(...notes)
    const body = lines.filter(Boolean)
    if (body.length) points.push([whereOf(b), ...body.map((l) => `   ${l}`)].join('\n'))
    else if (accepted.length) acceptedIn.push(labelOf(d, b) ? labelOf(d, b)!.replace(/\.$/, '') : whereOf(b).replace(/^The paragraph/, 'the paragraph'))
  }

  // Changes they made without Track Changes since our last draft: worth saying, politely.
  const silent = d.blocks.filter((b) => b.untracked === 'sent').map((b) => whereOf(b).replace(/^The paragraph/, 'the paragraph'))
  const note = silent.length
    ? `\n\nOne more thing: ${list(silent)} ${silent.length === 1 ? 'was' : 'were'} changed without being shown as tracked changes. Please make sure every change is tracked in the next draft so nothing is missed on either side.`
    : ''
  const acceptedLine = acceptedIn.length
    ? `We have accepted your changes to ${acceptedLabels(acceptedIn)}.`
    : ''
  const numbered = points.map((p, i) => `${i + 1}. ${p}`).join('\n\n')
  const subject = points.length ? `${name}: our comments` : `${name}: approved`
  const body = points.length
    ? `Hello,\n\nThank you for sending this through. We have reviewed the draft. ${acceptedLine ? `${acceptedLine} ` : ''}Our changes are marked up as tracked changes in the attached copy, with comments explaining them. In summary:\n\n${numbered}${note}\n\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal team`
    : `Hello,\n\nThank you for sending this through. We have reviewed the draft${acceptedLine ? ` and accepted your changes` : ''} and are happy to proceed on it as it stands. Please send it for signature when ready.\n\nKind regards,\n${reviewer}\nLegal team`
  return { subject, body, generatedBy: 'template' }
}

/** "clauses 1.3 and 2.1; the paragraph beginning "…"": numbered clauses together, then the rest. */
function acceptedLabels(xs: string[]): string {
  const join = (ys: string[]) => (ys.length < 2 ? ys.join('') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`)
  const nums = xs.filter((x) => /^\d/.test(x))
  const rest = xs.filter((x) => !/^\d/.test(x))
  return [...(nums.length ? [`${nums.length === 1 ? 'clause' : 'clauses'} ${join(nums)}`] : []), ...(rest.length ? [join(rest)] : [])].join('; ')
}
