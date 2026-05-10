# Project Research Summary

**Project:** LeanShot
**Domain:** Multi-audience health-adjacent SaaS — GLP-1 / peptide tracker layered with patient B2C, doctor read-share, and clinic B2B over an existing local-first React 19 SPA
**Researched:** 2026-05-10
**Confidence:** MEDIUM-HIGH

## Executive Summary

LeanShot v1 is a brownfield launch milestone. The v2 codebase already implements a richer tracking surface (drug-level pharmacology curve, site rotation, body/photos, nutrition, mood, AI coach, doctor PDF) than any competing consumer GLP-1 tracker — and v1 layers three net-new audiences (cloud-synced patient, doctor read-share, clinic roster) on top. Research strongly supports a **Cloudflare-first edge stack** (Hono on Workers + Neon Postgres + Drizzle + Cloudflare Pages for the existing Vite SPA) with a thin sync layer that preserves the existing Zustand-as-source-of-truth and adds an offline-first mutation queue. None of this requires rewriting v2; the cloud is opt-in scaffolding around it.

The research surfaces three architectural decisions worth holding still on early. **First, doctor share must be a stateless signed-token + DB-backed-revocation pattern, not a doctor account** — every consumer GLP-1 competitor ships PDF only because they couldn't solve doctor-onboarding friction; this is LeanShot's biggest differentiator and gets destroyed by a "create an account" wall. **Second, multi-tenancy must use Postgres RLS with `(tenant_id, user_id)` keys from day one** — January 2025's 170-Supabase-app exposure is the failure pattern, and the team will be spread across patient/doctor/clinic scopes from launch. **Third, the AI coach must move to a server proxy before SHARE-01 ships** — the BYO-key-in-localStorage pattern in v2 is the single largest open security item, and a doctor seeing AI output produced from a key any browser extension can read is a non-starter.

The dominant risks are regulatory and clinical, not technical. The FTC Health Breach Notification Rule (2024 amendments) almost certainly applies the moment LeanShot has accounts. Washington's WMHMDA (private right of action, in force since March 2024) covers exactly this data shape and requires a *separately conspicuous* consumer health data privacy policy. The doctor-share + clinic features push toward HIPAA business-associate exposure unless architected as patient-as-controller-with-designees. The pharmacology engine (`calcMedLevel`) uses a single-compartment model that is wrong for tirzepatide per Schneck 2024, and the doctor will see this curve. **None of this is fatal — but every one of these has to be addressed in a Phase 0 / compliance-foundations slice before AUTH-01 ships, not after.** With those guardrails in place, the v1 launch shape is genuinely promising and occupies a slot (GLP-1-specialist tracker with real doctor-share + clinic roster, free for patients, no telehealth, no EHR) that no one in the surveyed market currently fills.

## Key Findings

### Recommended Stack

The four research files agree on the broad shape: Hono on Cloudflare Workers + Neon Postgres + Drizzle ORM + Vitest 4 + Sentry + PostHog + Cloudflare Pages for the existing SPA. STACK.md is the authoritative source on versions and rationale. The two contested decisions (auth provider, sync engine) are reconciled below in **Reconciled Decisions**.

**Core technologies:**
- **Hono 4.12** on **Cloudflare Workers** — backend API, AI proxy, share-link redemption; web-standards Request/Response, ~14KB, end-to-end typed via `hono/client` RPC. Free tier covers v1 launch (100K req/day).
- **Neon Postgres** + **Drizzle 0.45** — primary store; HTTP-fetch driver works on Workers; serverless scale-to-zero; RLS native. Picked over Cloudflare D1 because longitudinal health data wants real Postgres, not SQLite.
- **Better Auth 1.6** with `organization` plugin (RECONCILED — see below) — owns its tables in your Postgres, framework-agnostic, no per-MAU cost, suits clinic-tier B2B economics.
- **TanStack Query 5** with `networkMode: 'offlineFirst'` + `persistQueryClient` against IndexedDB (RECONCILED — see below) — orchestrates the existing Zustand store as a server-state cache layer rather than replacing it.
- **`@anthropic-ai/sdk` 0.95** server-side in the Worker — replaces the hand-rolled fetch in `src/lib/ai.ts`, eliminates the plaintext-localStorage-key risk, fixes the bogus `claude-sonnet-4-6` model ID, centralises rate limits and audit.
- **Vitest 4** + `@vitest/browser-playwright` + `@testing-library/react 16` + Playwright 1.59 — the v2 codebase ships zero tests; pharmacology + insights + storage migration are clinical-math load-bearing and untested.
- **Sentry 10** + **PostHog** + **Resend** + **Cloudflare Pages** — error tracking, cookieless analytics, transactional email, static SPA host. All have free tiers that survive launch.
- **idb-keyval 6.2** — moves photos out of localStorage (5MB cap is already a year-2 ceiling) and gives TanStack Query a backing store for the offline persister.
- **Zod 4** + **`@hono/zod-validator`** — same schema validates server input and shapes client TS types; closes the kind of "free-text symptom note coalesced via `Number()`" hole the v2 codebase already shows.

Realistic launch monthly cost: $0–$30 until traction, with Anthropic the only unbounded line item.

### Expected Features

FEATURES.md is the authoritative source. The v2 codebase already implements every patient-facing tracking feature competitive consumer GLP-1 trackers ship; v1's *net-new* feature work is auth, sync, doctor share, and clinic B2B.

**Must have for v1 launch (table stakes):**
- Email/password OR magic-link auth with cross-device cloud sync — every cloud SaaS has it; required for SHARE/CLINIC.
- Local-only → account migration on first sign-in — existing v2 users in `leanshot_v4` cannot lose data.
- Account deletion (GDPR/CCPA) + data export — legal and ethical.
- Privacy policy + ToS + medical disclaimer + WMHMDA-conformant CHDP policy — health-adjacent data raises the bar.
- Doctor read-share via signed link + access code with no doctor account required — the major differentiator vs Shotsy/Pep/Glapp/MeAgain (which all ship PDF only).
- Time-bound, patient-revocable share with audit log of doctor views.
- Clinic org workspace with three roles (Owner / Coach / Viewer), email invites, patient consent flow, roster view with at-a-glance status, drill-in to the same read-only patient view as the doctor surface, tenant-scoped audit log.
- "Needs attention" ranking in the roster — reuses `pickFocus`/`generateInsights` from `src/lib/insights.ts` as a per-patient batched function.
- Production readiness: error tracking (Sentry), product analytics (PostHog), pharmacology + insights tests (PROD-04), AI key hardening (PROD-05), HTTPS domain.

**Should have / differentiators (P2 in FEATURES.md, mostly v1.1):**
- AI coach hosted proxy with per-org provisioning (clinic-funded AI for their patients).
- Coach-authored private notes on patients (org-only visibility).
- OAuth (Google/Apple) sign-in for lower friction onboarding.

**Defer (P3 / v2+):**
- Native iOS/Android apps — PWA is sufficient.
- Direct EHR / FHIR / Epic integration — out of scope per PROJECT.md; would force HIPAA covered-entity compliance.
- Telehealth video, prescription writing, doctor-to-patient messaging — anti-features that pull LeanShot from "tracker + report" into "virtual care."
- Stripe billing, paid plans — out of scope per PROJECT.md.
- Apple Health / Withings / connected-scale OAuth — defer to v1.1; trigger on signal.
- Public social feed / community posts — moderation cost + PHI risk.
- Symptom-driven AI clinical alerts — FDA CDS regulatory territory.
- Per-tenant custom CNAME domain — only at enterprise paid tier.

### Architecture Approach

ARCHITECTURE.md recommends **keep the existing Zustand store as the local source of truth; layer a small REST + reactive cache + offline mutation queue on top; ship in three slices: Patient cloud sync → Doctor share → Clinic B2B.** The key insight: LeanShot is *not* a collaborative app. Each patient is the single writer for their own data; doctors and clinics are read-only consumers. This eliminates the strongest reason to adopt a heavy sync engine (CRDTs, server reconciliation) and makes "REST + optimistic local writes + last-write-wins per record" sufficient.

**Major components:**

1. **Frontend SPA (existing)** — React 19 + Vite + Tailwind v4 + Zustand. Components keep reading from `useStore` selectors; no rewrite. The store's persist middleware bumps `leanshot_v4` → `leanshot_v5_<userId>` on first cloud sync (and keeps a `leanshot_v4_pre_cloud_backup` for 90 days — directly addressing the v3→v4 destructive-migration pattern flagged in CONCERNS.md).

2. **Sync adapter (new, ~300–500 LOC)** in `src/lib/sync/` — bridges Zustand and the backend. Mutations land in the store synchronously, then enqueue to an IndexedDB-backed durable queue, then POST to the Worker in the background. On reconnect, the queue replays. Pull on app open + on background timer. No mutation ever blocks on the network.

3. **Hono backend on Cloudflare Workers** — auth handler, sync push/pull, share-token issuance + redemption, clinic roster + drill-in, AI proxy with the Anthropic key in `wrangler secret`. Every request validates the JWT, sets `app.user_id` via `set_config`, then queries Postgres.

4. **Neon Postgres + Drizzle + RLS** — single database, shared tables, `user_id` on every patient-owned row, junction tables for `clinic_patients` / `clinic_members` / `share_tokens`. RLS policies on every table compose three relationships: self-ownership, doctor-via-active-share, clinic-member-of-org-containing-patient. `aiHistory` is intentionally never visible to doctors or clinics — sacred to the patient.

5. **Stateless signed-token doctor share** — JWT carries an opaque `share_id`; the actual permission lives in the `share_tokens` row. Revocation is `UPDATE share_tokens SET revoked_at = now()`, which kills access on the next request. `Cache-Control: private, no-store` on every share response. Audit log records every view (IP, UA family, timestamp) and surfaces to the patient in Settings.

6. **AI proxy in the same Worker** — browser POSTs to `/api/ai/messages`, Worker validates session, applies per-user rate limit, calls Anthropic with the platform key, streams response back via SSE. User-content is wrapped in `<user_notes>` XML tags to mitigate prompt injection. The model ID is centralised (fixes the bogus `claude-sonnet-4-6` from `src/lib/ai.ts`).

### Critical Pitfalls

PITFALLS.md identifies eight critical pitfalls; the top five that the roadmap MUST address:

1. **Regulatory drift past wellness-app status (HIPAA / WMHMDA / CMIA / FTC HBNR).** Doctor share + clinic features each toggle different switches. **At v1 launch the FTC HBNR + WMHMDA + CMIA definitely apply** (see Reconciled Decisions). Mitigation: Phase 0 includes legal review, FTC HBNR registration, a separately-conspicuous WMHMDA-conformant CHDP policy, and a documented BAA-vs-designee architectural decision for the doctor/clinic flows. Geofence "mental health" framing out of marketing copy.

2. **Multi-tenant scoping bug (RLS / IDOR).** January 2025's 170-Supabase-app exposure is the failure pattern. Mitigation: default-deny RLS on every table, `tenant_id` as part of the primary key (not a filter you remember), per-endpoint cross-tenant test that asserts Tenant B sees zero rows when authenticated as Tenant A, never expose `service_role` to user-input paths. Share IDs must be 128-bit random.

3. **Doctor-share revocation that doesn't actually revoke.** Four failure modes: OAuth-token-cache, HTTP-cache, JWT-with-no-server-check, forwarded link, exfiltrated PDF. Mitigation: server-side opaque tokens (DB-backed), `Cache-Control: private, no-store` on every doctor-view response, recipient-binding (consider a passwordless email magic-link first-use), audit log every view, active-session list with one-click revoke.

4. **Cloud-sync migration that destroys existing v2 users' data.** Pattern is already in the codebase: `migrateFromV3` in `src/lib/storage.ts:77-109` deletes the legacy key on first call without snapshotting, and the duplicated migration logic in `hydrate()` adds a race. **The same anti-pattern with cloud-sync blast radius is catastrophic.** Mitigation: snapshot before migrate (always), per-entity ack (not blob ack), per-entity Lamport clocks for conflict resolution, anonymous → authenticated is *union not replace*, 12-scenario migration test matrix, user-visible per-entity progress UI. Keep `leanshot_v4_pre_cloud_backup` for 90 days.

5. **Pharmacology math that's "good enough" for self-tracking but used to make dose decisions.** Tirzepatide is two-compartment per Schneck 2024, not single-compartment as v2 currently models. SC absorption phase is ignored. Inter-individual variability is 30–40%. The chart is shown to doctors. Mitigation: cite peer-reviewed sources for every constant; replace single-compartment with the published two-compartment model for tirzepatide; add a peer-reviewed test corpus that asserts published mean ± SD steady-state values; display uncertainty bands not lines; chart-overlaid disclaimer; insights never contain dose recommendations.

Three more from PITFALLS.md that map to specific phases: **AI hallucination + prompt injection + key exposure** (Pitfall #6, blocks SHARE-01); **photo deletion / right-to-be-forgotten residue** (Pitfall #7, alongside SYNC-01); **B2B invitation that collides with a personal account** (Pitfall #8, gates CLINIC-01).

## Reconciled Decisions

The four research files surfaced four decisions where STACK.md, ARCHITECTURE.md, PITFALLS.md, and PROJECT.md needed reconciliation. Each is decided here so the roadmapper has a single answer to plan against.

### 1. Auth provider: **Better Auth** (not Clerk)

STACK.md recommends Better Auth; ARCHITECTURE.md recommends Clerk. Both are defensible, but for LeanShot specifically, **Better Auth wins on three axes that matter for v1**:

- **Cost shape at clinic-tier scale.** Clerk is $0.02/MAU after 10k. A clinic onboarding 50–200 patients each is exactly the shape that cannot profitably pay $1–$4/clinic/month for auth on a free product. Better Auth is self-hosted; you pay for the Postgres it runs on, which you're paying for anyway. Cost trajectory difference is meaningful as B2B scales.
- **Health-adjacent privacy posture.** All session/cookie logic stays inside *your* Worker, against *your* Postgres. ARCHITECTURE.md itself flags that Clerk does not offer a HIPAA BAA. If LeanShot later needs to architect doctor/clinic flows as business-associate (Pitfall #1, BAA path), Clerk forces a migration; Better Auth doesn't.
- **Multi-tenant primitive.** Better Auth's `organization` plugin is exactly the clinic = `Organization`, coach = `Member`, patient-in-clinic = `Member` shape CLINIC-01/02/03 needs. Clerk Organizations is similar but not differentiated for this specific use.

The trade-off is auth UX work — Clerk ships pre-built React components; Better Auth ships primitives. For a launch milestone with a small team this is real cost (estimate ~1–2 weeks across sign-in, sign-up, password reset, magic-link, org invitation flows). The cost-shape and BAA-portability arguments outweigh it.

**Decision:** Better Auth 1.6 self-hosted against Neon Postgres. Roadmap should plan for sign-in/sign-up UI work explicitly rather than assuming pre-built components.

### 2. Sync engine: **TanStack Query as the orchestrator over the existing Zustand store** — *not a custom REST + reactive cache built from scratch*

STACK.md recommends TanStack Query 5 with `networkMode: 'offlineFirst'` + `persistQueryClient` against IndexedDB. ARCHITECTURE.md recommends a custom REST + reactive cache layer (~300–500 LOC) on top of Zustand. These are close cousins, but the roadmapper needs one answer.

**Decision: TanStack Query as the network-layer orchestrator; Zustand stays the UI source of truth; the small custom code is the *bridge between them*, not a from-scratch cache.** The hybrid:

- Components keep reading from `useStore` selectors. Don't migrate components to `useQuery` — that's the rewrite ARCHITECTURE.md correctly warns against.
- Mutations call existing Zustand actions (`addInjection`, etc.) for synchronous UI update. Each action *also* calls a sync helper that wraps TanStack Query's `useMutation` patterns under the hood: queue when offline, POST when online, reconcile server response back into the store via `hydrateFromServer`.
- TanStack Query's `persistQueryClient` against IndexedDB (via idb-keyval) handles the durable queue + reconciliation primitives, so the team writes ~150 LOC of glue rather than ~400 LOC of from-scratch queue + reconcile + retry + backoff. This is the smaller surgical change ARCHITECTURE.md is reaching for.
- Cross-device pull is a TanStack Query that runs on app focus + background interval and dispatches results into the Zustand store.

This resolves both files: STACK.md gets its TanStack Query recommendation; ARCHITECTURE.md gets its "don't replace Zustand" insight. The 300–500 LOC custom layer ARCHITECTURE.md describes is essentially the bridge code, not a separate engine.

Both files agree Replicache (maintenance mode), Triplit (acqui-hired by Supabase Aug 2025, community-maintained), ElectricSQL (read-path-only, Postgres-replication-stream is the wrong machine for KB-MB per user), Convex (proprietary DB, displaces Zustand), and Yjs/Automerge (CRDT for multi-writer, LeanShot is single-writer-per-record) are wrong shape. Zero is interesting future-proofing if LeanShot ever grows into multi-writer (e.g. coach edits a plan), but not v1.

**Confidence on this specific decision: MEDIUM.** The sync-engine market is in flux and this is the lowest-risk path that meets the actual product requirements.

### 3. HIPAA / regulatory posture: at v1 launch, **FTC HBNR + WMHMDA + CMIA definitely apply; HIPAA business-associate status is path-dependent**

PITFALLS.md flags compliance as a Phase 0 blocker requiring legal counsel. PROJECT.md keeps EHR integration out of scope to avoid HIPAA covered-entity status. The doctor-share + clinic-B2B features push toward business-associate status. Reconciled position:

- **Definitely apply at v1 launch:**
  - **FTC Health Breach Notification Rule (2024 amendments).** "Any online service ... that provides mechanisms to track ... medications, vital signs, symptoms, ... fitness, ... diet" is in scope. LeanShot is exactly this. Registration as a vendor of personal health records is required, not optional. Non-compliance has been the basis of every wellness-app FTC enforcement action 2023–2024 (BetterHelp $7.8M, GoodRx, Easy Healthcare).
  - **Washington's My Health My Data Act.** In force March 31, 2024 (June 30 for small businesses). Covers weight, fitness, mental health, sleep, diet, medication use. **Has private right of action via the Washington Consumer Protection Act** — every WA plaintiff is a class-action vector. Requires a *separately conspicuous* CHDP privacy policy with WMHMDA-specific structure (categories, purposes, sources, third parties, retention).
  - **California CMIA as amended by AB 2089 (2022).** Treats any "mental health digital service" as a healthcare provider for CMIA purposes. LeanShot's Mood tab + AI coach interpreting mood/symptom logs is in drift range. Marketing discipline ("don't say therapy/depression/anxiety") is the v1 mitigation; legal review confirms posture.
- **Path-dependent: HIPAA business-associate status.** Two viable architectures:
  - **Path A (BAA path):** LeanShot becomes a business associate of doctors and clinics that use it. Requires BAAs signed with each, encryption-at-rest audit, breach notification program, etc. This is the mature B2B path but expensive.
  - **Path B (designee path):** Doctor-share and clinic flows are architected so the *patient* is the data controller and the doctor/clinic is a *designee*. The patient grants and revokes; LeanShot has no service relationship to the doctor's covered entity. This is cheaper and matches PROJECT.md's "no EHR integration" posture, but constrains feature scope (no doctor-to-patient messaging, no patient portal positioning, no marketing copy that says "your doctor uses LeanShot").

  **Recommended for v1: Path B.** Path A only becomes necessary when a specific clinical buyer demands it, and that's a v1.x sales conversation, not a v1 launch concern. PROJECT.md's existing "no EHR integration" out-of-scope decision aligns.
- **Out of scope at v1, applies if scope changes:**
  - HIPAA covered-entity status (no EHR integration, no prescribing, no telehealth).
  - HIPAA BAA program (deferred until Path A is required).
  - Other state laws (Connecticut, Nevada, others have similar but narrower laws — defer until WA/CA are clean).

**Decision:** Phase 0 / compliance-foundations slice ships *before* AUTH-01. Specifically:
1. Legal review of v1 feature list with privacy-law counsel.
2. FTC HBNR registration filed.
3. WMHMDA-conformant CHDP policy drafted, reviewed, published, and *separately conspicuously linked* from leanshot.app/.
4. Architectural decision: Path B (patient-as-controller-with-designees) baked into doctor-share + clinic flows. Documented in `.planning/decisions/` (or equivalent) so the team doesn't drift back to BA framing in marketing.
5. Marketing copy review: no "your doctor uses LeanShot" language; no "mental health support" framing for the AI coach; no "depression/anxiety/therapy" copy in mood tracking.
6. Marketing pixel and analytics review: marketing site on a separate subdomain that *never* hosts authenticated routes. Strict CSP with `script-src 'self'` on app routes. (BetterHelp/GoodRx/Flo Health were all fined for the marketing-pixel-on-authenticated-route pattern.)

### 4. Pharmacology model upgrade: **single-compartment for v1 with disclaimer + uncertainty band; two-compartment for tirzepatide is a v1.1-acceptable upgrade IF the v1 ships with the test corpus and disclaimer**

PITFALLS.md flags single-compartment as wrong for tirzepatide per Schneck 2024. The research is genuinely split on whether this is v1-must or v1.1-acceptable. Reconciled:

- **v1 must (PROD-04 expansion):**
  - Pharmacology + insights engines have automated test coverage (already in PROJECT.md PROD-04).
  - Every constant in `src/lib/pharmacology.ts` cites a peer-reviewed source in a comment with DOI/link.
  - Test corpus: simulate the standard titration schedule for each drug; assert curve reproduces published mean ± SD steady-state values within ±15%.
  - Display uncertainty: chart shows a *band*, not a line, labelled "modeled estimate, individual variation 30–40%."
  - Disclaimer overlaid on the chart, not just the app shell. Insights never contain dose-change recommendations ("increase," "decrease," "double," "skip" in the context of a dose are forbidden output strings — testable refusal).
  - Doctor report headline emphasises the *log* (what was injected when), not the PK estimate. The curve is shown but is informational, not headline.
- **v1.1-acceptable upgrade:**
  - Replace single-compartment with Schneck 2024's two-compartment-with-first-order-absorption model for tirzepatide.
  - Replace single-compartment-without-absorption-phase with one-compartment-with-absorption for semaglutide.

**Rationale:** The single-compartment model is wrong but the wrongness is bounded — it under-predicts the early peak and over-predicts the late tail, both within the inter-individual-variability spread that the uncertainty band is supposed to cover. The risk that needs *blocking* the v1 launch is "wrong and presented as authoritative." The v1 must shifts the math from authoritative-looking-but-wrong to honest-uncertainty-with-disclaimer. The v1.1 then cleans up the math itself.

**Decision:** v1 ships with single-compartment + cited sources + test corpus + uncertainty band + disclaimer + insights guard. v1.1 upgrades the model to two-compartment for tirzepatide. The roadmapper should plan PROD-04 expansion as a v1 phase that explicitly includes the disclaimer/band/refusal-list work (not just unit tests).

## Codebase Concerns the Roadmap MUST Address

Four concrete v2-codebase issues that the roadmap must address explicitly (not just "during refactoring"):

1. **`migrateFromV3` in `src/lib/storage.ts:77-109` deletes the legacy key without snapshot.** Same anti-pattern with cloud-sync blast radius is catastrophic (Pitfall #4). The cloud-sync migration phase MUST ship with `leanshot_v4_pre_cloud_backup` snapshot retained for 90 days, per-entity ack (not blob ack), and the 12-scenario test matrix in PITFALLS.md.
2. **Hardcoded `DEFAULT_MODEL = 'claude-sonnet-4-6'` in `src/lib/ai.ts:22` is not a real model ID.** Every AI call 404s in production today. The Anthropic SDK proxy work (PROD-05) MUST fix this and add a smoke test that the API responds. Centralise the model ID in the Worker so it's fixed once for all users.
3. **Plaintext Anthropic API key in localStorage** (`src/lib/ai.ts`, `src/lib/storage.ts`). Single largest open security item. PROD-05 hardening MUST move to a server proxy with the key in `wrangler secret`. Drop the BYO-key default. If a future advanced-power-user tier needs BYO for cost reasons, ship that as a second path with explicit risk disclosure.
4. **Single-compartment PK math for tirzepatide.** Per the Reconciled Decisions section above, v1 ships with cited sources + test corpus + uncertainty band + disclaimer; v1.1 upgrades to two-compartment.

These are not optional cleanups; each is on a critical path for a specific v1 capability and each would re-create the failure pattern at higher blast radius if ignored.

## Implications for Roadmap

Based on combined research, suggested phase structure (5 phases). Phase names are illustrative; the roadmapper picks the canonical names.

### Phase 0: Compliance Foundations + Production Hardening

**Rationale:** Pitfall #1 says legal review + WMHMDA CHDP + FTC HBNR registration must happen *before* AUTH-01 ships. PROD-01/02/03/06 (HTTPS domain, Sentry, PostHog, medical disclaimer) are blockers for any public launch. Linter/formatter/test-runner setup unblocks all subsequent phases (the v2 codebase ships zero of these). This phase is small in code but high in unblocking value.

**Delivers:**
- Legal review complete; v1 feature list approved.
- FTC HBNR registration filed.
- WMHMDA-conformant Consumer Health Data Privacy policy published, separately linked from homepage.
- BAA-vs-designee architectural decision documented (recommended: designee/Path B).
- Marketing-site subdomain separation; CSP locked down on authenticated routes; no marketing pixels on app routes.
- ESLint + Prettier + Vitest configured, wired into a GitHub Actions CI pipeline (typecheck + lint + test gates `vite build`).
- Sentry + PostHog wired into the SPA (PROD-02, PROD-03).
- Medical disclaimer + data-storage explanation visible before first log (PROD-06) — actually displayed, not just present in copy.
- HTTPS domain via Cloudflare Pages, basic deploy pipeline (PROD-01).
- Decision logged: hosting on Cloudflare Pages + Workers; auth provider Better Auth; database Neon Postgres.

**Addresses:** PROD-01, PROD-02, PROD-03, PROD-06. Pitfall #1 (regulatory drift). Foundational tech debt from CONCERNS.md (no linter, no tests, no CI).

**Avoids:** WMHMDA/FTC HBNR enforcement vector at the moment LeanShot has accounts. The "we'll add tests later" trap on the clinical math.

### Phase 1: Patient Cloud Sync Foundation (AUTH-01 + SYNC-01 + SYNC-02 + AI hardening)

**Rationale:** Architecture says everything net-new depends on auth + sync + cloud storage. This phase is the load-bearing slice. Bundling AI hardening (PROD-05) here is correct because: the Worker exists for sync, so the AI proxy is a cheap add; the AI key risk is the largest open security item; the doctor-share phase coming next can't include AI output if the key is in the browser.

**Delivers:**
- Better Auth provisioned against Neon Postgres; sign-up + sign-in + magic-link + password reset.
- Hono Worker deployed with `/api/auth/*`, `/api/sync/pull`, `/api/sync/push`, `/api/migrate`, `/api/ai/messages`.
- Drizzle schema + initial RLS policies for patient-owned tables (`injections`, `weights`, `meals`, `workouts`, `symptoms`, `mood`, `sleep`, `supplements`, `vials`, `aiHistory`).
- Sync adapter in `src/lib/sync/` with offline-first mutation queue (IndexedDB-backed), TanStack Query orchestration, reconcile-on-pull.
- Existing `leanshot_v4` localStorage migration: snapshot to `leanshot_v4_pre_cloud_backup`, per-entity upload, user-visible per-entity progress UI, 12-scenario test matrix passing in CI.
- Storage key bumped to `leanshot_v5_<userId>`; sign-out clears scoped key, leaves backup intact.
- Anonymous-mode preserved: app keeps working without an account; sign-in CTA in Settings, not blocking onboarding.
- AI coach migrated to server proxy: key in `wrangler secret`, model ID fixed, per-user rate limit, audit log, `<user_notes>` XML wrapping for prompt-injection mitigation, refuse-list adversarial test corpus in CI.
- Account deletion (GDPR/CCPA): hard-delete with crypto-shred prep; backup-retention policy documented.

**Uses:** Hono + Workers + Neon + Drizzle + Better Auth + TanStack Query + idb-keyval + `@anthropic-ai/sdk` (server-side) — all from STACK.md.

**Implements:** All five architecture patterns from ARCHITECTURE.md (local-first optimistic sync, RLS tenant scoping, AI server proxy, append-only mutation log, sync adapter as bridge).

**Addresses:** AUTH-01, SYNC-01, SYNC-02, PROD-05. Pitfalls #2 (RLS), #4 (migration data loss), #6 (AI hallucination + key + prompt injection), #7 (photo deletion preparation — sets up per-user-key crypto-shred shape even if photos stay local for v1).

**Avoids:** First-sign-in clobber, blob conflict resolution, plaintext-key exposure, prompt injection drive of dosing advice, `service_role` reachability from user paths.

### Phase 2: Pharmacology + Insights Hardening (PROD-04 expansion)

**Rationale:** Cannot ship doctor-share until the curve the doctor sees is defensible. Pitfall #5 makes this explicit. Plus PROD-04 in PROJECT.md. Smaller than Phase 1 in scope but blocks the differentiator.

**Delivers:**
- Vitest test corpus for `pharmacology.calcMedLevel`, `HALF_LIVES`, `TITRATION`, `TRIAL_DATA` — every constant cites a peer-reviewed source with DOI in a comment; simulation reproduces published mean ± SD steady-state within ±15% per drug.
- Vitest test corpus for `insights.generateInsights`, `insights.pickFocus`, `useStreaks.calc`.
- Refusal-list test: insights never produce strings containing "increase," "decrease," "double," or "skip" in dose-change context.
- Chart shows uncertainty band, not single line. Y-axis labelled "modeled estimate" with no measurement-grade units (no ng/mL).
- Chart-overlaid medical disclaimer that survives screenshot.
- Insights selector memoised with `useShallow` to fix the per-render rebuild bug from CONCERNS.md.

**Uses:** Vitest 4 + `@testing-library/react`. No new infrastructure beyond Phase 0.

**Addresses:** PROD-04. Pitfall #5 (pharmacology correctness).

**Avoids:** Showing a doctor a curve LeanShot can't defend. Insights crossing into clinical decision support and FDA territory. The "PR changes a `HALF_LIVES` value with no test failure" warning sign.

### Phase 3: Doctor Read-Share (SHARE-01 + SHARE-02)

**Rationale:** Architecture says this builds on Phase 1's auth + snapshot endpoint. Adds zero infrastructure beyond a couple of tables and one route module. **This is the major differentiator vs the consumer GLP-1 tracker market.**

**Delivers:**
- `share_tokens` table with HMAC-signed JWT carrying opaque `share_id` (not patient_id), DB-row as source of truth for revocation.
- `/api/share/issue`, `/api/share/redeem`, `/api/share/snapshot/:jwt`, `/api/share/revoke/:id` Hono routes.
- `share_views` audit log (IP, UA family, timestamp on every successful access).
- `Cache-Control: private, no-store` on every share-route response. Service worker (when added) never caches `/share/*`.
- DoctorView SPA route at `/d/:jwt`: redeems token, hydrates a temporary read-only Zustand store with snapshot, renders existing `DoctorReport.tsx` content + live charts in read-only mode.
- Patient Settings: "Active shares" UI with view count, last-viewed-at, one-click revoke.
- Optional second factor: patient can require a 6-digit emailed code on first redeem (sent to `audience_email` if patient provided one).
- Print-friendly mode (reuse existing `DoctorReport.tsx` print stylesheet).
- Snapshot endpoint *explicitly excludes* `aiHistory` (privacy guarantee).
- Revocation drill in CI: 4-failure-mode test (token cache, HTTP cache, JWT-only check, forwarded link) all return 401 within one DB query.

**Uses:** Existing Phase 1 infrastructure + `share_tokens` schema migration.

**Addresses:** SHARE-01, SHARE-02. Pitfall #3 (revocation gaps). Differentiator from PITFALLS.md/FEATURES.md analysis (no consumer GLP-1 tracker has this).

**Avoids:** Stateless JWTs that survive revocation by hours. Cached doctor views. Forwarded URLs that grant access to colleagues. PDF exports without disclaimer.

### Phase 4: Clinic B2B Surface (CLINIC-01 + CLINIC-02 + CLINIC-03)

**Rationale:** Most complex phase (org provisioning, invitation flows, roster UX) but builds on every primitive from Phases 1–3. Patient drill-in view is the doctor view with different framing — code re-use is high. Last because consent UX + identity model + roster intelligence each depend on prior phases.

**Delivers:**
- `clinics`, `clinic_members`, `clinic_patients`, `invitations` tables with junction-table RLS policies (clinic-member-reads-clinic-patient).
- Better Auth `organization` plugin wired through; org switcher in UI.
- `/api/clinic/roster`, `/api/clinic/patient/:id`, `/api/clinic/invite`, `/api/clinic/audit-log` routes.
- Schema enforces *one* user record per email; `memberships` is the relationship table, never a duplicate identity.
- Patient invitation flow: explicit consent dialog at acceptance, click-through recorded with timestamp + IP, granular share scope per membership ("share injections + weights + symptoms with Concord, only injections + weights with Maple Coaching").
- Three roles: Owner, Coach, Viewer.
- Roster view with sortable status: name, current med + dose, last log, recent symptom severity, weight trend arrow, days since last injection.
- "Needs attention" ranking using `rankPatients(orgState)` adapted from `pickFocus`/`generateInsights`.
- Drill-in to a single patient: reuses DoctorView component with `viewerMode='clinic'` framing.
- Tenant-scoped audit log (who viewed which patient when, who invited whom, who accepted/declined).
- Patient: revoke clinic access at any time from Settings; clinic loses access immediately, patient's data stays intact.
- Per-org branded patient invitation page (logo + name); no full CNAME custom domain.
- B2B onboarding test matrix from Pitfall #8 (existing personal user + invited × no personal user + invited × existing personal user + 2 invitations × invited but never accepts × accepts then rejects).

**Uses:** Better Auth `organization` plugin + Hono + Drizzle + RLS policies extended.

**Addresses:** CLINIC-01, CLINIC-02, CLINIC-03. Pitfall #8 (B2B invitation collision). Roster intelligence reuses insights engine without duplicating it.

**Avoids:** Duplicate user records on email collision. Forced migration of personal data into a clinic. Identity collision on next sign-in. All-or-nothing share scope. Cross-tenant data leak via missing RLS on `clinic_patients` join.

### Phase Ordering Rationale

- **Phase 0 first because** legal/compliance gates *everything* (Pitfall #1 is explicit). PROD-01/02/03/06 are public-launch blockers in PROJECT.md. Linter + tests + CI unblock every subsequent phase by making refactoring safe.
- **Phase 1 second because** AUTH-01 + SYNC-01 are the critical path for SHARE-01 and CLINIC-01 (FEATURES.md dependency graph). AI hardening (PROD-05) ships in this phase because the Worker already exists for sync, the AI key risk blocks doctor-share, and waiting until later means rebuilding the AI surface twice.
- **Phase 2 between auth/sync and doctor-share because** the curve is shown to the doctor; making it defensible is on the critical path for SHARE-01 (Pitfall #5).
- **Phase 3 third because** doctor-share is the major differentiator and the architecture says it builds directly on Phase 1's snapshot endpoint with minimal new infrastructure.
- **Phase 4 last because** clinic B2B is the most complex (multi-tenant invitation, consent UX, roster intelligence) and reuses every primitive from prior phases. Doctor view becomes the patient-detail view with different chrome.

### Research Flags

Phases that likely need a `/gsd-research-phase` deeper-research pass during planning:

- **Phase 0 — compliance:** Specifically the BAA-vs-designee architectural decision and the WMHMDA CHDP policy structure. Both are jurisdiction-specific and need a privacy-law attorney's review, not just web research. Flag as needing legal-counsel input plus a deeper research pass on the FTC HBNR registration mechanics and the WMHMDA "consumer health data" structural requirements.
- **Phase 1 — sync engine specifics + Better Auth org flows:** TanStack Query offline-first pattern is well-documented but the bridging glue to Zustand is unique to LeanShot's shape. Better Auth + Hono integration for magic-link is documented but org-plugin + Postgres RLS interaction needs verification. The 12-scenario migration test matrix from PITFALLS.md should be designed in research, not on the fly. Flag as needing a research pass on TanStack Query persistence + Better Auth organization + sync conflict-resolution semantics.
- **Phase 2 — pharmacology specifics:** Schneck 2024's two-compartment parameters, the FDA Mounjaro pop-PK review numbers, the test-corpus design (what test inputs, what expected outputs ± what tolerance per drug). This is domain research, not engineering research; flag as needing a clinical-pharmacology-literature pass.
- **Phase 3 — doctor-share token semantics:** The 4-failure-mode revocation drill needs a specific design (which test framework, which assertions, how to simulate cache + JWT-TTL + forwarded-link cases). Flag as needing a security-design research pass before implementation.

Phases with standard patterns (skip deeper research, plan from current research):

- **Phase 4 — clinic B2B:** ARCHITECTURE.md's Better Auth organization plugin + RLS junction-table pattern is well-documented. PITFALLS.md's invitation matrix is sufficient guidance. Plan directly from current research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via `npm view` 2026-05-10, official docs cited, Context7 verified for Better Auth + Hono + Sentry + Vitest + Anthropic SDK. The one MEDIUM-confidence sub-decision (sync engine) is reconciled above with explicit rationale. |
| Features | MEDIUM-HIGH | Strong on competitor feature set (Shotsy, Pep, Glapp, MeAgain, Mochi, Healthie, CoachCare); high on RPM patterns; medium on doctor-share UX since most consumer GLP-1 trackers ship PDF only and there's limited prior art for live link share in this domain (Epic's Share Everywhere is the analog). |
| Architecture | MEDIUM-HIGH | Topology and tenant model are well-trodden (Postgres + RLS + JWT + Hono on Workers is a standard pattern with multiple reference implementations). Sync engine choice has real tradeoffs and is the lowest-confidence sub-decision; reconciled above. The "Zustand stays the source of truth, sync layer wraps it" pattern is the smallest surgical change but carries some implementation risk. |
| Pitfalls | HIGH | Regulatory framing cites primary law (FTC HBNR final rule, WMHMDA full text, CMIA AB 2089 amendments). Multi-tenant RLS pitfalls cite documented production incidents (170-app Supabase exposure, BetterHelp/GoodRx FTC actions). Pharmacology references peer-reviewed PK studies (Schneck 2024, FDA NDA reviews). |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Legal counsel review for the BAA-vs-designee architectural decision and the WMHMDA CHDP policy.** Reconciled position is Path B (designee), but a privacy-law attorney must confirm specific to LeanShot's feature set + marketing copy. This is a Phase 0 dependency, not a research gap that engineering can close alone.
- **Anthropic AI Gateway / pricing for the proxy at scale.** Recommended in STACK.md but the per-request economics at meaningful traction are not verified. Re-research at the 1k-user mark; v1 launch sizing is fine.
- **Photo storage architecture (per-user encryption key, IndexedDB local cache, R2 CDN).** Phase 1 surface is "prepare the shape"; full implementation deferred per ARCHITECTURE.md Phase D (post-v1). Sufficient for v1 but should be a v1.x research pass.
- **Real-time push (Durable Objects, SSE, polling cadence).** ARCHITECTURE.md defers to Phase D. Confirm during planning that polling-on-focus + background interval is sufficient for the clinic roster ("needs attention" doesn't need sub-minute freshness).
- **Email deliverability strategy.** Resend is the recommendation, but SPF/DKIM/DMARC + warming + spam-rate testing must be a Phase 1 task, not assumed.
- **Pharmacology v1.1 upgrade trigger.** Reconciled decision says ship v1 with single-compartment + disclaimer + uncertainty band; upgrade to two-compartment in v1.1. The trigger condition (which user signal, which clinical-feedback metric) needs definition during planning.

## Sources

### Primary (HIGH confidence)
- Context7 verified library docs: `/better-auth/better-auth`, `/getsentry/sentry-javascript`, `/vitest-dev/vitest`, `/websites/hono_dev`, `/anthropics/anthropic-sdk-typescript`
- npm registry version verification (2026-05-10): hono 4.12.18, better-auth 1.6.10, vitest 4.1.5, drizzle-orm 0.45.2, `@anthropic-ai/sdk` 0.95.1, `@sentry/react` 10.52.0, playwright 1.59.1, `@hono/zod-validator` 0.8.0, wrangler 4.90.0
- [Cloudflare Workers — React + Vite framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Hono Cloudflare Workers getting started](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Better Auth — Organization plugin docs](https://better-auth.com/docs/plugins/organization)
- [FTC: Updated Health Breach Notification Rule (2024)](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps)
- [Washington My Health My Data Act, RCW 19.373 (full text)](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true)
- [HHS: Access Right, Health Apps & APIs](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html)
- [Schneck et al. 2024: Population pharmacokinetics of tirzepatide (CPT: Pharmacometrics)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962491/)
- [FDA Clinical Pharmacology Review: Mounjaro NDA 215866](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2022/215866Orig1s000ClinPharmR.pdf)
- [JAMA Network Open: LLM vulnerability to prompt injection in medical advice](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2842987)
- [Epic Share Everywhere FAQ](https://shareeverywhere.epic.com/FAQ) — doctor-share prior art

### Secondary (MEDIUM confidence)
- [Choosing a Sync Engine for Local-First in 2026 — johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/) — synthesised against official docs for each engine
- [Drizzle ORM vs Prisma 2026](https://dev.to/pockit_tools/drizzle-orm-vs-prisma-in-2026-the-honest-comparison-nobody-is-making-3n6g)
- [Better Auth vs Clerk vs Supabase Auth 2026](https://app.daily.dev/posts/better-auth-vs-clerk-vs-supabase-auth-2026-guide--xya3hrvkv)
- [byteiota: Supabase Security Flaw — 170+ Apps Exposed by Missing RLS](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/)
- [Makerkit: Supabase RLS Best Practices for Production Multi-Tenant Apps](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Davis Wright Tremaine: FTC HBNR finalizes app expansion](https://www.dwt.com/blogs/privacy--security-law-blog/2024/05/ftc-finalizes-hbnr-to-cover-health-app-breaches)
- [Blank Rome: California CMIA AB 2089 expansion to mental health digital services](https://www.blankrome.com/publications/california-expands-its-confidentiality-medical-information-act-regulate-mental-health)
- [IAPP: Washington's My Health, My Data Act overview](https://iapp.org/resources/article/washington-my-health-my-data-act-overview)
- Consumer GLP-1 tracker landscape: Shotsy, Pep, Glapp, MeAgain, Mochi, Healthie, CoachCare reviews from FEATURES.md sources
- [glp1effect.com: Estimated Medication Level Charts in GLP-1 Tracking Apps](https://glp1effect.com/p/are-glp-1-app-medication-charts-reliable) — pharmacology critique relevant to Pitfall #5

### Tertiary (LOW confidence)
- Single-source pricing data ([Vercel vs Cloudflare 2026 free-tier comparison](https://danubedata.ro/blog/cloudflare-pages-vs-netlify-vs-vercel-static-hosting-2026)) — verified against Vercel + Cloudflare official pricing pages but pricing pages drift; re-verify before commitment
- [TokenMix: Anthropic API Key 2026 best practices](https://tokenmix.ai/blog/anthropic-api-key-generate-secure-rotate-2026) — single-source incident anecdotes about cost runaway

### Internal context
- `/Users/karstenhaldan/minisite/leanshot/.planning/PROJECT.md` — milestone scope, locked tech stack, constraints
- `/Users/karstenhaldan/minisite/leanshot/.planning/codebase/CONCERNS.md` — codebase-specific concerns referenced in Pitfalls #4, #5, #6 and in Reconciled Decisions
- `/Users/karstenhaldan/minisite/leanshot/.planning/research/STACK.md` — stack details (versions, rationale, alternatives, install commands)
- `/Users/karstenhaldan/minisite/leanshot/.planning/research/FEATURES.md` — feature landscape (table stakes, differentiators, anti-features, prioritization matrix)
- `/Users/karstenhaldan/minisite/leanshot/.planning/research/ARCHITECTURE.md` — system topology, sync architecture, tenant scoping, build phases
- `/Users/karstenhaldan/minisite/leanshot/.planning/research/PITFALLS.md` — eight critical pitfalls with phase-mapping; reconciled decisions reference it throughout

---
*Research completed: 2026-05-10*
*Ready for roadmap: yes*
