# Phase 52: Vendor Setup Foundation — Research

**Researched:** 2026-05-25
**Domain:** Vendor connectivity smoke testing, Edge Function cron infrastructure, admin module registration, pg_cron + vault patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Single `vendor-smoke` Edge Fn (not per-vendor Fns) — one deploy unit iterating a vendor registry
- Daily pg_cron schedule + staff-triggered "run now" path
- Vendors with no secret set record `not_configured` (distinct from `fail`)
- Fn is internal-only — HMAC/service-role auth (cron + staff-triggered), never public
- New admin module registered in ADMIN_MODULES manifest AND reachable via catch-all URL-prefix router branch
- Dashboard shows vendor × last-status (`ok` / `fail` / `not_configured`) + last-checked + latency; red badge on `fail`, neutral on `not_configured`
- Access-gated by `public.is_staff()` RLS + `ClinicianMfaGuard` pattern
- Staff "run smoke now" button invokes the Fn
- Register all secret **names** + runbook rows now; set **values** only where the account already exists
- Storage split: build-time `VITE_*` public vars → Vercel env (production); server secrets → Supabase Function secrets
- BAA: insert rows into the **existing** `vendor_baa_chain` table via the existing update RPC; do NOT create a parallel table
- Runbook at `.planning/runbooks/vendor-secrets.md`
- "Done" for this phase = scaffold/Fn/dashboard/runbook/BAA-rows/secret-name-registration shipped; actual account creation and value-setting defers to Phase 70

### Claude's Discretion

- Exact vendor registry shape, smoke handler implementations, dashboard component layout (within DS), cron expression, and HMAC envelope details

### Deferred Ideas (OUT OF SCOPE)

- Actual vendor account creation, payment, identity verification, and approval (Apple Dev, Google Play, HealthKit entitlement, AdMob publisher) → Phase 70 HUMAN-UAT
- Live secret-value setting where accounts don't yet exist → Phase 70 HUMAN-UAT
- Per-vendor deep integration tests (beyond connectivity smoke) → owned by consuming phases 53–68

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VENDOR-01 | Apple Developer Program enrolled; Team ID + Bundle ID + APNs cert + Sign-in-with-Apple service ID | Smoke: JWT mint or /3/device validation endpoint; secret: `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_P8_KEY` |
| VENDOR-02 | Google Play Console enrolled; Package + FCM service-account JSON captured | Smoke: Google OAuth2 token mint from service-account JSON; secrets: `PLAY_PACKAGE_NAME`, `PLAY_SERVICE_ACCOUNT_JSON`, `FCM_SERVER_KEY` |
| VENDOR-03 | HealthKit entitlement requested; entitlement plist captured | No server smoke — entitlement is Apple-side only; record `not_configured` with note |
| VENDOR-04 | Mux onboarded; token ID + secret + webhook signing secret set | Smoke: Basic-auth GET /video/v1/assets?limit=1; secrets: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SIGNING_SECRET` |
| VENDOR-05 | Calendly OAuth app registered; 5 secrets set | Smoke: GET /v1/users/me with `CALENDLY_API_KEY`; secrets: `CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `CALENDLY_OAUTH_REDIRECT_URI`, `CALENDLY_API_KEY` |
| VENDOR-06 | Better Stack onboarded; `BETTER_STACK_API_KEY` + `BETTER_STACK_PAGE_ID` set; DNS pointed | Smoke: GET /api/v2/monitors with bearer; secrets: `BETTER_STACK_API_KEY`, `BETTER_STACK_PAGE_ID` |
| VENDOR-07 | Sentry CSP report-uri configured; `SENTRY_DSN` verified live for Edge Functions | Smoke: parse SENTRY_DSN and ping Sentry ingest envelope URL; secret: `SENTRY_DSN` |
| VENDOR-08 | Anthropic credential split verified; both keys resolve via ai-chat branch logic | Smoke: POST /v1/messages with each key (minimal request); secrets: `ANTHROPIC_CLINICAL_API_KEY`, `ANTHROPIC_CLINICAL_BAA_ACTIVE`, and consumer key (already set as `ANTHROPIC_API_KEY`) |
| VENDOR-09 | Remaining v1.3-deferred secrets set | Smoke: ping owning services; secrets: `SHARE_TOKEN_SECRET`, `QUARTERLY_NPS_SIGNING_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `SLACK_WEBHOOK_EXPERIMENTS_URL` |
| VENDOR-10 | Vendor BAA chain re-verified; `vendor_baa_chain` rows added for new vendors | Insert via `vendor_baa_chain_update` RPC where signed; plain INSERT for new pending rows |
| VENDOR-11 | Per-vendor smoke Edge Fn on 6-hour cron; failures logged to `vendor_smoke_log` table | New table + migration + Edge Fn + cron migration |
| VENDOR-12 | `.planning/runbooks/vendor-secrets.md` documents every secret | Flat markdown file; per-secret table; placed alongside `hbnr-incident-response.md` |

</phase_requirements>

---

## Summary

Phase 52 delivers the scaffolding that makes all v1.4 downstream phases (53–68) self-sufficient from day one: a single `vendor-smoke` Edge Function that health-checks every vendor API, a `vendor_smoke_log` admin dashboard, a `vendor-secrets.md` runbook, and new `vendor_baa_chain` rows.

The critical design principle is **fail-soft on absent secrets**: every smoke handler must detect a missing secret and record `not_configured` rather than raising an error. This separates "not yet provisioned" from "broken" in the dashboard, and it means the smoke Fn runs safely even before Phase 70 provisioning is complete.

The implementation reuses heavily from Phase 25 (baa-expiry-check Edge Fn pattern, vault bearer cron, vendor_baa_chain table/RPC, is_staff RLS) and Phase 42 (admin module manifest + catch-all URL-prefix router, ClinicianMfaGuard). Deviations from those patterns are documented as pitfalls.

**Primary recommendation:** Model `vendor-smoke` directly on `baa-expiry-check/index.ts` — same `checkServiceRoleBearer` auth, same `makeLazyAdmin`, same `jsonResponse`/`jsonError` helpers, same vault-bearer pg_cron block. The only additions are: a vendor registry array, per-vendor handler functions, and upsert into the new `vendor_smoke_log` table.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-vendor smoke execution | Supabase Edge Function (`vendor-smoke`) | pg_cron scheduler | Server-side secrets never leave Supabase; cron triggers at fixed UTC cadence |
| Smoke result persistence | Supabase (table `vendor_smoke_log`) | — | RLS-gated; staff-only SELECT; admins read via Supabase JS client |
| Staff-triggered "run now" | Browser → Supabase JS client → Fn invoke | — | Authenticated POST; Fn validates is_staff via bearer |
| Admin dashboard UI | Browser SPA (`AdminVendorSmokeDashboard`) | AdminShell module manifest | React component reads `vendor_smoke_log` via Supabase client |
| Secret storage (server) | Supabase Function Secrets | — | Deno.env.get at Fn runtime; never in git |
| Secret storage (build-time public) | Vercel env | — | `VITE_*` vars baked at build time; no server involvement |
| BAA chain update | Supabase DB (vendor_baa_chain) via SECDEF RPC | — | Phase 25 table; service_role UPDATE revoked; must use RPC |
| Runbook | Git file (`.planning/runbooks/vendor-secrets.md`) | — | Static doc; no runtime dependency |

---

## Standard Stack

### Core (no new packages — all reuse existing project stack)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | `^2` (npm: specifier) | Supabase client in Edge Fn | Already used by every Edge Fn in project |
| Deno runtime | Supabase-managed | Edge Fn execution | Project standard; all Fns use `Deno.serve()` |
| `_shared/lifecycle-utils.ts` | project-internal | `checkServiceRoleBearer`, `makeLazyAdmin`, `jsonResponse`, `jsonError`, `constantTimeEqual` | Used by baa-expiry-check, audit-archive, subprocessor-diff |
| React 19 + Tailwind v4 | locked | Admin dashboard UI | Project locked stack; all admin components use these |
| lucide-react `^0.460.0` | locked | `ShieldCheck`, `Play` icons in dashboard | Already imported in modules.ts |

### Supporting (vendor API clients — used inside vendor-smoke Fn handlers)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `npm:@mux/mux-node@14` | `14` | Mux API Basic auth for smoke | Already used in `mux-create-upload`; import inside handler only |
| `fetch` (Deno built-in) | built-in | All other vendor HTTP probes (Resend, Calendly, Better Stack, PostHog, Stripe, Sentry, Anthropic, FCM) | Standard; no extra package needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `vendor-smoke` Fn | Per-vendor Fn | Locked decision. Single Fn = one deploy unit; simpler cron wiring |
| `fetch` for vendor probes | vendor-specific SDK | SDKs add Fn cold-start cost; fetch is sufficient for simple read-only probes |

**Installation:** No new packages. All vendor-smoke code reuses existing `_shared/lifecycle-utils.ts` and per-vendor npm: specifiers already present in the project.

---

## Package Legitimacy Audit

No new external packages are being installed in this phase. The phase reuses:
- `npm:@supabase/supabase-js@2` — existing project dependency [VERIFIED: already in all Edge Fns]
- `npm:@mux/mux-node@14` — existing in mux-create-upload [VERIFIED: confirmed in mux-create-upload/deno.json]

No slopcheck required — no new registry packages introduced.

---

## Per-Vendor Smoke Handler Specifications

[ASSUMED] = Based on official API documentation patterns; endpoint details are stable public APIs but not confirmed via live test in this session.

### Apple Developer / APNs (VENDOR-01)

**No cheap server smoke available.** APNs token-based auth requires a device token to target — you cannot ping APNs without an actual device registration. The p8 private key + JWT can be minted server-side but cannot be validated without a valid device token.

**Recommended approach:** [ASSUMED]
- Check presence of `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_P8_KEY`, `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`
- If all present: attempt JWT mint (sign with ES256) — success = `ok` (JWT mint proves key validity)
- If any missing: record `not_configured`
- Do NOT attempt an APNs HTTP/2 connection without a device token — it will 400/fail

**Secrets required:** `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_P8_KEY`, `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`

**not_configured trigger:** any of the above secrets unset/empty [ASSUMED]

---

### FCM / Google Play (VENDOR-02)

**Smoke approach:** [ASSUMED]
- Check presence of `FCM_SERVICE_ACCOUNT_JSON` (or `PLAY_SERVICE_ACCOUNT_JSON`)
- If present: parse JSON, extract `client_email` + `private_key`, mint OAuth2 access token via Google token endpoint (`https://oauth2.googleapis.com/token`) with scope `https://www.googleapis.com/auth/firebase.messaging`
- If token mint succeeds (HTTP 200 with `access_token`): record `ok` + latency
- If parse fails or token mint fails: record `fail` + error message (non-sensitive)
- If secret missing: record `not_configured`

**Secrets required:** `PLAY_SERVICE_ACCOUNT_JSON` (contains full service account JSON; `FCM_SERVER_KEY` is the legacy v1 key)

**Endpoint:** `https://oauth2.googleapis.com/token` [ASSUMED]

**not_configured trigger:** `PLAY_SERVICE_ACCOUNT_JSON` unset/empty [ASSUMED]

---

### HealthKit Entitlement (VENDOR-03)

**No server smoke.** HealthKit entitlement is a compile-time iOS capability — there is no API endpoint to ping. The entitlement is approved/denied by Apple App Store Connect, not verifiable server-side.

**Recommended approach:** Record `not_configured` with message `"entitlement_ios_only_no_server_smoke"` always. The dashboard will show this vendor as `not_configured` until the consuming phase (Phase 55) confirms the entitlement via App Store Connect.

**Secrets required:** none

---

### Mux (VENDOR-04)

**Smoke approach:** [VERIFIED: mux-create-upload/index.ts uses `npm:@mux/mux-node@14`]
- Check presence of `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET`
- If present: GET `https://api.mux.com/video/v1/assets?limit=1` with Basic auth (`btoa(tokenId + ':' + tokenSecret)`)
- HTTP 200 or 404 = `ok` (account reachable, even if no assets exist)
- HTTP 401 = `fail` with message `"invalid_credentials"`
- Non-2xx/404 = `fail` with message `"http_${status}"`
- If secrets missing: `not_configured`

**Exact endpoint:** `https://api.mux.com/video/v1/assets?limit=1` [ASSUMED based on Mux REST API docs pattern]

**Secrets required:** `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` (smoke only; `MUX_WEBHOOK_SIGNING_SECRET` is not needed for smoke)

**not_configured trigger:** `MUX_TOKEN_ID` or `MUX_TOKEN_SECRET` unset/empty

---

### Calendly (VENDOR-05)

**Smoke approach:** [ASSUMED]
- Check presence of `CALENDLY_API_KEY` (the personal access token, distinct from OAuth client creds)
- If present: GET `https://api.calendly.com/users/me` with `Authorization: Bearer <CALENDLY_API_KEY>`
- HTTP 200 = `ok`
- HTTP 401 = `fail` with `"invalid_api_key"`
- If missing: `not_configured`
- Note: The OAuth client creds (`CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET`) are for the OAuth flow in `calendly-oauth-start/callback` Fns; do NOT smoke-test those — they require a full OAuth dance.

**Exact endpoint:** `https://api.calendly.com/users/me` [ASSUMED]

**Secrets required:** `CALENDLY_API_KEY` (for smoke); `CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `CALENDLY_OAUTH_REDIRECT_URI` (register in runbook, skip smoke)

**not_configured trigger:** `CALENDLY_API_KEY` unset/empty

---

### Better Stack (VENDOR-06)

**Smoke approach:** [ASSUMED]
- Check presence of `BETTER_STACK_API_KEY`
- If present: GET `https://uptime.betterstack.com/api/v2/monitors` with `Authorization: Bearer <BETTER_STACK_API_KEY>`
- HTTP 200 = `ok`
- HTTP 401 = `fail`
- If missing: `not_configured`

**Exact endpoint:** `https://uptime.betterstack.com/api/v2/monitors` [ASSUMED based on Better Stack Uptime API docs]

**Secrets required:** `BETTER_STACK_API_KEY`, `BETTER_STACK_PAGE_ID` (page ID only needed for status-embed, not smoke)

**not_configured trigger:** `BETTER_STACK_API_KEY` unset/empty

---

### Sentry CSP (VENDOR-07)

**Smoke approach:** [ASSUMED]
- Check presence of `SENTRY_DSN`
- Parse DSN format: `https://<key>@<host>/project_id` — extract `host` and `project_id`
- Attempt `HEAD https://<host>/api/<project_id>/envelope/` (Sentry ingest endpoint)
- HTTP 200 or 4xx (405 Method Not Allowed is expected for HEAD) = reachable = `ok`
- Network error / timeout = `fail` with `"unreachable"`
- DSN parse failure = `fail` with `"invalid_dsn_format"`
- If missing: `not_configured`
- Note: The project already uses `_shared/sentry.ts` which wraps `npm:@sentry/node@8`. Do NOT use the SDK for the smoke — just HTTP reachability.

**Secrets required:** `SENTRY_DSN`

**not_configured trigger:** `SENTRY_DSN` unset/empty

---

### Anthropic (VENDOR-08)

**Smoke approach:** [ASSUMED]
- Consumer key: Check `ANTHROPIC_API_KEY` (used by `claude-moderation` Fn and browser-side direct calls; technically client-side but verify the key resolves)
- Clinical key: Check `ANTHROPIC_CLINICAL_API_KEY` (used by `ai-chat` Fn for org_id non-null path, per `ai-chat/index.ts` line 45)
- For each: if present, POST `https://api.anthropic.com/v1/messages` with minimal request body (`{ model: "claude-haiku-3-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }`) and `x-api-key: <key>` header + `anthropic-version: 2023-06-01`
- HTTP 200 = `ok`; HTTP 401 = `fail`; HTTP 400 (bad request format) = treat as `ok` (key authenticated, request malformed is not a key problem)
- If secret missing: `not_configured`

**Exact endpoint:** `https://api.anthropic.com/v1/messages` [ASSUMED]

**Secrets required:** `ANTHROPIC_API_KEY` (consumer), `ANTHROPIC_CLINICAL_API_KEY` (clinical)

**not_configured trigger:** respective key unset/empty

---

### AdMob / AdSense (VENDOR-08 scope per VENDOR-01..12)

**No cheap server smoke.** AdMob/AdSense publisher IDs are client-side SDK values, not server-callable APIs. There is no REST endpoint that validates a publisher ID without app-level context.

**Recommended approach:** Record `not_configured` with message `"client_sdk_only_no_server_smoke"` for both `ADMOB_APP_ID_IOS`, `ADMOB_APP_ID_ANDROID`, `ADMOB_PUBLISHER_ID`, `ADSENSE_PUBLISHER_ID`. The dashboard shows these as permanently `not_configured` until Phase 70 provisioning + Phase 56 integration.

---

### Stripe (VENDOR-09 scope)

**Smoke approach:** [ASSUMED]
- Check presence of `STRIPE_SECRET_KEY`
- GET `https://api.stripe.com/v1/balance` with `Authorization: Bearer <STRIPE_SECRET_KEY>`
- HTTP 200 = `ok`
- HTTP 401 = `fail` with `"invalid_key"`
- If missing: `not_configured`

**Exact endpoint:** `https://api.stripe.com/v1/balance` [ASSUMED based on Stripe REST API, well-known liveness check]

**Secrets required:** `STRIPE_SECRET_KEY`

---

### Resend (VENDOR-09 scope)

**Existing utility:** `_shared/resend-domain-health-check.ts` already implements GET `/domains` smoke [VERIFIED: confirmed in codebase]. Reuse this directly.

**Secrets required:** `RESEND_API_KEY`

---

### PostHog (VENDOR-09 scope)

**Smoke approach:** [ASSUMED]
- Check presence of `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`
- GET `https://app.posthog.com/api/projects/<POSTHOG_PROJECT_ID>/` with `Authorization: Bearer <POSTHOG_PERSONAL_API_KEY>`
- HTTP 200 = `ok`
- HTTP 401/403 = `fail`
- If missing: `not_configured`

**Secrets required:** `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`

---

### Slack (VENDOR-09 scope)

**Smoke approach:** [ASSUMED]
- Check presence of `SLACK_WEBHOOK_EXPERIMENTS_URL`
- POST a dry-run message to the webhook URL (Slack webhooks have no read endpoint; a POST is the only test)
- HTTP 200 with body `ok` = `ok`
- HTTP 4xx/5xx = `fail`
- If missing: `not_configured`
- Note: this will send a test message to the Slack channel. Use a minimal payload: `{ text: "[vendor-smoke] connectivity test — ignore" }`. Include a comment in runbook that smoke posts a test message.

**Secrets required:** `SLACK_WEBHOOK_EXPERIMENTS_URL`

---

### v1.3 Carry-Over Secrets (VENDOR-09)

| Secret | Smoke strategy |
|--------|---------------|
| `SHARE_TOKEN_SECRET` | No external endpoint — presence-check only; record `ok` if set, `not_configured` if not |
| `QUARTERLY_NPS_SIGNING_KEY` | Same as above — HMAC signing key, no external endpoint |
| `REVENUECAT_WEBHOOK_SECRET` | Presence-check only — webhook validation key |
| `RC_API_KEY_IOS` / `RC_API_KEY_ANDROID` | GET `https://api.revenuecat.com/v1/subscribers/current_user` or project info endpoint [ASSUMED] |

---

## Architecture Patterns

### System Architecture Diagram

```
pg_cron (daily 0 8 * * *)
  |
  |-- HTTP POST (Bearer = vault.service_role_key)
  v
vendor-smoke Edge Fn (supabase/functions/vendor-smoke/index.ts)
  |-- checkServiceRoleBearer() → 401 if fail
  |-- iterates vendor registry (array of VendorHandler objects)
  |     |
  |     |-- handler.smoke():
  |     |     - if any secret missing → { status: 'not_configured' }
  |     |     - else → HTTP probe → { status: 'ok'|'fail', latency_ms, message }
  |     |
  |     |-- UPSERT vendor_smoke_log row (vendor_name PK)
  |
  |-- return JSON summary { ok: true, checked: N, failed: M, not_configured: K }

Admin browser (staff user)
  |
  |-- supabase.from('vendor_smoke_log').select(*) → reads table via RLS (is_staff)
  |-- AdminVendorSmokeDashboard renders table with Badge tones
  |
  |-- "Run smoke now" button
        |-- supabase.functions.invoke('vendor-smoke', { body: {} })
              |-- Fn validates staff via bearer (Supabase anon key + user JWT)
              |-- NOTE: staff-invoke path uses user JWT, NOT service-role bearer
              |    Fn must accept BOTH: service-role bearer (cron) OR staff JWT (UI)
```

**Key design note:** The cron path uses `checkServiceRoleBearer`. The staff-triggered path uses the user's Supabase JWT (from `supabase.functions.invoke`). The Fn must handle both. Precedent: `baa-expiry-check` only handles cron (service-role). For the dual-auth pattern, check if `SUPABASE_SERVICE_ROLE_KEY` matches OR call `admin.auth.getUser(bearer)` and verify `is_staff`.

### Recommended Project Structure

```
supabase/
├── functions/
│   └── vendor-smoke/
│       ├── deno.json          # per-fn config; imports npm:@supabase/supabase-js@2 + npm:@mux/mux-node@14
│       ├── index.ts           # Deno.serve, HMAC auth, vendor registry loop, upsert
│       └── index.test.ts      # unit tests per handler + auth gate
├── migrations/
│   └── 20280101000001_vendor_smoke_log.sql     # table + RLS + cron schedule
│   └── 20280101000002_vendor_baa_chain_p52_seed.sql  # new BAA rows for Mux/etc.
leanshot/src/components/admin/
├── AdminVendorSmokeDashboard.tsx  # new module component (per UI-SPEC)
leanshot/src/lib/admin/
├── modules.ts                 # add vendor-smoke entry
.planning/runbooks/
└── vendor-secrets.md          # new runbook
```

### Pattern 1: Vendor Registry Shape

**What:** A typed array of `VendorHandler` objects; the smoke Fn iterates it.

**When to use:** For any smoke-type iteration with per-vendor isolation.

**Example:**

```typescript
// Source: [ASSUMED] — recommended pattern consistent with baa-expiry-check style
interface VendorSmoke {
  vendor_name: string;
  smoke: () => Promise<{
    status: 'ok' | 'fail' | 'not_configured';
    latency_ms: number | null;
    message: string | null;
  }>;
}

const VENDOR_REGISTRY: VendorSmoke[] = [
  {
    vendor_name: 'Mux',
    smoke: async () => {
      const id = Deno.env.get('MUX_TOKEN_ID') ?? '';
      const secret = Deno.env.get('MUX_TOKEN_SECRET') ?? '';
      if (!id || !secret) return { status: 'not_configured', latency_ms: null, message: null };
      const t0 = Date.now();
      try {
        const res = await fetch('https://api.mux.com/video/v1/assets?limit=1', {
          headers: { 'Authorization': `Basic ${btoa(`${id}:${secret}`)}` },
        });
        const latency_ms = Date.now() - t0;
        if (res.status === 200 || res.status === 404) return { status: 'ok', latency_ms, message: null };
        return { status: 'fail', latency_ms, message: `http_${res.status}` };
      } catch {
        return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
      }
    },
  },
  // ... other vendors
];
```

### Pattern 2: HMAC Auth Dual-Mode (cron + staff-triggered)

**What:** Accept both `checkServiceRoleBearer` (cron) AND user JWT with `is_staff` check (staff-triggered).

**When to use:** Any Fn that is both cron-invoked AND has a manual-trigger UI action.

**Example:**

```typescript
// Source: [ASSUMED] — extends baa-expiry-check's service-role-only pattern
async function isAuthorized(req: Request): Promise<boolean> {
  // Path 1: cron — service-role bearer
  if (checkServiceRoleBearer(req)) return true;
  // Path 2: staff UI invoke — user JWT
  const bearer = bearerFromReq(req);
  if (!bearer) return false;
  const { data: { user }, error } = await admin.auth.getUser(bearer);
  if (error || !user) return false;
  const { data: profile } = await admin
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();
  return profile?.is_staff === true;
}
```

### Pattern 3: vendor_smoke_log Upsert

**What:** ON CONFLICT DO UPDATE ensures the table has one row per vendor at all times.

**Example:**

```typescript
// Source: [ASSUMED] — matches Supabase JS upsert pattern
await admin
  .from('vendor_smoke_log')
  .upsert({
    vendor_name: entry.vendor_name,
    status: result.status,
    latency_ms: result.latency_ms,
    message: result.message,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'vendor_name' });
```

### Pattern 4: pg_cron Vault Bearer (exact project pattern)

**What:** MUST use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)` — no GUC. Must use named dollar-quote tags to avoid `$$` nesting collision.

**Example (from baa_alert_cron.sql — VERIFIED):**

```sql
-- Source: [VERIFIED: supabase/migrations/20270702000008_baa_alert_cron.sql]
select cron.schedule(
  'vendor-smoke-check',
  '0 8 * * *',
  $cron$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
```

**Note on outer dollar-quote tag:** Use `$cron$...$cron$` (NOT `$$...$$`) to avoid the nesting collision with any inner `$$` in the body. [VERIFIED: per `reference_postgres_dollar_quote_nesting_in_cron_body` project memory — inner `$$` closes the outer `$$` silently.]

### Pattern 5: Per-function deno.json (required)

**What:** Every new Edge Fn MUST have its own `deno.json`. CLI v2.101.0 silently ignores `--import-map`; bare `shared/*` aliases break. [VERIFIED: per `reference_supabase_functions_deploy_import_map_flag` project memory]

**Example (from mux-create-upload/deno.json — VERIFIED):**

```json
{
  "tasks": { "test": "deno test --no-check ." },
  "imports": {
    "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2",
    "npm:@mux/mux-node@14": "npm:@mux/mux-node@14"
  },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "useTabs": false, "lineWidth": 100 }
}
```

**Key:** vendor-smoke/deno.json should declare `npm:@supabase/supabase-js@2` and `npm:@mux/mux-node@14` in imports block. Import `_shared/lifecycle-utils.ts` via relative path `'../_shared/lifecycle-utils.ts'` (not via alias). [VERIFIED: baa-expiry-check does exactly this]

### Anti-Patterns to Avoid

- **Using `Deno.serve()` in a `deno test` target directory:** The project-wide `Deno.serve()` is NOT guarded by `import.meta.main`. Running `deno test vendor-smoke/` triggers a real HTTP server and hangs. Use `deno test --no-check vendor-smoke/index.test.ts` (test a specific file, not the directory). [VERIFIED: `reference_deno_test_top_level_serve_trap` project memory]
- **Using `app.service_role_key` GUC in cron body:** This GUC does NOT exist on this project. Must use `vault.decrypted_secrets` + hardcoded URL. [VERIFIED: `reference_supabase_pg_cron_vault_service_role_pattern` project memory]
- **`$$` nesting in cron body:** Use named dollar-quote tags (`$cron$...$cron$`). [VERIFIED: `reference_postgres_dollar_quote_nesting_in_cron_body` project memory]
- **`--import-map` flag:** CLI v2.101.0 silently ignores it. Use per-function `deno.json`. [VERIFIED: `reference_supabase_functions_deploy_import_map_flag` project memory]
- **service_role UPDATE on vendor_baa_chain:** Phase 25 explicitly `REVOKE UPDATE, DELETE ON vendor_baa_chain FROM service_role`. All updates MUST use the `vendor_baa_chain_update` SECDEF RPC. [VERIFIED: 20270702000001_vendor_baa_chain.sql line 132]
- **Bare `INSERT INTO vendor_baa_chain`:** For new vendor rows (status=pending), the plan can INSERT in a migration (idempotent with ON CONFLICT DO NOTHING), but NOT via service_role at runtime. The migration runs as the migration role, which is fine.
- **Logging error messages that may contain secrets:** Never log `e.message` in network errors (may contain auth header fragments). Log `e.name` only. [VERIFIED: resend-domain-health-check.ts + aws-ses-health-check.ts pattern]
- **Using legacy SUPABASE_SERVICE_ROLE_KEY JWT format in HMAC compare:** The project has `sb_secret_*` format divergence. `checkServiceRoleBearer` in `_shared/lifecycle-utils.ts` reads `SUPABASE_SERVICE_ROLE_KEY` env — this is already handled correctly by the shared utility. Do NOT implement your own bearer compare. [VERIFIED: `reference_supabase_service_role_key_format_divergence` project memory + lifecycle-utils.ts line 94–98]

---

## Existing Reuse Inventory

### Supabase Migration Files (VERIFIED)

| File | Key Schema Elements | Usage in Phase 52 |
|------|---------------------|-------------------|
| `20270702000001_vendor_baa_chain.sql` | Table: `vendor_baa_chain(vendor_name PK, baa_signed_at, baa_expiry_at, monthly_cost_usd, scope_summary, subprocessor_list, subprocessor_last_diff_at, contact_email, status, created_at, updated_at)`; enum `vendor_baa_status` ('pending','signed','expired'); RLS: superadmin insert/update; `REVOKE UPDATE,DELETE FROM service_role` | Insert new Phase 52 vendor rows (Mux etc.) via migration `ON CONFLICT DO NOTHING` |
| `20270702000009_vendor_baa_chain_update_rpc.sql` | RPC `vendor_baa_chain_update(p_vendor_name text, p_signed_at timestamptz, p_expiry_at timestamptz) → void` (SECDEF, superadmin-only, writes audit_logs); RPC `vendor_baa_chain_set_expired(p_vendor_name text) → void` (SECDEF, service_role-callable); RPC `log_vendor_baa_event(p_vendor_name text, p_action_name text, p_payload jsonb) → void` (SECDEF, service_role-callable) | Use `vendor_baa_chain_update` from admin UI to flip status='signed' when BAA arrives; INSERT-via-migration for new pending rows |
| `20270702000008_baa_alert_cron.sql` | pg_cron pattern: `$cron$...$cron$` named tags, vault bearer, `net.http_post`, 60s timeout | Copy exactly for `vendor-smoke-check` cron |
| `20261101000006_is_staff_helper.sql` | `public.is_staff() → boolean` (SECDEF, STABLE, reads `profiles.is_staff`, coalesce to false) | RLS on `vendor_smoke_log` for staff SELECT |

### vendor_baa_chain — Column Details (VERIFIED)

```
vendor_name              text  PRIMARY KEY
baa_signed_at            timestamptz
baa_expiry_at            timestamptz
monthly_cost_usd         numeric(10,2) NOT NULL DEFAULT 0
scope_summary            text
subprocessor_list        jsonb NOT NULL DEFAULT '[]'
subprocessor_last_diff_at timestamptz
contact_email            text
status                   vendor_baa_status NOT NULL DEFAULT 'pending'
created_at               timestamptz NOT NULL DEFAULT now()
updated_at               timestamptz NOT NULL DEFAULT now()
```

**Existing seed rows (vendor_name values):** 'Supabase', 'Vercel', 'Sentry', 'Anthropic', 'AWS SES', 'PostHog'

**New rows to add for Phase 52 (VENDOR-10):**

| vendor_name | baa_scope_notes | baa_applicable |
|-------------|-----------------|----------------|
| 'Mux' | Video hosting — BAA decision needed (Mux does not offer a standard HIPAA BAA; check enterprise plan) | pending |
| 'Apple Developer' | n/a — no PHI processed; signing authority only | n/a (insert with status='pending', scope_summary='n/a: signing authority, no PHI') |
| 'Google Play' | n/a — no PHI processed | n/a |
| 'Calendly' | PHI risk if scheduling involves patient data; BAA available | pending |
| 'Better Stack' | Status page/monitoring; minimal PHI risk | pending |
| 'Resend' | Email — BAA pending (Phase 25 noted as 'pending') | already has row |
| 'RevenueCat' | Payment/subscription — minimal PHI; BAA check needed | pending |
| 'AdMob/AdSense' | Ad network — MUST NOT touch PHI per HealthKit firewall | n/a |
| 'Stripe' | Payment processor — HIPAA data processor BAA usually available | already present or pending |

**Decision already in CONTEXT.md:** Mux confirmed BAA scope (decision needed); Apple Dev + Google Play noted n/a. [VERIFIED: 52-CONTEXT.md]

### RPC Signatures (VERIFIED from 20270702000009_vendor_baa_chain_update_rpc.sql)

```sql
-- For admin UI to mark a BAA as signed:
public.vendor_baa_chain_update(
  p_vendor_name text,
  p_signed_at   timestamptz,
  p_expiry_at   timestamptz
) returns void

-- For cron to expire:
public.vendor_baa_chain_set_expired(p_vendor_name text) returns void

-- For audit trail from cron Edge Fns:
public.log_vendor_baa_event(
  p_vendor_name text,
  p_action_name text,  -- 'vendor_baa_expiry_warning' | 'subprocessor_changed' | 'subprocessor_fetch_failed'
  p_payload     jsonb
) returns void
```

### Edge Function Shared Utilities (VERIFIED from codebase)

| Utility | Location | What It Provides |
|---------|----------|-----------------|
| `checkServiceRoleBearer(req)` | `_shared/lifecycle-utils.ts:94` | Constant-time compare of `Authorization: Bearer` vs `SUPABASE_SERVICE_ROLE_KEY` env var |
| `bearerFromReq(req)` | `_shared/lifecycle-utils.ts` | Extract Bearer token string from Authorization header |
| `makeLazyAdmin()` | `_shared/lifecycle-utils.ts` | Returns `{ admin, setAdminForTest, resetAdminForTest }` — lazy Supabase admin client + test stub hook |
| `jsonResponse(status, body)` | `_shared/lifecycle-utils.ts` | JSON response with CORS headers |
| `jsonError(status, code)` | `_shared/lifecycle-utils.ts` | JSON error response |
| `constantTimeEqual(a, b)` | `_shared/lifecycle-utils.ts` | Constant-time string compare |
| `corsHeaders` | `_shared/lifecycle-utils.ts` | CORS header object |

**Import path in vendor-smoke/index.ts:** `import { checkServiceRoleBearer, ... } from '../_shared/lifecycle-utils.ts';`

### Admin Module Manifest (VERIFIED from modules.ts)

**Exact entry shape to add:**

```typescript
// Source: [VERIFIED: src/lib/admin/modules.ts pattern]
// Add import at top:
import { ShieldCheck as ShieldCheckIcon2 } from 'lucide-react'; // ShieldCheckIcon already imported at line 45 for embeds

// Add entry in ADMIN_MODULES array:
{
  key: 'vendor-smoke',
  label: 'Vendor health',
  route: 'vendor-smoke',
  icon: ShieldCheckIcon,  // already imported as ShieldCheckIcon at line 45 for embeds module
  lazy: () =>
    import('@/components/admin/AdminVendorSmokeDashboard').then((m) => ({
      default: m.AdminVendorSmokeDashboard,
    })),
  flagKey: 'admin.vendor_smoke.enabled',
  minRole: 'superadmin' as AdminRole,
},
```

**Note:** `ShieldCheckIcon` is already imported in modules.ts at line 45 (for the embeds module). Do NOT add a duplicate import — use the existing import. If there is a naming conflict, alias one: `ShieldCheck as VendorShieldCheckIcon`.

**AdminShell routing confirmation (VERIFIED from AdminShell.tsx:116-120):**

```typescript
const activeModule = ADMIN_MODULES.find(
  (m) =>
    pathname === `/admin/${m.route}` ||
    pathname.startsWith(`/admin/${m.route}/`),
);
```

Route `vendor-smoke` means `/admin/vendor-smoke` resolves via exact match. No sub-routes planned for this module. No additional router edits needed — the manifest entry alone is sufficient.

---

## vendor_smoke_log Table Schema

**New table to create (Phase 52 migration):**

```sql
-- Source: [ASSUMED] — designed to match project conventions from vendor_baa_chain
CREATE TYPE public.vendor_smoke_status AS ENUM ('ok', 'fail', 'not_configured');

CREATE TABLE public.vendor_smoke_log (
  vendor_name   text                        PRIMARY KEY,
  status        public.vendor_smoke_status  NOT NULL DEFAULT 'not_configured',
  latency_ms    integer,                    -- null when not_configured or unavailable
  message       text,                       -- short error or null
  checked_at    timestamptz                 NOT NULL DEFAULT now()
);

-- RLS: staff SELECT only (no INSERT/UPDATE from client — Edge Fn uses service_role)
ALTER TABLE public.vendor_smoke_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_smoke_log_select_staff
  ON public.vendor_smoke_log
  FOR SELECT
  USING (public.is_staff());

-- No INSERT/UPDATE/DELETE RLS for authenticated — Edge Fn writes via service_role
-- (service_role bypasses RLS by default; explicit REVOKE not needed for this table
-- since only the Fn writes to it, not via PostgREST)
```

**Note:** `latency_ms` as `integer` is sufficient (sub-second to ~30s range = fits comfortably). Do NOT use `float` — integer milliseconds are standard in this project.

---

## Cron Slot Assignment

**Confirmed taken daily slots (VERIFIED from grep of migrations/):**

| UTC Hour | Slot taken |
|----------|-----------|
| 01:00 | Yes |
| 02:00 | Yes |
| 03:00 | Yes (multiple) |
| 04:00 | Yes |
| 05:00 | Yes |
| 06:00 | Yes (baa-expiry-check) |
| 07:00 | Yes (subprocessor-diff, Mon only) |
| 09:00 | Yes |
| 17:00 | Yes |

**Recommended slot for vendor-smoke:** `0 8 * * *` (08:00 UTC daily) — confirmed clear from all migration files. [VERIFIED: no `0 8` pattern found in migration grep]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-time bearer compare | `===` string equality | `constantTimeEqual` from `_shared/lifecycle-utils.ts` | Timing oracle attack prevention |
| Service-role auth check | Custom bearer logic | `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` | Already handles env var read + constant-time compare correctly |
| Lazy admin client | Module-level `createClient()` | `makeLazyAdmin()` from `_shared/lifecycle-utils.ts` | Enables test injection; prevents init before env vars are set |
| pg_cron vault bearer | Hardcoded key literal | `vault.decrypted_secrets WHERE name='service_role_key'` | Security — keys must never appear as string literals in migrations |
| BAA row upsert logic | New table | Existing `vendor_baa_chain` + `vendor_baa_chain_update` RPC | Compliance audit trail already wired; Phase 25 explicitly prohibits parallel tables |
| JSON CORS response | Hand-rolled headers | `jsonResponse`/`jsonError` from lifecycle-utils | CORS headers already correct in shared util |

**Key insight:** Every piece of Edge Fn boilerplate has been solved by `_shared/lifecycle-utils.ts`. Any hand-rolled version will likely be missing the test-injectable pattern or have a subtle CORS omission.

---

## Secrets Registry (Full List)

Complete list of secrets for the runbook and Phase 52 registration. Entries marked `[EXISTING]` are already present in Supabase secrets; entries marked `[NEW]` must be registered as names now (values deferred to Phase 70).

### Supabase Function Secrets

| Secret Name | Vendor | Status | Consuming Phases |
|-------------|--------|--------|-----------------|
| `RESEND_API_KEY` | Resend | [EXISTING] | All email Fns |
| `RESEND_FROM` | Resend | [EXISTING] | All email Fns |
| `STRIPE_SECRET_KEY` | Stripe | [EXISTING] | stripe-webhook, billing Fns |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Play/FCM | [EXISTING? pending] | Phase 53, 54 |
| `FCM_SERVER_KEY` | Firebase/FCM | [NEW] | Phase 54 |
| `MUX_TOKEN_ID` | Mux | [EXISTING for community] | Phase 44, 60, 61 |
| `MUX_TOKEN_SECRET` | Mux | [EXISTING for community] | Phase 44, 60, 61 |
| `MUX_WEBHOOK_SIGNING_SECRET` | Mux | [EXISTING for community] | Phase 44 mux-webhook |
| `CALENDLY_OAUTH_CLIENT_ID` | Calendly | [EXISTING? pending] | calendly-oauth-start/callback |
| `CALENDLY_OAUTH_CLIENT_SECRET` | Calendly | [EXISTING? pending] | calendly-oauth-callback |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Calendly | [NEW] | calendly-webhook |
| `CALENDLY_API_KEY` | Calendly | [NEW] | vendor-smoke + Phase 63 |
| `BETTER_STACK_API_KEY` | Better Stack | [NEW] | vendor-smoke + Phase 67 |
| `BETTER_STACK_PAGE_ID` | Better Stack | [NEW] | Phase 67 |
| `SENTRY_DSN` | Sentry | [EXISTING - partial, needs Edge Fn verification] | All Edge Fns via _shared/sentry.ts |
| `ANTHROPIC_API_KEY` | Anthropic (consumer) | [EXISTING - browser BYO; server key separate] | claude-moderation |
| `ANTHROPIC_CLINICAL_API_KEY` | Anthropic (clinical) | [EXISTING? pending BAA] | ai-chat clinical branch |
| `ANTHROPIC_CLINICAL_BAA_ACTIVE` | Anthropic (config) | [EXISTING, set to '0' or '1'] | ai-chat |
| `POSTHOG_PERSONAL_API_KEY` | PostHog | [v1.3 carry-over, NOT set] | onboarding-funnel-query, dsar-export |
| `POSTHOG_PROJECT_ID` | PostHog | [v1.3 carry-over, NOT set] | onboarding-funnel-query |
| `POSTHOG_PROJECT_KEY` | PostHog | [EXISTING - variant-resolver] | variant-resolver |
| `SLACK_WEBHOOK_EXPERIMENTS_URL` | Slack | [v1.3 carry-over, NOT set] | experiment notifications |
| `SHARE_TOKEN_SECRET` | Internal | [v1.3 carry-over, NOT set] | share-token verification |
| `QUARTERLY_NPS_SIGNING_KEY` | Internal | [v1.3 carry-over, NOT set] | quarterly NPS |
| `APNS_KEY_ID` | Apple (APNs) | [NEW] | Phase 54 push notifications |
| `APNS_TEAM_ID` | Apple | [NEW] | Phase 54 |
| `APNS_P8_KEY` | Apple | [NEW] | Phase 54 (private key base64) |
| `RC_API_KEY_IOS` | RevenueCat | [NEW] | Phase 53 |
| `RC_API_KEY_ANDROID` | RevenueCat | [NEW] | Phase 53 |
| `REVENUECAT_WEBHOOK_SECRET` | RevenueCat | [NEW] | Phase 53 |
| `PLAY_PACKAGE_NAME` | Google Play | [NEW] | Phase 53 |
| `VAPID_PRIVATE_KEY` | Web Push | [NEW] | Phase 54 |

### Vercel Env (Build-Time Public)

| Env Name | Type | Purpose |
|----------|------|---------|
| `VITE_VAPID_PUBLIC_KEY` | public | Web push client subscription |
| `ADMOB_APP_ID_IOS` | public | Phase 56 AdMob iOS |
| `ADMOB_APP_ID_ANDROID` | public | Phase 56 AdMob Android |
| `ADMOB_PUBLISHER_ID` | public | Phase 56 AdMob |
| `ADSENSE_PUBLISHER_ID` | public | Phase 56 AdSense |
| `APPLE_TEAM_ID` | public | Existing, Phase 53 |
| `APPLE_BUNDLE_ID` | public | Existing, Phase 53 |
| `PLAY_PACKAGE_NAME` | public | Phase 53 |

**vercel.json does NOT interpolate env vars** — do not put `${VITE_*}` in vercel.json for CSP headers or any other static config. [VERIFIED: `reference_vercel_json_no_env_interpolation` project memory]

---

## Common Pitfalls

### Pitfall 1: `$$` Nesting in pg_cron Body

**What goes wrong:** Using `$$...$$` for the outer cron body AND having `$$...$$` in the inner SQL body causes the Postgres parser to close the outer quote at the FIRST inner `$$`. The migration silently runs a truncated or syntactically broken cron body.

**Why it happens:** Postgres dollar-quoting is greedy on the FIRST matching `$$` close.

**How to avoid:** Use named dollar-quote tags for cron: `$cron$...$cron$`. Inner SQL can then use plain `$$..$$`. [VERIFIED: `reference_postgres_dollar_quote_nesting_in_cron_body` project memory]

**Warning signs:** `ERROR: syntax error at or near DECLARE` during migration.

### Pitfall 2: deno test on a directory with Deno.serve

**What goes wrong:** `deno test vendor-smoke/` imports `index.ts` which calls `Deno.serve()` at module top level. This starts a real HTTP server, blocks on a listen loop, and all tests abort with dangling promise errors.

**Why it happens:** Supabase Edge Fns use `Deno.serve()` without `import.meta.main` guard — by design (not our decision to fix).

**How to avoid:** Test individual files: `deno test --no-check vendor-smoke/index.test.ts`. [VERIFIED: `reference_deno_test_top_level_serve_trap` project memory + baa-expiry-check deno.json uses `deno test --no-check .`]

**Note on baa-expiry-check:** Its `deno.json` uses `deno test --allow-all --import-map=../import_map.json` not `--no-check .` but the `import_map.json` is now silently ignored by CLI v2.101.0. The vendor-smoke `deno.json` should use `deno test --no-check .` following the mux-create-upload pattern.

### Pitfall 3: ShieldCheckIcon import collision

**What goes wrong:** `modules.ts` already imports `ShieldCheck as ShieldCheckIcon` at line 45 (for the embeds module). Adding another `ShieldCheck` import will cause a TypeScript duplicate identifier error.

**How to avoid:** Reuse the existing `ShieldCheckIcon` constant. No new import needed — the `vendor-smoke` entry should reference `ShieldCheckIcon` directly (same icon as embeds module). [VERIFIED: modules.ts line 45]

### Pitfall 4: service_role can't UPDATE vendor_baa_chain

**What goes wrong:** Attempting a raw `.from('vendor_baa_chain').update(...)` from the Edge Fn (service_role) fails with a 403 because Phase 25 explicitly revoked UPDATE from service_role.

**Why it happens:** Pattern S2 dual-layer security — `REVOKE UPDATE, DELETE ON vendor_baa_chain FROM service_role` at migration level.

**How to avoid:** For new Phase 52 vendor rows, use a migration with `INSERT ... ON CONFLICT DO NOTHING`. For status transitions, use the `vendor_baa_chain_update` SECDEF RPC from the admin UI (authenticated superadmin call). [VERIFIED: 20270702000001_vendor_baa_chain.sql line 132]

### Pitfall 5: Fn deploy before cron db push

**What goes wrong:** The cron migration fires within 15 minutes of `supabase db push`, hitting the Fn endpoint before the Fn is deployed. The Fn 404s, and the first smoke run is a failure that triggers a false alarm in the dashboard.

**How to avoid:** Deploy the `vendor-smoke` Fn FIRST, then run `supabase db push` for the cron migration. [VERIFIED: `feedback_fn_deploy_before_cron_db_push` project memory]

### Pitfall 6: Logging error messages that contain auth header fragments

**What goes wrong:** `catch (e) { console.warn(e.message) }` on a failed `fetch()` call can leak the Authorization header value in certain network-layer error messages.

**How to avoid:** Log `e.name` or a fixed string only. Never `e.message` in network error handlers. [VERIFIED: pattern from resend-domain-health-check.ts + aws-ses-health-check.ts]

### Pitfall 7: Back-dated migration blocks supabase db push

**What goes wrong:** If the vendor-smoke migration timestamp is older than the remote's last applied migration, `supabase db push` refuses to push anything.

**How to avoid:** Always use a future-dated timestamp (e.g., `20280101000001_...`) for new migrations in v1.4. [VERIFIED: `reference_supabase_back_dated_migration_blocks_push` project memory]

---

## Code Examples

### Edge Fn Skeleton (vendor-smoke/index.ts)

```typescript
// Source: [ASSUMED] — pattern from baa-expiry-check/index.ts (VERIFIED structure)
import {
  checkServiceRoleBearer,
  bearerFromReq,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

type SmokeStatus = 'ok' | 'fail' | 'not_configured';

interface SmokeResult {
  status: SmokeStatus;
  latency_ms: number | null;
  message: string | null;
}

interface VendorHandler {
  vendor_name: string;
  smoke: () => Promise<SmokeResult>;
}

// Auth: accept service-role bearer (cron) OR staff JWT (UI invoke)
async function isAuthorized(req: Request): Promise<boolean> {
  if (checkServiceRoleBearer(req)) return true;
  const bearer = bearerFromReq(req);
  if (!bearer) return false;
  const { data: { user }, error } = await admin.auth.getUser(bearer);
  if (error || !user) return false;
  const { data } = await admin
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();
  return data?.is_staff === true;
}

// Helper: not_configured shortcut
const notConfigured = (): SmokeResult => ({ status: 'not_configured', latency_ms: null, message: null });

// ... vendor registry + handlers ...

async function handleRun(_req: Request): Promise<Response> {
  const results: Record<string, SmokeResult> = {};
  let failed = 0;
  let not_configured_count = 0;

  for (const handler of VENDOR_REGISTRY) {
    const result = await handler.smoke();
    results[handler.vendor_name] = result;
    if (result.status === 'fail') failed++;
    if (result.status === 'not_configured') not_configured_count++;

    await admin
      .from('vendor_smoke_log')
      .upsert({
        vendor_name: handler.vendor_name,
        status: result.status,
        latency_ms: result.latency_ms,
        message: result.message,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'vendor_name' });
  }

  return jsonResponse(200, {
    ok: failed === 0,
    checked: VENDOR_REGISTRY.length,
    failed,
    not_configured: not_configured_count,
    results,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!(await isAuthorized(req))) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[vendor-smoke] unhandled', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest };
```

### vendor_smoke_log Migration

```sql
-- supabase/migrations/20280101000001_vendor_smoke_log.sql
-- Source: [ASSUMED] — follows project migration conventions

DO $$ BEGIN
  CREATE TYPE public.vendor_smoke_status AS ENUM ('ok', 'fail', 'not_configured');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.vendor_smoke_log (
  vendor_name   text                        PRIMARY KEY,
  status        public.vendor_smoke_status  NOT NULL DEFAULT 'not_configured',
  latency_ms    integer,
  message       text,
  checked_at    timestamptz                 NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_smoke_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_smoke_log_select_staff
  ON public.vendor_smoke_log
  FOR SELECT
  USING (public.is_staff());

-- Cron schedule
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'vendor-smoke-check',
  '0 8 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
```

### AdminVendorSmokeDashboard.tsx (skeleton)

```tsx
// Source: [VERIFIED UI-SPEC from 52-UI-SPEC.md] + [VERIFIED AdminShell pattern]
// Location: leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx
import { useEffect, useState } from 'react';
import { ShieldCheck, Play } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

type SmokeStatus = 'ok' | 'fail' | 'not_configured';
const BADGE_TONE: Record<SmokeStatus, 'success' | 'danger' | 'neutral'> = {
  ok: 'success', fail: 'danger', not_configured: 'neutral',
};
// ... full implementation per UI-SPEC
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-phase secret provisioning | Phase 52 consolidated vendor setup | v1.4 milestone authoring (2026-05-25) | Eliminates 7 unset secrets at v1.3 close |
| `--import-map` flag on supabase fn deploy | Per-function `deno.json` with `imports` block | Supabase CLI v2.101.0 (2026-05-22) | All new Fns MUST have deno.json |
| Legacy HS256 JWT service_role_key | `sb_secret_*` format | Supabase platform update 2026 | `checkServiceRoleBearer` from lifecycle-utils handles this correctly |

**Deprecated/outdated:**
- `app.service_role_key` GUC in cron bodies: Does NOT exist on this project. Use vault pattern.
- `--import-map` CLI flag: Silently ignored since v2.101.0.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | APNs JWT mint via ES256 is achievable in Deno without a device token (proves key validity) | Per-Vendor Smoke: Apple/APNs | Low — if JWT mint fails format-wise, change smoke to presence-check only |
| A2 | FCM token mint uses `https://oauth2.googleapis.com/token` with service-account JSON | Per-Vendor Smoke: FCM | Low — this is the standard Google OAuth2 endpoint; failure means wrong URL only |
| A3 | Mux Basic auth GET `/video/v1/assets?limit=1` returns 200 or 404 for valid credentials | Per-Vendor Smoke: Mux | Low — mux-create-upload uses same credentials format; if endpoint changes, easy to update |
| A4 | Calendly GET `/v1/users/me` accepts `CALENDLY_API_KEY` as personal access token | Per-Vendor Smoke: Calendly | Low — Calendly API docs confirm this endpoint; no session required |
| A5 | Better Stack uptime API at `uptime.betterstack.com/api/v2/monitors` accepts Bearer token | Per-Vendor Smoke: Better Stack | Low — standard REST pattern for Better Stack Uptime API |
| A6 | Sentry ingest envelope URL is derivable from DSN by parsing host + project_id | Per-Vendor Smoke: Sentry | Low — DSN format is documented; URL construction is deterministic |
| A7 | PostHog GET `/api/projects/<id>/` accepts `POSTHOG_PERSONAL_API_KEY` as Bearer | Per-Vendor Smoke: PostHog | Low — confirmed from onboarding-funnel-query Fn usage pattern |
| A8 | Stripe GET `/v1/balance` is the standard liveness check for a Stripe key | Per-Vendor Smoke: Stripe | Low — industry-standard approach; /v1/balance requires valid key |
| A9 | Cron slot `0 8 * * *` (08:00 UTC) is currently unclaimed | Cron Slot Assignment | Low — verified by grep; new migration could conflict only if another phase 52 sub-plan claims 08:00 |
| A10 | `vendor_baa_chain` INSERT via migration is permitted for new pending rows (migration role, not service_role) | Reuse Inventory | LOW risk — migrations run as migration role which has full table access; service_role REVOKE only blocks runtime Fn access |
| A11 | `CALENDLY_OAUTH_CLIENT_ID` env name from calendly-oauth-start is `CALENDLY_OAUTH_CLIENT_ID` (not `CALENDLY_CLIENT_ID` as in VENDOR-05 REQUIREMENTS.md) | Secrets Registry | MEDIUM — there is a naming discrepancy. REQUIREMENTS.md says `CALENDLY_CLIENT_ID`; actual code uses `CALENDLY_OAUTH_CLIENT_ID`. Runbook should document both names; planner should reconcile with what's already set. |
| A12 | Anthropic smoke can be done with `claude-haiku-3-5` model (cheapest) to prove key validity | Per-Vendor Smoke: Anthropic | Low — any valid model works for auth check; haiku minimizes cost |
| A13 | `ANTHROPIC_CLINICAL_API_KEY` is the correct env name (from ai-chat/index.ts line 45) vs REQUIREMENTS.md's `ANTHROPIC_API_KEY_CLINICAL` | Secrets Registry | MEDIUM — naming discrepancy. Planner should check `supabase secrets list` and align runbook with whatever is actually set. |

---

## Open Questions

1. **Calendly env var naming discrepancy**
   - What we know: REQUIREMENTS.md VENDOR-05 says `CALENDLY_CLIENT_ID`; `calendly-oauth-callback/index.ts` uses `CALENDLY_OAUTH_CLIENT_ID`; REQUIREMENTS.md VENDOR-09 mentions `CALENDLY_API_KEY`
   - What's unclear: Are both `CALENDLY_CLIENT_ID` (REQUIREMENTS) and `CALENDLY_OAUTH_CLIENT_ID` (code) distinct, or is the REQUIREMENTS.md using a shortened alias?
   - Recommendation: Planner should grep for all `CALENDLY_*` env.get calls and canonicalize in the runbook. If only `CALENDLY_OAUTH_CLIENT_ID` appears in code, use that name throughout.

2. **Anthropic env var naming discrepancy**
   - What we know: `ai-chat/index.ts` line 45 reads `ANTHROPIC_CLINICAL_API_KEY`; REQUIREMENTS.md VENDOR-08 says `ANTHROPIC_API_KEY_CLINICAL`
   - What's unclear: Which name is actually set in Supabase secrets? VENDOR-08's `supabase secrets list` check will confirm.
   - Recommendation: Planner pins to the name in `ai-chat/index.ts` (`ANTHROPIC_CLINICAL_API_KEY`) since that's what the consuming code reads.

3. **Mux credentials already set?**
   - What we know: Phase 44 shipped mux-create-upload and mux-webhook which use `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET`. These may already be set in Supabase secrets.
   - What's unclear: Were they actually set during Phase 44 execution or deferred?
   - Recommendation: Planner should run `supabase secrets list` as part of Wave 0 to determine which secrets are already set vs. need Phase 70 provisioning.

4. **vendor-smoke dual-auth: does supabase.functions.invoke pass JWT or anon key?**
   - What we know: `supabase.functions.invoke` from an authenticated browser session passes the user's JWT as the Authorization bearer.
   - What's unclear: Does the current project wiring ensure the authenticated user JWT is forwarded (not the anon key)?
   - Recommendation: Check how other staff-invoked Fns work (e.g., `baa-expiry-check` is cron-only; look at `admin-impersonate` or `admin-stripe-action` for the pattern). The `isAuthorized()` dual-path above handles both cases.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | supabase db push, fn deploy | ✓ | v2.101.0+ (project standard) | — |
| pg_cron extension | cron migration | ✓ | Already used in 30+ migrations | — |
| net extension | HTTP from pg_cron | ✓ | Already used in baa-expiry-check cron | — |
| vault extension | Service-role-key in cron | ✓ | Already used in baa-expiry-check cron | — |
| Deno | Edge Fn runtime | ✓ | Supabase-managed | — |
| `$HOME/.deno/bin/deno` | Local Fn tests | ✓ (per memory) | Not on PATH; invoke via full path | — |

**Missing dependencies with no fallback:** None identified.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno built-in test runner (`Deno.test`) |
| Config file | `supabase/functions/vendor-smoke/deno.json` — `tasks.test: "deno test --no-check ."` |
| Quick run command | `$HOME/.deno/bin/deno test --no-check supabase/functions/vendor-smoke/index.test.ts` |
| Full suite command | `$HOME/.deno/bin/deno test --no-check supabase/functions/vendor-smoke/` |
| Frontend tests | No new frontend test files (AdminVendorSmokeDashboard is read-only UI using existing patterns) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VENDOR-11 | vendor-smoke Fn returns `not_configured` when secret absent | unit | `deno test --no-check supabase/functions/vendor-smoke/index.test.ts` | ❌ Wave 0 |
| VENDOR-11 | vendor-smoke Fn returns `ok` with latency when probe succeeds | unit (stubbed HTTP) | same | ❌ Wave 0 |
| VENDOR-11 | vendor-smoke Fn returns `fail` on bad credentials | unit (stubbed HTTP) | same | ❌ Wave 0 |
| VENDOR-11 | vendor-smoke Fn rejects unauthorized request (no bearer) | unit | same | ❌ Wave 0 |
| VENDOR-11 | vendor-smoke Fn accepts service-role bearer | unit | same | ❌ Wave 0 |
| VENDOR-11 | vendor-smoke Fn upserts vendor_smoke_log row | unit (stubbed admin) | same | ❌ Wave 0 |
| VENDOR-11 | dashboard reads vendor_smoke_log and renders status badges | manual/smoke | navigate to /admin/vendor-smoke | ❌ manual |

### Wave 0 Gaps

- [ ] `supabase/functions/vendor-smoke/index.test.ts` — covers VENDOR-11 Fn auth + handler logic
- [ ] `supabase/functions/vendor-smoke/deno.json` — test task config

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `checkServiceRoleBearer` + staff JWT validation (dual-auth pattern) |
| V3 Session Management | no | Fn is stateless; cron or one-shot invoke |
| V4 Access Control | yes | `public.is_staff()` RLS on `vendor_smoke_log`; superadmin `minRole` in manifest |
| V5 Input Validation | yes | Vendor name from registry (not client input); no SQL injection vector |
| V6 Cryptography | yes | `constantTimeEqual` for bearer compare; no hand-rolled compare |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret value leaked in smoke log | Information Disclosure | Never log secret values; log only `e.name` on error; message field records error code not secret |
| Unauthorized staff-trigger | Elevation of Privilege | Dual-auth gate: `isAuthorized()` checks both service-role bearer AND `profiles.is_staff` |
| SSRF via vendor probe URL | Tampering | Registry is hardcoded (not user-supplied); no dynamic URL construction from request body |
| Timing oracle on bearer compare | Information Disclosure | `constantTimeEqual` from lifecycle-utils |
| Smoke log RLS bypass via service_role | Information Disclosure | `vendor_smoke_log` SELECT RLS applies to `authenticated` role; service_role bypasses for writes (intended — only the Fn writes) |

---

## Sources

### Primary (HIGH confidence — verified in codebase)

- `supabase/migrations/20270702000001_vendor_baa_chain.sql` — vendor_baa_chain schema, column names, RLS, service_role REVOKE
- `supabase/migrations/20270702000009_vendor_baa_chain_update_rpc.sql` — exact RPC signatures (vendor_baa_chain_update, vendor_baa_chain_set_expired, log_vendor_baa_event)
- `supabase/migrations/20270702000008_baa_alert_cron.sql` — pg_cron vault bearer pattern (exact SQL to copy)
- `supabase/migrations/20261101000006_is_staff_helper.sql` — `public.is_staff()` function signature and implementation
- `supabase/functions/baa-expiry-check/index.ts` — Edge Fn pattern (checkServiceRoleBearer, makeLazyAdmin, error handling)
- `supabase/functions/_shared/lifecycle-utils.ts` — all shared utilities (function signatures verified)
- `supabase/functions/_shared/resend-domain-health-check.ts` — vendor smoke handler pattern
- `supabase/functions/mux-create-upload/deno.json` — per-fn deno.json format (imports block, --no-check pattern)
- `supabase/functions/ai-chat/index.ts:45` — `ANTHROPIC_CLINICAL_API_KEY` env var name
- `leanshot/src/lib/admin/modules.ts` — ADMIN_MODULES manifest (exact shape, ShieldCheckIcon already imported)
- `leanshot/src/components/admin/AdminShell.tsx:116-120` — URL-prefix routing (exact module match logic)
- `leanshot/.planning/phases/52-vendor-setup-foundation/52-CONTEXT.md` — all locked decisions
- `leanshot/.planning/phases/52-vendor-setup-foundation/52-UI-SPEC.md` — dashboard component contract
- `leanshot/.planning/runbooks/hbnr-incident-response.md` — runbook directory structure (vendor-secrets.md goes alongside)

### Secondary (MEDIUM confidence — API endpoint patterns)

- Mux REST API: `GET /video/v1/assets?limit=1` with Basic auth [well-known, widely documented]
- Stripe REST: `GET /v1/balance` as standard liveness check [well-known]
- Resend REST: `GET /domains` — confirmed from `_shared/resend-domain-health-check.ts`
- Google OAuth2: token endpoint for service account JSON [standard Google auth pattern]
- Calendly: `GET /v1/users/me` [standard Calendly API docs pattern]
- PostHog: `GET /api/projects/<id>/` with Bearer — confirmed from `onboarding-funnel-query/index.ts`

### Tertiary (LOW confidence — needs confirmation at implementation time)

- Better Stack: `GET /api/v2/monitors` endpoint [single source, needs verification with actual API key]
- Sentry: envelope URL derivation from DSN [reasonable assumption; verify with Sentry docs before implementation]
- APNs: JWT-mint-only smoke without device token [assumption; may need alternative approach]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all reuse verified in codebase
- Architecture: HIGH — baa-expiry-check pattern is directly applicable and verified
- Schema: HIGH — vendor_baa_chain columns verified from migration file
- Per-vendor smoke endpoints: MEDIUM — public API patterns; A1-A8 assumptions flagged
- Naming consistency: MEDIUM — two env var discrepancies flagged (A11, A13)
- Pitfalls: HIGH — all from verified project memory and codebase inspection

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (Supabase CLI and vendor API endpoints stable; 30-day window)
