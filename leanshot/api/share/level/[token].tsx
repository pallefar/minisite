/**
 * Vercel Edge Function — SSR share page for level-up share cards (GAME-07).
 *
 * Purpose: social-bot scrapers (Twitter Bot, LinkedInBot, FacebookBot) GET this
 * URL, read the <meta property="og:*"> tags, and render a preview card.
 * Human visitors are redirected to the SPA after a 2s meta-refresh.
 *
 * Route: /share/level/<token>
 * Vercel rewrite carve-out (vercel.json) routes /share/level/(.*) here
 * BEFORE the catch-all /share/(.*) → /index.html fallback (Research A1 — load-bearing).
 *
 * Viral attribution: redirect target includes ?ref=share so Phase 19's cookie-setter
 * fires on landing at app.leanshot.app and attaches the _aff cookie.
 *
 * Invalid / expired tokens: return 410 Gone (no eternal dead links cached by CDN).
 */
import { verifyShareToken } from './_token.js';

export const config = { runtime: 'edge' };

const APP_URL = process.env.LEANSHOT_APP_URL ?? 'https://app.leanshot.app';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Path: /share/level/<token> — last path segment is the token
  const segments = url.pathname.split('/').filter(Boolean);
  const rawToken = segments[segments.length - 1] ?? '';
  const token = decodeURIComponent(rawToken);
  const secret = process.env.SHARE_TOKEN_SECRET ?? '';

  let level = 0;
  let valid = false;

  if (token && secret) {
    const payload = await verifyShareToken(token, secret);
    if (payload) {
      level = payload.level;
      valid = true;
    }
  }

  // OG image URL — same-origin /api/og/level-up.png (img-src 'self' covers it)
  // Cache-bust ?v= mirrors the one in buildShareUrl so CDN key stays consistent.
  const cacheBust = url.searchParams.get('v') ?? String(Date.now());
  const ogImageUrl = `${url.origin}/api/og/level-up.png?token=${encodeURIComponent(token)}&v=${cacheBust}`;

  // Redirect target includes ?ref=share for Phase 19 viral attribution.
  const redirectTarget = `${APP_URL}/?ref=share&token=${encodeURIComponent(token)}`;

  const title = valid
    ? `Reached Level ${level} on LeanShot`
    : 'LeanShot — GLP-1 tracker';
  const description = valid
    ? `Reached Level ${level} on LeanShot. Track your GLP-1 journey.`
    : 'Track your GLP-1 journey with LeanShot.';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:url" content="${url.href}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${ogImageUrl}" />
  <meta http-equiv="refresh" content="2;url=${redirectTarget}" />
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0B1413;
      color: #EFEBE0;
    }
    a { color: #22c55e; }
  </style>
</head>
<body>
  <div style="text-align:center">
    <p>Redirecting to LeanShot…</p>
    <p><a href="${redirectTarget}">Click here if you are not redirected.</a></p>
  </div>
</body>
</html>`;

  return new Response(html, {
    // 410 Gone for invalid/expired tokens — tells CDN & bots not to cache indefinitely.
    // 200 for valid tokens.
    status: valid ? 200 : 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  });
}
