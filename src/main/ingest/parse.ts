import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import type { DocComment, SourceType, TrackedDeletion, TrackedSegment } from '@shared/types'
import { readDocx } from './docxTracked'
import { Ligatures } from './ligatures'

export interface ParsedDocument {
  name: string
  sourceType: SourceType
  sha256: string
  /** Logical lines / paragraphs in reading order. */
  lines: string[]
  /** Word only: the redline and comments for each line (same order as `lines`). */
  lineMeta?: { tracked?: TrackedSegment[]; comments?: DocComment[]; row?: boolean }[]
  /**
   * PDF only: each line's layout on the page. center: centred in the text column. bold: all in a
   * bold font. hard: the page
   * ends the paragraph there (a gap, a line broken on purpose, a centred line), so it isn't
   * rejoined to the next; only a page's last paragraph may go on onto the next page.
   */
  layout?: { center?: boolean; hard?: boolean; bold?: boolean }[]
  /** PDF only: the typeface most of the text is set in ("Calibri"). */
  font?: string
  /** Word only: whole paragraphs deleted as tracked changes. */
  deletions?: TrackedDeletion[]
}

export class UnsupportedFormatError extends Error {}

export async function parseFile(path: string): Promise<ParsedDocument> {
  const buf = await readFile(path)
  const ext = extname(path).toLowerCase()
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const name = basename(path)

  if (ext === '.pdf') return { name, sha256, sourceType: 'pdf', ...(await pdfLines(buf)) }
  if (ext === '.docx') return { name, sha256, sourceType: 'docx', ...(await docx(buf)) }
  if (ext === '.txt' || ext === '.md') return { name, sha256, sourceType: 'txt', lines: splitLines(buf.toString('utf8')) }
  if (ext === '.doc') {
    throw new UnsupportedFormatError(
      'Legacy .doc files are not supported. Open the file in Word and "Save As" .docx (or export to PDF), then load it again.'
    )
  }
  throw new UnsupportedFormatError(`Unsupported file type "${ext}". Supported: .pdf, .docx, .txt`)
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Word files are read from their XML so tracked changes and comments survive
 * (a plain-text extract silently accepts every tracked change and drops the
 * comments). Falls back to mammoth if the XML can't be read.
 */
async function docx(buf: Buffer): Promise<Pick<ParsedDocument, 'lines' | 'lineMeta' | 'deletions'>> {
  try {
    const paragraphs = await readDocx(buf)
    const lines: string[] = []
    const lineMeta: NonNullable<ParsedDocument['lineMeta']> = []
    const deletions: TrackedDeletion[] = []
    for (const p of paragraphs) {
      if (p.deleted) {
        const m = p.deleted.text.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(.*)$/)
        deletions.push({ number: m?.[1] ?? null, text: m?.[2] ?? p.deleted.text, author: p.deleted.author, date: p.deleted.date })
        continue
      }
      if (!p.text) continue
      lines.push(p.text)
      lineMeta.push({ tracked: p.segments, comments: p.comments, row: p.row })
    }
    return { lines, lineMeta, deletions }
  } catch {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ buffer: buf })
    return { lines: splitLines(value) }
  }
}

/**
 * Rebuild reading-order lines from pdf.js text items. Items on the same baseline
 * are joined; a vertical gap noticeably larger than the line height starts a new
 * paragraph, which we keep as a separate line so the clause splitter can see it.
 */
async function pdfLines(buf: Buffer): Promise<Pick<ParsedDocument, 'lines' | 'layout' | 'font'>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // fontExtraProperties: keep fonts' names ("Calibri-Bold"), to tell bold lines.
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, fontExtraProperties: true })
  const doc = await task.promise
  const out: { text: string; center: boolean; hard: boolean; bold: boolean }[] = []
  const faces = new Map<string, number>()
  // Glyphs drawn without letters (ligatures): marked here, resolved once the whole text is in.
  const ligatures = new Ligatures()
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // The fonts' names come with the page's drawing operations.
    await page.getOperatorList()
    const boldFont = new Map<string, boolean>()
    const isBold = (font: string, chars: number) => {
      let name = ''
      try {
        name = (page.commonObjs.get(font) as { name?: string } | undefined)?.name ?? ''
      } catch {
        // not loaded: not known to be bold
      }
      // The typeface ("ABCDEF+Calibri-Bold" is Calibri), counted by how much text is set in it.
      const face = name.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Oblique|Regular|Semibold|Light|Medium|Black|Heavy|Demi|BoldItalic|BoldOblique|MT|PS).*$/i, '').replace(/(PS)?MT$/, '')
      if (face) faces.set(face, (faces.get(face) ?? 0) + chars)
      if (!boldFont.has(font)) boldFont.set(font, /bold|black|heavy|semibold|demi/i.test(name))
      return boldFont.get(font)!
    }
    type Piece = { x: number; w: number; h: number; str: string; bold: boolean }
    type Row = { y: number; left: number; right: number; h: number; text: string; side?: string; pieces: Piece[] }
    const rows: Row[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [a, b, , , x, y] = item.transform as number[]
      const h = item.height || 10
      // A ligature with no letters: a marker for it, resolved once the whole text is in.
      const str = item.str.includes('\u0000') ? item.str.replace(/\u0000/g, ligatures.mark(item.fontName, item.width / (Math.hypot(a, b) || 1) / item.str.length)) : item.str
      // The same line: its baseline, give or take a superscript ("4th").
      const row = rows.find((r) => Math.abs(r.y - y) < Math.max(h, r.h) * 0.45)
      const piece = { x, w: item.width, h, str, bold: isBold(item.fontName, str.length) }
      if (row) {
        row.pieces.push(piece)
        row.h = Math.max(row.h, h)
      } else rows.push({ y, left: x, right: x + item.width, h, text: '', pieces: [piece] })
    }
    // Each line's text, left to right: a space only where the page leaves one, so pieces of a word
    // (a ligature, a superscript) join up. A short heading in the left margin, level with its
    // paragraph's first line ("Duties   The title of…"), is kept apart as a heading of its own.
    for (const row of rows) {
      row.pieces.sort((a, b) => a.x - b.x)
      let end = -Infinity
      for (const p of row.pieces) {
        const gap = p.x - end
        // (Not a label ending in a colon: "Commencement Date:   1st July 2026" stays on one line.)
        if (!row.side && row.text && gap > row.h * 3 && row.text.trim().length <= 40 && /^[A-Z(]/.test(row.text.trim()) && !/[.;,:]$/.test(row.text.trim())) {
          row.side = row.text.trim()
          row.text = ''
        }
        const space = row.text && gap > row.h * 0.12 && !/\s$/.test(row.text) && !/^\s/.test(p.str)
        row.text += (space ? ' ' : '') + p.str
        end = Math.max(end, p.x + p.w)
      }
      const body = row.side ? row.pieces.filter((p) => p.x > row.pieces[0].x) : row.pieces
      row.left = Math.min(...body.map((p) => p.x))
      row.right = Math.max(...row.pieces.map((p) => p.x + p.w))
    }
    rows.sort((a, b) => b.y - a.y)
    // The text column on this page: where its lines start and end.
    const colLeft = Math.min(...rows.map((r) => r.left))
    const colRight = Math.max(...rows.map((r) => r.right))
    const width = colRight - colLeft || 1
    // A line as wide on the left of it as on the right, and one clearly in from the left margin.
    const even = (r: Row) => Math.abs(r.left - colLeft - (colRight - r.right)) < width * 0.03
    const indented = (r: Row) => r.left > colLeft + width * 0.025
    // Ends well short of the right margin: the line was broken on purpose (an address, a title).
    const short = (r: Row) => r.right < colRight - width * 0.2
    let para = ''
    let paraRows: Row[] = []
    let paraBold = true
    let last: Row | null = null
    const end = (hard: boolean) => {
      // Centred: every line evenly placed, not all full width (justified text is even too), and the
      // lines not all starting at one place (an indented list item's lines do).
      const starts = paraRows.slice(paraRows.length > 2 ? 1 : 0).map((r) => r.left)
      const aligned = paraRows.length > 1 && Math.max(...starts) - Math.min(...starts) < 2
      const center = paraRows.length > 0 && paraRows.every(even) && paraRows.some(indented) && !aligned
      if (para.trim()) out.push({ text: para.trim(), center, hard, bold: paraBold })
      para = ''
      paraRows = []
      paraBold = true
    }
    for (const r of rows) {
      const gap = last ? last.y - r.y : 0
      if (last) {
        // A new paragraph after a gap, or after a line broken on purpose. Both are where the page
        // ends them; only a page's last paragraph may go on onto the next page.
        if (gap > last.h * 1.8 || short(last)) end(true)
      }
      if (r.side) {
        end(true)
        out.push({ text: r.side, center: false, hard: true, bold: r.pieces[0].bold })
      }
      paraRows.push(r)
      paraBold &&= (r.side ? r.pieces.filter((p) => p.x > r.pieces[0].x) : r.pieces).every((p) => p.bold)
      para += (para ? ' ' : '') + r.text.replace(/\s+/g, ' ').trim()
      last = r
    }
    end(false)
  }
  await task.destroy()
  const lines = ligatures.repair(out.map((x) => x.text))
  const font = [...faces].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { lines, layout: out.map((x) => ({ center: x.center || undefined, hard: x.hard || undefined, bold: x.bold || undefined })), font }
}
