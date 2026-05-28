/**
 * Phase 26 Plan 26-05 — Tier Management tab (AFFTIER-01).
 *
 * Lists approved affiliates with tier badge + admin actions:
 *   - Grant Lifetime (enabled only when tier='gold' AND not frozen) per D-14
 *   - Reverse Grant (visible only inside reversibility window:
 *       tier='lifetime' AND no recurring payout row AND <7d since promotion)
 *     Both client and server enforce; server is source of truth (Pitfall 5).
 *   - Freeze (prompts for reason; client-side empty-reason guard) per D-04
 *   - Unfreeze
 *
 * RLS contract: staff-readable, superadmin-mutable via SECDEF RPCs (migration
 * 20270701000011). Client gate (window check) is UX-only; server re-validates.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import {
  AffiliateTierError,
  freezeAffiliate,
  grantLifetime,
  reverseLifetimeGrant,
  unfreezeAffiliate,
} from '@/lib/admin/affiliate-tier';
import { supabase } from '@/lib/supabase';

interface TierRow {
  id: string;
  referral_code: string | null;
  tier: 'standard' | 'gold' | 'lifetime';
  tier_promoted_at: string | null;
  frozen_at: string | null;
  freeze_reason: string | null;
  has_recurring_payout: boolean;
}

interface RawTierRow {
  id: string;
  referral_code: string | null;
  tier: TierRow['tier'];
  tier_promoted_at: string | null;
  frozen_at: string | null;
  freeze_reason: string | null;
  recurring_payouts?: { id: string }[] | null;
}

const SEVEN_DAYS_MS = 7 * 86400000;

function mapErrorToMessage(code: AffiliateTierError['code']): string {
  switch (code) {
    case 'forbidden':
      return 'Superadmin role required.';
    case 'must_be_gold_first':
      return 'Affiliate must be Gold before granting Lifetime.';
    case 'cannot_reverse':
      return 'Reverse window expired or payout already shipped.';
    case 'reason_required':
      return 'Freeze reason is required.';
    case 'not_lifetime':
      return 'Affiliate is not Lifetime.';
    case 'affiliate_not_found':
      return 'Affiliate not found.';
    case 'network':
      return 'Network error — please retry.';
    default:
      return 'Action failed.';
  }
}

function withinReverseWindow(r: TierRow): boolean {
  if (r.tier !== 'lifetime' || r.has_recurring_payout || !r.tier_promoted_at) return false;
  return Date.now() - new Date(r.tier_promoted_at).getTime() < SEVEN_DAYS_MS;
}

export function AdminAffiliatesTierTab() {
  const [rows, setRows] = useState<TierRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const toast = useToast();

  const reload = async (): Promise<void> => {
    // v1.4 hardening note: replace the embedded `recurring_payouts` join with a
    // SECDEF helper `public.affiliate_has_recurring_payout(uuid) returns boolean`
    // — single-call existence check, RLS-safe, avoids over-fetching IDs from
    // the recurring_payments table from the admin UI.
    const { data, error } = await supabase
      .from('affiliates')
      .select(
        'id, referral_code, tier, tier_promoted_at, frozen_at, freeze_reason, ' +
          'recurring_payouts:affiliate_lifetime_recurring_payments(id)',
      )
      .eq('status', 'approved')
      .order('tier_promoted_at', { ascending: false, nullsFirst: false });

    if (error) {
      setErrorMessage("Couldn't load affiliates. Try refreshing.");
      setRows([]);
      return;
    }
    setErrorMessage('');
    const normalized: TierRow[] = ((data ?? []) as unknown as RawTierRow[]).map((r) => ({
      id: r.id,
      referral_code: r.referral_code,
      tier: r.tier,
      tier_promoted_at: r.tier_promoted_at,
      frozen_at: r.frozen_at,
      freeze_reason: r.freeze_reason,
      has_recurring_payout: Array.isArray(r.recurring_payouts) && r.recurring_payouts.length > 0,
    }));
    setRows(normalized);
  };

  useEffect(() => {
    void reload();
  }, []);

  const runAction = async (
    rowId: string,
    fn: () => Promise<void>,
    successMsg: string,
  ): Promise<void> => {
    if (busyId) return;
    setBusyId(rowId);
    try {
      await fn();
      toast(successMsg, 'success');
      await reload();
    } catch (e) {
      const msg = e instanceof AffiliateTierError ? mapErrorToMessage(e.code) : 'Unexpected error';
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null && !errorMessage) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Loading affiliates…</p>;
  }

  if (errorMessage) {
    return (
      <Card variant="flat" padding="md">
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errorMessage}
        </p>
      </Card>
    );
  }

  if (rows && rows.length === 0) {
    return (
      <Card variant="flat" padding="lg">
        <p className="text-sm text-[var(--color-text-secondary)] text-center">
          No approved affiliates yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2" data-testid="affiliates-tier-list">
      {(rows ?? []).map((r) => {
        const reverseShown = withinReverseWindow(r);
        return (
          <Card key={r.id} padding="md">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <code className="text-sm font-mono">{r.referral_code ?? r.id.slice(0, 8)}</code>
                <Badge
                  tone={
                    r.tier === 'lifetime' ? 'success' : r.tier === 'gold' ? 'warning' : 'neutral'
                  }
                >
                  {r.tier}
                </Badge>
                {r.frozen_at && (
                  <Badge tone="danger" title={r.freeze_reason ?? undefined}>
                    Frozen
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                {r.tier === 'gold' && !r.frozen_at && (
                  <Button
                    size="sm"
                    loading={busyId === r.id}
                    onClick={() => {
                      void runAction(r.id, () => grantLifetime(r.id), 'Granted Lifetime');
                    }}
                  >
                    Grant Lifetime
                  </Button>
                )}
                {reverseShown && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === r.id}
                    onClick={() => {
                      void runAction(r.id, () => reverseLifetimeGrant(r.id), 'Reversed grant');
                    }}
                  >
                    Reverse
                  </Button>
                )}
                {r.frozen_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === r.id}
                    onClick={() => {
                      void runAction(r.id, () => unfreezeAffiliate(r.id), 'Unfrozen');
                    }}
                  >
                    Unfreeze
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const reason = window.prompt('Freeze reason:');
                      if (!reason || !reason.trim()) return;
                      void runAction(r.id, () => freezeAffiliate(r.id, reason.trim()), 'Frozen');
                    }}
                  >
                    Freeze
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default AdminAffiliatesTierTab;
