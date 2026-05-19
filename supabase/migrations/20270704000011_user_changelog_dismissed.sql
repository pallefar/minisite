-- Phase 42 Plan 42-06 (POLISH-11) — Per-user changelog dismissal state.
--
-- Tracks the last time a user "saw" the What's New drawer. The dot indicator
-- on the avatar is computed as:
--   EXISTS(SELECT 1 FROM changelog_entries
--          WHERE published_at > coalesce(user_changelog_dismissed.last_seen_published_at,
--                                         '1970-01-01'::timestamptz))
--
-- POST /functions/v1/changelog-mark-read sets last_seen_published_at = now()
-- for the calling user. UPSERT-on-conflict (user_id) DO UPDATE.
--
-- Columns:
--   user_id                 uuid PK REFERENCES auth.users(id) ON DELETE CASCADE
--   last_seen_published_at  timestamptz NOT NULL DEFAULT now()
--   updated_at              timestamptz NOT NULL DEFAULT now()
--
-- RLS in 20270704000012_changelog_rls.sql — per-user select/insert/update.
-- Foreign key cascade ensures row evaporates with the user.

CREATE TABLE IF NOT EXISTS public.user_changelog_dismissed (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public._user_changelog_dismissed_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_changelog_dismissed_touch_updated_at
  ON public.user_changelog_dismissed;
CREATE TRIGGER user_changelog_dismissed_touch_updated_at
  BEFORE UPDATE ON public.user_changelog_dismissed
  FOR EACH ROW
  EXECUTE FUNCTION public._user_changelog_dismissed_touch_updated_at();

COMMENT ON TABLE public.user_changelog_dismissed IS
  'Phase 42 POLISH-11: per-user last_seen_published_at for What''s New drawer dot indicator.';
