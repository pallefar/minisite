# Requirements: LeanShot

**Defined:** 2026-05-10
**Core Value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.

## v1 Requirements

Requirements for the v1 launch milestone — multi-audience SaaS (B2C patient + doctor read-share + clinic/coach B2B) shipping on top of the existing v2 codebase. Each maps to exactly one roadmap phase (filled in by `/gsd-plan-phase` later).

### Compliance

Pre-launch legal foundation. Surfaced by research as Phase-0 blocker — three concurrent regimes apply at v1 launch (FTC HBNR, WMHMDA, CMIA), HIPAA business-associate is path-dependent.

- [ ] **COMPL-01**: Privacy policy is published and references all data collected (injections, photos, weight, mood, symptoms, AI conversations) — drafted in consultation with legal counsel
- [x] **COMPL-02**: A WMHMDA-compliant consumer health data privacy (CHDP) policy is published and linked from app footer (Washington My Health My Data Act, in force March 2024, has private right of action)
- [x] **COMPL-03**: App is registered for FTC Health Breach Notification Rule (HBNR) compliance, with an incident-response plan documented
- [ ] **COMPL-04**: App displays prominent "Not medical advice — consult your healthcare provider" disclaimer on first run and overlaid on the drug-level chart, calibrated for FDA general-wellness software guidance
- [ ] **COMPL-05**: Marketing copy and in-app framing avoid mental-health treatment claims (Mood tab + AI coach) to keep the app outside CMIA's mental-health digital service definition
- [ ] **COMPL-06**: User can export all their data (JSON + readable PDF) and delete their account on demand — surfaced clearly in Settings

### Production Readiness

Take the existing v2 from "runs locally" to "publicly deployed and observable".

- [ ] **PROD-01**: App is deployed at a real custom domain over HTTPS — static SPA hosted on Vercel/Cloudflare Pages/Netlify (decision deferred to deploy phase)
- [ ] **PROD-02**: Real-user JS errors are captured by Sentry with PII redaction configured for symptom/mood/AI fields
- [ ] **PROD-03**: Privacy-respectful product analytics (PostHog cookieless mode) measure feature usage, onboarding drop-off, and core funnels — without leaking health content
- [ ] **PROD-04**: A test runner (Vitest 4 + React Testing Library + Playwright) is configured with `npm test` running in CI on every PR
- [ ] **PROD-05**: ESLint + Prettier + a typecheck step run in CI; the existing `tsc -b --noEmit` is wired to PR checks
- [ ] **PROD-06**: Marketing landing page (`Landing.tsx`) is hosted on a separate subdomain or path so health-app analytics and consents stay clean
- [x] **PROD-07**: Supabase cloud project provisioned, linked to repo, with Vercel env wiring and Anthropic API key as Function secret. Verified by `curl <function-url>/functions/v1/ai-chat` returning streamed Anthropic response. (Added Phase 4: orchestrator brief asked for "PROD-04" but that ID was already taken by the test-runner requirement; allocated a fresh ID here.)

### Auth

Single identity for cross-device + B2B access. **Backend platform: Supabase** (Postgres + Auth + Realtime + Storage + Edge Functions in one product — supersedes the research synthesis's Better Auth + Neon recommendation; rationale captured in PROJECT.md Key Decisions). Supabase Auth handles email/password and magic-link out of the box.

- [ ] **AUTH-01**: User can create an account with email + password using Supabase Auth
- [ ] **AUTH-02**: User receives an email verification on signup and cannot fully use the app until verified (Supabase confirmation flow)
- [ ] **AUTH-03**: User can sign in across devices and the session persists across browser refresh (Supabase session in localStorage with refresh-token rotation)
- [ ] **AUTH-04**: User can reset their password via emailed link (Supabase password reset)
- [ ] **AUTH-05**: User can sign out, and signing out clears local sensitive caches (sync queue, AI history)
- [ ] **AUTH-06**: User can continue to use the app fully offline once signed in (auth required only for cloud sync, not for local logging)

### Cloud Sync

Local-first preserved; cloud sync is additive. **Approach: Supabase Postgres tables + Realtime subscriptions, with the existing Zustand store as the local-first cache.** Mutations write through to Supabase; Realtime push replays updates from other devices into Zustand. IndexedDB queues writes when offline.

- [ ] **SYNC-01**: A signed-in user's tracked data (injections, weights, photos, meals, supplements, mood, sleep, symptoms, settings) syncs across their devices via Supabase
- [ ] **SYNC-02**: An existing local-only `leanshot_v4` user can sign in and have their localStorage data uploaded into their account on first sync, with no data loss
- [ ] **SYNC-03**: The pre-cloud `leanshot_v4` snapshot is preserved as `leanshot_v4_pre_cloud_backup` for at least 90 days post-migration so users can recover if migration fails (mitigates the lossy v3→v4 pattern flagged in CONCERNS.md)
- [ ] **SYNC-04**: Mutations made offline are queued in IndexedDB and replayed on reconnect; conflicts resolve last-writer-wins with a clear UI when collisions occur
- [ ] **SYNC-05**: All Supabase tables enforce per-user scoping via Row-Level Security policies (`auth.uid() = user_id`, default-deny) — RLS is the primary tenant-isolation primitive, not application-layer filtering
- [ ] **SYNC-06**: Photos move from base64-in-Zustand to Supabase Storage with signed URLs, keeping the Zustand-persisted slice lean (current photos slice is the largest contributor to localStorage size)

### AI Coach Hardening

Replace browser-direct Anthropic calls with a server proxy. Fixes plaintext-key-in-localStorage, the bogus hardcoded `claude-sonnet-4-6` model ID in `src/lib/ai.ts`, and adds rate-limiting + audit ownership. **Runtime: Supabase Edge Functions** (Deno) — same proxy pattern as the Cloudflare-Worker option in the research, but co-located with auth + DB.

- [x] **AI-01**: User no longer needs to paste an Anthropic key — AI coach calls go through a Supabase Edge Function (`/functions/v1/ai-chat`) that holds the platform key in Supabase secrets
- [x] **AI-02**: AI proxy enforces per-user rate limits (Anthropic spend cap) and short-circuits abusive patterns — counters stored in a Supabase table keyed by `auth.uid()`
- [x] **AI-03**: AI proxy refuses prompts that look like prompt-injection or that ask for specific dosing changes; refusal-list is covered by automated tests
- [x] **AI-04**: User-supplied content (symptom logs, notes) is structurally separated from system prompts inside the proxy so injection attacks via logged content cannot escalate
- [x] **AI-05**: AI conversation history is stored only in the user's own data (own table with RLS) — never included in doctor or clinic snapshots
- [x] **AI-06**: Proxy uses a real, current AI provider model ID (post-Phase-4 pivot: Moonshot `kimi-k2.6`, replaces the broken hardcoded `'claude-sonnet-4-5'` from v2 source; see `phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-ADDENDUM-MOONSHOT.md` for the model-provider switch from Anthropic Claude to Moonshot Kimi K2 mid-Phase-4)

### Pharmacology + Insights Hardening

Required before SHARE-01 ships, since the doctor will see the curve.

- [ ] **PK-01**: `src/lib/pharmacology.ts` (`calcMedLevel`, `HALF_LIVES`, `TITRATION`) is covered by an automated test corpus citing peer-reviewed sources (Schneck 2024 for tirzepatide PK; FDA clinical pharmacology reviews for semaglutide/liraglutide)
- [ ] **PK-02**: `src/lib/insights.ts` (`generateInsights`, `pickFocus`) is covered by automated tests including a refusal-list for any insight that could read as dose-change advice
- [ ] **PK-03**: The drug-level chart visually conveys uncertainty (shaded inter-individual variability band) rather than a single deterministic line
- [ ] **PK-04**: The chart and any printed/shared report carry an explicit "estimate, not measured serum level — based on population pharmacokinetics" disclaimer
- [ ] **PK-05**: The pharmacology engine version is recorded in saved data so a future v1.1 two-compartment upgrade can be applied retroactively without ambiguity

### Doctor Read-Share

The major differentiator vs Shotsy/Pep/Glapp/MeAgain. Patient-controlled link + access code, no doctor account required. Pattern after Epic Share Everywhere.

- [ ] **SHARE-01**: Patient can create a share link from Settings that grants a doctor read-only in-browser access to the patient's data, scoped to a time window the patient picks
- [ ] **SHARE-02**: Doctor opens the share link, enters a 6-digit access code (delivered out-of-band), and sees a read-only view of the patient's same data — including live drug-level chart, recent injections, symptoms, photos, weight, doctor report
- [ ] **SHARE-03**: AI conversation history is NEVER included in the doctor view (privacy guarantee)
- [ ] **SHARE-04**: Patient can revoke a share at any time and the doctor's open page becomes unusable within seconds — verified by an automated 4-failure-mode revocation drill (token cache, HTTP cache, JWT TTL, forwarded link)
- [ ] **SHARE-05**: All share-link reads are audit-logged and visible to the patient in Settings (which doctor, when, what)
- [ ] **SHARE-06**: Doctor view delivers `Cache-Control: private, no-store` and is bound to a recipient identifier so a forwarded link to a different device fails

### Clinic / Coach B2B

Multi-patient organization surface. Reuses the read-only patient view component built for SHARE. Supabase doesn't have a built-in organization primitive, so we model it with a `organizations` + `memberships` schema, enforced by RLS policies that join membership to data access.

- [ ] **CLINIC-01**: A clinic operator can sign up and create an organization workspace
- [ ] **CLINIC-02**: Clinic operator can invite a patient by email; an invited patient who already has a Supabase account can join the org without identity collision (one `auth.users` row + a `memberships` row per org, never duplicate user records)
- [ ] **CLINIC-03**: Patient must explicitly consent at the point of accepting a clinic invite, with the share scope visible (which fields, what window, can be revoked)
- [ ] **CLINIC-04**: Clinic operator sees a roster of all linked patients with at-a-glance status (recent dose, active streak, recent symptoms, missed-dose flag) — powered by running `pickFocus`/`generateInsights` per-patient as `rankPatients(orgState)`
- [ ] **CLINIC-05**: Clinic operator can drill into any one patient and see the same read-only view used by SHARE-02 (component reuse)
- [ ] **CLINIC-06**: Org has at least three roles: Owner, Coach (read+manage roster), View-only (read patient data)
- [ ] **CLINIC-07**: All clinic operator actions are audit-logged (which operator viewed which patient, when), surfaced to both patient and org owner

## v2 Requirements

Deferred to a future milestone. Tracked but not in v1 roadmap.

### Pharmacology

- **PK-V2-01**: Two-compartment PK model for tirzepatide (Schneck 2024 parameters) replaces single-compartment exponential decay — currently approximated within the uncertainty band

### Sharing

- **SHARE-V2-01**: Doctor accounts (lightweight) for repeat doctors, so a single login can access multiple patients who've shared with them
- **SHARE-V2-02**: Doctor can leave timestamped read-only annotations on a patient's data

### Clinic

- **CLINIC-V2-01**: Org billing + paid plans (separate monetization milestone)

### Integrations

- **INT-V2-01**: PWA HealthKit / Health Connect read-only integration when iOS PWA support lands
- **INT-V2-02**: Wearable connectors (Apple Health, Garmin, Whoop) once HealthKit is in
- **INT-V2-03**: Optional FHIR push-out (one-way) for clinics that want it

### AI

- **AI-V2-01**: Hosted AI coach for clinic-managed patients (the clinic's bill, not the patient's) — depends on a clinical buyer asking for it

### Observability

- **OBS-V2-01**: Synthetic monitoring + uptime SLO for the AI proxy and sync endpoints

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native iOS/Android apps | Web-only via PWA for v1; native costs disproportionately for an audience-discovery launch |
| Peptides outside the GLP-1 family (BPC-157, growth hormone, etc.) | Validate the GLP-1 funnel first; non-GLP-1 PK and clinical context is materially different |
| Direct EHR / clinical-system integration (HL7, FHIR push, Epic) | Major compliance + integration scope; gates fast shipping. Doctor surface is the LeanShot UI for v1 |
| Payments / paid plans / pricing tiers | v1 free across all audiences; monetization is a separate milestone informed by usage data |
| Provider-to-patient direct messaging | Pulls into HIPAA covered-entity territory immediately |
| Telehealth visits / video / prescription writing | Different product (LeanShot is not a telehealth company) |
| FDA-regulated clinical decision support | App stays inside FDA general-wellness boundary; PK chart shows estimate with disclaimer, never recommends a dose change |
| Public social feed / community comments | Out of scope for v1; introduces moderation + privacy concerns we don't want |
| Doctor signup as gating step for share | Forcing a doctor account collapses share-rate; the link + access code pattern is preferred |

## Traceability

Each v1 requirement maps to exactly one phase. Filled in by the roadmapper agent on 2026-05-10.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMPL-01 | Phase 7 — Compliance Foundations (Legal-Counsel-Led) | Pending |
| COMPL-02 | Phase 7 — Compliance Foundations (Legal-Counsel-Led) | Complete |
| COMPL-03 | Phase 7 — Compliance Foundations (Legal-Counsel-Led) | Complete |
| COMPL-04 | Phase 2 — Visible Compliance & Public Deploy | Pending |
| COMPL-05 | Phase 2 — Visible Compliance & Public Deploy | Pending |
| COMPL-06 | Phase 7 — Compliance Foundations (Legal-Counsel-Led) | Pending |
| PROD-01 | Phase 2 — Visible Compliance & Public Deploy | Pending |
| PROD-02 | Phase 1 — Quality Gates & Observability Foundation | Pending |
| PROD-03 | Phase 1 — Quality Gates & Observability Foundation | Pending |
| PROD-04 | Phase 1 — Quality Gates & Observability Foundation | Pending |
| PROD-05 | Phase 1 — Quality Gates & Observability Foundation | Pending |
| PROD-06 | Phase 2 — Visible Compliance & Public Deploy | Pending |
| PROD-07 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AUTH-01 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| AUTH-02 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| AUTH-03 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| AUTH-04 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| AUTH-05 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| AUTH-06 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| SYNC-01 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| SYNC-02 | Phase 6 — Patient Cloud Sync Slice 2 — Full Data + Migration + Photos | Pending |
| SYNC-03 | Phase 6 — Patient Cloud Sync Slice 2 — Full Data + Migration + Photos | Pending |
| SYNC-04 | Phase 6 — Patient Cloud Sync Slice 2 — Full Data + Migration + Photos | Pending |
| SYNC-05 | Phase 5 — Patient Cloud Sync Slice 1 — Auth + Injections | Pending |
| SYNC-06 | Phase 6 — Patient Cloud Sync Slice 2 — Full Data + Migration + Photos | Pending |
| AI-01 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AI-02 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AI-03 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AI-04 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AI-05 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| AI-06 | Phase 4 — AI Proxy on Supabase Edge Functions | Complete |
| PK-01 | Phase 3 — Pharmacology + Insights Hardening | Pending |
| PK-02 | Phase 3 — Pharmacology + Insights Hardening | Pending |
| PK-03 | Phase 3 — Pharmacology + Insights Hardening | Pending |
| PK-04 | Phase 3 — Pharmacology + Insights Hardening | Pending |
| PK-05 | Phase 3 — Pharmacology + Insights Hardening | Pending |
| SHARE-01 | Phase 8 — Doctor Read-Share | Pending |
| SHARE-02 | Phase 8 — Doctor Read-Share | Pending |
| SHARE-03 | Phase 8 — Doctor Read-Share | Pending |
| SHARE-04 | Phase 8 — Doctor Read-Share | Pending |
| SHARE-05 | Phase 8 — Doctor Read-Share | Pending |
| SHARE-06 | Phase 8 — Doctor Read-Share | Pending |
| CLINIC-01 | Phase 9 — Clinic B2B Foundations | Pending |
| CLINIC-02 | Phase 9 — Clinic B2B Foundations | Pending |
| CLINIC-03 | Phase 9 — Clinic B2B Foundations | Pending |
| CLINIC-04 | Phase 10 — Clinic Operator Surface | Pending |
| CLINIC-05 | Phase 10 — Clinic Operator Surface | Pending |
| CLINIC-06 | Phase 10 — Clinic Operator Surface | Pending |
| CLINIC-07 | Phase 10 — Clinic Operator Surface | Pending |

**Coverage:**
- v1 requirements: 49 total (PROD added one item for Phase 4 infra: COMPL 6 + PROD 7 + AUTH 6 + SYNC 6 + AI 6 + PK 5 + SHARE 6 + CLINIC 7)
- Mapped to phases: 49 ✓
- Unmapped: 0 ✓

**Per-phase summary:**

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1. Quality Gates & Observability Foundation | PROD-02, PROD-03, PROD-04, PROD-05 | 4 |
| 2. Visible Compliance & Public Deploy | COMPL-04, COMPL-05, PROD-01, PROD-06 | 4 |
| 3. Pharmacology + Insights Hardening | PK-01, PK-02, PK-03, PK-04, PK-05 | 5 |
| 4. AI Proxy on Supabase Edge Functions | AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, PROD-07 | 7 |
| 5. Patient Cloud Sync Slice 1 — Auth + Injections | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, SYNC-01, SYNC-05 | 8 |
| 6. Patient Cloud Sync Slice 2 — Full Data + Migration + Photos | SYNC-02, SYNC-03, SYNC-04, SYNC-06 | 4 |
| 7. Compliance Foundations (Legal-Counsel-Led) | COMPL-01, COMPL-02, COMPL-03, COMPL-06 | 4 |
| 8. Doctor Read-Share | SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06 | 6 |
| 9. Clinic B2B Foundations | CLINIC-01, CLINIC-02, CLINIC-03 | 3 |
| 10. Clinic Operator Surface | CLINIC-04, CLINIC-05, CLINIC-06, CLINIC-07 | 4 |
| **Total** | | **49** |

---
*Requirements defined: 2026-05-10*
*Last updated: 2026-05-11 — Phase 4 planner added PROD-07 (Supabase cloud bootstrap) per orchestrator brief; original brief specified "PROD-04" but that ID was already taken by the Phase 1 test-runner requirement.*
