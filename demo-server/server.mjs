// Clause Pilot demo server: stands in for the AI when the app is in demo mode.
//
// It speaks the OpenAI-compatible API a vLLM server does (the app connects to it as it would to
// one), so demos run the app's real code end to end, with answers from here instead of a model.
// The app starts it itself in demo mode (startDemoServer, from the main process); it also runs on
// its own, with no dependencies:  node demo-server/server.mjs   (PORT=4321; npm run demo:server)
//
// Each request is logged (one line: what was asked, how much) so a demo can be followed.

import http from 'node:http'
import https from 'node:https'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Recordings } from './recordings.mjs'

const PORT = Number(process.env.PORT ?? 4321)
const MODEL = 'clause-pilot-demo'
/**
 * How long a real model would take, so a demo runs at a believable pace: the request read in
 * first (prefill, PREFILL tokens a second, one request at a time, as on one GPU, so requests sent
 * together wait for each other), then the answer written (DECODE tokens a second, with THINK
 * tokens of reasoning first). A mid-length contract's review takes some minutes, as it would.
 * DEMO_SPEED scales it all (2: twice as fast; 0: no waiting); DEMO_DELAY instead waits that many
 * milliseconds for every answer.
 */
const SPEED = Number(process.env.DEMO_SPEED ?? 1)
const PREFILL = 800
const DECODE = 25
const THINK = 120
let gpuFreeAt = 0
/**
 * Quick: answers come almost at once (the app sets it while it plans the demo's reviews in bulk,
 * when the demo workspace is made, so they're ready in seconds rather than minutes).
 */
let quick = false
export function setQuick(on) {
  quick = !!on
}
async function modelTime(promptChars, answerChars) {
  if (quick) return sleep(150)
  if (process.env.DEMO_DELAY !== undefined) return sleep(Number(process.env.DEMO_DELAY))
  if (!(SPEED > 0)) return
  const prefill = ((promptChars / 4) / PREFILL) * 1000 / SPEED
  const start = Math.max(Date.now(), gpuFreeAt)
  gpuFreeAt = start + prefill
  const decode = ((THINK + answerChars / 4) / DECODE) * 1000 / SPEED
  return sleep(gpuFreeAt - Date.now() + decode)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

/** The contract's paragraphs as the app sends them: <p id="…" number="…">text</p>. */
const paragraphs = (text) =>
  [...text.matchAll(/<p id="([^"]+)"(?: number="([^"]*)")?( heading="yes")?>([^\n]*)<\/p>/g)].map((m) => ({ id: m[1], number: m[2] || '', heading: !!m[3], text: m[4] }))

/**
 * The contract's structure: each heading its own part (skipped), the signature block skipped,
 * each numbered paragraph a clause checked in full, the rest read for language.
 */
function structure(user) {
  const parts = paragraphs(user).map((p, i) =>
    p.heading
      ? { title: p.text.slice(0, 60), kind: 'heading', depth: 'skip', reason: 'A heading on its own.', paragraph_ids: [p.id] }
      : /^\s*(signed|signature)/i.test(p.text)
        ? { title: 'Signature block', kind: 'signature', depth: 'skip', reason: 'Names and signatures only.', paragraph_ids: [p.id] }
        : p.number
          ? { title: `Clause ${p.number.replace(/\.$/, '')}`, kind: 'clause', depth: 'full', reason: 'Rights and obligations.', paragraph_ids: [p.id] }
          : { title: i === 0 ? 'Parties' : `Paragraph ${i + 1}`, kind: i === 0 ? 'parties' : 'other', depth: 'light', reason: 'Introductory or general wording.', paragraph_ids: [p.id] }
  )
  return { parts, injection_suspected: false, injection_notes: '' }
}

/**
 * An answer in the shape of any JSON Schema the app sends: every field present, lists empty,
 * the first of any choice. Valid, if not very interesting: the demo's real answers come later.
 */
function fill(node, key = '') {
  if (!node || typeof node !== 'object') return null
  if (node.enum) return node.enum[0]
  if (node.const !== undefined) return node.const
  if (node.anyOf) return fill(node.anyOf[0], key)
  const type = Array.isArray(node.type) ? node.type[0] : node.type
  if (type === 'object') return Object.fromEntries(Object.entries(node.properties ?? {}).map(([k, v]) => [k, fill(v, k)]))
  if (type === 'array') return []
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return 0
  if (type === 'null') return null
  if (key === 'injection_notes') return ''
  if (key === 'compared_with') return 'none'
  return key === 'summary' || key === 'body' || key === 'subject' ? `Demo ${key}.` : ''
}

const answers = {
  contract_structure: structure
}

/** Real answers recorded from a model (recordings.mjs): replayed, or recorded with DEMO_RECORD. */
const RECORD = process.env.DEMO_RECORD?.replace(/\/+$/, '')
const RECORD_MODEL = process.env.DEMO_RECORD_MODEL
let recordings = new Recordings(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'demo-recordings'))

/** A POST with no time limit (the model takes as long as it takes). */
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 0 }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (text += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** A structured request answered by the model, and recorded (DEMO_RECORD). */
async function record(body, name, user) {
  const t0 = Date.now()
  // A reasoning model thinks first, and that counts against max_tokens: room for it. (Not fetch:
  // it gives up after five minutes without an answer, and a long think can take longer.)
  // Thinking off (DEMO_RECORD_THINKING=on to allow it): a reasoning model left to think can go round
  // in circles until it runs out of tokens, and asking it to think less doesn't stop it.
  const effort = process.env.DEMO_RECORD_THINKING === 'on' ? 'thinking' : 'no thinking'
  const thinking = process.env.DEMO_RECORD_THINKING === 'on' ? {} : { chat_template_kwargs: { thinking: false, enable_thinking: false } }
  const { status, text } = await post(`${RECORD}/chat/completions`, JSON.stringify({ ...body, model: RECORD_MODEL ?? body.model, max_tokens: Math.max(body.max_tokens ?? 0, 12000), ...thinking }))
  if (status >= 400) throw new Error(`The model answered ${status}: ${text.slice(0, 300)}`)
  const out = JSON.parse(text)
  const content = out.choices?.[0]?.message?.content ?? ''
  if (out.choices?.[0]?.finish_reason === 'stop' && content) {
    const { key, contractKey, question } = Recordings.keyOf(name, user)
    recordings.add({ name, key, contractKey, question, content, usage: out.usage, ms: Date.now() - t0, model: out.model, effort, recordedAt: new Date().toISOString() })
  }
  if (out.choices?.[0]?.finish_reason === 'length') throw new Error('it ran out of tokens thinking')
  return { content, usage: out.usage, finish: out.choices?.[0]?.finish_reason ?? 'stop', ms: Date.now() - t0 }
}

function structured(body) {
  const name = body.response_format?.json_schema?.name ?? 'answer'
  const schema = body.response_format?.json_schema?.schema ?? {}
  const user = String(body.messages?.at(-1)?.content ?? '')
  const out = answers[name] ? answers[name](user, schema) : fill(schema)
  return { name, user, out }
}

const usage = (prompt, completion) => ({ prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(completion.length / 4) })

const handler = (req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const path = (req.url ?? '').replace(/\?.*$/, '')
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET' && (path === '/health' || path === '/v1/health')) return res.end(JSON.stringify({ ok: true, model: MODEL }))
      if (req.method === 'GET' && path === '/v1/models') {
        log('connected: models listed')
        return res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'clause-pilot-demo' }] }))
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        let body
        try {
          body = JSON.parse(raw)
        } catch {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: { message: 'Not JSON.' } }))
        }
        // The Agent's chat: streamed, as a model would.
        if (body.stream) {
          const question = String(body.messages?.at(-1)?.content ?? '')
          log(`chat: ${question.replace(/\s+/g, ' ').slice(0, 80)}`)
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const words = 'This is the demo server answering. In a demo, the Agent’s answers come from here rather than from a model.'.split(' ')
          for (const w of words) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' } }] })}\n\n`)
            await sleep(40)
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
          res.write(`data: ${JSON.stringify({ choices: [], usage: usage(raw, words.join(' ')) })}\n\n`)
          return res.end('data: [DONE]\n\n')
        }
        // A structured answer: recorded from the model (DEMO_RECORD), a recorded one replayed, or
        // (none recorded for it) one in the shape asked for.
        const name = body.response_format?.json_schema?.name ?? 'answer'
        const user = String(body.messages?.at(-1)?.content ?? '')
        const t0 = Date.now()
        // Recording: what's recorded already is replayed (a run started again picks up where it was).
        const known = RECORD ? recordings.find(name, user, true) : null
        if (RECORD && !known) {
          try {
            const r = await record(body, name, user)
            log(`${name}: recorded from the model (${(r.ms / 1000).toFixed(1)}s)`)
            return res.end(JSON.stringify({ choices: [{ message: { content: r.content }, finish_reason: r.finish }], usage: r.usage }))
          } catch (e) {
            log(`${name}: the model failed: ${e.message}`)
            res.statusCode = 502
            return res.end(JSON.stringify({ error: { message: String(e.message) } }))
          }
        }
        const hit = known ?? recordings.find(name, user)
        if (hit) {
          // As long as the model took (quicker when told: the plans made in bulk, DEMO_SPEED).
          await (quick || RECORD ? sleep(50) : SPEED > 0 && process.env.DEMO_DELAY === undefined ? sleep(hit.ms / SPEED) : modelTime(raw.length, hit.content.length))
          log(`${name}: replayed (${hit.how}) from ${hit.model} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
          return res.end(JSON.stringify({ choices: [{ message: { content: hit.content }, finish_reason: 'stop' }], usage: hit.usage ?? usage(raw, hit.content) }))
        }
        const { out } = structured(body)
        const content = JSON.stringify(out)
        await modelTime(raw.length, content.length)
        log(`${name}: none recorded; answered in shape (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
        return res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: usage(raw, content) }))
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: `Not here: ${req.method} ${path}` } }))
    })
}

/**
 * Start the demo server on 127.0.0.1 (the app calls this in demo mode). Resolves once it's
 * listening; if the port is already taken (the server already running, started by hand), resolves
 * with { existing: true } and that one is used.
 */
export function startDemoServer({ port = PORT, onLog, recordingsDir } = {}) {
  if (onLog) log = onLog
  // The app's own copy (bundled, it can't find them from here).
  if (recordingsDir) recordings = new Recordings(recordingsDir)
  log(`${recordings.all.length} recorded answers${RECORD ? `; recording from ${RECORD_MODEL ?? 'the model'} at ${RECORD}` : ''}`)
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve({ existing: true, port, close: () => {} }) : reject(e)))
    server.listen(port, '127.0.0.1', () => {
      log(`Clause Pilot demo server on http://127.0.0.1:${port} (model ${MODEL})`)
      resolve({ existing: false, port, close: () => server.close() })
    })
  })
}

// Run on its own (node demo-server/server.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void startDemoServer()
