-- Phase 42 Plan 42-06 (POLISH-11) — "What's New" drawer: changelog_entries
--
-- Stores admin-curated changelog posts surfaced to all authenticated users.
-- Per CONTEXT D-11 (Claude's Discretion section, POLISH-11): admin-curated,
-- NOT git-log auto-generated.
--
-- Columns:
--   id            uuid pk (default gen_random_uuid)
--   slug          text UNIQUE NOT NULL  — human/SEO-friendly stable id
--   title         text NOT NULL          — drawer headline
--   body_md       text NOT NULL          — markdown source; renderer (42-09)
--                                          uses react-markdown + dompurify;
--                                          NO inline HTML allowed
--   published_at  timestamptz NOT NULL DEFAULT now() — drives drawer ordering
--                                                       + dismissal "unread" calc
--   created_at    timestamptz NOT NULL DEFAULT now()
--   updated_at    timestamptz NOT NULL DEFAULT now()
--
-- Indexes:
--   (published_at DESC) — drawer SELECT ... ORDER BY published_at DESC LIMIT N
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS.
-- RLS policies live in 20270704000012_changelog_rls.sql.

CREATE TABLE IF NOT EXISTS public.changelog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body_md text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS changelog_entries_published_at_desc_idx
  ON public.changelog_entries (published_at DESC);

-- Auto-touch updated_at via shared trigger function if one exists in the
-- project; otherwise create one locally.
CREATE OR REPLACE FUNCTION public._changelog_entries_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS changelog_entries_touch_updated_at ON public.changelog_entries;
CREATE TRIGGER changelog_entries_touch_updated_at
  BEFORE UPDATE ON public.changelog_entries
  FOR EACH ROW
  EXECUTE FUNCTION public._changelog_entries_touch_updated_at();

COMMENT ON TABLE public.changelog_entries IS
  'Phase 42 POLISH-11: admin-curated "What''s New" drawer entries. RLS in 20270704000012.';
