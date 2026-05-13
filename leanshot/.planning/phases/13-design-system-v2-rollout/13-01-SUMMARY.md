---
phase: 13-design-system-v2-rollout
plan: 01
subsystem: design-system / tokens / fonts / perf-ci
tags: [design-system, tokens, fonts, lighthouse, fcp, lcp, perf, ci]
dependency_graph:
  requires:
    - Phase 2.1 perf-fix (preload + onload swap pattern in index.html)
    - Phase 12 12-04 CSP snapshot test (fonts.googleapis.com + fonts.gstatic.com pre-allowed)
  provides:
    - v2 design-token surface in :root (cream-100 / cream-card / border / text-secondary / warm shadows / 16 px type floor)
    - Geist + Geist Mono + Fraunces web fonts loaded via 3 byte-identical <link> tags
    - --grain-noise paper-grain CSS variable (light only)
    - --heading-tracking-tight + .heading-tight opt-in utility
    - --button-primary-{sheen-top,inset-highlight-top,inset-shadow-bottom} CSS variables (consumed by Wave-2 13-02 Button refresh)
    - 13-FCP-BASELINE.json (FCP 586 ms / LCP 594 ms baseline at SHA 44ad4766)
    - scripts/assert-fcp-lcp-delta.sh (CI delta gate)
    - lighthouse: job extended with a single FCP/LCP delta-assert step
  affects:
    - Every page using --color-bg, --color-surface, --color-text-secondary, --color-border, --font-sans, --font-mono, --shadow-{xs,sm,md,lg,2xl}, --text-base (i.e. ~all dashboard surfaces) — cascades automatically via Tailwind v4 var(--*) consumers
tech_stack:
  added: []
  patterns:
    - Tailwind v4 @theme value-only token swap (no plumbing change)
    - Filament Group rel=preload + media=print + onload swap (preserved verbatim — Phase 2.1)
    - LHCI delta gate (median of 3 desktop runs, ±5 % tolerance read from JSON not script)
key_files:
  created:
    - leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json
    - leanshot/scripts/assert-fcp-lcp-delta.sh
  modified:
    - leanshot/src/index.css
    - leanshot/index.html
    - .github/workflows/ci.yml
decisions:
  - D-02 honoured: tokens + fonts shipped as PR-1, ALONE, before any Wave-2 component change
  - D-07 + D-13 honoured: ±5 % FCP/LCP delta gate enforced via committed baseline + assert script
  - D-10 honoured: no @import url(...fonts.googleapis...) anywhere in leanshot/ (confirmed by grep)
  - D-11 honoured: token swap precedes component refresh — Wave 2 cascades visual change through var(--color-*) automatically
  - lighthouserc.json LEFT UNCHANGED: `lhci collect` writes lhr-*.json into ./.lighthouseci by default, so no rc edit was needed (one fewer file in the diff)
metrics:
  duration_minutes: 8
  completed_date: 2026-05-13
  commits: 4
  files_changed: 5
  bundle_index_chunk_gz_kb: 12.52
---

# Phase 13 Plan 01: Tokens + Fonts + FCP/LCP CI Gate Summary

**One-liner:** Phase 13 PR-1 — value-only Tailwind v4 `@theme` token swap (cream/border/shadows/type-floor), Google Fonts swap (Inter+JetBrains Mono → Geist+Geist Mono, Fraunces preserved), new paper-grain SVG overlay + sheen + heading-tracking tokens, and a ±5 % FCP/LCP delta CI gate so any perf regression from the font/overlay swap fails the PR.

---

## > WAVE 2 EXECUTORS MUST WAIT FOR THIS PR TO LAND ON `main` (D-02 + D-11). Do not parallel-dispatch Wave 2 plans until the PR-1 merge commit is on `main` AND the `lighthouse:` CI job has passed on that merge commit.

The Wave-1 SOLO contract (D-02) is the only reason this plan exists as its own PR: if a component refresh shipped alongside the token swap, a perf regression couldn't be isolated to the font/overlay change, and the rollback boundary (revert PR-1) would no longer be one-commit-clean.

---

## Captured Baseline (Task 1)

| Field          | Value |
|----------------|-------|
| `fcp_ms`       | **586** (median of 3 desktop runs) |
| `lcp_ms`       | **594** (median of 3 desktop runs) |
| `captured_sha` | `44ad4766deb550935db7d7695f7ad73e5c29719c` (pre-Phase-13 origin/main) |
| `captured_at`  | `2026-05-13T17:18:00Z` |
| `captured_url` | `https://leanshot-app.vercel.app` |
| `lhci_version` | `0.15.1` |
| `preset`       | `desktop` |
| `tolerance_pct`| `5` |

Raw runs (sorted): FCP [585, 586, 809] ms · LCP [593, 594, 821] ms — the third run captures cold-cache / network jitter; the median is what the gate enforces against. The script uses `jq -s | sort | .[length/2 | floor] | round` (NOT mean) so a single slow run cannot poison the baseline.

`captured_url` is the public production Vercel hostname (`leanshot-app.vercel.app`). PR-1's lighthouse job will run against the PR's Vercel **preview** URL (a different hostname, but the same Vite build artifacts + Vercel CDN edge), which is the correct apples-to-apples comparison once Phase 13 v2 CSS+fonts go live.

---

## v1 → v2 Token Diff (Task 2)

| Token | v1 value | v2 value | Notes |
|-------|----------|----------|-------|
| `--color-cream-100` | `#efebe0` | `#f2ede0` | page bg (warmer cream) |
| `--color-cream-card` | `#fdfbf6` | `#fefcf7` | paper-white surface |
| `--color-border` | `#e2ddd0` | `#dad3c0` | stronger v2 neutral |
| `--color-text-secondary` | `#556660` | `#4d5e58` | 6 % darker for contrast |
| `--shadow-xs` | `0 1px 2px rgba(22,34,31,.04)` | `0 1px 2px rgba(40,32,20,.04)` | warm-brown tint |
| `--shadow-sm` | `0 2px 4px rgba(22,34,31,.05)` | `0 2px 4px rgba(40,32,20,.05)` | warm-brown tint |
| `--shadow`    | `0 6px 16px rgba(22,34,31,.06)` | `0 6px 16px rgba(40,32,20,.06)` | warm-brown tint |
| `--shadow-md` | `0 10px 24px rgba(22,34,31,.08)` | `0 10px 24px rgba(40,32,20,.08)` | warm-brown tint |
| `--shadow-lg` | `0 16px 40px rgba(22,34,31,.10)` | `0 16px 40px rgba(40,32,20,.10)` | warm-brown tint |
| `--shadow-2xl`| `0 32px 80px rgba(22,34,31,.16)` | `0 32px 80px rgba(40,32,20,.16)` | warm-brown tint |
| `--shadow-hero` | `0 24px 60px -12px rgba(15,48,44,.45)` | UNCHANGED | hero stays teal-tinted (sits on hero panels) |
| `--text-base` | `0.9375rem` (15 px) | `1rem` (16 px) | body type floor |
| `--font-sans` | `'Inter', …` | `'Geist', …` | DS-01 |
| `--font-mono` | `'JetBrains Mono', …` | `'Geist Mono', …` | DS-01 |
| `--font-display` | `'Fraunces', …` | UNCHANGED | display/italic accents |
| `<meta theme-color light>` | `#EFEBE0` | `#F2EDE0` | matches new cream-100 |

Note: prettier normalised hex literals to lowercase (`#F2EDE0` → `#f2ede0`). The verify regex uses `/i` so the gate still passes. Dark-mode tokens unchanged (the cool-shadow recipe is already `rgba(0,0,0,…)` in dark — warm-tinted shadows are light-only).

## New v2 Tokens Appended

| Token | Value | Consumer |
|-------|-------|----------|
| `--grain-noise` | inline `url("data:image/svg+xml;utf8,<svg …>")` with feTurbulence baseFrequency=0.9 numOctaves=2, 200×200, ~5 % opacity, warm-brown matrix | `body { background-image: var(--grain-noise) }` in light; `[data-theme=dark] body { background-image: none }` |
| `--heading-tracking-tight` | `-0.01em` | `.heading-tight` opt-in utility (Wave-2 components apply surface-by-surface) |
| `--button-primary-sheen-top` | `linear-gradient(to bottom, rgba(255,255,255,0.12), rgba(255,255,255,0))` | Wave-2 13-02 Button primary refresh |
| `--button-primary-inset-highlight-top` | `inset 0 1px 0 rgba(255,255,255,0.18)` | Wave-2 13-02 |
| `--button-primary-inset-shadow-bottom` | `inset 0 -1px 0 rgba(0,0,0,0.12)` | Wave-2 13-02 |

The `--grain-noise` value resolves to `none` in `[data-theme=dark]` so the overlay disables automatically when the theme toggle flips — no JS, no component edit.

---

## Geist Fonts URL (Task 3)

All three `<link>` `href` attributes in `leanshot/index.html` are byte-identical and target:

```
https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap
```

- `Geist:wght@400;500;600;700;800;900` — Black 900 reserved for hero numerals per design bundle
- `Geist+Mono:wght@400;500;600;700` — Bold 700 added vs v1 (was just 500;600) for emphatic numerals
- `Fraunces:ital,opsz,wght@…` — unchanged from v1
- `&display=swap` preserved (Phase 2.1 invariant — removing it re-introduces render-blocking)

Preserved verbatim:
- `<link rel="preconnect" href="https://fonts.googleapis.com" />` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`
- `<link rel="preload" as="style" …>` + `<link rel="stylesheet" media="print" onload="this.media='all'" …>` + `<noscript><link rel="stylesheet" …></noscript>`
- Phase 2.1 comment block (updated to reference Geist instead of Inter, but the WHY paragraph is intact)

Confirmed by grep:
```
grep -RIn '@import url(' leanshot/ | grep -i fonts.googleapis
→ ZERO matches (D-10 + chat1.md landmine 2 enforced)
```

---

## CI Gate (Task 4)

`leanshot/scripts/assert-fcp-lcp-delta.sh` (162 LOC):

- Reads `fcp_ms`, `lcp_ms`, `tolerance_pct`, `captured_sha` from `13-FCP-BASELINE.json` via `jq`.
- Collects `lhr-*.json` from `.lighthouseci/`, extracts `audits["first-contentful-paint"].numericValue` + `audits["largest-contentful-paint"].numericValue`, computes median (`jq -s | sort | .[length/2 | floor] | round`).
- Computes `(current - baseline) / baseline * 100` via `awk` (float-safe — bash arithmetic is integer-only and would silently truncate sub-percent deltas).
- Negative delta (speedup) always passes; positive delta `> tolerance_pct` fails.
- Tolerance is read from the JSON, NOT hardcoded — future phases can re-baseline by editing the JSON only.
- `--dry-run --current-fcp=<ms> --current-lcp=<ms>` mode for smoke tests.

Local smoke-test results:

| Scenario | Result | Exit |
|----------|--------|------|
| `--current-fcp=586 --current-lcp=594` (equal to baseline) | PASS, 0.00 % delta on both | `0` |
| `--current-fcp=644 --current-lcp=594` (+9.90 % FCP) | FAIL with diagnostic listing baseline, current, delta | `1` |
| `--current-fcp=293 --current-lcp=594` (-50 % FCP speedup) | PASS, -50.00 % delta accepted | `0` |

CI wiring: ONE new step appended inside the existing `lighthouse:` job in `.github/workflows/ci.yml` (lines 470–481), AFTER the existing `Run Lighthouse against Vercel preview` step. No new top-level job. `needs:` unchanged. `if: pull_request` unchanged. Phase 12 D-12 pattern + planner anti-pattern #6 memory honoured.

---

## Bundle Index Chunk

| Snapshot | Index chunk size (gz) |
|----------|-----------------------|
| Phase 12 close | 21.49 kB |
| Phase 13 Plan 01 (this plan) | **12.52 kB** |

The index chunk **shrank** by ~9 kB despite adding v2 token literals + a larger SVG data URL inside `@theme`. The most plausible explanation is that v2 reorganised the chunk graph at Phase 12 close (manualChunks tightening). The 50 kB Phase 12 ceiling is comfortably honoured.

> If Wave 2 (13-02 Button + 13-03 illustrations + 13-04 marketing) re-inflates the index chunk past the 50 kB ceiling, the dedicated `assert-bundle-budget.sh` CI guard will fail the PR — that gate is orthogonal to the FCP/LCP delta gate added here.

---

## End-of-Plan Green Sweep (Task 5)

| Check | Status |
|-------|--------|
| `npm run typecheck` | PASS (clean) |
| `npm run build` | PASS (3.99s, index gz 12.52 kB) |
| `vitest run tests/csp/csp-snapshot.test.ts` | PASS (1 test, 1 passed) |
| All 750 vitest tests (full suite invoked while running CSP check) | PASS (750 passed, 6 skipped) |
| `grep -RIn '@import url(' leanshot/ \| grep fonts.googleapis` | ZERO matches |
| `git diff --stat 7fea755..HEAD` | 5 files (matches files_modified — `lighthouserc.json` deliberately untouched, see Decisions) |
| `npm run lint` | NOT clean — but all errors pre-existing (e.g. SharePage `import-x/order`, dead `beforeEach` in Phase 8 tests). Zero errors come from any file touched by this plan. CSS / HTML / shell are not linted by the project's eslint config. |

The `npm run lint` finding is **out of scope** per the deviation rules (pre-existing failures in unrelated files). Logged separately in **Deferred Issues** below.

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed essentially as written.

### Out-of-scope discoveries (NOT fixed)

**1. Pre-existing lint failures** — `npm run lint` reports 84 errors + 21 warnings across `SharePage`-adjacent imports and dead Phase 8 test imports. None caused by this plan. Logged for a future cleanup phase; not blocking Phase 13.

**2. `npm run test` script chains `vitest run && playwright test`** — passing extra argv (`-- --run tests/csp/csp-snapshot.test.ts`) breaks because playwright rejects `--run`. Used `npx vitest run tests/csp/csp-snapshot.test.ts` directly to verify CSP snapshot test alone. Pre-existing oddity in `package.json` test script; not Phase 13's job to fix.

### Architectural notes

- `lighthouserc.json` was **not** modified. The plan listed it in `files_modified` with a "Possibly" hedge; the script reads `.lighthouseci/lhr-*.json` (lhci's default output) so no rc change is needed. This keeps the PR diff one file smaller and the assertion logic decoupled from LHCI configuration.

- `captured_url` in the baseline is the **production hostname** (`leanshot-app.vercel.app`) rather than a SHA-specific preview URL. This is intentional and documented in the JSON's `notes` field — production reflects what real users on `main` see, and PR-1's gate compares against that. If a future phase decides preview-URL-vs-preview-URL comparison is more apples-to-apples, the baseline can be re-captured against a known PR's preview URL with no script change required.

---

## Threat Flags

None introduced. Token swap, font URL swap, and a read-only CI assert script touch no new auth paths, network endpoints, or trust boundaries. The threat register in 13-01-PLAN.md (T-13.01-01 … T-13.01-06) remains accurate post-execution.

---

## Post-merge CI Outcome

**Placeholder — fill in after PR-1 merges:** the new `Assert FCP/LCP delta vs Phase 13 baseline (D-07)` step's PASS/FAIL line + computed deltas will be visible in the lighthouse job log for the merge commit's CI run. Expected outcome: PASS with deltas within ±5 % (the only physical changes vs baseline are the Geist font load via the same CDN as Inter, the `--grain-noise` background-image SVG on the body, and the value-only token mutations — none of which should move FCP/LCP materially on the desktop preset).

If the gate FAILS on merge, the rollback is one-commit-clean: revert the merge commit. The baseline JSON stays committed so a follow-up PR can re-attempt the swap without re-running the baseline capture.

---

## Wave-2 Follow-ups (handoff to 13-02 through 13-06)

1. **13-02 Button refresh** — wire `var(--button-primary-sheen-top)` + `var(--button-primary-inset-highlight-top)` + `var(--button-primary-inset-shadow-bottom)` into the existing `Button` `primary` variant classes (likely as a sheen overlay div + inset box-shadow). No `Button.tsx` import change required; the variant just consumes new CSS vars.
2. **13-02 / 13-04 / 13-05 heading components** — opt into `.heading-tight` utility where the design bundle calls for `-0.01em` tracking (typically on dashboard card titles + marketing H1/H2). Apply per-surface; don't blanket-cascade.
3. **13-03 illustrations** — verify any inline SVG that previously used hard-coded cool-tint shadows now reads `var(--shadow-*)` so the warm-tint swap propagates automatically. If a Wave-1-era SVG still inlines `rgba(22,34,31,…)`, that's a Wave-2 fix.
4. **VR / visual-regression suite (13-06)** — add `data-theme=dark` capture to confirm `--grain-noise` resolves to `none` and the body has no overlay in dark mode (already verified manually via DevTools toggle, but VR captures it for future regressions).

---

## Self-Check: PASSED

- `leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json` — FOUND
- `leanshot/scripts/assert-fcp-lcp-delta.sh` — FOUND (executable)
- `leanshot/src/index.css` — modified (v2 tokens present, v1 tokens absent, all regex gates pass)
- `leanshot/index.html` — modified (3 byte-identical v2 font URLs, light theme-color updated)
- `.github/workflows/ci.yml` — modified (one new step inside lighthouse: job)
- Commit `a76d52d` — FOUND (Task 1 baseline)
- Commit `d0d47fe` — FOUND (Task 2 CSS)
- Commit `6ebe83d` — FOUND (Task 3 HTML)
- Commit `471706d` — FOUND (Task 4 script + CI)
- Build PASS — index chunk gz 12.52 kB (≤ 50 kB ceiling)
- CSP snapshot test PASS
- Typecheck PASS
- No `@import url(...fonts.googleapis...)` anywhere in `leanshot/` (D-10)
