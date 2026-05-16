---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 03
subsystem: edge-functions
tags: [deno, supabase, stripe, edge-function, impersonation, audit-trail, tdd]

requires:
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 01
    provides: audit_logs.impersonator_id column + 11 new P22 audit_action values + 51 impersonation write-deny RLS policies + admin_log_{refund,subscription_canceled,subscription_comped} RPCs + A1 PROBE PASS verdict
  - phase: 19-affiliate-program-stripe-connect
    plan: 09
    provides: affiliate-payout/index.ts lazy admin singleton + Proxy pattern (analog reused verbatim)
  - phase: 14-monetization-foundation-stripe-web-clinic-seats
    provides: Stripe esm.sh@19?target=denonext pin + apiVersion 2026-04-22.dahlia + STRIPE_SECRET_KEY function secret

provides:
  - supabase/functions/admin-impersonate (ADMIN-03 read-only impersonation mint)
  - supabase/functions/admin-stripe-action (ADMIN-04 refund/cancel/comp wrappers)
  - 14 Deno tests green (7 per Fn)
  - Both Edge Functions deployed ACTIVE @ v1 on ytnsipxxmzgaebkqmokp

affects:
  - 22-06 (admin members table — Impersonate button invokes admin-impersonate)
  - 22-07 (admin actions — Refund/Cancel/Comp modals invoke admin-stripe-action)
  - 22-09 (impersonation banner — useImpersonation hook reads app_metadata.impersonator_id
           + impersonation_exp claims minted by admin-impersonate)

tech-stack:
  added:
    - (none net-new) — composition of Phase 19 affiliate-payout + Phase 22-01 RPCs
  patterns:
    - "Lazy admin SupabaseClient singleton + Proxy for test-injectable env-deferred construction (reused verbatim from affiliate-payout/index.ts:67-88)"
    - "Stripe SDK lazy singleton with apiVersion '2026-04-22.dahlia' pinned + esm.sh@19?target=denonext (analog: affiliate-payout/index.ts:55-66)"
    - "Discriminated-union request body validation with per-operation guards (admin-stripe-action: refund | cancel | comp)"
    - "PII-safe Stripe error wrapping — extract .code via /^[a-z_][a-z0-9_]*$/i then return as 'stripe_<code>'; raw .message NEVER appears in response body or audit metadata (T-22-23 mitigation)"
    - "Audit-after-success pattern: admin_log_* RPC fires only when Stripe call succeeds (T-22-22 accept-and-trace — webhook reconciliation catches the row if RPC fails)"
    - "Idempotent end-impersonation: read current app_metadata.impersonator_id; no-op + no audit row if already null"
    - "Best-effort rollback on partial failure: if generateLink fails after updateUserById succeeds, immediately clear the app_metadata write so target isn't left half-impersonated"
    - "Refund idempotency_key shape: 'refund-<charge>-<amount_cents>' (Stripe dedupes identical args; differing amounts get distinct keys per T-22-25)"

key-files:
  created:
    - supabase/functions/admin-impersonate/index.ts
    - supabase/functions/admin-impersonate/deno.json
    - supabase/functions/admin-stripe-action/index.ts
    - supabase/functions/admin-stripe-action/deno.json
  modified:
    - supabase/functions/admin-impersonate/index.test.ts (Wave 0 scaffold → 7 real behavior tests)
    - supabase/functions/admin-stripe-action/index.test.ts (Wave 0 scaffold → 7 real behavior tests)

key-decisions:
  - "A1 PROBE verdict PASS (336ms latency per 22-01 22-A1-PROBE.md) → Option A primary implementation locked in: admin.auth.admin.updateUserById({app_metadata}) + admin.auth.admin.generateLink({type:'magiclink'}). Custom Access Token Hook fallback branch (Vault IMPERSONATION_JWT_SIGNING_KEY) NOT shipped — no vendor pass needed."
  - "Inline audit_logs INSERT for impersonate_start/end (no dedicated RPC) — service-role bypasses RLS so the impersonate path doesn't need a security-definer wrapper. The Stripe-action path DOES use admin_log_* RPCs because those need consistent app.suppress_audit GUC handling across all three operations."
  - "Refund idempotency_key = 'refund-<charge>-<amount_cents>' — same charge refunded at the same amount returns the same Stripe refund record (T-22-25 'accept' disposition); same charge at different amounts gets distinct keys (allowed)."
  - "Receipt email triggered on refund only (NOT cancel/comp) per UI-SPEC line 387. Best-effort invoke — refund still returns 200 even if lifecycle-transactional throws."
  - "Stripe-error response wrap: {error:'stripe_<code>'} where code is sanitized to /^[a-z_][a-z0-9_]*$/i. NEVER echoes .message (T-22-23). Test T6 explicitly asserts a known secret string in the error message does NOT appear in the response body."

requirements-completed: [ADMIN-03, ADMIN-04]

duration: ~38min
completed: 2026-05-16
---

# Phase 22 Plan 22-03: Admin Edge Functions (impersonate + Stripe action) Summary

**Two server-side admin primitives shipped: read-only impersonation mint (ADMIN-03) using A1 PROBE PASS Option A, and Stripe refund/cancel/comp wrapper (ADMIN-04) with PII-safe error sanitization + audit-on-success. 14/14 Deno tests pass; both Functions ACTIVE @ v1 on ytnsipxxmzgaebkqmokp.**

## Performance

- **Duration:** ~38 min (~25 min impl + tests, ~8 min deploy + smoke, ~5 min summary)
- **Tasks:** 4 of 4 (Task 1 read-only verification; Tasks 2-3 TDD red/green; Task 4 deploy)
- **Files created:** 4 (`index.ts` + `deno.json` × 2)
- **Files modified:** 2 (`index.test.ts` × 2 — scaffold → real tests)
- **Tests:** 14 Deno tests, 14 passing (7 admin-impersonate, 7 admin-stripe-action)
- **Edge Functions deployed:** 2 ACTIVE @ v1 on `ytnsipxxmzgaebkqmokp`

## Accomplishments

### admin-impersonate (ADMIN-03 / D-05)

- **Option A primary implementation** locked in per A1 PROBE PASS (336ms propagation; see 22-01 SUMMARY § Decisions Made #3):
  1. is_staff re-check inside the function body (gateway `verify_jwt=true` only confirms identity)
  2. self-guard (`target_user_id === callerId` → 400 `cannot_impersonate_self`)
  3. admin-guard (target's `profiles.is_staff = true` → 400 `cannot_impersonate_admin`)
  4. `admin.auth.admin.updateUserById(targetId, { app_metadata: { impersonator_id: callerId, impersonation_exp: now+30min } })`
  5. `admin.auth.admin.generateLink({ type: 'magiclink', email: targetEmail })` → returns `action_link`
  6. Inline `audit_logs` insert via service-role (bypasses RLS) with `action='impersonate_start'`, `impersonator_id`, `target_user_id`, `user_id_hash=sha256(callerId)`
- **End-impersonation** (`action='end'`) is idempotent: reads current `app_metadata.impersonator_id` first; no-op (no `updateUserById`, no audit row) when already null.
- **Best-effort rollback**: if `generateLink` fails after `updateUserById` succeeds, we immediately re-call `updateUserById` to clear the app_metadata write — prevents leaving the target half-impersonated.
- **Lazy admin singleton + Proxy** (analog: `affiliate-payout/index.ts:67-88` — reused verbatim) so Deno tests can stub the admin client AFTER importing the module.

### admin-stripe-action (ADMIN-04 / D-05)

- **Three discriminated-union operations** with shared is_staff gate + per-op validation:
  - `refund`: `stripe.refunds.create({charge, amount, reason: 'requested_by_customer', metadata: {admin_id, target_user_id}}, {idempotencyKey: 'refund-<charge>-<amount_cents>'})` → `admin_log_refund` RPC → `lifecycle-transactional` invoke with `template='receipt'`.
  - `cancel`: `stripe.subscriptions.update(sub_id, {cancel_at_period_end: true})` → `admin_log_subscription_canceled` RPC. No receipt email.
  - `comp`: `stripe.subscriptions.update(sub_id, {trial_end: now+comp_days*86400, proration_behavior: 'none'})` → `admin_log_subscription_comped` RPC.
- **PII-safe error sanitization** (T-22-23 mitigation): Stripe errors caught, `.code` extracted via `/^[a-z_][a-z0-9_]*$/i` whitelist (fallback `.type`, then `'unknown_error'`), wrapped as `{error: 'stripe_<code>'}`. Raw `.message` NEVER appears in response body. **T6 test explicitly asserts** a deliberate secret string in the Stripe error message does NOT appear in the HTTP response body.
- **Audit-on-success only** (T-22-22 accept-and-trace): admin_log_* RPC fires ONLY after Stripe succeeds. On Stripe error → 502 returned + no audit row + no receipt invoke. Webhook reconciliation catches the missed row via `invoice.refunded` events from Phase 14.
- **Stripe pin** matches Phase 14/19 lock: `esm.sh/stripe@19?target=denonext` + `apiVersion: '2026-04-22.dahlia'`.
- **Idempotency key shape** `refund-<charge>-<amount_cents>` (T-22-25 lock): same args dedupe in Stripe; differing amounts get distinct keys. **T7 test** asserts the key is byte-identical across two independent invocations with the same charge+amount.

## Task Commits

Each task committed atomically on the `worktree-agent-a438ab412abfcafd0` branch:

1. **Task 1: Verify Wave 0 prerequisites + A1 PROBE verdict** — no commit (read-only verification). Wave 0 file presence + A1 PROBE PASS verdict confirmed. Live `supabase db query --linked` enum check skipped as redundant (22-01 SUMMARY already confirmed all 16 migrations live + 5/5 verification queries PASS).
2. **Task 2 RED: admin-impersonate failing tests** — `9f5ff31` (test)
3. **Task 2 GREEN: admin-impersonate impl** — `cc89ca6` (feat)
4. **Task 3 RED: admin-stripe-action failing tests** — `521b1ee` (test)
5. **Task 3 GREEN: admin-stripe-action impl** — `a08ba5f` (feat)
6. **Task 4: Deploy** — no commit (deploy-only; `supabase/.temp/` is gitignored). Both Edge Functions deployed via Supabase CLI to `ytnsipxxmzgaebkqmokp`.

## Verification

### Deno test results

```
admin-impersonate/index.test.ts:    ok | 7 passed | 0 failed
admin-stripe-action/index.test.ts:  ok | 7 passed | 0 failed
```

Both run via `~/.deno/bin/deno test --allow-all`.

### Deployed Edge Functions

```
6eb13c5a-4447-4896-881b-178e9666d948 | admin-impersonate   | ACTIVE | v1 | 2026-05-16 06:32:14
d4131c56-1d77-4bfa-907c-e0a92f05b6d4 | admin-stripe-action | ACTIVE | v1 | 2026-05-16 06:32:20
```

### Smoke probe (gateway verify_jwt=true)

```
$ curl -X POST -H "Authorization: Bearer invalid-token" \
  https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/admin-impersonate \
  -d '{"target_user_id":"...","action":"start"}'
401 {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}
```

Gateway rejects invalid bearer with 401 BEFORE the function body runs — confirms `verify_jwt=true` is wired. A real-user smoke (non-staff JWT → 403) is deferred to plan 22-06 when the admin members table ships the UI invoker.

## Decisions Made

(All extracted to frontmatter `key-decisions` for STATE.md harvest.)

The most load-bearing decisions:
1. **A1 PROBE PASS unlocked Option A** — `admin.updateUserById({app_metadata})` + `generateLink('magiclink')`. Custom Access Token Hook fallback branch and `IMPERSONATION_JWT_SIGNING_KEY` Vault secret NOT shipped.
2. **Inline audit_logs INSERT for impersonate_start/end** — no dedicated RPC needed; service-role bypasses RLS. Stripe-action path uses the migration-15 RPCs because those need consistent `app.suppress_audit` GUC handling.
3. **Refund idempotency key includes amount_cents** — same charge + same amount returns the same Stripe refund (intended dedupe per T-22-25); same charge + different amount gets a distinct key (intended differentiation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] First two Write tool calls landed in main repo, not worktree**
- **Found during:** Task 2 RED (after first Write of `admin-impersonate/index.test.ts`)
- **Issue:** Absolute paths I used in the first two Write calls referenced `/Users/karstenhaldan/minisite/supabase/functions/...` (main repo) instead of the worktree path `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a438ab412abfcafd0/supabase/functions/...`. The file landed correctly content-wise but in the wrong physical location — the same trap as Phase 19 19-03/19-08 (per `reference_worktree_base_drift_recovery.md`).
- **Fix:** Detected via `wc -l` comparison (worktree had 19-line scaffold; main had 323-line written content). Recovery: `cp` the file from main into the worktree, then `git -C /Users/karstenhaldan/minisite checkout -- <file>` to revert the main-repo accidental modification. From that point onward, I disciplined myself to verify file landing location after every Write and stayed inside the worktree absolute-path tree.
- **Files affected:** `supabase/functions/admin-impersonate/index.test.ts` (recovered to worktree); main repo file reverted.
- **Verification:** Post-recovery `wc -l` showed the correct 323-line file in worktree and 19-line scaffold in main repo. All subsequent Write calls used the canonical worktree path. Final `git status` clean.

**2. [Rule 1 - Bug] Initial test UUID fixtures used `'admin-uuid-1111'`-style placeholders that fail UUID_RE**
- **Found during:** Task 2 GREEN test run (6/7 tests failed)
- **Issue:** Production code rightly validates `target_user_id` against `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. My initial test fixtures used readable placeholders like `'admin-uuid-1111'` which fail the regex → all happy-path tests returned 400 `invalid_target_user_id` instead of the expected status codes.
- **Fix:** Replaced fixture IDs with real UUIDv4 strings (`11111111-1111-4111-8111-111111111111`, `22222222-2222-4222-8222-222222222222`, `33333333-3333-4333-8333-333333333333`) via three Edit `replace_all` calls. Pre-baked the same UUIDv4 fixtures into the admin-stripe-action test from the start to avoid repeating the mistake.
- **Files modified:** `supabase/functions/admin-impersonate/index.test.ts`
- **Verification:** All 7 admin-impersonate tests pass after the fix; admin-stripe-action tests pass on first run with the pre-baked UUID fixtures.

**Total deviations:** 2 auto-fixed (1 blocking — worktree write location, 1 bug — invalid test fixtures). No scope creep; both adjustments were workflow/test-infra corrections.

## Issues Encountered

- **Deno not on PATH:** `which deno` returned not-found; binary lives at `~/.deno/bin/deno`. Used the explicit path for all test invocations. Not a project bug — this is the standard Deno install location on macOS and the plan's verify command `cd supabase/functions && deno test` would also fail without PATH setup. (Recording for future executors: `~/.deno/bin/deno` is the canonical binary location in this dev environment.)
- **`supabase/.temp/` not in worktree by default:** `git worktree add` doesn't copy gitignored `.temp/` (per `reference_supabase_worktree_temp_state.md`). Copied from main repo before deploy. Standard worktree+Supabase quirk.
- **Plan's automated verify regex `ok \\| [1-9]` doesn't grep clean against ANSI-colored Deno output:** The summary line is `ok | 7 passed | 0 failed` with ANSI escapes between `ok` and `|`. The intent (test count > 0) is met (14 passing total) but the literal grep pattern doesn't match. Not a deviation — just noting the verify command in the plan would emit a false-negative if used verbatim in CI without `--no-color` or a colorless grep. Suggest the plan-checker pattern be `passed \| 0 failed` going forward.

## User Setup Required

**None.** A1 PROBE PASS means no new vendor pass is needed for impersonation — no Vault secret, no Custom Access Token Hook deploy. Phase 14's `STRIPE_SECRET_KEY` Function secret is already in place (Phase 19 also uses it).

The pending Vault secret `CANCEL_DELETION_HMAC_KEY` from 22-01 SUMMARY is unrelated to plan 22-03; that's a 22-05 prerequisite.

## Next Phase Readiness

- **Plan 22-06 (admin members table):** can now wire the `Impersonate` per-row action to `POST /functions/v1/admin-impersonate { action: 'start', target_user_id }` and follow the returned `action_link`.
- **Plan 22-07 (admin actions modal):** can wire Refund/Cancel/Comp modals to `POST /functions/v1/admin-stripe-action` with the appropriate discriminated-union body. UI must validate refund `amount <= charge.amount` client-side (T-22-21 belt-and-suspenders; Stripe also rejects on the server).
- **Plan 22-09 (impersonation banner):** `useImpersonation` hook reads `app_metadata.impersonator_id` + `app_metadata.impersonation_exp` from the current JWT. When the admin's browser follows the `action_link`, the resulting session JWT carries both claims (A1 PROBE PASS verified). The banner mounts at AppShell root + ends impersonation via `POST /functions/v1/admin-impersonate { action: 'end', target_user_id }`.
- **RLS write-deny enforcement:** the 51 deny-write policies from 22-01 File 12 read `request.jwt.claims #>> '{app_metadata,impersonator_id}'`. Any subsequent REST call from the impersonated session that hits one of the 17 covered tables will be blocked — no code changes needed in 22-03 to enforce read-only.

## Threat Flags

(None — no net-new threat surface introduced beyond what's already documented in the plan's `<threat_model>`. The 8 threats T-22-18 through T-22-25 cover the full scope of both Functions; all `mitigate`-dispositioned ones have implementations in code:)

| Threat ID | Mitigation In Code |
|-----------|--------------------|
| T-22-18 | is_staff re-check in both Fn bodies (admin-impersonate.ts line ~159; admin-stripe-action.ts line ~233) |
| T-22-19 | self-guard + admin-guard in admin-impersonate (lines ~165, ~177) |
| T-22-20 | impersonation_exp written to app_metadata; Plan 22-09 owns the JWT exp claim read |
| T-22-21 | Stripe API rejects natively; Plan 22-07 owns client-side max-amount validation |
| T-22-22 | accept disposition — implemented as "log RPC error to console, continue 200 to caller; webhook reconciliation owns audit row recovery" |
| T-22-23 | stripeErrorCode() whitelist + jsonError(502, 'stripe_<code>'); T6 test asserts no leak |
| T-22-24 | A1 PROBE PASS makes this branch unreachable; primary impl ships only |
| T-22-25 | accept disposition — idempotency_key includes amount; same args dedupe (intended) |

## Self-Check: PASSED

All claimed artifacts verified to exist:

- `supabase/functions/admin-impersonate/index.ts` (320 lines, exports `__internal.handle` + `__internal.setAdminForTest`)
- `supabase/functions/admin-impersonate/deno.json` (14 lines, copied verbatim from affiliate-payout)
- `supabase/functions/admin-impersonate/index.test.ts` (323 lines, 7 Deno tests)
- `supabase/functions/admin-stripe-action/index.ts` (378 lines, exports `__internal.handle` + setStripeForTest/setAdminForTest)
- `supabase/functions/admin-stripe-action/deno.json` (14 lines, copied verbatim from affiliate-payout)
- `supabase/functions/admin-stripe-action/index.test.ts` (378 lines, 7 Deno tests)
- All 4 task commits present in `git log --oneline`: `9f5ff31`, `cc89ca6`, `521b1ee`, `a08ba5f`
- Both Edge Functions ACTIVE @ v1 on remote project `ytnsipxxmzgaebkqmokp` (confirmed via `supabase functions list`)
- 14/14 Deno tests pass on `deno test --allow-all`
- Smoke probe via curl returned 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` (gateway verify_jwt active)

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Plan: 03 — Admin Edge Functions (impersonate + Stripe action)*
*Completed: 2026-05-16*
