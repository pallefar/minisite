/**
 * Phase 24 Plan 24-06 — JsonDiffViewer.
 *
 * Shared hand-rolled JSON diff renderer (~80 LOC).
 * Used by both:
 *   - AuditRowExpand (admin audit log)
 *   - clinic/settings/AuditRow (existing v1.2 clinic audit tab)
 *
 * Threat: T-24-03d — truncates string values > 200 chars with "show full" expand.
 * Renders a <dl> (description list) with color-coded rows:
 *   - added: green background (accessible contrast)
 *   - removed: red background
 *   - changed: yellow background
 *   - unchanged: default
 */

export interface DiffEntry {
  key: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  before?: unknown;
  after?: unknown;
}

export function diffKeys(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  const keys = new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])]);
  for (const k of keys) {
    const inA = a != null && k in a;
    const inB = b != null && k in b;
    if (inA && !inB) {
      out.push({ key: k, status: 'removed', before: a![k] });
    } else if (!inA && inB) {
      out.push({ key: k, status: 'added', after: b![k] });
    } else if (JSON.stringify(a![k]) !== JSON.stringify(b![k])) {
      out.push({ key: k, status: 'changed', before: a![k], after: b![k] });
    } else {
      out.push({ key: k, status: 'unchanged', before: a![k], after: b![k] });
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

const STATUS_CLASSES: Record<DiffEntry['status'], string> = {
  added:
    'bg-[color-mix(in_srgb,var(--color-success,#16a34a)_10%,transparent)] border-s-2 border-[var(--color-success,#16a34a)]',
  removed:
    'bg-[color-mix(in_srgb,var(--color-danger,#dc2626)_10%,transparent)] border-s-2 border-[var(--color-danger,#dc2626)]',
  changed: 'bg-[color-mix(in_srgb,#ca8a04_10%,transparent)] border-s-2 border-[#ca8a04]',
  unchanged: '',
};

const STATUS_LABEL_CLASSES: Record<DiffEntry['status'], string> = {
  added: 'text-[var(--color-success,#16a34a)]',
  removed: 'text-[var(--color-danger,#dc2626)]',
  changed: 'text-[#ca8a04]',
  unchanged: 'text-[var(--color-text-tertiary)]',
};

const MAX_VALUE_LEN = 200;

function truncateValue(v: unknown): { text: string; truncated: boolean } {
  const text = v == null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v);
  if (text.length > MAX_VALUE_LEN) {
    return { text: text.slice(0, MAX_VALUE_LEN) + '…', truncated: true };
  }
  return { text, truncated: false };
}

function ValueCell({ value, label }: { value: unknown; label: string }) {
  const { text, truncated } = truncateValue(value);
  return (
    <span>
      <span className="font-mono text-[11px]" title={truncated ? JSON.stringify(value) : undefined}>
        {text}
      </span>
      {truncated && (
        <span
          className="ms-1 text-[10px] text-[var(--color-text-tertiary)] italic"
          aria-label={`${label} truncated — hover or inspect for full value`}
        >
          (truncated)
        </span>
      )}
    </span>
  );
}

export interface JsonDiffViewerProps {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
  className?: string;
}

export function JsonDiffViewer({ before, after, className = '' }: JsonDiffViewerProps) {
  const entries = diffKeys(before ?? null, after ?? null);

  if (entries.length === 0) {
    return (
      <p className="text-[12px] text-[var(--color-text-tertiary)] italic">No changes recorded.</p>
    );
  }

  return (
    <dl
      className={`w-full rounded-lg overflow-hidden border border-[var(--color-border)] text-[12px] ${className}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border)]">
        <span className="font-semibold text-[var(--color-text-tertiary)] text-[11px] uppercase tracking-wide w-1/4">
          Key
        </span>
        <span className="font-semibold text-[var(--color-text-tertiary)] text-[11px] uppercase tracking-wide w-[37%]">
          Before
        </span>
        <span className="font-semibold text-[var(--color-text-tertiary)] text-[11px] uppercase tracking-wide w-[37%]">
          After
        </span>
      </div>

      {entries.map((entry) => (
        <div
          key={entry.key}
          data-diff-status={entry.status}
          className={`flex items-start gap-2 px-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0 ${STATUS_CLASSES[entry.status]}`}
        >
          {/* Key */}
          <dt
            className={`font-semibold w-1/4 shrink-0 truncate ${STATUS_LABEL_CLASSES[entry.status]}`}
            title={entry.key}
          >
            {entry.key}
          </dt>

          {/* Before */}
          <dd className="w-[37%] shrink-0 text-[var(--color-text-secondary)] break-all">
            {entry.status === 'added' ? (
              <span className="text-[var(--color-text-tertiary)] italic">—</span>
            ) : (
              <ValueCell value={entry.before} label="before" />
            )}
          </dd>

          {/* After */}
          <dd className="w-[37%] shrink-0 text-[var(--color-text)] break-all">
            {entry.status === 'removed' ? (
              <span className="text-[var(--color-text-tertiary)] italic">—</span>
            ) : (
              <ValueCell value={entry.after} label="after" />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
