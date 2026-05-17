# Roadmap: LeanShot

## Milestones

- ✅ **v1.1 Multi-audience SaaS** — Phases 1-10 (shipped 2026-05-13) → [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Polished Launch + Full Monetization** — Phases 12-15, 19, 22-23 shipped (2026-05-17); Phases 16-18, 20-21 deferred to v1.4 → [`.planning/milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md)
- 📋 **v1.3** — Next milestone, new features only (no v1.2 carry-over). Scope via `/gsd-new-milestone`.
- 📋 **v1.4** — Absorbs v1.2-deferred (PUSH/HEALTH/AD/WATCH/MOBILE/ON-01 = 44 REQs) + all v1.2-era tech debt + additional new features.

## Phases

<details>
<summary>✅ v1.2 Polished Launch + Full Monetization (Phases 12-15, 19, 22-23) — SHIPPED 2026-05-17</summary>

7 active phases, 59 plans, 60 REQ-IDs satisfied. 5 phases descoped to v1.4.

- [x] **Phase 12: Bootstrap & Bundle Foundations** (5/5 plans) — Two-tunnel firewall + per-chunk ceilings + clinic-ad-free Playwright + CSP snapshot + Resend/Apple/Play/Stripe provisioning
- [x] **Phase 13: Design System v2 Rollout** (6/6 plans + 13-07 addendum) — Geist+Fraunces tokens + refreshed Card/Button/Pill/Sidebar + 8 net-new illustrations wired (DS-12 BLOCKER closed via doc-only catch-up 2026-05-17)
- [x] **Phase 14: Monetization Foundation** (11/11 plans) — 4 subscription tables + Stripe Checkout + 7-day trial + Customer Portal + clinic per-active-patient metered billing + dunning
- [x] **Phase 15: Page Builder + Landing Pages** (10/10 plans) — 4 RLS surfaces + dnd-kit editor + 8 semantic blocks + 5 templates + page-render Edge Fn + ISR + `/pricing` Stripe wire
- [ ] **Phase 16: Capacitor Mobile Shells** (9/11 plans shipped; 16-03/09/10 unexecuted) — **descoped to v1.4** 2026-05-17 (vendor closeout in flight at v1.2 close)
- [ ] **Phase 17: Push Notifications** — **descoped to v1.4**
- [ ] **Phase 18: HealthKit + Two-tunnel Firewall** — **descoped to v1.4**
- [x] **Phase 19: Affiliate Program + Stripe Connect** (10/10 plans) — 13 migrations + 10 Edge Fns + Connect Express W-9 + partner dashboard + fraud detection + 10-step deletion cascade
- [ ] **Phase 20: Ad Network** — **descoped to v1.4**
- [ ] **Phase 21: Watch Apps** — **descoped to v1.4**
- [x] **Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent** (12/12 plans) — Owner surface + impersonation + DSAR portal + vanilla-cookieconsent + 7 Resend lifecycle templates (ON-01 onboarding revamp carved to v1.4 via P22b D-02)
- [x] **Phase 23: v1.1 Tech Debt Sweep + Launch Polish** (5/5 plans) — DEBT-01..05 closed: PatientActivityModal + ESLint `s.user!` guard + photo trash flow + deferred-tests registry + knip+tue CI gate

</details>

<details>
<summary>✅ v1.1 Multi-audience SaaS (Phases 1-10) — SHIPPED 2026-05-13</summary>

11 phases / 76 plans / 497 commits / 48/49 REQ-IDs. Production live. Full detail: [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

</details>

### 📋 v1.3 (planned — next milestone)

Items the synthesizer flagged at v1.2 scoping that didn't make v1.2 GA. v1.3 will be a NEW-FEATURES-ONLY milestone (no v1.2 carry-over):

- Clinic-sponsored patient billing — wait for clinic demand signal
- HealthKit write-back — write our injection events + body metrics back to HealthKit (read-only at v1.2)
- Multi-language i18n — Spanish first; US-only at v1.2 GA
- Multi-tier affiliate program — silver / gold / platinum tiers; wait for partner volume
- Page-builder block-level A/B testing
- Standalone watch mode (no iPhone required)
- Mid-trial pharmacology projection paywall (synthesizer recommended test in v1.2.x patches)
- Page-builder embed-provider blocks (Calendly / YouTube / Tally)
- Hourly ad-revenue ETL (revisit at $1k/mo)
- HIPAA BAA paid activation (Supabase Team tier when a clinic prospect requires it)

Scope via `/gsd-new-milestone` to draft fresh REQUIREMENTS.md + ROADMAP phases.

### 📋 v1.4 (planned — deferred + tech-debt absorber)

44 REQ-IDs deferred from v1.2 plus all v1.2-era tech debt plus additional new features. Per user direction 2026-05-17:

> *"first I will verify and close 1.2 and then focus on additional features for 1.4. milstone 1.4 needs to forcus and close averything deffred and all tech debt"*

Deferred from v1.2:
- **Phase 16 Mobile Shells** — MOBILE-01..10 + MONEY-06 (11 REQs; 9/11 plans shipped + on disk; 16-03/09/10 + vendor closeout outstanding)
- **Phase 17 Push** — PUSH-01, 02, 03, 05 (4 REQs)
- **Phase 18 Health + Two-tunnel Firewall** — HEALTH-01..08 (8 REQs)
- **Phase 20 Ad Network** — AD-01..12 (12 REQs)
- **Phase 21 Watch Apps** — WATCH-01..08 (8 REQs)
- **P22b Onboarding revamp** — ON-01 (1 REQ; carved from Phase 22 via D-02)

Total: 44 REQs (5 phases) + tech-debt sweep + new features TBD at v1.4 scoping.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 12. Bootstrap | v1.2 | 5/5 | Complete | 2026-05-13 |
| 13. Design System v2 | v1.2 | 6/6 + addendum | Complete | 2026-05-13 |
| 14. Monetization | v1.2 | 11/11 | Complete | 2026-05-14 |
| 15. Page Builder | v1.2 | 10/10 | Complete | 2026-05-15 |
| 16. Mobile Shells | v1.4 (deferred) | 9/11 shipped | Carry-over | — |
| 17. Push | v1.4 (deferred) | 0/0 | Not started | — |
| 18. Health | v1.4 (deferred) | 0/0 | Not started | — |
| 19. Affiliate | v1.2 | 10/10 | Complete | 2026-05-15 |
| 20. Ad Network | v1.4 (deferred) | 0/0 | Not started | — |
| 21. Watch | v1.4 (deferred) | 0/0 | Not started | — |
| 22. Owner/Admin | v1.2 | 12/12 | Complete | 2026-05-16 |
| 23. Tech Debt | v1.2 | 5/5 | Complete + Nyquist-compliant | 2026-05-16 |
