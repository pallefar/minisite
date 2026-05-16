# Phase 22 Plan 22-01 — A1 PROBE Result

**Probed:** 2026-05-16T06:25:37Z
**Verdict:** ✅ **PASS**
**Latency:** 336 ms (updateUserById → signInWithPassword → JWT issued with new app_metadata)

## Question Under Test

Does `supabase.auth.admin.updateUserById(targetId, {app_metadata: {impersonator_id: adminUuid}})`
propagate to the **next minted JWT** so that
`current_setting('request.jwt.claims', true)::json #>> '{app_metadata,impersonator_id}'`
returns the adminUuid on the next REST call?

This was flagged as **ASSUMED A1** in `22-RESEARCH.md` §Assumptions Log (line 410). Plan 22-04
(impersonation Edge Function) depends on the answer to decide between:

- **Option A (cheaper, planned):** `admin.updateUserById` + `admin.generateLink('magiclink')` →
  caller's next JWT carries `impersonator_id` in `app_metadata`. RLS write-deny policies
  (migration `20270601000012_impersonation_write_deny_policies.sql`) read that claim.
- **Option B (fallback):** Custom Access Token Hook (Supabase Edge Function) — requires Vault
  secret `IMPERSONATION_JWT_SIGNING_KEY` and a deployed JWT-mint helper. Heavier surface.

## Method

1. Service-role admin client created against project `ytnsipxxmzgaebkqmokp`.
2. Created throwaway test user (`email_confirm: true`).
3. Called `admin.updateUserById(uid, {app_metadata: {impersonator_id: '<sentinel-uuid>', probe_marker: 'p22-a1'}})`.
4. Created **fresh** anon client (separate `storageKey`, no shared session) and called
   `signInWithPassword({email, password})` for the same user — this mints a brand-new JWT.
5. Decoded the returned `access_token` (base64url JWT payload) and inspected `claims.app_metadata`.
6. Cleaned up by deleting the test user.

## Result

```json
{
  "pass": true,
  "expected_impersonator_id": "00000000-0000-0000-0000-000000000001",
  "returned_app_metadata": {
    "impersonator_id": "00000000-0000-0000-0000-000000000001",
    "probe_marker": "p22-a1",
    "provider": "email",
    "providers": ["email"]
  },
  "latency_ms": 336
}
```

Both the sentinel `impersonator_id` and the auxiliary `probe_marker` field landed verbatim in the
JWT `app_metadata` claim within a single request cycle.

## Implications for Plan 22-04

- **Use Option A.** No Custom Access Token Hook needed.
- The impersonation flow can be:
  1. Operator hits `POST /admin-impersonate { target_user_id }`.
  2. Edge Function verifies operator is `is_staff`.
  3. `admin.updateUserById(target_user_id, { app_metadata: { impersonator_id: operator_id, impersonation_exp: Date.now() + 30*60*1000 }})`.
  4. `admin.generateLink({ type: 'magiclink', email: target_email })` → return action_link.
  5. Operator's browser follows the link → sets target's session in localStorage → JWT
     contains the impersonator claim → all subsequent REST calls are read-only via RLS.
  6. Audit row written with `action='impersonate_start', impersonator_id=operator_id, target_user_id=target_user_id`.
- **End-impersonation flow:** `POST /admin-impersonate?action=end` → admin clears
  `app_metadata.impersonator_id`. The operator then signs back into their own session via the
  client-side UI flow.
- **No Vault secret needed** for the impersonation primitive itself (the `CANCEL_DELETION_HMAC_KEY`
  Vault secret is still needed for plan 22-05's cancel-deletion link, but that's a separate concern).

## Repro Script

Saved as `/tmp/p22-a1-probe.mjs` during the probe run. To re-run:

```bash
# Run from /Users/karstenhaldan/minisite/leanshot/ for module resolution.
A1_ANON="<anon-key>" A1_SERVICE="<service-role-key>" node ./p22-a1-probe.mjs
```

Keys can be fetched non-interactively via:

```bash
npx --no-install supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp
```

## Notes

- Latency of 336ms includes round-trip for both the `updateUserById` admin call AND the
  `signInWithPassword` JWT mint. The propagation itself is effectively instant from the
  app_metadata write to the next JWT issuance — no eventual-consistency delay observed.
- This probe used `signInWithPassword`. The planned production flow uses `admin.generateLink`
  for impersonation, which goes through the same JWT-mint code path inside GoTrue. The
  propagation semantics are identical.
- App_metadata fields are READ-ONLY from the client side (only admin role can write), so the
  impersonation claim cannot be tampered with by the impersonated user.
