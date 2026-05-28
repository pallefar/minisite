/**
 * Phase 22 Plan 22-06 — MemberFlagsTab (ADMIN-05 D-08, UI-SPEC line 256).
 *
 * Lists every known feature flag (read from `public.feature_flags` mirror,
 * shipped in 19-04 via `loadFeatureFlags`). Each row has:
 *   - flag name + current default
 *   - "Overridden" badge if an active override row exists
 *   - per-row override toggle (on/off Pill) + expires-at date input
 *   - "Set override" button → admin_set_feature_flag_override RPC
 *
 * The admin RPC ships in migration 20270601000004_feature_flag_overrides_table.sql
 * (Phase 22 Wave 0 Plan 22-01). RLS prevents direct INSERT/UPDATE/DELETE,
 * so the RPC is the only writer (mitigates T-22-38).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { setFeatureFlagOverride } from '@/lib/admin/admin-api';
import { supabase } from '@/lib/supabase';

interface FlagRow {
  key: string;
  enabled: boolean;
}

interface OverrideRow {
  flag_key: string;
  value: boolean;
  expires_at: string;
}

export interface MemberFlagsTabProps {
  userId: string;
}

interface DraftState {
  value: boolean;
  expiresAt: string; // YYYY-MM-DD (HTML date input)
}

function defaultExpiry(): string {
  // Default: today + 30 days, in YYYY-MM-DD.
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function MemberFlagsTab({ userId }: MemberFlagsTabProps) {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const fetchAll = useCallback(async () => {
    setErrorMessage('');
    const [flagsRes, overridesRes] = await Promise.all([
      supabase.from('feature_flags').select('key, enabled'),
      supabase
        .from('feature_flag_overrides')
        .select('flag_key, value, expires_at')
        .eq('user_id', userId),
    ]);
    if (flagsRes.error) {
      console.error('[member-flags-tab] flags query failed', flagsRes.error.message);
      setErrorMessage("Couldn't load flags. Try refreshing.");
      return;
    }
    if (overridesRes.error) {
      console.error('[member-flags-tab] overrides query failed', overridesRes.error.message);
      setErrorMessage("Couldn't load overrides. Try refreshing.");
      return;
    }
    setFlags((flagsRes.data as FlagRow[] | null) ?? []);
    const oMap: Record<string, OverrideRow> = {};
    for (const row of (overridesRes.data as OverrideRow[] | null) ?? []) {
      oMap[row.flag_key] = row;
    }
    setOverrides(oMap);
  }, [userId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const draftFor = useCallback(
    (flag: FlagRow): DraftState => {
      const existing = drafts[flag.key];
      if (existing) return existing;
      const override = overrides[flag.key];
      if (override) {
        return {
          value: override.value,
          expiresAt: override.expires_at.slice(0, 10),
        };
      }
      return { value: flag.enabled, expiresAt: defaultExpiry() };
    },
    [drafts, overrides],
  );

  const setDraft = (key: string, patch: Partial<DraftState>) => {
    setDrafts((d) => ({
      ...d,
      [key]: { ...draftFor({ key, enabled: false }), ...patch },
    }));
  };

  const handleSave = async (flag: FlagRow) => {
    const draft = draftFor(flag);
    setSavingKey(flag.key);
    setStatusMessage('');
    setErrorMessage('');
    try {
      // The RPC accepts a timestamptz — append T23:59:59Z so the day picker
      // value covers the full day in UTC (admins routinely set "expire on
      // Friday" intending end-of-day).
      const expiresAtIso = new Date(`${draft.expiresAt}T23:59:59Z`).toISOString();
      await setFeatureFlagOverride({
        userId,
        flagKey: flag.key,
        value: draft.value,
        expiresAt: expiresAtIso,
      });
      setStatusMessage(`Override set for ${flag.key}.`);
      await fetchAll();
    } catch (e) {
      console.error('[member-flags-tab] setFeatureFlagOverride failed', e);
      setErrorMessage(`Couldn't set override for ${flag.key}.`);
    } finally {
      setSavingKey(null);
    }
  };

  const sortedFlags = useMemo(() => [...flags].sort((a, b) => a.key.localeCompare(b.key)), [flags]);

  return (
    <Card variant="default" padding="lg" data-testid="member-flags-tab">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold">Feature flag overrides</h3>
        {statusMessage && (
          <span role="status" className="text-xs text-[var(--color-success)]">
            {statusMessage}
          </span>
        )}
        {errorMessage && (
          <span role="alert" className="text-xs text-[var(--color-danger)]">
            {errorMessage}
          </span>
        )}
      </div>

      {sortedFlags.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No feature flags registered yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {sortedFlags.map((flag) => {
            const override = overrides[flag.key];
            const draft = draftFor(flag);
            return (
              <li
                key={flag.key}
                className="py-3 flex flex-col md:flex-row md:items-center md:gap-4"
                data-testid={`flag-row-${flag.key}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{flag.key}</span>
                    {override && <Badge tone="info">Overridden</Badge>}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    Default: {flag.enabled ? 'on' : 'off'}
                    {override && (
                      <>
                        {' · '}
                        Expires {new Date(override.expires_at).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 md:mt-0">
                  <PillGroup segmented aria-label={`Override value for ${flag.key}`}>
                    <Pill
                      size="sm"
                      active={draft.value === true}
                      onClick={() => setDraft(flag.key, { value: true })}
                      data-testid={`flag-on-${flag.key}`}
                    >
                      On
                    </Pill>
                    <Pill
                      size="sm"
                      active={draft.value === false}
                      onClick={() => setDraft(flag.key, { value: false })}
                      data-testid={`flag-off-${flag.key}`}
                    >
                      Off
                    </Pill>
                  </PillGroup>
                  <label className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1.5">
                    <span>Expires</span>
                    <input
                      type="date"
                      value={draft.expiresAt}
                      onChange={(e) => setDraft(flag.key, { expiresAt: e.target.value })}
                      className="h-8 rounded-pill border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2 text-xs"
                      aria-label={`Expires at for ${flag.key}`}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void handleSave(flag)}
                    loading={savingKey === flag.key}
                    data-testid={`flag-save-${flag.key}`}
                  >
                    Set override
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
