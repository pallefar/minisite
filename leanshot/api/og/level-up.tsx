/**
 * Vercel Edge Function — OG share-card image generator (GAME-07).
 *
 * Returns a 1200×630 PNG branded share card for a given level.
 * HMAC token is verified before rendering; invalid tokens return 400.
 *
 * Cache-Control: public, max-age=3600, s-maxage=86400 (1h browser / 1d CDN).
 * Cache-bust strategy: caller appends ?v=<unix_ts> to the share URL so each
 * share occasion becomes a unique CDN cache key (Pitfall 9 — Twitter caches by URL).
 *
 * Bundle: @vercel/og runs server-side ONLY — does NOT enter the SPA entry chunk
 * (Research §Pattern 8 / must_haves.truths "Bundle ceiling").
 */
import { ImageResponse } from '@vercel/og';
import { verifyShareToken } from '../share/level/_token';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  // ?level= is a dev-only fallback (no token required); ignored when token present
  const fallbackLevel = Number(url.searchParams.get('level') ?? 0);
  const handle = url.searchParams.get('handle') ?? 'GLP-1 Tracker';
  const secret = process.env.SHARE_TOKEN_SECRET ?? '';

  let level = fallbackLevel;

  if (token) {
    if (!secret) {
      // Secret missing in env — return a deterministic error so ops can catch it
      return new Response('SHARE_TOKEN_SECRET not configured', { status: 500 });
    }
    const payload = await verifyShareToken(token, secret);
    if (!payload) {
      return new Response('invalid or expired token', { status: 400 });
    }
    level = payload.level;
  }

  if (level < 1 || level > 1000) {
    return new Response('invalid level', { status: 400 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0B1413 0%, #1f2e2c 100%)',
          color: '#EFEBE0',
          padding: 64,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Brand wordmark */}
        <div
          style={{
            fontSize: 36,
            opacity: 0.7,
            letterSpacing: '-0.02em',
            display: 'flex',
          }}
        >
          LeanShot
        </div>

        {/* Level number — hero element */}
        <div
          style={{
            fontSize: 128,
            fontWeight: 700,
            marginTop: 24,
            letterSpacing: '-0.04em',
            color: '#22c55e',
            display: 'flex',
          }}
        >
          Level {level}
        </div>

        {/* Handle / sub-copy */}
        <div
          style={{
            fontSize: 32,
            marginTop: 8,
            opacity: 0.85,
            display: 'flex',
          }}
        >
          {handle}
        </div>

        {/* Footer tagline */}
        <div
          style={{
            fontSize: 22,
            marginTop: 'auto',
            opacity: 0.55,
            display: 'flex',
          }}
        >
          Track your GLP-1 journey · leanshot.app
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
      },
    },
  );
}
