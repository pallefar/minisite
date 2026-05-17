/**
 * Phase 24 Plan 24-03 — SettingsModule stub.
 *
 * Stub component for the Settings admin module.
 * Plan 24-05 wires the "Setup 2FA" sub-section.
 */
import { Card, CardHeader } from '@/components/ui/Card';

export default function SettingsModule() {
  return (
    <Card variant="flat" padding="lg" className="max-w-xl">
      <CardHeader title="Admin Settings" />
      <p className="text-sm text-[var(--color-text-secondary)]">
        Admin settings module. Plan 24-05 wires the{' '}
        <a
          href="/admin/setup-2fa"
          className="text-[var(--color-primary)] hover:underline"
        >
          Setup 2FA
        </a>{' '}
        sub-section.
      </p>
    </Card>
  );
}
