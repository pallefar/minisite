# Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Discovery layer on top of the Phase 44 community feed: a Skool-style member directory (profile cards with bio + links + 4 badges), opt-OUT 1:1 DMs (markdown + image attachments, 3 new threads/24h rate limit, full block + report-queue abuse mechanics), and per-space community leaderboards (rolling 7d score with anonymized handles + opt-IN + admin enablement, reusing Phase 35's matview/refresh/handle pattern). Lands the `community-directory` and `community-dm` chunks, new `direct_messages` / `dm_threads` / `dm_attachments` / `user_block_list` / `user_dm_settings` / `community_reports` / `community_space_leaderboard_matview` schema, and the `profiles.is_clinician_verified` column.

**Out of scope:** Moderation queue UI (→ Phase 48 consumes `community_reports`). FTS bio search (→ Phase 49 — v1 uses handle prefix). Per-org cross-space leaderboards. Group DMs / channels. Voice/video DMs.

</domain>

<decisions>
## Implementation Decisions

### Directory + Profile Card

- **D-01:** Profile card badges (ALL 4 enabled in v1):
  - **Tier badge** — reads `tier_effective.tier_label` (Free / Pro / Lifetime). Per-user `profiles.show_tier_badge boolean default true` toggle.
  - **Level badge** — reads gamification level (Phase 35). Auto-hidden for users who opted out of leaderboards per Phase 35 D-12 (respects the same opt-IN posture).
  - **Verified-clinician badge** — new column `profiles.is_clinician_verified boolean default false`. Admin sets via `/admin/profiles/{user_id}` action; no self-claim. Trust signal especially in DMs (rate-limit bypass — see D-08).
  - **Streak badge** — current streak length from gamification streaks table. Per-user `profiles.show_streak_badge boolean default true` toggle (privacy: reveals usage cadence).
- **D-02:** Default directory visibility = TWO-MODE:
  - **Consumer users** (`org_members.org_id IS NULL` — no clinic org) → visible to all opted-in directory members community-wide.
  - **Clinic-org members** → visible ONLY to same-`org_id` members via RLS (`exists (select 1 from org_members om where om.user_id = profiles.user_id and om.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))`). Enforces Phase 28 cross-tenant isolation strictness.
- **D-03:** Per-user directory opt-IN via `profiles.directory_opt_in boolean default false`. User must explicitly enable in Settings → Community → "Show me in the directory" before their card renders to anyone. Mirrors Phase 35 leaderboard opt-IN privacy default. Onboarding nudge surfaces after the user posts their 5th community post (single-event, never re-prompted if dismissed).
- **D-04:** Directory search = **handle prefix + tier filter ONLY** in v1. Query shape: `WHERE handle ILIKE $1 || '%' AND ($2 IS NULL OR tier_label = $2)`. No Postgres FTS now — Phase 49 owns FTS infrastructure and will retrofit a `tsvector` column on `profiles.bio` + handle. v1 pagination: `(handle, user_id)` cursor.
- **D-05:** Profile bio shape — markdown subset reusing the **community dompurify config from Phase 44** (`src/lib/community/dompurify-config.ts`); 500-char cap; same FORBID_TAGS:['img'] policy. Links field: structured `profiles.links jsonb` array of `{ label: string, url: string }` with HTTPS-only URL validation; max 5 entries.

### DMs — Opt-out + Rate + Body + Abuse

- **D-06:** Per-user DM toggle = **OPEN by default** (`profiles.dm_open boolean default true`). User can flip to closed in Settings → Community → "Allow new DMs". Maximizes community-building; harassment vector closed by the rate limit + block + report combo below.
- **D-07:** Rate limit = **3 new DM threads per 24h per user** (sender side). Enforced via `count(*) FROM dm_threads WHERE creator_user_id = $me AND created_at >= now() - interval '24 hours'`. Hard cap returns 429 with `Retry-After`. Reply messages within an existing thread are NOT rate-limited.
- **D-08:** **Verified-clinician bypass** — users with `profiles.is_clinician_verified = true` skip the rate limit (useful when a clinic admin onboards N patients in a session). Bypass is logged in `dm_thread_audit` for moderation review.
- **D-09:** DM body shape = **markdown subset (reuses Phase 44 dompurify config) + image attachments**. Per-message: 2000-char body cap; ONE image attachment max; 5 MB attachment cap; MIME whitelist `image/jpeg | image/png | image/webp` (same as community-media bucket). Storage path: `dm-attachments/{thread_id}/{message_id}.{ext}`. Signed URL TTL 60 min. NEW Storage bucket `dm-attachments` (private; RLS: SELECT signed-only, INSERT by thread participant, DELETE by author).
- **D-10:** Block mechanic = **full-featured in v1**:
  - New table `user_block_list (blocker_user_id uuid, blocked_user_id uuid, created_at timestamptz, PRIMARY KEY (blocker_user_id, blocked_user_id))`.
  - When user A blocks B: A no longer sees B's posts/comments/reactions/profile/DM threads (client-side hides + server-side RLS blocks new DM thread creation from B → A).
  - B is NOT told they are blocked (only that "you cannot start a thread with this user").
- **D-11:** Report mechanic = **queue table consumed by Phase 48 later**:
  - New table `community_reports (id uuid, reporter_user_id, target_type text CHECK IN ('post','comment','dm_message','profile'), target_id uuid, reason text, status text default 'open', created_at)`.
  - Phase 45 ships the report-write API + a "Report" UI button on posts / comments / DMs / profile cards. NO moderation UI in v1 — Phase 48 consumes the queue.
  - Admin (per `public.is_staff()`) receives a daily digest email summarizing open report counts so reports aren't invisible until Phase 48 ships.

### Leaderboard — Rolling 7d, Per-Space, Phase 35 Reuse

- **D-12:** Score formula = `posts × 3 + comments × 1 + reactions_received × 1`. Posts weighted highest (creation cost). No mentions weight; no edit-penalty (YAGNI). Reactions_received is the per-author aggregate (across all their posts + comments in the period). Computed in the matview via JOIN to `community_reactions`.
- **D-13:** Period = **rolling 7d** (mirrors Phase 35 D-16 exactly). Matview filters on `created_at >= now() - interval '7 days'`. **Note (Claude's Discretion):** the roadmap success criterion #3 says "top contributors per space + per month" — interpreting "per month" as the display granularity / publication cadence (which a 7d-rolling view satisfies via continuous refresh), NOT a calendar-month window. If planner / plan-checker disagrees, the operator override is to keep rolling 7d for Phase 35 alignment.
- **D-14:** Scope = **per-space leaderboard ONLY**, gated on `community_spaces.leaderboard_enabled boolean default false` (mirrors Phase 35 D-11 `cohort_definitions.leaderboard_enabled`). Admin curates which spaces get a leaderboard (e.g., 'Trial month tips' yes; 'GLP-1 starters' no — same psychological-fit logic). No cross-space / per-org leaderboards in v1.
- **D-15:** Tier visibility = **leaderboard mirrors space tier-gating**. A Free user sees a Pro-only space's leaderboard ONLY if they have access to the space itself. RLS predicate on `community_space_leaderboard_matview` reuses the same `min_tier` check from Phase 44 D-08. Locked-card UX (Phase 44) shows "Upgrade to Pro to see this leaderboard" with `/pricing` CTA.
- **D-16:** Anonymization = **reuses Phase 35 D-13 handle scheme** (`profiles.leaderboard_handle` already exists from Phase 35; same `<theme>-<rand4digit>` default + 6-24-char alphanumeric overrideable). Cross-space handle is the SAME handle (one canonical leaderboard_handle per user, distinct from `profiles.handle` which is non-anonymized and used in directory + DMs).
- **D-17:** Display = **top-10 + user's ±5 neighborhood** (mirrors Phase 35 D-14 verbatim). Refresh = **15-min pg_cron matview** (`community_space_leaderboard_matview`) reusing the Phase 35 cron pattern. Opt-IN via Phase 35's `profiles.leaderboard_opt_in` flag (UNIFIED with the gamification leaderboard — user opts in once, appears on both).

### Realtime + Notifications for DMs

- **D-18:** Realtime delivery = **per-user inbox channel** (`supabase.channel(\`dm:${me.user_id}\`).on('postgres_changes', { table: 'direct_messages', filter: \`recipient_user_id=eq.${me.user_id}\` })`). 1 channel per logged-in user, lifecycle tied to session. Channel teardown on logout via `useEffect` cleanup. No per-thread nested channel.
- **D-19:** In-app notification = **toast + unread-count badge in nav**. Toast renders when user is NOT on `/community/dm`; persists 5s with "Open" CTA. Unread count badge in MobileNav + Sidebar 'community' tab + the DM inbox sub-tab; clears as user reads each thread. Toast respects `prefers-reduced-motion` per project a11y conventions.
- **D-20:** Email cadence = **single email per new DM**, debounced by **5-minute in-app activity window** (skip the email if user has POSTed/REACTed/READ within last 5 min — they're already in-app and the toast handles it). Uses Phase 44 `notify-community` Edge Fn extended with a new event kind `dm_new`. Email category = NEW `community-dm` (widen the notification CHECK constraints AGAIN — same atomic pattern as Phase 44 44-02; planner must catch this).
- **D-21:** Push notification = **web push on for opted-in users** (reuses Phase 42 PWA push infrastructure). Push body shows `<sender handle>` + first 80 chars of message body (post-dompurify). Push respects the same 5-min activity debounce as email.

### Claude's Discretion

- Phase 35 leaderboard handle column reuse: confirm `profiles.leaderboard_handle` already exists (it should from Phase 35); if not, planner adds the column.
- Streak badge data source — researcher confirms the exact column / view name from Phase 35 streaks shipping.
- DM attachment image MIME guard: reuse the exact list from `src/lib/community/community-storage.ts` (Wave 0 Phase 44 ships the constants `COMMUNITY_MEDIA_MIMES` + `COMMUNITY_MEDIA_MAX_BYTES`).
- Whether "Report" button on DMs follows Phase 44 dompurify + tombstone-on-soft-delete or has a separate UX — recommend reuse to avoid pattern proliferation.
- "Daily digest of open reports" email template — single new template `admin-community-reports-digest`; reuses email-router widening pattern.
- Roadmap "per month" → rolling 7d interpretation (see D-13) — flag for planner; operator overrides if plan-checker objects.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 45 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 45 (lines 608–619) — Goal, dependencies, success criteria, requirements binding
- `.planning/REQUIREMENTS.md` §COMMUNITY-07..09 (lines 260–262) — Requirement-by-requirement scope

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/44-m4-community-feed-foundation/` — Community schema (D-01..D-15) + `community-feed` chunk + Phase 44 dompurify config + `community-media` Storage bucket pattern + `notify-community` Edge Fn fan-out + `tier_effective` consumption. Phase 45 EXTENDS, does not duplicate.
- `.planning/phases/35-m3-gamification-engine-complete-approved-automated-verify-onl/` — Leaderboard mechanics (D-11 admin opt-in flag; D-12 user opt-IN; D-13 anonymized handle scheme; D-14 top-10 + ±5; D-15 opt-out cycle; D-16 rolling 7d; 15-min pg_cron matview pattern). Phase 45 REUSES the matview pattern + handle scheme + opt-in flag — `profiles.leaderboard_handle` + `profiles.leaderboard_opt_in` are SHARED across gamification leaderboard and community leaderboard.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/` — `org_members` + cross-tenant RLS strictness. Clinic-org directory visibility (D-02) MUST follow this pattern.
- `.planning/phases/43-m4-membership-tiers-extension/` — `tier_effective` view for all tier badging (D-01 tier badge, D-15 leaderboard tier visibility).
- `.planning/phases/42-v1-3-polish-closeout/` — Web push infrastructure (D-21). Phase 45 reuses the push-send Edge Fn from 42-09 (or whatever plan owns push).
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/` — DM messages are CONSUMER non-PHI (community = not subject to SES carve-out); Resend channel correct. PII redaction in Sentry / PostHog still applies to DM bodies.

### Shared Infrastructure (re-use, don't re-invent)

- `src/lib/community/dompurify-config.ts` (Phase 44) — reuse for profile bios + DM message bodies + DM image-attachment captions. NO new dompurify policy.
- `src/lib/community/community-storage.ts` (Phase 44) — signed-URL helper + MIME whitelist + size cap constants. Reuse for `dm-attachments` bucket; do NOT fork.
- `src/components/community/use-space-realtime.ts` (Phase 44) — Realtime lifecycle hook pattern. New `src/components/community/use-dm-inbox-realtime.ts` follows the same shape (mount/unmount, error backoff, filter rebind on auth change).
- `supabase/functions/notify-community/index.ts` (Phase 44) — Fan-out pattern + dual-auth (service-role OR user JWT). Phase 45 extends `kind` enum with `'dm_new'`; same fan-out shape (single recipient for DMs vs N mentioned users).
- `supabase/functions/_shared/email-router.ts` (Phase 44) — Template union + subjectFor + renderTemplate. Add `community_dm_new` + `community_admin_report_digest` templates.
- `scripts/assert-bundle-budget.sh` (Phase 24) — bundle budget asserter. NEW chunks `community-directory` (10 kB gz) and `community-dm` (35 kB gz; includes message list virtualization).
- Phase 35 matview definition + 15-min `pg_cron` schedule — model the new `community_space_leaderboard_matview` after `cohort_membership_matview` / Phase 35 leaderboard matview. Keep refresh cadence identical (15 min).
- Phase 42 web push — `useWebPushSubscription` hook / push-send Edge Fn already shipped. Phase 45 calls into it for D-21.

### External Library Refs (for researcher's Context7 sweep)

- `react-virtuoso` (already in deps) — message-list virtualization for DM thread view (large threads).
- `supabase-js` v2 channel API — same version Phase 44 uses; no new dep.
- Phase 44's `react-markdown` + `dompurify` + `rehype-raw` — reuse pipeline; no new deps for body rendering.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 44 community schema** ships `community_spaces`, `community_posts`, `community_comments`, `community_reactions`, `community_post_mentions`, `community_comment_mentions`, `community_post_media` + RLS + `tier_effective` integration. Phase 45 leaderboard matview JOINs these tables for score computation; no schema duplication.
- **Phase 44 dompurify-config + react-markdown render pipeline** at `src/lib/community/dompurify-config.ts` + `src/components/community/CommunityPost.tsx` — reusable for profile bio (D-05) and DM message body (D-09) with the SAME `FORBID_TAGS:['img']` policy. Image attachments flow through the upload pipeline (D-09), not inline markdown.
- **Phase 44 `community-media` Storage bucket** pattern — RLS predicate `(storage.foldername(name))[1] = auth.uid()::text` + MIME whitelist + size cap. Phase 45 creates `dm-attachments` bucket with the SAME RLS shape but path-prefix `dm-attachments/{thread_id}/`.
- **Phase 44 `notify-community` Edge Fn** with dual-auth (service-role OR user JWT) — extend `kind` to include `'dm_new'`; single-recipient fan-out (vs Phase 44 N-mention fan-out).
- **Phase 35 leaderboard matview + 15-min pg_cron** (cohort-scoped). Phase 45 ADDS `community_space_leaderboard_matview` using identical refresh cadence; reuses `profiles.leaderboard_handle` + `profiles.leaderboard_opt_in` from Phase 35.
- **Phase 42 web push** — `usePushSubscription` + push-send Edge Fn. Reuse for D-21 DM push notification.
- **Phase 44 Zustand 'community' TabId pattern** — Phase 45 adds sub-tabs INSIDE the community shell (Spaces / Directory / DMs) rather than a new top-level TabId. Drill-in via `activeCommunityView: 'feed' | 'directory' | 'dm' | 'space:<id>'` field.

### Established Patterns

- **Notification CHECK widening is atomic** (per Phase 44 44-02 + memory `feedback_planner_missed_status_enum_widening`). Phase 45 widens the 4 CHECK constraints AGAIN to include `'community-dm'` (and possibly `'community-admin-report'` for the admin digest). ONE migration + email-router widening + notification-send VALID_CATEGORIES widening in the SAME plan/wave.
- **Bundle ceiling per Phase 24** — `assert-bundle-budget.sh` table extended with `community-directory` (10 kB gz) and `community-dm` (35 kB gz; bigger because of message virtualization + attachment uploader). Sub-chunk rules in `vite.config.ts` MUST go before any `community/` catch-all.
- **`public.is_staff()` SECDEF function** (per memory `reference_supabase_is_staff_helper`) — admin write access on `community_reports.status` updates uses `public.is_staff()`. Phase 45 does NOT reintroduce a `staff_users` join (per memory `feedback_negation_grep_defeated_by_comment_string`).
- **Consumer surface uses Zustand TabId, not react-router** (per memory `reference_react_router_consumer_admin_split`). Directory / DM inbox / DM thread navigation = local Zustand state + URL hash for share-links (NOT `<Route>`).
- **Admin SpaceEditor uses pathname-based routing matching ReviewsLayout** (per memory refinement). The Phase 45 admin surface for `community_reports` digest + per-space `leaderboard_enabled` toggle continues the pathname-based pattern.

### Integration Points

- **`community-dm-leaderboard-handle` cron** — single 15-min pg_cron job refreshes BOTH `community_space_leaderboard_matview` (Phase 45) AND any existing Phase 35 leaderboard matview (already running). Avoid 2 separate crons; one statement, multiple `REFRESH MATERIALIZED VIEW CONCURRENTLY` calls.
- **Admin report digest** — daily 9am UTC `pg_cron` job calls a new `community-admin-report-digest` Edge Fn → emails opted-in admins (`profiles.is_staff = true AND profiles.admin_digest_opt_in = true`) a summary table.
- **`community_reports.target_id` polymorphic FK** — no DB-level FK constraint (would require multi-table union); enforced via application code + Phase 48's moderation queue. Document explicitly in the migration so future plan-checkers don't try to add the constraint.
- **`block_list` cascade on DM thread creation** — RLS predicate on `dm_threads` INSERT must check `NOT EXISTS (SELECT 1 FROM user_block_list WHERE blocker_user_id = recipient AND blocked_user_id = creator)`. Symmetric block check.

</code_context>

<specifics>
## Specific Ideas

- Skool's directory aesthetic — compact card with avatar + name + tier + level + 2-line bio + 3 link icons + "Message" CTA. Reuse the design-system bundle visual language.
- 3 DM threads/24h is intentionally Slack-tight, not Skool-loose (Skool defaults to 5). Combined with verified-clinician bypass, this protects users without blocking legitimate clinician outreach.
- Leaderboard handle UNIFICATION across gamification + community is a deliberate consolidation — users pick ONE anonymized handle once, used everywhere. Prevents handle proliferation confusion.
- "Report" button is a stub-then-replace pattern for Phase 48: Phase 45 writes rows; Phase 48 reads them. Avoids cross-phase coupling beyond a single table.

</specifics>

<deferred>
## Deferred Ideas

- **FTS bio search** — handle-prefix only in v1; Phase 49 owns FTS infrastructure and will retrofit `tsvector` on `profiles.bio`.
- **Per-org cross-space leaderboards** — clinic-org-wide leaderboards across all org-private spaces. Defer to Phase 48/49 or post-v1.3.
- **Group DMs / channels** — 1:1 only in v1. Group threading complicates the rate-limit math + notification fan-out.
- **Voice / video DMs** — out of scope; Mux is Phase 44/46 video, not real-time A/V.
- **Calendar-month leaderboard period** — Rolling 7d in v1; calendar-month leaderboard tab deferred until users ask.
- **DM message reactions (5-emoji set from Phase 44)** — defer; DMs stay text+image. Possibly add post-v1.3.
- **DM message edit / delete** — out of scope v1 (Phase 44 covers edit/delete for posts/comments; DMs ship immutable in v1).
- **Phase 39 paywall-variant routing on locked-leaderboard CTA** — generic `/pricing` for v1 (consistent with Phase 44 D-08).
- **Moderation queue UI** — Phase 48 consumes `community_reports`; v1 = write-only.

</deferred>

---

*Phase: 45-M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard*
*Context gathered: 2026-05-23*
