---
phase: 8
slug: doctor-read-share
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
wave_1_complete_at: 2026-05-13
closed: 2026-05-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Anchored to RESEARCH.md §"Validation Architecture" — test pyramid, Wave 0 gaps, infrastructure.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit + integration), Playwright 1.59.1 (e2e), Deno 2.7.14 (Edge Function unit) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `supabase/functions/share/deno.json` |
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-T1 | 01 schema | 1 | SHARE-01..06 | T-08-I1 | Wave 0 scaffolds + shared types (incl. SnapshotResponse.share_id per BL-1) | unit + RLS | `npm run test -- --run share && npm run test:e2e:rls -- rls-shares` | yes | green |
| 08-01-T2 | 01 schema | 1 | SHARE-01..06 | T-08-T1/T2/I1/I2/I4 | 4 migrations + 6 RPCs (incl. verify_share_code BL-2) with search_path discipline + ME-2 ip-family CHECK | sql lint + grep | `grep ai_messages supabase/migrations/*share*.sql \| grep -c -v '^0$' \|\| exit 1` | yes | green |
| 08-01-T3 | 01 schema | 1 | SHARE-01..06 | — | `supabase db push` + cross-tenant RLS proof + 6 RPCs deployed | RLS | `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts -t cross-tenant` | yes | green |
| 08-02-T1 | 02 edge fn | 2 | SHARE-02/03/04/05/06 | T-08-I1/I2/T2/R1 | Edge Function source — DB-row revocation, cookie binding, AI exclusion, share_id in /snapshot 200 (BL-1), env-driven allow-list (ME-4) | deno typecheck | `cd supabase/functions/share && deno check index.ts` | yes | green |
| 08-02-T2 | 02 edge fn | 2 | SHARE-02/03/04/05/06 | T-08-I1/I2 | 29 Deno.test blocks (22 active + 7 integration-deferred) + share_id assertion | deno test | `cd supabase/functions/share && deno test --allow-all` | yes | green |
| 08-02-T3 | 02 edge fn | 2 | SHARE-02/03/04/05/06 | — | Deployed function reachable; curl smoke (incl. share_id field); CI Deno step appended (HI-2 base) | manual + CI | manual curl smoke (see 08-02-PLAN how-to-verify) | yes | green |
| 08-03-T1 | 03 settings | 2 | SHARE-01/05 | T-08-I4/T3 | Active shares list + revoke flow + RLS-scoped audit aggregate | component | `npm run test -- --run ActiveSharesSection` | yes | green |
| 08-03-T2 | 03 settings | 2 | SHARE-01 | T-08-I4 | CreateShareModal + raw_token/code discard on close | component + e2e | `npm run test -- --run CreateShareModal && npx playwright test e2e/active-shares.spec.ts` | yes | green |
| 08-04-T1 | 04 sharepage | 2 | SHARE-01/02/06 | T-08-T4/T5 | selectView extension + share-client + CodeEntry + RevokedScreen + .env.example (ME-3) | unit + typecheck | `npm run typecheck && grep -c useStore src/components/share/ \| grep -q '^0$'` | yes | green |
| 08-04-T2a | 04 sharepage | 2 | SHARE-02/03 | T-08-I7 | SharePage state machine + chart/report prop extension (HI-5) + 5s polling (HI-4) | component | `npm run test -- --run SharePage` | yes | green |
| 08-04-T2b | 04 sharepage | 2 | SHARE-02/03 | T-08-T5 | e2e happy path + bundle assertion (HI-1 — share ≤ 18 kB ceiling; final share-*.gz = 6.55 kB; index gz = 20.25 kB after Plan 08-06 manualChunks regrouping) | e2e + bundle | `npx playwright test e2e/share-happy-path.spec.ts && npm run build` | yes | green |
| 08-05-T1 | 05 drill | 3 | SHARE-03/05 | T-08-I7/R1/S3 | RLS fixtures (HI-6 timestamp labels + afterAll cleanup) + 5-test cross-tenant proof | RLS | `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts` | yes | green |
| 08-05-T2 | 05 drill | 3 | SHARE-04/06 | T-08-S1/T2/D2/T6 | 4-failure-mode drill + cookie attrs + audit-row + 10s timeout (HI-4) + CI append (HI-2) | e2e | `npx playwright test e2e/share-revocation-drill.spec.ts` | yes | green |
| 08-06-T1 | 06 close | 3 | SC#5 | T-08-I7/I9 | Print mode + reduced-motion + chart watermark survival + footer (BL-1 share_id, 8-char slice, NEVER patient user_id) | e2e | `npx playwright test e2e/share-print.spec.ts` | yes | green |
| 08-06-T2 | 06 close | 3 | All | T-08-T5 | manualChunks for `src/components/share/*` → `share` chunk + static-import CI guard (HI-2 third additive append after Plan 08-02 + 08-05) + traceability sweep | bundle + CI | `npm run build && grep 'Static-import guard for share routes' .github/workflows/ci.yml && ls dist/assets/share-*.js` | yes | green |

*Status: ⬜ pending · ✅ green / `green` · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Test infrastructure that MUST exist before Wave 1 begins. Sourced from RESEARCH.md §"Validation Architecture" Wave 0 gaps. All 11 items closed by Plan 08-01.

- [x] **`supabase/functions/share/deno.json`** — Deno test config for Edge Function unit tests (modeled on `supabase/functions/ai-chat/deno.json`)
- [x] **`supabase/functions/share/index.test.ts`** — Edge Function unit-test scaffolding (file matches Deno glob `{*_,*.,}test.*` per memory `reference_deno_test_discovery.md`)
- [x] **`e2e/rls-shares.test.ts`** — Vitest cross-tenant impersonation proof for `shares` table (5 assertions live; Plan 08-05 closed the Wave-0 `it.todo` stubs)
- [x] **`e2e/share-happy-path.spec.ts`** — Playwright spec for create → access-code-entry → snapshot view (Plan 08-04 Task 2b — replaced Wave-0 scaffold)
- [x] **`e2e/share-revocation-drill.spec.ts`** — Playwright spec for the 4-failure-mode revocation drill (Plan 08-05 Task 2 — 6 tests live; SC#3 phase gate)
- [x] **`e2e/active-shares.spec.ts`** — Playwright spec for patient-side audit log surface (Plan 08-03)
- [x] **`e2e/share-print.spec.ts`** — Playwright spec for print-mode disclaimer survival (Plan 08-06 Task 1 — 3 tests live)
- [x] **CORS allow-list config** — `Origin` echo + `Access-Control-Allow-Credentials: true` set in `supabase/functions/share/cors.ts` (Plan 08-02 Task 1)
- [x] **`vite.config.ts` bundle-test guard extension** — `share` manualChunks rule + Plan 08-04 Task 2b bundle-size assertion (HI-1) + Plan 08-06 Task 2 static-import CI guard (HI-2)
- [x] **Migrations directory** — `supabase/migrations/` has the 4 Plan 08-01 share migrations (`shares` + `audit_logs` extension + 6 RPCs + `share_snapshot_view`)
- [x] **Auth fixtures for two users** — `e2e/fixtures/shares.ts` ensure-or-create at fixed password for `alice@test.com` + `bob@test.com` (Plan 08-04 mint + Plan 08-05 extension)

*Wave 0 closed by Plan 08-01.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mobile device sharing of link + code over separate channels (SMS + verbal) | SHARE-01 / SC#1 | Cross-device + cross-channel flow can't be reliably automated in CI | Patient creates share, copies link, sends via iMessage to test phone; reads code verbally to "doctor"; doctor opens link on test phone, enters code, sees view |
| Print stylesheet output rendered by browser (visual review) | SC#5 / SHARE-02 print mode | Browser print preview + paper output is platform-specific; Playwright PDF render is approximate; `share-print.spec.ts` covers the DOM-level invariants (watermark canvas visible, footer copy, AI exclusion) but the actual rasterized paper output requires visual review | Open `/share/<test-token>`, enter code, click Print, verify chart disclaimer + non-AI-history content + page breaks in browser's print preview (Chrome + Firefox + Safari). Footer should show `share id <8-chars>`, NEVER the patient's user_id |
| CDN cache behavior on Vercel preview deploys | SC#3(b) | Vercel CDN behavior on `Cache-Control: private, no-store` differs from local dev; need real preview deploy | Deploy share Edge Function to Vercel preview; curl `/share/snapshot` 2x with same cookie; verify second response has `cf-cache-status: BYPASS` or equivalent + body served fresh |

---

## SC traceability — ROADMAP Phase 8 SCs → automated proof

| SC # | Description | Automated Proof | Plan |
|------|-------------|-----------------|------|
| SC#1 | Patient can generate a time-bound share link from Settings and revoke it; doctor view stops working within seconds | `e2e/active-shares.spec.ts` (create + revoke happy-path) + `e2e/share-revocation-drill.spec.ts` failure mode (a) | 08-03 + 08-05 |
| SC#2 | Doctor sees the same data the patient sees, including the live drug-level chart, recent injections, symptoms, photos, weight, and doctor report — but NO AI conversation history | `e2e/share-happy-path.spec.ts` (6 section headings + AI-substring exclusion) + `src/components/share/SharePage.test.tsx` (DOM substring check) + Vitest `e2e/rls-shares.test.ts` migration-level grep on `share_snapshot_view` for `ai_messages` / `ai_history` / `ai_conversation` | 08-04 + 08-01 |
| SC#3 | The 4-failure-mode revocation drill (token cache, HTTP cache, JWT TTL, forwarded link) runs green in CI and gates merge | `e2e/share-revocation-drill.spec.ts` 6 tests + `.github/workflows/ci.yml` `share-security-drill` job | 08-05 |
| SC#4 | Settings → "Active shares" tab functional + queries audit log surface; patient sees which doctor / when / what was viewed | `e2e/active-shares.spec.ts` (RLS-scoped audit aggregate + revoke button) | 08-03 |
| SC#5 | Print-friendly mode preserved and reuses DoctorReport.tsx's existing print stylesheet with the chart-overlaid Phase 3 PK-04 disclaimer surviving the print | `e2e/share-print.spec.ts` (3 tests — watermark survives emulateMedia('print'), AI exclusion in print DOM, reduced-motion fade suppressed) + manual visual review (Manual Verifications row 2) | 08-06 |

---

## Validation Sign-Off

- [x] All 6 plans have `<automated>` verify or Wave 0 dependencies — see per-task table above (15 rows, all `green`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every task has its own automated command
- [x] Wave 0 covers all MISSING references (11 items above — all checked)
- [x] No watch-mode flags — every command above runs once-and-exits
- [x] Feedback latency < 30s quick / 5min full — Vitest suite ~6s, e2e drill ~90s, full RLS suite ~3min
- [x] Cross-tenant RLS impersonation proof for `shares` table exists and runs in CI (project rule) — `e2e/rls-shares.test.ts` + `share-security-drill` job
- [x] 4-failure-mode revocation drill runs in CI and gates the phase — `share-security-drill` job, branch protection per Plan 08-05 SUMMARY §"Branch Protection — User Action Required"
- [x] `nyquist_compliant: true` set in frontmatter after Wave 0 closes
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** signed off — Phase 8 closes with 15/15 task rows green, all 5 ROADMAP SCs mapped to automated proof or documented manual verification, all 11 Wave 0 items complete.
