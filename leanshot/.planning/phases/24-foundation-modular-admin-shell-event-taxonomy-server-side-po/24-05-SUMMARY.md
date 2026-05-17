---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: "05"
status: COMPLETE
subsystem: admin-totp-mfa
tags: [admin, totp, mfa, security, rpc, edge-function, aal2, backup-codes]
dependency_graph:
  requires:
    - plan-24-01 (admin_backup_codes table, log_admin_action, is_admin_at_least, profiles.has_totp)
    - plan-24-03 (AdminLayout, AdminShell, SettingsModule stub)
  provides:
    - src/lib/admin/totp.ts (generateBackupCodes, enrollTotp, verifyTotp)
    - src/lib/supabase.ts assertAal2() + parseJwtAal()
    - SetupTotpPage component (TOTP enrollment + backup codes display)
    - StepUpTotpPage component (per-session aal2 step-up)
    - AdminLayout Pattern S1 dual-layer gate (has_totp + aal2)
    - SettingsModule augmented (MFA status + regenerate + self-reset)
    - supabase/migrations/20270601000033_admin_totp_rpcs.sql (4 SECURITY DEFINER RPCs)
    - supabase/functions/admin-reset-totp/ Edge Function
    - supabase/functions/_shared/posthog-server.ts (vendor-gated PostHog helper)
    - e2e/admin-mfa-enroll.spec.ts, e2e/admin-mfa-middleware.spec.ts
  affects:
    - src/components/admin/AdminLayout.tsx (Pattern S1 gates added)
    - src/components/admin/SettingsModule.tsx (MFA status + backup-code regen)
    - plan-24-06 (AuditLogModule sees reset_totp audit rows)
    - plan-25 (HIPAA posture — aal2 enforcement is a HIPAA control)
tech_stack:
  added:
    - Web Crypto HMAC + CSPRNG for backup code generation (browser-side)
    - PostgreSQL HMAC via hmac(code, pepper, 'sha256') with vault.decrypted_secrets
    - Supabase Auth mfa.enroll/challenge/verify APIs (factorType:'totp')
    - posthog-node@5.10.4 via npm: Deno specifier (posthog-server.ts)
  patterns:
    - Pattern S1 dual-layer (client React gate + SECURITY DEFINER DB layer)
    - TDD RED/GREEN for totp.ts + supabase.ts
    - Lazy admin singleton via Proxy (Deno Edge Functions)
    - vendor-gated send health-check (POSTHOG_PROJECT_KEY missing = no-op)
    - Vault BACKUP_CODE_PEPPER for server-side HMAC
key_files:
  created:
    - leanshot/src/lib/admin/totp.ts
    - leanshot/src/lib/admin/__tests__/totp.test.ts
    - leanshot/src/components/admin/SetupTotpPage.tsx
    - leanshot/src/components/admin/StepUpTotpPage.tsx
    - supabase/migrations/20270601000033_admin_totp_rpcs.sql
    - supabase/functions/admin-reset-totp/index.ts
    - supabase/functions/admin-reset-totp/admin-reset-totp.test.ts
    - supabase/functions/admin-reset-totp/deno.json
    - supabase/functions/_shared/posthog-server.ts
    - leanshot/e2e/admin-mfa-enroll.spec.ts
    - leanshot/e2e/admin-mfa-middleware.spec.ts
  modified:
    - leanshot/src/lib/supabase.ts (assertAal2 + parseJwtAal helpers added)
    - leanshot/src/components/admin/AdminLayout.tsx (Pattern S1 dual-layer gates)
    - leanshot/src/components/admin/SettingsModule.tsx (MFA status + regen + reset)
    - leanshot/.planning/deferred-tests.md (EG-30, EG-31 entries added)
decisions:
  - "hashBackupCode is server-side only (Postgres HMAC with vault.decrypted_secrets BACKUP_CODE_PEPPER); client never touches the pepper"
  - "NO middleware.ts — LeanShot is a Vite hash-route SPA; AdminLayout is the enforcement point. Documented in file header."
  - "posthog-server.ts created in this plan (Rule 3 deviation) because plan-24-04 may not have merged yet in parallel wave execution; file is byte-identical to plan-24-04's version"
  - "Migration renamed from 20260518000008 to 20270601000033 per milestone timestamp ordering convention (per phase notes)"
  - "auth.mfa_factors direct DELETE used in reset_totp RPC (no pg-callable mfa_remove_factor API in Supabase free tier)"
  - "BACKUP_CODE_PEPPER checkpoint AUTO-RESOLVED (uuid 469a745b-14ee-4d63-8af3-dad898d1ce65 provisioned by orchestrator)"
  - "T2 full enrollment e2e DEFERRED (needs otplib + live TOTP code from QR URI); T1 middleware gate test is env-gated HAS_LIVE"
metrics:
  duration: 11 minutes
  completed_date: "2026-05-17"
  tasks_completed: 6
  tasks_total: 6
  files_created: 11
  files_modified: 4
---

# Phase 24 Plan 05: Admin TOTP 2FA — End-to-End MFA Enforcement Summary

## One-liner

HIPAA-grade admin 2FA via Supabase Auth TOTP: enrollment page + per-session step-up + 10 server-side HMAC backup codes + superadmin reset RPC + Edge Function email notification + Pattern S1 dual-layer gate in AdminLayout.

## What Was Built

### Task 1: TOTP Client Helper + supabase.ts assertAal2 (TDD RED → GREEN)

- `src/lib/admin/totp.ts`: `generateBackupCodes(n)` (Web Crypto CSPRNG, `XXXX-XXXX-XXXX` format), `enrollTotp()` (wraps `supabase.auth.mfa.enroll`), `verifyTotp()` (challenge + verify flow).
- `src/lib/supabase.ts` augmented with `assertAal2()` (reads JWT `aal` claim from active session) + `parseJwtAal()` (internal JWT payload parser).
- 8 vitest tests pass (TDD RED committed as `fb98676`, GREEN as `73a7feb`).

### Task 2: SetupTotpPage + StepUpTotpPage + AdminLayout Gate + SettingsModule

- `SetupTotpPage.tsx`: auto-enrolls TOTP on mount, displays QR code data-URI, accepts 6-digit OTP, calls `issue_backup_codes` RPC on session upgrade, shows 10 backup codes once with copy-to-clipboard + save-confirmation gate, calls `set_has_totp_true` then triggers `onComplete`.
- `StepUpTotpPage.tsx`: lists enrolled TOTP factors, challenges + verifies, upgrades session to aal2, calls `onComplete`.
- `AdminLayout.tsx` augmented with Pattern S1 dual-layer gate:
  - Gate 1 (D-06): `has_totp === false` → render `<SetupTotpPage />` (hard-cut, no grace window).
  - Gate 2 (D-09): JWT `aal === 'aal1'` → render `<StepUpTotpPage />` (per-session step-up).
  - File header explicitly documents: **NO middleware.ts** (SPA hash-routing).
- `SettingsModule.tsx` augmented: enrolled MFA status display, "Regenerate backup codes" button, "Reset my 2FA" button (superadmin-only self-reset).

### Task 3: SQL Migration for TOTP RPCs

`supabase/migrations/20270601000033_admin_totp_rpcs.sql` — 4 SECURITY DEFINER functions:

| Function | Purpose |
|----------|---------|
| `issue_backup_codes()` | Requires aal2; `gen_random_bytes` 12-char codes; HMAC-SHA256 with `BACKUP_CODE_PEPPER` vault secret; deletes prior unconsumed; returns plaintext array |
| `consume_backup_code(p_code)` | Single-use enforcement via atomic `used_at` update |
| `set_has_totp_true()` | Requires aal2; sets `profiles.has_totp=true` for caller |
| `reset_totp(p_target_user_id)` | superadmin-only; deletes `auth.mfa_factors` TOTP rows; sets `has_totp=false`; calls `log_admin_action` audit write |

All with `set search_path = extensions, public, pg_temp` per migration gotchas.

### Task 4: admin-reset-totp Edge Function

- `supabase/functions/admin-reset-totp/index.ts`: superadmin gate (profiles.admin_role check), calls `reset_totp` RPC, generates magic link via `auth.admin.generateLink`, sends Resend email via `_shared/lifecycle-send.ts`, captures PostHog `admin_action/reset_totp` event, `shutdownPostHog()` in finally block.
- `admin-reset-totp.test.ts`: 3 Deno tests pass (T1: non-superadmin 403; T2: superadmin happy path; T3: error path).
- `supabase/functions/_shared/posthog-server.ts`: `captureServer` + `shutdownPostHog` (posthog-node@5.10.4, vendor-gated no-op).

### Task 5: e2e Specs

- `e2e/admin-mfa-enroll.spec.ts`: T1 (QR + OTP input visible for unenrolled admin) — env-gated `PLAYWRIGHT_RUN_ADMIN_MFA=1`; T2 full enrollment DEFERRED (EG-31).
- `e2e/admin-mfa-middleware.spec.ts`: T1 (has_totp=false → SetupTotpPage); T2 (has_totp=true + aal1 → StepUpTotpPage) — env-gated.
- `page.addInitScript` used for auth state seeding (not `goto + reload`).
- `deferred-tests.md` updated with EG-30/EG-31.

### Task 6: BACKUP_CODE_PEPPER Checkpoint

**AUTO-RESOLVED** — orchestrator provisioned the vault secret (uuid `469a745b-14ee-4d63-8af3-dad898d1ce65`) with `openssl rand -hex 32` value before plan execution.

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run src/lib/admin/__tests__/totp.test.ts` | 8/8 PASS |
| `vitest run src/lib/admin/__tests__/` | 22 pass, 10 skipped (env-gated) |
| `deno test admin-reset-totp.test.ts` | 3/3 PASS |
| `npm run build` | Exit 0; admin-bundle 36.87 kB gz (ceiling 60 kB gz — OK) |
| `npm run typecheck` | Clean (no errors) |
| `grep has_totp AdminLayout.tsx` | FOUND |
| `grep assertAal2 AdminLayout.tsx` | FOUND |

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 1 RED | fb98676 | test | Failing tests for TOTP helper |
| 1 GREEN | 73a7feb | feat | TOTP helper + assertAal2 |
| 2 | 05db4ca | feat | SetupTotpPage + StepUpTotpPage + AdminLayout gate + SettingsModule |
| 3 | e7c5a9e | feat | SQL migration for TOTP RPCs |
| 4 | a94b135 | feat | admin-reset-totp Edge Function + posthog-server.ts |
| 5 | 889a539 | feat | e2e specs for MFA enrollment + middleware redirect |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] posthog-server.ts created in this plan**

- **Found during:** Task 4
- **Issue:** `supabase/functions/_shared/posthog-server.ts` is owned by plan 24-04 which runs in the same wave. The file did not exist in this worktree.
- **Fix:** Created `posthog-server.ts` here with identical content to plan-24-04's version (confirmed by checking other agent's worktree).
- **Files modified:** `supabase/functions/_shared/posthog-server.ts` (created)
- **Commit:** a94b135

**2. [Rule 3 - Naming] Migration renamed from 20260518000008 to 20270601000033**

- **Found during:** Task 3
- **Issue:** Plan specified `20260518000008_admin_totp_rpcs.sql` which predates existing migrations in this worktree (`20270601000026` through `20270601000032`). Would be silently skipped per [[reference_supabase_migration_filename_regex]].
- **Fix:** Renamed to `20270601000033_admin_totp_rpcs.sql` per phase notes.
- **Commit:** e7c5a9e

### Checkpoint AUTO-RESOLVED

**Task 6 (BACKUP_CODE_PEPPER):** Human-action checkpoint marked as AUTO-RESOLVED. The orchestrator provisioned the `BACKUP_CODE_PEPPER` vault secret (uuid `469a745b-14ee-4d63-8af3-dad898d1ce65`) before plan execution. No user action required.

### Deferred Items

- **EG-31 (T2 full TOTP enrollment e2e):** Full enrollment flow deferred. Requires `otplib` or equivalent to compute a live TOTP code from the QR URI's base32 secret within the Playwright test. T1 (QR render check) is shipped and env-gated. Fix target: Phase 24 closeout sweep or v1.3 polish (Plan 40/41).

## Known Stubs

None — all components wire to real Supabase Auth MFA APIs and real RPCs. The only stub is the T2 e2e test which is explicitly marked as DEFERRED and registered in deferred-tests.md.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: privilege_escalation_mitigated | supabase/migrations/20270601000033_admin_totp_rpcs.sql | T-24-02 mitigated: all sensitive RPCs check aal2 + role in SECURITY DEFINER body |
| threat_flag: backup_code_tamper_mitigated | supabase/migrations/20270601000033_admin_totp_rpcs.sql | T-24-14 mitigated: HMAC-SHA256 with Vault pepper + single-use used_at enforcement |

## Self-Check: PASSED

Files created/modified:

- `leanshot/src/lib/admin/totp.ts` — FOUND
- `leanshot/src/lib/admin/__tests__/totp.test.ts` — FOUND
- `leanshot/src/components/admin/SetupTotpPage.tsx` — FOUND
- `leanshot/src/components/admin/StepUpTotpPage.tsx` — FOUND
- `supabase/migrations/20270601000033_admin_totp_rpcs.sql` — FOUND
- `supabase/functions/admin-reset-totp/index.ts` — FOUND
- `supabase/functions/admin-reset-totp/admin-reset-totp.test.ts` — FOUND
- `supabase/functions/_shared/posthog-server.ts` — FOUND
- `leanshot/e2e/admin-mfa-enroll.spec.ts` — FOUND
- `leanshot/e2e/admin-mfa-middleware.spec.ts` — FOUND

Commits present:

- fb98676 — FOUND
- 73a7feb — FOUND
- 05db4ca — FOUND
- e7c5a9e — FOUND
- a94b135 — FOUND
- 889a539 — FOUND
