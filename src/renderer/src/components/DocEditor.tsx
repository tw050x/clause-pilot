import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DocBlock, ReviewSession } from '@shared/types'
import { segmentsOf } from '@shared/changes'
import { overlay, type Mark } from '@shared/diff'
import { Icon } from '../lib/icons'

/**
 * The contract as one editable column, like a Word document with Track Changes on.
 *
 * Click anywhere for a caret; type, delete, paste, press Enter. What you type is
 * saved as your wording for that paragraph and shown as your tracked changes (red),
 * layered over theirs (blue). Deleted text (theirs or yours) stays visible, struck
 * through, and the caret skips it, as in Word.
 *
 * Each paragraph's DOM is owned here, not by React: it is rebuilt from the saved
 * model only when that model changes and you aren't mid-edit in it, and the caret
 * is put back where it was.
 */

interface Props {
  session: ReviewSession
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  /** The paragraph the caret is in. */
  onFocusBlock: (blockId: string | null) => void
  /** "Comment" on selected text. */
  onComment: (blockId: string, quote: string) => void
  readOnly?: boolean
}

const SAVE_AFTER_MS = 450
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

/** What the paragraph shows: their redline with our wording laid over it. */
export function marksOf(session: ReviewSession, b: DocBlock): Mark[] {
  const d = session.doc!
  const edit = d.edits[b.id]
  if (b.ours) return edit ? [{ text: edit, ours: 'ins' }] : []
  if (b.kind === 'deleted') {
    // Their deletion; restoring it means our wording is laid over nothing.
    if (edit === undefined) return segmentsOf(b).map((s) => ({ text: s.text, theirs: 'del', author: s.author }))
    return [...segmentsOf(b).map((s) => ({ text: s.text, theirs: 'del' as const, author: s.author })), ...(edit ? [{ text: ' ' + edit, ours: 'ins' as const }] : [])]
  }
  return overlay(segmentsOf(b), edit)
}

const shown = (marks: Mark[]) => marks.filter((m) => m.theirs !== 'del' && m.ours !== 'del').map((m) => m.text).join('')

// ---- the visible (editable) text of a paragraph, and caret positions in it ----------------

const editable = (n: Node, p: HTMLElement) => !(n.parentElement?.closest('[contenteditable="false"]') && p.contains(n.parentElement.closest('[contenteditable="false"]')))

function textNodes(p: HTMLElement): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) if (editable(n, p)) out.push(n as Text)
  return out
}

export const visibleText = (p: HTMLElement) =>
  textNodes(p)
    .map((t) => t.data)
    .join('')
    .replace(/ /g, ' ')

/** Characters of visible text before a DOM point. */
function offsetIn(p: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange()
  r.setStart(p, 0)
  try {
    r.setEnd(node, offset)
  } catch {
    return 0
  }
  let n = 0
  for (const t of textNodes(p)) {
    if (!r.intersectsNode(t)) continue
    n += t === r.endContainer ? r.endOffset : t.length
  }
  return n
}

/** The DOM point at a visible-text offset (creating a text node if the paragraph has none). */
function pointAt(p: HTMLElement, at: number): [Node, number] {
  let n = 0
  const nodes = textNodes(p)
  for (const t of nodes) {
    if (at <= n + t.length) return [t, at - n]
    n += t.length
  }
  const last = nodes[nodes.length - 1]
  if (last) return [last, last.length]
  const t = document.createTextNode('')
  p.appendChild(t)
  return [t, 0]
}

function setCaret(p: HTMLElement, at: number) {
  const [node, off] = pointAt(p, at)
  const sel = window.getSelection()!
  const r = document.createRange()
  r.setStart(node, off)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** A caret position that survives respacing: the number of non-space characters before it, and whether a space follows them. */
function caretKey(text: string, at: number) {
  const before = text.slice(0, at)
  return { chars: before.replace(/\s/g, '').length, space: /\s$/.test(before) }
}
function fromKey(text: string, key: { chars: number; space: boolean }): number {
  let n = 0
  let i = 0
  for (; i < text.length && n < key.chars; i++) if (!/\s/.test(text[i])) n++
  if (key.space && /\s/.test(text[i] ?? '')) i++
  return i
}

/** Remove visible characters [a, b) from the paragraph's DOM (struck text is left alone). */
function deleteVisible(p: HTMLElement, a: number, b: number) {
  let n = 0
  for (const t of textNodes(p)) {
    const s = n
    const e = n + t.length
    n = e
    const from = Math.max(a, s)
    const to = Math.min(b, e)
    if (to > from) t.deleteData(from - s, to - from)
  }
}
function insertVisible(p: HTMLElement, at: number, text: string) {
  const [node, off] = pointAt(p, at)
  ;(node as Text).insertData(off, text)
}

function render(p: HTMLElement, b: DocBlock, marks: Mark[]) {
  p.replaceChildren()
  if (b.label) {
    const l = document.createElement('span')
    l.className = 'dr-label'
    l.contentEditable = 'false'
    l.textContent = b.label
    p.appendChild(l)
  }
  for (const m of marks) {
    let el: Node = document.createTextNode(m.text)
    const struck = m.theirs === 'del' || m.ours === 'del'
    if (m.theirs === 'ins' && m.ours !== 'del') {
      const ins = document.createElement('ins')
      ins.className = 'th-ins'
      ins.title = `Inserted${m.author ? ` by ${m.author}` : ''}`
      ins.appendChild(el)
      el = ins
    }
    if (m.ours === 'ins') {
      const ins = document.createElement('ins')
      ins.className = 'us-ins'
      ins.appendChild(el)
      el = ins
    }
    if (struck) {
      const del = document.createElement('del')
      del.className = m.ours === 'del' ? 'us-del' : 'th-del'
      del.title = m.ours === 'del' ? 'Deleted by you' : `Deleted${m.author ? ` by ${m.author}` : ''}`
      del.contentEditable = 'false'
      del.appendChild(el)
      el = del
    }
    p.appendChild(el)
  }
  if (!textNodes(p).length) p.appendChild(document.createTextNode(''))
}

export function DocEditor({ session, act, onFocusBlock, onComment, readOnly }: Props) {
  const d = session.doc!
  const root = useRef<HTMLDivElement>(null)
  /** Paragraphs typed in and not yet saved. */
  const pending = useRef(new Map<string, number>())
  /**
   * Paragraphs changed by a command (not by typing): rebuild them once the model has the text
   * the command produced (other saves may land first), and put the caret at `caret`.
   */
  const force = useRef(new Map<string, { text: string; caret: number | null }>())
  const sessionId = useRef(session.id)
  sessionId.current = session.id
  const [bubble, setBubble] = useState<{ x: number; y: number; blockId: string; quote: string } | null>(null)

  const para = (id: string) => root.current?.querySelector<HTMLElement>(`p[data-block="${id}"]`) ?? null
  const paraOf = (n: Node | null) => (n ? ((n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest<HTMLElement>('p[data-block]') ?? null) : null)
  const blockOf = (p: HTMLElement) => d.blocks.find((b) => b.id === p.dataset.block)!

  // Build each paragraph from the model when it changes, unless you've typed something newer.
  useLayoutEffect(() => {
    for (const b of d.blocks) {
      const p = para(b.id)
      if (!p) continue
      const marks = marksOf(session, b)
      const key = JSON.stringify(marks)
      const f = force.current.get(b.id)
      const forced = !!f && tidy(shown(marks)) === tidy(f.text)
      if (f && !forced) continue
      if (p.dataset.key === key && !forced) continue
      if (p.dataset.key && !forced) {
        if (pending.current.has(b.id)) continue
        // A save that's behind what's on screen: leave the screen alone.
        if (tidy(visibleText(p)) !== tidy(shown(marks))) continue
      }
      const sel = window.getSelection()
      const focused = !!sel?.rangeCount && p.contains(sel.anchorNode)
      const text = visibleText(p)
      const key0 = focused ? caretKey(text, offsetIn(p, sel!.anchorNode!, sel!.anchorOffset)) : null
      const caretTo = f?.caret
      force.current.delete(b.id)
      render(p, b, marks)
      p.dataset.key = key
      if (typeof caretTo === 'number') setCaret(p, caretTo)
      else if (key0) setCaret(p, fromKey(visibleText(p), key0))
    }
  })

  const save = (id: string) => {
    window.clearTimeout(pending.current.get(id))
    pending.current.delete(id)
    const p = para(id)
    if (!p) return
    const b = d.blocks.find((x) => x.id === id)
    const text = visibleText(p)
    act(window.api.doc.edit(sessionId.current, id, b?.kind === 'deleted' ? text.replace(/^\s+/, '') : text))
  }
  const schedule = (id: string) => {
    window.clearTimeout(pending.current.get(id))
    pending.current.set(id, window.setTimeout(() => save(id), SAVE_AFTER_MS))
  }
  // Leaving the review saves what's typed.
  useEffect(() => () => pending.current.forEach((_, id) => save(id)), [])

  // Editing commands the browser would get wrong here are done by hand: anything that crosses
  // paragraphs, touches struck text, adds a paragraph or pastes formatting.
  useEffect(() => {
    const el = root.current!
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType
      if (t.startsWith('history') || t.startsWith('format')) return e.preventDefault()
      const sel = window.getSelection()
      if (!sel?.rangeCount) return e.preventDefault()
      const r = sel.getRangeAt(0)
      const sp = paraOf(r.startContainer)
      const ep = paraOf(r.endContainer)
      if (!sp || !ep) return e.preventDefault()
      const sb = blockOf(sp)
      const a = offsetIn(sp, r.startContainer, r.startOffset)
      const z = offsetIn(ep, r.endContainer, r.endOffset)
      const typed = t === 'insertFromPaste' || t === 'insertFromDrop' ? (e.dataTransfer?.getData('text/plain') ?? '').replace(/\s*[\r\n]+\s*/g, ' ') : (e.data ?? '')

      if (sp !== ep) {
        e.preventDefault()
        if (t !== 'insertFromDrop') replaceAcross(sp, ep, a, z, t.startsWith('insert') ? typed : '')
        return
      }
      if (sb.kind === 'deleted' && !d.edits[sb.id]) return e.preventDefault()
      const text = visibleText(sp)

      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault()
        const head = text.slice(0, a)
        const tail = text.slice(z).replace(/^\s+/, '')
        window.clearTimeout(pending.current.get(sb.id))
        pending.current.delete(sb.id)
        force.current.set(sb.id, { text: head, caret: null })
        window.api.doc.split(sessionId.current, sb.id, head, tail).then(
          ({ session: s, id }) => {
            force.current.set(id, { text: tail, caret: 0 })
            act(Promise.resolve(s))
          },
          (err) => act(Promise.reject(err))
        )
        return
      }
      const collapsed = r.collapsed
      const backward = t.startsWith('delete') && t.includes('Backward')
      const forward = t.startsWith('delete') && t.includes('Forward')
      // At the edge of a paragraph: never merge paragraphs; an empty one you added is removed.
      if (collapsed && backward && a === 0) {
        e.preventDefault()
        if (sb.ours && !text.trim()) {
          const ps = Array.from(el.querySelectorAll<HTMLElement>('p[data-block]'))
          const prev = ps[ps.indexOf(sp) - 1]
          if (prev) force.current.set(prev.dataset.block!, { text: visibleText(prev), caret: visibleText(prev).length })
          act(window.api.doc.unsplit(sessionId.current, sb.id))
        }
        return
      }
      if (collapsed && forward && a === text.length) return e.preventDefault()

      // Single deletes, struck text in the selection, pastes and drops: done by hand, so struck
      // text is never removed and nothing but plain text gets in.
      const struck = Array.from(sp.querySelectorAll('[contenteditable="false"]'))
      const touchesStruck = !collapsed && struck.some((n) => intersects(r, n))
      if ((collapsed && (backward || forward)) || touchesStruck || t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertReplacementText') {
        e.preventDefault()
        if (t === 'insertFromDrop') return
        let x = a
        let y = z
        if (collapsed && backward) x = Math.max(0, a - wordOrChar(text.slice(0, a), t))
        if (collapsed && forward) y = Math.min(text.length, a + wordOrChar(text.slice(a), t, true))
        deleteVisible(sp, x, y)
        if (t.startsWith('insert')) insertVisible(sp, x, typed)
        setCaret(sp, x + (t.startsWith('insert') ? typed.length : 0))
        schedule(sb.id)
      }
    }
    // Chrome won't fire beforeinput for a selection that spans paragraphs or struck text, so
    // deleting or typing over one is caught on the key press instead.
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = window.getSelection()
      if (!sel?.rangeCount || sel.isCollapsed || e.metaKey || e.ctrlKey || e.altKey) return
      const del = e.key === 'Backspace' || e.key === 'Delete'
      const char = e.key.length === 1
      if (!del && !char) return
      const r = sel.getRangeAt(0)
      const sp = paraOf(r.startContainer)
      const ep = paraOf(r.endContainer)
      if (!sp || !ep) return e.preventDefault()
      const struck = Array.from(sp.querySelectorAll('[contenteditable="false"]')).some((n) => intersects(r, n))
      if (sp === ep && !struck) return
      e.preventDefault()
      replaceAcross(sp, ep, offsetIn(sp, r.startContainer, r.startOffset), offsetIn(ep, r.endContainer, r.endOffset), char ? e.key : '')
    }
    const onCut = (e: ClipboardEvent) => {
      const sel = window.getSelection()
      if (!sel?.rangeCount || sel.isCollapsed) return
      const r = sel.getRangeAt(0)
      const sp = paraOf(r.startContainer)
      const ep = paraOf(r.endContainer)
      e.preventDefault()
      if (!sp || !ep) return
      e.clipboardData?.setData('text/plain', sel.toString())
      replaceAcross(sp, ep, offsetIn(sp, r.startContainer, r.startOffset), offsetIn(ep, r.endContainer, r.endOffset), '')
    }
    /** Replace the selected text, which may run over several paragraphs, with `typed`. A paragraph wholly inside is struck. */
    const replaceAcross = (sp: HTMLElement, ep: HTMLElement, a: number, z: number, typed: string) => {
      const ps = Array.from(el.querySelectorAll<HTMLElement>('p[data-block]'))
      const from = ps.indexOf(sp)
      const to = ps.indexOf(ep)
      for (let i = from; i <= to; i++) {
        const p = ps[i]
        const id = p.dataset.block!
        const b = blockOf(p)
        if (b.kind === 'deleted' && d.edits[id] === undefined) continue
        const v = visibleText(p)
        const next = i === from && i === to ? v.slice(0, a) + typed + v.slice(z) : i === from ? v.slice(0, a) + typed : i === to ? v.slice(z) : ''
        if (next === v) continue
        window.clearTimeout(pending.current.get(id))
        pending.current.delete(id)
        force.current.set(id, { text: next, caret: i === from ? a + typed.length : null })
        act(window.api.doc.edit(sessionId.current, id, next))
      }
    }
    const onInput = () => {
      const p = paraOf(window.getSelection()?.anchorNode ?? null)
      if (p) schedule(p.dataset.block!)
    }
    el.addEventListener('beforeinput', onBeforeInput)
    el.addEventListener('input', onInput)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('cut', onCut)
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput)
      el.removeEventListener('input', onInput)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('cut', onCut)
    }
  })

  // Which paragraph the caret is in (for the right-hand column).
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      if (!sel?.rangeCount || !root.current?.contains(sel.anchorNode)) return
      const p = paraOf(sel.anchorNode)
      onFocusBlock(p?.dataset.block ?? null)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [onFocusBlock])

  // Selected text in one paragraph offers a comment on it.
  const onMouseUp = () => {
    const sel = window.getSelection()
    const quote = sel?.toString().trim()
    if (!sel?.rangeCount || !quote) return setBubble(null)
    const p = paraOf(sel.anchorNode)
    if (!p || p !== paraOf(sel.focusNode)) return setBubble(null)
    const r = sel.getRangeAt(0).getBoundingClientRect()
    setBubble({ x: r.left + r.width / 2, y: r.top, blockId: p.dataset.block!, quote })
  }

  return (
    <>
      <div
        ref={root}
        className="ed-doc"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        onMouseUp={onMouseUp}
        onKeyDown={() => setBubble(null)}
      >
        {d.blocks.map((b) => {
          const edited = d.edits[b.id] !== undefined
          const theirs = b.kind === 'deleted' || !!b.segments?.some((x) => x.op !== 'same')
          const comments = (b.comments?.length ?? 0) + d.comments.filter((c) => c.blockId === b.id).length
          return (
            <div key={b.id} className={`ed-row ${theirs ? 'theirs' : ''} ${edited ? 'ours' : ''} ${b.untracked ? 'untracked' : ''}`} data-row={b.id}>
              {b.untracked && (
                <div className="dr-untracked" contentEditable={false}>
                  {b.untracked === 'sent' ? 'not tracked' : b.standard ? 'not our standard' : 'not in our template'}
                </div>
              )}
              <p
                data-block={b.id}
                className={`ed-p k-${b.kind} ${b.center ? 'center' : ''} ${b.bold ? 'bold' : ''}`}
                style={b.level ? { paddingLeft: b.level * 22 } : undefined}
              />
              {comments > 0 && (
                <span className="ed-cbadge" contentEditable={false} title={`${comments} comment${comments === 1 ? '' : 's'}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onFocusBlock(b.id)}>
                  <Icon name="chat" size={12} /> {comments}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {bubble && (
        <button
          className="dr-bubble btn sm primary"
          style={{ left: bubble.x, top: bubble.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onComment(bubble.blockId, bubble.quote)
            setBubble(null)
          }}
        >
          <Icon name="chat" size={13} /> Comment
        </button>
      )}
    </>
  )
}

function intersects(r: StaticRange | Range, n: Node): boolean {
  const range = document.createRange()
  try {
    range.setStart(r.startContainer, r.startOffset)
    range.setEnd(r.endContainer, r.endOffset)
  } catch {
    return false
  }
  return range.intersectsNode(n)
}

/** How many characters a delete removes: one, or a word (⌥⌫ / Ctrl+⌫). */
function wordOrChar(text: string, type: string, forward = false): number {
  if (!type.includes('Word') && !type.includes('Line')) return 1
  if (type.includes('Line')) return text.length
  const m = forward ? text.match(/^\s*\S+/) : text.match(/\S+\s*$/)
  return m ? m[0].length : 1
}
