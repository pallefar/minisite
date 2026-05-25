---
phase: 29-org-subscriptions-per-patient-metered-billing
plan: "05"
subsystem: api
tags: [edge-function, deno, magic-link, resend, invites, secdef, two-phase, anti-enumeration]

# Dependency graph
requires:
  - phase: 29-02
    provides: "3 SECDEF RPCs: send_org_patient_invite, accept_org_patient_invite_preview, accept_org_patient_invite + org_patient_invites table"
  - phase: 25-hipaa-audit-hardening-vendor-baa-chain
    provides: "D-12 non-PHI email requirement; D-03 email-router pattern (direct Resend used as email-router.ts not yet created)"
  - phase: 29-03
    provides: "_shared/sentry.ts captureMessage (added to worktree as Rule 2 fix)"
provides:
  - "supabase/functions/clinic-patient-invite/index.ts — 3-route Edge Function deployed ACTIVE v1"
  - "supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts — 10 deno tests"
  - "src/lib/clinic-patient-invite.ts — browser-side typed helper: sendPatientInvite, previewInvite, acceptInvite"
  - "captureMessage export in _shared/sentry.ts (Rule 2 addition)"
affects: [29-06, 29-07, ORG-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-08 two-phase accept: SECDEF RPC commits atomically first, admin.generateLink fires post-commit (best-effort)"
    - "W-1 anti-enumeration: identical 200 for /send regardless of email existence; identical 404 for invalid/expired/used tokens in /preview"
    - "Vendor-gated email dispatch: RESEND_API_KEY absent → warn + no-op (invites still persist)"
    - "Exported handler function for Deno testability + Deno.serve(handler)"
    - "Dynamic import in test file to ensure env stubs are set before module-level health check runs"

key-files:
  created:
    - supabase/functions/clinic-patient-invite/index.ts
    - supabase/functions/clinic-patient-invite/cors.ts
    - supabase/functions/clinic-patient-invite/deno.json
    - supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts
    - leanshot/src/lib/clinic-patient-invite.ts
  modified:
    - supabase/functions/_shared/sentry.ts

key-decisions:
  - "D-08 two-phase (LOCKED): RPC commits first, generateLink post-commit best-effort; on failure invite stays accepted + Sentry warning + /login?hint=recover redirect"
  - "email-router.ts does not exist — direct Resend dispatch used (identical to Phase 28 clinic-org-invite blueprint); Rule 3 deviation documented"
  - "acceptInvite browser helper returns special union type for magic_link_failed case to preserve invite_accepted:true context for caller"
  - "Dynamic import in test file required: Deno static imports are hoisted before Deno.env.set() calls; dynamic import ensures env stubs are set before module-level health check"

patterns-established:
  - "Test isolation: Deno.env.set + fetch mock + dynamic import pattern for Edge Function tests"
  - "Two-phase D-08: RPC-first commit + best-effort magic-link generation"

requirements-completed: [ORG-10]

# Metrics
duration: 7min
completed: 2026-05-17
---

# Phase 29 Plan 05: clinic-patient-invite Edge Function Summary

**Three-route Edge Function (send+preview+accept) implementing D-08 two-phase patient consent invite with W-1 anti-enumeration, deployed ACTIVE; browser helper typed with discriminated-union Result<T>**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-17T18:03:52Z
- **Completed:** 2026-05-17T18:11:11Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `clinic-patient-invite` Edge Function with 3 routes deployed ACTIVE v1 to Supabase project ytnsipxxmzgaebkqmokp
- 10 deno tests pass: W-1 x2, auth gate, PHI lint, preview 404 anti-enumeration x2, preview happy, two-phase accept x2, startup health check
- Browser-side helper `src/lib/clinic-patient-invite.ts` with typed discriminated-union InviteResult<T>; TypeScript compiles cleanly

## Verification Evidence

```
deno test supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts --allow-env --allow-net --allow-read
running 10 tests from ./...
Test 1 — W-1 send: new email returns {ok: true, invite_id} ... ok (2ms)
Test 2 — W-1 send: existing email returns identical {ok: true, invite_id} shape ... ok (0ms)
Test 3 — Auth gate: /send without Authorization returns 401 ... ok (0ms)
Test 4 — PHI lint: no PHI keywords in index.ts email template ... ok (0ms)
Test 5 — Preview: invalid token returns 404 invite_not_found ... ok (0ms)
Test 6 — Preview: expired token returns identical 404 body (anti-enumeration) ... ok (0ms)
Test 7 — Preview: valid pending token returns org info ... ok (0ms)
Test 8 — Accept two-phase: RPC commits first; generateLink failure ... ok (0ms)
Test 8b — Accept two-phase: if RPC fails, generateLink is NOT called ... ok (0ms)
Test 9 — Startup health check: handler callable ... ok (0ms)
ok | 10 passed | 0 failed (9ms)
```

W-1 invariant proof: Tests 1+2 prove identical `{ok:true, invite_id}` shape for new vs existing email.
Two-phase proof: Test 8 verifies `rpc` appears in callOrder before `generateLink`; Test 8b verifies generateLink NOT called when RPC fails.
Deploy: `supabase functions list` → `clinic-patient-invite | ACTIVE | v1 | 2026-05-17 18:09:22`

## Task Commits

1. **Task 1: Edge Function + deno tests + deploy** - `a39f134` (feat)
2. **Task 2: Browser helper + SUMMARY** - (this commit)

## Files Created/Modified
- `supabase/functions/clinic-patient-invite/index.ts` — 3-route Edge Function (send/preview/accept), exported handler for testability
- `supabase/functions/clinic-patient-invite/cors.ts` — CORS headers module
- `supabase/functions/clinic-patient-invite/deno.json` — Deno task config (copied from clinic-org-invite)
- `supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts` — 10 deno tests
- `leanshot/src/lib/clinic-patient-invite.ts` — Browser helper with sendPatientInvite/previewInvite/acceptInvite
- `supabase/functions/_shared/sentry.ts` — captureMessage export added (Rule 2)

## Decisions Made
- D-08 two-phase pattern (LOCKED): RPC commits all DB writes atomically first; `admin.auth.admin.generateLink` fires post-commit. On generateLink failure: invite stays accepted (DB is source of truth), Sentry captures warning, client redirected to `/login?email=<email>&hint=recover`.
- email-router.ts does not exist anywhere in the codebase — Phase 25 D-03 was planned but never implemented. Direct Resend dispatch (identical to Phase 28 clinic-org-invite blueprint) used instead. Non-PHI-only template enforced (PHI lint test passes).
- Browser helper `acceptInvite` returns a special union type for the `magic_link_failed` case to preserve `invite_accepted:true` context, enabling callers to redirect to the recovery login path.
- Dynamic import (`await import('./index.ts')`) required in test file because Deno static imports are hoisted before `Deno.env.set()` calls execute, so module-level health check (reading `Deno.env.get('SUPABASE_URL')`) would fail with empty string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] captureMessage added to _shared/sentry.ts**
- **Found during:** Task 1 (Edge Function authoring)
- **Issue:** Plan imports `Sentry.captureMessage(...)` in the /accept route; the worktree's sentry.ts (forked from Phase 28 baseline) only exports `captureException`. The 29-03 captureMessage addition exists on main but not in this worktree.
- **Fix:** Added `captureMessage` export to `_shared/sentry.ts` matching the 29-03 implementation exactly.
- **Files modified:** `supabase/functions/_shared/sentry.ts`
- **Verification:** Deno test imports sentry.ts via index.ts; no import errors; Tests 8/8b pass.
- **Committed in:** a39f134 (Task 1 commit)

**2. [Rule 3 - Blocking] email-router.ts does not exist; direct Resend dispatch used**
- **Found during:** Task 1 (Edge Function authoring)
- **Issue:** Plan and CONTEXT reference `_shared/email-router.ts` (Phase 25 D-03) for `sendEmail({phi:false,...})`. The file does not exist anywhere in the codebase or git history.
- **Fix:** Implemented direct Resend dispatch in `sendPatientInviteEmail()` — identical pattern to Phase 28 `clinic-org-invite/index.ts` (the blueprint). Non-PHI constraint enforced: email body contains only invite URL + expiry (no org_name, patient_name, diagnosis, or dose values). PHI lint test (#4) validates this at source level.
- **Files modified:** `supabase/functions/clinic-patient-invite/index.ts` (self-contained email function)
- **Verification:** Test 4 (PHI lint) passes; no phi keywords in sendPatientInviteEmail body.
- **Committed in:** a39f134 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing critical, 1 Rule 3 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep. email-router.ts gap deferred to a future plan that should create it (Phase 25 D-03 remains unimplemented).

## Known Stubs

None — all three routes are fully implemented and deployed.

## Threat Flags

None — all threat surfaces were already declared in the plan's `<threat_model>` (T-29-05-01 through T-29-05-07). No new surfaces introduced.

## Issues Encountered
- Deno test isolation: static imports are hoisted before `Deno.env.set()` calls; module-level `SUPABASE_URL` read as empty string causing `supabaseUrl is required` error. Fixed by switching to dynamic `await import('./index.ts')` after env stubs are set.
- supabase-js `auth.admin.generateLink` call path: confirmed via Supabase v2 API that the URL is `/auth/v1/admin/generate_link`. Mock interceptor matches this path.

## Next Phase Readiness
- Plan 29-06 (Billing UI) has typed browser helpers ready: `sendPatientInvite`, `previewInvite`, `acceptInvite`
- Edge Function deployed and ACTIVE — ready for integration
- Plan 29-07 (secrets management checkpoint) can verify RESEND_API_KEY / RESEND_FROM secrets are set for production email dispatch

---
*Phase: 29-org-subscriptions-per-patient-metered-billing*
*Completed: 2026-05-17*
