/**
 * Phase 36 Plan 36-04 Task 3 — VariantGrid (Surface E A/B variant breakdown).
 *
 * Reuses the OnboardingABPanel Ship-Winner contract VERBATIM:
 *   - data-action="ship-winner" attribute on every Ship button (load-bearing for E2E selectors)
 *   - supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant } })
 *   - DO NOT fork the Edge Fn — re-use the existing ship-winner-flag (Phase 34).
 *
 * by_variant shape comes directly from review_funnel_aggregate's COALESCE(copy_variant,'control')
 * GROUP BY result (B2/W5 — read directly from review_prompt_history).
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface VariantStats {
  prompts_shown: number;
  rated_internal: number;
}

export interface VariantGridProps {
  byVariant: Record<string, VariantStats>;
  /** PostHog flag key — e.g. 'nps_prompt_copy'. */
  flagId: string;
}

interface InvokeError { error?: string; ok?: boolean }

export default function VariantGrid({ byVariant, flagId }: VariantGridProps): React.JSX.Element {
  const toast = useToast();
  const [busyVariant, setBusyVariant] = useState<string | null>(null);
  const [confirmVariant, setConfirmVariant] = useState<string | null>(null);

  const keys = Object.keys(byVariant);

  if (keys.length === 0) {
    return (
      <Card variant="flat" padding="md">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Only control variant active.{' '}
          <a
            href="https://us.posthog.com/experiments"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            Create a PostHog experiment →
          </a>
        </p>
      </Card>
    );
  }

  async function handleShip(variant: string): Promise<void> {
    setBusyVariant(variant);
    try {
      const { data, error } = await supabase.functions.invoke('ship-winner-flag', {
        body: { flag_id: flagId, variant },
      });
      const payload = (data ?? null) as InvokeError | null;
      if (error || payload?.error) {
        const code = payload?.error;
        if (code === 'forbidden_not_superadmin') {
          toast('Superadmin role required', 'error');
        } else if (code === 'vendor_unconfigured') {
          toast('PostHog not yet configured', 'error');
        } else {
          toast(`Couldn't ship variant. ${error?.message ?? code ?? 'unknown'}`, 'error');
        }
        return;
      }
      toast(`Shipped ${variant} to 100% traffic`, 'success');
    } finally {
      setBusyVariant(null);
      setConfirmVariant(null);
    }
  }

  return (
    <>
      <Card variant="default" padding="md">
        <header className="mb-3">
          <h3 className="font-semibold">Variant breakdown</h3>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            One row per A/B variant. Ship a winner to promote it to 100% traffic.
          </p>
        </header>
        <ul className="divide-y divide-[var(--color-border)]">
          {keys.map((variant) => {
            const v = byVariant[variant];
            const rateTotal = v.prompts_shown;
            const rateRated = v.rated_internal;
            const pct = rateTotal > 0 ? Math.round((rateRated / rateTotal) * 100) : 0;
            return (
              <li key={variant} className="py-2 flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[13px] font-semibold">{variant}</span>
                <Badge tone={pct >= 50 ? 'success' : 'warning'}>
                  {pct >= 50 ? 'Significant' : 'Inconclusive'}
                </Badge>
                <span className="text-[13px] text-[var(--color-text-secondary)]">
                  {rateRated} rated / {rateTotal} shown
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  className="ms-auto"
                  loading={busyVariant === variant}
                  onClick={() => setConfirmVariant(variant)}
                  data-action="ship-winner"
                  data-flag-id={flagId}
                  data-variant={variant}
                >
                  Ship variant
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <ConfirmModal
        open={confirmVariant !== null}
        title={confirmVariant ? `Ship '${confirmVariant}' to 100% traffic?` : ''}
        message="Promotes this variant to control. Stickiness preserved. PostHog flag updated server-side."
        confirmLabel="Ship variant"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (confirmVariant) void handleShip(confirmVariant);
        }}
        onCancel={() => setConfirmVariant(null)}
      />
    </>
  );
}
