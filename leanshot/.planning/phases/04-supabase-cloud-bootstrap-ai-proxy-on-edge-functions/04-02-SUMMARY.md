---
phase: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions
plan: 02
subsystem: ai-proxy
tags: [supabase, edge-function, deno, moonshot, kimi-k2, sse, streaming, byo-key-removal, anonymous-auth]

# Dependency graph
requires:
  - phase: 04-01
    provides: "Supabase cloud project (ytnsipxxmzgaebkqmokp) + Vercel env + Function secrets + magic-link auth enabled"
  - phase: 03
    provides: "Hardened pharmacology + insights refusal — base for 04-03's shared/refusal.ts extraction"
provides:
  - "Deployed ai-chat Edge Function (Deno) — Moonshot OpenAI-compatible streaming SSE pass-through, JWT-gated"
  - "Browser Supabase singleton (src/lib/supabase.ts) with sb-leanshot-auth storage key + anonymous auth helper"
  - "src/lib/ai.ts rewritten as proxy wrapper (callAIChat) — Moonshot delta-shape SSE parsing, RateLimitedError/AIUnavailableError"
  - "Settings AI section deleted; Landing FAQ rewritten (no BYO); stale leanshot_anthropic_key cleaned at app boot"
  - "Store action: updateLastAssistant(delta) — incremental SSE-delta append for streaming UI"
  - "Test infrastructure: src/lib/supabase.test.ts, ai.test.ts, store.test.ts, SettingsPage.test.tsx — 16 new tests"
affects: [04-03, 05, 08, 09]

# Tech tracking
tech-stack:
  added: ["@supabase/supabase-js", "eventsource-parser"]
  patterns:
    - "Edge Function SSE pass-through via upstreamResp.body.tee() + EdgeRuntime.waitUntil"
    - "<user_data> XML fence in system prompt — structural separation against prompt-injection"
    - "Anonymous Supabase auth lifecycle (auth.users with is_anonymous=true) — JWT cached, reused across sends"
    - "Moonshot OpenAI-compatible Chat Completions API (not Anthropic Messages) — choices[0].delta.content delta-shape"
    - "Lazy supabase-js import via React.lazy boundary on AIChatPanel — 55.22 kB gz off the critical path"

key-files:
  created:
    - "supabase/functions/ai-chat/index.ts"
    - "supabase/functions/ai-chat/system-prompt.ts"
    - "supabase/functions/ai-chat/cors.ts"
    - "supabase/functions/ai-chat/deno.json"
    - "supabase/functions/import_map.json"
    - "leanshot/src/lib/supabase.ts"
    - "leanshot/src/lib/supabase.test.ts"
    - "leanshot/src/lib/ai.test.ts"
    - "leanshot/src/lib/store.test.ts"
    - "leanshot/src/components/dashboard/settings/SettingsPage.test.tsx"
  modified:
    - "leanshot/src/lib/ai.ts (replaced — direct Anthropic fetch → callAIChat streaming proxy wrapper)"
    - "leanshot/src/lib/storage.ts (apiKeyStorage + API_KEY_STORAGE constants deleted)"
    - "leanshot/src/lib/store.ts (added updateLastAssistant SSE-delta action)"
    - "leanshot/src/components/dashboard/settings/SettingsPage.tsx (BYO AI section + nav entry deleted)"
    - "leanshot/src/components/marketing/Landing.tsx (FAQ rewrite — no BYO copy)"
    - "leanshot/src/main.tsx (one-shot stale-key cleanup wrapped in try/catch)"
    - "leanshot/src/components/dashboard/ai/AIChatPanel.tsx (call-site swap — callAIChat + onText delta append)"
    - "leanshot/src/components/dashboard/tabs/NutritionTab.tsx (call-site swap — mode='macro-estimator')"
    - "leanshot/src/lib/analytics.ts (deleted pasted-key telemetry hooks — minor scope expansion within BYO-removal domain)"

key-decisions:
  - "Moonshot Kimi K2.6 (kimi-k2.6) replaces Anthropic Claude as the upstream model — per 04-ADDENDUM-MOONSHOT.md (mid-phase pivot)"
  - "MOONSHOT_MODEL Function secret resolves model ID server-side — no model ID in client code (D-04)"
  - "Anonymous Supabase auth (is_anonymous=true) gates the proxy — no email signup required for AI coach use (D-02)"
  - "CORS Allow-Origin: * acceptable because JWT is the auth gate (RESEARCH §2 line 1067; T-04-07 mitigated)"
  - "Refusal pre-check + rate-limit RPC + ai_messages persist deferred to 04-03 — 04-02 leaves well-marked TODO(04-03) stubs in index.ts"

patterns-established:
  - "Edge Function shape: cors.ts + system-prompt.ts + index.ts split; deno.json for lint+fmt+test discovery; import_map.json aliasing shared/* for cross-Function reuse"
  - "Browser proxy call: fetch with Bearer JWT + apikey + Accept: text/event-stream; eventsource-parser consumes choices[0].delta.content; onText callback for incremental UI append"
  - "Streaming UI: updateLastAssistant(delta) store action appends to the last assistant message in-place — no re-render-on-every-token"
  - "Threat-model mitigation as code: T-04-06 prevented by structured-error envelope `{error: 'moonshot-<status>'}` (no upstream body echo); T-04-07 deliberately wide CORS gated by JWT verification"

requirements-completed: [AI-01, AI-06]

# Metrics
duration: ~3.5h (5 tasks across deploy + UAT)
completed: 2026-05-11
next_plan: 04-03
---

# Phase 4 Plan 04-02: Proxy Skeleton Summary

**Deployed ai-chat Edge Function (Deno) — Moonshot Kimi K2.6 streaming SSE pass-through; BYO-key UX removed; founder sends a message and gets a streamed reply without ever pasting a key.**

## Performance

- **Duration:** ~3.5h end-to-end (Tasks 1-4 autonomous; Task 5 manual UAT against Vercel preview)
- **Completed:** 2026-05-11
- **Tasks:** 5/5
- **Files modified:** 26 (per `git diff --stat 50b2f09..HEAD`)
- **Lines:** +1428 / -209

## Accomplishments

- **SC#1 DELIVERED:** AI Coach panel streams a reply within ~3s — no key paste required (UAT item 1 confirmed against Vercel preview).
- **SC#2 DELIVERED:** Browser POSTs to `ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ai-chat` (not `api.moonshot.ai` directly); Edge Function logs + SSE response payload confirm model = `kimi-k2.6` (UAT items 1 + 5 + 6 + curl-smoke confirmed).
- **AI-01 DELIVERED:** Proxy live; BYO key UI removed (Settings AI section deleted, FAQ rewritten, stale-key cleanup wired into main.tsx).
- **AI-06 DELIVERED:** Current model ID resolves server-side via `MOONSHOT_MODEL` Function secret — no `claude-sonnet-4-6` (or any hardcoded model ID) in client code.
- **T-04-06 mitigated** (key-exposure-via-logs): non-2xx upstream responses wrap as `{error: 'moonshot-<status>'}`; no `r.text()` echoes in error handlers (verified by reading `supabase/functions/ai-chat/index.ts`).
- **T-04-07 accepted with documentation** (CORS-overpermissive): `Access-Control-Allow-Origin: *` is acceptable because JWT verification is the real auth gate; curl-smoke proved unauthenticated requests are 401-gated.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps + Supabase singleton + unit test** — `b210ff2` (feat)
2. **Task 2: Edge Function source + ai.ts rewrite + store action** — `57013e1` (feat)
3. **Task 3: BYO removal + FAQ + call sites + main.tsx stale-key cleanup** — `a8e3806` (feat)
4. **Task 4: Edge Function deploy + live curl-smoke green** — `ac03012` (chore)
5. **Task 5: Manual UAT — 6/6 verifications approved by user** — `5555533` (docs, --allow-empty)

**Plan metadata:** _(this SUMMARY commit, appended below)_

## Files Created/Modified

### Edge Function (new, root-level `/supabase/`)

- `supabase/functions/ai-chat/index.ts` (+251 lines) — Deno proxy: CORS preflight, JWT verification via supabase client, body validation, Moonshot OpenAI-compatible streaming SSE pass-through using `upstreamResp.body.tee()` + `EdgeRuntime.waitUntil()` to keep the Function alive past the response flush. Carries 3× `TODO(04-03)` markers (refusal pre-check, rate-limit RPC, ai_messages persist).
- `supabase/functions/ai-chat/system-prompt.ts` (+52 lines) — `buildSystemPrompt(mode: 'coach' | 'macro-estimator')`; `<user_data>` XML fence baked in for structural separation.
- `supabase/functions/ai-chat/cors.ts` (+20 lines) — `corsHeaders` constant; canonical Supabase Allow-Origin `*` + apikey allow-header pattern.
- `supabase/functions/ai-chat/deno.json` (+14 lines) — Deno lint+fmt+test config; required for `deno test` discovery in 04-03.
- `supabase/functions/import_map.json` (+5 lines) — `shared/refusal` alias to `../../shared/refusal.ts` (real `shared/refusal.ts` lands in 04-03).

### Browser-side (leanshot/)

- `leanshot/src/lib/supabase.ts` (+47 lines, new) — Browser singleton: `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` with `storageKey: 'sb-leanshot-auth'`.
- `leanshot/src/lib/ai.ts` (+174 lines, replaced) — `callAIChat({messages, mode, onText, signal, userContext?})`; Moonshot/OpenAI SSE delta-shape consumer via eventsource-parser; ensures anonymous session before send; surfaces `RateLimitedError` + `AIUnavailableError` instead of `MissingAPIKeyError`.
- `leanshot/src/lib/storage.ts` (-28 lines) — `apiKeyStorage` + `API_KEY_STORAGE` constants deleted.
- `leanshot/src/lib/store.ts` (+16 lines) — `updateLastAssistant(delta)` action — appends to the last assistant message in-place.
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx` (-62 lines) — entire `section === 'ai'` block + nav entry deleted; ApiKeyInput component removed.
- `leanshot/src/components/marketing/Landing.tsx` (4 lines changed) — FAQ rewrite at lines 474 + 486: "through our secure server using your account" + "AI coaching is included — no separate API key".
- `leanshot/src/main.tsx` (+10 lines) — one-shot `localStorage.removeItem('leanshot_anthropic_key')` wrapped in try/catch at app boot; D-03 migration cleanup for existing users.
- `leanshot/src/components/dashboard/ai/AIChatPanel.tsx` (54 lines changed) — call-site swap: `callAIChat({onText: (delta) => updateLastAssistant(delta), signal: abortController.signal})`.
- `leanshot/src/components/dashboard/tabs/NutritionTab.tsx` (18 lines changed) — call-site swap: `callAIChat({mode: 'macro-estimator', onText: (delta) => buffer += delta})`.
- `leanshot/src/lib/analytics.ts` (-2 lines) — deleted pasted-key telemetry hooks.
- `leanshot/package.json` + `package-lock.json` — added `@supabase/supabase-js` + `eventsource-parser`.

### Tests (new, +347 lines)

- `leanshot/src/lib/supabase.test.ts` (+49 lines) — singleton + storage key assertions.
- `leanshot/src/lib/ai.test.ts` (+183 lines) — callAIChat SSE-delta parsing, RateLimitedError surfacing, AIUnavailableError mapping, signal abort propagation.
- `leanshot/src/lib/store.test.ts` (+61 lines) — updateLastAssistant delta-append semantics.
- `leanshot/src/components/dashboard/settings/SettingsPage.test.tsx` (+54 lines) — confirms AI section is gone, no key input rendered.

## Decisions Made

(Pulled forward from STATE.md and the addendum — restated here for plan-local traceability.)

1. **Moonshot Kimi K2.6 replaces Anthropic Claude** as the upstream model — per `04-ADDENDUM-MOONSHOT.md` and RESEARCH §14. Edge Function calls `https://api.moonshot.ai/v1/chat/completions` (OpenAI-compatible), not Anthropic Messages. Variable naming uses neutral `upstreamResp`/`upstreamReq` rather than `anthropicResp`. Commits `9151f22` + `bc86b6c` already locked this in 04-01.

2. **Anonymous Supabase auth** (D-02): first AI send mints an `auth.users` row with `is_anonymous = true`; subsequent sends reuse the cached JWT. No email signup required for AI coach use. Magic-link auth provider stays enabled for Phase 5 readiness but isn't yet UI-wired.

3. **CORS `Access-Control-Allow-Origin: *`** is acceptable because JWT verification is the auth gate (RESEARCH §2 line 1067). T-04-07 documented as mitigated-by-design. Curl-smoke verifies unauthenticated requests return 401.

4. **Refusal + rate-limit + ai_messages persist deferred to 04-03** — 04-02's `index.ts` carries 3× `TODO(04-03)` markers at the exact insertion points (refusal pre-check after JSON parse; rate-limit RPC call before upstream fetch; persist hook in the EdgeRuntime.waitUntil block).

5. **Lazy-loaded supabase-js** behind the AIChatPanel React.lazy boundary — 55.22 kB gz off the critical path. AI bundle chunk `ai-BRS3CGBf.js` confirms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Moonshot pivot applied throughout plan body**
- **Found during:** Pre-Task 1 (plan body still referenced Anthropic Messages API at points)
- **Issue:** Plan referenced Anthropic Messages API in places after 04-ADDENDUM-MOONSHOT.md was authored — Edge Function had to call Moonshot's OpenAI-compatible endpoint, not Anthropic's, to be functionally correct
- **Fix:** Plan + addendum + RESEARCH §14 carry the Moonshot variant; Edge Function source uses `upstreamResp` naming, `choices[0].delta.content` delta-shape parsing, `Authorization: Bearer ${MOONSHOT_API_KEY}` header
- **Files modified:** `supabase/functions/ai-chat/index.ts`, `leanshot/src/lib/ai.ts`, 04-RESEARCH.md, 04-VALIDATION.md
- **Verification:** Live curl-smoke returns SSE stream with `"model": "kimi-k2.6"` in every frame
- **Committed in:** `9151f22` + `bc86b6c` (locked in by 04-01) + reused throughout `b210ff2`, `57013e1`, `ac03012`

**2. [Rule 3 - Blocking] `supabase functions logs --since` not supported on CLI v2.98.2**
- **Found during:** Task 4 (deploy + verify)
- **Issue:** Verification step called `supabase functions logs ai-chat --since 1h` but the `--since` flag doesn't exist on the installed CLI version
- **Fix:** Used Supabase Dashboard UI log inspector instead (`https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/functions/ai-chat/logs`); additionally verified model ID via the SSE response payload itself (every frame carries `model: "kimi-k2.6"`)
- **Files modified:** None (verification-path change)
- **Verification:** SSE payload + dashboard logs both confirm model ID
- **Committed in:** `ac03012` (Task 4 commit captures the dashboard-verification path)

**3. [Rule 1 - Bug] `analytics.ts` pasted-key telemetry hooks touched alongside Task 3**
- **Found during:** Task 3 (BYO removal sweep)
- **Issue:** Plan listed Settings + Landing + storage + main.tsx as the BYO-removal surface, but `analytics.ts` also carried hooks that fired on pasted-key events — leaving them in would create dead-code reference + emit zero-valued events
- **Fix:** Deleted the 2 telemetry hooks; minor scope expansion within the BYO-removal domain
- **Files modified:** `leanshot/src/lib/analytics.ts`
- **Verification:** lint + typecheck green; no broken imports
- **Committed in:** `a8e3806` (Task 3 commit)

**4. [Rule 3 - Blocking] Moonshot Tier 1 recharge real prerequisite before Task 4**
- **Found during:** Pre-Task 4
- **Issue:** Moonshot Tier 0 = 3 RPM — would have throttled the curl-smoke verification mid-deploy
- **Fix:** User confirmed $19 in account before Task 4 dispatch (Tier 1 = 200 RPM); curl-smoke completed without throttling
- **Files modified:** None (operational gating)
- **Verification:** Curl-smoke 2/2 green (401 unauth + 200 + SSE auth)
- **Committed in:** N/A (operational, not code)

---

**Total deviations:** 4 auto-fixed (1 critical correctness, 2 blocking, 1 bug-cleanup)
**Impact on plan:** All four were essential for the proxy to actually function (Moonshot pivot), for verification to complete (CLI flag missing + tier recharge), and for hygiene (analytics dead-code). No scope creep into 04-03 territory — the TODO(04-03) markers remain unchanged.

## Threats Mitigated (per `<threat_model>`)

| ID | Threat | Mitigation | Verified |
|----|--------|------------|----------|
| T-04-06 | Key exposure via error logs | Edge Function wraps non-2xx upstream as `{error: 'moonshot-<status>'}`; no `r.text()` body echo | Read `supabase/functions/ai-chat/index.ts` error handlers; structured envelope verified |
| T-04-07 | CORS over-permissive | Allow-Origin `*` is acceptable because JWT verification is the real auth gate (RESEARCH §2 line 1067) | Curl-smoke: unauthenticated request returns 401 |

## Threats Partially Set Up — Plan 04-03 Closes

| ID | Threat | 04-02 setup | 04-03 closure |
|----|--------|-------------|---------------|
| T-04-01 | Prompt-injection refusal | 3× `TODO(04-03)` markers in `index.ts`; `<user_data>` XML fence in system prompt | Wire refusal pre-check via shared/refusal.ts + adversarial corpus |
| T-04-04 | Cross-tenant data leak | Integrity-invariant comment-stub in place: `user.id` derived from JWT, not request body | Real `ai_messages.insert` with RLS + cross-tenant e2e test |

## Success Criteria Progress

| SC | Status | Evidence |
|----|--------|----------|
| SC#1 — chat works without paste-key | **DELIVERED** | UAT item 1 confirmed: Coach streams reply within ~3s |
| SC#2 — network goes to /functions/v1/ai-chat with current model ID | **DELIVERED** | UAT items 1 + 5 + 6 + curl-smoke; model = `kimi-k2.6` |
| SC#3 — adversarial refusal corpus | Deferred | 04-03 |
| SC#4 — rate-limit at 100/min | Deferred | 04-03 |
| SC#5 — ai_messages RLS cross-tenant | Deferred | 04-03 |

## Test Status

- **Vitest:** 193/193 passing (Phase 3 baseline 177 preserved; +16 new tests across supabase.test.ts, ai.test.ts, store.test.ts, SettingsPage.test.tsx)
- **Lint:** 0 errors (5 pre-existing warnings — out of scope per executor-rules)
- **Typecheck:** 0 errors
- **Build:** SPA + marketing both green; SPA gz 312.6 kB (under 320 ceiling per Phase 2.1); marketing 106.21 kB gz
- **Live curl-smoke:** 2/2 (401 unauth ✓; 200 + text/event-stream + Moonshot SSE frame with `"model": "kimi-k2.6"` ✓)
- **Live UAT:** 6/6 verifications passed by user against Vercel preview

## Greppable Anchors (for 04-03 + future audit)

- `5× TODO(04-03)` markers in `supabase/functions/ai-chat/index.ts` (refusal pre-check + rate-limit RPC + ai_messages persist)
- `<user_data>` fence in `supabase/functions/ai-chat/system-prompt.ts`
- `upstreamResp.body.tee()` + `EdgeRuntime.waitUntil()` in `index.ts`
- `MOONSHOT_MODEL` Function-secret reference (model ID never in client code)
- Zero active references in `src/` to `callAnthropic`, `MissingAPIKeyError`, `apiKeyStorage`, `API_KEY_STORAGE` (verified via grep)
- `kimi-k2.6` literal does not appear in `leanshot/src/` — resolves server-side only

## Issues Encountered

- **Moonshot pivot mid-phase** (Anthropic → Moonshot) — addressed by 04-ADDENDUM-MOONSHOT.md + RESEARCH §14 rewrite (commits 9151f22, bc86b6c). All variable naming + payload shape updated before Task 1.
- **CLI version mismatch** on `--since` flag — workaround via dashboard UI; not a code-level issue.
- **Tier 0 RPM throttling risk** on Moonshot pre-deploy — user recharged Tier 1 before Task 4.

## User Setup Required

None for 04-02 closure (Tasks 1-4 + UAT all complete). Plan 04-03 will require:
- `[BLOCKING] supabase db push` (user must approve before migrations land)
- CI workflow update for the `deno test` job

## Outstanding for Plan 04-03

- Extract `shared/refusal.ts` at repo root — verbatim move from `src/lib/insights-refusal.ts` preserving CR-01 + CR-02 fixes per `04-PATTERNS.md`
- Author `shared/refusal.test.ts` (50+ adversarial corpus, vitest) + `supabase/functions/tests/ai-chat-refusal-test.ts` (mirror corpus, deno test)
- SQL migrations: `ai_messages` + `rate_limit_counters` tables with RLS; `increment_rate_limit` security-definer RPC; pg_cron anon-row cleanup (30-day retention, daily 03:00 UTC)
- Wire the 3× `TODO(04-03)` hooks in `supabase/functions/ai-chat/index.ts`: refusal pre-check, rate-limit RPC call, `ai_messages` persist (user + assistant via `captureAndPersist` OpenAI-delta extractor)
- `[BLOCKING] supabase db push` from repo root
- CI deno-test job in `.github/workflows/ci.yml` with `--allow-net=api.moonshot.ai`
- Live verification: cross-tenant RLS test (`e2e/rls-ai-messages.test.ts`), rate-limit load test (`scripts/load-rate-limit.sh`)

## Next Phase Readiness

- **Plan 04-03 (Hardening):** unblocked. All structural hooks are in place (TODO markers, `<user_data>` fence, anonymous-auth lifecycle, JWT verification on the Function). 04-03 wires behavior into the existing skeleton — no architectural changes needed.
- **Phase 5 (Patient Cloud Sync):** indirect prerequisite (auth lifecycle) is now exercised in production via the anonymous-auth path. Magic-link auth provider is toggled on and waiting for UI in Phase 5.

## Self-Check: PASSED

Verified before writing:
- All 5 task commits exist in `git log`: b210ff2 ✓, 57013e1 ✓, a8e3806 ✓, ac03012 ✓, 5555533 ✓
- Edge Function source exists: `supabase/functions/ai-chat/index.ts` ✓
- Browser singleton exists: `leanshot/src/lib/supabase.ts` ✓
- Tests exist: ai.test.ts ✓, supabase.test.ts ✓, store.test.ts ✓, SettingsPage.test.tsx ✓
- BYO removal verified by prior executor: zero active `apiKeyStorage` references in `src/`

---
*Phase: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions*
*Plan: 02 — Proxy Skeleton*
*Completed: 2026-05-11*
*Next plan: 04-03 — Hardening*
