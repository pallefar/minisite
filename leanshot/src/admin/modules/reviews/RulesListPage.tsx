/**
 * Phase 36 Plan 36-04 Task 2 — RulesListPage (Surface D).
 *
 * Calls SECDEF RPC list_review_prompt_rules (Wave 1) and renders rule cards
 * (active pill + trigger event + cohort filter + cooldown summary + kebab actions).
 *
 * New / Edit opens RuleFormPanel; Delete opens ConfirmModal then calls the
 * delete_review_prompt_rule RPC.
 */
import { MoreVertical } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import RuleFormPanel, { type ReviewRule } from './RuleFormPanel';

interface RuleRow extends ReviewRule {
  created_at: string;
}

export default function RulesListPage(): React.JSX.Element {
  const toast = useToast();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RuleRow | undefined>(undefined);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RuleRow | null>(null);

  const fetchRules = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase.rpc('list_review_prompt_rules');
    if (error) {
      toast(`Could not load rules: ${error.message}`, 'error');
      setRules([]);
      return;
    }
    setRules(((data ?? []) as RuleRow[]) ?? []);
  }, [toast]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  function openNew(): void {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(rule: RuleRow): void {
    setEditing(rule);
    setFormOpen(true);
    setOpenMenuId(null);
  }

  async function handleTogglePause(rule: RuleRow): Promise<void> {
    setOpenMenuId(null);
    const { error } = await supabase.rpc('update_review_prompt_rule', {
      p_id: rule.id,
      p_name: rule.name,
      p_trigger_event: rule.trigger_event,
      p_cohort_id: rule.cohort_id,
      p_active: !rule.active,
    });
    if (error) {
      toast(`Could not toggle rule: ${error.message}`, 'error');
      return;
    }
    toast(rule.active ? 'Rule paused' : 'Rule activated', 'success');
    await fetchRules();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDelete) return;
    const rule = confirmDelete;
    setConfirmDelete(null);
    const { error } = await supabase.rpc('delete_review_prompt_rule', { p_id: rule.id });
    if (error) {
      toast(`Could not delete rule: ${error.message}`, 'error');
      return;
    }
    toast('Rule deleted', 'success');
    await fetchRules();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Review Prompt Rules</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Single-condition rules that fire the NPS prompt. Cooldown enforced server-side.
          </p>
        </div>
        {rules && rules.length > 0 && (
          <Button variant="primary" size="sm" onClick={openNew}>
            New rule
          </Button>
        )}
      </header>

      {rules === null ? (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] motion-safe:animate-pulse"
            />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No review rules yet"
          body="Create your first rule to start collecting NPS from users who hit positive moments."
          cta={
            <Button variant="primary" size="sm" onClick={openNew}>
              Create first rule
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li key={rule.id}>
              <Card variant="default" padding="md">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge tone={rule.active ? 'success' : 'neutral'}>
                    {rule.active ? 'Active' : 'Paused'}
                  </Badge>
                  <span className="font-semibold">{rule.name}</span>
                  <code className="text-[13px] font-mono text-[var(--color-text-secondary)]">
                    {rule.trigger_event}
                  </code>
                  <span className="text-[13px] text-[var(--color-text-tertiary)]">
                    {rule.cohort_id ? `Cohort: ${rule.cohort_id.slice(0, 8)}…` : 'All users'}
                  </span>
                  <span className="text-[13px] text-[var(--color-text-tertiary)] ms-auto">
                    30d per-user · 60d global · 5 lifetime cap
                  </span>

                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Rule actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === rule.id}
                      onClick={() => setOpenMenuId((id) => (id === rule.id ? null : rule.id))}
                      className="p-1 rounded-md hover:bg-[var(--color-surface-elevated)]"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenuId === rule.id && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 z-10 min-w-[140px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md shadow-md py-1"
                      >
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => openEdit(rule)}
                          className="w-full text-start px-3 py-1.5 text-sm hover:bg-[var(--color-surface-elevated)]"
                        >
                          Edit
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => void handleTogglePause(rule)}
                          className="w-full text-start px-3 py-1.5 text-sm hover:bg-[var(--color-surface-elevated)]"
                        >
                          {rule.active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setConfirmDelete(rule);
                          }}
                          className="w-full text-start px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-elevated)]"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <RuleFormPanel
        open={formOpen}
        rule={editing}
        onSave={() => {
          setFormOpen(false);
          void fetchRules();
        }}
        onCancel={() => setFormOpen(false)}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete ? `Delete rule '${confirmDelete.name}'?` : ''}
        message="Existing fires in history are preserved. New triggers stop immediately."
        confirmLabel="Delete rule"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
