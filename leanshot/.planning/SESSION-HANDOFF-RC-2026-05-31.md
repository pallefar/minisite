# Session Handoff — RevenueCat / App-store / DS-02 (2026-05-31)

Continuation of the v1.4 launch-readiness milestone ("App-store + centralized changelog").
`origin/main` unchanged this session — **all work is in 4 open PRs** (nothing merged to main yet).
Companion docs (same dir): `APP-STORE-SETUP-PLAN-2026-05-31.md` (Phases A–E),
`REVENUECAT-GO-LIVE-RUNBOOK-2026-05-31.md`, `REVENUECAT-READINESS-2026-05-31.md` (audit),
prior `SESSION-HANDOFF-2026-05-31.md`.

## Shipped this session — 4 open PRs (all verified locally; merge at your discretion)

| PR | Branch | What | CI |
|---|---|---|---|
| **#11** | `chore/app-store-config` | A9 Team ID `XCZMRC727Z` → `apple-app-site-association`; corrected the stale C1/C2 claims; added **Phase E** (IAP operator steps) + the **RC go-live runbook** | green except DS-02/E2E baselines |
| **#12** | `fix/revenuecat-readiness` | **12 RevenueCat readiness defects** (H1–H3, M1–M5, L1–L4) + both adversarial-review nits. Lint + Unit **green**. Head `431b3ef8` | green except DS-02/E2E baselines |
| **#13** | `chore/wire-orphaned-vitest-tests` | Wired 7 orphaned `src/test/*` (incl. PricingIOS RC paywall test) into the `src-ui-unit` CI project; excluded live-DB `rls-*`. Unit **green** | green except DS-02/E2E baselines |
| **#14** | `fix/ds-02-typography-ceiling` | DS-02 typography: 15 violations → 0 in 3 post-baseline files (Phase-71 product-updates + ChartSection) | should green DS-02 |

> All four carry the same repo-wide baseline reds (see below). PR #12 was adversarially
> review-clean (all 6 fix groups verified correct). Merge order doesn't matter — the 4
> branches touch disjoint files (only `vitest.config.ts`/`PricingIOS.test.tsx` overlap
> conceptually but on different lines; no conflicts expected).

## Remaining OPEN topics to complete the milestone

### A. Merge the 4 PRs ([YOU])
Review + merge #11/#12/#13/#14. The two persistent reds (below) are repo-wide baselines, not from these PRs.

### B. App-store first uploads ([YOU] console/secrets; one [ME] item)
- **Apple A2–A8**, **Play B1–B7** — see `APP-STORE-SETUP-PLAN-2026-05-31.md`. Long pole: **Apple Paid-Apps agreement** (days).
- **B6 ([ME], blocked):** once the **Play App-Signing SHA-256** exists (from B5, after the first AAB processes), hand it over → 1-edit swap in `public/.well-known/assetlinks.json` (still `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09`).

### C. RevenueCat IAP go-live ([YOU], dashboard greenfield)
Code is done + audited (PR #12). Follow `REVENUECAT-GO-LIVE-RUNBOOK-2026-05-31.md` / Phase E1–E8:
RC dashboard → SDK keys as GitHub Actions secrets `VITE_RC_API_KEY_IOS`/`_ANDROID` → entitlement `plus` + offering (`$rc_monthly`/`$rc_annual`) + products (`app.leanshot.plus.{monthly,yearly}`) → ASC subs → Play subs → webhook secret `REVENUECAT_WEBHOOK_AUTH` (required) + register URL + `supabase functions deploy revenuecat-webhook` → device UAT.

### D. Phase 71 changelog go-live ([YOU])
- `supabase db push` migration `20290110000001_p71_changelog_status_version.sql` (NOT pushed by the executor).
- Enable PostHog flag `admin.product-updates.enabled`.
- Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the fastlane CI env (so `scripts/sync-store-release-notes.mjs` reads published entries at release time).

### E. AdMob (mixed)
- **[YOU]** create AdMob account → app/publisher IDs.
- **[ME] (next session, no blocker to scaffold):** wire `initAdNetwork()` at boot + surface integration (env-gated no-op until IDs land, mirroring the RC key pattern). Framework already exists: `src/lib/native/ads.ts`, `AdRenderer`, `PlatformAdSlot`.

### F. Green E2E — the heaviest remaining quality item
The E2E job fails broadly (~69 specs) for two reasons, both **pre-existing / environmental** (also red on docs-only PR #11):
1. **VR baselines never captured** ([YOU]/operator) — `playwright test --config playwright.config.vr.ts --update-snapshots` against a working staging URL, then commit the snapshots (needs visual approval).
2. **Playwright preview-app timeouts** ([ME], needs a working preview env) — `locator.click: Test timeout 30000ms`; diagnose against the preview deployment.

### G. Accept-as-is
**RAG eval PR-gate** (`eval-phase60.yml`) is intentionally RED until the RAG Edge Fns deploy ("PR gate jobs will RED-fail — that is the proof the harness wires up"). Not a blocker.

## Highest-value next [ME] items (no operator dependency)
1. **AdMob boot-wiring** (env-gated scaffold) — thread E.
2. **Playwright preview-timeout diagnosis** — the non-VR half of E2E (thread F2).
3. **B6** the instant the Play SHA-256 arrives.

## Resume pointers
- Memory (current): `project_revenuecat_iap_integration`, `project_appstore_changelog_initiative`,
  `reference_leanshot_ci_gate_topology_gotchas` (DS-02 baseline mechanism + lint apostrophe + react/no-unescaped-entities),
  `reference_multiple_vitest_configs_include_overlap` (orphan trap + live-DB-CI caveat),
  `feedback_freshly_authored_runbook_can_be_stale`.
- ⚠️ **Shared checkout** with concurrent sessions — verify `git status -sb`/branch before any commit; stage by explicit path (per `feedback_shared_checkout_concurrent_branch_switch_hazard`).
- No `deno` locally → CI is authoritative for the Deno gates (DS-02, webhook tests); replicate gate logic in node to verify locally.
