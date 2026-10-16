import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nomination, PlaybookProposal, ReviewSession, ReviewSummary, SecurityAlert, Settings } from '@shared/types'
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

  const openContract = useCallback(async (path: string) => {
    setError(null)
    try {
      const s = await window.api.review.start(path)
      setSession(s)
      refreshReviews()
      setView('review')
      setRightTab('review')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    setSession(await window.api.review.get(id))
    setView('review')
  }, [])

  // Demo and live are separate workspaces: when the mode changes, drop everything on screen
  // and reload from the newly selected workspace.
  const reloadWorkspace = useCallback(() => {
    setSession(null)
    setView('home')
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

  const pending = nominations.filter((n) => n.status === 'pending').length + proposals.filter((p) => p.status === 'pending').length
  const reviewing = view === 'review' && !!session

  return (
    <div className={`app ${isMac ? 'mac' : 'win'}`}>
      <header className="titlebar">
        <button className="icon-btn" onClick={() => setNavOpen((o) => !o)} title={navOpen ? 'Hide menu' : 'Show menu'}>
          <SidebarIcon side="left" open={navOpen} />
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
          reviews={reviews}
          onOpenReview={openSession}
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
              onGuided={async (file, path) => {
                await openContract(path)
                const t = CONTRACT_TOURS[file]
                if (t) setTour({ ...t })
              }}
              onWelcome={() => setTour({ ...WELCOME_TOUR })}
              onNavigate={setView}
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
            />
          )}
          {view === 'review' && !session && <div className="empty">Open a contract to start a review.</div>}
          {view === 'reviews' && <ReviewsView reviews={reviews} onOpen={openSession} />}
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
