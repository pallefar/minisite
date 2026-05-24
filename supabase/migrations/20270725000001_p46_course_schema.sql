-- Phase 46 Plan 01 — Course schema: 5 tables + indexes + CHECK constraints.
--
-- Decisions implemented:
--   D-01: 3-level course hierarchy (courses → course_modules → course_lessons).
--   D-04: lesson_progress per (user_id, lesson_id) PK with denormalized course_id for
--         course-level completion-count queries by complete_course RPC.
--   D-05: course_lessons carries mux_asset_id + mux_playback_id + mux_status lifecycle
--         (pending|processing|ready|rejected|errored). Caps + signed-playback decisions
--         in 46-CONTEXT D-05/D-07; capped at 30 min via mux-create-upload Fn (not schema).
--   D-06: course_lessons.captions_enabled boolean default true (caption auto-gen at upload).
--   D-09: lesson_progress.max_position_reached_seconds = anti-skip server-of-record
--         (D-12 ≥95% threshold check; GREATEST() in update_lesson_position RPC).
--   D-11: courses.completion_threshold_pct integer (1..100) — gates complete_course RPC.
--   D-14: certificates.verification_token unique HMAC token written by Edge Fn after
--         creation (RPC inserts a placeholder; generate-course-certificate computes HMAC).
--
-- Live-DB precheck (2026-05-23): zero existing `course*`, `lesson*`, `certificate*` tables
-- in `public` — all schema is net-new. No `IF NOT EXISTS` guards needed for correctness, but
-- they are present anyway per the p44 idempotency convention.
--
-- Anti-patterns avoided (per memory references):
--   - No alternative-helper references in comments (per feedback_negation_grep_defeated_by_comment_string)
--   - No idempotent-toggle anti-pattern (use SECDEF RPC with branch INSERT/DELETE instead)
--   - No phase-level A/B variant column on course tables (per RESEARCH correction 6).

begin;

-- ============================================================
-- courses — Root of 3-level hierarchy (D-01, D-11)
-- ============================================================
create table if not exists public.courses (
  id                        uuid        primary key default gen_random_uuid(),
  title                     text        not null,
  slug                      text        not null unique,
  description               text,
  cover_url                 text,
  -- D-11: 1..100 — gate for complete_course RPC; 100=all required lessons.
  completion_threshold_pct  integer     not null default 100
                              constraint courses_threshold_chk
                              check (completion_threshold_pct between 1 and 100),
  -- D-12: enforce_completion=false short-circuits the ≥95% anti-skip gate (admin override
  -- for, e.g., open-book bonus modules). Default true (per RESEARCH Pattern 7 + Pitfall 5).
  enforce_completion        boolean     not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.courses is 'P46 D-01: 3-level course hierarchy root. Threshold + enforce_completion gate completion.';
comment on column public.courses.completion_threshold_pct is 'P46 D-11: % of required lessons needed for course completion. Default 100.';
comment on column public.courses.enforce_completion is 'P46 D-12: false bypasses the ≥95% anti-skip gate in complete_lesson RPC.';

-- ============================================================
-- course_modules — Section grouping within a course (D-01)
-- ============================================================
create table if not exists public.course_modules (
  id           uuid        primary key default gen_random_uuid(),
  course_id    uuid        not null references public.courses(id) on delete cascade,
  title        text        not null,
  order_index  integer     not null
                 constraint course_modules_order_chk
                 check (order_index >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.course_modules is 'P46 D-01: Module grouping within a course; ordered by order_index.';

-- D-01: course-scoped ordered list — primary index pattern for sidebar render.
create index if not exists course_modules_course_order_idx
  on public.course_modules (course_id, order_index);

-- ============================================================
-- course_lessons — Leaf lesson with Mux video (D-01, D-05, D-06, D-09)
-- ============================================================
create table if not exists public.course_lessons (
  id                   uuid        primary key default gen_random_uuid(),
  module_id            uuid        not null references public.course_modules(id) on delete cascade,
  title                text        not null,
  content_md           text,
  order_index          integer     not null
                         constraint course_lessons_order_chk
                         check (order_index >= 0),
  -- D-05: Mux video lifecycle — set by mux-webhook Edge Fn.
  mux_asset_id         text,
  mux_playback_id      text,
  mux_status           text        not null default 'pending' constraint course_lessons_mux_status_chk check (mux_status in ('pending','processing','ready','rejected','errored')),
  duration_seconds     integer,
  -- D-07: is_free_preview=true bypasses RLS tier gate (anon + free can read).
  is_free_preview      boolean     not null default false,
  -- D-11: only is_required=true lessons count toward course completion threshold.
  is_required          boolean     not null default true,
  -- D-06: caption auto-generation default on (override per-lesson in admin UI).
  captions_enabled     boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.course_lessons is 'P46 D-01/D-05/D-06/D-07: Leaf lesson with Mux signed-playback video.';
comment on column public.course_lessons.mux_status is 'P46 D-05: Mux lifecycle — pending→processing→ready|rejected|errored. Set by mux-webhook.';
comment on column public.course_lessons.is_free_preview is 'P46 D-07: bypasses tier gate; anon + free-tier users can read.';
comment on column public.course_lessons.is_required is 'P46 D-11: counts toward course completion threshold when true.';

-- D-01: module-scoped ordered list — primary index for sidebar render + ordered fetch.
create index if not exists course_lessons_module_order_idx
  on public.course_lessons (module_id, order_index);

-- ============================================================
-- lesson_progress — Per-user per-lesson watch position (D-04, D-09, D-12)
-- ============================================================
create table if not exists public.lesson_progress (
  user_id                          uuid        not null references auth.users(id) on delete cascade,
  lesson_id                        uuid        not null references public.course_lessons(id) on delete cascade,
  -- D-04: denormalized course_id for complete_course RPC count queries (avoids 2-table join per check).
  course_id                        uuid        not null references public.courses(id) on delete cascade,
  completed_at                     timestamptz,
  last_position_seconds            integer     not null default 0,
  -- D-09: anti-skip server-of-record. update_lesson_position RPC enforces GREATEST(old, new)
  -- so scrub-back never regresses this value (per RESEARCH Pattern 7).
  max_position_reached_seconds     integer     not null default 0,
  last_seen_at                     timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

comment on table public.lesson_progress is 'P46 D-04/D-09: Per-user per-lesson position. max_position_reached_seconds is the ≥95% anti-skip basis.';
comment on column public.lesson_progress.max_position_reached_seconds is 'P46 D-09: never regresses; update_lesson_position uses GREATEST(...).';

-- D-04: course-scoped per-user index for complete_course RPC required-completed count.
create index if not exists lesson_progress_course_user_idx
  on public.lesson_progress (course_id, user_id);

-- ============================================================
-- certificates — Per-user per-course completion certificate (D-14)
-- ============================================================
create table if not exists public.certificates (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  course_id            uuid        not null references public.courses(id) on delete cascade,
  issued_at            timestamptz not null default now(),
  version              integer     not null default 1,
  pdf_path             text,
  -- D-14: HMAC verification token; complete_course RPC inserts a placeholder
  -- (`PENDING_<uuid>`) and generate-course-certificate Edge Fn UPDATEs with the
  -- final HMAC over (cert_id, user_id, course_id, issued_at). UNIQUE prevents
  -- collision across re-issue.
  verification_token   text        not null unique,
  unique (user_id, course_id, version)
);

comment on table public.certificates is 'P46 D-14: Per-user per-course completion certificate with HMAC verification_token.';
comment on column public.certificates.verification_token is 'P46 D-14: HMAC(secret, cert_id:user_id:course_id:issued_at). Written by Edge Fn post-insert.';

-- D-14: per-user lookup index for /classroom certificate list view.
create index if not exists certificates_user_course_idx
  on public.certificates (user_id, course_id);

commit;
