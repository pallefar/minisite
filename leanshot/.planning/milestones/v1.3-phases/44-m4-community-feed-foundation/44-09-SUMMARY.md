---
phase: 44
plan: "09"
subsystem: community-feed
tags: [realtime, tier-gate, spaces, zustand-tabs, admin-crud, rls, vite-chunks]
dependency_graph:
  requires: [44-06, 44-07, 44-08]
  provides: [use-space-realtime, CommunitySpaceList, CommunitySpaceView, CommunityTabShell, SpaceEditor, CommunityAdminLayout]
  affects: [App.tsx, store.ts, types/index.ts, vite.config.ts, Sidebar.tsx, MobileNav.tsx]
tech_stack:
  added: []
  patterns: [zustand-tab-navigation, pathname-based-admin-routing, per-space-realtime-channel]
key_files:
  created:
    - leanshot/src/components/community/use-space-realtime.ts
    - leanshot/src/components/community/CommunitySpaceList.tsx
    - leanshot/src/components/community/CommunitySpaceView.tsx
    - leanshot/src/components/community/CommunityTabShell.tsx
    - leanshot/src/admin/modules/community/SpaceEditor.tsx
    - leanshot/src/admin/modules/community/CommunityAdminLayout.tsx
    - supabase/migrations/20270720000006_p44_community_spaces_admin_policies.sql
  modified:
    - leanshot/vite.config.ts
    - leanshot/scripts/assert-bundle-budget.sh
    - leanshot/src/App.tsx
    - leanshot/src/types/index.ts
    - leanshot/src/lib/store.ts
    - leanshot/src/lib/i18n/nav-labels.ts
    - leanshot/src/components/layout/Sidebar.tsx
    - leanshot/src/components/layout/MobileNav.tsx
    - leanshot/tests/rls/community-spaces-rls.test.ts
decisions:
  - "Consumer surface uses Zustand TabId + activeCommunitySpaceId (no react-router) per CLAUDE.md no-router rule — admin surface uses pathname-based switching (consistent with ReviewsLayout/AdminShell project convention, not react-router)"
  - "is_staff() predicate pinned in admin RLS migration — no staff_users table reference (Fix-B iter-2)"
  - "community-media/community-mentions manualChunks rules placed BEFORE community/ catch-all (line 197 < 204) — Mux (~186 kB) + Fuse.js (8 kB) isolated from 20 kB community-feed ceiling"
  - "activeCommunitySpaceId excluded from partialize (transient UI state; same treatment as currentTab and toast)"
  - "CommunityTabShell resolves TierLabel async from tier_effective view (readTierLabel) — store.tier uses billing Tier type which differs from community TierLabel"
metrics:
  duration: "~45 minutes"
  tasks_completed: 3
  files_created: 7
  files_modified: 9
  completed_date: "2026-05-23"
requirements_satisfied: [COMMUNITY-05, COMMUNITY-06]
---

# Phase 44 Plan 09: use-space-realtime + tier-locked SpaceList/SpaceView + admin SpaceEditor + vite chunks + Zustand community tab

## One-liner

Per-space Realtime channel (D-13) + tier-locked discovery (D-08 locked cards / D-09 RLS-hidden) + Zustand community tab shell + admin SpaceEditor with is_staff() RLS + community-media/community-mentions vite chunk isolation.

## Summary

Wave 2 wired the community subsystem into the application across two correctly-separated routing surfaces:

1. **Consumer surface** (Zustand-only, per CLAUDE.md no-router rule): `TabId` widened with `'community'`, `activeCommunitySpaceId` added to the store (non-persisted), `CommunityTabShell` lazy-mounted from App.tsx when `currentTab === 'community'`, exposed in Sidebar + MobileNav.

2. **Admin surface** (pathname-based routing, consistent with existing AdminShell/ReviewsLayout convention): `SpaceEditor` + `CommunityAdminLayout` under `src/admin/modules/community/` — the admin module can be registered in `src/lib/admin/modules.ts` by Plan 44-10 or post-deploy.

Key deliverables:
- `useSpaceRealtime(spaceId, onUpdate)` — per-space Realtime channel subscribing to `community_posts` + `community_comments` (denormalized `space_id` per Pitfall 5) + `community_reactions`; single channel per mounted view per D-13.
- `CommunitySpaceList` — fetches accessible spaces via RLS (org-private spaces filtered server-side per D-09); renders D-08 locked cards for tier-inaccessible spaces with `/pricing` CTA; never calls `onSelectSpace` on locked cards.
- `CommunitySpaceView` — runtime RLS validation on mount (T-44-01 defense); wires `useSpaceRealtime` to increment `refreshNonce` passed to `CommunityFeed`.
- vite.config.ts: `community-media` (Mux player + uploader) and `community-mentions` (Fuse.js typeahead) sub-chunk rules placed BEFORE the `community/` catch-all — ordering verified (line 197 < 204).
- Migration `20270720000006_p44_community_spaces_admin_policies.sql`: INSERT + UPDATE RLS on `community_spaces` using `public.is_staff()` only (Fix-B pin).
- 2 new RLS test blocks appended to `community-spaces-rls.test.ts`: non-staff INSERT rejection + staff INSERT success.

## Tasks Completed

| Task | Commit | Files |
|------|--------|-------|
| 1: use-space-realtime + SpaceList + SpaceView | b875f6d | use-space-realtime.ts, CommunitySpaceList.tsx, CommunitySpaceView.tsx |
| 2: vite manualChunks + bundle budget | 7930919 | vite.config.ts, assert-bundle-budget.sh |
| 3: Zustand tabs + admin + migration | 994626d | types/index.ts, store.ts, App.tsx, CommunityTabShell.tsx, Sidebar.tsx, MobileNav.tsx, SpaceEditor.tsx, CommunityAdminLayout.tsx, migration SQL, rls test |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] nav-labels.ts exhaustive switch required 'community' case**
- **Found during:** Task 3 (TabId widen)
- **Issue:** `tabLongLabel` and `tabShortLabel` in `src/lib/i18n/nav-labels.ts` use exhaustive `never` switch on `TabId`. Adding `'community'` to the union without adding switch cases would produce tsc error.
- **Fix:** Added `case 'community': return t('nav:community');` + `case 'community': return t('nav:tab_short_community');` to both switch functions.
- **Files modified:** `src/lib/i18n/nav-labels.ts`
- **Commit:** 994626d

**2. [Rule 3 - Blocking] Migration comment contained `staff_users` string**
- **Found during:** Task 3 verification
- **Issue:** The acceptance criteria negation grep `(! grep -q "staff_users" migration.sql)` was failing because the comment used the word `staff_users` to explain what NOT to do.
- **Fix:** Rephrased the comment to document the canonical approach without mentioning the forbidden table name.
- **Files modified:** `20270720000006_p44_community_spaces_admin_policies.sql`
- **Commit:** 994626d

**3. [Rule 2 - Missing critical] TierLabel resolution in CommunityTabShell**
- **Found during:** Task 3 authoring
- **Issue:** `store.tier` uses billing `Tier` type (`'free' | 'paid' | 'past_due'`) which is NOT the same as community `TierLabel` (`'free' | 'trial' | 'pro' | 'lifetime'`). The plan's interface spec says `s.user?.tier` but that path doesn't exist and would be wrong type.
- **Fix:** CommunityTabShell resolves TierLabel asynchronously via `readTierLabel(userId)` from `tier-gate.ts` (already designed for this purpose). Defaults to `'free'` until resolved.
- **Files modified:** `src/components/community/CommunityTabShell.tsx`
- **Commit:** 994626d

**4. [Rule 3 - Blocking] Admin modules use pathname-based routing, not react-router**
- **Found during:** Task 3 (CommunityAdminLayout authoring)
- **Issue:** Plan described "admin surface CAN use react-router-dom Route pattern" — but actual codebase (ReviewsLayout.tsx, AdminShell.tsx) uses `window.location.pathname` switching with `window.addEventListener('popstate')`. No react-router-dom is imported in any existing admin module.
- **Fix:** Authored `CommunityAdminLayout` using the same pathname-based routing pattern as `ReviewsLayout.tsx` — this is the real project convention for admin modules regardless of what the plan said was allowed.
- **Files modified:** `src/admin/modules/community/CommunityAdminLayout.tsx`
- **Commit:** 994626d

## Known Stubs

None. All components render real data from Supabase queries gated by RLS.

Note: `CommunitySpaceList` shows member count + post count placeholders in the plan description but these are deferred to Phase 45 per the plan scope. The component renders the space name, description, and min_tier badge — accurate data, no placeholder text shown to users.

## Threat Flags

No new threat surface beyond what is covered by the plan's threat model. The `activeCommunitySpaceId` field is non-persisted transient UI state with no security implications.

## Self-Check: PASSED

Files exist:
- leanshot/src/components/community/use-space-realtime.ts: FOUND
- leanshot/src/components/community/CommunitySpaceList.tsx: FOUND
- leanshot/src/components/community/CommunitySpaceView.tsx: FOUND
- leanshot/src/components/community/CommunityTabShell.tsx: FOUND
- leanshot/src/admin/modules/community/SpaceEditor.tsx: FOUND
- leanshot/src/admin/modules/community/CommunityAdminLayout.tsx: FOUND
- supabase/migrations/20270720000006_p44_community_spaces_admin_policies.sql: FOUND

Commits exist: b875f6d, 7930919, 994626d (verified via git log)
