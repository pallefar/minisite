# Deep-Link Placeholder Substitution Runbook

**Phase-70-gated** — The two placeholders below are intentional stubs committed during
Phase 53 (Plan 53-02). Neither Universal Links nor App Links need to resolve until
the app reaches production. Substitution is gated on Phase 70, when the real Apple
Team ID and Play App Signing SHA256 fingerprint are available from their respective
vendor dashboards.

Vercel already serves both association files with `Content-Type: application/json`
(configured in `leanshot/vercel.json`). Do NOT touch `vercel.json` as part of this
substitution.

---

## Placeholder 1 — Apple Team ID (Universal Links / Web Credentials)

**File:** `leanshot/public/.well-known/apple-app-site-association`

**Current placeholder:** `TEAMID`

**Occurrences:** Two (applinks + webcredentials):

```json
"appID": "TEAMID.app.leanshot.ios"
```

```json
"apps": ["TEAMID.app.leanshot.ios"]
```

**Where to find the real value:**
- Sign in to [developer.apple.com](https://developer.apple.com) with the LeanShot
  Apple Developer account.
- Navigate to **Membership** in the sidebar.
- Copy the **Team ID** (10-character alphanumeric string, e.g. `A1B2C3D4E5`).
- This is the same Team ID used in the Phase 52 VENDOR-01 Apple enrollment.

**Substitution (two occurrences):**

Replace both instances of `TEAMID` with the real Team ID. After substitution the
entries should read:

```json
"appID": "A1B2C3D4E5.app.leanshot.ios"
```

```json
"apps": ["A1B2C3D4E5.app.leanshot.ios"]
```

**Deployment:** Deploy via Vercel (the file is served as static JSON from the
`public/.well-known/` directory). iOS validates the AASA at app install time by
fetching `https://leanshot.app/.well-known/apple-app-site-association` and
`https://app.leanshot.app/.well-known/apple-app-site-association` — both hostnames
are configured in `capacitor.config.ts` `server.allowNavigation` and in the iOS
App.entitlements `com.apple.developer.associated-domains` entitlement (already
committed as `applinks:leanshot.app` + `applinks:app.leanshot.app`).

---

## Placeholder 2 — Android Play App Signing SHA256 (App Links)

**File:** `leanshot/public/.well-known/assetlinks.json`

**Current placeholder:** `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09`

**Occurrence:** One (sha256_cert_fingerprints array):

```json
"sha256_cert_fingerprints": [
  "REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09"
]
```

**Where to find the real value:**
- Sign in to [play.google.com/console](https://play.google.com/console).
- Navigate to **Setup → App signing**.
- Under **App signing key certificate**, copy the **SHA-256 certificate fingerprint**
  (colon-separated hex string, e.g.
  `AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99`).
- Use the **Play App Signing** key (not the upload key) — Google's CDN uses the
  signing certificate to verify App Links at app install time.

**Substitution:**

Replace the placeholder string with the real colon-separated SHA-256 fingerprint:

```json
"sha256_cert_fingerprints": [
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
]
```

**Deployment:** Deploy via Vercel (the file is served as static JSON from the
`public/.well-known/` directory). Android validates App Links at app install time
by fetching `https://app.leanshot.app/.well-known/assetlinks.json`.

**Note on SHA-256 visibility:** The SHA-256 fingerprint is a required public Android
artifact (it is NOT a secret). Committing it in the static file is correct per
Android documentation.

---

## Checklist for Phase 70

- [ ] Obtain Apple Team ID from developer.apple.com Membership page
- [ ] Replace both `TEAMID` occurrences in `public/.well-known/apple-app-site-association`
- [ ] Obtain Play App Signing SHA-256 fingerprint from Play Console → App signing
- [ ] Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09` in `public/.well-known/assetlinks.json`
- [ ] Deploy both files to production via Vercel
- [ ] Verify Universal Links on a physical iOS device (Settings → General → VPN & Device Management or tap a `https://leanshot.app/share/xxx` link)
- [ ] Verify App Links on a physical Android device (tap a `https://app.leanshot.app/share/xxx` link)
