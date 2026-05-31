---
artifact: VENDOR-12 — vendor secrets runbook
status: active
owner: founder
created: 2026-05-25
next_review_due: 2027-05-25
phase: 52-vendor-setup-foundation
---

# Vendor Secrets Runbook

> This runbook + the /admin/vendor-smoke dashboard are the live missing-secret tracker.
> No separate checklist doc (CONTEXT decision).

**Purpose.** Authoritative registry of every server secret and Vercel env var consumed by LeanShot v1.4. Documents storage location, rotation cadence, blast-radius, owner, and the literal set-command for each secret. The Phase 70 provisioner works from this runbook — it is the single source of truth.

**Project ref:** `ytnsipxxmzgaebkqmokp` (subdomain in Supabase functions URL, e.g. `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/...`).

---

## Env-name reconciliations

The following canonical names override aliases that appear in REQUIREMENTS.md. The code is authoritative.
Do NOT use the deprecated aliases in any set-command, code, or CI variable — they will not be resolved.

| Canonical name (USE THIS) | Source | Note |
|---------------------------|--------|------|
| `CALENDLY_OAUTH_CLIENT_ID` | A11: code uses `CALENDLY_OAUTH_CLIENT_ID` in `calendly-oauth-start/index.ts` | REQUIREMENTS.md listed a shorter alias — that alias is wrong; use only the canonical name above |
| `ANTHROPIC_CLINICAL_API_KEY` | A13: `ai-chat/index.ts:45` reads `ANTHROPIC_CLINICAL_API_KEY` at the Deno.env call site | REQUIREMENTS.md listed a transposed alias — that alias is wrong; use only the canonical name above |

---

## Supabase Function Secrets

Set via: `supabase secrets set <NAME>=<value> --project-ref ytnsipxxmzgaebkqmokp`

Verify: `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp`

**NEVER commit secret values to git.** This runbook documents names + set-command forms with `<value>` placeholders only.

| Secret Name | Vendor | Status | Rotation cadence | Blast-radius (if leaked / rotated) | Owner | Set command |
|-------------|--------|--------|-----------------|-------------------------------------|-------|-------------|
| `RESEND_API_KEY` | Resend | [EXISTING] | Yearly or on breach | All transactional email breaks (registration, NPS, share invites) | Founder | `supabase secrets set RESEND_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `RESEND_FROM` | Resend | [EXISTING] | Only if domain changes | Email sender address shown to users | Founder | `supabase secrets set RESEND_FROM=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `STRIPE_SECRET_KEY` | Stripe | [EXISTING] | Yearly or on breach | All billing Fns break; subscription creates/updates fail | Founder | `supabase secrets set STRIPE_SECRET_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Play / FCM | [EXISTING - pending confirm] | Per Google service account rotation policy | FCM push delivery breaks; Play Console API access fails | Founder | `supabase secrets set PLAY_SERVICE_ACCOUNT_JSON=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `FCM_SERVER_KEY` | Firebase / FCM | [NEW] | Per FCM deprecation schedule | Phase 54 push notification fallback breaks | Founder | `supabase secrets set FCM_SERVER_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `MUX_TOKEN_ID` | Mux | [EXISTING - community feature] | Yearly or on breach | Community video upload/playback breaks; KB video breaks | Founder | `supabase secrets set MUX_TOKEN_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `MUX_TOKEN_SECRET` | Mux | [EXISTING - community feature] | Yearly or on breach | Community video upload/playback breaks; KB video breaks | Founder | `supabase secrets set MUX_TOKEN_SECRET=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `MUX_WEBHOOK_SIGNING_SECRET` | Mux | [EXISTING - community feature] | On webhook config change | mux-webhook Fn drops all webhook events (silent Mux data loss) | Founder | `supabase secrets set MUX_WEBHOOK_SIGNING_SECRET=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `CALENDLY_OAUTH_CLIENT_ID` | Calendly | [EXISTING - pending confirm] | On OAuth app rotation | Calendly OAuth flow breaks (patients can't link scheduling) | Founder | `supabase secrets set CALENDLY_OAUTH_CLIENT_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `CALENDLY_OAUTH_CLIENT_SECRET` | Calendly | [EXISTING - pending confirm] | On OAuth app rotation | Calendly OAuth token exchange fails | Founder | `supabase secrets set CALENDLY_OAUTH_CLIENT_SECRET=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Calendly | [NEW] | On webhook config change | calendly-webhook Fn rejects all incoming events | Founder | `supabase secrets set CALENDLY_WEBHOOK_SIGNING_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `CALENDLY_API_KEY` | Calendly | [NEW] | Yearly or on breach | vendor-smoke Calendly check shows not_configured; Phase 63 Calendly read API fails | Founder | `supabase secrets set CALENDLY_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `BETTER_STACK_API_KEY` | Better Stack | [NEW] | Yearly or on breach | vendor-smoke Better Stack check shows not_configured; Phase 67 status page API fails | Founder | `supabase secrets set BETTER_STACK_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `BETTER_STACK_PAGE_ID` | Better Stack | [NEW] | On status page change | Phase 67 status-embed breaks | Founder | `supabase secrets set BETTER_STACK_PAGE_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `SENTRY_DSN` | Sentry | [EXISTING - partial; needs Edge Fn verification] | On Sentry project rotation | All Edge Fn error reporting to Sentry breaks; errors become invisible | Founder | `supabase secrets set SENTRY_DSN=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `ANTHROPIC_API_KEY` | Anthropic (consumer) | [EXISTING] | Yearly or on breach | claude-moderation Fn + browser-side AI coach fails | Founder | `supabase secrets set ANTHROPIC_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `ANTHROPIC_CLINICAL_API_KEY` | Anthropic (clinical) | [EXISTING - pending BAA completion] | On BAA renewal or breach | ai-chat clinical branch (org_id non-null path) fails; patients with clinical creds get degraded AI | Founder | `supabase secrets set ANTHROPIC_CLINICAL_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `ANTHROPIC_CLINICAL_BAA_ACTIVE` | Anthropic (config) | [EXISTING - set to '0' or '1'] | On BAA status change | ai-chat clinical branch routing breaks if wrong | Founder | `supabase secrets set ANTHROPIC_CLINICAL_BAA_ACTIVE=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `POSTHOG_PERSONAL_API_KEY` | PostHog | [v1.3 carry-over - NOT set] | Yearly or on breach | onboarding-funnel-query + dsar-export Fns fail | Founder | `supabase secrets set POSTHOG_PERSONAL_API_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `POSTHOG_PROJECT_ID` | PostHog | [v1.3 carry-over - NOT set] | Only if project migrated | onboarding-funnel-query Fn queries wrong project | Founder | `supabase secrets set POSTHOG_PROJECT_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `POSTHOG_PROJECT_KEY` | PostHog | [EXISTING - variant-resolver] | Yearly or on breach | variant-resolver Fn cannot read feature flags | Founder | `supabase secrets set POSTHOG_PROJECT_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `SLACK_WEBHOOK_EXPERIMENTS_URL` | Slack | [v1.3 carry-over - NOT set] | On Slack app rotation | Experiment notification webhooks fail silently | Founder | `supabase secrets set SLACK_WEBHOOK_EXPERIMENTS_URL=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `SHARE_TOKEN_SECRET` | Internal | [v1.3 carry-over - NOT set] | On rotation (invalidates all live share links) | share-token verification fails; all shared links break | Founder | `supabase secrets set SHARE_TOKEN_SECRET=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `QUARTERLY_NPS_SIGNING_KEY` | Internal | [v1.3 carry-over - NOT set] | On rotation | Quarterly NPS HMAC signing/verification fails | Founder | `supabase secrets set QUARTERLY_NPS_SIGNING_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `APNS_KEY_ID` | Apple (APNs) | [NEW] | On APNs key rotation | Phase 54 iOS push notifications fail | Founder | `supabase secrets set APNS_KEY_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `APNS_TEAM_ID` | Apple | [NEW] | Only if Apple Team changes | Phase 54 APNs JWT mint fails | Founder | `supabase secrets set APNS_TEAM_ID=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `APNS_P8_KEY` | Apple | [NEW] | On APNs key rotation | Phase 54 APNs JWT signing fails | Founder | `supabase secrets set APNS_P8_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `REVENUECAT_WEBHOOK_AUTH` | RevenueCat | [NEW — **REQUIRED**] | On webhook config change | revenuecat-webhook Fn returns 401 on EVERY delivery (Bearer gate) → total IAP-webhook outage | Founder | `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `REVENUECAT_WEBHOOK_SECRET` | RevenueCat | [NEW — optional HMAC] | On webhook config change | HMAC verify disabled when unset (fail-soft); Bearer alone still gates | Founder | `supabase secrets set REVENUECAT_WEBHOOK_SECRET=<value> --project-ref ytnsipxxmzgaebkqmokp` |

> **M4 note:** the RevenueCat **client SDK keys** (`VITE_RC_API_KEY_IOS` / `VITE_RC_API_KEY_ANDROID`) are NOT Supabase Function Secrets — they are build-time client vars read via `import.meta.env` and injected by the mobile CI workflows. See § "Mobile CI build-time secrets" below. The previous `RC_API_KEY_IOS` / `RC_API_KEY_ANDROID` Function-Secret rows were incorrect (no Edge Fn reads them) and have been removed.
| `PLAY_PACKAGE_NAME` | Google Play | [NEW] | Only if package changes | Phase 53 Play Console API targeting wrong package | Founder | `supabase secrets set PLAY_PACKAGE_NAME=<value> --project-ref ytnsipxxmzgaebkqmokp` |
| `VAPID_PRIVATE_KEY` | Web Push | [NEW] | On VAPID keypair rotation (requires new public key too) | Phase 54 web push subscription + delivery fails | Founder | `supabase secrets set VAPID_PRIVATE_KEY=<value> --project-ref ytnsipxxmzgaebkqmokp` |

---

## Vercel Env (Build-Time Public)

Set via: `vercel env add <NAME> production`

These are baked into the frontend build at Vercel deploy time. They are public (no PHI). Do NOT put `${VITE_*}` in `vercel.json` — `vercel.json` is static platform config and does NOT interpolate env vars. Dynamic header assembly (e.g. CSP `report-uri`) must live in Edge Middleware reading `process.env` at request time.

| Env Name | Type | Purpose | Set command |
|----------|------|---------|-------------|
| `VITE_VAPID_PUBLIC_KEY` | `public` | Web push client subscription (Phase 54) | `vercel env add VITE_VAPID_PUBLIC_KEY production` |
| `ADMOB_APP_ID_IOS` | `public` | Phase 56 AdMob iOS app ID | `vercel env add ADMOB_APP_ID_IOS production` |
| `ADMOB_APP_ID_ANDROID` | `public` | Phase 56 AdMob Android app ID | `vercel env add ADMOB_APP_ID_ANDROID production` |
| `ADMOB_PUBLISHER_ID` | `public` | Phase 56 AdMob publisher ID | `vercel env add ADMOB_PUBLISHER_ID production` |
| `ADSENSE_PUBLISHER_ID` | `public` | Phase 56 AdSense publisher ID | `vercel env add ADSENSE_PUBLISHER_ID production` |
| `APPLE_TEAM_ID` | `public` | Phase 53 Apple Team ID (Sign in with Apple + APNs) | `vercel env add APPLE_TEAM_ID production` |
| `APPLE_BUNDLE_ID` | `public` | Phase 53 iOS bundle ID | `vercel env add APPLE_BUNDLE_ID production` |
| `PLAY_PACKAGE_NAME` | `public` | Phase 53 Android package name | `vercel env add PLAY_PACKAGE_NAME production` |

---

## Mobile CI build-time secrets (GitHub Actions)

These are **RevenueCat PUBLIC SDK keys** read by the client at build time via
`import.meta.env.VITE_RC_API_KEY_*` (`leanshot/src/lib/native/iap.ts`). They are
**NOT** Supabase Function Secrets and **NOT** Vercel env vars — the web build does
not use RevenueCat. They are injected into the **mobile** workflow builds
(`.github/workflows/mobile-{ios,android}.yml`, the `Build web assets` step of both
the build and sign-and-upload jobs) from GitHub Actions repository secrets. Without
them the shipped bundle has an empty key → `configureRC()` throws → dead paywall.

| Secret (GitHub Actions) | Platform | Purpose |
|-------------------------|----------|---------|
| `VITE_RC_API_KEY_IOS` | iOS | RC public SDK key baked into the iOS bundle |
| `VITE_RC_API_KEY_ANDROID` | Android | RC public SDK key baked into the Android bundle |

Set via: repo **Settings → Secrets and variables → Actions → New repository secret**.
(Replaces the previous incorrect `RC_API_KEY_IOS` / `RC_API_KEY_ANDROID` Supabase
Function-Secret entries.)

---

## Notes

(a) `vercel.json` does NOT interpolate env vars — keep dynamic CSP header assembly (e.g. `report-uri` for Sentry) in Edge Middleware that reads `process.env` at request time. Do not put `${VITE_*}` literals in `vercel.json`.

(b) The vendor-smoke Fn posts a `[vendor-smoke] connectivity test — ignore` message to the configured Slack channel during each smoke run. This is a synthetic test ping — treat it as routine operational noise.

(c) Values for `[NEW]` and v1.3 carry-over secrets are set at the Phase 70 consolidated HUMAN-UAT gate. Secret **names** are registered in this runbook and in the CI guard now so downstream phases (53–68) can reference them without provisioning blocker. Actual provisioning (account creation, value entry, verification) is deferred to Phase 70.

---

## CI drift guard — required-secret manifest and deferred allowlist

This section is the source of truth for `scripts/check-required-secrets.sh`.
Keep the lists in this section and the arrays in the script in sync.

**Guard contract:** The guard FAILS (exit 1) ONLY when a Required secret is missing AND not on the deferred allowlist; missing deferred secrets WARN (exit 0).

### Required (watched) secrets

These secrets are expected to exist NOW in Supabase Function Secrets. A missing entry is a hard failure in CI:

```
SENTRY_DSN
RESEND_API_KEY
RESEND_FROM
STRIPE_SECRET_KEY
ANTHROPIC_API_KEY
ANTHROPIC_CLINICAL_BAA_ACTIVE
MUX_TOKEN_ID
MUX_TOKEN_SECRET
MUX_WEBHOOK_SIGNING_SECRET
POSTHOG_PERSONAL_API_KEY
POSTHOG_PROJECT_ID
```

`SENTRY_DSN` is specifically watched per VENDOR-07 — a missing or renamed `SENTRY_DSN` means Edge Fn error reporting is silently broken.

Note: `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are the PostHog API auth credentials read by
the vendor-smoke `posthogHandler`. `POSTHOG_PROJECT_KEY` is a separate Vite/frontend public key used by
the variant-resolver Fn; it is registered in the table above but is NOT part of the drift guard's
Required set.

### Deferred-to-Phase-70 (pending-provisioning) allowlist

These secrets have values deferred to the Phase 70 HUMAN-UAT gate. A missing entry WARNS (exit 0) during the defer window so CI does not break:

```
CALENDLY_OAUTH_CLIENT_ID
CALENDLY_OAUTH_CLIENT_SECRET
CALENDLY_WEBHOOK_SIGNING_KEY
CALENDLY_API_KEY
BETTER_STACK_API_KEY
BETTER_STACK_PAGE_ID
ANTHROPIC_CLINICAL_API_KEY
SLACK_WEBHOOK_EXPERIMENTS_URL
SHARE_TOKEN_SECRET
QUARTERLY_NPS_SIGNING_KEY
APNS_KEY_ID
APNS_TEAM_ID
APNS_P8_KEY
REVENUECAT_WEBHOOK_AUTH
REVENUECAT_WEBHOOK_SECRET
PLAY_PACKAGE_NAME
PLAY_SERVICE_ACCOUNT_JSON
VAPID_PRIVATE_KEY
```

> **M4/M5 (2026-05-31):** `RC_API_KEY_IOS` / `RC_API_KEY_ANDROID` removed from this
> allowlist — they are CLIENT build-time Vite vars (`VITE_RC_API_KEY_*`, GitHub
> Actions secrets for the mobile workflows), not Supabase Function Secrets. The
> REQUIRED `REVENUECAT_WEBHOOK_AUTH` (Bearer; 401 on every delivery when unset) was
> added — it had been omitted while only the OPTIONAL `REVENUECAT_WEBHOOK_SECRET`
> (HMAC) was listed.

Note: `FCM_SERVER_KEY` (legacy FCM HTTP v1 server key) has been removed from the allowlist.
FCM authentication uses `PLAY_SERVICE_ACCOUNT_JSON` (OAuth2 service account) — the legacy server key
is not read by any Edge Fn.

Each entry above is deferred to Phase 70 — the guard WARNs (exit 0) for these.

**REQUIRED ∩ DEFERRED must equal empty set.** If a name appears in both lists, the guard's behavior is undefined. The self-consistency check in `check-required-secrets.sh` enforces this invariant.
