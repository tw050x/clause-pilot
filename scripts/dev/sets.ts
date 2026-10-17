// Dev: print the change sets the document screen finds in a contract (with the seed library).
// With --history, each file is reviewed as the next version of the one before, using the
// scripted responses of the second/third-draft demos.
import { readFileSync } from 'node:fs'
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
import { applyScriptedChanges, createDocSession } from '../../src/main/docreview'
import { changeSets, statusOf } from '../../src/shared/changes'
import { DEMO_SCENARIOS } from '../../src/shared/demoScenarios'
import type { ReviewSession } from '../../src/shared/types'

const lib = JSON.parse(readFileSync('data/seed/library.json', 'utf8'))
const history = process.argv.includes('--history')
const scripts = DEMO_SCENARIOS.find((d) => d.id === 'third-draft')!.history
let prev: ReviewSession | undefined
for (const f of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const doc = await parseFile(f)
  const blocks = await readBlocks(f, doc.sourceType)
  const s = createDocSession(doc, blocks, f, 'demo', { library: lib, prev: history ? prev : undefined })
  const sets = changeSets(s.doc!)
  console.log(`\n${f}: ${blocks.length} blocks, ${sets.length} sets, baseline ${JSON.stringify(s.doc!.baseline)}  injection ${Object.keys(s.injection)}`)
  for (const x of sets) console.log(`  ${x.id} ${x.where} [${x.blocks.map((b) => b.kind + (b.untracked ? '/u' : '') + (b.standard ? ':' + b.standard : '')).join(',')}] ${x.blocks[0].text.slice(0, 60)}`)
  const script = scripts.find((h) => f.endsWith(h.file))
  if (history && script) {
    applyScriptedChanges(s, script.changes, 'dev')
    console.log('  after script:', changeSets(s.doc!).map((x) => `${x.where}=${statusOf(s.doc!, x)}`).join('  '))
  }
  prev = s
}
