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

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import AnonymousPreviewLayer from './AnonymousPreviewLayer';

export function AnonymousPreviewView() {
  const { t } = useTranslation('onboarding');
  return (
    <AnonymousPreviewLayer className="min-h-screen bg-[var(--color-bg)]">
      <main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-4 py-12 text-center">
        <header className="mb-8 space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
            {t('onboarding:preview.badge')}
          </p>
          <h1 className="text-balance text-3xl font-semibold leading-tight text-[var(--color-text)] sm:text-4xl">
            {t('onboarding:preview.headline')}
          </h1>
          <p className="mx-auto max-w-[420px] text-balance text-[15px] leading-relaxed text-[var(--color-text-muted)]">
            {t('onboarding:preview.subheadline')}
          </p>
        </header>

        <ul className="mb-10 space-y-2 text-start text-[14px] text-[var(--color-text-muted)]">
          <li className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]"
            />
            {t('onboarding:preview.feature_drug_level')}
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]"
            />
            {t('onboarding:preview.feature_rotation')}
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-primary)]"
            />
            {t('onboarding:preview.feature_report')}
          </li>
        </ul>

        <Button
          className="w-full max-w-[280px] min-h-[44px]"
          onClick={() => {
            window.location.hash = '#/onboarding';
          }}
        >
          {t('onboarding:preview.cta')}
        </Button>

        <p className="mt-4 text-[12px] text-[var(--color-text-muted)]">
          {t('onboarding:preview.no_account')}
        </p>
      </main>
    </AnonymousPreviewLayer>
  );
}

export default AnonymousPreviewView;
