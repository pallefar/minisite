/**
 * Phase 34 Plan 34-07 (ONBOARD-13) — D-12 end-of-onboarding 3-card hybrid UI.
 *
 * Renders 3 cards mapped from the user's `primary_goal`:
 *   - Card 0 is the recommended action — visually emphasized via
 *     `border-2 border-[var(--color-primary)]`, primary-tinted icon chip,
 *     "Recommended for your goal" badge, and a `primary` Button variant.
 *   - Cards 1 + 2 are the universal fallbacks — `interactive` Card variant,
 *     `ghost` Button variant.
 *
 * On tap:
 *   - `fireActivation({ goal_type, action_type })` is invoked (see
 *     `@/lib/onboarding/activation-hooks` for the 3-layer fire-once guard).
 *   - The component then dispatches the `leanshot:open-surface` CustomEvent
 *     with `{ surface }` from `ACTION_CATALOG`. The listener (OnboardingFlow
 *     or App.tsx — wired in Plan 34-10) opens the corresponding modal.
 *
 * Accessibility:
 *   - Region landmark with explicit `aria-label`.
 *   - 44px minimum tap target on every action button (Button primitive's
 *     `min-h-[44px]` override).
 *   - Decorative icons carry `aria-hidden`; recommended buttons declare the
 *     emphasis in `aria-label` so screen readers do not rely on the badge
 *     alone.
 *   - Recommended card is first in DOM order so it is reachable first via
 *     keyboard.
 */

import { useState, type JSX } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { fireActivation } from '@/lib/onboarding/activation-hooks';
import {
  ACTION_CATALOG,
  getCardsForGoal,
  type ActionType,
  type PrimaryGoal,
} from '@/lib/onboarding/first-action-map';

// ──────────────────────────────────────────────────────────────────────────
// Public surface event — Plan 34-10 owns the listener wiring + smoke test.
// ──────────────────────────────────────────────────────────────────────────

export const OPEN_SURFACE_EVENT = 'leanshot:open-surface' as const;

export interface OpenSurfaceEventDetail {
  surface: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export interface FirstActionSurfaceProps {
  goal: PrimaryGoal;
}

export default function FirstActionSurface({ goal }: FirstActionSurfaceProps): JSX.Element {
  const [busy, setBusy] = useState<ActionType | null>(null);
  const cards = getCardsForGoal(goal);

  async function handleTap(actionType: ActionType): Promise<void> {
    setBusy(actionType);
    try {
      await fireActivation({ goal_type: goal, action_type: actionType });
      const surface = ACTION_CATALOG[actionType].surface;
      window.dispatchEvent(
        new CustomEvent<OpenSurfaceEventDetail>(OPEN_SURFACE_EVENT, {
          detail: { surface },
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="region"
      aria-label="Choose your first action"
      className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-3"
    >
      {cards.map((c) => {
        const meta = ACTION_CATALOG[c.action_type];
        const Icon = meta.icon;
        const isRecommended = c.recommended;
        return (
          <Card
            key={c.action_type}
            variant={isRecommended ? 'elevated' : 'interactive'}
            padding="md"
            className={
              'min-h-[140px] flex flex-col ' +
              (isRecommended ? 'border-2 border-[var(--color-primary)]' : '')
            }
          >
            {isRecommended && (
              <Badge tone="info" className="mb-2 self-start">
                Recommended for your goal
              </Badge>
            )}
            <div
              className={
                'size-12 rounded-2xl inline-flex items-center justify-center shrink-0 ' +
                (isRecommended
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'bg-[var(--color-surface-elevated)] text-[var(--color-text)]')
              }
            >
              <Icon className="size-5" aria-hidden />
            </div>
            <h3 className="mt-3 font-medium text-[var(--color-text)]">{meta.label}</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)] flex-1">
              {meta.description}
            </p>
            <Button
              variant={isRecommended ? 'primary' : 'ghost'}
              className="mt-4 min-h-[44px] w-full"
              loading={busy === c.action_type}
              onClick={() => void handleTap(c.action_type)}
              aria-label={`${isRecommended ? 'Recommended: ' : ''}${meta.label}`}
            >
              {isRecommended ? 'Start' : meta.label}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
