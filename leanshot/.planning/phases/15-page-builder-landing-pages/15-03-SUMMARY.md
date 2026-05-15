---
phase: 15-page-builder-landing-pages
plan: 03
subsystem: page-builder
tags: [page-builder, edge-function, contract, xss-escape, cache-control, deno, page-render]

requires:
  - phase: 15-page-builder-landing-pages
    plan: 01
    provides: landing_pages + landing_page_revisions schema (status, published_revision_id, seo, blocks jsonb) — page-render queries it under service-role
  - phase: 15-page-builder-landing-pages
    plan: 02
    provides: vercel.json rewrite to /{slug} → page-render?slug=$1 (query-param wiring); page-builder-runtime manualChunks rule under src/lib/page-builder/

provides:
  - "leanshot/src/lib/page-builder/block-schema.ts — single source of BlockType (12 literals), BlockNode, BlockStyle, BlockTree, RESERVED_SLUGS, isReservedSlug() — imported by editor plans 15-04..07 without redefinition"
  - "supabase/functions/page-render/render.ts — Deno HTML builder with escapeHtml / renderBlock (hero/cta/footer cases + default-fall-through) / renderSeoHead STUB seam / renderPage / renderNotFound — all exported"
  - "supabase/functions/page-render/index.ts — public Deno.serve dispatcher; service-role admin client; ?slug= + path-segment slug extraction; published-only SELECT filter; Cache-Control: public, s-maxage=60, stale-while-revalidate=86400; never echoes DB errors"
  - "supabase/config.toml — [functions.page-render] verify_jwt = false (Pitfall 7 / T-15-03-06)"

affects: [15-04, 15-05, 15-06, 15-07, 15-08]

tech-stack:
  added: []
  patterns:
    - "Deno HTML string-builder with switch-on-type + default-fall-through extension point (15-05/06/07 ADD their case names; restructuring NOT required)"
    - "renderSeoHead(opts) named SEO seam — 15-08 replaces the BODY, NOT the signature/name (downstream plan agreement)"
    - "Local-mirror BlockType/BlockNode/BlockStyle in render.ts — Deno cannot resolve leanshot/src; mirror MUST stay byte-identical with block-schema.ts (canonical source)"
    - "Ampersand-first HTML escape (no double-encode of &lt; → &amp;lt;)"
    - "href safe-list — only http(s)://, fragment (#), or relative (/...) hrefs interpolated; javascript:/data:/vbscript:/bare schemes drop to '#'"
    - "Hard status='published' filter in addition to the joined published_revision_id (defense in depth against service-role RLS bypass — T-15-03-01)"
    - "Per-response Content-Type/Cache-Control/Vary header assembly (BASE_RESPONSE_HEADERS empty; HTML success + 404 + 500 each pick their own set)"

key-files:
  created:
    - leanshot/src/lib/page-builder/block-schema.ts
    - leanshot/src/lib/page-builder/block-schema.test.ts
    - supabase/functions/page-render/render.ts
    - supabase/functions/page-render/render.test.ts
    - supabase/functions/page-render/index.ts
    - supabase/functions/page-render/index.test.ts
    - supabase/functions/page-render/cors.ts
    - supabase/functions/page-render/deno.json
  modified:
    - supabase/config.toml

key-decisions:
  - "BlockType is a 12-literal union locked at this plan (D-03 8 core + 3 embed + 1 form); the literal STRINGS are the contract — render.ts mirrors them as switch case names"
  - "RESERVED_SLUGS ships with 8 entries: clinic / admin / share / api / auth / assets / sitemap.xml / robots.txt — first six mirror 15-02 vercel.json's negative-lookahead"
  - "isReservedSlug normalizes via trim + lowercase before exact-match (paste-from-clipboard tolerance)"
  - "renderBlock implements ONLY hero / cta / footer in this plan; default branch returns '' so 15-05/06/07 add their case names without restructuring"
  - "renderSeoHead is a NAMED seam (NOT renderHead); STUB body emits charset + viewport + <title> + Geist+Fraunces preloads — nothing else. 15-08 replaces the BODY only; signature + name fixed"
  - "render.ts ships ZERO <script> tags (verified by grep gate) — published pages are pure HTML/CSS, no JS, CLS = 0"
  - "href safe-list is enforced INSIDE renderBlock (not at the data boundary) — render.ts is the XSS boundary; never trust the shape of block.content"
  - "page-render index.ts uses service-role admin client (mirrors share/) but enforces access control via the .eq('status','published') filter — service role bypasses RLS, so this filter is the gate"
  - "Slug extraction: ?slug= (production via 15-02 vercel.json) wins over last-path-segment fallback (local dev / direct function URL)"
  - "404 responses carry the SAME Cache-Control as 200 — short s-maxage=60 is fine; this is intentional"
  - "cors.ts emits Access-Control-Allow-Origin: * with NO credentials — published pages are anonymous (T-15-03-05). Opposite posture to share/cors.ts"
  - "config.toml [functions.page-render] block appended immediately after [functions.stripe-webhook]; stripe-webhook block byte-unchanged (verified)"

metrics:
  duration: ~25 minutes
  tasks_completed: 3
  completed_date: 2026-05-15

requirements-completed: [PAGE-06, PAGE-03]
---

# Phase 15 Plan 03: Block-Schema Contract + page-render Edge Function — Summary

**Ship the Slice-1 backend half of Phase 15's thinnest end-to-end slice: the block-schema TS contract that editor plans 15-04/05/06/07 import without redefining, plus the public `page-render` Edge Function that turns a published revision's JSONB block tree into static HTML.**

## One-liner

Block-schema.ts + page-render Deno function (hero/cta/footer rendering + XSS escape + `renderSeoHead` SEO seam stub for 15-08 + published-only SELECT + CDN cache headers + zero shipped JavaScript).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | block-schema contract module (TDD) | `556df31` | `leanshot/src/lib/page-builder/block-schema.ts`, `…/block-schema.test.ts` |
| 2 | render.ts — hero/cta/footer + escape + SEO seam stub (TDD) | `9770c43` | `supabase/functions/page-render/render.ts`, `…/render.test.ts` |
| 3 | page-render Edge Function + config.toml block | `2317f17` | `supabase/functions/page-render/index.ts`, `…/index.test.ts`, `…/cors.ts`, `…/deno.json`, `supabase/config.toml` |

## Performance

- **Duration:** ~25 min (Task 1: ~7 min — TDD round-trip; Task 2: ~10 min — XSS-payload + stub-minimality test design; Task 3: ~8 min — mock supabase-js builder + the cwd-drift recovery noted below)
- **Tasks:** 3/3
- **Files created:** 8 (+ 1 modified — config.toml)

## Accomplishments

### `BlockType` literal list as shipped (Contract 1 — for 15-04/05/06/07)

```typescript
export type BlockType =
  | 'hero' | 'cta' | 'faq' | 'pricing' | 'testimonial'
  | 'feature-grid' | 'image-text' | 'footer'
  | 'calendly' | 'youtube' | 'tally' | 'lead-form';
```

12 literals — 8 core (D-03) + 3 embed (D-01) + 1 form (D-12).

### `BlockNode` / `BlockStyle` field shapes as shipped

```typescript
interface BlockNode {
  id: string;                            // nanoid(8), stable within revision
  type: BlockType;
  parent_id: string | null;              // null = root level
  order: number;                         // integer sibling sort key
  content: Record<string, unknown>;      // narrowed per-type defensively
  style: BlockStyle;
}

interface BlockStyle {
  backgroundTone?: 'default' | 'subtle' | 'brand' | 'dark';
  alignment?:      'left' | 'center' | 'right';
  spacingDensity?: 'compact' | 'default' | 'spacious';
  hideOnMobile?:   boolean;              // D-06 — the ONE universal responsive prop
}

type BlockTree = BlockNode[];
```

### `RESERVED_SLUGS` as shipped (D-10)

```typescript
export const RESERVED_SLUGS = [
  'clinic', 'admin', 'share', 'api', 'auth', 'assets',
  'sitemap.xml', 'robots.txt',
] as const;
```

The first six MUST stay in lockstep with 15-02's `vercel.json` negative-lookahead `/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\\.html|assets/).+)`. If 15-04 needs to extend the deny-list, it MUST update both this tuple AND the lookahead in the same commit.

### `renderBlock()` case names — what THIS plan implements vs the extension point

| Case | This plan | Future plan |
|------|-----------|-------------|
| `hero` | ✓ shipped | — |
| `cta` | ✓ shipped | — |
| `footer` | ✓ shipped | — |
| `faq` | — | 15-05 |
| `pricing` | — | 15-05 |
| `testimonial` | — | 15-05 |
| `feature-grid` | — | 15-05 |
| `image-text` | — | 15-05 |
| `calendly` | — | 15-06 |
| `youtube` | — | 15-06 |
| `tally` | — | 15-06 |
| `lead-form` | — | 15-07 |

The `default:` branch returns `''` — later plans add their case name WITHOUT restructuring the switch. Confirmed by `renderBlock: unimplemented type returns empty string` test passing for `'faq'`.

### `renderPage(page)` input-object shape (what `index.ts` passes)

```typescript
{
  slug:   string;
  seo?:   { title?: string; description?: string; ogImage?: string;
            canonical?: string; schemaType?: string };
  blocks: BlockNode[];        // from landing_page_revisions.blocks of the
                              // published revision; renderPage filters to
                              // parent_id === null roots and sorts by `order`
}
```

`renderPage` returns a complete `<!doctype html>` document string. Body inlines a minimal reset + the `@media (max-width:767px) .hide-on-mobile{display:none !important}` rule (so D-06 actually takes effect on published pages).

### `renderSeoHead(opts)` signature (the SEO seam 15-08 replaces)

```typescript
export function renderSeoHead(opts: {
  pageTitle: string;
  pageDescription: string;
  canonicalUrl: string;
  ogImage: string;
  jsonLd?: string;
  siteSettings?: {
    site_name?: string;
    default_description?: string;
    favicon_url?: string;
    default_og_image?: string;
  };
}): string;   // returns the <head>-INNER (no opening/closing <head>)
```

**The function name is `renderSeoHead` (NOT `renderHead`).** 15-08 keeps this exact name + signature and REPLACES THE BODY ONLY. The body currently emits:

- `<meta charset="utf-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1">`
- `<title>{escapeHtml(opts.pageTitle)}</title>`
- Geist + Fraunces `<link rel="preload">` font lines

Nothing else — no `<meta name="description">`, no og:*, no `<link rel="canonical">`, no `<script type="application/ld+json">`. Asserted by the `renderSeoHead: stub emits ONLY charset, viewport, title, font preloads` test.

### `config.toml` block as added

```toml
# Phase 15 Plan 03 — page-render is a PUBLIC endpoint for published landing pages.
# Anonymous visitors (and search-engine crawlers) request /{slug}; no JWT, no
# cookie. Without verify_jwt = false the gateway 401s every visitor before the
# function runs (RESEARCH Pitfall 7 / T-15-03-06). The function's own
# `status='published'` SELECT filter is the access-control gate.
[functions.page-render]
verify_jwt = false
```

Appended directly after `[functions.stripe-webhook]`. `git diff supabase/config.toml` shows ONLY additions — stripe-webhook block byte-unchanged.

## Verification Results

| Gate | Result |
|------|--------|
| `cd leanshot && npx vitest run src/lib/page-builder/block-schema.test.ts` | **10/10 pass** |
| `cd leanshot && npx tsc -b --noEmit` | clean |
| `cd supabase/functions/page-render && deno test --allow-all` | **28/28 pass** (19 render + 9 index) |
| `grep -c "^  \| '" leanshot/src/lib/page-builder/block-schema.ts` | 12 (BlockType union literals) |
| `grep -c "case '" supabase/functions/page-render/render.ts` | 10 (≥3 required — hero/cta/footer plus style-helper switches) |
| `grep -c "renderSeoHead" supabase/functions/page-render/render.ts` | 6 (≥2 required) |
| `grep -c "renderHead\b" supabase/functions/page-render/render.ts` | 0 (REQUIRED) |
| `grep -v '^\s*//' supabase/functions/page-render/render.ts \| grep -c '<script'` | 0 (zero JS shipped) |
| `grep -q "verify_jwt = false" supabase/config.toml` under `[functions.page-render]` | yes (1 occurrence of the header; 3 total verify_jwt=false in file) |
| `git diff supabase/config.toml` shows only additions | yes — stripe-webhook block byte-unchanged |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug in test, not in production code] XSS-defuse test asserted absence of `onerror=` substring, but escaped text legitimately contains the literal substring `onerror=`**

- **Found during:** Task 2 first deno-test run (1 failure / 18 pass).
- **Issue:** The test `renderBlock hero: escapeHtml-d content (XSS payload defused)` asserted `!html.includes('onerror=')`. But the correctly-escaped text `&lt;img src=x onerror=alert(1)&gt;` contains the literal substring `onerror=` — that's *text content*, not an attribute. The escape worked; the test was too broad.
- **Fix:** Replaced the over-broad assertion with two narrower assertions: (a) no live `<img` tag survived (structural absence), and (b) the payload appears with `&lt;…&gt;` entity-encoded delimiters (positive confirmation that escape ran).
- **Files modified:** `supabase/functions/page-render/render.test.ts` only (no production-code change).
- **Commit:** Folded into Task 2 commit (`9770c43`).

**2. [Rule 2 — Auto-add missing critical functionality] href safe-list (drop `javascript:` / `data:` / bare-scheme hrefs)**

- **Found during:** Task 2 implementation.
- **Issue:** The plan's `<interfaces>` block requires `ctaHref` and `navLinks[].href` to be "only http(s)/#/relative". The plan also lists this as a behavior test case (`an XSS payload in ctaHref does not produce an executable href`). Without an href safe-list, `escapeHtml` alone is NOT enough — `<a href="javascript:alert(1)">` would still be an executable XSS via attribute context.
- **Fix:** Added a `safeHref(raw)` helper (private to render.ts) that returns the input if it starts with `http://`, `https://`, `#`, or `/` — otherwise returns `'#'`. Callers still pass the result through `escapeHtml` for attribute-context safety. Three tests assert the drop behavior (hero/cta `javascript:`/`data:`).
- **Files modified:** `supabase/functions/page-render/render.ts` (+ matching tests).
- **Commit:** Folded into Task 2 commit (`9770c43`).
- **Threat-model justification:** Directly mitigates `T-15-03-02 (Tampering — stored XSS)` for the `<a href>` attribute context. The plan's `<threat_model>` calls this out as a mitigation; this implementation satisfies it.

**3. [Rule 3 — Auto-fix blocking issue] Absolute-path Edit landed in main repo instead of worktree (#3099)**

- **Found during:** Task 3, while appending the `[functions.page-render]` block to `supabase/config.toml`.
- **Issue:** Used an absolute path that resolved to `/Users/karstenhaldan/minisite/supabase/config.toml` — the **main repo's** copy, not the worktree's. The exact failure mode the worktree path-safety reference warns about (#3099).
- **Fix:** `git checkout -- supabase/config.toml` inside the main repo to revert the unintended edit, then re-applied the same edit inside the worktree using the worktree-rooted absolute path. Verified the diff on main was clean and the worktree's diff is the expected single-block addition.
- **Files modified:** None — recovery only; the final committed change is exactly what was planned.
- **Commit:** None — recovery happened pre-commit.
- **Followup for future agents:** Inside a worktree, always derive absolute paths from `git rev-parse --show-toplevel` run *in the worktree*, not from a previously-captured `pwd`.

### Deferred Items

None — every plan acceptance criterion is satisfied in this commit set.

## Known Stubs

The `renderSeoHead` function ships as a documented STUB by design — it emits only charset / viewport / title / font preloads, and a `// SEO seam — 15-08 replaces this body with the full SEO cascade …` comment marks the seam. Plan 15-08 is responsible for replacing the body (NOT the signature, NOT the function name) with `<meta name="description">`, OG tags, `<link rel="canonical">`, favicon, and the `<script type="application/ld+json">` block — all escaped, all using the per-page → site_settings cascade.

This is **intentional and tracked**: the test `renderSeoHead: stub emits ONLY charset, viewport, title, font preloads` asserts the stub's minimality (no description / og:* / canonical / JSON-LD), so 15-08 has a clean replacement target with regression coverage.

## Threat Surface Scan

No threat surface introduced beyond what's documented in `<threat_model>`:

| Threat | Mitigation in this commit |
|--------|---------------------------|
| T-15-03-01 (info disclosure via unpublished content) | `.eq('status','published')` filter + non-null `published_revision_id` check; tests assert draft/null-revision rows return 404 |
| T-15-03-02 (stored XSS via block content) | `escapeHtml` applied to every content field; href safe-list drops `javascript:`/`data:`; zero `<script>` tags in render.ts (grep gate) |
| T-15-03-04 (info disclosure via error strings) | try/catch with `console.error` + generic 500 body; test asserts `PGRST116-NoRowsFound…` token NOT echoed to client |
| T-15-03-05 (cache poisoning) | Cache-Control public + Vary: Accept-Encoding; CORS `*` with NO credentials |
| T-15-03-06 (verify_jwt default) | `[functions.page-render] verify_jwt = false` set explicitly |

No threat-flag rows to add.

## Cross-Plan Dependencies for Later Phase 15 Plans

- **15-04 (editor save path) MUST:**
  - Import `BlockType`, `BlockNode`, `BlockStyle`, `BlockTree`, `RESERVED_SLUGS`, `isReservedSlug` from `@/lib/page-builder/block-schema` — no redefinition.
  - Enforce `isReservedSlug(slug)` denial at the page-save Edge Function boundary BEFORE inserting a `landing_pages` row.
  - When the slug-denylist needs new entries (e.g. a new admin route), update BOTH `RESERVED_SLUGS` here AND the negative-lookahead in `leanshot/vercel.json` in the SAME commit (the two MUST stay in lockstep).
- **15-05/06/07 (additional block branches) MUST:**
  - ADD their case names to `renderBlock()` in `supabase/functions/page-render/render.ts` (15-05 adds 5 cases, 15-06 adds 3, 15-07 adds 1) without restructuring the switch.
  - Keep the per-block content shape contract aligned with what the editor's PropertyPanel writes.
  - Re-run `deno test --allow-all supabase/functions/page-render/` after each addition.
- **15-08 (SEO cascade) MUST:**
  - Replace the BODY of `renderSeoHead` — keep the function name (`renderSeoHead`, NOT `renderHead`) and the `opts` shape including the optional `siteSettings` field.
  - Update `renderPage` to thread `siteSettings` from the row's join into the `renderSeoHead` opts.
  - The existing `renderSeoHead: stub emits ONLY …` test SHOULD be relaxed/replaced when the cascade lands (it currently asserts the stub minimality and will fail once the body is real — that's the intended regression signal).
- **Orchestrator deploy step (post-15-04):**
  - Run `supabase functions deploy page-render --no-verify-jwt --use-api` once 15-04 lands. The function code is ready; deploy is intentionally deferred from this plan.

## Open Questions / Phase 15 Follow-ups

- **Marketing-host `vercel.json`:** 15-02 already flagged that the LeanShot repo only has `leanshot/vercel.json`. If a separate marketing-host `vercel.json` exists outside the repo, the `/{slug}` rewrite needs to be replicated there too. Surface during Phase 15 close UAT.
- **`deno.lock`:** A new `supabase/functions/page-render/deno.lock` is generated by `deno test`. The project `.gitignore` already covers `supabase/functions/**/deno.lock`, so it is correctly untracked. No action needed.

## Self-Check: PASSED

- [x] Task 1 commit `556df31` exists (`git log --oneline -3` confirms)
- [x] Task 2 commit `9770c43` exists
- [x] Task 3 commit `2317f17` exists
- [x] `leanshot/src/lib/page-builder/block-schema.ts` exists; exports BlockType / BlockNode / BlockStyle / BlockTree / RESERVED_SLUGS / isReservedSlug
- [x] `supabase/functions/page-render/{render.ts,render.test.ts,index.ts,index.test.ts,cors.ts,deno.json}` all exist
- [x] `supabase/config.toml` has the `[functions.page-render]` block with `verify_jwt = false`; stripe-webhook block byte-unchanged
- [x] vitest 10/10 + tsc strict clean + deno test 28/28
- [x] No modification to STATE.md / ROADMAP.md / REQUIREMENTS.md (orchestrator owns those writes)
- [x] No `supabase functions deploy` run — left to orchestrator after 15-04
