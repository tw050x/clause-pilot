import JSZip from 'jszip'
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom'
import type { DocBlock, DocReview, RedlineComment, RedlineStats, ReviewSession } from '@shared/types'
import { labelsOf, parseLabel } from '../../shared/numbering'
import { changeKey, changeSets, commentResolved, segmentsOf, statusOf } from '../../shared/changes'
import { readNumbering } from '../ingest/docxTracked'
import { diffWords } from '../../shared/diff'

/**
 * Our response as a marked-up Word document: the counterparty's contract with
 * our changes as Word tracked changes and our reasons as comments, the way a
 * lawyer would send it back.
 *
 * Word uploads are edited in place, so their formatting, numbering and their
 * own redline survive. PDF and text uploads have no Word original, so a plain
 * .docx is built from the paragraphs first and marked up the same way.
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


/**
 * The marked-up copy for a document review: each paragraph we edited becomes
 * a word-level redline in the reviewer's name; change sets we accepted have
 * their tracked changes accepted; paragraphs they deleted that we restored are
 * reinstated; our margin comments go in as Word comments (replies where they
 * answer one of theirs). Untouched paragraphs are left exactly as received.
 */
export async function buildDocRedline(s: ReviewSession, reviewer: string, original: Buffer): Promise<{ bytes: Buffer; stats: RedlineStats; comments: RedlineComment[] }> {
  const d = s.doc!
  const source = s.sourceType === 'docx' && d.blocks.some((b) => b.paras?.length) ? 'original' : 'generated'
  // Paragraphs they removed without tracking aren't in the file; restoring one inserts it again.
  const received = d.blocks.filter((b) => !(b.untracked && b.kind === 'deleted') && !b.ours)
  const zip = await JSZip.loadAsync(source === 'original' ? original : await docxFromBlocks(received))
  const doc = await xml(zip, 'word/document.xml')
  if (!doc) throw new Error('Not a Word document (word/document.xml missing).')
  await numberParagraphs(zip, doc)
  const all = bodyParagraphs(doc) // indexes are taken before anything changes
  const index = new Map(received.map((b, i) => [b.id, i]))
  const parasOf = (b: DocBlock) =>
    source === 'original' ? (b.paras ?? []).map((n) => all[n]).filter(Boolean) : index.has(b.id) ? [all[index.get(b.id)!]].filter(Boolean) : []
  const where = (b: DocBlock) => (b.label ? `§${b.label.replace(/\.$/, '')}` : b.kind === 'row' ? b.text.split(' — ')[0] : 'Paragraph')
  const m = new Markup(zip, doc, reviewer)
  await m.loadComments()
  const stats: RedlineStats = { source, replaced: 0, removed: 0, commentedOnly: 0, reinstated: 0, acceptedChanges: 0, comments: 0, unmatched: [] }

  for (const set of changeSets(d)) {
    if (statusOf(d, set) !== 'accepted') continue
    for (const b of set.blocks) resolveTheirChanges(parasOf(b), 'accept')
    stats.acceptedChanges++
  }
  // Their individual changes we accepted or rejected (tracked ones; the rest are our edits).
  for (const b of d.blocks) {
    if (b.untracked) continue
    const picks = new Map<number, 'accepted' | 'rejected'>()
    segmentsOf(b).forEach((_x, i) => {
      const r = d.resolved?.[changeKey(b.id, i)]
      if (r) picks.set(i, r)
    })
    if (picks.size && resolveSome(parasOf(b), segmentsOf(b), picks)) stats.acceptedChanges += picks.size
  }
  const added = new Map<string, Element>()
  for (const b of d.blocks) {
    const edit = d.edits[b.id]
    if (edit === undefined) continue
    const paras = parasOf(b)
    if (b.ours) {
      // A paragraph we added: inserted after the nearest paragraph before it that's in the file.
      if (!edit.trim()) continue
      const at = d.blocks.indexOf(b)
      // After the paragraph before it (one we've just added, or one in the file).
      const prev = d.blocks
        .slice(0, at)
        .reverse()
        .map((x) => (added.has(x.id) ? [added.get(x.id)!] : parasOf(x)))
        .find((p) => p.length)
      const next = d.blocks.slice(at + 1).map(parasOf).find((p) => p.length)
      // Numbered: in a Word list, it joins the list and Word numbers it (and renumbers the rest);
      // with typed numbers, its number is typed in too.
      const label = labelsOf(d).get(b.id)
      let text = edit.trim()
      let opts: { styleFrom?: Element; ilvl?: number } = {}
      if (b.list && label) {
        const model = listModel(d, b, parasOf)
        if (model) opts = model
        else text = `${label} ${text}`
      }
      const p = m.insertParagraph(prev?.[prev.length - 1] ?? null, next?.[0] ?? null, text, opts)
      if (p) added.set(b.id, p)
      stats.replaced++
      continue
    }
    if (!paras.length && b.untracked && b.kind === 'deleted') {
      // Put it back where it was: after the nearest paragraph before it that's in the file.
      if (!edit) continue
      const at = d.blocks.indexOf(b)
      const prev = d.blocks.slice(0, at).reverse().map(parasOf).find((p) => p.length)
      const next = d.blocks.slice(at + 1).map(parasOf).find((p) => p.length)
      m.insertParagraph(prev?.[prev.length - 1] ?? null, next?.[0] ?? null, (b.label ? `${b.label} ` : '') + edit)
      stats.reinstated++
      continue
    }
    if (!paras.length) {
      stats.unmatched.push(where(b))
      continue
    }
    if (b.kind === 'deleted') {
      // Restoring a paragraph they deleted: reject their deletion, then any wording of ours on top.
      resolveTheirChanges(paras, 'reject')
      stats.reinstated++
      if (norm(edit) !== norm(b.text)) m.redlineTo(paras, edit)
      continue
    }
    m.redlineTo(paras, edit)
    edit ? stats.replaced++ : stats.removed++
  }
  // Typed numbers after a clause we added move up, as our tracked changes ("2.4" → "2.5").
  // Word's automatic numbers renumber themselves.
  const now = labelsOf(d)
  for (const b of d.blocks) {
    if (b.ours || !b.label || b.kind === 'deleted') continue
    const next = now.get(b.id)
    const paras = parasOf(b)
    if (!next || next === b.label || !paras.length || labels.get(paras[0])) continue
    if (!visibleText(paras[0]).trimStart().startsWith(b.label)) continue
    m.renumber(paras, b.label, next)
    stats.replaced++
  }
  for (const c of d.comments) {
    const b = d.blocks.find((x) => x.id === c.blockId)
    const paras = b ? parasOf(b) : []
    if (!b || !paras.length) continue
    m.comment(paras, c.text, where(b), c.replyTo ? { id: Number(c.replyTo) } : null, c.quote ?? b.text, !!c.quote, commentResolved(d, c))
  }
  // Their comments we resolved (or reopened) here: Word's done flag on the comment in their file.
  const theirIds = new Set(d.blocks.flatMap((b) => (b.comments ?? []).map((c) => c.id)))
  for (const [id, r] of Object.entries(d.commentsDone ?? {})) if (theirIds.has(id)) m.markDone(Number(id), r.done)
  stats.commentedOnly = d.comments.filter((c) => d.edits[c.blockId] === undefined).length
  stats.comments = m.added
  if (m.added || m.marked) await m.saveComments()
  await trackFurtherChanges(zip)
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { bytes, stats, comments: m.log }
}

/**
 * For a numbered paragraph we added, in a document with Word's automatic numbering: the
 * paragraph of the same list to take its properties from, and the list level it goes at.
 */
function listModel(d: DocReview, b: DocBlock, parasOf: (b: DocBlock) => Element[]): { styleFrom: Element; ilvl: number } | undefined {
  if (b.list?.kind !== 'dec') return undefined
  const at = d.blocks.indexOf(b)
  for (const x of d.blocks.slice(0, at).reverse()) {
    if (x.ours) continue
    const parsed = parseLabel(x.label)
    if (parsed?.kind !== 'dec') continue
    const p = parasOf(x)[0]
    if (!p || !labels.get(p)) return undefined // typed numbers
    const ilvl = Number(p.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') ?? 0)
    return { styleFrom: p, ilvl: ilvl + (b.list.depth - parsed.parts.length) }
  }
  return undefined
}

/** A plain .docx of the contract as received (PDF / text uploads): one paragraph per block. */
async function docxFromBlocks(blocks: DocBlock[]): Promise<Buffer> {
  return packageDocx(
    blocks.map((b) => {
      const opts = `${b.center ? '<w:jc w:val="center"/>' : ''}${b.kind === 'heading' ? '<w:keepNext/>' : ''}`
      const runs = (b.label ? run(`${b.label} `, true) : '') + run(b.text, b.kind === 'heading' || !!b.bold)
      return para(runs, opts)
    })
  )
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

/**
 * Accept or reject particular tracked changes in paragraphs: segment `i` of the redline as read
 * is matched to the w:ins / w:del elements that make it up, in document order.
 */
function resolveSome(paras: Element[], segments: { op: string; text: string }[], picks: Map<number, 'accepted' | 'rejected'>): boolean {
  const runs: { op: 'ins' | 'del'; el: Element; text: string }[] = []
  for (const p of paras)
    for (const el of Array.from(p.getElementsByTagNameNS(W, '*')))
      if ((el.localName === 'ins' || el.localName === 'del') && (el.parentNode as Element)?.localName !== 'rPr')
        runs.push({ op: el.localName, el, text: norm(Array.from(el.getElementsByTagNameNS(W, el.localName === 'del' ? 'delText' : 't')).map((t) => t.textContent ?? '').join('')) })
  let cursor = 0
  let done = false
  segments.forEach((seg, i) => {
    if (seg.op === 'same') return
    const want = norm(seg.text)
    const els: Element[] = []
    let got = ''
    for (let k = cursor; k < runs.length && got.length < want.length; k++) {
      const r = runs[k]
      if (r.op !== seg.op || !r.text) continue
      if (!want.startsWith(got + r.text) && !(got + r.text).startsWith(want)) {
        if (els.length) break
        continue
      }
      els.push(r.el)
      got += r.text
      cursor = k + 1
    }
    const how = picks.get(i)
    if (!how || !els.length) return
    for (const el of els) {
      if (!el.parentNode) continue
      const keep = (el.localName === 'ins') === (how === 'accepted')
      if (keep) {
        if (el.localName === 'del') for (const t of Array.from(el.getElementsByTagNameNS(W, 'delText'))) rename(t, 't')
        unwrap(el)
      } else el.parentNode.removeChild(el)
      done = true
    }
  })
  return done
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
    // The printed number is never ours to change: Word's automatic one, or one typed in.
    const prefix = all[0] && !all[0].run && labels.get(paras[0]) ? all[0].text.length : full.match(NUMBER_PREFIX)?.[0].length ?? 0
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

  /** Change a typed clause number, as a tracked change. */
  renumber(paras: Element[], from: string, to: string) {
    const lead = visiblePieces(paras).map((x) => x.text).join('').match(/^\s*/)![0].length
    this.insertAt(paras, lead, to, 0)
    this.deleteRange(paras, lead + to.length, lead + to.length + from.length)
  }

  /** A whole new paragraph as our tracked insertion, after `after` (or before `before`), styled like its neighbour. */
  insertParagraph(after: Element | null, before: Element | null, text: string, opts: { styleFrom?: Element; ilvl?: number } = {}): Element | null {
    const near = after ?? before
    if (!near) return null
    const p = this.el('p')
    // Paragraph properties from a neighbour, or (numbered) from the paragraph whose list it joins.
    const from = opts.styleFrom ?? near
    const pPr = from.getElementsByTagNameNS(W, 'pPr')[0]
    const ppr = pPr && pPr.parentNode === from ? (pPr.cloneNode(true) as Element) : this.el('pPr')
    const drop = opts.styleFrom ? ['rPr', 'sectPr', 'pPrChange'] : ['rPr', 'numPr', 'sectPr', 'pPrChange']
    for (const n of drop) for (const x of Array.from(ppr.getElementsByTagNameNS(W, n))) if (x.parentNode === ppr) ppr.removeChild(x)
    // Word numbers it: same list, at the level asked for.
    const ilvl = opts.ilvl !== undefined ? ppr.getElementsByTagNameNS(W, 'ilvl')[0] : undefined
    if (ilvl) ilvl.setAttributeNS(W, 'w:val', String(Math.max(0, opts.ilvl!)))
    // The paragraph mark itself is inserted too, so rejecting the change removes the whole paragraph.
    const rPr = this.el('rPr')
    rPr.appendChild(this.track('ins'))
    ppr.appendChild(rPr)
    p.appendChild(ppr)
    const run = this.el('r')
    const t = this.el('t')
    t.setAttribute('xml:space', 'preserve')
    t.appendChild(this.doc.createTextNode(text))
    run.appendChild(t)
    const ins = this.track('ins')
    ins.appendChild(run)
    p.appendChild(ins)
    if (after) after.parentNode!.insertBefore(p, after.nextSibling)
    else before!.parentNode!.insertBefore(p, before)
    return p
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

  /** Add our comment on these paragraphs, or as a reply to `parent` (anchored on the same text). */
  comment(paras: Element[], text: string, where: string, parent?: Comment | null, quote = '', onQuote = false, done = false) {
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
      this.thread(paraId, this.parentParaId(parent.id), done)
    } else if (onQuote && this.anchorOn(paras, quote, start, end)) {
      // On the words it was made on, as Word does when you comment on a selection.
      placeAfter(end, refRun)
      this.thread(paraId, null, done)
    } else {
      const first = paras[0]
      const pPr = first.getElementsByTagNameNS(W, 'pPr')[0]
      first.insertBefore(start, pPr && pPr.parentNode === first ? pPr.nextSibling : first.firstChild)
      const last = paras[paras.length - 1]
      last.appendChild(end)
      last.appendChild(refRun)
      this.thread(paraId, null, done)
    }
  }

  /**
   * Put a comment's range around `quote` in the paragraphs (the text as it now reads, our edits
   * in). Runs are split where the quote starts and ends. False if the words aren't there.
   */
  private anchorOn(paras: Element[], quote: string, start: Element, end: Element): boolean {
    const q = quote.replace(/\s+/g, ' ').trim()
    if (!q) return false
    for (const p of paras) {
      // The visible text, run by run: w:t (not deleted text), in order.
      const ts = Array.from(p.getElementsByTagNameNS(W, 't'))
      const text = ts.map((t) => t.textContent ?? '').join('')
      const flat = text.replace(/\s/g, ' ')
      const from = flat.indexOf(q)
      if (from < 0) continue
      const to = from + q.length
      const startRun = this.runAt(ts, from, 'start')
      const endRun = this.runAt(Array.from(p.getElementsByTagNameNS(W, 't')), to, 'end')
      if (!startRun || !endRun) return false
      // Inside a tracked change, the range goes round the whole change (it can't start mid-way).
      const outer = (r: Element) => (['ins', 'del', 'moveFrom', 'moveTo'].includes((r.parentNode as Element)?.localName ?? '') ? (r.parentNode as Element) : r)
      placeBefore(outer(startRun), start)
      placeAfter(outer(endRun), end)
      return true
    }
    return false
  }

  /**
   * The run that starts (or ends) exactly at a character offset in the paragraph's visible text,
   * splitting a run in two when the offset falls inside it.
   */
  private runAt(ts: Element[], offset: number, side: 'start' | 'end'): Element | null {
    let at = 0
    for (const t of ts) {
      const s = t.textContent ?? ''
      const run = t.parentNode as Element
      if (side === 'start' ? offset < at + s.length : offset <= at + s.length) {
        const cut = offset - at
        if (cut === 0 && side === 'start') return run
        if (cut === s.length && side === 'end') return run
        // Split: this run keeps the text before the cut, a copy after it gets the rest.
        if (run.getElementsByTagNameNS(W, 't').length !== 1) return run
        const copy = run.cloneNode(true) as Element
        t.textContent = s.slice(0, cut)
        t.setAttribute('xml:space', 'preserve')
        const t2 = copy.getElementsByTagNameNS(W, 't')[0]
        t2.textContent = s.slice(cut)
        t2.setAttribute('xml:space', 'preserve')
        placeAfter(run, copy)
        return side === 'start' ? copy : run
      }
      at += s.length
    }
    return null
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

  /** Their comments marked done (or not) here. */
  marked = 0

  /** Mark one of their comments resolved (Word's done flag), or reopen it. */
  markDone(id: number, done: boolean) {
    const pid = this.parentParaId(id)
    if (!pid) return
    const ex = Array.from(this.extended?.getElementsByTagNameNS(W15, 'commentEx') ?? []).find((e) => e.getAttributeNS(W15, 'paraId') === pid)
    if (ex) ex.setAttributeNS(W15, 'w15:done', done ? '1' : '0')
    else this.thread(pid, null, done)
    this.marked++
  }

  private thread(paraId: string, parent: string | null, done = false) {
    if (!this.extended) {
      this.extended = new DOMParser().parseFromString(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="${W15}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15"/>`,
        'text/xml'
      )
    }
    const ex = this.extended.createElementNS(W15, 'w15:commentEx')
    ex.setAttributeNS(W15, 'w15:paraId', paraId)
    if (parent) ex.setAttributeNS(W15, 'w15:paraIdParent', parent)
    ex.setAttributeNS(W15, 'w15:done', done ? '1' : '0')
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

const para = (runs: string, opts = '') => `<w:p><w:pPr>${opts}<w:spacing w:after="120"/></w:pPr>${runs}</w:p>`
const run = (t: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`

async function packageDocx(body: string[]): Promise<Buffer> {
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
