# Phase 15: Page Builder + Landing Pages - Research

**Researched:** 2026-05-14
**Domain:** Drag-and-drop page builder, Supabase Edge Function ISR rendering, block-tree JSON schema, SEO automation, lead capture, Vercel Cache-Control
**Confidence:** HIGH (dnd-kit, Supabase, Vercel docs) / MEDIUM (ISR mechanics for non-Next.js) / LOW (image optimization tier dependency)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** All 3 embed providers (Calendly, YouTube, Tally) ship in Phase 15 (NOT deferred).
- **D-02:** 3 embeds are 3 separate draggable blocks with tailored property editors.
- **D-03:** PAGE-03 scope expands: 8 → ~12 block types (8 core + 3 embed + 1 native form/opt-in).
- **D-04:** Editing model is tree + live preview pane (left rail = block tree, right rail = property editor, center = live preview embedding real `page-render` output).
- **D-05:** Block customization is token-bounded styling only — content fields + curated style set from DS tokens. NO hex pickers, NO arbitrary CSS, NO typography overrides.
- **D-06:** Responsive model is auto-responsive + preview viewport toggle + ONE universal "hide on mobile" toggle per block. No other per-block responsive props.
- **D-07:** Draft/publish model is published-pointer + draft revisions: `landing_pages.published_revision_id` pointer; every save appends a `landing_page_revisions` row.
- **D-08:** No shareable draft-preview URL (deferred to v1.3).
- **D-09:** Publish freshness is on-demand revalidation — Publish/Restore triggers immediate Vercel cache bypass; live page updates within seconds.
- **D-10:** Published-page URL pattern is root `/{slug}` with reserved-slug denylist. `/pricing` is a normal builder page with slug `pricing`.
- **D-11:** Admin access is a thin `is_staff` boolean gate on `profiles.is_staff` (or equivalent) — gates `/admin/pages/*`, all page-mutating Edge Functions, and RLS. Full staff-admin surface is Phase 22's job.
- **D-12:** Landing-page forms use a native form/opt-in block → `lead-capture` Edge Function → `leads` table (RLS, honeypot + rate-limit) → optional Resend notification. NOT Tally.
- **D-13:** Image handling is an asset library/picker — upload once, pick from a grid. Required alt-text. `page-assets` bucket with listing RLS.
- **D-14:** Template instantiation is a one-time scaffold (copy block tree; no live link to template).
- **D-15:** Global SEO defaults in a single `site_settings` config row. `/admin` staff settings panel.
- **D-16:** JSON-LD auto-generated + schema-type override dropdown. No raw JSON-LD editing.
- **D-17:** No analytics/tracking on published pages in Phase 15 (deferred to Phase 20).

### Claude's Discretion
- Block-tree JSON schema / data shape for `landing_pages` + `landing_page_revisions`.
- `page-render` Edge Function internals, ISR config specifics, caching headers.
- `sitemap.xml` / `robots.txt` generation mechanics (static vs. dynamic vs. regen-on-publish).
- `leads` table column shape; exact spam-guard mechanism.
- dnd-kit nesting ergonomics; how the `admin-bundle` chunk is split.
- Image optimization approach (Supabase Storage transforms vs. client-side vs. Vercel image opt) — tier-dependent.
- URL slug validation rules beyond the reserved denylist.

### Deferred Ideas (OUT OF SCOPE)
- Shareable draft-preview URL (`/preview/{id}?token=`) → v1.3.
- Landing-page analytics (PostHog) → Phase 20.
- "Save page as template" (admin-created templates beyond 5 code-defined ones) → future.
- A/B testing / multi-variant landing pages → out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAGE-01 | `landing_pages` + `landing_page_revisions` tables + `page-assets` Storage bucket with CDN-served images | Schema design + RLS patterns from existing codebase |
| PAGE-02 | Admin builds pages via dnd-kit drag-and-drop editor (lazy `admin-bundle` chunk) | dnd-kit v6 API + React.lazy code-split pattern |
| PAGE-03 | 12 semantic block components (~8 core + 3 embeds + 1 form) with property editors | Block-tree schema + token-bounded style props |
| PAGE-04 | 5 high-converting templates as starters (one-time scaffold copy) | Template data structure + scaffold pattern |
| PAGE-05 | Per-page SEO: title/description/OG tags/canonical/JSON-LD with schema.org type override | SEO field schema + JSON-LD auto-generation pattern |
| PAGE-06 | Static HTML via `page-render` Edge Function + Vercel ISR (Lighthouse ≥90/≥95 a11y) | Edge Function caching headers + ISR bypass token |
| PAGE-07 | Version history + restore any prior revision (append-only revisions) | published-pointer DB schema |
| PAGE-08 | Auto-generated `sitemap.xml` + `robots.txt` + global SEO defaults | Regen-on-publish sitemap approach |
| PAGE-09 | `/pricing` page wired to Stripe Checkout via live price IDs + Checkout-button block | Existing stripe-checkout Edge Function integration |
</phase_requirements>

---

## Summary

Phase 15 is a three-subsystem phase: (1) an in-browser dnd-kit drag-and-drop editor that lives entirely in a lazy `admin-bundle` chunk, (2) a tiny recursive renderer that produces public-facing static HTML via the `page-render` Supabase Edge Function with Vercel CDN caching, and (3) Supabase Postgres tables + Storage for page data + media assets. The editor and renderer deliberately share NOTHING at runtime — the renderer must work without React or any editor code.

The key architectural tension is the ISR / cache-freshness model (D-09). Because LeanShot uses Vite SPA (not Next.js), true Vercel ISR — with durable ISR cache, 300ms global purge, and request collapsing — is NOT available. The practical approach is a Supabase Edge Function at `page-render` that responds with `Cache-Control: public, s-maxage=60, stale-while-revalidate=86400` plus a secret `x-prerender-revalidate` bypass header that the publish action sends to force an immediate CDN cache flush for the specific slug. This gives "instant publish feel" (CDN sees the bypass, generates a fresh response, caches it) without requiring a framework migration.

dnd-kit has two distinct API generations. The stable production API is `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` (npm `latest`). The new `@dnd-kit/react@0.4.0` API has a beta at `0.5.0-beta-*` and is still stabilizing. For a production phase in May 2026, **use `@dnd-kit/core` + `@dnd-kit/sortable`** (the legacy-but-stable API). The block tree in the editor is a flat array with `parent_id` references — dnd-kit renders this as a visual tree using `useSortable` from `@dnd-kit/sortable` with `collisionPriority` for nested droppable disambiguation.

Supabase Storage image transforms (resize, WebP) are **Pro-plan only and NOT available on the free tier** (project `ytnsipxxmzgaebkqmokp` current plan unknown — see Environment Availability). The fallback for free-tier is: accept any uploaded image format, serve the raw URL from the `page-assets` bucket, and rely on browser native responsive image behavior. Vercel image optimization is also framework-tied (Next.js). Client-side browser Canvas resizing is too slow for upload-time quality. **Recommendation:** validate plan tier at Wave 0; if free, serve raw URLs with sensible max-width CSS; if Pro, use Supabase transform URLs at `?width=1200&resize=contain`.

**Primary recommendation:** Build the editor as a lazy `admin-bundle` chunk using `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`; render published pages as static HTML from a Supabase Edge Function with `Cache-Control` + `x-prerender-revalidate` bypass for "instant publish"; store block trees as JSONB in Postgres with append-only revisions; serve `sitemap.xml` dynamically from a separate Edge Function that regenerates on every publish.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin editor (drag-drop, property editor, version history) | Browser / Client (SPA) | — | Editor is a lazy `admin-bundle` that loads only for `is_staff` users. No SSR needed — admin-only, not SEO-sensitive |
| Live preview pane (D-04) | Browser iFrame → API / Backend | — | Preview embeds real `page-render` output in an iframe or sandboxed div; browser calls Edge Function; editor is the client |
| Published page rendering | API / Backend (Edge Function) | CDN / Static | `page-render` Edge Function generates HTML; Vercel CDN caches it. Visitors never load React |
| Block tree + page data | Database / Storage | API / Backend | Postgres `landing_pages` + `landing_page_revisions` JSONB; `page-assets` Storage bucket |
| SEO metadata injection | API / Backend (Edge Function) | — | `page-render` injects `<title>`, `<meta>`, OG, canonical, JSON-LD into rendered HTML |
| Sitemap / robots.txt | API / Backend (Edge Function) | — | Dynamically generated from DB on request; regen after publish ensures freshness |
| Lead capture (form POST) | API / Backend (Edge Function) | Database / Storage | `lead-capture` Edge Function validates → writes `leads` table → Resend notification |
| Asset library | Database / Storage | Browser / Client | `page-assets` Supabase Storage bucket; listing RLS; image uploads from editor UI |
| `is_staff` access gate | API / Backend | Browser / Client | RLS on mutating tables; client-side route guard for `/admin/pages/*` lazy chunk |
| CSP (frame-src expansion) | CDN / Static | — | `vercel.json` headers update; rendered page needs Calendly/YouTube/Tally in `frame-src` |
| Stripe Checkout wiring (`/pricing`) | API / Backend (Edge Function) | Browser / Client | Checkout-button block calls existing `stripe-checkout` Edge Function; no new backend needed |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | 6.3.1 | DnD context, sensors, collision detection | npm `latest`; stable production API; React 19 compatible [VERIFIED: npm registry] |
| `@dnd-kit/sortable` | 10.0.0 | `useSortable` hook for reorderable tree items | Paired with core; `latest` on npm [VERIFIED: npm registry] |
| `@dnd-kit/utilities` | 3.2.2 | CSS transform utilities (`CSS.Transform`) | Required companion; `latest` on npm [VERIFIED: npm registry] |

> `@dnd-kit/react` (0.4.0) is the NEW v6 API (new `DragDropProvider`, `@dnd-kit/react/sortable`). It has a `0.5.0-beta-*` actively in flight as of 2026-05-12 [VERIFIED: npm registry dist-tags]. It is NOT production-stable yet. Use `@dnd-kit/core` + `@dnd-kit/sortable` (the stable "legacy" API).

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jspdf` (already installed) | existing | PDF export (already in project) | NOT needed for Phase 15; already dynamic-imported |
| `resend` (via Supabase Function secret) | — | Lead notification email | Only in `lead-capture` Edge Function; use esm.sh full URL per project pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit/core` v5 stable | `@dnd-kit/react` v0.4.0 | New API is cleaner but not production-stable; dndkit.com docs now default to the new API — verify migration path if upgrading later |
| Custom sitemap Edge Function | Regenerated static file on publish | Dynamic Edge Function is simpler (no S3/Storage write needed; Vercel CDN caches it); static file approach adds complexity with cache invalidation |
| Raw Postgres JSON | JSONB with GIN index | JSONB allows `@> '{"type":"Hero"}'` queries for future analytics; no performance cost on typical page sizes |

**Installation:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Version verification (confirmed 2026-05-14):**
- `@dnd-kit/core` → 6.3.1 [VERIFIED: npm registry]
- `@dnd-kit/sortable` → 10.0.0 [VERIFIED: npm registry]
- `@dnd-kit/utilities` → 3.2.2 [VERIFIED: npm registry]
- `@dnd-kit/react` → 0.4.0 (latest), 0.5.0-beta-* (beta) — DO NOT USE in Phase 15

---

## Architecture Patterns

### System Architecture Diagram

```
Admin browser (is_staff user)
       │
       ├─── /admin/pages/*  (lazy admin-bundle chunk)
       │        │
       │        ├── BlockTreeEditor (dnd-kit/core + sortable)
       │        │     drag ↔ reorder ↔ nest blocks
       │        │
       │        ├── PropertyEditor (right rail)
       │        │     token-bounded style fields
       │        │
       │        └── PreviewPane (center)
       │              └──[iframe/div]──→ GET /{slug}?preview=true
       │                                       │
       │                                       ▼
       │                          page-render Edge Function
       │                          (reads landing_page_revisions)
       │
       ├─── Save action  ──→  POST /functions/v1/page-save
       │                           │
       │                           └── INSERT landing_page_revisions
       │                               (append-only JSONB block tree)
       │
       └─── Publish action ──→ POST /functions/v1/page-publish
                                    │
                                    ├── UPDATE landing_pages.published_revision_id
                                    │
                                    └── GET /{slug} with header
                                        x-prerender-revalidate: {BYPASS_TOKEN}
                                        → forces Vercel CDN to flush + re-fetch

Public visitor
       │
       └─── GET /{slug}
                │
                ▼ (CDN hit)
           Vercel CDN  ──→  page-render Edge Function (on miss)
                                    │
                                    ├── SELECT published revision JSONB
                                    │   from landing_pages + landing_page_revisions
                                    │
                                    ├── Render blocks → HTML string
                                    │   (recursive renderBlock() in Deno)
                                    │
                                    ├── Inject SEO head
                                    │   (<title>, <meta>, OG, canonical, JSON-LD)
                                    │
                                    └── Response headers:
                                        Cache-Control: public, s-maxage=60, stale-while-revalidate=86400
                                        x-prerender-revalidate-if-generated: {BYPASS_TOKEN}

Search engines
       └─── GET /sitemap.xml  ──→  sitemap Edge Function
                                        │
                                        └── SELECT slug, updated_at WHERE published=true
                                            → generate XML → serve with Cache-Control: 86400
```

### Recommended Project Structure
```
src/
├── components/
│   ├── admin/
│   │   └── pages/              # admin-bundle chunk (lazy)
│   │       ├── PageListView.tsx        # /admin/pages — list all pages
│   │       ├── PageEditorView.tsx      # /admin/pages/:id — editor root
│   │       ├── editor/
│   │       │   ├── BlockTreePanel.tsx  # left rail: sortable block tree
│   │       │   ├── PropertyPanel.tsx   # right rail: block property editor
│   │       │   ├── PreviewPane.tsx     # center: live preview iframe
│   │       │   └── VersionHistory.tsx  # version list + restore
│   │       └── blocks/
│   │           ├── HeroBlock.tsx
│   │           ├── CTABlock.tsx
│   │           ├── FAQBlock.tsx
│   │           ├── PricingBlock.tsx    # wires to stripe-checkout
│   │           ├── TestimonialBlock.tsx
│   │           ├── FeatureGridBlock.tsx
│   │           ├── ImageTextBlock.tsx
│   │           ├── FooterBlock.tsx
│   │           ├── CalendlyBlock.tsx   # D-02
│   │           ├── YouTubeBlock.tsx    # D-02
│   │           ├── TallyBlock.tsx      # D-02
│   │           └── LeadFormBlock.tsx   # D-12 native form
│   └── ui/
│       └── (existing DS primitives — used inside blocks)
├── lib/
│   └── page-builder/
│       ├── block-schema.ts     # BlockNode type definitions + RESERVED_SLUGS
│       ├── templates.ts        # 5 template definitions (block tree arrays)
│       └── json-ld.ts          # auto-generate JSON-LD from page data

supabase/functions/
├── page-render/                # public; verify_jwt=false
│   ├── deno.json
│   ├── index.ts
│   └── render.ts               # renderBlock() recursive HTML function
├── page-save/                  # is_staff gated; verify_jwt=true
│   ├── deno.json
│   └── index.ts
├── page-publish/               # is_staff gated; verify_jwt=true
│   ├── deno.json
│   └── index.ts
├── lead-capture/               # public form POST; verify_jwt=false
│   ├── deno.json
│   └── index.ts
└── sitemap/                    # public; verify_jwt=false
    ├── deno.json
    └── index.ts

supabase/migrations/
├── YYYYMMDDNNNN_page_builder_tables.sql
└── YYYYMMDDNNNN_page_builder_rls.sql
```

### Pattern 1: Block-Tree JSON Schema (Claude's Discretion — Recommended)

**What:** A flat array of `BlockNode` objects stored in JSONB. Each node has a unique `id`, a `type` discriminant, a `parent_id` reference (null = root-level), an `order` integer for sibling ordering, `content` (type-specific data fields), and `style` (token-bounded style options). The flat-with-parent_id shape avoids recursive Postgres queries while still expressing nesting.

**Why flat over nested JSONB object:** Easier to reorder (update `order` values), easier for dnd-kit drag-over events (find node by `id`), no recursive JSONB path manipulation.

**Schema (TypeScript):**
```typescript
// Source: Claude's Discretion — recommended pattern based on block-editor conventions

type BlockType =
  | 'hero' | 'cta' | 'faq' | 'pricing' | 'testimonial'
  | 'feature-grid' | 'image-text' | 'footer'
  | 'calendly' | 'youtube' | 'tally' | 'lead-form';

interface BlockStyle {
  backgroundTone?: 'default' | 'subtle' | 'brand' | 'dark';
  alignment?: 'left' | 'center' | 'right';
  spacingDensity?: 'compact' | 'default' | 'spacious';
  hideOnMobile?: boolean;
}

interface BlockNode {
  id: string;           // nanoid(8) — stable within revision
  type: BlockType;
  parent_id: string | null;  // null = root level
  order: number;             // integer; sibling sort key
  content: Record<string, unknown>;  // type-specific: headline, body, items[], etc.
  style: BlockStyle;
}

type BlockTree = BlockNode[];
```

**Database Tables (PostgreSQL / recommended migration):**
```sql
-- Source: [ASSUMED] — pattern from existing project migration conventions

CREATE TABLE public.landing_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  status           text NOT NULL DEFAULT 'draft'  -- 'draft' | 'published'
    CHECK (status IN ('draft', 'published')),
  published_revision_id  uuid,                    -- FK to landing_page_revisions (nullable)
  seo_title        text,
  seo_description  text,
  seo_og_image     text,
  seo_canonical    text,
  seo_schema_type  text DEFAULT 'WebPage',        -- JSON-LD @type override
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.landing_page_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid NOT NULL REFERENCES public.landing_pages(id) ON DELETE CASCADE,
  block_tree       jsonb NOT NULL,                -- BlockNode[] array
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
  -- NEVER updated — append-only per D-07
);

-- Forward FK from landing_pages to landing_page_revisions
ALTER TABLE public.landing_pages
  ADD CONSTRAINT fk_published_revision
  FOREIGN KEY (published_revision_id)
  REFERENCES public.landing_page_revisions(id)
  ON DELETE SET NULL;           -- publishing a page, then deleting the revision → unpublishes

CREATE TABLE public.leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL,
  email            text NOT NULL,
  name             text,
  extra_fields     jsonb,                         -- future-proof custom form fields
  ip_hash          text,                          -- SHA-256 of client IP; not PII
  honeypot_flagged boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.site_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name        text NOT NULL DEFAULT 'LeanShot',
  default_description text,
  favicon_url      text,
  default_og_image text,
  updated_at       timestamptz NOT NULL DEFAULT now()
  -- single-row config; enforce via application layer (SELECT LIMIT 1)
);
```

### Pattern 2: dnd-kit Sortable Block Tree (Claude's Discretion — Recommended)

**What:** Use `@dnd-kit/core` + `@dnd-kit/sortable`. The `BlockTreePanel` renders a flat list of `BlockNode` items from the JSONB tree. Each node is a `useSortable` item. Nesting is visual only (indent based on `parent_id`); the drag-over logic updates `parent_id` and `order` in component state, then writes to the server on save.

**Collision priority:** Parent container nodes get `collisionPriority: 1`; child nodes get `collisionPriority: 2`. This matches the dnd-kit docs pattern for nested droppable disambiguation. [CITED: dndkit.com/concepts/droppable]

**When to use:** Use `DndContext` from `@dnd-kit/core` with `SortableContext` from `@dnd-kit/sortable`. The `useSortable` hook from `@dnd-kit/sortable` (not from `@dnd-kit/react/sortable`) is the stable API.

**Key import pattern (confirmed stable API):**
```typescript
// Source: [VERIFIED: dndkit.com/react/guides/migration + npm registry]
// Use the LEGACY stable API — @dnd-kit/core@6.3.1 + @dnd-kit/sortable@10.0.0
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// NOT from '@dnd-kit/react' (that's the new unstable API)
```

**Important:** `@dnd-kit/sortable@10.0.0` (stable "legacy" API) works with `@dnd-kit/core@6.3.1`. Do NOT mix old `@dnd-kit/sortable` with the new `@dnd-kit/react@0.4.0` API.

### Pattern 3: Admin-Bundle Chunk Split (Claude's Discretion — Recommended)

**What:** The editor loads via `React.lazy` in `App.tsx`, exactly as clinic, share, and legal chunks. A new `'admin'` view branch in `selectView()` catches `/admin/pages/*` and `/admin` (settings panel).

**Code-split pattern (mirroring existing clinic pattern):**
```typescript
// In src/App.tsx — add to lazy imports
const AdminPagesRoot = lazy(() =>
  import('@/components/admin/pages/PageEditorView').then((m) => ({
    default: m.PageEditorView,
  })),
);
```

**In `vite.config.ts` — add manualChunks rule before the `node_modules` block:**
```typescript
if (id.includes('src/components/admin/')) return 'admin-bundle';
if (id.includes('@dnd-kit/')) return 'page-builder-runtime';
```

Two chunks: `admin-bundle` (editor UI components) + `page-builder-runtime` (dnd-kit libraries). The `page-builder-runtime` chunk is what `scripts/assert-clinic-bundle-budget.sh` measures against `PAGE_BUILDER_RUNTIME_CEILING=25000`. [VERIFIED: leanshot/scripts/assert-clinic-bundle-budget.sh]

**Bundle math:** `@dnd-kit/core@6.3.1` ≈ 12 kB gz + `@dnd-kit/sortable@10.0.0` ≈ 6 kB gz = ~18 kB gz baseline. Plus recursive renderer (D-04 says renderer is tiny) ≈ 3-5 kB gz. Total estimate ≈ 21-23 kB gz — should fit under the 25 kB ceiling. [ASSUMED — based on common sizes, not measured in this session]

### Pattern 4: page-render Edge Function + Cache Headers (Claude's Discretion — Recommended)

**What:** A Supabase Edge Function at `supabase/functions/page-render/index.ts` that:
1. Reads the `slug` from the request URL path (`/{slug}`)
2. Queries `landing_pages JOIN landing_page_revisions` (via `published_revision_id`)
3. Calls `renderBlock()` recursively on each `BlockNode` in the `block_tree` JSONB array
4. Injects SEO head (title, description, OG, canonical, JSON-LD) from page + `site_settings`
5. Returns a full HTML document with `Cache-Control` headers

**Vercel cache freshness (D-09) — CRITICAL FINDING:**

True Vercel ISR (durable ISR cache, 300ms global purge, `revalidate` / `revalidateTag`) is a **Next.js / SvelteKit / Nuxt / Astro framework feature** — NOT available for a custom Supabase Edge Function. [VERIFIED: vercel.com/docs/incremental-static-regeneration]

The practical equivalent for a non-framework origin is:
1. **Response headers from `page-render`:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=86400` — CDN serves stale for up to 24h, revalidates in the background every 60s.
2. **On-demand bypass (makes publish "feel instant"):** The publish action sends a HEAD request to the live URL with header `x-prerender-revalidate: {VERCEL_BYPASS_TOKEN}` — Vercel treats this as a bypass, generates a fresh response, and caches it immediately. This is the `x-prerender-revalidate` mechanism documented for SvelteKit + Nuxt and confirmed to work for custom backends via the `__prerender_bypass` cookie mechanism. [MEDIUM confidence — CITED: vercel.com/docs/incremental-static-regeneration/quickstart; community.vercel.com/t/x-prerender-revalidate-for-all-urls/11906]

**`VERCEL_BYPASS_TOKEN`** must be set as a Vercel env var and as a Supabase Function secret so `page-publish` can include it in the revalidation request.

**Page-render internals (recommended):**
```typescript
// supabase/functions/page-render/index.ts
// verify_jwt = false (public endpoint — page render is unauthenticated)
// Must be in supabase/config.toml: [functions.page-render] verify_jwt = false

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  // Route: /functions/v1/page-render/{slug}
  // OR served at /{slug} via vercel.json rewrite to this function
  const slug = extractSlug(url.pathname);
  if (!slug) return new Response('Not found', { status: 404 });

  const admin = getAdmin(); // lazy singleton
  const { data: page } = await admin
    .from('landing_pages')
    .select(`*, landing_page_revisions!published_revision_id(block_tree)`)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (!page) return new Response('Not found', { status: 404 });

  const html = renderPage(page);  // see render.ts

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400',
    },
  });
});
```

**Routing in `vercel.json`:** Add a rewrite BEFORE the existing SPA rewrites to route `/{slug}` to the Supabase Edge Function. The reserved-slug denylist (D-10) is enforced in `page-publish` at save time — `vercel.json` only routes slugs that don't match existing path prefixes.

```json
// In vercel.json — add BEFORE existing rewrites
{
  "source": "/(pricing|[^.]+)",
  "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/page-render/$1",
  "has": [{ "type": "host", "value": "leanshot.app" }]
}
```

**IMPORTANT ROUTING CONFLICT:** The existing `vercel.json` rewrites `clinic/(.*)` and `clinic-invite/(.*)` to `index.html`. The SPA hash-routes (`#/auth/*`, `#/share/*`, `#/legal/*`) are handled by the SPA. The new `/{slug}` route for published pages MUST be routed to the Edge Function, NOT to `index.html`. Ordering in `vercel.json` matters: specific path prefixes first (`/clinic/*`, `/admin/*`, `/share/*`, etc.), then the slug catch-all. [VERIFIED: leanshot/vercel.json]

**Simpler alternative:** Only route known slugs from `landing_pages` (not a catch-all). The publish action registers the slug in a lookup; `vercel.json` uses a rewrite pattern. The simpler and correct approach is to add the `page-render` Edge Function URL as a rewrite only AFTER all protected/existing path prefixes are excluded. The reserved-slug denylist enforces this at save time.

### Pattern 5: Sitemap + robots.txt (Claude's Discretion — Recommended)

**What:** A separate `sitemap` Edge Function that:
1. Queries `SELECT slug, updated_at FROM landing_pages WHERE status='published'`
2. Generates `<?xml ...>` sitemap XML inline
3. Returns with `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`

The publish action also calls a HEAD request against `/sitemap.xml` with the bypass token to force immediate cache flush after each publish. `robots.txt` is a static file in the marketing build — no dynamic generation needed (allow all by default, sitemap link).

**Why NOT static file:** Dynamic generation avoids a Storage write step, avoids stale sitemap between publish and S3 update, and is trivial to implement as an Edge Function. [ASSUMED — based on pattern comparison]

### Pattern 6: Lead Capture Edge Function (Claude's Discretion — Recommended)

**Leads table column shape:**
```sql
CREATE TABLE public.leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL,
  email            text NOT NULL,
  name             text,
  extra_fields     jsonb,
  ip_hash          text,         -- SHA-256 of X-Forwarded-For; not raw IP
  honeypot_flagged boolean NOT NULL DEFAULT false,
  source_url       text,         -- Referer header
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

**Spam-guard mechanism (recommended two-layer approach):**

1. **Honeypot field:** Form has a hidden `<input name="website">` field. `lead-capture` rejects if it's non-empty. [CITED: bloycey.blog — established web pattern]
2. **Rate limiting:** Simple per-IP rate limit (5 submissions per 15 minutes) stored in Postgres. Avoid Upstash Redis (extra vendor dependency) — instead use a Postgres-based counter via a `lead_rate_limits` table with `ON CONFLICT DO UPDATE` incrementing a count + resetting every 15 minutes, or use a simpler approach of `SELECT COUNT(*) FROM leads WHERE ip_hash=$1 AND created_at > now() - interval '15 minutes'` and reject if ≥5. This avoids the Upstash cost. [ASSUMED — Postgres-based rate limit; Upstash approach documented at supabase.com/docs/guides/functions/examples/rate-limiting but requires extra vendor]

**`verify_jwt = false`** in `supabase/config.toml` (public form POST).

### Anti-Patterns to Avoid
- **Mixing `@dnd-kit/react` (new API) with `@dnd-kit/core` (old API):** They are incompatible. Use one or the other. Phase 15 uses `@dnd-kit/core` (stable).
- **Putting dnd-kit in the `page-builder-runtime` chunk AND eagerly importing it:** The `manualChunks` rule must only fire for `@dnd-kit/` IDs that are reachable from the lazy `admin-bundle` chunk. If any file in the main bundle imports `@dnd-kit/`, the library will pollute the index chunk. Guard with the `admin-bundle` lazy boundary.
- **Recursive JSONB tree in the DB schema:** A flat array with `parent_id` is simpler to query and update than a nested JSONB object. Avoid nesting `children: []` in the JSONB.
- **Using Next.js ISR APIs (revalidatePath, revalidateTag) from a Supabase Edge Function:** These are Next.js-only. Use `Cache-Control` headers + `x-prerender-revalidate` bypass instead.
- **Serving the editor HTML to public visitors:** The `admin-bundle` must remain lazy and only load after the `is_staff` check. The `page-render` Edge Function must NOT import any React/editor code.
- **DDL migrations that mix enum ADD and forward-ref CREATE POLICY in one transaction:** See project memory `feedback_planner_iter1_anti_patterns.md` — split into separate migration files.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop block reordering | Custom mouse event handlers | `@dnd-kit/core` + `@dnd-kit/sortable` | Accessibility (keyboard nav, ARIA), touch support, pointer coalescing, smooth animations — dozens of edge cases |
| UUID generation for block IDs | `Math.random()` | `crypto.randomUUID()` (Deno built-in) or `nanoid` (browser) | Collision-free, cryptographically random |
| HTML sanitization for block content | Custom regex | Server-side: only allow known block types and known content fields; renderer only outputs known template strings — no innerHTML injection from user data | Injection surface is the block-tree JSONB, not raw HTML — design prevents it |
| JSON-LD generation | Hand-written JS | Typed `json-ld.ts` helper that maps block types to schema.org structures | Schema.org types are well-defined; auto-generation from known block types is safe and testable |
| Email for lead notifications | Custom SMTP | Resend via `lead-capture` Edge Function (already wired via Phase 12 Resend domain verification) | Same pattern as `clinic-invite` Edge Function |
| Image resizing at upload | Canvas API client-side | Supabase Storage transforms (Pro plan) or serve raw + CSS max-width (free plan) | Client-side canvas resizing is lossy, slow, and inconsistent across browsers |

**Key insight:** The renderer (`page-render`) must be a simple Deno TypeScript function with NO external framework dependencies — it generates HTML string from a JSONB tree. Adding React SSR to a Supabase Edge Function adds 100+ kB of bundle weight, cold-start latency, and complexity. The renderer is intentionally a template function.

---

## Common Pitfalls

### Pitfall 1: `vercel.json` Catch-All Route Conflicts
**What goes wrong:** Adding a `/{slug}` rewrite that matches ALL paths (including `/clinic/*`, `/admin/*`, `/share/*`) routes protected app surfaces to the `page-render` Edge Function.
**Why it happens:** `vercel.json` rewrites are ordered; a broad `"source": "/(.*)"` matches before specific prefixes if placed first.
**How to avoid:** Place slug rewrite AFTER all protected-path rewrites. Use the reserved-slug denylist enforced at save time to prevent slugs like `clinic`, `admin`, `share`, `api`, `auth`, `assets`, `r`.
**Warning signs:** 302/200 from `page-render` for `/clinic/{slug}` paths; clinic operator sees a landing page instead of the operator dashboard.

### Pitfall 2: Editor Bundle Leaking into Index Chunk
**What goes wrong:** If any file in `src/App.tsx` or any eagerly-imported module imports from `@/components/admin/` or `@dnd-kit/`, the entire editor + dnd-kit leaks into the `index` chunk, blowing the 24.5 kB gz working ceiling.
**Why it happens:** Vite's `manualChunks` only overrides the CHUNK name — it doesn't prevent static imports from pulling code into the index chunk's static graph.
**How to avoid:** `AdminPagesRoot` in `App.tsx` must be wrapped in `React.lazy()` only. Add a CI check in `assert-clinic-bundle-budget.sh` asserting zero static dnd-kit import in the index chunk (analogous to the jsPDF check).
**Warning signs:** `index-*.js.gz` size jumps by ~18 kB; `page-builder-runtime` chunk has zero bytes.

### Pitfall 3: Supabase Storage Transforms on Free Tier
**What goes wrong:** Code references `?width=800&resize=contain` transforms on the `page-assets` bucket URL, but the project is on the free Supabase tier. Requests return 400 or the raw image.
**Why it happens:** Image transforms are **Pro plan only** on Supabase. Free-tier projects `ytnsipxxmzgaebkqmokp` status is unverified. [VERIFIED: supabase.com/docs/guides/storage/serving/image-transformations]
**How to avoid:** Detect at runtime whether transforms are available (attempt a test transform request on first upload; fallback to raw URL). Or architect the upload UI to accept pre-resized images only. Safest: code a `buildImageUrl(path, opts)` helper that conditionally appends transform params based on an env var `VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED`.
**Warning signs:** Image URLs in rendered pages are broken or oversized; Lighthouse performance penalty for unoptimized images.

### Pitfall 4: Append-Only Revision Bloat
**What goes wrong:** Every auto-save (debounced on typing) appends a new revision row. 1000 typing events = 1000 revision rows per session.
**Why it happens:** D-07 says "every save appends a revision row" — if saves are frequent, the table grows unboundedly.
**How to avoid:** Auto-save debounces writes to server (suggest 2-second idle), but the revision row is appended only on explicit "Save" action (not on auto-save). Auto-save can store to Zustand state only; server write (= new revision) on deliberate Save button press or on publish. Clarify in the plan: "revision row" = explicit save, not every keystroke.
**Warning signs:** `landing_page_revisions` row count grows >100 per page per day; DB storage cost surprise.

### Pitfall 5: CSP snapshot test failure after frame-src widening (D-01)
**What goes wrong:** D-01 requires `frame-src` to include `calendly.com`, `youtube-nocookie.com`, `tally.so` for the rendered-page CSP. But `tests/csp/csp-snapshot.test.ts` asserts an exact match against `tests/csp/csp-snapshot.txt`. Updating the snapshot file is REQUIRED.
**Why it happens:** Phase 12 locked the CSP snapshot as a CI gate. Any addition without updating the snapshot breaks CI.
**How to avoid:** The plan must include an explicit task to update `tests/csp/csp-snapshot.txt` with the widened `frame-src`. The rendered-page CSP (in `vercel.json` headers) is different from the admin-bundle CSP — consider two header sources or a permissive `frame-src` for all routes.
**Warning signs:** CI red after Phase 15 Wave 1 on the `csp-snapshot.test.ts` vitest run.

### Pitfall 6: Forward-Ref FK Circular Dependency in Migration
**What goes wrong:** `landing_pages.published_revision_id` is a FK to `landing_page_revisions.id`, but `landing_page_revisions.page_id` is a FK to `landing_pages.id`. This is a circular FK dependency.
**Why it happens:** Standard relational design for published-pointer model naturally creates this circle.
**How to avoid:** Create tables in order: (1) `landing_pages` WITHOUT the `published_revision_id` FK, (2) `landing_page_revisions` with `page_id FK`, (3) `ALTER TABLE landing_pages ADD COLUMN published_revision_id ... REFERENCES landing_page_revisions`. Use `DEFERRABLE INITIALLY DEFERRED` on the FK so publish (setting `published_revision_id`) and revision creation can happen in a single transaction. [CITED: Supabase migration gotchas project memory]
**Warning signs:** `supabase db push` fails with "relation does not exist" or FK violation on the circular reference.

### Pitfall 7: `verify_jwt` Default for page-render and lead-capture
**What goes wrong:** Supabase Edge Functions default `verify_jwt = true` when there are no `[functions.*]` blocks in `supabase/config.toml`. `page-render` and `lead-capture` are public endpoints — a valid JWT is NOT required.
**Why it happens:** Project memory `reference_supabase_edge_function_deploy.md` confirms: "verify_jwt defaults true with no config blocks."
**How to avoid:** Add to `supabase/config.toml`:
```toml
[functions.page-render]
verify_jwt = false

[functions.lead-capture]
verify_jwt = false

[functions.sitemap]
verify_jwt = false
```
`page-save` and `page-publish` MUST keep `verify_jwt = true` (they mutate data and check `is_staff`).
**Warning signs:** 401 responses from `page-render` for unauthenticated visitors; form submissions fail with 401.

### Pitfall 8: esm.sh bare specifiers in Edge Functions
**What goes wrong:** Using `import { Resend } from 'resend'` (bare specifier) in `lead-capture` causes the deploy bundler to fail silently.
**Why it happens:** Project memory `reference_supabase_edge_function_deploy.md`: "deploy bundler ignores `import_map.json` (bare value imports break — use full esm.sh URLs)."
**How to avoid:** Use `import { Resend } from 'https://esm.sh/resend@latest?target=denonext'` (full URL). Mirror the pattern in `stripe-checkout/index.ts` which uses `import Stripe from 'https://esm.sh/stripe@19?target=denonext'`.
**Warning signs:** Edge Function deploys successfully but throws a "module not found" runtime error on first invocation.

---

## Code Examples

Verified patterns from official sources:

### dnd-kit SortableContext (stable API)
```typescript
// Source: [VERIFIED: dndkit.com/presets/sortable — Legacy API docs]
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableBlockItem({ block }: { block: BlockNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    paddingLeft: block.parent_id ? '1.5rem' : 0,  // visual nesting
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BlockRow block={block} />
    </div>
  );
}

function BlockTreePanel({ blocks, onReorder }: { blocks: BlockNode[]; onReorder: (b: BlockNode[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor));
  const ids = blocks.map((b) => b.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIdx = blocks.findIndex((b) => b.id === active.id);
        const newIdx = blocks.findIndex((b) => b.id === over.id);
        onReorder(arrayMove(blocks, oldIdx, newIdx));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {blocks.map((block) => <SortableBlockItem key={block.id} block={block} />)}
      </SortableContext>
    </DndContext>
  );
}
```

### Cache-Control response from page-render Edge Function
```typescript
// Source: [CITED: vercel.com/docs/incremental-static-regeneration]
// supabase/functions/page-render/index.ts

return new Response(html, {
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    // s-maxage: CDN caches for 60 seconds before treating as stale
    // stale-while-revalidate: serve stale for up to 24h while regenerating
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400',
    // Vary prevents cross-user cache poisoning
    'Vary': 'Accept-Encoding',
  },
});
```

### On-demand cache bypass (publish action)
```typescript
// Source: [CITED: vercel.com/docs/incremental-static-regeneration/quickstart — SvelteKit/Nuxt pattern]
// In page-publish Edge Function — after updating published_revision_id:

const bypassToken = Deno.env.get('VERCEL_BYPASS_TOKEN') ?? '';
const marketingOrigin = Deno.env.get('PUBLIC_MARKETING_ORIGIN') ?? 'https://leanshot.app';

// Force Vercel CDN to flush and re-fetch immediately
await fetch(`${marketingOrigin}/${slug}`, {
  method: 'HEAD',
  headers: { 'x-prerender-revalidate': bypassToken },
}).catch(() => { /* non-fatal — CDN will stale-revalidate within 60s anyway */ });
```

### JSON-LD auto-generation helper
```typescript
// Source: [ASSUMED] — based on schema.org documentation + Google structured data guidelines
// src/lib/page-builder/json-ld.ts

type SchemaType = 'WebPage' | 'FAQPage' | 'ItemPage' | 'AboutPage';

interface FAQItem { question: string; answer: string; }

export function buildJsonLd(
  page: { seo_title: string; seo_description: string; seo_canonical: string; seo_schema_type: string },
  blocks: BlockNode[],
): string {
  const type = page.seo_schema_type as SchemaType ?? 'WebPage';

  const base = {
    '@context': 'https://schema.org',
    '@type': type,
    'name': page.seo_title,
    'description': page.seo_description,
    'url': page.seo_canonical,
  };

  if (type === 'FAQPage') {
    const faqBlock = blocks.find((b) => b.type === 'faq');
    const items: FAQItem[] = (faqBlock?.content?.items as FAQItem[]) ?? [];
    return JSON.stringify({
      ...base,
      'mainEntity': items.map((i) => ({
        '@type': 'Question',
        'name': i.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': i.answer },
      })),
    });
  }

  return JSON.stringify(base);
}
```

### RLS policy pattern for landing_pages (is_staff gate)
```sql
-- Source: [ASSUMED] — based on project RLS patterns from existing migrations

-- is_staff helper (thin gate per D-11)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT is_staff FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    false
  );
$$;

-- landing_pages: public reads, staff-only writes
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "published pages are publicly readable"
  ON public.landing_pages FOR SELECT
  USING (status = 'published');

CREATE POLICY "staff can read all pages"
  ON public.landing_pages FOR SELECT
  USING (public.is_staff());

CREATE POLICY "staff can insert pages"
  ON public.landing_pages FOR INSERT
  WITH CHECK (public.is_staff());

CREATE POLICY "staff can update pages"
  ON public.landing_pages FOR UPDATE
  USING (public.is_staff());

-- leads: service_role only (lead-capture Edge Function uses service role key)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role inserts leads"
  ON public.leads FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "staff reads leads"
  ON public.leads FOR SELECT
  USING (public.is_staff());
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@dnd-kit/core` (DndContext API) | NEW: `@dnd-kit/react` (DragDropProvider API) | 2025 — `@dnd-kit/react@0.4.0` released | New API is cleaner but still at 0.4.x; OLD API (`@dnd-kit/core@6.3.1`) is still `npm latest` and production-stable; Phase 15 uses old API |
| Vercel ISR tied to frameworks | Framework-agnostic Cache-Control + `x-prerender-revalidate` bypass | 2024-2025 | Non-framework origins use headers-based caching; true ISR durability still framework-only |
| Supabase Storage transforms (beta) | Image transforms promoted to GA on Pro plan | ~2023 | Free-tier projects cannot use transforms at all |

**Deprecated/outdated:**
- `@dnd-kit/react@0.0.x` alpha: replaced by `0.4.0` stable new API, but neither is recommended here.
- Supabase `import_map.json` in Edge Functions: still present but deploy bundler ignores it for runtime imports — must use full esm.sh URLs.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `admin-bundle` + `page-builder-runtime` chunk split via `manualChunks` will keep dnd-kit off the index chunk | Architecture Patterns — Pattern 3 | If dnd-kit leaks into index, bundle CI fails; fix requires lazy boundary audit |
| A2 | `@dnd-kit/sortable@10.0.0` is compatible with `@dnd-kit/core@6.3.1` (stable legacy API) | Standard Stack | If there's a version mismatch, sortable features break at runtime; verify with `npm install` |
| A3 | `x-prerender-revalidate` header mechanism works for Vercel rewrites pointing to Supabase Edge Function origins | Pattern 4 (Cache Headers) | If bypass only works for framework-native functions, publish will feel slow (60s stale-revalidate window); acceptable fallback |
| A4 | Postgres-based rate limiting (SELECT COUNT from leads) is sufficient for lead-capture spam protection | Pattern 6 (Leads) | Under heavy spam, SELECT per request adds DB load; can upgrade to Upstash Redis if needed |
| A5 | `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` gz ≈ 18 kB (within 25 kB PAGE_BUILDER_RUNTIME_CEILING) | Standard Stack / Bundle math | If actual measured gz exceeds 25 kB, ceiling must be raised or dnd-kit must be code-split further |
| A6 | Supabase Storage image transforms are NOT available on the current Supabase free tier project | Common Pitfalls — Pitfall 3 | If project is on Pro plan, transforms ARE available and the conditional helper is unnecessary overhead |
| A7 | Sitemap dynamic Edge Function (SELECT + XML render) performs adequately for <1000 published pages | Pattern 5 | For large page catalogs, pregenerated static sitemap is faster; not a concern at Phase 15 scale |
| A8 | One-time debounced save (not every keystroke) is the correct interpretation of D-07 "every save appends a revision row" | Common Pitfalls — Pitfall 4 | If user expects auto-save to create revisions continuously, UX mismatch; clarify with product |

---

## Open Questions

1. **Vercel project topology for /{slug} routing**
   - What we know: `vercel.json` currently has rewrites for `/clinic/(.*)` and `/clinic-invite/(.*)` only. The marketing site (Landing.tsx) is served from `dist-marketing/` via a separate Vercel project (`vercel.marketing.json`). The main app is the SPA.
   - What's unclear: Does the `/pricing` slug (D-10) land on the SPA Vercel project (app.leanshot.app) or the marketing Vercel project (leanshot.app)? The ROADMAP says "renderer deployed to the marketing host" — which implies `leanshot.app`, NOT `app.leanshot.app`.
   - Recommendation: Verify with user or check Phase 14 VERIFICATION.md for the domain setup. If published pages live on `leanshot.app`, the `vercel.marketing.json` project needs the `/{slug}` rewrite and `page-render` Edge Function URL. If they live on `app.leanshot.app`, the SPA `vercel.json` needs the rewrite. This affects which `vercel.json` to update.

2. **Supabase project plan tier**
   - What we know: Project ref is `ytnsipxxmzgaebkqmokp`; image transforms are Pro-plan only.
   - What's unclear: Is the project on free or Pro plan at Phase 15 execution time?
   - Recommendation: Check with `supabase projects list` or the dashboard. If free, code the conditional image URL helper from the start; if Pro, use transforms directly.

3. **`is_staff` column existence**
   - What we know: D-11 says "likely `profiles.is_staff` column or equivalent" but Phase 15 must actually CREATE this if it doesn't exist.
   - What's unclear: Does `profiles.is_staff` already exist in the DB schema from a prior phase migration?
   - Recommendation: `grep -r "is_staff" supabase/migrations/` — if not found, the Phase 15 migration must `ALTER TABLE profiles ADD COLUMN is_staff boolean NOT NULL DEFAULT false`.

4. **`site_settings` singleton enforcement**
   - What we know: D-15 says a single `site_settings` config row.
   - What's unclear: How to enforce single-row at the DB level cleanly.
   - Recommendation: Use a partial unique index on a constant column: `CREATE UNIQUE INDEX site_settings_singleton ON site_settings ((TRUE))` — this enforces exactly one row. Or use `ON CONFLICT DO UPDATE` in the insert. The application only ever upserts, never inserts a second row.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `@dnd-kit/core` | PAGE-02 editor | ✗ (not installed) | — | None; must install |
| `@dnd-kit/sortable` | PAGE-02 editor | ✗ (not installed) | — | None; must install |
| `@dnd-kit/utilities` | PAGE-02 editor | ✗ (not installed) | — | None; must install |
| Supabase Storage transforms | PAGE-01 image optimization | Unknown | — | Serve raw URLs if free tier |
| Vercel bypass token (`VERCEL_BYPASS_TOKEN`) | D-09 on-demand revalidation | Unknown | — | 60s stale-revalidate window |
| Resend (already wired) | D-12 lead notification | ✓ | Phase 12 | — |
| `supabase/functions/stripe-checkout` | PAGE-09 | ✓ deployed | Phase 14 | — |

**Missing dependencies with no fallback:**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — must be installed in Wave 0.

**Missing dependencies with fallback:**
- Supabase Storage transforms — free-tier fallback: serve raw image URLs, CSS max-width constraint.
- `VERCEL_BYPASS_TOKEN` — fallback: CDN will stale-revalidate within 60s; publish still works, just not "instant."

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (unit/integration) + Playwright (e2e) |
| Config file | `vite.config.ts` (test section: includes `src/**`, `tests/**`, `scripts/**`, `../shared/**`) |
| Quick run command | `npm run test` (vitest) |
| Full suite command | `npm run test && npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAGE-01 | `landing_pages` + `landing_page_revisions` tables + RLS policies exist | RLS integration | `npm run test -- tests/rls/page-builder-rls.test.ts` | ❌ Wave 0 |
| PAGE-01 | `leads` table + RLS exist | RLS integration | included above | ❌ Wave 0 |
| PAGE-01 | `page-assets` bucket + listing RLS | RLS integration | included above | ❌ Wave 0 |
| PAGE-02 | dnd-kit drag reorder updates block tree state | Unit | `npm run test -- src/components/admin/pages/editor/BlockTreePanel.test.tsx` | ❌ Wave 0 |
| PAGE-03 | 12 block types render correctly in editor | Unit | included above | ❌ Wave 0 |
| PAGE-04 | Template scaffold produces a valid block tree | Unit | `npm run test -- src/lib/page-builder/templates.test.ts` | ❌ Wave 0 |
| PAGE-05 | JSON-LD helper produces valid FAQPage/WebPage JSON-LD | Unit | `npm run test -- src/lib/page-builder/json-ld.test.ts` | ❌ Wave 0 |
| PAGE-06 | Published page visitor does NOT receive editor React bundle | e2e smoke | `npx playwright test e2e/page-render.spec.ts` | ❌ Wave 0 |
| PAGE-06 | Lighthouse perf ≥90 / a11y ≥95 on published page | e2e Lighthouse | `npx playwright test e2e/page-render.spec.ts` (Lighthouse audit) | ❌ Wave 0 |
| PAGE-07 | Restore revision updates published_revision_id + CDN bypass fires | Integration | `npm run test -- tests/rls/page-builder-rls.test.ts` (restore path) | ❌ Wave 0 |
| PAGE-08 | `sitemap.xml` includes published pages; `robots.txt` has Sitemap: link | e2e smoke | `npx playwright test e2e/page-render.spec.ts` (curl assertions) | ❌ Wave 0 |
| PAGE-09 | Checkout-button on `/pricing` calls stripe-checkout Edge Function | e2e smoke | `npx playwright test e2e/checkout-trial-flow.spec.ts` (extend existing) | ✅ |
| PAGE-01 | Cross-tenant: user without is_staff cannot read unpublished pages | RLS | `npm run test -- tests/rls/page-builder-rls.test.ts` | ❌ Wave 0 |
| PAGE-01 | Cross-tenant: user without is_staff cannot mutate landing_pages | RLS | included above | ❌ Wave 0 |
| CSP | `frame-src` includes calendly.com, youtube-nocookie.com, tally.so | Vitest snapshot | `npm run test -- tests/csp/csp-snapshot.test.ts` | ✅ (existing; MUST update snapshot.txt) |

### Sampling Rate
- **Per task commit:** `npm run test` (vitest unit suite, < 30 seconds)
- **Per wave merge:** `npm run test && npx playwright test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/rls/page-builder-rls.test.ts` — covers PAGE-01 RLS surfaces (landing_pages, landing_page_revisions, leads, page-assets bucket)
- [ ] `src/lib/page-builder/templates.test.ts` — covers PAGE-04 template scaffold
- [ ] `src/lib/page-builder/json-ld.test.ts` — covers PAGE-05 JSON-LD generation
- [ ] `e2e/page-render.spec.ts` — covers PAGE-06 (no editor bundle in response) + PAGE-08 (sitemap)
- [ ] `tests/csp/csp-snapshot.txt` — UPDATE (not create) to include new `frame-src` origins
- [ ] `src/components/admin/pages/editor/BlockTreePanel.test.tsx` — covers PAGE-02/03 drag-reorder
- [ ] Framework install: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` — if not already installed at Wave 0 start

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT (verify_jwt=true on write functions); `is_staff` boolean check |
| V3 Session Management | no | Sessions managed by existing auth layer |
| V4 Access Control | yes | RLS on `landing_pages`, `landing_page_revisions`, `leads`, `page-assets`; `is_staff()` SECURITY DEFINER function |
| V5 Input Validation | yes | Block-type allowlist (only known block types accepted in JSONB); slug regex validation + reserved-slug denylist; honeypot field in lead form |
| V6 Cryptography | no | No new key material; `ip_hash` uses SHA-256 (Deno `crypto.subtle`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slug hijacking (`/admin`, `/clinic` etc.) | Spoofing | Reserved-slug denylist enforced in `page-save`/`page-publish` before insert |
| XSS via block content rendered in page-render | Tampering | Renderer only outputs known template strings with content-field HTML escaping; no `innerHTML` injection |
| Spam form submissions to lead-capture | Denial of Service | Honeypot field (hidden input) + per-IP rate limit (5 per 15 min) via Postgres counter |
| Admin-bundle served to public visitors | Information Disclosure | `admin-bundle` is lazy-loaded only on `is_staff` check; `page-render` uses zero editor code |
| Cross-tenant read of unpublished pages | Information Disclosure | RLS: `status = 'published'` filter on public SELECT; `is_staff()` check on all-pages SELECT |
| Cache poisoning via forged `x-prerender-revalidate` | Tampering | `VERCEL_BYPASS_TOKEN` is a secret env var; only `page-publish` Edge Function sends it |
| Unvalidated block JSONB expansion | Injection | Only known `BlockType` enum values accepted; unknown type → 422 from `page-save` |

---

## Sources

### Primary (HIGH confidence)
- `/websites/dndkit` (Context7) — sortable, nested droppable, collision priority docs
- [dndkit.com/react/guides/migration](https://dndkit.com/react/guides/migration/) — migration guide confirming new vs. old API distinction
- [dndkit.com/react/quickstart](https://dndkit.com/react/quickstart/) — new `@dnd-kit/react` vs old `@dnd-kit/core` confirmed
- npm registry — `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, `@dnd-kit/react@0.4.0` dist-tags
- [vercel.com/docs/incremental-static-regeneration](https://vercel.com/docs/incremental-static-regeneration) — ISR is framework-only; confirmed Cache-Control alternative for custom origins
- [vercel.com/docs/incremental-static-regeneration/quickstart](https://vercel.com/docs/incremental-static-regeneration/quickstart) — `x-prerender-revalidate` header mechanism for SvelteKit/Nuxt/custom backends
- [supabase.com/docs/guides/storage/serving/image-transformations](https://supabase.com/docs/guides/storage/serving/image-transformations) — confirms transforms = Pro plan only
- `leanshot/scripts/assert-clinic-bundle-budget.sh` — `PAGE_BUILDER_RUNTIME_CEILING=25000` confirmed [VERIFIED: codebase]
- `leanshot/vercel.json` — existing rewrite ordering [VERIFIED: codebase]
- `leanshot/vite.config.ts` — `manualChunks` pattern + test.include configuration [VERIFIED: codebase]
- `leanshot/src/App.tsx` — `React.lazy` + `selectView` pattern [VERIFIED: codebase]
- `supabase/config.toml` — `[functions.stripe-webhook] verify_jwt = false` pattern [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- [community.vercel.com/t/x-prerender-revalidate-for-all-urls/11906](https://community.vercel.com/t/x-prerender-revalidate-for-all-urls/11906) — `x-prerender-revalidate` works for non-framework custom origins (community-confirmed)
- [supabase.com/docs/guides/functions/examples/rate-limiting](https://supabase.com/docs/guides/functions/examples/rate-limiting) — Upstash Redis rate-limiting pattern for Edge Functions

### Tertiary (LOW confidence)
- dnd-kit chunk gz size estimate (~18 kB) — from training knowledge, not measured in this session [ASSUMED]
- Postgres-based rate limiting adequacy for lead-capture scale [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm versions verified directly
- Architecture / block schema: HIGH (existing project patterns) / MEDIUM (new ISR bypass mechanism)
- Pitfalls: HIGH — based on verified codebase + confirmed Supabase/Vercel docs
- Bundle estimate: LOW — not measured; marked A5 in Assumptions Log

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (stable libraries); 2026-05-21 for Vercel ISR behavior (fast-moving platform docs)
