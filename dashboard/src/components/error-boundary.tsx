/**
 * Error Boundary Component
 * Catches React rendering errors and displays fallback UI.
 * Prevents entire app from crashing on component errors.
 */
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error to console (integration point for Sentry/etc.)
    console.error('[ErrorBoundary] Uncaught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // Call parent onError handler if provided
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI - dark theme matching dashboard
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-bg-card border border-bg-border rounded-lg p-6 space-y-4">
            {/* Error Icon */}
            <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-loss/20 border border-loss/40">
              <svg
                className="w-6 h-6 text-loss"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Error Message */}
            <div className="text-center space-y-2">
              <h2 className="text-white font-bold text-lg">Something went wrong</h2>
              <p className="text-muted text-sm">
                The application encountered an unexpected error.
              </p>
            </div>

            {/* Error Details (collapsible) */}
            {this.state.error && (
              <details className="bg-bg border border-bg-border rounded p-3 space-y-2">
                <summary className="text-accent text-xs font-semibold cursor-pointer">
                  Error Details
                </summary>
                <div className="text-xs text-muted font-mono break-all">
                  <p className="text-loss font-semibold">{this.state.error.name}</p>
                  <p>{this.state.error.message}</p>
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="flex-1 px-4 py-2 bg-accent/20 border border-accent/40 text-accent rounded hover:bg-accent/30 transition-colors text-sm font-semibold"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 px-4 py-2 bg-bg-border border border-bg-border text-muted rounded hover:bg-border/60 transition-colors text-sm font-semibold"
              >
                Reload Page
              </button>
            </div>

            {/* Support Link */}
            <p className="text-center text-xs text-muted pt-2">
              If the problem persists, contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based error boundary for functional components.
 * Returns error state and reset function.
 */
export function useErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return { error, handleError, resetError };
}

// TypeScript fix for useState/useCallback
import { useState, useCallback } from 'react';
