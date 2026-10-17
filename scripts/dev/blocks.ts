// Dev: print the paragraphs (blocks) a contract is read as, optionally only those whose label starts with a prefix.
import { parseFile } from '../../src/main/ingest/parse'
import { readBlocks } from '../../src/main/ingest/blocks'
const [path, prefix] = process.argv.slice(2)
const doc = await parseFile(path)
for (const b of await readBlocks(path, doc.sourceType)) if (!prefix || b.label?.startsWith(prefix)) console.log(b.id, b.kind, JSON.stringify(b.label), b.text.slice(0, 140))
