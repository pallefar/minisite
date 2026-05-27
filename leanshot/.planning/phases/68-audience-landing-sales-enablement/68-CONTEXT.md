# Phase 68: Audience Landing + Sales Enablement — Context

**Gathered:** 2026-05-27
**Mode:** Compressed-discuss (autonomous run; landing-page + sandbox feature scope)

## Phase Boundary

Ship 3 audience-specific landing pages (`/for-doctors`, `/for-clinics`, `/for-coaches`) + schema.org JSON-LD per audience + demo/sandbox mode for clinic-buyer prospects (synthetic patients + 7d auto-purge) + per-audience PostHog Funnels + UTM-default-landing resolver. Closes research HD11 + HD13.

## Decisions

### D-01 — Landing pages built via Phase 15 page-builder seed (not standalone components)
**Choice:** Each of the 3 pages is a SEEDED `landing_pages` row (database-backed, page-builder block JSON) at slugs `/for-doctors`, `/for-clinics`, `/for-coaches`. Migration ships a seed-insert SQL with the block JSON for each page. Operator (or page-builder admin UI) can edit copy post-deploy without code changes.

### D-02 — JSON-LD via existing page-builder helper
**Choice:** Phase 15 ships `src/lib/page-builder/json-ld.ts`. Use it. Add per-audience `serviceType` + `audience` fields to the seeded page JSON; page-builder render path emits `<script type="application/ld+json">` automatically.

### D-03 — Sitemap inclusion
**Choice:** `leanshot/src/lib/sitemap.ts` (or whichever Phase 50/60-13 sitemap module exists) — add the 3 new slugs to the static-route enumeration. Migration also adds the slugs to any `landing_pages.is_public` flag if such a flag exists.

### D-04 — Demo / sandbox mode (`organizations.is_demo`)
**Choice:** New boolean column `organizations.is_demo` (default false). Synthetic-patient generator at `scripts/seed-demo-org.ts` (deterministic — fixed seeds for reproducibility). Admin creates demo-org via existing admin org-create flow + checks "demo" — backend triggers seed-demo-org.ts via Edge Fn `seed-demo-org` OR operator runs the script manually.

### D-05 — Demo auto-purge
**Choice:** New Edge Fn `demo-org-purge` runs daily via pg_cron. Selects `organizations WHERE is_demo = true AND created_at < now() - interval '7 days' AND NOT extended_until > now()`. Cascade-deletes all dependent rows (patients, dose-logs, etc.) — relies on existing FK ON DELETE CASCADE. Admin UI surfaces "extend up to 30 days" button.

### D-06 — RLS for demo orgs
**Choice:** Existing org-scoped RLS suffices — demo orgs ARE orgs, just with `is_demo=true`. No cross-tenant SELECT because the org membership tables already enforce org-scoping. The `is_demo` flag is informational + drives the purge cron + the admin UI label.

### D-07 — PostHog funnel wiring
**Choice:** Extend Phase 51 `traffic-attribution-recorder` to capture `landing_page` dimension (which audience landing page the user entered through). Funnel-break alerts from Phase 67 will use this dim to break out conversion per-audience.

### D-08 — UTM-default-landing resolver
**Choice:** New table `utm_landing_defaults (utm_source text PK, landing_path text)`. Pre-seed with: `(clinic_outreach, /for-clinics)`, `(coach_referral, /for-coaches)`, `(doctor_referral, /for-doctors)`. Resolver in `traffic-attribution-recorder` Edge Fn: if landing URL is root `/` AND UTM source matches → redirect (307) to mapped path. Otherwise pass through.

### D-09 — Calendly demo-book CTA
**Choice:** `/for-clinics` page CTA "Book demo" links to existing Calendly URL (Phase 59 + Phase 70 operator-action vendor registration). Use `VITE_CALENDLY_BOOK_DEMO_URL` env var; falls back to placeholder if unset (with 503-guard pattern at runtime? — NO, marketing page just shows the button greyed-out with "Coming soon" if env is empty).

### D-10 — Deploy gating
**Choice:** Same as Phases 65/66/66.5/67 — code-complete; remote deploy + operator-run items defer to Phase 70.

## Code Context

- Phase 15 page-builder lib: `leanshot/src/lib/page-builder/*` — `block-schema.ts`, `json-ld.ts`, `escape-html.ts`, `build-image-url.ts`, `embed-src.ts`
- Existing landing templates: `leanshot/src/components/landing/LandingTemplate{Coach,Gold,Method,Story}.tsx` — reuse pattern; per-audience can ship 3 new template variants OR reuse existing variants with different copy
- Affiliate landing resolver: `leanshot/src/components/landing/AffiliateLandingResolver.tsx` (Phase 33-05?)
- Existing marketing page: `leanshot/src/components/marketing/Landing.tsx` — generic landing (pre-onboarding)
- Phase 51 `traffic-attribution-recorder` Edge Fn: `supabase/functions/traffic-attribution-recorder/`
- Sitemap: check `leanshot/src/lib/sitemap.ts` OR `leanshot/public/sitemap.xml` (Phase 60-13 may have generated)
- `organizations` table: see migrations (Phase 28 owned the schema; Phase 31 may have extended)

## Deferred

- Per-audience video on landing pages — defer to v1.5 content creation
- A/B test of CTA copy — Phase 67 funnel alerts will surface winners
- HIPAA-BAA download attachment on `/for-clinics` — Phase 64 LEGAL-09 ships subprocessor list; link to that
