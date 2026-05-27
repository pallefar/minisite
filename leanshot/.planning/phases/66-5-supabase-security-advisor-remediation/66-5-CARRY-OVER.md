---
phase: 66.5
status: code-complete (remote-deploy-deferred)
audience: Phase 69.5 (WARN-level cleanup) + Phase 70 milestone UAT operator
---

# Phase 66.5: Supabase Security Advisor Remediation — CARRY-OVER

## 1. Inherited from Phase 65 BLOCKER

`org_subscriptions` remote schema-tracking drift — Phase 65 § 1 of 65-CARRY-OVER.md still blocking. Until operator runs psql + resolves the drift, Phase 65 + 66 + 66.5 migrations all remain unapplied on remote.

## 2. Deploy Sequence (after Phase 65 drift cleared)

1. `npx supabase db push --linked` — applies 10 Phase 65 + 2 Phase 66 + 3 Phase 66.5 migrations.
2. Re-run advisor:
   ```bash
   npx supabase db advisors --linked --type security --level error \
     --output-format json | jq 'length'
   ```
   **Expected: 0** (all 11 ERROR findings cleared).
3. Verify search_path:
   ```bash
   npx supabase db advisors --linked --type security \
     --output-format json | jq '[.[] | select(.name=="function_search_path_mutable")] | length'
   ```
   **Expected: 0**.
4. Smoke-test share-snapshot Edge Fn + admin cohort-retention RPC (both depend on the 2 revoked-from-anon/auth views).

## 3. WARN-level Findings (714) → Phase 69.5 Scope

Full per-category triage from `66-SUPABASE-ADVISORS.json`:

### 3a. SECDEF-executable functions (494 findings)

- `anon_security_definer_function_executable` × 238
- `authenticated_security_definer_function_executable` × 256

**Disposition:** Most are internal helper functions (e.g. `_is_org_member`, `_compute_wcag_contrast`) that should NOT be EXECUTE-granted to `public` or `authenticated`. Action:

```sql
-- Template per function:
revoke execute on function public.<fn>(<sig>) from public;
revoke execute on function public.<fn>(<sig>) from authenticated;
-- Then explicit grant if needed:
grant execute on function public.<fn>(<sig>) to <intended-role>;
```

Audit script: for each function in the findings, check if it's called from PostgREST `rpc/<fn>` paths. If NOT called via PostgREST, revoke from public/authenticated.

**Effort:** ~4-6 hours operator + careful per-function review. Splittable across Phase 69.5 plans.

### 3b. Anonymous-sign-in policies (179 findings)

`auth_allow_anonymous_sign_ins` — each is a policy that permits anon access. Many are by-design (anon-INSERT on `privacy_optout_requests`, cron job audit rows, etc.).

**Disposition:** Per-policy review with explicit justification comment. Categories:
- Public-write tables (legal opt-out, contact form): keep + document
- Cron infrastructure (`cron.job`, `cron.job_run_details`): managed by Supabase; ignore
- Public-read tables (e.g. published research): keep + document

### 3c. Matview-in-API (14 findings)

| Matview | Action |
|---------|--------|
| affiliate_click_baseline | Move to admin schema OR add RLS |
| user_activity_daily | Already revoked from anon/auth in 66.5-02; advisor may still flag (PostgREST visibility) — verify post-push |
| mv_clinic_alert_metrics | Move to admin schema |
| ad_revenue_normalized | Move to admin schema |
| leaderboard_matview | Keep (intentionally public for gamification) — document |
| experiment_results | Move to admin schema |
| affiliate_ratio_baseline | Move to admin schema |
| mv_clinic_dose_trend_population | Move to admin schema |
| community_space_leaderboard_matview | Keep (intentionally public) — document |
| insights_engagement_rollup | Move to admin schema |
| insights_dose_rollup | Move to admin schema |
| insights_body_metrics_rollup | Move to admin schema |
| insights_retention_rollup | Move to admin schema |
| insights_ai_interaction_rollup | Move to admin schema |

### 3d. Public buckets (4 findings)

| Bucket | Verify by-design? |
|--------|-------------------|
| event-covers | Likely yes (community events) |
| org-branding | Yes (clinic public branding) |
| org-logos | Yes |
| org-onboarding-assets | Marginal — review |

### 3e. Extensions in public schema (3 findings)

`pg_net`, `vector`, `pgtap`. Best practice: move to `extensions` schema. High operational effort (downstream function references break). Defer until v1.5 unless operator chooses to tackle.

### 3f. RLS policies that are always true (2 findings)

Both on `privacy_optout_requests` — Phase 64 by-design anon-INSERT for CCPA/CDPA opt-out form. Document with comment in migration.

### 3g. Auth settings (2 findings)

- `auth_leaked_password_protection` — Toggle in Supabase Studio. Operator-only.
- `auth_insufficient_mfa_options` — WebAuthn deferred per Phase 66 carry-over.

## 4. supabase db lint Findings (35 ERROR-level, NOT in Phase 66.5 scope)

`npx supabase db lint --linked --level warning` shows 35 RPC bodies with broken references (tables / columns / functions that don't exist on remote). Examples:

| Function | Broken reference |
|----------|------------------|
| public.admin_list_members | relation "public.orgs" does not exist |
| public.admin_compute_mrr_arr | relation "public.orgs" does not exist |
| public.run_ad_etl_gap_detection | relation "public.admin_notifications" does not exist |
| public.p39_pharma_nps_kill_scan | relation "public.review_submissions" does not exist |
| public.get_cac_summary | function public.is_admin(uuid) does not exist |
| public.send_org_invite (+ 3 more) | function public.log_admin_action does not exist |
| public.event_rsvp_create | function public.can_see_community_space does not exist |
| public.evaluate_challenge_progress_for_user | function public.grant_xp_for_action does not exist |
| public.resolve_clinic_slug | type "citext" does not exist |

**Disposition:** Same root cause as Phase 65 `org_subscriptions` drift — these RPCs reference dependencies that were `migration repair`-marked-applied without actual execution. Operator must do a wholesale drift audit:

```sql
-- Query 1: List all "applied" migrations vs actual presence
select version, name from supabase_migrations.schema_migrations
where version like '2026%' or version like '2027%'
order by version desc;

-- Query 2: For each suspicious table reference, check existence
select to_regclass('public.orgs'),
       to_regclass('public.admin_notifications'),
       to_regclass('public.review_submissions'),
       to_regclass('public.organizations');
-- ... etc per file
```

Per `[[reference_supabase_migration_list_applied_vs_table_missing]]` — operator can either re-apply the source migration manually OR delete the false tracking row.

This is **Phase 70 milestone UAT scope**, not Phase 66.5.

## 5. CI Gate Recommendation

Phase 67 or Phase 69.5 should add:

```yaml
# .github/workflows/supabase-advisor.yml
- name: Supabase Security Advisor
  run: |
    npx supabase db advisors --linked --type security --level error --fail-on error
```

This will block any future PR that re-introduces an ERROR-level finding.

## 6. Lessons This Phase

1. **Self-discovery security audits scale better than once-yearly external pentests** — running advisor early in v1.4 surfaced 11 ERRORs that were sitting on remote for months across Phase 8, 22, 40 surfaces.
2. **DO-block drift-safe migrations are the right default** when the production schema has accumulated `migration repair` history — `[[reference_postgres_do_block_drift_safe_migration]]`.
3. **529 Overloaded mid-execution is recoverable inline** — `[[feedback_orchestrator_inline_completes_returned_executor]]` proved its worth again. The original plan body had a more complex Task 2 (SELECT-body rewrite); the inline rescue chose a simpler `ALTER VIEW SET (security_invoker = on)` patch that addresses the same advisor findings without touching view semantics.
