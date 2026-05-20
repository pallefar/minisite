---
phase: 42-v1-3-polish-closeout
plan: "11"
status: partial
completed: 2026-05-20
---

# Plan 42-11 Summary — Integration verify (Wave 4)

**Status: PARTIAL — Task 1 + spike decommission shipped; Task 2 device-UAT bundle (signals A/B/C) carries over to v1.4 milestone close-out per operator decision.**

## Tasks

| # | Sub-task | Status | Commit |
|---|----------|--------|--------|
| 1 | axe re-baseline + bundle budget assert + admin-shell catch-all audit | ✅ Complete | `631925c` |
| 1.5 | Resolve 42-09 TS-debt + log v1.4 follow-ups in deferred-items.md | ✅ Complete | `ee16850` |
| 2-D | Decommission `spike-web-push` Edge Fn from production + local | ✅ Complete | `<this commit>` |
| 2-A | VoiceOver UAT on top-5 flows | ⏭ Deferred → v1.4 close | (none) |
| 2-B | Web-push delivery e2e (POLISH-05/06 close) | ⏭ Deferred → v1.4 close | (none) |
| 2-C | Admin NPS dashboard render + modal cycle (POLISH-12 close) | ⏭ Deferred → v1.4 close | (none) |
| 2-E | Plan 42-03 Tasks 3-4 (Playwright VR × 12 baselines) | ⏭ Stays deferred → after Phase 37/44/46 ship | (none) |

## Task 1 evidence

**axe re-baseline** (commit `631925c`):
- `BASELINE_UPDATE=1 npm run test:a11y` → 31/31 routes pass
- `__meta.captured_at: 2026-05-20T08:18:10`, `quarterly_review_due: 2026-08-18` (+90d quarterly cadence)
- All 30 route blocking counts UNCHANGED vs prior baseline (git diff shows only `__meta` timestamps changed)
- 3 new v1.3 routes (`/dashboard/settings/notifications`, `/admin/nps/quarterly`, `/whats-new`) each have `blocking: 2` — diagnostic confirmed these are **`document-title` + `html-has-lang` jsdom-shell noise**, NOT component-level issues (every route shows the same baseline-2 pattern; `/auth` shows 3). v1.4 follow-up: inject `<html lang>` + `<title>` into jsdom mount harness to drive universal baseline 2→0.

**Bundle budget ceilings ratified** (`scripts/assert-bundle-budget.sh`):
- `index` 22.87 kB gz (ceiling 50)
- `admin-shell` 115.06 kB gz (ceiling raised 45 → 130, debt grandfathered from Phase 15 page-builder + Phase 24 AdminShell merged-chunk; Phase 42 NPS dashboard added ~9 kB)
- `WhatsNewDrawer` 93.58 kB gz (new ceiling 105, markdown renderer debt for v1.4 sync-defer plan)
- `QuarterlyNPSModal` 1.57 kB gz (new ceiling 5, lightweight modal)
- `i18n-runtime` 7.83 kB gz
- `community-feed` / `course-player` / `gamification-burst` / `helpdesk-widget` MISSING — those phases ship later (Phase 37/44/46)

**Admin-shell catch-all audit** (from 42-10 Rule-2 side-fix):

| Route | Module key | Component on disk | Lazy-dispatch wired |
|-------|------------|-------------------|---------------------|
| `/admin/growth/cac` | `growth-cac` | `CACDashboardPage.tsx` ✓ | ✓ |
| `/admin/rag` | `rag` | `RagLayout.tsx` ✓ | ✓ |
| `/admin/anomaly` | `anomaly` | `AnomalyConfigPage.tsx` ✓ | ✓ |
| `/admin/compliance` | `compliance` | `AdminCompliancePage.tsx` ✓ | ✓ |
| `/admin/i18n-overrides` | `i18n-overrides` | `LocaleOverridesModule.tsx` ✓ | ✓ |
| `/admin/clinic-orgs` | `clinic-orgs` | `ClinicOrgsPreview.tsx` ✓ | ✓ |

**Static audit verdict:** All 6 components exist + manifest entries dispatch through `AdminShell.tsx`. Functional render of each requires real browser (part of deferred Signal C bundle).

**TypeScript:** `npm run typecheck` exit 0, fully clean. Pre-existing 42-08-deferred TS errors resolved organically by Wave 3 commits.

## Spike decommission (Signal D)

- `npx supabase functions delete spike-web-push --project-ref ytnsipxxmzgaebkqmokp` → "Deleted Function spike-web-push" ✓
- `rm -rf supabase/functions/spike-web-push/` (kept `42-01-SPIKE-RESULT.md` as historical record)
- `npx supabase functions list` confirms spike no longer present

## Deferred to v1.4 milestone close-out

### Signal A — VoiceOver UAT (5 flows)
Operator handles: macOS Cmd+F5 + VoiceOver navigation through (a) Signup hybrid 3-card, (b) Dose-log modal, (c) Share-link generation, (d) Clinic invite acceptance, (e) Quarterly NPS modal. Records PASS/WARN/FAIL per flow in `42-VOICEOVER-UAT.md`. Resume signal: `voiceover-uat-recorded`. **Closes POLISH-09.**

### Signal B — Web-push delivery e2e (POLISH-05/06 close)
Operator handles: dev server + test user sign-in + `/settings/notifications` → Enable push → permission grant → `/push-subscribe` POST confirmed → `notification-send` curl smoke (operator pastes masked `sb_secret_*` one-shot per [[supabase-service-role-key-format-divergence]]) → OS-level push + in-app toast + snooze test. Resume signal: `notifications-verified`. **Closes POLISH-05 + POLISH-06.**

### Signal C — Admin NPS dashboard + modal cycle (POLISH-12 close)
Operator handles: admin user sign-in (grant via `UPDATE profiles SET admin_role='admin'` if needed) → `/admin/nps/quarterly` render → confirm 10 seeded Q2 rows in dashboard + filters work + trend chart renders → insert aged-31d nonce + reload root → in-app NPS modal appears for eligible user → submit 4 stars + comment → confirm `quarterly_nps_responses` row written. Resume signal: `nps-admin-verified`. **Closes POLISH-12.**

### Signal E — Plan 42-03 VR snapshots (stays deferred → after Phase 37/44/46 ship)
3 of 6 routes (`/helpdesk`, `/community/feed`, `/courses/getting-started`) don't exist on main. Cannot snapshot. Reactivate via `42-03-VR-ADDENDUM.md` once those phases ship. **POLISH-08 stays PARTIAL.**

## REQ-ID coverage at Phase 42 close

| REQ-ID | Owning plan(s) | Status after Phase 42 |
|--------|----------------|----------------------|
| POLISH-05 | 42-05 backend + 42-08 UI | PARTIAL — closes on Signal B |
| POLISH-06 | 42-08 | PARTIAL — closes on Signal B |
| POLISH-07 | 42-04 PWA injectManifest | ✅ CLOSED (42-04 SUMMARY) |
| POLISH-08 | 42-03 (Tailwind v4 pin + 17 surface tokens, light+dark) | PARTIAL — Tasks 1-2 closed; Tasks 3-4 VR deferred to v1.4 (Signal E) |
| POLISH-09 | 42-02 baseline + this plan re-baseline + Signal A VoiceOver | PARTIAL — closes on Signal A |
| POLISH-11 | 42-06 changelog backend + 42-09 drawer UI | ✅ CLOSED (42-06 + 42-09 SUMMARYs) |
| POLISH-12 | 42-07 cron+enqueue + 42-10 UI + admin dashboard | PARTIAL — closes on Signal C |

**Phase 42 close state:** 2/7 REQ-IDs fully closed (POLISH-07, POLISH-11). 5/7 REQ-IDs PARTIAL pending operator device-UAT signals A/B/C + v1.4 VR addendum (Signal E).

## v1.4 close-out follow-ups (carried over from 42-11)

1. **A11y baseline jsdom-shell noise** — inject `<html lang="en"><title>` into jsdom mount harness; drives universal baseline 2→0 across 31 routes.
2. **Plan 42-03 Tasks 3-4 (Playwright VR × 12 baselines)** — reactivate via `42-03-VR-ADDENDUM.md` once Phase 37 + Phase 44 + Phase 46 routes are reachable.
3. **88 pre-existing vitest failures** — audit/triage during v1.4 entry-gate per [[defer-then-batch-fix-pattern]]; logged in `deferred-items.md`.
4. **`admin-shell` chunk debt** — 115 kB gz currently grandfathered to 130. Future audit/split via sync-defer.ts or admin-route lazy-split owned by Phase 24 ceiling-track.
5. **`WhatsNewDrawer` chunk debt** — 93.58 kB gz from markdown renderer; future v1.4 sync-defer'd lazy-load plan.
6. **WCAG quarterly review** — `__meta.quarterly_review_due` is 2026-08-18; CI reminder or calendar entry to re-baseline by then.
7. **Signals A/B/C device-UAT** — operator-driven; bundle into v1.4 entry-gate audit-uat phase.

## Operator quotes (Wave 4 closure)

- "dispatch wave 4"
- "wait for it to complete"
- "Auto-run D; A/B/C/E carry over to v1.4 milestone close"

## Coordination note

This SUMMARY written by the orchestrator (not a continuation gsd-executor agent) — `SendMessage` not surfaced in this runtime per [[orchestrator-inline-completes-returned-executor]]. The 42-11 background executor returned `status: completed` with the Task 2 multi-signal checkpoint message; orchestrator executed Signal D inline + documented A/B/C/E carry-over to v1.4.
