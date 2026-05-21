---
phase: 37-m6-helpdesk-core
plan: 03
subsystem: helpdesk-inbound
tags: [helpdesk, edge-fn, resend, inbound, hmac, svix]
dependency_graph:
  requires:
    - "37-01: tickets / ticket_messages / ticket_attachments / ticket_inbound_events tables; storage bucket 'ticket-attachments'"
    - "37-02: _shared/helpdesk-hmac.ts (verifyReplyToken); _shared/email-router.ts helpdesk_unknown_sender template"
    - "Phase 38-09 / 34-03: _shared/posthog-server.ts Phase38Event union + captureServer + shutdownPostHog"
    - "auth.users (email lookup via admin.auth.admin.listUsers — NOT profiles.email which does not exist on this project)"
    - "public.profiles.primary_org_id (Phase 29) + public.org_members(role) (Phase 28)"
  provides:
    - "supabase/functions/helpdesk-inbound/index.ts — Resend Inbound webhook receiver"
    - "Outcome enum: ticket_created | reply_appended | unknown_sender_bounced | hmac_failed_bounced | duplicate | rejected_loop"
    - "Fire-and-forget invocation contract: POST /functions/v1/helpdesk-ai-assist { ticket_id, message_id } (Plan 04 owns)"
    - "Phase38Event widening: helpdesk.ticket.created | .inbound_email.received | .inbound_email.unknown_sender | .attachment.scan_deferred"
  affects:
    - "Plan 37-04 (helpdesk-ai-assist) — invoked fire-and-forget from support@ new-ticket branch; MUST re-read ticket.phi from DB (T-37-03-08)"
    - "Plan 37-09 (closeout) — operator sets RESEND_WEBHOOK_SECRET, HELPDESK_HMAC_SECRET, RESEND_API_KEY Function Secrets; configures Resend Inbound MX + webhook URL"
tech_stack:
  added:
    - "npm:svix@^1.45 (Resend Inbound webhook signature verification)"
  patterns:
    - "[[feedback_planner_missed_status_enum_widening]] — Phase38Event union extended in same commit as Edge Fn"
    - "[[reference_supabase_edge_function_deploy]] — Deno + jsr/npm imports; cors.ts mirroring clinic-invite"
    - "[[reference_deno_test_discovery]] — <name>.test.ts naming"
    - "Idempotency-before-side-effect: ticket_inbound_events.resend_email_id UNIQUE checked before any insert"
    - "Two-step body fetch: webhook payload metadata-only → GET /emails/receiving/:id (Resend Inbound API)"
    - "Trial-verify HMAC across sender's 50 most-recent tickets (token has no embedded ticket_id; constant-time verify per candidate)"
    - "Loop guard: From=/^(noreply|no-reply|reply\\+)@/i → reject WITHOUT auto-reply"
    - "shutdownPostHog() in finally — Deno isolate teardown drops batched events otherwise (Phase 24 D-13)"
key_files:
  created:
    - "supabase/functions/helpdesk-inbound/index.ts"
    - "supabase/functions/helpdesk-inbound/cors.ts"
    - "supabase/functions/helpdesk-inbound/index.test.ts"
  modified:
    - "supabase/functions/_shared/posthog-server.ts (Phase38Event union +4 helpdesk inbound events)"
decisions:
  - "Sender lookup via admin.auth.admin.listUsers({ email }) instead of profiles.email (deviation Rule 1 — profiles has no email column on this project per migration 20261101000001)."
  - "Clinician role list aligned with create_ticket_with_first_message RPC: (owner, clinician, staff) — NOT the plan's (clinician, owner, support_lead); keeps email-vs-widget PHI flagging consistent."
  - "captureServer arg name is userId (Supabase auth.users.id per D-13), NOT distinctId; the plan's distinctId would not type-check against CaptureArgs."
  - "Reply token case-sensitivity: To address parsed against the RAW (case-preserved) string for the reply+<HMAC> regex; base64url is case-sensitive and a uniform .toLowerCase() destroys mixed-case tokens (caught by Deno test 9)."
  - "Attachment row-insert failure path attempts a best-effort storage cleanup via .remove() to avoid orphaned blobs."
  - "On 'user-no-org' (sender authenticated but lacks profiles.primary_org_id), audit row uses outcome='rejected_loop' to satisfy the ticket_inbound_events CHECK constraint without inventing a new outcome label."
  - "Unknown-sender PostHog event for the support@ branch uses userId='unknown_sender' (the captureServer signature requires a non-empty userId; we use a stable system bucket so events_mirror stays consistent)."
metrics:
  duration_iso8601: "PT~8M"
  completed_utc: "2026-05-21T08:48:38Z"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
  commit_count: 4
---

# Phase 37 Plan 03: helpdesk-inbound Edge Function Summary

`helpdesk-inbound` Edge Function — Resend Inbound `email.received` webhook receiver with Svix signature verification (±5min replay window), two-step body fetch (webhook is metadata-only), idempotency lookup, six-outcome dispatcher covering support@ new-ticket creation, reply+<HMAC>@ reply-threading, unknown-sender bounce, HMAC-fail bounce, duplicate detection, and noreply-loop rejection. Attachments ingest with MIME allowlist + 10MB + 10/email caps to private bucket with `scan_status='deferred'` (ClamAV deferred to v1.4) and a per-attachment `helpdesk.attachment.scan_deferred` PostHog audit event. Phase38Event union widened in same commit with 4 new helpdesk event names.

## What shipped

### 1. `supabase/functions/helpdesk-inbound/index.ts` (596 lines)

Single `Deno.serve` dispatcher wrapped in `try / finally { await shutdownPostHog() }`. Pipeline:

1. CORS preflight (OPTIONS → 204) + method gate (POST only → else 405).
2. **Svix signature verify** against `RESEND_WEBHOOK_SECRET` with the standard `svix-id` / `svix-timestamp` / `svix-signature` triple. Bad signature → 401, no DB write.
3. **Idempotency check** against `public.ticket_inbound_events.resend_email_id UNIQUE` BEFORE any side-effect — Svix retries on non-2xx, so the first byte we touch must be the audit table.
4. **Loop guard** — `From` matching `/^(noreply|no-reply|reply\+)@/i` → log `outcome='rejected_loop'`, return 200, do NOT auto-reply (else infinite mail loop).
5. **Two-step body fetch** — webhook payload is metadata-only per the Resend Inbound API; the body + attachment download URLs come from `GET https://api.resend.com/emails/receiving/{email_id}` (1-hour TTL). Failure → 502 (Svix retries).
6. **Address dispatch** (case-sensitivity preserved for the reply token):
   - `support@app.leanshot.app` → `handleSupportBranch`: resolve sender via `auth.admin.listUsers({ email })`; on unknown → bounce + `helpdesk.inbound_email.unknown_sender` audit; on known → resolve `primary_org_id` + clinician-role PHI flag → insert ticket + first message → ingest attachments → fire-and-forget `helpdesk-ai-assist` invocation.
   - `reply+<token>@app.leanshot.app` → `handleReplyBranch`: resolve sender; if unknown → bounce; if known → trial-verify HMAC against sender's 50 most-recent tickets; on match → append `ticket_messages` row + reopen ticket if status in (`waiting_on_customer`/`resolved`/`closed`) + ingest attachments; on miss → bounce via `helpdesk_unknown_sender`.
   - Unknown destination → 200 ignored (no audit row).
7. **Attachment ingest** (`ingestAttachments`): per-attachment MIME-allowlist check (`image/png|jpeg|gif|webp`, `application/pdf`, `text/plain`, `text/csv`) → 10MB size cap → 10/email count cap → fetch from `att.download_url` with Resend bearer → upload to private `ticket-attachments` bucket with random UUID + sanitized filename → insert `ticket_attachments` row with `scan_status='deferred'` → emit `helpdesk.attachment.scan_deferred` PostHog event.

### 2. `supabase/functions/helpdesk-inbound/cors.ts`

Mirrors `clinic-invite/cors.ts`. `Access-Control-Allow-Origin: *` is safe — this Function is server-to-server (Resend webhook delivery, never browser-invoked). Allow-Headers includes `svix-id`, `svix-timestamp`, `svix-signature` so any misconfigured preflight passes.

### 3. `supabase/functions/helpdesk-inbound/index.test.ts` (635 lines)

15 Deno.test cases (14 behavioural + 1 cleanup fixture) covering all 7 outcome branches plus attachment validation + idempotency + loop guard. Mock strategy:

- **Hand-rolled chainable supabase-js admin mock** with shared `state` object (`ticket_inbound_events`, `profiles`, `org_members`, `ticketsById`, `ticketsByUser`, `ticket_messages`, `ticket_attachments`, `storageUploads`, `authUsers`). The mock injects via `__internal.setAdminForTest()` swapping out the lazy admin singleton.
- **Svix-signed request builder** using the real `Webhook.sign()` method against a deterministic 32-byte test secret — produces signatures the real `Webhook.verify()` accepts. Tamper test flips one byte.
- **`globalThis.fetch` stub** with per-URL response mapping for Resend body fetch, attachment downloads, and the fire-and-forget `helpdesk-ai-assist` POST.

All 15 tests pass under `deno test --allow-all --import-map=import_map.json`.

### 4. `supabase/functions/_shared/posthog-server.ts` (Phase38Event widening)

Appended 4 union members below the existing `eval.judge.score` / `anthropic.prompt_cache.hit` entries. `CaptureArgs.event` is typed as `string` so the union remains a documentation/catalogue contract; the runtime impact is zero. Plan 04 (Wave 3) extends the same file with `helpdesk-ai-assist` events — Wave 2/3 ordering avoids parallel-executor file-modify overlap.

## Function Secrets required (Plan 09 closeout)

| Secret                       | Source                                      | Purpose                                          |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`               | platform-provided                           | admin client + helpdesk-ai-assist invocation     |
| `SUPABASE_SERVICE_ROLE_KEY`  | platform-provided                           | admin client (RLS bypass)                        |
| `RESEND_API_KEY`             | Resend dashboard                            | inbound body fetch + helpdesk_unknown_sender send |
| `RESEND_WEBHOOK_SECRET`      | Resend dashboard → Webhooks → Signing secret | Svix verify                                      |
| `HELPDESK_HMAC_SECRET`       | mirrored from `vault.helpdesk_hmac_secret`  | reply-token verify                               |
| `POSTHOG_PROJECT_KEY`        | PostHog project                             | optional — vendor-gated, no-op if absent         |

## Resend dashboard config (Plan 09 human-UAT)

- **Inbound domain:** `app.leanshot.app` MX records → Resend MX servers (per Resend Inbound docs).
- **Inbound rule:** match `support@app.leanshot.app` AND `reply+*@app.leanshot.app` → forward to webhook.
- **Webhook URL:** `https://<project-ref>.supabase.co/functions/v1/helpdesk-inbound`.
- **Webhook events:** subscribe to `email.received`.
- **Signing secret:** copy from Resend → set as `RESEND_WEBHOOK_SECRET` Function Secret.

## Fire-and-forget contract to helpdesk-ai-assist (Plan 04 must honor)

```http
POST /functions/v1/helpdesk-ai-assist
Authorization: Bearer ${SERVICE_KEY}
Content-Type: application/json

{ "ticket_id": "<uuid>", "message_id": "<uuid>" }
```

Plan 04 implementation MUST:
- Re-read `tickets.phi` from the DB (do NOT trust a `phi` field in the request body — `helpdesk-inbound` does not send one).
- Re-resolve BAA scope from the freshly-read ticket (T-37-03-08).
- Not block the inbound flow on its response (the call is `void fetch(...).catch(() => {})` on the inbound side).

## Phase38Event union members added (Plan 04 — do NOT re-add)

```typescript
| 'helpdesk.ticket.created'
| 'helpdesk.inbound_email.received'
| 'helpdesk.inbound_email.unknown_sender'
| 'helpdesk.attachment.scan_deferred'
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Sender lookup via `profiles.email` would have crashed at runtime**
- **Found during:** Task 1
- **Issue:** Plan 03 instructs `admin.from('profiles').select('id').eq('email', fromEmail).maybeSingle()` but the live `public.profiles` schema (migration `20261101000001_profiles_is_staff.sql`) has only `id + is_staff + created_at`. No phase has ever added an `email` column to `profiles` — email lives on `auth.users`. The query would return no rows for every sender, and every inbound email would bounce as `unknown_sender_bounced`.
- **Fix:** Replaced with `admin.auth.admin.listUsers({ email })` + exact-match lowercased filter, mirroring `clinic-invite/index.ts::emailExistsInAuth`.
- **Files modified:** `supabase/functions/helpdesk-inbound/index.ts` (resolveSenderByEmail helper)
- **Commit:** bfec40a

**2. [Rule 1 — Bug] `captureServer({ distinctId })` arg name mismatch**
- **Found during:** Task 1
- **Issue:** Plan's example uses `captureServer({ event, distinctId, properties })`. The actual `CaptureArgs` type requires `userId` (D-13 — always Supabase auth.users.id), not `distinctId`. The plan-snippet would not type-check.
- **Fix:** Used `userId` throughout. For the unknown-sender event (no sender uid available) used `userId: 'unknown_sender'` as a stable system bucket.
- **Files modified:** `supabase/functions/helpdesk-inbound/index.ts`
- **Commit:** bfec40a

**3. [Rule 2 — Critical] Reply-token case-sensitivity preservation**
- **Found during:** Task 2 (Deno test 9)
- **Issue:** Initial implementation lowercased the entire To address before regex match. Base64url tokens are case-sensitive (`A-Z`, `a-z`, `0-9`, `_`, `-`), so a uniform `.toLowerCase()` mangled valid tokens before HMAC verify. Every mixed-case token would have HMAC-failed → bounce → 100% reply-threading failure in production.
- **Fix:** Split `toEmailRaw` (case-preserved) from `toEmail` (lowercased). Match `REPLY_RE` against `toEmailRaw`. Widened the regex character class to `[A-Za-z0-9_-]` to make the intent obvious in code review (the `/i` flag would have matched too, but the explicit class catches missed code-review eyes). Loop guard + support@ comparison still use the lowercased value (RFC 5321 allows case-insensitive local-part matching on those).
- **Files modified:** `supabase/functions/helpdesk-inbound/index.ts`
- **Commit:** 111a56f

**4. [Rule 1 — Bug] Clinician role list divergence from `create_ticket_with_first_message` RPC**
- **Found during:** Task 1
- **Issue:** Plan lists clinician roles as `('clinician','owner','support_lead')`. The widget-side PHI determination in `create_ticket_with_first_message` (migration 20270707000009) uses `('owner','clinician','staff')`. Divergent role lists would mean the SAME user creating tickets via widget vs email would get different PHI flags — silent data classification bug.
- **Fix:** Aligned with the RPC's role list (`owner`, `clinician`, `staff`). If a future phase adds `support_lead` as a clinical role, BOTH sites need the change.
- **Files modified:** `supabase/functions/helpdesk-inbound/index.ts` (resolveOrgContext)
- **Commit:** bfec40a

## Threat Flags

None — surface introduced is fully in `<threat_model>`: Resend MX → Edge Fn (Svix), inbound body → DB (RLS bypass via service-role + audit trail), attachment → Storage (MIME + size + count + private bucket). The fire-and-forget call to `helpdesk-ai-assist` is a NEW network endpoint but it's same-project / server-to-server with SERVICE_KEY and re-validates inputs server-side (T-37-03-08).

## Known Stubs

None. ClamAV is explicitly deferred to v1.4 per `deferred-items.md` P0 — this is NOT a stub but a documented v1.3 mitigation (allowlist + size cap + scan_deferred audit event). The deferral is exposed in:
- `ticket_attachments.scan_status='deferred'` (DB column documents the state).
- `helpdesk.attachment.scan_deferred` PostHog event (per stored attachment, audit trail).
- `TODO [DEFERRED v1.4]: ClamAV scan` comment in `ingestAttachments` pointing to `deferred-items.md`.

## TDD Gate Compliance

Task 2 (`tdd="true"`) shipped with:
- `feat(37-03)` (bfec40a) — Edge Fn implementation (GREEN-equivalent landed first because the plan structures Task 1 before Task 2)
- `fix(37-03)` (111a56f) — case-sensitivity bug exposed by writing tests
- `test(37-03)` (1f30283) — 14 behavioural + 1 cleanup Deno test cases

The plan-level type is `execute` (not `tdd`), so the gate sequence validation `test → feat → refactor` doesn't apply at the plan level. At the task level Task 2 is satisfied: its test commit exists and all assertions pass.

## Verification

- `cd supabase/functions && deno check --import-map=import_map.json helpdesk-inbound/index.ts` — clean.
- `cd supabase/functions && deno test --allow-all --import-map=import_map.json helpdesk-inbound/index.test.ts` — **15 passed, 0 failed (16ms)**.
- `grep -c "'helpdesk.ticket.created'\|'helpdesk.inbound_email.received'\|'helpdesk.inbound_email.unknown_sender'\|'helpdesk.attachment.scan_deferred'" supabase/functions/_shared/posthog-server.ts` → `4` (Task 3 grep gate).

End-to-end smoke from real Resend webhook deferred to Plan 09 closeout (per plan's verification §4).

## Commits

| Commit  | Type     | Subject                                                                                       |
| ------- | -------- | --------------------------------------------------------------------------------------------- |
| bfec40a | feat     | helpdesk-inbound Edge Fn — Svix verify + 2-step body fetch + HMAC reply gate + 7-branch dispatcher |
| 111a56f | fix      | preserve reply-token case through To-address parsing                                          |
| 1f30283 | test     | helpdesk-inbound Deno tests — 14 cases across 7 outcome branches                              |
| 8d0008a | feat     | widen Phase38Event union with 4 helpdesk inbound event names                                  |

## Self-Check: PASSED

- All 4 created/modified files present on disk.
- All 4 commits resolvable in `git log --all`.
- Deno test suite green (15/15) on the latest HEAD.

