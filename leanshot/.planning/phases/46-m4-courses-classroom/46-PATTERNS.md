# Phase 46: M4 Courses / Classroom - Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 32 new/modified files
**Analogs found:** 30 / 32

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_p46_course_schema.sql` | migration | CRUD | `supabase/migrations/20270720000001_p44_community_schema.sql` | exact |
| `supabase/migrations/<ts>_p46_course_rls.sql` | migration | CRUD | `supabase/migrations/20270720000002_p44_community_rls.sql` | exact |
| `supabase/migrations/<ts>_p46_course_secdef_rpcs.sql` | migration | CRUD | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` | role-match |
| `supabase/migrations/<ts>_p46_certificates_bucket.sql` | migration | file-I/O | `supabase/migrations/20270601000007_dsar_exports_storage_bucket.sql` | exact |
| `supabase/migrations/<ts>_p46_course_resources_bucket.sql` | migration | file-I/O | `supabase/migrations/20270720000003_p44_community_media_bucket.sql` | exact |
| `supabase/functions/mux-sign-playback/index.ts` | service | request-response | `supabase/functions/mux-create-upload/index.ts` | exact |
| `supabase/functions/mux-sign-playback/deno.json` | config | — | `supabase/functions/mux-create-upload/deno.json` | exact |
| `supabase/functions/generate-course-certificate/index.ts` | service | file-I/O | `supabase/functions/dsar-export/index.ts` | role-match |
| `supabase/functions/generate-course-certificate/cert-render.ts` | utility | file-I/O | `supabase/functions/dsar-export/pdf-render.ts` | exact |
| `supabase/functions/generate-course-certificate/cert-hmac.ts` | utility | request-response | `supabase/functions/_shared/nps-token.ts` | exact |
| `supabase/functions/generate-course-certificate/deno.json` | config | — | `supabase/functions/dsar-export/deno.json` | exact |
| `supabase/functions/lesson-progress-beacon/index.ts` | service | event-driven | `supabase/functions/mux-create-upload/index.ts` | role-match |
| `supabase/functions/lesson-progress-beacon/deno.json` | config | — | `supabase/functions/mux-create-upload/deno.json` | exact |
| `supabase/functions/mux-create-upload/index.ts` (extend) | service | request-response | self (existing) | exact |
| `supabase/functions/mux-webhook/index.ts` (extend) | service | event-driven | self (existing) | exact |
| `src/components/course/ClassroomTabShell.tsx` | component | request-response | `src/components/community/CommunityTabShell.tsx` | exact |
| `src/components/course/CourseListView.tsx` | component | CRUD | `src/admin/modules/community/CommunityAdminLayout.tsx` (list subpage) | role-match |
| `src/components/course/CourseDetailView.tsx` | component | request-response | `src/components/admin/pages/PageEditorView.tsx` | role-match |
| `src/components/course/LessonPlayerView.tsx` | component | streaming | `src/components/community/media/CommunityVideoPlayer.tsx` | exact |
| `src/components/course/CourseSidebar.tsx` | component | CRUD | `src/components/community/CommunityTabShell.tsx` (sub-view pattern) | role-match |
| `src/components/course/LessonResourceList.tsx` | component | file-I/O | `src/lib/community/community-storage.ts` | role-match |
| `src/components/course/CertVerifyPage.tsx` | component | request-response | no analog — public no-auth route | no-analog |
| `src/admin/modules/courses/CoursesAdminLayout.tsx` | component | CRUD | `src/admin/modules/community/CommunityAdminLayout.tsx` | exact |
| `src/admin/modules/courses/CoursesListAdmin.tsx` | component | CRUD | `src/admin/modules/community/CommunityAdminLayout.tsx` (SpacesListPage) | exact |
| `src/admin/modules/courses/CourseEditAdmin.tsx` | component | CRUD | `src/admin/modules/community/SpaceEditor.tsx` | exact |
| `src/admin/modules/courses/ModuleEditAdmin.tsx` | component | CRUD | `src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` | role-match |
| `src/admin/modules/courses/LessonEditAdmin.tsx` | component | CRUD | `src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` | role-match |
| `src/lib/course/course-types.ts` | utility | — | `src/lib/community/community-types.ts` | role-match |
| `src/lib/course/course-progress.ts` | utility | event-driven | `src/lib/community/community-storage.ts` | role-match |
| `src/lib/course/cert-verify-token.ts` | utility | request-response | `supabase/functions/_shared/nps-token.ts` | exact |
| `src/lib/course/course-storage.ts` | utility | file-I/O | `src/lib/community/community-storage.ts` | exact |
| `src/lib/course/dompurify-config.ts` | utility | transform | `src/lib/community/dompurify-config.ts` | exact (verbatim reuse) |

---

## Pattern Assignments

### `supabase/migrations/<ts>_p46_course_schema.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000001_p44_community_schema.sql`

**Migration structure pattern** (lines 1-23):
```sql
-- Header comment: phase/plan reference + decisions implemented + anti-patterns avoided
begin;

-- Table with idempotent guard + CHECK constraints + comments
create table if not exists public.courses (
  id                        uuid        primary key default gen_random_uuid(),
  title                     text        not null,
  slug                      text        not null unique,
  -- ... columns per D-01
  completion_threshold_pct  integer     not null default 100
                              constraint courses_threshold_chk check (completion_threshold_pct between 1 and 100),
  enforce_completion        boolean     not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.courses is 'P46 D-01: 3-level course hierarchy root.';
```

**FK + index pattern** (lines 60-120 of p44 analog):
```sql
-- FK with ON DELETE CASCADE + partial index
create index if not exists course_modules_course_id_idx
  on public.course_modules (course_id, order_index);
```

**Key constraint:** Use 14-digit numeric migration timestamps (per `reference_supabase_migration_filename_regex`). `lesson_progress` needs `PRIMARY KEY (user_id, lesson_id)` — not a separate sequence column.

---

### `supabase/migrations/<ts>_p46_course_rls.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20270720000002_p44_community_rls.sql`

**RLS enable + policy structure** (lines 19-55):
```sql
begin;

-- Enable RLS on all course tables
alter table public.courses               enable row level security;
alter table public.course_modules        enable row level security;
alter table public.course_lessons        enable row level security;
alter table public.lesson_progress       enable row level security;
alter table public.certificates          enable row level security;

-- SELECT: Pro/Lifetime/Trial gated lessons (except is_free_preview=true)
create policy lesson_select_tier
  on public.course_lessons
  for select to authenticated
  using (
    is_free_preview = true
    or exists (
      select 1 from public.tier_effective te
      where te.user_id = auth.uid()
        and te.tier_label in ('pro', 'lifetime', 'trial')
    )
  );

-- INSERT/UPDATE/DELETE: staff only via public.is_staff()
create policy lesson_progress_select_own
  on public.lesson_progress
  for select to authenticated
  using (user_id = auth.uid());

-- Admin write via is_staff() (mirrors cspace_insert in p44)
create policy courses_insert_staff
  on public.courses
  for insert to authenticated
  with check (public.is_staff());
```

**`public.is_staff()` source** (`supabase/migrations/20261101000006_is_staff_helper.sql` lines 23-37):
```sql
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
  select coalesce(
    (select is_staff from public.profiles where id = auth.uid() limit 1),
    false
  );
$$;
```

---

### `supabase/migrations/<ts>_p46_certificates_bucket.sql` (migration, file-I/O)

**Analog:** `supabase/migrations/20270601000007_dsar_exports_storage_bucket.sql`

**Private bucket + service-role-only write pattern** (lines 1-27):
```sql
-- Private bucket; service-role (Edge Fn) is only writer; authenticated users
-- read own objects only via signed URL
insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do nothing;

-- SELECT: own folder only — (storage.foldername(name))[1] = auth.uid()::text
create policy "certificates_select_own_object"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'certificates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- NO authenticated INSERT/UPDATE/DELETE — only service_role (Edge Fn) writes
```

---

### `supabase/migrations/<ts>_p46_course_resources_bucket.sql` (migration, file-I/O)

**Analog:** `supabase/migrations/20270720000003_p44_community_media_bucket.sql`

**Private bucket + MIME whitelist + idempotent policy pattern** (lines 24-96):
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-resources',
  'course-resources',
  false,
  209715200,  -- 200 MB per resource
  array['application/pdf','video/mp4','application/zip']
)
on conflict (id) do nothing;

-- SELECT: Pro/Lifetime/Trial only (tier check) — do $$ if not exists guard
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_course_resources'
  ) then
    create policy objects_select_course_resources on storage.objects
      for select to authenticated
      using (
        bucket_id = 'course-resources'
        and auth.uid() is not null
        -- Tier check: Pro/Lifetime/Trial only
        and exists (
          select 1 from public.tier_effective te
          where te.user_id = auth.uid()
            and te.tier_label in ('pro','lifetime','trial')
        )
      );
  end if;
end $$;
```

---

### `supabase/functions/mux-sign-playback/index.ts` (service, request-response)

**Analog:** `supabase/functions/mux-create-upload/index.ts`

**Imports + boilerplate** (lines 1-47):
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Mux from 'npm:@mux/mux-node@14';
```

**CORS + response helpers** (lines 36-51 of mux-create-upload — copy verbatim):
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

**Lazy admin singleton + test override** (lines 76-104 of mux-create-upload — copy verbatim):
```typescript
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

let _adminOverride: unknown | null = null;
export function setAdminForTest(client: unknown): void { _adminOverride = client; }
export function resetAdminForTest(): void { _adminOverride = null; _adminInstance = null; }

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;
```

**Mux JWT signing — explicit keyId/keySecret pattern** (RESEARCH Pattern 1, Pitfall 4):
```typescript
// CRITICAL: Pass keyId + keySecret EXPLICITLY to decouple from SDK env-var defaults.
// SDK env-var names (MUX_SIGNING_KEY + MUX_PRIVATE_KEY) differ from our secret names.
// Explicitly passing keyId/keySecret overrides env-var auto-read entirely.
const signingKeyId = Deno.env.get('MUX_SIGNING_KEY_ID') ?? '';
const signingKeyPrivate = Deno.env.get('MUX_SIGNING_KEY_PRIVATE') ?? '';

const playbackToken = await mux.jwt.signPlaybackId(playbackId, {
  type: 'video',
  expiration: '4h',
  keyId: signingKeyId,
  keySecret: signingKeyPrivate,
});

const thumbnailToken = await mux.jwt.signPlaybackId(playbackId, {
  type: 'thumbnail',
  expiration: '4h',
  keyId: signingKeyId,
  keySecret: signingKeyPrivate,
  params: { time: 1 },
});
```

**Auth pattern** (lines 143-155 of mux-create-upload — user JWT):
```typescript
const bearer = bearerFromReq(req);
if (!bearer) return jsonError(401, 'unauthorized');

const { data: userData } = await (admin as SupabaseClient).auth.getUser(bearer);
const user = userData?.user ?? null;
if (!user) return jsonError(401, 'unauthorized');
```

**Tier check** (lines 170-179 of mux-create-upload):
```typescript
const { data: tier } = await admin
  .from('tier_effective')
  .select('tier_label, has_active')
  .eq('user_id', user.id)
  .single();

// D-07: Pro/Lifetime required for paid lessons; is_free_preview bypasses
const hasActive = (tier?.has_active as boolean) ?? false;
```

**Deno.serve guard** (lines 212-215 of mux-create-upload — copy verbatim):
```typescript
// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
```

**deno.json** (copy mux-create-upload/deno.json exactly):
```json
{
  "tasks": { "test": "deno test --no-check ." },
  "imports": {
    "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2",
    "npm:@mux/mux-node@14": "npm:@mux/mux-node@14"
  },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "useTabs": false, "lineWidth": 100 }
}
```

---

### `supabase/functions/generate-course-certificate/cert-render.ts` (utility, file-I/O)

**Analog:** `supabase/functions/dsar-export/pdf-render.ts`

**jsPDF in Deno import pattern** (lines 27-30 of pdf-render.ts — copy verbatim):
```typescript
// deno-lint-ignore-file no-explicit-any
import { jsPDF } from 'https://esm.sh/jspdf@3?target=denonext';
import autoTable from 'https://esm.sh/jspdf-autotable@5?target=denonext';
// NEW for cert: QR code (canvas-free SVG fallback path if PNG fails)
import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext';
```

**Blob output pattern** (lines 196-197 of pdf-render.ts):
```typescript
// jspdf .output('blob') returns a Blob
return doc.output('blob') as Blob;
```

**Landscape format pattern** (RESEARCH Pattern 3):
```typescript
const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] });
```

**autoTable usage pattern** (lines 64-75 of pdf-render.ts):
```typescript
autoTable(doc, {
  head: [head],
  body: body.length > 0 ? body : [['(no rows)']],
  startY: startY + 4,
  styles: { fontSize: 8, cellPadding: 2 },
  headStyles: { fillColor: [33, 53, 71] },
  margin: { left: 14, right: 14 },
});
const finalY = (doc as any).lastAutoTable?.finalY ?? startY + 20;
```

**deno.json** — cert fn needs esm.sh imports; do NOT copy mux deno.json imports as-is. Use a dedicated imports map that avoids `--import-map` flag (per `reference_supabase_functions_deploy_import_map_flag`):
```json
{
  "tasks": { "test": "deno test --no-check ." },
  "imports": {
    "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2"
  },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "useTabs": false, "lineWidth": 100 }
}
```
Note: esm.sh URLs are direct URL imports — they do NOT go into the `imports` map.

---

### `supabase/functions/generate-course-certificate/cert-hmac.ts` (utility, request-response)

**Analog:** `supabase/functions/_shared/nps-token.ts`

**Exact base64url replace-chain** (lines 72-75 of nps-token.ts — copy verbatim):
```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function toBase64Url(bytes: Uint8Array | Buffer): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

**Deno/Node env shim** (lines 57-68 of nps-token.ts — copy verbatim):
```typescript
function readDenoOrProcess(k: string): string | undefined {
  const g = globalThis as any;
  if (g.Deno?.env?.get) return g.Deno.env.get(k);
  if (typeof (globalThis as any).process !== 'undefined') {
    return (globalThis as any).process.env?.[k];
  }
  return undefined;
}
```

**timingSafeEqual pattern** (lines 137-141 of nps-token.ts):
```typescript
if (providedMac.length !== expectedMac.length) return null;
if (!timingSafeEqual(providedMac, expectedMac)) return null;
```

**Cert-specific token payload** (adapt from RESEARCH Pattern 4):
```typescript
// Cert HMAC payload: colon-separated (simpler than b64 JSON — D-14)
const payload = `${certId}:${userId}:${courseId}:${issuedAt}`;
const mac = createHmac('sha256', secret).update(payload).digest();
return toBase64Url(mac);
```

---

### `supabase/functions/lesson-progress-beacon/index.ts` (service, event-driven)

**Analog:** `supabase/functions/mux-create-upload/index.ts` (structure) + RESEARCH Pattern 2 (body parsing)

**CRITICAL body parsing difference** (RESEARCH Pitfall 3 — sendBeacon sends text/plain):
```typescript
// MUST use req.text() then JSON.parse — NOT req.json()
// sendBeacon sends Content-Type: text/plain;charset=UTF-8 when body is a string
const bodyText = await req.text();
let body: { lesson_id: string; last_position_seconds: number; max_position_reached_seconds: number; access_token?: string };
try {
  body = JSON.parse(bodyText) as typeof body;
} catch {
  // sendBeacon cannot read responses — return 200 silently on parse error
  return new Response('ok', { status: 200 });
}
```

**Auth from body (not header)** — sendBeacon cannot set Authorization header:
```typescript
// access_token comes from body (sendBeacon can't set headers)
const token = body?.access_token ?? '';
const { data: userData } = await (admin as SupabaseClient).auth.getUser(token);
if (!userData?.user) return new Response('ok', { status: 200 }); // silent — beacon can't read response
```

**lesson_progress UPSERT** (RESEARCH Pattern 7 — NEVER bare UPDATE):
```typescript
await admin
  .from('lesson_progress')
  .upsert({
    user_id: userData.user.id,
    lesson_id: body.lesson_id,
    last_position_seconds: body.last_position_seconds,
    max_position_reached_seconds: body.max_position_reached_seconds,
    last_seen_at: new Date().toISOString(),
  }, {
    onConflict: 'user_id,lesson_id',
    // GREATEST logic must be in the RPC or done via raw SQL — supabase-js upsert
    // doesn't support GREATEST directly; use a SECDEF RPC for this
  });
```

---

### `supabase/functions/mux-create-upload/index.ts` (extension)

**Analog:** self — extend existing file

**New `kind: 'course-lesson'` branch** (insert after line 165, before existing `post_id` validation):
```typescript
// Parse body — extended for course-lesson kind
let body: { post_id?: string; lesson_id?: string; course_id?: string; kind?: string };
try {
  body = await req.json() as typeof body;
} catch {
  return jsonError(400, 'invalid_json');
}

const kind = body?.kind ?? 'community-post';

if (kind === 'course-lesson') {
  // Admin-only gate: course video upload requires is_staff
  // (D-05: different from community upload which allows Pro/Lifetime/Trial)
  const { data: profile } = await admin
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();
  if (!(profile as { is_staff?: boolean } | null)?.is_staff) {
    return jsonError(403, 'ADMIN_REQUIRED');
  }

  const lessonId = body?.lesson_id;
  const courseId = body?.course_id;
  if (typeof lessonId !== 'string' || typeof courseId !== 'string') {
    return jsonError(400, 'invalid_lesson_id');
  }

  const mux = getMux();
  const upload = await mux.video.uploads.create({
    cors_origin: req.headers.get('origin') ?? '*',
    new_asset_settings: {
      playback_policies: ['signed'], // CRITICAL: NOT 'public' for course lessons (Pitfall 2)
      max_duration_seconds: 1800,   // D-05: 30 min cap
      passthrough: JSON.stringify({
        kind: 'course-lesson',
        lesson_id: lessonId,
        course_id: courseId,
      }),
      generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }], // D-06
    },
    timeout: 3600,
  });
  return jsonResponse(200, { url: upload.url, upload_id: upload.id });
}

// ... existing community-post branch continues unchanged
```

---

### `supabase/functions/mux-webhook/index.ts` (extension)

**Analog:** self — extend existing file

**Passthrough kind dispatch** (insert after line 155, replacing the single `postId` extraction):
```typescript
// Parse passthrough — now carries 'kind' discriminator
let passthrough: {
  user_id?: string;
  post_id?: string;
  kind?: string;
  lesson_id?: string;
  course_id?: string;
} | null = null;
try {
  passthrough = event.data?.passthrough ? JSON.parse(event.data.passthrough) : null;
} catch { passthrough = null; }

const kind = passthrough?.kind ?? 'community-post';

if (kind === 'course-lesson') {
  const lessonId = passthrough?.lesson_id ?? null;
  if (!lessonId) {
    console.warn('[mux-webhook] course-lesson missing lesson_id', { event_type: event.type });
    return new Response('ok', { status: 200 });
  }

  if (event.type === 'video.asset.ready') {
    const playbackId = event.data.playback_ids?.[0]?.id ?? null;
    await (admin as SupabaseClient)
      .from('course_lessons')
      .update({ mux_asset_id: event.data.id, mux_playback_id: playbackId, mux_status: 'ready' })
      .eq('id', lessonId);
  } else if (event.type === 'video.asset.errored') {
    await (admin as SupabaseClient)
      .from('course_lessons')
      .update({ mux_status: 'rejected' })
      .eq('id', lessonId);
  } else if (event.type === 'video.upload.asset_created') {
    await (admin as SupabaseClient)
      .from('course_lessons')
      .update({ mux_asset_id: event.data.id, mux_status: 'processing' })
      .eq('id', lessonId);
  }
  // NOTE: NO video.view handler — this event does NOT exist in Mux webhooks (RESEARCH Pitfall 1)
  return new Response('ok', { status: 200 });
}

// ... existing community-post branch (rename `postId` handling to only run here)
const postId = passthrough?.post_id ?? null;
// ... rest unchanged
```

---

### `src/components/course/ClassroomTabShell.tsx` (component, request-response)

**Analog:** `src/components/community/CommunityTabShell.tsx`

**Full shell pattern** (lines 1-72 of CommunityTabShell.tsx — mirror structure):
```typescript
/**
 * Phase 46 — ClassroomTabShell.
 * Consumer-surface tab shell for Classroom section.
 * Mirrors CommunityTabShell.tsx — Zustand-driven sub-view navigation.
 * Path MUST be src/components/course/ (singular) for 'course-player' chunk.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { readTierLabel } from '@/lib/community/tier-gate';
import { useStore } from '@/lib/store';

// Lazy sub-components — keep in course/ for chunk routing
const CourseListView = lazy(() =>
  import('./CourseListView').then((m) => ({ default: m.CourseListView })),
);
const LessonPlayerView = lazy(() =>
  import('./LessonPlayerView').then((m) => ({ default: m.LessonPlayerView })),
);

export default function ClassroomTabShell() {
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? '');
  // activeCourseId / activeLessonId: new store fields (pattern: activeCommunitySpaceId)
  const activeCourseId = useStore((s) => s.activeCourseId);
  const activeLessonId = useStore((s) => s.activeLessonId);
  const [currentTier, setCurrentTier] = useState<TierLabel>('free');

  useEffect(() => {
    if (!currentUserId) return;
    void readTierLabel(currentUserId).then(setCurrentTier);
  }, [currentUserId]);

  const fallback = (
    <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="Loading classroom">
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      {activeLessonId && activeCourseId ? (
        <LessonPlayerView lessonId={activeLessonId} courseId={activeCourseId} currentTier={currentTier} />
      ) : (
        <CourseListView currentTier={currentTier} currentUserId={currentUserId} />
      )}
    </Suspense>
  );
}
```

**Store additions needed** (mirror `activeCommunitySpaceId` pattern in `src/lib/store.ts` lines 82, 118, 585, 653):
```typescript
// In AppState interface (after activeCommunitySpaceId):
activeCourseId: string | null;
activeLessonId: string | null;

// In Actions interface:
setActiveCourse: (courseId: string | null, lessonId?: string | null) => void;

// In initial state:
activeCourseId: null,
activeLessonId: null,

// In actions:
setActiveCourse: (courseId, lessonId = null) => set({ activeCourseId: courseId, activeLessonId: lessonId }),
```

**TabId extension** (`src/types/index.ts` lines 234-244 — add `'classroom'`):
```typescript
export type TabId =
  | 'home' | 'medication' | 'symptoms' | 'body' | 'nutrition'
  | 'activity' | 'supplements' | 'mood' | 'insights'
  | 'community'
  | 'classroom'; // Phase 46 NEW TabId
```

**App.tsx lazy import** (mirror line 108, 1901 pattern):
```typescript
// Line ~108 in App.tsx:
const ClassroomTabShell = lazy(() => import('@/components/course/ClassroomTabShell'));
// Line ~1901 in App.tsx:
{currentTab === 'classroom' && <ClassroomTabShell />}
```

---

### `src/components/course/LessonPlayerView.tsx` (component, streaming)

**Analog:** `src/components/community/media/CommunityVideoPlayer.tsx`

**Mux Player lazy import** (lines 13 of CommunityVideoPlayer.tsx — copy exactly):
```typescript
// CRITICAL: MUST use /lazy entry point — defers ~170 kB gz player bytes
import MuxPlayer from '@mux/mux-player-react/lazy';
```

**Signed token fetch** (RESEARCH Pattern 1 + anti-skip tracking Pattern 2):
```typescript
// Fetch signed tokens from mux-sign-playback Edge Fn on mount
useEffect(() => {
  if (!lessonId) return;
  void supabase.functions.invoke('mux-sign-playback', {
    body: { lesson_id: lessonId },
  }).then(({ data }) => {
    if (data) setTokens(data as { playback: string; thumbnail: string });
  });
}, [lessonId]);

// Anti-skip: track max position client-side (NEVER via server webhook — Pitfall 1)
const SYNC_DEBOUNCE_MS = 15_000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function handleTimeUpdate(event: Event) {
  const player = event.target as HTMLVideoElement;
  const currentTime = player.currentTime;
  maxPositionReached.current = Math.max(maxPositionReached.current, currentTime);

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncProgress({ last_position_seconds: Math.round(currentTime),
      max_position_reached_seconds: Math.round(maxPositionReached.current) });
  }, SYNC_DEBOUNCE_MS);
}
```

**MuxPlayer with tokens** (RESEARCH Pattern 1):
```typescript
<MuxPlayer
  playbackId={playbackId}
  tokens={{ playback: tokens.playback, thumbnail: tokens.thumbnail }}
  streamType="on-demand"
  startTime={lastPosition}
  onTimeUpdate={handleTimeUpdate}
  className="w-full"
/>
```

**Tab-close sendBeacon** (RESEARCH Pattern 2):
```typescript
// In useEffect cleanup / beforeunload listener:
navigator.sendBeacon(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lesson-progress-beacon`,
  JSON.stringify({
    lesson_id: lessonId,
    last_position_seconds: Math.round(lastKnownPosition.current),
    max_position_reached_seconds: Math.round(maxPositionReached.current),
    access_token: session?.access_token,
  }),
);
```

---

### `src/admin/modules/courses/CoursesAdminLayout.tsx` (component, CRUD)

**Analog:** `src/admin/modules/community/CommunityAdminLayout.tsx`

**Pathname-based routing pattern** (lines 119-196 of CommunityAdminLayout.tsx):
```typescript
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; courseId: string }
  | { type: 'modules'; courseId: string }
  | { type: 'lesson-edit'; courseId: string; lessonId: string };

function resolveView(pathname: string): View {
  // Match /admin/courses/<courseId>/modules, /admin/courses/new, etc.
  const m = pathname.match(/^\/admin\/courses\/?([^/]+)?(?:\/([^/]+))?(?:\/([^/]+))?/);
  // ... segment dispatch
}

export default function CoursesAdminLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };
  // ...
}
```

**ADMIN_MODULES manifest entry** (pattern from `src/lib/admin/modules.ts` lines 84-152 — add at end):
```typescript
// In src/lib/admin/modules.ts ADMIN_MODULES array:
{
  key: 'courses',
  label: 'Courses',
  route: 'courses',
  icon: BookOpenCheckIcon, // already imported in modules.ts
  lazy: () => import('@/admin/modules/courses/CoursesAdminLayout'),
  flagKey: 'admin.courses.enabled',
  minRole: 'admin' as AdminRole,
},
```

Note: `BookOpenCheckIcon` is already imported in `src/lib/admin/modules.ts` line 35. No new import needed.

---

### `src/admin/modules/courses/ModuleEditAdmin.tsx` + `LessonEditAdmin.tsx` (component, CRUD)

**Analog:** `src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` + `src/components/ui/SortableTreePanel.tsx`

**dnd-kit reorder pattern** (lines 20-37 of SortableTreePanel.tsx):
```typescript
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
```

**SortableTreePanel reuse** (preferred over re-implementing dnd-kit directly):
```typescript
// Use the existing <SortableTreePanel<T>> generic component
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';

// In ModuleEditAdmin — render lessons within a module:
<SortableTreePanel
  items={lessons}
  getId={(lesson) => lesson.id}
  onReorder={handleLessonsReorder}
  renderItem={(lesson, _i, isDragging) => <LessonRow lesson={lesson} isDragging={isDragging} />}
  announceItemLabel={(lesson) => lesson.title}
/>
```

**UPSERT order_index on drop** — call SECDEF `update_lesson_position` RPC:
```typescript
async function handleLessonsReorder(next: LessonRow[]) {
  setLessons(next); // optimistic
  for (let i = 0; i < next.length; i++) {
    await supabase.rpc('update_lesson_order', { p_lesson_id: next[i]!.id, p_order_index: i });
  }
}
```

---

### `src/lib/course/cert-verify-token.ts` (utility, request-response)

**Analog:** `supabase/functions/_shared/nps-token.ts`

**Browser-side HMAC via Web Crypto** (different from Deno `node:crypto`):
```typescript
// Browser uses Web Crypto API — NOT node:crypto
async function hmacSha256(key: string, message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

Note: The Edge Fn side uses `node:crypto` from `nps-token.ts`. The browser cert-verify page uses Web Crypto — same replace-chain, different API.

---

### `src/lib/course/course-storage.ts` (utility, file-I/O)

**Analog:** `src/lib/community/community-storage.ts` — mirror exactly, swap bucket/MIME constants:

```typescript
// Mirrors community-storage.ts lines 22-128
import { supabase } from '@/lib/supabase';

export const COURSE_RESOURCES_BUCKET = 'course-resources' as const;
export const COURSE_RESOURCES_MIMES: ReadonlySet<string> = new Set([
  'application/pdf', 'video/mp4', 'application/zip',
]);
export const COURSE_RESOURCES_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

// Same Result pattern as community-storage.ts
export type CourseResourceUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: 'file_too_large' | 'invalid_mime' | 'network' };

// Path: ${courseId}/${lessonId}/${uuid}.${ext}
// Signed URL TTL: 3600 (60 min, matching D-13 cert pattern)
```

---

### `src/lib/community/tier-gate.ts` (extension — add isResourceAllowed)

**Analog:** self — extend existing file

**Add after existing `canAccessSpace` function** (lines 66-79 of tier-gate.ts):
```typescript
// D-06: Pro-gated resource download
export type ResourceType = 'pdf' | 'video' | 'zip';

export function isResourceAllowed(tier: TierLabel, _resourceType: ResourceType): boolean {
  // All downloadable lesson resources require Pro/Lifetime/Trial
  return tier === 'pro' || tier === 'lifetime' || tier === 'trial';
}
```

---

## Shared Patterns

### Dual Auth (service-role bearer OR user JWT)
**Source:** `supabase/functions/notify-community/index.ts` lines 55-66
**Apply to:** `mux-sign-playback`, `generate-course-certificate` (service-role-only)
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

### Deno Admin Singleton + Test Override Hooks
**Source:** `supabase/functions/mux-create-upload/index.ts` lines 76-104
**Apply to:** ALL new Edge Functions
```typescript
// Copy verbatim — lazy admin singleton + Proxy + setAdminForTest/resetAdminForTest
```

### Deno.serve Top-Level Guard
**Source:** `supabase/functions/mux-create-upload/index.ts` lines 212-215
**Apply to:** ALL new Edge Functions (per `reference_deno_test_top_level_serve_trap`)
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
```

### Storage Signed URL (60-min TTL)
**Source:** `src/lib/community/community-storage.ts` lines 121-128
**Apply to:** `course-storage.ts`, cert download URL generation
```typescript
const { data, error } = await supabase.storage
  .from(BUCKET)
  .createSignedUrl(path, 3600); // 60 min TTL
if (error || !data) return { error: 'network' };
return { url: data.signedUrl };
```

### Admin Module Manifest + Catch-All Router
**Source:** `src/lib/admin/modules.ts` lines 44-58; `src/components/admin/AdminShell.tsx`
**Apply to:** `CoursesAdminLayout.tsx` — manifest entry MUST be added in same plan as component
Per `feedback_admin_module_manifest_vs_router_branch_drift`: new admin module MUST add manifest entry AND the AdminShell already handles prefix-routes via `pathname.startsWith('/admin/courses/')` — no additional switch case needed beyond manifest registration.

### UPSERT vs bare UPDATE
**Source:** RESEARCH Pattern 7 (per `reference_state_counter_table_needs_upsert_on_event`)
**Apply to:** ALL `lesson_progress` writes — never bare UPDATE
```sql
INSERT INTO lesson_progress (...) ON CONFLICT (user_id, lesson_id) DO UPDATE SET
  last_position_seconds = EXCLUDED.last_position_seconds,
  max_position_reached_seconds = GREATEST(
    lesson_progress.max_position_reached_seconds,
    EXCLUDED.max_position_reached_seconds
  ),
  last_seen_at = now();
```

### Per-Function deno.json (no --import-map flag)
**Source:** `supabase/functions/mux-create-upload/deno.json`
**Apply to:** ALL new Edge Functions (per `reference_supabase_functions_deploy_import_map_flag` — CLI v2.101.0 ignores `--import-map`)
Each function gets its own `deno.json` with `"imports"` map. esm.sh direct URLs are NOT in the imports map — they are used as-is in source.

### Tailwind + CSS token pattern
**Source:** `src/components/admin/gamification/AdminGamificationModule.tsx` lines 56-108
**Apply to:** All new React components — use `var(--color-*)` tokens, never hardcoded hex:
```typescript
className="text-[var(--color-text-secondary)]"
className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
className="border-[var(--color-border)]"
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/course/CertVerifyPage.tsx` | component | request-response | No existing public no-auth page in this codebase (all routes are behind auth). Pattern: render from URL param + HMAC verify client-side + `<meta name="robots" content="noindex">`. Closest structural reference is RESEARCH D-14 description. |

---

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `src/components/community/`, `src/components/admin/`, `src/admin/modules/`, `src/lib/community/`, `src/lib/admin/`, `src/components/ui/SortableTreePanel.tsx`, `src/types/index.ts`, `src/App.tsx`, `src/lib/store.ts`
**Files scanned:** ~40
**Pattern extraction date:** 2026-05-23

---

## PATTERN MAPPING COMPLETE

**Phase:** 46 - M4 Courses / Classroom
**Files classified:** 32
**Analogs found:** 30 / 32

### Coverage
- Files with exact analog: 18
- Files with role-match analog: 12
- Files with no analog: 1 (CertVerifyPage.tsx)
- Files that are self-extensions: 2 (mux-create-upload, mux-webhook)

### Key Patterns Identified

1. **All new Edge Functions copy the `mux-create-upload` boilerplate verbatim** — CORS headers, `jsonResponse`/`jsonError`, lazy admin singleton, Proxy, test override hooks (`setAdminForTest`/`resetAdminForTest`), and the `import.meta.main` Deno.serve guard.
2. **cert-render.ts mirrors dsar-export/pdf-render.ts exactly** — same `https://esm.sh/jspdf@3?target=denonext` import, same `doc.output('blob')` return, same `autoTable` call signature.
3. **cert-hmac.ts copies nps-token.ts base64url replace-chain verbatim** — `b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')` is the project-standard HMAC base64url encoding.
4. **Admin module layout follows CommunityAdminLayout.tsx pathname pattern** — `useState(window.location.pathname)` + `popstate` listener + `window.history.pushState` navigate helper + `resolveView()` dispatch.
5. **ClassroomTabShell mirrors CommunityTabShell exactly** — store slice for `activeCourseId`/`activeLessonId` added to store.ts following the `activeCommunitySpaceId` pattern.
6. **SortableTreePanel generic component reused directly** — `src/components/ui/SortableTreePanel.tsx` is the dnd-kit abstraction; module/lesson reorder calls it with a generic item type.
7. **lesson-progress-beacon MUST use `req.text()` NOT `req.json()`** — sendBeacon sends `text/plain` content-type; this is the critical deviation from all other Edge Fns.
8. **mux-create-upload course-lesson branch sets `playback_policies: ['signed']`** — NOT `['public']`; this is the single most important difference from the community-post upload path.

### Plan ID → Primary Analog Mapping

| Plan (expected) | Primary Analog |
|-----------------|----------------|
| Schema migration | `20270720000001_p44_community_schema.sql` |
| RLS migration | `20270720000002_p44_community_rls.sql` |
| Storage buckets migration | `20270720000003_p44_community_media_bucket.sql` + `20270601000007_dsar_exports_storage_bucket.sql` |
| `mux-sign-playback` Fn | `supabase/functions/mux-create-upload/index.ts` |
| `generate-course-certificate` Fn | `supabase/functions/dsar-export/pdf-render.ts` + `_shared/nps-token.ts` |
| `lesson-progress-beacon` Fn | `supabase/functions/mux-create-upload/index.ts` (structure) + RESEARCH Pitfall 3 (body) |
| Mux Edge Fn extensions | self (mux-create-upload + mux-webhook) |
| `ClassroomTabShell.tsx` | `src/components/community/CommunityTabShell.tsx` |
| `LessonPlayerView.tsx` | `src/components/community/media/CommunityVideoPlayer.tsx` |
| `CoursesAdminLayout.tsx` + CRUD pages | `src/admin/modules/community/CommunityAdminLayout.tsx` |
| `ModuleEditAdmin.tsx` / `LessonEditAdmin.tsx` | `src/components/ui/SortableTreePanel.tsx` + `OnboardingBuilderModule.tsx` |
| `course-storage.ts` | `src/lib/community/community-storage.ts` |
| `cert-verify-token.ts` (browser) | `supabase/functions/_shared/nps-token.ts` (Deno analog) |
| `tier-gate.ts` extension | self (`src/lib/community/tier-gate.ts`) |

### File Created
`/Users/karstenhaldan/minisite/leanshot/.planning/phases/46-m4-courses-classroom/46-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference analog patterns and excerpts in PLAN.md files.
