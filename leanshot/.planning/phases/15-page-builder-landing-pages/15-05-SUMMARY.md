---
phase: 15-page-builder-landing-pages
plan: 05
subsystem: page-builder
tags: [page-builder, edge-function, admin-ui, blocks, preview, accordion, pricing, tdd]

requires:
  - phase: 15-page-builder-landing-pages
    plan: 03
    provides: page-render/render.ts (escapeHtml + safeHref + blockWrapperStyle + hideOnMobileClass + renderBlock switch with default fall-through) — 5 new branches plug in alongside hero/cta/footer
  - phase: 15-page-builder-landing-pages
    plan: 04
    provides: PropertyPanel.tsx switch (Slice-1 establishes the per-block-type field-config pattern), block-style-helpers.ts (backgroundToneClass + paddingForDensity), and the HeroBlock/CTABlock/FooterBlock reference shells

provides:
  - "supabase/functions/page-render/render.ts — 5 new renderBlock branches (faq/pricing/testimonial/feature-grid/image-text) reusing 15-03's escapeHtml/safeHref/blockWrapperStyle helpers; zero <script> tags shipped; 40/40 render tests pass (20 prior + 20 new), 49/49 full deno suite"
  - "leanshot/src/components/admin/pages/blocks/{FAQBlock,PricingBlock,TestimonialBlock,FeatureGridBlock,ImageTextBlock}.tsx — DS-primitive block editor components; token-bounded styling (no raw hex); useReducedMotion-aware FAQ accordion; visual-only Pricing Checkout button"
  - "leanshot/src/components/admin/pages/editor/property-configs.ts — FLAT Record<BlockType, BlockPropertyConfig> registry (kind-bounded fields, no color/hex/typography); future plans (15-06/07/08) add keys without restructuring"
  - "leanshot/src/components/admin/pages/editor/PropertyPanel.tsx — existing hero/cta/footer branches preserved; 5 new types route through GenericContentFields driven by property-configs (additive merge-friendly)"
  - "leanshot/src/components/admin/pages/editor/PreviewPane.tsx — same-origin sandboxed read-only iframe (pointer-events:none) + Monitor/Tablet/Smartphone viewport toggle (aria-pressed, default desktop); Skeleton overlay until iframe onLoad fires"
  - "leanshot/src/components/admin/pages/PageEditorView.tsx — center-panel stub replaced with PreviewPane when slug is present (15-04 cross-plan contract delivered)"

affects: [15-06, 15-07, 15-08]

tech-stack:
  added: []
  patterns:
    - "Grouped switch extension: 5 new renderBlock cases added as a co-located block below 15-03's hero/cta/footer; future plans (15-06 embeds, 15-07 lead-form) extend at the obvious seam"
    - "FLAT property-configs registry — `Partial<Record<BlockType, BlockPropertyConfig>>` keyed by block-type literal. Each plan (05/06/07/08) adds ONE key without touching siblings → painless merges across parallel waves"
    - "GenericContentFields renderer in PropertyPanel — `kind`-driven switch over ContentFieldConfig; new field kinds (e.g. structured row-editors in Slice-2) add one local arm"
    - "FAQ accordion a11y pattern: <button aria-expanded aria-controls> + sibling <div role=region id=...>; CSS-only chevron rotation; useReducedMotion gates the duration class"
    - "Pricing CTA is VISUAL ONLY (D-05 + cross-plan contract) — Button-primary token classes + aria-label, NO Stripe wiring (15-10 owns it)"
    - "Iframe a11y/security posture: title + sandbox='allow-scripts allow-same-origin' (no popups, no top-nav) + pointer-events:none + same-origin hard-constructed src"
    - "Image-omit-on-blank-alt as the a11y gate (Threat T-15-05-02) — the <img> is dropped entirely when alt is blank, in BOTH the Deno renderer and the React editor components"

key-files:
  created:
    - supabase/functions/page-render/render.test.ts  # extended in this plan
    - leanshot/src/components/admin/pages/blocks/FAQBlock.tsx
    - leanshot/src/components/admin/pages/blocks/PricingBlock.tsx
    - leanshot/src/components/admin/pages/blocks/TestimonialBlock.tsx
    - leanshot/src/components/admin/pages/blocks/FeatureGridBlock.tsx
    - leanshot/src/components/admin/pages/blocks/ImageTextBlock.tsx
    - leanshot/src/components/admin/pages/blocks/FAQBlock.test.tsx
    - leanshot/src/components/admin/pages/editor/property-configs.ts
    - leanshot/src/components/admin/pages/editor/PreviewPane.tsx
    - leanshot/src/components/admin/pages/editor/PreviewPane.test.tsx
  modified:
    - supabase/functions/page-render/render.ts
    - supabase/functions/page-render/render.test.ts
    - leanshot/src/components/admin/pages/editor/PropertyPanel.tsx
    - leanshot/src/components/admin/pages/PageEditorView.tsx

key-decisions:
  - "FLAT property-configs registry (vs nested switch-of-switches): chosen for merge-friendliness with 15-06/07/08 — three plans add their block-types' keys without touching each other or this plan's entries"
  - "Existing hero/cta/footer PropertyPanel branches are preserved as-is — only the fallback below the literal switch routes through the registry. This keeps 15-04's tests untouched (zero regression)"
  - "Pricing block CTA is a <button type=button> with aria-label and Button-primary classes — NO onClick handler in this plan. 15-10 will wire the Stripe call; the visual contract is here"
  - "renderImageText drops <img> entirely when imageAlt is blank — mirrors the editor's ImageTextBlock; this is the documented a11y gate (Threat T-15-05-02), tested on both sides of the boundary"
  - "PreviewPane iframe sandbox = 'allow-scripts allow-same-origin' (minimal). Reserved allow-scripts is forward-looking — Phase 15 published pages still ship zero JS per D-17"
  - "PreviewPane src is constructed from prop pageSlug only — never accepts an externally-supplied URL. The component carries an explicit T-15-05-03 mitigation comment"
  - "PageEditorView replaces the Live-preview-stub center panel with PreviewPane when slug is set (an unsaved new draft has no slug → hint card stays). Closes the 15-04 cross-plan stub explicitly"
  - "Repeatable structured content (faq items, pricing plans, testimonial quotes, feature grid items) is edited as JSON-in-Textarea for Slice-1 — a row-editor lands in a later plan (planner consciously deferred; the JSON form is staff-only)"
  - "The 'unimplemented type returns empty string' test in render.test.ts was rewritten to use 'calendly' (15-06's case) — 'faq' is now implemented so it would have failed under the OLD assertion; this is a contract update, not a deletion"
  - "Block-component grids use Tailwind responsive utility classes (sm:grid-cols-2 lg:grid-cols-3) — token-bounded; no raw hex anywhere"

metrics:
  duration: ~32 minutes
  tasks_completed: 3
  completed_date: 2026-05-15

requirements-completed: [PAGE-03, PAGE-06]
---

# Phase 15 Plan 05: 5 New Core Blocks + Live Preview — Summary

**Thicken Phase 15's MVP slice: ship FAQ / Pricing / Testimonial / Feature grid / Image+text — the remaining 5 of the 8 core landing-page blocks — and replace the 15-04 stub center panel with a working `PreviewPane` (sandboxed iframe + desktop/tablet/mobile viewport toggle).**

## One-liner

5 renderBlock branches in `page-render/render.ts` (HTML-escaped, token-styled, zero JS shipped), 5 React block editor components mirroring 15-04's HeroBlock shell (no raw hex, useReducedMotion-aware FAQ accordion, visual-only Pricing Checkout button), a flat `property-configs.ts` registry that 15-06/07/08 can extend without merge friction, and `PreviewPane.tsx` (sandboxed read-only iframe + Monitor/Tablet/Smartphone toggle) that closes 15-04's `Live preview lands in plan 15-05` cross-plan stub.

## Tasks Completed

| # | Name | Commit(s) | Files |
|---|------|-----------|-------|
| 1 | renderBlock branches for faq/pricing/testimonial/feature-grid/image-text (TDD) | `52a79dc` (RED) + `9b1d92c` (GREEN) | `supabase/functions/page-render/render.ts`, `…/render.test.ts` |
| 2 | 5 block editor components + flat property-configs + PropertyPanel wiring (TDD) | `508b033` | `leanshot/src/components/admin/pages/blocks/{FAQ,Pricing,Testimonial,FeatureGrid,ImageText}Block.tsx`, `…/blocks/FAQBlock.test.tsx`, `…/editor/{property-configs.ts,PropertyPanel.tsx}` |
| 3 | PreviewPane (sandboxed iframe + viewport toggle) + PageEditorView wiring (TDD) | `14f29f4` | `…/editor/{PreviewPane.tsx,PreviewPane.test.tsx}`, `…/PageEditorView.tsx` |

## Verification Results

| Gate | Result |
|------|--------|
| `cd supabase/functions/page-render && deno test render.test.ts --allow-all` | **40/40 pass** (20 prior + 20 new — including the 5 cross-block hideOnMobile/backgroundTone invariants) |
| `cd supabase/functions/page-render && deno test --allow-all` (full) | **49/49 pass** (40 render + 9 index) |
| `cd leanshot && npx vitest run src/components/admin/pages/blocks/FAQBlock.test.tsx` | **13/13 pass** |
| `cd leanshot && npx vitest run src/components/admin/pages/editor/PreviewPane.test.tsx` | **5/5 pass** |
| `cd leanshot && npx vitest run` (full suite) | **844 pass / 39 skipped / 0 failed** (75 test files) |
| `cd leanshot && npx tsc -b --noEmit` | clean (strict TS) |
| `cd leanshot && npx eslint src/components/admin/pages` | 0 errors, 0 warnings |
| `cd leanshot && npm run build` | succeeds in 3.15s |
| `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh` | exits 0; `admin-bundle 5.77 kB gz` (ceiling 60 kB); `index 14.56 kB gz` (ceiling 50 kB); `dnd-kit index-leak invariant OK` |
| `grep -c "case '" supabase/functions/page-render/render.ts` | 15 (≥8 required — hero/cta/footer + faq/pricing/testimonial/feature-grid/image-text + helper switches) |
| `grep -v '^\s*//' supabase/functions/page-render/render.ts \| grep -c '<script'` | 0 (zero JS shipped) |

## Per-Branch Visual Contract Highlights

### FAQ — `renderFaq` + `FAQBlock.tsx`

Renderer (Deno): each item becomes `<button aria-expanded="false" aria-controls="faq-{block.id}-{i}">` + sibling `<div role="region" id="faq-{block.id}-{i}">`. CSS-only chevron (`▾`) — no JS in rendered output.

Editor (React): identical aria pattern + `useState`-driven open-index + `useReducedMotion()`-gated chevron-rotation transition. XSS-by-default safe (React text escapes); test asserts `<script>` content renders as visible text, not DOM.

### Pricing — `renderPricing` + `PricingBlock.tsx`

Geist Mono token class on the price element (`block-pricing__price` + `font-family:Geist Mono…` inline style on Deno side; `font-[Geist_Mono…]` Tailwind class on React side). Feature bullets get a lucide `Check` in `--color-success`. Checkout button: `<button type="button" aria-label="{ctaLabel} — {planName}">` with `bg-[var(--color-primary)] text-[var(--color-primary-foreground)]` — VISUAL ONLY. 15-10 wires Stripe. `recommended:true` plans emit `block-pricing__plan--recommended` with the teal-ring marker class (2px primary border + 4px primary-soft halo).

### Testimonial — `renderTestimonial` + `TestimonialBlock.tsx`

Quote: Fraunces italic 22px, line-height 1.4. Author photo `<img>` only emitted when BOTH `authorPhotoUrl` AND non-empty `authorPhotoAlt` are present (a11y gate — Threat T-15-05-02). 48x48 circular photo. authorName always visible.

### Feature grid — `renderFeatureGrid` + `FeatureGridBlock.tsx`

Responsive grid: 3-col on `lg:` (≥1024px), 2-col on `sm:` (≥640px), 1-col on mobile. Each card uses `border + p-6 + rounded-xl` DS pattern. The icon: React side resolves the lucide component by name; Deno side emits a CSS-styled glyph marker (the published page ships zero JS per D-17, so the lucide React component would be the wrong choice for the Deno renderer).

### Image+text — `renderImageText` + `ImageTextBlock.tsx`

2-col grid (stacks to 1-col on mobile). Image-side controlled by `block.style.alignment` (`'left'` default = image-first; `'right'` = text-first; `'center'` falls back to image-first). `<img>` carries explicit `width=600 height=400` to keep CLS=0; omitted entirely when `imageAlt` is blank.

## PreviewPane — D-04 + D-06 delivered

Replaces 15-04's static `Live preview lands in plan 15-05` placeholder card. Same-origin `<iframe>` (`src={`/${pageSlug}?preview=true`}`), `sandbox="allow-scripts allow-same-origin"` (no popups, no top-navigation, no modals), `pointerEvents: 'none'` (read-only). Toolbar: three lucide-icon `Button`s (`Monitor`/`Tablet`/`Smartphone`) with required `aria-label` + `aria-pressed`. Active button uses `tonal` variant, inactive uses `ghost`. Default is desktop. `VIEWPORT_WIDTHS = { desktop: '100%', tablet: '768px', mobile: '375px' }`. DS `Skeleton` overlay until iframe `onLoad` fires (resets on viewport change for the visible reflow affordance).

Threat T-15-05-03 mitigation: the iframe `src` is hard-constructed from the editor's own `pageSlug` state — the component does NOT accept an externally-supplied URL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Auto-fix blocking issue] `node_modules` missing in worktree**

- **Found during:** Task 2 first `npx vitest run` invocation.
- **Issue:** The worktree has no `leanshot/node_modules`; vitest startup error: `Cannot find package 'vitest'`.
- **Fix:** Ran `cd leanshot && npm install --prefer-offline --no-audit --no-fund` (848 packages, 8s). Per memory `feedback_worktree_executor_npm_install_leak`, verified the install did NOT leak into the main repo's `leanshot/package.json` / `leanshot/package-lock.json` (`git status --short leanshot/package.json leanshot/package-lock.json` → clean).
- **Files modified:** None tracked — `leanshot/node_modules/**` is gitignored.
- **Commit:** N/A — environment setup only.

**2. [Rule 2 — Auto-add missing critical functionality] Existing `unimplemented type returns empty string` test required updating**

- **Found during:** Task 1 GREEN-phase run.
- **Issue:** 15-03's `renderBlock: unimplemented type returns empty string` test in `render.test.ts:206-215` asserted that `block.type='faq'` returns `''`. After this plan's GREEN-phase implementation, `'faq'` is now implemented and returns real HTML — the test would have failed as a false-negative.
- **Fix:** Updated the test to use `'calendly'` (15-06's case) instead, preserving the test intent (the default fall-through still returns `''` for not-yet-implemented types) and the contract for 15-06.
- **Files modified:** `supabase/functions/page-render/render.test.ts` (one test only — single-line `'faq'` → `'calendly'` swap + comment update).
- **Commit:** Folded into Task 1 GREEN commit (`9b1d92c`).
- **Threat-model justification:** None — this is a forward contract update aligned with the planned 15-06 scope (3 embed cases).

**3. [Rule 2 — Auto-add missing critical functionality] PageEditorView center panel — close the 15-04 cross-plan stub**

- **Found during:** Task 3 completion.
- **Issue:** 15-04 deliberately shipped a placeholder card with `"Live preview lands in plan 15-05"` copy at `PageEditorView.tsx:249-262`. Without wiring the new `PreviewPane` into the editor, the cross-plan stub would persist and the live-preview surface promised by this plan would not be reachable from `/admin/pages/{id}`.
- **Fix:** Replaced the stub with `<PreviewPane pageSlug={slug} />` when a slug is present; kept a hint card when slug is empty (an unsaved new draft has no slug yet — pointing the iframe at `/?preview=true` would 404 or misbehave). The block-types-list inside the hint card is retained for unsaved drafts so the editor remains informative.
- **Files modified:** `leanshot/src/components/admin/pages/PageEditorView.tsx` (one import + one conditional render).
- **Commit:** Folded into Task 3 commit (`14f29f4`).

**4. [Rule 1 — Bug] Lint errors caught during pre-commit verification**

- **Found during:** Task 3 pre-commit `eslint src/components/admin/pages` invocation.
- **Issue:** Three eslint violations introduced by the new test files: two `import-x/order` errors in `FAQBlock.test.tsx` and one `@typescript-eslint/consistent-type-imports` error in `PropertyPanel.tsx` (an `import('./property-configs').ContentFieldConfig` inline type annotation needs to be a named type import).
- **Fix:** Reordered imports in `FAQBlock.test.tsx` (auto-fixed via `eslint --fix`) and replaced the inline `import()` type annotation with a top-level `import { type ContentFieldConfig }` in `PropertyPanel.tsx`.
- **Files modified:** `FAQBlock.test.tsx`, `PropertyPanel.tsx`.
- **Commit:** Folded into Task 3 commit (`14f29f4`).

### Deferred Items

None — every plan acceptance criterion is satisfied in this commit set.

## Known Stubs

| Surface | File | Reason |
|---------|------|--------|
| Pricing block Checkout button — no click handler | `PricingBlock.tsx`, `render.ts` (renderPricing) | Cross-plan contract — 15-10 wires Stripe (intentional, tracked). Visual-only Button-primary with aria-label is the deliverable here |
| Repeatable structured content (faq items / pricing plans / testimonial quotes / feature grid items) edited as JSON-in-Textarea | `property-configs.ts` (`*-items` / `*-plans` / `*-quotes` field kinds), `PropertyPanel.tsx` (RepeatableJsonField) | Slice-1 staff UX — a structured row-editor lands in a later plan. The JSON view keeps the editor usable for the (currently small) set of staff users and is gated behind the `is_staff` flag |
| FeatureGridBlock icon resolution | `FeatureGridBlock.tsx` | Looks up the lucide React component by name via `Icons[name]`. This may pull more of `lucide-react` into the admin chunk than strictly needed; verified that the admin-bundle and index ceilings are still green (5.77 kB / 14.56 kB gz). A static icon-name allowlist optimization is left for a future plan if the admin bundle approaches its ceiling |

None of these stubs prevent the plan's goal — they are the documented boundaries between this plan, 15-10 (Stripe wiring), and Slice-2 (richer property editing).

## Cross-Plan Dependencies for Later Phase 15 Plans

- **15-06 (embeds — calendly / youtube / tally) MUST:**
  - ADD three new `case` names to `renderBlock()` in `supabase/functions/page-render/render.ts` directly below this plan's 5 new cases (or in their own grouped block — same seam). Do NOT restructure the switch.
  - ADD three keys (`calendly`, `youtube`, `tally`) to `PROPERTY_CONFIGS` in `property-configs.ts`. Since the registry is FLAT, this is an additive merge with zero collision risk vs. this plan's 5 keys.
  - For the property-panel UI: if `kind: 'text'` / `'textarea'` / `'image-url+alt'` suffice (e.g. one URL + one boolean per embed), reuse the existing GenericContentFields renderer. If a new structured kind is needed, add ONE local switch arm to `GenericContentFields` in `PropertyPanel.tsx`.
- **15-07 (lead-form) MUST:**
  - Same pattern as 15-06 — one new renderBlock case + one new `PROPERTY_CONFIGS['lead-form']` entry + (if needed) one new kind arm in GenericContentFields.
- **15-08 (SEO cascade) MUST:**
  - Continue to replace the BODY of `renderSeoHead` only — this plan did not touch the SEO seam.
- **15-10 (Stripe Checkout wiring):**
  - Replace the visual-only PricingBlock CTA with a real Checkout button — likely by either threading an `onCheckout` prop down to PricingBlock from PageEditorView OR moving the click handler into a new client-side wrapper. The current `data-stripe`-less assertion in the FAQBlock.test.tsx Pricing test will need to be reconciled with the new wiring (the test was deliberately written as a negative-assertion to flag this future change).

## Threat Surface Scan

All threat-register items (T-15-05-01 through T-15-05-05) ship mitigated as documented in the plan:

| Threat | Mitigation in this commit |
|--------|---------------------------|
| T-15-05-01 (Tampering — XSS via block content) | Every interpolation in the 5 new renderBlock branches routes through 15-03's `escapeHtml`; FAQ q with `<script>` payload renders inert; tests assert the structural absence of `<script>` and the presence of `&lt;script&gt;` |
| T-15-05-02 (Tampering — image-text / testimonial `<img>` attribute injection) | `imageUrl` / `authorPhotoUrl` routed through `safeHref` + `escapeHtml`; `<img>` is OMITTED ENTIRELY when alt is blank — tested on both the Deno renderer AND the React editor components |
| T-15-05-03 (EoP — PreviewPane iframe) | `sandbox='allow-scripts allow-same-origin'` only (no popups, no top-nav); `pointer-events: none`; `src` hard-constructed from prop `pageSlug` — never accepts external URL; explicit T-15-05-03 mitigation comment in PreviewPane.tsx |
| T-15-05-04 (Info disclosure — Pricing Checkout) | Accept — visual-only here; no Stripe call, no price ID, no secrets cross this plan's surface |
| T-15-05-05 (Spoofing — FAQ accordion / rendered interactive elements) | Accept — published page is JS-free (D-17); no client-side auth or state on the rendered surface |

No threat-flag rows to add — no new surface beyond the documented register.

## Performance

- **Duration:** ~32 minutes (Task 1: ~10 min — Deno TDD round-trip with 20 new tests; Task 2: ~14 min — 5 React block components + flat registry + PropertyPanel routing + 13 tests; Task 3: ~8 min — PreviewPane TDD + PageEditorView wiring + lint cleanup)
- **Tasks:** 3/3
- **Files created:** 9 (+ 4 modified)

## Self-Check: PASSED

- [x] Task 1 RED commit `52a79dc` exists; Task 1 GREEN commit `9b1d92c` exists
- [x] Task 2 commit `508b033` exists
- [x] Task 3 commit `14f29f4` exists
- [x] `supabase/functions/page-render/render.ts` has 5 new `case` branches for faq / pricing / testimonial / feature-grid / image-text — verified by grep
- [x] `leanshot/src/components/admin/pages/blocks/{FAQ,Pricing,Testimonial,FeatureGrid,ImageText}Block.tsx` all exist
- [x] `leanshot/src/components/admin/pages/editor/property-configs.ts` exports `PROPERTY_CONFIGS` with all 5 keys
- [x] `leanshot/src/components/admin/pages/editor/PreviewPane.tsx` exists with sandboxed read-only iframe + viewport toggle
- [x] `leanshot/src/components/admin/pages/editor/PreviewPane.test.tsx` + `…/blocks/FAQBlock.test.tsx` exist
- [x] All deno test (49/49) + vitest (844/883) + tsc strict + lint + build + bundle-budget gates green
- [x] No modification to STATE.md / ROADMAP.md / REQUIREMENTS.md (orchestrator owns those writes)
- [x] No `supabase functions deploy` run — left to orchestrator
- [x] FAQ accordion in rendered output carries `aria-expanded` on triggers and `role="region"` on panels (verified by tests in BOTH renderer and editor)
- [x] Pricing block renders Geist-Mono price + Button-primary Checkout button styling, visual-only (verified by tests in BOTH renderer and editor)
- [x] PreviewPane embeds real `page-render` output via sandboxed read-only same-origin iframe with viewport toggle (`aria-pressed`)
- [x] Edits to `render.ts` confined to 5 new branches; `PropertyPanel.tsx` edit confined to the registry-fallback addition + ContentFields generic renderer; `PageEditorView.tsx` edit confined to the PreviewPane swap-in (no cross-plan contamination)
