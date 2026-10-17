/**
 * Builds the sample files used for trying the app by hand:
 *   1. data/seed/*.json   - a sample library, playbook and precedents (data/seed is not loaded by
 *                           the app; it's sample knowledge for scripts and for adding by hand)
 *   2. demo/contracts/*   - sample contracts as .txt / .docx / .pdf, including Word drafts with
 *                           tracked changes and comments, and later drafts of the same contract
 *
 * Run: npm run samples:build
 */
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, InsertedTextRun, DeletedTextRun, CommentRangeStart, CommentRangeEnd, CommentReference } from 'docx'
import { wordDiff } from '../src/main/engine/text'
import PDFDocument from 'pdfkit'
import { LIBRARY } from './seed-library'
import { PLAYBOOK, PRECEDENTS } from './seed-playbook'
import { DEMO_ACCOUNTS, DEMO_CONTRACT_RECORDS, DEMO_CONTRACTS, type DemoContractDef, type Block } from './demo-contracts'

const root = process.cwd()
const seedDir = join(root, 'data/seed')
const contractsDir = join(root, 'demo/contracts')
for (const d of [seedDir, contractsDir]) mkdirSync(d, { recursive: true })

// ---- 1. seed data ---------------------------------------------------------------
writeFileSync(join(seedDir, 'library.json'), JSON.stringify(LIBRARY, null, 2))
writeFileSync(join(seedDir, 'playbook.json'), JSON.stringify(PLAYBOOK, null, 2))
writeFileSync(join(seedDir, 'precedents.json'), JSON.stringify(PRECEDENTS, null, 2))
writeFileSync(join(seedDir, 'accounts.json'), JSON.stringify(DEMO_ACCOUNTS, null, 2))
writeFileSync(join(seedDir, 'contracts.json'), JSON.stringify(DEMO_CONTRACT_RECORDS, null, 2))
console.log(`seed: ${LIBRARY.length} library clauses, ${PLAYBOOK.length} positions, ${PRECEDENTS.length} precedents`)

// ---- 2. contract files ---------------------------------------------------------------
const lineFor = (b: Block): string =>
  b.kind === 'heading' ? `${b.number ? b.number + '. ' : ''}${b.text}` : b.kind === 'clause' ? `${b.number} ${b.text}` : b.text

function writeTxt(def: DemoContractDef, path: string) {
  writeFileSync(path, def.blocks.filter((b) => !(b.kind === 'clause' && b.redline?.deleted)).map(lineFor).join('\n\n') + '\n')
}

const REDLINE = { author: 'Acme Legal', date: '2026-10-12T14:30:00Z' }

/**
 * Word output. Clauses with `redline` are written as real Track Changes
 * (w:ins / w:del, attributed to the counterparty) and `comment` as margin
 * comments, which is how a negotiated draft actually arrives.
 */
async function writeDocx(def: DemoContractDef, path: string) {
  let changeId = 100
  const comments: { id: number; author: string; date: Date; children: Paragraph[] }[] = []
  const ins = (text: string) => new InsertedTextRun({ text, id: changeId++, ...REDLINE })
  const del = (text: string) => new DeletedTextRun({ text, id: changeId++, ...REDLINE })

  const clauseRuns = (b: Extract<Block, { kind: 'clause' }>): (TextRun | InsertedTextRun | DeletedTextRun)[] => {
    if (b.redline?.inserted) return [ins(`${b.number} ${b.text}`)]
    if (b.redline?.deleted) return [del(`${b.number} ${b.text}`)]
    const runs: (TextRun | InsertedTextRun | DeletedTextRun)[] = [new TextRun({ text: `${b.number} `, bold: true })]
    if (!b.redline?.base) return [...runs, new TextRun(b.text)]
    wordDiff(b.redline.base, b.text).forEach((t, k) => {
      if (k > 0) runs.push(new TextRun(' '))
      runs.push(t.op === 'same' ? new TextRun(t.text) : t.op === 'add' ? ins(t.text) : del(t.text))
    })
    return runs
  }

  const children = def.blocks.map((b) => {
    if (b.kind === 'title') return new Paragraph({ text: b.text, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER })
    if (b.kind === 'heading')
      return b.inserted
        ? new Paragraph({ children: [ins(lineFor(b))], heading: HeadingLevel.HEADING_2, spacing: { before: 240 } })
        : new Paragraph({ text: lineFor(b), heading: HeadingLevel.HEADING_2, spacing: { before: 240 } })
    if (b.kind === 'clause') {
      const runs = clauseRuns(b)
      if (!b.comment) return new Paragraph({ children: runs, spacing: { after: 120 } })
      const id = comments.length
      comments.push({ id, author: REDLINE.author, date: new Date(REDLINE.date), children: [new Paragraph({ children: [new TextRun(b.comment)] })] })
      return new Paragraph({
        children: [new CommentRangeStart(id), ...runs, new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })],
        spacing: { after: 120 }
      })
    }
    return new Paragraph({ text: b.text, spacing: { after: 160 } })
  })
  const doc = new Document({
    comments: { children: comments },
    sections: [{ children }],
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }
  })
  writeFileSync(path, await Packer.toBuffer(doc))
}

function writePdf(def: DemoContractDef, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: def.title } })
    const out = createWriteStream(path)
    doc.pipe(out)
    for (const b of def.blocks) {
      if (b.kind === 'title') doc.font('Helvetica-Bold').fontSize(15).text(b.text, { align: 'center' }).moveDown(1.2)
      else if (b.kind === 'heading') doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10.5).text(lineFor(b)).moveDown(0.6)
      else doc.font('Helvetica').fontSize(10).text(lineFor(b), { align: 'justify', lineGap: 1.5 }).moveDown(0.8)
    }
    doc.end()
    out.on('finish', () => resolve())
    out.on('error', reject)
  })
}

async function main() {
  const index: { file: string; title: string; description: string; path: string }[] = []
  for (const def of DEMO_CONTRACTS) {
    const path = join(contractsDir, def.file)
    if (def.format === 'txt') writeTxt(def, path)
    if (def.format === 'docx') await writeDocx(def, path)
    if (def.format === 'pdf') await writePdf(def, path)
    index.push({ file: def.file, title: def.title, description: def.description, path: `demo/contracts/${def.file}` })
  }
  writeFileSync(join(contractsDir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`contracts: ${index.map((c) => c.file).join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
