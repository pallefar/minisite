/**
 * Phase 15 Plan 08 — JSON-LD auto-generator for the page-builder.
 *
 * D-16 hardline: this module NEVER accepts or passes through raw
 * user-authored JSON-LD. Schema is auto-generated from the published block
 * tree + the per-page `schemaType` dropdown override. The editor surfaces
 * a `<Select>` populated from `SCHEMA_TYPE_OPTIONS` — there is NO free-text
 * JSON-LD input anywhere in this codebase.
 *
 * SECURITY (T-15-08-01): the returned string is run through
 * `.replace(/</g, '\\u003c')` so it can NEVER contain a literal `</script>`
 * substring — meaning interpolation into a `<script type="application/ld+json">`
 * block cannot escape the script tag, even when the title contains
 * `</script>`.
 *
 * Pure, dependency-free, no DOM, no store, no side effects. Lands in the
 * `page-builder-runtime` chunk; the Deno renderer imports the same shape via
 * its relative path (D-08 / 15-08 plan).
 */

// `.ts` extension is intentional: Deno (the page-render Edge Function
// runtime) imports this module via a relative path and requires the file
// suffix. The browser bundler accepts the `.ts` import because
// `allowImportingTsExtensions: true` is set in tsconfig.app.json.
import type { BlockNode } from './block-schema.ts';

export type SchemaType = 'WebPage' | 'FAQPage' | 'Product' | 'Article' | 'Event';

export const SCHEMA_TYPE_OPTIONS: readonly SchemaType[] = [
  'WebPage',
  'FAQPage',
  'Product',
  'Article',
  'Event',
] as const;

export interface GenerateJsonLdOpts {
  blocks: BlockNode[];
  title: string;
  description: string;
  url: string;
  schemaType: SchemaType;
}

interface QaItem {
  q: string;
  a: string;
}

/**
 * Build an auto-generated JSON-LD string for the given page.
 *
 * Returns a JSON string (NOT a parsed object). Caller is responsible for
 * wrapping it in `<script type="application/ld+json">…</script>`. The output
 * has every literal `<` replaced with the JSON-safe `<` so the result
 * can NEVER terminate a `<script>` tag, regardless of what the user wrote
 * into `title` / `description` / FAQ items.
 *
 * `FAQPage` extracts Q&A from the published `faq` blocks' `content.items`
 * (shape `{ q, a }[]`). When no `faq` block is present (or items are not
 * an array), `mainEntity` is `[]` — the function never throws.
 *
 * Other schema types ship only the base `@context / @type / name /
 * description / url` shape — Phase 15 intentionally does NOT auto-extract
 * Product offer / Article author / Event date from blocks. Operators
 * select the type via the SEOPanel `<Select>`; richer JSON-LD is a
 * deliberate Phase 16+ deferred surface.
 */
export function generateJsonLd(opts: GenerateJsonLdOpts): string {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': opts.schemaType,
    name: opts.title,
    description: opts.description,
    url: opts.url,
  };

  if (opts.schemaType === 'FAQPage') {
    const items: QaItem[] = [];
    for (const block of opts.blocks) {
      if (block.type !== 'faq') continue;
      const raw = (block.content as { items?: unknown }).items;
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Partial<QaItem>;
        if (typeof item.q !== 'string' || typeof item.a !== 'string') continue;
        if (item.q.length === 0) continue;
        items.push({ q: item.q, a: item.a });
      }
    }
    base.mainEntity = items.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: qa.a,
      },
    }));
  }

  // T-15-08-01 — escape every literal `<` so the serialized string cannot
  // contain a `</script>` substring. JSON.stringify produces ASCII-safe
  // text, but a user title of `</script>` would survive as `"</script>"`
  // — wait, no: JSON.stringify keeps `<` as `<`. Hence the explicit replace.
  return JSON.stringify(base).replace(/</g, '\\u003c');
}
