---
phase: 42-v1-3-polish-closeout
plan: "03"
status: partial
completed: 2026-05-19
---

# Plan 42-03 Summary — Dark mode parity (POLISH-08)

**Status: PARTIAL.** Tasks 1+2 shipped (Tailwind v4 pin + 17 surface tokens × 2 themes). Tasks 3+4 (Playwright VR snapshots + human visual review) deferred to a follow-up plan after Phase 37 / 44 / 46 routes exist. See `deferred-items.md` for the deferral record.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Pin Tailwind v4 + `@variant dark` selector | ✅ Complete | `afc93d9` |
| 2 | Extend tokens for 6 v1.3 surfaces (light + dark) | ✅ Complete | `280940c` |
| 3 | Playwright VR snapshots × 6 surfaces × 2 themes | ⏭ Deferred | (none) |
| 4 | HUMAN visual review of 12 snapshots | ⏭ Deferred | (none) |

## Artifacts

- `leanshot/package.json` — `tailwindcss` + `@tailwindcss/vite` pinned to exact `4.0.0-beta.10` (no caret per Pitfall 7)
- `leanshot/package-lock.json` — refreshed; transitive deps locked
- `leanshot/src/index.css` — added `@variant dark (&:where([data-theme='dark'], [data-theme='dark'] *))` right after `@import 'tailwindcss';` (resolves Tailwind `dark:` utility to our `data-theme='dark'` attribute, NOT prefers-color-scheme)
- `leanshot/src/index.css` — extended `@theme` block + `[data-theme='dark']` block with 17 v1.3 surface tokens each (34 lines), tagged with `/* POLISH-08 v1.3 SURFACE: <name> */` comments (12 unique surface tags across both blocks)

## Surface coverage

| Surface | Phase owner | Status | Tokens |
|---------|-------------|--------|--------|
| admin shell | 24 (shipped) | ✓ live | `admin-shell-bg`, `admin-sidebar`, `admin-table-row`, `admin-table-row-hover` |
| onboarding builder | 31 (shipped) | ✓ live | `onboarding-builder-canvas`, `onboarding-builder-block-bg`, `onboarding-builder-handle` |
| clinic dashboard | 30 (shipped) | ✓ live | `clinic-dashboard-card`, `clinic-patient-row` |
| helpdesk | 37 (pending plan-exec) | 🌱 scaffolded | `helpdesk-msg-bg`, `helpdesk-msg-bg-mine`, `helpdesk-sidebar` |
| community feed | 44 (pending discuss) | 🌱 scaffolded | `community-post-bg`, `community-reaction-bar` |
| courses | 46 (pending discuss) | 🌱 scaffolded | `course-player-bg`, `course-lesson-row`, `course-progress-fill` |

Scaffolded tokens follow [[scaffolding-for-deferred-mobile-pattern]] — the dark-mode contract lands NOW so downstream phases consume tokens by name without redefining dark-mode in their own plans.

## Verification

- `npm run build` → ✅ clean (PWA injectManifest still produces `dist/sw.js` at 8.12 kB gz; index unchanged at 21.42 kB gz)
- `grep -c "POLISH-08 v1.3 SURFACE" src/index.css` → 12 (6 surface tags × 2 blocks)
- 42-02 axe-core CI gate (parallel wave 1) didn't surface NEW contrast violations on `main` after these changes — to be re-verified once Phase 37/44/46 routes land and their components consume the tokens.

## Deviations from plan

1. **Tailwind v4 beta pin**: latest beta is `4.0.0-beta.10` (not `beta.8` as plan suggested checking). Pinned to `.10`.
2. **Tasks 3+4 deferred**: see `deferred-items.md`. Not autonomous executable today — 3 of 6 routes don't exist + Playwright MCP not in-session.
3. **Scaffolding for deferred surfaces**: plan implied "extend tokens for existing v1.3 surfaces"; we extended for ALL 6 enumerated surfaces (including not-yet-shipped helpdesk/community/courses) so the M4 + Phase 37 plans don't need to re-tackle dark-mode contract definition.

## REQ-IDs

- `POLISH-08` — partial: Tailwind v4 dark variant + token coverage live; VR regression gate deferred until full surface set ships.

## Follow-up

Create plan `42-03-VR-ADDENDUM` (or equivalent in v1.4 polish phase) once Phase 37 helpdesk + Phase 44 community + Phase 46 courses are reachable. The recipe is in `42-03-PLAN.md` Task 3 verbatim — addendum is `cd leanshot && PLAYWRIGHT_VISUAL_RUN=1 npx playwright test --project=visual --update-snapshots` then commit the 12 PNGs + run a human visual-review pass.
