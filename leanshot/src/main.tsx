import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { applyThemeToDOM } from './hooks/useTheme';
import { initAnalytics } from './lib/analytics';
import { detectPlatform } from './lib/native/platform';
import { beforeSend } from './lib/sentry';
import { initSentryNative } from './lib/sentry-native';
import { hydrate } from './lib/store';
// Phase 28 Plan 28-05 ORG-06: supabase singleton for wireAuthInvalidation.
import { supabase } from './lib/supabase';
import { scheduleSyncInit } from './lib/sync-defer';
import { deferAnalyticsInit, deferSentryInit } from './lib/telemetry-defer';
// Phase 28 Plan 28-05 ORG-06: USER_UPDATED invalidation — extracted helper
// for testability; wired between hydrate() and createRoot.render() below.
import { wireAuthInvalidation } from './lib/wire-auth-invalidation';
import type { Theme } from './types';

// Phase 6 hotfix: Supabase implicit-grant email-link flow returns the access
// token via URL fragment (`#access_token=…`). When auth.ts uses a hash-based
// redirectTo like `${origin}/#/auth/verify`, the final URL is
// `${origin}/#/auth/verify#access_token=…` — a DOUBLE-`#` URL. The browser
// only treats the first `#` as the fragment delimiter, so `window.location.hash`
// becomes `#/auth/verify#access_token=…`, which supabase-js's
// `parseParametersFromURL` (URLSearchParams over the post-`#` substring)
// cannot decode (no `access_token` key emerges; the first key is the literal
// `/auth/verify#access_token`). The result is a silent verify-failure: the
// session never materializes, VerifyEmailLanding's polling times out, and
// the user is bounced back to signup as if the link never worked.
//
// Fix: BEFORE supabase-js initializes (its first load is deferred via
// `scheduleSyncInit` below), detect the double-`#` pattern, stash the
// intended hash route in sessionStorage, and rewrite the URL so the
// token portion sits at the start of the fragment. supabase-js's
// `_initialize()` then parses the session cleanly and fires SIGNED_IN; the
// stashed route is restored on the next tick (see App.tsx's `restorePostAuthRoute`
// handler) so the user lands on `#/auth/verify` and VerifyEmailLanding's
// poll picks up the now-real session immediately.
//
// This block is intentionally synchronous and runs BEFORE the React tree
// mounts so a) the initial selectView() call sees the correct hash, and
// b) supabase-js (loaded later via scheduleSyncInit) sees the clean URL.
try {
  const hash = window.location.hash;
  if (hash.includes('#access_token=') || hash.includes('#error=')) {
    const dbl = hash.indexOf('#', 1);
    if (dbl > 0) {
      const route = hash.slice(0, dbl); // e.g. '#/auth/verify'
      const tokenPart = hash.slice(dbl + 1); // 'access_token=…&…'
      sessionStorage.setItem('leanshot_post_auth_route', route);
      history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#${tokenPart}`,
      );
    }
  }
} catch {
  /* sessionStorage can be unavailable (Safari private mode); fall through
     and let the auth flow degrade — the legacy behavior pre-hotfix. */
}

// Phase 16 MOBILE-09: native-platform Sentry init runs SYNCHRONOUSLY here,
// BEFORE createRoot below, so a crash during hydrate()/first-paint is
// captured by Sentry Cocoa / Sentry Android (native crash handler is
// armed once Sentry.init resolves the bridge). The web path's deferred
// init stays unchanged (Phase 2.1 perf fix below).
//
// VITE_SENTRY_RELEASE is set per-platform by fastlane in Plan 16-09:
// - iOS:     'ios@${CFBundleShortVersionString}'
// - Android: 'android@${versionName}'
//
// DSN routing: see 16-CONTEXT-ADDENDUM-sentry-per-platform-projects.md
// (supersedes D-17 single-project decision 2026-05-16). Three separate
// Sentry projects under org `optimizenet`: leanshot-{web,ios,android}.
// VITE_SENTRY_DSN_{IOS,ANDROID,WEB} are the per-platform DSNs; the legacy
// VITE_SENTRY_DSN remains as a safety fallback when an override is unset.
// Vite needs STATIC import.meta.env access — dynamic keys aren't inlined.
//
// Phase 2.1 perf fix (web path only): telemetry init is DEFERRED to after
// first paint — was static `Sentry.init(...)` here in Phase 2; that pulled
// @sentry/* into the entry static graph, auto-preloaded a 93 kB gz
// vendor-telemetry chunk, and pinned SPA Lighthouse Performance at ~0.76.
//
// D-12 (Phase 1) error-capture floor is preserved on web by
// `deferSentryInit`'s pre-init `error`/`unhandledrejection` listeners that
// buffer events until Sentry's dynamic import resolves and drains them.
const _platform = detectPlatform();
if (_platform === 'ios' || _platform === 'android') {
  const nativeDsn =
    _platform === 'ios'
      ? (import.meta.env.VITE_SENTRY_DSN_IOS as string | undefined)
      : (import.meta.env.VITE_SENTRY_DSN_ANDROID as string | undefined);
  initSentryNative({
    dsn: nativeDsn || (import.meta.env.VITE_SENTRY_DSN as string) || '',
    release: (import.meta.env.VITE_SENTRY_RELEASE as string) ?? `${_platform}@unknown`,
    beforeSend,
  });
} else {
  deferSentryInit(beforeSend);
}

// 1) Apply the saved/system theme to the DOM immediately so the first
//    paint matches and we don't show a flash of the wrong palette.
const initialTheme: Theme = ((): Theme => {
  try {
    const saved = localStorage.getItem('leanshot_theme_v4');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* noop */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
applyThemeToDOM(initialTheme);

// Phase 4 D-03 cleanup: remove any stale BYO Anthropic API key from
// localStorage (the old pasted-key UX is gone in v4 — AI now flows
// through the server-side ai-chat Edge Function). Silent try/catch
// (S-3) so private-mode browsers don't crash.
try {
  localStorage.removeItem('leanshot_anthropic_key');
} catch {
  /* noop */
}

// 2) Synchronously rehydrate Zustand from localStorage BEFORE first render.
//    This avoids flashing the marketing page for already-onboarded users.
void hydrate().then(() => {
  // Phase 28 Plan 28-05 ORG-06 — invalidate org slice on Auth USER_UPDATED
  // (CONTEXT D-02). Registered AFTER hydrate() so the store is rehydrated
  // before the listener fires, and BEFORE createRoot.render() so the app
  // boots with the listener active from the first render cycle.
  // T-28-05-02 mitigation: stale role after admin removed from org mid-session.
  wireAuthInvalidation(supabase);

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // 3) Analytics AFTER first render, scheduled at idle so the posthog-js
  //    bundle never blocks the cold-load critical path. `initAnalytics()`
  //    handles its own dynamic import + queue draining internally.
  //
  //    Phase 24 Plan 04 D-13 — PostHog identify + alias bridge:
  //    identify(supabase_uid) + aliasAnonymousToUid(anon_id, uid) fire from
  //    App.tsx's SIGNED_IN branch (which already has the auth state subscription).
  //    posthog.reset() fires from App.tsx's SIGNED_OUT branch.
  //    Wired there rather than here to avoid a second onAuthStateChange subscription
  //    (extra subscriptions cause duplicate sync work per plan 24-04 guidance).
  deferAnalyticsInit(initAnalytics);

  // 4) Phase 6 D-12 — dynamic-import @/lib/sync + @/lib/auth-migration after
  //    first paint so they (and transitively @supabase/supabase-js) stay
  //    off the entry chunk static graph. The deferred-init wrapper buffers
  //    any deferOnSignedIn / deferOnSignedOut / deferFlush calls App.tsx
  //    issues before this load resolves, then drains them in FIFO order.
  scheduleSyncInit();
});
