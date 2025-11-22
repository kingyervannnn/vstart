import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info)
    try {
      this.setState({ errorInfo: info?.componentStack || null })
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/90 text-white z-50">
          <div className="max-w-md w-full p-6 border border-white/20 rounded-xl bg-black/70">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-white/70 mb-2">The page encountered an error. You can try reloading.</p>
            {this.state.error && (
              <pre className="text-xs text-white/60 bg-white/5 rounded p-2 overflow-auto max-h-40 mb-2 whitespace-pre-wrap">
                {String(this.state.error?.message || this.state.error)}
              </pre>
            )}
            {this.state.error?.stack && (
              <details className="mb-3">
                <summary className="cursor-pointer text-white/70 text-xs">Stack trace</summary>
                <pre className="text-xs text-white/60 bg-white/5 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {String(this.state.error.stack)}
                </pre>
              </details>
            )}
            {this.state.errorInfo && (
              <details className="mb-3">
                <summary className="cursor-pointer text-white/70 text-xs">Component stack</summary>
                <pre className="text-xs text-white/60 bg-white/5 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {String(this.state.errorInfo)}
                </pre>
              </details>
            )}
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Dismiss
              </button>
              <button
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
