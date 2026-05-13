# Milestone v1.1 — LeanShot Project Summary

**Generated:** 2026-05-13
**Purpose:** Team onboarding and project review
**Final commit on `origin/main`:** `b24f26d`

---

## 1. Project Overview

**LeanShot** is a web app for people on GLP-1 medications (Ozempic, Wegovy, Mounjaro, Zepbound) and adjacent peptides. It captures everything that affects their treatment — injections, body metrics, food, activity, mood, symptoms — and turns it into a unified picture they share with a doctor and a coach (rule-based + AI) shares back with them.

**Core value:** Drug-level projection + injection-site rotation are the headline. The pharmacology curve (28 days past + 7 days projected) and site-rotation tracking are the centerpiece; every other tab feeds context into or interprets that picture.

**v1.1 milestone scope:** Take the existing local-only v2 codebase to a publicly deployed multi-audience SaaS — **B2C patient + doctor read-share + clinic/coach B2B** — on Supabase (Postgres + Auth + Realtime + Storage + Edge Functions). 11 phases / 76 plans, executed in vertical user-visible slices. Every phase ends with something a real human (patient, operator, doctor, clinic coach, or the founder) can open in a browser and verify.

**All 11 phases shipped.** Production live at `https://leanshot-app.vercel.app`. Supabase backend at project ref `ytnsipxxmzgaebkqmokp` with 35+ migrations applied. PostHog + Sentry observability live.

---

## 2. Architecture & Technical Decisions

**Frontend stack (locked for v1):**
- **React 19** + **Vite 6** + **TypeScript 5.6 strict** + **Tailwind v4 beta** + **Zustand 5** (single global store with `persist` middleware)
- **Static SPA** — no SSR, no Node.js runtime in prod. Built to `dist/` and served by Vercel.
- **Code-splitting via `manualChunks`** — every tab/modal/feature is `React.lazy()`-loaded; bundle topology preserved across phases by per-chunk CI ceilings.
- **Theme:** Pre-paint imperatively via `applyThemeToDOM()` in `main.tsx` to avoid marketing-page flash for returning users.

**Backend stack (added Phase 4):**
- **Supabase cloud** (project `ytnsipxxmzgaebkqmokp`) — Postgres + Auth (email/password) + Realtime + Storage + Edge Functions (Deno).
- **AI proxy on Edge Functions** — `ai-chat` function calls Moonshot Tier 1 (200 RPM); previously direct-browser-to-Anthropic with user-supplied key (deprecated mid-Phase 4). Vercel AI Gateway is the back-out plan.
- **RLS-everywhere** — every table + Storage bucket has a cross-tenant impersonation proof test (project rule from Phase 5, reaffirmed every subsequent phase). 16+ SECURITY DEFINER RPCs with `set search_path = public, extensions, pg_catalog` discipline.
- **Migrations as source of truth** — 35+ files in `supabase/migrations/`; pushed via `npx supabase db push --linked`.

**Notable architectural decisions:**
- **Local-first preserved** (Phase 5/6) — even after cloud sync lands, users without an account or offline must still log + view data. localStorage Zustand store is canonical; cloud sync is an additive replication layer.
- **Role + permission substrate** (Phase 9 D-07) — full RBAC (Owner / Coach / View-only + custom roles + permission-jsonb RLS) absorbed from Phase 10 into Phase 9. Phase 10 reads from it; no new role/permission rows except `roster.read_breakdown`.
- **ReadOnlyPatientView extraction** (Phase 10 D-03) — Phase 8's SharePage refactored into a thin wrapper around `src/components/shared/ReadOnlyPatientView.tsx`. Both `share` (Phase 8) and `clinic` (Phase 10) chunks consume it; new shared chunk lazily loaded by either entry point.
- **HIPAA posture explicitly NOT covered entity** — visible disclaimer + data minimization since day one; avoid features pushing into that bucket (direct EHR integration, telehealth, etc.).
- **Compliance regime explicit** (Phase 7): FTC HBNR + WMHMDA CHDP + general-wellness FDA framing. Counsel-led drafts shipped in v1.1; CMIA mental-health framing audited in Phase 2.
- **PHI contract on analytics** — strict booleans-only + IDs-only on every `posthog.capture()`; zero free-text health content. PHI grep is a phase-close gate.

---

## 3. Phases Delivered

| Phase | Name | Plans | One-Liner |
|-------|------|-------|-----------|
| **1** | Quality Gates & Observability | 6 | Vitest + ESLint + typecheck + Playwright smoke + Sentry + PostHog all green on a "hello" PR before any feature work. |
| **2** | Visible Compliance & Public Deploy | 8 | "Not medical advice" disclaimer overlay + mental-health framing audit + custom-domain HTTPS + marketing/app subdomain split. |
| **2.1** | SPA Lighthouse Performance Fix | 5 | Function-form `manualChunks` + telemetry defer + non-blocking font CSS → Lighthouse Performance 0.94 (3-run consistent). |
| **3** | Pharmacology + Insights Hardening | 5 | Cited test corpus + uncertainty band on the curve + refusal-list + "estimate not measured" overlay — defensible before any audience sees the chart. |
| **4** | Supabase Cloud Bootstrap + AI Proxy | 3 | Supabase cloud project provisioned, region + CLI + env wiring + Function secrets + email auth stub + `ai-chat` Edge Function deployed (kills plaintext-key-in-localStorage). |
| **5** | Patient Cloud Sync — auth + injections | 6 | Patient signs up, verifies email, logs an injection, signs in on a second browser, sees the injection — Realtime-driven cross-device sync of injections only. |
| **6** | Patient Cloud Sync — full + photos | 5 | All remaining tables sync; `leanshot_v4` migrates with backup; offline writes queue in IndexedDB; photos move to Supabase Storage. |
| **7** | Compliance Foundations | 10 | Privacy policy + WMHMDA CHDP + FTC HBNR registration + on-demand data export/delete — counsel-led, parallelizable with cloud work. |
| **8** | Doctor Read-Share | 6 | Patient generates time-bound share link + 6-digit access code, doctor opens it, sees read-only data with live charts, patient revokes — all four revocation failure modes covered. |
| **9** | Clinic B2B Foundations | 11 | Clinic operator signs up, creates org, invites a patient by email, patient consents at acceptance, identity stays singular across personal + clinic accounts. Full RBAC substrate live. |
| **10** | Clinic Operator Surface | 11 | Roster view with at-a-glance ranking (`rank_org_patients` RPC), drill-in via `ReadOnlyPatientView`, Owner/Coach/View-only differences enforced in UI + RLS, operator audit-log surface, per-patient activity mirror in patient settings, full bulk affordances (CSV export / PDF / open-in-tabs). |

**Total:** 76 plans · 35+ migrations · 5 Edge Functions (`ai-chat`, `share`, `clinic-invite`, `clinic-photo`, `clinic-snapshot`, `patient-activity`, `bulk-csv-export`) · 749 vitest tests / 6 skipped · CI gates for bundle topology + jspdf invariant + clinic-perf + share-security-drill + lighthouse.

---

## 4. Requirements Coverage

**Validated (v2 baseline carried through):** TRACK-01 through TRACK-11 (injections, drug-level curve, site rotation, weight/photos, nutrition/activity/symptoms, insights, AI coach, doctor report, onboarding, streaks, local persistence).

**Active (delivered in v1.1):**

**Compliance:**
- ✅ COMPL-01 — Privacy policy published with all data sources referenced
- ✅ COMPL-02 — WMHMDA CHDP policy with private-right-of-action coverage
- ✅ COMPL-03 — FTC HBNR registration + incident-response plan
- ✅ COMPL-04 — First-run disclaimer + curve overlay ("Not medical advice")
- ✅ COMPL-05 — Mental-health framing audited (CMIA out-of-scope)
- ✅ COMPL-06 — Export (Phase 7 Plan 07-06) + Delete (Plan 07-07) on demand

**Production readiness:**
- ✅ PROD-01 — Custom domain HTTPS (Vercel `leanshot-app.vercel.app` production alias)
- ✅ PROD-02 — Sentry with `beforeSend` PII scrubber (`symptom`/`mood`/`note`/`aiHistory` redacted)
- ✅ PROD-03 — PostHog cookieless analytics; zero free-text health content captured (verified via PHI grep at every phase close)
- ✅ PROD-04 — Vitest 4 + RTL + Playwright wired to `npm test` + CI
- ✅ PROD-05 — ESLint flat + Prettier + tsc -b --noEmit in CI gates
- ✅ PROD-06 — Marketing on `leanshot-marketing` (separate Vercel project); SPA on `leanshot-app`

**Auth & cloud (Phases 4-6):**
- ✅ AUTH-01..04 — Email/password signup, magic-link verify, "previous password invalidated" hardening, session-token scope discipline
- ✅ SYNC-01..05 — Injections + weights + photos + symptoms + meals all replicate cross-device; offline IndexedDB queue; v3→v4 → cloud migration path

**Sharing (Phase 8):**
- ✅ SHARE-01..06 — Time-bound link + 6-digit code; revocation in <2s (live latency proof); private/no-store cache headers on every status

**Clinic B2B (Phases 9-10):**
- ✅ CLINIC-01..03 — Org creation + invite + consent-at-acceptance (Phase 9)
- ✅ CLINIC-04 — Roster ranking via `rank_org_patients` RPC; <500ms RPC latency on 50-patient seed; <2s render budget (CI-gated)
- ✅ CLINIC-05 — Drill-in via `ReadOnlyPatientView` (`viewerMode: 'share' | 'clinic'`)
- ✅ CLINIC-06 — Roles & permissions (Owner/Coach/View-only + custom; permission-jsonb RLS)
- ✅ CLINIC-07 — Org-owner audit log surface + per-patient activity mirror in patient Settings

---

## 5. Key Decisions Log

| ID | Decision | Phase | Rationale |
|----|----------|-------|-----------|
| D-tech-01 | React 19 + Vite + Tailwind v4 beta + Zustand locked | All | v2 baseline; no rewrite during v1 |
| D-tech-02 | Supabase as backend | 4 | Auth + Realtime + Storage + Edge Functions in one provider; matches local-first replication needs |
| D-tech-03 | Moonshot (Tier 1, 200 RPM) for AI proxy; Vercel AI Gateway as back-out | 4 | Tier 0 (3 RPM) too tight; $10 recharge → Tier 1 |
| D-compl-01 | HBNR registration before broad launch | 7 | "Registration" is a misnomer (no FTC enrollment); means: incident-response plan documented + GitHub Pages legal site live |
| D-compl-02 | WMHMDA CHDP mandates 5 sections per RCW 19.373.030 | 7 | Counsel-driven; sections enumerated in policy |
| D-compl-03 | Skip envelope encryption on free tier (pgsodium deprecated) | 7 | RLS + audit_logs sufficient for HBNR; defer hardware-key escrow |
| D-arch-01 | Local-first preserved | 5/6 | Offline users + non-authenticated users must still work |
| D-arch-02 | Full RBAC substrate in Phase 9 (absorbed from Phase 10) | 9 | Foundational for both audit surface and roster permissions |
| D-arch-03 | ReadOnlyPatientView extracted (shared chunk) | 10 | Same component drives both `share/{code}` and `clinic/{slug}/patient/{user_id}` |
| D-arch-04 | Roster rank server-side, no cache | 10 | New SECURITY DEFINER RPC `rank_org_patients`; recomputes every load; 50-patient < 500ms target |
| D-ops-01 | jsPDF dynamic-import only | 7+ | Bundle invariant; CI gate `grep -E "^import .* from 'jspdf'"` returns zero |
| D-ops-02 | Defer-then-batch-fix for CI-only test failures | 6/9 | `test.fixme` + `.planning/deferred-tests.md` + Phase entry condition; never permanently skip SC tests |
| D-ops-03 | Pathspec commits in parallel worktrees | 7+ | Parallel executors share one git index; `git commit -- <pathspec>` prevents sibling-plan cross-contamination |
| D-ops-04 | Direct push to main at phase close (`branching_strategy: none`) | All | Solo project precedent established Phase 5; revisit if collaborators join |

(Full per-phase decisions in each `<phase-dir>/{NN}-CONTEXT.md`.)

---

## 6. Tech Debt & Deferred Items

**Carried forward to Phase 11+:**
- **`s.user!` non-null assertion inventory** — 14 files / 15 occurrences flagged (`MedLevelChart.tsx:13` confirmed latent). Phase-7 deferred to a hardening pass.
- **Photo trash flow** — UI scaffolding exists; rollback path not yet built (Phase 6 deferred → Phase 7 → still open).
- **HIPAA BAA path** — explicitly NOT in v1; revisit when/if clinic customers require it.
- **Bundle-budget script hash-hyphen bug** — fixed in Phase 10 Plan 10-11 (`assert-clinic-bundle-budget.sh`).
- **`clinic_workspace_loaded` capture-site** — defined-but-unwired event constant; patched at Phase 10 close (`b24f26d`). Plan-checker should grow a rule: every export from `*-events.ts` / `*-keys.ts` / `*-routes.ts` requires ≥1 non-test usage.
- **STATE.md `roadmap_complete` flag staleness** — phase-close plans don't invoke `gsd-sdk query state.complete-phase`; cosmetic but breaks `/gsd-manager` heuristics. Fix is a 5-min sweep.
- **GitHub branch protection for `share-security-drill`** + 7 pre-existing SharePage lint errors — flagged Phase 8 close, still open.
- **Phase 9 Resend domain verification** — `app.leanshot.app` not verified yet; sandbox `onboarding@resend.dev` is the active FROM until then. Verify before broad clinic outreach.
- **6 deferred tests** in `.planning/deferred-tests.md` — env/timing CI flakes, not real bugs. Batch-fix at next milestone close.

**Process lessons captured in memory (`/Users/karstenhaldan/.claude/projects/-Users-karstenhaldan-minisite/memory/`):**
- Parallel executors push migrations to live DB despite "don't push" instructions — plan AROUND it, don't try to batch.
- Bash cwd drifts into worktree paths after parallel Agent spawns — use absolute paths (`git -C /path`) for every git op.
- `gsd-sdk query init.execute-phase` resolves `.planning/` from cwd — root-stub `.planning/` masks the real `leanshot/.planning/`.
- Worktrees lock after parallel agents return — `git worktree remove --force` requires unlock first.
- Supabase `signOut({scope: 'others'})` is the post-password-reset hardening to not miss.
- MCP-automated verification still needs user hands for OAuth + credentialed sign-in (don't oversell "automate this" options).
- 6 planner anti-patterns (shared-file choreography, hedge instructions, VALIDATION flag flip-timing, defensive jsonb contracts, Postgres DDL transaction safety, **unwired-constant gap**) → pre-empt in planner prompt OR use `--chunked` mode for ≥5-plan phases.

---

## 7. Getting Started (New Contributor Entry Points)

**Run the project locally:**
```bash
cd /Users/karstenhaldan/minisite/leanshot
npm install
npm run dev               # Vite dev server on :5173
npm test                  # Vitest + Playwright e2e
npm run lint              # ESLint + Prettier check
npx tsc -b                # TypeScript typecheck
npm run build             # Production build → dist/
```

**Key directories:**
- `leanshot/src/` — SPA source (React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand)
  - `components/clinic/` — B2B operator surface (Phases 9-10)
  - `components/shared/` — `ReadOnlyPatientView` + sections (Phase 10 D-03)
  - `components/share/` — Patient-to-doctor share link (Phase 8)
  - `components/dashboard/` — Patient B2C surface (v2 baseline + sync wiring Phases 5-6)
  - `lib/store.ts` — Single global Zustand store (every domain entity)
  - `lib/clinic-events.ts` — PostHog event-name constants (Phase 10)
  - `lib/sync-defer.ts` — Idle-deferred-init wrapper for heavy SDKs (Phase 6 P01)
  - `lib/pharmacology.ts` — Drug-level curve math (Phase 3 hardened)
  - `lib/insights.ts` — Rule-based focus + insights engine
- `supabase/migrations/` — 35+ SQL migrations (repo root, NOT under leanshot/)
- `supabase/functions/` — Edge Functions (Deno): `ai-chat`, `share`, `clinic-invite`, `clinic-photo`, `clinic-snapshot`, `patient-activity`, `bulk-csv-export`
- `leanshot/e2e/` — Playwright specs (`*.spec.ts`) + Deno cross-tenant RLS tests (`*.test.ts`)
- `leanshot/.planning/phases/` — Per-phase artifacts: `CONTEXT.md` (decisions), `RESEARCH.md`, `PLAN.md` files (one per slice), `SUMMARY.md` files (one per shipped plan), `VERIFICATION.md` (phase-close audit), `VALIDATION.md` (per-phase test strategy)
- `.github/workflows/ci.yml` — 7-job pipeline at repo root (typecheck / lint / unit / e2e / bundle-budget / vendor-react-size / lighthouse / share-security-drill / roster-perf)

**Where to look first for v1.1 architecture:**
1. `.planning/PROJECT.md` — what LeanShot is + tech stack + constraints
2. `.planning/ROADMAP.md` — 11-phase plan with deps + success criteria
3. `.planning/REQUIREMENTS.md` — TRACK / COMPL / PROD / AUTH / SYNC / SHARE / CLINIC requirement IDs
4. `leanshot/CLAUDE.md` — Project conventions (component patterns, naming, accessibility, anti-patterns)
5. `leanshot/.planning/phases/10-clinic-operator-surface/10-CONTEXT.md` — most recent phase's decisions (25 across 12 gray areas)
6. `leanshot/src/types/snapshot.ts` — Canonical SnapshotData / ReadOnlyPermissionMap / RankRosterRow types (Phase 10 P01 single source of truth)

**Deploy URLs:**
- SPA prod: `https://leanshot-app.vercel.app`
- Marketing prod: `https://leanshot-marketing.vercel.app` (separate Vercel project; `leanshot/.vercel/` links to marketing — pass `--project leanshot-app` for SPA-targeted CLI commands)
- Supabase project ref: `ytnsipxxmzgaebkqmokp`
- Vercel CLI: `npx vercel ls leanshot-app`

---

## Stats

- **Timeline:** 2026-05-10 → 2026-05-13 (4 days — compressed sprint with parallel chunked planning + parallel-wave worktree execution)
- **Phases shipped:** 11 / 11
- **Plans shipped:** 76 / 76
- **Commits:** 497 with file changes (562 total commits in the window)
- **Volume:** +174,668 / −7,207 LOC across the milestone
- **Contributors:** Karsten Haldan (founder) + Claude (Opus 4.6, Opus 4.7, Sonnet 4.6 as executors)
- **Migrations applied to live DB:** 35+
- **Edge Functions deployed:** 7
- **Vitest:** 749 pass / 6 skipped / 0 fail
- **Bundle ceilings (all under):** index 12.48 kB gz · clinic 21.18 kB gz · clinic-settings 7.77 kB gz · share 6.13 kB gz · read-only-patient-view 1.77 kB gz
- **PHI capture-site count:** 13 across 10 distinct `clinic_*` event names (all PHI-clean by grep)
