---
phase: 16
audit_source: 16-09-CREDENTIALS-CHECKLIST.md Section H (SEO) + Section I (Legal)
audit_date: 2026-05-16
audit_trigger: User-requested H+I autonomous batch after Sentry projects wired
---

# H+I Audit — Deferred items + fix summary

## What the audit found

Routine SEO/legal-footer audit surfaced a launch-affecting bug in `vercel.json`: Phase 15's page-render rewrite migration left 6 of the 11 AASA Universal Link paths returning **404** on direct path navigation. Combined with two SEO gaps (apex `/` had zero OG tags; sitemap.xml listed only `/pricing`), the production deploy was failing both social-share previews and Universal-Link Safari fallback.

## What got fixed inline (commit 92c42dd + this commit)

### vercel.json
- **5 path-to-hash redirects (308 temporary):** `/signin → /#/auth/signin`, `/signup → /#/auth/signup`, `/reset-password → /#/auth/set-new-password`, `/verify-email → /#/auth/verify`, `/legal/:slug → /#/legal/:slug`. Safari Universal-Link fallback now lands on the right SPA hash route instead of 404.
- **1 SPA-fallback rewrite:** `/share/(.*) → /index.html`. Phase 8 SharePage uses path-based routing — this restores the rewrite that Phase 15 dropped from the catchall negative-lookahead.
- **Catchall negative-lookahead expanded:** added `signin|signup|reset-password|verify-email|legal` so the redirects can fire before the page-render catchall tries to look them up as DB slugs.

### sitemap function (supabase/functions/sitemap/index.ts)
- Added `STATIC_URLS` constant emitting apex `/` + 4 legal pages alongside DB-backed builder pages. Sitemap now lists 5 hardcoded + N DB-backed URLs (was 1 DB-backed only). Auth paths intentionally excluded — they're redirect targets, not destinations we want indexed.

### leanshot/index.html
- Added 9 Open Graph meta tags (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`).
- Added 5 Twitter Card meta tags (`twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`).
- Image references `https://leanshot.app/og-image.png` — see deferred item D-1 below.

## Deferred items

### D-1 — og-image.png asset creation (1200×630 PNG)
**What:** Drop a 1200×630 PNG at `leanshot/public/og-image.png`. Until it exists, the OG tags reference a 404'ing image URL — social-share crawlers degrade to text-only previews (Twitter card, Slack unfurl, etc. show title + description but no image). Still better than the prior zero-tag state where no preview rendered at all.
**Why deferred:** Branded launch-quality OG image is a design task, not a code task. Existing assets at the monorepo root (`body-no-watermark.png`, `medlevel-watermark.png`) are not OG-quality.
**Suggested resolution:** Phase 16-08 ASO Task 4 (or before) — the same designer pass that produces the 18 ASO screenshots can produce one OG image.
**Acceptance:** `curl -sI https://leanshot.app/og-image.png` returns 200 + `Content-Type: image/png`.

### D-2 — `/faq` AASA path has no SPA destination
**What:** `apple-app-site-association` lists `/faq` as a Universal Link target, but no SPA hash route or DB-backed builder page exists for FAQ. Today: `/faq` returns 404. After this commit: still 404 (no redirect added — there's nothing to redirect to).
**Why deferred:** Requires either (a) building an FAQ landing page (Phase 23 polish work) or (b) removing `/faq` from the AASA `paths` array (Phase 16-03 re-execute).
**Suggested resolution:** When 16-03 is re-executed with real Apple TEAMID, either keep `/faq` in AASA + ship a stub FAQ landing page via the page-builder, OR drop `/faq` from the AASA paths array. **Recommended: ship FAQ via page-builder** (it's a marketing page; user will write copy; supports SEO).
**Acceptance:** Either `curl https://leanshot.app/faq` returns 200 OR `apple-app-site-association` no longer lists `/faq`.

### D-3 — `/reset-password` mapping verification
**What:** The redirect `/reset-password → /#/auth/set-new-password` is best-guess. There's also `#/auth/forgot-password` (ForgotPasswordForm) which might be the actual intended target.
**Why deferred:** Need to step through the Phase 5 password-reset flow end-to-end (request reset → click email link → land on correct screen) to confirm the target. Memory `[[project_e2e_smoke_failure]]` notes password-reset was recently fixed (`b54868b`) but doesn't say which hash route the email link lands on.
**Suggested resolution:** Trigger a real password reset from prod, click the email link, observe which `#/auth/...` route the browser actually lands on, update the redirect destination if it's not `set-new-password`. ~5 minute test.
**Acceptance:** Password-reset email link from prod resolves to a screen that lets the user actually set a new password (no blank screen, no 404).

### D-4 — Content-Type `text/plain` on sitemap.xml + page-render responses
**What:** Supabase Edge Function gateway overrides response Content-Type to `text/plain` (and injects `CSP: sandbox`) regardless of what the function sets. Per `[[reference-supabase-edge-function-deploy]]` this is a known platform behavior. Search engines tolerate text/plain XML but Lighthouse flags it.
**Why deferred:** Workaround requires either fronting Supabase Edge Functions with a Vercel rewrite that rewrites Content-Type (not natively supported in vercel.json), or moving sitemap + page-render off Supabase Edge Functions onto Vercel Edge/Functions.
**Suggested resolution:** Treat as accepted risk for v1.2 launch — search engines will still parse the sitemap. Revisit in v1.3 if Google Search Console reports indexing issues.
**Acceptance:** Decision either way recorded; if rework chosen, sitemap.xml returns `Content-Type: application/xml; charset=utf-8`.

### D-5 — Google Search Console + Bing Webmaster Tools submission (H3, H4)
**What:** Submit `https://leanshot.app/` to Google Search Console + Bing Webmaster Tools, verify via DNS TXT, submit sitemap.
**Why deferred:** Browser actions, can't be CLI-driven. Both take ~5 minutes each.
**Suggested resolution:** When ready to start indexing (post-launch), follow the URLs in 16-09-CREDENTIALS-CHECKLIST.md Section H3/H4.

### D-6 — Cookie consent banner verification (I2)
**What:** Confirm cookie consent banner appears for EU visitors with granular Essential/Analytics/Marketing/Personalization toggles (Consent Mode v2).
**Why deferred:** Needs browser navigation + likely needs VPN to EU region OR DevTools `navigator.geolocation` override to trigger the EU-only path.
**Suggested resolution:** Use Playwright MCP to verify, OR manual browser test from EU IP.
**Acceptance:** Banner appears + 4 toggles work + acceptance persists across reloads.

### D-7 — DSAR portal + account deletion smoke (I3, I4)
**What:** Confirm `/#/settings/data-export` (Phase 22 GDPR-01) and in-app account deletion ≤3 taps (Phase 22 DEL-01) reachable for authenticated users.
**Why deferred:** Needs an authenticated test account + tap-flow walkthrough. Phase 22 SHIPPED these — high confidence they work — but worth a smoke confirmation pre-launch.
**Suggested resolution:** When you have a fresh test account in prod, walk the flow + screenshot for evidence.

## Verification at next deploy

After this commit lands + Vercel auto-deploys + sitemap function redeploys:

```bash
# Redirects should land on hash routes (302/308)
for url in /signin /signup /reset-password /verify-email /legal/privacy /legal/terms; do
  curl -sI "https://leanshot.app$url" | grep -E '^HTTP|^location'
  echo "---"
done

# /share/* should serve index.html (200, text/html)
curl -sI https://leanshot.app/share/abc123 | grep -E '^HTTP|^content-type'

# Sitemap should now list 5+ URLs
curl -sS https://leanshot.app/sitemap.xml | grep -c '<loc>'

# Apex should have OG + Twitter tags
curl -sS https://leanshot.app/ | grep -cE 'og:|twitter:'
```

## Cross-references

- Origin: 16-09-CREDENTIALS-CHECKLIST.md Sections H + I
- Related: [[reference-supabase-edge-function-deploy]] (D-4 gateway behavior)
- Related: [[project-phase8-wave1-executed]] (Phase 8 SharePage path routing)
- Related: [[reference-supabase-auth-traps]] (D-3 password-reset flow)
- Related: 16-CONTEXT.md D-11 (AASA path categories — origin of the `/faq` path)

## Audit closeout state (snapshot 2026-05-16 end-of-session)

| Surface | State |
|---|---|
| H+I audit (vercel rewrites, sitemap, OG tags, legal/auth routing, SPA fallback) | ✅ CLOSED — all smoke green, see "Final smoke battery" output captured in session transcript |
| `app.leanshot.app` HTTPS + SPA fallback | ✅ live (domain moved leanshot-marketing → leanshot-app via REST; DNS A 76.76.21.21 added; cert provisioned; SPA-fallback catchall scoped to `has: host=app.leanshot.app`) |
| `leanshot.app` page-render catchall + sitemap | ✅ live, scoped to `has: host=leanshot.app` (no longer leaks onto SPA domain) |
| Cross-domain redirects /signin /signup /reset-password /verify-email /legal/:slug | ✅ 307 → `https://app.leanshot.app/#/…` |
| Sentry per-platform DSNs (web + iOS + Android) | ✅ Vercel env wired for web; iOS+Android DSNs are build-time vars for fastlane (Section D2 of checklist) |
| Carry-forward to credential checklist (user-gated) | Sections A/B/C/D3/E/F/G — see checklist; Apple Dev + Play Console deliberately deferred to milestone tail per user direction |
| D-1 og-image.png (1200×630 PNG) | OPEN — design asset, blocks rich social-share previews on leanshot.app |
| D-2 `/faq` AASA destination | OPEN — either ship FAQ landing or remove from AASA at 16-03 re-execute |
| D-3 `/reset-password` mapping verification | OPEN — needs live email-link test post Apple Dev approval |
| D-4 Content-Type `text/plain` on sitemap.xml + page-render | ACCEPTED RISK for v1.2 (Supabase Edge Function gateway override; search engines tolerate) |
| D-5 Search Console + Bing Webmaster submission | OPEN — post-launch browser action |
| D-6 Cookie consent banner smoke | OPEN — needs EU IP or Playwright MCP geo-override |
| D-7 DSAR + account-delete smoke | DSAR route reachable (`/settings/privacy/dsar` → SPA) confirmed via curl 2026-05-16; functional smoke deferred to authed test account |
| Sentry bootstrap token (sntryu_2e95...) | REVOKED 2026-05-16 by user; new CI token deferred until fastlane (16-09) actually needs it |
