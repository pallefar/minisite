---
phase: 37-m6-helpdesk-core
type: validation
generated: 2026-05-21
source: inline-from-plan-verify-blocks
---

# Phase 37 Validation Architecture

Per-plan `<verify><automated>` aggregation. Generated inline per [[validation-md-inline-generation-when-missing]].

## Framework

| Property | Value |
|---|---|
| Edge Fn tests | Deno (`<name>.test.ts`) per [[deno-test-discovery]] |
| Frontend tests | Vitest (`leanshot/` rooted) |
| RLS proofs | Vitest live-DB suites at `tests/rls/` |
| E2E | Playwright (`leanshot/e2e/`) |
| Migration smoke | `grep -c` / `grep -q` regex assertions on file content (no live DB push at executor time) |
| Bundle budget | `scripts/assert-helpdesk-bundle-budget.sh` (≤25 kB gz) |

## Per-plan automated verify

### Wave 1 (parallel)

**37-01 schema/RLS/SECDEF/seed:**
- Task 1: 12× `create table public.`, 12× `enable row level security`, ≥1 `phi boolean`, status CHECK enumerates all 6 values
- Task 2: ≥28 `create policy`, no `using (true)`, no `current_setting`, no bare `for all`
- Task 3: ≥6 `security definer`, ≥6 `set search_path = public, extensions`, ≥6 `revoke execute`, no `language sql`
- Task 4: `helpdesk_hmac_secret` vault seed + `ticket-attachments` bucket + `on conflict` idempotency

**37-02 FTS + cron + email-router + HMAC:**
- Task 1: `search_vector_en/es tsvector generated always as` + GIN index + `search_kb_articles` SECDEF + `websearch_to_tsquery`
- Task 2: `helpdesk-sla-breach-check` cron with named `$cron$`/`$sla$` dollar-quote tags + vault.decrypted_secrets + no bare `$$`
- Task 3: email-router extended with 4 new template entries + 4 template files + Deno tests pass
- Task 4: `deno test _shared/helpdesk-hmac.test.ts` (constant-time compare proof)

### Wave 2 — 37-03 helpdesk-inbound

- Task 1: `verifyReplyToken` + `ticket_inbound_events` + `Svix` headers + `scan_status: 'deferred'` + `helpdesk.attachment.scan_deferred` audit event
- Task 2: `deno test helpdesk-inbound/index.test.ts`
- Task 3: Phase38Event union has ≥4 new inbound events; `deno check helpdesk-inbound/index.ts`

### Wave 3 — 37-04 helpdesk-ai-assist

- Task 1: BAA chain ordering verified — `resolveBaaScope → assertBaaScope → addBreadcrumb → fetch /v1/messages`; `claude-sonnet-4-6` hyphenated; NO `/chat/completions`; NO `sendEmail`
- Task 2: `deno test helpdesk-ai-assist/index.test.ts`
- Task 3: Phase38Event union has ≥5 new AI events; `deno check`

### Wave 4 — 37-05 CSAT + SLA-breach

- Task 1: `ticket_sla_breach_state` table + PK `(ticket_id, breach_type)` + `csat_sent_at` + `helpdesk_on_ticket_close` trigger + vault.decrypted_secrets
- Task 2: helpdesk-csat-send uses `csat_followup` template + `phi: ticket.phi` + `csat_sent_at` idempotency; deno test
- Task 3: helpdesk-sla-breach-cron uses `try_record_sla_breach` RPC + `sla_breach_alert` template + `phi: false` (alerts to staff, never patient PHI); deno test
- Task 4: Phase38Event has `helpdesk.csat.submitted` + `helpdesk.sla.breach`

### Wave 5 — 37-06 frontend widget

- Task 1: install `remark-gfm` + `fuse.js`; App.tsx wires `helpdesk-widget`; `isPhiRoute` exported; `HelpdeskWidget.tsx` exists; tsc clean
- Task 2: vitest `KBSearchTypeahead` + `KBArticleView` pass
- Task 3: vitest `TicketForm` + `TypingIndicator` + `MacroTypeahead` pass; `realtime.setAuth` in `useTicketChannel`; `data-sentry-mask` on PII-bearing inputs
- Task 4: `assert-helpdesk-bundle-budget.sh` ≤25 kB gz

### Wave 6 — 37-07 admin module (autonomous:false)

- Task 1: NO `placeholderFor('Phase 36+'` remaining; manifest imports `@/admin/modules/helpdesk`; `/admin/helpdesk/` route in AdminRouter; tsc clean
- Task 2: vitest `HelpdeskInboxPage` + `TicketDetailPage` pass; `logPhiAccess` wired with `useRef` dedup; tsc clean
- Task 3: helpdesk-agent-reply-send Edge Fn — `generate_helpdesk_reply_token` + `helpdesk_agent_reply` template + `reply+` HMAC + deno test; `data-sentry-mask` on AgentReplyComposer
- Task 4: **HUMAN** — agent inbox walkthrough (PHI ticket open → AI suggestion → draft fill → send → close/reopen)

### Wave 7 — 37-08 admin sub-pages

- Task 1: `publish_kb_article` + `clear_sentiment_alert` + `reorder_routing_rule` SECDEFs + `helpdesk_tag_volume_view`; ≥3 `security definer` + ≥3 `set search_path`
- Task 2: vitest `KBEditorPage` pass; uses `publish_kb_article`
- Task 3: vitest `MacroEditorPage` + `RoutingRulesPage` + `SLATargetsPage` pass
- Task 4: vitest `TrendsDashboardPage` pass; references `helpdesk_tag_volume_view`

### Wave 8 — 37-09 RLS proofs + Resend MX + e2e (autonomous:false)

- Task 1: vitest live-DB RLS test for tickets cross-tenant impersonation
- Task 2: vitest live-DB RLS test for kb_articles cross-tenant + author-self-update
- Task 3: UAT runbook written (`37-09-UAT-RUNBOOK.md` + secrets checklist)
- Task 4: **HUMAN** — Resend Inbound MX setup + Function Secrets set + e2e smoke

## Phase-level acceptance gate

1. Every `autonomous: true` plan passes its `<automated>` verify commands (Waves 1-5 + 7).
2. Human checkpoints (Wave 6 37-07, Wave 8 37-09) — same disposition discipline as 34-08 / 38-08 per [[hitl-walkthrough-deferred-when-fixtures-missing]] IF fixtures missing locally; else live UX walkthrough.
3. Cross-cutting: `npm run build` green; `tsc -p tsconfig.app.json --noEmit` clean; helpdesk bundle budget ≤25 kB gz.
4. ClamAV deferral confirmed in `deferred-items.md` P0 entry; v1.3 mitigation (MIME allowlist + 10MB cap + private bucket) verified in 37-03 grep gate.

## Phase38Event union additions (cumulative)

Per [[planner-missed-status-enum-widening]], same-plan extensions:

| Plan | New events |
|---|---|
| 37-03 | `helpdesk.ticket.created`, `helpdesk.inbound_email.received`, `helpdesk.inbound_email.unknown_sender`, `helpdesk.attachment.scan_deferred` |
| 37-04 | `helpdesk.ticket.assigned`, `helpdesk.sentiment_alert.fired`, `helpdesk.ai.tagged`, `helpdesk.ai.routed`, `helpdesk.ai.sentiment_flagged` |
| 37-05 | `helpdesk.csat.submitted`, `helpdesk.sla.breach` |
| 37-07 | `helpdesk.ticket.closed`, `helpdesk.ticket.reopened`, `helpdesk.ticket.replied` (added per iter-1 B-03 fix) |

Total: 14 helpdesk events registered across 4 plans.

## Migration timestamp manifest

| Slot | Plan | File |
|---|---|---|
| `20270707000001` | 37-01 | helpdesk_schema.sql |
| `20270707000002` | 37-01 | helpdesk_rls_policies.sql |
| `20270707000003` | 37-01 | helpdesk_secdef_rpcs.sql |
| `20270707000004` | 37-01 | helpdesk_seed_macros.sql |
| `20270707000005` | 37-02 | helpdesk_fts_index.sql |
| `20270707000006` | 37-02 | helpdesk_search_kb_fn.sql |
| `20270707000007` | 37-02 | helpdesk_pg_cron.sql |
| `20270707000008` | 37-05 | helpdesk_sla_breach_state.sql |
| `20270707000009` | 37-01 (added iter-1) | helpdesk_create_ticket_rpc.sql |
| `20270707000010` | 37-08 | helpdesk_admin_rpcs.sql |

No collisions. Slot 9 was the previously-conditional slot Plan 06 had reserved before iter-1 moved the RPC into 37-01's scope; now permanently owned by 37-01.
