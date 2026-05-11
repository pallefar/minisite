# Phase 2 — Human UAT Checklist

**Phase:** 02-visible-compliance-public-deploy
**Status:** PENDING (items below require human action; Claude cannot complete via CI/API on this branch)

This checklist captures every step the human must complete to ship Phase 2 to production. Each section maps to a Phase 2 success criterion or D-decision. Mark each checkbox as you complete it; record any blockers inline.

---

## Section A — Vercel project setup (one-time per project)

Two Vercel projects, both linked to this GitHub repo. Repo: `karsten-haldan/minisite` (confirm exact slug in the GitHub URL bar before importing).

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
- [ ] **C11. Watermark NOT on other charts** — visit Body tab and Symptoms tab; confirm weight + symptom charts have NO watermark (D-14 — watermark is scoped to the pharmacology projection only).

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
