# Phase 7: Compliance Foundations (Legal-Counsel-Led) — Research

**Researched:** 2026-05-12
**Domain:** Compliance + data-governance (WMHMDA + FTC HBNR + privacy policy + data export/delete + audit log + restore-from-backup UI + test stability)
**Confidence:** HIGH (legal primary sources verified, code surfaces inspected, package versions confirmed, e2e specs read in full)

## Summary

Phase 7 is the load-bearing legal/compliance/data-governance phase that gates v1 broad public launch. It folds in four ROADMAP-mandated COMPL requirements (privacy policy, WMHMDA CHDP, FTC HBNR registration + incident runbook, data export + account delete) **plus** four items deferred from Phase 6 (full cloud-write audit log, restore-from-backup UI, codebase-wide `s.user!` sweep, re-enable 7 deferred e2e specs).

The phase has two failure modes the planner must guard against: (a) CI red prevents safe deploys of legal pages → **07-01 must be first and gate every other plan** (mirrors Phase 6 D-12's 06-01 pattern); (b) treating the COMPL items as paperwork-only when each requires schema (`audit_logs`), runtime infrastructure (pg_cron T+30 worker), and UI (Settings flows) — the planner must size each plan accordingly.

**Primary recommendation:** Eight or nine plans, executed in three waves. Wave 1: 07-01 (e2e fix batch — CI green gate) + 07-02 (legal-page hosting + footer wiring, low-risk parallel). Wave 2: 07-03 (audit_logs table + triggers — load-bearing schema), 07-04 (policy authoring — Termly-driven self-draft), 07-05 (HBNR runbook + filing confirmation), 07-09 (`s.user!` sweep — independent, can parallelize with any wave). Wave 3: 07-06 (data export with deferred-init PDF), 07-07 (account-delete soft-delete + crypto-shred + pg_cron worker), 07-08 (restore-from-backup UI). See §Recommended Plan Ordering.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (counsel model):** Self-draft all three legal documents from public OSS/Termly-free templates. **NO attorney engagement in Phase 7.** WMHMDA's private right of action (in force March 2024) and the associated litigation risk are explicitly accepted by the founder. Phase 7 plans must NOT include "counsel review" as a task or gate. **Conflict with ROADMAP SC#1:** ROADMAP §Phase 7 SC#1 says "reviewed by privacy-law counsel (signed-off email retained in `.planning/decisions/`)". D-01 supersedes that clause — planner MUST update ROADMAP SC#1 wording to drop the counsel-review requirement (or replace with "self-drafted from <vendor> template; accepted-risk decision recorded in `.planning/decisions/`").
- **D-02 (Storage tier):** Stay on **free-tier Supabase Storage**. Upgrade trigger = first B2B contract OR first incident. Do NOT pre-build the tier-upgrade path in Phase 7. Treat data minimization + the visible disclaimer overlay (Phase 2's COMPL-04) as the HIPAA boundary; we are explicitly NOT a HIPAA covered entity.
- **D-03 (account-delete model):** 30-day soft-delete + crypto-shred at T+30 + audit-skeleton retained forever. T+0 typed confirmation → mark deleted + sign-out all sessions + move photos to crypto-locked prefix + flag per-user encryption key for destruction + wipe `leanshot_v4_pre_cloud_backup`. T+0..30d undo via support email/magic-link. T+30d daily cron destroys per-user key + cascade-deletes all rows + hard-deletes Storage objects. Audit-skeleton survives forever as `(timestamp, action='account_deleted_*', user_id_hash, ip_hash)` — no PII keys.
- **D-04 (audit-log scope):** Full cloud-writes scope. New `audit_logs` table records every cloud write across the 9 sync tables: `(timestamp, user_id, table_name, row_id, action, before_hash, after_hash)`. Server-side writes only (Postgres trigger or RPC) — clients cannot bypass. Retention: indefinite for skeleton subset (account_deleted_*), 13 months for full per-write history. Three consumers: (a) D-03 account-delete skeleton, (b) Phase 6 D-11 LWW conflict toast investigations, (c) HBNR breach-tracking story.
- **D-05 (restore-from-backup UI):** Settings → "Recovery" section with "Restore from local backup" button that re-hydrates persisted Zustand state from `localStorage['leanshot_v4_pre_cloud_backup']` (Phase 6 D-03 wrote this). Confirmation modal shows snapshot date + warns current cloud-sync state will be overwritten. Read-only access to backup until user opts in.
- **D-06 (`s.user!` audit):** Codebase-wide sweep. Each non-null assertion becomes an early-return + typed null-guard, OR migrates to the Phase 6 D-12 nullable-selector pattern (`MedLevelChart.tsx:13`). One commit per file. Acceptance: `grep -rn "s\.user!" leanshot/src/` returns zero matches AND typecheck stays green AND no behavioral regression in tests.
- **D-07 (07-01 first):** Plan 07-01 = re-enable + fix the 7 deferred e2e specs (`.planning/deferred-tests.md`). Batch-fix per memory `feedback_defer_then_batch_fix_pattern.md`. Acceptance: `grep -rn "DEFERRED: see leanshot/.planning/deferred-tests.md" leanshot/e2e/` returns zero matches AND `npm run test:e2e` in CI returns 11 pass / 0 fail.

### Claude's Discretion

- Specific template vendor for D-01 (Termly free / iubenda free / GitHub OSS / hand-rolled from statute). Planner picks; must cross-reference ≥ 2 sources.
- Audit-log storage shape (single table vs per-table). Constraint: server-side writes only.
- Footer wiring shape (SPA `/legal/*` routes vs static MD via Vercel rewrites vs Markdown components). Either fine; consistency > choice.
- Cron mechanism for T+30 shred (Supabase pg_cron / Edge Function on schedule / Vercel cron + admin RPC).
- Same-email-signs-up-during-pending-shred behavior (treat as fresh account / new user_id) — document in user-facing copy.

### Deferred Ideas (OUT OF SCOPE)

- HIPAA Team-tier BAA upgrade — separate phase triggered by first B2B contract OR first incident.
- Attorney review of self-drafted policies — accepted-risk; Phase 7.5 hardening cycle if triggered post-launch.
- GDPR-compliant data-portability format (FHIR / vCard interop schema) — v2.
- Audit-log UI ("see what the cloud did") — v2; v1 audit log feeds support investigation only.
- Photo crypto-shred via per-user envelope encryption — D-02 free-tier choice makes Storage default encryption + DB-level key destruction sufficient; revisit if D-02 trigger fires.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMPL-01 | Privacy policy published, references all data categories collected (injections, photos, weight, mood, symptoms, AI conversations) | §3 (Privacy policy structure + Termly comparison); WMHMDA RCW 19.373.030 categories enumeration |
| COMPL-02 | WMHMDA-compliant CHDP policy linked separately + conspicuously from app footer | §3 (WMHMDA structural anchors); §10 (Footer wiring) |
| COMPL-03 | FTC HBNR registration filed + incident-response plan documented | §4 (HBNR registration mechanics + 60-day clock + breach-decision tree) |
| COMPL-06 | User can export all data (JSON + readable PDF) + delete account on demand — surfaced clearly in Settings | §5 (Export); §6 (Account delete with crypto-shred + pg_cron worker) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Legal policy pages (privacy, CHDP, terms, medical disclaimer) | Frontend (static content) | CDN | Static HTML/MD; no server logic; CDN-cacheable. Footer link wiring is pure SPA. |
| Audit log writes (D-04) | API / Backend (Postgres triggers) | Database | Trigger-driven server-side capture. Clients MUST NOT write directly — RLS denies INSERT to authenticated role; only the trigger context can write. |
| Audit log retention (13mo full + indefinite skeleton) | Database (pg_cron) | — | Same tier as Phase 4 anon-cleanup cron. |
| Data export — JSON | Browser / Client | API (read) | Read all user-scoped rows via supabase-js; serialize in-browser. RLS ensures user only sees own data. |
| Data export — PDF | Browser / Client (lazy-loaded jsPDF) | — | Bundle-size constraint forces deferred-init pattern; generate in-browser to avoid server-side PDF infra. |
| Account-delete T+0 (soft-delete) | API / Backend (admin RPC) | Browser | Service-role-only RPC marks deleted + signs out sessions + moves photos to pending-shred prefix. Browser cannot self-delete (RLS blocks `auth.users` access). |
| Account-delete T+30 (crypto-shred) | Database (pg_cron) | API (admin) | Same pattern as Phase 4 `cleanup-anon-users`. Idempotent re-run for partial-shred recovery. |
| Restore-from-backup UI (D-05) | Browser / Client | — | Reads localStorage, calls `useStore.setState(...)`. Pure client-side; no server interaction. |
| `s.user!` sweep (D-06) | Frontend Server (React render) | — | Component-level null-guards. Pure refactor. |
| E2E test re-enable (D-07) | Test infrastructure | — | Playwright + supabase-js. Modifies CI gates only. |

## Project Constraints (from CLAUDE.md)

- **TS strict** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. New code must not regress.
- **Local-first must keep working** — sync outage = degraded sync UX, not full-app outage. The audit-log + account-delete flows must not break local-only logging on the device.
- **Bundle-size discipline** — index gz ≤ 50 kB (CI guard at `.github/workflows/ci.yml`). Heavy SDKs (PDF library) MUST route through `src/lib/sync-defer.ts`-style deferred-init wrapper or be lazy-imported on demand. **Direct static imports of jsPDF/pdfmake in App.tsx/main.tsx/store.ts are regressions blocked by the bundle-size CI guard.** (Memory: `project_phase5_bundle_regression.md`.)
- **No third-party trackers** — current Privacy section copy says "No analytics. No telemetry." If PostHog is now wired (PROD-03), the privacy policy MUST disclose it — verify with planner before publishing.
- **GSD workflow enforcement** — no direct repo edits outside a GSD workflow.

---

## §1: Plan 07-01 — Re-enable + fix the 7 deferred e2e specs (D-07; CI gate)

### Why this is plan 1

Every subsequent Phase 7 plan ships infra changes (audit_logs migration, legal pages, account-delete RPC, restore UI). Shipping with red CI is unsafe. 07-01 establishes green CI as the entry condition; 07-02..09 depend on it.

### The 7 specs (verified by reading each)

| # | Spec | Phase / SC | Failure mode | Likely fix family |
|---|---|---|---|---|
| 1 | `e2e/cross-device-sync.spec.ts:138` | 05 / SC#1 | Realtime didn't deliver injection within 5s in CI | A (realtime timing) |
| 2 | `e2e/migrate-resume.spec.ts:136` | 06 / SC#1 | Migration UI didn't reach "Migrating"/"All done" within 12s | B (migration state machine timing) |
| 3 | `e2e/migrate-resume.spec.ts:181` | 06 / SC#1 | Resume-state UI didn't surface | B (migration state machine timing) |
| 4 | `e2e/offline-conflict-toast.spec.ts:153` | 06 / SC#4 | LWW conflict toast didn't appear | A (realtime timing) + C (toast lifecycle) |
| 5 | `e2e/offline-log-then-sync.spec.ts:138` | 05 / SC#4 | Reconnect/sync race; element-not-found | A (realtime timing) |
| 6 | `e2e/photo-cross-device.spec.ts:151` | 06 / SC#3 | Storage signed-URL roundtrip exceeded 5s budget | A (realtime + Storage timing) |
| 7 | `e2e/signout-cache-clear.spec.ts:31` | 05 / SC#3 | Local-user fixture missing in CI signout path; ack-disclaimer check failed | D (fixture preconditions) |

### Fix taxonomy (4 families, evidence-grounded)

**Family A — Realtime/Storage CI timing budgets (#1, #4, #5, #6)** — These all set 5-8s budgets calibrated against `npm run dev` (port 5173, dev HMR, warm WebSocket). CI runs against `npm run preview` (port 4173, prod build, cold WebSocket, Linux runner). Cold realtime handshake (phx_join across 9 channels per `06-CONTEXT.md` D-14) adds 1-3s. **Fix shape — pick ONE per spec, document choice in a comment block:**

- **A1 (preferred — explicit warm):** Add a `test.beforeAll` per spec that signs in a throwaway warm-up context, awaits "first realtime event received" (e.g., via a side-channel `window.__leanshot_first_realtime__` Promise the sync engine resolves on first postgres_changes payload), then closes the context. Eliminates the cold-start tax for the real test.
- **A2 (acceptable — raise budget):** Raise the 5s assertion to 8-12s with a `// CI-cold-realtime-budget: see deferred-tests.md` comment. Cheapest fix; preserves the SC's spirit (still verifies "within seconds, not refresh").
- **A3 (heavier — deterministic test hook):** Expose `window.__leanshot_realtime_state__ = { lastEventAt, channelCount }` so tests can `expect.poll` on a deterministic signal instead of UI presence.

Memory `feedback_defer_then_batch_fix_pattern.md` indicates A2 is the cheapest viable fix and is acceptable for a milestone-close batch. The planner should default to A2 for #1, #5, #6 and use A1 for #4 (because conflict-toast requires both clients to actually exchange a Realtime delta, so a warm channel is load-bearing).

**Family B — Migration state machine timing (#2, #3)** — `migrate-resume.spec.ts` already concedes "the state machine may finish very fast in test scenarios" by using `migrating.or(allDone)` matchers. The 12s budget is likely tight against CI's cold Realtime. **Fix shape:** raise the 12s budget to 20s and add a side-channel test hook `window.__leanshot_migration_state__` (this exact hook is even named in `.planning/deferred-tests.md` line 33). Plus: for #3, ensure the partial `migration_state` injected via the v4 blob actually reaches Zustand by the time the modal first renders — the test seeds `partial` via `seedAndSignIn` before navigation, so verify the seeded shape survives the hydrate → migrate path.

**Family C — Toast lifecycle (#4 secondary cause)** — Toast component has `durationMs` (06-01 wired this). LWW conflict toast may dismiss before the test sees it if the loser's reconnect fires fast. **Fix shape:** assert on toast content immediately via `page.getByText('We kept your most recent edit.')` with `expect.poll` semantics on a 10s window, OR make conflict toasts sticky (non-auto-dismiss) until user dismisses.

**Family D — Fixture preconditions (#7)** — `signout-cache-clear.spec.ts:60` seeds `acknowledgedDisclaimer='v1'` AFTER sign-in but BEFORE clicking sign-out. In CI's preview build, the per-user namespaced storage (Phase 5 D-12 / 05-05) may use a different key shape than `leanshot_v4*` — so the seed loops over `Object.keys(localStorage).filter((k) => k.startsWith('leanshot_v4'))` and finds zero matches. **Fix shape:** read the active storage namespace from `createNamespacedStorage`/`setActiveStorageUserId` exports (Phase 5 D-12), seed the user-scoped key explicitly, and assert on that same key post-signout. Inspect `05-05-SUMMARY.md` for the exact key shape (memory: `project_phase5_uat_gaps.md`).

### Test infrastructure to verify in 07-01

- **`playwright.config.ts`** — CI uses preview (4173), local uses dev (5173). Single worker on CI. Already retries once on CI. **Recommendation:** raise `timeout: 30_000` to `60_000` for the 4 realtime specs via `test.setTimeout(60_000)` calls; that's a non-invasive, spec-scoped change.
- **Fixtures directory** — `e2e/fixtures/` contains only `sample.jpg`; helper functions like `seedUserAndSignIn`, `gotoMedicationTab`, `seedAndSignIn`, `makeV4Blob` are inlined in the spec files themselves. The fix pass should resist the urge to refactor into shared helpers (scope creep).

### Acceptance for 07-01

```bash
# 1. No DEFERRED markers remain
grep -rn "DEFERRED: see leanshot/.planning/deferred-tests.md" leanshot/e2e/
# Expected: 0 matches

# 2. Full Playwright run passes
npm run test:e2e
# Expected: 11 specs total, 11 pass

# 3. Set status: closed in deferred-tests.md frontmatter (do NOT delete the file)
```

### Why batch and not 7 separate plans

Per memory `feedback_defer_then_batch_fix_pattern.md` and `.planning/deferred-tests.md` line 30-34: same likely root cause across 4 of 7 (Family A). One commit batch is cheaper than 7 separate cycles. **The plan should structure as one task per family (4 tasks total: A, B, C, D) and merge as one PR.**

---

## §2: Plan 07-02 — Legal-page hosting + footer wiring

### Three viable hosting shapes

| Shape | Files | Routing | Bundle impact | Verdict |
|-------|-------|---------|---------------|---------|
| **A: SPA hash routes** (`#/legal/privacy`) | `src/components/legal/PrivacyPolicy.tsx` etc. | New view branch in `App.tsx` derived from `window.location.hash` | +5-8 kB gz per policy (rendered as React components) | Consistent with the rest of the app (no router); marketing/dashboard split preserved |
| **B: Static MD via Vercel rewrites** | `/public/legal/*.md` + Vercel rewrite to `/legal/index.html` markdown viewer | URL-based routing | Zero SPA bundle impact | Cleanest from a bundle perspective; but adds Vercel-rewrite + MD-renderer infra |
| **C: Markdown components in marketing build** | `src/components/marketing/legal/*.tsx` lazy-loaded | Lazy-route via `import('@/components/marketing/legal/...')` | Lazy chunks only — does not hit the entry budget | Reuses existing marketing chunk topology (Phase 2.1) |

**Recommendation:** Shape A (SPA hash routes) — lowest infrastructure delta. The 3 policies as plain React components (~10-15kB total gz, lazy-loaded). Consistent with the existing auth hash-route pattern (`#/auth/signin`, `#/auth/signup`) already in `Landing.tsx:174` and `SettingsPage.tsx:174`. The bundle-size guard threshold (50 kB) tolerates this if components are lazy-imported behind `React.lazy(() => import('@/components/legal/...'))`.

### Footer wiring (Landing.tsx:577-581)

Currently plain `<li>Privacy policy</li>` — no anchors. Replace with:

```tsx
<li><a href="#/legal/privacy" className="hover:underline focus-visible:underline">Privacy policy</a></li>
<li><a href="#/legal/consumer-health" className="hover:underline focus-visible:underline">Consumer health data (WA residents)</a></li>
<li><a href="#/legal/terms" className="hover:underline focus-visible:underline">Terms of service</a></li>
<li><a href="#/legal/disclaimer" className="hover:underline focus-visible:underline">Medical disclaimer</a></li>
```

**WMHMDA requires the CHDP link be CONSPICUOUS on the homepage** (RCW 19.373.030(1)(b)) — verify the link is not buried below the fold on mobile. Footer placement is acceptable per current industry interpretation (Termsfeed, Securiti), but consider a visible "Washington residents" pill near the top of the marketing page if the planner wants belt-and-suspenders.

### Authenticated app footer

The SPA at `app.leanshot.app` does NOT currently have a footer (only Landing.tsx does). **Decision needed:** add a `<LegalFooter />` to `AppShell.tsx` for parity (privacy + CHDP + terms + medical disclaimer all linkable from inside the app). The current Settings → Privacy section is hidden behind a click — WMHMDA wants conspicuous from the homepage. The SPA's homepage IS the dashboard (no marketing in the app subdomain).

---

## §3: Plan 07-03/07-04 — Policy authoring (COMPL-01, COMPL-02)

### WMHMDA structural anchors (RCW 19.373.030) — verified primary source

Per [RCW 19.373 (Washington State Legislature)](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true): consumer health data privacy policy must clearly and conspicuously disclose **5 categories of information**:

1. Categories of consumer health data collected and the purpose
2. Categories of sources from which consumer health data is collected
3. Categories of consumer health data that is shared
4. List of categories of third parties and specific affiliates with whom CHD is shared
5. How a consumer can exercise rights provided in RCW 19.373.040 (access, withdraw consent, deletion)

Plus: must be linked **prominently from homepage**, **opt-in consent required**, **separate opt-in for sharing**, **data minimization**, **security controls**, **processor contracts**, **signed authorization to sell** (CHDP doesn't permit sale without explicit auth — LeanShot doesn't sell, so this becomes a no-op disclosure).

[CITED: app.leg.wa.gov/RCW 19.373]

### FTC HBNR 2024 amendment (16 CFR Part 318) — verified

Per [FTC final rule announcement (April 2024)](https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule) and [Federal Register](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule): effective **July 29, 2024**, the HBNR explicitly applies to "health apps and connected devices not covered by HIPAA" — LeanShot is squarely in scope.

Notification clock requirements (LOCKED, verified):
- **Breaches involving 500+ people:** notify FTC at the same time as affected individuals — without unreasonable delay, **no later than 60 calendar days** after discovery.
- **Breaches involving < 500 people:** notify FTC annually, no later than 60 calendar days after year-end; affected individuals still get notice within 60 days of discovery.

Notable 2024 changes:
- "Breach of security" now includes **unauthorized disclosure** (not just unauthorized acquisition) — so accidentally CC-ing PHR data triggers notification.
- Electronic notice to individuals is allowed.

[CITED: ftc.gov + federalregister.gov]

### Template vendor comparison

| Vendor | Free tier WMHMDA-aware? | License terms | Output format | Verdict |
|--------|-------------------------|---------------|---------------|---------|
| **Termly** | Yes (per [termsfeed/termly comparison](https://www.termsfeed.com/blog/washington-wmhmda-health-data-act/)) — but their WMHMDA-specific policy may be paid-tier | Generated content licensed for the user's site | HTML embed + .md | Strong candidate; verify WMHMDA module is in free tier before committing |
| **iubenda** | Generic privacy generator; WMHMDA-specific is paid | Embedded | HTML | Weaker for WMHMDA specifically |
| **GitHub OSS templates** (e.g., `nayafia/privacy-policy-template`, `gitstrap/privacypolicy`) | Generic — no WMHMDA-specific section | MIT or similar | Markdown | Use as starting skeleton; bolt on WMHMDA section hand-written from RCW 19.373 |
| **Hand-rolled from RCW 19.373** | N/A — author writes from statute | N/A | Markdown | Lowest risk re: license; highest authoring effort; most defensible "I read the statute" claim |

**Recommendation:** **Termly free for the generic privacy policy + terms** (well-known, widely used, accepted by most app stores). **Hand-rolled CHDP from RCW 19.373** (one document, ~3-4 pages, 5 mandatory sections + how-to-exercise-rights, ~half a day's drafting). This produces ≥ 2 sources cross-referenced per the orchestrator brief.

### Plan split recommendation

- **07-03:** WMHMDA CHDP policy (hand-rolled, RCW 19.373 anchored). Single component or MD file. Word count target: 1500-2500 words. Includes all 9 LeanShot data categories enumerated.
- **07-04:** Generic privacy policy + terms + medical disclaimer (Termly-derived, edited for LeanShot specifics). 3 documents.

OR combine into one plan if granularity is too fine — let the planner decide based on `granularity: fine` config.

### Data categories LeanShot collects (verified from store.ts, types/index.ts, ai_messages migration)

```
injections, weights, measurements, meals, water, foodNoise, workouts, steps,
supplements, mood, sleep, nsvs, photos, vials, costs, symptoms, settings,
aiHistory (in ai_messages), pendingOps queue
```

Plus auth metadata: email, password hash (Supabase Auth, not stored by app), session tokens. Plus operational: rate_limit_counters (Phase 4), audit_logs (Phase 7 new).

Every policy must enumerate the data-category list explicitly per WMHMDA §1. Use this list verbatim in 07-03.

---

## §4: Plan 07-05 — HBNR registration filing + incident-response runbook (COMPL-03)

### Two deliverables

1. **HBNR registration is NOT an FTC-managed registration** — there is no "register your app with the FTC HBNR" enrollment process. The HBNR is a **rule** that applies automatically to in-scope entities. COMPL-03's "registered for FTC HBNR compliance" wording is a slight misnomer in the requirements doc.

   The relevant FTC artifacts are:
   - The [Notice of Breach of Health Information form](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) — submitted ONLY when a breach occurs.
   - A documented internal compliance posture (incident response plan + breach decision tree + on-call list) — what COMPL-03 actually requires.

   **Recommendation:** rewrite COMPL-03's wording in the planner's plan-check (or as a note in 07-05's plan) — there's no registration confirmation number to capture, only an internal runbook to publish. **One human-checkpoint task:** founder documents acknowledgement that they understand HBNR applies + commits to using the FTC's online form within the 60-day window if a breach occurs. Save as `.planning/decisions/hbnr-compliance-acknowledgement.md`.

2. **Incident-response runbook** — committed to repo at `.planning/runbooks/incident-response-hbnr.md`. Structure:

   - **Detection triggers** (Sentry alerts, Supabase unusual-activity flags, user reports, etc.)
   - **Breach-decision tree** (is it a breach of security per 16 CFR 318? — unauthorized acquisition OR disclosure of PHR identifiable health information)
   - **60-day clock** mechanics (clock starts at "discovery"; document what "discovery" means)
   - **Notification artifacts** (individual notice template, FTC form link, < 500 vs ≥ 500 person paths, media notice triggered at 500+)
   - **On-call escalation** (founder is sole on-call for v1; sequence: validate → assess scope → engage counsel → notify within 60d)
   - **Post-incident review** (root cause + audit_logs forensic review + customer comms)

---

## §5: Plan 07-06 — Settings data export (COMPL-06 export half)

### Current state

`SettingsPage.tsx:94-122` has `exportData()` — local-only JSON export, no cloud entities, no PDF. Lines 95-113 list all 17 entities pulled from `fullState`. **This is the extension point.**

### Required deltas

1. **Add cloud-fetched entities** that may not be in `fullState` due to Realtime sync race or initial pull state: re-fetch from Supabase as ground truth, merge with local. The 9 sync tables (`injections`, `weights`, `meals`, `workouts`, `supplements`, `mood`, `sleep`, `symptoms`, `vials`, `settings`) + `ai_messages` + `photos` (with signed URLs valid for download window).
2. **Photos export** — fetch each photo via signed URL, embed as base64 in JSON OR include a separate `photos.zip` from a server-side bundling endpoint. For free-tier and v1, embed-as-base64 in JSON is simplest; warn user "Export may be large with photos" if photo count > 10.
3. **PDF generation** — readable patient-facing rollup.

### PDF library choice (verified versions)

| Library | Version (verified npm view 2026-05-12) | Bundle size | Verdict |
|---------|---------------------------------------|-------------|---------|
| **jsPDF** | 4.2.1 [VERIFIED] | ~150 kB min, ~50-60 kB gz (estimate from npm-compare) | Mature, widely used, supports tables via `jspdf-autotable` plugin. Best for procedural PDF layout. |
| **pdfmake** | 0.3.8 [VERIFIED] | ~250 kB min, larger than jsPDF | Declarative; richer styling/tables. Heavier. |
| **@react-pdf/renderer** | 4.5.1 [VERIFIED] | Smallest per npm-compare; React-component DSL | Best for React-heavy layouts; but introduces another renderer. |

**Recommendation:** **jsPDF + jspdf-autotable** — best balance of bundle weight and tabular-data ergonomics for a patient health rollup (lots of tables: injections by date, weights by date, etc.). Lighter than pdfmake; less abstraction than @react-pdf/renderer.

### MANDATORY: deferred-init wrapping for PDF

Per memory `project_phase5_bundle_regression.md` + Phase 6 D-12: **direct static imports of jsPDF in App.tsx/main.tsx/store.ts are regressions blocked by the bundle-size CI guard.** The 50 kB index gz ceiling cannot absorb a 50 kB-gz jsPDF on top.

**Pattern:** dynamic-import jsPDF inside the export click handler:

```tsx
async function handleExportPDF() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF();
  autoTable(doc, { /* ... */ });
  doc.save('leanshot-rollup.pdf');
}
```

This forces jsPDF into its own lazy chunk. Add an explicit bundle-size assertion in CI:

```bash
# scripts/assert-bundle-budget.sh additions
test "$(du -k dist/assets/jspdf-*.js | awk '{print $1}')" -gt 30 || \
  { echo "ERROR: jspdf chunk too small — likely static-imported"; exit 1; }
```

### Settings UI shape

Replace `SettingsPage.tsx:323-355` Data section with:

```tsx
<Section title="Data" body="Export, import, or wipe your record.">
  <Button variant="ghost" leadingIcon={<Download />} onClick={exportJSON}>Export JSON</Button>
  <Button variant="ghost" leadingIcon={<FileText />} onClick={exportPDF}>Export PDF rollup</Button>
  {/* + existing replay-tour + reset-everything */}
</Section>
```

Plus a new "Recovery" Section for D-05 (see §8) and a new "Delete account" affordance in Privacy section (see §6).

---

## §6: Plan 07-07 — Account-delete + crypto-shred (COMPL-06 delete half + D-03)

### State machine

```
ACTIVE ──[user confirms typed]──> PENDING_SHRED (T+0..T+30d)
   │                                   │
   │                                   ├──[user undoes via support magic-link]──> ACTIVE
   │                                   │
   │                                   └──[T+30d cron fires]──> SHREDDED (irreversible)
   │
   └──[user signs up again with same email at T+5d]──> NEW user_id (fresh ACTIVE)
       (old user_id remains PENDING_SHRED)
```

### T+0 admin RPC (server-side only)

```sql
create or replace function public.initiate_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Caller MUST be either the user themselves or service_role
  if auth.uid() != p_user_id and auth.role() != 'service_role' then
    raise exception 'Unauthorized';
  end if;

  -- Mark for shred; the auth.users row stays ACTIVE so the magic-link undo works
  insert into pending_account_deletions (user_id, requested_at, target_shred_at)
  values (p_user_id, now(), now() + interval '30 days')
  on conflict (user_id) do nothing;

  -- Audit-skeleton (D-03 spec)
  insert into audit_logs (timestamp, action, user_id_hash, ip_hash, table_name, before_hash, after_hash)
  values (
    now(),
    'account_deleted_initiated',
    encode(digest(p_user_id::text, 'sha256'), 'hex'),
    encode(digest(coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''), 'sha256'), 'hex'),
    null, null, null
  );

  -- Move photos to crypto-locked prefix (cron job will hard-delete + key-destroy at T+30)
  -- For free-tier: just rename the path prefix. Per D-02, "key" = Storage default at-rest key
  -- destroyed at the Storage-bucket level via removal; per-user envelope encryption is deferred.
end;
$$;
```

### T+30 cron worker (pg_cron, mirrors Phase 4 pattern)

```sql
-- New migration: 20260601000000_account_deletion_cron.sql
create extension if not exists pg_cron;

select cron.schedule(
  'finalize-account-deletions',
  '0 4 * * *',  -- daily 04:00 UTC, 1 hour after anon-cleanup (03:00 UTC)
  $$
    -- Pick all accounts whose shred window has elapsed
    with to_shred as (
      select user_id from pending_account_deletions
      where target_shred_at < now()
      for update skip locked  -- idempotent re-run safe
    )
    -- Cascade-delete via auth.admin.deleteUser (cron CAN'T directly call admin API;
    -- use an Edge Function trigger instead — see below for the architecture choice)
    select 1;
  $$
);
```

**Architecture choice — pg_cron alone vs pg_cron + Edge Function:**

pg_cron cannot invoke `auth.admin.deleteUser` (which is a Supabase Admin API call, not a SQL function). Three options:

1. **pg_cron → Edge Function via `pg_net` extension** — pg_cron POSTs to an Edge Function that calls `auth.admin.deleteUser` with service-role key. Cleanest separation; mirrors [Supabase scheduling docs](https://supabase.com/docs/guides/functions/schedule-functions).
2. **pg_cron → direct `auth.users` DELETE** — cascade-deletes everything (auth.users has ON DELETE CASCADE FKs from public.injections, ai_messages, rate_limit_counters, etc.). Simpler; no Edge Function. But: doesn't sign out sessions cleanly (those expire via JWT TTL naturally; acceptable).
3. **Vercel Cron + admin RPC** — schedule a Vercel cron that calls a Next-API-route which calls `auth.admin.deleteUser`. Adds a Vercel route (LeanShot doesn't currently have API routes; the marketing build is static).

**Recommendation:** **Option 2** (direct `auth.users` DELETE in pg_cron) for simplicity. Phase 4's anon-cleanup cron uses this exact pattern (`delete from auth.users where is_anonymous = true and ...`). Cascade-delete already covers ai_messages + rate_limit_counters; Phase 5/6 migrations add the 9 sync tables to the cascade. **Storage objects must be deleted by a separate cron step** (Storage cascade is NOT automatic per Supabase docs — see [photo-cross-device.spec.ts:135-145 teardown](file:///e2e/photo-cross-device.spec.ts) which manually `list + remove` Storage objects).

### Storage shred mechanism (free-tier, D-02)

Per [Supabase security docs](https://supabase.com/security): all storage encrypted at rest with AES-256 by default. **The "key destruction" in D-03 is not literally destroying a Supabase-managed key** (only Supabase has those keys; we can't destroy them on free tier). It means: **delete the Storage objects** — once the bytes are deleted, the AES-256 encryption-at-rest renders any backup tape recovery cryptographically uncertain. The audit skeleton records the deletion timestamp; this is the defensible interpretation of "crypto-shred" on free tier.

If D-02's upgrade trigger fires, revisit: per-user envelope encryption with pgsodium (now in deprecation cycle per [supabase.com/docs/guides/database/extensions/pgsodium](https://supabase.com/docs/guides/database/extensions/pgsodium)) or Supabase Vault successor. Deferred per CONTEXT.md.

[CITED: supabase.com/security]

### Edge cases the planner MUST address

1. **Partial-shred resume** — cron worker fails mid-loop after deleting some tables but not others. `pending_account_deletions.target_shred_at < now()` filter ensures next-day cron picks it back up. `auth.users` row deletion must be the LAST step in the cron logic so a failed cascade-delete-then-retry stays addressable.
2. **Storage orphans** — cron deletes auth.users row, but photo objects in Storage remain. **Fix:** the cron worker explicitly `storage.list + remove` BEFORE the `delete from auth.users` step. Or: a follow-up daily cron at 05:00 UTC that lists Storage paths with no matching public.photos row and removes them.
3. **Same email re-signs up during pending shred** — `auth.users(email)` has a unique index. **Two sub-options:**
   - **B1:** Treat the new sign-up as new user (new user_id, fresh state). The old user_id stays in PENDING_SHRED. The email reuse requires the old user_id to either complete shred (which deletes the auth.users row → frees the email) OR be undone (which keeps the email locked). **Conflict:** the new sign-up can't take the email until the old shred completes. UX: show "This email is associated with a recently deleted account. Use a different email or contact support."
   - **B2:** Allow undo from the new sign-up page (link "Restore previous account?" if email matches pending-shred). More complex; consider for v1.5.
   
   **Recommendation:** **B1 with explicit error copy.** Document in user-facing T+0 confirmation flow: "After the 30-day window, this email is freed for new sign-ups."
4. **Idempotent re-run** — `for update skip locked` in the cron SQL handles concurrent execution. `on conflict do nothing` in the initiate RPC handles double-click on Delete button.

### Typed-confirmation UI

```tsx
<Modal title="Delete my account">
  <p>Type your email to confirm. This starts a 30-day soft-delete; after 30 days your data is permanently destroyed and unrecoverable.</p>
  <Input label="Email" value={typed} onChange={...} />
  <Button destructive disabled={typed !== signedIn.user.email} onClick={initiateDelete}>
    Delete in 30 days
  </Button>
</Modal>
```

Place in Settings → Privacy section (line 294), below the existing "Your data lives on this device" copy. Reuse existing `Modal.tsx` + `Input.tsx` + `Button.tsx variant='destructive'` (no new UI primitive needed per CONTEXT.md §code_context).

### New table: `pending_account_deletions`

```sql
create table public.pending_account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  target_shred_at timestamptz not null,
  undo_token text  -- random token sent to user's email at T+0
);

alter table public.pending_account_deletions enable row level security;

create policy "pending_account_deletions_select_own"
  on public.pending_account_deletions
  for select using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- Service role and the SECURITY DEFINER initiate RPC bypass.
```

**RLS proof test required** per project memory `reference_supabase_project.md`: cross-tenant impersonation against `pending_account_deletions`. Add to `e2e/rls-multi-table.test.ts`.

---

## §7: Plan 07-08 — Audit log (D-04)

### Schema (single table, mirrors injections shape)

```sql
-- 20260601000001_audit_logs.sql
create table public.audit_logs (
  id bigserial primary key,
  timestamp timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,  -- null after account shred
  user_id_hash text,  -- sha256(user_id) — survives auth.users deletion for the skeleton row
  table_name text not null,
  row_id text,         -- composite key serialized; null for non-row actions
  action text not null check (action in (
    'insert', 'update', 'delete',
    'account_deleted_initiated', 'account_deleted_finalized'
  )),
  before_hash text,    -- sha256(canonical_json(OLD)) — null for inserts
  after_hash text,     -- sha256(canonical_json(NEW)) — null for deletes
  ip_hash text         -- sha256(x-forwarded-for) — null if not available
);

create index audit_logs_user_timestamp_idx
  on public.audit_logs (user_id, timestamp desc);

create index audit_logs_action_idx
  on public.audit_logs (action) where action like 'account_deleted_%';

alter table public.audit_logs enable row level security;

-- Users can see their own; no INSERT/UPDATE/DELETE from authenticated role
create policy "audit_logs_select_own"
  on public.audit_logs
  for select using (auth.uid() = user_id);

-- Service-role bypass for the trigger context (service_role bypasses RLS by default in Supabase)
```

### Trigger shape (one per sync table)

```sql
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  v_before text;
  v_after text;
  v_row_id text;
begin
  -- Hash old/new for tamper-evidence; we store HASHES not the row to keep
  -- PII out of the indefinite-retention skeleton path.
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_before := encode(digest(row_to_json(old)::text, 'sha256'), 'hex');
  end if;
  if tg_op = 'UPDATE' or tg_op = 'INSERT' then
    v_after := encode(digest(row_to_json(new)::text, 'sha256'), 'hex');
  end if;

  -- Build composite row_id (works for both injections-shape and supplements-shape)
  v_row_id := coalesce(
    (case when tg_op = 'DELETE' then old else new end)::text,
    ''
  );

  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    coalesce(new.user_id, old.user_id),
    encode(digest(coalesce(new.user_id, old.user_id)::text, 'sha256'), 'hex'),
    tg_table_name,
    v_row_id,
    lower(tg_op),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

-- Apply to all 9 sync tables (and ai_messages? — Phase 4 already RLS-scopes it)
create trigger audit_injections after insert or update or delete
  on public.injections for each row execute function audit_trigger();
-- ... repeat for weights, meals, workouts, supplements, mood, sleep, symptoms, vials, settings
```

### Retention policy

```sql
-- 13-month retention for the full per-write log; indefinite for account-delete skeleton
select cron.schedule(
  'cleanup-audit-logs',
  '0 5 * * *',
  $$
    delete from public.audit_logs
    where timestamp < now() - interval '13 months'
      and action not like 'account_deleted_%';
  $$
);
```

**Why 13 months:** spec'd by CONTEXT D-04 ("13 months covers an annual reporting cycle + 1 month buffer; planner can adjust ±90d with rationale"). HBNR's 60-day notification clock is well-bounded inside 13mo; an annual security review reads the full year of audit history.

**Why hashes not rows:** GDPR/WMHMDA right-to-erasure compatibility. Hashes are not "personal data" once the auth.users row is gone (no rainbow-table attack on uuid hashes by design). The skeleton subset stays forever; the full per-write rows roll off at 13mo.

### Hash canonicalization

`row_to_json()` is NOT deterministic across Postgres versions for column ordering. **Risk:** before/after hashes appear to change even when row didn't. **Mitigation:** if hash comparison is ever load-bearing (currently it's not — hashes are tamper-evidence only), introduce a `canonical_json(row)` wrapper that sorts keys. Out of scope for v1 since no consumer compares hashes.

### Migration order constraint

`audit_logs` MUST be created BEFORE the triggers reference `public.audit_logs`. **Plan structure:**

1. Migration A: create `audit_logs` table + RLS + cron.
2. Migration B: create `audit_trigger()` function + 9 trigger ATTACH statements (one per existing sync table).
3. **Backfill is NOT required** — audit history starts at trigger-attach time. CONTEXT.md does not require backfilling Phase 5/6 writes. Document this in the plan.

### RLS proof test required

Per project memory: add `e2e/rls-audit-logs.test.ts` — cross-tenant impersonation proving user A cannot see user B's audit rows even with maximally-permissive client query. Mirror `rls-multi-table.test.ts` shape.

---

## §8: Plan 07-09 — Restore-from-backup UI (D-05)

### Backup file shape (verified from Phase 6 D-03)

```ts
{
  state: PersistedState,     // the v7-shape partialized Zustand state
  version: 7,
  snapshotAt: ISO            // ISO datetime
}
```

Stored at `localStorage['leanshot_v4_pre_cloud_backup']`. Retention: 90 days from snapshotAt (Phase 6's periodic cleanup may have removed it).

### Settings UI placement (new "Recovery" Section)

Between "Privacy" and "Subscription" sections per CONTEXT D-05 spec. Match existing `Section` wrapper shape (`SettingsPage.tsx:388-397`).

```tsx
{section === 'recovery' && (
  <Section title="Recovery" body="Restore a backup snapshot from before cloud sync.">
    {!backupExists ? (
      <Card variant="flat"><p>No local backup found. Backups are created automatically before cloud migration and retained for 90 days.</p></Card>
    ) : (
      <>
        <p>Snapshot taken: <strong>{backup.snapshotAt}</strong></p>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Restore from this backup
        </Button>
      </>
    )}
  </Section>
)}
```

### Confirmation modal contract

```tsx
<ConfirmModal
  open={confirmOpen}
  title="Restore from backup?"
  message="This will overwrite your current data with the backup from {snapshotAt}. Your cloud sync state will be replaced. Continue?"
  destructive
  confirmLabel="Restore and overwrite"
  onConfirm={async () => {
    const backup = JSON.parse(localStorage.getItem('leanshot_v4_pre_cloud_backup')!);
    useStore.setState(backup.state, true);  // `replace=true` — full replace, partialized
    toast('Backup restored. Your data has been replaced.', 'success');
    onClose();
  }}
/>
```

**Critical:** `useStore.setState(backup.state, true)` MUST use the partialized shape (Phase 6 D-03 wrote partialized shape into the backup, so this Just Works). Verify the backup shape matches current STORAGE_VERSION (v7); if not, run the migration chain.

**Behavior after restore:**

- Local Zustand becomes the backup's state.
- Cloud sync engine sees a divergence on next reconnect → LWW kicks in. Server has newer `updated_at` for any row updated since the snapshot; those server rows will overwrite the restored local rows on next pull. **This may not match user expectation** — user wanted to "go back to the snapshot," but Realtime will re-overwrite.
- **Solution: sign the user out** after restore. Force a clean re-sign-in so all server rows pull fresh against the restored local state, and LWW resolves deterministically. Document this in user-facing copy: "After restoring, you'll be signed out. Sign back in to re-sync with the cloud."

Alternative (heavier): introduce a `local_overrides` table or a "force-push from this device" mode. Out of scope for v1; document the LWW gotcha in confirmation copy.

### Edge cases

- **Backup is older than current STORAGE_VERSION** — run migration chain (existing migrate function in storage.ts).
- **Backup is corrupted JSON** — catch parse error, show "Backup file is corrupted; contact support" toast.
- **Backup doesn't exist** — hide the Restore button; show empty-state copy.
- **Backup is from a different `user_id`** — Phase 6 D-03 saved against `leanshot_v4` key (pre-cloud), not namespaced. After Phase 5 D-12 namespaced storage, the backup is essentially "the last local-only state before this device went cloud-first." Restoring it onto a different signed-in user is a semantic mismatch. **Guardrail:** show the backup's `state.user.id` (or name) in the confirmation modal, and disable the button if it doesn't match the current signed-in user.

---

## §9: Plan 07-10 — `s.user!` codebase sweep (D-06)

### Verified inventory

```
$ grep -rn "(s) => s\.user!" leanshot/src/
14 matches across 14 files (1 per file except SimpleCharts.tsx which has 2):

src/components/dashboard/cards/EffectivenessCard.tsx:9
src/components/dashboard/cards/GLPCurveCard.tsx:18
src/components/dashboard/cards/HeroCard.tsx:18
src/components/dashboard/ai/AIChatPanel.tsx:40
src/components/dashboard/charts/SimpleCharts.tsx:14
src/components/dashboard/charts/SimpleCharts.tsx:54
src/components/dashboard/modals/DoctorReport.tsx:12
src/components/dashboard/modals/PhotoCompareModal.tsx:10
src/components/dashboard/settings/SettingsPage.tsx:57
src/components/dashboard/share/ShareCardModal.tsx:18
src/components/dashboard/tabs/BodyTab.tsx:32
src/components/dashboard/tabs/InsightsTab.tsx:19
src/components/dashboard/tabs/NutritionTab.tsx:16
```

(Plus a doc-comment match in `MedicationTab.test.tsx:25` that's NOT a code occurrence — exclude from sweep.)

### Pattern (verified from MedLevelChart.tsx:13-22)

Replace:

```tsx
const u = useStore((s) => s.user!);
// ... use u.medication, u.units, etc.
```

With:

```tsx
const u = useStore((s) => s.user);
// ... existing hooks (useMemo, etc.) — keep hook order stable
if (!u) return null;
// ... rest of component uses u as User (narrowed by the guard)
```

**Rules of Hooks compliance:** the early-return MUST come AFTER all hook calls in the component. For components that call other `useStore` selectors or `useMemo` after the user selector, restructure so all hooks run unconditionally, then early-return. The `useMemo` body must short-circuit on `null` (see MedLevelChart pattern).

### Test impact

Some existing tests (e.g., `MedicationTab.test.tsx`) intentionally test the null-user path to verify the existing crash. Those tests need updating to assert "renders null (or empty state) when user is null" instead. Audit each affected component's test file as part of the per-file commit.

### Commit cadence

CONTEXT D-06 spec: **one commit per file**. 14 files → 14 commits. Pure refactor; should be near-zero behavioral change. Run `npm run typecheck && npm run lint && npm run test` between each commit (fast loop).

### Acceptance

```bash
grep -rn "s\.user!" leanshot/src/
# Expected: 0 matches in source files (exclude .test.tsx doc comments via filter if needed)

npm run typecheck && npm run lint && npm run test && npm run test:e2e
# All green
```

---

## §10: Footer wiring + legal-page-hosting (covered in §2 + bundled into 07-02)

See §2. Single plan covers footer wiring + 3-4 legal-page React components + hash-route handling in `App.tsx`.

---

## Runtime State Inventory

> Phase 7 is partially a refactor phase (D-06) and partially a fresh-feature phase (D-01..05, D-07). Refactor-relevant inventory below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (a) `localStorage['leanshot_v4_pre_cloud_backup']` (D-05 input — existing Phase 6 artifact). (b) Cloud rows in 9 sync tables (account-delete RPC must cascade). (c) `auth.users` row (deletion target). (d) Storage objects under `{userId}/photos/*` (T+30 cron must `list + remove`). | New `pending_account_deletions` + `audit_logs` tables; T+30 cron worker. |
| **Live service config** | (a) Supabase Auth URL allowlist (Phase 5 G1) — unchanged by Phase 7. (b) Supabase pg_cron jobs: existing `cleanup-anon-users` (03:00 UTC); new `finalize-account-deletions` (04:00 UTC) + `cleanup-audit-logs` (05:00 UTC). | Two new pg_cron jobs deployed via migrations. |
| **OS-registered state** | None — LeanShot is a browser-only SPA. | None. |
| **Secrets/env vars** | None new in Phase 7. Existing: `SUPABASE_SERVICE_ROLE_KEY` (used by e2e specs + would be used by an Edge Function if Option-2 of §6 is chosen). | None — admin operations use existing service-role key. |
| **Build artifacts / installed packages** | `npm install jspdf jspdf-autotable` adds new lazy-chunk dependencies. Bundle CI assertion must update to expect the new jsPDF chunk file. | One-time `npm install`; CI script update. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project (existing) | All cloud-touching plans | ✓ | Phase 4 provisioned `ytnsipxxmzgaebkqmokp` | — |
| pg_cron extension | T+30 shred + audit retention crons | ✓ | Active since Phase 4 anon-cleanup migration | — |
| `auth.users` cascade FK pattern | Account-delete | ✓ | Verified in Phase 5 injections migration | — |
| `pgcrypto` extension (`digest` function) | Hash generation in audit triggers | Need to verify | Default in Supabase | `create extension if not exists pgcrypto;` prefix |
| Supabase Admin API (`auth.admin.deleteUser`) | If using §6 Option 1 (Edge Function) | ✓ (verified in e2e teardown patterns) | — | Use Option 2 (direct `auth.users` delete) |
| `jspdf` 4.2.1 + `jspdf-autotable` | PDF export (07-06) | ✗ (not installed) | — | None — must install |
| `pg_net` extension | If using §6 Option 1 (pg_cron → Edge Function) | Need to verify | Available in Supabase | Use Option 2 (no `pg_net` needed) |

**Missing dependencies with no fallback:** None blocking.
**Missing dependencies with fallback:** `pg_net` (only if planner chooses Option 1 for T+30 worker; recommend Option 2).
**Must install:** `jspdf@^4.2.1` + `jspdf-autotable@^3.x` (verify current major at install time).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + React Testing Library (component) + Playwright (e2e) + supabase-js cross-tenant RLS proofs |
| Config files | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npm run test` (vitest + RTL only) |
| Full suite command | `npm run test && npm run test:e2e && npm run test:e2e:rls` |
| Phase gate | Full suite green before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| COMPL-01 | Privacy policy reachable from footer + landing footer + lists all 17 data categories | e2e + content-grep | `npm run test:e2e -- legal-pages.spec.ts` | ❌ Wave 0 |
| COMPL-02 | CHDP policy linked conspicuously from homepage + grep for 5 WMHMDA structural anchors | e2e + content-grep | `npm run test:e2e -- legal-pages.spec.ts` | ❌ Wave 0 |
| COMPL-03 | `.planning/runbooks/incident-response-hbnr.md` exists + has all required sections | unit | `npm test -- compl-03-runbook.test.ts` | ❌ Wave 0 |
| COMPL-06 export | Settings → Export JSON includes all entities; PDF generates without static-bundled jsPDF | unit + e2e + bundle | `npm test -- export-data.test.ts && npm run test:e2e -- settings-export.spec.ts && npm run assert:bundle` | ❌ Wave 0 |
| COMPL-06 delete | Settings → Delete account → typed-confirm → pending_account_deletions row created → admin query confirms zero rows after T+30 simulated tick | e2e | `npm run test:e2e -- account-delete.spec.ts` | ❌ Wave 0 |
| D-04 audit log | Insert into injections fires audit_logs trigger; user cannot see other user's audit rows (RLS proof) | unit + RLS proof | `npm test -- audit-trigger.test.ts && npm run test:e2e:rls -- rls-audit-logs.test.ts` | ❌ Wave 0 |
| D-05 restore-from-backup | Restore button hidden when no backup; modal shows snapshot date; setState replaces store; sign-out after restore | unit + e2e | `npm test -- restore-backup.test.ts && npm run test:e2e -- restore-from-backup.spec.ts` | ❌ Wave 0 |
| D-06 `s.user!` sweep | `grep -rn "s\.user!" src/` returns 0 matches AND no test regressions | shell + existing suite | `! grep -rn "s\.user!" leanshot/src/ && npm test && npm run test:e2e` | ✅ existing tests cover behavior |
| D-07 e2e re-enable | All 7 deferred specs pass in CI; 0 DEFERRED markers remain | shell + e2e | `! grep -rn "DEFERRED: see leanshot/.planning/deferred-tests.md" leanshot/e2e/ && npm run test:e2e` | ✅ specs exist; need un-fixme |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run lint && npm run test` (vitest fast loop)
- **Per wave merge:** `npm run test:e2e` (Playwright) + `npm run test:e2e:rls` (cross-tenant RLS) + `npm run build && npm run assert:bundle`
- **Phase gate:** all of the above green + manual HBNR runbook review.

### Wave 0 Gaps

- [ ] `e2e/legal-pages.spec.ts` — verifies footer links resolve, page content contains WMHMDA + privacy structural anchors
- [ ] `src/components/dashboard/settings/SettingsPage.test.tsx` extension — restore-from-backup confirmation flow + delete-account typed-confirm
- [ ] `e2e/account-delete.spec.ts` — full T+0 → admin verifies pending_account_deletions row → simulated T+30 cron via `select cron.job_run('finalize-account-deletions')` → admin verifies zero rows in all tables
- [ ] `e2e/rls-audit-logs.test.ts` — cross-tenant RLS proof for new audit_logs table (mirror rls-multi-table.test.ts pattern)
- [ ] `e2e/settings-export.spec.ts` — JSON export downloads + PDF export downloads + bundle assertion that jsPDF is lazy-chunked
- [ ] `e2e/restore-from-backup.spec.ts` — seed leanshot_v4_pre_cloud_backup → click Restore → assert state replaced + sign-out triggered
- [ ] `src/test/audit-trigger.test.ts` (Vitest with Supabase test client) — insert into injections fires audit_logs row with correct hashes
- [ ] `scripts/assert-bundle-budget.sh` extension — assert `dist/assets/jspdf-*.js` chunk exists and is NOT in index chunk

---

## Threat Model (STRIDE for Phase 7 surfaces)

Per orchestrator brief: Phase 7 is the load-bearing threat-model phase of v1.

### Asset map

| Asset | Where stored | Who can read | Who can write |
|-------|-------------|--------------|---------------|
| User PII (email, profile) | `auth.users`, `users` slice in Zustand | User + service-role | User + service-role |
| Health data (9 sync tables) | Postgres rows | User (own only via RLS) | User (own only via RLS) |
| Photos | Supabase Storage `{userId}/photos/` | User (signed URL) | User (RLS + path) |
| AI conversation history | `ai_messages` | User (RLS) | Edge Function (service-role) |
| `audit_logs` (Phase 7 NEW) | Postgres rows | User (own only via RLS) | Trigger (security definer) ONLY |
| `pending_account_deletions` (Phase 7 NEW) | Postgres rows | User (own only via RLS) | `initiate_account_deletion` RPC (security definer) ONLY |
| Legal pages (privacy, CHDP, etc.) | Static React components in SPA bundle | Public | Repo commits only |
| HBNR runbook | `.planning/runbooks/incident-response-hbnr.md` | Repo readers (founder + Claude) | Repo commits only |
| Backup snapshot (D-05) | `localStorage['leanshot_v4_pre_cloud_backup']` per-device | Device user only | Phase 6 D-03 (snapshot creation), Phase 7 D-05 (read for restore) |

### STRIDE per surface

#### Spoofing

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Attacker impersonates user to trigger account-delete | Compromise of Supabase session | `initiate_account_deletion` checks `auth.uid() = p_user_id`; typed-email-confirmation UI; 30-day undo window via email magic-link |
| Attacker forges audit log row | Direct SQL injection into `audit_logs` | Trigger writes are SECURITY DEFINER; authenticated role has no INSERT policy on `audit_logs`; all writes go through trigger context |
| Forged HBNR breach notification (false alarm) | Phishing | Internal runbook — out of scope for app code |

#### Tampering

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Audit log tampering (CRITICAL) | Modify `audit_logs` rows to hide a breach | RLS denies UPDATE/DELETE to authenticated role; service-role is the only path. Optional hardening: hash-chain rows for tamper-evidence (deferred per scope; documented in §7). |
| Legal page tampering (privacy/CHDP modified post-publish) | Repo push without review | Branch protection on `main`; CI compliance-copy job (Phase 2 SC#5 grep pattern) already runs |
| Backup snapshot tampering | Attacker with device access modifies `leanshot_v4_pre_cloud_backup` | Out of scope — local-storage tampering is a local-attack vector; cloud sync's LWW resolves on re-sync |
| Account-delete bypass via direct table write | Authenticated user INSERTs into `pending_account_deletions` directly | No INSERT/UPDATE/DELETE policies for authenticated role on the table; only the SECURITY DEFINER RPC bypasses |

#### Repudiation

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| User denies they triggered account-delete | "I never clicked delete" | Audit log skeleton with `account_deleted_initiated` action survives the shred (retention indefinite per D-03); `ip_hash` captured at T+0; user-facing email confirmation sent at T+0 |
| User denies a write that LWW overwrote | Phase 6 D-11 conflict toast investigation | Audit log per-write history (13mo) records before/after hashes; support can match timestamps to user's local copy if they retain one |

#### Information Disclosure

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Cross-tenant data leak via audit_logs SELECT | User A queries user B's audit rows | RLS proof test required (project rule); `auth.uid() = user_id` policy |
| Soft-delete window abuse — re-signup with same email surfaces old account's data | Attacker registers compromised email | Email reuse blocked during pending shred (unique constraint on auth.users.email); document explicitly per CONTEXT D-03 |
| Export-PDF includes data not owned by user | Compromised RPC | All export reads go through supabase-js with user's JWT → RLS scopes automatically |
| Legal pages disclose more than needed | Privacy policy enumerates data categories | Already required by WMHMDA §1 — this is a feature, not a leak. PostHog disclosure must match actual telemetry footprint (verify with planner). |
| Backup contains data after restore | Stale backup-shape leaks since-deleted local data | Backup is local-storage only; cleared on signout per Phase 5 D-12 cleanup paths |
| `aiHistory` leaked via export | PDF export includes AI conversation | Per SHARE-03 (Phase 8 mandate), aiHistory MUST be excluded from doctor exports. **Decision needed:** does data export to USER include their own aiHistory? Recommendation: YES (it's their data, GDPR right-to-portability), but mark clearly in PDF section header. |

#### Denial of Service

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Audit log fills disk | High-volume sync writes amplify by 1× audit row each | 13-month retention cron prevents unbounded growth; estimated 9 tables × ~10 writes/day/user × ~1000 users = 90k rows/day = 33M/year ≈ acceptable on free-tier Postgres |
| Account-delete cron storms | Many users trigger delete simultaneously | `for update skip locked` + daily schedule = bounded blast radius |
| PDF generation locks main thread | Large data → slow jsPDF render | jsPDF runs on main thread; warn user "Generating PDF..." with loading state; consider OffscreenCanvas/worker if profiling shows > 5s |

#### Elevation of Privilege

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Authenticated user calls `initiate_account_deletion(other_user_id)` | RPC dispatch | Explicit check `auth.uid() = p_user_id OR auth.role() = 'service_role'`; raise exception otherwise |
| User crafts a Restore-from-backup payload to escalate | Modify backup JSON to inject admin claims | The `state` field hydrates only the Zustand store — no auth/permission claims are stored there. User identity comes from Supabase JWT, untouched by restore. |
| Trigger function bypasses RLS | SECURITY DEFINER + bad search_path | All SECURITY DEFINER functions set `search_path = public` explicitly; review during plan-check |

### Top 3 STRIDE risks the plan-check MUST verify

1. **Audit log INSERT/UPDATE/DELETE policies for authenticated role are absent** (Tampering — CRITICAL). Cross-tenant RLS proof test required.
2. **`initiate_account_deletion` SECURITY DEFINER enforces `auth.uid() = p_user_id`** (Elevation of Privilege — CRITICAL). RPC must reject foreign-uid calls; unit test required.
3. **PDF library jsPDF is lazy-chunked, not in index bundle** (DoS via bundle bloat that breaks deploy — HIGH). CI assertion required.

---

## Open Questions

1. **Does the privacy policy need to mention PostHog?**
   - What we know: Phase 1 wired PostHog cookieless mode (PROD-03). Phase 4 Settings copy still says "No analytics. No telemetry."
   - What's unclear: which prevails? Either update the Privacy copy to disclose PostHog, OR confirm PostHog is fully disabled in prod and update the policy to match.
   - Recommendation: Planner verifies actual PostHog wiring in main.tsx + analytics-defer.ts during 07-04 drafting. If PostHog is live in prod, disclose it; if it's disabled, remove the disclosure line and verify the Settings copy is accurate.

2. **Same-email-re-signup behavior (CONTEXT D-03 punt to planner)** — covered in §6 above; planner picks B1 vs B2. Recommendation: B1.

3. **Cron mechanism for T+30 worker (CONTEXT punt)** — covered in §6 above; planner picks Option 1 (Edge Function via pg_net) vs Option 2 (direct auth.users delete). Recommendation: Option 2.

4. **`audit_logs` row_id format for `supplements` (composite without entity_id)** — `supplements` per CONTEXT 06-13 is `(user_id, date, supplement_name, taken)` shape. Recommendation: serialize as `date::text || ':' || supplement_name`. Decide during 07-08 plan authoring.

5. **Should the data export include the user's own `audit_logs`?**
   - Arguments for: GDPR data-portability ("all data about you"); transparency.
   - Arguments against: bulks the export with hashes that aren't useful to the user.
   - Recommendation: include a summary row count + last-N skeleton rows, not the full 13mo log.

6. **HBNR runbook on-call (sole-founder case)** — when there's only one person, "escalation chain" is degenerate. The runbook should still document: alternate contact (someone with repo access for the worst case), out-of-hours decision authority, escalation to outside counsel if accepted-risk D-01 flips during an incident.

7. **Footer wiring on the SPA (`app.leanshot.app`) vs marketing (`leanshot.app`)** — the marketing build's `Landing.tsx` has a footer; the SPA's `AppShell.tsx` does not. WMHMDA wants the link conspicuous from the homepage. Decision: which domain IS the homepage for WMHMDA purposes? Recommendation: both. Add a `<LegalFooter />` to `AppShell.tsx` for parity.

---

## Recommended Plan Ordering

### Dependency graph

```
07-01 (e2e fix batch + CI green) ────────────────────────────► gate for all below
  │
  ├──► 07-02 (legal-page hosting + footer wiring)            [parallel after 07-01]
  ├──► 07-09 (s.user! sweep)                                 [parallel; independent]
  │
  ├──► 07-08 (audit_logs schema + triggers + RLS proof)      [must precede 07-07 for skeleton row]
  │      │
  │      └──► 07-07 (account-delete + crypto-shred + cron)   [depends on 07-08]
  │
  ├──► 07-03 (WMHMDA CHDP policy authoring)                  [depends on 07-02 for hosting]
  ├──► 07-04 (privacy + terms + disclaimer authoring)        [depends on 07-02 for hosting]
  ├──► 07-05 (HBNR runbook + filing acknowledgement)         [parallel; mostly docs]
  ├──► 07-06 (data export — JSON + lazy-loaded PDF)          [parallel; bundle-discipline check]
  └──► 07-10 (restore-from-backup UI)                        [parallel; D-05 wiring]
```

### Suggested wave structure (mirrors Phase 6 D-12 pattern)

**Wave 1 (CI gate + parallel low-risk):**
- 07-01: e2e batch fix (D-07) — **BLOCKING for all below per CONTEXT D-07**
- 07-09: `s.user!` sweep (D-06) — pure refactor; can run in parallel branches

**Wave 2 (legal-page surface + audit log foundation):**
- 07-02: Legal-page hosting + footer wiring
- 07-08: `audit_logs` schema + triggers + RLS proof + retention cron
- 07-05: HBNR runbook + filing acknowledgement (docs-only, parallelizable)

**Wave 3 (policy content + UI flows):**
- 07-03: WMHMDA CHDP (depends on 07-02)
- 07-04: Privacy + Terms + Disclaimer (depends on 07-02)
- 07-10: Restore-from-backup UI (D-05)
- 07-06: Data export — JSON + lazy-PDF
- 07-07: Account-delete + crypto-shred + T+30 cron (depends on 07-08 for audit skeleton)

### Plan count target

8-10 plans depending on planner's granularity choice. CONTEXT fine + mvp mode suggests ~9 plans. Match the proposed ordering above.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Termly free tier still includes WMHMDA-aware privacy generator | §3 | Re-pick template vendor (iubenda or hand-roll); ~half day rework |
| A2 | Supabase free-tier pg_cron supports the audit retention + finalize-account-deletions jobs (job count limit) | §6, §7 | If job-count cap hit, consolidate crons or move to Edge Function schedule |
| A3 | `pgcrypto` is available by default (for `digest()` in audit triggers) | §7 | `create extension if not exists pgcrypto;` prefix prevents failure |
| A4 | Existing `auth.users` cascade delete chain covers all 9 sync tables (Phase 5/6 set this up) | §6 | Audit each migration for `on delete cascade`; backfill missing FKs |
| A5 | `jsPDF` 4.2.1 + `jspdf-autotable` ship together cleanly and lazy-chunk under Vite | §5 | Bundle measurement during 07-06 reveals chunk shape; may need esbuild alias tweak |
| A6 | Storage objects under `{userId}/photos/` can be `list + remove` via service-role admin client | §6 | Pattern is already proven in `photo-cross-device.spec.ts:135-145` teardown — LOW risk |
| A7 | PostHog disclosure decision (Open Question 1) doesn't materially change WMHMDA compliance | §3, Open Q1 | If PostHog ingests health-event names, may itself be a "third party" per WMHMDA §3 — disclosure is required regardless; only the wording changes |
| A8 | The 7 deferred e2e specs share Family A root cause for 4 of them (realtime cold start) | §1 | If individual root causes diverge, plan 07-01 splits into more tasks; same plan, just more task rows |
| A9 | The "restore from backup" snapshot is partialized to the v7 STORAGE_VERSION shape | §8 | If shape is older, run migration chain; storage.ts already has chained-migrate helpers |
| A10 | LeanShot is in scope for FTC HBNR 2024 amendment ("vendor of personal health records") | §4 | Researcher confidence: HIGH per FTC's explicit 2024 expansion to "health apps and connected devices not covered by HIPAA"; minimal risk |

---

## Sources

### Primary (HIGH confidence) — verified during this research session

- **WMHMDA statute (RCW 19.373):** [app.leg.wa.gov/RCW/default.aspx?cite=19.373](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true) — read for the 5 mandatory CHDP sections (§3)
- **FTC HBNR final rule press release (April 2024):** [ftc.gov press release](https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule) — verified effective date July 29, 2024 + 60-day clock
- **FTC HBNR Federal Register entry:** [federalregister.gov 2024-10855](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule) — full text of 2024 amendments
- **FTC HBNR compliance guide:** [ftc.gov complying-ftcs-health-breach-notification-rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) — Notice of Breach form linked
- **Supabase pg_cron docs:** [supabase.com/docs/guides/database/extensions/pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) — Phase 4 cron precedent
- **Supabase security at-rest:** [supabase.com/security](https://supabase.com/security) — AES-256 encryption at rest confirmation
- **Local source files:** `06-CONTEXT.md`, `07-CONTEXT.md`, `playwright.config.ts`, all 7 deferred spec files, `SettingsPage.tsx`, `sync-defer.ts`, `MedLevelChart.tsx`, `Landing.tsx`, `injections.sql`, `anon_cleanup_pg_cron.sql` — read in full or relevant sections during this session

### Secondary (MEDIUM confidence)

- **Termsfeed WMHMDA writeup:** [termsfeed.com/blog/washington-wmhmda-health-data-act](https://www.termsfeed.com/blog/washington-wmhmda-health-data-act/) — confirms Termly's WMHMDA awareness, but free-tier coverage not verified
- **Washington State Bar News WMHMDA explainer:** [wabarnews.org/2024/04/09/the-washington-my-health-my-data-act](https://wabarnews.org/2024/04/09/the-washington-my-health-my-data-act/) — practical compliance writeup
- **Jones Day FTC final rule analysis:** [jonesday.com 2024/07/ftc-issues-final-health-breach-notification-rule](https://www.jonesday.com/en/insights/2024/07/ftc-issues-final-health-breach-notification-rule) — legal analysis of 2024 amendments
- **npm-compare PDF library comparison:** [npm-compare.com/jspdf,pdfmake,@react-pdf/renderer](https://npm-compare.com/@react-pdf/renderer,jspdf,pdfmake,react-pdf)
- **Bytebase Postgres audit logging guide:** [bytebase.com/blog/postgres-audit-logging](https://www.bytebase.com/blog/postgres-audit-logging/) — JSONB + trigger-based audit patterns
- **Supabase pgsodium status:** [supabase.com/docs/guides/database/extensions/pgsodium](https://supabase.com/docs/guides/database/extensions/pgsodium) — confirms pgsodium pending deprecation; informs §6 crypto-shred design

### Tertiary (LOW confidence — flagged for validation by planner)

- Estimates of jsPDF gzipped size (~50-60 kB) are from npm-compare summaries, not measured. Planner should `npm install jspdf && npm run build && du -h dist/assets/jspdf-*.js` during 07-06 implementation and confirm.
- Per-file `s.user!` count (14 files, 15 occurrences) — verified via `grep -rn` during this session; planner should re-run before starting 07-09 in case other plans touch these files concurrently.

---

## Metadata

**Confidence breakdown:**

- WMHMDA + HBNR legal anchors: **HIGH** — primary statute + FTC press release verified.
- Plan ordering + dependency graph: **HIGH** — mirrors Phase 6 D-12 pattern, CONTEXT D-07 explicit.
- Account-delete cron design: **MEDIUM** — Option 2 chosen for simplicity; if planner picks Option 1 (Edge Function), needs `pg_net` extension verification.
- Audit log trigger design: **MEDIUM** — hash-canonicalization caveat documented (Open Question 4); row_to_json ordering is a minor risk only if hash comparison ever becomes load-bearing.
- PDF library choice (jsPDF): **MEDIUM** — verified package versions; bundle-chunk shape needs to be re-measured during 07-06.
- E2E fix taxonomy: **MEDIUM** — hypotheses grounded in reading all 7 specs; final root causes verified during 07-01 execution per the planner's debug cycle.
- `s.user!` sweep mechanics: **HIGH** — pattern verified at MedLevelChart.tsx:13 (Phase 6 D-12 reference); pure refactor.

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days; faster-moving items: Supabase API contracts, jsPDF version)

## RESEARCH COMPLETE
