/**
 * Phase 22 Plan 22-07 — AdminAffiliatesReviewQueue (ADMIN-06).
 *
 * Operator review queue for affiliate conversions per UI-SPEC §/admin/affiliates
 * lines 268-274 + Copywriting lines 519-536. Extends the Phase 19 read-only
 * AdminAffiliatesScaffold by adding:
 *
 *   - 6-state segmented filter Pill (All / Pending / Flagged / Approved /
 *     Rejected / On hold) with per-state count Badge.
 *   - 4 per-row actions: Approve, Hold, Pay out (tooltip-only, no-op trigger
 *     — cron 19-09 picks up `confirmed` rows on next monthly run), Reject
 *     (prompts for reason).
 *   - Fraud-signal badges column (one Badge per fraud_signals entry).
 *   - Row-expansion inline panel: Fraud signals · Payout history · Audit log
 *     mini-tables, per UI-SPEC line 272.
 *
 * THIS COMPONENT IS THE OWNING WRITER for the `pending|flagged|on_hold →
 * confirmed` transitions per `feedback_status_machine_transition_owner.md`.
 * It closes Phase 19 BL-11 status-graph gap — without this surface the
 * monthly payout cron (19-09) silently ships $0 for every flagged row.
 *
 * RLS contract: pol_affiliate_conversions_staff_all (migration 19-01) lets
 * is_staff callers read every conversion. The write path is gated server-side
 * by the SECURITY DEFINER RPCs (migration 20270601000019); the client gate
 * here is UX-only (Pattern S1 dual-layer).
 */
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  AffiliateReviewError,
  approveAffiliateConversion,
  holdAffiliateConversion,
  rejectAffiliateConversion,
} from '@/lib/admin/affiliate-review';
import { supabase } from '@/lib/supabase';

type ConversionStatus =
  | 'pending'
  | 'confirmed'
  | 'flagged'
  | 'rejected'
  | 'paid'
  | 'on_hold';
type StatusFilter = 'all' | ConversionStatus;

interface ConversionRow {
  id: string;
  affiliate_id: string;
  affiliate_email: string | null;
  invoice_id: string;
  commission_cents: number;
  status: ConversionStatus;
  fraud_signals: string[];
  eligible_at: string | null;
  invoice_paid_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  reviewed_at: string | null;
}

interface AuditMiniRow {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface PayoutMiniRow {
  id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
}

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'confirmed', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'on_hold', label: 'On hold' },
];

const STATUS_BADGE: Record<
  ConversionStatus,
  { tone: 'warning' | 'success' | 'danger' | 'neutral' | 'info'; label: string }
> = {
  pending: { tone: 'warning', label: 'Pending' },
  flagged: { tone: 'warning', label: 'Flagged' },
  confirmed: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  paid: { tone: 'info', label: 'Paid' },
  on_hold: { tone: 'neutral', label: 'On hold' },
};

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function AdminAffiliatesReviewQueue() {
  const toast = useToast();
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [rows, setRows] = useState<ConversionRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('flagged');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  // Per-row expansion side-tables (lazy-loaded on first expand).
  const [auditByRow, setAuditByRow] = useState<Record<string, AuditMiniRow[] | null>>({});
  const [payoutsByAff, setPayoutsByAff] = useState<Record<string, PayoutMiniRow[] | null>>({});

  // ── Initial probe + data load ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (cancelled) return;
      setIsStaff(staff);
      if (!staff) return;
      await reload();
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reload conversions ────────────────────────────────────────────────────
  const reload = async (): Promise<void> => {
    const { data, error } = await supabase
      .from('affiliate_conversions')
      .select(
        'id, affiliate_id, invoice_id, commission_cents, status, fraud_signals, eligible_at, invoice_paid_at, created_at, confirmed_at, reviewed_at, affiliates(email)',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setErrorMessage("Couldn't load conversions. Try refreshing.");
      setRows([]);
      return;
    }
    setErrorMessage('');
    type RawRow = Omit<ConversionRow, 'affiliate_email' | 'fraud_signals'> & {
      fraud_signals: unknown;
      affiliates?: { email?: string } | { email?: string }[] | null;
    };
    const normalized: ConversionRow[] = ((data ?? []) as RawRow[]).map((r) => {
      let email: string | null = null;
      const aff = r.affiliates;
      if (aff) {
        if (Array.isArray(aff)) email = aff[0]?.email ?? null;
        else email = aff.email ?? null;
      }
      let signals: string[] = [];
      if (Array.isArray(r.fraud_signals)) {
        signals = r.fraud_signals.filter((s): s is string => typeof s === 'string');
      }
      return {
        ...r,
        fraud_signals: signals,
        affiliate_email: email,
      };
    });
    setRows(normalized);
  };

  // ── Per-state counts + filter ─────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: 0,
      pending: 0,
      confirmed: 0,
      flagged: 0,
      rejected: 0,
      paid: 0,
      on_hold: 0,
    };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  // ── Action handlers ───────────────────────────────────────────────────────
  const runAction = async (
    rowId: string,
    op: 'approve' | 'hold' | 'reject',
  ): Promise<void> => {
    if (busyRowId) return;
    setBusyRowId(rowId);
    try {
      if (op === 'approve') {
        await approveAffiliateConversion(rowId);
        toast('Conversion approved — payout queued for next cycle.', 'success');
      } else if (op === 'hold') {
        await holdAffiliateConversion(rowId);
        toast('Conversion placed on hold.', 'info');
      } else {
        const reason = window.prompt('Reason for rejection?', '') ?? '';
        if (!reason.trim()) {
          setBusyRowId(null);
          return;
        }
        await rejectAffiliateConversion(rowId, reason.trim());
        toast('Conversion rejected.', 'info');
      }
      await reload();
    } catch (e) {
      if (e instanceof AffiliateReviewError) {
        if (e.code === 'not_staff') toast('Forbidden — not an admin.', 'error');
        else if (e.code === 'invalid_state') {
          toast('Cannot transition this row from its current status.', 'error');
        } else toast('Could not update the conversion.', 'error');
      } else toast('Could not update the conversion.', 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  // ── Row expansion (lazy-load side data on first open) ─────────────────────
  const toggleExpand = async (row: ConversionRow): Promise<void> => {
    const opening = expandedRowId !== row.id;
    setExpandedRowId(opening ? row.id : null);
    if (!opening) return;

    if (auditByRow[row.id] === undefined) {
      setAuditByRow((m) => ({ ...m, [row.id]: null }));
      try {
        const { data } = await supabase
          .from('audit_logs')
          .select('id, action, created_at, metadata')
          .eq('table_name', 'public.affiliate_conversions')
          .eq('row_id', row.id)
          .order('created_at', { ascending: false })
          .limit(10);
        type AuditRaw = Omit<AuditMiniRow, 'metadata'> & { metadata: unknown };
        const safe: AuditMiniRow[] = ((data ?? []) as AuditRaw[]).map((r) => ({
          ...r,
          metadata:
            r.metadata && typeof r.metadata === 'object'
              ? (r.metadata as Record<string, unknown>)
              : {},
        }));
        setAuditByRow((m) => ({ ...m, [row.id]: safe }));
      } catch {
        setAuditByRow((m) => ({ ...m, [row.id]: [] }));
      }
    }
    if (payoutsByAff[row.affiliate_id] === undefined) {
      setPayoutsByAff((m) => ({ ...m, [row.affiliate_id]: null }));
      try {
        const { data } = await supabase
          .from('payouts')
          .select('id, period_start, period_end, amount_cents, status, paid_at')
          .eq('affiliate_id', row.affiliate_id)
          .order('created_at', { ascending: false })
          .limit(5);
        setPayoutsByAff((m) => ({
          ...m,
          [row.affiliate_id]: (data ?? []) as PayoutMiniRow[],
        }));
      } catch {
        setPayoutsByAff((m) => ({ ...m, [row.affiliate_id]: [] }));
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isStaff === undefined) return null;

  if (!isStaff) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
          <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            You don&apos;t have access to the affiliate review queue.
          </p>
          <a
            href="/"
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
          >
            Back to home →
          </a>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Affiliate conversions review</h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Approve eligible conversions so the monthly payout cron can ship transfers.
          </p>
        </div>
      </header>

      <PillGroup segmented className="mb-6" aria-label="Filter by conversion status">
        {STATUS_FILTERS.map((f) => (
          <Pill
            key={f.key}
            size="sm"
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
            count={counts[f.key]}
            role="tab"
            aria-selected={filter === f.key}
          >
            {f.label}
          </Pill>
        ))}
      </PillGroup>

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      {rows === null && !errorMessage && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading conversions…</p>
      )}

      {rows !== null && visibleRows.length === 0 && !errorMessage && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12">
          <EmptyState
            illustration={<Mail className="size-8" aria-hidden />}
            title="Nothing to review"
            body="When fraud-flagged conversions arrive, they'll show up here for approval."
          />
        </Card>
      )}

      {rows !== null && visibleRows.length > 0 && (
        <Card variant="default" padding="none" className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="affiliate-conversions-table">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Affiliate
                </th>
                <th scope="col" className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Invoice
                </th>
                <th scope="col" className="text-right text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Commission
                </th>
                <th scope="col" className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Status
                </th>
                <th scope="col" className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Fraud signals
                </th>
                <th scope="col" className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Eligible
                </th>
                <th scope="col" className="text-right text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const badge = STATUS_BADGE[r.status];
                const isExpanded = expandedRowId === r.id;
                const audit = auditByRow[r.id] ?? null;
                const payouts = payoutsByAff[r.affiliate_id] ?? null;
                const isPaidOrRejected = r.status === 'paid' || r.status === 'rejected';
                return (
                  <>
                    <tr
                      key={r.id}
                      className="border-b border-[var(--color-border)] last:border-b-0 cursor-pointer hover:bg-[var(--color-surface-elevated)]"
                      onClick={() => {
                        void toggleExpand(r);
                      }}
                      data-testid={`conversion-row-${r.id}`}
                    >
                      <td className="px-4 py-3 text-sm align-middle">
                        {r.affiliate_email ?? r.affiliate_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono align-middle text-[var(--color-text-secondary)]">
                        {r.invoice_id}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-right align-middle">
                        {formatCents(r.commission_cents)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {r.fraud_signals.length === 0 ? (
                          <span className="text-xs text-[var(--color-text-tertiary)]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.fraud_signals.map((s) => (
                              <Badge key={s} tone="warning">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs align-middle text-[var(--color-text-secondary)]">
                        {formatDate(r.eligible_at)}
                      </td>
                      <td
                        className="px-4 py-3 text-right align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPaidOrRejected || busyRowId === r.id || r.status === 'confirmed'}
                            loading={busyRowId === r.id}
                            onClick={() => {
                              void runAction(r.id, 'approve');
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPaidOrRejected || busyRowId === r.id || r.status === 'on_hold'}
                            onClick={() => {
                              void runAction(r.id, 'hold');
                            }}
                          >
                            Hold
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled
                            title="Cron picks up confirmed rows on next monthly run"
                          >
                            Pay out
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={r.status === 'paid' || busyRowId === r.id}
                            onClick={() => {
                              void runAction(r.id, 'reject');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${r.id}-expanded`} className="bg-[var(--color-surface-elevated)]">
                        <td colSpan={7} className="px-4 py-4">
                          <div
                            className="grid grid-cols-1 md:grid-cols-3 gap-4"
                            data-testid={`conversion-row-${r.id}-expanded`}
                          >
                            <section>
                              <h3 className="text-xs uppercase tracking-[0.06em] font-semibold text-[var(--color-text-secondary)] mb-2">
                                Fraud signals
                              </h3>
                              {r.fraud_signals.length === 0 ? (
                                <p className="text-xs text-[var(--color-text-tertiary)]">
                                  No fraud signals on this conversion.
                                </p>
                              ) : (
                                <ul className="text-xs space-y-1">
                                  {r.fraud_signals.map((s) => (
                                    <li key={s} className="font-mono">
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                            <section>
                              <h3 className="text-xs uppercase tracking-[0.06em] font-semibold text-[var(--color-text-secondary)] mb-2">
                                Payout history
                              </h3>
                              {payouts === null ? (
                                <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>
                              ) : payouts.length === 0 ? (
                                <p className="text-xs text-[var(--color-text-tertiary)]">
                                  No prior payouts.
                                </p>
                              ) : (
                                <ul className="text-xs space-y-1">
                                  {payouts.map((p) => (
                                    <li key={p.id} className="font-mono">
                                      {formatDate(p.period_start)} → {formatDate(p.period_end)}:{' '}
                                      {formatCents(p.amount_cents)} ({p.status})
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                            <section>
                              <h3 className="text-xs uppercase tracking-[0.06em] font-semibold text-[var(--color-text-secondary)] mb-2">
                                Audit log
                              </h3>
                              {audit === null ? (
                                <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>
                              ) : audit.length === 0 ? (
                                <p className="text-xs text-[var(--color-text-tertiary)]">
                                  No audit entries yet.
                                </p>
                              ) : (
                                <ul className="text-xs space-y-1">
                                  {audit.map((a) => (
                                    <li key={a.id} className="font-mono">
                                      {formatDate(a.created_at)} — {a.action}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

export default AdminAffiliatesReviewQueue;
