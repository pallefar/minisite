---
phase: 37-m6-helpdesk-core
plan: 05
subsystem: helpdesk
tags: [helpdesk, edge-fn, csat, sla, pg_cron, email-router, hmac, phi-routing]
requires:
  - 37-01-PLAN.md (tickets / sla_targets / csat_responses schema)
  - 37-02-PLAN.md (email-router + csat_followup + sla_breach_alert templates + pg_cron schedule)
  - 37-04-PLAN.md (Phase38Event union baseline)
provides:
  - helpdesk-csat-send Edge Fn (HELP-05) — phi-aware CSAT email dispatch
  - helpdesk-sla-breach-cron Edge Fn (HELP-06) — UPSERT-deduped breach alerts
  - try_record_sla_breach(uuid, text, int) SECDEF RPC — UPSERT-WHERE-clamped dedupe primitive
  - trg_helpdesk_on_ticket_close AFTER UPDATE trigger — open→closed → pg_net.http_post
  - tickets.csat_sent_at idempotency anchor column
  - sla_targets.alert_recipients on-call list column
  - Phase38Event union: + 'helpdesk.csat.submitted' + 'helpdesk.sla.breach'
affects:
  - supabase/migrations/20270707000008_helpdesk_sla_breach_state.sql (new)
  - supabase/functions/helpdesk-csat-send/{index,cors,index.test}.ts (new)
  - supabase/functions/helpdesk-sla-breach-cron/{index,cors,index.test}.ts (new)
  - supabase/functions/_shared/posthog-server.ts (+2 union members)
tech-stack:
  added: []
  patterns:
    - HMAC-SHA256 base64url signed-URL with dedicated per-surface secret (NOT shared with reply-token signer)
    - UPSERT INSERT…ON CONFLICT…DO UPDATE WHERE … RETURNING (clamped to dedupe window) — per memory state_counter_table_needs_upsert_on_event
    - SECDEF RPC bridging supabase-js .upsert()'s missing WHERE-on-conflict support
    - AFTER-UPDATE pg trigger → pg_net.http_post via vault.decrypted_secrets (no GUC) per reference_supabase_pg_cron_vault_service_role_pattern
    - Phi-aware email-router with hardcoded phi=false for internal-only alert templates
    - Deno test seam: __internal.setAdminForTest + setSendEmailForTest + setCaptureForTest (no jsr:@std/testing/mock)
key-files:
  created:
    - supabase/migrations/20270707000008_helpdesk_sla_breach_state.sql (214 lines)
    - supabase/functions/helpdesk-csat-send/index.ts (~280 lines)
    - supabase/functions/helpdesk-csat-send/cors.ts (17 lines)
    - supabase/functions/helpdesk-csat-send/index.test.ts (~340 lines, 11 tests)
    - supabase/functions/helpdesk-sla-breach-cron/index.ts (~290 lines)
    - supabase/functions/helpdesk-sla-breach-cron/cors.ts (16 lines)
    - supabase/functions/helpdesk-sla-breach-cron/index.test.ts (~440 lines, 11 tests)
  modified:
    - supabase/functions/_shared/posthog-server.ts (+8 lines: 2 union members + section comment)
decisions:
  - CSAT signing secret is SEPARATE from reply-token HMAC secret (`HELPDESK_CSAT_SIGNING_SECRET` vs Plan 02's `HELPDESK_HMAC_SECRET`) — different threat models and surfaces; must not share.
  - CSAT URL expiry is 14 days (`CSAT_URL_EXPIRY_SECONDS = 14*24*60*60`) — covers weekend-after-close opens while bounding link liveness.
  - `sla_breach_alert` template hardcodes `phi: false` — internal alert, no patient-derived content. Plan-checker grep gate enforces.
  - try_record_sla_breach RPC accepts `p_dedupe_hours` (default 24h) parameter — admin observability can vary the dedupe in the future without re-deploying the cron Edge Fn.
  - Edge Fn returns 500 (not 200) on phi=true SES failure so the trigger sees the failure; `csat_sent_at` stays NULL so future retries are possible.
  - Per-recipient try/catch on `sendEmail` — one failed on-call address must not silently block the rest of the rotation.
  - Open-ticket scan covers status in ('open','pending','waiting_on_customer') — does NOT include 'resolved' (resolved tickets are out of SLA) or 'spam' (no SLA).
  - PostHog `helpdesk.sla.breach` distinctId = assigned_to OR synthetic `ticket:<uuid>` when unassigned — avoids inventing PHI identifiers while satisfying captureServer's userId-required contract.
metrics:
  duration_seconds: 604
  duration_human: 10m 4s
  completed_at: 2026-05-21
  tasks_total: 4
  tasks_completed: 4
  commits: 6
  tests_passing: 22
  files_created: 7
  files_modified: 1
---

# Phase 37 Plan 37-05: Helpdesk CSAT + SLA Breach Summary

CSAT post-close dispatch and SLA breach alerting wired end-to-end: AFTER-UPDATE trigger → `helpdesk-csat-send` (signed one-tap URL, `csat_sent_at` idempotency); pg_cron 5-min → `helpdesk-sla-breach-cron` (UPSERT-deduped alerts to assigned + admin-editable on-call + env fallback).

## What shipped

### Migration `20270707000008_helpdesk_sla_breach_state.sql`

- **`ticket_sla_breach_state`** table — PK `(ticket_id, breach_type)`; columns `last_alerted_at`, `alert_count`. RLS: agents in the same org may SELECT; no INSERT/UPDATE/DELETE policy (service-role-only writes via RPC).
- **`tickets.csat_sent_at timestamptz`** — added via `add column if not exists`. Set by helpdesk-csat-send on first successful dispatch; NULL = no CSAT sent yet.
- **`sla_targets.alert_recipients text[] not null default '{}'`** — admin-editable on-call list, per `(org_id, tier)`.
- **`try_record_sla_breach(p_ticket_id uuid, p_breach_type text, p_dedupe_hours int default 24) returns boolean`** SECDEF RPC — `INSERT … ON CONFLICT … DO UPDATE WHERE last_alerted_at < now() - make_interval(hours => p_dedupe_hours) RETURNING true`. Search path pinned `public, extensions`. Returns `true` when caller should send the alert; `false` when within dedupe window.
- **`helpdesk_on_ticket_close()`** SECDEF trigger function — guards `(old.status is distinct from 'closed') and new.status = 'closed'`; reads `vault.decrypted_secrets WHERE name='service_role_key'`; `perform net.http_post(...)` to `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-csat-send` with `{ticket_id: new.id}` body. Bare `$$` replaced with named tag `$fn$` per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.
- **`trg_helpdesk_on_ticket_close`** AFTER UPDATE OF status — drop-then-create for idempotent migration replay.

### `supabase/functions/helpdesk-csat-send/`

- **Auth gate** — `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` constant-string compare → 401.
- **Pipeline** — ticket lookup → `csat_sent_at` short-circuit → `csat_responses` short-circuit → profile email lookup → signed URL build → `sendEmail({template:'csat_followup', phi: ticket.phi})` → stamp `csat_sent_at`.
- **CSAT URL signing** — base64url HMAC-SHA256 over `${ticket_id}:csat:${expires_at}` with `HELPDESK_CSAT_SIGNING_SECRET`. Landing page (Plan 37-06) will verify with the same secret.
- **PHI propagation** — `phi: ticket.phi` passed verbatim to email-router; router's single switch routes to SES (PHI) or Resend (non-PHI).
- **Error propagation** — on `sendEmail` throw, return 500 (NOT 200); `csat_sent_at` stays NULL so the trigger can refire (e.g. SES BAA pending → wait 5min → retry on next admin operation).
- **Test seam** — `__internal.setAdminForTest` + `setSendEmailForTest`; 11 tests pass.

### `supabase/functions/helpdesk-sla-breach-cron/`

- **Auth gate** — same Bearer pattern.
- **Scan** — `tickets WHERE status IN ('open','pending','waiting_on_customer')`. For each, look up `sla_targets WHERE org_id=? AND tier=priority`.
- **Breach detection** — `computeBreaches(t, sla)`:
  - `first_response` if `now - created_at > first_response_minutes` AND `last_agent_message_at IS NULL`.
  - `resolution` if `now - created_at > resolution_minutes` (independent of agent-reply state).
- **Dedupe** — `admin.rpc('try_record_sla_breach', {p_ticket_id, p_breach_type})`. Returns `true` → send + count; `false` → skip silently.
- **Recipients** — `Set<string>` of `assigned_to.email` ∪ `sla_targets.alert_recipients[]` ∪ env `SLA_BREACH_DEFAULT_ONCALL_EMAILS`. Deduped at insertion.
- **Per-recipient isolation** — each `sendEmail` is inside its own `try/catch`; one failure logs `recipient-send-failed` and continues.
- **PHI invariant** — `phi: false` HARDCODED on every `sla_breach_alert` send, regardless of `ticket.phi`. Plan-checker grep gate `! grep -q "phi: t\.phi"` enforces (forbidden anti-pattern stripped from docstrings too — per memory `reference_grep_gate_comment_strip`).
- **PostHog** — one `helpdesk.sla.breach` event per breach; distinctId = `assigned_to` OR `ticket:<uuid>` synthetic. `shutdownPostHog` in finally block (Phase 24 batch-flush invariant).
- **Test seam** — `__internal.setAdminForTest` + `setSendEmailForTest` + `setCaptureForTest`; 11 tests pass.

### `supabase/functions/_shared/posthog-server.ts`

- Phase38Event union extended with `'helpdesk.csat.submitted'` and `'helpdesk.sla.breach'`. Same-commit-as-firing-Edge-Fn rule per memory `feedback_planner_missed_status_enum_widening` upheld.

## Function Secrets contract for Plan 09

The deploy plan (Plan 37-09) must set these via `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp`:

| Secret                              | Used by                       | Notes                                                                                                  |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `HELPDESK_CSAT_SIGNING_SECRET`      | `helpdesk-csat-send`          | 32-byte base64 random recommended. **Must not equal `HELPDESK_HMAC_SECRET`** — different threat model. |
| `SLA_BREACH_DEFAULT_ONCALL_EMAILS`  | `helpdesk-sla-breach-cron`    | Comma-separated email list (e.g. `oncall@leanshot.app,ops@leanshot.app`). Fallback only.               |
| `SUPABASE_URL`                      | both                          | Already set project-wide.                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`         | both                          | Already set project-wide.                                                                              |

Plan 09 also needs the vault entry `service_role_key` present (already shipped in Plan 02 cron migration) for `trg_helpdesk_on_ticket_close` to dispatch.

## CSAT URL signing contract (for Plan 37-06 landing page)

```
URL  = https://app.leanshot.app/help/csat?t=<ticket_id>&e=<expires_unix_seconds>&s=<base64url_sig>
sig  = base64url( HMAC-SHA256( HELPDESK_CSAT_SIGNING_SECRET, `${t}:csat:${e}` ) )
exp  = floor(Date.now() / 1000) + 14*24*60*60   // 14 days
```

Landing-page validation must:

1. Reject if `e < now_unix` (expired).
2. Recompute the HMAC and constant-time compare against `s`.
3. Use the **same** `HELPDESK_CSAT_SIGNING_SECRET`. Do NOT switch secret-vars by surface.

## `try_record_sla_breach` RPC signature

```sql
public.try_record_sla_breach(
  p_ticket_id    uuid,
  p_breach_type  text,                    -- 'first_response' | 'resolution' (CHECK-enforced)
  p_dedupe_hours int default 24
) returns boolean
```

Returns `true` when the caller should proceed to send the alert email and emit the PostHog event; `false` when within the dedupe window (no row mutation occurred).

Grants: `service_role` only. Public revoked. Admin observability surfaces (Plan 08) should query the underlying `ticket_sla_breach_state` table directly via the agent-SELECT RLS policy.

## Close-trigger contract (load-bearing for Plan 09 + 11)

```
AFTER UPDATE OF status ON public.tickets
WHEN  (old.status IS DISTINCT FROM 'closed' AND new.status = 'closed')
EXECUTES public.helpdesk_on_ticket_close()
  → vault.decrypted_secrets WHERE name='service_role_key'  (NOT current_setting GUC)
  → net.http_post('https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-csat-send',
                   { ticket_id }, Bearer ${service_role_key})
```

If the `service_role_key` vault entry is missing (e.g. fresh staging environment), the trigger logs `raise notice` and returns `new` cleanly — never blocks the ticket UPDATE. This matches the Plan 02 cron pattern (`reference_supabase_pg_cron_vault_service_role_pattern`).

## Deviations from Plan

None — plan executed as written. One inline anti-pattern reference in the SLA-breach-cron docstring was rephrased to avoid tripping the plan-checker negative-grep gate (`! grep -q "phi: t\.phi"`), per memory `reference_grep_gate_comment_strip`. Functional behavior unchanged.

One environmental adjustment: the Bash session lacked `deno` on `PATH` by default; `export PATH="$HOME/.deno/bin:$PATH"` recovered it (deno 2.7.14 already installed at `~/.deno/bin/deno`). Not a code deviation.

One operational adjustment: the initial write of `20270707000008_helpdesk_sla_breach_state.sql` resolved to `/Users/karstenhaldan/minisite/supabase/...` (main repo) because the absolute path was constructed without going through `git rev-parse --show-toplevel` from inside the worktree. Caught immediately by the pre-commit `worktree-agent-*` branch assertion (per memory `feedback_worktree_executor_pwd_drift_leaks_to_main`); recovered via `mv` to worktree path and committed cleanly. All subsequent Edit/Write operations used worktree-rooted absolute paths.

## Authentication gates

None. Both Edge Fns use service-role Bearer; the deploy step (Plan 09) is the only remaining auth gate and is out of scope here.

## Threat Flags

None beyond the registered `<threat_model>`. No new network surface, file-access pattern, or trust boundary introduced.

## Verification status

| Step                                                  | Status                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `supabase db push --linked` applies migration      | Deferred to Plan 37-09 (deploy plan); migration file syntactically valid Postgres + matches the slot collision pre-check.                |
| 2. Migration objects exist on remote                   | Deferred to Plan 37-09; will verify via `supabase db query --linked` (`ticket_sla_breach_state`, `tickets.csat_sent_at`, `sla_targets.alert_recipients`, `try_record_sla_breach`, `trg_helpdesk_on_ticket_close`). |
| 3. `deno test` for both Edge Fns                       | **PASS — 22/22 tests** across helpdesk-csat-send (11) + helpdesk-sla-breach-cron (11).                                                  |
| 4. `supabase functions deploy helpdesk-csat-send`      | Deferred to Plan 37-09.                                                                                                                  |
| 5. `supabase functions deploy helpdesk-sla-breach-cron`| Deferred to Plan 37-09.                                                                                                                  |
| 6. Live smoke (close ticket → CSAT email)              | Deferred to Plan 37-09 / Phase close-out HUMAN-UAT.                                                                                      |

## Plan-checker gate matrix

| Gate                                                                                    | Status |
| --------------------------------------------------------------------------------------- | ------ |
| `grep -q "create table public.ticket_sla_breach_state"` migration                       | OK     |
| `grep -q "primary key (ticket_id, breach_type)"` migration                              | OK     |
| `grep -q "csat_sent_at timestamptz"` migration                                          | OK     |
| `grep -q "alert_recipients text"` migration                                             | OK     |
| `grep -q "helpdesk_on_ticket_close"` migration                                          | OK     |
| `grep -q "vault.decrypted_secrets"` migration                                           | OK     |
| `deno check helpdesk-csat-send/index.ts`                                                | OK     |
| `grep -q "csat_followup"` helpdesk-csat-send/index.ts                                   | OK     |
| `grep -q "phi: ticket.phi"` helpdesk-csat-send/index.ts                                 | OK     |
| `grep -q "csat_sent_at"` helpdesk-csat-send/index.ts                                    | OK     |
| `deno test helpdesk-csat-send/index.test.ts`                                            | OK (11/11) |
| `deno check helpdesk-sla-breach-cron/index.ts`                                          | OK     |
| `grep -q "try_record_sla_breach"` helpdesk-sla-breach-cron/index.ts                     | OK     |
| `grep -q "sla_breach_alert"` helpdesk-sla-breach-cron/index.ts                          | OK     |
| `grep -q "phi: false"` helpdesk-sla-breach-cron/index.ts                                | OK     |
| `! grep -q "phi: t\.phi"` helpdesk-sla-breach-cron/index.ts                             | OK     |
| `deno test helpdesk-sla-breach-cron/index.test.ts`                                      | OK (11/11) |
| `grep -q "try_record_sla_breach"` migration (Task 3 cross-task gate)                    | OK     |
| `grep -q "'helpdesk.csat.submitted'"` posthog-server.ts                                 | OK     |
| `grep -q "'helpdesk.sla.breach'"` posthog-server.ts                                     | OK     |

## TDD Gate Compliance

Plan declares 2 tasks with `tdd="true"` (Tasks 2 + 3). Each followed RED → GREEN sequencing:

| Task | RED commit (`test(37-05): …`) | GREEN commit (`feat(37-05): GREEN …`)        |
| ---- | ----------------------------- | -------------------------------------------- |
| 2    | `b8d46fe`                     | `fc0c906`                                    |
| 3    | `7c591a0`                     | `671a5c0`                                    |

Both pairs visible in `git log --oneline` on the worktree branch in the expected order.

## Commit timeline

| #   | Hash       | Type       | Summary                                                                  |
| --- | ---------- | ---------- | ------------------------------------------------------------------------ |
| 1   | `1e0be5c`  | `feat`     | Migration: ticket_sla_breach_state + csat_sent_at + alert_recipients + close trigger |
| 2   | `b8d46fe`  | `test`     | RED — failing tests for helpdesk-csat-send                                |
| 3   | `fc0c906`  | `feat`     | GREEN — helpdesk-csat-send Edge Fn (phi-aware, signed CSAT URL)           |
| 4   | `7c591a0`  | `test`     | RED — failing tests for helpdesk-sla-breach-cron                          |
| 5   | `671a5c0`  | `feat`     | GREEN — helpdesk-sla-breach-cron Edge Fn (UPSERT-deduped alerts)          |
| 6   | `bc6c05f`  | `feat`     | Widen Phase38Event union — helpdesk.csat.submitted + helpdesk.sla.breach  |

## Self-Check

- `supabase/migrations/20270707000008_helpdesk_sla_breach_state.sql` — FOUND
- `supabase/functions/helpdesk-csat-send/index.ts` — FOUND
- `supabase/functions/helpdesk-csat-send/cors.ts` — FOUND
- `supabase/functions/helpdesk-csat-send/index.test.ts` — FOUND
- `supabase/functions/helpdesk-sla-breach-cron/index.ts` — FOUND
- `supabase/functions/helpdesk-sla-breach-cron/cors.ts` — FOUND
- `supabase/functions/helpdesk-sla-breach-cron/index.test.ts` — FOUND
- `supabase/functions/_shared/posthog-server.ts` — FOUND (modified, +8 lines)
- Commit `1e0be5c` — FOUND
- Commit `b8d46fe` — FOUND
- Commit `fc0c906` — FOUND
- Commit `7c591a0` — FOUND
- Commit `671a5c0` — FOUND
- Commit `bc6c05f` — FOUND

## Self-Check: PASSED
