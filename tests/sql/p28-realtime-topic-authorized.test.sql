-- Phase 28 Plan 04 — SQL unit test for public.realtime_topic_authorized(topic, claims).
-- Run via: npx supabase db query --linked --file tests/sql/p28-realtime-topic-authorized.test.sql
--
-- Strategy: dynamically compute expected HMAC using extensions.hmac + the live Vault
-- secret (via public.get_realtime_secret()) so tests remain valid across secret rotation.
-- All 6 cases per addendum A4 plan-checker BLOCKER.
--
-- Verification: no 'FAIL' rows in output.

with
  -- Read the live Vault secret once so all cases share the same secret.
  secret_cte as (
    select public.get_realtime_secret() as sec
  ),

  -- Fixture: a known org_id for the "happy path" cases.
  -- We use a stable UUID; the HMAC is derived dynamically below.
  fixture_cte as (
    select
      '11111111-1111-1111-1111-111111111111'::text as org_id_valid,
      '22222222-2222-2222-2222-222222222222'::text as org_id_other,
      'org_members'                                 as tbl
  ),

  -- Pre-compute the HMAC prefix for (org_id_valid, 'org_members').
  hmac_cte as (
    select
      left(
        encode(
          extensions.hmac(
            f.org_id_valid || ':' || f.tbl,
            s.sec,
            'sha256'
          ),
          'hex'
        ),
        8
      ) as expected_prefix_valid,
      f.org_id_valid,
      f.org_id_other,
      f.tbl
    from fixture_cte f, secret_cte s
  )

-- ── Case 1: happy path ──────────────────────────────────────────────────────
-- topic is 'org-{correct_hmac}-org_members'; claims contain the matching org_id.
-- Expected: true.
select
  'Case 1 — happy path (valid topic + org_id in claims)' as assertion,
  case
    when public.realtime_topic_authorized(
      'org-' || h.expected_prefix_valid || '-' || h.tbl,
      jsonb_build_object(
        'sub', 'user-uuid-1',
        'app_metadata', jsonb_build_object(
          'org_ids', jsonb_build_array(h.org_id_valid)
        )
      )
    ) = true
    then 'OK'
    else 'FAIL: Case 1 expected true, got false'
  end as result
from hmac_cte h

union all

-- ── Case 2: defense-in-depth (HMAC matches but org NOT in claims) ───────────
-- topic is correct (HMAC of org_id_valid), but claims.org_ids contains only
-- a DIFFERENT org_id (org_id_other). Expected: false per Pitfall 2.
select
  'Case 2 — defense-in-depth (HMAC valid, org_id NOT in claims)',
  case
    when public.realtime_topic_authorized(
      'org-' || h.expected_prefix_valid || '-' || h.tbl,
      jsonb_build_object(
        'sub', 'user-uuid-2',
        'app_metadata', jsonb_build_object(
          'org_ids', jsonb_build_array(h.org_id_other)  -- different org
        )
      )
    ) = false
    then 'OK'
    else 'FAIL: Case 2 expected false (defense-in-depth), got true'
  end
from hmac_cte h

union all

-- ── Case 3: HMAC mismatch ───────────────────────────────────────────────────
-- topic has a wrong 8-hex prefix ('deadbeef'), but claims.org_ids has the
-- valid org_id. The HMAC of (org_id_valid, table) won't be 'deadbeef'.
-- Expected: false.
select
  'Case 3 — HMAC mismatch (wrong prefix in topic, org_id in claims)',
  case
    when public.realtime_topic_authorized(
      'org-deadbeef-org_members',
      jsonb_build_object(
        'sub', 'user-uuid-3',
        'app_metadata', jsonb_build_object(
          'org_ids', jsonb_build_array(h.org_id_valid)
        )
      )
    ) = false
    then 'OK'
    else 'FAIL: Case 3 expected false (HMAC mismatch), got true'
  end
from hmac_cte h

union all

-- ── Case 4: malformed topic shape ─────────────────────────────────────────
-- topic does not match '^org-[0-9a-f]{8}-[a-z_]+$'. Expected: false.
select
  'Case 4 — malformed topic (not-an-org-topic)',
  case
    when public.realtime_topic_authorized(
      'not-an-org-topic',
      jsonb_build_object(
        'sub', 'user-uuid-4',
        'app_metadata', jsonb_build_object(
          'org_ids', jsonb_build_array('any-org-id')
        )
      )
    ) = false
    then 'OK'
    else 'FAIL: Case 4 expected false (malformed topic), got true'
  end
from hmac_cte h

union all

-- ── Case 5: uppercase table name in topic (regex rejects uppercase) ─────────
-- topic = 'org-abcd1234-INVALID_TABLE'; the pattern requires [a-z_]+.
-- Expected: false.
select
  'Case 5 — uppercase table name in topic (regex rejects)',
  case
    when public.realtime_topic_authorized(
      'org-abcd1234-INVALID_TABLE',
      jsonb_build_object(
        'sub', 'user-uuid-5',
        'app_metadata', jsonb_build_object(
          'org_ids', jsonb_build_array('any-org-id')
        )
      )
    ) = false
    then 'OK'
    else 'FAIL: Case 5 expected false (uppercase table), got true'
  end
from hmac_cte h

union all

-- ── Case 6: empty claims object ────────────────────────────────────────────
-- claims = '{}' — no app_metadata key at all. Expected: false.
select
  'Case 6 — empty claims (no org_ids)',
  case
    when public.realtime_topic_authorized(
      'org-' || h.expected_prefix_valid || '-org_members',
      '{}'::jsonb
    ) = false
    then 'OK'
    else 'FAIL: Case 6 expected false (empty claims), got true'
  end
from hmac_cte h;
