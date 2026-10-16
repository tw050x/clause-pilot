import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import type { ChatMessage } from '@shared/types'
import { sha256 } from '../engine/text'
import {
  IntentSchema,
  OverridesSchema,
  PositionSchema,
  EmailSchema,
  type IntentInput,
  type IntentOut,
  type OverridesInput,
  type OverridesOut,
  type PositionInput,
  type PositionOut,
  type EmailOut,
  type TaskName
} from './tasks'
import {
  INTENT_SYSTEM,
  intentUser,
  DOCUMENT_SYSTEM,
  contractBlock,
  OVERRIDES_QUESTION,
  positionQuestion,
  EMAIL_SYSTEM
} from './prompts'

export interface AiProvider {
  readonly kind: 'anthropic' | 'replay'
  intent(input: IntentInput): Promise<IntentOut>
  overrides(input: OverridesInput): Promise<OverridesOut>
  position(input: PositionInput): Promise<PositionOut>
}

export class NoRecordingError extends Error {
  constructor(task: TaskName) {
    super(`Demo mode has no recorded AI response for this ${task} check. Add an API key in Settings to run it live.`)
  }
}

export class AiRefusalError extends Error {}

/** Stable key for record/replay: the task name plus its semantic input, not the prompt text. */
export function recordingKey(task: TaskName, input: unknown): string {
  return sha256(task + '\n' + stableStringify(input))
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const BETAS = ['server-side-fallback-2026-07-01']

export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const
  private client: Anthropic

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3 })
  }

  private async structured<S extends z.ZodType>(
    schema: S,
    system: string,
    content: Anthropic.Beta.BetaContentBlockParam[],
    effort: 'low' | 'medium' | 'high'
  ): Promise<z.infer<S>> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      system,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{ role: 'user', content }]
    })
    if (res.stop_reason === 'refusal') throw new AiRefusalError('The model declined this request.')
    if (res.stop_reason === 'max_tokens') throw new Error('The model response was cut off (max_tokens).')
    if (!res.parsed_output) throw new Error('The model returned output that did not match the expected schema.')
    return res.parsed_output as z.infer<S>
  }

  intent(input: IntentInput): Promise<IntentOut> {
    return this.structured(IntentSchema, INTENT_SYSTEM, [{ type: 'text', text: intentUser(input) }], 'medium')
  }

  /** Document-level tasks: contract block first (cached), then the one question. */
  private documentContent(clauses: OverridesInput['clauses'], question: string): Anthropic.Beta.BetaContentBlockParam[] {
    return [
      { type: 'text', text: contractBlock(clauses), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: question }
    ]
  }

  overrides(input: OverridesInput): Promise<OverridesOut> {
    return this.structured(OverridesSchema, DOCUMENT_SYSTEM, this.documentContent(input.clauses, OVERRIDES_QUESTION), 'high')
  }

  position(input: PositionInput): Promise<PositionOut> {
    return this.structured(PositionSchema, DOCUMENT_SYSTEM, this.documentContent(input.clauses, positionQuestion(input)), 'medium')
  }

  email(userPrompt: string): Promise<EmailOut> {
    return this.structured(EmailSchema, EMAIL_SYSTEM, [{ type: 'text', text: userPrompt }], 'low')
  }

  async chat(system: string, history: ChatMessage[], onDelta: (t: string) => void): Promise<string> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: history.map((m) => ({ role: m.role, content: m.content }))
    })
    stream.on('text', (t) => onDelta(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') throw new AiRefusalError('The model declined this request.')
    return final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  }
}

// ---------------------------------------------------------------------------
// Record / replay
// ---------------------------------------------------------------------------

interface Recording {
  task: TaskName
  key: string
  label?: string
  output: unknown
  recordedAt: string
  source: 'live' | 'authored'
}

export class RecordingStore {
  private map = new Map<string, Recording>()

  constructor(private dirs: string[], private writeDir?: string) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const recs = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording[]
        for (const r of recs) this.map.set(r.key, r)
      }
    }
  }

  get(key: string): Recording | undefined {
    return this.map.get(key)
  }

  save(rec: Recording): void {
    this.map.set(rec.key, rec)
    if (!this.writeDir) return
    mkdirSync(this.writeDir, { recursive: true })
    const file = join(this.writeDir, 'live-recordings.json')
    const existing: Recording[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
    writeFileSync(file, JSON.stringify([...existing.filter((r) => r.key !== rec.key), rec], null, 2))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Demo mode: serves recorded responses with a realistic delay so the UI's loading states are visible. */
export class ReplayProvider implements AiProvider {
  readonly kind = 'replay' as const
  constructor(private store: RecordingStore, private latency: [number, number] = [900, 3200]) {}

  private async replay<T>(task: TaskName, input: unknown): Promise<T> {
    const [lo, hi] = this.latency
    await sleep(lo + Math.random() * (hi - lo))
    const rec = this.store.get(recordingKey(task, input))
    if (!rec) throw new NoRecordingError(task)
    return rec.output as T
  }

  intent(input: IntentInput) {
    return this.replay<IntentOut>('intent', input)
  }
  overrides(input: OverridesInput) {
    return this.replay<OverridesOut>('overrides', input)
  }
  position(input: PositionInput) {
    return this.replay<PositionOut>('position', input)
  }
}

/** Live mode with recording on: every successful response becomes replayable later (demo / offline / evals). */
export class RecordingProvider implements AiProvider {
  readonly kind = 'anthropic' as const
  constructor(private inner: AiProvider, private store: RecordingStore) {}

  private async rec<T>(task: TaskName, input: unknown, run: () => Promise<T>): Promise<T> {
    const output = await run()
    this.store.save({ task, key: recordingKey(task, input), output, recordedAt: new Date().toISOString(), source: 'live' })
    return output
  }

  intent(input: IntentInput) {
    return this.rec('intent', input, () => this.inner.intent(input))
  }
  overrides(input: OverridesInput) {
    return this.rec('overrides', input, () => this.inner.overrides(input))
  }
  position(input: PositionInput) {
    return this.rec('position', input, () => this.inner.position(input))
  }
}
