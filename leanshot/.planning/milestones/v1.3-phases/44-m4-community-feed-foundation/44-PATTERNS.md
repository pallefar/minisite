# Phase 44: M4 Community Feed Foundation - Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 22 new/modified files
**Analogs found:** 20 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/*_p44_community_schema.sql` | migration | CRUD | `supabase/migrations/20270707000020_helpdesk_rls_policies.sql` | exact (org_id + auth.uid() RLS) |
| `supabase/migrations/*_p44_community_rls.sql` | migration | CRUD | `supabase/migrations/20270707000020_helpdesk_rls_policies.sql` | exact |
| `supabase/migrations/*_p44_community_media_bucket.sql` | migration | file-I/O | `supabase/migrations/20260801000003_org_logos_storage.sql` | exact |
| `supabase/migrations/*_p44_notification_community.sql` | migration | CRUD | `supabase/migrations/20270704000001_notification_settings.sql` | exact (same CHECK constraint pattern) |
| `supabase/migrations/*_p44_community_secdef_rpcs.sql` | migration | CRUD | `supabase/migrations/20270710000005_p36_review_secdef_rpcs.sql` | role-match |
| `supabase/functions/mux-create-upload/index.ts` | service | request-response | `supabase/functions/notification-send/index.ts` | exact (service-role bearer + tier gate) |
| `supabase/functions/mux-create-upload/deno.json` | config | — | `supabase/functions/cancellation-accept-offer/deno.json` | exact |
| `supabase/functions/mux-webhook/index.ts` | service | event-driven | `supabase/functions/stripe-webhook/index.ts` | exact (raw-body + HMAC signature verify) |
| `supabase/functions/mux-webhook/deno.json` | config | — | `supabase/functions/cancellation-accept-offer/deno.json` | exact |
| `supabase/functions/notify-community/index.ts` | service | event-driven | `supabase/functions/notification-send/index.ts` | exact (service-role + fan-out loop) |
| `supabase/functions/notify-community/deno.json` | config | — | `supabase/functions/cancellation-accept-offer/deno.json` | exact |
| `supabase/functions/_shared/email-router.ts` (modify) | service | request-response | itself | exact (union-widening pattern) |
| `src/components/community/CommunityFeed.tsx` | component | request-response | `src/helpdesk/KBArticleView.tsx` | role-match (supabase fetch + useState lifecycle) |
| `src/components/community/CommunityPost.tsx` | component | request-response | `src/helpdesk/KBArticleView.tsx` | exact (ReactMarkdown + DOMPurify render) |
| `src/components/community/CommunityPostComposer.tsx` | component | CRUD | `src/components/admin/cancellation/RuleEditor.tsx` | role-match (form + supabase insert + toast) |
| `src/components/community/CommunitySpaceList.tsx` | component | request-response | `src/helpdesk/KBArticleView.tsx` | role-match |
| `src/components/community/admin/SpaceEditor.tsx` | component | CRUD | `src/components/admin/cancellation/RuleEditor.tsx` | exact (admin form CRUD pattern) |
| `src/components/community/mentions/MentionTypeahead.tsx` | component | request-response | `src/helpdesk/MacroTypeahead.tsx` | exact (Fuse.js + listbox + lazy chunk) |
| `src/components/community/use-space-realtime.ts` | hook | event-driven | `src/components/clinic/roster/use-roster-realtime.ts` | exact |
| `src/lib/community/community-storage.ts` | utility | file-I/O | `src/lib/page-builder/page-assets.ts` | exact |
| `src/lib/community/dompurify-config.ts` | utility | transform | `src/helpdesk/KBArticleView.tsx` (lines 66) | exact (fork + FORBID_TAGS) |
| `src/lib/community/tier-gate.ts` | utility | request-response | no close analog | no-analog (new `tier_effective` read pattern) |
| `leanshot/vite.config.ts` (modify) | config | — | itself (line 194) | exact |

---

## Pattern Assignments

### `supabase/migrations/*_p44_community_schema.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270707000020_helpdesk_rls_policies.sql`

**Table creation pattern** — wrap in `begin; ... commit;`, use `if not exists`, add named constraints:
```sql
begin;

create table if not exists public.community_spaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  org_id          uuid references public.organizations(id) on delete cascade,
  min_tier        text not null default 'free'
                    check (min_tier in ('free','pro','lifetime')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

commit;
```

**org_id + is_staff column pattern** — every org-private table carries nullable `org_id`:
```sql
-- org_id IS NULL  → global space (all orgs)
-- org_id IS NOT NULL → clinic-private (only org members can see)
-- D-09: non-org users cannot probe org-private space existence
```

**Denormalized space_id on community_comments** — required per RESEARCH Pitfall 5:
```sql
create table if not exists public.community_comments (
  ...
  space_id  uuid not null references public.community_spaces(id) on delete cascade,
  -- denormalized for Realtime filter efficiency (RESEARCH Pitfall 5)
  post_id   uuid not null references public.community_posts(id) on delete cascade,
  ...
);
```

**Body cap CHECK** (D-11) and **emoji CHECK** (D-03):
```sql
constraint community_posts_body_len_chk check (char_length(body) <= 5000),
constraint community_reactions_emoji_chk check (emoji in ('like','heart','target','fire','clap')),
```

---

### `supabase/migrations/*_p44_community_rls.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270707000020_helpdesk_rls_policies.sql`

**Org-scoped SELECT policy pattern** — join `org_members` without GUC (lines 25–32, 99–111):
```sql
-- community_spaces SELECT — mirrors kb_select_published_org (lines 278–291)
create policy cspace_select_global
  on public.community_spaces
  for select to authenticated
  using (org_id is null);

create policy cspace_select_org_member
  on public.community_spaces
  for select to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members
      where org_id = community_spaces.org_id
        and user_id = auth.uid()
    )
  );
```

**Tier-gated SELECT policy** — check `tier_effective` inline (D-08):
```sql
-- Posts in a space: caller must satisfy space.min_tier via tier_effective
create policy cpost_select_tier
  on public.community_posts
  for select to authenticated
  using (
    exists (
      select 1 from public.community_spaces cs
      join public.tier_effective te on te.user_id = auth.uid()
      where cs.id = community_posts.space_id
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );
```

**Soft-delete filtering** — omit `deleted_at IS NOT NULL` rows from SELECT:
```sql
-- Add to all SELECT policies on community_posts + community_comments:
and community_posts.deleted_at is null
```

**Author-only UPDATE/soft-DELETE** (D-15):
```sql
create policy cpost_update_author
  on public.community_posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
```

**RLS enable** — required before policies take effect:
```sql
alter table public.community_spaces     enable row level security;
alter table public.community_posts      enable row level security;
alter table public.community_comments   enable row level security;
alter table public.community_reactions  enable row level security;
alter table public.community_post_media enable row level security;
```

---

### `supabase/migrations/*_p44_community_media_bucket.sql` (migration, file-I/O)

**Analog:** `supabase/migrations/20260801000003_org_logos_storage.sql`

**Bucket insert pattern** (lines 24–33) — idempotent, PRIVATE (not public), MIME whitelist:
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-media',
  'community-media',
  false,                          -- private bucket; signed URLs only (D-04)
  10485760,                       -- 10 MB per image
  array['image/jpeg','image/png','image/webp']  -- no SVG (T-security: XSS via SVG)
)
on conflict (id) do nothing;
```

**Storage RLS policy pattern** (lines 41–132) — `do $$ if not exists ... $$` guard:
```sql
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_community_media'
  ) then
    create policy objects_select_community_media on storage.objects
      for select to authenticated
      using (
        bucket_id = 'community-media'
        and auth.uid() is not null
      );
  end if;
end $$;
```

**INSERT policy** — author_id parsed from path prefix (`{user_id}/{post_id}/...`):
```sql
create policy objects_insert_community_media on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'community-media'
    -- leading path segment = caller's user_id (mirrors Phase 15 pattern)
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

**DELETE policy** — author or is_staff (no admin-only hard-delete in Phase 44; Phase 48 adds that):
```sql
create policy objects_delete_community_media on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

### `supabase/migrations/*_p44_notification_community.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270704000001_notification_settings.sql`

**CHECK constraint widening pattern** — DROP + ADD atomically for all four tables in one migration (RESEARCH Pattern 6). All four tables have identical category CHECK lists (confirmed by grep):

```sql
begin;

-- Widen all 4 notification tables in one atomic transaction (RESEARCH §3.1 HARD BLOCKER)
-- Per feedback_planner_missed_status_enum_widening: DROP + ADD in same migration.

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add constraint user_notifications_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies'
    ));

-- Seed config rows — UPSERT (state_counter_table_needs_upsert_on_event)
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('community-mentions', 20, null, false, false, true,  true),
  ('community-replies',  20, null, false, false, false, true)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

commit;
```

---

### `supabase/functions/mux-create-upload/index.ts` (service, request-response)

**Analog:** `supabase/functions/notification-send/index.ts`

**Imports pattern** (lines 33–34):
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Mux from 'npm:@mux/mux-node@14';
```

**Service-role bearer auth pattern** (lines 65–76) — copy verbatim:
```typescript
function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

**jsonResponse / jsonError helpers** (lines 54–63) — copy verbatim:
```typescript
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
```

**Lazy admin singleton pattern** (lines 82–111) — copy verbatim.

**Tier gate pattern** (RESEARCH §Code Examples):
```typescript
// After bearer check:
const { data: tier } = await admin
  .from('tier_effective')
  .select('tier_label')
  .eq('user_id', userId)
  .single();
const isVideoAllowed = tier?.tier_label === 'pro'
  || tier?.tier_label === 'lifetime'
  || tier?.tier_label === 'trial';
if (!isVideoAllowed) return jsonError(403, 'VIDEO_TIER_REQUIRED');
```

**Mux upload creation** (RESEARCH Pattern 3):
```typescript
const mux = new Mux({
  tokenId: Deno.env.get('MUX_TOKEN_ID')!,
  tokenSecret: Deno.env.get('MUX_TOKEN_SECRET')!,
});
const upload = await mux.video.uploads.create({
  cors_origin: req.headers.get('origin') ?? '*',
  new_asset_settings: {
    playback_policies: ['public'],
    max_duration_seconds: 300,  // D-05: 5 min
    passthrough: JSON.stringify({ user_id: userId, post_id: postId }),
  },
  timeout: 3600,
});
```

**Deno.serve guard pattern** (lines 467–470) — prevents top-level serve trap:
```typescript
// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
```

---

### `supabase/functions/mux-webhook/index.ts` (service, event-driven)

**Analog:** `supabase/functions/stripe-webhook/index.ts`

**Raw body read FIRST pattern** (stripe-webhook lines 1–15 comment + line 80+) — read body as text before any other processing:
```typescript
// CRITICAL: read raw body BEFORE any other processing (same as stripe-webhook)
const body = await req.text();

// Verify signature using @mux/mux-node (RESEARCH Pattern 4)
const mux = new Mux({ webhookSecret: Deno.env.get('MUX_WEBHOOK_SECRET')! });
try {
  mux.webhooks.verifySignature(body, req.headers, Deno.env.get('MUX_WEBHOOK_SECRET')!);
} catch {
  return new Response('Unauthorized', { status: 401 });
}
const event = JSON.parse(body) as { type: string; data: { id: string; playback_ids?: Array<{ id: string }> } };
```

**Event handler pattern** (stripe-webhook event dispatch shape):
```typescript
if (event.type === 'video.asset.ready') {
  const playbackId = event.data.playback_ids?.[0]?.id ?? null;
  // UPDATE community_posts SET video_status='ready', mux_playback_id=$1
  // WHERE mux_upload_id = passthrough.upload_id
}
if (event.type === 'video.asset.errored') {
  // UPDATE community_posts SET video_status='rejected'
}
```

**Admin client pattern** — use `createClient` with service role (stripe-webhook lines 72–77):
```typescript
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);
```

---

### `supabase/functions/notify-community/index.ts` (service, event-driven)

**Analog:** `supabase/functions/notification-send/index.ts`

**Service-role bearer check** (lines 65–76) — copy verbatim from notification-send.

**Fan-out loop pattern** — iterate over mention join table rows, call notification-send once per user:
```typescript
// Fan-out: call notification-send once per mentioned user (RESEARCH Open Q2 resolution)
for (const row of mentionRows) {
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notification-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      user_id: row.user_id,
      category: 'community-mentions',
      payload: { post_id: postId, space_id: spaceId, mentioned_by: authorId },
    }),
  });
}
```

**PII logging guard** — hash email before logging (notification-send discipline):
```typescript
// NEVER log raw user_id or email — sha256 hash in logs only (Phase 25 PII pattern)
```

**VALID_CATEGORIES set** — must include new community categories (notification-send line 169):
```typescript
// notify-community is a NEW Fn, not a modification of notification-send
// notification-send's VALID_CATEGORIES set must be updated separately in
// the same commit as the CHECK constraint migration (see Shared Patterns).
```

---

### `supabase/functions/_shared/email-router.ts` (modify — union widening)

**Analog:** itself

**Union widening pattern** — per `feedback_planner_missed_status_enum_widening`, union extension + `subjectFor` switch arm + `renderTemplate` switch arm MUST land in the same commit (confirmed present at lines 76–86 for Phase 40 templates):
```typescript
// Add to EmailTemplate union (after 'pause_resumed_t0'):
| 'community_mention'   // non-PHI → Resend
| 'community_reply'     // non-PHI → Resend
```

```typescript
// Add to subjectFor switch (mirrors pause_reminder_t7 pattern):
case 'community_mention': return `${vars.mentioned_by ?? 'Someone'} mentioned you`;
case 'community_reply':   return 'New reply on your post';
```

```typescript
// Add to renderTemplate switch:
case 'community_mention': return communityMentionTemplate.render(vars);
case 'community_reply':   return communityReplyTemplate.render(vars);
```

**Also update `VALID_CATEGORIES` in `notification-send/index.ts`** (line 169) — same commit:
```typescript
const VALID_CATEGORIES = new Set<Category>([
  'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
  'community-mentions', 'community-replies',   // Phase 44 additions
]);
```

---

### `supabase/functions/*/deno.json` (config)

**Analog:** `supabase/functions/cancellation-accept-offer/deno.json`

**Per-function deno.json pattern** — required per `reference_supabase_functions_deploy_import_map_flag` (CLI v2.101.0 silently ignores `--import-map`):
```json
{
  "tasks": {
    "test": "deno test --no-check ."
  },
  "imports": {
    "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2",
    "npm:@mux/mux-node@14": "npm:@mux/mux-node@14"
  },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "useTabs": false, "lineWidth": 100 }
}
```

---

### `src/components/community/use-space-realtime.ts` (hook, event-driven)

**Analog:** `src/components/clinic/roster/use-roster-realtime.ts`

**Full file is the template** — copy the entire pattern, replace topic + event names:

**Imports pattern** (lines 1–14):
```typescript
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
```

**Subscribe/cleanup lifecycle** (lines 26–51) — key patterns to copy:
```typescript
export function useSpaceRealtime(spaceId: string, onUpdate: () => void): void {
  useEffect(() => {
    if (!spaceId) return;

    const channel = supabase
      .channel(`community:${spaceId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_posts',
          filter: `space_id=eq.${spaceId}` },
        () => onUpdate()
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_comments',
          filter: `space_id=eq.${spaceId}` },   // space_id denormalized (RESEARCH Pitfall 5)
        () => onUpdate()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'community_reactions' },
        () => onUpdate()
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[community-realtime] channel error — live updates paused');
        }
      });

    return () => { void supabase.removeChannel(channel); };
    // onUpdate intentionally excluded from deps — callers must memoize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);
}
```

**CHANNEL_ERROR handling** — use `use-clinician-alerts-realtime.ts` (lines 73–80) for the richer status-tracking variant if `isSubscribed` state is needed:
```typescript
// Mirror use-clinician-alerts-realtime.ts lines 73–80 for status tracking:
.subscribe((status: string) => {
  if (status === 'SUBSCRIBED') setIsSubscribed(true);
  else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    console.warn(`[community-realtime] channel status: ${status}`);
    setIsSubscribed(false);
  }
});
```

---

### `src/components/community/mentions/MentionTypeahead.tsx` (component, request-response)

**Analog:** `src/helpdesk/MacroTypeahead.tsx` — copy the **entire pattern**, swap table + keys

**Chunk isolation** (lines 13–14 comment) — MUST be lazy-imported to stay in `community-mentions` sub-chunk (same as `helpdesk-macros` sub-chunk):
```typescript
// This file is lazy-imported → lands in 'community-mentions' chunk, NOT 'community-feed'
// Fuse.js bytes stay isolated (8 kB gz) per vite.config.ts manualChunks routing.
import Fuse from 'fuse.js';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { supabase } from '@/lib/supabase';
```

**Fuse.js instance pattern** (lines 59–66):
```typescript
const fuse = useMemo(() => {
  if (!items || items.length === 0) return null;
  return new Fuse(items, {
    keys: ['handle', 'display_name'],
    threshold: 0.4,
    includeScore: true,
  });
}, [items]);
```

**Listbox a11y pattern** (lines 79–102) — copy aria-label, role="listbox", role="option", aria-selected:
```typescript
<ul
  role="listbox"
  aria-label="Mention suggestions"
  className="border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] shadow-md max-h-48 overflow-y-auto"
>
  {visible.map((u) => (
    <li key={u.id}>
      <button
        type="button"
        role="option"
        aria-selected="false"
        onClick={() => onSelect(u.handle)}
        className="text-left w-full p-2 hover:bg-[var(--color-surface-elevated)] flex flex-col"
      >
        <span className="text-xs text-[var(--color-fg-muted)]">@{u.handle}</span>
        <span className="text-sm">{u.display_name}</span>
      </button>
    </li>
  ))}
</ul>
```

**300ms debounce** — wrap query prop with `useDebounce(query, 300)` before Fuse.search (RESEARCH §Claude's Discretion).

**Cancelled fetch guard** (lines 40–57) — copy the `cancelled = true` pattern:
```typescript
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, handle, display_name')
      .ilike('handle', `${query}%`)
      .limit(8);
    if (cancelled) return;
    if (error || !data) { setItems([]); return; }
    setItems(data as UserHandle[]);
  })();
  return () => { cancelled = true; };
}, [query]);
```

---

### `src/lib/community/dompurify-config.ts` (utility, transform)

**Analog:** `src/helpdesk/KBArticleView.tsx` line 66

**Fork from helpdesk** — helpdesk uses `USE_PROFILES: { html: true }` (permissive for staff). Community uses explicit allowlist + FORBID_TAGS for img (D-10):
```typescript
// KBArticleView.tsx line 66 (helpdesk baseline — too permissive for UGC):
const sanitized = DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });

// COMMUNITY FORK — explicit allowlist, block img (D-10):
import DOMPurify from 'dompurify';

const COMMUNITY_ALLOWED_TAGS = [
  'h2','h3','h4','p','strong','em','b','i',
  'ul','ol','li','a','code','pre','blockquote','br',
];

export function sanitizeCommunityMarkdown(raw: string): string {
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: COMMUNITY_ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    FORBID_TAGS: ['img','script','iframe','style'],
    FORCE_BODY: false,
  });
}

// Post-sanitize: force target=_blank + rel=noopener; strip non-http(s) hrefs
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ('tagName' in node && (node as Element).tagName === 'A') {
    (node as Element).setAttribute('target', '_blank');
    (node as Element).setAttribute('rel', 'noopener noreferrer');
    const href = (node as Element).getAttribute('href') ?? '';
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      (node as Element).removeAttribute('href');
    }
  }
});
```

---

### `src/components/community/CommunityPost.tsx` (component, request-response)

**Analog:** `src/helpdesk/KBArticleView.tsx`

**ReactMarkdown + DOMPurify render pattern** (lines 98–101):
```tsx
// Sanitize first (community fork), then pass to ReactMarkdown
const sanitized = sanitizeCommunityMarkdown(post.body);

<article className="prose prose-sm max-w-none">
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
    {sanitized}
  </ReactMarkdown>
</article>
```

**Soft-delete tombstone** (D-15):
```tsx
// Before render: replace body if deleted_at is set
const renderBody = post.deleted_at ? '[deleted]' : post.body;
const sanitized = post.deleted_at
  ? '<em>[deleted]</em>'
  : sanitizeCommunityMarkdown(post.body);
```

**edited marker** (D-15):
```tsx
{post.edited_at && (
  <span className="text-xs text-[var(--color-fg-muted)]">(edited)</span>
)}
```

---

### `src/components/community/CommunityPostComposer.tsx` (component, CRUD)

**Analog:** `src/components/admin/cancellation/RuleEditor.tsx`

**Imports pattern** (lines 22–36):
```typescript
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
```

**localStorage draft pattern** (D-11 — 500ms debounce):
```typescript
const DRAFT_KEY = (spaceId: string, userId: string) =>
  `community_draft_${spaceId}_${userId}`;

// Restore on mount:
useEffect(() => {
  const saved = localStorage.getItem(DRAFT_KEY(spaceId, userId));
  if (saved) setBody(saved);
}, [spaceId, userId]);

// Autosave on change (500ms debounce):
useEffect(() => {
  const t = setTimeout(() => {
    localStorage.setItem(DRAFT_KEY(spaceId, userId), body);
  }, 500);
  return () => clearTimeout(t);
}, [body, spaceId, userId]);

// Clear on successful submit:
localStorage.removeItem(DRAFT_KEY(spaceId, userId));
```

**Supabase insert + toast error pattern** (RuleEditor.tsx inline CRUD):
```typescript
const { error } = await supabase.from('community_posts').insert({
  space_id: spaceId,
  author_id: session.user.id,
  body: body.trim(),
});
if (error) {
  showError('Failed to post — please try again.');
  return;
}
```

**5000-char cap client enforcement** (D-11):
```typescript
const isOverLimit = body.length > 5000;
// Disable submit + show character counter warning when isOverLimit
```

---

### `src/lib/community/community-storage.ts` (utility, file-I/O)

**Analog:** `src/lib/page-builder/page-assets.ts`

**Import pattern** (line 20):
```typescript
import { supabase } from '@/lib/supabase';
```

**Result-type + validation pattern** (lines 40–45, 66–106):
```typescript
export const COMMUNITY_MEDIA_BUCKET = 'community-media';
const SIGNED_URL_TTL = 3600;   // 60 min per D-04

const COMMUNITY_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const COMMUNITY_MEDIA_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg', 'image/png', 'image/webp',  // no SVG per security threat table
]);

export type CommunityUploadError = 'file_too_large' | 'invalid_mime' | 'network';
export type CommunityUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: CommunityUploadError };
```

**Signed URL helper** (analog: page-assets `listPageAssets` signed URL approach):
```typescript
export async function getCommunityMediaSignedUrl(
  path: string
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return { error: 'network' };
  return { url: data.signedUrl };
}
```

**Upload with client-side validation** (page-assets pattern lines 66–106):
```typescript
export async function uploadCommunityMedia(
  file: File,
  userId: string,
  postId: string,
): Promise<CommunityUploadResult> {
  if (file.size > COMMUNITY_MEDIA_MAX_BYTES) return { ok: false, error: 'file_too_large' };
  if (!COMMUNITY_MEDIA_MIMES.has(file.type))  return { ok: false, error: 'invalid_mime' };

  const ext = file.type.split('/')[1] ?? 'jpg';
  // Path: {userId}/{postId}/{uuid}.{ext} — leading segment = auth.uid() for RLS
  const path = `${userId}/${postId}/${crypto.randomUUID()}.${ext}`;
  try {
    const { error } = await supabase.storage
      .from(COMMUNITY_MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, error: 'network' };
    return { ok: true, path };
  } catch {
    return { ok: false, error: 'network' };
  }
}
```

---

### `src/lib/community/tier-gate.ts` (utility, request-response)

**Analog:** No close analog — first client-side `tier_effective` read utility in the project.

**Use RESEARCH §Code Examples tier_effective pattern directly:**
```typescript
import { supabase } from '@/lib/supabase';

export type TierLabel = 'free' | 'trial' | 'pro' | 'lifetime';

export async function readTierLabel(userId: string): Promise<TierLabel> {
  const { data } = await supabase
    .from('tier_effective')
    .select('tier_label')
    .eq('user_id', userId)
    .single();
  return (data?.tier_label as TierLabel | null) ?? 'free';
}

export function isVideoAllowed(tier: TierLabel): boolean {
  return tier === 'pro' || tier === 'lifetime' || tier === 'trial';
}

export function canAccessSpace(spaceTier: 'free' | 'pro' | 'lifetime', userTier: TierLabel): boolean {
  if (spaceTier === 'free') return true;
  if (spaceTier === 'pro')  return userTier === 'pro' || userTier === 'lifetime' || userTier === 'trial';
  return userTier === 'lifetime';
}
```

**Note:** The planner should reference `supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql` lines 41–43 for the view column names (`tier_label`, `user_id`, `has_active`).

---

### `leanshot/vite.config.ts` (modify — manualChunks)

**Analog:** itself (lines 193–195 already establish `community-feed`)

**Existing community-feed rule** (line 194):
```typescript
if (id.includes('/src/components/community/')) return 'community-feed';
```

**Add sub-chunk rules BEFORE line 194** (more-specific rules must precede catch-all):
```typescript
// community-media sub-chunk — keeps @mux/mux-player-react (~170 kB gz) out of community-feed
if (id.includes('/src/components/community/media/')) return 'community-media';

// community-mentions sub-chunk — keeps fuse.js (8 kB gz) out of community-feed
if (id.includes('/src/components/community/mentions/')) return 'community-mentions';

// Mux player + uploader → community-media chunk (via node_modules rule)
if (/node_modules\/@mux\/(mux-player-react|mux-uploader-react)(\/|$)/.test(id)) {
  return 'community-media';
}

// community-feed catch-all (already at line 194, keep in place)
if (id.includes('/src/components/community/')) return 'community-feed';
```

**Order matters:** `media/` and `mentions/` rules MUST precede the `community/` catch-all, mirroring the `helpdesk-article` / `helpdesk-macros` / `helpdesk-widget` ordering (lines 171–191).

---

## Shared Patterns

### Service-Role Bearer Auth (Edge Functions)

**Source:** `supabase/functions/notification-send/index.ts` lines 65–76
**Apply to:** `mux-create-upload/index.ts`, `notify-community/index.ts`

```typescript
function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// In handler:
const bearer = bearerFromReq(req);
const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
if (!bearer || !expected || !constantTimeEqual(bearer, expected)) {
  return jsonError(401, 'service_role_required');
}
```

### Realtime Channel Lifecycle

**Source:** `src/components/clinic/roster/use-roster-realtime.ts` — entire file (51 lines)
**Source (richer):** `src/components/clinic/alerts/use-clinician-alerts-realtime.ts` — entire file (97 lines) for `isSubscribed` variant
**Apply to:** `src/components/community/use-space-realtime.ts`

Key rules:
- `onUpdate`/`onNewAlert` callbacks intentionally excluded from `useEffect` deps
- `void supabase.removeChannel(channel)` in cleanup
- `cancelled = true` guard for async subscribe paths
- CHANNEL_ERROR logged as `console.warn`, not thrown

### DOMPurify + ReactMarkdown Render Stack

**Source:** `src/helpdesk/KBArticleView.tsx` lines 12–16 (imports), 64–101 (render)
**Apply to:** `src/components/community/CommunityPost.tsx`

```typescript
// Imports (KBArticleView.tsx lines 12–16):
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

// Render (lines 97–101):
<article className="prose prose-sm max-w-none">
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
    {sanitized}
  </ReactMarkdown>
</article>
```

Community MUST use `sanitizeCommunityMarkdown()` (from `dompurify-config.ts`) NOT the helpdesk `USE_PROFILES: { html: true }` call.

### Cancelled-Fetch Guard

**Source:** `src/helpdesk/KBArticleView.tsx` lines 43–57, `src/helpdesk/MacroTypeahead.tsx` lines 40–57
**Apply to:** All community components with `useEffect` + async supabase queries

```typescript
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const { data } = await supabase.from('...').select('...');
    if (cancelled) return;
    setState(data ?? []);
  })();
  return () => { cancelled = true; };
}, [dependency]);
```

### Storage Upload + Signed URL

**Source:** `src/lib/page-builder/page-assets.ts` lines 20–106
**Apply to:** `src/lib/community/community-storage.ts`

Key patterns:
- `Result<ok, error>` return type (never throw)
- client-side MIME + size validation BEFORE `supabase.storage.from(...).upload()`
- `createSignedUrl(path, 3600)` for 60-min TTL reads
- `crypto.randomUUID()` for path generation

### Deno.serve Guard (Prevents Top-Level Server Trap)

**Source:** `supabase/functions/notification-send/index.ts` lines 467–470
**Apply to:** `mux-create-upload/index.ts`, `mux-webhook/index.ts`, `notify-community/index.ts`

```typescript
// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handlerFn);
}
```

Per `reference_deno_test_top_level_serve_trap`: bare `Deno.serve()` (not guarded) causes `deno test` to hang with a dangling server promise.

### Org-Scoped RLS via org_members Join

**Source:** `supabase/migrations/20270707000020_helpdesk_rls_policies.sql` lines 25–82 (tickets pattern)
**Apply to:** All community_* migration RLS policies for org-private spaces/posts

```sql
-- No GUC-based predicates — always join org_members directly
exists (
  select 1 from public.org_members
  where org_id = community_spaces.org_id
    and user_id = auth.uid()
)
```

Anti-patterns: no `current_setting()` GUC, no tautological-bypass predicates, explicit per-verb policies.

### CORS + jsonResponse/jsonError Helpers

**Source:** `supabase/functions/notification-send/index.ts` lines 48–63
**Apply to:** `mux-create-upload/index.ts`, `notify-community/index.ts`

Copy verbatim — identical CORS headers and response shape expected by supabase-js client.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/community/tier-gate.ts` | utility | request-response | First client-side `tier_effective` read utility; prior uses are Edge Fn-only. Use RESEARCH §Code Examples pattern directly. |
| `src/lib/community/mention-parse.ts` | utility | transform | No mention-parsing utility exists. Implement `/@([a-z0-9_]{3,30})\b/i` regex + code-block stripping per RESEARCH Pitfall 3. |

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/functions/`, `src/helpdesk/`, `src/components/clinic/`, `src/lib/page-builder/`, `src/lib/`, `src/components/admin/`, `leanshot/vite.config.ts`
**Files scanned:** 28
**Pattern extraction date:** 2026-05-23

**Critical ordering notes for planner:**
1. `*_p44_notification_community.sql` migration MUST land in Wave 0 before `notify-community` Edge Fn is deployed — otherwise the Edge Fn will trigger a Postgres CHECK constraint violation (RESEARCH Pitfall 2).
2. `email-router.ts` union widening + `notification-send/index.ts` VALID_CATEGORIES update MUST be in the same commit as the migration (per `feedback_planner_missed_status_enum_widening`).
3. vite.config.ts sub-chunk rules for `community/media/` and `community/mentions/` MUST be added before `src/components/community/` catch-all (already at line 194), otherwise Mux player/uploader bypasses the sub-chunk split and blows the 20 kB community-feed ceiling.
