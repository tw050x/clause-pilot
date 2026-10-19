// Clause Pilot demo server: stands in for the AI when the app is in demo mode.
//
// It speaks the OpenAI-compatible API a vLLM server does (the app connects to it as it would to
// one), so demos run the app's real code end to end, with answers from here instead of a model.
// No dependencies:  node demo-server/server.mjs   (PORT=4321 by default; npm run demo:server)
//
// Each request is logged (one line: what was asked, how much) so a demo can be followed here.

import http from 'node:http'

const PORT = Number(process.env.PORT ?? 4321)
const MODEL = 'clause-pilot-demo'
/** A little delay, so the app's progress (spinners, the review's timeline) is visible. */
const DELAY = Number(process.env.DEMO_DELAY ?? 500)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

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

function structured(body) {
  const name = body.response_format?.json_schema?.name ?? 'answer'
  const schema = body.response_format?.json_schema?.schema ?? {}
  const user = String(body.messages?.at(-1)?.content ?? '')
  const out = answers[name] ? answers[name](user, schema) : fill(schema)
  return { name, user, out }
}

const usage = (prompt, completion) => ({ prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(completion.length / 4) })

http
  .createServer((req, res) => {
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
        // A structured answer, in the shape asked for.
        const { name, user, out } = structured(body)
        const content = JSON.stringify(out)
        log(`${name}: asked ${user.length} chars, answered ${content.length}`)
        await sleep(DELAY)
        return res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: usage(raw, content) }))
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: `Not here: ${req.method} ${path}` } }))
    })
  })
  .listen(PORT, '127.0.0.1', () => log(`Clause Pilot demo server on http://127.0.0.1:${PORT} (model ${MODEL})`))
