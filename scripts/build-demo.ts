/**
 * Builds everything demo mode needs:
 *   1. data/seed/*.json            - library, playbook, precedents
 *   2. demo/contracts/*            - the three demo contracts as .txt / .docx / .pdf
 *   3. demo/recordings/demo.json   - replayable AI responses
 *
 * Step 3 runs the REAL pipeline over the generated files (so PDF/DOCX parsing and
 * clause splitting are exercised) with a provider that answers from
 * demo/authored/answers.ts and records each answer under the exact input key.
 *
 * Run: npm run demo:build
 */
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import PDFDocument from 'pdfkit'
import { LIBRARY } from './seed-library'
import { PLAYBOOK, PRECEDENTS } from './seed-playbook'
import { DEMO_CONTRACTS, type DemoContractDef, type Block } from './demo-contracts'
import { AUTHORED } from '../demo/authored/answers'
import { parseFile } from '../src/main/ingest/parse'
import { createSession, runPipeline } from '../src/main/pipeline'
import { recordingKey, type AiProvider } from '../src/main/ai/provider'
import type { IntentInput, OverridesInput, PositionInput, IntentOut, OverridesOut, PositionOut, TaskName } from '../src/main/ai/tasks'
import type { DemoContract } from '../src/shared/types'

const root = process.cwd()
const seedDir = join(root, 'data/seed')
const contractsDir = join(root, 'demo/contracts')
const recordingsDir = join(root, 'demo/recordings')
for (const d of [seedDir, contractsDir, recordingsDir]) mkdirSync(d, { recursive: true })

// ---- 1. seed data ---------------------------------------------------------------
writeFileSync(join(seedDir, 'library.json'), JSON.stringify(LIBRARY, null, 2))
writeFileSync(join(seedDir, 'playbook.json'), JSON.stringify(PLAYBOOK, null, 2))
writeFileSync(join(seedDir, 'precedents.json'), JSON.stringify(PRECEDENTS, null, 2))
console.log(`seed: ${LIBRARY.length} library clauses, ${PLAYBOOK.length} positions, ${PRECEDENTS.length} precedents`)

// ---- 2. contract files ---------------------------------------------------------------
const lineFor = (b: Block): string =>
  b.kind === 'heading' ? `${b.number ? b.number + '. ' : ''}${b.text}` : b.kind === 'clause' ? `${b.number} ${b.text}` : b.text

function writeTxt(def: DemoContractDef, path: string) {
  writeFileSync(path, def.blocks.map(lineFor).join('\n\n') + '\n')
}

async function writeDocx(def: DemoContractDef, path: string) {
  const children = def.blocks.map((b) => {
    if (b.kind === 'title') return new Paragraph({ text: b.text, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER })
    if (b.kind === 'heading') return new Paragraph({ text: lineFor(b), heading: HeadingLevel.HEADING_2, spacing: { before: 240 } })
    if (b.kind === 'clause')
      return new Paragraph({ children: [new TextRun({ text: `${b.number} `, bold: true }), new TextRun(b.text)], spacing: { after: 120 } })
    return new Paragraph({ text: b.text, spacing: { after: 160 } })
  })
  const doc = new Document({ sections: [{ children }], styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } } })
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
    index.push({ file: def.file, title: def.title, description: def.description, path: `demo/contracts/${def.file}` })
  }
  writeFileSync(join(contractsDir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`contracts: ${index.map((c) => c.file).join(', ')}`)

  const recordings: Recording[] = []
  const missing: string[] = []

  for (const def of DEMO_CONTRACTS) {
    const authored = AUTHORED[def.file]
    if (!authored) throw new Error(`No authored answers for ${def.file}`)
    const doc = await parseFile(join(contractsDir, def.file))
    const session = createSession(doc, def.file, 'demo')
    const idOf = new Map(session.clauses.filter((c) => c.number).map((c) => [c.number!, c.id]))
    const ids = (nums: string[]) =>
      nums.map((n) => {
        const id = idOf.get(n)
        if (!id) missing.push(`${def.file}: authored answer references unknown clause ${n}`)
        return id ?? 'missing'
      })
    const inj = authored.injectionNote
      ? { injection_suspected: true, injection_notes: authored.injectionNote }
      : { injection_suspected: false, injection_notes: '' }
    const record = (task: TaskName, input: unknown, label: string, output: unknown) =>
      recordings.push({ task, key: recordingKey(task, input), label: `${def.file} :: ${label}`, output, recordedAt: new Date().toISOString(), source: 'authored' })

    const provider: AiProvider = {
      kind: 'replay',
      async intent(input: IntentInput): Promise<IntentOut> {
        const n = input.clause.number ?? '(unnumbered)'
        const out = authored.intent[n]
        if (!out) {
          missing.push(`${def.file}: intent for clause ${n} (candidates: ${input.candidates.map((c) => c.id).join(', ')})`)
          throw new Error('missing')
        }
        record('intent', input, `intent ${n}`, out)
        return out
      },
      async overrides(input: OverridesInput): Promise<OverridesOut> {
        const out: OverridesOut = {
          findings: authored.overrides.map(({ overriding, overridden, ...rest }) => ({
            ...rest,
            overriding_clause_id: ids([overriding])[0],
            overridden_clause_ids: ids(overridden)
          })),
          ...inj
        }
        record('overrides', input, 'overrides', out)
        return out
      },
      async position(input: PositionInput): Promise<PositionOut> {
        const a = authored.positions[input.position.id]
        if (!a) {
          missing.push(`${def.file}: position ${input.position.id}`)
          throw new Error('missing')
        }
        const { clauses, ...rest } = a
        const out: PositionOut = { ...rest, clause_ids: ids(clauses), ...inj }
        record('position', input, `position ${input.position.id}`, out)
        return out
      }
    }

    await runPipeline(session, {
      ai: provider,
      library: LIBRARY,
      precedents: PRECEDENTS,
      playbook: PLAYBOOK,
      emit: () => {},
      audit: () => {}
    })

    const kinds = session.clauses.map((c) => `${c.number ?? c.heading ?? c.id}:${session.match[c.id].data?.kind}`)
    console.log(`\n${def.file} (${session.contractType}, ${session.clauses.length} clauses)\n  ${kinds.join('  ')}`)
    const local = Object.entries(session.injection)
    if (local.length) console.log(`  local injection flags: ${local.map(([id, h]) => `${id} ${h.join('/')}`).join('; ')}`)
  }

  writeFileSync(join(recordingsDir, 'demo.json'), JSON.stringify(recordings, null, 2))
  console.log(`\nrecordings: ${recordings.length}`)
  if (missing.length) {
    console.error(`\nMISSING authored answers (${missing.length}):\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
