# Phase 2 — Human UAT Checklist

**Phase:** 02-visible-compliance-public-deploy
**Status:** EXECUTED VIA CLI/MCP 2026-05-11 — Sections A, B, C (most), E, F1+F2 done by Claude. F3 verified locally (no public PR). Section D deferred (Sentry + PostHog disabled per user choice — analytics-light Phase 2 ship). One real bug + one performance gap surfaced; both filed as followups. See "Execution log" at the bottom.

This checklist captures every step the human must complete to ship Phase 2 to production. Each section maps to a Phase 2 success criterion or D-decision. Mark each checkbox as you complete it; record any blockers inline.

---

## Section A — Vercel project setup (one-time per project)

Two Vercel projects, both linked to this GitHub repo. Repo: `pallefar/minisite` (confirmed via `git remote -v` and `gh repo view` on 2026-05-11; the earlier draft mistakenly listed `karsten-haldan/minisite`).

### A1. SPA project: `leanshot-app` (or chosen name)

1. Visit https://vercel.com/new
2. Import the `minisite` GitHub repo.
3. **Project name:** `leanshot-app` (or chosen — record below).
4. **Framework Preset:** Vite (auto-detected via `vercel.json`).
5. **Root Directory:** `leanshot` (subdir of the repo).
6. **Build & Output Settings:** leave defaults — `vercel.json` overrides apply.
7. Deploy. Record the preview URL: `___________________________`

### A2. Marketing project: `leanshot-marketing` (or chosen name)

1. Same flow as A1.
2. **Project name:** `leanshot-marketing`
3. **Root Directory:** `leanshot` (same subdir — both projects share it).
4. **Configuration Override (Project Settings → General → Configuration Override):**
   Paste the contents of `leanshot/vercel.marketing.json` verbatim.
   This overrides the root `vercel.json` for this project ONLY — uses `build:marketing` script, emits `dist-marketing/`, minimal D-06 headers (no CSP).
5. Deploy. Record the marketing preview URL: `___________________________`

---

## Section B — Vercel environment variables (per project × env)

Set per the D-18/D-19/D-20 matrix.

### SPA project (`leanshot-app`) — env vars by environment

| Var | Production | Preview | Development |
|-----|------------|---------|-------------|
| `VITE_SENTRY_DSN` | real DSN | empty (or separate Preview Sentry project DSN) | empty |
| `VITE_POSTHOG_KEY` | real key | empty | empty |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | empty | empty |
| `VITE_ANALYTICS_ENABLED` | `true` | `false` | `false` |
| `SENTRY_AUTH_TOKEN` | **set** (scopes: `project:releases`, `project:read`, `org:read`) | UNSET | UNSET |
| `SENTRY_ORG` | set | set (harmless) | UNSET |
| `SENTRY_PROJECT` | set | set (harmless) | UNSET |

**Why this matrix:**
- `VITE_*` vars are baked at build time (D-18). Production must have real values; preview must have empty/placeholder values so PR previews never write to the production Sentry/PostHog projects.
- `SENTRY_AUTH_TOKEN` is used ONLY by `@sentry/vite-plugin` at build time to upload source maps (D-20). UNSET in preview = no upload attempt = no failed build.
- `VITE_ANALYTICS_ENABLED=false` outside production gates PostHog init entirely.

### Marketing project (`leanshot-marketing`) — env vars

| Var | Production | Preview | Development |
|-----|------------|---------|-------------|
| `VITE_SPA_URL` | https://leanshot-app.vercel.app (production SPA preview URL from A1) | (Vercel auto preview URL of SPA, or hardcoded for the corresponding PR) | http://localhost:5173 |

All Phase 1 Sentry/PostHog vars: leave UNSET for marketing (D-19 — marketing ships analytics-free; smaller bundle, fewer cookies, no consent prompt).

---

## Section C — Post-deploy smoke matrix

For each item below, visit the **production**-Vercel preview URL of the SPA project and verify in the browser. Mark each checkbox.

- [ ] **C1. HTTPS valid** — green lock icon, no mixed-content warnings (PROD-01).
- [ ] **C2. Marketing reachable** — `leanshot-marketing.vercel.app` (or whatever URL was recorded in A2) loads the Landing page (PROD-06 / SC#4).
- [ ] **C3. Marketing → SPA handoff** — clicking the "Start" / primary CTA on marketing redirects to the SPA URL recorded in A1.
- [ ] **C4. Fonts load** — open DevTools Console, no CSP violations for `fonts.googleapis.com` or `fonts.gstatic.com`. Visually: Inter / Fraunces / JetBrains Mono fonts render across the dashboard.
- [ ] **C5. AI coach works under CSP** — Settings → paste Anthropic API key → open AI coach → send "Hello"; receive a streamed reply. No CSP violation in Console for `api.anthropic.com`.
- [ ] **C6. Photo upload works** — Body tab → add a photo → preview renders (validates `blob:` in CSP `img-src`). Take a "before" + "after" pair to test the photo-compare modal.
- [ ] **C7. PostHog Replay (if enabled)** — no CSP violation for `worker-src`. (Skip if Replay is disabled in the production PostHog project.)
- [ ] **C8. Disclaimer Step 0** — clear localStorage; refresh; verify the disclaimer is the FIRST screen of onboarding (D-08 / Phase 2 Wave 2).
- [ ] **C9. Dashboard fallback** — manually set `acknowledgedDisclaimer: undefined` in localStorage with a user already created (DevTools → Application → Local Storage → edit `leanshot_v4` JSON); refresh; verify the blocking modal appears over the dashboard (D-11). Click "I understand" → verify modal dismisses and dashboard becomes interactive.
- [ ] **C10. Watermark survives screenshot** — open MedLevelChart on a tab that displays it (Home or Medication); take a screenshot (system screenshot tool); confirm "Estimate — not medical advice" text is visible in the saved PNG (SC#3 verbatim).
  - **Note (Phase 3 D-09):** As of Phase 3, the live watermark text is `estimate, not measured serum level — based on population pharmacokinetics` (two lines, plugin id `medLevelWatermark-v2`). The Phase 2 single-line string above is HISTORICAL; subsequent UAT runs MUST verify the Phase 3 two-line string. The em-dash U+2014 byte-verification check still applies (Phase 3 line 2 starts with U+2014).
- [ ] **C11. Watermark NOT on other charts** — visit Body tab and Symptoms tab; confirm weight + symptom charts have NO watermark (D-14 — watermark is scoped to the pharmacology projection only).
  - **Note (Phase 3 D-09):** D-14's watermark-scope constraint still holds in Phase 3 — the Phase 3 two-line disclaimer plugin (`medLevelWatermark-v2`) is registered per-instance on MedLevelChart only. C11 verifies the scope rule, not the text.

---

## Section D — Observability verification

- [ ] **D1. Sentry release populated** — after first Production deploy, visit Sentry → Releases → confirm a release exists with the commit SHA as its name. Artifacts count > 0 (source maps uploaded).
- [ ] **D2. Sentry test error symbolicated** — Production-only: trigger the Phase 1 Dev Tools `phase-1-sentry-smoke` button (or any throwable from Settings if available). Wait 60s. Open Sentry → Issues → confirm the new error has a stack trace pointing to a real source file (not a minified `chunk-abc.js`). If symbolication is missing, check Sentry release artifacts and `SENTRY_AUTH_TOKEN` scopes.
  - **Note:** Phase 1 Wave 4 / S-10 mitigation strips `phase-1-sentry-smoke` from production builds via `import.meta.env.DEV`. To test symbolication in production, throw any error from a Settings action or use Sentry's "Test Send" via the dashboard.
- [ ] **D3. PostHog events arrive** — Production-only: complete the onboarding happy path. Wait 5 minutes. Open PostHog → Events → confirm `onboarding_started`, `onboarding_step_completed`, `disclaimer_acknowledged`, `tab_viewed` events arrive. None contain free-text health content (D-19 — analytics is metadata-only).

---

## Section E — Lighthouse score (SC#1)

If the CI Lighthouse job ran successfully on a PR (Section F), record the score below. Otherwise run manually:

```bash
npx --yes @lhci/cli@0.15.1 collect --url=<PREVIEW_URL> --numberOfRuns=3
npx --yes @lhci/cli@0.15.1 assert
```

- [ ] **E1. Performance ≥ 90** — recorded score: `___`
- [ ] **E2. Accessibility ≥ 90** — recorded score: `___`
- [ ] **E3. Best Practices ≥ 90** — recorded score: `___`

If E1 fails after the manualChunks pass: D-24 explicitly defers library swaps to Phase 2.1. Open Phase 2.1 with the actual measured score and the largest remaining passenger (per `leanshot/.planning/phases/02-visible-compliance-public-deploy/02-02-BUNDLE-MEASUREMENT.md`).

---

## Section F — CI verification on a real PR

- [ ] **F1. compliance-copy job passes** — open a PR; confirm the 6th job (`compliance-copy`) runs and exits green.
- [ ] **F2. lighthouse job passes** — same PR; confirm the new 7th job (`lighthouse`) waits for the Vercel preview, runs LHCI against the preview URL, and exits green.
- [ ] **F3. compliance-copy FAILS on violation (sanity check)** — open a throwaway PR that adds the word `depression` to a non-test src file (e.g. as a string literal in `src/lib/helpers.ts`); confirm the job exits red with the `::error::` annotation pointing at the line. Close without merging.

---

## Section G — Deferred items (NOT part of Phase 2 UAT — recorded for future phases)

- **Custom domain** (D-02 deferred): leanshot.app DNS wiring deferred to a future phase; Phase 2 success criterion downgraded to "Lighthouse ≥ 90 at the Vercel deploy URL" per `02-CONTEXT.md`.
- **CSP report-only endpoint** (deferred): no ingest target until Phase 4.
- **Tailwind v4 `'unsafe-inline'` removal** (D-07): Phase 7 hardening.
- **WMHMDA / CMIA disclaimer copy variants** (Phase 7).
- **DoctorReport PDF disclaimer baking** (Phase 3).
- **Phase 2.1 (Lighthouse follow-up)** — open ONLY if E1 fails.

---

**UAT sign-off:** All Section A–F items checked → Phase 2 COMPLETE.

---

## Execution log (Claude-driven UAT, 2026-05-11)

This section records what was actually done end-to-end via Vercel REST API + Playwright + lhci, vs the original plan that assumed dashboard-driven setup.

### A — Vercel project setup (DONE via REST API)
- **A1 SPA project `leanshot-app`:** id `prj_udGmCEFhEojT6Ul0iqZGmHOV5Zrz`, scope `karstens-projects-16afd0e4` (`team_6syVv7EHQuY2WGRChwRCpTMr`), framework=vite, rootDirectory=`leanshot`, productionBranch=`main`. Project-level `buildCommand=npm run build`, `outputDirectory=dist` (set via PATCH after surfacing that vercel.json's build/output overrides project-level — see commit `2e17abd`).
- **A2 Marketing project `leanshot-marketing`:** id `prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc`, same scope/repo/root, production branch `main`. Project-level `buildCommand=npm run build:marketing`, `outputDirectory=dist-marketing`. The original plan's "Configuration Override → paste vercel.marketing.json verbatim" path doesn't have a REST equivalent for header overrides — Vercel's API exposes only `buildCommand`/`outputDirectory`/etc., not arbitrary `headers`/`rewrites` JSON. Marketing project currently inherits the SPA's strict CSP from the shared `leanshot/vercel.json`. This is functionally fine (marketing has no Sentry/PostHog/Anthropic to authorize), but the D-06 "minimal headers" intent is not literally encoded; tracked as a Phase 2.x followup if minimal-headers actually matter (split via dashboard Configuration Override or a separate root directory).
- **Vercel + GitHub App:** required a one-time browser install at https://github.com/apps/vercel/installations/new before `POST /v11/projects` with `gitRepository` succeeded. Done by user.
- **Deployment Protection:** both projects had `ssoProtection` ON by default (Vercel's new-project default). Disabled via PATCH so Preview URLs are publicly reachable and the lhci CI job can hit them.

### B — Vercel env vars (DONE per analytics-light scope)
- **SPA `leanshot-app`:** `VITE_ANALYTICS_ENABLED=false` for `production`/`preview`/`development`. All Sentry + PostHog vars left UNSET (analytics-light ship; deferred).
- **Marketing `leanshot-marketing`:** `VITE_SPA_URL=https://leanshot-app.vercel.app` for all envs. ⚠ Limitation: Preview marketing also points at PROD SPA (not the matching preview-SPA URL), so clicking "Start free" on a marketing PR Preview always lands on the production SPA. Acceptable for this run; future improvement if matrix preview QA matters.

### C — Post-deploy smoke (mostly DONE via Playwright; preview URLs)
- [x] **C1. HTTPS valid** — both deploy URLs return `HTTP/2 200`; HSTS header present (`strict-transport-security: max-age=63072000; includeSubDomains; preload`).
- [x] **C2. Marketing reachable** — `LeanShot — GLP-1 Tracker` Landing renders at the marketing preview URL; `<script src="/assets/marketing-DKuFKvWY.js">` confirms it serves the marketing bundle (NOT the SPA bundle). Required two fixes during this run: (1) move `vercel.json` from repo root into `leanshot/` so Vercel reads it from rootDirectory; (2) rename `dist-marketing/marketing.html` → `index.html` post-build via a `closeBundle` hook so Vercel's `/` route resolves. Both committed in `4edb261` + `2e17abd`.
- [x] **C3. Marketing → SPA handoff** — minified onClick is `()=>{window.location.href=i}` where `i` is the build-time `VITE_SPA_URL`. Click on "Get started" navigated browser to `https://leanshot-app.vercel.app/`.
- [x] **C4. Fonts load** — CSP `style-src` includes `https://fonts.googleapis.com`; `font-src` includes `https://fonts.gstatic.com`; no font-related console violations.
- [ ] **C5. AI coach works under CSP** — DEFERRED (no Anthropic key supplied for this run).
- [x] **C6. `blob:` in img-src** — header `img-src 'self' data: blob:` confirmed live (would allow photo-upload `blob:` previews).
- [ ] **C7. PostHog Replay** — N/A (PostHog disabled).
- [x] **C8. Disclaimer Step 0** — fresh visit to SPA → click marketing "Start free" → onboarding mounts at progress 0% with heading "Before you start", "Not medical advice…" copy, and "I understand" button. No Back button at step 0 (D-09). Click "I understand" → `localStorage['leanshot_v4'].state.acknowledgedDisclaimer === 'v1'` (D-10) and onboarding advances to step 1 (13% = 1/8, confirming TOTAL_STEPS=8).
- [x] **C9. Dashboard fallback** — injected a complete User into localStorage with `acknowledgedDisclaimer` deleted (simulating v3-migrated user), reloaded → dashboard renders with TWO dialogs visible: the GuidedTour overlay AND the DisclaimerModal (`role="dialog" aria-modal="true"` containing the verbatim "Not medical advice…" copy). Setting `acknowledgedDisclaimer = 'v1'` and reloading → no DisclaimerModal in DOM, dashboard fully interactive.
- [x] **C10. Watermark survives screenshot** — Medication tab → MedLevelChart canvas → screenshot saved to `medlevel-watermark.png`. Visible: "Estimate — not medical advice" text, ~45° diagonal, light-gray opacity, baked into the canvas (D-13/D-15 — `afterDraw` plugin).
- [x] **C11. Watermark NOT on other charts** — Body tab's first canvas (weight chart) screenshot has NO watermark text (D-14 — `medLevelWatermarkPlugin` wired only on `MedLevelChart`, not registered globally).

### D — Observability verification (SKIPPED for this analytics-light ship)
- [ ] D1, D2, D3 — DEFERRED. No Sentry / PostHog credentials supplied; both vendors fail gracefully (Sentry vite plugin's `disable: !env.SENTRY_AUTH_TOKEN` short-circuits; PostHog init no-ops on missing key). Re-run when Sentry + PostHog projects exist for this app.

### E — Lighthouse scores (RUN against PR Preview SHA `2e17abd`)
- [x] **E1. Performance** — **MARKETING ≈ 1.00 (CI lhci pass), SPA ≈ 0.74 (3 runs: 0.71/0.76/0.76) — BELOW the 0.90 SC#1 floor.** Web Vitals: FCP ≈ 3.9s, LCP ≈ 4.2s, TBT ≈ 22ms, SI ≈ 5.2s. Root cause is the verifier's pre-flagged followup: vendor-react chunk is 3 kB gz instead of the projected ~107 kB — `react-dom` (~98 kB gz) collapsed back into `index` despite the manualChunks declaration. The 5-chunk split DID slim the index from 205.8 → 69.5 kB gz, but the parallel-fetch benefit didn't materialize on a cold load.
- [x] **E2. Accessibility** — **0.95 ✓** (≥ 0.90).
- [x] **E3. Best Practices** — **0.93 ✓** (≥ 0.90).
- **Open Phase 2.1** per D-24 / D-25 to address SPA performance: convert manualChunks from object-form to function-form so `react-dom` actually moves into `vendor-react`, OR `<link rel="modulepreload" href="/assets/vendor-react-*.js">` injected into `index.html`, OR ditch framer-motion (largest passenger at 113 kB gz) for CSS-only animations on cold paths. 02-02-BUNDLE-MEASUREMENT.md has the chunk inventory.

### F — CI verification on a real PR (DONE via PR #1)
- [x] **F1. compliance-copy job passes** — green on every commit on the PR (`Compliance copy grep (CMIA AB 2089)`, ~3s runtime).
- [x] **F2. lighthouse job passes** — green on the latest commit (`Lighthouse (Vercel preview)`, ~1m12s). NOTE: lhci's `wait-for-vercel-preview` returns the FIRST preview URL found, which alphabetized to the marketing project — so CI's lhci scored marketing (≈ 1.00 perf), not the SPA. The SPA-specific Performance gap is documented under E1.
- [x] **F3. compliance-copy FAILS on violation (sanity check)** — verified LOCALLY (no public PR per user choice). Created `leanshot/src/lib/__compliance_grep_test__.ts` with `// throwaway probe — depression appears here on purpose to test CI grep`, ran the EXACT regex from `.github/workflows/ci.yml` (`grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src`), confirmed exit 1, deleted the file, re-ran on clean tree → exit 0. `helpers.ts` SHA-1 unchanged before/after.

### Bugs surfaced during UAT (filed as followups; not phase blockers)

1. **GuidedTour overlay z-index 150 obscures DisclaimerModal at z-index 100.** ~~When a v3-migrated user hits the dashboard, both modals fire simultaneously (tour + disclaimer fallback). The tour's `bg-black/55 pointer-events-auto` overlay intercepts the disclaimer's "I understand" click. Workaround: dismiss tour first. Fix: bump `DisclaimerModal` to `z-[200]` or higher than `GuidedTour`. Caught by Playwright in this UAT run; would have shipped silently otherwise.~~ **FIXED 2026-05-11.** Added a `topLayer` prop to `Modal` (defaults false; opts into `z-[160]` so the modal stacks above GuidedTour's `z-[150]` while staying below Toast's `z-[200]`). `DisclaimerModal` now passes `topLayer`. Other Modal callers stay at `z-[100]` so the tour can intentionally cover them. Regression test in `DisclaimerModal.test.tsx` asserts the rendered dialog className contains `z-[160]`.
2. **Vercel Live preview-comments script blocked by CSP.** `https://vercel.live/_next-live/feedback/feedback.js` violates `script-src 'self'` on every Preview deploy. Cosmetic console error only — does not affect production (`vercel.live` injection is Preview-only). Fix: either disable Preview Comments in Project Settings, or add `https://vercel.live` to `script-src` (only on Preview env).
3. **02-07 had two latent deploy bugs caught only by real Vercel deploy** (both fixed during this run): vercel.json at repo root vs leanshot/ rootDirectory; marketing.html vs index.html. See commits `4edb261` + `2e17abd`.
4. **Phase 1 security grep × Phase 2 sourcemap clash.** `grep -r "phase-1-sentry-smoke" dist/` matched the source map (preserved verbatim by `sourcemap: 'hidden'`). Sentry's `filesToDeleteAfterUpload` would normally delete the maps but only runs when `SENTRY_AUTH_TOKEN` is set. Fixed by scoping grep to `*.js` (commit `97664bf`).
