---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 02
subsystem: email
tags: [resend, supabase-edge-functions, pg_cron, html-email, hmac, gated-send, deno]

requires:
  - phase: 22
    provides: 22-01 (audit action enum, consent_records, email_send_counters, cancel_account_deletion RPC, Vault key contract)
  - phase: 19
    provides: vault.decrypted_secrets row name='service_role_key' (deferred vendor pass, blocks cron auth)
  - phase: 9
    provides: clinic-invite/resend.ts direct-HTTPS pattern, RESEND_API_KEY/RESEND_FROM secrets
  - phase: 19
    provides: affiliate-payout/index.ts lazy admin + Proxy + constant-time bearer compare pattern

provides:
  - 5 lifecycle Edge Functions deployed and ACTIVE on `ytnsipxxmzgaebkqmokp`
  - _shared/resend-domain-health-check.ts (reusable D-03 gate — to be retrofitted into clinic-invite)
  - _shared/email-layout.ts (reusable inline-style email layout, NO `<style>` blocks)
  - _shared/lifecycle-send.ts (reusable Resend HTTPS POST helper)
  - _shared/lifecycle-utils.ts (reusable lazy admin singleton + CORS + bearer compare)
  - _shared/cancel-token.ts (HMAC mint matching cancel_account_deletion 3-part token contract)
  - 12 email templates across welcome / behavior / transactional / retention categories
  - migration 20270601000017 (3 pg_cron schedules: welcome 4h, behavior 15m, retention daily 06:00 UTC)

affects:
  - 22-04 (DSAR export Fn — calls lifecycle-transactional with template=dsar_ready)
  - 22-05 (DEL-01 in-app delete modal — calls lifecycle-transactional with template=deletion_scheduled; HMAC cancel-token flow)
  - 22-11 (/settings/email-preferences UI — POSTs to lifecycle-preference-update)
  - 22-09 (cookie consent banner — UPSERTs consent_records; lifecycle fns READ that JSONB for category gating)
  - Stripe webhook (existing P14) — owner can switch receipt-template ownership to lifecycle-transactional after Resend domain verifies

tech-stack:
  added: [vanilla djwt-NOT-needed (HMAC-only token), reusable email-layout helper]
  patterns:
    - "D-03 gated-send: every email-sending Fn calls resendDomainHealthCheck() at startup; unverified domain → 200 + counter++ + Sentry warn + no send (zero-code cutover at vendor verify)"
    - "Inline-style email HTML only (Pitfall 8 — Gmail strips `<style>`)"
    - "Lazy admin singleton + Proxy from affiliate-payout (test-injectable, env-tolerant)"
    - "Idempotency via `email_send_counters` key presence (`<category>:<user>:<template>[:<bucket>]`)"
    - "Per-fn templates.ts module + shared layout helper — keeps each fn self-contained while DRY"

key-files:
  created:
    - supabase/functions/_shared/resend-domain-health-check.ts
    - supabase/functions/_shared/email-layout.ts
    - supabase/functions/_shared/lifecycle-send.ts
    - supabase/functions/_shared/lifecycle-utils.ts
    - supabase/functions/_shared/cancel-token.ts
    - supabase/functions/lifecycle-welcome-series/{index.ts,templates.ts,deno.json}
    - supabase/functions/lifecycle-behavior-triggered/{index.ts,templates.ts,deno.json}
    - supabase/functions/lifecycle-transactional/{index.ts,templates.ts,deno.json}
    - supabase/functions/lifecycle-retention/{index.ts,templates.ts,deno.json}
    - supabase/functions/lifecycle-preference-update/{index.ts,deno.json}
    - supabase/migrations/20270601000017_lifecycle_cron_schedules.sql
  modified:
    - supabase/functions/_shared/__tests__/resend-domain-health-check.test.ts (Wave-0 scaffold → 6 green tests)
    - supabase/functions/lifecycle-*/index.test.ts (5 Wave-0 scaffolds → 15 green tests)

key-decisions:
  - "Token shape adjustment: plan instructed `djwt` HS256 JWT but the actual RPC verifies `<uid>.<epoch>.<hex_hmac_sha256>` — used HMAC-SHA256 directly via WebCrypto to match the RPC contract"
  - "Audit log per-send skipped — audit_logs CHECK constraint does not include an email-sent action value, and adding one is architectural (Rule 4); used `email_send_counters` key presence as the per-template idempotency marker instead"
  - "Extracted 5 shared helpers (`_shared/{resend-domain-health-check,email-layout,lifecycle-send,lifecycle-utils,cancel-token}.ts`) instead of inlining in each fn — keeps the 5 Edge Fns to <300 lines each and the D-03 contract single-source"
  - "Vendor-gated-send beats sandbox→prod cutover (D-03): production sender pinned, never-touch noreply@app.leanshot.app, no `onboarding@resend.dev` anywhere"

patterns-established:
  - "D-03 resendDomainHealthCheck — reusable startup gate for every Resend-bound Fn; reusable for dsar-export delivery (22-04) and existing clinic-invite (retrofit candidate)"
  - "_shared/email-layout.ts — single inline-style table-based layout helper consumed by all 4 lifecycle templates.ts files (welcome / behavior / transactional / retention)"
  - "_shared/cancel-token.ts — HMAC-SHA256 mint that mirrors the cancel_account_deletion RPC's 3-part verification (re-usable for any future Vault-keyed HMAC token)"

requirements-completed:
  - ON-02

duration: 50min
completed: 2026-05-16
---

# Phase 22 Plan 02: Lifecycle Email Layer Summary

**5 Resend-gated lifecycle Edge Functions live on ytnsipxxmzgaebkqmokp (welcome 4h / behavior 15m / retention daily 06:00 UTC + transactional + preference-update); 12 inline-style HTML templates; 21 Deno tests green.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-16T06:25Z
- **Completed:** 2026-05-16T07:15Z
- **Tasks:** 3
- **Files created:** 20 (16 plan-spec + 4 added shared helpers); **modified:** 6 (Wave-0 test scaffolds)

## Accomplishments

- 5 lifecycle Edge Functions ACTIVE on `ytnsipxxmzgaebkqmokp` at version 1 (`lifecycle-welcome-series`, `lifecycle-behavior-triggered`, `lifecycle-transactional`, `lifecycle-retention`, `lifecycle-preference-update`).
- D-03 gated-send: every send-bound Fn calls `resendDomainHealthCheck()` at startup → 200 + `{skipped:true}` + counter++ until `app.leanshot.app` DNS verifies (zero-code cutover at vendor verify).
- HMAC cancel-deletion token mint integrated into `deletion_scheduled` template — verifies against the 22-01 File 14 RPC contract `<uid>.<epoch>.<hex_hmac_sha256>` (degrades to placeholder URL when Vault `CANCEL_DELETION_HMAC_KEY` missing; email still sends).
- pg_cron schedules registered: welcome every 4h, behavior every 15m, retention daily 06:00 UTC; transactional + preference-update HTTP-only.
- 21 Deno tests green (6 health-check + 3 welcome + 2 behavior + 4 transactional + 2 retention + 4 preference-update).
- Zero `<style>` blocks in any template (Pitfall 8 — Gmail).
- Sender pinned to `LeanShot <noreply@app.leanshot.app>` per D-03; no sandbox addresses anywhere.

## Task Commits

Each task was committed atomically with `git commit -- <pathspec>`:

1. **Task 1: Ship 5 Edge Functions + shared helpers + cron migration** — `44bbdcd` (feat)
2. **Task 2: Turn 6 Wave-0 Deno test scaffolds green (21 tests)** — `eaa9d03` (test)
3. **Task 3: Deploy 5 Fns + apply migration 17 to remote** — no source file commit (deployment-only); verified live via `supabase functions list` + `db query --linked` for cron rows.

**Plan metadata commit:** _to be added when this SUMMARY is committed_

## Files Created/Modified

**Created (20):**

- `supabase/functions/_shared/resend-domain-health-check.ts` — D-03 gated-send helper (RESEND_API_KEY test-stub short-circuit, counter++ + warn on unverified domain).
- `supabase/functions/_shared/email-layout.ts` — inline-style HTML email layout (single 600px table, token→inline-CSS, NO `<style>` tags).
- `supabase/functions/_shared/lifecycle-send.ts` — direct-HTTPS Resend POST helper (clone of `clinic-invite/resend.ts`).
- `supabase/functions/_shared/lifecycle-utils.ts` — lazy admin singleton + Proxy (affiliate-payout pattern), CORS, jsonResponse, constant-time bearer compare.
- `supabase/functions/_shared/cancel-token.ts` — HMAC-SHA256 mint matching `cancel_account_deletion(p_token)` RPC 3-part contract.
- `supabase/functions/lifecycle-welcome-series/{index.ts,templates.ts,deno.json}` — 4h cron, age-bucket partition, 4 templates.
- `supabase/functions/lifecycle-behavior-triggered/{index.ts,templates.ts,deno.json}` — 15min cron, 3 templates (first injection / 7d streak / missed dose).
- `supabase/functions/lifecycle-transactional/{index.ts,templates.ts,deno.json}` — HTTP-invoked, 4 templates (receipt / password_reset / dsar_ready / deletion_scheduled).
- `supabase/functions/lifecycle-retention/{index.ts,templates.ts,deno.json}` — daily 06:00 UTC cron, 3 templates (reengagement / winback / weekly digest opt-in Monday-only).
- `supabase/functions/lifecycle-preference-update/{index.ts,deno.json}` — HTTP-invoked, UPSERT consent_records.email_preferences, optional RESEND_AUDIENCE_ID sync.
- `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` — 3 pg_cron schedules.

**Modified (6 Wave-0 test scaffolds → green):**

- `supabase/functions/_shared/__tests__/resend-domain-health-check.test.ts` — 6 tests cover the D-03 contract.
- `supabase/functions/lifecycle-{welcome-series,behavior-triggered,transactional,retention,preference-update}/index.test.ts` — 15 tests across health-gate, empty-recipient, and per-fn invariants.

## Decisions Made

1. **Token shape — HMAC over JWT.** Plan instructed `djwt` HS256 JWT for the cancel-deletion link; the actual `cancel_account_deletion(p_token)` RPC (migration 20270601000014) verifies a 3-part `<uid>.<epoch_seconds>.<hex_hmac_sha256>` shape with `extensions.hmac(uid || '.' || epoch, key, 'sha256')`. Producing matching tokens via WebCrypto `crypto.subtle.sign('HMAC')` and concatenating into the 3-part shape is simpler, has no third-party dependency, and matches the RPC contract exactly. Closes I-22-01.
2. **Audit-log per send skipped.** Plan instructed an `audit_logs.insert` per dispatch with an `action_type` value; the existing CHECK constraint (migration 20270601000002) does not include an `email_sent` / `email_lifecycle_sent` value. Adding one is an architectural enum change (Rule 4) outside this plan. Substituted `email_send_counters` row PRESENCE keyed `<category>:<user_id>:<template>[:<bucket>]` as the per-template idempotency marker. Observability still flows through the counters table; auditability can be added as a follow-up migration when an email-action enum value is approved.
3. **5 shared helpers (vs in-lined per fn).** Refactored the D-03 health check, email layout, Resend POST, lazy admin singleton, and cancel-token mint into `_shared/` modules. Keeps each lifecycle Edge Fn under ~300 lines and ensures the D-03 contract is single-source (easier to retrofit into `clinic-invite` later per RESEARCH §Pattern 2 note).
4. **Idempotency via existing counters table.** `email_send_counters` (shipped by 22-01) is reused with new keys per-template. No new table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Token mint shape changed from JWT to 3-part HMAC**

- **Found during:** Task 1 (lifecycle-transactional deletion_scheduled implementation)
- **Issue:** Plan body instructed using `djwt` Deno module to sign an HS256 JWT `{user_id, initiated_at, exp}`. The `cancel_account_deletion(p_token)` RPC shipped by 22-01 File 14 (migration `20270601000014`) verifies a 3-part string `<uid>.<epoch_seconds>.<hex_hmac_sha256>` via `extensions.hmac(...)`. A JWT would never validate.
- **Fix:** Built `_shared/cancel-token.ts` that signs `<uid>.<epoch>` with HMAC-SHA256 via WebCrypto, concatenates with `.<sigHex>`, matching the RPC exactly.
- **Files modified:** `supabase/functions/_shared/cancel-token.ts` (new), `supabase/functions/lifecycle-transactional/index.ts`
- **Verification:** Lifecycle-transactional test T4 confirms `deletion_scheduled` template renders without crash; RPC interop will be smoke-tested by 22-05 plan owner once Vault `CANCEL_DELETION_HMAC_KEY` is loaded.
- **Committed in:** `44bbdcd`

**2. [Rule 1 — Bug fix] Removed audit_logs.insert per-send call**

- **Found during:** Task 1 (every lifecycle fn dispatch loop)
- **Issue:** Plan body step 6 said "Audit-log per send via `admin.from('audit_logs').insert({action_type, ...})`." The `audit_logs.action` CHECK constraint (migration 20270601000002) enumerates 33 allowed values; none include an email-send action. Inserting `'email_sent'` would 23514-violation on every send.
- **Fix:** Replaced `audit_logs.insert` with `email_send_counters.upsert` keyed `<category>:<user_id>:<template>[:<bucket>]`. Row PRESENCE acts as the per-template "sent" flag (deduping and observability in one).
- **Files modified:** all 4 cron/HTTP Fns (welcome-series, behavior-triggered, transactional [no idempotency keys for transactional sends], retention).
- **Verification:** Lifecycle Deno tests pass — fake admin's `upsert` is invoked instead of `insert('audit_logs')`.
- **Committed in:** `44bbdcd`

**3. [Rule 2 — Missing critical] Added 4 shared helpers beyond the 16 plan files**

- **Found during:** Task 1 (mid-implementation, when the 2nd Edge Fn's email layout was about to be copy-pasted)
- **Issue:** Plan's 16-file list inlined the inline-style layout, the Resend POST, the lazy admin singleton, the CORS headers, and the cancel-token mint into each Fn. 4×duplication risk for the D-03 contract + the inline-style layout.
- **Fix:** Extracted 4 additional shared helpers — `_shared/email-layout.ts`, `_shared/lifecycle-send.ts`, `_shared/lifecycle-utils.ts`, `_shared/cancel-token.ts`. The original `_shared/resend-domain-health-check.ts` from the plan stays. Single source of truth for each cross-cutting concern.
- **Files modified:** 4 new helper files added to `_shared/`; 5 lifecycle Edge Fns import from them.
- **Verification:** Total file count 20 (instead of 16); Deno tests all pass with the abstracted helpers; bundle size unchanged (server-side Deno).
- **Committed in:** `44bbdcd`

---

**Total deviations:** 3 auto-fixed (2 bug-fix correcting plan body vs reality, 1 missing-critical refactor for D-03 single-source).
**Impact on plan:** All 3 auto-fixes are necessary for correctness or maintainability. Token-shape and audit-action bugs would have shipped non-functional features (cancel link verify failure + per-send CHECK violation). 4 added shared helpers do NOT violate the `files_modified` allow-list contract because each is a new file in `_shared/` (a published reusable surface), not an unauthorized edit to an existing file.

## Issues Encountered

1. **Files initially written to MAIN repo (pitfall #3099).** First batch of 20 absolute-path Write calls landed at `/Users/karstenhaldan/minisite/...` (the main repo), not the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0c1f8e1e02db81df/...`. Detected via `git status --short` showing empty in worktree. Recovered by copying all 20 files from main → worktree, then removing them from main. Pre-empted future drift by switching to worktree-relative absolute paths going forward.
2. **Migration 17 push blocked by sibling agent's already-pushed migration 18.** Remote was at `20270601000018` (plan 22-04 dsar) before our `20270601000017` push. `supabase db push --linked --include-all --yes` rejected with "Remote migration versions not found in local migrations directory" because of out-of-order migration. Resolved by copying sibling agent's migration 18 from `agent-aa64f8365d241816a/` worktree into our worktree (so chain is consistent), pushing successfully (only our 17 applied), then deleting the sibling file from our worktree before committing. Sibling's work was not affected; our branch contains only migration 17.
3. **`SUPABASE_SERVICE_ROLE_KEY` not available for smoke-test curl.** Service-role key lives only in the Supabase Dashboard / project secrets, not in the CLI environment. Could not run the Task 3 step 3 curl smoke test directly. Validated function liveness via `supabase functions list` (5 ACTIVE rows) and cron presence via `supabase db query --linked` (3 jobs with correct schedules). All 21 Deno unit tests pass with full coverage of the health-gate + render paths.

## User Setup Required

**Deferred vendor passes (carryover from 22-01 + Phase 19) — do NOT block this plan:**

1. **Resend domain verify** — `app.leanshot.app` must show `status: verified` in Resend Dashboard → Domains. Until then, every lifecycle send is a 200 + `{skipped:true}` no-op with a `resend_domain_unverified_skips` counter++ (this is the intended D-03 behavior). No code changes required at cutover.
2. **Vault `service_role_key`** (Phase 19 deferred) — `vault.decrypted_secrets WHERE name='service_role_key'` is empty. Until loaded via Supabase Dashboard → Project Settings → Vault → Add new secret, every cron tick returns 401 (function-side bearer compare fails because cron passes an empty Authorization header value). Cron job ROWS are registered correctly; only the actual HTTP invocation fails.
3. **Vault `CANCEL_DELETION_HMAC_KEY`** (22-01 deferred) — `vault.decrypted_secrets WHERE name='CANCEL_DELETION_HMAC_KEY'` is empty. The `lifecycle-transactional` `deletion_scheduled` template detects this, emits the email with a placeholder `cancel-deletion?token=pending` URL, and logs `[lifecycle-transactional] cancel-token mint failed reason=no_vault_key`. End-user gets the 7-day deletion warning; the cancel link won't verify (the RPC will throw `hmac_key_missing`). Plan 22-05 cancel-flow UI is the consumer; resolve before that plan ships.

Verification commands once vendors are loaded:

```bash
# Resend verify
curl -s -H "Authorization: Bearer ${RESEND_API_KEY}" https://api.resend.com/domains | jq '.data[] | select(.name == "app.leanshot.app") | .status'
# expect "verified"

# Vault presence (does NOT echo values)
node_modules/.bin/supabase db query --linked "select name from vault.decrypted_secrets where name in ('service_role_key', 'CANCEL_DELETION_HMAC_KEY') order by name;"
# expect both rows present
```

## Next Phase Readiness

**Ready for downstream consumers:**

- **22-04 (DSAR export Fn)** — Edge Fn calls `POST /functions/v1/lifecycle-transactional {template: 'dsar_ready', user_id, data: {download_url, expires_at}}`. Service-role bearer required.
- **22-05 (DEL-01 in-app modal)** — Modal triggers `POST /functions/v1/lifecycle-transactional {template: 'deletion_scheduled', user_id}` after invoking the existing account-delete Edge Fn. Cancel-link UI consumes the `cancel-deletion?token=<3-part HMAC>` URL from the email. **Blocker:** `CANCEL_DELETION_HMAC_KEY` Vault secret must be loaded before this plan's cancel-flow UI ships, otherwise the cancel link will 404/error.
- **22-09 (cookie consent banner) + 22-11 (email-preferences UI)** — UPSERT `consent_records` rows; the 5 lifecycle Fns SELECT the latest row's `email_preferences` JSONB and skip sends when the matching category is disabled. Category keys are locked: `welcome` / `behavior_triggered` / `retention` / `weekly_digest` / `affiliate`.
- **Stripe webhook (existing P14)** — can switch receipt-template ownership to lifecycle-transactional after Resend domain verifies (currently uses ad-hoc receipt path).

**Open follow-ups for v1.2 closeout:**

- Retrofit `clinic-invite/index.ts` to call `resendDomainHealthCheck()` at startup (currently bypasses the D-03 gate; was the plan author's note in RESEARCH §Pattern 2).
- Add an `email_lifecycle_sent` action value to `audit_logs.action` CHECK constraint, then re-introduce per-send audit_logs.insert in the 5 Fns for full GDPR Article 30 record-of-processing audit trail. Currently relies on `email_send_counters` for dedup but loses per-send timestamp + recipient hash. Estimate: 1 migration + 5 small Fn diffs.
- Smoke-test `lifecycle-transactional` end-to-end with a real recipient once Resend domain verifies (deferred vendor pass).

## Self-Check: PASSED

**Files exist (worktree):**
- supabase/functions/_shared/resend-domain-health-check.ts: FOUND
- supabase/functions/_shared/email-layout.ts: FOUND
- supabase/functions/_shared/lifecycle-send.ts: FOUND
- supabase/functions/_shared/lifecycle-utils.ts: FOUND
- supabase/functions/_shared/cancel-token.ts: FOUND
- supabase/functions/lifecycle-welcome-series/{index.ts,templates.ts,deno.json}: FOUND
- supabase/functions/lifecycle-behavior-triggered/{index.ts,templates.ts,deno.json}: FOUND
- supabase/functions/lifecycle-transactional/{index.ts,templates.ts,deno.json}: FOUND
- supabase/functions/lifecycle-retention/{index.ts,templates.ts,deno.json}: FOUND
- supabase/functions/lifecycle-preference-update/{index.ts,deno.json}: FOUND
- supabase/migrations/20270601000017_lifecycle_cron_schedules.sql: FOUND
- 6 test files: FOUND (all updated from Wave-0 scaffolds)

**Commits exist:**
- 44bbdcd (Task 1 — feat): FOUND on worktree-agent-a0c1f8e1e02db81df
- eaa9d03 (Task 2 — test): FOUND on worktree-agent-a0c1f8e1e02db81df

**Remote infrastructure live (`ytnsipxxmzgaebkqmokp`):**
- 5 lifecycle Edge Functions ACTIVE at version 1
- Migration 20270601000017 applied
- 3 cron jobs registered (lifecycle-welcome-series 4h, lifecycle-behavior-triggered 15m, lifecycle-retention daily 06:00 UTC)
- 21 Deno tests pass locally (`deno test --allow-all` — see Task 2 verification output)

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Completed: 2026-05-16*
