// Phase 49 Plan 05 — Wave 0 test scaffold: search_content RPC contract.
//
// Asserts the cross-table FTS RPC returns top-5 rows per type (post / lesson / event),
// uses the correct regconfig per p_lang, and runs ts_headline only over the LIMIT-5
// survivors per D-21 (CTE-then-headline pattern).
//
// Marked TODO until Wave 1 Edge Fn plans (49-06) wire live fixtures + execution.

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.test('search_content RPC: English query returns top-5-per-type', async () => {
  // TODO (Wave 1 GREEN): seed 6 community_posts + 6 course_lessons + 6 events with
  // "dosing" body matches; supabase.rpc('search_content', {p_query:'dosing', p_lang:'english'});
  // assert each `type` (post / lesson / event) yields exactly 5 rows in result.
  assertExists(url, 'SUPABASE_URL env required');
  assertExists(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY env required');
});

Deno.test('search_content RPC: ts_headline wraps match tokens in <b>', async () => {
  // TODO (Wave 1 GREEN): query 'dosing'; assert snippet contains '<b>dosing</b>'.
});

Deno.test('search_content RPC: Spanish query uses spanish regconfig', async () => {
  // TODO (Wave 1 GREEN): seed post body "Ajuste de dosis"; query 'dosis' p_lang:'spanish';
  // assert row returned. Same query p_lang:'english' MUST NOT return it.
});

Deno.test('search_content RPC: UNION ALL contract returns mixed-type rows', async () => {
  // TODO (Wave 1 GREEN): assert result set contains rows of `type` IN ('post','lesson','event')
  // when fixtures span all three tables.
});

Deno.test('search_content RPC: ts_headline runs only over LIMIT-5 survivors (D-21)', async () => {
  // TODO (Wave 1 GREEN): EXPLAIN (ANALYZE) the RPC; assert ts_headline executes at most
  // 15 times (5 per type × 3 types) regardless of fixture cardinality (CTE-then-headline).
});
