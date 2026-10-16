import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, ContractRecord, Nomination, PlaybookProposal, ReviewSession, ReviewSummary, SecurityAlert, Settings } from '@shared/types'
import { Icon } from './lib/icons'
import { SidebarIcon } from './lib/sidebarIcons'
import { NavDrawer, type View } from './components/NavDrawer'
import { ChatPanel } from './components/ChatDrawer'
import { Home } from './views/Home'
import { Review } from './views/Review'
import { HistoryView, LibraryView } from './views/KnowledgeView'
import { PlaybookView } from './views/PlaybookView'
import { ApprovalsView } from './views/QueueView'
import { AuditView } from './views/AuditView'
import { SettingsView } from './views/SettingsView'
import { ReviewsView } from './views/ReviewsView'
import { SecurityView } from './views/SecurityView'
import { ContractView, NewContractView } from './views/ContractView'
import { OpenContractModal } from './components/OpenContractModal'
import { AccountPicker } from './components/AccountPicker'
import { TourOverlay, type Tour } from './lib/tour'
import { CONTRACT_TOURS, WELCOME_TOUR } from './onboarding'


const isMac = navigator.userAgent.includes('Mac')

export function App() {
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [navOpen, setNavOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [rightTab, setRightTab] = useState<'review' | 'chat'>('review')
  const [reviewPanel, setReviewPanel] = useState<HTMLDivElement | null>(null)
  const [nominations, setNominations] = useState<Nomination[]>([])
  const [proposals, setProposals] = useState<PlaybookProposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const online = useOnline()
  const [tour, setTour] = useState<Tour | null>(null)
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
  useEffect(
    () =>
      window.api.review.onUpdate((s) => {
        setSession((cur) => (cur && cur.id === s.id ? s : cur))
      }),
    []
  )

  const refreshNominations = useCallback(() => window.api.kb.nominations().then(setNominations), [])
  const decisionCount = session ? Object.keys(session.decisions).length : 0
  useEffect(() => {
    refreshReviews()
  }, [decisionCount, session?.id])

  const openContract = useCallback(async (path: string, contractId?: string) => {
    setError(null)
    try {
      const s = await window.api.review.start(path, contractId)
      setSession(s)
      if (s.accountId) setActiveAccountId(s.accountId) // e.g. starting a demo for another client
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
  }, [settings?.demoMode])

  // Demo and live are separate workspaces: when the mode changes, drop everything on screen
  // and reload from the newly selected workspace.
  const reloadWorkspace = useCallback(() => {
    setSession(null)
    setView('home')
    setContractPageId(null)
    window.api.kb.nominations().then(setNominations)
    window.api.kb.playbookProposals().then(setProposals)
    refreshReviews()
    refreshAlerts()
  }, [refreshReviews, refreshAlerts])
  const mode = settings?.demoMode
  const firstMode = useRef(true)
  useEffect(() => {
    if (mode === undefined) return
    if (firstMode.current) {
      firstMode.current = false
      return
    }
    reloadWorkspace()
  }, [mode])

  // ---- active account (remembered per workspace) ----
  const accountKey = `clausepilot.activeAccount.${settings?.demoMode ? 'demo' : 'live'}`
  // Long-lived callbacks (openContract, openSession) read the key through a ref so they never use a stale mode.
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
  }, [settings?.demoMode])
  // Forget an active account that no longer exists in this workspace.
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null
  useEffect(() => {
    if (activeAccountId && accounts.length && !activeAccount) setActiveAccountId(null)
  }, [accounts, activeAccountId])
  // Accounts and contracts can be created elsewhere (picker, new-contract page, open-contract dialog).
  useEffect(() => {
    refreshAccounts()
  }, [view, reviews.length])
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
    if ((view === 'contract' || view === 'new-contract' || view === 'reviews') && !activeAccountId) setView('home')
    if (view === 'contract' && contractPage && contractPage.accountId !== activeAccountId) setView('home')
    if (view === 'review' && session?.accountId && session.accountId !== activeAccountId) setView('home')
  }, [activeAccountId])

  const pending = nominations.filter((n) => n.status === 'pending').length + proposals.filter((p) => p.status === 'pending').length
  const reviewing = view === 'review' && !!session

  return (
    <div className={`app ${isMac ? 'mac' : 'win'}`}>
      <header className="titlebar">
        <button className="icon-btn" onClick={() => setNavOpen((o) => !o)} title={navOpen ? 'Hide menu' : 'Show menu'}>
          <SidebarIcon side="left" open={navOpen} />
        </button>
        <button className={`account-switch ${activeAccount ? '' : 'none'}`} onClick={() => setPickerOpen(true)} title="Choose the active account (⌘K)">
          <Icon name="users" size={15} />
          <span>{activeAccount?.name ?? 'Choose an account'}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div className="spacer" />
        {!online && (
          <span className="mode-pill offline has-tip" tabIndex={0}>
            Offline
            <span className="tip" role="tooltip">
              This computer is offline, so AI checks, Ask AI and sync features are unavailable. Matching against the pre-approved library, precedent search and recorded (demo) results still work.
            </span>
          </span>
        )}
        {settings && (
          <button
            className={`mode-pill has-tip ${settings.demoMode ? 'demo' : settings.hasApiKey ? 'live' : 'nokey'}`}
            onClick={async () => setSettings(await window.api.settings.save({ demoMode: !settings.demoMode }))}
          >
            {settings.demoMode ? 'Demo mode' : settings.hasApiKey ? `Live · ${settings.model}` : 'Live · no API key'}
            <span className="tip" role="tooltip">
              {settings.demoMode
                ? 'Demo mode: sample contracts and recorded AI responses, nothing leaves this computer. Click to switch to live mode and open your own contracts.'
                : settings.hasApiKey
                  ? 'Live mode: your own contracts, checked by Claude. Click to switch back to demo mode.'
                  : 'Live mode without an API key: library matching and precedent search work, but AI checks will fail. Add a key in Settings, or click to switch back to demo mode.'}
            </span>
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => setRightOpen((o) => !o)}
          disabled={!reviewing}
          title={rightOpen ? 'Hide review panel' : 'Show review panel'}
        >
          <SidebarIcon side="right" open={rightOpen && reviewing} />
        </button>
      </header>
      <div className="body">
        <NavDrawer
          open={navOpen}
          view={view}
          setView={setView}
          session={session}
          pendingNominations={pending}
          openAlerts={alerts.filter((a) => a.status === 'open').length}
          account={activeAccount}
          contracts={accountContracts}
          reviews={scopedReviews}
          currentContractId={currentContractId}
          canCreateContract={!settings?.demoMode}
          onOpenContract={(id) => {
            setContractPageId(id)
            setView('contract')
          }}
          onNewContract={() => setView('new-contract')}
          onChooseAccount={() => setPickerOpen(true)}
        />
        <main className="main">
          {error && (
            <div className="banner danger" style={{ margin: 12 }}>
              <Icon name="alert" /> {error}
            </div>
          )}
          {view === 'home' && (
            <Home
              demoMode={!!settings?.demoMode}
              onOpen={openContract}
              onOpenLive={() => (activeAccount ? setOpenModal({}) : setPickerOpen(true))}
              onGuided={async (file, path, contractId) => {
                await openContract(path, contractId)
                const t = CONTRACT_TOURS[file]
                if (t) setTour({ ...t })
              }}
              onWelcome={() => setTour({ ...WELCOME_TOUR })}
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
              onChange={setSession}
              onNominationsChanged={refreshNominations}
              alert={alerts.find((a) => a.sessionId === session.id) ?? null}
              onOpenSecurity={() => setView('security')}
              accountName={reviews.find((r) => r.id === session.id)?.accountName}
              contractTitle={reviews.find((r) => r.id === session.id)?.contractTitle}
              onOpenReview={openSession}
            />
          )}
          {view === 'review' && !session && <div className="empty">Open a contract to start a review.</div>}
          {view === 'reviews' && <ReviewsView reviews={scopedReviews} accountName={activeAccount?.name} onOpen={openSession} />}
          {view === 'contract' && contractPage && activeAccount && (
            <ContractView
              contract={contractPage}
              account={activeAccount}
              demoMode={!!settings?.demoMode}
              reviews={scopedReviews}
              onOpenReview={openSession}
              onUploadDraft={(contractId) => setOpenModal({ contractId })}
              onStartDemo={(path, contractId) => openContract(path, contractId)}
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
          {view === 'playbook' && <PlaybookView onProposalsChanged={() => window.api.kb.playbookProposals().then(setProposals)} />}
          {view === 'history' && <HistoryView />}
          {view === 'queue' && <ApprovalsView nominations={nominations} proposals={proposals} onNominations={setNominations} onProposals={setProposals} />}
          {view === 'security' && settings && (
            <SecurityView
              alerts={alerts}
              canResolve={settings.demoMode || settings.securityReviewer}
              demoMode={settings.demoMode}
              onChange={setAlerts}
              onOpenReview={openSession}
            />
          )}
          {view === 'audit' && <AuditView session={session} />}
          {view === 'settings' && settings && (
            <SettingsView
              settings={settings}
              onChange={setSettings}
              onResetDemo={async () => {
                await window.api.demo.reset()
                reloadWorkspace()
              }}
              onRestartTour={() => {
                setView('home')
                setTour(WELCOME_TOUR)
              }}
            />
          )}
        </main>
        <aside className={`rightbar ${rightOpen && reviewing ? '' : 'closed'}`} aria-hidden={!(rightOpen && reviewing)}>
          <div className="rightbar-switch">
            <div className="seg full">
              <button className={rightTab === 'review' ? 'on' : ''} onClick={() => setRightTab('review')}>
                Review
              </button>
              <button className={rightTab === 'chat' ? 'on' : ''} onClick={() => setRightTab('chat')}>
                Ask AI
              </button>
            </div>
          </div>
          {/* The Review view renders its controls into this element through a portal. */}
          <div className="rightbar-body" ref={setReviewPanel} style={{ display: rightTab === 'review' ? undefined : 'none' }} />
          <div className="rightbar-chat" style={{ display: rightTab === 'chat' ? undefined : 'none' }}>
            <ChatPanel session={session} />
          </div>
        </aside>
      </div>
      {pickerOpen && (
        <AccountPicker
          accounts={accounts}
          activeId={activeAccountId}
          canCreate={!settings?.demoMode}
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
          onOpen={(path, contractId) => {
            setOpenModal(null)
            openContract(path, contractId)
          }}
        />
      )}
      {tour && (
        <TourOverlay
          key={tour.id}
          tour={tour}
          ctx={{
            showReviewPanels: () => {
              setNavOpen(true)
              setRightOpen(true)
            },
            setRightTab
          }}
          onClose={() => setTour(null)}
        />
      )}
    </div>
  )
}

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
