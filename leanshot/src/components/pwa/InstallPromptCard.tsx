/**
 * Phase 42 Plan 04 (D-16) — Branded deferred install prompt.
 *
 * Pitfall 2 (state machine): the "Maybe later" button calls `later()` which
 * sets state.snoozed_until = now + 30d. The "Install" button calls `install()`
 * which triggers the captured `beforeinstallprompt.prompt()` — the actual
 * `appinstalled` event (fired by the browser on successful install) updates
 * state.state to 'installed' via the listener installed by
 * `initializeInstallPromptModule()`.
 */
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export function InstallPromptCard() {
  const { show, install, later } = useInstallPrompt();
  if (!show) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-[70] max-w-md mx-auto"
      data-testid="install-prompt-card"
    >
      <Card variant="elevated" padding="md">
        <CardHeader title="Install LeanShot" />
        <p className="text-sm text-[var(--color-text-muted)] mb-4">
          Install LeanShot on this device for faster access and a native, app-like experience.
        </p>
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={later}
            data-testid="install-prompt-later"
          >
            Maybe later
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void install();
            }}
            data-testid="install-prompt-install"
          >
            Install LeanShot
          </Button>
        </div>
      </Card>
    </div>
  );
}
