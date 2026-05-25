---
phase: 45
plan: 07b
subsystem: community-dm
tags: [community, dm, realtime, virtuoso, vite-chunks, bundle-budget]
dependency_graph:
  requires: [45-07a, 45-04, 45-03, 45-01]
  provides: [DMInboxView, DMThreadView, DMComposer, DMAttachmentUploader, community-dm-chunk, community-directory-chunk]
  affects: [CommunityTabShell, vite.config.ts, scripts/assert-bundle-budget.sh, src/App.tsx]
tech-stack:
  added: []
  patterns: [react-virtuoso variable-height bubble list, Phase 44 renderPostBodyHtml sanitization reuse, supabase.functions.invoke FunctionsHttpError mapper, stub-then-replace per feedback_stub_then_replace_sibling_collision]
key-files:
  created:
    - leanshot/src/components/community/dm/DMInboxView.tsx
    - leanshot/src/components/community/dm/DMThreadView.tsx
    - leanshot/src/components/community/dm/DMComposer.tsx
    - leanshot/src/components/community/dm/DMAttachmentUploader.tsx
  modified:
    - leanshot/src/components/community/CommunityTabShell.tsx
    - leanshot/vite.config.ts
    - leanshot/scripts/assert-bundle-budget.sh
    - leanshot/src/App.tsx
  removed:
    - leanshot/src/components/community/DMInboxView.tsx (45-07a stub; superseded)
    - leanshot/src/components/community/DMThreadView.tsx (45-07a stub; superseded)
decisions:
  - "Move DM files under src/components/community/dm/ subdirectory so the community-dm vite manualChunk rule (id.includes('/dm/')) fires generically; delete the 45-07a stubs at the parent path and update CommunityTabShell to import from ./dm/* paths."
  - "Defer unread-count badge to v1.3-uat-deferred per memory feedback_milestone_uat_deferral_consolidation; inbox row shows last-message preview + relative timestamp instead. use-dm-inbox-realtime still wakes the inbox so new threads/messages re-rank in real-time."
  - "DMComposer maps supabase.functions.invoke errors via FunctionsHttpError.context.{status,headers,clone().json()}; surfaces 429 with Retry-After hours in the toast (D-07) and 403 dm_closed | dm_blocked with the generic blocked-user copy (D-06 + D-10)."
  - "react-virtuoso <Virtuoso> (variable-height) for DM messages; initialTopMostItemIndex pinned to last message and followOutput=smooth keeps the view glued to new arrivals."
metrics:
  duration: "~6 min planning + execution"
  completed_date: 2026-05-24
  tasks_completed: 3
  files_changed: 8
---

# Phase 45 Plan 07b: DM inbox + thread + composer + attachment uploader Summary

DM consumer surface lands: virtualized thread view with sanitized markdown bubbles, RLS-gated inbox with realtime wake, rate-limited new-thread composer via dm-create-thread Edge Fn, and 5 MB single-image attachments — all routed into a dedicated community-dm vite chunk (31.91 kB gz / 35 kB ceiling).

## What shipped

### Task 1 — DMInboxView + DMThreadView (commit `07acbfbd`)

- **DMInboxView** (`leanshot/src/components/community/dm/DMInboxView.tsx`):
  RLS-gated `dm_threads` list ordered by `last_message_at desc`, counterparty
  handle/display_name resolved via a second `profiles.in('id', [...])` query, and
  last-message preview via a single `direct_messages.in('thread_id', [...])` pass.
  Subscribes via `useDmInboxRealtime(currentUserId, refreshNonceBump)` (45-07a hook).
  On window focus calls `supabase.rpc('update_community_last_active')` (D-20
  5-min presence debounce; used by dm-create-thread Edge Fn to skip notify
  when the recipient is currently active).

- **DMThreadView** (`leanshot/src/components/community/dm/DMThreadView.tsx`):
  Variable-height bubble list via `react-virtuoso <Virtuoso>`; per-row body
  passes through Phase 44 `renderPostBodyHtml` (NO new DOMPurify instance —
  grep gate verifies). Attachments rendered via `getDmAttachmentSignedUrl`
  (45-03 helper) with a per-component `Map` cache so Virtuoso item re-renders
  don't re-sign. `<ReportButton targetType="dm_message" targetId={m.id} />`
  mounted per row. On mount calls `update_community_last_active` (D-20).
  Composer mounted at the bottom in `mode="reply"`.

- **CommunityTabShell** updated to import from `./dm/DMInboxView` and
  `./dm/DMThreadView` so the community-dm vite chunk rule routes them
  out of community-feed.

- The 45-07a final-prop-signature stubs at `community/DMInboxView.tsx` and
  `community/DMThreadView.tsx` are removed by this commit per the
  stub-then-replace sibling-collision pattern.

### Task 2 — DMComposer + DMAttachmentUploader (commit `31f0c086`)

- **DMComposer** (`leanshot/src/components/community/dm/DMComposer.tsx`):
  Two operating modes via prop:
    - `mode="new"` invokes `supabase.functions.invoke('dm-create-thread', { body: { recipient_user_id, body, attachment_path?, creator_user_id } })` and on 201 calls `setActiveDmThread(thread_id)` so the dispatcher flips to DMThreadView.
    - `mode="reply"` direct-inserts into `direct_messages` (no rate-limit per D-07; RLS gates participant + thread-not-deleted).
  Error mapper extracts `status` + body `code` + `Retry-After` header from
  `FunctionsHttpError.context` (Response object). 429 + Retry-After →
  "You can only start 3 new conversations per day. Try again in N hours."
  (D-07); 403 with `code in (dm_closed, dm_blocked)` →
  "You can't message this person right now." (D-06 + D-10).
  Body cap = 2000 chars client-side (matches `direct_messages.body_len_chk`
  CHECK in 45-01). On first compose calls
  `requestPushPermission({ fromUserGesture: true })` from the 42-RESEARCH
  Pitfall 3 helper — only when `Notification.permission === 'default'` so
  granted/denied users aren't re-prompted (D-21).

- **DMAttachmentUploader** (`leanshot/src/components/community/dm/DMAttachmentUploader.tsx`):
  Size guard against `DM_ATTACHMENT_MAX_BYTES` (5 MB per D-09) + MIME guard
  against `COMMUNITY_MEDIA_MIMES` (jpeg/png/webp — NO SVG per T-44-05),
  both imported from `@/lib/community/community-storage`. Path shape
  `${threadId}/${pendingMessageId}/${uuid}.${ext}` matches the 45-01 bucket
  policy participant JOIN. Server-side MIME + size remain the durable
  guarantee (T-45-15); client guards are UX fail-fast.

### Task 3 — vite chunks + bundle budget + App.tsx marker (commit `bc16d4c9`)

- **vite.config.ts** — Two new manualChunk rules inserted BEFORE the
  community-feed catch-all (per 45-RESEARCH Pitfall 6 + memory
  `reference_bundle_budget_hash_hyphen`):
    - `community-directory` matches CommunityDirectoryView, ProfileCard,
      LeaderboardChip, ReportButton.
    - `community-dm` matches `src/components/community/dm/*` + the
      `use-dm-inbox-realtime` hook.

- **scripts/assert-bundle-budget.sh** — New ceiling rows added:
    - `community-directory 10` (kB gz)
    - `community-dm 35` (kB gz)

- **src/App.tsx** — Phase 45 comment marker added above the
  `currentTab === 'community'` branch. NO new TabId, NO `<Route>` per memory
  `reference_react_router_consumer_admin_split`. The community-tab branch
  continues to route to `<CommunityTabShell />`, which itself dispatches on
  `activeCommunityView` (shipped in 45-07a).

## Build evidence (cited from `npm run build` output)

```
dist/assets/community-directory-6PfyjL7N.js  -> 3.23 kB gz  (ceiling 10)  OK
dist/assets/community-dm-6HMdMTri.js         -> 31.91 kB gz (ceiling 35)  OK
dist/assets/community-feed-DOr7Ruqx.js       -> 16.17 kB gz (ceiling 20)  OK
```

Full assert-bundle-budget.sh table:

```
admin-shell                       137       125.40       OK
cancellation                       13            0  MISSING
community-directory                10         3.23       OK
community-dm                       35        31.91       OK
community-feed                     20        16.17       OK
community-media                   320       298.41       OK
community-mentions                 12         1.16       OK
course-player                      30            0  MISSING
gamification-burst                  8         1.76       OK
helpdesk-widget                    25         3.97       OK
i18n-runtime                       25         7.96       OK
index                              50        26.28       OK
QuarterlyNPSModal                   5         1.67       OK
WhatsNewDrawer                    105         1.44       OK

PASS: all chunks within gz ceilings.
```

`npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` exits 0;
`bash scripts/assert-bundle-budget.sh` exits 0.

## Deviations from Plan

### [Rule 3 — Blocking issue] DM files moved into `dm/` subdirectory; 45-07a stubs removed; CommunityTabShell import paths updated

- **Found during:** Task 1 setup
- **Issue:** Plan `files_modified` listed `leanshot/src/components/community/dm/DMInboxView.tsx` and `dm/DMThreadView.tsx`, but the 45-07a sibling shipped stubs at the parent path (`leanshot/src/components/community/DMInboxView.tsx`). The plan's vite chunk rule keys on `id.includes('/src/components/community/dm/')` — if the new files lived at the parent path, the community-dm chunk rule would match nothing and the budget gate would log MISSING.
- **Fix:** Honor the plan's `dm/` subdirectory placement. Update
  `CommunityTabShell.tsx` to import from `./dm/DMInboxView` and
  `./dm/DMThreadView`. Delete the 45-07a stubs at the parent path
  (`git rm`) since their only purpose was to ship the final prop signature
  for sibling 45-07b — that purpose is now superseded by the real surface.
- **Files modified:** `leanshot/src/components/community/CommunityTabShell.tsx`
  (re-pointed lazy imports); deleted `leanshot/src/components/community/DMInboxView.tsx`
  and `leanshot/src/components/community/DMThreadView.tsx`.
- **Commit:** `07acbfbd`

### [Rule 1 — Bug] `.catch(...)` on PostgrestFilterBuilder returned by `supabase.rpc()`

- **Found during:** Task 1 tsc check
- **Issue:** The PostgrestFilterBuilder returned by `supabase.rpc('update_community_last_active')` is thenable but its TypeScript surface does not expose `.catch`. Initial code wrote `.rpc(...).catch(...)` which tsc rejects with TS2551.
- **Fix:** Wrap in `Promise.resolve(supabase.rpc(...)).then(noop, noop)` so the thenable is consumed via a Promise — preserves the best-effort "fire and forget" intent while keeping tsc happy.
- **Files modified:** `leanshot/src/components/community/dm/DMInboxView.tsx`, `leanshot/src/components/community/dm/DMThreadView.tsx`
- **Commit:** `07acbfbd` (folded into Task 1 before commit; not a separate commit)

### [Process] Task 1 ships a minimal DMComposer placeholder; Task 2 replaces it

- **Why:** DMThreadView (Task 1) imports DMComposer for its reply-mode mount. If Task 1 committed without DMComposer existing, tsc would fail. To honor atomic per-task commits, Task 1 includes a 30-line placeholder DMComposer that compiles + renders "Composer loading…"; Task 2's commit replaces it with the real 200-line implementation.
- **Tracked as:** Plan-intentional pattern, not a Rule N deviation. The placeholder shipped under the same `feat(45-07b): …` Task 1 commit; Task 2's commit message documents the replacement.

## Threat Flags

None. All new code routes through prior-phase chokepoints:
- Body rendering: Phase 44 `renderPostBodyHtml` (T-45-05 mitigation reused; no new DOMPurify).
- Attachment MIME/size: reused `COMMUNITY_MEDIA_MIMES` + `DM_ATTACHMENT_MAX_BYTES` (T-45-15 mitigation; bucket policy backstop).
- Edge Fn auth: `dm-create-thread` already enforces T-45-02 JWT-vs-body spoofing defense + D-07 rate-limit + D-06 dm_closed + D-10 symmetric block.
- Realtime channel: per-user `dm:${userId}` filter is RLS-gated to messages the user can already SELECT (T-45-01).

## Known Stubs

None. All shipped components are wired to live data sources:
- DMInboxView → `dm_threads` + `profiles` + `direct_messages` direct queries
- DMThreadView → `dm_threads` + `profiles` + `direct_messages` direct queries + `getDmAttachmentSignedUrl` (45-03)
- DMComposer → `supabase.functions.invoke('dm-create-thread')` (45-04) or `direct_messages` insert
- DMAttachmentUploader → `dm-attachments` Storage bucket upload (45-03)

## Deferred Features

- **Unread-count badge** (deferred to **v1.3-uat-deferred** per memory `feedback_milestone_uat_deferral_consolidation`): Inbox rows show last-message preview + relative timestamp. Realtime hook still wakes the inbox so new messages re-rank threads without manual refresh. Operator can ship the unread badge in a follow-on phase by adding a `last_read_at` column to `dm_threads` (or a `dm_thread_reads` join table) + a server-side count subquery.
- **Message pagination** (deferred to v1.3): DMThreadView fetches up to 500 messages on initial mount with `.limit(500)`. Threads exceeding 500 messages would need cursor pagination via `created_at` — not in scope for v1.2.
- **Soft-delete tombstone for DMs** (deferred to v1.3): `renderPostBodyHtml({ body, deleted_at: null })` already routes deleted_at:non-null bodies through `<em>[deleted]</em>` tombstone if v1.3 adds a `direct_messages.deleted_at` column. No call-site change needed.

## Plan 45-09 close-out signal

The 45-07b surface is exercised by Plan 45-09 close-out HUMAN-UAT signals
(per plan `<objective>`). The close-out plan should verify, end-to-end on
staging with two seed users:

1. Open Community tab → toggle to Directory sub-view → click a profile → click "Message" → DMComposer renders in `mode="new"`.
2. Send a first message → 201 from dm-create-thread → setActiveDmThread flips dispatcher → DMThreadView renders the new message at the bottom.
3. Recipient receives realtime INSERT on their `dm:${userId}` channel → inbox row re-ranks.
4. Reply from recipient → direct insert → sender's DMThreadView re-fetches via the inbox-realtime nonce.
5. Attach a 5 MB image → uploader posts to dm-attachments bucket → signed URL renders inline in the bubble.
6. Attempt to start a 4th new conversation in 24h → 429 + Retry-After → toast shows "Try again in N hours."

## Self-Check: PASSED

- File `leanshot/src/components/community/dm/DMInboxView.tsx` — FOUND
- File `leanshot/src/components/community/dm/DMThreadView.tsx` — FOUND
- File `leanshot/src/components/community/dm/DMComposer.tsx` — FOUND
- File `leanshot/src/components/community/dm/DMAttachmentUploader.tsx` — FOUND
- File `leanshot/vite.config.ts` — community-directory + community-dm rules present BEFORE community-feed catch-all (awk gate exits 0)
- File `leanshot/scripts/assert-bundle-budget.sh` — community-directory + community-dm rows present
- File `leanshot/src/App.tsx` — Phase 45 marker present in community-tab branch
- Commit `07acbfbd` — FOUND
- Commit `31f0c086` — FOUND
- Commit `bc16d4c9` — FOUND
- `tsc -p tsconfig.app.json --noEmit` — exit 0
- `npm run build` — exit 0
- `bash scripts/assert-bundle-budget.sh` — exit 0
- 45-07a stubs removed: `leanshot/src/components/community/DMInboxView.tsx` + `DMThreadView.tsx` — confirmed removed at HEAD (intentional deletions cited above)
