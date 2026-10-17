import { readFile } from 'node:fs/promises'
import type { DocBlock, TrackedSegment } from '@shared/types'
import { readDocx } from './docxTracked'
import { parseFile } from './parse'
import { isHeading, isSectionTitle } from './headings'

// A printed clause number typed into the text: "4", "4.", "4.2", "4.2.1".
// A typed number at the start of a paragraph: "2.1", "3.", or with a word in front, as some
// firms draft ("Section 1.01", "Clause 4").
const TYPED_NUMBER = /^((?:(?:Section|Clause|Article)\s+)?\d{1,2}(?:\.\d{1,2}){0,3}\.?)\s+/

/**
 * The contract as blocks: one per paragraph (or key-terms table row), in
 * reading order, with their redline and comments. Nothing is split into
 * clauses; the printed number is kept apart only so it's never edited.
 */
export async function readBlocks(path: string, sourceType: 'pdf' | 'docx' | 'txt'): Promise<DocBlock[]> {
  if (sourceType === 'docx') {
    try {
      return fromDocx(await readFile(path))
    } catch {
      // fall through to the plain-text reading
    }
  }
  const doc = await parseFile(path)
  return joinBrokenLines(doc.lines).map((line, i) => {
    const { label, text } = splitLabel(line)
    return { id: `b${i}`, kind: headingLike(label, text) ? 'heading' : 'para', label, text }
  })
}

async function fromDocx(buf: Buffer): Promise<DocBlock[]> {
  const out: DocBlock[] = []
  for (const p of await readDocx(buf)) {
    const id = `b${out.length}`
    if (p.deleted) {
      const { label, text } = splitLabel(p.deleted.text)
      out.push({ id, kind: 'deleted', label, text, segments: [{ op: 'del', text, author: p.deleted.author, date: p.deleted.date }], comments: p.comments, paras: p.paras })
      continue
    }
    // Word's own number, or one typed at the start.
    const label = p.label ?? p.text.match(TYPED_NUMBER)?.[1]
    const cut = label ? p.text.indexOf(label) + label.length : 0
    const text = p.text.slice(cut).trim()
    const segments = p.segments && label ? dropPrefix(p.segments, label) : p.segments
    out.push({
      id,
      // Heading styles are often used for numbered body text, so a styled heading must also look like one.
      kind: p.row ? 'row' : headingLike(label, text) || (p.heading && text.split(/\s+/).length <= 10 && !/[.;:]$/.test(text)) ? 'heading' : 'para',
      label,
      text,
      segments,
      comments: p.comments,
      paras: p.paras,
      center: p.center || undefined,
      bold: p.bold || undefined,
      level: p.level
    })
  }
  return out
}

function splitLabel(line: string): { label?: string; text: string } {
  const m = line.match(TYPED_NUMBER)
  return m ? { label: m[1], text: line.slice(m[0].length).trim() } : { text: line.trim() }
}

const headingLike = (label: string | undefined, text: string) =>
  text.length > 0 && (isHeading(text) || (!!label && /^\d+\.?$/.test(label) && isSectionTitle(label.replace(/\.$/, ''), text)))

/** Take the printed number (and the space after it) off the front of a redline. */
function dropPrefix(segments: TrackedSegment[], label: string): TrackedSegment[] {
  let skip = label.length
  const out: TrackedSegment[] = []
  for (const s of segments) {
    if (skip > 0 && s.op !== 'del') {
      const lead = s.text.length - s.text.trimStart().length
      const take = Math.min(s.text.length, lead + skip)
      skip -= take - lead
      const rest = s.text.slice(take).replace(/^\s+/, '')
      if (rest) out.push({ ...s, text: rest })
      continue
    }
    out.push(s)
  }
  return out
}

/**
 * PDF text breaks paragraphs at page ends. A line that doesn't start a numbered
 * clause or heading, following one that doesn't end a sentence, continues it.
 */
function joinBrokenLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    const continues = prev !== undefined && !/[.;:!?)"”']$/.test(prev.trim()) && !TYPED_NUMBER.test(line) && !isHeading(line) && !isHeading(prev)
    if (continues) out[out.length - 1] = `${prev.trimEnd()} ${line.trimStart()}`
    else out.push(line)
  }
  return out
}
