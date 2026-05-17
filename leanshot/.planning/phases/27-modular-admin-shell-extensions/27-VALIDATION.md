---
phase: 27
slug: modular-admin-shell-extensions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Planner populates Per-Task Verification Map after PLAN.md files exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + RLS integration + cohort rule-tree translator) + Playwright 1.x (palette + bulk action e2e) + deno test (Edge Fns) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, `supabase/functions/*/deno.json` |
| **Quick run command** | `npm run test -- --run --bail src/lib/cohort src/lib/admin/bulk src/lib/admin/palette` |
| **Full suite command** | `npm run test && npm run lint && npm run typecheck && deno test supabase/functions/admin-bulk-job-worker supabase/functions/funnel-anomaly-cron supabase/functions/bulk-undo-token-purge && npx playwright test --grep 'admin|cohort|palette'` |
| **Estimated runtime** | ~150s quick · ~700s full |

Notes
- RLS integration tests use [[reference_rls_fixture_gotruechient_flake]] fix.
- Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]].
- Deno tests use `<name>.test.ts` filename per [[reference_deno_test_discovery]].
- Realtime channel verification per [[feedback_realtime_layer_e2e_pattern]] (DB-level invariant for `funnel_anomaly_alerts`).

---

## Sampling Rate

- **After every task commit:** Run quick command.
- **After every plan wave:** Run full command.
- **Before `/gsd:verify-work`:** Full suite + `supabase db query --linked` cron presence + manual realtime channel probe + Playwright palette e2e + cohort matview sub-50ms p99 query check.
- **Max feedback latency:** ~150 seconds per task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-NN-NN | NN | W | ADMIN-XX or TAXO-XX | T-27-XX | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Planner instruction:** populate this table once PLAN files exist. Nyquist Dimension 8: no 3 consecutive tasks without automated verify.

---

## Wave 0 Requirements

- [ ] `src/lib/cohort/rule-tree-schema.test.ts` — zod schema unit tests (max-depth 8, 15-field allowlist enforcement, malformed-tree rejection) — ADMIN-05
- [ ] `src/lib/cohort/rule-tree-to-sql.test.ts` — JSONB→SQL translator unit tests (recursive AND/OR/NOT; field-level operator allowlist; SQL injection rejection) — ADMIN-05
- [ ] `src/lib/admin/bulk/action-handlers.test.ts` — 5 action types unit tests (csv_export / tag / comp_plan / ban / force_password_reset) — ADMIN-04
- [ ] `src/lib/admin/bulk/undo.test.ts` — 60s undo token issue + redeem + expiry — ADMIN-04
- [ ] `src/lib/admin/palette/index-builder.test.ts` — palette index aggregation (modules + recent items + quick actions) — ADMIN-06
- [ ] `tests/integration/cohort-matview-refresh.test.ts` — `refresh materialized view concurrently` succeeds; sub-50ms p99 cohort_membership read — TAXO-03
- [ ] `tests/integration/admin-bulk-job-worker.test.ts` — async path: queue >100-row job; worker drains; per-row audit_logs landed — ADMIN-04
- [ ] `tests/integration/funnel-anomaly-detection.test.ts` — seed funnel events; trigger cron; verify alert row + Realtime broadcast + email send — TAXO-05
- [ ] `tests/integration/anomaly-suppression.test.ts` — second alert within 4h same funnel suppressed — D-18
- [ ] `tests/e2e/admin-bulk-actions.spec.ts` — Playwright: select 5 members, click Ban, button-click confirm, 60s undo banner appears, click Undo, state reverts — ADMIN-04 + D-03
- [ ] `tests/e2e/admin-cohort-builder.spec.ts` — Playwright: define "free users >7d" cohort via builder UI; archive cohort — ADMIN-05
- [ ] `tests/e2e/admin-palette.spec.ts` — Playwright: Cmd+K opens; type "audit"; ↑↓⏎ navigates to audit log module; destructive action triggers aal2 step-up — ADMIN-06 + D-12

*Planner owns Wave-0 stub creation per the mapping above (recommend Plan 27-01 owns bulk + undo + e2e; Plan 27-02 owns cohort schema + translator + matview + e2e; Plan 27-03 owns palette + e2e; Plan 27-04 owns anomaly cron + Realtime + email + integration tests; Plan 27-06 owns async worker + integration; Plan 27-07 owns undo-purge cron).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `SUPERADMIN_ALERTS_EMAIL` env var set on Vercel + Supabase Function secrets | D-17 | Vendor config | `vercel env add SUPERADMIN_ALERTS_EMAIL production` + `supabase secrets set SUPERADMIN_ALERTS_EMAIL=<email>` |
| First non-concurrent matview refresh executed manually before cron enables | D-08 / RESEARCH 2-step pattern | One-time bootstrap | `supabase db query --linked "refresh materialized view public.cohort_membership"` then enable pg_cron job |
| Realtime channel `funnel_anomaly_alerts` enabled in Supabase Realtime settings | D-17 | Supabase dashboard config | Enable Realtime for `funnel_anomaly_alerts` table in Supabase dashboard → Realtime; verify with `supabase db query --linked "select * from realtime.subscription"` |
| cron schedule collision check post-Phase 26 deploy | D-16 / RESEARCH stagger recommendation | Live cron query | `supabase db query --linked "select jobname, schedule from cron.job order by schedule"` — verify no `:00/:15/:30/:45` triple-fire |
| aal2 step-up freshness window UX walkthrough | D-12 | Manual flow | Login fresh; wait 16 minutes; trigger destructive palette action; verify TOTP re-prompt; verify session continues post-verify |
| Bulk action CSV export integrity probe | D-04 csv_export | Spot-check CSV | Run bulk CSV export on 50 members; open in spreadsheet; verify column order + no PII leak beyond allowlist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
