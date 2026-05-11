# Phase 2: Visible Compliance & Public Deploy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 02-Visible-Compliance-Public-Deploy
**Areas discussed:** Hosting target, Subdomain layout & CSP scope, Chart overlay technique, First-run disclaimer modal, Bundle splitting, CMIA copy enforcement, Vercel env-var split, Sentry source-map upload

---

## A. Hosting target

### A1. Static host choice

| Option | Description | Selected |
|--------|-------------|----------|
| Vercel | Native Vite-build support; per-PR preview URLs; Sentry + PostHog Marketplace integrations; subdomain wildcards just-work; Supabase Marketplace integration future-friendly. Trade: pricing scales sharply past Pro tier. | ✓ |
| Cloudflare Pages | Cheapest at scale (unlimited bandwidth on free tier); strongest CDN; easy DNS if Cloudflare hosts apex. Trade: preview-deploy UX less polished; thinner integrations. | |
| Netlify | Most mature deploys; predictable mid-tier pricing. Trade: slower edge; integrations manual. | |

**User's choice:** Vercel (Recommended)
**Notes:** Aligns with already-installed `vercel:*` skills + Vite first-class support. Sets up clean Supabase Marketplace pairing for Phase 4.

### A2. Custom domain

| Option | Description | Selected |
|--------|-------------|----------|
| Own domain — registrar TBD | Plan assumes domain exists; DNS instructions tailored to wherever it's registered. | |
| Register one in this phase | Adds a Task 0 to buy via Vercel Domains or Cloudflare Registrar. | |
| Use Vercel preview URL for v1 | Skip PROD-01 full satisfaction; verify HTTPS on `*.vercel.app`. PROD-01 partially satisfied. | ✓ |

**User's choice:** Defer custom domain; ship on Vercel preview URLs for v1.
**Notes:** PROD-01 partially satisfied via Vercel-managed HTTPS. SC#1 "Lighthouse 90+ at the production custom domain" becomes "Lighthouse 90+ at the deploy URL" — same engineering bar, different name on it.

### A3. CI ↔ Deploy relationship

| Option | Description | Selected |
|--------|-------------|----------|
| Vercel auto-deploys; GH advisory | Vercel handles deploys directly; GH Actions gates the PR merge but not the deploy. Simpler. | ✓ |
| GH deploys via vercel CLI after CI | Pipeline runs gates first, then `vercel deploy --prebuilt`. Strongest guarantee. Trade: more YAML, slower deploys. | |
| Vercel auto-deploys + required GH status | Vercel waits on GH status check (Pro-tier feature, confirm). | |

**User's choice:** Vercel auto-deploys on push; GH Actions is advisory.
**Notes:** Simplest split; preview URLs always available even when CI fails (broken code just can't merge).

---

## B. Subdomain layout & CSP scope

### B1. Origin split mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Two Vercel projects, two preview URLs | Mirrors future apex+subdomain layout 1:1. CSP isolation works from day one. Trade: marketing build extraction. | ✓ |
| One Vercel project, path-based (/ vs /app/) | Single deploy. Trade: same origin → CSP isolation requirement NOT met; defeats SC#4 spirit. | |
| Monorepo (Turborepo / pnpm workspaces) with 2 packages | Cleanest separation; future-proof. Trade: meaningful refactor in Phase 2. | |

**User's choice:** Two Vercel projects, two preview URLs.
**Notes:** Forward-compatible with custom domain split; CSP isolation achievable in v1. Planner picks the entry-point mechanism (separate marketing.html vs Vite multi-page input).

### B2. CSP strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict baseline + full security headers | `script-src 'self'`, explicit `connect-src` for Sentry/PostHog/Anthropic, HSTS, X-Frame-Options DENY, etc. | ✓ |
| Minimum SC#4 compliance only | Just `script-src 'self'` + `frame-src 'none'`. Misses easy wins; Lighthouse audits headers. | |
| Strict + CSP report-only endpoint | Adds violation reporting. Trade: needs an ingest target that doesn't exist until Phase 4. | |

**User's choice:** Strict baseline + full security-header set.
**Notes:** `'unsafe-inline'` on `style-src` is the one concession (Tailwind v4 beta requires it); tightening deferred to Phase 7.

---

## C. Chart overlay technique

### C1. Visual style

| Option | Description | Selected |
|--------|-------------|----------|
| Diagonal watermark across the chart | Light-gray, ~45°, ~12% opacity, repeating tile. Industry-standard demo/estimate mark. | ✓ |
| Bottom-right corner badge | Small attribution-style text. Less visual noise; can be cropped. | |
| Full-width banner across chart bottom | Solid ribbon; eats vertical chart space. | |
| Top + bottom corner annotations | Belt-and-suspenders; visually cluttered. | |

**User's choice:** Diagonal watermark.

### C2. Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Only MedLevelChart | SC#3 names this chart specifically; keeps signal value high. | |
| All chart-rendered components | Belt-and-suspenders. Dilutes meaning. | |
| MedLevelChart in v1; expand if legal asks | Lowest-risk default; documented for Phase 7 review. | ✓ |

**User's choice:** MedLevelChart in v1; expand if legal counsel requests.

### C3. Watermark text

| Option | Description | Selected |
|--------|-------------|----------|
| Estimate — not medical advice | Matches SC#3 verbatim. Short, no wrapping. | ✓ |
| ESTIMATE — NOT MEDICAL ADVICE (all caps) | More arresting; stylistically heavier. | |
| Estimate — not medical advice. Consult your healthcare provider. | Adds COMPL-04 clause. Trade: longer text wraps on small viewports. | |

**User's choice:** "Estimate — not medical advice" (SC#3 verbatim).

---

## D. First-run disclaimer modal

### D1. Trigger placement

| Option | Description | Selected |
|--------|-------------|----------|
| Before onboarding Step 1 — first thing on SPA load | Strongest legal posture; acknowledgment before data collection. | |
| After onboarding, before dashboard | Matches SC#2 literally. WMHMDA/HBNR may argue acknowledgment came after data collection. | |
| First step of the 7-step onboarding (Step 0) | Add disclaimer screen as step 1; TOTAL_STEPS 7 → 8; existing tests need updating. | ✓ |

**User's choice:** First step of onboarding (Step 0). TOTAL_STEPS becomes 8.

### D2. Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Versioned flag (`acknowledgedDisclaimer: 'v1'` string) | Forward-compatible; bumping version re-prompts users. | ✓ |
| Plain boolean | Matches SC#2 literally. Trade: no clean re-prompt signal if Phase 7 updates copy. | |
| Per-device boolean (sync-excluded) | Treats consent as device-specific. Trade: extra Phase-5 sync-exclusion to remember. | |

**User's choice:** Versioned flag.

### D3. Refuse / decline path

| Option | Description | Selected |
|--------|-------------|----------|
| "Cancel" button → sends back to marketing | Honest UX with funnel-drop visibility. | |
| Single "I understand" — no refuse path | Acknowledgment-only modal. Strongest legal posture. | ✓ |
| "Cancel" dismisses modal, blocks app entry | Modal-but-not-modal weird state. | |

**User's choice:** Single "I understand"; no decline path.

---

## E. Bundle splitting for Lighthouse 90+

| Option | Description | Selected |
|--------|-------------|----------|
| Lighthouse 90+ minimum | `rollup-plugin-visualizer` + explicit `manualChunks` for chart.js, framer-motion, lucide-react. No library swaps. ~1 task. | ✓ |
| Lighthouse 95+ stretch | Same + swap lucide-react, dynamic-import framer-motion, defer chart.js. 2-3 tasks. | |
| Defer perf to Phase 2.1 | Ship as-is; let `/gsd-ui-review 2` flag failures. Risk: SC#1 fails verification. | |

**User's choice:** Lighthouse 90+ minimum; targeted manualChunks + lazy audit; no library swaps in this phase.

---

## F. CMIA copy enforcement (SC#5 grep test)

| Option | Description | Selected |
|--------|-------------|----------|
| Exactly the 4 listed in SC#5 | `depression`, `anxiety`, `therapy`, `mental health treatment`. Case-insensitive word-boundary regex; excludes test files. | ✓ |
| Broaden with research-suggested terms | Planner researches CMIA AB 2089 + WMHMDA full list (e.g., `psychiatric`, `bipolar`, etc.). Trade: false-positive churn. | |
| Allowlist instead | Document permitted vocabulary; lint-fail others. Heavier to maintain. | |

**User's choice:** Exactly the 4 SC#5 terms. New `compliance-copy` CI job.

---

## G. Vercel env-var split

| Option | Description | Selected |
|--------|-------------|----------|
| Three distinct envs: Production, Preview, Development | Per-env DSN/key sets; analytics enabled in Prod only; PR previews don't pollute prod issue lists. | ✓ |
| Two envs: Production + everything-else | Production = real keys; Preview + Dev share empty config. Simpler. Trade: PR previews can't smoke-test SDKs. | |

**User's choice:** Three distinct envs.

---

## H. Sentry source-map upload

| Option | Description | Selected |
|--------|-------------|----------|
| Run during Vercel build, blocking | `sentry-cli sourcemaps inject` + `upload` in build command; release = git SHA; deploy fails on upload failure. Strongest guarantee. | ✓ |
| Vercel build hook, async (deploy-then-upload) | Deploy ships; webhook does the upload after. Faster; window of unresolved errors. | |

**User's choice:** Blocking upload during Vercel Production builds (no upload on Preview).

---

## Claude's Discretion

- Exact placement/rotation angle of the diagonal watermark within the chart
- CSS variable names for the disclaimer modal (must match Modal primitive)
- `vite.marketing.config.ts` entry-point mechanism (separate marketing.html vs multi-page input)
- Sentry release-tag exact format (commit SHA only vs SHA + branch)
- Whether Lighthouse CI runs on every PR or only production deploys
- Disclaimer modal body copy (within the floor: "Not medical advice — consult your healthcare provider")

## Deferred Ideas

- Marketing → SPA handoff UX (anchor vs JS redirect)
- Library swaps for Lighthouse 95+ (lucide → @tabler/icons, dynamic framer-motion, deferred chart.js)
- CSP report-only endpoint with violation collector (needs Phase 4 ingest)
- Country/jurisdiction disclaimer variants (WA WMHMDA, CA CMIA) — Phase 7 with legal counsel
- DoctorReport PDF disclaimer — Phase 3
- Permissions-Policy hardening — Phase 7
- Monorepo refactor (Turborepo / workspaces) — when cross-app code sharing actually needed
- Cross-device sync of `acknowledgedDisclaimer` — falls out of Phase 5
- Re-acknowledgment cadence (annual? per-major-version-only?) — Phase 7 legal sets
- CHDP policy + FTC HBNR registration + BAA template — Phase 7
- Marketing analytics + tracking pixels — Phase 7 with proper CHDP
