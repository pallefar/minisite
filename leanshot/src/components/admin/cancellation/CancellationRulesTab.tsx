/**
 * Phase 40 Plan 40-05 — CancellationRulesTab.
 *
 * Top-level layout for the /admin/cancellation Rules subsection.
 * Split panel:
 *   Left (40% on md+, full on mobile): RuleListPanel — ordered rule list with
 *     drag-reorder, active toggle, delete-with-undo, add-rule CTA.
 *   Right (60% on md+): RuleEditor — create / edit form for a single rule.
 *
 * Empty state when no rules exist: EmptyState with "Add rule" CTA.
 *
 * D-05: cohort-aware rule CRUD.
 * D-13: catalog coupon picker (6 fixed combos).
 * D-04: clinic-org fork — editor surfaces contact_csm only for clinic org_type.
 */
import { ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AdminRole } from '@/lib/admin/roles';
import { RuleEditor } from './RuleEditor';
import { RuleListPanel } from './RuleListPanel';
import type { SaveOfferRule } from './types';

interface CancellationRulesTabProps {
  adminRole: AdminRole | null;
}

export default function CancellationRulesTab({ adminRole }: CancellationRulesTabProps) {
  const [rules, setRules] = useState<SaveOfferRule[]>([]);
  const [selectedRule, setSelectedRule] = useState<SaveOfferRule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleRulesLoaded = (loadedRules: SaveOfferRule[]) => {
    setRules(loadedRules);
    setHasLoaded(true);
  };

  const handleRuleUpdated = (updated: SaveOfferRule) => {
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    if (selectedRule?.id === updated.id) setSelectedRule(updated);
  };

  const handleRuleDeleted = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    if (selectedRule?.id === id) {
      setSelectedRule(null);
      setIsCreating(false);
    }
  };

  const handleRuleCreated = (created: SaveOfferRule) => {
    setRules((prev) => [...prev, created]);
    setSelectedRule(created);
    setIsCreating(false);
  };

  const handleReorder = (reordered: SaveOfferRule[]) => {
    setRules(reordered);
  };

  const handleAddRule = () => {
    setSelectedRule(null);
    setIsCreating(true);
  };

  const handleCancelEdit = () => {
    setSelectedRule(null);
    setIsCreating(false);
  };

  // Empty state when rules list has loaded but is empty
  const showEmpty = hasLoaded && rules.length === 0 && !isCreating;

  if (showEmpty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px]">
        <EmptyState
          illustration={<ShieldOff size={40} aria-hidden="true" />}
          title="No save-offer rules yet"
          body="Create your first rule to start personalising cancellation save-offers by cohort, tenure, and cancellation reason."
          cta={
            <Button variant="primary" onClick={handleAddRule}>
              Add rule
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Left pane: rule list (40% on md+, full width on mobile) */}
      <div className="w-full md:w-2/5 flex-shrink-0">
        <RuleListPanel
          adminRole={adminRole}
          rules={rules}
          selectedRuleId={selectedRule?.id ?? null}
          onRulesLoaded={handleRulesLoaded}
          onSelectRule={(rule) => { setSelectedRule(rule); setIsCreating(false); }}
          onAddRule={handleAddRule}
          onRuleUpdated={handleRuleUpdated}
          onRuleDeleted={handleRuleDeleted}
          onReorder={handleReorder}
        />
      </div>

      {/* Right pane: rule editor (60% on md+, full width on mobile) */}
      <div className="w-full md:w-3/5">
        {(selectedRule ?? isCreating) ? (
          <RuleEditor
            adminRole={adminRole}
            rule={selectedRule}
            onCreated={handleRuleCreated}
            onUpdated={handleRuleUpdated}
            onCancel={handleCancelEdit}
          />
        ) : (
          <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-[var(--color-text-secondary)]">
            Select a rule to edit or click &ldquo;Add rule&rdquo; to create a new one.
          </div>
        )}
      </div>
    </div>
  );
}
