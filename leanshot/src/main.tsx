import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { I18nSuspenseFallback } from './components/i18n/I18nSuspenseFallback';
import { applyThemeToDOM } from './hooks/useTheme';
import { initAnalytics } from './lib/analytics';
import {
  applyBrandTokens,
  fetchClinicBranding,
  parseClinicSlug,
  BRAND_CACHE_KEY_PREFIX,
} from './lib/brand-tokens';
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

// Phase 31 Plan 31-03 — D-07 pre-mount fetch + warm-paint (ORG-11 first-paint contract)
//
// Why this runs here (BETWEEN applyThemeToDOM and void hydrate()):
//   - Theme is already set on <html data-theme="…"> so the brand overlay
//     applies on top of the correct light/dark palette.
//   - hydrate() and createRoot.render() run AFTER, so React's first paint
//     already sees the correct --brand-* CSS custom properties on <html>.
//
// Why bare fetch and not supabase-js:
//   supabase-js is deferred until after first render via scheduleSyncInit()
//   (Phase 6 D-12). At this point the singleton is not yet constructed; using
//   it would pull @supabase/supabase-js into the entry chunk static graph,
//   defeating the deferred-init pattern that keeps the index chunk lean.
//
// Why the fire-and-forget Promise is NOT awaited:
//   applyBrandTokens(cached) already gave returning visitors a zero-FOUT
//   first paint. Cold-visit users see the brand land when the RPC resolves,
//   which is typically BEFORE React's first render completes at edge latency
//   (RESEARCH Finding 3). Awaiting would add that latency to every page load.
{
  const _brandSlug = parseClinicSlug(window.location.pathname);
  if (_brandSlug !== null) {
    // Warm-paint: apply cached tokens synchronously (Safari private-mode safe)
    try {
      const _cached = localStorage.getItem(BRAND_CACHE_KEY_PREFIX + _brandSlug);
      if (_cached) {
        applyBrandTokens(JSON.parse(_cached) as Parameters<typeof applyBrandTokens>[0]);
      }
    } catch {
      /* noop — private mode or malformed cache; warm paint falls back to defaults */
    }

    // Async refresh: fire-and-forget (NOT awaited; hydrate() proceeds in parallel)
    void fetchClinicBranding(_brandSlug).then((fresh) => {
      if (fresh !== null) {
        // Update cache with fresh tokens
        try {
          localStorage.setItem(BRAND_CACHE_KEY_PREFIX + _brandSlug, JSON.stringify(fresh));
        } catch {
          /* noop — private mode; skip cache write */
        }
        // Overwrite stale warm-paint with authoritative server response
        applyBrandTokens(fresh);
        // Inject or update favicon if present
        if (fresh.favicon_url) {
          const existing = document.querySelector("link[rel='icon']");
          if (existing) {
            (existing as HTMLLinkElement).href = fresh.favicon_url;
          } else {
            const link = document.createElement('link');
            link.rel = 'icon';
            link.href = fresh.favicon_url;
            document.head.appendChild(link);
          }
        }
      }
    });
  }
}

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
void hydrate().then(async () => {
  // Phase 28 Plan 28-05 ORG-06 — invalidate org slice on Auth USER_UPDATED
  // (CONTEXT D-02). Registered AFTER hydrate() so the store is rehydrated
  // before the listener fires, and BEFORE createRoot.render() so the app
  // boots with the listener active from the first render cycle.
  // T-28-05-02 mitigation: stale role after admin removed from org mid-session.
  wireAuthInvalidation(supabase);

  // Phase 32 Plan 32-01 I18N-01/02/03 — initialize i18next AFTER hydrate
  // (store warm) and BEFORE first render so /?lang=es paints Spanish without
  // an EN flash. Dynamic-imported so i18next stays out of the entry chunk
  // static graph (lands in the i18n-runtime lazy chunk per
  // vite.config.ts manualChunks rule).
  const { initI18n } = await import('./lib/i18n/init');
  await initI18n();

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <Suspense fallback={<I18nSuspenseFallback />}>
        <App />
      </Suspense>
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
