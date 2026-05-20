---
phase: 42-v1-3-polish-closeout
type: phase-rollup
shipped: 2026-05-20
status: shipped-with-deferred-device-uat
---

# Phase 42 — v1.3 Polish Closeout

**Goal:** Cross-phase accessibility / notifications / offline / dark-mode parity / changelog / quarterly NPS survey close out v1.3.

**Status:** SHIPPED (code-level) with 5 device-UAT signals deferred to v1.4 milestone close-out.

## Wave-by-wave

### Wave 0 — VAPID Deno spike
- ✅ **42-01** VAPID web-push spike (POLISH-05) — `070ebb3`, `341c884` (summary). `npm:web-push@3.6.7` primary path bundled cleanly; `crypto.subtle` ECDSA P-256 fallback also bundled for hot-patch contingency. Spike Fn deployed at 128.7 kB then decommissioned in 42-11 Signal D. VAPID Function Secrets set on production (`VAPID_PRIVATE_KEY` + `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT='mailto:karsten.haldan@gmail.com'`); `VITE_VAPID_PUBLIC_KEY` in gitignored `.env.local`.

### Wave 1 — Foundations (parallel)
- ✅ **42-02** axe-core WCAG 2.2 AA CI gate (POLISH-09) — 4 commits `558222d`/`897b05b`/`1d99256`/`5539091`. 30/30 vitest tests in 2.64s; baseline JSON captures per-route blocking + moderate counts with quarterly-review meta. CI workflow `test-a11y` job wired.
- ✅ **42-04** PWA service worker base (POLISH-07) — 5 commits `cffc97f`/`c3241f7`/`e990329`/`c6a4818`/`0f37768`. **injectManifest** strategy (NOT generateSW, per [[vite-plugin-pwa-strategy-choice]]); `src/sw.ts` owns precaching + HIPAA-safe URL allowlist + push listener (extended in 42-08). Bundle: index +0.36 kB (well under 50 kB cap); `dist/sw.js` 8.12 kB gz separate.
- ◐ **42-03** dark-mode parity (POLISH-08) **PARTIAL** — 3 commits `afc93d9`/`280940c` + summary. Tailwind v4 + `@tailwindcss/vite` pinned exact `4.0.0-beta.10`; `@variant dark` rule resolves utility prefix to `data-theme='dark'` attribute. 17 v1.3 surface tokens added to both `@theme` (light) and `[data-theme='dark']` (dark) blocks; tagged `/* POLISH-08 v1.3 SURFACE: <name> */`. Tokens for 3 not-yet-shipped surfaces (helpdesk/community/courses) **scaffolded** per [[scaffolding-for-deferred-mobile-pattern]]. **Tasks 3-4 VR snapshots deferred to v1.4** (3 of 6 routes don't exist yet).

### Wave 2 — Backends (parallel, batch-deployed)
- ✅ **42-05** notifications backend (POLISH-05/06 server tier) — 3 commits `28980f3`/`dad95f7`/`357910e` + summary. 5 migrations + RLS + 4 Edge Fns deployed: `notification-send` (1.663 MB, `npm:web-push@3.6.7` bundled, validates 42-01 spike provisional decision), `notification-dismiss` (UPSERT fresh-user fix per plan-checker iter-1), `notification-snooze`, `push-subscribe` (VAPID-bearing). 5 D-04 seed rows in `notification_category_config`.
- ✅ **42-06** changelog backend (POLISH-11 server tier) — 2 commits `0ba1cf2`/`b0929f3` + summary. 4 migrations + `changelog-mark-read` Edge Fn (690 kB) + 3 v1.3 highlight seed rows live (`v1-3-dark-mode`, `v1-3-pwa-offline`, `v1-3-smart-notifications`).
- ✅ **42-07** NPS backend (POLISH-12 server tier) — 3 commits `b85e130`/`3141122`/`71e3f09` + summary. 4 migrations + pg_cron `'0 0 1 1,4,7,10 *'` + 3 Edge Fns + HMAC token signer + **`no-conditional-native-review.cjs` ESLint rule CREATED from scratch** (P36 baseline pre-shipped because Phase 36 not executed; rule folds BOTH P36 + P42 instruments). `QUARTERLY_NPS_SIGNING_KEY` Function Secret set.

**Wave 2 batch db push** landed 15 migrations `20270704000001..00023` in one transaction. Hit [[supabase-back-dated-migration-blocks-push]] from Phase 50-04's RAG cron migration; operator-fix worked cleanly (temp-move + restore).

### Wave 3 — UIs (parallel)
- ✅ **42-09** What's New drawer (POLISH-11 UI half) — 4 commits `6d8c351`/`1d1fcd0` (co-mingled)/`bd4877f`/`ce58118`. Bundle: index **+0 bytes** (Pitfall 9 satisfied); WhatsNewDrawer 98.38 kB isolated lazy chunk (react-markdown@9.0.0 + dompurify@3.2.0 + rehype-raw@7.0.0, exact pins).
- ◐ **42-08** notif UI (POLISH-05/06 UI half) **PARTIAL** — 5 commits `ae968c0`/`1764d6e`/`c86bf25`/`a1b3f3e` (SUMMARY)/`77bcf73` (deferral note). Settings store + permission flow + realtime channel + `src/sw.ts` EXTENDED with push + notificationclick listeners. **Task 4 push-delivery e2e deferred** to 42-11 → v1.4 (Signal B); blocked by [[supabase-service-role-key-format-divergence]].
- ◐ **42-10** NPS modal + admin dashboard (POLISH-12 UI half) **PARTIAL** — 3 commits `1d1fcd0` (co-mingled)/`9482a16`/`77bcf73` (misattributed) + summary. 2 RPC migrations applied (slots 24+25); 3 NPS RPCs live; 10 fake Q2 rows seeded for visual variety. **Rule-2 side-fix:** admin-shell catch-all in `src/App.tsx` unblocked 6 previously-unreachable admin routes (see [[admin-module-manifest-vs-router-branch-drift]]). **Rule-3 fix:** SECDEF RPC `submit_quarterly_nps_in_app` added instead of overloading GET-only Edge Fn. **Task 4 admin dashboard render + modal cycle deferred** to 42-11 → v1.4 (Signal C).

### Wave 4 — Integration verify
- ◐ **42-11** integration verify **PARTIAL** — 3 commits `631925c`/`ee16850` + spike decommission + summary. Task 1 ✅ (axe re-baseline 31/31 + bundle budgets ratified + admin-shell catch-all audit). Signal D ✅ (`spike-web-push` Edge Fn deleted from production + local source removed). Signals A (VoiceOver UAT) / B (push e2e) / C (admin dashboard render) deferred to v1.4 close-out. Signal E (Plan 42-03 VR snapshots) stays deferred until Phase 37/44/46 ship.

## REQ-ID coverage final

| REQ-ID | Status | Owning plan(s) | Close-out path |
|--------|--------|----------------|----------------|
| POLISH-05 | PARTIAL | 42-05 backend + 42-08 UI | v1.4 Signal B |
| POLISH-06 | PARTIAL | 42-08 | v1.4 Signal B |
| POLISH-07 | ✅ CLOSED | 42-04 PWA injectManifest | — |
| POLISH-08 | PARTIAL | 42-03 (tokens shipped; VR deferred) | v1.4 Signal E (after P37/44/46) |
| POLISH-09 | PARTIAL | 42-02 baseline + 42-11 re-baseline + VoiceOver | v1.4 Signal A |
| POLISH-11 | ✅ CLOSED | 42-06 backend + 42-09 UI | — |
| POLISH-12 | PARTIAL | 42-07 cron + 42-10 UI + admin | v1.4 Signal C |

**2/7 CLOSED · 5/7 PARTIAL pending device-UAT signals**

## Code-level deliverables (production-live)

- **15 new migrations** `20270704000001..00025` applied to project `ytnsipxxmzgaebkqmokp`
- **8 new Edge Functions** deployed: `notification-send` / `notification-dismiss` / `notification-snooze` / `push-subscribe` / `changelog-mark-read` / `nps-quarterly-enqueue` / `nps-quarterly-respond` / `nps-quarterly-followup` (spike-web-push deleted in Wave 4)
- **3 new SECDEF RPCs**: `is_user_eligible_for_quarterly_nps` / `submit_quarterly_nps_in_app` / `get_quarterly_nps_dashboard`
- **pg_cron job** `quarterly-nps-enqueue` scheduled `'0 0 1 1,4,7,10 *'`
- **3 new Function Secrets**: `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` / `QUARTERLY_NPS_SIGNING_KEY`
- **Vite + Tailwind v4** pinned exact `4.0.0-beta.10`
- **vite-plugin-pwa** wired with `injectManifest` strategy; `src/sw.ts` owns precaching + HIPAA-safe routing + push event listener + notificationclick handler
- **17 dark-mode surface tokens** across `@theme` + `[data-theme='dark']` blocks
- **3 new admin module manifest entries**: `nps-quarterly` (NPS dashboard) + `admin-shell` catch-all routing + 6 previously-unreachable routes now reachable
- **eslint rule** `no-conditional-native-review.cjs` created + registered (folds P36 + P42 instruments)
- **axe baseline** captured 2026-05-20 across 31 routes; quarterly review due 2026-08-18

## Memory artifacts written during Phase 42

- [[vapid-keypair-supabase-setup]]
- [[spike-accept-deploy-evidence-defer-runtime-verify]]
- [[vr-snapshot-plan-route-existence-check]]
- [[supabase-back-dated-migration-blocks-push]]
- [[orchestrator-inline-completes-returned-executor]]
- [[supabase-service-role-key-format-divergence]]
- [[admin-module-manifest-vs-router-branch-drift]]

## v1.4 milestone close-out follow-ups (7 items)

1. Signal A — VoiceOver UAT on top-5 flows → `42-VOICEOVER-UAT.md`
2. Signal B — Web-push delivery e2e (POLISH-05/06 close)
3. Signal C — Admin NPS dashboard render + modal cycle (POLISH-12 close)
4. Signal E — Plan 42-03 VR snapshots (after Phase 37/44/46 ship) → `42-03-VR-ADDENDUM.md`
5. a11y baseline jsdom-shell noise (drive 2→0 universal baseline)
6. 88 pre-existing vitest failures (audit/triage)
7. WCAG quarterly review by 2026-08-18

## Phase 42 commits (chronological, all on main)

`7ca7747` (38 AI-SPEC) — not 42, but historical context
`2d8e8cf` (38 CONTEXT) — not 42, but historical
`afc93d9` 42-03 Task 1 Tailwind pin
`280940c` 42-03 Task 2 dark-mode tokens
`(42-03 summary commit)`
`558222d`/`897b05b`/`1d99256`/`5539091` — 42-02 axe CI
`cffc97f`/`c3241f7`/`e990329`/`c6a4818`/`0f37768` — 42-04 PWA
`070ebb3` 42-01 spike Fn
`341c884` 42-01 summary
`28980f3`/`dad95f7`/`357910e` — 42-05 notif backend
`0ba1cf2`/`b0929f3` — 42-06 changelog backend
`b85e130`/`3141122`/`71e3f09` — 42-07 NPS backend
`6d8c351`/`1d1fcd0`/`bd4877f`/`ce58118` — 42-09 What's New
`ae968c0`/`1764d6e`/`c86bf25`/`a1b3f3e` — 42-08 notif UI
`9482a16` — 42-10 admin dashboard
`77bcf73` — 42-08 deferral + 42-10 Task 3 (parallel-executor misattribution)
`631925c`/`ee16850` — 42-11 Task 1
`<spike decommission commit>` — 42-11 Signal D

Plus 3 plan-SUMMARY commits per plan and STATE.md commits.

**Total: 28+ commits across all 11 plans + 1 spike + 11 SUMMARYs + 1 PHASE-SUMMARY.**
