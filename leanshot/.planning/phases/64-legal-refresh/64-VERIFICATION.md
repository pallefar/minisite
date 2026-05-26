---
phase: 64
phase_name: Legal Refresh
status: passed
verdict: automated-verify-only
shipped: 2026-05-26
plans_complete: 8/8
requirements_complete: 9/9 (LEGAL-01..09) + AUTH-16 cross-ref
human_verification_deferred_to: Phase 70
---

# Phase 64 — Verification

**Status:** `passed` (automated-verify-only).

## Automated Verification

### Must-haves (all PASS)

- [x] 5 DB tables created with RLS (privacy_optout_requests + policy_notice_log + ad_targeting_exclusion + email_lifecycle_exclusion + data_rights_requests)
- [x] Dual-auth submission pattern (surrogate PK + partial unique indexes) for anon + authenticated opt-out paths
- [x] privacy-optout-process Edge Fn deployed ACTIVE — synchronous fan-out to PostHog + ad_targeting + email_lifecycle (INSIGHTS-09 lesson applied — direct writes, NOT queue)
- [x] grandfathered-policy-notice Edge Fn deployed ACTIVE — idempotent (ON CONFLICT DO NOTHING), operator-invoked at Phase 70, PHYSICAL_ADDRESS + PHASE_64_SHIP_DATE runtime guards
- [x] PrivacyPolicy.tsx extended with 5 state addendums (CA/VA/CO/CT/UT anchored) + TOC + "Last updated" banner + live SubprocessorList
- [x] DoNotSellPage / AccessibilityPage / DMCAPage shipped with full content (stubs from 64-07 replaced at merge)
- [x] LegalLayout upgraded to render title as font-display H1 (single H1 invariant)
- [x] DSAR portal extended with state-residency Select + 7 state-specific request_type checkboxes; legacy account-deletion RPC preserved
- [x] Cookie banner US copy with Do-Not-Sell link + AUTH-16 sign-in-rate-limiting mention (EU copy unchanged)
- [x] 3 new hash routes wired in App.tsx (#/legal/accessibility, #/legal/dmca, #/privacy/do-not-sell)
- [x] LegalFooter expanded to 8 entries
- [x] sitemap.xml created with all legal surfaces

### Test Coverage

- **src-ui-unit (legal + dsar + consent)**: 11 files / 62 tests pass
- **DSAR state-request-types unit tests**: 8/8 pass
- **functions-unit (privacy-optout-process + grandfathered-policy-notice handlers)**: 18 tests pass (7 + 11)
- **tsc**: clean (DSAR `data: never` cast applied post-merge)

### Deploy Evidence

- 5 migrations applied to remote `ytnsipxxmzgaebkqmokp` via `supabase db push --linked`:
  - 20290103000001_privacy_optout_requests.sql
  - 20290103000002_policy_notice_log.sql
  - 20290103000003_ad_targeting_exclusion.sql
  - 20290103000004_email_lifecycle_exclusion.sql
  - 20290103000005_data_rights_requests.sql
- 2 Fns deployed ACTIVE (2026-05-26):
  - `privacy-optout-process`
  - `grandfathered-policy-notice`

## Human Verification (Deferred to Phase 70)

- **Legal counsel review** of all draft copy (PrivacyPolicy state addendums + ToS UGC + Accessibility + DMCA)
- **DMCA agent registration** with U.S. Copyright Office (operator)
- **`PHYSICAL_ADDRESS` + `PHASE_64_SHIP_DATE` env vars** set in Supabase Function Secrets at deploy time
- **`abuse@leanshot.app` Resend Inbound routing** configured (operator)
- **Grandfathered-notice email send** — bearer-authenticated POST to deployed Fn at launch
- **Cookie banner WCAG 2.2 AA axe-core re-audit** on staging URL
- **Opt-out fan-out smoke test** — submit at staging, verify PostHog + ad-network + email-lifecycle propagation within 24h

## Verdict

**PASSED** — automated verification complete. LEGAL-01..09 + AUTH-16 all functionally delivered.
