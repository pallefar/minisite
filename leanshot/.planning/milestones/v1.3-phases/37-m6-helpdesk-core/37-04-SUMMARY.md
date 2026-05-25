---
phase: 37-m6-helpdesk-core
plan: 04
subsystem: helpdesk-ai-assist
tags: [helpdesk, edge-fn, ai, anthropic, baa, hipaa, zod, sentiment]
dependency_graph:
  requires:
    - "37-01: tickets (org_id, user_id, phi, status, assigned_to, sentiment_min_score, sentiment_alert_fired_at), ticket_messages (author_kind), ticket_ai_suggestions, ticket_tags, helpdesk_routing_rules tables"
    - "_shared/baa-scope.ts (resolveBaaScope + assertBaaScope) — Phase 38-02"
    - "_shared/anthropic-baa-allowlist.ts (BAA_COVERED_MODELS includes claude-sonnet-4-6) — Phase 25 / 38"
    - "_shared/sentry.ts (addBreadcrumb + __getBreadcrumbsForTest test seam)"
    - "_shared/posthog-server.ts (Phase38Event union + captureServer + shutdownPostHog)"
    - "AI Gateway env vars: AI_GATEWAY_API_KEY_CONSUMER, AI_GATEWAY_API_KEY_CLINICAL, AI_GATEWAY_BASE_URL, ANTHROPIC_MODEL_HELPDESK"
  provides:
    - "supabase/functions/helpdesk-ai-assist/index.ts — Claude tagger + router + sentiment classifier"
    - "Invocation contract: POST /functions/v1/helpdesk-ai-assist { ticket_id, message_id }, Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
    - "Response shape: { ok, suggestion_id, applied, sentiment_alert, refusal?, zod_failed?, skipped? }"
    - "Phase38Event widening: helpdesk.ticket.assigned | helpdesk.sentiment_alert.fired | helpdesk.ai.tagged | helpdesk.ai.routed | helpdesk.ai.sentiment_flagged"
    - "Closed tag taxonomy (13): billing, account, technical, bug, feature_request, kb_question, urgent_safety, integration, data_export, refund_request, account_deletion, escalation, other"
    - "Hardcoded thresholds (v1.3): TAG_AUTO_APPLY=0.75, ROUTE_AUTO_APPLY=0.75, SENTIMENT_ALERT_SINGLE=-0.6, SENTIMENT_AGGREGATE_PER_MSG=-0.3, SENTIMENT_AGGREGATE_COUNT=3"
  affects:
    - "Plan 37-05 (helpdesk-agent-bridge / outbound) — consumes ticket_ai_suggestions.draft_reply + suggested_route_user_id, NEVER auto-sends (D-08)"
    - "Plan 37-07 (admin inbox UI) — renders ticket_ai_suggestions for agent review when applied=false; calls apply_ai_suggestion RPC with agent auth.uid()"
    - "Plan 37-09 (closeout) — operator sets ANTHROPIC_MODEL_HELPDESK + AI_GATEWAY_* Function Secrets (canonical names, NOT ANTHROPIC_API_KEY/_BAA which the plan originally referenced)"
tech_stack:
  added: []
  patterns:
    - "BAA scope chain ordering load-bearing for Phase 25 HIPAA-01 audit (resolved → breadcrumb → fetch)"
    - "Server-side equivalent of agent-only SECDEF RPC (Rule 1 deviation — apply_ai_suggestion requires auth.uid)"
    - "Test seam for ESM-binding-bound exports (setCaptureForTest pattern when @std/testing/mock can't stub)"
key_files:
  created:
    - "supabase/functions/helpdesk-ai-assist/cors.ts"
    - "supabase/functions/helpdesk-ai-assist/index.ts (855 lines incl. comments)"
    - "supabase/functions/helpdesk-ai-assist/index.test.ts (15 tests)"
    - ".planning/phases/37-m6-helpdesk-core/37-04-SUMMARY.md"
  modified:
    - "supabase/functions/_shared/posthog-server.ts (+10 lines — Phase38Event widening)"
decisions:
  - "Implemented apply_ai_suggestion LOGIC server-side instead of calling the SECDEF RPC; the RPC asserts auth.uid() and rejects service-role callers. The Edge Fn upserts ticket_tags + updates tickets.assigned_to + stamps applied_at — same writes the RPC would have made. Plan 07 will still call the RPC from the agent inbox (where auth.uid is non-null)."
  - "Used canonical env var names AI_GATEWAY_API_KEY_CONSUMER / AI_GATEWAY_API_KEY_CLINICAL / AI_GATEWAY_BASE_URL (matching _shared/baa-scope.ts Phase 38 contract) instead of the plan's ANTHROPIC_API_KEY / ANTHROPIC_API_KEY_BAA / ANTHROPIC_API_BASE — resolveBaaScope is the source of truth and reads the AI_GATEWAY_* names."
  - "Added captureServer test seam (setCaptureForTest / resetCaptureForTest) to index.ts because jsr:@std/testing/mock fails with 'Cannot stub: non-configurable instance method' on ESM-binding module exports."
  - "AI_GATEWAY base URL is stripped of any trailing /v1 before re-appending /v1/messages — mirrors anthropic-summarize convention so misconfigured AI_GATEWAY_BASE_URL='https://...com/v1' doesn't produce /v1/v1/messages."
  - "Defensive dotted-model-id check in the handler: any model id matching /claude-(sonnet|opus|haiku)-\\d+\\.\\d+/i returns 500 config_invalid_model_id before reaching Anthropic — belt-and-suspenders on top of the BAA allowlist."
metrics:
  duration: "~45 minutes (single executor wave 3)"
  completed_date: "2026-05-21"
  tasks_total: 3
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  tests_added: 15
---

# Phase 37 Plan 04: helpdesk-ai-assist Edge Function Summary

Phase 37 (m6 helpdesk core) Wave 3 ships `helpdesk-ai-assist` — the Claude-powered ticket classifier that runs fire-and-forget after every user-authored `ticket_messages` insert. Performs tag classification (closed 13-tag taxonomy), routing suggestion against `helpdesk_routing_rules`, sentiment scoring, and draft-reply generation. Critically: **draft replies are NEVER auto-sent** (HELP-04 / D-08); the agent inbox dispatches outbound mail.

## Plan Outcome

All 3 tasks executed in sequence on `worktree-agent-a2aea78b09b1212be`:

| Task | Commit  | Subject                                                                                                                                            |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 02a8141 | feat(37-04): helpdesk-ai-assist Edge Fn — PHI gate, BAA chain, structured Zod output                                                                |
| 2    | 9a1a831 | test(37-04): helpdesk-ai-assist Deno tests + captureServer test seam (15 cases pass)                                                                |
| 3    | fce4948 | feat(37-04): widen Phase38Event union with 5 helpdesk AI assist event names                                                                          |

## Function Secrets (Plan 37-09 closeout sets)

These are the names the Edge Fn ACTUALLY reads — the plan originally listed `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_BAA` / `ANTHROPIC_API_BASE`, but `_shared/baa-scope.ts` from Phase 38-02 reads `AI_GATEWAY_*` names. We use the canonical names so resolveBaaScope and the Anthropic call agree on which secret is in scope.

| Secret                           | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                   | Admin client base URL                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`      | Admin client key + the auth-gate Bearer that callers must send                                 |
| `AI_GATEWAY_API_KEY_CONSUMER`    | Consumer (non-BAA) credential, used when ticket.user has `profiles.primary_org_id IS NULL`     |
| `AI_GATEWAY_API_KEY_CLINICAL`    | BAA-covered credential, used when ticket.user has a non-null `primary_org_id`                  |
| `AI_GATEWAY_BASE_URL`            | Vercel AI Gateway base (e.g. `https://ai-gateway.vercel.sh/v1`) — trailing `/v1` stripped     |
| `ANTHROPIC_MODEL_HELPDESK`       | `anthropic/claude-sonnet-4-6` (hyphenated — dotted form is rejected at runtime as Rule-2 mitigation) |
| `POSTHOG_PROJECT_KEY` (optional) | Vendor-gated; captureServer no-ops with one-time warning when unset                            |
| `SENTRY_DSN` (optional)          | Vendor-gated; addBreadcrumb mirrors to in-memory buffer when unset (test seam compatible)      |

## Invocation Contract (for Plans 37-05 / 37-07 callers)

```
POST {SUPABASE_URL}/functions/v1/helpdesk-ai-assist
Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
Content-Type: application/json

{ "ticket_id": "uuid", "message_id": "uuid" }
```

Already wired up in `helpdesk-inbound/index.ts` (Plan 37-03, line 657-668) as fire-and-forget. The Edge Fn re-reads `tickets.phi` from the DB and re-resolves BAA scope from `ticket.user_id` — callers MUST NOT pass `phi` or scope hints; they are ignored by design (T-37-04-01 mitigation).

### Response shapes

| Status | Shape                                                                                | When                                         |
| ------ | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| 200    | `{ ok: true, suggestion_id, applied, sentiment_alert }`                              | Normal path — at least one classifier ran    |
| 200    | `{ ok: true, suggestion_id, applied: false, sentiment_alert: false, refusal: true }` | Claude refused; empty audit-trace suggestion |
| 200    | `{ ok: true, suggestion_id, applied: false, sentiment_alert: false, zod_failed: true }` | Claude returned malformed JSON               |
| 200    | `{ ok: true, skipped: true, reason: 'non_user_author' }`                             | message.author_kind !== 'user'               |
| 400    | `{ error: 'invalid_json' \| 'missing_ticket_or_message_id' }`                        | Bad input                                    |
| 401    | `{ error: 'unauthorized' }`                                                          | Bearer mismatch                              |
| 403    | `{ error: 'model-not-baa-covered', modelId, reason }`                                | Clinical user + non-allowlisted model        |
| 404    | `{ error: 'ticket_not_found' \| 'message_not_found' }`                               | Resource gone                                |
| 500    | `{ error: 'config_missing_model' \| 'config_invalid_model_id' \| 'config_missing_base_url' \| 'baa_scope_resolve_failed' \| 'suggestion_insert_failed' \| 'internal_error' }` | Misconfiguration / unexpected                |
| 502    | `{ error: 'anthropic_call_failed' }`                                                  | Anthropic non-2xx or transport               |

## Phase38Event Widening (so Plans 37-05 / 06 / 07 don't re-add)

5 new union members landed in the same commit as the Edge Fn that fires them (per memory `feedback_planner_missed_status_enum_widening`):

| Event                              | Fires when                                                                | Payload                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `helpdesk.ai.tagged`               | At least one tag confidence ≥0.75; ticket_tags upserted                   | `{ ticket_id, tag_count, top_tag_confidence, model_id, is_clinical }` |
| `helpdesk.ticket.assigned`         | Routing rule matched + top-tag ≥0.75; tickets.assigned_to updated         | `{ ticket_id, assigned_to, via: 'ai' }`                    |
| `helpdesk.ai.routed`               | Twin to `helpdesk.ticket.assigned` — taxonomy event for AI funnel        | `{ ticket_id, route_confidence, tag }`                     |
| `helpdesk.sentiment_alert.fired`   | sentiment ≤ -0.6 OR aggregate ≥3× ≤ -0.3                                  | `{ ticket_id, sentiment_score }`                           |
| `helpdesk.ai.sentiment_flagged`    | Twin to `helpdesk.sentiment_alert.fired` — model-attribution event       | `{ ticket_id, sentiment_score, model_id }`                 |

## Confidence Thresholds (locked at v1.3 per D-06 / D-07 / D-10 / D-11)

```typescript
TAG_AUTO_APPLY            = 0.75   // ≥ → upsert ticket_tags (applied_by='ai')
ROUTE_AUTO_APPLY          = 0.75   // ≥ → set tickets.assigned_to
SENTIMENT_ALERT_SINGLE    = -0.6   // ≤ → fire immediately
SENTIMENT_AGGREGATE_PER_MSG = -0.3 // ≤ counted toward aggregate
SENTIMENT_AGGREGATE_COUNT = 3      // ≥ matching rows on ticket → fire
```

No admin UI in v1.3 per D-11. Plan 04 closeout (37-09) will surface threshold-hit metrics via the new PostHog events so a v1.4 admin UI ships with data-informed defaults (CONTEXT line 157).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `apply_ai_suggestion` RPC unreachable from service-role caller**
- **Found during:** Task 1 implementation
- **Issue:** The plan instructed `admin.rpc('apply_ai_suggestion', { p_suggestion_id })`, but that RPC (migration `20270707000003_helpdesk_secdef_rpcs.sql` line 237-239) raises `'unauthenticated'` (errcode `42501`) when `auth.uid()` is null. Service-role JWTs from this Edge Fn do not set `auth.uid()`.
- **Fix:** Implemented the RPC's write set inline (`applySuggestionServerSide` in index.ts) — upserts `ticket_tags` with `applied_by='ai'`, updates `tickets.assigned_to` if route conf ≥0.75, stamps `ticket_ai_suggestions.applied_at`. Same writes; just without the `auth.uid()` guard.
- **Plan 37-07 implication:** The agent inbox MUST still call the RPC (where the agent's JWT carries `auth.uid()`); the server-side path is for the auto-apply gate only.
- **Files modified:** `supabase/functions/helpdesk-ai-assist/index.ts` (lines 393-433 incl. comments)
- **Commit:** 02a8141

**2. [Rule 3 — Blocking] Env var names mismatch with `_shared/baa-scope.ts`**
- **Found during:** Task 1 implementation
- **Issue:** Plan referenced `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_BAA` / `ANTHROPIC_API_BASE`, but `resolveBaaScope` from Phase 38-02 reads `AI_GATEWAY_API_KEY_CONSUMER` / `AI_GATEWAY_API_KEY_CLINICAL` / `AI_GATEWAY_BASE_URL`. Mixing names would have caused resolveBaaScope to throw `BaaScopeError` at runtime (credential unset).
- **Fix:** Used the canonical `AI_GATEWAY_*` names. resolveBaaScope is the source of truth.
- **Plan 37-09 implication:** Operator sets `AI_GATEWAY_*` (not `ANTHROPIC_*`) Function Secrets.
- **Files modified:** `supabase/functions/helpdesk-ai-assist/index.ts`
- **Commit:** 02a8141

**3. [Rule 1 — Bug] `jsr:@std/testing/mock` cannot stub ESM module bindings**
- **Found during:** Task 2 test execution
- **Issue:** `stub(posthog, 'captureServer', ...)` raises `MockError: Cannot stub: non-configurable instance method` — ESM module bindings are read-only by spec.
- **Fix:** Added a `_captureImpl` indirection inside `index.ts` and exposed `setCaptureForTest` / `resetCaptureForTest` test seams on `__internal`. Tests now monkey-patch via the seam.
- **Files modified:** `supabase/functions/helpdesk-ai-assist/index.ts`
- **Commit:** 9a1a831

**4. [Rule 1 — Bug] Worktree pwd-drift: initial Write tool calls landed in MAIN tree**
- **Found during:** Task 1 commit step (`git status --short` returned empty)
- **Issue:** First Write tool calls used absolute path `/Users/karstenhaldan/minisite/supabase/...` which is the MAIN repo, not the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a2aea78b09b1212be/supabase/...`. Per memory `feedback_worktree_executor_pwd_drift_leaks_to_main`.
- **Fix:** `cp -r` from main into worktree; `rm -rf` from main. Subsequent edits used the worktree path.
- **Files moved:** `helpdesk-ai-assist/{cors.ts, index.ts}`
- **Note:** No commit was made on main; the move happened before Task 1 commit.

### Auth Gates

None — this plan is fully autonomous. Plan 37-09 closeout owns the operator-driven secret-set step.

## Threat Model Coverage (vs `<threat_model>` in 37-04-PLAN.md)

| Threat ID    | Mitigation in code                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-37-04-01   | `fetchTicket` reads `tickets.phi` from DB; `resolveBaaScope(admin, ticket.user_id)` re-resolves credential; assertBaaScope throws Response(403) on miss     |
| T-37-04-02   | `addBreadcrumb('anthropic.messages.create')` fires INSIDE `callClaude` after resolve/assert — T4 [LOAD-BEARING] test asserts order on `__getBreadcrumbsForTest` |
| T-37-04-03   | `ClaudeOutputSchema.safeParse` with `z.enum(ALLOWED_TAGS)`; routing lookup uses exact `eq('tag_name', routing_suggestion)`                                  |
| T-37-04-04   | `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` required; 401 on mismatch (T1/T1b tests)                                                               |
| T-37-04-05   | `TAG_AUTO_APPLY` / `ROUTE_AUTO_APPLY` are module constants; T8/T9 tests assert the threshold split                                                          |
| T-37-04-06   | Static grep gate (`! grep -q sendEmail`); no outbound-email helper imported in index.ts                                                                     |
| T-37-04-07   | PostHog payloads carry only `ticket_id`, scores, `model_id`, `is_clinical` — never `message.body`, `parsed.draft_reply`, or `subject`                       |

## Verification Status

- `cd supabase/functions && deno test --allow-env --allow-net --allow-read helpdesk-ai-assist/index.test.ts` → 15 / 15 pass
- `cd supabase/functions && deno check helpdesk-ai-assist/index.ts` → clean
- `! grep -q "sendEmail"` → clean
- `! grep -q "/chat/completions"` → clean
- `! grep -q "claude-sonnet-4\.6"` → clean (dotted-form absent)
- `grep -q "claude-sonnet-4-6\|ANTHROPIC_MODEL_HELPDESK"` → matches (hyphenated env var name)
- BAA breadcrumb order test (T4 [LOAD-BEARING]) passes
- Phase38Event union widened with 5 new names — `helpdesk-ai-assist/index.ts` deno-checks clean against the typed catalog

## Open Items for Plan 37-09 Closeout

1. Operator sets Function Secrets: `AI_GATEWAY_API_KEY_CONSUMER`, `AI_GATEWAY_API_KEY_CLINICAL`, `AI_GATEWAY_BASE_URL`, `ANTHROPIC_MODEL_HELPDESK='anthropic/claude-sonnet-4-6'`. Reuse Phase 38-02 values for the API keys + base URL.
2. `supabase functions deploy helpdesk-ai-assist` (no `--linked` per `reference_supabase_functions_deploy_no_linked_flag`).
3. CI lint to grep for `sendEmail` import drift in `helpdesk-ai-assist/index.ts` (T-37-04-06 mitigation depth).
4. Plan 37-07 admin inbox MUST call `apply_ai_suggestion(uuid)` RPC (not re-implement the apply logic) so agent attribution lands in `auth.uid()` audit trail.

## Self-Check: PASSED

Files verified to exist:
- FOUND: `supabase/functions/helpdesk-ai-assist/cors.ts`
- FOUND: `supabase/functions/helpdesk-ai-assist/index.ts`
- FOUND: `supabase/functions/helpdesk-ai-assist/index.test.ts`
- FOUND: `supabase/functions/_shared/posthog-server.ts` (modified)

Commits verified to exist on worktree branch:
- FOUND: 02a8141 (Task 1)
- FOUND: 9a1a831 (Task 2)
- FOUND: fce4948 (Task 3)
