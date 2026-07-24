import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Props = {
  children: ReactNode;
  /** Optional label for logs / UI. */
  label?: string;
};

type State = {
  error: Error | null;
};

/**
 * Root / section error boundary — prevents a single throw from white-screening
 * the whole SPA.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-[40vh] place-items-center px-6 py-12 text-center">
        <div className="max-w-md space-y-3">
          <p className="font-display text-lg font-bold text-paper">
            Something went wrong
          </p>
          <p className="text-sm text-mist">
            {this.state.error.message || 'Unexpected UI error'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <Link to="/app/chat" className="btn-ghost text-xs">
              Back to Chat
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
