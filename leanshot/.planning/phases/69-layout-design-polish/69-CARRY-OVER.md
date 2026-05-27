---
phase: 69
status: code-complete (audit-fixes + UI-auditor-run + VR-baselines deferred)
audience: Phase 69.5 + Phase 69.7 + Phase 70 operator
---

# Phase 69: Layout & Design Polish — CARRY-OVER

## 1. Phase 69.5 Scope (Final Tech Debt Sweep) — Inherits ALL of:

| Source | Item | Count / Detail |
|--------|------|----------------|
| 69-02 | DS primitive duplicates | 4 (2 Card + 2 Modal). Refactor to import from `@/components/ui/`. |
| 69-03 a11y | Missing `useReducedMotion` on framer animations | 9 |
| 69-03 a11y | Input missing label association | 1 |
| 69-03 mobile | Wide widths > 375 without responsive override | 41 (filter false-positives first) |
| 69-03 mobile | `overflow-x-auto` declarations | 46 (some by-design) |
| 69-03 mobile | Tables without `overflow-x-auto` wrapper | 27 |
| 69-03 spacing | Non-multiple-of-4 padding | 4 |
| 69-03 spacing | Non-multiple-of-4 margin | 11 |
| 69-01 baseline | DS-01 token violations (3 files) | 3 grandfathered |
| 69-01 baseline | DS-02 typography ceiling violations (366 files) | Likely many false-positives — needs filter |
| 69-01 baseline | DS-03 accent reserved-list (12 files) | 12 grandfathered |
| Phase 60 close-out | UI-review FLAGs | 9 (Approve toast missing Undo, accent on EXTRACTED QUOTE label, 6 copy/spacing nits) |
| Phase 65 carry-over | `modules.test.ts` claims 18 modules; reality 35 | 1 (full rewrite) |
| Phase 66 carry-over | `src/lib/auth.test.ts` 6 failures | Mocks drifted from Phase 34/59 |
| Phase 66 carry-over | `aal2-step-up.test.ts` 4 failures | localStorage fixture stale |
| Phase 66 carry-over | `bulk/job-polling.test.ts` 4 failures | Phase 27 polling mock stale |
| Phase 66 carry-over | `billing-sync.test.ts` 5 failures | Mock surface drifted from real client |
| Phase 66.5 carry-over | 714 Supabase advisor WARN findings | Per-category triage (494 SECDEF executable, 179 anon-sign-in, etc.) |
| Phase 67 carry-over | Vendor-string emission audit | Per `[[reference_two_layer_real_vs_stub_classifier]]` extension |

**Total Phase 69.5 effort:** estimated 2-3 days of focused operator + agent work. Most items are small surgical fixes; the 366-file DS-02 baseline likely contains mostly intentional `text-heading` / `text-display` utility usage that needs an allow-list extension, not 366 actual fixes.

## 2. Phase 69.7 Scope (Build + Deploy Verification)

| Item | Action |
|------|--------|
| `org_subscriptions` drift recovery | Operator psql + `\dt` check + either re-CREATE TABLE or `DELETE FROM schema_migrations` (per `[[reference_supabase_migration_list_applied_vs_table_missing]]`) |
| `npx supabase db push --linked` | Apply ALL pending: 10 Phase 65 + 2 Phase 66 + 3 Phase 66.5 + 3 Phase 68 = 18 migrations |
| `npx supabase db advisors --linked --type security --level error --fail-on error` | Confirm 0 ERROR (validates Phase 66.5) |
| `npx supabase db lint --linked --fail-on error` | Confirm RPC body errors cleared (operator may need to drop+recreate some RPCs given drift extent) |
| `npm run build` in leanshot/ | Vite production build succeeds |
| `vercel build --prod` OR `vercel deploy --prebuilt` | Vercel build clean |
| Deploy 10 new Edge Fns | stripe-{checkout,webhook,dunning-orchestrator}, request-refund, lifecycle-{trial-ending,win-back}, nexus-monitor (P65), auth-rate-limit-check (P66), bs-status-poller (P67), demo-org-purge (P68) |
| Healthz smoke all 10 | curl `/healthz` returns `ok:true` for each |
| Register pg_cron jobs | dunning-orchestrator (15min), lifecycle-trial-ending (daily 09:00 UTC), lifecycle-win-back (weekly Mon 10:00 UTC), nexus-monitor (daily 06:00 UTC), matview-refresh (daily 05:30 UTC), bs-status-poller (every 5min), demo-org-purge (daily 03:00 UTC), auth_attempts_log 30d retention (daily) — **9 cron jobs total** across phases |
| Phase 65 operator gates | Stripe Tax enable + 3 Winback Coupons (WINBACK_10/25/50) + verify `SLACK_GUARDRAIL_WEBHOOK_URL` + `PHYSICAL_ADDRESS` |
| Phase 67-04 operator gates | PostHog `guardrail-slack` integration created + `BETTER_STACK_API_KEY` secret set |
| Phase 68 operator gates | `VITE_CALENDLY_BOOK_DEMO_URL` env set |
| VR baseline capture | `npx playwright install chromium` + `npx playwright test --config playwright.config.vr.ts --update-snapshots` |
| 3 audience landing pages smoke | `/for-doctors`, `/for-clinics`, `/for-coaches` return 200 + JSON-LD `<script>` present |
| Sign-in lockout smoke (Phase 66) | 5 wrong-password attempts → SignInLockoutBanner displays |
| `npx supabase db advisors --linked --type security` post-fix re-run | Expect 11 ERRORs → 0, 16 function_search_path_mutable → 0 |
| `scripts/ci/check-sentry-imports.ts` post-PR run | 135 Fns scanned, 0 stubs |
| `scripts/posthog/seed-funnel-alerts.sh` invocation | 3 funnels visible in PostHog UI |

## 3. Phase 70 Scope (Consolidated UAT) — Inherits

All per-flow UAT signals listed in each phase's VERIFICATION.md `Human-Verify Signals (DEFERRED)` section. See:
- 65-VERIFICATION.md (8 signals — F1..F7)
- 66-VERIFICATION.md (11 signals — F1..F9 + 2 wiring items)
- 66.5-VERIFICATION.md (7 signals — db-push + advisor re-runs)
- 67-VERIFICATION.md (10 signals — k6, cron, posthog, restore drill)
- 68-VERIFICATION.md (10 signals — landing pages, demo sandbox, UTM)
- 69-VERIFICATION.md (this phase — 8 signals)

Per `[[feedback_multi_signal_human_verify_checkpoint_pattern]]` — each is a discrete approve-able signal. Operator approves N of M; remaining can carry to post-launch hotfix.
