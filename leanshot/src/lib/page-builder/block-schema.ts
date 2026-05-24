/**
 * Phase 15 Plan 03 — Block-schema contract module.
 *
 * Single source of truth for the page-builder block-tree contract:
 *   • `BlockType` — exhaustive 12-literal union (D-03: 8 core + 3 embed + 1 form).
 *   • `BlockStyle` — token-bounded style options (D-05) + the universal D-06
 *     `hideOnMobile` toggle.
 *   • `BlockNode` — one node in the flat-array tree (RESEARCH Pattern 1).
 *   • `BlockTree` — alias for `BlockNode[]`.
 *   • `RESERVED_SLUGS` (D-10) — readonly tuple of slugs the page-save layer
 *     must reject (must match the `vercel.json` `/{slug}` rewrite's
 *     negative-lookahead in 15-02 — `clinic | admin | share | api | auth |
 *     assets` plus the dotfile sitemap/robots paths).
 *   • `isReservedSlug(slug)` — case-insensitive, trim-tolerant denylist check
 *     used at save time by 15-04's page-save Edge Function.
 *
 * Imported by editor plans 15-04/05/06/07 and (mirrored, not imported — Deno
 * can't resolve `leanshot/src`) by `supabase/functions/page-render/render.ts`.
 *
 * Constraints:
 *   - PURE type-only module + runtime `RESERVED_SLUGS` + `isReservedSlug`.
 *   - NO external imports; NO side effects (so tree-shakes into both
 *     `admin-bundle` and `page-builder-runtime` chunks per 15-02's
 *     `vite.config.ts` manualChunks).
 */

/**
 * Discriminant for every block in the tree. 12 literal members:
 *   - 8 core (Hero, CTA, FAQ, Pricing, Testimonial, Feature grid, Image+text, Footer)
 *   - 3 embeds (Calendly, YouTube, Tally) — D-01 / D-02
 *   - 1 native form (Lead form) — D-12
 *
 * The literal strings ARE the contract — `supabase/functions/page-render/
 * render.ts` mirrors them as `switch` case names.
 */
export type BlockType =
  | 'hero'
  | 'cta'
  | 'faq'
  | 'pricing'
  | 'testimonial'
  | 'feature-grid'
  | 'image-text'
  | 'footer'
  | 'calendly'
  | 'youtube'
  | 'tally'
  | 'lead-form';

/**
 * Token-bounded style options shared by every block (D-05). All fields are
 * optional — a block with no `style` overrides renders with its per-type
 * defaults (Hero defaults to `backgroundTone='brand'`, Footer to `'dark'`,
 * everything else to `'default'`; see render.ts).
 *
 * D-06: `hideOnMobile` is the ONE universal per-block responsive prop —
 * resolved by the renderer to a `display:none` below the md breakpoint.
 */
export interface BlockStyle {
  backgroundTone?: 'default' | 'subtle' | 'brand' | 'dark';
  alignment?: 'left' | 'center' | 'right';
  spacingDensity?: 'compact' | 'default' | 'spacious';
  hideOnMobile?: boolean;
}

/**
 * One node in the flat-array block tree (RESEARCH Pattern 1).
 *
 * The tree is stored as a flat array in `landing_page_revisions.blocks`
 * (JSONB), keyed by `id` with `parent_id` references for nesting (null =
 * root level) and `order` as the sibling sort key. Reordering during a
 * dnd-kit drag updates `order` and/or `parent_id` only — never the array
 * index.
 *
 * `content` is intentionally `Record<string, unknown>` — each consumer
 * (renderer / property editor) narrows it per `type` defensively. We never
 * trust the shape; every field is coerced + escaped at the render boundary.
 */
export interface BlockNode {
  id: string; // nanoid(8); stable within a revision
  type: BlockType;
  parent_id: string | null; // null = root level
  order: number; // integer sibling sort key
  content: Record<string, unknown>;
  style: BlockStyle;
  /**
   * Phase 39 Plan 39-02 (PAGEAB-06 / D-13) — optional reference to a row
   * in `page_variants` (Phase 39-01 schema) so a single block can resolve
   * to one of N A/B variant payloads at render time. OPTIONAL: existing
   * non-variant blocks continue to validate without the field. Resolution
   * to actual variant content happens in the Wave 2 page-variant-resolver
   * Edge Function; the public render output emits only the resolved
   * variant blocks, never the field itself (T-39-02-04 mitigation).
   */
  variant_set_id?: string;
}

/** Alias — the JSONB shape stored in `landing_page_revisions.blocks`. */
export type BlockTree = BlockNode[];

/**
 * D-10 reserved-slug denylist. Every value here MUST be rejected by 15-04's
 * page-save Edge Function (case-insensitive — see `isReservedSlug`).
 *
 * The first six entries (`clinic` … `assets`) mirror the negative-lookahead
 * in `leanshot/vercel.json`'s `/((?!clinic|clinic-invite|admin|share|api|
 * auth|assets|index\\.html|assets/).+)` rewrite — published pages cannot
 * shadow a real path route. `sitemap.xml` and `robots.txt` are reserved
 * because plan 15-08 generates them dynamically at the same URL prefix.
 */
export const RESERVED_SLUGS = [
  'clinic',
  'admin',
  'share',
  'api',
  'auth',
  'assets',
  'sitemap.xml',
  'robots.txt',
] as const;

/**
 * Returns `true` if the lowercased, trimmed `slug` exactly matches an entry
 * in {@link RESERVED_SLUGS}. Pure, no side effects — safe to import from
 * either chunk.
 *
 * Trimming is intentional: paste-from-clipboard and admin-typed input
 * commonly carry surrounding whitespace, and we want the denylist to
 * survive that.
 */
export function isReservedSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  for (const r of RESERVED_SLUGS) {
    if (r === normalized) return true;
  }
  return false;
}
