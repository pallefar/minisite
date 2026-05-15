/**
 * Phase 15 Plan 15-05 — PreviewPane (D-04 / D-06).
 *
 * The center-column live preview of the page editor: embeds the real
 * `page-render` output via a same-origin, sandboxed, read-only <iframe> and
 * a desktop/tablet/mobile viewport toggle. Replaces the static placeholder
 * 15-04 shipped (see PageEditorView).
 *
 * Security posture (T-15-05-03):
 *   - sandbox is the minimal allowlist required to render the page:
 *     `allow-scripts allow-same-origin` only. NO popups, NO top-nav, NO
 *     forms, NO modals. The published page is JS-free (D-17), so
 *     allow-scripts is reserved for future plans that might inject inline JS
 *     for preview-only affordances.
 *   - `pointer-events: none` makes the preview read-only (D-04).
 *   - `src` is HARD-CONSTRUCTED from props.pageSlug as `/{slug}?preview=true`
 *     — same-origin only, never accepts an externally-supplied URL.
 */
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

export interface PreviewPaneProps {
  /** Slug of the page being edited — used to construct the iframe src. */
  pageSlug: string;
}

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

const VIEWPORT_LABELS: Record<Viewport, string> = {
  desktop: 'Desktop preview',
  tablet: 'Tablet preview',
  mobile: 'Mobile preview',
};

export function PreviewPane({ pageSlug }: PreviewPaneProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [loaded, setLoaded] = useState(false);

  // Same-origin construction — pageSlug comes from the editor's own state,
  // never from an externally-supplied URL (T-15-05-03).
  const src = `/${pageSlug}?preview=true`;
  const width = VIEWPORT_WIDTHS[viewport];

  const handleViewportChange = (next: Viewport): void => {
    setViewport(next);
    // Reset the loaded flag on viewport change so the skeleton briefly
    // re-appears while the iframe reflows. This is intentional — the
    // visible reflow is the affordance.
    setLoaded(false);
  };

  return (
    <Card variant="elevated" padding="none" className="h-full overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
        <Button
          variant={viewport === 'desktop' ? 'tonal' : 'ghost'}
          size="sm"
          aria-label={VIEWPORT_LABELS.desktop}
          aria-pressed={viewport === 'desktop'}
          onClick={() => handleViewportChange('desktop')}
          data-testid="viewport-desktop"
        >
          <Monitor aria-hidden className="size-4" />
        </Button>
        <Button
          variant={viewport === 'tablet' ? 'tonal' : 'ghost'}
          size="sm"
          aria-label={VIEWPORT_LABELS.tablet}
          aria-pressed={viewport === 'tablet'}
          onClick={() => handleViewportChange('tablet')}
          data-testid="viewport-tablet"
        >
          <Tablet aria-hidden className="size-4" />
        </Button>
        <Button
          variant={viewport === 'mobile' ? 'tonal' : 'ghost'}
          size="sm"
          aria-label={VIEWPORT_LABELS.mobile}
          aria-pressed={viewport === 'mobile'}
          onClick={() => handleViewportChange('mobile')}
          data-testid="viewport-mobile"
        >
          <Smartphone aria-hidden className="size-4" />
        </Button>
      </div>

      {/* Iframe wrapper */}
      <div className="flex-1 overflow-auto flex items-start justify-center bg-[var(--color-surface-elevated)] p-4">
        <div
          data-testid="preview-iframe-wrapper"
          className="relative bg-[var(--color-bg)] shadow-[var(--shadow-xs)]"
          style={{ width, maxWidth: width, minHeight: '100%' }}
        >
          {!loaded && (
            <div
              data-testid="preview-skeleton"
              aria-hidden
              className="absolute inset-0"
            >
              <Skeleton className="w-full h-full" />
            </div>
          )}
          <iframe
            title={`Live preview of ${pageSlug}`}
            src={src}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setLoaded(true)}
            className="w-full h-full min-h-[400px] block border-0"
            style={{ pointerEvents: 'none' }}
          />
        </div>
      </div>
    </Card>
  );
}
