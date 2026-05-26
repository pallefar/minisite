---
phase: 64-legal-refresh
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/legal/DoNotSellPage.tsx
  - src/components/legal/AccessibilityPage.tsx
  - src/components/legal/DMCAPage.tsx
  - src/components/legal/LegalLayout.tsx
  - src/components/legal/__tests__/DoNotSellPage.test.tsx
  - src/components/legal/__tests__/AccessibilityPage.test.tsx
  - src/components/legal/__tests__/DMCAPage.test.tsx
autonomous: true
requirements:
  - LEGAL-02
  - LEGAL-05
  - LEGAL-06
user_setup: []

must_haves:
  truths:
    - "Visiting #/privacy/do-not-sell renders the DoNotSellPage form"
    - "Submitting the Do-Not-Sell form POSTs to /functions/v1/privacy-optout-process and shows success / error states"
    - "Visiting #/legal/accessibility renders the AccessibilityPage with WCAG 2.2 AA conformance copy"
    - "Visiting #/legal/dmca renders the DMCAPage with takedown procedure + counter-notice procedure"
    - "All three pages use LegalLayout (with the title prop now actually rendered as <h1>)"
    - "All Primary CTAs use verb+noun copy: 'Submit opt-out request', 'Submit DMCA notice', 'Report an accessibility issue'"
    - "Cancel CTAs use 'Keep my data rights pending' / equivalent non-generic copy (per UI-SPEC §Copywriting + Phase 61 lesson)"
  artifacts:
    - path: "src/components/legal/DoNotSellPage.tsx"
      provides: "Standalone Do-Not-Sell opt-out form (LEGAL-02)"
      exports: ["DoNotSellPage"]
    - path: "src/components/legal/AccessibilityPage.tsx"
      provides: "Accessibility statement page (LEGAL-05)"
      exports: ["AccessibilityPage"]
    - path: "src/components/legal/DMCAPage.tsx"
      provides: "DMCA agent + takedown procedure page (LEGAL-06)"
      exports: ["DMCAPage"]
    - path: "src/components/legal/LegalLayout.tsx"
      provides: "LegalLayout updated to render the title prop as the page H1 (currently `void title` per file-header)"
      contains: "{title}"
  key_links:
    - from: "src/components/legal/DoNotSellPage.tsx"
      to: "/functions/v1/privacy-optout-process (Plan 64-02 Edge Fn)"
      via: "fetch POST with form payload"
      pattern: "privacy-optout-process|/functions/v1/privacy-optout"
    - from: "src/components/legal/LegalLayout.tsx"
      to: "{children} via <h1>{title}</h1>"
      via: "rendering the title prop"
      pattern: "{title}"
---

<objective>
Ship three NEW legal-page surfaces — DoNotSellPage (LEGAL-02), AccessibilityPage (LEGAL-05), DMCAPage (LEGAL-06) — and upgrade LegalLayout to actually render its `title` prop as the page H1 (currently a `void title` placeholder per the Phase 22 file-header contract).

Purpose: LEGAL-02/05/06 — three of the v1.4 launch BLOCKER items. All three reuse LegalLayout per D-Legal-Copy-Source + UI-SPEC Reuse Targets section.

Output: Three new TSX files + LegalLayout edit + three vitest files. Routes are added to `App.tsx` by Plan 64-07 (which owns App.tsx); this plan defines the lazy-loadable components only.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-UI-SPEC.md

<!-- Reuse targets named explicitly per [[feedback_planner_prompt_explicit_reuse_targets]] -->
@src/components/legal/LegalLayout.tsx
@src/components/legal/PrivacyPolicy.tsx
@src/components/ui/Button.tsx
@src/components/ui/Input.tsx

<interfaces>
<!-- LegalLayout (Phase 22, file-header contract) -->
export interface LegalLayoutProps { title: string; children: ReactNode; }
// CURRENT BEHAVIOR: `void title` — title not rendered; preserves API contract for future use
// THIS PLAN: render `<h1 className="text-heading font-display font-semibold mb-8">{title}</h1>` AS THE FIRST CHILD of <main>

<!-- Tailwind v4 @theme tokens (verified against src/index.css):
  --color-bg, --color-surface, --color-surface-elevated, --color-primary, --color-danger, --color-success
  --color-text, --color-text-secondary, --color-text-tertiary
  --color-warning-soft, --color-rose-soft, --color-border
-->

<!-- Phase 24/60 form pattern: client-side validate → fetch POST /functions/v1/&lt;fn-name&gt; → show success/error -->
<!-- Use `supabase.functions.invoke` OR `fetch(${SUPABASE_URL}/functions/v1/privacy-optout-process)` — keep consistent with rag-newsletter-unsubscribe-1click consumer pattern -->

<!-- React Helmet pattern (Phase 60-13 KnowledgeArticleDetailPage precedent) -->
import { Helmet } from 'react-helmet-async';
// Set &lt;title&gt; + meta description for each /legal/* page; React Helmet provider already mounted in App.tsx (Phase 60-13)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Upgrade LegalLayout to render the title prop as <h1></name>
  <files>src/components/legal/LegalLayout.tsx</files>
  <action>
    Edit `src/components/legal/LegalLayout.tsx`. Replace the `void title;` line with an actual H1 render inside `&lt;main&gt;`:

    Before existing `{children}`:
    `&lt;h1 className="text-heading font-display font-semibold mb-8 text-[var(--color-text)]"&gt;{title}&lt;/h1&gt;`

    Per UI-SPEC §Typography: page H1 on /legal/* uses font-display (Fraunces) at text-heading (28px) per Phase 60-13 KnowledgeArticleDetailPage precedent. Keep existing layout chrome (header back-link, main padding, LegalFooter).

    Update the file-header comment to remove the "currently unused in render" note + replace with "Renders the title prop as the page H1 per Phase 64 UI-SPEC §Surfaces in Scope" comment.

    Preserve existing PrivacyPolicy.tsx + TermsOfService.tsx + MedicalDisclaimer.tsx + ConsumerHealthData.tsx callers — they MAY already include their own H1 internally. Audit those callers: if any have an internal `&lt;h1&gt;`, ensure the resulting page does NOT have two H1s. If a caller already has H1, remove that internal H1 in this task's scope (those are existing files in Plan 64-04's scope for PrivacyPolicy + TermsOfService — coordinate via the file-ownership rule). For files NOT touched by 64-04 (MedicalDisclaimer + ConsumerHealthData), audit + remove duplicate H1.

    NOTE on file-overlap risk: PrivacyPolicy.tsx + TermsOfService.tsx are owned by Plan 64-04. This plan must NOT modify those files. Instead, Plan 64-04 must include a task to REMOVE any redundant H1 if LegalLayout now provides one — communicate via the LegalLayout.tsx interface change in `must_haves`. (This is the [[feedback_stub_then_replace_sibling_collision]] inverse: 64-04 will pass `title="…"` and 64-05 makes LegalLayout render it; both plans must be aware.)

    For PrivacyPolicy.tsx + TermsOfService.tsx already-existing internal H1s: include a one-line note in this plan's SUMMARY directing the merger / Plan 64-08 close-out to verify single-H1 invariant via `grep -c "&lt;h1" src/components/legal/*.tsx` (expect 1 per file).
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q "&lt;h1[^&gt;]*&gt;{title}&lt;/h1&gt;" src/components/legal/LegalLayout.tsx &amp;&amp;
      ! grep -q "void title" src/components/legal/LegalLayout.tsx &amp;&amp;
      grep -q "font-display" src/components/legal/LegalLayout.tsx &amp;&amp;
      grep -q "text-heading" src/components/legal/LegalLayout.tsx &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    LegalLayout renders {title} as a font-display 28px H1; tsc passes.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build DoNotSellPage + AccessibilityPage + DMCAPage + tests</name>
  <files>
    src/components/legal/DoNotSellPage.tsx,
    src/components/legal/AccessibilityPage.tsx,
    src/components/legal/DMCAPage.tsx,
    src/components/legal/__tests__/DoNotSellPage.test.tsx,
    src/components/legal/__tests__/AccessibilityPage.test.tsx,
    src/components/legal/__tests__/DMCAPage.test.tsx
  </files>
  <behavior>
    DoNotSellPage:
    - Test 1: Renders form with Name + Email + State-residency Select + 3 opt-out scope checkboxes
    - Test 2: Submitting without required fields shows inline validation errors; NO network call
    - Test 3: Valid submit → fetch POST to /functions/v1/privacy-optout-process with payload; success response renders success state with "We've received your request. Confirmation email sent to {email}. Allow 24 hours for propagation." per UI-SPEC §2
    - Test 4: Error response → renders red error text with "Try again — if the problem persists, email privacy@leanshot.app"
    - Test 5: Primary CTA copy is exactly "Submit opt-out request" (NOT generic "Submit")
    - Test 6: A confirmation Modal appears BEFORE submit with verbatim copy from UI-SPEC §Copywriting: "Submit this opt-out request? You can change your mind later by emailing privacy@leanshot.app. Allow 24 hours for propagation across our systems."

    AccessibilityPage:
    - Test 1: Renders LegalLayout with title="Accessibility Statement"
    - Test 2: Page body mentions WCAG 2.2 AA + ADA Title III + accessibility@leanshot.app + 30-day SLA per UI-SPEC §4
    - Test 3: "Report an accessibility issue" CTA renders as `mailto:accessibility@leanshot.app` link

    DMCAPage:
    - Test 1: Renders LegalLayout with title="DMCA Notice &amp; Takedown"
    - Test 2: Body sections: agent info (placeholder), takedown procedure, counter-notice procedure, safe-harbor disclaimer
    - Test 3: "Submit DMCA notice" CTA renders as `mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice` link
    - Test 4: Page includes inline disclaimer noting agent registration is pending Phase 70 UAT operator action
  </behavior>
  <action>
    Build three new TSX components matching UI-SPEC §2/§4/§5.

    **DoNotSellPage.tsx** (`/privacy/do-not-sell` per CONTEXT.md + UI-SPEC §2):
    - Wrapped in `&lt;LegalLayout title="Do Not Sell or Share My Personal Information"&gt;`
    - Helmet meta: `&lt;title&gt;Do Not Sell or Share My Personal Information · LeanShot&lt;/title&gt;` + meta description matching CCPA opt-out intent
    - Form fields per UI-SPEC §2:
      - `&lt;Input name="name" label="Your name" required maxLength={200} /&gt;`
      - `&lt;Input name="email" type="email" label="Your email" required /&gt;`
      - `&lt;Select name="state_residency"&gt;` with options CA / VA / CO / CT / UT / OTHER (use existing UI Select primitive; fall back to native `&lt;select&gt;` if no Select primitive exists)
      - 3 `&lt;Checkbox&gt;` for opt_out_scope: "Opt out of targeted advertising", "Opt out of sale of personal information", "Opt out of sharing with third parties"
    - **Pre-submit confirmation Modal** (Modal component from `src/components/ui/Modal.tsx`): verbatim copy from UI-SPEC §Copywriting destructive confirmation
    - **Primary CTA** (Button, primary variant, danger tone per UI-SPEC §1 destructive actions): exact label "Submit opt-out request"
    - **Cancel CTA** (Button, secondary): exact label "Keep my information as-is" (matches UI-SPEC §Copywriting non-generic Cancel rule — adapted for opt-out flow context)
    - On submit: open Modal → confirm → fetch POST `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/privacy-optout-process` with JSON body; show Loading button state via `aria-busy`
    - Success state: replace form with `&lt;Badge tone="success"&gt;Submitted&lt;/Badge&gt;` + exact text from UI-SPEC §2 success-state
    - Error state: red text + exact text from UI-SPEC §2 error-state

    **AccessibilityPage.tsx** (`/legal/accessibility` per UI-SPEC §4):
    - `&lt;LegalLayout title="Accessibility Statement"&gt;`
    - Helmet meta: `&lt;title&gt;Accessibility Statement · LeanShot&lt;/title&gt;`
    - Body sections (text-[13px], heading per section text-[18px] font-semibold):
      1. **Our commitment** — WCAG 2.2 AA target conformance statement
      2. **ADA Title III posture** — public-accommodation framing
      3. **Conformance status** — list of audited features (keyboard nav, screen-reader labels, color contrast, reduced motion — pull from PROJECT.md's accessibility-conventions list)
      4. **Known limitations** — note that chart.js dashboards may have lower SR-affinity; alternatives documented (data export, doctor report)
      5. **Remediation timeline** — 30-day SLA per UI-SPEC §4
      6. **Contact** — accessibility@leanshot.app + mailto CTA "Report an accessibility issue"
    - Inline draft disclaimer: `&lt;em&gt;This accessibility statement is in draft pending legal counsel review (Phase 70 UAT).&lt;/em&gt;`

    **DMCAPage.tsx** (`/legal/dmca` per UI-SPEC §5):
    - `&lt;LegalLayout title="DMCA Notice &amp; Takedown"&gt;`
    - Helmet meta: `&lt;title&gt;DMCA Notice &amp; Takedown · LeanShot&lt;/title&gt;`
    - Body sections:
      1. **Designated DMCA Agent** — `&lt;em&gt;Agent registration with U.S. Copyright Office pending — operator action at Phase 70 UAT. Until then, send notices to abuse@leanshot.app.&lt;/em&gt;` + placeholder address block
      2. **How to submit a takedown notice** — numbered list per 17 U.S.C. § 512(c)(3) checklist (identification of copyrighted work, identification of infringing material + URL, contact info, good-faith statement, accuracy statement under penalty of perjury, physical or electronic signature)
      3. **Counter-notice procedure** — 17 U.S.C. § 512(g) checklist
      4. **Safe-harbor disclaimer** — DMCA § 512 safe-harbor language; reservation of right to terminate repeat-infringer accounts (per § 512(i))
      5. **Cross-reference** — link to `#/legal/terms#community-ugc` (Plan 64-04 ToS UGC section)
      6. **CTA** — mailto link `mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice` labeled "Submit DMCA notice"

    All three pages MUST:
    - Use ONLY text sizes 11/13/18/text-heading + weights 400/600
    - Use ONLY @theme-defined color tokens (no `text-text-primary` / `bg-warning-subtle` / etc. per Phase 60 BLOCKER)
    - Use `var(--color-*)` bracket syntax for colors
    - Use `font-display` only for page H1 (delegated to LegalLayout via Task 1)
    - Include the draft disclaimer (Phase 70 counsel review)

    Tests:
    - DoNotSellPage test mocks `fetch` and asserts the 6 behavior cases
    - AccessibilityPage test asserts 3 behavior cases via text matchers
    - DMCAPage test asserts 4 behavior cases via text matchers
    - Tests use `@testing-library/react` + `vitest` + `react-helmet-async` HelmetProvider wrapper
    - Tests in __tests__ dir scope only to these new files; do NOT modify project-wide vitest config per [[feedback_vitest_project_include_too_broad]]
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      test -f src/components/legal/DoNotSellPage.tsx &amp;&amp;
      test -f src/components/legal/AccessibilityPage.tsx &amp;&amp;
      test -f src/components/legal/DMCAPage.tsx &amp;&amp;
      grep -q 'Submit opt-out request' src/components/legal/DoNotSellPage.tsx &amp;&amp;
      grep -q 'privacy-optout-process' src/components/legal/DoNotSellPage.tsx &amp;&amp;
      grep -q 'WCAG 2.2 AA' src/components/legal/AccessibilityPage.tsx &amp;&amp;
      grep -q 'accessibility@leanshot.app' src/components/legal/AccessibilityPage.tsx &amp;&amp;
      grep -q 'abuse@leanshot.app' src/components/legal/DMCAPage.tsx &amp;&amp;
      grep -q 'Submit DMCA notice' src/components/legal/DMCAPage.tsx &amp;&amp;
      ! grep -E "text-text-primary|bg-surface-card|border-border-subtle|bg-warning-subtle|text-accent" src/components/legal/{DoNotSellPage,AccessibilityPage,DMCAPage}.tsx &amp;&amp;
      npx vitest run src/components/legal/__tests__/DoNotSellPage.test.tsx src/components/legal/__tests__/AccessibilityPage.test.tsx src/components/legal/__tests__/DMCAPage.test.tsx --reporter=basic --run --config vite.config.ts &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    Three new legal page components render via LegalLayout, all vitest passes, tsc passes, no undefined Tailwind tokens, CTA copy matches UI-SPEC verbatim.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → /functions/v1/privacy-optout-process | unauthenticated form POST with PII (Plan 64-02 owns the Fn-side guards) |
| browser → mailto: links | client-side handoff; mail client opens — no transport risk |
| browser → LegalLayout render | static React, no input |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-05-01 | Tampering | malicious form payload tampers with privacy_optout_requests | mitigate | Plan 64-02 Fn validates server-side; this plan's client validation is UX-only (not security boundary) |
| T-64-05-02 | Information Disclosure | XSS via mailto query string | accept | mailto query strings auto-encoded by URL APIs; no untrusted user input flows through |
| T-64-05-03 | Repudiation | submission lost without confirmation | mitigate | Pre-submit Modal + success-state inline copy + Plan 64-02 confirmation email Round-trip |
| T-64-05-04 | Information Disclosure | undefined Tailwind v4 token renders DoNotSell form INVISIBLE — silent CCPA non-compliance | mitigate | grep gate against Phase 60 BLOCKER list (text-text-primary, bg-surface-card, etc.) in verify automated |
| T-64-05-05 | Tampering | counsel reads draft as final | mitigate | Inline `&lt;em&gt;draft pending legal counsel review&lt;/em&gt;` disclaimer per page |
| T-64-05-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed |
</threat_model>

<verification>
- 7 new files (3 pages + 3 tests + LegalLayout edit) committed
- vitest passes for all 3 new page tests
- tsc passes
- Phase 60 BLOCKER token grep gate passes
- CTA copy strings exact match UI-SPEC §Copywriting
- Routes are NOT added to App.tsx in this plan — Plan 64-07 owns App.tsx and adds the 3 hash-route mappings (`#/privacy/do-not-sell`, `#/legal/accessibility`, `#/legal/dmca`)
</verification>

<success_criteria>
- LegalLayout now renders title prop as font-display H1
- DoNotSellPage form posts to Plan 64-02 Fn endpoint with confirmation Modal + verb+noun CTA
- AccessibilityPage covers WCAG 2.2 AA + ADA Title III + 30-day SLA + accessibility@leanshot.app
- DMCAPage covers § 512 takedown + counter-notice + safe-harbor + abuse@leanshot.app + agent-pending disclaimer
- All copy includes draft disclaimer pending Phase 70 counsel review
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-05-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
