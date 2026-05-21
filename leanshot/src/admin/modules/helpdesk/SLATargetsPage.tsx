/**
 * Phase 37 Plan 37-08 Task 3 — SLATargetsPage (HELP-12).
 *
 * Fixed 3-tier (p1, p2, p3) editor for sla_targets:
 *   first_response_minutes
 *   resolution_minutes
 *   alert_recipients (email chip input)
 *
 * Save uses supabase.from('sla_targets').upsert(..., onConflict: 'org_id,tier').
 * RLS enforces admin role server-side; UI also disables Save for non-admin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

const TIERS = ['p1', 'p2', 'p3'] as const;
type Tier = (typeof TIERS)[number];

const ADMIN_ROLES = new Set(['owner', 'support_admin', 'support_lead']);

const DEFAULTS: Record<Tier, { first: number; resolution: number }> = {
  p1: { first: 15, resolution: 240 },
  p2: { first: 60, resolution: 480 },
  p3: { first: 240, resolution: 1440 },
};

interface SlaTarget {
  id?: string;
  org_id: string;
  tier: Tier;
  first_response_minutes: number;
  resolution_minutes: number;
  alert_recipients: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SLATargetsPage(): React.JSX.Element {
  const [rowsByTier, setRowsByTier] = useState<Record<Tier, SlaTarget>>(() => {
    const init: Record<Tier, SlaTarget> = {} as Record<Tier, SlaTarget>;
    for (const t of TIERS) {
      init[t] = {
        org_id: '',
        tier: t,
        first_response_minutes: DEFAULTS[t].first,
        resolution_minutes: DEFAULTS[t].resolution,
        alert_recipients: [],
      };
    }
    return init;
  });
  const [draftRecipient, setDraftRecipient] = useState<Record<Tier, string>>(
    () => ({ p1: '', p2: '', p3: '' }),
  );
  const [role, setRole] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const canMutate = !!role && ADMIN_ROLES.has(role);

  const fetchTargets = useCallback(async () => {
    const { data, error } = (await supabase
      .from('sla_targets')
      .select(
        'id, org_id, tier, first_response_minutes, resolution_minutes, alert_recipients',
      )) as {
      data: SlaTarget[] | null;
      error: { message: string } | null;
    };
    if (error) {
      setErr(error.message);
      return;
    }
    setRowsByTier((prev) => {
      const next: Record<Tier, SlaTarget> = { ...prev };
      for (const row of data ?? []) {
        if (TIERS.includes(row.tier)) {
          next[row.tier] = {
            ...row,
            alert_recipients: row.alert_recipients ?? [],
          };
        }
      }
      return next;
    });
  }, []);

  const fetchRole = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('org_members')
      .select('role, org_id, user_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    const mem = data as { role?: string; org_id?: string } | null;
    setRole(mem?.role ?? null);
    setOrgId(mem?.org_id ?? null);
  }, []);

  useEffect(() => {
    void fetchTargets();
    void fetchRole();
  }, [fetchTargets, fetchRole]);

  const updateRow = useCallback(
    (tier: Tier, patch: Partial<SlaTarget>): void => {
      setRowsByTier((prev) => ({
        ...prev,
        [tier]: { ...prev[tier], ...patch },
      }));
    },
    [],
  );

  const addRecipient = useCallback(
    (tier: Tier): void => {
      const raw = draftRecipient[tier].trim();
      if (!raw) return;
      if (!EMAIL_RE.test(raw)) {
        setErr(`Invalid email: ${raw}`);
        return;
      }
      setErr(null);
      const current = rowsByTier[tier].alert_recipients;
      if (current.includes(raw)) {
        setDraftRecipient((p) => ({ ...p, [tier]: '' }));
        return;
      }
      updateRow(tier, { alert_recipients: [...current, raw] });
      setDraftRecipient((p) => ({ ...p, [tier]: '' }));
    },
    [draftRecipient, rowsByTier, updateRow],
  );

  const removeRecipient = useCallback(
    (tier: Tier, email: string): void => {
      const current = rowsByTier[tier].alert_recipients;
      updateRow(tier, {
        alert_recipients: current.filter((e) => e !== email),
      });
    },
    [rowsByTier, updateRow],
  );

  const handleSave = useCallback(async () => {
    if (!canMutate) return;
    // Validate.
    for (const t of TIERS) {
      const r = rowsByTier[t];
      if (r.first_response_minutes <= 0 || r.resolution_minutes <= 0) {
        setErr(`${t}: minutes must be > 0`);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    setSaveMsg(null);
    const rows = TIERS.map((t) => ({
      org_id: rowsByTier[t].org_id || orgId,
      tier: t,
      first_response_minutes: rowsByTier[t].first_response_minutes,
      resolution_minutes: rowsByTier[t].resolution_minutes,
      alert_recipients: rowsByTier[t].alert_recipients,
      updated_at: new Date().toISOString(),
    }));
    const { error } = (await supabase
      .from('sla_targets')
      .upsert(rows, { onConflict: 'org_id,tier' })) as {
      error: { message: string } | null;
    };
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSaveMsg('Saved');
    await fetchTargets();
    setTimeout(() => setSaveMsg(null), 2000);
  }, [canMutate, rowsByTier, orgId, fetchTargets]);

  const headerRow = useMemo(
    () => (
      <div className="grid grid-cols-[60px_1fr_1fr_2fr] gap-2 text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] border-b border-[var(--color-border)] pb-2">
        <span>Tier</span>
        <span>First response (min)</span>
        <span>Resolution (min)</span>
        <span>Alert recipients</span>
      </div>
    ),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">SLA targets</h2>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canMutate || busy}
          aria-label="Save all"
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          Save all
        </button>
      </div>
      {err && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {err}
        </p>
      )}
      {saveMsg && (
        <p role="status" className="text-xs text-[var(--color-success)]">
          {saveMsg}
        </p>
      )}
      {!canMutate && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Read-only (role: {role ?? 'unknown'})
        </p>
      )}

      <div className="flex flex-col gap-3">
        {headerRow}
        {TIERS.map((t) => {
          const r = rowsByTier[t];
          return (
            <div
              key={t}
              className="grid grid-cols-[60px_1fr_1fr_2fr] gap-2 items-start"
            >
              <span className="text-sm font-mono uppercase pt-1">{t}</span>
              <input
                aria-label={`${t} first response minutes`}
                type="number"
                min={1}
                value={r.first_response_minutes}
                onChange={(e) =>
                  updateRow(t, { first_response_minutes: Number(e.target.value) })
                }
                disabled={!canMutate}
                className="px-2 py-1 text-sm border border-[var(--color-border)] rounded disabled:opacity-50"
              />
              <input
                aria-label={`${t} resolution minutes`}
                type="number"
                min={1}
                value={r.resolution_minutes}
                onChange={(e) =>
                  updateRow(t, { resolution_minutes: Number(e.target.value) })
                }
                disabled={!canMutate}
                className="px-2 py-1 text-sm border border-[var(--color-border)] rounded disabled:opacity-50"
              />
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap gap-1">
                  {r.alert_recipients.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-[var(--color-surface-elevated)]"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeRecipient(t, email)}
                        disabled={!canMutate}
                        aria-label={`Remove ${email}`}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] disabled:opacity-50"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  aria-label={`${t} add recipient`}
                  type="email"
                  value={draftRecipient[t]}
                  onChange={(e) =>
                    setDraftRecipient((p) => ({ ...p, [t]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addRecipient(t);
                    }
                  }}
                  placeholder="email@example.com, then press Enter"
                  disabled={!canMutate}
                  className="px-2 py-1 text-xs border border-[var(--color-border)] rounded disabled:opacity-50"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
