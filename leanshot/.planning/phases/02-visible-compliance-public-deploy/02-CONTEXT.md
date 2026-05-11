# Phase 2: Visible Compliance & Public Deploy - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 ships LeanShot's first publicly reachable build: a Vercel-hosted SPA deploy plus a separate Vercel-hosted marketing landing — two distinct preview-URL origins so the strict-CSP-on-SPA isolation works as designed. Before any tab is interactive, a blocking medical-disclaimer modal acknowledges "Not medical advice" and persists as a versioned Zustand flag; the drug-level chart carries an "Estimate — not medical advice" diagonal watermark rendered into the canvas so it survives any screenshot; a CI grep test enforces the CMIA AB 2089 mental-health-framing denylist on every PR; the production build pushes source maps to Sentry as part of the Vercel build; and the SPA hits Lighthouse Performance ≥ 90 via a targeted bundle-split pass.

**In scope:**
- Two Vercel projects deploying from the existing single repo: one for the SPA (current `leanshot/` build), one for the marketing landing
- Three Vercel environments per project: Production, Preview, Development — with `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_ANALYTICS_ENABLED` split per env (real keys in Production only; Preview gets a separate Sentry project or empty config)
- HTTPS deploy on `*.vercel.app` preview URLs (Vercel-provisioned cert) — custom domain wiring deferred
- Strict security headers on the SPA origin via `vercel.json`: `script-src 'self'`; `connect-src` allowlist for Sentry ingest + PostHog ingest + `https://api.anthropic.com`; `style-src 'self' 'unsafe-inline'` (Tailwind requires inline); `img-src 'self' data:` (user base64 photos); `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`; plus HSTS, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy `strict-origin-when-cross-origin`
- Blocking medical-disclaimer modal inserted as Step 0 of OnboardingFlow (TOTAL_STEPS becomes 8); single "I understand" button, no decline path; persistence via `acknowledgedDisclaimer: 'v1'` versioned string in Zustand store (boolean → versioned migration in `migrateFromV3`/storage layer)
- Re-acknowledgment fallback: dashboard renders the same disclaimer modal blocking interaction whenever `acknowledgedDisclaimer !== 'v1'` — so any v4-migrated user without the flag sees it on next load, and future copy bumps to `'v2'` re-prompt everyone
- Diagonal-watermark canvas overlay on `MedLevelChart` (not other charts) — "Estimate — not medical advice", ~45°, light-gray, ~12% opacity, sized to repeat once or twice across the chart area; implemented as a Chart.js plugin using the `afterDraw` hook so it's part of the canvas itself
- CMIA AB 2089 copy-grep CI job: case-insensitive word-boundary regex against `src/**/*.{tsx,ts}` (excluding test files) for the 4 SC#5 terms — `depression`, `anxiety`, `therapy`, `mental health treatment`
- Sentry source-map upload integrated into Vercel build command (`sentry-cli sourcemaps inject` + `upload` — blocking; build fails if upload fails); release tag = git commit SHA
- Lighthouse 90+ performance pass on the SPA: `rollup-plugin-visualizer` analysis pass + explicit `manualChunks` carving out `chart.js`, `framer-motion`, `lucide-react` into separate chunks; audit existing `React.lazy` usage in `App.tsx` to confirm all non-Home tabs and modals are still lazy after the perf pass

**Out of scope (deferred to later phases):**
- Custom domain registration + DNS wiring (deferred; PROD-01 partially satisfied via Vercel preview URL)
- Library swaps to push Lighthouse past 95 (e.g., `lucide-react` → `@tabler/icons`, dynamic-imported framer-motion)
- CSP report-only endpoint + violation reporting collector (no ingest target exists until Phase 4's Supabase Edge Functions or a Sentry CSP integration)
- CHDP policy publishing, FTC HBNR registration, BAA template — Phase 7 (legal-counsel-led)
- WMHMDA-compliant consumer health data privacy notice content — Phase 7
- Country/jurisdiction-specific disclaimer copy variants (WA WMHMDA notice, CA CMIA notice) — Phase 7
- Auth, cloud sync, Supabase Edge Functions, monorepo refactor (Phases 4–6)
- DoctorReport PDF disclaimer baking — Phase 3 (alongside the pharmacology hardening)
- Phase 3's longer pharmacology disclaimer ("based on population pharmacokinetics, individual variation 30-40%") — Phase 3 layers it into the chart card subtitle, not the watermark
- Marketing copy CHDP/privacy text — Phase 7 with counsel

</domain>

<decisions>
## Implementation Decisions

### Hosting

- **D-01: Host on Vercel.** Native Vite build detection, per-PR preview URLs, Sentry/PostHog Marketplace integrations available, future Supabase Marketplace pairing in Phase 4. Trade explicitly accepted: pricing scales aggressively past Pro tier; bandwidth is the cost driver. Hobby tier sufficient for v1.
- **D-02: Defer custom domain.** Phase 2 ships on `*.vercel.app` preview URLs only. PROD-01 partially satisfied via Vercel's auto-provisioned HTTPS certs. SC#1 "Lighthouse 90+ at the production custom domain" becomes "Lighthouse 90+ at the Vercel deploy URL" — same engineering bar. Custom domain wiring sits in a future phase or is deferred until the founder is ready to commit to a public name.
- **D-03: Vercel auto-deploys on push; GitHub Actions is advisory.** Vercel's git integration handles preview + prod deploys directly. GH Actions still gates PR merge on the 5-job pipeline (lint/format-check/typecheck/test-unit/test-e2e). When GH fails, the merge is blocked but the Vercel preview stays up — accepts the trade in exchange for simplicity and faster preview turnaround.
- **D-04: Two Vercel projects, one git repo.** Both projects point to the same `leanshot/` repo root. The SPA project uses the existing `npm run build` (output dir `dist/`). The marketing project adds a second build command (`build:marketing`) + a dedicated Vite config (`vite.marketing.config.ts`) that emits only the marketing entry, output to `dist-marketing/`. No monorepo refactor — that's deferred. The planner picks the exact entry-point mechanism (separate `marketing.html` entry vs Vite multi-page input vs filter), as long as the two projects can deploy independently from the same repo.

### Security Headers & CSP

- **D-05: Strict baseline security-header set on SPA origin.** Configured in `vercel.json` for the SPA project only:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self' <sentry-ingest-host> <posthog-ingest-host> https://api.anthropic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()` (deny defaults; tighten in Phase 7 review)
- **D-06: Marketing origin gets minimal headers.** Marketing is the "open" surface where future tracking pixels and analytics may need flexibility. Ship with HSTS + X-Content-Type-Options + Referrer-Policy on marketing; do NOT apply the strict CSP. The whole point of the origin split is that marketing scripts can never touch the authenticated SPA.
- **D-07: `'unsafe-inline'` on `style-src` is a known concession.** Tailwind v4 beta injects inline styles. Removing this is a Phase 7 hardening item — Tailwind v4 supports `nonce`/`hash` strategies but adopting them now is outside the phase scope and would require a Vite plugin change. Documented and accepted.

### Disclaimer Modal

- **D-08: Modal renders as Step 0 of OnboardingFlow.** `TOTAL_STEPS: 7 → 8`. Step 0 is a full-screen blocking acknowledgment with a single primary action "I understand" and no decline button. The current Phase 1 RTL test (`OnboardingFlow.test.tsx`) and Playwright e2e (`e2e/onboarding.spec.ts`) both assert 7-step navigation — both must be updated to assert 8-step navigation as part of the same plan that adds Step 0.
- **D-09: Single "I understand" button — no decline path.** No "Cancel" button, no "Disagree" link. Users either acknowledge or close the tab/browser-back out of the SPA. Strongest legal posture; no halfway state to debug. Trade: feels slightly coercive; user knows this is the legal floor not the UX target.
- **D-10: Versioned persistence — `acknowledgedDisclaimer: 'v1'` string.** Stored in Zustand persist as a string, not a boolean. Future copy changes bump the value (`'v2'`, `'v3'`); a render-time check `if (acknowledgedDisclaimer !== CURRENT_DISCLAIMER_VERSION) <Modal />` re-prompts every user when the floor moves. The persisted shape becomes `acknowledgedDisclaimer: 'v1' | undefined`; `migrateFromV3`/v4 migration must default it to `undefined` (not `false`, not `true`) so the dashboard-blocking fallback fires for any pre-Phase-2 user.
- **D-11: Dashboard-render fallback for returning users.** Even when OnboardingFlow is skipped (returning user with a `user` object in store), the dashboard checks `acknowledgedDisclaimer === CURRENT_DISCLAIMER_VERSION` on first render. If false, render the same blocking modal over the dashboard before any tab is interactive — matches SC#2's "before any tab is interactive" literal wording.
- **D-12: Modal copy in v1.** Body text TBD by planner but must include: (1) "Not medical advice — consult your healthcare provider", (2) brief data-storage note ("your data stays on this device unless you sync"), (3) "I understand" button. No country-specific variants in v1. Phase 7 legal review owns the final copy.

### Chart Canvas Overlay

- **D-13: Diagonal watermark across chart area.** Light-gray, ~45° angle, ~12% opacity (light theme) / ~18% opacity (dark theme — planner to verify), single repetition or short tile. Text: `Estimate — not medical advice`. Sized so it's readable in a screenshot but doesn't obscure data trends.
- **D-14: Apply only to `MedLevelChart`.** Not weight charts, not symptom charts, not sparkline cards. SC#3 names the drug-level chart specifically; broader application dilutes the signal value. Documented for re-evaluation in Phase 7 legal review.
- **D-15: Implement as a Chart.js plugin via `afterDraw`.** Plugin name e.g. `med-level-watermark`; registered at the `MedLevelChart` component level, NOT globally (so other charts that share `BaseChart` are unaffected). Uses the chart's existing 2D canvas context — no separate canvas layer, no HTML overlay. Phase 3's uncertainty band renders BEFORE the watermark in draw order (planner confirms `beforeDraw` for band, `afterDraw` for watermark).

### CI Compliance Grep

- **D-16: Exactly 4 SC#5 denylist terms.** Case-insensitive word-boundary regex matching `depression`, `anxiety`, `therapy`, `mental health treatment` across `src/**/*.{tsx,ts}`, excluding `**/*.test.{ts,tsx}` and `e2e/**`. The Mood tab keeps its name (`mood` is allowed). Phase 3+ refusal-list tests may need to reference forbidden terms in test fixtures — excluded by the path glob.
- **D-17: New CI job `compliance-copy`.** Sixth job in `.github/workflows/ci.yml`, parallel with the existing five. Single `grep -rniE` shell step + non-zero exit on match. Fast (<5s). Documented as a "production guard" not a "code-quality" gate.

### Vercel Environment Variables

- **D-18: Three Vercel environments per project: Production / Preview / Development.** Variables set per env:
  - **Production:** real `VITE_SENTRY_DSN`, real `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST=https://us.i.posthog.com`, `VITE_ANALYTICS_ENABLED=true`
  - **Preview:** separate Sentry project DSN (so PR previews don't pollute prod issue lists) OR empty; `VITE_ANALYTICS_ENABLED=false` (so PR previews don't pollute PostHog dashboards)
  - **Development:** all empty / unset — local dev defaults apply
- **D-19: Marketing project gets its own minimal env-var set.** No Sentry (marketing is a static landing — errors here are rare and observable in browser console; if needed later, add a separate Sentry project). PostHog optional: marketing may want its own funnel analytics in Phase 7 with proper CHDP. For v1: marketing ships analytics-free.

### Sentry Source-Map Upload

- **D-20: Blocking upload during Vercel Production builds.** Production build command appends `sentry-cli sourcemaps inject ./dist && sentry-cli sourcemaps upload ./dist --release $VERCEL_GIT_COMMIT_SHA`. If upload fails, deploy fails. Auth via `SENTRY_AUTH_TOKEN` env var (Vercel Production only — not Preview, to keep PR previews fast and avoid token sprawl).
- **D-21: Release tag = git commit SHA.** Sentry releases map 1:1 to Vercel deploys via `VERCEL_GIT_COMMIT_SHA`. Source-maps stripped from `dist/` after upload (`vite.config.ts` `build.sourcemap: 'hidden'` so files reference maps but no `.map` ships to clients).
- **D-22: Preview deploys skip source-map upload.** Preview Vercel env has no `SENTRY_AUTH_TOKEN`; the upload step short-circuits when the token is empty. Preview deploys still ship with `build.sourcemap: false` (no maps generated). Trade: PR-preview errors won't resolve to source lines — acceptable for short-lived branches.

### Bundle Splitting for Lighthouse 90+

- **D-23: Targeted manualChunks + lazy-load audit (Lighthouse 90 floor, not 95+ stretch).** Add `rollup-plugin-visualizer` to dev-deps; run once during planning to identify the 635 kB main chunk's biggest passengers. Then explicit `build.rollupOptions.output.manualChunks` carving out: `chart.js` (already a separate 208 kB chunk — confirm), `framer-motion`, `lucide-react`. Audit `src/App.tsx`'s existing `React.lazy` usage to confirm all non-Home tabs, modals, and the AI panel still lazy after the rollup change. Target: first-load main chunk ≤ 200 kB gzipped.
- **D-24: No library swaps in Phase 2.** `lucide-react` stays (Phase 2.1 may revisit if Lighthouse score falls short after the manualChunks pass). `framer-motion` stays. `chart.js` stays. Library replacement is a Phase 2.1 or Phase 7 polish concern.
- **D-25: Lighthouse verification via `@lhci/cli` in CI.** Sixth or seventh CI job: `lhci autorun` against the Vercel preview URL (post-deploy hook). Asserts Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90. If unavailable in time, planner falls back to manual `npm install -g @lhci/cli && lhci collect --url=$VERCEL_PREVIEW_URL` during verification.

### Claude's Discretion
- Exact placement and rotation angle of the diagonal watermark within the chart area (planner picks pixel-level details)
- Exact CSS variable names + token integration for the disclaimer modal (must match the existing modal pattern in `src/components/ui/Modal.tsx`)
- The marketing project's `vite.marketing.config.ts` entry-point mechanism (separate `marketing.html`, Vite multi-page input, or build-time filter — planner picks)
- Exact Sentry release-tag format (commit SHA vs commit SHA + branch; planner picks)
- Whether the Lighthouse CI job runs on every PR or only on production deploys (planner decides based on CI minute cost)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Compliance research (drives the medical-disclaimer + CMIA framing)
- `.planning/research/PITFALLS.md` §"Pitfall 1: Crossing the HIPAA / CMIA / WMHMDA wire" — the underlying legal argument for SC#4, SC#5, and the disclaimer scope. WMHMDA private right of action + CMIA AB 2089 mental-health-digital-service definition are the load-bearing constraints.
- `.planning/research/FEATURES.md` — features table notes "Medical disclaimer must appear before the first injection log, not buried in settings" — drives the Step-0 placement in D-08.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` §Compliance (COMPL-04, COMPL-05) and §"Production Readiness" (PROD-01, PROD-06) — phase scope anchors.
- `.planning/ROADMAP.md` "Phase 2: Visible Compliance & Public Deploy" — Goal + 5 Success Criteria are non-negotiable; this CONTEXT.md clarifies HOW to implement them, never WHAT.

### Project decisions
- `.planning/PROJECT.md` §Key Decisions — locks: backend = Supabase (only relevant from Phase 4); local-first preserved; static SPA — any host works (this phase chooses Vercel); compliance posture = pre-HIPAA; vertical-MVP phase mode.

### Phase 1 outputs (carry-forward)
- `.planning/phases/01-quality-gates-observability-foundation/01-CONTEXT.md` — D-09/D-10 Sentry redaction strategy (4 named fields scrubbed), D-13 PostHog event taxonomy, D-15 dormant-until-Phase-7 production analytics. Phase 2 flips `VITE_ANALYTICS_ENABLED=true` in Production for the first time — coordinate with PostHog setup.
- `.planning/phases/01-quality-gates-observability-foundation/01-04-SUMMARY.md` — describes the existing 7-step OnboardingFlow RTL test that Phase 2 must update to 8 steps when Step 0 is added.
- `.planning/phases/01-quality-gates-observability-foundation/01-06-SUMMARY.md` — describes the existing 5-job CI workflow that Phase 2 adds a 6th `compliance-copy` job to (and possibly a 7th Lighthouse job).
- `.planning/phases/01-quality-gates-observability-foundation/01-VERIFICATION.md` — notes that `.github/workflows/ci.yml` lives at the repo root (above `leanshot/`), with `defaults.run.working-directory: leanshot` per job. Phase 2's new CI jobs follow the same pattern.

### Codebase intelligence
- `.planning/codebase/STACK.md` — current build/runtime stack; Vite 6 + Tailwind v4 beta + React 19 SPA on `dist/`; Node 22 LTS in CI.
- `.planning/codebase/INTEGRATIONS.md` — notes "No `netlify.toml`, `vercel.json`, `wrangler.toml`" exist yet — Phase 2 creates the first `vercel.json`.
- `.planning/codebase/ARCHITECTURE.md` §"Component Responsibilities" — `Landing.tsx` is the marketing target; `MedLevelChart.tsx` is the disclaimer-watermark target; `OnboardingFlow.tsx` is the Step-0 insertion point; `App.tsx` is the dashboard-render fallback insertion point for the re-acknowledgment check.

### External (read on-demand during planning)
- Vercel docs: project linking, environment variables, `vercel.json` headers/redirects, source-map upload integration — fetched via `mcp__context7__resolve-library-id` + `query-docs` when the planner sketches the build commands.
- Sentry docs: `@sentry/vite-plugin` and `sentry-cli sourcemaps` workflow; release tagging with `VERCEL_GIT_COMMIT_SHA`.
- Chart.js plugin docs: `Chart.register` lifecycle + `afterDraw` hook + canvas context APIs.
- PostHog docs: cookieless mode flags, autocapture disable, env-var-gated init.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/Modal.tsx` — existing modal primitive with `role="dialog"`, `aria-modal="true"`, framer-motion entry. Reuse as the base for the Step-0 disclaimer modal and the dashboard-render fallback. Compose, don't reinvent.
- `src/components/onboarding/OnboardingFlow.tsx` — the insertion point for Step 0. Currently `useState(1)` initial step; `TOTAL_STEPS = 7` constant; `setStep` clamps to TOTAL_STEPS. Phase 2 updates TOTAL_STEPS = 8 (or shifts to 0-indexed) and renders the disclaimer at step === 0.
- `src/components/onboarding/ProgressIndicator.tsx` — renders the step dots. Must handle the new step count.
- `src/components/dashboard/charts/MedLevelChart.tsx` — target for the canvas watermark plugin. Currently uses `BaseChart`; the plugin must scope to MedLevelChart only.
- `src/components/dashboard/charts/BaseChart.tsx` — the Chart.js wrapper. Already has documented `eslint-disable` from Phase 1. New plugins register on a per-chart basis, NOT globally on BaseChart.
- `src/lib/store.ts` + `src/lib/storage.ts` — Zustand persist with v3→v4 migration. Phase 2 adds `acknowledgedDisclaimer: 'v1' | undefined` to the persisted state shape; migration must default undefined for legacy users so the dashboard fallback fires.
- `src/lib/analytics.ts` — `track()` helper + EventName union. Phase 2 may add `disclaimer_acknowledged` and `disclaimer_required` events; planner decides whether to wire them now or defer.
- `vite.config.ts` — already wired for Vitest test config (Phase 1's 01-04). Phase 2 adds `build.rollupOptions.output.manualChunks` + `build.sourcemap: 'hidden'`. The new `vite.marketing.config.ts` exists as a sibling.

### Established Patterns
- **Lazy loading via `React.lazy` + Suspense** — `src/App.tsx` already lazy-loads tabs/modals. Phase 2's bundle audit confirms this and may extend it.
- **Local-first Zustand persistence** — `acknowledgedDisclaimer` follows the same pattern; included in `partialize` so it persists.
- **`import.meta.env.DEV` for dev-only UI** — the Dev Tools section in `SettingsPage.tsx` shows the pattern. Phase 2's marketing-vs-app split doesn't need dev gates, but env-var reads (`import.meta.env.VITE_*`) follow the same idiom.
- **Strict TS + path alias `@/*`** — all new files (Vercel config glue, plugin, modal subcomponent) follow `@/...` imports.
- **Co-located test files** — `Foo.tsx` next to `Foo.test.tsx`. The disclaimer modal component gets a `.test.tsx`.
- **`role="dialog"` + `aria-modal="true"`** on every modal — keyboard focus trap + ESC-to-dismiss are part of the Modal primitive; the disclaimer modal disables ESC (no escape path per D-09).

### Integration Points
- **`vercel.json` at repo root** (new file): Vercel reads it for both projects since they share the same root; headers + redirects + framework preset go here. Headers may need conditional logic per project name (Vercel supports per-project headers).
- **`src/App.tsx` view-selection logic** (`useStore((s) => s.user)` decides marketing vs onboarding vs dashboard): Phase 2 adds a fourth branch — `if (user && acknowledgedDisclaimer !== 'v1') <DisclaimerModal blocking />` — rendered before the dashboard's lazy chunks load.
- **`.github/workflows/ci.yml`** (at repo root, working-directory=leanshot per job): Phase 2 adds the `compliance-copy` job and (if scope allows) a Lighthouse CI job.

</code_context>

<specifics>
## Specific Ideas

- **"Two Vercel projects, two preview URLs"** — user explicitly chose this over path-based to preserve future origin isolation. Both projects deploy from the same repo with different build commands.
- **"Estimate — not medical advice"** — verbatim watermark text. SC#3 wording. Do not paraphrase. Phase 3 can add adjacent context but the watermark string is fixed.
- **"Single 'I understand' button — no refuse path"** — explicit choice. No "Decline" or "Cancel" button on the disclaimer modal.
- **"First step of onboarding (Step 0)"** — explicit placement choice. TOTAL_STEPS changes from 7 to 8 and both Phase-1 tests (RTL + Playwright) need updating in the same plan that inserts Step 0.
- **"Diagonal watermark, MedLevelChart only"** — explicit scope choice. Other charts are unaffected in v1.
- **"Strict baseline + full security headers"** — user picked Recommended; security headers are non-negotiable for v1.

</specifics>

<deferred>
## Deferred Ideas

- **Marketing → SPA handoff UX details** — anchor vs JS-triggered redirect on the "Start" button. Recommendation: plain `<a href="https://leanshot-app.vercel.app/">Start</a>`. Planner picks.
- **Library swaps for Lighthouse 95+** — `lucide-react` → `@tabler/icons`, dynamic-imported framer-motion, deferred chart.js load. Phase 2.1 or Phase 7 polish.
- **CSP report-only endpoint** — useful for tightening CSP without breaking users, but needs an ingest target (Sentry CSP integration or Supabase Edge Function). Revisit in Phase 4 or 7.
- **Country/jurisdiction disclaimer variants** — WA WMHMDA + CA CMIA-specific notices. Phase 7 with legal counsel.
- **DoctorReport PDF disclaimer** — Phase 3's pharmacology hardening owns this.
- **Permissions-Policy hardening** — Phase 2 ships deny-defaults; Phase 7 tightens.
- **Monorepo refactor (Turborepo / pnpm workspaces)** — `apps/marketing` + `apps/app` + `packages/ui`. Justified later when there's actual cross-app code sharing; today the two builds are independent enough to ship without it.
- **Cross-device sync of `acknowledgedDisclaimer`** — falls out naturally when Phase 5 ships cloud sync; until then, per-device localStorage is fine.
- **Re-acknowledgment cadence (annual? per-major-version-only?)** — versioned flag (D-10) allows policy flexibility later. Phase 7 legal sets the cadence.
- **CHDP policy + FTC HBNR registration + BAA template** — Phase 7 (legal-counsel-led).
- **Marketing analytics + tracking pixels** — Phase 7 with proper CHDP coverage; v1 marketing ships analytics-free.

</deferred>

---

*Phase: 2-Visible-Compliance-Public-Deploy*
*Context gathered: 2026-05-11*
