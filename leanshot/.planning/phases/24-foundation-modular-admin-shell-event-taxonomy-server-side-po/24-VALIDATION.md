---
phase: 24
slug: foundation-modular-admin-shell-event-taxonomy-server-side-po
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (browser + node); Deno test (Supabase Edge Functions); Playwright (e2e) |
| **Config file** | `vite.config.ts` (vitest extension); `playwright.config.ts`; `supabase/functions/<name>/<name>.test.ts` |
| **Quick run command** | `npm test -- src/lib/analytics src/lib/admin src/components/admin` |
| **Full suite command** | `npm test && npm run test:e2e -- admin-mfa-enroll.spec.ts admin-mfa-middleware.spec.ts admin-audit-rls.spec.ts && supabase functions test` |
| **Estimated runtime** | ~120 seconds (vitest) + ~60 seconds (Playwright) + ~30 seconds (Deno tests) = ~3.5 min |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- <affected files>` (per-file vitest run)
- **After every plan wave:** Run `npm test && npm run build && bash scripts/assert-bundle-budget.sh`
- **Before `/gsd:verify-work`:** Full suite must be green (vitest + e2e admin specs + Deno tests + bundle assert + ESLint)
- **Max feedback latency:** 30 seconds (per-file vitest)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | ADMIN-01, ADMIN-02, ADMIN-03 | T-24-01 | 7 migrations apply cleanly | integration | `supabase db reset` then `supabase db push --linked --dry-run` | ❌ W0 | ⬜ pending |
| 24-01-02 | 01 | 1 | ADMIN-02 | T-24-03 | `audit_logs` RLS denies UPDATE/DELETE incl. service_role | integration | `npm test -- src/lib/admin/__tests__/audit-logs-rls.test.ts` | ❌ W0 | ⬜ pending |
| 24-01-03 | 01 | 1 | ADMIN-02 | T-24-03 | PHI-table triggers fire on INSERT/UPDATE/DELETE | integration | `npm test -- src/lib/admin/__tests__/audit-trigger.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-01 | 02 | 1 | TAXO-01, TAXO-04 | T-24-04 | events.ts compiles; zod schemas typecheck | unit | `npm test -- src/lib/analytics/events.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-02 | 02 | 1 | TAXO-04 | T-24-04 | Browser `capture()` rejects PHI event in DEV (throws) | unit | `npm test -- src/lib/analytics/__tests__/capture.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-03 | 02 | 1 | TAXO-01, TAXO-06 | T-24-08 | ESLint additive-only rule blocks payload removal | unit | `npm test -- eslint-rules/__tests__/additive-only-events.test.js` | ❌ W0 | ⬜ pending |
| 24-02-04 | 02 | 1 | TAXO-04 | T-24-04 | ESLint zone restriction blocks PHI event import in client code | unit | `npm test -- src/lib/analytics/__tests__/phi-import-zone.test.ts` | ❌ W0 | ⬜ pending |
| 24-03-01 | 03 | 1 | ADMIN-01 | T-24-01 | Manifest renders 12 modules respecting role + flag | unit | `npm test -- src/lib/admin/modules.test.ts` | ❌ W0 | ⬜ pending |
| 24-03-02 | 03 | 1 | ADMIN-01 | T-24-01 | AdminShell hides modules when flag false / role insufficient | integration | `npm test -- src/components/admin/__tests__/AdminShell.test.tsx` | ❌ W0 | ⬜ pending |
| 24-03-03 | 03 | 1 | ADMIN-01 | — | Existing v1.2 admin pages (Members/Metrics/Cohorts/Affiliates) refactored as manifest entries; tsc passes | integration | `npm run build` | partial | ⬜ pending |
| 24-04-01 | 04 | 2 | TAXO-02 | T-24-05 | `_shared/posthog-server.ts` lazy-init + shutdown works | integration | `supabase functions test _shared/posthog-server.test.ts` | ❌ W0 | ⬜ pending |
| 24-04-02 | 04 | 2 | TAXO-02 | T-24-05 | stripe-webhook captures `payment.completed` server-side with correct distinct_id | integration | `supabase functions test stripe-webhook/stripe-webhook.test.ts` (new assertion) | partial | ⬜ pending |
| 24-04-03 | 04 | 2 | TAXO-02 | T-24-05 | Browser `identify` + `alias` bridge merges anonymous → uid history | unit | `npm test -- src/lib/analytics/__tests__/identify.test.ts` | ❌ W0 | ⬜ pending |
| 24-05-01 | 05 | 2 | ADMIN-03 | T-24-02 | TOTP enrollment shows QR + writes backup codes HMAC-hashed | e2e | `npm run test:e2e -- admin-mfa-enroll.spec.ts` | ❌ W0 | ⬜ pending |
| 24-05-02 | 05 | 2 | ADMIN-03 | T-24-02 | Middleware redirects unenrolled admin to `/admin/setup-2fa` | e2e | `npm run test:e2e -- admin-mfa-middleware.spec.ts` | ❌ W0 | ⬜ pending |
| 24-05-03 | 05 | 2 | ADMIN-03 | T-24-02 | `admin.reset_totp` RPC clears factor + emails enrollment URL + audit-logged | integration (Deno) | `supabase functions test admin-reset-totp/admin-reset-totp.test.ts` | ❌ W0 | ⬜ pending |
| 24-05-04 | 05 | 2 | ADMIN-03 | T-24-02 | Backup-code single-use enforced (used_at set; second use rejected) | integration | `npm test -- src/lib/admin/__tests__/backup-codes.test.ts` | ❌ W0 | ⬜ pending |
| 24-06-01 | 06 | 2 | ADMIN-02 | — | Audit Log diff viewer renders before/after side-by-side | unit | `npm test -- src/components/admin/__tests__/AuditLogModule.test.tsx` | ❌ W0 | ⬜ pending |
| 24-06-02 | 06 | 2 | ADMIN-02 | T-24-03 | Parquet archive cron writes valid Parquet file to `audit-archive/YYYY/MM/DD.parquet` | integration | `supabase functions test audit-archive/audit-archive.test.ts` | ❌ W0 | ⬜ pending |
| 24-07-01 | 07 | 2 | TAXO-01 | T-24-08 | PostHog event-definitions sync hits API + reports success | integration | `node scripts/sync-posthog-event-defs.ts --dry-run` | ❌ W0 | ⬜ pending |
| 24-07-02 | 07 | 2 | TAXO-01, TAXO-06 | T-24-08 | CI sync fails the deploy when API call fails | unit | `npm test -- scripts/__tests__/sync-posthog-event-defs.test.ts` | ❌ W0 | ⬜ pending |
| 24-08-01 | 08 | 3 | ADMIN-01..03, TAXO-01..06 | T-24-07 | Per-chunk ceilings declared + enforced by CI; build passes within ceilings | CI | `bash scripts/assert-bundle-budget.sh` | partial (v1.2 base) | ⬜ pending |
| 24-08-02 | 08 | 3 | ADMIN-01..03, TAXO-01..06 | T-24-07 | Hash-hyphen regression test extended for new chunks | unit | `bash scripts/test-hash-hyphen-regression.sh` | partial | ⬜ pending |
| 24-08-03 | 08 | 3 | TAXO-06 | — | TAXO-06 reconciliation visible in events.ts header + 24-PLAN | docs/grep | `bash scripts/check-taxo-06-reconciliation.sh` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Threat keys** (defined in each PLAN.md `<threat_model>` block):
- T-24-01 — admin module bypass (role/flag spoof)
- T-24-02 — TOTP bypass or MFA-skip
- T-24-03 — audit log tampering (update/delete)
- T-24-04 — PHI leak via analytics payload
- T-24-05 — server-side event drop (no shutdown / no key)
- T-24-07 — bundle bloat slips past CI
- T-24-08 — additive-only enforcement bypass

---

## Wave 0 Requirements

- [ ] `src/lib/analytics/events.ts` + `events.test.ts`
- [ ] `src/lib/analytics/capture.ts` + `__tests__/capture.test.ts`
- [ ] `src/lib/analytics/identify.ts` + `__tests__/identify.test.ts`
- [ ] `src/lib/analytics/__tests__/phi-import-zone.test.ts`
- [ ] `src/lib/admin/modules.ts` + `modules.test.ts`
- [ ] `src/lib/admin/roles.ts`
- [ ] `src/lib/admin/__tests__/audit-logs-rls.test.ts`, `audit-trigger.test.ts`, `backup-codes.test.ts`
- [ ] `src/components/admin/__tests__/AdminShell.test.tsx`, `AuditLogModule.test.tsx`
- [ ] 7 migrations under `supabase/migrations/`
- [ ] `supabase/functions/_shared/posthog-server.ts` + `.test.ts`
- [ ] `supabase/functions/admin-reset-totp/index.ts` + `.test.ts`
- [ ] `supabase/functions/audit-archive/index.ts` + `.test.ts`
- [ ] `eslint-rules/additive-only-events.js` + `__tests__/`
- [ ] `scripts/sync-posthog-event-defs.ts` + `__tests__/`
- [ ] `scripts/assert-bundle-budget.sh` extension
- [ ] `scripts/check-taxo-06-reconciliation.sh`
- [ ] `e2e/admin-mfa-enroll.spec.ts`, `e2e/admin-mfa-middleware.spec.ts`, `e2e/admin-audit-rls.spec.ts`
- [ ] vitest config: ensure `eslint-rules/` is in coverage globs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Communicate cutover internally before ship (D-06 hard-cut) | ADMIN-03 | Operational; no code path | Owner sends Slack to all 2 staff 48h before deploy with `/admin/setup-2fa` link in preview env; collect TOTP enrollment confirmation reply |
| Provision private Supabase Storage bucket `audit-archive` | ADMIN-02 | Vendor UI action (one-time) | Supabase Dashboard → Storage → New bucket → name `audit-archive`, type private, file-size-limit 100 MB |
| Add `POSTHOG_PROJECT_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST` to Supabase Function Secrets + GitHub Actions Secrets | TAXO-02, TAXO-01 | Vendor UI action | `echo $KEY \| supabase secrets set POSTHOG_PROJECT_KEY ...` per `[[reference_vercel_project]]` env pattern + GH UI for Actions secret |
| Verify PostHog event-definitions REST shape against current PostHog API docs | TAXO-01 | Vendor API may have changed since 2026-05-17 research | Wave-1 task: run `scripts/sync-posthog-event-defs.ts --dry-run` and confirm shape; update if needed before CI wires it |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies declared
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for unit tests
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
