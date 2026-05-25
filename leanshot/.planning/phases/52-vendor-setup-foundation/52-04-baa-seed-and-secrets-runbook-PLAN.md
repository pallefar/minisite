---
phase: 52-vendor-setup-foundation
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql
  - leanshot/.planning/runbooks/vendor-secrets.md
  - scripts/check-required-secrets.sh
  - .github/workflows/vendor-secrets-drift.yml
autonomous: true
requirements: [VENDOR-01, VENDOR-02, VENDOR-04, VENDOR-05, VENDOR-06, VENDOR-07, VENDOR-09, VENDOR-10, VENDOR-12]
user_setup: []

must_haves:
  truths:
    - "A vendor_baa_chain row exists for each new Phase 52 vendor (Mux, Apple Developer, Google Play, Calendly, Better Stack, RevenueCat, AdMob/AdSense, Stripe)"
    - "The seed migration is idempotent (ON CONFLICT DO NOTHING) and forward-dated"
    - "runbooks/vendor-secrets.md lists every secret name with storage location, rotation cadence, blast-radius, owner, and the literal set-command"
    - "The runbook canonicalizes the reconciled env names (CALENDLY_OAUTH_CLIENT_ID, ANTHROPIC_CLINICAL_API_KEY)"
    - "scripts/check-required-secrets.sh reports missing required vendor secrets, WARNS (exit 0) for documented deferred-to-Phase-70 secrets, and FAILS (exit 1) only when a non-deferred required secret is missing"
    - "SENTRY_DSN is on the watched required-secret list with drift detection"
    - "A CI workflow invokes the guard on PR/push so silent secret drift is caught (VENDOR-07)"
  artifacts:
    - path: "supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql"
      provides: "INSERT new vendor BAA rows via migration role, ON CONFLICT DO NOTHING"
      contains: "vendor_baa_chain"
    - path: "leanshot/.planning/runbooks/vendor-secrets.md"
      provides: "Per-secret registry + deferred-secret allowlist for the CI guard"
      min_lines: 60
    - path: "scripts/check-required-secrets.sh"
      provides: "CI drift guard: required-secret manifest + deferred allowlist + supabase/vercel name checks"
      min_lines: 40
    - path: ".github/workflows/vendor-secrets-drift.yml"
      provides: "CI step invoking the guard on PR/push"
      contains: "check-required-secrets.sh"
  key_links:
    - from: "20280101000002_vendor_baa_chain_p52_seed.sql"
      to: "vendor_baa_chain table"
      via: "INSERT ... ON CONFLICT (vendor_name) DO NOTHING"
      pattern: "on conflict \\(vendor_name\\) do nothing"
    - from: ".github/workflows/vendor-secrets-drift.yml"
      to: "scripts/check-required-secrets.sh"
      via: "run: bash scripts/check-required-secrets.sh"
      pattern: "check-required-secrets\\.sh"
---

<objective>
Seed `vendor_baa_chain` with rows for the new Phase 52 vendors (reusing the existing Phase 25 table — NO parallel table), author `runbooks/vendor-secrets.md` documenting every secret name/storage/rotation/blast-radius/owner/set-command, and ship the VENDOR-07 CI guard that prevents silent required-secret (notably `SENTRY_DSN`) drift.

Purpose: VENDOR-10 (BAA chain re-verified for v1.4 additions) + VENDOR-12 (secrets runbook) + VENDOR-07 (Sentry/required-secret drift guard, CLOSED FULLY in Phase 52 — not deferred to 67). The runbook is the live missing-secret tracker companion to the smoke dashboard; it is the single source the Phase 70 provisioner works from, and the source of the guard's deferred-secret allowlist.
Output: one forward-dated seed migration + `vendor-secrets.md` + `scripts/check-required-secrets.sh` + a CI workflow invoking it.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/52-vendor-setup-foundation/52-CONTEXT.md
@.planning/phases/52-vendor-setup-foundation/52-RESEARCH.md

# Existing table schema + existing seed-row INSERT pattern (copy the column list + ON CONFLICT DO NOTHING form)
@supabase/migrations/20270702000001_vendor_baa_chain.sql
# Runbook directory + house style for an existing runbook
@leanshot/.planning/runbooks/hbnr-incident-response.md
# Existing shell-script house style (set -euo pipefail, arg-guards, usage comment)
@scripts/p28-rename-diff.sh
# Minimal CI-workflow analog — copy its shape (on: push/pull_request + paths, single job, ubuntu-latest, timeout)
@.github/workflows/mobile-privacy-audit.yml

<interfaces>
<!-- vendor_baa_chain columns (VERIFIED). Insert via migration role (NOT service_role — Phase 25 revoked service_role UPDATE/DELETE; INSERT-via-migration is permitted, A10). -->
  vendor_baa_chain(
    vendor_name text PRIMARY KEY,
    baa_signed_at timestamptz, baa_expiry_at timestamptz,
    monthly_cost_usd numeric(10,2) NOT NULL DEFAULT 0,
    scope_summary text,
    subprocessor_list jsonb NOT NULL DEFAULT '[]',
    subprocessor_last_diff_at timestamptz,
    contact_email text,
    status vendor_baa_status NOT NULL DEFAULT 'pending',   -- enum: 'pending'|'signed'|'expired'
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
  )
  Existing seed rows already present: 'Supabase','Vercel','Sentry','Anthropic','AWS SES','PostHog'.

<!-- Canonical env-name reconciliations to use in the runbook (code is authoritative): -->
  CALENDLY_OAUTH_CLIENT_ID  (A11: REQUIREMENTS.md says CALENDLY_CLIENT_ID — wrong; code uses CALENDLY_OAUTH_CLIENT_ID)
  ANTHROPIC_CLINICAL_API_KEY (A13: REQUIREMENTS.md says ANTHROPIC_API_KEY_CLINICAL — wrong; ai-chat/index.ts:45 uses ANTHROPIC_CLINICAL_API_KEY)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Seed vendor_baa_chain rows for new Phase 52 vendors</name>
  <files>supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql</files>
  <action>
Create forward-dated `supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql` (timestamp later than the remote's last applied — latest local is 20271102000015, so 20280101000002 is safe; RESEARCH Pitfall 7). Do NOT create a parallel table — INSERT into the existing `public.vendor_baa_chain` (CONTEXT decision + RESEARCH Don't-Hand-Roll).

Copy the column-list INSERT form from `20270702000001_vendor_baa_chain.sql` lines 139-161 and end with `on conflict (vendor_name) do nothing;` so the migration is idempotent and safe if any vendor row already exists. Insert these rows with `status='pending'` (or noted n/a in scope_summary) per RESEARCH §Reuse Inventory new-rows table:
- 'Mux' — scope_summary 'Video hosting (community + KB). BAA decision needed — Mux standard plan has no HIPAA BAA; check enterprise.' status 'pending'.
- 'Apple Developer' — scope_summary 'n/a: signing authority, no PHI processed.' status 'pending'.
- 'Google Play' — scope_summary 'n/a: distribution, no PHI processed.' status 'pending'.
- 'Calendly' — scope_summary 'Scheduling — PHI risk if patient data in events. BAA available.' status 'pending'.
- 'Better Stack' — scope_summary 'Status page / uptime monitoring. Minimal PHI risk.' status 'pending'.
- 'RevenueCat' — scope_summary 'Subscription/payment events. Minimal PHI; BAA check needed.' status 'pending'.
- 'AdMob/AdSense' — scope_summary 'n/a: ad network MUST NOT touch PHI (HealthKit firewall).' status 'pending'.
- 'Stripe' — scope_summary 'Payment processor. HIPAA data-processor BAA usually available.' status 'pending'.

Set `monthly_cost_usd` to 0 unless a known value exists (Better Stack ~12). Leave `baa_signed_at`/`baa_expiry_at` null (signing defers to Phase 70 via the `vendor_baa_chain_update` RPC). Do NOT attempt any UPDATE — Phase 25 revoked service_role UPDATE; status flips happen later via the SECDEF RPC from the admin UI.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && F=supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql; test -f "$F" && grep -qi "insert into public.vendor_baa_chain" "$F" && grep -qi "on conflict (vendor_name) do nothing" "$F" && node -e "const s=require('fs').readFileSync('$F','utf8'); const need=['Mux','Apple Developer','Google Play','Calendly','Better Stack','RevenueCat','AdMob/AdSense','Stripe']; const miss=need.filter(v=>!s.includes(\"'\"+v+\"'\")); if(miss.length){console.error('MISSING vendor rows:',miss);process.exit(1)} if(/update .*vendor_baa_chain/i.test(s)){console.error('illegal UPDATE present');process.exit(1)} console.log('BAA_SEED_OK')"</automated>
  </verify>
  <done>Forward-dated seed migration inserts all 8 new vendor rows into existing vendor_baa_chain with ON CONFLICT DO NOTHING; no parallel table; no UPDATE statements.</done>
</task>

<task type="auto">
  <name>Task 2: Author runbooks/vendor-secrets.md (incl. deferred-secret allowlist)</name>
  <files>leanshot/.planning/runbooks/vendor-secrets.md</files>
  <action>
Create `leanshot/.planning/runbooks/vendor-secrets.md` alongside `hbnr-incident-response.md`. This is VENDOR-12: the authoritative per-secret registry. Source the full secret list from RESEARCH §Secrets Registry (Full List) — do NOT omit any entry; this is the missing-secret tracker the Phase 70 provisioner uses.

Two tables:

(1) **Supabase Function Secrets** — one row per server secret with columns: Secret Name | Vendor | Status (`[EXISTING]` / `[NEW]` / carry-over) | Rotation cadence | Blast-radius (what breaks if leaked/rotated) | Owner | Set command. Include EVERY secret from RESEARCH §Supabase Function Secrets: RESEND_API_KEY, RESEND_FROM, STRIPE_SECRET_KEY, PLAY_SERVICE_ACCOUNT_JSON, FCM_SERVER_KEY, MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_WEBHOOK_SIGNING_SECRET, CALENDLY_OAUTH_CLIENT_ID, CALENDLY_OAUTH_CLIENT_SECRET, CALENDLY_WEBHOOK_SIGNING_KEY, CALENDLY_API_KEY, BETTER_STACK_API_KEY, BETTER_STACK_PAGE_ID, SENTRY_DSN, ANTHROPIC_API_KEY, ANTHROPIC_CLINICAL_API_KEY, ANTHROPIC_CLINICAL_BAA_ACTIVE, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_PROJECT_KEY, SLACK_WEBHOOK_EXPERIMENTS_URL, SHARE_TOKEN_SECRET, QUARTERLY_NPS_SIGNING_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_P8_KEY, RC_API_KEY_IOS, RC_API_KEY_ANDROID, REVENUECAT_WEBHOOK_SECRET, PLAY_PACKAGE_NAME, VAPID_PRIVATE_KEY. The set command form is `supabase secrets set <NAME>=<value> --project-ref ytnsipxxmzgaebkqmokp` (confirm project-ref against an existing cron migration URL; the ref is the subdomain in the functions URL).

(2) **Vercel Env (Build-Time Public)** — columns: Env Name | Type | Purpose | Set command (`vercel env add <NAME> production`). Include: VITE_VAPID_PUBLIC_KEY, ADMOB_APP_ID_IOS, ADMOB_APP_ID_ANDROID, ADMOB_PUBLISHER_ID, ADSENSE_PUBLISHER_ID, APPLE_TEAM_ID, APPLE_BUNDLE_ID, PLAY_PACKAGE_NAME.

Add an `## Env-name reconciliations` section stating the canonical names and that they override REQUIREMENTS.md aliases: `CALENDLY_OAUTH_CLIENT_ID` (not `CALENDLY_CLIENT_ID`, A11), `ANTHROPIC_CLINICAL_API_KEY` (not `ANTHROPIC_API_KEY_CLINICAL`, A13). Add a `## Notes` section: (a) vercel.json does NOT interpolate env vars — keep dynamic CSP header assembly in Edge Middleware; (b) the Slack smoke posts a `[vendor-smoke] connectivity test — ignore` message to the configured channel; (c) values for `[NEW]` and carry-over secrets are set at the Phase 70 consolidated HUMAN-UAT gate — names are registered now.

Add an `## CI drift guard — required-secret manifest & deferred allowlist` section that Task 3's script reads from (this section IS the source of truth for the guard):
- A **Required (watched) secrets** list = secrets the guard demands exist NOW. At minimum `SENTRY_DSN` (VENDOR-07's named drift target) plus any other already-provisioned `[EXISTING]` secret the guard should hard-require. Mark each "must exist now".
- A **Deferred-to-Phase-70 (pending-provisioning) allowlist** = the `[NEW]`/carry-over secrets whose VALUES land at the Phase 70 HUMAN-UAT gate. The guard WARNS (exit 0) for these during the defer window so CI does not break. Each entry: secret name + "deferred to Phase 70".
- A one-line statement of the guard contract: "The guard FAILS (exit 1) ONLY when a Required secret is missing AND not on the deferred allowlist; missing deferred secrets WARN (exit 0)."
Keep this section in a machine-greppable form (e.g. fenced lists of bare NAMES under clear headings) so the script can parse names if it sources them from the runbook OR so a human keeps the script's embedded lists in sync — Task 3 specifies which.

Add a header note: "This runbook + the /admin/vendor-smoke dashboard are the live missing-secret tracker. No separate checklist doc (CONTEXT decision)."
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && F=leanshot/.planning/runbooks/vendor-secrets.md; test -f "$F" && node -e "const s=require('fs').readFileSync('$F','utf8'); const need=['CALENDLY_OAUTH_CLIENT_ID','ANTHROPIC_CLINICAL_API_KEY','MUX_TOKEN_ID','BETTER_STACK_API_KEY','SHARE_TOKEN_SECRET','VAPID_PRIVATE_KEY','VITE_VAPID_PUBLIC_KEY','supabase secrets set','vercel env add','SENTRY_DSN','deferred','allowlist']; const miss=need.filter(t=>!s.toLowerCase().includes(t.toLowerCase())); if(miss.length){console.error('MISSING runbook tokens:',miss);process.exit(1)} if(s.includes('CALENDLY_CLIENT_ID=')||/ANTHROPIC_API_KEY_CLINICAL/.test(s)){console.error('uses non-canonical env name');process.exit(1)} console.log('RUNBOOK_OK')"</automated>
  </verify>
  <done>vendor-secrets.md exists with the full Supabase + Vercel secret tables (rotation/blast-radius/owner/set-command), the env-name reconciliations section, the missing-secret-tracker note, AND the CI drift guard section (required-secret manifest incl. SENTRY_DSN + deferred-to-Phase-70 allowlist + guard contract).</done>
</task>

<task type="auto">
  <name>Task 3: VENDOR-07 CI drift guard — check-required-secrets.sh + workflow</name>
  <files>scripts/check-required-secrets.sh, .github/workflows/vendor-secrets-drift.yml</files>
  <action>
Closes VENDOR-07 FULLY in Phase 52 (do NOT defer to Phase 67). Two new files, both unique to this plan (no overlap with plans 01/02/03 — they touch supabase/functions/vendor-smoke/*, supabase/migrations/*, and leanshot/src/*).

(A) Create `scripts/check-required-secrets.sh` (repo root `/Users/karstenhaldan/minisite/scripts/`), mirroring the house style of `scripts/p28-rename-diff.sh`: `#!/usr/bin/env bash`, `set -euo pipefail`, a usage/purpose comment header, and chmod +x. Behavior:
- Define two embedded bash arrays sourced from the runbook's `## CI drift guard` section (Task 2): `REQUIRED_SECRETS=( SENTRY_DSN ... )` (the watched/required-now list — `SENTRY_DSN` MUST be present) and `DEFERRED_ALLOWLIST=( ... )` (the `[NEW]`/carry-over names deferred to Phase 70). Add a comment pointing to `leanshot/.planning/runbooks/vendor-secrets.md` as the canonical source these arrays must stay in sync with (keep the lists DRY-by-comment; a future enhancement may parse the runbook directly, but embedded arrays are the deliverable here).
- Discover the set of secret NAMES that currently exist. Supabase: if `supabase` CLI is available AND a project-ref is resolvable (env `SUPABASE_PROJECT_REF` or the hardcoded `ytnsipxxmzgaebkqmokp`), run `supabase secrets list --project-ref <ref>` and parse the NAME column into a set; capture stderr and treat CLI-unavailable / not-authenticated as a soft condition (see below). Vercel (where relevant for the public env names): if `vercel` CLI is available and authenticated, run `vercel env ls production` and parse names; otherwise soft-skip Vercel checks. CRITICAL: never print secret VALUES — `supabase secrets list` shows masked digests/names only; do not echo anything beyond NAMES and status.
- For each name in `REQUIRED_SECRETS`: if present in the discovered set → OK. If MISSING and the name is in `DEFERRED_ALLOWLIST` → print a WARNING line (`WARN: <name> not yet set — deferred to Phase 70`) and do NOT fail. If MISSING and NOT in the allowlist → record a hard failure.
- `SENTRY_DSN` drift detection: SENTRY_DSN is a Required secret and is NOT on the deferred allowlist (it is already provisioned per the runbook) → a missing/renamed SENTRY_DSN is a hard failure. This is the specific VENDOR-07 drift case.
- Exit policy: exit 1 ONLY if ≥1 non-deferred Required secret is missing (print a summary of which). Exit 0 otherwise (including when only deferred secrets are missing, and when the CLIs are unavailable/unauthenticated in an environment without secret access — in CI without secret access, default to a name-manifest self-consistency check: assert every DEFERRED_ALLOWLIST name and SENTRY_DSN appears in the runbook, and that REQUIRED ∩ DEFERRED == ∅, so the guard still catches manifest drift even when it cannot reach Supabase). Print a final `RESULT: pass|fail` line.
- Make the script safe to run locally and in CI: guard all CLI calls with `command -v` checks; use `|| true` where a non-zero CLI exit is expected; never leak Authorization tokens.

(B) Create `.github/workflows/vendor-secrets-drift.yml`, copying the shape of `.github/workflows/mobile-privacy-audit.yml`: `on: push` + `pull_request` to `main` scoped via `paths:` to `scripts/check-required-secrets.sh`, `leanshot/.planning/runbooks/vendor-secrets.md`, and `.github/workflows/vendor-secrets-drift.yml`; `concurrency` group; a single job `secrets-drift-guard` on `ubuntu-latest`, `timeout-minutes: 5`, steps: `actions/checkout@v4` then a `Run required-secrets drift guard` step `run: bash scripts/check-required-secrets.sh`. Pass through `SUPABASE_PROJECT_REF` (and a `SUPABASE_ACCESS_TOKEN` if used for `supabase secrets list`) from `${{ secrets.* }}` via `env:` IF those repo secrets are expected to exist; otherwise rely on the script's name-manifest self-consistency fallback so the job is green without secret access. Add a short comment in the workflow noting that the guard's hard-fail set is `REQUIRED minus DEFERRED` and that `SENTRY_DSN` is watched (VENDOR-07).

Do NOT modify the large shared `.github/workflows/ci.yml` — a dedicated workflow keeps file ownership clean and avoids cross-phase merge conflicts.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && S=scripts/check-required-secrets.sh; W=.github/workflows/vendor-secrets-drift.yml; test -x "$S" && test -f "$W" && bash -n "$S" && grep -q "SENTRY_DSN" "$S" && grep -qiE "deferred|allowlist" "$S" && grep -q "check-required-secrets.sh" "$W" && grep -qE "on:|pull_request|push" "$W" && bash "$S"; rc=$?; echo "guard exit=$rc"; test "$rc" -eq 0 && echo CI_GUARD_OK</automated>
  </verify>
  <done>scripts/check-required-secrets.sh exists, is executable, passes `bash -n`, watches SENTRY_DSN, honors a deferred allowlist (WARN exit 0), hard-fails (exit 1) only on missing non-deferred required secrets, and runs green in an env without Supabase access via the name-manifest fallback; .github/workflows/vendor-secrets-drift.yml invokes it on PR/push. VENDOR-07 closed in Phase 52.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| migration role → vendor_baa_chain | INSERT runs as migration role (full access); service_role write path remains revoked |
| runbook (git) → operator | documents secret NAMES + set-commands; must never contain secret VALUES |
| CI guard → Supabase/Vercel CLI | reads secret NAMES only (masked); never prints VALUES or Authorization tokens |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-52-12 | Information Disclosure | vendor-secrets.md | mitigate | Runbook documents names + dashboard-source set-commands ONLY — zero secret values committed to git; verify gate ensures no `=<value>` literals beyond placeholder form |
| T-52-13 | Tampering | BAA row provenance | mitigate | INSERT via migration role only; runtime status flips go through the `vendor_baa_chain_update` SECDEF RPC (audit-logged); no service_role UPDATE |
| T-52-14 | Information Disclosure | check-required-secrets.sh CLI calls | mitigate | Script parses only NAME columns from `supabase secrets list` (values masked); guards CLI calls with `command -v`; never echoes Authorization tokens or VALUES; `set -euo pipefail` |
| T-52-15 | Tampering | silent required-secret drift (VENDOR-07) | mitigate | CI guard hard-fails on missing non-deferred Required secret (incl. SENTRY_DSN) on every PR/push; deferred allowlist prevents false-fail during Phase 70 provisioning window |
| T-52-SC | Tampering | migration apply / doc / shell script | accept | No package installs; pure SQL + markdown + bash using pre-installed CLIs (supabase/vercel) guarded by command -v |
</threat_model>

<verification>
- Seed migration present, forward-dated, idempotent; all 8 new vendor rows; no UPDATE.
- Runbook present with both secret tables, canonical env names, set-commands, tracker note, AND the CI drift guard section (required manifest + deferred allowlist + contract).
- No secret VALUES in the runbook (names + placeholder set-commands only).
- `scripts/check-required-secrets.sh` executable, `bash -n` clean, watches SENTRY_DSN, deferred allowlist WARNs (exit 0), missing non-deferred required → exit 1, name-manifest fallback green without Supabase access.
- `.github/workflows/vendor-secrets-drift.yml` invokes the guard on PR/push (VENDOR-07 closed in Phase 52 — not deferred to 67).
- Close-out: run the seed migration as part of the same `supabase db push` as 52-02 (after the Fn deploys). The CI guard ships with the repo and needs no db push.
</verification>

<success_criteria>
vendor_baa_chain seeded for all new v1.4 vendors via the existing table (idempotent); vendor-secrets.md fully documents every secret with rotation/blast-radius/owner/set-command, canonical env names, and the CI-guard required/deferred manifest; the VENDOR-07 CI drift guard (script + workflow) ships and catches silent SENTRY_DSN/required-secret drift while WARNing on deferred secrets.
</success_criteria>

<output>
Create `.planning/phases/52-vendor-setup-foundation/52-04-SUMMARY.md` when done. Record: which vendor rows were new vs already present (from the db state), the confirmed project-ref, the env-name reconciliations applied, the contents of the guard's REQUIRED vs DEFERRED lists, and confirmation that VENDOR-07 is closed in Phase 52 (no defer to 67).
</output>
