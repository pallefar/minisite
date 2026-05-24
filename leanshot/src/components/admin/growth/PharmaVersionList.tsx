/**
 * Phase 39 Plan 39-08 — PharmaVersionList.
 *
 * Audit-history table for pharma_content edits, rendered inside the Pharma
 * sub-tab of ExperimentDashboardPage (Surface G). One row per
 * PharmaContentVersion entry. Sorted descending by created_at.
 *
 * Columns (UI-SPEC lines 199-203):
 *   - "Pharma content versions" header
 *   - "Author"  | "Clinical review"
 *   - Pending sign-off → warning badge
 *   - Reviewed by {clinician} → success badge
 *
 * Accent policy: only Badge tones 'warning' + 'success' for sign-off — no teal
 * accent on the audit surface (UI-SPEC line 132).
 *
 * Decision references: D-05 + D-06 (regulator-visible audit trail), PHARMA-07.
 */
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { formatShort } from '@/lib/helpers';

export interface PharmaContentVersion {
  id: string;
  content_id: string;
  diff: Record<string, unknown>;
  author_id: string;
  author_name: string;
  clinical_signoff_by: string | null;
  clinical_signoff_at: string | null;
  /** Display name (joined in RPC); T-39-08-06 keeps raw user_id off the UI. */
  clinical_signoff_name: string | null;
  created_at: string;
}

export interface PharmaVersionListProps {
  contentId: string;
  versions: PharmaContentVersion[];
}

export function PharmaVersionList({
  versions,
}: PharmaVersionListProps): React.JSX.Element {
  const sorted = [...versions].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  return (
    <Card variant="flat" padding="md">
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-bold">Pharma content versions</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No versions yet for this content item.
          </p>
        ) : (
          <div role="table" aria-label="Pharma content versions" className="flex flex-col gap-1">
            <div
              role="row"
              className="grid grid-cols-[2fr_2fr_1fr] gap-3 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              <span role="columnheader">Author</span>
              <span role="columnheader">Clinical review</span>
              <span role="columnheader" className="text-right">
                Edited
              </span>
            </div>
            {sorted.map((v) => (
              <div
                key={v.id}
                role="row"
                data-row="pharma-version"
                className="grid grid-cols-[2fr_2fr_1fr] gap-3 px-2 py-2 items-center border-t border-[var(--color-border)] text-sm"
              >
                <span role="cell" className="font-bold">
                  {v.author_name}
                </span>
                <span role="cell">
                  {v.clinical_signoff_at && v.clinical_signoff_name ? (
                    <Badge tone="success">
                      Reviewed by {v.clinical_signoff_name}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Pending sign-off</Badge>
                  )}
                </span>
                <span
                  role="cell"
                  className="text-right tabular-nums text-[var(--color-text-secondary)]"
                >
                  {formatShort(v.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default PharmaVersionList;
