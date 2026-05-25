# Phase 34 Plan 34-10 — Apple Services ID + .p8 Checkpoint Walkthrough

**Type:** `checkpoint:human-action` (browser-only, no CLI substitute)
**Owner:** Operator (developer.apple.com + Supabase Dashboard)
**Resume signal target:** `/gsd-execute-phase` continuation after `approved — services id: <value>, team id: <value>, key id: <value>`

---

## Why this is a real human checkpoint

Apple Developer Portal has **no public API** for Services ID creation or `.p8`
key registration. Every credential-touching step here requires a logged-in
browser session at developer.apple.com.

Per memory `feedback_verify_human_uat_via_cli`: gsd-verifier tends to
over-label deploy/vendor work as "human_needed". Here it is genuinely
human-only — there is no CLI alternative.

Per memory `feedback_scaffolding_for_deferred_mobile_pattern`: this checkpoint
is for **Apple Sign In on WEB only** in v1.3. iOS native Apple SSO is v1.4
mobile-shell scope and explicitly out of scope for Plan 34-10.

---

## Pre-flight

You will need:

- An Apple Developer account with admin access to the LeanShot team.
- Access to the LeanShot Supabase project dashboard
  (https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp).
- Access to Vercel CLI authenticated for `leanshot-marketing` project
  (`vercel whoami` should show your account, `vercel ls` should show the
  project).
- ~30 minutes; Apple Developer Portal is famously slow.

---

## Step-by-step

### 1. Confirm/create the App ID

1. Visit https://developer.apple.com/account/resources/identifiers/list
2. Filter by **App IDs**. If `app.leanshot` (or your equivalent bundle id)
   exists, note the Bundle ID + ensure "Sign in with Apple" capability is
   enabled. If not, create one first.
3. Capability check: edit the App ID → **Sign In with Apple** must be ON.
   If you toggle it on now, you may need to download a new provisioning
   profile for the iOS app later (v1.4 problem; not blocking here).

### 2. Create the Services ID

1. Same Identifiers list → click **"+"** → **Services IDs** → **Continue**.
2. **Description:** `LeanShot Web Sign In`
3. **Identifier:** `app.leanshot.web` (or another reverse-DNS string you
   own; the exact value is what you'll paste into Supabase as "Services ID").
4. Click **Continue** → **Register**.
5. Now click into the just-created Services ID → enable **Sign in with Apple**
   → click **Configure**.
6. **Primary App ID:** select the LeanShot App ID from Step 1.
7. **Domains and Subdomains:** `ytnsipxxmzgaebkqmokp.supabase.co`
8. **Return URLs:** `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`
9. **Save** → **Continue** → **Save**.

> ⚠️ Apple normalizes the Return URL silently if the trailing slash is wrong.
> Paste it exactly as shown above (no trailing slash).

### 3. Create the Sign In with Apple Key (`.p8`)

1. Identifiers list → **Keys** in left sidebar → **"+"**.
2. **Key Name:** `LeanShot Sign In with Apple v1`
3. Check **Sign in with Apple** → **Configure** → pick the LeanShot App ID
   (Primary).
4. **Continue** → **Register**.
5. **Download** the `.p8` file. **You can only download once.** Save to your
   password manager / 1Password vault now.
6. Note the **Key ID** (10-character alphanumeric, visible on the key page).

### 4. Note your Team ID

Top-right of the Apple Developer dashboard, click your account name. The
**Team ID** is a 10-character alphanumeric string. Note it.

### 5. Wire into Supabase

1. Visit
   https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/auth/providers
2. Find **Apple** → toggle ON.
3. Fill in:
   - **Services ID:** the identifier from Step 2.3 (e.g. `app.leanshot.web`).
   - **Team ID:** from Step 4.
   - **Key ID:** from Step 3.6.
   - **Secret Key:** paste the **entire** contents of the `.p8` file,
     including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
     header/footer lines.
4. Click **Save**.

### 6. Flip the browser feature flag

```bash
echo "true" | vercel env add VITE_AUTH_APPLE_ENABLED production
echo "true" | vercel env add VITE_AUTH_APPLE_ENABLED preview
# Trigger a redeploy so the new env var bakes into the bundle:
vercel deploy --prod
```

### 7. Smoke test

1. Open a **fresh incognito window**.
2. Visit https://app.leanshot.app/onboard
3. Advance to the auth step.
4. Confirm the **"Continue with Apple"** button is visible.
5. Click it; sign in with your real Apple ID; confirm the redirect lands
   at `/auth/callback` and then `/#/onboarding` (or `/#/dashboard` if your
   profile is already complete).
6. Address bar history sanity check: there should be **no double-`#`** URL
   (per memory `reference_supabase_auth_traps` — implicit-grant + hash-routes
   trap). The PKCE flow shipped in Plan 34-04 avoids this, but worth
   eyeballing.

### 8. Calendar reminder

Set a calendar reminder **~5 months from today** to rotate the `.p8` key.
Apple expires `.p8` keys every 6 months per the Phase 34 RESEARCH Pitfall 2.
When the key lapses, Apple sign-in fails with a "Unknown client" error
visible in the browser network tab.

---

## Resume signal format

Type one of these in chat to resume Plan 34-10:

- `approved — services id: <value>, team id: <value>, key id: <value>` — the
  SUMMARY records these for the next operator (rotation tracking).
- `skip — Apple OAuth deferred to a follow-up plan` — Apple stays disabled;
  magic-link + Google OAuth still ship. ONBOARD-02 marked partially-complete.
- `issue: <description>` — blockers (e.g. Apple Developer renewal pending,
  legal approval needed for the new Services ID).

---

## Threat model notes

| Risk | Mitigation |
|------|------------|
| `.p8` private key leak via screenshot/share | Stored in Supabase dashboard input field (masked after save) + 1Password vault. Never paste into chat or commit to git. |
| Services ID typo → silent OAuth failure | Smoke test (Step 7) catches this immediately. |
| `.p8` expiry without rotation | Calendar reminder (Step 8) + monitoring signal: failing Apple logins surface in Sentry as `AuthCallbackView` errors. |
