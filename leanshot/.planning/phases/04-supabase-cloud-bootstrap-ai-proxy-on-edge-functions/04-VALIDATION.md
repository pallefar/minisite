---
phase: 04
slug: supabase-cloud-bootstrap-ai-proxy-on-edge-functions
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 04-01-01 | 01 | 1 | PROD-04 | — | `supabase/config.toml` committed; project linked | smoke | `supabase functions list \| grep -q ai-chat \|\| echo "OK (no functions yet — pre-deploy state)"` | ❌ W0 | ⬜ pending |
| 04-01-XX | 01 | — | PROD-04 | — | Vercel envs present across prod/preview/dev for both projects | smoke | `vercel env ls production --cwd leanshot 2>&1 \| grep -q SUPABASE_URL` | ❌ W0 | ⬜ pending |
| 04-02-XX | 02 | — | AI-01, AI-06 | — | Edge Function streams Anthropic SSE; BYO key card removed from Settings | unit + e2e | `npm test -- --run src/lib/ai.test.ts && npm run test:e2e -- --grep "AI chat no key"` | ❌ W0 | ⬜ pending |
| 04-02-XX | 02 | — | AI-01 | — | `claude-sonnet-4-6` returned in response metadata | integration | `curl -sS .../functions/v1/ai-chat -d '...' \| grep -q claude-sonnet-4-6` | ❌ W0 | ⬜ pending |
| 04-03-XX | 03 | — | AI-03 | T-04-01 prompt-injection | Refusal corpus 50+ rows passes under vitest AND deno test | unit | `npm test -- --run shared/refusal.test.ts && (cd ../supabase/functions/ai-chat && deno test --allow-all refusal.test.ts)` | ❌ W0 | ⬜ pending |
| 04-03-XX | 03 | — | AI-02 | T-04-02 quota-bypass | 100 msgs in 60s returns 429 with friendly UI; counters survive cold start | integration | `scripts/load-rate-limit.sh` | ❌ W0 | ⬜ pending |
| 04-03-XX | 03 | — | AI-04 | T-04-03 prompt-leak | System prompt template fences `<user_data>`; corpus row asserts model never echoes fence tokens | unit | `npm test -- --run shared/refusal.test.ts -t "structural separation"` | ❌ W0 | ⬜ pending |
| 04-03-XX | 03 | — | AI-05 | T-04-04 cross-tenant | user A cannot read user B's `ai_messages` rows via admin client | integration | `npm test -- --run e2e/rls-ai-messages.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/deno.json` — Deno project config
- [ ] `/Users/karstenhaldan/minisite/supabase/functions/import_map.json` — exposes `shared/refusal` to Deno
- [ ] `/Users/karstenhaldan/minisite/shared/refusal.ts` + `shared/refusal.test.ts` — extracted from `src/lib/insights-refusal.ts` (Phase 3 baseline preserved)
- [ ] `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` — add `deno-test` job (overrides workflow-level `working-directory: leanshot`) per RESEARCH.md §9
- [ ] `scripts/load-rate-limit.sh` — fires 100 requests in 60s against deployed function to assert SC#4
- [ ] `e2e/rls-ai-messages.test.ts` — cross-tenant RLS proof (two service-role clients, two users, mutual visibility = 0 rows)

*If existing infra is reused without changes: note in plan-level Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase project provisioned in cloud + region picked | PROD-04 (SC#0) | One-time dashboard click; CLI cannot create projects on the free tier without web confirmation | `.planning/decisions/supabase.md` records project ID, region, dashboard URL; verifier opens URL and confirms project exists |
| Magic-link email provider toggled ON | PROD-04 (SC#0) | Dashboard-only toggle (CLI does not flip auth providers on free tier) | `curl <project-url>/auth/v1/settings \| jq '.external.email'` returns provider config; verifier records output |
| Vercel env vars present across prod/preview/dev for both projects | PROD-04 (SC#0) | Vercel CLI requires interactive prompts for `vercel env add` (per RESEARCH.md §8) — the `vercel env ls` smoke check is automatable but the add is not | Plan task includes the exact CLI commands; verifier eyeballs `vercel env ls` output |

*Bootstrap-side manual checks are unavoidable for the one-time cloud provisioning. Feature-side checks (proxy, RLS, rate-limit, refusal) are 100% automated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command or Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (deno.json, import_map.json, shared/refusal.ts, ci.yml deno-test job)
- [ ] No watch-mode flags (`--watch`, `--ui`) in any command
- [ ] Feedback latency < 30s for the post-commit smoke
- [ ] Adversarial corpus has ≥ 50 rows (SC#3) and runs under BOTH vitest AND deno test
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills the per-task table

**Approval:** pending
