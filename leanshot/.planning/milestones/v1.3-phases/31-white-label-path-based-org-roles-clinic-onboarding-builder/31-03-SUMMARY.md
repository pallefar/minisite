---
phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder
plan: "03"
subsystem: ui
tags: [tailwind, css-custom-properties, playwright, supabase, rpc, white-label, brand-tokens]

# Dependency graph
requires:
  - phase: 31-02
    provides: "org_branding table with 12 columns (favicon_url, bg_color, text_color, body_font, radius_scale newly added)"
  - phase: 31-01
    provides: "has_permission SECDEF + get_caller_role SECDEF"
  - phase: 31-00
    provides: "org_member_role enum renamed to owner/clinician/staff"
provides:
  - "Public SECDEF resolve_clinic_branding(p_slug text) returns jsonb — anon-callable, no auth required"
  - "src/lib/brand-tokens.ts — parseClinicSlug, applyBrandTokens, fetchClinicBranding, BrandTokens interface"
  - "src/main.tsx pre-mount brand-token block — warm-paint from localStorage + async RPC refresh"
  - "src/index.css Tailwind v4 fallback chains: --color-primary/bg/text read --brand-* with LeanShot defaults"
  - "Playwright p31 project + clinic-brand-first-paint.spec.ts (3 tests, 3/3 pass)"
affects: [31-05, 31-06, "any future clinic-facing surfaces that consume --brand-* tokens"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-mount DOM mutation before React hydrate() — mirrors applyThemeToDOM pattern"
    - "Bare fetch() for pre-mount RPC calls (supabase-js not yet constructed at this point)"
    - "localStorage warm-paint + fire-and-forget async refresh for zero-FOUT brand application"
    - "Tailwind v4 @theme fallback chain: semantic token reads --brand-* with var(--brand-X, <default>)"
    - "PLAYWRIGHT_RUN_P31=1 env-var gated conditional project — addInitScript for localStorage seeding"

key-files:
  created:
    - supabase/migrations/20270601500001_p31_03_resolve_clinic_branding.sql
    - leanshot/src/lib/brand-tokens.ts
    - leanshot/e2e/clinic-brand-first-paint.spec.ts
  modified:
    - leanshot/src/main.tsx
    - leanshot/src/index.css
    - leanshot/playwright.config.ts

key-decisions:
  - "Migration timestamp 20270601500001 chosen (lex-after latest 20270601400007 from 31-04)"
  - "logo_alt_text not in org_branding on live DB — auto-fixed to use o.name as fallback"
  - "organizations.updated_at not on live DB — auto-fixed to coalesce(b.updated_at, o.created_at)"
  - "Tailwind v4 @theme var() fallback chain compiles cleanly without moving to :root (no warnings)"
  - "brand-tokens.ts uses bare fetch, NOT supabase-js, to keep the entry chunk lean (deferred-init pattern)"

patterns-established:
  - "All --brand-* CSS custom property mutations go via applyBrandTokens (centralised, testable)"
  - "parseClinicSlug(pathname) is the single canonical slug extractor for /clinic/{slug}/* paths"
  - "BRAND_CACHE_KEY_PREFIX + slug = localStorage cache key for clinic brand blobs"

requirements-completed: [ORG-11]

# Metrics
duration: 8min
completed: 2026-05-18
---

# Phase 31 Plan 03: resolve_clinic_branding RPC + brand-tokens.ts + main.tsx pre-mount + first-paint e2e Summary

**Public SECDEF + localStorage warm-paint + Tailwind v4 fallback chain delivering zero-FOUT clinic branding on /clinic/{slug} before React mounts**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-18T06:38:07Z
- **Completed:** 2026-05-18T06:45:40Z
- **Tasks:** 3
- **Files modified:** 6 (1 migration, 1 new lib, 3 modified, 1 new e2e spec)

## Accomplishments

- `resolve_clinic_branding(p_slug)` SECDEF pushed to live DB `ytnsipxxmzgaebkqmokp` with EXECUTE grants for `anon` and `authenticated` — anonymous visitors can call it without auth headers
- `src/lib/brand-tokens.ts` ships 6 exported items: `BRAND_TOKEN_KEYS`, `BrandTokens`, `applyBrandTokens`, `fetchClinicBranding`, `parseClinicSlug`, `BRAND_CACHE_KEY_PREFIX` — zero supabase-js imports, bare fetch only
- `src/main.tsx` pre-mount block inserted between `applyThemeToDOM` and `void hydrate()`: synchronous localStorage warm-paint + fire-and-forget async RPC refresh + favicon injection
- `src/index.css` Tailwind v4 `@theme {}` block: `--color-primary/bg/text` wrapped in `var(--brand-*, <LeanShot-default>)`; new `--font-display-brand`, `--font-sans-brand`, `--radius-brand` aliases; Tailwind utilities continue working on non-clinic routes unchanged
- Playwright `p31` project gates `clinic-brand-first-paint.spec.ts`: `3 passed (5.5s)`; spec is excluded from default `chromium` testIgnore so it never pollutes the standard CI suite
- Migration pushed to live: no `^Skipping`, no `^ERROR` in push log; verified via `pg_proc` + `information_schema.routine_privileges`

## Task Commits

1. **Task 1: Migration SECDEF + anon GRANT** — `3602d11` (feat)
2. **Task 2: brand-tokens.ts + index.css + main.tsx** — `51fb026` (feat)
3. **Task 3: Playwright e2e + playwright.config.ts** — `c86f575` (test)
4. **Rule 1 fix: schema drift — logo_alt_text + updated_at** — `e627720` (fix)

## Files Created/Modified

- `/Users/karstenhaldan/minisite/supabase/migrations/20270601500001_p31_03_resolve_clinic_branding.sql` — SECDEF + anon/authenticated GRANT; pushed to live DB
- `/Users/karstenhaldan/minisite/leanshot/src/lib/brand-tokens.ts` — Full brand-token library; bare fetch; exports 6 named items
- `/Users/karstenhaldan/minisite/leanshot/src/main.tsx` — Pre-mount brand-token block (warm-paint + async refresh + favicon)
- `/Users/karstenhaldan/minisite/leanshot/src/index.css` — Tailwind v4 fallback chains for primary/bg/text + brand-aware font/radius aliases
- `/Users/karstenhaldan/minisite/leanshot/e2e/clinic-brand-first-paint.spec.ts` — 3-test first-paint smoke
- `/Users/karstenhaldan/minisite/leanshot/playwright.config.ts` — P31_OPT_IN env-var gate + p31 conditional project + testIgnore entry

## Decisions Made

- **Migration timestamp `20270601500001`**: The plan spec listed `20270601310004` but the landmine note warned it was lex-BEFORE the latest applied migration `20270601400007`. Chose `20270601500001` as the correct lex-after timestamp.
- **Tailwind v4 `@theme {}` vs `:root`**: The plan specified to use `@theme {}` as the primary approach but fall back to `:root` if warnings appeared. The `@theme {}` approach compiled cleanly (no Tailwind warnings, build succeeded with `3189 modules transformed`). Stayed in `@theme {}`.
- **Fire-and-forget async refresh (not awaited)**: Per D-07 and plan spec. `void hydrate()` proceeds in parallel; warm-paint already covers returning visitors; cold-visit users see brand land when RPC resolves before React first render completes at edge latency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `org_branding.logo_alt_text` column does not exist on live DB**
- **Found during:** Task 1 (first push attempt)
- **Issue:** Plan spec and `BrandTokens` interface referenced `b.logo_alt_text` in the RPC body, but Plan 31-02's migration never created this column. `org_branding` has 12 columns; `logo_alt_text` is not one of them.
- **Fix:** Changed the `logo_alt_text` key in `jsonb_build_object` to use `o.name` (the organization name is the correct fallback for logo alt text). Added an explanatory comment in the migration.
- **Files modified:** `supabase/migrations/20270601500001_p31_03_resolve_clinic_branding.sql`
- **Verification:** Push succeeded after fix; `logo_alt_text` field in RPC response populated from `o.name`.
- **Committed in:** `e627720`

**2. [Rule 1 - Bug] `organizations.updated_at` column does not exist on live DB**
- **Found during:** Task 1 (second push attempt after fix 1)
- **Issue:** Plan spec used `greatest(o.updated_at, coalesce(b.updated_at, ...))` but the live `organizations` table only has `created_at`, not `updated_at`. The plan's CONTEXT.md claimed `updated_at timestamptz` but the actual live schema never added it.
- **Fix:** Changed `updated_at` computation to `coalesce(b.updated_at, o.created_at)` — returns branding update time if present, else org creation time. Semantically correct for cache-busting purposes.
- **Files modified:** `supabase/migrations/20270601500001_p31_03_resolve_clinic_branding.sql`
- **Verification:** Push succeeded after fix; RPC returns valid `updated_at` timestamp.
- **Committed in:** `e627720`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — schema drift between CONTEXT spec and live DB)
**Impact on plan:** Both auto-fixes are schema correctness requirements. No functional scope change. The `logo_alt_text` fix means the RPC returns the org name as alt text (same end-user result); the `updated_at` fix is semantically equivalent for the cache-busting use case.

## Playwright e2e Result

```
PLAYWRIGHT_RUN_P31=1 npx playwright test --project=p31
Running 3 tests using 1 worker
  ✓  1 warm-paint sets --brand-primary on <html> before React mounts (1.8s)
  ✓  2 non-clinic route does NOT set --brand-primary (1.2s)
  ✓  3 Tailwind fallback chain resolves to LeanShot teal default when --brand-* unset (1.1s)
  3 passed (5.5s)
```

## Live DB Verification

- `resolve_clinic_branding` present in `pg_proc` (1 row)
- `anon` and `authenticated` both listed in `information_schema.routine_privileges` for this function
- Push log: no `^Skipping` lines; no `^ERROR` lines; push exit code 0

## Known Stubs

None — `brand-tokens.ts` uses bare fetch against the live RPC. Token values flow from live `org_branding` rows. No hardcoded empty values in any rendering path.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` covered:
- T-31-03-01 through T-31-03-08 all addressed (PHI grep gate passed, anon grant bounded to read-only function, localStorage cache overwritten by authoritative refresh on each load)

## Issues Encountered

- None beyond the two Rule 1 auto-fixes. Migration schema drift (live DB columns not matching CONTEXT.md spec) required two push attempts; resolved cleanly on the third push.

## User Setup Required

None — the RPC is public (anon-callable). No new env vars. No new dashboard configuration. Migration pushed directly via `supabase db push --linked`.

## Next Phase Readiness

- Plan 31-05 (BrandingTab + ThemeEditor) can consume `fetchClinicBranding` / `applyBrandTokens` / `BrandTokens` from `src/lib/brand-tokens.ts`
- Plan 31-06 (OnboardingFlow branching) can use `parseClinicSlug` if needed
- `--brand-*` CSS properties are now part of the Tailwind v4 design system — all clinic-facing components can read `--font-display-brand`, `--font-sans-brand`, `--radius-brand` for brand-aware typography/radius

---
*Phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder*
*Completed: 2026-05-18*
