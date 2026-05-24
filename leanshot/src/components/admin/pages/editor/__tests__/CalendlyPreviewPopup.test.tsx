/**
 * Phase 41 Plan 41-04 Task 2 — CalendlyPreviewPopup tests (EMBED-08).
 *
 * Covers all 8 behaviors from 41-04-PLAN.md <behavior> for the Calendly
 * popup-OAuth orchestrator (Surface D in 41-UI-SPEC.md):
 *   1. D1 unauth initial render: Calendly logo + "Connect Calendly" CTA
 *   2. popup-blocked → D2-error: window.open returns null
 *   3. D2 in-progress: window.open returns popup; Spinner + Cancel link
 *   4. postMessage origin validation (LOAD-BEARING): event.origin === 'https://evil.com' DROPPED
 *   5. postMessage origin valid → D3: event.origin === 'https://calendly.com'
 *   6. Token storage in-memory only: localStorage stays empty
 *   7. Unmount cleanup: removeEventListener called on unmount
 *   8. Disconnect from D3 returns to D1
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendlyPreviewPopup } from '../CalendlyPreviewPopup';

type FakePopup = {
  closed: boolean;
  close: () => void;
};

function makeFakePopup(): FakePopup {
  return {
    closed: false,
    close: vi.fn(function (this: FakePopup) {
      this.closed = true;
    }),
  };
}

function dispatchMessageEvent(origin: string, data: unknown): void {
  // Build a MessageEvent ourselves so we can set `origin` (read-only via
  // the constructor option in jsdom).
  const evt = new MessageEvent('message', { origin, data });
  window.dispatchEvent(evt);
}

describe('CalendlyPreviewPopup', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('Test 1 — D1 unauthenticated: initial render shows "Connect Calendly" CTA', () => {
    render(<CalendlyPreviewPopup />);
    expect(
      screen.getByRole('button', { name: /connect calendly/i }),
    ).toBeInTheDocument();
    // D1 secondary copy per UI-SPEC §Surface D State D1
    expect(
      screen.getByText(/connect your calendly account to preview availability/i),
    ).toBeInTheDocument();
  });

  it('Test 2 — popup-blocked → D2-error: window.open returns null', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    // D2-error copy verbatim per UI-SPEC §Copywriting Contract
    expect(
      screen.getByText(/popup blocked\. allow popups for this site to connect calendly\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // Fallback escape link
    const fallbackLink = screen.getByRole('link', {
      name: /open calendly settings in new tab/i,
    });
    expect(fallbackLink).toBeInTheDocument();
    expect(fallbackLink).toHaveAttribute('target', '_blank');
  });

  it('Test 3 — D2 in-progress: window.open returns popup; Spinner + Cancel', () => {
    const fakePopup = makeFakePopup();
    vi.spyOn(window, 'open').mockReturnValue(fakePopup as unknown as Window);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));
    // D2 spinner + waiting copy
    expect(
      screen.getByText(/waiting for calendly confirmation in popup window/i),
    ).toBeInTheDocument();
    // Cancel link closes the popup
    const cancel = screen.getByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancel);
    expect(fakePopup.close).toHaveBeenCalled();
  });

  it('Test 4 — postMessage origin validation: event.origin "https://evil.com" is DROPPED', () => {
    const fakePopup = makeFakePopup();
    vi.spyOn(window, 'open').mockReturnValue(fakePopup as unknown as Window);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));

    // Attacker posts a forged success result from a non-allowed origin.
    act(() => {
      dispatchMessageEvent('https://evil.com', {
        type: 'calendly-oauth-result',
        token: 'evil_token',
        expires_in: 3600,
      });
    });

    // State must NOT have advanced to D3 — still in D2-in-progress.
    expect(
      screen.getByText(/waiting for calendly confirmation in popup window/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });

  it('Test 5 — postMessage origin "https://calendly.com" → D3 (connected)', () => {
    const fakePopup = makeFakePopup();
    vi.spyOn(window, 'open').mockReturnValue(fakePopup as unknown as Window);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));

    act(() => {
      dispatchMessageEvent('https://calendly.com', {
        type: 'calendly-oauth-result',
        token: 'tok_abc',
        expires_in: 3600,
      });
    });

    // D3 caption present + Disconnect link visible.
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('Test 6 — token storage: NOT in localStorage / sessionStorage', () => {
    const fakePopup = makeFakePopup();
    vi.spyOn(window, 'open').mockReturnValue(fakePopup as unknown as Window);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));
    act(() => {
      dispatchMessageEvent('https://calendly.com', {
        type: 'calendly-oauth-result',
        token: 'tok_abc',
        expires_in: 3600,
      });
    });
    // After auth: localStorage + sessionStorage stay empty.
    expect(window.localStorage.getItem('calendly_token')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('Test 7 — unmount cleanup: removeEventListener called for "message"', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<CalendlyPreviewPopup />);
    // The component registers a message listener on mount.
    const registeredMessageListener = addSpy.mock.calls.some(
      ([type]) => type === 'message',
    );
    expect(registeredMessageListener).toBe(true);

    unmount();
    const cleanedUpMessageListener = removeSpy.mock.calls.some(
      ([type]) => type === 'message',
    );
    expect(cleanedUpMessageListener).toBe(true);
  });

  it('Test 8 — Disconnect from D3 clears token + returns to D1', () => {
    const fakePopup = makeFakePopup();
    vi.spyOn(window, 'open').mockReturnValue(fakePopup as unknown as Window);
    render(<CalendlyPreviewPopup />);
    fireEvent.click(screen.getByRole('button', { name: /connect calendly/i }));
    act(() => {
      dispatchMessageEvent('https://calendly.com', {
        type: 'calendly-oauth-result',
        token: 'tok_abc',
        expires_in: 3600,
      });
    });
    // D3 → click Disconnect
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    // Back to D1
    expect(
      screen.getByRole('button', { name: /connect calendly/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });
});
