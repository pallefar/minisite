---
phase: 68
status: human_needed
verified: 2026-05-27
mode: automated-verify-only
---

# Phase 68: Audience Landing + Sales Enablement — VERIFICATION

## Automated Verification (PASS)

| Check | Method | Result |
|-------|--------|--------|
| 3 migrations exist | `ls supabase/migrations/2029010700000{1,2,3}*.sql` | ✅ |
| `<AudienceLandingPage>` shipped | `ls leanshot/src/components/landing/AudienceLandingPage.tsx` | ✅ |
| 3 routes in App.tsx | `grep -cE "'/for-(doctors\|clinics\|coaches)'" leanshot/src/App.tsx` | ✅ 3 |
| sitemap.xml has 3 new URLs | `grep -cE "/for-(doctors\|clinics\|coaches)" leanshot/public/sitemap.xml` | ✅ 3 |
| Sitemap regenerator updated | `grep -cE "for-(doctors\|clinics\|coaches)" leanshot/scripts/build-sitemap.ts` | ✅ |
| seed-demo-org script | `ls leanshot/scripts/seed-demo-org.ts` | ✅ |
| demo-org-purge Fn | `ls supabase/functions/demo-org-purge/{handler,index,deno.json}` | ✅ |
| demo-org-purge tests | `deno test supabase/functions/demo-org-purge/__tests__/` | ✅ 11/11 |
| traffic-attribution-recorder tests | `deno test supabase/functions/traffic-attribution-recorder/` | ✅ 11/11 |
| UTM middleware tests | (deferred — runs in main checkout post-merge) | ⏭ |
| Phase 68 vitest scope | `npx vitest run src/components/landing` | ✅ 4/4 |
| tsc | `npx tsc --noEmit` | ✅ exit 0 |

## Human-Verify Signals (DEFERRED TO PHASE 70)

| Signal | Status | Description |
|--------|--------|-------------|
| S1: db push migrations | ⏭ | Depends on Phase 65 `org_subscriptions` drift |
| S2: Deploy demo-org-purge Fn | ⏭ | `npx supabase functions deploy demo-org-purge` |
| S3: Register daily cron for demo-org-purge | ⏭ | Cron migration (Phase 70 close-out batch) |
| S4: Set VITE_CALENDLY_BOOK_DEMO_URL env var | ⏭ | Vercel env + redeploy |
| S5: Visit `/for-doctors`, `/for-clinics`, `/for-coaches` on staging | ⏭ | Hero + features + CTA + JSON-LD `<script>` present |
| S6: View-source confirms `<script type="application/ld+json">` with audience-specific `audienceType` | ⏭ | Schema.org Service per page |
| S7: `https://staging.leanshot.app/?utm_source=clinic_outreach` → 307 → `/for-clinics?utm_source=...` | ⏭ | UTM resolver smoke |
| S8: Admin creates demo org via existing org-create UI + checks `is_demo`; runs seed-demo-org.ts → 5 synthetic patients | ⏭ | End-to-end demo flow |
| S9: 7 days later (or cron `dry_run=false`), demo org auto-purges | ⏭ | Cron correctness |
| S10: PostHog dashboard shows `landing_page` event property on $pageview events | ⏭ | Funnel breakouts |
