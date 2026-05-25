---
phase: 45
plan: 07b
type: execute
wave: 2
depends_on: [45-07a]
files_modified:
  - leanshot/src/components/community/dm/DMInboxView.tsx
  - leanshot/src/components/community/dm/DMThreadView.tsx
  - leanshot/src/components/community/dm/DMComposer.tsx
  - leanshot/src/components/community/dm/DMAttachmentUploader.tsx
  - leanshot/vite.config.ts
  - leanshot/scripts/assert-bundle-budget.sh
  - leanshot/src/App.tsx
autonomous: true
requirements:
  - COMMUNITY-08
must_haves:
  truths:
    - "DMInboxView lists threads via direct query (RLS-gated participant-only) + unread count badge; subscribes via use-dm-inbox-realtime hook (from 45-07a) with channel dm:${userId}; on focus calls update_community_last_active RPC for 5-min debounce signal (D-20)"
    - "DMThreadView virtualizes message list via react-virtuoso (already in deps); body rendered via Phase 44 react-markdown + dompurify pipeline; attachments rendered via getDmAttachmentSignedUrl helper from 45-03; on mount calls update_community_last_active RPC"
    - "DMComposer ships 2000-char body cap + 1 image attachment via 45-03 helper; for NEW thread invokes dm-create-thread Edge Fn (45-04); for REPLY uses direct insert into direct_messages (no rate-limit on replies per D-07); on 429 from Fn toast 'You can only start 3 new conversations per day. Try again in N hours.'; on 403 'blocked' toast 'You can't message this person right now.'"
    - "DMAttachmentUploader caps at 5 MB; MIME whitelist reused from community-storage.ts (COMMUNITY_MEDIA_MIMES)"
    - "vite.config.ts manualChunks: community-directory (CommunityDirectoryView + ProfileCard + LeaderboardChip + ReportButton) AND community-dm (DM* files under src/components/community/dm/ + use-dm-inbox-realtime) BOTH placed BEFORE line ~206 community-feed catch-all (per RESEARCH Pitfall 6 + memory reference_bundle_budget_hash_hyphen)"
    - "scripts/assert-bundle-budget.sh has new ceilings: community-directory 10 kB gz, community-dm 35 kB gz"
    - "src/App.tsx 'community' currentTab branch extended to read activeCommunityView from store — NO new TabId, NO new <Route> (per memory reference_react_router_consumer_admin_split)"
    - "Web push subscription request honored on signed-in user opt-in for DM category (D-21) via Phase 42 usePushSubscription"
  artifacts:
    - path: "leanshot/src/components/community/dm/DMInboxView.tsx"
      provides: "Thread list + unread count + realtime subscription via use-dm-inbox-realtime"
      min_lines: 80
    - path: "leanshot/src/components/community/dm/DMThreadView.tsx"
      provides: "Virtualized message list + composer + attachment render + update_community_last_active call"
      min_lines: 120
    - path: "leanshot/src/components/community/dm/DMComposer.tsx"
      provides: "2000-char body + 1 attachment + dm-create-thread invoke (new) or direct insert (reply)"
      min_lines: 100
    - path: "leanshot/src/components/community/dm/DMAttachmentUploader.tsx"
      provides: "5 MB + MIME whitelist + upload to dm-attachments bucket"
      min_lines: 60
    - path: "leanshot/vite.config.ts"
      provides: "Two new manualChunk rules ordered BEFORE community-feed catch-all"
    - path: "leanshot/scripts/assert-bundle-budget.sh"
      provides: "community-directory and community-dm ceilings"
    - path: "leanshot/src/App.tsx"
      provides: "Community tab branch reads activeCommunityView for sub-view dispatch"
  key_links:
    - from: "leanshot/src/components/community/dm/DMComposer.tsx"
      to: "supabase/functions/dm-create-thread/index.ts"
      via: "supabase.functions.invoke('dm-create-thread')"
      pattern: "dm-create-thread"
    - from: "leanshot/src/components/community/dm/DMThreadView.tsx"
      to: "direct_messages table + dm-attachments bucket"
      via: "supabase.from('direct_messages').select + getDmAttachmentSignedUrl"
      pattern: "direct_messages"
    - from: "leanshot/src/components/community/dm/DMInboxView.tsx"
      to: "use-dm-inbox-realtime hook (45-07a)"
      via: "useDmInboxRealtime"
      pattern: "useDmInboxRealtime"
    - from: "leanshot/vite.config.ts"
      to: "manualChunks ordering"
      via: "id.includes('/src/components/community/dm/') return 'community-dm' (BEFORE community-feed catch-all)"
      pattern: "community-dm"
---

<objective>
Land Wave 2 sub-half B of Phase 45 consumer UI: DM inbox + thread + composer + attachment uploader + vite chunk ordering + bundle budget ceilings + App.tsx community-tab branch wiring. 7 files. Depends on 45-07a for store extension + use-dm-inbox-realtime hook + ReportButton + CommunityTabShell lazy-import declarations.

Purpose: Wave 2 second half — depends on 45-07a (sibling). Plan 45-09 close-out exercises this UI via HUMAN-UAT signals.

Output: 7 file changes (4 NEW DM components + 2 build config edits + 1 App.tsx branch). Sized as 3 tasks to fit ~50% context per task.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-RESEARCH.md
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md
@.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-07a-PLAN.md

# Primary analogs — copy verbatim shape
@leanshot/src/components/community/CommunityFeed.tsx
@leanshot/src/components/community/CommunityPostComposer.tsx
@leanshot/src/lib/community/community-storage.ts
@leanshot/src/lib/community/dompurify-config.ts
@leanshot/vite.config.ts
@leanshot/scripts/assert-bundle-budget.sh
@leanshot/src/App.tsx
</context>

<interfaces>
<!-- Consumed from 45-07a -->
- `useStore((s) => s.activeCommunityView)` — `'directory' | 'dm' | null` (3-variant union per Fix-B)
- `useStore((s) => s.activeDmThreadId)` — `string | null`
- `useStore((s) => s.setActiveDmThread)` — setter
- `useDmInboxRealtime(userId, onMessage)` — realtime hook from 45-07a
- `<ReportButton targetType="dm_message" targetId={message.id} />` — reusable from 45-07a

<!-- Consumed from 45-03 (Wave 0) -->
- `getDmAttachmentSignedUrl(path: string): Promise<string>` from `@/lib/community/community-storage`
- `DM_ATTACHMENT_MAX_BYTES`, `COMMUNITY_MEDIA_MIMES` from same file

<!-- Consumed from 45-04 (Wave 1) -->
- `supabase.functions.invoke('dm-create-thread', { body: { recipient_user_id, body, attachment_path?, creator_user_id } })`
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: DMInboxView + DMThreadView (virtualized; update_community_last_active on mount/focus)</name>
  <files>leanshot/src/components/community/dm/DMInboxView.tsx, leanshot/src/components/community/dm/DMThreadView.tsx</files>
  <read_first>
    - leanshot/src/components/community/CommunityFeed.tsx (role-match analog — list + skeleton + RLS-gated query)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"DMInboxView.tsx" + §"DMThreadView.tsx"
    - 45-07a-PLAN.md interfaces block (consumed exports)
    - leanshot/src/lib/community/community-storage.ts (getDmAttachmentSignedUrl signature)
  </read_first>
  <behavior>
    - DMInboxView: list of threads via direct supabase query (RLS gates to participant-only); per-thread: counterparty handle + last_message_at + unread count (count direct_messages WHERE thread_id = $1 AND created_at > last_read_at — simplest: just show last message preview without unread count; carry "unread badge" feature to v1.3-uat-deferred if needed); subscribes via useDmInboxRealtime from 45-07a; on new message arrival, refetches the inbox query; on focus calls `supabase.rpc('update_community_last_active')` for the 5-min debounce signal (D-20)
    - DMThreadView: virtualized message list via `import { Virtuoso } from 'react-virtuoso'`; fetches direct_messages WHERE thread_id=$1 ORDER BY created_at; rendered body via renderPostBodyHtml (Phase 44 dompurify); attachment_path rendered via `<img src={signedUrl} />` fetched via getDmAttachmentSignedUrl from 45-03; on mount calls `supabase.rpc('update_community_last_active')` for the 5-min debounce signal (D-20)
    - Both files mount `<ReportButton targetType="dm_message" targetId={message.id} />` on each message row (consumed from 45-07a)
  </behavior>
  <action>
    1. Create `leanshot/src/components/community/dm/DMInboxView.tsx`. Copy `CommunityFeed.tsx` skeleton (list + skeleton fallback). Replace data fetch with `supabase.from('dm_threads').select('id, creator_user_id, recipient_user_id, last_message_at, direct_messages!inner(body, created_at)').order('last_message_at', { ascending: false }).limit(50)`. Render each thread row with: counterparty handle (whichever side is not currentUserId), last_message_at, preview from last direct_messages row. Click → `setActiveDmThread(thread.id)`. Mount `useDmInboxRealtime(currentUserId, () => refetch())` at top. On window focus event, call `supabase.rpc('update_community_last_active')`.

    2. Create `leanshot/src/components/community/dm/DMThreadView.tsx`. Use react-virtuoso `<Virtuoso data={messages} itemContent={(idx, m) => <MessageRow message={m} />} />`. MessageRow renders sender handle + body via renderPostBodyHtml + attachment (if any) via signed URL + `<ReportButton targetType="dm_message" targetId={m.id} />`. On mount, call `supabase.rpc('update_community_last_active')`. Composer at bottom — render `<DMComposer threadId={threadId} recipientUserId={recipient} mode="reply" />` (DMComposer ships in Task 2).

    Per CLAUDE.md State Management rule: each useStore selector returns ONE primitive.
  </action>
  <acceptance_criteria>
    - Both files exist with named exports DMInboxView, DMThreadView
    - `grep -c "import { Virtuoso }" leanshot/src/components/community/dm/DMThreadView.tsx` returns ≥1 (or equivalent react-virtuoso import)
    - `grep -c "update_community_last_active" leanshot/src/components/community/dm/DMThreadView.tsx` returns ≥1
    - `grep -c "update_community_last_active" leanshot/src/components/community/dm/DMInboxView.tsx` returns ≥1
    - `grep -c "useDmInboxRealtime" leanshot/src/components/community/dm/DMInboxView.tsx` returns ≥1
    - `grep -c "ReportButton" leanshot/src/components/community/dm/DMThreadView.tsx` returns ≥1
    - `grep -rE "new DOMPurify\\(|createDOMPurify\\(" leanshot/src/components/community/dm/DMInboxView.tsx leanshot/src/components/community/dm/DMThreadView.tsx` returns no matches
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/community/dm/DMInboxView.tsx && test -f src/components/community/dm/DMThreadView.tsx && grep -c "import { Virtuoso }" src/components/community/dm/DMThreadView.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "update_community_last_active" src/components/community/dm/DMThreadView.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "useDmInboxRealtime" src/components/community/dm/DMInboxView.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && test $(grep -rE "new DOMPurify\\(|createDOMPurify\\(" src/components/community/dm/DMInboxView.tsx src/components/community/dm/DMThreadView.tsx | wc -l) -eq 0 && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>DM inbox + thread ship; both call update_community_last_active; ReportButton mounted; TypeScript compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: DMComposer + DMAttachmentUploader (5 MB cap; dm-create-thread for new; direct insert for reply)</name>
  <files>leanshot/src/components/community/dm/DMComposer.tsx, leanshot/src/components/community/dm/DMAttachmentUploader.tsx</files>
  <read_first>
    - leanshot/src/components/community/CommunityPostComposer.tsx (primary analog — copy attachment upload flow)
    - leanshot/src/lib/community/community-storage.ts (REUSE COMMUNITY_MEDIA_MIMES + DM_ATTACHMENT_MAX_BYTES from 45-03)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"DMComposer.tsx" + §"DMAttachmentUploader.tsx"
    - Phase 42 `usePushSubscription` hook location (grep `usePushSubscription` to find file path)
  </read_first>
  <behavior>
    - DMComposer: textarea + DMAttachmentUploader child (≤5 MB, MIME from COMMUNITY_MEDIA_MIMES); for NEW thread (composer rendered standalone, before thread exists): calls `supabase.functions.invoke('dm-create-thread', { body: { recipient_user_id, body, attachment_path, creator_user_id } })` and on 201 redirects to the new thread via setActiveDmThread; for REPLY (composer inside existing thread): direct insert into direct_messages (no rate limit per D-07); on 429 from Fn, toast "You can only start 3 new conversations per day. Try again in N hours."; on 403 'blocked' toast "You can't message this person right now."
    - DMAttachmentUploader: file input + size check + MIME check + upload to dm-attachments bucket via 45-03 storage helper; returns attachment_path string to parent via callback
    - Web push: on first DM compose (or settings toggle for DM push), call Phase 42 `requestPushPermission({ fromUserGesture: true })` per memory reference_vapid_keypair_supabase_setup if not yet subscribed; subscription category 'community-dm' per D-21
    - 2000-char body cap enforced client-side; server-side CHECK constraint backs it up (45-01 schema)
  </behavior>
  <action>
    1. Create `leanshot/src/components/community/dm/DMComposer.tsx`. Copy `CommunityPostComposer.tsx` for attachment upload pattern. Two modes via prop: `mode="new"` (no threadId yet — calls supabase.functions.invoke('dm-create-thread')) and `mode="reply"` (has threadId — direct insert into direct_messages). Use COMMUNITY_MEDIA_MIMES whitelist + DM_ATTACHMENT_MAX_BYTES cap from 45-03. On 429, toast with Retry-After hint. On 403 blocked, toast "You can't message this person right now." Render `<DMAttachmentUploader onUploaded={(path) => setAttachmentPath(path)} />` as the attachment child. On first compose, gate `requestPushPermission()` behind the user gesture (Phase 42 hook).

    2. Create `leanshot/src/components/community/dm/DMAttachmentUploader.tsx`. File input that validates file size against `DM_ATTACHMENT_MAX_BYTES` and MIME against `COMMUNITY_MEDIA_MIMES` (both imported from `@/lib/community/community-storage`); uploads to `dm-attachments` Storage bucket via 45-03 helper; returns the resulting attachment_path to parent via `onUploaded` callback. Show inline error toast on size/MIME violation.

    Per CLAUDE.md State Management rule: each useStore selector returns ONE primitive.
  </action>
  <acceptance_criteria>
    - Both files exist with named exports DMComposer, DMAttachmentUploader
    - `grep -c "dm-create-thread" leanshot/src/components/community/dm/DMComposer.tsx` returns ≥1
    - `grep -c "DM_ATTACHMENT_MAX_BYTES" leanshot/src/components/community/dm/DMAttachmentUploader.tsx` returns ≥1
    - `grep -c "COMMUNITY_MEDIA_MIMES" leanshot/src/components/community/dm/DMAttachmentUploader.tsx` returns ≥1
    - `grep -rE "new DOMPurify\\(|createDOMPurify\\(" leanshot/src/components/community/dm/DMComposer.tsx leanshot/src/components/community/dm/DMAttachmentUploader.tsx` returns no matches
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/community/dm/DMComposer.tsx && test -f src/components/community/dm/DMAttachmentUploader.tsx && grep -c "dm-create-thread" src/components/community/dm/DMComposer.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "DM_ATTACHMENT_MAX_BYTES" src/components/community/dm/DMAttachmentUploader.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "COMMUNITY_MEDIA_MIMES" src/components/community/dm/DMAttachmentUploader.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && test $(grep -rE "new DOMPurify\\(|createDOMPurify\\(" src/components/community/dm/DMComposer.tsx src/components/community/dm/DMAttachmentUploader.tsx | wc -l) -eq 0 && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>DM composer + attachment uploader ship; new-thread invokes Fn; reply direct-inserts; 5 MB + MIME caps enforced; TypeScript compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: vite manualChunks (BEFORE community-feed catch-all) + bundle budget ceilings + App.tsx community-tab branch</name>
  <files>leanshot/vite.config.ts, leanshot/scripts/assert-bundle-budget.sh, leanshot/src/App.tsx</files>
  <read_first>
    - leanshot/vite.config.ts (lines 195-210 — manualChunks ordering; identify line of community-feed catch-all)
    - leanshot/scripts/assert-bundle-budget.sh (chunk ceiling table; identify entry format)
    - leanshot/src/App.tsx (locate `currentTab === 'community'` branch)
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-PATTERNS.md §"vite.config.ts" + §"assert-bundle-budget.sh"
    - .planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-RESEARCH.md §Pitfall 6 (chunk ordering)
  </read_first>
  <behavior>
    - vite.config.ts manualChunks: INSERT 2 new rules BEFORE the existing `community-feed` catch-all (around line 206) — `community-directory` (CommunityDirectoryView, ProfileCard, LeaderboardChip, ReportButton) and `community-dm` (everything under src/components/community/dm/, plus use-dm-inbox-realtime.ts) per RESEARCH Pitfall 6 + 45-PATTERNS.md §"vite.config.ts"
    - assert-bundle-budget.sh: APPEND two new ceiling entries — "community-directory  10 ..." and "community-dm  35 ..." per 45-PATTERNS.md §"assert-bundle-budget.sh"
    - src/App.tsx: extend the `currentTab === 'community'` branch dispatch to read `activeCommunityView` from store — NO new TabId, NO `<Route>` — per memory `reference_react_router_consumer_admin_split`. The branch should fall through to `<CommunityTabShell />` which itself dispatches based on activeCommunityView (already done in 45-07a). This task verifies the App.tsx wiring is in place; if 45-07a's CommunityTabShell already handles dispatch internally, the App.tsx edit may be minimal (just confirm the existing community branch routes to the updated shell). Identify the exact change by reading App.tsx — if no change is needed, document so inline + add a comment marker for verification.
    - Production build must succeed and the 2 new chunks must appear in the manifest under 10 kB gz / 35 kB gz respectively
  </behavior>
  <action>
    1. vite.config.ts edit: Locate the line `if (id.includes('/src/components/community/')) return 'community-feed';` (around line 206). INSERT IMMEDIATELY ABOVE it:
       ```typescript
       // Phase 45 Plan 45-07b — community-directory + community-dm sub-chunks.
       // ORDER MATTERS: must appear BEFORE the community-feed catch-all below.
       if (id.includes('/src/components/community/CommunityDirectoryView') ||
           id.includes('/src/components/community/ProfileCard') ||
           id.includes('/src/components/community/LeaderboardChip') ||
           id.includes('/src/components/community/ReportButton')) return 'community-directory';
       if (id.includes('/src/components/community/dm/') ||
           id.includes('/src/components/community/use-dm-inbox-realtime')) return 'community-dm';
       ```

    2. scripts/assert-bundle-budget.sh edit: locate the existing community-feed and community-media ceiling rows. APPEND two new rows after them with the exact format the script uses (read the file first to confirm the row syntax — likely `"chunk-name  N  reason"` per 45-PATTERNS.md sample). Ceilings: community-directory 10 (kB gz), community-dm 35 (kB gz).

    3. src/App.tsx edit: locate the `currentTab === 'community'` branch. Confirm it routes to `<CommunityTabShell />` (which itself dispatches on activeCommunityView per 45-07a). If the existing branch already does this, add ONLY a comment marker `/* Phase 45 — sub-view dispatch handled inside CommunityTabShell */` so the grep gate has something to anchor against. If the branch was previously inline (rendering CommunitySpaceView directly), refactor to route through CommunityTabShell instead. NO new TabId is introduced; NO `<Route>` element is added.

    4. Verify production build: `cd leanshot && npm run build` succeeds. Then `bash scripts/assert-bundle-budget.sh` exits 0.
  </action>
  <acceptance_criteria>
    - vite.config.ts: the new community-directory + community-dm rules appear BEFORE the community-feed catch-all. Specifically: `awk 'BEGIN{a=0;b=0;c=0} /community-directory/ && !a {a=NR} /community-dm/ && !b {b=NR} /return .community-feed./ && !c {c=NR} END{exit (a>0 && b>0 && c>0 && a<c && b<c) ? 0 : 1}' leanshot/vite.config.ts` exits 0
    - `grep -cE "community-directory|community-dm" leanshot/scripts/assert-bundle-budget.sh` returns ≥2
    - `grep -c "currentTab === 'community'" leanshot/src/App.tsx` returns ≥1 (existing branch — must remain)
    - `grep -c "Phase 45" leanshot/src/App.tsx` returns ≥1 (the comment marker confirming this plan touched the file)
    - `cd leanshot && npm run build` exits 0
    - `cd leanshot && bash scripts/assert-bundle-budget.sh` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && awk 'BEGIN{a=0;b=0;c=0} /community-directory/ && !a {a=NR} /community-dm/ && !b {b=NR} /return .community-feed./ && !c {c=NR} END{exit (a>0 && b>0 && c>0 && a<c && b<c) ? 0 : 1}' vite.config.ts && grep -cE "community-directory|community-dm" scripts/assert-bundle-budget.sh | awk '$1 >= 2 {print "OK"; exit 0} {print "FAIL"; exit 1}' && grep -c "Phase 45" src/App.tsx | awk '$1 >= 1 {print "OK"; exit 0} {print "FAIL"; exit 1}' && npm run build && bash scripts/assert-bundle-budget.sh</automated>
  </verify>
  <done>vite chunks ordered correctly; bundle budget passes; App.tsx wiring confirmed; production build succeeds.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser→Postgres | Direct queries gated by RLS (dm_threads SELECT participant-only; direct_messages SELECT participant-only) |
| browser→Edge Fn | DMComposer invokes dm-create-thread with user JWT |
| browser→Storage | dm-attachments signed URL fetch via getDmAttachmentSignedUrl (45-03) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-45-01 | Information Disclosure | dm_threads SELECT | mitigate | RLS participant-only policy (45-01); client query unable to bypass |
| T-45-04 | DoS | new thread spam | mitigate | DMComposer surfaces 429 from Fn (Retry-After hint in toast); client cannot bypass server-side rate limit |
| T-45-05 | Tampering (XSS) | DM body render | mitigate | All DM bodies rendered via Phase 44 renderPostBodyHtml; NO new DOMPurify instantiation; grep gate in acceptance criteria |
| T-45-15 | Tampering | DM attachment MIME/size bypass | mitigate | Client-side check via COMMUNITY_MEDIA_MIMES + DM_ATTACHMENT_MAX_BYTES (45-03); server-side enforced by bucket policy |
</threat_model>

<verification>
- TypeScript compiles after all 3 tasks
- vite production build succeeds
- bundle-budget script passes (community-directory ≤10 kB gz, community-dm ≤35 kB gz)
- No new DOMPurify policy anywhere in 45-* files
- DM realtime uses dm:${userId} (consumed from 45-07a hook)
</verification>

<success_criteria>
- 4 new DM component files + 2 build config edits + 1 App.tsx wiring confirmation = 7 files ship
- 2 new manualChunk rules ordered BEFORE community-feed catch-all
- All DM body rendering routes through Phase 44 dompurify config
- update_community_last_active called on inbox focus + thread mount (D-20 debounce)
</success_criteria>

<output>
After completion, create `.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-07b-SUMMARY.md` documenting: 7 file changes, final chunk sizes from npm run build (cite the manifest), and any deferred features (e.g., unread-count badge if deferred). Cite the unread-count carry-over if deferred to v1.3-uat-deferred per memory feedback_milestone_uat_deferral_consolidation. Atomic commits use `feat(45-07b-NN:)` convention.
</output>
