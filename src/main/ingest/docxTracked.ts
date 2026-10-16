import JSZip from 'jszip'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { DocComment, TrackedSegment } from '@shared/types'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface DocxParagraph {
  /** The paragraph as proposed: insertions in, deletions out. */
  text: string
  /** Present when the paragraph contains tracked changes. */
  segments?: TrackedSegment[]
  comments?: DocComment[]
  /** The whole paragraph was deleted as a tracked change. */
  deleted?: { text: string; author?: string; date?: string }
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

  const out: DocxParagraph[] = []
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, 'p'))
  for (const p of paragraphs) {
    const segments: TrackedSegment[] = []
    const anchored = new Set<string>()
    walk(p, null, segments, anchored)
    const merged = merge(segments)
    const text = clean(merged.filter((s) => s.op !== 'del').map((s) => s.text).join(''))
    const removedText = clean(merged.filter((s) => s.op !== 'ins').map((s) => s.text).join(''))
    const hasChanges = merged.some((s) => s.op !== 'same')
    const commentList = [...anchored].map((id) => comments.get(id)).filter((c): c is DocComment => !!c)

    // A paragraph whose content is all tracked deletion (and nothing proposed) was deleted outright.
    if (!text && removedText && merged.every((s) => s.op === 'del' || !s.text.trim())) {
      const by = merged.find((s) => s.op === 'del')
      out.push({ text: '', deleted: { text: removedText, author: by?.author, date: by?.date }, comments: commentList.length ? commentList : undefined })
      continue
    }
    if (!text && !commentList.length) continue
    out.push({ text, segments: hasChanges ? trimSegments(merged) : undefined, comments: commentList.length ? commentList : undefined })
  }
  return out
}

type Track = { op: 'ins' | 'del'; author?: string; date?: string } | null

function walk(node: Element, track: Track, out: TrackedSegment[], anchored: Set<string>) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const el = child as Element
    if (el.namespaceURI !== W) continue
    switch (el.localName) {
      case 'ins':
      case 'del':
        // The paragraph-mark markers live in w:rPr and carry no text; skip their contents there.
        walk(el, { op: el.localName, author: el.getAttributeNS(W, 'author') || undefined, date: el.getAttributeNS(W, 'date') || undefined }, out, anchored)
        break
      case 't':
      case 'delText':
        out.push({ op: track?.op ?? 'same', text: el.textContent ?? '', author: track?.author, date: track?.date })
        break
      case 'tab':
        out.push({ op: track?.op ?? 'same', text: ' ', author: track?.author, date: track?.date })
        break
      case 'commentRangeStart':
      case 'commentReference':
        anchored.add(el.getAttributeNS(W, 'id') ?? '')
        break
      case 'pPr':
      case 'rPr':
      case 'p': // nested paragraphs (text boxes) are visited as their own paragraphs
        break
      default:
        walk(el, track, out, anchored)
    }
  }
}

async function readComments(zip: JSZip): Promise<Map<string, DocComment>> {
  const map = new Map<string, DocComment>()
  const xml = await zip.file('word/comments.xml')?.async('string')
  if (!xml) return map
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  for (const c of Array.from(doc.getElementsByTagNameNS(W, 'comment'))) {
    const id = c.getAttributeNS(W, 'id') ?? ''
    const text = Array.from(c.getElementsByTagNameNS(W, 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join(''))
      .join('\n')
      .trim()
    map.set(id, { id, author: c.getAttributeNS(W, 'author') || 'Unknown', date: c.getAttributeNS(W, 'date') || undefined, text })
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
