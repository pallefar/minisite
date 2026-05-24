---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 06
subsystem: events-zoom-integration
tags: [edge-function, zoom, s2s-oauth, admin-only, write-back]
requires:
  - 47-01-PLAN  # events schema (zoom_meeting_id, join_url, zoom_managed cols)
  - 47-02-PLAN  # events RLS + is_staff() helper baseline
  - 47-03-PLAN  # SECDEF event-write RPCs
  - 47-05-PLAN  # Wave 0 zoom-create-meeting/index.test.ts RED scaffold
provides:
  - zoom-create-meeting-edge-fn
  - zoom-s2s-oauth-pattern
  - zoom-managed-events
affects:
  - admin-event-create-form-flow      # Wave 2 UI plan will POST to this Fn
  - mux-webhook-event-recording       # 47-09 attaches recordings to Zoom-managed events
tech-stack:
  added:
    - "Zoom Server-to-Server OAuth (POST https://zoom.us/oauth/token + meeting:write:admin)"
    - "Zoom Meetings API v2 (POST /v2/users/me/meetings)"
  patterns:
    - "per-instance in-memory token cache w/ 60s safety margin + retry-on-401"
    - "is_staff() RPC gate via user-JWT supabase client"
    - "service-role admin client write-back (separate from user-JWT client)"
    - "test injection seam mirrors mux-create-upload (setAdminForTest / setSupaForTest)"
key-files:
  created:
    - supabase/functions/zoom-create-meeting/index.ts
    - supabase/functions/zoom-create-meeting/deno.json
  modified: []
decisions:
  - "Land RESEARCH §Example 5 verbatim as the skeleton, then layer CORS / lazy admin / test seams from mux-create-upload pattern — keeps the Wave 0 RED test scaffold's `import { handler }` injectable without Zoom mocks needing to monkey-patch globals."
  - "Use snake_case error codes (unauthorized / forbidden / event_not_found / zoom_oauth_<status> / zoom_create_<status> / zoom_not_configured) per <action> spec — strings flow through to admin UI toast."
  - "Explicit `zoom_not_configured` 502 branch when any of 3 ZOOM_S2S_* secrets missing — avoids opaque `zoom_oauth_400`/`zoom_oauth_401` confusion at first-deploy time before secrets are set."
  - "Sibling per-Fn deno.json instead of relying on import_map.json (per memory reference_supabase_functions_deploy_import_map_flag — CLI v2.101.0 silently ignores --import-map)."
  - "Deno.serve guarded by `import.meta.main && denoGlobal?.serve` per memory reference_deno_test_top_level_serve_trap — Wave 0 test file can `import { handler }` without spawning a real HTTP server."
metrics:
  duration_minutes: ~5
  completed: 2026-05-24
---

# Phase 47 Plan 06: zoom-create-meeting Edge Fn Summary

S2S OAuth-backed Zoom meeting creator with in-memory token cache, 401-refresh-retry, is_staff() admin gate, and service-role write-back of `events.zoom_meeting_id` + `events.join_url` + `events.zoom_managed=true`. Implements D-06 (S2S OAuth pattern) and D-07 (admin-only event Zoom binding).

## What Shipped

1. **`supabase/functions/zoom-create-meeting/index.ts`** — Edge Fn handler.
   - **CORS preflight** + method guard (POST only).
   - **Auth gate**: caller JWT → user-JWT supabase client → `auth.getUser()` → `rpc('is_staff')` → 401 / 403.
   - **Body validation**: requires `{ event_id: string }` → 400 `event_id_required` / `invalid_json`.
   - **Event lookup**: service-role `from('events').select('title, start_at, end_at').eq('id', event_id).maybeSingle()` → 404 `event_not_found`.
   - **Token cache**: module-level `_cachedToken: { value, expiresAt }`; refreshes when `expiresAt <= now + 60s`. Throws `zoom_not_configured` if any of 3 env vars missing; throws `zoom_oauth_<status>` on non-2xx token response.
   - **Meeting create**: `POST https://api.zoom.us/v2/users/me/meetings` with `{ topic, type: 2, start_time, duration: ceil((end - start) / 60_000), timezone: 'UTC', settings: { join_before_host: false, waiting_room: true } }`.
   - **401 retry**: on 401, null token cache, refetch, retry once. Non-2xx still → 502 `zoom_create_<status>`.
   - **Write-back**: service-role `admin.from('events').update({ zoom_meeting_id, join_url, zoom_managed: true }).eq('id', event_id)` (T-47-26 — never serialized into response).
   - **Test seams**: `setAdminForTest` / `resetAdminForTest` / `setSupaForTest` / `resetSupaForTest` / `_resetTokenCacheForTest` — mirrors mux-create-upload's Proxy pattern so the Wave 0 RED scaffold can inject mocks without touching globals.
   - **Deno.serve guard**: `if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);`.

2. **`supabase/functions/zoom-create-meeting/deno.json`** — per-Fn import pin.
   - Forks `supabase/functions/mux-webhook/deno.json` style.
   - `imports.npm:@supabase/supabase-js@2` keyed identity-style for esbuild bundler.
   - `tasks.test`, `lint`, `fmt` blocks mirror the project convention.

## Acceptance Criteria — All Passing

| Gate | Required | Actual |
|------|----------|--------|
| `index.ts` + `deno.json` exist | both | both |
| `api.zoom.us/v2/users/me/meetings` grep | ≥1 | 3 |
| `zoom.us/oauth/token` grep | ≥1 | 1 |
| `is_staff` grep | ≥1 | 7 (one is the helper-name doc reference) |
| `ZOOM_S2S_ACCOUNT_ID` grep | ≥1 | 1 |
| `ZOOM_S2S_CLIENT_ID` grep | ≥1 | 1 |
| `ZOOM_S2S_CLIENT_SECRET` grep | ≥1 | 1 |
| `SUPABASE_SERVICE_ROLE_KEY` grep | ≥1 | 2 |
| `import.meta.main` grep | ≥1 | 2 |
| `zoom_managed` grep | ≥1 | 2 |
| `401` grep | ≥1 | 7 (retry path + return codes) |
| `console.log.*(token\|Authorization)` grep | exactly 0 | 0 |
| `staff_users` rejected-alt name grep (feedback_negation_grep_defeated_by_comment_string) | 0 | 0 |
| `deno check supabase/functions/zoom-create-meeting/index.ts` | passes | passes |

## Commits

| Hash       | Type | Description                                                      |
|------------|------|------------------------------------------------------------------|
| `31e93b55` | feat | zoom-create-meeting Edge Fn (D-06 + D-07) — index.ts + deno.json |

## Threat Mitigations Landed

| Threat ID | Mitigation |
|-----------|------------|
| T-47-21 (Spoofing) | `supabase.rpc('is_staff')` invoked with caller JWT BEFORE any Zoom API call; non-admin → 403 forbidden. |
| T-47-23 (Info Disclosure) | Zero `console.log` of Authorization header or token. Only error codes (no payloads) propagate to response. |
| T-47-26 (Elevation) | Service-role client used ONLY for `events.update` write-back; never serialized into response body. |

## Deviations from Plan

**1. [Enhancement] Added `zoom_not_configured` error branch**

- **Where:** `getZoomToken()` guards on the 3 ZOOM_S2S_* env vars being non-empty BEFORE attempting Basic-auth string assembly.
- **Why:** Plan `<action>` spec explicitly named `zoom_not_configured` as a required snake_case error code, but RESEARCH §Example 5 verbatim uses `!` non-null assertions that would crash on missing secrets with a TypeError, not the planned snake_case code.
- **Impact:** First-deploy operator (before secrets are set in Wave 2 HUMAN-UAT) gets `{ error: 'zoom_not_configured' }` 502 instead of opaque crash. Matches the `<action>` invariant 5.

**2. [Enhancement] Test injection seams (setAdminForTest / setSupaForTest)**

- **Where:** Module-level Proxy + override slots, mirroring mux-create-upload.
- **Why:** Plan `<action>` explicitly required "Test injection seam: export setter `export function setAdminForTest(client: SupabaseClient) { … }` mirroring `mux-create-upload`'s setVerifyForTest / setAdminForTest pattern so the Wave 0 test scaffold can inject a mock." Added `setSupaForTest` too because the is_staff() RPC gate runs on the user-JWT client (not admin), so tests need both seams.
- **Impact:** Wave 3 close-out plan can write `setAdminForTest(mockAdmin)` + `setSupaForTest(authHeader => mockSupa)` + global `fetch` stub to validate all 4 RED test cases (happy / 401-retry / 403-forbidden / 404-event_not_found) without deploying to a real environment.

**3. [Enhancement] Snake_case error code consistency**

- **Where:** All error return paths use snake_case strings — `unauthorized` / `forbidden` / `event_not_found` returned as raw text bodies (per RESEARCH §Example 5 verbatim), `method_not_allowed` / `invalid_json` / `event_id_required` / `zoom_oauth_<status>` / `zoom_create_<status>` / `zoom_not_configured` returned as JSON `{ error: <code> }`.
- **Why:** Plan `<action>` mandated the snake_case list; RESEARCH skeleton was incomplete on method/body validation paths.

No Rule 1 bugs, no Rule 4 architectural escalations. All deviations are extensions specified in `<action>` that the RESEARCH skeleton did not contain.

## Auth Gates

None encountered during this plan. The `ZOOM_S2S_*` secret pre-flight is gated to the Wave 2 HUMAN-UAT close-out plan per CONTEXT.md / VALIDATION.md sequencing.

## Deferred Items

None for this plan. Downstream deferrals owned by other plans:

- **47-12 (close-out)** owns `supabase functions deploy zoom-create-meeting` + `supabase secrets set ZOOM_S2S_*` + the Wave 2 HUMAN-UAT "Real Zoom OAuth meeting created against Zoom prod" check (per VALIDATION.md Manual-Only table).
- **Wave 3 close-out plan** owns replacing the 4 TODO stub bodies in `supabase/functions/zoom-create-meeting/index.test.ts` with assertion bodies that use the `setAdminForTest` / `setSupaForTest` seams shipped here.

## Self-Check: PASSED

- `supabase/functions/zoom-create-meeting/index.ts` — FOUND (committed in `31e93b55`)
- `supabase/functions/zoom-create-meeting/deno.json` — FOUND (committed in `31e93b55`)
- Commit `31e93b55` — FOUND in `git log`
- All 11 acceptance-criteria grep gates pass
- `deno check` passes (zero type errors)
- No rejected-alt names (`staff_users`) in committed code

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, file access, or schema changes outside the plan's `<threat_model>` register (T-47-21 / T-47-23 / T-47-26 all mitigated as planned).
