---
phase: 37-m6-helpdesk-core
plan: 02
subsystem: helpdesk-infrastructure
tags: [helpdesk, postgres, fts, pg_cron, email-router, hmac]
dependency_graph:
  requires:
    - "37-01: kb_articles table + ticket_ai_suggestions table (parallel-safe; grep-only verify)"
    - "supabase/functions/_shared/email-router.ts (Phase 25 D-03 dual-vendor PHI router)"
    - "supabase/functions/_shared/lifecycle-send.ts (Resend stub path)"
    - "vault entry name='service_role_key' (Phase 19+; reused for pg_cron Bearer)"
  provides:
    - "Two GENERATED tsvector columns (kb_articles.search_vector_en, .search_vector_es) + GIN indexes"
    - "public.search_kb_articles(p_query, p_locale, p_org_id, p_limit) SECDEF RPC body"
    - "pg_cron job 'helpdesk-sla-breach-check' (*/5 * * * *)"
    - "pg_cron job 'helpdesk-sla-stale-suggestion-cleanup' ('15 4 * * *')"
    - "EmailTemplate union members: csat_followup | helpdesk_agent_reply | sla_breach_alert | helpdesk_unknown_sender"
    - "_shared/email-templates/{csat-followup,helpdesk-agent-reply,sla-breach-alert,helpdesk-unknown-sender}.ts"
    - "_shared/helpdesk-hmac.ts: generateReplyToken, verifyReplyToken (constant-time)"
  affects:
    - "Plan 37-03 (helpdesk-inbound) — consumes verifyReplyToken"
    - "Plan 37-04 (helpdesk-agent-reply) — consumes generateReplyToken + helpdesk_agent_reply template"
    - "Plan 37-05 (sla-breach-cron Edge Fn) — consumed by 'helpdesk-sla-breach-check' cron"
    - "Plan 37-06 (KB search widget) — consumes public.search_kb_articles RPC"
    - "Plan 37-09 (closeout) — operator sets HELPDESK_HMAC_SECRET Function Secret from vault"
tech_stack:
  added: []
  patterns:
    - "[[reference_postgres_dollar_quote_nesting_in_cron_body]] — outer $cron$ + named inner tags"
    - "[[reference_supabase_pg_cron_vault_service_role_pattern]] — vault.decrypted_secrets Bearer"
    - "[[feedback_planner_missed_status_enum_widening]] — union + switch in one commit"
    - "[[reference_deno_test_discovery]] — <name>.test.ts naming"
    - "[[reference_grep_gate_comment_strip]] — neutralized forbidden literals in doc comments"
key_files:
  created:
    - "supabase/migrations/20270707000005_helpdesk_fts_index.sql"
    - "supabase/migrations/20270707000006_helpdesk_search_kb_fn.sql"
    - "supabase/migrations/20270707000007_helpdesk_pg_cron.sql"
    - "supabase/functions/_shared/email-templates/csat-followup.ts"
    - "supabase/functions/_shared/email-templates/helpdesk-agent-reply.ts"
    - "supabase/functions/_shared/email-templates/sla-breach-alert.ts"
    - "supabase/functions/_shared/email-templates/helpdesk-unknown-sender.ts"
    - "supabase/functions/_shared/helpdesk-hmac.ts"
    - "supabase/functions/_shared/helpdesk-hmac.test.ts"
  modified:
    - "supabase/functions/_shared/email-router.ts (union widening + 2 switch widenings + 4 imports)"
    - "supabase/functions/_shared/email-router.test.ts (+4 helpdesk routing tests T6–T9)"
decisions:
  - "Locale validation in search_kb_articles raises errcode 22023 on unsupported locales (en/es only) rather than silent fallback — explicit failure surfaces caller bugs in Plan 37-06."
  - "Visibility rule for agent cross-org search: when p_org_id is NULL, the SQL returns global KB AND every org the caller is a member of (single round-trip; matches the admin module's intent)."
  - "p_limit clamped via greatest(1, least(p_limit, 50)) — defense in depth; the API layer should already validate but a buggy caller cannot DoS via huge limits."
  - "renderTemplate wraps each helpdesk template's plain-text body in HTML-escaped + newline-to-<br>; this keeps the templates plain-text (the canonical source) while still rendering as HTML for mail clients that prefer it."
  - "helpdesk_unknown_sender (D-21 auto-reply) routes via Resend because the body contains no patient data — only a signup CTA URL."
  - "sla_breach_alert is INTERNAL non-PHI: the caller always passes phi=false even though the underlying ticket might be PHI; the alert body contains no patient identifiers, only ticket_ref + tier + breach_type + elapsed/target minutes."
  - "verifyReplyToken swallows all exceptions and returns false; helpdesk-inbound needs a simple accept/reject boolean."
metrics:
  duration_iso8601: "PT~22M"
  completed_utc: "2026-05-21T08:33:33Z"
  tasks_completed: 4
  files_created: 9
  files_modified: 2
  commits: 5
---

# Phase 37 Plan 02: KB FTS + pg_cron + Email-router + HMAC Helper Summary

One-liner: cross-cutting helpdesk infrastructure — KB full-text search (EN+ES STORED tsvector + GIN), pg_cron SLA breach trigger (named dollar-quotes + vault Bearer), email-router widened with 4 helpdesk templates in a single union+switch commit, and a Deno-native constant-time HMAC reply-token helper.

## Scope Delivered

3 SQL migrations + 4 plain-text email templates + 2 _shared TypeScript modules + 1 _shared TypeScript test file + 2 in-place edits to existing _shared files, all on `worktree-agent-a6285ea56222c62cd`. Sibling Plan 37-01 owns slots 01/02/03/04/09 + the kb_articles + ticket_ai_suggestions DDL; this plan owns slots 05/06/07 + every Wave-1 Edge Fn helper.

## Cron Job Names + Cadence (for Plan 37-05 alignment)

| Job name | Schedule | Body | Edge Fn target |
|---|---|---|---|
| `helpdesk-sla-breach-check` | `*/5 * * * *` | `net.http_post` with vault `service_role_key` Bearer | `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-sla-breach-cron` (Plan 37-05) |
| `helpdesk-sla-stale-suggestion-cleanup` | `15 4 * * *` (daily 04:15 UTC) | direct SQL `DELETE FROM ticket_ai_suggestions WHERE created_at < now() - interval '60 days' AND applied_at IS NULL` | n/a |

Named-tag layout per [[reference_postgres_dollar_quote_nesting_in_cron_body]]:
* outer: `$cron$ … $cron$`
* inner: `$sla$ … $sla$` (breach) and `$cleanup$ … $cleanup$` (cleanup)
* pre-flight DO-block: `$unschedule$ … $unschedule$`

No bare `$$` anywhere inside the cron-body string. No `current_setting('app.*')` GUC reads.

## search_kb_articles RPC Signature (for Plan 37-06 widget consumer)

```sql
public.search_kb_articles(
  p_query  text,
  p_locale text default 'en',          -- ('en' | 'es') — raises 22023 otherwise
  p_org_id uuid default null,          -- NULL → global KB + any org caller is a member of
  p_limit  int  default 10             -- clamped to [1, 50]
) returns table (
  id     uuid,
  slug   text,
  title  text,                         -- per-locale resolved title
  locale text,                         -- echo of p_locale
  rank   real                          -- ts_rank_cd descending
)
language plpgsql security definer
set search_path = public, extensions
```

Grants: revoke from `public`, grant to `authenticated`. Caller can be any signed-in user; visibility filters apply per-row via `org_members` membership check.

## EmailTemplate Values Added (verbatim — for Plans 37-03/04/05 senders)

```typescript
| 'csat_followup'              // non-PHI → Resend (CSAT score link only)
| 'helpdesk_agent_reply'       // phi-aware → caller authoritative
| 'sla_breach_alert'           // non-PHI → Resend (internal alert)
| 'helpdesk_unknown_sender';   // non-PHI → Resend (D-21 signup CTA)
```

Switch arms wired in both `subjectFor()` and `renderTemplate()` of `_shared/email-router.ts`. Each new arm delegates to a per-template module (`subject(vars)` / `render(vars)`) in `_shared/email-templates/<name>.ts`. PHI routing is **always** caller-authoritative (`args.phi`); template names never imply routing.

## HMAC Signatures (for Plan 37-03 inbound verifier + Plan 37-04 sender)

```typescript
// _shared/helpdesk-hmac.ts
export function generateReplyToken(
  secret: string,
  ticketId: string,
  userId: string,
): Promise<string>;   // base64url(HMAC-SHA256(secret, `${ticketId}:${userId}`))

export function verifyReplyToken(
  token: string,
  secret: string,
  ticketId: string,
  userId: string,
): Promise<boolean>;  // constant-time, garbage-safe (returns false on any error)
```

Reply-To envelope (per CONTEXT D-19): `reply+<token>@app.leanshot.app`.

## Function Secret Setup (for Plan 37-09 closeout)

Operator MUST set `HELPDESK_HMAC_SECRET` as a Supabase Function Secret pointing at the vault value seeded by Plan 37-01 Task 4. Suggested setup gate inside Plan 37-09:

```bash
HMAC_SECRET=$(supabase --linked db query --csv \
  "select decrypted_secret from vault.decrypted_secrets where name='helpdesk_hmac_secret' limit 1" \
  | tail -1)
supabase secrets set HELPDESK_HMAC_SECRET="$HMAC_SECRET" --project-ref ytnsipxxmzgaebkqmokp
```

(Per [[reference_vapid_keypair_supabase_setup.md]] convention — vault is source of truth; Function Secret is a read-time copy. Never echo HMAC secret to logs.)

## Verification Results

| Verify step | Outcome |
|---|---|
| Task 1 grep (tsvector GENERATED + GIN + SECDEF + search_path) | PASS |
| Task 2 grep (helpdesk-sla-breach-check, $cron$, $sla$, vault.decrypted_secrets, no app.* GUC, no bare $$) | PASS |
| Task 3 grep (4 template member refs + 4 template files) | PASS (12 occurrences in router) |
| Task 3 deno test (_shared/email-router.test.ts) | 9 passed / 0 failed (T1–T9) |
| Task 4 deno test (_shared/helpdesk-hmac.test.ts) | 7 passed / 0 failed |
| Combined deno test (both files together) | 16 passed / 0 failed (39ms wall) |
| `supabase db push --linked` runtime verify | DEFERRED — see Deferred Issues |
| `tsc -p tsconfig.app.json --noEmit` on leanshot/ | N/A — Edge Fn code does not flow through the SPA tsconfig |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Deno binary missing from PATH**
- **Found during:** Task 3 first verify attempt.
- **Issue:** `which deno` returned nothing — Task 3/4 verify blocks call `deno test`.
- **Fix:** Re-used the project's existing Deno install at `$HOME/.deno/bin/deno` (v2.7.14) by prefixing `PATH` in the verify shell. No new install, no global change.
- **Files modified:** none (PATH change is scoped to verify invocations).
- **Commit:** n/a (operator-environment fix only).

**2. [Rule 2 — Correctness] Plan-checker grep-gate comment-strip hygiene**
- **Found during:** Task 2 verify.
- **Issue:** The plan-checker grep `! grep -q "current_setting('app." …` is comment-naive. The migration's documentation comment used the literal string to label it as forbidden, which made the grep-gate false-positive (per [[reference_grep_gate_comment_strip]]).
- **Fix:** Rewrote two doc-comment sentences (one for the `current_setting('app.*')` mention, one for the "bare `$$`" mention) so the literals no longer appear in code OR comments. Behavior is unchanged; documentation intent is preserved with alternate wording.
- **Files modified:** `supabase/migrations/20270707000007_helpdesk_pg_cron.sql`.
- **Commit:** part of `d975292`.

**3. [Rule 2 — Correctness] Made test naming explicit instead of overwriting**
- **Found during:** Task 3 test extension.
- **Issue:** Existing `email-router.test.ts` already had T1–T5 covering Phase 25 routing. Plan said "add test cases" — I appended T6–T9 (one per helpdesk template) BEFORE the existing T5 block to keep the file logically ordered (Phase 25 above + Phase 37 below + Phase 25 closing test). Re-running the existing test confirmed no regression on Phase 25 routing.
- **Fix:** New tests named with explicit `T6 (37-02):` prefix so phase ownership is greppable.
- **Files modified:** `supabase/functions/_shared/email-router.test.ts`.
- **Commit:** part of `79cc308`.

### Authentication Gates

None encountered. All work was filesystem + Deno test only.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries were introduced beyond those listed in the plan's `<threat_model>`. The cron Bearer surface (T-37-02-03) was already covered.

## Known Stubs

None — no UI-facing placeholder data introduced. The search RPC has a fully-wired body (no `select null limit 0`-style stub), the cron job has a real schedule (not `'0 0 31 2 *'`), and the HMAC helper is a complete crypto implementation. The Edge Fn target `/functions/v1/helpdesk-sla-breach-cron` does not yet exist — Plan 37-05 ships it — but that is a documented cross-plan dependency, not a stub.

## Deferred Issues

**1. Runtime DB-push verify — deferred to Plan 37-09 closeout (operator).**

The plan's `<verification>` block step 1 calls `supabase db push --linked` to apply the 3 migrations. This executor does not have permission to push migrations live in autonomous mode (matches Phase 37 wave-1 parallel-safety contract — migrations are committed to the worktree branch only; push happens at orchestrator-merge time). Grep-time invariants pass. Runtime tests:

- migration apply order matches the slot numbering 01–07; orchestrator's pre-merge `db push --linked` validates the squash.
- `select * from cron.job where jobname = 'helpdesk-sla-breach-check'` should return 1 row (post-push).
- `select indexname from pg_indexes where tablename = 'kb_articles' and indexname like '%search%'` should return 2 rows (post-push).

**2. T4 (router test for stubbed SES + tampered creds) unchanged — pre-existing.**

The existing T4 in `_shared/email-router.test.ts` relies on SES throwing `ses_send_failed` with `test-stub` credentials. This still works under Deno 2.7.14 (`NotCapable` error from the SDK propagates as `ses_send_failed`). No fix needed.

## Commits on Branch

| # | Hash | Type | Subject |
|---|---|---|---|
| 1 | `14cd20f` | feat | kb_articles FTS — GENERATED tsvector EN+ES + GIN + search_kb_articles RPC |
| 2 | `d975292` | feat | pg_cron — helpdesk-sla-breach-check (5min) + stale-suggestion-cleanup (daily) |
| 3 | `79cc308` | feat | email-router — 4 helpdesk templates + union/switch/test in one commit |
| 4 | `3dee412` | test | RED — helpdesk-hmac.test.ts (generate + verify, constant-time, garbage-safe) |
| 5 | `f8dab5c` | feat | GREEN — helpdesk-hmac.ts generateReplyToken + verifyReplyToken (constant-time) |

TDD gate compliance: Task 4 (`tdd="true"`) shows the RED→GREEN sequence (`test(...)` commit precedes `feat(...)` commit). No REFACTOR was needed — the GREEN implementation is final.

## Self-Check: PASSED

- `supabase/migrations/20270707000005_helpdesk_fts_index.sql` — FOUND
- `supabase/migrations/20270707000006_helpdesk_search_kb_fn.sql` — FOUND
- `supabase/migrations/20270707000007_helpdesk_pg_cron.sql` — FOUND
- `supabase/functions/_shared/email-templates/csat-followup.ts` — FOUND
- `supabase/functions/_shared/email-templates/helpdesk-agent-reply.ts` — FOUND
- `supabase/functions/_shared/email-templates/sla-breach-alert.ts` — FOUND
- `supabase/functions/_shared/email-templates/helpdesk-unknown-sender.ts` — FOUND
- `supabase/functions/_shared/helpdesk-hmac.ts` — FOUND
- `supabase/functions/_shared/helpdesk-hmac.test.ts` — FOUND
- commits `14cd20f`, `d975292`, `79cc308`, `3dee412`, `f8dab5c` — FOUND
- Deno test run: 16 passed / 0 failed across both `_shared/` test files
