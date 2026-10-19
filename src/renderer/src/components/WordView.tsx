import { useEffect, useRef, useState } from 'react'
import { SuperDoc } from 'superdoc'
import 'superdoc/style.css'
import type { DocBlock, DocReview, ReviewSession } from '@shared/types'
import { indentList, listAfter } from '@shared/numbering'
import { groupOf, marksFor, segmentsOf, shownText } from '@shared/changes'
import { DEFAULTS, questionIdOf } from '@shared/questions'
import { GUTTER, paragraphState, plainText, type GutterState } from '../lib/paragraphState'
import { commentLabel, setFlashFallback, type Highlight, type SelectedChange } from './DocEditor'
import { CommentIcon, Icon } from '../lib/icons'

/**
 * The document as it looks in Word: the review as it stands (their file with our decisions,
 * edits and comments in it, as the marked-up copy has them), laid out in pages by SuperDoc.
 * Clicking and selecting drive the review column as in the text view. Typing into the page is
 * suggesting: what you type is your tracked change, and after a pause the paragraph's new wording
 * is saved to the review as your edit (as typing in the text view is). Anything else that changes
 * the review lays the page out again. Each Word paragraph carries an id naming the review
 * paragraph it is, so the bars, labels and markers beside it are ours.
 */

interface Props {
  session: ReviewSession
  /** The reviewer's name: our tracked changes and comments in the page are theirs. */
  reviewer: string
  onFocusBlock: (id: string | null) => void
  onSelectChanges: (x: SelectedChange[] | null, hl?: Highlight) => void
  /** Apply a change to the review (the session it returns becomes the review). */
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  /** Comment on selected text (the margin button beside a selection). */
  onComment: (blockId: string, quote: string) => void
  /** Show a paragraph's comments (its highlighted text was clicked). */
  onShowComments: (blockId: string) => void
  /** Show the contract as text instead: called when it can't be laid out, with why. */
  onShowText: (why: string) => void
}

type Loaded = {
  sd: SuperDoc
  ids: Record<string, string>
  host: HTMLDivElement
  /** Each paragraph's text in the page (all changes applied), as last saved to the review. */
  texts: Map<string, string>
  /** Text typed into a paragraph that was then split (Enter): saved with the split. */
  pending: Map<string, string>
}
type Placed = { top: number; height: number; left: number; right: number }

/** Paragraph ids in a page fragment's element. */
const nodeId = (el: Element) => (el as HTMLElement).dataset.sourceNodeId ?? ''
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

export function WordView({ session, reviewer, onFocusBlock, onSelectChanges, act, onComment, onShowComments, onShowText }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const current = useRef<Loaded | null>(null)
  const cb = useRef({ onFocusBlock, onSelectChanges, act, onShowComments, onComment, onShowText })
  cb.current = { onFocusBlock, onSelectChanges, act, onShowComments, onComment, onShowText }
  /** The paragraph last clicked into (where the caret is). */
  const caretIn = useRef<string | null>(null)
  /** The margin's comment button, level with a selection, to the right of the text. */
  const [bubble, setBubble] = useState<{ top: number; left: number; blockId: string; quote: string } | null>(null)
  /** Reviews that come back from saving our own typing: the page already shows them. */
  const typed = useRef(new Set<ReviewSession>())
  const syncing = useRef(0)
  const model = useRef<DocReview>(session.doc!)
  model.current = session.doc!
  const [loading, setLoading] = useState(true)
  const [gutter, setGutter] = useState<{ bars: (Placed & { bar: string })[]; runs: (Placed & { state: GutterState })[]; ai: (Placed & { titles: string[]; blockIds: string[]; quote: string })[] }>({
    bars: [],
    runs: [],
    ai: []
  })

  /** Where each review paragraph is on the page (its fragments, one per page it's on). */
  const measuring = useRef(0)
  /** Measure on the next frame (many changes to the page come at once). */
  const remeasure = () => {
    cancelAnimationFrame(measuring.current)
    measuring.current = requestAnimationFrame(measure)
  }
  const measure = () => {
    const w = wrap.current
    const loaded = current.current
    if (!w || !loaded) return
    const base = w.getBoundingClientRect()
    const at = (r: DOMRect) => ({ top: r.top - base.top + w.scrollTop, height: r.height, left: r.left - base.left, right: r.right - base.left })
    // Paragraphs and table-cell paragraphs both carry their id. A review paragraph's pieces side by
    // side (a table row's cells) are one place, from the leftmost; pieces on later pages are more.
    const byBlock = new Map<string, Placed[]>()
    for (const el of loaded.host.querySelectorAll('[data-source-node-id]')) {
      const blockId = loaded.ids[nodeId(el)]
      if (!blockId) continue
      const r = at(el.getBoundingClientRect())
      if (!r.height) continue
      // In a table: level with the table's left edge (a row's first cell may be merged from above).
      const table = el.classList.contains('superdoc-fragment') ? null : el.closest('.superdoc-fragment')
      if (table) {
        const t = at(table.getBoundingClientRect())
        r.left = t.left
        r.right = t.right
      }
      const list = byBlock.get(blockId) ?? []
      const same = list.find((x) => r.top < x.top + x.height && x.top < r.top + r.height)
      if (same) {
        const bottom = Math.max(same.top + same.height, r.top + r.height)
        same.top = Math.min(same.top, r.top)
        same.height = bottom - same.top
        same.left = Math.min(same.left, r.left)
        same.right = Math.max(same.right, r.right)
      } else list.push(r)
      byBlock.set(blockId, list)
    }
    for (const list of byBlock.values()) list.sort((a, b) => a.top - b.top)
    const d = model.current
    const bars: (Placed & { bar: string })[] = []
    const runs: (Placed & { state: GutterState })[] = []
    const run: { top: number; left: number; bottom: number; state?: GutterState } = { top: 0, left: 0, bottom: 0 }
    const end = () => run.state && runs.push({ top: run.top, height: run.bottom - run.top, left: run.left, right: run.left, state: run.state })
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
    // Two highlights in one paragraph: their markers one under the other, not on top of each other.
    ai.sort((x, y) => x.top - y.top)
    for (let i = 1; i < ai.length; i++) if (ai[i].top < ai[i - 1].top + 28) ai[i] = { ...ai[i], top: ai[i - 1].top + 28 }
    setGutter({ bars, runs, ai })
  }

  /** The page's paragraphs in order, as text with all changes applied (Word's own numbers aren't part of it). */
  const pageBlocks = async (loaded: Loaded) => {
    const x = await Promise.resolve(loaded.sd.activeEditor?.doc?.extract({})).catch(() => null)
    return ((x?.blocks ?? []) as { nodeId: string; text?: string }[]).map((b) => ({ nodeId: b.nodeId, text: b.text ?? '' }))
  }
  const pageTexts = async (loaded: Loaded) => new Map((await pageBlocks(loaded)).filter((b) => loaded.ids[b.nodeId]).map((b) => [b.nodeId, b.text]))

  /**
   * The review's wording for a paragraph after its text in the page went from `was` to `now`: the
   * same change, placed from the end of the paragraph, so a number that reads differently at the
   * start (Word's own, or one we renumbered) can't become an edit.
   */
  const wordingFor = (b: DocBlock, was: string, now: string) => {
    let p = 0
    while (p < was.length && p < now.length && was[p] === now[p]) p++
    let q = 0
    while (q < was.length - p && q < now.length - p && was[was.length - 1 - q] === now[now.length - 1 - q]) q++
    const ours = shownText(marksFor(model.current, b))
    const end = ours.length - q
    const start = end - (was.length - q - p)
    return start >= 0 && ours.slice(start, end) === was.slice(p, was.length - q) ? ours.slice(0, start) + now.slice(p, now.length - q) + ours.slice(end) : now
  }

  /** Apply a change from the page to the review; the page already shows it, so it isn't laid out again. */
  const apply = async (p: Promise<ReviewSession>) => {
    void p.then((x) => typed.current.add(x)).catch(() => undefined)
    return cb.current.act(p)
  }

  /**
   * Save what was typed into the page. A paragraph whose text changed gets the same change in the
   * review's wording for it. A new paragraph (Enter) is the paragraph before it split, as Enter
   * does in the text view, and becomes ours. One of ours that's gone (merged back with Backspace)
   * is removed; one of theirs that's gone is struck.
   */
  const sync = async (loaded: Loaded) => {
    const now = await pageBlocks(loaded)
    const blockOf = (nodeId: string) => model.current.blocks.find((x) => x.id === loaded.ids[nodeId])
    let prev: string | null = null
    for (let i = 0; i < now.length; i++) {
      const { nodeId, text } = now[i]
      if (!loaded.ids[nodeId]) {
        // New: split the paragraph before it (its text as it now reads stays with it).
        const b = prev ? blockOf(prev) : undefined
        if (!b || !prev) continue
        const was = loaded.texts.get(prev) ?? ''
        const head = loaded.pending.get(prev) ?? was
        const newId = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const r = await window.api.doc.split(session.id, b.id, wordingFor(b, was, head), text, newId, listAfter(model.current, b) ?? null).catch(() => null)
        if (!r) continue
        loaded.pending.delete(prev)
        loaded.texts.set(prev, head)
        loaded.ids[nodeId] = r.id
        loaded.texts.set(nodeId, text)
        // The caret went on into the new paragraph (Enter), so Tab numbers that one.
        caretIn.current = r.id
        await apply(Promise.resolve(r.session))
        prev = nodeId
        continue
      }
      const was = loaded.texts.get(nodeId)
      if (was !== undefined && was !== text) {
        // Changed: saved now, unless a new paragraph follows (the split saves it with that).
        if (now[i + 1] && !loaded.ids[now[i + 1].nodeId]) loaded.pending.set(nodeId, text)
        else {
          const b = blockOf(nodeId)
          loaded.texts.set(nodeId, text)
          if (b) await apply(window.api.doc.edit(session.id, b.id, wordingFor(b, was, text), `word:${b.id}`))
        }
      }
      prev = nodeId
    }
    // Paragraphs that are gone: ours removed, theirs struck.
    const present = new Set(now.map((b) => b.nodeId))
    for (const nodeId of [...loaded.texts.keys()]) {
      if (present.has(nodeId)) continue
      const b = blockOf(nodeId)
      loaded.texts.delete(nodeId)
      if (!b) continue
      await apply(b.ours ? window.api.doc.unsplit(session.id, b.id) : window.api.doc.edit(session.id, b.id, '', `word:${b.id}`))
    }
  }

  /**
   * Tint the text an AI marker's answers are about (hovering the marker), as the text view does:
   * the page's text runs in its paragraphs that the highlighted words cover.
   */
  const preview = (a: { blockIds: string[]; quote: string } | null) => {
    const loaded = current.current
    if (!loaded) return
    for (const el of loaded.host.querySelectorAll('.wv-ai-preview')) el.classList.remove('wv-ai-preview')
    if (!a) return
    const want = new Set(a.blockIds)
    // The paragraphs' text runs in order, deleted words included.
    const all = [...loaded.host.querySelectorAll('[data-source-node-id]')]
      .filter((x) => want.has(loaded.ids[nodeId(x)]))
      .flatMap((x) => [...x.querySelectorAll('.superdoc-text-run')])
    const deleted = (r: Element) => !!r.closest('[data-track-change-kind="delete"]')
    // Find the words: in the text as it reads (deletions out), or failing that with them in;
    // whitespace aside (paragraph breaks, Word's numbers' tabs).
    const find = (runs: Element[]) => {
      let text = ''
      const spans = runs.map((r) => {
        const from = text.length
        text += r.textContent ?? ''
        return { r, from, to: text.length }
      })
      const solid: number[] = []
      for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) solid.push(i)
      const needle = a.quote.replace(/\s+/g, '')
      const at = needle ? solid.map((i) => text[i]).join('').indexOf(needle) : -1
      if (at < 0) return null
      const from = solid[at]
      const to = solid[at + needle.length - 1] + 1
      return spans.filter((x) => x.from < to && x.to > from).map((x) => x.r)
    }
    const hit = find(all.filter((r) => !deleted(r))) ?? find(all)
    if (!hit?.length) return
    // Everything from the first word to the last, deletions between them too: one tint, one colour.
    const first = all.indexOf(hit[0])
    const last = all.indexOf(hit[hit.length - 1])
    for (const r of all.slice(first, last + 1)) r.classList.add('wv-ai-preview')
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
    // A replacement is one change (its deletion and insertion are decided together), as in the text view.
    const first = groupOf(b, seg)[0] ?? seg
    if (!picked.some((p) => p.kind === 'theirs' && p.blockId === b.id && groupOf(b, p.seg).includes(first))) picked.push({ blockId: b.id, kind: 'theirs', seg: first })
  }

  /**
   * What was clicked or selected on the page, as the review knows it. A selection: its paragraphs,
   * its text (for the AI questions) and their changes in it. A click: its paragraph, and the change
   * of theirs it's in, if any (read from the page, since a click selects nothing in this view).
   */
  const report = async (loaded: Loaded, clicked: Element | null, y: number) => {
    const sel = loaded.sd.ui?.selection.getSnapshot()
    const picked: SelectedChange[] = []
    setBubble(null)
    if (sel && !sel.empty && sel.target && sel.quotedText.trim()) {
      const blockIds = [...new Set(sel.target.segments.map((x) => loaded.ids[x.blockId]).filter(Boolean))]
      for (const id of sel.activeChangeIds) await theirChange(loaded, id, blockIds[0], picked)
      if (!blockIds.length) return
      // The comment button: level with where the selection ended, beside the text.
      const w = wrap.current
      const fragment = clicked?.closest('.superdoc-fragment[data-source-node-id]') ?? clicked?.closest('[data-source-node-id]')
      if (w && fragment) {
        const base = w.getBoundingClientRect()
        const r = fragment.getBoundingClientRect()
        setBubble({ top: y - base.top - 15, left: r.right - base.left + 14, blockId: loaded.ids[nodeId(fragment)] ?? blockIds[0], quote: sel.quotedText })
      }
      cb.current.onFocusBlock(blockIds[0])
      cb.current.onSelectChanges(picked, { blockId: blockIds[0], blockIds, quote: sel.quotedText })
      return
    }
    const fragment = clicked?.closest('[data-source-node-id]')
    const blockId = fragment ? loaded.ids[nodeId(fragment)] : undefined
    const change = (clicked?.closest('[data-track-change-id]') as HTMLElement | null)?.dataset.trackChangeId
    if (change) await theirChange(loaded, change, blockId, picked)
    // Text a comment is on, not in a change: its comments, as clicking a highlight does in the text view.
    if (!picked.length && blockId && clicked?.closest('[data-comment-ids]')) return cb.current.onShowComments(blockId)
    caretIn.current = blockId ?? null
    cb.current.onFocusBlock(blockId ?? null)
    cb.current.onSelectChanges(picked.length ? picked : null)
  }

  // Lay the review out again when it changes: the new page is built out of sight and swapped in
  // when it's ready, so nothing flickers and the scroll position stays.
  useEffect(() => {
    if (typed.current.has(session) && current.current) {
      typed.current.delete(session)
      remeasure()
      return
    }
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
            // Typing is suggesting: what you type is your tracked change, in your name.
            documentMode: 'suggesting',
            user: { name: reviewer, email: '' },
            modules: { comments: false },
            // Nothing about the document leaves this computer.
            telemetry: { enabled: false },
            onReady: () => resolve(made),
            // Typing: saved to the review after a pause.
            onEditorUpdate: () => {
              const loaded = current.current
              if (!loaded || loaded.sd !== made) return
              window.clearTimeout(syncing.current)
              syncing.current = window.setTimeout(() => void sync(loaded), 600)
            },
            onException: (e: unknown) => reject(e instanceof Error ? e : new Error(String((e as { error?: unknown })?.error ?? e)))
          } as ConstructorParameters<typeof SuperDoc>[0])
        })
        if (cancelled) {
          sd.destroy()
          host.remove()
          return
        }
        const old = current.current
        const loaded: Loaded = { sd, ids, host, texts: new Map(), pending: new Map() }
        loaded.texts = await pageTexts(loaded)
        current.current = loaded
        host.classList.remove('loading')
        if (old) {
          old.sd.destroy()
          old.host.remove()
        }
        // SuperDoc paints pages as it lays them out, after it's ready: measure as they change.
        new MutationObserver(remeasure).observe(host, { childList: true, subtree: true })
        // Tab / Shift-Tab in a numbered paragraph of ours: its level, as in the text view (the page
        // is laid out again with the new numbers). Elsewhere Tab does nothing: it never leaves the page.
        host.addEventListener(
          'keydown',
          (e) => {
            if (e.key !== 'Tab') return
            e.preventDefault()
            e.stopPropagation()
            const b = model.current.blocks.find((x) => x.id === caretIn.current)
            const list = b && indentList(model.current, b, e.shiftKey ? -1 : 1)
            if (b && list) void cb.current.act(window.api.doc.setList(session.id, b.id, list))
          },
          true
        )
        // After SuperDoc has settled the selection the click or drag made.
        host.addEventListener('pointerup', (e) => {
          const target = e.target as Element
          const y = e.clientY
          window.setTimeout(() => void report(loaded, target, y), 120)
        })
        setLoading(false)
        remeasure()
      } catch (e) {
        // It can't be laid out (SuperDoc failed on it): the review goes on as text.
        if (!cancelled) {
          console.warn('Word layout failed:', e)
          cb.current.onShowText(e instanceof Error ? e.message : String(e))
        }
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
    const ro = new ResizeObserver(remeasure)
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
      const el = [...loaded.host.querySelectorAll('[data-source-node-id]')].find((x) => want.has(loaded.ids[nodeId(x)]))
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => setFlashFallback(null)
  }, [])

  return (
    <div className="wv-wrap" ref={wrap}>
      {loading && <div className="wv-loading">Laying out the document…</div>}
      <div className="wv-stage" ref={stage} />
      <div className="wv-gutter">
        {gutter.bars.map((b, i) => (
          <div key={`b${i}`} className={`wv-bar ${b.bar}`} style={{ top: b.top, height: b.height, left: b.left - 14 }} />
        ))}
        {gutter.runs.map((r, i) => (
          <div key={`r${i}`} className="wv-run" style={{ top: r.top, height: r.height, left: r.left - 84 }}>
            <span className={`ed-unchanged ${r.state}`} data-tip={GUTTER[r.state].tip}>
              {GUTTER[r.state].label}
            </span>
          </div>
        ))}
        {bubble && (
          <button
            className="ed-gutter-btn out wv-comment"
            style={{ top: bubble.top, left: bubble.left }}
            title="Comment on the selected text (in the right-hand column)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              cb.current.onComment(bubble.blockId, bubble.quote)
              setBubble(null)
            }}
          >
            <CommentIcon size={16} />
            <span>{commentLabel((model.current.blocks.find((b) => b.id === bubble.blockId)?.comments?.length ?? 0) + model.current.comments.filter((c) => c.blockId === bubble.blockId).length)}</span>
          </button>
        )}
        {gutter.ai.map((a, i) => (
          <button
            key={`a${i}`}
            className="wv-ai"
            style={{ top: a.top, left: a.right + 12 }}
            title={`AI answers for this text (${a.titles.map((t) => `“${t}”`).join(', ')}). Click to show them.`}
            aria-label="Show the AI answers for this text"
            onClick={() => {
              preview(null)
              cb.current.onFocusBlock(a.blockIds[0])
              cb.current.onSelectChanges([], { blockId: a.blockIds[0], blockIds: a.blockIds, quote: a.quote })
            }}
            onMouseEnter={() => preview(a)}
            onMouseLeave={() => preview(null)}
          >
            <Icon name="sparkle" size={13} stroke={2.2} />
            <span>{a.titles.length === 1 ? '1 Ask' : `${a.titles.length} Asks`}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
