---
phase: 12
slug: bootstrap-bundle-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 12 is unusually validation-dense by design — every Success Criterion in ROADMAP.md is a CI gate or measurable artifact.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit + integration) + Playwright 1.59.1 (e2e) + bash for CI scripts |
| **Config file** | `vite.config.ts` (embedded test section, line 158) + `playwright.config.ts` |
| **Quick run command** | `npm run lint && npm run test:unit` |
| **Full suite command** | `npm run lint && npm run test && bash scripts/assert-clinic-bundle-budget.sh` |
| **Estimated runtime** | ~90 seconds (lint ~5s, vitest ~25s, playwright clinic-ad-free spec ~30s, budget script ~5s, build ~20s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint` (≤5s — catches ESLint firewall regressions and any rule-syntax mistakes)
- **After every plan wave:** Run `npm run test:unit && bash scripts/assert-clinic-bundle-budget.sh` (after `npm run build`)
- **Before `/gsd-verify-work`:** Full suite must be green AND clinic-ad-free Playwright e2e passes AND budget script returns 0 with all five new chunk slots declared (`wave-0` skip is acceptable for not-yet-built chunks)
- **Max feedback latency:** 90 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | SC-1 (hash-hyphen verified) | — | budget script reports measured value, not `wave-0` skip, for hyphen-hash chunk filenames | shell regression | `bash scripts/test-hash-hyphen-regression.sh` | ✅ exists | ✅ green |
| 12-01-02 | 01 | 1 | SC-1 (new chunk ceilings) | — | five new `*_CEILING` constants present + `check_chunk_ceiling` calls emitted; `wave-0` skip semantics intact for missing chunks | shell + lint | `bash scripts/assert-clinic-bundle-budget.sh` after `npm run build` | ✅ extends existing | ✅ green |
| 12-02-01 | 02 | 1 | SC-2 (firewall ESLint rule) | T-AD-01 (HealthKit→ads §5.1.3 leak) | `import-x/no-restricted-paths` rule produces a lint error when an ad-eligible file imports `src/lib/native/health.ts` | ESLint (lint) | `npm run lint` on `firewall-test-violation` branch — MUST fail | ❌ W0 | ✅ green |
| 12-02-02 | 02 | 1 | SC-2 (six native/* stubs exist) | — | stub files `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` exist so ESLint zones can resolve to real paths | TypeScript compile + lint | `npm run lint && tsc --noEmit -p tsconfig.app.json` | ❌ W0 | ✅ green |
| 12-03-01 | 03 | 1 | SC-3 (clinic-ad-free gate) | T-AD-02 (cross-surface ad leak) | zero ad-provider script tags + zero `<AdSlot>` mounts + zero network requests to ad origins on `/clinic/*`, `/share/*`, `/admin/*` | Playwright e2e | `npx playwright test e2e/clinic-ad-free.spec.ts` | ✅ exists | ✅ green |
| 12-03-02 | 03 | 1 | SC-3 (CI gate wiring) | — | clinic-ad-free spec runs as PR-blocking gate; `.github/workflows/*.yml` references the spec | CI inspection | `grep -r clinic-ad-free .github/workflows/` | ✅ extends existing | ✅ green |
| 12-04-01 | 04 | 1 | SC-4 (CSP snapshot test) | T-CSP-01 (silent CSP drift, Phase 8 pattern) | Vitest unit test reads `vercel.json`, normalizes + sorts CSP directives, diffs against `tests/csp/csp-snapshot.txt` — fails on any drift | Vitest unit | `npm run test:unit -- tests/csp` | ❌ W0 | ✅ green |
| 12-04-02 | 04 | 1 | SC-4 (initial snapshot captured) | — | `tests/csp/csp-snapshot.txt` contains the current post-Phase-8 CSP state, one directive per line, deterministic sort | file presence | `test -f tests/csp/csp-snapshot.txt` | ❌ W0 | ✅ green |
| 12-04-03 | 04 | 1 | SC-4 (vite.config test.include extended) | — | `vite.config.ts` `test.include` covers `tests/**/*.test.ts` | config inspection | `grep -E 'tests/\*\*/\*\.test' vite.config.ts` | ❌ W0 | ✅ green |
| 12-05-01 | 05 | 2 | SC-4 (Resend domain verified) | T-EMAIL-01 (sender spoofing) | `app.leanshot.app` returns `status: verified` from `api.resend.com/domains` with SPF/DKIM/DMARC all green | manual + curl | `curl -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains` and verify entry status | N/A — DNS-dependent | ⬜ pending |
| 12-05-02 | 05 | 2 | SC-4 (real lifecycle email delivered) | — | Email from `noreply@app.leanshot.app` lands in user's inbox; not from sandbox `onboarding@resend.dev` | manual smoke | send via `clinic-invite` Edge Function smoke; verify inbox | N/A — manual | ⬜ pending |
| 12-05-03 | 05 | 2 | SC-5 (Apple Dev provisioned) | — | Apple Developer Program credentials captured; `APPLE_TEAM_ID` + `APPLE_APP_ID` in Vercel env | manual verification | `vercel env ls` | N/A — manual | ⬜ pending |
| 12-05-04 | 05 | 2 | SC-5 (Play Console provisioned) | — | Google Play Console account live; service-account JSON captured in Supabase secret `PLAY_SERVICE_ACCOUNT_JSON` | manual verification | `supabase secrets list` | N/A — manual | ⬜ pending |
| 12-05-05 | 05 | 2 | SC-5 (Stripe Connect Express provisioned) | T-PAY-01 (test-key in prod) | Stripe Connect Express account live; `STRIPE_CONNECT_CLIENT_ID` + `STRIPE_SECRET_KEY` (live) in Vercel env, prefixed appropriately | manual verification | `vercel env ls \| grep -E 'STRIPE_(CONNECT_CLIENT_ID\|SECRET_KEY)'` | N/A — manual | ⬜ pending |
| 12-05-06 | 05 | 2 | SC-5 (PROJECT.md credentials checklist updated) | — | PROJECT.md "Vendor accounts" section reflects all captured credentials with capture date | doc review | `grep -A 20 'Vendor accounts' .planning/PROJECT.md` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note on D-05:** AdMob and AdSense credentials are explicitly NOT Phase 12 gates — they are Phase 20 entry conditions. No verification rows for them appear in this map.

---

## Wave 0 Requirements

- [ ] `tests/csp/csp-snapshot.txt` — initial snapshot from current `vercel.json` (SC-4)
- [ ] `tests/csp/csp-snapshot.test.ts` — Vitest unit test (SC-4); `vite.config.ts` `test.include` extended to cover `tests/**/*.test.ts`
- [ ] `e2e/clinic-ad-free.spec.ts` — Playwright ad-free gate (SC-3)
- [ ] `scripts/test-hash-hyphen-regression.sh` — synthetic-dist regression test (SC-1)
- [ ] ESLint firewall config block in `eslint.config.js` (SC-2) + `firewall-test-violation` fixture branch (never merges)
- [ ] Six `src/lib/native/*.ts` stub files (`health`, `ads`, `push`, `iap`, `deeplink`, `platform`) — needed so ESLint zones resolve to real paths
- [ ] Five new `*_CEILING` constants + `check_chunk_ceiling` calls appended to `scripts/assert-clinic-bundle-budget.sh` (SC-1)
- [ ] `.github/workflows/*.yml` wired to invoke clinic-ad-free spec + budget script + CSP test as PR-blocking gates

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend domain `app.leanshot.app` SPF/DKIM/DMARC records published to DNS provider | SC-4 | DNS console access is interactive; no API available for the user's registrar | (1) Add SPF/DKIM/DMARC records as listed in `12-RESEARCH.md §6`; (2) wait for DNS propagation (~hours); (3) curl `api.resend.com/domains` and confirm `status: "verified"`; (4) capture proof in 12-SUMMARY.md |
| Real lifecycle email delivered from `noreply@app.leanshot.app` | SC-4 | Inbox delivery is end-to-end; only real-world verification works | Send via `clinic-invite` Edge Function smoke against the user's own email; confirm landed in inbox (not spam); screenshot for 12-SUMMARY.md |
| Apple Developer Program enrollment + DUNS verification | SC-5 | Apple's enrollment is multi-day human review | User completes enrollment at https://developer.apple.com/programs/; on approval, capture `APPLE_TEAM_ID` + `APPLE_APP_ID` and paste into Vercel env via `vercel env add` |
| Google Play Console enrollment | SC-5 | Google's enrollment requires identity verification (24h) | User completes enrollment at https://play.google.com/console; create OAuth service account; download JSON; capture in Supabase secret `PLAY_SERVICE_ACCOUNT_JSON` |
| Stripe Connect Express activation | SC-5 | Stripe Connect activation requires bank account + tax-form review (1-2 business days) | User activates Connect Express at https://dashboard.stripe.com/connect; capture `STRIPE_CONNECT_CLIENT_ID` from settings; capture live `STRIPE_SECRET_KEY` in Vercel env |
| `firewall-test-violation` branch trips CI ESLint | SC-2 | The branch must NEVER merge — verification is observational, not assertive | Push branch to remote; observe CI fails on `npm run lint`; document branch SHA in 12-SUMMARY.md so audits can re-run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual verifications explicitly enumerated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 2 vendor tasks are manual; chained between automated Wave 1 work)
- [ ] Wave 0 covers all MISSING references (all 8 W0 items map to a phase task)
- [ ] No watch-mode flags (`--watch` excluded from all sampling commands)
- [ ] Feedback latency < 90s (achievable: lint 5s, unit 25s, playwright spec 30s, budget script + build 30s)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner finalizes per-task verification commands)

**Approval:** pending
