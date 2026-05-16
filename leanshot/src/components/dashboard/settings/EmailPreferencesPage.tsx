/**
 * Phase 22 plan 22-11 — Email preference center (ON-03).
 *
 * Self-serve UI for users to toggle which lifecycle email categories they want.
 * Surfaced at `/settings/email-preferences` (routing wiring lands in plan 22-12).
 *
 * Categories per UI-SPEC §`/settings/email-preferences` lines 357-368 + Copywriting
 * lines 632-653:
 *   1. Transactional (locked-on, disabled toggle with tooltip)
 *   2. Welcome series
 *   3. Activity prompts (behavior-triggered)
 *   4. Tips and check-ins (retention)
 *   5. Weekly digest
 *   6. Affiliate updates (only rendered if user is an affiliate)
 *
 * Persistence contract per plan 22-02 SUMMARY:
 *   - POST to `lifecycle-preference-update` Edge Fn
 *   - Body: `{categories: {welcome, behavior_triggered, retention, weekly_digest, affiliate}}`
 *   - The Fn INSERTs a fresh `consent_records` row (append-only history per GDPR Art 7(1));
 *     reads the most-recent row to seed defaults.
 *
 * Defaults (when no consent_records row exists yet):
 *   welcome=true, behavior_triggered=true, retention=true, weekly_digest=false, affiliate=true
 *   (matches the lifecycle Fns' opt-in posture at v1.2; user can opt out at any time.)
 */
import { Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

interface CategoryPrefs {
  welcome: boolean;
  behavior_triggered: boolean;
  retention: boolean;
  weekly_digest: boolean;
  affiliate: boolean;
}

const DEFAULT_PREFS: CategoryPrefs = {
  welcome: true,
  behavior_triggered: true,
  retention: true,
  weekly_digest: false,
  affiliate: true,
};

interface CategoryRowSpec {
  key: keyof CategoryPrefs;
  label: string;
  body: string;
  // When true, the row only renders for users with an affiliates row.
  affiliateGated?: boolean;
}

const CATEGORIES: CategoryRowSpec[] = [
  {
    key: 'welcome',
    label: 'Welcome series',
    body: 'A short series of getting-started tips in your first week.',
  },
  {
    key: 'behavior_triggered',
    label: 'Activity prompts',
    body: "Reminders when you've missed a dose or hit a milestone.",
  },
  {
    key: 'retention',
    label: 'Tips and check-ins',
    body: "Occasional re-engagement emails when you've been away.",
  },
  {
    key: 'weekly_digest',
    label: 'Weekly digest',
    body: 'Your week in numbers, every Monday.',
  },
  {
    key: 'affiliate',
    label: 'Affiliate updates',
    body: "Payout confirmations and program news. (Only if you're an affiliate.)",
    affiliateGated: true,
  },
];

/**
 * Fetch the most-recent `consent_records.email_preferences` JSONB for the
 * current user. Returns `null` when no row exists (UI falls back to DEFAULT_PREFS).
 */
async function fetchCurrentPreferences(userId: string): Promise<Partial<CategoryPrefs> | null> {
  const { data, error } = await supabase
    .from('consent_records')
    .select('email_preferences')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const prefs = (data[0] as { email_preferences?: unknown }).email_preferences;
  if (!prefs || typeof prefs !== 'object') return null;
  return prefs as Partial<CategoryPrefs>;
}

/**
 * Resolve whether the current user is an affiliate (controls Affiliate-updates row visibility).
 */
async function fetchIsAffiliate(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('affiliates')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

export function EmailPreferencesPage() {
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? null;
  const toast = useToast();

  const [prefs, setPrefs] = useState<CategoryPrefs>(DEFAULT_PREFS);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Initial fetch — both the consent state + the affiliate-gate flag.
  useEffect(() => {
    if (!userId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [serverPrefs, isAff] = await Promise.all([
        fetchCurrentPreferences(userId),
        fetchIsAffiliate(userId),
      ]);
      if (cancelled) return;
      if (serverPrefs) {
        setPrefs({ ...DEFAULT_PREFS, ...serverPrefs });
      }
      setIsAffiliate(isAff);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = useCallback((key: keyof CategoryPrefs, next: boolean) => {
    setPrefs((p) => ({ ...p, [key]: next }));
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('lifecycle-preference-update', {
        body: { categories: prefs },
      });
      if (error) throw error;
      toast('Preferences saved', 'success');
    } catch (e) {
      console.error('[email-prefs] save failed', e);
      toast("Couldn't save. Try again.", 'error');
    } finally {
      setSaving(false);
    }
  }, [prefs, toast]);

  const visibleCategories = CATEGORIES.filter((c) => !c.affiliateGated || isAffiliate);

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="size-10 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
            <Mail className="size-5" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Email preferences</h1>
        </div>
        <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
          Choose which emails you want from LeanShot. You can change these any time.
        </p>
      </div>

      <div className="space-y-3">
        {/* Transactional — locked-on row */}
        <Card padding="md" data-testid="email-pref-row-transactional">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h3 className="text-[14px] font-semibold">Transactional</h3>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Receipts, password resets, and account notices. Required — can&apos;t be disabled.
              </p>
            </div>
            <PillGroup segmented>
              <Pill
                active
                size="sm"
                disabled
                title="Required — these relate to your account and purchases"
                aria-disabled
              >
                On
              </Pill>
            </PillGroup>
          </div>
        </Card>

        {/* Toggleable categories */}
        {visibleCategories.map((cat) => (
          <Card key={cat.key} padding="md" data-testid={`email-pref-row-${cat.key}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <h3 className="text-[14px] font-semibold">{cat.label}</h3>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{cat.body}</p>
              </div>
              <PillGroup segmented>
                <Pill
                  active={prefs[cat.key]}
                  size="sm"
                  onClick={() => toggle(cat.key, true)}
                  aria-label={`${cat.label} on`}
                >
                  On
                </Pill>
                <Pill
                  active={!prefs[cat.key]}
                  size="sm"
                  onClick={() => toggle(cat.key, false)}
                  aria-label={`${cat.label} off`}
                >
                  Off
                </Pill>
              </PillGroup>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => {
            void handleSave();
          }}
          loading={saving}
          disabled={!loaded}
        >
          Save preferences
        </Button>
      </div>
    </div>
  );
}
