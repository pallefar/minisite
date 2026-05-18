/**
 * Phase 19 Plan 19-06b — /partner/payouts page.
 *
 * Top:    StripeConnectOnboardingCard (state-machine; hidden when active)
 * Banner: Next-payout estimate (1st of next month) + Connect status pill
 * Table:  Payout history (date, amount, status, stripe_transfer_id)
 *
 * Spec: 19-UI-SPEC.md §/partner/payouts. Copywriting Contract locks
 * the empty-state body and status-pill labels.
 *
 * Data: `payouts` table — RLS-gated server-side; client-side .eq(affiliate_id)
 * is defense-in-depth.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { usePartnerContext } from '@/components/partner/PartnerLayout';
import { StripeConnectOnboardingCard } from '@/components/partner/StripeConnectOnboardingCard';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface PayoutRow {
  id: string;
  created_at: string;
  amount_cents: number;
  status: 'pending' | 'paid' | 'failed';
  stripe_transfer_id: string | null;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function nextFirstOfMonth(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 0-indexed → 1-indexed → next month index
  const nextM = m % 12;
  const nextY = m === 12 ? y + 1 : y;
  const d = new Date(Date.UTC(nextY, nextM, 1));
  // E.g. "June 1, 2026"
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// UI-SPEC Connect status pill copy (verbatim).
const CONNECT_PILL: Record<
  'pending' | 'needs_info' | 'active' | 'restricted',
  { label: string; tone: BadgeTone }
> = {
  pending: { label: 'Tax onboarding · pending', tone: 'neutral' },
  needs_info: { label: 'Tax onboarding · action needed', tone: 'warning' },
  active: { label: 'Payouts active', tone: 'success' },
  restricted: { label: 'Payouts on hold', tone: 'danger' },
};

const STATUS_TONE: Record<PayoutRow['status'], BadgeTone> = {
  pending: 'neutral',
  paid: 'success',
  failed: 'danger',
};

export function PartnerPayoutsPage(): ReactNode {
  const { profile, connectState, requirements, disabledReason } = usePartnerContext();
  const toast = useToast();
  const [rows, setRows] = useState<PayoutRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await supabase
          .from('payouts')
          .select('id, created_at, amount_cents, status, stripe_transfer_id')
          .eq('affiliate_id', profile.id)
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (res.error) {
          setRows([]);
          return;
        }
        setRows((res.data ?? []) as PayoutRow[]);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const pill = CONNECT_PILL[connectState];

  const onCopyTransferId = async (id: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id);
      toast('Transfer ID copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="text-[26px] font-semibold text-[var(--color-text)]">Payouts</h1>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </header>

      <StripeConnectOnboardingCard
        state={connectState}
        requirements={requirements}
        disabledReason={disabledReason}
      />

      {/* Next-payout banner */}
      <Card variant="tonal" span={12} padding="lg">
        <p className="text-[14px] text-[var(--color-text)]">
          <span className="font-semibold">Next payout:</span> {nextFirstOfMonth()}
          <span className="mx-2 text-[var(--color-text-tertiary)]">·</span>
          <span className="text-[var(--color-text-secondary)]">
            Payouts arrive on the 1st of each month for confirmed commissions of $25+
          </span>
        </p>
      </Card>

      {/* History table */}
      <Card span={12} padding="lg">
        <h2 className="text-[14px] font-semibold text-[var(--color-text)] mb-4">Payout history</h2>
        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            inline
            title="No payouts yet"
            body="Payouts run monthly on the 1st once you've earned at least $25 in confirmed commissions."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-start text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  <th className="py-2 pe-4">Date</th>
                  <th className="py-2 pe-4">Amount</th>
                  <th className="py-2 pe-4">Status</th>
                  <th className="py-2">Transfer ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td className="py-2 pe-4 text-[var(--color-text)]">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 pe-4 font-mono text-[var(--color-text)]">
                      {formatUsd(r.amount_cents)}
                    </td>
                    <td className="py-2 pe-4">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="py-2 font-mono text-[12px] text-[var(--color-text-secondary)]">
                      {r.stripe_transfer_id ? (
                        <button
                          type="button"
                          className="hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-pill px-1"
                          onClick={() => {
                            void onCopyTransferId(r.stripe_transfer_id!);
                          }}
                          title="Click to copy"
                        >
                          {r.stripe_transfer_id.slice(0, 12)}…
                        </button>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default PartnerPayoutsPage;
