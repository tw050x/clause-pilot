import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userInfo } from 'node:os'
import type { Account, ContractRecord, ChatMessage, DemoContract, EmailDraft, LibraryClause, PlaybookPosition, PlaybookProposal, ReviewSession, SecurityAlert, Settings } from '@shared/types'
import { Store } from './store'
import { AuditLog } from './audit'
import { parseFile } from './ingest/parse'
import { DEMO_SCENARIOS } from '@shared/demoScenarios'
import { AnthropicProvider, RecordingProvider, RecordingStore, ReplayProvider, type AiProvider } from './ai/provider'
import { docEmail } from './email'
import { buildDocRedline } from './redline/docx'
import { readBlocks } from './ingest/blocks'
import { beforeTheirs, changeKey, changeSets, marksFor, segmentsOf, shownText, statusOf, textWithout, type ChangeSet } from '@shared/changes'
import type { ChangeStatus, OurComment } from '@shared/types'
import { createHash } from 'node:crypto'
import { chatSystem, offlineAnswer } from './chat'
import { applicable, applyScriptedChanges, changeInput, createDocSession, toChangeReview, type ScriptedChange } from './docreview'
import { precedentFor, seenBefore } from './engine/seen'
import { apply, canRedo, dependents, describe, diff, same, snapshot } from '@shared/history'

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
const noKey = () => Promise.reject(new Error('No Anthropic API key. Add one in Settings to ask the AI.'))
const noKeyProvider: AiProvider = { kind: 'anthropic', intent: noKey, overrides: noKey, position: noKey, change: noKey }

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
  for (const step of scenario.history) {
    const demo = demoContracts().find((d) => d.file === step.file)!
    const s = await startReview(w, demo.path, scenario.contractId, 'demo')
    applyScripted(w, s, step.changes, 'demo-setup')
    w.store.saveSession(s)
  }
  w.audit.append(actor(), 'demo.prepared', null, { scenario: scenario.id, earlierDrafts: scenario.history.length })
  return true
})

/** Scripted responses to change sets (demo set-up), recorded as history like a reviewer's. */
function applyScripted(w: Workspace, s: ReviewSession, list: ScriptedChange[], by: string) {
  for (const set of applyScriptedChanges(s, list, by)) recordPrecedent(w, s, set)
}

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

/**
 * Open a draft for review: the contract as written, with their changes (tracked,
 * or found by comparing with what we sent / our standard wording). Nothing goes
 * to the AI until the reviewer asks; only the local security screen runs.
 */
async function startReview(w: Workspace, path: string, contractId: string | undefined, mode: 'live' | 'demo'): Promise<ReviewSession> {
  const doc = await parseFile(resolvePath(path))
  const blocks = await readBlocks(resolvePath(path), doc.sourceType)
  // A draft of a known contract becomes its next version, compared with the one before.
  const contract = contractId ? w.store.contracts().find((c) => c.id === contractId) : undefined
  if (contractId && !contract) throw new Error('Unknown contract.')
  const versions = contract ? w.store.versionsOf(contract.id) : []
  const last = versions[versions.length - 1]
  const prev = last ? (sessions.get(last.id) ?? last) : undefined
  const s = createDocSession(doc, blocks, path, mode, { prev: prev?.doc ? prev : undefined, library: w.store.library() })
  if (contract) {
    Object.assign(s, { accountId: contract.accountId, contractId: contract.id, version: (prev?.version ?? 0) + 1 })
    if (prev) s.previous = { sessionId: prev.id, version: prev.version ?? 1 }
    if (contract.contractType === 'general' && s.contractType !== 'general') {
      contract.contractType = s.contractType
      w.store.saveContracts(w.store.contracts().map((c) => (c.id === contract.id ? contract : c)))
    }
  }
  sessions.set(s.id, s)
  sessionWs.set(s.id, w)
  const d = s.doc!
  w.audit.append(mode === 'demo' && !win ? 'system' : actor(), 'session.created', s.id, {
    docName: s.docName,
    sha256: s.fileSha256,
    blocks: d.blocks.length,
    changes: changeSets(d).length,
    comparedWith: d.baseline?.kind ?? null,
    untracked: d.baseline?.untracked ?? 0,
    mode: s.mode,
    contractId: s.contractId ?? null,
    version: s.version ?? null,
    previous: s.previous?.sessionId ?? null
  })
  if (Object.keys(s.injection).length) w.audit.append('system', 'injection.local-flags', s.id, { blocks: s.injection })
  w.store.saveSession(s)
  syncSecurityAlert(w, s)
  return s
}

ipcMain.handle('review:start', async (_e, path: string, contractId?: string) => {
  if (loadSettings().demoMode && !demoContracts().some((d) => d.path === path))
    throw new Error('Demo mode can only review the demo contracts. Switch demo mode off to review your own.')
  const s = await startReview(ws, path, contractId, loadSettings().demoMode ? 'demo' : 'live')
  persist(s)
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
    const b = s.doc?.blocks.find((x) => x.id === id)
    return { clauseId: id, label: b?.label ? `§${b.label.replace(/\.$/, '')}` : 'Paragraph', text: b?.text ?? '', hits }
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

// ---- IPC: outputs ----------------------------------------------------------------------

ipcMain.handle('email:draft', async (_e, sessionId: string): Promise<EmailDraft> => {
  const s = session(sessionId)
  if (alertFor(s.id)?.status === 'open') throw new Error('This review is on security hold. Nothing can go back to the counterparty until the security team has reviewed the alert.')
  if (!s.doc) throw new Error(OLD_REVIEW)
  const reviewer = actor()
  const draft: EmailDraft = docEmail(s, reviewer)
  ws.audit.append(reviewer, 'email.drafted', s.id, { generatedBy: draft.generatedBy, answered: changeSets(s.doc).filter((x) => statusOf(s.doc!, x) === 'countered').length })
  return draft
})

// ---- IPC: document review (edits, comments, change-set decisions) ---------------------------

/**
 * Run a change to a review as one undoable action: the facets it changed are recorded. With a
 * group (a selection, typing in one paragraph), it merges into the previous action if that
 * was the same group.
 */
function tracked<T>(s: ReviewSession, group: string | undefined, fn: () => T): T {
  const d = s.doc!
  const before = snapshot(d)
  const out = fn()
  const ch = diff(before, snapshot(d))
  if (!Object.keys(ch.after).length) return out
  d.history ??= []
  const last = d.history[d.history.length - 1]
  const at = new Date().toISOString()
  if (group && last && last.group === group && !last.undone) {
    for (const k of Object.keys(ch.after)) {
      if (!(k in last.before)) last.before[k] = ch.before[k]
      last.after[k] = ch.after[k]
    }
    for (const k of Object.keys(last.after)) if (same(last.before[k], last.after[k])) {
      delete last.before[k]
      delete last.after[k]
    }
    last.at = at
    if (!Object.keys(last.after).length) d.history.pop()
  } else d.history.push({ id: `a${Date.now().toString(36)}${d.history.length}`, group, at, by: actor(), before: ch.before, after: ch.after })
  return out
}

/** Undo an action, and any later ones that depend on it (they changed the same text). */
ipcMain.handle('doc:undo', (_e, sessionId: string, actionId: string) => {
  const { s, d } = docOf(sessionId)
  const a = d.history?.find((x) => x.id === actionId)
  if (!a || a.undone) throw new Error('Nothing to undo.')
  const chain = [...dependents(d.history!, a).reverse(), a]
  for (const x of chain) {
    apply(d, x.before)
    x.undone = true
  }
  ws.audit.append(actor(), 'doc.undone', s.id, { actions: chain.map((x) => describe(d, x)) })
  persist(s)
  return s
})

/** Redo an undone action, if nothing has changed the same text since. */
ipcMain.handle('doc:redo', (_e, sessionId: string, actionId: string) => {
  const { s, d } = docOf(sessionId)
  const a = d.history?.find((x) => x.id === actionId)
  if (!a?.undone) throw new Error('Nothing to redo.')
  if (!canRedo(d, a)) throw new Error('Something has changed the same text since, so this can’t be redone.')
  apply(d, a.after)
  a.undone = false
  ws.audit.append(actor(), 'doc.redone', s.id, { action: describe(d, a) })
  persist(s)
  return s
})

const OLD_REVIEW = 'This review was made with an earlier version of Clause Pilot. Upload the draft again to review it.'
function docOf(sessionId: string) {
  const s = session(sessionId)
  if (!s.doc) throw new Error(OLD_REVIEW)
  return { s, d: s.doc }
}

const counterpartyName = (s: ReviewSession) => (s.accountId && wsFor(s).store.accounts().find((a) => a.id === s.accountId)?.name) || counterpartyOf(s)

/** Keep negotiation history in step with how a change set now stands (accepted or answered: recorded). */
function recordPrecedent(w: Workspace, s: ReviewSession, set: ChangeSet) {
  const { id, precedent } = precedentFor(s, set, counterpartyName(s))
  if (precedent) w.store.upsertPrecedent(precedent)
  else if (w.store.precedents().some((p) => p.id === id)) w.store.removePrecedent(id)
}
const recordTouching = (s: ReviewSession, blockId: string) => {
  const set = changeSets(s.doc!).find((x) => x.blocks.some((b) => b.id === blockId))
  if (set) recordPrecedent(wsFor(s), s, set)
}
const blockWhere = (s: ReviewSession, blockId: string) => {
  const b = s.doc?.blocks.find((x) => x.id === blockId)
  return b?.label ? `§${b.label.replace(/\.$/, '')}` : (b?.text.slice(0, 40) ?? blockId)
}
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()
/** Typed text as the editor has it: spacing kept (the caret may be after a space), no line breaks. */
const clean = (t: string) => t.replace(/\u00a0/g, ' ').replace(/[\r\n]+/g, ' ')

/** Our wording for a paragraph (null clears our edit). Saving their wording unchanged clears it too. */
ipcMain.handle('doc:edit', (_e, sessionId: string, blockId: string, text: string | null, group?: string) => {
  const out = tracked(session(sessionId), group, () => {
    const { s, d } = docOf(sessionId)
    const b = d.blocks.find((x) => x.id === blockId)
    if (!b) throw new Error('Unknown paragraph.')
    const next = text === null ? null : clean(text)
    const same = next === null || (!b.ours && b.kind !== 'deleted' && tidy(next) === tidy(shownText(marksFor({ ...d, edits: {} }, b))))
    if (same) delete d.edits[blockId]
    else d.edits[blockId] = next
    ws.audit.append(actor(), same ? 'doc.edit-cleared' : 'doc.edited', s.id, { block: blockWhere(s, blockId), text: same ? null : next })
    recordTouching(s, blockId)
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

/**
 * Enter in the document: the paragraph keeps the text before the caret, and a new paragraph
 * of ours, after it, gets the rest. Both are our tracked changes.
 */
ipcMain.handle('doc:split', (_e, sessionId: string, blockId: string, head: string, tail: string) => {
  const out = tracked(session(sessionId), undefined, () => {
    const { s, d } = docOf(sessionId)
    const at = d.blocks.findIndex((x) => x.id === blockId)
    if (at < 0) throw new Error('Unknown paragraph.')
    const b = d.blocks[at]
    const id = `n${Date.now().toString(36)}`
    d.blocks.splice(at + 1, 0, { id, kind: 'para', text: '', ours: true, level: b.level })
    const keep = clean(head)
    if (b.ours || keep !== clean(b.kind === 'deleted' ? '' : b.text)) d.edits[blockId] = keep
    else delete d.edits[blockId]
    d.edits[id] = clean(tail)
    ws.audit.append(actor(), 'doc.paragraph-added', s.id, { after: blockWhere(s, blockId) })
    persist(s)
    return { session: s, id }
  })
  persist(session(sessionId))
  return out
})

/** Remove a paragraph we added. */
ipcMain.handle('doc:unsplit', (_e, sessionId: string, blockId: string) => {
  const out = tracked(session(sessionId), undefined, () => {
    const { s, d } = docOf(sessionId)
    const b = d.blocks.find((x) => x.id === blockId)
    if (!b?.ours) throw new Error('Only paragraphs you added can be removed.')
    d.blocks = d.blocks.filter((x) => x.id !== blockId)
    delete d.edits[blockId]
    d.comments = d.comments.filter((c) => c.blockId !== blockId)
    ws.audit.append(actor(), 'doc.paragraph-removed', s.id, {})
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

/**
 * Accept or reject one of their changes (null: undecided again), as in Word. A tracked change is
 * resolved in the file; a change found by comparison can't be, so rejecting it is our edit.
 */
ipcMain.handle('doc:resolve', (_e, sessionId: string, blockId: string, seg: number, outcome: 'accepted' | 'rejected' | null, group?: string) => {
  const out = tracked(session(sessionId), group, () => {
    const { s, d } = docOf(sessionId)
    const b = d.blocks.find((x) => x.id === blockId)
    if (!b || !segmentsOf(b)[seg] || segmentsOf(b)[seg].op === 'same') throw new Error('Unknown change.')
    const key = changeKey(blockId, seg)
    if (outcome === 'accepted' && s.injection[blockId] && alertFor(s.id)?.status !== 'false-positive')
      throw new Error('This paragraph is on security hold: text in it is addressed to an AI reviewer.')
    const before = marksFor(d, b)
    const edit = d.edits[blockId]
    d.resolved ??= {}
    if (b.untracked && outcome === 'rejected') {
      d.edits[blockId] = textWithout(before, (m) => m.seg === seg && !!m.theirs)
      delete d.resolved[key]
    } else {
      if (outcome) d.resolved[key] = outcome
      else delete d.resolved[key]
      if (edit !== undefined && outcome === 'rejected') d.edits[blockId] = textWithout(before, (m) => m.seg === seg && !!m.theirs)
    }
    // Our wording that now matches the text as it stands isn't an edit any more.
    const plain = shownText(marksFor({ ...d, edits: {} }, b))
    if (d.edits[blockId] !== undefined && tidy(d.edits[blockId]) === tidy(plain) && !b.ours) delete d.edits[blockId]
    ws.audit.append(actor(), outcome ? `doc.change-${outcome}` : 'doc.change-reopened', s.id, { block: blockWhere(s, blockId), change: segmentsOf(b)[seg].text.slice(0, 80), op: segmentsOf(b)[seg].op })
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

/** Undo one of our own changes (an insertion or deletion of ours) in a paragraph. */
ipcMain.handle('doc:undoOurs', (_e, sessionId: string, blockId: string, mark: number, group?: string) => {
  const out = tracked(session(sessionId), group, () => {
    const { s, d } = docOf(sessionId)
    const b = d.blocks.find((x) => x.id === blockId)
    if (!b || d.edits[blockId] === undefined) throw new Error('Nothing to undo.')
    const marks = marksFor(d, b)
    if (!marks[mark]?.ours) throw new Error('That isn’t one of your changes.')
    const next = textWithout(marks, (_m, i) => i === mark)
    const plain = shownText(marksFor({ ...d, edits: {} }, b))
    if (!b.ours && tidy(next) === tidy(plain)) delete d.edits[blockId]
    else d.edits[blockId] = next
    ws.audit.append(actor(), 'doc.edit-undone', s.id, { block: blockWhere(s, blockId), text: marks[mark].text.slice(0, 80) })
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

/** Undo their changes in a change set: restore what was there before, as our redline. */
ipcMain.handle('doc:revert', (_e, sessionId: string, setId: string) => {
  const { s, d } = docOf(sessionId)
  const set = changeSets(d).find((x) => x.id === setId)
  if (!set) throw new Error('Unknown change.')
  for (const b of set.blocks) d.edits[b.id] = b.kind === 'deleted' ? tidy(b.text) : beforeTheirs(b)
  delete d.decisions[setId]
  ws.audit.append(actor(), 'doc.reverted', s.id, { change: set.where })
  recordPrecedent(wsFor(s), s, set)
  persist(s)
  return s
})

ipcMain.handle('doc:decide', (_e, sessionId: string, setId: string, status: ChangeStatus | null, note?: string) => {
  const { s, d } = docOf(sessionId)
  const set = changeSets(d).find((x) => x.id === setId)
  if (!set) throw new Error('Unknown change.')
  const alert = alertFor(s.id)
  if (status === 'accepted' && alert && alert.status !== 'false-positive' && set.blocks.some((b) => s.injection[b.id]))
    throw new Error(alert.status === 'open' ? 'On security hold: only the security team can release this text.' : 'The security team confirmed this as an injection attempt, so it can’t be accepted.')
  if (status === null) delete d.decisions[setId]
  else {
    // Accepting their change means not answering it: our edits in it go.
    if (status === 'accepted') for (const b of set.blocks) delete d.edits[b.id]
    d.decisions[setId] = { status, note: note?.trim() || undefined, by: actor(), at: new Date().toISOString() }
  }
  ws.audit.append(actor(), status ? `doc.change-${status}` : 'doc.change-reopened', s.id, { change: set.where, note: note?.trim() || null })
  if (status !== 'accepted') d.nominated = d.nominated?.filter((x) => x !== setId)
  recordPrecedent(wsFor(s), s, set)
  persist(s)
  return s
})

ipcMain.handle('doc:comment', (_e, sessionId: string, c: Pick<OurComment, 'blockId' | 'quote' | 'text' | 'replyTo'>) => {
  const out = tracked(session(sessionId), undefined, () => {
    const { s, d } = docOf(sessionId)
    if (!c.text.trim()) throw new Error('Write a comment first.')
    const comment: OurComment = { id: `oc-${Date.now().toString(36)}`, blockId: c.blockId, quote: c.quote?.trim() || undefined, text: c.text.trim(), replyTo: c.replyTo, by: actor(), at: new Date().toISOString() }
    d.comments.push(comment)
    ws.audit.append(actor(), 'doc.commented', s.id, { block: blockWhere(s, c.blockId), text: comment.text, replyTo: c.replyTo ?? null })
    recordTouching(s, c.blockId)
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

ipcMain.handle('doc:uncomment', (_e, sessionId: string, commentId: string) => {
  const out = tracked(session(sessionId), undefined, () => {
    const { s, d } = docOf(sessionId)
    const gone = d.comments.find((c) => c.id === commentId)
    d.comments = d.comments.filter((c) => c.id !== commentId)
    ws.audit.append(actor(), 'doc.comment-deleted', s.id, { commentId })
    if (gone) recordTouching(s, gone.blockId)
    persist(s)
    return s
  })
  persist(session(sessionId))
  return out
})

/** Earlier negotiations for each change set: the identical change first, then similar ones. */
ipcMain.handle('doc:seen', (_e, sessionId: string) => {
  const { s } = docOf(sessionId)
  return seenBefore(s, wsFor(s).store.precedents())
})

/** Accepted wording nominated for the pre-approved library (approved by the library owner). */
ipcMain.handle('doc:nominate', (_e, sessionId: string, setId: string, note: string) => {
  const { s, d } = docOf(sessionId)
  const set = changeSets(d).find((x) => x.id === setId)
  if (!set) throw new Error('Unknown change.')
  if (statusOf(d, set) !== 'accepted') throw new Error('Accept the change before nominating its wording.')
  const w = wsFor(s)
  const id = `nm-${s.id}-${setId}`
  const heading = d.blocks
    .slice(0, d.blocks.indexOf(set.blocks[0]) + 1)
    .reverse()
    .find((b) => b.kind === 'heading')
  w.store.saveNominations([
    ...w.store.nominations().filter((n) => n.id !== id),
    {
      id,
      text: set.blocks.filter((b) => b.kind !== 'heading' && b.kind !== 'deleted').map((b) => b.text).join('\n'),
      category: heading ? heading.text.charAt(0) + heading.text.slice(1).toLowerCase() : 'General',
      contractType: s.contractType,
      fromDoc: s.docName,
      counterparty: counterpartyName(s),
      nominatedBy: actor(),
      nominatedAt: new Date().toISOString(),
      note: note.trim(),
      status: 'pending'
    }
  ])
  d.nominated = [...new Set([...(d.nominated ?? []), setId])]
  w.audit.append(actor(), 'library.nominated', s.id, { change: set.where, nominationId: id })
  persist(s)
  return s
})

/**
 * Ask the AI about change sets, on request. Each change set is one request (however many
 * paragraphs and edits it spans), with the whole contract as a cached prefix, our
 * playbook and how we answered the same or similar changes before.
 */
async function askAi(s: ReviewSession, setIds: string[]) {
  const w = wsFor(s)
  const d = s.doc!
  const ai = provider()
  const positions = applicable(w.store.playbook(), s.contractType)
  const seen = seenBefore(s, w.store.precedents())
  const sets = changeSets(d).filter((x) => setIds.includes(x.id))
  d.ai ??= {}
  for (const set of sets) d.ai[set.id] = { status: 'running', reason: 'Reading the whole contract for this change' }
  persist(s)
  const one = async (set: ChangeSet) => {
    try {
      const out = await ai.change(changeInput(s, set, positions, seen[set.id] ?? []))
      const review = toChangeReview(s, set, positions, out)
      d.ai![set.id] = { status: 'done', data: review }
      if (out.injection_suspected && out.injection_notes.trim()) {
        s.aiInjectionReports.push(`Change review of ${set.where}: ${out.injection_notes.trim()}`)
        syncSecurityAlert(w, s)
      }
      w.audit.append('system', 'ai.change-review', s.id, { change: set.where, provider: ai.kind, recommendation: review.recommendation, risk: review.risk, suggested: review.suggested.length })
    } catch (e) {
      d.ai![set.id] = { status: 'error', error: e instanceof Error ? e.message : String(e) }
      w.audit.append('system', 'ai.change-review.error', s.id, { change: set.where, error: String(e) })
    }
    persist(s)
  }
  // The first request writes the contract to the prompt cache; the rest read it.
  if (sets.length) await one(sets[0])
  const rest = sets.slice(1)
  for (let i = 0; i < rest.length; i += 4) await Promise.all(rest.slice(i, i + 4).map(one))
}

ipcMain.handle('doc:ask', (_e, sessionId: string, setIds: string[]) => {
  const { s } = docOf(sessionId)
  if (alertFor(s.id)?.status === 'open')
    throw new Error('On security hold: text addressed to an AI reviewer was found, so nothing from this contract goes to the AI until the security team has looked at it.')
  ws.audit.append(actor(), 'ai.requested', s.id, { changes: changeSets(s.doc!).filter((x) => setIds.includes(x.id)).map((x) => x.where) })
  askAi(s, setIds).catch((e) => ws.audit.append('system', 'ai.change-review.error', s.id, { error: String(e) }))
  return s
})

/** Our response as a marked-up Word copy: tracked changes for our wording, comments for our reasons. */
async function redline(sessionId: string) {
  const s = session(sessionId)
  if (alertFor(s.id)?.status === 'open') throw new Error('This review is on security hold. Nothing can go back to the counterparty until the security team has reviewed the alert.')
  const original = await readFile(resolvePath(s.filePath))
  if (!s.doc) throw new Error(OLD_REVIEW)
  const out = await buildDocRedline(s, actor(), original)
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
  if (!s.doc) throw new Error(OLD_REVIEW)
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
  if (!s.doc) throw new Error(OLD_REVIEW)
  const d = s.doc
  const rows = changeSets(d).map((set) => {
    const st = statusOf(d, set)
    const dec = d.decisions[set.id]
    const edited = set.blocks.filter((b) => d.edits[b.id] !== undefined)
    const how = st === 'countered' ? `answered with our edits to ${edited.map((b) => (b.label ? `§${b.label.replace(/\.$/, '')}` : 'a paragraph')).join(', ')}` : st === 'open' ? 'undecided' : st
    const ai = d.ai?.[set.id]?.data
    return `| ${set.where}${set.blocks.some((b) => b.untracked) ? ' (untracked)' : ''} | ${how} | ${dec?.by ?? ''} | ${dec?.at?.slice(0, 16).replace('T', ' ') ?? ''} | ${(dec?.note ?? '').replace(/\|/g, '/')} | ${ai ? `asked: ${ai.recommendation}, ${ai.risk} risk` : '-'} |`
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

- Compared with: ${d.baseline ? (d.baseline.kind === 'sent' ? `what we sent for version ${d.baseline.version}` : 'our standard wording') : 'nothing (tracked changes only)'}

## Their changes

| Change | Our response | By | At (UTC) | Note | AI |
|---|---|---|---|---|---|
${rows.join('\n')}

Our edits outside their changes: ${d.blocks.filter((b) => d.edits[b.id] !== undefined && !changeSets(d).some((x) => x.blocks.includes(b))).length}. Our comments: ${d.comments.length}.

## Audit trail

${entries.map((e) => `- \`#${e.seq}\` ${e.ts} **${e.type}** by ${e.actor} ${'`'}${JSON.stringify(e.payload)}${'`'}`).join('\n')}
`
  await writeFile(res.filePath, md)
  ws.audit.append(actor(), 'audit.exported', s.id, { file: res.filePath })
  return res.filePath
})
