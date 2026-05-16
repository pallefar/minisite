---
phase: 16
purpose: Human-driven credential checklist for Plan 16-09 (Fastlane CI Mobile Pipeline) + downstream re-execute of 16-03 (AASA/assetlinks placeholders) + closeout of 16-08 (ASO Task 4) + SEO/legal audit before launch.
created: 2026-05-16
owner: karsten.haldan@gmail.com
---

# Phase 16 — Credentials + Launch Checklist

> **How to use:** tick boxes as you go. When everything in a section is green, ping Claude with the section name and the captured values — Claude will fold them into Vercel env, GitHub secrets, the fastlane Matchfile, and re-execute Plan 16-03 so the AASA/assetlinks placeholders flip to real values.

---

## Section A — Apple Developer Program (24–48h slow path)

Unblocks: Plan 16-03 re-execute (TEAMID), Plan 16-09 (signing identities, TestFlight upload), Plan 16-10 (sandbox testers).

- [ ] **A1.** Enroll in Apple Developer Program at <https://developer.apple.com/programs/enroll/> — $99/year, ID verification can take 24–48h.
- [ ] **A2.** Once approved, grab **Team ID** from <https://developer.apple.com/account> → Membership details → "Team ID".
  - `APPLE_TEAM_ID` = `__________`  (10-char alphanumeric, e.g. `ABCD12EFGH`)
- [ ] **A3.** Register the bundle identifier `app.leanshot.app` (or your chosen iOS bundle ID — should match the value baked into `apps/ios/App/App.xcodeproj`).
- [ ] **A4.** Create an App Store Connect API key with **App Manager** role at <https://appstoreconnect.apple.com/access/integrations/api>:
  - Click **+** → name it `leanshot-fastlane-ci`
  - Download the `.p8` file ONCE (you cannot re-download — save to 1Password immediately)
  - `APP_STORE_CONNECT_API_KEY_ID` = `__________`  (e.g. `ABC123XYZ4`)
  - `APP_STORE_CONNECT_API_KEY_ISSUER_ID` = `__________`  (UUID at the top of the page)
  - `APP_STORE_CONNECT_API_KEY_CONTENT_BASE64` = run `base64 -i AuthKey_<KEYID>.p8 | tr -d '\n'` on the `.p8` file
- [ ] **A5.** Create an Apple **Sandbox tester** account at App Store Connect → Users and Access → Sandbox → Testers (needed for Plan 16-10 MONEY-06 manual IAP UAT). Sign it into iPhone Settings → Developer → Sandbox Apple Account on a real device (not simulator).

**When A2 is captured: ping Claude with `apple-teamid-ready: <TEAMID>` → triggers Plan 16-03 re-execute (real AASA, no more placeholder).**

---

## Section B — Google Play Console ($25 one-time)

Unblocks: Plan 16-03 assetlinks SHA256 (later, after fastlane match runs once), Plan 16-09 (Play upload), Plan 16-10 (Play Internal Testing soak).

- [ ] **B1.** Register at <https://play.google.com/console/signup> ($25 one-time fee, identity verification ~1–2 days).
- [ ] **B2.** Create the app shell:
  - App name: `LeanShot`
  - Package name: `app.leanshot.android`
- [ ] **B3.** Create a service account in Google Cloud Console:
  - <https://console.cloud.google.com/iam-admin/serviceaccounts> → **+ CREATE SERVICE ACCOUNT**
  - Name: `leanshot-fastlane-ci`
  - Grant **no project roles** (Play API permission is granted in Play Console, not GCP)
  - Create + download JSON key
- [ ] **B4.** Link the service account in Play Console:
  - <https://play.google.com/console> → Setup → API access → grant the service account `Release manager` role on the `LeanShot` app
- [ ] **B5.** Base64 the JSON for GitHub secret storage:
  - `GOOGLE_PLAY_JSON_KEY_BASE64` = `base64 -i service-account.json | tr -d '\n'` → paste back

**SHA256 step (do AFTER fastlane match generates the upload keystore in Plan 16-09 execution):**
- [ ] **B6.** After 16-09 first run, get the upload SHA256: `keytool -list -v -keystore <upload-keystore.jks> -alias upload -storepass <MATCH_PASSWORD> | grep SHA256`
  - `ANDROID_UPLOAD_SHA256` = `__________`  (colon-separated hex, 64 chars)
- [ ] **B7.** Also capture the **Play App Signing** SHA256 from Play Console → Setup → App signing → "SHA-256 certificate fingerprint" under "App signing key certificate" (Play re-signs uploads, and Android App Links use the Play-signed fingerprint).
  - `ANDROID_PLAY_STORE_SHA256` = `__________`

**When B6+B7 captured: ping Claude with `android-fingerprints-ready` → triggers assetlinks.json patch (both fingerprints listed) + re-deploy Vercel.**

---

## Section C — fastlane match repo + secrets (DONE BY CLAUDE + your PAT)

- [x] **C1.** Private repo created: <https://github.com/pallefar/leanshot-fastlane-match> *(done by Claude 2026-05-16 via `gh repo create`)*
- [ ] **C2.** Create a fine-grained Personal Access Token scoped to JUST this repo:
  - <https://github.com/settings/personal-access-tokens/new>
  - Token name: `leanshot-fastlane-match-rw`
  - Resource owner: `pallefar`
  - Repository access: **Only select repositories** → `leanshot-fastlane-match`
  - Permissions → Repository → Contents: **Read and write**; Metadata: **Read-only** (default)
  - Expiration: 1 year (calendar it)
  - Click **Generate token** → copy the `github_pat_...` value (save to 1Password)
- [ ] **C3.** Choose a strong `MATCH_PASSWORD` passphrase (20+ chars, save to 1Password).
  - `MATCH_PASSWORD` = `__________`

**When C2+C3 done: ping Claude with `match-secrets-ready` and paste the PAT — Claude will compute `MATCH_GIT_BASIC_AUTHORIZATION = base64("pallefar:<PAT>")` and store via `gh secret set` (never echoed back).**

---

## Section D — Sentry projects + auth token (CORRECTED ORG)

> **Correction to Plan 16-09 frontmatter:** the Sentry org is **`optimizenet`** on **`de.sentry.io`** (NOT `leanshot`). No `leanshot-*` projects exist yet — all three need creating.

- [x] **D1.** ~~Create three new Sentry projects under `optimizenet`~~ — DONE 2026-05-16 (browser, Option 3 from creation flow). All three live:
  - `leanshot-web` (javascript-react, project id `4511398815858768`)
  - `leanshot-ios` (apple-ios, project id `4511398817693776`)
  - `leanshot-android` (android, project id `4511398818742352`)
- [x] **D2.** Per-project DSNs (fetched 2026-05-16 via `GET /api/0/projects/optimizenet/<slug>/keys/`):
  - `VITE_SENTRY_DSN_WEB` = `https://d5a2cda4a19ab27292de39107da33438@o4510888703033344.ingest.de.sentry.io/4511398815858768`
  - `VITE_SENTRY_DSN_IOS` = `https://879b83b7de54dad114081e09a0659cb2@o4510888703033344.ingest.de.sentry.io/4511398817693776`
  - `VITE_SENTRY_DSN_ANDROID` = `https://ea89df2bc7b77b696d1188f340e52b4d@o4510888703033344.ingest.de.sentry.io/4511398818742352`
- [ ] **D3.** Create a DEDICATED CI Auth Token at <https://optimizenet.sentry.io/settings/account/api/auth-tokens/>:
  > The bootstrap token used to fetch DSNs on 2026-05-16 should be **revoked** after D-08 wiring is verified; mint a separate `leanshot-ci-dsym-upload` token with only the scopes below.
  - Name: `leanshot-ci-dsym-upload`
  - Scopes: `project:releases` + `org:read`
  - `SENTRY_AUTH_TOKEN` = `__________`  (`sntrys_...`)
- [ ] **D4.** Confirm slugs:
  - `SENTRY_ORG` = `optimizenet`
  - `SENTRY_REGION_URL` = `https://de.sentry.io`
  - `SENTRY_PROJECT_WEB` = `leanshot-web`
  - `SENTRY_PROJECT_IOS` = `leanshot-ios`
  - `SENTRY_PROJECT_ANDROID` = `leanshot-android`

**When D done: ping Claude with `sentry-ready` + paste DSNs and auth token → Claude folds DSNs into `src/lib/sentry.ts` platform branch + stores auth token via `gh secret set` + `vercel env add`.**

---

## Section E — RevenueCat dashboard paste-backs

Already provisioned per memory `[[project_phase16_unblock_plan]]` (iOS + Android apps + entitlement + 4 products via v2 REST API). Still need 3 paste-backs:

- [ ] **E1.** RC iOS Public SDK Key (NOT the secret key):
  - <https://app.revenuecat.com/projects/proj6e995e1b/apps> → leanshot-ios → Apps → Public SDK Key
  - `VITE_RC_IOS_PUBLIC_KEY` = `__________`  (`appl_...`)
- [ ] **E2.** RC Android Public SDK Key:
  - Same path → leanshot-android → Public SDK Key
  - `VITE_RC_ANDROID_PUBLIC_KEY` = `__________`  (`goog_...`)
- [ ] **E3.** RC webhook auth header value (for the Edge Function from Plan 16-06):
  - <https://app.revenuecat.com/projects/proj6e995e1b/integrations> → Webhooks → Authorization header value (Bearer token)
  - `RC_WEBHOOK_AUTH_TOKEN` = `__________`

**When E done: ping Claude → folds into `vercel env` (VITE_* for client) + Supabase Function secrets (`RC_WEBHOOK_AUTH_TOKEN` server-side).**

---

## Section F — Supabase Pro upgrade ($25/mo)

Required for: Storage image transforms (Phase 16 OOM mitigation per `[[project_phase16_unblock_plan]]`), Vault `service_role_key` (Phase 19 monthly payout cron).

- [ ] **F1.** Upgrade Supabase project `ytnsipxxmzgaebkqmokp` to Pro at <https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/settings/billing>.
- [ ] **F2.** Verify Storage image transforms are enabled (Storage → Settings → "Image Transformations" toggle ON).
- [ ] **F3.** Load `service_role_key` into Vault (per Phase 19 BL-12 deferred item):
  - Dashboard → Vault → Secrets → New Secret
  - Name: `service_role_key`
  - Value: from Project Settings → API → `service_role` (keep server-side; never expose to client)
  - Verify via `npx supabase db query --linked "SELECT name FROM vault.decrypted_secrets WHERE name = 'service_role_key';"`

---

## Section G — Plan 16-08 ASO closeout (autonomous portion done)

Already complete: 18 Playwright-captured EN screenshots (Task 4A), App Store + Play Store listing copy (`apps/ios/store-listing-en.md`, `apps/android/store-listing-en.md`). Remaining:

- [ ] **G1.** Decide App Store category — **Health & Fitness** vs **Medical**. Implication: "Medical" triggers App Store medical-app review checklist (HCP review, clinical references, etc.) — **Recommended: Health & Fitness** unless you want regulatory-style review. Document the decision in `16-08-SUMMARY.md` under D-22.
- [ ] **G2.** Hand-record 15-second preview.mov in QuickTime + iMovie per D-21 (~3–4h):
  - Setup: real iPhone 14+ in light mode, demo seeded account
  - Storyboard: dashboard → log injection → med-level curve → rotation map → share modal
  - Export: H.264, 1080×1920 portrait, ≤500MB
  - Save to `leanshot/apps/ios/marketing/previews/en-US/preview.mov`
- [ ] **G3.** Final marketing-copy human sign-off — read `apps/ios/store-listing-en.md` end-to-end + flag any anti-steering wording (no mentions of out-of-app purchase / web pricing on iOS listing).
- [ ] **G4.** Decide DE/ES/FR locale ETA — currently deferred per `16-08-DEFERRED-LOCALES.md` to v1.2.1. Confirm or pull forward.

**When G done: ping Claude → Claude writes the SUMMARY closeout + ticks 16-08 in ROADMAP + advances STATE.md.**

---

## Section H — SEO audit (LIGHT — most already shipped)

Already shipped:
- ✅ `index.html` has title + meta description + theme-color + apple-mobile-web-app meta tags
- ✅ `public/robots.txt` allows all + points at sitemap
- ✅ Dynamic `/sitemap.xml` Edge Function (Phase 15 Plan 08)
- ✅ Per-page SEOPanel in admin page-builder (Phase 15)

Remaining audit items:

- [ ] **H1.** Verify the live sitemap returns 200 + lists every published landing page: `curl -s https://leanshot.app/sitemap.xml | head -50`
- [ ] **H2.** Confirm Open Graph + Twitter Card meta tags are emitted by `page-render` Edge Function for landing pages (not just `index.html`). Spot-check: `curl -s https://leanshot.app/ | grep -E 'og:|twitter:'`
- [ ] **H3.** Submit the verified domain to **Google Search Console** at <https://search.google.com/search-console/welcome>:
  - Add `https://leanshot.app/` as a property
  - Verify via DNS TXT record (Vercel DNS → add TXT record)
  - Submit sitemap: `https://leanshot.app/sitemap.xml`
- [ ] **H4.** Submit to **Bing Webmaster Tools** at <https://www.bing.com/webmasters> (same process; Bing also serves DuckDuckGo).
- [ ] **H5.** Run Lighthouse SEO audit on `/` + `/pricing` + 1 landing page → target ≥95 SEO score. CLI: `npx lighthouse https://leanshot.app/ --only-categories=seo --view`
- [ ] **H6.** *(Optional v1.2.1)* Per-page structured-data JSON-LD (`@type: WebApplication`, `@type: MedicalEntity` carefully — see G1 category implication).

---

## Section I — Legal footer + pages audit (ALREADY SHIPPED)

Already in place from Phase 7 + Phase 22:
- ✅ `LegalFooter` (src/components/layout/LegalFooter.tsx) — single source of truth
- ✅ Mounted in marketing (`Landing.tsx:578`), legal pages (`LegalLayout.tsx:43`), authenticated app shell (`AppShell.tsx:78`)
- ✅ Four links: Privacy / Consumer health (WA) / Terms / Medical disclaimer
- ✅ `CookieConsentBootstrap` mounted in `App.tsx:1166` (Phase 22 Plan 22-10)

Verification only:

- [ ] **I1.** Curl prod and confirm the 4 legal hashes resolve: `for h in privacy consumer-health terms disclaimer; do curl -sI "https://leanshot.app/#/legal/$h" -o /dev/null -w "%{http_code}\n"; done` — all should be `200`.
- [ ] **I2.** Open <https://leanshot.app/> in incognito → confirm cookie consent banner appears + Essential/Analytics/Marketing/Personalization toggles work (Consent Mode v2).
- [ ] **I3.** Confirm DSAR portal is reachable from settings: `https://app.leanshot.app/#/settings/data-export` (Phase 22 GDPR-01).
- [ ] **I4.** Confirm in-app account deletion reachable in ≤3 taps from settings (Phase 22 DEL-01).
- [ ] **I5.** *(Nice-to-have)* Add a 5th footer link: **Cookie Preferences** (re-opens the cookie consent banner) — currently the banner only shows once on first visit. Not blocking launch.

---

## Section J — Final paste-back prompt (use this once Sections A–F are done)

Once you have **all of A1–A4, B1–B5, C2–C3, D1–D4, E1–E3, F1–F3** ticked + values captured, paste this single prompt to Claude:

```
All Phase 16-09 credentials are ready. Here are the values:

APPLE_TEAM_ID=<from A2>
APP_STORE_CONNECT_API_KEY_ID=<from A4>
APP_STORE_CONNECT_API_KEY_ISSUER_ID=<from A4>
APP_STORE_CONNECT_API_KEY_CONTENT_BASE64=<from A4>

GOOGLE_PLAY_JSON_KEY_BASE64=<from B5>

MATCH_PAT=<from C2>
MATCH_PASSWORD=<from C3>

SENTRY_AUTH_TOKEN=<from D3>
VITE_SENTRY_DSN_WEB=<from D2>
VITE_SENTRY_DSN_IOS=<from D2>
VITE_SENTRY_DSN_ANDROID=<from D2>

VITE_RC_IOS_PUBLIC_KEY=<from E1>
VITE_RC_ANDROID_PUBLIC_KEY=<from E2>
RC_WEBHOOK_AUTH_TOKEN=<from E3>

Supabase Pro upgrade DONE; service_role_key loaded into Vault.

Please:
1. Compute MATCH_GIT_BASIC_AUTHORIZATION from MATCH_PAT and store all
   secrets in the right places (gh secret set for CI, vercel env add
   for client/runtime, supabase functions secrets set for server-side).
2. Re-execute Plan 16-03 with real APPLE_TEAM_ID + initial assetlinks
   (B6/B7 SHA256 patch will follow after 16-09 first run).
3. Execute Plan 16-09 (fastlane setup + CI workflow).
4. Once fastlane match generates the upload keystore, capture the
   SHA256 and patch assetlinks.json + re-deploy.
5. Schedule Plan 16-10 7-day TestFlight soak start.
```

---

## What's blocking what (dependency map)

```
A1 → A2 (TEAMID)     ───┬→ Plan 16-03 re-execute (no more placeholder)
A1 → A4 (ASC API)    ───┤
B1 → B2/B3 (service) ───┼→ Plan 16-09 fastlane (gym + supply + match)
C2 → MATCH_PAT       ───┤
C3 → MATCH_PASSWORD  ───┘
D3 → SENTRY_AUTH     ───→ Plan 16-09 dSYM upload (mobile.yml CI step)
                          ↓
                     Plan 16-09 first run generates upload.jks
                          ↓
                     B6/B7 SHA256 capture
                          ↓
                     assetlinks.json patch (real Android App Links)
                          ↓
                     Plan 16-10 (TestFlight soak + Play Internal Testing soak — 7 days real time)
                          ↓
                     Phase 16 ship + App Store + Play Store submission
```

ASO Task 4 (G1–G4), SEO audit (H1–H6), and Legal audit (I1–I5) can run in **parallel** to A/B/C/D — no dependencies on credentials.
