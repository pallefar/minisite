---
phase: 52-vendor-setup-foundation
reviewed: 2026-05-25T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - supabase/functions/vendor-smoke/index.ts
  - supabase/functions/vendor-smoke/index.test.ts
  - supabase/functions/vendor-smoke/deno.json
  - supabase/migrations/20280101000001_vendor_smoke_log.sql
  - supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql
  - leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx
  - leanshot/src/lib/admin/modules.ts
  - scripts/check-required-secrets.sh
  - .github/workflows/vendor-secrets-drift.yml
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: fixed
---

# Phase 52: Code Review Report

**Reviewed:** 2026-05-25T00:00:00Z
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 52 ships a dual-auth vendor-smoke Edge Function, a `vendor_smoke_log` table with
staff-only RLS, a daily pg_cron job using the vault bearer pattern, 8 BAA-chain seed rows,
an admin dashboard, and a CI secrets drift guard. The auth gate, constant-time comparison,
CORS handling, and vault bearer pattern are all correctly implemented. The SQL migration uses
named dollar-tags and correctly avoids `app.service_role_key` GUC. The dashboard renders
`row.message` and `row.vendor_name` as React text nodes (no XSS vector).

Two critical issues were found: the POSTHOG_PROJECT_KEY name in the drift-guard REQUIRED array
does not match the secret names (`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID`) actually
read by the Edge Function, making the required-check a no-op for PostHog; and the Anthropic
smoke probes use `claude-haiku-3-5` which is not a valid canonical Anthropic model ID for
this project (and is absent from the BAA allowlist), causing all Anthropic probe results to
be driven by a 400 response code rather than a genuine connectivity check.

---

## Critical Issues

### CR-01: PostHog drift-guard REQUIRED name does not match Edge Fn env vars

**File:** `scripts/check-required-secrets.sh:51`

**Issue:** `REQUIRED_SECRETS` contains `POSTHOG_PROJECT_KEY` (line 51). The vendor-smoke Edge
Function does NOT read `POSTHOG_PROJECT_KEY`. It reads `POSTHOG_PERSONAL_API_KEY` (line 313)
and `POSTHOG_PROJECT_ID` (line 314) — both of which are only in `DEFERRED_ALLOWLIST` (lines
65–66). This means:

1. The hard-fail guard watches a secret name (`POSTHOG_PROJECT_KEY`) that the smoke function
   never checks — this appears to be the frontend/Vite public project key, not the API auth
   credentials.
2. If `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_PROJECT_ID` drift (renamed or deleted), the guard
   will never hard-fail — it will only produce a deferred WARN at most.
3. The guard provides a false assurance that PostHog API credentials are monitored.

**Fix:** Replace `POSTHOG_PROJECT_KEY` in `REQUIRED_SECRETS` with `POSTHOG_PERSONAL_API_KEY`
and `POSTHOG_PROJECT_ID` (matching what the Edge Fn actually reads), and remove those two names
from `DEFERRED_ALLOWLIST`. If `POSTHOG_PROJECT_KEY` is also legitimately required for the
frontend, add it separately with a comment clarifying it is a Vite/frontend key, not the API
auth credentials for vendor-smoke.

```bash
# In REQUIRED_SECRETS array — replace:
POSTHOG_PROJECT_KEY
# with:
POSTHOG_PERSONAL_API_KEY
POSTHOG_PROJECT_ID

# In DEFERRED_ALLOWLIST — remove:
POSTHOG_PERSONAL_API_KEY
POSTHOG_PROJECT_ID
```

---

### CR-02: Anthropic smoke probes use invalid model ID `claude-haiku-3-5`

**File:** `supabase/functions/vendor-smoke/index.ts:219` and `:250`

**Issue:** Both `anthropicClinicalHandler` (line 219) and `anthropicConsumerHandler` (line 250)
POST with `model: 'claude-haiku-3-5'`. This model ID is not a valid canonical identifier in
this codebase:

- Every other Edge Function uses the date-suffixed form: `claude-haiku-4-5-20251001`
  (`claude-moderation/index.ts:25`, `_shared/anthropic-baa-allowlist.ts:31`).
- `claude-haiku-3-5` is absent from `_shared/anthropic-baa-allowlist.ts` BAA_COVERED_MODELS.
- The Anthropic API returns HTTP 400 for unknown model IDs. The probe's 400-is-ok rule
  (`if (res.status === 200 || res.status === 400) return { status: 'ok', ... }`) masks this:
  a probe that always returns 400 (invalid model) is treated identically to one that returns
  200 (genuine success). The "connectivity check" is not actually exercising a valid API call.
- For the clinical handler specifically, calling with a non-BAA-allowlisted model via the
  clinical API key is a compliance policy gap even if the probe body contains no PHI.

**Fix:** Use a model ID that matches the project allowlist. The cheapest option already in the
allowlist is `claude-haiku-4-5-20251001`:

```typescript
body: JSON.stringify({
  model: 'claude-haiku-4-5-20251001',   // was: 'claude-haiku-3-5'
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
}),
```

Apply identically to both `anthropicClinicalHandler` (line 219) and `anthropicConsumerHandler`
(line 250).

---

## Warnings

### WR-01: `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID` are dead reads in the APNs handler

**File:** `supabase/functions/vendor-smoke/index.ts:457-460`

**Issue:** `appleTeamId` (from `APPLE_TEAM_ID`) and `bundleId` (from `APPLE_BUNDLE_ID`) are
read and included in the `notConfigured` guard (line 460), but are never referenced anywhere
in the JWT construction. The JWT payload uses `teamId` (from `APNS_TEAM_ID`) as `iss` —
`appleTeamId` is never read again after the guard. This means:

- Operators must provision two extra secrets (`APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`) that the
  smoke probe does not actually use, creating unnecessary operational burden.
- If `APPLE_TEAM_ID` and `APNS_TEAM_ID` hold different values (e.g., duplicated incorrectly),
  the guard passes but the JWT is minted with the wrong team ID — the discrepancy is invisible.
- Both secrets are in `DEFERRED_ALLOWLIST` in the drift guard; since the probe never uses them,
  their absence only gates `notConfigured` — they inflate the notConfigured trigger without
  contributing to the smoke test.

**Fix:** Either remove the dead reads from the presence guard, or actually use `appleTeamId`
to cross-validate against `teamId`. The simpler fix:

```typescript
// Remove appleTeamId and bundleId from presence check — the JWT only needs:
// APNS_KEY_ID (kid header) + APNS_TEAM_ID (iss payload) + APNS_P8_KEY (signing key)
const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
const p8Key = Deno.env.get('APNS_P8_KEY') ?? '';

if (!keyId || !teamId || !p8Key) return notConfigured();
```

---

### WR-02: FCM_SERVER_KEY is an orphaned entry in `DEFERRED_ALLOWLIST`

**File:** `scripts/check-required-secrets.sh:57`

**Issue:** `DEFERRED_ALLOWLIST` contains `FCM_SERVER_KEY` (line 57). This is the legacy FCM
HTTP v1 server key. The `fcmHandler` in `vendor-smoke/index.ts` does not read `FCM_SERVER_KEY`
at all — it reads `PLAY_SERVICE_ACCOUNT_JSON` (line 361), which is already separately tracked
in `DEFERRED_ALLOWLIST` (line 77). `FCM_SERVER_KEY` appears nowhere in any Edge Function
source. This orphaned entry creates confusion about which secret actually controls FCM
connectivity and may cause operators to provision the wrong secret type.

**Fix:** Remove `FCM_SERVER_KEY` from `DEFERRED_ALLOWLIST` and add a comment clarifying
that FCM is handled via `PLAY_SERVICE_ACCOUNT_JSON` (OAuth2 service account, not legacy API key):

```bash
# DEFERRED_ALLOWLIST — remove:
FCM_SERVER_KEY
# (FCM auth uses PLAY_SERVICE_ACCOUNT_JSON / OAuth2 service account — not a server key)
```

---

### WR-03: `fcmHandler` fetches `token_uri` from the service account JSON without URL validation

**File:** `supabase/functions/vendor-smoke/index.ts:377,428`

**Issue:** `tokenUri` is read directly from the parsed service account JSON (line 377) and
used as the fetch target (line 428) with no validation that it begins with
`https://oauth2.googleapis.com`. A maliciously crafted `PLAY_SERVICE_ACCOUNT_JSON` could
redirect the OAuth2 fetch to an arbitrary internal URL (SSRF). While `PLAY_SERVICE_ACCOUNT_JSON`
is a Supabase project secret (operator-controlled), a supply-chain compromise of that secret
or a misconfigured rotation could expose internal network endpoints reachable from the Edge
Function runtime.

**Fix:** Validate `tokenUri` before use:

```typescript
const tokenUri = serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';

// Validate — must be the Google token endpoint
if (!tokenUri.startsWith('https://oauth2.googleapis.com/')) {
  return { status: 'fail', latency_ms: null, message: 'invalid_token_uri' };
}
```

---

### WR-04: Dashboard issues data fetch before staff-check resolves

**File:** `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx:131-133`

**Issue:** The data-fetch `useEffect` (lines 131–133) fires unconditionally on mount with an
empty dependency array, before the staff-check `useEffect` (lines 93–115) has resolved.
A non-staff user who navigates to `/admin/vendor-smoke` will:

1. Mount the component.
2. Immediately fire a Supabase query against `vendor_smoke_log`.
3. The RLS policy (`public.is_staff()`) will block the query and return an error or empty set.
4. ~100–300 ms later, `isStaff` resolves to `false` and the component renders `NotAuthorizedCard`.

The RLS guard correctly blocks data, so no data leaks. However, this creates a redundant
network request on every non-staff visit. More importantly, if `fetchError` is set during the
RLS-blocked fetch before `isStaff` resolves, the component's `fetchError` state is set
uselessly and left dirty.

**Fix:** Gate the data fetch on `isStaff === true`:

```typescript
useEffect(() => {
  if (isStaff === true) {
    void fetchRows();
  }
}, [isStaff]);
```

---

## Info

### IN-01: CI workflow paths filter does not include `vendor-smoke/index.ts`

**File:** `.github/workflows/vendor-secrets-drift.yml:12-21`

**Issue:** The workflow triggers only on changes to `scripts/check-required-secrets.sh`,
`leanshot/.planning/runbooks/vendor-secrets.md`, and the workflow file itself. If a developer
adds a new vendor probe to `vendor-smoke/index.ts` reading a new env var name, the CI guard
will not fire. The drift between the guard's REQUIRED array and the actual env var names in
the Edge Function (already manifested in CR-01 for PostHog) can re-accumulate silently.

**Fix:** Add the vendor-smoke Edge Function to the path filter:

```yaml
paths:
  - 'scripts/check-required-secrets.sh'
  - 'leanshot/.planning/runbooks/vendor-secrets.md'
  - '.github/workflows/vendor-secrets-drift.yml'
  - 'supabase/functions/vendor-smoke/index.ts'   # add this
```

---

### IN-02: Fixed temp file path `/tmp/supabase_secrets_err` has collision risk on shared runners

**File:** `scripts/check-required-secrets.sh:143,145`

**Issue:** The stderr redirect from `supabase secrets list` uses the fixed path
`/tmp/supabase_secrets_err` (line 143). On a self-hosted runner executing multiple concurrent
CI jobs, two runs of this script would race on the same temp file — one job could read the
other's error output. The main temp file uses `mktemp` (line 185) correctly; the stderr file
does not.

**Fix:** Use `mktemp` for the stderr temp file as well:

```bash
_err_tmp=$(mktemp)
if ! raw=$(supabase secrets list --project-ref "$SUPABASE_PROJECT_REF" 2>"$_err_tmp"); then
  err=$(cat "$_err_tmp" 2>/dev/null || true)
  rm -f "$_err_tmp"
  ...
fi
rm -f "$_err_tmp"
```

---

### IN-03: `upsert` failure is invisible in the HTTP response body

**File:** `supabase/functions/vendor-smoke/index.ts:660-672`

**Issue:** When the `vendor_smoke_log` upsert fails (line 661), the function logs a warning
and continues, returning HTTP 200 with `ok: failed === 0`. The caller receives a success
response indicating all probes passed, but the results were never persisted. There is no
indication in the response body that the DB write was skipped.

This is noted as intentional (fail-soft contract), but it means the dashboard will show
stale data from the previous run after a failed upsert with no indication of why data is stale.
Consider adding a `db_write_ok: boolean` field to the response for observability:

```typescript
return jsonResponse(200, {
  ok: failed === 0,
  db_write_ok: !upsertErr,   // add this field
  checked: VENDOR_REGISTRY.length,
  failed,
  not_configured,
  results,
});
```

---

_Reviewed: 2026-05-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
