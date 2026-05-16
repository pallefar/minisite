---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 11
subsystem: ui
tags: [react, dsar, gdpr, email-preferences, supabase, pg_cron, vault, realtime]

requires:
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 01
    provides: dsar_requests table + dsar_request_status enum + dsar-exports storage bucket
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 02
    provides: lifecycle-preference-update Edge Function (HTTP-invoked with user JWT, UPSERTs consent_records.email_preferences JSONB)
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 04
    provides: create_dsar_request RPC (SECURITY DEFINER; one-pending-row guard) + dsar-export Edge Function (9-step orchestrator with hash-pseudonymized affiliate converter emails)
  - phase: 19
    provides: vault.decrypted_secrets row name='service_role_key' (deferred vendor pass — same key already gated by lifecycle crons + monthly-payout cron)
  - phase: 9
    provides: lifecycle clinic-invite/resend.ts direct-HTTPS pattern (transactional emails — out of plan 22-11 scope)

provides:
  - User-facing DSAR portal at /settings/privacy/dsar (DsarPortalPage + DsarStatusCard)
  - dsar-export-client.ts — typed wrapper around create_dsar_request RPC, dsar_requests SELECT, Supabase Realtime channel, and DsarError discriminated union
  - Email preference center at /settings/email-preferences (6 categories: Transactional locked + 5 toggleable; Affiliate row affiliates-table-gated)
  - SettingsPage NAV extension — 2 link-out entries that navigate to the dedicated sub-pages via LINK_OUT_NAV map
  - migration 20270601000021 — 5-min `dsar-export-tick` pg_cron that picks up `pending` DSAR requests and POSTs to dsar-export Fn (Vault-gated; graceful no-op when service_role_key absent)
  - dsar-pdf-render.ts client-side placeholder (v1.3 seam; throws at v1.2 because shipping path is server-side)

affects:
  - 22-12 (final wiring) — must lazy-mount DsarPortalPage + EmailPreferencesPage as React.lazy chunks in App.tsx selectView for `/settings/privacy/dsar` + `/settings/email-preferences` pathnames
  - 22-12 verification — bundle-budget CI guard should treat both new lazy chunks as ON-DEMAND (never on index static graph); follow Phase 5 reference pattern
  - Phase 22 close-out — Vault service_role_key vendor pass (T-22-66) gates the cron tick activation (cron silently no-ops until row exists; verified live `dsar-export-tick` registered + Vault row STILL absent on `ytnsipxxmzgaebkqmokp`)

tech-stack:
  added: []
  patterns:
    - "DsarError discriminated-union client error contract (already_pending / not_authenticated / forbidden / unknown) — reusable shape for any future SECURITY DEFINER RPC with named SQLSTATE returns"
    - "Realtime channel + setInterval poll fallback in DsarPortalPage — defends against blocked-WebSocket networks (jsdom tests + restrictive corporate networks)"
    - "LINK_OUT_NAV map in SettingsPage — partial Record<Section, href> intercepts setSection clicks for cross-route nav entries without forcing every existing section to opt into a discriminated NAV item type"
    - "Cron tick that picks up rows from a status-machine table (`status='pending'` → POST to Edge Fn with row id) — generalizes the BL-11 conversions-confirm + W-3 payouts-materialize pattern from Phase 19"
    - "v1.3 placeholder module pattern — symbol exported + throws at runtime + doc-comment explains v1.3 fill-in contract (lets Wave-0 test scaffold imports resolve without shipping the v1.3 feature)"

key-files:
  created:
    - supabase/migrations/20270601000021_dsar_export_cron_tick.sql (89 lines — `dsar-export-tick` cron + Vault gating)
    - leanshot/src/lib/dsar/dsar-export-client.ts (162 lines — RPC + SELECT + Realtime wrappers + DsarError)
    - leanshot/src/lib/dsar/dsar-pdf-render.ts (78 lines — v1.3 placeholder)
    - leanshot/src/components/dsar/DsarPortalPage.tsx (293 lines — hero + confirmation modal + active status + history)
    - leanshot/src/components/dsar/DsarStatusCard.tsx (98 lines — 4-state badge + download / rejected branches + aria-live)
    - leanshot/src/components/dashboard/settings/EmailPreferencesPage.tsx (~220 lines — 6 categories + save → lifecycle-preference-update)
    - leanshot/src/components/dashboard/settings/EmailPreferencesPage.test.tsx (7 tests)
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (LINK_OUT_NAV map + 2 NAV entries + onClick interceptor; data-nav-id added)
    - leanshot/src/components/dashboard/settings/SettingsPage.test.tsx (3 new tests for 22-11 nav extensions)
    - leanshot/src/components/dsar/__tests__/DsarPortalPage.test.tsx (replaced 2 it.skip stubs with 10 green tests covering DsarPortalPage + DsarStatusCard)
    - leanshot/src/lib/dsar/__tests__/dsar-pdf-render.test.ts (replaced 2 it.skip stubs with 2 v1.3-seam tests)
    - leanshot/.planning/phases/22-…/deferred-items.md (5 new entries — items 5-9)

key-decisions:
  - "DSAR client-side path is RPC + cron orchestration, NOT direct Edge Fn invocation. The dsar-export Fn requires the service-role bearer (T-22-29 from plan 22-04), so user invocations would fail authentication. The cron tick (every 5 minutes, plan 22-11 migration 21) bridges the gap by picking up `pending` rows server-side with the Vault-stored service-role bearer."
  - "Client-side PDF render (`dsar-pdf-render.ts`) is a v1.3 seam — symbol exists, runtime throws at v1.2 — because shipping the actual jsPDF dynamic-import would expand the lazy bundle without delivering user-visible value (server-side render already ships the production PDF). Wave-0 test scaffold imports resolve; production code never invokes."
  - "Affiliate-row visibility on EmailPreferencesPage gates on an `affiliates`-table lookup (not on a JWT claim) — keeps the gate enforceable from the server contract that lifecycle Fns + the future P22 admin surface share. JWT custom claims would require coupling to the auth-hook system."
  - "DsarStatusCard download path mints a SHORT-LIVED (1-hour) signed URL client-side at click time rather than reusing the 7-day URL stored in `export_signed_url_expires_at`. The 7-day URL is what the user receives in the dsar_ready email; this in-page URL is for the convenience flow where the user opens the portal mid-window. Defense-in-depth (short TTL on a fresh URL prevents the in-page render from accidentally exposing a long-lived URL via screen-recording or screenshot)."
  - "SettingsPage LINK_OUT_NAV map approach over building a discriminated `Section | LinkOut` NAV-item union — preserves the existing 11-entry NAV map shape (existing tests, screen-reader nav order, mobile horizontal scroll) and confines the routing concern to one map + one if-branch in the click handler."
  - "Cron schedule is `*/5 * * * *` (5 min) chosen as the sweet spot: UI-SPEC promises 24h normal-case turnaround, so latency budget is generous; pg_cron job density on the instance (parallel with the existing 15-min behavior-triggered + 4-hour welcome-series + daily retention crons) leaves plenty of headroom; LIMIT 10 per tick caps the per-tick fan-out so a backlog doesn't trigger pathological Edge-Fn parallelism."

patterns-established:
  - "DsarError discriminated-union mapping from Postgres SQLSTATE — reusable for any RPC that raises named exceptions (P0008, 28000, 42501) and wants the client to branch on the error class without parsing message strings"
  - "Cron-tick pattern for status-machine table → Edge Fn: SELECT pending rows + iterate + POST per-row with Vault bearer + graceful no-op when Vault row absent. Generalizes Phase 19's confirm/materialize crons + adds the per-row HTTP-fan-out variant. Apply to any future async server-cascade that user actions enqueue."
  - "Link-out NAV entry pattern for SettingsPage extension — `LINK_OUT_NAV: Partial<Record<Section, string>>` + click interceptor. Keeps SettingsPage tests stable while letting Phase 22 cluster new sub-pages under existing menu order."

requirements-completed: [GDPR-03, ON-03]

duration: 45min
completed: 2026-05-16
---

# Phase 22 Plan 22-11: DSAR Portal + Email Preference Center Summary

**GDPR-03 user-facing surface complete (DSAR portal + 5-min Vault-gated cron tick) + ON-03 self-serve email preference center; SettingsPage NAV extended with 2 link-out entries; 33/33 vitest tests green across 5 files; `tsc -b` + `eslint` clean on plan-touched files; migration 21 live on `ytnsipxxmzgaebkqmokp` (cron job `dsar-export-tick` confirmed registered).**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-16T08:41Z
- **Completed:** 2026-05-16T08:53Z
- **Tasks:** 3 of 3 (Task 1 cron migration · Task 2 DSAR portal · Task 3 EmailPreferencesPage + SettingsPage nav)
- **Files created:** 7 (1 SQL migration + 4 TSX/TS source + 2 test files)
- **Files modified:** 3 (SettingsPage.tsx + 2 Wave-0 test stubs replaced with green tests)
- **Lines added:** ~1,556

## Task Commits

| Task | Description                                                         | Commit  |
| ---- | ------------------------------------------------------------------- | ------- |
| 1    | feat(22-11): schedule dsar-export 5-min cron tick (GDPR-03)         | e8a0115 |
| 2    | feat(22-11): DSAR portal — DsarPortalPage + DsarStatusCard + client | 45a1f59 |
| 3    | feat(22-11): email preference center + SettingsPage nav extension   | 04e2ab3 |
| 3a   | chore(22-11): log 4 sibling-plan test-load failures                 | 779b0e5 |
| 3b   | style(22-11): apply eslint import-x/order auto-fix                  | 20af6df |

## Verification

- **Plan task 1 verify command** (migration push dry-run + no skipping): PASS
  - `npx supabase db push --linked --dry-run` showed `20270601000021_dsar_export_cron_tick.sql` in the migrations-would-push list with NO `Skipping migration` warnings (filename matches the strict 14-digit regex per `reference_supabase_migration_filename_regex.md`).
  - Live push: APPLIED (`pg_cron` extension already exists; NOTICE only).
  - Cron job confirmed live via `supabase db query --linked`: `jobname='dsar-export-tick', schedule='*/5 * * * *'`.
- **Plan task 2 verify command**: `npx vitest run DsarPortalPage dsar-pdf-render` → **12 tests passed (2 files)**.
- **Plan task 3 verify command**: `npx vitest run EmailPreferencesPage` → **7 tests passed**. Plus 3 SettingsPage nav tests = **10 task-3 tests passed**.
- **Aggregate plan 22-11 test run**: 33 passed / 0 failed / 0 skipped across 5 files.
- **Full vitest run**: 1122 passed / 43 skipped / 0 failed; 4 test files fail to LOAD (vite import resolution) — all pre-existing Wave-0 scaffolds owned by sibling plans (logged to `deferred-items.md` item 5). My new code did not introduce these regressions.
- **`tsc -b`**: clean (no output, exit 0).
- **`eslint`** on plan-22-11 files: clean (after task 3b autofix commit).

## Decisions Made

(See `key-decisions` in frontmatter.)

## Deviations from Plan

### Plan-acknowledged adjustments

1. **[Rule 3 — Blocking issue] Path-drift recovery on Task 1 migration write**
   - **Found during:** Task 1
   - **Issue:** The first Write of the migration file used the absolute path `/Users/karstenhaldan/minisite/supabase/...`, which resolved to the MAIN repo, not the worktree (the well-known worktree-absolute-path trap per `reference_worktree_base_drift_recovery.md`).
   - **Fix:** `cp` from main → worktree, then `git add` from worktree root. Subsequent writes used worktree-relative paths only.
   - **Files modified:** `supabase/migrations/20270601000021_dsar_export_cron_tick.sql` (copied)
   - **Commit:** e8a0115 (correctly landed in the worktree branch)

2. **[Rule 1 — Bug] Test 3 + Test 4 initial failure (mock queue ordering)**
   - **Found during:** Task 2 test run
   - **Issue:** The `mockResolvedValueOnce` queue for `dsar_requests.limit()` was being consumed by the initial mount call (refresh), not the post-RPC reconcile call as intended. Result: activeRequest started as `pending` → "Export my data" CTA became disabled → modal never opened → assertions on "Start export" failed.
   - **Fix:** Added an `await waitFor()` between render and click to drain the initial mount call FIRST, then queued the reconcile `mockResolvedValueOnce` AFTER the user.click on Hero CTA.
   - **Files modified:** `leanshot/src/components/dsar/__tests__/DsarPortalPage.test.tsx`
   - **Commit:** 45a1f59 (final test file is green; the fix happened pre-commit)

### Pre-existing items NOT fixed (per scope boundary)

3. **4 Wave-0 scaffold test files fail to load** — sibling Wave-1/2 plans own
   `@/components/impersonation/ImpersonationBanner`, `@/hooks/useImpersonationReadOnly`,
   `@/components/soft-delete/SoftDeleteCountdownBanner`, and `@/components/admin/members/RefundModal`.
   None of my changes touched those files; vite transform fails at import resolution time so
   the `it.skip` bodies never execute. Logged to `deferred-items.md` item 5.

## Vendor Passes Still Open (informational)

- **Vault `service_role_key` row** — gates DSAR cron tick (T-22-66 accepted). Also gates Phase 19 monthly-payout cron + Phase 22 lifecycle crons. Once loaded, the next 5-min DSAR tick processes any backlog automatically.
- **Resend domain verify (`app.leanshot.app`)** — gates the lifecycle-transactional email branch of the dsar-export Fn (step 9 → `dsar_ready` template send). Cascade still completes server-side; user just doesn't receive the email until verify. Owned by Phase 22 close-out.
- **PostHog `POSTHOG_PERSONAL_API_KEY`** — gates the optional `bundle.posthog_events` arm of dsar-export bundle assembly. Bundle still ships without it (null + console.warn). Out of plan 22-11 scope.

## Threat Model Compliance

Per the plan `<threat_model>`:

| Threat ID | Disposition | Verification |
|-----------|-------------|--------------|
| T-22-62   | mitigate    | `create_dsar_request` RPC raises `already_pending` (P0008); DsarPortalPage catches `DsarError('already_pending')` and surfaces friendly info-toast (not generic error) — Test 4 covers. |
| T-22-63   | mitigate    | Signed URL only stored in `dsar_requests.export_path` (server-side); client mints its own short-lived (1-hour) URL via `supabase.storage.from('dsar-exports').createSignedUrl(path, 3600)` at click time. NEVER `console.log`'d. |
| T-22-64   | mitigate    | Plan 22-02 owns the lifecycle Fns' `consent_records.email_preferences` SELECT before send; plan 22-11 ships the WRITER (POST to lifecycle-preference-update). No 22-11-owned code path bypasses. |
| T-22-65   | mitigate    | EmailPreferencesPage gates the Affiliate row on a `from('affiliates').eq('user_id', auth.uid())` lookup; RLS on `affiliates` prevents cross-user reads. Verified via Test 3 fixture: affiliate row hidden by default; visible only when `maybeSingle()` returns `{id: 'aff-id'}`. |
| T-22-66   | accept      | DSAR cron tick gracefully no-ops on Vault key absent (DO block early-return); documented in migration header + deferred-items.md item 6. |

## Known Stubs

- `src/lib/dsar/dsar-pdf-render.ts` — v1.3 seam; export exists, runtime throws at v1.2. Intentional per plan `must_haves` bullet 9 ("DSAR PDF render client-side path REMOVED (server-side only per plan 22-04 + Pitfall 10)").

## Threat Flags

(None — no new security-relevant surface beyond the plan's documented threat register.)

## Self-Check: PASSED

- `[x]` `supabase/migrations/20270601000021_dsar_export_cron_tick.sql` exists
- `[x]` `leanshot/src/lib/dsar/dsar-export-client.ts` exists
- `[x]` `leanshot/src/lib/dsar/dsar-pdf-render.ts` exists
- `[x]` `leanshot/src/components/dsar/DsarPortalPage.tsx` exists
- `[x]` `leanshot/src/components/dsar/DsarStatusCard.tsx` exists
- `[x]` `leanshot/src/components/dashboard/settings/EmailPreferencesPage.tsx` exists
- `[x]` `leanshot/src/components/dashboard/settings/EmailPreferencesPage.test.tsx` exists
- `[x]` `leanshot/src/components/dashboard/settings/SettingsPage.tsx` has `LINK_OUT_NAV` constant + 2 new NAV entries
- `[x]` Commit `e8a0115` exists (Task 1)
- `[x]` Commit `45a1f59` exists (Task 2)
- `[x]` Commit `04e2ab3` exists (Task 3)
- `[x]` Commit `779b0e5` exists (deferred-items log)
- `[x]` Commit `20af6df` exists (lint autofix)
- `[x]` All plan 22-11 vitest tests pass (33/33)
- `[x]` Cron job `dsar-export-tick` registered live on `ytnsipxxmzgaebkqmokp`
