# LeanShot — Best-in-Class Readiness Report

> Produced 2026-06-01 by a 9-dimension multi-agent audit (accessibility, performance, security, reliability, testing/CI, ux-product, observability, seo-discoverability, architecture). 10 agents, ~1.3M tokens. Findings verified against the live codebase.

## 1. Executive summary

LeanShot has a foundation well above the typical v1: a typed offline-first store with durable queueing, a 633-file test suite with hard-won flake mitigations and a CI axe gate, strong CSP and auth hardening (BYO-key risk is gone), thoughtful PHI-scrubbing telemetry, and genuinely good per-route SEO craftsmanship. The gap to "best-in-class" is concentrated in a small number of **high-blast-radius primitives and structural blind spots**, not in widespread sloppiness. Five themes dominate: **(1) Resilience** — there is no React error boundary anywhere, and lazy-chunk/PWA-update failures have no recovery path, so a single render throw or a stale post-deploy chunk white-screens the whole app (flagged by 4 of 9 dimensions). **(2) Shared-primitive accessibility debt** — the base `Modal`/`Sheet` (81 sites) have no focus trap, framer-motion ignores reduced-motion, and status colors fail WCAG AA as text with the contrast rule disabled in CI. **(3) The headline feature is under-instrumented and under-tested** — the GLP-1 projection curve and site-rotation logic have near-zero behavioral tests, no E2E smoke, and zero analytics, while the rotation UI is passive and the curve hero is paywalled/empty-state-broken on first run. **(4) Production observability is silently broken** — web Sentry uploads source maps under a release the runtime never sets (no symbolication), consent is decoupled from PostHog capture, and the AI coach has no telemetry. **(5) Discoverability has a structural ceiling** — all indexable content is 100% client-rendered with no prerendering, so crawlers see only boilerplate. Several task premises are stale and corrected in §5 (lint is green, `events` chunk is fine, water-grid and `--color-text-tertiary` are already fixed).

## 2. Quick wins (low-effort, high-value, safe now)

| Title | Dimension | File | Why it matters |
|---|---|---|---|
| Wrap app tree in `<MotionConfig reducedMotion="user">` | accessibility | `src/App.tsx` | One line fixes reduced-motion for every Modal/Sheet/Toast/AI overlay (CSS media query can't govern framer WAAPI) |
| Set `release` on web Sentry init | observability | `src/lib/telemetry-defer.ts:79-85` | Without it, the entire web source-map upload pipeline produces minified, unusable prod stack traces |
| Add `vite:preloadError` → guarded `location.reload()` | reliability | `src/main.tsx` | Self-heals the classic stale-chunk-404-after-deploy hard fail; pairs with the boundary work |
| Make "New version available" toast actionable (`updateSW(true)`) | reliability | `src/App.tsx:1597`, `src/lib/pwa/register.ts` | Toast claims "tap to reload" but does nothing; capture the discarded `updateSW` return value |
| Fix offline banner copy + delete dead `disableLogging()` | reliability | `src/components/pwa/OfflineBanner.tsx`, `src/lib/pwa/offline-store.ts` | Banner falsely implies logging is paused; gate is dead code — truthful copy is the best-in-class choice |
| Remove dangling `·` separator in greeting | ux-product | `src/components/layout/GreetingStrip.tsx:51-56` | Visible code artifact ("Alex ·") on the landing strip; one-line fix |
| Add skip-to-content link + `<main id="main" tabIndex={-1}>` | accessibility | `src/components/layout/AppShell.tsx:55` | WCAG 2.4.1; `sr-only focus:not-sr-only` utility already used in ~30 places |
| `aria-describedby` linking error/hint to field | accessibility | `src/components/ui/Input.tsx:70-79` | SR users hear "invalid" but never the reason; one fix in FieldShell + 3 controls covers every form |
| `role="log"` + `aria-live="polite"` on AI message list | accessibility | `src/components/dashboard/ai/AIChatPanel.tsx:~237` | Streaming coach replies are silent to SR users — core feature unusable non-visually |
| Bump `admin-shell` ceiling 137→138, drop stale `cancellation`/`WhatsNewDrawer` entries | testing-ci | `scripts/assert-bundle-budget.sh` | E2E merge gate is red on a +0.05kB rounding overage; stale chunk names mask real regressions |
| Reflected-XSS/open-redirect: `esc()` the `?v=` param + `url.href` | security | `api/share/level/[token].tsx:44-72` | Publicly-shared SSR page interpolates attacker-controlled input unescaped into HTML attributes |
| Dynamic-import `endImpersonation` (or lazy ImpersonationBanner) | performance | `src/components/impersonation/useImpersonation.ts:21` | One staff-only static import drags the whole admin graph (~719kB eager) onto every patient's first paint |
| Register only used Chart.js components (drop `registerables`) | performance | `src/components/dashboard/charts/BaseChart.tsx:6,12` | App draws only line/area; cuts ~30-50% off the 69kB charts chunk |
| Extract + unit-test `computeSiteStatus`/`pickNextSite` | testing-ci | `src/components/dashboard/cards/SiteRotationCard.tsx:15-32` | Half the headline feature; currently inline with zero tests |

## 3. Prioritized backlog (deduped across dimensions)

### Critical

- **No React error boundary anywhere — one render throw white-screens the app.** Flagged by reliability, ux-product, observability, and architecture (confirmed: zero `getDerivedStateFromError`/`componentDidCatch`/`ErrorBoundary` in `src/`). `src/App.tsx`, `src/main.tsx`. Add a `Sentry.ErrorBoundary` (or class boundary → `captureException`) at the App root wrapping `<AppShell>`/`<TabSwitcher>`, plus per-tab boundaries inside Suspense keyed on `currentTab` so one broken tab degrades to a recoverable "your data is safe — reload this section" card. Single highest-leverage fix; also guarantees capture of render errors (which don't reliably reach `window.onerror`) and underpins the chunk-404 recovery. **Effort: M.**
- **Base `Modal`/`Sheet` have no focus trap or focus restoration (81 call sites).** `src/components/ui/Modal.tsx:56-67`, `src/components/ui/Sheet.tsx:22-33`. Add focus management once (store `activeElement`, move focus in, trap Tab/Shift+Tab, restore on close — reuse `CitationPopover.tsx`'s pattern; extract `useFocusTrap`). Fold in: render `<h2>` with `useId` + `aria-labelledby` so ReactNode titles don't fall back to "Dialog". **Effort: M.**
- **Entry chunk eager-preloads ~719kB gz across 26 chunks on first paint.** `src/components/impersonation/useImpersonation.ts:21`, `vite.config.ts:241`, `src/App.tsx:7`. The value-import of `endImpersonation` routes the whole admin graph into the eager preload set. Dynamic-import it / lazy the banner. Likely cuts cold-load JS ~70%. **Effort: S** (fix); **M** (CI guard).
- **Indexable content (knowledge hub, research, audience pages) is 100% client-rendered — invisible to non-JS crawlers and social/LLM scrapers.** `index.html` + `src/App.tsx:768-799` + `vercel.json:26`. Prerender the public no-auth routes at build time (over `scripts/build-sitemap.ts`'s slug list) or via the apex `page-render` Edge Function. **Effort: L.**
- **Web Sentry runtime init has no `release` — uploaded source maps never symbolicate prod errors.** `src/lib/telemetry-defer.ts:79-85` vs `vite.config.ts:122-128`. Pass `release: import.meta.env.VITE_SENTRY_RELEASE` matching the commit-SHA the Vite plugin uploads; wire `VITE_SENTRY_RELEASE=$VERCEL_GIT_COMMIT_SHA`. **Effort: S.**

### High
- Stale lazy-chunk 404 after deploy has no recovery (`vite:preloadError` listener). **S.**
- framer-motion overlays ignore `prefers-reduced-motion` — `<MotionConfig reducedMotion="user">` at root. **S.**
- Status/accent tokens fail WCAG AA as text (warning 2.57:1, success 2.32:1, amber 1.97:1, sky 2.27:1) AND contrast is unguarded in CI (`tests/a11y/axe-baseline.test.ts:152` disables color-contrast). Darken + add a Playwright `@axe-core/playwright` contrast scan. **M.**
- axe CI baseline permanently grandfathers 2-3 serious/critical violations per route — find the shared-chrome root cause, fix, re-baseline to ~0. **M.**
- Changelog "What's New" drawer uses permissive denylist + `rehype-raw`, rendered to ALL users — switch to `rag/sanitize.ts`'s tight allowlist + sanitize after render. **M.**
- Offline UX self-contradictory + `disableLogging` is dead code — truthful copy + delete gate. **S.**
- Permanent (4xx) cloud-sync failures silently drop the queued op (`src/lib/sync.ts`) — `captureException` + one-time toast. **M.**
- Headline GLP curve has zero behavioral coverage + rotation algorithm inline/untested + no E2E smoke — extract pure `buildMedLevelSeries`/`computeSiteStatus`/`pickNextSite` + unit-test + 1 non-gated Playwright smoke. **M.**
- GDPR consent banner decoupled from PostHog capture — subscribe to `CONSENT_CHANGE_EVENT`, toggle opt-in/out. **M.**
- AI coach (named differentiator) has zero observability — add `ai_message_sent`/`ai_response_received`/`ai_error` + tagged captureException. **M.**
- Reflected XSS / open-redirect in public SSR share page (`api/share/level/[token].tsx`) — escape interpolated values, validate `?v=` as `^[0-9]+$`. **S.**
- Today's Focus + Smart Insights + GuidedTour emit hardcoded English — thread `TFunction`/i18n keys. **M.**
- Headline rotation passive + first-empty not LRU; curve forecast paywalled on first run + unconditional appetite warning — default log form to recommended site + badge, LRU, curve empty state. **M.**
- Bundle-budget CI gate has no eager-preload-graph guard (what let the 719kB regression pass). **M.**
- Generated Supabase types (`src/types/supabase.ts`, 946 lines) imported by zero files; cloud layer untyped (3× `as any`). Parameterize client with `Database`. **M.**

### Medium (selected)
- In-dashboard tab nav has no browser-history integration — back button exits the app. **M.**
- 3 divergent global DOMPurify hooks share one singleton, no `removeHook` — centralize. **M.**
- Empty-state gap on HomeTab/MoodTab/SupplementsTab (HomeTab = every returning user's first paint). **M.**
- `insights.ts` uses `injections[0]` for "last injection" (contradicts documented fix) — shared `getLatestInjection()`. **S.**
- No coverage thresholds despite `@vitest/coverage-v8` installed; zero committed VR baselines; 31/47 Edge-Fn Deno tests run under no CI job. **M.**
- Headline feature + conversion funnel have no analytics; 12 clinic files bypass typed `capture()` via raw `window.posthog`. **M.**
- Canonical/OG host split (`leanshot.app` vs `app.leanshot.app`); committed `sitemap.xml` stale + overwritten at build (drops legal pages); no site-wide JSON-LD. **M.**
- `selectView` is a 160-line ordered-if dispatcher mixing 4 routing models; single 2557-line Zustand store / 213 flat actions; `SettingsPage` identity-selector re-renders on any mutation. **L/S.**

### Lower-priority / polish (noted, deferred)
Charts have no data-table alternative · AI degradation collapses error types w/ no retry · GuidedTour soft-locks on missing anchor / no Escape · onboarding has no draft persistence · knowledge OG cards are SVG-as-`.png` (social validators reject) · PWA manifest lacks shortcuts/categories/id · CSP lacks `report-uri` + broad `*.supabase.co` · stale `CLAUDE.md` + untyped `VITE` env + residual unlayered `index.css` resets · `--maxWorkers=1` is a scaling cliff.

## 4. Proposed v1.5 "Best-in-Class" milestone (GSD roadmap, dependency order)

**Phase 1 — Crash Resilience & Self-Healing** *(foundational)* — global + per-tab `ErrorBoundary`; `vite:preloadError` reload; actionable PWA-update toast; honest offline banner + dead-code removal; permanent-sync-drop capture; AI-coach retry affordance.

**Phase 2 — Accessibility Hardening** *(independent, high audience impact)* — `Modal`/`Sheet` focus trap + `aria-labelledby`; `MotionConfig`; darken status tokens + Playwright contrast gate; re-baseline axe to ~0; skip link; `aria-describedby`; AI `role=log`; PillGroup ARIA.

**Phase 3 — Headline Feature End-to-End** *(depends on Phase 1)* — extract + unit-test curve & rotation pure fns; non-gated E2E smoke; rotation LRU + recommended-site default; curve empty state + first-session paywall rethink; headline analytics.

**Phase 4 — Production Observability** *(depends on Phase 1)* — Sentry `release` (symbolication); consent↔PostHog wiring; AI-coach telemetry; clinic-event consolidation; web-vitals + `setUser`; uptime/synthetic + conversion-volume alerts.

**Phase 5 — Performance & First-Paint Budget** — dynamic-import impersonation; trim Chart.js registerables; eager-preload-graph CI guard; `SettingsPage` selector fix.

**Phase 6 — Discoverability & SEO Structure** *(parallel-able)* — prerender public routes; unify canonical host; sitemap single-source + legal pages; Organization/SoftwareApplication/FAQPage JSON-LD; real PNG OG cards.

**Phase 7 — Security Hardening & Test/Architecture Debt** *(cleanup, last)* — SSR share escaping; changelog allowlist; DOMPurify centralization; CSP hostname validation; coverage thresholds; VR baselines; Deno-test CI coverage; Supabase-type parameterization; `selectView` route table; store slicing.

## 5. Coverage gaps and corrections

**Stale premises / already-handled (corrected):** "~138 frontend lint errors" → **stale** (`eslint src` = 0 errors / 70 warnings). `events` chunk "red at 114kB" → **stale** (now 17.31kB). Nutrition water-grid (B6) + `--color-text-tertiary` contrast → **already fixed** on this branch. og-image.png TODOs → **stale** (real 1200×630 PNG exists). The "Alex ·" artifact (attributed to seed data in the launch report) is actually an unconditional source-level middot.

**Dedup note:** "no error boundary" appears in 4 dimensions — it is ONE root cause (don't schedule it four times).

**Dimensions a top-tier audit should still cover (NOT in these 9):**
- **Backend / RLS / Edge-Function source** — `supabase/` is not in *this* repo (it lives at the monorepo root `/Users/karstenhaldan/minisite/supabase/`). RLS recursion (the `org_members` 42P17 class already bit prod), `verify_jwt` coverage, SECDEF/`aal2` enforcement, credentialed CORS, dual `audit_logs` schema writes — **largest blind spot.** First pass: run `get_advisors` (security lint) against project `ytnsipxxmzgaebkqmokp`.
- **Pharmacology / clinical correctness** — whether `calcMedLevel`'s half-life model + CV band are clinically defensible (domain-expert review of the math, not just tests).
- **Data privacy / retention / DSAR** — actual deletion/export pipelines + retention windows + PHI event-zone runtime enforcement.
- **Payments / subscription integrity** — Stripe↔RevenueCat unified-entitlement, double-charge, webhook idempotency.
- **i18n completeness** — systematic missing-key sweep across the ES layer.
- **Dependency / supply-chain** — `npm audit`, license compliance, committed-secret scanning.

**Single most consequential follow-up:** get the `supabase/` backend into a reviewable state — roughly a third of the security + observability surface (RLS, Edge Functions, conversion-event emission) currently has no automated or manual verification.

## 6. Backend advisor snapshot (2026-06-01, project `ytnsipxxmzgaebkqmokp`)

Ran `get_advisors` to partially close the §5 backend blind spot. **No ERROR-level findings** (security or performance) — the prod DB has no critical advisories. But high WARN volume:

**Security — 728 findings (0 ERROR · 719 WARN · 9 INFO):**
- **499** SECURITY DEFINER functions executable by authenticated (259) / anon (240) — largely **by-design** (the SECDEF RPC pattern with internal `is_staff()`/authz checks). Worth a spot-audit that each enforces internal authz.
- **195** anonymous-access RLS policies — **by-design** (anon sign-ins enabled for local-first onboarding); confirm none over-expose.
- 14 materialized views in API · 4 public buckets allow listing · 3 extensions in public · **2 RLS policies always-true (investigate — potential over-permissive)** · **1 leaked-password protection DISABLED (1-click dashboard enable)** · 1 insufficient MFA options (ties to the MFA TOTP launch item) · 9 INFO RLS-enabled-no-policy.

**Performance — 646 findings (0 ERROR · 414 WARN · 232 INFO):**
- **279 `auth_rls_initplan`** — RLS policies call `auth.uid()` per-row instead of `(select auth.uid())`; wrapping in a scalar subquery evaluates once → large query-time win across the busiest tables. Mechanical, high-ROI.
- **135** multiple-permissive-policies — consolidate overlapping policies (per-row overhead).
- 126 unused indexes (drop candidates) · **106 unindexed foreign keys** (slow joins/cascades — e.g. the test-account purge cascade).

**Disposition:** (operator, 1-click) enable leaked-password protection + confirm MFA options. (DB phase) the 279 `auth_rls_initplan` rewrites + 106 FK indexes are the highest-ROI backend perf work → a dedicated v1.5 "DB Performance" phase (migration-heavy, careful testing — NOT an auto-apply). (Review) the 2 always-true RLS policies + 4 listable public buckets for data exposure.

