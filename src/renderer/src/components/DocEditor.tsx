import { useEffect, useRef, useState } from 'react'
import { Schema, type Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import type { DocBlock, DocReview, ListStyle, ReviewSession } from '@shared/types'
import { labelOf, labelsOf, listAfter, parseLabel } from '@shared/numbering'
import { aiSame, changeKey, commentResolved, groupOf, hasOpenChanges, isCleared, marksFor, needsReading, segmentsOf, shownText, theyChanged } from '@shared/changes'
import type { Mark } from '@shared/diff'
import { CommentIcon, Icon } from '../lib/icons'
import { DEFAULTS, questionIdOf } from '@shared/questions'

/**
 * The contract as one editable column, like Word with Track Changes on, built on ProseMirror.
 *
 * The editable text is the next draft: the contract as it now reads. The redline is drawn
 * over it as decorations, worked out from the review model: their changes (blue), ours
 * (red, from what you've typed against what they proposed), struck text shown in place
 * but never part of the text, the printed numbers. ProseMirror does the editing itself
 * (caret, selection, typing, undo, paste); what you type is saved per paragraph as our
 * wording, exactly as before, so the marked-up copy, history and comparison are unchanged.
 *
 * Paragraphs keep their identity: Enter adds a paragraph of ours, and nothing merges two
 * paragraphs (a selection across paragraphs clears the text in each instead).
 */

interface Props {
  session: ReviewSession
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  /** The paragraph the caret is in. */
  onFocusBlock: (blockId: string | null) => void
  /** "Comment" on selected text. */
  onComment: (blockId: string, quote: string) => void
  /** The redlines inside a selection (null when you click elsewhere). */
  onSelectChanges: (changes: SelectedChange[] | null, highlight?: Highlight) => void
  /** Commented text was clicked: show that paragraph's comments. */
  onShowComments: (blockId: string) => void
  readOnly?: boolean
}

/** A redline picked out by selecting text: one of their changes, or one of ours. */
/** Highlighted text: the paragraph it starts in, every paragraph it touches, and the text. */
/** The open editor, for pointing at paragraphs from outside it. */
let flashView: EditorView | null = null
const FLASH = 'flash'
/** Paragraphs being pointed at: a passing tint, as a decoration (ProseMirror owns its DOM). */
const flashPlugin = new Plugin<string[]>({
  state: {
    init: () => [],
    apply: (tr, ids) => (tr.getMeta(FLASH) as string[] | undefined) ?? ids
  },
  props: {
    decorations(state) {
      const ids = new Set(this.getState(state))
      if (!ids.size) return null
      const out: Decoration[] = []
      state.doc.forEach((node, pos) => {
        if (ids.has(node.attrs.id)) out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ed-flash' }))
      })
      return DecorationSet.create(state.doc, out)
    }
  }
})
let flashTimer = 0

const PREVIEW = 'aiPreview'
/** The text an AI answer's marker is about, while the pointer is over the marker: tinted, as a decoration. */
const previewPlugin = new Plugin<{ from: number; to: number } | null>({
  state: {
    init: () => null,
    apply: (tr, range) => {
      const next = tr.getMeta(PREVIEW) as { from: number; to: number } | null | undefined
      if (next !== undefined) return next
      return range && tr.docChanged ? { from: tr.mapping.map(range.from), to: tr.mapping.map(range.to) } : range
    }
  },
  props: {
    decorations(state) {
      const r = this.getState(state)
      return r && r.to > r.from ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'ed-ai-preview' })]) : null
    }
  }
})

/** Point at paragraphs without changing the selection: scroll to the first and flash them. */
export function flashParagraphs(blockIds: string[]) {
  const v = flashView
  if (!v) return
  document.querySelector(`p[data-block="${blockIds[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  window.clearTimeout(flashTimer)
  v.dispatch(v.state.tr.setMeta(FLASH, []).setMeta('addToHistory', false))
  // A frame later, so a repeat flash starts its animation again.
  requestAnimationFrame(() => {
    if (flashView !== v) return
    v.dispatch(v.state.tr.setMeta(FLASH, blockIds).setMeta('addToHistory', false))
    flashTimer = window.setTimeout(() => flashView === v && v.dispatch(v.state.tr.setMeta(FLASH, []).setMeta('addToHistory', false)), 1600)
  })
}

export type Highlight = { blockId: string; blockIds: string[]; quote: string }

export type SelectedChange = { blockId: string; kind: 'theirs'; seg: number } | { blockId: string; kind: 'ours'; op: 'ins' | 'del'; text: string }

const SAVE_AFTER_MS = 450
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

const schema = new Schema({
  nodes: {
    doc: { content: 'para+' },
    para: {
      content: 'text*',
      attrs: { id: { default: '' }, kind: { default: 'para' }, center: { default: false }, bold: { default: false }, level: { default: 0 } },
      toDOM: (n) => [
        'p',
        {
          'data-block': n.attrs.id,
          class: `ed-p k-${n.attrs.kind}${n.attrs.center ? ' center' : ''}${n.attrs.bold ? ' bold' : ''}`,
          style: n.attrs.level ? `padding-left: ${n.attrs.level * 22}px` : ''
        },
        0
      ],
      parseDOM: [{ tag: 'p' }]
    },
    text: {}
  }
})

const paraOf = (b: DocBlock, text: string) => schema.node('para', { id: b.id, kind: b.kind, center: !!b.center, bold: !!b.bold, level: b.level ?? 0 }, text ? schema.text(text) : undefined)
const shownOf = (d: DocReview, b: DocBlock) => shownText(marksFor(d, b))

/** A paragraph as shown, for the text it has now: their redline, and ours worked out from it. */
function marksNow(d: DocReview, b: DocBlock, text: string): Mark[] {
  // Always from the exact text in the editor, so every mark lines up with it.
  if (d.edits[b.id] === text) return marksFor(d, b)
  const { [b.id]: _mine, ...others } = d.edits
  const plain = { ...d, edits: others }
  if (!b.ours && shownText(marksFor(plain, b)) === text) return marksFor(plain, b)
  return marksFor({ ...d, edits: { ...d.edits, [b.id]: text } }, b)
}

/** Where each mark sits in the paragraph's text: [start, end) (struck text is zero-width). */
function spans(marks: Mark[]) {
  let at = 0
  return marks.map((m, i) => {
    const struck = m.theirs === 'del' || m.ours === 'del'
    const s = at
    if (!struck) at += m.text.length
    return { m, i, s, e: at, struck }
  })
}

/** The change a mark belongs to; one of theirs is identified by its group (a replacement is one change). */
const changeOfMark = (b: DocBlock, m: Mark): SelectedChange | null =>
  m.theirs && m.seg !== undefined ? { blockId: b.id, kind: 'theirs', seg: groupOf(b, m.seg)[0] } : m.ours ? { blockId: b.id, kind: 'ours', op: m.ours, text: m.text } : null

/** The gutter's comment button's label, and about how wide the button is with it (icon, padding, ~7px a character). */
const commentLabel = (n: number) => (n ? `${n} comment${n === 1 ? '' : 's'}` : 'Comment')
/** A paragraph's state as its bar shows it, labelled in the left gutter once per run. */
type GutterState = 'unchanged' | 'checked' | 'same' | 'decide' | 'edited' | 'read'
const GUTTER: Record<GutterState, { label: string; tip: string }> = {
  unchanged: { label: 'Unchanged', tip: 'Reads exactly as our approved wording, or as we last sent it. Nothing to check.' },
  checked: { label: 'Checked', tip: 'Nothing left to check: their changes here are decided, or a reviewer marked it as checked.' },
  same: { label: 'Same intent', tip: 'The AI found it means the same as our approved wording. It only advises: decide it yourself.' },
  decide: { label: 'To decide', tip: 'Their changes, tracked or found by comparison: accept or reject them.' },
  edited: { label: 'Edited', tip: 'Your edits: they go to them as tracked changes in the marked-up copy.' },
  read: { label: 'To read', tip: 'Not our wording and nothing to accept or reject: read it, then mark it as checked.' }
}

const labelledWidth = (n: number) => 40 + commentLabel(n).length * 7

export function DocEditor({ session, act, onFocusBlock, onComment, onSelectChanges, onShowComments, readOnly }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const model = useRef(session.doc!)
  const sessionId = useRef(session.id)
  const pending = useRef(new Map<string, number>())
  const focused = useRef<SelectedChange | null>(null)
  const clicked = useRef<SelectedChange | null>(null)
  const cb = useRef({ act, onFocusBlock, onComment, onSelectChanges, onShowComments })
  cb.current = { act, onFocusBlock, onComment, onSelectChanges, onShowComments }
  /** The gutter's comment button, level with the selection; `left` (from the wrapper) when there's room beside the page for its label to run outward. */
  const [bubble, setBubble] = useState<{ x: number; y: number; blockId: string; quote: string; left?: number } | null>(null)
  /** Paragraphs that read exactly as our approved wording or as we last sent them (from the decorations). */
  /** Each shown paragraph's state, as its bar shows it: the gutter labels runs of the same state. */
  const states = useRef(new Map<string, GutterState>())
  /** Reports the selection to the review (set up with the editor). */
  const reportRef = useRef<((v: EditorView) => void) | null>(null)
  /** The left gutter: runs of paragraphs in the same state, and the highlights with AI answers, where they are on the page. */
  const [gutter, setGutter] = useState<{ runs: { top: number; height: number; state: GutterState }[]; ai: { top: number; blockIds: string[]; quote: string; titles: string[] }[] }>({ runs: [], ai: [] })
  const measuring = useRef(0)
  const measure = () => {
    cancelAnimationFrame(measuring.current)
    measuring.current = requestAnimationFrame(() => {
      const h = host.current
      if (!h) return
      const top0 = h.getBoundingClientRect().top
      const paras = [...h.querySelectorAll<HTMLElement>('p[data-block]')].filter((p) => p.offsetParent !== null)
      const box = (p: HTMLElement) => {
        const r = p.getBoundingClientRect()
        return { top: r.top - top0, bottom: r.bottom - top0 }
      }
      // Consecutive paragraphs in the same state: one run each, labelled once.
      const runs: { top: number; height: number; state: GutterState }[] = []
      const open: { top: number; bottom: number; state?: GutterState } = { top: 0, bottom: 0 }
      for (const p of [...paras, null]) {
        const state = p ? states.current.get(p.dataset.block!) : undefined
        if (state && open.state === state) {
          open.bottom = box(p!).bottom
          continue
        }
        if (open.state) runs.push({ top: open.top, height: open.bottom - open.top, state: open.state })
        Object.assign(open, p && state ? { ...box(p), state } : { state: undefined })
      }
      // Each highlight with answers: at its first paragraph on the page.
      const order = new Map(paras.map((p, i) => [p.dataset.block!, i]))
      const groups = new Map<string, { blockIds: string[]; quote: string; titles: string[]; asked: Set<string> }>()
      for (const r of model.current.aiRuns ?? []) {
        if (r.status !== 'done') continue
        // One marker per highlight: its paragraphs and its text.
        const key = `${[...r.blockIds].sort().join(',')}\u0000${r.quote.replace(/\s+/g, ' ').trim()}`
        const g = groups.get(key) ?? { blockIds: r.blockIds, quote: r.quote, titles: [], asked: new Set<string>() }
        // Each question once, by its title (runs from before questions had titles: the built-in's).
        const q = questionIdOf(r)
        if (!g.asked.has(q)) {
          g.asked.add(q)
          g.titles.push(r.title ?? DEFAULTS.find((x) => x.id === q)?.title ?? r.question.split('\n')[0])
        }
        groups.set(key, g)
      }
      // Level with where the highlighted text starts (two highlights in one paragraph get a marker
      // each), or with its first paragraph if it can't be found.
      const v = view.current
      const ai = [...groups.values()]
        .flatMap((g) => {
          const first = g.blockIds.filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)[0]
          if (!first) return []
          const at = v && locate(v.state, g.blockIds, g.quote)
          let top = box(paras[order.get(first)!]).top
          if (v && at) {
            try {
              top = v.coordsAtPos(at.from).top - top0
            } catch {
              // a position the view can't place: the paragraph's top
            }
          }
          return [{ blockIds: g.blockIds, quote: g.quote, titles: g.titles, top }]
        })
        .sort((a, b) => a.top - b.top)
      // Two on the same line: the next one just below, so both can be clicked.
      for (let n = 1; n < ai.length; n++) if (ai[n].top < ai[n - 1].top + 22) ai[n].top = ai[n - 1].top + 22
      setGutter({ runs, ai })
    })
  }

  /**
   * Highlight some text again (an AI answer's marker in the gutter): find it in its paragraphs as
   * they now read, select it, bring it into view, and report it like any highlight, so the review
   * column shows the answers for it.
   */
  const selectText = (blockIds: string[], quote: string) => {
    const v = view.current
    const at = v && locate(v.state, blockIds, quote)
    if (!v || !at) return
    v.focus()
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at.from, at.to)))
    window.setTimeout(() => reportRef.current?.(v), 0)
  }

  /** Tint (or stop tinting) the text an AI marker is about. */
  const preview = (a: { blockIds: string[]; quote: string } | null) => {
    const v = view.current
    if (!v) return
    v.dispatch(v.state.tr.setMeta(PREVIEW, a ? locate(v.state, a.blockIds, a.quote) : null).setMeta('addToHistory', false))
  }

  /** Where some highlighted text is now: in its paragraphs as they read (the paragraphs as a whole if it has changed since). */
  const locate = (state: EditorState, blockIds: string[], quote: string): { from: number; to: number } | null => {
    // The paragraphs' text joined as the selection reads it (a space between paragraphs), with the
    // document position of each character.
    let flat = ''
    const posOf: number[] = []
    state.doc.forEach((node, offset) => {
      if (!blockIds.includes(node.attrs.id)) return
      if (flat) {
        flat += ' '
        posOf.push(-1)
      }
      node.forEach((child, at) => {
        if (!child.isText) return
        for (let k = 0; k < child.text!.length; k++) posOf.push(offset + 1 + at + k)
        flat += child.text
      })
    })
    const norm = (t: string) => t.replace(/\s/g, ' ')
    let i = quote.trim() ? norm(flat).indexOf(norm(quote)) : -1
    let len = quote.length
    // Changed since (or no quote): the paragraphs as they are.
    if (i < 0) {
      i = 0
      len = flat.length
    }
    const from = posOf.slice(i).find((p) => p >= 0)
    const to = posOf.slice(0, i + len).reverse().find((p) => p >= 0)
    return from === undefined || to === undefined ? null : { from, to: to + 1 }
  }

  /** A paragraph's comments, theirs and ours (for the gutter button's label). */
  const commentsOn = (blockId: string) => {
    const d = model.current
    return (d.blocks.find((b) => b.id === blockId)?.comments?.length ?? 0) + d.comments.filter((c) => c.blockId === blockId).length
  }

  // ---- set up the editor once per review ----------------------------------------------------
  useEffect(() => {
    const d0 = model.current
    const blocksById = () => new Map(model.current.blocks.map((b) => [b.id, b]))
    const doc = schema.node(
      'doc',
      null,
      d0.blocks.map((b) => paraOf(b, shownOf(d0, b)))
    )

    const save = (id: string, group: string) => {
      window.clearTimeout(pending.current.get(id))
      pending.current.delete(id)
      const v = view.current
      if (!v) return
      let text: string | null = null
      v.state.doc.forEach((n) => {
        if (n.attrs.id === id) text = n.textContent
      })
      if (text === null) return
      cb.current.act(window.api.doc.edit(sessionId.current, id, text, group))
    }
    const schedule = (id: string) => {
      window.clearTimeout(pending.current.get(id))
      // Typing in one paragraph, without working anywhere else in between, is one action.
      pending.current.set(id, window.setTimeout(() => save(id, `type:${id}`), SAVE_AFTER_MS))
    }

    /** The paragraphs a range covers: node, its start (inside), and the part of the range in it. */
    const parasIn = (state: EditorState, from: number, to: number) => {
      const out: { node: PMNode; start: number; a: number; z: number }[] = []
      state.doc.forEach((node, offset) => {
        const start = offset + 1
        const end = start + node.content.size
        if (end < from || start > to) return
        out.push({ node, start, a: Math.max(from, start), z: Math.min(to, end) })
      })
      return out
    }

    /** Clear the selected text in each paragraph it covers (no paragraph is merged), then type. */
    const replaceAcross = (state: EditorState, dispatch: (tr: Transaction) => void, text = '') => {
      const { from, to } = state.selection
      const parts = parasIn(state, from, to)
      const tr = state.tr
      for (const p of [...parts].reverse()) if (p.z > p.a) tr.delete(p.a, p.z)
      const at = tr.mapping.map(from, -1)
      if (text) tr.insertText(text, at)
      tr.setSelection(TextSelection.create(tr.doc, at + text.length))
      tr.setMeta('across', parts.map((p) => p.node.attrs.id as string))
      dispatch(tr)
      return true
    }
    const crosses = (state: EditorState) => state.selection.$from.parent !== state.selection.$to.parent

    // ---- the redline, drawn over the text --------------------------------------------------------
    const cache = new Map<string, Mark[]>()
    const plainCache = new Map<string, string>()
    let cacheFor: DocReview | null = null
    /** The paragraph with no wording of ours. */
    const plainOf = (d: DocReview, b: DocBlock) => {
      let t = plainCache.get(b.id)
      if (t === undefined) plainCache.set(b.id, (t = shownText(marksFor({ ...d, edits: {} }, b))))
      return t
    }
    const decorate = (state: EditorState) => {
      const d = model.current
      if (cacheFor !== d) {
        cache.clear()
        plainCache.clear()
        cacheFor = d
      }
      const blocks = blocksById()
      const decos: Decoration[] = []
      const f = focused.current
      // Each paragraph's bar (its colour and style), so a run of the same bar is drawn as one.
      const bars: { offset: number; size: number; bar: string; cls: string; gone: boolean }[] = []
      const statesNow = new Map<string, GutterState>()
      state.doc.forEach((node, offset) => {
        const b = blocks.get(node.attrs.id)
        if (!b) return
        const start = offset + 1
        const key = `${b.id}\u0000${node.textContent}`
        let marks = cache.get(key)
        if (!marks) cache.set(key, (marks = marksNow(d, b, node.textContent)))
        const open = hasOpenChanges(d, b)
        // Their changes here have all been decided: checked.
        const decided = !open && theyChanged(b) && segmentsOf(b).some((x, i) => x.op !== 'same' && d.resolved?.[changeKey(b.id, i)])
        const edited = b.ours || tidy(node.textContent) !== tidy(plainOf(d, b))
        // Nothing left to show: their deletion accepted, or their inserted paragraph rejected.
        const gone = !b.ours && (b.kind === 'deleted' || theyChanged(b)) && !marks.length && !node.textContent
        // Nothing to look at: its changes all decided, or (untouched) it's our approved wording
        // word for word, or exactly what we sent last round.
        const checked = !open && !edited && (decided || isCleared(d, b))
        // The AI found it means the same as our approved wording: dashed green until you decide it.
        // (Their paper: a paragraph to read that the AI found means the same as one of ours, too.)
        const bar = `${(open || needsReading(d, b)) && !edited && aiSame(d, b) ? 'chg-ai' : open ? 'chg-theirs' : needsReading(d, b) && !edited ? 'chg-read' : ''} ${edited ? 'chg-ours' : checked ? 'chg-checked' : ''} ${b.untracked && open ? 'chg-untracked' : ''}`.replace(/\s+/g, ' ').trim()
        bars.push({ offset, size: node.nodeSize, bar, cls: `${bar} ${gone ? 'gone' : ''}`, gone })
        // Exactly our approved wording, or exactly what we sent last round: "Unchanged" in the gutter.
        // (Not one a reviewer marked as checked: that's a judgement, not a match.)
        const exact = !open && !edited && !gone && b.kind !== 'deleted' && !b.ours && !theyChanged(b) && (!!b.approved || (d.baseline?.kind === 'sent' && !!d.lastRound?.[b.id]))
        // The label for its bar (your edits show over theirs, as the bar does).
        const state: GutterState | null = gone
          ? null
          : bar.includes('chg-ours')
            ? 'edited'
            : bar.includes('chg-ai')
              ? 'same'
              : bar.includes('chg-theirs')
                ? 'decide'
                : bar.includes('chg-read')
                  ? 'read'
                  : exact
                    ? 'unchanged'
                    : bar.includes('chg-checked')
                      ? 'checked'
                      : null
        if (state) statesNow.set(b.id, state)
        // The number as it now reads: clauses we add are numbered, and the ones after move up.
        const label = labelOf(d, b)
        if (label) {
          const moved = !b.ours && label !== b.label
          decos.push(
            Decoration.widget(
              start,
              () => {
                const l = document.createElement('span')
                l.className = `dr-label${b.ours ? ' us-num' : moved ? ' renumbered' : ''}`
                l.contentEditable = 'false'
                l.textContent = label
                if (moved) l.title = `Was ${b.label}: renumbered after a clause you added`
                return l
              },
              { side: -100, key: `label:${b.id}:${label}:${moved}`, ignoreSelection: true }
            )
          )
        }
        const hl = (m: Mark) =>
          !!f && f.blockId === b.id && (f.kind === 'theirs' ? m.theirs !== undefined && m.seg !== undefined && groupOf(b, f.seg).includes(m.seg) : m.ours === f.op && m.text === f.text)
        // Comment ranges here (see below): struck text inside one is highlighted with it, so the
        // highlight runs on across a deletion as it does in Word.
        const anchors = anchorRanges(d, b, node.textContent)
        const anchorAt = (pos: number) => anchors.find((r) => (r.from < pos && pos < r.to) || (r.whole && pos >= r.from && pos <= r.to))
        for (const x of spans(marks)) {
          const m = x.m
          const attrs = { 'data-mark': String(x.i), 'data-block': b.id }
          if (x.struck) {
            const a = anchorAt(x.s)
            const ours = m.ours === 'del'
            decos.push(
              Decoration.widget(
                Math.min(start + x.s, start + node.content.size),
                () => {
                  const del = document.createElement('del')
                  del.className = `${ours ? 'us-del' : 'th-del'}${hl(m) ? ' ed-hl' : ''}${a ? ` ed-anchor ${a.ours ? 'ours' : 'theirs'}` : ''}`
                  del.title = ours ? 'Deleted by you' : `Deleted${m.author ? ` by ${m.author}` : ''}`
                  del.contentEditable = 'false'
                  del.dataset.mark = String(x.i)
                  del.dataset.block = b.id
                  del.textContent = m.text
                  return del
                },
                { side: -1, key: `del:${b.id}:${x.i}:${m.text}:${hl(m)}:${a ? (a.ours ? 'o' : 't') : ''}`, ignoreSelection: true, marks: [] }
              )
            )
          } else if (m.theirs === 'ins' || m.ours === 'ins') {
            decos.push(
              Decoration.inline(start + x.s, start + x.e, {
                class: `${m.ours === 'ins' ? 'us-ins' : 'th-ins'}${hl(m) ? ' ed-hl' : ''}`,
                nodeName: 'ins',
                title: m.ours === 'ins' ? 'Inserted by you' : `Inserted${m.author ? ` by ${m.author}` : ''}`,
                ...attrs
              })
            )
          }
        }
        // The text each comment is anchored to, highlighted as in Word: theirs (the comment's range
        // in their file) and ours (the text selected when it was made). Found in the paragraph as it
        // now reads; if the words have changed since, there's nothing to highlight. Clicking the
        // highlight shows the comments.
        for (const r of anchors)
          decos.push(Decoration.inline(start + r.from, start + r.to, { class: `ed-anchor ${r.ours ? 'ours' : 'theirs'}`, 'data-anchor': b.id }))
      })
      // A bar that runs on into the next paragraph's (the same bar, nothing hidden between) is drawn
      // as one: the gap between the two paragraphs is part of the first one's bar.
      const shown = bars.filter((x) => !x.gone)
      for (const [n, x] of shown.entries()) {
        const joins = !!x.bar && shown[n + 1]?.bar === x.bar
        decos.push(Decoration.node(x.offset, x.offset + x.size, { class: `${x.cls}${joins ? ' bar-joins' : ''}` }))
      }
      for (const x of bars) if (x.gone) decos.push(Decoration.node(x.offset, x.offset + x.size, { class: x.cls }))
      states.current = statesNow
      measure()

      return DecorationSet.create(state.doc, decos)
    }

    /** The change at a point in a paragraph (for a click or the caret). */
    const changeAt = (state: EditorState, pos: number): SelectedChange | null => {
      const $p = state.doc.resolve(pos)
      const node = $p.parent
      const b = blocksById().get(node.attrs.id)
      if (!b || node.type.name !== 'para') return null
      const off = $p.parentOffset
      const xs = spans(marksNow(model.current, b, node.textContent))
      const hit = xs.find((x) => !x.struck && (x.m.theirs === 'ins' || x.m.ours === 'ins') && x.s < off && off < x.e) ?? xs.find((x) => !x.struck && (x.m.theirs === 'ins' || x.m.ours === 'ins') && x.s <= off && off <= x.e)
      return hit ? changeOfMark(b, hit.m) : null
    }
    /** The changes a selection covers, across paragraphs. */
    const changesIn = (state: EditorState): SelectedChange[] => {
      const { from, to } = state.selection
      const out: SelectedChange[] = []
      const seen = new Set<string>()
      const add = (c: SelectedChange | null) => {
        if (!c || seen.has(JSON.stringify(c))) return
        seen.add(JSON.stringify(c))
        out.push(c)
      }
      for (const p of parasIn(state, from, to)) {
        const b = blocksById().get(p.node.attrs.id)
        if (!b) continue
        const a = p.a - p.start
        const z = p.z - p.start
        for (const x of spans(marksNow(model.current, b, p.node.textContent))) {
          if (!x.m.theirs && !x.m.ours) continue
          const inside = x.struck ? x.s >= a && x.s <= z : x.e > a && x.s < z
          if (!inside) continue
          add(changeOfMark(b, x.m))
          // Their change with ours on top of it: both are listed.
          if (x.m.ours && x.m.theirs && x.m.seg !== undefined) add({ blockId: b.id, kind: 'theirs', seg: groupOf(b, x.m.seg)[0] })
        }
      }
      return out
    }
    const setFocus = (c: SelectedChange | null) => {
      if (JSON.stringify(c) === JSON.stringify(focused.current)) return
      focused.current = c
      cb.current.onSelectChanges(c ? [c] : null)
      queueMicrotask(() => view.current?.dispatch(view.current.state.tr.setMeta('redraw', true)))
    }

    /** After a click or a selection: highlight the change clicked, or list what the selection covers. */
    const report = (v: EditorView) => {
      const { state } = v
      const sel = state.selection
      if (sel.empty) {
        setFocus(clicked.current ?? changeAt(state, sel.from))
        clicked.current = null
        return
      }
      focused.current = null
      // Every paragraph the selection touches, for the AI cards.
      const blockIds: string[] = []
      state.doc.nodesBetween(sel.from, sel.to, (n) => {
        if (n.type.name === 'para' && n.attrs.id) blockIds.push(n.attrs.id)
        return false
      })
      cb.current.onSelectChanges(changesIn(state), { blockId: sel.$from.parent.attrs.id, blockIds, quote: state.doc.textBetween(sel.from, sel.to, ' ').trim() })
      v.dispatch(state.tr.setMeta('redraw', true))
      // Within one paragraph, offer a comment on the selected text: in the gutter, level with it.
      if (sel.$from.parent === sel.$to.parent) {
        const a = v.coordsAtPos(sel.from)
        const box = host.current!.getBoundingClientRect()
        // The text stops 72px short of the page's edge: the button starts just after it, and its
        // label runs outward when there's room before whatever clips the page (the scrolling
        // pane); otherwise it sits against that edge, over the end of the line.
        // Positioned in the page's frame (the host's parent).
        const wrap = host.current!.parentElement!
        let clip = wrap
        while (clip.parentElement && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement
        const start = box.right - 68
        const fits = start + labelledWidth(commentsOn(sel.$from.parent.attrs.id)) <= clip.getBoundingClientRect().right - 2
        setBubble({ x: 0, y: a.top - box.top, blockId: sel.$from.parent.attrs.id, quote: state.doc.textBetween(sel.from, sel.to), ...(fits ? { left: start - wrap.getBoundingClientRect().left } : {}) })
      }
    }

    /** The paragraphs a clause number covers: the clause, its sub-clauses and items, and unnumbered paragraphs under it. */
    /** One paragraph's text, start to end. */
    const paraRange = (state: EditorState, id: string): { from: number; to: number } | null => {
      let r: { from: number; to: number } | null = null
      state.doc.forEach((node, pos) => {
        if (node.attrs.id === id) r = { from: pos + 1, to: pos + 1 + node.content.size }
      })
      return r
    }

    const clauseRange = (state: EditorState, id: string): { from: number; to: number } | null => {
      const d = model.current
      const labels = labelsOf(d)
      const at = d.blocks.findIndex((b) => b.id === id)
      const top = parseLabel(labels.get(id) ?? d.blocks[at]?.label)
      if (at < 0 || !top) return null
      let last = at
      for (let j = at + 1; j < d.blocks.length; j++) {
        const b = d.blocks[j]
        const p = parseLabel(labels.get(b.id) ?? (b.ours ? undefined : b.label))
        if (!p) {
          if (b.kind === 'heading') break
          last = j
          continue
        }
        if (top.kind === 'dec' && p.kind === 'dec' && p.parts.length > top.parts.length && p.parts.slice(0, top.parts.length).join('.') === top.parts.join('.')) last = j
        else if (top.kind === 'dec' && p.kind !== 'dec') last = j
        else break
      }
      const ids = new Set(d.blocks.slice(at, last + 1).map((b) => b.id))
      let from = -1
      let to = -1
      state.doc.forEach((node, pos) => {
        if (!ids.has(node.attrs.id)) return
        if (from < 0) from = pos + 1
        to = pos + 1 + node.content.size
      })
      return from < 0 ? null : { from, to }
    }

    const redline = new Plugin({ props: { decorations: decorate } })

    // A new paragraph (Enter): ours, after this one, with the text after the caret.
    const split = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      if (!dispatch) return true
      const here = blocksById().get(state.selection.$from.parent.attrs.id)
      // Enter on an empty numbered paragraph of ours ends the list (as in Word).
      if (here?.ours && here.list && !state.selection.$from.parent.textContent) {
        setList(here.id, null)
        return true
      }
      let st = state
      if (crosses(st)) replaceAcross(st, (tr) => (st = st.apply(tr)))
      const { $from, from, to } = st.selection
      const node = $from.parent
      const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const tr = st.tr
      if (to > from) tr.delete(from, to)
      tr.split(tr.mapping.map(from), 1, [{ type: schema.nodes.para, attrs: { id, kind: 'para', level: node.attrs.level } }])
      // The new paragraph starts at its first word.
      const $n = tr.doc.resolve(tr.selection.from)
      const lead = $n.parent.textContent.match(/^\s+/)?.[0].length ?? 0
      if (lead) tr.delete($n.start(), $n.start() + lead)
      const src = blocksById().get(node.attrs.id)
      tr.setMeta('split', { from: node.attrs.id, id, list: src ? (listAfter(model.current, src) ?? null) : null }).setMeta('addToHistory', false)
      dispatch(tr)
      return true
    }

    const setList = (id: string, list: ListStyle | null) => cb.current.act(window.api.doc.setList(sessionId.current, id, list))
    /** Tab / Shift-Tab on a numbered paragraph of ours: one level down or up. */
    const indent = (by: 1 | -1) => (state: EditorState) => {
      const b = blocksById().get(state.selection.$from.parent.attrs.id)
      if (!b?.ours || !b.list) return true // Tab never leaves the document
      if (b.list.kind === 'dec') {
        const depth = b.list.depth + by
        if (depth >= 1) setList(b.id, { kind: 'dec', depth })
      } else if (by === -1) {
        // A lettered item back up to the clause level it sits under ("(c)" under 2.3 → 2.4).
        const at = model.current.blocks.indexOf(b)
        const parent = model.current.blocks
          .slice(0, at)
          .reverse()
          .map((x) => parseLabel(labelsOf(model.current).get(x.id) ?? x.label))
          .find((p) => p?.kind === 'dec')
        if (parent?.kind === 'dec') setList(b.id, { kind: 'dec', depth: parent.parts.length })
      } else setList(b.id, { kind: 'roman', depth: 0, open: '(', close: ')' })
      return true
    }

    const editor = new EditorView(host.current!, {
      state: EditorState.create({
        doc,
        plugins: [
          history(),
          keymap({
            'Mod-z': undo,
            'Shift-Mod-z': redo,
            'Mod-y': redo,
            // Select all: the document's text, first paragraph to last (a text selection, so it
            // reads like any other highlight: the AI cards, comments).
            'Mod-a': (state, dispatch) => {
              const last = state.doc.lastChild
              if (!last || !dispatch) return false
              dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
              return true
            },
            Enter: split,
            'Shift-Enter': split,
            Tab: indent(1),
            'Shift-Tab': indent(-1),
            Backspace: (state, dispatch) => {
              if (crosses(state)) return replaceAcross(state, dispatch!)
              const { $from, empty } = state.selection
              if (!empty || $from.parentOffset > 0) return false
              // At the start of a paragraph: never merge; an empty one you added is removed.
              const b = blocksById().get($from.parent.attrs.id)
              // A numbered paragraph of ours loses its number first (as in Word).
              if (b?.ours && b.list) {
                setList(b.id, null)
                return true
              }
              if (b?.ours && !$from.parent.textContent && dispatch) {
                const start = $from.before()
                const tr = state.tr.delete(start, start + $from.parent.nodeSize)
                tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, start - 1)), -1))
                tr.setMeta('unsplit', b.id).setMeta('addToHistory', false)
                dispatch(tr)
              }
              return true
            },
            Delete: (state, dispatch) => {
              if (crosses(state)) return replaceAcross(state, dispatch!)
              const { $from, empty } = state.selection
              return empty && $from.parentOffset === $from.parent.content.size
            }
          }),
          keymap(baseKeymap),
          redline,
          flashPlugin,
          previewPlugin
        ]
      }),
      editable: () => !readOnly,
      attributes: { class: 'ed-doc', spellcheck: 'false' },
      handleTextInput: (v, _from, _to, text) => (crosses(v.state) ? replaceAcross(v.state, v.dispatch, text) : false),
      handlePaste: (v, e) => {
        const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*[\r\n]+\s*/g, ' ')
        if (crosses(v.state)) return replaceAcross(v.state, v.dispatch, text)
        v.dispatch(v.state.tr.insertText(text))
        return true
      },
      handleDrop: () => true,
      handleDOMEvents: {
        cut: (v, e) => {
          if (!crosses(v.state)) return false
          e.preventDefault()
          e.clipboardData?.setData('text/plain', v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, ' '))
          return replaceAcross(v.state, v.dispatch)
        },
        // A click (not a drag) on commented text, outside a change, shows its comments, as in Word.
        click: (v, e) => {
          const t = e.target as HTMLElement
          const anchor = t.closest<HTMLElement>('[data-anchor]')
          if (!anchor || !v.state.selection.empty || t.closest('ins, del')) return false
          setTimeout(() => cb.current.onShowComments(anchor.dataset.anchor!), 0)
          return false
        },
        // A selection made with the keyboard (Shift and the arrows, select all) is reported like one made with the mouse.
        keyup: (v, e) => {
          if (e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a')) report(v)
          return false
        },
        mousedown: (_v, e) => {
          const t = e.target as HTMLElement
          // A clause number: select the whole clause (with its sub-clauses), as a highlight.
          // A clause number selects the whole clause (with its sub-clauses); the bar beside a
          // paragraph (its left edge, widened for clicking) selects that paragraph.
          const label = t.closest<HTMLElement>('.dr-label')
          const onBar = t.matches('p[data-block]') && e.clientX < t.getBoundingClientRect().left + 10
          const para = label?.closest<HTMLElement>('p[data-block]') ?? (onBar ? t : null)
          if (para) {
            e.preventDefault()
            const r = label ? clauseRange(_v.state, para.dataset.block!) : paraRange(_v.state, para.dataset.block!)
            if (r) {
              _v.focus()
              _v.dispatch(_v.state.tr.setSelection(TextSelection.create(_v.state.doc, r.from, r.to)))
              cb.current.onSelectChanges(null)
              setBubble(null)
              window.setTimeout(() => report(_v), 0)
            }
            return true
          }
          // Struck text isn't part of the text, so a click on it is caught here.
          const del = t.closest<HTMLElement>('del[data-mark]')
          const b = del ? blocksById().get(del.dataset.block!) : undefined
          clicked.current = null
          if (del && b) {
            const m = marksFor(model.current, b)[Number(del.dataset.mark)]
            clicked.current = m ? changeOfMark(b, m) : null
          }
          focused.current = null
          cb.current.onSelectChanges(null)
          setBubble(null)
          return false
        },
        mouseup: (v) => {
          window.setTimeout(() => {
            // Take the selection from the page, in case the editor hasn't caught up with it yet.
            const dom = window.getSelection()
            if (dom?.rangeCount && dom.anchorNode && dom.focusNode && v.dom.contains(dom.anchorNode) && v.dom.contains(dom.focusNode)) {
              try {
                const a = v.posAtDOM(dom.anchorNode, dom.anchorOffset)
                const h = v.posAtDOM(dom.focusNode, dom.focusOffset)
                if (a !== v.state.selection.anchor || h !== v.state.selection.head) v.dispatch(v.state.tr.setSelection(TextSelection.between(v.state.doc.resolve(a), v.state.doc.resolve(h))))
              } catch {
                // a point the editor doesn't map (a widget): keep its own selection
              }
            }
            report(v)
          }, 0)
          return false
        }
      },
      dispatchTransaction(tr) {
        const v = view.current!
        const before = v.state
        // Paragraphs are never merged or dropped except by our own commands.
        const structural = tr.getMeta('split') || tr.getMeta('unsplit') || tr.getMeta('sync')
        if (tr.docChanged && !structural && tr.doc.childCount !== before.doc.childCount) return
        const state = before.apply(tr)
        v.updateState(state)
        if (tr.getMeta('sync')) return

        const split = tr.getMeta('split') as { from: string; id: string; list: ListStyle | null } | undefined
        if (split) {
          const text = (id: string) => {
            let t = ''
            state.doc.forEach((n) => {
              if (n.attrs.id === id) t = n.textContent
            })
            return t
          }
          window.clearTimeout(pending.current.get(split.from))
          pending.current.delete(split.from)
          window.api.doc.split(sessionId.current, split.from, text(split.from), text(split.id), split.id, split.list).then(
            (r) => cb.current.act(Promise.resolve(r.session)),
            (e) => cb.current.act(Promise.reject(e))
          )
        } else if (tr.getMeta('unsplit')) {
          cb.current.act(window.api.doc.unsplit(sessionId.current, tr.getMeta('unsplit')))
        } else if (tr.getMeta('across')) {
          // One action for the whole selection.
          const group = `range:${Date.now().toString(36)}`
          for (const id of tr.getMeta('across') as string[]) {
            window.clearTimeout(pending.current.get(id))
            pending.current.delete(id)
            let t: string | null = null
            state.doc.forEach((n) => {
              if (n.attrs.id === id) t = n.textContent
            })
            if (t !== null) cb.current.act(window.api.doc.edit(sessionId.current, id, t, group))
          }
        } else if (tr.docChanged) {
          // Typing: save each paragraph that changed, after a pause.
          const old = new Map<string, string>()
          before.doc.forEach((n) => old.set(n.attrs.id, n.textContent))
          state.doc.forEach((n) => {
            if (old.get(n.attrs.id) !== n.textContent) schedule(n.attrs.id)
          })
        }

        if (!before.selection.eq(state.selection)) {
          cb.current.onFocusBlock(state.selection.$from.parent.attrs.id ?? null)
          if (state.selection.empty) setFocus(changeAt(state, state.selection.from))
          if (!state.selection.empty) setBubble(null)
        }
      }
    })
    view.current = editor
    flashView = editor
    reportRef.current = report
    // The page reflows (the window, the columns, fonts): the gutter's labels move with it.
    const resized = new ResizeObserver(() => measure())
    resized.observe(host.current!)
    return () => {
      resized.disconnect()
      cancelAnimationFrame(measuring.current)
      // Leaving the review saves what's typed.
      for (const id of pending.current.keys()) save(id, `type:${id}`)
      editor.destroy()
      view.current = null
      if (flashView === editor) flashView = null
    }
  }, [session.id])

  // ---- the model changed (a save, accept/reject, undo in History): bring the text in line ----------
  useEffect(() => {
    model.current = session.doc!
    sessionId.current = session.id
    measure()
    const v = view.current
    if (!v) return
    const d = session.doc!
    const tr = v.state.tr
    const want = new Map(d.blocks.map((b) => [b.id, b]))
    // Paragraphs we no longer have (a paragraph we'd added, undone): remove them.
    const nodes: { id: string; pos: number; node: PMNode }[] = []
    v.state.doc.forEach((node, pos) => nodes.push({ id: node.attrs.id, pos, node }))
    for (const n of [...nodes].reverse()) if (!want.has(n.id) && nodes.length > 1) tr.delete(tr.mapping.map(n.pos), tr.mapping.map(n.pos + n.node.nodeSize))
    // Paragraphs we now have and the editor doesn't (one of ours, redone): add them in place.
    const have = new Set(nodes.map((n) => n.id))
    d.blocks.forEach((b, i) => {
      if (have.has(b.id)) return
      const prev = d.blocks.slice(0, i).reverse().find((x) => have.has(x.id))
      let at = 0
      tr.doc.forEach((node, pos) => {
        if (prev && node.attrs.id === prev.id) at = pos + node.nodeSize
      })
      tr.insert(at, paraOf(b, shownOf(d, b)))
      have.add(b.id)
    })
    // Text changed from outside the editor (not something you're typing): replace it.
    // Only the part that differs is replaced, so the caret stays where it was.
    const replace: { from: number; to: number; text: string }[] = []
    tr.doc.forEach((node, pos) => {
      const b = want.get(node.attrs.id)
      if (!b || pending.current.has(b.id)) return
      const text = shownOf(d, b)
      const old = node.textContent
      if (text === old) return
      let p = 0
      while (p < text.length && p < old.length && text[p] === old[p]) p++
      let q = 0
      while (q < text.length - p && q < old.length - p && text[text.length - 1 - q] === old[old.length - 1 - q]) q++
      replace.push({ from: pos + 1 + p, to: pos + 1 + old.length - q, text: text.slice(p, text.length - q) })
    })
    for (const r of replace.reverse()) {
      if (r.text) tr.replaceWith(r.from, r.to, schema.text(r.text))
      else tr.delete(r.from, r.to)
    }
    tr.setMeta('sync', true).setMeta('addToHistory', false)
    v.dispatch(tr)
  }, [session])

  return (
    <>
      <div className="ed-frame">
        <div ref={host} className="ed-host" />
        {/* The left gutter, beside the paragraphs' bars. */}
        <div className="ed-gutter-layer">
          {gutter.runs.map((r, i) => (
            <div key={`u${i}`} className="ed-unchanged-run" style={{ top: r.top, height: r.height }}>
              <span className={`ed-unchanged ${r.state}`} data-tip={GUTTER[r.state].tip}>
                {GUTTER[r.state].label}
              </span>
            </div>
          ))}
          {gutter.ai.map((a) => (
            <button
              key={`${a.blockIds.join(',')}:${a.quote}`}
              className="ed-ai-mark"
              style={{ top: a.top }}
              title={`AI answers for this text (${a.titles.map((t) => `“${t}”`).join(', ')}). Click to show them.`}
              aria-label="Show the AI answers for this text"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                preview(null)
                selectText(a.blockIds, a.quote)
              }}
              onMouseEnter={() => preview(a)}
              onMouseLeave={() => preview(null)}
            >
              <SparkleIcon />
            </button>
          ))}
        </div>
        {bubble && (
          <button
            className={`ed-gutter-btn ${bubble.left !== undefined ? 'out' : ''}`}
            style={bubble.left !== undefined ? { top: bubble.y, left: bubble.left } : { top: bubble.y }}
            title="Comment on the selected text (in the right-hand column)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              cb.current.onComment(bubble.blockId, bubble.quote)
              setBubble(null)
            }}
          >
            <CommentIcon size={16} />
            <span>{commentLabel(commentsOn(bubble.blockId))}</span>
          </button>
        )}
      </div>
    </>
  )
}

/** Where in a paragraph's text (as now shown) its comments are anchored, theirs and ours. */
function anchorRanges(d: DocReview, b: DocBlock, text: string): { from: number; to: number; ours: boolean; whole?: boolean }[] {
  const out: { from: number; to: number; ours: boolean; whole?: boolean }[] = []
  const find = (quote: string | undefined, isOurs: boolean) => {
    // No quote (a comment on the paragraph as a whole): the whole paragraph.
    if (!quote?.trim()) {
      if (text.trim()) out.push({ from: 0, to: text.length, ours: isOurs, whole: true })
      return
    }
    let q = quote.replace(/\s+/g, ' ').trim()
    // A typed number ("2.4") is drawn beside the paragraph, not in its text.
    if (b.label && q.startsWith(b.label)) q = q.slice(b.label.length).trim()
    if (!q) return
    const flat = text.replace(/\s/g, ' ')
    let at = flat.indexOf(q)
    if (at < 0) at = flat.toLowerCase().indexOf(q.toLowerCase())
    if (at >= 0) out.push({ from: at, to: at + q.length, ours: isOurs })
  }
  // Resolved threads stay in the document but aren't highlighted, as in Word.
  for (const c of b.comments ?? []) if (!commentResolved(d, c)) find(c.quote, false)
  for (const c of d.comments) if (c.blockId === b.id && !commentResolved(d, c)) find(c.quote, true)
  return out
}

const SparkleIcon = () => <Icon name="sparkle" size={12} stroke={2.2} />
