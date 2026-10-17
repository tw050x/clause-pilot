/**
 * Builds the test pack (test-pack/), for testing the app as a user would, with real AI:
 *   library.json, playbook.json   our approved clauses and standard positions, in the app's
 *                                 export format (import them on the Library and Playbook pages)
 *   test-1/*.docx                 our NDA as a client redlined it, then their next draft
 *   test-2/*.docx                 a client's own confidentiality agreement
 *
 * Run: npm run test-pack
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, InsertedTextRun, DeletedTextRun, CommentRangeStart, CommentRangeEnd, CommentReference } from 'docx'
import { diffSegments } from '../../src/shared/diff'
import { libraryFile, playbookFile } from '../../src/main/transfer'
import { LIBRARY } from './library'
import { PLAYBOOK } from './playbook'
import { BRIGHTWATER_V1, BRIGHTWATER_V2, KESTREL, type Block, type ContractFile } from './contracts'

const root = join(process.cwd(), 'test-pack')
for (const d of ['', 'test-1', 'test-2']) mkdirSync(join(root, d), { recursive: true })

const by = 'PortSwigger Legal'
writeFileSync(join(root, 'library.json'), JSON.stringify({ ...libraryFile(LIBRARY, by), exportedAt: '2026-10-01T09:00:00.000Z' }, null, 2) + '\n')
writeFileSync(join(root, 'playbook.json'), JSON.stringify({ ...playbookFile(PLAYBOOK, by), exportedAt: '2026-10-01T09:00:00.000Z' }, null, 2) + '\n')
console.log(`library.json: ${LIBRARY.length} clauses; playbook.json: ${PLAYBOOK.length} positions`)

type Run = TextRun | InsertedTextRun | DeletedTextRun

/**
 * A Word file as a negotiated draft really arrives: their edits as Track Changes (w:ins / w:del
 * in the client's name) and their margin comments. The number is typed at the start of the
 * paragraph, in bold.
 */
async function writeDocx(c: ContractFile, path: string) {
  let changeId = 100
  const who = { author: c.author, date: c.date }
  const comments: { id: number; author: string; date: Date; children: Paragraph[] }[] = []
  const ins = (text: string, bold = false) => new InsertedTextRun({ text, bold, id: changeId++, ...who })
  const del = (text: string, bold = false) => new DeletedTextRun({ text, bold, id: changeId++, ...who })

  const runs = (b: Extract<Block, { kind: 'para' }>): Run[] => {
    const num = b.number ? `${b.number} ` : ''
    if (b.tracked?.inserted) return [...(num ? [ins(num, true)] : []), ins(b.text)]
    if (b.tracked?.deleted) return [...(num ? [del(num, true)] : []), del(b.text)]
    const out: Run[] = num ? [new TextRun({ text: num, bold: true })] : []
    if (!b.tracked?.base) return [...out, new TextRun(b.text)]
    for (const t of diffSegments(b.tracked.base, b.text)) out.push(t.op === 'same' ? new TextRun(t.text) : t.op === 'ins' ? ins(t.text) : del(t.text))
    return out
  }

  const children = c.blocks.map((b) => {
    if (b.kind === 'title') return new Paragraph({ children: [new TextRun({ text: b.text, bold: true, size: 28 })], alignment: AlignmentType.CENTER, spacing: { after: 240 } })
    if (b.kind === 'heading')
      return new Paragraph({ children: [b.inserted ? ins(b.text, true) : new TextRun({ text: b.text, bold: true })], heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
    const r = runs(b)
    if (!b.comment) return new Paragraph({ children: r, spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED })
    const id = comments.length
    comments.push({ id, author: c.author, date: new Date(c.date), children: [new Paragraph({ children: [new TextRun(b.comment)] })] })
    return new Paragraph({
      children: [new CommentRangeStart(id), ...r, new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })],
      spacing: { after: 120 },
      alignment: AlignmentType.JUSTIFIED
    })
  })
  const doc = new Document({
    creator: c.author,
    comments: { children: comments },
    sections: [{ children }],
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }
  })
  writeFileSync(path, await Packer.toBuffer(doc))
}

async function main() {
  await writeDocx(BRIGHTWATER_V1, join(root, 'test-1', BRIGHTWATER_V1.file))
  await writeDocx(BRIGHTWATER_V2, join(root, 'test-1', BRIGHTWATER_V2.file))
  await writeDocx(KESTREL, join(root, 'test-2', KESTREL.file))
  console.log(`test-1: ${BRIGHTWATER_V1.file}, ${BRIGHTWATER_V2.file}; test-2: ${KESTREL.file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
