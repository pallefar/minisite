/**
 * Phase 44 Plan 09 — SpaceEditor (admin surface).
 *
 * Admin CRUD form for community_spaces.
 *
 * Fields:
 *   - name (required, max 80)
 *   - description (optional)
 *   - min_tier (select: free / pro / lifetime)
 *   - org_id (optional UUID — blank = global space; filled = clinic-private)
 *
 * Security:
 *   - UX layer: admin-only (AdminShell minRole gates module visibility)
 *   - DB layer: RLS cspace_insert_staff / cspace_update_staff require public.is_staff()
 *     (migration 20270720000006_p44_community_spaces_admin_policies.sql)
 *
 * Admin surface — react-router-dom is NOT used here; CommunityAdminLayout
 * uses pathname-based routing (CLAUDE.md allows react-router in admin but
 * existing admin modules use pathname-based switching; follow that convention).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpaceEditorProps {
  /** When set → edit mode; else → create mode. */
  spaceId?: string;
  onSaved: (spaceId: string) => void;
}

type MinTier = 'free' | 'pro' | 'lifetime';

const MIN_TIER_OPTIONS: Array<{ id: MinTier; label: string }> = [
  { id: 'free', label: 'Free (all tiers)' },
  { id: 'pro', label: 'Pro+ (pro, trial, lifetime)' },
  { id: 'lifetime', label: 'Lifetime only' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function SpaceEditor({ spaceId, onSaved }: SpaceEditorProps) {
  const toast = useToast();
  const isNew = !spaceId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minTier, setMinTier] = useState<MinTier>('free');
  const [orgId, setOrgId] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  // P45-08 D-14 — per-space leaderboard toggle (admin_toggle_space_leaderboard RPC).
  const [leaderboardEnabled, setLeaderboardEnabled] = useState<boolean>(false);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);

  // Load existing space for edit mode
  useEffect(() => {
    if (!spaceId) return;

    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('community_spaces')
        .select('name, description, min_tier, org_id, leaderboard_enabled')
        .eq('id', spaceId)
        .single();

      if (error || !data) {
        toast(`Failed to load space: ${error?.message ?? 'Not found'}`, 'error');
        setLoading(false);
        return;
      }

      setName(data.name ?? '');
      setDescription(data.description ?? '');
      setMinTier((data.min_tier as MinTier) ?? 'free');
      setOrgId(data.org_id ?? '');
      setLeaderboardEnabled(Boolean(data.leaderboard_enabled));
      setLoading(false);
    })();
  }, [spaceId, toast]);

  // P45-08 — leaderboard toggle handler. Independent of form Save: writes
  // through admin_toggle_space_leaderboard SECDEF RPC (is_staff() guard
  // inside — supabase/migrations/20270727000003_p45_secdef_rpcs.sql). Optimistic
  // local update; revert on RPC error. Only meaningful in edit mode (we need
  // an existing space id); in create mode the toggle is hidden.
  const handleLeaderboardToggle = async () => {
    if (!spaceId || leaderboardBusy) return;
    const next = !leaderboardEnabled;
    setLeaderboardBusy(true);
    setLeaderboardEnabled(next);

    const { error } = await supabase.rpc('admin_toggle_space_leaderboard', {
      p_space_id: spaceId,
      p_enabled: next,
    });

    if (error) {
      setLeaderboardEnabled(!next);
      toast(`Failed to update leaderboard: ${error.message}`, 'error');
    } else {
      toast(
        next ? 'Leaderboard enabled for this space.' : 'Leaderboard disabled.',
        'success',
      );
    }
    setLeaderboardBusy(false);
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const nameError = name.trim().length === 0
    ? 'Space name is required.'
    : name.length > 80
    ? 'Name must be 80 characters or fewer.'
    : '';

  const isValid = !nameError;

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      min_tier: minTier,
      org_id: orgId.trim() || null,
    };

    if (isNew) {
      const { data, error } = await supabase
        .from('community_spaces')
        .insert(payload)
        .select('id')
        .single();

      if (error || !data) {
        toast(`Failed to create space: ${error?.message ?? 'Unknown error'}`, 'error');
        setSaving(false);
        return;
      }

      toast(`Space "${payload.name}" created.`, 'success');
      onSaved((data as { id: string }).id);
    } else {
      const { error } = await supabase
        .from('community_spaces')
        .update(payload)
        .eq('id', spaceId!);

      if (error) {
        toast(`Failed to update space: ${error.message}`, 'error');
        setSaving(false);
        return;
      }

      toast(`Space "${payload.name}" updated.`, 'success');
      onSaved(spaceId!);
    }

    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading space…</div>
    );
  }

  return (
    <div className="space-y-5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] max-w-lg">
      <h3 className="text-base font-semibold">
        {isNew ? 'New community space' : `Edit space`}
      </h3>

      {/* Space name */}
      <div>
        <label htmlFor="space-name" className="block text-sm font-medium mb-1">
          Name <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
        </label>
        <Input
          id="space-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          disabled={saving}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'space-name-error' : undefined}
          placeholder="e.g. GLP-1 Questions"
        />
        {nameError && (
          <p id="space-name-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {nameError}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="space-description" className="block text-sm font-medium mb-1">
          Description (optional)
        </label>
        <textarea
          id="space-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          disabled={saving}
          rows={3}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
          placeholder="What is this space about?"
        />
      </div>

      {/* Min tier */}
      <div>
        <label htmlFor="space-min-tier" className="block text-sm font-medium mb-1">
          Minimum tier access
        </label>
        <select
          id="space-min-tier"
          value={minTier}
          onChange={(e) => setMinTier(e.target.value as MinTier)}
          disabled={saving}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
        >
          {MIN_TIER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Org ID (clinic-private) */}
      <div>
        <label htmlFor="space-org-id" className="block text-sm font-medium mb-1">
          Clinic org UUID (optional)
        </label>
        <Input
          id="space-org-id"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          disabled={saving}
          placeholder="Leave blank for global space; paste org UUID to make clinic-private"
        />
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Clinic-private spaces are hidden entirely for non-org-members (RLS D-09).
        </p>
      </div>

      {/* Leaderboard toggle (edit mode only; P45-08 D-14) */}
      {!isNew && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2">
          <div>
            <p className="text-sm font-medium">Enable leaderboard for this space</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              When enabled, members who opted in to the leaderboard see ranks +
              points within this space. Toggle persists via{' '}
              <code className="font-mono text-[10px]">admin_toggle_space_leaderboard</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLeaderboardToggle()}
            disabled={leaderboardBusy}
            aria-pressed={leaderboardEnabled}
            aria-busy={leaderboardBusy}
            aria-label={
              leaderboardEnabled
                ? 'Disable leaderboard for this space'
                : 'Enable leaderboard for this space'
            }
            className={
              'inline-flex h-7 items-center rounded-full px-4 text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ' +
              (leaderboardEnabled
                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]')
            }
          >
            {leaderboardBusy ? '…' : leaderboardEnabled ? 'On' : 'Off'}
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!isValid || saving}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : isNew ? 'Create space' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
