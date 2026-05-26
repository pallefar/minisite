/**
 * Phase 60 Plan 60-13 — Reusable breadcrumb for /knowledge/* pages.
 *
 * Renders: Home › Knowledge › {topic_display_name} › {chunk_title}
 * Each segment except the last is a react-router <Link>.
 * Last segment is <span aria-current="page">.
 *
 * Also emits BreadcrumbList JSON-LD via <Helmet> for structured data.
 * UI-SPEC §8 header: 13px/400 text-text-secondary.
 */

import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { getTopicDisplayName } from '@/lib/knowledge/topics';

const CANONICAL_BASE = 'https://app.leanshot.app';

export interface KnowledgeBreadcrumbProps {
  /** topic slug, e.g. 'glp-1' */
  topic?: string;
  /** article slug, e.g. 'tirzepatide-fda-approval' (not used directly in rendering, but kept for future use) */
  slug?: string;
  /** human-readable chunk title for the last breadcrumb segment */
  chunkTitle?: string;
}

export function KnowledgeBreadcrumb({ topic, chunkTitle }: KnowledgeBreadcrumbProps) {
  const topicDisplayName = topic ? getTopicDisplayName(topic) : undefined;

  // Build breadcrumb items
  const items: Array<{ name: string; href: string | null }> = [
    { name: 'Home', href: 'https://app.leanshot.app' },
    { name: 'Knowledge', href: `${CANONICAL_BASE}/knowledge` },
  ];

  if (topic && topicDisplayName) {
    items.push({
      name: topicDisplayName,
      href: `${CANONICAL_BASE}/knowledge/${topic}`,
    });
  }

  if (chunkTitle) {
    items.push({ name: chunkTitle, href: null });
  }

  // JSON-LD BreadcrumbList
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.href ? { item: item.href } : {}),
    })),
  };

  return (
    <>
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      </Helmet>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1 list-none p-0 text-xs text-text-secondary flex-wrap">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            return (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-text-tertiary">›</span>}
                {isLast || !item.href ? (
                  <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-text font-normal truncate max-w-[200px]' : ''}>
                    {item.name}
                  </span>
                ) : (
                  /* For links within /knowledge, use react-router Link.
                     For the Home link (external), use a plain anchor. */
                  item.href.startsWith(CANONICAL_BASE + '/knowledge') ? (
                    <Link
                      to={item.href.replace(CANONICAL_BASE + '/knowledge', '') || '/'}
                      className="hover:underline hover:text-text"
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <a href={item.href} className="hover:underline hover:text-text">
                      {item.name}
                    </a>
                  )
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
