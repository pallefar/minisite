/**
 * Phase 29 Plan 06 — ClinicBillingCard
 *
 * Displays clinic subscription status, current billing period, and active
 * patient count. Subscribes to the Phase 28 HMAC realtime channel
 * `org-{hmac8}-subscriptions` so Stripe webhook updates are reflected
 * within 30 seconds (ORG-08 SC#4 / D-05).
 *
 * Anti-pattern guard: this component does NOT use postgres_changes directly
 * for the realtime subscription; it uses the HMAC broadcast channel
 * (Phase 28 D-20..D-24) which requires the channelNameFor async derivation.
 *
 * HIPAA-16 / T-29-06-04: Subscription status + period + count are non-PHI.
 * data-sentry-mask is NOT required. Comment left for Phase 25 sweep:
 *   <!-- Phase 25 sweep: verify count_active_patients is non-PHI before removing comment -->
 *
 * Bundle constraint (CLAUDE.md): This file is lazy-loaded via React.lazy
 * in App.tsx. Do NOT import this component eagerly from any other file.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { channelNameFor } from '@/lib/org-realtime';
import { supabase } from '@/lib/supabase';
import PatientInviteForm from './PatientInviteForm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClinicSubscriptionRow {
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  seats_paid: number;
  seats_used: number;
}

interface ClinicBillingCardProps {
  /** UUID of the organization (clinic). */
  orgId: string;
  /** Org slug for display / navigation context. */
  orgSlug?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

function statusColor(status: string | null): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'text-[var(--color-success)]';
    case 'past_due':
    case 'unpaid':
      return 'text-[var(--color-warning)]';
    case 'canceled':
    case 'incomplete_expired':
      return 'text-[var(--color-danger)]';
    default:
      return 'text-[var(--color-text-secondary)]';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClinicBillingCard({ orgId, orgSlug }: ClinicBillingCardProps) {
  const [subscription, setSubscription] = useState<ClinicSubscriptionRow | null>(null);
  const [activePatientCount, setActivePatientCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Initial data load ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        // Fetch subscription row for this clinic.
        const { data: subData, error: subError } = await supabase
          .from('subscriptions')
          .select('status, current_period_start, current_period_end, seats_paid, seats_used')
          .eq('clinic_id', orgId)
          .is('user_id', null)
          .maybeSingle();

        if (subError) {
          if (!cancelled) setError('Failed to load subscription.');
          return;
        }

        // Fetch active patient count via SECDEF RPC (D-01).
        const { data: countData, error: countError } = await supabase.rpc(
          'count_active_patients',
          { p_org_id: orgId },
        );

        if (countError) {
          // Non-fatal — count may be 0 if function fails; log + continue.
          console.warn('[ClinicBillingCard] count_active_patients failed:', countError.message);
        }

        if (!cancelled) {
          setSubscription(subData as ClinicSubscriptionRow | null);
          setActivePatientCount(
            typeof countData === 'number' ? countData : null,
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Network error loading billing data.');
          setLoading(false);
        }
        console.error('[ClinicBillingCard] load error:', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // ── Realtime subscription — D-05 / ORG-08 SC#4 ──────────────────────────
  // Subscribes to the HMAC channel `org-{hmac8}-subscriptions` (Phase 28).
  // On any postgres_changes UPDATE to subscriptions filtered by clinic_id,
  // refreshes the subscription row in state → card re-renders within 30s.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      try {
        // Ensure auth token is fresh before subscribing (Phase 9 Pitfall #2).
        await supabase.realtime.setAuth((await supabase.auth.getSession()).data.session?.access_token ?? null);

        const channelName = await channelNameFor(orgId, 'subscriptions');
        if (cancelled) return;

        channel = supabase
          .channel(channelName, { config: { private: true } })
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'subscriptions',
              filter: `clinic_id=eq.${orgId}`,
            },
            (payload) => {
              const updated = payload.new as ClinicSubscriptionRow;
              setSubscription(updated);
            },
          )
          .subscribe();
      } catch (err) {
        // Non-fatal — billing card remains usable without realtime.
        console.warn('[ClinicBillingCard] realtime subscribe failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void channel.unsubscribe();
      }
    };
  }, [orgId]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card variant="elevated" span={8}>
        <CardHeader title="Clinic Billing" />
        <div className="space-y-3 mt-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="elevated" span={8}>
        <CardHeader title="Clinic Billing" />
        <EmptyState
          title="Billing unavailable"
          body={error}
          inline
        />
      </Card>
    );
  }

  return (
    <div className="contents">
      <Card variant="elevated" span={8}>
        <CardHeader title="Clinic Billing" />

        {subscription ? (
          <div className="space-y-4">
            {/* Status row */}
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)] min-w-[120px]">
                Status
              </span>
              <span
                className={`text-[14px] font-semibold ${statusColor(subscription.status)}`}
                data-testid="billing-status"
              >
                {statusLabel(subscription.status)}
              </span>
            </div>

            {/* Period row */}
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)] min-w-[120px]">
                Billing period
              </span>
              <span className="text-[14px] text-[var(--color-text)]">
                {formatDate(subscription.current_period_start)}
                {' — '}
                {formatDate(subscription.current_period_end)}
              </span>
            </div>

            {/* Seats row */}
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)] min-w-[120px]">
                Seats
              </span>
              <span className="text-[14px] text-[var(--color-text)]">
                {subscription.seats_used} used / {subscription.seats_paid} paid
              </span>
            </div>

            {/* Active patients row — non-PHI (Phase 25 sweep: count_active_patients is aggregate count, not patient identifier) */}
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)] min-w-[120px]">
                Active patients
              </span>
              <span className="text-[14px] text-[var(--color-text)]" data-testid="billing-active-count">
                {activePatientCount !== null ? activePatientCount : '—'}
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No active subscription"
            body="Contact your account manager to activate clinic billing."
            inline
          />
        )}
      </Card>

      {/* Invite form — shown below billing card for clinic admins */}
      <PatientInviteForm orgId={orgId} orgSlug={orgSlug} />
    </div>
  );
}
