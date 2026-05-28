/**
 * Phase 61 Plan 07 Task 2 — Protocol summary card for inline KB embedding.
 *
 * Renders inline within KB markdown via the [protocol:<uuid>] shortcode.
 * Reusable across admin + consumer surfaces (import crosses admin/consumer
 * boundary intentionally per PATTERNS.md "ProtocolSummaryCard is reusable across surfaces").
 *
 * Security: fetches only review_state='published' protocols (T-61-07-06 mitigation).
 * Unknown/draft UUIDs render 'Protocol unavailable' fallback — no spoofed content.
 *
 * Typography ceiling: 11/13/18/28px + 400/600 weights only.
 */

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

export interface ProtocolSummaryData {
  id: string;
  title: string;
  compound: string;
  week_count: number;
  slug: string; // base_slug for /protocols/<slug> link
}

export interface ProtocolSummaryCardProps {
  protocolId: string;
}

export function ProtocolSummaryCard({ protocolId }: ProtocolSummaryCardProps) {
  const [data, setData] = useState<ProtocolSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Fetch latest published version for this protocol id
      const { data: rows, error: fetchErr } = await supabase
        .from('protocols')
        .select('id, name, compound, base_slug, version')
        .eq('id', protocolId)
        .eq('review_state', 'published')
        .order('version', { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (fetchErr || !rows || rows.length === 0) {
        setError('Protocol unavailable');
        return;
      }

      const protocol = rows[0]!;

      // Count steps for this protocol version
      const { count } = await supabase
        .from('protocol_steps')
        .select('id', { count: 'exact', head: true })
        .eq('protocol_id', protocol.id)
        .eq('protocol_version', protocol.version);

      if (cancelled) return;

      setData({
        id: protocol.id as string,
        title: protocol.name as string,
        compound: protocol.compound as string,
        week_count: count ?? 0,
        slug: protocol.base_slug as string,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [protocolId]);

  // Error state
  if (error) {
    return (
      <Card variant="flat" padding="md" className="max-w-[480px] w-full">
        <p className="text-[13px] text-[var(--color-text-secondary)]">Protocol unavailable</p>
      </Card>
    );
  }

  // Loading skeleton
  if (!data) {
    return (
      <Card variant="flat" padding="md" className="max-w-[480px] w-full">
        <div
          className="h-12 animate-pulse bg-[var(--color-surface-elevated)] rounded"
          aria-label="Loading protocol"
        />
      </Card>
    );
  }

  return (
    <Card variant="flat" padding="md" className="max-w-[480px] w-full">
      <div className="space-y-1">
        <p className="text-[13px] font-semibold">{data.title}</p>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{data.compound}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge tone="neutral" aria-label={`${data.week_count} weeks`}>
            {data.week_count} weeks
          </Badge>
          <a
            href={`/protocols/${data.slug}`}
            className="text-[13px] text-[var(--color-primary)] hover:underline ms-auto"
          >
            View full protocol →
          </a>
        </div>
      </div>
    </Card>
  );
}
