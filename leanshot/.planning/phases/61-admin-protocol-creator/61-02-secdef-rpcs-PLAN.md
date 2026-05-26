---
phase: 61-admin-protocol-creator
plan: 02
type: execute
wave: 0
depends_on:
  - 61-01-db-tables-rls
files_modified:
  - supabase/migrations/20260526000002_protocol_secdef_rpcs.sql
autonomous: true
requirements:
  - PROTOCOL-04
  - PROTOCOL-05
  - PROTOCOL-06
must_haves:
  truths:
    - "`publish_protocol(p_protocol_id uuid, p_version int)` returns void and RAISES `SELF_REVIEW_REJECTED` when `auth.uid() = created_by`"
    - "`submit_protocol_for_review(p_protocol_id uuid, p_version int)` transitions draft→in_review and writes audit row"
    - "`rollback_protocol(p_protocol_id uuid, p_target_version int)` archives current published, re-publishes target_version, writes audit row"
    - "`assign_protocol_to_patient(p_protocol_id uuid, p_version int, p_patient_id uuid)` upserts patient_protocol_assignment, validates protocol is published"
    - "`archive_protocol(p_protocol_id uuid, p_version int)` moves any state → archived, writes audit row"
    - "`get_protocol_by_slug(p_base_slug text)` returns latest published version for /protocols/<slug> route"
    - "`list_admin_ai_assist_usage_today()` returns COUNT for caller's UTC-day window (consumed by Edge Fn rate-limit pre-check + admin UI usage chip)"
    - "Every RPC uses `FOR UPDATE` row lock before state read; every RPC verifies `is_staff()` (except `get_protocol_by_slug` which is authenticated-readable)"
    - "All RPCs revoke from public, grant execute to authenticated"
  artifacts:
    - path: "supabase/migrations/20260526000002_protocol_secdef_rpcs.sql"
      provides: "7 SECDEF RPCs implementing the protocol state machine + 2-person rule"
      contains: "create or replace function public.publish_protocol"
  key_links:
    - from: "publish_protocol body"
      to: "auth.uid() != created_by guard"
      via: "RAISE EXCEPTION 'SELF_REVIEW_REJECTED'"
      pattern: "SELF_REVIEW_REJECTED"
    - from: "publish_protocol body"
      to: "protocol_review_log INSERT"
      via: "audit trail every state transition"
      pattern: "insert into public\\.protocol_review_log"
    - from: "publish_protocol body"
      to: "FOR UPDATE row lock"
      via: "concurrency-safe state read"
      pattern: "for\\s+update"
---

<objective>
Ship all 7 SECDEF RPCs implementing the Phase 61 state machine + 2-person review rule + versioning + rollback. Every RPC mirrors the `approve_rag_chunk` shape verbatim (FOR UPDATE → guard → state precondition → UPDATE → audit INSERT).

Purpose: This is the Layer 1 enforcement of PROTOCOL-04 (2-person review) and PROTOCOL-05 (versioning + rollback). The UI layer (Plans 04-07) and Edge Fn (Plan 03) call these RPCs. No state transition is reachable except through these functions.

Output: 1 migration file containing 7 functions, each with REVOKE/GRANT.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Verbatim template — copy publish_protocol shape from this file's approve_rag_chunk:
@/Users/karstenhaldan/minisite/supabase/migrations/20281201000002_phase60_secdef_rpcs.sql

# Schema this plan extends (must exist on disk first — Wave 0 depends_on edge):
@/Users/karstenhaldan/minisite/supabase/migrations/20260526000001_protocol_tables.sql

<interfaces>
<!-- RPCs ship the following signatures. UI plans (04/05/06) and Edge Fn plan (03) call these. -->

-- 2-person review state machine (PROTOCOL-04 + PROTOCOL-05):
public.submit_protocol_for_review(p_protocol_id uuid, p_version int) returns void
public.publish_protocol(p_protocol_id uuid, p_version int) returns void
  RAISES with errcode '42501' + message containing 'SELF_REVIEW_REJECTED' when caller created the row
public.rollback_protocol(p_protocol_id uuid, p_target_version int) returns void
public.archive_protocol(p_protocol_id uuid, p_version int) returns void

-- Clinician adopt flow (PROTOCOL-06):
public.assign_protocol_to_patient(p_protocol_id uuid, p_version int, p_patient_id uuid) returns void
  INSERTs into patient_protocol_assignment with ON CONFLICT (patient_id, protocol_id) DO UPDATE (re-assign newer version)

-- Public route + Edge Fn:
public.get_protocol_by_slug(p_base_slug text) returns table (
  id uuid, version int, name text, compound text, audience text[], slug text, base_slug text,
  published_at timestamptz, steps jsonb, evidence jsonb
)  -- returns latest published version
  USAGE: SELECT * FROM public.get_protocol_by_slug('tirzepatide-12-week-titration');

-- Rate limit support (called by Edge Fn protocol-ai-assist pre-OpenRouter call):
public.list_admin_ai_assist_usage_today() returns int
  COUNTS today's UTC-day rows in admin_ai_assist_log WHERE actor_id = auth.uid()
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write all 7 SECDEF RPCs in one migration</name>
  <files>supabase/migrations/20260526000002_protocol_secdef_rpcs.sql</files>
  <action>
Create `supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` at `/Users/karstenhaldan/minisite/supabase/migrations/`. Open the analog `20281201000002_phase60_secdef_rpcs.sql` and mirror the EXACT shape (lines 36-93 = `approve_rag_chunk`) for every RPC. The shape elements (from RESEARCH.md Pattern 2 and PATTERNS.md "SECDEF RPC skeleton"):

```
create or replace function public.<name>(...)
returns ...
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  ...
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- SELECT ... FOR UPDATE
  -- IF state precondition fails -> RAISE
  -- 2-person guard (where applicable): if v_created_by = auth.uid() ... RAISE 'SELF_REVIEW_REJECTED'
  -- UPDATE state
  -- INSERT audit row into protocol_review_log
end
$$;
revoke all on function public.<name>(...) from public;
grant execute on function public.<name>(...) to authenticated;
```

Implement each function:

**1. `submit_protocol_for_review(p_protocol_id uuid, p_version int) returns void`** —
- staff guard
- SELECT review_state INTO v_state FROM protocols WHERE (id, version) = (p_protocol_id, p_version) FOR UPDATE
- if v_state != 'draft' → RAISE 'cannot submit protocol in state %'
- UPDATE protocols SET review_state='in_review', updated_at=now() WHERE (id, version) = (p_protocol_id, p_version)
- INSERT into protocol_review_log (protocol_id, version, actor, action) values (p_protocol_id, p_version, auth.uid(), 'submitted_for_review')

**2. `publish_protocol(p_protocol_id uuid, p_version int) returns void`** — the 2-person rule centerpiece per PROTOCOL-04:
- staff guard
- SELECT created_by, review_state INTO v_created_by, v_state FROM protocols WHERE (id, version) = (p_protocol_id, p_version) FOR UPDATE
- if not found → RAISE 'protocol % v% not found'
- 2-person guard: `if v_created_by is not null and v_created_by = auth.uid() then raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)', auth.uid(), v_created_by using errcode = '42501'; end if;` — message MUST contain literal substring 'SELF_REVIEW_REJECTED' per PATTERNS.md "2-Person Review" and Pitfall 1 (UI matches on this substring).
- if v_state != 'in_review' → RAISE 'cannot publish protocol in state %'
- Demote prior published version of same id: UPDATE protocols SET review_state='archived' WHERE id = p_protocol_id AND review_state = 'published'
- UPDATE this row: SET review_state='published', published_at=now(), reviewed_by=auth.uid(), reviewed_at=now()
- INSERT audit (action='published')

**3. `rollback_protocol(p_protocol_id uuid, p_target_version int) returns void`** per PROTOCOL-05:
- staff guard
- SELECT review_state INTO v_target_state FROM protocols WHERE (id, version) = (p_protocol_id, p_target_version) FOR UPDATE
- if not found → RAISE 'target version not found'
- if v_target_state != 'archived' → RAISE 'rollback target must be archived' (only previously-published-then-archived versions can be restored)
- Archive current published: UPDATE protocols SET review_state='archived' WHERE id = p_protocol_id AND review_state = 'published'
- Re-publish target: UPDATE protocols SET review_state='published', published_at=now(), reviewed_by=auth.uid(), reviewed_at=now() WHERE (id, version) = (p_protocol_id, p_target_version)
- INSERT audit (action='rolled_back')

**4. `archive_protocol(p_protocol_id uuid, p_version int) returns void`**:
- staff guard
- SELECT review_state INTO v_state FROM protocols WHERE (id, version) = (p_protocol_id, p_version) FOR UPDATE
- UPDATE protocols SET review_state='archived' WHERE (id, version) = (p_protocol_id, p_version)
- INSERT audit (action='archived')

**5. `assign_protocol_to_patient(p_protocol_id uuid, p_version int, p_patient_id uuid) returns void`** per PROTOCOL-06 (RESEARCH.md Code Example 1):
- staff guard
- SELECT review_state INTO v_state FROM protocols WHERE (id, version) = (p_protocol_id, p_version)
- if v_state != 'published' → RAISE 'protocol % v% is not published'
- INSERT INTO patient_protocol_assignment (patient_id, protocol_id, version, started_at) VALUES (p_patient_id, p_protocol_id, p_version, now()) ON CONFLICT (patient_id, protocol_id) DO UPDATE SET version = EXCLUDED.version, started_at = now() per Pitfall 3 (idempotency on re-assign)
- (no protocol_review_log entry — this is assignment, not state transition)

**6. `get_protocol_by_slug(p_base_slug text) returns table (...)`** per UI-SPEC Surface 8:
- NO staff guard — `authenticated` users can call (RLS on `protocols` already filters to published rows for non-staff)
- SELECT highest version where base_slug = p_base_slug and review_state = 'published'
- Return columns: id, version, name, compound, audience, slug, base_slug, published_at
- Plus aggregated `steps jsonb` (json_agg of protocol_steps for this protocol_id+version ordered by week) and `evidence jsonb` (json_agg of protocol_evidence with citation_text, rag_source_id, verbatim_quote, step_id)
- Returns empty result set if no published row exists (UI renders 404 state)

**7. `list_admin_ai_assist_usage_today() returns int`**:
- staff guard
- RETURN (SELECT count(*)::int FROM admin_ai_assist_log WHERE actor_id = auth.uid() AND created_at >= date_trunc('day', now() at time zone 'UTC')) per Pitfall 4 (UTC-day boundary).

For every function, append:
```
revoke all on function public.<name>(...) from public;
grant execute on function public.<name>(...) to authenticated;
```

Wrap whole file in BEGIN/COMMIT for atomic install. All RPCs use `create or replace function` per analog convention (idempotent re-runs).

Constraints:
  - DO NOT push to remote — Plan 08 close-out runs `supabase db push --linked` per `feedback_phase_close_out_db_push_verification`.
  - Mirror analog formatting (lowercase, 2-space indent, `as $$ ... end $$`).
  - Every RPC's audit INSERT happens BEFORE the function returns (audit-row-is-truth invariant).
  - Per RESEARCH.md Pitfall 5: NO model ID strings in this file; that lives in Plan 03 Edge Fn.
  - Per RESEARCH.md Security: NO `auth.uid()` in WHERE clauses without `FOR UPDATE` — every state-transition function reads with `FOR UPDATE` first.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20260526000002_protocol_secdef_rpcs.sql && grep -c "create or replace function public\\." supabase/migrations/20260526000002_protocol_secdef_rpcs.sql | grep -E "^7$" && grep -c "security definer" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql | grep -E "^7$" && grep -q "SELF_REVIEW_REJECTED" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql && grep -cE "^[[:space:]]*for[[:space:]]+update" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql | grep -vE "^0$" && grep -cE "grant execute on function" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql | grep -E "^7$" && grep -c "is_staff()" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql | grep -vE "^0$" && grep -q "on conflict (patient_id, protocol_id)" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql && grep -q "date_trunc('day'" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql</automated>
  </verify>
  <done>Exactly 7 SECDEF functions defined; every state-mutating function uses FOR UPDATE; publish_protocol contains literal SELF_REVIEW_REJECTED message; assign_protocol_to_patient has ON CONFLICT idempotency; UTC-day boundary used in usage counter; every function has REVOKE + GRANT.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin browser → SECDEF RPC | Browser-side state transition attempts go through RPC; RPC verifies is_staff() + auth.uid() identity |
| Author → publish_protocol RPC | 2-person rule enforced at DB layer — author cannot publish own protocol |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-02-01 | Elevation of privilege | Author publishes own protocol (PHARMA-02 safety bypass) | mitigate | Layer 1: publish_protocol RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by; UI Layer 2 (Plan 05) removes button from DOM; CI eval test Layer 3 |
| T-61-02-02 | Tampering | Concurrent double-publish race | mitigate | FOR UPDATE row lock on every state-read precedes state-mutation |
| T-61-02-03 | Information disclosure | Caller learns `created_by` user_id from error message | accept | Error message includes auth.uid() and created_by uuid — both are caller's own session info or already-visible-to-staff data; no PII leakage |
| T-61-02-04 | Denial of service | Spam patient_protocol_assignment inserts | mitigate | Unique constraint (patient_id, protocol_id) + ON CONFLICT DO UPDATE makes re-assign idempotent (no row spam) |
</threat_model>

<verification>
- `grep -c "create or replace function public\\." supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` returns 7
- `grep "SELF_REVIEW_REJECTED" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` matches exactly inside `publish_protocol`
- All RPCs have `revoke all ... from public;` + `grant execute ... to authenticated;` lines
- `get_protocol_by_slug` does NOT have staff guard (only authenticated check is via RLS)
- `assign_protocol_to_patient` uses `ON CONFLICT (patient_id, protocol_id) DO UPDATE`
- UTC-day boundary uses `date_trunc('day', now() at time zone 'UTC')` per Pitfall 4
</verification>

<success_criteria>
- [ ] 7 SECDEF functions in one migration file
- [ ] Each function uses FOR UPDATE before state read
- [ ] publish_protocol contains literal 'SELF_REVIEW_REJECTED' substring
- [ ] All RPCs have REVOKE/GRANT
- [ ] Migration file syntactically structured per `approve_rag_chunk` analog
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-02-SUMMARY.md` documenting RPC signatures, the 2-person rule mechanism, and any deviations from the `approve_rag_chunk` template.
</output>
