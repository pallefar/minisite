/**
 * Crash-resilience error boundary (v1.5).
 *
 * Catches render/lifecycle errors thrown by descendants so a single broken tab
 * or widget shows a calm, recoverable card instead of white-screening the SPA
 * (ARCHITECTURE.md "Error Handling": "No global error boundary … Tracked as a
 * follow-up" — this closes it).
 *
 * Capture path: reuses the EXISTING deferred web telemetry path via
 * `reportError()` from `@/lib/telemetry-defer` — no second static
 * `@sentry/react` import, so this component (and the app root it wraps) stays
 * off the entry static graph and the deferred-Sentry bundle contract holds.
 *
 * Two usage modes:
 *   - Root: omit `onReset`; the fallback "Reload" button does a full page
 *     reload (the only safe recovery when the whole tree is suspect).
 *   - Per-surface (e.g. a tab): pass `onReset`; "Reload" clears the boundary's
 *     error state and re-renders just the children (and, if provided, runs the
 *     caller's reset side-effect). The boundary is keyed by the caller (e.g. on
 *     the active tab id) so switching surfaces also clears a stuck error.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { reportError } from '@/lib/telemetry-defer';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human label for the boundary scope (e.g. "Home tab") — shown in the body. */
  label?: string;
  /**
   * When provided, the fallback "Reload" action clears the error and re-renders
   * children instead of reloading the page, then runs this callback. Omit at the
   * app root so recovery is a full page reload.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Reuse the existing deferred capture path (buffers pre-init, sends post-init).
    reportError(error);
    // Keep a breadcrumb in the console for local dev / no-DSN deploys.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', this.props.label ?? 'root', error, info.componentStack);
    }
  }

  private handleReset = (): void => {
    if (this.props.onReset) {
      this.setState({ error: null });
      this.props.onReset();
    } else {
      // Root recovery: full reload — the whole tree is suspect.
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" aria-live="assertive" className="flex items-center justify-center p-6">
          <Card variant="elevated" padding="lg" className="max-w-md w-full text-center">
            <h2
              tabIndex={-1}
              ref={(el) => el?.focus()}
              className="text-[18px] font-bold tracking-tight text-[var(--color-text)] outline-none"
            >
              Something went wrong
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-text-secondary)]">
              Your data is safe on this device.
              {this.props.label ? ` (${this.props.label})` : ''}
            </p>
            <div className="mt-5 flex justify-center">
              <Button onClick={this.handleReset}>Reload</Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
