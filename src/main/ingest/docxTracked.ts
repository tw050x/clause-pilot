import JSZip from 'jszip'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { DocComment, TrackedSegment } from '@shared/types'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'

export interface DocxParagraph {
  /** The paragraph as proposed: insertions in, deletions out. */
  text: string
  /** Present when the paragraph contains tracked changes. */
  segments?: TrackedSegment[]
  comments?: DocComment[]
  /** The whole paragraph was deleted as a tracked change. */
  deleted?: { text: string; author?: string; date?: string }
  /** A table row of key terms (cells joined with " — "): a clause of its own. */
  row?: boolean
  /** Word's automatic number, when it has one (also at the start of `text`). */
  label?: string
  /** Where it is in the file: indexes into the document's paragraphs, in order. */
  paras?: number[]
  heading?: boolean
  center?: boolean
  bold?: boolean
  level?: number
}

/**
 * Reads a .docx straight from its XML so that Word's Track Changes and
 * comments survive: each paragraph comes back with its proposed text, its
 * redline (who inserted or deleted what, and when) and the comments anchored
 * on it. Paragraphs are returned in document order, including table cells.
 */
export async function readDocx(buf: Buffer): Promise<DocxParagraph[]> {
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('Not a Word document (word/document.xml missing).')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const comments = await readComments(zip)
  const numbering = await readNumbering(zip)

  const order = new Map(Array.from(doc.getElementsByTagNameNS(W, 'p')).map((p, i) => [p, i]))
  // Comment ranges open at the moment, in document order: a range can span paragraphs.
  const open = new Set<string>()
  const styleIds = await headingStyles(zip)
  // One paragraph: its proposed text, redline and comments (null when there's nothing in it).
  const read = (p: Element): DocxParagraph | null => {
    const segments: TrackedSegment[] = []
    const anchored = new Set<string>()
    const covered = new Map<string, { shown: string; all: string }>()
    walk(p, null, segments, { anchored, open, covered })
    const merged = merge(segments)
    // Each comment with the text it covers here (what's proposed; what was deleted, if that's all there is).
    const commentList = [...anchored]
      .map((id) => {
        const c = comments.get(id)
        if (!c) return null
        const t = covered.get(id)
        const quote = clean(t?.shown ?? '') || clean(t?.all ?? '')
        return quote ? { ...c, quote } : c
      })
      .filter((c): c is DocComment => !!c)
    // Word's automatic numbering ("1.", "4.2", "(a)") isn't in the text: work it out and put it back in front.
    // No number for deleted paragraphs or empty ones (often just a section break).
    const label = numbering.label(p, merged.every((s) => s.op === 'del' || !s.text.trim()))
    if (label) merged.unshift({ op: merged[0]?.op === 'ins' ? 'ins' : merged[0]?.op === 'del' ? 'del' : 'same', text: `${label} `, author: merged[0]?.author, date: merged[0]?.date })
    const text = clean(merged.filter((s) => s.op !== 'del').map((s) => s.text).join(''))
    const removedText = clean(merged.filter((s) => s.op !== 'ins').map((s) => s.text).join(''))
    const hasChanges = merged.some((s) => s.op !== 'same')

    // A paragraph whose content is all tracked deletion (and nothing proposed) was deleted outright.
    if (!text && removedText && merged.every((s) => s.op === 'del' || !s.text.trim())) {
      const by = merged.find((s) => s.op === 'del')
      return { text: '', deleted: { text: removedText, author: by?.author, date: by?.date }, comments: commentList.length ? commentList : undefined, paras: [order.get(p)!], label: label || undefined }
    }
    if (!text && !commentList.length) return null
    return { text, segments: hasChanges ? trimSegments(merged) : undefined, comments: commentList.length ? commentList : undefined, label: label || undefined, paras: [order.get(p)!], ...looks(p, styleIds) }
  }

  const out: DocxParagraph[] = []
  const push = (x: DocxParagraph | null) => x && out.push(x)
  // Walk the body in order: paragraphs (and any text boxes inside them), tables row by row,
  // and through content controls and other wrappers.
  const visit = (node: Element) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      const el = n as Element
      if (el.nodeType !== 1 || el.namespaceURI !== W) continue
      if (el.localName === 'p') {
        push(read(el))
        for (const inner of Array.from(el.getElementsByTagNameNS(W, 'p'))) push(read(inner))
      } else if (el.localName === 'tbl') {
        for (const tr of Array.from(el.childNodes).filter((x) => (x as Element).localName === 'tr') as Element[]) row(tr)
      } else if (el.localName !== 'sectPr') visit(el)
    }
  }
  /**
   * A key-terms row ("Governing Law | The laws of the State of …") becomes one line, cells joined
   * with " — ", so each term is reviewed as its own clause. Rows holding numbered clauses, or long
   * text (tables used for layout), stay as separate paragraphs.
   */
  const row = (tr: Element) => {
    const cells = (Array.from(tr.childNodes).filter((x) => (x as Element).localName === 'tc') as Element[]).map((tc) =>
      Array.from(tc.getElementsByTagNameNS(W, 'p')).map(read).filter((x): x is DocxParagraph => !!x)
    )
    const all = cells.flat()
    const filled = cells.filter((c) => c.some((x) => x.text))
    const length = all.reduce((n, x) => n + x.text.length, 0)
    if (filled.length < 2 || length > 600 || all.some((x) => x.deleted || /^\d{1,2}(\.\d{1,2})+\.?\s|^\d{1,2}\.\s/.test(x.text))) {
      all.forEach(push)
      return
    }
    const segments: TrackedSegment[] = []
    filled.forEach((cell, ci) => {
      if (ci) segments.push({ op: 'same', text: ' — ' })
      cell.filter((x) => x.text).forEach((x, pi) => {
        if (pi) segments.push({ op: 'same', text: ' ' })
        segments.push(...(x.segments ?? [{ op: 'same' as const, text: x.text }]))
      })
    })
    // A comment spanning cells is anchored in more than one of them: list it once.
    const comments = [...new Map(all.flatMap((x) => x.comments ?? []).map((c) => [c.id, c])).values()]
    out.push({
      text: filled.map((c) => c.map((x) => x.text).filter(Boolean).join(' ')).join(' — '),
      segments: all.some((x) => x.segments) ? segments : undefined,
      comments: comments.length ? comments : undefined,
      row: true,
      paras: all.flatMap((x) => x.paras ?? [])
    })
  }
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  if (body) visit(body)
  return out
}

/** Paragraph styles that are headings (by name or outline level), following basedOn. */
async function headingStyles(zip: JSZip): Promise<Set<string>> {
  const xml = await zip.file('word/styles.xml')?.async('string')
  const out = new Set<string>()
  if (!xml) return out
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const based = new Map<string, string>()
  for (const st of Array.from(doc.getElementsByTagNameNS(W, 'style'))) {
    const id = st.getAttributeNS(W, 'styleId') ?? ''
    const name = val(st, 'name') ?? ''
    if (/^(heading|title|subtitle)/i.test(name) || /^(heading|title)/i.test(id) || st.getElementsByTagNameNS(W, 'outlineLvl').length) out.add(id)
    const b = val(st, 'basedOn')
    if (b) based.set(id, b)
  }
  for (const [id, b] of based) if (out.has(b)) out.add(id)
  return out
}

/** How a paragraph looks, roughly: enough to lay the page out like the original. */
function looks(p: Element, headings: Set<string>): Pick<DocxParagraph, 'heading' | 'center' | 'bold' | 'level'> {
  const pPr = Array.from(p.childNodes).find((n) => (n as Element).localName === 'pPr') as Element | undefined
  const style = pPr ? val(pPr, 'pStyle') : null
  const jc = pPr ? val(pPr, 'jc') : null
  const ilvl = pPr ? val(pPr, 'ilvl') : null
  const runs = Array.from(p.getElementsByTagNameNS(W, 'r')).filter((r) => r.getElementsByTagNameNS(W, 't').length)
  const isBold = (r: Element) => {
    const b = r.getElementsByTagNameNS(W, 'b')[0]
    return !!b && !['0', 'false'].includes(b.getAttributeNS(W, 'val') ?? '')
  }
  return {
    heading: !!style && headings.has(style),
    center: jc === 'center',
    bold: runs.length > 0 && runs.every(isBold),
    level: ilvl !== null ? Number(ilvl) : undefined
  }
}

type Track = { op: 'ins' | 'del'; author?: string; date?: string } | null

interface CommentState {
  /** Comments anchored in this paragraph. */
  anchored: Set<string>
  /** Comment ranges open at this point in the document. */
  open: Set<string>
  /** The text each comment covers in this paragraph: as proposed, and including deletions. */
  covered: Map<string, { shown: string; all: string }>
}

function walk(node: Element, track: Track, out: TrackedSegment[], cs: CommentState) {
  const text = (t: string) => {
    out.push({ op: track?.op ?? 'same', text: t, author: track?.author, date: track?.date })
    for (const id of cs.open) {
      const c = cs.covered.get(id) ?? { shown: '', all: '' }
      c.all += t
      if (track?.op !== 'del') c.shown += t
      cs.covered.set(id, c)
      cs.anchored.add(id)
    }
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const el = child as Element
    if (el.namespaceURI !== W) continue
    switch (el.localName) {
      case 'ins':
      case 'del':
        // The paragraph-mark markers live in w:rPr and carry no text; skip their contents there.
        walk(el, { op: el.localName, author: el.getAttributeNS(W, 'author') || undefined, date: el.getAttributeNS(W, 'date') || undefined }, out, cs)
        break
      case 't':
      case 'delText':
        text(el.textContent ?? '')
        break
      case 'tab':
        text(' ')
        break
      case 'commentRangeStart':
        cs.open.add(el.getAttributeNS(W, 'id') ?? '')
        cs.anchored.add(el.getAttributeNS(W, 'id') ?? '')
        break
      case 'commentRangeEnd':
        cs.open.delete(el.getAttributeNS(W, 'id') ?? '')
        break
      case 'commentReference':
        cs.anchored.add(el.getAttributeNS(W, 'id') ?? '')
        break
      case 'pPr':
      case 'rPr':
      case 'p': // nested paragraphs (text boxes) are visited as their own paragraphs
        break
      default:
        walk(el, track, out, cs)
    }
  }
}

// ---- automatic numbering ------------------------------------------------------------------

interface Level {
  start: number
  fmt: string
  text: string
  legal: boolean
}

/**
 * Word list numbering: each numbered paragraph points at a list (numId) and a
 * level; numbering.xml says how that level is counted and printed ("%1.%2").
 * Numbering can also come from the paragraph's style (common for headings).
 * Counting follows Word: a level counts up, deeper levels restart under it.
 */
export async function readNumbering(zip: JSZip) {
  const xml = await zip.file('word/numbering.xml')?.async('string')
  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const abstract = new Map<string, Map<number, Level>>()
  const nums = new Map<string, { abstractId: string; starts: Map<number, number> }>()
  if (xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    for (const a of Array.from(doc.getElementsByTagNameNS(W, 'abstractNum'))) {
      const levels = new Map<number, Level>()
      for (const l of Array.from(a.getElementsByTagNameNS(W, 'lvl'))) {
        levels.set(Number(l.getAttributeNS(W, 'ilvl')), {
          start: Number(val(l, 'start') ?? 1),
          fmt: val(l, 'numFmt') ?? 'decimal',
          text: val(l, 'lvlText') ?? '',
          legal: l.getElementsByTagNameNS(W, 'isLgl').length > 0
        })
      }
      abstract.set(a.getAttributeNS(W, 'abstractNumId') ?? '', levels)
    }
    for (const n of Array.from(doc.getElementsByTagNameNS(W, 'num'))) {
      const starts = new Map<number, number>()
      for (const o of Array.from(n.getElementsByTagNameNS(W, 'lvlOverride'))) {
        const so = val(o, 'startOverride')
        if (so !== null) starts.set(Number(o.getAttributeNS(W, 'ilvl')), Number(so))
      }
      nums.set(n.getAttributeNS(W, 'numId') ?? '', { abstractId: val(n, 'abstractNumId') ?? '', starts })
    }
  }

  // Paragraph styles that carry numbering, following basedOn.
  const styles = new Map<string, { numId?: string; ilvl?: number; basedOn?: string }>()
  if (stylesXml) {
    const doc = new DOMParser().parseFromString(stylesXml, 'text/xml')
    for (const st of Array.from(doc.getElementsByTagNameNS(W, 'style'))) {
      const numPr = st.getElementsByTagNameNS(W, 'numPr')[0]
      styles.set(st.getAttributeNS(W, 'styleId') ?? '', {
        numId: numPr ? val(numPr, 'numId') ?? undefined : undefined,
        ilvl: numPr && val(numPr, 'ilvl') !== null ? Number(val(numPr, 'ilvl')) : undefined,
        basedOn: val(st, 'basedOn') ?? undefined
      })
    }
  }
  const fromStyle = (id: string | null) => {
    const out: { numId?: string; ilvl?: number } = {}
    for (let i = 0, cur = id; cur && i < 10; i++) {
      const st = styles.get(cur)
      if (!st) break
      out.numId ??= st.numId
      out.ilvl ??= st.ilvl
      cur = st.basedOn ?? null
    }
    return out
  }

  // Counters per list. Lists sharing an abstract definition continue each other unless restarted.
  const counters = new Map<string, number[]>()
  return {
    label(p: Element, skip: boolean): string {
      const pPr = Array.from(p.childNodes).find((n) => (n as Element).localName === 'pPr') as Element | undefined
      if (!pPr) return ''
      const numPr = Array.from(pPr.childNodes).find((n) => (n as Element).localName === 'numPr') as Element | undefined
      const style = fromStyle(Array.from(pPr.childNodes).find((n) => (n as Element).localName === 'pStyle') ? val(pPr, 'pStyle') : null)
      const numId = (numPr && val(numPr, 'numId')) ?? style.numId
      const ilvl = Number((numPr && val(numPr, 'ilvl')) ?? style.ilvl ?? 0)
      if (!numId || numId === '0' || skip) return ''
      const num = nums.get(numId)
      const levels = num && abstract.get(num.abstractId)
      const level = levels?.get(ilvl)
      if (!num || !levels || !level || level.fmt === 'bullet' || level.fmt === 'none') return ''
      const key = num.starts.size ? `n${numId}` : `a${num.abstractId}`
      const startOf = (l: number) => num.starts.get(l) ?? levels.get(l)?.start ?? 1
      const c = counters.get(key) ?? []
      for (let l = 0; l < ilvl; l++) c[l] ??= startOf(l)
      c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl] + 1
      c.length = ilvl + 1 // deeper levels restart
      counters.set(key, c)
      return level.text.replace(/%(\d)/g, (_, d) => {
        const l = Number(d) - 1
        const fmt = level.legal ? 'decimal' : levels.get(l)?.fmt ?? 'decimal'
        return format(c[l] ?? startOf(l), fmt)
      }).trim()
    }
  }
}

const val = (el: Element, child: string): string | null => {
  const c = el.getElementsByTagNameNS(W, child)[0]
  return c ? c.getAttributeNS(W, 'val') : null
}

function format(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
    case 'upperLetter': {
      const ch = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1)
      return fmt === 'upperLetter' ? ch.toUpperCase() : ch
    }
    case 'lowerRoman':
    case 'upperRoman': {
      const r = roman(n)
      return fmt === 'upperRoman' ? r : r.toLowerCase()
    }
    case 'decimalZero':
      return String(n).padStart(2, '0')
    default:
      return String(n)
  }
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

async function readComments(zip: JSZip): Promise<Map<string, DocComment>> {
  const map = new Map<string, DocComment>()
  const xml = await zip.file('word/comments.xml')?.async('string')
  if (!xml) return map
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  // Resolved ("done") comments are flagged in commentsExtended.xml, keyed by the paraId of the
  // comment's last paragraph.
  const done = new Set<string>()
  const ex = await zip.file('word/commentsExtended.xml')?.async('string')
  if (ex)
    for (const e of Array.from(new DOMParser().parseFromString(ex, 'text/xml').getElementsByTagNameNS(W15, 'commentEx')))
      if (e.getAttributeNS(W15, 'done') === '1') done.add(e.getAttributeNS(W15, 'paraId') ?? '')
  for (const c of Array.from(doc.getElementsByTagNameNS(W, 'comment'))) {
    const id = c.getAttributeNS(W, 'id') ?? ''
    const ps = Array.from(c.getElementsByTagNameNS(W, 'p'))
    const text = ps
      .map((p) => Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join(''))
      .join('\n')
      .trim()
    const paraId = ps[ps.length - 1]?.getAttributeNS(W14, 'paraId') ?? ''
    map.set(id, { id, author: c.getAttributeNS(W, 'author') || 'Unknown', date: c.getAttributeNS(W, 'date') || undefined, text, ...(paraId && done.has(paraId) ? { done: true } : {}) })
  }
  return map
}

/** Join neighbouring runs with the same change (Word splits text into many runs). */
function merge(segs: TrackedSegment[]): TrackedSegment[] {
  const out: TrackedSegment[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.op === s.op && last.author === s.author) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

function trimSegments(segs: TrackedSegment[]): TrackedSegment[] {
  const out = segs.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ') })).filter((s) => s.text)
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  }
  return out.filter((s) => s.text)
}
