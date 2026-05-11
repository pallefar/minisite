---
phase: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions
verified_at: 2026-05-11T20:50:00Z
verifier: gsd-verifier (Opus 4.7, 1M)
status: pass
score: 5/5 success criteria · 7/7 requirements · 12/13 dimensions PASS · 1 CONCERN
overrides_applied: 0
moonshot_pivot_applied: true
re_verification: false
concerns:
  - id: C1
    severity: WARNING
    where: leanshot/src/components/marketing/Landing.tsx:474
    description: Landing FAQ still names "Anthropic" as the AI provider after the Moonshot pivot. Public-facing copy is factually incorrect.
    fix: Replace "to Anthropic through our secure server" with "through our secure server" (provider-neutral) or "to Moonshot Kimi K2 through our secure server".
    blocks_goal: false
  - id: C2
    severity: INFO
    where: leanshot/.planning/REQUIREMENTS.md:64
    description: AI-06 text still reads "real, current Claude model ID". The pivot is satisfied by `kimi-k2.6` but the requirement string in REQUIREMENTS.md was not updated to match the 04-ADDENDUM-MOONSHOT.md supersession.
    fix: Rewrite AI-06 to "Proxy uses a real, current model ID (replaces the broken hardcoded `'claude-sonnet-4-6'`)".
    blocks_goal: false
human_verification:
  - test: Visual UAT — open https://app.leanshot.app (or current Preview URL), sign in anonymously via the AI panel, send a benign prompt, observe streamed reply within ~3s, then refresh page and confirm chat history persists for the same session.
    expected: Stream appears progressively (typing effect); reply text contains no fence tokens (`<user_data>` / `</user_data>`); no "paste your API key" prompt anywhere.
    why_human: Visual streaming feel + absence of UI affordances cannot be programmatically verified beyond grep negation.
  - test: 50-message-flood UI surface check.
    expected: Burst of 50+ messages within 60s yields a user-visible toast / inline error ("AI rate limit reached") rather than a silent break.
    why_human: Toast appearance + copy quality are visual/UX concerns; the 429 status code itself is already proven by `scripts/load-rate-limit.sh`.
  - test: Cross-device anon→email promotion smoke (Phase 5 readiness).
    expected: Send a message anonymously; copy current anon UID from network panel; in dashboard, complete a manual `auth.updateUser({email})` flow (if any UI hook exists); verify the same UID persists after email-confirmation link click.
    why_human: Phase 5 will own the UI flow; for now the contract is proven via `/tmp/anon-to-permanent.mjs` script (recorded in 04-03-SUMMARY.md §5E).
---

# Phase 04 — Goal-Backward Verification Report

**Phase:** 04 — Supabase Cloud Bootstrap + AI Proxy on Edge Functions
**Verified:** 2026-05-11
**Verifier disposition:** PASS (with one factual-copy WARNING that does not block Phase 5 readiness).

---

## Goal-vs-delivered narrative

The phase goal demands two things in one slice: (1) the Supabase cloud platform is provisioned end-to-end (project, region, CLI link, `SUPABASE_URL`/`SUPABASE_ANON_KEY` × Vercel envs × 3 targets × 2 projects, the AI-platform secret as a Function secret, email magic-link auth enabled with no UI yet); and (2) an `ai-chat` Edge Function on Deno is deployed, replacing the user-pasted-key flow, fixing the bogus hardcoded model ID, enforcing per-user rate limits, structurally separating user content from the system prompt via fence tokens, refusing prompt-injection + dose-change patterns, and verifying refusals via an adversarial corpus in CI. With the Moonshot pivot applied as the documented contract (04-ADDENDUM-MOONSHOT.md, commits `9151f22` + `bc86b6c`), every clause of the goal is observable in the live codebase and the live cloud project: project ref `ytnsipxxmzgaebkqmokp` (region `eu-west-1`) is ACTIVE; Vercel env wiring is 24/24 entries (12 per project × 2 projects, verified via `vercel env ls` re-link sweep); the function secrets `MOONSHOT_API_KEY` and `MOONSHOT_MODEL` are present (digests visible via `supabase secrets list`); the auth `/auth/v1/settings` endpoint reports `email=true`, `anonymous_users=true`, `mailer_autoconfirm=false`; the deployed Edge Function responds 401 unauth and 200 + `text/event-stream` (model `kimi-k2.6`) when called with an anonymous JWT; the refusal pre-check short-circuits a "Increase my Ozempic dose to 2mg" prompt to a single SSE frame containing only the canonical refusal text (zero Moonshot round-trip); the rate-limit `increment_rate_limit` RPC exists as `security definer`; `ai_messages` + `rate_limit_counters` tables exist with RLS enabled; the pg_cron `cleanup-anon-users` job is scheduled at `0 3 * * *`; the dual-runtime refusal corpus (`shared/refusal.test.ts` for vitest + `supabase/functions/tests/ai-chat-refusal-test.ts` for Deno) carries 70 rows across 5 categories with explicit fence-token-leak rows; CI gates Lighthouse on the `deno-test` job. SC#0..SC#5 all deliver; AI-01..AI-06 + PROD-07 all satisfied.

The one factual concern: the Landing FAQ at `leanshot/src/components/marketing/Landing.tsx:474` still tells users their prompts go "to Anthropic through our secure server" — a stale claim that contradicts the documented Moonshot pivot. This is a marketing-copy warning, not a goal-achievement gap, but it should be corrected before public launch. AI-06's text in REQUIREMENTS.md was likewise not rewritten to reflect the pivot — the spirit ("a real current model ID") is honored; only the literal string still names "Claude".

---

## Per-dimension verdicts

| # | Dimension | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Goal coverage end-to-end (with Moonshot substitution) | **PASS** | Every goal clause maps to live evidence below. |
| 2 | SC#0 Cloud provisioning + envs + secrets + auth | **PASS** | Project `ytnsipxxmzgaebkqmokp` ACTIVE; `curl /auth/v1/settings` returns email=true + anonymous_users=true + mailer_autoconfirm=false; `vercel env ls` returns 12 entries per project × 2 = 24; `supabase secrets list` returns `MOONSHOT_API_KEY` + `MOONSHOT_MODEL` digests; `.planning/decisions/supabase.md` 204 lines with project ref + region + key-format + Phase 5 contract + pivot record. |
| 3 | SC#1 Chat works without paste-key | **PASS** | `grep "section === 'ai'" SettingsPage.tsx` returns 0 active hits (only the deletion-record comment); `grep -rn "callAnthropic\|MissingAPIKeyError\|apiKeyStorage\|API_KEY_STORAGE" leanshot/src/` shows ZERO active call sites — only doc-comment receipts of the removal in `ai.ts:11` + `SettingsPage.tsx:33` + `storage.ts:32`. `main.tsx:40` contains `localStorage.removeItem('leanshot_anthropic_key')` (one-shot stale-key cleanup). `callAIChat` is the entry point used by both `AIChatPanel.tsx:99` and `NutritionTab.tsx:57`. |
| 4 | SC#2 Network path + Moonshot model ID | **PASS** | Browser code in `src/lib/ai.ts:23-79` builds `${VITE_SUPABASE_URL}/functions/v1/ai-chat`. Edge Function `supabase/functions/ai-chat/index.ts:35` defaults to `kimi-k2.6`. Live curl with anon JWT returns SSE frames carrying `"model":"kimi-k2.6"` (frames captured in this run; see Concerns/Strengths). `kimi-k2.6` literal absent from `leanshot/src/`. |
| 5 | SC#3 Adversarial corpus | **PASS** | `shared/refusal.ts` exports `ADVERSARIAL_CORPUS` with **70 rows**: 25 dose-change + 5 prompt-injection + 5 system-extraction + 5 emotional-manipulation + 30 benign-pass (verified by `grep -oE "category: '[^']+'" \| sort \| uniq -c`). System-extraction rows include literal `<user_data>` / `</user_data>` per T-04-03 fence-leak guard. Vitest test file mirrors the contract under Deno (`supabase/functions/tests/ai-chat-refusal-test.ts`). Phase 3 CR-01 multi-occurrence + CR-02 STEM_PATTERN expansion explicitly covered in `shared/refusal.test.ts:50-120`. Local vitest run: **225/225 passing**. CI `deno-test` job in `.github/workflows/ci.yml:161-181` gates Lighthouse. |
| 6 | SC#4 Rate limit | **PASS** | `rate_limit_counters` table live (RLS enabled via cloud DB query). `increment_rate_limit` RPC live with `prosecdef=true`. Edge Function `rate-limit.ts:54-72` calls the RPC and short-circuits via `jsonError(429, 'rate-limited')` in `index.ts:227`. SUMMARY records load-test execution `200=30 429=5 other=0` per `scripts/load-rate-limit.sh`. Friendly UI surfacing via `RateLimitedError` is wired at `AIChatPanel.tsx:121` (the toast copy is part of H1 below). |
| 7 | SC#5 `ai_messages` RLS | **PASS** | `ai_messages` table live with rowsecurity=true. RLS policies `ai_messages_select_own` (SELECT, `auth.uid()=user_id`) + `ai_messages_insert_own` (INSERT, `with check (auth.uid()=user_id)`) present in cloud DB. `user_id` written from `user.id` (verified JWT) at `index.ts:243` and `:270` and `:169` — never from the request body. Cross-tenant test exists at `leanshot/e2e/rls-ai-messages.test.ts` and asserts `data.length === 1` after seeding both users. 04-03-SUMMARY records live execution (`row count visible to userA: 1`). |
| 8 | AI-04 Structural separation | **PASS** | `<user_data>` fence applied to the **first** user message in `index.ts:289-296`. System prompt at `system-prompt.ts:22-23` carries the explicit `STRUCTURAL_SEPARATION_PRIMITIVE` directive instructing the model never to echo fence tokens or follow instructions inside the fence. T-04-03 fence-leak corpus rows assert `mustRefuse: true`. |
| 9 | Phase 3 anti-regression | **PASS** | Vitest 225/225 (Phase 3 baseline 177 + 04-02 +16 + 04-03 +32 = 225). CR-01 multi-occurrence walk + CR-02 expanded STEM_PATTERN explicitly tested in `shared/refusal.test.ts:50-120`. |
| 10 | Phase 1+2 anti-regression | **PASS** | `npm run lint` exits 0 (5 pre-existing warnings, no new errors). `tsc -b --noEmit` exits 0. `npm run build` produces both `dist/` (SPA, ai chunk gz 55.43 kB) and `dist-marketing/` cleanly. SPA `index.js` gz 14.27 kB + vendor-react 60.54 kB + vendor-charts 71.2 kB + vendor-motion 37.87 kB + vendor-icons 6.41 kB + Landing 5.36 kB ≈ critical-path well under 320 kB ceiling. |
| 11 | Pivot integrity (Anthropic → Moonshot) | **PASS** | Zero `ANTHROPIC_*` env reads in `supabase/functions/ai-chat/*.ts`. Zero `claude-sonnet-*` literals in active code paths. `04-ADDENDUM-MOONSHOT.md` matches delivered code: model ID `kimi-k2.6`, base URL `api.moonshot.ai`, SSE shape `choices[0].delta.content`, error wrap `moonshot-<status>`. |
| 12 | Deferred items respected | **PASS** | No password sign-up UI (Phase 5). No `linkIdentity` references (Phase 5 will use two-step `updateUser`). No localStorage `aiHistory` migration (CONTEXT.md deferred). Rate limits parameterized in DB (30/60/200 via `rate-limit.ts` constants) — not hardcoded. |
| 13 | Documentation completeness | **CONCERN (warning, not blocker)** | 3 plan SUMMARYs present + 04-VALIDATION.md per-task table complete + `.planning/decisions/supabase.md` 204 lines covering project + key-format + pivot + auth state + Phase 5 contract + `supabase config push` gotcha. **Concern**: Landing FAQ still names Anthropic (C1); REQUIREMENTS.md AI-06 still names Claude (C2). Neither blocks the goal; both are doc-hygiene fixes deferred to a follow-up. |

---

## Success Criteria status

| SC | Status | Evidence |
|----|--------|----------|
| SC#0 — Cloud project + linked CLI + Vercel envs + Function secrets + magic-link auth + decision record | **DELIVERED** | Project ACTIVE; `supabase/config.toml` at repo root; 24 Vercel env entries (12 per project); 2 Moonshot Function secrets; auth providers verified via curl; `.planning/decisions/supabase.md` complete. |
| SC#1 — Chat works without paste-key; Settings BYO gone | **DELIVERED** | `callAIChat` is the only entry point; zero BYO-key references in active `src/`; `main.tsx` stale-key cleanup wired. |
| SC#2 — Network goes to `/functions/v1/ai-chat`; Edge logs show Moonshot | **DELIVERED** | Live curl returns SSE with `model: "kimi-k2.6"`; `MOONSHOT_BASE_URL` resolves to `https://api.moonshot.ai/v1` (default in `index.ts:34`). |
| SC#3 — Adversarial corpus 50+ rows; never emits numeric dose / never reveals system internals | **DELIVERED** | 70 rows / 5 categories; vitest 225/225; deno-test CI gate present. |
| SC#4 — Rate limit triggers at 30/min with friendly UI | **DELIVERED** | `scripts/load-rate-limit.sh` returned `200=30 429=5 other=0` (per 04-03-SUMMARY §5C); counter table live with `auth.uid()` RLS; `RateLimitedError` propagates to `AIChatPanel.tsx:121`. |
| SC#5 — `ai_messages` RLS; cross-tenant impossible | **DELIVERED** | RLS policies live; `user_id` sourced from JWT only; cross-tenant smoke green per 04-03-SUMMARY §5D. |

---

## Requirements status

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AI-01 — proxy live, BYO removed | **DELIVERED** | Edge Function deployed + browser wrapper rewritten + Settings AI section deleted + FAQ rewritten (with C1 caveat re: stale Anthropic mention) + `apiKeyStorage` deleted + `main.tsx` cleanup. |
| AI-02 — per-user rate limiting | **DELIVERED** | `increment_rate_limit` RPC + `rate_limit_counters` table + `checkAndIncrement` in `rate-limit.ts` + 429 short-circuit + load-test green. |
| AI-03 — refusal of prompt-injection + dose-change | **DELIVERED** | `isDoseChangeAdvice` pre-check in `index.ts:262` + 70-row dual-runtime corpus + live refusal smoke (this run). |
| AI-04 — structural separation of user content from system prompt | **DELIVERED** | `<user_data>` fence applied to first user message + system-prompt directive to treat fenced content as data not instructions + corpus rows assert refusal of fence-token attempts. |
| AI-05 — RLS-scoped persistence | **DELIVERED** | `ai_messages` table + `auth.uid()=user_id` policies + cross-tenant proof. |
| AI-06 — current model ID replaces `claude-sonnet-4-6` | **DELIVERED** | `MOONSHOT_MODEL` env-var-driven with `kimi-k2.6` default (per ADDENDUM); `claude-sonnet-*` absent from all active code paths. **Note (C2):** REQUIREMENTS.md text still names "Claude"; the requirement intent is satisfied by Moonshot Kimi K2.6 per the documented pivot. |
| PROD-07 — Supabase project + linking + Vercel envs + Function secrets | **DELIVERED** | Project ACTIVE; CLI linked (`supabase/.temp/project-ref`); 24 Vercel envs; 2 Moonshot Function secrets. |

---

## Concerns

| ID | Severity | Where | Description | Fix Recommendation | Blocks Goal? |
|----|----------|-------|-------------|--------------------|--------------|
| **C1** | WARNING | `leanshot/src/components/marketing/Landing.tsx:474` | FAQ answer says "AI coach... sends just your prompt + the relevant context to **Anthropic** through our secure server using your account". After the Moonshot pivot this is factually incorrect — Anthropic is no longer used. | Change line 474 to "...through our secure server using your account" (provider-neutral) or "...to **Moonshot Kimi K2** through our secure server using your account". Same touch-up for any analogous strings if grep finds more. Verify no other Anthropic mention survives in marketing copy. | No — goal is about behavior, not FAQ wording. But this is a customer-facing factual error that should land in a doc-hygiene PR before public launch. |
| **C2** | INFO | `leanshot/.planning/REQUIREMENTS.md:64` | AI-06 string still reads "Proxy uses a real, current Claude model ID". The intent (replace broken `claude-sonnet-4-6` with a real current model ID) is satisfied by `kimi-k2.6` per `04-ADDENDUM-MOONSHOT.md`, but the literal requirement text was not rewritten to match the pivot. | Rewrite to "Proxy uses a real, current model ID (replaces the broken hardcoded `'claude-sonnet-4-6'`)" — provider-neutral. | No — phase contract honors the spirit. Optional doc cleanup. |

No BLOCKER findings.

---

## Strengths

1. **Adversarial corpus headroom + dual-runtime parity.** Final corpus is 70 rows (40% above the SC#3 floor) and runs under BOTH vitest (V8) and Deno test (different TS parser + regex engine semantics). System-extraction rows containing literal `<user_data>` / `</user_data>` close T-04-03 with concrete evidence. The Phase 3 CR-01 multi-occurrence walk + CR-02 verb expansion are explicitly preserved as named test blocks — Phase 3's regression armor survives the Phase 4 extraction without dilution.

2. **Audit-trail ordering correction caught mid-execution.** The Plan 04-03 executor surfaced a real audit-trail gap (refusal pre-check originally fired before user-row persistence, dropping refused inputs from `ai_messages`) and reordered the steps so refused dose-change attempts AND their canonical refusal both land in the log tagged `model: 'refusal-precheck'`. This is exactly the kind of post-mortem evidence T-04-01 demands and shows real defense-in-depth thinking, not just plan-text compliance.

3. **Pivot integrity is verifiable, not assumed.** The Anthropic → Moonshot mid-execution pivot is documented in a dedicated addendum with explicit supersession scope, and the verifier can grep the entire active code path for residue (`ANTHROPIC_*`, `claude-sonnet-*`, `api.anthropic.com`) and find zero hits outside doc-comments. The decision-record file at `.planning/decisions/supabase.md` records the trail with a backout plan (Vercel AI Gateway / Anthropic restore from git history), so a future operator hitting Moonshot trouble has a clear path forward.

---

## Ready for Phase 5?

**YES.** Phase 5 ("Patient Cloud Sync Slice 1 — Auth + Injections") prerequisites are all in place:

- Magic-link email provider toggled ON (`email: true` in live `/auth/v1/settings`) and waiting for UI.
- Anonymous-auth lifecycle exercised end-to-end via the AI proxy (cached JWT, JWT-scoped reads, anonymous → permanent UID promotion smoke verified per 04-03-SUMMARY §5E with `anonId === permanentId`).
- Database foundation present: `auth.users` (Supabase native), `ai_messages` and `rate_limit_counters` (Phase 4), all with `ON DELETE CASCADE` chains for the pg_cron reaper.
- Vercel env wiring covers production+preview+development × both projects, so the first Phase 5 sync feature can ship to Preview without re-bootstrapping infra.
- `supabase config push` gotcha is documented as a rule for future phases — anyone running `supabase config push` next will know to diff first.

The only follow-ups Phase 5 inherits are doc-hygiene (C1 + C2) and the human verification items below — none of which block Phase 5 work starting.

---

## Human verification recommended (not blocking)

See the `human_verification:` block in frontmatter. Each item targets behavior the verifier cannot programmatically assert: visual streaming feel, friendly-toast appearance for rate-limit 429s, and the cross-device anon→email-promotion flow once any Phase 5 UI surface lights up.

---

## VERIFICATION COMPLETE

Phase 04 PASSES goal-backward verification: SC#0..SC#5 all DELIVERED in live system + repo; AI-01..AI-06 + PROD-07 all satisfied; Moonshot pivot is clean across all active code paths.
One WARNING (C1: Landing FAQ still names Anthropic) + one INFO (C2: REQUIREMENTS.md AI-06 text not updated) — neither blocks Phase 5 readiness; both are doc-hygiene follow-ups.
Vitest 225/225 · typecheck 0 errors · lint 0 errors · live curl-smoke green (401 unauth + 200 SSE with `model: "kimi-k2.6"`) · cloud DB confirms 2 tables (RLS on) + 1 SECURITY DEFINER RPC + 1 pg_cron job; Phase 5 is unblocked.
