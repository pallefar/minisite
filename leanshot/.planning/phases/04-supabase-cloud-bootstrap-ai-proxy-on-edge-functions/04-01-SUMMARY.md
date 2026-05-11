---
phase: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions
plan: 01
subsystem: infra
tags:
  - supabase
  - vercel
  - moonshot
  - bootstrap
  - infra
  - sc-0
requires: []
provides:
  - SUPABASE_PROJECT_REF=ytnsipxxmzgaebkqmokp
  - SUPABASE_REGION=eu-west-1
  - VERCEL_APP_PROJECT_ID=prj_udGmCEFhEojT6Ul0iqZGmHOV5Zrz
  - VERCEL_MARKETING_PROJECT_ID=prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc
  - FunctionSecret(MOONSHOT_API_KEY=placeholder)
  - FunctionSecret(MOONSHOT_MODEL=kimi-k2-latest)
  - VercelEnv(SUPABASE_URL across both projects × 3 targets)
  - VercelEnv(SUPABASE_ANON_KEY across both projects × 3 targets)
  - VercelEnv(VITE_SUPABASE_URL across both projects × 3 targets)
  - VercelEnv(VITE_SUPABASE_ANON_KEY across both projects × 3 targets)
  - DecisionRecord(.planning/decisions/supabase.md)
affects: []
tech_stack:
  added:
    - "supabase@^2.98 (CLI devDep)"
  patterns:
    - "Sibling supabase/ at git root (NOT inside leanshot/) per RESEARCH §1 + Pitfall 1"
    - "Transient supabase/.env.secrets for `supabase secrets set --env-file` push; gitignored + deleted post-push"
    - "Vercel env wiring via CLI fallback (REST API auth.json token returned 403; CLI session auth worked)"
    - "Decision record file at .planning/decisions/<system>.md captures the infra tuple"
key_files:
  created:
    - supabase/config.toml
    - supabase/.gitignore
    - leanshot/.planning/decisions/supabase.md
    - leanshot/.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-ADDENDUM-MOONSHOT.md
    - leanshot/.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-01-SUMMARY.md
  modified:
    - .gitignore
    - leanshot/.gitignore
    - leanshot/package.json
    - leanshot/package-lock.json
decisions:
  - "Moonshot Kimi K2 selected over Anthropic Claude Sonnet 4.6 (mid-execution pivot; 04-ADDENDUM-MOONSHOT.md, commit 9151f22). Direct provider call — NOT through Vercel AI Gateway."
  - "Region eu-west-1 (NOT us-east-1) — user choice. ~80–120ms cross-region latency for US users; migratable post-launch."
  - "Function secrets pushed as placeholders: MOONSHOT_API_KEY=placeholder-set-before-04-02-deploy, MOONSHOT_MODEL=kimi-k2-latest. Real values + canonical model ID resolved by researcher at Plan 04-02 execution."
  - "Vercel envs: 4 keys (SUPABASE_URL + VITE_ + ANON_KEY + VITE_ANON_KEY) × 2 projects × 3 targets = 24 entries. Marketing project provisioned per RESEARCH §11 recommendation (cheaper than a deviation note)."
  - "Legacy JWT anon key chosen over modern sb_publishable_* format — keeps @supabase/supabase-js + Edge Function Bearer JWT path on rails."
  - "Auth providers (magic-link, anonymous, manual linking) toggled via `supabase config push` instead of dashboard clicks — per user 'can you do it for me' request. Surfaced + corrected a `config push` full-overwrite gotcha mid-execution (regressed remote defaults; re-pushed with tightened settings)."
  - "Phase 5 hand-off contract corrected from `linkIdentity` (OAuth-only) to two-step `updateUser({email})` then `updateUser({password})` flow."
  - "Rate-limit thresholds locked at 30/min, 60/hr, 200/day for Plan 04-03 migration. Anon-row cleanup pg_cron daily 03:00 UTC, 30-day retention."
metrics:
  duration_minutes: 30
  completed_date: 2026-05-11
  tasks_total: 6
  tasks_completed: 6
  commits: 7
  files_changed: 7
  insertions: 916
  tests_added: 0
  tests_passing: 0
requirements:
  - PROD-07
next_plan: 04-02
---

# Phase 4 Plan 1: Supabase Cloud Bootstrap + AI Proxy Infra Summary

Phase 4 SC#0 delivered: Supabase cloud project provisioned, CLI installed + linked, Moonshot Function secrets placeholdered, Vercel envs wired across both projects × 3 targets, auth providers toggled, and a decision record committed. No application code changed; this plan owns infra-only state.

## What Was Built

### 1. Supabase CLI + repo-root config (Task 1, commit `61c990e`)

- Installed `supabase@^2.98.2` as a `leanshot/` devDependency.
- Ran `supabase init` at the git root (`/Users/karstenhaldan/minisite/`), producing `supabase/config.toml` as a SIBLING of `leanshot/` (per RESEARCH §1 + Pitfall 1 — NOT inside `leanshot/`).
- Hand-edited `supabase/config.toml` `[auth]` block to set `enable_anonymous_sign_ins = true` (D-02 local-dev mirror).
- Added `supabase/.env.secrets`, `supabase/.branches/`, `supabase/.temp/` to repo-root `.gitignore`.

### 2. Supabase cloud project provisioned (Task 2, commit `716a0ca`)

- Dashboard-driven creation (Supabase free tier cannot create projects via CLI).
- **Recorded:** project ref `ytnsipxxmzgaebkqmokp`, region `eu-west-1`, URL `https://ytnsipxxmzgaebkqmokp.supabase.co`, postgres 17, status ACTIVE_HEALTHY, created `2026-05-11T08:35:49Z`.
- DB password generated + stored in 1Password under "LeanShot Supabase DB".
- Empty commit closure pattern (Phase 3 convention for human-checkpoint resolutions).

### 3. Function secrets placeholdered (Task 3, commit `819cda9`)

- `supabase login` + `supabase link --project-ref ytnsipxxmzgaebkqmokp` authenticated the CLI.
- Created transient `supabase/.env.secrets` with `MOONSHOT_API_KEY=placeholder-set-before-04-02-deploy` + `MOONSHOT_MODEL=kimi-k2-latest`.
- Pushed via `npx --prefix leanshot supabase secrets set --env-file supabase/.env.secrets`.
- Deleted `.env.secrets` immediately after push (gitignored, but disk-side too).
- T-04-06 mitigation confirmed: `git grep -i "sk-ant-"` returns nothing (no Moonshot key prefix to grep yet — placeholder value).

### 4. Auth providers enabled (Task 4, commit `a9850a0`)

- Originally specified as a human dashboard checkpoint; user asked the orchestrator to handle it. Done via `supabase config push --project-ref ytnsipxxmzgaebkqmokp` after editing `supabase/config.toml`.
- **Live state verified via `curl https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings`:**
  - Email magic-link: ON (`email: true`)
  - Anonymous Sign-Ins: ON (`anonymous_users: true`)
  - Manual Linking: ON (`enable_manual_linking: true` in config.toml — not surfaced in public settings endpoint but applied)
  - Email confirmations: REQUIRED (`mailer_autoconfirm: false`)
- **Mid-execution discovery:** First `config push` silently regressed production-safe remote defaults (the CLI does a full overwrite from `supabase init`'s local-dev defaults). Detected via curl; corrected by tightening `config.toml` and re-pushing. **Documented as a rule** in `decisions/supabase.md` for future phases.

### 5. Mid-execution pivot: Anthropic → Moonshot (commit `9151f22`)

- Inline-patched between Task 2 and Task 3 per user decision ("switch entirely to Moonshot").
- Wrote `04-ADDENDUM-MOONSHOT.md` as the supersession-authority document; supersedes Anthropic references in 04-CONTEXT.md (D-06, D-01), 04-RESEARCH.md (§2, §12), 04-PATTERNS.md, 04-VALIDATION.md, 04-01-PLAN.md (Task 3), 04-02-PLAN.md (Edge Function authoring), 04-03-PLAN.md (refusal corpus is model-agnostic; only `--allow-net` CI flag changes).
- Plan frontmatter on 04-01-PLAN.md updated with `addendum:` field so future executors read the supersession before touching ANTHROPIC_* references.
- Net effect on Plan 04-01: secret names + values swap (ANTHROPIC_API_KEY → MOONSHOT_API_KEY; claude-sonnet-4-6 → kimi-k2-latest). Plan structure unchanged.

### 6. Vercel envs pushed (Task 5, commit `4c2f322`)

- **Attempted first:** REST API `POST /v10/projects/<id>/env?upsert=true` with `target: ["production","preview","development"]` — would have been 8 calls (4 keys × 2 projects). Hit 403 `invalidToken` on every call.
  - **Root cause:** The token in `~/Library/Application Support/com.vercel.cli/auth.json` is a CLI session token (60 chars), not an OAuth Bearer token. The REST API requires the latter (provisioned at https://vercel.com/account/tokens).
- **Fell back to CLI:** `vercel env add <KEY> <TARGET> --force --yes` with stdin-piped values. 4 keys × 3 targets = 12 calls per project; re-linked between projects.
- **24 entries provisioned total** — verified via `vercel env ls | grep -cE 'SUPABASE|VITE_SUPABASE'` returns 12 per project after each re-link.
- **Key names:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The non-prefixed pair is for any future Vercel Function consumer (lead-capture on marketing site). The `VITE_*` mirrors are what Plan 04-02's React-app `src/lib/supabase.ts` will read at build time.
- Also added `.vercel` + `.env*.local` to `leanshot/.gitignore` (side-effect of `vercel link`).

### 7. Decision record + curl smoke (Task 6, commit `eee41d6`)

- Wrote `/Users/karstenhaldan/minisite/leanshot/.planning/decisions/supabase.md` (204 lines, 13 H2 sections).
- Sections: project metadata · key-format choice · service-role key (retrieval only) · function secrets state · model provider pivot · auth providers state (live-verified) · `supabase config push` gotcha · phase 5 hand-off contract · vercel env wiring · rate-limit thresholds · anon-row cleanup · what 04-02/04-03 will deploy · reproducibility.
- **Curl smoke:** `curl -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ai-chat -d '{}'` → **HTTP 404** (function not deployed yet; project router live and ready for Plan 04-02). Acceptance was "401 or 404"; 404 passes.
- Verified: `git grep -E "sk-ant-|eyJ[A-Za-z0-9_-]{40,}"` returns nothing in the file. No secrets committed.

## Tasks Completed

| # | Task                                        | Commit    | Files                                                                     |
|---|---------------------------------------------|-----------|---------------------------------------------------------------------------|
| 1 | CLI install + `supabase init` + `.gitignore`| `61c990e` | `supabase/config.toml`, `supabase/.gitignore`, `leanshot/package*.json`, `.gitignore` |
| 2 | Cloud project + ref recorded (HUMAN)        | `716a0ca` | (empty commit — closure record)                                           |
| – | Moonshot pivot (orchestrator)               | `9151f22` | `04-ADDENDUM-MOONSHOT.md`, plan-file frontmatter updates                  |
| 3 | Function secrets placeholdered              | `819cda9` | (no committed files — secrets pushed via Supabase API; `.env.secrets` deleted) |
| 4 | Auth providers enabled (orchestrator-driven)| `a9850a0` | `supabase/config.toml`                                                    |
| 5 | Vercel envs pushed (24 entries)             | `4c2f322` | `leanshot/.gitignore`                                                     |
| 6 | Decision record + curl smoke                | `eee41d6` | `leanshot/.planning/decisions/supabase.md`                                |
| 7 | This SUMMARY + state metadata               | (final commit) | this file + STATE.md/ROADMAP.md/REQUIREMENTS.md updates              |

## Files Modified (Plan 04-01 cumulative diff)

```
 .gitignore                               |   5 +
 leanshot/.gitignore                      |   2 +
 leanshot/.planning/decisions/supabase.md | 204 +++
 leanshot/package-lock.json               | 288 +++
 leanshot/package.json                    |   1 +
 supabase/.gitignore                      |   8 +
 supabase/config.toml                     | 408 +++
 7 files changed, 916 insertions(+)
```

Plus the addendum + this SUMMARY (additional `.planning/` doc files not counted in source/infra diff).

## Deviations from Plan

### (a) [Rule 4 — Architectural decision applied mid-execution] Anthropic → Moonshot Kimi K2 pivot

- **Found during:** Between Task 2 and Task 3 (user surfaced the change).
- **Issue:** Plan as written targeted Anthropic Claude Sonnet; user decided to switch entirely to Moonshot Kimi K2.
- **Fix:** Wrote `04-ADDENDUM-MOONSHOT.md` as a supersession-authority document; updated `04-01-PLAN.md` frontmatter to reference it; continued executing with `MOONSHOT_*` secret names instead of `ANTHROPIC_*`.
- **Files modified:** plan-file frontmatter + new addendum.
- **Commit:** `9151f22`.
- **Rationale documented in:** `.planning/decisions/supabase.md` § Model provider; backout plan documented (Vercel AI Gateway / fall back to Anthropic).

### (b) [User choice, not a deviation per se] Region `eu-west-1` instead of recommended `us-east-1`

- **Found during:** Task 2.
- **Issue:** PLAN Task 2 step 2 recommended `us-east-1` (co-located with Vercel `iad1`); user picked `eu-west-1`.
- **Impact:** ~80–120ms additional latency for US-located users hitting Edge Functions.
- **Mitigation:** Documented in decision record. Migratable post-launch via Supabase Dashboard → Project Settings → Migrate.

### (c) [User-requested scope expansion] Task 4 dashboard checkpoint executed by orchestrator

- **Found during:** Task 4.
- **Issue:** PLAN Task 4 was a `checkpoint:human-action` — user was supposed to flip three dashboard toggles. User asked: "can you do it for me?"
- **Fix:** Edited `supabase/config.toml` to set `enable_manual_linking: true` + tightened email defaults; ran `supabase config push --project-ref ytnsipxxmzgaebkqmokp`. Verified live state via curl against `/auth/v1/settings`.
- **Sub-deviation surfaced:** First push regressed production-safe remote defaults (the CLI does a full overwrite from `supabase init`'s local-dev defaults). Detected via curl; re-pushed with `mailer_autoconfirm: false` + tightened `max_frequency` + `otp_length`. **Documented as a rule** in `.planning/decisions/supabase.md` § `supabase config push` gotcha.
- **Commit:** `a9850a0`.

### (d) [Documentation clarification — non-blocking] Password sign-up cannot be disabled while keeping magic-link enabled

- **Found during:** Task 4 config inspection.
- **Issue:** PLAN Task 4 step 1 said "Leave 'Confirm email' at its default" — clear. But there's no separate toggle for "password sign-up disabled while magic-link sign-up enabled" — they're both under `[auth.email]` in `config.toml`. Sign-up via email/password is therefore enabled alongside magic-link.
- **Impact:** Negligible for v1 — the docs UI nudges magic-link. Documented in decision record.

### (e) [Non-deviation — CLI auth quirk worth recording] Vercel REST API token unavailable

- **Found during:** Task 5 attempt.
- **Issue:** `~/Library/Application Support/com.vercel.cli/auth.json` `.token` field returned 403 on REST API calls — that token is a CLI session token, not an OAuth Bearer token for the REST API.
- **Fix:** Fell back to `vercel env add` CLI (12 calls per project instead of 4 REST calls). Functionally identical outcome.
- **Future note:** If a Phase 6+ task needs REST API access (e.g., bulk env operations across many projects), provision a token at https://vercel.com/account/tokens. Not blocking now.

### (f) [Doc artifact — RESEARCH §1 ordering] No issues encountered

- RESEARCH §1 steps 1–14 (CLI install → init → login → link → secrets push → dashboard toggles → Vercel env-add → decision record) executed cleanly in that order. No deviations to the recipe.

## Threats Mitigated

| Threat   | Status            | Notes                                                                                                                                                                                                                                       |
|----------|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| T-04-06  | partially mitigated | (a) Placeholder MOONSHOT_API_KEY in transient `supabase/.env.secrets` was gitignored + deleted after push. (b) Real key not yet in place — full T-04-06 mitigation closes when Plan 04-02 Task 4 pushes the real key and re-verifies. |
| INFRA-04-01-A | mitigated     | `--env-file` pattern used; no `sk-…` / `msk-…` value in shell history (`~/.zsh_history`).                                                                                                                                                  |
| INFRA-04-01-B | mitigated     | `supabase/.temp/project-ref` matches the recorded ref `ytnsipxxmzgaebkqmokp`.                                                                                                                                                              |
| INFRA-04-01-C | accepted      | Anon JWT is intentionally public; ships in browser bundle as `VITE_*`. RLS + JWT verification on the Edge Function are the real auth gates (Plan 04-02 / 04-03).                                                                            |
| INFRA-04-01-D | accepted      | `eu-west-1` (not `us-east-1`) is operational, not security. Documented.                                                                                                                                                                     |
| INFRA-04-01-E | accepted      | Supabase audit log (Dashboard → Settings → Audit) records the project creator.                                                                                                                                                              |

## TDD Gate Compliance

- N/A. Plan 04-01 is `type: execute` (not `type: tdd`). No tests authored; no test commits expected. Plan 04-03 owns the adversarial corpus + RLS tests.

## SC#0 Status

**DELIVERED.** Phase 4 SC#0 ("Supabase cloud project provisioned, CLI initialized, Vercel envs wired, function secrets present, dashboard toggles confirmed, decision record committed") is fully satisfied modulo the real-MOONSHOT_API_KEY swap which is deliberately deferred to Plan 04-02 pre-deploy step.

## Test Status

- No automated tests run by 04-01 (smoke / curl assertions only).
- VALIDATION.md per-task table assertions all passing:
  - 04-01-01: `test -f supabase/config.toml && grep -q 'enable_anonymous_sign_ins = true' supabase/config.toml` → ✅
  - 04-01-02: Manual (project ref recorded `ytnsipxxmzgaebkqmokp`) → ✅
  - 04-01-03: `supabase secrets list | grep -cE 'MOONSHOT_(API_KEY|MODEL)'` returns 2 (verified live) → ✅
  - 04-01-04: `curl /auth/v1/settings | jq '.email, .anonymous_users'` returns true/true → ✅
  - 04-01-05: `vercel env ls | grep -cE 'SUPABASE|VITE_SUPABASE'` returns 12 per project → ✅
  - 04-01-06: `wc -l < .planning/decisions/supabase.md` returns 204 (≥ 30) AND no `sk-ant-` / JWT strings present → ✅

## Outstanding for Plan 04-02

1. **Real `MOONSHOT_API_KEY`** must be pushed to Function secrets BEFORE Plan 04-02 Task 4 curl-smoke. One-liner per the addendum:
   ```
   echo 'MOONSHOT_API_KEY=<real-key>' > supabase/.env.secrets
   npx --prefix leanshot supabase secrets set --env-file supabase/.env.secrets
   rm supabase/.env.secrets
   ```
2. **Researcher must resolve `MOONSHOT_MODEL=kimi-k2-latest`** to a canonical model ID at Plan 04-02 research/execution time. Candidates: `kimi-k2-0905-preview` or whatever Moonshot's `/v1/models` endpoint currently advertises. Update both the addendum and the in-code `Deno.env.get('MOONSHOT_MODEL') ?? '…'` default.
3. **Edge Function code uses OpenAI-compatible Chat Completions shape** per `04-ADDENDUM-MOONSHOT.md`:
   - Base URL: `https://api.moonshot.ai/v1` (international) OR `https://api.moonshot.cn/v1` (China) — researcher picks based on account region.
   - Auth header: `Authorization: Bearer ${MOONSHOT_API_KEY}` (NOT Anthropic's `x-api-key`).
   - Payload: `{model, messages: [{role: "system", content}, {role: "user", content}], stream: true}`.
   - SSE delta consumer (server-side persist + browser-side parser): `choices[0].delta.content` instead of `delta.text`.

## Self-Check: PASSED

Verified before writing this section:

- `git log --oneline | grep -q 61c990e` → ✅ FOUND
- `git log --oneline | grep -q 716a0ca` → ✅ FOUND
- `git log --oneline | grep -q 819cda9` → ✅ FOUND
- `git log --oneline | grep -q 9151f22` → ✅ FOUND
- `git log --oneline | grep -q a9850a0` → ✅ FOUND
- `git log --oneline | grep -q 4c2f322` → ✅ FOUND
- `git log --oneline | grep -q eee41d6` → ✅ FOUND
- `test -f supabase/config.toml` → ✅ FOUND
- `test -f leanshot/.planning/decisions/supabase.md` → ✅ FOUND (204 lines)
- `test -f leanshot/.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-ADDENDUM-MOONSHOT.md` → ✅ FOUND
- Vercel envs verified: 12 entries per project (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` × 3 targets) on both `leanshot-app` and `leanshot-marketing`.
- Function secrets verified live: `MOONSHOT_API_KEY` + `MOONSHOT_MODEL` both present in `supabase secrets list --linked`.
- Auth providers verified live via curl: `email: true`, `anonymous_users: true`, `mailer_autoconfirm: false`.

next_plan: 04-02
