---
phase: 04
slug: supabase-cloud-bootstrap-ai-proxy-on-edge-functions
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> Concrete fill comes from RESEARCH.md §10 "Validation Architecture". Each plan owner expands the per-task rows during planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Browser framework** | vitest 2.x (already wired in Phase 1) |
| **Edge framework** | deno test (built into Deno; runs via `deno test --allow-all` per RESEARCH.md §9) |
| **E2E framework** | Playwright (already wired in Phase 1) |
| **Config files** | `vitest.config.ts` (leanshot/), `deno.json` in `supabase/functions/ai-chat/` (per RESEARCH.md), `playwright.config.ts` (leanshot/) |
| **Quick run command** | `npm test -- --run` (vitest) from leanshot/ |
| **Edge quick run** | `cd /Users/karstenhaldan/minisite/supabase/functions/ai-chat && deno test --allow-all` |
| **Full suite command** | `npm run test:ci && cd /Users/karstenhaldan/minisite/supabase/functions/ai-chat && deno test --allow-all && npm run test:e2e -- --grep @phase04` |
| **Estimated runtime** | vitest ~30s · deno test ~10s · phase-04 e2e ~60s |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run --reporter=dot` (vitest, fastest)
- **After every plan wave:** Run vitest + deno test + curl-smoke against deployed function
- **Before `/gsd-verify-work`:** All three runners green AND adversarial corpus passing under both vitest and deno test
- **Max feedback latency:** ~30s for vitest; ~10s for deno test

---

## Per-Task Verification Map

> Populated by `gsd-planner` during plan authoring. Each task in 04-01/04-02/04-03 PLAN.md gets a row mapping to a requirement and a concrete `<automated>` command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PROD-07 | INFRA-04-01-* | `supabase init` + config.toml committed with anon-signins | smoke | `cd /Users/karstenhaldan/minisite && test -f supabase/config.toml && grep -q 'enable_anonymous_sign_ins = true' supabase/config.toml` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | PROD-07 | — | [HUMAN] Supabase project created + ref recorded | manual | (checkpoint resume signal) | n/a | ⬜ pending |
| 04-01-03 | 01 | 1 | PROD-07 | T-04-06 | Function secrets (MOONSHOT_API_KEY=placeholder + MOONSHOT_MODEL=kimi-k2.6) set per `04-ADDENDUM-MOONSHOT.md`; .env.secrets deleted; no commit contains a real key | smoke | `npx --prefix leanshot supabase secrets list \| grep -cE 'MOONSHOT_(API_KEY\|MODEL)' \| grep -q '^[[:space:]]*2$' && test ! -f supabase/.env.secrets` | ✅ | ⬜ pending |
| 04-01-04 | 01 | 1 | PROD-07 | — | [HUMAN] Dashboard toggles Magic-Link + Anonymous + Manual Linking ON | manual | `curl -s https://<ref>.supabase.co/auth/v1/settings \| jq '.external.email, .external.anonymous_users'` | n/a | ⬜ pending |
| 04-01-05 | 01 | 1 | PROD-07 | INFRA-04-01-C | Vercel envs present across prod/preview/dev for both projects | smoke | `vercel env ls production \| grep -cE 'VITE_SUPABASE_URL\|VITE_SUPABASE_ANON_KEY'` returns 2 per (project × target) | ✅ | ⬜ pending |
| 04-01-06 | 01 | 1 | PROD-07 | — | `.planning/decisions/supabase.md` records project + thresholds + Phase 5 contract | smoke | `wc -l < .planning/decisions/supabase.md` ≥ 30 AND no `sk-ant-` / JWT strings present | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | AI-01 | — | `@supabase/supabase-js` + `eventsource-parser` installed; `src/lib/supabase.ts` singleton green | unit | `npm test -- --run src/lib/supabase.test.ts` exits 0 | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | AI-01, AI-06 | T-04-06, T-04-07 | Edge Function source authored: tee() + waitUntil + `<user_data>` fence in messages[0] system role + kimi-k2.6 env default (researcher resolves real Kimi K2 model ID); Moonshot OpenAI-compatible /v1/chat/completions call; new `callAIChat` browser wrapper consuming OpenAI delta (`choices[0].delta.content`) + `updateLastAssistant` store action | unit | `npm test -- --run src/lib/ai.test.ts src/lib/supabase.test.ts` + typecheck both green | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | AI-01 | — | BYO key UI removed; FAQ rewritten; main.tsx stale-key cleanup; storage.ts apiKeyStorage deleted; full vitest + typecheck + lint + build green | unit + integration | `! grep -rE 'callAnthropic\|MissingAPIKeyError\|apiKeyStorage\|API_KEY_STORAGE' leanshot/src/ && npm test -- --run && npm run lint` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 2 | AI-01, AI-06 | T-04-07 | Function deployed; unauth → 401; anon-JWT → 200 + text/event-stream + Moonshot model ID (researcher-resolved kimi-k2-*) in logs | integration | `curl -i -X POST <fn-url> -d '{}' \| head -1` returns 401; with Bearer JWT returns 200 + SSE | ❌ W0 | ⬜ pending |
| 04-02-05 | 02 | 2 | AI-01 | — | [HUMAN] Vercel Preview UAT: chat works without paste-key; Settings AI section gone; FAQ updated; logs show Moonshot Kimi model ID | manual | (checkpoint resume signal) | n/a | ⬜ pending |
| 04-03-01 | 03 | 3 | AI-03 | T-04-01, T-04-03 | shared/refusal.ts verbatim move; ≥ 50 ADVERSARIAL_CORPUS rows across 5 categories; vitest + deno test both green | unit | `npm test -- --run shared/refusal.test.ts && (cd /Users/karstenhaldan/minisite && deno test --allow-all --import-map=supabase/functions/import_map.json supabase/functions/tests/)` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | AI-02, AI-05, T-04-05 | T-04-02, T-04-04, T-04-05 | 3 migration files authored with RLS + RPC + pg_cron schedule | source assertion | `grep -c 'enable row level security' supabase/migrations/*.sql` ≥ 2 AND increment_rate_limit + cron.schedule strings present | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 3 | AI-02, AI-03, AI-04, AI-05 | T-04-01..T-04-04 | Edge Function index.ts wired: refusal pre-check + rate-limit RPC + ai_messages persist (user + assistant via captureAndPersist); zero TODO(04-03) markers; deno check green | source assertion + integration | `! grep -q 'TODO(04-03)' supabase/functions/ai-chat/index.ts && deno check --import-map=supabase/functions/import_map.json supabase/functions/ai-chat/index.ts` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 3 | AI-02, AI-05 | T-04-04, T-04-05 | [BLOCKING] `supabase db push` applies all 3 migrations; ai_messages + rate_limit_counters live with rowsecurity=true; increment_rate_limit RPC + cron.job 'cleanup-anon-users' present | integration | 4 db remote query assertions (Task 4 acceptance) | ❌ W0 | ⬜ pending |
| 04-03-05 | 03 | 3 | AI-02, AI-03, AI-05 | T-04-01, T-04-02, T-04-04, T-04-06 | Redeploy + 4 smokes: refusal short-circuit, rate-limit 429s, cross-tenant RLS isolation, log redaction | integration | `bash scripts/load-rate-limit.sh "<ref>" "$JWT" "$ANON_KEY"` exits 0 with 200≤30 + 429≥5; rls-ai-messages.test.ts passes | ❌ W0 | ⬜ pending |
| 04-03-06 | 03 | 3 | AI-03 | T-04-01, T-04-03 | CI workflow contains deno-test job (working-directory: .); lighthouse needs: includes deno-test | smoke | `grep -q 'deno-test:' .github/workflows/ci.yml && grep 'needs:' .github/workflows/ci.yml \| grep -q 'deno-test'` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/deno.json` (authored in plan 04-02 Task 2 sub-task 2A step 4) — Deno project config
- [x] `/Users/karstenhaldan/minisite/supabase/functions/import_map.json` (authored in plan 04-02 Task 2 sub-task 2A step 5; extended in plan 04-03 Task 3 sub-task 3D with shared/disclaimers alias) — exposes `shared/refusal` to Deno
- [x] `/Users/karstenhaldan/minisite/shared/refusal.ts` + `shared/refusal.test.ts` (authored in plan 04-03 Task 1; verbatim move from src/lib/insights-refusal.ts preserving CR-01 + CR-02 fixes) — extracted from `src/lib/insights-refusal.ts` (Phase 3 baseline preserved)
- [x] `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (deno-test job added in plan 04-03 Task 6) — add `deno-test` job (overrides workflow-level `working-directory: leanshot`) per RESEARCH.md §9
- [x] `scripts/load-rate-limit.sh` (authored in plan 04-03 Task 5 sub-task 5C) — fires 100 requests in 60s against deployed function to assert SC#4
- [x] `e2e/rls-ai-messages.test.ts` (authored in plan 04-03 Task 5 sub-task 5D) — cross-tenant RLS proof (two service-role clients, two users, mutual visibility = 0 rows)

*If existing infra is reused without changes: note in plan-level Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase project provisioned in cloud + region picked | PROD-07 (SC#0) | One-time dashboard click; CLI cannot create projects on the free tier without web confirmation | `.planning/decisions/supabase.md` records project ID, region, dashboard URL; verifier opens URL and confirms project exists |
| Magic-link email provider toggled ON | PROD-07 (SC#0) | Dashboard-only toggle (CLI does not flip auth providers on free tier) | `curl <project-url>/auth/v1/settings \| jq '.external.email'` returns provider config; verifier records output |
| Vercel env vars present across prod/preview/dev for both projects | PROD-07 (SC#0) | Vercel CLI requires interactive prompts for `vercel env add` (per RESEARCH.md §8) — the `vercel env ls` smoke check is automatable but the add is not | Plan task includes the exact CLI commands; verifier eyeballs `vercel env ls` output |

*Bootstrap-side manual checks are unavoidable for the one-time cloud provisioning. Feature-side checks (proxy, RLS, rate-limit, refusal) are 100% automated.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify command or Wave 0 dependency (checkpoint tasks have shim automated 'human verification per resume signal'; per-task table maps every non-checkpoint task to a concrete command)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (verified: every Wave's executor work has a vitest/typecheck/curl gate; max 2 consecutive human checkpoints in 04-01 Tasks 2-4)
- [x] Wave 0 covers all MISSING references — all 6 Wave 0 file-creation steps explicitly assigned to plans 04-02 Task 2 + 04-03 Tasks 1+5+6
- [x] No watch-mode flags (`--watch`, `--ui`) in any command (all `npm test` invocations use `-- --run`)
- [x] Feedback latency < 30s for the post-commit smoke (vitest unit tests target ~30s; deno test ~10s; curl smokes ~3s)
- [x] Adversarial corpus has ≥ 50 rows (SC#3) and runs under BOTH vitest AND deno test (plan 04-03 Task 1 step 3 targets ≥ 70 rows; CI gates both runners in plan 04-03 Task 6)
- [x] `nyquist_compliant: true` set in frontmatter (this commit)

**Approval:** planner-approved 2026-05-11 — execution unblocked.
