# Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent — Pattern Map

**Mapped:** 2026-05-16
**Phase directory:** `.planning/phases/22-owner-admin-lifecycle-email-dsar-cookie-consent/`
**Files analyzed:** ~58 new/modified targets across migrations, Edge Functions, UI, libs, tests
**Analogs found:** 50 / 58 (8 marked "no analog" / use RESEARCH pattern)
**Repo layout note:** git root is `/Users/karstenhaldan/minisite/`. Source = `leanshot/src/`. Supabase = `supabase/` (parent dir, NOT `leanshot/supabase/`). All paths below absolute.

---

## Critical Repo Layout Notes (load-bearing for planner)

| Artifact kind | Path root | Example |
|---------------|-----------|---------|
| React source | `/Users/karstenhaldan/minisite/leanshot/src/` | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` |
| e2e specs | `/Users/karstenhaldan/minisite/leanshot/e2e/` | `leanshot/e2e/rls-audit-logs.test.ts` |
| Supabase migrations | `/Users/karstenhaldan/minisite/supabase/migrations/` | `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` |
| Supabase Edge Functions | `/Users/karstenhaldan/minisite/supabase/functions/` | `supabase/functions/clinic-invite/resend.ts` |
| Phase planning | `/Users/karstenhaldan/minisite/leanshot/.planning/phases/22-…/` | the phase folder |

Per `project_worktree_supabase_cli.md` + `reference_supabase_worktree_temp_state.md`: any migration `db push` requires the file ALSO in main checkout, plus `supabase/.temp/` copied into worktree. Plan tasks adding migrations MUST account for this.

---

## File Classification

### Wave A — Migrations (Postgres, additive + override of 30d→7d cron)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20270601000001_finalize_cron_seven_days.sql` | migration / cron-override | cron | `supabase/migrations/20260601000013_finalize_account_deletions_cron.sql` | exact |
| `supabase/migrations/20270601000002_audit_action_enum_phase22.sql` | migration / enum-extend | DDL | `supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql` | exact |
| `supabase/migrations/20270601000003_audit_logs_impersonator_cols.sql` | migration / schema-extend | DDL | `supabase/migrations/20260701000001_audit_logs_share_columns.sql` | exact |
| `supabase/migrations/20270601000004_feature_flag_overrides_table.sql` | migration / RLS-table | CRUD | `supabase/migrations/20260601000010_pending_account_deletions.sql` | role-match |
| `supabase/migrations/20270601000005_consent_records_table.sql` | migration / RLS-table | CRUD | `supabase/migrations/20260601000010_pending_account_deletions.sql` | role-match |
| `supabase/migrations/20270601000006_dsar_requests_table.sql` | migration / RLS-table | CRUD | `supabase/migrations/20260601000010_pending_account_deletions.sql` | role-match |
| `supabase/migrations/20270601000007_dsar_exports_storage_bucket.sql` | migration / storage-RLS | file-I/O | `supabase/migrations/20260601000014_photos_pending_shred_storage.sql` | role-match |
| `supabase/migrations/20270601000008_user_activity_daily_matview.sql` | migration / matview | aggregate | `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` | exact |
| `supabase/migrations/20270601000009_user_activity_refresh_cron.sql` | migration / cron | cron | `supabase/migrations/20270101000009_click_baseline_refresh_cron.sql` | exact |
| `supabase/migrations/20270601000010_cohort_retention_view.sql` | migration / view | aggregate | `supabase/migrations/20270101000004_tier_effective_view.sql` | role-match |
| `supabase/migrations/20270601000011_admin_list_members_rpc.sql` | migration / RPC | read | `supabase/migrations/20260901000003_rank_org_patients_rpc.sql` | exact |
| `supabase/migrations/20270601000012_impersonation_write_deny_policies.sql` | migration / RLS-policy | cross-table | `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` | role-match (GUC pattern) |
| `supabase/migrations/20270601000013_resend_unverified_skips_counter.sql` | migration / counter-table + RPC | write | `supabase/migrations/20260512000001_rate_limit_counters.sql` | role-match |
| `supabase/migrations/20270601000014_cancel_account_deletion_rpc.sql` | migration / RPC | write | `supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql` | exact |
| `supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql` | migration / RPC | write | `supabase/migrations/20260901000005_log_clinic_view_rpc.sql` | role-match |
| `supabase/migrations/20270601000016_feature_flag_overrides_cleanup_cron.sql` | migration / cron | cron | `supabase/migrations/20260601000013_finalize_account_deletions_cron.sql` | role-match |

### Wave B — Shared Edge Function helper

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/functions/_shared/resend-domain-health-check.ts` | shared helper | health-check | `supabase/functions/clinic-invite/resend.ts` | role-match |

### Wave C — Edge Functions (3 admin + 5 lifecycle + 1 DSAR)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/functions/admin-impersonate/index.ts` | edge fn / admin | request-response | `supabase/functions/affiliate-payout/index.ts` | role-match |
| `supabase/functions/admin-impersonate/index.test.ts` | deno test | unit | `supabase/functions/affiliate-payout/index.test.ts` | exact |
| `supabase/functions/admin-impersonate/deno.json` | config | n/a | `supabase/functions/affiliate-payout/deno.json` | exact |
| `supabase/functions/admin-stripe-action/index.ts` | edge fn / Stripe | request-response | `supabase/functions/affiliate-payout/index.ts` + `supabase/functions/stripe-webhook/` | role-match |
| `supabase/functions/admin-stripe-action/index.test.ts` | deno test | unit | `supabase/functions/affiliate-payout/index.test.ts` | exact |
| `supabase/functions/dsar-export/index.ts` | edge fn / aggregate+ZIP | batch | `supabase/functions/account-delete/index.ts` (multi-step orchestrator) | role-match |
| `supabase/functions/dsar-export/pdf-render.ts` | deno PDF helper | transform | `src/lib/export-data.ts` (jsPDF pattern; adapt for Deno) | role-match |
| `supabase/functions/dsar-export/index.test.ts` | deno test | unit | `supabase/functions/affiliate-payout/index.test.ts` | exact |
| `supabase/functions/lifecycle-welcome-series/index.ts` | edge fn / Resend | event-driven (cron) | `supabase/functions/clinic-invite/index.ts` + `affiliate-payout/index.ts` (cron pattern) | role-match |
| `supabase/functions/lifecycle-welcome-series/templates.ts` | template module | transform | `supabase/functions/clinic-invite/template-clinic-invite.ts` | exact |
| `supabase/functions/lifecycle-welcome-series/index.test.ts` | deno test | unit | `supabase/functions/clinic-invite/index.test.ts` | exact |
| `supabase/functions/lifecycle-behavior-triggered/{index,templates,index.test}.ts` | same as above | event-driven | same as above | exact |
| `supabase/functions/lifecycle-transactional/{index,templates,index.test}.ts` | same as above | request-response | same as above | exact |
| `supabase/functions/lifecycle-retention/{index,templates,index.test}.ts` | same as above | event-driven (cron) | same as above | exact |
| `supabase/functions/lifecycle-preference-update/{index,index.test}.ts` | edge fn / Resend audience | write | `supabase/functions/clinic-invite/index.ts` (no templates) | role-match |

### Wave D — Client libs

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/src/lib/admin/admin-api.ts` | client API wrapper | read+write | `leanshot/src/lib/clinic.ts` + `leanshot/src/lib/affiliate/api.ts` | role-match |
| `leanshot/src/lib/admin/admin-impersonate.ts` | client API wrapper | write | `leanshot/src/lib/account-delete.ts` (RPC + sign-out flow) | role-match |
| `leanshot/src/lib/consent/consent-defer.ts` | dynamic-import gate | event-driven | `leanshot/src/lib/sync-defer.ts` | exact |
| `leanshot/src/lib/consent/consent-records.ts` | client API wrapper | write | `leanshot/src/lib/account-delete.ts` (RPC wrapper) | role-match |
| `leanshot/src/lib/consent/feature-flag-overrides.ts` | PostHog client wrapper | read | `leanshot/src/lib/feature-flags.ts` | exact |
| `leanshot/src/lib/dsar/dsar-export-client.ts` | edge-fn invoker + status poll | request-response | `leanshot/src/lib/account-delete.ts` (rpc invoke + error map) | role-match |
| `leanshot/src/lib/dsar/dsar-pdf-render.ts` | jsPDF dynamic-import wrapper | transform | `leanshot/src/lib/export-data.ts` | exact |
| `leanshot/src/lib/account-delete.ts` (MODIFY) | client API wrapper | write | self (Phase 7 file) | exact — copy update only |

### Wave E — Admin UI surface (extends P19 scaffold)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/src/components/admin/AdminLayout.tsx` | UI page shell | read | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` (is_staff gate) | role-match |
| `leanshot/src/components/admin/pages/AdminMembersPage.tsx` | UI page | read | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` | exact |
| `leanshot/src/components/admin/pages/AdminMemberDrillInPage.tsx` | UI page | read | `leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx` | role-match |
| `leanshot/src/components/admin/pages/AdminMetricsPage.tsx` | UI page | read | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` + `BaseChart.tsx` | role-match |
| `leanshot/src/components/admin/pages/AdminCohortsPage.tsx` | UI page | read | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` (is_staff shell) | role-match |
| `leanshot/src/components/admin/pages/AdminAffiliatesPage.tsx` | UI page | read+write | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` (EXTENDS — adds approve action) | exact |
| `leanshot/src/components/admin/members/MembersTable.tsx` | UI component | read | `leanshot/src/components/clinic/roster/RosterTable.tsx` | exact |
| `leanshot/src/components/admin/members/MemberRowActions.tsx` | UI component | UI | `leanshot/src/components/clinic/roster/RosterRow.tsx` (per-row actions) | role-match |
| `leanshot/src/components/admin/members/ImpersonateButton.tsx` | UI component | write | `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (destructive confirm) | role-match |
| `leanshot/src/components/admin/members/RefundModal.tsx` | UI component | write | `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (typed-confirm pattern) | role-match |
| `leanshot/src/components/admin/members/CancelSubModal.tsx` | UI component | write | `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` | role-match |
| `leanshot/src/components/admin/members/FeatureFlagOverridePanel.tsx` | UI component | write | `leanshot/src/components/admin/pages/SiteSettingsPanel.tsx` (admin form) | role-match |
| `leanshot/src/components/admin/cohorts/CohortHeatmap.tsx` | UI component | read | none — see "No Analog Found" below | partial |
| `leanshot/src/components/admin/__tests__/*.test.tsx` | RTL tests | unit | `leanshot/src/components/admin/__tests__/AdminAffiliatesScaffold.test.tsx` | exact |

### Wave F — Cross-cutting overlays (banner + DSAR + consent + soft-delete)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/src/components/impersonation/ImpersonationBanner.tsx` | UI overlay | read | `leanshot/src/components/clinic/ClinicContextBar.tsx` (sticky context banner) | role-match |
| `leanshot/src/components/impersonation/useImpersonation.ts` | hook | read | `leanshot/src/hooks/useTheme.ts` (read pre-mount state) | role-match |
| `leanshot/src/components/impersonation/useImpersonationReadOnly.ts` | hook | UI | none — pattern in RESEARCH §Pattern 1 | partial |
| `leanshot/src/components/consent/CookieConsentBootstrap.tsx` | UI bootstrap | event-driven | `leanshot/src/main.tsx` deferred-init pattern + sync-defer.ts | role-match |
| `leanshot/src/components/consent/consent-config.ts` | config | UI | RESEARCH §Pattern 3 (vanilla-cookieconsent) | partial |
| `leanshot/src/components/dsar/DsarPortalPage.tsx` | UI page | read+write | `leanshot/src/components/dashboard/settings/SettingsPage.tsx` (export flow ~lines 240-294) | role-match |
| `leanshot/src/components/dsar/DsarStatusCard.tsx` | UI component | read | `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` (Badge + status display) | role-match |
| `leanshot/src/components/soft-delete/SoftDeleteCountdownBanner.tsx` | UI overlay | read | `leanshot/src/components/clinic/ClinicContextBar.tsx` (sticky banner) | role-match |
| `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (MODIFY) | UI component | write | self (Phase 7 file) | exact — copy + flow update |
| `leanshot/src/components/dashboard/settings/EmailPreferencesPage.tsx` | UI page | read+write | `leanshot/src/components/admin/pages/SiteSettingsPanel.tsx` (form save pattern) | role-match |
| `leanshot/src/components/dashboard/settings/SettingsPage.tsx` (MODIFY) | UI page | navigation | self | exact — add links |

### Wave G — Tests (RLS + cron + lifecycle e2e)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/e2e/rls-audit-logs-impersonation.test.ts` | RLS test | cross-tenant | `leanshot/e2e/rls-audit-logs.test.ts` | exact |
| `leanshot/e2e/rls-feature-flag-overrides.test.ts` | RLS test | cross-tenant | `leanshot/e2e/rls-audit-logs.test.ts` | exact |
| `leanshot/e2e/rls-consent-records.test.ts` | RLS test | cross-tenant | `leanshot/e2e/rls-audit-logs.test.ts` | exact |
| `leanshot/e2e/rls-dsar-requests.test.ts` | RLS test | cross-tenant | `leanshot/e2e/rls-audit-logs.test.ts` | exact |
| `leanshot/e2e/rls-dsar-exports-storage.test.ts` | Storage RLS test | cross-tenant + file-I/O | `leanshot/e2e/rls-org-logos-storage.test.ts` | exact |
| `leanshot/e2e/admin-impersonation-write-deny.test.ts` | integration | cross-tenant | `leanshot/e2e/rls-multi-table.test.ts` | role-match |
| `leanshot/e2e/cron-finalize-7day.test.ts` | cron-tick integration | cron | RESEARCH (uses Phase 7 `run_finalize_account_deletions_cron_now` pattern) | partial |
| `leanshot/e2e/lifecycle-welcome-series.spec.ts` | Playwright | request-response | `leanshot/e2e/account-delete.spec.ts` | role-match |
| `leanshot/e2e/cookie-consent-banner.spec.ts` | Playwright | UI | none — see "No Analog Found" below | partial |

---

## Pattern Assignments

### Wave A — Migrations

#### `20270601000001_finalize_cron_seven_days.sql` (cron override — Critical Conflict #2 resolution)

**Analog:** `supabase/migrations/20260601000013_finalize_account_deletions_cron.sql`

**Cron unschedule + reschedule pattern** (analog lines 23-49):
```sql
create extension if not exists pg_cron;
select cron.schedule(
  'finalize-account-deletions',
  '0 4 * * *',
  $$
    do $body$
    declare v_uid uuid;
    begin
      for v_uid in
        select user_id from public.pending_account_deletions
         where initiated_at + interval '30 days' <= now()
           and finalize_attempts < 5
         order by initiated_at limit 50 for update skip locked
      loop
        begin perform public.finalize_account_deletion(v_uid);
        exception when others then null; end;
      end loop;
    end $body$;
  $$
);
```

**Pattern to copy:** Unschedule the existing `'finalize-account-deletions'` job then re-schedule with `interval '7 days'` (per RESEARCH Pattern 5). **ALSO ship a parallel update of the `run_finalize_account_deletions_cron_now` test-hook** (lines 57-78) — same 30→7 swap — otherwise e2e tests using the back-date-31-days helper drift out of phase.

**Gotcha:**
- The expression `initiated_at + interval '30 days' <= now()` is intentionally written as `initiated_at <= now() - interval 'N days'` after rewrite (Pitfall 1 in analog comment: timestamptz + interval is not IMMUTABLE). Keep this form.
- One-time data decision (RESEARCH §Runtime State Inventory): existing 30-day pending rows finalize on next cron tick after deploy. Accept (a) — production has near-zero pending rows at this stage.

---

#### `20270601000002_audit_action_enum_phase22.sql` (enum-extend)

**Analog:** `supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql`

**Pattern (canonical idempotent enum-extend):** `ALTER TYPE … ADD VALUE IF NOT EXISTS '<value>';` one per migration line. Per RESEARCH Pitfall 3 (sqlstate 55P04), `ADD VALUE` must be in a SEPARATE migration from any usage in defaults/checks. This migration ONLY adds; downstream migrations (e.g. `20270601000015_admin_stripe_action_audit_rpc.sql`) USE the values.

**Values to add (per CONTEXT D-05 + Claude's discretion):**
```sql
alter type public.audit_action_type add value if not exists 'impersonate_start';
alter type public.audit_action_type add value if not exists 'impersonate_end';
alter type public.audit_action_type add value if not exists 'impersonate_blocked_write';
alter type public.audit_action_type add value if not exists 'refund_issued';
alter type public.audit_action_type add value if not exists 'subscription_canceled_admin';
alter type public.audit_action_type add value if not exists 'subscription_comped';
alter type public.audit_action_type add value if not exists 'feature_flag_override_set';
alter type public.audit_action_type add value if not exists 'dsar_requested';
alter type public.audit_action_type add value if not exists 'dsar_completed';
alter type public.audit_action_type add value if not exists 'consent_recorded';
alter type public.audit_action_type add value if not exists 'account_deletion_cancelled';
```

**Gotcha:** Confirm enum name via `\dT+ public.audit_action_type` — the original `audit_logs` migration (20260601000001) uses a CHECK constraint, not an enum type. Phase 9/10 migrations (20260801000004, 20260901000001) introduced the enum. Plan-checker must verify the actual identifier; this PATTERNS.md assumes `public.audit_action_type` per the Phase 10 extend migration.

---

#### `20270601000003_audit_logs_impersonator_cols.sql` (schema-extend)

**Analog:** `supabase/migrations/20260701000001_audit_logs_share_columns.sql`

**Additive-column pattern** — ALTER TABLE with `add column if not exists`; no backfill on existing rows (impersonator_id will be NULL for all pre-P22 audit rows, which is correct).

```sql
alter table public.audit_logs
  add column if not exists impersonator_id uuid references auth.users(id) on delete set null,
  add column if not exists target_user_id  uuid references auth.users(id) on delete set null;
create index if not exists audit_logs_impersonator_idx
  on public.audit_logs (impersonator_id, timestamp desc)
  where impersonator_id is not null;
```

**Gotcha:** Per `audit_logs` migration 20260601000001 lines 55-56, `user_id` uses `on delete SET NULL` so the audit row survives auth.users deletion. Mirror this on `impersonator_id` AND `target_user_id`. Partial index `where impersonator_id is not null` keeps the index thin (most audit rows have no impersonator).

---

#### `20270601000004_feature_flag_overrides_table.sql` (RLS-locked table — D-08)

**Analog:** `supabase/migrations/20260601000010_pending_account_deletions.sql`

**Default-deny tampering-mitigation pattern** (analog lines 41-58):
```sql
alter table public.pending_account_deletions enable row level security;
create policy "pending_account_deletions_select_own"
  on public.pending_account_deletions for select to authenticated
  using (auth.uid() = user_id);
-- TAMPERING MITIGATION: NO INSERT/UPDATE/DELETE policy for authenticated.
-- Only service_role (admin RPCs) writes.
```

**Adapt for feature_flag_overrides:**
- Self-select policy uses `auth.uid() = user_id` so the user's own PostHog client can read overrides.
- NO authenticated write policy — only an `admin_set_feature_flag_override(user_id, flag_key, value, expires_at)` SECURITY DEFINER RPC writes (verifies `public.is_staff(auth.uid())` per Phase 15 `is_staff` helper migration 20261101000006).
- TTL index per RESEARCH Pitfall 10: `create index … on (expires_at) where expires_at > now() - interval '30 days'`. **Watch out for Pitfall 1 (IMMUTABLE) — `now()` in a partial-index predicate is rejected.** Use full index on `expires_at` instead.

---

#### `20270601000005_consent_records_table.sql` and `20270601000006_dsar_requests_table.sql`

Both follow the same RLS-locked pattern from `pending_account_deletions`. Notable per-table additions:

**`consent_records`:**
- `email_preferences jsonb default '{}'` — written by `/settings/email-preferences` UPSERT (per D-07 + ON-03)
- Status transitions: there's no enum — `cookie_categories jsonb` carries the consent payload. `recorded_at`, `revoked_at`, `consent_revision int` columns.
- **Per `feedback_status_machine_transition_owner.md`:** there's no status enum here, but watch for the implicit "active vs revoked" transition — the `revoked_at` write owner is the cookie banner's `onChange` callback (UPSERT) AND the user's "Withdraw consent" action. Both must write.

**`dsar_requests`:**
- Status enum: `pending | in_progress | completed | rejected`. Per `feedback_status_machine_transition_owner.md`, every value must have a writer:
  - `pending` ← DsarPortalPage submit (RPC `create_dsar_request`)
  - `in_progress` ← `dsar-export` Edge Fn (`update … set status='in_progress'` on start)
  - `completed` ← `dsar-export` Edge Fn (`update … set status='completed', completed_at=now()` on success)
  - `rejected` ← Admin RPC (admin DSAR review surface in `/admin/members/{id}`)
- **Plan-checker MUST verify all 4 transitions have writers.**

---

#### `20270601000007_dsar_exports_storage_bucket.sql` (private bucket)

**Analog:** `supabase/migrations/20260601000014_photos_pending_shred_storage.sql`

**Storage bucket + RLS pattern** — create bucket with `public=false`; RLS policy on `storage.objects` scoped to `bucket_id = 'dsar-exports'` AND `auth.uid()::text = (storage.foldername(name))[1]` (per Supabase storage path conventions). The `dsar-export` Edge Function uploads as service-role; signed URLs (7-day TTL) deliver the download.

**Gotcha (Pitfall 5 from RESEARCH):** If a 7-day TTL cleanup cron deletes from `storage.objects` directly, it MUST run `perform set_config('storage.allow_delete_query', 'true', true);` first (per `reference_supabase_migration_gotchas.md` finding 3).

---

#### `20270601000008_user_activity_daily_matview.sql` (cohort heatmap source — D-04)

**Analog:** `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql`

**Materialized view + UNIQUE-index pattern** (analog lines 27-47):
```sql
create materialized view public.affiliate_click_baseline as
select affiliate_id, avg(daily_count)::numeric(10,2) as mean_clicks, …
from ( select affiliate_id, date_trunc('day', created_at)::date as d, count(*) as daily_count
       from public.affiliate_clicks
       where created_at > now() - interval '7 days'
       group by affiliate_id, date_trunc('day', created_at)::date ) daily
group by affiliate_id;
-- Pitfall 5: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index.
create unique index idx_click_baseline_affiliate
  on public.affiliate_click_baseline(affiliate_id);
grant select on public.affiliate_click_baseline to authenticated, service_role;
```

**Adapt for `user_activity_daily`:**
- Source: `auth.users` joined with `auth.users.last_sign_in_at` (per D-04, Supabase is source-of-truth over PostHog).
- Rows: `(user_id, activity_date)` with one row per day a user was active in the trailing 91 days.
- UNIQUE index on `(user_id, activity_date)` — load-bearing for CONCURRENTLY refresh.
- `grant select` to `service_role` only (this is admin-data; authenticated should NOT read it). Cohort RPC `admin_cohort_retention()` aggregates further before returning to admin client.

**Gotcha:** `date_trunc('day', last_sign_in_at)` is STABLE not IMMUTABLE — fine inside the SELECT body, NOT in an index predicate (per analog Pitfall 1 comment lines 17-21).

---

#### `20270601000009_user_activity_refresh_cron.sql`

**Analog:** `supabase/migrations/20270101000009_click_baseline_refresh_cron.sql`

**Exact pattern copy** — `cron.schedule('user-activity-daily-refresh', '0 2 * * *', $$ refresh materialized view concurrently public.user_activity_daily; $$);`. Per D-04, 02:00 UTC daily (offset from existing 01:00 affiliate refresh + 04:00 finalize-account-deletions + 05:00 audit-cleanup — spreads compute on free tier).

---

#### `20270601000011_admin_list_members_rpc.sql` (server-paginated members RPC)

**Analog:** `supabase/migrations/20260901000003_rank_org_patients_rpc.sql`

**SECURITY DEFINER + is_staff gate + LIMIT/OFFSET pagination pattern:** start the RPC with `if not public.is_staff(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;` (per `20261101000006_is_staff_helper.sql` already in repo).

Joins: `auth.users` + `public.subscriptions` + `public.tier_effective` (per D-04 + RESEARCH Architecture map) + `public.profiles`. Returns: `email, tier, signup_date, last_active_at, clinic_name, country, stripe_status` per CONTEXT §Specifics line 135.

**Gotcha:** Per RESEARCH consume-tier-effective rule, JOIN on `public.tier_effective` view (Phase 19 migration 20270101000004), NOT raw `subscriptions.status`. P16 will plug RC into the same view without UI changes.

---

#### `20270601000012_impersonation_write_deny_policies.sql` (cross-table RLS — D-05)

**Analog:** RESEARCH §Pattern 1 — no exact codebase analog yet (this is the new pattern Phase 22 invents).

**The shape (per RESEARCH lines 380-388):**
```sql
-- Apply to: injections, weights, meals, workouts, supplements, mood, sleep,
-- symptoms, vials, settings, photos, ai_messages, shares, consent_records,
-- pending_account_deletions, feature_flag_overrides, dsar_requests
create policy "deny_writes_during_impersonation_INSERT"
  on public.injections for insert to authenticated
  with check (
    (current_setting('request.jwt.claims', true)::json
       #>> '{app_metadata,impersonator_id}') is null
  );
-- Repeat for UPDATE + DELETE; existing owner policies still apply.
```

**Gotcha #1 — Pitfall 1:** Do NOT use `app.impersonator_id` GUC — it does NOT persist across PostgREST requests. Read the claim from `request.jwt.claims`.

**Gotcha #2 — combinatorics:** ~17 tables × 3 operations = 51 policies. Plan as ONE migration that loops via `do $$ begin … end $$;` or generates `create policy …` statements per table. Per `feedback_planner_iter1_anti_patterns.md`, this is a known shared-file-choreography risk — keep ALL policies in this single migration (do NOT spread across waves).

**Gotcha #3 — policy permissiveness:** RLS policies are AND-combined within the same operation. Existing owner-write policies (`auth.uid() = user_id`) must still pass; this is an ADDITIONAL `WITH CHECK` clause. Postgres semantics: BOTH policies must permit the row. Verify in the RLS test that an un-impersonated owner can still write.

---

#### `20270601000014_cancel_account_deletion_rpc.sql` (Pattern 5)

**Analog:** `supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql`

**SECURITY DEFINER RPC pattern** — token-validates, then `DELETE FROM public.pending_account_deletions WHERE user_id = auth.uid()`. Audit-log row written with `action='account_deletion_cancelled'`. Token shape: HMAC of `user_id + initiated_at` signed with `Vault secret CANCEL_DELETION_HMAC_KEY` (per RESEARCH §Runtime State Inventory line 681). Token TTL: 7 days, matches the soft-delete window.

**Gotcha:** Per `reference_supabase_migration_gotchas.md` finding 4 (`app.suppress_audit` GUC), if this RPC writes the audit row inline AND also triggers `pending_account_deletions` row-level audit (via DELETE), the trigger may double-fire. Set `perform set_config('app.suppress_audit', 'true', true);` at the top of the function body — see Pattern 4 below.

---

### Wave B — Shared Edge Function helper

#### `supabase/functions/_shared/resend-domain-health-check.ts` (D-03 — gate-pattern)

**Analog:** `supabase/functions/clinic-invite/resend.ts` (project-canonical Resend direct-HTTPS pattern)

**Imports + env-read pattern** (analog lines 26, 38-44):
```typescript
const FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';
const apiKey = Deno.env.get('RESEND_API_KEY');
if (!apiKey) return { ok: false, error: 'no_api_key' };
if (apiKey === 'test-stub') return { ok: true, stubbed: true };
```

**Health-check pattern** (RESEARCH lines 420-442):
```typescript
const DOMAIN = 'app.leanshot.app';
export async function resendDomainHealthCheck(supabase: SupabaseClient): Promise<{ok: boolean; status: string}> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { ok: false, status: 'no_api_key' };
  if (apiKey === 'test-stub') return { ok: true, status: 'verified' };
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, status: `resend_${res.status}` };
  const { data } = await res.json();
  const domain = data?.find((d: { name: string }) => d.name === DOMAIN);
  const verified = domain?.status === 'verified';
  if (!verified) {
    await supabase.rpc('increment_resend_domain_unverified_skips');
    console.warn(`[lifecycle] Resend domain ${DOMAIN} status=${domain?.status ?? 'not_found'} — skipping send`);
  }
  return { ok: verified, status: domain?.status ?? 'not_found' };
}
```

**Error handling pattern** (analog lines 70-89): Wrap `fetch` in try/catch. NEVER echo `res.text()` or exception messages (T-09-34/T-09-37 PII safety). Wrap as `{ok:false, error:'resend_<status>'}`.

**Gotcha (Pitfall 6 from RESEARCH):** Keep the `test-stub` short-circuit identical to analog line 46 — lifecycle tests fire welcome+day1+day3+day7 against the same recipient and would hit Resend's 2/hour shared-domain rate limit.

---

### Wave C — Edge Functions

#### `supabase/functions/admin-impersonate/index.ts` (Pattern 1 — JWT-mint)

**Analog (singleton + admin pattern):** `supabase/functions/affiliate-payout/index.ts` (lines 33-88)

**Lazy admin singleton pattern** (analog lines 67-88):
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;
```

**Why proxy + lazy:** the Deno test suite sets `Deno.env` AFTER `import`. Module-level eager `createClient(getSupabaseUrl(),…)` captures `''`. The proxy reads `_adminInstance` lazily on first method call. **Reuse verbatim — this is the project-canonical pattern.**

**Impersonation core (per RESEARCH §Pattern 1 + Plan-time RECOMMENDED):**
1. Verify caller is staff: `supabase.auth.getUser(jwt)` → check `profiles.is_staff`.
2. Verify `body.target_user_id` is a valid UUID + not the caller's own ID.
3. `admin.auth.admin.updateUserById(targetId, { app_metadata: { impersonator_id: adminId, impersonation_exp: Date.now() + 30*60*1000 } })`.
4. `admin.auth.admin.generateLink({ type: 'magiclink', email: targetEmail })` → return the action_link.
5. INSERT audit row: `action='impersonate_start', impersonator_id=adminId, target_user_id=targetId`.
6. On end-impersonation (separate POST `?action=end`): clear `app_metadata.impersonator_id` + insert `action='impersonate_end'`.

**[ASSUMED — flagged in RESEARCH line 410]** `admin.updateUserById` mutations propagate to NEXT JWT. Plan-checker MUST test this end-to-end before relying on the pattern.

**Gotcha:** `verify_jwt = true` in deno.json (default per `reference_supabase_edge_function_deploy.md`); the caller's JWT is verified by Supabase Gateway, but you STILL need to manually check `is_staff` in code — JWT verification only confirms identity, not authorization.

---

#### `supabase/functions/admin-stripe-action/index.ts` (refund/cancel/comp)

**Analog (Stripe SDK pattern):** `supabase/functions/affiliate-payout/index.ts` lines 31-66 + 56-66 (Stripe lazy singleton)

**Stripe lazy singleton pattern** (analog lines 31, 55-66):
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
const STRIPE_SECRET_KEY = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';
let _stripeInstance: any = null;
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(STRIPE_SECRET_KEY(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}
```

**Pin notes:** `stripe@19` is the project lock (Phase 14 + Phase 19 standard). `apiVersion: '2026-04-22.dahlia'` per AFF spec. Do NOT bump — Phase 22 is composition, not a Stripe upgrade.

**Core ops:** `stripe.refunds.create({charge, amount, reason: 'requested_by_customer', idempotency_key})`, `stripe.subscriptions.update({cancel_at_period_end: true})`, comp = `stripe.subscriptions.update({trial_end: <future-unix>})`. Per CONTEXT line 79, write an audit_logs row PER admin action with the new enum values from migration 02.

**Suppress-audit guard:** per Pattern 4 below, set `app.suppress_audit` GUC before inline audit_log writes IF the admin RPC ALSO touches a trigger-attached sync table — otherwise duplicate audit rows.

---

#### `supabase/functions/dsar-export/index.ts` (orchestrator — Pattern 6)

**Analog:** `supabase/functions/account-delete/index.ts` (multi-step orchestrator, 517 lines, 10-step cascade with try/catch + per-step audit)

**Imports + env-read pattern** (analog lines 30-44):
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

**Multi-step orchestrator pattern (per account-delete header comment lines 1-29):** each step wrapped in try/catch + audit_logs append. External-API failures LOG + CONTINUE.

**DSAR-specific steps (per RESEARCH §Pattern 6):**
1. Create `dsar_requests` row `status='in_progress'`.
2. Aggregate Postgres rows via service-role SELECT (whitelist keys per `src/lib/export-data.ts` lines 37-60 `EXPORT_WHITELIST_KEYS`).
3. SHA-256 hash referred-user emails: `select encode(digest(email::bytea, 'sha256'), 'hex') from ...` (per audit-trigger migration 20260601000017 line 59 — same digest invocation).
4. Render JSON + PDF (PDF via `pdf-render.ts` — see below).
5. ZIP via Deno stdlib `archive` OR `https://deno.land/x/zipjs` (RESEARCH §Don't Hand-Roll).
6. Upload to `dsar-exports/{user_id}/{request_id}.zip` via service-role.
7. Sign 7-day TTL URL via `admin.storage.from('dsar-exports').createSignedUrl(path, 7*86400)`.
8. Invoke `lifecycle-transactional` function with `template='dsar_ready'` + signed URL.
9. UPDATE `dsar_requests` row to `status='completed', completed_at=now()`.

**Gotcha (gateway Content-Type):** per `reference_supabase_edge_function_deploy.md`, Supabase Gateway overrides response `Content-Type` to `text/plain` AND injects `CSP: sandbox`. The DSAR PDF download MUST be signed-URL-mediated (Storage bucket, not Edge Fn response body) — do NOT return the PDF bytes inline.

---

#### `supabase/functions/dsar-export/pdf-render.ts` (Deno-side jsPDF)

**Analog:** `leanshot/src/lib/export-data.ts` (browser jsPDF dynamic-import pattern, lines 23-32)

**Type-only import pattern** (analog lines 28-30):
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { jsPDF as JsPDFType } from 'jspdf';
import type autoTableFn from 'jspdf-autotable';
```

**Adapt for Deno:** Deno can `import` jspdf from esm.sh: `import { jsPDF } from 'https://esm.sh/jspdf@4?target=denonext';`. autoTable: `import autoTable from 'https://esm.sh/jspdf-autotable@5?target=denonext';`. Render the 7-section layout per CONTEXT D-06 (Profile / Subscriptions / Health Log / Photos / Sharing History / Affiliate Activity / Communications).

**Bundle-budget concern (analog lines 3-23):** does NOT apply here — this is a Deno Edge Function, not the browser bundle. Static import is fine. But preserve the seven-section structure exactly per D-06.

---

#### `supabase/functions/lifecycle-{welcome-series,behavior-triggered,transactional,retention,preference-update}/index.ts`

**Analog (CRON-invoked Edge Fn pattern):** `supabase/functions/affiliate-payout/index.ts` (cron-only, service-role-only)

**Analog (Resend dispatch pattern):** `supabase/functions/clinic-invite/resend.ts` + `supabase/functions/clinic-invite/template-clinic-invite.ts`

**Pattern (each lifecycle fn):**
1. `if (req.method !== 'POST') return jsonError(405, 'method');`
2. Constant-time bearer compare against `SUPABASE_SERVICE_ROLE_KEY` (affiliate-payout line 12 — V2 invariant).
3. `const health = await resendDomainHealthCheck(admin);` → if `!health.ok`, log + 200 (D-03 gate).
4. Query DB for eligible recipients (welcome: `auth.users WHERE created_at > now() - interval '1 day'`; behavior: from a trigger queue table; retention: `auth.users WHERE last_sign_in_at < now() - interval '7 days'`).
5. For each recipient: render template + POST to Resend (reuse `clinic-invite/resend.ts` direct-HTTPS pattern).
6. Audit-log per send.

**Cron triggers:** per RESEARCH line 343 (5 fns share D-03 check). Each gets its own pg_cron schedule:
- welcome-series: every 4 hours
- behavior-triggered: every 15 minutes (queue-drained)
- transactional: HTTP-invoked (no cron — webhook + admin triggers)
- retention: daily 06:00 UTC
- preference-update: HTTP-invoked from `/settings/email-preferences`

**Gotcha (Pitfall 8 from RESEARCH):** Templates are hand-coded HTML with inline `style="..."` — NO Tailwind, NO `<style>` blocks. Gmail strips them. Per UI-SPEC §Email Templates.

**Gotcha (filename regex):** All migration files for cron scheduling MUST follow the strict 14-digit regex (Pitfall 2 / `reference_supabase_migration_filename_regex.md`). No letter suffixes.

---

#### Edge Function `deno.json` files

**Analog:** `supabase/functions/affiliate-payout/deno.json` — copy verbatim. The bundler ignores `import_map.json` (per `reference_supabase_edge_function_deploy.md`), so use esm.sh URLs for all external deps.

---

### Wave D — Client libs

#### `leanshot/src/lib/admin/admin-impersonate.ts` (client wrapper)

**Analog:** `leanshot/src/lib/account-delete.ts` (RPC wrapper pattern, lines 23-71)

**Discriminated-error pattern** (analog lines 26-39):
```typescript
export type ImpersonationErrorCode = 'not_staff' | 'invalid_target' | 'session_expired' | 'unknown';
export class ImpersonationError extends Error {
  code: ImpersonationErrorCode;
  constructor(code: ImpersonationErrorCode, options?: { cause?: unknown }) {
    super(`impersonation:${code}`, options);
    this.name = 'ImpersonationError';
    this.code = code;
  }
}
```

**Invoke + sign-in flow:**
1. `const { data, error } = await supabase.functions.invoke('admin-impersonate', { body: { target_user_id } });`
2. On success, `data.action_link` is a magiclink URL — extract the `access_token` + `refresh_token` (hash params).
3. `await supabase.auth.setSession({ access_token, refresh_token });` swaps the session.
4. Per `reference_supabase_auth_traps.md`: watch the hash-route gotcha — DO NOT navigate to the magiclink URL; extract tokens server-side and pass via JSON.

**Gotcha:** Storing the admin's ORIGINAL JWT for "end impersonation" restore is the trickiest part. Plan-time decision: either re-mint admin via second magiclink call OR ask admin to re-login. Recommend: store the admin's `refresh_token` in `sessionStorage` BEFORE swapping, restore on end. **Plan-checker MUST flag this as a security-review item** — `sessionStorage` JWT is a known footgun.

---

#### `leanshot/src/lib/consent/consent-defer.ts` (Pattern 4 — bundle gate)

**Analog:** `leanshot/src/lib/sync-defer.ts` (full 270-line module is the analog)

**Pre-init buffer + idle-load + drain pattern** (analog lines 48-58, 211-226):
```typescript
const BUFFER_CAP = 64;
const buffer: ConsentCall[] = [];
let loadedApi: LoadedApi | null = null;
let loadingPromise: Promise<LoadedApi> | null = null;

export function scheduleConsentInit(): void {
  if (loadedApi || loadingPromise) return;
  const startLoad = (): void => {
    if (loadedApi || loadingPromise) return;
    loadingPromise = loadConsent();
    void loadingPromise.then((api) => { loadedApi = api; drain(); });
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startLoad, { timeout: 2000 });
  } else {
    setTimeout(startLoad, 100);
  }
}
```

**Why this pattern is non-negotiable** (analog lines 1-12 + `project_phase5_bundle_regression.md`): static import of vanilla-cookieconsent in `App.tsx`/`main.tsx`/`store.ts` is blocked by the bundle-size CI guard. Index ceiling 50 kB; currently at ~21 kB; vanilla-cookieconsent is ~5-7 kB gz. Static import would land it in the entry chunk.

**Type-only namespace import to prevent leakage** (analog lines 29-36):
```typescript
import type * as CookieConsentModule from 'vanilla-cookieconsent';
// NEVER import value — only type. import('vanilla-cookieconsent') inside loadConsent().
```

---

#### `leanshot/src/lib/consent/feature-flag-overrides.ts` (PostHog wrapper — D-08)

**Analog:** `leanshot/src/lib/feature-flags.ts`

**Wrap-and-override pattern** (per D-08 spec): `isFeatureEnabled(key)` checks `feature_flag_overrides` table first (with `expires_at > now()` filter), falls through to `posthog.isFeatureEnabled(key)`. Cache the override-row fetch keyed by user_id (Map pattern from `clinic-permissions.ts:25-37` per `billing.ts` comment line 5).

**Gotcha (Pitfall 10):** `expires_at > now()` MUST be in the SQL query, not client-side. Else expired rows leak.

---

#### `leanshot/src/lib/account-delete.ts` (MODIFY — toast copy 30d→7d)

**Self-analog** — only one substring changes. Lines 65-66 will need:
```diff
- toast("Account scheduled for deletion in 30 days. You've been signed out.", 'success');
+ toast("Account scheduled for deletion in 7 days. You've been signed out.", 'success');
```

**Pitfall 9 sweep:** `git grep "30 days" leanshot/src/ leanshot/e2e/` and update ALL hits. Known hits: `DeleteAccountModal.tsx` lines 99, 108, 137 + `account-delete.ts:66` + any RTL/Playwright test asserting on the string.

---

### Wave E — Admin UI

#### `leanshot/src/components/admin/pages/AdminMembersPage.tsx`

**Analog:** `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` (FULL FILE is the analog — same is_staff resolution, same Pill segmented filter, same Card+table layout, same Empty state)

**Imports pattern** (analog lines 22-30):
```typescript
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
```

**Is_staff client-gate pattern** (analog lines 82-108):
```typescript
const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
useEffect(() => {
  let cancelled = false;
  (async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) { if (!cancelled) setIsStaff(false); return; }
    const { data: profile } = await supabase
      .from('profiles').select('is_staff').eq('id', uid).maybeSingle();
    const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
    if (cancelled) return;
    setIsStaff(staff);
    if (!staff) return;
    // … fetch rows
  })().catch(() => { if (!cancelled) setIsStaff(false); });
  return () => { cancelled = true; };
}, []);
```

**Render guard** (analog lines 155-176): `if (isStaff === undefined) return null;` then a "not authorized" card. Reuse VERBATIM.

**Differences for Members:**
- Replace direct table query with `supabase.rpc('admin_list_members', { p_search, p_page, p_size })` (migration 20270601000011).
- Filter PillGroup: tier (all / free / paid / clinic_seat) instead of affiliate-status.
- Add per-row quick actions (CONTEXT line 136): Impersonate · Refund last charge · Cancel sub · Deactivate · Override flag · View full detail. Each is a Menu item or icon button — use existing `lucide-react` icons.

---

#### `leanshot/src/components/admin/members/MembersTable.tsx`

**Analog:** `leanshot/src/components/clinic/roster/RosterTable.tsx` (Phase 10 — 80+ lines; full table + sort + pagination + bulk-selection)

**Sort + pagination pattern** (analog lines 49-65):
```typescript
const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 30_000;
type SortColumn = 'tier' | 'signup_date' | 'last_active_at' | 'email';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection; clickCount: number; }
const DEFAULT_SORT: SortState = { column: 'signup_date', direction: 'desc', clickCount: 0 };
```

**Adapt:** Drop bulk-selection (CONTEXT defers bulk admin actions to v1.3 per Deferred Ideas line 30). Drop realtime patching (RPC re-fire on filter change is enough at v1.2). Keep the 3rd-click-revert-to-default sort behavior (good UX).

---

#### `leanshot/src/components/admin/members/RefundModal.tsx` (typed-confirm pattern)

**Analog:** `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (typed-confirmation gate, lines 24-143)

**Typed-confirm gate pattern** (analog lines 42-57, 110-123):
```typescript
const [typed, setTyped] = useState('');
const [busy, setBusy] = useState(false);
const [inlineError, setInlineError] = useState<string | null>(null);
const canConfirm = typedConfirmMatches(typed, expectedConfirmString) && !busy;

<Input
  label="Type REFUND to confirm"
  value={typed}
  onChange={(e) => { setTyped(e.target.value); if (inlineError) setInlineError(null); }}
  autoComplete="off" spellCheck={false} autoCapitalize="off"
  placeholder="REFUND"
  error={inlineError ?? undefined}
  disabled={busy}
/>
```

**Adapt for 3-step modal** (per CONTEXT line 139): step 1 charge picker, step 2 amount input, step 3 typed-confirmation + submit. Reuse `<Modal size="md">` + `<Button variant="destructive">`. CancelSubModal follows the same shape.

---

### Wave F — Cross-cutting overlays

#### `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (MODIFY)

**Self-analog** (Phase 7 file) — copy sweep + flow extension.

**Changes per Pitfall 9 + DEL-01:**
1. Line 99: `"This starts a 30-day soft-delete. For 30 days..."` → `"This starts a 7-day soft-delete. For 7 days..."` (and update email cancel-link copy).
2. Line 107: `"Same-email re-signup during the 30-day window is blocked. After the window ends..."` → 7-day equivalent.
3. Line 137: `"Schedule deletion in 30 days"` → `"Schedule deletion in 7 days"`.
4. Add post-success: emit a Resend transactional email with cancel-link (via lifecycle-transactional function, template `deletion_scheduled`).

**Keep:**
- Typed-confirmation gate (lines 42-93)
- `recent_auth_required` inline-error handling (lines 71-77)
- `already_pending` toast + close (lines 79-83)

---

#### `leanshot/src/components/impersonation/ImpersonationBanner.tsx`

**Analog:** `leanshot/src/components/clinic/ClinicContextBar.tsx` (sticky context-aware top banner pattern)

**UI-SPEC §Color line 199-200 + §Typography line 110-117:** red `bg-[var(--color-danger)]`; one type size, one weight (`text-sm` 600); 48px tall (h-12); sticky at AppShell root; AppShell main shifts `pt-12` when banner mounted.

**Countdown logic:** read `app_metadata.impersonation_exp` from JWT claims; `useInterval(1000)` decrements; on hit zero, auto-call end-impersonation. **Reduced-motion check:** per `useReducedMotion.ts` pattern, skip the smooth countdown animation if `prefers-reduced-motion`.

---

#### `leanshot/src/components/consent/CookieConsentBootstrap.tsx`

**Analog:** None directly — invokes `scheduleConsentInit()` from `consent-defer.ts` (Wave D). Pattern is "mount, call schedule, render null" — a 5-line component. RESEARCH §Pattern 3 + 4 describe the wiring; analog code does not exist yet (this is the new pattern).

**Mount point:** `App.tsx` — wrap the entire dashboard in `<CookieConsentBootstrap />` sibling. Bootstrap renders null but kicks off the defer-loaded banner.

---

#### `leanshot/src/components/dsar/DsarPortalPage.tsx`

**Analog:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx` lines 240-294 (existing JSON/PDF export flow)

**Pattern (analog lines 259-294):**
```typescript
const handleExportPdf = async (): Promise<void> => {
  toast('Generating PDF...', 'info');
  try {
    // dynamic-import — bundle-budget compliance
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    // … aggregate + render
    doc.save(`leanshot-export-${todayStr()}.pdf`);
    toast('PDF exported', 'success');
  } catch (e) {
    console.error('[leanshot] PDF export failed', e);
    toast('PDF export failed', 'error');
  }
};
```

**Adapt for DSAR:** click "Request export" → POST `dsar-export` Edge Fn → poll `dsar_requests.status` → on `completed`, show "Download bundle" CTA pointing at signed URL. The PDF render is server-side, not client-side; the client just polls. Status display per UI-SPEC §`/settings/privacy/dsar`.

---

### Wave G — Tests

#### `leanshot/e2e/rls-{audit-logs-impersonation,feature-flag-overrides,consent-records,dsar-requests}.test.ts`

**Analog:** `leanshot/e2e/rls-audit-logs.test.ts` (gold-standard project-canonical RLS cross-tenant proof)

**Per-file slug-prefix pattern** (per `feedback_rls_per_file_slug_prefix.md`): each file declares its OWN `CROSS_TENANT_PREFIX = 'phase22-<table>-rls'` (analog lines 64-65 uses `phase7-audit-rls-a-${Date.now()}@leanshot.test`). Without per-file prefixes, vitest's file-parallelism causes test cross-contamination via shared cleanup hooks. **Plan-checker MUST verify each new RLS file has its own prefix constant.**

**Env-gating** (analog lines 30-36):
```typescript
const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;
```

**Two-user setup** (analog lines 62-99):
```typescript
const aRes = await adminClient.auth.admin.createUser({
  email: emailA, password: pwA, email_confirm: true,
});
const aClient = createClient(URL!, ANON!, {
  auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-<phase22-table>-a' },
});
await aClient.auth.signInWithPassword({ email: emailA, password: pwA });
```

**Storage key uniqueness** (analog line 83): each client gets a unique `storageKey`. Per `reference_rls_fixture_gotrueclient_flake.md`, supabase-js v2.105 has cross-contamination flake without unique storage keys. Use `'rls-impersonation-a'`, `'rls-impersonation-b'`, etc.

**Cleanup** (afterAll): delete created users via `admin.auth.admin.deleteUser(uid)`. Always include — concurrent CI runs accumulate orphans otherwise.

---

#### `leanshot/e2e/admin-impersonation-write-deny.test.ts`

**Analog:** `leanshot/e2e/rls-multi-table.test.ts` + `rls-audit-logs.test.ts`

**Test seam:** Use `admin.auth.admin.updateUserById` to write `app_metadata.impersonator_id`, then mint a magiclink, exchange for session via `setSession`. Attempt INSERT on `injections` — expect 42501. Repeat for all 17 trigger-tables (per Wave A migration 12). Use a single shared user pool, looped.

---

#### `leanshot/e2e/cron-finalize-7day.test.ts`

**Analog:** `supabase/migrations/20260601000013_finalize_account_deletions_cron.sql` lines 57-78 (the test-hook RPC `run_finalize_account_deletions_cron_now`)

**Pattern:** create a user, RPC `initiate_account_deletion()`, back-date `initiated_at = now() - interval '8 days'`, invoke `run_finalize_account_deletions_cron_now()`, assert auth.users row is gone. Phase 22 needs the same hook updated to use 7 days OR a NEW hook `run_finalize_account_deletions_cron_now_7d()` to keep both windows testable during the migration window.

---

## Shared Patterns (cross-cutting)

### Pattern S1: Is_staff client-gate + RLS dual-layer

**Source:** `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` lines 5-21 (header comment) + lines 82-108 (impl)
**Apply to:** Every `leanshot/src/components/admin/**` file
**Excerpt:**
```typescript
// Client-side gate: profiles.is_staff. The Edge Function + RLS policy are
// the SECURITY boundary; this client gate is UX-only.
const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
// … resolve via supabase.from('profiles').select('is_staff').eq('id', uid).maybeSingle()
if (isStaff === undefined) return null;
if (!isStaff) return <NotAuthorizedCard />;
```

**Why dual-layer:** Phase 15 established this — server-side RLS is the security boundary, client gate is UX-only. UI-bypassable, RLS-enforced. Documented in SiteSettingsPanel.tsx lines 1-30 + analog lines 5-9.

---

### Pattern S2: Edge Function lazy admin singleton + Proxy

**Source:** `supabase/functions/affiliate-payout/index.ts` lines 67-88 (verbatim — also in `account-delete/index.ts` lines 67-84)
**Apply to:** EVERY new Edge Function in Phase 22 (admin-impersonate, admin-stripe-action, dsar-export, all 5 lifecycle-*)
**Excerpt:** [see Wave C `admin-impersonate` section above for full snippet]

**Why mandatory:** Deno test suite sets env AFTER import. Eager singleton captures `''` and throws. Project-canonical fix — do NOT redesign.

---

### Pattern S3: Resend direct-HTTPS dispatch + `test-stub` short-circuit

**Source:** `supabase/functions/clinic-invite/resend.ts` lines 35-90
**Apply to:** All 5 lifecycle-* functions + dsar-export (delivery email)
**Excerpt:** [see Wave B section]

**Why direct-HTTPS over SDK:** smaller bundle, smaller supply-chain surface (per `reference_resend_phase9_wiring.md`). NEVER echo `res.text()` or exception messages (PII safety T-09-34/T-09-37).

---

### Pattern S4: `app.suppress_audit` GUC guard before inline audit_log writes

**Source:** `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` + `supabase/migrations/20260601000018_finalize_apply_suppress_guc.sql`
**Apply to:** Any SECURITY DEFINER RPC in Phase 22 that BOTH writes to audit_logs inline AND touches trigger-attached sync tables (`admin_stripe_action` RPC, `cancel_account_deletion` RPC, `admin_set_feature_flag_override` RPC, DSAR-related RPCs)
**Excerpt:**
```sql
create or replace function public.admin_<op>(...) returns ...
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  perform set_config('app.suppress_audit', 'true', true);  -- transaction-local
  insert into public.audit_logs (...) values (...);
  -- … rest of operation; trigger fires are suppressed
end;
$$;
```

**Why mandatory:** without this, the audit trigger double-fires creating duplicate skeleton rows (per `reference_supabase_migration_gotchas.md` finding 4 + analog migration lines 1-36).

---

### Pattern S5: RLS test fixture per-file slug-prefix

**Source:** `feedback_rls_per_file_slug_prefix.md` + `leanshot/e2e/rls-audit-logs.test.ts` lines 62-99
**Apply to:** All 5 new RLS test files in Wave G
**Excerpt:** Each file declares a FILE-SCOPED constant:
```typescript
const CROSS_TENANT_PREFIX = 'phase22-impersonation-rls';  // unique per file
const emailA = `${CROSS_TENANT_PREFIX}-a-${Date.now()}@leanshot.test`;
const storageKeyA = `${CROSS_TENANT_PREFIX}-a`;
```

**Why mandatory:** vitest file-parallelism causes shared-prefix fixtures to clobber each other in afterAll cleanup. Validated empirically in Phase 15 closeout (project memory).

---

### Pattern S6: Status-machine transition-owner audit (planner pre-flight check)

**Source:** `feedback_status_machine_transition_owner.md`
**Apply to:** Every new enum or status field in Phase 22 — specifically:
- `dsar_requests.status` (pending | in_progress | completed | rejected)
- `consent_records` (implicit active/revoked via `revoked_at`)
- `pending_account_deletions` (implicit pending/finalized — no field, existence-based)
- `feature_flag_overrides.expires_at` (implicit active/expired)
- `affiliate_conversions.status` (Phase 19 inherited — P22 ADMIN-06 must write the `pending → confirmed` transition; Critical Conflict #1)

**Plan-checker action:** for EACH status field, list the plans+tasks that write EACH value. Missing writer = BLOCKER. The Phase 19 BL-11 lesson: `confirmed` had no writer, so payouts shipped dead.

---

## No Analog Found

These files have NO close codebase analog — planner should use RESEARCH.md patterns:

| File | Role | Data Flow | Why No Analog |
|------|------|-----------|---------------|
| `leanshot/src/components/admin/cohorts/CohortHeatmap.tsx` | UI component | read | First CSS-grid heatmap in repo; spec is RESEARCH §Architecture + UI-SPEC `/admin/cohorts`. Use CSS-grid + `color-mix(in srgb, var(--color-primary) {N}%, var(--color-surface))` per UI-SPEC §Color line 194. |
| `leanshot/src/components/impersonation/useImpersonationReadOnly.ts` | hook | UI | First disabled-props provider in repo. Pattern in RESEARCH §Pattern 1 lines 392-407. |
| `leanshot/src/components/consent/consent-config.ts` | config | UI | First vanilla-cookieconsent integration. Pattern in RESEARCH §Pattern 3 lines 452-511. |
| `leanshot/src/components/consent/CookieConsentBootstrap.tsx` | UI bootstrap | event-driven | 5-line invoker — no analog needed; uses `consent-defer.ts` from Wave D. |
| `leanshot/e2e/cookie-consent-banner.spec.ts` | Playwright | UI | First cookie-consent e2e in repo. Pattern: mount marketing route → assert banner visible → click "Reject all" → assert `cc_cookie` cookie present → assert PostHog NOT loaded (no `window.posthog`). |
| `leanshot/e2e/cron-finalize-7day.test.ts` | cron integration | cron | First 7-day cron test; partial-analog from Phase 7 hook RPC pattern. |
| `supabase/migrations/20270601000012_impersonation_write_deny_policies.sql` | RLS-policy | cross-table | First `request.jwt.claims`-reading RLS policy in repo. Pattern in RESEARCH §Pattern 1 lines 376-388 + Pitfall 1. |
| `supabase/functions/admin-impersonate/index.ts` | edge fn | request-response | First JWT-mint Edge Function. Pattern in RESEARCH §Pattern 1; uses `admin.auth.admin.updateUserById` + `admin.auth.admin.generateLink`. |

---

## Pre-emptive Planner Warnings (apply to ALL plans)

Per `feedback_planner_iter1_anti_patterns.md` + Phase 19 BL-10/BL-11/BL-13 lessons:

1. **Migration filename regex:** Strict 14-digit timestamp + `_name.sql`. NO letter suffixes. Plan-checker BLOCKER per `reference_supabase_migration_filename_regex.md`. Always `grep "^Skipping" supabase db push --dry-run output` before live push.

2. **Enum-add-in-same-tx:** Per Pitfall 3 / sqlstate 55P04. Phase 22 splits enum extension into migration 02 (ADD VALUE only) and downstream migrations (USE values). Same-tx use is a BLOCKER.

3. **Status-machine writer audit:** Per Pattern S6, every enum value needs an owning plan+task that writes it. Missing writer = ship-dead feature. Plan-checker required step.

4. **Shared-file choreography:** Multiple plans touching `App.tsx`, `SettingsPage.tsx`, `useStore.ts`, or any single audit_logs migration MUST be sequenced (single writer per file per wave). Per `feedback_parallel_executor_git_isolation.md`, always use `git commit -- <pathspec>` in parallel executor waves OR worktrees.

5. **Worktree base drift:** Per `reference_worktree_base_drift_recovery.md`, bake a `test -f <wave-N-file> || exit 1` verification AFTER each agent's HEAD-reset block. Wave-2+ agents can spawn off stale commits.

6. **Bundle-budget regression:** ANY direct static import of vanilla-cookieconsent / jspdf / heavy SDKs in `App.tsx`, `main.tsx`, `store.ts`, or any module on the static import graph of those = blocked by `scripts/assert-bundle-budget.sh`. ALL of these MUST go through dynamic-import gates (sync-defer pattern for cookie consent, dynamic-import-in-click-handler for jsPDF).

7. **RLS test fixture prefix:** Per Pattern S5, each new RLS file declares its own per-file prefix constant. NO shared `TEST_SLUG_PREFIX`.

8. **Vendor pass deferred:** Per CONTEXT D-03 + RESEARCH §Runtime State Inventory line 681, Resend `app.leanshot.app` domain verify is a deferred-vendor-pass blocking ON-02 send. Build code path normally; health-check pattern (Wave B) gates the actual send. Document as Phase 22 closeout vendor pass.

9. **`it.fixme` is not a function:** Per `reference_vitest_skip_fixme.md`, in vitest 4 use `it.skip(...)` not `it.fixme(...)`. Applies to any deferred test.

10. **Edge Function gateway override:** Per `reference_supabase_edge_function_deploy.md`, Supabase Gateway overrides response `Content-Type` to `text/plain` + injects `CSP: sandbox`. DSAR PDF MUST deliver via signed URL (Storage), not inline Edge Fn response body.

---

## Metadata

**Analog search scope (top-level dirs scanned):**
- `/Users/karstenhaldan/minisite/leanshot/src/` (full)
- `/Users/karstenhaldan/minisite/leanshot/e2e/` (full)
- `/Users/karstenhaldan/minisite/supabase/migrations/` (full — 79 files)
- `/Users/karstenhaldan/minisite/supabase/functions/` (24 functions + shared)

**Files actually opened and read:** 14
- `22-CONTEXT.md` (full)
- `22-RESEARCH.md` (lines 1-800 of 1181)
- `AdminAffiliatesScaffold.tsx` (lines 1-300 of 379)
- `DeleteAccountModal.tsx` (full 143)
- `clinic-invite/resend.ts` (full 90)
- `account-delete/index.ts` (lines 1-100)
- `affiliate-payout/index.ts` (lines 1-100)
- `pending_account_deletions.sql` (full)
- `finalize_account_deletions_cron.sql` (full)
- `audit_logs.sql` (full)
- `audit_trigger_suppress_guc.sql` (full)
- `profiles_is_staff.sql` (full)
- `account-delete.ts` (full 108)
- `sync-defer.ts` (full 270)
- `export-data.ts` (lines 1-80)
- `SettingsPage.tsx` (lines 240-294)
- `RosterTable.tsx` (lines 1-80)
- `SiteSettingsPanel.tsx` (lines 1-60)
- `affiliate_click_baseline_mv.sql` (full)
- `click_baseline_refresh_cron.sql` (full)
- `rls-audit-logs.test.ts` (lines 1-100)

**Files cited by path (not opened — analog by structure):**
- `extend_audit_action_enum_phase10.sql`, `audit_logs_share_columns.sql` — referenced for enum-extend + column-extend pattern shapes
- `rank_org_patients_rpc.sql`, `log_clinic_view_rpc.sql` — RPC pattern
- `ClinicContextBar.tsx`, `ClinicDrillInPage.tsx` — sticky-banner / drill-in patterns
- `feature-flags.ts`, `clinic-permissions.ts`, `billing.ts`, `affiliate/api.ts` — client wrapper patterns

**Pattern extraction date:** 2026-05-16
