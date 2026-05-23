---
phase: 44
plan: "08"
subsystem: community-media
tags: [mux, video, image-upload, bundle-split, tier-gate, wave-1]
dependency_graph:
  requires: [44-03]
  provides: [CommunityImageUploader, CommunityMediaUploader, CommunityVideoPlayer, CommunityPostMediaStrip]
  affects: [44-06, 44-09, 44-10]
tech_stack:
  added:
    - "@mux/mux-player-react@^3.13.0 (lazy entry — community-media chunk)"
    - "@mux/mux-uploader-react@^1.5.0 (community-media chunk)"
  patterns:
    - "React.lazy + Suspense for click-to-play Mux player"
    - "assertImageCap + MIME whitelist client-side gate (defense in depth with DB trigger)"
    - "isVideoAllowed(tier) early-return null pattern (T-44-02)"
    - "useRef before early return (React Rules of Hooks compliance)"
key_files:
  created:
    - leanshot/src/components/community/media/CommunityImageUploader.tsx
    - leanshot/src/components/community/media/CommunityMediaUploader.tsx
    - leanshot/src/components/community/media/CommunityVideoPlayer.tsx
    - leanshot/src/components/community/CommunityPostMediaStrip.tsx
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/src/lib/community/community-storage.ts
decisions:
  - "CommunityVideoPlayer imports from @mux/mux-player-react/lazy (not bare) to defer ~170 kB gz to viewport"
  - "CommunityPostMediaStrip stays in community/ (community-feed chunk); only the Mux player import is lazy-routed to community-media"
  - "Export COMMUNITY_MEDIA_MIMES + COMMUNITY_MEDIA_MAX_BYTES from community-storage.ts to share validation constants with ImageUploader"
  - "useRef called before isVideoAllowed early return in CommunityMediaUploader to comply with React Rules of Hooks"
  - "CommunityPostWithMedia intersection type extends CommunityPost with community_post_media relation"
metrics:
  duration: "270 seconds"
  completed_date: "2026-05-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 3
---

# Phase 44 Plan 08: Community Media Subsystem Summary

**One-liner:** Mux direct-upload + adaptive HLS player + image uploader with 10-image cap/MIME whitelist, routed to the `community-media` bundle chunk via the `media/` path, with `CommunityPostMediaStrip` replacing the 44-06 null-rendering stub.

---

## What Was Built

### 1. CommunityImageUploader (`src/components/community/media/CommunityImageUploader.tsx`)

Multi-file image uploader enforcing:
- **T-44-05 (SVG-XSS defense):** `accept="image/jpeg,image/png,image/webp"` attribute + `COMMUNITY_MEDIA_MIMES` set filter — no SVG allowed at any layer.
- **D-04 (10-image cap):** `assertImageCap(existingMediaCount + selectedCount)` client-side gate before any upload. DB trigger in 44-01 is the authoritative server-side gate.
- **10 MB per-file size limit** matching `COMMUNITY_MEDIA_MAX_BYTES`.
- Uploads via `uploadCommunityMedia()` from community-storage.ts, then inserts into `community_post_media` with `display_order` computed from `existingMediaCount + 1`.
- Preview thumbnails via `URL.createObjectURL`; alt text "Image preview N"; aria-label on the list container.

### 2. CommunityMediaUploader (`src/components/community/media/CommunityMediaUploader.tsx`)

Mux direct-upload wrapper:
- **D-06 tier gate:** `isVideoAllowed(currentTier)` — returns null for Free users. `useRef` is called before the early return to comply with React Rules of Hooks.
- Fetches upload URL from `mux-create-upload` Edge Fn (Plan 44-04) with user JWT; stashes `upload_id` in a ref for the `onSuccess` callback.
- `maxFileSize={500 * 1024}` (D-05: 500 MB in Mux SDK KB units) + `dynamicChunkSize`.
- Error handling for `VIDEO_TIER_REQUIRED` 403 from Edge Fn.

### 3. CommunityVideoPlayer (`src/components/community/media/CommunityVideoPlayer.tsx`)

Mux adaptive HLS player:
- **CRITICAL:** imports `MuxPlayer from '@mux/mux-player-react/lazy'` — NOT the bare `@mux/mux-player-react` entry. The `/lazy` entry point defers the ~170 kB gz player to viewport intersection via Mux's blurhash placeholder (RESEARCH Pitfall 1 mitigation).
- Renders `streamType="on-demand"` with a Mux thumbnail poster URL at the configured `posterTime` (default 1 second per D-07).
- Container has `aria-label="Community video player"`.

### 4. CommunityPostMediaStrip (`src/components/community/CommunityPostMediaStrip.tsx`)

**Replaces the 44-06 null-rendering stub** with the full implementation:
- **Image carousel:** sorted by `display_order`, `<img loading="lazy" width="256" height="256">`, signed URLs from `mediaSignedUrls` prop, accessible `aria-label` on the list.
- **Video — ready state:** thumbnail `<img>` at `image.mux.com/{playbackId}/thumbnail.jpg?time=1` (D-07) with a play button overlay. On click: `showPlayer=true` → `<Suspense><CommunityVideoPlayer /></Suspense>` — the React.lazy import routes the 170 kB player to the `community-media` chunk.
- **Video — processing:** skeleton + "Video is processing" text (D-07 status badge).
- **Video — rejected:** error pill "Video could not be processed".
- Exports both named export `CommunityPostMediaStrip` and `export default` to match the 44-06 stub's export shape.

---

## Bundle-Isolation Strategy

All three uploader/player components live under `src/components/community/media/`. Plan 44-09's `vite.config.ts` manualChunks rule keys on this path to route their code — including `@mux/mux-player-react` (~170 kB gz) and `@mux/mux-uploader-react` (~16 kB gz) — into the `community-media` chunk. The `community-feed` chunk (containing `CommunityPostMediaStrip`, `CommunityPost`, `CommunityFeed`, etc.) stays within the 20 kB gz ceiling.

The CommunityVideoPlayer is additionally wrapped in `React.lazy()` inside CommunityPostMediaStrip, so the player bytes are deferred until the user clicks the video thumbnail — never loaded on initial feed render.

---

## CommunityPostMediaStrip Stub-to-Real Replacement

**Plan 44-06** ships `src/components/community/CommunityPostMediaStrip.tsx` as a null-rendering stub with the comment `// PHASE-44-06 STUB` and no runtime deps, so 44-06 compiles cleanly in parallel with 44-08 during Wave 1.

**This plan (44-08)** ships the real implementation at the same path with the owner comment `// Owner: Plan 44-08. Replaces 44-06 STUB.` The prop signature is identical in both worktrees (the cross-plan contract):

```ts
export interface CommunityPostMediaStripProps {
  post: CommunityPostWithMedia;
  mediaSignedUrls: Record<string, string>;
}
```

**Merge-time resolution:** The orchestrator merges 44-06 first (stub), then merges 44-08 with:
```bash
git checkout --ours leanshot/src/components/community/CommunityPostMediaStrip.tsx
```
This keeps the 44-08 real implementation. The file collision is EXPECTED and documented in both plans' SUMMARYs. CommunityPost.tsx (44-06) imports `{ CommunityPostMediaStrip }` from the same path and is unaffected by the swap — the import resolves identically before and after the merge.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Export] Export COMMUNITY_MEDIA_MIMES and COMMUNITY_MEDIA_MAX_BYTES**
- **Found during:** Task 1
- **Issue:** Plan referenced "re-import COMMUNITY_MEDIA_MIMES from community-storage.ts" but both `COMMUNITY_MEDIA_MIMES` and `COMMUNITY_MEDIA_MAX_BYTES` were private `const` declarations — not exported.
- **Fix:** Added `export` keyword to both constants in `src/lib/community/community-storage.ts`. Also removed a duplicate `COMMUNITY_MEDIA_MAX_BYTES` declaration created during the edit.
- **Files modified:** `leanshot/src/lib/community/community-storage.ts`
- **Commit:** 6994651

**2. [Rule 1 - Bug] useRef before early return in CommunityMediaUploader**
- **Found during:** Task 2 authoring
- **Issue:** Initial draft called `useRef` after the `isVideoAllowed` early return, violating React's Rules of Hooks. The eslint-plugin-react-hooks would flag this as an error.
- **Fix:** Moved `useRef` call above the `isVideoAllowed` early return, with a comment explaining the ordering requirement.
- **Files modified:** `leanshot/src/components/community/media/CommunityMediaUploader.tsx`
- **Commit:** ab0fecb

**3. [Rule 2 - Type Safety] CommunityPostWithMedia intersection type**
- **Found during:** Task 1
- **Issue:** `CommunityPost` in community-types.ts does not include `community_post_media` (it's a joined relation from the Supabase query). Using `post: CommunityPost` directly would not allow accessing `post.community_post_media.length`.
- **Fix:** Defined `CommunityPostWithMedia = CommunityPost & { community_post_media: CommunityPostMedia[] }` locally in CommunityPostMediaStrip.tsx and used it as the prop type. This accurately models the actual query result shape without modifying the locked `CommunityPost` base type.
- **Files modified:** `leanshot/src/components/community/CommunityPostMediaStrip.tsx`

---

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond what is declared in the plan's threat model. The `mux-create-upload` Edge Fn endpoint is referenced (not defined here — Plan 44-04 owns it). All reads from `community_post_media` use the signed URL pattern already in Plan 44-01's RLS.

---

## Self-Check

Files created:
- `leanshot/src/components/community/media/CommunityImageUploader.tsx` — FOUND
- `leanshot/src/components/community/media/CommunityMediaUploader.tsx` — FOUND
- `leanshot/src/components/community/media/CommunityVideoPlayer.tsx` — FOUND
- `leanshot/src/components/community/CommunityPostMediaStrip.tsx` — FOUND

Commits:
- `6994651` feat(44-08-01) — FOUND
- `ab0fecb` feat(44-08-02) — FOUND

tsc --noEmit: 0 errors.

## Self-Check: PASSED
