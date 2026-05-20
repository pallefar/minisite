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
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SOCIAL_PROOF_OPTOUT_KEY } from './LiveSignupCounter';

const TESTIMONIALS = [
  {
    quote:
      "Finally a place where my doctor and I look at the same picture. The drug-level chart settled six months of confusion in one visit.",
    author: 'Jordan, on tirzepatide',
  },
  {
    quote:
      "Logging takes ten seconds and the rotation map keeps me honest. I haven't given myself two doses in the same spot since I started.",
    author: 'Priya, on semaglutide',
  },
  {
    quote:
      "The doctor report saved me from having to summarise three months on the spot. I just brought the share link.",
    author: 'Marco, GLP-1 patient',
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
  const [optedOut] = useState<boolean>(() => isOptedOut());
  const reducedMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (optedOut || reducedMotion) return;
    const interval = window.setInterval(() => {
      setIdx((i) => (i + 1) % TESTIMONIALS.length);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [optedOut, reducedMotion]);

  if (optedOut) return null;
  const t = TESTIMONIALS[idx];
  return (
    <figure className="text-sm">
      <blockquote className="text-[var(--color-text)]">&ldquo;{t.quote}&rdquo;</blockquote>
      <figcaption className="text-[var(--color-text-muted)] mt-1">— {t.author}</figcaption>
    </figure>
  );
}

export default TestimonialRotator;
