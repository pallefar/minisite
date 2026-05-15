---
phase: 15-page-builder-landing-pages
plan: 04
subsystem: page-builder
tags: [page-builder, edge-function, admin-ui, dnd-kit, is-staff, append-only, e2e, slice-1]

requires:
  - phase: 15-page-builder-landing-pages
    plan: 01
    provides: landing_pages + landing_page_revisions tables + profiles.is_staff + RLS (page-save reads is_staff via service-role; revision INSERT path)
  - phase: 15-page-builder-landing-pages
    plan: 02
    provides: admin-bundle / page-builder-runtime / vendor-dnd-kit manualChunks + admin-bundle 25 kB ceiling
  - phase: 15-page-builder-landing-pages
    plan: 03
    provides: src/lib/page-builder/block-schema.ts (BlockType / BlockNode / BlockStyle / RESERVED_SLUGS — imported, NEVER redefined) + page-render (renders the published HTML at /{slug})

provides:
  - "supabase/functions/page-save/{index.ts,index.test.ts,cors.ts,deno.json} — JWT + is_staff gate + reserved-slug + slug-format denylist + append-only revision INSERT (9 Deno tests pass)"
  - "supabase/functions/page-publish/{index.ts,index.test.ts,cors.ts,deno.json} — re-points landing_pages.published_revision_id + best-effort x-prerender-revalidate HEAD (6 Deno tests pass)"
  - "supabase/config.toml — [functions.page-save] verify_jwt=true + [functions.page-publish] verify_jwt=true (appended after the 15-03 [functions.page-render] block; stripe-webhook + page-render blocks byte-unchanged)"
  - "leanshot/src/lib/page-builder/page-api.ts — savePage / publishPage / listPages / getPage / reorderBlocks / newBlock browser-side API module (lands in page-builder-runtime chunk; 5 vitest tests pass)"
  - "leanshot/src/components/admin/pages/PageListView.tsx — /admin/pages index view"
  - "leanshot/src/components/admin/pages/PageEditorView.tsx — 3-panel editor shell (block tree / placeholder preview / property panel) with Save + Publish wired"
  - "leanshot/src/components/admin/pages/editor/BlockTreePanel.tsx — dnd-kit sortable block tree (PointerSensor + KeyboardSensor for a11y reorder)"
  - "leanshot/src/components/admin/pages/editor/PropertyPanel.tsx — token-bounded style fields (4 backgroundTone / 3 alignment / 3 spacingDensity / hideOnMobile) + per-type Content fields"
  - "leanshot/src/components/admin/pages/blocks/{HeroBlock,CTABlock,FooterBlock,block-style-helpers}.ts(x) — the 3 Slice-1 block components (zero raw hex; CSS custom-property tokens only)"
  - "leanshot/src/App.tsx — admin-page-list + admin-page-editor View union members + selectView branches for /admin/pages and /admin/pages/{id} + lazy chunks under <Suspense>"
  - "leanshot/e2e/page-builder-slice1.spec.ts — Playwright editor-interaction happy-path (2 specs pass; 1 @live round-trip fixmed pending live staff seed)"

affects: [15-05, 15-06, 15-07, 15-08, 15-09]

tech-stack:
  added: []
  patterns:
    - "JWT + is_staff gate Edge Function pattern: jwtFromReq → admin.auth.getUser → profiles.is_staff via service-role → 403 if !is_staff. Mirrors stripe-checkout's lazy singleton admin client + Proxy + __setAdminForTest test harness verbatim."
    - "RESERVED_SLUGS Deno-side mirror — the Vite @/ alias cannot be resolved by the Deno bundler, so the array + helper is duplicated in page-save/index.ts with a // MIRROR comment. Browser-side block-schema.ts remains the SSOT; the two MUST stay in lockstep (see 'Keep-in-sync items' below)."
    - "Append-only revision INSERT pattern: only ever .insert() into landing_page_revisions — never .update() or .delete(). Defence-in-depth alongside Plan 15-01's DB triggers."
    - "Best-effort revalidation HEAD: try/catch-wrapped fetch with x-prerender-revalidate header; failure → console.warn + 200 response unchanged. Pattern lifted from RESEARCH Pattern 4."
    - "supabase.functions.invoke('<function-name>', { body: {...} }) — existing project pattern (PaywallUpsell.tsx analog). Session JWT attached automatically by supabase-js; no hand-rolled Authorization header."
    - "Stable dnd-kit API: DndContext + closestCenter + PointerSensor (5px distance) + KeyboardSensor (sortableKeyboardCoordinates) + SortableContext + useSortable + CSS.Transform from @dnd-kit/utilities. NOT @dnd-kit/react."
    - "Token-bounded block style fields: 4 exact backgroundTone Select options, 3 alignment, 3 spacingDensity, hideOnMobile checkbox. No hex pickers, no free-text style. Mapped to CSS custom-property classes (block-style-helpers.ts)."

key-files:
  created:
    - supabase/functions/page-save/index.ts
    - supabase/functions/page-save/index.test.ts
    - supabase/functions/page-save/cors.ts
    - supabase/functions/page-save/deno.json
    - supabase/functions/page-publish/index.ts
    - supabase/functions/page-publish/index.test.ts
    - supabase/functions/page-publish/cors.ts
    - supabase/functions/page-publish/deno.json
    - leanshot/src/lib/page-builder/page-api.ts
    - leanshot/src/lib/page-builder/page-api.test.ts
    - leanshot/src/components/admin/pages/PageListView.tsx
    - leanshot/src/components/admin/pages/PageEditorView.tsx
    - leanshot/src/components/admin/pages/editor/BlockTreePanel.tsx
    - leanshot/src/components/admin/pages/editor/PropertyPanel.tsx
    - leanshot/src/components/admin/pages/blocks/HeroBlock.tsx
    - leanshot/src/components/admin/pages/blocks/CTABlock.tsx
    - leanshot/src/components/admin/pages/blocks/FooterBlock.tsx
    - leanshot/src/components/admin/pages/blocks/block-style-helpers.ts
    - leanshot/e2e/page-builder-slice1.spec.ts
  modified:
    - supabase/config.toml
    - leanshot/src/App.tsx

key-decisions:
  - "Edge Function CORS posture mirrors stripe-checkout (Access-Control-Allow-Origin: * + Bearer JWT as auth gate). Verbatim byte copy of cors.ts + deno.json (diff produces no output)."
  - "RESERVED_SLUGS duplication is intentional and the SINGLE allowed cross-stack mirror. Block-schema.ts is the SSOT for the browser; page-save/index.ts carries an explicit // MIRROR comment + project-rule statement."
  - "Append-only invariant is enforced by code AS WELL AS DB triggers (Plan 15-01 owns the DB-level proof). The acceptance grep `\\.update(\\|\\.delete(` returns 1 — the match is in the file's docstring, NOT executable code; reading the write path confirms only .insert() against landing_page_revisions."
  - "Slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` is enforced server-side for ALL slugs (new + edits) — defence against future client bugs that could surface a 'Has Spaces/'-style slug. Reserved-slug check only fires for NEW pages (rename-to-reserved is not a Slice-1 surface)."
  - "Client `selectView` route guard is documented in-code as defense-in-depth ONLY — the security boundary is RLS + the Edge Functions' is_staff check (T-15-04-01 / T-15-04-02). A non-staff user can reach the editor UI but every write returns 403 and listPages returns 0 rows under RLS."
  - "PageEditorView center panel is a static 'Live preview lands in plan 15-05' placeholder, NOT an iframe. Cross-plan contract — 15-05 owns the PreviewPane. The placeholder lists block types so the editor is still informative."
  - "page-api.ts returns typed Result<T> = { ok: true, value } | { ok: false, error } instead of throwing — the UI can branch on `forbidden` / `reserved_slug` / `invalid_slug` to surface UI-SPEC error copy without try/catch ceremony."
  - "PageListView empty state copy is verbatim from UI-SPEC Copywriting Contract: 'No pages yet' / 'Build your first landing page to start converting visitors.' / CTA 'New page'."
  - "Save-error UI-SPEC copy branching: reserved_slug → 'That slug is reserved. Pick a different one.'; invalid_slug → 'Slug must be lowercase letters, numbers, and hyphens.'; else → 'Couldn't save changes. Check your connection and try again.'"
  - "e2e Slice-1 live round-trip is explicitly `test.fixme` (NOT it.skip — vitest distinction does not apply to Playwright but the spec intent is the same): the staff-user seed + Edge Function deploy + cleanup machinery is deferred to a post-orchestrator-deploy follow-up. The editor-interaction half (add block, edit property, button states, drag-handle a11y labels) DOES run in CI against the built app."

metrics:
  duration: ~28 minutes
  tasks_completed: 3
  completed_date: 2026-05-15

requirements-completed: [PAGE-02, PAGE-03, PAGE-07]
---

# Phase 15 Plan 04: Editor Write-Side + Slice-1 End-to-End — Summary

**Ship the Slice-1 close-the-loop write-side of Phase 15: an is_staff user can scaffold a landing page (Hero/CTA/Footer), Save it (append-only revision), Publish it (re-point pointer + best-effort revalidation HEAD), and the page becomes visitable at `/{slug}` via 15-03's `page-render` Edge Function.**

## One-liner

page-save + page-publish Edge Functions (JWT + is_staff gate + reserved-slug denylist + append-only INSERT + revalidation HEAD), plus the minimal editor shell (PageListView + 3-panel PageEditorView + dnd-kit BlockTreePanel + token-bounded PropertyPanel + Hero/CTA/Footer blocks), wired into `/admin/pages/*` as a lazy admin-bundle chunk, with vitest + Deno + Playwright coverage.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | page-save Edge Function (JWT + is_staff + reserved-slug + slug-format + append-only revision INSERT) (TDD) | `62dad31` | `supabase/functions/page-save/{index.ts,index.test.ts,cors.ts,deno.json}`, `supabase/config.toml` |
| 2 | page-publish Edge Function (re-point published_revision_id + best-effort x-prerender-revalidate HEAD) (TDD) | `b15b595` | `supabase/functions/page-publish/{index.ts,index.test.ts,cors.ts,deno.json}` |
| 3 | Editor shell + page-api + Hero/CTA/Footer blocks + App.tsx routing + Slice-1 e2e | `3a26371` | `leanshot/src/App.tsx`, `leanshot/src/lib/page-builder/page-api{,.test}.ts`, `leanshot/src/components/admin/pages/**/*.{ts,tsx}`, `leanshot/e2e/page-builder-slice1.spec.ts` |

## Verification Results

| Gate | Result |
|------|--------|
| `cd supabase/functions/page-save && deno test --allow-all index.test.ts` | **9/9 pass** (8 from plan behavior + 1 reserved-slug variant) |
| `cd supabase/functions/page-publish && deno test --allow-all index.test.ts` | **6/6 pass** |
| `cd leanshot && npx vitest run src/lib/page-builder/page-api.test.ts` | **5/5 pass** |
| `cd leanshot && npx vitest run` (full suite) | **826 pass / 39 skipped / 0 failed** across 73 test files |
| `cd leanshot && npx tsc -b` | clean (strict TS, no errors) |
| `cd leanshot && npx eslint src/components/admin/pages src/lib/page-builder src/App.tsx` | 0 errors, 0 warnings |
| `cd leanshot && npm run build` | succeeds in 3.14s |
| `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh` | exits 0; `admin-bundle chunk OK: 4543 bytes gzipped (ceiling 60000)`; `index chunk OK: 14554 bytes gzipped` |
| `cd leanshot && npx playwright test e2e/page-builder-slice1.spec.ts` | **2 pass / 1 skipped (live round-trip — fixmed)** |
| `grep -c RESERVED_SLUGS supabase/functions/page-save/index.ts` | 6 (≥1 required) |
| `grep -c is_staff supabase/functions/page-save/index.ts` | 5 (≥1 required) |
| `grep -c is_staff supabase/functions/page-publish/index.ts` | 4 (≥1 required) |
| `grep -c x-prerender-revalidate supabase/functions/page-publish/index.ts` | 3 (≥1 required) |
| `grep -c published_revision_id supabase/functions/page-publish/index.ts` | 4 (≥1 required) |
| `grep -c useSortable leanshot/src/components/admin/pages/editor/BlockTreePanel.tsx` | 3 (≥1 required) |
| `grep -c KeyboardSensor leanshot/src/components/admin/pages/editor/BlockTreePanel.tsx` | 3 (≥1 required) |
| `grep -rn '#[0-9a-fA-F]\{6\}' leanshot/src/components/admin/pages/blocks/` | 0 matches (no raw hex — token-bounded) |
| `grep -rn 'interface BlockNode\|type BlockType\b\|interface BlockStyle' leanshot/src/components/admin leanshot/src/lib/page-builder/page-api.ts` | 0 matches (no redefinition) |
| `grep -c admin/pages leanshot/src/App.tsx` | 9 (≥2 required — both route branches + lazy imports + Suspense renders) |
| `grep -c 'admin-page-editor\\|admin-page-list' leanshot/src/App.tsx` | 8 (both in View union + selectView branches + render block) |
| `diff supabase/functions/stripe-checkout/deno.json supabase/functions/page-save/deno.json` | no output (byte-identical) |
| `diff supabase/functions/stripe-checkout/cors.ts supabase/functions/page-save/cors.ts` | no output (byte-identical) |
| `diff supabase/functions/stripe-checkout/deno.json supabase/functions/page-publish/deno.json` | no output (byte-identical) |
| `diff supabase/functions/stripe-checkout/cors.ts supabase/functions/page-publish/cors.ts` | no output (byte-identical) |

## Bundle Math

```
admin-bundle-OYhINdB5.js        14.21 kB │ gzip:  4.51 kB │ ceiling 25 kB (Plan 15-02) → OK
page-builder-runtime-Bbx28mS_.js  3.13 kB │ gzip:  1.16 kB
vendor-dnd-kit-BdavfS4V.js      45.88 kB │ gzip: 15.28 kB
index-D8Gksiuo.js               49.04 kB │ gzip: 14.54 kB │ ceiling 50 kB → OK (no admin/dnd-kit leak into index)
```

Bundle budget script's `dnd-kit index-leak invariant OK: no static @dnd-kit imports in index chunk` confirms the editor's dnd-kit usage routes to `vendor-dnd-kit` only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Auto-fix blocking issue] `node_modules` missing in worktree**

- **Found during:** Task 3 first `npx vitest run` invocation.
- **Issue:** The worktree has no `leanshot/node_modules`; vitest startup error: `Cannot find package 'vitest'`.
- **Fix:** Ran `cd leanshot && npm install --prefer-offline --no-audit --no-fund` (848 packages installed in 7s). Verified the install did NOT leak into the main repo's `leanshot/package.json` / `leanshot/package-lock.json` (per memory `feedback_worktree_executor_npm_install_leak` — checked clean).
- **Files modified:** None tracked — `leanshot/node_modules/**` is gitignored.
- **Commit:** N/A — environment setup only.

**2. [Rule 1 — Test bug] e2e `getByLabel('Heading')` strict-mode collision with 'Subheading'**

- **Found during:** Task 3 first Playwright run of `page-builder-slice1.spec.ts`.
- **Issue:** Playwright strict mode resolved `getByLabel('Heading')` to BOTH the Heading and the Subheading fields (substring match).
- **Fix:** Switched to `getByLabel('Heading', { exact: true })`.
- **Files modified:** `leanshot/e2e/page-builder-slice1.spec.ts` only.
- **Commit:** Folded into Task 3 commit (`3a26371`).

### Out-of-Scope / Pre-existing

**1. Bundle script wave-0 false-negative on `page-builder-runtime` chunk hash**

- The Vite content hash for `page-builder-runtime` lands as `Bbx28mS_` (contains an underscore). The bundle script's hash-stripping `sed` expression matches `[A-Za-z0-9]` only — the trailing underscore prevents the hash segment from being stripped, and the chunk is logged as `wave-0: no page-builder-runtime chunk emitted` even though it exists at 1.16 kB gz.
- This is a Phase 10/11 hash-hyphen-class bug (memory `reference_bundle_budget_hash_hyphen.md` describes the hyphen case which Phase 10 fixed; the underscore variant is unfixed). Not a regression introduced by this plan, and the admin-bundle ceiling — the chunk we actually need to enforce — works correctly (matched, ceiling check executed).
- **Logged for follow-up** in a future infrastructure pass; not in scope for Plan 15-04.

## Authentication Gates

None. This plan ships server-side gates (page-save + page-publish reject non-staff JWTs with 403) — the gates themselves are the deliverable, not blockers to delivery. Deno tests prove the rejection behavior; the live-DB round-trip (which would prove the JWT plumbing end-to-end against a real staff seed) is the `test.fixme`'d third spec in `page-builder-slice1.spec.ts`.

## User Setup Items (Edge Function Secrets)

Before `page-publish` can fire a successful revalidation HEAD in production, the orchestrator (or operator) must set these Supabase Function secrets on project `ytnsipxxmzgaebkqmokp`:

| Secret | Default | Required |
|--------|---------|----------|
| `VERCEL_BYPASS_TOKEN` | `''` (empty) | Yes — without this, the HEAD request will be ignored by Vercel's edge-cache. |
| `SITE_ORIGIN` | `https://leanshot.app` | Optional override (production default is correct). |

Both env vars are read defensively (`?? ''` / `?? 'https://leanshot.app'`) so a missing secret cannot crash the function or the Deno test suite — the publish succeeds at the DB layer regardless, and the only consequence of a missing token is that the visitor sees a slightly stale cached HTML on their next request until natural cache expiry (s-maxage=60 per 15-03).

## Slice-1 End-to-End Loop

**The loop is wired and the editor-interaction half is proven in CI.** Once the orchestrator runs the post-15-04 deploy step:

```
npx supabase functions deploy page-save page-publish page-render --use-api
```

a staff user can:

1. Visit `/admin/pages` → see the (initially empty) list → click **New page**.
2. Land on `/admin/pages/new` → fill **Page title** + **Slug** (e.g. "Test launch" / "test-launch") → click **+ Hero** → BlockTreePanel shows the Hero entry; PropertyPanel auto-opens to the Hero's Content fields → edit **Heading** to the desired text.
3. Click **Save draft** → topbar live region announces "Saving..." then "Saved"; the URL replaces to `/admin/pages/{new-page-id}`.
4. Click **Publish page** → topbar announces "Publishing..." then "Published"; the **Draft** pill flips to **Published** — this fires page-publish, which (a) UPDATEs `landing_pages.published_revision_id` and (b) fires the best-effort `x-prerender-revalidate` HEAD.
5. Open a fresh anonymous browser tab → visit `/test-launch` → see the Hero heading in the rendered HTML served by 15-03's page-render Edge Function.

The full live round-trip is currently `test.fixme`'d in the e2e spec because it requires the orchestrator deploy step PLUS a staff seed user. That seed is **NOT** covered by this plan — it's a downstream Phase 15 close UAT item.

## Wave 3 Plans That Pick Up The Deferred Editor Surfaces

| Surface | Owner |
|---------|-------|
| Live PreviewPane (iframe, srcDoc-rendered) — the center panel of PageEditorView is currently a static placeholder | 15-05 |
| The other 5 core blocks (FAQ, Pricing, Testimonial, Feature grid, Image+text) — `renderBlock` switch cases + editor Content fields + visual contracts | 15-05 |
| Embeds (Calendly, YouTube, Tally) | 15-06 |
| Lead-form block + lead-capture Edge Function | 15-07 |
| Per-page SEO panel (`renderSeoHead` body replacement) | 15-08 |
| Version history UI (browse past `landing_page_revisions`, restore = INSERT a new row with the prior blocks; the `latestRevisionId` plumbing this plan added is the precursor) | 15-09 |
| Asset library + image uploads (the PropertyPanel's Hero/CTA/Footer have no image field yet; that's the 15-09 surface) | 15-09 |
| Templates picker on "New page" | 15-10 |

## Keep-In-Sync Items

**`RESERVED_SLUGS` is mirrored across THREE places.** When extending the deny-list (e.g. to add a new app route that landing pages must not shadow), update ALL THREE in the same commit:

1. `leanshot/src/lib/page-builder/block-schema.ts` — browser-side SSOT (15-03)
2. `supabase/functions/page-save/index.ts` — Deno-side mirror (THIS PLAN)
3. `leanshot/vercel.json` rewrite negative-lookahead (15-02)

The Deno mirror carries an explicit `// MIRROR of src/lib/page-builder/block-schema.ts RESERVED_SLUGS — keep in sync …` header comment. The page-render function (15-03) does NOT need to mirror RESERVED_SLUGS — it gets safety from the `status='published'` filter, not from slug filtering.

## Known Stubs

| Surface | File | Reason |
|---------|------|--------|
| PageEditorView center panel ("Live preview lands in plan 15-05") | `leanshot/src/components/admin/pages/PageEditorView.tsx` | Cross-plan contract — 15-05 owns the PreviewPane iframe (intentional, tracked) |
| Slice-1 e2e @live round-trip (test.fixme) | `leanshot/e2e/page-builder-slice1.spec.ts` | Requires post-deploy staff seed; deferred to Phase 15 close UAT (intentional, tracked) |
| Hero/CTA blocks editor-only (not yet rendered into a live preview iframe) | `leanshot/src/components/admin/pages/blocks/*.tsx` | The components exist + are token-bounded + are renderable; the published HTML is produced by 15-03's render.ts. PreviewPane wiring is 15-05. |

None of these stubs prevent the plan's goal — they are the documented boundaries between this plan and Wave 3.

## Threat Surface Scan

All threat-register items (T-15-04-01 through T-15-04-07) ship mitigated as documented in the plan:

| Threat | Mitigation in this commit |
|--------|---------------------------|
| T-15-04-01 (EoP — non-staff calls page-save/page-publish) | Server-side is_staff gate via service-role `profiles.is_staff` lookup; Deno tests 3 (page-save) + 2 (page-publish) assert 403 + no insert/update on non-staff JWT |
| T-15-04-02 (Spoofing — client route guard trusted) | `selectView` admin/pages branch documented in-code as defense-in-depth only; no client code reads is_staff |
| T-15-04-03 (Tampering — slug shadows app routes) | RESERVED_SLUGS denylist (mirrored from block-schema.ts) + slug-format regex; Deno tests 5/6/7 assert rejection |
| T-15-04-04 (Tampering — repudiable revision history) | page-save only INSERTs into landing_page_revisions; Deno test 6 asserts no .update/.delete calls; 15-01 DB triggers are the defense-in-depth layer |
| T-15-04-05 (Info disclosure — error strings) | All error responses return `{ error: <opaque code> }`; console.error logs server-side only; Deno tests verify exact body shape |
| T-15-04-06 (DoS — revalidation HEAD blocks) | Best-effort fetch wrapped in try/catch; Deno test 5 asserts 200 + update spy still called on simulated fetch failure |
| T-15-04-07 (XSS — block content as HTML) | This plan stores block content as JSONB only — never as HTML strings. 15-03's render.ts (escapeHtml + href safe-list) is the XSS boundary; this plan's responsibility is satisfied. |

No threat-flag rows to add — no new surface beyond the documented register.

## Self-Check: PASSED

- [x] Task 1 commit `62dad31` exists (`git log --oneline -5` confirms)
- [x] Task 2 commit `b15b595` exists
- [x] Task 3 commit `3a26371` exists
- [x] `supabase/functions/page-save/{index.ts,index.test.ts,cors.ts,deno.json}` all exist
- [x] `supabase/functions/page-publish/{index.ts,index.test.ts,cors.ts,deno.json}` all exist
- [x] `leanshot/src/lib/page-builder/page-api.ts` + `page-api.test.ts` exist
- [x] `leanshot/src/components/admin/pages/PageListView.tsx` + `PageEditorView.tsx` exist
- [x] `leanshot/src/components/admin/pages/editor/{BlockTreePanel,PropertyPanel}.tsx` exist
- [x] `leanshot/src/components/admin/pages/blocks/{HeroBlock,CTABlock,FooterBlock,block-style-helpers}.{tsx,ts}` exist
- [x] `leanshot/e2e/page-builder-slice1.spec.ts` exists
- [x] `supabase/config.toml` has `[functions.page-save]` + `[functions.page-publish]` blocks, both `verify_jwt = true`
- [x] All deno test + vitest + tsc + lint + build + playwright gates green
- [x] No `supabase functions deploy` run — left to orchestrator per dispatch instructions
- [x] No modification to STATE.md / ROADMAP.md / REQUIREMENTS.md (orchestrator owns those writes)
