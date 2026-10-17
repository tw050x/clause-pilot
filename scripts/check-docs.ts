/**
 * Checks that docs/intent-matching.md still shows the intent-matching schema exactly as the
 * code generates it (the full schema, then the schema as sent to the API).
 *
 *   npm run docs:check
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import { IntentSchema } from '../src/main/ai/tasks'

const doc = readFileSync('docs/intent-matching.md', 'utf8')
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1])
const generated = z.toJSONSchema(IntentSchema, { reused: 'ref' })
const expected = [generated, transformJSONSchema(generated)]
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const problems = expected.flatMap((schema, i) => {
  const shown = blocks[i] ? JSON.parse(blocks[i]) : null
  return same(shown, schema) ? [] : [`${i === 0 ? 'The full schema' : 'The schema as sent'} in docs/intent-matching.md is out of date.`]
})
if (problems.length) {
  console.error(problems.join('\n') + '\nRegenerate with: npx tsx --tsconfig tsconfig.node.json scripts/dev/print-schema.ts [generated|sent]')
  process.exit(1)
}
console.log('docs/intent-matching.md matches the code.')
