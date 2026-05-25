---
phase: 56-ad-network
plan: "04"
subsystem: ad-network-csp
tags: [csp, edge-middleware, ad-network, blocklist, security]
dependency_graph:
  requires: [56-02]
  provides: [ad-csp-generator, middleware-ad-augmentation]
  affects: [leanshot/middleware.ts, leanshot/src/lib/ads/cspGenerator.ts]
tech_stack:
  added: []
  patterns: [pure-fn-csp-generator, blocklist-derived-allowlist, 60s-cache-parallel-fetch]
key_files:
  created:
    - leanshot/src/lib/ads/cspGenerator.ts
    - leanshot/src/lib/ads/cspGenerator.test.ts
  modified:
    - leanshot/middleware.ts
decisions:
  - filterBlocklisted applied BEFORE appendAdNetworkHosts so GLP-1 hosts are structurally excluded at all times (T-56-11)
  - Separate adCspCache module-level variable — does not share state with existing iframe_allowlist cache
  - fetchAdCspHosts uses Promise.all for parallel REST fetches of allowlist + blocklist
  - Fail-safe on any fetch error: CSP served without ad-network hosts (T-56-12, mirrors iframe fail-safe)
  - CspAllowRow type exported so middleware can import without duplicating the shape
metrics:
  duration_minutes: 2
  completed_date: "2026-05-25"
  tasks_completed: 2
  files_changed: 3
---

# Phase 56 Plan 04: CSP Blocklist Generator + Middleware Wiring Summary

**One-liner:** filterBlocklisted + appendAdNetworkHosts pure functions generating blocklist-derived ad-network CSP allowlist, wired into Edge Middleware with 60s cache and fail-safe on error.

## What Was Built

### Task 1: Pure CSP generator (TDD — RED/GREEN)

`leanshot/src/lib/ads/cspGenerator.ts` exports two pure functions:

- `filterBlocklisted(allow: CspAllowRow[], block: string[]): CspAllowRow[]` — removes any row whose hostname appears in the blocklist (case-insensitive); the structural T-56-11 mitigation ensuring GLP-1 competitor hosts never enter the CSP.
- `appendAdNetworkHosts(csp: string, scriptHosts: string[], connectHosts: string[]): string` — regex-replaces `script-src` and `connect-src` directives anchored on `;`, mirroring the `appendFrameSrcHosts` pattern from Phase 41.

11 unit tests cover: blocklist filtering (exact + case-insensitive), empty-list no-ops, directive isolation (frame-src/img-src untouched), and the explicit SECURITY assertion that `wegovy.com` never survives into the final CSP string.

### Task 2: Edge Middleware augmentation

`leanshot/middleware.ts` extended with:

- `adCspCache` — separate module-level cache (`{ scriptHosts, connectHosts, expiresAt }`, 60s TTL), parallel to the existing `cache` for iframe_allowlist.
- `fetchAdCspHosts(supabaseUrl, anonKey)` — GETs two REST endpoints in parallel:
  - `${supabaseUrl}/rest/v1/ad_csp_allowlist?select=hostname,directive&enabled=eq.true`
  - `${supabaseUrl}/rest/v1/ad_advertiser_blocklist?select=hostname`
  - Runs `filterBlocklisted` then splits results into `scriptHosts` / `connectHosts` by directive.
- After the existing `appendFrameSrcHosts` augmentation (A), a new block (A2) refreshes `adCspCache` if expired and calls `appendAdNetworkHosts(csp, scriptHosts, connectHosts)`.
- Wrapped in `try/catch` — any fetch error logs a warning and serves the CSP without ad-network hosts (fail-safe, T-56-12).

## REST Query Strings

```
GET ${SUPABASE_URL}/rest/v1/ad_csp_allowlist?select=hostname,directive&enabled=eq.true
GET ${SUPABASE_URL}/rest/v1/ad_advertiser_blocklist?select=hostname
```

Both use the same `apikey` + `Authorization: Bearer` headers as the existing iframe_allowlist fetch. Tables seeded by Plan 56-02.

## Verification

```
cd leanshot && npx vitest run src/lib/ads/cspGenerator.test.ts --config vite.config.ts
# → 11 passed (11)

grep -q "ad_csp_allowlist" leanshot/middleware.ts    # FOUND
grep -q "appendAdNetworkHosts" leanshot/middleware.ts # FOUND
grep -q "ad_advertiser_blocklist" leanshot/middleware.ts # FOUND

cd leanshot && npx tsc -p tsconfig.app.json --noEmit
# → clean (no output)
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5a2c4309 | feat(56-04): pure CSP generator — filterBlocklisted + appendAdNetworkHosts (AD-09) |
| 2 | fd95c417 | feat(56-04): wire ad-network allowlist into Edge Middleware (AD-09) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Real ad-host CSP behavior is observable only once `ad_csp_allowlist` rows are seeded (done by Plan 56-02 migrations). The generator + middleware are fully wired; empty DB tables produce no augmentation (correct fail-safe behavior).

## Threat Flags

No new security surface beyond what the plan's threat model covers. The two REST fetches read only `hostname` and `directive` columns via the anon key — same exposure surface as the existing `iframe_allowlist` fetch (T-56-13 accepted).

## Self-Check: PASSED

- leanshot/src/lib/ads/cspGenerator.ts — FOUND
- leanshot/src/lib/ads/cspGenerator.test.ts — FOUND
- leanshot/middleware.ts — modified (committed fd95c417)
- leanshot/.planning/phases/56-ad-network/56-04-SUMMARY.md — FOUND
- Commit 5a2c4309 — FOUND (feat: pure CSP generator)
- Commit fd95c417 — FOUND (feat: wire middleware)
