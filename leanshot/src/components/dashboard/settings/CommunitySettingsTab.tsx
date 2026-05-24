/**
 * Phase 45 Plan 07a — Settings → Community subtab.
 *
 * Hosts the 5 community-related profile toggles:
 *   - directory_opt_in     — be discoverable in the member directory
 *   - dm_open              — accept DMs from other members
 *   - show_tier_badge      — render tier badge on profile/posts
 *   - show_streak_badge    — render streak badge on profile/posts
 *   - leaderboard_opt_in   — appear on community leaderboards
 *
 * Plus a 6th admin_digest_opt_in toggle that is rendered ONLY when the user's
 * profile carries is_staff=true (D-11 — staff digest opt-in).
 *
 * Each toggle writes through `supabase.from('profiles').update({...}).eq('id', userId)`
 * with optimistic local state + revert on error.
 *
 * Integration into SettingsPage is owned by sibling plan 45-07b (or a later
 * close-out plan); this file ships as a standalone tab component.
 *
 * Analog: leanshot/src/components/dashboard/settings/LeaderboardsSubtab.tsx
 */
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

import { Card, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ─── Toggle catalog ──────────────────────────────────────────────────────────

/**
 * The 5 base community toggles. Each maps directly to a boolean column on
 * `public.profiles` (P45 schema migration 20270727000001_p45_schema.sql).
 */
const BASE_TOGGLES = [
  {
    key: 'directory_opt_in',
    label: 'Show me in the member directory',
    description:
      'Other members in your tier/clinic can find your profile and send you messages.',
  },
  {
    key: 'dm_open',
    label: 'Accept direct messages',
    description: 'When off, other members cannot start new DM threads with you.',
  },
  {
    key: 'show_tier_badge',
    label: 'Show my tier badge',
    description: 'Display your Free / Trial / Pro / Lifetime badge on your profile and posts.',
  },
  {
    key: 'show_streak_badge',
    label: 'Show my streak badge',
    description: 'Display your current logging streak on your profile and posts.',
  },
  {
    key: 'leaderboard_opt_in',
    label: 'Appear on community leaderboards',
    description: 'When off, your handle is hidden from all space leaderboards.',
  },
] as const;

type ToggleKey =
  | 'directory_opt_in'
  | 'dm_open'
  | 'show_tier_badge'
  | 'show_streak_badge'
  | 'leaderboard_opt_in'
  | 'admin_digest_opt_in';

type CommunityPrefs = Record<ToggleKey, boolean> & { is_staff: boolean };

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunitySettingsTab() {
  // CLAUDE.md: one selector per primitive.
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const toast = useToast();

  const [prefs, setPrefs] = useState<CommunityPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<ToggleKey | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in, admin_digest_opt_in, is_staff',
        )
        .eq('id', userId)
        .single();

      if (cancelled) return;
      if (error || !data) {
        toast('Could not load community settings', 'error');
        setLoading(false);
        return;
      }
      setPrefs({
        directory_opt_in: !!data.directory_opt_in,
        dm_open: !!data.dm_open,
        show_tier_badge: !!data.show_tier_badge,
        show_streak_badge: !!data.show_streak_badge,
        leaderboard_opt_in: !!data.leaderboard_opt_in,
        admin_digest_opt_in: !!data.admin_digest_opt_in,
        is_staff: !!data.is_staff,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, toast]);

  const updateToggle = async (key: ToggleKey, next: boolean): Promise<void> => {
    if (!userId || !prefs) return;
    const prev = prefs[key];
    // Optimistic
    setPrefs({ ...prefs, [key]: next });
    setPendingKey(key);

    const { error } = await supabase
      .from('profiles')
      .update({ [key]: next })
      .eq('id', userId);

    setPendingKey(null);

    if (error) {
      // Revert
      setPrefs({ ...prefs, [key]: prev });
      toast(`Could not update ${key}: ${error.message}`, 'error');
      return;
    }
    toast('Saved', 'success');
  };

  if (!userId) {
    return (
      <Card variant="flat">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Sign in to manage community settings.
        </p>
      </Card>
    );
  }

  if (loading || !prefs) {
    return (
      <Card variant="flat">
        <p className="text-sm text-[var(--color-text-secondary)]" role="status" aria-live="polite">
          Loading community settings…
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card variant="elevated">
        <CardHeader title="Community" icon={<Users className="size-4" aria-hidden />} />
        <div className="space-y-4">
          {BASE_TOGGLES.map((toggle) => {
            const checked = prefs[toggle.key];
            const busy = pendingKey === toggle.key;
            return (
              <div key={toggle.key} className="flex items-start gap-3">
                <input
                  id={`toggle-${toggle.key}`}
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => void updateToggle(toggle.key, e.target.checked)}
                  aria-label={toggle.label}
                  className="mt-1 rounded"
                />
                <label htmlFor={`toggle-${toggle.key}`} className="flex-1 cursor-pointer">
                  <span className="block text-[13px] font-medium text-[var(--color-text)]">
                    {toggle.label}
                  </span>
                  <span className="block text-xs text-[var(--color-text-secondary)]">
                    {toggle.description}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Staff-only: admin_digest_opt_in. Rendered only when prefs.is_staff === true. */}
      {prefs.is_staff && (
        <Card variant="elevated">
          <CardHeader title="Admin tools" />
          <div className="flex items-start gap-3">
            <input
              id="toggle-admin_digest_opt_in"
              type="checkbox"
              checked={prefs.admin_digest_opt_in}
              disabled={pendingKey === 'admin_digest_opt_in'}
              onChange={(e) => void updateToggle('admin_digest_opt_in', e.target.checked)}
              aria-label="Receive admin report digest"
              className="mt-1 rounded"
            />
            <label htmlFor="toggle-admin_digest_opt_in" className="flex-1 cursor-pointer">
              <span className="block text-[13px] font-medium text-[var(--color-text)]">
                Receive admin report digest
              </span>
              <span className="block text-xs text-[var(--color-text-secondary)]">
                Get a daily email digest of new community reports requiring review.
              </span>
            </label>
          </div>
        </Card>
      )}
    </div>
  );
}

export default CommunitySettingsTab;
