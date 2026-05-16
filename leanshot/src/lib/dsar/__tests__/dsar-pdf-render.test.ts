/**
 * Phase 22 plan 22-11 — dsar-pdf-render placeholder tests (GDPR-03).
 *
 * Owners: 22-11. Replaces the 22-01 Wave-0 scaffold.
 *
 * v1.2 contract: the symbol exists for v1.3 backfill (per file header in
 * `src/lib/dsar/dsar-pdf-render.ts`); v1.2 throws at runtime because the
 * shipping DSAR PDF render is server-side in
 * `supabase/functions/dsar-export/pdf-render.ts` (plan 22-04).
 *
 * The 7-section + SHA-256-redaction tests scoped here in the original
 * scaffold live in the server-side suite (`supabase/functions/dsar-export/
 * index.test.ts`) — that's the only path that actually renders at v1.2.
 */
import { describe, expect, it } from 'vitest';

import { renderDsarPdf } from '@/lib/dsar/dsar-pdf-render';

describe('dsar-pdf-render (Phase 22 GDPR-03 v1.3 placeholder)', () => {
  it('exports renderDsarPdf as a function (v1.3 seam)', () => {
    expect(typeof renderDsarPdf).toBe('function');
  });

  it('throws at v1.2 — clients should not invoke the client-side path', async () => {
    await expect(renderDsarPdf({})).rejects.toThrow(/v1\.3-reserved/);
  });
});
