# Phase 15: Page Builder + Landing Pages - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

An in-house drag-and-drop landing-page builder. Three subsystems:
1. **Admin editor** — `/admin/pages/*` routes, dnd-kit drag-drop, block tree + property editor + live preview, version history. Ships in a lazy `admin-bundle` chunk public visitors never download.
2. **Renderer** — a small recursive component in a separate Vite entry on the marketing host, served as static HTML via the `page-render` Edge Function + Vercel ISR.
3. **Data** — `landing_pages` + `landing_page_revisions` tables, `page-assets` Storage bucket.

`/pricing` is the first real builder page, wired to live Stripe Checkout price IDs (PAGE-09 / MONEY-08 consumer).

Delivers PAGE-01..09. The 5 templates and the core block set are fixed by ROADMAP; this discussion clarified HOW to implement them.

</domain>

<decisions>
## Implementation Decisions

### Block Palette & Embeds
- **D-01:** All 3 embed providers (Calendly, YouTube, Tally) ship in Phase 15 (v1.2) — NOT deferred to v1.3. (This resolves the ROADMAP-flagged open question.)
- **D-02:** The 3 embeds are **3 separate draggable blocks**, each with a tailored property editor (e.g. YouTube: start-time/autoplay; Calendly: prefill toggle) — not one generic "Embed" block with a provider dropdown.
- **D-03:** **PAGE-03 scope expands: 8 → ~12 block types.** The 8 core (Hero, CTA, FAQ, Pricing, Testimonial, Feature grid, Image+text, Footer) + 3 embed blocks + 1 native form/opt-in block (see D-12). Block-count consequence for the planner: bundle ceiling (`PAGE_BUILDER_RUNTIME_CEILING=25000` gz) and property-editor surface.

### Editor UX
- **D-04:** Editing model is **tree + live preview pane** — left rail = draggable block tree (reorder/nest via dnd-kit), right rail = property editor, center = live preview that embeds the **real `page-render` output** (guaranteed production fidelity). NOT a WYSIWYG in-place canvas.
- **D-05:** Block customization depth is **token-bounded styling** — content fields + a small curated per-block style set drawn from the design system (variant selector, background tone from DS color tokens, alignment, spacing density). NO hex pickers, NO arbitrary CSS, NO typography overrides.
- **D-06:** Responsive model is **auto-responsive + preview viewport toggle** — blocks are responsive by default (design system owns breakpoints); the preview pane has a mobile/tablet/desktop toggle for visibility; plus ONE universal per-block "hide on mobile" toggle. No other per-block responsive props.

### Publish & Versioning
- **D-07:** Draft/publish model is **published-pointer + draft revisions** — `landing_pages` carries a `published_revision_id` pointer; every save appends a `landing_page_revisions` row; "Publish" re-points to the latest revision; "Restore" re-points to an older one. A published page can safely accumulate unpublished draft revisions. Matches PAGE-07's append-only requirement.
- **D-08:** **No shareable draft-preview URL.** The in-editor preview pane is the only preview surface. (A tokenized shareable preview route is a deferred v1.3 idea.)
- **D-09:** Publish freshness is **on-demand revalidation** — Publish/Restore triggers an immediate Vercel on-demand revalidation for the slug's path; the live page updates within seconds (Publish "feels instant"). Not time-based ISR alone.

### Routing & Access
- **D-10:** Published-page URL pattern is **root `/{slug}`** with a **reserved-slug denylist** enforced at save time (must exclude `clinic`, `admin`, `share`, `api`, `auth`, `assets`, and any other app path routes). `/pricing` is a **normal builder page** with slug `pricing` — NOT a hardcoded/special-cased route.
- **D-11:** Admin access is a **thin `is_staff` boolean gate** — a single boolean (e.g. `profiles.is_staff`, or a small allowlist) gates `/admin/pages/*`, all page-mutating Edge Functions, and RLS. The full staff-admin role surface is **Phase 22's job** — Phase 15 does the minimal gate only. NOTE: Phase 9's role system is clinic-tenant-scoped and does NOT apply to LeanShot-staff admin.

### Assets & Media
- **D-12 (note: numbering — this is the lead-capture decision; see also Lead Capture below).**
- **D-13:** Image handling is an **asset library / picker** — a managed media library: upload once, pick from a grid across any page, with listing RLS on the `page-assets` bucket. Required alt-text capture on every image (Lighthouse ≥95 a11y gate). **PAGE-01 scope expands:** `page-assets` bucket now needs a library UI + listing RLS, not just per-use upload. Image optimization (resize/format/CDN transforms) is a research call — depends on the Supabase plan tier.

### Templates
- **D-14:** Template instantiation is a **one-time scaffold** — picking one of the 5 code-defined templates copies its block tree into a new, fully independent page. Template changes in future releases never touch existing pages. No live-link / propagation. Clean revision/restore semantics.

### SEO
- **D-15:** Global SEO defaults live in a **single `site_settings` config row**, edited via a small **`/admin` staff settings panel** (`is_staff`-gated): favicon, default OG/social image, site name, default description. Per-page SEO overrides cascade on top. Serves PAGE-08.
- **D-16:** JSON-LD structured data is **auto-generated + schema-type override dropdown** — the renderer auto-builds JSON-LD from the page's blocks; the SEO panel shows the schema.org type (defaulted from the template, e.g. FAQ template → FAQPage) with a dropdown to override it. NO raw JSON-LD editing.

### Lead Capture
- **D-12:** Landing-page forms use a **native form/opt-in block** that POSTs to a new **`lead-capture` Edge Function** → writes to a new **`leads` table** (RLS, honeypot + rate-limit for spam) → optional Resend notification. Forms are NOT delegated to the Tally embed. This clarifies how the named "lead-magnet opt-in" template (PAGE-04) actually functions end-to-end. **New scope for the planner:** `leads` table migration + `lead-capture` Edge Function + spam guard.

### Analytics
- **D-17:** Published landing pages ship with **NO analytics/tracking in Phase 15** — deferred to Phase 20 (which already owns analytics/ETL infrastructure). Keeps rendered pages maximally lean for the Lighthouse ≥90 perf gate and stays inside PAGE-01..09.

### Claude's Discretion
Left to research + planning (the user explicitly declined to micromanage these — they are implementation HOW, not vision):
- Block-tree JSON schema / data shape for `landing_pages` + `landing_page_revisions`.
- `page-render` Edge Function internals, ISR config specifics, caching headers.
- `sitemap.xml` / `robots.txt` generation mechanics (static vs. dynamic vs. regen-on-publish).
- `leads` table column shape; exact spam-guard mechanism.
- dnd-kit nesting ergonomics; how the `admin-bundle` chunk is split.
- Image optimization approach (Supabase Storage transforms vs. client-side vs. Vercel image opt) — tier-dependent.
- URL slug validation rules beyond the reserved denylist.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — PAGE-01..09 (the 9 requirements this phase delivers). NOTE: D-01/D-03/D-12/D-13 expand PAGE-01 and PAGE-03 scope; planner should treat the decisions above as the authoritative scope.
- `.planning/ROADMAP.md` — Phase 15 detail block: goal, 5 success criteria, the 5 named templates, the 8 core block names, dependency on Phases 13 + 14.

### Design System (the block palette source)
- `.planning/design-system/` — Phase 13 Claude Design bundle v2 (chats + UI kit + tokens). The block palette + token-bounded style options (D-05) draw from here. Per project memory, this bundle serves as the UI-SPEC for design-rollout-adjacent phases.
- `src/index.css` — Tailwind v4 `@theme` tokens (the live design tokens).
- `src/components/ui/*.tsx` — DS primitives (Card 5 variants, Button 6 variants, Pill, Input/Select/Textarea, Modal, Sheet) — the building material for the 12 blocks.

### CI Gates this phase must respect / update
- `tests/csp/csp-snapshot.txt` + `tests/csp/csp-snapshot.test.ts` — the Phase 12 CSP snapshot test. D-01 widens the **rendered-page** CSP `frame-src` for `calendly.com`, `youtube-nocookie.com`, `tally.so` — this snapshot MUST be updated.
- `e2e/clinic-ad-free.spec.ts` — Phase 12 gate; `/admin/*` is a PROTECTED_ROUTE. The builder routes must stay ad-free (they will — no ad code here — but be aware).
- `scripts/assert-clinic-bundle-budget.sh` — declares `PAGE_BUILDER_RUNTIME_CEILING=25000` (gz). The `page-builder-runtime` chunk must land under 25 kB gz; the lazy `admin-bundle` is separate.

### Monetization wiring
- `.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-VERIFICATION.md` — Phase 14 Stripe state. `/pricing` (D-10, PAGE-09) wires to the live Stripe price IDs (`price_0TWu1*` batch — $12.99/mo `VITE_STRIPE_PRICE_PLUS_MONTHLY`, $132.49/yr `_YEARLY`). The Checkout-button block calls the `stripe-checkout` Edge Function (deployed, live).

### Codebase maps
- `.planning/codebase/STRUCTURE.md` — directory layout + "where to add new code" conventions (note: dated 2026-05-10, predates clinic/billing code).
- `.planning/codebase/STACK.md`, `.planning/codebase/INTEGRATIONS.md` — Vite/build setup + Supabase/Vercel integration posture.

### Project rules
- `CLAUDE.md` — stack constraints (React 19 + Vite + TS strict + Tailwind v4 + Zustand; local-first; aggressive code-splitting).
- Supabase Edge Functions live at the **repo root** `supabase/functions/` — NOT under `leanshot/`. `page-render` and `lead-capture` go there.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Design-system v2 primitives** (`src/components/ui/*`) — Card/Button/Pill/Input/Modal/Sheet with their variant sets ARE the block-building material and the source of D-05's token-bounded style options.
- **`React.lazy` + `<Suspense>` pattern in `src/App.tsx`** — every tab/modal is already code-split this way. The `admin-bundle` (editor) must follow the same lazy-load discipline so public visitors never download it.
- **Supabase Edge Function pattern** (`supabase/functions/stripe-webhook`, `stripe-checkout`, `share`, `clinic-invite`, etc.) — `page-render` + `lead-capture` mirror this: per-function `deno.json`, full esm.sh URLs for runtime value imports (NOT bare specifiers — the deploy bundler ignores `import_map.json`), `verify_jwt` config per function (`page-render` is public → `verify_jwt = false`; `lead-capture` is public form POST → `verify_jwt = false` + own spam guard).
- **`stripe-checkout` Edge Function** (deployed, live) — the Pricing block's Checkout button invokes it.

### Established Patterns
- **Hash-route SPA + `vercel.json` path rewrites** — the app uses hash routes; `/clinic`, `/admin`, `/share` are real path routes via `vercel.json` rewrites. Root `/{slug}` published pages (D-10) need their own routing layer on the marketing host, and the reserved-slug denylist must cover every existing path route.
- **RLS-everywhere** — every table + Storage bucket gets RLS; project rule requires a live cross-tenant impersonation proof test for each RLS surface. Applies to `landing_pages`, `landing_page_revisions`, `leads`, and the `page-assets` bucket.
- **Migrations** live at repo-root `supabase/migrations/`; partial-index expressions must be IMMUTABLE; SECURITY DEFINER functions need `extensions` in `search_path`.
- **Bundle-size CI guard** — heavy deps route through deferred-init wrappers; the `admin-bundle` (dnd-kit + editor) must be lazy and must not leak into the index chunk.

### Integration Points
- New tables: `landing_pages`, `landing_page_revisions`, `leads`, plus a `site_settings` config row (D-15).
- New Storage bucket: `page-assets` (with listing RLS for the asset library, D-13).
- New Edge Functions (repo-root `supabase/functions/`): `page-render` (public, ISR-backed), `lead-capture` (public form POST + spam guard).
- New routes: `/admin/pages/*` (editor, `is_staff`-gated, lazy `admin-bundle`), `/admin` settings panel (D-15), root `/{slug}` (renderer on marketing host).
- Vercel: ISR + on-demand revalidation hook wired into the publish action (D-09).
- `is_staff` gate (D-11) — likely a `profiles.is_staff` column or equivalent.

</code_context>

<specifics>
## Specific Ideas

- The live-preview pane (D-04) must embed the **actual `page-render` output**, not a re-implementation — production fidelity is the explicit reason this model was chosen over WYSIWYG.
- The design-system bundle at `.planning/design-system/` is the visual source of truth for all 12 blocks and the 5 templates.
- Publish should *feel* instant (D-09) — this is a stated UX expectation, not just a technical preference.

</specifics>

<deferred>
## Deferred Ideas

- **Shareable draft-preview URL** (tokenized `/preview/{id}?token=` route for showing unpublished drafts to stakeholders) → v1.3. Considered and explicitly deferred in D-08.
- **Landing-page analytics** (PostHog pageview + conversion event instrumentation on published pages) → Phase 20, which already owns analytics/ETL infrastructure. Deferred in D-17.
- **"Save page as template"** (admin-created templates beyond the 5 code-defined ones) — not requested; noted as the natural scope-creep boundary. Future consideration only.
- **A/B testing / multi-variant landing pages** — out of scope; future milestone if ever.

</deferred>

---

*Phase: 15-page-builder-landing-pages*
*Context gathered: 2026-05-14*
