---
phase: 15-page-builder-landing-pages
plan: 02
subsystem: build, bundle-budget, routing, CSP
tags: [page-builder, build-infrastructure, manualChunks, csp, vercel-rewrites, dnd-kit]
requires: []
provides:
  - admin-bundle chunk routing rule (src/components/admin/*) — wave-0 skip until 15-04 ships editor source
  - page-builder-runtime chunk routing rule (src/lib/page-builder/*) — wave-0 skip until 15-03 ships helpers
  - vendor-dnd-kit chunk routing rule (@dnd-kit/{core,sortable,utilities}) — wave-0 skip until consumer wires
  - ADMIN_BUNDLE_CEILING=60000 bytes gz, wired check
  - index-chunk no-dnd-kit-static-import guard (CI regression catch for PAGE-02)
  - /{slug} → page-render Edge Function rewrite (last entry in vercel.json rewrites[])
  - widened rendered-page frame-src (calendly.com, www.youtube-nocookie.com, tally.so)
  - tests/csp/csp-snapshot.txt updated in same commit as vercel.json CSP change
affects:
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/vite.config.ts
  - leanshot/scripts/assert-clinic-bundle-budget.sh
  - leanshot/vercel.json
  - leanshot/tests/csp/csp-snapshot.txt
tech-stack:
  added:
    - "@dnd-kit/core@6.3.1 (pinned, no caret)"
    - "@dnd-kit/sortable@10.0.0 (pinned, no caret)"
    - "@dnd-kit/utilities@3.2.2 (pinned, no caret)"
  patterns:
    - Phase 9 manualChunks source-path rule pattern (id.includes('src/...'))
    - Phase 9 anchored node_modules regex pattern for vendor chunks
    - Phase 10/11 check_chunk_ceiling helper with wave-0 skip semantics
    - Phase 10 jsPDF static-import guard (mirrored 1:1 for dnd-kit)
    - Phase 12 D-10/D-11 CSP snapshot test contract (vercel.json + csp-snapshot.txt in same commit)
key-files:
  created: []
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/vite.config.ts
    - leanshot/scripts/assert-clinic-bundle-budget.sh
    - leanshot/vercel.json
    - leanshot/tests/csp/csp-snapshot.txt
decisions:
  - "Pin dnd-kit versions to exact (no caret) so a future `npm install` cannot drift the resolved lock without an explicit upgrade — matches the plan's 'exact pinned' intent."
  - "Used `@dnd-kit/core` legacy API (NOT `@dnd-kit/react`) per 15-RESEARCH.md."
  - "vendor-dnd-kit chunk uses anchored regex `/node_modules\\/(@dnd-kit\\/(core|sortable|utilities))(\\/|$)/` to avoid id.includes false-positives, matching the vendor-supabase/vendor-react shape."
  - "page-render Edge Function rewired as query-param destination (`?slug=$1`), NOT path-segment — coordinate with 15-03's page-render contract."
  - "frame-src widened with EXACTLY three origins (calendly.com, www.youtube-nocookie.com, tally.so). Prefer the nocookie YouTube host (D-01, T-15-02-02). No wildcards, no other directives touched."
metrics:
  duration_minutes: ~18
  tasks_completed: 3
  completed_date: 2026-05-15
---

# Phase 15 Plan 02: Build/Bundle/Routing/CSP Foundation Summary

## Overview

**One-liner:** Installed dnd-kit (pinned) + extended vite manualChunks with admin-bundle / page-builder-runtime / vendor-dnd-kit / + extended assert-clinic-bundle-budget.sh with admin-bundle ceiling + index no-dnd-kit-static-import guard + appended a negative-lookahead `/{slug}` → page-render rewrite to vercel.json + widened rendered-page frame-src for calendly/youtube-nocookie/tally with matching csp-snapshot update.

**Wave:** 1 (no prereqs, parallel with 15-01/15-03/15-04/15-05).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Install dnd-kit + add the three manualChunks rules | `3864741` | leanshot/package.json, leanshot/package-lock.json, leanshot/vite.config.ts |
| 2 | Extend bundle-budget script with admin-bundle ceiling + dnd-kit index-leak guard | `d6e18b6` | leanshot/scripts/assert-clinic-bundle-budget.sh |
| 3 | Add `/{slug}` → page-render rewrite + widen frame-src + update CSP snapshot | `ed402f9` | leanshot/vercel.json, leanshot/tests/csp/csp-snapshot.txt |

## Verification Results

| Gate | Result |
|------|--------|
| `npx tsc -b` | clean |
| `npm run build` | succeeds (3.11s) |
| `bash -n scripts/assert-clinic-bundle-budget.sh` | syntax valid |
| `bash scripts/assert-clinic-bundle-budget.sh` | exits 0; prints wave-0 skip for page-builder-runtime + admin-bundle; prints `dnd-kit index-leak invariant OK: no static @dnd-kit imports in index chunk` |
| `npx vitest run tests/csp/csp-snapshot.test.ts` | passes (1/1) |
| `npx vitest run` (full unit suite) | 809 passed, 11 skipped, 0 failed |

## Implementation Notes

### Resolved dnd-kit versions

```json
"@dnd-kit/core":      "6.3.1"
"@dnd-kit/sortable":  "10.0.0"
"@dnd-kit/utilities": "3.2.2"
```

`@dnd-kit/react` is NOT installed (verified `grep -c '@dnd-kit/react' package.json` → 0).

### `vendor-dnd-kit` regex used

```regex
/node_modules\/(@dnd-kit\/(core|sortable|utilities))(\/|$)/
```

Anchored on `node_modules/` prefix and bounded by `/` or end-of-string — matches the shape of the existing `vendor-supabase` and `vendor-react` rules to avoid `id.includes()` false-positives.

### Final `frame-src` directive

```
frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://calendly.com https://www.youtube-nocookie.com https://tally.so;
```

Only the `frame-src` directive changed; `script-src` / `connect-src` / `img-src` / `default-src` / `style-src` / `font-src` / `object-src` / `base-uri` / `form-action` / `worker-src` are byte-unchanged.

### `page-render` rewrite — query-param destination

The new rewrite (last entry in `vercel.json` `rewrites[]`):

```json
{
  "source": "/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\\.html|assets/).+)",
  "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/page-render?slug=$1"
}
```

**Wired as a query-param destination (`?slug=$1`), NOT path-segment.** 15-03 must build `page-render` to read `slug` from `URLSearchParams`, NOT from the path. If 15-03 instead chooses a path-segment shape, the `destination` value here is the only thing that needs to flip — the negative-lookahead source pattern stays the same.

### Marketing-host vercel.json

Only one `vercel.json` exists at `leanshot/vercel.json`. 15-RESEARCH.md lines 822–825 flag an open question on whether the LeanShot project has a separate marketing-host `vercel.json` (e.g. at the repo root or in a sibling marketing app). No such file was found in this worktree — if one exists in production deploy config but is not version-controlled in this repo, the `/{slug}` rewrite would need to be replicated there. **Phase 15 follow-up** (see open questions below).

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Pin dnd-kit to exact versions (no caret) | Match the plan's "exact pinned versions" intent; prevent silent drift on a future `npm install`. |
| `vendor-dnd-kit` anchored regex, NOT `id.includes` | Mirrors vendor-supabase/vendor-react idiom; eliminates false-positives like `@use-gesture/react` polluting `vendor-react` (the same family of bug RESEARCH P1 calls out). |
| `admin-bundle` and `page-builder-runtime` rules placed BEFORE the `node_modules` block | Source-path rules must beat the vendor-split block so editor source isn't swept into a vendor chunk. |
| `ADMIN_BUNDLE_CEILING=60000` (60 kB gz) | 15-PATTERNS.md value. dnd-kit weight is isolated in vendor-dnd-kit so this measures editor source alone. Phase 15 close tightens to measured + ~1 kB headroom (D-08 phase-close discipline). |
| dnd-kit index-leak guard mirrors the jsPDF guard | Same minified-Vite static-import detection pattern (`import[{*][^"]*from"…"`); dedicated `DNDKIT_INDEX_FAIL` flag + `exit 1` for code-style consistency with the jsPDF block. |
| Negative-lookahead in `/{slug}` source | Defense-in-depth — even though Vercel evaluates rewrites top-down (the two `clinic` rewrites already win), the lookahead keeps `/admin/*` SPA routes (added by 15-04) and `/share`/`/api`/`/auth`/`/assets` paths from being shadowed by the catch-all. Reserved-slug denylist is enforced at save time by 15-04's `RESERVED_SLUGS` (T-15-02-01 mitigation). |
| `page-render` wired as query-param destination | Per the plan's "prefer the query-param form here and note the dependency in the SUMMARY". 15-03 owns the page-render internals and must read the `slug` query param. |
| `www.youtube-nocookie.com` over `youtube.com` | D-01 / T-15-02-02 — nocookie variant minimizes third-party tracking surface; default for new embed origins. |

## Deviations from Plan

**1. [Rule 1 — plan acceptance criterion vs reality] `vendor-dnd-kit` chunk does NOT emit in wave-0**

- **Found during:** Task 1 verification.
- **Issue:** The plan's Task 1 acceptance criterion says `ls dist/assets/vendor-dnd-kit-*.js` must list at least one file. But Rollup only routes a module into a manualChunks chunk if SOMETHING in the dep graph imports it. dnd-kit is installed but unused in wave-0 (no `src/components/admin/` editor source exists yet) → Rollup tree-shakes it out entirely → no `vendor-dnd-kit-*.js` is emitted. The same wave-0 logic that exempts `admin-bundle` and `page-builder-runtime` from emission applies to `vendor-dnd-kit`, but the plan's acceptance criteria explicitly excluded vendor-dnd-kit from the wave-0 exception.
- **Fix:** None applied. The structural verification path (the manualChunks rule itself) is satisfied — `grep -v '^[[:space:]]*//' vite.config.ts | grep -c "return 'vendor-dnd-kit'"` returns `1`, and the anchored regex is correct. As soon as any source file imports from `@dnd-kit/*` (15-04 wires the BlockTreePanel sortable), Rollup will emit `vendor-dnd-kit-*.js`. The bundle-budget script's wave-0 skip semantics already handle the absent-chunk case for the parallel `admin-bundle` / `page-builder-runtime` rules.
- **Files modified:** None beyond the plan-scoped set.
- **Commit:** No additional commit. Documented here only.
- **Recommendation for 15-04:** When 15-04 first wires `BlockTreePanel.tsx` and imports `useSortable` from `@dnd-kit/sortable`, re-run `npm run build` and confirm `dist/assets/vendor-dnd-kit-*.js` emits and is non-empty.

## Known Stubs

None — this plan installs build/routing infrastructure only. No UI components, no data sources, no placeholder text.

## Threat Surface Scan

Files touched: `vite.config.ts` (build config), `assert-clinic-bundle-budget.sh` (CI gate), `vercel.json` (CDN routing + security headers), `tests/csp/csp-snapshot.txt` (CSP regression gate). The `vercel.json` `frame-src` widening (T-15-02-02) and the `/{slug}` catch-all rewrite (T-15-02-01) are NEW security surface — but both are explicitly modeled in this plan's `<threat_model>` with documented mitigations:
- `T-15-02-01` (elevation of privilege via `/{slug}` shadowing a protected route) — mitigated by ordering the rewrite LAST + negative-lookahead source pattern excluding all six protected prefixes + 15-04's save-time `RESERVED_SLUGS` denylist.
- `T-15-02-02` (over-broad frame-src) — mitigated by enumerating exactly three named origins (no wildcards), preferring `youtube-nocookie.com`, leaving `script-src`/`connect-src` untouched, and the existing `csp-snapshot.test.ts` regression gate (which now blocks any future un-reviewed `frame-src` change).
- `T-15-02-03` (editor bundle leaking onto public page loads) — mitigated by manualChunks + the new dnd-kit index-leak CI guard.

No flagged new surface outside the documented threat register.

## Cross-Plan Dependencies for Later Phase 15 Plans

- **15-03 (page-render Edge Function):** Must read the `slug` from `URLSearchParams` because vercel.json rewrites to `…/page-render?slug=$1` (NOT a path segment).
- **15-03 (page-builder runtime helpers):** Source files MUST live under `src/lib/page-builder/` to land in the `page-builder-runtime` chunk and respect the 25 kB gz ceiling.
- **15-04 (editor UI):** Editor source files MUST live under `src/components/admin/` to land in the `admin-bundle` chunk. The first file that imports `@dnd-kit/*` will trigger `vendor-dnd-kit` chunk emission. After 15-04's first build, verify `vendor-dnd-kit-*.js` exists in `dist/assets/`.
- **15-03 / 15-04 (`RESERVED_SLUGS` in `src/lib/page-builder/block-schema.ts`):** The save-time denylist MUST include EXACTLY the same six protected prefixes that this plan's vercel.json negative-lookahead excludes — `clinic`, `admin`, `share`, `api`, `auth`, `assets`. (`clinic-invite` is implicitly covered by the existing rewrite.)
- **15-06 (embed blocks):** May safely emit iframes pointing at `calendly.com`, `www.youtube-nocookie.com`, and `tally.so` — these origins are now allowed by the rendered-page `frame-src`. Any FOURTH embed origin requires an additional CSP widening + matching `csp-snapshot.txt` update in the same commit.

## Open Questions / Phase 15 Follow-ups

1. **Marketing-host vercel.json:** Only one `vercel.json` is version-controlled in this repo (`leanshot/vercel.json`). 15-RESEARCH.md lines 822–825 flag an open question on whether there is a separate marketing-host vercel.json that ALSO needs the `/{slug}` rewrite. None was found in the worktree. If one exists in production deploy config but is not in-repo, the rewrite would need to be replicated there. Phase 15 follow-up — surface during Phase 15 close UAT against the live deploy.
2. **`vendor-dnd-kit` chunk emission verification:** Cannot be verified in wave-0 (no dnd-kit consumer exists). Defer verification to 15-04's first build and add the `ls dist/assets/vendor-dnd-kit-*.js` check to 15-04's acceptance.

## Self-Check: PASSED

- [x] Task 1 commit `3864741` exists in `git log --oneline -1 HEAD~2`
- [x] Task 2 commit `d6e18b6` exists in `git log --oneline -1 HEAD~1`
- [x] Task 3 commit `ed402f9` exists in `git log --oneline -1 HEAD`
- [x] `leanshot/package.json` has `@dnd-kit/{core@6.3.1,sortable@10.0.0,utilities@3.2.2}` pinned, no `@dnd-kit/react`
- [x] `leanshot/vite.config.ts` has all three new manualChunks rules (grep -c each = 1)
- [x] `leanshot/scripts/assert-clinic-bundle-budget.sh` has `ADMIN_BUNDLE_CEILING=60000`, the wired check, and the dnd-kit index-leak guard
- [x] `leanshot/vercel.json` has the `/{slug}` rewrite as the LAST entry and the widened frame-src
- [x] `leanshot/tests/csp/csp-snapshot.txt` updated to match
- [x] CSP snapshot test passes; full unit suite green (809 / 11 skipped / 0 failed)
- [x] Bundle-budget script runs green and prints both wave-0 skip lines + the dnd-kit invariant OK line
