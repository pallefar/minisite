---
phase: 64-legal-refresh
plan: 07
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/consent/consent-config.ts
  - src/components/layout/LegalFooter.tsx
  - src/App.tsx
  - public/sitemap.xml
  - src/components/consent/__tests__/consent-config.cpra.test.ts
autonomous: true
requirements:
  - LEGAL-07
  - LEGAL-10
  - AUTH-16
user_setup: []

must_haves:
  truths:
    - "Cookie banner consentModal description includes 'Do Not Sell or Share' link to /privacy/do-not-sell for US visitors"
    - "Cookie banner copy mentions sign-in rate-limiting per AUTH-16 cross-reference"
    - "App.tsx adds three new hash routes: #/privacy/do-not-sell → DoNotSellPage; #/legal/accessibility → AccessibilityPage; #/legal/dmca → DMCAPage (all lazy)"
    - "LegalFooter LEGAL_LINKS includes 5 new entries: Accessibility, DMCA, Do Not Sell, Data Rights (DSAR), and preserves the existing 4"
    - "public/sitemap.xml lists the new /legal/* + /privacy/do-not-sell + /account/data-rights URLs"
    - "axe-core CLI run against the cookie banner staging URL yields ZERO WCAG 2.2 AA violations (or: documented remediations applied)"
  artifacts:
    - path: "src/components/consent/consent-config.ts"
      provides: "Updated banner copy with Do Not Sell link + AUTH-16 rate-limit mention"
      contains: "Do Not Sell"
    - path: "src/components/layout/LegalFooter.tsx"
      provides: "LEGAL_LINKS extended with 4 new entries (Accessibility, DMCA, Do Not Sell, Data Rights)"
      contains: "Accessibility"
    - path: "src/App.tsx"
      provides: "Three new hash route mappings + lazy imports for new legal pages"
      contains: "DoNotSellPage"
    - path: "public/sitemap.xml"
      provides: "Sitemap entries for new legal surfaces"
      contains: "/privacy/do-not-sell"
  key_links:
    - from: "src/components/consent/consent-config.ts"
      to: "/privacy/do-not-sell page (Plan 64-05)"
      via: "anchor href in consentModal description"
      pattern: "/privacy/do-not-sell"
    - from: "src/App.tsx"
      to: "src/components/legal/DoNotSellPage.tsx + AccessibilityPage.tsx + DMCAPage.tsx (Plan 64-05)"
      via: "React.lazy hash-route mapping"
      pattern: "DoNotSellPage|AccessibilityPage|DMCAPage"
---

<objective>
Update the existing cookie banner (Phase 22 `vanilla-cookieconsent` config) with CPRA-mandated "Do Not Sell" link in the banner footer (per LEGAL-07) + AUTH-16 cross-reference (mentions sign-in rate-limiting per CPRA notice-of-security-practices clause). Add the three new Phase 64 hash routes to `App.tsx` (Plan 64-05 created the components; this plan wires their routes). Audit + extend `LegalFooter`'s `LEGAL_LINKS` to expose all legal surfaces from any footer-bearing surface. Update `public/sitemap.xml` with the new URLs per LEGAL-10.

Purpose: LEGAL-07 + LEGAL-10 + AUTH-16 closure. The cookie banner is the highest-frequency-impressions surface for CPRA compliance signaling; the App.tsx hash routes complete the page wiring for Plans 64-05's DoNotSellPage/Accessibility/DMCA pages.

Output: 5 file edits, one new test for the banner copy invariant. NO axe-core script automation (that's a Plan 64-08 close-out human-verify gate against staging URL).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-UI-SPEC.md

<!-- Reuse targets named explicitly -->
@src/components/consent/consent-config.ts
@src/components/consent/CookieConsentBootstrap.tsx
@src/lib/consent/consent-defer.ts
@src/components/layout/LegalFooter.tsx
@src/App.tsx

<interfaces>
<!-- consent-config.ts (Phase 22) — vanilla-cookieconsent v3 config -->
// `consentModal.description` (lines ~241-243) carries the banner copy; isEU-conditional currently
// US copy currently: 'We use cookies to keep the app working, measure how it's used, and improve your experience. Essential cookies are always on. You can opt out of analytics any time. &lt;a href="/privacy" target="_blank"&gt;Privacy policy&lt;/a&gt;'
// We extend the US copy ONLY with the Do Not Sell anchor + AUTH-16 mention

<!-- LegalFooter.tsx (Phase 7) — LEGAL_LINKS constant -->
export const LEGAL_LINKS: readonly LegalLink[] = [
  { label: 'Privacy policy', hash: '#/legal/privacy' },
  { label: 'Consumer health data (WA residents)', hash: '#/legal/consumer-health' },
  { label: 'Terms of service', hash: '#/legal/terms' },
  { label: 'Medical disclaimer', hash: '#/legal/disclaimer' },
] as const;
// Extend with: Accessibility, DMCA, Do Not Sell, Data Rights (DSAR)

<!-- App.tsx legal hash route resolver (Phase 7) -->
// resolveLegalHash(hash: string) currently maps #/legal/privacy|consumer-health|terms|disclaimer → lazy components
// Extend the switch with #/legal/accessibility, #/legal/dmca, and add #/privacy/do-not-sell as a NEW top-level legal hash (note: NOT #/legal/do-not-sell because UI-SPEC §2 + CONTEXT specify /privacy/do-not-sell)
// Per [[reference_react_router_consumer_admin_split]] consumer surface uses hash routes; do NOT add react-router-dom Route — stay Zustand+hash

<!-- vanilla-cookieconsent v3 (locked package) — banner description supports inline HTML anchors per existing pattern -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Update consent-config banner copy with Do Not Sell link + AUTH-16 mention + add CPRA test</name>
  <files>
    src/components/consent/consent-config.ts,
    src/components/consent/__tests__/consent-config.cpra.test.ts
  </files>
  <behavior>
    - Test 1: For US users (isEU=false), consentModal.en.description contains the substring `Do Not Sell or Share` linking to `/privacy/do-not-sell`
    - Test 2: For US users, consentModal.en.description contains the substring matching `/sign-in.*rate-limit/i` per AUTH-16 cross-reference
    - Test 3: For EU users (isEU=true), consentModal description does NOT include the Do Not Sell link (CCPA-specific; out of EU GDPR scope)
    - Test 4: preferencesModal "Further information" section description retains `privacy@leanshot.app` contact AND now ALSO mentions the `/privacy/do-not-sell` page
    - Test 5: Banner copy stays under 600 characters (UI density / WCAG readability budget)
  </behavior>
  <action>
    Edit `src/components/consent/consent-config.ts` — locate the `translations.en.consentModal.description` field (lines ~241-243 region).

    Replace the US-conditional copy (the `: 'We use cookies …'` branch of the isEU ternary) with:

    US copy (replace verbatim): `'We use cookies to keep the app working, measure how it's used, and improve your experience. Essential cookies are always on. You can opt out of analytics any time. We also use sign-in rate-limiting to protect your account. &lt;a href="/privacy" target="_blank"&gt;Privacy policy&lt;/a&gt; · &lt;a href="/privacy/do-not-sell"&gt;Do Not Sell or Share My Personal Information&lt;/a&gt;'`

    (Note: the Do Not Sell link uses no `target="_blank"` so it opens in-app per UI-SPEC §6.)

    Update the `preferencesModal.sections` "Further information" entry description to also include the Do Not Sell anchor: `'Questions? Read our &lt;a href="/privacy" target="_blank"&gt;privacy policy&lt;/a&gt;, exercise &lt;a href="/privacy/do-not-sell"&gt;Do Not Sell or Share&lt;/a&gt; rights, or email privacy@leanshot.app.'`

    DO NOT alter the EU branch — EU users see GDPR-tailored copy without CCPA-specific Do Not Sell link.

    DO NOT alter the geo-default fail-safe block (`isEU = (geo === null) ? true : EU_COUNTRY_CODES.has(geo)` per T-22-58) — that's the Phase 22 fail-safe + still correct.

    Create test file `src/components/consent/__tests__/consent-config.cpra.test.ts`. The test calls the exported config builder with `isEU=false` AND with `isEU=true` and asserts the 5 behavior cases above. If the config is constructed as a side-effect of `initCookieConsent()`, refactor the relevant string-building into a small exported `buildConsentModalDescription(isEU: boolean): string` helper to make it directly testable WITHOUT triggering the vanilla-cookieconsent value-import (bundle-budget contract per file-header comment). Keep the change minimal: export the helper, replace inline expressions with helper calls, do NOT change behavior of other config sections.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q "Do Not Sell or Share" src/components/consent/consent-config.ts &amp;&amp;
      grep -q "/privacy/do-not-sell" src/components/consent/consent-config.ts &amp;&amp;
      grep -qi "rate.limit\|rate-limit" src/components/consent/consent-config.ts &amp;&amp;
      test -f src/components/consent/__tests__/consent-config.cpra.test.ts &amp;&amp;
      npx vitest run src/components/consent/__tests__/consent-config.cpra.test.ts --reporter=basic --run --config vite.config.ts &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    Banner US copy includes Do Not Sell anchor + AUTH-16 rate-limit mention; EU copy unchanged; helper exported for testing; 5 behavior tests pass; tsc clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add new App.tsx hash routes + extend LegalFooter + update sitemap.xml</name>
  <files>
    src/App.tsx,
    src/components/layout/LegalFooter.tsx,
    public/sitemap.xml
  </files>
  <action>
    Edit `src/App.tsx`:
    1. Add three new `React.lazy` imports near the existing legal-lazy block (around line 405-419):
       - `const DoNotSellPage = lazy(() =&gt; import('@/components/legal/DoNotSellPage').then((m) =&gt; ({ default: m.DoNotSellPage })));`
       - `const AccessibilityPage = lazy(() =&gt; import('@/components/legal/AccessibilityPage').then((m) =&gt; ({ default: m.AccessibilityPage })));`
       - `const DMCAPage = lazy(() =&gt; import('@/components/legal/DMCAPage').then((m) =&gt; ({ default: m.DMCAPage })));`
    2. Extend the `resolveLegalHash` switch (around lines 529-535) with three new cases:
       - `case '#/legal/accessibility': return AccessibilityPage;`
       - `case '#/legal/dmca': return DMCAPage;`
       (existing fallthrough returns the 404 component)
    3. Add a NEW top-level hash handler for `#/privacy/do-not-sell` because this URL is NOT under `#/legal/*` (per UI-SPEC §2 + CONTEXT). Locate the hash dispatch (around line 711 `if (opts.hash.startsWith('#/legal/')) return 'legal';`) and add a parallel branch:
       - `if (opts.hash.startsWith('#/privacy/do-not-sell')) return 'do-not-sell';` (new view kind)
       - Extend the `Phase19RouteView` union with `| 'do-not-sell'`
       - Add a render branch: when view === 'do-not-sell' render `&lt;Suspense fallback={…}&gt;&lt;DoNotSellPage /&gt;&lt;/Suspense&gt;` mirroring the existing 'legal' branch shape
    4. Preserve all existing Phase 7 hash-route precedents + the catch-all fallback.

    Edit `src/components/layout/LegalFooter.tsx`:
    Extend the `LEGAL_LINKS` constant with FOUR new entries appended in this order:
    - `{ label: 'Accessibility', hash: '#/legal/accessibility' }`
    - `{ label: 'DMCA', hash: '#/legal/dmca' }`
    - `{ label: 'Do Not Sell or Share', hash: '#/privacy/do-not-sell' }`
    - `{ label: 'Data rights (DSAR)', hash: '/settings/privacy/dsar' }` — NOTE: this one uses a pathname not a hash because the DSAR portal at `/settings/privacy/dsar` is a pathname route (per Phase 19 resolver + auth-required); LegalFooter renders it as a normal `&lt;a href&gt;` which the resolver picks up post-navigation.

    Update the `LegalLink` interface comment if needed to note pathname vs hash distinction. Keep total list ≤ 8 entries.

    Edit `public/sitemap.xml`:
    Add `&lt;url&gt;` entries for:
    - `https://leanshot.app/#/legal/privacy` (if missing)
    - `https://leanshot.app/#/legal/terms` (if missing)
    - `https://leanshot.app/#/legal/consumer-health` (if missing)
    - `https://leanshot.app/#/legal/disclaimer` (if missing)
    - `https://leanshot.app/#/legal/accessibility` (NEW)
    - `https://leanshot.app/#/legal/dmca` (NEW)
    - `https://leanshot.app/privacy/do-not-sell` (NEW — not a hash since it's a path)
    - `https://leanshot.app/settings/privacy/dsar` (NEW)
    Each `&lt;url&gt;` includes `&lt;loc&gt;`, `&lt;lastmod&gt;2026-05-27&lt;/lastmod&gt;`, `&lt;changefreq&gt;yearly&lt;/changefreq&gt;`, `&lt;priority&gt;0.4&lt;/priority&gt;`. If sitemap.xml doesn't yet exist at public/sitemap.xml, create it with the standard `urlset` envelope.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q "DoNotSellPage" src/App.tsx &amp;&amp;
      grep -q "AccessibilityPage" src/App.tsx &amp;&amp;
      grep -q "DMCAPage" src/App.tsx &amp;&amp;
      grep -q "/privacy/do-not-sell" src/App.tsx &amp;&amp;
      grep -q "#/legal/accessibility" src/App.tsx &amp;&amp;
      grep -q "#/legal/dmca" src/App.tsx &amp;&amp;
      grep -q "Accessibility" src/components/layout/LegalFooter.tsx &amp;&amp;
      grep -q "DMCA" src/components/layout/LegalFooter.tsx &amp;&amp;
      grep -q "Do Not Sell" src/components/layout/LegalFooter.tsx &amp;&amp;
      grep -q "Data rights" src/components/layout/LegalFooter.tsx &amp;&amp;
      test -f public/sitemap.xml &amp;&amp;
      grep -q "/legal/accessibility" public/sitemap.xml &amp;&amp;
      grep -q "/legal/dmca" public/sitemap.xml &amp;&amp;
      grep -q "/privacy/do-not-sell" public/sitemap.xml &amp;&amp;
      grep -q "/settings/privacy/dsar" public/sitemap.xml &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    App.tsx lazy-imports + hash-route-dispatches the three new legal pages; LegalFooter shows all 8 legal entries; sitemap.xml includes all legal URLs; tsc clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → consent-config builds banner HTML descriptor | static config; vanilla-cookieconsent escapes attribute strings; anchor href whitelist |
| browser → hash-route dispatch in App.tsx | client-side only; no server trust |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-07-01 | Tampering | banner HTML injection via translated string | mitigate | vanilla-cookieconsent v3 sanitizes attribute strings; only authored anchors used; no untrusted input |
| T-64-07-02 | Information Disclosure | banner copy ships without Do Not Sell link → silent CPRA non-compliance | mitigate | vitest test (Task 1) asserts the substring presence; CI gate prevents regression |
| T-64-07-03 | Tampering | sitemap.xml broken syntax → SEO disclosure failure | mitigate | npx tsc covers TS; for XML use `npx xmllint --noout public/sitemap.xml` if available (deferred to Plan 64-08 close-out if xmllint unavailable on agent shell) |
| T-64-07-04 | Information Disclosure | undefined Tailwind v4 token renders banner copy INVISIBLE | mitigate | banner copy uses vanilla-cookieconsent's own CSS — not Tailwind; this threat is N/A here |
| T-64-07-05 | Repudiation | LegalFooter cross-links break | mitigate | LegalFooter test (existing Phase 7 e2e spec asserts the LEGAL_LINKS shape — if Phase 64 changes the shape, that test must be updated to new 8-entry list) — flag in Plan 64-08 close-out |
| T-64-07-SC | Tampering | npm/pip/cargo installs | accept | No new packages |
</threat_model>

<verification>
- vitest passes for consent-config.cpra.test
- tsc passes
- App.tsx grep gates pass for all 3 new lazy components + route matchers
- LegalFooter grep gates pass for 4 new labels
- sitemap.xml exists with all expected URLs
- Banner Do Not Sell substring + AUTH-16 mention both present (axe-core re-audit deferred to Plan 64-08 close-out human-verify step against staging URL)
</verification>

<success_criteria>
- Cookie banner US copy includes Do Not Sell anchor + AUTH-16 mention
- App.tsx exposes #/legal/accessibility, #/legal/dmca, and /privacy/do-not-sell routes (hash + pathname respectively)
- LegalFooter LEGAL_LINKS includes all 8 entries (4 existing + 4 new)
- public/sitemap.xml lists all legal surfaces
- No new packages introduced
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-07-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
