---
phase: 25
slug: hipaa-audit-hardening-vendor-baa-chain
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Planner fills the Per-Task Verification Map after PLAN.md files exist; this scaffold captures the framework + sampling + Wave-0 expectations the planner must respect.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + RLS integration) + Playwright 1.x (e2e) + deno test (Edge Functions) |
| **Config file** | `vitest.config.ts` (default), `vitest-e2e.config.ts` (Playwright), `playwright.config.ts`, `supabase/functions/*/deno.json` |
| **Quick run command** | `npm run test -- --run --bail src/lib/email-router src/lib/anthropic-baa-allowlist scripts/lint-stripe-phi` |
| **Full suite command** | `npm run test && npm run lint && npm run typecheck && deno test supabase/functions/_shared` |
| **Estimated runtime** | ~120s quick · ~600s full |

Notes
- v1.3 carry-forward: RLS integration tests use the [[reference_rls_fixture_gotruechient_flake]] fix — `admin.generateLink` + `/auth/v1/verify` via plain fetch (NOT `signInWithPassword`).
- Per-file slug prefix in RLS suites per [[feedback_rls_per_file_slug_prefix]].
- Deno tests use `<name>.test.ts` filename per [[reference_deno_test_discovery]].
- Worktree CLI state per [[reference_supabase_worktree_temp_state]].

---

## Sampling Rate

- **After every task commit:** Run quick command (file-scoped, bail on first fail).
- **After every plan wave:** Run full command (unit + lint + typecheck + deno).
- **Before `/gsd:verify-work`:** Full suite + `supabase db query --linked` cron presence checks + manual vendor BAA proof rows.
- **Max feedback latency:** ~120 seconds per task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-NN-NN | NN | W | HIPAA-XX | T-25-XX | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Planner instruction:** populate this table once PLAN files exist. Every plan's tasks must have at least one row (either automated `<automated>` block OR ❌ W0 marker pointing to a Wave-0 stub). Per Nyquist Dimension 8 rule: no 3 consecutive tasks without automated verify.

---

## Wave 0 Requirements

- [ ] `supabase/functions/_shared/anthropic-baa-allowlist.test.ts` — Deno tests for runtime BAA-scope guard (refuses non-allowlisted Anthropic model IDs) — HIPAA-04 Success Criterion #1
- [ ] `supabase/functions/_shared/email-router.test.ts` — Deno tests for SES/Resend split on template `phi:boolean` — HIPAA-05 Success Criterion #4
- [ ] `scripts/lint-stripe-phi.test.ts` — vitest tests for static keyword list + inline allowlist comments — HIPAA-08 Success Criterion #2
- [ ] `scripts/audit-sentry-mask.test.ts` — vitest tests for required `data-sentry-mask` attribute lint — HIPAA-16 Success Criterion #5
- [ ] `src/lib/posthog-route-disable.test.ts` — vitest test for route-change session-replay disable hook (per RESEARCH correction to D-16; NOT `disable_session_recording_on_url` which does not exist) — HIPAA-17 Success Criterion #5
- [ ] `tests/integration/phi-access-log.test.ts` — RLS append-only + sensitive-surface RPC writes test — HIPAA-14
- [ ] `tests/integration/vendor-baa-chain.test.ts` — RLS deny + cron emit on expiry/subprocessor-diff — HIPAA-12, HIPAA-13
- [ ] `tests/integration/clinician-mfa-hard-cut.test.ts` — Playwright: first /clinic/* post-deploy redirects to /clinic/setup-2fa — HIPAA-15
- [ ] `tests/integration/audit-log-archive.test.ts` — cross-tier query (live + Parquet) — HIPAA-14 + Phase 24 D-16 carry
- [ ] `tests/uat/baa-vendor-rows.sql` — `supabase db query --linked` snapshot proving 6 vendor rows present — HIPAA-01..06

*Wave 0 installs these stubs as part of Plan 25-NN-NN (TBD by planner — recommend Plan 25-01 owns the migrations + table stubs; Plan 25-03 owns email-router stubs; Plan 25-04 owns Anthropic stubs; Plan 25-05 owns Stripe lint stubs; Plan 25-06a owns Sentry; Plan 25-06b owns PostHog route hook; Plan 25-07 owns MFA e2e; Plan 25-08 owns compliance UI + cron).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase Team+HIPAA addon enabled + BAA signed | HIPAA-01 | Vendor portal click + PDF signing | Founder enables Supabase Team plan + HIPAA add-on at Supabase dashboard; uploads countersigned BAA PDF to `/legal/hipaa/baa/supabase-baa-YYYYMMDD.pdf`; runs `gsd-sdk query commit "chore(baa): supabase BAA signed"`; updates `vendor_baa_chain` row via SECDEF RPC |
| Vercel Pro+HIPAA addon enabled + BAA signed | HIPAA-02 | Vendor portal click | Self-serve since 2025; same proof pattern as HIPAA-01 |
| Sentry Business plan + BAA signed + PHI scrubbing rules | HIPAA-03 | Vendor portal + manual scrubbing-rule config | Same proof pattern; PHI scrubbing rules configured at sentry.io/settings/security-and-privacy |
| Anthropic Enterprise account + BAA + ZDR addendum signed | HIPAA-04 | Sales-assisted, not self-serve | Founder books sales call at anthropic.com/enterprise; signs BAA + ZDR; records account_id + signed PDFs |
| AWS SES BAA via AWS Artifact | HIPAA-05 | AWS Artifact portal sign + S3 cross-region replication setup | Founder signs BAA via AWS Artifact portal; records signing timestamp |
| PostHog tier decision implemented (scrub-only per D-04) | HIPAA-06 | Configuration decision, not engineering | Confirm no PostHog Boost addon enabled in PostHog billing dashboard; document trigger condition for future upgrade |
| SOC 2 Type I attestation achieved via Drata | HIPAA-09 | 6-week observation period | Drata onboarding kickoff + integrations connected + 6-week observation; attestation PDF stored in `/legal/hipaa/soc2/type1-YYYYMMDD.pdf` |
| Employee security training completed (founders + any contractors) | HIPAA-10 | Drata-driven LMS + signed acknowledgment | All staff complete Drata training module; signed-off acknowledgments stored in Drata |
| Written policies live in `/legal/hipaa/` and Notion mirror | HIPAA-11 | Manual write + Notion sync | All 7 policy MD files committed; Notion mirror set up + nightly sync |
| BAA expiry calendar 60-day advance alert tested | HIPAA-13 | Manual cron trigger | Set a test `vendor_baa_chain.baa_expiry_at = now() + 59 days` row; trigger nightly cron; verify admin banner + email + audit-log entry land |
| Annual risk assessment + breach-notification SLA drilled | HIPAA-18 | Annual tabletop exercise | First exercise dated in `/legal/hipaa/incident-response.md`; founder + ops walk through hypothetical breach within 60-day HHS window |
| Wave-0 vendor BAA call kickoff coordination | D-01 | Founder-owned phone/email outreach | All 6 vendor outreach messages sent within 7 days of Phase 24 ship; tracked in PROJECT.md vendor table |

*All other phase behaviors have automated verification via the Per-Task Verification Map above.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
