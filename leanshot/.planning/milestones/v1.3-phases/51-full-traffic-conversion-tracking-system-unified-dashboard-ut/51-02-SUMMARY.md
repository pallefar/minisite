---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 02
subsystem: traffic-ingest
tags: [edge-middleware, edge-fn, posthog, attribution, cookie, traffic, phase-51]
requires:
  - phase: 51
    plan: 01
    artifact: "supabase/migrations/20271102000005_upsert_traffic_attribution_rpcs.sql"
provides:
  - "Vercel Edge Middleware mints lt_anon_id HttpOnly cookie (TRAFFIC-02)"
  - "traffic-attribution-recorder Edge Fn (TRAFFIC-01)"
  - "recordTouch() shared helper — classify + UPSERT + PostHog mirror"
  - "merge-anon-session extension — aliasServerSide + claim_traffic_attribution (TRAFFIC-03)"
  - "SPA fire-touch helper closes Vite-preset gap (W5 fix)"
affects:
  - "leanshot/middleware.ts (additive — preserves Phase 41-03 CSP augmentation)"
  - "supabase/functions/merge-anon-session/index.ts (additive — step 7 stitch)"
  - "supabase/config.toml ([functions.traffic-attribution-recorder] verify_jwt = false)"
  - "leanshot/src/main.tsx (additive — fireTouchOnce() invocation after createRoot.render)"
tech-stack:
  added: []
  patterns:
    - "Vercel Edge Middleware @vercel/edge — Request → Response, NOT NextResponse"
    - "Origin-allowlist auth (3 hosts) — no browser-bundled HMAC secret"
    - "HttpOnly cookie + Cookie-header fallback in recorder Fn (server-side reads what document.cookie cannot)"
key-files:
  created:
    - "supabase/functions/_shared/traffic-attribution.ts"
    - "supabase/functions/traffic-attribution-recorder/index.ts"
    - "supabase/functions/traffic-attribution-recorder/deno.json"
    - "supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts"
    - "leanshot/src/lib/traffic/fire-touch.ts"
    - "leanshot/src/lib/traffic/fire-touch.test.ts"
  modified:
    - "leanshot/middleware.ts"
    - "leanshot/src/main.tsx"
    - "supabase/functions/merge-anon-session/index.ts"
    - "supabase/config.toml"
    - "leanshot/.planning/ROADMAP.md"
decisions:
  - "Replaced PLAN's HMAC-bearer auth with origin allowlist — browser-bundled HMAC secret cannot be secret. Same shape as PostHog's /e/ endpoint."
  - "Recorder Fn reads lt_anon_id from inbound Cookie header when body.anonId is missing (HttpOnly fallback). Without this fallback TRAFFIC-01 cannot work end-to-end."
  - "Existing Phase 41-03 CSP augmentation preserved VERBATIM below the new cookie-mint block in middleware.ts."
metrics:
  duration: ~9min
  completed: 2026-05-24
---

# Phase 51 Plan 02: Traffic Ingest Pipeline (Middleware + Recorder Fn + Merge Extension) Summary

Ingest pipeline that lands a row in `user_traffic_attribution` end-to-end on every first landing: Vercel Edge Middleware mints `lt_anon_id` HttpOnly cookie (additive to Phase 41-03's CSP augmentation), SPA fires the recorder Fn on first React mount, recorder classifies + UPSERTs via Plan 51-01's SECDEF RPCs, and `merge-anon-session` stitches anon → user_id at signup via `claim_traffic_attribution` + PostHog alias.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Vercel Edge Middleware — lt_anon_id cookie mint (additive to 41-03 CSP) | `ed46965b` | leanshot/middleware.ts |
| 2 | recordTouch helper + recorder Edge Fn + 7 Deno tests + deno.json + verify_jwt=false | `4f434608` | supabase/functions/_shared/traffic-attribution.ts, supabase/functions/traffic-attribution-recorder/{index.ts,deno.json,traffic-attribution-recorder.test.ts}, supabase/config.toml |
| 3 | merge-anon-session extension — parseCookie + claim_traffic_attribution + alias | `649e52ee` | supabase/functions/merge-anon-session/index.ts |
| 4 | SPA fire-touch helper + main.tsx wire + 3 vitest tests + recorder Cookie-fallback | `c1c789f9` | leanshot/src/lib/traffic/{fire-touch.ts,fire-touch.test.ts}, leanshot/src/main.tsx, supabase/functions/traffic-attribution-recorder/index.ts |

## (a) middleware.ts cookie spec

- **Cookie:** `lt_anon_id=<uuidv4>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` (90d sliding window).
- **Refresh-on-every-visit:** Always (re)set `Set-Cookie` so the 90d window slides forward.
- **No `Domain=` attribute** — scopes to request host; avoids hash-route SPA cookie-domain interaction (project memory `reference_supabase_auth_traps`).
- **UUIDv4:** `crypto.randomUUID()` (Edge runtime built-in) — NO `npm:uuid` per RESEARCH anti-pattern.
- **Slug-aware:** `/share/clinic-<slug>` landings additionally set `lt_clinic_slug_seen=<slug>; Max-Age=300` (5 min transient; D-12 org_id resolution feed).
- **Integration with Phase 41-03 CSP:** the cookie-mint block runs BEFORE the existing `csp === ''` early-return so cookies land on responses that have no CSP header. The 41-03 CSP augmentation (iframe_allowlist `frame-src` injection + `report-uri` assembly) is preserved VERBATIM below the new block.
- **Matcher:** kept the existing 41-03 matcher `['/((?!api|_next/static|assets|favicon).*)']` — already excludes static assets.

## (b) Recorder Fn origin-gate decision

The PLAN's Task 1 §security correction acknowledged that a browser-bundled HMAC secret cannot be secret. This SUMMARY confirms the resolution shipped:

- **Auth:** origin allowlist of 3 hosts (`https://app.leanshot.app`, `https://leanshot.app`, `https://www.leanshot.app`). Non-allowlist origin → 403 `origin_denied`. Same shape as PostHog's own `/e/` endpoint.
- **`verify_jwt = false`** added to `supabase/config.toml` — gateway-level prerequisite for unauthenticated POST (project memory `reference_supabase_config_toml_verify_jwt`).
- **Defenses:** PHI path redaction (T-51-10) — `/patient/*`, `/dose-log/*`, `/clinic/<x>/patient/*` → `/[redacted]`. UTM field length clamp (T-51-11) — each ≤2048 bytes. Referrer clamp ≤4096 bytes. Landing path clamp ≤2048 bytes.
- **Idempotency:** `upsert_traffic_attribution` (Plan 51-01) preserves first-touch via `ON CONFLICT (anon_id) DO UPDATE` that excludes the `first_touch_*` columns. Replay-spam at worst inflates `last_touch_*` row counts — defended at the matview layer in Plan 51-03.

**Tests (Deno, 4 plan-required + 3 helper-sanity = 7/7 green):**
1. Rejects non-allowlist origin (403 origin_denied)
2. Clamps utm fields >2048 bytes before recordTouch
3. Redacts PHI landing paths (`/clinic/<x>/patient/<y>`, `/dose-log/<id>`, with `/pricing` passthrough)
4. Returns 200+`{ok:false,error}` on RPC failure (fire-and-forget contract)
5. `clamp()` null-safe
6. `redactPath()` regex coverage (positive + negative)
7. `isAllowedOrigin()` allowlist coverage (incl. http vs https)

## (c) merge-anon-session extension hook point

Added a `parseCookie()` helper next to `jwtFromReq()`. Added step 7 AFTER the existing PostHog alias (step 6) and BEFORE the `finally { await doShutdown() }` block — inside the existing try so the `shutdownPostHog()` invariant (PITFALL 1) covers the new branch:

```typescript
const ltAnonId = parseCookie(req.headers.get('cookie'), 'lt_anon_id');
if (ltAnonId) {
  try { doAlias(userId, ltAnonId); } catch (err) { console.warn(...); }
  try {
    const { error } = await admin().rpc('claim_traffic_attribution', {
      p_anon_id: ltAnonId, p_user_id: userId,
    });
    if (error) console.warn(...);
  } catch (err) { console.warn(...); }
}
```

- **Cookie-only (NOT body):** preserves backwards-compat with existing browser callers per PATTERNS invariant. New browser surfaces don't need to know about `lt_anon_id`.
- **Best-effort, non-fatal:** an unstitched traffic row is a degraded analytics signal, not a user-data integrity issue. Existing 8 unit tests pass unchanged.
- **Idempotent at RPC layer:** `claim_traffic_attribution` only sets `user_id` WHERE `user_id IS NULL`. Re-calls on already-stitched rows are no-ops.

## (d) SPA fire-touch helper (W5 fix)

The middleware sets the cookie but does NOT POST to the recorder (Vercel Vite-preset `ctx.waitUntil` support is uncertain per RESEARCH Q1). Without an SPA-side fire, TRAFFIC-01 is not end-to-end: only the cookie is set; no attribution row is written. `leanshot/src/lib/traffic/fire-touch.ts` closes that gap:

- **Idempotent:** module-scoped `_sent` flag — StrictMode-safe (re-mounts don't re-import the module).
- **Fire-and-forget:** never throws, never blocks first paint.
- **Production HttpOnly behavior:** because `lt_anon_id` is HttpOnly, `document.cookie` does NOT expose it to the SPA. The SPA omits `anonId` from the POST body; the browser auto-attaches the cookie server-side via `credentials: 'include'`. The recorder Fn falls back to reading from `req.headers.get('cookie')` (Rule 2 auto-fix shipped as part of Task 4).
- **Wire point:** `leanshot/src/main.tsx` inside `hydrate().then(...)` AFTER `createRoot.render(...)` — `void fireTouchOnce()`, not awaited.

**Tests (vitest, 3/3 green via `npx vitest run --config vite.config.ts`):**
1. Happy path — posts once with utm + referrer + landingPath + anonId (when test cookie is set)
2. Idempotent — 3 calls within same module load → 1 POST
3. Still fires when `lt_anon_id` cookie unreadable (HttpOnly prod path)

## Deviations from Plan

### Rule 2 auto-fix: HttpOnly Cookie-header fallback in recorder Fn

- **Found during:** Task 4 implementation
- **Issue:** The PLAN's recorder Fn requires `body.anonId` and returns 400 `anon_id_required` when missing. But `lt_anon_id` is set as `HttpOnly` by the middleware (per PLAN Task 1 and project security posture), so `document.cookie` cannot read it. In production the SPA's POST body has no `anonId` → recorder returns 400 → TRAFFIC-01 cannot work end-to-end.
- **Fix:** Added `readLtAnonIdFromCookieHeader()` helper. Recorder Fn now resolves `anonId = body.anonId ?? readFromCookieHeader(req)` before the required-field check. Browser auto-attaches `lt_anon_id` via `credentials:'include'`, so the cookie value reaches the recorder server-side.
- **Files modified:** `supabase/functions/traffic-attribution-recorder/index.ts` (added helpers; new vitest case "still fires when lt_anon_id cookie is unreadable" exercises the path).
- **Commit:** `c1c789f9`

### Rule 2 auto-fix: supabase/config.toml [functions.traffic-attribution-recorder] verify_jwt = false

- **Found during:** Task 2
- **Issue:** PLAN frontmatter `files_modified` did NOT include `supabase/config.toml`. Without `verify_jwt = false`, the Supabase Functions gateway 401s every browser-origin POST before the function code runs — Plan 51-10 deploy verification would fail.
- **Fix:** Added the block with comment trail referencing project memory `reference_supabase_config_toml_verify_jwt`. Matches the pattern already shipped for `stripe-webhook`, `lead-capture`, `page-render`, etc.
- **Files modified:** `supabase/config.toml`
- **Commit:** `4f434608`

### Replaced HMAC-bearer auth with origin allowlist (PLAN-acknowledged in Task 1)

- **Status:** PLAN's Task 1 §security correction explicitly called this out as the intended deviation; shipping it here for fidelity.
- **Justification:** A browser-bundled HMAC secret is not secret. Origin allowlist is the same shape PostHog uses for `/e/`. Append-only writes + ON CONFLICT first-touch immutability bound the abuse surface.
- **Removed:** `TRAFFIC_INGEST_HMAC_SECRET` Function Secret requirement. Plan 51-10's closeout secret-pre-flight does NOT need to set this.

## Threat Flags

None — all new surface is covered by the plan's `<threat_model>` register (T-51-08..15). No additional security-relevant surface introduced beyond what the planner enumerated.

## Self-Check: PASSED

**Created files:**
- FOUND: `supabase/functions/_shared/traffic-attribution.ts`
- FOUND: `supabase/functions/traffic-attribution-recorder/index.ts`
- FOUND: `supabase/functions/traffic-attribution-recorder/deno.json`
- FOUND: `supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts`
- FOUND: `leanshot/src/lib/traffic/fire-touch.ts`
- FOUND: `leanshot/src/lib/traffic/fire-touch.test.ts`

**Commits:**
- FOUND: `ed46965b` (Task 1 middleware)
- FOUND: `4f434608` (Task 2 recorder + helper + config.toml)
- FOUND: `649e52ee` (Task 3 merge-anon-session)
- FOUND: `c1c789f9` (Task 4 fire-touch + main.tsx + Cookie-fallback Rule-2 fix)

**Verification:**
- 7/7 Deno tests pass for traffic-attribution-recorder
- 8/8 existing Deno tests pass for merge-anon-session (regression)
- 3/3 vitest tests pass for fire-touch
- `tsc --noEmit -p tsconfig.app.json` clean
