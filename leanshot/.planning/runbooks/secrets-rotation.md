---
artifact: OPS-01 — secrets rotation runbook
status: active
owner: founder
created: 2026-05-27
next_review_due: 2027-05-27
phase: 67-operational-runbooks-observability
companion: vendor-secrets.md (canonical inventory)
---

# Secrets Rotation Runbook

> **Companion doc:** `vendor-secrets.md` is the canonical inventory (every secret, storage location, set-command).
> **This doc** is the operational *procedure* — what to do when rotating, in what order, and how to verify.

**Project ref:** `ytnsipxxmzgaebkqmokp`
**Cadence:** 90-day default for bearer secrets; 24h emergency for compromised secrets.
**Operator:** Founder until on-call backup added (see `on-call-rotation.md`).

---

## TL;DR — When to rotate

| Trigger | Action | SLA |
|---------|--------|-----|
| 90 days elapsed since last rotation | Scheduled rotation | Within 7-day window |
| Secret leaked in git / Slack / log / screenshot | **Emergency rotation** | Within 1 hour |
| Vendor reports breach affecting your account | **Emergency rotation** | Within 1 hour |
| Employee with access offboarded | Rotate any secrets they could access | Within 24 hours |
| Annual audit / SOC 2 control | Full inventory rotation | Within 30 days |
| Vendor deprecates key format (e.g. Supabase legacy JWT → `sb_secret_*`) | Migrate to new format | Before deprecation cutoff |

---

## Secrets Inventory (high-blast-radius subset)

> Full inventory in `vendor-secrets.md`. Subset below covers the secrets with the largest blast radius and most-likely rotation events.

| Secret | Type | Stored In | Used By | Rotation | Blast Radius | Last Rotated |
|--------|------|-----------|---------|----------|--------------|--------------|
| `SUPABASE_SERVICE_ROLE_KEY` | bearer (`sb_secret_*`) | Supabase Studio + Function Secrets + Vercel env | ~25 Edge Fns + admin scripts | 90d | All server-side auth bypass | — |
| `SUPABASE_DB_PASSWORD` | password | Supabase Studio + `~/.supabase/cli config` | `supabase db push`, `pg_dump` | 180d | Direct Postgres access | — |
| `STRIPE_SECRET_KEY` | bearer (`sk_live_*`) | Supabase Function Secrets + Vercel env | `stripe-checkout`, `stripe-webhook`, `stripe-portal`, `stripe-refund`, etc. | 90d | All Stripe API ops (charges, refunds, customer reads) | — |
| `STRIPE_WEBHOOK_SECRET` | shared HMAC (`whsec_*`) | Supabase Function Secrets | `stripe-webhook` (signature verify) | 90d | Webhook forgery if leaked | — |
| `RESEND_API_KEY` | bearer (`re_*`) | Supabase Function Secrets | all email-sending Fns (~12) | 90d | Email delivery + domain reputation | — |
| `OPENROUTER_API_KEY` | bearer (`sk-or-*`) | Supabase Function Secrets | `ai-chat`, `claude-moderation`, all AI-coach Fns | 90d | LLM spend ($-bound), AI features | — |
| `ANTHROPIC_CLINICAL_API_KEY` | bearer (`sk-ant-*`) | Supabase Function Secrets | `ai-chat` (clinical-restricted path) | 90d | Clinical AI calls | — |
| `COHERE_API_KEY` | bearer | Supabase Function Secrets | RAG re-ranker (`rag-search`) | 90d | Search quality | — |
| `POSTHOG_PERSONAL_API_KEY` | bearer (`phx_*`) | Supabase Function Secrets | `posthog-server-event`, funnel-alert seeder | 90d | Analytics writes + insight CRUD | — |
| `SLACK_GUARDRAIL_WEBHOOK_URL` | URL with embedded token | Supabase Function Secrets + Vercel env | `_shared/slack-alert.ts` (called by ~20 Fns) | 180d | Internal alerts only (low blast) | — |
| `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` | HMAC secret (32 bytes) | Supabase Function Secrets | `newsletter-send`, `newsletter-unsubscribe` | 365d | Unsubscribe-link forgery (CAN-SPAM) | — |
| `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` | bearer pair | Supabase Function Secrets | `mux-create-upload`, `mux-webhook` | 180d | Video upload + asset reads | — |
| `VAPID_PRIVATE_KEY` | EC P-256 PEM | Supabase Function Secrets | `push-send` (web-push library) | 365d | Push notification forgery | — |
| `VAPID_PUBLIC_KEY` | EC P-256 PEM | `.env.local` as `VITE_VAPID_PUBLIC_KEY` (public OK) | client subscribe call | rotate with private | — (public; rotates with private) | — |
| `SENTRY_AUTH_TOKEN` | bearer | GitHub Actions secret + local `.env.local` | `sentry-cli releases` upload on build | 180d | Source-map upload (low blast) | — |
| `SENTRY_DSN` (web/iOS/Android/Edge) | URL with embedded public key | `.env.local` + Supabase Function Secrets | every layer | 365d (or on org migration) | Error stream redirect | — |
| `CALENDLY_OAUTH_CLIENT_ID` + `CALENDLY_OAUTH_CLIENT_SECRET` | OAuth pair | Supabase Function Secrets | `calendly-oauth-*` Fns | 365d | Coach OAuth attach | — |
| `RC_API_KEY_IOS` + `RC_API_KEY_ANDROID` | bearer | `.env.local` + Apple/Play config | RevenueCat client SDK | 365d | IAP integrity | — |
| `ADMOB_APP_ID_IOS/ANDROID` | identifier (not a secret per se) | `.env.local` + native config | AdMob SDK | n/a | n/a | — |
| `ADSENSE_PUBLISHER_ID` | identifier | `.env.local` | AdSense client | n/a | n/a | — |
| `OPENPHONE_API_KEY` | bearer | Supabase Function Secrets | `sms-send-otp`, `sms-receive-webhook` | 180d | SMS spend + impersonation | — |

> When you rotate any secret, **update the "Last Rotated" column in vendor-secrets.md** (this doc's table is for blast-radius / cadence reference).

---

## Per-Secret Rotation Procedure

### A. `SUPABASE_SERVICE_ROLE_KEY`

**Blast radius.** All server-side `bypassRls=true` operations across every Edge Fn. If leaked, an attacker can read/write any table, regardless of RLS.

**Pre-flight.**
- Confirm Supabase plan supports legacy + new keys concurrently (Pro plan does; Free does NOT).
- Note current key prefix (`sbp_*` legacy vs `sb_secret_*` new format — see `[[reference_supabase_service_role_key_format_divergence]]`).

**Steps.**
1. **Generate new key**: Supabase Studio → Settings → API → "Generate new service_role key" → copy. NEW key is now active; OLD key still valid until revoke.
2. **Update Supabase Function Secrets**:
   ```bash
   npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<new-key>" --project-ref ytnsipxxmzgaebkqmokp
   ```
3. **Update Vercel env var** (Production + Preview): Vercel Dashboard → Project → Settings → Environment Variables → edit `SUPABASE_SERVICE_ROLE_KEY` → paste new → Save.
4. **Redeploy all Edge Fns** to pick up new secret (Supabase Function Secrets are read at cold-start):
   ```bash
   for fn in $(ls leanshot/supabase/functions/ | grep -vE '^(_shared|__tests__)$'); do
     npx supabase functions deploy "$fn" --project-ref ytnsipxxmzgaebkqmokp --no-verify-jwt || echo "FAILED: $fn"
   done
   ```
5. **Redeploy Vercel** (forces all serverless funcs to re-read env vars): `vercel deploy --prod` from `leanshot/` directory.
6. **Smoke test** (verifies the new key is live):
   ```bash
   curl -X POST "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/healthz" \
        -H "Authorization: Bearer $SUPABASE_ANON_KEY" -i | head -20
   ```
   Expect HTTP 200.
7. **Grace period**: 24 hours with both keys live (catches stragglers).
8. **Revoke old key**: Supabase Studio → Settings → API → click revoke next to old key. **THIS IS IRREVERSIBLE.**
9. **Update `vendor-secrets.md`** Last Rotated date.
10. **Audit log**: `psql` → `INSERT INTO ops_audit_log (event, actor, ts) VALUES ('secret_rotated:SUPABASE_SERVICE_ROLE_KEY', '<your-email>', now());`

**Rollback.** If step 6 smoke-test fails: revert step 2 + step 3 to old key, redeploy, investigate. DO NOT revoke old key until smoke passes.

---

### B. `STRIPE_SECRET_KEY`

**Blast radius.** All Stripe API operations: charges, refunds, customer reads, subscription mutations. Stripe supports **dual-key rollover** in their Dashboard — both keys work simultaneously during transition.

**Steps.**
1. **Generate new key**: Stripe Dashboard → Developers → API keys → "Create restricted key" OR "Reveal live key" → "Roll" (creates new + offers grace period). Choose **24h grace** (Stripe default).
2. **Update Supabase Function Secrets**:
   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY="<new-sk_live>" --project-ref ytnsipxxmzgaebkqmokp
   ```
3. **Update Vercel env var** (Production): Vercel Dashboard → edit `STRIPE_SECRET_KEY` → paste new.
4. **Redeploy Stripe-touching Edge Fns** (subset, ~10 Fns):
   ```bash
   for fn in stripe-checkout stripe-webhook stripe-portal stripe-refund stripe-invoice-fetch stripe-tax-id-validate stripe-payment-intent stripe-subscription-cancel stripe-coupon-create stripe-charge-list; do
     npx supabase functions deploy "$fn" --project-ref ytnsipxxmzgaebkqmokp || echo "FAILED: $fn"
   done
   ```
5. **Redeploy Vercel**: `vercel deploy --prod`.
6. **Smoke test**: Create a test checkout session via `stripe-checkout` Fn; expect 200 + valid session ID.
7. **Grace period auto-expires** at Stripe's chosen TTL (24h) — no manual revoke needed; old key dies on the clock.
8. **Update `vendor-secrets.md`**.

**Special note.** `STRIPE_WEBHOOK_SECRET` rotates **independently** from `STRIPE_SECRET_KEY`. See section C.

---

### C. `STRIPE_WEBHOOK_SECRET`

**Blast radius.** Webhook signature verification. If leaked, an attacker can forge `checkout.session.completed` events and grant themselves premium.

**Steps.**
1. **Generate new secret**: Stripe Dashboard → Developers → Webhooks → click your endpoint → "Roll signing secret" → copy the new `whsec_*`.
2. **Stripe sends a 7-day grace period**: both old and new secrets verify during this window. Use it.
3. **Update Supabase Function Secret**:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET="<new-whsec>" --project-ref ytnsipxxmzgaebkqmokp
   ```
4. **Redeploy `stripe-webhook`**:
   ```bash
   npx supabase functions deploy stripe-webhook --project-ref ytnsipxxmzgaebkqmokp
   ```
5. **Smoke test**: Stripe Dashboard → Developers → Webhooks → click endpoint → "Send test event" → `checkout.session.completed`. Verify Supabase logs show HTTP 200 + signature verified.
6. After 7 days, Stripe automatically expires the old secret.

---

### D. `RESEND_API_KEY`

**Steps.**
1. **Generate new key**: Resend Dashboard → API Keys → "Create API Key" → scope: full (or scoped per Fn group if you've split keys).
2. **Update Supabase Function Secret**:
   ```bash
   npx supabase secrets set RESEND_API_KEY="<new-re_>" --project-ref ytnsipxxmzgaebkqmokp
   ```
3. **Redeploy all email-sending Fns** (the `_shared/email-resend.ts` helper reads the env at request time — but cold-start caches it on some runtimes; redeploy is safest):
   ```bash
   for fn in $(grep -l 'RESEND_API_KEY' leanshot/supabase/functions/*/index.ts | awk -F'/' '{print $(NF-1)}'); do
     npx supabase functions deploy "$fn" --project-ref ytnsipxxmzgaebkqmokp || echo "FAILED: $fn"
   done
   ```
4. **Smoke test**: Trigger a transactional email (e.g. `magic-link-send` or `welcome-email-send`); verify Resend Dashboard shows the event with the new key's prefix.
5. **Revoke old key** in Resend Dashboard after smoke passes.

---

### E. `OPENROUTER_API_KEY` (and `ANTHROPIC_CLINICAL_API_KEY`)

**Blast radius.** AI features only — coach goes degraded but app stays up (per CLAUDE.md AI dependency constraint).

**Steps.**
1. **Generate new key**: OpenRouter Dashboard → API Keys → Create.
2. **Update Supabase Function Secret**:
   ```bash
   npx supabase secrets set OPENROUTER_API_KEY="<new-sk-or>" --project-ref ytnsipxxmzgaebkqmokp
   ```
3. **Redeploy AI Fns**:
   ```bash
   for fn in ai-chat claude-moderation rag-search insights-llm-summarize; do
     npx supabase functions deploy "$fn" --project-ref ytnsipxxmzgaebkqmokp || echo "FAILED: $fn"
   done
   ```
4. **Smoke test**: Open `/admin/ai-smoke` → "Run smoke" → expect ≥3 of 4 model calls return 200.
5. **Revoke old key**.

(`ANTHROPIC_CLINICAL_API_KEY` follows the same pattern, replacing `OPENROUTER_API_KEY` → `ANTHROPIC_CLINICAL_API_KEY` and Fn set → just `ai-chat`.)

---

### F. `COHERE_API_KEY`

**Steps.** Identical to OpenRouter (Fn set: `rag-search` only).

---

### G. `POSTHOG_PERSONAL_API_KEY`

**Steps.**
1. PostHog → My account → Personal API Keys → Create.
2. `npx supabase secrets set POSTHOG_PERSONAL_API_KEY="<new>" --project-ref ytnsipxxmzgaebkqmokp`
3. Redeploy `posthog-server-event` + `posthog-funnel-alert-seed` Fns.
4. Re-run `scripts/posthog/seed-funnel-alerts.sh` to verify Insights CRUD works.
5. Revoke old in PostHog UI.

---

### H. `SLACK_GUARDRAIL_WEBHOOK_URL`

**Blast radius.** Internal alert posting only. **Low**.

**Steps.**
1. Slack App → Manage webhooks → revoke old URL → create new for same channel.
2. `npx supabase secrets set SLACK_GUARDRAIL_WEBHOOK_URL="<new>" --project-ref ytnsipxxmzgaebkqmokp`
3. Redeploy any Fn (the shared helper reads env at request time): pick one (e.g. `ai-chat`) and redeploy to force re-read across the runtime.
4. Smoke test: Trigger a known-fires alert path (e.g. set `OPENROUTER_API_KEY=invalid` for 1 request, see Slack message arrive, then revert).

---

### I. `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY`

**Blast radius.** Unsubscribe-link forgery. **High** for CAN-SPAM compliance.

**Steps.**
1. Generate new 32-byte HMAC: `openssl rand -hex 32`.
2. `npx supabase secrets set NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY="<new>" --project-ref ytnsipxxmzgaebkqmokp`
3. **CRITICAL**: All existing `/unsubscribe?u=<userId>&t=<token>` links from past newsletters will break on key swap. Two options:
   - **Dual-key window (recommended)**: deploy `newsletter-unsubscribe` with BOTH old and new keys (env vars `…SIGNING_KEY` + `…SIGNING_KEY_PREVIOUS`), verify either, then drop old after 90 days (covers all sent newsletters).
   - **Hard cutover**: accept that all links in newsletters >24h old will 401; force-resubscribe via banner.
4. Redeploy `newsletter-unsubscribe` Fn.
5. Update `vendor-secrets.md` AND retain `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY_PREVIOUS` for 90 days then remove.

---

### J. `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET`

**Steps.**
1. Mux Dashboard → Settings → Access Tokens → revoke old token → create new with same scopes (Video, Data).
2. Update BOTH secrets in one call:
   ```bash
   npx supabase secrets set MUX_TOKEN_ID="<new-id>" MUX_TOKEN_SECRET="<new-secret>" --project-ref ytnsipxxmzgaebkqmokp
   ```
3. Redeploy `mux-create-upload` AND `mux-webhook` **atomically** (per `[[reference_mux_fn_pair_deploy_passthrough_drift]]`).
4. Smoke test: Upload a video via `/admin/upload-test` → verify Mux Dashboard shows asset with new token's auth.

---

### K. `VAPID_PRIVATE_KEY` (+ pub)

**Blast radius.** Push notification subscriptions go invalid on rotation — users must re-subscribe.

**Steps.**
1. Generate new pair:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Update private in Supabase: `npx supabase secrets set VAPID_PRIVATE_KEY="<new-priv>" --project-ref ytnsipxxmzgaebkqmokp`
3. Update public in `.env.local` for next Vercel build: `VITE_VAPID_PUBLIC_KEY=<new-pub>`.
4. `vercel deploy --prod`.
5. Redeploy `push-send` Fn.
6. **All existing push subscriptions are now stale.** They will silently fail at send-time. Client SW must re-subscribe with the new pub key on next visit (handled automatically by `pushSubscribe()` flow if it detects mismatch). Audit `push_subscriptions` table: expect rows to gradually refresh; stale rows after 30d may be deleted.

---

### L. `SENTRY_DSN` (web/iOS/Android/Edge)

**Blast radius.** Error stream redirect. **Low** — old DSN keeps working until you revoke at Sentry side; new DSN starts receiving.

**Steps.**
1. Sentry → Settings → Projects → leanshot → Client Keys (DSN) → Generate New Key.
2. Update `.env.local`:
   ```text
   VITE_SENTRY_DSN_WEB=<new>
   VITE_SENTRY_DSN_IOS=<new>
   VITE_SENTRY_DSN_ANDROID=<new>
   ```
3. Update Supabase Function Secret: `SENTRY_DSN=<new-edge-dsn>`.
4. `vercel deploy --prod` and redeploy Edge Fns.
5. Smoke test: trigger a known error → confirm it lands on Sentry under the new key.
6. Revoke old DSN in Sentry.

---

## Emergency Rotation (compromised secret)

> **Trigger.** Secret leaked in git diff, public log, Slack screenshot, vendor reports breach affecting your tenancy, or you suspect compromise.

**Time budget: 60 minutes from detection to revoked.**

**Steps.**
1. **Confirm compromise** (5 min). Search git history (`git log -p --all -S '<token-prefix>'`), Slack, PostHog session recordings, error logs.
2. **File the incident** (5 min). Severity P1 if PHI accessible (Supabase service role, Stripe secret); P2 if isolated vendor (Resend, Cohere). See `incident-response.md`.
3. **Skip grace period.** Revoke OLD key immediately in source dashboard. (For Stripe, choose 0h roll instead of 24h.) Acknowledge: this WILL break in-flight requests for ~5-30 seconds.
4. **Generate + deploy NEW key** following the per-secret procedure above.
5. **Forensics** (parallel to step 4). Pull access logs for the rotation window:
   - Supabase logs: Studio → Logs → filter by `auth.token` containing old prefix.
   - Stripe: Dashboard → Developers → Logs → filter requests by API key fingerprint.
   - Sentry: search events for `Authorization: Bearer <old-prefix>*`.
6. **Document in audit log**: `INSERT INTO ops_audit_log (event, actor, severity, ts, notes) VALUES ('emergency_secret_rotation:<NAME>', '<email>', 'P1', now(), '<leak source>');`
7. **HIPAA breach assessment** (if PHI-touching secret): start the §164.404 60-day clock per `incident-response.md` IF you cannot rule out exposure.
8. **Post-incident**: blameless postmortem within 5 business days (see `incident-response.md`).

---

## Verification Checklist (any rotation)

- [ ] New key deployed to **all** storage locations (Supabase Function Secrets + Vercel env + `.env.local` where applicable)
- [ ] All consuming Fns redeployed (env vars only re-read at cold start)
- [ ] Vercel redeployed (serverless funcs)
- [ ] Smoke test passed (per-secret table above)
- [ ] Old key revoked (after grace period for non-emergency rotation)
- [ ] `vendor-secrets.md` "Last Rotated" updated
- [ ] `ops_audit_log` row inserted
- [ ] If emergency: incident report filed, postmortem scheduled

---

## Tooling references

- **Supabase Function Secrets CLI**: `npx supabase secrets {list|set|unset} --project-ref ytnsipxxmzgaebkqmokp`
- **Vercel env CLI**: `vercel env {ls|add|rm} <NAME> production` (requires `vercel login`)
- **Stripe Dashboard secrets**: https://dashboard.stripe.com/apikeys + https://dashboard.stripe.com/webhooks
- **OpenRouter Dashboard**: https://openrouter.ai/keys
- **Resend Dashboard**: https://resend.com/api-keys
- **PostHog API keys**: https://us.posthog.com/settings/user-api-keys
- **Sentry DSN**: https://sentry.io/settings/<org>/projects/leanshot/keys/

---

## Lessons learned

- `[[reference_supabase_service_role_key_format_divergence]]` — switching from legacy `sbp_*` JWT to new `sb_secret_*` MUST happen at HMAC auth call-sites simultaneously.
- `[[reference_mux_fn_pair_deploy_passthrough_drift]]` — Mux Fn pair MUST deploy atomically.
- `[[feedback_vault_to_env_var_fast_path_pattern]]` — when rotating, prefer `Deno.env.get()` fast-path BEFORE vault lookup; reduces failure modes during the swap window.
