---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 06
subsystem: onboarding
tags: [onboarding, consumer, anonymous-preview, social-proof, ab-testing]
requires:
  - 34-01-anonymous-sessions-schema
  - 34-02-anon-cookie-edge-fn
  - 34-03-events-record-activation
  - 34-04-pkce-oauth-wrappers
  - 34-05-merge-anon-session
provides:
  - useConsumerOnboardingFlow hook (PostHog A/B + fail-open state machine)
  - AnonymousPreviewLayer (cookie bootstrap + smart defaults)
  - AnonymousPreviewView (/onboard surface body)
  - ConsumerOnboardingRenderer (8-goal selector + auth wiring + merge handshake)
  - update-anon-session Edge Fn (allowlist-filtered preference patches)
  - LiveSignupCounter + TestimonialRotator (social proof)
  - get_rolling_signup_count() RPC
affects:
  - leanshot/src/App.tsx (added /onboard path branch + 'onboard-preview' view)
  - leanshot/src/components/onboarding/OnboardingFlow.tsx (additional consumer render-branch)
tech-stack:
  added: []
  patterns:
    - "PostHog feature-flag-ready gate via onFeatureFlags() + 2s timeout fallback (RESEARCH Pitfall 9)"
    - "StrictMode-safe cookie bootstrap with inflight ref dedup"
    - "Smart defaults exposed as data-* attributes (no Context provider)"
    - "Edge Fn allowlist filter for jsonb merge surfaces (T-34-06-01)"
    - "RPC polling with visibility-pause for social proof counters"
key-files:
  created:
    - leanshot/src/lib/onboarding-builder/use-consumer-onboarding-flow.ts
    - leanshot/src/lib/onboarding-builder/__tests__/use-consumer-onboarding-flow.test.ts
    - leanshot/src/components/onboarding/AnonymousPreviewLayer.tsx
    - leanshot/src/components/onboarding/AnonymousPreviewLayer.test.tsx
    - leanshot/src/components/onboarding/AnonymousPreviewView.tsx
    - leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx
    - leanshot/src/components/onboarding/ConsumerOnboardingRenderer.test.tsx
    - leanshot/src/components/onboarding/social-proof/LiveSignupCounter.tsx
    - leanshot/src/components/onboarding/social-proof/TestimonialRotator.tsx
    - leanshot/src/components/onboarding/social-proof/social-proof.test.tsx
    - supabase/functions/update-anon-session/index.ts
    - supabase/functions/update-anon-session/index.test.ts
    - supabase/functions/update-anon-session/deno.json
    - supabase/migrations/20270706000008_p34_get_rolling_signup_count_rpc.sql
  modified:
    - leanshot/src/App.tsx
    - leanshot/src/components/onboarding/OnboardingFlow.tsx
decisions:
  - "Consumer renderer activates only when onboarding_flows.config.length > 0 — empty control row falls through to legacy DEFAULT_STEPS for backward compatibility"
  - "Pill-grid radiogroup chosen for 8-goal selector (single-select) to match D-11 catalog; goal persistence debounced via update-anon-session Edge Fn"
  - "update-anon-session was shipped alongside the renderer (Task 2) — keeping the persistence loop closed within this plan rather than chaining a future plan"
  - "Social proof uses 30s setInterval polling, NOT Realtime — open question 2 resolved in RESEARCH (bundle weight + WebSocket cost on a marketing surface)"
metrics:
  duration_seconds: 708
  duration_human: "~11min"
  completed_at: "2026-05-20T17:47:00Z"
  commits: 3
  tests_added: 31
---

# Phase 34 Plan 06: Consumer Onboarding Surface Summary

JWT-less anonymous preview surface + config-driven consumer onboarding renderer
with goal selector, auth wiring (magic-link + Google + gated Apple), post-signup
merge handshake, social proof, and the `get_rolling_signup_count` RPC — wired
into the existing OnboardingFlow render-branch and a new `/onboard` path route.

## What Shipped

### Hook + preview layer (Task 1, commit `7f78ba8`)

- **`useConsumerOnboardingFlow()`** — state machine (`loading | preview | consumer | completed`)
  that loads the active `onboarding_flows` row, optionally selecting a specific
  `version_id` from the `onboarding-ab` PostHog flag payload. The PostHog read
  is gated on `posthog.onFeatureFlags()` with a 2-second timeout fallback so a
  blocked `/flags/` request cannot wedge the loading state (RESEARCH Pitfall 9).
  Fail-open: any error returns the appropriate auth-based status with `flow=null`.
- **`AnonymousPreviewLayer`** — wraps preview children with (a) idempotent
  `_ls_anon` cookie bootstrap via `/functions/v1/create-anon-session`
  (StrictMode-safe via an in-flight ref), and (b) smart-default derivation
  (locale, units, timezone) exposed as `data-*` attributes for downstream
  surfaces without a Context provider. Locale → imperial only for `en-US`,
  `en-LR`, `en-MM`; everything else metric.
- **`AnonymousPreviewView`** — ~50-line surface (hero + value-prop bullet list + CTA).
- **App.tsx** — `'onboard-preview'` view added to the View union; `/onboard`
  pathname branch inserted in `selectView` (after `cancel-deletion`, before
  the user-gated dashboard fallback). Lazy-loaded so the layer + preview body
  stay off the index static graph.

### Consumer renderer + update-anon-session (Task 2, commit `c6cf391`)

- **`ConsumerOnboardingRenderer`** — 4-step renderer (intro → goal → auth → ready).
  D-11 8-goal pill grid renders as a `role="radiogroup"`; selection writes
  `draft.primary_goal` and debounce-PATCHes `anonymous_sessions.preferences`
  via the new Edge Fn. Auth step renders email + Google always; Apple gated
  via `isAppleEnabled()` from Plan 34-04. The end step is the D-12 hybrid
  3-card UI with the user's selected goal emphasised + 2 universal fallback
  cards (log weight / log injection). Every clickable element carries
  `min-h-[44px]` for ONBOARD-02 mobile tap-targets.
- **Post-signup merge handshake** — when `signedIn.user.id` transitions
  from `null` to a UUID, POSTs `/functions/v1/merge-anon-session` with
  the cookie and PostHog distinct_id, dispatches returned `draft_entries`
  to `useStore.getState().replayDraftEntries` if it exists, and finally
  calls `clearAnonCookie()` (cookie is single-use post-merge).
- **`OnboardingFlow.tsx` render-branch** — activates the consumer renderer
  only when `consumerFlowState.flow.config.length > 0`. The seeded empty
  control row from Plan 34-01 keeps the legacy DEFAULT_STEPS path live
  until admins populate the new flow. This is a conservative narrowing of
  the plan's `'consumer'|'preview'` switch — it preserves the entire
  pre-existing signup flow as the rollout safety net.
- **`update-anon-session` Edge Fn** — `POST { cookie_id, preferences_patch?,
  draft_entries_append?, aff_code? }`. Preferences patch is allowlist-filtered
  to `{locale, units, timezone, primary_goal}` (T-34-06-01); per-key shape
  validation rejects out-of-enum values. Draft entries cap at 50 per request.
  Recomputes `population_score` (cap 10). Mirrors `create-anon-session`'s
  lazy-admin + Proxy + test-injection pattern.

### Social proof + RPC (Task 3, commit `4f033cc`)

- **`get_rolling_signup_count()` RPC** — SECDEF returning `count(*)::int` of
  profiles created in the last 7 days. STABLE, search_path-locked, granted
  to `anon` + `authenticated`. T-34-06-02 disposition: accept — aggregate
  count only, no PII.
- **`LiveSignupCounter`** — RPC polling every 30s (NOT Realtime, per Open
  Question 2 resolution). Pauses when `document.visibilityState === 'hidden'`,
  resumes immediately on visibility change. First-load skeleton avoids
  layout shift. Privacy opt-out: `localStorage['leanshot_social_proof_optout']`.
- **`TestimonialRotator`** — 3 hard-coded patient-voice testimonials,
  rotating every 30s, suppressed when `prefers-reduced-motion` is on. Same
  opt-out flag as the counter.

### `update-anon-session` endpoint contract

```
POST /functions/v1/update-anon-session
Body: {
  cookie_id: string (UUID v4),                      // REQUIRED
  preferences_patch?: {                              // allowlist below
    locale?: string,                                 // ≤ 64 chars
    units?: 'metric' | 'imperial',
    timezone?: string,                               // ≤ 64 chars
    primary_goal?: PrimaryGoal,                      // D-11 catalog
  },
  draft_entries_append?: unknown[],                  // appended, capped at 50/request
  aff_code?: string,                                 // ≤ 64 chars, only set once
}
Response 200: { ok: true, population_score: number }
Response 400: invalid_cookie_id | invalid_json
Response 404: not_found (orphan or already-merged cookie)
Response 500: db_error
```

Allowlisted preference keys: `locale`, `units`, `timezone`, `primary_goal`.
Unknown keys are silently dropped (T-34-06-01 mitigation).

## Deviations from Plan

### [Rule 2 - Critical functionality] Narrowed consumer render-branch trigger

- **Found during:** Task 2 (writing the OnboardingFlow render-branch)
- **Issue:** Plan instructed `consumerFlowState.status === 'consumer' || 'preview'`
  → ConsumerOnboardingRenderer. With Plan 34-01 seeding an empty active row
  on every environment, that switch would have replaced the existing
  signup flow (medication / body_stats / consent steps) immediately on deploy,
  before admins ship any consumer step config. The legacy DEFAULT_STEPS
  carries the full signup capture; the new renderer is intentionally lean
  (intro/goal/auth/ready).
- **Fix:** Added the `consumerFlowState.flow.config.length > 0` guard so the
  switch only fires once a non-empty config is published. Existing users
  continue to land in DEFAULT_STEPS until admins explicitly seed the new
  flow row. Documented in inline code comments.
- **Files modified:** `leanshot/src/components/onboarding/OnboardingFlow.tsx`
- **Commit:** `c6cf391`

### [Rule 3 - Blocking issue] `localUser?.id` does not exist on the project's User type

- **Found during:** Task 2 (typecheck after writing the hook)
- **Issue:** The plan's hook sketch keyed the `useEffect` re-run on
  `localUser?.id`, but `leanshot/src/types/index.ts` `User` interface has
  no `id` field (the local user is identified by Zustand store presence,
  not a UUID).
- **Fix:** Changed dependency from `localUser?.id` → `localUser` (truthy
  presence). Equivalent behaviour for the only meaningful transition
  (null → set).
- **Files modified:** `leanshot/src/lib/onboarding-builder/use-consumer-onboarding-flow.ts`
- **Commit:** `7f78ba8`

## Known Stubs / Follow-ups

- **`useStore.getState().replayDraftEntries`** — the renderer's post-merge
  handshake best-effort dispatches `draft_entries` to a Zustand action that
  Plan 34-07 (FirstActionSurface) is expected to add. The renderer never
  throws if the action is absent; it just logs a single warn. Tracked as
  follow-up wiring for Plan 34-07.

## Threat Surface Scan

No new surface beyond the threat model declared in the plan. The
`update-anon-session` Edge Fn's allowlist filter directly implements
T-34-06-01; `get_rolling_signup_count` carries T-34-06-02 (accept disposition);
the merge handshake inherits Plan 34-05's JWT-gated security (T-34-06-06);
no new file-access surface, no schema migrations at trust boundaries.

## Test Coverage

| Suite                                        | Tests | Status |
| -------------------------------------------- | ----- | ------ |
| use-consumer-onboarding-flow.test.ts         | 7     | PASS   |
| AnonymousPreviewLayer.test.tsx               | 7     | PASS   |
| ConsumerOnboardingRenderer.test.tsx          | 10    | PASS   |
| social-proof.test.tsx                        | 7     | PASS   |
| supabase/functions/update-anon-session       | 11    | (Deno; not run by vitest — gated for `supabase functions deploy --no-verify-jwt` CI later) |

Vitest total: **31/31 passing** in 1.4s.

## Commits

| Hash      | Type | Description                                                                       |
| --------- | ---- | --------------------------------------------------------------------------------- |
| `7f78ba8` | feat | consumer onboarding hook + AnonymousPreviewLayer + /onboard route                 |
| `c6cf391` | feat | ConsumerOnboardingRenderer + update-anon-session Edge Fn                          |
| `4f033cc` | feat | get_rolling_signup_count RPC + social-proof tests                                 |

## Self-Check: PASSED

All 14 declared files exist on disk; all 3 per-task commits resolve in
`git log --oneline --all`.
