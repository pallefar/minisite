---
phase: 19-affiliate-program-stripe-connect
plan: 08
subsystem: affiliate, landing-pages, page-builder, storage, edge-functions
tags: [page-builder, landing, templates, storage-seeding, impression-tracking, d-38, route-registry, bl-3, bl-4, bl-8, bl-9, bl-10]

requires:
  - phase: 19-01
    provides: affiliates.template_choice column + affiliates_public_view + pol_affiliates_public_landing_read + affiliate_impressions table + public.insert_affiliate_impression(uuid,text,text,text) SQL helper
  - phase: 19-05
    provides: InitialsAvatar primitive + affiliate-apply-routes RouteDescriptor type (re-used by landing-routes)
  - phase: 19-06b
    provides: partner-profile-update Edge Function (last config.toml writer; this plan appends after it)
  - phase: 15
    provides: page-builder block-tree JSON schema + landing_pages / landing_page_revisions tables + TEMPLATES catalog + scaffoldFromTemplate helper

provides:
  - "3 admin-owned landing_pages template rows (_template_coach, _template_story, _template_method) with paired block-tree revisions"
  - "marketing-assets Storage bucket (5 MB cap, admin-write / public-read RLS) — vendor uploads checked by scripts/seed-marketing-assets.sh"
  - "3 React landing renderers consuming AffiliatePublicRow from affiliates_public_view"
  - "AffiliateLandingResolver — fetch + impression-ping + lazy-template dispatch"
  - "BL-8 / D-38 impression-tracking pipeline: client (DNT + UA SHA-256) → affiliate-impression Edge Function (verify_jwt=false, rate-limited 10/min /24) → public.insert_affiliate_impression RPC (set_masklen=24)"
  - "BL-4 route registry: src/routes/landing-routes.ts — Plan 19-09 owns App.tsx wiring"
  - "page-builder catalog extension (getAffiliateTemplates() + scaffoldAffiliateTemplate({template, overrides}))"

affects:
  - 19-09  # owns App.tsx wiring + Edge-Function deploy list (must include affiliate-impression)
  - 22     # ADMIN-06 may surface landing-template thumbnail picker

tech-stack:
  added:
    - "crypto.subtle.digest('SHA-256', ...) — client-side UA hashing in impression.ts"
    - "React.lazy + Suspense — per-template chunk-splitting in AffiliateLandingResolver"
  patterns:
    - "Fire-and-forget client ping (void recordImpression() + .catch swallow) — pattern reusable for any non-blocking analytics ping with DNT honor"
    - "Server-side IP truncation via SQL helper (set_masklen) rather than client/Edge truncation — keeps the raw IP off the client and avoids re-implementing /24 logic in TS"
    - "Slot-binding template authoring: in-code TEMPLATES catalog + SQL block-tree seed mirror each other; renderer substitutes {{slot}} from the live affiliate row at render time"

key-files:
  created:
    - "supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql"
    - "supabase/functions/affiliate-impression/index.ts"
    - "supabase/functions/affiliate-impression/index.test.ts"
    - "supabase/functions/affiliate-impression/deno.json"
    - "leanshot/src/components/landing/LandingTemplateCoach.tsx"
    - "leanshot/src/components/landing/LandingTemplateStory.tsx"
    - "leanshot/src/components/landing/LandingTemplateMethod.tsx"
    - "leanshot/src/components/landing/AffiliateLandingResolver.tsx"
    - "leanshot/src/components/landing/__tests__/LandingTemplateCoach.test.tsx"
    - "leanshot/src/components/landing/__tests__/LandingTemplateStory.test.tsx"
    - "leanshot/src/components/landing/__tests__/LandingTemplateMethod.test.tsx"
    - "leanshot/src/lib/affiliate/impression.ts"
    - "leanshot/src/lib/affiliate/__tests__/impression.test.ts"
    - "leanshot/src/lib/page-builder/__tests__/affiliate-templates.test.ts"
    - "leanshot/src/routes/landing-routes.ts"
    - "leanshot/scripts/seed-marketing-assets.sh"
  modified:
    - "supabase/config.toml — appended [functions.affiliate-impression] block (5th writer in chain)"
    - "leanshot/src/lib/page-builder/templates.ts — added Template.category field + 3 affiliate templates (coach/story/method) + getAffiliateTemplates + scaffoldAffiliateTemplate"
    - "leanshot/src/lib/page-builder/templates.test.ts — relaxed 'exactly 5' assertion to 'contains the 5 Phase 15 ids' to accept the affiliate extension"

key-decisions:
  - "Template architecture: in-code TEMPLATES catalog (for runtime + PartnerTemplatePicker) MIRRORS the SQL block-tree seed (for admin editor + page-render). The renderer components are hand-coded React (not block-tree-driven) so the landing-page render path stays simple + lazy-chunk-splittable. Future v1.3 affiliate-customizable templates can pivot to runtime block-tree rendering without re-architecting the data."
  - "IP truncation responsibility: Edge Function forwards RAW IP from x-forwarded-for to the SQL helper; the helper applies set_masklen=24 server-side. Rationale: keeps the /24 logic in a single SECURITY DEFINER function (Plan 19-01 migration 5a) where it's audit-reviewable, and avoids duplicating dotted-quad parsing in both TS + plpgsql."
  - "Default quote in story template: when an affiliate has no testimonial_quote yet (newly-approved partners), we render a generic LeanShot value-prop quote instead of breaking the layout. This matches UI-SPEC §Copywriting Contract line 424's 'placeholder copy until affiliate customizes' guidance."

patterns-established:
  - "Fire-and-forget ping: `void recordImpression(id)` + silent `.catch(() => undefined)` + `keepalive:true` — survives page unload, never blocks render"
  - "DNT-honor gate as a pure helper: `shouldRecordImpression()` exported separately from `recordImpression()` so unit tests can assert DNT logic without mocking crypto.subtle or fetch"
  - "Template-catalog mirror: in-code catalog + SQL seed for the same block tree, kept in sync via code review (NOT via build-time generation, so both halves stay independently editable)"

requirements-completed: [AFF-08, AFF-09, AFF-04]

duration: ~70min
completed: 2026-05-15
---

# Phase 19 Plan 08: Affiliate landing templates + D-38 impression tracking Summary

**3 co-branded `/r/{code}/landing` templates (`coach`/`story`/`method`) wired to anon-readable `affiliates_public_view` via `AffiliateLandingResolver`, with a verify_jwt=false `affiliate-impression` Edge Function that calls Plan 19-01's `insert_affiliate_impression(uuid,text,text,text)` SQL helper for server-side `/24` IP truncation. Client wrapper honors `navigator.doNotTrack`, hashes UA via `crypto.subtle.digest('SHA-256', ...)`, and is fire-and-forget (`void recordImpression(id)`).**

## Performance

- **Duration:** ~70 min (single executor, Wave 5)
- **Started:** 2026-05-15T18:24Z (worktree base reset to `9ea3062`)
- **Completed:** 2026-05-15T19:34Z
- **Tasks:** 4/4 (Task 4 is a checkpoint:human-verify deferred to vendor pass)
- **Files created:** 16
- **Files modified:** 3
- **Commits:** 4 task-level (`e168df1`, `d58460e`, `19c8379`, `012c08d`)

## Accomplishments

- **D-38 / BL-8 / BL-9 / BL-10 closed:** end-to-end impression-tracking pipeline shipped — client wrapper (DNT-honoring fire-and-forget) → `affiliate-impression` Edge Function (rate-limited 10/min per /24, body-validated, existence-checked) → Plan 19-01 `public.insert_affiliate_impression(uuid,text,text,text)` SQL helper (SECURITY DEFINER, `set_masklen=24`). Raw IP never persisted; raw UA never leaves the browser.
- **D-16 / D-17 closed:** 3 landing-page templates (`coach`/`story`/`method`) ship as both (a) admin-owned landing_pages rows with paired block-tree revisions (Phase 15 page-builder instances), and (b) hand-coded React renderers that subscribe to slot bindings from the affiliate row. Catalog mirror in `src/lib/page-builder/templates.ts` exposes them to `PartnerTemplatePicker` (Plan 19-06b).
- **BL-3 honored:** zero schema mutation in this plan — all column / view / policy ownership lives in Plan 19-01 migrations (20270101000001 + 20270101000004 + 20270101000005). This plan's migration is seed-only.
- **BL-4 honored:** `src/App.tsx` UNTOUCHED. New `src/routes/landing-routes.ts` registry exports `LANDING_ROUTES` with the `^/r/([a-z0-9-]+)/landing$` matcher hint for Plan 19-09's wiring task.
- **marketing-assets bucket** (D-13 / D-14) created with admin-write / anon-read RLS; vendor upload of the asset library is gated by `leanshot/scripts/seed-marketing-assets.sh` (checkpoint:human-verify deferred).

## Task Commits

1. **Task 1 — Seed migration + page-builder catalog extension** — `e168df1` (feat)
2. **Task 2 — affiliate-impression Edge Function + client wrapper** — `d58460e` (feat)
3. **Task 3 — 3 landing renderers + resolver + route registry** — `19c8379` (feat)
4. **Task 4 — marketing-assets seed checker script** — `012c08d` (chore) — vendor upload deferred to checkpoint

All commits use pathspec staging per `feedback_parallel_executor_git_isolation`.

## Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql` | 3 landing_pages template rows + paired revisions + marketing-assets bucket + 3 storage RLS policies |
| `supabase/functions/affiliate-impression/index.ts` | Public POST endpoint — rate-limit, validate, lookup, RPC |
| `supabase/functions/affiliate-impression/index.test.ts` | 4 Deno tests (T1 GET→405, T2 happy path, T3 11th→429, T4 unknown→200) |
| `supabase/functions/affiliate-impression/deno.json` | Deno test runner config (mirror affiliate-apply) |
| `leanshot/src/components/landing/LandingTemplateCoach.tsx` | Photo-forward split hero + value-prop grid + CTA + footer |
| `leanshot/src/components/landing/LandingTemplateStory.tsx` | Testimonial-forward hero + benefit grid |
| `leanshot/src/components/landing/LandingTemplateMethod.tsx` | Bullets-only hero (no above-fold photo) + attribution card |
| `leanshot/src/components/landing/AffiliateLandingResolver.tsx` | Fetch + impression-ping + lazy-template dispatch + 404 view |
| `leanshot/src/components/landing/__tests__/LandingTemplate*.test.tsx` | 15 vitest assertions across 3 files |
| `leanshot/src/lib/affiliate/impression.ts` | DNT-gated fire-and-forget ping; UA SHA-256 hash; keepalive fetch |
| `leanshot/src/lib/affiliate/__tests__/impression.test.ts` | 7 vitest assertions (DNT gate + body shape + non-blocking + empty-id guard) |
| `leanshot/src/lib/page-builder/__tests__/affiliate-templates.test.ts` | 7 vitest assertions on catalog + scaffolding |
| `leanshot/src/routes/landing-routes.ts` | BL-4 route registry — Plan 19-09 consumes |
| `leanshot/scripts/seed-marketing-assets.sh` | Vendor-pass bucket-seed checker (idempotent; exit 1 on under-seeded with copy-paste upload manifest) |

## Files Modified

- **`supabase/config.toml`** — Appended `[functions.affiliate-impression]` block with `verify_jwt = false` after Wave 4's `partner-profile-update` block. 5th writer in the chain (19-02 → 19-03 → 19-05 → 19-06b → 19-08).
- **`leanshot/src/lib/page-builder/templates.ts`** — Added `Template.category: 'page' | 'affiliate'` field (existing 5 templates marked `'page'`); added 3 affiliate `TemplateId` literals + 3 catalog entries (`coach`/`story`/`method`); added `getAffiliateTemplates()` + `scaffoldAffiliateTemplate({template, overrides})` helpers with recursive `{{slot}}` substitution. Existing `scaffoldFromTemplate(id)` Phase 15 API is unchanged.
- **`leanshot/src/lib/page-builder/templates.test.ts`** — Relaxed "exactly 5 entries" assertion to "contains the 5 Phase 15 ids" (subset check) to accept the affiliate extension. All other Phase 15 assertions untouched.

## Decisions Made

- **Template architecture (in-code + SQL mirror):** The 3 affiliate templates ship as BOTH (a) admin-owned landing_pages block-tree rows visible to the Phase 15 admin editor, AND (b) hand-coded React renderers. Rationale: the runtime landing-page hot path stays simple + lazy-chunk-splittable; the admin can still see/edit a "what does template X look like?" preview via the page-builder; and v1.3 can pivot to fully block-tree-driven rendering later without re-architecting the data. The two halves are kept in sync via code review (NOT build-time generation, so both stay independently editable).
- **IP truncation in SQL helper, not Edge / client:** Edge Function forwards RAW IP from `x-forwarded-for` to `public.insert_affiliate_impression(p_affiliate_id, p_ip, p_ua_hash, p_referer)`; the helper applies `set_masklen(p_ip::inet, 24)` server-side. Single source of truth for the /24 logic; SECURITY DEFINER + audit-reviewable.
- **Default quote fallback in story template:** When `testimonial_quote` is empty (newly-approved affiliates), render a generic LeanShot value-prop quote rather than break the layout. Matches UI-SPEC §Copywriting Contract line 424's "placeholder copy until affiliate customizes" guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase 15 `templates.test.ts` assertion "exactly 5 entries"**

- **Found during:** Task 1 (immediate test run after extending TEMPLATES catalog)
- **Issue:** The Phase 15 test asserted `Object.keys(TEMPLATES).sort()` equals exactly the 5-entry array. Adding 3 affiliate entries to the catalog broke the assertion.
- **Fix:** Relaxed to a subset check — assert each of the 5 Phase 15 ids is present in the catalog. All other Phase 15 assertions (`every template has hero + cta + footer`, `every BlockStyle uses token-bounded values`, etc.) iterate over `EXPECTED_IDS` and are unchanged.
- **Files modified:** `leanshot/src/lib/page-builder/templates.test.ts`
- **Commit:** `e168df1`

**2. [Rule 3 - Blocking] Worktree cwd-drift trap on initial Task 1 write**

- **Found during:** Task 1 staging (after writing migration + templates.ts)
- **Issue:** Initial Edit/Write calls used absolute paths starting `/Users/karstenhaldan/minisite/...` — those resolve to the MAIN repo, not the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a7a2c8434cfb85d9a/...`. Files landed in main-repo working tree; staging there hit the `worktree HEAD on main` HALT (#2924).
- **Fix:** Copied the 4 new files into the worktree, reverted main-repo touches, re-staged from inside the worktree (which is on `worktree-agent-a7a2c8434cfb85d9a`). All subsequent tasks (2/3/4) used worktree-relative paths exclusively.
- **Reference:** `[[reference-worktree-path-safety]]` — this confirms the trap is live in the executor's default cwd behavior. Future plans should default to worktree-relative paths.
- **Commit:** None (recovery action; no functional change).

**3. [Rule 1 - Bug] `eslint-plugin-import-x/order` flagged 2 test imports**

- **Found during:** Task 3 lint check
- **Issue:** Type-import of `AffiliatePublicRow` from `LandingTemplateCoach` was ordered after value-imports from sibling template files in the Story + Method test files.
- **Fix:** Auto-fix via `eslint --fix`. Type imports now precede value imports per project convention.
- **Files modified:** `LandingTemplateStory.test.tsx`, `LandingTemplateMethod.test.tsx`
- **Commit:** `19c8379` (rolled into Task 3 commit)

### Manual deferrals

- **Task 4 upload step (checkpoint:human-verify):** The script `leanshot/scripts/seed-marketing-assets.sh` is committed and the bucket is created by the migration, but the actual asset uploads (logo SVG/PNG, banner PNGs, swipe-copy .txt) are deferred to the vendor pass since the source art is brand-controlled and lives outside the repo. The script prints the expected manifest + `supabase storage upload` commands on under-seeded runs. Vendor runs it after delivering art to `.planning/design-system/marketing-assets/` (or equivalent curated location).

## Verification Results

| Check | Result |
|------|--------|
| `npx vitest run src/lib/page-builder/__tests__/affiliate-templates.test.ts` | 7 / 7 pass |
| `npx vitest run src/lib/page-builder/templates.test.ts` (Phase 15 regression) | 11 / 11 pass |
| `npx vitest run src/lib/affiliate/__tests__/impression.test.ts` | 7 / 7 pass |
| `npx vitest run src/components/landing` | 15 / 15 pass (5 per template × 3) |
| `deno test --allow-env --allow-net supabase/functions/affiliate-impression/index.test.ts` | 4 / 4 pass |
| `npx eslint src/components/landing/ src/lib/affiliate/ src/lib/page-builder/ src/routes/landing-routes.ts` | clean |
| `npx tsc -b` (strict-mode typecheck) | clean |
| `npm run build` | succeeds; `index-DWpm_usB.js` 49.54 kB / **14.56 kB gz** (well under the 24.5 kB Phase 9-tightened ceiling) |
| Per-template chunk gz ≤ 12 kB | DEFERRED — chunks emerge only after Plan 19-09 imports `LANDING_ROUTES` into App.tsx; source files are 4-7 KB raw, will be well under 12 kB gz post-transform |

**Total: 33 vitest + 4 Deno tests added.**

## Edge Function deploy list (for Plan 19-09)

When Plan 19-09 deploys Edge Functions, include the NEW function:

```
supabase functions deploy affiliate-impression --no-verify-jwt
```

(Or simply `supabase functions deploy` to pick up all changed functions plus the `config.toml` `verify_jwt = false` flag.)

## Plan 19-09 wiring requirements

Plan 19-09 must:

1. Import `LANDING_ROUTES` from `@/routes/landing-routes`.
2. Match `^/r/([a-z0-9-]+)/landing$` on `window.location.pathname`.
3. Capture the regex group as `code` and pass it as a prop:
   ```tsx
   <Suspense fallback={null}>
     <AffiliateLandingResolver code={match[1]!} />
   </Suspense>
   ```
4. The existing Plan 19-02 `/r/{code}` (no `/landing` suffix) cookie-set rewrite is distinct — handled by Vercel rewrite + `affiliate-attribute` Edge Function. The `/landing` suffix is what selects THIS resolver.

## Self-Check: PASSED

All 4 task commits exist:
- `e168df1` (Task 1)
- `d58460e` (Task 2)
- `19c8379` (Task 3)
- `012c08d` (Task 4)

All required artifacts present at the listed paths.
