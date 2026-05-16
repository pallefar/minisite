---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 10
subsystem: privacy, compliance, gdpr, consent, bundle
tags: [gdpr, consent-mode-v2, vanilla-cookieconsent, posthog, dynamic-import, sync-defer-pattern, ccpa]

requires:
  - phase: 22-01
    provides: consent_records table (append-only audit per GDPR Art. 7(1))
  - phase: 06-01
    provides: src/lib/sync-defer.ts dynamic-import gate pattern (Pattern 4 analog)
  - phase: 02.1
    provides: src/lib/telemetry-defer.ts (PostHog idle-deferred init scheduler)
  - phase: 12
    provides: window.__VERCEL_GEO__ runtime exposure (NOT YET WIRED — see deferred-items.md #4)
provides:
  - GDPR-01 Bottom slide-up cookie consent banner (vanilla-cookieconsent v3 + Consent Mode v2)
  - GDPR-02 Append-only consent_records audit writer (insertConsentRecord)
  - Pattern 4 dynamic-import gate keeps vanilla-cookieconsent off the index static graph
  - 22-VALIDATION.md GDPR-01 + GDPR-02 rows corrected against REQUIREMENTS.md authoritative mapping
affects:
  - plan 22-12 (App.tsx mount of CookieConsentBootstrap; chunk-isolation invariant becomes verifiable)
  - plan 22-09 (PostHog feature-flag overrides — consumes the same consent_records audit)
  - phase 20 (mobile + web ads — services.adsense + services.meta_pixel are forward-compat declared)

tech-stack:
  added:
    - vanilla-cookieconsent ^3.1.0 (4-year stable; ~5-7 kB gz; Consent Mode v2 native)
  patterns:
    - Pattern 4 (Pattern Library): idle-deferred dynamic-import gate (mirrors sync-defer/telemetry-defer)
    - Append-only audit-row writer for regulator-facing log (no UPSERT semantics — Art. 7(1) burden-of-proof)
    - Privacy-default geo fallback (unknown country → EU treatment per T-22-58 fail-safe)

key-files:
  created:
    - leanshot/src/lib/consent/consent-defer.ts (Pattern 4 bundle gate; mirrors src/lib/sync-defer.ts)
    - leanshot/src/components/consent/consent-config.ts (vanilla-cookieconsent run config + Consent Mode v2 bridge + EN translations)
    - leanshot/src/lib/consent/consent-records.ts (GDPR-02 INSERT-only audit writer)
    - leanshot/src/components/consent/CookieConsentBootstrap.tsx (5-line useEffect invoker; mount owner is plan 22-12)
    - leanshot/src/lib/consent/__tests__/consent-defer.test.ts (4 behavior tests)
    - leanshot/src/components/consent/__tests__/consent-config.test.ts (8 behavior tests)
    - leanshot/.planning/phases/22-owner-admin-lifecycle-email-dsar-cookie-consent/deferred-items.md (4 out-of-scope items tracked)
  modified:
    - leanshot/package.json (+vanilla-cookieconsent ^3.1.0)
    - leanshot/package-lock.json
    - leanshot/src/lib/consent/__tests__/consent-records.test.ts (Wave 0 it.skip scaffold → 7 real behavior tests)
    - leanshot/src/components/consent/__tests__/CookieConsentBootstrap.test.tsx (Wave 0 it.skip scaffold → 3 real behavior tests)
    - leanshot/.planning/phases/22-owner-admin-lifecycle-email-dsar-cookie-consent/22-VALIDATION.md (GDPR-01 + GDPR-02 rows corrected and marked green)

key-decisions:
  - "Privacy-default fallback when geo unknown — `country ? EU.includes(country) : true` (true=EU, analytics off). Corrects literal `!isEU` from 22-RESEARCH §Pattern 3 which would silently default to US treatment when Vercel geo headers are missing. Matches T-22-58 fail-safe direction."
  - "INSERT-only writer for consent_records (NOT UPSERT). Migration 20270601000005 explicitly comments `consent history is append-only for GDPR Article 7(1) burden-of-proof`. The plan's frontmatter described UPSERT with onConflict — but the table has no unique constraint, so UPSERT would have errored at runtime. INSERT is the correct semantic for the regulator-audience audit trail."
  - "consent-records.ts implemented in Task 2 (not Task 3 as planned) because consent-config.ts imports upsertConsentRecord at the top level — TypeScript build would fail without the file. Task split adjusted to: Task 2 = consent-defer + consent-config + consent-records IMPL, Task 3 = CookieConsentBootstrap + all 4 test files."
  - "Pitfall 7 compliance: services.posthog + services.adsense + services.meta_pixel declared on their respective categories so acceptedService('posthog','analytics') works for Consent Mode v2 granularity. Forward-compat for Phase 20 web ads."
  - "Bundle chunk-isolation verification deferred to plan 22-12. Without a mount of CookieConsentBootstrap in App.tsx, tree-shaking removes all consent code from the production bundle (index gz 15.03 kB, unchanged from baseline). The Pattern 4 dynamic-import gate is in place by construction — when 22-12 wires the mount, vanilla-cookieconsent will land in its own lazy chunk."

patterns-established:
  - "Pattern 4 (vanilla-cookieconsent dynamic-import gate): mirrors src/lib/sync-defer.ts + src/lib/telemetry-defer.ts. Type-free top-level + value import only inside async load fn + idle/setTimeout scheduling + idempotent re-entry. Add to project bundle-budget hygiene rules for any heavy third-party lib > 2 kB gz."
  - "Append-only audit writer pattern: regulator-facing audit tables get INSERT-only writers (try/catch/log/swallow). No UPSERT, no DELETE — Art. 7(1) burden-of-proof requires the full history. Confirms feedback_status_machine_transition_owner pattern: when migration says `append-only`, the writer module must respect it even if the plan key_links field said `upsert`."

requirements-completed: [GDPR-01, GDPR-02]

duration: 25min
completed: 2026-05-16
---

# Phase 22 Plan 10: Cookie Consent Banner + GDPR-02 Audit + Bundle Gate Summary

**Shipped GDPR-01 cookie consent banner (vanilla-cookieconsent v3 + Consent Mode v2) and GDPR-02 append-only consent_records audit writer, with a Pattern 4 dynamic-import gate that keeps the entire consent subsystem off the index static graph (index gz 15.03 kB / 50 kB ceiling). 22/22 unit tests green; mount + chunk-isolation verification deferred to plan 22-12.**

## Performance

- **Duration:** ~25 minutes
- **Started:** 2026-05-16T08:29Z
- **Completed:** 2026-05-16T08:54Z
- **Tasks:** 4 (per plan)
- **Files created:** 6 (4 src + 1 test + 1 deferred-items.md)
- **Files modified:** 5 (2 Wave-0 test scaffolds + package.json + lockfile + VALIDATION.md)
- **Vitest:** 22/22 green (12 from Task 2, 10 from Task 3; all <0.7s)

## Accomplishments

- **GDPR-01 banner:** Bottom slide-up modal with `Accept all / Reject all / Customize` per UI-SPEC §banner. Customize inline-expands to 4 categories (Essential read-only + Analytics + Marketing + Personalization). Per-service declarations for `posthog` (analytics), `adsense` + `meta_pixel` (marketing) enable acceptedService() granularity (Pitfall 7).
- **GDPR-02 audit:** Append-only `consent_records` INSERT on every onFirstConsent / onConsent / onChange callback. user_id resolution via auth.getUser(); anonymous_id via cookie.consentId. user_agent capped 500ch; country_code via window.__VERCEL_GEO__; failures log + swallow.
- **Consent Mode v2 bridge:** gtag('consent','default',...) fires with denied-everywhere defaults (analytics_storage flips per geo) BEFORE banner renders; updateGtagConsent() pushes 'update' on every state change.
- **Bundle gate:** Pattern 4 dynamic-import gate (`consent-defer.ts` → `await import('@/components/consent/consent-config')`) ensures vanilla-cookieconsent never lands on App.tsx's static graph. Index gz baseline 15.03 kB (50 kB ceiling) — chunk-isolation verifiable once 22-12 wires the mount.
- **VALIDATION.md correction:** GDPR-01 + GDPR-02 rows were inverted vs REQUIREMENTS.md authoritative mapping. Corrected rows now mark Plan 22-10 ✅ green.

## Task Commits

1. **Task 1 (chore):** install vanilla-cookieconsent ^3.1.0 — `2440108`
2. **Task 2 (RED):** consent-defer + consent-config behavior tests (12) — `192a728`
3. **Task 2 (GREEN):** consent-defer + consent-config + consent-records impl — `e36c8be`
4. **Task 3 (RED):** consent-records (7) + CookieConsentBootstrap (3) tests — `80d738c`
5. **Task 3 (GREEN):** CookieConsentBootstrap 5-line invoker — `29cde7f`
6. **Task 4 (docs):** bundle-budget measurement + 4 deferrals — `579c293`

## Files Created/Modified

### Created

- `leanshot/src/lib/consent/consent-defer.ts` — Pattern 4 idle-deferred dynamic-import gate.
- `leanshot/src/components/consent/consent-config.ts` — vanilla-cookieconsent v3 run config + Consent Mode v2 bridge.
- `leanshot/src/lib/consent/consent-records.ts` — INSERT-only audit writer.
- `leanshot/src/components/consent/CookieConsentBootstrap.tsx` — 5-line useEffect invoker.
- `leanshot/src/lib/consent/__tests__/consent-defer.test.ts` — 4 tests.
- `leanshot/src/components/consent/__tests__/consent-config.test.ts` — 8 tests.
- `leanshot/.planning/phases/22-…/deferred-items.md` — 4 out-of-scope items.

### Modified

- `leanshot/package.json` + `leanshot/package-lock.json` — added vanilla-cookieconsent ^3.1.0.
- `leanshot/src/lib/consent/__tests__/consent-records.test.ts` — Wave 0 `it.skip` → 7 real tests.
- `leanshot/src/components/consent/__tests__/CookieConsentBootstrap.test.tsx` — Wave 0 `it.skip` → 3 real tests.
- `leanshot/.planning/phases/22-…/22-VALIDATION.md` — GDPR-01 + GDPR-02 rows corrected + marked green.

## Decisions Made

1. **Privacy-default fallback on unknown geo (T-22-58 fix-up).** `computeIsEU(country)` returns `true` when country is undefined — opposite of `!isEU` shorthand in 22-RESEARCH §Pattern 3 which would have silently defaulted to US treatment when Vercel geo headers are missing. Matches T-22-58 fail-safe direction ("EU treatment").
2. **INSERT-only writer (not UPSERT).** Plan's `key_links` described UPSERT with `onConflict: 'user_id,anonymous_id'`, but the migration explicitly states append-only per GDPR Art. 7(1) and the table has no unique constraint — UPSERT would error at runtime. INSERT is correct for the regulator-audience audit trail.
3. **Task split adjusted.** consent-records.ts moved from Task 3 to Task 2 because consent-config.ts imports upsertConsentRecord at the top — TS build would fail otherwise. Test files for consent-records + CookieConsentBootstrap stay in Task 3 RED gate as the plan specified.
4. **Pitfall 7 forward-compat.** Services declared for `posthog` (analytics), `adsense` + `meta_pixel` (marketing) even though Phase 20 ads aren't shipped yet. Cheap to declare now; expensive to retrofit when Tag Assistant validation runs.
5. **Bundle verification deferred to 22-12.** Without a mount of CookieConsentBootstrap, tree-shaking removes all consent code from production bundles. The Pattern 4 gate is correct by construction; full chunk-isolation measurement happens when 22-12 wires the mount.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Migration is append-only but plan said UPSERT.**
- **Found during:** Task 2 / Task 3 design (consent-records.ts).
- **Issue:** Plan `key_links` field described `supabase.from('consent_records').upsert({...}, {onConflict: 'user_id,anonymous_id'})`. Migration `20270601000005_consent_records_table.sql` has no UNIQUE constraint on either column AND explicitly comments `-- consent history is append-only for GDPR Article 7(1) burden-of-proof`. UPSERT would have errored at runtime ("ON CONFLICT specification not unique").
- **Fix:** Implemented as `await supabase.from('consent_records').insert(payload)`. Each consent decision writes a new row — correct semantic for regulator audit log.
- **Files modified:** `leanshot/src/lib/consent/consent-records.ts`.
- **Verification:** 7/7 consent-records tests green; one test explicitly asserts 3 calls → 3 inserts (no merge).
- **Committed in:** `e36c8be`.

**2. [Rule 2 — Correctness/privacy default] Unknown-geo fallback flipped from US to EU treatment.**
- **Found during:** Task 2 (consent-config.ts implementation).
- **Issue:** 22-RESEARCH §Pattern 3 literal `const isEU = country ? EU.includes(country) : false;` defaults unknown geo to US (analytics ON). T-22-58 threat-model disposition says "fail-safe direction" = EU treatment (analytics OFF) when geo is null. The two contradict each other.
- **Fix:** Implemented `computeIsEU(country)` which returns `true` when country is undefined. Default state is now analytics OFF for every visitor we cannot positively identify as US.
- **Files modified:** `leanshot/src/components/consent/consent-config.ts`.
- **Verification:** Test `unknown geo (no __VERCEL_GEO__) → analytics enabled=false (fail-safe per T-22-58)` green.
- **Committed in:** `e36c8be`.

**3. [Rule 3 — Blocking] consent-records.ts moved earlier in task order.**
- **Found during:** Task 2 implementation.
- **Issue:** consent-config.ts must `import { upsertConsentRecord } from '@/lib/consent/consent-records'` at the top level — but the plan defers consent-records.ts to Task 3. TypeScript would fail to compile without the file.
- **Fix:** Implemented consent-records.ts as part of Task 2 GREEN. Task 3 retains its tests + CookieConsentBootstrap component.
- **Files modified:** `leanshot/src/lib/consent/consent-records.ts`.
- **Verification:** typecheck + 22/22 unit tests green.
- **Committed in:** `e36c8be`.

**4. [Rule 1 — Bug] VALIDATION.md GDPR-01 / GDPR-02 row labels inverted vs REQUIREMENTS.md.**
- **Found during:** Task 4 (writing rows for the plan's deliverables).
- **Issue:** `22-VALIDATION.md` row 52 labeled GDPR-01 = DSAR; row 53 labeled GDPR-02 = cookie banner. `REQUIREMENTS.md` says GDPR-01 = cookie banner, GDPR-02 = consent_records audit, GDPR-03 = DSAR. REQUIREMENTS is canonical.
- **Fix:** Rewrote both rows against the REQUIREMENTS.md mapping; added explicit threat refs (T-22-56..61) and marked both as Plan 22-10 / Wave 2 / ✅ green (12+7 unit tests).
- **Files modified:** `leanshot/.planning/phases/22-…/22-VALIDATION.md`.
- **Committed in:** `579c293` (part of the Task 4 docs commit).

## Deferred Issues

Documented in `leanshot/.planning/phases/22-…/deferred-items.md`:

1. `feature-flag-overrides.test.ts` import failure — Wave 0 scaffold for plan 22-09; out of scope.
2. Bundle chunk-isolation CI guard — verifiable once 22-12 wires the mount.
3. consent_records.ip_inet capture — v1.2 stays NULL; Edge Function variant deferred.
4. window.__VERCEL_GEO__ runtime exposure — Phase 12 firewall delivers header server-side; 22-12 needs an inline init script in index.html.

## Self-Check

Verified before writing SUMMARY:
- 12 + 7 + 3 = 22 unit tests green (`npx vitest run src/lib/consent src/components/consent`).
- `npx tsc -b --noEmit` clean.
- `npm run build` succeeds; index gz = 15,034 bytes (50,000 ceiling = 30% utilisation).
- No `vanilla-cookieconsent` symbol in any built chunk (tree-shaken pending 22-12 mount).
- All 6 task commits present in `git log`.
- VALIDATION.md GDPR rows align with REQUIREMENTS.md.

## Threat Flags

None. All new surface (consent banner, consent_records writer, Pattern 4 gate) was already enumerated in the plan's `<threat_model>` (T-22-56 through T-22-61).
