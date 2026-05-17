/**
 * Phase 24 Plan 24-03 — PlaceholderModule.
 *
 * Rendered by the 7 admin modules that ship in later v1.3 phases.
 * The `shipsIn` hint is pre-baked by the manifest's `placeholderFor()` helper.
 */
import { Card, CardHeader } from '@/components/ui/Card';

interface PlaceholderModuleProps {
  shipsIn?: string;
}

export default function PlaceholderModule({ shipsIn }: PlaceholderModuleProps) {
  return (
    <Card variant="flat" padding="lg" className="max-w-xl">
      <CardHeader title="Coming soon" />
      <p className="text-sm text-[var(--color-text-secondary)]">
        This admin module ships in {shipsIn ?? 'a later v1.3 phase'} — see{' '}
        <code className="font-mono text-xs">.planning/ROADMAP.md</code>.
      </p>
    </Card>
  );
}
