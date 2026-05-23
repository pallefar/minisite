---
phase: 44
plan: "01"
subsystem: community-schema
tags:
  - migration
  - rls
  - storage
  - secdef-rpc
  - community
  - wave-0

dependency_graph:
  requires:
    - supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql
    - supabase/migrations/20270707000020_helpdesk_rls_policies.sql (pattern source)
    - supabase/migrations/20260801000003_org_logos_storage.sql (pattern source)
    - public.organizations (FK target for community_spaces.org_id)
    - public.org_members (EXISTS join in cspace_select_org_member)
    - public.tier_effective (join in cpost_select_tier)
    - public.auth.users (FK target for author_id, user_id)
    - public.lifetime_purchases (tier_effective view source; seedUserTier 'lifetime')
    - public.subscriptions (tier_effective view source; seedUserTier 'trial'/'pro')
  provides:
    - 7 community_* tables (spaces, posts, comments, reactions, post_media, post_mentions, comment_mentions)
    - RLS policies on all 7 tables (17 policies total)
    - community-media Storage bucket + 3 storage.objects RLS policies
    - toggle_community_reaction SECDEF RPC (D-02 idempotent toggle)
    - community-spaces-rls.test.ts (cross-tenant isolation proof T-44-01/D-09)
    - community-tier-gating-rls.test.ts (Free/Pro/Trial tier gate proof D-08)
    - community-reactions-rls.test.ts (reaction toggle idempotency proof COMMUNITY-02)
    - fixtures-community.ts (shared test helpers)
  affects:
    - Wave 1+ plans (44-03..09) depend on schema being present for tsc compile
    - 44-10 Task 1 is the BLOCKING push that makes migrations live

tech_stack:
  added:
    - INSERT...ON CONFLICT DO DELETE (Postgres 15+ reaction toggle pattern)
    - storage.foldername(name)[1] path-prefix RLS pattern for community-media
  patterns:
    - SECDEF RPC with search_path = public, extensions (Phase 36 pattern)
    - org_members EXISTS join RLS (Phase 37 helpdesk pattern)
    - tier_effective view join for tier gating (Phase 43 pattern)
    - admin.generateLink + /auth/v1/verify token mint (Phase 23/42 ES256-safe pattern)

key_files:
  created:
    - supabase/migrations/20270720000001_p44_community_schema.sql
    - supabase/migrations/20270720000002_p44_community_rls.sql
    - supabase/migrations/20270720000003_p44_community_media_bucket.sql
    - supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql
    - leanshot/tests/rls/community-spaces-rls.test.ts
    - leanshot/tests/rls/community-tier-gating-rls.test.ts
    - leanshot/tests/rls/community-reactions-rls.test.ts
    - leanshot/tests/rls/fixtures-community.ts
  modified: []

decisions:
  - "Trial users included in Pro branch of cpost_select_tier (tier_label IN (pro, lifetime, trial)) — D-06 + Claude's Discretion"
  - "community_comments.space_id NOT NULL denormalized — RESEARCH Pitfall 5 for Realtime filter efficiency"
  - "10-image cap enforced via BEFORE INSERT trigger (_community_post_media_cap_check) — D-04"
  - "community-media bucket private=false, MIME whitelist {image/jpeg,image/png,image/webp} — T-44-04"
  - "No INSERT policy on community_spaces in Wave 0 — admin spaces insert requires service_role; 44-09 tightens with is_staff()"
  - "fixtures-community.ts uses admin.generateLink+/auth/v1/verify NOT signInWithPassword — ES256 project per reference_rls_fixture_gotrueclient_flake"

metrics:
  duration: "~35 minutes"
  completed: "2026-05-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 0
---

# Phase 44 Plan 01: Community Schema + RLS + Storage + Reaction RPC Summary

**One-liner:** Community schema foundation: 7 tables with tier_effective-gated + org_id-isolated RLS, private community-media bucket with path-prefix defense, and idempotent toggle_community_reaction SECDEF RPC via INSERT...ON CONFLICT DO DELETE.

---

## What Was Built

### Task 1: 4 SQL Migration Files

**Migration 1 — `20270720000001_p44_community_schema.sql`**

All 7 community tables created with `if not exists`:
- `community_spaces` — Spaces with `min_tier CHECK ('free','pro','lifetime')` and nullable `org_id` for clinic-private spaces (D-09)
- `community_posts` — Posts with `body CHECK (char_length(body) <= 5000)` (D-11), Mux columns (D-05), soft-delete `deleted_at` (D-15)
- `community_comments` — Comments with `space_id NOT NULL` (denormalized per RESEARCH Pitfall 5), nullable `parent_comment_id` for Phase 45+ threading (D-01)
- `community_reactions` — Reactions with `emoji CHECK ('like','heart','target','fire','clap')` (D-03) and `UNIQUE(user_id,target_type,target_id,emoji)` for toggle idempotency (D-02)
- `community_post_media` — Image attachments with UNIQUE order; 10-image BEFORE INSERT trigger cap (D-04)
- `community_post_mentions` — @mention join table (D-14)
- `community_comment_mentions` — @mention join table (D-14)

Indexes: `(space_id, created_at DESC)` on community_posts; `(post_id, created_at)` on community_comments (D-12 cursor pagination support).

**Migration 2 — `20270720000002_p44_community_rls.sql`**

RLS ENABLED on all 7 tables. 17 policies:
- `cspace_select_global` — org_id IS NULL spaces visible to all authenticated
- `cspace_select_org_member` — org_id IS NOT NULL spaces only to org_members (D-09 cross-tenant defense)
- `cpost_select_tier` — Posts join tier_effective; trial users see Pro content per D-06 + Claude's Discretion; soft-delete filter (D-15)
- `cpost_insert_authenticated` — Author + tier check
- `cpost_update_author` — Author-only edit (D-15)
- Comments (3 policies), reactions (3), post_media (2), post_mentions (2), comment_mentions (2)

Key design decision: Trial tier (`tier_label = 'trial'`) is included in the Pro branch of `cpost_select_tier`. This matches CONTEXT.md Claude's Discretion and D-06.

**Migration 3 — `20270720000003_p44_community_media_bucket.sql`**

- `community-media` Storage bucket: `public=false`, `file_size_limit=10485760` (10 MB), `allowed_mime_types=['image/jpeg','image/png','image/webp']` — NO SVG (T-44-04)
- 3 storage.objects RLS policies (idempotent `do $$ if not exists $$`):
  - `objects_select_community_media` — authenticated read
  - `objects_insert_community_media` — `(storage.foldername(name))[1] = auth.uid()::text` path-traversal defense (T-44-04)
  - `objects_delete_community_media` — same path-prefix check

**Migration 4 — `20270720000005_p44_community_secdef_rpcs.sql`**

- `toggle_community_reaction(p_target_type text, p_target_id uuid, p_emoji text)` RETURNS TABLE
- SECURITY DEFINER SET search_path = public, extensions
- INSERT...ON CONFLICT (user_id, target_type, target_id, emoji) DO DELETE (D-02 idempotent toggle)
- RETURN QUERY aggregate counts per emoji with `reacted_by_me` boolean
- GRANT to authenticated; REVOKE from public, anon

Note: timestamp `20270720000004` reserved for plan 44-02 (notification CHECK widening).

### Task 2: 3 RLS Test Files + 1 Fixtures Helper

**`fixtures-community.ts`**

Shared helpers:
- `buildAdmin()` / `buildAnonClient()` — factory functions
- `createOrgScopedUser(admin, email, orgId?)` — creates auth user + optional org_members row
- `seedSpaceAndPost(admin, authorId, spaceParams)` — seeds community_spaces + community_posts via service-role
- `seedUserTier(admin, userId, tier, prefix)` — seeds subscription row for 'trial'/'pro'; lifetime_purchases for 'lifetime'

All use admin.generateLink + /auth/v1/verify pattern (ES256-safe per `reference_rls_fixture_gotrueclient_flake`).

**`community-spaces-rls.test.ts`**

3 it() blocks:
1. User A in org_A cannot see community_spaces row owned by org_B (0 rows — T-44-01/D-09)
2. User B can read their own org_B private space (1 row)
3. Global space (org_id IS NULL) visible to both users (1 row each)

**`community-tier-gating-rls.test.ts`**

3 it() blocks:
1. Free user CANNOT read community_posts in min_tier='pro' space (0 rows — D-08)
2. Pro user CAN read community_posts in min_tier='pro' space (≥1 row)
3. Trial user CAN read min_tier='pro' space (D-06 + Claude's Discretion — trial = Pro evaluation)

**`community-reactions-rls.test.ts`**

2 it() blocks:
1. toggle_community_reaction idempotency: call 1 → count=1 reacted_by_me=true; call 2 → count=0 reacted_by_me=false (COMMUNITY-02)
2. Raw INSERT duplicate → Postgres 23505 unique_violation (UNIQUE constraint as idempotency gate)

---

## Wave 3 Dependency

All 4 migrations are written but NOT pushed. Plan **44-10 Task 1** owns the BLOCKING `supabase db push --linked` step. The 3 RLS test files are authored and compile clean under `npx tsc --noEmit -p tsconfig.json` but cannot execute until 44-10 completes the push.

---

## Deviations from Plan

None — plan executed exactly as written.

The one discretionary choice documented: No INSERT policy on `community_spaces` in Wave 0 (plans 44-09 ships `public.is_staff()` and the admin space creation policies in migration `20270720000006`). Service_role client can insert spaces for seeding in tests.

---

## Known Stubs

None. All migration artifacts are complete SQL. Test files are complete TypeScript. No placeholder values or hardcoded empty data.

---

## Threat Flags

No new security-relevant surfaces beyond those in the plan's `<threat_model>`:
- T-44-01: RLS org_members EXISTS join — implemented
- T-44-04: community-media bucket MIME whitelist + foldername path defense — implemented
- T-44-07: Soft-delete accepted risk documented in migration comments

## Self-Check: PASSED

Files confirmed:
- `/.../.../supabase/migrations/20270720000001_p44_community_schema.sql` — FOUND
- `/.../.../supabase/migrations/20270720000002_p44_community_rls.sql` — FOUND
- `/.../.../supabase/migrations/20270720000003_p44_community_media_bucket.sql` — FOUND
- `/.../.../supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` — FOUND
- `/.../.../leanshot/tests/rls/community-spaces-rls.test.ts` — FOUND
- `/.../.../leanshot/tests/rls/community-tier-gating-rls.test.ts` — FOUND
- `/.../.../leanshot/tests/rls/community-reactions-rls.test.ts` — FOUND
- `/.../.../leanshot/tests/rls/fixtures-community.ts` — FOUND

Commits confirmed:
- `93fb126` feat(44-01-01): author community schema + RLS + bucket + reaction SECDEF migrations — FOUND
- `e06b2dc` feat(44-01-02): author Wave 0 community RLS test files — FOUND
