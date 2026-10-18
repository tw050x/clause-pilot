import type { AiQuestion, AiTaskKind, AiTaskRun, QuestionData, QuestionMethod } from './types'

/**
 * The questions that can be asked of highlighted text: how each is asked, and what can be sent
 * with it. Shared by the Questions page (to describe them) and the review (to offer them).
 */

export const METHODS: { id: QuestionMethod; label: string; detail: string; fixed: QuestionData[] }[] = [
  { id: 'once', label: 'Once, about the highlight', detail: 'One request. Answered in writing, or as findings with suggested wording.', fixed: [] },
  {
    id: 'paragraphs',
    label: 'For each paragraph, against our approved wording',
    detail: 'One request per highlighted paragraph we have approved wording for. A paragraph the AI finds means the same is marked so in the review. Offered when the highlight has such a paragraph.',
    fixed: ['paragraphs', 'library']
  },
  { id: 'positions', label: 'For each playbook position', detail: 'One request per standard position that applies to the contract, about the highlighted paragraphs (or the whole contract).', fixed: ['paragraphs', 'playbook'] },
  {
    id: 'changes',
    label: 'For each of their changes',
    detail: 'One request per change of theirs in the highlight, read against the whole contract. The answer is kept on the change too. Offered when the highlight has open changes.',
    fixed: ['contract', 'changes']
  }
]

export const methodOf = (id: QuestionMethod) => METHODS.find((m) => m.id === id)!

export const DATA: { id: QuestionData; label: string; detail: string }[] = [
  { id: 'contract', label: 'The whole contract', detail: 'Every paragraph as it reads now.' },
  { id: 'paragraphs', label: 'The highlighted paragraphs', detail: 'In full, not just the highlighted words.' },
  { id: 'changes', label: 'Their changes', detail: 'Each change of theirs in the highlight, before and after, with their comments.' },
  { id: 'edits', label: 'Our edits', detail: 'The wording we have changed so far.' },
  { id: 'library', label: 'Our approved clauses', detail: 'The closest approved clauses to the highlighted paragraphs.' },
  { id: 'playbook', label: 'Our playbook', detail: 'The standard positions that apply to this kind of contract.' },
  { id: 'precedents', label: 'Precedents', detail: 'How we answered the same or similar changes before.' },
  { id: 'findings', label: 'Other answers', detail: 'What the other questions found in this review.' }
]

/** The question a run asked (runs from before questions were editable name a built-in by kind). */
export const questionIdOf = (r: AiTaskRun) => r.questionId ?? r.kind ?? ''

/**
 * The questions the app starts with. Their prompts are written out in the main process
 * (DEFAULT_PROMPTS); `defaultQuestions` fills them in.
 */
export const DEFAULTS: Omit<AiQuestion, 'prompt'>[] = [
  { id: 'intent', origin: 'intent', title: 'Does the intent match?', detail: 'Compares it with our approved wording', method: 'paragraphs', data: ['paragraphs', 'library'], answer: 'findings', priority: true },
  { id: 'playbook', origin: 'playbook', title: 'Does it meet our playbook?', detail: 'Each standard position that applies', method: 'positions', data: ['paragraphs', 'playbook'], answer: 'findings', priority: true },
  { id: 'changes', origin: 'changes', title: 'What do their changes do?', detail: 'Who they favour, and what to do', method: 'changes', data: ['contract', 'changes', 'playbook', 'precedents'], answer: 'findings', priority: true },
  { id: 'explain', origin: 'explain', title: 'What does this mean?', detail: 'In plain English: what it means for us', method: 'once', data: ['contract', 'changes', 'edits', 'findings'], answer: 'text', priority: true }
]

export const defaultQuestions = (prompts: Record<AiTaskKind, string>): AiQuestion[] => DEFAULTS.map((q) => ({ ...q, prompt: prompts[q.origin!] }))
