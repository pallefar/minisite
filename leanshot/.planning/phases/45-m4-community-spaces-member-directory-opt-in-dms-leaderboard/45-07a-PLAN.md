---
phase: 45
plan: 07a
type: execute
wave: 2
depends_on: [45-04, 45-05, 45-06]
files_modified:
  - leanshot/src/lib/store.ts
  - leanshot/src/components/community/CommunityTabShell.tsx
  - leanshot/src/components/community/use-dm-inbox-realtime.ts
  - leanshot/src/components/community/CommunityDirectoryView.tsx
  - leanshot/src/components/community/ProfileCard.tsx
  - leanshot/src/components/community/LeaderboardChip.tsx
  - leanshot/src/components/community/ReportButton.tsx
  - leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx
autonomous: true
requirements:
  - COMMUNITY-07
must_haves:
  truths:
    - "Zustand store extended with activeCommunityView: 'directory' | 'dm' | null (3-variant union — NOT a new TabId per memory reference_react_router_consumer_admin_split; partialize EXCLUDES it — transient UI). Note: CONTEXT D-16 diagram showed additional 'feed' and 'space:<id>' variants — both are intentionally omitted; space drill-in continues to use the existing activeCommunitySpaceId field (set when user clicks a space card); 'feed' is the implicit default when activeCommunityView === null AND activeCommunitySpaceId === null. The narrower union keeps the type discriminator focused on the directory/dm sub-routing this phase adds. Within Claude's Discretion per CONTEXT line 64."
    - "CommunityTabShell (Phase 44 file — EXTENDED, not replaced) dispatches on activeCommunityView; directory + leaderboard chip + settings + report button reachable from within currentTab='community'"
    - "CommunityDirectoryView fetches profiles via supabase.from('profiles').select('id, handle, display_name, bio, links, is_clinician_verified, show_tier_badge, show_streak_badge') with RLS-mediated directory visibility (directory_opt_in = true AND two-mode org-scope predicate); cursor pagination on (handle, user_id) ASC; handle prefix + tier filter applied via inline SQL .ilike('handle', `${prefix}%`) — NO search_directory RPC (45-01 does not ship one)"
    - "ProfileCard renders 4 badges (tier/level/clinician/streak) honoring per-user toggles; bio rendered via Phase 44 renderPostBodyHtml from dompurify-config.ts (NO new policy); Message CTA flips activeCommunityView to 'dm' + opens DM thread for the recipient"
    - "LeaderboardChip fetches via supabase.rpc('get_community_space_leaderboard', { p_space_id }) — top-10 + ±5 neighborhood from 45-06 matview; mounted on CommunitySpaceView; honors tier-gating (D-15 locked-card UX → /pricing CTA)"
    - "ReportButton shipped as reusable surface for posts/comments/DMs/profiles; calls community_report_create RPC from 45-01; toast 'Report submitted' on success"
    - "CommunitySettingsTab ships 5 toggles: directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in (one Zustand setter per toggle calling supabase.from('profiles').update); admin_digest_opt_in toggle rendered ONLY for is_staff() users"
    - "Toast + unread-count badge wired into MobileNav + Sidebar 'community' (D-19); prefers-reduced-motion respected"
  artifacts:
    - path: "leanshot/src/components/community/CommunityDirectoryView.tsx"
      provides: "Directory list + search + ProfileCard rendering — uses direct .from('profiles').select() (NOT search_directory RPC)"
      min_lines: 100
    - path: "leanshot/src/components/community/ProfileCard.tsx"
      provides: "4-badge card + bio render via Phase 44 dompurify + Message CTA"
      min_lines: 60
    - path: "leanshot/src/components/community/LeaderboardChip.tsx"
      provides: "Top-10 + ±5 neighborhood + tier-locked card UX"
      min_lines: 50
    - path: "leanshot/src/components/community/ReportButton.tsx"
      provides: "Shared report button — posts/comments/DMs/profiles"
      min_lines: 40
    - path: "leanshot/src/components/community/use-dm-inbox-realtime.ts"
      provides: "Per-user channel hook (dm:${userId}) mirroring use-space-realtime"
    - path: "leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx"
      provides: "5 community settings toggles + staff-only admin_digest_opt_in toggle"
      min_lines: 80
  key_links:
    - from: "leanshot/src/components/community/LeaderboardChip.tsx"
      to: "get_community_space_leaderboard RPC"
      via: "supabase.rpc()"
      pattern: "get_community_space_leaderboard"
    - from: "leanshot/src/components/community/ReportButton.tsx"
      to: "community_report_create RPC (45-01)"
      via: "supabase.rpc()"
      pattern: "community_report_create"
    - from: "leanshot/src/components/community/use-dm-inbox-realtime.ts"
      to: "direct_messages table"
      via: "supabase.channel(dm:${userId}).on('postgres_changes', { filter: 'recipient_user_id=eq.${userId}' })"
      pattern: "recipient_user_id=eq"
    - from: "leanshot/src/components/community/CommunityDirectoryView.tsx"
      to: "profiles table (RLS-gated)"
      via: "supabase.from('profiles').select(...).ilike('handle', `${prefix}%`)"
      pattern: "supabase\\.from\\('profiles'\\)\\.select\\("
---

<objective>
Land Wave 2 sub-half A of Phase 45 consumer UI: Zustand sub-view dispatch + CommunityTabShell extension + DM inbox realtime hook + Directory view + ProfileCard + LeaderboardChip + ReportButton + Community settings tab. 8 files; all sub-views live INSIDE the existing 'community' TabId (NO new TabId per memory reference_react_router_consumer_admin_split + CONTEXT code_context); navigation is via a new `activeCommunityView` Zustand sub-state with the 3-variant union `'directory' | 'dm' | null`. DM thread/composer surface ships in sibling plan 45-07b; vite chunking + bundle ceilings also ship in 45-07b.

Purpose: Wave 2 — depends on Wave 1 Edge Fn (45-04) AND Wave 1 admin digest (45-05) AND Wave 1 leaderboard matview (45-06). Plan 45-07b consumes the store + shell + hook + ReportButton exports from this plan. Plan 45-09 close-out exercises this UI via HUMAN-UAT signals.

Output: 8 file changes (1 store extension + 1 shell extension + 6 NEW components). Sized as 3 tasks to fit ~50% context per task.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-RESEARCH.md
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md

# Primary analogs — copy verbatim
@leanshot/src/components/community/CommunityTabShell.tsx
@leanshot/src/components/community/CommunitySpaceView.tsx
@leanshot/src/components/community/CommunityFeed.tsx
@leanshot/src/components/community/CommunityPost.tsx
@leanshot/src/components/community/CommunityPostComposer.tsx
@leanshot/src/components/community/ReactionBar.tsx
@leanshot/src/components/community/use-space-realtime.ts
@leanshot/src/lib/community/community-storage.ts
@leanshot/src/lib/community/dompurify-config.ts
@leanshot/src/lib/store.ts
</context>

<interfaces>
<!-- Store extension shape — 3-variant union per Fix-B -->
```typescript
// Added to AppState interface in src/lib/store.ts after activeCommunitySpaceId:
activeCommunityView: 'directory' | 'dm' | null;     // null = legacy feed-or-space view
activeDmThreadId: string | null;                     // selected thread within 'dm' view; consumed by 45-07b
setActiveCommunityView: (v: AppState['activeCommunityView']) => void;
setActiveDmThread: (id: string | null) => void;
```

<!-- RPC contracts (shipped by 45-01) used by this plan -->
- `supabase.rpc('get_community_space_leaderboard', { p_space_id })` — top-10 + ±5 neighborhood; returns `{ handle, score, rank_in_space }[]`
- `supabase.rpc('toggle_community_block', { p_target_user_id })` — returns boolean
- `supabase.rpc('community_report_create', { p_target_type, p_target_id, p_reason })` — returns uuid
- `supabase.rpc('admin_toggle_report_digest_opt_in', { p_enabled })` — admin-only

<!-- Direct queries (NOT via RPC — Fix-C correction) -->
- `supabase.from('profiles').select('id, handle, display_name, bio, links, is_clinician_verified, show_tier_badge, show_streak_badge').eq('directory_opt_in', true).ilike('handle', `${prefix}%`).order('handle').order('id').limit(20)` — RLS gates two-mode directory visibility
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Zustand store extension + CommunityTabShell view dispatch + use-dm-inbox-realtime hook</name>
  <files>leanshot/src/lib/store.ts, leanshot/src/components/community/CommunityTabShell.tsx, leanshot/src/components/community/use-dm-inbox-realtime.ts</files>
  <read_first>
    - leanshot/src/lib/store.ts (lines 76-100 AppState interface; lines 580-660 store creation + partialize; lines 645-655 setter patterns)
    - leanshot/src/components/community/CommunityTabShell.tsx (current dispatch logic — extend, don't replace)
    - leanshot/src/components/community/use-space-realtime.ts (primary analog — copy verbatim shape, change channel name + filter)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"use-dm-inbox-realtime.ts" (full hook code) + §"CommunityTabShell.tsx (EXTEND)"
  </read_first>
  <behavior>
    - store.ts: add `activeCommunityView: 'directory' | 'dm' | null` (3-variant union — NOT a new TabId) and `activeDmThreadId: string | null` to AppState; add `setActiveCommunityView`, `setActiveDmThread` actions. Note: CONTEXT D-16 diagram includes 'space:<id>' and 'feed' variants — both are intentionally omitted here. Space drill-in continues to use the existing `activeCommunitySpaceId` field on the store (set when user clicks a space card); 'feed' is the default view of the community tab when `activeCommunityView === null` (and `activeCommunitySpaceId === null`). The narrower union keeps the type discriminator focused on the directory/dm sub-routing this phase adds. Within Claude's Discretion per CONTEXT line 64.
    - Both new fields are ephemeral (NOT in partialize whitelist) — verify by checking partialize at lines 231-250 of store.ts does NOT include these two new fields
    - CommunityTabShell.tsx: read both `activeCommunitySpaceId` (existing) AND `activeCommunityView` (new); dispatch table:
      - `activeCommunityView === 'directory'` → render CommunityDirectoryView
      - `activeCommunityView === 'dm' && activeDmThreadId === null` → render DMInboxView (lazy import; ships in 45-07b)
      - `activeCommunityView === 'dm' && activeDmThreadId !== null` → render DMThreadView (lazy import; ships in 45-07b)
      - `activeCommunityView === null` (legacy): existing CommunitySpaceList / CommunitySpaceView behavior unchanged
    - use-dm-inbox-realtime.ts: copy use-space-realtime.ts verbatim; only changes are channel name `dm:${userId}` (per D-18), table 'direct_messages', filter `recipient_user_id=eq.${userId}`, payload type `{ thread_id, sender_user_id }`
  </behavior>
  <action>
    1. Open `leanshot/src/lib/store.ts`. Locate the line that declares `activeCommunitySpaceId: string | null;` (around line 82). Insert immediately below it the two new field declarations: `activeCommunityView: 'directory' | 'dm' | null;` (with a JSDoc comment marking it ephemeral) and `activeDmThreadId: string | null;`. Then add action signatures alongside the existing `setActiveCommunitySpace` (around line 653): `setActiveCommunityView: (v: AppState['activeCommunityView']) => void;` and `setActiveDmThread: (id: string | null) => void;`. Add the corresponding `set({...})` implementations. Add initial state values `activeCommunityView: null` and `activeDmThreadId: null` (around line 585). Per memory `reference_zustand_persisted_user_blocks_marketing_uat` + CLAUDE.md State Management convention: do NOT add these to `partialize` — they're ephemeral UI flags like `currentTab`.

       Note on the 3-variant union: CONTEXT D-16 diagram lists `'space:<id>'` and `'feed'` variants — both are intentionally OMITTED. `'space:<id>'` drill-in uses the existing `activeCommunitySpaceId` field (already on the store); `'feed'` is the implicit default when `activeCommunityView === null` AND `activeCommunitySpaceId === null`. The narrower 3-variant union (`'directory' | 'dm' | null`) keeps the type discriminator focused on the directory/dm sub-routing this phase adds. Within Claude's Discretion per CONTEXT line 64.

    2. Open `leanshot/src/components/community/CommunityTabShell.tsx`. Add 4 new lazy imports after existing ones (CommunityDirectoryView in this plan; DMInboxView + DMThreadView ship in 45-07b but their lazy import declarations can be added now since lazy() resolves at render time — the files will exist by the time the view dispatches to them in the consumer build). Read `activeCommunityView` + `activeDmThreadId` via per-primitive selectors (per CLAUDE.md State Management). Replace the existing ternary inside `<Suspense>` with a switch on `activeCommunityView` — dispatch as described in `<behavior>` above.

    3. Create `leanshot/src/components/community/use-dm-inbox-realtime.ts` — copy `use-space-realtime.ts` verbatim per 45-PATTERNS.md §"use-dm-inbox-realtime.ts" (full code block provided there). Only changes: channel name template `\`dm:\${userId}\`` (per D-18), table `'direct_messages'`, filter `\`recipient_user_id=eq.\${userId}\``, payload typed `{ thread_id: string; sender_user_id: string }`.

    Per CLAUDE.md State Management rule: each useStore selector returns ONE primitive. Do NOT introduce `useStore(s => s)`.
  </action>
  <acceptance_criteria>
    - `grep -c "activeCommunityView: 'directory' | 'dm' | null" leanshot/src/lib/store.ts` returns ≥1 (Fix-B literal 3-variant union)
    - `grep -c "activeCommunityView" leanshot/src/lib/store.ts` returns ≥4 (interface field + initial state + setter signature + setter impl)
    - `grep -c "activeDmThreadId" leanshot/src/lib/store.ts` returns ≥4
    - `awk '/partialize:/,/^[[:space:]]*\\}/' leanshot/src/lib/store.ts | grep -c activeCommunityView` returns 0 (must remain ephemeral)
    - File `leanshot/src/components/community/use-dm-inbox-realtime.ts` exists
    - `grep -c "dm:\\${userId}" leanshot/src/components/community/use-dm-inbox-realtime.ts` returns ≥1
    - `grep -c "recipient_user_id=eq" leanshot/src/components/community/use-dm-inbox-realtime.ts` returns ≥1
    - `grep -c "CommunityDirectoryView\\|DMInboxView\\|DMThreadView" leanshot/src/components/community/CommunityTabShell.tsx` returns ≥3 (one each as lazy import)
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -c "activeCommunityView: 'directory' | 'dm' | null" src/lib/store.ts | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "activeCommunityView" src/lib/store.ts | awk '$1 >= 4 {print "OK"; exit 0} {print "FAIL"; exit 1}' && test $(awk '/partialize:/,/^[[:space:]]*\\}/' src/lib/store.ts | grep -c "activeCommunityView") -eq 0 && test -f src/components/community/use-dm-inbox-realtime.ts && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>Store + shell + hook ready for the new components in Tasks 2 + 3 and for 45-07b consumption.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CommunityDirectoryView + ProfileCard (direct .from('profiles').select, NOT search_directory RPC)</name>
  <files>leanshot/src/components/community/CommunityDirectoryView.tsx, leanshot/src/components/community/ProfileCard.tsx</files>
  <read_first>
    - leanshot/src/components/community/CommunitySpaceView.tsx (role-match analog — list + skeleton + RLS-gated query)
    - leanshot/src/components/community/CommunityPost.tsx (analog for ProfileCard markdown rendering — uses renderPostBodyHtml from dompurify-config.ts)
    - leanshot/src/lib/community/dompurify-config.ts (REUSE — sanitizeCommunityMarkdown + renderPostBodyHtml exports)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"CommunityDirectoryView.tsx" + §"DOMPurify Reuse"
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md (D-01..D-05 badges + directory shape)
  </read_first>
  <behavior>
    - CommunityDirectoryView: search bar (handle prefix) + tier filter dropdown + ProfileCard list; pagination via cursor `(handle, user_id)` per D-04; loads via direct `supabase.from('profiles').select('id, handle, display_name, bio, links, is_clinician_verified, show_tier_badge, show_streak_badge').eq('directory_opt_in', true).ilike('handle', \`\${prefix}%\`).order('handle').order('id').limit(20)` — RLS does the cross-tenant filtering automatically (Fix-C: do NOT use supabase.rpc('search_directory') — 45-01 does NOT ship this RPC)
    - ProfileCard: avatar (use existing user avatar pattern from Phase 44 CommunityPost), handle, display_name, bio (rendered via `renderPostBodyHtml` from dompurify-config.ts — NO new policy), up to 5 links (rendered as anchor tags with HTTPS-only check), 4 badges (tier from tier_effective.tier_label — fetch via existing readTierLabel helper from CommunityTabShell; level from gamification — defer if not exposed; clinician from is_clinician_verified; streak from streak_state.current_streak_days), Message CTA button that sets activeCommunityView='dm' + activeDmThreadId based on existing thread lookup (or null to trigger composer for new thread)
    - All bio + markdown rendering uses `renderPostBodyHtml` from `@/lib/community/dompurify-config` — NO new DOMPurify instantiation (memory feedback_silent_scope_reduction_patterns)
    - All toasts use `useToast` from existing hooks; honor `useReducedMotion` per CLAUDE.md a11y
  </behavior>
  <action>
    Create the 2 components in `leanshot/src/components/community/`. For each:
    1. Use `Suspense + lazy` only inside parent (CommunityTabShell already does this for CommunityDirectoryView)
    2. One useStore selector per primitive (per CLAUDE.md)
    3. Import dompurify via `import { renderPostBodyHtml } from '@/lib/community/dompurify-config'` — NO new DOMPurify
    4. Tailwind v4 utility classes for styling (existing community/* style language)
    5. `aria-label` on every icon-only button; `role="status" aria-live="polite"` on async loading regions; `prefers-reduced-motion` via existing `useReducedMotion` hook

    CommunityDirectoryView.tsx: copy CommunitySpaceView.tsx shape; replace its `useEffect` data fetch with the direct profiles select query above; render `<ProfileCard profile={...} onMessage={() => setActiveCommunityView('dm')...} />` mapped over results. Pagination: cursor (handle, user_id) stored in component-local useState; "Load more" button. CRITICAL (Fix-C): use `supabase.from('profiles').select(...)` directly — do NOT call `supabase.rpc('search_directory')` — that RPC does not exist; RLS does the directory_members_select two-mode gating per 45-01.

    ProfileCard.tsx: stateless component; props `{ profile, currentUserId, onMessage }`. Render avatar + handle + display_name + bio (via renderPostBodyHtml) + links (filtered HTTPS-only) + 4 badge components (use simple Badge primitive from `@/components/ui/Badge`). Message CTA dispatches via callback prop.
  </action>
  <acceptance_criteria>
    - Both files exist with named exports CommunityDirectoryView, ProfileCard
    - `grep -c "supabase.from('profiles').select(" leanshot/src/components/community/CommunityDirectoryView.tsx` returns ≥1 (Fix-C literal)
    - `grep -c "search_directory" leanshot/src/components/community/CommunityDirectoryView.tsx` returns 0 (Fix-C — RPC must NOT be referenced)
    - `grep -rE "new DOMPurify\\(|createDOMPurify\\(" leanshot/src/components/community/CommunityDirectoryView.tsx leanshot/src/components/community/ProfileCard.tsx` returns no matches (CRITICAL — memory feedback_silent_scope_reduction_patterns)
    - `grep -c "renderPostBodyHtml\\|sanitizeCommunityMarkdown" leanshot/src/components/community/ProfileCard.tsx` returns ≥1
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/community/CommunityDirectoryView.tsx && test -f src/components/community/ProfileCard.tsx && test $(grep -c "supabase.from('profiles').select(" src/components/community/CommunityDirectoryView.tsx) -ge 1 && test $(grep -c "search_directory" src/components/community/CommunityDirectoryView.tsx) -eq 0 && test $(grep -rE "new DOMPurify\\(|createDOMPurify\\(" src/components/community/CommunityDirectoryView.tsx src/components/community/ProfileCard.tsx | wc -l) -eq 0 && grep -c "renderPostBodyHtml\\|sanitizeCommunityMarkdown" src/components/community/ProfileCard.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>Directory + ProfileCard ship using direct .from('profiles').select (no search_directory RPC); TypeScript compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: LeaderboardChip + ReportButton + CommunitySettingsTab (5 toggles + staff-only admin_digest_opt_in)</name>
  <files>leanshot/src/components/community/LeaderboardChip.tsx, leanshot/src/components/community/ReportButton.tsx, leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx</files>
  <read_first>
    - leanshot/src/components/community/ReactionBar.tsx (analog for LeaderboardChip + ReportButton)
    - leanshot/src/components/community/CommunitySpaceView.tsx (mount target for LeaderboardChip + Phase 44 locked-card UX source)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (sibling settings tabs to align Community tab structure with)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"LeaderboardChip.tsx" + §"ReportButton.tsx" (if present) + §"CommunitySettingsTab.tsx"
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md (D-11 report; D-12..D-17 leaderboard)
  </read_first>
  <behavior>
    - LeaderboardChip: small inline component mounted inside CommunitySpaceView (or rendered standalone by parent of this plan); fetches `supabase.rpc('get_community_space_leaderboard', { p_space_id })`; shows top-3 + "View full leaderboard" expansion; receives `leaderboardEnabled: boolean` prop — when false, renders nothing; when true but user tier is below space.min_tier, renders Phase 44 locked-card UX with `/pricing` CTA per D-15
    - ReportButton: small icon button (lucide-react Flag); on click opens a tiny Sheet with reason input (text); on submit calls `supabase.rpc('community_report_create', { p_target_type, p_target_id, p_reason })`; toast "Report submitted — admin will review" on success; designed for reuse — consumers (CommunityPost, CommunityCommentThread, ProfileCard, DMThreadView) import it and pass target_type + target_id props
    - CommunitySettingsTab: new dedicated settings tab (file `src/components/dashboard/settings/CommunitySettingsTab.tsx`) hosting 5 toggles (directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in); each writes via `supabase.from('profiles').update({ <col>: <bool> }).eq('id', currentUserId)`; toggles read initial state from a per-mount fetch of profiles row. ALSO renders a 6th toggle `admin_digest_opt_in` — gated on `is_staff` flag (fetched alongside profiles row) — only visible when user is_staff. Tab integrates into SettingsPage in 45-07b (or later wave plan) — for this plan, ship the tab file as a standalone, properly exported component.
    - All bio + markdown rendering (if any in this task's surface) uses `renderPostBodyHtml` from `@/lib/community/dompurify-config` — NO new DOMPurify
    - Toasts use `useToast`; honor `useReducedMotion`
  </behavior>
  <action>
    1. LeaderboardChip.tsx: mount-time fetch via `supabase.rpc('get_community_space_leaderboard', { p_space_id })`; if leaderboardEnabled=false return null; show top-3 + expand. Tier check: if `currentTier` is below the space's `min_tier`, render the Phase 44 locked-card UX (find pattern in CommunitySpaceView's tier-locked code path).

    2. ReportButton.tsx: icon button + Sheet (existing `@/components/ui/Sheet`) with textarea for reason; submit calls RPC; toast on success. Props: `{ targetType: 'post' | 'comment' | 'dm_message' | 'profile'; targetId: string }`. The component is consumed by 45-07b DM surface and by future patches to CommunityPost / CommunityCommentThread / ProfileCard (consumer wiring done by Wave 3 or 45-09 close-out — this plan only ships the reusable component).

    3. CommunitySettingsTab.tsx: locate sibling settings-tab files to copy the structure (likely `SettingsPage.tsx` enumerates tabs, each its own file). Create a new "Community" tab containing 5 labeled Switch components (use existing Switch / Toggle UI primitive). Initial state: `useEffect(() => supabase.from('profiles').select('directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in, admin_digest_opt_in, is_staff').eq('id', currentUserId).single())` then setLocalState. Each onChange writes via update + optimistic local state. The `admin_digest_opt_in` toggle MUST be rendered ONLY when the fetched row has `is_staff === true`.
  </action>
  <acceptance_criteria>
    - All 3 files exist with named exports LeaderboardChip, ReportButton, CommunitySettingsTab
    - `grep -c "get_community_space_leaderboard" leanshot/src/components/community/LeaderboardChip.tsx` returns ≥1
    - `grep -c "community_report_create" leanshot/src/components/community/ReportButton.tsx` returns ≥1
    - `grep -cE "directory_opt_in|dm_open|show_tier_badge|show_streak_badge|leaderboard_opt_in" leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx` returns ≥5 (all 5 base toggles)
    - `grep -c "admin_digest_opt_in" leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx` returns ≥1 (staff-only 6th toggle)
    - `grep -c "is_staff" leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx` returns ≥1 (gating on the admin_digest toggle)
    - `grep -rE "new DOMPurify\\(|createDOMPurify\\(" leanshot/src/components/community/LeaderboardChip.tsx leanshot/src/components/community/ReportButton.tsx leanshot/src/components/dashboard/settings/CommunitySettingsTab.tsx` returns no matches
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/community/LeaderboardChip.tsx && test -f src/components/community/ReportButton.tsx && test -f src/components/dashboard/settings/CommunitySettingsTab.tsx && grep -c "get_community_space_leaderboard" src/components/community/LeaderboardChip.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "community_report_create" src/components/community/ReportButton.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -cE "directory_opt_in|dm_open|show_tier_badge|show_streak_badge|leaderboard_opt_in" src/components/dashboard/settings/CommunitySettingsTab.tsx | awk '$1 >= 5 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "admin_digest_opt_in" src/components/dashboard/settings/CommunitySettingsTab.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "is_staff" src/components/dashboard/settings/CommunitySettingsTab.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && test $(grep -rE "new DOMPurify\\(|createDOMPurify\\(" src/components/community/LeaderboardChip.tsx src/components/community/ReportButton.tsx src/components/dashboard/settings/CommunitySettingsTab.tsx | wc -l) -eq 0 && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>LeaderboardChip + ReportButton + CommunitySettingsTab ship; 6th admin_digest_opt_in toggle is staff-gated; TypeScript compiles.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser→Postgres | Direct queries gated by RLS (directory_members_select two-mode; community_reports write-only consumer) |
| browser→SECDEF RPC | LeaderboardChip + ReportButton invoke `get_community_space_leaderboard` / `community_report_create` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-45-01 | Information Disclosure | directory query | mitigate | RLS directory_members_select policy enforces two-mode visibility (45-01); client query unable to bypass; direct .from('profiles').select() relies on RLS, NOT search_directory RPC |
| T-45-04 | DoS | report spam | mitigate | community_report_create RPC requires auth.uid() (45-01); per-user daily-cap NOT in v1 (Phase 48 defers); accept low-volume |
| T-45-05 | Tampering (XSS) | profile bio render | mitigate | ProfileCard markdown rendered via Phase 44 renderPostBodyHtml; NO new DOMPurify instantiation; grep gate in acceptance criteria |
| T-45-15 | Tampering | leaderboard tier-bypass | mitigate | LeaderboardChip honors locked-card UX when currentTier < space.min_tier per D-15 (Phase 44 pattern reuse) |
</threat_model>

<verification>
- TypeScript compiles after all 3 tasks
- No new DOMPurify policy anywhere in 45-* files
- Realtime channel uses dm:${userId} (D-18 per-user inbox, not per-thread)
- CommunityDirectoryView uses direct .from('profiles').select(...) — NOT supabase.rpc('search_directory') (Fix-C)
- activeCommunityView union is exactly `'directory' | 'dm' | null` (Fix-B — 3 variants, not 5)
</verification>

<success_criteria>
- 6 new component/hook files + 1 store extension + 1 shell extension ship (8 files total)
- Zustand sub-view dispatch in place (NO new TabId)
- All bio rendering routes through Phase 44 dompurify config
- 5 community settings toggles wired; 6th admin_digest_opt_in gated on is_staff
- Directory query uses direct .from('profiles').select() — relies on RLS for visibility
</success_criteria>

<output>
After completion, create `.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-07a-SUMMARY.md` documenting: 8 file changes, the activeCommunityView 3-variant union choice, the Fix-C decision (direct .from vs RPC), settings toggle list, and any deferred features. Atomic commits use `feat(45-07a-NN:)` convention.
</output>
