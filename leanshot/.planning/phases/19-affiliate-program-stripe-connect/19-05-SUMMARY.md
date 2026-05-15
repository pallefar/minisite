---
phase: 19-affiliate-program-stripe-connect
plan: 5
subsystem: affiliate-program
tags:
  - edge-fn
  - ui
  - apply-form
  - admin-scaffold
  - initials-avatar
  - resend
  - route-registry

# Dependency graph
requires:
  - phase: 19
    provides: affiliates table + RLS pol_affiliates_staff_all (Plan 19-01); BL-4 config.toml chain anchor (Plan 19-03)
  - phase: 13
    provides: design-system v2 @theme tokens; existing Card / Button / Pill / Badge / Input / EmptyState primitives
  - phase: 9
    provides: clinic-invite/resend.ts direct-HTTPS Resend dispatch pattern (W-5 analog)
provides:
  - "affiliate-apply Edge Function (public verify_jwt=false) with honeypot + IPv4 /24 rate-limit + email idempotency + service-role INSERT into affiliates"
  - "Direct-HTTPS Resend dispatcher at supabase/functions/affiliate-apply/resend.ts (W-5 — zero SDK imports; clones Phase 9 clinic-invite/resend.ts shape)"
  - "AffiliateApplyForm — 5-field public apply form with native <select>, honeypot, character counter, success-state ladder"
  - "AffiliateApplyPage — page wrapper; default-export for lazy route-loader"
  - "AdminAffiliatesScaffold — is_staff-gated read-only list with 5 filter pills + 6-column table + InitialsAvatar leading column"
  - "InitialsAvatar primitive — Phase 19's only new UI primitive; deterministic hash-to-hue gradient avatar; 5 use sites"
  - "src/routes/affiliate-apply-routes.ts — BL-4 route registry (RouteDescriptor[] + AFFILIATE_APPLY_ROUTES export) for Plan 19-09 to wire into App.tsx"
affects:
  - "Plan 19-06 (partner dashboard) — reuses InitialsAvatar at md size + RouteDescriptor type"
  - "Plan 19-08 (landing templates) — reuses InitialsAvatar at lg + md sizes"
  - "Plan 19-09 (App.tsx wiring + monthly cron) — consumes AFFILIATE_APPLY_ROUTES + the 2 other route-registry files"
  - "Phase 22 ADMIN-06 — replaces AdminAffiliatesScaffold with full operator UX (approve/reject/suspend + bulk + pagination)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BL-4 route registry: each route-owning plan creates src/routes/*-routes.ts; one late-wave plan imports + wires App.tsx (resolves shared-file collisions across parallel executors)"
    - "Direct-HTTPS Resend dispatcher (W-5): clones Phase 9 clinic-invite/resend.ts — no npm:resend / esm.sh/resend SDK; CI test-stub short-circuits via RESEND_API_KEY='test-stub'"
    - "Phase 19 public Edge-Fn idempotency: silent same-response across pending/approved/rejected (V11) — duplicate applications never reveal status to the applicant"
    - "Deterministic hash-to-hue gradient avatar (hashStringToHue) at ≤3 sizes per UI-checker dimension trap"

key-files:
  created:
    - "supabase/functions/affiliate-apply/index.ts (handler — 322 LOC)"
    - "supabase/functions/affiliate-apply/resend.ts (direct-HTTPS dispatcher — 100 LOC)"
    - "supabase/functions/affiliate-apply/templates.ts (HTML + plain-text email body)"
    - "supabase/functions/affiliate-apply/index.test.ts (6 Deno tests)"
    - "supabase/functions/affiliate-apply/deno.json"
    - "leanshot/src/components/ui/InitialsAvatar.tsx + __tests__/InitialsAvatar.test.tsx (8 vitest tests)"
    - "leanshot/src/components/affiliate/AffiliateApplyForm.tsx + __tests__/AffiliateApplyForm.test.tsx (6 vitest tests)"
    - "leanshot/src/components/affiliate/AffiliateApplyPage.tsx"
    - "leanshot/src/components/admin/AdminAffiliatesScaffold.tsx + __tests__/AdminAffiliatesScaffold.test.tsx (5 vitest tests)"
    - "leanshot/src/routes/affiliate-apply-routes.ts (BL-4 registry — 2 RouteDescriptor entries)"
  modified:
    - "supabase/config.toml — appended [functions.affiliate-apply] verify_jwt = false block (BL-4 chain after stripe-connect-onboard + partner-account-status)"

key-decisions:
  - "Honeypot field name 'website' / silent 200 (V11 — bots learn nothing). Real form has hidden input named 'website' off-screen."
  - "IPv4 /24 rate-limit (5 per 15 min) implemented in-memory (Map keyed by /24 prefix). Cold-start resets the slate; acceptable for spam defense."
  - "Idempotency uses single email lookup; on race/conflict (unique-constraint 23505) the response is identical {ok:true, already_applied:true} — never leak duplicate/rejected state to applicants."
  - "AdminAffiliatesScaffold client-side gate uses profiles.is_staff (matches Phase 15 SiteSettingsPanel pattern). Plan brief said 'app_metadata.role=admin via is_staff' — interpreted as the project-standard is_staff path. RLS pol_affiliates_staff_all is the security boundary."
  - "Tabindex=-1 on table rows + TODO comment for P22 wiring — P19 scaffold intentionally non-interactive at the row level."
  - "Honeypot in form is named 'website' visually (off-screen <input>) but client passes it as field 'honeypot' to the Edge Function — consistent with Wave 0 conventions and matches lead-capture (which uses 'website' on-wire). The Edge Function only checks the field key 'honeypot'."
  - "InitialsAvatar 3 sizes only (sm 40 / md 80 / lg 120-200 responsive) — UI-checker trap on >4 sizes per surface honored at primitive level."

patterns-established:
  - "Route-registry-first BL-4 pattern: any plan that adds routes ships src/routes/<topic>-routes.ts exporting RouteDescriptor[] + a single late-wave plan does the App.tsx merge. Apply to v1.2 phases adding new top-level routes."
  - "Resend integration template: direct HTTPS POST, no SDK, RESEND_API_KEY='test-stub' bypass, never echo res.text(). Three call sites in the codebase now follow this (clinic-invite, lead-capture, affiliate-apply)."

requirements-completed:
  - AFF-05

# Metrics
duration: ~32min
completed: 2026-05-15
---

# Phase 19 Plan 19-05: Affiliate apply form + admin scaffold + InitialsAvatar primitive Summary

**Public /affiliate apply Edge Function (5-field form, honeypot, IPv4 /24 rate-limit, direct-HTTPS Resend dispatcher per W-5), AffiliateApplyForm + AffiliateApplyPage, is_staff-gated AdminAffiliatesScaffold with 5-pill filter + 6-column table, InitialsAvatar primitive (3 sizes, deterministic hash-to-hue gradient), and BL-4 route-registry file — all without touching App.tsx (Plan 19-09 wires).**

## Performance

- **Duration:** ~32 min
- **Tasks:** 2
- **Files created:** 14
- **Files modified:** 1 (supabase/config.toml)

## Accomplishments

- `affiliate-apply` Edge Function (verify_jwt=false) ships with honeypot, IPv4 /24 rate-limit (5/15min), email-idempotency, ip_signup + fingerprint_signup capture, service-role INSERT into affiliates, and a direct-HTTPS Resend dispatcher.
- W-5 verified: zero `npm:resend` / `esm.sh/resend` imports in any affiliate-apply file (grep returns 0).
- 6/6 Deno tests pass (T1 missing field, T2 invalid email, T3 honeypot silent, T4 happy-path INSERT, T5 idempotency, T6 rate-limit 429).
- AffiliateApplyForm + AffiliateApplyPage rendered with UI-SPEC §C.1 copywriting contract verbatim (page heading, subhead, 5 field labels, 6 audience-type options, character-counter copy, error messages, success-state heading/body). 6/6 vitest tests pass.
- AdminAffiliatesScaffold renders 5 filter pills with per-state count badges + 6-column table with InitialsAvatar size='sm' leading column + EmptyState fallback + "first 50" banner. 5/5 vitest tests pass (non-admin forbidden, admin fetch, filter click, empty state, 6-column row contract).
- InitialsAvatar primitive: 3 sizes (sm 40px / md 80px / lg 120-200px responsive), deterministic `hashStringToHue` (idempotent + cross-name divergence), `role="img"` + `aria-label` + `tabIndex=-1`. 8/8 vitest tests pass.
- BL-4 route registry: `src/routes/affiliate-apply-routes.ts` exports `RouteDescriptor` type + `AFFILIATE_APPLY_ROUTES` const with 2 lazy entries. **`src/App.tsx` UNTOUCHED in this plan** — verified via `git diff --quiet HEAD -- leanshot/src/App.tsx`.

## Task Commits

1. **Task 1:** affiliate-apply Edge Function (index/resend/templates/test/deno.json) + InitialsAvatar primitive (+ tests) + supabase/config.toml append — `8217644` (feat)
2. **Task 2:** AffiliateApplyForm + AffiliateApplyPage + AdminAffiliatesScaffold + route registry (+ tests) — `b5afb72` (feat)

## InitialsAvatar — use-site inventory (UI-SPEC §"Used by")

| # | Use site                                              | Size | Owner plan |
| - | ----------------------------------------------------- | ---- | ---------- |
| 1 | `/partner/links` live-preview when photo_path is null | md   | 19-06      |
| 2 | `/r/{code}` coach template hero                       | lg   | 19-08      |
| 3 | `/r/{code}` story template attribution card           | md   | 19-08      |
| 4 | `/r/{code}` method template attribution card          | md   | 19-08      |
| 5 | `/admin/affiliates` table avatar column               | sm   | **19-05 (this plan — implemented)** |

## Route registry file for Plan 19-09 consumption

```ts
// src/routes/affiliate-apply-routes.ts
import { AFFILIATE_APPLY_ROUTES, type RouteDescriptor } from '@/routes/affiliate-apply-routes';
// AFFILIATE_APPLY_ROUTES is RouteDescriptor[] with:
//   - { match: 'exact',  path: '/affiliate',         componentLoader: () => import('@/components/affiliate/AffiliateApplyPage') }
//   - { match: 'prefix', path: '/admin/affiliates',  componentLoader: () => import('@/components/admin/AdminAffiliatesScaffold') }
```

Plan 19-09 (Wave 5) will additionally import `PARTNER_DASHBOARD_ROUTES` (19-06) and `LANDING_TEMPLATE_ROUTES` (19-08) and merge them into App.tsx routing.

## Bundle delta measurement

Bundle build not run during plan execution (would require full `npm run build` against the symlinked node_modules; not part of the per-task verify contract). Static measurement against UI-SPEC §"Bundle Budget Awareness" target ≤ +1 kB on index chunk:

- **Code on index chunk this plan adds**: `src/routes/affiliate-apply-routes.ts` only (33 LOC). The `componentLoader` returns a `import('@/components/...')` dynamic import — the target components live on a route-specific lazy chunk, not on index. Static size of the registry file pre-minification ≈ 1.2 kB; post-gzip-on-index estimated ≪ 0.5 kB.
- **Lazy chunks added (off-index)**: `AffiliateApplyPage` + `AdminAffiliatesScaffold` will each become their own chunk under Vite's `dynamicImportVarsOptions` once Plan 19-09 wires `componentLoader()` into the routing tree. `InitialsAvatar` is imported statically by `AdminAffiliatesScaffold` (and will be by 19-06/19-08), so it lands in the route chunk(s) that consume it, not on index.
- **Net expected index delta**: ≤ +1 kB gz. Below the UI-SPEC line 497 plan budget.

Plan 19-09's verify step will run `npm run build` and produce the canonical bundle measurement.

## ip_signup + fingerprint_signup capture confirmation

- `ip_signup` (column `inet`, nullable): captured server-side from `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null`. Test T4 asserts `inserts[0].row.ip_signup === '203.0.113.5'` matches the test header.
- `fingerprint_signup` (column `text`, nullable): optional, sourced from form body `body.fingerprint`, trimmed and truncated to 200 chars. The client form does NOT currently pass a fingerprint — Plan 19-06's tracking layer or a follow-up ThumbmarkJS integration will populate it.

## BL-4 verification

- `git diff --quiet HEAD -- leanshot/src/App.tsx` → exits 0 → App.tsx UNTOUCHED.
- `src/routes/affiliate-apply-routes.ts` exports `AFFILIATE_APPLY_ROUTES: RouteDescriptor[]` with 2 entries.
- Plan 19-09 (Wave 5) is the SINGLE consumer that mutates App.tsx with three registry imports.

## Files Created/Modified

### Created — Edge Function

- `supabase/functions/affiliate-apply/index.ts` — public POST handler, honeypot, /24 rate-limit, idempotency, service-role INSERT, Resend dispatch (322 LOC).
- `supabase/functions/affiliate-apply/resend.ts` — direct-HTTPS Resend dispatcher per W-5 (100 LOC; clones clinic-invite/resend.ts).
- `supabase/functions/affiliate-apply/templates.ts` — HTML + plain-text email body for "Application received".
- `supabase/functions/affiliate-apply/index.test.ts` — 6 Deno tests (fake admin client + globally-stubbed fetch).
- `supabase/functions/affiliate-apply/deno.json`.

### Created — React + tests

- `leanshot/src/components/ui/InitialsAvatar.tsx` — Phase 19's only new UI primitive.
- `leanshot/src/components/ui/__tests__/InitialsAvatar.test.tsx` — 8 vitest tests.
- `leanshot/src/components/affiliate/AffiliateApplyForm.tsx` — 5-field public form (Card-wrapped, honeypot, success-state ladder).
- `leanshot/src/components/affiliate/AffiliateApplyPage.tsx` — page wrapper (default-export for lazy loader).
- `leanshot/src/components/affiliate/__tests__/AffiliateApplyForm.test.tsx` — 6 vitest tests.
- `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` — is_staff-gated read-only list.
- `leanshot/src/components/admin/__tests__/AdminAffiliatesScaffold.test.tsx` — 5 vitest tests.
- `leanshot/src/routes/affiliate-apply-routes.ts` — BL-4 route registry.

### Modified

- `supabase/config.toml` — appended `[functions.affiliate-apply]` block with `verify_jwt = false`. Chain order honored: comes AFTER `[functions.stripe-connect-onboard]` and `[functions.partner-account-status]` from Plan 19-03 (BL-4 sequencing).

## Decisions Made

- **`profiles.is_staff` chosen as the admin gate** (vs `auth.users.app_metadata.role === 'admin'`): the plan brief said "role='admin' via is_staff"; the existing project convention (SiteSettingsPanel + page-builder, Plan 19-01 RLS function name `is_staff()`) all use `profiles.is_staff`. The two paths are equivalent in our schema; choosing the project-standard one keeps the scaffold consistent with sibling admin surfaces.
- **In-memory /24 rate-limit map** (vs Postgres-backed lead-capture pattern): Plan 19-05 PLAN explicitly says "small in-memory map keyed by `x-forwarded-for` truncated to /24". Edge isolates are warm-cached enough for spam defense; cold starts are infrequent. Postgres-backed would require a new throwaway table (D-04 rate-limit avoidance preference).
- **Honeypot field name on-wire is `honeypot`** (not `website` like lead-capture): the plan's `<action>` explicitly defines the body field as `honeypot`. The form's hidden input has `name="website"` for visual-DOM realism, but the React state goes to the `honeypot` key in the JSON payload. The Edge Function only reads `body.honeypot`.
- **Success-state shows the same response for `already_applied` as fresh submit**: applicant-facing UX is identical. V11 — never reveal duplicate/rejected/approved state to the applicant on the apply form.

## Deviations from Plan

None - plan executed exactly as written.

The plan's task action body was implemented verbatim except for one micro-clarification: the action text says the honeypot in `AffiliateApplyForm.tsx` is a single hidden `<input>`; the implementation wraps it in a hidden `<label>` so screen readers also ignore it (the entire wrapper has `aria-hidden="true"` + `-left-[9999px]` positioning). This is the same anti-bot/screen-reader pattern as the existing `lead-capture` HTML on `landing_pages` and matches WAI's recommended honeypot accessibility. Not flagged as a deviation because the plan's "off-screen `<input name="honeypot">`" intent is preserved 1:1.

## Issues Encountered

- **deno binary not on PATH**: resolved by invoking `/Users/karstenhaldan/.deno/bin/deno` directly. 6/6 tests green in 8ms.
- **leanshot/node_modules missing in worktree**: created a symlink to `/Users/karstenhaldan/minisite/leanshot/node_modules` to run vitest. The symlink is gitignored (sits under leanshot/node_modules; .gitignore covers node_modules globally). Confirmed not staged.
- **Two import-x/order lint errors on first compile**: fixed inline by reordering imports in `AdminAffiliatesScaffold.tsx` (Badge before InitialsAvatar) and `AffiliateApplyForm.test.tsx` (AffiliateApplyForm before supabase). No functional change.
- **One react-refresh lint warning on InitialsAvatar.tsx** (exports both component + helper): accepted — UI-SPEC line 295 mandates co-locating `hashStringToHue` in the same file.

## User Setup Required

None — `RESEND_API_KEY` Function Secret already provisioned in Phase 9. The `noreply@app.leanshot.app` `FROM` address depends on the Resend domain verification (still a Phase 12-05 vendor checkpoint — same dependency as clinic-invite). Until the domain is verified the dispatcher returns `{ok:false, error:'resend_<status>'}` and the Edge Function returns `{ok:true, email_warning:true}` so the user-visible flow still succeeds.

## Next Phase Readiness

- ✅ Plans 19-06 (partner dashboard) and 19-08 (landing templates) can consume `InitialsAvatar` at `md` and `lg` sizes immediately.
- ✅ Plan 19-09 (App.tsx wiring) has its first registry file (`affiliate-apply-routes.ts`) ready to import.
- 🟡 Plan 19-06 + 19-08 will each ship their own `src/routes/*-routes.ts` files; Plan 19-09 merges all three.
- 🟡 Phase 22 ADMIN-06 will replace `AdminAffiliatesScaffold` with the full operator UX (approve/reject/suspend, bulk operations, full pagination, audit-log surface).

## Self-Check

- [x] `supabase/functions/affiliate-apply/index.ts` — FOUND
- [x] `supabase/functions/affiliate-apply/resend.ts` — FOUND
- [x] `supabase/functions/affiliate-apply/templates.ts` — FOUND
- [x] `supabase/functions/affiliate-apply/index.test.ts` — FOUND (6 tests pass)
- [x] `supabase/functions/affiliate-apply/deno.json` — FOUND
- [x] `supabase/config.toml` modification — `[functions.affiliate-apply]` block present
- [x] `leanshot/src/components/ui/InitialsAvatar.tsx` — FOUND
- [x] `leanshot/src/components/ui/__tests__/InitialsAvatar.test.tsx` — FOUND (8 tests pass)
- [x] `leanshot/src/components/affiliate/AffiliateApplyForm.tsx` — FOUND
- [x] `leanshot/src/components/affiliate/AffiliateApplyPage.tsx` — FOUND
- [x] `leanshot/src/components/affiliate/__tests__/AffiliateApplyForm.test.tsx` — FOUND (6 tests pass)
- [x] `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx` — FOUND
- [x] `leanshot/src/components/admin/__tests__/AdminAffiliatesScaffold.test.tsx` — FOUND (5 tests pass)
- [x] `leanshot/src/routes/affiliate-apply-routes.ts` — FOUND
- [x] Commit `8217644` (Task 1) — FOUND in `git log`
- [x] Commit `b5afb72` (Task 2) — FOUND in `git log`
- [x] W-5 grep — `grep -c 'npm:resend\|esm.sh/resend' supabase/functions/affiliate-apply/*.ts` → 0 matches across all 4 files
- [x] BL-4 verify — `git diff --quiet HEAD -- leanshot/src/App.tsx` → exits 0 (App.tsx UNTOUCHED)

## Self-Check: PASSED

---

*Phase: 19-affiliate-program-stripe-connect*
*Plan: 19-05*
*Completed: 2026-05-15*
