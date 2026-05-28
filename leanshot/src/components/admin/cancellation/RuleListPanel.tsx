/**
 * Phase 40 Plan 40-05 — RuleListPanel.
 *
 * Left-pane rule list for the Rules subsection.
 * Features:
 *   - Loads save_offer_rules ordered by priority ASC
 *   - Drag-to-reorder via HTML5 drag events (fires save_offer_rule_reorder)
 *   - Active toggle (optimistic, fires save_offer_rule_update)
 *   - Delete (fires save_offer_rule_archive with confirmation)
 *   - Add-rule CTA button at bottom
 *
 * Role gate: Edit/Delete/Toggle buttons hidden when !canWrite.
 * (UX hint only — SECDEF RPCs enforce at DB).
 *
 * D-05: cohort-aware rule list.
 * T-40-05-06: Every mutation calls SECDEF RPC which logs admin action.
 */
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';
import type { SaveOfferRule } from './types';

interface RuleListPanelProps {
  adminRole: AdminRole | null;
  rules: SaveOfferRule[];
  selectedRuleId: string | null;
  onRulesLoaded: (rules: SaveOfferRule[]) => void;
  onSelectRule: (rule: SaveOfferRule) => void;
  onAddRule: () => void;
  onRuleUpdated: (rule: SaveOfferRule) => void;
  onRuleDeleted: (id: string) => void;
  onReorder: (rules: SaveOfferRule[]) => void;
}

/** Summarise offer type + coupon/preset for the rule row label */
function offerSummary(rule: SaveOfferRule): string {
  switch (rule.offer_type) {
    case 'pause':
      return `Pause · ${rule.pause_months ?? '?'}mo`;
    case 'discount':
      return `Discount · ${rule.coupon_id ?? 'no coupon'}`;
    case 'extended_trial':
      return `Extended trial · ${rule.extension_days ?? '?'}d`;
    case 'downgrade':
      return 'Downgrade to monthly';
    case 'contact_csm':
      return 'Contact CSM';
    default:
      return rule.offer_type;
  }
}

export function RuleListPanel({
  adminRole,
  rules,
  selectedRuleId,
  onRulesLoaded,
  onSelectRule,
  onAddRule,
  onRuleUpdated,
  onRuleDeleted,
  onReorder,
}: RuleListPanelProps) {
  const toast = useToast();
  const canWrite = hasMinRole(adminRole, 'admin');

  // ── Load rules ────────────────────────────────────────────────────────────

  useEffect(() => {
    void supabase
      .from('save_offer_rules')
      .select('*, cohort_definitions(name, member_count)')
      .order('priority', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          onRulesLoaded(data as SaveOfferRule[]);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drag-reorder via HTML5 drag events ───────────────────────────────────

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const handleDragEnd = useCallback(async () => {
    const from = dragIndex;
    const to = dragOverRef.current;
    setDragIndex(null);
    dragOverRef.current = null;
    if (from == null || to == null || from === to) return;

    const reordered = [...rules];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    onReorder(reordered);

    const ids = reordered.map((r) => r.id);
    const { error } = await supabase.rpc('save_offer_rule_reorder', { p_ids: ids });
    if (error) {
      toast('Failed to reorder rules. Changes reverted.', 'error');
      onReorder(rules); // revert
    }
  }, [dragIndex, rules, onReorder, toast]);

  // ── Active toggle ────────────────────────────────────────────────────────

  const handleToggleActive = useCallback(
    async (rule: SaveOfferRule) => {
      const newActive = !rule.active;
      // Optimistic update
      onRuleUpdated({ ...rule, active: newActive });

      const { error } = await supabase.rpc('save_offer_rule_update', {
        p_id: rule.id,
        p_title: rule.title,
        p_cohort_id: rule.cohort_id,
        p_tenure_buckets: rule.tenure_buckets,
        p_reasons: rule.reasons,
        p_org_type: rule.org_type,
        p_offer_type: rule.offer_type,
        p_pause_months: rule.pause_months,
        p_coupon_id: rule.coupon_id,
        p_extension_days: rule.extension_days,
        p_downgrade_target: rule.downgrade_target,
        p_priority: rule.priority,
        p_active: newActive,
      });

      if (error) {
        // Revert optimistic update
        onRuleUpdated({ ...rule, active: rule.active });
        toast('Failed to update rule status.', 'error');
      }
    },
    [onRuleUpdated, toast],
  );

  // ── Archive / Delete ─────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (rule: SaveOfferRule) => {
      if (!window.confirm(`Archive "${rule.title}"? This cannot be undone from the UI.`)) return;

      const { error } = await supabase.rpc('save_offer_rule_archive', { p_id: rule.id });
      if (error) {
        toast('Failed to archive rule.', 'error');
      } else {
        onRuleDeleted(rule.id);
        toast(`Rule "${rule.title}" archived.`, 'success');
      }
    },
    [onRuleDeleted, toast],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <div role="list" aria-label="Save-offer rules" className="space-y-1">
        {rules.map((rule, index) => {
          const isSelected = rule.id === selectedRuleId;
          const cohortName = rule.cohort_definitions?.name ?? null;

          return (
            <div
              key={rule.id}
              role="button"
              tabIndex={0}
              draggable={canWrite}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                dragOverRef.current = index;
              }}
              onDragEnd={() => void handleDragEnd()}
              className={[
                'group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors',
                isSelected
                  ? 'bg-[var(--color-primary-subtle)] border border-[var(--color-primary-border)]'
                  : 'border border-transparent hover:bg-[var(--color-surface-elevated)]',
                canWrite ? 'cursor-grab' : '',
              ].join(' ')}
              onClick={() => onSelectRule(rule)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectRule(rule);
                }
              }}
              aria-label={`Select rule: ${rule.title}`}
            >
              {/* Drag handle */}
              {canWrite && (
                <span className="text-[var(--color-text-tertiary)] shrink-0" aria-hidden="true">
                  <GripVertical size={16} />
                </span>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {cohortName && (
                    <Badge tone="info" className="shrink-0 max-w-[12rem] truncate text-xs">
                      {cohortName.length > 24 ? `${cohortName.slice(0, 24)}…` : cohortName}
                    </Badge>
                  )}
                  <span className="text-sm font-medium text-[var(--color-text)] truncate max-w-[18rem]">
                    {rule.title.length > 36 ? `${rule.title.slice(0, 36)}…` : rule.title}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {offerSummary(rule)}
                </p>
              </div>

              {/* Active toggle */}
              {canWrite && (
                <Pill
                  aria-pressed={rule.active}
                  aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}
                  className="shrink-0 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleActive(rule);
                  }}
                >
                  {rule.active ? 'Active' : 'Off'}
                </Pill>
              )}

              {/* Edit button */}
              {canWrite && (
                <IconButton
                  aria-label={`Edit rule: ${rule.title}`}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRule(rule);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Pencil size={14} aria-hidden="true" />
                </IconButton>
              )}

              {/* Delete/Archive button */}
              {canWrite && (
                <IconButton
                  aria-label={`Archive rule: ${rule.title}`}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(rule);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>

      {/* Add rule CTA */}
      {canWrite && (
        <div className="mt-2">
          <Button
            variant="primary"
            onClick={onAddRule}
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            block
          >
            Add rule
          </Button>
        </div>
      )}
    </div>
  );
}
