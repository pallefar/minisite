---
phase: 41-public-status-page-embed-provider-blocks
plan: 01
subsystem: consent
tags:
  - consent
  - phase-22-retrofit
  - foundation
  - tdd
status: complete
requires:
  - Phase 22 vanilla-cookieconsent banner (already shipped)
provides:
  - canonical leanshot:consent-change CustomEvent
  - subscribeToConsentChange(handler) helper with cleanup closure
  - ConsentChangeDetail TypeScript contract
affects:
  - leanshot/src/components/consent/consent-config.ts (additive emit retrofit)
tech-stack:
  added: []
  patterns:
    - browser CustomEvent + window.addEventListener with React-cleanup-style unsubscribe
    - framework-agnostic helper (zero React imports) for inline-JS reuse in Plan 41-03 Deno renderer
key-files:
  created:
    - leanshot/src/lib/consent/consent-event.ts
    - leanshot/src/lib/consent/__tests__/consent-event.test.ts
    - leanshot/src/components/consent/__tests__/consent-event-emit.test.ts
  modified:
    - leanshot/src/components/consent/consent-config.ts
decisions:
  - functional category mapped from acceptedCategory('necessary') per RESEARCH §Code Examples (no separate functional toggle in vanilla-cookieconsent v3 schema)
  - emitConsentChange() called AFTER upsertConsentRecord in each callback so persisted state is in sync when subscribers read cc_cookie (T-41-01-03 mitigation)
  - SSR guard returns no-op cleanup (mirrors consent-defer.ts pattern even though v1 SPA is client-only per CLAUDE.md)
metrics:
  duration: ~25min
  tasks_completed: 2/2
  commits: 4
  date_completed: 2026-05-24
---

# Phase 41 Plan 01: Consent-Event Retrofit Summary

Retrofit Phase 22 vanilla-cookieconsent banner to emit a canonical `leanshot:consent-change` CustomEvent on every consent mutation, plus ship a typed subscribe helper that downstream Plan 41-05 (ConsentGatedEmbed HOC) and Plan 41-03 (Deno renderer inline JS) both consume.

## What Shipped

### 1. Canonical event contract — `leanshot/src/lib/consent/consent-event.ts`

```typescript
export const CONSENT_CHANGE_EVENT = 'leanshot:consent-change';

export interface ConsentChangeDetail {
  categories: {
    necessary: boolean;       // always true — read for symmetry
    analytics: boolean;
    marketing: boolean;
    personalization: boolean;
    functional: boolean;      // mapped from CookieConsent.acceptedCategory('necessary')
  };
}

export function subscribeToConsentChange(
  handler: (detail: ConsentChangeDetail) => void,
): () => void;
```

The module is framework-agnostic (zero React imports) so the same `CONSENT_CHANGE_EVENT` literal can be hardcoded inside the inline JS string emitted by the Plan 41-03 Deno Edge Fn. SSR guard returns a no-op cleanup; `removeEventListener` is idempotent so calling the returned unsubscribe twice does not throw.

### 2. Three retrofitted callbacks — `leanshot/src/components/consent/consent-config.ts`

Added module-private `emitConsentChange()` helper at line 141 reading each category via `CookieConsent.acceptedCategory(...)` and dispatching the typed CustomEvent. Appended `emitConsentChange();` as the LAST statement in all three Phase 22 callbacks:

- `onFirstConsent` (line 292)
- `onConsent` (line 297)
- `onChange` (line 302)

Order matters per T-41-01-03 mitigation: `updateGtagConsent()` + `upsertConsentRecord(cookie)` run BEFORE the emit so persisted state is in sync if a subscriber reads `cc_cookie`. The emit is additive — zero behavioral change to existing Phase 22 analytics + Supabase persistence.

### 3. Subscribe helper signature

```typescript
const unsubscribe = subscribeToConsentChange((detail) => {
  if (detail.categories.marketing) loadEmbed();
});
// React useEffect cleanup
return unsubscribe;
```

Plan 41-05 `ConsentGatedEmbed` HOC will consume this exactly per the pattern documented in `41-PATTERNS.md` lines 152-168 (mount-time `CookieConsent.acceptedCategory(...)` read closes the T-41-01-02 race for late subscribers).

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Task 1 unit tests | `npx vitest run src/lib/consent/__tests__/consent-event.test.ts` | 4/4 PASS |
| Task 2 unit tests | `npx vitest run src/components/consent/__tests__/consent-event-emit.test.ts` | 4/4 PASS |
| Existing Phase 22 regression | `npx vitest run src/components/consent/__tests__/consent-config.test.ts` | 8/8 PASS |
| Strict TypeScript | `npx tsc -p tsconfig.app.json --noEmit` | CLEAN (exit 0, no errors) |
| Grep ≥4 hits for CONSENT_CHANGE_EVENT / leanshot:consent-change | `grep -RIn ...` | 25 hits ✓ |
| Exactly one prod dispatchEvent for consent-change | `grep dispatchEvent.*consent` | 1 prod hit (consent-config.ts:152) ✓ |
| ESLint (new files) | `npm run lint` | CLEAN on the 3 new files |

**Total tests post-change: 16/16 across the consent suite** (8 existing + 8 new).

## TDD Gate Compliance

Both tasks followed strict RED→GREEN:

- **Task 1 RED** (4c09e4e8) — `test(41-01)` import-resolve failure (module did not exist)
- **Task 1 GREEN** (9e7240f9) — `feat(41-01)` 4/4 tests pass
- **Task 2 RED** (4a29de38) — `test(41-01)` 4/4 tests time out (event never dispatched)
- **Task 2 GREEN** (767b70a5) — `feat(41-01)` 4/4 tests pass

Gate sequence validated in `git log`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint cleanliness] Removed blank line between import groups in new test files**

- **Found during:** Task 2 lint verification
- **Issue:** `import-x/order` ESLint rule flagged a blank line between the `vitest` import and the `@/lib/consent/consent-event` import in both new test files (matched a pre-existing project-wide pattern in `consent-defer.test.ts` line 14).
- **Fix:** Removed the blank line in both new test files so they lint clean on `import-x/order`.
- **Files modified:** `src/lib/consent/__tests__/consent-event.test.ts`, `src/components/consent/__tests__/consent-event-emit.test.ts`
- **Out-of-scope:** Did NOT fix the same pre-existing error at `src/components/consent/consent-config.ts:27` (predates this plan — out of scope per executor scope-boundary rule).
- **Commit:** 767b70a5 (folded into Task 2 GREEN)

### Authentication Gates
None — no live infrastructure (Supabase, Vercel, vendor APIs) touched.

### Architectural Changes
None.

## Success Criteria Compliance

| Criterion | Status |
|-----------|--------|
| Both new files compile with strict TypeScript | ✓ (tsc -p tsconfig.app.json --noEmit clean) |
| Both test files green under vitest | ✓ (8/8 new tests pass) |
| `window.dispatchEvent('leanshot:consent-change')` appears exactly once in source (inside `emitConsentChange`) | ✓ (consent-config.ts:152; constant referenced elsewhere) |
| No regression in existing Phase 22 callbacks (gtag + Supabase still fire) | ✓ (Test 4 regression guard + existing consent-config.test.ts 8/8) |
| Plan 41-05 can `import { CONSENT_CHANGE_EVENT, subscribeToConsentChange } from '@/lib/consent/consent-event'` without additional plumbing | ✓ (named exports present + signatures match 41-PATTERNS.md §ConsentGatedEmbed.tsx) |

## Threat Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-41-01-01 (info disclosure via CustomEvent detail) | accept | OK — payload is five booleans, same surface as `localStorage.cc_cookie` |
| T-41-01-02 (listener race on initial emit) | mitigate | Documented in 41-05 plan — subscribers MUST read `CookieConsent.acceptedCategory(...)` at mount (covered in 41-PATTERNS.md §ConsentGatedEmbed pattern) |
| T-41-01-03 (emit precedes persistence) | accept | Mitigated by ordering: `upsertConsentRecord` runs BEFORE `emitConsentChange` in all three callbacks |
| T-41-01-04 (same-origin event spoofing) | accept | Defense-in-depth via 41-05 mount-time `acceptedCategory` re-read |

## Downstream Consumers Confirmed Ready

- **Plan 41-05 (ConsentGatedEmbed HOC, Wave 3):** Pattern documented in 41-PATTERNS.md §ConsentGatedEmbed.tsx imports `CONSENT_CHANGE_EVENT` + `ConsentChangeDetail` from `@/lib/consent/consent-event` — exact symbol names ship.
- **Plan 41-03 (Deno Edge Fn renderer, Wave 2):** Same literal string `'leanshot:consent-change'` will be hardcoded in emitted inline JS. The `CONSENT_CHANGE_EVENT` constant is the single source of truth; planner is responsible for keeping the literal in sync (frozen contract documented at the constant declaration in `consent-event.ts:21`).

## Stub Tracking
No stubs shipped. All exports backed by real implementation with passing tests.

## Threat Flags
None — no new security-relevant surface beyond what the threat model captured.

## Self-Check: PASSED

- All 3 created files exist on disk ✓
- All 4 commit hashes present in git log ✓
- All verification checks green ✓
