# LeanShot Launch-Readiness Report — 2026-05-31

## 1. Verdict: **GO-WITH-FIXES**

The app builds green and layout integrity is strong app-wide, but launch is gated on a tight, well-understood set of fixes: a canonical-domain/auth-origin split (`leanshot-app.vercel.app` is a co-equal alias of `app.leanshot.app`), a too-strict CSP that breaks the PWA manifest + web fonts + all Supabase Storage images, broken Edge Function CORS, and a Nutrition water-grid units bug rendering ~3000 toggles. None are deep — all are config/CSP/operator changes plus a few small code edits — but every one of them is user-visible and must land before launch.

---

## 2. BLOCKERS (must fix before launch)

| # | Issue | Fix | Owner |
|---|-------|-----|-------|
| B1 | `leanshot-app.vercel.app` is a co-equal **alias** of the prod deployment (returns HTTP 200, no redirect). Full SPA incl. auth reachable on non-canonical origin → fragmented/duplicate-origin auth (SameSite=Strict cookies are origin-scoped). | Set `app.leanshot.app` as the single production domain on Vercel `leanshot-app` and remove/redirect the `.vercel.app` alias **AND** add the host-gated 308 in `vercel.json` (B4) as belt-and-suspenders. | operator-vercel + code |
| B2 | Post-login / email-link / OAuth flows bounce users to `.vercel.app` because Supabase Auth **Site URL + redirect allowlist** still point at `leanshot-app.vercel.app`. Code (`auth.ts`) is already correct; this is dashboard config. | Supabase Dashboard (project `ytnsipxxmzgaebkqmokp`) → Auth → URL Configuration: Site URL = `https://app.leanshot.app`; set redirect allowlist (see §3); remove the `.vercel.app` entry. | operator-supabase |
| B3 | Marketing "Start" CTA sends every new user to the non-canonical host: `VITE_SPA_URL = https://leanshot-app.vercel.app` in `leanshot-marketing` prod env + `.env.local`. | Set `VITE_SPA_URL = https://app.leanshot.app` in `leanshot-marketing` (Production+Preview+Development) and in `leanshot/.env.local`; redeploy marketing. No source change. | operator-vercel |
| B4 | **CSP breaks production app** (`default-src 'none'` with gaps): (a) no `manifest-src` → PWA manifest blocked, not installable; (b) `script-src` has no inline allowance → `onload="this.media='all'"` font-swap blocked, web fonts never load; (c) `img-src` lacks `https://*.supabase.co` → all Supabase Storage images (org logos, event/course covers, photo renders) blocked. | Edit `vercel.json` line 62 CSP: add `manifest-src 'self'`; extend `img-src` to `...https://i.ytimg.com https://*.supabase.co https://leanshot.app`; remove the inline `onload` handler in `index.html` (see §4). Redeploy `leanshot-app` via git integration. | code + operator-deploy |
| B5 | Edge Function CORS broken for credentialed calls: `traffic-attribution-recorder` (and the shared `_shared/lifecycle-utils.ts` `corsHeaders`) return `Access-Control-Allow-Origin: '*'` while the SPA fires with `credentials: 'include'` → browser rejects, attribution rows silently dropped + console errors. | Replace wildcard with origin-echo + `Access-Control-Allow-Credentials: true` (mirror `share/cors.ts:64-74`); the function already has `ALLOWED_ORIGINS` + `isAllowedOrigin()`. `supabase functions deploy traffic-attribution-recorder`. Audit other credentialed callers. *(Edge Fn source is NOT in this repo — operator-side Supabase deploy.)* | operator-supabase / code |
| B6 | **Nutrition water-grid**: renders ~3000 per-cup toggle buttons (page height ~14,055px) because the daily water target is `3000cups` — a units/seed bug. Massive dead whitespace + the right column dwarfs the left. This is a layout/UX defect, NOT a data artifact. | Sanity-cap/validate the water target (realistic ~8-12 cups) and replace the per-cup toggle wall with a counter or a small fixed cup row. Don't render thousands of toggles regardless. | code |

> Note: B1+B2+B3 are one coupled failure — the canonical-domain split. All three must land together or the redirect loop reappears.

---

## 3. Operator Checklist (copy-pasteable)

### A. Supabase Auth — canonical domain (fixes B2, root cause of post-login bounce)
Project ref: **`ytnsipxxmzgaebkqmokp`**. Dashboard → **Authentication → URL Configuration**:

1. **Site URL:**
   ```
   https://app.leanshot.app
   ```
2. **Redirect URLs** (allowlist — set to exactly):
   ```
   https://app.leanshot.app/**
   https://app.leanshot.app/auth/callback
   https://*-karstens-projects-16afd0e4.vercel.app/**
   http://localhost:5173/**
   http://localhost:4173/**
   ```
   - `/**` covers the hash routes (`#/auth/verify`, `#/auth/set-new-password`); the explicit `/auth/callback` is belt-and-suspenders for OAuth (a PATH route, not a hash).
3. **Remove** `https://leanshot-app.vercel.app` from the allowlist once `app.leanshot.app` is confirmed working.
4. **Verify:** sign in on `https://app.leanshot.app` → must redirect back to `app.leanshot.app`, not `.vercel.app`.

### B. Supabase — confirm launch scope (MFA + OAuth)
5. **MFA TOTP** (Dashboard → Authentication → Multi-Factor): confirm **enroll + verify are ENABLED** for `ytnsipxxmzgaebkqmokp` (Pro plan). The admin AAL2 step-up gate is hard-required — if disabled, **admins cannot enroll TOTP and will be locked out of the admin surface.** (config.toml has these `false`; verify the live project, then align config.toml.)
6. **OAuth** (only if Google/Apple sign-in ships at launch): enable provider(s) in Dashboard → Auth → Providers; register the Supabase callback `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback` in Google Cloud / Apple Developer console. Apple Team ID = `XCZMRC727Z`. Confirm intended launch scope — if deferred, no action (buttons stay gated).

### C. Vercel — canonical domain + correct project (fixes B1, B3)
7. **leanshot-app** project → Settings → Domains: set **`app.leanshot.app` as the production domain**; remove the `leanshot-app.vercel.app` production alias (or rely on the B4 `vercel.json` host-redirect). Keep `*-git-*` preview aliases.
8. **leanshot-marketing** project → Settings → Environment Variables: set
   ```
   VITE_SPA_URL = https://app.leanshot.app
   ```
   for **Production, Preview, and Development**; then redeploy marketing.
9. ⚠️ Local `.vercel/project.json` is linked to **leanshot-marketing**, NOT leanshot-app. Before any CLI deploy of the app, re-link: `vercel link --project leanshot-app` and verify `projectName` — OR deploy via git integration (the known-working path). The CLI run from `leanshot/` targets marketing.

### D. Deploy sequence
10. Land the CSP + auth.ts + Nutrition fixes (§4) to **`main`** (currently on branch `chore/launch-readiness`, 3 unpushed commits + uncommitted edits — see §4). **Verify `git status -sb` before commit/push** (shared-checkout hazard).
11. Merge launch-relevant PRs: **#19** (desktop button-background visual fix — reconcile vs the duplicate commit `3b47099d` on `chore/launch-readiness` before merging both), **#18** (E2E sign-in selector scope), **#14** (clears the pre-existing DS-02 typography-ceiling red across PRs).
    - #19 / #18 / #14 are CI-green except the **known pre-existing DS-02 typography gate** (red on `main`, #18, #19 — Phase-69 debt, tracked by #14; not caused by these PRs).
    - #18's E2E job fails on **independent infra/flake** (affiliate test-seed dup-key; sign-in `fetch Illegal invocation` in test env) — merge #18 for the selector fix but do NOT treat it as the thing that greens E2E. Triage seeds separately; these are not production blockers.
12. Trigger `leanshot-app` **git-integration deploy** (NOT the locally-linked CLI).
13. **Post-deploy verification on `https://app.leanshot.app`:** manifest loads (no CSP error), Geist/Fraunces fonts swap in, Supabase Storage images render (org logos / event covers), post-login lands on `app.leanshot.app`, no posthog/sentry connect-src violations in DevTools.

### E. Create an admin/test user (needs service-role — Admin API recipe)
There is no public self-serve admin enroll; use the GoTrue Admin API with the **service-role key** (Dashboard → Settings → API). Replace `<SERVICE_ROLE_KEY>` and email.

```bash
# 1) Create a confirmed user (no email round-trip)
curl -sS -X POST 'https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/admin/users' \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin-test@leanshot.app",
    "password": "<STRONG_TEMP_PASSWORD>",
    "email_confirm": true
  }'

# 2) (Alternative to a password) generate a magic/recovery link to log in
curl -sS -X POST 'https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/admin/generate_link' \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "magiclink",
    "email": "admin-test@leanshot.app",
    "options": { "redirect_to": "https://app.leanshot.app/#/auth/verify" }
  }'
# → use the "action_link" in the JSON response to sign in.
```

14. To make the user an admin, grant the admin role per the project's admin model (admin RPC / role column) and **enroll TOTP end-to-end** (the AAL2 gate requires `aal='aal2'` for admin access — verify TOTP enroll/verify is enabled per step 5 first, or admin login dead-ends at the step-up modal).

---

## 4. Code fixes to apply in-repo now (safe)

All in `/Users/karstenhaldan/minisite/leanshot/`. Branch `chore/launch-readiness` already holds the `auth.ts` fix uncommitted — commit it.

| File | Change |
|------|--------|
| `vercel.json` (line 62 CSP) | Add `manifest-src 'self';`; extend `img-src` → `img-src 'self' data: blob: https://i.ytimg.com https://*.supabase.co https://leanshot.app`; add `frame-ancestors 'none'` (defense-in-depth alongside X-Frame-Options). |
| `index.html` (lines 52-57) | Remove the inline `onload="this.media='all'"` font-swap handler. Preferred: use a plain `<link rel="stylesheet" media="all">` (fonts already use `display=swap`, FCP cost negligible) or move the media-swap into a `'self'` script. Do NOT add `'unsafe-inline'`/`'unsafe-hashes'`. Must land in source so built `dist/index.html` inherits it. |
| `src/lib/auth.ts` (SSR fallback, line 31) | **Already fixed, uncommitted** — commit it so it ships. |
| Nutrition water-target (B6) | Cap/validate the daily water target and replace the per-cup toggle wall with a counter / fixed cup row. |
| `supabase/config.toml` (lines 158, 168) | Update `site_url = "https://app.leanshot.app"` and `additional_redirect_urls` to match §3 — prevents a future `config push` from silently re-breaking prod auth. Align MFA TOTP flags once §3-B5 is confirmed. (Does not change prod by itself — dashboard is authoritative.) |
| `traffic-attribution-recorder/index.ts` (if Edge Fn source available to you) | Replace wildcard `corsHeaders` with origin-echo credentialed headers; redeploy. (Source not in this repo per build-state audit — likely operator-side.) |

**Optional / cosmetic CI:** bump `admin-shell` bundle ceiling 137→138kB to clear the +0.04kB grandfathered Phase-36 red (or leave as accepted); fix stale chunk names (`cancellation`→`CancellationModal`, drop `WhatsNewDrawer`) in `assert-bundle-budget.sh`. Neither blocks launch.

---

## 5. UI Summary — per-surface verdicts

Build is **green** (tsc clean, vendor-react + index within budget; only the +0.04kB admin-shell cosmetic red). Layout chrome is consistent app-wide: correct 232px expanded-sidebar offset, no horizontal overflow, no console errors (except Settings). Stale ~7-month seed data leaves many cards empty — **data artifact, not a layout bug** — but it exposes a real, repeated **empty-state gap** worth fixing.

| Surface | Verdict | Real (non-data) issues |
|---------|---------|------------------------|
| Today (home) | minor-issues | **HIGH:** floating "Help" launcher overlaps/clips the Side-effects "+ Log" button (z-index collision). Orange phase labels 2.46:1 (sub-AA). Dangling `Alex ·` separator. |
| Medication (headline) | minor-issues | Headline feature shows 4 blank cards with **no empty-state** ("Log dose" prompt) — reads as broken. Orange annotation labels 2.46:1 (when populated). |
| Side effects | minor-issues | 5 cards have **no titles/empty-state copy** — read as skeletons. Shared orange token 2.46:1. |
| **Body** | **needs-work** | **HIGH:** "Current weight 90.8 kg" card renders near-invisible washed-out (1.03:1) — looks like a stuck skeleton. **HIGH:** zero empty-state UI → full-viewport blank void. Green trend deltas 2.65:1. `community` nav lowercase. |
| **Nutrition** | **needs-work** | **B6 BLOCKER:** ~3000 water-drop toggles (14k px tall, units/seed bug) + extreme column-height asymmetry. Empty 14-day charts need empty-state copy. |
| Activity | minor-issues | **HIGH:** active-nav highlights "Nutrition" on the Activity route (nav active-state bug). Legal footer first link clipped under sidebar (offset contract). No card empty-states. |
| **Stack** | **needs-work** | No empty-state on 5 cards; card fill 1.09:1 (containers blend into page, fails 3:1 non-text). Active-nav highlights "Activity". Footer left-clip. |
| Mood | minor-issues | Cards lack titles/empty-state. Footer left-clip. Active-nav highlights "Stack". |
| Wins | minor-issues | No card empty-states. White-on-white promo text "GLP-1 Survival Guide" (1.03:1, below fold). Active-nav highlights "Mood". |
| **Community** | **needs-work** | **HIGH:** white-on-white text — active `community` nav label (1.02:1) + "GLP-1 Survival Guide" card text (1.03:1) genuinely illegible (likely undefined Tailwind v4 @theme tokens collapsing to white). No empty-state. `community` lowercase. |
| **Classroom** | **needs-work** | **HIGH:** active-state pill floats BETWEEN `community` and `Classroom` rows — neither label inverts to white, primary nav looks broken. No course empty-state. `community` lowercase. |
| Events | minor-issues | Legal footer first link "Consumer health data (WA residents)" clipped under sidebar (compliance link — bad look). Cards need empty-state. |
| **Settings** | **needs-work / UNVERIFIED** | **HIGH:** screenshot captured the **Events page, not Settings** — real Settings UI unverified, re-capture before sign-off. **HIGH:** Settings is the **only** surface with a console error: **406** (likely a `.single()`/`.maybeSingle()` profile/preferences fetch returning 0/multiple rows or Accept/RLS mismatch) — could break the settings form. **Investigate before launch.** |
| Home @ 390px (mobile) | minor-issues | Stray clipped glyph under "Today" title (rendering artifact). "Help" pill collides with bottom tab bar, obscuring rightmost nav items. Orange/green labels 2.46–2.65:1. |

**Cross-cutting real UI issues to fix before/around launch:**
- **Help launcher z-index/overlap** (Today desktop + mobile tab bar) — covers interactive controls. **HIGH.**
- **Nav active-state is wrong on multiple routes** (Activity→Nutrition, Stack→Activity, Mood→Stack, Wins→Mood, Classroom mis-positioned pill, Community illegible). Looks like one active-link/route-matching bug + a contrast/token bug. **HIGH** for Community/Classroom legibility.
- **White-on-white text** (Community nav + "GLP-1 Survival Guide" card) — undefined/wrong tokens collapsing to white (matches prior Tailwind-v4 @theme finding). **HIGH.**
- **LegalFooter left-clip under sidebar** on Activity/Stack/Mood/Community/Events — footer not replicating the 232px sidebar offset (the known AppShell sidebar-offset contract; same class as PR #16). Clips a **compliance** link.
- **Body "current weight" card** near-invisible washed-out render. **HIGH.**
- **Settings 406** console error. **HIGH — investigate.**
- **No empty-state treatment** across most data surfaces — affects real new users with zero data, not just the stale seed.
- **Sub-AA accent tokens:** orange phase labels 2.46:1, green deltas 2.65:1 — app-wide token darkening.

> The `r:~1.03` "white-on-white" on page H1s (Today/Medication/Body/etc.) is a **measurement artifact** (heading sampled against near-white patch); those headings are dark-on-cream and legible. The genuine contrast fails are the orange/green accents and the real white-on-white in Community/Wins.

---

## 6. Nice-to-haves / Post-launch

- **SEO:** `public/sitemap.xml` uses hash-fragment legal URLs (`/#/legal/privacy`) which collapse to `/` for crawlers; switch to clean `/legal/:slug` paths. Single canonical `Sitemap` line in robots.txt (drop the redundant `app.leanshot.app` line). Pre-existing hygiene, not a blocker.
- **Mobile deep-links:** fill `TEAMID`→`XCZMRC727Z` in `public/.well-known/apple-app-site-association` (iOS submission) and the Play App Signing SHA-256 in `assetlinks.json` (item B6 in app-store runbook, blocked on Play upload). Not a web-launch blocker.
- **Empty-state design pass:** add per-card titles + "log your first X" CTAs across Today/Medication/Side effects/Body/Stack/Mood/Wins/Activity/Classroom/Events so sparse/new users don't see blank shells.
- **Nav polish:** normalize `community` → `Community` (Title Case) app-wide; verify active-link logic after the route-matching fix.
- **CSP hardening:** `frame-ancestors 'none'` (listed in §4); confirm `connect-src` once in prod DevTools — `*.posthog.com` covers `us.i.posthog.com`/`us-assets.i.posthog.com` only if no custom `VITE_POSTHOG_HOST` reverse-proxy is set.
- **Dead config cleanup:** delete misleading `vercel.marketing.json` (not referenced by any project) and document that the single `leanshot/vercel.json` governs both leanshot-app and leanshot-marketing.
- **E2E flake triage** (off the critical path): idempotent affiliate test-seed (dup-key on `affiliates_stripe_connect_account_id_key`); fix `fetch Illegal invocation` (fetch unbound from window) in sign-in-with-lockout test env.
- **Mobile/app-store track** (not web launch): PRs #17 AdMob, #12 RevenueCat (operator dashboard greenfield), #11 Apple Team ID.

---

### Sequencing TL;DR
1. **Code:** CSP edits + remove inline font handler + commit auth.ts + Nutrition water-target → land on `main`.
2. **Operator (parallel):** Supabase Auth Site URL/allowlist + MFA confirm; Vercel canonical domain + `VITE_SPA_URL`; Edge Fn CORS redeploy.
3. **Merge** #19/#18/#14 → **git-deploy `leanshot-app`**.
4. **Verify** on `app.leanshot.app` (manifest, fonts, images, post-login origin, no CORS/CSP errors); create admin test user + enroll TOTP.
5. **Then GO.**
