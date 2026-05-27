---
phase: 68
title: Audience Landing + Sales Enablement
status: code-complete (remote-deploy-deferred)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69 (compressed-planner)
plans_completed: 5-of-5
requirements: [LAND-01, LAND-02, LAND-03, LAND-04, LAND-05, LAND-06, LAND-07, LAND-08]
---

# Phase 68: Audience Landing + Sales Enablement — SUMMARY

**Goal:** Ship 3 audience-specific landing pages + schema.org JSON-LD + demo/sandbox mode + per-audience PostHog funnels + UTM-default-landing resolver.

**Status:** **CODE-COMPLETE — REMOTE-DEPLOY DEFERRED.** All 5 plans shipped to main; 3 migrations + 1 Edge Fn + 1 component + 1 middleware extension + 1 seed script + 1 sitemap dual-update. Remote `db push` + `demo-org-purge` Fn deploy + Calendly URL env-var + PostHog funnel-seed-script invocation deferred to Phase 70.

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Deploy/Operator |
|--------|------|---------------|-----------------|
| LAND-01 (/for-doctors) | 68-01 (seed) + 68-03 (render) | ✅ | ⏭ Phase 70 |
| LAND-02 (/for-clinics + Calendly CTA) | 68-01 + 68-03 | ✅ (placeholder-guard for Calendly URL) | ⏭ Phase 70 |
| LAND-03 (/for-coaches) | 68-01 + 68-03 | ✅ | ⏭ Phase 70 |
| LAND-04 (schema.org JSON-LD) | 68-01 (seo_json_ld col) + 68-03 (helmet emission) | ✅ | ⏭ Phase 70 |
| LAND-05 (Demo sandbox + synthetic patients) | 68-01 (is_demo col) + 68-02 (seed script) | ✅ | ⏭ Phase 70 |
| LAND-06 (Auto-purge at 7d, max 30d) | 68-01 (demo_extended_until col) + 68-02 (purge Fn) | ✅ | ⏭ Phase 70 |
| LAND-07 (Per-audience PostHog funnels) | 68-04 (landing_page dim) | ✅ (deployed via Phase 67 funnel-seed) | ⏭ Phase 70 |
| LAND-08 (UTM-default-landing resolver) | 68-01 (utm_landing_defaults) + 68-04 (Edge Middleware) | ✅ | ⏭ Phase 70 |

## Plans Shipped

| Plan | Outcome |
|------|---------|
| 68-01 | 3 migrations (drift-safe DO-blocks): `organizations.is_demo` + `demo_extended_until` columns + partial idx, `utm_landing_defaults` table + 3 seed rows, `landing_pages` 3-page seed via revision-pattern. Rule-1 fix: real schema is `(status, seo_*, published_revision_id)` + separate `landing_page_revisions(block_tree)`, NOT `(blocks, seo, is_public)` as plan assumed. |
| 68-02 | `scripts/seed-demo-org.ts` (deterministic SHA-256 patient IDs; refuses real orgs via `is_demo=true` guard) + `demo-org-purge` Edge Fn (handler/index split; 11/11 Deno tests). Rule-1 fix: 9 child tables manually cleared in correct order (FK is `ON DELETE RESTRICT`, NOT CASCADE as plan assumed). Pwd-drift self-recovered. |
| 68-03 | `<AudienceLandingPage>` (400 LOC lazy-loaded chunk, 4 vitest tests) + 3 routes wired in App.tsx (BEFORE catch-all) + sitemap.xml dual-update (static + `build-sitemap.ts` regenerator). Calendly URL placeholder guard (Phase 60-13 pattern): `${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}` substituted from `VITE_CALENDLY_BOOK_DEMO_URL`; unset → "Coming soon" disabled button. |
| 68-04 | `traffic-attribution-recorder` extended with `landing_page` PostHog dim (2 new Deno tests). UTM resolver in `leanshot/middleware.ts` (NOT the recorder Fn — recorder fires post-React-mount, too late to prevent wrong-audience paint). 8 new vitest integration tests. |
| 68-05 | Close-out (this SUMMARY + VERIFICATION + CARRY-OVER + ROADMAP/STATE/REQUIREMENTS flips). Inline. |

**Total tests added:** 11 Deno (8 baseline preserved + 2 LAND-07 + 1 demo-purge) + 12 vitest (4 AudienceLandingPage + 8 middleware-utm).

## Patterns Established / Reinforced

1. **Revision-pattern seeding for `landing_pages`** — Phase 15's `published_revision_id` FK requires inserting the page → inserting revision → updating page's published_revision_id pointer. 68-01 uses Phase 15's deferrable FK. Mechanical 3-step per page; usable for future landing-page seeding.

2. **FK-CASCADE-vs-RESTRICT pre-flight** — 68-02 caught CASCADE assumption; Phase 28's `org_*` FKs use `ON DELETE RESTRICT`. Handler MUST manually clear child rows in topological order. Pattern: `for child_table in dependencies; do DELETE FROM child_table WHERE org_id = ?; done`. Add to plan-checker as a static-analysis step for any DELETE-cascade plan.

3. **Placeholder-string runtime guard** — Phase 60-13 pattern extends to UI surfaces. `${ENV_PLACEHOLDER}` literal in production-rendered text MUST be replaced at runtime with env value OR rendered as disabled/Coming-soon UI; vitest asserts the literal string is NEVER in rendered DOM. Per `[[feedback_placeholder_string_runtime_guard_pattern]]`.

4. **UTM resolver lives in Edge Middleware, not the recorder Fn** — recorder fires post-React-mount = too late for redirect. Edge Middleware intercepts BEFORE the SPA loads. Architectural fork documented in 68-04 SUMMARY.

5. **Dual sitemap update** — `build-sitemap.ts` regenerates `sitemap.xml` at prebuild; updating only the static file silently undone. Update BOTH or only the script.

## What Didn't Land

- 3 migrations un-pushed (Phase 65 drift blocker).
- `demo-org-purge` Edge Fn un-deployed + un-cron-registered.
- Calendly URL env var unset (Phase 70 operator action).
- Server-side `<title>` for landing pages (Vercel Edge rewrite or pre-render) — defer to v1.5; helmet-set titles + JSON-LD work for JS-aware crawlers (Googlebot, Bingbot).
