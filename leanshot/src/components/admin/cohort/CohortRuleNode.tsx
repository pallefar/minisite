/**
 * Phase 27 Plan 27-02 — CohortRuleNode (recursive builder tile).
 *
 * Renders a single node in the cohort rule tree:
 *
 *   - BRANCH (`{op:'and'|'or', children}`): bordered card with an AND/OR
 *     toggle pill, a vertical stack of children, an "Add condition" + "Add
 *     group" button pair, and an optional "Remove group" handle.
 *   - LEAF (`{field, op, value}`): horizontal row of CohortFieldPicker,
 *     OpPicker, and a value control whose input-type is derived from the
 *     selected field's FIELD_KIND.
 *
 * Owns NO state — the parent (`AdminCohortBuilder`) owns the immutable tree
 * and reflects edits via `onChange(next)`. This keeps re-renders local to
 * the touched branch.
 *
 * Defense in depth: the value-input type is constrained per FIELD_KIND, but
 * the schema layer (`ruleTreeSchema`) and the SQL layer (`cohort_validate_rule`)
 * are still authoritative — this UI is layer #1 of 3.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Pill, PillGroup } from '@/components/ui/Pill';
import {
  FIELD_ALLOWLIST,
  FIELD_ENUM_OPTIONS,
  FIELD_KIND,
  type FieldKind,
  type RuleField,
} from '@/lib/cohort/field-allowlist';
import {
  isBranch,
  isLeaf,
  type RuleLeaf,
  type RuleNode,
  type RuleOp,
} from '@/lib/cohort/rule-tree-schema';
import { CohortFieldPicker } from './CohortFieldPicker';

const OPS_BY_KIND: Record<FieldKind, readonly RuleOp[]> = {
  text: ['=', '!=', 'in', 'is_null', 'is_not_null'],
  enum: ['=', '!=', 'in', 'is_null', 'is_not_null'],
  number: ['=', '!=', '>', '<', '>=', '<=', 'is_null', 'is_not_null'],
  boolean: ['=', 'is_null', 'is_not_null'],
};

const DEFAULT_LEAF: RuleLeaf = { field: FIELD_ALLOWLIST[0], op: '=', value: '' };

export interface CohortRuleNodeProps {
  node: RuleNode;
  depth: number;
  onChange: (next: RuleNode) => void;
  onRemove?: () => void;
}

export function CohortRuleNode({
  node,
  depth,
  onChange,
  onRemove,
}: CohortRuleNodeProps) {
  if (isLeaf(node)) {
    return <LeafEditor leaf={node} onChange={onChange} onRemove={onRemove} />;
  }
  if (isBranch(node)) {
    return (
      <BranchEditor
        branch={node}
        depth={depth}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }
  return null;
}

// ─── Branch ─────────────────────────────────────────────────────────────────

function BranchEditor({
  branch,
  depth,
  onChange,
  onRemove,
}: {
  branch: { op: 'and' | 'or'; children: readonly RuleNode[] };
  depth: number;
  onChange: (next: RuleNode) => void;
  onRemove?: () => void;
}) {
  const setChildren = (next: readonly RuleNode[]) =>
    onChange({ op: branch.op, children: next });
  const setOp = (next: 'and' | 'or') =>
    onChange({ op: next, children: branch.children });

  const updateChild = (i: number, next: RuleNode) => {
    const copy = [...branch.children];
    copy[i] = next;
    setChildren(copy);
  };
  const removeChild = (i: number) => {
    const copy = branch.children.filter((_, idx) => idx !== i);
    setChildren(copy);
  };
  const addCondition = () => setChildren([...branch.children, { ...DEFAULT_LEAF }]);
  const addGroup = () =>
    setChildren([
      ...branch.children,
      { op: 'and', children: [{ ...DEFAULT_LEAF }] },
    ]);

  return (
    <div
      className="border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-surface)]"
      data-testid={`cohort-branch-d${depth}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <PillGroup segmented aria-label="Combinator">
          <Pill
            active={branch.op === 'and'}
            onClick={() => setOp('and')}
            aria-label="Match all (AND)"
            size="sm"
          >
            AND
          </Pill>
          <Pill
            active={branch.op === 'or'}
            onClick={() => setOp('or')}
            aria-label="Match any (OR)"
            size="sm"
          >
            OR
          </Pill>
        </PillGroup>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {branch.children.length} condition{branch.children.length === 1 ? '' : 's'}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
            aria-label="Remove group"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="space-y-2 pl-2 border-l-2 border-[var(--color-border)]">
        {branch.children.map((child, i) => (
          <CohortRuleNode
            key={i}
            node={child}
            depth={depth + 1}
            onChange={(next) => updateChild(i, next)}
            onRemove={() => removeChild(i)}
          />
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Button variant="ghost" size="sm" onClick={addCondition}>
          <Plus size={14} aria-hidden="true" /> Add condition
        </Button>
        <Button variant="ghost" size="sm" onClick={addGroup}>
          <Plus size={14} aria-hidden="true" /> Add group
        </Button>
      </div>
    </div>
  );
}

// ─── Leaf ───────────────────────────────────────────────────────────────────

function LeafEditor({
  leaf,
  onChange,
  onRemove,
}: {
  leaf: RuleLeaf;
  onChange: (next: RuleNode) => void;
  onRemove?: () => void;
}) {
  const kind = FIELD_KIND[leaf.field];
  const opsForKind = OPS_BY_KIND[kind];
  const opIsNullCheck = leaf.op === 'is_null' || leaf.op === 'is_not_null';
  const opIsIn = leaf.op === 'in';

  const setField = (next: RuleField) => {
    // Reset op + value when field changes to keep the leaf in a valid shape.
    onChange({ field: next, op: '=', value: '' });
  };
  const setOp = (next: RuleOp) => {
    if (next === 'is_null' || next === 'is_not_null') {
      onChange({ field: leaf.field, op: next });
    } else if (next === 'in') {
      onChange({ field: leaf.field, op: 'in', value: [] });
    } else {
      onChange({
        field: leaf.field,
        op: next,
        value: kind === 'number' ? 0 : kind === 'boolean' ? false : '',
      } as RuleLeaf);
    }
  };
  const setValue = (next: unknown) => {
    onChange({ field: leaf.field, op: leaf.op, value: next } as RuleLeaf);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="cohort-leaf">
      <CohortFieldPicker value={leaf.field} onChange={setField} />
      <select
        aria-label="Operator"
        value={leaf.op}
        onChange={(e) => setOp(e.target.value as RuleOp)}
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
      >
        {opsForKind.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {!opIsNullCheck && (
        <ValueInput
          kind={kind}
          field={leaf.field}
          op={leaf.op}
          value={
            opIsIn
              ? (leaf.value as unknown as string[] | undefined)
              : (leaf.value as unknown as string | number | boolean | undefined)
          }
          onChange={setValue}
        />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
          aria-label="Remove condition"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── Value input (varies by FieldKind + op) ─────────────────────────────────

function ValueInput({
  kind,
  field,
  op,
  value,
  onChange,
}: {
  kind: FieldKind;
  field: RuleField;
  op: RuleOp;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (op === 'in') {
    const list = Array.isArray(value) ? (value as unknown[]).map(String) : [];
    return (
      <input
        aria-label="Value (comma-separated)"
        type="text"
        value={list.join(', ')}
        onChange={(e) => {
          const items = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          // Coerce based on field kind.
          const coerced =
            kind === 'number' ? items.map((s) => Number(s)) : items;
          onChange(coerced);
        }}
        placeholder="free, pro"
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm min-w-[180px]"
      />
    );
  }

  if (kind === 'enum') {
    const options = FIELD_ENUM_OPTIONS[field] ?? [];
    return (
      <select
        aria-label="Value"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
      >
        <option value="">— choose —</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (kind === 'number') {
    return (
      <input
        aria-label="Value"
        type="number"
        value={typeof value === 'number' ? value : Number(value ?? 0)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm w-24"
      />
    );
  }

  if (kind === 'boolean') {
    return (
      <select
        aria-label="Value"
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  // text
  return (
    <input
      aria-label="Value"
      type="text"
      value={typeof value === 'string' ? value : String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm min-w-[140px]"
    />
  );
}
