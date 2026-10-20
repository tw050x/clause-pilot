import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * If the interface crashes, say so and show the error instead of leaving an empty window
 * (the background work carries on in the main process either way). Reload starts the
 * interface again where the workspace left off.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  state = { error: null as Error | null, stack: '' }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Interface crashed: ${error.stack ?? error}\nIn:${info.componentStack ?? ''}`)
    this.setState({ stack: info.componentStack ?? '' })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <h1>Something went wrong in the window</h1>
        <p className="lede">Background work (reviews, planning) carries on. Reload to pick up where you were.</p>
        <div className="row-gap">
          <button className="btn primary" onClick={() => void window.api.demo.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => void navigator.clipboard.writeText(`${error.stack ?? error}\n${stack}`)}>
            Copy error
          </button>
        </div>
        <pre className="crash-detail">
          {String(error.stack ?? error)}
          {stack}
        </pre>
      </div>
    )
  }
}
