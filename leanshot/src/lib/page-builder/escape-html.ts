/**
 * Phase 15 Plan 08 — shared HTML / attribute escaping.
 *
 * Pure, dependency-free module. Imported by BOTH the browser editor
 * (SEOPanel / SiteSettingsPanel preview) AND the Deno renderer
 * (`supabase/functions/page-render/render.ts` mirrors the same logic via
 * its local `escapeHtml`). Lives in the `page-builder-runtime` chunk per
 * 15-02's manualChunks rule.
 *
 * Exports:
 *   • `escapeHtml(value)` — entity-encode `& < >` so the string is safe to
 *     interpolate into HTML text-node context.
 *   • `escapeAttr(value)` — entity-encode `& < > " '` so the string is safe
 *     to interpolate inside a DOUBLE-quoted HTML attribute value.
 *
 * Order matters: `&` MUST be replaced first; otherwise subsequent
 * substitutions of `<`/`>`/`"`/`'` to entities starting with `&` would
 * have THEIR leading `&` re-encoded to `&amp;` (double-encode bug).
 *
 * Nullish input returns `''` (never the literal `null` / `undefined`).
 */

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
