# Phase 34 Plan 34-10 — PostHog Personal API Key Checkpoint Walkthrough

**Type:** `checkpoint:human-action` — **but mostly CLI-runnable inline**
**Owner:** Operator (PostHog dashboard once for the key + CLI for everything else)
**Resume signal target:** `/gsd-execute-phase` continuation after `approved — secrets set, both Edge Fns no longer return 503`

---

## Why this is *partially* CLI-runnable

Per memory `feedback_verify_human_uat_via_cli`: gsd-verifier over-labels this
as "human_needed". In practice **only the personal-API-key generation is
browser-only** (PostHog has no API for minting personal API keys); the rest
is `supabase secrets set` + `supabase functions deploy` + `curl` — all
operator-runnable in the same chat session.

Per memory `feedback_cli_over_paste_back`: surface the CLI commands inline so
the operator pastes them rather than copy-paste-back screenshots.

Per memory `feedback_mcp_auth_walls_block_full_automation`: PostHog has an
OAuth-protected dashboard for key creation; no headless MCP automation
available today.

---

## Pre-flight

You will need:

- PostHog account access (admin role) at https://us.posthog.com (or
  https://eu.posthog.com — **confirm region first**).
- Supabase CLI authenticated and linked to project `ytnsipxxmzgaebkqmokp`
  (`supabase status` should show project_ref).
- Local shell open in `/Users/karstenhaldan/minisite/leanshot` (or anywhere —
  CLI commands use `--project-ref` not implicit linkage).

> 📝 Per memory `reference_supabase_functions_deploy_no_linked_flag`: do NOT
> pass `--linked` to `supabase functions deploy` (CLI v2.100.0 errors). Omit it.

---

## Step 1 (BROWSER) — Create the PostHog Personal API key

1. Visit https://us.posthog.com/settings/user-api-keys (or `eu.posthog.com`
   if the LeanShot project lives in the EU region).
2. Click **"Create personal API key"**.
3. **Name:** `LeanShot Phase 34 ship-winner`
4. **Scopes:**
   - `feature_flag:write`
   - `insight:read`
   - (Optional, narrower-is-better — do NOT grant `*`.)
5. Click **Create**.
6. **Copy the key immediately** — it's shown once. Stash in 1Password.

## Step 2 (BROWSER) — Note the Project ID

1. PostHog → **Project Settings** (gear icon) → top of the page.
2. The **Project ID** is an integer (e.g. `12345`). Copy it.

## Step 3 (CLI) — Set both as Supabase Function Secrets

```bash
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  POSTHOG_PERSONAL_API_KEY=phx_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  POSTHOG_PROJECT_ID=12345
```

**Verify:**

```bash
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep POSTHOG
```

Expected: both names listed with masked digests (per memory
`reference_supabase_service_role_key_format_divergence`, the secret values
themselves are never returned in plaintext from `secrets list`).

## Step 4 (CLI) — Re-deploy both Edge Functions

The CLI does NOT auto-redeploy on secret changes — deploys must be triggered
explicitly so the new env vars get baked into the bundle.

```bash
cd /Users/karstenhaldan/minisite

supabase functions deploy ship-winner-flag --import-map supabase/functions/import_map.json
supabase functions deploy onboarding-funnel-query --import-map supabase/functions/import_map.json
```

> 📝 Per memory `reference_supabase_functions_deploy_import_map_flag`: the
> CLI marks `--import-map` as deprecated but still honors it. Required if
> either Function imports via `shared/` aliases declared in
> `supabase/functions/import_map.json`. If neither does, you can omit it.

## Step 5 (CLI) — Smoke test ship-winner-flag

Grab a session JWT for a superadmin user. The simplest path:

1. Sign in to https://app.leanshot.app as your superadmin account.
2. Chrome DevTools → Application → Local Storage → key
   `sb-ytnsipxxmzgaebkqmokp-auth-token` → copy the `access_token` field
   from the JSON.

Then:

```bash
SUPER_TOKEN='<paste-access-token>'

# Should NOT return 503. Either 200 (if flag exists) or 4xx with a
# `flag_not_found` reason — the latter is fine; it proves the vendor
# health check passed.
curl -i -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ship-winner-flag \
  -H "Authorization: Bearer $SUPER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"flag_id":"99999999","variant":"control"}'
```

Look for **HTTP 200** or **HTTP 4xx** (not 503) in the response status line.

## Step 6 (CLI) — Smoke test onboarding-funnel-query

```bash
curl -i -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/onboarding-funnel-query \
  -H "Authorization: Bearer $SUPER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"list_experiments"}'
```

Expected: **HTTP 200** with `{ experiments: [...] }` body (the array may be
empty if no experiments exist yet — that's fine; the vendor health check
passed).

## Step 7 (BROWSER, optional) — UI confirmation

1. Visit https://app.leanshot.app/admin/onboarding (must be signed in as
   superadmin).
2. Click the **A/B Experiments** tab.
3. The previously-visible "vendor_unconfigured" banner should be gone.

---

## Resume signal format

Type one of these in chat to resume Plan 34-10:

- `approved — secrets set, both Edge Fns no longer return 503` — Plan 34-10
  proceeds to final smoke (Task 4).
- `issue: <description>` — common gotchas:
  - PostHog region mismatch (US codebase but EU project) → fix the codebase
    URL in a follow-up plan; do NOT silently override the secret.
  - Scope too narrow → 403 from PostHog when `ship-winner-flag` tries to
    PATCH the flag; re-create the key with `feature_flag:write`.
  - Superadmin session JWT expired (Supabase sessions are 1h by default) →
    re-sign-in + grab a fresh token.

---

## Threat model notes (T-34-10-05)

| Risk | Mitigation |
|------|------------|
| Personal API key leak via shell history | Use `read -s` or paste-into-supabase-secrets-set in one shot; CLI does not echo. Don't commit `.env` files. |
| Superadmin session JWT in shell variable | `unset SUPER_TOKEN` after Step 6. Session expires in ≤1h regardless. |
| Personal API key over-scoped → blast radius if leaked | Key is scoped to `feature_flag:write` + `insight:read` only. Cannot read/write events or other projects. |
