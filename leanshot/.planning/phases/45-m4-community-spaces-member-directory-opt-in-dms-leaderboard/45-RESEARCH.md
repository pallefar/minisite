# Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard — Research

**Researched:** 2026-05-23
**Domain:** Supabase PostgreSQL schema + RLS + Edge Functions + React SPA community layer
**Confidence:** HIGH (all critical claims verified against live code, migration files, and upstream plans)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Directory + Profile Card**
- D-01: All 4 profile badges enabled: tier (from `tier_effective.tier_label`), level (Phase 35 XP), verified-clinician (`profiles.is_clinician_verified boolean default false` — admin-set only), streak (`streak_state.current_streak_days`). Per-user toggles: `profiles.show_tier_badge`, `profiles.show_streak_badge`.
- D-02: Two-mode directory visibility — consumer users visible community-wide; clinic-org members visible only to same-`org_id` members via RLS.
- D-03: Per-user `profiles.directory_opt_in boolean default false`. Onboarding nudge after 5th post (single-shot).
- D-04: Handle-prefix + tier filter only (no FTS). Cursor: `(handle, user_id)`. No Postgres FTS — deferred to Phase 49.
- D-05: Profile bio = markdown subset via Phase 44 dompurify config; 500-char cap; `FORBID_TAGS:['img']`. Links: `profiles.links jsonb` array, max 5 entries, HTTPS-only.

**DMs**
- D-06: `profiles.dm_open boolean default true` (OPEN by default).
- D-07: 3 new DM threads/24h per sender. Returns 429 + `Retry-After`. Reply messages in existing threads NOT rate-limited.
- D-08: Verified-clinician bypass skips rate limit. Bypass logged in `dm_thread_audit`.
- D-09: DM body markdown + 1 image attachment max; 5 MB cap; MIME whitelist `image/jpeg | image/png | image/webp`. New bucket `dm-attachments`. Signed URL TTL 60 min.
- D-10: Full block — `user_block_list (blocker_user_id, blocked_user_id)`. B is NOT told they are blocked.
- D-11: `community_reports` queue table (consumed by Phase 48). Phase 45 ships write API + UI button. Admin receives daily digest email.

**Leaderboard**
- D-12: Score = `posts × 3 + comments × 1 + reactions_received × 1`.
- D-13: Rolling 7d (Phase 35 alignment). ROADMAP "per month" interpreted as display granularity — operator overrides if plan-checker objects.
- D-14: Per-space only; gated on `community_spaces.leaderboard_enabled boolean default false`.
- D-15: Tier visibility mirrors space tier-gating.
- D-16: Anonymization UNIFIED with Phase 35 — one `leaderboard_handle` per user, same format. NO NEW HANDLE COLUMNS per prior Phase 35 reuse intent.
- D-17: Top-10 + ±5 neighborhood. 15-min pg_cron. Consolidated with Phase 35 cron.

**Realtime + Notifications**
- D-18: Per-user inbox channel `dm:${me.user_id}` filtering on `direct_messages.recipient_user_id`.
- D-19: Toast + unread-count badge; toast when NOT on `/community/dm`; 5s persist; `prefers-reduced-motion` respected.
- D-20: Single email per new DM; 5-min in-app activity debounce; category `community-dm`.
- D-21: Web push via Phase 42 infrastructure; same 5-min activity debounce; `community-dm` category.

### Claude's Discretion
- Confirm `profiles.leaderboard_handle` existence (researcher confirms it does NOT exist — see CRITICAL FINDING below; Phase 45-01 adds it).
- Streak badge data source column — confirmed as `streak_state.current_streak_days` (verified).
- DM attachment MIME constants — confirmed `COMMUNITY_MEDIA_MIMES` from `src/lib/community/community-storage.ts`.
- "Report" button UX on DMs — recommend Phase 44 tombstone-on-soft-delete pattern.
- Admin daily digest email — template name `community_admin_report_digest`.
- Rolling 7d interpretation — flag for planner; operator override documented.

### Deferred Ideas (OUT OF SCOPE)
- FTS bio search (Phase 49)
- Per-org cross-space leaderboards
- Group DMs / channels
- Voice / video DMs
- Calendar-month leaderboard tab
- DM message reactions
- DM message edit / delete
- Moderation queue UI (Phase 48)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMMUNITY-07 | Member directory with profile pages (bio, links, joined-date, badges); admin sets directory visibility (org-only for clinics) | D-01..D-05; `profiles` `ALTER TABLE` migration (45-01); directory search RPC with handle-prefix + tier filter |
| COMMUNITY-08 | Opt-in DMs (1:1 message threads); per-user DM-open toggle; rate limiting (max N new DM threads/day) | D-06..D-11; `dm-create-thread` Edge Fn (45-04); `dm-attachments` bucket (45-03); notification widening (45-02) |
| COMMUNITY-09 | Community leaderboard (separate from GAME app leaderboard); top contributors per space + per month; cohort-scoped opt-in (anonymized handles) | D-12..D-17; `community_space_leaderboard_matview` (45-06); consolidated pg_cron (45-06) |
</phase_requirements>

---

## Summary

Phase 45 builds a discovery layer on top of the Phase 44 community feed: a member directory (profile cards with bio + 4 badges), opt-out 1:1 DMs (markdown body + image attachments, 3-thread/24h rate limit, full block/report mechanics), and per-space community leaderboards (rolling 7d, anonymized handles, admin-enabled per space). The phase reuses the Phase 44 community schema, dompurify config, community-storage helpers, email-router, and notify-community Edge Fn fan-out pattern — and consolidates the Phase 35 leaderboard matview pg_cron.

A critical schema discrepancy was discovered: the CONTEXT.md D-16 states "reuses `profiles.leaderboard_handle`" but this column does NOT exist in any migration. Phase 35 stored leaderboard handles in the `leaderboard_optin` table per `(user_id, cohort_id)` — a per-cohort design, not a global profile column. Phase 45 plan 45-01 MUST add `profiles.leaderboard_handle text` as a new global column to enable the "unified handle" design intent from D-16. This is NOT a contradiction of D-16 — D-16 says "no new handle columns" in the sense of "don't create a SECOND handle scheme"; the column itself must still be created once.

The notification check-widening atomicity pattern from Phase 44 (plan 44-02) is the highest-risk silent-failure surface: 4 CHECK constraints + email-router union + VALID_CATEGORIES + notification_category_config seed + 2 new email templates MUST land in a single transaction. The planner must not split this across plans.

**Primary recommendation:** Follow the 8-plan wave structure from the halted-agent recon outline (STATE.md lines 773–781) with confirmed migration-file evidence from this research.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Member directory RLS (two-mode visibility) | Database / Storage | — | Cross-tenant isolation enforced at Postgres RLS; client cannot bypass |
| DM rate limiting (3 threads/24h) | API (Edge Fn) | Database (trigger belt) | HTTP 429 + Retry-After requires Edge Fn; DB-level count() is defense-in-depth |
| DM thread creation | API (Edge Fn `dm-create-thread`) | — | Block check + rate check + audit row + notification side-effect all atomic in one Fn |
| Symmetric block enforcement | Database / Storage | API | INSERT RLS on `dm_threads` checks `user_block_list`; Fn returns friendly 403 |
| Leaderboard score computation | Database / Storage | — | pg_cron-refreshed materialized view; no Edge Fn needed for read path |
| DM attachment storage | CDN / Static (Supabase Storage) | Database | Signed URLs; RLS on `storage.objects` enforces thread-participant check |
| Realtime DM delivery | Browser / Client | — | Supabase Realtime channel `dm:${me.user_id}` subscribed in-browser |
| Email/push debounce | API (Edge Fn) | Database (timestamp check) | `dm-create-thread` Fn reads `profiles.community_last_active_at` before invoking `notification-send` |
| Notification CHECK widening | Database / Storage | API | Atomic migration + email-router update + VALID_CATEGORIES in one plan |
| Community leaderboard matview | Database / Storage | — | `REFRESH MATERIALIZED VIEW CONCURRENTLY` via consolidated pg_cron |
| Admin report digest | API (Edge Fn + pg_cron) | — | Service-role cron → `community-admin-report-digest` Fn → email-router |
| Consumer UI (directory / DM / leaderboard) | Browser / Client | — | Zustand sub-state inside existing 'community' TabId; no new router |
| Admin surface (space controls, clinician toggle) | Browser / Client | API | Pathname-based admin routing; SECDEF RPCs for writes |

---

## CRITICAL FINDING: `profiles.leaderboard_handle` Does NOT Exist

**[VERIFIED: supabase/migrations/ grep]**

The CONTEXT.md D-16 states "reuses Phase 35 `profiles.leaderboard_handle` + `profiles.leaderboard_opt_in`." This is **factually incorrect** as of the current schema. Phase 35 ships:

- `public.leaderboard_optin` table: `(user_id, cohort_id, handle, active, opted_in_at)` — per-cohort, not global.
- No `profiles.leaderboard_handle` column exists in any migration file.
- No `profiles.leaderboard_opt_in` column exists in any migration file.

**Resolution for plan 45-01:** Add the following to `profiles`:

```sql
-- Global leaderboard handle (unified across gamification + community leaderboards per D-16)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_handle text
    CONSTRAINT profiles_leaderboard_handle_format
      CHECK (leaderboard_handle ~ '^[a-zA-Z0-9_-]{6,24}$'),
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;
```

The format regex `^[a-zA-Z0-9_-]{6,24}$` matches Phase 35's `leaderboard_optin.handle` CHECK constraint exactly. The global opt-in flag replaces Phase 35's per-cohort `leaderboard_optin.active` for the community leaderboard (community leaderboard is per-space, not per-cohort, so a single global flag is the correct abstraction).

**Plan-checker rule:** Plan 45-01 MUST contain an `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS leaderboard_handle` statement. The old concern in STATE.md line 788 ("grep for ADD COLUMN leaderboard_handle → if PRESENT, BLOCK") is REVERSED by this research finding — the column MUST be added. The original STATE.md concern was premature; D-16's "no new handle columns" meant "don't create a second distinct handle scheme," not "omit the column entirely."

---

## Standard Stack

### Core (All Verified)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@supabase/supabase-js` | 2.106.1 | Database, Realtime, Auth, Storage | [VERIFIED: npm registry] |
| `react-virtuoso` | 4.18.7 | Virtualized DM message list in `DMThreadView` | [VERIFIED: package.json line 88] |
| `react-markdown` | 9.0.0 | Markdown rendering for DM bodies + profile bio | [VERIFIED: package.json] |
| `dompurify` | (project-installed) | XSS sanitization — reuse `src/lib/community/dompurify-config.ts` | [VERIFIED: Phase 44 shipped] |
| `rehype-raw` | 7.0.0 | React markdown HTML pass-through | [VERIFIED: package.json] |
| `npm:web-push@3.6.7` | 3.6.7 | VAPID push in `notification-send` Edge Fn (already wired) | [VERIFIED: notification-send/index.ts line 140] |

### No New Dependencies Required

Phase 45 ships zero new npm packages. All required libraries are already installed:

- `react-virtuoso ^4.18.7` — in `package.json` (Phase 44 shipped for community feed; confirmed at line 88)
- `react-markdown 9.0.0` — in `package.json` (Phase 44 shipped)
- `dompurify` — in `package.json` (Phase 44 shipped)

**Installation:** None required.

---

## Architecture Patterns

### System Architecture Diagram

```
Consumer Browser
    │
    ├── Zustand 'community' TabId
    │   └── activeCommunityView: 'feed'|'directory'|'dm'|'space:<id>'
    │       ├── CommunityDirectoryView   → supabase.rpc('search_directory', ...)
    │       ├── DMInboxView              → supabase.from('dm_threads').select(...)
    │       │   └── DMThreadView         → react-virtuoso + direct_messages
    │       └── LeaderboardChip          → supabase.rpc('get_community_leaderboard', ...)
    │
    ├── Realtime: supabase.channel(`dm:${userId}`)
    │   └── postgres_changes on direct_messages → toast + unread badge
    │
    └── Edge Fn calls
        ├── POST /dm-create-thread (rate check → block check → INSERT → notify)
        └── POST /notify-community (kind: 'dm_new' → notification-send)

Supabase Platform
    ├── Database (PostgreSQL)
    │   ├── profiles (+ 8 new columns added by 45-01)
    │   ├── dm_threads, direct_messages, dm_thread_audit
    │   ├── user_block_list, community_reports
    │   ├── community_spaces (+ leaderboard_enabled column)
    │   └── community_space_leaderboard_matview (matview, refreshed by cron)
    │
    ├── Storage: dm-attachments bucket (private; participant RLS)
    │
    ├── pg_cron: 'phase35-leaderboard-refresh' (MODIFIED)
    │   └── 12,27,42,57 * * * * → REFRESH BOTH matviews in one job
    │
    └── pg_cron: 'community-admin-report-digest' (NEW)
        └── 0 9 * * * → call community-admin-report-digest Edge Fn

Edge Functions
    ├── dm-create-thread (NEW) — rate-limit gate + block check + INSERT + notify side-effect
    ├── community-admin-report-digest (NEW) — daily digest email via email-router
    └── notify-community (EXTENDED) — kind: 'dm_new' added to existing Fn
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 202707XX000001_p45_schema.sql              # dm tables + profiles columns + community_spaces.leaderboard_enabled
│   ├── 202707XX000002_p45_notification_widening.sql # 4 CHECK constraints + email templates + VALID_CATEGORIES
│   ├── 202707XX000003_p45_dm_attachments_bucket.sql # dm-attachments Storage bucket + RLS
│   └── 202707XX000004_p45_community_leaderboard.sql # matview + cron consolidation
│
└── functions/
    ├── dm-create-thread/
    │   ├── index.ts
    │   ├── index.test.ts          # Deno test (NOT -test.ts — per project convention)
    │   └── deno.json              # per-fn deno.json (no --import-map flag)
    └── community-admin-report-digest/
        ├── index.ts
        └── index.test.ts

leanshot/src/
├── lib/community/
│   ├── community-types.ts         # ADD: DmThread, DirectMessage, BlockEntry, CommunityReport, SpaceLeaderboardEntry
│   ├── community-storage.ts       # REUSE: COMMUNITY_MEDIA_MIMES + COMMUNITY_MEDIA_MAX_BYTES (dm-attachments reuses)
│   └── dompurify-config.ts        # REUSE: unchanged
├── components/community/
│   ├── CommunityDirectoryView.tsx  # NEW — chunk: community-directory
│   ├── ProfileCard.tsx             # NEW — chunk: community-directory
│   ├── DMInboxView.tsx             # NEW — chunk: community-dm
│   ├── DMThreadView.tsx            # NEW — chunk: community-dm (react-virtuoso)
│   ├── DMMessageComposer.tsx       # NEW — chunk: community-dm
│   ├── LeaderboardChip.tsx         # NEW — chunk: community-feed (mounted on SpaceView)
│   ├── ReportButton.tsx            # NEW — shared within community/ catch-all
│   └── use-dm-inbox-realtime.ts    # NEW — mirrors use-space-realtime.ts lifecycle
└── components/admin/community/
    ├── AdminSpaceLeaderboardToggle.tsx
    ├── AdminClinicianVerifiedToggle.tsx
    └── AdminReportDigestOptIn.tsx
```

### Pattern 1: DM Thread RLS — Symmetric Block Check

**What:** The `dm_threads` INSERT RLS must prevent thread creation if the recipient has blocked the creator.
**When to use:** All DM thread creation paths.

```sql
-- Source: CONTEXT.md §Integration Points + Phase 28 cross-tenant RLS strictness
-- Plan 45-01 migration

-- INSERT on dm_threads: sender can only create if recipient has NOT blocked them
CREATE POLICY dm_threads_insert_not_blocked ON public.dm_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Sender must be the creator
    creator_user_id = auth.uid()
    -- Recipient must have dm_open=true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = recipient_user_id AND dm_open = true
    )
    -- Symmetric block check: recipient has NOT blocked the creator
    AND NOT EXISTS (
      SELECT 1 FROM public.user_block_list
      WHERE blocker_user_id = recipient_user_id
        AND blocked_user_id = auth.uid()
    )
  );
```

Note: The Edge Fn `dm-create-thread` enforces the block check at the application layer FIRST (returns clean 403 with code `blocked`) before the DB RLS fires. Defense-in-depth: RLS is the authoritative gate; Edge Fn provides UX-friendly error.

### Pattern 2: Rate-Limit Gate in Edge Function

**What:** Sender-side 3 new threads/24h limit enforced in `dm-create-thread`.
**When to use:** Every new DM thread creation.

```typescript
// Source: CONTEXT.md D-07 + dm-create-thread design
// supabase/functions/dm-create-thread/index.ts

async function checkRateLimit(
  admin: SupabaseClient,
  creatorId: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const { count } = await admin
    .from('dm_threads')
    .select('id', { count: 'exact', head: true })
    .eq('creator_user_id', creatorId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if ((count ?? 0) >= 3) {
    // Calculate seconds until oldest thread in the window expires from the 24h window
    const { data: oldest } = await admin
      .from('dm_threads')
      .select('created_at')
      .eq('creator_user_id', creatorId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    const retryAfterSeconds = oldest
      ? Math.ceil((new Date(oldest.created_at).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 1000)
      : 3600;

    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

// Verified-clinician bypass (D-08):
const { data: profile } = await admin
  .from('profiles')
  .select('is_clinician_verified')
  .eq('id', creatorId)
  .single();

if (profile?.is_clinician_verified) {
  // Log bypass in dm_thread_audit
  await logClinicianBypass(admin, creatorId, recipientId);
  return; // skip rate-limit check
}
```

### Pattern 3: `report_create` RPC — User vs Service-Role Context

**What:** `community_reports` can be written from two contexts: user UI (user JWT) and `community-admin-report-digest` Edge Fn (service-role for potential cascade actions). Per `feedback_rpc_auth_uid_vs_service_role_mismatch`, a single RPC using `auth.uid()` will return NULL in service-role context.

**Recommended solution:** Ship TWO RPCs:

```sql
-- Source: memory feedback_rpc_auth_uid_vs_service_role_mismatch
-- Plan 45-01 migration

-- 1. User-facing write (called from consumer UI with user JWT)
CREATE OR REPLACE FUNCTION public.community_report_create(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;
  INSERT INTO public.community_reports (reporter_user_id, target_type, target_id, reason)
  VALUES (v_user_id, p_target_type, p_target_id, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- 2. Admin/service-role facing read (called from digest Edge Fn — NO auth.uid())
-- The digest Fn reads community_reports via admin client (service-role), NOT via RPC.
-- No separate write RPC needed from service-role — the digest Fn only READS, not writes.
```

**Insight:** The `community-admin-report-digest` Edge Fn reads `community_reports` rows directly (service-role) and emails a count summary. It does NOT write to `community_reports`. The `community_report_create` RPC is user-only (correct use of `auth.uid()`). This avoids the auth.uid() vs service-role mismatch entirely.

### Pattern 4: Leaderboard Matview — Consolidated Cron

**What:** Phase 35 cron `phase35-leaderboard-refresh` runs at `12,27,42,57 * * * *` and refreshes `leaderboard_matview`. Phase 45 adds `community_space_leaderboard_matview`. These MUST consolidate into ONE pg_cron job.

**How:** Plan 45-06 migration DROPS the old Phase 35 cron and re-registers it with both REFRESH calls:

```sql
-- Source: Phase 35 migration 20270708000013 (pattern) + CONTEXT.md Integration Point
-- Plan 45-06 migration — dollar-quote nesting per memory reference_postgres_dollar_quote_nesting_in_cron_body

-- Pre-flight: unschedule existing Phase 35 job
DO $unschedule$
DECLARE
  job_name text;
BEGIN
  FOR job_name IN
    SELECT jobname FROM cron.job WHERE jobname = 'phase35-leaderboard-refresh'
  LOOP
    PERFORM cron.unschedule(job_name);
  END LOOP;
EXCEPTION WHEN others THEN NULL;
END $unschedule$;

-- Re-register with both matview refreshes in one statement
SELECT cron.schedule(
  'phase35-leaderboard-refresh',  -- keep SAME job name (ops familiarity)
  '12,27,42,57 * * * *',
  $cron$
  DO $refresh$ BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_matview;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.community_space_leaderboard_matview;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'phase35-leaderboard-refresh: error % — continuing', sqlerrm;
  END $refresh$;
  $cron$
);
```

**Critical:** Both matviews need a UNIQUE index on `(space_id, user_id)` for `REFRESH CONCURRENTLY` to work (Phase 35 Pitfall 3 — see `leaderboard_matview` comment: "LOAD-BEARING: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index"). [VERIFIED: 20270708000012_p35_leaderboard_matview.sql lines 56-58]

### Pattern 5: `dm-attachments` Storage Bucket RLS

**What:** The INSERT policy must check that the uploader is a participant (creator OR recipient) in the DM thread. Path convention: `{thread_id}/{message_id}.{ext}`.

**Challenge vs `community-media`:** The `community-media` INSERT policy used `(storage.foldername(name))[1] = auth.uid()::text` (path segment 1 = user_id). For `dm-attachments`, path segment 1 = `thread_id` — participant check requires a JOIN to `dm_threads`.

```sql
-- Source: Phase 44 20270720000003_p44_community_media_bucket.sql (base pattern)
-- Plan 45-03 migration

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dm-attachments',
  'dm-attachments',
  false,           -- private; signed URLs required
  5242880,         -- 5 MB per D-09
  ARRAY['image/jpeg','image/png','image/webp']  -- reuses COMMUNITY_MEDIA_MIMES
)
ON CONFLICT (id) DO NOTHING;

-- INSERT: authenticated user must be a thread participant
-- Path: {thread_id}/{message_id}.{ext}
-- (storage.foldername(name))[1] = thread_id (bucket-relative path)
CREATE POLICY objects_insert_dm_attachments ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND EXISTS (
      SELECT 1 FROM public.dm_threads dt
      WHERE dt.id = (storage.foldername(name))[1]::uuid
        AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid())
    )
  );

-- SELECT: any authenticated participant can read (signed URL adds time gate)
CREATE POLICY objects_select_dm_attachments ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND EXISTS (
      SELECT 1 FROM public.dm_threads dt
      WHERE dt.id = (storage.foldername(name))[1]::uuid
        AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid())
    )
  );

-- DELETE: author only (message author = same as uploader = their user_id is message's sender)
-- Use (storage.foldername(name))[2] = message_id to JOIN direct_messages.sender_user_id
CREATE POLICY objects_delete_dm_attachments ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND EXISTS (
      SELECT 1 FROM public.direct_messages dm
      WHERE dm.id = (storage.foldername(name))[2]::uuid
        AND dm.sender_user_id = auth.uid()
    )
  );
```

### Pattern 6: Notification CHECK Widening — Atomic (MUST)

**What:** 4 notification tables have CHECK constraints enumerating valid categories. Phase 44 added `'community-mentions'` and `'community-replies'`. Phase 45 adds `'community-dm'` and `'community-admin-report'`.

**Existing categories after Phase 44:** [VERIFIED: 20270720000004_p44_notification_community.sql]
```
'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
'community-mentions', 'community-replies'
```

**Phase 45 adds:**
```
'community-dm'             -- D-20: new DM notification email
'community-admin-report'   -- admin daily digest
```

**Email template names to add to `EmailTemplate` union:** [VERIFIED: _shared/email-router.ts structure]
```typescript
| 'community_dm_new'            // non-PHI → Resend. New DM notification.
| 'community_admin_report_digest' // non-PHI → Resend. Admin daily report count.
```

**VALID_CATEGORIES in `notification-send/index.ts`:** [VERIFIED: index.ts lines 169-179]
Must add `'community-dm'` and `'community-admin-report'` to the `Set<Category>`.

**Atomicity rule:** ALL of the following MUST land in plan 45-02, same transaction where applicable:
1. 4x CHECK constraint widening (notification_settings, notification_category_config, user_notifications, notification_dismissal_state)
2. `notification_category_config` UPSERT for `'community-dm'` (daily_cap, email_enabled_default=true, push_enabled_default=true)
3. `notification_category_config` UPSERT for `'community-admin-report'` (daily_cap=1, email=true, in_app=false)
4. `_shared/email-router.ts` template union extension + subjectFor + renderTemplate switch arms
5. `notify-community/index.ts` extension with `kind: 'dm_new'`
6. `notification-send/index.ts` VALID_CATEGORIES extension
7. New email template files: `community-dm-new.ts` + `community-admin-report-digest.ts`

### Pattern 7: 5-min Activity Debounce

**What:** D-20/D-21 require skipping email/push if the DM recipient has been active in-app within 5 minutes.

**Research finding:** No existing `last_seen_at` or activity timestamp is currently written anywhere in supabase functions. `user_leaderboard_prefs.last_seen_at` exists as a column but is never populated. [VERIFIED: full grep of supabase/functions/ and leanshot/src/]

**Recommended lightweight approach:**

Add `profiles.community_last_active_at timestamptz` (plan 45-01). Updated by:
1. `dm-create-thread` Edge Fn — after successful message send (recipient activity tracked via a separate write)
2. A lightweight client-side RPC call when user opens DMInboxView or reads a thread (`update_community_last_active()` SECDEF)

The `dm-create-thread` Fn checks before firing notification:
```typescript
// In dm-create-thread, before calling notify-community:
const { data: recipProfile } = await admin
  .from('profiles')
  .select('community_last_active_at, dm_open')
  .eq('id', recipientId)
  .single();

const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const isActive = recipProfile?.community_last_active_at
  ? recipProfile.community_last_active_at > fiveMinAgo
  : false;

if (!isActive) {
  // fire email + push via notify-community kind='dm_new'
}
// In-app Realtime always fires regardless of activity status (D-18)
```

### Pattern 8: Directory RLS — Two-Mode Visibility

**What:** Consumer users visible community-wide; clinic-org members visible only to same-org members.

```sql
-- Source: CONTEXT.md D-02 + Phase 28 cross-tenant RLS strictness
-- Plan 45-01 — directory_members_select policy on profiles (or a dedicated directory view)

-- Community-wide visibility for consumers (no org_members row)
-- Org-scoped visibility for clinic-org members
CREATE POLICY directory_members_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    directory_opt_in = true
    AND (
      -- Consumer path: this user has no org membership → visible to everyone with directory_opt_in=true
      NOT EXISTS (
        SELECT 1 FROM public.org_members om WHERE om.user_id = profiles.id
      )
      OR
      -- Clinic-org path: visible only to same-org members
      EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = profiles.id
          AND om.org_id IN (
            SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
          )
      )
    )
  );
```

### Anti-Patterns to Avoid

- **`ON CONFLICT DO DELETE` for block/toggle writes:** [VERIFIED: memory reference_postgres_no_insert_on_conflict_do_delete] Postgres rejects this syntax. Use SECDEF RPCs with SELECT + conditional INSERT/DELETE (same pattern as Phase 44 `toggle_community_reaction`).
- **New DOMPurify policy:** Phase 45 MUST NOT instantiate `DOMPurify.sanitize()` with a custom config. All bio + DM markdown rendering imports from `src/lib/community/dompurify-config.ts`. [VERIFIED: dompurify-config.ts exists as single source]
- **New consumer TabId:** [VERIFIED: CONTEXT.md + CLAUDE.md] Use `activeCommunityView` Zustand sub-state inside the existing 'community' TabId.
- **`--import-map` flag for Edge Fn deploy:** [VERIFIED: memory reference_supabase_functions_deploy_import_map_flag] CLI v2.101.0+ ignores it. Use per-fn `deno.json` for both new functions.
- **Letter-suffix migration timestamps:** [VERIFIED: memory reference_supabase_migration_filename_regex] Must be exactly 14 digits + underscore + name.
- **`<Route>` component for consumer DM/directory navigation:** Consumer navigation is Zustand `activeCommunityView` sub-state + URL hash for share-links.
- **Adding `leaderboard_handle` to leaderboard_optin table:** The community leaderboard needs a GLOBAL handle. Add to `profiles` table, not `leaderboard_optin` (which is per-cohort for gamification).
- **Querying `leaderboard_matview` directly from client:** Phase 35 SECDEF RPC `get_leaderboard_for_user` mediates access. Create an analogous `get_community_space_leaderboard(p_space_id)` SECDEF for Phase 45.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DM message list virtualization | Custom windowing | `react-virtuoso ^4.18.7` (already in deps) | Handles variable-height messages; Phase 44 already installed it |
| Markdown sanitization | Custom HTML stripping | `src/lib/community/dompurify-config.ts` (Phase 44) | Single allowlist; `FORBID_TAGS:['img']` enforced; fork = XSS risk |
| Image MIME + size validation | Custom file-type check | `COMMUNITY_MEDIA_MIMES` + `COMMUNITY_MEDIA_MAX_BYTES` from `community-storage.ts` | Consistent with community-media bucket policy |
| Web push delivery | Custom VAPID implementation | `npm:web-push@3.6.7` in `notification-send` Edge Fn | Already wired; SW handler already parses `{title, body, deeplink}` payload |
| Leaderboard refresh scheduling | Second pg_cron job | Extend existing `phase35-leaderboard-refresh` cron | One job, multiple REFRESH calls; avoids schedule drift |
| Symmetric block enforcement | Application-level only | Postgres INSERT RLS on `dm_threads` | Defense-in-depth; RLS is authoritative even if Edge Fn is bypassed |

**Key insight:** This phase is 90% wiring and extension of existing infrastructure. The DM thread Edge Fn is the only meaningful net-new computation surface.

---

## Runtime State Inventory

> Phase 45 is additive (new tables, new columns). No rename/refactor — skip.

Not applicable. Phase 45 adds new tables and extends existing ones. No existing runtime state requires migration or renaming.

---

## Common Pitfalls

### Pitfall 1: Notification CHECK Split (Highest Risk)
**What goes wrong:** If `community-dm` category is added to the email-router template union in plan 45-02 but the 4x CHECK constraint widening is deferred to plan 45-01, the notify-community Fn call from dm-create-thread will throw a Postgres CHECK violation (23514) in production.
**Why it happens:** Planner treats schema widening as separate from code changes.
**How to avoid:** Plan 45-02 MUST atomically widen all 4 CHECK constraints + email-router + notify-community + VALID_CATEGORIES + category_config seed + template files.
**Warning signs:** Two plan/task items referencing 'community-dm' in different plans.

### Pitfall 2: Missing UNIQUE Index on `community_space_leaderboard_matview`
**What goes wrong:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` fails at cron runtime with: "cannot refresh materialized view concurrently".
**Why it happens:** Postgres requires a UNIQUE index on at least one set of columns to use CONCURRENTLY mode. [VERIFIED: Phase 35 migration 20270708000012 comment: "LOAD-BEARING"]
**How to avoid:** Plan 45-06 migration MUST create `CREATE UNIQUE INDEX idx_community_space_lb_unique ON community_space_leaderboard_matview (space_id, user_id)` before the cron consolidation.
**Warning signs:** Cron job shows EXCEPTION in pg_cron logs on first refresh.

### Pitfall 3: `dm-attachments` Storage RLS Path Parsing
**What goes wrong:** `(storage.foldername(name))[1]` returns the first directory segment. For path `{thread_id}/{message_id}.jpg`, this is the thread_id UUID — but it's a TEXT, not UUID. The JOIN to `dm_threads.id` (UUID type) needs an explicit cast.
**Why it happens:** `storage.foldername` returns `text[]`, not `uuid[]`.
**How to avoid:** Use `(storage.foldername(name))[1]::uuid` in the RLS predicate. Fails fast at INSERT if the path doesn't contain a valid UUID in segment 1.
**Warning signs:** INSERT to dm-attachments returns 403 even for valid participants.

### Pitfall 4: Phase 35 Cron Already Scheduled
**What goes wrong:** If plan 45-06 creates a NEW cron job instead of modifying the existing `phase35-leaderboard-refresh`, both jobs run at `12,27,42,57` — the Phase 35 matview gets double-refreshed and the Phase 45 matview gets refreshed by the new job only.
**Why it happens:** Planner adds `cron.schedule('phase45-community-leaderboard-refresh', ...)` without touching the Phase 35 job.
**How to avoid:** Plan 45-06 MUST: (1) unschedule `phase35-leaderboard-refresh`, (2) re-register it with both REFRESH calls. The job name stays `phase35-leaderboard-refresh` for ops continuity.
**Warning signs:** `SELECT * FROM cron.job` shows two jobs at `12,27,42,57`.

### Pitfall 5: Deno Test Filename Convention
**What goes wrong:** `dm-create-thread-test.ts` is silently skipped by Deno's test discovery glob `{*_,*.,}test.*`.
**Why it happens:** Project convention requires `<name>.test.ts` (dot separator), NOT `-test.ts`. [VERIFIED: memory reference_deno_test_discovery]
**How to avoid:** Both new Edge Fn tests: `dm-create-thread/index.test.ts` and `community-admin-report-digest/index.test.ts`.

### Pitfall 6: Bundle Chunk Ordering in `vite.config.ts`
**What goes wrong:** `community-directory` and `community-dm` components fall into the `community-feed` catch-all chunk (`/src/components/community/`), bloating the feed chunk beyond 20 kB gz.
**Why it happens:** The `community-feed` catch-all rule fires before the new sub-chunk rules if placed after it. [VERIFIED: vite.config.ts manualChunks — Phase 44 already established ordering requirement]
**How to avoid:** Plan 45-07 adds the two new rules BEFORE the existing `community-feed` catch-all:
```typescript
// BEFORE: if (id.includes('/src/components/community/')) return 'community-feed';
if (id.includes('/src/components/community/CommunityDirectoryView') ||
    id.includes('/src/components/community/ProfileCard')) return 'community-directory';
if (id.includes('/src/components/community/DM') ||
    id.includes('/src/components/community/use-dm-inbox-realtime')) return 'community-dm';
// THEN: existing community-feed catch-all
```

### Pitfall 7: `report_create` Service-Role Call
**What goes wrong:** A single `community_report_create(p_target_type, p_target_id, p_reason)` RPC using `auth.uid()` returns NULL when called from the `community-admin-report-digest` Edge Fn (service-role context).
**Why it happens:** [VERIFIED: memory feedback_rpc_auth_uid_vs_service_role_mismatch]
**How to avoid:** The digest Fn only READS `community_reports` (for counts) — it never writes. The `community_report_create` RPC is user-only with `auth.uid()`. No auth.uid() vs service-role mismatch in Phase 45 if the digest Fn never calls the write RPC.

### Pitfall 8: Missing `leaderboard_handle` on `profiles`
**What goes wrong:** Plan 45-06's `community_space_leaderboard_matview` JOINs `profiles.leaderboard_handle` but the column doesn't exist → migration fails.
**Why it happens:** CONTEXT.md D-16 implied the column already existed from Phase 35; it does not.
**How to avoid:** Plan 45-01 MUST ADD `profiles.leaderboard_handle text` with the handle format CHECK constraint. The plan-checker state from STATE.md line 788 must be REVERSED — adding this column is REQUIRED, not blocked.

### Pitfall 9: `activeCommunityView` Zustand Field Name Collision
**What goes wrong:** If plan 45-07 adds a new `activeCommunityView` field to the Zustand store without verifying no existing field has that name, TypeScript will silently merge or override.
**Why it happens:** Zustand store is a single flat object; field name collisions cause subtle bugs.
**How to avoid:** Grep `src/lib/store.ts` for `activeCommunityView` before adding; if the Phase 44 executor already added it, extend the union type (`'feed' | 'directory' | 'dm' | 'space:<id>'`) rather than adding a new field.

---

## Code Examples

### Realtime DM Inbox Hook (mirrors Phase 44 use-space-realtime.ts pattern)

```typescript
// Source: CONTEXT.md D-18 + Phase 44 use-space-realtime.ts lifecycle shape
// New: src/components/community/use-dm-inbox-realtime.ts

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export function useDmInboxRealtime(
  userId: string | null,
  onNewMessage: (msg: { recipient_user_id: string }) => void,
): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!userId) return;
    // D-18: Per-user inbox channel — lifecycle tied to session
    const channel = supabase
      .channel(`dm:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => onNewMessage(payload.new as { recipient_user_id: string }),
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      // D-18: Teardown on logout / unmount
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, onNewMessage]);
}
```

### Push Notification Payload for DMs (extends existing sw.ts contract)

```typescript
// Source: leanshot/src/sw.ts PushPayload interface (lines 70-75) — no SW changes needed
// The payload sent via notification-send already matches the SW's expected shape:
// { title, body, icon?, tag?, urgency?, deeplink? }

// In notify-community (kind: 'dm_new'), call callNotificationSend with:
const pushPayload = {
  title: `New message from @${senderHandle}`,
  body: dmBodyTruncated.slice(0, 80),  // D-21: first 80 chars post-dompurify
  tag: `dm-${threadId}`,               // Groups notifications by thread
  deeplink: `/community/dm/${threadId}`,
  urgency: 'normal',
};
// Pass as `payload` to notification-send; the SW handles showNotification({ body, ... })
```

### `community_space_leaderboard_matview` Structure

```sql
-- Source: Phase 35 20270708000012_p35_leaderboard_matview.sql (pattern)
-- CONTEXT.md D-12/D-13/D-14/D-15/D-16 design

CREATE MATERIALIZED VIEW public.community_space_leaderboard_matview AS
SELECT
  cs.id                                                    AS space_id,
  cp.author_id                                             AS user_id,
  p.leaderboard_handle                                     AS handle,
  p.leaderboard_opt_in                                     AS opted_in,
  -- D-12: score formula
  (COUNT(DISTINCT cp.id) FILTER (WHERE cp.author_id = cp.author_id) * 3  -- posts × 3
   + COUNT(DISTINCT cc.id) FILTER (WHERE cc.author_id = cp.author_id) * 1  -- comments × 1
   + COUNT(cr.id) * 1                                                        -- reactions_received × 1
  )::bigint                                                AS score,
  RANK() OVER (
    PARTITION BY cs.id
    ORDER BY (
      COUNT(DISTINCT cp.id) * 3 + COUNT(DISTINCT cc.id) + COUNT(cr.id)
    ) DESC, cp.author_id ASC  -- tiebreak by stable user_id
  )                                                        AS rank_in_space,
  now()                                                    AS refreshed_at
FROM public.community_spaces cs
JOIN public.community_posts cp
  ON cp.space_id = cs.id
  AND cp.created_at >= now() - INTERVAL '7 days'  -- D-13: rolling 7d
  AND cp.deleted_at IS NULL
JOIN public.profiles p
  ON p.id = cp.author_id
  AND p.leaderboard_opt_in = true              -- D-17: unified opt-in flag
JOIN public.community_spaces cs2
  ON cs2.id = cp.space_id
  AND cs2.leaderboard_enabled = true           -- D-14: admin must enable
LEFT JOIN public.community_comments cc
  ON cc.space_id = cs.id
  AND cc.author_id = cp.author_id
  AND cc.created_at >= now() - INTERVAL '7 days'
  AND cc.deleted_at IS NULL
LEFT JOIN public.community_reactions cr
  ON cr.target_id = cp.id
  AND cr.target_type = 'post'
  AND cp.author_id = cp.author_id  -- reactions received BY author's posts
GROUP BY cs.id, cp.author_id, p.leaderboard_handle, p.leaderboard_opt_in;

-- LOAD-BEARING (same as Phase 35 Pitfall 3):
CREATE UNIQUE INDEX idx_community_space_lb_space_user
  ON public.community_space_leaderboard_matview (space_id, user_id);

CREATE INDEX idx_community_space_lb_space_rank
  ON public.community_space_leaderboard_matview (space_id, rank_in_space);
```

*Note: The planner should refine the JOINs for accurate `reactions_received` aggregation — the example above illustrates the pattern but the exact GROUP BY math needs careful planner attention to avoid double-counting.*

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 45 |
|--------------|------------------|---------------------|
| Phase 35 per-cohort leaderboard handle (`leaderboard_optin.handle`) | Phase 45 global profile handle (`profiles.leaderboard_handle`) | Plan 45-01 ADDS the column; plan 45-06 matview reads it |
| Separate pg_cron jobs per leaderboard | Single consolidated cron with multiple REFRESH calls | Plan 45-06 replaces `phase35-leaderboard-refresh` with extended version |
| Phase 44 email categories: community-mentions, community-replies | Phase 45 adds community-dm, community-admin-report | Atomic widening in plan 45-02 |
| `--import-map` flag for Deno Edge Fns | Per-fn `deno.json` (CLI v2.101.0 silently ignores `--import-map`) | Both new Edge Fns need `deno.json` |
| RLS-only block enforcement | Edge Fn 403 + RLS defense-in-depth | dm-create-thread Fn checks first for UX; RLS is authoritative |

**Deprecated/outdated:**
- `--linked` flag on `supabase functions deploy`: removed in CLI v2.100.0. Do not include. [VERIFIED: memory reference_supabase_functions_deploy_no_linked_flag]
- `--import-map` flag on `supabase functions deploy`: silently ignored in CLI v2.101.0+. [VERIFIED: memory reference_supabase_functions_deploy_import_map_flag]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `profiles.handle` and `profiles.display_name` exist in the live DB (code confirms, no migration found) | Standard Stack, Patterns | Phase 45 directory search references these columns; if absent, 45-01 must add them |
| A2 | The score formula JOIN logic for `reactions_received` (per-author aggregate) is correct as written | Code Examples — matview | Double-counting or missing reactions in leaderboard score if JOINs are wrong; planner must validate |
| A3 | `profiles.community_last_active_at` is the right debounce column (no existing activity column found) | Pattern 7 | If a better existing signal exists (e.g., `user_leaderboard_prefs.last_seen_at` becomes writeable in Phase 44), prefer reuse |

---

## Open Questions

1. **`profiles.handle` and `profiles.display_name` migration not found**
   - What we know: Both columns are referenced by live Phase 44 code (`MentionTypeahead.tsx` queries `profiles` for `id, handle, display_name`; `mention-parse.ts` references "30-char CHECK constraint on `profiles.handle`").
   - What's unclear: Which migration file added these columns. They are not in any file in `supabase/migrations/` that was found.
   - Recommendation: Plan 45-01 should include `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle text` and `ADD COLUMN IF NOT EXISTS display_name text` as idempotent statements. If columns already exist (live DB), the `IF NOT EXISTS` guard prevents errors.

2. **Leaderboard matview score formula precision**
   - What we know: D-12 formula is `posts × 3 + comments × 1 + reactions_received × 1`. `reactions_received` means reactions received ON the user's posts/comments in the 7d window.
   - What's unclear: The exact GROUP BY / aggregate structure to compute `reactions_received` without double-counting across multiple posts by the same author in the same space.
   - Recommendation: Planner should use a CTE to pre-aggregate per-author post counts + comment counts + reaction counts separately, then JOIN for the score.

3. **`profiles.leaderboard_opt_in` vs Phase 35 `leaderboard_optin.active`**
   - What we know: D-16 says unified opt-in. Phase 35's `leaderboard_optin.active` is per (user_id, cohort_id). Phase 45 needs a global flag.
   - What's unclear: Should opt-in to the community leaderboard ALSO opt the user into the gamification leaderboard (for all cohorts)? Or are they truly independent?
   - Recommendation: They are independent in Phase 45 v1. Add `profiles.leaderboard_opt_in boolean default false` as a SEPARATE column from Phase 35's per-cohort `leaderboard_optin.active`. A user can be opted into the community leaderboard without being in any gamification cohort leaderboard.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `react-virtuoso` | DMThreadView virtualization | ✓ | 4.18.7 (package.json line 88) | — |
| `react-markdown` | DM body + bio rendering | ✓ | 9.0.0 | — |
| Deno runtime | Edge Fn local tests | ✓ | 2.7.14 ($HOME/.deno/bin/deno) | — |
| Supabase CLI | Migration push + Fn deploy | ✗ (not in $PATH) | Use `node_modules/supabase/bin/supabase` in worktrees | Or use `npx supabase` |
| pg_cron extension | Leaderboard refresh cron | ✓ | Already enabled (Phase 35 cron running) | — |
| VAPID keys | Web push for DM notifications | ✓ | In Supabase Function Secrets (Phase 42) | — |
| web-push npm package | Push delivery in notification-send | ✓ | 3.6.7 (in notification-send/index.ts) | — |

**Missing dependencies with no fallback:** None that block execution.

**Missing dependencies with fallback:**
- Supabase CLI: not in `$PATH`; use `$HOME/.claude/worktrees/.../node_modules/supabase/bin/supabase` or `npx supabase` from the worktree root.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (frontend) + Deno test runner (Edge Fns) |
| Config file | `leanshot/vite.config.ts` test block (Vitest) + per-fn `deno.json` (Deno) |
| Quick run command | `cd leanshot && npm run test -- --run src/lib/community/` |
| Full suite command | `cd leanshot && npm run test -- --run` |
| Edge Fn test run | `$HOME/.deno/bin/deno test --no-check supabase/functions/dm-create-thread/index.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMMUNITY-07 | Directory opt-in toggle persists; handle-prefix search returns matching cards | Integration (Vitest + msw) | `npm run test -- --run src/components/community/CommunityDirectoryView` | ❌ Wave 0 |
| COMMUNITY-07 | Clinic-org member sees ONLY same-org cards (RLS cross-tenant) | Integration (RLS suite) | `npm run test -- --run src/lib/community/directory-rls` | ❌ Wave 0 |
| COMMUNITY-08 | dm-create-thread: rate limit returns 429 on 4th call; Retry-After header present | Unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/dm-create-thread/index.test.ts` | ❌ Wave 0 |
| COMMUNITY-08 | dm-create-thread: block check returns 403 when recipient has blocked sender | Unit (Deno) | Same as above | ❌ Wave 0 |
| COMMUNITY-08 | dm-create-thread: clinician bypass skips rate limit + inserts audit row | Unit (Deno) | Same as above | ❌ Wave 0 |
| COMMUNITY-08 | Notification CHECK constraint widening: 'community-dm' accepted, unknown category rejected | Migration test | `npm run test -- --run src/lib/notifications/` | ❌ Wave 0 |
| COMMUNITY-09 | community_space_leaderboard_matview: score formula correct (posts×3 + comments×1 + reactions×1) | Unit (Vitest/SQL) | `npm run test -- --run src/lib/community/leaderboard` | ❌ Wave 0 |
| COMMUNITY-09 | admin-report-digest: sends email only to profiles with admin_digest_opt_in=true | Unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/community-admin-report-digest/index.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd leanshot && npm run test -- --run src/lib/community/`
- **Per wave merge:** `cd leanshot && npm run test -- --run` (full Vitest suite)
- **Edge Fn per commit:** `$HOME/.deno/bin/deno test --no-check supabase/functions/<fn-name>/index.test.ts`
- **Phase gate:** Full suite green + Edge Fn tests green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `leanshot/src/lib/community/directory-rls.test.ts` — covers COMMUNITY-07 cross-tenant isolation
- [ ] `leanshot/src/components/community/CommunityDirectoryView.test.tsx` — covers COMMUNITY-07 UI
- [ ] `supabase/functions/dm-create-thread/index.test.ts` — covers COMMUNITY-08 rate limit + block check + clinician bypass
- [ ] `supabase/functions/community-admin-report-digest/index.test.ts` — covers COMMUNITY-09 admin digest
- [ ] `leanshot/src/lib/community/leaderboard.test.ts` — covers COMMUNITY-09 score formula
- [ ] `leanshot/src/lib/community/dm-rls.test.ts` — covers COMMUNITY-08 dm_threads INSERT RLS symmetric block

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase auth.uid() in all SECDEF RPCs; Edge Fn dual-auth (JWT sub-check) |
| V3 Session Management | yes | Realtime channel lifecycle tied to session; teardown on logout |
| V4 Access Control | yes | RLS on all new tables; `public.is_staff()` for admin writes; symmetric block check |
| V5 Input Validation | yes | markdown body: 2000-char CHECK; handle regex `^[a-zA-Z0-9_-]{6,24}$`; MIME whitelist; HTTPS-only links |
| V6 Cryptography | partial | Signed URLs for dm-attachments (60-min TTL); VAPID keys for push (already in Secrets) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-user DM read (unauthorized thread access) | Information Disclosure | RLS on `dm_threads` SELECT + `direct_messages` SELECT restricted to thread participants |
| Attachment path traversal | Tampering | Storage RLS: `(foldername(name))[1]::uuid` JOIN on `dm_threads` prevents cross-thread upload |
| DM spam (high-volume thread creation) | DoS | Edge Fn rate limit (3/24h) + DB CHECK; clinician bypass audited |
| Recipient block bypass via API | Spoofing/Tampering | RLS INSERT policy on `dm_threads` is authoritative; Edge Fn is belt |
| XSS via DM body or profile bio | Tampering | dompurify-config.ts allowlist + `FORBID_TAGS:['img']` |
| Leaderboard opt-in spoofing | Spoofing | `profiles.leaderboard_opt_in` write via SECDEF RPC only (auth.uid()); matview built from opt-in=true rows |
| Community report spam | DoS | No daily cap needed (reports require real content IDs); `community_reports` not real-time consumer-facing |
| PII in Sentry/PostHog (DM bodies) | Information Disclosure | Phase 25 PII regex masking applies; DM body never logged raw (sha256 hash of user_id per T-44-01b pattern) |

---

## Project Constraints (from CLAUDE.md)

- TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`).
- Path alias `@/*` → `./src/*` for all imports.
- No direct `useStore(s => s)` — subscribe with one selector per primitive.
- Accessibility: `aria-label` required on icon-only buttons; `role="status" aria-live="polite"` on toasts; `prefers-reduced-motion` respected.
- Code-split aggressively — new chunks `community-directory` + `community-dm` via `vite.config.ts` manualChunks; sub-chunk rules BEFORE `community/` catch-all.
- Bundle size: `assert-bundle-budget.sh` extended with new ceiling entries (community-directory: 10 kB gz, community-dm: 35 kB gz).
- GSD workflow: no direct repo edits outside GSD commands.
- All dates as ISO strings, never as `Date` objects.
- `useReducedMotion()` hook applied to DM inbox toast animation.

---

## Sources

### Primary (HIGH confidence — verified against live codebase)
- `supabase/migrations/20270708000011_p35_leaderboard_optin.sql` — confirmed `leaderboard_optin` table schema (per-cohort handle, NOT on profiles)
- `supabase/migrations/20270708000012_p35_leaderboard_matview.sql` — Phase 35 matview structure + UNIQUE index requirement for REFRESH CONCURRENTLY
- `supabase/migrations/20270708000013_p35_leaderboard_refresh_cron.sql` — cron job name `phase35-leaderboard-refresh`, schedule `12,27,42,57 * * * *`, dollar-quote pattern
- `supabase/migrations/20270720000003_p44_community_media_bucket.sql` — dm-attachments RLS base pattern
- `supabase/migrations/20270720000004_p44_notification_community.sql` — exact CHECK constraint pattern + current category list
- `supabase/functions/notification-send/index.ts` — VALID_CATEGORIES set, PushPayload shape, fanOutPush
- `supabase/functions/notify-community/index.ts` — fan-out pattern, dual-auth, callNotificationSend signature
- `supabase/functions/_shared/email-router.ts` — EmailTemplate union, existing template list
- `leanshot/src/sw.ts` — PushPayload shape `{title, body, tag?, deeplink?}`, no SW changes needed
- `leanshot/src/lib/community/community-storage.ts` — `COMMUNITY_MEDIA_MIMES`, `COMMUNITY_MEDIA_MAX_BYTES` (5 MB cap in D-09 is DIFFERENT from community-media's 10 MB — plan must set bucket file_size_limit to 5242880)
- `leanshot/src/lib/community/dompurify-config.ts` — confirmed as single source of truth
- `leanshot/src/lib/notifications/permission.ts` — Phase 42 push subscription pattern (`requestPushPermission({ fromUserGesture: true })`)
- `leanshot/vite.config.ts` — community-feed chunk ordering, manualChunks logic
- `leanshot/scripts/assert-bundle-budget.sh` — community-feed (20 kB) + community-media (320 kB) existing entries; directory + dm entries MISSING (must add)
- `leanshot/package.json line 88` — `react-virtuoso ^4.18.7`
- `.planning/STATE.md lines 768-799` — halted-agent recon outline (8 plans / 3 waves)

### Secondary (MEDIUM confidence)
- `.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md` — all 21 decisions
- `.planning/phases/44-m4-community-feed-foundation/44-PATTERNS.md` — handle/display_name on profiles confirmed (line 624)
- `.planning/phases/35-m3-gamification-engine/35-CONTEXT.md` — Phase 35 leaderboard decisions (D-11..D-16)

### Tertiary (LOW confidence — unresolvable without live DB query)
- `profiles.handle` and `profiles.display_name` migration source — columns confirmed to exist in live DB by frontend code, but the migration file was not found in 48 files searched [ASSUMED: added via Supabase dashboard or migration outside the numbered series; plan 45-01 should use `ADD COLUMN IF NOT EXISTS` as guard]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json and migration files
- Architecture: HIGH — all patterns derived from verified Phase 35/44 migration files
- Schema changes: HIGH — confirmed by grep of all migration files
- Critical finding (leaderboard_handle): HIGH — absence confirmed by exhaustive migration search
- Pitfalls: HIGH — derived from Phase 35 comments and memory references verified against live code

**Research date:** 2026-05-23
**Valid until:** 2026-06-22 (30 days; stable stack)

---

## RESEARCH COMPLETE
