---
plan: "70-01-vendor-oauth-secrets"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-01
  - UAT-03
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/vendor-oauth-secrets/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md
  - scripts/uat-defer.sh
fixture_group: "vendor-oauth-secrets"
estimated_duration: "3-4 hours operator time (excluding Apple Dev / AdMob / AdSense approval lead time)"
must_haves:
  - "vendor-oauth-secrets-S01-share-token-secret-vault"
  - "vendor-oauth-secrets-S02-vercel-share-token-env"
  - "vendor-oauth-secrets-S05-posthog-personal-api-key"
  - "vendor-oauth-secrets-S06-stripe-price-lifetime"
  - "vendor-oauth-secrets-S07-mux-secrets"
  - "vendor-oauth-secrets-S08-stripe-coupon-wb-3mo-50"
  - "vendor-oauth-secrets-S09-stripe-coupon-wb-6mo-30"
  - "vendor-oauth-secrets-S10-stripe-coupon-wb-lifetime-20"
  - "vendor-oauth-secrets-S11-newsletter-physical-address"
  - "vendor-oauth-secrets-S12-better-stack-api-key"
  - "vendor-oauth-secrets-S13-physical-address"
  - "vendor-oauth-secrets-S14-apple-dev-team-id-bundle"
  - "vendor-oauth-secrets-S15-sign-in-with-apple-client-secret"
  - "vendor-oauth-secrets-S18-admob-publisher-id"
  - "vendor-oauth-secrets-S20-uat-defer-script"
---

<objective>
Plan 01 — Vendor OAuth + Secrets. Operator-facing HUMAN-UAT checklist that verifies every external-vendor account, OAuth client, API key, and Function Secret/Vault entry the v1.4 launch depends on. Covers the originating v1.3 vendor-bootstrap signals (Phase 35 share-token + Phase 36 PostHog Experiment + Phase 43 Stripe lifetime + Phase 44 Mux), every vendor signal new in v1.4 (Phase 52 BAA chain + secret presence drift-guard, Phase 53 Apple Dev + Play, Phase 56 AdMob/AdSense, Phase 59 Sign-in-with-Apple, Phase 67 Better Stack, Phase 64 CAN-SPAM physical address), AND the 6 Phase-65/66/67-deferred secrets surfaced by Phase 69.7 (3 STRIPE_COUPON_WB_*, NEWSLETTER_PHYSICAL_ADDRESS, BETTER_STACK_API_KEY, PHYSICAL_ADDRESS).

Plan also ships the **only code-write artifact in all of Phase 70** — `scripts/uat-defer.sh` — the small gh-cli wrapper that opens deferral issues tagged `v1.4-launch-deferral`.

Purpose: every other Phase 70 plan presumes secrets are set; this plan unblocks them. UAT-01 (v1.3 vendor signals replayed at staging) + UAT-03 (new v1.4 vendor secrets + OAuth) coverage.

Output: signoff checkboxes filled inline + evidence committed to `.planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/vendor-oauth-secrets/<signal-slug>/` + `scripts/uat-defer.sh` committed.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/PROJECT.md
@.planning/milestones/v1.3-uat-deferred.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
@.planning/phases/52-vendor-setup-foundation/52-04-SUMMARY.md
@.planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md

Project Supabase ref: `ytnsipxxmzgaebkqmokp`. Vercel project: `leanshot-marketing` (org `karstens-projects-16afd0e4`, project id `prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc`). Local repo root: `/Users/karstenhaldan/minisite/leanshot`. Vendor secrets verification commands documented top-of-PROJECT.md.

Operator profile: karsten.haldan@gmail.com (single-founder go/no-go authority).
</context>

<tasks>

<task id="01-S01" name="Signal — Share-token signing secret in Supabase Vault">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S01-share-token-secret-vault</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 1
  </read_first>
  <action>
1. Generate a 32-byte random hex (do NOT commit the value to git or paste into any chat surface):
   `openssl rand -hex 32`
2. Hold the value in a local shell variable: `export YOUR_SECRET=<paste>`.
3. Insert into Supabase Vault via Dashboard → SQL Editor at https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/sql/new — run:
   `select vault.create_secret('<YOUR_SECRET>', 'share_token_secret', 'Phase 35 share-token signing (HMAC-SHA256)');`
4. Verify both expected vault rows are present:
   `npx supabase db query --linked "select name from vault.secrets where name in ('share_token_secret', 'service_role_key') order by name;"`
   Expected: 2 rows returned (`service_role_key` was seeded by Phase 52).
5. Redact the secret value from any terminal scrollback before capturing evidence. Save the redacted CLI output to evidence dir.
  </action>
  <acceptance_criteria>
    - `vault.secrets` query returns exactly 2 rows for the two named secrets
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence committed to .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/vendor-oauth-secrets/S01-share-token-secret-vault/cli-output.txt
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Share-card OG generation is blocked without this secret. If you cannot complete now, halt Phase 70 entirely until resolved.
  </defer_clause>
</task>

<task id="01-S02" name="Signal — SHARE_TOKEN_SECRET in Vercel env">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S02-vercel-share-token-env</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 2
  </read_first>
  <action>
1. `cd /Users/karstenhaldan/minisite/leanshot`
2. Set the env var in Vercel production scope. Value MUST match `YOUR_SECRET` used in S01:
   `echo '<same-value-as-YOUR_SECRET>' | vercel env add SHARE_TOKEN_SECRET production`
3. Verify presence:
   `vercel env ls production | grep SHARE_TOKEN_SECRET`
   Expected: exactly 1 row, scope=production.
4. If Vercel CLI ambient-auth fails, run `vercel login` first; if project is unlinked, `vercel link --yes --project leanshot-marketing`.
5. Capture redacted CLI output to evidence dir.
  </action>
  <acceptance_criteria>
    - `vercel env ls production` shows SHARE_TOKEN_SECRET = encrypted (1 row)
    - value matches S01 (visually verified by operator at type-in)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S02-vercel-share-token-env/vercel-env-ls.txt
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Edge function HMAC verify will reject all share-card requests if SHARE_TOKEN_SECRET diverges from vault.
  </defer_clause>
</task>

<task id="01-S03" name="Signal — Trustpilot vendor profile claim + claimed flag">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S03-trustpilot-vendor-claimed</signal_id>
  <criticality>non-critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 36 — Signal 2 (Trustpilot row)
  </read_first>
  <action>
1. Visit https://business.trustpilot.com/signup → sign up + claim `leanshot.app` domain (use karsten.haldan@gmail.com).
2. Once claim confirmation email lands, flip the DB flag:
   `supabase db query --linked "UPDATE public.review_cta_catalog SET claimed=true WHERE slug='trustpilot' RETURNING slug, claimed;"`
   Expected: 1 row returned with claimed=true.
3. Capture screenshot of Trustpilot dashboard showing claimed business + CLI output.

Defer is acceptable: Surface B fallback renders "Thanks for the rating!" no-CTA per the UI-SPEC vendor-block fallback. Each profile claim is independent.
  </action>
  <acceptance_criteria>
    - claimed flag = true in review_cta_catalog OR `defer:trustpilot-defer-to-post-launch` recorded
    - if approved: screenshot of Trustpilot dashboard + CLI proof
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S03-trustpilot-vendor-claimed/
  </acceptance_criteria>
  <defer_clause>
    Defer-OK. Run `scripts/uat-defer.sh trustpilot-vendor-claimed 'claim takes 5+ business days; fallback ships ok'`. Open issue tagged `v1.4-launch-deferral`.
  </defer_clause>
</task>

<task id="01-S04" name="Signal — G2 + Capterra vendor profile claims">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S04-g2-capterra-vendor-claimed</signal_id>
  <criticality>non-critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 36 — Signal 2 (G2 + Capterra rows)
  </read_first>
  <action>
1. **G2**: https://sell.g2.com → claim LeanShot vendor profile → then:
   `supabase db query --linked "UPDATE public.review_cta_catalog SET claimed=true WHERE slug='g2' RETURNING slug, claimed;"`
2. **Capterra**: https://www.capterra.com/vendors → claim LeanShot listing → then:
   `supabase db query --linked "UPDATE public.review_cta_catalog SET claimed=true WHERE slug='capterra' RETURNING slug, claimed;"`
3. Each claim is independent. Capture dashboard screenshot + CLI output per platform.
  </action>
  <acceptance_criteria>
    - both `claimed=true` rows OR per-platform `defer:` clauses
    - per-platform evidence dir
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>
    Defer-OK per platform. Vendor-gated soft fallback renders correctly until claimed.
  </defer_clause>
</task>

<task id="01-S05" name="Signal — PostHog Experiment + POSTHOG_PERSONAL_API_KEY Function Secret">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S05-posthog-personal-api-key</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 36 — Signal 3
  </read_first>
  <action>
1. Sign in to PostHog (project 140479, org pallefat) at https://app.posthog.com.
2. Create an Experiment on feature flag `nps_prompt_copy` with two variants: `control` and `variant_a`. Configure copy payloads in the experiment dashboard. Save + start the experiment.
3. Generate a Personal API key: PostHog Settings → Personal API keys → "Create personal API key" with scopes `experiment:read`, `feature_flag:read`. Copy the key.
4. Set as Supabase Function Secret:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep POSTHOG_PERSONAL_API_KEY || supabase secrets set --project-ref ytnsipxxmzgaebkqmokp POSTHOG_PERSONAL_API_KEY=&lt;paste-value&gt;`
5. Verify:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep POSTHOG_PERSONAL_API_KEY`
6. Smoke the gateway: call `nps-trigger-decide` Edge Fn with a test user; verify response now returns `copy_variant` matching one of the experiment variants (NOT `control` fallback).
  </action>
  <acceptance_criteria>
    - PostHog experiment dashboard shows `nps_prompt_copy` experiment status=running
    - `supabase secrets list` includes POSTHOG_PERSONAL_API_KEY row
    - `nps-trigger-decide` returns a non-fallback variant for a primed user
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S05-posthog-personal-api-key/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. NPS Ship Winner button stays 503 vendor-gated until set; Phase 36 surfaces remain dark.
  </defer_clause>
</task>

<task id="01-S06" name="Signal — Stripe Lifetime Product + STRIPE_PRICE_LIFETIME secret + price lookup seed">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S06-stripe-price-lifetime</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 43 — Signal A
  </read_first>
  <action>
1. Stripe Dashboard https://dashboard.stripe.com → Products → "Add product". Name: "LeanShot Lifetime". One-time price: $499 USD. Save → copy the `price.id` (starts with `price_`).
2. Set Function Secret:
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_PRICE_LIFETIME=&lt;price.id&gt;`
3. Seed price lookup table:
   `supabase db query --linked "INSERT INTO public.stripe_price_lookup (key, stripe_price_id) VALUES ('lifetime', '&lt;price.id&gt;') ON CONFLICT (key) DO UPDATE SET stripe_price_id=EXCLUDED.stripe_price_id RETURNING *;"`
4. Verify both:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep STRIPE_PRICE_LIFETIME`
   `supabase db query --linked "SELECT * FROM public.stripe_price_lookup WHERE key='lifetime';"`
  </action>
  <acceptance_criteria>
    - Stripe product page shows Lifetime SKU live with the captured price.id
    - Function Secret + lookup row both present
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S06-stripe-price-lifetime/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. MEMBER-01 lifetime checkout returns 503 until set; blocks Plan 02 Stripe-test S04.
  </defer_clause>
</task>

<task id="01-S07" name="Signal — Mux Function Secrets (MUX_TOKEN_ID/SECRET/WEBHOOK_SECRET)">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S07-mux-secrets</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 44 — Prerequisite block
  </read_first>
  <action>
1. https://dashboard.mux.com/settings/access-tokens → "Generate new token" with permissions: `Mux Video → Read + Write`. Capture `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET`.
2. Mux Dashboard → Settings → Webhooks → "Create webhook". URL: `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/mux-webhook`. Events: all `video.asset.*` + `video.upload.*`. Copy the signing secret as `MUX_WEBHOOK_SECRET`.
3. Set all three Function Secrets:
   `cd /Users/karstenhaldan/minisite/supabase && npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... MUX_WEBHOOK_SECRET=...`
4. Verify:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E '^(MUX_TOKEN_ID|MUX_TOKEN_SECRET|MUX_WEBHOOK_SECRET)'`
5. Smoke: ping `mux-create-upload` Edge Fn with anon bearer; expect 200 + upload URL (NOT 503 vendor-gated).
  </action>
  <acceptance_criteria>
    - 3 secret rows present in `supabase secrets list`
    - mux-create-upload responds 200 with usable upload URL
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S07-mux-secrets/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Plan 03 browser community-video Signal blocks here; iOS/Android device community surfaces also affected.
  </defer_clause>
</task>

<task id="01-S08" name="Signal — STRIPE_COUPON_WB_3MO_50 created + Function Secret set">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S08-stripe-coupon-wb-3mo-50</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md §"5 HUMAN signals" rows 2-3
    - .planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md
  </read_first>
  <action>
1. Stripe Dashboard https://dashboard.stripe.com/coupons → "New coupon". Name: "Win-back 3-month 50% off". Type: Percentage. Percent off: 50. Duration: Repeating, 3 months. ID: `WB_3MO_50`. Save → copy the coupon ID (Stripe returns it as `WB_3MO_50` if entered manually, otherwise an auto-generated `cust_xxx`).
2. Set Function Secret:
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_COUPON_WB_3MO_50=&lt;coupon-id&gt;`
3. Verify in Stripe + Supabase:
   `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/coupons/&lt;coupon-id&gt;" | jq '.id, .percent_off, .duration, .duration_in_months'`
   Expected: id matches, percent_off=50, duration=repeating, duration_in_months=3
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep STRIPE_COUPON_WB_3MO_50`
  </action>
  <acceptance_criteria>
    - Stripe API returns 50% / repeating / 3-month coupon
    - Function Secret row present
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S08-stripe-coupon-wb-3mo-50/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. lifecycle-win-back cron Edge Fn errors at runtime without coupon ID.
  </defer_clause>
</task>

<task id="01-S09" name="Signal — STRIPE_COUPON_WB_6MO_30 created + Function Secret set">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S09-stripe-coupon-wb-6mo-30</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
  </read_first>
  <action>
1. Stripe Dashboard → New coupon. Name: "Win-back 6-month 30% off". Percent off: 30. Duration: Repeating, 6 months. ID: `WB_6MO_30`. Save.
2. `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_COUPON_WB_6MO_30=&lt;coupon-id&gt;`
3. Verify via Stripe API + supabase secrets list (mirror S08 commands).
  </action>
  <acceptance_criteria>
    - Stripe API returns 30% / repeating / 6-month
    - Function Secret row present
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S09-stripe-coupon-wb-6mo-30/
  </acceptance_criteria>
  <defer_clause>Cannot defer (same as S08).</defer_clause>
</task>

<task id="01-S10" name="Signal — STRIPE_COUPON_WB_LIFETIME_20 created + Function Secret set">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S10-stripe-coupon-wb-lifetime-20</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
  </read_first>
  <action>
1. Stripe Dashboard → New coupon. Name: "Win-back Lifetime 20% off". Percent off: 20. Duration: Once (applies to lifetime SKU once). ID: `WB_LIFETIME_20`. Save.
2. `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_COUPON_WB_LIFETIME_20=&lt;coupon-id&gt;`
3. Verify via Stripe API + secrets list.
  </action>
  <acceptance_criteria>
    - Stripe API returns 20% / once
    - Function Secret row present
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S10-stripe-coupon-wb-lifetime-20/
  </acceptance_criteria>
  <defer_clause>Cannot defer (same as S08).</defer_clause>
</task>

<task id="01-S11" name="Signal — NEWSLETTER_PHYSICAL_ADDRESS Function Secret (CAN-SPAM)">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S11-newsletter-physical-address</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
    - Phase 60 newsletter cron CAN-SPAM blocker note in v1.4 STATE.md
  </read_first>
  <action>
1. Confirm the operating legal business address you want displayed in the newsletter footer (US CAN-SPAM compliance requires a valid postal address; PO box acceptable).
2. Set as Function Secret (single-line value):
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp NEWSLETTER_PHYSICAL_ADDRESS='&lt;Street, City, State ZIP, Country&gt;'`
3. Verify:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep NEWSLETTER_PHYSICAL_ADDRESS`
4. Trigger a test newsletter send via Phase 60 Fn (e.g. `newsletter-dispatch` smoke endpoint or admin "send test") and inspect the email footer — the captured address MUST appear verbatim.
  </action>
  <acceptance_criteria>
    - Function Secret present
    - test newsletter email footer renders the address
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S11-newsletter-physical-address/ (test email screenshot, redact recipient)
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Cron-fired newsletter has a runtime placeholder-string guard (per `feedback_placeholder_string_runtime_guard_pattern`) that returns 503 if unset — newsletter ships dark and FTC CAN-SPAM violation risk.
  </defer_clause>
</task>

<task id="01-S12" name="Signal — BETTER_STACK_API_KEY Function Secret (uptime monitoring)">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S12-better-stack-api-key</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
    - .planning/phases/67-operational-runbooks-observability/67-SUMMARY.md
  </read_first>
  <action>
1. Sign in to Better Stack at https://betterstack.com (or sign up; free tier OK for v1.4).
2. Create a Team Token: Better Stack → Team → API → "Create token". Scope: Uptime + Logs read.
3. Set Function Secret:
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp BETTER_STACK_API_KEY=&lt;token&gt;`
4. Verify the bs-status-poller Edge Fn now returns live monitor data (not vendor-gated stub): smoke with anon bearer (per `reference_supabase_edge_fn_jwt_gateway_healthz`):
   `curl -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "apikey: $SUPABASE_ANON_KEY" https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/bs-status-poller/run`
   Expected: 200 + JSON containing at least one monitor status row.
5. Configure Better Stack to monitor production URL (https://leanshot.app/) + Edge Fn healthz endpoints.
  </action>
  <acceptance_criteria>
    - Function Secret present
    - bs-status-poller returns live monitor data
    - Better Stack dashboard shows at least 1 active monitor
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S12-better-stack-api-key/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Required for Plan 07 48h regression watch — Better Stack uptime is one of the 7 green thresholds.
  </defer_clause>
</task>

<task id="01-S13" name="Signal — PHYSICAL_ADDRESS Function Secret (refund email compliance)">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S13-physical-address</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
  </read_first>
  <action>
1. Identical address value as S11 acceptable (single source of legal address). Set as separate secret because request-refund and newsletter dispatchers reference different env vars.
2. `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp PHYSICAL_ADDRESS='&lt;Street, City, State ZIP, Country&gt;'`
3. Verify presence:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep '^PHYSICAL_ADDRESS$'`
4. Trigger a test refund request via Plan 02 Signal `refund-self-service` smoke or admin UI; inspect generated refund-confirmation email — address must appear in footer.
  </action>
  <acceptance_criteria>
    - Function Secret present
    - refund email footer renders address
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S13-physical-address/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Runtime guard returns 503 in request-refund if unset.</defer_clause>
</task>

<task id="01-S14" name="Signal — Apple Developer account active + APPLE_TEAM_ID/BUNDLE_ID env">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S14-apple-dev-team-id-bundle</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/53-CONTEXT.md
  </read_first>
  <action>
1. Sign in to https://developer.apple.com/account/ — confirm Apple Developer Program membership is **active** (status banner top of page). If pending renewal, halt — operator gate.
2. Capture: Membership → Team ID (e.g. `ABC1234DEF`). Bundle ID for LeanShot iOS app: `app.leanshot.ios` (or equivalent — verify in Certificates, Identifiers & Profiles → Identifiers).
3. Set Vercel env (used by deep-link verification + Universal Links):
   `vercel env add APPLE_TEAM_ID production` (paste value)
   `vercel env add APPLE_BUNDLE_ID production` (paste value)
4. Set Supabase secrets (used by Apple OAuth Edge Fn):
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp APPLE_TEAM_ID=&lt;value&gt; APPLE_BUNDLE_ID=&lt;value&gt;`
5. Verify:
   `vercel env ls production | grep -E 'APPLE_TEAM_ID|APPLE_BUNDLE_ID'`
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E 'APPLE_TEAM_ID|APPLE_BUNDLE_ID'`
6. Capture screenshot of developer.apple.com membership status page (redact admin email if visible).
  </action>
  <acceptance_criteria>
    - Apple Dev membership active, paid through &gt;= v1.4 launch + 1 year
    - 4 env rows present (2 Vercel, 2 Supabase secrets)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S14-apple-dev-team-id-bundle/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Plan 04 iOS-device TestFlight first-build cold-launch blocks here. If Apple Dev signup is pending, halt Phase 70 + escalate.
  </defer_clause>
</task>

<task id="01-S15" name="Signal — Sign-in-with-Apple Service ID + client secret JWT">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S15-sign-in-with-apple-client-secret</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/59-apple-oauth-sign-in-with-apple-onboarding-completion/59-CONTEXT.md
  </read_first>
  <action>
1. https://developer.apple.com/account/resources/identifiers → "+" → Service IDs → "Sign In with Apple" → identifier `app.leanshot.web` (or equivalent). Configure return URL: `https://leanshot.app/auth/apple/callback` + `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`. Save.
2. Certificates → "+" → "Sign In with Apple" → bind to your primary App ID. Download the `.p8` key. Capture Key ID + Team ID.
3. Generate the ES256 client_secret JWT (valid 6 months). Use the Phase 59 helper script if shipped, else use this Node one-liner with `jsonwebtoken`:
   `node -e "const j=require('jsonwebtoken');const k=require('fs').readFileSync('AuthKey_KEYID.p8');console.log(j.sign({},k,{algorithm:'ES256',expiresIn:'180d',issuer:'TEAMID',audience:'https://appleid.apple.com',subject:'app.leanshot.web',keyid:'KEYID'}))"`
4. Set Function Secret:
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp APPLE_CLIENT_SECRET=&lt;jwt&gt; APPLE_SERVICE_ID=app.leanshot.web APPLE_KEY_ID=&lt;keyid&gt;`
5. Configure Supabase Auth provider: Dashboard → Authentication → Providers → Apple → enable, paste Service ID + Team ID + Key ID + Private Key contents. Save.
6. Smoke: try signing in via the web Sign-in-with-Apple button (or Plan 03 Signal); should redirect Apple → callback → land authenticated.
7. **Record expiration date** of the 6-month JWT in evidence dir (operator must rotate before expiry).
  </action>
  <acceptance_criteria>
    - APPLE_CLIENT_SECRET + APPLE_SERVICE_ID + APPLE_KEY_ID secrets present
    - Supabase Auth Apple provider enabled
    - sign-in flow returns to /auth/apple/callback successfully (functional, even if private-relay UAT happens in Plan 04)
    - expiration date documented
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S15-sign-in-with-apple-client-secret/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Plan 04 device Signal `apple-oauth-private-relay` requires this. If Apple Dev membership active but Service ID not configured, halt phase.
  </defer_clause>
</task>

<task id="01-S16" name="Signal — Google Play Developer account + Android signing key">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S16-play-developer-account</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/53-CONTEXT.md
  </read_first>
  <action>
1. https://play.google.com/console → confirm Play Developer account is **active** (status banner). $25 one-time fee paid.
2. Create app: "LeanShot" (or use existing). Note the application ID: `app.leanshot.android`. Open internal testing track.
3. Generate or confirm upload signing key. Capture SHA-1 fingerprint:
   `keytool -list -v -keystore ~/.android/leanshot-upload-key.jks -alias leanshot-upload | grep SHA1`
4. Configure Play Console → Setup → App signing → confirm signing key registered.
5. Verify with Capacitor build (delegated to Plan 05 first-build cold-launch).
6. No Function Secret set here — credentials live in local keystore + Play Console only.
  </action>
  <acceptance_criteria>
    - Play Console shows active membership + LeanShot app draft created
    - signing key SHA-1 captured in evidence (not the keystore itself)
    - internal testing track open
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S16-play-developer-account/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Plan 05 Android device first-build cold-launch blocks here.
  </defer_clause>
</task>

<task id="01-S17" name="Signal — Calendly OAuth client + token rotation">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S17-calendly-oauth</signal_id>
  <criticality>non-critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/52-vendor-setup-foundation/52-04-SUMMARY.md
    - .planning/PROJECT.md (Calendly section if present)
  </read_first>
  <action>
1. https://developer.calendly.com → register OAuth app or confirm existing. Redirect URI: `https://leanshot.app/integrations/calendly/callback` + Supabase callback.
2. Capture CLIENT_ID + CLIENT_SECRET. Set as Function Secrets:
   `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp CALENDLY_CLIENT_ID=... CALENDLY_CLIENT_SECRET=...`
3. Walk through OAuth handshake in the admin UI's Calendly integration page. Capture screenshot of "Connected" state.
4. Defer is OK — book-a-call CTA falls back to a generic mailto: when Calendly disconnected.
  </action>
  <acceptance_criteria>
    - secrets present OR `defer:calendly-defer-to-post-launch`
    - if approved: handshake walkthrough screenshot
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S17-calendly-oauth/
  </acceptance_criteria>
  <defer_clause>
    Defer-OK. Use scripts/uat-defer.sh.
  </defer_clause>
</task>

<task id="01-S18" name="Signal — AdMob publisher account + ADMOB_PUBLISHER_ID env">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S18-admob-publisher-id</signal_id>
  <criticality>critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/56-ad-network/56-CONTEXT.md (if exists)
    - ROADMAP Phase 56 row
  </read_first>
  <action>
1. https://admob.google.com → sign in (or sign up with karsten.haldan@gmail.com). Account approval can take 24-72h — start early.
2. Once approved, capture publisher ID: AdMob → Settings → Account → Publisher ID (`pub-XXXXXXXXXXXXXXXX`).
3. Register iOS + Android apps in AdMob. For each, capture App ID + ad-unit IDs (banner + interstitial as configured by Phase 56).
4. Set Capacitor env vars in `leanshot/capacitor.config.ts` (or `.env.production`) via Vercel:
   `vercel env add ADMOB_PUBLISHER_ID production` + iOS + Android app IDs.
5. Verify ad unit returns test ad on dev device (Plan 05 device Signal `ads-render-on-consumer-only`).
  </action>
  <acceptance_criteria>
    - AdMob dashboard shows approved publisher account
    - publisher ID + iOS App ID + Android App ID set as env vars
    - test ad served on iOS + Android dev devices (smoke from Plan 04/05)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S18-admob-publisher-id/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer for v1.4 — Phase 56 ad-network requirement core to consumer monetization. If AdMob still in approval, halt Phase 70 ad-related signals until cleared. Document defer as `defer:admob-pending-approval` only with explicit founder go.
  </defer_clause>
</task>

<task id="01-S19" name="Signal — Google AdSense publisher (web landing pages)">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S19-adsense-publisher</signal_id>
  <criticality>non-critical</criticality>
  <fixture>vendor-oauth</fixture>
  <read_first>
    - .planning/phases/56-ad-network/ (if exists)
    - .planning/phases/68-audience-landing-sales-enablement/
  </read_first>
  <action>
1. https://www.google.com/adsense → sign in (or sign up). Approval requires real traffic; can take days to weeks. **Start early.**
2. Once approved, retrieve publisher ID and ad slot codes for the web landing pages.
3. Wire the AdSense snippet via Vercel env var `ADSENSE_PUBLISHER_ID` + per-slot `ADSENSE_SLOT_*` IDs.
4. Verify a test ad renders on the landing page in incognito mode (no ad-blocker; consumer-only audience surface — confirm zero-ads on clinic/admin paths per Phase 56).
  </action>
  <acceptance_criteria>
    - AdSense approved OR `defer:adsense-pending-approval`
    - if approved: test ad renders on landing page in incognito
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S19-adsense-publisher/
  </acceptance_criteria>
  <defer_clause>
    Defer-OK. AdSense web banner is incremental revenue — primary ad surface is mobile AdMob.
  </defer_clause>
</task>

<task id="01-S20" name="Signal — Ship scripts/uat-defer.sh deferral helper">
  <type>code</type>
  <signal_id>vendor-oauth-secrets-S20-uat-defer-script</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Decisions Area 3 (Defer-recording)
  </read_first>
  <action>
**This is the only code-write task in all of Phase 70.** Write `scripts/uat-defer.sh` — a small bash helper that opens a GitHub issue with label `v1.4-launch-deferral` for a deferred signal and echoes the URL back. The script MUST:

1. Take 2 positional args: `<signal-slug>` `<reason>`.
2. Exit non-zero with usage message if either is missing.
3. Detect the calling Phase 70 plan filename by `git grep -l "&lt;signal-slug&gt;" .planning/phases/70-consolidated-uat-v1-4-launch-gate/*.md | head -1`.
4. Call `gh issue create --label v1.4-launch-deferral --title "UAT defer: &lt;signal-slug&gt;" --body "Deferred from Phase 70.\n\nSignal: &lt;signal-slug&gt;\nReason: &lt;reason&gt;\nPlan: &lt;detected-plan-file&gt;\nDeferred-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)\nDeferred-by: karsten.haldan@gmail.com"`.
5. Echo the returned issue URL.

After writing, `chmod +x scripts/uat-defer.sh`. Smoke it once with a fake slug:
`./scripts/uat-defer.sh fake-test-signal 'smoke test — close after creation'`
Capture the URL, then immediately close that smoke issue:
`gh issue close &lt;num&gt; --comment 'smoke verified'`

Commit alongside this PLAN.md.
  </action>
  <acceptance_criteria>
    - scripts/uat-defer.sh exists, executable, 10-25 lines
    - smoke run created a real `v1.4-launch-deferral` labeled issue (since closed)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/vendor-oauth-secrets/S20-uat-defer-script/ contains smoke-issue URL + close confirmation
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. All other plans presume `scripts/uat-defer.sh` exists for their non-critical signals.
  </defer_clause>
</task>

<task id="01-S21" name="Signal — Evidence directory bootstrap + secret-presence sweep">
  <type>verification</type>
  <signal_id>vendor-oauth-secrets-S21-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Specifics §Evidence directory layout
  </read_first>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/vendor-oauth-secrets/`
2. For each S01..S19 above, create a stub subdir to anchor evidence paths.
3. Run final secret-presence sweep verifying ALL of these are present:
   `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E '^(SHARE_TOKEN_SECRET|POSTHOG_PERSONAL_API_KEY|STRIPE_PRICE_LIFETIME|MUX_TOKEN_ID|MUX_TOKEN_SECRET|MUX_WEBHOOK_SECRET|STRIPE_COUPON_WB_3MO_50|STRIPE_COUPON_WB_6MO_30|STRIPE_COUPON_WB_LIFETIME_20|NEWSLETTER_PHYSICAL_ADDRESS|BETTER_STACK_API_KEY|PHYSICAL_ADDRESS|APPLE_TEAM_ID|APPLE_BUNDLE_ID|APPLE_CLIENT_SECRET|APPLE_SERVICE_ID|APPLE_KEY_ID)$' | wc -l`
   Expected: 17.
4. Capture final sweep output to `evidence/vendor-oauth-secrets/S21-evidence-bootstrap/final-secret-sweep.txt` (with values redacted).
  </action>
  <acceptance_criteria>
    - 17 secret rows present
    - evidence dir tree exists for all S01..S19 signals
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Defer-OK if any non-critical secret deferred; the count will be lower than 17 — annotate which ones.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan operator action — flip the checkbox row below for each signal as it lands. Plan complete when every critical signal is signed off OR explicitly halted (no defer for critical).

`supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | wc -l` returns at least 25 entries (Phase 69.7 baseline 19 + this plan's 17 net adds, accounting for overlaps).
</verification>

<success_criteria>
- All 15 critical signals signed off (S01, S02, S05, S06, S07, S08, S09, S10, S11, S12, S13, S14, S15, S16, S18, S20).
- Non-critical signals (S03, S04, S17, S19, S21) signed OR `defer:<reason>` with GH issue.
- `scripts/uat-defer.sh` committed + smoke-verified.
- Evidence committed under `.planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/vendor-oauth-secrets/`.
</success_criteria>

## Resume State

Operator: fill checkbox + `signoff:` line as each signal completes. If you stop mid-plan, the next session resumes at the first unchecked box.

- [ ] **S01** — vault `share_token_secret` set — signoff: __________
- [ ] **S02** — Vercel `SHARE_TOKEN_SECRET` env — signoff: __________
- [ ] **S03** — Trustpilot vendor claim (non-critical) — signoff: __________
- [ ] **S04** — G2 + Capterra vendor claims (non-critical) — signoff: __________
- [ ] **S05** — PostHog experiment + `POSTHOG_PERSONAL_API_KEY` — signoff: __________
- [ ] **S06** — Stripe Lifetime product + `STRIPE_PRICE_LIFETIME` — signoff: __________
- [ ] **S07** — Mux secrets (3) — signoff: __________
- [ ] **S08** — `STRIPE_COUPON_WB_3MO_50` — signoff: __________
- [ ] **S09** — `STRIPE_COUPON_WB_6MO_30` — signoff: __________
- [ ] **S10** — `STRIPE_COUPON_WB_LIFETIME_20` — signoff: __________
- [ ] **S11** — `NEWSLETTER_PHYSICAL_ADDRESS` — signoff: __________
- [ ] **S12** — `BETTER_STACK_API_KEY` — signoff: __________
- [ ] **S13** — `PHYSICAL_ADDRESS` — signoff: __________
- [ ] **S14** — Apple Dev `APPLE_TEAM_ID` + `APPLE_BUNDLE_ID` — signoff: __________
- [ ] **S15** — Sign-in-with-Apple `APPLE_CLIENT_SECRET` JWT — signoff: __________
- [ ] **S16** — Play Developer account + Android signing key — signoff: __________
- [ ] **S17** — Calendly OAuth (non-critical) — signoff: __________
- [ ] **S18** — AdMob publisher ID + iOS/Android App IDs — signoff: __________
- [ ] **S19** — AdSense publisher (non-critical) — signoff: __________
- [ ] **S20** — `scripts/uat-defer.sh` committed — signoff: __________
- [ ] **S21** — evidence dir bootstrap + final secret sweep — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 21 signals green |
| `approved — non-criticals-deferred` | 15 critical signals green; non-criticals (S03, S04, S17, S19, S21) deferred with GH issues |
| `blocked: <reason>` | Any critical signal cannot land — halt Phase 70 and escalate |

<output>
Update this PLAN.md with inline signoffs as each signal lands. No separate SUMMARY.md (signoff IS the artifact). Plan 08 final-signoff aggregates this file's checkbox state.
</output>
