/**
 * Phase 22 Plan 22-06 — MemberStripeTab (UI-SPEC line 255).
 *
 * Charges table (last 90 days). The Stripe charge mirror table is owned
 * by plan 22-07 (`stripe_charges` materialization). Until that lands this
 * tab renders an empty state with a "Lands in plan 22-07" placeholder —
 * the structural surface (table + per-row "Refund this charge" stub) is
 * complete so plan 22-07 can plug in without UI rework.
 */
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export interface MemberStripeTabProps {
  userId: string;
}

export function MemberStripeTab({ userId: _userId }: MemberStripeTabProps) {
  // Reserved: plan 22-07 ships stripe_charges materialization + this tab
  // fetches `select date,amount,status,descriptor from stripe_charges where
  // user_id = $1 and created_at > now() - interval '90 days'`.
  const rows: Array<{
    id: string;
    date: string;
    amount: number;
    status: string;
    descriptor: string;
  }> = [];

  if (rows.length === 0) {
    return (
      <Card variant="flat" padding="lg" data-testid="member-stripe-tab">
        <EmptyState
          illustration={<CreditCard className="size-8" aria-hidden />}
          title="No charges in the last 90 days"
          body="Charges history lands in plan 22-07 (stripe_charges mirror)."
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
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--color-border)] last:border-b-0">
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                {new Date(row.date).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-sm tabular-nums">${(row.amount / 100).toFixed(2)}</td>
              <td className="px-4 py-3 text-xs">{row.status}</td>
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">{row.descriptor}</td>
              <td className="px-4 py-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  title="Refund modal lands in plan 22-07"
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
