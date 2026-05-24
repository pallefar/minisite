/**
 * Phase 49 Plan 09 — single search-result row (3 type variants).
 *
 * Renders type-appropriate metadata + snippet. The snippet may contain
 * `<b>` tags emitted by Postgres ts_headline; everything else is stripped
 * by `sanitizeSnippet` BEFORE dangerouslySetInnerHTML (T-49-26 mitigation).
 *
 * Inline regex sanitizer instead of pulling DOMPurify into the search chunk
 * (DOMPurify is ~9 kB min+gz; the regex-strip is ~200 bytes and the allow-set
 * is a single tag so the surface is small). Allowed inline: `<b>` + `</b>`.
 */

import type { SearchResult } from '@/lib/search/types';

/**
 * Strip every HTML tag except `<b>` + `</b>`. Numeric character entities and
 * `&amp;` etc. pass through unmodified — the snippet originates from
 * Postgres ts_headline which does not emit script/event sinks; the only
 * realistic XSS vector is a stored `<script>`/`<img onerror>` in indexed
 * post bodies, both of which the strip removes.
 */
function sanitizeSnippet(html: string): string {
  // Replace every tag-like token with empty, then restore the b allow-list.
  return html
    .replace(/<\/?(?!b\b)[^>]+>/gi, '')
    .replace(/<b[^>]*>/gi, '<b>'); // normalize attributes off `<b>`.
}

interface Props {
  result: SearchResult;
  onSelect: () => void;
}

export function SearchResultRow({ result, onSelect }: Props) {
  const title = result.title?.trim() || '(untitled)';
  const safeSnippet = result.snippet ? sanitizeSnippet(result.snippet) : '';
  return (
    <div
      onClick={onSelect}
      className="flex flex-col gap-1 px-3 py-2 rounded-md cursor-pointer data-[selected=true]:bg-[var(--color-surface-elevated)]"
      data-result-type={result.type}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          {result.type}
        </span>
        <span className="text-[14px] font-medium text-[var(--color-text)] truncate">{title}</span>
      </div>
      {safeSnippet && (
        <span
          className="text-[12px] text-[var(--color-text-secondary)] truncate"
          // T-49-26 — snippet pre-sanitized by sanitizeSnippet above; only `<b>` survives.
          dangerouslySetInnerHTML={{ __html: safeSnippet }}
        />
      )}
      {result.type === 'event' && result.start_at && (
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {new Date(result.start_at).toLocaleString()}
        </span>
      )}
    </div>
  );
}

export default SearchResultRow;
