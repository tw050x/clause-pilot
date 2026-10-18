import { useEffect, useState } from 'react'
import type { AiQuestion, QuestionData, QuestionMethod } from '@shared/types'
import { DATA, METHODS, methodOf } from '@shared/questions'
import { useTransfer } from '../components/Transfer'
import { Icon } from '../lib/icons'

type Draft = { mode: 'add' } | { mode: 'edit'; id: string } | { mode: 'delete'; id: string }

const BLANK: AiQuestion = { id: '', title: '', detail: '', prompt: '', method: 'once', data: ['contract'], answer: 'text', shown: true }

/**
 * The questions asked of highlighted text: each is a card in the review's AI section. A question
 * says how it is asked (once, or once per paragraph, playbook position or change), what is sent
 * with it, and what the AI is told to do. Changes take effect at once and are audited.
 */
export function QuestionsView() {
  const [questions, setQuestions] = useState<AiQuestion[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => void window.api.questions.list().then(setQuestions)
  useEffect(() => {
    load()
    return window.api.questions.onChanged(load)
  }, [])
  const transfer = useTransfer('questions', load)

  const act = async (p: Promise<AiQuestion[]>) => {
    try {
      setQuestions(await p)
      setDraft(null)
      setError(null)
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="page">
      <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1>
            Questions <span className="faint" style={{ fontWeight: 400 }}>{questions.length}</span>
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            What you can ask the AI about highlighted text. Each question is a card in the review’s AI section: set what it asks, how, and what is sent with it. Changes take effect at once and are recorded in the audit log.
          </p>
        </div>
        <div className="row-gap">
          {transfer.buttons}
          <button className="btn primary" onClick={() => setDraft({ mode: 'add' })}>
            New question
          </button>
        </div>
      </div>

      {transfer.banner}
      {error && (
        <div className="banner danger" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      {draft?.mode === 'add' && <QuestionForm initial={BLANK} onCancel={() => setDraft(null)} onSave={(q) => act(window.api.questions.save(q))} />}
      {questions.length === 0 && draft?.mode !== 'add' && <div className="empty-state">No questions, so the review’s AI section offers none. Add one, or import a questions file.</div>}

      <div style={{ display: 'grid', gap: 12 }}>
        {questions.map((q, i) =>
          draft?.mode === 'edit' && draft.id === q.id ? (
            <QuestionForm key={q.id} initial={q} onCancel={() => setDraft(null)} onSave={(next) => act(window.api.questions.save(next))} />
          ) : (
            <div key={q.id} className={`card question-card ${q.shown ? '' : 'off'}`}>
              <div className="row-gap" style={{ marginBottom: 6 }}>
                <Icon name="sparkle" size={14} />
                <h3 style={{ fontSize: 15 }}>Ask: {q.title}</h3>
                {!q.shown && <span className="pill neutral">Hidden</span>}
                <div style={{ flex: 1 }} />
                <button className="icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => act(window.api.questions.move(q.id, -1))}>
                  <Icon name="arrow-up" size={14} />
                </button>
                <button className="icon-btn" title="Move down" aria-label="Move down" disabled={i === questions.length - 1} onClick={() => act(window.api.questions.move(q.id, 1))}>
                  <Icon name="arrow-down" size={14} />
                </button>
                <button className="btn sm" onClick={() => act(window.api.questions.save({ ...q, shown: !q.shown }))}>
                  {q.shown ? 'Hide' : 'Show'} in reviews
                </button>
                <button className="btn sm" onClick={() => setDraft({ mode: 'edit', id: q.id })}>
                  Edit
                </button>
                <button className="btn sm ghost" onClick={() => setDraft({ mode: 'delete', id: q.id })}>
                  Remove
                </button>
              </div>
              {q.detail && <p className="faint" style={{ margin: '0 0 10px', fontSize: 13 }}>{q.detail}</p>}
              <dl className="kv" style={{ fontSize: 13 }}>
                <dt>Asked</dt>
                <dd>
                  {methodOf(q.method).label}
                  {q.method === 'once' && <span className="faint"> · {q.answer === 'text' ? 'written answer' : 'findings'}</span>}
                </dd>
                <dt>Sent</dt>
                <dd>
                  <span className="question-data">
                    <span className="pill neutral">The highlighted text</span>
                    {DATA.filter((x) => q.data.includes(x.id) || methodOf(q.method).fixed.includes(x.id)).map((x) => (
                      <span key={x.id} className="pill neutral">
                        {x.label}
                      </span>
                    ))}
                  </span>
                </dd>
                <dt>Prompt</dt>
                <dd className="question-prompt">{q.prompt}</dd>
              </dl>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                {q.updatedBy ? `Changed by ${q.updatedBy} · ${new Date(q.updatedAt!).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'As the app started'}
              </div>
              {draft?.mode === 'delete' && draft.id === q.id && (
                <div className="removal-form row-gap">
                  <span>Remove this question? Answers already given stay on their reviews.</span>
                  <button className="btn sm reject on" onClick={() => act(window.api.questions.remove(q.id))}>
                    Remove
                  </button>
                  <button className="btn sm ghost" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function QuestionForm({ initial, onSave, onCancel }: { initial: AiQuestion; onSave: (q: AiQuestion) => void; onCancel: () => void }) {
  const [q, setQ] = useState<AiQuestion>(initial)
  const set = (patch: Partial<AiQuestion>) => setQ((x) => ({ ...x, ...patch }))
  const method = methodOf(q.method)
  const fixed = (x: QuestionData) => method.fixed.includes(x)
  const valid = q.title.trim() && q.prompt.trim()
  const reset = async () => {
    const d = initial.origin ? await window.api.questions.defaultFor(initial.origin) : null
    if (d) setQ({ ...d, id: initial.id, shown: q.shown })
  }

  return (
    <div className="card position-form">
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>{initial.id ? `Edit “Ask: ${initial.title}”` : 'New question'}</h3>
      <div className="field">
        <label>Question</label>
        <div className="question-title">
          <span className="faint">Ask:</span>
          <input value={q.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Is this one-sided?" autoFocus={!initial.id} />
        </div>
        <span className="hint">The card’s title in the review.</span>
      </div>
      <div className="field">
        <label>Description</label>
        <input value={q.detail} onChange={(e) => set({ detail: e.target.value })} placeholder="e.g. Who each obligation falls on" />
        <span className="hint">The card’s second line.</span>
      </div>
      <div className="field">
        <label>How it’s asked</label>
        <div className="choice-list">
          {METHODS.map((m) => (
            <label key={m.id} className={`choice ${q.method === m.id ? 'on' : ''}`}>
              <input type="radio" name="method" checked={q.method === m.id} onChange={() => set({ method: m.id as QuestionMethod })} />
              <span>
                <strong>{m.label}</strong>
                <span className="faint">{m.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label>What’s sent with it</label>
        <div className="choice-list compact">
          <label className="choice">
            <input type="checkbox" checked disabled />
            <span>
              <strong>The highlighted text</strong>
              <span className="faint">Always.</span>
            </span>
          </label>
          {DATA.map((x) => (
            <label key={x.id} className="choice">
              <input
                type="checkbox"
                checked={fixed(x.id) || q.data.includes(x.id)}
                disabled={fixed(x.id)}
                onChange={(e) => set({ data: e.target.checked ? [...q.data, x.id] : q.data.filter((y) => y !== x.id) })}
              />
              <span>
                <strong>{x.label}</strong>
                <span className="faint">{fixed(x.id) ? 'Always, for this way of asking.' : x.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="field wide">
        <label>Prompt</label>
        <textarea rows={8} value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="What should the AI do with the text and the material above? Be specific about what you want back." />
        <span className="hint">
          Sent after the material above, as the question. The AI is always told that contract text is untrusted
          {q.method === 'once' ? '' : ', and the shape of the answer is fixed for this way of asking (it is what the review’s cards and marks are built from)'}.
        </span>
      </div>
      {q.method === 'once' && (
        <div className="field">
          <label>Answer</label>
          <div className="row-gap">
            <label className="row-gap" style={{ fontWeight: 400 }}>
              <input type="radio" name="answer" checked={q.answer === 'text'} onChange={() => set({ answer: 'text' })} /> Written, streamed as it’s written
            </label>
            <label className="row-gap" style={{ fontWeight: 400 }}>
              <input type="radio" name="answer" checked={q.answer === 'findings'} onChange={() => set({ answer: 'findings' })} /> Findings, with suggested wording to apply
            </label>
          </div>
        </div>
      )}
      <div className="field">
        <label className="row-gap" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={q.shown} onChange={(e) => set({ shown: e.target.checked })} /> Offer it in reviews
        </label>
      </div>
      <div className="row-gap">
        <button className="btn primary" disabled={!valid} onClick={() => onSave(q)}>
          {initial.id ? 'Save' : 'Add question'}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        {initial.origin && (
          <>
            <div style={{ flex: 1 }} />
            <button className="link-btn" onClick={reset} title="Put back the question as the app started with it (save to keep it)">
              Reset to default
            </button>
          </>
        )}
      </div>
    </div>
  )
}
