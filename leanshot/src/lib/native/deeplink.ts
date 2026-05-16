// Phase 16 Plan 16-02 fill — Universal Link / App Link dispatcher (MOBILE-06).
// Source: RESEARCH Pattern 2 (capacitorjs.com/docs/v8/apis/app#addlistenerappurlopen-).
//
// Replaces the Phase 12 D-01 throw-stub (the legacy single-URL handler +
// route-type alias — both had zero call sites outside the stub itself; removed
// per plan).
//
// Routing model (D-11):
// - PATHNAME_PREFIXES → pushState + dispatch popstate (drives App.tsx's
//   popstate-listening recompute). Covers clinic, marketing, share.
// - HASH_PREFIXES → window.location.hash assignment (drives App.tsx's
//   hashchange-listening recompute). Covers auth, legal.
// - Universal Links never carry fragments (see Pitfall §"`#`-prefix in AASA
//   paths" in 16-RESEARCH.md) so the OS event's URL has only pathname+search;
//   we synthesize the `#/...` hash for hash-routed views.
//
// Idempotency: `_installed` module flag is set AFTER App.addListener resolves
// so a synchronous double-call within a single tick (StrictMode dev double-
// mount) still de-dupes. The flag survives between calls but is reset by
// vi.resetModules() between tests.
//
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in
// eslint.config.js (Phase 12 two-tunnel firewall, D-02 Zone 1).
import { App, type URLOpenListenerEvent } from '@capacitor/app';

const PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/'];
const HASH_PREFIXES = ['/auth/', '/legal/'];

let _installed = false;
let _installing: Promise<void> | null = null;

export function installDeepLinkHandler(): void {
  if (_installed || _installing) return;
  _installing = (async () => {
    await App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      try {
        const u = new URL(event.url);
        const path = u.pathname;
        // PATHNAME branch: dashboard / clinic / marketing / share routes
        if (PATHNAME_PREFIXES.some((p) => path === p || path.startsWith(p))) {
          window.history.pushState({}, '', path + u.search);
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        // HASH branch: auth + legal hash routes
        for (const hp of HASH_PREFIXES) {
          if (path.startsWith(hp)) {
            window.location.hash = '#' + path + u.search;
            return;
          }
        }
        // Fallback: marketing root
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch {
        // Malformed URL — swallow silently (mitigates T-16-02-01).
      }
    });
    _installed = true;
    _installing = null;
  })();
}
