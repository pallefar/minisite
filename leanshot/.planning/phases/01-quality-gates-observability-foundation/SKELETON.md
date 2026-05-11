---
phase: 1
slug: quality-gates-observability-foundation
type: walking-skeleton
created: 2026-05-10
---

# Walking Skeleton — LeanShot Engineering Rails

> Phase 1 is the first deliverable of a new project. The skeleton scaffolds the engineering loop that every subsequent phase will build on. Subsequent phases MUST NOT renegotiate these decisions.

---

## End-to-End Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  Engineer / Founder                                                   │
│       │                                                               │
│       ▼                                                               │
│   git clone leanshot && npm i                                         │
│       │                                                               │
│       ▼                                                               │
│   npm run typecheck → npm run lint → npm run format:check             │
│       │                                                               │
│       ▼                                                               │
│   npm run test:unit → npm run test:e2e (full local suite ~90s)        │
│       │                                                               │
│       ▼                                                               │
│   git push → GitHub Actions ci.yml (5 parallel jobs)                  │
│       │                                                               │
│       ▼                                                               │
│   PR green → merge to main                                            │
│                                                                       │
│   Runtime (dev/QA build with VITE_SENTRY_DSN + VITE_POSTHOG_KEY):    │
│       │                                                               │
│       ├──► Settings → Dev Tools → "Throw test error"                  │
│       │       │                                                       │
│       │       ▼                                                       │
│       │   Sentry dashboard receives event within 60s                  │
│       │   (symptom/mood/note/aiHistory absent from payload)           │
│       │                                                               │
│       └──► Click any tab → emits track('tab_viewed')                  │
│               │                                                       │
│               ▼                                                       │
│           PostHog dashboard receives event                            │
│           (distinct_id matches localStorage UUID;                     │
│            zero free-text health content)                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Architectural Decisions (Locked for All Future Phases)

These decisions were finalized in `01-CONTEXT.md` and verified in `01-RESEARCH.md`. Future phases reuse them without revisiting.

### Tech Stack (already locked in PROJECT.md)

| Layer | Choice | Version | Source of Truth |
|-------|--------|---------|-----------------|
| Frontend framework | React | ^19.0.0 | `package.json` |
| Build tool | Vite | ^6.0.1 | `vite.config.ts` |
| Language | TypeScript strict | ~5.6.3 | `tsconfig.app.json` |
| Styling | Tailwind v4 beta | ^4.0.0-beta.7 | `src/index.css` |
| State | Zustand | ^5.0.1 | `src/lib/store.ts` |
| Persistence (Phase 1) | localStorage only | — | `src/lib/storage.ts` |

### Phase 1 Additions (Locked from this Phase Forward)

| Capability | Tool | Version | Config Location |
|------------|------|---------|-----------------|
| Unit/integration tests | Vitest + React Testing Library | 4.1.5 + 16.3.2 | `vite.config.ts` `test` block |
| E2E smoke | Playwright (Chromium) | 1.59.1 | `playwright.config.ts` |
| Linter | ESLint flat-config | 10.3.0 | `eslint.config.js` (ESM) |
| Formatter | Prettier | 3.8.3 | `.prettierrc` |
| TS-aware lint | typescript-eslint | 8.59.2 | `eslint.config.js` |
| Error tracking | @sentry/react (errors-only) | 10.52.0 | `src/lib/sentry.ts` + `src/main.tsx` |
| Analytics | posthog-js (cookieless) | 1.372.10 | `src/lib/analytics.ts` + `src/main.tsx` |
| CI | GitHub Actions | — | `.github/workflows/ci.yml` |
| Test environment | jsdom | 29.1.1 | `vite.config.ts` `test.environment` |

### Directory Layout (Established Here)

```
leanshot/
├── .github/workflows/ci.yml          # 5-job CI pipeline
├── e2e/                              # Playwright tests (separate runner)
│   └── onboarding.spec.ts
├── src/
│   ├── lib/
│   │   ├── sentry.ts                 # beforeSend PII scrubber
│   │   ├── analytics.ts              # typed track() + EventName union
│   │   ├── helpers.test.ts           # co-located unit tests (D-07)
│   │   ├── storage.test.ts
│   │   └── sentry.test.ts
│   ├── hooks/
│   │   ├── useConfirm.ts             # Promise-based confirm wrapping Modal
│   │   └── useStreaks.test.ts
│   ├── components/
│   │   ├── ui/Confirm.tsx            # ConfirmModal wrapping Modal
│   │   └── onboarding/OnboardingFlow.test.tsx
│   └── test-setup.ts                 # @testing-library/jest-dom import
├── eslint.config.js                  # ESM flat-config
├── .prettierrc
├── playwright.config.ts
├── vite.config.ts                    # extends with `test` block
├── .env.example                      # VITE_SENTRY_DSN, VITE_POSTHOG_KEY, etc.
└── package.json                      # adds lint, format, test, test:unit, test:e2e
```

### Conventions Locked Here

1. **Co-located unit tests** (D-07): `foo.test.ts` lives next to `foo.ts`. Playwright tests live under top-level `e2e/`.
2. **Named exports only** (matches existing `src/lib/*` modules): no default exports in lib modules.
3. **localStorage try/catch wrapping** (matches existing `apiKeyStorage` pattern): every `localStorage.getItem`/`setItem` in `analytics.ts` and any future module wraps in try/catch.
4. **`@/*` path alias** (already in tsconfig + vite): all cross-directory imports use `@/` not `../../`.
5. **CI-only gates** (D-03): no Husky, no lint-staged. Trade accepted: contributors discover lint failures at CI, not on commit. Future-phase reconsideration captured in CONTEXT.md Deferred Ideas.
6. **Errors-only Sentry** (D-11): no Replay, no Tracing, no Profiling in Phase 1. Future phases may add (Replay → Phase 2 deploy, Tracing → Phase 4 Edge Functions).
7. **Production analytics dormant until Phase 7** (D-13): `VITE_ANALYTICS_ENABLED` defaults `false` in production builds. Phase 7 (legal-counsel-led compliance) flips it after WMHMDA / FTC HBNR review.
8. **PostHog distinct_id is a localStorage UUID** (D-15): Phase 5 (auth) will call `posthog.alias()` to bind anon UUID to `auth.uid()` after sign-in.
9. **Sentry redaction list = exactly four fields** (D-10): `symptom`, `mood`, `note`, `aiHistory`. Re-evaluation gate: Phase 7 legal-counsel review (deferred item documented).
10. **Single Node version in CI** (research §Pattern 5): Node 22 LTS, no version matrix. Phase 2 deploy may add cross-platform jobs if needed.

---

## Verifiable Gates (S-01..S-10)

| # | Gate | How to Verify | Phase 1 Plan |
|---|------|---------------|--------------|
| S-01 | Clone fresh, install | `git clone && npm i` exits 0 | (existing — no plan needed) |
| S-02 | Types pass | `npm run typecheck` exits 0 (after Plan 01 type fixes) | Plan 01 |
| S-03 | Lint passes | `npm run lint` exits 0 (after D-01 cleanup + ESLint config) | Plans 01, 02, 03 |
| S-04 | Format passes | `npm run format:check` exits 0 (after Prettier ran once) | Plan 03 |
| S-05 | Unit tests pass | `npm run test:unit` exits 0 (4 test suites green) | Plan 04 + Plan 05 (sentry.test.ts) |
| S-06 | E2E smoke passes locally | `npm run test:e2e` exits 0 (Chromium, onboarding completes) | Plan 06 |
| S-07 | Push trivial PR | GitHub Actions: all 5 jobs green, merge not blocked | Plan 06 |
| S-08 | Sentry receives error | Settings → Dev Tools → "Throw test error" → Sentry dashboard within 60s with redacted fields | Plan 05 |
| S-09 | PostHog receives events | dev build with `VITE_ANALYTICS_ENABLED=true` → tab clicks → PostHog `tab_viewed` events | Plan 05 |
| S-10 | Production build passes | `npm run build` with empty Sentry DSN + `VITE_ANALYTICS_ENABLED=false` exits 0 | Plan 05 (env-gated init) |

---

## What This Skeleton Does NOT Include (Deferred to Later Phases)

- **No deploy** — Phase 2 owns the custom domain + HTTPS + Vercel/Cloudflare/Netlify decision.
- **No Sentry source maps** — Phase 2 adds `@sentry/vite-plugin` once there's a deploy with minified JS.
- **No production analytics firing** — Phase 7 flips `VITE_ANALYTICS_ENABLED=true` after legal counsel sign-off.
- **No auth, no Supabase, no cloud sync** — Phases 4-6.
- **No pharmacology / insights tests** — Phase 3 owns these with cited peer-reviewed sources.
- **No Husky / lint-staged pre-commit hooks** — Deferred (CONTEXT.md Deferred Ideas).
- **No Sentry Replay / Tracing / Profiling** — Deferred (CONTEXT.md Deferred Ideas).
- **No Zustand store action tests** — Deferred (CONTEXT.md Deferred Ideas).
- **No coverage threshold enforcement** — Deferred until coverage drift becomes a problem.

---

*Skeleton defined: 2026-05-10*
*Source documents: `01-CONTEXT.md` (15 locked decisions), `01-RESEARCH.md` (verified versions + patterns), `01-PATTERNS.md` (analog files), ROADMAP.md Phase 1 success criteria*
