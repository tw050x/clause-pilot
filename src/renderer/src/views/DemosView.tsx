import type { Account } from '@shared/types'
import { DEMO_SCENARIOS, type DemoScenario } from '@shared/demoScenarios'
import { Chevron, Icon } from '../lib/icons'

const GROUPS: { id: DemoScenario['group']; title: string; lede: string }[] = [
  { id: 'review', title: 'Review a contract', lede: 'The first draft of a contract, from upload to the response email.' },
  { id: 'drafts', title: 'New drafts of a contract', lede: 'The client replies. Only what changed needs reading.' },
  { id: 'knowledge', title: 'Teach the system', lede: 'Grow the knowledge every review is checked against.' }
]

/**
 * Short, focused demos. Each one starts from a fresh demo workspace (earlier
 * drafts are reviewed for you where the story needs them), so they can be run
 * in any order, any number of times.
 */
export function DemosView({ demoMode, account, onGuided, onSimulate, onEnableDemo }: {
  demoMode: boolean
  /** With a client selected, only its contract demos are shown (library and playbook demos are shared). */
  account: Account | null
  onGuided: (s: DemoScenario) => void
  onSimulate: (s: DemoScenario) => void
  onEnableDemo: () => void
}) {
  return (
    <div className="page">
      <h1>Demos</h1>
      <p className="lede">
        Each demo shows one part of Clause Pilot with sample contracts and recorded AI responses; nothing leaves this computer. Starting a demo resets the demo workspace, so each one begins
        the same way. <b>Guided demo</b> walks you through it; <b>Simulate upload</b> skips straight to the result.
      </p>
      {!demoMode && (
        <div className="banner info" style={{ marginBottom: 18, maxWidth: 760 }}>
          <Icon name="alert" /> Demos run in demo mode.
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={onEnableDemo}>
            Switch to demo mode
          </button>
        </div>
      )}
      {account && (
        <p className="faint" style={{ marginTop: -8 }}>
          Showing the contract demos for <b>{account.name}</b>. Choose another account at the top left to see its demos.
        </p>
      )}
      {GROUPS.map((g) => ({ g, list: DEMO_SCENARIOS.filter((d) => d.group === g.id && (!account || g.id === 'knowledge' || d.accountId === account.id)) }))
        .filter(({ list }) => list.length > 0)
        .map(({ g, list }) => (
        <section key={g.id} className="demo-group">
          <h3>{g.title}</h3>
          <p className="faint">{g.lede}</p>
          <div className="demo-grid">
            {list.map((d) => (
              <div key={d.id} className="demo-card" data-demo={d.id}>
                <strong>{d.title}</strong>
                <p>{d.description}</p>
                {d.history.length > 0 && (
                  <span className="faint" style={{ fontSize: 12 }}>
                    Starts with {d.history.length === 1 ? 'version 1' : `versions 1–${d.history.length}`} already reviewed.
                  </span>
                )}
                <div className="row-gap" style={{ marginTop: 'auto', paddingTop: 6 }}>
                  <button className="btn sm primary" disabled={!demoMode} onClick={() => onGuided(d)}>
                    Guided demo <Chevron />
                  </button>
                  {d.upload && (
                    <button className="btn sm" disabled={!demoMode} onClick={() => onSimulate(d)}>
                      Simulate upload <Chevron />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
