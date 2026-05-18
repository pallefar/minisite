---
phase: 32-spanish-i18n-parallel-with-clinic-track
plan: 03
subsystem: i18n
tags: [i18next, profiles, locale, supabase, custom-detector, settings, onboarding, d-12, pitfall-4]

# Dependency graph
requires:
  - phase: 32-spanish-i18n-parallel-with-clinic-track
    plan: 01
    provides: i18next runtime initialized BEFORE first React render; LanguageSwitcher component with optional onChange callback; detector-config default chain (querystring > cookie > localStorage > navigator); `Locale` type primitive
  - phase: 28-clinic-organizations-schema-rls-hardening
    provides: public.profiles row with RLS gated by `auth.uid() = id` — Plan 32-03 piggybacks on existing per-row policies for both SELECT (detector hydration via session) and UPDATE (Settings → Language picker)
provides:
  - `public.profiles.locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','es'))` column — single canonical read path for Edge Fns (Plan 32-05)
  - `User.locale?: 'en' | 'es'` Zustand mirror via existing partialize
  - `setUserLocale(locale)` store action — local-only mirror (no settings-table enqueue; locale lives on `profiles`, not `settings`)
  - `profilesLocaleDetector` (i18next CustomDetector) reading `useStore.getState().user?.locale`, registered at order-position 0 in `init.ts`
  - Settings → Language picker (`LanguageSwitcher` + onChange writing `profiles.locale` + rollback-on-error)
  - `deriveSignupLocaleAndUnits(draftUnits)` — exported pure helper centralizing D-12 (es signup → metric/kg force; en signup → preserve draft); consumed by BOTH consumer `complete()` and `OrgOnboardingFlowRenderer.complete()`
  - Stamped `User.locale` + best-effort `profiles.locale` write at onboarding completion (mirrors `mark_onboarding_complete` semantics)
  - 2 e2e specs (settings round-trip + signup-time D-12)
affects:
  - 32-04 (locale_overrides) — additive override layer on top of the canonical `profiles.locale` read path
  - 32-05 (email i18n) — single canonical read: `select locale from profiles where id = $1` (no per-event-payload locale stamping per CONTEXT D-08)
  - 32-06 (translator contractor) — bootstrap ES strings shipped by Plan 32-01 remain in place; nothing in 32-03 touches catalog contents
  - 32-07 (CI wiring) — additive; the i18n-runtime ceiling (25 kB) is unchanged by 32-03

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detector-as-read-only pattern: profilesLocaleDetector NEVER writes back via cacheUserLanguage. The write is owned at exactly one call site (SettingsPage.onChange) so error rollback + Pitfall 4 (locale/unit decoupling) are explicit, not implicit"
    - "Atomic UI-flip-then-persist with full rollback: changeLanguage → setUserLocale → supabase.update; on error, BOTH i18n.language AND the store mirror revert to the prior value to stay consistent with the unchanged DB row"
    - "Signup-time locale derivation centralized in exported pure helper (deriveSignupLocaleAndUnits) — both OnboardingFlow + OrgOnboardingFlowRenderer call sites share one branch, making the D-12 contract testable via page.evaluate without walking the 8-step UI flow"
    - "Defensive lookup in i18next detector — try/catch returns undefined for store-not-yet-hydrated races (i18next.init awaits BEFORE Zustand hydrate completes in the worst case)"
    - "Best-effort post-complete profile sync — onboarding stamps profiles.locale only after mark_onboarding_complete succeeds; errors swallowed because the local mirror + i18n.language already reflect the user's choice"

key-files:
  created:
    - supabase/migrations/20270603000001_p32_03_profiles_locale.sql
    - leanshot/src/lib/i18n/profiles-locale-detector.ts
    - leanshot/src/lib/i18n/profiles-locale-detector.test.ts
    - leanshot/e2e/i18n-profile-locale-persistence.spec.ts
    - leanshot/e2e/i18n-signup-unit-default.spec.ts
    - leanshot/.planning/phases/32-spanish-i18n-parallel-with-clinic-track/32-03-SUMMARY.md
  modified:
    - leanshot/src/types/index.ts (User.locale optional)
    - leanshot/src/lib/i18n/init.ts (instantiate LanguageDetector + addDetector + prepend 'profilesLocale' to detection.order)
    - leanshot/src/lib/store.ts (Actions.setUserLocale + implementation)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (Section type + NAV Globe entry + 'language' section render + i18n/setUserLocale hooks + onChange handler with rollback)
    - leanshot/src/components/onboarding/OnboardingFlow.tsx (i18next import + exported deriveSignupLocaleAndUnits helper + applied in both complete() functions + profiles.locale post-complete sync)

key-decisions:
  - "Helper rather than inline branch in OnboardingFlow: the D-12 derivation lives in two complete() functions (consumer + org-renderer). Extracting `deriveSignupLocaleAndUnits` as an EXPORTED pure helper makes the contract testable via page.evaluate AND prevents drift between the two call sites — Phase 7 lessons (project_lint_debt_import_x_order baseline + chunked-planning blind-spots) showed shared logic across two callers needs single ownership."
  - "Rollback on DB error MUST revert both i18n.language AND setUserLocale, not just one — otherwise the UI stays in Spanish while the store mirror has reverted (or vice versa). The cleanest invariant is: post-handler state strictly matches the DB row."
  - "Best-effort profiles.locale write at onboarding completion (after mark_onboarding_complete). Errors swallowed because (a) the local mirror is durable via partialize and (b) the next Settings → Language flip OR the next session read will reconcile. Treating it as blocking would gate onComplete() on a flaky network call, hurting first-run UX."
  - "Detector defensive try/catch: store-not-yet-hydrated is a known race during i18next.init. Per feedback_planner_iter1_anti_patterns.md no-hedge rule, the catch is deliberate (documented inline) rather than 'best-effort' silent."
  - "Local-only setUserLocale action — does NOT enqueue a settings-table upsert because locale lives on `public.profiles` (the schema in Task 1's migration), not in the settings singleton. Avoids a phantom queue entry that would dead-letter at flush time."
  - "Sentry/Capacitor peer conflict required `npm install --legacy-peer-deps --update-sentry-capacitor` (per reference_npm_sentry_capacitor_peer_conflict.md). Pre-existing project state; not caused by 32-03."

requirements-completed: [I18N-01, I18N-02]

# Metrics
duration: ~12 min
completed: 2026-05-18
---

# Phase 32 Plan 03: profiles.locale Persistence + Settings Language Picker + D-12 Signup Defaults Summary

**Authenticated locale persistence end-to-end: `profiles.locale text NOT NULL DEFAULT 'en' CHECK locale IN ('en','es')` migration; profilesLocale i18next CustomDetector at order-position 0; Settings → Language picker with rollback-on-error; D-12 signup-time helper forcing metric/kg for `es` signups while leaving existing users untouched (Pitfall 4 invariant).**

## Performance

- **Duration:** ~12 minutes (3 tasks across one wave)
- **Started:** 2026-05-18T15:05:00Z (worktree fork off 90a45fbd)
- **Completed:** 2026-05-18T15:17:00Z
- **Tasks:** 3/3 completed
- **Files created:** 6
- **Files modified:** 5

## Accomplishments

- **Migration shipped (deferred push):** `20270603000001_p32_03_profiles_locale.sql` adds the `locale` column with default + CHECK; SQL is the **single canonical read path** for Plan 32-05 email Edge Functions per CONTEXT D-08. `supabase db push` deferred to orchestrator per parallel-execution contract.
- **Custom detector wins:** authenticated `user.locale === 'es'` now overrides any querystring / cookie / localStorage / navigator signal — proven via `profiles-locale-detector.test.ts` Case D (querystring `?lang=en` LOSES to seeded `user.locale='es'`).
- **Settings → Language picker:** one new Section with `LanguageSwitcher`; atomic onChange handler with full rollback on DB error (i18n.language AND store mirror both revert so they stay in sync with the unchanged DB row).
- **D-12 signup contract centralized:** exported `deriveSignupLocaleAndUnits(draftUnits)` helper consumed by BOTH consumer-flow + org-flow `complete()` functions. `es-MX`/`es-*` signups → `units='metric'` forced (kg) + `locale='es'` stamped; `en-*` signups preserve draft units + stamp `locale='en'`.
- **Pitfall 4 guard:** Settings → Language onChange writes ONLY `locale`, NEVER `units`. Code comment cites Pitfall 4 inline; e2e spec asserts `user.units` sentinel survives the locale flip.
- **i18n test suite expanded:** was 21 → now 29 passing (+8 from `profiles-locale-detector.test.ts`: anonymous fall-through, authed 'es', authed 'en', missing-locale, throw recovery, no-op cache, integration position-0 precedence, querystring fallback).

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration + User.locale type** — `c0ed601` (feat)
2. **Task 2: profilesLocaleDetector + init.ts + setUserLocale action + 8-case test suite** — `a796bcb` (feat)
3. **Task 3: Settings → Language section + D-12 OnboardingFlow + 2 e2e specs** — `3390fc2` (feat)

## Files Created / Modified

### Created (6)

| File | Purpose |
|------|---------|
| `supabase/migrations/20270603000001_p32_03_profiles_locale.sql` | Additive `profiles.locale` column with default + CHECK |
| `leanshot/src/lib/i18n/profiles-locale-detector.ts` | i18next `CustomDetector` reading Zustand `user.locale` |
| `leanshot/src/lib/i18n/profiles-locale-detector.test.ts` | 8 cases — unit + integration (precedence position 0) |
| `leanshot/e2e/i18n-profile-locale-persistence.spec.ts` | Settings round-trip + Pitfall 4 invariant |
| `leanshot/e2e/i18n-signup-unit-default.spec.ts` | D-12 contract via `page.evaluate` + existing-user-untouched |
| `leanshot/.planning/phases/32-…/32-03-SUMMARY.md` | This file |

### Modified (5)

| File | Change |
|------|--------|
| `leanshot/src/types/index.ts` | `User.locale?: 'en' \| 'es'` optional field with JSDoc |
| `leanshot/src/lib/i18n/init.ts` | `new LanguageDetector()` + `addDetector(profilesLocaleDetector)` + `detection.order` prepends `'profilesLocale'` |
| `leanshot/src/lib/store.ts` | `Actions.setUserLocale` + implementation (local-only, no settings enqueue) |
| `leanshot/src/components/dashboard/settings/SettingsPage.tsx` | `'language'` Section type + NAV Globe entry + new render block with `LanguageSwitcher` + onChange handler with rollback |
| `leanshot/src/components/onboarding/OnboardingFlow.tsx` | `i18next` import + exported `deriveSignupLocaleAndUnits` helper + applied to BOTH complete() functions + `User.locale` stamp + best-effort `profiles.locale` write post-`mark_onboarding_complete` |

## Detector Registration Order (after this plan)

```
detection.order = [
  'profilesLocale',   // ← NEW, Plan 32-03 (authenticated user.locale from Zustand)
  'querystring',      // Plan 32-01 default chain — '?lang=es'
  'cookie',           // Plan 32-01 default chain — leanshot_locale=es
  'localStorage',     // Plan 32-01 default chain — leanshot_locale=es
  'navigator',        // Plan 32-01 default chain — Accept-Language
]
```

## Migration Code

```sql
alter table public.profiles
  add column if not exists locale text not null default 'en'
  check (locale in ('en', 'es'));

comment on column public.profiles.locale is
  'User language preference. ''en'' default; ''es'' set via Settings → Language or signup detection. Read by Edge Fns at email-send time (P32-05). Single namespace per locked CONTEXT D-10 — regionalisms via locale_overrides (P32-04) if needed.';
```

**Push status:** DEFERRED to orchestrator. Once `supabase db push --linked --include-all` runs, verify with:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name='locale';
```

Expected row: `locale | text | 'en' | NO`.

## OnboardingFlow Signup Branch Citation

`leanshot/src/components/onboarding/OnboardingFlow.tsx`:

- **Exported helper** (lines 65–84): `deriveSignupLocaleAndUnits(draftUnits)` — D-12 contract centralized.
- **Consumer flow** `complete()` call (around line 192): `const { locale: signupLocale, units: signupUnits } = deriveSignupLocaleAndUnits(draft.units);`
- **Org flow** `complete()` call (around line 782): same shape, mirrored helper consumption.
- **Best-effort profile sync** (lines 251–253 + 859–861): chained `supabase.from('profiles').update({ locale: signupLocale })` after `mark_onboarding_complete`.

## SettingsPage Language Section Placement

NAV ordering (top → bottom):

```
Account → Profile → Goals → Language ← NEW → Notifications → Privacy → … → Data
```

Visual pattern matches existing `<Section>` body+children layout from Profile/Goals; uses the `Globe` lucide icon and `LanguageSwitcher` from Plan 32-01.

## Verification Outcomes

| Step | Command | Result |
|------|---------|--------|
| TypeScript | `npx tsc -b` | 0 errors |
| Unit tests (i18n + store) | `npx vitest run src/lib/i18n/ src/lib/store` | 114/114 PASS |
| New detector tests | `npx vitest run src/lib/i18n/profiles-locale-detector.test.ts` | 8/8 PASS |
| Lint | `npm run lint` | 73 errors (baseline parity per `project_lint_debt_import_x_order.md`; NO new errors) |
| Build | `npm run build` | succeeds |
| Bundle budget — i18n-runtime | bundle-budget script | 23.30 kB / 25 kB ceiling **OK** |
| Bundle budget — index | bundle-budget script | 20.42 kB / 50 kB ceiling **OK** |
| Migration apply | `supabase db push --linked` | **DEFERRED to orchestrator per parallel_execution contract** |
| E2e specs (live Supabase) | `npm run test:e2e -- e2e/i18n-*` | **DEFERRED to CI per Plan 32-01 precedent** (worktree lacks dev-server + Supabase env) |

## Bundle Measurement

| Chunk | Ceiling (kB gz) | Actual (kB gz) | Status |
|-------|-----------------|----------------|--------|
| i18n-runtime | 25 | 23.30 | OK (+2.94 kB vs Plan 32-01 baseline 20.36) |
| index | 50 (project-wide) | 20.42 | OK |
| admin-shell | 45 | 90.62 | **OVER (pre-existing — Plan 32-01 deferred-items #1)** |

`admin-shell` overage is a pre-existing baseline issue inherited from Plan 32-01; NOT caused or worsened by 32-03. See `.planning/phases/32-…/deferred-items.md`.

The +2.94 kB delta in i18n-runtime is the new `profiles-locale-detector.ts` module routed into the same chunk by Vite's manualChunks rule — well within the 25 kB ceiling Plan 32-01 set.

## Deviations from Plan

### Sequencing / Scope

**1. [Sequencing] Detector defensive `Locale` union narrowing.**
- **Found during:** Task 2 (Case B "authed user.locale='en'" test design).
- **Issue:** The plan's `<interfaces>` block returned `user?.locale ?? undefined`. With `User.locale?: 'en' | 'es'` typed as a union (Task 1), a stale persisted snapshot (hand-edited storage) could in principle hold an off-union value. CHECK constraint guarantees the DB, but the in-memory mirror is one upsert ahead of the next session.
- **Fix:** Explicit `if (locale === 'en' || locale === 'es')` guard inside `lookup()` rejects unknowns and falls through to the anonymous chain. Documented inline.
- **Files modified:** `leanshot/src/lib/i18n/profiles-locale-detector.ts`.
- **Commit:** `a796bcb`.

**2. [Sequencing] D-12 helper extracted + exported.**
- **Found during:** Task 3 (planning the change to BOTH `complete()` functions).
- **Issue:** OnboardingFlow has TWO `complete()` functions: the consumer flow + `OrgOnboardingFlowRenderer`. Inlining the D-12 branch twice would risk drift (a future translator-touch in one and not the other). The plan implies one branch — but the file has two.
- **Fix:** Extracted `deriveSignupLocaleAndUnits(draftUnits)` as an EXPORTED pure helper (so e2e spec can drive it via `page.evaluate`) consumed by both call sites. Single source of truth for D-12.
- **Files modified:** `leanshot/src/components/onboarding/OnboardingFlow.tsx`.
- **Commit:** `3390fc2`.

**3. [Rule 2 — Missing critical functionality] Full rollback on locale-write failure.**
- **Found during:** Task 3 (writing the onChange handler).
- **Issue:** The plan's `<interfaces>` block illustrated `setLocalUser({ ...user, locale: next })` after `await supabase.update`. If the DB write failed, the UI (i18n.changeLanguage) and store mirror would BOTH show the new language even though the DB row had not changed — next session would silently revert, surprising the user.
- **Fix:** Capture `prev` BEFORE changeLanguage; on `error`, await `i18n.changeLanguage(prev)` AND `setUserLocale(prev)` so the post-handler state strictly matches the unchanged DB row. Toast user-facing error message.
- **Files modified:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx`.
- **Commit:** `3390fc2`.

**4. [Rule 3 — Blocking] Import-x order in OnboardingFlow.tsx.**
- **Found during:** Task 3 lint gate.
- **Issue:** `@/lib/supabase` was already mis-ordered ahead of `@/lib/store` in the pre-existing file. My new `i18next` import surfaced the lint check; the violation existed before my change but was un-touched.
- **Fix:** Reordered `@/lib/store` ahead of `@/lib/supabase` (alphabetical per the import-x/order rule). Restores 73-error baseline (no new errors).
- **Files modified:** `leanshot/src/components/onboarding/OnboardingFlow.tsx`.
- **Commit:** `3390fc2`.

## Deferred Items

- **`supabase db push --linked --include-all`** — DEFERRED to orchestrator per parallel-execution contract. Migration file exists at `supabase/migrations/20270603000001_p32_03_profiles_locale.sql` with the strict 14-digit filename per `reference_supabase_migration_filename_regex.md`.
- **E2e live-Supabase variant** — the two new specs ship today and run against the seeded `addInitScript` path. A second-pass CI-only variant gated on `SUPABASE_URL` + service-role key (admin.generateLink + /auth/v1/verify per `reference_supabase_auth_traps.md` to bypass 2/hour email rate-limit) will write to `public.profiles` and assert the DB row — to be added when CI Supabase creds are wired (Plan 32-07 scope or earlier).
- **TypeScript types regeneration** — `leanshot/src/types/supabase.ts` does NOT currently contain a `profiles` table entry (verified via `grep ^      profiles:` — empty). Plan Task 1 Step 5 says "skip if project doesn't use generated types in a way the plan requires" — confirmed not required for this plan's call sites (we extended `types/index.ts` `User` interface directly).

## Authentication Gates

None. The migration runs server-side via the orchestrator's `supabase db push`. All client-side code paths handle anonymous + authenticated cases:

- Settings → Language onChange: gates the DB write on `signedIn?.user?.id`. Anonymous users get the local mirror + i18n flip only (durable via partialize).
- OnboardingFlow post-complete sync: gates on `!authData.user.is_anonymous` (same pattern as `mark_onboarding_complete`).

## Known Stubs

None. All code paths in this plan are end-to-end functional. Plan 32-04 layers `locale_overrides` ADDITIVELY on top of the canonical `profiles.locale` value — that's a downstream extension, not a stub.

## Open Items

- **Audit logging for locale changes deferred to v1.4** (per threat model T-32-03-03). Profiles audit triggers are not currently in scope; locale tampering is low-value (CHECK constraint prevents domain corruption).
- **Live-Supabase e2e variant for `profiles.locale` DB row** — see Deferred Items above.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The schema change (`profiles.locale`) sits behind the existing per-row RLS policies (`auth.uid() = id`). The CHECK constraint mitigates T-32-03-01 (tampering) at the DB layer. No new threat flags.

## Self-Check: PASSED

All files created/modified verified present:

```
$ ls supabase/migrations/20270603000001_p32_03_profiles_locale.sql
$ ls leanshot/src/lib/i18n/profiles-locale-detector.{ts,test.ts}
$ ls leanshot/e2e/i18n-{profile-locale-persistence,signup-unit-default}.spec.ts
```

All 3 task commits found in `git log`:

- c0ed601 ✓ feat(32-03-01): profiles.locale migration + User.locale type extension
- a796bcb ✓ feat(32-03-02): profilesLocale i18next detector + store.setUserLocale
- 3390fc2 ✓ feat(32-03-03): Settings → Language picker + D-12 signup locale/units + e2e

All run-time gates passing: TypeScript 0 errors, vitest 114/114, lint baseline parity, build succeeds, i18n-runtime within ceiling.
