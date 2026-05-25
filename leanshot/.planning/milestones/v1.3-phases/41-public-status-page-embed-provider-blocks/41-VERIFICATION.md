---
phase: 41
status: human_needed
verified_at: 2026-05-24
disposition: complete + approved automated-verify-only
must_haves_verified: 7 of 9
human_verification_count: 6
---

# Phase 41 Verification — Public Status Page + Embed-Provider Blocks

## Automated checks — PASSED

- Wave 1 (41-01 consent retrofit + 41-02 iframe_allowlist): 16/16 unit + Phase 15 retrofit patched (15/15 pre-existing tests green).
- Wave 2 (41-03 middleware/CSP + 41-04 Calendly OAuth): 21/21 unit + deno check clean + 72 page-render tests (with `--allow-net=0.0.0.0:8000`).
- Wave 3 (41-05 embed UI + 41-06 admin allowlist): 36/36 unit + smoke gracefully `it.skip` when `BETTERSTACK_API_KEY` unset.
- Code review (41-REVIEW.md): 3 critical + 6 warning fixed via 7 commits; status flipped to `clean` (commit `9b8294cb`).
- `tsc -p tsconfig.app.json --noEmit` clean across all merges.

## must_haves — 7 of 9 verified

- ✅ EMBED-01..03,05 — consent-gated embeds (Calendly/YouTube/Tally) ship; ConsentGatedEmbed HOC behavior unit-verified.
- ✅ EMBED-04 — Custom-iframe hostname allowlist + SECDEF RPCs + admin UI live.
- ✅ EMBED-06 — KB articles render embed blocks via same HOC.
- ✅ EMBED-07 — Vercel Edge Middleware augments CSP from `iframe_allowlist` with 60s cache + fail-safe.
- ✅ EMBED-08 (partial — code-side) — Calendly OAuth Edge Fns + CalendlyPreviewPopup + postMessage origin validation. **CR-02 carry-over: signed-handoff token redesign needed to make popup actually authenticate to `calendly-oauth-start` (which has `verify_jwt = false` but the upstream popup nav still lacks a signed token contract).**
- ⏸️ POLISH-10 — Status page (Better Stack) — vendor-deferred per `feedback_milestone_uat_deferral_consolidation`; smoke gracefully skips until `BETTERSTACK_API_KEY` set.

## human_verification — 6 deferred signals

1. **POLISH-10 / `bstack-approved`** — Operator: create Better Stack status page with 7 components (D-01) + 3 integrations (Sentry/Vercel/Supabase, D-02); set `BETTERSTACK_API_KEY` Vercel env; rerun `npx vitest run tests/smoke/status-page.smoke.test.ts` — Group 3 should now execute (not skip).
2. **`cname-live`** — Operator: configure `status.leanshot.app` CNAME to Better Stack edge; verify HTTPS resolves and the public page renders 7 components.
3. **`calendly-oauth-approved`** — Operator: register Calendly OAuth app at https://developer.calendly.com/; set `CALENDLY_OAUTH_CLIENT_ID` / `CALENDLY_OAUTH_CLIENT_SECRET` / `CALENDLY_OAUTH_REDIRECT_URI` / `LEANSHOT_APP_ORIGIN` / `OAUTH_STATE_SECRET` as Supabase Function Secrets; click "Connect Calendly" in PageEditor → confirm popup completes + token returns. **Gated on CR-02 carry-over (signed-handoff token).**
4. **`allowlist-approved`** — Operator: sign in as superadmin, navigate to `/admin/embeds`, add `tally.so` hostname → confirm row appears, CSP middleware picks up via 60s cache, Custom-iframe block embedding a `tally.so` URL now renders.
5. **`consent-gating-approved`** — Operator: open a page with embed blocks logged out, deny consent → confirm `EmbedPlaceholderCard` shows with provider logo + "Manage cookie preferences" link; click link → consent banner opens (CR-03 runtime verification on KB-article surface where `leanshot:open-consent-banner` listener is NOT registered).
6. **`custom-iframe-approved`** — Operator: try adding a Custom-iframe block with a non-allowlisted hostname → confirm UI rejects + iframe never renders; then add the hostname to allowlist → confirm same URL now renders inside CSP-locked iframe.

## Carry-over to v1.3 milestone close

Per `feedback_milestone_uat_deferral_consolidation`: 6 deferred signals + CR-02 follow-up logged to `v1.3-uat-deferred.md` (or equivalent). Pre-milestone-close operator runbook:

1. Set 7 secrets/env vars (5 Supabase + 2 Vercel — full list in 41-06-SUMMARY.md §Carry-over).
2. `cd supabase && npx supabase db push --linked` (migrations 20271101000001 + 20271101000002).
3. `npx supabase functions deploy calendly-oauth-start calendly-oauth-callback page-render` (3 Fns).
4. Run 6 HUMAN-UAT signals above.

## Classification

**`complete + approved automated-verify-only`** per `feedback_autonomous_false_close_out_partial_execution`. Code-side EMBED-01..08 + POLISH-10 admin tooling are shipped + reviewed + clean; vendor + runtime verification deferred to v1.3 milestone close.
