# Phase 27: Modular Admin Shell Extensions — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 26 new files (8 migrations · 3 Edge Fns · 7 client-lib · 8 UI components — tests are co-located, sketched per file)
**Analogs found:** 24 / 26 exact-or-role-match; 2 net-new (cmdk wrapper, JSONB rule-tree-to-SQL translator)

**Layout reminder:**
- Supabase DB + Edge Fns live at `/Users/karstenhaldan/minisite/supabase/{migrations,functions}` — NOT under `leanshot/`. New migrations + functions go there.
- Client + tests live at `/Users/karstenhaldan/minisite/leanshot/src/`.

---

## File Classification

| New file | Role | Data flow | Closest analog | Match quality |
|----------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_admin_bulk_jobs.sql` | DB-migration / table+RLS | append-only CRUD | `supabase/migrations/20260601000001_audit_logs.sql` | exact (negative-RLS denial pattern) |
| `supabase/migrations/<ts>_cohort_definitions.sql` | DB-migration / table+enum+RLS | CRUD | `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` (header conventions) + `20270601000019_admin_affiliate_review_rpcs.sql` (enum-via-CHECK + drop/re-add) | role-match |
| `supabase/migrations/<ts>_cohort_membership_matview.sql` | DB-migration / matview | batch refresh | `supabase/migrations/20270601000008_user_activity_daily_matview.sql` + `20270101000007_affiliate_click_baseline_mv.sql` | exact (matview + UNIQUE index + grant pattern) |
| `supabase/migrations/<ts>_anomaly_tracked_funnels.sql` | DB-migration / config table + seed | CRUD | `supabase/migrations/20270101000010_affiliate_landing_template_seeds.sql` (table+seed pattern, search the file) — fallback: any P19 table | role-match |
| `supabase/migrations/<ts>_funnel_anomaly_alerts.sql` | DB-migration / append-only table + Realtime pub | event-driven (broadcast) | `supabase/migrations/20260513000000_injections.sql` lines 84–98 (Realtime publication idempotent wrap) + `20260601000001_audit_logs.sql` (append-only RLS) | exact (compose both) |
| `supabase/migrations/<ts>_bulk_action_undo_token.sql` | DB-migration / TTL transient table | CRUD with purge | `supabase/migrations/20260601000010_pending_account_deletions.sql` (TTL table) — search file; fallback: composition of audit_logs RLS + pg_cron | role-match |
| `supabase/migrations/<ts>_secdef_rpcs.sql` (7 RPCs) | DB-migration / SECDEF functions | request-response | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` (3-RPC analog, same shape: is_staff gate + suppress_audit + audit_logs INSERT) | exact |
| `supabase/migrations/<ts>_cron_schedules.sql` | DB-migration / pg_cron | scheduled | `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` (HTTP-post crons) + `20270101000009_click_baseline_refresh_cron.sql` (in-DB SQL crons) | exact |
| `supabase/functions/admin-bulk-job-worker/index.ts` | Edge Fn / worker | poll-claim batch | `supabase/functions/affiliate-payout/index.ts` (lazy Stripe + Proxy admin pattern; SQS-style poll) | exact |
| `supabase/functions/funnel-anomaly-cron/index.ts` | Edge Fn / cron tick | scheduled → DB write + email | `supabase/functions/lifecycle-retention/index.ts` + `_shared/lifecycle-utils.ts` (makeLazyAdmin + checkServiceRoleBearer) | exact |
| `supabase/functions/bulk-undo-token-purge/index.ts` | Edge Fn / cron purge | scheduled DELETE | `supabase/functions/lifecycle-retention/index.ts` (thin cron Edge Fn) — purge can also be pure SQL inside `cron_schedules.sql` if no HTTP-post needed | role-match |
| `src/lib/cohort/rule-tree-schema.ts` | client-lib / zod schema | validate | `src/lib/page-builder/block-schema.ts` (single source of truth + enum + isReserved helper) | exact |
| `src/lib/cohort/rule-tree-to-sql.ts` | client-lib / translator | transform | **NO ANALOG** — net-new recursive JSONB→SQL walk. Mirror translator runs inside the matview-refresh RPC at DB layer. See "No Analog Found" §. |
| `src/lib/cohort/api.ts` | client-lib / RPC wrapper | request-response | `src/lib/admin/affiliate-review.ts` (RPC + discriminated error + mapRpcError) | exact |
| `src/lib/admin/bulk/action-handlers.ts` | client-lib / dispatch | request-response | `src/lib/admin/admin-stripe-actions.ts` (action-per-RPC dispatcher) + `src/lib/admin/affiliate-review.ts` (error contract) | role-match |
| `src/lib/admin/bulk/undo.ts` | client-lib / token lifecycle | request-response | `src/lib/admin/affiliate-review.ts` (callReviewRpc shape) | role-match |
| `src/lib/admin/palette/index-builder.ts` | client-lib / aggregator | transform | `src/components/admin/AdminLayout.tsx` lines 29–34 (ADMIN_NAV array shape) — Phase 24 will deliver `src/lib/admin/modules.ts`; index-builder consumes it. | role-match |
| `src/lib/admin/palette/aal2-step-up.ts` | client-lib / Auth helper | request-response | **NO ANALOG** — greenfield. `grep aal2` returns zero hits in repo. Pattern source: Supabase Auth `mfa.challengeAndVerify` (verified via Context7 at research time). |
| `src/components/admin/AdminBulkActionsBar.tsx` | UI component / toolbar | request-response | `src/components/clinic/roster/RosterBulkSelectionBar.tsx` (sibling selection-bar) + `src/components/admin/members/MembersTable.tsx` (host table) | exact |
| `src/components/admin/AdminBulkConfirmModal.tsx` | UI component / modal | request-response | `src/components/clinic/roster/BulkExportCSVFlow.tsx` lines 92–135 (Modal + state-machine 'confirm'\|'running'\|'done'\|'error') | exact |
| `src/components/admin/AdminUndoBanner.tsx` | UI component / toast | event-driven (timer) | `src/components/ui/Toast.tsx` (`role="status"` + `aria-live="polite"` per CLAUDE.md) + `src/hooks/useToast.ts` | role-match |
| `src/components/admin/AdminCohortBuilder.tsx` | UI component / builder | CRUD (tree edit) | **NO ANALOG** (no nested-tree editor in repo). RESEARCH recommends hand-roll (no dnd-kit). Use `src/components/admin/pages/blocks/*.tsx` flat-tree edit pattern as nearest cousin. |
| `src/components/admin/AdminCohortList.tsx` | UI component / list | CRUD | `src/components/admin/AdminAffiliatesReviewQueue.tsx` (filter pill + row list + per-row action) | exact |
| `src/components/admin/AdminCommandPalette.tsx` | UI component / cmdk dialog | request-response | **NO IN-REPO ANALOG for cmdk**; use `src/components/ui/Modal.tsx` for `role="dialog"` shell + cmdk's own `Command.Dialog` for combobox semantics. Pattern source: cmdk Context7 docs. |
| `src/components/admin/AdminAnomalyBanner.tsx` | UI component / banner | event-driven (Realtime) | `src/components/clinic/roster/use-roster-realtime.ts` (channel.subscribe + cleanup) + `src/components/ui/Toast.tsx` (banner render) | exact (compose) |
| `src/components/admin/AdminAnomalyAcknowledgeQueue.tsx` | UI component / queue | CRUD | `src/components/admin/AdminAffiliatesReviewQueue.tsx` (verbatim shape — filter pills, action handlers, busy-row guard, expansion panel) | exact |

---

## Pattern Assignments

### Group A — DB migrations (`supabase/migrations/`)

> **Filename rule (load-bearing):** strict `<14-digits>_<name>.sql` per `[[reference_supabase_migration_filename_regex]]`. Letter suffixes are SILENTLY SKIPPED.

#### A1. `<ts>_admin_bulk_jobs.sql` — table + append-only RLS + service_role REVOKE

**Analog:** `supabase/migrations/20260601000001_audit_logs.sql` (lines 41–144)

**Header docblock pattern** (lines 1–39):
```sql
-- Phase 27 D-01 (admin_bulk_jobs — async bulk-action progress tracker).
--
-- Creates `public.admin_bulk_jobs`: enqueued bulk-action rows the
-- `admin-bulk-job-worker` Edge Function claims via SQS-style
-- `update ... returning` (Phase 19 affiliate-payout pattern).
--
-- Companion migrations: <ts>_secdef_rpcs.sql (admin_bulk_action_execute
-- inserts here for >100-row jobs).
```

**`enable row level security` + select-only policy + negative-space tampering mitigation** (lines 108–138):
```sql
alter table public.admin_bulk_jobs enable row level security;

-- SELECT: requesting admin sees only their own jobs.
create policy "admin_bulk_jobs_select_own"
  on public.admin_bulk_jobs
  for select
  using (auth.uid() = requested_by);

-- TAMPERING MITIGATION (Phase 24 D-23 carry):
-- NO INSERT/UPDATE/DELETE policy. The SECURITY DEFINER RPCs
-- `admin_bulk_action_execute` / worker updates are the only write paths.
-- Direct authenticated writes return 42501.
```

**`grant`/`revoke` posture:** Audit_logs has NO explicit revoke; for `admin_bulk_jobs` the worker writes via service_role. RPC writes via SECDEF (table-owner). Document the absence of authenticated INSERT/UPDATE/DELETE policies as the tamper mitigation.

---

#### A2. `<ts>_cohort_definitions.sql` — table + status enum-via-CHECK

**Analog:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` lines 61–67 (CHECK constraint enum, drop+re-add idiom)

**Status enum pattern** (so future migrations can extend):
```sql
alter table public.cohort_definitions
  add constraint cohort_definitions_status_check check (
    status in ('draft', 'active', 'archived')
  );
```

Per `[[feedback_planner_iter1_anti_patterns]]` Pitfall 3: prefer `text CHECK` over `create type ... as enum` (drop+re-add a CHECK is tx-safe; dropping an enum is not).

---

#### A3. `<ts>_cohort_membership_matview.sql` — matview + UNIQUE index + 2-step first refresh

**Analog:** `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` (full file) + `supabase/migrations/20270601000008_user_activity_daily_matview.sql` (full file)

**Header pitfall callout** (lines 12–25):
```sql
-- Landmines (reference_supabase_migration_gotchas):
--   - Pitfall 5: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index
--     on the view, OR the refresh fails. The `idx_cohort_membership_pk` index
--     below is the load-bearing line.
--   - Pitfall 1: date_trunc on timestamptz is STABLE not IMMUTABLE — fine inside
--     SELECT, NOT in an index predicate.
```

**Matview + UNIQUE index + grant pattern** (lines 27–52):
```sql
create materialized view public.cohort_membership as
-- one row per (user_id, cohort_id) for every cohort with status='active'
select
  c.id as cohort_id,
  p.id as user_id,
  now() as joined_at
from public.cohort_definitions c
cross join lateral (
  select id from public.profiles where /* translator output */ true
) p
where c.status = 'active';

-- Pitfall 5 load-bearing UNIQUE index for REFRESH CONCURRENTLY.
create unique index idx_cohort_membership_pk
  on public.cohort_membership (user_id, cohort_id);

grant select on public.cohort_membership to service_role;
-- Admin-only consumer reads (Phase 24 admin RPC routes); NO grant to authenticated.
```

**RESEARCH-corrected 2-step first refresh** (per 27-RESEARCH; the very first `refresh materialized view` for a newly-created matview canNOT be CONCURRENTLY — there's no prior snapshot to diff against):
```sql
-- Initial population MUST be non-concurrent (no prior snapshot).
refresh materialized view public.cohort_membership;
-- Subsequent refreshes (via pg_cron) use CONCURRENTLY for non-blocking reads.
```

---

#### A4. `<ts>_anomaly_tracked_funnels.sql` — config table + 5-row seed

**Analog:** `supabase/migrations/20270101000010_affiliate_landing_template_seeds.sql` (file exists per ls; same seed-via-`insert ... on conflict do nothing` pattern)

**Seed pattern:**
```sql
insert into public.anomaly_tracked_funnels (event_name, is_enabled, baseline_lookback_days, sigma_threshold)
values
  ('signup_completed',          true, 7, 2.0),
  ('activation_event',          true, 7, 2.0),
  ('payment_succeeded',         true, 7, 2.0),
  ('lifetime_grant',            true, 7, 2.0),
  ('helpdesk_ticket_resolved',  true, 7, 2.0)
on conflict (event_name) do nothing;
```

---

#### A5. `<ts>_funnel_anomaly_alerts.sql` — append-only RLS + Realtime publication

**Analog 1 (append-only RLS):** `supabase/migrations/20260601000001_audit_logs.sql` lines 108–138 (verbatim shape)

**Analog 2 (Realtime publication idempotent wrap):** `supabase/migrations/20260513000000_injections.sql` lines 84–98:
```sql
-- Realtime: enable publication membership so postgres_changes fires.
-- Idempotent wrapper: `supabase db push` may re-execute on retry, and
-- `alter publication ... add table` errors if the table is already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'funnel_anomaly_alerts'
  ) then
    execute 'alter publication supabase_realtime add table public.funnel_anomaly_alerts';
  end if;
end$$;
```

---

#### A6. `<ts>_bulk_action_undo_token.sql` — 60s TTL transient table

**Analog:** Compose `audit_logs` RLS pattern (`20260601000001_audit_logs.sql`) + index pattern. Add a timestamptz `expires_at` column; the `bulk-undo-token-purge` Edge Fn (or pure SQL cron) deletes rows where `expires_at < now()`.

**Pattern:**
```sql
create table public.bulk_action_undo_token (
  token uuid primary key default gen_random_uuid(),
  issued_to uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  reverse_payload jsonb not null,
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  created_at timestamptz not null default now()
);
create index idx_bulk_undo_expires on public.bulk_action_undo_token (expires_at);

alter table public.bulk_action_undo_token enable row level security;
-- NO policies — only SECDEF RPCs `admin_bulk_action_execute` (insert) and
-- `admin_bulk_action_undo` (select+delete) touch this table.
```

---

#### A7. `<ts>_secdef_rpcs.sql` — 7 SECDEF RPCs (one file, all 7)

**Analog:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` (3-RPC composition — copy verbatim shape × 7)

**Header docblock + alter-audit_logs-CHECK pattern** (lines 1–135 of analog) shows how to EXTEND `audit_logs.action_check` with new action names. Phase 27 adds 7 new actions:
- `bulk_action_executed`
- `bulk_action_undone`
- `cohort_defined`
- `cohort_archived`
- `palette_destructive_invoked`
- `anomaly_baseline_computed`
- `anomaly_acknowledged`

**Per-RPC SECDEF shape** (lines 145–203 of analog — copy verbatim per RPC):
```sql
create or replace function public.cohort_define(
  p_name text,
  p_rule jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_cohort_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Translator validation (mirror of TS zod schema; defense in depth).
  -- Reject if rule references any field outside the 15-field allowlist.
  -- ... recursive validator ...

  perform set_config('app.suppress_audit', 'on', true);

  insert into public.cohort_definitions (name, rule, status, created_by)
    values (p_name, p_rule, 'draft', v_caller)
    returning id into v_cohort_id;

  -- Use Phase 24 helper (correct column shape: actor_user_id, row_pk, table_name).
  -- Do NOT raw-insert into audit_logs — real columns are NOT user_id/row_id/user_id_hash.
  perform public.log_admin_action(
    p_action_name    => 'cohort_defined',
    p_target_user_id => null,
    p_table_name     => 'cohort_definitions',
    p_row_pk         => v_cohort_id::text,
    p_before         => null,
    p_after          => jsonb_build_object('name', p_name, 'rule', p_rule)
  );

  return v_cohort_id;
end;
$$;

revoke all on function public.cohort_define(text, jsonb) from public;
grant execute on function public.cohort_define(text, jsonb) to authenticated;
```

**Pitfall 4 (audit-suppression):** `set_config('app.suppress_audit', 'on', true)` is load-bearing — without it the audit trigger AND the explicit `audit_logs` INSERT both fire, producing duplicate rows. See `[[reference_supabase_migration_gotchas]]`.

---

#### A8. `<ts>_cron_schedules.sql` — pg_cron schedules

**Analog 1 (in-DB SQL cron):** `supabase/migrations/20270101000009_click_baseline_refresh_cron.sql` (full file) — for the matview refresh.

**Analog 2 (HTTP-post cron via net.http_post + Vault):** `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` lines 24–45 — for the anomaly-cron Edge Fn invocation.

**Matview refresh schedule (RESEARCH-corrected stagger `7,22,37,52` to avoid collision with anomaly cron at `*/5`):**
```sql
select cron.schedule(
  'cohort-membership-refresh',
  '7,22,37,52 * * * *',
  $$ refresh materialized view concurrently public.cohort_membership; $$
);
```

**Anomaly cron (HTTP-post pattern, copies lines 29–45 of analog):**
```sql
select cron.schedule(
  'funnel-anomaly-cron',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/funnel-anomaly-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```

**Collision verification:** D-16 already verified no collision (audit-archive day-1 03:00, BAA expiry day-1 06:00, subprocessor-diff Mon 07:00, affiliate-lifetime-recurring day-1 03:00, lifecycle-welcome `0 */4 * * *`, lifecycle-behavior `*/15 * * * *`). The 5-min anomaly tick collides with `*/15` at `0`/`15`/`30`/`45`. Acceptable (different functions; pg_cron parallelizes across job names). Matview stagger `7,22,37,52` deliberately offset from both.

---

### Group B — Edge Functions (`supabase/functions/`)

#### B1. `admin-bulk-job-worker/index.ts` — async bulk-action worker

**Analog:** `supabase/functions/affiliate-payout/index.ts` lines 33–88

**Lazy admin singleton + Proxy pattern** (lines 33–88) — copy verbatim. The Proxy is load-bearing: `setAdminForTest` works after import only because reads are deferred.

**Service-role bearer check + entry point** — copy from `supabase/functions/_shared/lifecycle-utils.ts` lines 93–99:
```ts
export function checkServiceRoleBearer(req: Request): boolean {
  const bearer = bearerFromReq(req);
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!bearer || !expected) return false;
  return constantTimeEqual(bearer, expected);
}
```

**SQS-style poll-claim pattern** — `update admin_bulk_jobs set status='running', claimed_by=... where status='pending' returning *` (analog: affiliate-payout claims pending payouts).

---

#### B2. `funnel-anomaly-cron/index.ts` — 5-min cron + email-router

**Analog:** `supabase/functions/lifecycle-retention/index.ts` lines 1–80 (full pattern)

**Imports + bootstrap** (lines 17–29):
```ts
import { resendDomainHealthCheck } from '../_shared/resend-domain-health-check.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
```

**Vendor-gated send pattern** — per `[[reference_vendor_gated_send_health_check]]`, every cron tick calls `resendDomainHealthCheck()` first and short-circuits with `200 + {skipped:true}` while Resend domain unverified.

**Idempotency on cron ticks** (per Phase 26 D-07): write a `funnel_anomaly_alerts` row keyed on `(funnel_id, tick_bucket_yyyymmddhhmm)` so a re-fire within the 5-min tick is a no-op. The 4h suppression check (D-18) is the outer gate.

**Alert payload:** `{funnel_id, fired_at, observed_count, expected_mean, expected_stddev, z_score}` per CONTEXT specifics. Broadcast on the `funnel_anomaly_alerts` channel (Realtime publication membership migrated in A5).

---

#### B3. `bulk-undo-token-purge/index.ts` — 1-min cron purge

**Analog:** Same `makeLazyAdmin` + `checkServiceRoleBearer` skeleton from `lifecycle-retention`. The handler body is one query:
```ts
const { error } = await admin
  .from('bulk_action_undo_token')
  .delete()
  .lt('expires_at', new Date().toISOString());
```

**ALTERNATIVE (simpler):** Skip the Edge Fn entirely. The purge is pure SQL; inline it as a `cron.schedule('bulk-undo-purge', '* * * * *', $$ delete from bulk_action_undo_token where expires_at < now(); $$);` in `<ts>_cron_schedules.sql`. RESEARCH-aligned: zero new HTTP surface, zero new vendor dependency. Recommend planner pick the SQL variant.

---

### Group C — Client-lib (`leanshot/src/lib/`)

#### C1. `src/lib/cohort/rule-tree-schema.ts` — zod schema + 15-field enum + MAX_DEPTH

**Analog:** `src/lib/page-builder/block-schema.ts` lines 1–60 (single source of truth + literal-union enum + helper export)

**Header pattern + literal-union enum** (lines 1–48):
```ts
/**
 * Phase 27 — Cohort rule-tree contract module.
 *
 * Single source of truth for the JSONB rule-tree shape:
 *   • `RuleField` — exhaustive 15-literal union (CONTEXT D-06).
 *   • `RuleOp` — comparison operator union.
 *   • `RuleLeaf` / `RuleBranch` / `RuleNode` — recursive tree.
 *   • `MAX_DEPTH = 8` — prevents pathological nesting.
 *   • `ruleTreeSchema` — zod validator (TS-side) + JSON-schema export
 *     consumed by the SECDEF RPC plpgsql validator.
 *
 * Imported by `rule-tree-to-sql.ts`, `AdminCohortBuilder.tsx`, and (mirrored,
 * not imported — Deno can't resolve `leanshot/src`) by the matview-refresh
 * RPC. Per `[[feedback_planner_iter1_anti_patterns]]` Pitfall 1: ONE TS type;
 * the plpgsql validator re-checks the same allowlist (defense in depth).
 */
export type RuleField =
  | 'tier' | 'role' | 'days_since_signup' | 'days_since_last_login'
  | 'total_paid_amount_cents' | 'active_streak_days'
  | 'has_active_subscription' | 'signup_source' | 'country'
  | 'language' | 'has_org' | 'has_completed_onboarding'
  | 'is_affiliate' | 'anomaly_flagged' | 'account_state';
```

---

#### C2. `src/lib/cohort/api.ts` — RPC wrapper

**Analog:** `src/lib/admin/affiliate-review.ts` (full file, lines 1–105)

**Discriminated error + mapRpcError + callReviewRpc pattern** (lines 19–82) — copy verbatim shape:
```ts
export type CohortApiErrorCode =
  | 'not_staff' | 'not_authenticated' | 'not_found'
  | 'invalid_rule' | 'duplicate_name' | 'network' | 'unknown';

export class CohortApiError extends Error {
  code: CohortApiErrorCode;
  constructor(code: CohortApiErrorCode, options?: { cause?: unknown }) {
    super(`cohort:${code}`, options);
    this.name = 'CohortApiError';
    this.code = code;
  }
}

async function callCohortRpc(
  rpcName: 'cohort_define' | 'cohort_archive' | 'cohort_is_member',
  params: Record<string, unknown>,
): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new CohortApiError(mapRpcError(error), { cause: error });
    }
    return data;
  } catch (e) {
    if (e instanceof CohortApiError) throw e;
    throw new CohortApiError('network', { cause: e });
  }
}
```

---

#### C3. `src/lib/admin/bulk/action-handlers.ts` — 5-action dispatch

**Analog:** `src/lib/admin/affiliate-review.ts` (RPC wrapper pattern) + dispatch via switch on action_type literal.

**Per-action handler:**
```ts
export async function executeBulkAction(
  action: 'csv_export' | 'tag' | 'comp_plan' | 'ban' | 'force_password_reset',
  targetFilter: TargetFilter,
  params: Record<string, unknown>,
): Promise<BulkActionResult> {
  // RPC dispatch; sync path returns inline, async path returns job_id.
  return await callBulkRpc('admin_bulk_action_execute', {
    p_action_type: action,
    p_target_filter: targetFilter,
    p_params: params,
  });
}
```

---

#### C4. `src/lib/admin/bulk/undo.ts` — 60s token issue/redeem

**Analog:** `src/lib/admin/affiliate-review.ts` (call shape). The token IS returned by the execute RPC inside the success response; `undo.ts` POSTs it back to `admin_bulk_action_undo(token)` which:
1. SELECT-FOR-UPDATE the row (expired-check),
2. invoke the reverse action,
3. DELETE the token (single-use).

---

#### C5. `src/lib/admin/palette/aal2-step-up.ts` — aal2 freshness check

**Analog:** **NONE in repo.** Pattern documented at Supabase docs (Context7-fetched at research time). Skeleton:
```ts
// Phase 27 D-12 — aal2 freshness gate for destructive palette actions.
// Defends against shoulder-surfing per Phase 24 D-07 (admins log in at aal2).
export async function assertAaL2Fresh(maxAgeMin = 15): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session?.access_token) return false;
  // Decode JWT (header.payload.signature) — read auth_time claim.
  const payload = parseJwtPayload(session.access_token);
  if (payload?.aal !== 'aal2') return false;
  const authTime = payload.auth_time as number | undefined;
  if (!authTime) return false;
  const ageMin = (Date.now() / 1000 - authTime) / 60;
  return ageMin < maxAgeMin;
}
```

If stale: caller invokes `supabase.auth.mfa.challengeAndVerify({factorId, code})` and re-checks. No existing analog — researcher recommends; planner adds. **Pattern caveat:** verify `auth_time` claim shape against Supabase Auth GoTrue version pinned in v1.3 (research found it MEDIUM-confidence).

---

#### C6. `src/lib/admin/palette/index-builder.ts` — palette index aggregator

**Analog:** `src/components/admin/AdminLayout.tsx` lines 21–34 (manifest array shape). Phase 24 will ship `src/lib/admin/modules.ts` exporting `ADMIN_MODULES`; index-builder consumes it, filters by `hasMinRole(adminRole, m.minRole)` AND `posthog.isFeatureEnabled(m.flagKey)`, returns `Command.Item[]`-ready list.

---

### Group D — UI components (`leanshot/src/components/admin/`)

#### D1. `AdminBulkActionsBar.tsx` — selection toolbar on Members table

**Analog:** `src/components/clinic/roster/RosterBulkSelectionBar.tsx` (sibling pattern). Hosts inside `src/components/admin/members/MembersTable.tsx`.

---

#### D2. `AdminBulkConfirmModal.tsx` — confirmation modal

**Analog:** `src/components/clinic/roster/BulkExportCSVFlow.tsx` lines 92–135 — verbatim state machine.

**Modal + state machine** (lines 25, 92–135):
```tsx
type FlowState = 'confirm' | 'downloading' | 'done' | 'error';

return (
  <Modal open onClose={onClose} title="Export symptoms as CSV" size="sm"
    hideClose={state === 'downloading'}
    dismissible={state !== 'downloading'}>
    {state === 'confirm' && (
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Ban <span className="font-semibold">{selectedIds.length}</span> users —
          {sampleNames.slice(0, 3).join(', ')}
          {selectedIds.length > 3 && `, +${selectedIds.length - 3} more`}.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void execute()}>Ban users</Button>
        </div>
      </div>
    )}
    {/* ... 'downloading' | 'done' | 'error' states ... */}
  </Modal>
);
```

---

#### D3. `AdminUndoBanner.tsx` — 60s undo toast

**Analog:** `src/components/ui/Toast.tsx` (CLAUDE.md confirms `role="status"` + `aria-live="polite"`) + `src/hooks/useToast.ts`. Add a setTimeout(60_000) that auto-dismisses + invalidates the token client-side (server-side TTL is the authority; client just hides the UI).

---

#### D4. `AdminCohortBuilder.tsx` — visual rule-tree builder

**Analog:** None for nested-tree editor. **Hand-roll recommended** per RESEARCH (no dnd-kit). Use recursive component pattern: `<RuleBranch>` renders children + `<RuleLeaf>` per leaf; add child / nest under / delete buttons inline. Read `src/components/admin/pages/blocks/*.tsx` for the closest in-repo precedent on block-tree editing semantics (flat array, not nested, but same structural-edit UX).

---

#### D5. `AdminCohortList.tsx` — cohort list + define/archive actions

**Analog:** `src/components/admin/AdminAffiliatesReviewQueue.tsx` lines 83–101 (status filter pill shape) + lines 121–199 (filter + rows + per-row action handler skeleton).

**isStaff probe + reload pattern** (lines 134–161) — copy verbatim:
```tsx
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
    await reload();
  })().catch(() => { if (!cancelled) setIsStaff(false); });
  return () => { cancelled = true; };
}, []);
```

**Action handler + error mapping** (lines 226–259) — copy verbatim. Swap `approveAffiliateConversion`/`hold`/`reject` for `defineCohort`/`archiveCohort`.

---

#### D6. `AdminCommandPalette.tsx` — cmdk-based palette

**Analog:** No in-repo cmdk. Use cmdk's `<Command.Dialog>` + `<Command.Input>` + `<Command.List>` per cmdk docs. Wrap aal2 step-up gate around destructive actions before dispatch.

---

#### D7. `AdminAnomalyBanner.tsx` — Realtime-subscribed banner in AdminLayout

**Analog:** `src/components/clinic/roster/use-roster-realtime.ts` (full file, lines 1–53) — verbatim channel.subscribe + cleanup.

**Hook pattern** (lines 27–52):
```ts
export function useAnomalyAlerts({ onAlert }: { onAlert: (p: AlertPayload) => void }): void {
  useEffect(() => {
    const handler = (broadcastPayload: any) => {
      const inner = broadcastPayload?.payload as AlertPayload | undefined;
      if (inner?.funnel_id && inner.z_score !== undefined) onAlert(inner);
    };
    const channel = supabase
      .channel('funnel_anomaly_alerts')
      .on('broadcast', { event: 'anomaly_fired' }, handler)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

**E2e verification pattern** (per `[[feedback_realtime_layer_e2e_pattern]]`): drive the Edge Fn write via test, subscribe directly via `supabase.channel(...)` in the test file. Do NOT traverse UI.

---

#### D8. `AdminAnomalyAcknowledgeQueue.tsx` — anomaly acknowledgment queue

**Analog:** `src/components/admin/AdminAffiliatesReviewQueue.tsx` (verbatim shape — filter pills by `resolution_status`, action = `funnel_anomaly_acknowledge` RPC, busy-row guard, lazy-load related side-tables on row expand). Replace conversion-row schema with alert-row schema.

---

## Shared Patterns

### S1. Dual-layer security (client gate + DB SECDEF re-check)

**Source:** `src/components/admin/AdminLayout.tsx` lines 1–63 + every SECDEF RPC (Group A7).
**Apply to:** Every new client RPC call (Group C) AND every new SECDEF function (A7).

Client-side `isStaff` probe (`AdminLayout` lines 135–149) is UX-only. The security boundary is the `if not public.is_staff() then raise exception 'forbidden' using errcode = '42501';` inside each SECDEF. Mirror this in EVERY new RPC.

### S2. Append-only RLS (negative-space tampering mitigation)

**Source:** `supabase/migrations/20260601000001_audit_logs.sql` lines 108–138.
**Apply to:** `admin_bulk_jobs` (A1), `funnel_anomaly_alerts` (A5), `bulk_action_undo_token` (A6).

Define ONLY a SELECT policy; the ABSENCE of INSERT/UPDATE/DELETE policies IS the enforcement. SECDEF RPCs and service_role are the only write paths.

### S3. Audit-trigger suppression in SECDEF RPCs

**Source:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` line 178: `perform set_config('app.suppress_audit', 'on', true);`
**Apply to:** Every SECDEF RPC in A7 that writes an explicit `audit_logs` INSERT.

Without this, both the AFTER-trigger AND the explicit INSERT fire → duplicate audit rows. See `[[reference_supabase_migration_gotchas]]` Pitfall 4.

### S4. Idempotent Realtime publication add

**Source:** `supabase/migrations/20260513000000_injections.sql` lines 84–98.
**Apply to:** A5 (`funnel_anomaly_alerts`).

`do $$ ... if not exists (select 1 from pg_publication_tables ...) then execute 'alter publication ... add table ...'; end $$;` — `supabase db push` retries are tolerated.

### S5. Vendor-gated send (Resend health-check probe)

**Source:** `supabase/functions/_shared/resend-domain-health-check.ts` + `supabase/functions/lifecycle-retention/index.ts` (uses it at boot).
**Apply to:** B2 (`funnel-anomaly-cron`) for the email alert send.

Cron tick is a no-op `200 + {skipped:true}` until Resend domain verified. Cutover at vendor verify = zero code changes. Per `[[reference_vendor_gated_send_health_check]]`.

### S6. Lazy admin singleton + Proxy + setAdminForTest

**Source:** `supabase/functions/_shared/lifecycle-utils.ts` lines 63–91 (`makeLazyAdmin()`).
**Apply to:** B1, B2, B3.

Reads `_adminInstance` lazily; tests can inject a stub AFTER module import (the Deno test suite sets env vars after `import './index.ts'`). Test-injectable seam is mandatory per Phase 14 lessons.

### S7. Discriminated error contract on RPC wrappers

**Source:** `src/lib/admin/affiliate-review.ts` lines 19–82 + `src/lib/admin/admin-api.ts` lines 19–55.
**Apply to:** C2 (cohort), C3 (bulk handlers), C4 (undo).

Each lib module exports its own `*ApiError` class + `*ApiErrorCode` discriminated union + `mapRpcError(err)` switch keyed on Postgres SQLSTATE (`42501 → not_staff`, `28000 → not_authenticated`, `22023 → invalid`). Call sites branch on `e.code`, never parse strings.

### S8. Pre-emptive eslint zone for field allowlist

**Source:** `[[reference_eslint_import_x_path_gotcha]]` — restrict imports into `src/lib/cohort/rule-tree-to-sql.ts` from anywhere except `src/lib/cohort/`.
**Apply to:** C1 + C2. Prevents accidental import of raw SQL strings into UI / RPC plumbing.

### S9. Idempotency on cron ticks

**Source:** Phase 26 D-07 (anomaly cron idempotent on `(funnel_id, tick_bucket)`).
**Apply to:** B2 (`funnel-anomaly-cron`).

Insert alerts keyed on `(funnel_id, date_trunc('minute', now())::text)` — re-fire within same minute = no-op via `on conflict do nothing`. 4h suppression (D-18) is the outer gate; idempotency key is the inner safety net.

### S10. Status-machine transition ownership

**Source:** `[[feedback_status_machine_transition_owner]]` — every enum value needs an owning writer.
**Apply to:** 
- `admin_bulk_jobs.status` enum `('pending','running','completed','failed')` — `admin_bulk_action_execute` writes `pending`; `admin-bulk-job-worker` Edge Fn transitions `pending→running→completed|failed`.
- `cohort_definitions.status` enum `('draft','active','archived')` — `cohort_define` writes `draft`; admin UI promotes `draft→active`; `cohort_archive` writes `archived`. **NO automated `active→draft` rollback** (would orphan matview consumers). Document.
- `funnel_anomaly_alerts.resolution_status` enum `('firing','resolved','acknowledged')` — cron writes `firing`; `funnel_anomaly_acknowledge` writes `acknowledged`; auto-`resolved` is DEFERRED (v1 ships fixed 4h suppression per D-18). Verify no consumer reads `resolved` in v1.

---

## No Analog Found

Files with no close repo match — planner should use RESEARCH.md patterns instead:

| File | Role | Reason | Source to cite |
|------|------|--------|----------------|
| `src/lib/cohort/rule-tree-to-sql.ts` | client-lib / translator | No JSONB→SQL recursive walker in repo. Hand-roll. Tests must cover: (a) leaf op-matrix `=` `!=` `>` `<` `>=` `<=` `in` `is_null` `is_not_null`; (b) recursive AND/OR nesting; (c) MAX_DEPTH=8 reject; (d) field outside 15-allowlist reject; (e) SQL injection resistance — values always parameterized, never string-interpolated. | 27-RESEARCH.md §Code Examples §Recursive translator (planner consults) |
| `src/lib/admin/palette/aal2-step-up.ts` | client-lib / Auth helper | Greenfield. Zero `aal2`/`auth_time`/`challengeAndVerify` hits in repo. | 27-RESEARCH.md (Supabase Auth aal2 freshness HIGH→MEDIUM confidence note) |
| `src/components/admin/AdminCohortBuilder.tsx` | UI / nested-tree editor | No nested-tree editor in repo. RESEARCH recommends hand-roll (no dnd-kit). Closest cousin (flat-tree edit): `src/components/admin/pages/blocks/*.tsx`. | 27-RESEARCH.md §Cohort builder UI primitives |
| `src/components/admin/AdminCommandPalette.tsx` | UI / cmdk dialog | No cmdk usage in repo (net-new library). | cmdk docs (Context7 at planning time) |

---

## Metadata

**Analog search scope:**
- `/Users/karstenhaldan/minisite/supabase/migrations/` (103 files; targeted reads of 7)
- `/Users/karstenhaldan/minisite/supabase/functions/` (35 Edge Fns; targeted reads of 3 + `_shared/` utils)
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/` (~40 files; targeted reads of 3)
- `/Users/karstenhaldan/minisite/leanshot/src/components/clinic/roster/` (15 files; targeted reads of 2)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/` + `src/lib/affiliate/` + `src/lib/page-builder/` (targeted reads of 3)

**Files scanned (full reads):** 12
**Files scanned (targeted ranges):** 4
**Files scanned (ls only):** ~25

**Pattern extraction date:** 2026-05-17
