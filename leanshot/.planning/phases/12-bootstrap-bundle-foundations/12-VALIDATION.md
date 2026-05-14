---
phase: 12
slug: bootstrap-bundle-foundations
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
last_audited: 2026-05-14
audit_note: "All 9 automated-testable requirements COVERED + re-verified green 2026-05-14. 5 vendor checkpoints (12-05-01..05) are manual-only and still PENDING — tracked, not blocking nyquist coverage."
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
| 12-02-01 | 02 | 1 | SC-2 (firewall ESLint rule) | T-AD-01 (HealthKit→ads §5.1.3 leak) | `import-x/no-restricted-paths` rule produces a lint error when an ad-eligible file imports `src/lib/native/health.ts` | ESLint (lint) | `npm run lint` on `firewall-test-violation` branch — MUST fail | ✅ exists | ✅ green |
| 12-02-02 | 02 | 1 | SC-2 (six native/* stubs exist) | — | stub files `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` exist so ESLint zones can resolve to real paths | TypeScript compile + lint | `npm run lint && tsc --noEmit -p tsconfig.app.json` | ✅ exists | ✅ green |
| 12-03-01 | 03 | 1 | SC-3 (clinic-ad-free gate) | T-AD-02 (cross-surface ad leak) | zero ad-provider script tags + zero `<AdSlot>` mounts + zero network requests to ad origins on `/clinic/*`, `/share/*`, `/admin/*` | Playwright e2e | `npx playwright test e2e/clinic-ad-free.spec.ts` | ✅ exists | ✅ green |
| 12-03-02 | 03 | 1 | SC-3 (CI gate wiring) | — | clinic-ad-free spec runs as PR-blocking gate; `.github/workflows/*.yml` references the spec | CI inspection | `grep -r clinic-ad-free .github/workflows/` | ✅ extends existing | ✅ green |
| 12-04-01 | 04 | 1 | SC-4 (CSP snapshot test) | T-CSP-01 (silent CSP drift, Phase 8 pattern) | Vitest unit test reads `vercel.json`, normalizes + sorts CSP directives, diffs against `tests/csp/csp-snapshot.txt` — fails on any drift | Vitest unit | `npm run test:unit -- tests/csp` | ✅ exists | ✅ green |
| 12-04-02 | 04 | 1 | SC-4 (initial snapshot captured) | — | `tests/csp/csp-snapshot.txt` contains the current post-Phase-8 CSP state, one directive per line, deterministic sort | file presence | `test -f tests/csp/csp-snapshot.txt` | ✅ exists | ✅ green |
| 12-04-03 | 04 | 1 | SC-4 (vite.config test.include extended) | — | `vite.config.ts` `test.include` covers `tests/**/*.test.ts` | config inspection | `grep -E 'tests/\*\*/\*\.test' vite.config.ts` | ✅ exists | ✅ green |
| 12-05-01 | 05 | 2 | SC-4 (Resend domain verified) | T-EMAIL-01 (sender spoofing) | `app.leanshot.app` returns `status: verified` from `api.resend.com/domains` with SPF/DKIM/DMARC all green | manual + curl | `curl -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains` and verify entry status | N/A — DNS-dependent | ⚠️ pending — DNS records not yet published. Submit date: 2026-05-13. Resume signal: `resend-done`. |
| 12-05-02 | 05 | 2 | SC-4 (real lifecycle email delivered) | — | Email from `noreply@app.leanshot.app` lands in user's inbox; not from sandbox `onboarding@resend.dev` | manual smoke | send via `POST /emails` after domain verified; verify inbox | N/A — manual | ⚠️ pending — requires 12-05-01 green first. Resume signal: `resend-done`. |
| 12-05-03 | 05 | 2 | SC-5 (Apple Dev provisioned) | — | Apple Developer Program credentials captured; `APPLE_TEAM_ID` + `APPLE_BUNDLE_ID` in Vercel env | manual verification | `vercel env ls \| grep -E '^(APPLE_TEAM_ID\|APPLE_BUNDLE_ID)'` | N/A — manual | ⚠️ pending — enrollment not yet submitted. Submit date: (user action required). ETA: 24-48h after enrollment. Resume signal: `apple-done`. |
| 12-05-04 | 05 | 2 | SC-5 (Play Console provisioned) | — | Google Play Console account live; service-account JSON captured in Supabase secret `PLAY_SERVICE_ACCOUNT_JSON` | manual verification | `supabase secrets list \| grep PLAY_SERVICE_ACCOUNT_JSON` | N/A — manual | ⚠️ pending — registration not yet completed. Submit date: (user action required). ETA: instant after $25 payment. Resume signal: `play-done`. |
| 12-05-05 | 05 | 2 | SC-5 (Stripe Connect Express provisioned) | T-PAY-01 (test-key in prod) | Stripe Connect Express account live; `STRIPE_CONNECT_CLIENT_ID` + `STRIPE_SECRET_KEY` (sk_test_*, NOT sk_live_*) in Vercel env | manual verification | `vercel env ls \| grep -E '^(STRIPE_SECRET_KEY\|STRIPE_PUBLISHABLE_KEY\|STRIPE_CONNECT_CLIENT_ID)'` | N/A — manual | ⚠️ pending — Connect Express not yet activated. Submit date: (user action required). ETA: 1-2 biz days after activation. Resume signal: `stripe-done`. |
| 12-05-06 | 05 | 2 | SC-5 (PROJECT.md credentials checklist updated) | — | PROJECT.md "Vendor accounts" section reflects all captured credentials with capture date | doc review | `grep -c '^\| Apple Developer Program' leanshot/.planning/PROJECT.md` | ✅ exists | ✅ green — Vendor accounts table added to PROJECT.md with 6 vendor rows (Apple, Play, Stripe, Resend, AdMob, AdSense) per D-06. Committed 2026-05-13. |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note on D-05:** AdMob and AdSense credentials are explicitly NOT Phase 12 gates — they are Phase 20 entry conditions. No verification rows for them appear in this map.

---

## Wave 0 Requirements

All 8 Wave 0 items verified present on disk 2026-05-14.

- [x] `tests/csp/csp-snapshot.txt` — initial snapshot from current `vercel.json` (SC-4)
- [x] `tests/csp/csp-snapshot.test.ts` — Vitest unit test (SC-4); `vite.config.ts` `test.include` extended to cover `tests/**/*.test.ts`
- [x] `e2e/clinic-ad-free.spec.ts` — Playwright ad-free gate (SC-3)
- [x] `scripts/test-hash-hyphen-regression.sh` — synthetic-dist regression test (SC-1)
- [x] ESLint firewall config block in `eslint.config.js` (SC-2) + `firewall-test-violation` fixture branch (never merges)
- [x] Six `src/lib/native/*.ts` stub files (`health`, `ads`, `push`, `iap`, `deeplink`, `platform`) — needed so ESLint zones resolve to real paths
- [x] Five new `*_CEILING` constants + `check_chunk_ceiling` calls appended to `scripts/assert-clinic-bundle-budget.sh` (SC-1)
- [x] `.github/workflows/*.yml` wired to invoke clinic-ad-free spec + budget script + CSP test as PR-blocking gates (`.github/workflows/ci.yml`)

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (manual verifications explicitly enumerated above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 2 vendor tasks are manual; chained between automated Wave 1 work)
- [x] Wave 0 covers all MISSING references (all 8 W0 items map to a phase task)
- [x] No watch-mode flags (`--watch` excluded from all sampling commands)
- [x] Feedback latency < 90s (achievable: lint 5s, unit 25s, playwright spec 30s, budget script + build 30s)
- [x] `nyquist_compliant: true` set in frontmatter — all 9 automated-testable requirements re-verified green 2026-05-14

**Approval:** validated 2026-05-14 — automated coverage complete (9/9 green). 5 vendor checkpoints remain manual-only + PENDING (see audit trail).

---

## Validation Audit 2026-05-14

State A re-audit (existing draft VALIDATION.md was pre-execution; finalized post-execution).

| Metric | Count |
|--------|-------|
| Automated-testable requirements | 9 |
| Re-verified green this session | 9 |
| Automated-test gaps found | 0 |
| Manual-only (enumerated) | 5 (vendor accounts — `12-05-01..05`) |
| Escalated | 0 |

**Re-verification proof (all run 2026-05-14):**

- `12-01-01` — `bash scripts/test-hash-hyphen-regression.sh` → 5 passed, 0 failed, exit 0
- `12-01-02` — `npm run build` + `bash scripts/assert-clinic-bundle-budget.sh` → exit 0; all clinic chunks under ceiling; index 14385 B gz; 5 v1.2 chunks correctly emit `wave-0` skip
- `12-02-01` — `git checkout firewall-test-violation && npm run lint` → emits `import-x/no-restricted-paths` error on `ads.fixture-violates-firewall.ts` ("health.ts must not flow into the ad transport"). Rule fires exactly as designed.
- `12-02-02` — 6 `src/lib/native/*.ts` stubs present; `npm run build` (`tsc -b && vite build`) passes clean
- `12-03-01` — `npx playwright test e2e/clinic-ad-free.spec.ts` → 3 passed (/clinic, /share, /admin)
- `12-03-02` — `clinic-ad-free` referenced in `.github/workflows/ci.yml`
- `12-04-01` — `npm run test:unit -- tests/csp` → 1 passed
- `12-04-02` — `tests/csp/csp-snapshot.txt` present
- `12-04-03` — `vite.config.ts` `test.include` covers `tests/**`
- `12-05-06` — PROJECT.md vendor-accounts table present

**Findings carried out of this audit (NOT Nyquist coverage gaps — tracked elsewhere):**

1. **5 vendor checkpoints still PENDING** — `12-05-01` Resend domain (`resend-domain-proof.json` is still a `pending-verification` scaffold), `12-05-02` lifecycle email, `12-05-03` Apple Dev, `12-05-04` Play Console, `12-05-05` Stripe Connect Express. Inherently manual; do not block `nyquist_compliant` (coverage is about automated test presence, not manual-step completion) but DO block full phase-complete sign-off.
2. **`firewall-test-violation` branch not pushed to `origin`** — the firewall rule is proven to fire locally (above), but the "CI lint goes red on the fixture branch" observation has never run in actual GitHub Actions. Push the branch (it must never merge) to close the observational half of `12-02-01`.
3. **Repo-wide `npm run lint` is red** — 84 errors / 21 warnings, dominated by 67 `import-x/order` + scattered jsx-a11y, spread one-per-file across Phase 8/9/10/13 components. ZERO Phase 12 deliverable files are affected. This is pre-existing cross-phase tech debt (fits the Phase 23 sweep), not a Phase 12 regression — but it means the VALIDATION.md "run `npm run lint` after every task commit" sampling command currently exits non-zero for reasons unrelated to Phase 12.
