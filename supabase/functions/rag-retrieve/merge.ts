/**
 * merge.ts — Tier boost + freshness de-rank + rank-and-trim helpers.
 *
 * Phase 60 Plan 60-06. Reuses Phase 50 D-06/D-29/D-32 contracts verbatim.
 *
 * Tier weights (D-06 + D-29):
 *   A × 1.2  — highest-quality / peer-reviewed sources
 *   B × 1.0  — standard quality
 *   C × 0.85 — lower-quality / unverified sources
 *
 * Freshness de-rank (D-32):
 *   stale chunk: raw_score × 0.5 (50% penalty)
 *   stale = (now − scraped_at) > freshness_window_days
 */

/**
 * Apply tier multiplier to a raw cosine score.
 * Tier A: ×1.2, B: ×1.0, C: ×0.85.
 */
export function applyTierBoost(score: number, tier: 'A' | 'B' | 'C'): number {
  switch (tier) {
    case 'A':
      return score * 1.2;
    case 'B':
      return score * 1.0;
    case 'C':
      return score * 0.85;
    default:
      return score;
  }
}

/**
 * Determine whether a chunk is stale given its scrape date and freshness window.
 * stale = (Date.now() − new Date(scrapedAt).getTime()) / 86_400_000 > freshnessWindowDays
 */
export function isStale(scrapedAt: string, freshnessWindowDays: number): boolean {
  const ageMs = Date.now() - new Date(scrapedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  return ageDays > freshnessWindowDays;
}

/**
 * Apply freshness de-rank: stale chunks get ×0.5 penalty on their score.
 * Non-stale chunks are unchanged.
 */
export function applyFreshnessDeRank(
  score: number,
  scrapedAt: string,
  freshnessWindowDays: number,
): number {
  return isStale(scrapedAt, freshnessWindowDays) ? score * 0.5 : score;
}

/** Minimal shape required for rankAndTrim generic. */
export interface RankCandidate {
  raw_score: number;
  source_tier: 'A' | 'B' | 'C';
  scraped_at: string;
  freshness_window_days: number;
}

/**
 * Apply tier boost + freshness de-rank to every candidate, sort by final_score DESC,
 * then trim to the top-k results.
 *
 * @param results - Raw candidate rows from match_external_kb_embeddings RPC.
 * @param k - Number of results to return (slice 0..k after sorting).
 * @returns Same rows augmented with final_score (number) and stale (boolean), sorted DESC.
 */
export function rankAndTrim<T extends RankCandidate>(
  results: T[],
  k: number,
): Array<T & { final_score: number; stale: boolean }> {
  const scored = results.map((row) => {
    const boosted = applyTierBoost(row.raw_score, row.source_tier);
    const final_score = applyFreshnessDeRank(boosted, row.scraped_at, row.freshness_window_days);
    const stale = isStale(row.scraped_at, row.freshness_window_days);
    return { ...row, final_score, stale };
  });

  scored.sort((a, b) => b.final_score - a.final_score);
  return scored.slice(0, k);
}
