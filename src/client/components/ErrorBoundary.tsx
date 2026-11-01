import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { t } from '../i18n';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  // Modal variant: drawn over the app, recovery by reloading (React keeps a failed lazy import cached)
  overlay?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  public componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[Soldat Map Studio ErrorBoundary]', error, info);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className={
            this.props.overlay
              ? 'fixed inset-0 z-50 bg-black/75 backdrop-blur-sm text-zinc-100 flex items-center justify-center p-6'
              : 'flex-1 h-full w-full bg-zinc-950 text-zinc-100 flex items-center justify-center p-6'
          }
        >
          <div className="max-w-md w-full bg-zinc-900 border border-red-800/70 rounded-xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-sm">
                {this.props.fallbackTitle || t('This view failed to render')}
              </h3>
            </div>
            <p className="text-xs text-zinc-300 font-mono bg-zinc-950 border border-zinc-800 rounded p-2.5 break-words">
              {this.state.errorMessage || t('Unknown UI error')}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={this.props.overlay ? () => window.location.reload() : this.handleReset}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {this.props.overlay ? t('Reload page') : t('Restore view')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
