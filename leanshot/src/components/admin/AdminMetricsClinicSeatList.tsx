/**
 * Phase 22 Plan 22-08 — Clinic-seat utilization list for /admin/metrics.
 *
 * One row per clinic: clinic name · used/total seats · Sparkline of usage.
 * UI-SPEC §/admin/metrics line 265 (Clinic-seat utilization span={12}).
 */
import { Card, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';
import type { ClinicSeatRow } from '@/lib/admin/admin-metrics';

export interface AdminMetricsClinicSeatListProps {
  rows: ClinicSeatRow[];
}

export function AdminMetricsClinicSeatList({ rows }: AdminMetricsClinicSeatListProps) {
  if (rows.length === 0) {
    return (
      <Card span={12} padding="md" variant="default">
        <CardHeader title="Clinic seat utilization" />
        <p className="text-sm text-[var(--color-text-secondary)]">
          No active clinic subscriptions yet.
        </p>
      </Card>
    );
  }

  return (
    <Card span={12} padding="md" variant="default">
      <CardHeader title="Clinic seat utilization" />
      <ul className="divide-y divide-[var(--color-border)]" data-testid="clinic-seat-list">
        {rows.map((row) => {
          const utilizationPct = row.total > 0 ? Math.round((row.used / row.total) * 100) : 0;
          return (
            <li
              key={row.clinicId}
              className="flex items-center justify-between gap-4 py-3"
              data-testid={`clinic-seat-row-${row.clinicId}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {row.clinicName}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {row.used}/{row.total} seats · {utilizationPct}%
                </p>
              </div>
              <Sparkline
                values={row.series.length > 0 ? row.series : [row.used, row.used]}
                width={96}
                height={28}
                label={`${row.clinicName} seat usage`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
