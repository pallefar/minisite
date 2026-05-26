/**
 * Phase 61 Plan 61-06 — ClinicProtocolsPage.
 *
 * Clinician-facing published-protocol list. Filters to review_state='published'
 * and supports compound + audience filter pills. Per-row 'Adopt for patient'
 * button opens AdoptProtocolSheet.
 *
 * Analog: src/components/admin/protocols/ProtocolsListPage.tsx (minus admin
 * actions). Empty state per UI-SPEC §Surface 4.
 *
 * Typography ceiling: text-[11px] / text-[13px] / text-[18px] / text-heading
 * @theme tokens only — no undefined Tailwind v4 tokens.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { AdoptProtocolSheet } from './AdoptProtocolSheet';

export interface PublishedProtocol {
  id: string;
  version: number;
  name: string;
  compound: string;
  audience: string;
  slug: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface ClinicProtocolsPageProps {
  orgId: string;
}

const COMPOUND_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'tirzepatide', label: 'Tirzepatide' },
  { key: 'retatrutide', label: 'Retatrutide' },
  { key: 'semaglutide', label: 'Semaglutide' },
  { key: 'ghrp-2', label: 'GHRP-2' },
  { key: 'other', label: 'Other' },
] as const;

const AUDIENCE_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'B2C', label: 'B2C' },
] as const;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function ClinicProtocolsPage({ orgId: _orgId }: ClinicProtocolsPageProps) {
  const [protocols, setProtocols] = useState<PublishedProtocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compoundFilter, setCompoundFilter] = useState<string>('all');
  const [audienceFilter, setAudienceFilter] = useState<string>('all');
  const [adoptSheetProtocol, setAdoptSheetProtocol] = useState<PublishedProtocol | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const { data, error: fetchError } = await supabase
        .from('protocols')
        .select('id, version, name, compound, audience, slug, updated_at, published_at')
        .eq('review_state', 'published')
        .order('updated_at', { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        setError('Failed to load protocols. Try refreshing.');
        setLoading(false);
        return;
      }

      // Dedupe by id — keep highest version per protocol base
      const seen = new Map<string, PublishedProtocol>();
      for (const row of (data ?? []) as PublishedProtocol[]) {
        const existing = seen.get(row.id);
        if (!existing || row.version > existing.version) {
          seen.set(row.id, row);
        }
      }

      if (!cancelled) {
        setProtocols([...seen.values()]);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = protocols.filter((p) => {
    const compoundMatch = compoundFilter === 'all' || p.compound === compoundFilter;
    const audienceMatch = audienceFilter === 'all' || p.audience === audienceFilter;
    return compoundMatch && audienceMatch;
  });

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <header className="space-y-1">
        <h1 className="text-heading font-semibold text-[var(--color-text)]">Protocols</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Published protocols you can adopt for your patients.
        </p>
      </header>

      {/* Filter pills */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
          Compound
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {COMPOUND_PILLS.map((fp) => (
            <Pill
              key={fp.key}
              size="sm"
              active={compoundFilter === fp.key}
              onClick={() => setCompoundFilter(fp.key)}
            >
              {fp.label}
            </Pill>
          ))}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)] mt-3">
          Audience
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {AUDIENCE_PILLS.map((fp) => (
            <Pill
              key={fp.key}
              size="sm"
              active={audienceFilter === fp.key}
              onClick={() => setAudienceFilter(fp.key)}
            >
              {fp.label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading protocols">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-[13px] text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          inline
          title="No published protocols"
          body="Protocols appear here once approved by two admins."
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          className="rounded-card border border-[var(--color-border)] overflow-hidden"
          role="table"
          aria-label="Published protocols"
        >
          {/* Table header */}
          <div
            role="row"
            className="hidden md:grid grid-cols-[1fr_140px_100px_80px_130px_160px] gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
          >
            {['Name', 'Compound', 'Audience', 'Version', 'Last Updated', ''].map((h) => (
              <span key={h} role="columnheader" className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-text-tertiary)]">
                {h}
              </span>
            ))}
          </div>

          {/* Table rows */}
          {filtered.map((protocol) => (
            <div
              key={`${protocol.id}-${protocol.version}`}
              role="row"
              className="grid grid-cols-1 md:grid-cols-[1fr_140px_100px_80px_130px_160px] gap-2 md:gap-3 items-center px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-elevated)] transition-colors"
            >
              <span role="cell" className="text-[13px] text-[var(--color-text)] font-semibold">
                {protocol.name}
              </span>
              <span role="cell" className="text-[13px] text-[var(--color-text-secondary)] capitalize">
                {protocol.compound}
              </span>
              <span role="cell" className="text-[13px] text-[var(--color-text-secondary)]">
                {protocol.audience}
              </span>
              <span role="cell" className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                v{protocol.version}
              </span>
              <span role="cell" className="text-[11px] text-[var(--color-text-secondary)]">
                {formatDate(protocol.updated_at)}
              </span>
              <div role="cell">
                <Button
                  variant="primary"
                  size="md"
                  className="min-h-[44px] w-full md:w-auto"
                  onClick={() => setAdoptSheetProtocol(protocol)}
                >
                  Adopt for patient
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Adopt protocol sheet */}
      <AdoptProtocolSheet
        open={!!adoptSheetProtocol}
        onClose={() => setAdoptSheetProtocol(null)}
        orgId={_orgId}
        protocol={adoptSheetProtocol}
      />
    </div>
  );
}
