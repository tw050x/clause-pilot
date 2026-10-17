// Dev: edit a few paragraphs the way the editor does (including a new paragraph), build the
// marked-up copy, and print what Word would show for them when read back.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { readDocx } from '../../src/main/ingest/docxTracked'
import { createDocSession } from '../../src/main/docreview'
import { buildDocRedline } from '../../src/main/redline/docx'

const f = process.argv[2] ?? 'test-pack/test-1/Brightwater-Mutual-NDA-v1-client-redline.docx'
const doc = await parseFile(f)
const s = createDocSession(doc, await readBlocks(f, doc.sourceType), f, 'live', { library: [] })
const d = s.doc!
const byLabel = (l: string) => d.blocks.find((b) => b.label?.replace(/\.$/, '') === l)!
const b12 = byLabel('1.2')
d.edits[b12.id] = b12.text.replace('regarded as confidential.', 'regar')
const b41 = byLabel('4.1')
d.edits[b41.id] = b41.text.replace('five (5)', 'four (4)')
const at = d.blocks.indexOf(b41)
d.blocks.splice(at + 1, 0, { id: 'n1', kind: 'para', text: '', ours: true }, { id: 'n2', kind: 'para', text: '', ours: true })
d.edits.n1 = 'First new paragraph.'
d.edits.n2 = 'Second new paragraph.'
const { bytes, stats } = await buildDocRedline(s, 'Dev Reviewer', readFileSync(f))
console.log(stats)
if (process.argv[3]) writeFileSync(process.argv[3], bytes)
const back = await readDocx(bytes)
for (const p of back.filter((x) => /regar|four|new paragraph/i.test(x.text)))
  console.log(JSON.stringify(p.segments?.filter((x) => x.op !== 'same' || x.text.length < 30).map((x) => [x.op, x.author, x.text])))
