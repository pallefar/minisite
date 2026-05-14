# Phase 15: Page Builder + Landing Pages - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 15-page-builder-landing-pages
**Areas discussed:** Embed blocks, Editing model, Publish workflow, Block depth, URL/slug structure, Admin-access gating, Image-upload UX, Template instantiation, SEO global defaults, Publish freshness, JSON-LD depth, Lead capture, Mobile/responsive editing, Analytics

---

## Embed-provider blocks — v1.2 or v1.3?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer all to v1.3 | 8 core blocks only this phase; embeds a clean v1.3 add | |
| YouTube only in v1.2 | Lowest-CSP-cost single embed | |
| All 3 in v1.2 | Calendly + YouTube + Tally all ship now | ✓ |

**User's choice:** All 3 in v1.2.
**Notes:** Consistent with going hard on conversion-facing surfaces. Consequence flagged: rendered-page CSP `frame-src` widens for 3 origins; Phase 12 CSP snapshot test needs updating.

## Embed block palette shape

| Option | Description | Selected |
|--------|-------------|----------|
| One "Embed" block, provider dropdown | Single block type, provider picked in right-rail | |
| 3 separate blocks | Calendly/YouTube/Tally each its own block with tailored editor | ✓ |

**User's choice:** 3 separate blocks. → PAGE-03 expands 8 → 11 block types.

## Editing model — WYSIWYG vs. tree + preview pane

| Option | Description | Selected |
|--------|-------------|----------|
| Tree + live preview pane | Block tree + property editor + preview embedding real page-render output | ✓ |
| WYSIWYG in-place canvas | Edit the rendered page in-place | |
| You decide | Defer to research+planning | |

**User's choice:** Tree + live preview pane.
**Notes:** Preview must embed the REAL page-render output for production fidelity.

## Publish workflow — draft model

| Option | Description | Selected |
|--------|-------------|----------|
| Published-pointer + draft revisions | `published_revision_id` pointer; saves append; Publish/Restore re-point | ✓ |
| Status flag, save-is-live-when-published | draft/published status; saves on published page go live | |
| You decide | Defer to planning | |

**User's choice:** Published-pointer + draft revisions.

## Publish workflow — shareable draft preview URL?

| Option | Description | Selected |
|--------|-------------|----------|
| No — in-editor preview is enough | No separate draft-preview route | ✓ |
| Yes — shareable draft preview URL | Tokenized preview route for stakeholders | |

**User's choice:** No. → Shareable preview URL deferred to v1.3.

## Block customization depth

| Option | Description | Selected |
|--------|-------------|----------|
| Token-bounded styling — minimal curated set | Content + variant/tone/alignment/density from DS | ✓ |
| Content-only | Looks 100% fixed by design system | |
| Full style panel per block | Color pickers, custom spacing, typography overrides | |

**User's choice:** Token-bounded styling — minimal curated set.

## URL / slug structure

| Option | Description | Selected |
|--------|-------------|----------|
| Root /{slug} + reserved-slug guard | leanshot.app/{slug}; denylist at save time; /pricing is a builder page | ✓ |
| Prefixed /p/{slug} | Namespaced, zero collision risk, uglier URLs | |
| Root /{slug}, /pricing special-cased | Root slugs but /pricing hardcoded | |

**User's choice:** Root /{slug} + reserved-slug guard. /pricing is a normal builder page.

## Admin-access gating

| Option | Description | Selected |
|--------|-------------|----------|
| Thin is_staff gate now, full surface in P22 | Single boolean gates builder routes/Edge Functions/RLS | ✓ |
| Minimal app_admin role that P22 extends | Small staff-scoped role designed for P22 to build on | |
| You decide | Defer to research+planning | |

**User's choice:** Thin is_staff gate now.
**Notes:** Phase 9's role system is clinic-tenant-scoped — does not apply to LeanShot-staff admin.

## Image-upload UX

| Option | Description | Selected |
|--------|-------------|----------|
| Inline drag-drop upload, no library | Drop file on image property; no cross-page reuse | |
| Asset library / picker | Managed media library, upload-once/pick-from-grid, listing RLS | ✓ |
| You decide | Defer to research+planning | |

**User's choice:** Asset library / picker. Required alt-text on every image. → PAGE-01 bucket scope grows.

## Template instantiation model

| Option | Description | Selected |
|--------|-------------|----------|
| One-time scaffold — independent copy | Template copies block tree into a new independent page | ✓ |
| Live link — template edits propagate | Pages stay bound to template | |

**User's choice:** One-time scaffold — independent copy.

## SEO global defaults management

| Option | Description | Selected |
|--------|-------------|----------|
| Staff settings screen + single config row | /admin panel (is_staff-gated) editing a site_settings row | ✓ |
| Config-table row, seeded by migration (no UI) | Defaults editable only via SQL/migration | |
| Code constants in the renderer | Defaults baked in; changing = a deploy | |

**User's choice:** Staff settings screen + single config row.

## Publish freshness / ISR invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand revalidation — ~instant | Publish triggers immediate Vercel revalidation for the slug path | ✓ |
| Time-based ISR — "live within ~a minute" | Fixed revalidation interval | |
| On-demand + long time-based fallback | On-demand plus a long self-heal fallback | |

**User's choice:** On-demand revalidation — ~instant.

## JSON-LD / structured-data depth

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generate + schema-type override dropdown | Auto-built from blocks; dropdown to override the schema.org type | ✓ |
| Fully automatic, type locked to template | Template fully determines schema type, no SEO-panel surface | |
| Auto-generate + raw JSON-LD editable | Raw JSON-LD exposed for hand-editing | |

**User's choice:** Auto-generate + schema-type override dropdown. No raw JSON editing.

## Form / lead-capture handling

| Option | Description | Selected |
|--------|-------------|----------|
| Native form block → leads table + Resend notify | Opt-in/CTA form POSTs to lead-capture Edge Function → leads table | ✓ |
| Delegate all forms to the Tally embed | No native form block; capture via Tally | |
| Native form block, visual-only — capture in v1.3 | Form renders but submission handling deferred | |

**User's choice:** Native form block → leads table + Resend notify.
**Notes:** Clarifies how the named "lead-magnet opt-in" template (PAGE-04) works end-to-end. New scope: `leads` table + `lead-capture` Edge Function + spam guard + a native form/opt-in block.

## Mobile/responsive editing

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-responsive + preview viewport toggle | DS owns breakpoints; preview mobile/tablet/desktop toggle + universal hide-on-mobile | ✓ |
| Auto-responsive + per-block responsive controls | Plus curated per-block responsive prop set | |
| Auto-responsive, no viewport toggle | Fully automatic, desktop-only preview | |

**User's choice:** Auto-responsive + preview viewport toggle.

## Analytics on published pages

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 20 | No tracking in Phase 15; Phase 20 owns analytics | ✓ |
| Basic PostHog pageview + form-submit conversion event | Async PostHog snippet on published pages | |
| Pageviews only, no conversion events | Minimal middle | |

**User's choice:** Defer to Phase 20.
**Notes:** Keeps rendered pages lean for the Lighthouse ≥90 perf gate; stays inside PAGE-01..09.

## Claude's Discretion

The user explicitly declined to micromanage implementation-HOW: block-tree JSON schema, `page-render` Edge Function internals + ISR config, `sitemap.xml`/`robots.txt` generation mechanics, `leads` table column shape + spam-guard mechanism, dnd-kit nesting ergonomics, `admin-bundle` chunk splitting, image optimization approach (Supabase-tier-dependent), slug validation rules beyond the reserved denylist.

## Deferred Ideas

- Shareable draft-preview URL → v1.3 (considered, explicitly deferred).
- Landing-page analytics → Phase 20 (considered, explicitly deferred).
- "Save page as template" (admin-created templates) — noted as the scope-creep boundary; future only.
- A/B testing / multi-variant landing pages — out of scope.
