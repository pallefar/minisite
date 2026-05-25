---
phase: 52-vendor-setup-foundation
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql
  - leanshot/.planning/runbooks/vendor-secrets.md
autonomous: true
requirements: [VENDOR-01, VENDOR-02, VENDOR-04, VENDOR-05, VENDOR-06, VENDOR-09, VENDOR-10, VENDOR-12]
user_setup: []

must_haves:
  truths:
    - "A vendor_baa_chain row exists for each new Phase 52 vendor (Mux, Apple Developer, Google Play, Calendly, Better Stack, RevenueCat, AdMob/AdSense, Stripe)"
    - "The seed migration is idempotent (ON CONFLICT DO NOTHING) and forward-dated"
    - "runbooks/vendor-secrets.md lists every secret name with storage location, rotation cadence, blast-radius, owner, and the literal set-command"
    - "The runbook canonicalizes the reconciled env names (CALENDLY_OAUTH_CLIENT_ID, ANTHROPIC_CLINICAL_API_KEY)"
  artifacts:
    - path: "supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql"
      provides: "INSERT new vendor BAA rows via migration role, ON CONFLICT DO NOTHING"
      contains: "vendor_baa_chain"
    - path: "leanshot/.planning/runbooks/vendor-secrets.md"
      provides: "Per-secret registry: name, storage, rotation, blast-radius, owner, set-command"
      min_lines: 60
  key_links:
    - from: "20280101000002_vendor_baa_chain_p52_seed.sql"
      to: "vendor_baa_chain table"
      via: "INSERT ... ON CONFLICT (vendor_name) DO NOTHING"
      pattern: "on conflict \\(vendor_name\\) do nothing"
---

<objective>
Seed `vendor_baa_chain` with rows for the new Phase 52 vendors (reusing the existing Phase 25 table — NO parallel table) and author `runbooks/vendor-secrets.md` documenting every secret name, storage, rotation cadence, blast-radius, owner, and its literal set-command.

Purpose: VENDOR-10 (BAA chain re-verified for v1.4 additions) + VENDOR-12 (secrets runbook). The runbook is the live missing-secret tracker companion to the smoke dashboard; it is the single source the Phase 70 provisioner works from.
Output: one forward-dated seed migration + `vendor-secrets.md`.
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
  <name>Task 2: Author runbooks/vendor-secrets.md</name>
  <files>leanshot/.planning/runbooks/vendor-secrets.md</files>
  <action>
Create `leanshot/.planning/runbooks/vendor-secrets.md` alongside `hbnr-incident-response.md`. This is VENDOR-12: the authoritative per-secret registry. Source the full secret list from RESEARCH §Secrets Registry (Full List) — do NOT omit any entry; this is the missing-secret tracker the Phase 70 provisioner uses.

Two tables:

(1) **Supabase Function Secrets** — one row per server secret with columns: Secret Name | Vendor | Status (`[EXISTING]` / `[NEW]` / carry-over) | Rotation cadence | Blast-radius (what breaks if leaked/rotated) | Owner | Set command. Include EVERY secret from RESEARCH §Supabase Function Secrets: RESEND_API_KEY, RESEND_FROM, STRIPE_SECRET_KEY, PLAY_SERVICE_ACCOUNT_JSON, FCM_SERVER_KEY, MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_WEBHOOK_SIGNING_SECRET, CALENDLY_OAUTH_CLIENT_ID, CALENDLY_OAUTH_CLIENT_SECRET, CALENDLY_WEBHOOK_SIGNING_KEY, CALENDLY_API_KEY, BETTER_STACK_API_KEY, BETTER_STACK_PAGE_ID, SENTRY_DSN, ANTHROPIC_API_KEY, ANTHROPIC_CLINICAL_API_KEY, ANTHROPIC_CLINICAL_BAA_ACTIVE, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_PROJECT_KEY, SLACK_WEBHOOK_EXPERIMENTS_URL, SHARE_TOKEN_SECRET, QUARTERLY_NPS_SIGNING_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_P8_KEY, RC_API_KEY_IOS, RC_API_KEY_ANDROID, REVENUECAT_WEBHOOK_SECRET, PLAY_PACKAGE_NAME, VAPID_PRIVATE_KEY. The set command form is `supabase secrets set <NAME>=<value> --project-ref ytnsipxxmzgaebkqmokp` (confirm project-ref against an existing cron migration URL; the ref is the subdomain in the functions URL).

(2) **Vercel Env (Build-Time Public)** — columns: Env Name | Type | Purpose | Set command (`vercel env add <NAME> production`). Include: VITE_VAPID_PUBLIC_KEY, ADMOB_APP_ID_IOS, ADMOB_APP_ID_ANDROID, ADMOB_PUBLISHER_ID, ADSENSE_PUBLISHER_ID, APPLE_TEAM_ID, APPLE_BUNDLE_ID, PLAY_PACKAGE_NAME.

Add an `## Env-name reconciliations` section stating the canonical names and that they override REQUIREMENTS.md aliases: `CALENDLY_OAUTH_CLIENT_ID` (not `CALENDLY_CLIENT_ID`, A11), `ANTHROPIC_CLINICAL_API_KEY` (not `ANTHROPIC_API_KEY_CLINICAL`, A13). Add a `## Notes` section: (a) vercel.json does NOT interpolate env vars — keep dynamic CSP header assembly in Edge Middleware; (b) the Slack smoke posts a `[vendor-smoke] connectivity test — ignore` message to the configured channel; (c) values for `[NEW]` and carry-over secrets are set at the Phase 70 consolidated HUMAN-UAT gate — names are registered now.

Add a header note: "This runbook + the /admin/vendor-smoke dashboard are the live missing-secret tracker. No separate checklist doc (CONTEXT decision)."
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && F=leanshot/.planning/runbooks/vendor-secrets.md; test -f "$F" && node -e "const s=require('fs').readFileSync('$F','utf8'); const need=['CALENDLY_OAUTH_CLIENT_ID','ANTHROPIC_CLINICAL_API_KEY','MUX_TOKEN_ID','BETTER_STACK_API_KEY','SHARE_TOKEN_SECRET','VAPID_PRIVATE_KEY','VITE_VAPID_PUBLIC_KEY','supabase secrets set','vercel env add']; const miss=need.filter(t=>!s.includes(t)); if(miss.length){console.error('MISSING runbook tokens:',miss);process.exit(1)} if(s.includes('CALENDLY_CLIENT_ID=')||/ANTHROPIC_API_KEY_CLINICAL/.test(s)){console.error('uses non-canonical env name');process.exit(1)} console.log('RUNBOOK_OK')"</automated>
  </verify>
  <done>vendor-secrets.md exists with the full Supabase + Vercel secret tables (rotation/blast-radius/owner/set-command), the env-name reconciliations section using canonical names, and the missing-secret-tracker note.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| migration role → vendor_baa_chain | INSERT runs as migration role (full access); service_role write path remains revoked |
| runbook (git) → operator | documents secret NAMES + set-commands; must never contain secret VALUES |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-52-12 | Information Disclosure | vendor-secrets.md | mitigate | Runbook documents names + dashboard-source set-commands ONLY — zero secret values committed to git; verify gate ensures no `=<value>` literals beyond placeholder form |
| T-52-13 | Tampering | BAA row provenance | mitigate | INSERT via migration role only; runtime status flips go through the `vendor_baa_chain_update` SECDEF RPC (audit-logged); no service_role UPDATE |
| T-52-SC | Tampering | migration apply / doc | accept | No package installs; pure SQL + markdown |
</threat_model>

<verification>
- Seed migration present, forward-dated, idempotent; all 8 new vendor rows; no UPDATE.
- Runbook present with both secret tables, canonical env names, set-commands, and tracker note.
- No secret VALUES in the runbook (names + placeholder set-commands only).
- Close-out: run this seed migration as part of the same `supabase db push` as 52-02 (after the Fn deploys).
</verification>

<success_criteria>
vendor_baa_chain seeded for all new v1.4 vendors via the existing table (idempotent); vendor-secrets.md fully documents every secret with rotation/blast-radius/owner/set-command and canonical env names.
</success_criteria>

<output>
Create `.planning/phases/52-vendor-setup-foundation/52-04-SUMMARY.md` when done. Record: which vendor rows were new vs already present (from the db state), the confirmed project-ref, and the env-name reconciliations applied.
</output>
