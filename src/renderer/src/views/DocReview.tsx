import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeReview, DocBlock, DocComment, OurComment, ReviewSession, SecurityAlert, SeenHit } from '@shared/types'
import { authorsOf, beforeTheirs, changeSets, ourOtherEdits, segmentsOf, statusOf, theyChanged, type ChangeSet, type SetStatus } from '@shared/changes'
import { diffSegments, overlay, type Mark } from '@shared/diff'
import { Icon } from '../lib/icons'
import { AutoTextarea } from '../lib/AutoTextarea'
import { Redline } from '../components/Redline'
import { EmailModal } from '../components/EmailModal'
import { RedlineModal } from '../components/RedlineModal'
import { OriginalView } from '../components/OriginalView'

interface Props {
  session: ReviewSession
  panel: HTMLElement | null
  onChange: (s: ReviewSession) => void
  alert: SecurityAlert | null
  onOpenSecurity: () => void
  accountName?: string
  contractTitle?: string
  onOpenReview: (id: string) => void
  onNominationsChanged: () => void
}

const STATUS_LABEL: Record<SetStatus, string> = { open: 'To decide', accepted: 'Accepted', countered: 'Answered', flagged: 'For review' }

/**
 * Document review: the contract as written, decorated with their changes and
 * ours. Their changes are grouped into change sets to decide; anything can be
 * edited in place (our edits become a redline) and commented on in the margin.
 * Nothing here calls the AI.
 */
export function DocReview({ session, panel, onChange, alert, onOpenSecurity, accountName, contractTitle, onOpenReview, onNominationsChanged }: Props) {
  const d = session.doc!
  const sets = useMemo(() => changeSets(d), [d])
  const setOf = useMemo(() => new Map(sets.flatMap((s) => s.blocks.map((b) => [b.id, s] as const))), [sets])
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ blockId: string; quote?: string; replyTo?: string; text?: string } | null>(null)
  const [changesOnly, setChangesOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [bubble, setBubble] = useState<{ x: number; y: number; blockId: string; quote: string } | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [redlineOpen, setRedlineOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState<Record<string, SeenHit[]>>({})
  const [original, setOriginal] = useState<{ text: string; label: string } | null>(null)
  const [prefill, setPrefill] = useState<{ blockId: string; text: string } | null>(null)
  const page = useRef<HTMLDivElement>(null)

  // Earlier negotiations change only when other reviews do, so once per review is enough.
  useEffect(() => {
    let live = true
    window.api.doc.seen(session.id).then((x) => live && setSeen(x), () => {})
    return () => {
      live = false
    }
  }, [session.id])

  useEffect(() => {
    setSelected(null)
    setEditing(null)
    setDraft(null)
    setExpanded(new Set())
  }, [session.id])

  const act = async (p: Promise<ReviewSession>) => {
    try {
      onChange(await p)
      setError(null)
      return true
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
      return false
    }
  }

  const scrollTo = (blockId: string) =>
    requestAnimationFrame(() => page.current?.querySelector(`[data-block="${blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  const select = (set: ChangeSet) => {
    setSelected(set.id)
    scrollTo(set.blocks[0].id)
  }
  const nextOpen = () => {
    const open = sets.filter((s) => statusOf(d, s) === 'open')
    if (!open.length) return
    const at = open.findIndex((s) => s.id === selected)
    select(open[(at + 1) % open.length])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === 'n') nextOpen()
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Text selected in a paragraph offers a comment on it.
  const onMouseUp = (b: DocBlock) => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!sel || !text || editing) return setBubble(null)
    const r = sel.getRangeAt(0).getBoundingClientRect()
    setBubble({ x: r.left + r.width / 2, y: r.top, blockId: b.id, quote: text })
  }

  const counts = useMemo(() => {
    const c: Record<SetStatus, number> = { open: 0, accepted: 0, countered: 0, flagged: 0 }
    for (const s of sets) c[statusOf(d, s)]++
    return c
  }, [sets, d])
  const authors = authorsOf(sets.flatMap((s) => s.blocks.filter((b) => !b.untracked)))
  const untrackedSets = sets.filter((s) => s.blocks.some((b) => b.untracked)).length
  const asking = Object.values(d.ai ?? {}).some((x) => x.status === 'running')
  const unasked = sets.filter((s) => statusOf(d, s) === 'open' && d.ai?.[s.id]?.status !== 'done')
  const onHold = alert?.status === 'open'
  const others = ourOtherEdits(d, sets)
  const current = sets.find((s) => s.id === selected) ?? null

  // With "changes only", runs of untouched paragraphs fold into a bar.
  const items = useMemo(() => {
    const out: ({ kind: 'block'; b: DocBlock } | { kind: 'fold'; at: number; count: number })[] = []
    const quiet = (b: DocBlock) => !theyChanged(b) && d.edits[b.id] === undefined && !b.comments?.length && !d.comments.some((c) => c.blockId === b.id)
    d.blocks.forEach((b, i) => {
      const last = out[out.length - 1]
      if (changesOnly && quiet(b) && !expanded.has(i)) {
        if (last?.kind === 'fold') last.count++
        else out.push({ kind: 'fold', at: i, count: 1 })
      } else out.push({ kind: 'block', b })
    })
    return out
  }, [d, changesOnly, expanded])

  const sidebar = (
    <div className="rp">
      <section className="rp-section">
        <div className="rp-doc">
          <Icon name="doc" size={18} />
          <div style={{ minWidth: 0 }}>
            <div className="rp-docname">{session.version ? `${accountName} · ${contractTitle}` : session.docName}</div>
            {session.version && (
              <div className="rp-version">
                Version {session.version}
                {session.previous && (
                  <>
                    {' '}
                    · after{' '}
                    <button className="link" onClick={() => onOpenReview(session.previous!.sessionId)}>
                      version {session.previous.version}
                    </button>
                  </>
                )}
              </div>
            )}
            {session.version && <div className="faint" style={{ fontSize: 12, wordBreak: 'break-word' }}>{session.docName}</div>}
          </div>
        </div>
      </section>

      <section className="rp-section">
        <h4 className="rp-h">
          Their changes
          <span className="faint">{sets.length ? `${sets.length}${authors.length ? ` · ${authors.join(', ')}` : ''}` : 'none'}</span>
        </h4>
        {d.baseline && <BaselineNote session={session} untrackedSets={untrackedSets} />}
        {sets.length > 0 && (
          <div className="dr-counts">
            {(Object.keys(STATUS_LABEL) as SetStatus[]).map((k) => (
              <span key={k} className={`dr-count st-${k}`}>
                <i /> {STATUS_LABEL[k]} <strong>{counts[k]}</strong>
              </span>
            ))}
          </div>
        )}
        <label className="row-gap dr-toggle">
          <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} /> Show only what changed
        </label>
        {!sets.length && (
          <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
            {d.baseline ? 'Nothing changed: every paragraph is as we sent it or our approved wording.' : 'No tracked changes in this draft.'} Edit or comment anywhere in the document.
          </p>
        )}
        <div className="dr-sets">
          {sets.map((s) => {
            const st = statusOf(d, s)
            return (
              <button key={s.id} className={`dr-set st-${st} ${selected === s.id ? 'on' : ''}`} onClick={() => select(s)}>
                <span className="dr-set-st">
                  <i /> {STATUS_LABEL[st]}
                </span>
                <span className="dr-set-where">{s.where}</span>
                <span className="dr-set-what">
                  {describe(s)}
                  {seen[s.id]?.some((h) => h.match === 'identical') && <span className="dr-tag seen" title="We've answered this exact change before">seen before</span>}
                  {d.ai?.[s.id]?.status === 'running' && <span className="spinner sm" />}
                  {d.ai?.[s.id]?.status === 'done' && <span className={`dr-tag ai rec-${d.ai[s.id].data!.recommendation}`} title="The AI's suggestion">AI: {d.ai[s.id].data!.recommendation}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {current && (
        <SetCard
          key={current.id}
          session={session}
          set={current}
          act={act}
          onEdit={(id) => {
            setEditing(id)
            scrollTo(id)
          }}
          onComment={(id, text) => {
            // On a paragraph they commented on, ours is a reply (threaded in Word).
            const theirs = d.blocks.find((b) => b.id === id)?.comments?.[0]
            setDraft({ blockId: id, text, replyTo: theirs?.id })
            scrollTo(id)
          }}
          seen={seen[current.id] ?? []}
          onHold={onHold}
          onPrefill={(blockId, text) => {
            setPrefill({ blockId, text })
            setEditing(blockId)
            scrollTo(blockId)
          }}
          onJump={scrollTo}
          onNominated={onNominationsChanged}
          onOriginal={(b) => setOriginal({ text: b.kind === 'deleted' ? b.text : b.text, label: b.label ? `§${b.label.replace(/\.$/, '')}` : 'Paragraph' })}
        />
      )}

      {others.length > 0 && (
        <section className="rp-section">
          <h4 className="rp-h">Our other edits</h4>
          <div className="dr-sets">
            {others.map((b) => (
              <button key={b.id} className="dr-set st-countered" onClick={() => scrollTo(b.id)}>
                <span className="dr-set-st">
                  <i /> Our edit
                </span>
                <span className="dr-set-where">{b.label ? `§${b.label.replace(/\.$/, '')}` : b.text.slice(0, 30)}</span>
                <span className="dr-set-what">{d.edits[b.id] === '' ? 'Struck' : 'Reworded'}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {alert?.status === 'open' && (
        <section className="rp-section">
          <div className="banner danger">
            <Icon name="shield" /> On security hold: text addressed to an AI reviewer was found.{' '}
            <button className="link-btn" onClick={onOpenSecurity}>
              Security
            </button>
          </div>
        </section>
      )}

      <section className="rp-section rp-actions">
        {sets.length > 0 && (
          <button
            className="btn"
            disabled={onHold || asking || !unasked.length}
            title={onHold ? 'On security hold: nothing goes to the AI' : 'One request per change set, each with the whole contract for context'}
            onClick={() => act(window.api.doc.ask(session.id, unasked.map((s) => s.id)))}
          >
            {asking ? <span className="spinner sm" /> : <Icon name="sparkle" />} {unasked.length ? `Ask AI about ${unasked.length} open change${unasked.length === 1 ? '' : 's'}` : 'AI has reviewed the open changes'}
          </button>
        )}
        <button className="btn" onClick={nextOpen} disabled={!counts.open}>
          <Icon name="next" /> Next change to decide <span className="kbd" style={{ marginLeft: 'auto' }}>N</span>
        </button>
        <button className="btn primary" onClick={() => setEmailOpen(true)} disabled={alert?.status === 'open'}>
          <Icon name="mail" /> Draft response
        </button>
        <button className="btn" onClick={() => setRedlineOpen(true)} disabled={alert?.status === 'open'}>
          <Icon name="doc" /> Marked-up copy (.docx)
        </button>
      </section>
    </div>
  )

  return (
    <div className="dr-wrap" onScroll={() => setBubble(null)} ref={page}>
      {error && (
        <div className="banner danger dr-error">
          <Icon name="alert" /> {error}
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
      <div className="dr-doc">
        {items.map((it) =>
          it.kind === 'fold' ? (
            <button key={`f${it.at}`} className="dr-fold" onClick={() => setExpanded(new Set([...expanded, ...Array.from({ length: it.count }, (_, k) => it.at + k)]))}>
              ⋯ {it.count} unchanged paragraph{it.count === 1 ? '' : 's'}
            </button>
          ) : (
            <BlockRow
              key={it.b.id}
              b={it.b}
              session={session}
              set={setOf.get(it.b.id) ?? null}
              selected={!!selected && setOf.get(it.b.id)?.id === selected}
              editing={editing === it.b.id}
              prefill={prefill?.blockId === it.b.id ? prefill.text : undefined}
              draft={draft?.blockId === it.b.id ? draft : null}
              flagged={!!session.injection[it.b.id]}
              onSelect={(s) => setSelected(s?.id ?? null)}
              onEdit={() => setEditing(it.b.id)}
              onEditDone={async (text) => {
                if (text !== undefined && !(await act(window.api.doc.edit(session.id, it.b.id, text)))) return
                setEditing(null)
                setPrefill(null)
              }}
              onComment={(c) => setDraft(c)}
              onCommentDone={async (text) => {
                if (text !== undefined && draft && !(await act(window.api.doc.comment(session.id, { ...draft, text })))) return
                setDraft(null)
              }}
              onUncomment={(id) => act(window.api.doc.uncomment(session.id, id))}
              onMouseUp={() => onMouseUp(it.b)}
            />
          )
        )}
      </div>
      {bubble && (
        <button
          className="dr-bubble btn sm primary"
          style={{ left: bubble.x, top: bubble.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft({ blockId: bubble.blockId, quote: bubble.quote })
            setBubble(null)
            window.getSelection()?.removeAllRanges()
          }}
        >
          <Icon name="chat" size={13} /> Comment
        </button>
      )}
      {panel && createPortal(sidebar, panel)}
      {emailOpen && <EmailModal session={session} onClose={() => setEmailOpen(false)} onMarkup={() => setRedlineOpen(true)} />}
      {redlineOpen && <RedlineModal session={session} onClose={() => setRedlineOpen(false)} />}
      {original && (
        <div className="modal-back" onClick={() => setOriginal(null)}>
          <div className="modal wide dr-original" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{original.label} in the original {session.sourceType === 'pdf' ? 'PDF' : session.sourceType === 'docx' ? 'Word file' : 'file'}</h3>
              <button className="icon-btn" onClick={() => setOriginal(null)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="dr-original-body">
              <OriginalView path={session.filePath} sourceType={session.sourceType} highlight={original.text} label={original.label} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** "Inserted", "Deleted", "Edited": what they did, in a word. */
function describe(s: ChangeSet): string {
  const u = s.blocks.find((b) => b.untracked)
  if (u?.untracked === 'template') return u.standard ? 'Differs from our standard' : 'Not in our template'
  if (u?.untracked === 'sent') return u.kind === 'deleted' ? 'Removed, not tracked' : beforeTheirs(u) ? 'Changed, not tracked' : 'Added, not tracked'
  const ops = new Set(s.blocks.flatMap((b) => segmentsOf(b).filter((x) => x.op !== 'same').map((x) => x.op)))
  const whole = s.blocks.every((b) => b.kind === 'deleted' || segmentsOf(b).every((x) => x.op === 'ins' || !x.text.trim()))
  if (s.blocks.every((b) => b.kind === 'deleted')) return 'Deleted'
  if (whole && ops.has('ins') && !ops.has('del')) return 'Inserted'
  return 'Edited'
}

// ---- one paragraph, with its margin ------------------------------------------------------

function BlockRow(props: {
  b: DocBlock
  session: ReviewSession
  set: ChangeSet | null
  selected: boolean
  editing: boolean
  draft: { blockId: string; quote?: string; replyTo?: string; text?: string } | null
  prefill?: string
  flagged: boolean
  onSelect: (s: ChangeSet | null) => void
  onEdit: () => void
  onEditDone: (text?: string | null) => void
  onComment: (c: { blockId: string; quote?: string; replyTo?: string }) => void
  onCommentDone: (text?: string) => void
  onUncomment: (id: string) => void
  onMouseUp: () => void
}) {
  const { b, session, set, selected, editing, draft, flagged } = props
  const d = session.doc!
  const edit = d.edits[b.id]
  const status = set ? statusOf(d, set) : null
  const ours = d.comments.filter((c) => c.blockId === b.id)
  const theirs = b.comments ?? []
  const loose = ours.filter((c) => !c.replyTo || !theirs.some((t) => t.id === c.replyTo))
  const marks = useMemo(() => overlay(segmentsOf(b), edit), [b, edit])

  return (
    <div className="dr-row" data-block={b.id}>
      <div
        className={`dr-block k-${b.kind} ${status ? `chg st-${status}` : ''} ${selected ? 'sel' : ''} ${edit !== undefined ? 'ours' : ''} ${b.center ? 'center' : ''} ${b.bold ? 'bold' : ''} ${!set && edit === undefined ? 'quiet' : ''} ${b.untracked ? 'untracked' : ''}`}
        style={b.level ? { paddingLeft: 14 + b.level * 22 } : undefined}
        onClick={() => props.onSelect(set)}
        onDoubleClick={() => !editing && props.onEdit()}
        onMouseUp={props.onMouseUp}
      >
        {flagged && (
          <span className="dr-flag" title="Text addressed to an AI reviewer: on security hold">
            <Icon name="shield" size={12} />
          </span>
        )}
        {b.label && <span className="dr-label">{b.label}</span>}
        {b.untracked && !editing && (
          <span className="dr-untracked" title={b.untracked === 'sent' ? 'Changed since we sent it, without Track Changes' : b.standard ? `Differs from our approved “${b.standard}”` : 'Not in our standard wording'}>
            {b.untracked === 'sent' ? 'not tracked' : b.standard ? 'not our standard' : 'not in our template'}
          </span>
        )}
        {editing ? (
          <Editor b={b} edit={edit} prefill={props.prefill} onDone={props.onEditDone} />
        ) : (
          <span className="dr-text">
            <Marks marks={marks} />
          </span>
        )}
        {!editing && (
          <span className="dr-tools" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn sm" title="Edit (double-click)" onClick={props.onEdit}>
              ✎
            </button>
            <button className="icon-btn sm" title="Comment" onClick={() => props.onComment({ blockId: b.id })}>
              <Icon name="chat" size={13} />
            </button>
          </span>
        )}
      </div>
      <div className="dr-margin">
        {theirs.map((c) => (
          <TheirComment key={c.id} c={c}>
            {ours
              .filter((o) => o.replyTo === c.id)
              .map((o) => (
                <OurCommentCard key={o.id} c={o} reply onDelete={() => props.onUncomment(o.id)} />
              ))}
            {draft?.replyTo === c.id ? (
              <CommentForm placeholder={`Reply to ${c.author}`} initial={draft.text} onDone={props.onCommentDone} />
            ) : (
              <button className="link-btn dr-reply" onClick={() => props.onComment({ blockId: b.id, replyTo: c.id })}>
                Reply
              </button>
            )}
          </TheirComment>
        ))}
        {loose.map((o) => (
          <OurCommentCard key={o.id} c={o} onDelete={() => props.onUncomment(o.id)} />
        ))}
        {draft && !draft.replyTo && (
          <div className="dr-comment ours">
            {draft.quote && <div className="dr-quote">“{draft.quote}”</div>}
            <CommentForm placeholder="Comment (goes to them in the marked-up copy)" initial={draft.text} onDone={props.onCommentDone} />
          </div>
        )}
      </div>
    </div>
  )
}

function Marks({ marks }: { marks: Mark[] }) {
  return (
    <>
      {marks.map((m, i) => {
        const who = (what: string) => `${what}${m.author ? ` by ${m.author}` : ''}${m.date ? `, ${new Date(m.date).toLocaleDateString()}` : ''}`
        let el: ReactNode = m.text
        if (m.theirs === 'ins') el = <ins className="th-ins" title={who('Inserted')}>{el}</ins>
        if (m.theirs === 'del') el = <del className="th-del" title={who('Deleted')}>{el}</del>
        if (m.ours === 'del') el = <del className="us-del" title="Struck by us">{el}</del>
        if (m.ours === 'ins') el = <ins className="us-ins" title="Our wording">{el}</ins>
        return <Fragment key={i}>{el}</Fragment>
      })}
    </>
  )
}

/** Edit a paragraph as plain text; saved when you click away (Esc cancels). */
function Editor({ b, edit, prefill, onDone }: { b: DocBlock; edit: string | undefined; prefill?: string; onDone: (text?: string | null) => void }) {
  const start = edit ?? b.text
  const [value, setValue] = useState(prefill ?? start)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length)
  }, [])
  const finish = () => onDone(value.trim() === start.trim() && edit === undefined && b.kind !== 'deleted' && prefill === undefined ? undefined : value)
  return (
    <span className="dr-editor" onClick={(e) => e.stopPropagation()}>
      <AutoTextarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(undefined)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish()
        }}
        onBlur={(e) => {
          if (!e.relatedTarget || !(e.currentTarget.parentElement?.contains(e.relatedTarget as Node))) finish()
        }}
      />
      <span className="dr-editor-bar">
        <span className="faint">Your edits become tracked changes · ⌘↵ to save · Esc to cancel</span>
        <span style={{ flex: 1 }} />
        {edit !== undefined && (
          <button className="btn sm ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone(null)}>
            Undo my edit
          </button>
        )}
        {b.kind !== 'deleted' && (
          <button className="btn sm ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone('')}>
            Strike paragraph
          </button>
        )}
        <button className="btn sm primary" onMouseDown={(e) => e.preventDefault()} onClick={finish}>
          Save
        </button>
      </span>
    </span>
  )
}

function TheirComment({ c, children }: { c: DocComment; children: ReactNode }) {
  return (
    <div className="dr-comment theirs">
      <div className="dr-comment-head">
        <strong>{c.author}</strong>
        {c.date && <span className="faint">{new Date(c.date).toLocaleDateString()}</span>}
      </div>
      <div>{c.text}</div>
      {children}
    </div>
  )
}

function OurCommentCard({ c, reply, onDelete }: { c: OurComment; reply?: boolean; onDelete: () => void }) {
  return (
    <div className={`dr-comment ours ${reply ? 'reply' : ''}`}>
      <div className="dr-comment-head">
        <strong>{c.by}</strong>
        <span className="faint">{new Date(c.at).toLocaleDateString()}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" title="Delete comment" onClick={onDelete}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {c.quote && <div className="dr-quote">“{c.quote}”</div>}
      <div>{c.text}</div>
    </div>
  )
}

function CommentForm({ placeholder, initial, onDone }: { placeholder: string; initial?: string; onDone: (text?: string) => void }) {
  const [text, setText] = useState(initial ?? '')
  return (
    <div className="dr-comment-form">
      <AutoTextarea autoFocus rows={2} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(undefined)
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onDone(text)
      }} />
      <div className="row-gap">
        <button className="btn sm primary" disabled={!text.trim()} onClick={() => onDone(text)}>
          Comment
        </button>
        <button className="btn sm ghost" onClick={() => onDone(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---- the selected change set ---------------------------------------------------------------

interface CardProps {
  session: ReviewSession
  set: ChangeSet
  act: (p: Promise<ReviewSession>) => Promise<boolean>
  onEdit: (blockId: string) => void
  onComment: (blockId: string, text?: string) => void
  seen: SeenHit[]
  onHold: boolean
  onPrefill: (blockId: string, text: string) => void
  onJump: (blockId: string) => void
  onOriginal: (b: DocBlock) => void
  onNominated: () => void
}

const RESPONSE_LABEL: Record<NonNullable<SeenHit['response']>, string> = { accepted: 'Accepted', countered: 'Countered', restored: 'Restored our wording', struck: 'Struck' }

function SetCard({ session, set, act, onEdit, onComment, seen, onHold, onPrefill, onJump, onOriginal, onNominated }: CardProps) {
  const d = session.doc!
  const status = statusOf(d, set)
  const decision = d.decisions[set.id]
  const [flagging, setFlagging] = useState(false)
  const [note, setNote] = useState('')
  const [nominating, setNominating] = useState(false)
  const edited = set.blocks.filter((b) => d.edits[b.id] !== undefined)
  const comments = set.blocks.flatMap((b) => b.comments ?? [])
  const first = set.blocks.find((b) => b.kind !== 'heading') ?? set.blocks[0]
  const last = set.blocks.map((b) => d.lastRound?.[b.id]).find((r) => r?.ourEdit || r?.comments.length)
  const ai = d.ai?.[set.id]
  const approved = set.blocks.find((b) => b.approved)?.approved
  const was = set.blocks.find((b) => b.wasApproved)?.wasApproved
  const standard = set.blocks.find((b) => b.standard)?.standard
  const untracked = set.blocks.find((b) => b.untracked)?.untracked

  return (
    <section className="rp-section dr-card">
      <h4 className="rp-h">
        {set.where}
        <span className={`dr-pill st-${status}`}>{STATUS_LABEL[status]}</span>
      </h4>
      {(untracked || approved || was) && (
        <div className="dr-facts">
          {untracked === 'sent' && <span className="dr-fact warn">Not tracked: found by comparing with what we sent for version {d.baseline?.version}</span>}
          {untracked === 'template' && <span className="dr-fact warn">{standard ? `Differs from our approved “${standard}”` : 'Not in our standard wording'}</span>}
          {was && <span className="dr-fact">Was our approved “{was}”</span>}
          {approved && <span className="dr-fact ok">Their wording is our approved “{approved}”</span>}
        </div>
      )}
      <div className="dr-card-redline">
        {set.blocks.map((b) => (
          <p key={b.id}>
            {b.label && <strong>{b.label} </strong>}
            <Redline segments={segmentsOf(b)} />
          </p>
        ))}
        {session.sourceType !== 'txt' && (
          <button className="link-btn dr-orig" onClick={() => onOriginal(first)}>
            Check in the original
          </button>
        )}
      </div>
      {comments.map((c) => (
        <div key={c.id} className="dr-card-comment">
          <strong>{c.author}:</strong> {c.text}
        </div>
      ))}
      {last && (
        <div className="dr-last">
          <div className="dr-mini-h">Last round we proposed</div>
          <div className="dr-last-text">{last.sent}</div>
          {last.comments.map((c, i) => (
            <div key={i} className="faint">
              Our comment: {c}
            </div>
          ))}
        </div>
      )}
      {decision && (
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
          {STATUS_LABEL[decision.status]} by {decision.by}
          {decision.note && `: ${decision.note}`} ·{' '}
          <button className="link-btn" onClick={() => act(window.api.doc.decide(session.id, set.id, null))}>
            Undo
          </button>
        </p>
      )}
      {!decision && edited.length > 0 && (
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
          Answered with your edits ·{' '}
          <button
            className="link-btn"
            onClick={async () => {
              for (const b of edited) await act(window.api.doc.edit(session.id, b.id, null))
            }}
          >
            Undo my edits
          </button>
        </p>
      )}
      {flagging ? (
        <div className="dr-flagging">
          <AutoTextarea autoFocus rows={2} placeholder="What needs checking, and by whom? (internal, not sent)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row-gap">
            <button className="btn sm primary" disabled={!note.trim()} onClick={async () => (await act(window.api.doc.decide(session.id, set.id, 'flagged', note))) && setFlagging(false)}>
              Flag for review
            </button>
            <button className="btn sm ghost" onClick={() => setFlagging(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="dr-card-actions">
          <button className="btn sm accept" disabled={status === 'accepted'} onClick={() => act(window.api.doc.decide(session.id, set.id, 'accepted'))} title={edited.length ? 'Accepting discards your edits here' : undefined}>
            <Icon name="check" size={13} /> Accept theirs
          </button>
          <button className="btn sm reject" onClick={() => act(window.api.doc.revert(session.id, set.id))} title={untracked === 'template' ? 'Back to our approved wording, as our redline' : 'Undo their change, as our redline'}>
            {untracked === 'template' && !standard ? 'Strike it' : 'Restore original'}
          </button>
          <button className="btn sm" onClick={() => onEdit(first.id)}>
            ✎ Edit
          </button>
          <button className="btn sm" onClick={() => onComment(first.id)}>
            <Icon name="chat" size={13} /> Comment
          </button>
          <button className="btn sm ghost" disabled={status === 'flagged'} onClick={() => setFlagging(true)}>
            Flag for review
          </button>
        </div>
      )}
      {status === 'accepted' && !set.blocks.every((b) => b.kind === 'deleted') && (
        <div className="dr-nominate">
          {d.nominated?.includes(set.id) ? (
            <span className="faint">
              <Icon name="check" size={12} /> Nominated for the pre-approved library
            </span>
          ) : nominating ? (
            <div className="dr-flagging">
              <AutoTextarea autoFocus rows={2} placeholder="Why this wording is safe to pre-approve (for the library owner)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row-gap">
                <button className="btn sm primary" onClick={async () => {
                    if (!(await act(window.api.doc.nominate(session.id, set.id, note)))) return
                    setNominating(false)
                    onNominated()
                  }}>
                  Nominate
                </button>
                <button className="btn sm ghost" onClick={() => setNominating(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="link-btn" onClick={() => setNominating(true)}>
              Nominate this wording for the library
            </button>
          )}
        </div>
      )}

      <SeenList set={set} session={session} seen={seen} act={act} onPrefill={onPrefill} />

      <div className="dr-ai">
        <div className="dr-mini-h">
          AI review
          {(!ai || ai.status === 'error' || ai.status === 'done') && (
            <button className="btn sm" disabled={onHold} title={onHold ? 'On security hold: nothing goes to the AI' : 'This change as one request, with the whole contract for context'} onClick={() => act(window.api.doc.ask(session.id, [set.id]))}>
              <Icon name="sparkle" size={13} /> {ai?.status === 'done' ? 'Ask again' : 'Ask AI'}
            </button>
          )}
        </div>
        {!ai && <p className="faint dr-small">Nothing has been sent to the AI. Ask, and it reads this change in the context of the whole contract, our playbook and what we agreed before.</p>}
        {ai?.status === 'running' && (
          <p className="faint dr-small">
            <span className="spinner sm" /> {ai.reason}
          </p>
        )}
        {ai?.status === 'error' && <p className="dr-small dr-err">{ai.error}</p>}
        {ai?.status === 'done' && ai.data && <AiCard session={session} set={set} r={ai.data} act={act} onComment={onComment} onJump={onJump} />}
      </div>
    </section>
  )
}

/** How a draft was compared, and what that found. */
function BaselineNote({ session, untrackedSets }: { session: ReviewSession; untrackedSets: number }) {
  const b = session.doc!.baseline!
  if (b.kind === 'sent')
    return (
      <div className="dr-baseline">
        Compared with what we sent for version {b.version}.{' '}
        {b.ourEditsAccepted.length > 0 && (
          <>
            They took our wording in {b.ourEditsAccepted.join(', ')}.{' '}
          </>
        )}
        {untrackedSets ? (
          <strong>
            {untrackedSets} change{untrackedSets === 1 ? '' : 's'} made without Track Changes.
          </strong>
        ) : (
          'Nothing changed without Track Changes.'
        )}
      </div>
    )
  return (
    <div className="dr-baseline">
      On our paper: {b.approved} paragraphs are our approved wording, word for word.{' '}
      {untrackedSets ? (
        <strong>
          {untrackedSets} {untrackedSets === 1 ? 'differs' : 'differ'} from it.
        </strong>
      ) : (
        'Nothing else differs.'
      )}
    </div>
  )
}

/** Earlier negotiations: the identical change (with how we answered it), then similar ones. */
function SeenList({ session, set, seen, act, onPrefill }: { session: ReviewSession; set: ChangeSet; seen: SeenHit[]; act: CardProps['act']; onPrefill: CardProps['onPrefill'] }) {
  const d = session.doc!
  const [open, setOpen] = useState<string | null>(null)
  if (!seen.length)
    return (
      <div className="dr-seen">
        <div className="dr-mini-h">Seen before</div>
        <p className="faint dr-small">Not seen in earlier negotiations. Your decision here is recorded for next time.</p>
      </div>
    )
  const editable = set.blocks.filter((b) => b.kind !== 'heading')
  const apply = async (h: SeenHit) => {
    if (h.response === 'accepted') return act(window.api.doc.decide(session.id, set.id, 'accepted', `As agreed with ${h.counterparty} (${h.date}).`))
    if (h.response === 'restored') return act(window.api.doc.revert(session.id, set.id))
    // Same wording again: answer it the same way, paragraph by paragraph.
    const ours = h.ours ?? []
    for (let i = 0; i < set.blocks.length; i++) {
      const t = ours.length === set.blocks.length ? ours[i] : i === set.blocks.indexOf(editable[0]) ? ours.find((x) => x !== null) ?? null : null
      if (t !== null && t !== undefined) await act(window.api.doc.edit(session.id, set.blocks[i].id, t))
    }
    return true
  }
  return (
    <div className="dr-seen">
      <div className="dr-mini-h">Seen before</div>
      {seen.map((h) => {
        const wording = h.ours?.filter((t): t is string => t !== null && t !== '').join('\n')
        return (
          <div key={h.id} className={`dr-seen-hit ${h.match}`}>
            <button className="dr-seen-head" onClick={() => setOpen(open === h.id ? null : h.id)}>
              <span className={`dr-tag ${h.match === 'identical' ? 'seen' : ''}`}>{h.match === 'identical' ? 'same change' : 'similar'}</span>
              <strong>{h.counterparty}</strong>
              <span className="faint">{h.date}</span>
              <span style={{ flex: 1 }} />
              <span className={`dr-out out-${h.outcome}`}>{h.response ? RESPONSE_LABEL[h.response] : h.outcome === 'accepted' ? 'Accepted' : 'Rejected'}</span>
            </button>
            <div className="dr-small">{h.notes}</div>
            {open === h.id && (
              <div className="dr-seen-more">
                <div className="dr-mini-h">They proposed</div>
                <div className="dr-last-text">{h.text}</div>
                {wording && (
                  <>
                    <div className="dr-mini-h">We answered with</div>
                    <div className="dr-last-text">{wording}</div>
                  </>
                )}
              </div>
            )}
            <div className="row-gap">
              {h.match === 'identical' && h.response && statusOf(d, set) === 'open' && (
                <button className="btn sm primary" onClick={() => apply(h)}>
                  Answer the same way
                </button>
              )}
              {h.match === 'similar' && wording && editable.length === 1 && (
                <button className="btn sm" onClick={() => onPrefill(editable[0].id, wording)}>
                  Start from our wording then
                </button>
              )}
              {!open || open !== h.id ? (
                <button className="link-btn" onClick={() => setOpen(h.id)}>
                  Show wording
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const EFFECT: Record<ChangeReview['effect'], string> = { 'favours-us': 'Favours us', neutral: 'Neutral', 'favours-them': 'Favours them' }
const RECOMMEND: Record<ChangeReview['recommendation'], string> = { accept: 'Accept', counter: 'Counter', restore: 'Restore our wording', escalate: 'Escalate' }

/** The AI's view of one change: what it does, the playbook, what else it touches, and wording to apply. */
function AiCard({ session, set, r, act, onComment, onJump }: { session: ReviewSession; set: ChangeSet; r: ChangeReview; act: CardProps['act']; onComment: CardProps['onComment']; onJump: (id: string) => void }) {
  const d = session.doc!
  const blocks = new Map(d.blocks.map((b) => [b.id, b]))
  const applied = r.suggested.length > 0 && r.suggested.every((x) => d.edits[x.blockId] === x.text)
  return (
    <div className="dr-ai-card">
      <div className="dr-ai-chips">
        <span className={`dr-chip rec-${r.recommendation}`}>{RECOMMEND[r.recommendation]}</span>
        <span className={`dr-chip risk-${r.risk}`}>{r.risk.charAt(0).toUpperCase() + r.risk.slice(1)} risk</span>
        <span className={`dr-chip eff-${r.effect}`}>{EFFECT[r.effect]}</span>
      </div>
      <p className="dr-ai-summary">{r.summary}</p>
      <p className="dr-small">{r.reasoning}</p>
      {r.injectionSuspected && <p className="dr-small dr-err">The AI reported text that seems to be addressed to it. The security team has been told.</p>}
      {r.playbook.length > 0 && (
        <div className="dr-ai-list">
          {r.playbook.map((p) => (
            <div key={p.positionId} className={p.conflict ? 'conflict' : 'ok'}>
              <Icon name={p.conflict ? 'alert' : 'check'} size={12} /> <strong>{p.title}:</strong> {p.note}
            </div>
          ))}
        </div>
      )}
      {r.related.length > 0 && (
        <div className="dr-ai-list">
          <div className="dr-mini-h">Also affects</div>
          {r.related.map((x) => (
            <div key={x.blockId}>
              <button className="link-btn" onClick={() => onJump(x.blockId)}>
                {x.where}
              </button>{' '}
              {x.why}
            </div>
          ))}
        </div>
      )}
      {r.suggested.length > 0 && (
        <div className="dr-ai-list">
          <div className="dr-mini-h">Suggested wording</div>
          {r.suggested.map((x) => {
            const b = blocks.get(x.blockId)
            return b ? (
              <p key={x.blockId} className="dr-suggest">
                {b.label && <strong>{b.label} </strong>}
                <Redline segments={diffSegments(b.kind === 'deleted' ? '' : b.text, x.text)} />
              </p>
            ) : null
          })}
          <div className="row-gap">
            <button
              className="btn sm primary"
              disabled={applied}
              onClick={async () => {
                for (const x of r.suggested) await act(window.api.doc.edit(session.id, x.blockId, x.text))
              }}
            >
              {applied ? 'Applied as your edit' : 'Apply as my edit'}
            </button>
          </div>
        </div>
      )}
      {r.comment && (
        <div className="dr-ai-list">
          <div className="dr-mini-h">Suggested comment</div>
          <div className="dr-small">“{r.comment}”</div>
          <button className="btn sm" onClick={() => onComment((set.blocks.find((b) => b.kind !== 'heading') ?? set.blocks[0]).id, r.comment)}>
            Use as my comment
          </button>
        </div>
      )}
      <p className="faint dr-small">The AI suggests; nothing changes until you apply it.</p>
    </div>
  )
}
