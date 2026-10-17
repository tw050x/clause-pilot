import { z } from 'zod'
import type { LibraryClause, PlaybookPosition } from '@shared/types'

/**
 * Import and export of the knowledge base: the library of approved clauses and the playbook
 * of standard positions, as JSON files another team (or another machine) can import.
 *
 *   { "format": "clause-pilot/library",  "version": 1, "exportedAt": …, "exportedBy": …, "clauses":   [ … ] }
 *   { "format": "clause-pilot/playbook", "version": 1, "exportedAt": …, "exportedBy": …, "positions": [ … ] }
 *
 * Imports are validated against these schemas and merged by id: new entries are added,
 * entries with the same id are updated (playbook positions get a new version), identical
 * ones are left alone. Nothing is ever removed by an import.
 */

const contractType = z.enum(['nda', 'order-form', 'general'])

export const LibraryClauseSchema = z.object({
  id: z.string().min(1),
  contractType: contractType.default('general'),
  category: z.string().default('General'),
  title: z.string().min(1),
  text: z.string().min(1),
  approvedBy: z.string().default('Imported'),
  approvedOn: z.string().default(() => new Date().toISOString().slice(0, 10))
})

export const PlaybookPositionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  appliesTo: z.array(contractType).default(['nda', 'order-form']),
  standard: z.string().min(1),
  acceptableFallback: z.string().default(''),
  redFlags: z.array(z.string()).default([]),
  version: z.number().int().positive().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional()
})

export const LibraryFileSchema = z.object({
  format: z.literal('clause-pilot/library'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  exportedBy: z.string().optional(),
  clauses: z.array(LibraryClauseSchema)
})

export const PlaybookFileSchema = z.object({
  format: z.literal('clause-pilot/playbook'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  exportedBy: z.string().optional(),
  positions: z.array(PlaybookPositionSchema)
})

export const libraryFile = (clauses: LibraryClause[], by: string) => ({ format: 'clause-pilot/library' as const, version: 1 as const, exportedAt: new Date().toISOString(), exportedBy: by, clauses })
export const playbookFile = (positions: PlaybookPosition[], by: string) => ({ format: 'clause-pilot/playbook' as const, version: 1 as const, exportedAt: new Date().toISOString(), exportedBy: by, positions })

const problems = (e: z.ZodError) =>
  e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`)
    .join('; ')

/** Read an import file (or a bare array of entries) into validated entries. */
export function parseImport<T>(kind: 'library' | 'playbook', raw: string): T[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  if (Array.isArray(json)) json = kind === 'library' ? { format: 'clause-pilot/library', version: 1, clauses: json } : { format: 'clause-pilot/playbook', version: 1, positions: json }
  const fmt = (json as { format?: unknown })?.format
  if (fmt && fmt !== `clause-pilot/${kind}`) throw new Error(`That's a ${String(fmt).replace('clause-pilot/', '')} file, not a ${kind} file.`)
  if (kind === 'library') {
    const r = LibraryFileSchema.safeParse(json)
    if (!r.success) throw new Error(`That isn't a valid library file: ${problems(r.error)}`)
    return r.data.clauses as T[]
  }
  const r = PlaybookFileSchema.safeParse(json)
  if (!r.success) throw new Error(`That isn't a valid playbook file: ${problems(r.error)}`)
  return r.data.positions as T[]
}

export interface ImportResult {
  added: number
  updated: number
  unchanged: number
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Merge imported clauses into the library by id. */
export function mergeLibrary(current: LibraryClause[], incoming: LibraryClause[]): { next: LibraryClause[]; result: ImportResult } {
  const next = [...current]
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0 }
  for (const c of incoming) {
    const i = next.findIndex((x) => x.id === c.id)
    if (i < 0) {
      next.push(c)
      result.added++
    } else if (same(next[i], c)) result.unchanged++
    else {
      next[i] = c
      result.updated++
    }
  }
  return { next, result }
}

/** Merge imported positions into the playbook by id; a changed position gets the next version. */
export function mergePlaybook(current: PlaybookPosition[], incoming: PlaybookPosition[], by: string): { next: PlaybookPosition[]; result: ImportResult } {
  const next = [...current]
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0 }
  const at = new Date().toISOString()
  const content = (p: PlaybookPosition) => ({ title: p.title, appliesTo: p.appliesTo, standard: p.standard, acceptableFallback: p.acceptableFallback, redFlags: p.redFlags })
  for (const p of incoming) {
    const i = next.findIndex((x) => x.id === p.id)
    if (i < 0) {
      next.push({ ...p, version: p.version ?? 1, updatedBy: by, updatedAt: at })
      result.added++
    } else if (same(content(next[i]), content(p))) result.unchanged++
    else {
      next[i] = { ...p, version: (next[i].version ?? 1) + 1, updatedBy: by, updatedAt: at }
      result.updated++
    }
  }
  return { next, result }
}
