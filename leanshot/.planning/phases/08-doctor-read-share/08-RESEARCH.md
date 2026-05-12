# Phase 8: Doctor Read-Share — Research

**Researched:** 2026-05-12
**Domain:** Patient-issued time-bound read-share (token + access-code + recipient-cookie binding) over Supabase Edge Function + Postgres view + audit-log extension
**Confidence:** HIGH (every primary surface — Edge Function template `ai-chat/`, `audit_logs` schema, GUC suppression hook, Storage delete bypass, App.tsx `selectView`, SettingsPage NAV, DoctorReport print stylesheet — read in full; library/runtime versions verified)

## Summary

Phase 8 ships the doctor read-share end-to-end: a patient generates a `/share/<token>` link plus a 6-digit code from Settings → Active shares; the doctor enters the code; an Edge Function validates the code against `shares.access_code_hash`, sets an HttpOnly+Secure+SameSite=Strict `recipient_session` cookie whose hash is stored in `shares.recipient_session_hash`, and from that point serves a snapshot from a Postgres view (`share_snapshot_view`) that **structurally excludes** `ai_messages`. Every doctor view writes an `audit_logs` row with `actor_type='share_recipient'` + `share_id`. Revocation is enforced by a DB-row check on every poll, not by JWT TTL.

The architecture is a direct reuse of the **Phase 4 `ai-chat/` Edge Function template** (`Deno.serve`, JWT-validation pattern, service-role admin client, refusalSSE shape) and the **Phase 7 audit + RPC SECURITY DEFINER + GUC suppression patterns**. Net-new infrastructure is small: one new table (`shares`), one new view (`share_snapshot_view`), one or two new Edge Functions (or a single function with two POST/GET branches), two new audit-logs columns, plus the SPA-side `'share'` selectView branch and `ActiveSharesSection` + `CreateShareModal` + `SharePage` + `CodeEntryScreen` lazy chunks.

**Primary recommendation:** Six-to-seven plans across three waves.
1. **Wave 1 (foundation, sequential gate):** 08-01 `audit_logs` schema extension (actor_type + share_id) + `shares` table + RLS + `share_snapshot_view` + RLS proof.
2. **Wave 2 (parallel-eligible, three plans):** 08-02 Edge Function (`/share/redeem` + `/share/snapshot`) with cookie binding + rate limit. 08-03 `ActiveSharesSection` + `CreateShareModal` (Settings nav + RPCs to create/revoke). 08-04 `SharePage` + `CodeEntryScreen` + `ShareRevokedScreen` + `selectView` branch + lazy chunk.
3. **Wave 3 (verification gate, sequential):** 08-05 4-failure-mode revocation drill (Playwright + supabase-js — cache, JWT TTL, forwarded link, cookie clearing) + cross-tenant RLS proof. 08-06 print-mode verification + chart-watermark survives + Settings nav visibility check + bundle-size guard. (Optionally 08-07 audit-log surface integration polishing if 08-03 deferred it.)

All non-trivial migrations carry the four Phase 7 deviation patterns preventively: IMMUTABLE partial-index expressions, SECURITY DEFINER `search_path = public, extensions, pg_catalog`, Storage delete bypass GUC (not relevant unless 08 deletes photos — which it does not), and `app.suppress_audit` GUC awareness for any direct audit_logs write path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (LOCKED, doctor-view delivery):** Same SPA + `/share/<token>` hash route + lazy `SharePage.tsx` component. Top-priority `selectView` branch in `App.tsx` parallel to the existing `'legal'` branch from 07-02. The share route loads its own snapshot via the share Edge Function — it does NOT touch the patient's Zustand store. Reuses the 22.55 kB index + lazy chart/DoctorReport chunks. Risk acknowledged: share-route bugs share the SPA's blast radius; mitigated by tight CSP on share routes and zero-store-access invariant.
  - **Rationale:** matches Phase 2's existing pattern; lowest dev cost; reuses chart/DoctorReport visualization stack. Separate subdomain considered but deferred until B2B Phase 9-10 (which may force the issue anyway).

- **D-02 (LOCKED, revocation primitive):** Every share-route request hits a Supabase Edge Function (modeled after `ai-chat`) that validates the JWT signature AND queries the `shares` table for `revoked_at IS NULL AND expires_at > now()`. Postgres is the single source of truth; JWT TTL is a fallback, not the primary gate. ~50-150ms latency overhead per request — acceptable for the read-share flow (no per-keystroke latency surface). SC#3 wording explicitly requires "DB-row-checked, not JWT-only", and this honors that verbatim.
  - **Failure-mode coverage:**
    - (a) Doctor's open tab returns 401 within seconds: each chart/symptom poll hits Edge Function → DB check → 401 on revoke
    - (b) `Cache-Control: private, no-store` on every share-route response: Edge Function sets header unconditionally
    - (c) JWT carries opaque `share_id` (not patient `user_id`): planner picks the JWT shape; share token resolves to share row server-side
    - (d) Forwarded link to a different recipient identifier fails: enforced by D-03's cookie binding

- **D-03 (LOCKED, recipient binding):** 6-digit access code is single-use → HttpOnly cookie set on first valid code entry. Edge Function flow on first code entry: (1) validate `access_code_hash` against `shares.access_code_hash`, (2) mark code consumed (set `shares.code_consumed_at = now()`), (3) set `recipient_session` HttpOnly+Secure+SameSite=Strict cookie carrying a server-generated opaque token, (4) store the opaque token's hash in `shares.recipient_session_hash`. Subsequent share-route requests: Edge Function checks cookie hash matches `shares.recipient_session_hash`.

- **D-04 (LOCKED, share audit log):** Extend Phase 7's `audit_logs` table — add `actor_type` (enum: `'user'` | `'share_recipient'` | `'system'`) and `share_id` (nullable FK to new `shares` table). Doctor-view rows: `actor_type='share_recipient'`, `share_id=<uuid>`, `action='share_view'`, `user_id=<share owner>` (for RLS), `table_name='shares'`, `row_id=share_id`. Plus extra metadata columns: `recipient_ua_family`, `recipient_ip_family` (for Settings "Active shares" tab observability — not for binding; binding is D-03's cookie).
  - Retention: existing Phase 7 D-04 retention cron (13 months rolling for `share_view`).

### Claude's Discretion

- `shares` table schema details beyond load-bearing columns (`id`, `user_id`, `token_hash`, `access_code_hash`, `expires_at`, `revoked_at`, `code_consumed_at`, `recipient_session_hash`, `created_at`). Add `label` (e.g., "Dr. Smith — Q2 review") for patient self-service in Active shares tab.
- Edge Function shape (single function with two endpoints vs two separate functions). Modeled after `supabase/functions/ai-chat/`.
- Snapshot SQL view shape — `share_snapshot_view` must NOT join `ai_messages`. View is consumed by the Edge Function via service-role client.
- DoctorReport reuse for print mode (SC#5) — `window.print()` from `DoctorReport.tsx:40` already exists; share view renders the same component with snapshot data.
- Active shares tab UX — row per share with label, expiry, view count, last-viewed-at, IP family, UA family + one-click revoke button.
- Revoke action latency — D-02's per-request DB check means revoke is effectively instant on next poll; no client-side push needed.

### Deferred Ideas (OUT OF SCOPE)

- Doctor accounts (SHARE-V2-01) — v2.
- Doctor annotations (SHARE-V2-02) — v2.
- Realtime push for revocation — D-02's per-request DB check is sufficient at v1 patient-count scale.
- Plan 07-02c cleanup (RC5 deferred-test re-enable) — kept separate from Phase 8. Phase 8 plans MUST NOT introduce two-context Realtime polling specs while 07-02c is pending.
- Print stylesheet enhancement — only batch in if doctors complain post-launch.
- Patient notification on doctor view ("Dr. Smith viewed your share at 2:34pm" toast/email) — v2.
- Share-link rate-limit per patient (max 10 active) — v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | Patient can create a share link from Settings, scoped to a patient-picked time window | §Standard Stack (Edge Function `create_share` RPC); §Architecture Patterns (Active shares + CreateShareModal); §Code Examples (RPC shape) |
| SHARE-02 | Doctor opens link, enters 6-digit code, sees read-only view (chart, injections, symptoms, photos, weight, doctor report) | §Architecture Patterns (SharePage lazy chunk); §Standard Stack (`share_snapshot_view`); §Code Examples (Edge Function GET `/share/snapshot`) |
| SHARE-03 | AI conversation history NEVER included | §Standard Stack (`share_snapshot_view` structurally excludes `ai_messages` — same precedent as audit_logs trigger excluding ai_messages); §Architecture Patterns (snapshot view) |
| SHARE-04 | Revoke at any time; doctor's open page becomes unusable within seconds; automated 4-failure-mode drill (token cache, HTTP cache, JWT TTL, forwarded link) | §Architecture Patterns (revocation primitives); §Validation Architecture (Wave 3 drill) |
| SHARE-05 | All share-link reads audit-logged + visible to patient in Settings | §Standard Stack (`audit_logs` extension columns: actor_type, share_id); §Code Examples (`log_share_view` SECURITY DEFINER RPC) |
| SHARE-06 | `Cache-Control: private, no-store` on every share-route response; recipient binding so forwarded link fails | §Architecture Patterns (cookie binding); §Common Pitfalls (CDN cache poisoning); §Validation Architecture (cookie + cache drill) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **TS strict** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. New code must not regress. `s.user!` non-null assertion is FORBIDDEN (Phase 6 D-12 + Phase 7 D-06 sweep complete).
- **Local-first must keep working** — share-route is additive; patient-side cloud sync continues independent of share infrastructure.
- **Bundle-size discipline** — index gz ≤ 50 kB (currently 21.49 kB at Phase 7 close). SharePage MUST be lazy-chunked. CreateShareModal lands in existing settings chunk unless it exceeds 4 kB gz.
- **No third-party trackers** — no new analytics on share routes.
- **GSD workflow enforcement** — no direct repo edits outside a GSD workflow.
- **`s.user!` ban** — share routes do not touch `useStore` at all; SharePage owns its own local snapshot state.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Share-create RPC (server-generates token + code + hashes) | API / Backend (Postgres SECURITY DEFINER RPC) | Browser (RPC invocation) | Token entropy + code generation must be server-side so secrets never round-trip through client RNG; raw values returned ONCE in the RPC response. |
| Share-revoke RPC | API / Backend (Postgres SECURITY DEFINER RPC) | Browser | `update shares set revoked_at=now() where id=$1 and user_id=auth.uid()` — RLS-scoped. |
| Code redemption + cookie issuance | API / Backend (Supabase Edge Function `/share/redeem`) | — | Cookie set requires server-controlled Set-Cookie header with HttpOnly + Secure + SameSite=Strict; must validate access_code_hash + mark code_consumed_at atomically. |
| Snapshot read (chart + injections + symptoms + photos + weight + doctor report) | API / Backend (Edge Function `/share/snapshot` → reads `share_snapshot_view`) | Database (view) | View is the structural-exclusion gate for `ai_messages`; service-role client reads it; response carries `Cache-Control: private, no-store`. |
| Photo signed-URL minting (for share consumption) | API / Backend (Edge Function — `storage.from('photos').createSignedUrl()` with short TTL) | CDN (Storage) | Signed URL TTL must be ≤ share expiry; doctor never sees raw Storage keys. |
| Doctor-side render (chart + DoctorReport reuse) | Browser / Client (SharePage lazy chunk) | — | Pure render of snapshot JSON; ZERO access to Zustand store (D-12/D-06 invariant). |
| Doctor-side code entry | Browser / Client (CodeEntryScreen) | API (POST `/share/redeem`) | Auto-focus, autoComplete="one-time-code", 6-digit numeric input. |
| Audit-log row write (per doctor poll) | Database (SECURITY DEFINER RPC `log_share_view`) | Edge Function (caller) | Phase 7 audit_trigger doesn't fire on `share_view` (no sync-table write); Edge Function calls RPC explicitly to insert audit row. |
| Active shares list (Settings tab) | Browser / Client (ActiveSharesSection) | API (RLS-scoped reads of `shares` + aggregate of `audit_logs`) | RLS keeps patient seeing only own rows; aggregate query `count() + max(timestamp) FROM audit_logs WHERE actor_type='share_recipient'`. |

## Runtime State Inventory

> Phase 8 is greenfield in terms of new schema (`shares` table + `share_snapshot_view`) and additive in terms of `audit_logs` columns. There is no rename/refactor angle; runtime state inventory not required. Migration order load-bearing: `audit_logs` columns must be added BEFORE the `shares` table FK is created (or both in one migration with the right ordering).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.105.4 | RLS-scoped client (browser) + service-role admin client (Edge Function) | `[VERIFIED: leanshot/package.json]` Already in dependency tree; Phase 4–7 baseline. |
| Deno (Supabase Edge Runtime) | bundled by Supabase | Edge Function runtime | `[VERIFIED: supabase/functions/ai-chat/index.ts]` Existing `Deno.serve` + `EdgeRuntime.waitUntil` pattern is the template. Local CLI: deno 2.7.14 confirmed. |
| Postgres `pgcrypto` | bundled | `digest()` for sha256 hashing + `gen_random_bytes()` for token generation | `[VERIFIED: supabase/migrations/20260601000001_audit_logs.sql:41]` Already `create extension if not exists pgcrypto`. |
| Postgres `pgcrypto.crypt()` + `gen_salt('bf')` | bundled | bcrypt-style hashing of the 6-digit access code | `[CITED: postgresql.org/docs/current/pgcrypto.html]` `crypt(value, gen_salt('bf', 10))` produces a salted bcrypt hash; `crypt(input, stored_hash)` re-derives for comparison. **Alternative considered:** server-side argon2 via Deno + WebCrypto — rejected because keeping the comparison inside the DB (single round-trip) is simpler and brute-force resistance for a 6-digit code is dominated by rate-limiting, not hash cost factor. |
| Supabase Storage signed URLs | server-side | Photo access in snapshot | `[VERIFIED: leanshot/.planning/phases/06-04-PLAN.md]` Phase 6 D-07 pattern: Edge Function calls `storage.from('photos').createSignedUrl(path, ttlSec)` with `ttlSec ≤ remaining share lifetime`. |
| `@playwright/test` | ^1.59.1 | E2E + revocation drill | `[VERIFIED: leanshot/package.json]` Phase 5+ baseline. |
| `vitest` | ^4.1.5 | RLS cross-tenant proof via `vitest-e2e.config.ts` | `[VERIFIED: leanshot/vitest-e2e.config.ts]` `e2e/rls-*.test.ts` glob already wired. |
| `chart.js` + `framer-motion` + `lucide-react` | existing | Chart, transitions, icons reused on SharePage | `[VERIFIED: leanshot/package.json]` Reused, not added. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Deno `std/http/cookie` | `jsr:@std/http/cookie` (no version pin needed — Edge Runtime ships current) | `setCookie(headers, { name, value, httpOnly, secure, sameSite: 'Strict', path: '/', maxAge })` | When the Edge Function needs to set `recipient_session` cookie on `/share/redeem`. `[CITED: jsr.io/@std/http/cookie]` Reasoning over manual `headers.append('Set-Cookie', ...)` is that the helper is well-tested for attribute encoding (e.g., `SameSite=Strict` capitalization, `Max-Age` formatting). `[ASSUMED]` exact spelling of `sameSite: 'Strict'` — verify in implementation against current `@std/http/cookie` typings. |
| Postgres `gen_random_bytes(N)` | pgcrypto | 128-bit share token generation server-side | `[CITED: postgresql.org/docs/current/pgcrypto.html#PGCRYPTO-RANDOM-DATA-FUNCTIONS]` `encode(gen_random_bytes(16), 'base64url')` produces a 22-char URL-safe token. Use INSIDE the `create_share` RPC; raw token returned to caller via RPC response, hashed copy stored in `shares.token_hash`. |
| Edge Function rate-limit pattern (existing) | `supabase/functions/ai-chat/rate-limit.ts` | Reuse for `/share/redeem` code-attempt rate limiting (5/min/share per CONTEXT.md "specifics") | Per-share rate limiter, not per-user. Pattern: SECURITY DEFINER `increment_share_attempt(share_id)` RPC mirroring `increment_rate_limit`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Edge Function as the snapshot gate | Direct supabase-js client from SharePage using a special "share" auth role | Rejected: requires either a custom JWT issuance flow OR a Postgres role with view-only access, both of which leak details about user_id structure to the doctor. Edge Function gate keeps `user_id` server-side. |
| Postgres view `share_snapshot_view` | JSON build inside Edge Function from multiple SELECTs | Rejected: view is the documented structural-exclusion contract from CONTEXT.md SC#2 — reviewer can grep `share_snapshot_view AS SELECT ...` and verify `ai_messages` is absent. JSON build in Edge Function is auditable but less inspectable. |
| Bcrypt access-code hashing via pgcrypto.crypt | Argon2 via Deno + WebCrypto | Rejected: a 6-digit code has only ~20 bits of entropy; brute-force resistance is dominated by rate-limit (5/min per share = ~3.5h to brute-force at 100% effort, longer than any practical share lifetime). Bcrypt+rate-limit is the standard pattern; argon2 adds complexity without material gain. |
| HttpOnly cookie via `Set-Cookie` header | LocalStorage on share-route subdomain | Rejected: localStorage is JS-readable → defeats SameSite=Strict guarantee. HttpOnly cookie + SameSite=Strict is the only setup that survives a forwarded link to a different browser session. |
| Single Edge Function with two endpoints (route via path or method) | Two separate Edge Functions | Single function preferred — same auth/cookie context, lower deploy overhead. `Deno.serve` handler routes on `new URL(req.url).pathname` or HTTP method. Two functions OK if planner prefers cleaner separation; deploy-time cost is negligible. |

**Installation:** No new top-level dependencies. Edge Function imports use `jsr:@std/http/cookie` which Supabase Edge Runtime resolves at deploy time.

**Version verification:**
- `@supabase/supabase-js`: 2.105.4 already installed (verified via `package.json`). Latest stable as of cutoff: 2.x line stable.
- Deno (Edge Runtime): bundled by Supabase platform (`supabase/functions/ai-chat/deno.json` uses no Deno version pin — platform-managed).
- pgcrypto: bundled with Supabase Postgres (verified via Phase 7 migrations).

## Architecture Patterns

### System Architecture Diagram

```text
Patient browser (signed in)
  │
  │ 1. POST RPC create_share({label, expires_at})
  ▼
[Postgres SECURITY DEFINER `create_share()`]
  │ generates token (gen_random_bytes 16 bytes base64url)
  │ generates code (6-digit random)
  │ stores token_hash, access_code_hash (bcrypt), label, expires_at
  │ returns {share_id, raw_token, raw_code} ONCE
  ▼
Patient browser holds raw token + raw code → renders in CreateShareModal post-creation state
  │
  │ Patient hands link + code to doctor over separate channels (out-of-band)
  ▼
Doctor browser → GET https://app/share/<token>
  │
  │ App.tsx selectView matches '#/share/' → lazy SharePage chunk
  ▼
[SharePage] auto-fires GET /functions/v1/share-snapshot?token=<token>
  │
  ▼
[Edge Function /share-snapshot]
  │ resolve token_hash → shares row
  │ check revoked_at IS NULL AND expires_at > now()
  │ check recipient_session cookie hash matches shares.recipient_session_hash
  │   ├─ no cookie → respond 401 {error: 'requires_code'}
  │   ├─ cookie present + matches → proceed
  │   └─ cookie present + mismatch → respond 401 {error: 'invalid_session'}
  ▼
SharePage receives 401 requires_code → renders CodeEntryScreen
  │
  │ Doctor enters 6-digit code → POST /functions/v1/share-redeem {token, code}
  ▼
[Edge Function /share-redeem]
  │ resolve token_hash → shares row
  │ check revoked_at IS NULL AND expires_at > now()
  │ check code_consumed_at IS NULL (or matches same recipient — per D-03)
  │ rate-limit: 5 attempts/min/share via increment_share_attempt RPC
  │ verify pgcrypto.crypt(input_code, shares.access_code_hash) == shares.access_code_hash
  │ generate recipient_session opaque token (16 random bytes → base64url)
  │ store sha256(opaque) in shares.recipient_session_hash
  │ stamp shares.code_consumed_at = now()
  │ set HttpOnly+Secure+SameSite=Strict+Path=/share-snapshot cookie
  ▼
SharePage receives 200 → re-fires GET /share-snapshot (cookie now binds)
  │
  ▼
[Edge Function /share-snapshot] (cookie present)
  │ call SECURITY DEFINER RPC log_share_view(share_id, ua_family, ip_family)
  │   inserts audit_logs row: actor_type='share_recipient', share_id, action='share_view', user_id=<owner>
  │ SELECT * FROM share_snapshot_view WHERE user_id = <share owner>
  │ mint signed URLs for photos (ttl ≤ remaining share lifetime)
  │ respond 200 + Cache-Control: private, no-store
  ▼
SharePage renders: MedLevelChart + DoctorReport + injections/symptoms/photos/weight
  │
  │ Patient revokes via Settings → Active shares → Revoke
  ▼
[Postgres SECURITY DEFINER `revoke_share(share_id)`]
  │ UPDATE shares SET revoked_at = now() WHERE id = $1 AND user_id = auth.uid()
  │ (optionally) UPDATE shares SET recipient_session_hash = null (invalidates cookie next poll too)
  ▼
Doctor's next /share-snapshot poll → revoked_at != null → 401 {error: 'revoked'}
  ▼
SharePage transitions to ShareRevokedScreen (state D) — within seconds (matches SC#3)
```

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── components/
│   │   ├── share/                          # NEW — lazy chunk root
│   │   │   ├── SharePage.tsx               # mount on selectView==='share'; owns local snapshot state
│   │   │   ├── CodeEntryScreen.tsx         # 6-digit numeric input + auto-submit
│   │   │   ├── ShareRevokedScreen.tsx      # states D/E/F (revoked/expired/error)
│   │   │   └── share-client.ts             # tiny fetch wrappers; credentials: 'include'
│   │   └── dashboard/settings/
│   │       ├── ActiveSharesSection.tsx     # NEW — Settings nav tab
│   │       └── CreateShareModal.tsx        # NEW — composes Modal + Input + Pill
│   └── lib/
│       └── shares.ts                       # NEW — typed wrappers over create_share + revoke_share RPCs

supabase/
├── functions/
│   └── share/                              # NEW — Edge Function (single function, two endpoints by path)
│       ├── index.ts                        # Deno.serve; routes /redeem + /snapshot
│       ├── cookie.ts                       # setCookie helper using jsr:@std/http/cookie
│       └── rate-limit.ts                   # increment_share_attempt RPC wrapper
└── migrations/
    ├── 20260701000001_audit_logs_share_columns.sql  # add actor_type enum + share_id FK
    ├── 20260701000002_shares_table.sql              # shares + RLS + indexes (IMMUTABLE!)
    ├── 20260701000003_share_rpcs.sql                # create_share, revoke_share, log_share_view, increment_share_attempt
    └── 20260701000004_share_snapshot_view.sql       # share_snapshot_view excluding ai_messages

e2e/
├── share-revocation-drill.spec.ts          # NEW — 4-failure-mode Playwright drill
├── share-happy-path.spec.ts                # NEW — code entry → snapshot → revoke flow
└── rls-shares.test.ts                      # NEW — cross-tenant impersonation proof (vitest-e2e.config.ts)
```

### Pattern 1: Edge Function template (mirrors `ai-chat/`)

**What:** Single `Deno.serve` handler that branches on `new URL(req.url).pathname`. Validates auth context (cookie for `/share-snapshot`; no auth required for `/share-redeem` — the code itself IS the auth), enforces rate limit via SECURITY DEFINER RPC, sets unconditional `Cache-Control: private, no-store` on every response.

**When to use:** Both `/share/redeem` and `/share/snapshot`. Keeps cookie context and CORS headers in one place.

**Example:**

```typescript
// Source: derived from /Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts (verbatim pattern)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { setCookie } from 'jsr:@std/http/cookie';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const baseHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',  // SHARE-06 + SC#6 — unconditional on every response
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Credentials': 'true',  // required so browser sends recipient_session cookie
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: baseHeaders });

  const url = new URL(req.url);
  if (url.pathname.endsWith('/redeem')) return handleRedeem(req);
  if (url.pathname.endsWith('/snapshot')) return handleSnapshot(req);
  return jsonError(404, 'not-found');
});
```

### Pattern 2: SECURITY DEFINER RPC with hardened search_path (mirrors Phase 7 `initiate_account_deletion`)

**What:** Every server-side mutation goes through a SECURITY DEFINER plpgsql function with `set search_path = public, extensions, pg_catalog`. The function is the ONLY write path; RLS denies direct INSERT/UPDATE/DELETE from the authenticated role.

**When to use:** `create_share`, `revoke_share`, `log_share_view`, `increment_share_attempt`. All four MUST include `extensions` in search_path so `digest()` and `crypt()` resolve.

**Example:**

```sql
-- Source: derived from /Users/karstenhaldan/minisite/supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql (verbatim pattern)
create or replace function public.create_share(
  p_label text,
  p_expires_at timestamptz
)
returns table (share_id uuid, raw_token text, raw_code text)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_code text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_expires_at <= now() then raise exception 'expires_at must be in future' using errcode = '22023'; end if;

  -- 128-bit URL-safe token (22 chars base64url after encoding 16 bytes)
  v_token := replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_');
  -- 6-digit zero-padded code
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.shares (user_id, label, token_hash, access_code_hash, expires_at)
  values (
    v_uid,
    p_label,
    encode(digest(v_token, 'sha256'), 'hex'),
    crypt(v_code, gen_salt('bf', 10)),    -- bcrypt cost 10 — fast verify, sufficient for 6-digit
    p_expires_at
  )
  returning id into v_id;

  return query select v_id, v_token, v_code;
end;
$$;

revoke all on function public.create_share(text, timestamptz) from public;
grant execute on function public.create_share(text, timestamptz) to authenticated;
```

### Pattern 3: Cookie binding (HttpOnly + Secure + SameSite=Strict)

**What:** First successful `/share/redeem` issues a server-generated 16-byte opaque token, returns it ONLY via `Set-Cookie` header (never in JSON body), and stores the sha256 hash in `shares.recipient_session_hash`. Subsequent `/share/snapshot` calls compare the request cookie against the stored hash.

**When to use:** Once per share-link lifetime per recipient. Cookie path is scoped to the share Edge Function so it doesn't leak to other origins on the same domain.

**Example:**

```typescript
// Source: jsr:@std/http/cookie; verified pattern from MDN Set-Cookie reference
async function handleRedeem(req: Request): Promise<Response> {
  // ... validate code via crypt() comparison (see Pattern 4)
  const opaque = crypto.getRandomValues(new Uint8Array(16));
  const opaqueB64 = btoa(String.fromCharCode(...opaque));
  const opaqueHash = await sha256Hex(opaqueB64);

  // Persist hash; raw value lives ONLY in the cookie
  await admin.rpc('redeem_share', {
    p_share_id: shareId,
    p_recipient_session_hash: opaqueHash,
    p_ua_family: parseUaFamily(req.headers.get('User-Agent') ?? ''),
    p_ip_family: parseIpFamily(req.headers.get('x-forwarded-for') ?? ''),
  });

  const headers = new Headers(baseHeaders);
  setCookie(headers, {
    name: 'recipient_session',
    value: opaqueB64,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
```

### Pattern 4: Snapshot view with structural ai_messages exclusion (SC#3)

**What:** A Postgres view that joins every table the doctor should see — and pointedly does NOT join `ai_messages`. Reviewer can grep the migration once to verify.

**When to use:** Edge Function `/share/snapshot` reads this view via service-role client, filtered by `WHERE user_id = <share owner uuid>`.

**Example:**

```sql
-- Source: derived from existing Phase 5/6 sync table list + AI-05 exclusion contract
-- Tables touched: injections, weights, meals, workouts, supplements, mood_logs, sleep_logs, symptoms, vials, settings, photos
-- Tables INTENTIONALLY OMITTED: ai_messages (SC#3), audit_logs (server-internal)
create or replace view public.share_snapshot_view as
select
  i.user_id,
  i.log_id,
  i.timestamp as injection_ts,
  i.medication,
  i.dose,
  i.unit,
  i.site,
  null::text as ai_history_placeholder  -- intentionally null; documents AI exclusion
from public.injections i;
-- (extend per planner — symptoms/weights/etc — but DO NOT join public.ai_messages)
```

**Anti-pattern:** Building snapshot JSON via Edge Function SQL string concatenation. The view is the contract; the function just reads it.

### Pattern 5: Recipient binding via opaque token, NOT JWT

**What:** D-02 Failure Mode (c) — JWT carries opaque `share_id`, not patient `user_id`. The Phase 8 Edge Function follows this by **not issuing a JWT at all** for recipients. Instead, the HttpOnly cookie carries an opaque 16-byte token whose hash is checked against `shares.recipient_session_hash`. Patient identity stays server-side.

**When to use:** Always. There is no reason for the doctor browser to ever hold a JWT or learn the patient's auth.uid().

### Anti-Patterns to Avoid

- **Putting access code in URL fragment or query string** — would log into Edge Runtime access logs + CDN logs. Code goes in POST body only.
- **Storing access code in localStorage or sessionStorage on doctor side** — defeats single-use + HttpOnly + SameSite=Strict guarantee. The code is single-use; after consumption only the cookie matters.
- **Returning `raw_token` or `raw_code` more than once from `create_share` RPC** — irrecoverable secret leakage. The patient sees them ONE TIME in the CreateShareModal post-creation state; reopening the modal later shows "Code already shown; create a new share if needed."
- **Calling supabase-js from SharePage with patient's JWT** — defeats SC#3 (AI exclusion) because the patient's JWT can read ai_messages via RLS. The doctor never holds the patient's JWT.
- **Reading from base `shares` table directly in `/share/snapshot`** — leaks `shares.access_code_hash`, `token_hash`, `recipient_session_hash` shape. The view is the public-facing layer. (`shares` table itself has restrictive RLS; service-role bypass goes through RPCs only.)
- **Calling `s.user!` or `useStore((s) => s.user!)` anywhere in `src/components/share/`** — Phase 6 D-12 + Phase 7 D-06 forbid this; SharePage owns local snapshot state independent of Zustand.
- **Static-importing SharePage / CreateShareModal in `App.tsx` or `main.tsx`** — bundle-size ceiling regression. Must be `React.lazy` per existing `'legal'` pattern.
- **CDN-caching a share response** — defeats SC#3(b). Edge Function MUST set `Cache-Control: private, no-store` on every response, including 401s and 4xx errors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hashing the access code | Custom SHA-1/SHA-256 with manual salt | `pgcrypto.crypt(code, gen_salt('bf', 10))` | Salting + cost-factor + constant-time compare are all handled. 6-digit codes need cheap hash (cost 10) + rate-limit, not expensive hash. |
| Generating random token | `Math.random()` or non-crypto RNG | `pgcrypto.gen_random_bytes(16)` | CSPRNG inside Postgres; raw bytes never cross network unencoded. |
| Set-Cookie header construction | String concat with manual escaping | `jsr:@std/http/cookie` `setCookie()` | Edge cases (`Max-Age` formatting, `SameSite` capitalization, `Path` validation, multiple cookies in one response) handled. |
| Detecting share token in URL | Custom regex / path parser | Reuse existing `selectView` hash-prefix-match pattern from `App.tsx:186` | One concept across app: hash routes drive view selection. |
| Cross-tenant query scoping | Application-layer `WHERE user_id = ...` | Postgres RLS + service-role bypass only inside SECURITY DEFINER RPCs | RLS is the primary tenant-isolation primitive across the project (Phase 5 SYNC-05). Every new table must enable RLS. |
| Photo URL signing | Custom signed-URL scheme | `storage.from('photos').createSignedUrl(path, ttl)` | Supabase Storage signing already verified Phase 6 plan 06-04. |
| 4-failure-mode revocation drill scaffolding | Custom test harness | Playwright + supabase-js admin (mirrors `e2e/account-delete.spec.ts` shape) | Phase 7 already shipped the Playwright + admin createUser pattern; reuse fixtures from `e2e/fixtures/`. |
| Audit-log row writes from share Edge Function | Direct INSERT INTO audit_logs (no trigger context) | New SECURITY DEFINER RPC `log_share_view(share_id, ua_family, ip_family)` | Mirrors Phase 7's "trigger only attaches to sync tables; skeleton rows written directly via SECURITY DEFINER" pattern from `20260601000011_initiate_account_deletion_rpc.sql`. |

**Key insight:** Phase 8 is **almost entirely a recombination of Phase 4 + Phase 6 + Phase 7 primitives**. The novel parts are (1) the access-code single-use + cookie issuance flow, (2) the `share_snapshot_view` shape, and (3) the audit_logs column extension. Everything else is template reuse.

## Common Pitfalls

### Pitfall 1: Forgetting `extensions` in SECURITY DEFINER search_path
**What goes wrong:** `digest()` and `crypt()` are in the `extensions` schema on managed Supabase. A function with `set search_path = public, pg_catalog` will throw `function digest(text, text) does not exist` at runtime — only on the deployed project, never in local testing.
**Why it happens:** Local supabase CLI installs pgcrypto into `public`; managed cloud installs into `extensions`. Phase 7 hit this twice (`20260601000004` + `20260601000015`).
**How to avoid:** EVERY SECURITY DEFINER function that touches digest/crypt/gen_random_bytes uses `set search_path = public, extensions, pg_catalog`.
**Warning signs:** Local tests pass; first deploy fails with `42883` or `42704` referencing `digest` or `crypt`.

### Pitfall 2: IMMUTABLE clause on partial-index expressions
**What goes wrong:** `create index ... on public.shares (expires_at) where revoked_at is null` fails on push if Postgres can't prove the expression is IMMUTABLE.
**Why it happens:** Phase 7 hit this on `pending_account_deletions`. Constants like `null` are fine; function calls like `now()` are not.
**How to avoid:** Partial-index `WHERE` clause uses only column comparisons and literals; no `now()`, no `current_timestamp`, no volatile functions.
**Warning signs:** `42P17 functions in index predicate must be marked IMMUTABLE` at migration push time.

### Pitfall 3: Cookie SameSite=Strict vs cross-origin XHR from share route
**What goes wrong:** If SharePage renders on `https://app.leanshot.com/` and calls Edge Function at `https://<ref>.supabase.co/functions/v1/share/...`, the cookie set by the Edge Function is SECOND-party from the doctor browser's perspective. `SameSite=Strict` blocks cookie attach on cross-site navigation but NOT on same-tab fetch. **But** the cookie domain must be set correctly: a cookie set by `*.supabase.co` is attached on subsequent requests to `*.supabase.co` regardless of the initiating page's origin.
**Why it happens:** Subtle interplay between `SameSite`, `Domain`, and `credentials: 'include'`.
**How to avoid:** (a) Set cookie WITHOUT explicit `Domain` attribute → defaults to the response host (`<ref>.supabase.co`). (b) Browser fetch from SharePage uses `credentials: 'include'`. (c) Edge Function CORS includes `Access-Control-Allow-Credentials: true` AND a non-`*` `Access-Control-Allow-Origin` value (the SPA's origin). **Note this is a deviation from `ai-chat/cors.ts` which uses `*` because no cookie is sent there.** For Phase 8 the share Edge Function MUST echo back the request `Origin` (allow-list-able) when `credentials: include` is in play — `*` + `credentials: include` is forbidden by the browser CORS spec.
**Warning signs:** Doctor enters correct code, Edge Function returns 200, but the next `/share/snapshot` request returns 401 `requires_code` because the cookie didn't attach.

### Pitfall 4: CORS preflight + Set-Cookie
**What goes wrong:** OPTIONS preflight succeeds with `Access-Control-Allow-Origin: *`, but the subsequent POST with `credentials: 'include'` fails browser-side because the actual response can't return `*` once credentials are involved.
**How to avoid:** Switch from `*` to a request-Origin echo for the share Edge Function (only). Maintain allow-list of permitted origins (production domain + preview deploy domains) server-side.

### Pitfall 5: Code-attempt rate limit per-user vs per-share
**What goes wrong:** Phase 4's `increment_rate_limit` is keyed on `user_id`. For Phase 8 the rate limit is on the SHARE row (5/min/share per CONTEXT.md "specifics"), not the doctor.
**Why it happens:** Reusing `ai-chat/rate-limit.ts` verbatim ties the limit to a user that doesn't exist (recipient has no auth identity).
**How to avoid:** New `increment_share_attempt(share_id)` RPC with its own counter table OR a `failed_attempts_count` + `last_attempt_at` column on `shares` itself. The simpler latter approach is recommended for v1.
**Warning signs:** Brute-forcing the code is rate-limited globally instead of per-share, OR not rate-limited at all because key shape is wrong.

### Pitfall 6: Audit-log row write inside Edge Function fails silently
**What goes wrong:** `log_share_view` RPC errors (e.g., the audit_logs.user_id FK rejects a deleted-account share — edge case if the patient deleted their account while a share was outstanding). The doctor view succeeds but the audit row never lands. SHARE-05 is silently violated.
**How to avoid:** (a) When the patient initiates account-delete (Phase 7 `initiate_account_deletion`), also revoke all outstanding shares (`update shares set revoked_at = now() where user_id = $1 and revoked_at is null`). (b) Log RPC errors via `console.error` AND respond 500 to the doctor (better to show "couldn't open this share" than silently violate SHARE-05).
**Warning signs:** Active shares tab shows zero views even though doctor confirmed access; check Edge Runtime logs.

### Pitfall 7: `Cache-Control: private, no-store` missing on error responses
**What goes wrong:** `jsonError(401, 'revoked')` paths return the response builder without `Cache-Control` header, and a CDN (Vercel, Cloudflare) caches the 401 → next doctor poll gets a cached 401 instead of fresh DB check.
**How to avoid:** `Cache-Control: private, no-store` lives in `baseHeaders` constant; EVERY `Response` constructor spreads `baseHeaders`. There is no error-response code path that builds headers from scratch.
**Warning signs:** Revoke-then-refresh test passes locally but fails in CI deployment with stale 401s or stale 200s after revocation.

### Pitfall 8: SharePage importing from Zustand store transitively
**What goes wrong:** A component pulled into `src/components/share/` indirectly imports `useStore` (e.g., via a shared `Card.tsx` that does `useStore((s) => s.theme)`). The lazy chunk now bundles the store + `s.user!` violations re-enter the codebase.
**How to avoid:** Run `grep -rn "useStore" src/components/share/` as a CI gate; must return zero matches. Theme/dark-mode is applied via the global `data-theme` attribute on `<html>` (set pre-mount in `main.tsx`) — components read CSS variables, not store.
**Warning signs:** Bundle analyzer shows store code in the `share` chunk; `useStore` selector ends up firing on doctor browsers.

### Pitfall 9: Hash routing collision with existing #/auth and #/legal
**What goes wrong:** `selectView` priority order in `App.tsx:186-189` is `legal > auth > dashboard > marketing`. Adding `share` at the top is correct (anonymous doctors must reach it without redirect), but a token containing `/auth/` or `/legal/` substrings would break — `startsWith('#/share/')` over `startsWith('#/auth/')` works as long as the hash actually starts with `#/share/`.
**How to avoid:** `if (opts.hash.startsWith('#/share/')) return 'share';` is line 1 of `selectView`, BEFORE the legal check. Token format is base64url (alphanumeric + `-` + `_`); no slashes in token, so `#/share/<token>` is unambiguous.

### Pitfall 10: framer-motion `animate-rise` on lazy chunks blocks first paint
**What goes wrong:** Doctor opens the link, sees the loading skeleton, then a 200-300ms framer-motion intro animation before CodeEntryScreen is interactive. Doctors think the page is broken.
**How to avoid:** SharePage initial mount uses CSS-only fade (matching `index.css:485` reduced-motion contract); framer-motion only kicks in for state transitions (code success → SharePage). Time-to-interactive on the share chunk ≤ 500ms after JS parse.

## Code Examples

### Add audit_logs columns + foreign key
```sql
-- Source: derived from /Users/karstenhaldan/minisite/supabase/migrations/20260601000001_audit_logs.sql (existing schema)
create type public.audit_actor_type as enum ('user', 'share_recipient', 'system');

alter table public.audit_logs add column actor_type public.audit_actor_type
  not null default 'user';
alter table public.audit_logs add column share_id uuid;  -- FK added after shares table exists

-- Extend the action check to allow share_view
alter table public.audit_logs drop constraint audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'insert', 'update', 'delete',
  'account_deleted_initiated', 'account_deleted_finalized',
  'share_view'
));

-- Recipient metadata columns (D-04: NOT used for binding, only for Active shares display)
alter table public.audit_logs add column recipient_ua_family text;
alter table public.audit_logs add column recipient_ip_family text;

-- Partial index for Active shares tab aggregate query
-- (literals + column comparisons only — IMMUTABLE check passes)
create index audit_logs_share_recipient_idx
  on public.audit_logs (share_id, timestamp desc)
  where actor_type = 'share_recipient';
```

### shares table + RLS + FK back to audit_logs
```sql
-- Source: derived from Phase 5/6/7 RLS + FK patterns
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null,                   -- sha256(raw_token); raw never stored
  access_code_hash text not null,             -- bcrypt(crypt(...)); raw never stored
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,                     -- null = active
  code_consumed_at timestamptz,               -- null = not yet redeemed; non-null = consumed
  recipient_session_hash text,                -- sha256(opaque cookie token); null until redeem
  failed_attempts_count int not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index shares_token_hash_idx on public.shares (token_hash);
-- Active shares partial index (IMMUTABLE — literals only)
create index shares_user_active_idx on public.shares (user_id, expires_at)
  where revoked_at is null;

alter table public.shares enable row level security;

-- Owner can see + delete own shares; never INSERT/UPDATE directly (those go through RPCs)
create policy shares_select_own on public.shares
  for select using (auth.uid() = user_id);
-- NO insert/update/delete policy for authenticated — RPCs are the write path.
-- service_role bypasses RLS for Edge Function reads.

-- FK back from audit_logs.share_id (now that shares table exists)
alter table public.audit_logs
  add constraint audit_logs_share_id_fkey
  foreign key (share_id) references public.shares(id) on delete set null;
```

### log_share_view RPC (Edge Function calls this on every snapshot read)
```sql
create or replace function public.log_share_view(
  p_share_id uuid,
  p_ua_family text,
  p_ip_family text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.shares where id = p_share_id;
  if v_owner is null then raise exception 'share not found' using errcode = 'P0002'; end if;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action,
     actor_type, share_id, recipient_ua_family, recipient_ip_family)
  values (
    v_owner,
    encode(digest(v_owner::text, 'sha256'), 'hex'),
    'shares',
    p_share_id::text,
    'share_view',
    'share_recipient',
    p_share_id,
    p_ua_family,
    p_ip_family
  );
end;
$$;

revoke all on function public.log_share_view(uuid, text, text) from public;
-- Only service_role calls this (Edge Function context)
```

### Edge Function /share/snapshot — cookie validation + view read
```typescript
// Source: derived from /Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts
import { getCookies } from 'jsr:@std/http/cookie';

async function handleSnapshot(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonError(400, 'missing-token', baseHeaders);

  const tokenHash = await sha256Hex(token);
  const { data: share, error } = await admin
    .from('shares')
    .select('id, user_id, expires_at, revoked_at, recipient_session_hash')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !share) return jsonError(404, 'not-found', baseHeaders);
  if (share.revoked_at !== null) return jsonError(401, 'revoked', baseHeaders);
  if (new Date(share.expires_at) < new Date()) return jsonError(401, 'expired', baseHeaders);

  // Cookie binding (D-03)
  const cookies = getCookies(req.headers);
  const recipientSession = cookies['recipient_session'];
  if (!recipientSession) return jsonError(401, 'requires_code', baseHeaders);

  const cookieHash = await sha256Hex(recipientSession);
  if (cookieHash !== share.recipient_session_hash) {
    return jsonError(401, 'invalid_session', baseHeaders);
  }

  // Audit
  await admin.rpc('log_share_view', {
    p_share_id: share.id,
    p_ua_family: parseUaFamily(req.headers.get('User-Agent') ?? ''),
    p_ip_family: parseIpFamily(req.headers.get('x-forwarded-for') ?? ''),
  });

  // Snapshot — read from view (NOT from base tables; NOT joining ai_messages)
  const { data: snapshot } = await admin
    .from('share_snapshot_view')
    .select('*')
    .eq('user_id', share.user_id);

  // Photo signed URLs (TTL ≤ remaining share lifetime)
  const ttlSec = Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000);
  // ... mint signed URLs for each photo path in snapshot ...

  return new Response(JSON.stringify({ snapshot, expires_at: share.expires_at }), {
    status: 200,
    headers: baseHeaders,  // includes Cache-Control: private, no-store
  });
}
```

### App.tsx selectView extension
```typescript
// Source: extends /Users/karstenhaldan/minisite/leanshot/src/App.tsx:180-190
function selectView(opts: { user: unknown; hash: string }): View {
  // Phase 8 — share hash routes take ABSOLUTE top priority. Anonymous doctors
  // must reach the share page without bouncing through marketing/auth.
  if (opts.hash.startsWith('#/share/')) return 'share';
  if (opts.hash.startsWith('#/legal/')) return 'legal';
  if (opts.hash.startsWith('#/auth/')) return 'auth';
  if (opts.user) return 'dashboard';
  return 'marketing';
}

type View = 'marketing' | 'onboarding' | 'auth' | 'dashboard' | 'legal' | 'share';

const SharePage = lazy(() =>
  import('@/components/share/SharePage').then((m) => ({ default: m.SharePage })),
);

// In render branch:
if (view === 'share') {
  const token = window.location.hash.replace('#/share/', '');
  return (
    <Suspense fallback={<FullPageLoader />}>
      <SharePage token={token} />
    </Suspense>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser-direct Supabase reads with custom RLS for share | Edge Function gate + opaque-token cookie + view-based snapshot | Phase 4 (ai-chat established the gate-via-Edge-Function pattern); Phase 7 (audit + RPC patterns matured) | All net-new share logic flows through Edge Function; doctor never holds the patient's JWT. |
| JWT-only revocation (token TTL) | DB-row revocation check on every poll | Phase 8 D-02 | Revocation latency drops from "JWT TTL" (could be hours) to "next poll interval" (single-digit seconds). |
| Magic-link or doctor account | 6-digit code + HttpOnly cookie | Phase 8 D-03 (vs deferred SHARE-V2-01) | Zero doctor signup friction; share-rate retained. |
| Hand-built CSP for share pages | Reuse existing Vercel/CDN headers + Edge Function `Cache-Control` | Phase 8 | Phase 2 deploy-phase decisions cover CSP; share-route just adds `private, no-store`. |

**Deprecated/outdated:**
- Browser-direct Anthropic key calls (Phase 4) — irrelevant to Phase 8 but worth noting the pattern transfer: Edge Function as the secret-holder + RLS-aware gate is the same architecture.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `jsr:@std/http/cookie` `sameSite: 'Strict'` typing matches current JSR std. Last verified ~2026-Q1 timing of std std stable. | Pattern 3 | If the typing was renamed, the Edge Function fails to compile; trivial to fix during implementation. |
| A2 | bcrypt cost 10 + 5/min/share rate-limit is sufficient brute-force resistance for 6-digit code. | Standard Stack alternatives | Worst case: increase cost to 12 or tighten rate-limit to 3/min. Both are config-level fixes, not architecture. |
| A3 | Vercel/Cloudflare CDN respects `Cache-Control: private, no-store` for all 4xx + 5xx responses out of the box. `[ASSUMED]` since the project's hosting target was deferred to Phase 2 deploy phase. | Pitfall 7 | If a CDN ignores `private` for 401s, we add `Vary: Cookie` header — single-line fix. Validation Architecture includes a CDN-cache-poisoning test that catches this. |
| A4 | Doctor browser will not block third-party HttpOnly cookies set by `*.supabase.co` when the SPA is on a different host. `[ASSUMED]` — depends on browser tracker-protection heuristics. | Pitfall 3 | Mitigation: deploy share Edge Function under a custom domain that matches the SPA's eTLD+1 (e.g., `api.leanshot.com`). Phase 2 deploy decisions can park this; document as a known caveat. |
| A5 | `random()` in `create_share` for code generation is sufficient — pgcrypto `gen_random_bytes(4)` mod 1_000_000 would be more secure but `random()` is cryptographically weak. `[ASSUMED]` acceptable because (a) the code is single-use, (b) rate-limited, (c) only valid until expiry. **Stronger recommendation:** use `gen_random_bytes` to generate the 6-digit number — costs nothing extra. Planner should default to CSPRNG even though `random()` would work. | Code Examples (`create_share`) | Implementation MUST use `(get_byte(gen_random_bytes(4), 0) << 24 | ...) % 1000000` style, not `random()`. Easy fix; flagging here so planner doesn't lift the example verbatim. |
| A6 | `share_snapshot_view` can be a regular view (not materialized) and still serve doctor polls without measurable latency. `[ASSUMED]` at v1 patient-count scale (≤ ~10k rows per user across all sync tables). | Pattern 4 | If perf bites at scale, switch to materialized view refreshed on sync-write OR memoize the snapshot inside Edge Function for the share lifetime. Both deferrable to Phase 8.5. |
| A7 | Cookie path `/` works for sharing across `/functions/v1/share/redeem` and `/functions/v1/share/snapshot`. `[CITED: MDN Set-Cookie]` — Path attribute is a URL prefix match. | Pattern 3 | Implementation can scope tighter to `/functions/v1/share/` if browser quirks emerge. |

## Open Questions

1. **Single Edge Function (path-routed) vs two separate Edge Functions (one per endpoint)?**
   - What we know: `ai-chat` is a single function; the share use case has two distinct flows.
   - What's unclear: Whether routing inside one `Deno.serve` adds non-trivial complexity vs two deploys.
   - Recommendation: Single function with path-based routing (matches `ai-chat` precedent). Two functions only if planner finds the cookie-context plumbing easier separated.

2. **Cookie domain when SPA + Edge Function are on different eTLD+1?**
   - What we know: With SameSite=Strict, the cookie attaches on subsequent fetches to the Edge Function host regardless of initiating page origin (the cookie is owned by the Edge Function's domain).
   - What's unclear: Whether Vercel's domain proxying changes the picture for the SPA path of `/functions/v1/`. Phase 2 deploy decisions will clarify.
   - Recommendation: Plan 08-02 (Edge Function) includes a 10-minute spike in implementation to verify cookie attaches in a real Vercel preview. Falls back to "deploy share Edge Function under a custom subdomain that matches the SPA's eTLD+1" if not.

3. **Should `revoke_share` also null out `recipient_session_hash`?**
   - What we know: Per CONTEXT.md D-02 Failure Mode (a), per-request DB check on `revoked_at` is the primary gate; cookie is secondary.
   - What's unclear: Whether nulling the hash is defense-in-depth or redundant.
   - Recommendation: Null it. Two checks (revoked_at + recipient_session_hash) cost nothing extra; the second one becomes load-bearing if some future code path forgets to check `revoked_at`.

4. **Active shares "view count" — is it audit-log row count, or a denormalized counter on shares?**
   - What we know: D-04 says query `audit_logs` with `actor_type='share_recipient'`. Suggests no denormalization needed.
   - What's unclear: Performance with many shares × many polls.
   - Recommendation: Start with the aggregate query (`select share_id, count(), max(timestamp)`). If perf bites, add a trigger that bumps `shares.view_count` and `shares.last_viewed_at` on every `log_share_view` insert. Deferrable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest, Playwright, build | ✓ | 22.18.0 | — |
| supabase CLI | Migration push, function deploy | ✓ | 2.98.2 | — |
| Deno | Local Edge Function smoke test | ✓ | 2.7.14 | Supabase Edge Runtime supplies it in prod regardless |
| Postgres `pgcrypto` | digest, crypt, gen_random_bytes | ✓ | bundled with Supabase Postgres | — |
| Playwright browsers (chromium) | E2E + revocation drill | ✓ | playwright 1.59.1 | — |
| Supabase project `ytnsipxxmzgaebkqmokp` | All cloud ops | ✓ | eu-west-1 free tier | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (unit + RLS) + Playwright 1.59.1 (e2e) |
| Config file | `vitest.config.ts` (unit), `vitest-e2e.config.ts` (RLS), `playwright.config.ts` (e2e) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm test` (vitest run + playwright) |
| RLS proof command | `npm run test:e2e:rls` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-01 | Patient creates share link with time-bounded expiry | e2e | `npx playwright test e2e/share-happy-path.spec.ts -g "create"` | Wave 0 — create `e2e/share-happy-path.spec.ts` |
| SHARE-01 | `create_share` RPC returns token+code ONCE | unit (Postgres) via vitest-e2e | `npm run test:e2e:rls -- rls-shares.test.ts -t "rpc returns secrets once"` | Wave 0 — create `e2e/rls-shares.test.ts` |
| SHARE-02 | Doctor opens link, enters code, sees snapshot | e2e | `npx playwright test e2e/share-happy-path.spec.ts -g "code entry"` | Wave 0 |
| SHARE-02 | Snapshot includes chart, injections, symptoms, photos, weight, doctor report | e2e (DOM assertion) | same as above, extended | Wave 0 |
| SHARE-03 | `share_snapshot_view` structurally excludes `ai_messages` | unit (Postgres) | `npm run test:e2e:rls -- rls-shares.test.ts -t "ai_messages excluded"` — asserts neither view definition nor materialized rows reference ai_messages | Wave 0 |
| SHARE-03 | Edge Function /snapshot response JSON has no `ai_*` keys | unit | `npm run test:unit -- src/components/share/SharePage.test.tsx` snapshot contract test | Wave 0 |
| SHARE-04 | Revoke → doctor's open tab returns 401 within 5 seconds | e2e (4-failure-mode drill) | `npx playwright test e2e/share-revocation-drill.spec.ts` | Wave 0 |
| SHARE-04 (a) | Token cache: refreshing doctor page after revoke serves 401 | e2e drill assertion | same | Wave 0 |
| SHARE-04 (b) | HTTP cache: CDN doesn't serve cached 200 after revoke (`Cache-Control: private, no-store`) | e2e drill (asserts response headers + cache buster) | same | Wave 0 |
| SHARE-04 (c) | JWT TTL: token can be revoked BEFORE its expires_at; DB-row check beats TTL | e2e drill (admin-revoke before expiry, then poll) | same | Wave 0 |
| SHARE-04 (d) | Forwarded link: open in different browser context = different cookie → 401 | e2e drill (Playwright second context with same URL) | same | Wave 0 |
| SHARE-05 | Doctor view writes `audit_logs` row with actor_type='share_recipient', share_id, action='share_view' | unit (Postgres) | `npm run test:e2e:rls -- rls-shares.test.ts -t "audit row written on view"` | Wave 0 |
| SHARE-05 | Active shares tab aggregates view count + last_viewed correctly | unit (vitest + @testing-library) | `npm run test:unit -- src/components/dashboard/settings/ActiveSharesSection.test.tsx` | Wave 0 |
| SHARE-06 | Every share response carries `Cache-Control: private, no-store` (including 4xx) | e2e (curl/fetch + header assert) | `npx playwright test e2e/share-revocation-drill.spec.ts -g "cache control"` | Wave 0 |
| SHARE-06 | Cookie has HttpOnly + Secure + SameSite=Strict | e2e (Playwright `context.cookies()`) | same | Wave 0 |
| SHARE-06 | Code is single-use (second redeem same code → 410 already_consumed) | unit (Postgres + Edge Function) | `npm run test:e2e:rls -- rls-shares.test.ts -t "code single-use"` | Wave 0 |
| RLS rule | Cross-tenant impersonation: user B cannot SELECT user A's shares row | unit (vitest-e2e) | `npm run test:e2e:rls -- rls-shares.test.ts -t "cross-tenant"` | Wave 0 — REQUIRED by project rule (every new RLS surface) |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- <related-file>` + typecheck.
- **Per wave merge:** `npm test` (vitest run + playwright) locally; CI runs full suite + `npm run test:e2e:rls`.
- **Phase gate (before `/gsd-verify-work`):** Full suite green AND `e2e/share-revocation-drill.spec.ts` returns 0 failures AND `e2e/rls-shares.test.ts` returns 0 failures.

### Test Pyramid for this Phase
- **Unit (~10 tests):** RPC return shape, view structural exclusion, SharePage snapshot contract, ActiveSharesSection aggregate render, CodeEntryScreen auto-submit, helper utilities (sha256Hex, parseUaFamily).
- **Integration (~6 tests):** Edge Function `/share/redeem` happy path + wrong code + already-consumed + rate-limit; `/share/snapshot` cookie present + cookie missing + revoked + expired. Use `vitest` + a real Supabase test project OR mock the Postgres surface via service-role admin.
- **E2E (~3 specs):** `share-happy-path.spec.ts` (create → open → enter code → view → print), `share-revocation-drill.spec.ts` (4-failure-mode), one print-mode visual regression spec.
- **RLS impersonation (~1 spec):** `e2e/rls-shares.test.ts` — user B cannot read user A's shares, cannot impersonate user A on insert.
- **Security drill (folded into share-revocation-drill.spec.ts):** Each of the 4 failure modes is its own `test()` block inside the drill spec.

### Wave 0 Gaps
- [ ] `e2e/share-happy-path.spec.ts` — covers SHARE-01, SHARE-02, SHARE-05
- [ ] `e2e/share-revocation-drill.spec.ts` — covers SHARE-04, SHARE-06
- [ ] `e2e/rls-shares.test.ts` — covers cross-tenant project rule + SHARE-03 + SHARE-05 (audit-row write)
- [ ] `src/components/share/SharePage.test.tsx` — covers SHARE-03 snapshot contract
- [ ] `src/components/dashboard/settings/ActiveSharesSection.test.tsx` — covers SHARE-05 patient-visible audit

*(Existing test infrastructure — vitest, playwright, vitest-e2e — covers all framework needs; no new framework install required.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Patient: Supabase Auth JWT (existing). Recipient: opaque HttpOnly cookie bound to share row hash. No JWT for recipient. |
| V3 Session Management | yes | Cookie: HttpOnly + Secure + SameSite=Strict + Max-Age ≤ share expiry. DB-row check is primary gate; cookie is recipient binding. |
| V4 Access Control | yes | RLS on `shares` (owner-only SELECT). SECURITY DEFINER RPCs for all writes. Edge Function service-role bypass scoped to the four RPCs only. |
| V5 Input Validation | yes | `create_share`: `expires_at > now()`, label length 1..80. `redeem`: numeric-only 6-digit code, token base64url chars only. Pydantic-equivalent in TS: zod is not in dep tree; manual validation in RPC plpgsql + Edge Function. |
| V6 Cryptography | yes | bcrypt for access_code_hash (pgcrypto crypt + gen_salt('bf', 10)). sha256 for token_hash + recipient_session_hash. CSPRNG via gen_random_bytes for token + cookie value. NEVER hand-rolled. |
| V7 Error Handling & Logging | yes | Edge Function errors use stable code shape (`{error: '<code>'}`). NEVER echo Postgres error strings. audit_logs row written for every view. |
| V9 Communication | yes | All share routes HTTPS-only (Vercel/Cloudflare enforces). Cookie Secure attribute set. |
| V13 API & Web Service | yes | CORS: `Access-Control-Allow-Origin` must echo request Origin (allow-list) because `credentials: include` forbids `*`. |

### Known Threat Patterns for share-route stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stolen / leaked share URL | Spoofing | 6-digit code (out-of-band) + single-use code consumption + HttpOnly cookie binding (D-03) |
| Replayed cookie from doctor A's session by attacker | Spoofing | SameSite=Strict + Secure + HttpOnly (browser-enforced); cookie hash check on every poll |
| Brute-force code attempts | Spoofing / DoS | 5/min/share rate limit via `increment_share_attempt` RPC (failed_attempts_count column or separate counter table) |
| Direct INSERT to `audit_logs` to hide a view | Tampering | audit_logs has NO INSERT policy for authenticated role; service-role bypass only inside `log_share_view` SECURITY DEFINER RPC |
| Direct UPDATE to `shares` to extend expires_at | Tampering | shares has NO UPDATE policy for authenticated role; only `revoke_share` RPC (which only sets revoked_at) writes |
| Token enumeration via `shares` SELECT | Information disclosure | `shares` RLS scopes SELECT to `auth.uid() = user_id`; service-role token-hash lookups happen only inside Edge Function |
| AI conversation leak in snapshot | Information disclosure (SC#3) | `share_snapshot_view` does not join `ai_messages`; structural — not application-layer filter |
| CDN caches snapshot response | Information disclosure | `Cache-Control: private, no-store` on every response including errors |
| CSRF via cross-site form post to `/share/redeem` | Tampering | SameSite=Strict cookie ensures cross-site request doesn't carry the auth context; CORS allow-list pins origin |
| Cross-tenant impersonation insert (`user_id` in payload) | Tampering | `create_share` RPC reads `auth.uid()` only; no user_id parameter |
| Forwarded URL after code entry | Spoofing | Cookie is HttpOnly + SameSite=Strict → not transferable; new browser context = no cookie = code-entry screen, but code already consumed → fail |
| Audit-row write race condition (view counted before doctor actually saw snapshot) | Repudiation (inverse) | `log_share_view` fires BEFORE returning snapshot; if Postgres fails, response is 500 and doctor sees nothing (consistent state) |
| Share owner deletes account mid-share | Information disclosure | Phase 7 `initiate_account_deletion` must ALSO revoke outstanding shares (add to that RPC; document as Phase 7 follow-up if not already there) |

## Sources

### Primary (HIGH confidence)
- `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts` — Edge Function template (Deno.serve, JWT validation, service-role client, EdgeRuntime.waitUntil)
- `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/cors.ts` — CORS pattern (note: must deviate for cookie credentials)
- `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/rate-limit.ts` — rate-limit pattern (key shape needs swap from user_id to share_id)
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000001_audit_logs.sql` — audit_logs schema + RLS pattern
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000002_audit_triggers.sql` — SECURITY DEFINER trigger pattern + search_path discipline
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql` — SECURITY DEFINER RPC with `extensions` in search_path
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000016_finalize_storage_bypass.sql` — Storage delete bypass GUC pattern (reference; not used in Phase 8 directly)
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — app.suppress_audit GUC hook
- `/Users/karstenhaldan/minisite/leanshot/src/App.tsx:60-190` — `selectView` + lazy chunk + hash-route pattern
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:59-72` — NAV array extension point
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/modals/DoctorReport.tsx` — `window.print()` + print stylesheet
- `/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts` — RLS proof template
- `/Users/karstenhaldan/minisite/leanshot/playwright.config.ts` + `vitest-e2e.config.ts` — test runner configs
- `/Users/karstenhaldan/minisite/leanshot/package.json` — verified dependency versions
- Phase 7 RESEARCH.md (`07-RESEARCH.md`) — pgcrypto / SECURITY DEFINER / IMMUTABLE / GUC patterns
- CONTEXT.md (`08-CONTEXT.md`) — locked decisions D-01..D-04
- UI-SPEC.md (`08-UI-SPEC.md`) — design contract for all 5 surfaces
- Memory `reference_supabase_migration_gotchas.md` — four reusable migration deviations
- Memory `reference_supabase_project.md` — RLS proof rule
- Memory `feedback_parallel_executor_git_isolation.md` — pathspec commits for parallel execution

### Secondary (MEDIUM confidence)
- [Supabase Edge Functions docs (quickstart)](https://supabase.com/docs/guides/functions/quickstart) — confirms Deno runtime, JWT verification gate
- [Supabase troubleshooting: HttpOnly cookies](https://supabase.com/docs/guides/troubleshooting/how-do-i-make-the-cookies-httponly-vwweFx) — confirms manual Set-Cookie construction is the supported path
- [MDN Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) — Path attribute semantics, SameSite + Secure + HttpOnly interactions
- [PostgreSQL pgcrypto reference](https://www.postgresql.org/docs/current/pgcrypto.html) — crypt(), gen_salt('bf'), gen_random_bytes()

### Tertiary (LOW confidence — flagged in Assumptions Log)
- `jsr:@std/http/cookie` exact typing of `sameSite: 'Strict'` — verify during implementation (A1)
- Vercel/Cloudflare CDN behavior on `private, no-store` for 4xx (A3)
- Third-party cookie blocking heuristics for `*.supabase.co` cookies set during a `*.leanshot.com` page (A4)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already in the dep tree; Phase 4 Edge Function template + Phase 7 SECURITY DEFINER + RLS patterns read in full.
- Architecture: HIGH — recombination of three existing phases (4 + 6 + 7); no novel architecture.
- Pitfalls: HIGH — five of the ten pitfalls have already been encountered and resolved in earlier phases (logged in memory); five are deduced from cookie + CORS spec.
- Security: HIGH — STRIDE register maps directly to existing Phase 7 mitigations; new surfaces are well-typed.

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — stable infrastructure; if Supabase platform or Edge Runtime ships breaking changes, re-verify Pattern 1 and Pattern 3 only)

---

*Phase: 08-doctor-read-share*
*Research authored: 2026-05-12*
