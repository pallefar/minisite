/**
 * Phase 24 Plan 24-03 — AuditLogModule stub.
 *
 * Stub component for the Audit Log admin module.
 * Plan 24-06 ships the full audit log viewer with before/after JSONB diff.
 */
import { Card, CardHeader } from '@/components/ui/Card';

export default function AuditLogModule() {
  return (
    <Card variant="flat" padding="lg" className="max-w-xl">
      <CardHeader title="Audit Log" />
      <p className="text-sm text-[var(--color-text-secondary)]">
        Plan 24-06 ships the audit log viewer with full before/after diff support.
      </p>
    </Card>
  );
}
