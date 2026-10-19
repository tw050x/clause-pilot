import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SuperDoc } from 'superdoc'
import 'superdoc/style.css'
import type { DocBlock, DocReview, ReviewSession } from '@shared/types'
import { indentList, listAfter } from '@shared/numbering'
import { commentResolved, groupOf, marksFor, segmentsOf, shownText } from '@shared/changes'
import { DEFAULTS, questionIdOf } from '@shared/questions'
import { GUTTER, paragraphState, plainText, type GutterState } from '../lib/paragraphState'
import { commentLabel, setFlashFallback, type Highlight, type SelectedChange } from './DocEditor'
import { CommentIcon, Icon } from '../lib/icons'
import { stagesOf, type Stage } from '../lib/stages'

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
  /** Show only a paragraph's comments (the comment marker beside it). */
  onOpenComments: (blockId: string) => void
  /** Show only the questions asked of some text (the AI marker beside it). */
  onOpenAi: (hl: Highlight) => void
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

/** The stages card's padding, the same on every side, around the paragraph, its labels and markers. */
const CARD_PAD = 12
/** Its buttons' height, and the gap between the paragraph and them. */
const CARD_BUTTONS = 22
const CARD_GAP = 12
/** Room made around a layered paragraph for its stages card: its padding above, its buttons below. */
const STAGES_TOP = CARD_PAD + 2
const STAGES_BOTTOM = CARD_GAP + CARD_BUTTONS + CARD_PAD + 2

/** A layered paragraph's stages card: where it is, and how its text is set (to show a stage in it). */
type Card = Placed & { blockId: string; label: string; stages: Stage[]; textTop: number; textLeft: number; textWidth: number; font: { family: string; size: string; lineHeight: string; align: string } }
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

/**
 * The page's text runs in some review paragraphs (deleted words included), and those the words of
 * `quote` are in: found in the text as it reads (deletions out), or failing that with them in,
 * whitespace aside (paragraph breaks, Word's numbers' tabs). No hit: the paragraphs don't have
 * those words any more.
 */
function textRuns(loaded: Loaded, blockIds: string[], quote: string, reviewer: string): { all: Element[]; hit: Element[] | null } {
  const want = new Set(blockIds)
  // The paragraphs' text runs in order, deleted words included.
  const all = [...loaded.host.querySelectorAll('[data-source-node-id]')]
    .filter((x) => want.has(loaded.ids[nodeId(x)]))
    .flatMap((x) => [...x.querySelectorAll('.superdoc-text-run')])
  const change = (r: Element) => r.closest('[data-track-change-kind]') as HTMLElement | null
  const kind = (r: Element) => change(r)?.dataset.trackChangeKind
  const ours = (r: Element) => change(r)?.dataset.trackChangeAuthor === reviewer
  // Find the words, whitespace aside (paragraph breaks, Word's numbers' tabs).
  const find = (runs: Element[]) => {
    let text = ''
    const spans = runs.map((r) => {
      const from = text.length
      text += r.textContent ?? ''
      return { r, from, to: text.length }
    })
    const solid: number[] = []
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) solid.push(i)
    const needle = quote.replace(/\s+/g, '')
    const at = needle ? solid.map((i) => text[i]).join('').indexOf(needle) : -1
    if (at < 0) return null
    const from = solid[at]
    const to = solid[at + needle.length - 1] + 1
    return spans.filter((x) => x.from < to && x.to > from).map((x) => x.r)
  }
  // In the paragraph as it reads now, as they proposed it (before our edits), or as it first read:
  // a question may have been asked of any of them, and a redline interleaves them word by word.
  const hit =
    find(all.filter((r) => kind(r) !== 'delete')) ??
    find(all.filter((r) => !(kind(r) === 'insert' && ours(r)) && !(kind(r) === 'delete' && !ours(r)))) ??
    find(all.filter((r) => kind(r) !== 'insert'))
  return { all, hit }
}

export function WordView({ session, reviewer, onFocusBlock, onSelectChanges, act, onOpenComments, onOpenAi, onShowComments, onShowText }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const current = useRef<Loaded | null>(null)
  const cb = useRef({ onFocusBlock, onSelectChanges, act, onShowComments, onOpenComments, onOpenAi, onShowText })
  cb.current = { onFocusBlock, onSelectChanges, act, onShowComments, onOpenComments, onOpenAi, onShowText }
  /** The paragraph last clicked into (where the caret is). */
  const caretIn = useRef<string | null>(null)
  /** A paragraph's comments not yet resolved, theirs and ours. */
  const openComments = (blockId: string) => {
    const d = model.current
    return (d.blocks.find((b) => b.id === blockId)?.comments ?? []).filter((c) => !commentResolved(d, c)).length + d.comments.filter((c) => c.blockId === blockId && !commentResolved(d, c)).length
  }
  /** Reviews that come back from saving our own typing: the page already shows them. */
  const typed = useRef(new Set<ReviewSession>())
  const syncing = useRef(0)
  const model = useRef<DocReview>(session.doc!)
  model.current = session.doc!
  const [loading, setLoading] = useState(true)
  const [gutter, setGutter] = useState<{ bars: (Placed & { bar: string; blockId: string })[]; runs: (Placed & { state: GutterState })[]; ai: (Placed & { titles: string[]; blockIds: string[]; quote: string; stale: boolean })[]; notes: (Placed & { blockId: string; count: number; quotes: (string | undefined)[] })[]; cards: Card[] }>({
    bars: [],
    runs: [],
    ai: [],
    notes: [],
    cards: []
  })

  /** Where each review paragraph is on the page (its fragments, one per page it's on). */
  const measuring = useRef(0)
  /** Measure on the next frame (many changes to the page come at once). */
  const remeasure = () => {
    cancelAnimationFrame(measuring.current)
    measuring.current = requestAnimationFrame(measure)
  }
  /**
   * Room on the page for each layered paragraph's stages card: space above it for the card's
   * buttons and below it for the longest stage, made by moving the paragraphs under it on its
   * page down and making the page that much taller (nothing moves onto another page; a footer
   * moves down with the page's end). The page's own positions are kept, so this can be done
   * again whenever the page is drawn again.
   */
  const pads = useRef(new Map<string, { top: number; bottom: number }>())
  const sizer = useRef<HTMLDivElement | null>(null)
  const makeRoom = (loaded: Loaded) => {
    const d = model.current
    const orig = (el: HTMLElement, prop: 'top' | 'height') => {
      const was = el.dataset[`wv${prop}`]
      return was !== undefined && el.dataset[`wvset${prop}`] === el.style[prop] ? Number(was) : parseFloat(el.style[prop]) || 0
    }
    const put = (el: HTMLElement, prop: 'top' | 'height' | 'minHeight', from: number, to: number) => {
      const key = prop === 'minHeight' ? 'height' : prop
      if (prop !== 'minHeight') el.dataset[`wv${key}`] = String(from)
      const v = `${to}px`
      if (el.style[prop] !== v) el.style[prop] = v
      if (prop !== 'minHeight') el.dataset[`wvset${key}`] = el.style[prop]
    }
    const pages = [...loaded.host.querySelectorAll<HTMLElement>('.superdoc-page')]
    const frags = pages.map((page) =>
      ([...page.children] as HTMLElement[])
        .filter((f) => f.dataset.layoutStory === 'body' && f.style.top)
        .map((f) => ({ f, top: orig(f, 'top'), blockId: loaded.ids[nodeId(f)] }))
        .sort((a, b) => a.top - b.top)
    )
    const all = frags.flat()
    const next = new Map<string, { top: number; bottom: number }>()
    for (const b of d.blocks) {
      const stages = stagesOf(d, b)
      const mine = stages ? all.filter((x) => x.blockId === b.id) : []
      if (!stages || !mine.length) continue
      // Below it: the longest stage's text, set as the paragraph is, less the paragraph's height.
      const run = mine[0].f.querySelector('.superdoc-text-run')
      const line = mine[0].f.querySelector<HTMLElement>('.superdoc-line')
      const height = mine.reduce((n, x) => n + x.f.offsetHeight, 0)
      let el = sizer.current
      if (!el) {
        el = sizer.current = document.createElement('div')
        el.className = 'wv-sizer'
        document.body.appendChild(el)
      }
      const cs = run ? getComputedStyle(run) : null
      Object.assign(el.style, { width: `${mine[0].f.offsetWidth}px`, fontFamily: cs?.fontFamily ?? '', fontSize: cs?.fontSize ?? '', lineHeight: line?.style.lineHeight ?? '' })
      let tallest = 0
      for (const st of stages) {
        el.textContent = (b.label ? `${b.label} ` : '') + st.segments.map((x) => x.text).join('')
        tallest = Math.max(tallest, el.offsetHeight)
      }
      next.set(b.id, { top: STAGES_TOP, bottom: Math.max(0, tallest - height) + STAGES_BOTTOM })
    }
    pads.current = next
    const firstOf = new Map<string, HTMLElement>()
    const lastOf = new Map<string, HTMLElement>()
    for (const x of all) {
      if (!x.blockId || !next.has(x.blockId)) continue
      if (!firstOf.has(x.blockId)) firstOf.set(x.blockId, x.f)
      lastOf.set(x.blockId, x.f)
    }
    pages.forEach((page, i) => {
      let off = 0
      for (const x of frags[i]) {
        const pad = next.get(x.blockId)
        if (pad && firstOf.get(x.blockId) === x.f) off += pad.top
        put(x.f, 'top', x.top, x.top + off)
        if (pad && lastOf.get(x.blockId) === x.f) off += pad.bottom
      }
      for (const f of [...page.children] as HTMLElement[])
        if (f.dataset.layoutStory?.startsWith('footer') && f.style.top) {
          const top = orig(f, 'top')
          put(f, 'top', top, top + off)
        }
      const h = orig(page, 'height')
      put(page, 'height', h, h + off)
      put(page, 'minHeight', h, h + off)
    })
  }
  useEffect(() => () => sizer.current?.remove(), [])

  const measure = () => {
    const w = wrap.current
    const loaded = current.current
    if (!w || !loaded) return
    makeRoom(loaded)
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
    const bars: (Placed & { bar: string; blockId: string })[] = []
    const runs: (Placed & { state: GutterState })[] = []
    const run: { top: number; left: number; bottom: number; state?: GutterState } = { top: 0, left: 0, bottom: 0 }
    const end = () => run.state && runs.push({ top: run.top, height: run.bottom - run.top, left: run.left, right: run.left, state: run.state })
    for (const b of d.blocks) {
      const places = byBlock.get(b.id)
      if (!places?.length) continue
      const marks = marksFor(d, b)
      const { bar, state } = paragraphState(d, b, shownText(marks), marks.length, plainText(d, b))
      for (const p of places) bars.push({ ...p, bar, blockId: b.id })
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
    // A marker level with the line its words start on (the page's line, not the paragraph's top),
    // or with the paragraph's first line when the words aren't there any more.
    const lineOf = (blockIds: string[], quote: string | undefined) => {
      const hit = quote?.trim() ? textRuns(loaded, blockIds, quote, reviewer).hit : null
      const el = hit?.[0]
      return el ? at((el.closest('.superdoc-line') ?? el).getBoundingClientRect()).top : null
    }
    // Text with AI answers: a marker beside the first line of each highlight.
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
      // Asked of wording the paragraph no longer has (changed since): says so, and hovering it
      // shows the paragraph as a whole.
      const top = lineOf(g.blockIds, g.quote)
      return p ? [{ ...p, top: top ?? p.top, blockIds: g.blockIds, quote: g.quote, titles: [...g.titles], stale: top === null }] : []
    })
    // Paragraphs with comments still open: their count, always shown, beside the first line one
    // is on (a reply, where the comment it answers is).
    const notes = d.blocks.flatMap((b) => {
      const p = byBlock.get(b.id)?.[0]
      const count = openComments(b.id)
      if (!p || !count) return []
      const theirs = (b.comments ?? []).filter((c) => !commentResolved(d, c))
      const ours = d.comments.filter((c) => c.blockId === b.id && !commentResolved(d, c))
      const quotes = [...theirs.map((c) => c.quote), ...ours.map((c) => c.quote ?? b.comments?.find((x) => x.id === c.replyTo)?.quote)]
      const tops = quotes.map((q) => lineOf([b.id], q)).filter((t): t is number => t !== null)
      return [{ ...p, top: tops.length ? Math.min(...tops) : p.top, blockId: b.id, count, quotes }]
    })
    // Markers in the right margin one under the other, not on top of each other (two highlights
    // in one paragraph; a comment marker under the AI markers beside it).
    const column = [...ai.map((m) => ({ m, kind: 0 })), ...notes.map((m) => ({ m, kind: 1 }))].sort((x, y) => x.m.top - y.m.top || x.kind - y.kind)
    for (let i = 1; i < column.length; i++) if (column[i].m.top < column[i - 1].m.top + 19) column[i].m.top = column[i - 1].m.top + 19
    // Layered paragraphs: their stages cards, over the paragraph and the room made for them.
    const cards: Card[] = d.blocks.flatMap((b) => {
      const pad = pads.current.get(b.id)
      const places = byBlock.get(b.id)
      const stages = pad && stagesOf(d, b)
      if (!pad || !places?.length || !stages) return []
      const first = places[0]
      const last = places[places.length - 1]
      const el = [...loaded.host.querySelectorAll<HTMLElement>('[data-source-node-id]')].find((x) => loaded.ids[nodeId(x)] === b.id)
      const run = el?.querySelector('.superdoc-text-run')
      const cs = run ? getComputedStyle(run) : null
      const top = first.top - CARD_PAD
      const bottom = last.top + last.height + pad.bottom - 2
      // Its sides are fitted to the labels and markers once they're drawn (see below).
      const gap = Math.max(6, first.left - 90)
      return [
        {
          blockId: b.id,
          label: b.label ?? '',
          stages,
          top,
          height: bottom - top,
          left: gap,
          right: first.right + 74,
          textTop: first.top - top,
          textLeft: first.left - gap,
          textWidth: first.right - first.left,
          font: { family: cs?.fontFamily ?? '', size: cs?.fontSize ?? '', lineHeight: el?.querySelector<HTMLElement>('.superdoc-line')?.style.lineHeight ?? '', align: el?.style.textAlign ?? '' }
        }
      ]
    })
    setGutter({ bars, runs, ai, notes, cards })
    // The page may have been drawn again: the picked changes' tint with it.
    tintPicks()
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
   * Tint the text a marker is about (hovering it), as the text view does: the page's text runs in
   * its paragraphs that the highlighted words cover. Several quotes (a paragraph's comments) are
   * each tinted.
   */
  const preview = (a: { blockIds: string[]; quote?: string; quotes?: (string | undefined)[] } | null) => {
    const loaded = current.current
    if (!loaded) return
    for (const el of loaded.host.querySelectorAll('.wv-ai-preview')) el.classList.remove('wv-ai-preview')
    if (!a) return
    let any = false
    let all: Element[] = []
    for (const quote of a.quotes ?? [a.quote]) {
      const found = textRuns(loaded, a.blockIds, quote ?? '', reviewer)
      all = found.all
      if (!found.hit?.length) continue
      // Everything from the first word to the last, deletions between them too: one tint, one colour.
      const first = all.indexOf(found.hit[0])
      const last = all.indexOf(found.hit[found.hit.length - 1])
      for (const r of all.slice(first, last + 1)) r.classList.add('wv-ai-preview')
      any = true
    }
    // Wording the paragraph no longer has (or none: a comment on the whole paragraph): the paragraph.
    if (!any) for (const r of all) r.classList.add('wv-ai-preview')
  }

  /** One of their tracked changes on the page (SuperDoc's id), as the review's change in that paragraph. */
  const theirChange = async (loaded: Loaded, id: string, blockId: string | undefined, picked: SelectedChange[], shown: string[] = []) => {
    const c = await Promise.resolve(loaded.sd.activeEditor?.doc?.trackChanges.get({ id })).catch(() => null)
    if (!c || c.author === reviewer) return
    const at = (c as { navigationTarget?: { blockId?: string } }).navigationTarget?.blockId ?? ''
    const b = model.current.blocks.find((x) => x.id === (loaded.ids[at] ?? blockId))
    if (!b) return
    // The change's text, with the paragraph's number when the whole paragraph went ("3.3 …").
    const same = (t: string | null | undefined, x: string) => !!t && (tidy(t) === tidy(x) || (!!b.label && tidy(t) === tidy(`${b.label} ${x}`)))
    let seg = segmentsOf(b).findIndex((x) => x.op !== 'same' && [c.insertedText, c.deletedText].some((t) => same(t, x.text)))
    // A paragraph they deleted is one change, however the page splits it.
    if (seg < 0 && b.kind === 'deleted' && c.deletedText) seg = 0
    if (seg < 0) return
    shown.push(id)
    // A replacement is one change (its deletion and insertion are decided together), as in the text view.
    const first = groupOf(b, seg)[0] ?? seg
    if (!picked.some((p) => p.kind === 'theirs' && p.blockId === b.id && groupOf(b, p.seg).includes(first))) picked.push({ blockId: b.id, kind: 'theirs', seg: first })
  }

  /**
   * Select whole paragraphs from their bars: a click selects one, a drag from one bar up or down
   * selects every paragraph it passes. The paragraphs are tinted while dragging; on release they
   * become the page's selection, so the review column, the AI questions and the comment button
   * follow it as they follow selected text.
   */
  /**
   * The layered paragraph the pointer is over (its stages card shows), and the stage each shows
   * (0, or none: all changes), kept when the pointer moves away.
   */
  const [hovered, setHovered] = useState<string | null>(null)
  const [stageOf, setStageOf] = useState<Record<string, number>>({})
  useEffect(() => setStageOf({}), [session.id])
  const hoverAt = (e: React.MouseEvent) => {
    const w = wrap.current
    if (!w) return
    const r = w.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top + w.scrollTop
    const c = gutter.cards.find((c) => y >= c.top && y <= c.top + c.height && x >= c.left && x <= c.right)
    const id = c?.blockId ?? null
    if (id !== hovered) setHovered(id)
  }

  // The stages card's sides: the same padding outside the labels left of the paragraph and the
  // markers right of it as above and below (never past the page area's edges).
  useLayoutEffect(() => {
    const w = wrap.current
    if (!w) return
    const base = w.getBoundingClientRect()
    for (const el of w.querySelectorAll<HTMLElement>('.wv-stages')) {
      const c = gutter.cards.find((x) => x.blockId === el.dataset.block)
      if (!c) continue
      const textLeft = c.left + c.textLeft
      let lo = textLeft
      let hi = textLeft + c.textWidth
      for (const m of w.querySelectorAll<HTMLElement>('.wv-run .ed-unchanged, .wv-gutter > .wv-ai')) {
        const r = m.getBoundingClientRect()
        const y = r.top - base.top + w.scrollTop
        if (y + r.height <= c.top || y >= c.top + c.height) continue
        lo = Math.min(lo, r.left - base.left)
        hi = Math.max(hi, r.right - base.left)
      }
      const left = Math.max(6, lo - CARD_PAD)
      const right = Math.min(w.clientWidth - 6, hi + CARD_PAD)
      el.style.left = `${left}px`
      el.style.width = `${right - left}px`
      el.style.setProperty('--text-left', `${textLeft - left}px`)
    }
  })

  const dragging = useRef<{ from: string; to: string } | null>(null)
  const [lineSel, setLineSel] = useState<string[]>([])
  const blocksBetween = (from: string, to: string) => {
    const order = model.current.blocks.map((b) => b.id)
    const [a, b] = [order.indexOf(from), order.indexOf(to)].sort((x, y) => x - y)
    const placed = new Set(gutter.bars.map((x) => x.blockId))
    return order.slice(a, b + 1).filter((id) => placed.has(id))
  }
  const barAt = (clientY: number) => {
    const w = wrap.current
    if (!w) return null
    const y = clientY - w.getBoundingClientRect().top + w.scrollTop
    const hit = gutter.bars.find((x) => y >= x.top - 6 && y <= x.top + x.height + 6)
    if (hit) return hit.blockId
    // Between bars: the nearest one.
    return [...gutter.bars].sort((a, b) => Math.abs(a.top + a.height / 2 - y) - Math.abs(b.top + b.height / 2 - y))[0]?.blockId ?? null
  }
  const selectBlocks = async (ids: string[]) => {
    const loaded = current.current
    if (!loaded || !ids.length) return
    const paraIds = (id: string) => Object.keys(loaded.ids).filter((k) => loaded.ids[k] === id)
    const first = paraIds(ids[0])[0]
    const last = paraIds(ids[ids.length - 1]).pop()
    if (!first || !last) return
    const texts = await pageTexts(loaded)
    const capture = {
      status: 'ready',
      empty: false,
      target: null,
      selectionTarget: { kind: 'selection', start: { kind: 'text', blockId: first, offset: 0 }, end: { kind: 'text', blockId: last, offset: (texts.get(last) ?? '').length } },
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      quotedText: ''
    }
    loaded.sd.ui?.selection.restore(capture as unknown as Parameters<NonNullable<typeof loaded.sd.ui>['selection']['restore']>[0])
    // Once SuperDoc has the selection, it's reported like any other.
    const el = loaded.host.querySelector(`[data-source-node-id="${last}"]`)
    window.setTimeout(() => void report(loaded, el, el?.getBoundingClientRect().bottom ?? 0), 150)
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return
      const to = barAt(e.clientY)
      if (to && to !== dragging.current.to) {
        dragging.current.to = to
        setLineSel(blocksBetween(dragging.current.from, to))
      }
    }
    const up = () => {
      if (!dragging.current) return
      const ids = blocksBetween(dragging.current.from, dragging.current.to)
      dragging.current = null
      setLineSel([])
      void selectBlocks(ids)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  /**
   * Their changes picked on the page (SuperDoc's ids), tinted there as selected text is: a click
   * in a change selects nothing of the page's own, and a deletion can't be selected as text.
   */
  const picks = useRef<string[]>([])
  const tintPicks = () => {
    const loaded = current.current
    if (!loaded) return
    for (const el of loaded.host.querySelectorAll('.wv-picked')) el.classList.remove('wv-picked')
    for (const id of picks.current) for (const el of loaded.host.querySelectorAll(`[data-track-change-id="${CSS.escape(id)}"]`)) el.classList.add('wv-picked')
  }
  const pick = (ids: string[]) => {
    picks.current = ids
    tintPicks()
  }

  /**
   * What was clicked or selected on the page, as the review knows it. A selection: its paragraphs,
   * its text (for the AI questions) and their changes in it. A click: its paragraph, and the change
   * of theirs it's in, if any (read from the page, since a click selects nothing in this view).
   */
  const report = async (loaded: Loaded, clicked: Element | null, y: number) => {
    const sel = loaded.sd.ui?.selection.getSnapshot()
    const picked: SelectedChange[] = []
    const shown: string[] = []
    // A selection; one of only deleted words has no text of its own, but is still their change.
    if (sel && !sel.empty && sel.target && (sel.quotedText.trim() || sel.activeChangeIds.length)) {
      const blockIds = [...new Set(sel.target.segments.map((x) => loaded.ids[x.blockId]).filter(Boolean))]
      for (const id of sel.activeChangeIds) await theirChange(loaded, id, blockIds[0], picked, shown)
      if (!blockIds.length) return
      pick(shown)
      const quote = sel.quotedText.trim() ? sel.quotedText : picked.map((p) => (p.kind === 'theirs' ? segmentsOf(model.current.blocks.find((b) => b.id === p.blockId)!)[p.seg]?.text : p.text) ?? '').join(' ')
      cb.current.onFocusBlock(blockIds[0])
      cb.current.onSelectChanges(picked, { blockId: blockIds[0], blockIds, quote })
      return
    }
    const fragment = clicked?.closest('[data-source-node-id]')
    const blockId = fragment ? loaded.ids[nodeId(fragment)] : undefined
    const change = (clicked?.closest('[data-track-change-id]') as HTMLElement | null)?.dataset.trackChangeId
    if (change) await theirChange(loaded, change, blockId, picked, shown)
    pick(shown)
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
    <div
      className="wv-wrap"
      ref={wrap}
      onMouseMove={hoverAt}
      onMouseLeave={() => setHovered(null)}
    >
      {loading && <div className="wv-loading">Laying out the document…</div>}
      <div className="wv-stage" ref={stage} />
      <div className="wv-gutter">
        {gutter.cards
          .filter((c) => c.blockId === hovered || stageOf[c.blockId])
          .map((c) => {
            const shown = stageOf[c.blockId] ?? 0
            const st = shown ? c.stages[shown - 1] : null
            return (
              <div key={`c${c.blockId}`} data-block={c.blockId} className={`wv-stages ${c.blockId === hovered ? '' : 'idle'}`} style={{ top: c.top, height: c.height, left: c.left, width: c.right - c.left }}>
                <div className="wv-stages-bar" style={{ bottom: CARD_PAD, height: CARD_BUTTONS }}>
                  {['All changes', ...c.stages.map((x) => x.name)].map((name, k) => (
                    <button
                      key={name}
                      className={k === shown ? 'on' : ''}
                      title={k ? c.stages[k - 1].detail : 'Everything at once, as in Word'}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setStageOf((m) => ({ ...m, [c.blockId]: k }))}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {st && (
                  <div
                    className="wv-stage-text"
                    style={{ top: c.textTop, height: c.height - c.textTop - STAGES_BOTTOM + 4, width: c.textWidth, fontFamily: c.font.family, fontSize: c.font.size, lineHeight: c.font.lineHeight, textAlign: (c.font.align || 'left') as 'left' }}
                  >
                    {c.label && <strong>{c.label} </strong>}
                    {!st.segments.some((x) => x.text.trim()) && <em className="wv-st-none">Not in the draft: they added this paragraph.</em>}
                    {st.segments.map((x, i) => (
                      <span key={i} className={x.op === 'ins' ? `wv-st-ins ${st.key}` : x.op === 'del' ? `wv-st-del ${st.key}` : undefined}>
                        {x.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        {gutter.bars.map((b, i) => (
          <div
            key={`b${i}`}
            className={`wv-bar ${b.bar} ${lineSel.includes(b.blockId) ? 'picked' : ''}`}
            style={{ top: b.top, height: b.height, left: b.left - 14 }}
            title="Click to select this paragraph; drag up or down to select several"
            onPointerDown={(e) => {
              e.preventDefault()
              dragging.current = { from: b.blockId, to: b.blockId }
              setLineSel([b.blockId])
            }}
          />
        ))}
        {/* The paragraphs being selected from their bars, tinted while dragging. */}
        {gutter.bars
          .filter((b) => lineSel.includes(b.blockId))
          .map((b, i) => (
            <div key={`s${i}`} className="wv-line-sel" style={{ top: b.top - 2, height: b.height + 4, left: b.left - 4, width: b.right - b.left + 8 }} />
        ))}
        {gutter.runs.map((r, i) => (
          <div key={`r${i}`} className="wv-run" style={{ top: r.top, height: r.height, left: r.left - 84 }}>
            <span className={`ed-unchanged ${r.state}`} data-tip={GUTTER[r.state].tip}>
              {GUTTER[r.state].label}
            </span>
          </div>
        ))}
        {gutter.notes.map((n) => (
          <button
            key={`n${n.blockId}`}
            className="wv-ai wv-note"
            style={{ top: n.top, left: n.right + 12 }}
            title={`${commentLabel(n.count)} on this paragraph: show them in the right-hand column`}
            aria-label={`Show ${commentLabel(n.count)}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              preview(null)
              pick([])
              cb.current.onOpenComments(n.blockId)
            }}
            onMouseEnter={() => preview({ blockIds: [n.blockId], quotes: n.quotes })}
            onMouseLeave={() => preview(null)}
          >
            <CommentIcon size={9} />
            <span>{n.count}</span>
          </button>
        ))}
        {gutter.ai.map((a, i) => (
          <button
            key={`a${i}`}
            className={`wv-ai ${a.stale ? 'stale' : ''}`}
            style={{ top: a.top, left: a.right + 12 }}
            title={`AI answers ${a.stale ? 'about this paragraph as it read before it changed' : 'for this text'} (${a.titles.map((t) => `“${t}”`).join(', ')}). Click to show them.`}
            aria-label="Show the AI answers for this text"
            onClick={() => {
              preview(null)
              pick([])
              cb.current.onOpenAi({ blockId: a.blockIds[0], blockIds: a.blockIds, quote: a.quote })
            }}
            onMouseEnter={() => preview(a)}
            onMouseLeave={() => preview(null)}
          >
            <Icon name="sparkle" size={9} stroke={2.4} />
            <span>
              {a.titles.length}
              {a.stale && <span className="wv-ai-stale"> · earlier</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
