/**
 * Phase 39 Plan 39-05 Task 2 — sibling helper that reads the D-05 sentinel
 * column out of the content row so PharmaContentBlock.tsx itself does not
 * contain BOTH the Paywall* identifier AND the sentinel column name in the
 * same file. The D-06 layer 3 CI grep gate
 * (scripts/check-no-paywall-on-safety-category.sh) flags any source file
 * with both, comment-stripped — see the gate's own "split into two files"
 * carveout (option 3 of the failure message).
 *
 * Mirrors the same pattern PaywallGate uses via ./safety-carveout.ts.
 *
 * This file deliberately does NOT import PaywallGate / PaywallModal /
 * anything Paywall-named; that is what keeps the gate happy.
 */
export interface SafetyDescribable {
  safety_category?: string | null;
}

export interface SafetyRenderDecision {
  /** True when the content row is a D-05 always-free safety entry. */
  isSafety: boolean;
  /** Safety category label suitable for SafetyInfoBadge `category` prop. */
  label: string;
}

/**
 * Decide whether the supplied content row falls under the D-05 "always
 * free" carveout. Returns the category label too so the caller can render
 * the SafetyInfoBadge without re-reading the sentinel column itself.
 */
export function describesSafetyInfo(content: SafetyDescribable): SafetyRenderDecision {
  const value = content?.safety_category;
  if (typeof value === 'string' && value.length > 0) {
    return { isSafety: true, label: value };
  }
  return { isSafety: false, label: '' };
}

/** Returns the raw sentinel label or null. Used by the upgrade-CTA copy fallback. */
export function getSafetyCategoryLabel(content: SafetyDescribable): string | null {
  const value = content?.safety_category;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
