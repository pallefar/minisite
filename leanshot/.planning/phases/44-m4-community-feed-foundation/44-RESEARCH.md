# Phase 44: M4 Community Feed Foundation - Research

**Researched:** 2026-05-23
**Domain:** Supabase schema + RLS, Mux video integration, Realtime channels, react-markdown, DOMPurify, bundle splitting
**Confidence:** HIGH (core stack verified via Context7 + codebase grep); MEDIUM (Mux bundle size — bundlephobia confirmed uploader, player rate-limited but confirmed via web search)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Comment thread depth = flat / 1-level (post → comment). Schema ships `community_comments.parent_comment_id` nullable for Phase 45+ lift.
- **D-02:** Reactions on both posts AND comments. Single `community_reactions` table with `target_type ∈ {'post','comment'}` + `target_id`, idempotent toggle via UNIQUE(`user_id`, `target_type`, `target_id`, `emoji`).
- **D-03:** Fixed reaction set: `like`, `heart`, `target`, `fire`, `clap`. Enforced via Postgres CHECK constraint.
- **D-04:** Per-post image cap = 10. Supabase Storage bucket `community-media`. 60-min signed URLs. Cap enforced at client + trigger on `community_post_media`.
- **D-05:** Mux video: 5 min / 500 MB, single video per post. Client-side guards + Mux webhook rejects exceeding `max_duration_seconds`.
- **D-06:** Video upload gated to Pro + Lifetime via `tier_effective`. Free tier: text + images only; video uploader hidden; create-asset Edge Fn 403s Free users. Images un-gated.
- **D-07:** Auto-thumbnail via Mux playback_id endpoint at 1s mark. `<img loading="lazy">` with explicit width/height.
- **D-08:** Free user in Pro/Lifetime-only space: locked card + `/pricing` CTA. Post bodies NOT readable. NOT Phase 39 paywall variant.
- **D-09:** Clinic-org-only space for non-org users: RLS-hidden entirely via `community_spaces.org_id` policy.
- **D-10:** Post body: markdown subset, no inline images (dompurify strips `![]()`). Supported: h2–h4, bold, italic, lists, ordered lists, links (http/https, target=_blank rel=noopener), code blocks, blockquotes.
- **D-11:** Post body cap = 5,000 chars (client + DB CHECK). Drafts autosave to localStorage key `community_draft_{spaceId}_{userId}`.
- **D-12:** Default feed sort: Recent (chronological), cursor-paginated by `(created_at, id)` DESC.
- **D-13:** Realtime scope: per-space channel. Listens on INSERT to `community_posts WHERE space_id = $current`, INSERT/DELETE to `community_reactions` and `community_comments` for posts in that space. No nested per-post channel.
- **D-14:** Notification fan-out conservative: `@mention` → in-app + email to mentioned user (gated by `notification_settings.community_mentions`). Comment on post → in-app to post-author only (gated by `notification_settings.community_replies`). Mention regex: `/@([a-z0-9_]{3,30})\b/i`. Resolved user_ids → `community_post_mentions` / `community_comment_mentions` join tables.
- **D-15:** Edit forever by author; soft-delete tombstone (`deleted_at` + `[deleted]` in render); hard-delete admin-only in Phase 48.

### Claude's Discretion

- Storage bucket name (`community-media` matches project kebab-case convention — confirmed by codebase scan: `page-assets`, `org-logos`, `branding-assets`).
- Reaction emoji rendering: use OS-native emoji (Phase 35 gamification uses native; match that).
- Mention typeahead: 300ms debounce (see Fuse.js pattern from `MacroTypeahead.tsx`); max 5-8 suggestions; Fuse.js from `helpdesk-macros` chunk MUST NOT be statically imported in community-feed chunk — each gets its own lazy Fuse instance.
- Draft autosave debounce: 500 ms (CONTEXT.md suggestion).
- Mux webhook auth: use existing HMAC payload pattern (`sb_secret_*` bearer) NOT legacy JWT.

### Deferred Ideas (OUT OF SCOPE)

- Personalized feed sort (Phase 38 recommender hookup)
- Sort toggle (Recent vs Popular)
- Reply-to-comment threading (N-level)
- Custom video thumbnail picker
- Per-post mute / watch-thread toggle
- Phase 39 paywall-variant routing on locked-space CTA
- Cross-device draft autosave (DB-backed)
- Slack-style extensible emoji reactions

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMMUNITY-01 | User posts + threaded comments (markdown via react-markdown + dompurify); posts schema with author_id + space_id + parent_comment_id + body + reactions | Schema design, DOMPurify config, react-markdown reuse pattern from Phase 37 |
| COMMUNITY-02 | Likes + reactions; post_reactions table with idempotent toggle | UNIQUE constraint idempotency pattern; Realtime broadcast on toggle |
| COMMUNITY-03 | @mentions in posts + comments fire in-app + email notifications; respect notification_settings | Notification category migration required; mention regex edge cases; fan-out Edge Fn extends notification-send |
| COMMUNITY-04 | Image embeds (Supabase Storage signed URLs) + video embeds (Mux upload + adaptive playback); per-post image cap | Mux direct-upload flow; webhook auth; bundle split strategy for player (170 kB gz) |
| COMMUNITY-05 | Realtime feed updates via Supabase Realtime (new posts + comments + reaction updates) | postgres_changes filter pattern; per-space channel lifecycle from use-roster-realtime.ts |
| COMMUNITY-06 | Spaces / categories admin-configurable; per-space visibility (Free / Pro / Lifetime) | tier_effective view (Phase 43); org_id RLS (Phase 28); admin-shell chunk route |

</phase_requirements>

---

## Summary

Phase 44 builds a Skool-style community feed on top of the existing Supabase + React stack. The phase is primarily a schema + RLS + Edge Function + React component exercise. All major framework dependencies are already in `package.json` (`react-markdown@9.0.0`, `dompurify@3.2.0`, `fuse.js@^7.3.0`, `@supabase/supabase-js@^2.105.4`). The non-trivial risks are:

1. **Bundle ceiling.** The community-feed chunk is capped at 20 kB gz. `@mux/mux-player-react@3.13.0` is ~170 kB gz and `@mux/mux-uploader-react@1.5.0` is 16 kB gz — neither can land in the base chunk. Both require separate Vite manualChunks sub-splits (analogous to `helpdesk-article` / `helpdesk-macros`) routed through `React.lazy()` + `sync-defer.ts`.

2. **Notification category widening.** The `notification_settings`, `notification_category_config`, `user_notifications`, and `notification_dismissal_state` tables all have CHECK constraints that enumerate `('dose-reminders','ai-insights','clinic-alerts','billing','marketing')`. The community categories `community-mentions` and `community-replies` DO NOT exist yet. Phase 44 MUST ship a migration that widens all four CHECK constraints and seeds two new rows in `notification_category_config` — in the same migration file per `feedback_planner_missed_status_enum_widening`.

3. **Email template extension.** The `email-router.ts` `EmailTemplate` union type does not contain community templates. Phase 44 must extend it with `community_mention` and `community_reply` (both non-PHI → Resend) in the same commit.

4. **Mux webhook HMAC.** The project's Edge Function auth convention is `sb_secret_*` bearer or HMAC payload (NOT legacy HS256 JWT per `reference_supabase_service_role_key_format_divergence`). The Mux webhook Edge Function should verify the Mux-Signature header using `mux.webhooks.verifySignature(body, headers, MUX_WEBHOOK_SECRET)` from `@mux/mux-node`.

**Primary recommendation:** Split Phase 44 into 6–7 plans: (1) schema + RLS + bucket migration wave; (2) notification category widening + email template extension; (3) Mux create-asset + webhook Edge Fn; (4) community-feed React chunk with post/comment/reaction UI; (5) media attachments UI (image uploader + Mux uploader/player as separate `community-media` sub-chunk); (6) Spaces admin UI; (7) bundle ceiling assertion update in CI scripts.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Post / comment CRUD | Database / Storage | API (Edge Fn for fan-out) | Supabase PostgREST handles CRUD; Edge Fns only for side-effects (notifications, Mux) |
| Reaction toggle idempotency | Database | — | UNIQUE constraint + upsert is the authoritative idempotency gate |
| Tier gating (video + space) | Database (RLS + tier_effective) | API/Frontend | RLS enforces at read-time; frontend hides UI elements |
| Mux direct upload | API (Edge Fn `mux-create-upload`) | Browser | Secret key never in browser; Edge Fn mints upload URL |
| Mux webhook | API (Edge Fn `mux-webhook`) | — | Verifies Mux signature, updates `community_posts.video_status` |
| Mention regex parsing | API (Edge Fn / DB trigger) | Frontend | At insert-time server-side resolution; frontend shows typeahead UI only |
| Realtime fan-out | Frontend | — | supabase-js channel subscribes in browser; postgres_changes drives updates |
| @mention notifications | API (Edge Fn extends notification-send) | — | Async fan-out after insert; never in transaction |
| Storage signed URLs | API (supabase-js in browser) | — | `createSignedUrl` called client-side at render time (60-min TTL) |
| Feed pagination | Database | Frontend | Cursor on (created_at, id); no full-text, no score |

---

## Standard Stack

### Core (All Already in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | 9.0.0 | Markdown rendering | Already used in Phase 37 KBArticleView; zero new dep cost |
| dompurify | 3.2.0 | HTML sanitization | Phase 37 T-37-06-01; `USE_PROFILES: { html: true }` baseline |
| remark-gfm | ^4.0.1 | GFM tables / strikethrough | Already paired with react-markdown in helpdesk |
| rehype-raw | 7.0.0 | Raw HTML passthrough | Already in helpdesk stack |
| fuse.js | ^7.3.0 | Fuzzy mention typeahead | Already used in `MacroTypeahead.tsx`; phase 37 sub-chunk pattern |
| @supabase/supabase-js | ^2.105.4 | Realtime channel + CRUD | Project-wide singleton; Realtime already used in 4+ hooks |

### New Dependencies Required

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @mux/mux-uploader-react | 1.5.0 | Chunked direct-upload UI | Pro+Lifetime users; conditional-imported via `React.lazy` |
| @mux/mux-player-react | 3.13.0 | Adaptive HLS playback | Render video with `playbackId` from `community_posts.mux_playback_id` |
| @mux/mux-node | 14.1.0 | Server: create upload URL + verify webhook | Deno Edge Fn `mux-create-upload` + `mux-webhook` |

[VERIFIED: npm registry — npm view @mux/mux-uploader-react version → 1.5.0; npm view @mux/mux-player-react version → 3.13.0; npm view @mux/mux-node version → 14.1.0]

**Bundle sizes (CRITICAL for planning):**

| Package | gz Size | Chunk Assignment |
|---------|---------|-----------------|
| @mux/mux-uploader-react@1.5.0 | **16.2 kB gz** | `community-media` sub-chunk |
| @mux/mux-player-react@3.13.0 | **~170 kB gz** | `community-media` sub-chunk (lazy/lazy import) |
| fuse.js@7.3.0 | 8 kB gz | `community-mentions` sub-chunk (same pattern as `helpdesk-macros`) |

[VERIFIED: bundlephobia API for @mux/mux-uploader-react@1.5.0 → 16,564 bytes gz]
[CITED: https://www.mux.com/blog/mux-player-lazy-loading-with-blurhash — player is 170 kB gz; lazy import from `@mux/mux-player-react/lazy` defers download until viewport]

**Installation:**
```bash
# In leanshot/ (frontend):
npm install @mux/mux-uploader-react@1.5.0 @mux/mux-player-react@3.13.0

# In supabase/functions/ (Edge Fns — via deno.json imports, NOT npm install):
# Use npm: specifier in Deno: import Mux from 'npm:@mux/mux-node@14';
```

---

## Architecture Patterns

### System Architecture Diagram

```
Browser                     Supabase / Edge                     Mux
───────────────────────────────────────────────────────────────────────
User opens Space
  → GET community_spaces (RLS: tier_effective + org_id check)
  → Locked card? → /pricing CTA (D-08)

User creates post
  → POST community_posts (RLS: authenticated)
  → DB trigger fires mention resolution → writes community_post_mentions
  → Edge Fn notify-community-mentions
     → reads notification_settings (category: community-mentions)
     → calls notification-send Edge Fn (in-app + Resend email)

User attaches video (Pro+Lifetime only)
  → POST /mux-create-upload (Edge Fn — tier check via tier_effective)
     → @mux/mux-node → Mux API → upload URL
  → MuxUploader (React) → direct upload to Mux GCS endpoint
  → Mux transcodes → POST /mux-webhook (Edge Fn — HMAC verify)
     → UPDATE community_posts SET video_status, mux_playback_id

Realtime feed updates (per-space channel)
  → supabase.channel('community:${spaceId}')
     .on('postgres_changes', INSERT community_posts/comments/reactions)
  → React state update → re-render feed
```

### Recommended Project Structure

```
src/components/community/         ← all routes to 'community-feed' chunk
├── CommunityFeed.tsx             ← space feed page (lazy-loaded from App.tsx)
├── PostCard.tsx                  ← single post card with reactions
├── PostComposer.tsx              ← markdown editor + attachment uploader shell
├── CommentThread.tsx             ← flat comment list
├── ReactionBar.tsx               ← fixed 5-emoji reaction pills
├── SpaceList.tsx                 ← space directory (locked cards for gated)
├── SpaceLockedCard.tsx           ← D-08 upgrade CTA card
├── use-space-realtime.ts         ← per-space channel hook (mirrors use-roster-realtime.ts)
├── use-feed.ts                   ← cursor-paginated feed query hook
├── community-types.ts            ← typed interfaces for posts/comments/reactions/spaces
│
├── media/                        ← SEPARATE sub-chunk: 'community-media'
│   ├── CommunityMediaUploader.tsx  ← MuxUploader (Pro+ conditional) + image uploader
│   └── CommunityVideoPlayer.tsx    ← MuxPlayer (lazy import from /lazy)
│
├── mentions/                     ← SEPARATE sub-chunk: 'community-mentions'
│   └── MentionTypeahead.tsx      ← Fuse.js fuzzy @mention picker (Pro gate not needed)
│
└── admin/                        ← lands in 'admin-shell' chunk
    └── SpaceEditor.tsx           ← admin: create/edit spaces + tier visibility

supabase/functions/
├── mux-create-upload/            ← mints Mux direct-upload URL (tier-gated)
│   ├── index.ts
│   └── deno.json
├── mux-webhook/                  ← HMAC-verified, updates video_status + playback_id
│   ├── index.ts
│   └── deno.json
└── notify-community/             ← mention + reply notification fan-out
    ├── index.ts
    └── deno.json

supabase/migrations/
├── 20270720000001_p44_community_schema.sql       ← all 7 community tables + indexes
├── 20270720000002_p44_community_rls.sql          ← RLS policies + withOrgScope wrapper
├── 20270720000003_p44_community_media_bucket.sql ← community-media bucket + storage RLS
├── 20270720000004_p44_notification_community.sql ← widen CHECK constraints + seed config
└── 20270720000005_p44_community_secdef_rpcs.sql  ← SECDEF RPCs for admin space ops
```

### Pattern 1: DOMPurify Config for Community Markdown

**What:** Community post body allows markdown subset but strips `<img>` (attachments flow through uploader, D-10).
**When to use:** PostCard rendering + PostComposer preview.

```typescript
// Source: Phase 37 KBArticleView.tsx (VERIFIED: codebase read)
// FORK from helpdesk policy: add FORBID_TAGS for img to enforce D-10.
import DOMPurify from 'dompurify';

const COMMUNITY_ALLOWED_TAGS = [
  'h2', 'h3', 'h4',
  'p', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li',
  'a',
  'code', 'pre',
  'blockquote',
  'br',
];

const COMMUNITY_ALLOWED_ATTR = {
  'a': ['href', 'target', 'rel'],
};

export function sanitizeCommunityMarkdown(raw: string): string {
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: COMMUNITY_ALLOWED_TAGS,
    ALLOWED_ATTR: [],           // block all attrs globally ...
    // then force-add a-href via hook:
    FORBID_TAGS: ['img', 'script', 'iframe', 'style'],
    FORCE_BODY: false,
  });
}
// Post-sanitize: DOMPurify hook to enforce target=_blank + rel=noopener on links
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
    // Strip non-http(s) hrefs (javascript:, data:, etc.)
    const href = node.getAttribute('href') ?? '';
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      node.removeAttribute('href');
    }
  }
});
```

[VERIFIED: KBArticleView.tsx uses `USE_PROFILES: { html: true }` — community forks with explicit ALLOWED_TAGS to block img per D-10]

### Pattern 2: Per-Space Realtime Channel

**What:** Subscribe to `postgres_changes` on community tables filtered by space_id.
**When to use:** `use-space-realtime.ts` (analogous to `use-roster-realtime.ts`).

```typescript
// Source: Context7 /supabase/supabase-js + codebase use-roster-realtime.ts
// D-13: per-space channel only, no nested per-post channel.
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

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
        { event: 'INSERT', schema: 'public', table: 'community_comments' },
        () => onUpdate()   // space-scoped via join; filter on server to avoid over-broadcast
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

[VERIFIED: Context7 /supabase/supabase-js postgres_changes pattern; codebase use-roster-realtime.ts for subscribe/cleanup lifecycle]

### Pattern 3: Mux Direct Upload Flow

**What:** Browser never holds Mux API keys. Edge Fn mints one-time upload URL; browser uploads directly to Mux GCS endpoint via `MuxUploader`.
**When to use:** Video attach in PostComposer (Pro+Lifetime tier only per D-06).

```typescript
// supabase/functions/mux-create-upload/index.ts
// Source: Context7 /muxinc/mux-node-sdk
import Mux from 'npm:@mux/mux-node@14';

const mux = new Mux({
  tokenId: Deno.env.get('MUX_TOKEN_ID')!,
  tokenSecret: Deno.env.get('MUX_TOKEN_SECRET')!,
});

// Edge Fn handler (after tier check via tier_effective):
const upload = await mux.video.uploads.create({
  cors_origin: req.headers.get('origin') ?? '*',
  new_asset_settings: {
    playback_policies: ['public'],
    max_duration_seconds: 300, // D-05: 5 min cap
    passthrough: JSON.stringify({ user_id: userId, post_id: postId }),
  },
  timeout: 3600,
});

// Returns { url: upload.url, upload_id: upload.id }
// Client passes url to MuxUploader endpoint prop
```

```tsx
// src/components/community/media/CommunityMediaUploader.tsx
// Lazy-imported → lands in 'community-media' chunk, NOT 'community-feed'
import MuxUploader from '@mux/mux-uploader-react';

<MuxUploader
  endpoint={async () => {
    const res = await fetch('/functions/v1/mux-create-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const { url } = await res.json();
    return url;
  }}
  maxFileSize={500 * 1024} // D-05: 500 MB in kB
  dynamicChunkSize
  onSuccess={handleMuxSuccess}
  onUploadError={handleMuxError}
/>
```

[VERIFIED: Context7 /muxinc/mux-node-sdk direct upload API; Context7 /muxinc/elements MuxUploader React props]

### Pattern 4: Mux Webhook Signature Verification

**What:** Verifies authenticity of Mux webhook calls via `mux-signature` header.
**When to use:** `mux-webhook` Edge Fn.

```typescript
// Source: Context7 /muxinc/mux-node-sdk verifySignature
import Mux from 'npm:@mux/mux-node@14';

const mux = new Mux({ webhookSecret: Deno.env.get('MUX_WEBHOOK_SECRET')! });

Deno.serve(async (req) => {
  const body = await req.text();
  try {
    mux.webhooks.verifySignature(body, req.headers, Deno.env.get('MUX_WEBHOOK_SECRET')!);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const event = JSON.parse(body);
  if (event.type === 'video.asset.ready') {
    // UPDATE community_posts SET mux_playback_id = $1, video_status = 'ready'
    // WHERE mux_upload_id = $2
  }
  if (event.type === 'video.asset.errored') {
    // UPDATE community_posts SET video_status = 'rejected'
  }
  return new Response('ok');
});
```

[VERIFIED: Context7 /muxinc/mux-node-sdk webhooks.verifySignature + unwrap pattern]

### Pattern 5: Mux Auto-Thumbnail (D-07)

```html
<!-- No npm package needed — pure URL construction -->
<img
  src={`https://image.mux.com/${playbackId}/thumbnail.jpg?time=1`}
  alt="Video thumbnail"
  width="320"
  height="180"
  loading="lazy"
/>
```

[CITED: https://docs.mux.com/guides/get-images-from-a-video — thumbnail endpoint at `image.mux.com/{playbackId}/thumbnail.jpg?time=N`]

### Pattern 6: Notification Category Widening

CRITICAL: All four notification tables have CHECK constraints that must be widened atomically in one migration. Pattern per `feedback_planner_missed_status_enum_widening`:

```sql
-- 20270720000004_p44_notification_community.sql
BEGIN;

-- 1. Widen CHECK on all four tables simultaneously
ALTER TABLE public.notification_settings
  DROP CONSTRAINT IF EXISTS notification_settings_category_chk,
  ADD CONSTRAINT notification_settings_category_chk
    CHECK (category IN ('dose-reminders','ai-insights','clinic-alerts','billing','marketing',
                        'community-mentions','community-replies'));

ALTER TABLE public.notification_category_config
  DROP CONSTRAINT IF EXISTS notification_category_config_category_chk,
  ADD CONSTRAINT notification_category_config_category_chk
    CHECK (category IN ('dose-reminders','ai-insights','clinic-alerts','billing','marketing',
                        'community-mentions','community-replies'));

ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_category_chk,
  ADD CONSTRAINT user_notifications_category_chk
    CHECK (category IN ('dose-reminders','ai-insights','clinic-alerts','billing','marketing',
                        'community-mentions','community-replies'));

ALTER TABLE public.notification_dismissal_state
  DROP CONSTRAINT IF EXISTS notification_dismissal_state_category_chk,
  ADD CONSTRAINT notification_dismissal_state_category_chk
    CHECK (category IN ('dose-reminders','ai-insights','clinic-alerts','billing','marketing',
                        'community-mentions','community-replies'));

-- 2. Seed new category config rows
INSERT INTO public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
VALUES
  ('community-mentions', 20,   NULL, false, false, true, true),
  ('community-replies',  20,   NULL, false, false, false, true)
ON CONFLICT (category) DO UPDATE SET
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

COMMIT;
```

[VERIFIED: all four CHECK constraints confirmed by direct migration grep — all enumerate the same 5-category set; none include community variants]

### Pattern 7: Email Router Extension for Community Templates

The `EmailTemplate` union in `_shared/email-router.ts` must be extended. Pattern per Phase 37 + `feedback_planner_missed_status_enum_widening` — union extension + `subjectFor` switch arm + `renderTemplate` switch arm in the SAME commit:

```typescript
// Additions to email-router.ts EmailTemplate union
| 'community_mention'    // non-PHI → Resend
| 'community_reply'      // non-PHI → Resend
```

[VERIFIED: email-router.ts read at line 56–86; confirmed no community templates exist]

### Anti-Patterns to Avoid

- **Static import of @mux/mux-player-react in community-feed chunk.** Player is ~170 kB gz; static import defeats the 20 kB ceiling. Use `@mux/mux-player-react/lazy` + `React.lazy()` + separate `community-media` manualChunks rule in `vite.config.ts`.
- **Putting fuse.js in the community-feed base chunk.** Mention typeahead is a sub-feature; fuse.js (8 kB gz) belongs in a `community-mentions` sub-chunk, analogous to `helpdesk-macros`.
- **Wildcard Realtime channel across all spaces.** D-13 is explicit: per-space channel only. One channel per mounted space view.
- **Calling `tier_effective` via raw subscription tables.** Phase 43 normalizes this. Always read from `tier_effective` view.
- **Logging raw email addresses in Edge Fn logs.** Hash with sha256 before logging (Phase 25 PII pattern).
- **Mux API keys in browser code.** The create-upload URL must be minted server-side. The browser only ever touches the GCS upload URL.
- **Omitting `security_invoker = true` on new views.** Every new view referencing user data must use `WITH (security_invoker = true)` so caller-context RLS is applied.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mux video upload | Custom chunked upload to Mux | `@mux/mux-uploader-react` | TUS protocol, resume, chunk-size adaptation |
| Mux webhook signature | Custom HMAC verification | `mux.webhooks.verifySignature()` from `@mux/mux-node` | Handles timestamp tolerance, multiple sigs |
| Markdown rendering + sanitization | Custom HTML renderer | react-markdown + dompurify (already installed) | XSS vectors in user-generated HTML are numerous |
| Fuzzy @mention search | Custom trie/levenshtein | fuse.js (already installed) | Already used in MacroTypeahead; reuse the established pattern |
| Reaction idempotency | Application-level dedup | Postgres UNIQUE constraint + upsert | Concurrent toggles from multiple devices handled correctly |
| Cursor pagination | Offset pagination | Cursor on `(created_at, id)` | Stable under inserts; does not drift as new posts arrive |
| Storage signed URLs | Pre-signed CDN URLs | `supabase.storage.from('community-media').createSignedUrl(path, 3600)` | Bucket stays private; TTL enforced server-side |

**Key insight:** The Mux ecosystem (uploader + player + webhook SDK) covers every video concern that would otherwise require days of custom work. The cost is bundle weight, which is addressed by the chunk-split strategy.

---

## Common Pitfalls

### Pitfall 1: Mux Player Blocks the community-feed Budget

**What goes wrong:** A static `import MuxPlayer from '@mux/mux-player-react'` in any file under `src/components/community/` routes 170 kB gz into the community-feed chunk (instantly 8.5× the 20 kB ceiling).
**Why it happens:** Vite's manualChunks routes `/src/components/community/` → `community-feed`. All static dependencies of those files land in the same chunk.
**How to avoid:** Sub-chunks in `vite.config.ts` for `media/` and `mentions/` subdirectories, each using `React.lazy()` for their heavy deps. The media/ sub-chunk uses `@mux/mux-player-react/lazy` entry point for the player itself to enable viewport-deferred loading.
**Warning signs:** `assert-bundle-budget.sh` CI failure on `community-feed` chunk exceeds 20 kB.

### Pitfall 2: Notification Category CHECK Constraint Mismatch

**What goes wrong:** Phase 44 ships the community notification fan-out Edge Fn which calls `notification-send` with `category: 'community-mentions'`. The CHECK constraint on `notification_settings` rejects the INSERT → 500 error from notification-send.
**Why it happens:** The four notification tables all have identical CHECK constraints listing only the original 5 categories. A new category in ANY call that touches those tables causes a constraint violation.
**How to avoid:** The migration that widens the CHECK must be in Wave 0 (pre-schema), and must widen ALL FOUR tables in one migration. Seed `notification_category_config` in the SAME migration.
**Warning signs:** RLS integration test for community-mentions notification fails with Postgres constraint error.

### Pitfall 3: Mention Regex False Positives / Missed Mentions

**What goes wrong:** D-14 specifies `/@([a-z0-9_]{3,30})\b/i`. Edge cases:
- `@@user` → regex matches `@user` (the second @ is outside the capture group) → correct if the intent is to deduplicate double-@ typos; the regex does match `@user` within `@@user` — this is correct behavior per D-14.
- `@user.` → `\b` before the `.` is a word boundary because `.` is not a word char → correctly stops at the `.` → `user` is captured correctly.
- `@user123` → matches (digits allowed by `[a-z0-9_]`).
- Mention inside a code block → application code must strip code-fenced sections before applying the regex (DOMPurify's output does not include the backtick fences, only `<code>` tags — strip text content of `<code>` blocks before regex scan).

**How to avoid:** Server-side mention extraction function strips `<code>` block text before running the regex on the sanitized body.
**Warning signs:** Mention notifications firing for text inside code examples; or double-pings on `@@user` inputs.

### Pitfall 4: Supabase CLI v2.98.2 vs --import-map Flag

**What goes wrong:** Per `reference_supabase_functions_deploy_import_map_flag`, CLI v2.101.0+ silently ignores `--import-map`. The project currently runs v2.98.2 (the flag still works). New Edge Fns for Phase 44 should still ship with per-function `deno.json` (as the cancellation-accept-offer / stripe-webhook functions do) to avoid breaking when the CLI upgrades.
**How to avoid:** All three new Edge Fns (`mux-create-upload`, `mux-webhook`, `notify-community`) MUST include a `deno.json` with `imports` for their npm: deps.
**Warning signs:** Deploy succeeds but shared/* alias imports 404 at runtime.

### Pitfall 5: Realtime postgres_changes Filter vs. Space-Scoped Comments

**What goes wrong:** The per-space channel subscribes to `community_comments` changes without a direct `space_id` filter (comments table has `post_id` not `space_id`). All comment inserts for ANY space would fire the handler.
**Why it happens:** Supabase postgres_changes `filter` can only filter on columns of the target table. `community_comments` does not have `space_id` directly.
**How to avoid:** Two options: (A) Add `space_id` denormalized column to `community_comments` for filter efficiency; (B) Subscribe without filter and client-side ignore events for irrelevant posts. Option A adds a migration but reduces Realtime noise in multi-space deployments. Option B is simpler but noisy.
**Recommendation:** Use option A (denormalize `space_id` in `community_comments`) for filter correctness.

### Pitfall 6: Reaction Broadcast Echo Under Optimistic UI

**What goes wrong:** User clicks reaction → optimistic UI adds it → Realtime broadcasts the INSERT → component processes the broadcast and tries to add it again → duplicate UI.
**Why it happens:** supabase-js Realtime `postgres_changes` does NOT de-dup writes the current user made.
**How to avoid:** On reaction INSERT broadcast, check if the `user_id` in the payload matches the current user's session `user_id`. If it matches, skip the broadcast-driven update (the optimistic update already handled it). On any broadcast, re-fetch the aggregate count from the server to get the authoritative tally.

### Pitfall 7: Tailwind v4 Unlayered Reset Defeating Community CSS Variables

**What goes wrong:** `src/index.css` already defines `--color-community-post-bg` and `--color-community-reaction-bar` CSS variables (lines 214–216 and 304–306 per grep). These are set at the root level. If any community component adds bare custom CSS without `@layer base` wrapping, it will be unlayered and beat all Tailwind utilities.
**How to avoid:** Any new community-specific CSS in `index.css` MUST go inside `@layer base {}`. The two existing variables are already there — follow that precedent.

---

## Code Examples

### Storage Signed URL Pattern (community-media bucket)

```typescript
// Source: Phase 15 page-assets.ts pattern (VERIFIED: codebase read)
const COMMUNITY_MEDIA_BUCKET = 'community-media';
const SIGNED_URL_TTL = 3600; // 60 min per D-04

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

### Mux Thumbnail URL (D-07)

```typescript
// Source: Mux docs image.mux.com endpoint
// [CITED: https://docs.mux.com/guides/get-images-from-a-video]
export function muxThumbnailUrl(playbackId: string, timeSec = 1): string {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=${timeSec}&width=640&height=360`;
}
```

### tier_effective Gate in Edge Fn

```typescript
// Source: Phase 43 migration + project convention (VERIFIED: migration read)
// Check user is Pro or Lifetime before allowing video upload
const { data: tier } = await adminClient
  .from('tier_effective')
  .select('tier_label')
  .eq('user_id', userId)
  .single();

const isVideoAllowed = tier?.tier_label === 'pro' || tier?.tier_label === 'lifetime';
if (!isVideoAllowed) {
  return jsonError(403, 'VIDEO_TIER_REQUIRED');
}
```

### Cursor Pagination for Community Feed (D-12)

```typescript
// Source: standard Supabase cursor pattern (ASSUMED — no project-specific precedent found)
// Cursor: (created_at, id) DESC — stable under concurrent inserts
async function fetchFeedPage(spaceId: string, cursor?: { created_at: string; id: string }) {
  let query = supabase
    .from('community_posts')
    .select(`
      id, body, created_at, edited_at, deleted_at, author_id, space_id,
      mux_upload_id, mux_playback_id, video_status,
      community_post_media(path, display_order),
      profiles!author_id(display_name, avatar_url)
    `)
    .eq('space_id', spaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
    );
  }
  return query;
}
```

### Reaction Upsert (Idempotent Toggle, D-02/D-03)

```sql
-- SECDEF RPC: toggle_community_reaction
-- Uses INSERT … ON CONFLICT DO DELETE pattern (upsert → delete = toggle)
CREATE OR REPLACE FUNCTION public.toggle_community_reaction(
  p_target_type text,   -- 'post' | 'comment'
  p_target_id   uuid,
  p_emoji       text    -- one of: like, heart, target, fire, clap
)
RETURNS TABLE(emoji text, count bigint, reacted_by_me boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Attempt insert; if already exists, delete (toggle off)
  INSERT INTO public.community_reactions (user_id, target_type, target_id, emoji)
    VALUES (auth.uid(), p_target_type, p_target_id, p_emoji)
  ON CONFLICT (user_id, target_type, target_id, emoji) DO DELETE;

  -- Return aggregate counts
  RETURN QUERY
    SELECT r.emoji,
           count(*) AS count,
           bool_or(r.user_id = auth.uid()) AS reacted_by_me
    FROM public.community_reactions r
    WHERE r.target_type = p_target_type AND r.target_id = p_target_id
    GROUP BY r.emoji;
END;
$$;
```

[ASSUMED — no project precedent for INSERT ON CONFLICT DO DELETE; verify Postgres version compatibility. PostgreSQL 15+ supports this pattern; Supabase cloud uses PG15+.]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--import-map` flag for Edge Fn deps | Per-function `deno.json` with `imports` | CLI v2.101.0 (2026-05-22) | New functions MUST use deno.json; flag silently ignored on upgrade |
| `@mux/mux-player-react` v2 (~238 kB gz) | v3 lazy entry point: `@mux/mux-player-react/lazy` | v3.x | Significant; v2 bundlephobia shows 236 kB gz; v3 lazy import defers load to viewport |
| Mux webhooks: manual HMAC | `mux.webhooks.verifySignature()` | @mux/mux-node v7+ | Timestamp tolerance, multi-sig headers handled automatically |
| KBArticleView DOMPurify `USE_PROFILES: { html: true }` | Community: explicit ALLOWED_TAGS + FORBID_TAGS for img | Phase 44 | Stricter for community UGC; helpdesk uses looser profile for staff-authored content |

**Deprecated / outdated:**
- `mux.webhooks.unwrap()` in Next.js adapter contexts works, but for Deno Edge Fns prefer `mux.webhooks.verifySignature()` then `JSON.parse(body)` manually.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@mux/mux-player-react@3.13.0` gz is ~170 kB (confirmed for v2.5 at 236 kB; v3 reported 170 kB by Mux blog) | Standard Stack / Pitfall 1 | If smaller, community-media sub-chunk ceiling could be relaxed; if larger, more aggressive code-splitting needed |
| A2 | INSERT … ON CONFLICT DO DELETE reaction-toggle pattern is supported on Supabase PG15+ | Code Examples | If not available, use explicit SELECT + conditional INSERT/DELETE in SECDEF RPC |
| A3 | Cursor pagination with compound OR filter syntax (`created_at.lt.X,and(...)`) is correct PostgREST filter syntax | Code Examples | If syntax differs, use RPC-based pagination instead |
| A4 | `community_spaces.org_id` RLS pattern mirrors Phase 28 `withOrgScope` — non-org-members cannot probe org-private spaces via Realtime or direct query | Architecture | If org-scoping is not applied correctly, cross-tenant space visibility is possible (critical security issue) |
| A5 | Draft autosave 500 ms debounce matches CONTEXT.md suggestion and is reasonable for 5k-char textarea | Code Examples | No risk; easily adjustable |

---

## Open Questions (RESOLVED)

1. **Mention regex inside code blocks**
   - What we know: D-14 provides `/@([a-z0-9_]{3,30})\b/i`; DOMPurify converts backtick fences to `<code>` HTML.
   - RESOLVED: Run extraction on RAW markdown (pre-DOMPurify); strip inline `` `...` `` and fenced ```` ```...``` ```` blocks before applying the regex. This avoids false mentions in code examples and is what `src/lib/community/mention-parse.ts` ships in plan 44-03. Verified against unit fixtures in `tests/unit/community-mention-parse.test.ts`.

2. **notify-community Edge Fn: extend notification-send or new Fn?**
   - What we know: `notification-send` accepts `{ user_id, category, payload, channelHint? }` with service-role bearer. It already handles in-app + email dispatch.
   - RESOLVED: NEW Edge Fn `notify-community` (plan 44-05) that iterates over `community_post_mentions` / `community_comment_mentions` rows and calls `notification-send` once per mentioned user. Keeps `notification-send` as a single-user primitive; isolates community-fan-out logic. Dual-auth (service-role OR user JWT with `sub` self-check) ships in 44-05.

3. **community_spaces visibility_tier column type**
   - What we know: D-08 / D-06 need to gate spaces by tier (Free/Pro/Lifetime). Phase 43 `tier_effective.tier_label` uses values `'free' | 'trial' | 'pro' | 'lifetime'`.
   - RESOLVED: `text CHECK (min_tier IN ('free','pro','lifetime'))` to match `tier_effective.tier_label`. Trial users are treated as Pro for access decisions (consistent with Claude's Discretion in 44-CONTEXT; trial = full feature evaluation). `'trial'` is NOT an allowed `min_tier` value because admins should not configure a "trial-only" space — Pro is the lowest gated tier.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend build + npm | ✓ | v22.18.0 | — |
| npm | Package install | ✓ | 10.9.3 | — |
| Deno (at `~/.deno/bin/deno`) | Edge Fn test sweeps | ✓ | 2.7.14 | — |
| Supabase CLI | Migration push + Fn deploy | ✓ | v2.98.2 | — |
| @mux/mux-uploader-react | Video upload UI | ✗ (not yet in package.json) | 1.5.0 available | — |
| @mux/mux-player-react | Video playback UI | ✗ (not yet in package.json) | 3.13.0 available | — |
| @mux/mux-node | Edge Fn Mux API calls | ✗ (not yet installed; use npm: specifier in Deno) | 14.1.0 available | — |
| Mux API credentials (MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_WEBHOOK_SECRET) | mux-create-upload + mux-webhook Edge Fns | Unknown — must be set as Supabase Function Secrets | — | HUMAN gate: admin sets secrets before deploy |

**Missing dependencies with no fallback:**
- Mux API credentials (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`) — require human setup in Supabase dashboard or via `supabase secrets set`. Wave 0 HUMAN-UAT signal required.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 (unit/integration) + Playwright 1.59.1 (e2e) |
| Config file | `vitest-e2e.config.ts` for RLS suites; `vitest.config.*` for unit |
| Quick run command | `npx vitest run tests/rls/community-*.test.ts -x` |
| Full suite command | `npm run test:unit && npm run test:e2e:rls` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMMUNITY-01 | Cross-tenant: User A cannot read User B's posts in org-private space | RLS integration | `npx vitest run tests/rls/community-spaces-rls.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-01 | Soft-deleted post renders `[deleted]` tombstone | unit | `npx vitest run tests/unit/community-post-tombstone.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-02 | Reaction toggle is idempotent (double-click = remove) | RLS integration | `npx vitest run tests/rls/community-reactions-rls.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-03 | @mention fires notification_settings check before sending | integration | `npx vitest run tests/integration/community-mention-notification.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-04 | Mux create-upload 403s for Free tier user | integration | `npx vitest run tests/integration/mux-tier-gate.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-04 | Image count cap enforced (11th image rejected) | unit | `npx vitest run tests/unit/community-image-cap.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-05 | Bundle: community-feed chunk ≤20 kB gz | build | `bash scripts/assert-bundle-budget.sh dist/assets` | ✅ (CI script exists; wave-0 skip until chunk emitted) |
| COMMUNITY-06 | Free user in Pro-only space sees locked card (not post body) | RLS integration | `npx vitest run tests/rls/community-tier-gating-rls.test.ts -x` | ❌ Wave 0 |
| COMMUNITY-06 | Non-org user cannot probe org-private space existence | RLS integration | `npx vitest run tests/rls/community-spaces-rls.test.ts -x` | ❌ Wave 0 (same file as COMMUNITY-01) |

### Sampling Rate

- **Per task commit:** `npm run test:e2e:rls` (vitest-e2e.config.ts — runs all RLS suites)
- **Per wave merge:** `npm run test:unit && npm run test:e2e:rls && bash scripts/assert-bundle-budget.sh dist/assets`
- **Phase gate:** Full suite green + bundle ceiling confirmed before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/rls/community-spaces-rls.test.ts` — covers COMMUNITY-01 (cross-tenant) + COMMUNITY-06 (org-private)
- [ ] `tests/rls/community-reactions-rls.test.ts` — covers COMMUNITY-02 idempotency
- [ ] `tests/rls/community-tier-gating-rls.test.ts` — covers COMMUNITY-06 Free/Pro gate
- [ ] `tests/integration/community-mention-notification.test.ts` — covers COMMUNITY-03
- [ ] `tests/integration/mux-tier-gate.test.ts` — covers COMMUNITY-04 (403 for Free tier)
- [ ] `tests/unit/community-post-tombstone.test.ts` — covers COMMUNITY-01 soft-delete render
- [ ] `tests/unit/community-image-cap.test.ts` — covers COMMUNITY-04 10-image cap

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT; all community endpoints require authenticated user |
| V3 Session Management | no | Handled by Supabase auth layer; no community-specific sessions |
| V4 Access Control | yes | RLS on all 7 community tables; `tier_effective` for tier gating; `org_id` for org-private spaces; is_staff() for admin ops |
| V5 Input Validation | yes | DOMPurify (community markdown); 5,000-char DB CHECK; MIME + size CHECK on storage uploads; emoji CHECK constraint on reactions |
| V6 Cryptography | yes | Mux webhook: `mux.webhooks.verifySignature()` (never hand-roll); Storage signed URLs (Supabase-managed HMAC) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via markdown injection | Tampering | DOMPurify with explicit ALLOWED_TAGS; FORBID_TAGS for img; ALLOWED_ATTR enforces rel=noopener on links |
| Cross-tenant space/post read | Elevation of Privilege | RLS on community_spaces (org_id check); tier_effective read-time enforcement; never cache tier at insert |
| SSRF via user-supplied link href | Tampering | DOMPurify strips non-http/https hrefs; no server-side fetch of user links |
| Replay attack on Mux webhook | Spoofing | `verifySignature()` checks timestamp tolerance (rejects old webhooks) |
| Mention spam (notification flood) | Denial of Service | `notification_settings.daily_cap` (set to 20 for community-mentions per migration above) |
| Mass video upload by Free tier | Denial of Service | Edge Fn tier gate + Mux max_duration_seconds + client-side file size guard |
| Storage enumeration (list bucket) | Information Disclosure | community-media bucket `public=false`; SELECT policy requires authenticated + owns the object (author_id check) |
| Stored image XSS via SVG | Tampering | `community-media` bucket MIME whitelist: image/jpeg, image/png, image/webp only. No SVG (matches page-assets pattern). |

---

## Sources

### Primary (HIGH confidence)

- `/supabase/supabase-js` (Context7) — Realtime channel postgres_changes API
- `/muxinc/elements` (Context7) — MuxUploader + MuxPlayer React APIs, lazy loading
- `/muxinc/mux-node-sdk` (Context7) — direct upload create, webhook verifySignature
- `src/helpdesk/KBArticleView.tsx` (codebase) — DOMPurify config baseline
- `src/components/clinic/roster/use-roster-realtime.ts` (codebase) — Realtime lifecycle pattern
- `src/helpdesk/MacroTypeahead.tsx` (codebase) — Fuse.js sub-chunk pattern
- `supabase/migrations/20270704000001_notification_settings.sql` (codebase) — CHECK constraint content confirmed
- `supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql` (codebase) — tier_effective columns confirmed
- `supabase/functions/_shared/email-router.ts` (codebase) — EmailTemplate union confirmed; no community templates
- `leanshot/vite.config.ts` (codebase) — manualChunks community-feed routing confirmed at line 194
- `leanshot/scripts/assert-bundle-budget.sh` (codebase) — community-feed ceiling 20 kB confirmed at line 46

### Secondary (MEDIUM confidence)

- Bundlephobia API: `@mux/mux-uploader-react@1.5.0` → 16,564 bytes gz (direct API call)
- Mux blog: player is ~170 kB gz (search-verified: https://www.mux.com/blog/mux-player-lazy-loading-with-blurhash)
- npm registry: `@mux/mux-uploader-react` 1.5.0, `@mux/mux-player-react` 3.13.0, `@mux/mux-node` 14.1.0 (direct npm view commands)

### Tertiary (LOW confidence)

- Mux thumbnail URL endpoint `image.mux.com/{playbackId}/thumbnail.jpg?time=N` — known pattern, not re-verified via Context7 this session.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing deps verified in package.json; new Mux deps verified via npm registry; bundle sizes verified via bundlephobia API (uploader) and Mux blog (player)
- Architecture: HIGH — directly derived from codebase patterns (use-roster-realtime, page-assets, notification-send)
- Pitfalls: HIGH — notification category gap is a hard-verified blocker (grep confirmed absence of community category in all 4 CHECK constraints)

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 (Mux API shape is stable; supabase-js Realtime API is stable)

---

## RESEARCH COMPLETE
