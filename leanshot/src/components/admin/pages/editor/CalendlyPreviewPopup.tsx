/**
 * Phase 41 Plan 41-04 (EMBED-08) — Surface D Calendly inline-preview popup.
 *
 * The PageEditor property panel uses this component when block type is
 * `calendly`. Per CONTEXT V13-EMBED + RESEARCH Pitfall 6, the preview cannot
 * use a nested iframe — modern browsers block third-party-cookie iframe OAuth
 * (Safari ITP / Chrome 3p-cookie phase-out). We open a popup, run OAuth
 * first-party-to-Calendly, then receive the access token back via
 * `postMessage` from the OAuth callback Edge Fn.
 *
 * LOAD-BEARING SECURITY (T-41-04-01): The `message` event handler's FIRST
 * statement validates `event.origin` against a tight allow-list. Any event
 * from another origin is silently dropped + logged. This is the security
 * boundary — without it, a malicious page could forge a token.
 *
 * Token storage policy (T-41-04-04 / D-CONTEXT Open Question 2): in-memory
 * closure ONLY. NEVER persisted to client-side storage of any kind. The
 * token dies on unmount or via the explicit "Disconnect" CTA in State D3.
 *
 * Visual states (UI-SPEC §Surface D):
 *   - D1   — unauthenticated: Calendly logo + "Connect Calendly" CTA
 *   - D2   — popup in progress: Spinner + Cancel
 *   - D2-error — popup blocked: ShieldAlert icon + Try again + fallback link
 *   - D3   — authenticated: hostname caption + Disconnect link
 */

import { Calendar, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';

// =============================================================================
// Origin allow-list — FIRST guard in the postMessage handler.
// =============================================================================
//
// Calendly's authorize endpoint is `auth.calendly.com`; the OAuth callback Edge
// Fn delivers the success page from the LeanShot app origin (where the
// `/api/calendly/oauth-callback` Vercel rewrite forwards to the Supabase Edge
// Fn). Both are valid sources for the `calendly-oauth-result` event; any other
// origin is silently dropped.

const CALENDLY_OAUTH_ORIGIN = 'https://calendly.com';
const CALENDLY_AUTH_ORIGIN = 'https://auth.calendly.com';

type State = 'd1' | 'd2' | 'd2-error' | 'd3';

interface TokenState {
  token: string;
  expiresAt: number; // ms-since-epoch
}

interface CalendlyOAuthResult {
  type: 'calendly-oauth-result';
  token?: string;
  expires_in?: number | null;
  error?: string;
}

function isCalendlyOAuthResult(value: unknown): value is CalendlyOAuthResult {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { type?: unknown }).type === 'calendly-oauth-result';
}

export function CalendlyPreviewPopup(): React.ReactElement {
  const [state, setState] = useState<State>('d1');
  // Token kept in-memory closure ONLY — D-CONTEXT Open Question 2.
  // No useEffect persists this to storage.
  const [token, setToken] = useState<TokenState | null>(null);
  const popupRef = useRef<Window | null>(null);

  const handlePopupMessage = useCallback((event: MessageEvent) => {
    // LOAD-BEARING: FIRST guard. Events from any other origin are silently
    // dropped to defend T-41-04-01 (spoofing fake oauth-result events).
    if (
      event.origin !== CALENDLY_OAUTH_ORIGIN &&
      event.origin !== CALENDLY_AUTH_ORIGIN &&
      event.origin !== window.location.origin
    ) {
      // Acceptable fallback per plan: console.warn when Sentry helper is not
      // a captureMessage wrapper (current `@/lib/sentry` exposes a beforeSend
      // scrubber instead). Anomaly is surfaced via dev tools at minimum.
      console.warn('[CalendlyPreviewPopup] dropped message from bad origin', event.origin);
      return;
    }
    if (!isCalendlyOAuthResult(event.data)) return;

    const data = event.data;
    if (data.error || !data.token) {
      // OAuth-side error → flag popup-blocked / generic error path.
      setState('d2-error');
      return;
    }

    const ttlMs = typeof data.expires_in === 'number' ? data.expires_in * 1000 : 3600 * 1000;
    setToken({ token: data.token, expiresAt: Date.now() + ttlMs });
    setState('d3');
    // The popup will window.close() itself; clear our ref defensively.
    popupRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('message', handlePopupMessage);
    return () => {
      window.removeEventListener('message', handlePopupMessage);
    };
  }, [handlePopupMessage]);

  // WR-01 fix: enforce token TTL. While in state d3 with a token in state,
  // schedule auto-disconnect at expiresAt. If the token has already expired
  // (clock skew or remount with a stale token reference), disconnect
  // synchronously.
  useEffect(() => {
    if (state !== 'd3' || token === null) return;
    const remainingMs = token.expiresAt - Date.now();
    if (remainingMs <= 0) {
      setToken(null);
      setState('d1');
      return;
    }
    const id = window.setTimeout(() => {
      setToken(null);
      setState('d1');
    }, remainingMs);
    return () => {
      window.clearTimeout(id);
    };
  }, [state, token]);

  // WR-02 fix: while the popup is in flight (state d2), poll for popup.closed.
  // If the user dismisses the popup without completing OAuth, the message-event
  // path never fires — without this watch the UI sits in d2 indefinitely until
  // the user clicks Cancel.
  useEffect(() => {
    if (state !== 'd2') return;
    const id = window.setInterval(() => {
      const p = popupRef.current;
      if (p === null || p.closed) {
        window.clearInterval(id);
        // If we've already transitioned to d3 via message before close, leave
        // state alone — the message handler clears popupRef.current to null.
        // Only surface the error if we're still in d2 here.
        setState((prev) => (prev === 'd2' ? 'd2-error' : prev));
      }
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, [state]);

  const handleConnect = useCallback(() => {
    const popup = window.open(
      '/api/calendly/oauth-start',
      'calendly_oauth',
      'width=560,height=720,popup=yes',
    );
    // WR-02 fix: window.open returns either null (popup blocked) or a Window.
    // Window.closed is always a defined boolean, so the old `typeof popup.closed
    // === 'undefined'` clause was dead. Some browsers return a Window whose
    // .closed is immediately true under strict popup policy — keep that check.
    if (!popup || popup.closed) {
      setState('d2-error');
      return;
    }
    popupRef.current = popup;
    setState('d2');
  }, []);

  const handleCancel = useCallback(() => {
    try {
      popupRef.current?.close();
    } catch {
      // best-effort
    }
    popupRef.current = null;
    setState('d1');
  }, []);

  const handleDisconnect = useCallback(() => {
    setToken(null);
    setState('d1');
  }, []);

  // =============================================================================
  // Render
  // =============================================================================

  if (state === 'd2-error') {
    return (
      <Card
        variant="default"
        padding="md"
        className="w-[320px] h-[180px] flex flex-col items-center justify-center gap-2 border-[var(--color-danger)]"
      >
        <ShieldAlert aria-hidden="true" className="text-[var(--color-danger)]" size={20} />
        <p className="text-[var(--text-sm,13px)] text-center text-[var(--color-text)]">
          Popup blocked. Allow popups for this site to connect Calendly.
        </p>
        <Button variant="ghost" size="md" onClick={handleConnect}>
          Try again
        </Button>
        <a
          href="https://calendly.com/event_types/user/me"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--text-sm,13px)] text-[var(--color-text-secondary)] underline"
        >
          Open Calendly settings in new tab
        </a>
      </Card>
    );
  }

  if (state === 'd2') {
    return (
      <Card
        variant="default"
        padding="md"
        className="w-[320px] h-[180px] flex flex-col items-center justify-center gap-2"
      >
        <Spinner size="md" />
        <p className="text-[var(--text-sm,13px)] text-center text-[var(--color-text-secondary)]">
          Waiting for Calendly confirmation in popup window…
        </p>
        <button
          type="button"
          onClick={handleCancel}
          className="text-[var(--text-sm,13px)] text-[var(--color-text-secondary)] underline"
        >
          Cancel
        </button>
      </Card>
    );
  }

  if (state === 'd3' && token) {
    return (
      <Card
        variant="default"
        padding="md"
        className="w-[320px] h-[180px] flex flex-col items-center justify-center gap-2"
      >
        <Calendar aria-hidden="true" className="text-[var(--color-primary)]" size={32} />
        <p className="font-mono text-[var(--text-sm,13px)] text-[var(--color-text)]">
          calendly.com (connected)
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          className="text-[var(--text-sm,13px)] text-[var(--color-text-secondary)] underline"
        >
          Disconnect
        </button>
      </Card>
    );
  }

  // D1 — unauthenticated (initial state).
  return (
    <Card
      variant="default"
      padding="md"
      className="w-[320px] h-[180px] flex flex-col items-center justify-center gap-2"
    >
      <Calendar aria-hidden="true" className="text-[var(--color-primary)]" size={40} />
      <p className="text-[var(--text-sm,13px)] text-center text-[var(--color-text-secondary)]">
        Connect your Calendly account to preview availability.
      </p>
      <Button variant="primary" size="md" onClick={handleConnect}>
        Connect Calendly
      </Button>
    </Card>
  );
}

export default CalendlyPreviewPopup;
