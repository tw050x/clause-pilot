import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, BackgroundJob, ContractRecord, Nomination, PlaybookProposal, DraftOrigin, ReviewSession, ReviewSummary, SecurityAlert, Settings } from '@shared/types'
import { Icon } from './lib/icons'
import { SidebarIcon } from './lib/sidebarIcons'
import { NavDrawer, type View } from './components/NavDrawer'
import { ChatPanel } from './components/ChatDrawer'
import { Home } from './views/Home'
import { Review } from './views/Review'
import { HistoryView, LibraryView } from './views/KnowledgeView'
import { PlaybookView } from './views/PlaybookView'
import { QuestionsView } from './views/QuestionsView'
import { ApprovalsView } from './views/QueueView'
import { AuditView } from './views/AuditView'
import { SettingsView } from './views/SettingsView'
import { ReviewsView } from './views/ReviewsView'
import { SecurityView } from './views/SecurityView'
import { WorkView, forYou } from './views/WorkView'
import { ContractView, ContractsListView, NewContractView } from './views/ContractView'
import { OpenContractModal } from './components/OpenContractModal'
import { AccountPicker } from './components/AccountPicker'


const isMac = navigator.userAgent.includes('Mac')

export function App() {
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [navOpen, setNavOpen] = useState(true)
  const [rightTab, setRightTab] = useState<'review' | 'chat'>('review')
  const [reviewPanel, setReviewPanel] = useState<HTMLDivElement | null>(null)
  const [bottomBar, setBottomBar] = useState<HTMLDivElement | null>(null)
  const [reviewFoot, setReviewFoot] = useState<HTMLDivElement | null>(null)
  const [reviewHead, setReviewHead] = useState<HTMLDivElement | null>(null)
  const [nominations, setNominations] = useState<Nomination[]>([])
  const [proposals, setProposals] = useState<PlaybookProposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const online = useOnline()
  const [openModal, setOpenModal] = useState<{ contractId?: string } | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountIdState] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  /** The contract whose page is showing (view 'contract'). */
  const [contractPageId, setContractPageId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const refreshAlerts = useCallback(() => window.api.security.list().then(setAlerts), [])
  const refreshReviews = useCallback(() => window.api.review.list().then(setReviews), [])

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.kb.nominations().then(setNominations)
    window.api.kb.playbookProposals().then(setProposals)
    refreshReviews()
    refreshAlerts()
  }, [])

  // The main process raises alerts as soon as the local check flags something.
  useEffect(() => window.api.security.onUpdate(() => refreshAlerts()), [refreshAlerts])

  // Live pipeline updates for the open session.
  // Background work (the header's Working pill, the queue page): asked for when it changes, and
  // every couple of seconds while there is some (to follow where it's got to).
  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const refreshJobs = useCallback(() => window.api.work.list().then(setJobs), [])
  useEffect(() => {
    void refreshJobs()
    return window.api.work.onChange(() => void refreshJobs())
  }, [refreshJobs])
  useEffect(() => {
    if (!jobs.length) return
    const t = setInterval(() => void refreshJobs(), 2000)
    return () => clearInterval(t)
  }, [jobs.length > 0, refreshJobs])

  // Any review's update (the background planning, say): the lists catch up, at most once a second.
  const listsDue = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () =>
      window.api.review.onUpdate((s) => {
        setSession((cur) => (cur && cur.id === s.id ? s : cur))
        listsDue.current ??= setTimeout(() => {
          listsDue.current = null
          void refreshReviews()
          void refreshJobs()
        }, 1000)
      }),
    []
  )

  const refreshNominations = useCallback(() => window.api.kb.nominations().then(setNominations), [])
  const decisionCount = session ? Object.keys(session.decisions).length : 0
  useEffect(() => {
    refreshReviews()
  }, [decisionCount, session?.id])

  const openContract = useCallback(async (path: string, contractId?: string, origin?: DraftOrigin) => {
    setError(null)
    try {
      const s = await window.api.review.start(path, contractId, origin)
      setSession(s)
      if (s.accountId) setActiveAccountId(s.accountId)
      refreshReviews()
      refreshAccounts()
      setView('review')
      setRightTab('review')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    const s = await window.api.review.get(id)
    setSession(s)
    // Opening another client's review (e.g. from Security or Audit) switches to that client.
    if (s.accountId) setActiveAccountId(s.accountId)
    setView('review')
  }, [])

  // ---- where you've been: Back (in the bar under a review) returns to the page before ----
  type Place = { view: View; contractPageId: string | null; sessionId: string | null }
  const trail = useRef<Place[]>([])
  const here: Place = { view, contractPageId: view === 'contract' ? contractPageId : null, sessionId: view === 'review' ? (session?.id ?? null) : null }
  useEffect(() => {
    const top = trail.current.at(-1)
    if (top && top.view === here.view && top.contractPageId === here.contractPageId && top.sessionId === here.sessionId) return
    trail.current = [...trail.current.slice(-49), here]
  }, [here.view, here.contractPageId, here.sessionId])
  const back = async () => {
    trail.current.pop()
    const to = trail.current.at(-1) ?? { view: 'home' as View, contractPageId: null, sessionId: null }
    if (to.sessionId) {
      const s = await window.api.review.get(to.sessionId).catch(() => null)
      if (s) setSession(s)
    }
    if (to.contractPageId) setContractPageId(to.contractPageId)
    setView(to.view)
  }
  const canGoBack = trail.current.length > 1

  // ---- active account (remembered) ----
  // The account last used, remembered per workspace (demo mode has its own).
  const accountKey = `clausepilot.activeAccount.${settings?.demoMode === false ? 'live' : 'demo'}`
  const accountKeyRef = useRef(accountKey)
  accountKeyRef.current = accountKey
  const refreshAccounts = useCallback(
    () => Promise.all([window.api.accounts.list().then(setAccounts), window.api.contracts.list().then(setContracts)]),
    []
  )
  const setActiveAccountId = (id: string | null) => {
    setActiveAccountIdState(id)
    try {
      if (id) localStorage.setItem(accountKeyRef.current, id)
      else localStorage.removeItem(accountKeyRef.current)
    } catch {
      /* not remembered, still works for this session */
    }
  }
  useEffect(() => {
    if (!settings) return
    refreshAccounts().then(() => {
      let saved: string | null = null
      try {
        saved = localStorage.getItem(accountKey)
      } catch {
        saved = null
      }
      setActiveAccountIdState(saved)
    })
  }, [!!settings])
  // Forget an active account that no longer exists in this workspace.
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null
  useEffect(() => {
    if (activeAccountId && accounts.length && !activeAccount) setActiveAccountId(null)
  }, [accounts, activeAccountId])
  // Accounts and contracts can be created elsewhere (picker, new-contract page, open-contract dialog).
  useEffect(() => {
    refreshAccounts()
  }, [view, reviews.length])
  // Lists of reviews are always current when you open them (closed, archived, new drafts).
  useEffect(() => {
    if (view === 'reviews' || view === 'contract' || view === 'contracts' || view === 'home') refreshReviews()
  }, [view])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPickerOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // One client at a time: account-tied features only ever see the active account.
  const scopedReviews = activeAccountId ? reviews.filter((r) => r.accountId === activeAccountId) : []
  const accountContracts = contracts.filter((c) => c.accountId === activeAccountId)
  const currentContractId = view === 'contract' ? contractPageId : view === 'review' ? (session?.contractId ?? null) : null
  const contractPage = contracts.find((c) => c.id === contractPageId)
  // Leaving a client behind: its contract pages and reviews close.
  useEffect(() => {
    if ((view === 'contract' || view === 'contracts' || view === 'new-contract' || view === 'reviews') && !activeAccountId) setView('home')
    if (view === 'contract' && contractPage && contractPage.accountId !== activeAccountId) setView('home')
    if (view === 'review' && session?.accountId && session.accountId !== activeAccountId) setView('home')
  }, [activeAccountId])

  const refreshAll = () => {
    refreshReviews()
    refreshAccounts()
  }

  const pending = nominations.filter((n) => n.status === 'pending').length + proposals.filter((p) => p.status === 'pending').length
  const reviewing = view === 'review' && !!session
  // Reviews waiting for the reviewer to move them on (not running meanwhile): the header pill counts them.
  const waitingForYou = forYou(reviews).filter((r) => !jobs.some((j) => j.sessionId === r.id)).length

  return (
    <div className={`app ${isMac ? 'mac' : 'win'}`}>
      <header className="titlebar">
        <button className="icon-btn" onClick={() => setNavOpen((o) => !o)} title={navOpen ? 'Hide menu' : 'Show menu'}>
          <SidebarIcon side="left" open={navOpen} />
        </button>
        <div className="spacer" />
        {/* Background work going on: how much, striped as it moves; opens the queue page. */}
        {(jobs.length > 0 || waitingForYou > 0) && (
          <button className={`work-pill ${jobs.length ? 'busy' : ''} ${view === 'work' ? 'on' : ''}`} onClick={() => setView('work')} title="What’s running in the background, and the reviews waiting for you">
            {[jobs.length ? `Working · ${jobs.filter((j) => j.status === 'running').length}${jobs.some((j) => j.status === 'waiting') ? ` + ${jobs.filter((j) => j.status === 'waiting').length} waiting` : ''}` : '', waitingForYou ? `${waitingForYou} for you` : '']
              .filter(Boolean)
              .join(' · ')}
          </button>
        )}
        {!online && (
          <span className="mode-pill offline has-tip" tabIndex={0}>
            Offline
            <span className="tip" role="tooltip">
              This computer is offline, so Claude is unavailable (a vLLM server on your local network may still work). Everything that doesn't use the AI still works.
            </span>
          </span>
        )}
        {settings && (
          // Which AI the AI steps use; click to change it in Settings.
          <button className={`mode-pill has-tip ${aiReady(settings) ? 'live' : 'nokey'}`} onClick={() => setView('settings')}>
            {aiLabel(settings)}
            <span className="tip" role="tooltip">
              {aiReady(settings)
                ? `AI steps (questions on highlighted text, change review, the Agent) use ${aiOf(settings) === 'vllm' ? `your vLLM server at ${settings.vllmUrl}` : aiOf(settings) === 'demo' ? `the demo server at ${settings.demoUrl} (demo mode)` : 'Claude'}, and only when you ask. Click to change.`
                : 'No AI set up: reviewing, editing, the marked-up copy and the email all work, but the AI steps will say what’s missing. Click to set it up in Settings.'}
            </span>
          </button>
        )}
        {settings && (
          // Demo mode: its own workspace (the demos' data) and the demo server as the AI.
          <button
            className={`demo-switch has-tip ${settings.demoMode ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.demoMode}
            onClick={() => void window.api.settings.setDemoMode(!settings.demoMode)}
          >
            <span className="demo-switch-track">
              <span className="demo-switch-knob" />
            </span>
            Demo mode
            <span className="tip" role="tooltip">
              {settings.demoMode
                ? 'On: the demo workspace (PortSwigger’s clauses and playbook, and an account and contract for each demo), with the demo server answering as the AI. Turn off for your own workspace and AI.'
                : 'Off: your own workspace, with the AI chosen in Settings. Turn on for the demo workspace and the demo server.'}
            </span>
          </button>
        )}
      </header>
      <div className={`body ${navOpen ? '' : 'nav-closed'}`}>
        <NavDrawer
          open={navOpen}
          demoMode={!!settings?.demoMode}
          view={view}
          setView={setView}
          session={session}
          pendingNominations={pending}
          openAlerts={alerts.filter((a) => a.status === 'open').length}
          account={activeAccount}
          contracts={accountContracts}
          reviews={scopedReviews}
          currentContractId={currentContractId}
          canCreateContract
          onOpenContract={(id) => {
            setContractPageId(id)
            setView('contract')
          }}
          onNewContract={() => setView('new-contract')}
          onChooseAccount={() => setPickerOpen(true)}
        />
        {/* Beside the menu: the page, with the review's bar under it, and the review column. */}
        <div className="work">
        <div className="main-col">
        <main className="main">
          {error && (
            <div className="banner danger" style={{ margin: 12 }}>
              <Icon name="alert" /> {error}
            </div>
          )}
          {view === 'home' && (
            <Home
              onOpenReview={openSession}
              onOpenLive={() => (activeAccount ? setOpenModal({}) : setPickerOpen(true))}
              onNavigate={setView}
              account={activeAccount}
              accounts={accounts}
              onChooseAccount={() => setPickerOpen(true)}
            />
          )}
          {reviewing && (
            <Review
              session={session}
              panel={reviewPanel}
              bar={bottomBar}
              foot={reviewFoot}
              head={reviewHead}
              onChange={setSession}
              onNominationsChanged={refreshNominations}
              alert={alerts.find((a) => a.sessionId === session.id) ?? null}
              onOpenSecurity={() => setView('security')}
              accountName={reviews.find((r) => r.id === session.id)?.accountName}
              contractTitle={reviews.find((r) => r.id === session.id)?.contractTitle}
              onOpenReview={openSession}
              debug={!!settings?.debug}
              reviewer={settings?.reviewerName ?? ''}
            />
          )}
          {view === 'review' && !session && <div className="empty">Open a contract to start a review.</div>}
          {view === 'reviews' && <ReviewsView reviews={scopedReviews} accountName={activeAccount?.name} onOpen={openSession} onChanged={refreshAll} />}
          {view === 'contract' && contractPage && activeAccount && (
            <ContractView
              contract={contractPage}
              account={activeAccount}
              reviews={scopedReviews}
              onOpenReview={openSession}
              onUploadDraft={(contractId) => setOpenModal({ contractId })}
              onChanged={refreshAll}
            />
          )}
          {view === 'contracts' && activeAccount && (
            <ContractsListView
              account={activeAccount}
              contracts={accountContracts}
              reviews={scopedReviews}
              canCreate
              onOpen={(id) => {
                setContractPageId(id)
                setView('contract')
              }}
              onNew={() => setView('new-contract')}
              onChanged={refreshAll}
            />
          )}
          {view === 'new-contract' && activeAccount && (
            <NewContractView
              account={activeAccount}
              onCreated={async (c) => {
                await refreshAccounts()
                setContractPageId(c.id)
                setView('contract')
              }}
            />
          )}
          {view === 'library' && <LibraryView />}
          {view === 'questions' && <QuestionsView />}
          {view === 'playbook' && <PlaybookView onProposalsChanged={() => window.api.kb.playbookProposals().then(setProposals)} />}
          {view === 'history' && <HistoryView />}
          {view === 'queue' && <ApprovalsView nominations={nominations} proposals={proposals} onNominations={setNominations} onProposals={setProposals} />}
          {view === 'security' && settings && (
            <SecurityView
              alerts={alerts}
              canResolve={settings.securityReviewer}
              onChange={setAlerts}
              onOpenReview={openSession}
            />
          )}
          {view === 'audit' && <AuditView session={session} />}
          {view === 'work' && <WorkView jobs={jobs} reviews={reviews} onOpenReview={openSession} />}
          {view === 'settings' && settings && (
            <SettingsView
              settings={settings}
              onChange={setSettings}
            />
          )}
        </main>
        {/* The review's actions on the document as a whole, under it: rendered into by a portal. */}
        <div className="bottombar" ref={setBottomBar} hidden={!reviewing}>
          {/* The page before (the review's own buttons follow, through the portal). */}
          <button className="btn sm bottombar-back" onClick={() => void back()} disabled={!canGoBack} title="Back to the page before">
            <Icon name="prev" size={14} /> Back
          </button>
        </div>
        </div>
        {/* Pages without the right sidebar keep its space, so every page has the same width. */}
        {!reviewing && <div className="rightbar-space" aria-hidden="true" />}
        <aside className="rightbar" hidden={!reviewing}>
          {/* What's being reviewed and how it stands, on either tab: rendered into by a portal. */}
          <div className="rightbar-head" ref={setReviewHead} />
          <div className="rightbar-switch">
            <div className="seg full">
              <button className={rightTab === 'review' ? 'on' : ''} onClick={() => setRightTab('review')}>
                Review
              </button>
              <button className={rightTab === 'chat' ? 'on' : ''} onClick={() => setRightTab('chat')}>
                Agent
              </button>
            </div>
          </div>
          {/* The Review view renders its controls into this element through a portal. */}
          <div className="rightbar-body" ref={setReviewPanel} style={{ display: rightTab === 'review' ? undefined : 'none' }} />
          <div className="rightbar-chat" style={{ display: rightTab === 'chat' ? undefined : 'none' }}>
            <ChatPanel session={session} debug={!!settings?.debug} />
          </div>
          {/* Accept / Reject for the selected changes, and the key: rendered into by a portal. */}
          {/* (On the Agent's tab, its message box is the foot instead.) */}
          <div className="rightbar-foot" ref={setReviewFoot} style={{ display: rightTab === 'review' ? undefined : 'none' }} />
        </aside>
        </div>
      </div>
      {pickerOpen && (
        <AccountPicker
          accounts={accounts}
          activeId={activeAccountId}
          canCreate
          onClose={() => setPickerOpen(false)}
          onPick={(id) => {
            setActiveAccountId(id)
            setPickerOpen(false)
          }}
          onCreate={async (name) => {
            const a = await window.api.accounts.create(name)
            await refreshAccounts()
            setActiveAccountId(a.id)
            setPickerOpen(false)
          }}
        />
      )}
      {openModal && activeAccount && (
        <OpenContractModal
          account={activeAccount}
          initialContractId={openModal.contractId}
          onClose={() => setOpenModal(null)}
          onOpen={(path, contractId, origin) => {
            setOpenModal(null)
            openContract(path, contractId, origin)
          }}
        />
      )}
    </div>
  )
}

/** Is an AI set up for the AI steps? */
/** The AI the AI steps use: the demo server in demo mode, otherwise the one chosen in Settings. */
export const aiOf = (s: Settings) => (s.demoMode ? 'demo' : s.aiProvider === 'demo' ? 'claude' : s.aiProvider)
const aiReady = (s: Settings) => (aiOf(s) === 'vllm' ? !!(s.vllmUrl && s.vllmModel) : aiOf(s) === 'demo' ? !!s.demoUrl : s.hasApiKey)
const aiLabel = (s: Settings) =>
  aiOf(s) === 'demo'
    ? aiReady(s)
      ? 'Demo server'
      : 'Demo server · not set up'
    : aiOf(s) === 'vllm'
      ? aiReady(s)
        ? `vLLM · ${s.vllmModel}`
        : 'vLLM · not set up'
      : aiReady(s)
        ? `Claude · ${s.model}`
        : 'Claude · no API key'

/** Tracks the OS network state (Electron mirrors it to navigator.onLine). */
function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
