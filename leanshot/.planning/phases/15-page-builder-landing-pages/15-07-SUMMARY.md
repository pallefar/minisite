---
phase: 15-page-builder-landing-pages
plan: 07
subsystem: page-builder
tags: [page-builder, edge-function, lead-capture, native-form, honeypot, rate-limit, resend, tdd]

requires:
  - phase: 15-page-builder-landing-pages
    plan: 01
    provides: public.leads table (id, page_id, email, name, extra_fields jsonb, ip_hash, honeypot_flagged, created_at) + RLS denying public SELECT (only is_staff reads, only service_role inserts)
  - phase: 15-page-builder-landing-pages
    plan: 03
    provides: BlockType union ('lead-form' literal), BlockNode + BlockStyle contracts, page-render/render.ts renderBlock switch + escapeHtml/safeHref/blockWrapperStyle/hideOnMobileClass helpers — consumed by the new renderLeadForm wrapper
  - phase: 15-page-builder-landing-pages
    plan: 04
    provides: PropertyPanel GenericContentFields renderer (text / textarea / boolean field kinds already supported — no new arms needed)
  - phase: 15-page-builder-landing-pages
    plan: 05
    provides: PROPERTY_CONFIGS flat registry (additive merge for the 'lead-form' key) + block-style-helpers.ts (backgroundToneClass + paddingForDensity)
  - phase: 15-page-builder-landing-pages
    plan: 06
    provides: render.ts case-grouping seam below the embed renderers — the lead-form case lands directly below 15-06's three embed branches; render.test.ts forward-contract 'unimplemented' literal now pivots to a synthetic literal since the 12-type BlockType union is fully covered

provides:
  - "leanshot/src/lib/page-builder/lead-form-content.ts — LeadFormContent type + DEFAULT_LEAD_FORM_CONTENT factory (heading / description / buttonLabel / successMessage / collectName)"
  - "leanshot/src/components/admin/pages/blocks/LeadFormBlock.tsx — editor-side preview component; token-bounded (no raw hex); reuses backgroundToneClass + paddingForDensity; renders email <label>+<input type=email>, optional name <label>+<input>, and a disabled submit button (real form is the renderer's job)"
  - "leanshot/src/components/admin/pages/editor/property-configs.ts — adds the 'lead-form' entry (heading/text, description/textarea, buttonLabel/text, successMessage/textarea, collectName/boolean) to the flat PROPERTY_CONFIGS map"
  - "supabase/functions/page-render/render.ts — adds the case 'lead-form' branch to renderBlock(). Emits a semantic <form> + offscreen-but-in-DOM honeypot (position:absolute;left:-9999px, NOT display:none — UI-SPEC), data-lead-capture-url + data-success-message contract attrs, role=status + role=alert regions, ≤25-line inline submit script binding fetch POST + 429/error/success handling"
  - "supabase/functions/page-render/render.test.ts — 4 new tests for the lead-form branch (markup contract, conditional name field, XSS escape via escapeHtml). Forward-contract 'unimplemented' test pivoted from 'lead-form' (now implemented) to a synthetic 'not-yet-implemented' literal."
  - "supabase/functions/lead-capture/index.ts — public Edge Function (verify_jwt=false). handleSubmit: parses JSON, honeypot-check-first, email regex validation, SHA-256 IP hash, Postgres-counter rate-limit (5/15 min), optional page_slug→page_id resolve, parameterized service-role insert into leads, optional non-blocking Resend dispatch. __internal.setAdminClient seam for tests."
  - "supabase/functions/lead-capture/rate-limit.ts — checkLeadRateLimit helper; SELECT count(*) FROM leads WHERE ip_hash=$1 AND created_at > now()-interval '15 minutes' via the service-role admin client; fail-OPEN posture"
  - "supabase/functions/lead-capture/resend.ts — sendLeadNotification helper (direct https POST, no SDK); CI test-stub bypass; LEAD_NOTIFY_TO env-gated (notification optional per D-12); visitor input HTML-escaped before interpolation (T-15-LF-04)"
  - "supabase/functions/lead-capture/cors.ts — '*' origin, POST/OPTIONS, NO credentials header (public form POST)"
  - "supabase/functions/lead-capture/deno.json — byte-identical to stripe-checkout/deno.json (same task/lint/fmt config)"
  - "supabase/functions/lead-capture/index.test.ts — 9 Deno tests covering happy path, honeypot, rate-limit, validation, CORS, Resend CI stub, IP parsing"
  - "supabase/config.toml — adds [functions.lead-capture] verify_jwt = false block (public form POST)"

affects: [15-09 (templates wire lead-form into lead-magnet template), 15-10 (pricing-checkout NOT affected — separate path)]

tech-stack:
  added: []
  patterns:
    - "Honeypot-first handler ordering: cheapest spam-guard runs before any DB I/O. 200 body byte-identical to success path so bots learn nothing. The honeypot-flagged row writes for staff spam analytics but skips Resend dispatch."
    - "Postgres-counter rate-limit on the leads table itself — no dedicated rate-limit table. SELECT count(*) keyed on (ip_hash, created_at > now()-15min) is the limiter; honeypot-flagged rows still count (a bot ramming should be slowed)."
    - "Test seam via __internal.setAdminClient — module-level admin client handle is mutable so the Deno suite can inject a fake supabase-js chain (.from('leads').select(...).eq(...).gte(...) → {count}; .from('leads').insert(...) → ok). No port binding, no live DB."
    - "Resend recipient gating — LEAD_NOTIFY_TO env-absent → SKIP dispatch entirely (D-12 'optional Resend notification'). LEAD_NOTIFY_TO set + RESEND_API_KEY='test-stub' → return {ok:true, stubbed:true} without HTTPS. LEAD_NOTIFY_TO set + RESEND_API_KEY absent → {ok:false, error:'no_api_key'} but caller still 200s."
    - "Honeypot DOM presence (position:absolute;left:-9999px + aria-hidden + tabindex=-1 + autocomplete=off) — NOT display:none. The field MUST remain in submitted FormData so the server can detect the bot fill. Per UI-SPEC."
    - "Inline submit script — ≤25 lines, no external deps, IIFE-bound via form's data-lead-form marker. Idempotent (re-injection no-ops via __lcBound flag). Handles 429 with rate-limit copy from UI-SPEC, network error with retry copy, validation error with email-regex copy. Published page ships zero external JS (D-17 — inline only)."

key-files:
  created:
    - leanshot/src/lib/page-builder/lead-form-content.ts
    - leanshot/src/components/admin/pages/blocks/LeadFormBlock.tsx
    - leanshot/src/components/admin/pages/blocks/LeadFormBlock.test.tsx
    - supabase/functions/lead-capture/index.ts
    - supabase/functions/lead-capture/index.test.ts
    - supabase/functions/lead-capture/cors.ts
    - supabase/functions/lead-capture/rate-limit.ts
    - supabase/functions/lead-capture/resend.ts
    - supabase/functions/lead-capture/deno.json
  modified:
    - supabase/functions/page-render/render.ts
    - supabase/functions/page-render/render.test.ts
    - leanshot/src/components/admin/pages/editor/property-configs.ts
    - supabase/config.toml

key-decisions:
  - "Honeypot insert still writes a row (with honeypot_flagged:true) rather than dropping silently — gives staff coarse spam analytics without sacrificing the byte-identical 200 contract. The flagged row count is intentionally part of the rate-limit denominator so a bot can't burn through the limit using only honeypot submissions."
  - "Postgres-counter rate-limit (Pattern 6 in 15-RESEARCH) chosen over a dedicated rate_limit_buckets table — RESEARCH A4 says avoid Upstash for this surface; reusing the leads table itself as the counter keeps the function scope to one writable table."
  - "Per-IP rate-limit threshold is 5 submissions in 15 min (6th → 429). Locks out abuse without inconveniencing a real visitor who mistyped their email twice."
  - "Resend `LEAD_NOTIFY_TO` env-gated — when absent the function returns 200 with no notification attempt. Lets the platform run end-to-end without a Resend domain verified (Phase 12 deferred Resend DNS to a vendor checkpoint)."
  - "Visitor leadEmail / leadName / pageSlug are explicitly escapeHtml'd before interpolation into the staff notification HTML (T-15-LF-04). A bot submitting `<script>` in the name field cannot inject into the operator's inbox."
  - "Forward-contract test in render.test.ts pivoted from `'lead-form'` (15-06's pending literal) to a synthetic `'not-yet-implemented'` literal (cast through `unknown`). The BlockType union is now fully covered by 15-03/05/06/07; the default fall-through contract is preserved for any future BlockType expansion."
  - "Renderer emits a `<script>` for the inline submit handler — kept ≤25 LOC, no external deps, IIFE-scoped, idempotent. D-17 says zero EXTERNAL JS — inline necessary JS is allowed and was anticipated in the plan's `<action>` ('emit a minimal <script> inside the branch')."
  - "Honeypot field is offscreen via `position:absolute;left:-9999px` + `aria-hidden='true'` + `tabindex='-1'` + `autocomplete='off'` — NOT `display:none`. UI-SPEC explicitly calls out that the field must remain in FormData so the server can detect the bot fill (display:none would still submit, but the offscreen pattern is the project precedent)."
  - "deno.json is byte-identical to stripe-checkout/deno.json (asserted by `diff`). Same test/lint/fmt config; reuses the function-folder import_map pattern."
  - "No new field kinds needed in PROPERTY_CONFIGS — 15-06 already added 'boolean' (for honeypot toggles) and 'number'; 'text' / 'textarea' suffice for the rest. The new 'lead-form' entry is a pure-additive merge into the flat map."

metrics:
  duration: ~14 minutes
  tasks_completed: 3
  completed_date: 2026-05-15

requirements-completed: [PAGE-03, PAGE-04]
---

# Phase 15 Plan 07: Native Lead Form Block + lead-capture Edge Function — Summary

**Ship the 12th and final block type (`lead-form`) end-to-end: editor preview component + property-config entry + `renderBlock()` <form> branch (with offscreen-but-in-DOM honeypot + inline submit script) + new public `lead-capture` Edge Function (honeypot-first, per-IP rate-limited, service-role leads insert, optional Resend notification), all gated by `verify_jwt = false` in `config.toml`.**

## One-liner

Token-bounded LeadFormBlock editor preview (no raw hex, no submit handler), a flat-map `'lead-form'` PROPERTY_CONFIGS entry (heading/description/buttonLabel/successMessage/collectName), one new `renderBlock()` branch emitting a semantic `<form>` + offscreen honeypot + role=status/alert regions + ≤25-line inline submit script, and a new five-source-file `lead-capture` Edge Function that honeypot-checks first (200 byte-identical), email-regex-validates, SHA-256-IP-hashes, Postgres-counter rate-limits at 5-per-15-min, service-role-inserts into `public.leads`, and optionally fires an escaped Resend notification gated by `LEAD_NOTIFY_TO` — all backed by 9 passing Deno tests + 4 passing renderer Deno tests + 3 passing vitest cases.

## Tasks Completed

| # | Name | Commit(s) | Files |
|---|------|-----------|-------|
| 0 | Test scaffolds for LeadFormBlock + lead-capture Edge Function | `430c5c9` | `leanshot/src/components/admin/pages/blocks/LeadFormBlock.test.tsx`, `supabase/functions/lead-capture/{index.test.ts,cors.ts}` |
| 1 | LeadFormBlock + property-config + lead-form renderBlock branch (TDD) | `234665b` (RED) + `6e17533` (GREEN) | `leanshot/src/lib/page-builder/lead-form-content.ts`, `leanshot/src/components/admin/pages/blocks/LeadFormBlock.tsx`, `leanshot/src/components/admin/pages/editor/property-configs.ts`, `supabase/functions/page-render/render.ts`, `…/render.test.ts` |
| 2 | lead-capture Edge Function — validation, honeypot, rate-limit, leads insert, optional Resend + config.toml | `ce95a61` | `supabase/functions/lead-capture/{index.ts,rate-limit.ts,resend.ts,deno.json}`, `supabase/config.toml` |

## Verification Results

| Gate | Result |
|------|--------|
| `cd supabase/functions/lead-capture && deno test --allow-all` | **9/9 pass** (CORS, happy path, honeypot, rate-limit, missing/invalid email, bad json, Resend CI stub, IP parsing) |
| `cd supabase/functions/page-render && deno test render.test.ts --allow-all` | **43/43 pass** (39 prior + 4 new lead-form tests) |
| `cd leanshot && npx vitest run src/components/admin/pages/blocks/LeadFormBlock.test.tsx` | **3/3 pass** (heading+button, conditional name, email `<label>`) |
| `cd leanshot && npx vitest run` (full suite) | **925 pass / 39 skipped / 0 failed** (81 test files) |
| `cd leanshot && npx tsc -b --noEmit` | clean (strict TS) |
| `cd leanshot && npx eslint <plan files>` | 0 errors, 0 warnings |
| `cd leanshot && npm run build` | succeeds in 3.07s |
| `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh` | exits 0; `index 14.56 kB gz` (ceiling 50 kB); `admin-bundle 6.30 kB gz` (ceiling 60 kB); `page-builder-runtime 1.19 kB gz` (ceiling 25 kB); `dnd-kit index-leak invariant OK` |
| `grep -c "case 'lead-form'" supabase/functions/page-render/render.ts` | **1** (single branch added) |
| `grep -v '^ *//' supabase/functions/page-render/render.ts \| grep -c 'name="website"'` | **1** (honeypot present) |
| `grep -v '^ *//' supabase/functions/page-render/render.ts \| grep -c 'type="email"'` | **1** (email field present) |
| `grep -cE "\.from\(['\"]leads['\"]\)\.insert" supabase/functions/lead-capture/index.ts` | **2** (honeypot-flagged insert + real-lead insert) |
| `grep -c "honeypot" supabase/functions/lead-capture/index.ts` | **11** (extensively documented + checked) |
| `grep -cE "15 minutes\|15 \\* 60\|RATE_LIMIT_WINDOW_MS" supabase/functions/lead-capture/rate-limit.ts` | **4** (window threshold + constant + docblock) |
| `grep -c "test-stub" supabase/functions/lead-capture/resend.ts` | **2** (CI bypass + comment) |
| `grep -c "api.resend.com" supabase/functions/lead-capture/resend.ts` | **2** (fetch URL + docblock) |
| `grep -cE "^import .* from ['\"]resend['\"]" supabase/functions/lead-capture/resend.ts` | **0** (no bare specifier — Pitfall 8) |
| `grep -cE "escapeHtml\|escape" supabase/functions/lead-capture/resend.ts` | **7** (T-15-LF-04 user-input escape) |
| `grep -A1 "\[functions.lead-capture\]" supabase/config.toml \| grep -c "verify_jwt = false"` | **1** (block-specific check; total `[functions.*]` count is non-deterministic under parallel Wave 3 execution) |
| `diff stripe-checkout/deno.json lead-capture/deno.json` | byte-identical |
| `grep -c "export const __internal" supabase/functions/lead-capture/index.ts` | **1** (test seam present) |
| `[ -f .../property-configs.ts ] && [ ! -d .../property-configs ]` | flat file, not directory ✓ |
| `grep -cE '#[0-9a-fA-F]{3,6}' …/LeadFormBlock.tsx` | **0** (no raw hex — D-05) |

## Per-Branch Visual Contract Highlights

### `renderLeadForm` (Deno) — emits the public `<form>`

`<section class="block block-lead-form" style="background:var(--color-bg);padding-top:64px;padding-bottom:64px;text-align:center;">` wraps a `<form max-width:480px novalidate data-lead-form="1" data-lead-capture-url="/functions/v1/lead-capture/submit" data-success-message="…">`. Inside:

- `<h2>` heading (Geist 22px semibold, line-height 1.3).
- Optional `<p>` description (16px, line-height 1.55).
- Optional `<label for="lead-{id}-name">Name</label><input>` (when `collectName=true`).
- `<label for="lead-{id}-email">Email</label><input type="email" name="email" required placeholder="your@email.com" autocomplete="email">`.
- HONEYPOT wrapper: `<div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">` containing a `<label>` + `<input id="lead-{id}-website" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">`.
- `<button type="submit">` styled with `--color-primary` / `--color-primary-foreground`.
- `<div id="lead-{id}-success" data-lead-success="1" role="status" aria-live="polite" hidden>` — success live region.
- `<div id="lead-{id}-error" data-lead-error="1" role="alert" aria-live="assertive" hidden>` — error live region.

Inline submit script (≤25 LOC): IIFE-bound by `data-lead-form` + `data-lead-capture-url`; on submit, prevents default, serializes FormData → JSON, POSTs to the capture URL, hides the form on 200 + writes the success message, shows the error region with UI-SPEC copy on 429 (`"Too many submissions…"`), 4xx (`"Please enter a valid email address."`), or network failure (`"Something went wrong. Please try again."`). Idempotent via `__lcBound` flag.

### `LeadFormBlock.tsx` (editor preview)

Same outer styling as the renderer (backgroundToneClass + paddingForDensity). The editor preview's inputs are `readOnly` and the submit button is `disabled` — interaction belongs to the rendered page, not the editor.

### `lead-capture/index.ts` handler ordering

1. **JSON parse** — `400 bad_json` on failure.
2. **Honeypot FIRST** — non-empty `website` → 200 with body `{ok: true}`; honeypot-flagged row inserted for spam analytics (best-effort; insert failure does NOT change the visible 200); Resend SKIPPED.
3. **Email regex** — `400 missing_email` / `400 invalid_email`.
4. **SHA-256 IP hash** — never stores raw IP.
5. **Rate-limit** — `429 rate_limited` if ≥5 in 15 min (fail-OPEN inside helper).
6. **page_slug → page_id resolve** — best-effort; null on miss.
7. **Service-role insert into `leads`** — parameterized; `500 internal_error` on DB error.
8. **Optional Resend** — failure logged, response still 200.
9. **`200 { ok: true }`**.

## lead-capture Edge Function HTTP Contract

```
POST /functions/v1/lead-capture/submit
  verify_jwt = false  (config.toml-gated)
  Content-Type: application/json

Body: { email, name?, page_slug?, website? }

Responses:
  200 { ok: true }                       — success OR honeypot-filled (byte-identical)
  400 { error: "bad_json" }              — unparseable body
  400 { error: "missing_email" }         — empty email
  400 { error: "invalid_email" }         — fails regex
  429 { error: "rate_limited" }          — ≥5 in 15 min from this IP
  500 { error: "internal_error" }        — unhandled / insert failure
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Auto-fix blocking issue] `node_modules` missing in worktree**

- **Found during:** Task 1 first `npx vitest run` invocation.
- **Issue:** The worktree had no `leanshot/node_modules`; vitest startup error.
- **Fix:** Ran `cd leanshot && npm install --prefer-offline --no-audit --no-fund` (848 packages, 7s). Per memory `feedback_worktree_executor_npm_install_leak`, verified no leak into `leanshot/package.json` / `leanshot/package-lock.json` (worktree-only).
- **Files modified:** None tracked — `leanshot/node_modules/**` is gitignored.
- **Commit:** N/A — environment setup only.

**2. [Rule 2 — Auto-add missing critical functionality] Existing `unimplemented type returns empty string` test in `render.test.ts` required updating**

- **Found during:** Task 1 GREEN-phase run.
- **Issue:** 15-06 had pivoted the forward-contract `unimplemented` test from `'calendly'` to `'lead-form'`. After this plan implements `'lead-form'`, that test would have failed as a false-negative.
- **Fix:** Updated the test to cast a synthetic `'not-yet-implemented'` literal through `unknown` — the contract is now "the default switch fall-through returns ''" regardless of which BlockType literals are added later. The 12-literal BlockType union is fully covered.
- **Files modified:** `supabase/functions/page-render/render.test.ts` (one test pivot + comment update).
- **Commit:** Folded into Task 1 GREEN commit (`6e17533`).
- **Threat-model justification:** None — this is a forward-contract update; the default branch is the actual safety guarantee.

### Deferred Items

None — every plan acceptance criterion is satisfied in this commit set.

## Known Stubs

| Surface | File | Reason |
|---------|------|--------|
| Inline submit script error messages are hard-coded English (`"Too many submissions…"`, etc.) | `supabase/functions/page-render/render.ts` `renderLeadForm` | Phase 15 ships English-only published pages (no i18n track in scope). UI-SPEC Copywriting Contract specifies these exact strings. |
| Resend notification SKIPPED entirely until `LEAD_NOTIFY_TO` env is set on the Supabase Function | `supabase/functions/lead-capture/resend.ts` | D-12 (notification optional). The leads row is still written; staff can read via the future Phase 15 staff dashboard (or directly via SQL). Wiring `LEAD_NOTIFY_TO` is a Phase 15 vendor checkpoint, not a plan deliverable. |
| `extra_fields` jsonb only captures `source_url` (Referer) when present — page_slug is NOT echoed back into `extra_fields` (it's resolved to `page_id` instead) | `supabase/functions/lead-capture/index.ts` | The leads table doesn't have a `source_url` column (15-01 chose `extra_fields jsonb`); we keep the slug → id resolve as the authoritative link and ignore the raw slug. |

None of these stubs prevent the plan's goal — they are the documented boundaries between this plan, 15-09 (templates wire lead-form into the lead-magnet template), and the Phase 15 vendor checkpoints.

## Cross-Plan Dependencies for Later Phase 15 Plans

- **15-08 (SEO cascade) MUST:**
  - Replace the BODY of `renderSeoHead` only — this plan did not touch the SEO seam.
  - Add ONLY `[functions.sitemap]` to `supabase/config.toml`. Do not touch the `[functions.lead-capture]` block.
- **15-09 (templates) MUST:**
  - Drop a `lead-form` block (with `DEFAULT_LEAD_FORM_CONTENT` content) into the lead-magnet template. The block content shape is the export from `@/lib/page-builder/lead-form-content`.
- **15-10 (pricing-checkout)** — NOT affected by this plan; `lead-capture` and `pricing-checkout` are separate paths.

## Threat Surface Scan

All threat-register items (T-15-LF-01 through T-15-LF-08) ship mitigated as documented in the plan:

| Threat | Mitigation in this commit |
|--------|---------------------------|
| T-15-LF-01 (Tampering — XSS via block content) | Every `content` string in `renderLeadForm` routes through 15-03's `escapeHtml`; `successMessage` escaped as an HTML attribute value; renderer test asserts `<script>alert(1)</script>` payload renders as `&lt;script&gt;alert(1)&lt;/script&gt;` text — not an executable tag. |
| T-15-LF-02 (DoS — public POST) | Postgres-counter per-IP rate limit (5/15min keyed on SHA-256 IP hash) in `rate-limit.ts`; rejects the 6th with `429`. Honeypot check runs FIRST so bot traffic is dropped before the DB count is computed. |
| T-15-LF-03 (DoS / spam) | Hidden honeypot field (`name="website"`, offscreen via `position:absolute;left:-9999px`, `tabindex=-1`, `autocomplete=off`, `aria-hidden=true`); non-empty value returns 200 byte-identical to success + flagged row + no Resend; 200 body has no `honeypot_flagged` echo so bots cannot distinguish paths. |
| T-15-LF-04 (Tampering — email/HTML injection in Resend notification) | Visitor `leadEmail` / `leadName` / `pageSlug` are escaped via a local `escapeHtml` helper before interpolation into the notification HTML; recipient (`to`) is the server-side `Deno.env.get('LEAD_NOTIFY_TO')` — never visitor-controlled; non-2xx Resend wraps as `resend_<status>` codes (never echoes `res.text()`). |
| T-15-LF-05 (Injection — SQL) | All DB access via the supabase-js client's parameterized `.insert()` / `.select().eq()` / `.gte()` chain — no string-concatenated SQL anywhere in the function. |
| T-15-LF-06 (Info disclosure — leads table) | RLS on `leads` (created by 15-01 / migration 07) forbids public SELECT — only service-role inserts, only `is_staff` reads. The `lead-capture` function never returns lead data in any response body; the deno suite asserts the `{ok:true}` shape across happy, honeypot, and validation paths. The live cross-tenant impersonation proof is owned by 15-01's Wave 0 test. |
| T-15-LF-07 (Repudiation / abuse forensics) | `ip_hash` (SHA-256, not raw IP — not PII) + `honeypot_flagged` + `extra_fields.source_url` (Referer when present) give staff coarse abuse forensics. Raw IP intentionally not stored (data minimization). Accepted: a determined IP-rotating attacker is not fully defeated — rate-limit + honeypot are the proportionate controls. |
| T-15-LF-08 (Spoofing — verify_jwt=false) | The endpoint is intentionally unauthenticated (public opt-in form). No identity to spoof; the threat collapses to T-15-LF-02/03 (volume abuse) which are mitigated. Accepted by design (D-12). |

No threat-flag rows to add — no new surface beyond the documented register.

## Performance

- **Duration:** ~14 minutes (Task 0: ~3 min — both test scaffolds + cors.ts; Task 1: ~6 min — content type + block component + property-config + render branch + 4 new Deno tests; Task 2: ~5 min — 4 Edge Function source files + config.toml block + 9 Deno tests)
- **Tasks:** 3/3
- **Files created:** 9 (+ 4 modified)
- **LoC added:** ~850 (rough estimate from `git show --stat`)

## Self-Check: PASSED

- [x] Task 0 commit `430c5c9` exists (test scaffolds)
- [x] Task 1 RED commit `234665b` exists; Task 1 GREEN commit `6e17533` exists
- [x] Task 2 commit `ce95a61` exists
- [x] `leanshot/src/lib/page-builder/lead-form-content.ts` exists with `LeadFormContent` + `DEFAULT_LEAD_FORM_CONTENT` exports
- [x] `leanshot/src/components/admin/pages/blocks/LeadFormBlock.tsx` exists; no raw hex (grep returns 0)
- [x] `leanshot/src/components/admin/pages/blocks/LeadFormBlock.test.tsx` exists; 3/3 vitest pass
- [x] `leanshot/src/components/admin/pages/editor/property-configs.ts` has a `lead-form` entry (flat file, not directory)
- [x] `supabase/functions/page-render/render.ts` adds exactly ONE `case 'lead-form':` branch (grep returns 1)
- [x] `supabase/functions/page-render/render.ts` has the honeypot `name="website"` in the rendered branch (grep returns 1)
- [x] `supabase/functions/page-render/render.test.ts` has 4 new tests for the lead-form branch; 43/43 Deno tests pass overall
- [x] `supabase/functions/lead-capture/{index.ts,cors.ts,rate-limit.ts,resend.ts,deno.json,index.test.ts}` all exist
- [x] `supabase/functions/lead-capture/deno.json` is byte-identical to `stripe-checkout/deno.json`
- [x] `supabase/config.toml` adds `[functions.lead-capture] verify_jwt = false` block
- [x] All deno test (9/9 lead-capture + 43/43 page-render) + vitest (925/964) + tsc strict + lint + build + bundle-budget gates green
- [x] No modification to STATE.md / ROADMAP.md / REQUIREMENTS.md (orchestrator owns those writes)
- [x] No `supabase functions deploy` run — left to orchestrator
- [x] Edits to `render.ts` confined to one new switch branch + one new helper function (`renderLeadForm`) at the seam below the embed renderers
- [x] Edits to `property-configs.ts` confined to one new `'lead-form'` entry at the end of the flat map
- [x] Edits to `supabase/config.toml` confined to one new `[functions.lead-capture]` block (no edits to other function blocks)
