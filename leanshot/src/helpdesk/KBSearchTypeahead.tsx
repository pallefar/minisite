/**
 * KBSearchTypeahead — Phase 37 Plan 06 Task 2 (HELP-11).
 *
 * Debounced (250ms) KB search calling Plan 02's `search_kb_articles` RPC.
 * Locale-aware (en/es); up to 10 results; raw query NEVER sent to analytics
 * (T-37-06-03 mitigation — only `query_length` + `results_count`).
 *
 * Lazy-imported into the helpdesk-widget root chunk by HelpdeskWidget.tsx.
 * Lightweight (no markdown / no dompurify) so it stays under the 25 kB gz
 * ceiling alongside the widget chrome.
 */
import { useEffect, useState, type JSX } from 'react';
import { Input } from '@/components/ui/Input';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

type Result = { id: string; slug: string; title: string; locale: string; rank: number };

export interface KBSearchTypeaheadProps {
  onSelectArticle: (id: string) => void;
}

export default function KBSearchTypeahead({
  onSelectArticle,
}: KBSearchTypeaheadProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [locale, setLocale] = useState<'en' | 'es'>('en');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('search_kb_articles', {
        p_query: trimmed,
        p_locale: locale,
        p_limit: 10,
      });
      if (cancelled) return;
      if (!error && data) {
        const rows = data as Result[];
        setResults(rows);
        // Length-only properties — T-37-06-03 mitigation. NEVER include raw query.
        track('helpdesk.kb_search.performed', {
          query_length: trimmed.length,
          results_count: rows.length,
          locale,
        });
      } else {
        setResults([]);
      }
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, locale]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            aria-label="Search the knowledge base"
            placeholder="Search help articles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          aria-pressed={locale === 'en'}
          onClick={() => setLocale('en')}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)]"
        >
          EN
        </button>
        <button
          type="button"
          aria-pressed={locale === 'es'}
          onClick={() => setLocale('es')}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)]"
        >
          ES
        </button>
      </div>
      <ul
        role="region"
        aria-live="polite"
        aria-busy={loading}
        className="flex flex-col gap-1"
      >
        {results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => {
                track('helpdesk.kb_article.viewed', {
                  article_id: r.id,
                  slug: r.slug,
                  locale: r.locale,
                });
                onSelectArticle(r.id);
              }}
              className="text-left w-full p-2 hover:bg-[var(--color-surface-elevated)] rounded-md"
            >
              {r.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
