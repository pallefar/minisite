---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "02"
subsystem: rag-edge-helpers
tags: [rag, edge-functions, observability, guardrails, slack, posthog, deno]
dependency_graph:
  requires: [60-01]
  provides: [rag-retrieve-client, posthog-rag-events, slack-guardrail-alert, shared-deno-json]
  affects: [60-04, 60-05, 60-06, 60-07, 60-11, 60-12]
tech_stack:
  added: [zod@^3 (Deno via deno.json import map)]
  patterns: [vault-fetched-webhook, lazy-admin-singleton, zod-parse-fail-closed, exponential-backoff-retry, phi-scrub-defense-in-depth]
key_files:
  created:
    - supabase/functions/_shared/deno.json
    - supabase/functions/_shared/posthog-rag-events.ts
    - supabase/functions/_shared/posthog-rag-events.test.ts
    - supabase/functions/_shared/slack-guardrail-alert.ts
    - supabase/functions/_shared/slack-guardrail-alert.test.ts
    - supabase/functions/_shared/rag-retrieve.ts
    - supabase/functions/_shared/rag-retrieve.test.ts
  modified: []
decisions:
  - "Vault admin uses .from('vault.decrypted_secrets') Supabase client query instead of raw SQL — same pattern as getMirrorAdmin() in posthog-server.ts"
  - "rag-retrieve.ts uses zod@^3 via deno.json import map; no supabase-js dependency (Bearer token header is sufficient)"
  - "Tests require --allow-env flag (Deno security sandbox); plan verify commands updated to use --allow-env per project-wide convention established in posthog-server.test.ts"
  - "Retry backoff: 250ms × attempt^2 (250ms → 1000ms for attempt 2); max 2 attempts total matches AI-SPEC §6 G6 comment on worst-case latency"
metrics:
  duration_seconds: 349
  completed_date: "2026-05-26"
  tasks_completed: 6
  files_created: 7
---

# Phase 60 Plan 02: Shared Edge Helpers Summary

**One-liner:** Three typed `_shared/` Deno helpers (PostHog RAG events, Slack guardrail alerts via vault, typed rag-retrieve HTTP client) + per-directory deno.json import map enabling all Wave-1+ Edge Functions to import canonical boilerplate instead of hand-rolling fetch/PostHog/Slack.

## What Was Built

### Files Created

| File | Purpose | Min Lines Met |
|------|---------|---------------|
| `supabase/functions/_shared/deno.json` | Per-directory import map for CLI v2.101.0+ | Yes (16 lines) |
| `supabase/functions/_shared/posthog-rag-events.ts` | 8 typed Phase 60 RAG event emitters | Yes (220+ lines) |
| `supabase/functions/_shared/posthog-rag-events.test.ts` | 4 Deno.test blocks | - |
| `supabase/functions/_shared/slack-guardrail-alert.ts` | Vault-fetched Slack webhook helper | Yes (200+ lines) |
| `supabase/functions/_shared/slack-guardrail-alert.test.ts` | 5 Deno.test blocks | - |
| `supabase/functions/_shared/rag-retrieve.ts` | Typed server-to-server rag-retrieve HTTP client | Yes (200+ lines) |
| `supabase/functions/_shared/rag-retrieve.test.ts` | 8 Deno.test blocks | - |

### deno.json Version Pins

```json
{
  "posthog-node": "npm:posthog-node@5.10.4",
  "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
  "zod": "npm:zod@^3",
  "std/assert": "https://deno.land/std@0.224.0/assert/mod.ts"
}
```

`posthog-node@5.10.4` exact-matches `posthog-server.ts` line 33.
`std/assert@0.224.0` exact-matches `posthog-server.test.ts` line 17.

### Event-Name → Emitter-Function Mapping (AI-SPEC §7 lines 936-943)

| Event Name | Emitter Function | Attribution | Required userId? |
|------------|-----------------|-------------|-----------------|
| `$ai_generation` | `emitAiGeneration` | user | Yes (D-13) |
| `$ai_evaluation` | `emitAiEvaluation` | user | Yes (D-13) |
| `rag_citation_validation_failed` | `emitCitationValidationFailed` | system | No |
| `rag_refusal_emitted` | `emitRefusalEmitted` | user | Yes (D-13) |
| `rag_cost_envelope_breach` | `emitCostEnvelopeBreach` | system | No |
| `rag_kanon_floor_dropped` | `emitKanonFloorDropped` | system | No |
| `rag_stale_evidence_flagged` | `emitStaleEvidenceFlagged` | system | No |
| `rag_ai04_fence_breach` | `emitAi04FenceBreach` | system | No |

### Channel → Slack Routing Table (AI-SPEC §7 lines 960-970)

| Channel Key | Slack Channel | Severity | Guardrails |
|-------------|---------------|----------|-----------|
| `pharma02` | `#alerts-pharma02` | P1 | G1 PHARMA-02 invariant |
| `regulatory` | `#alerts-regulatory` | P1 | G9 FDA equivalence claim |
| `rag` | `#alerts-rag` | P2/P3 | F1/F2/F3/F6 corpus/threshold |
| `cost` | `#alerts-cost` | P2 | G6/G7 cost envelope |
| `research` | `#alerts-research` | P3 | F7 k-anonymity |

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| `posthog-server.test.ts` | 4 | All pass |
| `posthog-rag-events.test.ts` | 4 | All pass |
| `slack-guardrail-alert.test.ts` | 5 | All pass |
| `rag-retrieve.test.ts` | 8 | All pass |
| **Total** | **21** | **21/21** |

Run command: `$HOME/.deno/bin/deno test --no-check --allow-env <files>`

## Static Invariant Gates (Task 5 — all 7 pass)

1. No top-level `Deno.serve(...)` in any helper (trap prevention)
2. No plaintext `hooks.slack.com` URL in source files (test stubs allowed)
3. Exactly 5 Slack channel strings matching AI-SPEC §7 verbatim
4. No `new PostHog(...)` in `posthog-rag-events.ts` (reuses posthog-server.ts instance)
5. `shutdownPostHog` re-exported from `posthog-rag-events.ts`
6. `/functions/v1/rag-retrieve` endpoint path present in `rag-retrieve.ts`
7. No top-level `fetch`/`createClient` assignments (all lazy singletons)

## Security Confirmations

- **No top-level `Deno.serve(...)` in any helper file** — pure library modules per `[[reference_deno_test_top_level_serve_trap]]`
- **No plaintext `hooks.slack.com` URL in any source file** — test stubs only; production URL from `vault.decrypted_secrets WHERE name='slack_guardrail_webhook'`
- **PHI scrub defense-in-depth** — `posthog-rag-events.ts` strips `user_id`, `patient_id`, `email`, `phone` before forwarding to `captureRagEvent`/`captureServer`
- **T-60-02-01 (Spoofing)**: Bearer header requires `userJwt` OR `SUPABASE_SERVICE_ROLE_KEY`; both absent → immediate throw
- **T-60-02-02 (Tampering)**: Zod schema + `.refine(refused ⇔ refusal_reason)` on every response

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deno tests require `--allow-env` flag**
- **Found during:** Task 2 (first test run)
- **Issue:** `deno test --no-check` without `--allow-env` fails with `NotCapable: Requires env access` when tests read or delete `Deno.env.*`. The plan's `<verify>` blocks omitted `--allow-env`.
- **Fix:** Added `--allow-env` to all Deno test invocations. This is the same pattern used by the existing `posthog-server.test.ts` (Task 6 confirmed those also require it).
- **Files modified:** None (test run command correction only; test files unchanged)
- **Commit:** Absorbed into per-task test commits

## Deferred to Consumer Plans

- `shutdownPostHog()` wrapping in `try/finally` inside each Wave-1+ consumer Fn — documented in JSDoc of `posthog-rag-events.ts`. This plan does NOT enforce it; each consumer Fn plan (60-04, 60-11, 60-12) must add the `try { … } finally { await shutdownPostHog(); }` block before returning their `Response`.

## Known Stubs

None — all 3 helpers are fully wired. `rag-retrieve.ts` calls `${SUPABASE_URL}/functions/v1/rag-retrieve` which is deployed in Plan 60-06; until that plan ships, calls will 404, but the helper itself has no stubs.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `02d7a98c` | feat(60-02): per-_shared deno.json import map |
| 2 | `0ecf3970` | feat(60-02): posthog-rag-events typed emitter helper + tests |
| 3 | `7ff9c9f3` | feat(60-02): slack-guardrail-alert vault-fetched webhook helper + tests |
| 4 | `9edf33e1` | feat(60-02): rag-retrieve typed server-to-server HTTP client + tests |
| 5 | `65527ee3` | chore(60-02): static invariant grep gates — all 7 pass |
| 6 | `f22901fe` | chore(60-02): cross-helper Deno sweep + tsc lint — 21/21 pass |

## Self-Check: PASSED
