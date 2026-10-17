// Dev: add a numbered clause the way Enter does and print the result as Word would read it back:
// for a document with typed numbers (the test pack's Brightwater NDA).
import { readFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { readDocx } from '../../src/main/ingest/docxTracked'
import { createDocSession } from '../../src/main/docreview'
import { buildDocRedline } from '../../src/main/redline/docx'
import { labelsOf } from '../../src/shared/numbering'

async function run(f: string, after: string, depth: number) {
  const doc = await parseFile(f)
  const s = createDocSession(doc, await readBlocks(f, doc.sourceType), f, 'live', { library: [] })
  const d = s.doc!
  const at = d.blocks.findIndex((b) => b.label?.replace(/\.$/, '') === after && b.kind !== 'heading')
  d.blocks.splice(at + 1, 0, { id: 'nNEW', kind: 'para', text: '', ours: true, list: { kind: 'dec', depth } })
  d.edits.nNEW = 'A new clause we added.'
  const now = labelsOf(d)
  console.log(`\n${f}: new clause numbered ${now.get('nNEW')}; next ones:`, d.blocks.slice(at + 2, at + 5).map((b) => `${b.label}→${now.get(b.id)}`).join(' '))
  const { bytes } = await buildDocRedline(s, 'Dev Reviewer', readFileSync(f))
  const back = await readDocx(bytes)
  const i = back.findIndex((p) => p.text.includes('A new clause we added'))
  for (const p of back.slice(i - 1, i + 3)) console.log(' ', p.label ?? '', JSON.stringify((p.segments ?? [{ op: 'same', text: p.text }]).slice(0, 3).map((x) => [x.op, x.text.slice(0, 50)])))
}
await run('test-pack/test-1/Brightwater-Mutual-NDA-v1-client-redline.docx', '2.3', 2)
