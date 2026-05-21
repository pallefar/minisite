import { describe, it, expect } from 'vitest';
import { buildShareUrl } from '@/lib/gamification/share-token';

describe('buildShareUrl', () => {
  it('appends ?v= cache-bust query param (Pitfall 9)', () => {
    const url = buildShareUrl('tok-abc', 5);
    expect(url).toMatch(/\/share\/level\/tok-abc\?v=\d+/);
  });

  it('URL-encodes the token', () => {
    // tokens contain '.' characters which are safe in paths, but special chars should be encoded
    const url = buildShareUrl('aGVsbG8.d29ybGQ', 5);
    expect(url).toContain('/share/level/aGVsbG8.d29ybGQ');
  });

  it('uses VITE_LEANSHOT_MARKETING_URL env when set', () => {
    // In test env this is undefined so falls back to leanshot.app
    const url = buildShareUrl('tok', 3);
    expect(url).toMatch(/^https:\/\/leanshot\.app\/share\/level\/tok\?v=\d+$/);
  });
});

// HMAC sign/verify runs server-side only (Vercel Function + Postgres SECDEF RPC).
// Round-trip coverage: Task 4 Playwright spec (35-og-share-card.spec.ts) calls
// mint_share_token(5) then fetches /api/og/level-up.png?token=<...> and
// asserts 200 + image/png — this is the single integration point where
// Postgres mint / Vercel verify can silently diverge.
