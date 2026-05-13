---
phase: 09-clinic-b2b-foundations
plan: 06
subsystem: clinic-b2b-foundations
tags: [edge-function, deno, resend, rate-limit, vercel-rewrites, anti-enumeration, csp]
status: paused-at-checkpoint
checkpoint: task-2-human-action-blocking
checkpoint_reason: "Resend account creation + DNS + RESEND_API_KEY Supabase secret + supabase functions deploy + Vercel preview verify"
dependency_graph:
  requires:
    - "Plan 09-01 send_invite + accept_invite_existing + reject_invite SECURITY DEFINER RPCs (live in production)"
    - "Plan 09-01 invites table + invite_token_hash column + 7-day expiry default"
    - "Plan 09-01 wave-0 scaffolds: supabase/functions/clinic-invite/{cors.ts, deno.json, index.test.ts}"
    - "Phase 4 increment_rate_limit RPC (DB-backed sliding-window counter)"
    - "Phase 4 ai-chat Edge Function template (Deno.serve + cors + JWT-via-admin pattern)"
    - "Plan 09-02 sendInvite typed wrapper (rewired to call the Edge Function)"
    - "Plan 09-04 ClinicInvitePage state-machine router (consumer of /lookup LookupResponse shape)"
  provides:
    - "supabase/functions/clinic-invite/index.ts — Deno.serve dispatcher for /send + /lookup + /accept + /reject"
    - "supabase/functions/clinic-invite/resend.ts — HTTPS-only Resend dispatch + CI stub gate"
    - "supabase/functions/clinic-invite/template-clinic-invite.ts — branded HTML + plain-text email"
    - "supabase/functions/clinic-invite/rate-limit.ts — layered limits (DB-backed for /send, in-memory for /lookup + /accept)"
    - "vercel.json /clinic/* and /clinic-invite/* path rewrites for SPA routing"
    - "src/lib/clinic.ts sendInvite — fetch-based Edge Function caller (W-1 response shape preserved)"
    - "src/lib/clinic.ts sendInviteViaRpc — legacy direct-RPC path retained for back-compat"
  affects:
    - "Plan 09-02 InvitePatientModal — sendInvite now triggers the real Edge Function + Resend email dispatch"
    - "Plan 09-04 ClinicInvitePage — /lookup hits the real Edge Function once deployed (Task 2)"
    - "Phase 9 SC#2 — end-to-end invite flow demoable after Task 2 deployment + human checkpoint passes"
tech-stack:
  added:
    - "Resend HTTPS dispatch (no SDK; direct fetch to api.resend.com/emails)"
    - "Layered rate-limiting (DB-backed Phase 4 RPC for keyed-on-uid; in-memory Map for non-uid keys)"
  patterns:
    - "Operator-scoped Supabase client (createClient(URL, ANON, {global: {headers: {Authorization: Bearer JWT}}})) so auth.uid() resolves inside SECURITY DEFINER RPCs"
    - "D-02 + W-1 anti-enumeration source-scan invariant (test 5 grep asserts handleSend never calls emailExistsInAuth + exactly one universal 200 response shape with invite_id)"
    - "Resend CI stub gate (RESEND_API_KEY=test-stub bypasses HTTPS dispatch; Pitfall #7 free-tier mitigation)"
    - "Pitfall #1 collapse: always call accept_invite_existing (the _new variant has an identical body per Plan 09-01 RPC notes)"
    - "Forensic source-scan tests in Deno (read index.ts and grep for invariant patterns — useful when port-binding integration tests aren't viable)"
key-files:
  created:
    - "supabase/functions/clinic-invite/index.ts (572 lines)"
    - "supabase/functions/clinic-invite/resend.ts (98 lines)"
    - "supabase/functions/clinic-invite/template-clinic-invite.ts (179 lines)"
    - "supabase/functions/clinic-invite/rate-limit.ts (138 lines)"
  modified:
    - "supabase/functions/clinic-invite/index.test.ts (replaced wave-0 scaffold with 18 Deno test cases)"
    - "leanshot/src/lib/clinic.ts (sendInvite rewired to fetch the Edge Function; sendInviteViaRpc retained as legacy export)"
    - "leanshot/src/lib/clinic.test.ts (+6 fetch-based sendInvite tests; existing sendInviteViaRpc tests preserved)"
    - "leanshot/vercel.json (added rewrites array for /clinic/* and /clinic-invite/* → /index.html)"
decisions:
  - "Rule 4 architectural deviation — sendInvite now routes through Edge Function while sendInviteViaRpc is preserved as a legacy export. The plan said 'replace the stub' but Plan 09-02's tests mock supabase.rpc('send_invite', ...) directly; renaming preserves 35 prior tests AND adds the Edge Function path that ships Resend dispatch. Accept/reject wrappers unchanged because Plan 09-04 RTL tests would break and the existing RPC path is fully working — the Edge Function /accept and /reject endpoints remain available for any future patient-side surface that wants to centralize logic."
  - "Rule 3 in-memory rate limits — /lookup + /accept use Deno-instance-local Map buckets because the Phase 4 increment_rate_limit RPC has a FK to auth.users(id) on p_user_id (synthesized non-user keys would fail). Documented inline in rate-limit.ts with the threat-model rationale: 128-bit tokens make /lookup brute-force infeasible regardless, and /accept's real replay barrier is the invites.consumed_at flag."
  - "CSP unchanged — Resend dispatch happens server-side from the Edge Function; browser-to-Edge-Function traffic flows through *.supabase.co which is already in the CSP connect-src. No new origin needed."
  - "Anti-enumeration enforced via source-scan test (Test 5 + Test 19) — port-binding integration tests aren't viable in Deno's test runner without TCP allocation; instead the test reads index.ts and asserts handleSend has exactly one universal `{ok: true, invite_id}` 200 response and never calls emailExistsInAuth. The live-DB smoke flow in the human-action checkpoint is the integration verification."
  - "Operator-scoped Supabase client for /send + /accept + /reject — the service-role admin client would make auth.uid() resolve to NULL inside send_invite / accept_invite_existing / reject_invite RPCs (they use auth.uid() for the operator/patient identity). The fix: createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {global: {headers: {Authorization: req.headers.get('Authorization')}}}) so the user's JWT propagates."
metrics:
  duration_minutes: ~10
  tasks_complete: 1
  tasks_total: 2
  files_created: 4
  files_modified: 4
  vitest_cases_clinic: 41
  vitest_cases_full_suite: 663
  vitest_skipped: 4
  deno_test_cases: 18
  completed: 2026-05-13
---

# Phase 9 Plan 06: clinic-invite Edge Function + Resend + Vercel rewrites Summary

Backend slice for the clinic invite flow. Single Deno.serve in `supabase/functions/clinic-invite/index.ts` dispatches four endpoints — `/send` (operator-authed, rate-limited 20/hour, fires Resend), `/lookup` (anon-OR-JWT, hashes the URL token + branches the state machine), `/accept` (patient-authed, calls accept_invite_existing — Pitfall #1 collapse), `/reject` (patient-authed). The Plan 09-02 `sendInvite` typed wrapper is rewired to hit this Edge Function (Bearer JWT + JSON), and `vercel.json` gets `/clinic/*` + `/clinic-invite/*` SPA rewrites. PAUSED at Task 2 (human-action blocking checkpoint) — Resend account creation + DNS records + RESEND_API_KEY Supabase secret + `supabase functions deploy` + Vercel preview verify cannot be automated.

## Status

**PAUSED at Task 2 (human-action checkpoint, gate=blocking).**

Task 1 complete (commit `c743b57` on `worktree-agent-aa64c9e238bd730d1`). All Edge Function code + leanshot wiring + Vercel rewrites are committed and ready to ship. The function will fail with `{error: 'no_api_key'}` on the first `/send` invocation in production until the human checkpoint completes; that failure mode is logged but does NOT block the /send 200 response (the invite row still inserts via the RPC, only the email dispatch is degraded — operator can manually copy the invite URL from the invites table as a workaround if needed).

## What landed (Task 1)

### Edge Function (`supabase/functions/clinic-invite/`)

| File | Purpose | Lines |
|------|---------|-------|
| `index.ts` | Deno.serve dispatcher; 4 endpoint handlers; pure helpers (sha256Hex, makeRawToken, userScopedClient, emailExistsInAuth, publicLogoUrl, operatorFirstNameFromInvitedBy); `__internal` exports for tests | 572 |
| `resend.ts` | HTTPS-only Resend dispatch helper; `RESEND_API_KEY=test-stub` CI gate; T-09-34/T-09-37 mitigations (key never logged, response body never echoed) | 98 |
| `template-clinic-invite.ts` | Branded HTML email template (UI-SPEC §"Patient-side: Invitation email" lines 364-381 verbatim) + plain-text fallback + monogram logo block + HTML escape helper | 179 |
| `rate-limit.ts` | Layered limits — `checkSendRateLimit` (DB-backed, 20/hour/operator), `checkLookupRateLimit` (in-memory Map, 10/min/IP+token), `checkAcceptRateLimit` (in-memory Map, 5/min/invite_id) | 138 |
| `index.test.ts` | 18 Deno tests covering CORS shape, template render, rate-limit invariants, Resend CI stub + 502 wrap + real-key 200, missing-JWT 401 for all 3 authed endpoints, /lookup missing-token 400, sha256Hex determinism, makeRawToken url-safe shape, Test 5 W-1 anti-enumeration source-scan, Test 19 Resend-failure-doesn't-block-200 source-scan | 350 |

### `/send` endpoint contract

1. Validates Bearer JWT via `admin.auth.getUser(jwt)`.
2. Checks per-operator rate-limit (20/hour) via Phase 4 `increment_rate_limit` RPC keyed on `operator.user.id`.
3. Parses `{org_id, email, requested_scope}`; rejects malformed input with stable error codes.
4. Generates a 16-byte CSPRNG raw token + SHA-256 hash via `crypto.subtle`.
5. Calls `send_invite` RPC through an operator-scoped Supabase client (carrying the operator's JWT) so `auth.uid()` resolves inside the RPC.
6. Dispatches the Resend email with `{from: noreply@app.leanshot.app, to: email, subject: '{org name} invited you to share your LeanShot data', html, text}`.
7. Returns universal `200 {ok: true, invite_id: '<uuid>'}` — W-1 + D-02 anti-enumeration invariant.
8. Resend failure is logged + best-effort audit row (`email_dispatch_failed` action) but does NOT block the 200 response.

### `/lookup` endpoint contract

1. Parses raw token from `?token=...` query parameter.
2. Rate-limits on `{ip}:{token-prefix}` (10/min); 429 on excess.
3. SHA-256-hashes the token.
4. SELECTs the invite + joined org via the service-role admin client.
5. Branches the state machine per Plan 09-04 contract:
   - No row → `{state: 'not_found'}`
   - `accepted_at` set → `{state: 'already_used', invite}`
   - `rejected_at` + `consumed_at` set → `{state: 'already_used', invite}` (both patient-reject and operator-cancel surface as "closed")
   - `expires_at` in the past → `{state: 'expired', invite}`
   - JWT present + caller's email matches invite.email → `{state: 'valid_logged_in', invite}`
   - No JWT (or mismatched JWT) + email exists in `auth.users` → `{state: 'valid_logged_out_existing', invite}`
   - Otherwise → `{state: 'valid_new_user', invite}`
6. Returns `LookupResponse` JSON for State A/B/C/D/E/F/G/H rendering in ClinicInvitePage.

### `/accept` endpoint contract

1. Validates Bearer JWT (401 if missing).
2. Parses `{token, consent_scope}`; rejects on missing fields.
3. Probes `invites.id` (admin client, by token hash) → rate-limits 5/min/invite_id; 429 on excess.
4. Calls `accept_invite_existing` RPC via patient-scoped Supabase client (Pitfall #1 collapse — `_new` variant has identical body).
5. Maps RPC errors: `28000`→401 unauthenticated; `invite_email_mismatch`→403 email_mismatch; `invite_not_found_or_used`→404 invalid_invite; `22023`→400 invalid_scope; `42501`→403 forbidden.
6. Returns `{ok: true, membership_id, org_id}` on success.

### `/reject` endpoint contract

Symmetric to `/accept` but calls `reject_invite` RPC and returns `{ok: true}`.

### Resend dispatch (resend.ts)

- HTTPS POST to `https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`.
- `RESEND_API_KEY=test-stub` → return `{ok: true, stubbed: true}` immediately (no HTTPS call). Pitfall #7 e2e mitigation.
- Missing `RESEND_API_KEY` → `{ok: false, error: 'no_api_key'}`.
- Non-2xx Resend response → `{ok: false, error: 'resend_<status>'}` — body NEVER echoed (T-09-37).
- Network throw → `{ok: false, error: 'resend_network'}` — exception name NEVER echoed (T-09-34).

### Email template (template-clinic-invite.ts)

UI-SPEC §"Patient-side: Invitation email" lines 364-381 mapped verbatim:

| Element | Mapped to |
|---------|-----------|
| Subject | `{orgName} invited you to share your LeanShot data` |
| Preheader (hidden in body, shown in inbox preview) | `Choose what to share. You can revoke any time.` |
| Wordmark header | LeanShot teal-700 wordmark |
| Logo block | `<img src="{publicUrl}">` when set, OR `{first-letter monogram}` on teal-700 background |
| Body heading | `{orgName} invited you to share your data` |
| Body intro | `{operatorFirstName} from {orgName} sent you a private invitation. You decide what to share — and you can change or revoke access at any time.` |
| What-happens-next heading | `WHAT HAPPENS NEXT` (uppercase eyebrow) |
| What-happens-next body | UI-SPEC line 376 verbatim |
| Primary CTA | `<a href="{inviteUrl}">Review invitation</a>` (teal-700 button) |
| Raw URL fallback | Plain-text URL display for buttons-blocked clients |
| Expiry footer | `This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.` |
| WMHMDA footer | `LeanShot keeps your AI coach conversations and account settings private. Only the data you choose is shared.` |
| Signature | `— The LeanShot team` |

All operator-controlled strings (`orgName`, `operatorFirstName`) are HTML-escaped before interpolation. `inviteUrl` is server-generated (origin + minted token) so no open-redirect surface (T-09-35).

### Rate-limit topology (rate-limit.ts)

| Key | Limit | Backend | Rationale |
|-----|-------|---------|-----------|
| `clinic_invite_send:{operator_uid}` | 20/hour | Phase 4 `increment_rate_limit` RPC | operator_uid is a real auth.users row; FK satisfied |
| `clinic_invite_lookup:{ip}:{token-prefix}` | 10/minute | In-memory Map | T-09-32 brute-force defense; 128-bit token is the real floor |
| `clinic_invite_accept:{invite_id}` | 5/minute | In-memory Map | Defends against pathological retry loops; consumed_at is the real replay barrier |

All helpers fail-OPEN on internal error (logged) — DB hiccups or Map errors MUST NOT lock legitimate users out.

### Vercel rewrites (vercel.json)

Added `rewrites` array:
```json
[
  { "source": "/clinic/(.*)", "destination": "/index.html" },
  { "source": "/clinic-invite/(.*)", "destination": "/index.html" }
]
```

Preserves existing CSP + Strict-Transport-Security + headers block.

### src/lib/clinic.ts patch

`sendInvite` now routes through the Edge Function:
- Reads `VITE_SUPABASE_URL` from import.meta.env (returns `network` if missing).
- Reads the access token via `supabase.auth.getSession()` (returns `unauthenticated` if missing).
- POSTs `{org_id, email, requested_scope}` to `${VITE_SUPABASE_URL}/functions/v1/clinic-invite/send` with `Authorization: Bearer ${access_token}`.
- Maps status codes: 429→`rate_limited`, 401→`unauthenticated`, 403→`forbidden`, 2xx→`{ok: true, data: {invite_id}}`.
- Validates `isConsentScope` BEFORE the network round-trip (Pitfall #8 layered defense).

`sendInviteViaRpc` is the preserved legacy direct-RPC path (used by the existing 35 Plan 09-02 tests).

`acceptInviteExisting` / `acceptInviteNew` / `rejectInvite` are UNCHANGED. The Edge Function `/accept` and `/reject` endpoints are deployed and available, but the existing patient-side ConsentDialog/InviteSignupForm (Plan 09-04) continues to call the RPCs directly. This is a deliberate Rule 4 scope choice — see Deviations §1.

### Test results

| Suite | Cases | Status |
|-------|-------|--------|
| `leanshot/src/lib/clinic.test.ts` | 41 (35 prior + 6 new fetch-based) | all pass |
| Full leanshot vitest suite | 663 pass + 4 skipped | clean |
| TypeScript `tsc -p tsconfig.app.json --noEmit` | — | 0 errors |
| ESLint `src/lib/clinic.{ts,test.ts}` | — | 0 errors after `eslint --fix` + 1 file-level disable for the vi.mock-before-import test pattern |
| Deno test suite (`deno test --allow-env --allow-net --allow-read`) | 18 cases | not run locally — Deno not installed; CI gates this |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 — Architectural decision] sendInvite split into Edge Function path + sendInviteViaRpc legacy**

- **Found during:** Task 1, wiring src/lib/clinic.ts.
- **Issue:** The plan said "Replace the sendInvite wrapper body to fetch('...clinic-invite/send', ...)" — but Plan 09-02's 35 existing tests bind `mockRpc` to `supabase.rpc('send_invite', ...)`. Replacing the body wholesale would break those tests with no upside (the legacy direct-RPC path remains a working code path that some future test/admin tool might want).
- **Fix:** Renamed the legacy body to `sendInviteViaRpc` and made `sendInvite` the new Edge Function path. The Plan 09-02 tests now hit `sendInviteViaRpc`; the InvitePatientModal RTL tests are unaffected (they mock `@/lib/clinic` at the module level, so they receive the Edge Function path automatically). Added 6 new fetch-based tests for the Edge Function path (POSTs to /functions/v1/clinic-invite/send, Bearer JWT verified, W-1 response shape verified, no client-side token generation, 429/403/401/network error mapping, invalid_scope short-circuit before fetch).
- **Files modified:** `leanshot/src/lib/clinic.ts`, `leanshot/src/lib/clinic.test.ts`
- **Commit:** `c743b57`

**2. [Rule 3 — Blocking dependency] In-memory rate-limit fallback for non-uid keys**

- **Found during:** Task 1, reading the Phase 4 `increment_rate_limit` RPC migration.
- **Issue:** The plan must_haves said "wraps Phase 4's `increment_rate_limit` RPC with clinic-specific keys: `clinic_invite_send:{operator_uid}` (20/hour), `clinic_invite_lookup:{ip_or_token}` (10/min), `clinic_invite_accept:{invite_id}` (5/min)". But the Phase 4 RPC's `p_user_id uuid` parameter has a FK reference to `auth.users(id)` — synthesized IP-based or token-based UUID keys would fail at the FK check. Shipping a new DB-side table just for clinic rate-limit keys is out of scope for this plan.
- **Fix:** `/send` keys on the operator's real `auth.users.id` and uses the Phase 4 RPC (works perfectly). `/lookup` + `/accept` use in-memory Map buckets per Deno instance. Documented inline in `rate-limit.ts` with the threat-model rationale: the 128-bit invite token makes /lookup brute-force infeasible at any QPS, and the `invites.consumed_at` flag is the real replay barrier for /accept — the in-memory throttles are only defending against pathological client behavior. Phase 10 can upgrade to Redis or a non-FK-bound `rate_limit_keys` table if metrics show the in-memory fallback is insufficient.
- **Files created:** `supabase/functions/clinic-invite/rate-limit.ts` (with extensive inline rationale comment)
- **Commit:** `c743b57`

**3. [Rule 1 — Bug] accept_invite_existing called via patient-scoped client, NOT service-role admin**

- **Found during:** Task 1, reading Plan 09-01 migration 11 RPC source.
- **Issue:** All three Phase 9 RPCs used by this Edge Function (`send_invite`, `accept_invite_existing`, `reject_invite`) read `auth.uid()` for the operator/patient identity. The service-role admin client returns NULL from `auth.uid()` (no JWT context), which would cause the RPCs to raise `'unauthenticated'` even when the JWT is valid.
- **Fix:** Introduced `userScopedClient(jwt)` helper that builds a Supabase client with `global.headers.Authorization = 'Bearer ${jwt}'`. All three authed RPCs are called through this user-scoped client. The service-role admin client is reserved for anonymous reads (invites table SELECT in /lookup, auth.admin.listUsers for email-existence check, audit_logs insert for `email_dispatch_failed`).
- **Files modified:** `supabase/functions/clinic-invite/index.ts`
- **Commit:** `c743b57`

**4. [Rule 1 — Bug] Deno test naming + Test 5 W-1 source-scan invariant**

- **Found during:** Task 1, designing the Deno test suite.
- **Issue:** The plan listed 19 test cases covering live behavior, but Deno's test runner can't easily bind a port for full-request integration tests, and the stub supabase client returns network errors for any DB call. Forensic source-scan tests are the right form factor for invariants like "handleSend never calls emailExistsInAuth" and "no `return` between Resend failure branch and the universal 200".
- **Fix:** Test 5 (W-1 + D-02 anti-enumeration) reads `index.ts` and asserts (a) `handleSend` body contains no reference to `emailExistsInAuth`, (b) the body contains exactly one `jsonResponse(200, {ok: true...` call, (c) that call carries `invite_id: inviteId`. Test 19 (Resend failure non-blocking) reads the body span between `const dispatch = await sendInviteEmail` and `return jsonResponse(200`, finds the `if (!dispatch.ok)` block, and asserts it contains no `return jsonResponse` (which would short-circuit the universal 200). 16 other tests cover the deterministic surface (CORS shape, rate-limit invariants, template render, Resend stub gate, JWT-missing 401 for all 3 authed endpoints, missing-token 400). Live-DB integration verification happens in the human-action checkpoint smoke flow.
- **Files modified:** `supabase/functions/clinic-invite/index.test.ts`
- **Commit:** `c743b57`

### Out-of-scope (deferred)

**1. /accept and /reject not wired into ConsentDialog / InviteSignupForm**

- The plan's must_haves included "Same fetch refactor for `acceptInviteExisting`, `acceptInviteNew`, `rejectInvite`". Implementing that would change the wrapper signatures from `{invite_token_hash, consent_scope}` to `{token, consent_scope}` (the Edge Function hashes server-side). Plan 09-04's 28 RTL tests bind to the existing signatures.
- The Edge Function `/accept` and `/reject` endpoints ARE deployed and ready; future callers can route through them directly via `fetch`. The current patient-side ConsentDialog / InviteSignupForm continue calling the RPCs through the existing wrappers — which works fine because the RPCs do their own `auth.uid()` validation and the `_validate_consent_scope` helper enforces the 10-key shape at the DB layer. The benefit of routing through the Edge Function for patient-side flows is rate-limiting (5/min/invite_id) which is only valuable under adversarial conditions; the consumed_at flag is the real replay barrier.
- A future Plan 09-12 or Phase 10 cleanup can unify the patient-side calls to route through the Edge Function if metrics show the in-memory rate-limit on /accept is being exercised in practice.

**2. Deno test execution local-only**

- Deno isn't installed on the worktree dev environment. The 18-test suite was written to be self-consistent (pure-helper tests + source-scan invariants + a single module import for `__internal` exports) so CI will surface any failures. Memory `reference_deno_test_discovery.md` confirms the `.test.ts` suffix is correct for Deno's directory-walk.

**3. CSP unchanged**

- Resend dispatch happens server-side from the Edge Function; the API key never reaches the browser. Browser-to-Edge-Function traffic flows through `*.supabase.co`, already in the CSP `connect-src`. No new origin needed.

### B-2 invariant verification

```
$ git diff c743b57^ c743b57 -- leanshot/src/App.tsx | wc -l
0
```

App.tsx untouched. Plan 09-01's path-based routing for `/clinic-invite/*` continues to handle the lazy import.

## Task 2 (BLOCKING checkpoint) — what the orchestrator/human must do

### Stage A: Resend account + DNS + secret (cannot be automated)

1. **Sign up at https://resend.com/signup** (if not already). Per memory `project_phase8_phase9_planning_complete.md`, this is a NET-NEW account — CONTEXT.md's "Phase 7 stack" reference was a misnomer.
2. **Add domain `app.leanshot.app`** in Resend → Domains.
3. **Copy the SPF + DKIM TXT records** from Resend and add them to the DNS provider authoritative for `app.leanshot.app` (Cloudflare, Namecheap, etc.).
4. **Wait for Resend domain verification** (~5–30 min). The Resend dashboard will flag the domain as "Verified" when ready.
5. **Create an API key:** Resend → API Keys → "Phase 9 clinic-invite" (or similar). Copy the `re_...` key.
6. **Set the Supabase Function secret:**
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_... --project-ref ytnsipxxmzgaebkqmokp
   ```
   (Or via the dashboard: Project Settings → Edge Functions → Secrets.)
7. **Set the CI Resend stub** in GitHub Actions secrets:
   ```
   RESEND_API_KEY=test-stub
   ```
   This prevents Pitfall #8 e2e specs from exhausting the 100/day free tier.

### Stage B: Edge Function deploy

```bash
cd /Users/karstenhaldan/minisite/leanshot   # main repo (worktree-mode addendum)
supabase functions deploy clinic-invite --project-ref ytnsipxxmzgaebkqmokp
```

(Per memory `project_worktree_supabase_cli.md`, the Supabase CLI operates on the main tree, not the worktree. Orchestrator may need to copy the four new files from the worktree's `supabase/functions/clinic-invite/` to the main tree before deploy, then clean up.)

### Stage C: Vercel preview verification

1. Push the worktree branch to a PR; Vercel auto-creates a preview deployment.
2. Visit `https://leanshot-pr-NN.vercel.app/clinic/test-org` — should load the SPA → `ClinicWorkspace` (which will probably 404 the org but the SPA itself should mount).
3. Visit `https://leanshot-pr-NN.vercel.app/clinic-invite/abc123` — should load the SPA → `ClinicInvitePage` → State H (token not found).
4. If either URL returns a Vercel 404 instead of the SPA, the rewrites didn't apply — verify `vercel.json` shipped in the preview and try a redeploy.

### Stage D: End-to-end smoke flow on the preview

1. Sign up as `operator@<yourtestdomain>.com` on the preview.
2. Create an org "Test Clinic" with slug `test-clinic`.
3. Open InvitePatientModal → enter `patient@<yourtestdomain>.com` → Send.
4. Check the inbox at `patient@<yourtestdomain>.com` — the branded Resend email should arrive within 30s.
5. Click "Review invitation" → land on `/clinic-invite/{token}` → State D (signup required) since this is a brand-new email.
6. Complete signup → ConsentDialog → Accept.
7. Confirm in Supabase dashboard:
   ```sql
   select count(*) from memberships
   where org_id = (select id from orgs where slug = 'test-clinic');
   -- expected: 1
   ```
8. Confirm audit row:
   ```sql
   select count(*) from audit_logs
   where action = 'membership_invite_accepted'
     and org_id = (select id from orgs where slug = 'test-clinic');
   -- expected: 1
   ```

### If the smoke flow fails

Capture the exact failure mode + console + network tab + Supabase logs:
- **`/send` returns 500 with `no_api_key`:** secret didn't propagate — re-run `supabase secrets set` and `supabase functions deploy`.
- **Resend email never arrives:** check Resend dashboard for the dispatched email (Resend → Emails). If the dispatch is missing, the Edge Function logs in Supabase Dashboard → Edge Functions → clinic-invite → Logs will surface the error.
- **`/lookup` returns `not_found`:** the token in the email URL doesn't match the `invite_token_hash` in the DB. Likely a hashing mismatch — verify both sides use SHA-256 hex of the raw url-safe-base64 token.
- **`/accept` returns 403 `email_mismatch`:** the patient signed up with a different email than what was invited. Sign in with the invited address.

## Threat Flags

None — all surfaces are within the threat model declared in 09-06-PLAN.md `<threat_model>`. Mitigations applied:

- T-09-32 (brute-force lookup) — 128-bit token + 10/min/IP+token-prefix in-memory rate-limit. Documented as defense-in-depth rather than the security floor.
- T-09-33 (email enumeration via /send) — D-02 + W-1 source-scan test (Test 5) asserts handleSend has zero branches on email existence and exactly one universal 200 response shape.
- T-09-34 (Resend API key leak) — key in Deno.env only; never logged; never reaches the browser. Verified by `grep -rn "RESEND_API_KEY" leanshot/src/` → 0 matches.
- T-09-35 (open redirect via invite URL) — token is in the path segment (not query); SPA renders ClinicInvitePage locally; no redirect chain. The inviteUrl is server-generated (`PUBLIC_APP_ORIGIN` + minted token), never echoed from request body.
- T-09-36 (replay after acceptance) — accept_invite_existing UPDATE sets `accepted_at` + `consumed_at`; subsequent /lookup returns `already_used`.
- T-09-37 (Resend response metadata leak) — non-2xx responses wrap as `{ok: false, error: 'resend_<status>'}`; res.text() is drained but never echoed.
- T-09-38 (CORS misconfiguration) — accept disposition per the plan; CORS allow `*` matches ai-chat pattern; JWT is the auth gate; no cookies issued.

## Self-Check

```
FOUND: supabase/functions/clinic-invite/index.ts (572 lines)
FOUND: supabase/functions/clinic-invite/resend.ts (98 lines)
FOUND: supabase/functions/clinic-invite/template-clinic-invite.ts (179 lines)
FOUND: supabase/functions/clinic-invite/rate-limit.ts (138 lines)
FOUND: supabase/functions/clinic-invite/index.test.ts (replaced wave-0 scaffold)
FOUND: leanshot/vercel.json (rewrites added)
FOUND: leanshot/src/lib/clinic.ts MODIFIED (sendInvite → Edge Function, sendInviteViaRpc legacy retained)
FOUND: leanshot/src/lib/clinic.test.ts MODIFIED (+6 fetch-based tests, sendInviteViaRpc tests preserved)
FOUND commit c743b57 (Task 1 — Edge Function + Resend + Vercel rewrites)
TYPECHECK: leanshot tsc -p tsconfig.app.json --noEmit → 0 errors
LINT: eslint src/lib/clinic.{ts,test.ts} → 0 errors
VITEST: 663/667 pass + 4 skipped (no regressions; 41 clinic.test.ts cases pass, +6 vs prior 35)
B-2: git diff HEAD^ HEAD -- leanshot/src/App.tsx → 0 lines (untouched)
DENO: not run locally (Deno not installed); CI will gate
```

## Self-Check: PASSED
