/**
 * Phase 42 Plan 42-07 (POLISH-12) — UTC quarter computation helper.
 *
 * Extracted from `nps-quarterly-enqueue/index.ts` so unit tests can import it
 * without pulling in `Deno.serve(...)` at module load. The enqueue Fn re-exports
 * it for backward compatibility.
 */

/** Return 'YYYY-QN' for the given UTC instant. */
export function currentQuarter(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0..11
  const q = Math.floor(m / 3) + 1; // 1..4
  return `${y}-Q${q}`;
}
