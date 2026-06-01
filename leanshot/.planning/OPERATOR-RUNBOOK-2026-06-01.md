# LeanShot — Operator Runbook to finish the v1.4 Launch Gate (Phase 70)

> Written 2026-06-01. Everything Claude could do autonomously is done (PRs #20/#21/#22 merged to `main`; `@leanshot.test` purge complete; marketing redeployed). What remains is **operator-only** (console toggles, vendor apps, device testing) — that IS Phase 70, the `autonomous: false` launch gate. This runbook walks items 1–4.

## What's left in the milestone (Phase 70 — Consolidated UAT)
8 signal groups / 101 signals (72 critical / 29 non-critical), inline operator signoff, severity-tiered ship rule (plan 08 → tags `v1.4.0-ship`, posts Slack #launch):
1. **vendor-OAuth-secrets** ← items **1 + 2** below cover most of this
2. **stripe-test** — run a test checkout / refund / past-due flow
3. **browser** ← item **3** (Edge-Fn CORS) + manual cross-browser pass on `app.leanshot.app`
4. **iOS device** — Capacitor build on a real iPhone
5. **Android device** — Capacitor build on a real Android
6. **ops-runbook-drill** — exercise the alerting/runbooks
7. **regression-watch** — 48h watch post-deploy
8. **final-signoff** — go/no-go + `v1.4.0-ship` tag

Route in with `/gsd-progress` (it will point at Phase 70), or open each `PLAN.md` under `.planning/phases/70-consolidated-uat-v1-4-launch-gate/` and capture signoff inline.

Supabase project ref: **`ytnsipxxmzgaebkqmokp`** · OAuth callback (all providers): **`https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`** · Apple Team ID: `XCZMRC727Z`.

---

## 1. Supabase Auth dashboard (one session) — fixes post-login redirect + closes 2 advisor WARNs
Dashboard → project `ytnsipxxmzgaebkqmokp`:

**A. URL Configuration** → Authentication → **URL Configuration**
- **Site URL:** `https://app.leanshot.app`
- **Redirect URLs** — add exactly these, then **remove** any `leanshot-app.vercel.app` entry:
  ```
  https://app.leanshot.app/**
  https://app.leanshot.app/auth/callback
  https://*-karstens-projects-16afd0e4.vercel.app/**
  http://localhost:5173/**
  http://localhost:4173/**
  ```
- ✅ **Verify:** sign in at `https://app.leanshot.app` → you land back on `app.leanshot.app` (not `*.vercel.app`).

**B. Leaked-password protection** (the audit's 1-click win — advisor `auth_leaked_password_protection`)
- Authentication → **Policies / Password** (newer UI: **Authentication → Attack Protection**) → toggle **"Leaked password protection"** ON (checks HaveIBeenPwned on sign-up/change).

**C. MFA TOTP** (hard-required — admins lock out of the AAL2 step-up gate if off)
- Authentication → **Multi-Factor (MFA)** → ensure **TOTP enroll + verify = ENABLED**.
- (Repo `supabase/config.toml` is already aligned to `true`, so a future `config push` won't regress this — but the dashboard is authoritative for the live project.)

---

## 2. OAuth — Google + Facebook (the gated buttons are already shipped, just dormant)
The buttons appear only when the provider is enabled **and** its `VITE_AUTH_*_ENABLED` flag is `true`.

**A. Google**
1. Google Cloud Console → create/select a project → **APIs & Services → OAuth consent screen**: External; app name "LeanShot"; support email; **Authorized domain** `leanshot.app`; scopes `email`, `profile`, `openid`; publish (or add yourself as a test user).
2. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URI:
   `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback` → copy **Client ID + Client Secret**.
3. Supabase → Authentication → **Providers → Google** → enable → paste Client ID + Secret → save.

**B. Facebook**
1. developers.facebook.com → **Create App** (type: Consumer) → add **Facebook Login** product.
2. Facebook Login → Settings → **Valid OAuth Redirect URIs**:
   `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`. Note: FB requires **App Review** for the `email` permission + flipping the app to **Live** before non-testers can use it.
3. App **Settings → Basic** → copy **App ID + App Secret**.
4. Supabase → Authentication → **Providers → Facebook** → enable → paste App ID + Secret → save.

**C. Turn the buttons on**
- Vercel → **leanshot-app** → Settings → Environment Variables → add for **Production + Preview + Development**:
  ```
  VITE_AUTH_GOOGLE_ENABLED=true
  VITE_AUTH_FACEBOOK_ENABLED=true
  ```
- **Redeploy leanshot-app** (push to `main`, or `vercel redeploy <leanshot-app prod url>`). Build-time vars only bake in on a fresh build.
- 🔎 **Test before the env change (optional):** in the app, DevTools console →
  `localStorage.setItem('leanshot_auth_google_enabled','true')` (and `..._facebook_enabled`) → reload → the button appears for your browser only.
- ✅ **Verify:** Google/Facebook buttons render on `/#/auth/signin` → click → provider consent → redirect back signed in.

---

## 3. Deploy the Edge-Fn CORS fix (`traffic-attribution-recorder`)
The credentialed-CORS fix is merged in code (PR #21) but Vercel doesn't deploy Edge Functions — Supabase does.
1. Install the CLI: `brew install supabase/tap/supabase` (or `npm i -g supabase`).
2. Auth: `supabase login` (interactive) **or** export a PAT: Dashboard → Account → **Access Tokens** → `export SUPABASE_ACCESS_TOKEN=sbp_...`.
3. From the repo root `/Users/karstenhaldan/minisite`:
   ```bash
   supabase functions deploy traffic-attribution-recorder \
     --no-verify-jwt --project-ref ytnsipxxmzgaebkqmokp
   ```
   (`--no-verify-jwt` because it's an unauthenticated, origin-allowlisted endpoint — see the file header.)
4. ✅ **Verify** the preflight echoes the origin (not `*`):
   ```bash
   curl -i -X OPTIONS https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/traffic-attribution-recorder \
     -H "Origin: https://app.leanshot.app" -H "Access-Control-Request-Method: POST"
   # expect: access-control-allow-origin: https://app.leanshot.app  +  access-control-allow-credentials: true
   ```

---

## 4. Phase 70 UAT — the launch gate
This is the milestone finish line and is inherently hands-on.
- Items **1–3** above + the merged code clear the **vendor-OAuth-secrets** and **browser** groups.
- Remaining hands-on: **stripe-test** (test-mode checkout/refund/dunning), **iOS** + **Android** device builds (Capacitor), **ops-runbook-drill** (fire an alert, confirm Slack/Better Stack), **regression-watch** (48h).
- Work each `PLAN.md` in `.planning/phases/70-consolidated-uat-v1-4-launch-gate/`, capturing signoff inline; **plan 08 (final-signoff)** applies the severity-tiered ship rule, issues go/no-go, tags `v1.4.0-ship`, and posts Slack #launch.
- Then the milestone is complete → `/gsd-complete-milestone`, and `/gsd-new-milestone v1.5` picks up the best-in-class roadmap (`V1.5-BEST-IN-CLASS-MILESTONE.md`).

## Quick win bundle (do these in the one Supabase session)
Site URL + redirect allowlist (1A) · leaked-password protection (1B) · MFA TOTP confirm (1C) · enable Google+Facebook providers (2A/2B). Then one Vercel env change + redeploy (2C), one CLI deploy (3), and you've cleared the bulk of the gate.
