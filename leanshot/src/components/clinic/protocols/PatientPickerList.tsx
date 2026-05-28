/**
 * Phase 61 Plan 61-06 — PatientPickerList.
 *
 * Reusable patient picker for the AdoptProtocolSheet flow.
 * Queries the org's patient list via the rank_org_patients RPC
 * (same source of truth as RosterTable — returns user_id + display_name).
 *
 * Exposes an onSelect callback so AdoptProtocolSheet can advance to
 * the diff-modal step without closing the sheet.
 *
 * Typography ceiling: text-[11px] / text-[13px] / text-[18px] / text-heading
 * @theme tokens only — no undefined Tailwind v4 tokens.
 */

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

export interface Patient {
  id: string;
  name: string;
}

export interface PatientPickerListProps {
  orgId: string;
  selectedId?: string | null;
  onSelect: (patient: Patient) => void;
}

export function PatientPickerList({ orgId, selectedId, onSelect }: PatientPickerListProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      // Use rank_org_patients RPC — the established source of truth for
      // patients in an org (same as RosterTable). Returns user_id + display_name.
      const { data, error: rpcError } = await supabase.rpc('rank_org_patients', {
        p_org_id: orgId,
        p_sort_column: 'display_name',
        p_sort_direction: 'asc',
        p_offset: 0,
        p_limit: 200,
      });

      if (cancelled) return;

      if (rpcError) {
        setError('Failed to load patients. Try again.');
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as Array<{ user_id: string; display_name: string }>;
      setPatients(rows.map((r) => ({ id: r.user_id, name: r.display_name })));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[13px] text-[var(--color-danger)]" role="alert">
        {error}
      </p>
    );
  }

  if (patients.length === 0) {
    return (
      <EmptyState
        inline
        title="No patients"
        body="Invite patients to your clinic to assign protocols."
      />
    );
  }

  return (
    <ul role="listbox" aria-label="Select a patient" className="space-y-1">
      {patients.map((p) => {
        const isSelected = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`w-full text-start px-3 py-3 rounded-card text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                isSelected
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-semibold'
                  : 'text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]'
              }`}
              onClick={() => onSelect(p)}
            >
              {p.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
