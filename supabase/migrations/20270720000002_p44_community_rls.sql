-- Phase 44 Plan 01 — Community RLS policies.
--
-- Implements:
--   D-08: Free user in a Pro/Lifetime-only space → locked card (0 rows from community_posts)
--   D-09: Clinic-private space for non-org user → hidden entirely (0 rows from community_spaces)
--   D-15: Soft-delete — SELECT policies filter deleted_at IS NULL for posts + comments
--   T-44-01: Cross-tenant isolation proof: org_members EXISTS join (no GUC)
--
-- Anti-patterns avoided:
--   - No GUC-based predicates — all org checks join org_members directly (Phase 28 pattern)
--   - No tautological-bypass predicates
--   - Explicit per-verb policies for audit clarity
--   - No combined-verb shortcuts
--
-- Claude's Discretion (per 44-CONTEXT §Claude's Discretion + D-15):
--   Trial users see Pro content: tier_label IN ('pro','lifetime','trial') in cpost_select_tier.
--   This matches the planning_context that trial = full feature evaluation.

begin;

-- ============================================================
-- Enable RLS on all 7 community tables
-- ============================================================
alter table public.community_spaces            enable row level security;
alter table public.community_posts             enable row level security;
alter table public.community_comments          enable row level security;
alter table public.community_reactions         enable row level security;
alter table public.community_post_media        enable row level security;
alter table public.community_post_mentions     enable row level security;
alter table public.community_comment_mentions  enable row level security;

-- ============================================================
-- community_spaces — 4 policies
-- ============================================================

-- Global spaces (org_id IS NULL) are visible to all authenticated users
create policy cspace_select_global
  on public.community_spaces
  for select to authenticated
  using (org_id is null);

-- Org-private spaces: only members of the target org can see them (D-09)
-- Mirrors kb_select_published_org in helpdesk_rls_policies.sql lines 278-291
create policy cspace_select_org_member
  on public.community_spaces
  for select to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members
      where org_id = community_spaces.org_id
        and user_id = auth.uid()
    )
  );

-- INSERT: staff-only (public.is_staff()) — regular users cannot create spaces
-- Note: Phase 44-09 owns the is_staff migration; this INSERT policy is a placeholder
-- that will be REPLACED by 20270720000006_p44_community_spaces_admin_policies.sql (Plan 44-09).
-- For Wave 0, any authenticated user may insert (RLS will tighten in Wave 2).
-- HOWEVER: to avoid a security gap we use is_staff() if available, else fall back to denying all.
-- Phase 44 plans 44-09 and 44-01 are serialized via depends_on; admin INSERT is deferred to 44-09.
-- No INSERT policy here → only service_role (via admin) can insert spaces in Wave 0.

-- ============================================================
-- community_posts — 4 policies (SELECT tier-gated + soft-delete filtered)
-- ============================================================

-- SELECT: caller must satisfy the space's min_tier via tier_effective (D-08)
-- Trial users get Pro-level access (D-06 + Claude's Discretion)
-- Soft-delete filter: deleted_at IS NULL (D-15)
create policy cpost_select_tier
  on public.community_posts
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.community_spaces cs
      join public.tier_effective te on te.user_id = auth.uid()
      where cs.id = community_posts.space_id
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- INSERT: authenticated + user satisfies space tier (same tier check as SELECT)
create policy cpost_insert_authenticated
  on public.community_posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.community_spaces cs
      join public.tier_effective te on te.user_id = auth.uid()
      where cs.id = community_posts.space_id
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- UPDATE: author-only edit (D-15 — edit forever; Phase 48 adds admin UPDATE)
create policy cpost_update_author
  on public.community_posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- No hard-DELETE policy for non-staff users — D-15 soft-delete is done via UPDATE (set deleted_at).
-- Phase 48 adds an admin-only hard-delete policy using public.is_staff().

-- ============================================================
-- community_comments — 4 policies (tier-gated via parent post; soft-delete filtered)
-- ============================================================

-- SELECT: parent post must be readable (inherits tier gate + soft-delete from post level)
-- Comment-level soft-delete also applied (D-15)
create policy ccomment_select_tier
  on public.community_comments
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_comments.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- INSERT: post must be selectable; author_id = auth.uid()
create policy ccomment_insert_authenticated
  on public.community_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_comments.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- UPDATE: author-only (D-15)
create policy ccomment_update_author
  on public.community_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- No hard-DELETE for non-staff (Phase 48 owns that)

-- ============================================================
-- community_reactions — 2 policies
-- ============================================================

-- SELECT: any authenticated user can read reactions (aggregate counts are non-sensitive)
create policy creaction_select_authenticated
  on public.community_reactions
  for select to authenticated
  using (true);

-- INSERT: user_id = auth.uid() (UNIQUE constraint + toggle_community_reaction RPC handles idempotency)
create policy creaction_insert_self
  on public.community_reactions
  for insert to authenticated
  with check (user_id = auth.uid());

-- DELETE: user can remove their own reaction (raw DELETE; also exercised by toggle RPC via SECDEF)
create policy creaction_delete_self
  on public.community_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- community_post_media — 2 policies (visibility mirrors parent post)
-- ============================================================

-- SELECT: visible when parent post is readable (tier gate via parent post)
create policy cpost_media_select_tier
  on public.community_post_media
  for select to authenticated
  using (
    exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_post_media.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- INSERT: post author can attach media (post must be their own)
create policy cpost_media_insert_author
  on public.community_post_media
  for insert to authenticated
  with check (
    exists (
      select 1 from public.community_posts p
      where p.id = community_post_media.post_id
        and p.author_id = auth.uid()
    )
  );

-- ============================================================
-- community_post_mentions — 2 policies
-- ============================================================

-- SELECT: readable by anyone who can read the parent post
create policy cpost_mentions_select
  on public.community_post_mentions
  for select to authenticated
  using (
    exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_post_mentions.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- INSERT: post author can add mention rows (server-side mention resolution)
create policy cpost_mentions_insert_author
  on public.community_post_mentions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.community_posts p
      where p.id = community_post_mentions.post_id
        and p.author_id = auth.uid()
    )
  );

-- ============================================================
-- community_comment_mentions — 2 policies
-- ============================================================

-- SELECT: readable by anyone who can read the parent comment
create policy ccomment_mentions_select
  on public.community_comment_mentions
  for select to authenticated
  using (
    exists (
      select 1 from public.community_comments c
      join public.community_posts p on p.id = c.post_id
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where c.id = community_comment_mentions.comment_id
        and c.deleted_at is null
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
  );

-- INSERT: comment author can add mention rows
create policy ccomment_mentions_insert_author
  on public.community_comment_mentions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.community_comments c
      where c.id = community_comment_mentions.comment_id
        and c.author_id = auth.uid()
    )
  );

commit;
