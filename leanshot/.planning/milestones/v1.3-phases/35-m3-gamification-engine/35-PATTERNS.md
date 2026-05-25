# Phase 35 — Pattern Map

> New artifact → closest existing analog. Plan-phase consumes this to keep PLAN.md `files_modified` aligned with project convention.
>
> **Mapped:** 2026-05-21
> **Scope:** 14 artifact categories from `35-CONTEXT.md` + `35-RESEARCH.md` (Architectural Responsibility Map).
> **Repo layout reminder:** git root = `/Users/karstenhaldan/minisite`; PLAN.md paths are relative to git root, NOT `leanshot/`. Migrations live at `supabase/migrations/`, Edge Fns at `supabase/functions/`, SPA at `leanshot/src/`, Vercel Functions land at `leanshot/api/` (NEW directory — see §8).

## Pattern Quick-Index

| # | New artifact | Closest analog | Match |
|---|---|---|---|
| 1 | Append-only Postgres ledger (`xp_ledger`, `freeze_tokens_ledger`) | `supabase/migrations/20260601000001_audit_logs.sql` + `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` (affiliate_conversions) | exact |
| 2 | Pure IMMUTABLE Postgres fn (`compute_level(xp_total)`) | `supabase/migrations/20270602000011_cohort_membership_matview.sql` `cohort_is_member()` (sql + stable, SECDEF) | role-match (pure-sql shape; switch IMMUTABLE) |
| 3 | Daily pg_cron job respecting `profiles.timezone` | `supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql` (named-dollar-quote idempotent cron) + Pattern 2 of RESEARCH | role-match (cron shape; per-tz WHERE is new) |
| 4 | 15-min matview + CONCURRENTLY refresh (`leaderboard_matview`) | `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` + `20270101000009_click_baseline_refresh_cron.sql` (+ structural mirror `cohort_matview_refresh_cron`) | exact |
| 5 | Admin form for entity CRUD (`weekly_challenges`) | `leanshot/src/components/admin/cohort/AdminCohortBuilder.tsx` (validation + SECDEF RPC + toast pattern) | exact |
| 6 | A/B variant via PostHog Experiments + Ship-Winner | `supabase/functions/ship-winner-flag/index.ts` (Phase 34 D-20) | exact |
| 7 | Edge Fn with HMAC/service-role bearer auth (xp-grant) | `supabase/functions/winback-scorer/index.ts` (`checkServiceRoleBearer` from `_shared/lifecycle-utils.ts`) + `supabase/functions/record-activation/index.ts` (user-JWT path) | exact (both shapes documented) |
| 8 | Vercel Function returning image/png (OG share-card) | **NONE** — `leanshot/api/` does not exist; no `@vercel/og` precedent in repo. Closest sibling = `supabase/functions/share/` (HTML doctor-share page) | NEW PATTERN |
| 9 | Lazy-loaded chunk via sync-defer (`gamification-burst`) | `leanshot/src/lib/sync-defer.ts` (Phase 6 D-12) + `telemetry-defer.ts` (Phase 2.1) | exact |
| 10 | `useReducedMotion`-gated animation | `leanshot/src/hooks/useReducedMotion.ts` + `leanshot/src/components/ui/ProgressRing.tsx` (CSS-token-based; no anim gate) + call sites in `HeroCard.tsx` | exact |
| 11 | Append-only-ledger Vitest RLS suite (cross-tenant impersonation) | `leanshot/e2e/rls-audit-logs.test.ts` (Phase 7 D-04) | exact |
| 12 | Server-side PostHog capture via `captureServer()` | `supabase/functions/_shared/posthog-server.ts` + call site `supabase/functions/record-activation/index.ts:117-124,255-266` | exact |
| 13 | Notification dispatch (challenge kickoff, streak-break warn) | `supabase/functions/lifecycle-behavior-triggered/index.ts` (15-min cron, 3-query batch, `email_send_counters` idempotency) | exact |
| 14 | Settings subtab (Leaderboard opt-in + handle picker) | `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` + `SettingsPage.tsx` (`Section` union + nav-list pattern) | exact |

---

## 1. Append-only Postgres ledger (`xp_ledger`, `freeze_tokens_ledger`)

- **New files:**
  - `supabase/migrations/{ts}_p35_xp_ledger.sql`
  - `supabase/migrations/{ts}_p35_freeze_tokens_ledger.sql`
  - `supabase/migrations/{ts}_p35_xp_ledger_rls.sql` (may collapse into above)
- **Closest analog:** `supabase/migrations/20260601000001_audit_logs.sql` (lines 46–144) — append-only TABLE + RLS enable + SELECT-only policy + NO write policies (negative-space mitigation = denial-by-default).
- **Secondary analog:** `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` (lines 50–66 — affiliate_conversions) for `status text NOT NULL CHECK (status IN (...))` enum-via-CHECK pattern when planner adds `xp_delta` reason enum.
- **Defense-in-depth append-only triggers (optional but recommended):** mirror `supabase/migrations/20261101000010_landing_page_revisions_append_only.sql` (BEFORE UPDATE / BEFORE DELETE raise-exception triggers — defeats even forgotten service_role grants).

**Pattern excerpt — table + RLS (from `20260601000001_audit_logs.sql:46-116`):**
```sql
create table public.audit_logs (
  id bigserial primary key,
  timestamp timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  ...
  action text not null check (action in ('insert','update','delete', ...))
);

alter table public.audit_logs enable row level security;

create policy "audit_logs_select_own"
  on public.audit_logs for select
  using (auth.uid() = user_id);

-- NO INSERT/UPDATE/DELETE policy — denial-by-default IS the tampering mitigation.
-- Only SECDEF triggers + service_role can write.
```

**RLS write-path for affiliate_conversions (`20270101000006_affiliate_rls.sql:147-173`)** — adds a `for insert to service_role with check (true)` policy when the Edge Fn writer needs an explicit service_role policy (sometimes redundant since service_role bypasses RLS, but Phase 19 ships it for grep-able intent):
```sql
create policy pol_affiliate_conversions_service_insert on public.affiliate_conversions
  for insert to service_role with check (true);
```

**Gotchas:**
- `on delete set null` (NOT cascade) on `user_id` so ledger rows survive account deletion (matches Phase 7 audit_logs D-03).
- For `xp_ledger`, no `user_id_hash` needed (no indefinite-retention skeleton like audit_logs); standard `auth.uid() = user_id` is the SELECT policy.
- Every new RLS surface gets a **live cross-tenant impersonation proof test** per `reference_supabase_project.md` — see §11.

---

## 2. Pure Postgres function `compute_level(xp_total)`

- **New file:** `supabase/migrations/{ts}_p35_compute_level_fn.sql`
- **Closest analog:** `supabase/migrations/20270602000011_cohort_membership_matview.sql:114-139` — `cohort_is_member(uuid, uuid)` as `language sql security definer stable set search_path = public, pg_catalog`. New function differs: **IMMUTABLE** (not stable) and **does NOT need SECDEF** (pure math; no row access).

**Pattern excerpt (adapt from RESEARCH §Pattern 1 + cohort_is_member shape):**
```sql
create or replace function public.compute_level(xp_total int)
returns int
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  -- D-02: Level N requires N² × 100 XP cumulative; floor(sqrt(xp_total/100))
  select greatest(1, floor(sqrt(greatest(xp_total, 0)::float / 100))::int);
$$;

comment on function public.compute_level(int) is
  'Phase 35 D-04 — deterministic pure SQL level computation. '
  'Rollback test exercises with random ledger sequences.';

revoke all on function public.compute_level(int) from public;
grant execute on function public.compute_level(int) to authenticated, service_role;
```

**Gotchas:**
- **`set search_path = public, pg_catalog`** is mandatory for non-trivial functions per `reference_supabase_migration_gotchas` — without it, `extensions` schema searches fail when function called from a different role context.
- `IMMUTABLE` (not STABLE) is required so the function can be used in partial-index predicates if needed (e.g., index on `compute_level(xp_total)`). RESEARCH §Pattern 1 line 281–286 already specifies IMMUTABLE.
- `parallel safe` lets Postgres use it inside parallel query plans (matters for rollback-replay test against 100k+ rows).

---

## 3. Daily `pg_cron` job respecting `profiles.timezone`

- **New file:** `supabase/migrations/{ts}_p35_streak_cron.sql`
- **Closest analog:** `supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql` — named-dollar-quote idempotent cron with pre-flight unschedule.
- **Secondary analog:** RESEARCH §Pattern 2 (lines 297–319) ships the literal hourly-tz-aware shape but is research-only; this file's structural pattern (unschedule do-block + named-tag inner body + `raise notice` exception handler) is the proven shape.

**Pattern excerpt (idempotent cron — from `20270706000005_p34_anon_session_ttl_cron.sql:23-65`):**
```sql
create extension if not exists pg_cron;

-- Pre-flight: unschedule pre-existing entries so re-running the migration is safe.
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job where jobname in (
      'phase35-streak-evaluate-hourly'
    )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null;  -- cron schema may not be visible on first apply
end $unschedule$;

select cron.schedule(
  'phase35-streak-evaluate-hourly',
  '5 * * * *',          -- 05 past hour to avoid pile-up
  $cron$
  do $streak$
  declare r record;
  begin
    for r in
      select p.id as user_id
        from public.profiles p
       where extract(hour from (now() at time zone p.timezone)) = 2  -- 02:00 local
    loop
      perform public.evaluate_streak_for_user(r.user_id);
    end loop;
  exception when others then
    raise notice 'phase35-streak-evaluate-hourly: error % — continuing', sqlerrm;
  end $streak$;
  $cron$
);
```

**Gotchas (load-bearing):**
- **Named-tag dollar quoting** (`$cron$ ... $cron$` outer; `$streak$ ... $streak$` inner) per memory `reference_postgres_dollar_quote_nesting_in_cron_body`. A bare inner `$$` would silently close the outer quote and crash with `syntax error at or near DECLARE` at apply time.
- **`cron.schedule()` upserts by jobname**; the unschedule do-block makes cron-expression edits safe to re-apply.
- **Off-quarter-hour minute** (`5 * * * *` here, `12,27,42,57` for the leaderboard refresh — see §4) avoids pile-up with `cohort_membership_rebuild` (`7,22,37,52`) and `funnel-anomaly` (`*/5`).
- **DST landmine:** `(now() AT TIME ZONE p.timezone)` is correct (uses IANA zone), but ambiguous local hours during DST fall-back will fire the job TWICE in a single UTC day. Acceptable per D-09 idempotency (`evaluate_streak_for_user` should be idempotent keyed on `(user_id, eval_date::date)`).
- **`profiles.timezone` column must exist and be non-null.** Confirm in plan-write or ship a migration adding `not null default 'UTC'` if missing — Phase 27 cohort migrations reference profiles but don't add `timezone`.

---

## 4. 15-min matview + `REFRESH CONCURRENTLY` (`leaderboard_matview`)

- **New files:**
  - `supabase/migrations/{ts}_p35_leaderboard_matview.sql`
  - `supabase/migrations/{ts}_p35_leaderboard_refresh_cron.sql`
- **Closest analog:** `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` (mv + UNIQUE index for CONCURRENTLY refresh) + `supabase/migrations/20270101000009_click_baseline_refresh_cron.sql` (REFRESH MATERIALIZED VIEW CONCURRENTLY in cron body).
- **Cohort sibling pattern:** `supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql` — same shape, schedule `7,22,37,52` (offset by 5 min from quarter hour).

**Pattern excerpt (UNIQUE-index for CONCURRENTLY — from `20270101000007_affiliate_click_baseline_mv.sql:27-52`):**
```sql
create materialized view public.affiliate_click_baseline as
select affiliate_id, avg(daily_count)::numeric(10,2) as mean_clicks, ...
from (...) daily
group by affiliate_id;

-- LOAD-BEARING: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index.
create unique index idx_click_baseline_affiliate
  on public.affiliate_click_baseline(affiliate_id);

grant select on public.affiliate_click_baseline to authenticated, service_role;
```

**Cron skeleton (from `20270101000009_click_baseline_refresh_cron.sql:13-22` + cohort sibling):**
```sql
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('phase35-leaderboard-refresh');
exception when others then null;
end $$;

select cron.schedule(
  'phase35-leaderboard-refresh',
  '12,27,42,57 * * * *',   -- offset 5 min from cohort rebuild (7,22,37,52)
  $$ refresh materialized view concurrently public.leaderboard_matview; $$
);
```

**Gotchas:**
- **UNIQUE index is load-bearing** — `idx_leaderboard_matview_cohort_user on (cohort_id, user_id)` per RESEARCH §Pattern 3. Without it, `REFRESH … CONCURRENTLY` errors at runtime.
- **15-min schedule offset:** RESEARCH §Pattern 3 picks `12,27,42,57` to land AFTER `cohort_membership_rebuild` (`7,22,37,52`) — the matview joins `cohort_membership`, so reading 5 min after rebuild keeps it fresh.
- **`grant select` to authenticated** so the SECDEF `get_leaderboard_for_user(p_cohort_id uuid)` RPC can return rows from the matview (the SECDEF wrapper is what mediates "top10 + ±5" + opt-in filter, not RLS on the matview itself — RLS on matviews is wonky).
- For RPC, follow Phase 27 `cohort_is_member` shape (§2 analog) but add `current_setting('app.suppress_audit')` or audit-bypass per `reference_supabase_migration_gotchas` if the RPC reads from `cohort_membership`.

---

## 5. Admin form for entity CRUD (`weekly_challenges`)

- **New files:**
  - `leanshot/src/components/admin/gamification/ChallengeForm.tsx`
  - `leanshot/src/components/admin/gamification/ChallengeList.tsx`
  - `leanshot/src/components/admin/gamification/FreezeTokenGrant.tsx`
  - `leanshot/src/components/admin/gamification/LeaderboardEnable.tsx`
  - `leanshot/src/lib/gamification/admin-api.ts` (SECDEF RPC wrappers)
- **Closest analog:** `leanshot/src/components/admin/cohort/AdminCohortBuilder.tsx` (lines 12–80).

**Pattern excerpt (controlled-form + `safeParse` + SECDEF-RPC dispatch — lines 39–79):**
```ts
export function AdminCohortBuilder({ onSaved }: AdminCohortBuilderProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [tree, setTree] = useState<RuleNode>(DEFAULT_TREE);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const validation = useMemo(() => ruleTreeSchema.safeParse(tree), [tree]);
  const treeError = validation.success ? null : validation.error.issues[0]?.message;
  const canSave = !submitting && name.trim().length > 0 && validation.success;

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const { cohortId } = await defineCohort(name.trim(), tree);
      toast(`Cohort "${name.trim()}" created (draft)`, 'success');
      onSaved?.(cohortId);
    } catch (e) {
      if (e instanceof CohortApiError) {
        if (e.code === 'duplicate_name') setNameError('...');
        else if (e.code === 'not_staff') toast('You need admin access', 'error');
      } else {
        toast('Could not save cohort — try again', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return <Card variant="elevated" padding="lg" className="space-y-4">...</Card>;
}
```

**Admin module integration:** Follow `feedback_admin_module_manifest_vs_router_branch_drift` — when adding `/admin/gamification`, register in BOTH the module manifest AND the router catch-all branch. Use existing `surfaceCheck('admin.gamification.*')` per CONTEXT (already extends Phase 27 `is_admin_at_least` pattern).

**Gotchas:**
- **Wrap the form in a typed `XxxApiError`** (mirror `CohortApiError` from `@/lib/cohort/api`). Codes: `not_admin`, `invalid_threshold`, `duplicate_active`, `cohort_not_found`.
- **`use*` selectors per primitive** (Zustand convention) — never `useStore((s) => s)`.
- **Status enum widening risk:** per memory `feedback_planner_missed_status_enum_widening`, if `weekly_challenges.status` introduces a new value, ship the CHECK-constraint widening in the SAME migration as the value's first INSERT. Pre-inspect: `select pg_get_constraintdef(oid) from pg_constraint where conname like '%weekly_challenges%status%';`.

---

## 6. A/B variant via PostHog Experiments + Ship-Winner

- **New files:** Reuse `supabase/functions/ship-winner-flag/index.ts` AS-IS; new code limited to:
  - `leanshot/src/lib/gamification/variants.ts` (`posthog.getFeatureFlagPayload('challenge-{id}-ab')` wrapper)
  - Admin "Ship Winner" button wired into ChallengeForm.tsx → calls `supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant }})`.
- **Closest analog:** `supabase/functions/ship-winner-flag/index.ts` lines 1–100 (Phase 34 D-20 mirror).

**Pattern excerpt (Edge Fn already shipped; just call from new admin button):**
```ts
// In ChallengeForm.tsx Ship Winner handler:
const { error } = await supabase.functions.invoke('ship-winner-flag', {
  body: { flag_id: challenge.posthog_flag_id, variant: winningVariantKey },
});
if (error) toast('Could not ship winner — check PostHog secrets', 'error');
```

**Variant resolution (client-side, in WeeklyChallengeCard.tsx):**
```ts
// Following Phase 34 Pattern 7 — posthog.getFeatureFlagPayload returning { version_id, framing }
const variant = posthog.getFeatureFlagPayload(`challenge-${challenge.id}-ab`) as
  | { variant_id: string; framing: string }
  | undefined;
const framing = variant?.framing ?? challenge.default_framing;
```

**Gotchas:**
- **PostHog secrets** (`POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`) must be set via `supabase secrets set …` for `ship-winner-flag` to return 200 (vendor-gated health-check pattern). Already wired by Phase 34 plan 34-10 — verify with `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` before phase entry.
- **Defense-in-depth on the server side** — `ship-winner-flag` re-verifies superadmin from `profiles.admin_role` (not just client surfaceCheck). New phase 35 admin endpoints follow same pattern.

---

## 7. Edge Function with HMAC-token / service-role-bearer auth (xp-grant)

- **New files:**
  - `supabase/functions/xp-grant/index.ts` — primary writer; may be invoked from row triggers OR from the existing log-handler Fns (planner picks).
  - `supabase/functions/xp-grant/index.test.ts` — Deno test sweep (`<name>.test.ts` per `reference_deno_test_discovery`).
  - `supabase/functions/challenge-monday-kickoff/index.ts` — cron-invoked, mirrors lifecycle-behavior-triggered.
  - `supabase/functions/admin-grant-freeze-token/index.ts` — admin path, mirrors record-activation (user-JWT auth).
- **Closest analog (service-role-bearer auth — cron path):** `supabase/functions/winback-scorer/index.ts:38-46` + `supabase/functions/_shared/lifecycle-utils.ts:36-99`.
- **Closest analog (user-JWT auth path):** `supabase/functions/record-activation/index.ts:171-277` (full handler: CORS → auth → body → SECDEF RPC → captureServer → finally shutdownPostHog).
- **HMAC reference (if planner picks per-message-signed callable):** `supabase/functions/_shared/helpdesk-hmac.ts:24-103` (HMAC-SHA256 + constant-time compare via Web Crypto).

**Pattern excerpt — service-role bearer auth (`_shared/lifecycle-utils.ts:36-99`):**
```ts
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkServiceRoleBearer(req: Request): boolean {
  const bearer = bearerFromReq(req);
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!bearer || !expected) return false;
  return constantTimeEqual(bearer, expected);
}

export function makeLazyAdmin(): LazyAdminHandle { /* Proxy-based test-injectable */ }
```

**Pattern excerpt — full handler (from `record-activation/index.ts:171-277`):**
```ts
async function handleXpGrant(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

    // 1. Auth (either user-JWT via admin.auth.getUser, OR service-role bearer for cron)
    const bearer = jwtFromReq(req);
    if (!bearer) return jsonError(401, 'unauthenticated');

    // 2. zod-free typed body validation (keep cold-start lean — record-activation pattern)
    const parsed = parseBody(await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(400, 'invalid_body');

    // 3. SECDEF RPC — advisory_xact_lock + INSERT into xp_ledger + compute_level
    const { data, error } = await admin().rpc('grant_xp', { p_user_id, p_action, p_xp });
    if (error) return jsonError(500, 'db_error');

    // 4. captureServer('xp_earned') + (conditionally) captureServer('level_up')
    doCapture({ userId, event: 'xp_earned', properties: { action, xp_delta, new_total } });
    if (data.level_up) doCapture({ userId, event: 'level_up', properties: { new_level } });

    return jsonResponse(200, { ok: true, ...data });
  } finally {
    try { await doShutdown(); } catch (e) { console.error('[xp-grant] shutdown failed', e); }
  }
}
```

**Gotchas (load-bearing memories):**
- **`reference_supabase_service_role_key_format_divergence`** — `constantTimeEqual(bearer, env.SUPABASE_SERVICE_ROLE_KEY)` expects the new `sb_secret_*` token. Legacy HS256 JWT from `supabase projects api-keys` gets rejected 401. Use HMAC-payload auth (`_shared/helpdesk-hmac.ts`) for orchestrator-callable Fns if the cron path needs to call from another Fn rather than pg_cron.
- **`reference_supabase_pg_cron_vault_service_role_pattern`** — pg_cron + SECDEF calling Edge Fns MUST use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')` + hardcoded URL. `current_setting('app.service_role_key')` GUC does NOT exist on this project. Phase 19 already shipped the vault load (`20270101000014_service_role_key_vault_load.sql`); reuse it.
- **`feedback_rpc_auth_uid_vs_service_role_mismatch`** — if `grant_xp` SECDEF RPC references `auth.uid()`, it CANNOT be called from service-role Edge Fns (cron). Either (a) Fn forwards user JWT, or (b) RPC takes `p_user_id` param + service_role Fn passes user_id. Phase 35 cron paths (streak eval, freeze grant) MUST take the param-passing shape.
- **`shutdownPostHog()` in `finally`** is mandatory (PostHog batches events; Deno isolate teardown drops the batch otherwise). See `_shared/posthog-server.ts:1-29` warning.
- **Deploy:** `supabase functions deploy xp-grant` (NO `--linked` flag per `reference_supabase_functions_deploy_no_linked_flag`). If new Fn imports via `import_map.json` aliases, include `--import-map supabase/functions/import_map.json`.

---

## 8. Vercel Function returning image/png (OG share-card)

- **New files:**
  - `leanshot/api/og/level-up.ts` — `@vercel/og` `ImageResponse` handler.
  - `leanshot/api/share/level/[token].ts` — SSR HTML page with `<meta og:image>` tags + JS redirect to SPA (RESEARCH §Architecture diagram lines 195–203 — needed because SPA index.html has empty OG tags; social-bot scrapers would see nothing).
  - `leanshot/vercel.json` — ADD `/share/level/(.*)` rewrite branch (currently `/share/(.*)` → `/index.html` which fails for OG bots).
- **Closest analog:** **NONE in repo.** `leanshot/api/` directory does NOT exist (`find /Users/karstenhaldan/minisite/leanshot -maxdepth 3 -type d -name api` returns empty). This is a brand-new Vercel Function pattern.
- **Functional sibling (Supabase Edge Fn):** `supabase/functions/share/` (Phase 7/8 doctor-read-share — different runtime, but illustrates the share-token HTML page shape).

**Why new pattern:**
- `@vercel/og` depends on Vercel Edge Runtime — it cannot run inside Supabase Edge Functions (Deno isolates with different std lib).
- The HTML page hosting OG meta tags ALSO must live in the Vercel project (not the SPA `index.html`) because the SPA is a static shell — social-media bots scraping `/share/level/<token>` against the existing `/share/(.*) → /index.html` rewrite see ZERO OG tags.

**Scaffolding skeleton (planner specifies; based on RESEARCH §Architecture):**
```ts
// leanshot/api/og/level-up.ts (NEW directory)
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default function handler(req: Request): ImageResponse {
  const { searchParams } = new URL(req.url);
  const level = Number(searchParams.get('level') ?? 1);
  return new ImageResponse(
    (
      <div style={{ display: 'flex', /* ... brand template ... */ }}>
        <span>Level {level}</span>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
```

**vercel.json patch — current `/share/(.*) → /index.html` rewrite line MUST be narrowed:**
```json
// Replace the existing line:
//   { "source": "/share/(.*)", "destination": "/index.html" }
// With (NEW rewrites for OG-meta-tag-serving routes ABOVE the SPA fallback):
{ "source": "/api/og/(.*)", "destination": "/api/og/$1" },
{ "source": "/share/level/(.*)", "destination": "/api/share/level/$1" },
{ "source": "/share/(.*)", "destination": "/index.html" }   // patient-share keeps SPA fallback
```

**Gotchas:**
- **`@vercel/og` is NOT installed.** Plan adds `npm install @vercel/og@^0.11.1` to `leanshot/package.json`. Per `reference_npm_install_worktree_main_drift`, also runs `npm install` in main after merge.
- **Viral attribution:** OG-image URL accepts `?ref=share` query param; the share page redirects to `https://app.leanshot.app/#/onboarding?ref=share` so the Phase 19 dual-cookie `_aff` flow can attach (CONTEXT discretion item).
- **Vercel CSP headers** in `vercel.json:34-46` — `connect-src 'self'` may need `img-src 'self' data: blob: https://vercel-og-*.vercel.app` if the OG URL renders inside an `<img>` (it should not — only `<meta property="og:image">` for bots, but verify).
- **Bundle ceiling:** @vercel/og runs server-side on Edge; does NOT enter the SPA bundle. The 8 kB `gamification-burst` chunk constraint applies to client-side `canvas-confetti` + framer-motion ONLY (see §9).

---

## 9. Lazy-loaded chunk via sync-defer (`gamification-burst`)

- **New file (extends existing):** Add a new `kind` to `leanshot/src/lib/sync-defer.ts` SyncCall union OR ship a parallel `leanshot/src/lib/gamification-defer.ts` mirroring `sync-defer.ts` + `telemetry-defer.ts` shape.
- **Closest analog:** `leanshot/src/lib/sync-defer.ts` (full file — 200ish lines) — Phase 6 D-12 idle-deferred-init wrapper.
- **Twin pattern:** `leanshot/src/lib/telemetry-defer.ts` (Phase 2.1) — same shape; proves the parallel-defer-file approach.
- **Bundle-budget proof:** `scripts/assert-vendor-react-size.sh` (Phase 5 D-12) enforces per-chunk gz ceilings — confirm `gamification-burst` ≤ 8 kB gz before push.

**Pattern excerpt (FIFO buffer + idle-callback + dynamic import — from `sync-defer.ts:38-86`):**
```ts
type GamificationCall =
  | { kind: 'levelUpBurst'; level: number }
  | { kind: 'challengeCompleteBurst'; rewardKind: 'xp' | 'badge' | 'freeze' };

const BUFFER_CAP = 64;
const buffer: GamificationCall[] = [];

let loadedApi: { confetti: typeof ConfettiModule; burst: typeof BurstModule } | null = null;
let loadingPromise: Promise<typeof loadedApi> | null = null;

async function loadGamification() {
  const [confetti, burst] = await Promise.all([
    import('canvas-confetti'),
    import('@/components/dashboard/burst/ConfettiBurst'),
  ]);
  return { confetti, burst };
}

function dispatch(api, call: GamificationCall): void {
  try {
    switch (call.kind) {
      case 'levelUpBurst': api.burst.runLevelUp(call.level); break;
      case 'challengeCompleteBurst': api.burst.runChallengeComplete(call.rewardKind); break;
    }
  } catch (e) {
    console.error('[leanshot] deferred gamification call failed', call.kind, e);
  }
}
```

**Gotchas:**
- **Type-only imports** of the heavy modules are mandatory (`import type * as ConfettiModule from 'canvas-confetti'`). Value imports defeat deferral and push canvas-confetti into the entry chunk.
- **`window.requestIdleCallback` fallback** to `setTimeout(loadFn, 0)` for Safari < 17 / Firefox (matches sync-defer.ts pattern).
- **CI guard:** ensure `scripts/assert-vendor-react-size.sh` (or equivalent bundle-budget gate) enforces the 8 kB gz ceiling on the `gamification-burst` chunk's content-hashed filename. Per memory `reference_bundle_budget_hash_hyphen` — script must handle hyphens in content hash.
- **Subsequent bursts dispatch directly** post-init (bypass buffer). Pre-init: FIFO with oldest-dropped warning on overflow.

---

## 10. `useReducedMotion`-gated animation

- **New file (component):** `leanshot/src/components/dashboard/burst/ConfettiBurst.tsx`
- **Closest analog:** `leanshot/src/hooks/useReducedMotion.ts` (full hook — 21 lines).
- **Call sites:** `leanshot/src/components/dashboard/cards/HeroCard.tsx` (already uses the hook); `framer-motion`-using files honor it via `motion-safe:` Tailwind variant + JS guard.
- **Reuse-target:** `leanshot/src/components/ui/ProgressRing.tsx` (already in repo — CSS-token-based; no motion at all; safe to wrap with framer-motion fill animation gated on the hook).

**Pattern excerpt — defense-in-depth burst gate:**
```ts
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { lazy, useEffect } from 'react';

export function ConfettiBurst({ trigger, level }: { trigger: 'level-up' | 'challenge'; level?: number }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;  // React-level gate (defense-in-depth #1)
    void import('canvas-confetti').then(({ default: confetti }) => {
      confetti({
        particleCount: 60,
        disableForReducedMotion: true,  // library-level gate (defense-in-depth #2)
        // ... brand colors via getComputedStyle(document.documentElement)
      });
    });
  }, [reduced, trigger, level]);
  return null;  // pure side-effect component
}
```

**Gotchas:**
- **Layer BOTH gates** (`useReducedMotion` AND `disableForReducedMotion: true`) per CONTEXT discretion + RESEARCH anti-pattern lines 381–384.
- **Cooldown** (CONTEXT: max 1 burst/60s) — track in a module-scoped `lastBurstAt` ref OR Zustand ephemeral UI slice. Anti-spam when user batch-logs.
- **Brand colors from CSS variables** via `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` — never hard-coded per CLAUDE.md anti-pattern "Hard-coding colors in components".
- **Fallback for reduced-motion users:** subtle `ProgressRing` pulse animation gated by `motion-safe:` Tailwind variant (already supported in repo).

---

## 11. Append-only-ledger Vitest RLS suite (cross-tenant impersonation proof)

- **New files:**
  - `leanshot/e2e/rls-xp-ledger.test.ts`
  - `leanshot/e2e/rls-freeze-tokens-ledger.test.ts`
  - `leanshot/e2e/rls-leaderboard-optin.test.ts`
- **Closest analog:** `leanshot/e2e/rls-audit-logs.test.ts` (full file — 200ish lines; Phase 7 D-04 pattern).
- **Sibling files (same shape):** `leanshot/e2e/rls-multi-table.test.ts`, `leanshot/e2e/rls-affiliates.test.ts`, `leanshot/e2e/rls-consent-records.test.ts`.

**Pattern excerpt (from `rls-audit-logs.test.ts:30-100`):**
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 35 — RLS over xp_ledger', () => {
  let userA: { id: string; client: SupabaseClient } | null = null;
  let userB: { id: string; client: SupabaseClient } | null = null;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const adminClient = createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false }});
    const emailA = `phase35-xp-rls-a-${Date.now()}@leanshot.test`;
    // ... admin.createUser({email_confirm: true}) for A + B, then signInWithPassword
    // PER PROJECT RULE [reference_rls_fixture_gotrueclient_flake]: use
    // admin.generateLink + /auth/v1/verify via PLAIN fetch on ES256 projects.
  }, 60_000);

  afterAll(async () => {
    // file-scoped slug cleanup per feedback_rls_per_file_slug_prefix
  });

  it('user B sees ZERO of user A xp_ledger rows', async () => {
    // 1. admin.rpc('grant_xp', {p_user_id: userA.id, ...})  -- via service_role
    // 2. assert userA.client SELECT returns row
    // 3. assert userB.client SELECT returns EMPTY (RLS silently filters, not 403)
    // 4. admin SELECT confirms row exists (guards against false-pass)
  });

  it('user B INSERT fails 42501 (no INSERT policy for authenticated)', async () => {
    // direct INSERT via userB.client expecting violates row-level security
  });
});
```

**Gotchas (all load-bearing memories):**
- **`reference_rls_fixture_gotrueclient_flake`** — supabase-js v2.105 `signInWithPassword` cross-contaminates under vitest. On ES256 projects: use `admin.generateLink` + `/auth/v1/verify` via PLAIN fetch. `mintTestJwt` HS256 path is OBSOLETE on this project (`ytnsipxxmzgaebkqmokp`).
- **`feedback_rls_per_file_slug_prefix`** — file-scoped TEST_SLUG_PREFIX (`phase35-xp-rls-`) + per-file `afterAll` cleanup. Shared prefixes clobber across vitest's file-parallelism.
- **Cross-tenant proof MANDATORY** per `reference_supabase_project.md` ("every RLS surface gets a live cross-tenant impersonation proof test").
- **Append-only proof** — extra test: `userA INSERT into xp_ledger directly via authenticated → 42501`; only service_role can write.
- **Service-role guard test** — `admin SELECT count(*) WHERE user_id=userA.id` confirms row really exists (defense against trigger silently failing).

---

## 12. Server-side PostHog capture via `captureServer()`

- **New files (extends):**
  - `leanshot/src/lib/analytics/events.ts` — extend with `xp_earned`, `level_up`, `streak_milestone`, `freeze_token_granted`, `challenge_completed`, `badge_unlocked` per CONTEXT canonical_refs.
  - Plus consumers: all Edge Fns in §7 (`xp-grant`, `challenge-monday-kickoff`, `admin-grant-freeze-token`) call `captureServer`.
- **Closest analog:** `supabase/functions/_shared/posthog-server.ts` (full file — 80+ lines; Phase 24 D-11/D-13 + Phase 27 dual-write extension).
- **Call site:** `supabase/functions/record-activation/index.ts:117-124, 255-266`.

**Pattern excerpt — call site (`record-activation/index.ts:117-124, 255-266`):**
```ts
function doCapture(args: { userId: string; event: 'activation_completed'; properties: Record<string, unknown> }): void {
  if (_captureOverride) { _captureOverride(args); return; }  // test seam
  captureServer(args);
}

// In handler:
doCapture({
  userId,
  event: 'activation_completed',
  properties: { goal_type, action_type, window_days: 7, days_since_signup, source: 'first_log' },
});

// In finally block:
try { await doShutdown(); } catch (e) { console.error('[record-activation] shutdown failed', e); }
```

**Phase35Event union widening (mirror `Phase38Event` from `events.ts`):**
```ts
export type Phase35Event =
  | 'xp_earned'
  | 'level_up'
  | 'streak_milestone'
  | 'freeze_token_granted'
  | 'challenge_completed'
  | 'badge_unlocked';
```

**Gotchas:**
- **`shutdownPostHog()` in `finally`** is mandatory (PITFALL 1 in `_shared/posthog-server.ts:6-8`).
- **events.ts widening + Edge Fn capture in SAME plan** per memory `feedback_planner_missed_status_enum_widening`.
- **events_mirror dual-write** is automatic via the shared helper — no new code needed; cost is one fire-and-forget INSERT per capture for the local cache.
- **Vendor-gated:** if `POSTHOG_PROJECT_KEY` is missing, `captureServer` is a no-op with one-time warning — safe to deploy before secrets set.

---

## 13. Notification dispatch (Monday challenge kickoff, streak-break warn)

- **New files:**
  - `supabase/functions/challenge-monday-kickoff/index.ts` — Monday-only kickoff per D-21.
  - Embed streak-break warning send inside `evaluate_streak_for_user()` SECDEF SQL function (NO new Fn — pure SQL + INSERT into `user_notifications`); OR extend `lifecycle-behavior-triggered/index.ts` with a new query branch (planner picks).
- **Closest analog:** `supabase/functions/lifecycle-behavior-triggered/index.ts` (full file — 15-min cron, 3-query batch, idempotency via `email_send_counters`).
- **Notification table:** existing `public.user_notifications` (Phase 42 schema in `20270704000003_user_notifications.sql`) — category enum `{'dose-reminders','ai-insights','clinic-alerts','billing','marketing'}`; gamification notifications map to **`ai-insights`** with `payload.subtype = 'gamification'` (open jsonb schema; same shape as winback-scorer per `winback-scorer/index.ts:25-31` documented deviation).

**Pattern excerpt (3-query batch + per-user idempotency — `lifecycle-behavior-triggered/index.ts:38-95`):**
```ts
async function alreadySent(userId: string, key: string): Promise<boolean> {
  const { data } = await admin.from('email_send_counters').select('key')
    .eq('key', `behavior:${userId}:${key}`).limit(1);
  return (data?.length ?? 0) > 0;
}

async function markSent(userId: string, key: string): Promise<void> {
  await admin.from('email_send_counters').upsert(
    { key: `behavior:${userId}:${key}`, value: 1, updated_at: new Date().toISOString() },
    { onConflict: 'key' },  // UPSERT not bare UPDATE per feedback_state_counter_table_needs_upsert_on_event
  );
}

async function isPreferenceEnabled(userId: string, category: string): Promise<boolean> { ... }

// Loop: for each user_id in challenges-due-this-Monday:
//   if (await alreadySent(uid, `challenge:${challengeId}:monday`)) continue;
//   if (!(await isPreferenceEnabled(uid, 'ai-insights'))) continue;
//   await sendResendEmail(...);  // Phase 22 lifecycle-send wrapper
//   await markSent(uid, `challenge:${challengeId}:monday`);
//   captureServer({ userId: uid, event: 'challenge_kickoff_sent', ... });
```

**Notification row shape (matches winback-scorer pattern):**
```ts
await admin.from('user_notifications').insert({
  user_id: uid,
  category: 'ai-insights',  // existing CHECK enum — gamification piggybacks
  channel: 'in-app',
  payload: {
    subtype: 'gamification.challenge_kickoff',
    challenge_id, framing, cta_url: '/challenges',
    expires_at_iso: ...,
  },
});
```

**Gotchas:**
- **D-09 single-notification rule** (load-bearing ethical-only constraint): streak-break warning fires AT MOST once per cycle. Idempotency key `streak:${user_id}:${cycle_id}` with `alreadySent` guard.
- **`feedback_state_counter_table_needs_upsert_on_event`** — `email_send_counters` upsert with `{ onConflict: 'key' }`. Bare UPDATE silently no-ops first time → notification gate fails open → multi-fire violation.
- **CHECK-constraint enum is NOT widened** in this phase — winback-scorer already documented the precedent. Avoid status-enum widening risk per `feedback_planner_missed_status_enum_widening`.
- **Resend domain-verified path** — `supabase/functions/_shared/resend-domain-health-check.ts` already gates sends per `reference_resend_phase9_wiring`.

---

## 14. Settings subtab (Leaderboard opt-in + handle picker)

- **New files:**
  - `leanshot/src/components/dashboard/settings/LeaderboardsSubtab.tsx`
  - `leanshot/src/components/dashboard/settings/SettingsPage.tsx` — EXTEND `Section` type union with `'leaderboards'`; extend nav list.
- **Closest analog:** `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` (lines 1–60) — controlled-form + supabase-backed preferences + toast feedback.
- **Section pattern source:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx:54-79` — discriminated union of section IDs + `<nav>` rendering.

**Pattern excerpt — extend Section enum (`SettingsPage.tsx:54-79`):**
```ts
type Section =
  | 'account'
  | 'profile'
  | 'goals'
  | 'language'
  | 'notifications'
  | 'leaderboards'   // NEW — Phase 35 D-12, D-13
  | 'privacy'
  | 'email-preferences'
  | 'shares'
  | 'organizations'
  // ...
;
```

**Handle-picker form (mirror NotificationsSubtab toggle pattern):**
```ts
export function LeaderboardsSubtab() {
  const toast = useToast();
  const [optIn, setOptIn] = useState<boolean>(false);
  const [handle, setHandle] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleRegex = /^[a-zA-Z0-9-_]{6,24}$/;  // D-13 — alphanumeric + 6-24 chars
  const handleError = handle && !handleRegex.test(handle)
    ? '6–24 alphanumeric characters (no real names)' : null;

  const canSave = !submitting && (!optIn || (handle && !handleError));

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('set_leaderboard_optin', {
        p_opt_in: optIn, p_handle: optIn ? handle : null,
      });
      if (error) throw error;
      toast(optIn ? 'Joined leaderboard' : 'Left leaderboard', 'success');
    } catch (e) {
      toast('Could not update leaderboard settings', 'error');
    } finally {
      setSubmitting(false);
    }
  };
  // ... <Card><Toggle><Input handle><Button save></Card>
}
```

**Gotchas:**
- **Handle regex must reject real names** — `^[a-zA-Z0-9-_]{6,24}$` rejects spaces and most name characters. Server-side mirror in `set_leaderboard_optin` SECDEF RPC (defense-in-depth).
- **Per-cohort uniqueness** (D-13): `leaderboard_optin` table needs `UNIQUE (cohort_id, handle)` partial index where `cohort_id IS NOT NULL`. Insert fails fast on collision; UI catches and prompts new handle.
- **Server-generated default suggestion** — RPC `suggest_leaderboard_handle(p_user_id)` returns `<theme>-<rand4>` (themes from a small dictionary like `Peptide`, `Curve`, `Site`, `Rotation`).
- **Opt-out propagation** (D-15): RPC sets `leaderboard_optin.active = false`; next 15-min matview refresh excludes the row. UI optimistically shows "You're no longer on this leaderboard."

---

## Shared / cross-cutting patterns

### `auth.uid() = user_id` SELECT-only RLS on user-owned ledgers
**Source:** `supabase/migrations/20260601000001_audit_logs.sql:110-116`
**Applies to:** §1 (xp_ledger, freeze_tokens_ledger), §14 (leaderboard_optin)

### SECDEF function pattern with `set search_path = public, pg_catalog`
**Source:** `supabase/migrations/20270602000011_cohort_membership_matview.sql:54-101` (`cohort_membership_rebuild`)
**Applies to:** All new SECDEF helpers (`grant_xp`, `evaluate_streak_for_user`, `grant_monthly_freeze_tokens`, `set_leaderboard_optin`, `get_leaderboard_for_user`, `suggest_leaderboard_handle`)
**Gotcha:** `extensions` schema may need to be in search_path if function uses `extensions.gen_random_uuid()` or similar — per `reference_supabase_migration_gotchas`.

### Idempotent pg_cron registration (unschedule-then-schedule)
**Source:** `supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql:23-65`
**Applies to:** §3 (streak cron), §4 (leaderboard refresh cron), monthly freeze-token grant cron, Monday challenge kickoff cron

### Test-injectable lazy admin singleton (Edge Fns)
**Source:** `supabase/functions/_shared/lifecycle-utils.ts:51-99` (`makeLazyAdmin`)
**Applies to:** All new Edge Fns in §7, §13 — gives Deno test sweeps a `setAdminForTest` hook.

### Migration filename regex compliance
**Source:** memory `reference_supabase_migration_filename_regex`
**Applies to:** ALL new migrations — must match `<14-digits>_name.sql`; letter-suffix timestamps SILENTLY SKIPPED. Grep `^Skipping` after `supabase db push --dry-run`.
**Per-phase prefix proposal:** `20270708000001` .. `20270708000012` (RESEARCH §Recommended Project Structure lines 236–249). Plan-write must collision-check via `ls supabase/migrations/20270708*.sql` before assigning timestamps (per `reference_migration_timestamp_collision_precheck`).

---

## No analog found (new pattern in repo)

| File | Reason | Mitigation |
|---|---|---|
| `leanshot/api/og/level-up.ts` | First `@vercel/og` ImageResponse handler; no Vercel Functions in `leanshot/` today (only Supabase Edge Fns) | Plan ships scaffolding from RESEARCH §Architecture lines 195–203; install `@vercel/og@^0.11.1` in `leanshot/package.json`; document new `leanshot/api/` directory in CLAUDE.md or ARCHITECTURE.md |
| `leanshot/api/share/level/[token].ts` | SSR-rendered HTML for OG meta-tag-serving (social bot scraping) | Same as above; vercel.json rewrites updated to route `/share/level/(.*)` to Vercel Function rather than SPA fallback |

---

## Metadata

- **Analog search scope:** `supabase/migrations/` (all 200+ files, focused on Phase 7/19/22/27/34 sibling patterns); `supabase/functions/` (all 70+ Fns, focused on record-activation, ship-winner-flag, winback-scorer, lifecycle-behavior-triggered); `leanshot/src/components/admin/cohort/`, `leanshot/src/components/dashboard/settings/`, `leanshot/src/lib/`, `leanshot/src/hooks/`, `leanshot/e2e/rls-*.test.ts`
- **Files scanned (key reads):** ~25 source files, ~6,500 lines total
- **Repo-layout-aware paths:** all PATH excerpts cite the git-root path; PLAN.md files_modified lists must mirror this layout (no `leanshot/` prefix-stripping)
- **Memory references applied:** 15 load-bearing memories cited inline (filename regex, dollar-quote nesting, vault service_role, RLS fixture flake, GoTrue ES256, etc.)

## PATTERN MAPPING COMPLETE
