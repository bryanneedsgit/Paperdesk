import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logDeveloperError } from '../lib/utils/errors';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logDeveloperError('Unhandled app error.', { error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-fatal-error" role="alert">
          <section className="workspace-state-card">
            <h1>Something went wrong</h1>
            <p>Paperdesk hit an unexpected error. Your PDFs were not uploaded or synced.</p>
            <button onClick={() => this.setState({ error: null })} type="button">
              Return to app
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
