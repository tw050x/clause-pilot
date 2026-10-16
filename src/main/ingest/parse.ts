import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import type { SourceType } from '@shared/types'

export interface ParsedDocument {
  name: string
  sourceType: SourceType
  sha256: string
  /** Logical lines / paragraphs in reading order. */
  lines: string[]
}

export class UnsupportedFormatError extends Error {}

export async function parseFile(path: string): Promise<ParsedDocument> {
  const buf = await readFile(path)
  const ext = extname(path).toLowerCase()
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const name = basename(path)

  if (ext === '.pdf') return { name, sha256, sourceType: 'pdf', lines: await pdfLines(buf) }
  if (ext === '.docx') return { name, sha256, sourceType: 'docx', lines: await docxLines(buf) }
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

async function docxLines(buf: Buffer): Promise<string[]> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer: buf })
  return splitLines(value)
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
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    type Row = { y: number; x: number; h: number; text: string }
    const rows: Row[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [, , , , x, y] = item.transform as number[]
      const h = item.height || 10
      const row = rows.find((r) => Math.abs(r.y - y) < h * 0.4)
      if (row) {
        row.text += (x > row.x ? ' ' : '') + item.str
      } else rows.push({ y, x, h, text: item.str })
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
  return out.filter(Boolean)
}
