/**
 * Phase 42 Plan 42-09 — "What's New" drawer (POLISH-11 UI half).
 *
 * Lazy-loaded from App.tsx so this entire module (react-markdown +
 * dompurify + rehype-raw) stays OFF the index static graph — see Pitfall
 * 9 + 42-CONTEXT D-11. Topbar emits an open-callback only; the drawer
 * itself owns the Sheet primitive + entry list + Got-it CTA.
 *
 * Markdown rendering:
 *   - react-markdown@9 parses the body_md.
 *   - rehype-raw@7 lets us mix HTML into markdown (admin curated content).
 *   - dompurify@3 then sanitises the resulting HTML string through a
 *     custom `urlTransform` + `components.html` hook — script tags, on*
 *     handlers, and `javascript:` / `data:text/html` URLs are stripped.
 *
 * The dompurify pass runs at RENDER time so a malicious body_md row in
 * `changelog_entries` cannot produce active content in any user's DOM.
 * (Backend RLS only lets admins INSERT — but defense-in-depth still costs
 * 1 import.)
 *
 * Accessibility: the underlying Sheet wraps everything in role="dialog"
 * + aria-modal="true". Each entry is rendered inside `<article>` with an
 * `<h3>` heading and a `<time dateTime={iso}>` element so screen readers
 * can navigate by headings and announce the relative date naturally.
 */
import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useChangelog } from '@/lib/changelog/changelog-store';
import type { ChangelogEntry } from '@/lib/changelog/drawer-trigger';

interface WhatsNewDrawerProps {
  open: boolean;
  entries: readonly ChangelogEntry[];
  onClose: () => void;
  markRead: () => Promise<void>;
}

/**
 * One sanitised markdown body. Wrapped in a memo so we don't re-parse on
 * every parent re-render (lists of ~3-20 entries × ReactMarkdown is cheap
 * but the dompurify pass is the most expensive thing per article).
 */
export function SafeMarkdown({ source }: { source: string }) {
  const sanitised = useMemo(() => {
    // We DOMPurify the RAW markdown so any inline HTML the admin pastes
    // into body_md gets stripped of script / on* / javascript: URIs BEFORE
    // react-markdown sees it. react-markdown + rehype-raw then renders the
    // already-safe string. Belt + suspenders.
    return DOMPurify.sanitize(source, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    });
  }, [source]);
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw]}
      urlTransform={(url) => {
        // Block javascript: / data:text/html / vbscript: URLs at link level.
        const lower = url.trim().toLowerCase();
        if (
          lower.startsWith('javascript:') ||
          lower.startsWith('vbscript:') ||
          lower.startsWith('data:text/html')
        ) {
          return '#';
        }
        return url;
      }}
    >
      {sanitised}
    </ReactMarkdown>
  );
}

function formatPublishedDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function WhatsNewDrawer({ open, entries, onClose, markRead }: WhatsNewDrawerProps) {
  const handleGotIt = async (): Promise<void> => {
    await markRead();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="What's new">
      {entries.length === 0 ? (
        <p className="text-[14px] text-[var(--color-text-secondary)] py-4">
          No updates yet — check back after the next release.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="border-b border-[var(--color-border)] pb-4 last:border-b-0 last:pb-0"
              aria-labelledby={`changelog-${entry.id}-title`}
            >
              <header className="mb-2">
                <time
                  dateTime={entry.published_at}
                  className="text-[12px] uppercase tracking-wide text-[var(--color-text-tertiary)]"
                >
                  {formatPublishedDate(entry.published_at)}
                </time>
                <h3
                  id={`changelog-${entry.id}-title`}
                  className="text-[16px] font-semibold tracking-tight mt-0.5"
                >
                  {entry.title}
                </h3>
              </header>
              <div className="prose prose-sm max-w-none text-[14px] leading-relaxed text-[var(--color-text)] [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_a]:text-[var(--color-primary)] [&_a]:underline">
                <SafeMarkdown source={entry.body_md} />
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <Button onClick={() => void handleGotIt()} size="sm">
          Got it
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Host wrapper that wires the standalone WhatsNewDrawer (which takes
 * entries+markRead as props for pure testability) to the live useChangelog
 * hook. App.tsx mounts this so the entire react-markdown + dompurify chunk
 * — including the live data wiring — stays off the index static graph.
 */
export function WhatsNewDrawerHost({ onClose }: { onClose: () => void }) {
  const { entries, markRead } = useChangelog();
  return <WhatsNewDrawer open entries={entries} onClose={onClose} markRead={markRead} />;
}

export default WhatsNewDrawer;
