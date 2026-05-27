---
phase: 68
status: code-complete (remote-deploy + operator-action deferred)
audience: Phase 69.7 + Phase 70 milestone UAT operator
---

# Phase 68: Audience Landing + Sales Enablement — CARRY-OVER

## 1. Inherited Blockers

- Phase 65 `org_subscriptions` drift still blocks all migration pushes.

## 2. Operator-Action Items (Phase 70)

| Item | Command/Action |
|------|----------------|
| Set Calendly book-demo URL | `vercel env add VITE_CALENDLY_BOOK_DEMO_URL` (per audience or single shared) — operator must have a Calendly link with a 15-min demo slot. Until set, `/for-clinics` CTA renders "Coming soon" (Phase 60-13 guard) — acceptable launch fallback. |
| Deploy demo-org-purge Fn | `npx supabase functions deploy demo-org-purge` |
| Register pg_cron for demo-org-purge | Add cron-schedule migration in Phase 70 close-out (every 24h at 03:00 UTC) |
| Validate sitemap.xml is served at `/sitemap.xml` | Curl + Google Search Console submission |
| Validate JSON-LD via Google Rich Results Test | https://search.google.com/test/rich-results — paste each of the 3 audience URLs |

## 3. Deferred Enhancements

### Server-side `<title>` rendering for landing pages
- **Today (v1.4):** `react-helmet-async` sets `<title>` + JSON-LD at React mount. JS-aware crawlers (Googlebot, Bingbot post-2019) see it. Non-JS crawlers see the default app title.
- **v1.5:** Vercel Edge rewrite OR pre-render route, OR migrate to Next.js (architectural change). Document tradeoffs.

### Admin "extend up to 30 days" demo-org UI
- Component not shipped — operator sets `demo_extended_until` via direct SQL for now.
- v1.5: Build `<DemoOrgExtendButton>` in admin org-detail view + thin RPC.

### Per-audience video on landing pages
- Defer until video content exists. Block-tree schema allows `embed` blocks; can add via page-builder admin without code change.

## 4. Cross-Phase Wiring Notes

### Phase 51 traffic-attribution-recorder
- Now captures `landing_page` dim. Phase 67 funnel-break alerts (`scripts/posthog/seed-funnel-alerts.sh`) will use this dim to break out conversion per audience once invoked.

### Phase 64 cookie banner
- Cookie banner mentions sign-in-rate-limiting (AUTH-16 / LEGAL-07). Landing pages inherit the banner; no new wiring needed.

### Phase 60-13 react-helmet-async
- Audience pages reuse the same helmet pattern as `/knowledge/*` knowledge hub. Existing helmet provider in App.tsx covers all routes.

## 5. Operator Carry-Over from Phase 60.5 (newsletter physical address) — STILL OPEN

The CAN-SPAM guard for newsletter sender still requires:
```bash
supabase secrets set NEWSLETTER_PHYSICAL_ADDRESS="<LeanShot physical mailing address>" \
  --project-ref ytnsipxxmzgaebkqmokp
```
Newsletter Fn returns HTTP 503 if missing. Reminder: do this before Sun 2026-05-31 13:00 UTC newsletter cron.

## 6. Lessons This Phase

1. **Phase 15 page-builder schema reality** — `(status, seo_*, published_revision_id)` + separate `landing_page_revisions(block_tree)`. Plan's `(blocks, seo, is_public)` was a guess. Executor Rule-1 caught at write-time + adapted to the revision-pattern.

2. **FK CASCADE vs RESTRICT** — Phase 28 org child tables are RESTRICT. Plans assuming CASCADE need pre-flight grep: `grep -E "REFERENCES.+organizations.*ON DELETE" supabase/migrations/`. Add to plan-checker.

3. **Edge Middleware over Edge Fn for pre-mount redirects** — recorder Fn fires post-React-mount; Middleware fires pre-paint. Route the right concern to the right layer.

4. **Dual-write awareness** — `public/sitemap.xml` AND `scripts/build-sitemap.ts` both regenerate the file. Update both or only the script. Same shape lurks for other generated artifacts.
