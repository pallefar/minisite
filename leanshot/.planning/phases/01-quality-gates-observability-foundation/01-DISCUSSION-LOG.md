# Phase 1: Quality Gates & Observability Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 1-quality-gates-observability-foundation
**Areas discussed:** Lint debt cleanup scope, Test scope beyond hello, Sentry redaction strategy, Analytics consent posture

---

## Lint Debt Cleanup Scope

### Q1: ESLint will flag the existing v2 codebase. What's your stance on Phase 1 scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Clean-house-now | Phase 1 also fixes 5× `as never` casts, 3× native `alert()`/`confirm()`, BaseChart's orphan eslint-disable, and the YOURTAG-20 affiliate placeholder. Lint rules go in at error-level. ~8 file edits. | ✓ |
| Ratchet-later | Rules at warn-level; cleanup PRs land separately as later phases touch each file. | |
| Hybrid — cleanup batch as final task | Wire infra first; cleanup commit at the end of the phase plan. | |

**User's choice:** Clean-house-now
**Notes:** Phase 1 enters Phase 2 with zero lint debt. Trade accepted: ~8 extra file edits inside this phase.

### Q2: How strict should the ESLint ruleset be on day one?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal recommended set | ESLint recommended + `@typescript-eslint` + react-hooks. | |
| Standard React 19 + TS strict | Above + react + react-refresh + import order. | |
| Full health-app ruleset | Above + `eslint-plugin-jsx-a11y` (alt text, ARIA, keyboard handlers). | ✓ |

**User's choice:** Full health-app ruleset
**Notes:** `jsx-a11y` is locked in because PROJECT.md constraints require keyboard nav, screen-reader labels, color contrast, and reduced-motion behavior end-to-end.

### Q3: Pre-commit hooks or CI-only?

| Option | Description | Selected |
|--------|-------------|----------|
| CI-only | GitHub Actions runs lint+format+typecheck+tests. No Husky. Friction-free local commits. | ✓ |
| Husky + lint-staged | Pre-commit runs ESLint + Prettier on staged files. Pre-push runs typecheck. | |
| Local script, no automatic hook | Add `npm run check`; document as habit. | |

**User's choice:** CI-only
**Notes:** Captured as deferred idea — revisit if broken-CI cycles become frequent.

### Q4: Fix the bogus `claude-sonnet-4-6` model ID in Phase 1, or defer to Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Fix in Phase 1 | Patch `DEFAULT_MODEL` to `claude-sonnet-4-5`. One-line change. | ✓ |
| Defer to Phase 4 | Leave broken; AI calls 404 until Phase 4 rewrites the file. | |
| Fix + add Settings model override | Patch + UI for user to override. Bigger change. | |

**User's choice:** Fix in Phase 1
**Notes:** AI coach actually works for the 3 phases until Phase 4 rips out direct browser calls. Aligns with clean-house-now.

---

## Test Scope Beyond Hello

### Q1: Beyond a smoke test, which existing-code targets should land tests this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Smoke-only | 1× trivial Vitest + 1× Playwright. Defer all real tests to owning phase. | |
| Smoke + foundational pure functions | Adds `helpers.ts`, `useStreaks.calc`, `migrateFromV3`. | |
| Smoke + foundational + onboarding integration | Above + RTL `OnboardingFlow` happy path. | ✓ |
| Smoke + onboarding only | Just smoke + RTL onboarding; skip helpers/streaks/migration. | |

**User's choice:** Smoke + foundational + onboarding integration
**Notes:** Phase 3 still owns pharmacology + insights with cited test corpus. Phase 1 covers the load-bearing pure code that no other phase claims.

### Q2: What does the Playwright smoke test do?

| Option | Description | Selected |
|--------|-------------|----------|
| Boot + render check | `goto('/')` + assert title/hero. ~10s, lowest flakiness. | |
| Marketing → onboarding entry | Click "Get started", assert step 1 of onboarding. ~15s. | |
| Full onboarding happy path | All 7 onboarding steps → land on dashboard → assert HomeTab. ~45–60s. | ✓ |

**User's choice:** Full onboarding happy path
**Notes:** Both Playwright and RTL cover onboarding (intentional redundancy — RTL catches component bugs, Playwright catches build/lazy-load regressions).

### Q3: Where do unit test files live?

| Option | Description | Selected |
|--------|-------------|----------|
| Co-located | `src/lib/helpers.test.ts` next to `helpers.ts`. | ✓ |
| Mirror tree under `tests/` | `tests/lib/helpers.test.ts`. Keeps `src/` clean. | |
| Co-located + `__tests__` folders | `src/lib/__tests__/helpers.test.ts`. | |

**User's choice:** Co-located
**Notes:** Standard Vitest convention. Playwright tests live separately under top-level `e2e/`.

---

## Sentry Redaction Strategy

### Q1: How should `beforeSend` behave when an event references redacted keys?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop entire event | Any event with redacted keys is dropped before send. Maximum safety; loses debugging. | |
| Scrub values, keep structure | Replace values with `[Redacted]`; preserve stack frames + error class + breadcrumb keys. | ✓ |
| Hybrid: scrub + drop replays | Scrub for errors/breadcrumbs; drop entirely for Session Replay. | |

**User's choice:** Scrub values, keep structure
**Notes:** Implementation must walk nested objects, arrays, and JSON-serialized strings.

### Q2: Beyond `symptom/mood/note/aiHistory`, which other free-text fields to scrub?

| Option | Description | Selected |
|--------|-------------|----------|
| Just the four named in PROD-02 | Match the spec literally. Leaves `meals`, `supplements`, etc. unscrubbed. | ✓ |
| All free-text user-typed fields | Above + `meals[].name`, `supplements[].search`, `weights[].nsv`, `injections[].note`. | |
| All user-data fields wholesale | Redact every key under any user-data slice (numeric data too). | |

**User's choice:** Just the four named in PROD-02
**Notes:** Captured as a deferred idea — re-evaluate before Phase 7 legal counsel sign-off in case WMHMDA "consumer health data" interpretation pushes the bar.

### Q3: Which Sentry features beyond error capture should Phase 1 enable?

| Option | Description | Selected |
|--------|-------------|----------|
| Errors only | Just `Sentry.captureException` + breadcrumbs. Lowest PII surface. | ✓ |
| Errors + Replay (privacy mode) | Adds Session Replay with `maskAllText` + `blockAllMedia`. | |
| Errors + Tracing (browser-only) | Adds Performance traces for navs and fetch spans. | |
| Full — Errors + Replay + Tracing | All three. | |

**User's choice:** Errors only
**Notes:** Replay/Tracing can land in Phase 2 (public deploy) or Phase 4+ (Supabase Edge Functions exist) if needed.

### Q4: Where does the demo Sentry trigger live?

| Option | Description | Selected |
|--------|-------------|----------|
| Dev-only Settings panel | "Dev tools" subsection in `SettingsPage.tsx`, gated by `import.meta.env.DEV`. | ✓ |
| Hidden URL/query param | `/?debug=1` or `/__debug` to render a button. | |
| Test-only — throw from Vitest | No UI button; Vitest `Sentry.captureException` test asserts the network call. | |

**User's choice:** Dev-only Settings panel
**Notes:** Survives in dev forever, never compiles into prod. Future devs can reuse for ad-hoc throws.

---

## Analytics Consent Posture

### Q1: At Phase 1, do PostHog events fire by default, or wait for Phase 7 legal counsel?

| Option | Description | Selected |
|--------|-------------|----------|
| Fire from Phase 1 (cookieless = consent-exempt) | Data flowing from day one with footer privacy policy stub. | |
| Phase-7-gated firing | SDK loaded; production events gated behind `analyticsEnabled` flag (false until Phase 7). Dev/QA flag is true. | ✓ |
| Explicit opt-in banner from launch | Phase 1 also ships a consent banner. | |

**User's choice:** Phase-7-gated firing
**Notes:** Defensive posture; satisfies success criterion #2 in dev/QA without exposing real users to pre-counsel telemetry.

### Q2: Lay down the full v1 event taxonomy now, or just the two named in success criteria?

| Option | Description | Selected |
|--------|-------------|----------|
| Just the two named | `onboarding_started` and `tab_viewed`. Extend later. | |
| Onboarding funnel + tab views | Adds `onboarding_step_completed`, `onboarding_completed`, `onboarding_abandoned`. Typed `track()` helper. | ✓ |
| Full v1 spine | All v1 events (`injection_logged`, `share_link_created`, `clinic_invite_accepted`, etc.). | |

**User's choice:** Onboarding funnel + tab views
**Notes:** Lays down the typed `track()` pattern. Other phases extend the `EventName` union as features land.

### Q3: PostHog cookieless mode — how should `distinct_id` work?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-visit random (PostHog default) | Each pageload gets a fresh `distinct_id`. Maximum privacy; no cross-session funnels. | |
| localStorage UUID | Stable random UUID stored in `localStorage["leanshot_distinct_id"]`. | ✓ |
| Anonymous now, identify on auth (Phase 5) | Per-visit random until auth ships. | |

**User's choice:** localStorage UUID
**Notes:** Phase 5 will call `posthog.alias()` to bind the anon UUID to `auth.uid()` once accounts ship.

---

## Claude's Discretion

- ESLint flat-config (`eslint.config.js`) vs legacy `.eslintrc.cjs` shape — flat-config is the React 19 / TS 5.6 recommended path; planner picks.
- Prettier knobs (semicolons, quote style, print width, trailing comma) — pick a sensible default; current code reads as single-quote, semi true, ~100 col, trailing comma `all`.
- Vitest test environment (`jsdom` vs `happy-dom`) — `jsdom` is the safer React 19 default.
- GitHub Actions matrix (Node version, concurrency cancellation) — single LTS Node, cancel in-progress on push to same PR.
- Sentry/PostHog DSN+key delivery via `VITE_*` env vars with `.env.example` committed.
- `useConfirm()` helper file location — `src/hooks/useConfirm.ts` or `src/components/ui/Confirm.tsx`.

## Deferred Ideas

- Broaden Sentry redaction list before Phase 7 — re-evaluate when WMHMDA / FTC HBNR guidance is final.
- Husky + lint-staged pre-commit hooks — revisit if broken-CI cycles become frequent.
- Sentry Session Replay + Performance Tracing — Phase 2 (Replay) / Phase 4+ (Tracing).
- Coverage threshold enforcement — ratchet later.
- Zustand store action tests (`addInjection`, `bulkAddWeights`, etc.) — incremental as later phases touch.
- Sentry source-map upload via `@sentry/vite-plugin` — pointless until Phase 2 deploy.
- `/__debug` route for ad-hoc diagnostics — Settings dev-tools panel won.
- PostHog feature flags / experiments — out of v1 scope.
- Settings model-id override — Phase 4 (AI proxy) decision.
