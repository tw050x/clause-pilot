import JSZip from 'jszip'
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom'
import type { Clause, RedlineComment, RedlineStats, ReviewSession } from '@shared/types'
import { clauseLabel } from '../../shared/derive'
import { readNumbering } from '../ingest/docxTracked'

/**
 * Our response as a marked-up Word document: the counterparty's contract with
 * our changes as Word tracked changes and our reasons as comments, the way a
 * lawyer would send it back.
 *
 * Word uploads are edited in place, so their formatting, numbering and their
 * own redline survive. PDF and text uploads have no Word original, so a plain
 * .docx is built from the clauses first and marked up the same way.
 *
 * Per clause:
 * - rejected with our wording: a word-level redline from their text to ours;
 * - rejected as a removal: the clause struck through;
 * - rejected without wording: a comment only;
 * - accepted: their tracked changes in it are accepted (the marks go);
 * - undecided: left exactly as they sent it.
 * Our standard clauses they deleted with Track Changes are reinstated (their
 * deletion rejected). Each rejection carries its reason as a comment, threaded
 * as a reply when they had commented on that clause.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
const XMLNS = 'http://www.w3.org/2000/xmlns/'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const REL_COMMENTS_EX = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const NUMBER_PREFIX = /^\s*\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+/


export async function buildRedline(
  s: ReviewSession,
  reviewer: string,
  original: Buffer,
  /** Test drafts: comment only where a reason was written (a counterparty doesn't explain every edit). */
  opts: { commentsOnlyWhenGiven?: boolean } = {}
): Promise<{ bytes: Buffer; stats: RedlineStats; comments: RedlineComment[] }> {
  const source = s.sourceType === 'docx' ? 'original' : 'generated'
  const zip = await JSZip.loadAsync(source === 'original' ? original : await baseDocx(s))
  const doc = await xml(zip, 'word/document.xml')
  if (!doc) throw new Error('Not a Word document (word/document.xml missing).')
  await numberParagraphs(zip, doc)
  const m = new Markup(zip, doc, reviewer)
  await m.loadComments()

  const stats: RedlineStats = { source, replaced: 0, removed: 0, commentedOnly: 0, reinstated: 0, acceptedChanges: 0, comments: 0, unmatched: [] }
  const groups = locateClauses(doc, s.clauses)

  for (const c of s.clauses) {
    const d = s.decisions[c.id]
    if (!d) continue
    const paras = groups.get(c.id)
    if (!paras) {
      stats.unmatched.push(c.number ?? c.id)
      continue
    }
    const theirComment = m.firstCommentIn(paras)
    if (d.decision === 'accepted') {
      if (resolveTheirChanges(paras, 'accept')) stats.acceptedChanges++
      if (theirComment) m.comment(paras, 'Agreed.', clauseLabel(c), theirComment, c.text)
      continue
    }
    const wording = d.removal ? '' : d.redline.trim()
    if (d.removal || wording) {
      m.redlineTo(paras, wording)
      d.removal ? stats.removed++ : stats.replaced++
    } else stats.commentedOnly++
    // The reviewer's note was written for the app ("the wording below"); in Word the wording is in the clause itself.
    const note = d.note.trim().replace(/\s*We propose the wording below instead\.?$/i, wording && !d.removal ? ' Our proposed wording is marked up in the clause.' : '')
    const reason = note || (d.removal ? 'We ask for this clause to be removed.' : 'We can’t accept this clause as drafted.')
    if (note || !opts.commentsOnlyWhenGiven) m.comment(paras, reason, clauseLabel(c), theirComment, c.text)
  }

  // Our standard clauses they deleted outright: put them back.
  for (const del of s.trackedDeletions ?? []) {
    if (!del.libraryTitle) continue
    const p = findDeletedParagraph(doc, del.text)
    if (!p) continue
    resolveTheirChanges([p], 'reject')
    m.comment([p], `This is part of our standard terms (${del.libraryTitle.toLowerCase()}), so we have reinstated it.`, del.number ? `Clause ${del.number}` : del.libraryTitle, null, del.text)
    stats.reinstated++
  }

  stats.comments = m.added
  if (m.added) await m.saveComments()
  await trackFurtherChanges(zip)
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  // In reading order (reinstated clauses are handled last but belong where they were).
  const order = (w: string) => (w.match(/\d+(?:\.\d+)*/)?.[0] ?? '999').split('.').map((n) => n.padStart(3, '0')).join('.')
  const comments = [...m.log].sort((a, b) => order(a.where).localeCompare(order(b.where)))
  return { bytes, stats, comments }
}

// ---- finding clauses in the document ------------------------------------------------------

const norm = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')

function bodyParagraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W, 'p'))
}

/**
 * Word's automatic numbers per paragraph, worked out before we change anything (as the reader
 * does), so the text we compare with the clause includes "2." or "a." the way the reader saw it.
 */
let labels = new WeakMap<Element, string>()
async function numberParagraphs(zip: JSZip, doc: Document) {
  labels = new WeakMap()
  const numbering = await readNumbering(zip)
  for (const p of bodyParagraphs(doc)) {
    const label = numbering.label(p, !visibleText(p).trim())
    if (label) labels.set(p, label)
  }
}

/** The paragraph's text as proposed: insertions in, deletions out. */
function visibleText(p: Element): string {
  return visiblePieces([p]).map((x) => x.text).join('')
}

/**
 * Each clause is one or more consecutive paragraphs. Walk the document in
 * order, matching each clause's text (ignoring case, spacing, punctuation and
 * the printed clause number) to the paragraphs that make it up.
 */
function locateClauses(doc: Document, clauses: Clause[]): Map<string, Element[]> {
  const paras = bodyParagraphs(doc).map((p) => ({ p, text: visibleText(p) }))
  const out = new Map<string, Element[]>()
  let cursor = 0
  for (const c of clauses) {
    const target = norm(c.text)
    if (!target) continue
    for (let i = cursor; i < paras.length; i++) {
      const first = norm(paras[i].text.replace(NUMBER_PREFIX, ''))
      if (!first || !target.startsWith(first)) continue
      const group = [paras[i].p]
      let acc = first
      let j = i + 1
      while (acc.length < target.length && j < paras.length) {
        const next = norm(paras[j].text)
        if (next) {
          // Allow for a list label ("a", "ii", "12") that Word numbers automatically and the text doesn't contain.
          const k = [0, 1, 2, 3, 4].find((n) => target.startsWith(next, acc.length + n))
          if (k === undefined) break
          acc = target.slice(0, acc.length + k) + next
          group.push(paras[j].p)
        }
        j++
      }
      if (acc === target) {
        out.set(c.id, group)
        cursor = j
        break
      }
    }
  }
  return out
}

function findDeletedParagraph(doc: Document, text: string): Element | null {
  const target = norm(text)
  for (const p of bodyParagraphs(doc)) {
    if (visibleText(p).trim()) continue
    const deleted = norm(Array.from(p.getElementsByTagNameNS(W, 'delText')).map((t) => t.textContent ?? '').join('').replace(NUMBER_PREFIX, ''))
    if (deleted && deleted === target) return p
  }
  return null
}

// ---- their tracked changes ---------------------------------------------------------------

/**
 * Accept or reject every tracked change in these paragraphs. Accepting keeps
 * insertions and drops deletions; rejecting does the opposite. Returns whether
 * there was anything to resolve.
 */
function resolveTheirChanges(paras: Element[], how: 'accept' | 'reject'): boolean {
  let changed = false
  for (const p of paras) {
    for (const name of ['ins', 'del', 'rPrChange', 'pPrChange'] as const) {
      for (const el of Array.from(p.getElementsByTagNameNS(W, name))) {
        if (!el.parentNode) continue
        changed = true
        const inProps = el.parentNode && (el.parentNode as Element).localName === 'rPr'
        // Paragraph-mark changes and formatting changes are markers: drop them either way
        // (rejecting a formatting change would need the old properties restored; keep theirs).
        if (inProps || name === 'rPrChange' || name === 'pPrChange') {
          el.parentNode.removeChild(el)
          continue
        }
        const keep = (name === 'ins') === (how === 'accept')
        if (keep) unwrap(el)
        else el.parentNode.removeChild(el)
      }
    }
    if (how === 'reject') {
      for (const t of Array.from(p.getElementsByTagNameNS(W, 'delText'))) rename(t, 't')
    }
  }
  return changed
}

function unwrap(el: Element) {
  const parent = el.parentNode!
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

function rename(el: Element, local: string) {
  const doc = el.ownerDocument!
  const next = doc.createElementNS(W, `w:${local}`)
  for (const a of Array.from(el.attributes)) a.namespaceURI ? next.setAttributeNS(a.namespaceURI, a.name, a.value) : next.setAttribute(a.name, a.value)
  while (el.firstChild) next.appendChild(el.firstChild)
  el.parentNode!.replaceChild(next, el)
  return next
}

// ---- visible text as runs ----------------------------------------------------------------

interface Piece {
  /** null for text the reader adds that isn't in a run: automatic numbers and the gaps between paragraphs. */
  run: Element | null
  node: Element | null // w:t or w:tab
  text: string
  start: number
  end: number
}

const ancestor = (el: Node, stop: Element, names: string[]) => {
  for (let n = el.parentNode; n && n !== stop; n = n.parentNode) if (names.includes((n as Element).localName ?? "")) return n as Element
  return null
}

/** The visible characters of the paragraphs, one piece per text node, in order. */
function visiblePieces(paras: Element[]): Piece[] {
  const out: Piece[] = []
  let at = 0
  const virtual = (text: string) => {
    out.push({ run: null, node: null, text, start: at, end: at + text.length })
    at += text.length
  }
  const cellOf = (p: Element) => ancestor(p, p.ownerDocument!.documentElement!, ['tc'])
  paras.forEach((p, i) => {
    // As the reader joins them: a space between paragraphs, " — " between table cells.
    if (i) virtual(cellOf(p) && cellOf(paras[i - 1]) && cellOf(p) !== cellOf(paras[i - 1]) ? ' — ' : ' ')
    const label = labels.get(p)
    if (label) virtual(`${label} `)
    for (const run of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
      if (ancestor(run, p, ['del', 'rPr'])) continue
      for (let n = run.firstChild; n; n = n.nextSibling) {
        const el = n as Element
        if (el.nodeType !== 1 || el.namespaceURI !== W) continue
        const text = el.localName === 't' ? el.textContent ?? '' : el.localName === 'tab' ? ' ' : null
        if (text === null || !text) continue
        out.push({ run, node: el, text, start: at, end: at + text.length })
        at += text.length
      }
    }
  })
  return out
}

// ---- our markup --------------------------------------------------------------------------

interface Comment {
  id: number
  /** paraId of the comment's last paragraph (threads replies). */
  paraId?: string
}

class Markup {
  private revId: number
  private nextComment = 0
  private comments: Document | null = null
  private extended: Document | null = null
  private date = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  private initials: string
  added = 0
  log: RedlineComment[] = []

  constructor(
    private zip: JSZip,
    private doc: Document,
    private author: string
  ) {
    let max = 0
    for (const tag of ['ins', 'del', 'commentRangeStart', 'bookmarkStart']) {
      for (const el of Array.from(doc.getElementsByTagNameNS(W, tag))) max = Math.max(max, Number(el.getAttributeNS(W, 'id')) || 0)
    }
    this.revId = max + 1000
    this.initials = author.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'PS'
  }

  private el(name: string, attrs: Record<string, string> = {}, doc = this.doc): Element {
    const e = doc.createElementNS(W, `w:${name}`)
    for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v)
    return e
  }

  private track(kind: 'ins' | 'del'): Element {
    return this.el(kind, { id: String(this.revId++), author: this.author, date: this.date })
  }

  /**
   * Redline the clause from its current (proposed) text to `wording`, word by
   * word, as our tracked changes. Empty wording strikes the whole clause. The
   * printed clause number is never touched.
   */
  redlineTo(paras: Element[], wording: string) {
    const all = visiblePieces(paras)
    const full = all.map((x) => x.text).join('')
    const prefix = full.match(NUMBER_PREFIX)?.[0].length ?? 0
    const old = full.slice(prefix)
    const ops = diffWords(old, wording.replace(/\s+/g, ' ').trim())
    // Apply from the end so earlier character positions stay valid.
    for (const op of ops.reverse()) {
      const a = prefix + op.from
      const b = prefix + op.to
      if (op.insert) this.insertAt(paras, b, op.insert, prefix)
      if (b > a) this.deleteRange(paras, a, b)
    }
  }

  /** Make sure a run boundary falls at character `at`. */
  private splitAt(paras: Element[], at: number) {
    const piece = visiblePieces(paras).find((x) => x.run && x.start < at && at < x.end)
    if (!piece || !piece.run || !piece.node) return
    const k = at - piece.start
    // Isolate the text node in its own run first (a run can hold several).
    const run = isolate(piece.run, piece.node)
    const tail = run.cloneNode(true) as Element
    setText(firstText(run)!, piece.text.slice(0, k))
    setText(firstText(tail)!, piece.text.slice(k))
    run.parentNode!.insertBefore(tail, run.nextSibling)
  }

  private deleteRange(paras: Element[], a: number, b: number) {
    this.splitAt(paras, a)
    this.splitAt(paras, b)
    // Give each text node in range its own run, then strike those runs. (Collect first: once a run
    // is struck it stops counting as visible text and every later position shifts.)
    for (const x of visiblePieces(paras)) if (x.run && x.node && x.start >= a && x.end <= b && x.node.parentNode === x.run) isolate(x.run, x.node)
    // Numbers and paragraph gaps aren't text we can strike; they stay.
    const runs = visiblePieces(paras).filter((x) => x.run && x.start >= a && x.end <= b).map((x) => x.run as Element)
    for (const run of runs) {
      const wrap = this.track('del')
      run.parentNode!.insertBefore(wrap, run)
      wrap.appendChild(run)
      const t = firstText(run)
      if (t && t.localName === 't') rename(t, 'delText')
    }
  }

  private insertAt(paras: Element[], at: number, text: string, prefix: number) {
    this.splitAt(paras, at)
    const pieces = visiblePieces(paras).filter((x): x is Piece & { run: Element } => !!x.run)
    const before = pieces.filter((x) => x.end <= at).pop()
    const after = pieces.find((x) => x.start >= at)
    // Take formatting from the text we're next to, but never from the (often bold) clause number.
    const styleFrom = before && before.end > prefix ? before.run : after?.run ?? before?.run
    const run = this.el('r')
    const rPr = styleFrom?.getElementsByTagNameNS(W, 'rPr')[0]
    if (rPr && rPr.parentNode === styleFrom) {
      const copy = rPr.cloneNode(true) as Element
      for (const n of ['ins', 'del', 'rPrChange']) for (const x of Array.from(copy.getElementsByTagNameNS(W, n))) copy.removeChild(x)
      run.appendChild(copy)
    }
    const t = this.el('t')
    t.setAttribute('xml:space', 'preserve')
    t.appendChild(this.doc.createTextNode(text))
    run.appendChild(t)
    const ins = this.track('ins')
    ins.appendChild(run)

    // Right after a paragraph gap or number, the insertion belongs to the text that follows.
    if (before && (!after || before.end === at)) placeAfter(before.run, ins)
    else if (after) placeBefore(after.run, ins)
    else {
      const p = paras[0]
      const pPr = p.getElementsByTagNameNS(W, 'pPr')[0]
      p.insertBefore(ins, pPr && pPr.parentNode === p ? pPr.nextSibling : p.firstChild)
    }
  }

  // ---- comments ----

  async loadComments() {
    this.comments = await xml(this.zip, 'word/comments.xml')
    this.extended = await xml(this.zip, 'word/commentsExtended.xml')
    let max = -1
    for (const tag of ['comment']) {
      for (const el of Array.from(this.comments?.getElementsByTagNameNS(W, tag) ?? [])) max = Math.max(max, Number(el.getAttributeNS(W, 'id')) || 0)
    }
    this.nextComment = max + 1
  }

  /** Their comment anchored in these paragraphs, if any (the first). */
  firstCommentIn(paras: Element[]): Comment | null {
    for (const p of paras) {
      const ref = p.getElementsByTagNameNS(W, 'commentRangeStart')[0] ?? p.getElementsByTagNameNS(W, 'commentReference')[0]
      if (ref) return { id: Number(ref.getAttributeNS(W, 'id')) }
    }
    return null
  }

  /** Add our comment on these paragraphs, or as a reply to `parent` (anchored on the same text). */
  comment(paras: Element[], text: string, where: string, parent?: Comment | null, quote = '') {
    const id = this.nextComment++
    this.added++
    this.log.push({ where, text, quote, author: this.author, replyTo: parent ? this.commentText(parent.id) : undefined })
    const paraId = randomParaId()
    this.writeComment(id, text, paraId)

    const start = this.el('commentRangeStart', { id: String(id) })
    const end = this.el('commentRangeEnd', { id: String(id) })
    const refRun = this.el('r')
    refRun.appendChild(this.el('commentReference', { id: String(id) }))

    const parentStart = parent && this.find('commentRangeStart', parent.id)
    const parentRef = parent && this.find('commentReference', parent.id)
    if (parent && parentStart && parentRef) {
      // Word threads a reply by placing its anchors beside its parent's.
      placeAfter(parentStart, start)
      const parentEnd = this.find('commentRangeEnd', parent.id)
      if (parentEnd) placeAfter(parentEnd, end)
      else placeBefore(parentRef.parentNode as Element, end)
      placeAfter(parentRef.parentNode as Element, refRun)
      this.thread(paraId, this.parentParaId(parent.id))
    } else {
      const first = paras[0]
      const pPr = first.getElementsByTagNameNS(W, 'pPr')[0]
      first.insertBefore(start, pPr && pPr.parentNode === first ? pPr.nextSibling : first.firstChild)
      const last = paras[paras.length - 1]
      last.appendChild(end)
      last.appendChild(refRun)
      this.thread(paraId, null)
    }
  }

  private commentText(id: number): { author: string; text: string } | undefined {
    const c = Array.from(this.comments?.getElementsByTagNameNS(W, 'comment') ?? []).find((e) => e.getAttributeNS(W, 'id') === String(id))
    if (!c) return undefined
    const text = Array.from(c.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('').trim()
    return { author: c.getAttributeNS(W, 'author') || 'Unknown', text }
  }

  private find(tag: string, id: number): Element | null {
    return Array.from(this.doc.getElementsByTagNameNS(W, tag)).find((e) => e.getAttributeNS(W, 'id') === String(id)) ?? null
  }

  private ensureComments(): Document {
    if (!this.comments) {
      this.comments = new DOMParser().parseFromString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}" xmlns:w14="${W14}"/>`, 'text/xml')
    }
    const root = this.comments.documentElement!
    if (!root.getAttribute('xmlns:w14')) root.setAttributeNS(XMLNS, 'xmlns:w14', W14)
    return this.comments
  }

  private writeComment(id: number, text: string, paraId: string) {
    const doc = this.ensureComments()
    const c = this.el('comment', { id: String(id), author: this.author, date: this.date, initials: this.initials }, doc)
    const lines = text.split(/\n+/).filter(Boolean)
    lines.forEach((line, i) => {
      const p = this.el('p', {}, doc)
      if (i === lines.length - 1) p.setAttributeNS(W14, 'w14:paraId', paraId)
      if (i === 0) {
        const r = this.el('r', {}, doc)
        r.appendChild(this.el('annotationRef', {}, doc))
        p.appendChild(r)
      }
      const r = this.el('r', {}, doc)
      const t = this.el('t', {}, doc)
      t.setAttribute('xml:space', 'preserve')
      t.appendChild(doc.createTextNode(line))
      r.appendChild(t)
      p.appendChild(r)
      c.appendChild(p)
    })
    doc.documentElement!.appendChild(c)
  }

  /** The paraId of an existing comment's last paragraph, adding one if it has none. */
  private parentParaId(id: number): string | null {
    const c = Array.from(this.comments?.getElementsByTagNameNS(W, 'comment') ?? []).find((e) => e.getAttributeNS(W, 'id') === String(id))
    const ps = c ? Array.from(c.getElementsByTagNameNS(W, 'p')) : []
    const last = ps[ps.length - 1]
    if (!last) return null
    let pid = last.getAttributeNS(W14, 'paraId')
    if (!pid) {
      pid = randomParaId()
      last.setAttributeNS(W14, 'w14:paraId', pid)
      this.thread(pid, null)
    }
    return pid
  }

  private thread(paraId: string, parent: string | null) {
    if (!this.extended) {
      this.extended = new DOMParser().parseFromString(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="${W15}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15"/>`,
        'text/xml'
      )
    }
    const ex = this.extended.createElementNS(W15, 'w15:commentEx')
    ex.setAttributeNS(W15, 'w15:paraId', paraId)
    if (parent) ex.setAttributeNS(W15, 'w15:paraIdParent', parent)
    ex.setAttributeNS(W15, 'w15:done', '0')
    this.extended.documentElement!.appendChild(ex)
  }

  async saveComments() {
    const ser = new XMLSerializer()
    this.zip.file('word/comments.xml', ser.serializeToString(this.comments!))
    await addPart(this.zip, 'word/comments.xml', REL_COMMENTS, 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml')
    if (this.extended) {
      this.zip.file('word/commentsExtended.xml', ser.serializeToString(this.extended))
      await addPart(this.zip, 'word/commentsExtended.xml', REL_COMMENTS_EX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml')
    }
  }
}

// ---- small DOM helpers --------------------------------------------------------------------

const firstText = (run: Element) =>
  (Array.from(run.childNodes).find((n) => n.nodeType === 1 && ['t', 'tab', 'delText'].includes((n as Element).localName ?? "")) as Element | undefined) ?? null

function setText(t: Element, text: string) {
  while (t.firstChild) t.removeChild(t.firstChild)
  t.appendChild(t.ownerDocument!.createTextNode(text))
  if (t.localName === 't') t.setAttribute('xml:space', 'preserve')
}

/** Give `node` a run of its own (same formatting), splitting the run around it if needed. */
function isolate(run: Element, node: Element): Element {
  const content = Array.from(run.childNodes).filter((n) => n.nodeType === 1 && (n as Element).localName !== 'rPr')
  if (content.length === 1) return run
  const rPr = Array.from(run.childNodes).find((n) => (n as Element).localName === 'rPr') as Element | undefined
  const make = () => {
    const r = run.ownerDocument!.createElementNS(W, 'w:r')
    if (rPr) r.appendChild(rPr.cloneNode(true))
    return r
  }
  // One run per content child, in order; return the one holding `node`.
  let mine = run
  const parent = run.parentNode!
  for (const child of content) {
    const r = make()
    parent.insertBefore(r, run)
    r.appendChild(child)
    if (child === node) mine = r
  }
  parent.removeChild(run)
  return mine
}

/** Our tracked changes can't sit inside another tracked change: step out of theirs, splitting it. */
function placeAfter(anchor: Element, el: Element) {
  const parent = anchor.parentNode as Element
  if (['ins', 'del', 'moveFrom', 'moveTo'].includes(parent.localName ?? "") && ['ins', 'del'].includes(el.localName ?? "")) {
    splitAfter(parent, anchor)
    parent.parentNode!.insertBefore(el, parent.nextSibling)
  } else parent.insertBefore(el, anchor.nextSibling)
}

function placeBefore(anchor: Element, el: Element) {
  const parent = anchor.parentNode as Element
  if (['ins', 'del', 'moveFrom', 'moveTo'].includes(parent.localName ?? "") && ['ins', 'del'].includes(el.localName ?? "")) {
    if (anchor.previousSibling) {
      splitAfter(parent, anchor.previousSibling as Element)
      parent.parentNode!.insertBefore(el, parent.nextSibling)
    } else parent.parentNode!.insertBefore(el, parent)
  } else parent.insertBefore(el, anchor)
}

/** Move everything after `child` into a copy of `wrapper` placed right after it. */
function splitAfter(wrapper: Element, child: Element) {
  if (!child.nextSibling) return
  const copy = wrapper.cloneNode(false) as Element
  while (child.nextSibling) copy.appendChild(child.nextSibling)
  wrapper.parentNode!.insertBefore(copy, wrapper.nextSibling)
}

function randomParaId(): string {
  return Math.floor(Math.random() * 0x7fffffff).toString(16).toUpperCase().padStart(8, '0')
}

// ---- word-level diff ---------------------------------------------------------------------

interface Op {
  /** Character range of `old` to delete (empty for a pure insertion). */
  from: number
  to: number
  /** Text inserted after that range. */
  insert: string
}

/** Word-level diff from `old` to `next`, as replacements over character ranges of `old`. */
export function diffWords(old: string, next: string): Op[] {
  const tok = (s: string) => {
    const out: { word: string; text: string; at: number }[] = []
    for (const m of s.matchAll(/\S+\s*/g)) out.push({ word: m[0].trim(), text: m[0], at: m.index! })
    return out
  }
  const a = tok(old)
  const b = tok(next)
  // LCS table on words.
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i].word === b[j].word ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])

  const ops: Op[] = []
  let i = 0
  let j = 0
  let cur: { from: number; to: number; ins: string[] } | null = null
  const flush = () => {
    if (cur && (cur.to > cur.from || cur.ins.length)) ops.push({ from: cur.from, to: cur.to, insert: cur.ins.join('') })
    cur = null
  }
  const pos = (k: number) => (k < a.length ? a[k].at : old.length)
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      flush()
      i++
      j++
    } else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) {
      cur ??= { from: pos(i), to: pos(i), ins: [] }
      cur.ins.push(b[j].text)
      j++
    } else {
      cur ??= { from: pos(i), to: pos(i), ins: [] }
      cur.to = pos(i + 1)
      i++
    }
  }
  flush()
  // Spacing: an insertion at the very end of text with no trailing space needs a leading one.
  for (const op of ops) {
    if (!op.insert) continue
    const atEnd = op.to >= old.length
    if (atEnd && old && !/\s$/.test(old.slice(0, op.from) + old.slice(op.from, op.to)) && op.to === op.from) op.insert = ' ' + op.insert.trimEnd()
    else if (!atEnd && !/\s$/.test(op.insert)) op.insert += ' '
  }
  return ops
}

// ---- package helpers ---------------------------------------------------------------------

async function xml(zip: JSZip, path: string): Promise<Document | null> {
  const text = await zip.file(path)?.async('string')
  return text ? new DOMParser().parseFromString(text, 'text/xml') : null
}

/** Register a part with the document's relationships and the package content types, if missing. */
async function addPart(zip: JSZip, path: string, relType: string, contentType: string) {
  const relsPath = 'word/_rels/document.xml.rels'
  const rels = (await xml(zip, relsPath)) ?? new DOMParser().parseFromString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"/>`, 'text/xml')
  const target = path.replace(/^word\//, '')
  const existing = Array.from(rels.getElementsByTagNameNS(REL, 'Relationship'))
  if (!existing.some((r) => r.getAttribute('Target') === target)) {
    const ids = new Set(existing.map((r) => r.getAttribute('Id')))
    let n = existing.length + 1
    while (ids.has(`rId${n}`)) n++
    const r = rels.createElementNS(REL, 'Relationship')
    r.setAttribute('Id', `rId${n}`)
    r.setAttribute('Type', relType)
    r.setAttribute('Target', target)
    rels.documentElement!.appendChild(r)
    zip.file(relsPath, new XMLSerializer().serializeToString(rels))
  }
  const ctDoc = await xml(zip, '[Content_Types].xml')
  if (ctDoc && !Array.from(ctDoc.getElementsByTagNameNS(CT, 'Override')).some((o) => o.getAttribute('PartName') === `/${path}`)) {
    const o = ctDoc.createElementNS(CT, 'Override')
    o.setAttribute('PartName', `/${path}`)
    o.setAttribute('ContentType', contentType)
    ctDoc.documentElement!.appendChild(o)
    zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(ctDoc))
  }
}

/** Turn Track Changes on, so their next edits to our draft are tracked too. */
async function trackFurtherChanges(zip: JSZip) {
  const settings = await xml(zip, 'word/settings.xml')
  if (!settings || settings.getElementsByTagNameNS(W, 'trackRevisions').length) return
  const root = settings.documentElement!
  const el = settings.createElementNS(W, 'w:trackRevisions')
  // Schema order: trackRevisions comes early; after the view/zoom/proofing settings is accepted by Word.
  const after = ['writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime', 'doNotDisplayPageBoundaries', 'displayBackgroundShape', 'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData', 'embedTrueTypeFonts', 'embedSystemFonts', 'saveSubsetFonts', 'saveFormsData', 'mirrorMargins', 'alignBordersAndEdges', 'bordersDoNotSurroundHeader', 'bordersDoNotSurroundFooter', 'gutterAtTop', 'hideSpellingErrors', 'hideGrammaticalErrors', 'activeWritingStyle', 'proofState', 'formsDesign', 'attachedTemplate', 'linkStyles', 'stylePaneFormatFilter', 'stylePaneSortMethod', 'documentType', 'mailMerge', 'revisionView']
  let ref: Node | null = root.firstChild
  while (ref && ref.nodeType === 1 && after.includes((ref as Element).localName ?? "")) ref = ref.nextSibling
  root.insertBefore(el, ref)
  zip.file('word/settings.xml', new XMLSerializer().serializeToString(settings))
}

// ---- a Word base for PDF / text uploads --------------------------------------------------

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A plain .docx of the contract as we read it: headings, then each clause with its number. */
async function baseDocx(s: ReviewSession): Promise<Buffer> {
  const body: string[] = []
  const para = (runs: string, opts = '') => `<w:p><w:pPr>${opts}<w:spacing w:after="120"/></w:pPr>${runs}</w:p>`
  const run = (t: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`
  let heading: string | null = null
  for (const c of s.clauses) {
    if (c.heading && c.heading !== heading) body.push(para(run(c.heading, true), '<w:keepNext/>'))
    heading = c.heading
    body.push(para((c.number ? run(`${c.number} `, true) : '') + run(c.text)))
  }
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`
  )
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`
  )
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}"/>`)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}
