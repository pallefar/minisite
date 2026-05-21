---
phase: 41
slug: public-status-page-embed-provider-blocks
status: revised
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
revised: 2026-05-21
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Regenerated inline iter-1 from each plan's `<verify><automated>` blocks + `requirements` frontmatter, per `feedback_validation_md_inline_generation_when_missing`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (project default) + Deno test (Edge Fns) + Playwright (e2e for consent + admin allowlist, HUMAN-UAT signals 5+6) |
| **Config file** | `leanshot/vite.config.ts` (vitest inline via `defineConfig` from `vitest/config`) + `leanshot/playwright.config.ts` + Deno: per-Fn `deno.json` |
| **Quick run command** | `cd leanshot && npx vitest run <pattern>` |
| **Full suite command** | `cd leanshot && npm run test && npm run lint && npx tsc -p tsconfig.app.json --noEmit && $HOME/.deno/bin/deno test --no-check --allow-read --allow-env supabase/functions/page-render/ supabase/functions/calendly-oauth-start/ supabase/functions/calendly-oauth-callback/` |
| **Estimated runtime** | ~120 seconds full suite (vitest ~45s + tsc ~25s + Deno tests ~20s + lint ~30s) |

---

## Sampling Rate

- **After every task commit:** Run `cd leanshot && npx vitest run <pattern-for-files-modified>`
- **After every plan wave:** Run `cd leanshot && npm run test && npm run lint && npx tsc -p tsconfig.app.json --noEmit` + Deno test sweep
- **Before `/gsd:verify-work`:** Full suite must be green (or skips documented in v1.3-uat-deferred.md per `feedback_milestone_uat_deferral_consolidation`)
- **Max feedback latency:** 60 seconds for quick-run; ~120s for full wave-merge sweep

---

## Per-Task Verification Map

### Plan 41-01 — Consent-event retrofit (Wave 1)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-01-T1 | 01 | 1 | EMBED-01, EMBED-02, EMBED-03, EMBED-05 (D-09 foundation) | T-41-01-01, T-41-01-02 | `subscribeToConsentChange` cleanup closes leak; SSR guard returns no-op | unit (vitest) | `cd leanshot && npx vitest run src/lib/consent/__tests__/consent-event.test.ts` | ❌ W0 (Plan 41-01 Task 1 creates) | ⬜ pending |
| 41-01-T2 | 01 | 1 | EMBED-01, EMBED-02, EMBED-03, EMBED-05 (D-09 emit) | T-41-01-03, T-41-01-04 | Existing P22 callbacks still fire (regression guard); event payload reflects mocked `acceptedCategory` returns | unit (vitest) | `cd leanshot && npx vitest run src/components/consent/__tests__/consent-event-emit.test.ts && npx tsc -p tsconfig.app.json --noEmit` | ❌ W0 (Plan 41-01 Task 2 creates) | ⬜ pending |

### Plan 41-02 — iframe_allowlist schema + RPCs + validator helpers (Wave 1)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-02-T1 | 02 | 1 | EMBED-04, EMBED-07 (D-14 table + RLS) | T-41-02-04 (anon-SELECT accepted exposure) | Default-deny RLS; SECDEF-only writes; hostname UNIQUE | structural (file + grep) | `test -f supabase/migrations/20270711000001_p41_iframe_allowlist.sql && grep -q "create table public.iframe_allowlist" $_ && grep -q "enable row level security" $_` | ❌ W0 (Plan 41-02 Task 1 creates) | ⬜ pending |
| 41-02-T2 | 02 | 1 | EMBED-04, EMBED-07 (D-17 audit) | T-41-02-01, T-41-02-05, T-41-02-06, T-41-02-07 | SECDEF + superadmin gate + 6-arg `log_admin_action`; hostname syntax validator; 42501 on non-superadmin | structural (file + grep) | `test -f supabase/migrations/20270711000002_p41_iframe_allowlist_rpcs.sql && grep -c "security definer" $_ \| grep -q "^2$" && grep -q "is_admin_at_least.*superadmin" $_ && grep -q "log_admin_action.*'iframe_allowlist.add'" $_` | ❌ W0 (Plan 41-02 Task 2 creates) | ⬜ pending |
| 41-02-T3 | 02 | 1 | EMBED-04, EMBED-07 (D-15 exact-match + D-16 fixed sandbox) | T-41-02-02 (look-alike), T-41-02-03 (subdomain), T-41-02-08 (sandbox-override) | `validateCustomIframeUrl` URL ctor + `parsed.hostname === expected`; FIXED sandbox literal | unit (vitest) | `cd leanshot && npx vitest run src/lib/page-builder/__tests__/embed-src.custom-iframe.test.ts && npx tsc -p tsconfig.app.json --noEmit` | ❌ W0 (Plan 41-02 Task 3 creates) | ⬜ pending |

### Plan 41-03 — Vercel middleware + CSP + Deno renderer (Wave 2)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-03-T1 | 03 | 2 | EMBED-01..04, EMBED-07 (D-11, D-12 static CSP + B2 OAuth rewrites + B4 no-env-literal) | T-41-03-02 | Static CSP has D-12 hosts + Calendly OAuth rewrites; ZERO `${VITE_*}` literals in vercel.json (B4 negative gate) | snapshot + grep | `cd leanshot && npx vitest run tests/csp/csp-snapshot.test.ts && grep -q "assets.calendly.com" vercel.json && grep -q "/api/calendly/oauth-start" vercel.json && grep -q "/api/calendly/oauth-callback" vercel.json && ! grep -q '\${VITE_' vercel.json && grep -q "assets.calendly.com" tests/csp/csp-snapshot.txt` | ⚠ extend (csp-snapshot.test.ts exists; .txt snapshot regenerated this task) | ⬜ pending |
| 41-03-T2 | 03 | 2 | EMBED-04, EMBED-07 (D-14 dynamic CSP + B4 middleware report-uri + W11 env pre-check) | T-41-03-03, T-41-03-04 | Regex precision; fail-safe on fetch error; env-var-driven report-uri assembly; W11 short-circuit on missing SUPABASE_* env | unit (vitest, 7 cases) | `cd leanshot && npx vitest run tests/integration/csp-middleware.test.ts && test -f middleware.ts && grep -q "iframe_allowlist" middleware.ts && grep -q "frame-src" middleware.ts && grep -q "VITE_SENTRY_CSP_REPORT_URI" middleware.ts` | ❌ W0 (Plan 41-03 Task 2 creates) | ⬜ pending |
| 41-03-T3 | 03 | 2 | EMBED-01..05, EMBED-07 (D-09 server-side consent gate + B3 blocking allowlist fetch) | T-41-03-01, T-41-03-06 | Placeholder emitted instead of iframe; allowlist re-validated at render; orchestrator throws 500 on DB error (B3 fail-loud) | Deno test + grep | `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-read --allow-env supabase/functions/page-render/ 2>&1 \| grep -E "ok\|FAILED" && grep -q "case 'custom_iframe'" supabase/functions/page-render/render.ts && grep -q "data-embed-pending" supabase/functions/page-render/render.ts && grep -q "leanshot:consent-change" supabase/functions/page-render/render.ts && grep -q "iframe_allowlist" supabase/functions/page-render/index.ts && grep -q "allowlistHostnames" supabase/functions/page-render/render.ts` | ⚠ extend (page-render exists; index.ts + render.ts modified) | ⬜ pending |

### Plan 41-04 — Calendly OAuth Edge Fns + popup component (Wave 2)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-04-T1 | 04 | 2 | EMBED-08 (popup-OAuth Edge Fns) | T-41-04-02, T-41-04-03, T-41-04-05, T-41-04-06 | client_secret server-side only; `postMessage` `targetOrigin` is exact LEANSHOT_APP_ORIGIN (NEVER `*`); HMAC-signed state with 10min expiry | structural (file + grep) + Deno check | `test -d supabase/functions/calendly-oauth-start && test -d supabase/functions/calendly-oauth-callback && test -f supabase/functions/calendly-oauth-start/index.ts && test -f supabase/functions/calendly-oauth-callback/index.ts && grep -q "CALENDLY_OAUTH_CLIENT_SECRET" supabase/functions/calendly-oauth-callback/index.ts && grep -q "postMessage" supabase/functions/calendly-oauth-callback/index.ts && ! grep -q "postMessage.*'\\\\*'" supabase/functions/calendly-oauth-callback/index.ts && $HOME/.deno/bin/deno check --no-config supabase/functions/calendly-oauth-callback/index.ts` | ❌ W0 (Plan 41-04 Task 1 creates) | ⬜ pending |
| 41-04-T2 | 04 | 2 | EMBED-08 (Surface D popup orchestrator) | T-41-04-01, T-41-04-04, T-41-04-07 | LOAD-BEARING `event.origin` validation FIRST guard; ZERO localStorage/sessionStorage; popup-blocked fallback link | unit (vitest, 8 cases) | `cd leanshot && npx vitest run src/components/admin/pages/editor/__tests__/CalendlyPreviewPopup.test.tsx && npx tsc -p tsconfig.app.json --noEmit && ! grep -RIn "localStorage\\\|sessionStorage" src/components/admin/pages/editor/CalendlyPreviewPopup.tsx \| grep -v '^#'` | ❌ W0 (Plan 41-04 Task 2 creates) | ⬜ pending |

### Plan 41-05 — ConsentGatedEmbed HOC + retrofit blocks + KB integration (Wave 3)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-05-T1 | 05 | 3 | EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05 (D-07 + D-08 + D-09 + D-10) | T-41-05-01, T-41-05-02, T-41-05-06 | iframe UNMOUNTS on revoke (no src='' anti-pattern); synchronous mount-time read defends race; per-provider category mapping enforced | unit (vitest, 7 cases) | `cd leanshot && npx vitest run src/components/admin/pages/blocks/__tests__/ConsentGatedEmbed.test.tsx && npx tsc -p tsconfig.app.json --noEmit` | ❌ W0 (Plan 41-05 Task 1 creates) | ⬜ pending |
| 41-05-T2 | 05 | 3 | EMBED-07 (Custom-iframe block + PROPERTY_CONFIGS) | T-41-05-03, T-41-05-05, T-41-05-07 | 3-layer defense (client validate + server validate + RPC validate); sandbox literal hardcoded (no prop override) | unit (vitest, 7 cases) | `cd leanshot && npx vitest run src/components/admin/pages/blocks/__tests__/CustomIframeBlock.test.tsx && npx tsc -p tsconfig.app.json --noEmit && grep -q "custom_iframe" src/components/admin/pages/editor/property-configs.ts` | ❌ W0 (Plan 41-05 Task 2 creates) | ⬜ pending |
| 41-05-T3 | 05 | 3 | EMBED-06 (KB embed-block render + W10 render assertion) | T-41-05-04, T-41-05-08 | dompurify ADD_ATTR allowlist tight (only type/data-url/data-id/data-allow); render assertion verifies `<embed-block>` → React block component resolution | unit (vitest, 6 cases) | `cd leanshot && npx vitest run src/helpdesk/__tests__/KBArticleView.embed-block.test.tsx && grep -q "ADD_TAGS.*embed-block" src/helpdesk/KBArticleView.tsx && grep -q "ADD_TAGS.*embed-block" src/admin/modules/helpdesk/KBEditorPage.tsx && grep -q "components.*embed-block\\\|'embed-block'" src/helpdesk/KBArticleView.tsx && npx tsc -p tsconfig.app.json --noEmit` | ❌ W0 (Plan 41-05 Task 3 creates) | ⬜ pending |

### Plan 41-06 — Admin allowlist UI + phase deploy + HUMAN-UAT (Wave 3, autonomous=false)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-06-T1 | 06 | 3 | EMBED-04, EMBED-07 (D-17 superadmin UI + W8 route normalization) | T-41-06-01 | Dual-layer gate: ADMIN_MODULES `minRole:'superadmin'` (hides sidebar) + page-level `surfaceCheck` (renders 403) + RPC re-verifies | unit (vitest, 16 cases) | `cd leanshot && npx vitest run src/components/admin/embeds/__tests__/ && npx tsc -p tsconfig.app.json --noEmit && grep -q "key: 'embeds'" src/lib/admin/modules.ts && grep -q "minRole: 'superadmin'" src/lib/admin/modules.ts` | ❌ W0 (Plan 41-06 Task 1 creates all 9 files) | ⬜ pending |
| 41-06-T2a | 06 | 3 | POLISH-10 (B6 Better Stack API smoke) | T-41-06-05 (vendor lock accepted) | Smoke asserts >=7 components + >=3 integrations via Better Stack API v3; gracefully skips on missing API key with carry-over annotation | smoke (vitest + curl) | `cd leanshot && npx vitest run tests/smoke/status-page.smoke.test.ts && grep -q "BETTERSTACK_API_KEY" tests/smoke/status-page.smoke.test.ts && grep -q "/api/v3/status-pages" tests/smoke/status-page.smoke.test.ts && grep -q "component" tests/smoke/status-page.smoke.test.ts` | ❌ W0 (Plan 41-06 Task 2a creates) | ⬜ pending |
| 41-06-T2b | 06 | 3 | EMBED-04, EMBED-07, EMBED-08, POLISH-10 (BLOCKING deploy chain) | T-41-06-02, T-41-06-03, T-41-06-04, T-41-06-07 | Pre-push collision + back-date audits; Function Secrets via `sb_secret_*` token (NOT JWT); server-side env only | deploy verify | `cd /Users/karstenhaldan/minisite && supabase migration list --linked 2>&1 \| grep -E "20270711000001\|20270711000002" \| wc -l \| grep -q "^2$" && supabase secrets list --project-ref ytnsipxxmzgaebkqmokp 2>&1 \| grep -q "CALENDLY_OAUTH_CLIENT_SECRET"` | n/a — deploy gate | ⬜ pending |
| 41-06-T4 | 06 | 3 | POLISH-10, EMBED-01..08, D-01..D-18 | T-41-06-08 (accepted) | 6 discrete HUMAN-UAT resume signals; deferred signals carry to `v1.3-uat-deferred.md` per `feedback_milestone_uat_deferral_consolidation` | manual (HUMAN-UAT) | n/a — checkpoint:human-verify, multi-signal | n/a — HUMAN-UAT | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Decision Coverage Map

| Decision | Title | Mapped Plan(s)/Task(s) | Test Anchor |
|----------|-------|------------------------|-------------|
| D-01 | Better Stack 7-component hybrid hierarchy | 41-06-T2a (B6 smoke) + 41-06-T4 Signal 1 (HUMAN-UAT) | smoke asserts component count = 7 via `/api/v3/status-pages` |
| D-02 | Auto-incident thresholds (Sentry >5%/5min, Vercel deploy fail, Supabase p95 >1s/10min, heartbeat 30s) | 41-06-T2a (B6 smoke) + 41-06-T4 Signal 1 | smoke asserts integration count >= 3 |
| D-03 | Email-only subscriber notifications via Better Stack hosted form | 41-06-T4 Signal 1 (HUMAN-UAT, vendor-side) | manual operator verify on Better Stack dashboard |
| D-04 | Maintenance windows via Better Stack admin UI | 41-06-T4 Signal 1 | manual operator verify |
| D-05 | DNS — `status.leanshot.app` CNAME → Better Stack | 41-06-T2a (Group 1 dig smoke) + 41-06-T4 Signal 2 | `dig +short CNAME status.leanshot.app` |
| D-06 | HUMAN-UAT pre-req checklist (paid tier + OAuth + components + CNAME) | 41-06-T4 Signal 1+2+3 (multi-signal HUMAN gate) | operator approval |
| D-07 | Fixed per-provider consent-category mapping | 41-05-T1 (HOC categories prop) + 41-05-T2 Test 6 (custom_iframe = `['marketing']`) | Test 6 in CustomIframeBlock.test.tsx |
| D-08 | Branded placeholder fallback on consent decline | 41-05-T1 Test 7 (EmbedPlaceholderCard copy verbatim) | unit copy assertions |
| D-09 | Auto-load on consent grant via P22 event listener | 41-01-T1 + 41-01-T2 (event contract) + 41-05-T1 Test 2 (HOC subscribes) + 41-03-T3 (inline script in Deno renderer) | unit + Deno tests |
| D-10 | Loading UX — Skeleton + opacity 200ms gated by useReducedMotion | 41-05-T1 Test 5 (reduced-motion gate) | unit (matchMedia mocked) |
| D-11 | CSP enforced day-1 + reporting endpoint | 41-03-T1 + 41-03-T2 (middleware assembles report-uri) | snapshot + middleware Test 6 |
| D-12 | Per-provider exact host entries | 41-03-T1 (vercel.json edits) | snapshot test |
| D-13 | Monthly CSP-violation review (runbook only) | n/a (docs) | not test-covered — runbook artifact |
| D-14 | Custom-iframe CSP allowlist = per-deployment DB table + dynamic CSP injection | 41-02-T1 (table) + 41-03-T2 (middleware fetches + injects) | structural + middleware Test 1 |
| D-15 | Hostname exact-match (no subdomain expansion) | 41-02-T3 Test 1+2 (validateCustomIframeUrl exact-match) | unit |
| D-16 | iframe sandbox FIXED `allow-scripts allow-same-origin` for custom_iframe | 41-02-T3 Test 5 (FIXED literal) + 41-05-T2 (no prop override path) | unit + grep gate |
| D-17 | Superadmin-only allowlist UI + audit retention 90d | 41-06-T1 Test 1 (W8 + superadmin gate) + 41-02-T2 (audit log call) | unit + structural |
| D-18 | Custom-iframe blocks outside Phase 12 ad-free firewall | 41-02-T3 lint pass + Phase 12 eslint zones unchanged | lint pass (no zone leak) |

---

## Requirement Coverage Map

| REQ-ID | Description | Plan(s) | Pyramid Position |
|--------|-------------|---------|------------------|
| POLISH-10 | Public status page via Better Stack | 41-06-T2a + T4 Signal 1+2 | smoke + HUMAN-UAT (B6 satisfies success criterion 1; criterion auto-classified `approved automated-verify-only` when API key unset) |
| EMBED-01 | Calendly block consent-gated + sandboxed | 41-01-T1+T2 (event) + 41-05-T1 (retrofit) + 41-03-T1+T3 (CSP + server render) | unit + Deno + e2e (HUMAN Signal 5) |
| EMBED-02 | YouTube block consent-gated + nocookie | 41-01 + 41-05-T1 + 41-03-T1+T3 | unit + Deno |
| EMBED-03 | Tally block consent-gated + sandboxed | 41-01 + 41-05-T1 + 41-03-T1+T3 | unit + Deno |
| EMBED-04 | Sandbox + CSP + dompurify | 41-02-T1+T2 + 41-03-T1+T2 + 41-05-T3 + 41-06-T1+T2b | unit + snapshot + Deno + structural + deploy verify |
| EMBED-05 | Skeleton + opacity 200ms + reduced-motion gate | 41-05-T1 Test 5 | unit |
| EMBED-06 | KB articles render embed blocks | 41-05-T3 (W10: dedicated test file + render assertion) | unit |
| EMBED-07 | Custom-iframe block + admin allowlist + CSP + validator | 41-02-T1+T2+T3 + 41-03-T2+T3 + 41-05-T2 + 41-06-T1 | unit + structural + Deno + middleware + deploy + HUMAN Signal 6 |
| EMBED-08 | Calendly live preview via popup OAuth | 41-04-T1+T2 + 41-03-T1 (rewrites) | Deno + unit + HUMAN Signal 3 |

---

## Wave 0 Requirements

The following test files do not yet exist on `main` — the named plan's first task creates each scaffold before any task that depends on the test passing can run.

- [ ] `leanshot/src/lib/consent/__tests__/consent-event.test.ts` — Plan 41-01 Task 1 (stubs for D-09 event contract)
- [ ] `leanshot/src/components/consent/__tests__/consent-event-emit.test.ts` — Plan 41-01 Task 2
- [ ] `leanshot/src/lib/page-builder/__tests__/embed-src.custom-iframe.test.ts` — Plan 41-02 Task 3 (8 cases for D-15 + D-16)
- [ ] `leanshot/middleware.ts` + `leanshot/tests/integration/csp-middleware.test.ts` — Plan 41-03 Task 2 (7 cases including B4 + W11)
- [ ] `supabase/functions/calendly-oauth-start/index.ts` + `supabase/functions/calendly-oauth-callback/index.ts` — Plan 41-04 Task 1
- [ ] `leanshot/src/components/admin/pages/editor/__tests__/CalendlyPreviewPopup.test.tsx` — Plan 41-04 Task 2 (8 cases)
- [ ] `leanshot/src/components/admin/pages/blocks/ConsentGatedEmbed.tsx` + `EmbedPlaceholderCard.tsx` + `__tests__/ConsentGatedEmbed.test.tsx` — Plan 41-05 Task 1 (7 cases)
- [ ] `leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx` + `__tests__/CustomIframeBlock.test.tsx` — Plan 41-05 Task 2 (7 cases)
- [ ] `leanshot/src/helpdesk/__tests__/KBArticleView.embed-block.test.tsx` — Plan 41-05 Task 3 (6 cases including W10 render assertion)
- [ ] `leanshot/src/components/admin/embeds/AllowlistPage.tsx` + `AddHostnameForm.tsx` + `AllowlistTable.tsx` + `RemoveHostnameConfirm.tsx` + `ReferencesSheet.tsx` + 3 `__tests__/` files — Plan 41-06 Task 1 (16 cases)
- [ ] `leanshot/tests/smoke/status-page.smoke.test.ts` — Plan 41-06 Task 2a (B6: 3 assertion groups including Better Stack API)
- [ ] No framework install needed — vitest + Playwright + Deno test all pre-configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Better Stack vendor setup (paid tier + 7 components + 3 integrations + branding) | POLISH-10 / D-01..D-04 / D-06 | Vendor dashboard config; no API for branding upload | Plan 41-06 Task 4 Signal 1 |
| DNS CNAME propagation | POLISH-10 / D-05 | Registrar-side action | Plan 41-06 Task 4 Signal 2 (also smoke-covered once live via Group 1) |
| Calendly developer OAuth app creation + secret reveal | EMBED-08 / V13-EMBED | Calendly dashboard only — no API for app create | Plan 41-06 Task 4 Signal 3 |
| End-to-end consent → embed hydration in real browser (no provider requests pre-consent) | EMBED-01/02/03 / D-09 | Network-tab inspection in incognito; provider cookie audit | Plan 41-06 Task 4 Signal 5 |
| Custom-iframe end-to-end: allowlist add → publish → consent-grant → iframe loads + dynamic CSP frame-src includes hostname | EMBED-07 / D-14 | Production deploy + DOM inspection of served CSP header | Plan 41-06 Task 4 Signal 6 |
| Monthly CSP-violation review | D-13 | Runbook process, not test-covered | Documented in 41-06-SUMMARY |

Any signal that cannot be approved inline carries to `.planning/milestones/v1.3/v1.3-uat-deferred.md` per `feedback_milestone_uat_deferral_consolidation`.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (this validation map; ⬜ pending → ✅ green flips on execute)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (all 14 code-side tasks have automated verify; HUMAN-UAT Signal 4 is the only checkpoint and it follows BLOCKING auto deploy)
- [x] Wave 0 covers all MISSING references (11 new test/source files enumerated above)
- [x] No watch-mode flags (all commands are `vitest run` / `deno test` / one-shot grep)
- [x] Feedback latency < 60s for quick-run; ~120s for full wave-merge sweep
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-21 (iter-1 inline regeneration per `feedback_validation_md_inline_generation_when_missing`)
