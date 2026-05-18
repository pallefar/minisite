/**
 * Phase 22 Plan 22-06 — Members table filter bar (ADMIN-01).
 *
 * Segmented Pill group (All / Free / Paid / Clinic / Past due / Canceled) +
 * debounced search Input. Country filter and date-range picker are deferred
 * to v1.3 (per CONTEXT D-04 v1.2 scope cap).
 *
 * UI-SPEC §/admin/members line 239 contract.
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import type { MemberTier } from '@/lib/admin/admin-api';

export type TierFilterValue = MemberTier | 'all';

interface TierFilterOption {
  key: TierFilterValue;
  label: string;
}

const TIER_FILTERS: TierFilterOption[] = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free' },
  { key: 'paid', label: 'Paid' },
  { key: 'clinic_seat', label: 'Clinic' },
  { key: 'past_due', label: 'Past due' },
];

export interface MembersFilterBarProps {
  tier: TierFilterValue;
  onTierChange: (next: TierFilterValue) => void;
  search: string;
  onSearchChange: (next: string) => void;
  /** Debounce ms; defaults to 300 (UI-SPEC §/admin/members). */
  debounceMs?: number;
}

export function MembersFilterBar({
  tier,
  onTierChange,
  search,
  onSearchChange,
  debounceMs = 300,
}: MembersFilterBarProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external `search` resets back into local state (e.g. "Clear filters").
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (localSearch === search) return;
    timer.current = setTimeout(() => {
      onSearchChange(localSearch);
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // localSearch is the only true input; `search` is kept out of deps so a
    // parent-driven reset doesn't immediately re-fire the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch, debounceMs]);

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
      <PillGroup segmented aria-label="Filter members by tier">
        {TIER_FILTERS.map((f) => (
          <Pill
            key={f.key}
            size="sm"
            active={tier === f.key}
            onClick={() => onTierChange(f.key)}
            role="tab"
            aria-selected={tier === f.key}
            data-tier-pill={f.key}
          >
            {f.label}
          </Pill>
        ))}
      </PillGroup>
      <div className="md:ms-auto md:w-[280px]">
        <Input
          type="search"
          aria-label="Search by email or name"
          placeholder="Search by email or name"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
      </div>
    </div>
  );
}
