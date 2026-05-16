/**
 * Phase 22 Plan 22-06 — MemberBillingTab (UI-SPEC line 253).
 *
 * Subscription card + payment-method card. Reads from the Phase 14
 * `subscriptions` table (schema: user_id, status, current_period_end,
 * plan_id, provider — see src/lib/billing-sync.ts).
 *
 * Payment method readout is deferred — the project has no per-user
 * `payment_methods` table at v1.2 (Stripe Customer Portal owns this
 * surface). Until Stripe API surface lands in admin (plan 22-07
 * RefundModal etc.), payment-method card shows "Managed in Stripe" link.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

interface SubscriptionRow {
  id: string;
  status: string;
  current_period_end: string | null;
  plan_id: string | null;
  provider: string | null;
}

export interface MemberBillingTabProps {
  userId: string;
  /** Phase 22 plan 22-07 — caller-provided callbacks to open admin Stripe action modals.
   * The modals themselves mount in AdminMemberDetailPage so they can survive a tab swap. */
  onOpenCancel?: (input: { subscriptionId: string; periodEnd: string }) => void;
  onOpenComp?: (input: { subscriptionId: string }) => void;
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success';
    case 'past_due':
    case 'unpaid':
      return 'warning';
    case 'canceled':
    case 'incomplete_expired':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function MemberBillingTab({ userId, onOpenCancel, onOpenComp }: MemberBillingTabProps) {
  const [sub, setSub] = useState<SubscriptionRow | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, status, current_period_end, plan_id, provider')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[member-billing-tab] subscription query failed', error.message);
        setSub(null);
        return;
      }
      setSub((data as SubscriptionRow | null) ?? null);
    })().catch((e: unknown) => {
      console.error('[member-billing-tab] threw', e);
      if (!cancelled) setSub(null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="member-billing-tab">
      <Card variant="default" padding="lg">
        <h3 className="text-sm font-semibold mb-3">Subscription</h3>
        {sub === undefined && <Skeleton className="h-24 w-full" />}
        {sub === null && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No active subscription on file.
          </p>
        )}
        {sub && (
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Status</dt>
              <dd>
                <Badge tone={statusTone(sub.status)}>{sub.status}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Plan</dt>
              <dd className="font-mono text-xs">{sub.plan_id ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Provider</dt>
              <dd className="font-mono text-xs">{sub.provider ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Next billing</dt>
              <dd className="text-xs">
                {sub.current_period_end
                  ? new Date(sub.current_period_end).toLocaleDateString()
                  : '—'}
              </dd>
            </div>
          </dl>
        )}
        {sub && (onOpenCancel || onOpenComp) && (
          <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-[var(--color-border)]">
            {onOpenComp && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenComp({ subscriptionId: sub.id })}
              >
                Grant comp
              </Button>
            )}
            {onOpenCancel && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onOpenCancel({
                    subscriptionId: sub.id,
                    periodEnd: sub.current_period_end ?? '',
                  })
                }
              >
                Cancel subscription
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card variant="default" padding="lg">
        <h3 className="text-sm font-semibold mb-3">Payment method</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Payment method details are managed in Stripe Customer Portal —
          per-user PM readout lands in plan 22-07.
        </p>
      </Card>
    </div>
  );
}
