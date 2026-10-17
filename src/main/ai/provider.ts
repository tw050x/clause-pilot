import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z as zod, type z } from 'zod'
import type { ChatMessage } from '@shared/types'
import { sha256 } from '../engine/text'
import {
  IntentSchema,
  OverridesSchema,
  PositionSchema,
  EmailSchema,
  ChangeSchema,
  type ChangeInput,
  type ChangeOut,
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
  EMAIL_SYSTEM,
  paragraphsBlock,
  changeQuestion
} from './prompts'

export interface AiProvider {
  readonly kind: 'anthropic' | 'vllm' | 'none'
  intent(input: IntentInput): Promise<IntentOut>
  overrides(input: OverridesInput): Promise<OverridesOut>
  position(input: PositionInput): Promise<PositionOut>
  change(input: ChangeInput): Promise<ChangeOut>
}

/** A change review is replayed by the contract and the change; the playbook and history it was given are context. */
export const changeKey = (input: ChangeInput) => ({ contract: input.contract, change: input.change })

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

  change(input: ChangeInput): Promise<ChangeOut> {
    return this.structured(
      ChangeSchema,
      DOCUMENT_SYSTEM,
      [
        { type: 'text', text: paragraphsBlock(input.contract), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: changeQuestion(input) }
      ],
      'medium'
    )
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
// vLLM (OpenAI-compatible API), e.g. a model served on the local network
// ---------------------------------------------------------------------------

export interface VllmServer {
  /** e.g. http://192.168.1.20:8000 (with or without /v1). */
  url: string
  model: string
  apiKey?: string | null
}

/** The server's /v1 base, however the address was typed. */
export const vllmBase = (url: string) => {
  const u = url.trim().replace(/\/+$/, '')
  return /\/v1$/.test(u) ? u : `${u}/v1`
}

/** The models a vLLM server is serving (GET /v1/models). */
export async function vllmModels(server: Pick<VllmServer, 'url' | 'apiKey'>): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(`${vllmBase(server.url)}/models`, { headers: server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}, signal: AbortSignal.timeout(8000) })
  } catch (e) {
    throw new Error(`Couldn't reach the vLLM server at ${server.url} (${e instanceof Error ? e.message : String(e)}).`)
  }
  if (!res.ok) throw new Error(`The vLLM server answered ${res.status} ${res.statusText}.`)
  const body = (await res.json()) as { data?: { id: string }[] }
  return (body.data ?? []).map((m) => m.id)
}

/** The JSON Schema sent to vLLM for a task's answer: the full schema (vLLM enforces it as written). */
export function vllmSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = zod.toJSONSchema(schema, { reused: 'ref' }) as Record<string, unknown>
  return rest
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * The AI on a vLLM server, through its OpenAI-compatible chat API. Every task asks for JSON
 * matching the task's schema: the schema goes in `response_format` and vLLM's structured
 * output constrains the answer to it. The answer is then validated against the full Zod schema
 * in code, as with Claude, so nothing malformed is used.
 */
export class VllmProvider implements AiProvider {
  readonly kind = 'vllm' as const
  constructor(private server: VllmServer) {}

  private async post(body: Record<string, unknown>): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${vllmBase(this.server.url)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.server.apiKey ? { Authorization: `Bearer ${this.server.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.server.model, ...body }),
        signal: AbortSignal.timeout(300_000)
      })
    } catch (e) {
      throw new Error(`Couldn't reach the vLLM server at ${this.server.url} (${e instanceof Error ? e.message : String(e)}).`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`The vLLM server answered ${res.status}: ${text.slice(0, 300) || res.statusText}`)
    }
    return res
  }

  private async structured<S extends z.ZodType>(name: string, schema: S, system: string, user: string): Promise<z.infer<S>> {
    const res = await this.post({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ] satisfies Msg[],
      temperature: 0,
      max_tokens: 8000,
      response_format: { type: 'json_schema', json_schema: { name, schema: vllmSchema(schema), strict: true } }
    })
    const body = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] }
    const choice = body.choices?.[0]
    if (choice?.message?.refusal) throw new AiRefusalError('The model declined this request.')
    if (choice?.finish_reason === 'length') throw new Error('The model response was cut off (max_tokens).')
    let json: unknown
    try {
      // Some models wrap JSON in a code fence even when asked not to.
      json = JSON.parse((choice?.message?.content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    } catch {
      throw new Error('The model returned output that was not valid JSON.')
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new Error(`The model returned output that did not match the expected schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    return parsed.data
  }

  intent(input: IntentInput): Promise<IntentOut> {
    return this.structured('intent_check', IntentSchema, INTENT_SYSTEM, intentUser(input))
  }
  overrides(input: OverridesInput): Promise<OverridesOut> {
    return this.structured('overrides', OverridesSchema, DOCUMENT_SYSTEM, `${contractBlock(input.clauses)}\n\n${OVERRIDES_QUESTION}`)
  }
  position(input: PositionInput): Promise<PositionOut> {
    return this.structured('position', PositionSchema, DOCUMENT_SYSTEM, `${contractBlock(input.clauses)}\n\n${positionQuestion(input)}`)
  }
  change(input: ChangeInput): Promise<ChangeOut> {
    return this.structured('change_review', ChangeSchema, DOCUMENT_SYSTEM, `${paragraphsBlock(input.contract)}\n\n${changeQuestion(input)}`)
  }

  /** A chat reply, streamed as it's written (server-sent events). */
  async chat(system: string, history: ChatMessage[], onDelta: (t: string) => void): Promise<string> {
    const res = await this.post({
      messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))] satisfies Msg[],
      temperature: 0.3,
      max_tokens: 2000,
      stream: true
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let out = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return out
        try {
          const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content
          if (delta) {
            out += delta
            onDelta(delta)
          }
        } catch {
          // a keep-alive or partial line
        }
      }
    }
    return out
  }
}

/** No AI configured: every AI step says what's missing; everything else still works. */
export const noAiProvider = (why: string): AiProvider => {
  const fail = () => Promise.reject(new Error(why))
  return { kind: 'none', intent: fail, overrides: fail, position: fail, change: fail }
}

// ---------------------------------------------------------------------------
// Recording
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

/** With recording on, every successful answer is saved, keyed by its task and input (for offline replay and evaluation). */
export class RecordingProvider implements AiProvider {
  readonly kind: AiProvider['kind']
  constructor(private inner: AiProvider, private store: RecordingStore) {
    this.kind = inner.kind
  }

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
  change(input: ChangeInput) {
    return this.rec('change', changeKey(input), () => this.inner.change(input))
  }
}
