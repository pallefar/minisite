// Phase 49 Plan 05 — Wave 0 test scaffold: FTS schema assertions.
//
// Asserts community_posts.search_en + search_es GENERATED columns populate on INSERT,
// and that GIN indexes are used for FTS lookups. Body-only weight A per D-17
// (community_posts has no title column).
//
// These tests run against the live linked Supabase project (service-role); they create
// short-lived fixture rows and clean up after themselves. Marked TODO until Wave 1
// Edge Fn plans (49-06/07/08) wire fixture creation.

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.test('community_posts.search_en populates on INSERT (body-only weight A per D-17)', async () => {
  // TODO (Wave 1 GREEN): live-DB INSERT a fixture community_posts row, SELECT search_en,
  // assert non-null tsvector, assert match against websearch_to_tsquery('english','dosing').
  // Cleanup row via DELETE WHERE id = fixture_id.
  assertExists(url, 'SUPABASE_URL env required');
  assertExists(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY env required');
});

Deno.test('community_posts.search_es populates on INSERT (spanish regconfig)', async () => {
  // TODO (Wave 1 GREEN): same INSERT, assert search_es uses spanish tokenizer
  // (test fixture body "Ajuste de dosis" should tokenize "dosis" not "dosi").
});

Deno.test('course_lessons.search_en uses title=A + content_md=B', async () => {
  // TODO (Wave 1 GREEN): INSERT fixture course_lessons row; SELECT search_en;
  // assert title term weight > body term weight via ts_rank.
});

Deno.test('events.search_en uses title=A + description=B', async () => {
  // TODO (Wave 1 GREEN): INSERT fixture events row; assert search_en weighted vector.
});

Deno.test('GIN index used for community_posts.search_en lookups', async () => {
  // TODO (Wave 1 GREEN): EXPLAIN (FORMAT JSON) a websearch_to_tsquery filter;
  // assert plan contains "Bitmap Index Scan" on the GIN index.
});
