-- Phase 23 Plan 23-04 (DEBT-03) — Photo trash flow: soft-delete column + indexes.
--
-- Adds `trashed_at timestamptz null` to public.photos so users can soft-delete
-- photos and recover them within a 30-day window before permanent deletion.
--
-- Index strategy:
--   photos_user_date_active_idx — replaces the old photos_user_date_idx.
--     Partial index on (user_id, date desc) WHERE trashed_at IS NULL.
--     This is the hot-path index for the main photo grid query; excluding
--     trashed rows keeps it tight and the WHERE clause is IMMUTABLE-safe (NULL
--     test on a plain column, not a function call).
--
--   photos_user_trashed_idx — companion for the Trash view fetch and the
--     photos-trash-purge cron's expired-rows scan.
--     Partial index on (user_id, trashed_at desc) WHERE trashed_at IS NOT NULL.
--
-- RLS posture (NO new policies required):
--   The existing RLS policies — photos_select_own, photos_insert_own,
--   photos_update_own, photos_delete_own — already scope every operation to
--   `auth.uid() = user_id`. Since `trashed_at` is just a column on rows the
--   authenticated user already owns, the existing policies are sufficient:
--
--     * Soft-delete (set trashed_at = NOW()):  covered by photos_update_own.
--     * Restore (set trashed_at = NULL):        covered by photos_update_own.
--     * Delete-permanently:                     covered by photos_delete_own.
--     * Trash-view SELECT (trashed_at IS NOT NULL): covered by photos_select_own.
--     * Main-grid SELECT (trashed_at IS NULL):  covered by photos_select_own.
--
--   Cross-tenant isolation is enforced purely through `auth.uid() = user_id`.
--   No explicit `trashed_at` filter in the policy is needed — clients filter
--   by trashed status themselves, but even if they forget, RLS ensures they
--   can only ever see their own rows.

alter table public.photos
  add column trashed_at timestamptz null;

-- Drop the old covering index (replaced by the partial below).
drop index if exists public.photos_user_date_idx;

-- Hot-path index: main photo grid queries WHERE trashed_at IS NULL.
create index photos_user_date_active_idx on public.photos (user_id, date desc)
  where trashed_at is null;

-- Companion index: Trash-view fetch + cron scan (WHERE trashed_at IS NOT NULL).
create index photos_user_trashed_idx on public.photos (user_id, trashed_at desc)
  where trashed_at is not null;
