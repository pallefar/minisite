/**
 * Phase 26 Plan 26-05 — Anomaly Review tab (AFFTIER-05) per D-11.
 *
 * Lists conversions WHERE anomaly_flagged=true AND anomaly_review_decision IS NULL.
 * Per-row actions:
 *   - Mark clear      → admin_anomaly_review_decision(id, 'clear')
 *   - Confirm fraud   → admin_anomaly_review_decision(id, 'fraud_confirmed')
 *                       (server-side ALSO writes affiliate_fraud_signals so
 *                        Plan 26-07 claw-back correlates at next webhook event)
 *
 * Limit 100 rows on initial load; reload after each decision so the row
 * disappears from the queue.
 */
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { confirmFraud, markClear } from '@/lib/admin/affiliate-review';
import { AffiliateTierError } from '@/lib/admin/affiliate-tier';
import { supabase } from '@/lib/supabase';

interface AnomalyRow {
  id: string;
  affiliate_id: string;
  anomaly_z_score: number | null;
  created_at: string;
  referral_code: string | null;
}

interface RawAnomalyRow {
  id: string;
  affiliate_id: string;
  anomaly_z_score: number | null;
  created_at: string;
  affiliates?: { referral_code?: string } | { referral_code?: string }[] | null;
}

function mapErrorToMessage(code: AffiliateTierError['code']): string {
  switch (code) {
    case 'forbidden':
      return 'Superadmin role required.';
    case 'invalid_decision':
      return 'Invalid decision value.';
    case 'conversion_not_found':
      return 'Conversion no longer flagged.';
    case 'network':
      return 'Network error — please retry.';
    default:
      return 'Action failed.';
  }
}

export function AdminAffiliatesAnomalyTab() {
  const [rows, setRows] = useState<AnomalyRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const toast = useToast();

  const reload = async (): Promise<void> => {
    const { data, error } = await supabase
      .from('affiliate_conversions')
      .select(
        'id, affiliate_id, anomaly_z_score, created_at, affiliates(referral_code)',
      )
      .eq('anomaly_flagged', true)
      .is('anomaly_review_decision', null)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      setErrorMessage("Couldn't load anomaly queue. Try refreshing.");
      setRows([]);
      return;
    }
    setErrorMessage('');
    const normalized: AnomalyRow[] = ((data ?? []) as RawAnomalyRow[]).map((r) => {
      let code: string | null = null;
      const aff = r.affiliates;
      if (aff) {
        if (Array.isArray(aff)) code = aff[0]?.referral_code ?? null;
        else code = aff.referral_code ?? null;
      }
      return {
        id: r.id,
        affiliate_id: r.affiliate_id,
        anomaly_z_score: r.anomaly_z_score,
        created_at: r.created_at,
        referral_code: code,
      };
    });
    setRows(normalized);
  };

  useEffect(() => {
    void reload();
  }, []);

  const decide = async (
    conversionId: string,
    fn: () => Promise<void>,
    successMsg: string,
  ): Promise<void> => {
    if (busyId) return;
    setBusyId(conversionId);
    try {
      await fn();
      toast(successMsg, 'success');
      await reload();
    } catch (e) {
      const msg = e instanceof AffiliateTierError ? mapErrorToMessage(e.code) : 'Action failed.';
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null && !errorMessage) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Loading anomaly queue…</p>;
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
      <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-6">
        <EmptyState
          illustration={<Mail className="size-8" aria-hidden />}
          title="No anomaly reviews pending"
          body="Flagged conversions with z-score above threshold will appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-2" data-testid="affiliates-anomaly-list">
      {(rows ?? []).map((r) => (
        <Card key={r.id} padding="md">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono">
                {r.referral_code ?? r.affiliate_id.slice(0, 8)}
              </code>
              <Badge tone="warning">
                z = {(r.anomaly_z_score ?? 0).toFixed(2)}
              </Badge>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                loading={busyId === r.id}
                onClick={() => {
                  void decide(r.id, () => markClear(r.id), 'Marked clear');
                }}
              >
                Mark clear
              </Button>
              <Button
                size="sm"
                loading={busyId === r.id}
                onClick={() => {
                  void decide(r.id, () => confirmFraud(r.id), 'Confirmed fraud');
                }}
              >
                Confirm fraud
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default AdminAffiliatesAnomalyTab;
