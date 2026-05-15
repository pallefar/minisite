-- Phase 15 Plan 01 — DEFERRABLE INITIALLY DEFERRED FK
-- `landing_pages.published_revision_id → landing_page_revisions(id)`.
--
-- This FK closes the circular dependency (RESEARCH Pitfall 6) AND is
-- DEFERRABLE INITIALLY DEFERRED so a single transaction can:
--   1. insert into landing_pages (published_revision_id = null)
--   2. insert into landing_page_revisions (page_id = the new page)
--   3. update landing_pages set published_revision_id = the new revision
-- without violating the FK at any intermediate row state (FK is checked at
-- transaction commit, not row insert).
--
-- ON DELETE SET NULL — if the pointed-to revision is somehow deleted (cascade
-- from the page itself OR an admin scrub), the page row remains and just
-- loses its published pointer, becoming a draft. Safer than CASCADE here.

alter table public.landing_pages
  add constraint fk_published_revision
  foreign key (published_revision_id)
  references public.landing_page_revisions(id)
  on delete set null
  deferrable initially deferred;
