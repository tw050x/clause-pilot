/**
 * Builds everything demo mode needs:
 *   1. data/seed/*.json            - library, playbook, precedents
 *   2. demo/contracts/*            - the three demo contracts as .txt / .docx / .pdf
 *   3. demo/recordings/demo.json   - replayable AI responses
 *
 * Step 3 builds each demo review the way the app does (reading the generated
 * PDF / Word / text files, comparing later drafts with what we sent, using the
 * demos' scripted responses) and records the authored answer in
 * demo/authored/changes.ts for every change set under its exact AI input key.
 *
 * Run: npm run demo:build
 */
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, InsertedTextRun, DeletedTextRun, CommentRangeStart, CommentRangeEnd, CommentReference } from 'docx'
import { wordDiff } from '../src/main/engine/text'
import PDFDocument from 'pdfkit'
import { LIBRARY } from './seed-library'
import { PLAYBOOK, PRECEDENTS } from './seed-playbook'
import { DEMO_ACCOUNTS, DEMO_CONTRACT_RECORDS, DEMO_CONTRACTS, type DemoContractDef, type Block } from './demo-contracts'
import { AUTHORED_CHANGES } from '../demo/authored/changes'
import { AUTHORED_INTENT } from '../demo/authored/intent'
import { parseFile } from '../src/main/ingest/parse'
import { readBlocks } from '../src/main/ingest/blocks'
import { applyScriptedChanges, changeInput, createDocSession, intentInput } from '../src/main/docreview'
import { changeKey, recordingKey } from '../src/main/ai/provider'
import type { ChangeOut, TaskName } from '../src/main/ai/tasks'
import { changeSets, intentCandidate, type ChangeSet } from '../src/shared/changes'
import { DEMO_SCENARIOS } from '../src/shared/demoScenarios'
import type { DemoContract, ReviewSession } from '../src/shared/types'

const root = process.cwd()
const seedDir = join(root, 'data/seed')
const contractsDir = join(root, 'demo/contracts')
const recordingsDir = join(root, 'demo/recordings')
for (const d of [seedDir, contractsDir, recordingsDir]) mkdirSync(d, { recursive: true })

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

// ---- 3. recordings ---------------------------------------------------------------------
interface Recording {
  task: TaskName
  key: string
  label: string
  output: unknown
  recordedAt: string
  source: 'authored'
}

async function main() {
  const index: DemoContract[] = []
  for (const def of DEMO_CONTRACTS) {
    const path = join(contractsDir, def.file)
    if (def.format === 'txt') writeTxt(def, path)
    if (def.format === 'docx') await writeDocx(def, path)
    if (def.format === 'pdf') await writePdf(def, path)
    index.push({ file: def.file, accountId: def.accountId, contractId: def.contractId, followUpOf: def.followUpOf, title: def.title, description: def.description, path: `demo/contracts/${def.file}` })
  }
  writeFileSync(join(contractsDir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`contracts: ${index.map((c) => c.file).join(', ')}`)

  const recordings: Recording[] = []
  const missing: string[] = []
  // Earlier drafts are reviewed with the demos' scripted responses, as the second- and third-draft demos do.
  const scripted = DEMO_SCENARIOS.find((d) => d.id === 'third-draft')!.history
  const reviewed = new Map<string, ReviewSession>()

  for (const def of DEMO_CONTRACTS) {
    const path = join(contractsDir, def.file)
    const doc = await parseFile(path)
    const blocks = await readBlocks(path, doc.sourceType)
    const prev = def.followUpOf ? reviewed.get(def.followUpOf) : undefined
    if (def.followUpOf && !prev) throw new Error(`${def.file} follows ${def.followUpOf}, which must come first`)
    const s = createDocSession(doc, blocks, `demo/contracts/${def.file}`, 'demo', { prev, library: LIBRARY })
    const authored = AUTHORED_CHANGES[def.file] ?? {}
    const sets = changeSets(s.doc!)
    const byLabel = new Map(s.doc!.blocks.filter((b) => b.label).map((b) => [b.label!.replace(/\.$/, ''), b.id]))
    const keyOf = (set: ChangeSet) => Object.keys(authored).find((k) => set.where.split(' ')[0] === k || set.blocks[0].text.startsWith(k))
    for (const set of sets) {
      const k = keyOf(set)
      if (!k) {
        missing.push(`${def.file}: no authored answer for the change at ${set.where}`)
        continue
      }
      const a = authored[k]
      const first = set.blocks.find((b) => b.kind !== 'heading') ?? set.blocks[0]
      const related = (a.related ?? []).map((r) => {
        const id = byLabel.get(r.label)
        if (!id) missing.push(`${def.file} ${k}: related paragraph ${r.label} not found`)
        return { block_id: id ?? 'missing', why: r.why }
      })
      const out: ChangeOut = {
        summary: a.summary,
        effect: a.effect,
        risk: a.risk,
        recommendation: a.recommendation,
        reasoning: a.reasoning,
        playbook: a.playbook,
        related,
        suggested_edits: a.suggest === undefined ? [] : [{ block_id: first.id, text: a.suggest }],
        comment_to_them: a.comment_to_them,
        injection_suspected: !!a.injection,
        injection_notes: a.injection ?? ''
      }
      const input = changeInput(s, set, [], [])
      recordings.push({ task: 'change', key: recordingKey('change', changeKey(input)), label: `${def.file} :: ${set.where}`, output: out, recordedAt: new Date().toISOString(), source: 'authored' })
    }
    for (const k of Object.keys(authored)) if (!sets.some((x) => keyOf(x) === k)) missing.push(`${def.file}: authored answer for ${k}, but the app finds no change there`)

    // The AI meaning check: every paragraph the app would offer to check needs an answer.
    const intents = AUTHORED_INTENT[def.file] ?? {}
    const offered = s.doc!.blocks.filter((b) => intentCandidate(s.doc!, b))
    for (const b of offered) {
      const label = b.label?.replace(/\.$/, '') ?? ''
      const input = intentInput(s.doc!, b, LIBRARY)
      const a = intents[label]
      if (!input) continue
      if (!a) {
        missing.push(`${def.file}: no authored meaning check for ${label || b.text.slice(0, 30)} (against "${input.candidates[0].title}")`)
        continue
      }
      recordings.push({ task: 'intent', key: recordingKey('intent', input), label: `${def.file} :: intent ${label}`, output: { ...a, best_match_id: input.candidates[0].id }, recordedAt: new Date().toISOString(), source: 'authored' })
    }
    for (const k of Object.keys(intents)) if (!offered.some((b) => b.label?.replace(/\.$/, '') === k)) missing.push(`${def.file}: authored meaning check for ${k}, but the app wouldn't offer it`)
    console.log(`  meaning checks offered: ${offered.map((b) => b.label ?? '?').join(', ') || 'none'}`)
    console.log(`${def.file}: ${s.doc!.blocks.length} paragraphs, ${sets.length} changes (${sets.map((x) => x.where.split(' ')[0]).join(', ')})`)
    const script = scripted.find((h) => h.file === def.file)
    if (script) applyScriptedChanges(s, script.changes, 'demo-setup')
    reviewed.set(def.file, s)
  }

  writeFileSync(join(recordingsDir, 'demo.json'), JSON.stringify(recordings, null, 2))
  console.log(`\nrecordings: ${recordings.length}`)
  if (missing.length) {
    console.error(`\nMISSING or unused authored answers (${missing.length}):\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
