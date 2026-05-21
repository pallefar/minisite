/**
 * Phase 40 Plan 40-05 — CancellationRoiTab placeholder.
 *
 * This stub ships with Plan 40-05 so CancellationModule builds cleanly.
 * Plan 40-06 owns the real ROI dashboard (cancellation_offers_log metrics,
 * Chart.js bar+line, CSV export Edge Fn). 40-06 overwrites this file entirely.
 *
 * Per planner coordination: 40-05 ships the stub; 40-06 is the single writer.
 */
export default function CancellationRoiTab() {
  return (
    <div className="py-8 px-4 text-center text-sm text-[var(--color-text-secondary)]">
      <p className="font-medium text-[var(--color-text)]">ROI Dashboard</p>
      <p className="mt-1">Coming in Plan 40-06 — offer take-rate analytics + CSV export.</p>
    </div>
  );
}
