import { useEffect, useRef, useState } from 'react'
import { Schema, type Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import type { DocBlock, DocReview, ListStyle, ReviewSession } from '@shared/types'
import { labelOf, labelsOf, listAfter, parseLabel } from '@shared/numbering'
import { changeKey, hasOpenChanges, isCleared, marksFor, segmentsOf, shownText, theyChanged } from '@shared/changes'
import type { Mark } from '@shared/diff'
import { Icon } from '../lib/icons'

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
  onSelectChanges: (changes: SelectedChange[] | null) => void
  readOnly?: boolean
}

/** A redline picked out by selecting text: one of their changes, or one of ours. */
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

const changeOfMark = (blockId: string, m: Mark): SelectedChange | null =>
  m.theirs && m.seg !== undefined ? { blockId, kind: 'theirs', seg: m.seg } : m.ours ? { blockId, kind: 'ours', op: m.ours, text: m.text } : null

export function DocEditor({ session, act, onFocusBlock, onComment, onSelectChanges, readOnly }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const model = useRef(session.doc!)
  const sessionId = useRef(session.id)
  const pending = useRef(new Map<string, number>())
  const focused = useRef<SelectedChange | null>(null)
  const clicked = useRef<SelectedChange | null>(null)
  const cb = useRef({ act, onFocusBlock, onComment, onSelectChanges })
  cb.current = { act, onFocusBlock, onComment, onSelectChanges }
  const [bubble, setBubble] = useState<{ x: number; y: number; blockId: string; quote: string } | null>(null)

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
        const gone = b.kind === 'deleted' && !marks.length && !node.textContent
        // Nothing to look at: its changes all decided, or (untouched) it's our approved wording
        // word for word, or exactly what we sent last round.
        const checked = !open && !edited && (decided || isCleared(d, b))
        const tag = b.untracked && open ? (b.untracked === 'sent' ? 'not tracked' : b.standard ? 'not our standard' : 'not in our template') : ''
        decos.push(
          Decoration.node(offset, offset + node.nodeSize, {
            class: `${open ? 'chg-theirs' : ''} ${edited ? 'chg-ours' : checked ? 'chg-checked' : ''} ${b.untracked && open ? 'chg-untracked' : ''} ${gone ? 'gone' : ''} ${tag ? 'tagged' : ''}`,
            ...(tag ? { 'data-tag': tag } : {})
          })
        )
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
          !!f && f.blockId === b.id && (f.kind === 'theirs' ? m.theirs !== undefined && m.seg === f.seg : m.ours === f.op && m.text === f.text)
        for (const x of spans(marks)) {
          const m = x.m
          const attrs = { 'data-mark': String(x.i), 'data-block': b.id }
          if (x.struck) {
            const ours = m.ours === 'del'
            decos.push(
              Decoration.widget(
                Math.min(start + x.s, start + node.content.size),
                () => {
                  const del = document.createElement('del')
                  del.className = `${ours ? 'us-del' : 'th-del'}${hl(m) ? ' ed-hl' : ''}`
                  del.title = ours ? 'Deleted by you' : `Deleted${m.author ? ` by ${m.author}` : ''}`
                  del.contentEditable = 'false'
                  del.dataset.mark = String(x.i)
                  del.dataset.block = b.id
                  del.textContent = m.text
                  return del
                },
                { side: -1, key: `del:${b.id}:${x.i}:${m.text}:${hl(m)}`, ignoreSelection: true, marks: [] }
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
        const comments = (b.comments?.length ?? 0) + d.comments.filter((c) => c.blockId === b.id).length
        if (comments)
          decos.push(
            Decoration.widget(
              start + node.content.size,
              () => {
                const s = document.createElement('span')
                s.className = 'ed-cbadge'
                s.contentEditable = 'false'
                s.dataset.badge = b.id
                s.textContent = `💬 ${comments}`
                s.title = `${comments} comment${comments === 1 ? '' : 's'}`
                return s
              },
              { side: 100, key: `badge:${b.id}:${comments}`, ignoreSelection: true }
            )
          )
      })
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
      return hit ? changeOfMark(b.id, hit.m) : null
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
          add(changeOfMark(b.id, x.m))
          // Their change with ours on top of it: both are listed.
          if (x.m.ours && x.m.theirs && x.m.seg !== undefined) add({ blockId: b.id, kind: 'theirs', seg: x.m.seg })
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
      const id = `n${Date.now().toString(36)}`
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
          redline
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
        mousedown: (_v, e) => {
          const t = e.target as HTMLElement
          const badge = t.closest<HTMLElement>('[data-badge]')
          if (badge) {
            e.preventDefault()
            cb.current.onFocusBlock(badge.dataset.badge!)
            return true
          }
          // Struck text isn't part of the text, so a click on it is caught here.
          const del = t.closest<HTMLElement>('del[data-mark]')
          const b = del ? blocksById().get(del.dataset.block!) : undefined
          clicked.current = null
          if (del && b) {
            const m = marksFor(model.current, b)[Number(del.dataset.mark)]
            clicked.current = m ? changeOfMark(b.id, m) : null
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
            const { state } = v
            const sel = state.selection
            if (sel.empty) {
              setFocus(clicked.current ?? changeAt(state, sel.from))
              clicked.current = null
              return
            }
            focused.current = null
            cb.current.onSelectChanges(changesIn(state))
            v.dispatch(state.tr.setMeta('redraw', true))
            // Within one paragraph, offer a comment on the selected text.
            if (sel.$from.parent === sel.$to.parent) {
              const a = v.coordsAtPos(sel.from)
              const z = v.coordsAtPos(sel.to)
              // In the gutter, level with the start of the selection.
              const box = host.current!.getBoundingClientRect()
              void z
              setBubble({ x: 0, y: a.top - box.top, blockId: sel.$from.parent.attrs.id, quote: state.doc.textBetween(sel.from, sel.to) })
            }
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
    return () => {
      // Leaving the review saves what's typed.
      for (const id of pending.current.keys()) save(id, `type:${id}`)
      editor.destroy()
      view.current = null
    }
  }, [session.id])

  // ---- the model changed (a save, accept/reject, undo in History): bring the text in line ----------
  useEffect(() => {
    model.current = session.doc!
    sessionId.current = session.id
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
      <div ref={host} className="ed-host" />
      {bubble && (
        <button
          className="ed-gutter-btn"
          style={{ top: bubble.y }}
          title="Comment on the selected text (in the right-hand column)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            cb.current.onComment(bubble.blockId, bubble.quote)
            setBubble(null)
          }}
        >
          <Icon name="chat" size={15} />
        </button>
      )}
    </>
  )
}
