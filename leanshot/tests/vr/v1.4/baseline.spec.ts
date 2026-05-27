/**
 * Phase 69 Plan 69-04 — v1.4 Visual-Review baseline spec.
 *
 * Captures fullPage screenshots for every v1.4 net-new surface in 4 variants:
 *   - desktop-1280 light
 *   - desktop-1280 dark
 *   - mobile-375 light
 *   - mobile-375 dark
 *
 * The viewport dimension is owned by the project (`chromium-desktop` /
 * `chromium-mobile` — see `playwright.config.vr.ts`). The theme dimension is
 * driven here via `seedThemeDark()` (addInitScript) — NOT
 * `emulateMedia({ colorScheme })`, because the app sets `data-theme` from
 * `localStorage['leanshot_theme_v4']` pre-paint in `src/main.tsx`, ignoring
 * OS color-scheme. See `e2e/visual/helpers/seed.ts` header for the seeding
 * contract (addInitScript-only — never goto+evaluate+reload).
 *
 * Surface inventory (verified against `src/App.tsx` route routing on main):
 *   Phase 66 — `/settings/security`            (auth-gated)
 *   Phase 66 — `/admin/users/security`         (auth-gated, admin)
 *   Phase 68 — `/for-doctors`                  (public)
 *   Phase 68 — `/for-clinics`                  (public)
 *   Phase 68 — `/for-coaches`                  (public)
 *   Phase 65 — `/admin/tax`                    (auth-gated, admin)
 *   Phase 65 — `/settings/billing/refund`      (auth-gated)
 *
 * Auth limitation (per plan known_lessons #4 + deferred to Phase 70):
 *   The auth-gated surfaces are seeded with `seedOnboarded()` so the SPA
 *   does not bounce to marketing. Admin role + Supabase JWT are NOT seeded
 *   in this VR pass — when the page reads a server resource (Edge Fn) it
 *   may render an empty / error state. That state IS the baseline for the
 *   purpose of regression detection: the snapshot captures the first stable
 *   paint regardless of data presence. Real admin-authenticated VR is
 *   tracked for Phase 70 (operator account registration).
 *
 *   Routes that hard-redirect server-side or 404 in the SPA fallback are
 *   listed in `README.md > Surface notes` so the operator knows which
 *   baselines reflect "real surface" vs "empty-state surface".
 */

import { expect, test, type Page } from '@playwright/test';

// Re-use the existing visual-suite seeders (Phase 13 helpers, hardened in
// later phases per [[reference_playwright_state_seeding.md]]).
import {
  seedOnboarded,
  seedThemeDark,
  seedUnauth,
  waitForReady,
} from '../../../e2e/visual/helpers/seed';

interface SurfaceSpec {
  /** Stable slug used in the snapshot filename. */
  slug: string;
  /** SPA pathname. */
  path: string;
  /** Whether the route requires a hydrated `user` to avoid bouncing to
   *  marketing. Public marketing routes use `seedUnauth`. */
  authGated: boolean;
}

const SURFACES: SurfaceSpec[] = [
  // Phase 66 — Security settings
  { slug: 'settings-security', path: '/settings/security', authGated: true },
  {
    slug: 'admin-users-security',
    path: '/admin/users/security',
    authGated: true,
  },
  // Phase 68 — Audience landing pages (public)
  { slug: 'for-doctors', path: '/for-doctors', authGated: false },
  { slug: 'for-clinics', path: '/for-clinics', authGated: false },
  { slug: 'for-coaches', path: '/for-coaches', authGated: false },
  // Phase 65 — Stripe Tax + Payment Resilience
  { slug: 'admin-tax', path: '/admin/tax', authGated: true },
  {
    slug: 'settings-billing-refund',
    path: '/settings/billing/refund',
    authGated: true,
  },
];

type Theme = 'light' | 'dark';

/**
 * Seed the page for a given surface + theme before navigating. Order matters:
 * the auth seeder writes `leanshot_theme_v4=light` as part of its blob, so
 * the theme seeder MUST run AFTER to override.
 */
async function seedFor(
  page: Page,
  surface: SurfaceSpec,
  theme: Theme,
): Promise<void> {
  if (surface.authGated) {
    await seedOnboarded(page);
  } else {
    await seedUnauth(page);
  }
  if (theme === 'dark') {
    await seedThemeDark(page);
  }
}

/**
 * The viewport project (`chromium-desktop` / `chromium-mobile`) appends its
 * name to the snapshot filename automatically via the project name, so we
 * only encode {slug, theme} in the screenshot arg. Final on-disk path:
 *   tests/vr/v1.4/__screenshots__/baseline.spec.ts/<slug>-<theme>-<project>.png
 */
function snapshotName(slug: string, theme: Theme): string {
  return `${slug}-${theme}.png`;
}

for (const surface of SURFACES) {
  test.describe(`v1.4 VR: ${surface.path}`, () => {
    for (const theme of ['light', 'dark'] as const) {
      test(`${surface.slug} — ${theme}`, async ({ page }) => {
        await seedFor(page, surface, theme);
        await page.goto(surface.path);
        await waitForReady(page);

        // Settle network-driven content (audience landing pages fetch
        // markdown; admin surfaces fetch Edge Fn data). Tolerant timeout —
        // if Supabase is unreachable the page still settles to its empty
        // state, which is the documented baseline (see file header).
        await page
          .waitForLoadState('networkidle', { timeout: 8_000 })
          .catch(() => {
            /* tolerate slow Edge Fns; first stable paint is the baseline */
          });

        await expect(page).toHaveScreenshot(
          snapshotName(surface.slug, theme),
          {
            fullPage: true,
          },
        );
      });
    }
  });
}
