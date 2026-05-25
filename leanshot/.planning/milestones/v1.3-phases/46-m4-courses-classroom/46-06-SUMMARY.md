---
phase: 46
plan: 06
subsystem: courses-classroom
tags: [courses, beacon, sendBeacon, edge-fn, lesson-progress, anti-skip]
requires:
  - .planning/phases/46-m4-courses-classroom/46-01-PLAN.md  # lesson_progress table + update_lesson_position SECDEF RPC
provides:
  - supabase/functions/lesson-progress-beacon/  # Edge Fn handling tab-close sendBeacon saves
affects:
  - downstream Plan 46-08 (Mux Player onTimeUpdate debounced writer) — registers visibilitychange + pagehide listeners that POST to this Fn
  - downstream Plan 46-11 (course close-out) — MUST deploy this Fn + run curl smoke test with `Content-Type: text/plain;charset=UTF-8` body
tech-stack:
  added:
    - "Deno Edge Function: lesson-progress-beacon (npm:@supabase/supabase-js@2)"
  patterns:
    - "sendBeacon body parse: req.text() + JSON.parse() (NOT req.json()) — text/plain content-type"
    - "JWT auth from body (NOT Authorization header) — sendBeacon cannot set headers"
    - "Per-request user-scoped Supabase client for SECDEF RPC invocation (auth.uid() forwarding)"
    - "All error paths return 200 silently (sendBeacon cannot read response)"
    - "import.meta.main guard avoids deno-test serve trap"
key-files:
  created:
    - supabase/functions/lesson-progress-beacon/index.ts          # 216 lines, beacon handler
    - supabase/functions/lesson-progress-beacon/index.test.ts     # 296 lines, 10 Deno tests
    - supabase/functions/lesson-progress-beacon/deno.json         # per-fn imports
  modified: []
decisions:
  - "Auth dispatch (b): per-request user-scoped client via createClient + Authorization header (NOT service-role + p_user_id arg). Rationale: update_lesson_position SECDEF RPC already reads auth.uid() and is granted to `authenticated` only — forwarding the JWT keeps the existing security surface; passing p_user_id would require widening the RPC signature and re-granting to service-role."
  - "Math.max(0, Math.round(x)) defensive clamp on both position fields — beacon payloads can carry sub-second floats from Mux Player; INTEGER column requires rounding; negative inputs (clock skew / bug) clamp to 0."
  - "GET → 405 (loud) but body parse / auth / validation failures → 200 (silent) — sendBeacon dispatch invariants. GET is never a legitimate sendBeacon shape, so a loud 405 helps debug accidental wiring."
metrics:
  duration: "~15 min"
  tasks_completed: 2
  tests_passed: 10
  files_created: 3
  files_modified: 0
  completed: 2026-05-24
---

# Phase 46 Plan 06: lesson-progress-beacon Summary

Tab-close progress saves via `navigator.sendBeacon`: text/plain body parse, body-borne JWT validation, and SECDEF RPC dispatch through a per-request user-scoped Supabase client. Closes the gap where Mux Player's 15-s onTimeUpdate debounce would otherwise lose the user's final position when the tab dies.

## What Shipped

- `supabase/functions/lesson-progress-beacon/index.ts` (216 LOC) — single `handler(req)` exporting test seams for admin client + user-client factory.
- `supabase/functions/lesson-progress-beacon/deno.json` — declares `npm:@supabase/supabase-js@2` only (no `--import-map` flag at deploy per `reference_supabase_functions_deploy_import_map_flag`).
- `supabase/functions/lesson-progress-beacon/index.test.ts` — 10 Deno test cases, all green.

## Behavior Surface

| Input shape | Response | Side effect |
|---|---|---|
| OPTIONS | 204 + CORS headers | none |
| Non-POST (e.g. GET) | 405 `method_not_allowed` | none |
| POST + invalid JSON body | 200 `ok` | warn log |
| POST + missing `access_token` | 200 `ok` | none |
| POST + invalid `access_token` (auth.getUser returns null) | 200 `ok` | none |
| POST + missing or non-string `lesson_id` | 200 `ok` | none |
| POST + non-number `last_position_seconds` / `max_position_reached_seconds` | 200 `ok` | none |
| POST + valid body + valid token | 200 `ok` | `rpc('update_lesson_position', { p_lesson_id, p_last_position_seconds: Math.max(0, Math.round(last)), p_max_position_reached_seconds: Math.max(0, Math.round(max)) })` |
| RPC throws | 200 `ok` | warn log (sendBeacon cannot read response anyway) |

## Auth Model

- Service-role `admin` client is used **only** for `auth.getUser(token)` — never for the write.
- Write is dispatched through a per-request `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + token } } })`.
- Inside the RPC, `auth.uid()` resolves to the JWT subject; SECURITY DEFINER bypasses RLS for the write but the user identity is still server-validated.
- Why not pass `p_user_id` arg + use service-role: would require widening the RPC signature, re-granting to `service_role`, and would re-open the forge surface that the auth.uid() check forecloses. Per-request client is cleaner and matches the contract Plan 46-01 already shipped.

## Commits

| Hash | Type | Message |
|---|---|---|
| f9af109e | test | failing tests for lesson-progress-beacon (RED) |
| 0996ff4f | feat | lesson-progress-beacon Edge Fn (sendBeacon body parse + RPC dispatch) |

## Verification

- All 10 Deno tests pass: `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/lesson-progress-beacon/` → `ok | 10 passed | 0 failed`.
- Grep gates (all PASS):
  - `await req.text()` present
  - `await req.json()` ABSENT
  - `rpc('update_lesson_position'` present
  - `access_token` present
  - `deno.json` exists

## Deviations from Plan

### Task ordering nuance (no rule applied — informational)

Task 1 and Task 2 both carried `tdd="true"`. Because Task 2's deliverable IS the test file that the TDD RED step needs for Task 1, splitting the work into two test commits would have meant either (a) a no-op refactor commit or (b) a stub-then-expand pattern that adds noise without coverage value. I therefore committed the full 10-case test suite in the RED step (covering Task 2's behavior list verbatim) and the implementation in the GREEN step. The combined test file at the path declared by Task 2 contains every behavior Task 2's `<behavior>` block requires, all green. No rule (1/2/3/4) applies — this is the natural shape of a 2-task TDD-and-tests plan.

### No Rules 1–3 auto-fixes applied

Plan executed exactly as written. No bugs found, no missing critical functionality discovered, no blocking issues.

## Carry-Overs for Downstream Plans

- **Plan 46-08** (Mux Player wiring): MUST POST a string body (NOT FormData; NOT Blob with explicit JSON type) to this Fn via `navigator.sendBeacon(url, JSON.stringify(payload))`. The string-shape is what produces the `Content-Type: text/plain;charset=UTF-8` request that this Fn is built for.
- **Plan 46-11** (close-out): The deployed Fn smoke-test MUST use `curl -X POST -H 'Content-Type: text/plain;charset=UTF-8' -d '{...}' <fn-url>` to prove the deploy correctly handles sendBeacon-shaped requests. A default curl (which sends application/json or no content-type) would not exercise the critical `req.text()` path under realistic conditions.

## Threat Model Coverage

| Threat ID | Mitigation Status |
|---|---|
| T-46-02 (Tampering — spoofed max_position) | **Mitigate (soft)** — RPC `update_lesson_position` uses `GREATEST(...)` so a spoofed-high beacon can only RAISE the max watch position, never lower it. `complete_lesson` performs its own ≥95% server-side check against `duration_seconds` (Plan 46-01 Task 3). Spoofed completion saves only a hollow cert with no actual learning, per CONTEXT D-12. |

## Threat Flags

None — fn introduces no new trust-boundary surface beyond what the plan + threat model already declared.

## Known Stubs

None.

## Self-Check: PASSED

- File `supabase/functions/lesson-progress-beacon/index.ts` — FOUND
- File `supabase/functions/lesson-progress-beacon/deno.json` — FOUND
- File `supabase/functions/lesson-progress-beacon/index.test.ts` — FOUND
- Commit `f9af109e` (test/RED) — FOUND
- Commit `0996ff4f` (feat/GREEN) — FOUND
- Deno test sweep — 10/10 PASS

## TDD Gate Compliance

- RED gate: commit `f9af109e` (`test(46-06): failing tests for lesson-progress-beacon (RED)`) verified failing before implementation (`Module not found ./index.ts`).
- GREEN gate: commit `0996ff4f` (`feat(46-06): lesson-progress-beacon Edge Fn ...`) verified all 10 tests pass after implementation.
- REFACTOR gate: not needed — initial implementation passed all tests cleanly.
