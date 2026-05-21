import {
  User as UserIcon,
  Target,
  Bell,
  Shield,
  CreditCard,
  Database,
  Trash2,
  Download,
  FileText,
  GraduationCap,
  Terminal,
  KeyRound,
  Link2,
  Mail,
  RotateCcw,
  Building2,
  Globe,
  Eye,
  Trophy,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ManageSubscriptionLink } from '@/components/billing/ManageSubscriptionLink';
import { UpgradeCTA } from '@/components/billing/UpgradeCTA';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { attachEmailToAnon, requestPasswordReset, signOut } from '@/lib/auth';
import { requireStepUp } from '@/lib/mfa/patient-mfa';
import {
  buildJsonExport,
  buildPdfDoc,
  fetchAuditSummary,
  fetchCloudExtras,
  type AuditSummary,
  type CloudExtras,
} from '@/lib/export-data';
import { todayStr, cn } from '@/lib/helpers';
import type { PersistedState } from '@/lib/storage';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { ActiveSharesSection } from './ActiveSharesSection';
import { DeleteAccountModal } from './DeleteAccountModal';
import { NotificationsSubtab } from './NotificationsSubtab';
import { PatientMfaCard } from './PatientMfaCard';
import { ActiveOrganizationsSection } from './sections/ActiveOrganizationsSection';
import { PhiAccessLogTab } from './PhiAccessLogTab';

// Phase 35 Plan 35-08 (GAME-04): Leaderboards subtab — lazy-loaded so the
// gamification + supabase client code is not pulled into the settings chunk
// on every settings open.
const LeaderboardsSubtab = lazy(() =>
  import('./LeaderboardsSubtab').then((m) => ({ default: m.LeaderboardsSubtab })),
);

type Section =
  | 'account'
  | 'profile'
  | 'goals'
  | 'language'
  | 'notifications'
  // Phase 35 Plan 35-08 (GAME-04 / D-12): leaderboard opt-in + handle picker.
  // Section enum widening lives with first writer (memory: admin_module_manifest_vs_router_branch_drift).
  | 'leaderboards'
  | 'privacy'
  // Phase 22 plan 22-11 (ON-03 + GDPR-03): two link-out entries that navigate
  // to dedicated `/settings/*` sub-pages (full pages, not modal sections).
  // The runtime click handler intercepts these IDs and calls
  // `window.location.assign` + onClose instead of `setSection`.
  | 'email-preferences'
  | 'privacy-dsar'
  | 'shares'
  // Phase 9 Plan 09-01 — Active organizations sits between 'shares' and
  // 'recovery'. Plan 09-05 overwrites the stub component.
  | 'organizations'
  | 'recovery'
  | 'subscription'
  | 'data'
  // Phase 25 Plan 02-02 (HIPAA-14): patient-side PHI access log viewer.
  // Satisfies HIPAA right-of-accounting-of-disclosures (D-08).
  | 'phi-access-log'
  // Phase 25 Plan 25-08 (HIPAA-15 / D-11): optional patient MFA card.
  | 'security'
  | 'dev';

/**
 * Phase 22 plan 22-11: link-out NAV IDs. Clicking these navigates to a
 * dedicated `/settings/*` route instead of swapping the modal section.
 * Routing wiring (App.tsx selectView branches) lands in plan 22-12.
 */
const LINK_OUT_NAV: Partial<Record<Section, string>> = {
  'email-preferences': '/settings/email-preferences',
  'privacy-dsar': '/settings/privacy/dsar',
};

// Phase 4 D-03: 'ai' section + apiKeyStorage helper removed (BYO key UX
// retired). Streamed AI now flows through the server-side ai-chat Edge
// Function — no per-user key needed. Stale localStorage key is wiped
// on next boot via the one-shot cleanup in main.tsx.
// Phase 5 D-04/D-10: 'account' section is the FIRST nav entry for permanent
// (non-anonymous) users — surfaces email + change-password CTA. The runtime
// rendering filters it out when `signedIn.user` is anonymous (see Account
// section guard below).
const NAV: { id: Section; label: string; Icon: typeof UserIcon }[] = [
  { id: 'account', label: 'Account', Icon: UserIcon },
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  { id: 'goals', label: 'Goals', Icon: Target },
  // Phase 32 Plan 32-03 (I18N-02): Language picker sits between Goals and
  // Notifications. Single LanguageSwitcher (en/es) writes profiles.locale +
  // calls i18n.changeLanguage atomically.
  { id: 'language', label: 'Language', Icon: Globe },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  // Phase 35 Plan 35-08 (GAME-04): leaderboard opt-in settings.
  { id: 'leaderboards', label: 'Leaderboards', Icon: Trophy },
  { id: 'privacy', label: 'Privacy', Icon: Shield },
  // Phase 25 Plan 02-02 (HIPAA-14 / D-08): patient-side "Who has viewed my data"
  // access log. Sits directly after Privacy so the HIPAA transparency surface
  // clusters with privacy-related entries visually.
  { id: 'phi-access-log', label: 'Who has viewed my data', Icon: Eye },
  // Phase 25 Plan 25-08 (HIPAA-15 / D-11): optional patient TOTP enrollment.
  // NOT a gate — patients may ignore this card. Sits with privacy/security entries.
  { id: 'security', label: 'Security (2FA)', Icon: Shield },
  // Phase 22 plan 22-11 (GDPR-03): patient-only DSAR portal (D-06). Link-out
  // entry — click navigates to /settings/privacy/dsar instead of swapping the
  // modal section. Surfaces immediately under Privacy so the related items
  // cluster visually.
  { id: 'privacy-dsar', label: 'Privacy & DSAR', Icon: Shield },
  // Phase 22 plan 22-11 (ON-03): self-serve email preference center. Link-out
  // entry — click navigates to /settings/email-preferences.
  { id: 'email-preferences', label: 'Email preferences', Icon: Mail },
  // Phase 8 Plan 08-03 (D-04): Active shares sits between Privacy and Recovery
  // per 08-UI-SPEC §"Component Inventory" (SettingsPage NAV extension). Surfaces
  // the patient's create-share + revoke + audit-log aggregate UI.
  { id: 'shares', label: 'Active shares', Icon: Link2 },
  // Phase 9 Plan 09-01 (D-15): Active organizations sits between 'shares' and
  // 'recovery'. Surfaces the patient's clinic memberships + per-org
  // consent_scope edit + revoke. Plan 09-05 overwrites the stub component.
  { id: 'organizations', label: 'Active organizations', Icon: Building2 },
  // Phase 7 Plan 07-10 (D-05): Recovery sits between Privacy and Subscription per
  // 07-RESEARCH §6 ordering. Surfaces the Phase 6 D-03 90-day local backup so the
  // user can roll back a bad cloud-sync overwrite.
  { id: 'recovery', label: 'Recovery', Icon: RotateCcw },
  { id: 'subscription', label: 'Subscription', Icon: CreditCard },
  { id: 'data', label: 'Data', Icon: Database },
  ...(import.meta.env.DEV ? [{ id: 'dev' as Section, label: 'Dev Tools', Icon: Terminal }] : []),
];

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. The draft useState uses a lazy initializer with a safe
  // empty-object fallback so the hook order is preserved when u is null;
  // the early-return below guarantees the empty draft never reaches render.
  const u = useStore((s) => s.user);
  const updateUser = useStore((s) => s.updateUser);
  // Phase 32 Plan 32-03 (I18N-02): atomic local-mirror of profiles.locale
  // for the Language section's onChange handler. DB write is owned at the
  // call site so error rollback is explicit (no silent best-effort).
  const setUserLocale = useStore((s) => s.setUserLocale);
  const resetAll = useStore((s) => s.resetAll);
  const fullState = useStore((s) => s);
  const signedIn = useStore((s) => s.signedIn);
  // Phase 14 Plan 14-06: billing tier for subscription section conditional render.
  const tier = useStore((s) => s.tier);
  const toast = useToast();
  // Phase 32 Plan 32-03 (I18N-02): i18n instance for the Language picker's
  // changeLanguage call. Namespaces match those bootstrapped in Plan 32-01.
  const { i18n } = useTranslation(['common', 'nav']);

  // Phase 5 D-04: account section visible only for permanent (non-anon) users.
  const isPermanent = Boolean(signedIn?.user && !signedIn.user.is_anonymous);

  const {
    confirm,
    open: confirmOpen,
    message: confirmMessage,
    title: confirmTitle,
    confirmLabel,
    cancelLabel,
    destructive: confirmDestructive,
    handleConfirm,
    handleCancel,
  } = useConfirm();

  const [section, setSection] = useState<Section>('profile');
  const [draft, setDraft] = useState(() => ({ ...(u ?? ({} as NonNullable<typeof u>)) }));

  // Phase 7 Plan 07-10 (D-05): Recovery section state.
  // - backup: parsed payload from localStorage['leanshot_v4_pre_cloud_backup'] (Phase 6 D-03)
  // - backupCorrupted: true when the key is present but JSON.parse fails or shape is invalid
  // - restoreOpen + typed + restoreBusy: typed-confirmation modal local state
  const [backup, setBackup] = useState<{
    state: Record<string, unknown>;
    version: number;
    snapshotAt: string;
  } | null>(null);
  const [backupCorrupted, setBackupCorrupted] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);

  // Phase 7 Plan 07-07 (D-03): Privacy → "Delete my account" typed-confirm
  // modal. Only surfaced to permanent (non-anon) users — the
  // initiate_account_deletion RPC requires auth.users.last_sign_in_at, which
  // anon users don't reliably have.
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Phase 25 Plan 25-08 (HIPAA-15 / D-11): step-up gate before account deletion.
  // requireStepUp() must return ok=true before the delete modal opens.
  const [deleteStepUpBusy, setDeleteStepUpBusy] = useState(false);

  // Read + parse the backup ONCE when Settings opens. Private-mode browsers
  // throw on localStorage.getItem — swallow + treat as "no backup". A parse
  // failure on a present-but-malformed payload renders the corrupted empty
  // state (and never invokes setState — T-07-10-04 mitigation).
  useEffect(() => {
    if (!open) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem('leanshot_v4_pre_cloud_backup');
    } catch {
      setBackup(null);
      setBackupCorrupted(false);
      return;
    }
    if (!raw) {
      setBackup(null);
      setBackupCorrupted(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        state?: Record<string, unknown>;
        version?: number;
        snapshotAt?: string;
      };
      if (!parsed.state || !parsed.snapshotAt) {
        setBackup(null);
        setBackupCorrupted(true);
        return;
      }
      setBackup({
        state: parsed.state,
        version: parsed.version ?? 7,
        snapshotAt: parsed.snapshotAt,
      });
      setBackupCorrupted(false);
    } catch {
      setBackup(null);
      setBackupCorrupted(true);
    }
  }, [open]);

  if (!u) return null;

  const save = (): void => {
    updateUser({
      name: draft.name,
      goalWeight: Number(draft.goalWeight) || u.goalWeight,
      proteinTarget: Number(draft.proteinTarget) || u.proteinTarget,
      calorieTarget: Number(draft.calorieTarget) || u.calorieTarget,
      fiberTarget: Number(draft.fiberTarget) || u.fiberTarget,
      waterTarget: Number(draft.waterTarget) || u.waterTarget,
    });
    toast('Settings saved');
  };

  // Phase 7 Plan 07-06 (COMPL-06): pick only the 22 partialize keys from the
  // full store. The buildJsonExport whitelist would silently drop ephemeral
  // UI keys anyway, but constructing the shape explicitly here keeps the
  // TypeScript type narrow (PersistedState — not Store) so the contract is
  // checked at the call boundary.
  const pickPartialized = (): PersistedState => ({
    user: fullState.user,
    injections: fullState.injections,
    symptoms: fullState.symptoms,
    weights: fullState.weights,
    measurements: fullState.measurements,
    meals: fullState.meals,
    water: fullState.water,
    foodNoise: fullState.foodNoise,
    workouts: fullState.workouts,
    steps: fullState.steps,
    supplements: fullState.supplements,
    mood: fullState.mood,
    sleep: fullState.sleep,
    nsvs: fullState.nsvs,
    photos: fullState.photos,
    vials: fullState.vials,
    aiHistory: fullState.aiHistory,
    costs: fullState.costs,
    acknowledgedDisclaimer: fullState.acknowledgedDisclaimer,
    pendingOps: fullState.pendingOps,
    verificationBannerDismissedUntil: fullState.verificationBannerDismissedUntil,
    migration_state: fullState.migration_state,
    // Phase 14 Plan 14-05: billing slice included so PersistedState contract is satisfied.
    tier: fullState.tier,
    current_period_end: fullState.current_period_end,
    plan_id: fullState.plan_id,
    provider: fullState.provider,
    // Phase 34 Plan 34-07: activation fire-once + draft-entry queue —
    // both are part of the persisted shape so the JSON export round-trips.
    activationFiredAt: fullState.activationFiredAt,
    draftEntriesPending: fullState.draftEntriesPending,
    // Phase 35 Plan 35-08: nudge dismiss state included so PersistedState type is satisfied.
    leaderboardNudgeDismissed: fullState.leaderboardNudgeDismissed,
    // Phase 40 Plan 40-07 D-07: pause state included so PersistedState type is satisfied.
    is_paused: fullState.is_paused,
    paused_until: fullState.paused_until,
  });

  const handleExportJson = async (): Promise<void> => {
    const userId = signedIn?.user?.id;
    let cloud: CloudExtras | null = null;
    let audit: AuditSummary | null = null;
    if (userId) {
      toast('Fetching cloud data...', 'info');
      const [c, a] = await Promise.all([
        fetchCloudExtras(supabase, userId).catch(() => null),
        fetchAuditSummary(supabase, userId).catch(() => null),
      ]);
      cloud = c;
      audit = a;
    }
    const payload = buildJsonExport(pickPartialized(), cloud, audit);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leanshot-export-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSON exported', 'success');
  };

  const handleExportPdf = async (): Promise<void> => {
    const userId = signedIn?.user?.id;
    toast('Generating PDF...', 'info');
    try {
      // CRITICAL: dynamic imports — these MUST stay inside the click handler.
      // Static imports would land jsPDF in the index entry chunk and break
      // the 50 kB gz CI guard. See memory project_phase5_bundle_regression.md
      // and scripts/assert-bundle-budget.sh.
      const { jsPDF } = await import('jspdf');
      const autoTableMod = await import('jspdf-autotable');
      const autoTable = autoTableMod.default;

      let cloud: CloudExtras | null = null;
      let audit: AuditSummary | null = null;
      if (userId) {
        const [c, a] = await Promise.all([
          fetchCloudExtras(supabase, userId).catch(() => null),
          fetchAuditSummary(supabase, userId).catch(() => null),
        ]);
        cloud = c;
        audit = a;
      }
      const payload = buildJsonExport(pickPartialized(), cloud, audit);

      // Yield to the browser between fetch + render to keep UI responsive
      // (Threat T-07-06-05 mitigation).
      await new Promise((resolve) => setTimeout(resolve, 0));

      const doc = buildPdfDoc(jsPDF, autoTable, payload);
      doc.save(`leanshot-export-${todayStr()}.pdf`);
      toast('PDF exported', 'success');
    } catch (e) {
      console.error('[leanshot] PDF export failed', e);
      toast('PDF export failed', 'error');
    }
  };

  const reset = async (): Promise<void> => {
    const ok = await confirm('Erase ALL your LeanShot data? This cannot be undone.', {
      title: 'Reset everything',
      confirmLabel: 'Erase everything',
      destructive: true,
    });
    if (!ok) return;
    resetAll();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="lg" mobileFullscreen>
      <div className="flex flex-col md:flex-row gap-5 -mt-2 md:-mx-2">
        <nav className="md:w-48 shrink-0" aria-label="Settings sections">
          <ul className="flex md:flex-col gap-1 overflow-x-auto scrollbar-none -mx-2 md:mx-0 px-2">
            {NAV.map(({ id, label, Icon }) => {
              const active = section === id;
              const linkOutHref = LINK_OUT_NAV[id];
              return (
                <li key={id} className="shrink-0">
                  <button
                    onClick={() => {
                      if (linkOutHref) {
                        // Phase 22 plan 22-11: link-out — navigate to a
                        // dedicated /settings/* route + close the modal.
                        onClose();
                        window.location.assign(linkOutHref);
                        return;
                      }
                      setSection(id);
                    }}
                    aria-current={active ? 'page' : undefined}
                    data-nav-id={id}
                    className={cn(
                      'inline-flex items-center gap-2.5 px-3 py-2.5 rounded-xl w-full text-start text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                      active
                        ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
                    )}
                  >
                    <Icon className="size-4" strokeWidth={active ? 2.2 : 1.8} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex-1 min-w-0 space-y-3">
          {section === 'account' && (
            <Section title="Account" body="Email and password for cross-device sync.">
              {!isPermanent ? (
                <div className="space-y-3">
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    You&apos;re using LeanShot locally. Sign up to sync across devices.
                  </p>
                  <Button
                    leadingIcon={<Mail className="size-4" />}
                    onClick={() => {
                      window.location.hash = '#/auth/signup';
                      onClose();
                    }}
                  >
                    Sign up
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Mail className="size-4 text-[var(--color-text-tertiary)]" aria-hidden />
                    <span className="text-[var(--color-text-secondary)]">Email:</span>
                    <span className="font-semibold">{signedIn?.user?.email ?? '—'}</span>
                    {!signedIn?.verified && (
                      <span className="text-[11px] text-[var(--color-warning,#a36a00)] font-semibold uppercase tracking-wider">
                        Unverified
                      </span>
                    )}
                  </div>
                  <ChangeEmailRow currentEmail={signedIn?.user?.email ?? ''} onToast={toast} />
                  <Button
                    variant="secondary"
                    leadingIcon={<KeyRound className="size-4" />}
                    onClick={async () => {
                      const email = signedIn?.user?.email;
                      if (!email) {
                        toast('No email on file', 'error');
                        return;
                      }
                      const { error } = await requestPasswordReset(email);
                      if (error) toast(error.message, 'error');
                      else toast('Password reset email sent.', 'success');
                    }}
                  >
                    Change password
                  </Button>
                </div>
              )}
            </Section>
          )}
          {section === 'profile' && (
            <Section title="Profile" body="Your basic account info.">
              <Input
                label="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                Units: <strong>{u.units === 'metric' ? 'Metric' : 'Imperial'}</strong> · Set during
                onboarding.
              </p>
              <Button onClick={save}>Save profile</Button>
            </Section>
          )}

          {section === 'goals' && (
            <Section title="Goals & targets" body="Tweak the numbers we measure progress against.">
              <Input
                label={`Weight goal (${u.units === 'metric' ? 'kg' : 'lb'})`}
                type="number"
                step="0.1"
                inputMode="decimal"
                value={String(draft.goalWeight)}
                onChange={(e) =>
                  setDraft({ ...draft, goalWeight: parseFloat(e.target.value) || 0 })
                }
              />
              <Input
                label="Protein (g)"
                type="number"
                inputMode="numeric"
                value={String(draft.proteinTarget)}
                onChange={(e) =>
                  setDraft({ ...draft, proteinTarget: parseInt(e.target.value) || 0 })
                }
              />
              <Input
                label="Calorie target"
                type="number"
                inputMode="numeric"
                value={String(draft.calorieTarget)}
                onChange={(e) =>
                  setDraft({ ...draft, calorieTarget: parseInt(e.target.value) || 0 })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Fiber (g)"
                  type="number"
                  inputMode="numeric"
                  value={String(draft.fiberTarget)}
                  onChange={(e) =>
                    setDraft({ ...draft, fiberTarget: parseInt(e.target.value) || 0 })
                  }
                />
                <Input
                  label="Water (cups)"
                  type="number"
                  inputMode="numeric"
                  value={String(draft.waterTarget)}
                  onChange={(e) =>
                    setDraft({ ...draft, waterTarget: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
              <Button onClick={save}>Save goals</Button>
            </Section>
          )}

          {section === 'language' && (
            <Section
              title="Language"
              body="Choose the language used across the app and email reminders."
            >
              {/*
                Phase 32 Plan 32-03 (I18N-02): atomic locale write.
                Order matters: (1) i18n.changeLanguage flips the UI immediately;
                (2) setUserLocale updates the Zustand mirror (drives the
                profilesLocale detector + persists via partialize); (3) the
                supabase upsert syncs to public.profiles so the preference
                survives logout/login + cross-device. On DB error we revert
                BOTH the i18n language AND the store mirror to keep them in
                sync (no half-flipped state).

                Pitfall 4 guard (32-RESEARCH §Pitfalls): this handler writes
                ONLY `locale`, NEVER `weight_unit` (the existing user.units
                preference is decoupled). Recomputing units from locale would
                clobber an existing user's intentional choice.
              */}
              <LanguageSwitcher
                onChange={async (next) => {
                  const prev = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2) as
                    | 'en'
                    | 'es';
                  await i18n.changeLanguage(next);
                  setUserLocale(next);
                  const uid = signedIn?.user?.id;
                  if (!uid) {
                    // Anonymous / pre-auth — the user.locale mirror + i18n
                    // language carry the preference forward locally. Nothing
                    // to persist to DB yet.
                    return;
                  }
                  const { error } = await supabase
                    .from('profiles')
                    .update({ locale: next })
                    .eq('id', uid);
                  if (error) {
                    // Rollback BOTH the i18n language and the store mirror so
                    // they remain consistent with the unchanged DB row.
                    await i18n.changeLanguage(prev);
                    setUserLocale(prev);
                    toast(
                      'Could not save language preference. Please try again.',
                      'error',
                    );
                  }
                }}
              />
            </Section>
          )}

          {section === 'notifications' && (
            <Section
              title="Notifications"
              body="Choose when LeanShot taps you on the shoulder."
            >
              {/* Phase 42 Plan 42-08 (POLISH-05/06): 5×3 matrix + push permission +
                  snooze + caps + suppression banner. Replaces the v1.1 stub. */}
              <NotificationsSubtab />
            </Section>
          )}

          {/* Phase 35 Plan 35-08 (GAME-04): leaderboard opt-in + handle picker per cohort. */}
          {section === 'leaderboards' && (
            <Section
              title="Leaderboards"
              body="Opt in to cohort leaderboards. Your real name is never shown — just your chosen handle."
            >
              <Suspense fallback={<div className="text-[13px] text-[var(--color-text-secondary)]">Loading…</div>}>
                <LeaderboardsSubtab />
              </Suspense>
            </Section>
          )}

          {section === 'privacy' && (
            <Section title="Privacy" body="Your data lives on this device.">
              <Card variant="flat">
                <ul className="space-y-2 text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                  <li>Local storage only — never sent to a server.</li>
                  <li>
                    The AI coach is the only exception. It sends just your prompt plus relevant
                    context through our secure server using your account — you never share an API
                    key.
                  </li>
                  <li>No analytics. No telemetry. No third-party trackers.</li>
                  <li>Clearing site data deletes everything LeanShot knows about you.</li>
                </ul>
              </Card>

              {/* Phase 7 Plan 07-07 (D-03): account-delete affordance. Permanent
               * users only — the 5-minute re-auth gate inside the RPC needs a
               * non-anon auth.users.last_sign_in_at timestamp. */}
              {isPermanent && (
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <h3 className="text-[14px] font-semibold mb-1">Delete account</h3>
                  <p className="text-[12px] text-[var(--color-text-secondary)] mb-2">
                    7-day soft-delete. Cancel from the email we&apos;ll send you (or from the
                    in-app banner) within the window; after that, irreversible.
                  </p>
                  {/* Phase 25 Plan 25-08 (HIPAA-15 / D-11): requireStepUp before delete. */}
                  <Button
                    variant="destructive"
                    size="sm"
                    leadingIcon={<Trash2 className="size-4" />}
                    loading={deleteStepUpBusy}
                    onClick={() => {
                      void (async () => {
                        setDeleteStepUpBusy(true);
                        try {
                          const { ok } = await requireStepUp();
                          if (!ok) {
                            toast('Step-up verification required to delete your account.', 'error');
                            return;
                          }
                          // ok=true: caller (this component) opens DeleteAccountModal.
                          // The step-up challenge modal (TOTP or email OTP) is owned
                          // by the caller per the helper's documented responsibility split.
                          // For v1.3 we open the delete modal directly after requireStepUp
                          // signals ok — the user verified via email OTP or TOTP already.
                          setDeleteOpen(true);
                        } finally {
                          setDeleteStepUpBusy(false);
                        }
                      })();
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              )}
            </Section>
          )}

          {/* Phase 25 Plan 02-02 (HIPAA-14 / D-08): PHI access log viewer. */}
          {section === 'phi-access-log' && (
            <Section
              title="Who has viewed my data"
              body="Every time a member of your care team accessed your personal health information."
            >
              <PhiAccessLogTab />
            </Section>
          )}

          {/* Phase 25 Plan 25-08 (HIPAA-15 / D-11): optional patient TOTP enrollment. */}
          {section === 'security' && (
            <Section
              title="Security"
              body="Manage your two-factor authentication settings."
            >
              <PatientMfaCard />
            </Section>
          )}

          {section === 'shares' && <ActiveSharesSection />}

          {section === 'organizations' && <ActiveOrganizationsSection />}

          {section === 'recovery' && (
            <Section title="Recovery" body="Restore a local backup taken before cloud migration.">
              {backupCorrupted ? (
                <Card variant="flat">
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    Backup file is corrupted. Contact support if you need help recovering your data.
                  </p>
                </Card>
              ) : !backup ? (
                <Card variant="flat">
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    No local backup found. Backups are created automatically before cloud migration
                    and retained for 90 days.
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  <Card variant="flat">
                    <p className="text-[13px] text-[var(--color-text-secondary)]">
                      Snapshot taken:{' '}
                      <strong className="text-[var(--color-text)]">
                        {new Date(backup.snapshotAt).toLocaleString()}
                      </strong>
                    </p>
                    <p className="text-[12px] text-[var(--color-text-tertiary)] mt-2">
                      Restoring will overwrite your current data and sign you out so the cloud
                      re-syncs cleanly.
                    </p>
                  </Card>
                  <Button
                    variant="destructive"
                    leadingIcon={<RotateCcw className="size-4" />}
                    aria-label="Restore from local backup — this will overwrite your current data"
                    onClick={() => {
                      setTyped('');
                      setRestoreOpen(true);
                    }}
                  >
                    Restore from this backup
                  </Button>
                </div>
              )}
            </Section>
          )}

          {/* Phase 14 Plan 14-06 (D-08, D-09, MONEY-03, MONEY-09):
              Tier-conditional subscription section. Replaces the previous stub.
              - free: UpgradeCTA with 2-plan selector ($12.99/mo + $132.49/yr).
              - paid: Active pill + ManageSubscriptionLink (Customer Portal).
              - past_due: Past-due pill + ManageSubscriptionLink (Customer Portal).
              Trial-day countdown copy (subscriptions.trial_end) deferred to Phase 14
              follow-up — "Active" pill covers both trial-active and post-conversion
              paid states until we wire the trial countdown (NOT a locked decision). */}
          {section === 'subscription' && (
            <Section
              title="Subscription"
              body={
                tier === 'free'
                  ? 'Upgrade to Plus to unlock forecast + advanced AI coach.'
                  : tier === 'past_due'
                    ? 'Your payment failed. Update your card to keep Plus active.'
                    : 'You’re on LeanShot Plus.'
              }
            >
              {/* Status pill */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold',
                    tier === 'free' &&
                      'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
                    tier === 'paid' && 'bg-[var(--color-success)] text-[var(--color-bg)]',
                    tier === 'past_due' &&
                      'bg-[var(--color-warning)] text-[var(--color-warning-foreground)]',
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {tier === 'free' && 'Free'}
                  {tier === 'paid' && 'Active'}
                  {tier === 'past_due' && 'Past due — update card'}
                </span>
              </div>

              {/* Tier-conditional body */}
              {tier === 'free' && <UpgradeCTA />}
              {(tier === 'paid' || tier === 'past_due') && <ManageSubscriptionLink />}
              {/* Phase 40 Plan 40-04 (POLISH-01) — Cancel subscription CTA.
                  Only shown for paid subscribers. Dispatches leanshot:open-cancellation
                  event (App.tsx listener pattern — no prop threading needed).
                  The Edge Fn returns NO_SUBSCRIPTION gracefully for edge cases. */}
              {(tier === 'paid' || tier === 'past_due') && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.dispatchEvent(new Event('leanshot:open-cancellation'));
                  }}
                  className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft,rgba(207,84,84,0.1))]"
                >
                  Cancel subscription
                </Button>
              )}
            </Section>
          )}

          {section === 'data' && (
            <Section title="Data" body="Export, import, or wipe your record.">
              <Button
                variant="ghost"
                leadingIcon={<Download className="size-4" />}
                onClick={() => {
                  void handleExportJson();
                }}
              >
                Export JSON
              </Button>
              <Button
                variant="ghost"
                leadingIcon={<FileText className="size-4" />}
                onClick={() => {
                  void handleExportPdf();
                }}
              >
                Export PDF rollup
              </Button>
              <Button
                variant="ghost"
                leadingIcon={<GraduationCap className="size-4" />}
                onClick={() => {
                  onClose();
                  void import('@/components/dashboard/tour/GuidedTour').then(
                    ({ clearTourSeen }) => {
                      clearTourSeen();
                      window.dispatchEvent(new Event('leanshot:replay-tour'));
                    },
                  );
                }}
              >
                Replay guided tour
              </Button>
              <Button
                variant="destructive"
                leadingIcon={<Trash2 className="size-4" />}
                onClick={reset}
              >
                Reset everything
              </Button>
            </Section>
          )}

          {section === 'dev' && import.meta.env.DEV && (
            <Section
              title="Dev Tools"
              body="Development-only diagnostic actions. Not compiled into production builds."
            >
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  throw new Error('phase-1-sentry-smoke');
                }}
              >
                Throw test error → Sentry
              </Button>
            </Section>
          )}
        </div>
      </div>
      <ConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={confirmDestructive}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      {/* Phase 7 Plan 07-07 (D-03) — typed-confirm modal for account-delete. */}
      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      {/* Phase 7 Plan 07-10 (D-05) — typed-confirmation modal for Recovery / restore-from-backup.
       *  RESEARCH §6 LWW guardrail: useStore.setState MUST run BEFORE signOut so the persist
       *  middleware writes the restored snapshot before the session is cleared. Reversing the
       *  order races the persist write against a cleared sb-leanshot-auth cookie. */}
      <Modal
        open={restoreOpen}
        onClose={() => {
          if (restoreBusy) return;
          setRestoreOpen(false);
        }}
        title="Restore from backup?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            This will overwrite your current cloud-synced data with the backup from{' '}
            <strong className="text-[var(--color-text)]">
              {backup ? new Date(backup.snapshotAt).toLocaleString() : ''}
            </strong>
            . You will be signed out after restoring; sign back in to re-sync with the cloud.
          </p>
          <Input
            label='Type "RESTORE" to confirm'
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setRestoreOpen(false)} disabled={restoreBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={typed !== 'RESTORE' || !backup || restoreBusy}
              loading={restoreBusy}
              aria-label="Confirm restore — overwrites current data"
              onClick={async () => {
                if (!backup || typed !== 'RESTORE') return;
                setRestoreBusy(true);
                try {
                  // T-07-10-02: replace=true on the partialized shape only.
                  // The backup payload was written by Phase 6 D-03 from the
                  // same partialize allow-list, so no ephemeral UI keys can
                  // leak through.
                  useStore.setState(
                    backup.state as unknown as Parameters<typeof useStore.setState>[0],
                    true,
                  );
                  // T-07-10-03: signOut AFTER setState — forces a clean
                  // Supabase session re-sync on next sign-in. See RESEARCH §6.
                  await signOut();
                  toast(
                    'Backup restored. You have been signed out — sign back in to re-sync.',
                    'success',
                  );
                  setRestoreOpen(false);
                  onClose();
                } catch {
                  toast('Restore failed. Your data was not changed.', 'error');
                } finally {
                  setRestoreBusy(false);
                }
              }}
            >
              Restore and overwrite
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function Section({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{body}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/**
 * Phase 5 D-04: inline-expand change-email row. Calls `attachEmailToAnon` (which
 * wraps `supabase.auth.updateUser({email})` — works for both anon promotion AND
 * permanent-user email change since the underlying Supabase API path is the same).
 * On success, Supabase sends a confirm-email link to the NEW address.
 */
function ChangeEmailRow({
  currentEmail,
  onToast,
}: {
  currentEmail: string;
  onToast: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Change email
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Input
        label="New email"
        type="email"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={currentEmail}
        autoComplete="email"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            if (!next.trim()) {
              onToast('Email is required', 'error');
              return;
            }
            setBusy(true);
            try {
              const { error } = await attachEmailToAnon(next.trim());
              if (error) {
                onToast(error.message, 'error');
                return;
              }
              onToast(`Check ${next.trim()} to confirm the change.`, 'success');
              setOpen(false);
              setNext('');
            } finally {
              setBusy(false);
            }
          }}
        >
          Send confirmation
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
