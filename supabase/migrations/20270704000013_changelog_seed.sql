-- Phase 42 Plan 42-06 (POLISH-11) — Initial v1.3 changelog entries seed.
--
-- Three hand-curated entries spanning v1.3 highlights:
--   1. Smart Notifications (POLISH-05/06)
--   2. PWA Offline read-only (POLISH-07)
--   3. Dark Mode parity (POLISH-08)
--
-- Body content is pure markdown (no inline HTML). The drawer renderer in
-- plan 42-09 wraps react-markdown + dompurify so even if an admin pastes
-- HTML later, it's sanitized. Seeded body is deliberately clean.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING — re-running the migration
-- does NOT overwrite admin edits to title/body in production.
--
-- published_at timestamps are staggered (oldest first, newest last) so the
-- drawer ordering exercise (ORDER BY published_at DESC) is visible end-to-end.

INSERT INTO public.changelog_entries (slug, title, body_md, published_at)
VALUES
  (
    'v1-3-smart-notifications',
    'Smart Notifications are here',
    E'You can now choose how LeanShot reaches you for each kind of update.\n\n' ||
    E'**Five categories** — dose reminders, AI insights, clinic alerts, billing, and product news — each with independent toggles for **email**, **web push**, and **in-app** delivery.\n\n' ||
    E'We pick sensible defaults for each combination, and you can dial things down (but never up past safe defaults) from `Settings → Notifications`.\n\n' ||
    E'If you dismiss several of the same kind in a row, we automatically cut that category''s frequency in half for a week. Tap the banner to restore at any time.',
    '2026-05-15T10:00:00Z'::timestamptz
  ),
  (
    'v1-3-pwa-offline',
    'View your data offline',
    E'LeanShot is now installable as a Progressive Web App, and your existing data is fully viewable when you''re offline.\n\n' ||
    E'Charts, history, projections, and your AI coach conversation are all available without a network connection.\n\n' ||
    E'**Heads up:** logging new injections, weight, symptoms, or workouts still requires you to be online — a banner will appear so you don''t lose data. Background sync queues are on the roadmap.',
    '2026-05-17T10:00:00Z'::timestamptz
  ),
  (
    'v1-3-dark-mode',
    'Dark mode, everywhere',
    E'Dark mode is now consistent across every surface, including the admin tools, clinic dashboard, helpdesk, onboarding flow, community, and courses.\n\n' ||
    E'No more half-lit screens. The toggle lives in `Settings → Appearance` and respects your system preference by default.',
    '2026-05-19T10:00:00Z'::timestamptz
  )
ON CONFLICT (slug) DO NOTHING;
