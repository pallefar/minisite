-- Phase 44 Plan 01 — Community schema: 7 tables + indexes + CHECK constraints + trigger.
--
-- Decisions implemented:
--   D-01: community_comments.parent_comment_id nullable (flat threads; Phase 45+ can lift cap)
--   D-02: community_reactions with UNIQUE(user_id,target_type,target_id,emoji) for toggle idempotency
--   D-03: reactions emoji CHECK: ('like','heart','target','fire','clap')
--   D-04: community_post_media trigger enforces 10-image cap
--   D-05: community_posts carries mux_upload_id + mux_playback_id + video_status
--   D-09: community_spaces.org_id nullable → RLS isolates per-org rows
--   D-11: body CHECK char_length <= 5000 on posts and comments
--   D-12: (space_id, created_at) index on community_posts; (post_id, created_at) on community_comments
--   D-15: deleted_at soft-delete on posts + comments; hard-delete is admin-only in Phase 48
--
-- RESEARCH Pitfall 5 (Realtime filter efficiency):
--   community_comments carries denormalized space_id (NOT NULL) so the per-space channel
--   can filter on space_id=eq.${spaceId} directly rather than doing a cross-table join.
--
-- Anti-patterns avoided (per Phase 28 + helpdesk conventions):
--   - No tautological-bypass predicates
--   - No GUC-based predicates in policies (handled in migration 20270720000002)
--   - Explicit per-verb policies in RLS migration

begin;

-- ============================================================
-- community_spaces — Space (D-09 org_id nullable for org-private)
-- ============================================================
create table if not exists public.community_spaces (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  org_id      uuid        references public.organizations(id) on delete cascade,
  -- D-08: min_tier='free' by default; 'pro'/'lifetime' gates access via RLS + cpost_select_tier
  min_tier    text        not null default 'free'
                constraint community_spaces_min_tier_chk
                check (min_tier in ('free','pro','lifetime')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.community_spaces is 'P44 D-08/D-09: Skool-style Spaces with per-tier min access and optional org-private isolation.';
comment on column public.community_spaces.org_id is 'P44 D-09: NULL=global space; NOT NULL=clinic-private, visible only to org_members.';
comment on column public.community_spaces.min_tier is 'P44 D-08: minimum tier to read posts. free|pro|lifetime. RLS cpost_select_tier enforces.';

-- ============================================================
-- community_posts — Post (D-05 Mux columns; D-11 body cap; D-15 soft-delete)
-- ============================================================
create table if not exists public.community_posts (
  id              uuid        primary key default gen_random_uuid(),
  space_id        uuid        not null references public.community_spaces(id) on delete cascade,
  author_id       uuid        references auth.users(id) on delete set null,
  body            text        not null
                    constraint community_posts_body_len_chk
                    check (char_length(body) <= 5000),
  -- D-05: Mux video — single video per post; status lifecycle: uploading→processing→ready|rejected
  mux_upload_id   text,
  mux_playback_id text,
  video_status    text
                    constraint community_posts_video_status_chk
                    check (video_status in ('uploading','processing','ready','rejected')),
  created_at      timestamptz not null default now(),
  -- D-15: edited_at updated on each edit; deleted_at set on soft-delete (body rendered as [deleted])
  edited_at       timestamptz,
  deleted_at      timestamptz
);

comment on table public.community_posts is 'P44 D-11/D-15: Posts within a Space. Soft-delete via deleted_at. Mux video via D-05.';
comment on column public.community_posts.video_status is 'P44 D-05: Mux video lifecycle state — set by mux-webhook Edge Fn.';
comment on column public.community_posts.deleted_at is 'P44 D-15: Soft-delete. Body rendered as [deleted] in UI. Hard-delete is Phase 48 admin-only.';

-- D-12: index on (space_id, created_at DESC) for cursor-paginated feed queries
create index if not exists community_posts_space_created_idx
  on public.community_posts (space_id, created_at desc);

-- ============================================================
-- community_comments — Comment (D-01 parent_comment_id nullable; RESEARCH Pitfall 5 space_id)
-- ============================================================
create table if not exists public.community_comments (
  id                uuid        primary key default gen_random_uuid(),
  post_id           uuid        not null references public.community_posts(id) on delete cascade,
  -- RESEARCH Pitfall 5: denormalized space_id for Realtime filter efficiency
  -- (postgres_changes filter can only target columns of the subscribed table)
  space_id          uuid        not null references public.community_spaces(id) on delete cascade,
  -- D-01: nullable parent_comment_id for flat 1-level threads; Phase 45+ lifts this cap
  parent_comment_id uuid        references public.community_comments(id) on delete cascade,
  author_id         uuid        references auth.users(id) on delete set null,
  body              text        not null
                      constraint community_comments_body_len_chk
                      check (char_length(body) <= 5000),
  created_at        timestamptz not null default now(),
  -- D-15: same soft-delete semantics as community_posts
  edited_at         timestamptz,
  deleted_at        timestamptz
);

comment on table public.community_comments is 'P44 D-01/D-15: Flat-thread comments (depth=1). space_id denormalized per RESEARCH Pitfall 5.';
comment on column public.community_comments.space_id is 'P44 Pitfall 5: Denormalized from parent post for Realtime filter_eq on space_id.';
comment on column public.community_comments.parent_comment_id is 'P44 D-01: Nullable for Phase 45+ threading depth lift. Phase 44 enforces flat via UI only.';

-- D-12: index on (post_id, created_at) for threaded comment pagination
create index if not exists community_comments_post_created_idx
  on public.community_comments (post_id, created_at);

-- Index on space_id for Realtime filter + cross-space query efficiency
create index if not exists community_comments_space_idx
  on public.community_comments (space_id);

-- ============================================================
-- community_reactions — Reactions (D-02 UNIQUE toggle; D-03 fixed emoji set)
-- ============================================================
create table if not exists public.community_reactions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  target_type text        not null
                constraint community_reactions_target_type_chk
                check (target_type in ('post','comment')),
  target_id   uuid        not null,
  -- D-03: fixed 5-emoji set — like, heart, target (🎯), fire (🔥), clap (👏)
  emoji       text        not null
                constraint community_reactions_emoji_chk
                check (emoji in ('like','heart','target','fire','clap')),
  created_at  timestamptz not null default now(),
  -- D-02: UNIQUE constraint is the authoritative idempotency gate for toggle_community_reaction
  constraint community_reactions_unique_toggle
    unique (user_id, target_type, target_id, emoji)
);

comment on table public.community_reactions is 'P44 D-02/D-03: Fixed 5-emoji reactions on posts+comments. UNIQUE drives idempotent toggle via RPC.';
comment on column public.community_reactions.target_type is 'P44 D-02: post or comment — polymorphic reference without FK (target_id is either post.id or comment.id).';

-- Index on (target_type, target_id) for per-entity aggregate queries
create index if not exists community_reactions_target_idx
  on public.community_reactions (target_type, target_id);

-- ============================================================
-- community_post_media — Per-post image attachments (D-04 10-image cap via trigger)
-- ============================================================
create table if not exists public.community_post_media (
  id            uuid    primary key default gen_random_uuid(),
  post_id       uuid    not null references public.community_posts(id) on delete cascade,
  path          text    not null,
  display_order int     not null,
  -- D-04: (post_id, display_order) must be unique for stable carousel ordering
  constraint community_post_media_order_unique
    unique (post_id, display_order)
);

comment on table public.community_post_media is 'P44 D-04: Per-post image attachments in community-media bucket. 10-image cap enforced by trigger below.';

-- D-04: BEFORE INSERT trigger enforces 10-image cap per post
create or replace function public._community_post_media_cap_check()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  if (
    select count(*) from public.community_post_media
    where post_id = NEW.post_id
  ) >= 10 then
    raise exception 'community_post_media_cap' using
      errcode  = 'P0001',
      message  = 'per-post image cap of 10 exceeded (P44 D-04)',
      hint     = 'Remove an existing image before adding another.';
  end if;
  return NEW;
end;
$fn$;

comment on function public._community_post_media_cap_check() is 'P44 D-04: BEFORE INSERT trigger body that enforces the 10-image-per-post cap.';

create or replace trigger community_post_media_cap
  before insert on public.community_post_media
  for each row execute function public._community_post_media_cap_check();

-- ============================================================
-- community_post_mentions — @mention join table for posts (D-14)
-- ============================================================
create table if not exists public.community_post_mentions (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);

comment on table public.community_post_mentions is 'P44 D-14: Resolved @mention user_ids for posts. Populated at insert-time by mention-parse.ts logic.';

-- ============================================================
-- community_comment_mentions — @mention join table for comments (D-14)
-- ============================================================
create table if not exists public.community_comment_mentions (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  primary key (comment_id, user_id)
);

comment on table public.community_comment_mentions is 'P44 D-14: Resolved @mention user_ids for comments. Populated at insert-time by mention-parse.ts logic.';

commit;
