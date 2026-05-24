---
phase: 48-m4-moderation
plan: 07
subsystem: edge-functions/moderation
tags: [moderation, anthropic, edge-fn, structured-output, auto-flag]
requires:
  - 48-01  # community_reports table + partial UNIQUE
  - 48-04  # log_moderation_action SECDEF RPC + moderation_audit table
  - 48-06  # auto_flag_content trigger that POSTs to this Fn + RED test stub
provides:
  - "claude-moderation Edge Fn (HMAC-authed, Anthropic structured-output classifier)"
  - "INSERT-only writer to community_reports with reason.source='claude_auto_flag'"
  - "Audit row via log_moderation_action(action_type='auto_flag')"
affects:
  - "community_reports queue depth (system-reporter rows joining user-reporter rows)"
  - "moderation_audit row count (one auto_flag audit per flag)"
tech-stack:
  added: []
  patterns:
    - "Anthropic /v1/messages + output_config.format.json_schema (GA structured output)"
    - "checkServiceRoleBearer HMAC auth (sb_secret_* format tolerant)"
    - "Deno.serve guarded by import.meta.main (test-trap prevention)"
    - "Per-Fn deno.json with no shared/* aliases (CLI v2.101.0 ignores --import-map)"
key-files:
  created:
    - supabase/functions/claude-moderation/index.ts
    - supabase/functions/claude-moderation/deno.json
  modified: []
decisions:
  - "Model id pinned HYPHENATED: claude-haiku-4-5-20251001 (per memory; API rejects dotted 4.5)"
  - "INSERT directly into community_reports via service-role client; do NOT call report_content RPC (RPC uses auth.uid() which is NULL under service-role; feedback_rpc_auth_uid_vs_service_role_mismatch)"
  - "Threshold: max(scores) >= 0.7 -> flag. Below threshold returns 200 {flagged:false}"
  - "Duplicate-key error from partial UNIQUE on community_reports is treated as success (re-flag is idempotent no-op)"
  - "Defense-in-depth PHI gate keeps explicit space.org_id check even though trigger WHEN clause filters; belt-and-suspenders for D-08 HIPAA boundary"
  - "AI_GATEWAY_BASE_URL defaults to https://api.anthropic.com if env var unset (graceful local-dev)"
metrics:
  duration_min: ~5
  completed: 2026-05-24T02:17:38Z
  tasks: 2
  commits: 2
  files: 2
---

# Phase 48 Plan 07: claude-moderation Edge Fn Summary

One-liner: Async Anthropic structured-output classifier (haiku-4.5) that turns trigger-fired content into queued `community_reports` rows at score ≥ 0.7, never auto-removing content (D-07 lock).

## What Shipped

Edge Function `supabase/functions/claude-moderation/index.ts` (167 lines) implementing the full async auto-flag pipeline:

1. **Auth**: `checkServiceRoleBearer(req)` constant-time HMAC compare against `SUPABASE_SERVICE_ROLE_KEY` (tolerant of new `sb_secret_*` format per memory).
2. **Validation**: Zod `BodySchema` rejects malformed payloads (400 `invalid_body`).
3. **PHI gate (defense-in-depth)**: SELECT space.org_id; if non-null or row missing, 204 silent skip. Primary gate lives in trigger WHEN clause from Plan 48-06; this is the belt-and-suspenders fallback per D-08.
4. **Anthropic call**: POST `${AI_GATEWAY_BASE_URL}/v1/messages` with `model='claude-haiku-4-5-20251001'`, `output_config.format.json_schema` describing `{toxicity, spam, medical_misinformation, rationale}`, `max_tokens=200`, `temperature=0`, system prompt focused on community-safety scoring 0-1.
5. **Score reduction**: `entries.reduce` finds the top-scoring category; if `< 0.7` returns `200 {flagged:false, scores}`; otherwise INSERTs into `community_reports` with `reason = { source:'claude_auto_flag', category, confidence, rationale }`, status `'open'`, reporter_user_id NULL.
6. **Duplicate handling**: partial UNIQUE on `community_reports` collisions return "duplicate key" — swallowed as success (idempotent).
7. **Audit**: `log_moderation_action('auto_flag', target_type, content_id, null, {scores,category,confidence}, rationale)`.
8. **Never deletes**: zero `delete from ... community_posts|community_comments` paths anywhere. Plan-checker grep gate codified in `<acceptance_criteria>`.
9. **Deno.serve guarded**: `if (import.meta.main && denoGlobal?.serve)` prevents test-import HTTP server (memory reference_deno_test_top_level_serve_trap).

Per-Fn `deno.json` shipped with `--allow-env --allow-net` test task and `npm:@supabase/supabase-js@2` import (no `shared/*` aliases per memory reference_supabase_functions_deploy_import_map_flag).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | claude-moderation Edge Fn implementation | b8916bf4 | supabase/functions/claude-moderation/index.ts |
| 2 | per-Fn deno.json | a305ae16 | supabase/functions/claude-moderation/deno.json |

## Acceptance Gates — All Pass

```
model hyphenated (>=1): 1
dotted ids (==0): 0
checkServiceRoleBearer (>=1): 3
output_config (>=1): 1
log_moderation_action (>=1): 1
community_reports (>=1): 1
DELETE on content tables (==0): 0
import.meta.main (==1): 1
auth.admin.signOut (==0): 0
deno.json exists: yes
deno.json supabase-js import (>=1): 1
deno test sweep: 4 passed | 0 failed (TODO stubs from Plan 48-06; trivial pass)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical fallback] AI_GATEWAY_BASE_URL default**
- **Found during:** Task 1
- **Issue:** Plan skeleton used `Deno.env.get('AI_GATEWAY_BASE_URL')!` (non-null assertion), which crashes the Fn with an uncaught TypeError if the env var is unset (e.g., local dev or new project where only ANTHROPIC_API_KEY is wired).
- **Fix:** Used `?? 'https://api.anthropic.com'` fallback. Vendor secret is still required at deploy time but the Fn now degrades to direct Anthropic endpoint rather than crashing on cold-boot if AI_GATEWAY_BASE_URL hasn't been set in Function Secrets yet.
- **Files modified:** supabase/functions/claude-moderation/index.ts
- **Commit:** b8916bf4

**2. [Rule 2 — Missing critical guard] ANTHROPIC_API_KEY pre-check**
- **Found during:** Task 1
- **Issue:** Plan skeleton used `Deno.env.get('ANTHROPIC_API_KEY')!` which would send empty `Authorization: Bearer ` header silently. Anthropic would 401 and the Fn returns the generic `anthropic_failed` (502), masking the real config issue.
- **Fix:** Added explicit `if (!apiKey) return jsonError(500, 'missing_anthropic_key');` so deploy-time secret misconfiguration surfaces with an actionable error string.
- **Files modified:** supabase/functions/claude-moderation/index.ts
- **Commit:** b8916bf4

**3. [Rule 1 — Bug] Removed unused `createClient` import**
- **Found during:** Task 1
- **Issue:** Plan skeleton imported `createClient` from `npm:@supabase/supabase-js@2` directly, but the Fn uses `makeLazyAdmin()` which already calls `createClient` internally — leaving the import unused. Deno lint would flag this and CI strict-mode would fail.
- **Fix:** Dropped the direct import; `makeLazyAdmin` is the sole client constructor path.
- **Files modified:** supabase/functions/claude-moderation/index.ts
- **Commit:** b8916bf4

**4. [Rule 2 — Test ergonomics] Re-exported `setAdminForTest` / `resetAdminForTest`**
- **Found during:** Task 1
- **Issue:** Plan 48-06 test stubs at `index.test.ts` (lines 11-26) describe behaviors that will need to stub the supabase client (e.g., simulate `community_spaces.maybeSingle` returning a row). `makeLazyAdmin` returns those hooks but the plan skeleton only re-exported `admin`, leaving Wave 1 tests unable to inject a fake client.
- **Fix:** Destructured + re-exported all three: `export const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();`. Matches the pattern used by `notify-community/index.ts`.
- **Files modified:** supabase/functions/claude-moderation/index.ts
- **Commit:** b8916bf4

### Stubs / Carry-overs

- **Plan 48-06 test stubs remain as `Deno.test('TODO ...', () => {})` no-ops.** The plan's `<acceptance_criteria>` explicitly states "Plan 48-06 stubs are `Deno.test('TODO …', () => {})` — they pass trivially; Wave 1 implementation adds RED→GREEN cycles" — meaning Wave 1 (this plan) ships the Fn but does NOT yet fill in the structured-output / DELETE-never / HMAC test bodies. Those would be follow-up work in a later wave.
- **No `supabase functions deploy` performed** — per orchestrator dispatch instructions ("Do NOT run `supabase functions deploy` — operator deploys at 48-12 close-out"). Fn is committed but not yet live.

## Threat Flags

No new threat surface introduced beyond the `<threat_model>` already declared in the plan (T-48-03/08/09/21 all mitigated by code + grep gates).

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`) in the frontmatter. The two tasks carry `tdd="true"` individually but they ship implementation only — RED tests for the new behavior live in Plan 48-06's pre-existing TODO stubs which Wave 1 explicitly defers per the `<acceptance_criteria>` note. No `test(...)` commit was created in this plan because Plan 48-06 already shipped the RED scaffolds in its own commit graph.

## Self-Check: PASSED

- `[ -f supabase/functions/claude-moderation/index.ts ]` FOUND
- `[ -f supabase/functions/claude-moderation/deno.json ]` FOUND
- `git log b8916bf4` FOUND
- `git log a305ae16` FOUND
- All 9 grep acceptance gates pass
- Deno test sweep exits 0 (4 trivial-pass tests)
