import type { DocBlock, EmailDraft, ReviewSession } from '@shared/types'
import { beforeTheirs, changeSets, statusOf, type ChangeSet } from '@shared/changes'
import { clauseLabel } from '@shared/derive'

/** Everything the email needs, in a form that is both the AI prompt and the template's input. */
export function emailBrief(s: ReviewSession, reviewer: string): { points: EmailPoint[]; prompt: string } {
  // Our standard clauses they deleted with Track Changes: ask for them back.
  const reinstate: EmailPoint[] = (s.trackedDeletions ?? [])
    .filter((d) => d.libraryTitle)
    .map((d) => ({
      label: d.number ? `Clause ${d.number}` : 'A deleted clause',
      heading: d.libraryTitle ?? null,
      text: d.text,
      note: 'This clause was deleted. It is part of our standard terms and needs to be reinstated.',
      redline: d.text
    }))
  const points: EmailPoint[] = s.clauses
    .filter((c) => s.decisions[c.id]?.decision === 'rejected')
    .map((c): EmailPoint => {
      const d = s.decisions[c.id]
      const positions = Object.values(s.playbook)
        .map((p) => p.data)
        .filter((f) => f && f.status === 'deviation' && f.clauseIds.includes(c.id))
      return {
        label: clauseLabel(c),
        heading: c.heading,
        text: c.text,
        note: d.removal || d.redline ? d.note.replace(/\s*We propose the wording below instead\.?$/i, '') : d.note,
        removal: !!d.removal,
        redline: d.removal ? '' : d.redline || ''
      }
    })
    .concat(reinstate)

  const prompt = `Draft an email to the counterparty for contract "${s.docName}".
The reviewer is ${reviewer} (PortSwigger Legal). Everything not listed below is accepted.

Points we cannot accept:
${points
  .map(
    (p, i) => `${i + 1}. ${p.label}${p.heading ? ` (${p.heading})` : ''}
   Their wording: <clause>${p.text}</clause>
   Reviewer's note: ${p.note || '(none)'}
   What we ask: ${p.removal ? 'remove this clause' : p.redline ? `replace it with: ${p.redline}` : 'revert to our standard wording'}`
  )
  .join('\n')}

A marked-up copy of the contract is attached: our changes are tracked changes and each point has a comment explaining it. Refer to it briefly; the email is the cover note.

Return a subject line and the email body (plain text, no markdown).`
  return { points, prompt }
}

interface EmailPoint {
  removal?: boolean
  label: string
  heading: string | null
  text: string
  note: string
  redline: string
}

/** Deterministic fallback used offline / in demo mode. */
export function templateEmail(s: ReviewSession, reviewer: string): EmailDraft {
  const { points } = emailBrief(s, reviewer)
  const name = s.docName.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ')
  if (!points.length) {
    return {
      subject: `${name}: approved`,
      body: `Hello,\n\nThank you for sending this through. We have reviewed the agreement and are happy to proceed on the current draft. Please send it for signature when ready.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`,
      generatedBy: 'template'
    }
  }
  const items = points
    .map(
      (p, i) =>
        `${i + 1}. ${p.label}${p.heading ? ` (${title(p.heading)})` : ''}\n` +
        (p.note ? `   ${p.note}\n` : '') +
        (p.removal
          ? '   We ask for this clause to be removed.\n'
          : p.redline
            ? `   We propose instead: "${p.redline}"\n`
            : '   We would ask for this to be returned to our standard wording.\n')
    )
    .join('\n')
  return {
    subject: `${name}: PortSwigger comments`,
    body: `Hello,\n\nThank you for sending this through. We have reviewed the draft and are happy with most of it. There ${points.length === 1 ? 'is one point' : `are ${points.length} points`} we need to resolve before signing. Our proposed changes are marked up as tracked changes in the attached copy, with a comment on each point:\n\n${items}\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`,
    generatedBy: 'template'
  }
}

const title = (h: string) => h.charAt(0) + h.slice(1).toLowerCase()

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
  const whereOf = (b: DocBlock) => (b.label ? `Clause ${b.label.replace(/\.$/, '')}` : b.kind === 'row' ? b.text.split(' — ')[0] : `"${b.text.slice(0, 40)}…"`)

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
    const ask = edit === undefined ? '' : edit === '' ? 'We ask for this to be removed.' : `We propose: "${edit}"`
    points.push([whereOf(b), ...notes.map((n) => `   ${n}`), ask && `   ${ask}`].filter(Boolean).join('\n'))
  }
  const accepted = sets.filter((set) => statusOf(d, set) === 'accepted').length
  const numbered = points.map((p, i) => `${i + 1}. ${p}`).join('\n\n')
  const subject = points.length ? `${name}: PortSwigger comments` : `${name}: approved`
  const body = points.length
    ? `Hello,\n\nThank you for sending this through. We have reviewed the draft${accepted ? ' and accepted most of your changes' : ''}. Our changes are marked up as tracked changes in the attached copy, with comments explaining them. In summary:\n\n${numbered}\n\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
    : `Hello,\n\nThank you for sending this through. We have reviewed the draft and are happy to proceed on it as it stands. Please send it for signature when ready.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`
  return { subject, body, generatedBy: 'template' }

  function whereOfSet(set: ChangeSet) {
    return set.where.startsWith('§') ? `Clause ${set.where.slice(1)}` : set.where
  }
}
