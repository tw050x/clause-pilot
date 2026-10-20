// Real answers for the demo: recorded from a real model, then replayed.
//
// Recording (DEMO_RECORD=<OpenAI-compatible base URL, e.g. http://host:8000/v1> and
// DEMO_RECORD_MODEL=<model>): each structured request the app makes is sent to that model, and
// its answer (with how long it took and what it used) is saved under data/demo-recordings.
// Replaying (otherwise): a request is answered with the recorded answer to the same request. The
// same request means the same task, the same contract and the same question once what changes
// from run to run is taken out (ids made at random, times); failing that, the closest recorded
// question for the same task and contract. Ids in the recorded answer are swapped for this
// run's, so an answer naming a finding or a part names the right one.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Ids made at random by the app (a part, a finding, a proposal…; a paragraph we added). */
const ID = /\b(?:[a-z]+-[a-z0-9]{10,}|n[a-z0-9]{10,})\b/g
const TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g
const norm = (t) => t.replace(ID, '#').replace(TIME, '@').replace(/\s+/g, ' ').trim()
const hash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 24)

/** The contract and the question in a request's last message (the app sends "<contract>…</contract>\n\n<question>"). */
export function split(user) {
  const at = user.indexOf('</contract>')
  if (at < 0) return { contract: '', question: user }
  return { contract: user.slice(0, at + '</contract>'.length), question: user.slice(at + '</contract>'.length) }
}

const words = (t) => new Set(norm(t).toLowerCase().split(/[^a-z0-9#@§.]+/).filter((w) => w.length > 2))
const likeness = (a, b) => {
  let both = 0
  for (const w of a) if (b.has(w)) both++
  return both / Math.max(1, a.size + b.size - both)
}

export class Recordings {
  constructor(dir) {
    this.dir = dir
    this.all = []
    this.byKey = new Map()
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl')))
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n'))
        if (line.trim()) this.add(JSON.parse(line), false)
  }

  add(r, save = true) {
    r.words ??= [...words(r.question)]
    const wordSet = new Set(r.words)
    const entry = { ...r, wordSet }
    this.all.push(entry)
    this.byKey.set(r.key, entry)
    if (save) {
      mkdirSync(this.dir, { recursive: true })
      const { wordSet: _w, words: _x, ...stored } = entry
      appendFileSync(join(this.dir, `${r.name}.jsonl`), JSON.stringify(stored) + '\n')
    }
  }

  /** The key of a request: its task, its contract and its question, what changes from run to run taken out. */
  static keyOf(name, user) {
    const { contract, question } = split(user)
    return { key: hash(`${name}\n${norm(contract)}\n${norm(question)}`), contractKey: hash(norm(contract)), question }
  }

  /** The recorded answer to this request (or the closest for the same task and contract), its ids made this run's. */
  find(name, user, exactOnly = false) {
    const { key, contractKey, question } = Recordings.keyOf(name, user)
    let hit = this.byKey.get(key)
    let how = 'exact'
    if (!hit && exactOnly) return null
    if (!hit) {
      const mine = words(question)
      let best = 0
      for (const r of this.all) {
        if (r.name !== name || r.contractKey !== contractKey) continue
        const l = likeness(mine, r.wordSet)
        if (l > best) ((best = l), (hit = r))
      }
      if (best < 0.75) return null
      how = `closest (${Math.round(best * 100)}%)`
    }
    // The recorded question's ids, in order, are this question's.
    const was = hit.question.match(ID) ?? []
    const now = question.match(ID) ?? []
    const map = new Map()
    was.forEach((id, i) => now[i] && !map.has(id) && map.set(id, now[i]))
    const content = map.size ? hit.content.replace(ID, (id) => map.get(id) ?? id) : hit.content
    return { ...hit, content, how }
  }
}
