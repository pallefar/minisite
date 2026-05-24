---
phase: 49-m4-search-email-digests
plan: 03
subsystem: community-digest-rpcs
tags: [supabase, secdef, rpc, digest, service-role]
dependency-graph:
  requires: []
  provides:
    - "digest_top_posts_in_spaces"
    - "digest_new_comments_on_my_posts"
    - "digest_recent_mentions"
    - "digest_course_progress_delta_7d"
    - "digest_upcoming_events_7d_rsvpd"
    - "digest_community_top3_7d"
  affects:
    - "supabase/functions/community-daily-digest/* (49-06 — consumer)"
    - "supabase/functions/community-weekly-digest/* (49-07 — consumer)"
tech-stack:
  added: []
  patterns:
    - "SECDEF + set search_path = public, extensions + stable + language sql"
    - "service_role-only grants (revoke from public, grant to service_role)"
    - "p_user_id-explicit (no auth.uid() in body) — service-role caller pattern"
key-files:
  created:
    - "supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql"
  modified: []
decisions:
  - "Mention 24h filter JOINs parent.created_at (D-18) — mention join tables have no timestamp column."
  - "Phase 45 leaderboard formula (posts*3 + reactions + comments) reused for digest_community_top3_7d."
  - "All 6 RPCs granted to service_role only; not to authenticated, not to public — RLS-bypass-via-RPC blocked at grant layer."
metrics:
  duration: "~6 min"
  completed: "2026-05-24"
  tasks: "1/1"
  files: "1 created, 0 modified"
requirements: [DIGEST-02, DIGEST-03]
---

# Phase 49 Plan 03: Digest Helper RPCs Summary

**One-liner:** 6 SECURITY DEFINER helper RPCs (3 daily, 3 weekly) that compose digest content per-user from a service-role Edge Fn caller — no auth.uid() in body, mention 24h window via parent.created_at JOIN.

## What Shipped

A single migration `supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql` defines 6 SECDEF RPCs:

| RPC | Bucket | Signature | Notes |
|---|---|---|---|
| `digest_top_posts_in_spaces(p_user_id, p_since_hours=24, p_limit=5)` | daily | top N posts in joined spaces last N hours | score = reactions + comments |
| `digest_new_comments_on_my_posts(p_user_id, p_since_hours=24, p_limit=10)` | daily | new comments on user's own posts | excludes user's own replies |
| `digest_recent_mentions(p_user_id, p_since_hours=24, p_limit=10)` | daily | mentions across posts + comments | D-18: parent.created_at JOIN |
| `digest_course_progress_delta_7d(p_user_id)` | weekly | per-course (this-week, total, %) where this-week > 0 | uses 3 CTEs |
| `digest_upcoming_events_7d_rsvpd(p_user_id)` | weekly | RSVP'd "going" events starting within 7 days | sorted by start_at asc |
| `digest_community_top3_7d(p_user_id)` | weekly | top-3 posts in user's spaces last 7 days | Phase 45 formula (3 + reactions + comments) per row |

All 6:
- `security definer`
- `set search_path = public, extensions`
- `language sql` + `stable`
- `revoke execute … from public` + `grant execute … to service_role`
- ZERO `auth.uid()` references in body (verified by grep gate)

## Acceptance Gates (all pass)

| Gate | Threshold | Actual |
|---|---|---|
| `create or replace function public.digest_` | ≥ 6 | 6 |
| `auth.uid` references | 0 | 0 |
| `security definer` | ≥ 6 | 6 |
| `set search_path = public, extensions` | ≥ 6 | 6 |
| `to service_role` | ≥ 6 | 6 |
| `community_post_mentions` reference | ≥ 1 | 1 |
| `community_comment_mentions` reference | ≥ 1 | 1 |
| `make_interval(hours` | ≥ 3 | 4 |
| `p.author_id = p_user_id` | ≥ 1 | 1 |
| `r.status = 'going'` | ≥ 1 | 1 |
| migration files matching `20271001000007*.sql` | exactly 1 | 1 |
| filename matches `^[0-9]{14}_name.sql` | yes | yes |

## Key Decisions

1. **Mention 24h window via parent JOIN (D-18).** Live-DB precheck (`feedback_live_db_precheck_inverts_research_grep`) confirmed `community_post_mentions` and `community_comment_mentions` have NO `created_at` column. The 24h filter therefore joins to `community_posts.created_at` / `community_comments.created_at` rather than the mention row itself.

2. **`p_user_id` explicit, no `auth.uid()` in body (`feedback_rpc_auth_uid_vs_service_role_mismatch`).** These RPCs are called from service-role Edge Fns on cron schedules; `auth.uid()` returns NULL under service-role and would silently match no rows. The caller (Edge Fn) iterates over recipient user_ids and passes each as `p_user_id`. Documented in plan body, NOT in committed SQL comments (per `feedback_negation_grep_defeated_by_comment_string` — keep rejected-alternative names out of committed files).

3. **Grants to service_role only.** Not granted to `authenticated`, not to `public`. Threat T-49-06 (Elevation: non-service-role caller bypasses RLS via RPC) is mitigated at the grant layer.

4. **Phase 45 leaderboard formula reused verbatim.** `score = posts*3 + (reactions + comments)*1` over rolling-7d. Since `digest_community_top3_7d` returns one row per post, the `posts*3` base contribution is a constant `3` added per row.

5. **`set search_path = public, extensions` on every function** (per `reference_supabase_migration_gotchas`). Required for SECDEF — without it, qualified `extensions.*` calls (e.g., future pgcrypto/uuid use) would fail when the caller's search_path doesn't include them.

6. **Timestamp `20271001000007` chosen.** Sibling Wave 0 plan 49-01 consumed `…000001`, `…000002`, `…000003`. `000007` leaves room for 49-02 / other Wave 0 plans without collision.

## Threat Flags

None. Trust boundary (service-role → SECDEF RPC) is documented in PLAN threat model; mitigations (grant layer) are applied.

## Deviations from Plan

None — plan executed exactly as written. Plan provided all 6 SQL bodies inline; assembled verbatim plus header comment block.

## Deferrals

- **Cross-RPC integration test** lives in Plan 49-05 (Wave 0 test scaffold) — `digest-helpers.test.ts` asserts shape + per-user filter per RPC.
- **`supabase db push --linked`** deferred to Wave 3 close-out (49-10). Migration file is NOT pushed by this plan.

## Self-Check: PASSED

- File exists: `supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql` (FOUND)
- Commit exists: `ad9fc4d6` (FOUND on worktree branch)
- All 12 acceptance-criteria greps pass (table above)
- Filename regex `^[0-9]{14}_name.sql` matches
- No untracked files left in working tree

## Commits

- `ad9fc4d6` — `feat(49-03): 6 SECDEF digest helper RPCs (daily + weekly)`
