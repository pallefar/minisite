-- =============================================================================
-- Phase 46 Plan 08 SUPPLEMENTAL — course_lessons.resources jsonb column
-- =============================================================================
-- Plan 46-01 (course schema) did NOT include the per-lesson `resources`
-- column referenced by COURSE-06 + the LessonResourceList component in
-- Plan 46-08. This migration adds it idempotently. Filename timestamp
-- is the next free slot after Plan 46-02..05 (000001..000005).
--
-- Shape: jsonb array of objects, each
--   {
--     "name":         "Worksheet.pdf",        // displayed label
--     "path":         "<storage object key>", // course-resources bucket path
--     "mime":         "application/pdf",      // MIME (PDF / MP4 / ZIP per Plan 08)
--     "size":         12345,                  // bytes (optional but recommended)
--     "requires_pro": true                    // tier-gate flag (Pro/Trial/Lifetime)
--   }
--
-- Writers: admin LessonResourceUploader in Plan 46-09 (UPDATE course_lessons
--          SET resources = <new array> WHERE id = $lesson_id). RLS
--          `course_lessons_write_staff` (Plan 46-02) gates this to staff.
-- Readers: src/components/course/LessonResourceList.tsx — iterates the
--          array, applies isResourceAllowed(tier, type) gate, then calls
--          downloadResourceSignedUrl(path) for entitled clicks.
--
-- T-46-06 (path traversal) — paths in this column are written ONLY by the
-- admin uploader which uses Storage's createSignedUploadUrl helper; the
-- bucket RLS path-prefix gate is the durable enforcement boundary.
-- =============================================================================

alter table public.course_lessons
  add column if not exists resources jsonb not null default '[]'::jsonb;

comment on column public.course_lessons.resources is
  'P46 COURSE-06 / Plan 08: jsonb array of {name, path, mime, size, requires_pro} per-lesson downloadable resources. Written by admin LessonResourceUploader (Plan 46-09); read by client LessonResourceList. Tier-gate via isResourceAllowed; storage RLS on course-resources bucket is the durable boundary.';
