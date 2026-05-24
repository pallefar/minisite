/**
 * Phase 51 Plan 51-09 Task 3 (TRAFFIC-04 + TRAFFIC-05 + TRAFFIC-12) —
 * Channel-taxonomy admin sub-page. Replaces the Plan 51-05 stub.
 *
 * Two sections:
 *   1. Channel Groups — list + add/edit/delete via upsert_channel_group /
 *      delete_channel_group SECDEF RPCs (Task 2 migration). The
 *      `is_default_fallback=true` row (Direct) is non-deletable; the Delete
 *      action is hidden in the UI and additionally protected server-side
 *      by raise 23514.
 *   2. Referrer Domain Rules — list + add/edit/delete via
 *      upsert_referrer_rule / delete_referrer_rule.
 *
 * Match-rule editor is a `<textarea>` with client-side JSON.parse validation
 * before save (T-51-37 mitigation; server-side jsonb cast is the redundant
 * gate).
 *
 * Slot contract (Plan 51-05 SUMMARY): named export `TrafficTaxonomyPage:
 * React.FC`, zero props. Typography ceiling 11/13/18 px only (28 reserved
 * for Real-time tab).
 */
import { useCallback, useEffect, useState } from 'react';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

type ChannelGroup = {
  id: string;
  label: string;
  priority: number;
  match_rule_jsonb: Record<string, unknown>;
  attribution_window_days: number;
  is_default_fallback: boolean;
};

type ReferrerRule = {
  id: string;
  referrer_domain: string;
  channel_group_label: string;
  priority: number;
};

type EditableCG = Partial<ChannelGroup> & { match_rule_text?: string };
type EditableRR = Partial<ReferrerRule>;

type DeleteTarget = { kind: 'cg' | 'rr'; id: string; label: string };

export const TrafficTaxonomyPage: React.FC = () => {
  const [cgs, setCgs] = useState<ChannelGroup[] | null>(null);
  const [rrs, setRrs] = useState<ReferrerRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editCg, setEditCg] = useState<EditableCG | null>(null);
  const [editRr, setEditRr] = useState<EditableRR | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: cgData, error: cgErr }, { data: rrData, error: rrErr }] = await Promise.all([
      supabase
        .from('channel_groups')
        .select('*')
        .order('priority', { ascending: true }),
      supabase
        .from('referrer_channel_rules')
        .select('*')
        .order('priority', { ascending: true })
        .order('referrer_domain', { ascending: true }),
    ]);
    if (cgErr || rrErr) {
      const err = cgErr ?? rrErr;
      if (err?.code === '42501') {
        setError('Permission denied — admin role required');
      } else {
        setError(`Failed to load taxonomy — ${err?.message ?? 'unknown error'}`);
      }
      setCgs(null);
      setRrs(null);
    } else {
      setCgs((cgData as ChannelGroup[] | null) ?? []);
      setRrs((rrData as ReferrerRule[] | null) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const saveCg = async () => {
    if (!editCg) return;
    setJsonError(null);

    // T-51-37 mitigation: validate JSON before sending.
    let parsed: Record<string, unknown> = {};
    const text =
      editCg.match_rule_text ??
      JSON.stringify(editCg.match_rule_jsonb ?? {}, null, 2);
    try {
      const candidate = JSON.parse(text) as unknown;
      if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        setJsonError('Match rule must be a JSON object');
        return;
      }
      parsed = candidate as Record<string, unknown>;
    } catch {
      setJsonError('Match rule must be valid JSON');
      return;
    }

    if (
      editCg.attribution_window_days == null ||
      editCg.attribution_window_days < 1 ||
      editCg.attribution_window_days > 90
    ) {
      setJsonError('Attribution window must be 1–90');
      return;
    }

    const { error: rpcErr } = await supabase.rpc('upsert_channel_group', {
      p_id: editCg.id ?? null,
      p_label: editCg.label,
      p_priority: editCg.priority,
      p_match_rule_jsonb: parsed,
      p_attribution_window_days: editCg.attribution_window_days,
    });
    if (rpcErr) {
      showToast(`Save failed: ${rpcErr.message}`);
      return;
    }
    setEditCg(null);
    showToast('Saved');
    void fetchAll();
  };

  const saveRr = async () => {
    if (!editRr) return;
    if (!editRr.referrer_domain) {
      showToast('Save failed: referrer_domain is required');
      return;
    }
    const { error: rpcErr } = await supabase.rpc('upsert_referrer_rule', {
      p_id: editRr.id ?? null,
      p_referrer_domain: editRr.referrer_domain,
      p_channel_group_label: editRr.channel_group_label,
      p_priority: editRr.priority ?? 50,
    });
    if (rpcErr) {
      showToast(`Save failed: ${rpcErr.message}`);
      return;
    }
    setEditRr(null);
    showToast('Saved');
    void fetchAll();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const rpc =
      confirmDelete.kind === 'cg' ? 'delete_channel_group' : 'delete_referrer_rule';
    const { error: rpcErr } = await supabase.rpc(rpc, { p_id: confirmDelete.id });
    if (rpcErr) {
      showToast(`Delete failed: ${rpcErr.message}`);
      return;
    }
    setConfirmDelete(null);
    showToast('Deleted');
    void fetchAll();
  };

  const beginAddCg = () =>
    setEditCg({
      id: undefined,
      label: '',
      priority: 50,
      match_rule_jsonb: {},
      attribution_window_days: 30,
      match_rule_text: '{}',
      is_default_fallback: false,
    });
  const beginEditCg = (cg: ChannelGroup) =>
    setEditCg({
      ...cg,
      match_rule_text: JSON.stringify(cg.match_rule_jsonb ?? {}, null, 2),
    });
  const beginAddRr = () =>
    setEditRr({
      id: undefined,
      referrer_domain: '',
      channel_group_label: 'Referral',
      priority: 50,
    });
  const beginEditRr = (rr: ReferrerRule) => setEditRr({ ...rr });

  return (
    <section>
      <h1 className="text-[18px] font-bold mb-1">Channel Taxonomy</h1>
      <p className="text-[11px] text-[var(--color-text-secondary)] mb-6">
        Rules below classify raw UTM + referrer into channel groups. Edits apply at next matview refresh.
      </p>

      {loading && cgs == null && rrs == null && (
        <Skeleton className="h-32 rounded-card mb-4" />
      )}

      {error && (
        <Card padding="md">
          <p className="text-[13px] text-[var(--color-danger)]" role="status">
            {error}
          </p>
        </Card>
      )}

      {!error && cgs != null && (
        <Card padding="md" className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
              Channel Groups
            </h2>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Plus size={12} aria-hidden />}
              onClick={beginAddCg}
              aria-label="Add channel group"
            >
              + Add channel group
            </Button>
          </div>
          {cgs.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              No channel groups configured. Seed defaults will populate on first matview refresh.
            </p>
          ) : (
            <ul>
              {cgs.map((cg) => (
                <li
                  key={cg.id}
                  className="flex items-center justify-between gap-4 text-[13px] py-2 border-b border-[var(--color-border)] last:border-b-0"
                >
                  <span>
                    <span className="numerals-tabular">{cg.priority}</span>
                    {' · '}
                    <strong>{cg.label}</strong>
                    {' · window '}
                    <span className="numerals-tabular">{cg.attribution_window_days}</span>
                    d
                    {cg.is_default_fallback && ' (fallback)'}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Edit size={12} aria-hidden />}
                      aria-label={`Edit ${cg.label}`}
                      onClick={() => beginEditCg(cg)}
                    >
                      Edit
                    </Button>
                    {!cg.is_default_fallback && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<Trash2 size={12} aria-hidden />}
                        aria-label={`Delete ${cg.label}`}
                        onClick={() =>
                          setConfirmDelete({ kind: 'cg', id: cg.id, label: cg.label })
                        }
                      >
                        Delete
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!error && rrs != null && (
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
              Referrer Domain Rules
            </h2>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Plus size={12} aria-hidden />}
              onClick={beginAddRr}
              aria-label="Add referrer rule"
            >
              + Add referrer rule
            </Button>
          </div>
          {rrs.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              No referrer rules configured. Seeded ~80 well-known domains will populate on migration apply.
            </p>
          ) : (
            <ul>
              {rrs.map((rr) => (
                <li
                  key={rr.id}
                  className="flex items-center justify-between gap-4 text-[13px] py-2 border-b border-[var(--color-border)] last:border-b-0"
                >
                  <span>
                    <span className="numerals-tabular">{rr.priority}</span>
                    {' · '}
                    <strong>{rr.referrer_domain}</strong>
                    {' → '}
                    {rr.channel_group_label}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Edit size={12} aria-hidden />}
                      aria-label={`Edit ${rr.referrer_domain}`}
                      onClick={() => beginEditRr(rr)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Trash2 size={12} aria-hidden />}
                      aria-label={`Delete ${rr.referrer_domain}`}
                      onClick={() =>
                        setConfirmDelete({
                          kind: 'rr',
                          id: rr.id,
                          label: rr.referrer_domain,
                        })
                      }
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Edit drawer — Channel Group */}
      <Sheet
        open={editCg != null}
        onClose={() => setEditCg(null)}
        title={editCg?.id ? 'Edit channel group' : 'Add channel group'}
      >
        {editCg && (
          <div className="space-y-3">
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Label
              </span>
              <Input
                value={editCg.label ?? ''}
                onChange={(e) => setEditCg({ ...editCg, label: e.target.value })}
                aria-label="Channel group label"
              />
            </label>
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Priority (1 = highest)
              </span>
              <Input
                type="number"
                value={editCg.priority ?? 50}
                onChange={(e) =>
                  setEditCg({ ...editCg, priority: Number(e.target.value) })
                }
                aria-label="Channel group priority"
              />
            </label>
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Attribution window (days, 1-90)
              </span>
              <Input
                type="number"
                min={1}
                max={90}
                value={editCg.attribution_window_days ?? 30}
                onChange={(e) =>
                  setEditCg({
                    ...editCg,
                    attribution_window_days: Number(e.target.value),
                  })
                }
                aria-label="Attribution window days"
              />
            </label>
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Match rule (JSON)
              </span>
              <textarea
                className="w-full p-2 rounded-card border border-[var(--color-border)] text-[13px] font-mono bg-[var(--color-surface)]"
                rows={6}
                value={editCg.match_rule_text ?? ''}
                onChange={(e) =>
                  setEditCg({ ...editCg, match_rule_text: e.target.value })
                }
                placeholder='{"utm_medium": ["cpc","ppc"], "utm_source": ["google","bing"]}'
                aria-label="Match rule JSON"
              />
            </label>
            {jsonError && (
              <p className="text-[13px] text-[var(--color-danger)]" role="status">
                {jsonError}
              </p>
            )}
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              Changes will take effect at the next matview refresh (typically within 15 minutes).
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={() => setEditCg(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void saveCg()}>
                Save rule
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Edit drawer — Referrer Rule */}
      <Sheet
        open={editRr != null}
        onClose={() => setEditRr(null)}
        title={editRr?.id ? 'Edit referrer rule' : 'Add referrer rule'}
      >
        {editRr && cgs != null && (
          <div className="space-y-3">
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Referrer domain
              </span>
              <Input
                value={editRr.referrer_domain ?? ''}
                onChange={(e) =>
                  setEditRr({ ...editRr, referrer_domain: e.target.value })
                }
                placeholder="example.com"
                aria-label="Referrer domain"
              />
            </label>
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Channel group
              </span>
              <select
                className="w-full p-2 rounded-card border border-[var(--color-border)] text-[13px] bg-[var(--color-surface)]"
                value={editRr.channel_group_label ?? 'Referral'}
                onChange={(e) =>
                  setEditRr({ ...editRr, channel_group_label: e.target.value })
                }
                aria-label="Channel group selector"
              >
                {cgs.map((cg) => (
                  <option key={cg.id} value={cg.label}>
                    {cg.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px]">
              <span className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-1">
                Priority
              </span>
              <Input
                type="number"
                value={editRr.priority ?? 50}
                onChange={(e) =>
                  setEditRr({ ...editRr, priority: Number(e.target.value) })
                }
                aria-label="Referrer rule priority"
              />
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={() => setEditRr(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void saveRr()}>
                Save rule
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Destructive Confirm */}
      {confirmDelete && (
        <ConfirmModal
          open={true}
          title={
            confirmDelete.kind === 'cg'
              ? 'Delete this channel group?'
              : 'Delete this referrer rule?'
          }
          message={
            confirmDelete.kind === 'cg'
              ? `Visits previously matched to "${confirmDelete.label}" will reclassify to "Direct" at next matview refresh. This is reversible by re-creating the rule.`
              : `Visits from ${confirmDelete.label} will reclassify per remaining rules (or to "Direct" if no match).`
          }
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3 rounded-card text-[13px] shadow-[var(--shadow)]"
        >
          {toast}
        </div>
      )}
    </section>
  );
};

export default TrafficTaxonomyPage;
