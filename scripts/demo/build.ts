/**
 * Builds the demo files (demo/), for trying the app as a user would, with real AI. Each demo
 * folder gets everything it needs; its README.md (written by hand, not generated) is the guide.
 *   demo/1-our-nda-two-rounds/   library.json, playbook.json, the NDA as we sent it, the client's redline,
 *                                their next draft
 *   demo/2-client-paper/         library.json, playbook.json, the client's own agreement
 *   demo/3-supplier-msa/         library.json, playbook.json, a supplier's agreement formatted as
 *                                a real one is (logo, tables, numbering, header and footer)
 * library.json and playbook.json are in the app's export format: import them on the Library and
 * Playbook pages.
 *
 * Run: npm run demo:build
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, InsertedTextRun, DeletedTextRun, CommentRangeStart, CommentRangeEnd, CommentReference } from 'docx'
import { diffSegments } from '../../src/shared/diff'
import { libraryFile, playbookFile } from '../../src/main/transfer'
import { LIBRARY } from './library'
import { PLAYBOOK } from './playbook'
import { MSA_FILE, msaDocx } from './msa'
import { writeDemoSeed } from './seed'
import { BRIGHTWATER_V0, BRIGHTWATER_V1, BRIGHTWATER_V2, KESTREL, type Block, type ContractFile } from './contracts'

const DEMOS = [
  { dir: 'demo/1-our-nda-two-rounds', contracts: [BRIGHTWATER_V0, BRIGHTWATER_V1, BRIGHTWATER_V2] },
  { dir: 'demo/2-client-paper', contracts: [KESTREL] },
  { dir: 'demo/3-supplier-msa', contracts: [] }
]

const by = 'PortSwigger Legal'
const at = '2026-10-01T09:00:00.000Z'
const library = JSON.stringify({ ...libraryFile(LIBRARY, by), exportedAt: at }, null, 2) + '\n'
const playbook = JSON.stringify({ ...playbookFile(PLAYBOOK, by), exportedAt: at }, null, 2) + '\n'

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

  type Piece = { op: 'same' | 'ins' | 'del'; text: string }
  const make = (p: Piece): Run => (p.op === 'same' ? new TextRun(p.text) : p.op === 'ins' ? ins(p.text) : del(p.text))

  /**
   * The paragraph's runs, with its comment's range around `anchor` (words in the text as
   * proposed) or, without one, around the whole paragraph, as Word does.
   */
  const runs = (b: Extract<Block, { kind: 'para' }>, commentId: number | null): (Run | CommentRangeStart | CommentRangeEnd)[] => {
    const num = b.number ? `${b.number} ` : ''
    const op = b.tracked?.inserted ? 'ins' : b.tracked?.deleted ? 'del' : 'same'
    const head: Run[] = num ? [op === 'ins' ? ins(num, true) : op === 'del' ? del(num, true) : new TextRun({ text: num, bold: true })] : []
    const pieces: Piece[] = b.tracked?.base ? wholeWords(diffSegments(b.tracked.base, b.text)) : [{ op, text: b.text }]
    if (commentId === null) return [...head, ...pieces.map(make)]
    if (!b.anchor) return [new CommentRangeStart(commentId), ...head, ...pieces.map(make), new CommentRangeEnd(commentId)]
    // Split the pieces where the anchor starts and ends (counted in the proposed text: deletions take no room).
    const from = b.text.indexOf(b.anchor)
    if (from < 0) throw new Error(`Anchor not found in ${b.number}: ${b.anchor}`)
    const to = from + b.anchor.length
    const out: (Run | CommentRangeStart | CommentRangeEnd)[] = [...head]
    let at = 0
    for (const p of pieces) {
      if (p.op === 'del') {
        out.push(make(p))
        continue
      }
      const cuts = [from, to].filter((x) => x > at && x < at + p.text.length).map((x) => x - at)
      let i = 0
      for (const cut of [...cuts, p.text.length]) {
        if (at + i === from) out.push(new CommentRangeStart(commentId))
        if (at + i === to) out.push(new CommentRangeEnd(commentId))
        if (cut > i) out.push(make({ ...p, text: p.text.slice(i, cut) }))
        i = cut
      }
      at += p.text.length
    }
    if (at === to) out.push(new CommentRangeEnd(commentId))
    return out
  }

  const children = c.blocks.map((b) => {
    if (b.kind === 'title') return new Paragraph({ children: [new TextRun({ text: b.text, bold: true, size: 28 })], alignment: AlignmentType.CENTER, spacing: { after: 240 } })
    if (b.kind === 'heading')
      return new Paragraph({ children: [b.inserted ? ins(b.text, true) : new TextRun({ text: b.text, bold: true })], heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
    if (!b.comment) return new Paragraph({ children: runs(b, null), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED })
    const id = comments.length
    comments.push({ id, author: c.author, date: new Date(c.date), children: [new Paragraph({ children: [new TextRun(b.comment)] })] })
    return new Paragraph({
      children: [...runs(b, id), new TextRun({ children: [new CommentReference(id)] })],
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

/**
 * A redline as a person makes it in Word: whole words. The diff can cut a change mid-word
 * ("three (3" for "five (5", sharing the ")"); move the shared part of the word into the change.
 */
function wholeWords(segs: { op: 'same' | 'ins' | 'del'; text: string }[]): { op: 'same' | 'ins' | 'del'; text: string }[] {
  const out: { op: 'same' | 'ins' | 'del'; text: string }[] = []
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].op === 'same') {
      out.push({ ...segs[i] })
      continue
    }
    // One change: the run of insertions and deletions between two unchanged stretches.
    let j = i
    while (j + 1 < segs.length && segs[j + 1].op !== 'same') j++
    const group = segs.slice(i, j + 1)
    const del = group.filter((s) => s.op === 'del').map((s) => s.text).join('')
    const ins = group.filter((s) => s.op === 'ins').map((s) => s.text).join('')
    const before = out[out.length - 1]
    const after = segs[j + 1] ? { ...segs[j + 1] } : undefined
    // Only where the change cuts a word: it starts (or ends) mid-word on both sides of the cut.
    const starts = (t: string) => !!t && !/^\s/.test(t)
    const ends = (t: string) => !!t && !/\s$/.test(t)
    const cutsStart = before?.op === 'same' && /\S$/.test(before.text) && [del, ins].some(starts)
    const cutsEnd = after?.op === 'same' && /^\S/.test(after.text) && [del, ins].some(ends)
    const head = cutsStart ? before!.text.match(/\S+$/)![0] : ''
    const tail = cutsEnd ? after!.text.match(/^\S+/)![0] : ''
    if (head) before!.text = before!.text.slice(0, -head.length)
    if (tail) after!.text = after!.text.slice(tail.length)
    if (head || tail || del) out.push({ op: 'del', text: head + del + tail })
    if (head || tail || ins) out.push({ op: 'ins', text: head + ins + tail })
    if (after) {
      out.push(after)
      i = j + 1
    } else i = j
  }
  return out.filter((s) => s.text)
}

async function main() {
  for (const demo of DEMOS) {
    const dir = join(process.cwd(), demo.dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'library.json'), library)
    writeFileSync(join(dir, 'playbook.json'), playbook)
    for (const c of demo.contracts) await writeDocx(c, join(dir, c.file))
    const files = demo.contracts.map((c) => c.file)
    if (demo.dir.endsWith('3-supplier-msa')) {
      writeFileSync(join(dir, MSA_FILE), await msaDocx())
      files.push(MSA_FILE)
    }
    console.log(`${demo.dir}: library.json (${LIBRARY.length} clauses), playbook.json (${PLAYBOOK.length} positions), ${files.join(', ')}`)
  }  // Other clients' contracts, for the demo workspace's history: the demo contracts with the
  // parties renamed (their reviews are made by the app the first time the workspace opens).
  const files = join(process.cwd(), 'data', 'demo-files')
  mkdirSync(files, { recursive: true })
  for (const v of VARIANTS) await writeDocx(rename(v.from, v.file, v.names), join(files, v.file))
  console.log(`data/demo-files: ${VARIANTS.length} more contracts for the demo workspace's history`)
  // The demo workspace's starting data, from the same library and playbook.
  writeDemoSeed()
}

/** A demo contract with its parties renamed (every mention, author included), as another file. */
function rename(c: ContractFile, file: string, names: [string, string][]): ContractFile {
  const text = names.reduce((t, [a, b]) => t.split(a).join(b), JSON.stringify(c))
  return { ...(JSON.parse(text) as ContractFile), file }
}

const NDA = (party: string, short: string, key: string) => {
  const names: [string, string][] = [
    ['Brightwater Robotics Inc.', party],
    ['Brightwater Robotics', party],
    ['Brightwater', short]
  ]
  return [
    { from: BRIGHTWATER_V0, file: `${key}-Mutual-NDA-v0-we-sent.docx`, names },
    { from: BRIGHTWATER_V1, file: `${key}-Mutual-NDA-v1-redline.docx`, names },
    { from: BRIGHTWATER_V2, file: `${key}-Mutual-NDA-v2-response.docx`, names }
  ]
}
const PAPER = (party: string, short: string, key: string, title: string) => [
  {
    from: KESTREL,
    file: `${key}-${title.replace(/\s+/g, '-')}.docx`,
    names: [
      ['Kestrel Health Systems, Inc.', party],
      ['Kestrel Health Systems', party],
      ['Kestrel', short],
      ['CONFIDENTIALITY AGREEMENT', title.toUpperCase()],
      ['Confidentiality Agreement', title]
    ] as [string, string][]
  }
]
/** Contracts for the demo workspace's history (see scripts/demo/seed.ts for whose they are). */
export const VARIANTS = [
  ...NDA('Harbourline Hosting Ltd', 'Harbourline', 'Harbourline'),
  ...NDA('Northwind Logistics Ltd', 'Northwind', 'Northwind'),
  ...NDA('Acme Analytics Ltd', 'Acme', 'Acme'),
  ...NDA('Globex Retail Inc.', 'Globex', 'Globex'),
  ...NDA('Initech Software Ltd', 'Initech', 'Initech'),
  ...PAPER('Kestrel Health Systems', 'Kestrel', 'Kestrel', 'Data Sharing Agreement'),
  ...PAPER('Initech Software Ltd', 'Initech', 'Initech', 'Reseller Agreement'),
  ...PAPER('Northwind Logistics Ltd', 'Northwind', 'Northwind', 'Partner Confidentiality Agreement')
]

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
