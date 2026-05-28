/**
 * TipOfTheDayCard.tsx — Tip-of-the-Day Bento card for the HomeTab top-right slot.
 *
 * Phase 60 Plan 60-11 Task 5.
 *
 * Reads the current user's today row from `kb_tip_of_day` via Supabase RLS.
 * If a row exists, renders verbatim per UI-SPEC §6 Tip-of-Day Bento Card spec.
 * If no row, returns null (card slot collapses — UI-SPEC §6 D-24 empty-state rule).
 *
 * Typography ceiling (UI-SPEC §11): ONLY 11/13/18px tokens (text-micro/text-sm/text-lg).
 * Typography ceiling (UI-SPEC §11): only 11px/13px/18px tokens permitted.
 *
 * Server-side telemetry (ad-block immune per 50-08 pattern):
 *   rag_tip_impression  — on card mount (row found)
 *   rag_tip_clicked     — on "Open source ↗" link click
 *
 * Bundle posture: lazy-imported from HomeTab.tsx (no eager chunk widening).
 *
 * Fraunces is index/root-page-only — do NOT use here.
 */

import { ExternalLink, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TierBadge } from '@/components/admin/rag/TierBadge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface KbTipOfDayRow {
  id: string;
  chunk_id: string;
  headline: string;
  body: string;
  source_name: string;
  source_tier: 'A' | 'B' | 'C';
  evidence_date: string;
  canonical_url: string;
  topic_tag: string;
  topic_slug: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────────────

function formatDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────────
// Server-side telemetry relay (ad-block immune)
// ──────────────────────────────────────────────────────────────────────────────

function emitServerEvent(
  event: 'rag_tip_impression' | 'rag_tip_clicked',
  row: KbTipOfDayRow,
  userId: string,
): void {
  // Best-effort fire-and-forget (server-rag-event-relay from Phase 50-08)
  void supabase.functions.invoke('server-rag-event-relay', {
    body: {
      event,
      properties: {
        chunk_id: row.chunk_id,
        topic_tag: row.topic_tag,
        source_tier: row.source_tier,
        surface: 'home_bento',
      },
      distinct_id: userId,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function TipOfTheDayCard() {
  const [row, setRow] = useState<KbTipOfDayRow | null>(null);
  const [loading, setLoading] = useState(true);
  const reducedMotion = useReducedMotion();

  // User id from store (may be null before onboarding)
  const userId = useStore((s) => (s.user as { id?: string } | null)?.id ?? null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const today = formatDateUtc(new Date());

    void supabase
      .from('kb_tip_of_day')
      .select(
        'id, chunk_id, headline, body, source_name, source_tier, evidence_date, canonical_url, topic_tag, topic_slug',
      )
      .eq('user_id', userId)
      .eq('date_utc', today)
      .maybeSingle()
      .then(({ data }) => {
        setRow(data as KbTipOfDayRow | null);
        setLoading(false);

        if (data) {
          emitServerEvent('rag_tip_impression', data as KbTipOfDayRow, userId);
        }
      });
  }, [userId]);

  // Loading state — skeleton (shimmer gated by reduced-motion)
  if (loading) {
    return (
      <Card variant="elevated" span={4} data-testid="tip-of-day-skeleton">
        <Skeleton className={`h-28 w-full ${reducedMotion ? '' : 'animate-pulse'}`} />
      </Card>
    );
  }

  // Empty state — collapse slot (UI-SPEC §6 D-24)
  if (!row) return null;

  const handleOpenSourceClick = () => {
    emitServerEvent('rag_tip_clicked', row, userId ?? '');
  };

  return (
    <Card variant="elevated" span={4} data-testid="tip-of-day-card">
      {/* Eyebrow row */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-tertiary)] font-normal">
          TIP OF THE DAY
        </span>
        <span className="inline-flex items-center rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
          {row.topic_tag}
        </span>
        <button
          type="button"
          aria-label="Show another tip"
          aria-disabled="true"
          disabled
          className="ms-auto opacity-40 cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4 text-[var(--color-text-tertiary)]" aria-hidden />
        </button>
      </div>

      {/* Headline */}
      <h3 className="text-lg font-semibold leading-snug line-clamp-2 mb-2 text-[var(--color-text)]">
        {row.headline}
      </h3>

      {/* Body */}
      <p className="text-[13px] text-[var(--color-text-secondary)] line-clamp-3 mb-4 leading-relaxed">
        {row.body}
      </p>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-1">
          {row.source_name} · As of {row.evidence_date} · <TierBadge tier={row.source_tier} />
        </span>
        <a
          href={`/knowledge/${row.topic_tag}/${row.topic_slug}`}
          className="text-[13px] text-[var(--color-primary)] inline-flex items-center gap-1 hover:underline shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
          onClick={handleOpenSourceClick}
        >
          Open source <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      </div>

      {/* Disclaimer (UI-SPEC §6 — verbatim) */}
      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3">
        Not medical advice — consult your clinician.
      </p>
    </Card>
  );
}

export default TipOfTheDayCard;
