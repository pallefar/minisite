---
phase: 68-audience-landing-sales-enablement
plan: 2
subsystem: demo-org-sandbox
tags: [demo-org, synthetic-patients, edge-fn, cron, purge, sandbox, LAND-05, LAND-06]
requires:
  - organizations.is_demo column (Plan 68-01)
  - organizations.demo_extended_until column (Plan 68-01)
provides:
  - scripts/seed-demo-org.ts (operator-runnable synthetic-patient seed)
  - supabase/functions/demo-org-purge/ (cron-driven Edge Fn)
affects:
  - organizations (DELETE via Fn, guarded by is_demo=true)
  - org_members, org_invites, org_branding, org_settings, org_subscriptions (child-table clears)
  - org_patient_links, org_consent_grants, memberships, roles (child-table clears)
tech-stack:
  added:
    - npm:@supabase/supabase-js@2.45.0 (Edge Fn — pinned same as Phase 64-03)
  patterns:
    - handler/index split + DI deps + service-role bearer auth (Phase 64-03 mirror)
    - constantTimeEqual via _shared/newsletter-token.ts
    - Slack guardrail via _shared/slack-guardrail-alert.ts (cost channel, P2)
    - Deno.serve guarded by import.meta.main per
      [[reference_deno_test_top_level_serve_trap]]
    - Deterministic SHA-256-derived UUIDs for idempotent re-runnable seed
key-files:
  created:
    - leanshot/scripts/seed-demo-org.ts
    - supabase/functions/demo-org-purge/handler.ts
    - supabase/functions/demo-org-purge/index.ts
    - supabase/functions/demo-org-purge/deno.json
    - supabase/functions/demo-org-purge/__tests__/handler.test.ts
  modified: []
decisions:
  - Manual child-table clears in purge handler (instead of relying on FK CASCADE)
    because every Phase-28 child table FK on organizations(id) is ON DELETE RESTRICT.
  - Belt-and-braces is_demo=true filter on the org-DELETE query itself, even
    though the candidate query already filters. Two-layer safety.
  - Demo patient auth.users rows are NOT deleted by this purge — they ride with
    org_members, but their personal PHI rows (injections, weights) stay attached
    to auth.users. Cleaning up demo patient auth.users is deferred to the admin
    UI flow (Plan 68-04) which can call auth.admin.deleteUser with proper audit.
  - Tests stub Slack alerter via deps.slackAlert injection rather than mocking
    fetch, sidestepping the vault-fetch path entirely in the unit-test layer.
metrics:
  duration_minutes: 22
  completed_date: 2026-05-27
  tasks_completed: 2
  files_created: 5
  files_modified: 0
  deno_tests: 11
  deno_tests_passing: 11
---

# Phase 68 Plan 68-02: Demo Synthetic-Patient Seed + Auto-Purge Summary

**One-liner:** Deterministic synthetic-patient seed script (`scripts/seed-demo-org.ts`) + cron-driven `demo-org-purge` Edge Fn that auto-deletes is_demo orgs older than 7 days (or beyond their `demo_extended_until` extension), with Slack guardrail on bulk purges.

## What Shipped

### Task 1 — `scripts/seed-demo-org.ts`

Node + tsx script (matches `build-sitemap.ts` convention). Refuses to seed real orgs (`is_demo=false` → fail-loud bail). Deterministic SHA-256-derived UUIDs for patient `user_id` + injection `log_id` → re-runs are idempotent via ON CONFLICT upserts.

Per patient seeded:

- `auth.users` row via Admin API (skipped if `getUserById` returns one)
- `org_members` row (UPSERT on `(org_id, user_id)`, role='member')
- 9 weekly injection logs spanning ~60 days (Tuesday 18:00 UTC, alternating abdomen-left/abdomen-right by `(patientIndex + week) % 2`)
- 60 daily weight rows (linear 220 → 195 lb + per-patient ±2 lb offset)
- 7 most-recent days of mood entries + 3 symptom entries (nausea/fatigue/headache mixed with "none")

Commit: `74336216`.

### Task 2 — `supabase/functions/demo-org-purge/`

Handler/index split mirrors Phase 64-03 `grandfathered-policy-notice`:

- `handler.ts` exports `handle(req, deps)` — testable without binding a socket
- `index.ts` guards `Deno.serve` behind `import.meta.main`
- `deno.json` imports `_shared/` siblings + `npm:@supabase/supabase-js@2.45.0`
- `__tests__/handler.test.ts` — 11 Deno tests, all passing

Behaviour:

| Case | Outcome |
|------|---------|
| 3 expired demo orgs, none extended | purges 3 |
| 1 org `demo_extended_until` in future | NOT purged |
| `is_demo=false` org (any age) | NOT purged (filtered at query + belt-and-braces at DELETE) |
| `dry_run=true` in body | returns candidate count + IDs; no writes |
| `purged_count > 10` | P2 Slack alert to `cost` channel |
| Missing or wrong bearer | 401 unauthorized |
| `GET /healthz` | 200 `{ ok:true, fn:'demo-org-purge' }` |

Test run:

```
ok | 11 passed | 0 failed (14ms)
```

Commit: `6a7f350e`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Schema reality] PLAN.md narrative assumed FK ON DELETE CASCADE; reality is RESTRICT**

- **Found during:** Task 2 schema reconnaissance (grep across Phase 28+ migrations for `references public.organizations(id) on delete`).
- **Issue:** PLAN.md Task 2 action said "DELETE FROM organizations WHERE id = org_id (relies on existing FK ON DELETE CASCADE for patients, dose_logs, weight_logs, etc.)" — but every Phase-28 child table (`org_members`, `org_invites`, `org_settings`, `org_branding`, `org_subscriptions`, `org_patient_links`, `org_consent_grants`) is declared `ON DELETE RESTRICT`. A bare `DELETE FROM organizations` would 23503 with foreign_key_violation.
- **Fix:** Handler manually iterates `ORG_CHILD_TABLES` and clears each via `DELETE WHERE org_id = ?` before the final `DELETE FROM organizations WHERE id = ? AND is_demo = true`. Tolerates 42P01 (relation does not exist) so tables renamed in later phases don't break the purge.
- **Note on PHI:** Per-user PHI tables (`injections`, `weights`, `mood`, `symptoms`) FK on `auth.users.id` with `ON DELETE CASCADE`, not on `organizations.id`. They stay attached to the demo patient's auth.users row, which is not deleted by this purge. Operator-driven auth.users cleanup is Plan 68-04's responsibility (admin UI).
- **Files modified:** `supabase/functions/demo-org-purge/handler.ts` (added `ORG_CHILD_TABLES` constant + iteration loop).
- **Commit:** `6a7f350e`.

**2. [Rule 2 — Critical safety] Belt-and-braces `is_demo=true` clause on org DELETE**

- **Found during:** Task 2 handler implementation review.
- **Issue:** The candidate query already filters `is_demo=true`, but a bug in candidate-row hydration (e.g. PostgREST returning unfiltered rows due to an RLS misconfig) could theoretically cause the purge loop to DELETE a real org.
- **Fix:** Final `DELETE FROM organizations WHERE id = ? AND is_demo = true` adds a second filter at write-time — even if the candidate row was wrong, a real org would not match this clause and the DELETE would no-op.
- **Files modified:** `supabase/functions/demo-org-purge/handler.ts`.
- **Commit:** `6a7f350e`.

### No architectural changes (Rule 4) required.

## Worktree-Path-Safety Note (Operational, Not Code)

During Task 1, the first `Write` call used an absolute `/Users/.../minisite/leanshot/scripts/seed-demo-org.ts` path constructed from the orchestrator's reported git-root, which landed the file in the **main** repo instead of the worktree. Detected immediately (worktree `git status` returned empty), recovered by `cp + rm`, and switched to **relative paths** for all subsequent Write calls per [[feedback_worktree_executor_pwd_drift_leaks_to_main]]. Final commits both landed cleanly on the worktree branch with the per-commit HEAD assertions intact.

## Authentication Gates

None — all work was code + tests; no Supabase CLI / Slack-vault / OAuth steps required during execution. Cron registration is deferred to Phase 68 close-out per [[feedback_fn_deploy_before_cron_db_push]], at which point the close-out plan must deploy the Fn BEFORE the `db push` that registers the cron schedule.

## Known Stubs / Carve-outs

None blocking. The seed script's `weights` / `mood` / `symptoms` upsert paths use best-effort error suppression (warn + continue) because their per-table schemas (column names, conflict targets) may diverge from the `(user_id, date)` assumption in earlier phases. The injection-log seed — which is the headline (LeanShot's "drug-level projection" is the centerpiece per CLAUDE.md) — always runs strictly and aborts on error.

## Threat Flags

None. The Fn ships:

- Service-role bearer auth (constant-time compare)
- `is_demo=true` filter at TWO points (candidate query + DELETE clause)
- `purged_count > 10` Slack guardrail
- Idempotent seed (deterministic UUIDs) so accidental re-runs cannot drift state
- No new network endpoints exposed beyond the existing service-role-only Fn surface

## Self-Check: PASSED

- ✓ `leanshot/scripts/seed-demo-org.ts` exists (Task 1, commit `74336216`)
- ✓ `supabase/functions/demo-org-purge/handler.ts` exists (Task 2, commit `6a7f350e`)
- ✓ `supabase/functions/demo-org-purge/index.ts` exists (Task 2, commit `6a7f350e`)
- ✓ `supabase/functions/demo-org-purge/deno.json` exists (Task 2, commit `6a7f350e`)
- ✓ `supabase/functions/demo-org-purge/__tests__/handler.test.ts` exists (Task 2, commit `6a7f350e`)
- ✓ 11 Deno tests pass (`deno test --no-check --allow-all` — 14ms)
- ✓ Commits `74336216` and `6a7f350e` present in `git log --oneline`
