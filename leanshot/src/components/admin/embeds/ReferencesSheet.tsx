/**
 * Phase 41 Plan 41-06 — ReferencesSheet.
 *
 * Lists pages referencing a given allowlist hostname. For v1.3, the live
 * reference-count source (a JSONB scan over landing_page_revisions.blocks)
 * is deferred — per Plan 41-06 §Step F + RESEARCH Open Question 4.
 *
 * The Sheet renders an informational caption explaining the v1.4 ship plan,
 * which is the acceptable scope per UI-SPEC §Surface E. The badge in the
 * parent table uses `last_used_at IS NULL` as the "Unused" signal until full
 * reference scanning lands in v1.4.
 */
import { Sheet } from '@/components/ui/Sheet';

export interface ReferencesSheetProps {
  open: boolean;
  hostname: string;
  onClose: () => void;
}

export function ReferencesSheet({ open, hostname, onClose }: ReferencesSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={`Pages referencing ${hostname}`}>
      <div className="space-y-3 pt-1">
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Reference scanning ships in v1.4; remove with caution if last-used
          timestamp is recent.
        </p>
        <p className="text-[13px] text-[var(--color-text-tertiary)] leading-relaxed">
          Until then, the &lsquo;References&rsquo; badge in the table reflects the
          last-used signal from middleware-side hits, not a full JSONB scan of
          page revisions.
        </p>
      </div>
    </Sheet>
  );
}
