import { useState } from 'react'
import type { Settings } from '@shared/types'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (most capable)' }
]

export function SettingsView({
  settings,
  onChange,
  onRestartTour,
  onResetDemo
}: {
  settings: Settings
  onChange: (s: Settings) => void
  onRestartTour: () => void
  onResetDemo: () => Promise<void>
}) {
  const [resetDone, setResetDone] = useState(false)
  const [name, setName] = useState(settings.reviewerName)
  const [key, setKey] = useState('')
  const save = async (patch: Partial<Settings>) => onChange(await window.api.settings.save(patch))

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lede">Settings are stored on this machine. The API key is encrypted with the operating system keychain and is never exposed to the app's UI.</p>

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

      <div className="field">
        <label>
          <input type="checkbox" checked={settings.demoMode} onChange={(e) => save({ demoMode: e.target.checked })} /> Demo mode
        </label>
        <span className="hint">
          Demo and live are separate workspaces. Demo mode has its own sample library, playbook, precedents, reviews and audit log, and replays recorded AI responses (no network calls). Live mode starts empty, as it would for a real team, and uses Claude.
        </span>
      </div>

      <div className="field">
        <label>Demo data</label>
        <div className="row-gap">
          <button
            className="btn"
            onClick={async () => {
              await onResetDemo()
              setResetDone(true)
            }}
          >
            Reset demo data
          </button>
          {resetDone && <span className="faint">Demo workspace reset.</span>}
        </div>
        <span className="hint">Puts the demo workspace back to its original state: removes demo reviews, approvals and audit entries, and restores the sample library, playbook and history. Live data is not touched.</span>
      </div>

      <div className="field">
        <label>
          <input type="checkbox" checked={settings.securityReviewer} onChange={(e) => save({ securityReviewer: e.target.checked })} /> I’m on the security team
        </label>
        <span className="hint">
          Only the security team can resolve prompt-injection alerts and release a review from security hold. In demo mode you also act as the security team.
        </span>
      </div>

      <div className="field">
        <label>Guided tour</label>
        <div>
          <button className="btn" onClick={onRestartTour}>
            Show the welcome tour again
          </button>
        </div>
        <span className="hint">Each demo contract also has its own guided demo on the Start page.</span>
      </div>

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
        <span className="hint">Or set ANTHROPIC_API_KEY in the environment. Live mode needs a key and demo mode switched off.</span>
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

      <div className="field">
        <label>
          <input type="checkbox" checked={settings.recordLiveResponses} onChange={(e) => save({ recordLiveResponses: e.target.checked })} /> Record live AI responses
        </label>
        <span className="hint">Saves each live AI answer, keyed by its exact input, so a review can be replayed offline and used as an evaluation baseline.</span>
      </div>
    </div>
  )
}
