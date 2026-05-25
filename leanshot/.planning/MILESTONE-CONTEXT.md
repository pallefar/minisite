---
milestone: v1.4
captured: 2026-05-25
source: user freeform direction
status: draft (pending REQUIREMENTS + ROADMAP)
---

# v1.4 Milestone Context

## User-stated direction (verbatim)

> Lets do all the carry over backlog, then focus on the layout and design, remember to use the claud design which was setup for this. once all the backlog is done then lets finalise all the UAT tests etc. while you are reseraching, please also think about what might be missing in this app, to make it ready for launch. If you find something add this in after the backlog carry over and group all the UATs at the end of the milstone, on one big phase

## Phase Ordering Contract

Roadmap MUST order phases as follows:

1. **Carry-over backlog** — v1.2 + v1.3 deferred items, in dependency order
2. **Launch-readiness gaps** — items discovered by research that block production launch but were never planned
3. **Layout & design polish** — uses the established LeanShot design system (Tailwind v4 tokens, 4-size typography ceiling, DS primitives — `Card`, `Modal`, `Sheet`, `Pill`, `EmptyState`, etc.); harmonization audit across all v1.3 surfaces
4. **One consolidated UAT phase** — ALL outstanding UAT signals roll up here at the END of the milestone. No per-phase HUMAN-UAT during execution — defer ALL of them to this single closeout phase

## Inherited carry-over backlog

### From v1.2 (Phase 16-21 descoped → ~44 REQs)

- **Phase 16** — Capacitor mobile shells (iOS + Android)
- **Phase 17** — Push Notifications (web + native)
- **Phase 18** — HealthKit + two-tunnel firewall (Apple Health PHI path)
- **Phase 20** — Ad Network (in-app placements / sponsorship integrations)
- **Phase 21** — Watch Apps (Apple Watch + Wear OS companion)

REQ-ID families: PUSH-*, HEALTH-*, AD-*, WATCH-*, MOBILE-*, ON-01

### From v1.3 (deferred items)

- **Phase 32-06** — Spanish i18n contractor handoff (translation memory + glossary delivery)
- **Phase 34-08/10** — Apple OAuth (sign-in-with-Apple — required for App Store + iOS users)
- **Phase 50 Waves 2-4** — RAG knowledge base MVP + STRETCH (Phase 50 dir kept in `.planning/phases/` for in-place resume)
- **Phase 42** — 5 device-UAT signals (dark mode, PWA offline, smart notifications, etc.)
- **33 consolidated HUMAN-UAT signals** — v1.3-uat-deferred.md
- **7 vendor secrets** — Calendly OAuth, Better Stack API, Sentry CSP report URI, Mux, etc.
- v1.2/v1.3-era tech debt (REVIEW.md leftovers, IN-* findings, etc.)

## Design system anchor

Layout/design phase uses the **established LeanShot design system**:

- Tailwind v4 beta CSS-first `@theme` tokens (`leanshot/src/index.css`)
- Typography ceiling: 4 sizes (11/13/18/28 px), 2 weights, accent reserved-list (validated Phase 41/51 ui-checker)
- DS primitives: `Card`, `Modal`, `Sheet`, `Pill`, `PillGroup`, `EmptyState`, `Button`, `Input`, `Toast`, `Badge`, `ProgressRing`, `Skeleton`, `Sparkline`
- a11y baseline: aria-label on icon-only buttons, role="dialog" + aria-modal="true" on modals, aria-sort on sortable columns, `useReducedMotion` for all animations
- Dark mode: `data-theme="light|dark"` on `<html>`, applied pre-paint
- Per `feedback_ui_researcher_prebake_constraints`: bake these constraints into UI-SPEC up front

## Consolidated UAT phase contract

Final phase of v1.4 (likely numbered as the LAST phase, ~Phase 60+):

- Inherits all 33 v1.3 HUMAN-UAT signals
- Inherits Phase 42's 5 device-UAT signals
- Includes new v1.4 carry-over HUMAN-UAT (mobile shells, push, HealthKit, Apple OAuth, ad network, watch)
- Includes UAT for launch-readiness gaps surfaced by research
- Includes UAT for design polish phase
- Full regression sweep across v1.1 + v1.2 + v1.3 + v1.4 surfaces
- Multi-signal structure per `feedback_multi_signal_human_verify_checkpoint_pattern` — N discrete approve-able items, not one mega-signal
- Ship rule (TBD by user at UAT-phase planning): all-signals-pass OR ≥X/Y inline-approved + critical gate among them

## Out of scope for v1.4

- HIPAA covered-entity-tier conversion (still B2C + B2B-without-EHR)
- Direct EHR integration (would push into HIPAA-CE bucket)
- Net-new revenue streams not already scoped in v1.2/v1.3 backlog
- New community-feed features beyond Phase 49 (digest send loop, search) — those are v1.3-complete

## User decisions (2026-05-25)

- **Phase 50 RAG:** Ship FULL Waves 2-4 (MVP + STRETCH). Per `feedback_aggressive_foundations` user picks max-coverage on foundation phases.
- **Phase 20 (Ad Network) + Phase 21 (Watch Apps):** BOTH in v1.4. No descope.
- **Spanish i18n contractor:** Already engaged. Phase 32-06 follow-up is engineering wiring + integration testing only (~1 small phase).
- **Launch-readiness gaps:** Research dispatched (`gsd-project-researcher`); blockers + hard-debt fold into v1.4 roadmap AFTER carry-over phases, BEFORE design polish + UAT consolidation.

## Carry-over phase enumeration (revised 2026-05-25 — vendor-setup moved to front; Protocol Creator + Insights & Research added)

| # | Phase | Source | Scope |
|---|-------|--------|-------|
| 52 | **Vendor Setup Foundation** | NEW (consolidated) | All vendor onboarding upfront so every downstream phase has live integrations: Calendly OAuth app + Function Secrets, Better Stack status page + API key, Sentry CSP report URI, Mux video API (community + KB), Apple Developer + APNs cert, Google Play + FCM service-account, HealthKit entitlement, Anthropic clinical-vs-consumer key split verify, all `supabase secrets set` + `vercel env add` ops, gate downstream phases on this completing |
| 53 | Capacitor Mobile Shells (iOS + Android) | v1.2 P16 | Bundle iOS + Android wrappers; CI per-platform builds; signing certs (uses P52 Apple Dev account) |
| 54 | Push Notifications | v1.2 P17 | Web push (Phase 42 foundation) + native iOS APNs + Android FCM; permission UX (uses P52 APNs/FCM creds) |
| 55 | HealthKit + Two-Tunnel Firewall | v1.2 P18 | Apple Health PHI ingestion path; iOS-only; OPT-IN per HIPAA (uses P52 HealthKit entitlement) |
| 56 | Ad Network | v1.2 P20 | In-app placements / sponsorship integrations |
| 57 | Watch Apps (Apple Watch + Wear OS) | v1.2 P21 | Companion app: quick dose log + reminder; depends on P53 mobile shell |
| 58 | Spanish i18n Wiring (Contractor-Delivered) | v1.3 P32-06 | TMX import + glossary integration + RTL verification + smoke; contractor already engaged |
| 59 | Apple OAuth (Sign-in-with-Apple) | v1.3 P34-08/10 | iOS App Store requirement; Supabase Auth provider config + UI (uses P52 Apple Dev account) |
| 60 | Phase 50 RAG Completion (Waves 2-4) | v1.3 P50 | Resume in-place: scrape + chunk + embed + admin curation + re-rank + federated sources; MVP + STRETCH |
| 61 | **Admin Protocol Creator** | NEW | Admin tool to author evidence-based dosing protocols (Tirzepatide 12-wk titration, Retatrutide stack, GHRP-2 sleep stack, etc.). Pulls from P60 RAG for evidence + citations; produces structured protocol JSON; distributes to clinician dashboard (P30) + patient dose-log (P35); versioned + reviewable |
| 62 | **Insights & Research Engine** | NEW | Anonymized aggregate compilation: dose logs + body metrics + symptoms + retention curves (P51 traffic) + gamification engagement + AI coach interactions. K-anonymity (k≥5) + differential privacy on small cohorts. Admin research dashboard + white-paper publishing pipeline (PDF/HTML) + opt-in public blog. Feeds back into P60 RAG as primary-research evidence |
| 63 | Device-UAT + Tech Debt Cleanup | v1.3 carry | Phase 42's 5 device-UAT signals + REVIEW.md IN-* findings (Phase 41 + 51) + v1.2/v1.3-era tech debt sweep + cosmetic ROADMAP checkbox drift fix |

### Launch-readiness gap phases (added 2026-05-25 from research)

Folded from `.planning/research/v1.4-launch-readiness-gaps.md` (4 blockers + 16 hard-debt items). Land AFTER carry-over (P52-63), BEFORE design polish + UAT consolidation. Per user direction: launch-readiness gaps insert AFTER backlog.

| # | Phase | Source | Scope |
|---|-------|--------|-------|
| 64 | **Legal Refresh** | research B1+B2+HD6+HD7+HD8 | State-privacy disclosures (CCPA/CPRA + CDPA-VA + CPA-CO + CTDPA-CT + UCPA-UT) + Do-Not-Sell footer + opt-out form + privacy/ToS audit + grandfathered notice email + accessibility statement page + DMCA agent registration + cookie banner WCAG 2.2 AA re-audit + CPRA copy. **BLOCKER.** Drive from existing Phase 25 `subprocessor-diff` cron. |
| 65 | **Stripe Tax + Payment Resilience** | research B3+B4+HD9+HD10+HD12 | Stripe Tax enable + `automatic_tax: { enabled: true }` on all checkouts + `customer_update.address: 'auto'` + B2B `tax_id_collection` + nexus-monitoring `/admin/tax` dashboard + 3-email dunning sequence + in-app `<PaymentFailedBanner>` + `dunning_state` column + refund self-service (ROSCA compliance) + Stripe webhook burst-retry test + trial-ending/win-back lifecycle emails. **BLOCKER.** |
| 66 | **Consumer Account Security** | research HD1+HD2 | Consumer-facing MFA / TOTP self-serve at `/settings/security` (reuse Phase 25 admin TOTP flow) + per-IP/per-email sign-in lockout + brute-force PostHog alerting + cookie banner mention. |
| 67 | **Operational Runbooks + Observability** | research HD3+HD4+HD5+HD14+HD15+HD16 | Secrets-rotation runbook (per-secret rotation procedure + blast-radius) + DDoS/abuse load-test (k6 against public Edge Fns) + Vercel rate-limit config + SENTRY_DSN production verification + Edge-Fn-level Sentry CI guard + funnel-break PostHog alerts → Slack + incident-response runbook (on-call rotation + log locations + rollback + status-page + breach-clock) + backup + PITR restore drill. |
| 68 | **Audience Landing + Sales Enablement** | research HD11+HD13 | 3 audience-specific landing pages via Phase 15 page-builder: `/for-doctors`, `/for-clinics`, `/for-coaches` + schema.org `Service` JSON-LD per audience + sitemap inclusion + demo / sandbox mode for clinic-buyer prospects (synthetic patients + `is_demo` flag + auto-purge). |

### Layout & Design Polish (Phase 69)

| # | Phase | Scope |
|---|-------|-------|
| 69 | **Layout & Design Polish** | Design-system harmonization audit across all v1.1/v1.2/v1.3/v1.4 surfaces using the established LeanShot DS: Tailwind v4 `@theme` tokens, 4-size typography ceiling (11/13/18/28 px), 2 weights, accent reserved-list, DS primitives (`Card`, `Modal`, `Sheet`, `Pill`, `EmptyState`, etc.), aria-* baseline, `useReducedMotion` gating. Catch + fix accumulated drift from 51 phases of dispatch. Audit via `gsd-ui-auditor` across all admin + consumer surfaces. |

### Consolidated UAT Closeout (Phase 70)

| # | Phase | Scope |
|---|-------|-------|
| 70 | **Consolidated UAT — v1.4 Launch Gate** | autonomous:false. Multi-signal HUMAN-UAT per `feedback_multi_signal_human_verify_checkpoint_pattern`. Roll up: 33 v1.3 carry-over signals + 5 Phase 42 device-UAT signals + new v1.4 phase UAT (mobile, push, HealthKit, Apple OAuth, watch, ad network, RAG, Protocol Creator, Insights, Legal, Stripe Tax, MFA, runbooks, landing pages, design polish) + full regression sweep across all 4 milestones. Group signals by environment-fixture-shared sets (browser, iOS device, Android device, Stripe test, vendor-OAuth, ops-runbook-drill). Ship rule TBD at planning. |

## v1.4 Phase Total

**19 phases total (52-70):**
- 1 foundation: P52 Vendor Setup
- 5 mobile/native carry: P53-57 (Capacitor, push, HealthKit, ad, watch)
- 3 small v1.3 carry: P58-60 (i18n wiring, Apple OAuth, RAG completion)
- 2 NEW product features: P61-62 (Protocol Creator, Insights & Research)
- 1 tech debt: P63
- 5 launch-readiness: P64-68 (legal, payment, security, runbooks, audience landing)
- 1 design polish: P69
- 1 consolidated UAT: P70

Per `feedback_aggressive_foundations`: user picked max coverage; this matches.

## Vendor-setup-first rationale

Per user direction (2026-05-25): *"I suggest to group all the vendor setups in to one phase, to ensure all ise setup correctly from start of the milstone."*

Phase 52 collapses what would otherwise be 7+ scattered vendor-setup deferrals (one per downstream phase). All Function Secrets / Vercel env vars / vendor accounts ready before any phase that depends on them dispatches. Downstream HUMAN-UAT signals that previously gated on "operator did vendor setup" now run automated in their owning phase because the setup is already done. Also avoids the trap from `reference_supabase_config_toml_verify_jwt` + `feedback_vendor_secret_preflight_surface` repeating across N phases.

**Phase 52 outputs (gates downstream):**
- All 7+ outstanding vendor secrets from v1.3 carry-over set on Supabase + Vercel
- Apple Developer account + APNs push certs + Sign-in-with-Apple service ID
- Google Play account + FCM service account JSON
- HealthKit entitlement requested
- Mux video API onboarded (community + KB)
- Anthropic clinical-vs-consumer key split verified live
- Vendor BAA chain re-verified (Phase 25 contract still valid for all)
- Smoke test per vendor: live API ping logged to admin dashboard

## Protocol Creator scope (Phase 61)

Admin authoring tool that produces **versioned, evidence-cited dosing protocols** consumable by:
- **Clinician dashboard (Phase 30):** clinicians select a protocol → assigns to roster patients
- **Patient dose-log (Phase 35):** protocol prefills the dose schedule + reminder timing + side-effect-monitor cadence
- **Helpdesk KB (Phase 37):** protocols referenceable from KB articles

**Data shape (proposed):**
```jsonc
{
  "protocol_id": "uuid",
  "name": "Tirzepatide 12-week titration",
  "audience": ["B2C", "clinic"],  // who can adopt
  "steps": [
    { "week": 1, "dose_mg": 2.5, "frequency": "weekly", "monitoring": ["weight", "nausea_score"] },
    { "week": 5, "dose_mg": 5.0, "frequency": "weekly", "monitoring": ["weight", "GI_symptoms"] },
    // ...
  ],
  "evidence": [
    { "citation": "SURPASS-1 trial", "rag_source_id": "uuid-from-P60-rag" },
    { "citation": "FDA prescribing info", "rag_source_id": "uuid" }
  ],
  "review_state": "draft | published | archived",
  "version": 3,
  "published_at": "...",
  "created_by_admin_id": "uuid"
}
```

**Workflow:**
1. Admin picks compound + target audience
2. RAG search pulls top-N evidence sources (Phase 60)
3. Admin drafts schedule with AI-assist suggesting safe escalation curves
4. Reviewer admin approves (2-person rule)
5. Publish → propagates to clinicians + patient app
6. Versioning: edits create new draft, previous version stays at `published` until new version approved

## Insights & Research Engine scope (Phase 62)

**Data sources** (already populated by v1.3):
- Dose logs (Phase 1+)
- Body metrics (weight, BMI, body comp)
- Symptoms (mood, GI, sleep)
- Retention curves (Phase 51 traffic + P34 activation event)
- Gamification engagement (Phase 35 XP/streaks)
- AI coach interactions (Phase 38 — opt-in only per AI privacy)
- Helpdesk tickets (Phase 37 — categorical only, no free text)
- Community engagement (Phase 44/45 — aggregate only)

**Anonymization:**
- K-anonymity (k≥5) on all aggregate rollups
- Differential privacy noise injection for cohorts < 50
- No user_id, email, phone, address ever in research outputs
- Date binning to week-level for most metrics (no day-level)
- IRB-like internal review gate before any public-facing research output

**Outputs:**
- **Admin research dashboard:** interactive cohort builder + cross-tab + retention curves; admin-only
- **White-paper publishing pipeline:** template-driven PDF + HTML; markdown source under version control; reviewer approval workflow; SEO-optimized published version
- **Public blog:** opt-in publishing (admin-curated) with social share + RSS
- **RAG feedback loop:** published white papers become Phase 60 RAG primary-research evidence (closing the loop)

**Compliance:**
- HIPAA: aggregate data only, no PHI; explicit user opt-in for AI-coach data inclusion
- IRB-equivalent: 2-person admin review before any public output
- Honor revoke-consent → user data dropped from all future rollups within 30 days

## Phase numbering notes

- **No `--reset-phase-numbers`** — continue 52..N from v1.3's last phase (51).
- Phase 50 stays at its existing number; Phase 59 is the **resume marker** for Waves 2-4 (per `feedback_summary_forward_effects_section`, Phase 59 SUMMARY should reference Phase 50's CARRY-OVER + the kept-in-place phase dir).
