import { z } from 'zod'
import type { AiQuestion, LibraryClause, PlaybookPosition } from '@shared/types'

/**
 * Import and export of the knowledge base: the library of approved clauses, the playbook of
 * standard positions and the questions asked of highlighted text, as JSON files another team
 * (or another machine) can import.
 *
 *   { "format": "clause-pilot/library",   "version": 1, "exportedAt": …, "exportedBy": …, "clauses":   [ … ] }
 *   { "format": "clause-pilot/playbook",  "version": 1, "exportedAt": …, "exportedBy": …, "positions": [ … ] }
 *   { "format": "clause-pilot/questions", "version": 1, "exportedAt": …, "exportedBy": …, "questions": [ … ] }
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

export const QuestionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(''),
  prompt: z.string().min(1),
  method: z.enum(['once', 'paragraphs', 'positions', 'changes']).default('once'),
  data: z.array(z.enum(['contract', 'paragraphs', 'changes', 'edits', 'library', 'playbook', 'precedents', 'findings'])).default([]),
  answer: z.enum(['text', 'findings']).default('text'),
  schema: z.record(z.string(), z.unknown()).optional(),
  priority: z.boolean().optional(),
  /** Files exported before questions were prioritised: shown ones were cards. */
  shown: z.boolean().optional(),
  origin: z.enum(['intent', 'playbook', 'changes', 'explain']).optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional()
})

export const QuestionsFileSchema = z.object({
  format: z.literal('clause-pilot/questions'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  exportedBy: z.string().optional(),
  questions: z.array(QuestionSchema.transform(({ shown, priority, ...q }) => ({ ...q, priority: priority ?? shown ?? false })))
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
export const questionsFile = (questions: AiQuestion[], by: string) => ({ format: 'clause-pilot/questions' as const, version: 1 as const, exportedAt: new Date().toISOString(), exportedBy: by, questions })
export const playbookFile = (positions: PlaybookPosition[], by: string) => ({ format: 'clause-pilot/playbook' as const, version: 1 as const, exportedAt: new Date().toISOString(), exportedBy: by, positions })

const problems = (e: z.ZodError) =>
  e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`)
    .join('; ')

/** Read an import file (or a bare array of entries) into validated entries. */
export type KnowledgeKind = 'library' | 'playbook' | 'questions'
const LIST = { library: 'clauses', playbook: 'positions', questions: 'questions' } as const
const FILE = { library: LibraryFileSchema, playbook: PlaybookFileSchema, questions: QuestionsFileSchema }

export function parseImport<T>(kind: KnowledgeKind, raw: string): T[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  if (Array.isArray(json)) json = { format: `clause-pilot/${kind}`, version: 1, [LIST[kind]]: json }
  const fmt = (json as { format?: unknown })?.format
  if (fmt && fmt !== `clause-pilot/${kind}`) throw new Error(`That's a ${String(fmt).replace('clause-pilot/', '')} file, not a ${kind} file.`)
  const r = FILE[kind].safeParse(json)
  if (!r.success) throw new Error(`That isn't a valid ${kind} file: ${problems(r.error)}`)
  return (r.data as Record<string, unknown>)[LIST[kind]] as T[]
}

export interface ImportResult {
  added: number
  updated: number
  unchanged: number
}

/** JSON with keys in order, so the same entry written in a different key order compares equal. */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v)
const same = (a: unknown, b: unknown) => canon(a) === canon(b)

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

/** Merge imported questions by id (new ones go at the end); a changed question is marked as updated now. */
export function mergeQuestions(current: AiQuestion[], incoming: AiQuestion[], by: string): { next: AiQuestion[]; result: ImportResult } {
  const next = [...current]
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0 }
  const at = new Date().toISOString()
  const content = ({ updatedBy: _b, updatedAt: _a, ...q }: AiQuestion) => q
  for (const q of incoming) {
    const i = next.findIndex((x) => x.id === q.id)
    if (i < 0) {
      next.push({ ...q, updatedBy: by, updatedAt: at })
      result.added++
    } else if (same(content(next[i]), content(q))) result.unchanged++
    else {
      next[i] = { ...q, updatedBy: by, updatedAt: at }
      result.updated++
    }
  }
  return { next, result }
}
