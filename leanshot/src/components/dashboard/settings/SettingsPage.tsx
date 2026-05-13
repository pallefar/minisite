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
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { attachEmailToAnon, requestPasswordReset, signOut } from '@/lib/auth';
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

type Section =
  | 'account'
  | 'profile'
  | 'goals'
  | 'notifications'
  | 'privacy'
  | 'shares'
  | 'recovery'
  | 'subscription'
  | 'data'
  | 'dev';

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
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'privacy', label: 'Privacy', Icon: Shield },
  // Phase 8 Plan 08-03 (D-04): Active shares sits between Privacy and Recovery
  // per 08-UI-SPEC §"Component Inventory" (SettingsPage NAV extension). Surfaces
  // the patient's create-share + revoke + audit-log aggregate UI.
  { id: 'shares', label: 'Active shares', Icon: Link2 },
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
  const resetAll = useStore((s) => s.resetAll);
  const fullState = useStore((s) => s);
  const signedIn = useStore((s) => s.signedIn);
  const toast = useToast();

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
              return (
                <li key={id} className="shrink-0">
                  <button
                    onClick={() => setSection(id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex items-center gap-2.5 px-3 py-2.5 rounded-xl w-full text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
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

          {section === 'notifications' && (
            <Section title="Notifications" body="Choose when LeanShot taps you on the shoulder.">
              <Card variant="flat">
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Email and push notifications aren&apos;t enabled yet — LeanShot is local-only by
                  design. Save your data to a calendar reminder for now.
                </p>
              </Card>
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
                  <h3 className="text-[14px] font-semibold mb-1">Delete my account</h3>
                  <p className="text-[12px] text-[var(--color-text-secondary)] mb-2">
                    30-day soft-delete. Undo via support email within the window; after that,
                    irreversible.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    leadingIcon={<Trash2 className="size-4" />}
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete my account…
                  </Button>
                </div>
              )}
            </Section>
          )}

          {section === 'shares' && <ActiveSharesSection />}

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

          {section === 'subscription' && (
            <Section title="Subscription" body="Free forever. Pro adds polish.">
              <Card variant="flat">
                <p className="text-[14px] font-semibold mb-1">You&apos;re on the Free plan.</p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  All 9 dashboard tabs, unlimited tracking, and one progress card template.
                </p>
              </Card>
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
