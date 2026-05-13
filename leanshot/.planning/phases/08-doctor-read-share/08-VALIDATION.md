---
phase: 8
slug: doctor-read-share
status: wave-1-complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
wave_1_complete_at: 2026-05-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Anchored to RESEARCH.md §"Validation Architecture" — test pyramid, Wave 0 gaps, infrastructure.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit + integration), Playwright 1.59.1 (e2e), Deno 2.7.14 (Edge Function unit) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `supabase/functions/share/deno.json` (Wave 0) |
| **Quick run command** | `npm run test -- --run` (Vitest, ~30s) |
| **Full suite command** | `npm run test:all` (Vitest + Playwright + Deno + RLS impersonation, ~5min) |
| **Estimated runtime** | ~5 min full / ~30s quick |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run <pattern matching changed files>`
- **After every plan wave:** Run `npm run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green AND 4-failure-mode revocation drill (Wave 3) green
- **Max feedback latency:** 30 seconds for unit/quick; 5 minutes for full

---

## Per-Task Verification Map

> Filled by planner per task in 08-NN-PLAN.md files. Below is the skeleton scaffolding — planner adds rows when authoring plans.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-XX | 01 schema | 1 | SHARE-01..06 (schema gate) | T-08-S1 / S5 | `shares` table created with RLS enforced; cross-tenant impersonation blocked | RLS unit | `npm run test:rls -- --grep shares` | ❌ W0 | ⬜ pending |
| 08-02-XX | 02 Edge Function | 2 | SHARE-03 / SHARE-04 | T-08-A1 / E1 | DB-row-checked revocation returns 401 on revoked share within one request | integration (Deno) | `cd supabase/functions/share && deno test` | ❌ W0 | ⬜ pending |
| 08-03-XX | 03 Active shares tab | 2 | SHARE-05 | — | Patient sees own audit log only (RLS scoped); revoke writes `revoked_at` | component + e2e | `npm run test -- ActiveSharesTab` + `npm run test:e2e -- active-shares.spec.ts` | ❌ W0 | ⬜ pending |
| 08-04-XX | 04 SharePage | 2 | SHARE-01 / SHARE-02 | T-08-S3 | Lazy chunk loaded only on `/share/` route; bundle index unchanged ±0.5kB | bundle + e2e | `npm run build && npm run test:bundle` + `npm run test:e2e -- share-flow.spec.ts` | ❌ W0 | ⬜ pending |
| 08-05-XX | 05 4-failure-mode drill | 3 | SHARE-03 | T-08-A1..A4 | All 4 failure modes (token cache, HTTP cache, JWT TTL, forwarded link) blocked | e2e (security drill) | `npm run test:e2e -- revocation-drill.spec.ts` | ❌ W0 | ⬜ pending |
| 08-06-XX | 06 print/bundle/disclaimer | 3 | SHARE-02 / PROD chart-disclaimer | — | Print mode preserves Phase 3 PK-04 disclaimer; SC#2 zero `aiHistory` references | e2e | `npm run test:e2e -- share-print.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Test infrastructure that MUST exist before Wave 1 begins. Sourced from RESEARCH.md §"Validation Architecture" Wave 0 gaps.

- [ ] **`supabase/functions/share/deno.json`** — Deno test config for Edge Function unit tests (modeled on `supabase/functions/ai-chat/deno.json`)
- [ ] **`supabase/functions/share/index.test.ts`** — Edge Function unit-test scaffolding (file matches Deno glob `{*_,*.,}test.*` per memory `reference_deno_test_discovery.md`)
- [ ] **`tests/rls/shares.spec.ts`** — pgTAP-style cross-tenant impersonation proof for `shares` table (project rule from memory `reference_supabase_project.md` — every new RLS surface gets a live impersonation proof, not just policy SQL)
- [ ] **`tests/e2e/share-flow.spec.ts`** — Playwright spec for create → access-code-entry → snapshot view (uses `addInitScript` for state seeding per memory `reference_playwright_state_seeding.md`)
- [ ] **`tests/e2e/revocation-drill.spec.ts`** — Playwright spec for the 4-failure-mode revocation drill (SC#3)
- [ ] **`tests/e2e/active-shares.spec.ts`** — Playwright spec for patient-side audit log surface
- [ ] **`tests/e2e/share-print.spec.ts`** — Playwright spec for print-mode disclaimer survival
- [ ] **CORS allow-list config** — `Origin` echo + `Access-Control-Allow-Credentials: true` set in Edge Function CORS helper (deviates from `ai-chat/cors.ts` per RESEARCH Pitfall 3+4)
- [ ] **`vite.config.ts` bundle-test guard extension** — verify `share` chunk lazy-loads; index gz still ≤22kB
- [ ] **Migrations directory** — `supabase/migrations/<timestamp>_shares.sql` + `<timestamp>_audit_logs_share_extension.sql` (per RESEARCH Plan 08-01)
- [ ] **Auth fixtures for two users** — RLS impersonation needs two tenant users (`alice@test.com`, `bob@test.com`); reuse Phase 5 fixtures if present, else create new ones in `tests/fixtures/auth.ts`

*Wave 0 closes when all rows above are checked. Planner verifies in 08-01 PLAN.md.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mobile device sharing of link + code over separate channels (SMS + verbal) | SHARE-01 / SC#1 | Cross-device + cross-channel flow can't be reliably automated in CI | Patient creates share, copies link, sends via iMessage to test phone; reads code verbally to "doctor"; doctor opens link on test phone, enters code, sees view |
| Print stylesheet output rendered by browser (visual review) | SC#5 / SHARE-02 print mode | Browser print preview + paper output is platform-specific; Playwright PDF render is approximate | Open `/share/<test-token>`, enter code, click Print, verify chart disclaimer + non-AI-history content + page breaks in browser's print preview (Chrome + Firefox + Safari) |
| CDN cache behavior on Vercel preview deploys | SC#3(b) | Vercel CDN behavior on `Cache-Control: private, no-store` differs from local dev; need real preview deploy | Deploy share Edge Function to Vercel preview; curl `/share/snapshot` 2x with same cookie; verify second response has `cf-cache-status: BYPASS` or equivalent + body served fresh |

---

## Validation Sign-Off

- [ ] All 6 plans have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 items above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / 5min full
- [ ] Cross-tenant RLS impersonation proof for `shares` table exists and runs in CI (project rule)
- [ ] 4-failure-mode revocation drill runs in CI and gates the phase
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 closes

**Approval:** pending — planner to refine per-task verification map and Wave 0 list when authoring 08-NN-PLAN.md files.
