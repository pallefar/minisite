---
phase: 37-m6-helpdesk-core
plan: 01
subsystem: helpdesk
tags: [helpdesk, schema, rls, hipaa, postgres, secdef, vault]
requires:
  - public.organizations
  - public.org_members
  - public.profiles (primary_org_id column)
  - auth.users
  - vault.create_secret / vault.decrypted_secrets
  - extensions.pgcrypto (hmac, gen_random_bytes)
provides:
  tables:
    - public.tickets
    - public.ticket_messages
    - public.ticket_attachments
    - public.ticket_tags
    - public.ticket_inbound_events
    - public.ticket_ai_suggestions
    - public.kb_articles
    - public.kb_article_versions
    - public.csat_responses
    - public.agent_macros
    - public.helpdesk_routing_rules
    - public.sla_targets
  rpcs:
    - public.generate_helpdesk_reply_token(uuid, uuid) → text
    - public.verify_helpdesk_reply_token(text, uuid, uuid) → boolean
    - public.close_ticket(uuid, text) → void
    - public.reopen_ticket(uuid, text) → void
    - public.apply_ai_suggestion(uuid) → void
    - public.search_kb_articles(text, text, uuid, int) → setof rows  # STUB; Plan 02 replaces
    - public.create_ticket_with_first_message(text, text, text default 'p3') → uuid
  vault_secrets:
    - helpdesk_hmac_secret  # 32-byte random hex
  storage_buckets:
    - ticket-attachments     # private, 10 MB cap, 7-MIME allowlist
affects:
  - All later Phase 37 plans (02..09): every Edge Fn / widget / admin module reads these tables.
  - Plan 06 TicketForm: imports `create_ticket_with_first_message` signature exactly.
  - Plan 02: replaces search_kb_articles stub with FTS body once GENERATED tsvector columns exist.
  - Plan 05: cron logic must match the seeded p1/p2/p3 SLA tier defaults.
  - Plan 03 helpdesk-inbound Edge Fn: writes to ticket_inbound_events; calls verify_helpdesk_reply_token.
tech-stack:
  added: []  # No new deps — schema-only plan
  patterns:
    - "Two-axis RLS predicate (user_id = auth.uid() + org_members membership)"
    - "Status enum widened upfront in CHECK constraint (no later widening per [[feedback_planner_missed_status_enum_widening]])"
    - "Append-only tables via service_role REVOKE UPDATE/DELETE (ticket_messages, kb_article_versions, csat_responses)"
    - "SECDEF RPCs with search_path = public, extensions + revoke from public + grant to authenticated/service_role"
    - "Vault-backed HMAC secret read via vault.decrypted_secrets (never inline in app code)"
    - "PHI flag derived server-side from org_members.role (NEVER client-supplied)"
key-files:
  created:
    - supabase/migrations/20270707000001_helpdesk_schema.sql
    - supabase/migrations/20270707000002_helpdesk_rls_policies.sql
    - supabase/migrations/20270707000003_helpdesk_secdef_rpcs.sql
    - supabase/migrations/20270707000004_helpdesk_seed_macros.sql
    - supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql
  modified: []
decisions:
  - "PHI flag derived from caller's role in primary_org (owner/clinician/staff → true) — never trusts client input"
  - "tickets.status CHECK enumerates all 6 values now (no future widening migrations allowed)"
  - "search_kb_articles ships as stub in slot 03; Plan 02 owns the FTS body via create-or-replace"
  - "Storage path convention for ticket-attachments: `<ticket_id>/<filename>` — RLS parses ticket_id via storage.foldername(name)[1]"
  - "Constant-time HMAC compare done in plpgsql bytewise XOR (best-effort; threat model only exposes via Edge Fn, not direct PostgREST)"
  - "Starter macros seeded into first org only (admin UI in Plan 08 owns per-org ongoing creation)"
metrics:
  duration: ~22 min
  tasks_completed: 5
  files_modified: 5
  commits: 5
  completed_date: 2026-05-21
---

# Phase 37 Plan 01: Helpdesk Schema Foundation Summary

**One-liner:** 5 SQL migrations laying the helpdesk foundation — 12 tables with two-axis RLS (41 policies), 7 SECDEF RPCs with vault-backed HMAC reply-token generation/verification, seeded SLA tiers + starter macros + ticket-attachments storage bucket; PHI flag derived server-side from org role.

## Migration filenames (14-digit prefixes — successors must advance from `20270707000009`)

| Slot | File | Owner |
|------|------|-------|
| `20270707000001` | `_helpdesk_schema.sql` | This plan |
| `20270707000002` | `_helpdesk_rls_policies.sql` | This plan |
| `20270707000003` | `_helpdesk_secdef_rpcs.sql` | This plan |
| `20270707000004` | `_helpdesk_seed_macros.sql` | This plan |
| `20270707000005..08` | reserved | Plan 37-02 (sibling, parallel Wave 1) |
| `20270707000009` | `_helpdesk_create_ticket_rpc.sql` | This plan |

**Plan 02 should start at `20270707000010`+** (after sibling 02's `...08` and this plan's `...09`).

## RPC signatures (for Plans 03/04/05/06 to import exactly)

```sql
-- Plan 06 TicketForm call site:
rpc('create_ticket_with_first_message', { p_subject, p_body, p_priority })
-- returns: uuid (the new ticket_id)
-- raises:  unauthenticated (42501) / invalid_subject (22023) / invalid_body (22023)
--          / invalid_priority (22023) / no_primary_org (42704)

-- Plan 03 helpdesk-inbound Edge Fn:
rpc('verify_helpdesk_reply_token', { p_token, p_ticket_id, p_user_id })
-- returns: boolean (constant-time compare; false if vault missing)

-- Plan 04 helpdesk-outbound Edge Fn:
rpc('generate_helpdesk_reply_token', { p_ticket_id, p_user_id })
-- returns: text (base64url HMAC-SHA256)

-- Plan 07 admin UI:
rpc('close_ticket',  { p_ticket_id, p_resolution_note }) → void
rpc('reopen_ticket', { p_ticket_id, p_reason })          → void
rpc('apply_ai_suggestion', { p_suggestion_id })          → void

-- Plan 02 KB typeahead (STUB — replaced by Plan 02):
rpc('search_kb_articles', { p_query, p_locale, p_org_id, p_limit }) → setof rows
```

## SLA tier defaults seeded (Plan 05 cron must match)

| Tier | first_response_minutes | resolution_minutes |
|------|------------------------|--------------------|
| `p1` | 240   (4h) | 1440  (24h) |
| `p2` | 1440  (24h) | 4320 (72h) |
| `p3` | 4320  (72h) | 10080 (7d) |

Seeded for every existing org via `INSERT ... SELECT ... FROM organizations ON CONFLICT (org_id, tier) DO NOTHING`.

## Storage bucket

- **Name:** `ticket-attachments`
- **Public:** false (PHI risk)
- **file_size_limit:** 10485760 (10 MB; matches `ticket_attachments.byte_size` CHECK)
- **MIME allowlist:** `image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/csv` (matches `ticket_attachments.mime_type` CHECK)
- **Path convention:** `<ticket_id>/<filename>` — RLS parses `storage.foldername(name)[1]` to enforce parent-ticket visibility.
- **RLS policies on storage.objects:**
  - `objects_select_ticket_attachments` — owner OR org-member of parent ticket
  - `objects_insert_ticket_attachments` — owner OR org-member of parent ticket
  - `objects_delete_ticket_attachments` — agent-only (org-member of parent ticket)

## Status / priority / source / scan_status enums (frozen)

| Column | Values |
|--------|--------|
| `tickets.status` | `open, pending, resolved, closed, waiting_on_customer, spam` |
| `tickets.priority` | `p1, p2, p3` |
| `tickets.source` | `widget, email, admin` |
| `ticket_messages.author_kind` | `user, agent, system, ai_draft` |
| `ticket_messages.via` | `widget, email, admin, api` |
| `ticket_attachments.mime_type` | (7-MIME allowlist; see Storage bucket above) |
| `ticket_attachments.scan_status` | `deferred, clean, infected, error` |
| `ticket_inbound_events.outcome` | `ticket_created, reply_appended, unknown_sender_bounced, hmac_failed_bounced, duplicate, rejected_loop` |
| `ticket_tags.applied_by` | `ai, agent, rule` |
| `csat_responses.rating` | `1, 2, 3, 4, 5` |
| `sla_targets.tier` | `p1, p2, p3` |

All values enumerated UPFRONT in CHECK constraints. Adding a new value requires a CHECK-constraint widening migration (T-DDL of Phase 37 follow-on plans MUST coordinate).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 — Schema (12 tables) | `58257e3` | `feat(37-01): helpdesk schema — 12 tables with RLS + phi flag + status enum widened upfront` |
| 2 — RLS (41 policies) | `b719fc7` | `feat(37-01): helpdesk RLS — 41 two-axis policies (user_id + org_id) across 12 tables` |
| 3 — SECDEF RPCs (6) | `950feec` | `feat(37-01): helpdesk SECDEF RPCs — 6 functions with search_path pinning + revoke/grant` |
| 4 — Seed | `1f3680d` | `feat(37-01): helpdesk seed — vault HMAC secret + ticket-attachments bucket + SLA tiers + starter macros` |
| 5 — create_ticket RPC | `16ef309` | `feat(37-01): create_ticket_with_first_message RPC — Plan 06 TicketForm call site` |

## Deviations from Plan

**None.** All 5 tasks executed exactly per spec.

Minor formatting fix-ups that did NOT change semantics:
- Task 1: Removed column-alignment whitespace on the `tickets.phi` line so the plan's literal `grep -c 'phi boolean not null default false'` gate passed (verify literal-substring requirement).
- Task 2: Reworded the file-header anti-pattern comment so the negative-assertion grep gates didn't false-positive on the comment text (per [[reference_grep_gate_comment_strip]] — strip-comments-before-grep is not done by the plan's verify, so the comment had to avoid those literal strings).
- Task 5: Removed an extra space in `grant  execute` → `grant execute` so the verify gate's literal `grep -q "grant execute on function public.create_ticket_with_first_message"` passed.

None of the above touched generated SQL semantics — pure whitespace / comment-wording.

## Threat Flags

None. All STRIDE entries from the plan's `<threat_model>` are mitigated:
- T-37-01-01 (cross-user message read) → tm_select_owner + tm_select_agent
- T-37-01-02 (HMAC secret leakage) → vault-only; SECDEF RPC sole reader
- T-37-01-03 (user self-closing ticket) → tickets_update_owner CHECK clause excludes closed/spam
- T-37-01-04 (ticket_messages mutation) → REVOKE UPDATE/DELETE on service_role; no policy grants either to authenticated
- T-37-01-05 (KB draft visibility) → kb_select_published_global requires `published_at is not null`; drafts gated by admin-role policy
- T-37-01-06 (PHI repudiation) → out-of-scope here; column defined for Plan 07's audit trigger consumption
- T-37-01-07 (Non-admin invoking close_ticket) → SECDEF RPC asserts org_members membership; revokes from public

## Known Stubs

- `public.search_kb_articles` is a STUB returning empty set. Plan 02 replaces via `create or replace function` once the GENERATED tsvector columns (`search_vector_en` / `search_vector_es`) are added to `kb_articles`.

## Self-Check: PASSED

- All 5 migration files exist at correct slots and pass `<14-digits>_name.sql` regex.
- All 5 commits exist in `git log` on branch `worktree-agent-a0c933ceaa721ae8b`.
- 12 `create table public.` statements; 12 `enable row level security` calls.
- 41 `create policy` statements; 0 `using (true)`; 0 `current_setting`; 0 `for all\b`.
- 6 `security definer` functions; 6 `set search_path = public, extensions`; 6 `revoke execute on function`; 0 `language sql`.
- Vault secret `helpdesk_hmac_secret` insertion guarded by NOT-EXISTS.
- Storage bucket `ticket-attachments` insertion guarded by `on conflict (id) do nothing`.
- Task 5 RPC signature matches Plan 06's expected call site: `(p_subject text, p_body text, p_priority text default 'p3') returns uuid`.
- No sibling slots (`20270707000005..08`) touched (owned by parallel 37-02 plan).
