/**
 * States D / E / F — share revoked, expired, or generic load error.
 *
 * Copy strings verbatim from `.planning/phases/08-doctor-read-share/08-UI-SPEC.md`
 * §"State D/E/F". One component, prop-driven so the SharePage state machine can
 * branch on `kind`.
 *
 * INVARIANT — no Zustand store reads, no supabase client imports. The share
 * lazy chunk stays free of those dependencies (bundle gate enforces).
 */

import { Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export type ShareRevokedKind = 'revoked' | 'expired' | 'load-error';

interface Props {
  kind: ShareRevokedKind;
}

interface Config {
  Icon: typeof XCircle;
  iconClassName: string;
  heading: string;
  body: string;
  action: { label: string; onClick: () => void };
}

const CONFIG: Record<ShareRevokedKind, Config> = {
  revoked: {
    Icon: XCircle,
    iconClassName: 'text-[var(--color-danger)]',
    heading: 'This share has been revoked',
    body: 'The patient has ended this share. Ask them to send you a new link if you still need access.',
    action: { label: 'Close window', onClick: () => window.close() },
  },
  expired: {
    Icon: Clock,
    iconClassName: 'text-[var(--color-text-tertiary)]',
    heading: 'This share has expired',
    body: 'Shared records expire automatically. Ask the patient for a new share link if you still need access.',
    action: { label: 'Close window', onClick: () => window.close() },
  },
  'load-error': {
    Icon: XCircle,
    iconClassName: 'text-[var(--color-text-tertiary)]',
    heading: "Couldn't open this share",
    body: 'Something went wrong loading the record. Check your connection, then refresh the page. If the problem continues, ask the patient to send a new share link.',
    action: { label: 'Refresh', onClick: () => window.location.reload() },
  },
};

export function ShareRevokedScreen({ kind }: Props) {
  const config = CONFIG[kind];
  const Icon = config.Icon;
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <Card padding="lg" className="w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <Icon className={`size-12 ${config.iconClassName}`} aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">{config.heading}</h1>
          <p className="text-[var(--color-text-secondary)] leading-relaxed">{config.body}</p>
          <Button onClick={config.action.onClick} variant="secondary">
            {config.action.label}
          </Button>
        </div>
      </Card>
    </main>
  );
}
