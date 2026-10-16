import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** What a step can ask the app to do when it starts (open panels, switch views). */
export interface TourCtx {
  showReviewPanels: () => void
  setRightTab: (t: 'review' | 'chat') => void
}

export interface TourStep {
  title: string
  body: React.ReactNode
  /** Element to point at. Omit for a centred step. Re-evaluated every frame, so it can appear later. */
  target?: () => Element | null
  /** Something the user must do. Next stays disabled until `done()` is true. */
  action?: string
  done?: () => boolean
  /** Shown instead of the body's pointer when the target isn't on screen yet. */
  waiting?: string
  prepare?: (ctx: TourCtx) => void
  placement?: 'top' | 'bottom' | 'left' | 'right'
  pad?: number
}

export interface Tour {
  id: string
  name: string
  steps: TourStep[]
}

type Rect = { top: number; left: number; width: number; height: number }

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5)

/**
 * Guided demo overlay. Rings the step's target, floats a tooltip next to it,
 * and (for action steps) waits until the app reaches the expected state before
 * Next unlocks. Only centred steps are masked: otherwise the user works in the
 * real app throughout and sees everything. It can be exited at any step.
 */
export function TourOverlay({ tour, ctx, onClose }: { tour: Tour; ctx: TourCtx; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [done, setDone] = useState(false)
  const [tip, setTip] = useState<{ top: number; left: number; arrow: 'top' | 'bottom' | 'left' | 'right' | null; at?: number }>({ top: 0, left: 0, arrow: null })
  const tipRef = useRef<HTMLDivElement>(null)
  /** False until the tooltip has been positioned once: it then fades in where it is instead of sliding from the corner. */
  const [placed, setPlaced] = useState(false)
  const scrolledFor = useRef(-1)
  const step = tour.steps[i]
  const last = i === tour.steps.length - 1

  useEffect(() => {
    step.prepare?.(ctx)
    scrolledFor.current = -1
    setDone(false)
  }, [i, tour.id])

  // Track the target and the step's completion every frame (layout and app state keep changing).
  useEffect(() => {
    let raf = 0
    let prev: Rect | null = null
    const tick = () => {
      const el = step.target?.() ?? null
      let r: Rect | null = null
      if (el) {
        const b = el.getBoundingClientRect()
        if (b.width || b.height) r = { top: b.top, left: b.left, width: b.width, height: b.height }
        const offscreen = b.bottom < 60 || b.top > window.innerHeight - 40
        if (r && offscreen && scrolledFor.current !== i) {
          scrolledFor.current = i
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }
      if (!same(r, prev)) {
        prev = r
        setRect(r)
      }
      if (step.done) setDone(step.done())
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [i, tour.id])

  // Place the tooltip next to the target, on the side with room, clamped to the window.
  useLayoutEffect(() => {
    const t = tipRef.current
    if (!t) return
    const W = window.innerWidth
    const H = window.innerHeight
    const tw = t.offsetWidth
    const th = t.offsetHeight
    const m = 12
    const gap = 14
    if (!rect) {
      setTip({ top: (H - th) / 2, left: (W - tw) / 2, arrow: null })
      return
    }
    const pad = step.pad ?? 6
    const r = { top: rect.top - pad, left: rect.left - pad, right: rect.left + rect.width + pad, bottom: rect.top + rect.height + pad }
    const room = { bottom: H - r.bottom, top: r.top, right: W - r.right, left: r.left }
    const fits = { bottom: room.bottom > th + gap + m, top: room.top > th + gap + m, right: room.right > tw + gap + m, left: room.left > tw + gap + m }
    const order = [step.placement, 'bottom', 'right', 'left', 'top'].filter(Boolean) as (keyof typeof fits)[]
    const side = order.find((s) => fits[s]) ?? null
    const clampX = (x: number) => Math.min(Math.max(m, x), W - tw - m)
    const clampY = (y: number) => Math.min(Math.max(m, y), H - th - m)
    const cx = (r.left + r.right) / 2
    const cy = (r.top + r.bottom) / 2
    // The tail points at the target's centre even when the tooltip is shifted to stay on screen.
    const along = (pos: number, size: number) => Math.min(Math.max(18, pos), size - 18)
    if (side === 'bottom' || side === 'top') {
      const left = clampX(cx - tw / 2)
      setTip({ top: side === 'bottom' ? r.bottom + gap : r.top - gap - th, left, arrow: side === 'bottom' ? 'top' : 'bottom', at: along(cx - left, tw) })
    } else if (side === 'right' || side === 'left') {
      const top = clampY(cy - th / 2)
      setTip({ top, left: side === 'right' ? r.right + gap : r.left - gap - tw, arrow: side === 'right' ? 'left' : 'right', at: along(cy - top, th) })
    }
    else setTip({ top: H - th - m, left: W - tw - m, arrow: null }) // huge target: park in the corner
  }, [rect, i, done])

  useEffect(() => {
    if (placed) return
    const id = requestAnimationFrame(() => setPlaced(true))
    return () => cancelAnimationFrame(id)
  }, [tip])

  const pad = step.pad ?? 6
  const needsAction = !!step.action && !!step.done
  const blocked = needsAction && !done

  return (
    <div className="tour" aria-live="polite">
      {/* Pointing at something: no mask, the page stays fully visible and usable and the
          target just gets a ring. Centred (nothing to point at): a light mask focuses the card. */}
      {!rect && <div className="tour-dim" />}
      {rect && <div className={`tour-spot ${blocked ? 'pulse' : ''}`} style={ringStyle(rect, pad)} />}
      <div ref={tipRef} className={`tour-tip ${tip.arrow ? 'arrow-' + tip.arrow : ''} ${placed ? 'placed' : ''}`} style={{ top: tip.top, left: tip.left, ['--arrow-at' as string]: tip.at !== undefined ? `${tip.at}px` : '50%' }} role="dialog" aria-label={step.title}>
        <div className="tour-head">
          <span className="tour-name">{tour.name}</span>
          <span className="faint">
            {i + 1} / {tour.steps.length}
          </span>
        </div>
        <h4>{step.title}</h4>
        <div className="tour-body">{step.body}</div>
        {step.action && (
          <div className={`tour-action ${done ? 'done' : ''}`}>
            {done ? '✓ Done. Click Next to continue.' : step.target?.() || !step.waiting ? step.action : step.waiting}
          </div>
        )}
        <div className="tour-foot">
          {!last && (
            <button className="link-btn tour-skip" onClick={onClose}>
              Exit tour
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          <button className="btn sm primary" disabled={blocked} onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The ring sits `pad` outside the target, but never outside the window (e.g. the sidebar touches its edges). */
function ringStyle(rect: Rect, pad: number): React.CSSProperties {
  const inset = 4 // keeps the ring and its pulse fully visible
  const left = Math.max(inset, rect.left - pad)
  const top = Math.max(inset, rect.top - pad)
  const right = Math.min(window.innerWidth - inset, rect.left + rect.width + pad)
  const bottom = Math.min(window.innerHeight - inset, rect.top + rect.height + pad)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
