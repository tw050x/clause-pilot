import { useEffect, useRef, useState } from 'react'
import { SuperDoc } from 'superdoc'
import 'superdoc/style.css'
import type { DocReview, ReviewSession } from '@shared/types'
import { groupOf, marksFor, segmentsOf, shownText } from '@shared/changes'
import { Icon } from '../lib/icons'
import { DEFAULTS, questionIdOf } from '@shared/questions'
import { GUTTER, paragraphState, plainText, type GutterState } from '../lib/paragraphState'
import { setFlashFallback, type Highlight, type SelectedChange } from './DocEditor'

/**
 * The document as it looks in Word: the review as it stands (their file with our decisions,
 * edits and comments in it, as the marked-up copy has them), laid out in pages by SuperDoc.
 * Read-only for now: clicking and selecting drive the review column as in the text view, and
 * after each change the page is laid out again. Each Word paragraph carries an id naming the
 * review paragraph it is, so the bars, labels and markers beside it are ours.
 */

interface Props {
  session: ReviewSession
  /** The reviewer's name: our tracked changes and comments in the page are theirs. */
  reviewer: string
  onFocusBlock: (id: string | null) => void
  onSelectChanges: (x: SelectedChange[] | null, hl?: Highlight) => void
}

type Loaded = { sd: SuperDoc; ids: Record<string, string>; host: HTMLDivElement }
type Placed = { top: number; height: number; left: number }

/** Paragraph ids in a page fragment's element. */
const nodeId = (el: Element) => (el as HTMLElement).dataset.sourceNodeId ?? ''
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

export function WordView({ session, reviewer, onFocusBlock, onSelectChanges }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const current = useRef<Loaded | null>(null)
  const cb = useRef({ onFocusBlock, onSelectChanges })
  cb.current = { onFocusBlock, onSelectChanges }
  const model = useRef<DocReview>(session.doc!)
  model.current = session.doc!
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [gutter, setGutter] = useState<{ bars: (Placed & { bar: string })[]; runs: (Placed & { state: GutterState })[]; ai: (Placed & { titles: string[]; blockIds: string[]; quote: string })[] }>({
    bars: [],
    runs: [],
    ai: []
  })

  /** Where each review paragraph is on the page (its fragments, one per page it's on). */
  const measure = () => {
    const w = wrap.current
    const loaded = current.current
    if (!w || !loaded) return
    const base = w.getBoundingClientRect()
    const at = (r: DOMRect) => ({ top: r.top - base.top + w.scrollTop, height: r.height, left: r.left - base.left })
    const byBlock = new Map<string, Placed[]>()
    for (const el of loaded.host.querySelectorAll('.superdoc-fragment[data-source-node-id]')) {
      const blockId = loaded.ids[nodeId(el)]
      if (!blockId) continue
      const list = byBlock.get(blockId) ?? []
      list.push(at(el.getBoundingClientRect()))
      byBlock.set(blockId, list)
    }
    const d = model.current
    const bars: (Placed & { bar: string })[] = []
    const runs: (Placed & { state: GutterState })[] = []
    const run: { top: number; left: number; bottom: number; state?: GutterState } = { top: 0, left: 0, bottom: 0 }
    const end = () => run.state && runs.push({ top: run.top, height: run.bottom - run.top, left: run.left, state: run.state })
    for (const b of d.blocks) {
      const places = byBlock.get(b.id)
      if (!places?.length) continue
      const marks = marksFor(d, b)
      const { bar, state } = paragraphState(d, b, shownText(marks), marks.length, plainText(d, b))
      for (const p of places) bars.push({ ...p, bar })
      const first = places[0]
      const last = places[places.length - 1]
      // A run is consecutive paragraphs in the same state on the same page.
      if (state && run.state === state && first.top - run.bottom < 40) run.bottom = last.top + last.height
      else {
        end()
        Object.assign(run, { top: first.top, left: first.left, bottom: first.top + first.height, state: state ?? undefined })
      }
    }
    end()
    // Text with AI answers: a marker beside the first paragraph of each highlight.
    const groups = new Map<string, { blockIds: string[]; quote: string; titles: Set<string> }>()
    for (const r of d.aiRuns ?? []) {
      if (r.status !== 'done' || !r.blockIds.length) continue
      const key = `${[...r.blockIds].sort().join(',')}\u0000${tidy(r.quote)}`
      const g = groups.get(key) ?? { blockIds: r.blockIds, quote: r.quote, titles: new Set<string>() }
      g.titles.add(r.title ?? DEFAULTS.find((q) => q.id === questionIdOf(r))?.title ?? r.question.split('\n')[0])
      groups.set(key, g)
    }
    const ai = [...groups.values()].flatMap((g) => {
      const p = g.blockIds.map((id) => byBlock.get(id)?.[0]).find(Boolean)
      return p ? [{ ...p, blockIds: g.blockIds, quote: g.quote, titles: [...g.titles] }] : []
    })
    setGutter({ bars, runs, ai })
  }

  /** One of their tracked changes on the page (SuperDoc's id), as the review's change in that paragraph. */
  const theirChange = async (loaded: Loaded, id: string, blockId: string | undefined, picked: SelectedChange[]) => {
    const c = await Promise.resolve(loaded.sd.activeEditor?.doc?.trackChanges.get({ id })).catch(() => null)
    if (!c || c.author === reviewer) return
    const at = (c as { navigationTarget?: { blockId?: string } }).navigationTarget?.blockId ?? ''
    const b = model.current.blocks.find((x) => x.id === (loaded.ids[at] ?? blockId))
    if (!b) return
    const seg = segmentsOf(b).findIndex((x) => x.op !== 'same' && [c.insertedText, c.deletedText].some((t) => t && tidy(t) === tidy(x.text)))
    if (seg < 0) return
    for (const k of groupOf(b, seg)) if (!picked.some((p) => p.kind === 'theirs' && p.blockId === b.id && p.seg === k)) picked.push({ blockId: b.id, kind: 'theirs', seg: k })
  }

  /**
   * What was clicked or selected on the page, as the review knows it. A selection: its paragraphs,
   * its text (for the AI questions) and their changes in it. A click: its paragraph, and the change
   * of theirs it's in, if any (read from the page, since a click selects nothing in this view).
   */
  const report = async (loaded: Loaded, clicked: Element | null) => {
    const sel = loaded.sd.ui?.selection.getSnapshot()
    const picked: SelectedChange[] = []
    if (sel && !sel.empty && sel.target && sel.quotedText.trim()) {
      const blockIds = [...new Set(sel.target.segments.map((x) => loaded.ids[x.blockId]).filter(Boolean))]
      for (const id of sel.activeChangeIds) await theirChange(loaded, id, blockIds[0], picked)
      if (!blockIds.length) return
      cb.current.onFocusBlock(blockIds[0])
      cb.current.onSelectChanges(picked, { blockId: blockIds[0], blockIds, quote: sel.quotedText })
      return
    }
    const fragment = clicked?.closest('.superdoc-fragment[data-source-node-id]')
    const blockId = fragment ? loaded.ids[nodeId(fragment)] : undefined
    const change = (clicked?.closest('[data-track-change-id]') as HTMLElement | null)?.dataset.trackChangeId
    if (change) await theirChange(loaded, change, blockId, picked)
    cb.current.onFocusBlock(blockId ?? null)
    cb.current.onSelectChanges(picked.length ? picked : null)
  }

  // Lay the review out again when it changes: the new page is built out of sight and swapped in
  // when it's ready, so nothing flickers and the scroll position stays.
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const { bytes, ids } = await window.api.doc.view(session.id)
        if (cancelled || !stage.current) return
        const host = document.createElement('div')
        host.className = 'wv-host loading'
        stage.current.appendChild(host)
        const file = new File([bytes.slice().buffer as ArrayBuffer], session.docName.replace(/\.[a-z]+$/i, '') + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
        const sd: SuperDoc = await new Promise((resolve, reject) => {
          const made = new SuperDoc({
            selector: host,
            document: file,
            documentMode: 'viewing',
            viewing: { trackedChanges: 'markup', comments: false },
            allowSelectionInViewMode: true,
            user: { name: reviewer, email: '' },
            modules: { comments: false },
            // Nothing about the document leaves this computer.
            telemetry: { enabled: false },
            onReady: () => resolve(made),
            onException: (e: unknown) => reject(e instanceof Error ? e : new Error(String((e as { error?: unknown })?.error ?? e)))
          } as ConstructorParameters<typeof SuperDoc>[0])
        })
        if (cancelled) {
          sd.destroy()
          host.remove()
          return
        }
        const old = current.current
        const loaded = { sd, ids, host }
        current.current = loaded
        host.classList.remove('loading')
        if (old) {
          old.sd.destroy()
          old.host.remove()
        }
        // After SuperDoc has settled the selection the click or drag made.
        host.addEventListener('pointerup', (e) => {
          const target = e.target as Element
          window.setTimeout(() => void report(loaded, target), 120)
        })
        setLoading(false)
        setError(null)
        requestAnimationFrame(measure)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    }, current.current ? 150 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Each change to the review is a new session object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(
    () => () => {
      current.current?.sd.destroy()
      current.current = null
    },
    []
  )

  // Bars and labels follow the page as it's laid out.
  useEffect(() => {
    const w = wrap.current
    if (!w) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(w)
    if (stage.current) ro.observe(stage.current)
    return () => ro.disconnect()
  }, [])

  // Jumping to paragraphs (from the history, the AI's cards) scrolls the page to them.
  useEffect(() => {
    setFlashFallback((blockIds) => {
      const loaded = current.current
      if (!loaded) return
      const want = new Set(blockIds)
      const el = [...loaded.host.querySelectorAll('.superdoc-fragment[data-source-node-id]')].find((x) => want.has(loaded.ids[nodeId(x)]))
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => setFlashFallback(null)
  }, [])

  return (
    <div className="wv-wrap" ref={wrap}>
      {loading && <div className="wv-loading">Laying out the document…</div>}
      {error && <div className="banner danger" style={{ margin: 16 }}>The document couldn’t be shown in Word layout: {error}</div>}
      <div className="wv-stage" ref={stage} />
      <div className="wv-gutter">
        {gutter.bars.map((b, i) => (
          <div key={`b${i}`} className={`wv-bar ${b.bar}`} style={{ top: b.top, height: b.height, left: b.left - 14 }} />
        ))}
        {gutter.runs.map((r, i) => (
          <div key={`r${i}`} className="wv-run" style={{ top: r.top, height: r.height, left: r.left - 104 }}>
            <span className={`ed-unchanged ${r.state}`} data-tip={GUTTER[r.state].tip}>
              {GUTTER[r.state].label}
            </span>
          </div>
        ))}
        {gutter.ai.map((a, i) => (
          <button
            key={`a${i}`}
            className="ed-ai-mark wv-ai"
            style={{ top: a.top, left: a.left - 40 }}
            title={`AI answers for this text (${a.titles.map((t) => `“${t}”`).join(', ')}). Click to show them.`}
            aria-label="Show the AI answers for this text"
            onClick={() => {
              cb.current.onFocusBlock(a.blockIds[0])
              cb.current.onSelectChanges([], { blockId: a.blockIds[0], blockIds: a.blockIds, quote: a.quote })
            }}
          >
            <Icon name="sparkle" size={12} stroke={2.2} />
          </button>
        ))}
      </div>
    </div>
  )
}
