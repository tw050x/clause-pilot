import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { AuditEntry } from '@shared/types'
import { sha256 } from './engine/text'

const GENESIS = '0'.repeat(64)

/**
 * Append-only, hash-chained audit log (JSON Lines). Each entry commits to the
 * previous one, so editing or deleting history breaks the chain and `verify()`
 * reports where.
 */
export class AuditLog {
  private last: { seq: number; hash: string }

  constructor(private file: string) {
    const entries = this.all()
    const tail = entries[entries.length - 1]
    this.last = tail ? { seq: tail.seq, hash: tail.hash } : { seq: 0, hash: GENESIS }
  }

  append(actor: string, type: string, sessionId: string | null, payload: Record<string, unknown>): AuditEntry {
    const base = { seq: this.last.seq + 1, ts: new Date().toISOString(), actor, type, sessionId, payload, prevHash: this.last.hash }
    const entry: AuditEntry = { ...base, hash: sha256(JSON.stringify(base)) }
    appendFileSync(this.file, JSON.stringify(entry) + '\n')
    this.last = { seq: entry.seq, hash: entry.hash }
    return entry
  }

  all(): AuditEntry[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEntry)
  }

  forSession(sessionId: string): AuditEntry[] {
    return this.all().filter((e) => e.sessionId === sessionId)
  }

  verify(): { ok: boolean; entries: number; brokenAt?: number } {
    let prev = GENESIS
    const entries = this.all()
    for (const e of entries) {
      const { hash, ...base } = e
      if (e.prevHash !== prev || sha256(JSON.stringify(base)) !== hash) return { ok: false, entries: entries.length, brokenAt: e.seq }
      prev = hash
    }
    return { ok: true, entries: entries.length }
  }
}
