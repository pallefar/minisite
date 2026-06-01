/**
 * v1.5 crash-resilience — ErrorBoundary unit tests.
 *
 * Covers:
 *   (a) renders children when no error is thrown;
 *   (b) renders the recoverable fallback when a child throws;
 *   (c) the capture function (reportError) is called with the thrown error.
 *
 * reportError is mocked so the real deferred @sentry/react path never loads.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError } from '@/lib/telemetry-defer';
import { ErrorBoundary } from './ErrorBoundary';

// vi.mock is hoisted by vitest above the imports regardless of placement.
vi.mock('@/lib/telemetry-defer', () => ({
  reportError: vi.fn(),
}));

const mockReportError = reportError as unknown as ReturnType<typeof vi.fn>;

function Boom({ when }: { when: boolean }): React.ReactElement {
  if (when) throw new Error('kaboom');
  return <div>safe child</div>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ErrorBoundary', () => {
  it('(a) renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>hello world</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello world')).toBeDefined();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('(b) renders the fallback when a child throws', () => {
    // Silence React's expected error log for the thrown render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary label="Home tab">
        <Boom when />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    // Body reassurance + scope label.
    expect(screen.getByText(/Your data is safe on this device\./)).toBeDefined();
    expect(screen.getByText(/Home tab/)).toBeDefined();
    // Recoverable: a Reload action is present, and the alert role is set.
    expect(screen.getByRole('button', { name: /reload/i })).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
    spy.mockRestore();
  });

  it('(c) calls the capture function with the thrown error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom when />
      </ErrorBoundary>,
    );
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const arg = mockReportError.mock.calls[0]?.[0] as Error;
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toBe('kaboom');
    spy.mockRestore();
  });
});
