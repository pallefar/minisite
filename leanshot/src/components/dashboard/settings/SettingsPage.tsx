import {
  User as UserIcon,
  Target,
  Bell,
  Shield,
  CreditCard,
  Database,
  Bot,
  Trash2,
  Download,
  GraduationCap,
  Terminal,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { todayStr, cn } from '@/lib/helpers';
import { apiKeyStorage } from '@/lib/storage';
import { useStore } from '@/lib/store';

type Section =
  | 'profile'
  | 'goals'
  | 'ai'
  | 'notifications'
  | 'privacy'
  | 'subscription'
  | 'data'
  | 'dev';

const NAV: { id: Section; label: string; Icon: typeof UserIcon }[] = [
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  { id: 'goals', label: 'Goals', Icon: Target },
  { id: 'ai', label: 'AI', Icon: Bot },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'privacy', label: 'Privacy', Icon: Shield },
  { id: 'subscription', label: 'Subscription', Icon: CreditCard },
  { id: 'data', label: 'Data', Icon: Database },
  ...(import.meta.env.DEV ? [{ id: 'dev' as Section, label: 'Dev Tools', Icon: Terminal }] : []),
];

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const u = useStore((s) => s.user!);
  const updateUser = useStore((s) => s.updateUser);
  const resetAll = useStore((s) => s.resetAll);
  const fullState = useStore((s) => s);
  const toast = useToast();

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
  const [draft, setDraft] = useState({ ...u });
  const [apiKey, setApiKey] = useState<string>(() => apiKeyStorage.get() ?? '');

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

  const exportData = (): void => {
    const data = {
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
      costs: fullState.costs,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leanshot-export-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data exported');
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

          {section === 'ai' && (
            <Section
              title="AI assistant"
              body="Bring your own Anthropic key. Pennies per month for typical use."
            >
              <Input
                label="Anthropic API key"
                type="password"
                placeholder="sk-ant-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                hint="Stored locally on this device. Never sent to anyone but Anthropic."
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    apiKeyStorage.set(apiKey.trim());
                    toast('API key saved');
                  }}
                >
                  Save key
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    apiKeyStorage.clear();
                    setApiKey('');
                    toast('API key cleared');
                  }}
                >
                  Clear
                </Button>
              </div>
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                Get a key at{' '}
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] font-semibold"
                >
                  console.anthropic.com
                </a>
                .
              </p>
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
                    The AI coach is the only exception. It sends your prompt + relevant context to
                    Anthropic using your own API key.
                  </li>
                  <li>No analytics. No telemetry. No third-party trackers.</li>
                  <li>Clearing site data deletes everything LeanShot knows about you.</li>
                </ul>
              </Card>
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
                onClick={exportData}
              >
                Export JSON
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
