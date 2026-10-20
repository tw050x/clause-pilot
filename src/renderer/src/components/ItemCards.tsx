import type { ReactNode } from 'react'

/**
 * Lists on pages: a card per item instead of a table row. Its title (with its state beside it and
 * a line under it), its actions at the right, anything it reads in full (wording, a note), and
 * its details as label / value pairs in a grid that wraps to the width: no columns fixed in
 * advance, so nothing is squeezed or runs into what's next to it.
 */
export function CardList({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <div className={`ic-list ${compact ? 'compact' : ''}`}>{children}</div>
}

export interface Fact {
  label: string
  value: ReactNode
  /** Takes the whole row (a longer value). */
  wide?: boolean
}

export function ItemCard({
  title,
  badges,
  sub,
  actions,
  body,
  facts,
  onClick,
  muted
}: {
  title: ReactNode
  badges?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  body?: ReactNode
  facts?: (Fact | false | null | undefined)[]
  onClick?: () => void
  muted?: boolean
}) {
  const shown = (facts ?? []).filter((f): f is Fact => !!f)
  return (
    <div className={`ic-card ${onClick ? 'clickable' : ''} ${muted ? 'muted-card' : ''}`} onClick={onClick}>
      <div className="ic-head">
        <div className="ic-titles">
          <div className="ic-title-row">
            <span className="ic-title">{title}</span>
            {badges}
          </div>
          {sub && <div className="ic-sub">{sub}</div>}
        </div>
        {actions && (
          // Its buttons do their own thing, not open the item.
          <div className="ic-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {body && <div className="ic-body">{body}</div>}
      {shown.length > 0 && (
        <dl className="ic-facts">
          {shown.map((f, i) => (
            <div key={i} className={`ic-fact ${f.wide ? 'wide' : ''}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
