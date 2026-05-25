# Phase 52: Vendor Setup Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Consolidate every vendor onboarding upfront so every downstream phase (53–68) has live integrations from day one — eliminating the per-phase secret-deferral pattern that bit v1.3 (7 unset secrets at milestone close).

This phase delivers the **scaffolding, automation, and tracking** for vendor setup:
- A consolidated vendor-smoke Edge Fn that pings each live vendor API
- An admin `vendor_smoke_log` dashboard surfacing per-vendor health
- A secrets registry (all secret *names* registered; *values* set where accounts exist)
- A `runbooks/vendor-secrets.md` documenting every secret (rotation cadence + blast-radius)
- `vendor_baa_chain` rows for each new vendor (reusing the existing Phase 25 table)

Per the v1.4 milestone contract (D-08): actual account creation, secret-value setting, and approvals that require payment/identity-verification/vendor-approval (Apple Dev $99, Google Play $25, HealthKit entitlement, AdMob publisher, Mux, Calendly, Better Stack, Sentry CSP, etc.) are **deferred to the Phase 70 consolidated HUMAN-UAT gate**. The smoke dashboard is the live missing-secret tracker; the runbook lists the exact `supabase secrets set` / `vercel env add` commands.

</domain>

<decisions>
## Implementation Decisions

### Smoke-test architecture
- Single `vendor-smoke` Edge Fn with per-vendor handlers (not per-vendor Fns) — one deploy unit, iterates a vendor registry.
- Runs on a **daily pg_cron** schedule + a staff-triggered "run now" path.
- Vendors with no secret set record a **`not_configured`** status (distinct from `fail`) so the dashboard separates "not provisioned yet" from "broken".
- Smoke Fn is **internal-only** — HMAC/service-role auth (cron + staff-triggered), never public. Follow project precedent: HMAC-payload auth for orchestrator-callable Fns; beware `sb_secret_*` vs legacy-JWT service-role-key format divergence.

### Admin vendor_smoke_log dashboard
- **New admin module** registered in the admin module manifest **AND** reachable via a catch-all URL-prefix router branch (avoids the Phase 42 manifest↔router-branch drift bug).
- Shows vendor × last-status (`ok` / `fail` / `not_configured`) + last-checked timestamp + latency; red badge on `fail`, neutral badge on `not_configured`.
- Access-gated by `public.is_staff()` RLS + the `ClinicianMfaGuard` pattern.
- Includes a staff **"run smoke now"** button that invokes the Fn.

### Secrets registry + runbook + BAA
- Register **all** secret *names* + runbook rows now; set *values* only where the account already exists.
- Storage split: build-time `VITE_*` public vars → Vercel env (production); server secrets → Supabase Function secrets. (vercel.json does NOT interpolate env — keep dynamic header assembly in Edge Middleware.)
- BAA: insert rows into the **existing** `vendor_baa_chain` table via the existing update RPC (`20270702000009_vendor_baa_chain_update_rpc.sql`). Mux = confirmed BAA scope; Apple Dev + Google Play = n/a noted. Do NOT create a parallel table.
- Runbook `runbooks/vendor-secrets.md`: per-secret table (name, storage location, rotation cadence, blast-radius, owner) + the literal set-commands.

### Human-provisioning gate (vendor-defer-to-70)
- "Done" for this phase = scaffold/Fn/dashboard/runbook/BAA-rows/secret-name-registration shipped and verifiable; actual account creation, value-setting, and vendor approvals defer to the Phase 70 HUMAN-UAT signal.
- The smoke dashboard + runbook serve as the live missing-secret tracker — no separate checklist doc.

### Claude's Discretion
- Exact vendor registry shape, smoke handler implementations, dashboard component layout (within DS), cron expression, and HMAC envelope details are at Claude's discretion, consistent with codebase conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/20270702000001_vendor_baa_chain.sql` — existing BAA chain table (Phase 25).
- `supabase/migrations/20270702000009_vendor_baa_chain_update_rpc.sql` — update RPC to insert/modify BAA rows.
- `supabase/migrations/20270702000008_baa_alert_cron.sql` — existing BAA alert cron pattern (model the smoke cron on this).
- `public.is_staff()` helper at `supabase/migrations/20261101000006_is_staff_helper.sql` — SECDEF staff RLS guard; use `using (public.is_staff())`.
- Admin module pattern: `leanshot/src/components/admin/AdminShell.tsx` + module manifest; `ClinicianMfaGuard.tsx` for MFA gating; many sibling modules (`AdminMetrics*`, `AdminAffiliates*`) to model the new vendor-smoke module on.
- `leanshot/.planning/runbooks/` exists (`hbnr-incident-response.md`) — add `vendor-secrets.md` alongside.
- PROJECT.md "Vendor Accounts" table is the authoritative credential-name source of truth.

### Established Patterns
- pg_cron + SECDEF calling Edge Fns MUST use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')` + hardcoded URL (no `app.service_role_key` GUC on this project).
- Edge Fns use `Deno.serve()` not guarded by `import.meta.main` (local `deno test` of a dir triggers a real server — test individual files / use `--no-check`).
- Per-function `deno.json` required (CLI v2.101.0 ignores `--import-map`; bare `shared/*` aliases break).

### Integration Points
- Admin manifest + router branch in `src/components/admin/`.
- New migrations under `supabase/migrations/`; new Fn under `supabase/functions/vendor-smoke/`.
- Monorepo: git root = `/Users/karstenhaldan/minisite`; PLAN.md paths relative to git root, NOT `/leanshot/`.

</code_context>

<specifics>
## Specific Ideas

- Vendor set in scope (names from PROJECT.md + ROADMAP VENDOR-01..12): Apple Developer, Google Play, APNs, FCM, HealthKit entitlement, Mux, Calendly, Better Stack, Sentry (CSP report-uri), AdMob/AdSense, Stripe, Resend, PostHog, plus the 7 v1.3 carry-over secrets (Better Stack, Calendly OAuth, Sentry CSP, traffic-recorder env, SHARE_TOKEN, NPS signing key, PostHog Personal API key, Slack webhook).
- Smoke handler for each vendor should fail-soft: a `not_configured` result when the secret is absent, a timed `ok`/`fail` when present.

</specifics>

<deferred>
## Deferred Ideas

- Actual vendor account creation, payment, identity verification, and approval (Apple Dev, Google Play, HealthKit entitlement, AdMob publisher) → Phase 70 HUMAN-UAT.
- Live secret-value setting where accounts don't yet exist → Phase 70 HUMAN-UAT.
- Per-vendor deep integration tests (beyond a connectivity smoke) → owned by the consuming phase (53–68).

</deferred>
