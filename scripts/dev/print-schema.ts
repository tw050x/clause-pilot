// Dev: print the JSON Schema an AI task sends to the API (default: the intention match).
//   npx tsx --tsconfig tsconfig.node.json scripts/dev/print-schema.ts [generated|sent]
import { z } from 'zod'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import { IntentSchema } from '../../src/main/ai/tasks'

const raw = z.toJSONSchema(IntentSchema, { reused: 'ref' })
console.log(JSON.stringify(process.argv[2] === 'sent' ? transformJSONSchema(raw) : raw, null, 2))
