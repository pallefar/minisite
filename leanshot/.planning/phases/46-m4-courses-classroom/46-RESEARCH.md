# Phase 46: M4 Courses / Classroom - Research

**Researched:** 2026-05-23
**Domain:** Mux signed playback JWT + jsPDF cert generation (Deno) + course 3-level hierarchy + anti-skip completion + PageBuilder landing pages
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 3-level hierarchy: `courses`, `course_modules`, `course_lessons`. Lesson carries `mux_asset_id`, `mux_playback_id`, `duration_seconds`, `is_free_preview boolean default false`, `is_required boolean default true`, `order_index`.
- **D-02:** Free-preview default = first lesson of each course (computed, not stored). Admin can set `is_free_preview=true` manually via SQL.
- **D-03:** Admin reordering = dnd-kit drag/drop. Reuse Phase 31 primitives. NEVER introduce a new drag lib.
- **D-04:** All lessons required for completion (v1). No per-lesson optional flag in UI.
- **D-05:** 30 min / 2 GB max per lesson video. Enforced client-side (`maxDuration: 1800`) + server-side via mux-webhook. Same `mux-create-upload` + `mux-webhook` Edge Fns with new `kind: 'course-lesson'` discriminator.
- **D-06:** Mux auto-captions default-ON for English (`generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }]`). Admin per-lesson opt-out via `captions_enabled boolean default true`.
- **D-07:** Signed JWT playback URLs. `aud='v'`, `sub=<playback_id>`, `exp=now+4h`. New `mux-sign-playback` Edge Fn checks tier entitlement + free-preview gating.
- **D-08:** Thumbnail via `image.mux.com/${playback_id}/thumbnail.jpg?time=1` — signed thumbnail token uses same `mux-sign-playback` Fn with `type='thumbnail'`.
- **D-09:** Per-lesson binary completion + `last_position_seconds` for resume. Table `lesson_progress (user_id, lesson_id, course_id, completed_at, last_position_seconds, last_seen_at, max_position_reached_seconds, PRIMARY KEY (user_id, lesson_id))`.
- **D-10:** Sync cadence = 15s debounced via `onTimeUpdate`. Tab-close via `navigator.sendBeacon`.
- **D-11:** Course completion = 100% required lessons (admin override via `courses.completion_threshold_pct`).
- **D-12:** Anti-skip = ≥95% playback. `max_position_reached_seconds` tracked CLIENT-SIDE via `onTimeUpdate`, written to `lesson_progress` on each sync. Server `complete_lesson` Edge Fn double-checks threshold. Admin toggle `courses.enforce_completion boolean default true`.
- **D-13:** Cert generation server-side via `generate-course-certificate` Edge Fn. Cached in `certificates` Storage bucket. 60-min signed download URL.
- **D-14:** `/verify/<cert_id>` public SPA route. HMAC token: `base64url(HMAC-SHA256(cert_id + user_id + course_id + issued_at, CERT_VERIFICATION_SECRET))`. Same replace-chain as Phase 43 pattern.
- **D-15:** Single fixed jsPDF template, landscape 11×8.5", brand-themed. QR code embedded. No per-course customization.
- **D-16:** Landing pages single-template in v1. Phase 39 PAGEAB-06 retrofits per-block variants later. `page_variant_id` column NOT a per-row concern in Phase 46 — `BlockNode` has no such field; Phase 46 creates landing_pages rows with standard block_tree JSONB.

### Claude's Discretion

- `isResourceAllowed(tier, resource)` implementation — reuse Phase 44 tier-gate.ts pattern.
- Mux signing key env var names: `MUX_SIGNING_KEY` (key ID) + `MUX_PRIVATE_KEY` (base64 PEM private key). New Wave 0 secret-set step.
- QR code library: `qrcode` npm (v1.5.4) — NOT in package.json yet. Server-side only in Edge Fn cert PDF. No client bundle impact.
- Course list page `/courses`: fixed index (simpler, faster). Individual `/courses/<slug>` landing pages use PageBuilder.
- `CERT_VERIFICATION_SECRET`: new Supabase Function Secret. Generate via `openssl rand -hex 32`.

### Deferred Ideas (OUT OF SCOPE)

Phase 39 PAGEAB-06 per-block variants, Spanish captions, Mux DRM, cohort/drip courses, leaderboards, admin cert template editor, custom thumbnails, lesson chapters, group enrollments, course drafts/scheduling, course completion email.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COURSE-01 | courses + modules + lessons schema; admin creates course → adds modules → adds lessons (video + text + downloadable files) | Schema in §Standard Stack; admin module follows `src/components/admin/modules/` + ADMIN_MODULES manifest pattern |
| COURSE-02 | Mux video integration (admin uploads MP4 → Mux transcodes → Mux Player adaptive HLS); per-lesson `mux_asset_id` | `mux-create-upload` + `mux-webhook` extension with `kind: 'course-lesson'`; `MuxPlayer` from `@mux/mux-player-react/lazy` |
| COURSE-03 | lesson_progress tracking + per-user completion %; resume-where-left-off across devices | `lesson_progress` table; 15s debounced `onTimeUpdate` sync; `sendBeacon` tab-close; `SELECT last_position_seconds` on mount |
| COURSE-04 | Completion certificates generated server-side as PDFs (jsPDF already in v1.2 stack); cert includes name + title + date + verification URL | `generate-course-certificate` Deno Edge Fn; jsPDF via `esm.sh/jspdf@3?target=denonext` (proven by dsar-export fn); HMAC token + `qrcode` package |
| COURSE-05 | Course landing pages reuse PageBuilder + A/B (PAGEAB-06 per-block variants deferred per D-16); 3 admin templates | `landing_pages` table + `landing_page_revisions.blocks` JSONB; Phase 15 BlockNode schema; no `page_variant_id` per-row concern in Phase 46 |
| COURSE-06 | Lesson resources (downloadable files via Storage signed URLs); per-resource entitlement check (Pro-only resources gated) | New `course-resources` Storage bucket; `isResourceAllowed()` added to `src/lib/community/tier-gate.ts`; `tier_effective.has_active` boolean |
</phase_requirements>

---

## Summary

Phase 46 delivers a self-paced course platform on top of existing Phase 44 Mux infrastructure. The core data model is a 3-level hierarchy (`courses → course_modules → course_lessons`) with signed JWT video playback, per-lesson binary progress tracking with an anti-skip gate, and server-side PDF certificate generation.

**The most important pre-planning discoveries:**

1. `video.view` is NOT a Mux webhook event type. Mux webhooks cover only asset/upload/live-stream lifecycle events. Anti-skip tracking (`max_position_reached_seconds`) must be entirely client-side, written to `lesson_progress` on each debounced `onTimeUpdate` sync — not via a server webhook. The `complete_lesson` Edge Fn enforces the ≥95% threshold by reading `max_position_reached_seconds` from the DB at call time.

2. jsPDF works in Deno Edge Fns via `esm.sh/jspdf@3?target=denonext`. This is proven by the existing `supabase/functions/dsar-export/pdf-render.ts`. Phase 46 can use an identical import pattern. **No Vercel API route needed.** IMPORTANT: the Deno esm.sh version pins to jspdf@3, while the browser client uses `jspdf@^4.2.1` — these are different. The cert fn uses the Deno path.

3. `mux-create-upload` currently sets `playback_policies: ['public']`. Course lessons need `['signed']`. The extension adds a `kind` discriminator branch that sets signed policy and the 30-min `max_duration_seconds: 1800`.

4. Neither `qrcode` nor `qrcode.react` is in package.json. The `qrcode` npm package (v1.5.4) generates QR codes server-side in Node/Deno; for the cert Edge Fn, import via `esm.sh/qrcode?target=denonext`. No client-bundle impact.

5. Mux JWT signing env vars are `MUX_SIGNING_KEY` (key ID) + `MUX_PRIVATE_KEY` (base64-encoded PEM private key), NOT `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_KEY_PRIVATE` as described in CONTEXT. The SDK reads these two env vars automatically when the client is constructed.

6. The `BlockNode` schema in Phase 15 has NO `page_variant_id` field — blocks are JSONB stored in `landing_page_revisions.blocks` as a flat array. Phase 39 PAGEAB-06 retrofitting does not affect the `landing_pages` / `landing_page_revisions` schema — it adds per-block variant tracking via a new mechanism. Phase 46 creates standard `landing_pages` rows; no special forward-compat schema work needed.

**Primary recommendation:** Implement anti-skip tracking as pure client-side `max_position_reached_seconds` tracking in the `lesson_progress` UPSERT, with server-side enforcement at `complete_lesson` call time. Add a `mux-sign-playback` Edge Fn using `@mux/mux-node` v14 `mux.jwt.signPlaybackId()`. Generate cert PDFs via Deno esm.sh jsPDF, exactly mirroring `dsar-export/pdf-render.ts`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Course/module/lesson schema + RLS | Database | — | Data owns hierarchy; RLS prevents cross-user reads |
| Signed playback JWT generation | API / Edge Fn (`mux-sign-playback`) | — | Private key must stay server-side |
| Mux upload (admin) | API / Edge Fn (`mux-create-upload` extension) | Browser (uploader component) | Tier check + Mux API key must be server-side |
| Lesson progress sync | Browser (debounced onTimeUpdate) | Database (UPSERT lesson_progress) | Client writes max-reached position; server validates on completion |
| Course completion check + cert trigger | API / Edge Fn (`complete_lesson`) | — | Business logic + HMAC signing must be server-side |
| Certificate PDF generation | API / Edge Fn (`generate-course-certificate`) | Database / Storage | jsPDF runs in Deno; PDF stored in Storage |
| Certificate HMAC verification | Browser + Database | — | Public `/verify/<cert_id>` SPA reads DB, validates HMAC client-side |
| dnd-kit module/lesson reorder | Browser (admin) | Database (order_index update) | Drag is browser-only; DB write on drop |
| Tier-gated resource download | API / Edge Fn | Database (tier_effective view) | Signed URL generation requires service-role |
| Landing page template | API / Edge Fn (`page-save`, `page-render`) | Browser (admin editor) | Existing PageBuilder infrastructure |
| Course list consumer UI | Browser | — | TabId `'classroom'` in SPA tab switcher |

---

## Standard Stack

### Core (all VERIFIED in codebase or npm registry)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mux/mux-player-react` | `^3.13.0` | Lesson video playback | Already in package.json (Phase 44) |
| `@mux/mux-uploader-react` | `^1.5.0` | Admin lesson video upload | Already in package.json (Phase 44) |
| `@mux/mux-node` | `14` (npm:14) | Signed JWT playback + webhook verify | Already in Edge Fn deno.json (Phase 44) |
| `jspdf` | `^4.2.1` (browser) / `@3.0.4` via esm.sh (Deno) | Cert PDF generation | In package.json; proven Deno path in dsar-export fn |
| `jspdf-autotable` | `^5.0.7` (browser) / `@5.0.7` via esm.sh (Deno) | Table layout in PDF | In package.json; proven Deno path |
| `@dnd-kit/core` | `6.3.1` | Module/lesson drag reorder | In package.json (Phase 15/31) |
| `@dnd-kit/sortable` | `10.0.0` | Sortable list wrapper | In package.json |
| `@supabase/supabase-js` | `^2` | DB, Storage, Auth | Project standard |

### Supporting (VERIFIED needed; not yet in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `qrcode` | `1.5.4` | QR code generation (server-side, Deno cert Fn) | Embed verification URL QR in cert PDF; use via `esm.sh/qrcode@1.5.4?target=denonext`; NO browser bundle impact |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `qrcode` (server Deno) | `qrcode.react` | `qrcode.react` is browser-only; cert gen is Deno Edge Fn |
| jsPDF in Deno via esm.sh | Vercel API route | esm.sh proven by dsar-export; no extra infra needed |
| Client-side `onTimeUpdate` for anti-skip | Mux `video.view` webhook | `video.view` webhook does NOT exist in Mux's webhook system |

**Installation (new additions only):**
```bash
# NO new browser deps needed — all cert/QR work is server-side Deno (esm.sh imports)
# No new npm install required
```

**Version verification:** [VERIFIED: npm registry]
- `@mux/mux-player-react@3.13.0` — in package.json [VERIFIED: codebase]
- `jspdf@4.2.1` — in package.json [VERIFIED: codebase]
- `qrcode@1.5.4` — npm registry latest [VERIFIED: npm view]

---

## Architecture Patterns

### System Architecture Diagram

```
Admin Browser
  │
  ├── Admin Course Editor (/admin/courses)
  │   ├── dnd-kit reorder → UPSERT order_index → DB (course_modules, course_lessons)
  │   └── LessonVideoUploader → mux-create-upload (kind:'course-lesson') → Mux Direct Upload
  │
  │              Mux Transcodes
  │                   ↓
  │           mux-webhook (video.asset.ready / video.asset.errored)
  │               → UPDATE course_lessons SET mux_asset_id, mux_playback_id, mux_status
  │
Consumer Browser
  │
  ├── ClassroomTab (TabId: 'classroom')
  │   └── Course list → Course landing page (/courses/<slug>)
  │       └── Lesson player (LessonPlayer.tsx)
  │           ├── Mount: supabase.functions.invoke('mux-sign-playback', {lesson_id})
  │           │          → check tier_effective + free_preview → mux.jwt.signPlaybackId()
  │           │          → return { playback_token, thumbnail_token }
  │           ├── SELECT lesson_progress.last_position_seconds → startTime prop
  │           ├── onTimeUpdate (15s debounce):
  │           │   → UPSERT lesson_progress (last_position_seconds, max_position_reached_seconds)
  │           ├── Tab-close: navigator.sendBeacon → lesson-progress-beacon Edge Fn
  │           └── "Mark Complete" CTA (enabled when max_position_reached_seconds >= 0.95 * duration)
  │               → supabase.functions.invoke('complete_lesson', {lesson_id, course_id})
  │                  → server re-checks max_position_reached_seconds / duration_seconds >= 0.95
  │                  → INSERT lesson_progress SET completed_at
  │                  → if course 100% complete → invoke generate-course-certificate
  │
generate-course-certificate
  ├── jsPDF (esm.sh/jspdf@3) + jspdf-autotable + qrcode (esm.sh)
  ├── Render landscape 11×8.5" PDF with name + course + date + QR code
  ├── HMAC token: base64url(HMAC-SHA256(cert_id+user_id+course_id+issued_at, CERT_VERIFICATION_SECRET))
  ├── Upload to certificates/{user_id}/{course_id}-{cert_id}.pdf
  └── Return signed 60-min download URL

Public Browser → /verify/<cert_id>?token=<hmac>
  └── Read certificates row → validate HMAC → render proof card
```

### Recommended Project Structure

```
src/
├── components/course/                    # Maps to 'course-player' vite chunk (already configured)
│   ├── ClassroomTabShell.tsx             # TabId: 'classroom' entry; mirrors CommunityTabShell.tsx
│   ├── CourseList.tsx                    # Fixed index, no PageBuilder
│   ├── CourseLandingPage.tsx             # PageBuilder integration for /courses/<slug>
│   ├── LessonPlayer.tsx                  # Fork of CommunityVideoPlayer.tsx + onTimeUpdate + signed JWT
│   ├── LessonSidebar.tsx                 # Module/lesson tree with completion checkmarks
│   ├── LessonMarkComplete.tsx            # CTA button (enabled at ≥95% threshold)
│   └── CertVerifyPage.tsx               # /verify/<cert_id> public route
│
├── components/admin/modules/courses/     # Stays in 'admin-shell' chunk
│   ├── CourseEditor.tsx                  # Course + module + lesson admin
│   ├── LessonVideoUploader.tsx           # Fork of CommunityMediaUploader.tsx (30 min cap)
│   └── ModuleReorderList.tsx            # dnd-kit reorder (Phase 31 pattern)
│
├── lib/course/
│   ├── course-types.ts                   # Course, CourseModule, CourseLesson, LessonProgress TS interfaces
│   └── course-progress.ts               # debounce logic, sendBeacon helper, isLessonComplete()
│
supabase/functions/
├── mux-sign-playback/                   # NEW: JWT signing Fn
│   ├── index.ts
│   └── deno.json
├── complete-lesson/                     # NEW: completion + cert trigger
│   ├── index.ts
│   └── deno.json
├── generate-course-certificate/         # NEW: jsPDF cert gen
│   ├── index.ts
│   ├── cert-render.ts                   # mirrors dsar-export/pdf-render.ts
│   └── deno.json
├── lesson-progress-beacon/              # NEW: sendBeacon tab-close handler
│   ├── index.ts
│   └── deno.json
├── mux-create-upload/                   # EXTEND: add kind:'course-lesson' branch
│   └── index.ts
└── mux-webhook/                         # EXTEND: add course-lesson asset.ready/errored branches
    └── index.ts

supabase/migrations/
├── 20270725000001_p46_courses_schema.sql
├── 20270725000002_p46_courses_rls.sql
├── 20270725000003_p46_lesson_progress.sql
├── 20270725000004_p46_certificates.sql
├── 20270725000005_p46_course_resources_bucket.sql
└── 20270725000006_p46_certificates_bucket.sql
```

### Pattern 1: Mux JWT Signed Playback URL (Edge Fn)

The `mux-sign-playback` Edge Fn uses `@mux/mux-node` v14. The SDK reads two env vars: `MUX_SIGNING_KEY` (key ID string) and `MUX_PRIVATE_KEY` (base64-encoded PEM private key). Method: `mux.jwt.signPlaybackId(playbackId, options)`.

```typescript
// Source: mux-node-sdk GitHub + Mux docs (VERIFIED: docs.mux.com/guides/signing-jwts)
import Mux from 'npm:@mux/mux-node@14';

const mux = new Mux({
  tokenId: Deno.env.get('MUX_TOKEN_ID')!,
  tokenSecret: Deno.env.get('MUX_TOKEN_SECRET')!,
  // JWT signing uses MUX_SIGNING_KEY + MUX_PRIVATE_KEY automatically when set
});

// Sign a playback token (aud='v')
const playbackToken = await mux.jwt.signPlaybackId(playbackId, {
  type: 'video',
  expiration: '4h',
});

// Sign a thumbnail token (aud='t') — same Fn, different type
const thumbnailToken = await mux.jwt.signPlaybackId(playbackId, {
  type: 'thumbnail',
  expiration: '4h',
  params: { time: 1 }, // thumbnail at 1s mark
});

// Signed playback URL format:
// `https://stream.mux.com/${playbackId}.m3u8?token=${playbackToken}`
// Signed thumbnail URL format:
// `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${thumbnailToken}`
```

**Mux Dashboard setup:**
1. Go to Settings → Signing Keys → Create new key (generates RS2048 keypair)
2. Download private key as base64-encoded PEM
3. Set Supabase Function Secrets: `MUX_SIGNING_KEY=<key_id>` and `MUX_PRIVATE_KEY=<base64_pem>`
4. For course lessons: create upload with `playback_policies: ['signed']` (NOT `['public']`)

### Pattern 2: Anti-Skip Tracking (Client-Side Only)

**CRITICAL:** `video.view` is NOT a Mux webhook event. Anti-skip is entirely client-side.

```typescript
// In LessonPlayer.tsx — fork of CommunityVideoPlayer.tsx
// Source: Mux Player React API docs + direct codebase verification [VERIFIED]

const SYNC_DEBOUNCE_MS = 15_000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let maxPositionReached = 0;

function handleTimeUpdate(event: Event) {
  const player = event.target as HTMLVideoElement;
  const currentTime = player.currentTime;
  maxPositionReached = Math.max(maxPositionReached, currentTime);

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncProgress({
      lesson_id: lessonId,
      last_position_seconds: Math.round(currentTime),
      max_position_reached_seconds: Math.round(maxPositionReached),
    });
  }, SYNC_DEBOUNCE_MS);
}

// Tab-close: sendBeacon — body is text/plain;charset=UTF-8 when string
function handleBeforeUnload() {
  navigator.sendBeacon(
    `${SUPABASE_URL}/functions/v1/lesson-progress-beacon`,
    JSON.stringify({
      lesson_id: lessonId,
      last_position_seconds: Math.round(lastKnownPosition),
      max_position_reached_seconds: Math.round(maxPositionReached),
      access_token: session?.access_token,
    }),
  );
}

// lesson-progress-beacon Edge Fn MUST read body as text (sendBeacon content-type is text/plain)
// then JSON.parse — NOT req.json() which may fail on text/plain content-type
```

### Pattern 3: jsPDF Certificate in Deno Edge Fn

Proven by `supabase/functions/dsar-export/pdf-render.ts`.

```typescript
// supabase/functions/generate-course-certificate/cert-render.ts
// Source: dsar-export/pdf-render.ts in codebase [VERIFIED: codebase]
import { jsPDF } from 'https://esm.sh/jspdf@3?target=denonext';
import autoTable from 'https://esm.sh/jspdf-autotable@5?target=denonext';
import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext';

export async function renderCertPdf(params: {
  userName: string;
  courseTitle: string;
  completedAt: string;
  verificationUrl: string;
}): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] });

  // Brand-themed cert layout
  doc.setFontSize(36);
  doc.text('Certificate of Completion', 5.5, 2, { align: 'center' });
  doc.setFontSize(24);
  doc.text(params.userName, 5.5, 3.2, { align: 'center' });
  doc.setFontSize(16);
  doc.text(params.courseTitle, 5.5, 4.2, { align: 'center' });
  doc.setFontSize(12);
  doc.text(`Completed: ${params.completedAt}`, 5.5, 5, { align: 'center' });
  doc.text(params.verificationUrl, 5.5, 5.5, { align: 'center' });

  // QR code embedded as base64 PNG
  const qrDataUrl = await QRCode.toDataURL(params.verificationUrl, { width: 100 });
  doc.addImage(qrDataUrl, 'PNG', 8.5, 6.5, 1.5, 1.5);

  return doc.output('blob') as Blob;
}
```

**Important:** Deno esm.sh locks to jspdf@3.0.4. The browser bundle uses jspdf@4.2.1 from package.json. These are different versions — only the Deno path is relevant for the cert Edge Fn. `deno.json` for the cert fn uses esm.sh direct URL imports, no npm: prefix for jsPDF.

### Pattern 4: HMAC Cert Verification Token

Mirrors `_shared/nps-token.ts` and `_shared/helpdesk-hmac.ts`. Uses `node:crypto` (supported in Deno) for `createHmac` + `timingSafeEqual`. Base64url replace-chain: `btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')`.

```typescript
// supabase/functions/generate-course-certificate/cert-hmac.ts
// Source: _shared/nps-token.ts pattern [VERIFIED: codebase]
import { createHmac, timingSafeEqual } from 'node:crypto';

function toBase64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function mintCertToken(
  certId: string, userId: string, courseId: string, issuedAt: string,
  secret: string,
): string {
  const payload = `${certId}:${userId}:${courseId}:${issuedAt}`;
  const mac = createHmac('sha256', secret).update(payload).digest();
  return toBase64Url(mac);
}

export function verifyCertToken(token: string, ...args: Parameters<typeof mintCertToken>): boolean {
  const expected = mintCertToken(...args);
  const eBuf = Buffer.from(expected, 'utf8');
  let pBuf: Buffer;
  try { pBuf = Buffer.from(token, 'utf8'); } catch { return false; }
  if (pBuf.length !== eBuf.length) return false;
  return timingSafeEqual(pBuf, eBuf);
}
```

### Pattern 5: mux-create-upload Extension (course-lesson branch)

```typescript
// Extension to mux-create-upload/index.ts
// Source: existing index.ts [VERIFIED: codebase]
// Body type changes: { post_id?: string } | { lesson_id?: string; course_id?: string; kind?: string }
const kind = body?.kind ?? 'community-post';

if (kind === 'course-lesson') {
  // Admin-only: course lesson upload is admin-created (not user-uploaded)
  // Tier gate: admin role check (is_staff RLS helper)
  const upload = await mux.video.uploads.create({
    cors_origin: req.headers.get('origin') ?? '*',
    new_asset_settings: {
      playback_policies: ['signed'], // SIGNED not public — course-lesson distinction
      max_duration_seconds: 1800,   // D-05: 30 min cap
      passthrough: JSON.stringify({
        kind: 'course-lesson',
        lesson_id: body.lesson_id,
        course_id: body.course_id,
      }),
      generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }], // D-06
    },
    timeout: 3600,
  });
  return jsonResponse(200, { url: upload.url, upload_id: upload.id });
}
// ... existing community-post branch unchanged
```

### Pattern 6: mux-webhook Extension (course-lesson branches)

```typescript
// Extension to mux-webhook/index.ts — dispatched by passthrough.kind
// Source: existing index.ts [VERIFIED: codebase]
const kind = passthrough?.kind ?? 'community-post';

if (kind === 'course-lesson') {
  const lessonId = passthrough?.lesson_id ?? null;
  if (!lessonId) { /* log + 200 */ }

  if (event.type === 'video.asset.ready') {
    const playbackId = event.data.playback_ids?.[0]?.id ?? null;
    await admin.from('course_lessons')
      .update({ mux_asset_id: event.data.id, mux_playback_id: playbackId, mux_status: 'ready' })
      .eq('id', lessonId);
  } else if (event.type === 'video.asset.errored') {
    await admin.from('course_lessons')
      .update({ mux_status: 'rejected' }).eq('id', lessonId);
  } else if (event.type === 'video.upload.asset_created') {
    // mux_asset_id available early — update for tracking
    await admin.from('course_lessons')
      .update({ mux_asset_id: event.data.id, mux_status: 'processing' })
      .eq('id', lessonId);
  }
} else {
  // ... existing community-post branch
}
```

**NOTE:** `video.view` is NOT a valid Mux webhook event type. Do NOT add a handler for it. Anti-skip tracking is entirely client-side via `onTimeUpdate`.

### Pattern 7: UPSERT lesson_progress (INSERT ... ON CONFLICT)

Per memory `reference_state_counter_table_needs_upsert_on_event` — bare UPDATE silently no-ops on first event.

```sql
-- lesson_progress UPSERT pattern
INSERT INTO lesson_progress (user_id, lesson_id, course_id, last_position_seconds,
  max_position_reached_seconds, last_seen_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (user_id, lesson_id) DO UPDATE SET
  last_position_seconds = EXCLUDED.last_position_seconds,
  max_position_reached_seconds = GREATEST(
    lesson_progress.max_position_reached_seconds,
    EXCLUDED.max_position_reached_seconds
  ),
  last_seen_at = now();
-- NEVER use bare UPDATE — no row exists on first event
```

### Anti-Patterns to Avoid

- **`video.view` webhook:** Does not exist in Mux's webhook event list. Do not add handler.
- **`playback_policies: ['public']` for course lessons:** Must be `['signed']`; failing to set signed policy means the JWT Fn is pointless.
- **`req.json()` in lesson-progress-beacon Fn:** `navigator.sendBeacon(url, jsonString)` sends `Content-Type: text/plain;charset=UTF-8`. Must read body as text then `JSON.parse()`.
- **`page_variant_id` on BlockNode:** This field does not exist in the Phase 15 `BlockNode` interface. Phase 39 PAGEAB-06 retrofitting mechanism is out of scope for Phase 46.
- **Letter-suffix migration timestamps:** Per memory `reference_supabase_migration_filename_regex` — use 14-digit numeric timestamps only.
- **`--import-map` flag on Edge Fn deploy:** Per memory `reference_supabase_functions_deploy_import_map_flag` — use per-fn `deno.json` instead.
- **Bare `UPDATE lesson_progress`:** No-ops on first event. Always use `INSERT ... ON CONFLICT`.
- **jsPDF `import { jsPDF } from 'jspdf'` in Deno:** Use `https://esm.sh/jspdf@3?target=denonext` — the npm: prefix import fails for jsPDF in Deno.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT playback signing | Custom RS256 signing logic | `@mux/mux-node` `mux.jwt.signPlaybackId()` | Handles aud/sub/exp/kid claims, key rotation, error cases |
| Mux webhook signature verify | Custom HMAC verify | `mux.webhooks.verifySignature()` (already in mux-webhook fn) | Timestamp tolerance, multi-sig header handling |
| HMAC base64url encoding | Custom replace-chain | Pattern from `_shared/nps-token.ts` (verbatim) | Project-established standard; replace-chain consistency proven |
| PDF generation in Deno | `pdf-lib` (manual layout) | `jsPDF@3 + jspdf-autotable via esm.sh` | Pattern proven in dsar-export; rich layout API |
| QR code in PDF | Manual pixel drawing | `qrcode@1.5.4 via esm.sh` | Error-correction levels, format options, 20-line integration |
| Storage signed URLs | Pre-signed URL construction | `supabase.storage.from(bucket).createSignedUrl(path, ttl)` | Supabase SDK handles signing |

**Key insight:** The anti-skip problem is deceptively simple — it's just a `max()` tracked client-side in state and persisted on each sync. Do not introduce a server-push architecture (Mux Data streaming exports, etc.) for what is a ~5-line client state update.

---

## Common Pitfalls

### Pitfall 1: `video.view` Webhook Does Not Exist

**What goes wrong:** Plan adds `video.view` branch to `mux-webhook` handler expecting Mux to send per-view position events. Handler never fires. Anti-skip gate always false. No lessons ever marked complete.

**Why it happens:** CONTEXT.md D-12 mentions `video.view` in the context of Mux documentation, but Mux webhooks cover only asset/upload/live-stream lifecycle — NOT playback data events. Mux Data "view" events are exported via Kinesis/Pub-Sub streams, not webhooks.

**How to avoid:** Track `max_position_reached_seconds` entirely client-side in `onTimeUpdate`. Server `complete_lesson` Edge Fn reads this value from `lesson_progress` at call time for double-check.

**Warning signs:** Lesson completion rate is 0%; `mux-webhook` logs never show `video.view` event type.

### Pitfall 2: `playback_policies: ['public']` for Course Lessons

**What goes wrong:** Lesson videos are playable without a JWT by anyone with the playback ID. The `mux-sign-playback` Fn is never actually required for playback. Tier gate is bypassed.

**Why it happens:** Copying the community-post upload pattern which uses `['public']`.

**How to avoid:** In the `kind: 'course-lesson'` branch of `mux-create-upload`, always set `playback_policies: ['signed']`. The Mux dashboard signing-key policy must be attached to the playback ID.

**Warning signs:** Videos play without JWT token; Mux Player does not show "Unauthorized" without a token.

### Pitfall 3: sendBeacon Body Parsed as JSON

**What goes wrong:** `lesson-progress-beacon` Edge Fn calls `req.json()` on a sendBeacon request. Throws `SyntaxError: Unexpected token` because content-type is `text/plain;charset=UTF-8`, not `application/json`.

**Why it happens:** All other Edge Fns use `req.json()`. sendBeacon encodes body as text/plain when given a string argument.

**How to avoid:**
```typescript
// In lesson-progress-beacon/index.ts
const bodyText = await req.text();
const body = JSON.parse(bodyText) as { lesson_id: string; ... };
```

**Warning signs:** All tab-close progress saves 500; beacon events logged as errors.

### Pitfall 4: MUX_SIGNING_KEY vs MUX_SIGNING_KEY_ID Naming Mismatch

**What goes wrong:** CONTEXT.md names the secret `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE`. The `@mux/mux-node` SDK reads `MUX_SIGNING_KEY` (key ID) + `MUX_PRIVATE_KEY` (private key). If the wrong env var names are set, `mux.jwt.signPlaybackId()` silently uses undefined keys and produces invalid JWTs.

**Why it happens:** CONTEXT.md used descriptive names that don't match SDK defaults.

**How to avoid:** In `mux-sign-playback/deno.json` and Wave 0 secret-set instructions, use the exact SDK env var names: `MUX_SIGNING_KEY` and `MUX_PRIVATE_KEY`. Alternatively, pass explicitly: `mux.jwt.signPlaybackId(id, { keyId: Deno.env.get('MUX_SIGNING_KEY_ID'), keySecret: Deno.env.get('MUX_SIGNING_KEY_PRIVATE') })` — the SDK also accepts explicit `keyId`/`keySecret` options, which avoids the naming dependency entirely.

**Warning signs:** Mux Player shows "Unauthorized" or "Forbidden" on all signed URLs; JWT decode shows empty kid.

**Recommendation:** Use explicit `keyId`/`keySecret` options in the fn (not env-var auto-read) to decouple from SDK defaults and keep CONTEXT.md naming. Set Supabase secrets as `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` per CONTEXT.md D-07, and pass them explicitly to `signPlaybackId`.

### Pitfall 5: Bare UPDATE on lesson_progress (Insert-First Event)

**What goes wrong:** First progress event for a user+lesson silently no-ops because the row doesn't exist yet. `last_position_seconds` stays at 0; anti-skip never accumulates; user can never mark lesson complete.

**Why it happens:** Using `UPDATE ... WHERE user_id=$1 AND lesson_id=$2` when no row exists.

**How to avoid:** Always use `INSERT INTO lesson_progress (...) ON CONFLICT (user_id, lesson_id) DO UPDATE SET ...` with `GREATEST(lesson_progress.max_position_reached_seconds, EXCLUDED.max_position_reached_seconds)` for idempotent max tracking.

### Pitfall 6: jsPDF Version Mismatch (browser v4 vs Deno v3)

**What goes wrong:** Developer imports `jspdf@4` API in the cert Edge Fn (e.g., different constructor options or new methods) — but esm.sh resolves `jspdf@3?target=denonext` to jsPDF 3.0.4 which has a slightly different API.

**Why it happens:** Browser package.json has `jspdf@^4.2.1`; Deno esm.sh uses `@3`.

**How to avoid:** The cert fn should mirror `dsar-export/pdf-render.ts` exactly. Use only jsPDF v3 API in the Deno path. The landscape page setup uses `new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] })` — verify this constructor signature works in v3.

### Pitfall 7: `course-player` Chunk Path Must Be `src/components/course/` (Singular)

**What goes wrong:** Components placed in `src/components/courses/` (plural) don't match the vite.config.ts rule `id.includes('/src/components/course/')` (singular). They land in the default chunk, inflating the index.

**Why it happens:** Natural naming drift — "courses" is the plural resource name.

**How to avoid:** Use `src/components/course/` (singular) per the existing vite.config.ts rule. The bundle ceiling assertion script already tests for the `course-player` chunk at 30 kB gz.

### Pitfall 8: Admin Course Module Not in ADMIN_MODULES Manifest

**What goes wrong:** Admin course editor component exists but is unreachable via admin nav because `ADMIN_MODULES` in `src/lib/admin/modules.ts` has no entry for it.

**Why it happens:** Per memory `feedback_admin_module_manifest_vs_router_branch_drift` — AdminShell uses the manifest; new modules must be added to the manifest AND have a corresponding catch-all branch in the router.

**How to avoid:** Add `{ key: 'courses', label: 'Courses', route: 'courses', ... lazy: () => import('@/components/admin/modules/courses/CourseEditor') }` to `ADMIN_MODULES` in the same plan that creates `CourseEditor.tsx`.

---

## Code Examples

### Verified patterns from codebase

### Mux Player with Signed Token (client)
```typescript
// src/components/course/LessonPlayer.tsx — fork of CommunityVideoPlayer.tsx
// Source: CommunityVideoPlayer.tsx [VERIFIED: codebase] + Mux Player React API docs
import MuxPlayer from '@mux/mux-player-react/lazy'; // MUST use /lazy entry point

function LessonPlayer({ lessonId, playbackId, duration }: LessonPlayerProps) {
  const [tokens, setTokens] = useState<{ playback: string; thumbnail: string } | null>(null);

  useEffect(() => {
    // Fetch signed tokens from mux-sign-playback Edge Fn
    supabase.functions.invoke('mux-sign-playback', {
      body: { lesson_id: lessonId },
    }).then(({ data }) => setTokens(data));
  }, [lessonId]);

  if (!tokens) return <Skeleton />;

  return (
    <MuxPlayer
      playbackId={playbackId}
      tokens={{ playback: tokens.playback, thumbnail: tokens.thumbnail }}
      streamType="on-demand"
      startTime={lastPosition}
      onTimeUpdate={handleTimeUpdate}
      className="w-full"
    />
  );
}
```

### lesson_progress UPSERT (Supabase RPC or direct query)
```sql
-- supabase/migrations/20270725000003_p46_lesson_progress.sql
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id                   uuid NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  course_id                   uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  completed_at                timestamptz,
  last_position_seconds       integer NOT NULL DEFAULT 0,
  max_position_reached_seconds integer NOT NULL DEFAULT 0,
  last_seen_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
```

### Tier gate extension (isResourceAllowed)
```typescript
// src/lib/community/tier-gate.ts extension — same file
// Source: tier-gate.ts [VERIFIED: codebase]
export type ResourceType = 'pdf' | 'video' | 'zip';

export function isResourceAllowed(tier: TierLabel, _resourceType: ResourceType): boolean {
  // D-16: Pro-gated resources require pro, lifetime, or trial
  return tier === 'pro' || tier === 'lifetime' || tier === 'trial';
}
```

### Storage bucket pattern (course-resources)
```typescript
// src/lib/course/course-storage.ts — mirrors community-storage.ts
// Source: community-storage.ts [VERIFIED: codebase]
export const COURSE_RESOURCES_BUCKET = 'course-resources' as const;
export const COURSE_RESOURCES_MIMES = new Set(['application/pdf', 'video/mp4', 'application/zip']);
export const COURSE_RESOURCES_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side view tracking webhook | Client-side `onTimeUpdate` + DB sync | N/A (Mux webhook never had `video.view`) | Anti-skip is purely client → server on completion check |
| Mux signed URLs via custom JWT libs | `@mux/mux-node` `mux.jwt.signPlaybackId()` | mux-node SDK v7+ | Single-line signing; handles all claim types |
| jsPDF in Node.js only | jsPDF in Deno via esm.sh (`target=denonext`) | esm.sh + Deno runtime support | Cert generation stays in Supabase Edge Fns; no Vercel API route needed |
| `--import-map` flag in `supabase functions deploy` | Per-function `deno.json` | CLI v2.101.0 (2026-05-22) silently broke `--import-map` | Each new Edge Fn MUST have its own `deno.json` with imports |

**Deprecated/outdated:**
- `video.view` Mux webhook: never existed; remove from any plan that mentions it
- `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` for JWT signing: these are API access tokens; signing uses `MUX_SIGNING_KEY` (key ID) + `MUX_PRIVATE_KEY` (private key) — distinct secrets
- `--linked` flag on `supabase functions deploy`: removed in CLI v2.100.0; omit it

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Mux `mux.jwt.signPlaybackId()` with explicit `keyId`/`keySecret` options works even if `MUX_SIGNING_KEY`/`MUX_PRIVATE_KEY` env vars are not set (env vars are SDK auto-read only) | Pattern 1 | If explicit options don't override env vars, fn may fail to find key |
| A2 | `navigator.sendBeacon(url, JSON.stringify(data))` sends `text/plain;charset=UTF-8` content-type, which requires `req.text()` not `req.json()` in Edge Fn | Pattern 2 / Pitfall 3 | If Supabase Edge Runtime normalizes content-type before parsing, `req.json()` may work |
| A3 | esm.sh `qrcode@1.5.4?target=denonext` works in Supabase Edge Runtime without canvas polyfill (for `toDataURL` PNG output) | Pattern 3 | Deno may not have canvas API; may need `toBuffer()` instead of `toDataURL()`, or an SVG path |
| A4 | `new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] })` works in jsPDF v3.0.4 (esm.sh) | Pattern 3 | jsPDF v3 may have different constructor signature for landscape; fallback: use `format: 'letter'` + manual orientation |
| A5 | Phase 46 course landing pages can use the existing `landing_pages` + `page-save` + `page-render` infrastructure without schema changes | Architecture | If page-render fn has `/courses/` in RESERVED_SLUGS or a rewrite conflict, a new route mechanism is needed |

---

## Open Questions (RESOLVED)

1. **`qrcode` in Deno — canvas dependency**
   - What we know: `qrcode` npm uses canvas for PNG rendering; Deno Edge Runtime does not have native canvas
   - What's unclear: Whether esm.sh's denonext target polyfills canvas or whether `qrcode.toDataURL()` fails
   - Recommendation: In Wave 0, test `import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext'; await QRCode.toDataURL('test')` in a Deno REPL. Fallback: use `QRCode.toString('test', { type: 'svg' })` (SVG output, no canvas) and embed SVG in jsPDF via `doc.addSvgAsImage()` (available in jsPDF autotable).

2. **`/courses/<slug>` route conflict with `RESERVED_SLUGS`**
   - What we know: `RESERVED_SLUGS` in block-schema.ts includes `clinic | admin | share | api | auth | assets | sitemap.xml | robots.txt`; `courses` is not listed [VERIFIED: codebase]
   - What's unclear: Whether `vercel.json` rewrites need updating to pass `/courses/<slug>` to the `page-render` Edge Fn
   - Recommendation: Check `vercel.json` for existing catch-all rewrite; if it already covers `/{slug}` for published pages, no change needed. If `/courses/*` needs separate routing, add a dedicated rewrite.

3. **Lesson count write storm sustainability**
   - What we know: 15s debounced sync = ~120 writes per 60-min lesson per user; Supabase Postgres can handle thousands of writes/sec
   - What's unclear: Whether 120 writes/user/lesson creates meaningful Supabase row quota pressure at scale
   - Recommendation: For v1 with a small user base, 15s debounce is fine. If scale becomes a concern, increase to 30s debounce (halves writes) with negligible UX impact.

4. **Phase 39 PAGEAB-06 forward-compat — does Phase 46 need to do anything?**
   - What we know: `BlockNode` has no `page_variant_id` field; blocks are stored as JSONB in `landing_page_revisions.blocks`; Phase 39 is planned but not executed
   - What's unclear: What mechanism Phase 39 uses to add per-block variants
   - Recommendation: Phase 46 creates standard `landing_pages` rows using the existing Phase 15 infrastructure. No special forward-compat schema work needed in Phase 46. Phase 39 should be able to retrofit without Phase 46 schema changes.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@mux/mux-node@14` (npm: in Deno) | `mux-create-upload`, `mux-webhook`, `mux-sign-playback` | ✓ | 14 (in existing fn deno.json) | — |
| `@mux/mux-player-react@3.13.0` | `LessonPlayer.tsx` | ✓ | 3.13.0 (in package.json) | — |
| `@mux/mux-uploader-react@1.5.0` | `LessonVideoUploader.tsx` | ✓ | 1.5.0 (in package.json) | — |
| `jspdf@4.2.1` (browser) | Browser export path (if any) | ✓ | 4.2.1 (in package.json) | — |
| `jspdf@3` via esm.sh (Deno) | `generate-course-certificate` Edge Fn | ✓ | 3.0.4 (proven by dsar-export deno.lock) | — |
| `qrcode@1.5.4` via esm.sh (Deno) | `generate-course-certificate` cert PDF | ✗ (not yet verified in Deno) | 1.5.4 (npm latest) | SVG fallback via `QRCode.toString(..., {type:'svg'})` |
| `node:crypto` in Deno | HMAC cert verification | ✓ | Deno std (proven by nps-token.ts) | — |
| Mux URL Signing Key | `mux-sign-playback` | ✗ (not created yet) | — | Must create in Mux Dashboard; Wave 0 operator step |
| `CERT_VERIFICATION_SECRET` | `generate-course-certificate` | ✗ (not set yet) | — | `openssl rand -hex 32`; Wave 0 operator step |
| Supabase CLI | Migrations, fn deploy | ✓ | 2.98.2 (npx path) | — |

**Missing dependencies with no fallback:**
- Mux URL Signing Key: must create via Mux Dashboard (Settings → Signing Keys) before `mux-sign-playback` Fn can work. Wave 0 MUST include operator instruction.
- `CERT_VERIFICATION_SECRET`: must be set as Supabase Function Secret before `generate-course-certificate` works.

**Missing dependencies with fallback:**
- `qrcode` in Deno: SVG path available if canvas/PNG path fails.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (browser) + Deno test (Edge Fns) |
| Config file | `vitest.config.ts` (embedded in `vite.config.ts`) |
| Quick run command | `npm run test -- --run src/components/course/ src/lib/course/` |
| Full suite command | `npm run test -- --run` |
| Deno Edge Fn tests | `$HOME/.deno/bin/deno test --no-check supabase/functions/mux-sign-playback/ supabase/functions/complete-lesson/ supabase/functions/generate-course-certificate/ supabase/functions/lesson-progress-beacon/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COURSE-01 | courses + modules + lessons schema created | manual (migration) | `supabase db push --linked` | ❌ Wave 0 |
| COURSE-01 | Admin CRUD for course/module/lesson | unit (component) | `npm run test -- --run src/components/admin/modules/courses/` | ❌ Wave 0 |
| COURSE-02 | mux-create-upload kind:'course-lesson' branch returns signed upload URL | Deno unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/mux-create-upload/` | ❌ Wave 0 (extend existing) |
| COURSE-02 | mux-webhook routes asset.ready to course_lessons (not community_posts) | Deno unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/mux-webhook/` | ❌ Wave 0 (extend existing) |
| COURSE-03 | lesson_progress UPSERT inserts on first event (not no-op) | unit | `npm run test -- --run src/lib/course/` | ❌ Wave 0 |
| COURSE-03 | max_position_reached_seconds uses GREATEST on conflict | unit | `npm run test -- --run src/lib/course/` | ❌ Wave 0 |
| COURSE-04 | generate-course-certificate returns Blob with PDF content | Deno unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/generate-course-certificate/` | ❌ Wave 0 |
| COURSE-04 | HMAC cert token mintCertToken → verifyCertToken round-trip | Deno unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/generate-course-certificate/` | ❌ Wave 0 |
| COURSE-05 | Course landing page renders via page-render Fn (existing infra) | smoke | manual-only (deploy-time) | — |
| COURSE-06 | isResourceAllowed returns false for 'free' tier | unit | `npm run test -- --run src/lib/community/tier-gate.test.ts` | ❌ Wave 0 (extend existing) |
| COURSE-06 | Resource download returns signed URL for pro users, 403 for free | Deno unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/complete-lesson/` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test -- --run src/lib/course/ src/components/course/` (vitest, ~5s)
- **Per wave merge:** `npm run test -- --run` (full vitest suite) + Deno sweep on touched Fns
- **Phase gate:** Full suite green + Deno sweep before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/course/course-progress.test.ts` — UPSERT idempotency, GREATEST max tracking (COURSE-03)
- [ ] `src/lib/community/tier-gate.test.ts` — extend with `isResourceAllowed` cases (COURSE-06)
- [ ] `supabase/functions/mux-sign-playback/index.test.ts` — JWT sign + tier check (COURSE-02)
- [ ] `supabase/functions/mux-create-upload/index.test.ts` — extend with `kind:'course-lesson'` branch (COURSE-02)
- [ ] `supabase/functions/mux-webhook/index.test.ts` — extend with course-lesson asset.ready/errored branches (COURSE-02)
- [ ] `supabase/functions/generate-course-certificate/index.test.ts` — Blob output + HMAC round-trip (COURSE-04)
- [ ] `supabase/functions/lesson-progress-beacon/index.test.ts` — text/plain body parsing (COURSE-03)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Supabase JWT; `admin.auth.getUser(bearer)` in `mux-sign-playback`; service-role in cert fn |
| V3 Session Management | No (stateless JWTs) | — |
| V4 Access Control | Yes | `tier_effective.has_active` for playback gate; `is_staff()` SECDEF for admin upload; RLS on lesson_progress (self-read only) |
| V5 Input Validation | Yes | `lesson_id` UUID validation; `kind` discriminator validation in mux-create-upload; HMAC token format validation |
| V6 Cryptography | Yes | RS256 JWT for Mux playback; HMAC-SHA256 for cert token; `timingSafeEqual` for constant-time verify |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Playback URL sharing cross-user | Information Disclosure | RS256 JWT with 4h exp; `aud='v'` bound to specific playback ID |
| Anti-skip bypass (client-side max_position manipulation) | Tampering | Server `complete_lesson` Edge Fn reads `max_position_reached_seconds` from DB (server-trusted); client cannot post a fake value higher than what was written by the debounced sync (each sync is authenticated) |
| Cert token forgery | Tampering | HMAC-SHA256 with `CERT_VERIFICATION_SECRET`; `timingSafeEqual` prevents timing oracle |
| Cert token replay (sharing cert URL + token) | Elevation of Privilege | By design: cert verification URL is semi-public (linked from cert PDF); the HMAC proves authenticity, not access control |
| sendBeacon without auth | Spoofing | `lesson-progress-beacon` Fn reads `access_token` from JSON body; validates via `admin.auth.getUser(token)`; no auth = ignore, not 401 (sendBeacon can't read response) |
| Resource download signed URL caching | Information Disclosure | Signed URL TTL = 60 min; URL bound to storage object path which includes user_id prefix |
| RLS bypass on lesson_progress | Elevation of Privilege | RLS: `user_id = auth.uid()` for SELECT/INSERT/UPDATE; cross-tenant impersonation test required |

---

## Sources

### Primary (HIGH confidence)

- Codebase: `supabase/functions/mux-create-upload/index.ts` — existing mux upload fn structure [VERIFIED]
- Codebase: `supabase/functions/mux-webhook/index.ts` — webhook handler pattern [VERIFIED]
- Codebase: `supabase/functions/dsar-export/pdf-render.ts` — jsPDF in Deno via esm.sh proven [VERIFIED]
- Codebase: `supabase/functions/_shared/nps-token.ts` — HMAC base64url pattern [VERIFIED]
- Codebase: `supabase/functions/_shared/helpdesk-hmac.ts` — Web Crypto HMAC pattern [VERIFIED]
- Codebase: `src/lib/community/tier-gate.ts` — TierLabel, isVideoAllowed, canAccessSpace [VERIFIED]
- Codebase: `src/lib/community/community-storage.ts` — Storage bucket pattern [VERIFIED]
- Codebase: `src/lib/page-builder/block-schema.ts` — BlockNode schema (no page_variant_id) [VERIFIED]
- Codebase: `src/components/community/media/CommunityVideoPlayer.tsx` — MuxPlayer lazy import [VERIFIED]
- Codebase: `vite.config.ts` — `course-player` chunk rule at `src/components/course/` [VERIFIED]
- Codebase: `scripts/assert-bundle-budget.sh` — course-player 30 kB gz ceiling [VERIFIED]
- Codebase: `src/types/index.ts` — TabId type (does not yet include 'classroom') [VERIFIED]
- Codebase: `supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql` — `has_active` boolean confirmed [VERIFIED]
- Codebase: `package.json` — jspdf@4.2.1, @mux/mux-player-react@3.13.0, @dnd-kit/* [VERIFIED]
- [Mux Docs: Signed URLs](https://www.mux.com/docs/security-signed-urls) — JWT claims (aud, sub, exp, kid) [CITED]
- [Mux Docs: Signing JWTs](https://www.mux.com/docs/guides/signing-jwts) — key ID + base64 PEM setup [CITED]
- [Mux mux-node-sdk jwt.ts](https://github.com/muxinc/mux-node-sdk/blob/master/src/resources/jwt.ts) — `signPlaybackId` method signature [CITED]

### Secondary (MEDIUM confidence)

- npm view @mux/mux-node — version 14.1.0 [VERIFIED: npm registry]
- npm view qrcode — version 1.5.4 [VERIFIED: npm registry]
- WebFetch: [Mux webhook events list](https://www.mux.com/docs/core/listen-for-webhooks) — confirmed `video.view` does NOT exist as webhook event [CITED]

### Tertiary (LOW confidence)

- A3: `qrcode` canvas support in Deno via esm.sh — inferred from general esm.sh target=denonext behavior; not directly tested [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in codebase or npm registry
- Architecture: HIGH — built directly from codebase analysis of existing patterns
- Anti-skip approach: HIGH — confirmed by Mux webhook docs that video.view does NOT exist
- Pitfalls: HIGH — most derived from direct codebase verification
- QR code in Deno: LOW — esm.sh behavior with canvas-dependent packages not verified

**Research date:** 2026-05-23
**Valid until:** 2026-06-22 (30 days; Mux SDK and esm.sh versions may shift)

---

## RESEARCH COMPLETE
