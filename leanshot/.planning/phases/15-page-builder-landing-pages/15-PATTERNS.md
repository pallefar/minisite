# Phase 15: Page Builder + Landing Pages - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 28 new/modified files
**Analogs found:** 26 / 28

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `supabase/functions/page-render/index.ts` | Edge Function (renderer) | request-response, streaming HTML | `supabase/functions/share/index.ts` | role-match (public, no JWT) |
| `supabase/functions/page-render/deno.json` | config | — | `supabase/functions/stripe-checkout/deno.json` | exact |
| `supabase/functions/lead-capture/index.ts` | Edge Function (form POST) | request-response, CRUD | `supabase/functions/clinic-invite/index.ts` | role-match (public POST, rate-limit, spam guard) |
| `supabase/functions/lead-capture/deno.json` | config | — | `supabase/functions/stripe-checkout/deno.json` | exact |
| `supabase/functions/page-save/index.ts` | Edge Function (write) | CRUD | `supabase/functions/stripe-checkout/index.ts` | role-match (JWT-authed POST) |
| `supabase/functions/page-save/deno.json` | config | — | `supabase/functions/stripe-checkout/deno.json` | exact |
| `supabase/functions/page-publish/index.ts` | Edge Function (write + Vercel revalidation) | request-response | `supabase/functions/stripe-checkout/index.ts` | role-match (JWT-authed POST) |
| `supabase/functions/page-publish/deno.json` | config | — | `supabase/functions/stripe-checkout/deno.json` | exact |
| `supabase/functions/sitemap/index.ts` | Edge Function (public read) | request-response | `supabase/functions/share/index.ts` | role-match (public, no JWT, Cache-Control) |
| `supabase/functions/sitemap/deno.json` | config | — | `supabase/functions/stripe-checkout/deno.json` | exact |
| `supabase/migrations/YYYYMMDD_page_builder_tables.sql` | migration | CRUD | `supabase/migrations/20260601000019_stripe_subscriptions.sql` | exact (table + partial index + RLS) |
| `supabase/migrations/YYYYMMDD_page_builder_rls.sql` | migration | CRUD | `supabase/migrations/20260514000010_storage_bucket.sql` + `20260801000003_org_logos_storage.sql` | exact (Storage bucket + RLS policies) |
| `src/lib/page-builder/block-schema.ts` | utility, type definitions | transform | `src/types/index.ts` | role-match (domain type barrel) |
| `src/lib/page-builder/templates.ts` | utility, data | transform | `src/lib/constants.ts` | role-match (static lookup data) |
| `src/lib/page-builder/json-ld.ts` | utility, pure function | transform | `src/lib/insights.ts` | role-match (pure function, data in → structured data out) |
| `src/components/admin/pages/PageListView.tsx` | component | request-response | `src/components/clinic/ClinicWorkspace.tsx` (roster pattern) | role-match |
| `src/components/admin/pages/PageEditorView.tsx` | component (editor root) | event-driven | `src/components/clinic/ClinicWorkspace.tsx` | role-match (layout shell + lazy sub-panels) |
| `src/components/admin/pages/editor/BlockTreePanel.tsx` | component (dnd-kit) | event-driven | no analog — dnd-kit not yet used | no-analog |
| `src/components/admin/pages/editor/PropertyPanel.tsx` | component | event-driven | `src/components/dashboard/settings/SettingsPage.tsx` | role-match (field groups + DS Input/Select/Textarea) |
| `src/components/admin/pages/editor/PreviewPane.tsx` | component (iframe) | request-response | `src/components/dashboard/share/SharePage.tsx` (iframe embed pattern) | partial-match |
| `src/components/admin/pages/editor/VersionHistory.tsx` | component (Sheet panel) | CRUD | `src/components/ui/Sheet.tsx` (shell) + existing list patterns | role-match |
| `src/components/admin/pages/blocks/*.tsx` (12 block components) | component | render | `src/components/ui/Card.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Input.tsx` | role-match (DS primitives as building material) |
| `src/components/admin/pages/TemplatePicker.tsx` | component (Modal) | event-driven | `src/components/ui/Modal.tsx` + `Card` clickable variant | exact shell |
| `src/components/admin/pages/AssetLibraryPicker.tsx` | component (Modal + grid) | file-I/O, CRUD | `src/components/ui/Modal.tsx` + Storage upload pattern | role-match |
| `src/App.tsx` (modified) | router | event-driven | `src/App.tsx` itself (admin route branch + lazy chunk) | self-analog |
| `leanshot/vite.config.ts` (modified) | config | — | `leanshot/vite.config.ts` itself (manualChunks extension) | self-analog |
| `leanshot/scripts/assert-clinic-bundle-budget.sh` (modified) | config/CI | — | `scripts/assert-clinic-bundle-budget.sh` itself | self-analog |
| `leanshot/tests/csp/csp-snapshot.txt` (modified) | config/test | — | `tests/csp/csp-snapshot.txt` itself | self-analog |

---

## Pattern Assignments

### `supabase/functions/page-render/index.ts` (Edge Function, public, no JWT)

**Analog:** `supabase/functions/share/index.ts`

**Imports pattern** (share/index.ts lines 35–38):
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
// (no external SDK needed for page-render — only supabase-js for DB read)
// Full esm.sh URLs required for any runtime-value imports; bare specifiers break deploy bundler.
```

**Public / no-JWT entry point pattern** (share/index.ts lines 356–384):
```typescript
Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: { ...BASE_RESPONSE_HEADERS, ...cors } });
  }
  const headers = { ...BASE_RESPONSE_HEADERS, ...cors };
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith('/render') && req.method === 'GET') {
      return await handleRender(req, headers);
    }
    return jsonError(404, 'not-found', headers);
  } catch (err) {
    console.error('[page-render] handler error', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'internal', headers);
  }
});
```

**Service-role admin client pattern** (share/index.ts lines 46–51):
```typescript
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Cache-Control pattern for `page-render` (from RESEARCH.md — no existing analog):**
```typescript
// Response with ISR-compatible headers. x-prerender-revalidate bypass token
// from env is sent by page-publish to force immediate CDN flush.
const BYPASS_TOKEN = Deno.env.get('VERCEL_BYPASS_TOKEN') ?? '';
return new Response(htmlString, {
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400',
    'x-prerender-revalidate-if-generated': BYPASS_TOKEN,
  },
});
```

**Error response helper pattern** (share/index.ts lines 79–94):
```typescript
function jsonError(status: number, code: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers });
}
```

**`verify_jwt = false` config:** Add `[functions.page-render]` and `[functions.lead-capture]` and `[functions.sitemap]` blocks to `supabase/config.toml` mirroring (config.toml lines 400–401):
```toml
[functions.page-render]
verify_jwt = false
```

---

### `supabase/functions/page-render/deno.json` (config)

**Analog:** `supabase/functions/stripe-checkout/deno.json` (lines 1–14):
```json
{
  "tasks": {
    "test": "deno test --allow-all --import-map=../import_map.json"
  },
  "lint": {
    "rules": { "tags": ["recommended"] }
  },
  "fmt": {
    "useTabs": false,
    "lineWidth": 100
  }
}
```
Copy verbatim for every new function's `deno.json`.

---

### `supabase/functions/lead-capture/index.ts` (Edge Function, public form POST + spam guard)

**Analog:** `supabase/functions/clinic-invite/index.ts`

**Public POST body parsing + validation pattern** (clinic-invite/index.ts lines 216–244):
```typescript
async function handleSend(req: Request): Promise<Response> {
  // 1. Parse + validate body
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email) return jsonError(400, 'missing_fields');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(400, 'invalid_email');
  }
  // ...
}
```

**Rate-limit pattern** (clinic-invite/index.ts lines 346–348 — in-memory bucket keyed on IP):
```typescript
const rlKey = `${clientIpFromReq(req)}:${token.slice(0, 8)}`;
if (!checkLookupRateLimit(rlKey)) {
  return jsonError(429, 'rate_limited');
}
```

**IP extraction helper** (clinic-invite/index.ts lines 151–160):
```typescript
function clientIpFromReq(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
```

**Honeypot check for lead-capture (no existing analog — add inline before DB insert):**
```typescript
// Honeypot: if the hidden `_hp` field is non-empty, silently succeed
// (bots fill it; real users never see it). Return 200 OK so bots
// see no difference between a filled and unfilled honeypot.
if ((body._hp ?? '') !== '') {
  return jsonResponse(200, { ok: true });
}
```

**CORS headers pattern** (clinic-invite/index.ts lines 117–122):
```typescript
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

**Dispatcher pattern** (clinic-invite/index.ts lines 549–586):
```typescript
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // ...
  try {
    if (action === 'submit') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSubmit(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[lead-capture] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});
```

**Internal exports for Deno tests** (clinic-invite/index.ts lines 591–598):
```typescript
export const __internal = {
  handleSubmit,
};
```

---

### `supabase/functions/page-save/index.ts` + `page-publish/index.ts` (JWT-authed, is_staff gate)

**Analog:** `supabase/functions/stripe-checkout/index.ts`

**JWT auth + user resolution pattern** (stripe-checkout/index.ts lines 290–297):
```typescript
export async function handleSession(req: Request): Promise<Response> {
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');
  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user;
  // ...
}
```

**JWT extraction helper** (stripe-checkout/index.ts lines 160–164):
```typescript
function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}
```

**is_staff gate (no existing analog — add after JWT resolution):**
```typescript
// D-11: thin is_staff boolean gate. profiles.is_staff column added in Phase 15 migration.
// Service-role admin client bypasses RLS to read the gate value.
const { data: profile } = await adminInstance
  .from('profiles')
  .select('is_staff')
  .eq('id', user.id)
  .maybeSingle();
if (!profile?.is_staff) return jsonError(403, 'forbidden');
```

**Lazy singleton admin client** (stripe-checkout/index.ts lines 118–143):
```typescript
let _adminInstance: any = null;
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  get(_target: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});
export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}
```

**Error response helper** (stripe-checkout/index.ts lines 149–158):
```typescript
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

---

### Migration: `supabase/migrations/YYYYMMDD_page_builder_tables.sql`

**Analog:** `supabase/migrations/20260601000019_stripe_subscriptions.sql`

**Table + partial index + RLS enable pattern** (stripe_subscriptions.sql lines 30–98):
```sql
create table public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null default '',
  published_revision_id uuid,  -- FK added after landing_page_revisions table
  is_published boolean not null default false,
  seo jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.landing_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.landing_pages(id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Pitfall 1: partial-index predicates MUST be IMMUTABLE (column IS NOT NULL — safe).
create index idx_landing_page_revisions_page
  on public.landing_page_revisions(page_id, created_at desc)
  where page_id is not null;

-- RLS enable (always, per project rule)
alter table public.landing_pages enable row level security;
alter table public.landing_page_revisions enable row level security;
```

**RLS policy pattern for is_staff gate:**
```sql
-- is_staff = true in profiles → full CRUD access to landing_pages.
create policy "staff_all_landing_pages" on public.landing_pages
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_staff = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_staff = true
    )
  );
```

**SECURITY DEFINER function search_path pattern** (stripe_subscriptions.sql lines 166–172):
```sql
create or replace function public.some_fn(...)
returns ...
language plpgsql
security definer
set search_path = public, extensions   -- Pitfall 2: required for pgcrypto/digest()
stable
as $$ ... $$;
```

---

### Migration: Storage bucket `page-assets`

**Analog:** `supabase/migrations/20260514000010_storage_bucket.sql` + `20260801000003_org_logos_storage.sql`

**Bucket creation pattern** (20260514000010_storage_bucket.sql lines 8–19):
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'page-assets',
  'page-assets',
  false,                    -- not public; URLs accessed via signed URL or RLS
  10485760,                 -- 10 MB cap (D-13 upload limit)
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;
```

**Storage RLS policies with folder isolation** (20260514000010_storage_bucket.sql lines 23–58):
```sql
-- SELECT: is_staff users can list all assets (asset library D-13);
-- public can read by public URL (page-render serves images from CDN URL).
create policy "page_assets_select_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'page-assets'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_staff = true
    )
  );

-- INSERT: is_staff only
create policy "page_assets_insert_staff"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'page-assets'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_staff = true
    )
  );
```

**Idempotent policy creation with DO $$ block** (20260801000003_org_logos_storage.sql lines 41–52):
```sql
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'page_assets_select_staff'
  ) then
    create policy page_assets_select_staff on storage.objects
      for select to authenticated
      using (bucket_id = 'page-assets' and /* is_staff check */ true);
  end if;
end $$;
```

---

### `src/App.tsx` (modified — admin route branch + lazy chunks)

**Self-analog.** Copy the Phase 9 clinic lazy-loading pattern (App.tsx lines 76–97):

**Lazy chunk declaration pattern** (App.tsx lines 76–84):
```typescript
// Phase 15 — Admin page builder lazy chunks (admin-bundle).
// admin-bundle is staff-only; public visitors never download it.
// vite.config.ts manualChunks routes src/components/admin/** → 'admin-bundle'.
const AdminPageList = lazy(() =>
  import('@/components/admin/pages/PageListView').then((m) => ({ default: m.PageListView })),
);
const AdminPageEditor = lazy(() =>
  import('@/components/admin/pages/PageEditorView').then((m) => ({ default: m.PageEditorView })),
);
```

**selectView route branch pattern** (App.tsx lines 247–270):
```typescript
// Phase 15 — /admin/* routes: is_staff-gated path-based routes.
// Must be ordered BEFORE any generic catch-all (most-specific first).
if (opts.pathname.startsWith('/admin/pages/')) {
  return opts.user ? 'admin-page-editor' : 'auth';
}
if (opts.pathname === '/admin/pages') {
  return opts.user ? 'admin-page-list' : 'auth';
}
if (opts.pathname === '/admin') {
  return opts.user ? 'admin-settings' : 'auth';
}
```

**Suspense boundary rendering pattern** (App.tsx lines 572 onwards):
```typescript
<Suspense fallback={<FullPageLoader />}>
  {view === 'admin-page-list' && <AdminPageList />}
  {view === 'admin-page-editor' && <AdminPageEditor />}
</Suspense>
```

---

### `leanshot/vite.config.ts` (modified — manualChunks extension)

**Self-analog.** Add two new chunk rules following the Phase 8/9 patterns (vite.config.ts lines 81–103):

```typescript
// Phase 15 — admin-bundle: all admin page-builder components.
// Must be declared BEFORE the generic 'admin' catch-all if one exists.
if (id.includes('src/components/admin/')) return 'admin-bundle';

// Phase 15 — page-builder-runtime: the renderer + block-schema types.
// This chunk is loaded on published landing pages (/{slug}); ceiling: 25 kB gz.
// Enforced by scripts/assert-clinic-bundle-budget.sh PAGE_BUILDER_RUNTIME_CEILING.
if (id.includes('src/lib/page-builder/')) return 'page-builder-runtime';

// Phase 15 — dnd-kit vendor chunk: keeps the 400 kB dnd-kit out of the
// admin-bundle ceiling measurement; both chunks are lazy (staff-only).
if (/node_modules\/(@dnd-kit\/)(core|sortable|utilities)(\/|$)/.test(id)) {
  return 'vendor-dnd-kit';
}
```

---

### `scripts/assert-clinic-bundle-budget.sh` (modified — PAGE_BUILDER_RUNTIME_CEILING)

**Self-analog.** Add after existing ceiling declarations (scripts/assert-clinic-bundle-budget.sh lines 48–65 style):

```bash
# Phase 15 — page-builder-runtime chunk ceiling (D-03, UI-SPEC Performance Contract).
# The renderer imports block-schema + json-ld helpers but NOT dnd-kit (editor-only).
PAGE_BUILDER_RUNTIME_CEILING=25000   # 25 kB gz

# Phase 15 — admin-bundle chunk ceiling. dnd-kit is in its own vendor-dnd-kit
# chunk; admin-bundle itself should be ≤60 kB gz (12 blocks + editor panels).
ADMIN_BUNDLE_CEILING=60000           # 60 kB gz
```

**Skip-when-missing pattern** (same script, wave-0 logic):
```bash
PAGE_BUILDER_FILE=$(find "$ASSETS_DIR" -name 'page-builder-runtime-*.js.gz' 2>/dev/null | head -1)
if [ -z "$PAGE_BUILDER_FILE" ]; then
  echo "wave-0 skip: page-builder-runtime chunk not found (pre-Phase-15)"
else
  PAGE_BUILDER_SIZE=$(wc -c < "$PAGE_BUILDER_FILE")
  if [ "$PAGE_BUILDER_SIZE" -gt "$PAGE_BUILDER_RUNTIME_CEILING" ]; then
    echo "::error::page-builder-runtime ${PAGE_BUILDER_SIZE}B > ${PAGE_BUILDER_RUNTIME_CEILING}B ceiling"
    FAIL=1
  fi
fi
```

---

### `tests/csp/csp-snapshot.txt` (modified — frame-src widening)

**Self-analog.** The CSP snapshot test (tests/csp/csp-snapshot.test.ts lines 42–66) reads this file line-by-line, sorts directives, and diffs against `vercel.json`. When the planner adds D-01's embed providers to `vercel.json` `frame-src`, this file must be updated in the same commit.

**frame-src directive to add** (per D-01 — Calendly, YouTube-nocookie, Tally):
```
frame-src 'self' https://calendly.com https://www.youtube-nocookie.com https://tally.so;
```

The full update sequence (per csp-snapshot.test.ts lines 13–19):
1. Edit `vercel.json` — add the three embed origins to `frame-src`
2. Run the test → it FAILS with directive-level diff
3. Update `tests/csp/csp-snapshot.txt` to match the new sorted value
4. Re-run → PASS
5. Commit BOTH files in the same commit (plan-checker BLOCKER if split)

---

### `src/lib/page-builder/block-schema.ts` (utility, type definitions)

**Analog:** `src/types/index.ts` (domain type barrel pattern)

**Import pattern** (src/types/index.ts style — no external deps, pure TS types):
```typescript
// No external imports. Pure type-only module (no runtime value imports).
// Imported by both editor (admin-bundle) and renderer (page-builder-runtime).
// Keep this file side-effect-free so tree-shaking works on both chunks.

export type BlockType =
  | 'hero' | 'cta' | 'faq' | 'pricing' | 'testimonial'
  | 'feature-grid' | 'image-text' | 'footer'
  | 'calendly' | 'youtube' | 'tally' | 'lead-form';

export interface BlockStyle {
  backgroundTone?: 'default' | 'subtle' | 'brand' | 'dark';
  alignment?: 'left' | 'center' | 'right';
  spacingDensity?: 'compact' | 'default' | 'spacious';
  hideOnMobile?: boolean;
}

export interface BlockNode {
  id: string;
  type: BlockType;
  parent_id: string | null;
  order: number;
  content: Record<string, unknown>;  // type-narrowed per BlockType at consumer
  style: BlockStyle;
}

// D-10 reserved slugs — enforced at save time by page-save Edge Function
export const RESERVED_SLUGS = [
  'clinic', 'admin', 'share', 'api', 'auth', 'assets',
  'sitemap.xml', 'robots.txt',
] as const;
```

---

### `src/lib/page-builder/json-ld.ts` (utility, pure function)

**Analog:** `src/lib/insights.ts` (pure function pattern — data in, structured data out)

**Pure function pattern** (insights.ts style):
```typescript
// No side effects. No DOM. No store access. Pure data transform.
// Input: page data from landing_page_revisions JSONB + site_settings row.
// Output: JSON-LD string for injection into <script type="application/ld+json">.

import type { BlockNode } from './block-schema';

export type SchemaType = 'WebPage' | 'FAQPage' | 'Product' | 'Article' | 'Event';

export function generateJsonLd(opts: {
  blocks: BlockNode[];
  title: string;
  description: string;
  url: string;
  schemaType: SchemaType;
}): string {
  // Auto-generate from blocks; returns a JSON string (not an object)
  // so the renderer can inject it directly into a <script> tag.
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': opts.schemaType,
    name: opts.title,
    description: opts.description,
    url: opts.url,
  };
  // FAQ-specific: extract Q&A pairs from 'faq' blocks
  if (opts.schemaType === 'FAQPage') {
    const faqBlocks = opts.blocks.filter((b) => b.type === 'faq');
    if (faqBlocks.length > 0) {
      ld['mainEntity'] = faqBlocks.flatMap((b) =>
        ((b.content.items ?? []) as Array<{q: string; a: string}>).map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        }))
      );
    }
  }
  return JSON.stringify(ld);
}
```

---

### `src/components/admin/pages/PageEditorView.tsx` (component, editor root)

**Analog:** `src/App.tsx` (layout composition + Suspense) + `src/components/ui/Card.tsx`

**3-panel layout pattern** (from CLAUDE.md architecture + Card.flat variant):
```typescript
import { lazy, Suspense, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import type { BlockNode } from '@/lib/page-builder/block-schema';

// D-04: tree + live preview pane. Left rail = block tree, center = live
// preview (real page-render output), right rail = property editor.
// All three panels are within the lazy admin-bundle chunk.

export function PageEditorView({ pageId }: { pageId: string }) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [blocks, setBlocks] = useState<BlockNode[]>([]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Left rail — BlockTreePanel */}
      <Card variant="flat" padding="none" className="w-72 shrink-0 overflow-y-auto border-r border-[var(--color-border)]">
        <BlockTreePanel blocks={blocks} selectedId={selectedBlockId} onSelect={setSelectedBlockId} onChange={setBlocks} />
      </Card>

      {/* Center — PreviewPane */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <PreviewPane pageId={pageId} />
      </div>

      {/* Right rail — PropertyPanel */}
      <Card variant="flat" padding="none" className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)]">
        <PropertyPanel selectedBlockId={selectedBlockId} blocks={blocks} onChange={setBlocks} />
      </Card>
    </div>
  );
}
```

---

### `src/components/admin/pages/editor/BlockTreePanel.tsx` (dnd-kit, no analog)

**No existing analog** — dnd-kit is not used anywhere in the codebase. Use RESEARCH.md Pattern 1 (flat-array + `useSortable`) as the primary reference.

**dnd-kit sortable list pattern** (from RESEARCH.md + dnd-kit docs):
```typescript
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';

export function BlockTreePanel({ blocks, selectedId, onSelect, onChange }: BlockTreePanelProps) {
  const reducedMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    // Reorder blocks: update `order` values then call onChange
    onChange(reorderBlocks(blocks, active.id as string, over.id as string));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {blocks.filter((b) => b.parent_id === null).map((block) => (
          <BlockTreeItem
            key={block.id}
            block={block}
            isSelected={selectedId === block.id}
            onSelect={onSelect}
          />
        ))}
      </SortableContext>
      <DragOverlay>
        {activeId && !reducedMotion ? (
          <BlockTreeItemClone block={blocks.find((b) => b.id === activeId)!} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BlockTreeItem({ block, isSelected, onSelect }: BlockTreeItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-2 py-3 min-h-[48px] cursor-pointer select-none rounded-xl',
        isDragging ? 'opacity-50' : '',
        isSelected ? 'bg-[var(--color-primary-soft)] ring-2 ring-[var(--color-primary)]' : 'hover:bg-[var(--color-surface-elevated)]',
      )}
      onClick={() => onSelect(block.id)}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="w-10 h-full flex items-center justify-center text-[var(--color-text-tertiary)] cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="text-[13px] font-medium truncate">{block.type}</span>
    </div>
  );
}
```

---

### `src/components/admin/pages/TemplatePicker.tsx` (Modal + Card grid)

**Analog:** `src/components/ui/Modal.tsx` + `src/components/ui/Card.tsx` clickable variant

**Modal shell pattern** (Modal.tsx lines 44–122):
```typescript
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function TemplatePicker({ open, onClose, onSelect }: TemplatePickerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a template"
      size="lg"
      // role="dialog" + aria-modal="true" + aria-label applied by Modal.tsx automatically
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {TEMPLATES.map((tpl) => (
          <Card
            key={tpl.id}
            variant="clickable"
            padding="sm"
            className="cursor-pointer"
            onClick={() => onSelect(tpl)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(tpl)}
          >
            <img src={tpl.thumbnail} alt="" className="w-full aspect-video object-cover rounded-xl mb-2" />
            <p className="text-[16px] font-semibold">{tpl.name}</p>
            <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">{tpl.description}</p>
          </Card>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Start blank</Button>
      </div>
    </Modal>
  );
}
```

---

### `src/components/admin/pages/editor/VersionHistory.tsx` (Sheet panel)

**Analog:** `src/components/ui/Sheet.tsx`

**Sheet pattern** (Sheet.tsx lines 19–82):
```typescript
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';

export function VersionHistoryPanel({ open, onClose, revisions, onRestore }: VersionHistoryPanelProps) {
  const [confirmRevision, setConfirmRevision] = useState<string | null>(null);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Version history"
        // aria-label="Version history" + role="dialog" + aria-modal applied by Sheet.tsx
      >
        {revisions.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No saved versions yet. Changes are saved automatically.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {revisions.map((rev) => (
              <li key={rev.id} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--color-border)]">
                <div>
                  <p className="text-[13px] font-semibold font-mono">{formatTimestamp(rev.created_at)}</p>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{rev.created_by_email}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setConfirmRevision(rev.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* Confirmation modal before restore — per UI-SPEC Interaction Contract */}
      <Modal open={!!confirmRevision} onClose={() => setConfirmRevision(null)}
        title="Restore this version?"
        size="sm"
      >
        <p className="text-[14px] text-[var(--color-text-secondary)] mb-4">
          The page will revert to this revision. Any unpublished changes will be preserved in history.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setConfirmRevision(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => { onRestore(confirmRevision!); setConfirmRevision(null); }}>
            Restore
          </Button>
        </div>
      </Modal>
    </>
  );
}
```

---

### Block Components: `src/components/admin/pages/blocks/*.tsx` (12 block types)

**Analog:** `src/components/ui/Card.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Input.tsx`

**Token-bounded style pattern** (D-05 — all block components follow this shell):
```typescript
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/helpers';
import type { BlockNode } from '@/lib/page-builder/block-schema';

// Example: HeroBlock.tsx — the largest block (brand tone, Fraunces heading, CTA button)
export function HeroBlock({ block }: { block: BlockNode }) {
  const { content, style } = block;

  // backgroundTone → CSS custom property token (D-05, UI-SPEC Color section)
  const bgClass = {
    default: 'bg-[var(--color-bg)]',
    subtle: 'bg-[var(--color-surface-elevated)]',
    brand: 'bg-[var(--color-hero-bg)]',
    dark: 'bg-[var(--color-teal-950)]',
  }[style.backgroundTone ?? 'brand'];

  // spacingDensity → inline padding (96px is outside token set — inline style)
  const paddingY = { compact: '48px', default: '64px', spacious: '96px' }[style.spacingDensity ?? 'default'];

  return (
    <section
      className={cn('w-full', bgClass, style.hideOnMobile && 'hidden md:block')}
      style={{ paddingTop: paddingY, paddingBottom: paddingY }}
    >
      {/* Heading: Fraunces, 32px→56px responsive, white on brand bg */}
      <h1 className="text-3xl md:text-5xl font-[400] italic text-[var(--color-text-on-hero)] font-display">
        {(content.heading as string) ?? ''}
      </h1>
      {/* Primary CTA: Button inverse variant */}
      <Button variant="inverse" className="mt-6">
        {(content.ctaLabel as string) ?? 'Get started'}
      </Button>
    </section>
  );
}
```

**Field inputs in PropertyPanel (from Input.tsx lines 94–125):**
```typescript
import { Input, Select, Textarea } from '@/components/ui/Input';

// Content field: text input
<Input
  label="Heading"
  value={block.content.heading as string ?? ''}
  onChange={(e) => onContentChange('heading', e.target.value)}
/>

// Style field: background tone segmented selector (Pill component)
<Select
  label="Background"
  value={block.style.backgroundTone ?? 'default'}
  onChange={(e) => onStyleChange('backgroundTone', e.target.value)}
>
  <option value="default">Default (cream)</option>
  <option value="subtle">Subtle</option>
  <option value="brand">Brand (teal)</option>
  <option value="dark">Dark</option>
</Select>
```

---

### `src/components/admin/pages/editor/PreviewPane.tsx` (iframe embed)

**Analog:** `src/components/ui/Card.tsx` (elevated variant as wrapper) + `src/components/ui/Skeleton.tsx`

**Viewport toggle + iframe pattern** (from UI-SPEC Interaction Contracts):
```typescript
import { useState } from 'react';
import { Monitor, Tablet, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const VIEWPORT_WIDTHS = { desktop: '100%', tablet: '768px', mobile: '375px' } as const;
type Viewport = keyof typeof VIEWPORT_WIDTHS;

export function PreviewPane({ pageSlug }: { pageSlug: string }) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [loaded, setLoaded] = useState(false);

  return (
    <Card variant="elevated" padding="none" className="flex flex-col h-full">
      {/* Viewport toggle toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-[var(--color-border)]">
        {(['desktop', 'tablet', 'mobile'] as Viewport[]).map((vp) => (
          <Button
            key={vp}
            variant={viewport === vp ? 'tonal' : 'ghost'}
            size="sm"
            aria-label={vp}
            aria-pressed={viewport === vp}
            onClick={() => { setLoaded(false); setViewport(vp); }}
          >
            {vp === 'desktop' ? <Monitor className="size-5" aria-hidden /> :
             vp === 'tablet' ? <Tablet className="size-5" aria-hidden /> :
             <Smartphone className="size-5" aria-hidden />}
          </Button>
        ))}
      </div>

      {/* iframe — pointer-events: none so preview is read-only */}
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-[var(--color-bg)]">
        <div className="relative" style={{ width: VIEWPORT_WIDTHS[viewport] }}>
          {!loaded && <Skeleton className="absolute inset-0 rounded-xl" />}
          <iframe
            title="Page preview"
            src={`/${pageSlug}?preview=true`}
            className="w-full h-full border-0 rounded-xl"
            style={{ pointerEvents: 'none', minHeight: '600px' }}
            onLoad={() => setLoaded(true)}
          />
          {/* Tooltip overlay to communicate read-only state */}
        </div>
      </div>
    </Card>
  );
}
```

---

## Shared Patterns

### Authentication / Authorization Gate

**Source:** `supabase/functions/stripe-checkout/index.ts` (JWT) + new `profiles.is_staff` gate

**Apply to:** All page-mutating Edge Functions (`page-save`, `page-publish`)

```typescript
// Step 1: JWT → user
const jwt = jwtFromReq(req);
if (!jwt) return jsonError(401, 'unauthenticated');
const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
const user = userData.user;

// Step 2: is_staff gate (D-11)
const { data: profile } = await adminInstance
  .from('profiles')
  .select('is_staff')
  .eq('id', user.id)
  .maybeSingle();
if (!profile?.is_staff) return jsonError(403, 'forbidden');
```

---

### Error Response Helpers

**Source:** `supabase/functions/stripe-checkout/index.ts` lines 149–158

**Apply to:** All new Edge Functions

```typescript
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

---

### CORS Headers (Edge Functions)

**Source:** `supabase/functions/clinic-invite/index.ts` line 54 (`import { corsHeaders }`)

**Apply to:** All new Edge Functions

Each function's `cors.ts` file follows the same pattern as existing functions. For fully-public functions (`page-render`, `sitemap`, `lead-capture`) use `*` Origin; for `page-save` and `page-publish` use the same allowlist pattern as `stripe-checkout`.

---

### RLS Cross-Tenant Proof Tests

**Source:** Project rule (MEMORY.md — every RLS surface gets a live cross-tenant impersonation proof test)

**Apply to:** All new tables (`landing_pages`, `landing_page_revisions`, `leads`, `site_settings`) and `page-assets` bucket

Each new migration that adds RLS policies must be paired with an e2e or integration test that:
1. Creates a non-staff user session
2. Attempts to read/write/delete records owned by the staff user
3. Asserts the operation is denied (`.error.code === 'PGRST301'` or similar)

---

### DS Primitive Imports (React components)

**Source:** `src/components/ui/*.tsx`

**Apply to:** All new React components in `src/components/admin/**`

```typescript
// Standard import set for admin-bundle components:
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Sheet } from '@/components/ui/Sheet';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/helpers';
// Icons — named imports from lucide-react (vendor-icons chunk)
import { GripVertical, ChevronDown, Check, Phone, Tablet, Monitor } from 'lucide-react';
// Reduced motion (CLAUDE.md Accessibility Conventions)
import { useReducedMotion } from '@/hooks/useReducedMotion';
```

---

### Accessibility Conventions

**Source:** `CLAUDE.md` Accessibility Conventions section + `src/components/ui/Modal.tsx` + `src/components/ui/Button.tsx`

**Apply to:** All new components, especially dnd-kit drag handles, ViewportToggle, VersionHistoryPanel, TemplatePicker, AssetLibraryPicker

```typescript
// Icon-only buttons MUST have aria-label
<Button aria-label="Close" variant="ghost" size="sm">
  <X className="size-5" aria-hidden />
</Button>

// Modal/Sheet always gets role="dialog" + aria-modal (Modal.tsx does this automatically)
// Lead form live region:
<div role="alert" aria-live="polite">{errorMessage}</div>
// Save status live region:
<div role="status" aria-live="polite">{saveStatus}</div>

// aria-pressed on toggle buttons (Pill.tsx does this automatically via `active` prop)
<Button aria-pressed={viewport === 'desktop'} ...>...</Button>

// Iframe title required (CSP block + a11y):
<iframe title="Page preview" .../>
<iframe title="Calendly booking" .../>
```

---

### Token-Bounded Color / Styling

**Source:** `src/components/ui/Card.tsx` lines 24–41 + `src/index.css` `@theme {}` block

**Apply to:** All 12 block components and all admin editor chrome components

```typescript
// ALWAYS use CSS custom properties — never raw hex in component code.
// Correct:
'text-[var(--color-text)]'
'bg-[var(--color-hero-bg)]'
'text-[var(--color-text-on-hero)]'
// Wrong:
'text-[#1b4842]'
'bg-[#f2ede0]'
```

---

### Deno.serve Entry Point

**Source:** `supabase/functions/stripe-checkout/index.ts` lines 490–517

**Apply to:** All new Edge Functions

```typescript
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const fnIdx = segments.indexOf('function-name');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');
  try {
    if (action === 'submit' && req.method === 'POST') return await handleSubmit(req);
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[function-name] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/admin/pages/editor/BlockTreePanel.tsx` | component | event-driven | dnd-kit (`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`) has no prior usage in the codebase. Use RESEARCH.md Pattern 1 (flat array + `useSortable` + `closestCenter`) as the primary reference. |
| `supabase/functions/page-render/render.ts` | utility (Deno) | transform | A Deno-side recursive HTML string builder (`renderBlock()` function) has no codebase analog. The renderer produces static HTML without React — it is a pure string-concatenation function. Structure it as a switch on `block.type`, each branch returning an HTML string. The 96px spacious padding must use inline `style` attribute (outside the token set per UI-SPEC). |

---

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `src/components/`, `src/lib/`, `src/hooks/`, `leanshot/vite.config.ts`, `leanshot/scripts/`, `leanshot/tests/`
**Files scanned:** 18 files read in full; 8 files scanned via Grep/Bash
**Pattern extraction date:** 2026-05-14
