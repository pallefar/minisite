/**
 * Phase 15 Plan 15-06 — Embed (Calendly / YouTube / Tally) src + iframe-HTML builders.
 *
 * The single XSS/clickjacking-critical seam for the 3 embed providers. All
 * iframe `src` strings AND the full iframe-HTML strings are constructed here
 * from allow-listed inputs ONLY — never escape-and-pass.
 *
 * PURE module — no DOM, no Deno globals, no React, no side effects. Imported
 * by:
 *   • Editor preview block components (`*.Block.tsx` in the admin surface).
 *   • `supabase/functions/page-render/render.ts` (Deno renderer — relative
 *     import works because this module is dependency-free TypeScript).
 *
 * Allow-listed origins (matched 1:1 against `tests/csp/csp-snapshot.txt`
 * `frame-src`, which Phase 12 owns — DO NOT widen here):
 *   • https://calendly.com
 *   • https://www.youtube-nocookie.com
 *   • https://tally.so
 *
 * Validation rules:
 *   • YouTube `videoId`  — `/^[A-Za-z0-9_-]{1,20}$/` (canonical IDs are 11
 *     chars; cap defensively). Reject everything else.
 *   • Calendly + Tally URLs — `URL` parse + exact `protocol === 'https:'` +
 *     exact `hostname ===` (NOT `endsWith`/`includes` — defeats look-alike
 *     hosts like `calendly.com.evil.com` and `evil.com/calendly.com`).
 *
 * Invalid input ALWAYS returns `null` (src builders) or an empty string
 * (iframe-HTML builders). Callers render a safe non-iframe fallback rather
 * than ever emitting an iframe with an unvalidated `src`.
 */

// ─── A11y titles — non-empty per UI-SPEC + Lighthouse ≥95 ─────────────────────

export const EMBED_IFRAME_TITLES: Record<'calendly' | 'youtube' | 'tally', string> = {
  calendly: 'Schedule a meeting',
  youtube: 'YouTube video player',
  tally: 'Tally form',
};

// ─── YouTube ───────────────────────────────────────────────────────────────────

export interface YouTubeContent {
  videoId: string;
  startSeconds: number;
  autoplay: boolean;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{1,20}$/;

export function buildYouTubeSrc(content: YouTubeContent): string | null {
  const { videoId, startSeconds, autoplay } = content;
  if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(videoId)) return null;

  const params = new URLSearchParams();
  // rel=0 keeps the related-videos suggestion overlay limited to the source
  // channel. Always emitted.
  params.set('rel', '0');

  // startSeconds: coerce non-finite → 0, negative → 0, fractional → floor.
  const rawStart = typeof startSeconds === 'number' && Number.isFinite(startSeconds)
    ? Math.max(0, Math.floor(startSeconds))
    : 0;
  if (rawStart > 0) params.set('start', String(rawStart));

  if (autoplay === true) params.set('autoplay', '1');

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

// ─── Calendly ──────────────────────────────────────────────────────────────────

export interface CalendlyContent {
  calendlyUrl: string;
  prefillEmail: boolean;
}

/**
 * Parse `raw` with the `URL` ctor inside try/catch + assert exact
 * `protocol === 'https:'` and exact `hostname === expectedHost`. Returns the
 * parsed `URL` on success, `null` on any failure.
 *
 * `hostname` comparison is EXACT equality — NOT `endsWith`/`includes`. This
 * defeats `expectedHost.evil.com` (subdomain look-alike) and
 * `evil.com/expectedHost.com` (path look-alike).
 */
function parseAndValidateUrl(raw: unknown, expectedHost: string): URL | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== expectedHost) return null;
  return parsed;
}

export function buildCalendlySrc(content: CalendlyContent): string | null {
  const parsed = parseAndValidateUrl(content.calendlyUrl, 'calendly.com');
  if (!parsed) return null;
  // Re-serialize via the URL object so any embedded user characters are
  // percent-encoded — no unescaped user input survives into the final string.
  // `prefillEmail` does not change the static src origin — it only governs
  // editor-side widget configuration. The origin stays locked.
  return parsed.toString();
}

// ─── Tally ─────────────────────────────────────────────────────────────────────

export interface TallyContent {
  tallyFormUrl: string;
  hideTitle: boolean;
}

export function buildTallySrc(content: TallyContent): string | null {
  const parsed = parseAndValidateUrl(content.tallyFormUrl, 'tally.so');
  if (!parsed) return null;
  if (content.hideTitle === true) {
    parsed.searchParams.set('hideTitle', '1');
  } else {
    parsed.searchParams.delete('hideTitle');
  }
  return parsed.toString();
}

// ─── HTML attribute escape (pure, no DOM) ─────────────────────────────────────
//
// Used by the iframe-HTML builders to escape the validated `src` before it
// goes into an HTML attribute. Even though the src is allow-list-validated and
// URL-serialized (which percent-encodes hostile characters), we still
// entity-encode the 5 HTML-sensitive characters at the attribute boundary as
// a defense-in-depth measure.

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── iframe-HTML builders (used by render.ts AND editor preview parity) ──────
//
// Each `buildXIframeHtml` returns ONE of:
//   • A complete `<iframe ...></iframe>` HTML string wrapped in a sized
//     neutral wrapper `<div class="block-embed-...">` — when the matching
//     `buildXSrc` returned a non-null src.
//   • An empty string — when the matching src builder returned null. Callers
//     (render.ts in particular) wrap the result in their own block-section
//     wrapper, so an empty inner means "no iframe rendered" without breaking
//     the surrounding section.
//
// PURE: no DOM, no `Deno.*`, no `crypto.*`, no React, no `innerHTML`. The src
// itself comes ONLY from the matching `buildXSrc` helper — no string-concat
// of raw `content` values into the HTML.

function commonIframeAttrs(title: string): string {
  return (
    `title="${escapeHtmlAttr(title)}"` +
    ` loading="lazy"` +
    ` referrerpolicy="no-referrer"`
  );
}

export function buildYouTubeIframeHtml(content: YouTubeContent): string {
  const src = buildYouTubeSrc(content);
  if (!src) return '';
  const title = EMBED_IFRAME_TITLES.youtube;
  const attrs =
    commonIframeAttrs(title) +
    ` sandbox="allow-scripts allow-same-origin allow-presentation"` +
    ` allow="encrypted-media; picture-in-picture"` +
    ` style="position:absolute;inset:0;width:100%;height:100%;border:0;"`;
  return (
    `<div class="block-embed block-embed-youtube" style="position:relative;width:100%;max-width:960px;margin:0 auto;aspect-ratio:16/9;">` +
    `<iframe src="${escapeHtmlAttr(src)}" ${attrs}></iframe>` +
    `</div>`
  );
}

export function buildCalendlyIframeHtml(content: CalendlyContent): string {
  const src = buildCalendlySrc(content);
  if (!src) return '';
  const title = EMBED_IFRAME_TITLES.calendly;
  const attrs =
    commonIframeAttrs(title) +
    // Calendly booking opens popups; allow-popups is the minimum required.
    ` sandbox="allow-scripts allow-same-origin allow-popups allow-forms"` +
    ` allow="clipboard-write; payment"` +
    ` style="width:100%;height:100%;border:0;"`;
  return (
    `<div class="block-embed block-embed-calendly" style="width:100%;min-height:600px;">` +
    `<iframe src="${escapeHtmlAttr(src)}" ${attrs}></iframe>` +
    `</div>`
  );
}

export function buildTallyIframeHtml(content: TallyContent): string {
  const src = buildTallySrc(content);
  if (!src) return '';
  const title = EMBED_IFRAME_TITLES.tally;
  const attrs =
    commonIframeAttrs(title) +
    ` sandbox="allow-scripts allow-same-origin allow-forms"` +
    ` style="width:100%;height:100%;border:0;"`;
  return (
    `<div class="block-embed block-embed-tally" style="width:100%;min-height:400px;">` +
    `<iframe src="${escapeHtmlAttr(src)}" ${attrs}></iframe>` +
    `</div>`
  );
}
