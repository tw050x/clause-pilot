import { useState } from 'react'
import type { Settings } from '@shared/types'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (most capable)' }
]

export function SettingsView({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [name, setName] = useState(settings.reviewerName)
  const [key, setKey] = useState('')
  const [vKey, setVKey] = useState('')
  const [url, setUrl] = useState(settings.vllmUrl)
  const [models, setModels] = useState<string[] | null>(null)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const save = async (patch: Partial<Settings>) => onChange(await window.api.settings.save(patch))

  /** Ask the vLLM server which models it serves (and so whether it answers at all). */
  const connect = async () => {
    setTesting(true)
    setTest(null)
    try {
      if (url !== settings.vllmUrl) await save({ vllmUrl: url.trim() })
      const list = await window.api.ai.vllmModels(url.trim())
      setModels(list)
      setTest({ ok: true, text: list.length ? `Connected: ${list.length} model${list.length === 1 ? '' : 's'} available.` : 'Connected, but the server lists no models.' })
      if (list.length && !list.includes(settings.vllmModel)) await save({ vllmModel: list[0] })
    } catch (e) {
      setModels(null)
      setTest({ ok: false, text: String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lede">Settings are stored on this machine. API keys are encrypted with the operating system keychain and are never exposed to the app's UI.</p>

      <div className="field">
        <label>Reviewer name</label>
        <div className="row-gap">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" onClick={() => save({ reviewerName: name })} disabled={name === settings.reviewerName}>
            Save
          </button>
        </div>
        <span className="hint">Recorded against every decision in the audit log.</span>
      </div>

      <h2 className="settings-h">AI</h2>
      <p className="faint" style={{ marginTop: -4 }}>
        Used for the intent check, the change review and Ask AI, and only when you ask. Reviewing, editing, the marked-up copy and the email work without it.
      </p>

      <div className="field">
        <label>AI provider</label>
        <div className="seg">
          <button className={settings.aiProvider === 'claude' ? 'on' : ''} onClick={() => save({ aiProvider: 'claude' })}>
            Claude
          </button>
          <button className={settings.aiProvider === 'vllm' ? 'on' : ''} onClick={() => save({ aiProvider: 'vllm' })}>
            vLLM
          </button>
        </div>
        <span className="hint">
          {settings.aiProvider === 'vllm'
            ? 'Your own model on a vLLM server (OpenAI-compatible API), for example on your local network. Contract text is sent to that server.'
            : 'Claude, through the Anthropic API. Contract text is sent to Anthropic.'}
        </span>
      </div>

      {settings.aiProvider === 'claude' ? (
        <>
          <div className="field">
            <label>Anthropic API key</label>
            <div className="row-gap">
              <input type="password" placeholder={settings.hasApiKey ? '•••••••• (saved)' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
              <button
                className="btn"
                disabled={!key}
                onClick={async () => {
                  onChange(await window.api.settings.setApiKey(key))
                  setKey('')
                }}
              >
                Save key
              </button>
              {settings.hasApiKey && (
                <button className="btn" onClick={async () => onChange(await window.api.settings.setApiKey(null))}>
                  Remove
                </button>
              )}
            </div>
            <span className="hint">Or set ANTHROPIC_API_KEY in the environment.</span>
          </div>
          <div className="field">
            <label>Model</label>
            <select value={settings.model} onChange={(e) => save({ model: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>vLLM server</label>
            <div className="row-gap">
              <input placeholder="http://192.168.1.20:8000" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
              <button className="btn" disabled={!url.trim() || testing} onClick={connect}>
                {testing ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <span className="hint">The address vLLM serves on (its OpenAI-compatible API; /v1 is added if missing). Connect lists the models it serves.</span>
            {test && <div className={`banner ${test.ok ? 'info' : 'danger'}`} style={{ marginTop: 6 }}>{test.text}</div>}
          </div>
          <div className="field">
            <label>Model</label>
            {models?.length ? (
              <select value={settings.vllmModel} onChange={(e) => save({ vllmModel: e.target.value })}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input placeholder="Connect to list the server's models, or type the name" value={settings.vllmModel} onChange={(e) => save({ vllmModel: e.target.value })} />
            )}
            <span className="hint">The model name as the server serves it (vllm serve … --served-model-name). It needs to support structured output (JSON Schema), which vLLM provides for any model.</span>
          </div>
          <div className="field">
            <label>API key (optional)</label>
            <div className="row-gap">
              <input type="password" placeholder={settings.hasVllmKey ? '•••••••• (saved)' : 'Only if the server was started with --api-key'} value={vKey} onChange={(e) => setVKey(e.target.value)} style={{ flex: 1 }} />
              <button
                className="btn"
                disabled={!vKey}
                onClick={async () => {
                  onChange(await window.api.settings.setVllmKey(vKey))
                  setVKey('')
                }}
              >
                Save key
              </button>
              {settings.hasVllmKey && (
                <button className="btn" onClick={async () => onChange(await window.api.settings.setVllmKey(null))}>
                  Remove
                </button>
              )}
            </div>
            <span className="hint">Or set VLLM_API_KEY in the environment.</span>
          </div>
        </>
      )}

      <div className="field">
        <label>
          <input type="checkbox" checked={settings.recordLiveResponses} onChange={(e) => save({ recordLiveResponses: e.target.checked })} /> Record AI responses
        </label>
        <span className="hint">Saves each AI answer, keyed by its exact input, so it can be used as an evaluation baseline (for example to compare Claude with your vLLM model).</span>
      </div>

      <h2 className="settings-h">Governance</h2>
      <div className="field">
        <label>
          <input type="checkbox" checked={settings.securityReviewer} onChange={(e) => save({ securityReviewer: e.target.checked })} /> I’m on the security team
        </label>
        <span className="hint">Only the security team can resolve prompt-injection alerts and release a review from security hold.</span>
      </div>

      <h2 className="settings-h">Data</h2>
      <ClearData />
    </div>
  )
}

/**
 * Start again with an empty workspace. Two steps, in the page rather than a native dialog:
 * the button asks, and the second button does it.
 */
function ClearData() {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="field">
      {!asking ? (
        <div>
          <button className="btn danger-outline" onClick={() => setAsking(true)}>
            Clear all data…
          </button>
        </div>
      ) : (
        <div className="banner danger clear-confirm">
          <div>
            <strong>Delete everything in this workspace?</strong> All accounts, contracts and reviews, the library, playbook and precedents, approvals, security alerts,
            recorded AI answers and the audit log. The AI settings and API keys are reset too. This can’t be undone. Export the library and playbook first if you want to keep them.
          </div>
          <div className="row-gap">
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await window.api.workspace.clear()
              }}
            >
              {busy ? 'Clearing…' : 'Delete everything'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <span className="hint">Resets the app to an empty workspace with no AI set up, for example to run the demos again from the start. Your name and the other settings are kept.</span>
    </div>
  )
}
