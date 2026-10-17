// Dev: numbering with paragraphs we've added (prints each paragraph's number as it now reads).
import { labelsOf } from '../../src/shared/numbering'
import type { DocBlock, DocReview } from '../../src/shared/types'

const P = (id: string, label?: string, extra: Partial<DocBlock> = {}): DocBlock => ({ id, kind: 'para', label, text: id, ...extra })
const blocks: DocBlock[] = [
  P('h1', '1.', { kind: 'heading' }),
  P('p11', '1.1'),
  P('p12', '1.2'),
  P('a', '(a)'),
  P('n1', undefined, { ours: true, list: { kind: 'alpha', depth: 0, open: '(', close: ')' } }),
  P('b', '(b)'),
  P('p13', '1.3'),
  P('n2', undefined, { ours: true, list: { kind: 'dec', depth: 2 } }),
  P('p14', '1.4'),
  P('h2', '2.', { kind: 'heading' }),
  P('p21', '2.1'),
  P('n3', undefined, { ours: true, list: { kind: 'dec', depth: 1 } }),
  P('n4', undefined, { ours: true, list: { kind: 'dec', depth: 2 } }),
  P('h3', '3.', { kind: 'heading' }),
  P('p31', '3.1'),
  P('i', '(i)'),
  P('ii', '(ii)')
]
const d: DocReview = { blocks, edits: {}, comments: [], decisions: {} }
for (const [id, l] of labelsOf(d)) console.log(id.padEnd(4), blocks.find((b) => b.id === id)!.label ?? '-', '→', l)
