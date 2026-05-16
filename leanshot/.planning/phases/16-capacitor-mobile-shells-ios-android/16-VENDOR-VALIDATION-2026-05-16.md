---
phase: 16
slug: capacitor-mobile-shells-ios-android
audit_type: vendor-pass-closeout
audited: 2026-05-16
verdict: blocked_on_user
unblocks: [17-push, 18-health, 20-ad, 21-watch, milestone-v1.2-complete]
---

# Phase 16 Vendor-Pass Validation — 2026-05-16

Run inline from `/gsd-audit-milestone` follow-up. Probe every section of `16-09-CREDENTIALS-CHECKLIST.md` via CLI/MCP per [[feedback-verify-human-uat-via-cli]] + [[feedback-cli-over-paste-back]]. Auto-verify what tooling reaches; surface only true user-blocked items.

## Auto-Verified (no user action needed)

| Section | Check | Method | Result |
|---------|-------|--------|--------|
| C1 | fastlane match repo created | `gh repo view pallefar/leanshot-fastlane-match` | ✅ PRIVATE repo exists |
| D1 | Sentry projects exist | per checklist `[x]` (3 projects, IDs captured) | ✅ leanshot-web/ios/android all live on `optimizenet` |
| D2 | Sentry DSNs captured | per checklist `[x]` (3 DSNs in checklist text) | ✅ all 3 DSN values known |
| F-cron | All P19+P22+P23 crons live | `supabase db query --linked "SELECT jobname FROM cron.job"` | ✅ 14 jobs active including `photos-trash-purge`, `affiliate-monthly-payout`, `lifecycle-*`, `finalize-account-deletions`, `dsar-export-tick` |
| G-files | ASO screenshots present | `find apps/ -name '*.png'` | ✅ 6 Pixel + 6 iPhone/iPad screenshots in `apps/{ios,android}/marketing/screenshots/en-US/` |
| G-copy | Store listing copy present | `ls apps/{ios,android}/store-listing-en.md` | ✅ both files exist |
| H1 | sitemap.xml live | `curl -sI https://leanshot.app/sitemap.xml` | ✅ HTTP 200; content valid XML; 6+ URLs listed |
| H2 | OG + Twitter Card meta | `curl -s https://leanshot.app/` | ✅ og:type/site_name/title/description/url/image/image:{width,height,alt} + twitter:card all present |
| I1 | 4 legal hashes live | curl loop `for h in privacy consumer-health terms disclaimer` | ✅ 4/4 return 200 |

## Auto-Verified: BLOCKED state

| Section | Check | Method | Result |
|---------|-------|--------|--------|
| F3 | Vault `service_role_key` loaded | `supabase db query --linked "SELECT name FROM vault.decrypted_secrets WHERE name='service_role_key'"` | ❌ `rows: []` — NOT loaded. Blocks `photos-trash-purge` + `affiliate-monthly-payout` actual execution (cron fires but Edge Fn returns 500 with logged warning per vendor-gated pattern). |
| D-vercel | Per-platform Sentry DSNs in Vercel | `vercel env ls production` | ⚠️ Only `VITE_SENTRY_DSN_WEB` wired; `VITE_SENTRY_DSN_IOS` + `VITE_SENTRY_DSN_ANDROID` NOT added (values known from D2 — can fold in once user OKs) |
| E-vercel | RC Public SDK Keys in Vercel | `vercel env ls production` | ❌ `VITE_RC_IOS_PUBLIC_KEY` + `VITE_RC_ANDROID_PUBLIC_KEY` NOT added (values unknown — user must paste from RC dashboard) |
| GH-secrets | Mobile pipeline secrets | `gh secret list` | ❌ Only Resend + Supabase loaded. Missing ALL of: APPLE_TEAM_ID, APP_STORE_CONNECT_API_KEY_{ID,ISSUER_ID,CONTENT_BASE64}, GOOGLE_PLAY_JSON_KEY_BASE64, MATCH_GIT_BASIC_AUTHORIZATION, MATCH_PASSWORD, SENTRY_AUTH_TOKEN, RC_WEBHOOK_AUTH_TOKEN |

## Plans not yet executed

| Plan | Status | Why |
|------|--------|-----|
| 16-03 (AASA + assetlinks) | PLAN only, no SUMMARY | Placeholders only; needs A2 Apple Team ID to fill TEAMID slot |
| 16-09 (Fastlane CI mobile pipeline) | PLAN only | Blocks on A+B+C+D credentials |
| 16-10 (OOM soak + UAT + launch gates) | PLAN only | Blocks on 16-09 first run + AASA real values |

## True User Blockers

These cannot be auto-resolved by Claude. All require user dashboard actions:

| ID | Action | Cost | Wait time |
|----|--------|------|-----------|
| **A1** | Apple Developer Program enrollment at <https://developer.apple.com/programs/enroll/> | $99/year | 24-48h ID verification |
| **B1** | Play Console signup at <https://play.google.com/console/signup> | $25 one-time | 1-2 days ID verification |
| **F1** | Supabase Pro upgrade at <https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/settings/billing> | $25/mo | instant |
| **F3** | Load `service_role_key` into Vault (after F1) | — | instant |
| **C2** | GitHub PAT for `leanshot-fastlane-match` repo | — | 5 min |
| **C3** | Choose `MATCH_PASSWORD` passphrase | — | 1 min |
| **D3** | Mint Sentry CI auth token at <https://optimizenet.sentry.io/settings/account/api/auth-tokens/> | — | 5 min |
| **E1** | Capture RC iOS Public SDK Key from <https://app.revenuecat.com/projects/proj6e995e1b/apps> | — | 2 min |
| **E2** | Same — Android key | — | 2 min |
| **E3** | Capture RC webhook auth token from RC integrations page | — | 2 min |
| **G2** | Hand-record 15-second preview.mov | — | 3-4h |

After A+B+C+D+E+F captured, paste back per Section J prompt template — Claude folds into Vercel env + GitHub secrets + supabase functions secrets + re-executes 16-03/16-09/16-10.

## What ships TODAY without user action

If we close out everything else and accept Phase 16 as "code complete; mobile shells not yet submitted to stores," the following ARE ready right now:
- Web app + marketing site + landing page builder + admin surface + affiliate program + ad-free clinic surfaces + DSAR + cookie consent + lifecycle email — ALL LIVE on `leanshot.app`
- Web Sentry monitoring (DSN_WEB wired)
- Supabase free-tier infrastructure (14 crons + 21 migrations + 8 Edge Fns + 51 RLS policies)

**This is the v1.2 web-only ship surface.** Mobile shells, push, health, ads, watch all wait on user vendor action.

## Recommended next steps

**A. User starts vendor enrollments (slowest path: 24-48h Apple + 1-2 days Play)** — start A1 + B1 + F1 now in parallel, complete C2/C3/D3/E1/E2/E3 (~30 min total), paste back per Section J. Claude folds + re-executes 16-03 + 16-09 + schedules 16-10 soak.

**B. Defer P16 closeout; focus on closing other v1.2 gaps inline** — close P13 DS-12 (8 illustration wirings, ~30 min) + decide on P22 ON-01 fate (continue with v1.1 onboarding or schedule P22b) + acknowledge orphan-phase chain (17/18/20/21) needs P16 vendor passes anyway.

**C. Start P17 discuss-phase in parallel** — Push Notifications has a web push surface that ships independent of native shells; discuss-phase clarifies the iOS-PWA ≥16.4 detection vs APNs split. Native registration still gates on P16 but design + Web Push slice can move.

## Cross-references

- [[project-phase16-unblock-plan]] — earlier vendor cascade (domain landed, Resend verified, RC core configured)
- [[project-v12-milestone-audit]] — full milestone audit context
- [[feedback-verify-human-uat-via-cli]] — pattern this audit follows
- [[reference-vendor-gated-send-health-check]] — vault-key-pending behavior already shipped (no code change needed once F3 done)
