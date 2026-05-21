/**
 * KBArticleView — Phase 37 Plan 06 Task 2 (HELP-07).
 *
 * Loads a KB article by id and renders Markdown via react-markdown + remarkGfm
 * + rehypeRaw. The article body is sanitized with DOMPurify BEFORE handing it
 * to ReactMarkdown (T-37-06-01 mitigation — `<script>` and other unsafe tags
 * are stripped at the trust boundary).
 *
 * Lazy-loaded by HelpdeskWidget.tsx — react-markdown + remark-gfm + rehype-raw
 * + dompurify live in this sub-chunk, NOT the helpdesk-widget root chunk.
 */
import DOMPurify from 'dompurify';
import { useEffect, useState, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

type Article = {
  id: string;
  slug: string;
  title: string;
  body: string;
  title_es: string | null;
  body_es: string | null;
  locale_set: string[] | null;
};

export interface KBArticleViewProps {
  articleId: string;
  onBack: () => void;
}

export default function KBArticleView({
  articleId,
  onBack,
}: KBArticleViewProps): JSX.Element {
  const [article, setArticle] = useState<Article | null>(null);
  const [locale, setLocale] = useState<'en' | 'es'>('en');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('kb_articles')
        .select('id, slug, title, body, title_es, body_es, locale_set')
        .eq('id', articleId)
        .single();
      if (cancelled) return;
      setArticle((data ?? null) as Article | null);
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  if (!article) return <div className="p-4 text-sm">Loading article…</div>;

  const useEs = locale === 'es' && article.body_es != null;
  const title = useEs ? (article.title_es ?? article.title) : article.title;
  const body = useEs ? (article.body_es ?? article.body) : article.body;
  // Trust-boundary sanitization (T-37-06-01). `USE_PROFILES.html: true` keeps
  // safe HTML tags (lists, links, headings) while stripping scripts/iframes.
  const sanitized = DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });

  const hasSpanish =
    Array.isArray(article.locale_set) && article.locale_set.includes('es');

  return (
    <div className="flex flex-col gap-3 p-3">
      <Button onClick={onBack} variant="ghost" aria-label="Back to search">
        ← Back
      </Button>
      <h2 className="text-lg font-semibold">{title}</h2>
      {hasSpanish && (
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
            className="px-2 py-1 rounded-md border border-[var(--color-border)]"
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={locale === 'es'}
            onClick={() => setLocale('es')}
            className="px-2 py-1 rounded-md border border-[var(--color-border)]"
          >
            ES
          </button>
        </div>
      )}
      <article className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {sanitized}
        </ReactMarkdown>
      </article>
    </div>
  );
}
