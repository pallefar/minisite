/**
 * KBArticleView — Phase 37 Plan 06 Task 2 (HELP-07) + Phase 41 Plan 41-05 (EMBED-06).
 *
 * Loads a KB article by id and renders Markdown via react-markdown + remarkGfm
 * + rehypeRaw. The article body is sanitized with DOMPurify BEFORE handing it
 * to ReactMarkdown (T-37-06-01 mitigation — `<script>` and other unsafe tags
 * are stripped at the trust boundary).
 *
 * Phase 41 (EMBED-06): the dompurify config preserves the custom `<embed-block>`
 * tag with a TIGHT attribute allowlist (only type/data-url/data-id/data-allow —
 * no event handlers, no style — defends T-41-05-04). The ReactMarkdown
 * `components` prop maps the custom tag to the matching React block component
 * by `type` attribute, synthesizing a BlockNode payload from data-url so each
 * provider's existing renderer (Calendly/YouTube/Tally/CustomIframe) handles
 * consent-gating via the Plan 41-05 ConsentGatedEmbed HOC.
 *
 * Lazy-loaded by HelpdeskWidget.tsx — react-markdown + remark-gfm + rehype-raw
 * + dompurify live in this sub-chunk, NOT the helpdesk-widget root chunk.
 */
import DOMPurify from 'dompurify';
import { useEffect, useState, type JSX } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { CalendlyBlock } from '@/components/admin/pages/blocks/CalendlyBlock';
import { CustomIframeBlock } from '@/components/admin/pages/blocks/CustomIframeBlock';
import { TallyBlock } from '@/components/admin/pages/blocks/TallyBlock';
import { YouTubeBlock } from '@/components/admin/pages/blocks/YouTubeBlock';
import { Button } from '@/components/ui/Button';
import type { BlockNode } from '@/lib/page-builder/block-schema';
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

/**
 * Synthesize a BlockNode from an `<embed-block type=... data-url=...>` tag.
 * v1.3 (per RESEARCH Open Question 3): hand-written marker; rich-text drop-in
 * deferred to v1.4. The renderer doesn't read `data-id` in v1.3 — only
 * `data-url` is consumed by the per-provider Block component's content shape.
 */
function buildBlockFromEmbedAttrs(type: string, dataUrl: string | undefined): BlockNode {
  // Map type → the per-provider URL field name. Each block already has its
  // own content shape (calendlyUrl / videoId / tallyFormUrl / embedUrl).
  let content: Record<string, unknown> = {};
  switch (type) {
    case 'calendly':
      content = { calendlyUrl: dataUrl ?? '', prefillEmail: false };
      break;
    case 'youtube':
      // YouTube content shape uses videoId, not full URL. KB authors write
      // the embed-form URL (https://www.youtube.com/embed/<id>) — extract the id.
      content = { videoId: extractYouTubeId(dataUrl ?? ''), startSeconds: 0, autoplay: false };
      break;
    case 'tally':
      content = { tallyFormUrl: dataUrl ?? '', hideTitle: false };
      break;
    case 'custom_iframe':
      content = { embedUrl: dataUrl ?? '', iframeTitle: '', widthMode: true };
      break;
  }
  return {
    id: `kb-embed-${type}`,
    type: type as BlockNode['type'],
    parent_id: null,
    order: 0,
    content,
    style: {},
  };
}

function extractYouTubeId(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    // youtube.com/embed/<id> or youtube.com/watch?v=<id>
    const m = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{1,20})/);
    if (m) return m[1];
    const v = parsed.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{1,20}$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  return '';
}

export default function KBArticleView({ articleId, onBack }: KBArticleViewProps): JSX.Element {
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
  // Trust-boundary sanitization (T-37-06-01 + T-41-05-04). `USE_PROFILES.html`
  // keeps safe HTML; ADD_TAGS preserves the Phase 41 `<embed-block>` marker
  // with a TIGHT 4-attribute allowlist (no event handlers, no style).
  const sanitized = DOMPurify.sanitize(body, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['embed-block'],
    ADD_ATTR: ['type', 'data-url', 'data-id', 'data-allow'],
  });

  const hasSpanish = Array.isArray(article.locale_set) && article.locale_set.includes('es');

  // ReactMarkdown components mapper — resolves the lowercase custom tag
  // `embed-block` to the matching React block component by `type` attribute.
  // The Plan 41-05 ConsentGatedEmbed HOC inside each block component handles
  // consent-gating automatically.
  const components: Components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ['embed-block' as any]: (props: Record<string, unknown>) => {
      const type = typeof props.type === 'string' ? props.type : '';
      const dataUrl =
        typeof props['data-url'] === 'string' ? (props['data-url'] as string) : undefined;
      const block = buildBlockFromEmbedAttrs(type, dataUrl);
      switch (type) {
        case 'calendly':
          return <CalendlyBlock block={block} />;
        case 'youtube':
          return <YouTubeBlock block={block} />;
        case 'tally':
          return <TallyBlock block={block} />;
        case 'custom_iframe':
          return <CustomIframeBlock block={block} />;
        default:
          return null;
      }
    },
  };

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
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {sanitized}
        </ReactMarkdown>
      </article>
    </div>
  );
}
