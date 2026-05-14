/**
 * Phase 14 Plan 14-05 — TierGate component.
 *
 * A gating primitive that reads the Zustand `tier` slice and conditionally
 * renders children based on the user's subscription state.
 *
 * Three modes (CONTEXT D-05, D-06, D-07; RESEARCH §Pattern 4):
 *   blur-upsell      — default; blurs children + shows centered PaywallUpsell overlay.
 *                      When prefers-reduced-motion is set, falls back to opacity-60
 *                      with no blur filter (RESEARCH Pattern 4 + CLAUDE.md a11y rules).
 *   hard-block-no-ui — renders nothing for free/past_due users; paid users see children.
 *   hard-block-cta   — renders only the PaywallUpsell CTA for free users; paid sees children.
 *
 * Gate semantics:
 *   tier='paid'     → always render children untouched (all 3 modes).
 *   tier='past_due' → always render children untouched (past_due is NOT double-gated;
 *                     Plan 14-06's PastDueBanner handles the dunning chrome separately).
 *   tier='free'     → apply mode logic.
 *
 * CRITICAL (Pattern G): ZERO @stripe/stripe-js imports in this file.
 *   Upgrade redirect is delegated to PaywallUpsell which calls the Edge Function
 *   via plain fetch + window.location.href.
 *
 * CLAUDE.md selector convention: one selector per primitive.
 *   `useStore((s) => s.tier)` — single-field selector, never unstable-snapshot style.
 */
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { TIER_GATE_REGISTRY } from '@/lib/billing';
import type { FeatureKey, TierGateMode } from '@/lib/billing';
import { useStore } from '@/lib/store';
import { PaywallUpsell } from './PaywallUpsell';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TierGateProps {
  /** Required access tier. v1.2 fixed to 'paid'. */
  tier: 'paid';
  /** Override the registry default; if omitted, uses TIER_GATE_REGISTRY[feature]. */
  mode?: TierGateMode;
  /** Key into TIER_GATE_REGISTRY — required for compile-time registry validation. */
  feature: FeatureKey;
  children: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TierGate({ mode: modeProp, feature, children }: TierGateProps) {
  // CLAUDE.md: one selector per primitive.
  const userTier = useStore((s) => s.tier);
  const reduced = useReducedMotion();

  // Source mode from prop override first, then registry default.
  const mode: TierGateMode = modeProp ?? TIER_GATE_REGISTRY[feature];

  // Gate logic: paid OR past_due → always show children (no double-gate).
  // past_due dunning chrome is Plan 14-06's job (PastDueBanner).
  if (userTier === 'paid' || userTier === 'past_due') {
    return <>{children}</>;
  }

  // userTier === 'free' — apply mode.
  switch (mode) {
    case 'hard-block-no-ui':
      return null;

    case 'hard-block-cta':
      return <PaywallUpsell variant="cta" feature={feature} />;

    case 'blur-upsell':
    default: {
      // Reduced-motion fallback: opacity-60 instead of blur filter (no transition).
      // Full motion: blur-[10px] saturate-50 filter with pointer-events suppressed.
      const blurClass = reduced
        ? 'opacity-60'
        : 'blur-[10px] saturate-50 transition-[filter,opacity] duration-200';

      return (
        <div className="relative">
          {/* Blurred children — hidden from assistive tech (aria-hidden) since
              the content is visually garbled. Screen readers see the PaywallUpsell
              overlay's accessible button instead. */}
          <div
            className={`${blurClass} pointer-events-none select-none`}
            aria-hidden="true"
          >
            {children}
          </div>
          {/* Upsell overlay centered on top of blurred content */}
          <PaywallUpsell variant="overlay" feature={feature} />
        </div>
      );
    }
  }
}
