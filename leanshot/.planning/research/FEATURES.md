# Feature Research

**Domain:** GLP-1 / peptide-tracking SaaS with doctor read-share + clinical-coach B2B
**Researched:** 2026-05-10
**Confidence:** MEDIUM-HIGH (high on competitor feature set + RPM patterns; medium on doctor-share UX since most consumer GLP-1 trackers ship PDF only)

## Scope of This Research

LeanShot v2 already implements: injection logging with site rotation, drug-level pharmacology projection (28-day past + 7-day projection), body/weight/photo tracking, nutrition (incl. protein), activity, supplements, mood, sleep, symptoms, rule-based insights, AI coach (BYO Anthropic key), printable doctor report, share cards, streaks, onboarding, guided tour. v2 is **already ahead of the consumer GLP-1 tracker market on tracking surface area** — most competitors don't have this many surfaces.

This research is scoped to the **v1 launch milestone**: accounts + cloud sync, doctor read-share (link-based or invite-based), clinic/coach B2B (organization with multiple patients, roster + drill-in). It deliberately does **not** re-research v2's tracking features.

The categories below are organized by **audience**:

- **PATIENT** — the GLP-1 user (B2C)
- **DOCTOR** — a clinician viewing one patient's data via a share link
- **CLINIC** — a coach/clinic operator managing multiple patients via an organization workspace

## Feature Landscape

### Table Stakes (Users Expect These)

#### PATIENT — Auth + Cloud Sync (the v1 net-new layer)

| Feature | Why Expected | Complexity | Notes / Audience |
|---------|--------------|------------|-------|
| Email/password signup + login | Every cloud SaaS has it; required for cross-device sync | MEDIUM | PATIENT. Must support magic link or OAuth (Google/Apple) for low-friction onboarding — non-technical audience, password fatigue is real. |
| Cloud sync across devices | Users assume "I logged on my phone, I see it on my laptop." Top complaint of any local-only app once they have multiple devices. | HIGH | PATIENT. Must keep local-first behavior intact (offline = still works, syncs when online). Conflict-resolution rules needed for the rare concurrent-edit case. |
| Local-only → account migration | Existing v2 users in `leanshot_v4` must not lose their data when they sign up | MEDIUM | PATIENT. One-shot import on first sign-in. Test path matters — losing weight history would be catastrophic. |
| Password reset / email verification | Standard auth hygiene | LOW | PATIENT. |
| Account deletion (GDPR/CCPA) | Legal in EU/CA; ethical everywhere; users on GLP-1s are sensitive about health data | LOW | PATIENT. Must hard-delete, not soft-delete. Disclose retention period. |
| Data export (JSON/CSV) | Pre-existing in v2 settings; cloud version must preserve it | LOW | PATIENT. Right-of-portability under GDPR; also lets paranoid users feel ownership. |
| Sign out from all devices | Standard for any account-bound product | LOW | PATIENT. |
| Privacy policy + terms of service | Required by Apple/Google app stores, by GDPR, by FTC for health apps | LOW | PATIENT. Health-data context elevates the bar (see PITFALLS.md). |
| Medical disclaimer | "Not medical advice" — required of any tracker that displays clinical math | LOW | PATIENT. Already in `PROJECT.md` PROD-06. Must appear before the first injection log, not buried in settings. |

#### PATIENT — Tracking parity with v2 baseline

These are already built in v2. Listed here to note they are table stakes — losing any one in the cloud migration would feel like a regression.

| Feature | Source | Audience |
|---------|--------|----------|
| Injection log with site rotation + next-site nudge | `MedicationTab.tsx`, `SiteRotationCard.tsx` | PATIENT |
| Drug-level curve (28-day past + 7-day projection) | `MedLevelChart.tsx`, `pharmacology.ts` | PATIENT |
| Weight + photo tracking with comparison | `BodyTab.tsx`, `PhotoCompareModal.tsx` | PATIENT |
| Nutrition (protein-first), activity, supplements, mood, sleep, symptoms | `tabs/*.tsx` | PATIENT |
| Rule-based daily focus + insights | `insights.ts` | PATIENT |
| Streaks + share cards | `StreaksCard.tsx`, `ShareCardModal.tsx` | PATIENT |
| Printable doctor report (PDF surface) | `DoctorReport.tsx` | PATIENT |
| AI coach (BYO key) | `AIChatPanel.tsx`, `ai.ts` | PATIENT |

#### DOCTOR — Read-share view (the v1 net-new B2C-to-clinician handoff)

What other GLP-1 trackers do today: **Shotsy, Pep, Glapp, MeAgain, etc. ship a PDF export, period.** None of them ship a hosted live view that a doctor can open from a link. Mochi/Found/Sequence have provider portals because they're full-stack telehealth — but that bundles prescription, which LeanShot deliberately doesn't do. So LeanShot has an opening to be the first GLP-1 tracker with a real shareable live link surface — with **Epic's "Share Everywhere"** as the prior-art template (one-time code, time-bound, browser-only, no signup).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Read-only access to patient's full timeline | If a patient hands a doctor a link expecting them to "see everything," missing data feels broken | MEDIUM | DOCTOR. Mirror the printable report PLUS the live curves. Use existing `DoctorReport.tsx` content as the floor. |
| Time-bound share (expiry) | Doctors don't need indefinite access; patients need control | LOW | DOCTOR. Default 30/60/90 days. Patient can revoke at any time. |
| Patient can revoke at any time | Standard of any share link | LOW | PATIENT (control of their data). |
| Doctor sees scope clearly: which patient, which window, when revoked | Avoid confusion about whose data is on screen | LOW | DOCTOR. Header bar "Viewing [Patient Name] — shared 2026-04-12, expires 2026-07-12, read-only." |
| Print-friendly version of the doctor view | Many doctors will print before or instead of using the live view; v2 already has the PDF | LOW | DOCTOR. Reuse the existing `DoctorReport.tsx` print mode. |
| Clear "this is a snapshot, not an EHR" disclaimer | Compliance + sets expectations | LOW | DOCTOR. Avoids false-EHR positioning. |
| No signup required for the doctor (or 30-second optional account) | Doctor acquisition is hard. If sharing requires the doctor to sign up, share-rate collapses. Apple Health and Epic both got this right with code + DOB pattern. | MEDIUM | DOCTOR. Recommended path: link + access code (numeric) emailed/SMSed by patient. Doctor enters code in browser, sees data. Optional persistent account if they want to bookmark patients. |

#### CLINIC — Organization workspace (the v1 net-new B2B layer)

What clinical-coach platforms (Healthie, CoachCare, Withings RPM, AdvancedMD) typically expose. These are mature ecosystem patterns — anything missing from this list will feel "cheap" to a coach considering LeanShot for their practice.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Create org / clinic workspace at signup | The unit of multi-tenancy; every B2B SaaS does this | MEDIUM | CLINIC. Org name, branding (logo at minimum), timezone. |
| Invite operators by email | Onboarding the second person on the team is the test of multi-tenancy | LOW | CLINIC. Email invite with token; expires. |
| Roles: Owner / Admin / Coach / View-only | Coaches don't need to manage billing; admins shouldn't have to see clinical data if they're operations-only | MEDIUM | CLINIC. Minimum 3 roles for v1 (Owner, Coach, Viewer). Can expand later. |
| Invite patients to org by email | The other half of the workspace. Patient accepts → their account is linked to the org. | MEDIUM | CLINIC + PATIENT. Patient consent is the load-bearing UX — they have to opt in to sharing their data with the org. |
| Patient roster (list view) with at-a-glance status | Coaches manage 20-200 patients; need to triage who needs attention | MEDIUM | CLINIC. Per-patient row: name, current med + dose, last log, recent symptom severity, weight trend arrow, days-since-last-injection. Sortable + searchable. |
| Drill-in to one patient's data | Same surface the patient sees, plus possibly a clinical-flavored layout | MEDIUM | CLINIC. Reuse the doctor-share view for v1. Customize later if coaches actually ask. |
| Audit log of org actions | "Who viewed patient X when, who invited Y" — required for any clinic claiming HIPAA-adjacent posture; expected by enterprise buyers | MEDIUM | CLINIC. Tenant-scoped audit log. Persisted append-only. |
| Patient can leave the org at any time | Patient-control parity with the doctor-share | LOW | PATIENT. Org loses access; patient's own data stays intact. |
| Org can suspend / remove a patient | Inverse of leave; org outgrew the patient or vice-versa | LOW | CLINIC. |
| Per-org branded log-in / patient invitation page (light) | Coaches care a lot about how their patients perceive the tools they use | LOW-MEDIUM | CLINIC. Logo + name on the invitation email and on the first sign-up screen. Avoid full-tenant-domain CNAME for v1 — overkill. |

### Differentiators (Where LeanShot Wins)

LeanShot's existing v2 already differentiates on three axes: **drug-level projection, site-rotation hygiene, and the printable doctor report**. The v1 milestone unlocks two more: **live doctor-share** (none of the consumer GLP-1 trackers have this) and **AI coach with patient context** (most apps either skip this or do shallow chat).

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live doctor-share view (link + access code, no doctor signup) | All major consumer GLP-1 trackers (Shotsy, Pep, Glapp, MeAgain) ship PDF only. A live, interactive, evergreen view is a real differentiator. | MEDIUM | DOCTOR. Pattern modeled on Epic's "Share Everywhere" — one-time access code + DOB or numeric secondary factor, time-bound, browser-only. Already has the content layer (the v2 dashboard surfaces). |
| Drug-level pharmacology curve in the doctor-share view | Doctors who treat GLP-1s are interested in PK timing; almost no consumer apps surface it credibly. v2's `pharmacology.ts` is already implemented — exposing it to the doctor is differentiation that competitors can't catch up on without their own PK engine. | LOW | DOCTOR. Already-built logic, just plumb to the new surface. **Caveat:** the prior-art article (glp1effect.com) is critical of how oversimplified consumer PK charts are — LeanShot should ship with the existing-trial-data overlay (`TRIAL_DATA` in `pharmacology.ts`) and a "this is an average-person model, not a personal PK measurement" caveat. See PITFALLS.md. |
| Site-rotation hygiene with anatomical visualization | Some apps (Shotsy, Pep) track sites but treat it as a list. Visualizing the body diagram and warning about repeated sites is a hygiene-and-trust feature that doctors will appreciate. | LOW | PATIENT + DOCTOR. v2 has `SiteRotationCard.tsx` already. Surface it in the doctor view too. |
| AI coach with cloud-side proxy + per-org configuration | v2's BYO key works for hobbyist patients; for clinics, a hosted proxy (clinic provides the OpenAI/Anthropic budget, patients in the org get coaching for free) is a meaningful B2B feature. | HIGH | CLINIC + PATIENT. Bigger ROI for clinics than for patients (clinics see scaled value). Solves the BYO-key UX problem from PROD-05. |
| Roster view with "needs-attention" intelligence | Bare roster lists exist everywhere (CoachCare, Healthie). Differentiation: rank patients by computed urgency (missed-dose × symptom-severity × weight-trend × streak-break). Built on the same insights engine that powers the patient's own focus card. | MEDIUM | CLINIC. Reuse `pickFocus(state)` and `generateInsights(state)` from `insights.ts`, but as a **prioritization function** instead of a single-user output. |
| Coach-authored notes on a patient (private to the org) | Healthie has this. CoachCare implies it. Adds value for coaches without crossing into provider-messaging territory. | LOW-MEDIUM | CLINIC. Note attached to a patient, visible to the org only, not to the patient by default. Optional "share note with patient" toggle if requested later. |
| One-click sharable progress card for community | v2 already has `ShareCardModal.tsx` — extending to "share to my coach" or "share to my care group" is a small feature with high engagement value. | LOW | PATIENT + CLINIC. |
| Per-patient compliance/data-stewardship summary in the roster | "Last sync: 4h ago. Sharing: enabled. Plan: Wegovy 1.7mg." — the kind of operational detail that signals the platform is serious. | LOW | CLINIC. |
| Webhook / outbound API for coach automation (optional) | CoachCare-tier integrations. Lets coaches plug LeanShot into their CRM/email flow. | MEDIUM | CLINIC. Defer to v1.1 unless a buyer demands it; nice-to-have. |
| Rich "muscle preservation" coaching in the AI coach | WeightWatchers' 2026 GLP-1 program built a whole pillar around this. v2 has protein tracking; the AI coach already has context. Need to wire the coaching prompts. | LOW | PATIENT. Marketing differentiator more than engineering effort. |

### Anti-Features (Commonly Requested, Often Problematic)

These are tempting features that LeanShot should **deliberately not build** in v1, with explicit alternatives.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Doctor-to-patient direct messaging | "It would be great if the doctor could ping the patient with advice." | The moment the platform brokers two-way clinical messages, it functions like a portal of a covered entity, and HIPAA business-associate exposure becomes much more likely. The FTC also takes a hard look at health-app messaging. v1 doesn't have HIPAA infrastructure; opening this door triggers the whole stack (BAAs, encryption-at-rest audits, breach notification). | DOCTOR can leave a private "note to self" attached to a patient (org-only, doctor-side). PATIENT messaging stays inside the AI coach for v1. If clinics demand provider-messaging in v1.x, treat as a separate feature with its own compliance review. |
| Direct EHR / FHIR / Epic integration | "If we synced into Epic, every patient could share with one click." | Massive integration project (HL7, FHIR R4 mapping, Epic App Orchard onboarding, ~6 month minimum for a real implementation). Each EHR vendor is a separate project. Already explicitly out of scope in PROJECT.md. | The doctor-share link IS the integration surface for v1. PDF/print compatibility for legacy EHR copy-paste workflows. Defer real EHR integration until LeanShot has > 1000 patients across > 10 clinics. |
| Live video calls / telehealth visits | "Mochi Health does it; CoachCare does it; we should too." | Pulls LeanShot from "tracker + report" into "virtual care" — different product, different compliance posture (HIPAA covered entity definition ramps up), different team (prescribers, dieticians on staff). Not the company we're trying to build. | Coach can use their existing video tool (Doxy, Zoom for Healthcare, Healthie's built-in). LeanShot stays focused on the data layer. |
| Prescription writing or medication ordering | Feature parity with telehealth competitors. | Triggers DEA, FDA, state medical board, pharmacy regulation — entire universe of compliance that's incompatible with v1's "free, ship fast" thesis. Already explicitly out of scope. | Patient brings a real prescription from their real doctor; LeanShot tracks adherence to it. |
| Public social feed / community posts | "Like Strava for GLP-1." | Community moderation is a dedicated team. PHI accidentally posted in public feed = mass-disclosure event. Health-stigma + body-image concerns make it a moderation nightmare. Found Health attempted community; complaints about content policing. | Per-clinic group spaces (private, moderated by the coach) — defer to v1.1+ if clinics ask. Share cards (already in v2) are the user's outlet for community sharing on platforms they already use. |
| Behavioral coaching prescriptions ("eat more vegetables today") | Apps from 2018-2022 leaned hard on this. | A direct quote from search results: "Behavioral coaching rarely comes up as something Redditors value; most users in these communities are information-rich and self-directed." GLP-1 audiences specifically opt out of paternalistic coaching apps. | AI coach answers user-initiated questions (current pattern). Insights are observational ("you've missed 3 protein days this week") not prescriptive ("you SHOULD eat more protein"). |
| Real-time everything (websockets for cross-device live updates) | "Slack-like real-time." | Tracker data isn't conversational. Real-time adds latency-budget pressure, infrastructure cost, and offline-sync complexity. v2's pull-on-focus pattern is sufficient. | Sync on app open, on log submission, and on a debounced background timer. Local-first remains intact; cloud is the eventually-consistent fallback. |
| Granular per-data-type sharing controls in the doctor share | "Patient should choose to share weight but not symptoms." | In practice, patients hand the link over and the doctor wants the whole picture. Granular controls become a UX paper-cut and a source of misunderstanding (doctor sees a partial picture and misdiagnoses). Apple Health offers granular sharing and the result is mostly "select all." | Single binary toggle: share or don't. If a patient genuinely wants partial-share, they print a redacted PDF — defer to a v1.x feature only if real users ask. |
| Native iOS/Android apps | "We need to be in the App Store." | Native cost is disproportionate for a launch where audience-fit is still being validated. Already explicitly out of scope in PROJECT.md. | PWA install. Add-to-home-screen UX is good enough on iOS 18+ and Android 14+; most v2 surfaces are mobile-friendly already. |
| Per-tenant custom domain (CNAME) for white-labeling | "Big-clinic buyer wants `tracker.bigclinic.com`." | Custom-domain TLS, certificate management, DNS support burden. ROI doesn't appear until enterprise tier with seat count > 50. | Org logo + name on the patient invitation page and report header. Defer custom domain until a paid enterprise tier exists. |
| Self-serve billing / Stripe integration | "Standard for SaaS." | Already explicitly out of scope (no payments in v1). | Free for everyone in v1. Treat billing as a v2-milestone scope. |
| Symptom severity AI auto-flagging ("call your doctor now") | Useful in theory; lifesaving in worst case. | Crosses into clinical decision support, which is FDA-regulated medical device territory in 2026 (recent FDA guidance has tightened on AI clinical advice). Even a generic "consult your doctor" pop-up tied to specific data values risks regulation. | Generic "if you feel unwell, talk to your doctor" disclaimer + a prominent contact-doctor CTA, not data-driven. Symptom history visible in doctor share — let the human doctor make the clinical decision. |
| Connected scale / wearable integration on web | "Withings, Apple Health, Fitbit." | Web app can't natively read HealthKit; would require a companion native app or cumbersome OAuth flow per vendor. Withings has a developer API but it's per-user OAuth. Adds a whole integrations team for a single launch. | Manual weight entry (already in v2). Defer device integrations to v1.1 once one vendor demand is dominant. The most-requested integration based on Reddit threads is Apple Health → if iPhone PWA can read HealthKit through web-equivalent APIs by mid-2026, revisit. |

## Feature Dependencies

```text
[Cloud sync (SYNC-01)]
    ├──requires──> [Auth (AUTH-01)]
    │                  └──requires──> [Hosted backend + DB]
    │
    ├──enables──> [Doctor read-share (SHARE-01, SHARE-02)]
    │                  ├──enables──> [Audit log of who viewed what]
    │                  └──depends-on──> [Per-share access control]
    │
    └──enables──> [Clinic org (CLINIC-01, CLINIC-02, CLINIC-03)]
                       ├──requires──> [Multi-tenant data model]
                       ├──requires──> [Invite + token system]
                       ├──requires──> [Roles + permissions]
                       └──enables──> [Roster + drill-in]

[Local-only → account migration (SYNC-02)]
    ├──requires──> [Auth (AUTH-01)]
    └──requires──> [Cloud sync (SYNC-01)]

[AI coach per-org proxy (differentiator)]
    ├──requires──> [Hosted backend (from Auth)]
    ├──requires──> [Org workspace (CLINIC-01)]
    └──conflicts-with──> [BYO-key model (v2 default)]
                              └── must coexist via opt-in per-org override

[Drug-level curve in doctor view]
    └──reuses──> [v2 pharmacology.ts] (no new logic, just plumbing)

[Roster "needs attention" ranking]
    └──reuses──> [v2 insights.ts] but invoked per-patient across the org
```

### Dependency Notes

- **Auth (AUTH-01) is on the critical path for everything net-new.** Cloud sync, doctor share, and clinic org all depend on it. Build it first.
- **Multi-tenant data model gates clinic features.** A patient must be addressable as `(orgId?, userId)` from day one — retrofitting org scoping into a single-tenant schema is painful. Do the multi-tenant design even if v1 ships only the patient surface first.
- **Doctor share and clinic drill-in share the same view.** Build the read-only patient view once; both surfaces consume it. Differentiate by the entry point (single-link doctor vs. logged-in clinic operator) and by the chrome (org-context bar for the clinic surface).
- **AI coach proxy conflicts with v2's BYO model.** Resolve via per-org opt-in: if you're a patient in an org that has provisioned a key, you use the org's; otherwise you fall back to BYO or no-AI. Decision deferred per PROJECT.md Key Decisions.
- **Roster intelligence reuses, doesn't duplicate, the insights engine.** `pickFocus(state)` is currently a single-user function returning a single focus item. For roster, we want a `rankPatients(orgState)` that returns an ordered list. Same rules, batched.

## MVP Definition

### Launch With (v1)

Minimum viable product — enough to claim "multi-audience SaaS" and start collecting real signal from each audience.

**Production readiness (PROD-01 through PROD-06):**

- [ ] App publicly accessible at HTTPS domain
- [ ] Error tracking (Sentry or similar)
- [ ] Privacy-respectful product analytics
- [ ] Pharmacology + insights engines have automated tests
- [ ] Anthropic key handling decided (proxy vs disclosed BYO)
- [ ] Medical disclaimer + data-storage explanation visible before first log

**Auth + Cloud Sync (AUTH-01, SYNC-01, SYNC-02):**

- [ ] Email/password OR magic link OR OAuth (one of the three; pick the lightest)
- [ ] Cloud sync that preserves local-first behavior
- [ ] Existing-localStorage migration on first sign-in
- [ ] Sign out, password reset, account deletion
- [ ] Privacy policy + ToS

**Doctor Read-Share (SHARE-01, SHARE-02):**

- [ ] Patient can generate a share link with access code
- [ ] Doctor opens link + enters code → sees the read-only data view (mirror of `DoctorReport.tsx` content + live charts)
- [ ] Time-bound (default 90 days), patient-revocable
- [ ] Header shows scope + expiry + read-only banner
- [ ] Print-friendly version (reuse v2's `DoctorReport.tsx`)

**Clinic Org B2B (CLINIC-01, CLINIC-02, CLINIC-03):**

- [ ] Org signup + branding (logo, name)
- [ ] Invite operators (Owner / Coach / View-only — three roles)
- [ ] Invite patients by email; patient consents
- [ ] Roster view with sortable status (last log, weight trend, recent symptoms, days since last injection)
- [ ] "Needs attention" ranking (`rankPatients` function reusing `insights.ts`)
- [ ] Drill-in to a single patient → reuse the read-only patient view
- [ ] Audit log of org actions (who viewed which patient when)

**Note on what's NOT in MVP launch:**
- AI coach proxy (defer to v1.1; v2 BYO continues to work for patients in the meantime)
- Coach-authored notes on patients (defer to v1.1; coaches can use their existing tools)
- Webhook/outbound API (defer indefinitely; only build if a buyer asks)

### Add After Validation (v1.x)

Features to add once core launch is working and signal is clear.

- [ ] **AI coach hosted proxy with per-org provisioning** — v2 BYO is a real UX rough edge for clinics. Trigger: first clinic asking for "we want to provide AI to all our patients."
- [ ] **Coach-authored private notes on patients** — Trigger: coaches asking for "I want to remember this patient is allergic to X."
- [ ] **Custom symptom list per patient** — Reddit feedback from competitors: users want to add custom symptoms. v2 has a fixed list. Trigger: > 3 unique requests for a missing symptom.
- [ ] **Menstrual cycle tracking** — Repeatedly requested across competitor reviews. Out of scope for v1 since it's a separate logging surface. Trigger: signal from the patient cohort that cycle context affects GLP-1 efficacy.
- [ ] **Apple Health import (iOS PWA)** — Top integration request in Reddit threads. Defer to v1.1 to see if PWA HealthKit access matures. Trigger: Apple ships a usable web-side HealthKit bridge OR enough patients ask.
- [ ] **Withings / connected scale OAuth** — Trigger: > 5% of patients manually entering > 30 weights/month (signal that they have a connected scale and want to skip manual entry).
- [ ] **Per-org AI prompt customization** — Clinics will eventually want their AI coach to reflect their care philosophy. Trigger: first paying clinic asks.
- [ ] **Branded patient invitation pages with org logo** — Already in MVP at minimum-viable level (logo + name); enhance to a full marketing landing per org if buyers ask.
- [ ] **In-app cohort comparisons** — Glapp surfaces "comparison to clinical trial data." Compelling marketing feature. Trigger: enough usage data to justify cohort definitions.

### Future Consideration (v2+)

Features to defer until product-market fit is established, possibly forever.

- [ ] **Native mobile apps** — Stay in PWA until iOS PWA APIs become a real bottleneck.
- [ ] **EHR / FHIR integration** — Only after > 1000 patients across > 10 clinics, and only with a dedicated integrations engineer.
- [ ] **Per-tenant custom domain (CNAME)** — Only at enterprise tier with paid plans.
- [ ] **Patient → coach messaging** — High compliance overhead. Defer until LeanShot has BAAs with covered entities and a HIPAA security program.
- [ ] **Group programs / cohorts** — Defer until clinics ask for it. CoachCare-tier feature.
- [ ] **Stripe billing / paid plans** — Out of scope for v1 by explicit decision in PROJECT.md. Later milestone.
- [ ] **Non-GLP-1 peptides (BPC-157, growth hormone, etc.)** — Out of scope for v1 by explicit decision. Each new peptide class needs its own pharmacology + safety-disclosure content.
- [ ] **FDA-regulated clinical decision support** — Almost certainly anti-feature for an indefinite period.

## Feature Prioritization Matrix

Priority for v1 milestone scope. (P1 = must have for v1 launch, P2 = should have for v1, P3 = nice to have, defer to v1.x.)

| Feature | Audience | User Value | Implementation Cost | Priority |
|---------|----------|------------|---------------------|----------|
| Auth (email/password OR magic link) | PATIENT | HIGH | MEDIUM | P1 |
| Cloud sync (local-first preserved) | PATIENT | HIGH | HIGH | P1 |
| localStorage migration on signup | PATIENT | HIGH | MEDIUM | P1 |
| Account deletion (GDPR) | PATIENT | MEDIUM (legal) | LOW | P1 |
| Privacy policy + ToS + medical disclaimer | PATIENT | MEDIUM (legal) | LOW | P1 |
| Sentry / error tracking (PROD-02) | PATIENT (indirect) | HIGH | LOW | P1 |
| Pharmacology + insights tests (PROD-04) | PATIENT (clinical safety) | HIGH | MEDIUM | P1 |
| AI key hardening (PROD-05) | PATIENT | MEDIUM | MEDIUM | P1 |
| Doctor share link with access code | PATIENT + DOCTOR | HIGH | MEDIUM | P1 |
| Doctor read-only view (live + print) | DOCTOR | HIGH | MEDIUM | P1 |
| Time-bound + revocable share | PATIENT | MEDIUM | LOW | P1 |
| Org signup + branding | CLINIC | HIGH | MEDIUM | P1 |
| Invite operators with 3 roles | CLINIC | HIGH | MEDIUM | P1 |
| Invite patients with consent flow | CLINIC + PATIENT | HIGH | MEDIUM | P1 |
| Roster view with sortable status | CLINIC | HIGH | MEDIUM | P1 |
| "Needs attention" ranking | CLINIC | HIGH | LOW (reuses insights.ts) | P1 |
| Drill-in to single patient (reuse doctor view) | CLINIC | HIGH | LOW (reuses doctor view) | P1 |
| Tenant-scoped audit log | CLINIC | MEDIUM (compliance) | MEDIUM | P1 |
| OAuth (Google/Apple) | PATIENT | MEDIUM | MEDIUM | P2 |
| AI coach hosted proxy | PATIENT + CLINIC | HIGH (clinic) | HIGH | P2 |
| Coach-authored private notes | CLINIC | MEDIUM | LOW | P2 |
| Per-org AI prompt customization | CLINIC | MEDIUM | LOW | P3 |
| Webhook / outbound API | CLINIC | LOW (until asked) | MEDIUM | P3 |
| Custom symptom list | PATIENT | MEDIUM | LOW | P3 |
| Apple Health import (PWA) | PATIENT | HIGH | HIGH (depends on platform) | P3 |
| Connected scale OAuth | PATIENT | MEDIUM | MEDIUM | P3 |
| Group programs | CLINIC | LOW (until asked) | HIGH | P3 |
| Custom domain CNAME | CLINIC | LOW (until enterprise) | HIGH | P3 |

**Priority key:**
- **P1** — Must ship in v1 launch.
- **P2** — Should ship in v1 if scope allows; otherwise first thing in v1.x.
- **P3** — Nice to have, defer indefinitely until real signal.

## Competitor Feature Analysis

Comparison of LeanShot v1 (proposed) to representative competitors. Asterisks (*) indicate features that the v2 codebase already implements.

| Feature | Shotsy (consumer) | Glapp (consumer) | MeAgain (consumer) | Mochi Health (full telehealth) | Healthie (B2B EHR) | LeanShot v1 |
|---------|-------------------|------------------|---------------------|-------------------------------|--------------------|--------------------|
| Injection logging + site rotation | Yes | Yes | Yes | Yes (in-app) | No (it's an EHR) | Yes* |
| Drug-level / PK projection | Yes (criticized as oversimplified) | Yes | Yes | Limited | No | Yes* (with `TRIAL_DATA` overlay + caveat) |
| Photo progress | No | No | Yes | Yes | Yes (food photos) | Yes* |
| Side-effect tracking | Yes | Yes (per-cycle pattern) | Yes | Yes | Yes | Yes* |
| Nutrition (protein-first) | Limited | No | Yes (focus area) | Yes | Yes (food log) | Yes* |
| AI coach | No | No | Yes ("Capy") | Limited | No | Yes* (BYO key v2; proxy in v1.1) |
| Doctor PDF report | Yes | Limited | Yes (reports) | N/A (single-tenant) | Yes (clinical notes) | Yes* |
| **Live doctor share link** | **No** | **No** | **No** | **No (proprietary portal)** | **N/A (provider-side)** | **Yes (v1 P1)** |
| Doctor scoped read-only view | No | No | No | No (telehealth model) | Yes (provider EHR) | Yes (v1 P1) |
| Cloud sync across devices | Yes | Yes | Yes | Yes | Yes | **Yes (v1 P1, net-new)** |
| Multi-tenant org / clinic workspace | No | No | No | No (single-tenant DTC) | Yes (full B2B) | **Yes (v1 P1, net-new)** |
| Patient roster for coach | No | No | No | No | Yes | **Yes (v1 P1)** |
| "Needs attention" intelligence | No | No | No | No | Limited | **Yes (v1 P1, differentiator)** |
| Real-time provider messaging | No | No | No | Yes (paid telehealth) | Yes | **No (anti-feature)** |
| Telehealth video visits | No | No | No | Yes | Yes | **No (anti-feature)** |
| Prescription / refill management | No | No | No | Yes | Yes | **No (anti-feature)** |
| EHR / FHIR integration | No | No | No | Internal only | Limited | **No (anti-feature for v1)** |
| Native mobile app | Yes (iOS) | Yes (iOS) + web | Yes | Yes | Yes | **No (PWA only)** |
| Pricing | Free (premium tier) | Free | Free | $79-$249/mo | Tiered B2B | Free (v1) |

**Strategic read:**
- **vs. consumer trackers (Shotsy, Glapp, MeAgain):** LeanShot already wins on tracking surface area. v1 adds doctor-share + clinic B2B that none of them have, opening a new category.
- **vs. full-stack telehealth (Mochi, Found, Sequence/WW):** LeanShot deliberately doesn't compete on prescription/video/messaging. The thesis is "the data layer your doctor and your tracker share, regardless of who prescribed."
- **vs. EHR-grade B2B (Healthie, CoachCare):** LeanShot doesn't compete on EHR feature breadth (billing, scheduling, video, charting, full clinical notes). The thesis is "the GLP-1-specific tracker that plugs into a coach's existing stack."

**The unique slot LeanShot occupies:** GLP-1-specialist, free for patients, with a real live doctor-share, that coaches can use as a roster tool — without becoming a telehealth company. This is a slot **no one in the search results occupies today**.

## Sources

### Consumer GLP-1 trackers analyzed
- [6 Best GLP-1 Tracking Apps Compared (LearnMuscles, 2025)](https://learnmuscles.com/blog/2025/11/27/6-best-glp-1-tracking-apps-compared-which-app-actually-works-in-2026/)
- [13 Best Apps for Tracking Semaglutide Results (MeAgain, 2026)](https://meagain.com/blog/best-app-for-tracking-semaglutide-results)
- [Estimated Medication Level Charts in GLP-1 Tracking Apps (glp1effect.com)](https://glp1effect.com/p/are-glp-1-app-medication-charts-reliable)
- [Shotsy GLP-1 Tracker](https://shotsyapp.com/)
- [Pep GLP-1 Tracker](https://pepglp1.com/)
- [Glapp](https://glapp.io/)
- [MeAgain Best Shotsy Alternative](https://meagain.com/alternatives/shotsy)
- [Pep vs. Shotsy comparison](https://pepglp1.com/pep-vs-shotsy-which-glp-1-medication-tracking-app-reigns-supreme/)
- [maxbud: GLP-1 AI Tracker](https://apps.apple.com/us/app/maxbud-glp-1-ai-tracker/id6479300175)
- [GLP AI](https://glpai.app/)
- [Alnu Health](https://alnu.health/)
- [Dose AI](https://www.trydoseai.com/)

### Full-stack telehealth competitors
- [Mochi Health Review (Vaccine Alliance)](https://www.vaccinealliance.org/reviews/mochi-health/)
- [WeightWatchers 2026 GLP-1 Med+ Program (HIT Consultant)](https://hitconsultant.net/2025/12/17/weight-watchers-launches-new-glp-1-program-and-ai-app-features/)
- [WeightWatchers Sequence acquisition (Fierce Healthcare)](https://www.fiercehealthcare.com/digital-health/weightwatchers-acquisition-sequence-allows-expansion-remote-prescribing-hot-weight)
- [GLP-1 Telehealth Monitoring (Diabetes In Control)](https://www.diabetesincontrol.com/glp1-telehealth-monitoring/)

### B2B clinical-coach platforms
- [Healthie Health Coaching Platform](https://www.gethealthie.com/clinical-focus-health-coaching)
- [Healthie Patient Portal](https://www.gethealthie.com/patient-portal)
- [CoachCare Virtual Health Features](https://www.coachcare.com/virtual-health-features/)
- [CoachCare RPM for Weight Loss](https://www.coachcare.com/2024/12/24/remote-patient-monitoring-for-weight-loss-devices-applications-tips.html)
- [Withings Health Solutions RPM](https://withingshealthsolutions.com/rpm/)
- [Optimizing GLP-1 Therapy Through RPM (Prevounce)](https://blog.prevounce.com/optimizing-glp-1-therapy-through-remote-weight-monitoring)

### Doctor-share / data-sharing patterns
- [Epic Share Everywhere FAQ](https://shareeverywhere.epic.com/FAQ)
- [MyChart Sharing Your Medical Record](https://www.mychart.org/Sharing-Your-Medical-Record)
- [Apple Health Share with Provider FAQ](https://support.apple.com/guide/healthregister/health-app-data-share-with-provider-faq-apd531bc6215/web)

### Compliance + regulatory context
- [FTC: Collecting, Using, or Sharing Consumer Health Information](https://www.ftc.gov/business-guidance/resources/collecting-using-or-sharing-consumer-health-information-look-hipaa-ftc-act-health-breach)
- [HHS: Access Right, Health Apps & APIs](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html)
- [Digital Health Care Alert: Is Your Health Care App Subject to HIPAA? (Fenwick)](https://www.fenwick.com/insights/publications/digital-health-care-alert-is-your-health-care-app-subject-to-hipaa)

### Multi-tenant SaaS patterns
- [WorkOS: Developer's Guide to SaaS Multi-Tenant Architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)
- [Logto: Build a Multi-Tenant SaaS Application](https://blog.logto.io/build-multi-tenant-saas-application)
- [Clerk: Multi-Tenant Authentication](https://clerk.com/blog/multi-tenant-authentication-what-you-need-to-know)

### User feedback / community signal
- [Mumsnet Shotsy Graphs Discussion](https://www.mumsnet.com/talk/weight-loss-injections/5209828-share-your-shotsy-graphs-mounjaro)
- [Surprisingly Cool GLP-1 Tracker (glp1effect.com Glapp review)](https://glp1effect.com/p/surprisingly-cool-glp-1-phase-tracker-and-it-s-free)

---
*Feature research for: GLP-1 tracking SaaS — v1 launch milestone (cloud sync + doctor share + clinic B2B)*
*Researched: 2026-05-10*
