---
phase: 34-m2-onboarding-overhaul-activation-event
type: validation
generated: 2026-05-20
source: inline-from-plan-verify-blocks
---

# Phase 34 Validation Architecture

Per-plan `<verify><automated>` aggregation. Generated inline per memory `feedback_validation_md_inline_generation_when_missing` instead of re-spawning the researcher.

## Framework

| Property | Value |
|---|---|
| Frontend tests | Vitest (rooted in `leanshot/`); `<name>.test.tsx` |
| Edge Fn tests | Deno (`<name>.test.ts`) per `reference_deno_test_discovery` |
| E2E | Playwright (`leanshot/tests/e2e/`) |
| Lint | ESLint flat config; `npm run lint` |
| Type | `tsc -p tsconfig.app.json --noEmit` |
| Migration smoke | `node -e` regex assertions on file content (no live DB push during executor verify) |

## Per-plan automated verify

### Wave 1

| Plan | Verify command |
|---|---|
| 34-01 Task 1 | Migration-content regex: `anonymous_sessions` table exists, RLS enabled, `idx_anon_sessions_ttl` partial index, `onboarding_flows` table + SECDEF `save_consumer_onboarding_flow` + `_validate_onboarding_steps` + `onboarding_flows_active_one` partial unique + superadmin gate, goal catalog (`lose-weight..track-with-vial-supply`) |
| 34-01 Task 2 | `20270706000004_p34_activation_events_alter.sql` is **ALTER not CREATE** (asserts forbidden `create table public.activation_events`); contains `add column if not exists goal_type`, `activation_events_goal_type_check`, `activation_events_user_self_read`, `for select to authenticated` |
| 34-02 Task 1 | `20270706000005_p34_anon_session_ttl_cron.sql` uses named dollar-quote tags only (no bare `$$`); inner `$anon_ttl$` appears ≥2×; job name `phase34-anon-session-ttl-weekly`; TTL predicate; orphan predicate; pre-flight `cron.unschedule` block |
| 34-02 Task 2 | `cd leanshot && npm run test:unit -- --run src/lib/anonymous/cookie.test.ts && cd .. && deno test --allow-env --allow-net supabase/functions/create-anon-session/index.test.ts` |
| 34-03 Task 1 | `cd leanshot && npm run test:unit -- --run src/lib/analytics/__tests__/events-registry.test.ts && npm run lint` |
| 34-03 Task 2 | `deno test --allow-env --allow-net supabase/functions/record-activation/index.test.ts` + `Phase38Event` union extended assertion + `record_activation_event` RPC has `pg_advisory_xact_lock` + `security definer` |

### Wave 2

| Plan | Verify command |
|---|---|
| 34-04 Task 1 | `cd leanshot && npm run test:unit -- --run src/lib/auth.test.ts` |
| 34-04 Task 2 | `cd leanshot && npm run test:unit -- --run src/components/auth/AuthCallbackView.test.tsx && npm run lint -- --max-warnings 0 src/App.tsx src/components/auth/AuthCallbackView.tsx src/lib/auth.ts` |
| 34-05 Task 1 | Migration regex: `merge_anon_session`, `pg_advisory_xact_lock`, `security definer`, `jsonb_array_length`, grant present, `order by pop_score desc, last_activity_at desc`; posthog-server has `aliasServerSide` |
| 34-05 Task 2 | `deno test --allow-env --allow-net supabase/functions/merge-anon-session/index.test.ts && cd leanshot && npm run test:unit -- --run src/lib/anonymous/__tests__/anon-merge.test.ts` |

### Wave 3

| Plan | Verify command |
|---|---|
| 34-06 Task 1 | `cd leanshot && npm run test:unit -- --run src/lib/onboarding-builder/__tests__/use-consumer-onboarding-flow.test.ts src/components/onboarding/AnonymousPreviewLayer.test.tsx` + App.tsx `'onboard-preview'` view + `/onboard` pathname branch |
| 34-06 Task 2 | `cd leanshot && npm run test:unit -- --run src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` |
| 34-06 Task 3 | `cd leanshot && npm run test:unit -- --run src/components/onboarding/social-proof/social-proof.test.tsx` + `get_rolling_signup_count` RPC w/ SECDEF + grant |
| 34-08 Task 1 | `cd leanshot && npm run test:unit -- --run src/lib/org.test.ts` + admin manifest entry rewritten (`onboarding-builder/OnboardingBuilderModule`); no placeholder remains |
| 34-08 Task 2 | `cd leanshot && npm run test:unit -- --run src/components/admin/onboarding-builder/StepPalette.test.tsx src/components/admin/onboarding-builder/OnboardingBuilderModule.test.tsx && npm run build` (dnd-kit index-leak guard) |
| 34-08 Task 3 | HUMAN — super-admin walkthrough: drag step, save, draft variant, view live preview route |

### Wave 4

| Plan | Verify command |
|---|---|
| 34-07 Task 1 | `cd leanshot && npm run test:unit -- --run src/lib/onboarding/first-action-map.test.ts src/lib/onboarding/activation-hooks.test.ts` + store has `activationFiredAt`, `setActivationFiredAt`, `replayDraftEntries`, `draftEntriesPending` |
| 34-07 Task 2 | `cd leanshot && npm run test:unit -- --run src/components/onboarding/FirstActionSurface.test.tsx` |
| 34-09 Task 1 | `deno test --allow-env --allow-net supabase/functions/ship-winner-flag/index.test.ts supabase/functions/onboarding-funnel-query/index.test.ts` |
| 34-09 Task 2 | `cd leanshot && npm run test:unit -- --run src/components/admin/onboarding-builder/OnboardingABPanel.test.tsx src/components/admin/onboarding-builder/OnboardingFunnelTab.test.tsx` + `OnboardingBuilderModule.tsx` no longer references `TabPlaceholder` |

### Wave 5

| Plan | Verify command |
|---|---|
| 34-10 Task 1 | `cd leanshot && npx playwright test --grep onboarding --reporter=line` (anon-merge + activation + auth callback specs) |
| 34-10 Task 2 | Lighthouse harness — `npm run lighthouse:onboard` (script added in 34-10 plan); asserts mobile score ≥ 90 |
| 34-10 Task 3 | HUMAN — Apple Services ID registration (Apple Developer console) |
| 34-10 Task 4 | HUMAN — `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` set as Supabase Function Secrets |

## Phase-level acceptance gate

A phase passes when:
1. All `autonomous: true` plans pass their `<automated>` verify commands.
2. All `autonomous: false` plans complete the human checkpoint walkthrough.
3. Cross-cutting smoke: `npm run build` passes (CI dnd-kit index-leak guard); `tsc -p tsconfig.app.json --noEmit` clean.
4. ONBOARD-10 Lighthouse ≥90 on `/onboard` (mobile) — measured in 34-10 Task 2.

## Threat-coverage cross-ref

Each plan ships a `<threat_model>` block; the executor runs `<automated>` checks that exercise the mitigations. Per-plan threat IDs (T-34-NN) are listed in the individual PLAN.md files.
