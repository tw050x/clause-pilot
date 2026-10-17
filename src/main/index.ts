import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userInfo } from 'node:os'
import type { Account, ContractRecord, ChatMessage, Decision, DemoContract, EmailDraft, LibraryClause, Nomination, PlaybookPosition, PlaybookProposal, ReviewSession, SecurityAlert, Settings } from '@shared/types'
import { clauseLabel, flagsFor, isCleared } from '@shared/derive'
import { Store } from './store'
import { AuditLog } from './audit'
import { parseFile } from './ingest/parse'
import { createSession, runPipeline } from './pipeline'
import { compareVersions } from './engine/versions'
import { DEMO_SCENARIOS } from '@shared/demoScenarios'
import { AnthropicProvider, RecordingProvider, RecordingStore, ReplayProvider, type AiProvider } from './ai/provider'
import { emailBrief, templateEmail } from './email'
import { buildRedline } from './redline/docx'
import { createHash } from 'node:crypto'
import { chatSystem, offlineAnswer } from './chat'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MODEL = 'claude-opus-5-5'
const appRoot = process.env.CLAUSEPILOT_APP_ROOT ?? app.getAppPath()
// Where reviews, workspaces, settings and the API key live. Running from source uses its own
// folder so development never touches the installed app's data; CLAUSEPILOT_USER_DATA
// overrides both (used for isolated test runs). An explicit setPath (e.g. by a test
// harness) is left alone.
const defaultUserData = join(app.getPath('appData'), app.getName())
if (process.env.CLAUSEPILOT_USER_DATA) app.setPath('userData', process.env.CLAUSEPILOT_USER_DATA)
else if (!app.isPackaged && app.getPath('userData') === defaultUserData) app.setPath('userData', join(app.getPath('appData'), `${app.getName()} (Dev)`))
const userDir = app.getPath('userData')
// ---- workspaces ------------------------------------------------------------------
// Demo and live data never mix. The demo workspace is seeded with the sample library,
// playbook and history, and replays bundled AI recordings. The live workspace starts
// empty, as it would on day one for a real team, and records its own live responses.

type Mode = 'demo' | 'live'
interface Workspace {
  mode: Mode
  dir: string
  store: Store
  audit: AuditLog
  recordings: RecordingStore
}

function openWorkspace(mode: Mode): Workspace {
  const dir = join(userDir, 'workspaces', mode)
  const store = new Store(dir, join(appRoot, mode === 'demo' ? 'data/seed' : 'data/seed-empty'))
  const recordings =
    mode === 'demo'
      ? new RecordingStore([join(appRoot, 'demo/recordings')])
      : new RecordingStore([join(dir, 'recordings')], join(dir, 'recordings'))
  return { mode, dir, store, audit: new AuditLog(join(dir, 'audit.jsonl')), recordings }
}

let ws: Workspace
/** Which workspace each review belongs to, so a review keeps writing to its own workspace after a switch. */
const sessionWs = new Map<string, Workspace>()
const sessions = new Map<string, ReviewSession>()
let win: BrowserWindow | null = null

// ---- settings & secrets ---------------------------------------------------------

const settingsFile = join(userDir, 'settings.json')
const keyFile = join(userDir, 'anthropic-key.bin')

type StoredSettings = Omit<Settings, 'hasApiKey'>
function loadSettings(): StoredSettings {
  const defaults: StoredSettings = { reviewerName: userInfo().username, demoMode: true, model: DEFAULT_MODEL, recordLiveResponses: true, securityReviewer: false }
  return existsSync(settingsFile) ? { ...defaults, ...JSON.parse(readFileSync(settingsFile, 'utf8')) } : defaults
}
const settings = (): Settings => ({ ...loadSettings(), hasApiKey: !!apiKey() })

/** The API key is encrypted with the OS keychain (safeStorage); it never reaches the renderer. */
function apiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  if (!existsSync(keyFile) || !safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(readFileSync(keyFile))
}

/** Live mode without a key: deterministic checks still run; every AI check explains what's missing. */
const noKey = () => Promise.reject(new Error('No Anthropic API key. Add one in Settings to run AI checks.'))
const noKeyProvider: AiProvider = { kind: 'anthropic', intent: noKey, overrides: noKey, position: noKey }

function provider(): AiProvider {
  const s = loadSettings()
  const key = apiKey()
  if (s.demoMode) return new ReplayProvider(ws.recordings)
  if (!key) return noKeyProvider
  const live = new AnthropicProvider(key, s.model)
  return s.recordLiveResponses ? new RecordingProvider(live, ws.recordings) : live
}

const actor = () => loadSettings().reviewerName
ws = openWorkspace(loadSettings().demoMode ? 'demo' : 'live')

// ---- window ---------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 640,
    title: 'Clause Pilot',
    backgroundColor: '#ffffff',
    // Frameless: the app draws its own 44px top bar. macOS keeps its traffic lights
    // (centred in that bar); Windows/Linux get native buttons overlaid on the right.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: '#ffffff', symbolColor: '#57606a', height: 44 } }),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // No navigation away from the app and no new windows: links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(here, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())

// ---- helpers ----------------------------------------------------------------------

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

const wsFor = (s: ReviewSession) => sessionWs.get(s.id) ?? ws

function persist(s: ReviewSession) {
  wsFor(s).store.saveSession(s)
  send('session:update', s)
}

let persistTimer: NodeJS.Timeout | null = null
function emitThrottled(s: ReviewSession) {
  send('session:update', s)
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    wsFor(s).store.saveSession(s)
  }, 400)
}

function session(id: string): ReviewSession {
  const s = sessions.get(id) ?? ws.store.loadSession(id)
  if (!s) throw new Error(`Unknown session ${id}`)
  sessions.set(id, s)
  return s
}

const resolvePath = (p: string) => (isAbsolute(p) ? p : join(appRoot, p))
const counterpartyOf = (s: ReviewSession) => s.docName.split(/[-_ ]/)[0]

// ---- IPC: settings ------------------------------------------------------------------

ipcMain.handle('settings:get', () => settings())
ipcMain.handle('settings:save', (_e, patch: Partial<StoredSettings>) => {
  const prev = loadSettings()
  const next = { ...prev, ...patch }
  writeFileSync(settingsFile, JSON.stringify(next, null, 2))
  ws.audit.append(next.reviewerName, 'settings.changed', null, { ...patch })
  if (next.demoMode !== prev.demoMode) switchWorkspace(next.demoMode ? 'demo' : 'live')
  return settings()
})

function switchWorkspace(mode: Mode) {
  ws = openWorkspace(mode)
  sessions.clear()
  ws.audit.append(actor(), 'workspace.opened', null, { mode })
}

/** Wipe the demo workspace back to its seeded state (so every demo starts the same way). */
ipcMain.handle('demo:reset', () => {
  if (ws.mode === 'demo') sessions.clear()
  rmSync(join(userDir, 'workspaces', 'demo'), { recursive: true, force: true })
  if (ws.mode === 'demo') ws = openWorkspace('demo')
  return true
})

/**
 * Set up a demo from a clean slate: reset the demo workspace, then review any
 * earlier drafts the scenario needs (instant replay, scripted decisions) so the
 * demo starts exactly where its story begins.
 */
ipcMain.handle('demo:prepare', async (_e, scenarioId: string) => {
  const scenario = DEMO_SCENARIOS.find((d) => d.id === scenarioId)
  if (!scenario) throw new Error('Unknown demo.')
  if (!loadSettings().demoMode) throw new Error('Switch demo mode on to run a demo.')
  sessions.clear()
  rmSync(join(userDir, 'workspaces', 'demo'), { recursive: true, force: true })
  ws = openWorkspace('demo')
  const w = ws
  const instant = new ReplayProvider(w.recordings, [0, 0])
  for (const step of scenario.history) {
    const demo = demoContracts().find((d) => d.file === step.file)!
    const s = createSession(await parseFile(resolvePath(demo.path)), demo.path, 'demo')
    const versions = w.store.versionsOf(scenario.contractId)
    const prev = versions[versions.length - 1]
    Object.assign(s, { accountId: scenario.accountId, contractId: scenario.contractId, version: (prev?.version ?? 0) + 1 })
    if (prev) {
      const { links, removed } = compareVersions(prev, s.clauses)
      Object.assign(s, { previous: { sessionId: prev.id, version: prev.version ?? 1 }, versionLinks: links, removed })
    }
    sessions.set(s.id, s)
    sessionWs.set(s.id, w)
    await runPipeline(s, {
      ai: instant,
      library: w.store.library(),
      precedents: w.store.precedents(),
      playbook: w.store.playbook(),
      emit: () => {},
      audit: (type, payload) => w.audit.append('system', type, s.id, payload)
    })
    for (const d of step.decisions) {
      const c =
        d.clause === 'parties' ? s.clauses.find((x) => !x.number && x.heading !== 'EXECUTION') : d.clause === 'signature' ? s.clauses.find((x) => x.heading === 'EXECUTION') : s.clauses.find((x) => x.number === d.clause)
      if (c) decide(s, { clauseId: c.id, decision: d.decision, note: d.note, redline: d.redline ?? '', nominate: false }, 'demo-setup')
    }
    w.store.saveSession(s)
  }
  w.audit.append(actor(), 'demo.prepared', null, { scenario: scenario.id, earlierDrafts: scenario.history.length })
  return true
})

ipcMain.handle('workspace:summary', () => ({
  mode: ws.mode,
  library: ws.store.library().length,
  playbook: ws.store.playbook().length,
  precedents: ws.store.precedents().length,
  reviews: ws.store.listSessions().length,
  openAlerts: ws.store.securityAlerts().filter((a) => a.status === 'open').length,
  nominations: ws.store.nominations().length
}))
ipcMain.handle('settings:setApiKey', (_e, key: string | null) => {
  if (!key) rmSync(keyFile, { force: true })
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is not available; set ANTHROPIC_API_KEY instead.')
    writeFileSync(keyFile, safeStorage.encryptString(key.trim()))
  }
  ws.audit.append(actor(), key ? 'settings.api-key-set' : 'settings.api-key-cleared', null, {})
  return settings()
})

// ---- IPC: documents & pipeline ------------------------------------------------------

const demoContracts = (): DemoContract[] => JSON.parse(readFileSync(join(appRoot, 'demo/contracts/index.json'), 'utf8'))
ipcMain.handle('demo:list', () => demoContracts())

ipcMain.handle('file:open', async () => {
  // Demo mode only works with the bundled contracts (they are the ones with recorded AI responses).
  if (loadSettings().demoMode) throw new Error('Opening your own contracts is disabled in demo mode. Switch demo mode off to open a file.')
  const res = await dialog.showOpenDialog(win!, {
    title: 'Open a contract',
    properties: ['openFile'],
    filters: [{ name: 'Contracts', extensions: ['pdf', 'docx', 'txt', 'doc'] }]
  })
  return res.canceled ? null : res.filePaths[0]
})

ipcMain.handle('file:bytes', async (_e, path: string) => new Uint8Array(await readFile(resolvePath(path))))

// ---- IPC: accounts and contracts -------------------------------------------------------------

ipcMain.handle('accounts:list', () => ws.store.accounts())
ipcMain.handle('accounts:create', (_e, name: string) => {
  if (!name.trim()) throw new Error('Give the account a name.')
  const account: Account = { id: `ac-${Date.now().toString(36)}`, name: name.trim(), createdAt: new Date().toISOString() }
  ws.store.saveAccounts([...ws.store.accounts(), account])
  ws.audit.append(actor(), 'account.created', null, { accountId: account.id, name: account.name })
  return account
})
ipcMain.handle('contracts:list', () => ws.store.contracts())
ipcMain.handle('contracts:create', (_e, accountId: string, title: string) => {
  if (!ws.store.accounts().some((a) => a.id === accountId)) throw new Error('Unknown account.')
  if (!title.trim()) throw new Error('Give the contract a name.')
  const contract: ContractRecord = { id: `ct-${Date.now().toString(36)}`, accountId, title: title.trim(), contractType: 'general', createdAt: new Date().toISOString() }
  ws.store.saveContracts([...ws.store.contracts(), contract])
  ws.audit.append(actor(), 'contract.created', null, { contractId: contract.id, accountId, title: contract.title })
  return contract
})
ipcMain.handle('contracts:versions', (_e, contractId: string) => ws.store.listSessions().filter((s) => s.contractId === contractId))

ipcMain.handle('review:start', async (_e, path: string, contractId?: string) => {
  if (loadSettings().demoMode && !demoContracts().some((d) => d.path === path))
    throw new Error('Demo mode can only review the demo contracts. Switch demo mode off to review your own.')
  const doc = await parseFile(resolvePath(path))
  const ai = provider()
  const s = createSession(doc, path, ai.kind === 'replay' ? 'demo' : 'live')
  const w = ws
  // A draft of a known contract becomes its next version, compared with the one before.
  const contract = contractId ? w.store.contracts().find((c) => c.id === contractId) : undefined
  if (contractId && !contract) throw new Error('Unknown contract.')
  if (contract) {
    const versions = w.store.versionsOf(contract.id)
    const prev = versions[versions.length - 1]
    Object.assign(s, { accountId: contract.accountId, contractId: contract.id, version: (prev?.version ?? 0) + 1 })
    if (prev) {
      const { links, removed } = compareVersions(sessions.get(prev.id) ?? prev, s.clauses)
      Object.assign(s, { previous: { sessionId: prev.id, version: prev.version ?? 1 }, versionLinks: links, removed })
    }
    if (contract.contractType === 'general' && s.contractType !== 'general') {
      contract.contractType = s.contractType
      w.store.saveContracts(w.store.contracts().map((c) => (c.id === contract.id ? contract : c)))
    }
  }
  sessions.set(s.id, s)
  sessionWs.set(s.id, w)
  w.audit.append(actor(), 'session.created', s.id, {
    docName: s.docName,
    sha256: s.fileSha256,
    clauses: s.clauses.length,
    mode: s.mode,
    contractId: s.contractId ?? null,
    version: s.version ?? null,
    comparedWith: s.previous?.sessionId ?? null
  })
  persist(s)
  runPipeline(s, {
    ai,
    library: w.store.library(),
    precedents: w.store.precedents(),
    playbook: w.store.playbook(),
    emit: emitThrottled,
    audit: (type, payload) => w.audit.append('system', type, s.id, payload)
  })
    .catch((e) => w.audit.append('system', 'pipeline.failed', s.id, { error: String(e) }))
    .finally(() => {
      syncSecurityAlert(w, s) // adds anything the model reported once the checks finish
      persist(s)
    })
  // The local screen runs synchronously at the start of the pipeline, so the security team
  // is alerted before any AI call is made.
  syncSecurityAlert(w, s)
  return s
})

// ---- security alerts -------------------------------------------------------------------------
// Text addressed to an AI reviewer is a security event, not just a contract issue. The review
// goes on hold until someone on the security team has looked at it.

/** Raise (or update) the alert for a review with suspected prompt injection. */
function syncSecurityAlert(w: Workspace, s: ReviewSession) {
  const flagged = Object.entries(s.injection)
  if (!flagged.length && !s.aiInjectionReports.length) return
  const alerts = w.store.securityAlerts()
  const existing = alerts.find((a) => a.sessionId === s.id)
  const clauses = flagged.map(([id, hits]) => {
    const c = s.clauses.find((x) => x.id === id)!
    return { clauseId: id, label: clauseLabel(c), text: c.text, hits }
  })
  // Each AI check reports separately ("Override check: …"); group identical notes and count the checks.
  const byNote = new Map<string, number>()
  for (const r of s.aiInjectionReports) {
    const note = r.slice(r.indexOf(': ') + 2)
    byNote.set(note, (byNote.get(note) ?? 0) + 1)
  }
  const aiNotes = [...byNote].map(([note, n]) => (n > 1 ? `${note} (reported by ${n} separate checks)` : note))
  if (!existing) {
    const alert: SecurityAlert = { id: `sa-${Date.now().toString(36)}`, sessionId: s.id, docName: s.docName, raisedAt: new Date().toISOString(), clauses, aiNotes, status: 'open' }
    w.store.saveSecurityAlerts([...alerts, alert])
    w.audit.append('system', 'security.alert-raised', s.id, { alertId: alert.id, clauses: clauses.map((c) => c.label), patterns: clauses.flatMap((c) => c.hits) })
    send('security:update', null)
  } else if (aiNotes.length !== existing.aiNotes.length || clauses.length !== existing.clauses.length) {
    Object.assign(existing, { clauses, aiNotes })
    w.store.saveSecurityAlerts(alerts)
    w.audit.append('system', 'security.alert-updated', s.id, { alertId: existing.id, aiNotes: aiNotes.length })
    send('security:update', null)
  }
}

const alertFor = (sessionId: string) => ws.store.securityAlerts().find((a) => a.sessionId === sessionId)
const canResolveSecurity = () => loadSettings().demoMode || loadSettings().securityReviewer

ipcMain.handle('security:list', () => ws.store.securityAlerts())

ipcMain.handle('security:resolve', (_e, id: string, outcome: 'malicious' | 'false-positive', note: string) => {
  if (!canResolveSecurity()) throw new Error('Only the security team can resolve security alerts.')
  if (outcome === 'false-positive' && !note.trim()) throw new Error('Explain why this is a false positive.')
  const alerts = ws.store.securityAlerts()
  const a = alerts.find((x) => x.id === id)
  if (!a || a.status !== 'open') throw new Error('This alert is no longer open.')
  Object.assign(a, { status: outcome, resolvedBy: actor(), resolvedAt: new Date().toISOString(), note: note.trim() })
  ws.store.saveSecurityAlerts(alerts)
  ws.audit.append(actor(), 'security.alert-resolved', a.sessionId, { alertId: id, outcome, note: a.note })
  return ws.store.securityAlerts()
})

ipcMain.handle('review:get', (_e, id: string) => session(id))
ipcMain.handle('review:list', () => ws.store.listSessions())

// ---- IPC: decisions ------------------------------------------------------------------

function decide(s: ReviewSession, d: Omit<Decision, 'by' | 'at'>, via: string) {
  const c = s.clauses.find((x) => x.id === d.clauseId)
  if (!c) throw new Error('Unknown clause')
  // A flagged clause can't be accepted while security is reviewing it, or once they've confirmed the attempt.
  const alert = alertFor(s.id)
  if (d.decision === 'accepted' && s.injection[c.id] && alert && alert.status !== 'false-positive')
    throw new Error(
      alert.status === 'open'
        ? 'This clause is on security hold. It can be accepted only if the security team marks the alert as a false positive.'
        : 'The security team confirmed this as an injection attempt. The clause has to be rejected.'
    )
  const decision: Decision = { ...d, by: actor(), at: new Date().toISOString() }
  const previous = s.decisions[c.id]
  s.decisions[c.id] = decision
  ws.audit.append(decision.by, previous ? 'decision.changed' : 'decision.made', s.id, {
    clauseId: c.id,
    clause: clauseLabel(c),
    decision: decision.decision,
    note: decision.note,
    redline: decision.redline,
    nominate: decision.nominate,
    via,
    previous: previous?.decision ?? null,
    aiMatch: s.match[c.id]?.data?.kind ?? null
  })

  // Every human decision becomes negotiation history for step (b) next time,
  // unless it is a word-for-word library clause (nothing new to learn).
  if (s.match[c.id]?.data?.kind !== 'exact') {
    ws.store.upsertPrecedent({
      id: `rv-${s.id.slice(0, 8)}-${c.id}`,
      contractType: s.contractType,
      category: c.heading ? c.heading.charAt(0) + c.heading.slice(1).toLowerCase() : 'General',
      counterparty: counterpartyOf(s),
      date: decision.at.slice(0, 10),
      text: c.text,
      outcome: decision.decision,
      notes: decision.note || `${decision.decision === 'accepted' ? 'Accepted' : 'Rejected'} in review of ${s.docName}.`,
      source: 'review'
    })
  }

  const nominations = ws.store.nominations().filter((n) => n.id !== `nm-${s.id}-${c.id}` || n.status !== 'pending')
  if (decision.decision === 'accepted' && decision.nominate) {
    nominations.push({
      id: `nm-${s.id}-${c.id}`,
      text: c.text,
      category: c.heading ?? 'General',
      contractType: s.contractType,
      fromDoc: s.docName,
      counterparty: counterpartyOf(s),
      nominatedBy: decision.by,
      nominatedAt: decision.at,
      note: decision.note,
      status: 'pending'
    })
  }
  ws.store.saveNominations(nominations)
}

ipcMain.handle('review:decide', (_e, sessionId: string, d: Omit<Decision, 'by' | 'at'>) => {
  const s = session(sessionId)
  decide(s, d, 'manual')
  persist(s)
  return s
})

ipcMain.handle('review:undo', (_e, sessionId: string, clauseId: string) => {
  const s = session(sessionId)
  const prev = s.decisions[clauseId]
  if (prev) {
    delete s.decisions[clauseId]
    ws.store.removePrecedent(`rv-${s.id.slice(0, 8)}-${clauseId}`)
    ws.store.saveNominations(ws.store.nominations().filter((n) => !(n.id === `nm-${s.id}-${clauseId}` && n.status === 'pending')))
    ws.audit.append(actor(), 'decision.withdrawn', s.id, { clauseId, previous: prev.decision })
  }
  persist(s)
  return s
})

// ---- IPC: outputs ----------------------------------------------------------------------

ipcMain.handle('email:draft', async (_e, sessionId: string): Promise<EmailDraft> => {
  const s = session(sessionId)
  if (alertFor(s.id)?.status === 'open') throw new Error('This review is on security hold. Nothing can go back to the counterparty until the security team has reviewed the alert.')
  const reviewer = actor()
  const key = apiKey()
  let draft: EmailDraft
  if (loadSettings().demoMode || !key) draft = templateEmail(s, reviewer)
  else {
    try {
      const out = await new AnthropicProvider(key, loadSettings().model).email(emailBrief(s, reviewer).prompt)
      draft = { ...out, generatedBy: 'ai' }
    } catch (e) {
      draft = templateEmail(s, reviewer)
      ws.audit.append('system', 'email.ai-failed', s.id, { error: String(e) })
    }
  }
  ws.audit.append(reviewer, 'email.drafted', s.id, { generatedBy: draft.generatedBy, rejected: Object.values(s.decisions).filter((d) => d.decision === 'rejected').length })
  return draft
})

/** Our response as a marked-up Word copy: tracked changes for our wording, comments for our reasons. */
async function redline(sessionId: string) {
  const s = session(sessionId)
  if (alertFor(s.id)?.status === 'open') throw new Error('This review is on security hold. Nothing can go back to the counterparty until the security team has reviewed the alert.')
  const out = await buildRedline(s, actor(), await readFile(resolvePath(s.filePath)))
  return { s, ...out, name: `${s.docName.replace(/\.[a-z]+$/i, '')} - PortSwigger comments.docx` }
}
const savedRedlines = new Set<string>()

ipcMain.handle('redline:preview', async (_e, sessionId: string) => {
  const { bytes, stats, comments, name } = await redline(sessionId)
  return { bytes: new Uint8Array(bytes), stats, comments, name }
})
ipcMain.handle('redline:save', async (_e, sessionId: string) => {
  const { s, bytes, stats, name } = await redline(sessionId)
  const res = await dialog.showSaveDialog(win!, { title: 'Save marked-up copy', defaultPath: name, filters: [{ name: 'Word document', extensions: ['docx'] }] })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, bytes)
  savedRedlines.add(res.filePath)
  ws.audit.append(actor(), 'redline.exported', s.id, { file: res.filePath, sha256: createHash('sha256').update(bytes).digest('hex'), ...stats })
  return res.filePath
})
// Only files this app just saved can be opened (in Word, or whatever handles .docx).
ipcMain.handle('redline:open', async (_e, path: string) => {
  if (!savedRedlines.has(path)) throw new Error('Unknown file.')
  const err = await shell.openPath(path)
  if (err) throw new Error(err)
})

ipcMain.handle('chat:send', async (_e, sessionId: string, history: ChatMessage[], requestId: string) => {
  const s = session(sessionId)
  const key = apiKey()
  const question = history[history.length - 1]?.content ?? ''
  ws.audit.append(actor(), 'chat.question', s.id, { question })
  if (loadSettings().demoMode || !key) {
    const answer = offlineAnswer(s, question)
    for (const chunk of answer.match(/.{1,24}/gs) ?? []) {
      send('chat:delta', { requestId, text: chunk })
      await new Promise((r) => setTimeout(r, 18))
    }
    return answer
  }
  return new AnthropicProvider(key, loadSettings().model).chat(chatSystem(s), history, (text) => send('chat:delta', { requestId, text }))
})

// ---- IPC: knowledge base -------------------------------------------------------------------

ipcMain.handle('kb:library', () => ws.store.library())
ipcMain.handle('kb:playbook', () => ws.store.playbook())
ipcMain.handle('kb:precedents', () => ws.store.precedents())
ipcMain.handle('kb:nominations', () => ws.store.nominations())

ipcMain.handle('kb:promote', (_e, id: string, title: string, category: string) => {
  const all = ws.store.nominations()
  const n = all.find((x) => x.id === id)
  if (!n || n.status !== 'pending') throw new Error('Nomination not pending')
  const clause: LibraryClause = {
    id: `lib-${Date.now().toString(36)}`,
    contractType: n.contractType,
    category,
    title,
    text: n.text,
    approvedBy: actor(),
    approvedOn: new Date().toISOString().slice(0, 10)
  }
  ws.store.addLibraryClause(clause)
  n.status = 'promoted'
  ws.store.saveNominations(all)
  ws.audit.append(actor(), 'library.promoted', null, { nominationId: id, libraryId: clause.id, title, fromDoc: n.fromDoc })
  return ws.store.nominations()
})

// ---- IPC: playbook changes (proposed, then approved by the playbook owner) ------------
// There are no accounts in this demo, so the same local user can both propose and approve,
// but the flow, data and audit trail are the ones a multi-user deployment would need.

ipcMain.handle('kb:playbookProposals', () => ws.store.playbookProposals())

ipcMain.handle(
  'kb:proposePlaybook',
  (_e, p: { kind: PlaybookProposal['kind']; positionId: string | null; after: PlaybookPosition | null; reason: string }) => {
    const before = p.positionId ? ws.store.playbook().find((x) => x.id === p.positionId) ?? null : null
    if (p.kind !== 'add' && !before) throw new Error('That playbook position no longer exists.')
    if (p.kind !== 'delete' && (!p.after?.title.trim() || !p.after.standard.trim())) throw new Error('A position needs at least a title and a standard.')
    const proposal: PlaybookProposal = {
      id: `pp-${Date.now().toString(36)}`,
      kind: p.kind,
      positionId: p.positionId,
      before,
      after: p.kind === 'delete' ? null : p.after,
      reason: p.reason,
      proposedBy: actor(),
      proposedAt: new Date().toISOString(),
      status: 'pending'
    }
    ws.store.savePlaybookProposals([...ws.store.playbookProposals(), proposal])
    ws.audit.append(actor(), 'playbook.change-proposed', null, { proposalId: proposal.id, kind: p.kind, positionId: p.positionId, title: (p.after ?? before)?.title, reason: p.reason })
    return ws.store.playbookProposals()
  }
)

const slug = (t: string) => 'pb-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

ipcMain.handle('kb:decidePlaybook', (_e, id: string, approve: boolean, note: string) => {
  const proposals = ws.store.playbookProposals()
  const p = proposals.find((x) => x.id === id)
  if (!p || p.status !== 'pending') throw new Error('This proposal is no longer pending.')
  const now = new Date().toISOString()
  if (approve) {
    const playbook = ws.store.playbook()
    const current = p.positionId ? playbook.find((x) => x.id === p.positionId) : undefined
    // Refuse to apply a suggestion made against an older version of the position.
    if (p.kind !== 'add' && (!current || (current.version ?? 1) !== (p.before?.version ?? 1)))
      throw new Error('The position has changed since this was proposed. Decline it and propose again against the current version.')
    let next = playbook
    if (p.kind === 'delete') next = playbook.filter((x) => x.id !== p.positionId)
    else {
      const base = p.kind === 'add' ? slug(p.after!.title) : p.positionId!
      const id = p.kind === 'add' && playbook.some((x) => x.id === base) ? `${base}-${Date.now().toString(36)}` : base
      const position: PlaybookPosition = { ...p.after!, id, version: p.kind === 'add' ? 1 : (current!.version ?? 1) + 1, updatedBy: actor(), updatedAt: now }
      next = p.kind === 'add' ? [...playbook, position] : playbook.map((x) => (x.id === id ? position : x))
      p.positionId = id
    }
    ws.store.savePlaybook(next)
  }
  Object.assign(p, { status: approve ? 'approved' : 'declined', decidedBy: actor(), decidedAt: now, decisionNote: note })
  ws.store.savePlaybookProposals(proposals)
  ws.audit.append(actor(), approve ? 'playbook.change-approved' : 'playbook.change-declined', null, {
    proposalId: id,
    kind: p.kind,
    positionId: p.positionId,
    proposedBy: p.proposedBy,
    note
  })
  return { proposals: ws.store.playbookProposals(), playbook: ws.store.playbook() }
})

ipcMain.handle('kb:dismiss', (_e, id: string) => {
  const all = ws.store.nominations()
  const n = all.find((x) => x.id === id)
  if (n) n.status = 'dismissed'
  ws.store.saveNominations(all)
  ws.audit.append(actor(), 'library.nomination-dismissed', null, { nominationId: id })
  return ws.store.nominations()
})

// ---- IPC: audit ------------------------------------------------------------------------------

ipcMain.handle('audit:list', (_e, sessionId?: string) => (sessionId ? ws.audit.forSession(sessionId) : ws.audit.all()))
ipcMain.handle('audit:verify', () => ws.audit.verify())
ipcMain.handle('audit:export', async (_e, sessionId: string) => {
  const s = session(sessionId)
  const res = await dialog.showSaveDialog(win!, {
    title: 'Export review record',
    defaultPath: `${s.docName.replace(/\.[a-z]+$/i, '')}-review-record.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (res.canceled || !res.filePath) return null
  const entries = ws.audit.forSession(sessionId)
  const v = ws.audit.verify()
  const rows = s.clauses.map((c) => {
    const d = s.decisions[c.id]
    // Cleared clauses (pre-approved wording, nothing else touching them) are accepted by default.
    const outcome = d ? d.decision : isCleared(flagsFor(s, c)) ? 'accepted (pre-approved)' : 'undecided'
    return `| ${clauseLabel(c)} | ${s.match[c.id]?.data?.kind ?? '-'} | ${outcome} | ${d?.by ?? ''} | ${d?.at?.slice(0, 16).replace('T', ' ') ?? ''} | ${(d?.note ?? '').replace(/\|/g, '/')} |`
  })
  const md = `# Review record: ${s.docName}

- File SHA-256: \`${s.fileSha256}\`
- Review started: ${s.createdAt}
- Mode: ${s.mode}
- Audit chain: ${v.ok ? `intact (${v.entries} entries)` : `BROKEN at entry ${v.brokenAt}`}
- Security: ${(() => {
    const a = alertFor(s.id)
    if (!a) return 'no alerts'
    if (a.status === 'open') return 'ON HOLD - security review pending'
    return `${a.status === 'malicious' ? 'confirmed injection attempt' : 'false positive, released'} by ${a.resolvedBy} at ${a.resolvedAt}${a.note ? ` (${a.note})` : ''}`
  })()}

## Decisions

| Clause | Library match | Decision | By | At (UTC) | Note |
|---|---|---|---|---|---|
${rows.join('\n')}

## Audit trail

${entries.map((e) => `- \`#${e.seq}\` ${e.ts} **${e.type}** by ${e.actor} ${'`'}${JSON.stringify(e.payload)}${'`'}`).join('\n')}
`
  await writeFile(res.filePath, md)
  ws.audit.append(actor(), 'audit.exported', s.id, { file: res.filePath })
  return res.filePath
})
