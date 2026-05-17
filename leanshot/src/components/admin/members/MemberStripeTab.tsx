/**
 * Phase 22 Plan 22-06 — MemberStripeTab (UI-SPEC line 255).
 *
 * Charges table (last 90 days).
 *
 * v1.2 status: the dedicated `stripe_charges` materialization table is still
 * deferred (no migration ships it here). Charges-history retrieval is
 * therefore stub-empty by default. The structural surface (table + per-row
 * "Refund this charge" button that opens plan 22-07 RefundModal) is fully
 * wired — when AdminMemberDetailPage passes a non-empty `charges` prop OR
 * the stripe_charges table ships, the refund button live-fires the modal
 * via the `onOpenRefund` callback.
 */
import { CreditCard } from 'lucide-react';
import type { RefundCharge } from '@/components/admin/members/RefundModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export interface MemberStripeTabProps {
  userId: string;
  /** Optional pre-fetched charges. Defaults to []. plan 22-07b will wire a stripe_charges fetch. */
  charges?: RefundCharge[];
  /** Phase 22 plan 22-07 callback — opens RefundModal seeded with the clicked charge. */
  onOpenRefund?: (charge: RefundCharge) => void;
}

export function MemberStripeTab({ userId: _userId, charges = [], onOpenRefund }: MemberStripeTabProps) {
  if (charges.length === 0) {
    return (
      <Card variant="flat" padding="lg" data-testid="member-stripe-tab">
        <EmptyState
          illustration={<CreditCard className="size-8" aria-hidden />}
          title="No charges in the last 90 days"
          body="Charge history fetch lands when the stripe_charges mirror table ships."
        />
      </Card>
    );
  }

  return (
    <Card variant="default" padding="none" className="overflow-x-auto" data-testid="member-stripe-tab">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {['Date', 'Amount', 'Status', 'Descriptor', ''].map((h) => (
              <th
                key={h || 'actions'}
                scope="col"
                className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
              >
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {charges.map((row) => (
            <tr key={row.id} className="border-b border-[var(--color-border)] last:border-b-0">
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                {new Date(row.created * 1000).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-sm tabular-nums">${(row.amount / 100).toFixed(2)}</td>
              <td className="px-4 py-3 text-xs">paid</td>
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">{row.descriptor}</td>
              <td className="px-4 py-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!onOpenRefund}
                  onClick={() => onOpenRefund?.(row)}
                >
                  Refund this charge
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
