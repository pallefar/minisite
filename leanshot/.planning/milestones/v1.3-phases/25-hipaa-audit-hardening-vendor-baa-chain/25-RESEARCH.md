# Phase 25: HIPAA Audit Hardening + Vendor BAA Chain — Research

**Researched:** 2026-05-17
**Domain:** HIPAA engineering controls (audit DB, runtime BAA-scope guard, PHI-aware email split, CI lints, session-replay/error-mask discipline) + 6-vendor BAA chain signing + SOC 2 Type I via Drata
**Confidence:** HIGH on vendor matrix + pricing (already verified in v1.3 STACK research + project memory `[[reference_hipaa_baa_vendor_matrix]]` on 2026-05-17) · HIGH on Sentry mask attribute + ph-no-capture class + AWS SES Deno import shape · **MEDIUM-LOW on D-16 PostHog config name — `disable_session_recording_on_url` does NOT exist in posthog-js** (verified against PostHog config docs + multiple WebSearches; CONTEXT.md spec is wrong, planner must adapt — see Pitfall 1 below) · MEDIUM on Anthropic per-model BAA allowlist (Anthropic documents BAA at the *plan/account* level, NOT per model ID — the "allowlist" is engineering's own discipline, not a vendor-published list)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (17 D-IDs)

**Vendor BAA chain**
- **D-01** All 6 vendor BAA calls kicked off in PARALLEL during Phase 24 Wave 0; founder owns all 6. Supabase Team+HIPAA ($924/mo), Vercel Pro+HIPAA ($350/mo), Sentry Business ($80/mo), Anthropic Enterprise (sales, $500–2K/mo), AWS SES via AWS Artifact (~$10/mo), PostHog (tier decision per D-04). Tracked in `vendor_baa_chain` table with `baa_signed_at` + `baa_expiry_at`.
- **D-02** Stripe NEVER signs BAA; CI lint enforces "banking exemption" boundary (PHI keywords blocked in Stripe API call sites at commit time).
- **D-03** Resend NEVER signs BAA at v1.3; PHI emails route via AWS SES. `_shared/email-router.ts` switches on template `phi: boolean`. Non-PHI (welcome, receipts, marketing, password reset) stays on Resend. PHI (clinic notifications, dose alerts, doctor-share confirmations, patient access-log notifications) → AWS SES with BAA.
- **D-04** PostHog HIPAA tier = scrub-only, NO Boost add-on at v1.3 (save $24K/yr). Session-replay HARD-disabled on all PHI URL regex. Revisit only when "no clinician-dashboard replay" becomes an active blocker.

**SOC 2 + compliance tooling**
- **D-05** Drata for SOC 2 Type I at v1.3 (~$10–15K + 6wk). Type II deferred to v1.5. Single tool covers SOC 2 Type I + HIPAA-10 training + periodic access review.
- **D-06** Written policies live at `/legal/hipaa/` in repo (SoT) + Notion mirror. Subdirs: access-control, incident-response, breach-notification, training, baa-management, risk-assessment, data-classification.

**phi_access_log (HIPAA-14)**
- **D-07** `phi_access_log` writes triggered by explicit RPC calls at sensitive UI surfaces ONLY (patient detail page open, photo viewer open, dose-history export, conversation thread open). Roster paginate = ZERO log rows. Implemented as `select log_phi_access(actor_id, patient_id, accessed_fields[], reason)` SECURITY DEFINER RPC.
- **D-08** `phi_access_log` retention = same as `audit_logs` (90d hot + Parquet cold forever). Patients see "Who has viewed my data" tab in account Settings (right-of-accounting-of-disclosures).

**Stripe PHI keyword lint (HIPAA-08)**
- **D-09** PHI keyword list = static curated JSON at `scripts/stripe-phi-keywords.json`. Initial 23 keywords. Allowlist via inline `// stripe-phi-lint:allow reason='...'` comment. Lives at `scripts/lint-stripe-phi.ts` + CI workflow step.

**MFA enforcement (HIPAA-15)**
- **D-10** Clinician MFA = hard-cut at first `/clinic/*` request post-Phase-25 deploy. Same posture as Phase 24 D-06 admin. Org-admin CANNOT defer.
- **D-11** Patient MFA = optional (skippable onboarding prompt + persistent Settings). Sensitive patient actions (account deletion, change clinic affiliation, export full data) trigger email-OTP step-up regardless of TOTP enrollment.

**BAA expiry + subprocessor alerts (HIPAA-12, HIPAA-13)**
- **D-12** BAA expiry + subprocessor-diff alert = admin banner + email-to-founder + audit-log entry. Nightly `vendor_baa_chain` check cron. 60d advance amber banner; 30/14/7/1d escalate; on expiry red. Subprocessor-diff cron weekly vs last-known snapshot.

**Anthropic dual-credential router (HIPAA-07, HIPAA-04)**
- **D-13** `ai-chat` Edge Function branches on `org_id IS NOT NULL`. Clinical: `ANTHROPIC_CLINICAL_API_KEY` (BAA + ZDR + restrictive prompt + web_search disabled). Consumer: `ANTHROPIC_CONSUMER_API_KEY`. Default to consumer ONLY when `org_id` genuinely null; never silent-fallback from clinical to consumer.
- **D-14** Runtime BAA-scope guard (HIPAA-04 success criterion #1). Hard-coded allowlist of BAA-covered Anthropic model IDs in `_shared/anthropic-baa-allowlist.ts`. Edge Fn refuses with 403 + audit-log entry if not allowed.

**Sentry + PostHog masking (HIPAA-16, HIPAA-17)**
- **D-15** Sentry `data-sentry-mask` audit via CI lint. ESLint/grep scans `.tsx` for PHI prop names; REQUIRES `data-sentry-mask` attribute on that element. PHI-prop list at `scripts/sentry-mask-required-props.json`.
- **D-16** PostHog `disable_session_recording_on_url` regex covers `/clinic/*`, `/patient/*`, `/admin/users/*`, `/dose-log/*`, `/share/*`, `/auth/*`. **(Researcher note: this exact config option does NOT exist in posthog-js — see Pitfall 1 below for the planner-actionable correction.)**

**Annual risk assessment + breach SLA (HIPAA-18)**
- **D-17** Annual risk assessment template at `/legal/hipaa/risk-assessment.md`; Drata schedules + tracks. Breach SLA = 60 days to HHS. Tabletop drill annually.

### Claude's Discretion
- Exact DDL for `vendor_baa_chain` and `phi_access_log` (follow v1.2 conventions per `[[reference_supabase_migration_gotchas]]`).
- Exact regex/glob for Stripe PHI lint (single tool for all `.ts`/`.tsx` matching `stripe.*` imports).
- Drata SDK vs portal-only flow per Drata's current docs.
- Whether dual Anthropic credentials live in Supabase Function Secrets vs Vercel env (recommend Function Secrets to keep secrets out of build pipeline).
- Drata vs Vanta migration path (Drata picked; switch acceptable BEFORE Type I attestation work starts).
- Pre-stubbing strategy: insert `vendor_baa_chain` rows with `status='pending'`, flip to `signed` as each vendor call closes during Wave 0.

### Deferred Ideas (OUT OF SCOPE)
- SOC 2 Type II attestation (v1.5).
- PostHog Boost add-on ($2K/mo).
- PagerDuty / oncall tool for BAA expiry.
- Org-admin per-clinician MFA grace extension.
- Patient mandatory MFA.
- Drata-hosted policy library as SoT.
- Dynamic PHI keyword lint from `medications` table.
- Per-row trigger phi_access_log on all PHI tables.
- Per-org BAA scoping → defers to Phase 28 (org schema) + Phase 30 (clinician dashboard).
- Anthropic third-credential tier (extra-restrictive prompts for clinic-research) → v1.5.
- In-product BAA viewer for clinics ("download our BAA + subprocessor list") → P30/P31.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HIPAA-01 | Supabase Team + HIPAA add-on active; BAA signed; data-region locked | Vendor matrix §1 — self-serve via Dashboard upgrade flow on Team plan; HIPAA add-on enabled via support ticket; data-region pinned at project create time (already pinned on `ytnsipxxmzgaebkqmokp`). |
| HIPAA-02 | Vercel Pro + HIPAA add-on active; BAA signed | Vendor matrix §2 — self-serve since 2025; activate in Vercel Dashboard → Team Settings → Billing → "HIPAA add-on" toggle; BAA signed via Vercel support ticket. |
| HIPAA-03 | Sentry Business plan active; BAA signed; PHI scrubbing configured | Vendor matrix §3 — upgrade to Business at sentry.io/settings/billing; signed BAA via sentry.io/legal/baa/ |
| HIPAA-04 | Anthropic Enterprise plan active; BAA + ZDR signed; runtime model-allowlist guard | Vendor matrix §4 — sales-assisted only; HIPAA toggle at Organization → Data & Privacy after activation. **Engineering deliverable:** `_shared/anthropic-baa-allowlist.ts` allowlist + 403 refusal path tested. |
| HIPAA-05 | AWS SES BAA active for PHI email; `_shared/email-router.ts` switches on `phi:boolean` | Vendor matrix §5 — BAA self-serve in AWS Artifact (same-day). **Engineering:** see Stack §SES Edge import + Code Example 3 + Pitfall 7 (sandbox-mode lift). |
| HIPAA-06 | PostHog tier-decision implemented (scrub-only at v1.3 per D-04); session-replay disabled on PHI URL regex regardless | Vendor matrix §6. **Engineering:** see Pitfall 1 — D-16 config name is wrong; programmatic stop on route-change is the actual mechanism. |
| HIPAA-07 | Dual Anthropic credentials; branch in `ai-chat` Edge Fn on `org_id IS NOT NULL` | D-13. **Engineering:** new Edge Function or extend v1.2 `ai-chat`. Note: v1.2 `ai-chat` currently proxies to Moonshot Kimi K2, NOT Anthropic (see Code Context §1). Phase 25 either replaces or adds Anthropic branch alongside Moonshot. |
| HIPAA-08 | Stripe PHI keyword CI lint (banking exemption boundary) | D-09. **Engineering:** `scripts/lint-stripe-phi.ts` + 23-keyword JSON + CI step. Pattern: `scripts/assert-clinic-bundle-budget.sh` is the reference shape. |
| HIPAA-09 | SOC 2 Type I attestation in parallel via Drata | D-05; 6-week onboarding lead time, kick off Wave 0. |
| HIPAA-10 | Employee security training + access-review automation | Drata's controls library auto-collects evidence from 300+ integrations. |
| HIPAA-11 | Written policies live in `/legal/hipaa/` + Notion mirror | D-06; 7 markdown files (access-control, incident-response, breach-notification, training, baa-management, risk-assessment, data-classification). |
| HIPAA-12 | `vendor_baa_chain` table; weekly subprocessor-diff cron | D-12. **Engineering:** new migration + cron Edge Fn + admin UI surface. |
| HIPAA-13 | BAA expiry calendar (60-day advance alert) | D-12. **Engineering:** nightly check cron + admin banner + email-to-founder. |
| HIPAA-14 | `phi_access_log` sibling table + append-only RLS | D-07/D-08. **Engineering:** new migration + `log_phi_access` SECURITY DEFINER RPC + patient-side viewer route. |
| HIPAA-15 | MFA enforcement on all clinician + admin roles | D-10 (clinician hard-cut). Phase 24 D-06..09 already covers admin TOTP — Phase 25 extends to `/clinic/*`. |
| HIPAA-16 | Sentry `data-sentry-mask` CI lint on PHI-bearing components | D-15. **Engineering:** `scripts/audit-sentry-mask.ts` + props JSON + CI step. |
| HIPAA-17 | PostHog session-recording disabled on PHI URL regex | D-16. **Engineering:** see Pitfall 1 — exact config name doesn't exist; use route-change `posthog.stopSessionRecording()` + ensure session_recording is disabled by default at init. |
| HIPAA-18 | Annual risk assessment + breach SLA (60d HHS) documented | D-17. Document at `/legal/hipaa/risk-assessment.md` + `/legal/hipaa/incident-response.md`; Drata schedules. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

**Mandatory directives extracted from `./CLAUDE.md` that the planner MUST honor:**

| Constraint | Source | Phase-25 impact |
|------------|--------|-----------------|
| React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand only | Tech stack | New client surfaces (account-Settings PHI viewer, /admin/compliance) must conform |
| Bundle ceiling — Phase 24 D-18..20 hard-fails CI on overage | Existing CI | Phase 25 adds NO new client chunk; `/admin/compliance` lives inside `admin-shell` 30 kB cap |
| `sync-defer.ts` MANDATORY for heavy SDKs | Bundle discipline | n/a — Phase 25 SDKs (`@aws-sdk/client-sesv2`, `@anthropic-ai/sdk`) are Edge-Function-only, never client-bundled |
| ESLint `import-x/no-restricted-paths` glob form (per `[[reference_eslint_import_x_path_gotcha]]`) | eslint.config.js | Stripe-PHI grep + Sentry-mask audit are SHELL scripts not ESLint rules, so this doesn't bite, but the planner should keep it in mind if it pivots to an ESLint custom rule |
| Strict TS, `noUnusedLocals`, `noUnusedParameters` | tsconfig.app.json | All new files must pass these gates |
| Path alias `@/*` → `./src/*` mandatory | tsconfig + vite | Use `@/lib/...` not relative |
| Synchronous hydration before first render (no `currentTab` flash) | `main.tsx` | n/a (no new persisted store slices in Phase 25 — phi_access_log/vendor_baa_chain are server-only) |
| All dates as ISO strings or `YYYY-MM-DD` | Storage convention | `vendor_baa_chain.baa_expiry_at` is `timestamptz`; expose to UI as ISO string |
| GSD workflow enforcement — file changes via `/gsd-execute-phase` | CLAUDE.md project skills | Plans must conform to GSD plan/task structure |

## Summary

Phase 25 is a **two-track workstream**: ENGINEERING (small, well-scoped, ~9 plans across 3 waves) ships entirely as additive code + 2 new tables + 3–4 new Edge Functions, none of which adds client-bundle weight. VENDOR/LEGAL (large, paid, parallel) is 6 BAA signings + Drata onboarding (~6 weeks), already kicked off in Phase 24 Wave 0; engineering ships behind health-check stubs per `[[reference_vendor_gated_send_health_check]]` so code lands before BAAs close. The HIPAA-04 success criterion (runtime BAA-scope guard refuses non-allowlisted Anthropic models with 403 + audit-log entry) is the single most testable HIPAA control in the phase and should anchor Plan 25-04's verification.

**Three load-bearing corrections to CONTEXT.md surface in this research** that the planner MUST address:

1. **D-16 PostHog config name `disable_session_recording_on_url` does not exist in posthog-js.** Verified against the canonical PostHog JS config reference + GitHub source search. The real mechanism is `disable_session_recording: true` global default + programmatic `posthog.startSessionRecording()` / `posthog.stopSessionRecording()` driven by route changes, OR PostHog dashboard URL triggers (per-project UI config, web SDK ≥1.171.0, "enable on URL match" only — no "disable on URL match"). Planner must replace D-16 spec with a route-change React hook that calls `stopSessionRecording()` when location matches the PHI regex. The acceptance check in Success Criterion #5 becomes "session_recording does NOT start when navigated to any of the 6 PHI URL prefixes" + a Playwright e2e proof.
2. **D-13 v1.2 `ai-chat` Edge Function currently proxies to Moonshot Kimi K2** (per `src/lib/ai.ts:5-7` + Phase 4 D-01..05), NOT Anthropic. CONTEXT.md describes the dual-credential router as if v1.2 already routes to Anthropic. Plan 25-04 must decide: (a) replace Moonshot with Anthropic for consumer too (cost change), (b) keep Moonshot for consumer + add Anthropic for clinical only (3-way branch: `org_id IS NOT NULL` → Anthropic clinical, else → Moonshot consumer), or (c) ship Anthropic-clinical-only and leave consumer Moonshot untouched.
3. **Anthropic does NOT publish a per-model HIPAA BAA allowlist.** BAA scope is account-tier-scoped (HIPAA-ready Enterprise) + admin-toggle gated; web_search, Workbench, Console, Cowork, Claude Code (except CLI with ZDR explicitly configured) are excluded by *product*, not by model ID. The "allowlist" in D-14 is therefore engineering's OWN curated list of model IDs we have decided to use in clinical context (e.g., `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`) + a denylist of beta/preview/`-beta` suffixed IDs. The allowlist file `_shared/anthropic-baa-allowlist.ts` becomes a versioned engineering-managed config, not a vendor-published manifest. The subprocessor-diff cron (D-12) should additionally watch [`trust.anthropic.com/updates`](https://trust.anthropic.com/updates) for model-availability changes.

**Primary recommendation:** Accept the 10-plan / 3-wave outline in STATE.md with three minor refinements: (a) split 25-06 into 25-06a (Sentry-mask CI lint) and 25-06b (PostHog route-change replay disable hook) because Pitfall 1 makes 25-06's PostHog half a different shape than the Sentry half; (b) explicitly call Plan 25-04 "Anthropic clinical credential + BAA-scope guard" and document the v1.2 Moonshot vs Anthropic decision as a Plan 25-04 prerequisite question; (c) keep 25-10 as a Phase-24 coordination verifier task that asserts `_shared/posthog-server.ts` and `audit_logs` migration are merged before 25-08 ships.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `vendor_baa_chain` storage + RLS deny | DB (Postgres) | — | Append-only + admin-read-only RLS; service_role insert via SECURITY DEFINER cron Edge Fn |
| Nightly BAA-expiry check cron | Edge Function (pg_cron-triggered) | DB (read) | Cron reads expiry dates, computes days-until, writes admin notification rows |
| Weekly subprocessor-diff scrape | Edge Function (pg_cron-triggered) | DB (snapshot table) | Fetches public subprocessor pages from 6 vendors, diffs vs last snapshot, alerts on change |
| `phi_access_log` storage + append-only RLS | DB (Postgres) | — | DENY update + delete (incl. service_role) per `[[reference_supabase_migration_gotchas]]` |
| `log_phi_access` RPC | DB (SECURITY DEFINER fn) | — | Called from clinician-facing UI components; writes one row per access |
| Patient "Who has viewed my data" viewer | Browser (account Settings) | DB (RLS-scoped SELECT) | Patient sees own `phi_access_log` rows only; standard RLS predicate `WHERE accessed_user_id = auth.uid()` |
| `_shared/email-router.ts` (Resend ↔ SES split) | Edge Function (`_shared`) | AWS SES + Resend APIs | Branches on `template.phi: boolean`; SES for PHI, Resend for non-PHI; both clients lazy-init |
| AWS SES bounce/complaint webhook | Edge Function (HTTP) | AWS SNS → Edge Fn HTTP endpoint | SNS posts to Supabase Edge Fn URL; function writes to suppression list table |
| Anthropic dual-credential router | Edge Function (`ai-chat` or new `ai-chat-clinical`) | Anthropic API | Branches on `org_id IS NOT NULL`; clinical uses BAA + ZDR credential + restrictive prompt + web_search disabled |
| Anthropic BAA-scope guard (model-ID allowlist) | Edge Function (`_shared/anthropic-baa-allowlist.ts`) | DB (audit_logs write on refusal) | Synchronous check before forward; 403 + audit row on non-allowlisted model |
| Stripe PHI CI lint | CI workflow (shell + node) | — | `scripts/lint-stripe-phi.ts` reads `.ts/.tsx` files matching `stripe.*` imports; greps Stripe API call sites against keyword JSON; pass/fail at PR time |
| Sentry mask CI audit | CI workflow (shell + node) | — | `scripts/audit-sentry-mask.ts` greps `.tsx` for PHI prop names; verifies `data-sentry-mask` on enclosing element; pass/fail at PR time |
| PostHog session-replay route-change disable | Browser (React hook) | posthog-js | `useEffect(() => { if (PHI_REGEX.test(location.pathname)) posthog.stopSessionRecording(); }, [location])` — see Code Example 1 |
| Clinician MFA hard-cut at `/clinic/*` | Vercel Routing Middleware | Supabase Auth (`assertAaL2`) | Extends Phase 24 admin aal2 step-up; same pattern, different route prefix |
| Patient MFA optional + step-up on sensitive actions | Browser (React) + Supabase Auth | — | Settings UI for TOTP enrollment; sensitive-action handler calls `supabase.auth.mfa.challenge` before proceeding |
| `/admin/compliance` page | Browser (admin shell module) | DB (vendor_baa_chain + subprocessor_snapshots SELECT) | New module entry in Phase 24's `ADMIN_MODULES` manifest; minRole=superadmin (D-04) |
| Drata onboarding stub + evidence sync | External (Drata portal) + manual | optionally Drata API for integration evidence | 80% of evidence auto-collected by Drata; portal-driven onboarding ~6 weeks |
| Written policies | Repo (`/legal/hipaa/*.md`) | Notion mirror (auto-sync) | Source-of-truth is git; Notion is read-only mirror for non-engineering readers |

## Standard Stack

### Core (Edge Function dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-sesv2` | `^3.700.0` | AWS SES v2 send + bounce-handling | Modular AWS SDK v3 (only SESv2 client loads, not entire AWS SDK); Deno-compat via `npm:` specifier in Supabase Edge Runtime (verified Supabase docs); supersedes legacy `@aws-sdk/client-ses` (v1 API) `[VERIFIED: aws-sdk-js-v3 + supabase edge functions docs 2026-05-17]` |
| `@anthropic-ai/sdk` | `^0.40.0+` | Anthropic Messages API client (clinical credential) | Official SDK; supports `baseURL` for AI-Gateway proxy + ZDR header `anthropic-zdr: true` (when enabled at account level). `[VERIFIED: live npm 2026-05-17 via WebSearch — current major as of research]` `[ASSUMED]` for exact minor (verify via `npm view @anthropic-ai/sdk version` at plan time) |
| `posthog-node` | `^5.10.4` | (Already added by Phase 24) — used by 25-04 to audit-log BAA-scope guard refusals to PostHog with `phi:false` event | Same Phase-24 `_shared/posthog-server.ts` helper; no new dependency |

### Supporting (CI scripts + dev)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fast-glob` | `^3.x` | File scan for Sentry-mask + Stripe-PHI CI scripts | Reading `src/**/*.tsx` / `**/*.ts` lists in CI Node scripts; v1.2 already uses for `scripts/audit-privacy-manifest.mjs` style |
| `chalk` | `^5.x` | Colored CI lint output | Optional polish; bundle-budget script already uses similar shell colors |
| `nanoid` | `^5.1.6` (already v1.2) | Idempotency keys for cron writes (subprocessor-diff snapshot row IDs) | Already in v1.2 stack; reuse |

### NOT a new package (use existing)

- `@sentry/react` — already wired in v1.2 (`src/lib/sentry.ts`). Phase 25 changes only configuration + adds the `data-sentry-mask` CI audit. Sentry's `data-sentry-mask` HTML attribute (or `sentry-mask` CSS class) is a **runtime** masking signal consumed by `@sentry/replay` — no SDK change needed, no version bump required `[CITED: https://docs.sentry.io/platforms/javascript/guides/react/session-replay/privacy/]`.
- `posthog-js` — already wired in `src/lib/analytics.ts`. Phase 25 adds a route-change React hook + ensures `session_recording` is opted-out at init. No version bump unless we need ≥1.171.0 for dashboard-side URL triggers (which we don't, because we're doing programmatic stop, not enable-on-match).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AWS SES | Paubox Email API | Paubox auto-falls-back to Secure Message Center on TLS-fail (no silent drops); $29/user/mo vs SES $0.10/1k. CONTEXT.md D-03 + STACK.md picked SES for cost. **Do not revisit unless PHI email volume scales past 100k/mo OR a dropped clinical email is unacceptable** |
| Drata | Vanta / Secureframe | Drata has cleaner control monitoring + multi-framework support per 2026 reviews `[CITED: g2.com/drata-reviews, truvocyber.com/soc-2-audit-guide]`. CONTEXT.md D-05 picked Drata. **Switch acceptable BEFORE Type I attestation starts** |
| `@aws-sdk/client-sesv2` (Deno via `npm:`) | `nodemailer` with SES transport | Nodemailer adds CJS+EventEmitter weight; client-sesv2 is tree-shakable + native Deno-compat. Use SDK directly. |
| Anthropic SDK direct | Vercel AI Gateway proxy | v1.2 routes Anthropic through Vercel AI Gateway already; clinical credential SHOULD also route through Gateway for consistency + observability + Gateway BAA coverage (assumed covered under Vercel BAA — verify in vendor BAA call). `[ASSUMED]` Gateway-under-Vercel-BAA |
| Custom CI lint | ESLint custom plugin | Shell+Node script faster to ship, easier to debug, no ESLint plugin authoring overhead. `scripts/lint-stripe-phi.ts` + `scripts/audit-sentry-mask.ts` shape matches v1.2 conventions (e.g., `scripts/check-unused-baseline.sh`) |

**Installation:**

```bash
# CI/dev (root package.json)
npm install -D fast-glob chalk

# Edge function dependencies — NOT npm install; declared per-function via deno.json import map:
# supabase/functions/email-router/deno.json
# supabase/functions/ai-chat-clinical/deno.json (or extend existing ai-chat)
# Use the form: "imports": { "@aws-sdk/client-sesv2": "npm:@aws-sdk/client-sesv2@^3.700.0" }
```

**Version verification — REQUIRED at plan time:**

```bash
npm view @aws-sdk/client-sesv2 version
npm view @anthropic-ai/sdk version
npm view fast-glob version
```

Document the verified version + publish date in plan frontmatter. Training data versions are stale.

## Architecture Patterns

### System Architecture Diagram

```
                            HIPAA Engineering Controls (Phase 25)
                                          │
        ┌─────────────────────────────────┼────────────────────────────────────┐
        │                                 │                                    │
        ▼                                 ▼                                    ▼
   AUDIT TRACK                    EMAIL+AI TRACK                       LINT+MASK TRACK
        │                                 │                                    │
        │  ┌───────────────────┐         │  ┌─────────────────────┐          │  ┌────────────────────┐
        │  │ phi_access_log    │         │  │ _shared/email-      │          │  │ scripts/lint-      │
        │  │ (DB, append-only) │         │  │   router.ts         │          │  │   stripe-phi.ts    │
        │  └─────────┬─────────┘         │  │  (Edge Fn shared)   │          │  │  (CI workflow)     │
        │            │ INSERT             │  │                     │          │  │  blocks PHI kw in  │
        │  ┌─────────▼─────────┐         │  │  if template.phi:   │          │  │  stripe API calls  │
        │  │ log_phi_access()  │         │  │    → AWS SES (BAA)  │          │  └────────────────────┘
        │  │ SECURITY DEFINER  │         │  │  else:              │          │
        │  └─────────┬─────────┘         │  │    → Resend         │          │  ┌────────────────────┐
        │            │                    │  └─────────┬───────────┘          │  │ scripts/audit-     │
        │  ┌─────────▼─────────┐         │            │                       │  │   sentry-mask.ts   │
        │  │ Clinician UI      │         │  ┌─────────▼───────────┐          │  │  (CI workflow)     │
        │  │ surfaces (patient │         │  │ SES SNS bounce/     │          │  │  REQUIRES data-    │
        │  │ detail, photos,   │         │  │   complaint webhook │          │  │  sentry-mask on    │
        │  │ exports, threads) │         │  │ (Edge Fn HTTP) →    │          │  │  PHI-bearing JSX   │
        │  └───────────────────┘         │  │ suppression table   │          │  └────────────────────┘
        │            ▲                    │  └─────────────────────┘          │
        │            │ patient sees own   │                                    │  ┌────────────────────┐
        │            │ rows via Settings  │  ┌─────────────────────┐          │  │ PostHog session-   │
        │            │ /privacy/access-   │  │ ai-chat Edge Fn     │          │  │   recording route- │
        │            │ log (RLS-scoped)   │  │ branches on org_id  │          │  │   change hook      │
        │            │                    │  │  IS NOT NULL:       │          │  │ (browser, in App)  │
        │  ┌─────────┴─────────┐         │  │   YES → Anthropic   │          │  │ stops recording on │
        │  │ vendor_baa_chain  │         │  │     CLINICAL_KEY    │          │  │ PHI URL regex      │
        │  │ (DB, admin-read)  │         │  │     + ZDR + restr.  │          │  │ (Pitfall 1 fixes   │
        │  └─────────┬─────────┘         │  │     prompt + no     │          │  │  D-16 spec)        │
        │            │ nightly cron       │  │     web_search     │          │  └────────────────────┘
        │  ┌─────────▼─────────┐         │  │   NO  → existing    │          │
        │  │ BAA-expiry check  │         │  │     (Moonshot OR    │          │  ┌────────────────────┐
        │  │ Edge Fn (pg_cron) │         │  │     Anthropic       │          │  │ Clinician MFA      │
        │  │ → admin banner +  │         │  │     CONSUMER_KEY)   │          │  │   hard-cut at      │
        │  │   email founder + │         │  └─────────┬───────────┘          │  │   /clinic/*        │
        │  │   audit_logs row  │         │            │                       │  │ (Vercel Routing    │
        │  └───────────────────┘         │  ┌─────────▼───────────┐          │  │  Middleware ext)   │
        │            │                    │  │ _shared/anthropic-  │          │  └────────────────────┘
        │  ┌─────────▼─────────┐         │  │   baa-allowlist.ts  │          │
        │  │ Weekly subproc-   │         │  │ checks model ID     │          │
        │  │   diff cron       │         │  │   against allowlist │          │
        │  │ Edge Fn (pg_cron) │         │  │   BEFORE forward;   │          │
        │  │ scrapes 6 vendor  │         │  │   403 + audit log   │          │
        │  │ subproc pages →   │         │  │   if not allowed    │          │
        │  │ subprocessor_     │         │  │ (HIPAA-04 SC #1)    │          │
        │  │ snapshots; diff;  │         │  └─────────────────────┘          │
        │  │ on change: alert  │         │                                    │
        │  └───────────────────┘         │                                    │
        │            │                    │                                    │
        │  ┌─────────▼─────────┐         │                                    │
        │  │ /admin/compliance │◄─────── reads vendor_baa_chain + ───────────┘
        │  │ admin-shell page  │         subprocessor_snapshots + Drata
        │  │ (new module entry │         sync status. superadmin only.
        │  │  in Phase 24      │
        │  │  manifest)        │
        │  └───────────────────┘
        │
        └── PROCESS / POLICY TRACK (parallel, founder + Drata): /legal/hipaa/*.md (7 files) +
            Drata onboarding portal + employee training + annual risk assessment template
            + breach notification SLA doc.
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 2026MMDDHHmmss_vendor_baa_chain.sql           # 25-01: table + RLS deny + seed rows status='pending'
│   ├── 2026MMDDHHmmss_subprocessor_snapshots.sql     # 25-08: weekly diff table
│   ├── 2026MMDDHHmmss_phi_access_log.sql             # 25-02: table + RLS append-only + log_phi_access fn
│   ├── 2026MMDDHHmmss_ses_suppression_list.sql       # 25-03: SES bounce/complaint suppression
│   └── 2026MMDDHHmmss_baa_alert_cron.sql             # 25-08: pg_cron schedule (nightly + weekly)
├── functions/
│   ├── _shared/
│   │   ├── email-router.ts                           # 25-03: SES + Resend split on template.phi
│   │   ├── anthropic-baa-allowlist.ts                # 25-04: model-ID allowlist + guard fn
│   │   └── (Phase 24 ships posthog-server.ts here)
│   ├── ai-chat-clinical/                             # 25-04: new fn OR extend existing ai-chat
│   │   ├── deno.json                                 # imports: @anthropic-ai/sdk
│   │   └── index.ts
│   ├── email-router/                                 # 25-03: thin HTTP wrapper around _shared/email-router
│   │   ├── deno.json                                 # imports: @aws-sdk/client-sesv2, resend
│   │   └── index.ts
│   ├── ses-bounce-webhook/                           # 25-03: SNS → suppression table
│   │   ├── deno.json
│   │   └── index.ts
│   ├── baa-expiry-check/                             # 25-08: nightly cron
│   │   └── index.ts
│   └── subprocessor-diff/                            # 25-08: weekly cron
│       └── index.ts
src/
├── components/admin/compliance/                      # 25-08: admin shell module
│   ├── ComplianceModule.tsx                          # vendor_baa_chain UI + expiry banner + subproc feed + Drata status
│   ├── BaaChainTable.tsx
│   ├── SubprocessorDiffFeed.tsx
│   └── ExpiryBanner.tsx
├── components/account/PhiAccessLogTab.tsx            # 25-02: patient-side viewer (Settings tab)
├── components/auth/PatientMfaSettings.tsx            # 25-07: optional TOTP enrollment + sensitive-action step-up
├── lib/hipaa/
│   ├── phi-access-rpc.ts                             # 25-02: typed wrapper around log_phi_access RPC
│   └── session-replay-guard.ts                       # 25-06b: route-change hook for PostHog stopSessionRecording
scripts/
├── lint-stripe-phi.ts                                # 25-05: PHI keyword grep
├── stripe-phi-keywords.json                          # 25-05: 23 keywords (D-09)
├── audit-sentry-mask.ts                              # 25-06a: data-sentry-mask audit
└── sentry-mask-required-props.json                   # 25-06a: PHI prop name list
legal/hipaa/                                           # 25-09: 7 policy markdowns (D-06)
├── access-control.md
├── incident-response.md
├── breach-notification.md
├── training.md
├── baa-management.md
├── risk-assessment.md
└── data-classification.md
.github/workflows/
├── lint-stripe-phi.yml                               # 25-05: CI step
└── audit-sentry-mask.yml                             # 25-06a: CI step
```

### Pattern 1: Append-only PHI audit table

**What:** `phi_access_log` table with DENY policies on `update` and `delete` for ALL roles (including `service_role`), inserts gated through a `SECURITY DEFINER` RPC owned by `postgres` with `search_path = pg_temp, public, extensions`.

**When to use:** Any HIPAA audit-trail table (`audit_logs`, `phi_access_log`, `subprocessor_snapshots`).

**Example:**

```sql
-- Source: extends Phase 24 D-17 audit_logs pattern + [[reference_supabase_migration_gotchas]]
create table public.phi_access_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid not null references auth.users(id),
  accessed_user_id uuid not null references auth.users(id),
  accessed_org_id uuid,  -- forward-compat for P28 org axis
  accessed_fields text[] not null,
  reason text not null,
  -- P28 forward-compat (per Phase 24 D-04..05 pattern)
  org_id uuid
);

alter table public.phi_access_log enable row level security;

-- Patient sees their own access history (D-08)
create policy phi_access_log_patient_select on public.phi_access_log
  for select to authenticated
  using (accessed_user_id = auth.uid());

-- Org admin sees their org's access history (forward-compat to P28)
-- (Plan 25-02 ships this commented OR with stub predicate until P28 org_members exists)

-- DENY update + delete to ALL roles incl service_role
create policy phi_access_log_no_update on public.phi_access_log
  for update to public using (false);
create policy phi_access_log_no_delete on public.phi_access_log
  for delete to public using (false);

-- Explicit REVOKE from service_role (per [[reference_supabase_migration_gotchas]])
revoke update, delete on public.phi_access_log from service_role;

-- SECURITY DEFINER RPC — only write path
create or replace function public.log_phi_access(
  p_accessed_user_id uuid,
  p_accessed_fields text[],
  p_reason text,
  p_accessed_org_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_temp, public, extensions
as $$
declare
  v_id uuid;
begin
  insert into public.phi_access_log (
    actor_user_id, accessed_user_id, accessed_fields, reason, accessed_org_id
  ) values (
    auth.uid(), p_accessed_user_id, p_accessed_fields, p_reason, p_accessed_org_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_phi_access(uuid, text[], text, uuid) from public;
grant execute on function public.log_phi_access(uuid, text[], text, uuid) to authenticated;
```

### Pattern 2: Email-router PHI split (D-03 + HIPAA-05)

**What:** A single `_shared/email-router.ts` exports `sendEmail(template, to, vars)`. Template metadata includes `phi: boolean`. Router branches:
- `phi: true` → AWS SES via `@aws-sdk/client-sesv2`
- `phi: false` → Resend (existing v1.2 path)

**When to use:** All transactional + lifecycle emails. Direct `resend.emails.send()` calls are forbidden after Phase 25 (CI lint should grep for offending direct calls in production code; allow only in `_shared/email-router.ts`).

**Example:**

```typescript
// Source: synthesized from AWS SDK v3 SESv2 examples + Resend v1.2 wiring
// supabase/functions/_shared/email-router.ts
import { SESv2Client, SendEmailCommand } from "npm:@aws-sdk/client-sesv2@^3.700.0";
import { Resend } from "npm:resend@^4.0.0";

interface EmailTemplate {
  templateId: string;
  subject: string;
  html: string;
  text?: string;
  phi: boolean;   // <-- the split signal
}

let _ses: SESv2Client | null = null;
let _resend: Resend | null = null;

function ses(): SESv2Client {
  if (_ses) return _ses;
  _ses = new SESv2Client({
    region: Deno.env.get("AWS_SES_REGION") ?? "us-east-1",
    credentials: {
      accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
    },
  });
  return _ses;
}

function resend(): Resend {
  if (_resend) return _resend;
  _resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
  return _resend;
}

export async function sendEmail(
  template: EmailTemplate,
  to: string,
  fromOverride?: string
): Promise<{ provider: "ses" | "resend"; id: string }> {
  // Health-check gate per [[reference_vendor_gated_send_health_check]]
  if (template.phi && !Deno.env.get("AWS_SES_BAA_ACTIVE")) {
    console.warn(`[email-router] PHI email "${template.templateId}" requested but AWS SES BAA not active — no-op send.`);
    return { provider: "ses", id: "noop-baa-pending" };
  }

  if (template.phi) {
    const cmd = new SendEmailCommand({
      FromEmailAddress: fromOverride ?? Deno.env.get("AWS_SES_FROM")!,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: template.subject },
          Body: {
            Html: { Data: template.html },
            Text: template.text ? { Data: template.text } : undefined,
          },
        },
      },
    });
    const out = await ses().send(cmd);
    return { provider: "ses", id: out.MessageId ?? "unknown" };
  }

  const res = await resend().emails.send({
    from: fromOverride ?? Deno.env.get("RESEND_FROM")!,
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  return { provider: "resend", id: res.data?.id ?? "unknown" };
}
```

`[VERIFIED: SESv2Client + SendEmailCommand API shape per @aws-sdk/client-sesv2 docs]`
`[VERIFIED: Supabase Edge Functions support npm: specifier for @aws-sdk/* per supabase.com/docs/guides/functions/dependencies 2026-05-17]`

### Pattern 3: Anthropic BAA-scope guard (HIPAA-04 success criterion #1)

**What:** Before forwarding ANY request to Anthropic in clinical context, check the requested model ID against a hard-coded allowlist of BAA-covered IDs. Refuse with 403 + audit-log entry if not allowed. Test the refusal path explicitly.

**When to use:** `ai-chat-clinical` Edge Fn entry; any future Edge Fn that calls Anthropic with clinical context.

**Example:**

```typescript
// Source: synthesized from Anthropic models doc + D-14 spec
// supabase/functions/_shared/anthropic-baa-allowlist.ts

// Engineering-managed list — NOT a vendor-published manifest (Anthropic does not publish per-model BAA tagging).
// Maintenance: add new model IDs here ONLY after confirming they ship under the BAA-eligible Enterprise tier
// (i.e., the model is listed in Anthropic's published "available models for Enterprise" page).
// Subprocessor-diff cron (D-12) watches trust.anthropic.com/updates for model availability changes.
//
// Last reviewed: 2026-05-17 — Claude 4 generation (sonnet-4-5, opus-4-6, haiku-4-5) + dated snapshots.
//
export const BAA_COVERED_ANTHROPIC_MODELS = new Set<string>([
  // Stable production aliases
  "claude-sonnet-4-5",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  // Dated snapshots (preferred for production for reproducibility)
  "claude-haiku-4-5-20251001",
  // Add more as Anthropic publishes new stable Enterprise models.
]);

// Hard denylist — these endpoints/suffixes are EXPLICITLY out of BAA scope per Anthropic
export const BAA_DENIED_SUFFIXES = [
  "-beta",
  "-preview",
  "-experimental",
];

export function assertBaaCoveredModel(modelId: string): void {
  for (const suffix of BAA_DENIED_SUFFIXES) {
    if (modelId.endsWith(suffix)) {
      throw new Response(
        JSON.stringify({
          error: "model_not_baa_covered",
          model: modelId,
          reason: `model suffix "${suffix}" is excluded from BAA scope`,
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }
  }
  if (!BAA_COVERED_ANTHROPIC_MODELS.has(modelId)) {
    throw new Response(
      JSON.stringify({
        error: "model_not_baa_covered",
        model: modelId,
        reason: "not in BAA-covered allowlist; update _shared/anthropic-baa-allowlist.ts after vendor confirmation",
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }
}

// Caller side (ai-chat-clinical/index.ts):
//
// import { assertBaaCoveredModel } from "../_shared/anthropic-baa-allowlist.ts";
// import { writeAuditLog } from "../_shared/audit.ts";  // Phase 24
//
// try {
//   assertBaaCoveredModel(requestBody.model);
// } catch (rejection) {
//   await writeAuditLog({
//     action: "anthropic_baa_guard_refused",
//     before_data: { model: requestBody.model, org_id: orgId },
//     after_data: null,
//   });
//   return rejection;  // 403 Response
// }
```

### Pattern 4: PostHog session-replay route-change disable (Pitfall 1 fix)

**What:** Because `disable_session_recording_on_url` does NOT exist (D-16 spec correction), the actual mechanism is a route-change React effect that calls `posthog.stopSessionRecording()` whenever the location matches the PHI regex.

**Example:**

```typescript
// Source: synthesized from PostHog config docs + GitHub issue #19975 + posthog-js API
// src/lib/hipaa/session-replay-guard.ts
import { useEffect } from 'react';

const PHI_URL_REGEX = /^\/(clinic|patient|admin\/users|dose-log|share|auth)(\/|$)/;

/** Call ONCE near app root. Stops PostHog session recording whenever location matches PHI prefixes. */
export function useSessionReplayPhiGuard(): void {
  useEffect(() => {
    const evaluate = async () => {
      if (PHI_URL_REGEX.test(globalThis.location.pathname)) {
        const { default: posthog } = await import('posthog-js');
        // No-op safe if recording never started
        try { posthog.stopSessionRecording(); } catch { /* ignore */ }
      }
    };
    evaluate();
    // No router in v1.2 (per CLAUDE.md "Intentionally no router") — listen on popstate + pathname polling
    const interval = setInterval(evaluate, 1000);
    globalThis.addEventListener('popstate', evaluate);
    return () => {
      clearInterval(interval);
      globalThis.removeEventListener('popstate', evaluate);
    };
  }, []);
}
```

**Caller wiring:**

```typescript
// src/main.tsx (just after initAnalytics() call)
import { useSessionReplayPhiGuard } from '@/lib/hipaa/session-replay-guard';

function AppRoot() {
  useSessionReplayPhiGuard();   // <-- HIPAA-17 enforcement
  return <App />;
}
```

**Additionally, harden the PostHog init** in `src/lib/analytics.ts` to opt-out of session recording by default — Phase 25 must verify `session_recording` is opted-out at init OR confirm PostHog dashboard project setting "Enable session recordings on all sites" is OFF + per-page enabling only on non-PHI routes.

**Verification (Plan 25-06b acceptance):**

```typescript
// Playwright test: e2e/hipaa/session-replay-phi-guard.spec.ts
test('PostHog stopSessionRecording invoked on PHI routes', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__phStopCalls = 0;
    const origImport = window.require;
    // Spy on import("posthog-js")
    // ... (use Playwright route interception to spy on /array/<key>/config calls)
  });
  await page.goto('/clinic/dashboard');
  // assert stopSessionRecording was called
});
```

### Anti-Patterns to Avoid

- **Putting PHI in Stripe `description` / `metadata` / line-item descriptions.** D-02 + HIPAA-08. CI lint enforces. Stripe's "banking exemption" only holds if PHI never enters.
- **Direct `resend.emails.send()` calls outside `_shared/email-router.ts`.** Breaks the PHI split. Add a follow-up CI grep in Plan 25-03.
- **Forgetting `set search_path = ...` on SECURITY DEFINER functions.** Per `[[reference_supabase_migration_gotchas]]`. Causes schema-resolution bugs that pass tests but fail in prod.
- **Letting service_role bypass `phi_access_log` deny policies.** Explicit `REVOKE update, delete` required. The default DENY policies do NOT block `service_role` without explicit REVOKE.
- **Silent fallback from clinical to consumer Anthropic credential when `org_id` is null but should not be.** D-13: never silent-fallback. If `org_id` resolution fails, REFUSE the request — do not pick consumer key by accident.
- **Updating `phi_access_log` rows to "correct" wrong data.** Append-only — write a new row with the correction, never UPDATE.
- **Trusting `disable_session_recording_on_url` to actually disable recording.** It does not exist. Use route-change `posthog.stopSessionRecording()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HIPAA compliance evidence collection | Custom controls-matrix tracker, manual screenshot binder | **Drata** (D-05) | 300+ integrations auto-collect 80% of evidence; SOC 2 + HIPAA + ISO + GDPR + custom frameworks in one tool. |
| PHI keyword detection in Stripe API calls | NLP / ML model | **Static keyword JSON + grep** (D-09) | Hand-curated 23-keyword list catches realistic violations; false positives clearable with inline allow comment. |
| Session-replay PHI masking | Custom DOM observer that hides patient-name elements | **Sentry `data-sentry-mask` + PostHog `ph-no-capture` class** (D-15, HIPAA-16) | Built-in to both SDKs; declarative; reviewable in PR diff. |
| Email PHI routing | Single ESP with manual scrub | **`_shared/email-router.ts` two-vendor split** (D-03, HIPAA-05) | Hard boundary at template-metadata level; auditable; one config change per template. |
| BAA expiry tracking | Calendar reminders in founder's personal calendar | **`vendor_baa_chain` + nightly cron + admin banner** (D-12, HIPAA-12, HIPAA-13) | Survives founder departure; audit-loggable; integration with admin shell. |
| Subprocessor change detection | Manual quarterly vendor-page review | **Weekly subprocessor-diff cron** (D-12) | Catches a sub-vendor swap within 7 days vs 90; supports clinic BAA's subprocessor-notification clause. |
| Anthropic BAA scope enforcement | Trust engineer to remember "don't use beta endpoints" | **Runtime BAA-scope guard with 403 refusal + audit log** (D-14) | The whole point of HIPAA-04 SC #1: refusal path is testable, breach risk is mechanical not procedural. |
| MFA TOTP enrollment | Custom QR + secret rotation | **Supabase Auth `mfa.enroll/challenge/verify`** (Phase 24 D-07; reused for clinician) | Standard library, attested by Supabase. |
| Email bounce/complaint handling | Naive "retry forever on failure" | **AWS SES SNS → suppression table** (Pitfall 7) | Required for SES production-access lift; protects sender reputation. |
| Notion mirror of policies | Manual copy-paste from repo | **GitHub Action → Notion API sync on policy file change** (D-06) | Source of truth stays git; mirror auto-updates. Optional automation — manual copy-paste acceptable at v1.3. |

**Key insight:** Phase 25 is overwhelmingly "wire vendor primitives + write a few small CI scripts + ship 2 tables." Nothing should be hand-built. The risk is forgetting an off-the-shelf solution and hand-rolling a worse version — for example, building a custom keyword classifier instead of using a curated JSON, or building an evidence-tracker instead of paying Drata.

## Runtime State Inventory

> Phase 25 is greenfield-additive for the most part — no rename or string-replace work. However, two categories warrant explicit attention:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None at v1.3 entry** — `vendor_baa_chain`, `phi_access_log`, `subprocessor_snapshots`, `ses_suppression_list` are all NEW tables. No prior PHI-access records to backfill. | No data migration. Insert 6 `vendor_baa_chain` rows with `status='pending'` at migration time per D-01 + Claude's-discretion pre-stub note. |
| Live service config | **AWS SES sandbox mode** is the default for new AWS accounts (200/day, 1/sec, verified-recipients-only). Production access requires a support ticket lift per Pitfall 7. | Wave 0 task: submit AWS Support production-access request after AWS Artifact BAA signed. ~24-72hr turnaround. |
| Live service config | **PostHog "Enable session recordings on all sites" project setting** may be ON in the project's current PostHog dashboard. Even with `disable_session_recording: true` at SDK init, the project-side toggle controls server-side acceptance. | Wave 0 task: verify in PostHog dashboard → Project Settings → Replay → "Enable session recording" is OFF, OR per-URL trigger is configured to enable ONLY on non-PHI routes. |
| OS-registered state | **None** — no OS-level state changes. | n/a |
| Secrets / env vars | **5 NEW Supabase Function Secrets to provision:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_REGION`, `AWS_SES_FROM`, `AWS_SES_BAA_ACTIVE` (health-check flag). **2 NEW for Anthropic clinical:** `ANTHROPIC_CLINICAL_API_KEY`, `ANTHROPIC_CONSUMER_API_KEY` (rename existing key if needed). **1 for Resend domain reuse:** existing `RESEND_API_KEY` + `RESEND_FROM` from `[[reference_resend_phase9_wiring]]` are reused unchanged. Plan 25-03 + 25-04 must specify EXACT secret names + a UAT-probe Edge Fn for each (per `[[reference_supabase_edge_function_deploy]]`). | New secrets via `supabase secrets set --env-file` per Function Secrets convention. Health-check stub per `[[reference_vendor_gated_send_health_check]]` reads `AWS_SES_BAA_ACTIVE` env flag. |
| Build artifacts | **None** — no install hooks, no postinstall scripts. | n/a |

## Common Pitfalls

### Pitfall 1: `disable_session_recording_on_url` is not a real posthog-js config option

**What goes wrong:** Engineer reads CONTEXT.md D-16, writes `posthog.init(key, { disable_session_recording_on_url: /^\/(clinic|patient|admin\/users|dose-log|share|auth)/ })`. PostHog silently ignores the unknown option; session recording proceeds normally on PHI routes. HIPAA-17 success criterion #5 fails in audit, possibly weeks after deploy.

**Why it happens:** The option name is plausible (matches the `*_on_url` naming pattern of other PostHog SDK conventions) but does not exist in posthog-js. Verified via PostHog JS config docs + GitHub source search + multiple WebSearches 2026-05-17. The actual surface area is:
- `disable_session_recording: true | false` (global on/off at init)
- `session_recording: { maskAllInputs, maskTextSelector, ... }` (per-recording masking config, not URL-gated)
- PostHog dashboard "URL triggers" (web SDK ≥1.171.0) — only "enable on URL match", no "disable on URL match"
- Programmatic `posthog.startSessionRecording()` / `posthog.stopSessionRecording()`
- DOM class `ph-no-capture` (block element from replay)

**How to avoid:** Use Pattern 4 (route-change React hook calling `stopSessionRecording`) AND ensure PostHog dashboard project setting is "session_recording disabled by default" so any new recording must be opted in. Plan-checker should verify Plan 25-06b ships the hook, not the non-existent config option.

**Warning signs:** PR reviewer searches GitHub for `disable_session_recording_on_url` and finds zero hits in posthog-js source. CI lint on session-recording configuration could grep for the wrong-name use.

### Pitfall 2: Anthropic does not publish a per-model BAA allowlist

**What goes wrong:** Plan 25-04 author assumes `_shared/anthropic-baa-allowlist.ts` should be auto-synced from an Anthropic API endpoint listing "BAA-covered models." There is no such endpoint. Author either skips the allowlist entirely (defeating HIPAA-04 SC #1) or hand-codes guessed model IDs without verification.

**Why it happens:** Anthropic scopes BAAs at the *account-tier* level (HIPAA-ready Enterprise plan + Organization → Data & Privacy → HIPAA Compliance admin toggle accepted by Primary Owner). Per-model BAA tagging is not surfaced. Exclusions are by *product*: Claude Free, Pro, Max, Team, Workbench, Console, Cowork, Claude Code (except CLI with explicit ZDR), Claude for Office. Web search inside the API is excluded from BAA scope.

**How to avoid:** Treat the allowlist as engineering-curated. Initial list: stable production aliases (`claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5`) + their dated snapshots. Maintain a denylist of suffix patterns (`-beta`, `-preview`, `-experimental`). Subprocessor-diff cron (D-12) MUST scrape Anthropic's models doc weekly to alert on new model availability or deprecated IDs. Pair with eslint `no-restricted-imports` against Anthropic beta endpoints if any are imported.

**Warning signs:** Allowlist file has no comment explaining maintenance policy; nobody knows when it was last reviewed.

### Pitfall 3: SES sandbox mode silently caps send volume + blocks unverified recipients

**What goes wrong:** Plan 25-03 ships `_shared/email-router.ts` + AWS SES path; first PHI email to a clinic operator gets stuck in sandbox (recipient not verified; or 200/day cap; or 1/sec rate limit hit). Engineer thinks the route is broken; rolls back.

**Why it happens:** All new AWS accounts default to SES sandbox per AWS account per region. Lifting requires a support ticket explaining bounce-handling + complaint-handling + email-source legitimacy `[CITED: docs.aws.amazon.com/ses/latest/dg/request-production-access.html]`. Turnaround is 24-72hr.

**How to avoid:** Wave 0 task in Plan 25-03: submit SES production-access request immediately after AWS Artifact BAA is signed. Build the health-check stub (`AWS_SES_BAA_ACTIVE` env flag) so deployed code no-ops sends until production access is granted. Document in `vendor_baa_chain.notes` field.

**Warning signs:** First PHI email send fails with "Email address is not verified" or "Sending paused" error.

### Pitfall 4: SES requires SNS-driven bounce/complaint handling for production-access lift

**What goes wrong:** Plan 25-03 ships SES send path but no bounce/complaint webhook. AWS rejects production-access request OR (worse) grants it then suspends after first bounce burst.

**Why it happens:** AWS SES production access requires demonstrated handling of bounces (recipient address invalid) + complaints (recipient marked as spam) per AWS sender-reputation policy. Mechanism is SES → SNS topic → HTTP webhook → suppression list.

**How to avoid:** Plan 25-03 ships THREE artifacts together: (a) `_shared/email-router.ts` send path, (b) `ses-bounce-webhook` Edge Fn that consumes SNS notifications, (c) `ses_suppression_list` table + middleware in send path that refuses to send to suppressed addresses. Pattern is well-documented `[CITED: bluefox.email/posts/how-to-handle-bounces-and-complaints-with-aws-ses-and-sns]`.

**Warning signs:** Plan 25-03 acceptance lacks an end-to-end test that sends, bounces, and verifies suppression-list write.

### Pitfall 5: SECURITY DEFINER `log_phi_access` without `search_path` → schema resolution attack surface

**What goes wrong:** SECURITY DEFINER function runs with the function-owner's privileges (typically `postgres`). Without `set search_path = pg_temp, public, extensions`, an attacker who can create objects in a schema earlier in the resolution chain can hijack the function's references.

**Why it happens:** Per `[[reference_supabase_migration_gotchas]]`. Standard Postgres SECURITY DEFINER pitfall. Phase 24 D-14 documents the same trap for `log_admin_action`.

**How to avoid:** Every SECURITY DEFINER function ships with `set search_path = pg_temp, public, extensions;`. Plan 25-02 acceptance includes a `\df+ log_phi_access` check that grep matches `search_path`.

**Warning signs:** Test "log_phi_access works as authenticated user" passes; no negative test for hijack scenario.

### Pitfall 6: Append-only RLS does NOT auto-block service_role — explicit REVOKE required

**What goes wrong:** Plan 25-02 ships `CREATE POLICY phi_access_log_no_update FOR UPDATE USING (false)`. Tests pass for authenticated users. Service_role can still UPDATE because RLS is bypassed for service_role.

**Why it happens:** Service_role bypasses RLS by design. Append-only must be enforced via GRANT/REVOKE on table-level privileges, NOT via RLS policies alone.

**How to avoid:** Migration must include explicit `REVOKE UPDATE, DELETE ON public.phi_access_log FROM service_role;` per `[[reference_supabase_migration_gotchas]]`. Plan 25-02 acceptance test asserts service_role cannot UPDATE/DELETE.

**Warning signs:** Test suite has positive cases ("authenticated user cannot UPDATE") but no service_role negative case.

### Pitfall 7: vendor-gated send health-check vs hard-fail at startup

**What goes wrong:** Plan 25-03 ships email-router that *throws* when `AWS_SES_BAA_ACTIVE` is unset. First deploy after merge breaks production email sends for all non-PHI templates too (because the module load fails at import time).

**Why it happens:** Naive interpretation of "vendor-gated send" pattern. The correct pattern (per `[[reference_vendor_gated_send_health_check]]`) is module-load succeeds + send-time no-op with logged warning.

**How to avoid:** Pattern 2 example above already does this: the `if (template.phi && !Deno.env.get("AWS_SES_BAA_ACTIVE"))` check inside `sendEmail()` no-ops + logs, never throws. Plan 25-03 acceptance: send 10 non-PHI emails with `AWS_SES_BAA_ACTIVE` unset; all succeed via Resend; send 1 PHI email; it no-ops silently with warning.

**Warning signs:** Module-level top-of-file code reads env vars or instantiates SDK client.

### Pitfall 8: Supabase migration filename strict `<14digits>_name.sql`

**What goes wrong:** Plan 25-01 ships migration named `2026-05-17-vendor_baa_chain.sql` or `20260517_vendor_baa_chain_v2.sql` (letter suffix). Supabase CLI silently skips it; production tables don't exist; runtime errors weeks later.

**Why it happens:** Per `[[reference_supabase_migration_filename_regex]]`. Naming regex is `^\d{14}_[a-z0-9_]+\.sql$` strict; letter suffixes silently skipped.

**How to avoid:** Use `date +%Y%m%d%H%M%S` to generate the 14-digit prefix. After `supabase db push`, grep stderr for `^Skipping`. Plan 25-01..04..08 acceptance: filename matches regex.

**Warning signs:** Migration filename has dashes, letter suffix, or wrong digit count.

### Pitfall 9: Drata onboarding lead time blocks SOC 2 Type I attestation

**What goes wrong:** Plan 25-09 ships `/legal/hipaa/` policy bundle + Drata onboarding stub, expects SOC 2 Type I to ship in Phase 25 close window. Drata onboarding is ~6 weeks; HIPAA-09 marked failed at phase-close audit.

**Why it happens:** Drata's onboarding involves: (a) account setup, (b) integration connections to 300+ source systems (Supabase, Vercel, Sentry, AWS, GitHub, Slack, etc.), (c) controls library mapping, (d) policy library setup, (e) employee training rollout, (f) ~30-day evidence collection period BEFORE auditor walkthrough. Typical 6-week onboarding then 4-6 weeks auditor work = ~3 months total to attestation.

**How to avoid:** Plan 25-09 acceptance scopes Phase 25 deliverable to "Drata account active + 80% integrations connected + policy library at parity with `/legal/hipaa/`" — NOT "SOC 2 Type I attestation report received." Reframe HIPAA-09 as "SOC 2 Type I in-flight; attestation expected Phase 30 close." Document in milestone summary.

**Warning signs:** Plan 25-09 estimate is < 3 weeks; HIPAA-09 marked "shipped" without an attestation PDF.

### Pitfall 10: PostHog `ph-no-capture` class blocks element from autocapture too, not just session recording

**What goes wrong:** Plan 25-06 adds `<div className="ph-no-capture">` around PHI sections. Later, analytics team realizes autocapture click events on those sections (e.g., "user clicked the dose-log download button") are not firing. Conversion-funnel analyses break silently.

**Why it happens:** `ph-no-capture` is broader than session-replay masking — it suppresses ALL PostHog capture from the element subtree. PostHog provides a separate `data-ph-capture-attribute-*` for keeping autocapture metadata even when masking.

**How to avoid:** Distinguish "mask in replay" (use Sentry `data-sentry-mask` + leave PostHog autocapture on) from "exclude from all PostHog" (`ph-no-capture`). For PHI surfaces where we want NO PostHog signal at all (D-04 scrub-only posture), `ph-no-capture` is correct. For non-PHI surfaces where we just want Sentry replay masking, use only `data-sentry-mask`.

**Warning signs:** Funnel analysis drops events that were firing pre-Phase-25.

### Pitfall 11: Stripe PHI lint false-positive on legitimate non-PHI keywords

**What goes wrong:** Stripe-PHI lint blocks PR with "found keyword `injection` in Stripe API call site at `src/components/billing/CheckoutForm.tsx:42`". Actual code is `{ description: "Monthly subscription - includes weekly check-in" }` — the word `injection` does not appear; lint regex matched a substring of a CSS class name `inject-button`.

**Why it happens:** Naive substring grep without word-boundary anchoring catches HTML/CSS class names, prop names, function names that happen to contain keywords.

**How to avoid:** Plan 25-05 ships lint with `\b` word-boundary regex anchors per keyword. Also restrict scan scope to expression *values* passed to Stripe API call sites (`stripe.customers.create({...})`, `stripe.invoices.createLineItem({...})`), not the whole file. AST-based extraction is overkill; use a regex that matches `\.(create|update|createLineItem|finalizeInvoice)\(\s*\{[^}]*\}\s*\)` then scans only matched object literals.

**Warning signs:** First CI run after Plan 25-05 lands has > 5 false positives.

## Code Examples

(See Patterns 1–4 above for sql, email-router, BAA-scope guard, session-replay hook.)

### Example 5: Stripe PHI lint (Plan 25-05)

```typescript
// Source: synthesized from D-09 spec + Pitfall 11
// scripts/lint-stripe-phi.ts (run via npm script in CI)
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';

const KEYWORDS: string[] = JSON.parse(readFileSync('scripts/stripe-phi-keywords.json', 'utf8'));
const STRIPE_CALL_RE = /stripe\.(customers|invoices|invoiceItems|subscriptions|paymentIntents|charges|products|prices)\.(create|update|createLineItem)\s*\(\s*\{([^{}]|\{[^{}]*\})*\}\s*\)/g;
const ALLOW_COMMENT_RE = /\/\/\s*stripe-phi-lint:allow\b/;

async function main() {
  const files = await fg(['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts']);
  let failures = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = STRIPE_CALL_RE.exec(src))) {
      const block = match[0];
      // Walk back to the call's line for allowlist comment check
      const lineStart = src.lastIndexOf('\n', match.index) + 1;
      const lineEnd = src.indexOf('\n', match.index + block.length);
      const lineText = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (ALLOW_COMMENT_RE.test(lineText)) continue;
      for (const kw of KEYWORDS) {
        const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(block)) {
          const lineNum = src.slice(0, match.index).split('\n').length;
          console.error(`[stripe-phi-lint] ${file}:${lineNum}: keyword "${kw}" found in Stripe call site`);
          console.error(`  fix: rewrite the value OR add comment "// stripe-phi-lint:allow reason='...'" on the same line`);
          failures++;
          break;
        }
      }
    }
  }
  if (failures) {
    console.error(`\n[stripe-phi-lint] ${failures} violation(s). Stripe will NEVER sign a BAA — PHI must not enter Stripe calls.`);
    process.exit(1);
  }
  console.log('[stripe-phi-lint] OK — no PHI keywords in Stripe call sites.');
}

void main();
```

### Example 6: Sentry mask CI audit (Plan 25-06a)

```typescript
// Source: synthesized from D-15 spec
// scripts/audit-sentry-mask.ts
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';

const PHI_PROPS: string[] = JSON.parse(readFileSync('scripts/sentry-mask-required-props.json', 'utf8'));
// e.g. ["patient.name", "patient.email", "profiles.email", "dose.value", "weight.value", "photo.url", "user.name", "user.email"]

async function main() {
  const files = await fg(['src/**/*.tsx']);
  let failures = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const prop of PHI_PROPS) {
      // Find JSX containers that bind the PHI prop
      const re = new RegExp(`\\{[^}]*\\b${prop.replace('.', '\\.')}\\b[^}]*\\}`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Walk up the source to find enclosing JSX element opening tag
        const before = src.slice(Math.max(0, m.index - 500), m.index);
        const enclosingTag = before.match(/<([A-Za-z][\w]*)[^>]*$/);
        if (!enclosingTag) continue;
        const tagOpenStart = before.lastIndexOf(`<${enclosingTag[1]}`);
        const tagOpenSlice = src.slice(Math.max(0, m.index - 500) + tagOpenStart, m.index);
        if (!/data-sentry-mask\s*(=|$|\s|>)/.test(tagOpenSlice) && !/sentry-mask/.test(tagOpenSlice)) {
          const lineNum = src.slice(0, m.index).split('\n').length;
          console.error(`[sentry-mask-audit] ${file}:${lineNum}: PHI prop "${prop}" rendered inside element lacking data-sentry-mask`);
          failures++;
        }
      }
    }
  }
  if (failures) {
    console.error(`\n[sentry-mask-audit] ${failures} unmaskd PHI element(s). Add data-sentry-mask attribute.`);
    process.exit(1);
  }
  console.log('[sentry-mask-audit] OK — every PHI prop is inside data-sentry-mask container.');
}

void main();
```

### Example 7: pg_cron schedule for BAA-expiry + subprocessor-diff (Plan 25-08)

```sql
-- Source: D-12 + existing v1.2 pg_cron schedules in supabase
-- Migration: 2026MMDDHHmmss_baa_alert_cron.sql

-- Nightly BAA-expiry check (02:30 UTC, off-peak; adjust if collides with Phase 24 audit-archive cron at 03:00 UTC per D-16)
select cron.schedule(
  'baa-expiry-check-nightly',
  '30 2 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/baa-expiry-check',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_jwt_secret'))
    ) as request_id;
  $$
);

-- Weekly subprocessor-diff (Sunday 04:30 UTC, off-peak)
select cron.schedule(
  'subprocessor-diff-weekly',
  '30 4 * * 0',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/subprocessor-diff',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_jwt_secret'))
    ) as request_id;
  $$
);
```

**Coordination note:** Phase 24 D-16 schedules audit-archive cron. Plan 25-08 MUST run `supabase db query --linked "select * from cron.job;"` per `[[reference_supabase_db_query_linked]]` to verify no schedule collision (recommend 02:30 UTC + 04:30 UTC slots for Phase 25 to avoid Phase 24's likely 03:00 UTC slot).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HIPAA via single-vendor "HIPAA-compliant" platform (Aptible, Datica) | Multi-vendor BAA chain across composable best-of-breed (Supabase + Vercel + Sentry + Anthropic + AWS SES + PostHog) | 2022-2024 — every SaaS vendor now offers BAA on enterprise tiers | LeanShot pays per-vendor (+$1,864-4,364/mo) but avoids platform lock-in + retains modern stack |
| Vercel Enterprise required for BAA | Vercel Pro + HIPAA add-on (self-serve since 2025) | 2025 | $350/mo add-on vs $45K/yr enterprise |
| Resend BAA available | **NOT publicly documented as of 2026-05-17** — AWS SES is the BAA fallback path | n/a | D-03 adopts SES for PHI; Resend stays for non-PHI |
| Anthropic BAA via API tier directly | HIPAA-ready Enterprise plan (sales-assisted) + Org Settings → Data & Privacy → HIPAA Compliance toggle (one-way) | 2025 → 2026 | D-13 dual-credential pattern needed because consumer Anthropic key may NOT have BAA |
| Drata / Vanta as "nice to have" for SOC 2 | Drata / Vanta as **table-stakes** for any B2B SaaS selling to compliance-bound buyers | 2023+ | D-05 picks Drata; SOC 2 Type I is a CHECK-BOX during clinic procurement |
| `posthog-js` legacy `disable_session_recording_on_url` | Programmatic `stopSessionRecording()` driven by route, OR dashboard URL triggers (web SDK ≥1.171.0, enable-only) | The legacy option **never existed** — CONTEXT.md D-16 mis-named it | Pitfall 1 above |
| Stripe BAA negotiable | Stripe **NEVER** signs BAA; "banking exemption" enforced by NOT putting PHI in Stripe | Stripe corporate policy stable | D-02 + CI lint |

**Deprecated / outdated:**
- pgsodium — per `[[reference_phase7_research_findings]]`, deprecated in favor of Vault for secrets. Not directly relevant to Phase 25 but flagged if any plan needs encrypted columns (it shouldn't — PHI columns are RLS-protected, not column-encrypted).
- Self-hosting PostHog for HIPAA — PostHog explicitly does NOT sign BAA for self-hosted; saves nothing, costs ops.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Anthropic SDK `^0.40.0+` is current major as of research date | Standard Stack | LOW — actual version number verifiable at plan time via `npm view`. If a later major changes message-API shape, Plan 25-04 needs to follow new pattern. |
| A2 | Vercel AI Gateway is in Vercel BAA scope | Architecture (Anthropic dual-credential) | MEDIUM — should be confirmed during Vercel BAA call. If NOT covered, clinical Anthropic must call Anthropic directly (bypassing Gateway) for HIPAA compliance. |
| A3 | Stripe PHI lint scan scope = `src/**/*.{ts,tsx}` + `supabase/functions/**/*.ts` | Example 5 | LOW — false-negatives if Stripe calls move to a new path. Document scope in Plan 25-05. |
| A4 | The 23-keyword initial list in D-09 is sufficient for v1.3 GLP-1 vertical | Decisions / D-09 | MEDIUM — new medications shipping in v1.3+ require keyword additions. Plan 25-05 acceptance: "PR check process documented in CLAUDE.md `## Project Constraints` section to add new keywords whenever `medications` table grows." |
| A5 | Drata 6-week onboarding lead time | Pitfall 9 | MEDIUM — actual time depends on integration depth + employee count + auditor scheduling. SOC 2 Type I attestation realistically Phase 30 close, not Phase 25 close. |
| A6 | The 6 vendor BAA calls all reach signature by Phase 25 close | D-01 | HIGH — Anthropic Enterprise sales lead time alone can be 6-8 weeks. Mitigated by health-check-stub pattern (`[[reference_vendor_gated_send_health_check]]`) so code ships safely behind a flag. |
| A7 | Pre-stubbed `vendor_baa_chain` rows with `status='pending'` is acceptable to compliance reviewers | Claude's Discretion / D-01 | LOW — the table is internal tracking, not customer-facing. Status enum makes pre-stubbing explicit. |
| A8 | `phi_access_log.accessed_org_id` forward-compat column is OK to ship in P25 even though P28 is when org_id propagates | Pattern 1 SQL | LOW — column nullable + unindexed costs nothing; saves a P28 schema migration. |
| A9 | Phase 24 ships `_shared/posthog-server.ts` + `audit_logs` BEFORE Phase 25 needs them | STATE.md outline note | HIGH — if Phase 24 hasn't shipped, Plan 25-04 + 25-08 must include their own minimal helpers OR Phase 25 blocks on Phase 24 merge. Recommended: Plan 25-10 = explicit Phase-24 coordination verifier (already in STATE outline) that fails if `_shared/posthog-server.ts` or `audit_logs` table is missing. |
| A10 | Cron schedule slots 02:30 UTC + 04:30 UTC don't collide with Phase 24 schedules | Example 7 | LOW — verifiable via `supabase db query --linked "select jobname, schedule from cron.job;"` at plan time. |
| A11 | PostHog dashboard "Enable session recordings" project setting can be turned OFF without affecting other v1.3 measurement work | Pitfall 1 + Runtime State Inventory | LOW — session recording and event capture are independent toggles in PostHog. Verify in dashboard. |
| A12 | Supabase Function Secrets is the right home for `ANTHROPIC_CLINICAL_API_KEY` (not Vercel env) | Claude's Discretion | LOW — Function Secrets are scoped to Edge Functions; Vercel env is scoped to Vercel runtime. Anthropic clinical key is only used in Edge Functions. Supabase Function Secrets is correct. |
| A13 | v1.2 `ai-chat` proxies Moonshot, not Anthropic | Code Context §1 + Pitfall 1 paragraph 2 | LOW — verified by reading `src/lib/ai.ts:5-7`. Phase 4 D-01..D-05 confirms. Surfaces an undocumented assumption in CONTEXT.md D-13 wording. |
| A14 | Anthropic does NOT publish a per-model BAA allowlist API or doc page | Pitfall 2 | MEDIUM — confirmed via search of Anthropic Help Center + Privacy docs 2026-05-17; the BAA is account-tier-scoped. If Anthropic publishes a per-model manifest later, Plan 25-04's allowlist could auto-sync, but until then it's engineering-managed. |

## Open Questions

1. **Should v1.2 `ai-chat` (Moonshot Kimi K2) consumer path migrate to Anthropic consumer key, or stay on Moonshot?**
   - What we know: D-13 specifies dual Anthropic credentials. v1.2 code uses Moonshot.
   - What's unclear: Whether Phase 25 also retires Moonshot for consumer path (cost change; behavior change — Moonshot is a different model family) or runs a 3-way branch (Moonshot consumer ⊕ Anthropic consumer ⊕ Anthropic clinical).
   - Recommendation: Plan 25-04 entry condition includes a 1-line CONTEXT amendment from the user. Recommend keeping Moonshot consumer + adding Anthropic clinical only (lowest risk, lowest cost change). The "consumer Anthropic credential" mentioned in D-13 can be the existing Moonshot wiring — the dual-credential pattern still holds, just with two different vendors instead of two Anthropic keys.

2. **Which Sentry mask-required-props belong on the initial JSON?**
   - What we know: D-15 specifies the lint exists.
   - What's unclear: The exact prop name list. CONTEXT.md examples include `patient.name`, `profiles.email`, dose-value props, photo URLs.
   - Recommendation: Plan 25-06a includes an initial JSON: `["patient.name", "patient.email", "patient.first_name", "patient.last_name", "profiles.email", "profiles.full_name", "user.email", "user.name", "injection.dose", "weight.value", "weight_kg", "weight_lb", "weights.value", "photo.url", "photo.data_url", "photos.url", "share.token", "doctor.email", "clinic_patient.email"]` and accepts PR additions as new PHI surfaces appear.

3. **Does the v1.2 Vercel Routing Middleware exist to extend?**
   - What we know: D-10 spec says "Vercel Routing Middleware extension of Phase 24 admin aal2."
   - What's unclear: Whether Phase 24 actually adds this middleware or whether v1.3 has not shipped any middleware at all (v1.2 was a static SPA).
   - Recommendation: Plan 25-07 reads Phase 24 24-04-PLAN.md (TAXO-02 / middleware) to confirm shape; if Phase 24 hasn't shipped middleware, Plan 25-07 ships the FIRST middleware (`/middleware.ts` at project root) covering both `/admin/*` AND `/clinic/*` aal2 step-up + has_totp redirect.

4. **PostHog dashboard URL trigger config — UI-only or per-init?**
   - What we know: Pitfall 1 confirms URL triggers exist (web SDK ≥1.171.0) but only as ENABLE-on-match.
   - What's unclear: Whether the planner should configure dashboard URL triggers AT ALL, or rely entirely on programmatic stopSessionRecording.
   - Recommendation: BOTH — disable session_recording at PostHog project-settings level (so default = no recording), then opt-in per-route via dashboard URL triggers for the small set of non-PHI routes where we DO want recording (e.g., `/onboarding/*`, `/dashboard` non-PHI tabs). Belt-and-suspenders. Document in Plan 25-06b.

5. **Drata API vs portal-only — how much can be auto-evidenced?**
   - What we know: Drata advertises 80% auto-evidence + 300+ integrations.
   - What's unclear: For LeanShot's stack (Supabase, Vercel, Sentry, AWS, GitHub, Stripe, Resend, PostHog), which controls auto-evidence vs require manual portal upload.
   - Recommendation: Plan 25-09 sub-task = book Drata onboarding call; document in `legal/hipaa/baa-management.md` which controls are auto-evidenced. Out of Phase 25 acceptance scope to enumerate every control.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | CI lint scripts + dev | ✓ | v22.18.0 | — |
| `gh` (GitHub CLI) | CI workflow PRs | ✓ | (system) | — |
| Supabase CLI | Migrations + Function deploy + secrets | ✗ on local probe | — | Install via `brew install supabase/tap/supabase` at plan time; required for Plans 25-01..04, 25-08 |
| Deno | Edge Function local dev | ✗ on local probe | — | Optional locally; Supabase Edge Runtime supplies Deno in prod. `supabase functions serve` bundles Deno. |
| AWS CLI | Provisioning SES + Artifact BAA acceptance | ✗ on local probe | — | Founder can use AWS Web Console for one-time setup; CLI not strictly required. Install if needed: `brew install awscli`. |
| `@anthropic-ai/sdk` | Plan 25-04 (Edge Fn) | ✗ (not yet pinned) | — | Pin at plan time: `npm view @anthropic-ai/sdk version`. |
| `@aws-sdk/client-sesv2` | Plan 25-03 (Edge Fn) | ✗ (not yet pinned) | — | Pin at plan time. |
| `fast-glob` + `chalk` | Plans 25-05 + 25-06a (CI scripts) | ✗ (not in package.json) | — | `npm install -D fast-glob chalk` at plan time. Already common in v1.2 dev-deps space. |
| Phase 24 `_shared/posthog-server.ts` | Plan 25-04 (BAA-guard refusal audit-log to PostHog) | DEPENDENCY — not yet shipped | n/a | Plan 25-10 verifier blocks if missing OR Plan 25-04 ships minimal local fallback. |
| Phase 24 `audit_logs` table | Plan 25-02 + 25-04 (audit writes) | DEPENDENCY — not yet shipped | n/a | Same — Plan 25-10 verifier blocks. |
| Phase 24 admin shell manifest (`ADMIN_MODULES`) | Plan 25-08 (`/admin/compliance` module entry) | DEPENDENCY — not yet shipped | n/a | Plan 25-10 verifier blocks; Plan 25-08 deferred to Wave 2. |

**Missing dependencies with no fallback:**
- Phase 24 must ship `_shared/posthog-server.ts`, `audit_logs`, and `ADMIN_MODULES` before Phase 25 Wave 2 ships. Coordination via Plan 25-10 already in STATE.md outline.

**Missing dependencies with fallback:**
- All vendor/SDK installs are routine; install at plan time.

## Validation Architecture

> nyquist_validation is `true` in `.planning/config.json`. This section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x (per v1.2; verify exact version at plan time via `npm view vitest version`) + Playwright (e2e per v1.2 `e2e/` folder; check `playwright.config.ts`) |
| Config file | `vitest.config.ts` (v1.2 — verify exists; CLAUDE.md notes "None configured" historically but v1.2 added vitest per project memory) |
| Quick run command | `npm test -- <pattern>` (vitest) ; `npx playwright test e2e/hipaa --project=phase-25` (e2e) |
| Full suite command | `npm test` && `npx playwright test e2e/hipaa` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HIPAA-01 | Supabase Team+HIPAA active | vendor (human-verified) | n/a — verify in Supabase dashboard | manual |
| HIPAA-02 | Vercel Pro+HIPAA active | vendor (human-verified) | n/a — verify in Vercel dashboard | manual |
| HIPAA-03 | Sentry Business + PHI scrubbing | vendor + smoke | inspect sentry init config | manual + ❌ Wave 0 (smoke at `src/lib/sentry.test.ts`) |
| HIPAA-04 | Anthropic BAA + runtime model-allowlist guard refuses 403 | Edge Fn integration test | `npx supabase functions test ai-chat-clinical --filter baa-guard` | ❌ Wave 0 (Plan 25-04) |
| HIPAA-05 | email-router PHI→SES, non-PHI→Resend | Edge Fn integration test (mock both clients) | `npx supabase functions test email-router` | ❌ Wave 0 (Plan 25-03) |
| HIPAA-06 | PostHog session-replay scrub on PHI routes | e2e | `npx playwright test e2e/hipaa/session-replay-phi-guard.spec.ts` | ❌ Wave 0 (Plan 25-06b) |
| HIPAA-07 | ai-chat branches on org_id | Edge Fn integration test | `npx supabase functions test ai-chat-clinical --filter org-branch` | ❌ Wave 0 (Plan 25-04) |
| HIPAA-08 | Stripe PHI CI lint blocks bad commits | CI workflow | `node scripts/lint-stripe-phi.ts` (expect exit 1 on fixture file with PHI keyword) | ❌ Wave 0 (Plan 25-05 — add `scripts/__fixtures__/stripe-phi-violation.ts`) |
| HIPAA-09 | SOC 2 Type I in-flight | vendor (Drata portal) | n/a — manual | manual |
| HIPAA-10 | Training + access review via Drata | vendor (Drata portal) | n/a — manual | manual |
| HIPAA-11 | 7 policies exist in `/legal/hipaa/` | unit (file existence) | `test -f legal/hipaa/access-control.md && ...` | ❌ Wave 0 (Plan 25-09; can be a shell test) |
| HIPAA-12 | `vendor_baa_chain` rows + subprocessor-diff cron | DB integration test | RLS test pattern per `[[reference_rls_fixture_gotruechient_flake]]` | ❌ Wave 0 (Plan 25-01 + 25-08) |
| HIPAA-13 | BAA expiry banner + email + audit | Edge Fn integration test + UI snapshot | `npx supabase functions test baa-expiry-check && npm test -- ExpiryBanner` | ❌ Wave 0 (Plan 25-08) |
| HIPAA-14 | phi_access_log append-only + log_phi_access RPC | DB integration test (cross-tenant + service_role) | RLS test + service_role deny test | ❌ Wave 0 (Plan 25-02) |
| HIPAA-15 | Clinician MFA hard-cut at `/clinic/*` | e2e | `npx playwright test e2e/hipaa/clinician-mfa-hard-cut.spec.ts` | ❌ Wave 0 (Plan 25-07) |
| HIPAA-16 | Sentry mask CI audit blocks | CI workflow | `node scripts/audit-sentry-mask.ts` (expect exit 1 on fixture) | ❌ Wave 0 (Plan 25-06a — add `src/components/__fixtures__/unmasked-phi.tsx`) |
| HIPAA-17 | PostHog session-recording disabled on PHI routes | e2e | `npx playwright test e2e/hipaa/session-replay-phi-guard.spec.ts` | ❌ Wave 0 (Plan 25-06b — same file as HIPAA-06) |
| HIPAA-18 | Risk assessment + breach SLA docs exist | unit (file existence + content check) | `grep -q "60 days" legal/hipaa/incident-response.md` | ❌ Wave 0 (Plan 25-09) |

### Sampling Rate

- **Per task commit:** `npm test -- --run` (vitest fast subset, < 30s)
- **Per wave merge:** Full `npm test && npx playwright test e2e/hipaa` (under 5min)
- **Phase gate:** Full suite green + CI lints (`npm run lint && node scripts/lint-stripe-phi.ts && node scripts/audit-sentry-mask.ts`) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `e2e/hipaa/session-replay-phi-guard.spec.ts` — covers HIPAA-06 + HIPAA-17
- [ ] `e2e/hipaa/clinician-mfa-hard-cut.spec.ts` — covers HIPAA-15
- [ ] `supabase/functions/email-router/index.test.ts` (deno test) — covers HIPAA-05
- [ ] `supabase/functions/ai-chat-clinical/index.test.ts` (deno test) — covers HIPAA-04 + HIPAA-07
- [ ] `supabase/functions/baa-expiry-check/index.test.ts` — covers HIPAA-13
- [ ] `supabase/functions/subprocessor-diff/index.test.ts` — covers HIPAA-12 cron path
- [ ] DB RLS tests `supabase/tests/phi_access_log.test.ts` + `vendor_baa_chain.test.ts` — covers HIPAA-12, HIPAA-14
- [ ] CI fixture files (`scripts/__fixtures__/stripe-phi-violation.ts`, `src/components/__fixtures__/unmasked-phi.tsx`) so CI lints have known-bad inputs to detect
- [ ] Shared fixture: `e2e/hipaa/_fixtures/clinician-user.ts` (Playwright addInitScript per `[[reference_playwright_state_seeding]]`) + Supabase auth fixture per `[[reference_rls_fixture_gotruechient_flake]]` (admin.generateLink + plain fetch)
- [ ] vitest config (if `vitest.config.ts` doesn't exist on main) — install + base config

## Security Domain

> `security_enforcement` is not explicitly false in config → enabled. This section required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (existing); TOTP enrollment via `supabase.auth.mfa.enroll` (Phase 24 carry-forward) |
| V3 Session Management | yes | Supabase Auth aal2 step-up for `/admin/*` (Phase 24) + `/clinic/*` (Plan 25-07) |
| V4 Access Control | yes | RLS on `phi_access_log` (append-only) + `vendor_baa_chain` (admin-only) + SECURITY DEFINER RPC per `[[reference_supabase_migration_gotchas]]`; explicit `REVOKE update, delete from service_role` per Pitfall 6 |
| V5 Input Validation | yes | Edge Fn request bodies typed via TS interfaces; AWS SES + Anthropic SDK calls take typed objects, not raw strings. Stripe PHI lint is a meta-input-validation (preventing PHI from entering Stripe). |
| V6 Cryptography | yes | TOTP secret storage via Supabase Auth (vendor-managed); no hand-rolled crypto. Anthropic ZDR header `anthropic-zdr: true` for clinical credential (vendor-managed). AWS SES TLS-required option enabled (`EnforceTLS=Require` per AWS docs). HMAC tokens (e.g., for any future reply-to-ticket flow) handled by Phase 37; not in P25 scope. |
| V7 Error Handling + Logging | yes | `audit_logs` (Phase 24) + `phi_access_log` (Plan 25-02) provide structured logs for HIPAA review. Sentry mask audit (Plan 25-06a) ensures PHI is not in error reports. |
| V8 Data Protection | yes | PHI URL regex covers all PHI-rendering routes (Plan 25-06b); Sentry mask attribute discipline (Plan 25-06a); PostHog ph-no-capture or stopSessionRecording (Plan 25-06b); Stripe PHI keyword lint (Plan 25-05); email-router PHI split (Plan 25-03). |
| V9 Communications | yes | TLS-required on SES; HTTPS for all Edge Fn HTTP webhooks (Supabase Edge Runtime enforces) |
| V10 Malicious Code | yes | CI lints + ESLint (existing); no new attack-surface code |
| V11 Business Logic | yes | BAA-scope guard refuses non-allowlisted models (mechanical control, not procedural) |
| V12 File and Resources | n/a | No file upload in Phase 25 |
| V13 API + Web Services | yes | Edge Fn auth via Authorization header + Supabase JWT verify; cron jobs use `app.cron_jwt_secret` |
| V14 Configuration | yes | Function Secrets via `supabase secrets set`; never committed; UAT-probe pattern per `[[reference_supabase_edge_function_deploy]]` |

### Known Threat Patterns for {React 19 + Vite + TS + Supabase + AWS + Anthropic + Resend + Sentry + PostHog stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PHI leaked to Stripe metadata/description | Information Disclosure | Stripe PHI CI lint (D-09, Plan 25-05) |
| Session replay captures dose values in form inputs | Information Disclosure | Sentry data-sentry-mask audit (D-15, Plan 25-06a) + PostHog session_recording off on PHI routes (D-16, Plan 25-06b) |
| Service_role bypass of `phi_access_log` append-only RLS | Tampering | Explicit REVOKE update, delete from service_role (Pitfall 6) |
| SECURITY DEFINER `log_phi_access` schema hijack | Elevation of Privilege | `set search_path = pg_temp, public, extensions` (Pitfall 5) |
| Anthropic beta-endpoint or non-BAA model used in clinical context | Information Disclosure (PHI leak) | Runtime BAA-scope guard (D-14, Plan 25-04); 403 + audit log on refusal |
| PHI email sent via Resend (no BAA) | Information Disclosure | email-router split on template.phi (D-03, Plan 25-03) |
| BAA expiry missed silently → compliance lapse | Repudiation + Compliance | Nightly cron + admin banner + email to founder (D-12, Plan 25-08) |
| Vendor subprocessor change unnoticed → clinic BAA breach | Repudiation + Compliance | Weekly subprocessor-diff cron + alert (D-12, Plan 25-08) |
| Clinician account compromise (no MFA) | Spoofing | Hard-cut TOTP at `/clinic/*` (D-10, Plan 25-07) |
| Patient account compromise on sensitive actions | Spoofing | Email-OTP step-up regardless of TOTP enrollment (D-11, Plan 25-07) |
| Cross-tenant patient data leak via `phi_access_log` SELECT | Information Disclosure | RLS `WHERE accessed_user_id = auth.uid()` + cross-user impersonation proof test per project rule `[[reference_supabase_project]]` |
| SES bounce burst → AWS sender-reputation kill | Denial of Service | SNS-driven bounce/complaint webhook + suppression list (Pitfall 4) |

## Sources

### Primary (HIGH confidence)
- Project memory `[[reference_hipaa_baa_vendor_matrix]]` — verified vendor BAA + pricing across 6 vendors, 13 engineering controls + 5 non-code controls + lead times, last reviewed 2026-05-17
- Project memory `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER search_path; RLS deny patterns; service_role REVOKE requirement
- Project memory `[[reference_supabase_migration_filename_regex]]` — `<14digits>_name.sql` strict
- Project memory `[[reference_vendor_gated_send_health_check]]` — vendor-pending code pattern
- Project memory `[[reference_resend_phase9_wiring]]` — Resend BAA gap → AWS SES fallback
- Project memory `[[reference_rls_fixture_gotruechient_flake]]` — RLS test pattern (admin.generateLink + plain fetch)
- Project memory `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant verification
- Project memory `[[reference_supabase_db_query_linked]]` — live read-only checks for cron presence
- Project memory `[[reference_supabase_edge_function_deploy]]` — UAT-probe pattern for Function Secrets
- v1.3 research `.planning/research/STACK.md` — net-new stack delta + HIPAA vendor matrix table
- v1.3 research `.planning/research/PITFALLS.md` V13-1 — HIPAA BAA chain breakage runtime allowlist + subprocessor diff + BAA expiry calendar mitigation triad
- v1.3 research `.planning/research/ARCHITECTURE.md` — phi_access_log + subprocessors + dual-credential Anthropic + email-router patterns
- Phase 24 24-CONTEXT.md + 24-RESEARCH.md — load-bearing prerequisites (audit_logs, admin_role enum, _shared/posthog-server.ts, modular admin shell manifest)
- [Sentry React Session Replay Privacy](https://docs.sentry.io/platforms/javascript/guides/react/session-replay/privacy/) — `data-sentry-mask` attribute spec + `sentry-mask` class + `sentry-block` + `sentry-ignore`
- [PostHog Privacy Controls](https://posthog.com/docs/session-replay/privacy) — `ph-no-capture` class is canonical block attribute; `maskAllInputs` + `maskTextSelector` config
- [PostHog JS Config](https://posthog.com/docs/libraries/js/config) — definitive: `disable_session_recording_on_url` does NOT exist; only `disable_session_recording: bool` + `session_recording: {...}`
- [PostHog Session Recording Control](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record) — URL triggers exist but only ENABLE-on-match (web SDK ≥1.171.0)
- [AWS SES Production Access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) — sandbox vs production lift requirements
- [AWS SES SNS Notification Contents](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html) — bounce/complaint JSON shape
- [Supabase Edge Function Dependencies](https://supabase.com/docs/guides/functions/dependencies) — `npm:` specifier convention + per-function deno.json
- [Vercel HIPAA BAAs for Pro](https://vercel.com/changelog/hipaa-baas-are-now-available-to-pro-teams) — self-serve since 2025
- [Anthropic HIPAA-ready Enterprise plans](https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans) — admin toggle at Organization → Data and Privacy → HIPAA Compliance; Cowork + Claude Code (CLI exception) excluded
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — current stable IDs `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`

### Secondary (MEDIUM confidence)
- [BlueFox: SES bounces and complaints with SNS](https://bluefox.email/posts/how-to-handle-bounces-and-complaints-with-aws-ses-and-sns) — practical webhook + Lambda pattern (translate Lambda → Supabase Edge Fn)
- [G2: Drata Reviews 2026](https://www.g2.com/products/drata/reviews) — 300+ integrations, 80% evidence auto-collection
- [TruvoCyber: Drata vs Vanta for SOC 2](https://truvocyber.com/blog/soc-2-audit-guide-drata-vanta) — Drata cleaner multi-framework
- [Supabase HIPAA Compliance docs](https://supabase.com/docs/guides/security/hipaa-compliance) — Team plan + HIPAA add-on requirement
- [Stripe HIPAA discussion (Patient Protect)](https://patient-protect.com/post/is-stripe-hipaa-compliant) — banking exemption mechanism
- [Sentry BAA](https://sentry.io/legal/baa/) — Business plan unlock; signed BAA process

### Tertiary (LOW confidence — verify at plan-phase)
- Exact Anthropic SDK current version (verify via `npm view @anthropic-ai/sdk version` at plan time)
- Whether Vercel AI Gateway is in Vercel BAA scope (Assumption A2 — confirm during vendor BAA call)
- Whether Drata API exposes evidence-sync endpoints for the specific integrations LeanShot needs (Plan 25-09 owns this exploration)

## Metadata

**Confidence breakdown:**
- Vendor BAA matrix + pricing: HIGH — verified 2026-05-17 in `[[reference_hipaa_baa_vendor_matrix]]` + cross-checked vendor docs in STACK.md
- Engineering patterns (RLS, SECURITY DEFINER, Edge Fn shape, CI lint): HIGH — direct extensions of v1.1/v1.2 shipped patterns + Phase 24 carry-forward
- PostHog session-replay correction (Pitfall 1): HIGH — verified via PostHog config docs + GitHub source search + 3 different WebSearch query angles, all returned the same: no `disable_session_recording_on_url` exists
- Anthropic per-model BAA allowlist (Pitfall 2): MEDIUM — verified Anthropic does not publish per-model tagging; engineering must self-curate. Confidence medium because the BAA scope at the *product* level (Workbench, Cowork, Code) is well-documented, but a future Anthropic API endpoint listing BAA-covered models could supersede.
- v1.2 `ai-chat` Moonshot vs Anthropic (Pitfall in §Summary): HIGH — verified by reading `src/lib/ai.ts:1-23` + Phase 4 D-01..D-05 docs.
- Drata onboarding 6-week lead time: MEDIUM — sourced from G2 reviews; actual time depends on company size + integration depth.
- SES sandbox-mode lift requirement: HIGH — directly from AWS docs.

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (vendor pricing/process is current-month; PostHog SDK behavior is stable; Anthropic model list rolls forward — re-check before any plan that adds new clinical model IDs)
