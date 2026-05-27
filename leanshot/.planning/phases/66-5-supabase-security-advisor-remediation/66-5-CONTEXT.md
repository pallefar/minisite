# Phase 66.5: Supabase Security Advisor Remediation — Context

**Gathered:** 2026-05-27
**Status:** Ready for planning
**Mode:** Compressed-discuss (mid-run insertion; prescriptive findings from `supabase db advisors`)

## Phase Boundary

Fix the 11 ERROR-level + 16 mutable-search_path findings surfaced by `npx supabase db advisors --linked --type security` on 2026-05-27. Source-of-truth: `leanshot/.planning/phases/66-consumer-account-security/66-SUPABASE-ADVISORS.json` (725 entries).

## Findings to Address (29 total)

### Group A — 7 RLS-disabled public tables (ERROR)

Each needs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + at least one policy:

| Table | Current writers | Proposed policy |
|-------|----------------|-----------------|
| `email_send_counters` | Edge Fns (service_role) | Deny-all to authenticated; service_role bypass (default) |
| `ad_spend_facts_y2026m05` | Ad ETL Edge Fn (service_role) | Deny-all to authenticated; service_role bypass |
| `ad_spend_facts_y2026m06` | same | same |
| `ad_spend_facts_y2026m07` | same | same |
| `ad_spend_facts_y2026m08` | same | same |
| `paywall_events` | Web/Edge Fn (service_role) | Deny-all to authenticated; service_role bypass |
| `plan_history` | Stripe webhook (service_role) | Deny-all to authenticated; service_role bypass |

All 7 follow the same shape (deny-all + service-role bypass). One migration handles all.

### Group B — 2 SECURITY DEFINER views (ERROR)

| View | Why SECDEF | Resolution |
|------|-----------|------------|
| `v_cancellation_offers_roi` | Aggregates revenue across orgs; likely admin-dashboard read | Drop SECDEF qualifier; rely on `WITH SECURITY INVOKER` (PG15+ default) + ensure admin-only RLS on underlying tables |
| `share_snapshot_view` | Patient → doctor share snapshots; also exposes auth.users | Drop SECDEF; refactor query to NOT join `auth.users` directly (use `profiles` table or denormalize email) |

### Group C — 2 auth.users-exposing views (ERROR — overlaps Group B for share_snapshot_view)

| View | Exposes | Resolution |
|------|---------|------------|
| `share_snapshot_view` | `auth.users.*` to anon/auth | Refactor query — drop `auth.users` join; use `public.profiles` for email/display name (per [[reference_profiles_email_vs_auth_users_email]]) |
| `user_activity_daily` | `auth.users.email` likely | Same — drop auth.users join; use profiles |

### Group D — 16 mutable-search_path functions (WARN, included in 66.5 scope)

Listed verbatim in 66.5-PLAN-02. Fix: `ALTER FUNCTION public.<fn>(<sig>) SET search_path = public, pg_temp;`

## Decisions

### D-01 — Policy shape for Group A (7 tables)
**Choice:** Identical "deny-all to authenticated; service_role bypass" pattern. Specifically:
```sql
alter table public.<t> enable row level security;
create policy "<t>_no_direct_read" on public.<t> for all to authenticated using (false) with check (false);
-- service_role bypass is automatic (RLS-exempt)
```
Rationale: all 7 tables are written only by Edge Fns / cron. None should be reachable via PostgREST.

### D-02 — `share_snapshot_view` refactor (Groups B+C)
**Choice:** Rewrite the view to use `public.profiles` instead of `auth.users`. Drop SECDEF qualifier. The view already exists at remote so the refactor migration is a `CREATE OR REPLACE VIEW`. If the share-snapshot flow REQUIRES auth.users data (e.g. unique constraints not in profiles), defer to a SECDEF function returning rows.

### D-03 — `v_cancellation_offers_roi` refactor
**Choice:** Drop SECDEF qualifier; the underlying tables already have admin-restricted RLS. Verify with a `\d v_cancellation_offers_roi` before the migration that the new invoker-rights version returns the same rows for an admin user.

### D-04 — `user_activity_daily` refactor (Group C)
**Choice:** Determine if auth.users.email is needed; if yes, replace with `profiles.email` (per `[[reference_profiles_email_vs_auth_users_email]]` profiles HAS no email column → need to JOIN auth.users via SECDEF function). Most likely the view doesn't need email and can drop the join entirely.

### D-05 — `search_path` fix migration
**Choice:** One migration `ALTER FUNCTION` over all 16. Use full signatures from `pg_proc`.

### D-06 — Deploy gate (same as Phase 65 + 66)
**Choice:** Phase 66.5 ships migrations to main but the actual `db push` defers to Phase 70 once Phase 65's `org_subscriptions` drift is resolved. Migrations are forward-dated `20290106000001-000003`.

### D-07 — WARN-level (714) deferred to Phase 69.5
**Choice:** Per user direction. WARN-level is mostly noise (SECDEF functions inherent to Supabase patterns; anon-policies that ARE intentional like privacy_optout_requests; etc.). Tackled at final tech-debt sweep with explicit per-category triage.

## Code Context

- Full advisor report: `leanshot/.planning/phases/66-consumer-account-security/66-SUPABASE-ADVISORS.json`
- Existing RLS pattern: see `supabase/migrations/20290105000001_auth_attempts_log.sql` (Phase 66-01) for the deny-all-to-authenticated + service-role-bypass shape
- Existing search_path pattern: see `supabase/migrations/20290105000002_mfa_role_requirements.sql` (Phase 66-01) for `SET search_path = public` in SECDEF RPC
- `profiles` table schema: per `[[reference_profiles_email_vs_auth_users_email]]` — no `email` column; join auth.users via SECDEF function if needed
