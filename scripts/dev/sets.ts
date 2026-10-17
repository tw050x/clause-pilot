// Dev: print the change sets the document screen finds in contracts (with the demo library).
//   npx tsx --tsconfig tsconfig.node.json scripts/dev/sets.ts <files…>
import { readFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { createDocSession } from '../../src/main/docreview'
import { changeSets } from '../../src/shared/changes'

const lib = JSON.parse(readFileSync('demo/1-our-nda-two-rounds/library.json', 'utf8')).clauses
for (const f of process.argv.slice(2)) {
  const doc = await parseFile(f)
  const blocks = await readBlocks(f, doc.sourceType)
  const s = createDocSession(doc, blocks, f, 'live', { library: lib })
  const sets = changeSets(s.doc!)
  console.log(`\n${f}: ${blocks.length} blocks, ${sets.length} sets, baseline ${JSON.stringify(s.doc!.baseline)}  injection ${Object.keys(s.injection)}`)
  for (const x of sets) console.log(`  ${x.id} ${x.where} [${x.blocks.map((b) => b.kind + (b.untracked ? '/u' : '') + (b.standard ? ':' + b.standard : '')).join(',')}] ${x.blocks[0].text.slice(0, 60)}`)
}
