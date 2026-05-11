# Supabase Cloud Project — Decision Record

**Recorded:** 2026-05-11
**Phase:** 4
**Plan:** 04-01 (bootstrap)
**Authoritative:** This file is the single source of truth for the Supabase + Vercel + Function-secrets state Plan 04-02 inherits. Future agents must read this BEFORE editing `supabase/config.toml`, the Edge Function source, or Vercel envs.

---

## Project metadata

- project_id: `ytnsipxxmzgaebkqmokp` (Supabase project ref)
- project_region: `eu-west-1`
- project_url: `https://ytnsipxxmzgaebkqmokp.supabase.co`
- postgres_version: 17
- org_slug: `yqgcpcuimrqugxvznlyi`
- status: ACTIVE_HEALTHY
- created_at: `2026-05-11T08:35:49Z`
- dashboard_url: `https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp`
- vercel_app_project_id: `prj_udGmCEFhEojT6Ul0iqZGmHOV5Zrz` (leanshot-app)
- vercel_marketing_project_id: `prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc` (leanshot-marketing)
- vercel_scope: `karstens-projects-16afd0e4` (team `team_6syVv7EHQuY2WGRChwRCpTMr`)

**Trade-off — region choice:**
- The originally-recommended region in PLAN 04-01 Task 2 was `us-east-1` (co-located with Vercel's default `iad1` POP for the React app).
- The user picked `eu-west-1` instead. Operational impact: ~80–120ms additional latency for US-located users hitting Edge Functions, no functional regression.
- Mitigation path if latency becomes a problem post-launch: Supabase's Dashboard → Project Settings → "Migrate" supports same-org region migration. Not blocking v1.

---

## Key format choice — legacy JWT anon key

- **Decision:** Use the legacy `eyJ…`-shaped JWT anon key (NOT the modern `sb_publishable_…` format).
- **Rationale:**
  - Keeps the stack aligned with `@supabase/supabase-js`, which still defaults to the JWT format.
  - The Edge Function `Authorization: Bearer <anon-JWT>` pattern in D-02 (browser-side anonymous sign-in flow) requires the JWT shape.
  - Modern `sb_publishable_*` keys require a config-flag flip to activate and don't get extra security benefit for the public anon role (the anon key is INTENTIONALLY public — see INFRA-04-01-C in PLAN 04-01 `<threat_model>`).
- **Retrieval command:**
  ```
  npx supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp
  ```
  Returns both formats; pick the row labeled `anon` with the `eyJ…` value.
- **Where stored:** Vercel env vars (`SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`) on both projects × 3 targets. Never in a committed file.

## Service-role key

- **Status:** Exists; NOT pushed to Vercel envs (correctly — service-role key bypasses RLS and MUST stay server-side per RESEARCH §"Pitfall 6").
- **Retrieval command:** Same as above, pick the `service_role` row.
- **Anticipated consumer:** Plan 04-03's cross-tenant RLS test (`e2e/rls-ai-messages.test.ts`) needs two service-role clients to assert mutual visibility = 0. The test consumes the value via a local env var (`SUPABASE_SERVICE_ROLE_KEY`) — never committed.
- **Rule:** Never paste the service-role JWT value into any file in this repo, any commit message, or any AI chat context. Only the retrieval command lives here.

---

## Function secrets state

- **Source of truth for current values:** `npx supabase secrets list --linked`
- **Keys set (Plan 04-01 Task 3, commit `819cda9`):**
  - `MOONSHOT_API_KEY`: `placeholder-set-before-04-02-deploy` (placeholder; real value pushed just before Plan 04-02 Task 4 curl-smoke)
  - `MOONSHOT_MODEL`: `kimi-k2-latest` (Plan 04-02 researcher must resolve to a real Moonshot model ID at execution time — see model-provider pivot below)
- **Push command (idempotent, env-file pattern):**
  ```
  cd /Users/karstenhaldan/minisite
  echo 'MOONSHOT_API_KEY=<real-key>' > supabase/.env.secrets
  echo 'MOONSHOT_MODEL=<resolved-id>' >> supabase/.env.secrets
  npx --prefix leanshot supabase secrets set --env-file supabase/.env.secrets
  rm supabase/.env.secrets   # gitignored, but still: delete immediately after push
  ```
- **NOT in Vercel:** No `MOONSHOT_*` env var touches Vercel. Those stay Supabase Function-secret-side only. Browser/Vite can never read them.

---

## Model provider — Anthropic → Moonshot Kimi K2 pivot

- **Source-of-truth doc:** `/Users/karstenhaldan/minisite/leanshot/.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-ADDENDUM-MOONSHOT.md`
- **Pivot commit:** `9151f22` (mid-execution, between Task 2 and Task 3 of this plan).
- **Rationale:** User decision — switch entirely to Moonshot (drop Anthropic). Direct provider call (NOT through Vercel AI Gateway, which was the Recommended option offered).
- **What changed:** Edge Function (Plan 04-02) calls Moonshot's OpenAI-compatible `/v1/chat/completions` endpoint with `Authorization: Bearer ${MOONSHOT_API_KEY}` instead of Anthropic's Messages API. SSE delta shape changes from `delta.text_delta` to `choices[0].delta.content`. System prompt moves from top-level `system:` field to `messages[0]` with `role: "system"`.
- **What stayed the same:** Refusal pre-check (`shared/refusal.ts` is model-agnostic), rate-limit RPC, `ai_messages` schema, RLS policies, `tee()` + `EdgeRuntime.waitUntil` streaming pattern.
- **Backout plan (if Plan 04-02 verification surfaces problems):**
  - Option A — switch to Vercel AI Gateway (one-env-var change; gateway supports both Moonshot and Anthropic).
  - Option B — temporarily fall back to Anthropic (re-instate the deleted adapter from git history; file "Moonshot v1.1" as backlog).
  - Decision deferred until actual Plan 04-02 verification failure surfaces — premature backout is not warranted.

---

## Auth providers state (verified live)

Verified via `curl -s https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings`:

- Email magic-link provider: ON (`email: true` in settings response). SC#0 explicit requirement. Phase 5 prereq.
- Anonymous Sign-Ins: ON (`anonymous_users: true`). D-02 requirement. Without this the Edge Function in Plan 04-02 cannot mint anonymous JWTs.
- Manual Linking: ON in `supabase/config.toml` (`enable_manual_linking: true`; pushed via `supabase config push` in commit `a9850a0`). NOT surfaced in the public `/auth/v1/settings` endpoint but applied at the auth-service level. Phase 5 prereq per RESEARCH §"Pitfall 5".
- Email confirmations required: ON (`mailer_autoconfirm: false`) — production-safe; users must click the magic-link email to complete sign-in.
- Sign-up enabled: ON (`disable_signup: false`).
- Dashboard re-check URL: `https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/auth/providers`

**Note on `enable_signup` for password:** It was NOT explicitly disabled. Magic Link is implicit in the email provider — there is no `config.toml` flag to disable password while keeping magic-link enabled; both live under `[auth.email]`. This is acceptable for v1 (users can use magic-link OR password; the docs UI nudges magic-link). If password sign-up needs to be blocked later, the route is custom triggers on `auth.users` — not a config flag.

---

## Phase 5 hand-off contract — anonymous → permanent UID promotion

- **Mechanism (verified against Supabase docs 2026-05-11):** Two-step `updateUser` flow, NOT `linkIdentity`.
  1. `supabase.auth.updateUser({ email: "user@example.com" })` — sends a confirm-email link (uses the magic-link mailer).
  2. User clicks link → email confirmed → session updated.
  3. `supabase.auth.updateUser({ password: "<strong-password>" })` — sets password on the now-permanent user.
- **NOT `linkIdentity({ email, password })`:** That API is OAuth-only (Google/Apple/GitHub). Source: RESEARCH §"Pitfall 5".
- **Why Manual Linking is still ON:** Future OAuth-based linking flows (e.g., Phase 6 "sign in with Apple" on iOS) will need the `linkIdentity` path. Flipping `enable_manual_linking` ON now removes a setup-time gotcha later. Cost: zero.
- **Invariant under promotion:** `auth.uid()` does NOT change. All `ai_messages` + `rate_limit_counters` rows the anonymous user created survive intact. Plan 04-03 smoke-tests this.

---

## `supabase config push` gotcha (documented for future phases)

- **Discovered during:** Task 4 (orchestrator-executed via CLI per user's "can you do it for me" request; commit `a9850a0`).
- **Problem:** `npx supabase config push --project-ref <ref>` does a **FULL OVERWRITE** of the remote auth+storage configuration from the local `supabase/config.toml`. The defaults `supabase init` writes are tuned for local-dev (`enable_confirmations: false`, `max_frequency: 1s`, `otp_length: 6`) — which silently regress production-safe remote settings on first push.
- **Symptom we saw:** First push disabled email-confirmation on the live project. Detected via curl against `/auth/v1/settings` and corrected by re-pushing with `mailer_autoconfirm: false` + tightened defaults in `config.toml`.
- **Rule for future phases:** Before ANY `supabase config push`, diff local↔remote first:
  ```
  npx supabase config diff --project-ref ytnsipxxmzgaebkqmokp
  ```
  (or read the current state via curl against `/auth/v1/settings`).
  Inspect the diff. Only push if every regression is intentional. Treat `config push` as a destructive operation, not a merge.

---

## Vercel env wiring (records Task 5 outcome)

Wired via `vercel env add <KEY> <TARGET> --force --yes` with stdin-piped values; 4 keys × 2 projects × 3 targets = 24 entries total. Idempotent via `--force`. Commit `4c2f322`.

| Key                       | Type      | leanshot-app | leanshot-marketing |
|---------------------------|-----------|:------------:|:------------------:|
| `SUPABASE_URL`            | Encrypted | prod/preview/dev | prod/preview/dev |
| `SUPABASE_ANON_KEY`       | Encrypted | prod/preview/dev | prod/preview/dev |
| `VITE_SUPABASE_URL`       | Encrypted | prod/preview/dev | prod/preview/dev |
| `VITE_SUPABASE_ANON_KEY`  | Encrypted | prod/preview/dev | prod/preview/dev |

- The `VITE_*` mirrors are the keys the React app (Vite-bundled) actually reads via `import.meta.env.VITE_SUPABASE_*` in Plan 04-02's new `src/lib/supabase.ts` singleton.
- The non-prefixed `SUPABASE_URL` / `SUPABASE_ANON_KEY` mirrors are provisioned for any future Vercel-side server function (e.g. a Vercel Function for lead capture on the marketing site) that wants the same connection details without a `VITE_` prefix.
- `leanshot-marketing` doesn't currently call Supabase (no `import.meta.env.VITE_SUPABASE_*` references in `src/components/marketing/Landing.tsx` as of this commit). Per the RESEARCH §11 marketing-env discretion recommendation: provisioned anyway because matching ROADMAP literal text + ~10 seconds of CLI time + future-proofing lead-capture forms is cheaper than documenting a deviation. Unused Vercel envs cost nothing.

**Verification command:**
```
cd /Users/karstenhaldan/minisite/leanshot
rm -rf .vercel && vercel link --yes --project leanshot-app --scope karstens-projects-16afd0e4
vercel env ls | grep -cE "^[[:space:]]+(VITE_)?SUPABASE_(URL|ANON_KEY)"    # expect 12
rm -rf .vercel && vercel link --yes --project leanshot-marketing --scope karstens-projects-16afd0e4
vercel env ls | grep -cE "^[[:space:]]+(VITE_)?SUPABASE_(URL|ANON_KEY)"    # expect 12
```

---

## Rate-limit thresholds (Claude's discretion per CONTEXT line 74 + RESEARCH §11 row 1)

- minute: 30
- hour: 60
- day: 200
- Rationale: RESEARCH §5 + §11; SC#4 satisfied with 3.3× margin (load test fires 100 req/60s → expected ≤ 30 succeed in the same minute window).
- These are the values Plan 04-03's migration's `increment_rate_limit` consumer will hard-wire (constant table in the SQL function body — env-var override deferred to Phase 6 if needed).

## Anon-row cleanup (Claude's discretion per CONTEXT line 75 + RESEARCH §13 + §11 row 2)

- Mechanism: pg_cron daily job (Plan 04-03 owns the migration).
- Schedule: `'0 3 * * *'` (daily 03:00 UTC).
- Retention: 30 days post-create (matches Supabase docs example).
- Source: `supabase/migrations/<ts>_anon_cleanup_pg_cron.sql` (created in 04-03).
- Mitigates T-04-05 (anonymous-user table bloat).

---

## What Plan 04-02 will deploy

- `supabase/functions/ai-chat/index.ts` — Deno entry point. Reads `MOONSHOT_API_KEY` + `MOONSHOT_MODEL` from `Deno.env.get(...)`. Calls Moonshot OpenAI-compatible `/v1/chat/completions` with `stream: true`.
- `supabase/functions/ai-chat/deno.json` + `supabase/functions/import_map.json` — Wave 0 infra (also created in 04-02 Task 2).
- Browser-side: `src/lib/supabase.ts` (new singleton — `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`) + rewritten `src/lib/ai.ts` (consumes the Edge Function via `fetch(... + 'functions/v1/ai-chat')` with the user's session JWT in `Authorization`, parses OpenAI SSE delta shape).
- `src/lib/ai.ts`'s previous `apiKeyStorage` + `MissingAPIKeyError` + `callAnthropic` + `DEFAULT_MODEL = 'claude-sonnet-4-5'` — all deleted in Plan 04-02 Task 3 (BYO-key UI removed).

## What Plan 04-03 will deploy

- Migration 1: `ai_messages` table + RLS policies (T-04-04 mitigation).
- Migration 2: `rate_limit_counters` table + `increment_rate_limit` RPC (T-04-02 mitigation).
- Migration 3: pg_cron schedule for anon cleanup (T-04-05 mitigation; see thresholds above).
- Refusal hardening: `shared/refusal.ts` adversarial corpus ≥ 50 rows across 5 categories.
- CI deno-test job in `.github/workflows/ci.yml`.

---

## Reproducibility

All bootstrap steps in this plan are CLI-driven from this repo, EXCEPT:
- **Task 2** — Supabase cloud project creation (one-time dashboard click; CLI cannot create projects on the free tier without web confirmation). Recorded in commit `716a0ca`.
- **Task 4** — Auth provider toggles. Originally specified as a dashboard checkpoint; the orchestrator did this via `supabase config push` per user request "can you do it for me" — see `<supabase config push gotcha>` section above. Recorded in commit `a9850a0`.

Every other step (`supabase init`, `supabase link`, `supabase secrets set`, `vercel env add`) is CLI-only and re-runnable. No MCP server for Supabase is installed; all CLI calls go through `npx --prefix leanshot supabase …` or `vercel …`.

---

## Pointers to live state

- Linked project ref on disk: `/Users/karstenhaldan/minisite/supabase/.temp/project-ref` (gitignored)
- Function secrets list: `npx --prefix leanshot supabase secrets list --linked`
- Auth config diff: `curl -s https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings | jq`
- Vercel envs (per project): `cd leanshot && vercel link --yes --project <name> --scope karstens-projects-16afd0e4 && vercel env ls`
- Project audit log (provisioned-by, dashboard changes): Supabase Dashboard → Settings → Audit
