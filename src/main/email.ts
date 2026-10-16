import type { EmailDraft, ReviewSession } from '@shared/types'
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
    .map((c) => {
      const d = s.decisions[c.id]
      const positions = Object.values(s.playbook)
        .map((p) => p.data)
        .filter((f) => f && f.status === 'deviation' && f.clauseIds.includes(c.id))
      return {
        label: clauseLabel(c),
        heading: c.heading,
        text: c.text,
        note: d.note,
        redline: d.redline || positions.find((p) => p?.suggestedRedline)?.suggestedRedline || ''
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
   Our proposed wording: ${p.redline || '(ask them to delete or revert to our standard)'}`
  )
  .join('\n')}

Return a subject line and the email body (plain text, no markdown).`
  return { points, prompt }
}

interface EmailPoint {
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
        (p.redline ? `   We propose: "${p.redline}"\n` : '   We would ask for this to be removed or returned to our standard wording.\n')
    )
    .join('\n')
  return {
    subject: `${name}: PortSwigger comments`,
    body: `Hello,\n\nThank you for sending this through. We have reviewed the draft and are happy with most of it. There ${points.length === 1 ? 'is one point' : `are ${points.length} points`} we need to resolve before signing:\n\n${items}\nEverything else is agreed. If it would help, we are happy to have a quick call to close these out.\n\nKind regards,\n${reviewer}\nLegal, PortSwigger`,
    generatedBy: 'template'
  }
}

const title = (h: string) => h.charAt(0) + h.slice(1).toLowerCase()
