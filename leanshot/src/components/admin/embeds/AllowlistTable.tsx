/**
 * Phase 41 Plan 41-06 — AllowlistTable.
 *
 * Real <table>/<thead>/<tbody> semantics per UI-SPEC §Accessibility (NOT
 * divs). Column-headers `scope='col'`; hostname cells `scope='row'`.
 *
 * 6 columns per UI-SPEC §Surface E:
 *   1. Hostname (font-mono + copy-to-clipboard icon button)
 *   2. Added by (avatar + email)
 *   3. Added (relative timestamp)
 *   4. Last used (relative or "Never")
 *   5. References (Badge — "Unused" green or "[N] page[s]" amber, opens Sheet)
 *   6. Actions (Trash2 icon button, opens RemoveHostnameConfirm)
 *
 * Sort: Added desc default; column-click toggles. Touch target ≥44×44.
 */
import { Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import type { AllowlistRow } from '@/lib/admin/iframe-allowlist';

type SortKey = 'hostname' | 'added_at' | 'last_used_at';
type SortDir = 'asc' | 'desc';

export interface AllowlistTableRow extends AllowlistRow {
  /** Email of the adder, joined client-side from a separate profiles query if available. */
  added_by_email?: string | null;
  /**
   * Binary in-use proxy until v1.4 ships a full JSONB scan over
   * `landing_page_revisions.blocks`. Derived from `last_used_at IS NOT NULL`.
   * Previously a fake numeric `reference_count` was synthesized, but the
   * table column always read 0 or 1 and rendered "1 page" even when 50
   * pages embedded the hostname (WR-04 in 41-REVIEW.md).
   */
  in_use?: boolean;
}

export interface AllowlistTableProps {
  rows: ReadonlyArray<AllowlistTableRow>;
  onRequestRemove: (row: AllowlistTableRow) => void;
  onOpenReferences: (hostname: string) => void;
}

function relativeTime(iso: string | null): string {
  if (iso === null) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function AllowlistTable({ rows, onRequestRemove, onOpenReferences }: AllowlistTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('added_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'hostname' ? 'asc' : 'desc');
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: string | null;
      let bv: string | null;
      if (sortKey === 'hostname') {
        av = a.hostname;
        bv = b.hostname;
      } else if (sortKey === 'added_at') {
        av = a.added_at;
        bv = b.added_at;
      } else {
        av = a.last_used_at;
        bv = b.last_used_at;
      }
      // Nulls sort last regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function sortIcon(key: SortKey): React.ReactNode {
    if (key !== sortKey) return null;
    // WR-06 + IN-04 fix: drop align-text-bottom — the parent button is
    // inline-flex items-center, so the chevron baseline matches the label
    // automatically and the announce contract aligns with WCAG aria-sort.
    return sortDir === 'asc' ? (
      <ChevronUp size={14} aria-hidden className="ms-1 text-[var(--color-text-tertiary)]" />
    ) : (
      <ChevronDown size={14} aria-hidden className="ms-1 text-[var(--color-text-tertiary)]" />
    );
  }

  // WR-06 helpers — aria-sort value + button aria-label per column.
  function ariaSortFor(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }
  function sortButtonLabel(label: string, key: SortKey): string {
    const dir = sortKey === key ? sortDir : 'unsorted';
    return `Sort by ${label}, currently ${dir}`;
  }

  async function copyHostname(hostname: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(hostname);
    } catch {
      // Silent fallback — clipboard not available; copy affordance is non-critical.
    }
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-left text-[14px]">
        <thead className="bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]">
          <tr>
            <th
              scope="col"
              aria-sort={ariaSortFor('hostname')}
              className="px-4 py-3 font-semibold"
            >
              <button
                type="button"
                onClick={() => toggleSort('hostname')}
                aria-label={sortButtonLabel('hostname', 'hostname')}
                className="inline-flex items-center hover:text-[var(--color-text)]"
              >
                Hostname
                {sortIcon('hostname')}
              </button>
            </th>
            <th scope="col" className="px-4 py-3 font-semibold w-[160px]">
              Added by
            </th>
            <th
              scope="col"
              aria-sort={ariaSortFor('added_at')}
              className="px-4 py-3 font-semibold w-[140px]"
            >
              <button
                type="button"
                onClick={() => toggleSort('added_at')}
                aria-label={sortButtonLabel('added date', 'added_at')}
                className="inline-flex items-center hover:text-[var(--color-text)]"
              >
                Added
                {sortIcon('added_at')}
              </button>
            </th>
            <th
              scope="col"
              aria-sort={ariaSortFor('last_used_at')}
              className="px-4 py-3 font-semibold w-[140px]"
            >
              <button
                type="button"
                onClick={() => toggleSort('last_used_at')}
                aria-label={sortButtonLabel('last used', 'last_used_at')}
                className="inline-flex items-center hover:text-[var(--color-text)]"
              >
                Last used
                {sortIcon('last_used_at')}
              </button>
            </th>
            <th scope="col" className="px-4 py-3 font-semibold w-[110px]">
              References
            </th>
            <th scope="col" className="px-4 py-3 font-semibold w-[80px]">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {sorted.map((row) => {
            // WR-04 fix: binary "in use" derived from last_used_at — no fake
            // numeric count. ReferencesSheet acknowledges the v1.4 deferral
            // ("Reference scanning ships in v1.4"); the table now matches.
            const inUse = row.in_use ?? row.last_used_at !== null;
            const unused = !inUse;
            return (
              <tr key={row.id} className="bg-[var(--color-surface)]">
                <th scope="row" className="px-4 py-3 font-mono text-[13px] font-normal text-[var(--color-text)]">
                  <span className="inline-flex items-center gap-2">
                    {row.hostname}
                    <IconButton
                      aria-label={`Copy ${row.hostname}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyHostname(row.hostname)}
                    >
                      <Copy size={16} aria-hidden />
                    </IconButton>
                  </span>
                </th>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                  <span className="inline-flex items-center gap-2">
                    <InitialsAvatar name={row.added_by_email ?? '—'} size="sm" />
                    <span className="text-[13px]">{row.added_by_email ?? '—'}</span>
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">
                  <span title={row.added_at}>{relativeTime(row.added_at)}</span>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.last_used_at === null ? (
                    <span className="italic text-[var(--color-text-tertiary)]">Never</span>
                  ) : (
                    <span title={row.last_used_at} className="text-[var(--color-text-secondary)]">
                      {relativeTime(row.last_used_at)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenReferences(row.hostname)}
                    aria-label={`View references for ${row.hostname}, currently ${unused ? 'unused' : 'in use'}`}
                    className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-pill"
                  >
                    <Badge tone={unused ? 'success' : 'warning'}>
                      {unused ? 'Unused' : 'In use'}
                    </Badge>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <IconButton
                    aria-label={`Remove ${row.hostname}`}
                    variant="ghost"
                    size="md"
                    onClick={() => onRequestRemove(row)}
                  >
                    <Trash2 size={20} aria-hidden className="text-[var(--color-danger)]" />
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
