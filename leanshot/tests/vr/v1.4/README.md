# v1.4 Visual-Review (VR) Snapshot Suite

**Phase:** 69 Plan 69-04
**Owner:** Phase 69 (Layout / Design / Polish)
**Status:** Spec shipped; baselines NOT yet captured (operator action)

This suite captures full-page screenshots for every net-new surface introduced
in v1.4 (Phases 65/66/68). Each route is exercised in **4 variants**:

|              | Light                | Dark                 |
| ------------ | -------------------- | -------------------- |
| Desktop 1280 | `chromium-desktop`   | `chromium-desktop`   |
| Mobile 375   | `chromium-mobile`    | `chromium-mobile`    |

7 routes × 4 variants = **28 snapshots** per baseline pass.

---

## Surface inventory

| Phase | Route                       | Auth-gated | Notes                                             |
| ----- | --------------------------- | ---------- | ------------------------------------------------- |
| 66    | `/settings/security`        | Yes        | Consumer 2FA / passkey / session settings.        |
| 66    | `/admin/users/security`     | Yes        | Admin user-security audit (requires admin role).  |
| 68    | `/for-doctors`              | No         | Audience landing — fetches markdown.              |
| 68    | `/for-clinics`              | No         | Audience landing — fetches markdown + Calendly.   |
| 68    | `/for-coaches`              | No         | Audience landing — fetches markdown.              |
| 65    | `/admin/tax`                | Yes        | Stripe Tax admin (requires admin role).           |
| 65    | `/settings/billing/refund`  | Yes        | Consumer refund self-service.                     |

Routes were verified against `src/App.tsx` on `main` before the spec was
authored. Missing routes — none. If you add new v1.4 surfaces in a follow-up
plan, append them to `SURFACES` in `baseline.spec.ts`.

---

## Auth limitation (deferred to Phase 70)

The auth-gated surfaces are seeded with the same Zustand `seedOnboarded`
fixture used by the existing `e2e/visual/` suite. That keeps the SPA from
bouncing to marketing, but it does **not** mint a real Supabase JWT or grant
admin role. When an auth-gated page reads a server resource (Edge Fn / RPC),
it will render its empty / error / loading-stub state.

**That empty state IS the documented baseline.** The VR suite is regression
detection, not data-fixture exercise. If a future commit changes the empty
state shape (skeleton variant, error-toast styling, etc.), the diff will fire
and a human reviewer accepts or rejects via `--update-snapshots`. Real-admin
authenticated VR is on the Phase 70 backlog (operator account registration
gates it).

---

## Operator usage

### One-time setup (per machine)

```bash
cd leanshot
npm install                       # installs @playwright/test
npx playwright install chromium   # downloads Chromium binary (~140 MB)
```

If `npm install` aborts on the `@sentry/capacitor` sibling-check (see
`reference_sentry_capacitor_npm_install_blocker`), use:

```bash
npm install --ignore-scripts
```

### Capture initial baselines against staging

Run this **after** the v1.4 phases are deployed to staging and the team has
visually approved the surface. The captured PNGs become the source of truth
for subsequent diff runs.

```bash
PLAYWRIGHT_BASE_URL=https://staging.leanshot.app \
  npx playwright test --config playwright.config.vr.ts --update-snapshots
```

Baselines land under:

```
tests/vr/v1.4/__screenshots__/baseline.spec.ts/
  ├── settings-security-light-chromium-desktop.png
  ├── settings-security-dark-chromium-desktop.png
  ├── settings-security-light-chromium-mobile.png
  ├── settings-security-dark-chromium-mobile.png
  └── … (28 total)
```

Inspect each PNG visually before committing. **Reject any baseline that shows
a layout bug, broken theme, or unexpected empty state.** Re-run the
problematic route in isolation:

```bash
PLAYWRIGHT_BASE_URL=https://staging.leanshot.app \
  npx playwright test --config playwright.config.vr.ts \
  --update-snapshots --grep "for-doctors"
```

### Regression run (post-deploy diff against committed baselines)

```bash
PLAYWRIGHT_BASE_URL=https://staging.leanshot.app \
  npx playwright test --config playwright.config.vr.ts
```

Any pixel diff > 0.5% per snapshot fails the run. Open the HTML report
(`npx playwright show-report`) to compare baseline / actual / diff side by
side. Approve regressions via `--update-snapshots` (same command + flag).

### Local dev run

```bash
npm run dev                       # in one terminal, on :5173
npx playwright test --config playwright.config.vr.ts  # in another
```

`PLAYWRIGHT_BASE_URL` defaults to `http://localhost:5173` when unset.

---

## Baseline-commit policy

PNG snapshots are **large** (~200 KB – 2 MB each; 28 files = ~10-50 MB per
baseline pass). The repo currently does NOT use Git LFS.

Options for the operator (pick one, document in CARRY-OVER):

1. **Commit raw PNGs** — straightforward; bloats the repo by ~20-40 MB per
   v1.4 baseline pass. Acceptable if the team plans to refresh baselines
   ≤ 4 times per year.

2. **Add `tests/vr/v1.4/**/*.png` to Git LFS** before the first
   `--update-snapshots` commit. Requires `git lfs install` + `.gitattributes`
   update. Recommended if VR baselines refresh more often.

3. **Don't commit baselines** — store them in a private bucket / artifact
   store; CI downloads on demand. Cleanest for repo size; highest setup cost.
   Track which baseline-revision matches which deploy.

**This plan does NOT pre-commit any PNGs.** The operator chooses the policy
above when running the first `--update-snapshots` pass and commits the
baselines separately (Phase 69-04 close-out task).

---

## CI integration (future)

Not wired in Phase 69. To integrate later:

```yaml
# .github/workflows/vr-v14.yml (sketch)
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: |
    PLAYWRIGHT_BASE_URL=${{ secrets.STAGING_URL }} \
      npx playwright test --config playwright.config.vr.ts
- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: vr-v14-diff
    path: playwright-report/
```

Gate this on the `main`-branch staging-deploy workflow, not on every PR
(staging URL needs to reflect the PR's build before the diff is meaningful).

---

## Troubleshooting

| Symptom                                              | Fix                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| "Marketing page captured for auth-gated route"       | Seed didn't run; check that `seedOnboarded` import path resolves.   |
| Snapshot diff shows AA / sub-pixel noise everywhere  | Re-run `--update-snapshots` once; the platform may have shifted.    |
| Theme inverted between captures                      | Pre-paint theme race; ensure `seedThemeDark` runs AFTER `seed*`.    |
| Audience landing renders "Loading…"                  | Markdown fetch slow; bump the `networkidle` timeout in spec.        |
| Admin surface renders empty / error state            | Expected — see "Auth limitation" above; baseline this as-is.        |
| `@playwright/test` not installed                     | `npm install` in `leanshot/`; see "One-time setup" above.           |

---

## File layout

```
leanshot/
├── playwright.config.vr.ts                 # Separate config (do NOT merge into playwright.config.ts)
└── tests/vr/v1.4/
    ├── README.md                           # This file
    ├── baseline.spec.ts                    # 7 surfaces × 2 themes = 14 tests × 2 projects = 28 snapshots
    └── __screenshots__/                    # Captured by --update-snapshots (gitignored OR LFS)
        └── baseline.spec.ts/
            └── <slug>-<theme>-<project>.png
```

The spec re-uses `e2e/visual/helpers/seed.ts` (auth/theme seeders shipped in
Phase 13 and hardened across later phases). Do not fork those helpers; if
behaviour changes, update them in place and document the change in
`e2e/visual/helpers/`.
