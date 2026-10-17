// Dev: accept and reject individual tracked changes (as the selection panel does) and print the
// paragraph as Word would read it back from the marked-up copy.
import { readFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { readDocx } from '../../src/main/ingest/docxTracked'
import { createDocSession } from '../../src/main/docreview'
import { buildDocRedline } from '../../src/main/redline/docx'

const f = 'demo/1-our-nda-two-rounds/Brightwater-Mutual-NDA-v1-client-redline.docx'
const doc = await parseFile(f)
const s = createDocSession(doc, await readBlocks(f, doc.sourceType), f, 'live', { library: [] })
const b = s.doc!.blocks.find((x) => x.label === '1.3')!
console.log('received:', JSON.stringify(b.segments!.slice(0, 6).map((x) => [x.op, x.text])))
s.doc!.resolved = { [`${b.id}:0`]: 'accepted', [`${b.id}:2`]: 'rejected', [`${b.id}:4`]: 'rejected' }
const { bytes } = await buildDocRedline(s, 'Dev Reviewer', readFileSync(f))
const back = (await readDocx(bytes)).find((x) => x.text.includes('Information') && x.text.includes('lawfully'))!
console.log('exported:', JSON.stringify(back.segments!.slice(0, 6).map((x) => [x.op, x.text])))
