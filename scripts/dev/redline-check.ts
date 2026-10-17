// Dev check for the marked-up response: npx tsx scripts/dev/redline-check.ts <contract> <out.docx>
// Parses a demo contract, applies sample decisions, builds the redline and reads it back.
import { writeFileSync, readFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { splitClauses } from '../../src/main/ingest/clauses'
import { buildRedline } from '../../src/main/redline/docx'
import { readDocx } from '../../src/main/ingest/docxTracked'
import type { Decision, ReviewSession } from '../../src/shared/types'

const [path, out] = process.argv.slice(2)
const doc = await parseFile(path)
const clauses = splitClauses(doc.lines, doc.lineMeta)
const decisions: Record<string, Decision> = {}
const at = new Date().toISOString()
const decide = (num: string, d: Partial<Decision>) => {
  const c = clauses.find((x) => x.number === num)
  if (!c) return console.log('no clause', num)
  decisions[c.id] = { clauseId: c.id, decision: 'rejected', note: '', redline: '', nominate: false, by: 'Sam Reviewer', at, ...d }
}
const plan = JSON.parse(process.env.PLAN ?? '{}') as Record<string, Partial<Decision>>
for (const [num, d] of Object.entries(plan)) decide(num, d)
if (process.env.ALL) for (const c of clauses) decisions[c.id] ??= { clauseId: c.id, decision: "rejected", note: "check", redline: "", nominate: false, by: "Sam Reviewer", at }
const s = {
  id: 'test', docName: doc.name, filePath: path, sourceType: doc.sourceType, contractType: 'nda', fileSha256: doc.sha256, mode: 'demo', createdAt: at,
  clauses, match: {}, precedents: {}, overrides: { status: 'done' }, playbook: {}, injection: {}, aiInjectionReports: [], decisions,
  trackedDeletions: doc.deletions?.map((d) => ({ ...d, libraryTitle: process.env.REINSTATE?.includes(d.number ?? '') ? 'No warranty' : undefined }))
} as unknown as ReviewSession
const { bytes, stats } = await buildRedline(s, 'Sam Reviewer', readFileSync(path))
writeFileSync(out, bytes)
console.log(JSON.stringify(stats))
for (const p of await readDocx(bytes)) {
  const segs = p.segments?.map((x) => (x.op === 'same' ? x.text : `${x.op === 'ins' ? '[+' : '[-'}${x.text}${x.op === 'ins' ? '+]' : '-]'}{${x.author}}`)).join('')
  if (p.segments || p.comments || p.deleted) console.log('•', p.deleted ? `DELETED: ${p.deleted.text.slice(0, 60)}` : segs, p.comments ? `\n    comments: ${p.comments.map((c) => `${c.author}: ${c.text}`).join(' | ')}` : '')
}
