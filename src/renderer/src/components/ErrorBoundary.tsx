import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  info: string
}

/** Catches render errors so a crash shows a readable message, never a black screen. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack || '' })
    // eslint-disable-next-line no-console
    console.error('Janus render error:', error, info)
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-ink-900 p-8 text-center">
        <div className="text-lg font-semibold text-bad">Something went wrong</div>
        <p className="max-w-md text-sm text-slate-400">
          Janus hit an unexpected error. Share the details below so it can be fixed.
        </p>
        <pre className="max-h-60 max-w-2xl overflow-auto rounded-lg border border-ink-600 bg-ink-800 p-4 text-left font-mono text-xs text-slate-300">
          {error.message}
          {info ? `\n${info}` : ''}
        </pre>
        <button onClick={() => location.reload()} className="btn-primary">
          Reload
        </button>
      </div>
    )
  }
}
