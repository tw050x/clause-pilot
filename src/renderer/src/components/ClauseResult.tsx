import { useEffect, useState } from 'react'
import type { Clause, DiffToken, PlaybookPosition, ReviewSession, SecurityAlert } from '@shared/types'
import { Highlighted } from './Highlighted'
import { Redline } from './Redline'
import { clauseLabel, isCleared, type ClauseFlags, type Visual } from '@shared/derive'
import { Icon } from '../lib/icons'

interface Props {
  session: ReviewSession
  clause: Clause
  flags: ClauseFlags
  visual: Visual
  onJump: (clauseId: string) => void
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  alert: SecurityAlert | null
}

const TITLES: Record<Visual, string> = {
  processing: 'Analysing',
  exact: 'Exact match: pre-approved',
  intent: 'Same meaning as approved wording (AI): please confirm',
  review: 'Needs human review',
  conflict: 'Conflict found',
  accepted: 'Accepted',
  rejected: 'Rejected'
}

const ICONS: Record<Visual, string> = {
  processing: '',
  exact: 'check',
  intent: 'scales',
  review: 'scales',
  conflict: 'alert',
  accepted: 'check',
  rejected: 'x'
}

export function ClauseResult({ session, clause, flags, visual, onJump, onChange, onNominationsChanged, alert }: Props) {
  const match = session.match[clause.id]
  const prec = session.precedents[clause.id]
  const m = match?.data
  const label = (id: string) => clauseLabel(session.clauses.find((c) => c.id === id)!)
  const reason = match?.status === 'running' ? match.reason : prec?.status === 'running' ? prec.reason : match?.reason

  return (
    <>
      <div className="result-head">
        {visual === 'processing' ? <span className="spinner" /> : <Icon name={ICONS[visual]} />}
        <span>{TITLES[visual]}</span>
        <span className="clause-tag">{clauseLabel(clause)}</span>
      </div>
      {reason && visual !== 'accepted' && visual !== 'rejected' && (
        <div className="result-section" style={{ borderTop: 'none', paddingTop: 0, paddingBottom: 8 }}>
          <span className="why muted">{reason}</span>
          {visual === 'processing' && (
            <>
              <div className="skeleton" style={{ width: '90%' }} />
              <div className="skeleton" style={{ width: '70%' }} />
            </>
          )}
        </div>
      )}

      {(clause.tracked || clause.comments) && (
        <div className="result-section">
          <h4>
            <Icon name="mail" size={13} /> Their changes
          </h4>
          {clause.tracked && (
            <>
              <p className="faint" style={{ fontSize: 12.5 }}>
                {flags.redlined === 'inserted' ? 'Inserted as a tracked change' : <>Changed with <i>Track Changes</i></>}
                {authorsOf(clause.tracked)}.
              </p>
              <div className="diff redline-box">
                <Redline segments={clause.tracked} />
              </div>
            </>
          )}
          {clause.comments?.map((c) => (
            <div key={c.id} className="doc-comment">
              <div className="faint" style={{ fontSize: 12 }}>
                <b>{c.author}</b>
                {c.date && ` · ${new Date(c.date).toLocaleDateString()}`}
              </div>
              <div>{c.text}</div>
            </div>
          ))}
        </div>
      )}

      {flags.version && session.previous && <VersionSection link={flags.version} prevVersion={session.previous.version} />}

      {flags.docChecksPending && !flags.decision && (
        <div className="result-section">
          <h4>
            <span className="spinner" style={{ width: 11, height: 11, color: 'var(--processing)' }} /> Checking the whole contract
          </h4>
          <p className="faint" style={{ fontSize: 12.5 }}>Looking for clauses that override this one and checking it against our playbook…</p>
          <div className="skeleton-block">
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '92%' }} />
            <div className="skeleton" style={{ width: '78%' }} />
          </div>
        </div>
      )}

      {flags.injection.length > 0 && (
        <div className={`security-banner s-${alert?.status ?? 'open'}`}>
          <div className="security-panel-head">
            <Icon name="shield" />
            <strong>
              {alert?.status === 'malicious' ? 'Confirmed prompt-injection attempt' : alert?.status === 'false-positive' ? 'Security hold released (false positive)' : 'Security hold: possible prompt injection'}
            </strong>
          </div>
          <p>This clause contains text addressed to an AI reviewer rather than to us:</p>
          <div className="quote" style={{ color: 'var(--text)' }}>
            <Highlighted text={clause.text} />
          </div>
          <p className="faint" style={{ fontSize: 12.5 }}>
            Detected by a local check before any AI saw the contract ({flags.injection.join(', ')}). The AI was told to treat contract text as data and ignore instructions in it, and this
            clause is never accepted automatically.
          </p>
          <p style={{ marginBottom: 0 }}>
            {alert?.status === 'malicious'
              ? `Confirmed by the security team (${alert.resolvedBy}). It can only be rejected.`
              : alert?.status === 'false-positive'
                ? `Released by ${alert.resolvedBy}: “${alert.note}”. Decide on it as normal.`
                : 'The security team has been alerted. It can’t be accepted until they’ve reviewed it.'}
          </p>
        </div>
      )}

      {(flags.overriding.length > 0 || flags.overriddenBy.length > 0) && (
        <div className="result-section">
          <h4>
            <Icon name="link" size={13} /> Overrides
          </h4>
          {flags.overriding.map((o) => (
            <div key={o.id} className={`finding ${o.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${o.severity}`}>{o.severity}</span>
                <strong>Overrides</strong>
                {o.overriddenClauseIds.map((id) => (
                  <button key={id} className="link" onClick={() => onJump(id)}>
                    {label(id)}
                  </button>
                ))}
              </div>
              <p>{o.summary}</p>
              <p className="muted">{o.effect}</p>
              <div className="quote">"{o.quote}"</div>
            </div>
          ))}
          {flags.overriddenBy.map((o) => (
            <div key={o.id} className={`finding ${o.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${o.severity}`}>{o.severity}</span>
                <strong>Overridden by</strong>
                <button className="link" onClick={() => onJump(o.overridingClauseId)}>
                  {label(o.overridingClauseId)}
                </button>
              </div>
              <p>
                {m?.kind === 'exact' || m?.kind === 'intent'
                  ? 'This clause matches our standard wording, but another clause changes what it does. '
                  : ''}
                {o.summary}
              </p>
            </div>
          ))}
        </div>
      )}

      {flags.playbook.length > 0 && (
        <div className="result-section">
          <h4>
            <Icon name="book" size={13} /> Standard positions
          </h4>
          {flags.playbook.map((p) => (
            <div key={p.positionId} className={`finding ${p.withinFallback ? 'low' : p.severity}`}>
              <div className="row-gap" style={{ marginBottom: 4 }}>
                <span className={`pill ${p.withinFallback ? 'low' : p.severity}`}>{p.withinFallback ? 'within fallback' : p.severity}</span>
                <strong>{p.positionTitle}</strong>
              </div>
              <p>{p.deviation}</p>
              {p.suggestedRedline && (
                <details>
                  <summary>Suggested redline</summary>
                  <div className="quote">{p.suggestedRedline}</div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {m && m.kind !== 'exact' && clause.number && <MatchDetail session={session} clauseId={clause.id} />}

      {prec && (prec.status === 'done' || prec.status === 'running') && (
        <div className="result-section">
          <h4>
            <Icon name="history" size={13} /> Precedents
          </h4>
          {prec.status === 'running' && <div className="skeleton" />}
          {prec.data?.length === 0 && <p className="faint">No precedents for similar wording.</p>}
          {prec.data?.map((p) => (
            <div key={p.id} className="precedent">
              <div className="meta">
                <span className={`pill ${p.outcome}`}>{p.outcome}</span>
                <strong style={{ color: 'var(--text)' }}>{p.counterparty}</strong>
                <span>{p.date}</span>
                <span>· {p.category}</span>
                <span className="faint" style={{ marginLeft: 'auto' }} title={`Matched on: ${p.terms.join(', ')}`}>
                  relevance {Math.round(p.score * 100)}%
                </span>
              </div>
              <div className="note">{p.notes}</div>
              <details>
                <summary>Their wording</summary>
                <div className="txt" style={{ marginTop: 4 }}>
                  {p.text}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}

      {/* Keyed by clause: a half-filled form never carries over to another clause. */}
      <DecisionPanel
        key={clause.id}
        session={session}
        clause={clause}
        flags={flags}
        onChange={onChange}
        onNominationsChanged={onNominationsChanged}
        acceptBlocked={flags.injection.length > 0 && alert?.status !== 'false-positive'}
      />
    </>
  )
}

function MatchDetail({ session, clauseId }: { session: ReviewSession; clauseId: string }) {
  const m = session.match[clauseId].data!
  const v = m.verdict
  const best = m.candidates.find((c) => c.libraryId === (m.libraryId ?? v?.bestMatchId)) ?? m.candidates[0]
  if (!best) {
    return (
      <div className="result-section">
        <h4>
          <Icon name="book" size={13} /> Library match
        </h4>
        <p className="faint">Nothing in the pre-approved library resembles this clause. This is new drafting.</p>
      </div>
    )
  }
  return (
    <div className="result-section">
      <h4>
        <Icon name="book" size={13} /> Library match
      </h4>
      <div className="row-gap" style={{ marginBottom: 6 }}>
        <span>
          Closest approved clause: <strong>{best.title}</strong>
        </span>
        <span className="pill neutral">{Math.round(best.score * 100)}% lexical</span>
        {v && <span className={`pill ${m.kind === 'intent' ? 'intent' : 'review'}`}>{m.kind === 'intent' ? 'same intent' : 'different effect'}</span>}
      </div>
      {v && (
        <>
          <p>{v.reasoning}</p>
          {v.materialDifferences.length > 0 && (
            <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
              {v.materialDifferences.map((d, i) => (
                <li key={i}>
                  {d.description}{' '}
                  <span className={`pill ${d.favours === 'counterparty' ? 'high' : d.favours === 'us' ? 'accepted' : 'neutral'}`}>
                    {d.favours === 'us' ? 'favours us' : d.favours === 'counterparty' ? 'favours them' : 'neutral'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {m.gateNote && (
            <p className="faint" style={{ fontSize: 12 }}>
              Gate: {m.gateNote} · AI confidence {v.confidence}
            </p>
          )}
        </>
      )}
      {session.match[clauseId].error && <p className="faint">AI unavailable: {session.match[clauseId].error}</p>}
      <details open>
        <summary>Changes from approved wording</summary>
        <div className="diff" style={{ marginTop: 6 }}>
          <Diff tokens={best.diff} />
        </div>
      </details>
    </div>
  )
}

function Diff({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {t.op === 'same' ? t.text : t.op === 'add' ? <ins>{t.text}</ins> : <del>{t.text}</del>}
        </span>
      ))}
    </>
  )
}

function DecisionPanel({
  session,
  clause,
  flags,
  onChange,
  onNominationsChanged,
  acceptBlocked
}: {
  session: ReviewSession
  clause: Clause
  flags: ClauseFlags
  onChange: (s: ReviewSession) => void
  onNominationsChanged: () => void
  acceptBlocked: boolean
}) {
  const [mode, setMode] = useState<'accepted' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [redline, setRedline] = useState('')
  const [nominate, setNominate] = useState(false)
  const [removal, setRemoval] = useState(false)
  // Where the pre-filled wording came from, shown under it so the reviewer knows what they're sending.
  const [source, setSource] = useState('')
  // The pre-filled reason, until the reviewer edits it: switching the ask then rewrites its last sentence.
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const playbook = usePlaybook()
  const d = flags.decision

  /**
   * Starting a rejection: pre-fill what the counterparty will read. The reason comes from our
   * playbook position (or our standard wording). Our wording is always prepared, from the best
   * source we have: the playbook's suggested replacement, our closest approved library clause, or
   * wording we have accepted before (a precedent), else our playbook position itself. When our position is that the clause shouldn't
   * be there at all, the ask starts as a removal, but the wording is ready if they switch.
   */
  const startReject = () => {
    // Prefer a finding that offers real wording, then one asking for removal, then any.
    const isInstruction = (t: string) => /^\s*(delete|see|make|replace|amend)\b/i.test(t)
    const finding =
      flags.playbook.find((p) => p.suggestedRedline && !isInstruction(p.suggestedRedline)) ??
      flags.playbook.find((p) => /^\s*delete\b/i.test(p.suggestedRedline)) ??
      flags.playbook[0]
    const position = finding && playbook.find((p) => p.id === finding.positionId)
    const best = session.match[clause.id]?.data?.candidates?.[0]
    const agreed = session.precedents[clause.id]?.data?.find((p) => p.outcome === 'accepted')
    const suggestion = finding?.suggestedRedline ?? ''
    const askRemoval = !!flags.injection.length || /^\s*delete\b/i.test(suggestion) || (!suggestion && flags.redlined === 'inserted' && !best)
    let reason = ''
    if (flags.injection.length) reason = 'This clause contains instructions addressed to an automated review system rather than to us. It needs to be removed.'
    else if (position) reason = `This doesn’t match our standard position on ${position.title.toLowerCase()}. ${position.standard}`
    else if (flags.overriding.length) reason = 'This clause overrides other terms of the agreement and changes their effect. We can’t accept that.'
    else if (best) reason = 'This departs from our standard wording for this clause.'

    let wording = ''
    let from = ''
    if (suggestion && !isInstruction(suggestion)) [wording, from] = [suggestion, `Suggested by the playbook (${position?.title ?? 'standard position'})`]
    else if (best) [wording, from] = [best.text, `Our approved wording: ${best.title}`]
    else if (agreed) [wording, from] = [agreed.text, `Precedent: accepted with ${agreed.counterparty}, ${agreed.date}`]
    else if (position) [wording, from] = [position.standard, `Our standard position (${position.title}); reword it as a clause before sending`]

    setRemoval(askRemoval)
    setRedline(wording)
    setSource(from)
    setAutoNote(reason)
    setNote(withAsk(reason, askRemoval, !!wording))
    setMode('rejected')
  }
  const withAsk = (reason: string, removal: boolean, hasWording: boolean) =>
    !reason || flags.injection.length ? reason : `${reason} ${removal ? 'We ask for this clause to be removed.' : hasWording ? 'We propose the wording below instead.' : ''}`.trim()
  const chooseAsk = (r: boolean) => {
    setRemoval(r)
    if (autoNote !== null) setNote(withAsk(autoNote, r, !!redline.trim()))
  }
  const cleared = isCleared(flags)
  const exact = flags.match === 'exact'

  if (d) {
    return (
      <div className="decision">
        <div className="row-gap">
          <span className={`pill ${d.decision}`}>{d.decision}</span>
          <span className="who">
            by {d.by} · {new Date(d.at).toLocaleString()}
            {d.nominate && ' · nominated for library'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm ghost"
            onClick={async () => {
              onChange(await window.api.review.undo(session.id, clause.id))
              onNominationsChanged()
            }}
          >
            Undo
          </button>
        </div>
        {d.note && <div style={{ fontSize: 13 }}>{d.note}</div>}
        {d.removal && <div className="faint" style={{ fontSize: 12.5 }}>Asked them to remove this clause.</div>}
        {d.redline && <div className="quote">{d.redline}</div>}
      </div>
    )
  }

  if (flags.processing) return null

  // Green: pre-approved wording with nothing else touching it. Accepted by default;
  // the only action offered is the exception.
  if (cleared && mode !== 'rejected') {
    return (
      <div className="decision">
        <div className="row-gap">
          <span className="pill accepted">accepted</span>
          <span className="who">{flags.match === 'exact' ? 'Pre-approved wording.' : `Settled in version ${session.previous?.version}, unchanged.`} No action needed.</span>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm reject"
            onClick={startReject}
          >
            <Icon name="x" size={13} /> Reject
          </button>
        </div>
      </div>
    )
  }

  const submit = async (decision: 'accepted' | 'rejected') => {
    onChange(
      await window.api.review.decide(session.id, {
        clauseId: clause.id,
        decision,
        note,
        redline: decision === 'rejected' && !removal ? redline : '',
        removal: decision === 'rejected' && removal,
        nominate: decision === 'accepted' && nominate
      })
    )
    if (nominate) onNominationsChanged()
    setMode(null)
  }

  return (
    <div className="decision">
      {!mode && (
        <div className="row-gap">
          <button
            className="btn sm accept"
            onClick={() => setMode('accepted')}
            disabled={acceptBlocked}
            title={acceptBlocked ? 'On security hold: only the security team can release this clause' : undefined}
          >
            <Icon name="check" size={13} /> Accept
          </button>
          <button
            className="btn sm reject"
            onClick={startReject}
          >
            <Icon name="x" size={13} /> Reject
          </button>
        </div>
      )}
      {mode && (
        <>
          <textarea
            rows={2}
            autoFocus
            placeholder={mode === 'accepted' ? 'Why is this acceptable? (becomes a precedent)' : 'Why we can’t accept it (shared with the counterparty)'}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setAutoNote(null)
            }}
          />
          {mode === 'rejected' && (
            <>
              <div className="ask-choice" role="radiogroup" aria-label="What we ask for">
                {([
                  [false, 'Propose our wording', 'Send replacement wording'],
                  [true, 'Ask them to remove it', 'Delete the clause entirely']
                ] as const).map(([r, label, hint]) => (
                  <button key={label} role="radio" aria-checked={removal === r} className={removal === r ? 'on' : ''} onClick={() => chooseAsk(r)}>
                    <span className="radio" />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                  </button>
                ))}
              </div>
              {removal ? (
                <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>The response will ask for this clause to be removed.</p>
              ) : (
                <>
                  <textarea rows={4} placeholder="The wording we propose instead" value={redline} onChange={(e) => setRedline(e.target.value)} />
                  <p className="faint" style={{ margin: 0, fontSize: 12 }}>
                    {source ? `Pre-filled from: ${source}.` : 'No approved wording or precedent found for this clause. Write the wording we propose.'}
                  </p>
                </>
              )}
            </>
          )}
          {mode === 'accepted' && !exact && (
            <label className="row-gap" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={nominate} onChange={(e) => setNominate(e.target.checked)} /> Nominate this wording for the pre-approved library
            </label>
          )}
          <div className="row-gap">
            <button className={`btn sm ${mode === 'accepted' ? 'accept on' : 'reject on'}`} onClick={() => submit(mode)}>
              Confirm {mode === 'accepted' ? 'accept' : 'reject'}
            </button>
            <button className="btn sm ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const PREV_STATUS: Record<string, string> = {
  accepted: 'you accepted it',
  'pre-approved': 'it was pre-approved wording',
  rejected: 'you rejected it',
  open: 'it was not decided'
}

/** How this clause compares with the previous draft of the same contract. */
function VersionSection({ link, prevVersion }: { link: NonNullable<ClauseFlags['version']>; prevVersion: number }) {
  if (link.kind === 'new')
    return (
      <div className="result-section version-section">
        <h4>
          <Icon name="history" size={13} /> Since version {prevVersion}
        </h4>
        <p>
          <span className="pill review">new</span> This clause wasn’t in version {prevVersion}.
        </p>
      </div>
    )
  const before = `In version ${prevVersion}${link.prevLabel ? ` (${link.prevLabel})` : ''} ${PREV_STATUS[link.prevStatus ?? 'open']}`
  return (
    <div className="result-section version-section">
      <h4>
        <Icon name="history" size={13} /> Since version {prevVersion}
      </h4>
      {link.kind === 'unchanged' ? (
        <p>
          <span className="pill neutral">unchanged</span> {before}
          {link.prevStatus === 'rejected' ? ', and they sent it back without changes.' : '.'}
          {link.prevNote && <span className="muted"> Your note: “{link.prevNote}”</span>}
        </p>
      ) : (
        <>
          <p>
            <span className="pill review">changed</span> {before}.{link.prevNote && <span className="muted"> Your note: “{link.prevNote}”</span>}
          </p>
          {link.matchesOurRedline && (
            <p>
              <span className="pill accepted">✓ matches your proposed wording</span>
            </p>
          )}
          <details open>
            <summary>What changed since version {prevVersion}</summary>
            <div className="diff" style={{ marginTop: 6 }}>
              <Diff tokens={link.diff ?? []} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function authorsOf(segs: NonNullable<Clause['tracked']>): string {
  const names = [...new Set(segs.filter((s) => s.op !== 'same' && s.author).map((s) => s.author!))]
  return names.length ? ` by ${names.join(', ')}` : ''
}

/** Our standard positions, used to pre-fill the reason when rejecting a clause. */
let playbookCache: PlaybookPosition[] | null = null
function usePlaybook(): PlaybookPosition[] {
  const [list, setList] = useState<PlaybookPosition[]>(playbookCache ?? [])
  useEffect(() => {
    window.api.kb.playbook().then((p) => {
      playbookCache = p
      setList(p)
    })
  }, [])
  return list
}
