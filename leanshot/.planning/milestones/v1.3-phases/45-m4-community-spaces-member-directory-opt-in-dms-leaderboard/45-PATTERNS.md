# Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 30 new/modified files
**Analogs found:** 28 / 30

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_p45_schema.sql` | migration | CRUD | `supabase/migrations/20270720000001_p44_community_schema.sql` | exact |
| `supabase/migrations/<ts>_p45_rls.sql` | migration | CRUD | `supabase/migrations/20270720000002_p44_community_rls.sql` | exact |
| `supabase/migrations/<ts>_p45_notification_widening.sql` | migration | CRUD | `supabase/migrations/20270720000004_p44_notification_community.sql` | exact |
| `supabase/migrations/<ts>_p45_dm_attachments_bucket.sql` | migration | file-I/O | `supabase/migrations/20270720000003_p44_community_media_bucket.sql` | exact |
| `supabase/migrations/<ts>_p45_leaderboard_matview.sql` | migration | batch | `supabase/migrations/20270708000012_p35_leaderboard_matview.sql` + `20270708000013_p35_leaderboard_refresh_cron.sql` | exact |
| `supabase/migrations/<ts>_p45_secdef_rpcs.sql` | migration | CRUD | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` | exact |
| `supabase/functions/dm-create-thread/index.ts` | service | request-response | `supabase/functions/notify-community/index.ts` | exact |
| `supabase/functions/dm-create-thread/index.test.ts` | test | request-response | `supabase/functions/notify-community/index.test.ts` | exact |
| `supabase/functions/dm-create-thread/deno.json` | config | — | `supabase/functions/notify-community/deno.json` | exact |
| `supabase/functions/community-admin-report-digest/index.ts` | service | event-driven | `supabase/functions/notify-community/index.ts` + `supabase/functions/weekly-digest/index.ts` | role-match |
| `supabase/functions/community-admin-report-digest/index.test.ts` | test | event-driven | `supabase/functions/notify-community/index.test.ts` | role-match |
| `supabase/functions/community-admin-report-digest/deno.json` | config | — | `supabase/functions/notify-community/deno.json` | exact |
| `supabase/functions/notify-community/index.ts` (EXTEND) | service | request-response | self | — |
| `supabase/functions/_shared/email-router.ts` (EXTEND) | utility | request-response | self | — |
| `supabase/functions/_shared/email-templates/community-dm-new.ts` | utility | request-response | `supabase/functions/_shared/email-templates/community-mention.ts` | exact |
| `supabase/functions/_shared/email-templates/community-admin-report-digest.ts` | utility | request-response | `supabase/functions/_shared/email-templates/community-mention.ts` | role-match |
| `supabase/functions/notification-send/index.ts` (EXTEND) | service | request-response | self | — |
| `leanshot/src/lib/community/community-types.ts` (EXTEND) | model | CRUD | self | — |
| `leanshot/src/lib/community/dompurify-config.ts` (REUSE UNCHANGED) | utility | transform | self | — |
| `leanshot/src/lib/community/community-storage.ts` (REUSE UNCHANGED) | utility | file-I/O | self | — |
| `leanshot/src/components/community/use-dm-inbox-realtime.ts` | hook | event-driven | `leanshot/src/components/community/use-space-realtime.ts` | exact |
| `leanshot/src/components/community/CommunityDirectoryView.tsx` | component | request-response | `leanshot/src/components/community/CommunitySpaceView.tsx` | role-match |
| `leanshot/src/components/community/ProfileCard.tsx` | component | request-response | `leanshot/src/components/community/CommunityPost.tsx` | role-match |
| `leanshot/src/components/community/DMInboxView.tsx` | component | request-response | `leanshot/src/components/community/CommunityFeed.tsx` | role-match |
| `leanshot/src/components/community/DMThreadView.tsx` | component | streaming | `leanshot/src/components/community/CommunityFeed.tsx` | role-match |
| `leanshot/src/components/community/DMMessageComposer.tsx` | component | request-response | `leanshot/src/components/community/CommunityPostComposer.tsx` | exact |
| `leanshot/src/components/community/LeaderboardChip.tsx` | component | request-response | `leanshot/src/components/community/ReactionBar.tsx` | role-match |
| `leanshot/src/components/community/ReportButton.tsx` | component | request-response | `leanshot/src/components/community/ReactionBar.tsx` | role-match |
| `leanshot/src/components/community/CommunityTabShell.tsx` (EXTEND) | component | request-response | self | — |
| `leanshot/src/lib/store.ts` (EXTEND) | store | CRUD | self | — |
| `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx` (EXTEND) | component | request-response | self | — |
| `leanshot/vite.config.ts` (EXTEND) | config | — | self | — |
| `leanshot/scripts/assert-bundle-budget.sh` (EXTEND) | config | — | self | — |

---

## Pattern Assignments

---

### `supabase/migrations/<ts>_p45_schema.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000001_p44_community_schema.sql`

**Transaction wrapper pattern** (lines 23–24):
```sql
begin;
-- ... all DDL here ...
commit;
```

**Table definition pattern** (lines 29–43, `community_spaces` table):
```sql
create table if not exists public.community_spaces (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  org_id      uuid        references public.organizations(id) on delete cascade,
  min_tier    text        not null default 'free'
                constraint community_spaces_min_tier_chk
                check (min_tier in ('free','pro','lifetime')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.community_spaces is '...';
comment on column public.community_spaces.org_id is '...';
```

**Core pattern for Phase 45 schema:** Copy the `begin;/commit;` wrapper, `create table if not exists`, `primary key default gen_random_uuid()`, FK references with `on delete cascade`, CHECK constraints, and `comment on table/column` conventions. New tables needed: `dm_threads`, `direct_messages`, `dm_thread_audit`, `user_block_list`, `community_reports`. New columns on `profiles`: `directory_opt_in`, `dm_open`, `is_clinician_verified`, `show_tier_badge`, `show_streak_badge`, `bio`, `links jsonb`, `admin_digest_opt_in`, `community_last_active_at`, `leaderboard_handle text`, `leaderboard_opt_in boolean`. New column on `community_spaces`: `leaderboard_enabled boolean default false`.

**`leaderboard_handle` CHECK constraint** (mirror of `leaderboard_optin.handle` in `20270708000011_p35_leaderboard_optin.sql` line 26):
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_handle text
    CONSTRAINT profiles_leaderboard_handle_format
      CHECK (leaderboard_handle ~ '^[a-zA-Z0-9_-]{6,24}$'),
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;
```

**Soft-delete pattern** (lines 62–64, `community_posts`):
```sql
  edited_at       timestamptz,
  deleted_at      timestamptz
```

---

### `supabase/migrations/<ts>_p45_rls.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000002_p44_community_rls.sql`

**RLS enable + policy creation pattern:** Phase 44 uses `DO $$ begin if not exists ... end $$` idempotency guards. Follow the same pattern.

**Two-mode directory visibility RLS** (from RESEARCH Pattern 8):
```sql
CREATE POLICY directory_members_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    directory_opt_in = true
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.org_members om WHERE om.user_id = profiles.id
      )
      OR
      EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = profiles.id
          AND om.org_id IN (
            SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
          )
      )
    )
  );
```

**Symmetric block check on `dm_threads` INSERT** (from RESEARCH Pattern 1):
```sql
CREATE POLICY dm_threads_insert_not_blocked ON public.dm_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    creator_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = recipient_user_id AND dm_open = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_block_list
      WHERE blocker_user_id = recipient_user_id
        AND blocked_user_id = auth.uid()
    )
  );
```

---

### `supabase/migrations/<ts>_p45_notification_widening.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000004_p44_notification_community.sql` — copy VERBATIM structure, extend category list.

**Atomic transaction wrapper** (lines 17–79 — ALL in one `begin;/commit;`):
```sql
begin;

-- Widen all 4 tables in one atomic transaction
alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report'   -- Phase 45 additions
    ));

-- Repeat identically for: notification_category_config, user_notifications,
-- notification_dismissal_state

-- Seed new config rows (UPSERT per reference_state_counter_table_needs_upsert_on_event)
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('community-dm',            10, null, false, true,  true,  true),
  ('community-admin-report',   1, null, false, false, true,  false)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  ...
  updated_at             = now();

commit;
```

**CRITICAL:** ALL 4 CHECK constraint alterations + category_config UPSERTs MUST be in one transaction. Never split across plans.

---

### `supabase/migrations/<ts>_p45_dm_attachments_bucket.sql` (migration, file-I/O)

**Analog:** `supabase/migrations/20270720000003_p44_community_media_bucket.sql`

**Bucket INSERT pattern** (lines 24–33):
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-attachments',
  'dm-attachments',
  false,           -- private bucket
  5242880,         -- 5 MB per D-09 (NOT 10 MB like community-media)
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;
```

**Key divergence from community-media:** The INSERT RLS cannot use `(storage.foldername(name))[1] = auth.uid()::text` because path segment 1 is `thread_id`, not `user_id`. Use a JOIN to `dm_threads` instead (from RESEARCH Pattern 5):
```sql
-- INSERT: participant check via JOIN to dm_threads
create policy objects_insert_dm_attachments on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dm-attachments'
    AND EXISTS (
      SELECT 1 FROM public.dm_threads dt
      WHERE dt.id = (storage.foldername(name))[1]::uuid   -- CAST text to uuid
        AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid())
    )
  );
```

**Idempotency guard pattern** (lines 40–54 of analog):
```sql
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_dm_attachments'
  ) then
    create policy objects_select_dm_attachments on storage.objects ...
  end if;
end $$;
```

---

### `supabase/migrations/<ts>_p45_leaderboard_matview.sql` (migration, batch)

**Analog:** `supabase/migrations/20270708000012_p35_leaderboard_matview.sql` + `20270708000013_p35_leaderboard_refresh_cron.sql`

**Matview + UNIQUE index pattern** (lines 28–57 of 12_p35_leaderboard_matview.sql):
```sql
create materialized view public.community_space_leaderboard_matview as
select
  cs.id         as space_id,
  ...
  rank() over (PARTITION BY cs.id ORDER BY score DESC, ...) as rank_in_space,
  now()         as refreshed_at
from ...
where ...
  and p.leaderboard_opt_in = true      -- unified opt-in flag from profiles
  and cs.leaderboard_enabled = true;   -- admin must enable per D-14

-- LOAD-BEARING: REFRESH CONCURRENTLY requires a UNIQUE index on (space_id, user_id)
create unique index idx_community_space_lb_space_user
  on public.community_space_leaderboard_matview (space_id, user_id);

-- Secondary for top-N queries
create index idx_community_space_lb_space_rank
  on public.community_space_leaderboard_matview (space_id, rank_in_space);

revoke all on public.community_space_leaderboard_matview from public;
grant select on public.community_space_leaderboard_matview to authenticated, service_role;
```

**Consolidated cron pattern** (from RESEARCH Pattern 4 + `20270708000013_p35_leaderboard_refresh_cron.sql` lines 22–44):
```sql
-- Pre-flight unschedule (dollar-quote naming per reference_postgres_dollar_quote_nesting_in_cron_body)
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job where jobname = 'phase35-leaderboard-refresh'
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

-- Re-register with BOTH matview refreshes
select cron.schedule(
  'phase35-leaderboard-refresh',   -- SAME job name for ops continuity
  '12,27,42,57 * * * *',
  $cron$
  do $refresh$ begin
    refresh materialized view concurrently public.leaderboard_matview;
    refresh materialized view concurrently public.community_space_leaderboard_matview;
  exception when others then
    raise notice 'phase35-leaderboard-refresh: error % — continuing', sqlerrm;
  end $refresh$;
  $cron$
);
```

**Admin report digest cron** (from `20270701000009_affiliate_anomaly_sla_cron.sql` lines 28–40):
```sql
select cron.schedule(
  'community-admin-report-digest',
  '0 9 * * *',   -- daily 09:00 UTC
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-admin-report-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
          ''
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
```

---

### `supabase/migrations/<ts>_p45_secdef_rpcs.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql`

**SECDEF function shell** (lines 25–86):
```sql
create or replace function public.<fn_name>(
  p_param1 type1,
  p_param2 type2
)
returns <return_type>
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  -- ... logic ...
end;
$fn$;

comment on function public.<fn_name>(...) is '...';
revoke execute on function public.<fn_name>(...) from public, anon;
grant  execute on function public.<fn_name>(...) to authenticated;
```

**Idempotent toggle pattern** (lines 57–76 of `toggle_community_reaction`):
```sql
if exists (
  select 1 from public.user_block_list
  where blocker_user_id = v_user_id and blocked_user_id = p_target_user_id
) then
  delete from public.user_block_list
  where blocker_user_id = v_user_id and blocked_user_id = p_target_user_id;
else
  insert into public.user_block_list (blocker_user_id, blocked_user_id)
    values (v_user_id, p_target_user_id);
end if;
```

**RPCs to ship in `p45_secdef_rpcs.sql`:**
- `toggle_community_block(p_target_user_id uuid)` — SELECT-then-INSERT-or-DELETE
- `community_report_create(p_target_type text, p_target_id uuid, p_reason text)` — auth.uid() only; returns inserted `id uuid`
- `admin_toggle_space_leaderboard(p_space_id uuid, p_enabled boolean)` — `public.is_staff()` guard
- `admin_set_clinician_verified(p_user_id uuid, p_verified boolean)` — `public.is_staff()` guard
- `admin_toggle_report_digest_opt_in(p_enabled boolean)` — auth.uid() + is_staff() check
- `update_community_last_active()` — SET `profiles.community_last_active_at = now()` WHERE id = auth.uid()
- `get_community_space_leaderboard(p_space_id uuid)` — top-10 + ±5 neighborhood; mirrors `get_leaderboard_for_user` from `20270708000014_p35_leaderboard_rpcs.sql`

---

### `supabase/functions/dm-create-thread/index.ts` (service, request-response)

**Analog:** `supabase/functions/notify-community/index.ts` — copy ENTIRELY, then adapt.

**Imports pattern** (lines 1–2 of notify-community):
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
```

**CORS + response helpers** (lines 38–66 — copy verbatim):
```typescript
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
function jsonResponse(status: number, body: unknown): Response { ... }
function jsonError(status: number, code: string): Response { ... }
function bearerFromReq(req: Request): string | null { ... }
function constantTimeEqual(a: string, b: string): boolean { ... }
```

**Lazy admin singleton** (lines 72–100 — copy verbatim):
```typescript
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient { ... }
let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void { _adminOverride = client; }
function resetAdminForTest(): void { _adminOverride = null; _adminInstance = null; }
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t, prop) {
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
}) as unknown as SupabaseClient;
```

**PII guard** (lines 107–116 — copy verbatim):
```typescript
async function hashForLog(value: string): Promise<string> { ... }
```

**Dual-auth pattern** (lines 122–157 — adapt for dm sender context):
```typescript
// Path A: service-role
// Path B: user JWT — JWT.sub must equal body.creator_user_id
```

**Rate-limit check** (from RESEARCH Pattern 2):
```typescript
async function checkRateLimit(
  admin: SupabaseClient,
  creatorId: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const { count } = await admin
    .from('dm_threads')
    .select('id', { count: 'exact', head: true })
    .eq('creator_user_id', creatorId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  // ... 429 return with Retry-After
}
```

**Activity debounce check** (from RESEARCH Pattern 7):
```typescript
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const isActive = recipProfile?.community_last_active_at
  ? recipProfile.community_last_active_at > fiveMinAgo
  : false;
if (!isActive) {
  // fire notify-community kind='dm_new'
}
```

**callNotificationSend** (lines 163–178 — copy verbatim, adapt category):
```typescript
async function callNotificationSend(
  userId: string,
  category: 'community-dm',
  payload: Record<string, unknown>,
): Promise<void> { ... }
```

**Deno.serve guard** (lines 370–373 — copy verbatim):
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handleDmCreateThread);
}
```

**Export for tests** (lines 379–383):
```typescript
export const __internal = {
  handleDmCreateThread,
  setAdminForTest,
  resetAdminForTest,
};
```

---

### `supabase/functions/dm-create-thread/index.test.ts` (test, request-response)

**Analog:** `supabase/functions/notify-community/index.test.ts`

**Test structure** (lines 1–30):
```typescript
import { assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const SERVICE_BEARER = 'test-service-role-key';
const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB_ID   = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
```

**Fake admin builder pattern** (lines 47–120):
```typescript
interface FakeAdminConfig {
  getUserResult?: { id: string } | null;
  // ... dm-specific fields
}
function makeFakeAdmin(cfg: FakeAdminConfig): any { ... }
```

**Test coverage targets** (from VALIDATION.md):
- T1: Missing bearer → 401
- T2: Rate limit hit (4th call) → 429 with `Retry-After` header
- T3: Blocked recipient → 403 with code `blocked`
- T4: Verified-clinician bypass skips rate limit + inserts audit row
- T5: dm_open=false recipient → 403
- T6: Successful thread creation → 201 with thread_id
- T7: notify-community callout skipped when recipient active within 5 min

---

### `supabase/functions/dm-create-thread/deno.json` (config)

**Analog:** `supabase/functions/notify-community/deno.json` (copy verbatim):
```json
{
  "tasks": {
    "test": "deno test --no-check --allow-env ."
  },
  "imports": {
    "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2"
  },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "useTabs": false, "lineWidth": 100 }
}
```

---

### `supabase/functions/community-admin-report-digest/index.ts` (service, event-driven)

**Analog:** `supabase/functions/notify-community/index.ts` (auth + structure) + `weekly-digest/index.ts` (cron-triggered pattern)

**Service-role-only auth** (simplification of dual-auth — digest is cron-only, no user JWT path):
```typescript
// From lifecycle-utils.ts pattern (weekly-digest line 54):
import { checkServiceRoleBearer, corsHeaders, jsonError, jsonResponse, makeLazyAdmin }
  from '../_shared/lifecycle-utils.ts';

// In handler:
if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
```

**Report count query + email dispatch pattern:**
```typescript
// Query open reports by target_type
const { data: counts } = await admin
  .from('community_reports')
  .select('target_type, count(*)')
  .eq('status', 'open')
  .limit(1000);

// Get admin recipients (is_staff=true AND admin_digest_opt_in=true)
const { data: admins } = await admin
  .from('profiles')
  .select('id')
  .eq('is_staff', true)
  .eq('admin_digest_opt_in', true);

// Fan-out email per admin via email-router
for (const admin of admins) {
  await sendEmail({
    template: 'community_admin_report_digest',
    to: admin.email,
    vars: { open_count, by_type_table },
    phi: false,  // non-PHI → Resend
  });
}
```

---

### `supabase/functions/_shared/email-templates/community-dm-new.ts` (utility, request-response)

**Analog:** `supabase/functions/_shared/email-templates/community-mention.ts` — copy structure verbatim.

**Template module shape** (lines 1–75 of community-mention.ts):
```typescript
function escapeHtml(s: string): string { ... }  // lines 19-26

export function subject(vars: Record<string, unknown>): string {
  const senderHandle = escapeHtml(String(vars.sender_handle ?? 'Someone'));
  return `New message from @${senderHandle}`;
}

export function render(vars: Record<string, unknown>): string {
  // vars: sender_handle, body_excerpt (≤80 chars post-dompurify per D-21), thread_url
  // Pattern: escapeHtml all user-supplied vars; encodeURI for URLs
  // Layout: same inline-CSS card + CTA button + notification footer
}
```

**Vars for `community_dm_new`:**
- `sender_handle` — anonymized sender handle shown in subject + body
- `body_excerpt` — first 80 chars of DM body (post-dompurify, truncated server-side)
- `thread_url` — HTTPS deeplink to the DM thread

---

### `supabase/functions/_shared/email-templates/community-admin-report-digest.ts` (utility, request-response)

**Analog:** `supabase/functions/_shared/email-templates/community-mention.ts`

**Vars for `community_admin_report_digest`:**
- `open_count` — total open reports
- `by_type` — array of `{ target_type, count }` rows for the table
- `digest_date` — ISO date string
- `admin_url` — link to Phase 48 moderation queue (placeholder `/admin/community/reports`)

---

### Extension: `supabase/functions/notify-community/index.ts` (extend existing)

**What to add:** New `kind: 'dm_new'` arm in the body union + handler.

**Body union extension** (after line 202 `type NotifyBody = MentionBody | ReplyBody;`):
```typescript
interface DmNewBody {
  kind: 'dm_new';
  thread_id: string;
  sender_user_id: string;
  sender_handle: string;
  recipient_user_id: string;
  body_excerpt: string;  // ≤80 chars post-dompurify
}

type NotifyBody = MentionBody | ReplyBody | DmNewBody;
```

**Dm fan-out handler** (single-recipient, not N-mention loop):
```typescript
if (body.kind === 'dm_new') {
  // Auth: sender JWT sub must match body.sender_user_id (mirrors T-44-08)
  // Fan-out to single recipient (body.recipient_user_id)
  await callNotificationSend(body.recipient_user_id, 'community-dm', {
    sender_handle: body.sender_handle,
    body_excerpt: body.body_excerpt,
    thread_url: `https://app.leanshot.app/community/dm/${body.thread_id}`,
  });
  return jsonResponse(200, { fanout_count: 1 });
}
```

---

### Extension: `supabase/functions/_shared/email-router.ts` (extend existing)

**Union extension** (after line 96 `| 'community_reply'`):
```typescript
// Phase 45 Plan 45-02 — DM + admin report digest templates (non-PHI → Resend).
// Per feedback_planner_missed_status_enum_widening: union extension +
// subjectFor + renderTemplate switch arms MUST land in the SAME commit.
| 'community_dm_new'             // non-PHI → Resend. New DM notification.
| 'community_admin_report_digest' // non-PHI → Resend. Admin daily report count.
```

**Import additions** (after line 51 `import * as communityReply`):
```typescript
import * as communityDmNew         from './email-templates/community-dm-new.ts';
import * as communityAdminDigest   from './email-templates/community-admin-report-digest.ts';
```

**subjectFor switch arms** (after `case 'community_reply': return communityReply.subject(vars);`):
```typescript
case 'community_dm_new':
  return communityDmNew.subject(vars);
case 'community_admin_report_digest':
  return communityAdminDigest.subject(vars);
```

---

### Extension: `supabase/functions/notification-send/index.ts` (extend existing)

**VALID_CATEGORIES extension** (after line 179 `'community-replies'`):
```typescript
// Phase 45 Plan 45-02 — DM + admin report digest categories.
// Must match the CHECK constraints in <ts>_p45_notification_widening.sql
'community-dm',
'community-admin-report',
```

---

### `leanshot/src/components/community/use-dm-inbox-realtime.ts` (hook, event-driven)

**Analog:** `leanshot/src/components/community/use-space-realtime.ts` — copy VERBATIM structure.

**Full hook shape** (all 54 lines — copy structure, adapt channel name + filter):
```typescript
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useDmInboxRealtime(
  userId: string | null,
  onNewMessage: (msg: { thread_id: string; sender_user_id: string }) => void,
): void {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`dm:${userId}`)         // D-18: per-user inbox channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => onNewMessage(payload.new as { thread_id: string; sender_user_id: string }),
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[dm-inbox-realtime] channel error — live updates paused');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // onNewMessage intentionally excluded from deps — callers must memoize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
```

---

### `leanshot/src/components/community/CommunityDirectoryView.tsx` (component, request-response)

**Analog:** `leanshot/src/components/community/CommunitySpaceView.tsx`

**Imports pattern** (lines 16–26 of CommunitySpaceView):
```typescript
import { Suspense, lazy, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
```

**Lazy chunk loading pattern** (lines 24–36):
```typescript
// community-directory chunk (NOT community-feed)
const ProfileCard = lazy(() =>
  import('./ProfileCard').then((m) => ({ default: m.ProfileCard })),
);
```

**Handle-prefix search RPC pattern:**
```typescript
// D-04: handle-prefix search via RPC (not direct query — RLS mediated)
const { data } = await supabase.rpc('search_directory', {
  p_handle_prefix: searchTerm,
  p_tier_filter: tierFilter ?? null,
  p_cursor_handle: cursor?.handle ?? null,
  p_cursor_user_id: cursor?.userId ?? null,
  p_limit: 20,
});
```

**Skeleton fallback pattern** (lines 48–54 of CommunityTabShell.tsx):
```tsx
const fallback = (
  <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="Loading directory">
    <Skeleton className="h-24 w-full rounded-xl" />
    <Skeleton className="h-24 w-full rounded-xl" />
  </div>
);
```

---

### `leanshot/src/components/community/DMMessageComposer.tsx` (component, request-response)

**Analog:** `leanshot/src/components/community/CommunityPostComposer.tsx`

**Core pattern:** Mirror CommunityPostComposer's file-attachment → upload → POST flow, but call `dm-create-thread` Edge Fn instead of `community_posts` insert. Reuse `COMMUNITY_MEDIA_MIMES` + `COMMUNITY_MEDIA_MAX_BYTES` constants from `community-storage.ts` for the attachment MIME/size guard (D-09: 5 MB cap, same MIME set). DM image upload calls a new `uploadDmAttachment(file, threadId, messageId)` helper that follows the same Result pattern as `uploadCommunityMedia`.

---

### `leanshot/src/components/community/LeaderboardChip.tsx` (component, request-response)

**Analog:** `leanshot/src/components/community/ReactionBar.tsx`

**Pattern:** Small, self-contained component mounted inside `CommunitySpaceView`. Fetches from `supabase.rpc('get_community_space_leaderboard', { p_space_id })`. Renders top-3 handles + "View full leaderboard" expansion. Respects `leaderboard_enabled` flag passed as prop. Shows Phase 44 locked-card UX (`/pricing` CTA) for tier-blocked users.

---

### Admin components in `leanshot/src/admin/modules/community/` (EXTEND existing layout)

**Analog:** `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx`

**Pathname routing pattern** (lines 125–132):
```typescript
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; spaceId: string };

function resolveView(pathname: string): View {
  const m = pathname.match(/^\/admin\/community\/?([^/]+)?(?:\/([^/]+))?/);
  // ... parse sub-routes
}
```

**navigate helper pattern** (lines 147–151):
```typescript
const navigate = (path: string) => {
  window.history.pushState({}, '', path);
  setPathname(path);
};
```

**New sub-routes to add to `CommunityAdminLayout.tsx`:**
- `/admin/community/profiles` → `AdminCliniciansPage` (clinician verified toggle)
- `/admin/community/reports` → `AdminReportsDigestPage` (digest opt-in + summary)
- `/admin/community/:id/leaderboard` → extend `SpaceEditor` with leaderboard_enabled toggle

**New admin sub-page pattern** (follow `SpacesListPage` fn in lines 41–116):
```typescript
function AdminCliniciansPage({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    void supabase.rpc('admin_search_clinicians').then(...);
  }, []);
  // table + toggle button calling supabase.rpc('admin_set_clinician_verified', ...)
}
```

---

### `leanshot/src/components/community/CommunityTabShell.tsx` (EXTEND)

**What to add:** `activeCommunityView` Zustand state field + sub-view dispatch.

**Store extension in `leanshot/src/lib/store.ts`** (add after line 82 `activeCommunitySpaceId`):
```typescript
/**
 * Phase 45 — active community sub-view for directory/DM/leaderboard navigation.
 * NOT persisted. null = show space list (legacy).
 */
activeCommunityView: 'feed' | 'directory' | 'dm' | null;
```

**CommunityTabShell switch** (extends lines 55–71):
```typescript
{activeView === 'directory' && (
  <Suspense fallback={fallback}>
    <CommunityDirectoryView currentUserId={currentUserId} currentTier={currentTier} />
  </Suspense>
)}
{activeView === 'dm' && (
  <Suspense fallback={fallback}>
    <DMInboxView currentUserId={currentUserId} />
  </Suspense>
)}
{/* existing: space list / space view */}
```

---

### `leanshot/vite.config.ts` (EXTEND — manualChunks)

**Analog:** Existing community sub-chunk rules, lines 194–206.

**New rules to insert BEFORE line 206** (`if id.includes('/src/components/community/') return 'community-feed'`):
```typescript
// Phase 45 Plan 45-07 — community-directory and community-dm sub-chunks.
// ORDER MATTERS: MUST appear before the community-feed catch-all at line 206.
if (
  id.includes('/src/components/community/CommunityDirectoryView') ||
  id.includes('/src/components/community/ProfileCard')
) return 'community-directory';

if (
  id.includes('/src/components/community/DM') ||     // DMInboxView, DMThreadView, DMMessageComposer
  id.includes('/src/components/community/use-dm-inbox-realtime')
) return 'community-dm';
```

---

### `leanshot/scripts/assert-bundle-budget.sh` (EXTEND)

**Analog:** Existing entries at lines 46–48.

**New entries to append:**
```bash
"community-directory  10 Phase 45: CommunityDirectoryView + ProfileCard. Handle-prefix search only in v1 (no FTS). If regressed: check ProfileCard is not importing heavy deps."
"community-dm         35 Phase 45: DMInboxView + DMThreadView (react-virtuoso virtualization) + DMMessageComposer + use-dm-inbox-realtime. react-virtuoso already in community-feed deps. Lever: defer virtuoso or split DMThreadView."
```

---

## Shared Patterns

### Dual-Auth (Service-Role OR User JWT)
**Source:** `supabase/functions/notify-community/index.ts` lines 122–157
**Apply to:** `dm-create-thread/index.ts` (sender JWT must match `body.creator_user_id`)
```typescript
type AuthOutcome =
  | { kind: 'service_role' }
  | { kind: 'user'; userId: string }
  | { kind: 'reject'; status: 401 | 403; code: 'unauthorized' | 'identity_mismatch' };

async function authenticate(req: Request, body: { creator_user_id?: string }): Promise<AuthOutcome> {
  const bearer = bearerFromReq(req);
  if (!bearer) return { kind: 'reject', status: 401, code: 'unauthorized' };
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRoleKey && constantTimeEqual(bearer, serviceRoleKey)) return { kind: 'service_role' };
  const { data, error } = await (admin.auth as any).getUser(bearer);
  if (error || !data?.user?.id) return { kind: 'reject', status: 401, code: 'unauthorized' };
  const claimedUserId = body.creator_user_id ?? '';
  if (!claimedUserId || claimedUserId !== data.user.id)
    return { kind: 'reject', status: 403, code: 'identity_mismatch' };
  return { kind: 'user', userId: data.user.id };
}
```

### Service-Role-Only Auth (cron-triggered Fns)
**Source:** `supabase/functions/_shared/lifecycle-utils.ts` line 94 `checkServiceRoleBearer`
**Apply to:** `community-admin-report-digest/index.ts`
```typescript
import { checkServiceRoleBearer } from '../_shared/lifecycle-utils.ts';
// In handler:
if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
```

### PII Guard (sha256 before logging)
**Source:** `supabase/functions/notify-community/index.ts` lines 107–116
**Apply to:** `dm-create-thread/index.ts`, `community-admin-report-digest/index.ts`
```typescript
async function hashForLog(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
// Usage: console.log(`[dm-create-thread] user sha256:${await hashForLog(userId)}`);
```

### DOMPurify Reuse (MANDATORY — no new policy)
**Source:** `leanshot/src/lib/community/dompurify-config.ts`
**Apply to:** Profile bio rendering (D-05), DM message body rendering (D-09), DM attachment captions
```typescript
import { sanitizeCommunityMarkdown, renderPostBodyHtml } from '@/lib/community/dompurify-config';
// For DM bodies — same 500-char cap + FORBID_TAGS:['img'] policy
// Images flow through DMAttachmentUploader, not inline markdown
```

### Storage Signed-URL (60-min TTL)
**Source:** `leanshot/src/lib/community/community-storage.ts` lines 113–128
**Apply to:** `dm-attachments` bucket signed URL reads
```typescript
// Reuse COMMUNITY_MEDIA_MIMES + COMMUNITY_MEDIA_MAX_BYTES constants (DM cap is 5 MB, not 10 MB)
// Export new DM_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 alongside existing constants
// or simply inline the 5 MB check in DMMessageComposer
export async function getDmAttachmentSignedUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage
    .from('dm-attachments')
    .createSignedUrl(path, 3600);  // 60-min TTL per D-09
  if (error || !data) return { error: 'network' };
  return { url: data.signedUrl };
}
```

### SECDEF Pattern (auth.uid() + search_path)
**Source:** `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` lines 25–95
**Apply to:** All 7 RPCs in `p45_secdef_rpcs.sql`
```sql
security definer
set search_path = public, extensions
-- Always first check: if auth.uid() is null then raise exception 'unauthenticated'
-- For admin RPCs: additionally check public.is_staff()
```

### Zustand Selector (single-selector per primitive)
**Source:** `leanshot/src/components/community/CommunityTabShell.tsx` lines 34–36
**Apply to:** All Phase 45 consumer components
```typescript
const currentUserId = useStore((s) => s.signedIn?.user?.id ?? '');
const activeSpaceId = useStore((s) => s.activeCommunitySpaceId);
// NEVER: useStore(s => s)
```

### Admin SECDEF Guard (is_staff)
**Source:** `CONTEXT.md §Established Patterns` + RESEARCH
**Apply to:** `admin_toggle_space_leaderboard`, `admin_set_clinician_verified`, `admin_toggle_report_digest_opt_in` RPCs
```sql
if not public.is_staff() then
  raise exception 'forbidden' using errcode = '42501';
end if;
```

### Notification CHECK Widening (Atomic)
**Source:** `supabase/migrations/20270720000004_p44_notification_community.sql`
**Apply to:** `p45_notification_widening.sql` — all items listed in RESEARCH Pattern 6 MUST land in one `begin;/commit;` transaction:
1. 4x `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT ... check(... 'community-dm', 'community-admin-report')`
2. 2x `notification_category_config` UPSERT
3. `email-router.ts` union extension + imports + switch arms
4. `notify-community/index.ts` `DmNewBody` + handler arm
5. `notification-send/index.ts` `VALID_CATEGORIES` extension
6. New template files `community-dm-new.ts` + `community-admin-report-digest.ts`

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `leanshot/src/components/community/DMThreadView.tsx` (react-virtuoso) | component | streaming | react-virtuoso `<Virtuoso>` variable-height message list has no existing analog in this codebase. Use react-virtuoso docs directly. |

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/functions/`, `leanshot/src/components/community/`, `leanshot/src/lib/community/`, `leanshot/src/admin/modules/community/`, `leanshot/scripts/`
**Files scanned:** ~35 files read, ~15 grepped
**Pattern extraction date:** 2026-05-23

---

## PATTERN MAPPING COMPLETE

**Phase:** 45 — M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard
**Files classified:** 33
**Analogs found:** 32 / 33

### Coverage
- Files with exact analog: 18
- Files with role-match analog: 14
- Files with no analog: 1 (`DMThreadView.tsx` react-virtuoso virtualized list)

### Key Patterns Identified

1. **`notify-community/index.ts` is the master template** for both `dm-create-thread` and `community-admin-report-digest` — dual-auth helpers, lazy admin singleton, PII guard, and `import.meta.main` Deno.serve guard all copy verbatim.

2. **`20270720000004_p44_notification_community.sql` is the master migration template** for notification CHECK widening — all 4 tables + category_config UPSERT in one `begin;/commit;` — non-negotiable atomicity.

3. **`use-space-realtime.ts` is the verbatim hook shape** for `use-dm-inbox-realtime.ts` — only the channel name (`dm:${userId}`), table, and filter string differ.

4. **`20270708000012_p35_leaderboard_matview.sql`** supplies the UNIQUE index requirement and `REVOKE/GRANT` pattern; `20270708000013_p35_leaderboard_refresh_cron.sql` supplies the dollar-quote cron consolidation pattern (unschedule + re-register with same job name).

5. **`CommunityAdminLayout.tsx`** is the verbatim admin module shell for the Phase 45 extended admin sub-pages — pathname-based routing, `resolveView()`, `navigate()`, `window.history.pushState`.

6. **`20270720000003_p44_community_media_bucket.sql`** is the base pattern for `dm-attachments` bucket — key difference: INSERT RLS uses `JOIN dm_threads` instead of `(foldername)[1] = auth.uid()::text` because path[0] is `thread_id` not `user_id`.

7. **vite.config.ts manualChunks ordering rule** — new `community-directory` and `community-dm` rules MUST precede line 206's `community-feed` catch-all.

### Plan → Primary Analog Mapping

| Plan | Primary Analog |
|------|---------------|
| 45-01 (profiles + dm tables schema) | `20270720000001_p44_community_schema.sql` |
| 45-02 (notification CHECK widening — ATOMIC) | `20270720000004_p44_notification_community.sql` |
| 45-03 (dm-attachments bucket) | `20270720000003_p44_community_media_bucket.sql` |
| 45-04 (dm-create-thread Edge Fn) | `supabase/functions/notify-community/index.ts` |
| 45-05 (community-admin-report-digest Edge Fn) | `notify-community/index.ts` + `weekly-digest/index.ts` |
| 45-06 (leaderboard matview + cron consolidation) | `20270708000012_p35_leaderboard_matview.sql` + `20270708000013_p35_leaderboard_refresh_cron.sql` |
| 45-07 (consumer UI: directory + DM + leaderboard chip) | `CommunityTabShell.tsx` + `use-space-realtime.ts` + `CommunitySpaceView.tsx` |
| 45-08 (admin UI: extend CommunityAdminLayout) | `src/admin/modules/community/CommunityAdminLayout.tsx` |
| 45-09 (vite.config + bundle budget) | `vite.config.ts` lines 194–206 + `scripts/assert-bundle-budget.sh` lines 46–48 |
| 45-10 (SECDEF RPCs) | `20270720000005_p44_community_secdef_rpcs.sql` |
| 45-11 (RLS policies) | `20270720000002_p44_community_rls.sql` |
