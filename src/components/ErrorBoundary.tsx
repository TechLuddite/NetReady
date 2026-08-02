import React from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

/**
 * Catches render-time throws so a single malformed history record cannot blank
 * the entire page. Before this existed, `main.tsx` rendered `<App />` bare and
 * any throw took the whole app down with a white screen and no recovery path.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[NetReady] Unhandled render error:', error, info.componentStack);
  }

  private diagnosticText(): string {
    const { error } = this.state;
    return [
      `NetReady error report`,
      `time: ${new Date().toISOString()}`,
      `userAgent: ${navigator.userAgent}`,
      `message: ${error?.message ?? 'unknown'}`,
      ``,
      error?.stack ?? '(no stack)',
    ].join('\n');
  }

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.diagnosticText());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard unavailable — the text is on screen anyway */
    }
  };

  override render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-screen bg-[#050608] text-slate-200 flex items-center justify-center p-6"
      >
        <div className="max-w-2xl w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">NetReady hit an unexpected error</h1>
              <p className="text-xs text-slate-400">
                Your saved history is untouched. Reloading is safe.
              </p>
            </div>
          </div>

          <pre className="text-[11px] font-mono text-rose-200/90 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words max-h-64">
            {this.diagnosticText()}
          </pre>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-cyan-500 text-black font-semibold text-sm hover:bg-cyan-400 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload NetReady</span>
            </button>
            <button
              onClick={this.handleCopy}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm hover:bg-white/10 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Copy diagnostic details'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
