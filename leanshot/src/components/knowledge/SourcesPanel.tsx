/**
 * Phase 60 Plan 60-13 — Source citation panel for article detail pages.
 *
 * UI-SPEC §8 body (right rail on lg+, collapsed accordion on mobile):
 *  - Source name linked to canonical_url
 *  - KnowledgeTierBadge (neutral-only per invariant 6)
 *  - Freshness strip (invariant 7):
 *      >2yr ago → "May be outdated" warning Pill
 *      6mo-2yr → "Last reviewed YYYY-MM"
 *      <6mo → no badge
 *  - leanshot_research amber-soft disclosure (invariant 8)
 *  - "Read at source ↗" ghost button
 *  - t('rag.disclaimer') line (11px/400 text-text-tertiary)
 *
 * a11y: aria-label="Source citation" on the panel element.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KnowledgeTierBadge, LeanShotResearchDisclosure } from './KnowledgeTierBadge';

export interface SourcesPanelProps {
  source: {
    id: string;
    name: string;
    source_type: string;
    canonical_url?: string;
  };
  tier: 'A' | 'B' | 'C';
  reviewedAt?: string | null;
  publishedAt?: string | null;
  canonicalUrl: string;
}

function getFreshnessLabel(
  reviewedAt: string | null | undefined,
): { label: string; tone: 'warning' | 'neutral' | 'none' } {
  if (!reviewedAt) return { label: '', tone: 'none' };
  const now = Date.now();
  const reviewed = new Date(reviewedAt).getTime();
  const ageMs = now - reviewed;
  const twoYearsMs = 2 * 365.25 * 24 * 60 * 60 * 1000;
  const sixMonthsMs = 6 * 30.5 * 24 * 60 * 60 * 1000;

  if (ageMs > twoYearsMs) {
    return { label: 'May be outdated', tone: 'warning' };
  }
  if (ageMs > sixMonthsMs) {
    const d = new Date(reviewedAt);
    const label = `Last reviewed ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { label, tone: 'neutral' };
  }
  return { label: '', tone: 'none' };
}

export function SourcesPanel({
  source,
  tier,
  reviewedAt,
  canonicalUrl,
}: SourcesPanelProps) {
  const { t } = useTranslation('rag');
  const [mobileOpen, setMobileOpen] = useState(false);
  const freshness = getFreshnessLabel(reviewedAt);

  const content = (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        Source
      </div>

      <a
        href={canonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-semibold text-text-primary hover:underline block"
        aria-label={`Source: ${source.name}`}
      >
        {source.name}
      </a>

      <div className="flex flex-wrap gap-2 items-center">
        <KnowledgeTierBadge tier={tier} sourceType={source.source_type} />
        {source.source_type === 'leanshot_research' && <LeanShotResearchDisclosure />}
      </div>

      {freshness.tone !== 'none' && (
        <div
          className={[
            'text-xs px-2 py-1 rounded-pill inline-block',
            freshness.tone === 'warning'
              ? 'bg-warning-subtle text-warning-foreground'
              : 'text-text-secondary',
          ].join(' ')}
          role={freshness.tone === 'warning' ? 'alert' : undefined}
        >
          {freshness.label}
        </div>
      )}

      <a
        href={canonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-accent hover:underline block"
        aria-label={`Read full article at ${source.name}`}
      >
        Read at source ↗
      </a>

      <p className="text-xs text-text-tertiary leading-relaxed">
        {t('disclaimer')}
      </p>
    </div>
  );

  return (
    <aside aria-label="Source citation" className="text-sm">
      {/* Mobile accordion */}
      <div className="lg:hidden border border-border-subtle rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          className="w-full flex items-center justify-between p-4 text-sm font-semibold text-text-primary"
        >
          Source
          <span aria-hidden="true" className={mobileOpen ? 'rotate-180 transition-transform' : 'transition-transform'}>
            ▾
          </span>
        </button>
        {mobileOpen && <div className="px-4 pb-4">{content}</div>}
      </div>

      {/* Desktop: always visible */}
      <div className="hidden lg:block">{content}</div>
    </aside>
  );
}
