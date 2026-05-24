---
phase: 45
plan: 07a
subsystem: community
tags: [community, directory, dm, leaderboard, settings, zustand]
provides:
  - "activeCommunityView Zustand dispatch ('directory' | 'dm' | null) — sub-view routing inside the existing 'community' TabId (no router; no new TabId)"
  - "CommunityTabShell extension dispatching directory + DM views"
  - "useDmInboxRealtime hook (per-user channel dm:${userId}, filter recipient_user_id=eq.${userId})"
  - "CommunityDirectoryView with direct supabase.from('profiles').select() RLS-gated query"
  - "ProfileCard rendering 4 badges + bio (Phase 44 dompurify) + HTTPS-only links + Message CTA"
  - "LeaderboardChip with top-3/expand + Phase 44 locked-card tier UX"
  - "ReportButton (reusable across posts/comments/DMs/profiles) calling community_report_create RPC"
  - "CommunitySettingsTab with 5 base toggles + staff-only admin_digest_opt_in"
requires:
  - "45-01 schema (profiles.directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in, admin_digest_opt_in, is_clinician_verified, bio, links, handle, display_name)"
  - "45-01 SECDEF RPCs: community_report_create"
  - "45-06 matview + RPC get_community_space_leaderboard"
  - "Phase 44 src/lib/community/dompurify-config.ts (renderPostBodyHtml, sanitizeCommunityMarkdown)"
  - "Phase 44 src/lib/community/tier-gate.ts (canAccessSpace, TierLabel)"
affects:
  - "Phase 44 CommunityTabShell.tsx — extended (not replaced) to add 3-variant view dispatch"
  - "Phase 44 store.ts UIState/Actions — 2 new ephemeral fields + 2 new actions"
tech-stack:
  added: []
  patterns:
    - "stub-then-replace (DMInboxView/DMThreadView stubs ship final prop signature here so this plan typechecks; 45-07b replaces)"
    - "ephemeral Zustand UI slice (excluded from partialize per reference_zustand_persisted_user_blocks_marketing_uat)"
    - "cursor pagination on (handle, id) via .order() + .or() (no RPC indirection)"
key-files:
  created:
    - "leanshot/src/components/community/CommunityDirectoryView.tsx"
    - "leanshot/src/components/community/ProfileCard.tsx"
    - "leanshot/src/components/community/LeaderboardChip.tsx"
    - "leanshot/src/components/community/ReportButton.tsx"
    - "leanshot/src/components/community/use-dm-inbox-realtime.ts"
    - "leanshot/src/components/community/DMInboxView.tsx"       # stub — 45-07b replaces
    - "leanshot/src/components/community/DMThreadView.tsx"      # stub — 45-07b replaces
    - "leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx"
  modified:
    - "leanshot/src/lib/store.ts"
    - "leanshot/src/components/community/CommunityTabShell.tsx"
decisions:
  - "3-variant union 'directory' | 'dm' | null (NOT 5-variant 'feed'|'space:<id>'|'directory'|'dm'|null per CONTEXT D-16); space drill-in keeps using activeCommunitySpaceId; 'feed' is implicit when both are null. Within Claude's Discretion per CONTEXT line 64."
  - "Direct supabase.from('profiles').select() instead of search_directory RPC (Fix-C); RLS policy directory_members_select does two-mode org-scope visibility; 45-01 ships no RPC for this surface."
  - "Stub-then-replace pattern for DMInboxView/DMThreadView — final prop signatures shipped here so 45-07a typechecks independently; 45-07b replaces. Per memory feedback_stub_then_replace_sibling_collision."
  - "Removed rejected-alt RPC name ('search_directory') from CommunityDirectoryView comments per memory feedback_negation_grep_defeated_by_comment_string."
metrics:
  duration: ~30min
  completed: 2026-05-24
  tasks: 3
  commits: 3
  files_created: 8
  files_modified: 2
---

# Phase 45 Plan 07a: Consumer state foundation — Zustand sub-view dispatch + CommunityTabShell extension Summary

One-liner: Wave 2 sub-half-A landed the Zustand `activeCommunityView` dispatch, extended CommunityTabShell to route directory/DM sub-views inside the existing 'community' TabId, and shipped the directory + ProfileCard + LeaderboardChip + ReportButton + CommunitySettingsTab surfaces — all bio rendering routes through Phase 44 dompurify, and the directory query uses direct `.from('profiles').select()` (no RPC indirection, RLS-gated per `directory_members_select`).

## Commits

| Hash       | Message |
| ---------- | ------- |
| `e8c43e67` | feat(45-07a-01): Zustand activeCommunityView dispatch + DM inbox realtime hook |
| `5e981ab1` | feat(45-07a-02): CommunityDirectoryView + ProfileCard (direct .from('profiles').select, RLS-gated) |
| `40752388` | feat(45-07a-03): LeaderboardChip + ReportButton + CommunitySettingsTab (5 toggles + staff-only digest) |

## Per-task breakdown

### Task 1 — Store extension + CommunityTabShell view dispatch + use-dm-inbox-realtime hook
- Added `activeCommunityView: 'directory' | 'dm' | null` and `activeDmThreadId: string | null` to `UIState`; both ephemeral (excluded from `partialize`).
- Added `setActiveCommunityView` and `setActiveDmThread` actions on `Actions`.
- Extended `CommunityTabShell.tsx` to dispatch on `activeCommunityView` first; falls through to legacy `activeCommunitySpaceId` list/detail when null.
- Created `use-dm-inbox-realtime.ts` mirroring `use-space-realtime.ts` shape (channel `dm:${userId}`, filter `recipient_user_id=eq.${userId}`, table `direct_messages`).
- Shipped 3 stubs (`DMInboxView.tsx`, `DMThreadView.tsx`, `CommunityDirectoryView.tsx`) with final prop signatures so the shell typechecks; `CommunityDirectoryView` is replaced by Task 2 in this same plan; DM stubs are replaced by sibling plan 45-07b.

### Task 2 — CommunityDirectoryView + ProfileCard
- `CommunityDirectoryView`: handle-prefix search (250ms debounced) → `supabase.from('profiles').select('id, handle, display_name, bio, links, is_clinician_verified, show_tier_badge, show_streak_badge').eq('directory_opt_in', true).ilike('handle', ...).order('handle').order('id').limit(20)`. Cursor pagination on `(handle, id)` using `.or('handle.gt.X,and(handle.eq.X,id.gt.Y)')`. RLS gates visibility.
- `ProfileCard`: 4 badges (tier / clinician / streak / level) honoring per-user `show_tier_badge`/`show_streak_badge` toggles; bio rendered via Phase 44 `renderPostBodyHtml` (T-45-05 — NO new DOMPurify); links filtered HTTPS-only and capped at 5; Message CTA dispatches via `onMessage` prop.
- `Message` CTA in directory currently flips `activeCommunityView='dm'` with `activeDmThreadId=null` → routes to `DMInboxView`. 45-07b will extend the path with a thread-lookup hop.

### Task 3 — LeaderboardChip + ReportButton + CommunitySettingsTab
- `LeaderboardChip`: fetches via `supabase.rpc('get_community_space_leaderboard', { p_space_id })`; renders `null` when `leaderboardEnabled=false`; Phase 44 locked-card UX with `/pricing` Upgrade CTA when caller tier < `space.min_tier` (D-15); top-3 default, "View full leaderboard" toggle for the full ±5 neighborhood.
- `ReportButton`: reusable Flag trigger + `Sheet` form with `<textarea>` (1000-char cap); on submit calls `supabase.rpc('community_report_create', { p_target_type, p_target_id, p_reason })`; toast on success/error. `targetType` union: `'post' | 'comment' | 'dm_message' | 'profile'`.
- `CommunitySettingsTab`: fetches the 7 columns (5 toggles + `admin_digest_opt_in` + `is_staff`) once on mount; each toggle writes via `supabase.from('profiles').update({ [key]: next }).eq('id', userId)` with optimistic local state + revert-on-error; the 6th `admin_digest_opt_in` toggle is rendered ONLY when `prefs.is_staff === true`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Created DMInboxView.tsx / DMThreadView.tsx as stub files**
- **Found during:** Task 1 (CommunityTabShell needs to lazy-import them)
- **Issue:** Plan says the DM views ship in sibling plan 45-07b but expects this plan's CommunityTabShell to lazy-import them. `import('./DMInboxView')` against a non-existent module would fail TypeScript / build, blocking Task 1 verification.
- **Fix:** Shipped both as small functional stubs with final prop signatures (`{ currentUserId }` for DMInboxView; `{ threadId, currentUserId }` for DMThreadView). Per memory `feedback_stub_then_replace_sibling_collision`, 45-07b will replace these with the real implementations; in case of merge collision the resolver keeps the 45-07b version (`git checkout --ours`).
- **Files modified:** `leanshot/src/components/community/DMInboxView.tsx`, `leanshot/src/components/community/DMThreadView.tsx`
- **Commit:** `e8c43e67`

**2. [Rule 3 — Blocking] Created CommunityDirectoryView.tsx as a stub in Task 1, replaced in Task 2**
- **Found during:** Task 1 (CommunityTabShell needs to lazy-import it; Task 2 builds the real surface)
- **Issue:** Same module-resolution constraint as above for Task 1's typecheck gate.
- **Fix:** Shipped as a typed stub in Task 1; Task 2 overwrites with the full Directory + ProfileCard surface.
- **Files modified:** `leanshot/src/components/community/CommunityDirectoryView.tsx`
- **Commit:** `e8c43e67` (stub) → `5e981ab1` (real)

**3. [Rule 2 — Critical correctness] Removed rejected-alternative RPC name from comments**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** First draft included "NOT supabase.rpc('search_directory')" in JSDoc / inline comments. Per memory `feedback_negation_grep_defeated_by_comment_string`, this defeats the plan's own negation grep (`grep -c "search_directory" ... returns 0`) and any future plan-checker pass.
- **Fix:** Reworded comments to convey the decision without naming the rejected symbol literally.
- **Files modified:** `leanshot/src/components/community/CommunityDirectoryView.tsx`
- **Commit:** `5e981ab1`

### Out-of-scope discoveries
- The worktree had no `node_modules` (per memory `reference_npm_install_worktree_main_drift`). `npm install` failed on a pre-existing Sentry compat check (`@sentry/capacitor` vs `@sentry/react@^10.52.0`). Worked around by symlinking the main repo's `node_modules` into the worktree — symlink is gitignored and never committed. **Not a Rule 1/2/3 fix**, just an environment workaround; the upstream Sentry version mismatch is pre-existing and should be tracked separately.

## Threat Coverage Confirmation

| Threat | Mitigation in this plan |
|--------|------------------------|
| T-45-01 (directory info disclosure) | Direct `.from('profiles').select()` relies entirely on RLS; client cannot bypass `directory_opt_in=true` + two-mode org-scope filter. |
| T-45-04 (report DoS) | `community_report_create` RPC requires `auth.uid()` (server-side); UI submits with disabled state during in-flight call. |
| T-45-05 (XSS in bio) | `ProfileCard` routes bio through `renderPostBodyHtml`. No new DOMPurify instantiation anywhere (verified via grep gate). |
| T-45-15 (leaderboard tier-bypass) | `LeaderboardChip` checks `canAccessSpace(spaceMinTier, currentTier)` and renders the locked-card UX for under-tier users before fetching. |

## Known Stubs

| File | Reason | Resolved by |
|------|--------|-------------|
| `leanshot/src/components/community/DMInboxView.tsx`  | Final prop signature only; DMs are sibling-plan scope. | Plan 45-07b |
| `leanshot/src/components/community/DMThreadView.tsx` | Final prop signature only; DMs are sibling-plan scope. | Plan 45-07b |

Both stubs render a localized loading message; they do NOT advertise a feature the user can interact with. The dispatch path only flips to `'dm'` from the Message CTA in `ProfileCard`, which itself ships in this plan — so the user-facing path remains coherent until 45-07b lands.

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` exits 0 after every commit.
- `grep -c "activeCommunityView: 'directory' | 'dm' | null" src/lib/store.ts` → 1
- `grep -c "activeCommunityView" src/lib/store.ts` → 4 (interface + initial + setter signature + setter impl)
- `awk '/partialize:/,/^[[:space:]]*\}/' src/lib/store.ts | grep -c activeCommunityView` → 0 (ephemeral)
- `grep -c "dm:\${userId}" src/components/community/use-dm-inbox-realtime.ts` → 2
- `grep -c "recipient_user_id=eq" src/components/community/use-dm-inbox-realtime.ts` → 2
- `grep -c "supabase.from('profiles').select(" src/components/community/CommunityDirectoryView.tsx` → 1
- `grep -c "search_directory" src/components/community/CommunityDirectoryView.tsx` → 0
- `grep -rE "new DOMPurify\(|createDOMPurify\(" src/components/community/{CommunityDirectoryView,ProfileCard,LeaderboardChip,ReportButton}.tsx src/components/dashboard/settings/CommunitySettingsTab.tsx | wc -l` → 0
- `grep -c "get_community_space_leaderboard" src/components/community/LeaderboardChip.tsx` → 2
- `grep -c "community_report_create" src/components/community/ReportButton.tsx` → 2
- All 5 base toggles + admin_digest_opt_in + is_staff present in `CommunitySettingsTab.tsx`.

## Self-Check

- [x] All declared files exist in working tree (8 created + 2 modified)
- [x] All 3 commits present in `git log` (`e8c43e67`, `5e981ab1`, `40752388`)
- [x] TypeScript clean
- [x] Each commit passes its own acceptance criteria
- [x] No CLAUDE.md violations (one-selector-per-primitive, no router in consumer, ephemeral state excluded from partialize, no hardcoded colors)
