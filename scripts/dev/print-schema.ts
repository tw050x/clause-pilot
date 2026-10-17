// Dev: print the JSON Schema sent to the API for an AI task (default: the intention match).
import { z } from 'zod'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import { IntentSchema } from '../../src/main/ai/tasks'

const raw = z.toJSONSchema(IntentSchema, { reused: 'ref' })
console.log('as generated:', JSON.stringify(raw).slice(0, 160))
console.log('as sent:', JSON.stringify(transformJSONSchema(raw), null, 1))
