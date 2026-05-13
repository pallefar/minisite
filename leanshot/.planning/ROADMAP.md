# Roadmap: LeanShot

## Current Milestone

_None active — v1.1 shipped 2026-05-13. Run `/gsd-new-milestone` to scope v1.2._

## Archived Milestones

- **v1.1** (2026-05-10 → 2026-05-13) — Multi-audience SaaS on Supabase: B2C patient cloud sync + doctor read-share + clinic B2B operator surface. 11 phases / 76 plans. Production live at `https://leanshot-app.vercel.app`. Audit `tech_debt` (48/49 REQ-IDs satisfied; 1 partial). → [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)

## Next Milestone (v1.2 — to be scoped)

Carried-over starter input (from v1.1 audit + deferred items):
- Fix CLINIC-07 operator-side dead-button on `ClinicDrillInPage` (~30 min)
- `s.user!` non-null assertion audit (15 occurrences / 14 files)
- Photo trash flow (carried from Phase 6 → 7 → still open)
- HIPAA BAA path (if/when clinic customers require)
- Resend domain `app.leanshot.app` verification before broad clinic outreach
- 6 deferred tests in `.planning/deferred-tests.md` batch-fix
- Plan-checker rule: `*-events.ts` / `*-keys.ts` / `*-routes.ts` exports need ≥1 non-test usage (anti-pattern #6)
- Tooling: `knip` or `ts-unused-exports` in CI

Open themes for v1.2 (to be chosen at `/gsd-new-milestone`):
- Billing / Stripe integration (clinic seats)
- EHR data import (CSV / FHIR / DEXA)
- Mobile app (PWA → React Native?)
- Clinic expansion features (operator messaging, custom rank weights, dose-trend alerts)
- Patient-side analytics dashboard
- Group / family accounts

Run `/gsd-new-milestone` to pick a theme + draft fresh REQUIREMENTS.md + ROADMAP phases.
