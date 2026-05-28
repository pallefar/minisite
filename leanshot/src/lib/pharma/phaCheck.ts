/**
 * Phase 39 Plan 39-02 — phaCheck runtime helper (D-06 layer 2 of 3).
 *
 * D-05 enumerates 5 safety-info categories that must never sit behind a
 * pharma paywall:
 *   - overdose-warning
 *   - contraindication-alert
 *   - fda-black-box
 *   - serious-adverse-event-signal
 *   - pregnancy-lactation-contraindication
 *
 * D-06 mandates THREE independent enforcement layers:
 *   1. Build-time AST rule        leanshot/eslint-rules/no-paywall-on-safety-category.cjs
 *   2. Runtime assertion          (this file) — phaCheck()
 *   3. CI grep gate               leanshot/scripts/check-no-paywall-on-safety-category.sh
 *
 * Behaviour of phaCheck():
 *   - When called with a content object whose `safety_category` is non-null,
 *     in DEV / test environments the function THROWS so the regression is
 *     loud during development. The thrown error includes the offending
 *     category value plus a pointer to D-05.
 *   - In production the function only `console.warn`s — production renders
 *     must never crash for the end-user. Layer 1 (ESLint) and layer 3 (CI
 *     grep) are the primary preventive gates; phaCheck is defense-in-depth.
 *
 * Caller contract: invoke phaCheck(content) inside any <PaywallGate> render
 * helper that does NOT statically know whether the wrapped content is a
 * safety-category record. The helper short-circuits to free-rendering at the
 * call-site after phaCheck reports.
 *
 * Environment detection: `import.meta.env.DEV` (Vite injects this at build),
 * `import.meta.env.MODE === 'test'` (Vitest sets MODE=test).
 */

/**
 * The minimal structural type phaCheck inspects. The full pharma_content
 * row contains many more fields (dosage, frequency, indication, ...) — only
 * safety_category is load-bearing for this gate.
 *
 * `safety_category` is OPTIONAL nullable so old non-safety rows (the
 * majority) pass through without a value.
 */
export interface PharmaContent {
  safety_category?: string | null;
  [k: string]: unknown;
}

/**
 * Module-level dev/test detection. Evaluated once at import time so the
 * runtime cost on every phaCheck call is a single boolean read.
 *
 * Vite injects `import.meta.env.DEV` and `import.meta.env.MODE` at build;
 * outside Vite (e.g. Node test runners that import this file directly) we
 * fall back to a safe `true` (loud-by-default) so a test harness that does
 * not set MODE still sees the throw.
 */
function isLoudEnvironment(): boolean {
  try {
    const env = import.meta.env as { DEV?: boolean; MODE?: string } | undefined;
    if (env) {
      if (env.DEV === true) return true;
      if (typeof env.MODE === 'string' && env.MODE === 'test') return true;
      if (env.DEV === false && env.MODE !== 'test') return false;
    }
  } catch {
    // import.meta.env may be undefined when imported from a non-Vite runtime.
    // Fall through to the safe default below.
  }
  // Safe default — loud unless we positively detected production.
  return true;
}

/**
 * Throws (in dev/test) or console.warn-logs (in prod) when the given content
 * object has a non-null `safety_category`. Returns void in both cases — the
 * caller has already entered the paywall-wrapped render branch; phaCheck's
 * job is to surface the violation, not to alter render output.
 *
 * The error message intentionally includes:
 *   - the offending safety_category value (for diff context in logs/CI)
 *   - the D-05 / D-06 references (for the engineer who hits this)
 *   - the three layers of enforcement (so the fix-target is unambiguous)
 */
export function phaCheck(content: PharmaContent): void {
  const category = content?.safety_category;
  if (category === null || category === undefined) {
    return;
  }
  const message =
    `Pharma paywall surface received content with safety_category="${String(category)}" — ` +
    `D-05 lists this as one of 5 never-paywalled categories. Move this content out ` +
    `of the paywall wrapper or revise the gate decision. ` +
    `See Phase 39 D-06 (three layers: ESLint AST + this runtime check + CI grep).`;
  if (isLoudEnvironment()) {
    throw new Error(message);
  }
  // Production: warn-log only — never crash a real user's render.

  console.warn(message);
}
