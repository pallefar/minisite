---
phase: 44
plan: "07"
subsystem: community-feed
tags: [composer, mention-typeahead, fuse.js, draft-autosave, notify-community, community-mentions-chunk]
dependency_graph:
  requires:
    - "44-03 (mention-parse.ts, dompurify-config.ts, community-types.ts)"
    - "44-05 (notify-community Edge Fn — dual-auth service-role OR user JWT)"
  provides:
    - "CommunityPostComposer — post create/edit with draft autosave + mention resolve + notify"
    - "CommunityCommentComposer — comment create/edit with mention resolve + reply + mention notify"
    - "MentionTypeahead — lazy Fuse.js @-handle picker under mentions/ sub-chunk path"
  affects:
    - "44-09 (vite.config.ts manualChunks keys on mentions/ path → community-mentions chunk)"
    - "44-10 (HUMAN-UAT signal: type @handle → suggestion appears → mention row + email)"
tech_stack:
  added: []
  patterns:
    - "React.lazy() lazy import for chunk isolation (MacroTypeahead analog)"
    - "localStorage 500ms debounce autosave with clear-on-submit (D-11)"
    - "Cancelled-fetch guard pattern (let cancelled = false)"
    - "onConflict upsert via Supabase (PK idempotency for mention spam prevention)"
    - "Best-effort fetch for Edge Fn notifications (.catch(() => {}) — post/comment saved regardless)"
key_files:
  created:
    - "leanshot/src/components/community/mentions/MentionTypeahead.tsx"
    - "leanshot/src/components/community/CommunityPostComposer.tsx"
    - "leanshot/src/components/community/CommunityCommentComposer.tsx"
  modified: []
decisions:
  - "MentionTypeahead uses inline useDebounce hook (300ms) per PATTERNS.md rather than a shared hook, keeping chunk self-contained"
  - "notify-community calls are best-effort (.catch) — post/comment insert is the source of truth; notification delivery is non-blocking"
  - "void userId in onSelect callback — userId plumbed to onSelect signature for future dedup but not used in mention text insertion (handle is the DB key)"
  - "Comment draft key uses postId not spaceId — scoped to the post thread to avoid cross-post draft collisions"
metrics:
  duration_minutes: ~25
  completed_date: "2026-05-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 44 Plan 07: PostComposer + CommentComposer + lazy MentionTypeahead Summary

**One-liner:** Lazy Fuse.js MentionTypeahead under `mentions/` sub-chunk path + PostComposer with 5000-char cap / 500ms localStorage draft / mention upsert / notify-community JWT fire + CommentComposer with reply+mention dual fan-out.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Ship MentionTypeahead under mentions/ sub-chunk path | e79cb96 | `src/components/community/mentions/MentionTypeahead.tsx` |
| 2 | Ship CommunityPostComposer + CommunityCommentComposer | c78f432 | `src/components/community/CommunityPostComposer.tsx`, `src/components/community/CommunityCommentComposer.tsx` |

## Component Summary

### MentionTypeahead (`mentions/MentionTypeahead.tsx`)
- Path `src/components/community/mentions/` — critical for 44-09's vite.config.ts `manualChunks: { 'community-mentions': /mentions\// }` rule
- Top-of-file comment with `community-mentions` literal as reviewer cue
- Static `import Fuse from 'fuse.js'` — Fuse bytes land in this chunk since this file is lazy-imported by composers
- 300ms `useDebounce` inline hook on query prop
- `useEffect` with cancelled-fetch guard → `supabase.from('profiles').select('id, handle, display_name').ilike('handle', ...%).limit(8)`
- `useMemo` Fuse instance: keys `['handle','display_name']`, threshold `0.4`
- ARIA: `role="listbox"`, `role="option"`, `aria-selected="false"`, `aria-label="Mention suggestions"`

### CommunityPostComposer (`CommunityPostComposer.tsx`)
- Draft autosave: `community_draft_${spaceId}_${userId}` key, 500ms debounce, restored on mount, cleared on successful insert
- 5000-char client cap (D-11): character counter with `aria-live="polite"`, submit disabled when over limit
- Edit-forever mode (D-15): `editingPost` prop — updates `body` + `edited_at`, bypasses draft load
- `@` keystroke trigger → non-null `mentionQuery` state → shows `<Suspense><MentionTypeahead></Suspense>`
- Submit: `parseMentions(body)` → SELECT profiles → `upsert community_post_mentions { onConflict: 'post_id,user_id' }` → notify-community (kind='mention') with session JWT
- Markdown preview tab via `sanitizeCommunityMarkdown(body)` + `dangerouslySetInnerHTML` (T-44-05 XSS defense)

### CommunityCommentComposer (`CommunityCommentComposer.tsx`)
- Mirrors PostComposer structure; draft key: `community_comment_draft_${postId}_${userId}`
- `community_comment_mentions` upsert `{ onConflict: 'comment_id,user_id' }`
- Fires **two** notify-community calls on non-edit submit: `kind='mention'` (per mentioned handle) + `kind='reply'` (notify post author; Plan 44-05 skips self-reply)
- No image attach (images are post-only per D-04)

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met for both tasks.

## Threat Surface Scan

No new network endpoints or auth paths beyond what the plan's `<threat_model>` declares:
- `community_post_mentions` + `community_comment_mentions` upsert: covered by T-44-06 (PK idempotency)
- `notify-community` fetch with user JWT: covered by T-44-06, T-44-05 trust boundary declaration in plan
- Preview tab `dangerouslySetInnerHTML`: covered by T-44-05 (sanitizeCommunityMarkdown chokepoint)

## Self-Check

- [x] `src/components/community/mentions/MentionTypeahead.tsx` exists
- [x] `src/components/community/CommunityPostComposer.tsx` exists
- [x] `src/components/community/CommunityCommentComposer.tsx` exists
- [x] `tsc --noEmit` exit code 0 (clean, no errors)
- [x] Commit e79cb96 exists (Task 1)
- [x] Commit c78f432 exists (Task 2)
- [x] `community-mentions` literal in MentionTypeahead.tsx (chunk routing cue)
- [x] `import Fuse from 'fuse.js'` in MentionTypeahead.tsx
- [x] `role="listbox"` + `aria-selected` in MentionTypeahead.tsx
- [x] `threshold: 0.4` in MentionTypeahead.tsx
- [x] `let cancelled = false` in MentionTypeahead.tsx
- [x] `community_draft_` in CommunityPostComposer.tsx
- [x] `parseMentions` in CommunityPostComposer.tsx
- [x] `community_post_mentions` in CommunityPostComposer.tsx
- [x] `notify-community` in CommunityPostComposer.tsx
- [x] `5000` in CommunityPostComposer.tsx
- [x] `lazy(` with `./mentions/MentionTypeahead` in CommunityPostComposer.tsx
- [x] `kind: 'reply'` in CommunityCommentComposer.tsx
- [x] `community_comment_mentions` in CommunityCommentComposer.tsx
- [x] `onConflict: 'post_id,user_id'` in CommunityPostComposer.tsx
- [x] `onConflict: 'comment_id,user_id'` in CommunityCommentComposer.tsx

## Self-Check: PASSED
