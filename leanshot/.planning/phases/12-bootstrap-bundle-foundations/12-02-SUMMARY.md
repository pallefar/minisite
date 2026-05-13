---
phase: 12-bootstrap-bundle-foundations
plan: 02
subsystem: infra
tags: [eslint, import-x, two-tunnel-firewall, native-bridge, security, apple-healthkit]

# Dependency graph
requires:
  - phase: 12-bootstrap-bundle-foundations/12-01
    provides: Per-chunk bundle ceiling script extended; Phase 12 Wave 1 is ready to receive firewall rule

provides:
  - "import-x/no-restricted-paths 6-zone firewall rule in eslint.config.js (D-02 full-spectrum)"
  - "Block B: no-restricted-imports for *.ad-eligible.ts naming convention"
  - "Block C: no-restricted-imports for posthog*.ts wrapper files"
  - "Six src/lib/native/*.ts stub files with typed exports (Phase 18/16/17/20 targets)"
  - "firewall-test-violation branch (SHA: d445c4b9426227fe31bdd05e7b7e0cc2ae115132) proving Zone 1 fires"

affects:
  - Phase 14 (analytics/stripe directories activate Zones 2+6)
  - Phase 16 (capacitor-bridge chunk; RevenueCat + DeepLink stubs consumed)
  - Phase 17 (push stub consumed; Zone 2 analytics directory activates)
  - Phase 18 (health stub replaced with real HealthKit implementation; HEALTH-01..08)
  - Phase 19 (affiliate directory activates Zone 3)
  - Phase 20 (ads.ts stub replaced; ad transport integration; Zone 1 glob active from day 1)
  - Phase 22 (posthog wrappers activate Block C)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "import-x/no-restricted-paths glob-target pattern for file-level (not directory-level) ESLint zones"
    - "Phase 18 native bridge seam: stub-then-implement pattern for capacitor plugins"
    - "Firewall test fixture branch: never-merging branch for proving CI enforcement"

key-files:
  created:
    - leanshot/src/lib/native/health.ts
    - leanshot/src/lib/native/ads.ts
    - leanshot/src/lib/native/push.ts
    - leanshot/src/lib/native/iap.ts
    - leanshot/src/lib/native/deeplink.ts
    - leanshot/src/lib/native/platform.ts
  modified:
    - leanshot/eslint.config.js
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-VALIDATION.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-02-PLAN.md

key-decisions:
  - "Zone 1 target uses glob './src/lib/native/ads*.ts' (not directory './src/lib/native/ads') because import-x/no-restricted-paths uses path.relative() and containsPath() for non-glob targets — only an exact-path match or subpath match fires; ads.ts as a file would never match a directory target"
  - "Fixture branch firewall-test-violation created locally with SHA d445c4b9426227fe31bdd05e7b7e0cc2ae115132; human must push to origin for CI verification (auth gate)"
  - "Zones 2-6 are silent-pass on Phase 12 main branch (target directories don't exist yet); each activates the moment its owning phase creates the directory — plan-checker contract required"

patterns-established:
  - "Two-tunnel firewall pattern: health.ts (privacy tunnel) blocked from ad-eligible bag by ESLint static rule — defense-in-depth with Phase 18 runtime guard + Phase 16 PrivacyInfo.xcprivacy"
  - "Cross-phase zone activation: declare zone now, zone fires when directory lands later; plan-checker for each owning phase MUST verify zone+directory combo"
  - "Native bridge stub pattern: leaf module (no cross-imports), throw Error with phase attribution, typed exports for downstream consumers"

requirements-completed: [SC-2, CCC-4]

# Metrics
duration: 35min
completed: 2026-05-13
---

# Phase 12 Plan 02: Two-tunnel Firewall Summary

**import-x/no-restricted-paths 6-zone ESLint firewall (D-02 full-spectrum) + 6 src/lib/native/*.ts stubs with glob-based Zone 1 fix proven by firewall-test-violation fixture branch**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-13T12:29:00Z
- **Completed:** 2026-05-13T13:04:27Z
- **Tasks:** 3 (Task 3 blocked at checkpoint:human-action)
- **Files modified:** 9 (6 stub files, eslint.config.js, 12-CONTEXT.md, 12-VALIDATION.md, 12-02-PLAN.md)

## Accomplishments

- Six native bridge stub files created at `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` — all leaf modules with typed exports, throwing annotated errors pointing to the implementing phase
- Three firewall config blocks added to `eslint.config.js`: Block A (6-zone `import-x/no-restricted-paths`), Block B (`no-restricted-imports` for `*.ad-eligible.ts`), Block C (`no-restricted-imports` for `posthog*.ts` wrappers)
- Firewall rule proven to fire: `firewall-test-violation` branch (SHA: `d445c4b9`) contains `ads.fixture-violates-firewall.ts` which triggers `import-x/no-restricted-paths` Zone 1 error (`npm run lint` exits non-zero); human push to origin + CI verification is the final gate

## Task Commits

1. **Task 1: Create six native bridge stub files** - `1508040` (feat)
2. **Task 2: Add import-x/no-restricted-paths zones block** - `3108a4b` (feat)
3. **Task 2 fix: Zone 1 glob correction** - `ea3f8cb` (fix - Rule 1 auto-fix)
4. **Task 3: Planning artifacts + main commit** - `bc86378` (feat — pathspec form)

Note: Task 3 is `checkpoint:human-action` — fixture branch pushed + CI verification is the human-action gate.

## Files Created/Modified

- `leanshot/src/lib/native/health.ts` — Privacy tunnel target; HealthSample type + readHealthSample stub (Phase 18 target)
- `leanshot/src/lib/native/ads.ts` — Ad transport tunnel Zone 1 target; AdPlacement type + initAdNetwork stub (Phase 20)
- `leanshot/src/lib/native/push.ts` — PushChannel type + registerForPush stub (Phase 17)
- `leanshot/src/lib/native/iap.ts` — IapProvider type + purchaseSubscription stub (Phase 16 RevenueCat)
- `leanshot/src/lib/native/deeplink.ts` — DeepLinkRoute type + handleDeepLink stub (Phase 16 Universal Links)
- `leanshot/src/lib/native/platform.ts` — Platform type + detectPlatform() returning 'web' (Phase 16 replaces)
- `leanshot/eslint.config.js` — Three new firewall config blocks after existing src/ block, before test-files override
- `leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md` — D-03 updated with branch SHA + date

## Decisions Made

1. **Zone 1 target uses glob** (`./src/lib/native/ads*.ts` not `./src/lib/native/ads`): `import-x/no-restricted-paths` uses `containsPath(filename, targetPath)` where `containsPath = (filepath, target) => path.relative(target, filepath) === '' || !relative.startsWith('..')`. A directory target `./src/lib/native/ads` would require files INSIDE `src/lib/native/ads/` — but `ads.ts` is a FILE, not a directory. Without the glob, Zone 1 never fires on Phase 12's file-based structure.

2. **Cross-phase zone activation contract**: Zones 2/3/4/5/6 are declared now but silently pass until the owning phase creates the target directory. This matches RESEARCH §9 Pitfall 1 — the plan-checker contract for Phases 14/17/19/20/22 MUST verify each directory creation also activates its corresponding zone. This is documented in each zone's inline comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zone 1 target glob fix — non-existent directory target would never fire**
- **Found during:** Task 3 (fixture verification)
- **Issue:** Plan spec'd `target: './src/lib/native/ads'` (bare path, no `.ts` extension). `import-x/no-restricted-paths` interprets this as a directory path. `ads.ts` is a file; `path.relative('./src/lib/native/ads', './src/lib/native/ads.ts')` returns `'../ads.ts'` which starts with `..`, so `containsPath` returns false. Zone 1 never fires. Verified by running `./node_modules/.bin/eslint src/lib/native/ads.fixture-violates-firewall.ts` with original config — exit code 0.
- **Fix:** Changed Zone 1 target to `'./src/lib/native/ads*.ts'` (Minimatch glob). `import-x/no-restricted-paths` uses `Minimatch` for glob targets. Verified: `eslint src/lib/native/ads.fixture-violates-firewall.ts` exits 1 with `import-x/no-restricted-paths` in output.
- **Files modified:** `leanshot/eslint.config.js`
- **Verification:** `./node_modules/.bin/eslint src/lib/native/ads.fixture-violates-firewall.ts` exits 1; `./node_modules/.bin/eslint src/lib/native/ads.ts` exits 0 (no violation when file doesn't import health)
- **Committed in:** `ea3f8cb` (fix commit between Task 2 and Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in zone configuration)
**Impact on plan:** Critical fix — without it the entire firewall enforcement for Zone 1 was non-functional. The fix is minimal (4 lines changed) and does not alter the intent or coverage of the rule. Note that the acceptance criteria in the plan checked for `target: './src/lib/native/ads'` (exact string match) — the plan's own acceptance test was wrong. The ACTUAL requirement (Zone 1 fires for `ads.ts` and `ads.fixture-violates-firewall.ts`) is satisfied by the glob.

## Cross-Cutting Concern #4: Two-Tunnel Firewall Contract

This plan ships Phase 12's component of the 4-phase Two-tunnel firewall defense-in-depth:

| Phase | Responsibility | Status |
|-------|----------------|--------|
| **Phase 12** (this plan) | ESLint static enforcement — build fails at `npm run lint` before SDK installed | ✅ DONE |
| **Phase 16** | PrivacyInfo.xcprivacy — Apple Privacy Manifest declaring health data not shared with advertisers | Deferred |
| **Phase 18** | Runtime guard — `src/lib/ads/firewall.ts` aborts `AdMob.initialize()` if HealthKit permission ever granted | Deferred |
| **Phase 20** | Audit — AD-04 verifies no health data in AdMob event payloads; activates full Zone 1 directory | Deferred |

### Zone activation schedule

| Zone | Target directory | Activates when | Plan-checker contract |
|------|-----------------|----------------|----------------------|
| Zone 1 | `src/lib/native/ads*.ts` (glob) | NOW (glob matches existing `ads.ts`) | ✅ Active |
| Zone 2a | `src/lib/analytics/` | Phase 14/22 creates directory | Phase 14 plan-checker MUST verify |
| Zone 3 | `src/lib/affiliate/` | Phase 19 creates directory | Phase 19 plan-checker MUST verify |
| Zone 4 | `src/lib/ads/` | Phase 20 creates directory | Phase 20 plan-checker MUST verify |
| Zone 5 | `src/lib/marketing/` | Phase 20 creates directory | Phase 20 plan-checker MUST verify |
| Zone 6 | `src/lib/stripe/` | Phase 14 creates directory | Phase 14 plan-checker MUST verify |

## Known Stubs

The following stubs are intentional — they provide ESLint zone resolution targets and phase-contract seams:

| File | Stub type | Implementing phase |
|------|-----------|--------------------|
| `src/lib/native/health.ts` | `readHealthSample` throws `not yet implemented` | Phase 18 HEALTH-01..08 |
| `src/lib/native/ads.ts` | `initAdNetwork` throws `not yet implemented` | Phase 20 AD-01..12 |
| `src/lib/native/push.ts` | `registerForPush` throws `not yet implemented` | Phase 17 PUSH-01..05 |
| `src/lib/native/iap.ts` | `purchaseSubscription` throws `not yet implemented` | Phase 16 MONEY-06 |
| `src/lib/native/deeplink.ts` | `handleDeepLink` throws `not yet implemented` | Phase 16 MOBILE-06 |
| `src/lib/native/platform.ts` | `detectPlatform` returns `'web'` (safe default) | Phase 16 replaces with Capacitor-aware |

These stubs DO prevent the plan's goal from being achieved if called at runtime — by design. They are phase-contract seams, not production stubs. Feature code in Phases 13-17 MUST NOT import these until the implementing phase ships the real implementation.

## Issues Encountered

1. **Node_modules missing in worktree**: The worktree's `leanshot/` directory had no `node_modules`. Ran `npm install --prefer-offline` to populate. This is a one-time worktree setup cost.

2. **Phase 12 planning files not in worktree filesystem**: The worktree was initialized from `44ad476` (before Phase 12 planning commits were added to main). The Phase 12 planning files existed in git (at `1caa71f`) but not in the working tree. Resolution: copied files from main repo, edited, committed to worktree branch.

## User Setup Required

**CRITICAL — Push the fixture branch to origin to trigger CI verification:**

```bash
git push origin firewall-test-violation
```

Then open GitHub Actions on that branch and confirm:
- The `lint` job exits red
- The failure log contains `import-x/no-restricted-paths` rule ID
- The branch is NOT merged into main

Branch SHA for audit trail: `d445c4b9426227fe31bdd05e7b7e0cc2ae115132`

This branch MUST NEVER merge into main. Its only purpose is proving the ESLint rule fires in CI.

## Next Phase Readiness

- Phases 12-03 (clinic-ad-free Playwright spec) and 12-04 (CSP snapshot test) can proceed independently — no dependency on the fixture branch CI result
- Phase 13 (design system) is unblocked by this plan — firewall is live
- Phase 14 planner MUST note: creating `src/lib/analytics/` or `src/lib/stripe/` directories will immediately activate Zones 2a and 6

## Self-Check: PASSED

| Item | Result |
|------|--------|
| health.ts | FOUND |
| ads.ts | FOUND |
| push.ts | FOUND |
| iap.ts | FOUND |
| deeplink.ts | FOUND |
| platform.ts | FOUND |
| 12-CONTEXT.md (with Branch SHA) | FOUND |
| 12-02-PLAN.md (nyquist_compliant: true) | FOUND |
| 12-VALIDATION.md (rows green) | FOUND |
| 12-02-SUMMARY.md | FOUND |
| Commit 1508040 (Task 1 stubs) | FOUND |
| Commit 3108a4b (Task 2 firewall blocks) | FOUND |
| Commit ea3f8cb (Zone 1 glob fix) | FOUND |
| Commit bc86378 (Task 3 main pathspec) | FOUND |
| Commit d445c4b (fixture branch) | FOUND |
| Fixture NOT on main branch | VERIFIED |
| Zone 1 fires on fixture file (exit code 1) | VERIFIED |
| 6 zones in resolved config | VERIFIED |

---
*Phase: 12-bootstrap-bundle-foundations*
*Completed: 2026-05-13*
