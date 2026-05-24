---
phase: 48-m4-moderation
plan: 03
subsystem: moderation
tags: [moderation, rls, secdef, pg_cron, pg_net, user_moderation_state]
requires:
  - public.is_staff() helper (already exists per memory reference_supabase_is_staff_helper)
  - vault.decrypted_secrets row name='service_role_key' (verify at Plan 12 push)
  - public.log_moderation_action RPC (shipped Plan 48-04)
  - ban-enforcement Edge Fn (shipped Plan 48-09)
provides:
  - public.user_moderation_state table (PK user_id, status enum, expires_at conditional)
  - public.apply_user_moderation(uuid, text, text, timestamptz) SECDEF RPC
  - pg_cron job 'phase48-temp-suspended-restore-hourly' at '0 * * * *'
affects:
  - mute RLS predicate (Plan 48-06) — reads user_moderation_state_muted_idx
  - ban write-deny RLS (Plan 48-06) — reads user_moderation_state_banned_idx
  - AccountSuspended consumer blocker (Plan 48-11) — reads own row via ums_select_own
  - moderation audit log (Plan 48-04) — log_moderation_action invoked on every write
tech-stack:
  added:
    - pg_net extension (apply RPC + cron migration both ensure)
  patterns:
    - SECDEF + is_staff() entry gate + 22023 validation branches
    - vault.decrypted_secrets + hardcoded Fn URL (T-48-13 mitigation)
    - pg_cron dollar-quote nesting with unique $cron$/$restore$ tags
    - idempotent unschedule wrapper (exception when others then null)
key-files:
  created:
    - supabase/migrations/20270901000005_p48_user_moderation_state.sql
    - supabase/migrations/20270901000006_p48_apply_user_moderation_rpc.sql
    - supabase/migrations/20270901000007_p48_temp_suspended_restore_cron.sql
  modified: []
decisions:
  - "D-13: user_moderation_state table is single source of truth; writes only via SECDEF RPC; reads via 2 RLS SELECT policies (own + staff)"
  - "D-15 CORRECTED: ban-enforcement triggered async via pg_net (not inline) so apply RPC is fast; Fn performs direct DELETE on auth.sessions/auth.refresh_tokens (not supabase.auth.admin.signOut which takes JWT not user_id)"
  - "Cron actor disambiguation: action_type='temp_restore' (vs staff 'moderation_cleared') because auth.uid()=null in cron context"
metrics:
  completed: 2026-05-24
  duration_minutes: ~7
  tasks_completed: 3
  files_created: 3
---

# Phase 48 Plan 03: Apply User Moderation Schema + RPC + Cron — Summary

Central mute/ban/temp_suspend state row with SECDEF apply RPC and hourly auto-restore cron — the moderation system's single source of truth that downstream plans (48-06 RLS, 48-09 ban-enforcement, 48-11 consumer blocker) all read.

## What Shipped

**Migration 1 — `20270901000005_p48_user_moderation_state.sql`** (Task 1, commit `b186e1b3`)
- Table with PK `user_id` (FK `auth.users` on delete cascade), `status` CHECK in ('active','muted','banned','temp_suspended'), `applied_by`, `reason`, `expires_at`, timestamps.
- `user_moderation_expires_chk` constraint: `expires_at NOT NULL` iff `status='temp_suspended'`; NULL otherwise.
- Two partial indexes (`_muted_idx`, `_banned_idx`) with IMMUTABLE literal predicates supporting Plan 48-06's RLS predicates.
- RLS enabled. Two SELECT policies (`ums_select_own`, `ums_select_staff`) — OR-semantics union. No INSERT/UPDATE/DELETE policies — writes only via SECDEF RPC.

**Migration 2 — `20270901000006_p48_apply_user_moderation_rpc.sql`** (Task 2, commit `5389110d`)
- SECDEF function with `set search_path = public, extensions`.
- Entry gate: `if not public.is_staff() then raise '42501'`.
- Three 22023 validation branches: invalid_status, temp_suspended_requires_expires_at, expires_at_only_for_temp_suspended.
- Captures `to_jsonb()` before/after snapshots around an UPSERT.
- Calls `public.log_moderation_action()` with `action_type` derived from `status` (`mute_applied`, `ban_applied`, `temp_suspend_applied`, `moderation_cleared`).
- On `status='banned'`: reads `vault.decrypted_secrets WHERE name='service_role_key'` and `perform net.http_post(url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ban-enforcement', …)` — URL literal in body (T-48-13 mitigation).
- `revoke all from public; grant execute to authenticated`.

**Migration 3 — `20270901000007_p48_temp_suspended_restore_cron.sql`** (Task 3, commit `856b3f02`)
- pg_cron job `phase48-temp-suspended-restore-hourly` at `'0 * * * *'`.
- Idempotent re-apply: `do $unschedule$ … cron.unschedule(…) exception when others then null $unschedule$`.
- Body uses outer `$cron$` and inner `$restore$` tags (verified unique vs Phase 38 `$digest$`/`$winback$`/`$embed$`, Phase 47 `$reminders$`, project-wide `$cleanup$`/`$partition$`).
- `UPDATE … RETURNING user_id` loop → per-row `log_moderation_action(action_type=>'temp_restore', …)`. `auth.uid()=null` in cron context; `temp_restore` action_type disambiguates from staff-initiated `moderation_cleared`.

## Acceptance Criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | 3 migration files exist at canonical paths | PASS |
| 2 | F1: create table count == 1 | PASS |
| 3 | F1: status CHECK enum present | PASS |
| 4 | F1: muted_idx, banned_idx, both SELECT policies present | PASS (4/4) |
| 5 | F2: RPC + temp_suspended_requires_expires_at + net.http_post all == 1 | PASS |
| 6 | F2: auth.admin.signOut count == 0 (rejected API not mentioned) | PASS |
| 7 | F3: jobname present | PASS |
| 8 | F3: $restore$ tag count ≥ 2 (open + close) | PASS (2) |
| 9 | F3: tag collision check ($digest$/$reminders$/$winback$/$embed$) == 0 | PASS |
| 10 | Filenames strict 14-digit; no collision with 48-01 (`…000001`) | PASS |
| 11 | F1: no `staff_users` references | PASS |

## Deviations from Plan

None — plan executed exactly as written. All migration content followed the verbatim `<action>` blocks; all grep gates passed on first try.

## Live Verification (deferred to Plan 48-12 close-out)

Per orchestrator instruction, no `supabase db push` executed in this plan. Plan 48-12 operator will:
1. `supabase db push --linked` (applies 3 migrations).
2. `supabase db query --linked "select jobname from cron.job where jobname='phase48-temp-suspended-restore-hourly';"` → expect 1 row.
3. `supabase db query --linked "\d public.user_moderation_state"` → expect PK + 4-value CHECK + expires_chk + RLS enabled + 2 SELECT policies + 2 partial indexes.
4. Cross-tenant impersonation proof test (per project rule): SELECT as non-staff user → expect own row only.
5. **Pre-push gate (per memory `reference_supabase_service_role_key_format_divergence`):** confirm `vault.decrypted_secrets` row `name='service_role_key'` holds the `sb_secret_*` format token (NOT the legacy HS256 JWT) — otherwise the pg_net call from `apply_user_moderation` on `status='banned'` will get rejected 401 by the ban-enforcement Fn.

## Threat Mitigations Shipped (from `<threat_model>`)

| Threat ID | Mitigation Shipped |
|-----------|-------------------|
| T-48-06 (E — non-staff applies ban) | `if not public.is_staff() then raise '42501'` at RPC entry |
| T-48-13 (T — pg_net targets attacker URL) | URL literal in RPC body (`https://ytnsipxxmzgaebkqmokp.supabase.co/…`); not row-derived |
| T-48-14 (D — cron error → user stuck) | `exception when others then null` on unschedule; UPDATE is atomic; hourly retry |
| T-48-15 (E — wrong service_role_key format) | Documented as Plan 48-12 pre-push gate (see Live Verification §5) |

## Commits

- `b186e1b3` — feat(48-03): user_moderation_state table + RLS
- `5389110d` — feat(48-03): apply_user_moderation SECDEF RPC
- `856b3f02` — feat(48-03): pg_cron temp_suspended restore (hourly)

## Self-Check: PASSED

- All 3 migration files exist (verified via `ls`).
- All 3 commits present on `worktree-agent-a2b3839fa32da5395` branch.
- All 11 acceptance criteria grep gates pass.
- No `staff_users` parallel-table reference; no `auth.admin.signOut` rejected-API reference (per memory `feedback_negation_grep_defeated_by_comment_string`).
- Filenames strict 14-digit; sibling 48-01 lives at `…000001`, this plan at `…000005/6/7` — no collision.
