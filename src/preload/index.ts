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
    setApiKey: (key) => invoke('settings:setApiKey', key),
    setVllmKey: (key) => invoke('settings:setVllmKey', key)
  },
  ai: { vllmModels: (url) => invoke('ai:vllmModels', url) },
  workspace: {
    clear: () => invoke('workspace:clear'),
    summary: () => invoke('workspace:summary')
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (name) => invoke('accounts:create', name)
  },
  contracts: {
    list: () => invoke('contracts:list'),
    create: (accountId, title) => invoke('contracts:create', accountId, title),
    versions: (contractId) => invoke('contracts:versions', contractId),
    archive: (contractId, archived) => invoke('contracts:archive', contractId, archived)
  },
  security: {
    list: () => invoke('security:list'),
    resolve: (id, outcome, note) => invoke('security:resolve', id, outcome, note),
    onUpdate: on('security:update')
  },
  file: { open: () => invoke('file:open'), bytes: (path) => invoke('file:bytes', path) },
  review: {
    start: (path, contractId) => invoke('review:start', path, contractId),
    get: (id) => invoke('review:get', id),
    list: () => invoke('review:list'),
    close: (id, closed) => invoke('review:close', id, closed),
    onUpdate: on('session:update')
  },
  email: { draft: (id) => invoke('email:draft', id) },
  doc: {
    edit: (id, blockId, text, group) => invoke('doc:edit', id, blockId, text, group),
    revert: (id, setId) => invoke('doc:revert', id, setId),
    decide: (id, setId, status, note) => invoke('doc:decide', id, setId, status, note),
    comment: (id, c) => invoke('doc:comment', id, c),
    uncomment: (id, commentId) => invoke('doc:uncomment', id, commentId),
    split: (id, blockId, head, tail, newId, list) => invoke('doc:split', id, blockId, head, tail, newId, list),
    setList: (id, blockId, list) => invoke('doc:setList', id, blockId, list),
    unsplit: (id, blockId) => invoke('doc:unsplit', id, blockId),
    checkIntent: (id, blockIds) => invoke('doc:checkIntent', id, blockIds),
    check: (id, blockIds, on) => invoke('doc:check', id, blockIds, on),
    checkPlaybook: (id) => invoke('doc:checkPlaybook', id),
    resolve: (id, blockId, seg, outcome, group) => invoke('doc:resolve', id, blockId, seg, outcome, group),
    undoOurs: (id, blockId, mark, group) => invoke('doc:undoOurs', id, blockId, mark, group),
    undo: (id, actionId) => invoke('doc:undo', id, actionId),
    redo: (id, actionId) => invoke('doc:redo', id, actionId),
    seen: (id) => invoke('doc:seen', id),
    ask: (id, setIds) => invoke('doc:ask', id, setIds),
    nominate: (id, setId, note) => invoke('doc:nominate', id, setId, note)
  },
  redline: { preview: (id) => invoke('redline:preview', id), save: (id) => invoke('redline:save', id), open: (path) => invoke('redline:open', path) },
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
    decidePlaybook: (id, approve, note) => invoke('kb:decidePlaybook', id, approve, note),
    export: (kind) => invoke('kb:export', kind),
    import: (kind) => invoke('kb:import', kind)
  },
  audit: {
    list: (sessionId) => invoke('audit:list', sessionId),
    verify: () => invoke('audit:verify'),
    export: (sessionId) => invoke('audit:export', sessionId)
  }
}

contextBridge.exposeInMainWorld('api', api)
