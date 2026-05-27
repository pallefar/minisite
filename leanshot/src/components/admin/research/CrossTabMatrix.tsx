/**
 * Phase 62 Plan 62-04 — CrossTabMatrix.
 *
 * Pure display table with differential privacy caption and suppressed-cell rendering.
 * Suppressed cells (null values) render as '—' in text-tertiary.
 *
 * Typography: 11px for headers, 13px for cell values.
 * All @theme tokens verified present in src/index.css.
 *
 * Per UI-SPEC Surface 1:
 *  - Column headers: 11px/400, text-tertiary, uppercase, tracking
 *  - Cell values: 13px/400
 *  - Suppressed cells: '—' with text-tertiary + title="Suppressed — cohort below k-floor"
 *  - Row hover: --color-admin-table-row-hover
 *  - Caption: ε = {epsilon} (differential privacy noise applied) — 11px, text-tertiary
 */

export interface CrossTabRow {
  label: string;
  values: Array<number | null>;
}

export interface CrossTabMatrixProps {
  rows: CrossTabRow[];
  columns: string[];
  epsilon: number;
  suppressedBuckets: number;
}

export function CrossTabMatrix({ rows, columns, epsilon, suppressedBuckets }: CrossTabMatrixProps) {
  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-text-secondary)]">No cross-tab data</p>
    );
  }

  return (
    <div>
      <h2 className="text-[18px] font-semibold text-[var(--color-text)] mb-4">
        Cross-Tab Analysis
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="text-[11px] text-[var(--color-text-tertiary)] text-left pb-2">
            ε = {epsilon} (differential privacy noise applied)
            {suppressedBuckets > 0 &&
              ` — ${suppressedBuckets} sub-group${suppressedBuckets !== 1 ? 's' : ''} suppressed`}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-[0.06em] text-left px-3 py-2"
              >
                Segment
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-[0.06em] text-right px-3 py-2"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-t border-[var(--color-border)] hover:bg-[var(--color-admin-table-row-hover)] transition-colors"
              >
                <td className="text-[13px] font-semibold text-[var(--color-text)] px-3 py-2">
                  {row.label}
                </td>
                {row.values.map((v, i) => (
                  <td
                     
                    key={i}
                    className="text-[13px] text-right px-3 py-2"
                  >
                    {v !== null ? (
                      v.toFixed(1)
                    ) : (
                      <span
                        className="text-[var(--color-text-tertiary)]"
                        title="Suppressed — cohort below k-floor"
                      >
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CrossTabMatrix;
