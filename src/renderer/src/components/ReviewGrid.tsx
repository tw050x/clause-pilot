import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Clause, ReviewSession, SecurityAlert } from '@shared/types'
import { Highlighted } from './Highlighted'
import { clauseLabel, flagsFor, needsAction, visualFor } from '@shared/derive'
import { ClauseResult } from './ClauseResult'
import { Chevron, Icon } from '../lib/icons'
import { IssuesView } from './IssuesView'
import { OriginalView } from './OriginalView'

export interface ReviewGridHandle {
  /** Select a clause, show its card and bring it into view on the left. */
  openClause: (id: string) => void
}

export type RightMode = 'issues' | 'clause' | 'original'

interface Props {
  session: ReviewSession
  selected: string | null
  mode: RightMode
  onSelect: (id: string | null) => void
  onMode: (m: RightMode) => void
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  alert: SecurityAlert | null
}

/** Content is designed for this width; narrower (sidebars open) scales it down, never below MIN_SCALE. */
const DESIGN_WIDTH = 1300
const MIN_SCALE = 0.8

/**
 * Left: the whole contract as a coverage map (every clause tinted by status).
 * Right: one thing at a time - the ranked issues list, the selected clause's
 * analysis, or the original document with the clause highlighted.
 * The two sides scroll independently.
 */
export const ReviewGrid = forwardRef<ReviewGridHandle, Props>(function ReviewGrid(
  { session, selected, mode, onSelect, onMode, onChange, onNominationsChanged, alert },
  ref
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const docPane = useRef<HTMLDivElement>(null)
  const rightPane = useRef<HTMLDivElement>(null)
  const clauseRefs = useRef(new Map<string, HTMLDivElement>())

  // Scale both panes with the space available (sidebars open/closed, window size).
  // When a contract opens, the right sidebar slides in and the space shrinks frame by
  // frame; rather than show the content resizing, it stays hidden until the sidebars
  // have settled, then takes its final size and fades in.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const apply = () => wrap.style.setProperty('--rs', Math.min(1, Math.max(MIN_SCALE, wrap.clientWidth / DESIGN_WIDTH)).toFixed(3))
    setReady(false)
    let done = false
    const reveal = () => {
      if (done) return
      done = true
      apply()
      setReady(true)
    }
    const bar = document.querySelector('.rightbar')
    const onEnd = (e: Event) => (e as TransitionEvent).propertyName.startsWith('margin') && reveal()
    bar?.addEventListener('transitionend', onEnd)
    // If nothing is sliding (sidebar already open, or closed), reveal on the next frames.
    const fallback = window.setTimeout(reveal, 320)
    const ro = new ResizeObserver(() => done && apply())
    ro.observe(wrap)
    return () => {
      bar?.removeEventListener('transitionend', onEnd)
      window.clearTimeout(fallback)
      ro.disconnect()
    }
  }, [session.id])

  // New thing on the right: start it at the top.
  useEffect(() => {
    if (mode !== 'original') rightPane.current?.scrollTo({ top: 0 })
  }, [selected, mode])

  useEffect(() => {
    docPane.current?.scrollTo({ top: 0 })
    rightPane.current?.scrollTo({ top: 0 })
  }, [session.id])

  const open = useCallback(
    (id: string) => {
      onSelect(id)
      onMode('clause')
      const el = clauseRefs.current.get(id)
      const pane = docPane.current
      if (el && pane) {
        const r = el.getBoundingClientRect()
        const p = pane.getBoundingClientRect()
        // Only move the document if the clause isn't comfortably visible.
        if (r.top < p.top + 8 || r.top > p.top + p.height * 0.6) pane.scrollBy({ top: r.top - p.top - 16, behavior: 'smooth' })
      }
    },
    [onSelect, onMode]
  )

  useImperativeHandle(ref, () => ({ openClause: open }))

  const sel = session.clauses.find((c) => c.id === selected)
  const selVisual = sel ? visualFor(flagsFor(session, sel)) : 'processing'
  let lastHeading: string | null = null

  return (
    <div className={`review-wrap s-${selVisual} ${ready ? 'ready' : ''} ${mode === 'original' && sel ? 'orig-open' : ''}`} ref={wrapRef}>
      <div className="doc-pane" ref={docPane} tabIndex={-1}>
        <div className="doc-paper">
          {session.clauses.map((c) => {
            const f = flagsFor(session, c)
            const v = visualFor(f)
            const isTitle = c.index === 0 && !c.number && c.heading
            const showHeading = !!c.number && !!c.heading && c.heading !== lastHeading
            lastHeading = c.heading
            const isSel = c.id === selected
            return (
              <DocClause
                key={c.id}
                clause={c}
                visual={v}
                action={needsAction(f)}
                flagged={!!session.injection[c.id]}
                versionKind={session.previous ? session.versionLinks?.[c.id]?.kind : undefined}
                selected={isSel}
                title={isTitle ? c.heading : null}
                heading={showHeading ? c.heading : null}
                setRef={(el) => void (el ? clauseRefs.current.set(c.id, el) : clauseRefs.current.delete(c.id))}
                onClick={() => open(c.id)}
                tools={
                  // Space is reserved under every clause so selecting one never shifts the layout.
                  <div className={`clause-tools ${isSel ? '' : 'hidden'}`} aria-hidden={!isSel}>
                    <button className="btn sm" tabIndex={isSel ? 0 : -1} onClick={() => onMode('original')}>
                      Check in original
                      <Chevron />
                    </button>
                  </div>
                }
              />
            )
          })}
        </div>
      </div>

      <div className="right-pane" ref={rightPane} tabIndex={-1}>
        <div className="right-content" hidden={mode === 'original' && !!sel}>
          {mode === 'clause' && sel && (
            <div className="right-nav">
              <button className="link-btn" onClick={() => onMode('issues')}>
                ← All issues
              </button>
              <span className="faint">{clauseLabel(sel)}</span>
            </div>
          )}

          {(mode === 'issues' || !sel) && (
            <IssuesView session={session} onOpen={open} alert={alert} />
          )}

          {mode === 'clause' && sel && (
            <div className={`result-box s-${selVisual}`}>
              <ClauseResult
                session={session}
                clause={sel}
                flags={flagsFor(session, sel)}
                visual={selVisual}
                onJump={open}
                onChange={onChange}
                onNominationsChanged={onNominationsChanged}
                alert={alert}
              />
            </div>
          )}

        </div>
        {mode === 'original' && sel && (
          <OriginalView path={session.filePath} sourceType={session.sourceType} highlight={sel.text} label={clauseLabel(sel)} />
        )}
      </div>
      {mode === 'original' && sel && (
        <button className="btn orig-close" onClick={() => onMode('clause')}>
          <Icon name="x" size={14} /> Close original
        </button>
      )}
    </div>
  )
})

const BADGE: Record<'pending' | 'action' | 'none' | 'rejected', string> = {
  pending: 'Still being checked',
  action: 'Needs your decision',
  none: 'No action needed',
  rejected: 'Rejected'
}

/** Corner badge: does this clause need someone to act? Colour alone isn't enough (e.g. AI matches look nearly green). */
function StatusBadge({ action }: { action: 'pending' | 'action' | 'none' | 'rejected' }) {
  return (
    <span className={`clause-badge b-${action}`} title={BADGE[action]} aria-label={BADGE[action]}>
      {action === 'pending' ? <span className="spinner" /> : action === 'action' ? '!' : action === 'none' ? <Icon name="check" size={11} stroke={3} /> : <Icon name="x" size={11} stroke={3} />}
    </span>
  )
}

/** Flagged for possible prompt injection: a security matter, not just a decision. */
function SecurityBadge() {
  return (
    <span className="clause-badge b-security" title="Possible prompt injection: on security hold" aria-label="Possible prompt injection">
      <Icon name="shield" size={12} stroke={2.4} />
    </span>
  )
}

/** Marks the selected clause: its analysis is what the right-hand side is showing. */
function SelectedArrow() {
  return (
    <svg className="sel-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden>
      <path d="M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z" />
    </svg>
  )
}

function DocClause(props: {
  clause: Clause
  visual: string
  action: 'pending' | 'action' | 'none' | 'rejected'
  flagged: boolean
  versionKind?: 'unchanged' | 'changed' | 'new'
  selected: boolean
  title: string | null
  heading: string | null
  tools: React.ReactNode
  setRef: (el: HTMLDivElement | null) => void
  onClick: () => void
}) {
  const { clause: c, visual, selected, title, heading } = props
  return (
    <>
      {title && <div className="doc-title">{title}</div>}
      {heading && (
        <div className="doc-heading">
          {c.number?.split('.')[0]}. {heading}
        </div>
      )}
      <div
        ref={props.setRef}
        className={`doc-clause s-${visual} ${selected ? 'selected' : ''} ${c.number ? '' : 'unnumbered'}`}
        onClick={props.onClick}
        title={clauseLabel(c)}
        data-num={c.number ?? undefined}
      >
        {c.number && <span className="doc-num">{c.number}</span>}
        {props.versionKind && props.versionKind !== 'unchanged' && <span className={`ver-tag ${props.versionKind}`}>{props.versionKind}</span>}
        <span className="doc-text">{props.flagged ? <Highlighted text={c.text} /> : c.text}</span>
        {props.flagged ? <SecurityBadge /> : <StatusBadge action={props.action} />}
        {selected && <SelectedArrow />}
      </div>
      {props.tools}
    </>
  )
}
