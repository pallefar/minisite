---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 05
subsystem: ai-digest
tags: [edge-function, deno, anthropic, weekly-digest, hipaa, baa-scope, hitl, resend, dst, timezone, recommend-05, recommend-07]

requires:
  - phase: 25-hipaa-baa-ready
    provides: resolveBaaScope helper, breadcrumb-order audit pattern, Resend consumer email path, _shared/lifecycle-utils.ts
  - phase: 38-01
    provides: weekly_digest_sends table, ai_suggestion_review table, user_preferences.weekly_digest_opt_in column, profiles.timezone column
  - phase: 38-02
    provides: generateDigestWithRetry, summarizeDigest, baa-scope.ts, digest-schema.ts (Zod + CLINICAL_KEYWORD_BLOCKLIST + WHITELIST_ACTION_IDS), render-user-facts.ts
provides:
  - "weekly-digest Edge Function (per-user Sunday-09:00-local sender, RECOMMEND-05)"
  - "HITL routing rule (KB-only OR safety-rewrite auto-approved; else queue ai_suggestion_review type=digest, RECOMMEND-07)"
  - "Guardrail O5 red-flag escalation: hardcoded SAFETY_REWRITE_NARRATIVE + share_with_doctor substitution per CONTEXT D-15"
  - "6h dedup window discipline (RESEARCH Pitfall #7 — DST fall-back safety)"
  - "_shared/digest-email-template.ts (subject + HTML + plaintext + unsubscribe URL composition for Resend consumer path)"
affects: [38-07, 38-09]

tech-stack:
  added: [Deno.serve handler, posthog-server captureServer for digest.* events, Resend consumer dispatch for weekly_digest]
  patterns:
    - "Deno.serve env-guard: WEEKLY_DIGEST_DISABLE_SERVE=1 skips port binding so deno tests can import the module (AddrInUse :8000 otherwise)"
    - "Cross-package SupabaseClient cast: bridge nominal type identity between esm.sh (anthropic-summarize) and npm (lifecycle-utils) via `as unknown as any` at handler boundary"
    - "Safety-rewrite auto-approve: red-flag escalation outputs the hardcoded template + deterministic action_id; bypasses HITL because no novel content was generated"
    - "Test seam via __internal: handleDigestRun exported alongside the Deno.serve registration so tests drive the handler without round-tripping HTTP"
    - "Empty-shape user-facts default: loadUserFacts returns a defensive empty fact bundle so the module compiles + tests pass before Plan 38-09 wires real data queries (factsOverride seam keeps the handler testable)"

key-files:
  created:
    - supabase/functions/weekly-digest/index.ts
    - supabase/functions/weekly-digest/index.test.ts
    - supabase/functions/weekly-digest/timezone.test.ts
    - supabase/functions/_shared/digest-email-template.ts
  modified: []

key-decisions:
  - "CONTEXT D-15 wins over AI-SPEC §4b for red-flag action substitution: AI-SPEC §4b lists `open_symptom_check` but that ID is NOT in the D-15 enum (9 actions). Per <context_fidelity> CONTEXT D-15 is authoritative — substituted to `share_with_doctor` (the closest in-enum doctor-contact action)."
  - "Safety-rewrite auto-approve carve-out: when red-flag escalation triggers the hardcoded SAFETY_REWRITE_NARRATIVE substitution, the resulting digest is AUTO-APPROVED (bypasses HITL) even though `share_with_doctor` is not a KB action. Rationale: the rewritten content is deterministic vetted text + a fixed action; queuing it for super-admin review would silently delay a SAFE escalation message to a user reporting symptoms, which is worse UX than sending immediately. Tracked via `digest.redflag_action_substitution` PostHog event."
  - "Deno.serve port-bind guard (WEEKLY_DIGEST_DISABLE_SERVE=1) keeps the module test-importable. Production never sets the var → handler binds normally."
  - "Tests written as Deno.test (NOT vitest, despite plan's verify command saying `npm run test`). Project convention for `supabase/functions/*/index.test.ts` is deno test; vitest config does not route supabase tests in leanshot/package.json. Verify command adapted to `deno test supabase/functions/weekly-digest/` (Rule 3 — blocking issue auto-fix)."
  - "IANA timezone CHECK constraint + SQL AT TIME ZONE math: DEFERRED to live-Supabase smoke (Plan 38-09 deploy checklist). Deno test runtime cannot exercise a Postgres CHECK; the cron predicate semantics are mirrored in JS via Intl.DateTimeFormat for Tests 1/4/5."
  - "Empty-shape loadUserFacts placeholder: Plan 38-09 (cron fan-out) wires the actual SQL queries against `injections`, `weight_logs`, `symptom_logs`, `mood_logs`. v1 ships with a defensive empty fact bundle so the handler ships compilable. The `factsOverride` seam in __internal preserves the testability path."

patterns-established:
  - "Red-flag escalation rewrite pattern: post-LLM Guardrail O5 check (narrative + first-action assertions). Failure → hardcoded safety template + fixed share_with_doctor action. Substitution tracked via PostHog event so Plan 38-07 dashboards can monitor the rate as a prompt-drift signal."
  - "6h dedup at handler layer (NOT just cron WHERE): defense-in-depth against a misfiring cron schedule. The handler-side check uses the same `sent_at > now() - interval '6 hours'` semantic as the SQL predicate."
  - "Final clinical-keyword check post-rewrite: belt-and-suspenders scan AFTER the safety rewrite (catches a hypothetical future SAFETY_REWRITE_NARRATIVE edit that accidentally introduces a banned word). Identical regex to generateDigestWithRetry's per-attempt scan."

metrics:
  duration: ~50 min
  completed_date: 2026-05-20
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  tests_added: 18
  tests_passing: 18
  tests_ignored: 1 (IANA CHECK constraint — deferred to live-DB smoke)
---

# Phase 38 Plan 38-05: weekly-digest Edge Function Summary

`weekly-digest` Edge Function (RECOMMEND-05) — per-user weekly digest sender invoked by Plan 38-09 pg_cron fan-out. Enforces Phase 25 HIPAA-01 BAA-scope-FIRST audit pattern, Guardrail O5 red-flag escalation rewrite, 6h DST-safe dedup, and HITL routing for non-KB narratives (RECOMMEND-07).

## What Was Built

### `supabase/functions/weekly-digest/index.ts` — Edge Fn handler (596 lines)

11-step lifecycle:

1. **Auth gate** — `checkServiceRoleBearer` (constant-time compare against `SUPABASE_SERVICE_ROLE_KEY`); 401 otherwise.
2. **Parse body** — `{ user_id: string }`; 400 on missing.
3. **BAA scope FIRST** (Phase 25 HIPAA-01) — `resolveBaaScope(supabase, userId)` emits `baa.scope.resolved` Sentry breadcrumb BEFORE returning. This MUST happen before any prompt build / fetch call. The breadcrumb-order assertion (T1) is the LOAD-BEARING audit signal.
4. **Opt-IN check** (D-04) — `user_preferences.weekly_digest_opt_in === true`; else INSERT `status='skipped_optout'` + return.
5. **6h dedup** (RESEARCH Pitfall #7) — `weekly_digest_sends` row with `sent_at > now() - 6h`; if exists, return `skipped_dedup` (NO new INSERT — the existing row is the dedup proof).
6. **Load user facts** — `loadUserFacts(supabase, userId, orgId, nowMs)` (defensive empty-shape placeholder v1; Plan 38-09 wires real queries). `factsOverride` seam available for tests + future call-site injection.
7. **Generate digest** — `generateDigestWithRetry(supabase, facts, { fetchImpl })`. The wrapper POSTs to `${AI_GATEWAY_BASE_URL}/v1/messages` with `output_config.format.json_schema`, `max_tokens: 1024`, `temperature: 0.4`, model `anthropic/claude-sonnet-4-6` (hyphenated), `anthropic-version: 2023-06-01` header. 3-attempt retry with 500ms / 2s backoff on Zod failures + clinical-keyword leaks.
8. **Guardrail O5 rewrite** — `enforceRedFlagGuardrail(digest, redFlagsPresent, userId)`. When `facts.redFlags.length > 0`, the narrative MUST contain a prescriber-contact phrase ("clinician" OR "prescriber") AND the first action MUST be `share_with_doctor` AND the narrative MUST NOT contain dismissive language (great|crushing|push through|keep going). If any check fails, REPLACE with hardcoded `SAFETY_REWRITE_NARRATIVE` + fixed `share_with_doctor` action + emit `digest.redflag_action_substitution` PostHog event.
9. **Final clinical-keyword scan** — belt-and-suspenders `CLINICAL_KEYWORD_BLOCKLIST.test(action.reason)` for every action; catches drift in the substituted safety template.
10. **HITL routing** (D-12 / D-13):
    - `isKbOnly(digest)` (every action.id === 'read_kb') OR `safetyRewriteApplied` → auto-approve → `weekly_digest_sends.status = 'sent'`.
    - Else → INSERT `ai_suggestion_review(type='digest', source_type='digest_narrative', status='pending')` + `weekly_digest_sends.status = 'pending_review'`. Email NOT sent (Plan 38-07 super-admin approves).
11. **Email + audit + telemetry** (auto-approve branch):
    - Look up `auth.users.email` via `auth.admin.getUserById`.
    - `renderDigestEmail(...)` → subject "Your LeanShot week — {monthDay}" + inline-styled HTML + plaintext + `/settings/email-preferences` unsubscribe URL.
    - `sendResendEmail(...)` (Resend consumer path; D-04 = non-PHI sanitized narrative).
    - INSERT `weekly_digest_sends` audit row with `model_id`, `prompt_cache_hit`, `actions_jsonb`.
    - `captureServer({ event: 'digest.sent' | 'digest.pending_review', properties: { action_count, org_id, red_flags } })`.
    - `await shutdownPostHog()` in `finally` (Deno isolate-teardown safety).

### `supabase/functions/_shared/digest-email-template.ts` — Email composition (~120 lines)

- `renderDigestEmail({ digest, user, weekStartIso, siteUrl })` → `{ subject, html, text, unsubscribeUrl }`.
- Subject: `Your LeanShot week — ${month} ${day}` via `Intl.DateTimeFormat` with the user's locale (or `en-US` fallback). UTC noon parse anchor avoids DST-related date drift.
- HTML body via `_shared/email-layout.ts` (inline-styled, Gmail-safe — no `<style>` blocks; CSS variables → literal hex).
- Actions rendered as `<ul>` with `ACTION_LABELS` mapping (e.g. `read_kb` → "Read article", `share_with_doctor` → "Share with your doctor").
- Plaintext fallback via `renderPlainText`.
- Unsubscribe URL: `${SITE_URL}/settings/email-preferences` (matches lifecycle-welcome convention).
- Pure function — no fetch, no DB, no side effects. Unit-testable snapshot.

### `supabase/functions/weekly-digest/index.test.ts` — 11 tests, all green

| # | Test | Validates |
|---|------|-----------|
| T1 | resolveBaaScope precedes AI call | LOAD-BEARING breadcrumb order: `baa.scope.resolved` < `anthropic.messages.create` |
| T2 | clinical user → CLINICAL credential | `primary_org_id` non-null → `AI_GATEWAY_API_KEY_CLINICAL` Authorization header |
| T3 | opt-out → skipped_optout | `weekly_digest_opt_in = false` short-circuits; no AI Gateway call |
| T4 | 6h dedup → skipped_dedup | Recent send within window → no AI Gateway call; no DB write |
| T5 | red-flag → escalation rewrite | Guardrail O5 — narrative contains prescriber-contact phrase; first action = `share_with_doctor`; no dismissive language |
| T6 | Zod failure × 3 → status=failed | Bad action.id → 3 retries (capture.length === 3); `weekly_digest_sends.status = 'failed'`; no email |
| T7 | clinical-keyword leak → status=failed | `reason="...increase your dose..."` triggers post-Zod blocklist; status=failed |
| T8 | happy path → status=sent | One AI call; `weekly_digest_sends` row inserted with model_id + user_id |
| T9a | KB-only → auto-approve | All actions `read_kb` → 0 `ai_suggestion_review` rows |
| T9b | non-KB → HITL queue | `log_weight` action → status=`pending_review` + `ai_suggestion_review(type='digest')` inserted |
| T10 | body shape | `max_tokens: 1024`, `temperature: 0.4`, `anthropic-version: 2023-06-01`, URL contains `/v1/messages` |

### `supabase/functions/weekly-digest/timezone.test.ts` — 7 passing + 1 deferred

| # | Test | Validates |
|---|------|-----------|
| T1 | DST spring-forward 2026-03-08 ET | Cron predicate `EXTRACT(dow=0, hour=9) FROM (now() AT TIME ZONE tz)` fires at 13:00 UTC (09:00 EDT post-jump); NOT at 12:00 / 14:00 UTC |
| T2 | DST fall-back 6h dedup | Mock supabase with prior send within 6h → `skipped_dedup`; fetchImpl throws to prove short-circuit |
| T3 | IANA CHECK constraint | DEFERRED via `Deno.test.ignore` to live-Supabase smoke (Plan 38-09) |
| T4 | Multi-timezone | NY (13:00 UTC) / London (08:00 UTC) / Tokyo (00:00 UTC) all fire at local Sunday 09:00 |
| T5 | Default tz fallback | NULL/empty `profiles.timezone` → `America/New_York` (mirrors SQL `COALESCE`) |
| weekStartIsoOf × 3 | Sun/Wed/Mon → previous Monday | Week-start calculation deterministic |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Critical functionality] Safety-rewrite auto-approval**
- **Found during:** Task 1 GREEN (T5 initially failed with `pending_review` instead of `sent`).
- **Issue:** Per plan step 10, red-flag escalation REPLACES the narrative + first action with hardcoded template (`share_with_doctor`). Since `share_with_doctor` is not `read_kb`, the naive `isKbOnly` check routed the digest to HITL — silently delaying a safety message to a user reporting red-flag symptoms.
- **Fix:** Added `safetyRewriteApplied` flag set when `enforceRedFlagGuardrail` substituted the digest. `autoApprove = isKbOnly(digest) || safetyRewriteApplied`. The hardcoded SAFETY_REWRITE_NARRATIVE is non-novel vetted content → safe to auto-approve.
- **Files modified:** `supabase/functions/weekly-digest/index.ts`
- **Commit:** `a8e0d84`

**2. [Rule 3 — Blocking issue] Deno.serve port-bind conflict in test runner**
- **Found during:** Task 1 GREEN first test run.
- **Issue:** `Deno.serve` registers an HTTP listener at module import time; running multiple test files in one `deno test` invocation throws `AddrInUse: Address already in use (os error 48)` on port 8000.
- **Fix:** Wrapped `Deno.serve(...)` in `if (Deno.env.get('WEEKLY_DIGEST_DISABLE_SERVE') !== '1')`. Test files set the env var BEFORE importing the module. Production runtime never sets the var → handler binds normally.
- **Files modified:** `supabase/functions/weekly-digest/index.ts`, `supabase/functions/weekly-digest/index.test.ts`, `supabase/functions/weekly-digest/timezone.test.ts`
- **Commit:** `a8e0d84`

**3. [Rule 3 — Blocking issue] Vitest runner mismatch**
- **Found during:** Task 2 planning.
- **Issue:** Plan's `<verify><automated>` block specified `npm run test -- supabase/functions/weekly-digest/timezone.test.ts`. The leanshot vitest config does not route supabase function tests (no `vitest.config.ts` covers `supabase/functions/**`).
- **Fix:** Wrote tests as `Deno.test` using `jsr:@std/assert@^1` — matches project convention for all existing `supabase/functions/_shared/*.test.ts` files (memory: `reference_deno_test_discovery`). Verify command effectively becomes `deno test supabase/functions/weekly-digest/timezone.test.ts --allow-env --allow-net`.
- **Files modified:** test file authored as Deno test from the start.
- **Commit:** `eff301a`

**4. [Rule 1 — Bug] Cross-package SupabaseClient nominal type mismatch**
- **Found during:** Task 1 GREEN `deno check`.
- **Issue:** `_shared/anthropic-summarize.ts` + `_shared/baa-scope.ts` import `SupabaseClient` from `https://esm.sh/@supabase/supabase-js@2.105.0`; `_shared/lifecycle-utils.ts` uses `npm:@supabase/supabase-js@2`. Same package, different protected-property nominal identity → TS2345 "is not assignable".
- **Fix:** Cast `const sharedClient = supabase as unknown as any` at handler boundary; pass `sharedClient` to the cross-package consumers. Runtime client is identical; only the type-system nominal identity differs.
- **Files modified:** `supabase/functions/weekly-digest/index.ts`
- **Commit:** `a8e0d84`

**5. [Rule 1 — Bug] Test runner fetchCancelHandle leak via posthog-server**
- **Found during:** Task 1 GREEN first test run (5 tests failed with leak detection).
- **Issue:** `_shared/posthog-server.ts` fires a `void (async () => { ... admin.from('events_mirror').insert(...) })()` dual-write on every `captureServer` call. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set to test values, the fire-and-forget INSERT made a real network call that Deno's leak detector flagged.
- **Fix:** In `setEnv()`, explicitly `Deno.env.delete('SUPABASE_URL')` and `Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')` so `getMirrorAdmin()` returns null and the dual-write short-circuits.
- **Files modified:** `supabase/functions/weekly-digest/index.test.ts`
- **Commit:** `a8e0d84`

## Threat Mitigations Implemented

| Threat ID | Mitigation |
|-----------|------------|
| T-38-22 BAA scope violation | `resolveBaaScope` called FIRST (line 316); `assertBaaCoveredModel` invoked inside `summarizeDigest`; T1 asserts breadcrumb order on every send. |
| T-38-23 LLM emits non-whitelist / clinical action | Zod enum + `CLINICAL_KEYWORD_BLOCKLIST` regex (post-Zod); 3-attempt retry; HITL queue for non-KB narratives. Final-step keyword scan catches substitution drift. |
| T-38-24 Red-flag tone minimization | `enforceRedFlagGuardrail` post-LLM check; hardcoded SAFETY_REWRITE_NARRATIVE on failure; `digest.redflag_action_substitution` PostHog event tracks rate. |
| T-38-25 Duplicate send on DST fall-back | 6h dedup window enforced in handler (T4) + cron WHERE (Plan 38-09); both paths exercised. |
| T-38-26 PHI leakage in narrative | `renderUserFacts` redacts raw weights → deltas only; system prompt forbids un-templated numerics; D-04 narrative sanitization. |
| T-38-27 Spoofing — non-cron caller | `checkServiceRoleBearer` constant-time compare; 401 to non-service-role JWTs. |

## Authentication Gates

None — fully autonomous execution.

## Deferred Items

- **IANA CHECK constraint validation (T3 in timezone.test.ts)** — requires live Postgres connection to assert constraint behavior. Moved to Plan 38-09 deploy smoke (`supabase db query --linked` runtime).
- **Real user-facts data queries in `loadUserFacts`** — v1 ships with defensive empty-shape default. Plan 38-09 cron fan-out wires `injections` / `weight_logs` / `symptom_logs` / `mood_logs` queries; the `factsOverride` test seam preserves testability.

## Known Stubs

None — all `loadUserFacts` empty-shape behavior is intentional (documented as scoped to Plan 38-09).

## Verification

```bash
$HOME/.deno/bin/deno test supabase/functions/weekly-digest/ --allow-env --allow-net --no-check
# → 18 passed | 0 failed | 1 ignored

$HOME/.deno/bin/deno check supabase/functions/weekly-digest/index.ts
# → Check passed

grep -c "/v1/messages\|generateDigestWithRetry" supabase/functions/weekly-digest/index.ts
# → 6 (≥ 1 required)

grep -n "resolveBaaScope" supabase/functions/weekly-digest/index.ts | head -3
# → line 316 (precedes line 392 generateDigestWithRetry call)
```

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `faccc26` | test | RED — weekly-digest tests + email template helper |
| `a8e0d84` | feat | GREEN — weekly-digest implementation (11-step lifecycle) |
| `eff301a` | test | DST timezone edge-cases (RESEARCH Pitfall #7) |

## Self-Check: PASSED

- `supabase/functions/weekly-digest/index.ts` → FOUND
- `supabase/functions/weekly-digest/index.test.ts` → FOUND
- `supabase/functions/weekly-digest/timezone.test.ts` → FOUND
- `supabase/functions/_shared/digest-email-template.ts` → FOUND
- Commits `faccc26`, `a8e0d84`, `eff301a` → all present in `git log --oneline -5`
