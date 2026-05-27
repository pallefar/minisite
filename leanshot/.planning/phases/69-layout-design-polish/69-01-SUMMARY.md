---
phase: 69-layout-design-polish
plan: 1
subsystem: design-system / ci
tags: [ci, design-system, tailwind-v4, deno]
requires:
  - Phase 67-03 sentry-dsn-check.yml pattern (workflow + Deno test runner)
  - Phase 60-13 typography normalization (defines the {11,13,18,28} ceiling)
provides:
  - DS-01 CI gate (undefined @theme token regression prevention)
  - DS-02 CI gate (typography ceiling enforcement)
  - DS-03 CI gate (accent color reserved-surface policy)
  - .github/workflows/design-system-check.yml (4 parallel jobs)
  - accent-reserved-list.md (DS-03 policy doc)
affects:
  - All future PRs touching leanshot/src/**/*.{tsx,ts,css}
tech-stack:
  added:
    - Deno 2.x as CI script runner (already in use for sentry-dsn-check)
  patterns:
    - Two-layer classifier (built-ins/palette/arbitrary first, custom tokens second)
    - Baseline-grandfather file for migrations-in-flight (DS-02 366 files, DS-03 12 files)
    - File-pattern reserved/forbidden lists (DS-03 RESERVED_FILE_PATTERNS / FORBIDDEN_FILE_PATTERNS)
key-files:
  created:
    - scripts/ci/check-tailwind-tokens.ts
    - scripts/ci/check-tailwind-tokens.test.ts
    - scripts/ci/check-typography-ceiling.ts
    - scripts/ci/check-typography-ceiling.test.ts
    - scripts/ci/check-typography-ceiling.baseline.txt
    - scripts/ci/check-accent-reserved.ts
    - scripts/ci/check-accent-reserved.test.ts
    - scripts/ci/check-accent-reserved.baseline.txt
    - leanshot/.planning/design-system/accent-reserved-list.md
    - .github/workflows/design-system-check.yml
  modified: []
decisions:
  - "DS-01: hardcoded ALLOW_LIST (only 3 files); DS-02 + DS-03: separate baseline.txt files (366 + 12 files respectively) — easier to maintain a flat list than 366 inline reason strings"
  - "Strict-mode only — no informational/soft-fail toggle. Phase 69.5 sweep tightens the baselines"
  - "DS-03 marketing/Landing.tsx is FORBIDDEN-pattern (not baselined) per Phase 60-13 quote-extraction lesson"
metrics:
  duration_min: 10
  completed: 2026-05-27
  tasks: 4
  files_created: 10
  tests_added: 41
---

# Phase 69 Plan 69-01: Design System CI Gates Summary

3 CI gates (DS-01 undefined-token / DS-02 typography-ceiling / DS-03 accent-reserved) + GitHub Actions workflow + accent-reserved-list.md doc. All 41 Deno unit tests pass. All 3 scripts PASS the current codebase via grandfather baselines.

## What shipped

### DS-01 — Undefined Tailwind v4 @theme token guard

`scripts/ci/check-tailwind-tokens.ts` walks `leanshot/src/**/*.{tsx,ts}` (skipping `.test.*`, `.stories.*`, `__tests__/`), extracts the `@theme { ... }` block from `leanshot/src/index.css` (143 defined tokens), and flags any `text-*` / `bg-*` / `border-*` / `from-*` / `to-*` / `via-*` / `ring-*` / `divide-*` / `placeholder-*` / `fill-*` / `stroke-*` / `outline-*` / `decoration-*` / `caret-*` / `accent-*` / `shadow-*` utility whose suffix resolves to neither:

1. A defined token (147 valid suffixes derived from the 143 @theme tokens),
2. A Tailwind v4 built-in (numeric scale, alignment keyword, palette color, gradient direction, ring-inset, opacity modifier, arbitrary `[value]`), OR
3. The inline `ALLOW_LIST` (3 files grandfathered).

**Two-layer classifier pattern** (per `[[reference_two_layer_real_vs_stub_classifier]]`): built-ins / palette / arbitrary checked first; @theme custom tokens checked second.

**Singleton-string heuristic:** TypeScript enum literals like `'text-list'` (in `case 'text-list':`) are NOT flagged when they appear alone in a quote pair and there's no `className=`/`cn(`/`clsx(`/`tw\`` context on the line.

**14 Deno tests** covering @theme parsing, suffix derivation, built-in passes, undefined-token fails, opacity modifier, gradient stops, `.test.tsx` skipping, empty-`@theme` flag-all behavior.

**Initial-run audit (2026-05-27):** 845 files scanned, 13 undefined-token usages across 3 files grandfathered into ALLOW_LIST for Phase 69.5 sweep:

- `leanshot/src/components/AccountSuspended.tsx` (5 usages: `text-secondary`, `text-accent`, `ring-accent`)
- `leanshot/src/components/knowledge/KnowledgeNotFound.tsx` (2 usages: `text-text-primary`, `text-accent`)
- `leanshot/src/components/knowledge/SourcesPanel.tsx` (6 usages: `text-text-primary`, `bg-warning-subtle`, `text-warning-foreground`, `border-border-subtle`, `text-accent`)

### DS-02 — Typography ceiling guard

`scripts/ci/check-typography-ceiling.ts` enforces font-sizes ∈ `{11, 13, 18, 28}` px and font-weights ∈ `{400, 600}` (Phase 60-13 normalization). Flags 6 violation kinds:

1. Tailwind arbitrary literals: `text-[14px]`, `text-[1.25rem]`
2. Tailwind built-in utilities mapping to non-ceiling px (text-base=16, text-xs=12, text-xl=22, text-2xl=26 fail; text-sm=13, text-lg=18, text-heading=28, text-micro=11 pass)
3. Inline `style={{ fontSize: '14px' }}` or `fontSize: 14`
4. Tailwind named font-weight utilities outside `{font-normal, font-semibold}` (font-medium, font-bold, font-thin, font-light, font-extrabold, font-black all fail)
5. Arbitrary `font-[500]` weight literals
6. CSS files (NOT `index.css`): `font-size: 14px` / `font-weight: 500`

**14 Deno tests** covering parseSizeToPx, all 6 violation kinds, comment suppression, `.test.tsx` skip, `index.css` source-of-truth skip.

**Baseline:** `scripts/ci/check-typography-ceiling.baseline.txt` (366 files) — captures every file currently using a non-ceiling size/weight. Phase 69.5 shrinks the list. New files outside the baseline that introduce ceiling violations fail the gate.

### DS-03 — Accent color reserved-surface guard

`scripts/ci/check-accent-reserved.ts` greps for accent classes (`text-primary`, `bg-accent`, `text-success`, `text-warning`, `text-danger`, `text-info` + `-soft`, `-foreground`, `-hover` sub-modifiers + `/N` opacity modifiers + `ring-`, `border-`, `from-`, etc. prefixes) and decides allowed-vs-not by:

1. **RESERVED_FILE_PATTERNS** — 22 globs covering `ui/Button.tsx`, `ui/Badge.tsx`, `ui/Pill.tsx`, `ui/Spinner.tsx`, `ui/Toast.tsx`, `ui/ProgressRing.tsx`, `ui/EmptyState.tsx`, `StatusDot.tsx`, `StatusBadge.tsx`, `streaks/**`, `badges/**`, `charts/**`, `dashboard/cards/**`, `CtaButton.tsx`, `PrimaryCta.tsx`, `Sidebar.tsx`, `MobileNav.tsx`, `TabSwitcher.tsx`, `ErrorMessage.tsx`, `FieldError.tsx`, `StreakBanner.tsx`, `StreakMeter.tsx`. Accent allowed silently.
2. **FORBIDDEN_FILE_PATTERNS** — `**/marketing/Landing.tsx` per Phase 60-13 quote-extraction lesson. Accent ALWAYS fails.
3. **Everything else** — baseline file (`scripts/ci/check-accent-reserved.baseline.txt`, 12 files) grandfathers existing usages. New files fail.

**Critical regex detail:** `text-text-primary` is NOT treated as accent — DS-01 owns it. Negative-lookbehind `(?<![a-zA-Z0-9-])` on the accent class regex anchors the prefix so `text-text-primary` doesn't false-fire as `text-primary` starting at position 5.

**13 Deno tests** covering glob conversion, class-context detection, `text-text-primary` exclusion, reserved/forbidden/baseline routing, opacity modifier capture, `-soft` sub-modifier capture, baseline-loader comment-skipping.

**Baseline (12 files):**
- helpdesk admin: `HelpdeskInboxPage`, `SentimentQueuePage`, `TicketDetailPage`
- auth: `TotpEnrollFlow`
- knowledge: `KnowledgeArticleDetailPage`, `KnowledgeNotFound`, `KnowledgeRootPage`, `KnowledgeTopicIndexPage`, `SourcesPanel`
- landing/settings: `AccountSuspended`, `AudienceLandingPage`, `SecuritySettingsPage`

**Reserved-list doc:** `leanshot/.planning/design-system/accent-reserved-list.md` documents the policy with rationale, reserved + forbidden surface lists, audit workflow, and how to shrink/grow the baseline.

### Workflow `.github/workflows/design-system-check.yml`

4 parallel jobs on push-to-main + PR-to-main:

- `tailwind-tokens` → `deno run -A scripts/ci/check-tailwind-tokens.ts`
- `typography-ceiling` → `deno run -A scripts/ci/check-typography-ceiling.ts`
- `accent-reserved` → `deno run -A scripts/ci/check-accent-reserved.ts`
- `script-tests` → runs all 3 `.test.ts` files via `deno test`

Mirrors the Phase 67-03 `sentry-dsn-check.yml` pattern: `defaults.run.working-directory: .` (NOT `leanshot/`) so scripts read paths relative to git root.

## Verification

```
$ deno test --no-check -A scripts/ci/check-tailwind-tokens.test.ts      # 14 passed
$ deno test --no-check -A scripts/ci/check-typography-ceiling.test.ts   # 14 passed
$ deno test --no-check -A scripts/ci/check-accent-reserved.test.ts      # 13 passed

$ deno run --no-check -A scripts/ci/check-tailwind-tokens.ts            # PASS (13 grandfathered)
$ deno run --no-check -A scripts/ci/check-typography-ceiling.ts         # PASS (366 grandfathered)
$ deno run --no-check -A scripts/ci/check-accent-reserved.ts            # PASS (12 grandfathered)
```

## Commits

| Task | Hash       | Message                                                              |
| ---- | ---------- | -------------------------------------------------------------------- |
| 1    | `28ee3196` | DS-01 check-tailwind-tokens.ts CI guard                              |
| 2    | `9614f920` | DS-02 check-typography-ceiling.ts CI guard                           |
| 3    | `13f0aadb` | DS-03 check-accent-reserved.ts CI guard + reserved-list doc          |
| 4    | `d2050050` | design-system-check.yml — DS-01/02/03 parallel CI gates              |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] False-positive scope: comments + non-className contexts**

- **Found during:** Task 1 initial scan (696 false-positive violations on first run).
- **Issue:** Naïve line-level scan flagged token-shaped tokens in:
  - JSDoc/block comments (`* The text-base utility...`)
  - TypeScript enum string literals (`case 'text-list':`)
  - String values not used as className (`'text-tertiary.'` in prose)
- **Fix:** (a) strip `/* */` block comments + `//` line comments before scanning; (b) singleton-string heuristic — if a candidate appears as `"<token>"` (tight quotes) and the line has no `className=`/`cn(`/`clsx(`/`tw\`` context, skip.
- **Files modified:** `scripts/ci/check-tailwind-tokens.ts` (extended regex + comment stripping + singleton check)
- **Commit:** `28ee3196`

**2. [Rule 1 - Bug] Tailwind built-in directional border / SVG / gradient false-positives**

- **Found during:** Task 1 second-pass scan.
- **Issue:** `border-t`, `border-b-0`, `border-l-4`, `border-t-transparent`, `border-s-[var(--color-danger)]`, `ring-inset`, `bg-gradient-to-br`, `stroke-dashoffset`, `stroke-dasharray` are all Tailwind v4 built-ins — not custom tokens.
- **Fix:** Added `border-{t,r,b,l,x,y,s,e}-{width|builtinKeyword|paletteColor|customToken|arbitrary[...]}` directional handling, gradient-direction regex (`bg-gradient-to-(br|bl|tr|tl|t|b|l|r)`), `ring-inset` keyword, SVG_BUILTIN_SUFFIXES set (`dashoffset`, `dasharray`, `linecap`, `linejoin`, `width`, `rule`), `outline-offset` prefix, and trailing-punctuation cleanup (`text-tertiary.` → `text-tertiary` re-check).
- **Files modified:** `scripts/ci/check-tailwind-tokens.ts`
- **Commit:** `28ee3196`

**3. [Rule 2 - Missing] DS-02 ceiling baseline was missing — 1655 violations on initial scan**

- **Found during:** Task 2 initial scan.
- **Issue:** Phase 60-13 normalized only 6 surfaces; the other ~360 surfaces use `text-xs`/`text-base`/`text-xl`/`font-medium`/`font-bold` extensively. The plan said "may emit existing violations to allow-list" but a hand-curated 366-entry inline allow-list with per-file reasons would be unmaintainable.
- **Fix:** Introduced `scripts/ci/check-typography-ceiling.baseline.txt` — flat list of grandfathered files (one path per line, with header comment). Script loads it at runtime via `loadAllowList(baselinePath)`. Same pattern reused for DS-03 baseline.
- **Files modified:** `scripts/ci/check-typography-ceiling.ts` (added `loadAllowList`, refactored `scanProject` signature to accept allowList parameter)
- **Commit:** `9614f920`

**4. [Rule 1 - Bug] DS-03 regex false-fired on `text-text-primary`**

- **Found during:** Task 3 test development.
- **Issue:** Initial accent-class regex used `\b(text|bg|...)-(primary|...)` which matched the `text-primary` substring inside `text-text-primary`. That would conflict with DS-01 (which owns the `text-text-primary` violation).
- **Fix:** Added negative-lookbehind `(?<![a-zA-Z0-9-])` to anchor the prefix at a real word boundary that doesn't allow another token segment immediately before.
- **Files modified:** `scripts/ci/check-accent-reserved.ts`
- **Commit:** `13f0aadb`

## Known Limitations

- **DS-01:** Scanner is regex-based, not a Tailwind compiler. CSS-in-JS (styled-components, emotion) is not parsed. Dynamic class names from variables (`const cls = makeClass(theme)`) are not resolved.
- **DS-02:** Cannot detect `text-[\${pxVar}px]` dynamic interpolations. Cannot detect framer-motion `style={{...}}` size animations.
- **DS-03:** File-pattern based. A legitimate accent usage in a non-reserved file requires either renaming the file to match a RESERVED_FILE_PATTERN, extracting an accent-purpose sub-component (e.g. `<CtaButton>` from the inline classes), OR adding the file to the baseline.

## Threat Flags

None — this plan ships CI tooling only. No new attack surface, no schema changes, no auth paths.

## Deferred Issues

None. All 4 tasks complete; all gates green; all tests pass.

## Self-Check

Files created (10):
- FOUND: `scripts/ci/check-tailwind-tokens.ts`
- FOUND: `scripts/ci/check-tailwind-tokens.test.ts`
- FOUND: `scripts/ci/check-typography-ceiling.ts`
- FOUND: `scripts/ci/check-typography-ceiling.test.ts`
- FOUND: `scripts/ci/check-typography-ceiling.baseline.txt`
- FOUND: `scripts/ci/check-accent-reserved.ts`
- FOUND: `scripts/ci/check-accent-reserved.test.ts`
- FOUND: `scripts/ci/check-accent-reserved.baseline.txt`
- FOUND: `leanshot/.planning/design-system/accent-reserved-list.md`
- FOUND: `.github/workflows/design-system-check.yml`

Commits (4):
- FOUND: `28ee3196` (DS-01)
- FOUND: `9614f920` (DS-02)
- FOUND: `13f0aadb` (DS-03)
- FOUND: `d2050050` (workflow)

## Self-Check: PASSED
