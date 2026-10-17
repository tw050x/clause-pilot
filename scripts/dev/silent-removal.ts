// Dev: a paragraph removed without Track Changes is found by comparison, and restoring it puts it back
// in the marked-up copy as our tracked insertion.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { readDocx } from '../../src/main/ingest/docxTracked'
import { applyScriptedChanges, createDocSession } from '../../src/main/docreview'
import { buildDocRedline } from '../../src/main/redline/docx'
import { changeSets } from '../../src/shared/changes'
import { DEMO_SCENARIOS } from '../../src/shared/demoScenarios'

const lib = JSON.parse(readFileSync('data/seed/library.json', 'utf8'))
const v1 = 'demo/contracts/Acme-Mutual-NDA-redlined.docx'
const v2 = 'demo/contracts/Acme-Mutual-NDA-v2.docx'
const d1 = await parseFile(v1)
const s1 = createDocSession(d1, await readBlocks(v1, d1.sourceType), v1, 'demo', { library: lib })
applyScriptedChanges(s1, DEMO_SCENARIOS.find((d) => d.id === 'second-draft')!.history[0].changes, 'dev')
const d2 = await parseFile(v2)
// Pretend they quietly dropped 6.4 (assignment).
const blocks = (await readBlocks(v2, d2.sourceType)).filter((b) => b.label !== '6.4')
const s2 = createDocSession(d2, blocks, v2, 'demo', { library: lib, prev: s1 })
const sets = changeSets(s2.doc!)
console.log(sets.map((x) => `${x.where} [${x.blocks.map((b) => b.kind + '/' + b.untracked).join(',')}]`))
const gone = sets.find((x) => x.where === '§6.4')!
s2.doc!.edits[gone.blocks[0].id] = gone.blocks[0].text
const { bytes, stats } = await buildDocRedline(s2, 'Dev Reviewer', readFileSync(v2))
console.log(stats)
writeFileSync(process.argv[2], bytes)
const back = await readDocx(bytes)
const p = back.find((x) => x.text.includes('Neither party may assign'))
console.log(JSON.stringify(p?.segments?.map((s) => [s.op, s.author, s.text.slice(0, 40)])))
