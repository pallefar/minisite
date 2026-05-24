/**
 * Phase 39 Plan 39-04 — safety carveout helper extracted from PaywallGate
 * to satisfy the D-06 layer 3 CI grep gate (scripts/check-no-paywall-on-
 * safety-category.sh).
 *
 * The grep gate flags any source file where (comment-stripped) BOTH
 * `Paywall*` identifier AND a `safety_category` reference appear, because
 * it cannot statically distinguish "uses safety_category to ENFORCE the
 * carveout" from "renders safety_category INSIDE a paywall". By moving
 * the safety_category read into a sibling helper file, PaywallGate.tsx
 * no longer mentions `safety_category` directly — only the helper does —
 * and the gate passes per the script's own "split into two files"
 * carveout guidance.
 *
 * Behaviour: `shouldShortCircuitForSafety(content)` calls phaCheck
 * (defense-in-depth D-06 layer 2) inside try/catch, then returns true
 * when the content has a non-null safety_category — i.e. when the
 * PaywallGate cascade must render children directly (D-05).
 */
import { phaCheck, type PharmaContent } from '@/lib/pharma/phaCheck';

export function shouldShortCircuitForSafety(content: PharmaContent): boolean {
  try {
    phaCheck(content);
    return Boolean(content?.safety_category);
  } catch {
    // phaCheck throw in dev/test means the gate WAS asked about a
    // safety-category content; honour the carveout regardless.
    return true;
  }
}
