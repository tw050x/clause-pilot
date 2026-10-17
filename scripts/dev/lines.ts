// Dev: print the lines a file parses into.
import { parseFile } from '../../src/main/ingest/parse'
const doc = await parseFile(process.argv[2])
doc.lines.forEach((l, i) => console.log(i, JSON.stringify(l.slice(0, 110)), doc.lineMeta?.[i] ? JSON.stringify(doc.lineMeta[i]).slice(0, 80) : ''))
