-- Phase 46 Plan 01 — Course RLS policies.
--
-- Implements:
--   D-02: course_lessons SELECT gated by tier_effective.has_active (with is_free_preview bypass).
--   D-07: anon can SELECT is_free_preview=true lessons (marketing landing free-preview).
--   D-08: course/module catalog metadata public — auth and anon can list (admin gates writes).
--   D-14: certificates anon SELECT permitted for /verify/<cert_id> route; HMAC is the
--         security boundary (app-layer constant-time compare), not RLS.
--   T-46-01 mitigation: cross-tier lesson read isolation enforced by tier_effective EXISTS.
--   T-46-07 mitigation: only public.is_staff()=true users can INSERT/UPDATE/DELETE
--           courses, course_modules, course_lessons.
--
-- Anti-patterns avoided:
--   - No GUC-based predicates — all tier checks join tier_effective directly.
--   - No alternative-helper names anywhere in this file (per feedback_negation_grep_defeated_by_comment_string).
--   - Explicit per-verb policies for audit clarity.
--   - No combined-verb shortcuts.
--
-- Per memory reference_supabase_is_staff_helper:
--   `public.is_staff()` is the canonical staff guard (migration 20261101000006).
--   SECDEF + STABLE, reads profiles.is_staff. Used directly in WITH CHECK / USING.

begin;

-- ============================================================
-- Enable RLS on all 5 course tables
-- ============================================================
alter table public.courses           enable row level security;
alter table public.course_modules    enable row level security;
alter table public.course_lessons    enable row level security;
alter table public.lesson_progress   enable row level security;
alter table public.certificates      enable row level security;

-- ============================================================
-- courses — catalog visible to all; writes is_staff-only
-- ============================================================

-- SELECT: catalog metadata public — auth + anon (marketing landing course list).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'courses'
      and policyname = 'courses_select_all'
  ) then
    create policy courses_select_all
      on public.courses
      for select to authenticated, anon
      using (true);
  end if;
end $$;

-- INSERT/UPDATE/DELETE: staff-only via public.is_staff().
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'courses'
      and policyname = 'courses_write_staff'
  ) then
    create policy courses_write_staff
      on public.courses
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- ============================================================
-- course_modules — catalog visible to all; writes is_staff-only
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_modules'
      and policyname = 'course_modules_select_all'
  ) then
    create policy course_modules_select_all
      on public.course_modules
      for select to authenticated, anon
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_modules'
      and policyname = 'course_modules_write_staff'
  ) then
    create policy course_modules_write_staff
      on public.course_modules
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- ============================================================
-- course_lessons — TIER-GATED SELECT (D-02 + D-07); writes is_staff-only
-- ============================================================

-- SELECT for authenticated: is_free_preview bypass OR tier_effective.has_active=true.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_lessons'
      and policyname = 'course_lessons_select_tier'
  ) then
    create policy course_lessons_select_tier
      on public.course_lessons
      for select to authenticated
      using (
        is_free_preview = true
        or exists (
          select 1 from public.tier_effective te
          where te.user_id = auth.uid()
            and te.has_active = true
        )
      );
  end if;
end $$;

-- SELECT for anon: only is_free_preview=true (marketing landing free-preview snippet).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_lessons'
      and policyname = 'course_lessons_select_anon_preview'
  ) then
    create policy course_lessons_select_anon_preview
      on public.course_lessons
      for select to anon
      using (is_free_preview = true);
  end if;
end $$;

-- INSERT/UPDATE/DELETE: staff-only via public.is_staff().
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_lessons'
      and policyname = 'course_lessons_write_staff'
  ) then
    create policy course_lessons_write_staff
      on public.course_lessons
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- ============================================================
-- lesson_progress — per-user isolation (T-46-01)
-- ============================================================

-- SELECT: own rows only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lesson_progress'
      and policyname = 'lesson_progress_select_own'
  ) then
    create policy lesson_progress_select_own
      on public.lesson_progress
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- INSERT: own row only (optimistic-UI debounce path also goes through SECDEF RPC).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lesson_progress'
      and policyname = 'lesson_progress_upsert_own'
  ) then
    create policy lesson_progress_upsert_own
      on public.lesson_progress
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;

-- UPDATE: own row only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lesson_progress'
      and policyname = 'lesson_progress_update_own'
  ) then
    create policy lesson_progress_update_own
      on public.lesson_progress
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ============================================================
-- certificates — own SELECT for authenticated + anon SELECT for /verify/<id>
-- ============================================================

-- SELECT: authenticated user reads own rows. anon also reads — security boundary is the
-- HMAC verification_token constant-time compare in the SPA cert-verify page (D-14).
-- This is intentional: the public /verify/<cert_id>?token=<hmac> route needs to read by
-- id without auth, and the HMAC validates authenticity.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'certificates'
      and policyname = 'certificates_select_own_or_token'
  ) then
    create policy certificates_select_own_or_token
      on public.certificates
      for select to authenticated, anon
      using (
        user_id = auth.uid()
        or verification_token is not null
      );
  end if;
end $$;

-- NO authenticated INSERT/UPDATE/DELETE on certificates — only service_role (the
-- complete_course SECDEF RPC + generate-course-certificate Edge Fn) writes certificates.
-- service_role bypasses RLS automatically.

commit;
