---
phase: 44
plan: "06"
subsystem: community-feed
tags: [react, community, cursor-pagination, reactions, markdown, sanitization, stub]
dependency_graph:
  requires: [44-03]
  provides: [CommunityPost, CommunityFeed, CommunityCommentThread, ReactionBar, useFeed, CommunityPostMediaStrip-stub]
  affects: [44-07, 44-08, 44-09]
tech_stack:
  added: []
  patterns:
    - cursor-pagination on (created_at, id) DESC
    - sanitizeCommunityMarkdown render trust boundary
    - optimistic-UI reaction toggle with own-write echo dedup
    - cancelled-fetch guard
    - stub-for-parallel-execution (CommunityPostMediaStrip)
    - bulk reaction fetch post-load
    - 50-min signed URL cache with TTL refresh
key_files:
  created:
    - leanshot/src/components/community/CommunityPost.tsx
    - leanshot/src/components/community/CommunityFeed.tsx
    - leanshot/src/components/community/CommunityCommentThread.tsx
    - leanshot/src/components/community/ReactionBar.tsx
    - leanshot/src/components/community/use-feed.ts
    - leanshot/src/components/community/CommunityPostMediaStrip.tsx
  modified: []
decisions:
  - "CommunityPostMediaStrip ships as a null-render stub so 44-06 and 44-08 can execute in parallel Wave 1; orchestrator resolves file collision at merge via git checkout --ours on the 44-08 worktree"
  - "Reactions fetched via a single bulk query post-load (option B) rather than inline join (option A) to avoid over-fetching"
  - "refreshNonce prop added to CommunityFeed as the 44-09 Realtime entry seam"
  - "ReactionBar uses optimistic local delta state to handle own-write echo dedup per Research Pitfall 6"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-23T06:39:50Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
---

# Phase 44 Plan 06: Community Feed Read-Side Components Summary

## One-liner

Cursor-paginated community feed (CommunityPost + CommunityFeed + CommentThread + ReactionBar + useFeed) with sanitized markdown render, optimistic reaction toggle via SECDEF RPC, and a null-render CommunityPostMediaStrip stub for parallel 44-08 execution.

## What Was Built

### Task 1: CommunityPost + CommunityCommentThread + ReactionBar + CommunityPostMediaStrip stub

**CommunityPost.tsx** — Single post card:
- Renders sanitized markdown via `sanitizeCommunityMarkdown` (from `@/lib/community/dompurify-config`) + ReactMarkdown + remarkGfm + rehypeRaw (T-44-05 XSS defense)
- Soft-delete tombstone: renders `<em>[deleted]</em>` when `deleted_at` is non-null (D-15)
- `(edited)` marker when `edited_at` is non-null (D-15)
- Delegates media to `CommunityPostMediaStrip` (stub; 44-08 replaces at merge time)
- Edit/Delete controls visible only when `post.author_id === currentUserId && !isDeleted`
- `role="article"` + `aria-label` for accessibility

**ReactionBar.tsx** — 5-emoji reaction pill row:
- Fixed emoji set `['like','heart','target','fire','clap']` per D-03
- Native OS emoji glyphs (👍 ❤️ 🎯 🔥 👏) per Claude's Discretion (gamification precedent)
- Optimistic UI: flips local `optimisticDelta` immediately, calls `supabase.rpc('toggle_community_reaction', ...)`, reverts on error
- Own-write echo dedup per Research Pitfall 6: delta cleared on RPC success so Realtime broadcast does not double-apply
- `aria-pressed` on each pill; `role="group"` on container

**CommunityCommentThread.tsx** — Flat 1-level comment list (D-01):
- Fetches `community_comments WHERE post_id = $postId ORDER BY created_at ASC`; cancelled-fetch guard
- Per-comment `sanitizeCommunityMarkdown` for render trust boundary (T-44-05)
- Deleted comment tombstone (D-15)
- Per-comment ReactionBar with `targetType='comment'`
- Composer slot: renders `{children}` or `<CommentComposerPlaceholder />` for 44-07 to fill
- `role="list"` + `role="listitem"` on comments

**CommunityPostMediaStrip.tsx** — Stub for parallel execution:
- Contains comment `// PHASE-44-06 STUB. 44-08 replaces this file with the real implementation.`
- Renders null; zero runtime deps; zero `@mux/*` imports
- Exports both named (`CommunityPostMediaStrip`) and default export
- Prop signature matches 44-08's final contract: `{ post: CommunityPost; mediaSignedUrls: Record<string, string> }`

### Task 2: CommunityFeed + use-feed cursor-pagination hook

**use-feed.ts** — `useFeed(spaceId)` hook:
- `PAGE_SIZE = 20`
- Cursor pagination on `(created_at, id)` DESC per D-12
- `.is('deleted_at', null)` soft-delete filter
- Joins `community_post_media(path, display_order)` for signed URL resolution
- Cancelled-fetch guard (`let cancelled = false; return () => { cancelled = true; }`) in `useEffect`
- Returns `{ posts, loading, error, loadMore, hasMore }`

**CommunityFeed.tsx** — `CommunityFeed` component:
- Calls `useFeed(spaceId)`
- Bulk reaction fetch via `from('community_reactions').select().eq('target_type','post').in('target_id', postIds)` after posts load
- Signed URL resolution via `getCommunityMediaSignedUrl` with 50-min TTL cache (ref-cached, refreshed if `> 50 min` old)
- `refreshNonce?: number` prop — 44-09 entry seam for Realtime-triggered re-fetch
- Empty state: `<EmptyState title="No posts yet">` when `!loading && posts.length === 0`
- Load More button with `aria-label="Load more posts"` when `hasMore`
- `role="list"` on post list, `aria-label="Community feed"` on section

## Deviations from Plan

None — plan executed exactly as written. The `CommunityCommentThread` file name in the plan's frontmatter uses `CommunityCommentThread.tsx` (the PLAN.md `files_modified` and task names are consistent); executed accordingly.

## Stub-for-Parallel-Execution Pattern

`CommunityPostMediaStrip.tsx` ships as a null-renderer stub so Plans 44-06 and 44-08 can run in parallel in Wave 1 without a TypeScript compile race. The prop signature (`post: CommunityPost; mediaSignedUrls: Record<string, string>`) is agreed between both plans. At merge time the orchestrator runs `git checkout --ours` on the 44-08 worktree to take 44-08's real implementation. CommunityPost.tsx's import path (`./CommunityPostMediaStrip`) is unchanged — the swap is transparent to 44-06's code.

## Known Stubs

| File | Location | Reason |
|------|----------|--------|
| `src/components/community/CommunityPostMediaStrip.tsx` | entire file | Intentional null-render stub for parallel Wave 1 execution; 44-08 replaces with image carousel + lazy Mux player |
| `CommunityPost.tsx` | display_name construction | `User ${post.author_id.slice(0,8)}` — profile join (display_name, avatar_url) wired by 44-09 Space view |
| `CommunityCommentThread.tsx` | display_name construction | Same as above — 44-09 wires profile data |

## Threat Flags

No new threat surface beyond what the plan's threat_model covers. T-44-05 (XSS) mitigated by `sanitizeCommunityMarkdown` at every render trust boundary. T-44-01 (cross-tenant read) relies on RLS on `community_posts`; client query is scoped to `spaceId` only.

## Self-Check: PASSED

Files verified present:
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/CommunityPost.tsx` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/CommunityFeed.tsx` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/CommunityCommentThread.tsx` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/ReactionBar.tsx` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/use-feed.ts` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0d43783020446746/leanshot/src/components/community/CommunityPostMediaStrip.tsx` — FOUND

Commits verified:
- `6503cd8` — Task 1: CommunityPost + CommentThread + ReactionBar + MediaStrip stub
- `0b94bab` — Task 2: CommunityFeed + use-feed cursor-pagination hook
