# Phase 22 — Deferred Items (cross-plan tracker)

## From Plan 22-10 (out-of-scope discoveries)

1. **`feature-flag-overrides.test.ts` import-failure (Wave 0 scaffold)**
   - File: `leanshot/src/lib/consent/__tests__/feature-flag-overrides.test.ts`
   - Issue: Test file (Wave 0 scaffold from commit `eea3017`) imports
     `@/lib/consent/feature-flag-overrides` which does not exist yet — file
     crashes at load time (vitest reports "Failed to resolve import") even
     though the `it.skip` bodies would otherwise be inert.
   - Cause: Pre-existing Wave 0 scaffolding gap; impl owner is plan 22-09
     (PostHog feature-flag overrides for ADMIN-05).
   - Out of scope for 22-10 per execution scope boundary rule.
   - Action: Plan 22-09 must ship `src/lib/consent/feature-flag-overrides.ts`
     OR convert the scaffold to a stub with a no-op import. Until then, the
     test file fails at load — not a 22-10 regression.

2. **Bundle-budget chunk verification deferred to plan 22-12**
   - `vanilla-cookieconsent` is installed and the Pattern 4 dynamic-import
     gate is wired (`src/lib/consent/consent-defer.ts` → `await import('@/components/consent/consent-config')`).
   - Because `CookieConsentBootstrap` is not yet mounted at App.tsx root,
     tree-shaking removes the consent code from the production bundle
     entirely. Index gz baseline 15.03 kB (50 kB ceiling) — unchanged.
   - The chunk-isolation invariant (vanilla-cookieconsent in a separate
     lazy chunk, never on index static graph) becomes verifiable when plan
     22-12 wires `<CookieConsentBootstrap />` into `App.tsx`. Add a CI guard
     at that time: `grep -L vanilla-cookieconsent dist/assets/index-*.js`.

3. **Per-IP capture deferred (ip_inet stays NULL in v1.2)**
   - `consent_records.ip_inet` is server-side only; client cannot read its
     own IP without an extra round-trip. v1.2 captures `user_agent` +
     `country_code` (via `window.__VERCEL_GEO__`) only. Per-IP capture is
     deferable per UI-SPEC; if regulator audience pushes back, fold into a
     Phase 22b Edge Function variant of upsertConsentRecord.

4. **Phase 12 firewall `window.__VERCEL_GEO__` global not yet exposed**
   - `consent-config.ts` reads `window.__VERCEL_GEO__?.country` for the
     EU/US default split. If Phase 12 only emits the header server-side
     and never copies it onto `window`, the privacy-default fallback
     (unknown geo → EU treatment) kicks in for every visitor. Action: when
     22-12 wires CookieConsentBootstrap, add a small inline script in
     `index.html` that reads the `x-vercel-ip-country` request header value
     (already injected by Vercel edge) into `window.__VERCEL_GEO__` before
     React mounts. OR accept that all visitors get EU treatment by default
     and let CCPA users explicitly opt in via the "Customize" inline-expand.
