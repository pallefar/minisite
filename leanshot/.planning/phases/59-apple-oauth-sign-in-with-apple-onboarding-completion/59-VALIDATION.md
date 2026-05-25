---
phase: 59
slug: apple-oauth-sign-in-with-apple-onboarding-completion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-26
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/component) + existing auth.test.ts; Lighthouse CI (`npm run lighthouse:onboard`) |
| **Config file** | `leanshot/vite.config.ts` (use `npx vitest run --config vite.config.ts <path>`) |
| **Quick run** | `npx vitest run --config vite.config.ts src/lib/auth.test.ts src/components/auth/` |
| **TS typecheck** | `npx tsc -p tsconfig.app.json --noEmit` |
| **i18n gate** | `bash scripts/check-locale-coverage.sh` (new auth button labels must keep en↔es parity) |
| **Estimated runtime** | ~30s |

---

## Sampling Rate

- **After every task commit:** tsc on changed area + relevant vitest + locale gate (if catalogs touched)
- **After every plan wave:** full vitest + locale gate
- **Before verify:** auth + onboarding tests green; locale parity green
- **Max feedback latency:** ~30s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner populates) | | | | | | | | | ⬜ pending |

---

## Wave 0 Requirements

- [ ] vitest + auth.test.ts already exist — existing infra covers unit/component
- [ ] `@capacitor-community/apple-sign-in` may need install for the native path (verify package.json; flag-gated behind isAppleEnabled + detectPlatform==='ios')

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Apple OAuth provider config + flag-flip ON + on-device sign-in | AUTH-07/08/09 | Needs Apple Services ID + .p8 + Supabase secrets (vendor-pending) + physical iOS device | Defer to Phase 70 |
| Apple private-relay live signup E2E | AUTH-09 | Needs real Apple ID | Defer to Phase 70 |
| Mobile Lighthouse ≥90 on-device | ONBOARD-10 | Needs device/CI measurement | Defer to Phase 70 (run `npm run lighthouse:onboard` for a local signal) |
| PostHog Experiments LIVE traffic-split + ship-winner | AUTH-11/ONBOARD | Needs VENDOR-09 Personal API key | Defer to Phase 70 (wire + mock-test now) |
| Superadmin admin-walkthrough fixture seeding | ONBOARD-06 | Needs superadmin role row | Defer to Phase 70 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
