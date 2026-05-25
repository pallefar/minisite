---
phase: 28
plan: "02"
subsystem: org-scope-defense
tags:
  - security
  - eslint
  - proxy
  - sentry
  - brand-types
  - edge-functions
dependency_graph:
  requires:
    - "28-00"  # RECONCILE — organizations table exists
  provides:
    - "withOrgScope"         # Plans 28-03 through 28-07 use this wrapper
    - "ORG_SCOPED_TABLES"    # Plans 28-03 through 28-07 extend this set
    - "no-raw-service-role-client"  # ESLint rule blocks bypass at CI level
  affects:
    - "supabase/functions/_shared/supabase-server.ts"
    - "supabase/functions/_shared/with-org-scope.ts"
    - "supabase/functions/_shared/sentry.ts"
    - "leanshot/eslint-rules/no-raw-service-role-client.cjs"
    - "leanshot/eslint.config.js"
    - "leanshot/vite.config.ts"
    - "leanshot/src/lib/__tests__/with-org-scope.test.ts"
tech_stack:
  added:
    - "supabase/functions/_shared/supabase-server.ts (TS brand types for service-role client)"
    - "supabase/functions/_shared/with-org-scope.ts (Proxy-based runtime gate)"
    - "supabase/functions/_shared/sentry.ts (minimal Edge Function Sentry stub)"
    - "eslint-rules/no-raw-service-role-client.cjs (custom ESLint rule)"
  patterns:
    - "ServiceRoleClient<S> brand type — compile-time never-guard on .from()"
    - "Proxy-based query interception — .then() gate asserts org_id filter"
    - "Sentry.captureException fatal level — post-incident observability"
    - "ESLint CallExpression visitor — build-time fence via AST matching"
    - "vi.hoisted() + vi.mock() — vitest mock ordering for Deno-runtime modules"
key_files:
  created:
    - path: "supabase/functions/_shared/supabase-server.ts"
      description: "_createServiceRoleClientUnsafe() + ServiceRoleClient<S> brand type"
    - path: "supabase/functions/_shared/with-org-scope.ts"
      description: "withOrgScope() Proxy wrapper + ORG_SCOPED_TABLES + OrgScopeBypassError"
    - path: "supabase/functions/_shared/sentry.ts"
      description: "minimal Edge Function Sentry stub (no-op when SENTRY_DSN missing)"
    - path: "leanshot/eslint-rules/no-raw-service-role-client.cjs"
      description: "ESLint rule blocking raw createClient(..., SERVICE_ROLE_KEY)"
    - path: "leanshot/eslint-rules/__tests__/no-raw-service-role-client.test.cjs"
      description: "7-case rule test (node --test runner)"
    - path: "leanshot/src/lib/__tests__/with-org-scope.test.ts"
      description: "9-test vitest suite: compile-time + runtime bypass tests"
  modified:
    - path: "leanshot/eslint.config.js"
      description: "added leanshot/no-raw-service-role-client rule (error on src/ non-test files)"
    - path: "leanshot/vite.config.ts"
      description: "extended vitest include to eslint-rules/**/*.test.{js,ts,cjs}"
decisions:
  - "Used vi.hoisted() to resolve vitest mock hoisting temporal dead zone (mockCaptureException accessible in vi.mock factory)"
  - "Sentry stub uses npm:@sentry/node@8 with graceful no-op when SENTRY_DSN missing (vendor-gated pattern)"
  - "ESLint rule ignores test files (*.test.ts) since integration tests legitimately use service-role clients"
  - "Relative import path is ../../../../supabase (4 levels up from src/lib/__tests__/ to reach repo root)"
  - "Test uses vi.hoisted() createFakeBuilder/createFakeClient (no live Supabase connection needed; Proxy logic is pure)"
metrics:
  duration: "14 minutes"
  completed: "2026-05-17"
  tasks_completed: 3
  files_created: 6
  files_modified: 2
---

# Phase 28 Plan 02: withOrgScope Layered Defense Summary

**One-liner:** 4-layer org_id bypass defense — brand types + ESLint rule + runtime Proxy + Sentry alert — closes V13-2a service-role leak vector.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | brand-typed service-role client + withOrgScope Proxy + sentry stub | 5e11a16 | supabase-server.ts, with-org-scope.ts, sentry.ts |
| 2 | no-raw-service-role-client ESLint rule + test + wiring | d303709 | no-raw-service-role-client.cjs, .test.cjs, eslint.config.js, vite.config.ts |
| 3 | D-28 compile-time + runtime bypass tests | d84759e | src/lib/__tests__/with-org-scope.test.ts |

## ORG_SCOPED_TABLES Contents (all 8 P28 tables)

```
organizations
org_members
org_invites
org_subscriptions
org_settings
org_branding
org_patient_links
org_consent_grants
```

Verified present: all 8 tables confirmed via grep.

## ESLint Rule Test Results

**File:** `eslint-rules/__tests__/no-raw-service-role-client.test.cjs`
**Runner:** `node --test` (Node built-in test runner) / vitest (via `eslint-rules/**/*.test.{js,ts,cjs}` glob)

```
# tests 7
# suites 1
# pass 7
# fail 0
```

**Tests covered:**
1. Identifier `SUPABASE_SERVICE_ROLE_KEY` outside allowed file → 1 error
2. Same code inside `supabase/functions/_shared/supabase-server.ts` → 0 errors (allowlist)
3. `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` outside allowed file → 1 error
4. `process.env.SUPABASE_SERVICE_ROLE_KEY` outside allowed file → 1 error
5. `createClient(url, SUPABASE_ANON_KEY)` → 0 errors (anon key not matched)
6. `Deno.env.get(SERVICE_ROLE_KEY)` inside allowed file → 0 errors
7. Non-createClient calls with SERVICE_ROLE_KEY → 0 errors

## with-org-scope.test.ts Results

**File:** `src/lib/__tests__/with-org-scope.test.ts`
**Runner:** vitest (via `src/**/*.test.{ts,tsx}` include)

```
Test Files  1 passed (1)
     Tests  9 passed (9)
```

**Tests covered (D-28 requirements):**
1. `// @ts-expect-error` proves `.from` is typed `never` on `ServiceRoleClient<'Unscoped'>` (compile-time)
2. `.eq('org_id', orgId)` well-formed → resolves; Sentry NOT called
3. Missing `.eq` → `OrgScopeBypassError`; Sentry called once with `level: 'fatal'` + `tag: {org_scope_bypass: 'true'}`
4. Non-org-scoped table (`audit_logs`) → resolves without throw (allowlist gating)
5. `.in('org_id', [orgId])` array filter → resolves (alternate scope accepted)
6. `.eq('org_id', WRONG_ORG)` wrong value → `OrgScopeBypassError` (value comparison enforced)
7. `.rpc()` call → does NOT throw (per D-07; SECDEF function bodies police RPC)
8. All 8 ORG_SCOPED_TABLES present in the const
9. Each ORG_SCOPED_TABLE triggers bypass error without org_id filter

## Sample Lint Output

Running `npm run lint` against `src/` with the new rule:
- **0 violations** of `leanshot/no-raw-service-role-client`
- Pre-existing 143 errors from `import-x/order` (known lint debt from v1.1 baseline — not caused by this plan)

The rule correctly excludes test files (`src/**/*.test.{ts,tsx}`) where service-role clients are legitimate for integration tests.

## 4-Layer Defense Summary

| Layer | Artifact | Trigger | Effect |
|-------|----------|---------|--------|
| Compile-time | `ServiceRoleClient<'Unscoped'>` brand type | `.from()` called on unscoped client | TS error: `.from` is `never` |
| Build-time | `eslint-rules/no-raw-service-role-client.cjs` | `createClient(..., SERVICE_ROLE_KEY)` in any non-allowlisted file | ESLint error blocks CI |
| Request-time | `withOrgScope()` Proxy in `with-org-scope.ts` | `.from(table)` on ORG_SCOPED table without `.eq('org_id', orgId)` | throws `OrgScopeBypassError` |
| Post-incident | `Sentry.captureException` in `with-org-scope.ts` | `OrgScopeBypassError` thrown | Sentry fatal alert with `org_scope_bypass: true` tag |

## Note for Plan 07 (Extension Contract)

Downstream phases (P29, P30, P31, P40) that add new org-scoped tables MUST:
1. Add the table name to `ORG_SCOPED_TABLES` in `supabase/functions/_shared/with-org-scope.ts`
2. Add a paired `*-rls.test.ts` (plan-checker BLOCKER per D-26)
3. Reference `28-EXTENSION-CONTRACT.md` for the full checklist (shipped in Plan 07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added sentry.ts Edge Function stub**
- **Found during:** Task 1
- **Issue:** Plan A7 specifies `@sentry/deno` import but no existing `_shared/sentry.ts` existed (Phase 25 D-15 shipped Sentry for browser, not Edge Functions)
- **Fix:** Created minimal `_shared/sentry.ts` stub using `npm:@sentry/node@8` with vendor-gated no-op pattern (SENTRY_DSN check) per `[[reference_vendor_gated_send_health_check]]`
- **Files modified:** `supabase/functions/_shared/sentry.ts`
- **Commit:** 5e11a16

**2. [Rule 2 - Missing critical functionality] ESLint rule excludes test files**
- **Found during:** Task 2 verification
- **Issue:** Production test files in `src/lib/admin/__tests__/` legitimately use `createClient(..., SERVICE_ROLE_KEY)` for integration tests; the rule would have flagged them
- **Fix:** Added `ignores: ['src/**/*.test.{ts,tsx}', ...]` to the ESLint config block; the rule applies only to production code
- **Files modified:** `leanshot/eslint.config.js`
- **Commit:** d303709

**3. [Rule 3 - Blocking fix] Relative import path corrected to 4 levels up**
- **Found during:** Task 3 path resolution verification
- **Issue:** Plan specified `../../../supabase` but correct path from `src/lib/__tests__/` to repo root `supabase/` is `../../../../supabase` (4 levels: __tests__ → lib → src → leanshot → repo root)
- **Fix:** Corrected all import paths in `with-org-scope.test.ts` to `../../../../supabase/functions/_shared/`
- **Files modified:** `leanshot/src/lib/__tests__/with-org-scope.test.ts`
- **Commit:** d84759e

**4. [Rule 3 - Blocking fix] vitest glob extended for .cjs test files**
- **Found during:** Task 2 — test file discovery
- **Issue:** `vite.config.ts` included `eslint-rules/**/*.test.{js,ts}` but not `.cjs`; the `no-raw-service-role-client.test.cjs` file would not be discovered by vitest
- **Fix:** Extended glob to `eslint-rules/**/*.test.{js,ts,cjs}`
- **Files modified:** `leanshot/vite.config.ts`
- **Commit:** d303709

**5. [Rule 3 - Blocking fix] vi.hoisted() pattern for mock temporal dead zone**
- **Found during:** Task 3 — vitest run
- **Issue:** `mockCaptureException` referenced inside `vi.mock()` factory was undefined (hoisting TDZ); vitest error "Cannot access before initialization"
- **Fix:** Used `vi.hoisted()` to define mock values and fake client factory before the `vi.mock()` factories execute
- **Files modified:** `leanshot/src/lib/__tests__/with-org-scope.test.ts`
- **Commit:** d84759e

## Known Stubs

None. All functionality is fully implemented:
- `ORG_SCOPED_TABLES` is populated with all 8 P28 tables
- `withOrgScope` Proxy intercepts all 8 tables
- `_createServiceRoleClientUnsafe` throws at call time with descriptive errors
- Sentry stub gracefully no-ops when `SENTRY_DSN` not set (correct for pre-production)

## Self-Check: PASSED

- supabase/functions/_shared/supabase-server.ts: FOUND
- supabase/functions/_shared/with-org-scope.ts: FOUND
- supabase/functions/_shared/sentry.ts: FOUND
- leanshot/eslint-rules/no-raw-service-role-client.cjs: FOUND
- leanshot/eslint-rules/__tests__/no-raw-service-role-client.test.cjs: FOUND
- leanshot/src/lib/__tests__/with-org-scope.test.ts: FOUND
- Commit 5e11a16: FOUND (Task 1)
- Commit d303709: FOUND (Task 2)
- Commit d84759e: FOUND (Task 3)
- ORG_SCOPED_TABLES: 8 tables confirmed
- ESLint rule tests: 7/7 pass
- withOrgScope vitest: 9/9 pass
