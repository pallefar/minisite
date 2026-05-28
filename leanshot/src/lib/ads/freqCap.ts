/**
 * Phase 56 Plan 01 — Session-local frequency cap (AD-08).
 *
 * State lives in a module-level Map (NOT localStorage) so it resets on page
 * reload, matching the per-session spec.
 *
 * Anti-pattern guard: DO NOT store counts in localStorage — that would persist
 * across sessions and defeat the session-ceiling contract.
 */

// ─── Module-level session counter ────────────────────────────────────────────

const sessionCounts = new Map<string, number>();

// ─── canShowNextImpression ───────────────────────────────────────────────────

/**
 * Returns true and increments the counter if the placement has remaining
 * impressions this session (count < sessionCeiling). Returns false (without
 * incrementing) once the ceiling is reached.
 *
 * @param placementId    Unique placement key (e.g. 'banner-home', 'sidebar').
 * @param sessionCeiling Maximum impressions allowed per session for this placement.
 * @returns              true if the impression is allowed; false if cap is hit.
 */
export function canShowNextImpression(placementId: string, sessionCeiling: number): boolean {
  const current = sessionCounts.get(placementId) ?? 0;
  if (current >= sessionCeiling) return false;
  sessionCounts.set(placementId, current + 1);
  return true;
}

// ─── resetSessionCounts ──────────────────────────────────────────────────────

/**
 * Clear all session impression counters. Intended for:
 *   - Test isolation (call in beforeEach)
 *   - SPA soft-navigation that should reset ad frequency (optional future use)
 */
export function resetSessionCounts(): void {
  sessionCounts.clear();
}
