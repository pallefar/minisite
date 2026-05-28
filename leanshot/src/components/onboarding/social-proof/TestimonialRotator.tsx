/**
 * Phase 34 Plan 34-06 (ONBOARD-12) — TestimonialRotator.
 *
 * Cycles 3 hard-coded testimonials every 30s. Respects
 * `prefers-reduced-motion` via the existing {@link useReducedMotion} hook:
 * when reduced-motion is on, auto-rotation is suppressed and the rotator
 * sticks on the first quote. (Manual cycling could be added later via
 * keyboard arrows — not in scope for this plan.)
 *
 * Privacy opt-out via localStorage flag `leanshot_social_proof_optout`;
 * when set, the component renders `null`.
 *
 * EN-only per Deferred section in 34-CONTEXT; quotes intentionally generic
 * to avoid leaking a real patient identity (T-34-06-02 / HIPAA posture).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SOCIAL_PROOF_OPTOUT_KEY } from './LiveSignupCounter';

const TESTIMONIAL_KEYS = [
  {
    quoteKey: 'onboarding:social.testimonial_0_quote',
    authorKey: 'onboarding:social.testimonial_0_author',
  },
  {
    quoteKey: 'onboarding:social.testimonial_1_quote',
    authorKey: 'onboarding:social.testimonial_1_author',
  },
  {
    quoteKey: 'onboarding:social.testimonial_2_quote',
    authorKey: 'onboarding:social.testimonial_2_author',
  },
] as const;

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(SOCIAL_PROOF_OPTOUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function TestimonialRotator() {
  const { t } = useTranslation('onboarding');
  const [optedOut] = useState<boolean>(() => isOptedOut());
  const reducedMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (optedOut || reducedMotion) return;
    const interval = window.setInterval(() => {
      setIdx((i) => (i + 1) % TESTIMONIAL_KEYS.length);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [optedOut, reducedMotion]);

  if (optedOut) return null;
  const keys = TESTIMONIAL_KEYS[idx];
  return (
    <figure className="text-sm">
      <blockquote className="text-[var(--color-text)]">&ldquo;{t(keys.quoteKey)}&rdquo;</blockquote>
      <figcaption className="text-[var(--color-text-muted)] mt-1">— {t(keys.authorKey)}</figcaption>
    </figure>
  );
}

export default TestimonialRotator;
