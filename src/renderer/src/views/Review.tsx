import type { ReviewSession, SecurityAlert } from '@shared/types'
import { DocReview } from './DocReview'

interface Props {
  session: ReviewSession
  /** Right sidebar element the review controls are rendered into. */
  panel: HTMLElement | null
  /** The bar under the document and the review column, for the review's actions. */
  bar: HTMLElement | null
  /** The foot of the review column, for Accept / Reject and the key. */
  foot: HTMLElement | null
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  /** Debug mode (Settings): show raw AI responses. */
  debug: boolean
  /** The reviewer's name (Settings). */
  reviewer: string
  /** The security alert for this review, if text addressed to an AI reviewer was found. */
  alert: SecurityAlert | null
  onOpenSecurity: () => void
  accountName?: string
  contractTitle?: string
  onOpenReview: (id: string) => void
}

/** A review: the document screen. Reviews saved by earlier versions (clause by clause) can't be reopened. */
export function Review(props: Props) {
  if (props.session.doc) return <DocReview {...props} />
  return (
    <div className="page">
      <h1>{props.session.docName}</h1>
      <p className="faint">This review was made with an earlier version of Clause Pilot, which reviewed contracts clause by clause. Upload the draft again to review it on the document screen.</p>
    </div>
  )
}
