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
  /** Word only: whole paragraphs deleted as tracked changes. */
  deletions?: TrackedDeletion[]
}

export class UnsupportedFormatError extends Error {}

export async function parseFile(path: string): Promise<ParsedDocument> {
  const buf = await readFile(path)
  const ext = extname(path).toLowerCase()
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const name = basename(path)

  if (ext === '.pdf') return { name, sha256, sourceType: 'pdf', lines: await pdfLines(buf) }
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
async function pdfLines(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true })
  const doc = await task.promise
  const out: string[] = []
  // Glyphs drawn without letters (ligatures): marked here, resolved once the whole text is in.
  const ligatures = new Ligatures()
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    type Row = { y: number; x: number; h: number; text: string; glued: boolean }
    const rows: Row[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [a, b, , , x, y] = item.transform as number[]
      const h = item.height || 10
      // A ligature with no letters: its marker joins the words either side of it (no space).
      const unmapped = item.str.includes('\u0000')
      const str = unmapped ? item.str.replace(/\u0000/g, ligatures.mark(item.fontName, item.width / (Math.hypot(a, b) || 1) / item.str.length)) : item.str
      const row = rows.find((r) => Math.abs(r.y - y) < h * 0.4)
      if (row) {
        row.text += (x > row.x && !unmapped && !row.glued ? ' ' : '') + str
        row.glued = unmapped
      } else rows.push({ y, x, h, text: str, glued: unmapped })
    }
    rows.sort((a, b) => b.y - a.y)
    let para = ''
    let lastY: number | null = null
    let lastH = 10
    for (const r of rows) {
      const gap = lastY === null ? 0 : lastY - r.y
      if (lastY !== null && gap > lastH * 1.8) {
        if (para) out.push(para.trim())
        para = ''
      }
      para += (para ? ' ' : '') + r.text.replace(/\s+/g, ' ').trim()
      lastY = r.y
      lastH = r.h
    }
    if (para) out.push(para.trim())
  }
  await task.destroy()
  return ligatures.repair(out.filter(Boolean))
}
