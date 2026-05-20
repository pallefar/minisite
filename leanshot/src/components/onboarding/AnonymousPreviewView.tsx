/**
 * Phase 34 Plan 34-06 (ONBOARD-01) — AnonymousPreviewView.
 *
 * Top-level surface mounted at the `/onboard` path route (registered in
 * `src/App.tsx`'s selectView under the `onboard-preview` view ID). Wraps the
 * preview body (hero + value-prop + CTA) inside an {@link AnonymousPreviewLayer}
 * which owns the `_ls_anon` cookie bootstrap + smart-defaults derivation
 * (locale / units / timezone).
 *
 * Clicking the primary CTA hands off to the legacy onboarding flow at
 * `#/onboarding` — the existing hash route that already drives the marketing
 * → onboarding transition. The anonymous_sessions row created by the
 * AnonymousPreviewLayer ride-alongs the user via the `_ls_anon` cookie, so
 * everything they enter pre-signup is already attributable.
 */

import { Button } from '@/components/ui/Button';
import AnonymousPreviewLayer from './AnonymousPreviewLayer';

export function AnonymousPreviewView() {
  return (
    <AnonymousPreviewLayer className="min-h-screen bg-[var(--color-bg)]">
      <main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-4 py-12 text-center">
        <header className="mb-8 space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
            LeanShot preview
          </p>
          <h1 className="text-balance text-3xl font-semibold leading-tight text-[var(--color-text)] sm:text-4xl">
            See how your GLP-1 journey looks with one source of truth.
          </h1>
          <p className="mx-auto max-w-[420px] text-balance text-[15px] leading-relaxed text-[var(--color-text-muted)]">
            Track injections, weight, food, mood, and side-effects — and share
            the picture with your doctor in one tap.
          </p>
        </header>

        <ul className="mb-10 space-y-2 text-left text-[14px] text-[var(--color-text-muted)]">
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]" />
            Drug-level projection (28 days back + 7 days ahead)
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]" />
            Site-rotation tracker so the same shoulder never gets two in a row
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]" />
            A one-tap doctor report that summarises the past month
          </li>
        </ul>

        <Button
          className="w-full max-w-[280px] min-h-[44px]"
          onClick={() => {
            window.location.hash = '#/onboarding';
          }}
        >
          Get started
        </Button>

        <p className="mt-4 text-[12px] text-[var(--color-text-muted)]">
          No account needed to try the preview.
        </p>
      </main>
    </AnonymousPreviewLayer>
  );
}

export default AnonymousPreviewView;
