import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from './api'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const on = (channel: string) => (cb: (payload: any) => void) => {
  const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The renderer gets a narrow, typed API. No Node, no filesystem, no API key.
const api: Api = {
  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    setApiKey: (key) => invoke('settings:setApiKey', key)
  },
  demo: { list: () => invoke('demo:list'), reset: () => invoke('demo:reset') },
  workspace: { summary: () => invoke('workspace:summary') },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (name) => invoke('accounts:create', name)
  },
  contracts: {
    list: () => invoke('contracts:list'),
    create: (accountId, title) => invoke('contracts:create', accountId, title),
    versions: (contractId) => invoke('contracts:versions', contractId)
  },
  security: {
    list: () => invoke('security:list'),
    resolve: (id, outcome, note) => invoke('security:resolve', id, outcome, note),
    onUpdate: on('security:update')
  },
  file: { open: () => invoke('file:open'), bytes: (path) => invoke('file:bytes', path), docxHtml: (path) => invoke('file:docxHtml', path) },
  review: {
    start: (path, contractId) => invoke('review:start', path, contractId),
    get: (id) => invoke('review:get', id),
    list: () => invoke('review:list'),
    decide: (id, d) => invoke('review:decide', id, d),
    undo: (id, clauseId) => invoke('review:undo', id, clauseId),
    onUpdate: on('session:update')
  },
  email: { draft: (id) => invoke('email:draft', id) },
  chat: { send: (id, history, requestId) => invoke('chat:send', id, history, requestId), onDelta: on('chat:delta') },
  kb: {
    library: () => invoke('kb:library'),
    playbook: () => invoke('kb:playbook'),
    precedents: () => invoke('kb:precedents'),
    nominations: () => invoke('kb:nominations'),
    promote: (id, title, category) => invoke('kb:promote', id, title, category),
    dismiss: (id) => invoke('kb:dismiss', id),
    playbookProposals: () => invoke('kb:playbookProposals'),
    proposePlaybook: (p) => invoke('kb:proposePlaybook', p),
    decidePlaybook: (id, approve, note) => invoke('kb:decidePlaybook', id, approve, note)
  },
  audit: {
    list: (sessionId) => invoke('audit:list', sessionId),
    verify: () => invoke('audit:verify'),
    export: (sessionId) => invoke('audit:export', sessionId)
  }
}

contextBridge.exposeInMainWorld('api', api)
