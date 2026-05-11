# Phase 3: Pharmacology + Insights Hardening — Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10 (all in-repo analogs available; Vitest already configured project-wide)

> Single biggest finding for the planner: **Vitest is already wired up** (`vite.config.ts:91-99`, `package.json` test scripts). Phase 3 does NOT need a `vitest.config.ts` Wave-0. Test files just land at `src/**/*.test.ts` and are picked up by the existing `include: ['src/**/*.test.{ts,tsx}']` glob. The pattern-mapping context's mention of "Wave 0 framework install" is stale.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/pharmacology.ts` (modify — citations only) | lib/domain (pure-TS constants + math) | transform | self — Phase 3 only adds JSDoc citations above `HALF_LIVES`, `calcMedLevel` | n/a (in-place edit) |
| `src/lib/pharmacology-corpus.ts` (NEW) | lib/domain (typed constant table) | transform (data table) | `src/lib/pharmacology.ts:63-98` (`TRIAL_DATA`) and `src/lib/pharmacology.ts:7-18` (`HALF_LIVES`) | exact (same role + same data flow: typed `Record`/array exported for downstream consumption) |
| `src/lib/pharmacology.test.ts` (NEW) | test (Vitest unit test) | request-response (call → assert) | `src/lib/helpers.test.ts` (pure-fn unit tests, no DOM); `src/lib/storage.test.ts` (state-fixture-based tests) | exact (same role: pure-fn assertions over a corpus) |
| `src/lib/insights-refusal.ts` (NEW) | lib/domain (pure helpers: tokenize, regex match, scrub) | transform (string → boolean / array filter) | `src/lib/helpers.ts` (pure utility module: `cn`, `clamp`, `escapeHtml`); `src/lib/insights.ts` (companion pure-fn module) | exact (same role: pure utilities exported for direct unit testing) |
| `src/lib/insights-refusal.test.ts` (NEW) | test (Vitest unit test) | request-response | `src/lib/helpers.test.ts` (`escapeHtml` describe block — string-in, boolean/string-out assertion loop) | exact |
| `src/lib/insights.ts` (modify) | lib/domain | transform | self — Phase 3 adds `scrubInsights(out)` before `return` and guards `pickFocus` result | n/a (additive wrapper) |
| `src/components/dashboard/charts/MedLevelChart.tsx` (modify) | component (Chart.js config factory inside `useMemo`) | request-response (state → ChartConfiguration → BaseChart) | self — same file is the only `MedLevelChart`; pattern lives in its current `useMemo` block | n/a (in-place additions) |
| `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` (modify) | utility (Chart.js `Plugin<'line'>`) | event-driven (Chart.js `afterDraw` hook) | self — single-purpose plugin; Phase 3 swaps the string, bumps the id, shrinks the font multiplier | n/a (in-place edit) |
| `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` (modify) | test (Vitest with `vi.fn()` canvas mock) | request-response | self — only existing canvas-mock test in repo; update string expectation + id | n/a (assertion-string update) |
| `src/components/dashboard/modals/DoctorReport.tsx` (modify) | component (React + Modal/Tailwind) | transform (state → printable DOM) | self — only Modal-based report in repo; insert an `<aside role="note">` between `<header>` and the first `<section>` | n/a (single insertion site) |
| `src/lib/disclaimers.ts` (NEW — optional per RESEARCH §single-source) | lib/domain (string constant module) | transform (constants only) | `src/lib/constants.ts` (single-purpose string/array constant exports: `SUPPS_DEFAULT`, `SYMPTOMS_LIST`, `siteShort`) | exact |
| `src/types/index.ts` (modify) | types | transform | self — adds optional `pkEngineVersion?: number` to `Injection` interface (line 61-67) | n/a (one-field addition) |
| `src/lib/storage.ts` (modify) | persistence (constants + migration helper) | transform | self — bump `STORAGE_VERSION` from 5 → 6 (Phase 2 set it to 5 at line 31) | n/a (one-number bump + JSDoc) |
| `src/lib/store.ts` (modify) | state (Zustand `persist.migrate`) | event-driven (rehydrate boundary) | self — current `migrate` callback at lines 251-269 (Phase 2 v4→v5 branch is the exact template) | exact (same code shape, new version branch) |
| `src/lib/storage.test.ts` (modify) | test | request-response | self — current `STORAGE_VERSION` assertion at line 11-14 is the template (Phase 3 bumps to 6) | n/a (constant-update) |

**Files explicitly OUT of scope** (despite being mentioned in the orchestrator prompt):

| Mentioned file | Why out of scope |
|----------------|------------------|
| `vitest.config.ts` | Vitest config already lives **inline in `vite.config.ts`** (lines 91-99). No separate `vitest.config.ts` is needed; do not create one — it would double-resolve the include glob. Verified: `package.json` test scripts (`"test:unit": "vitest run"`) work today with the inline config. |
| Phase 2 cross-reference docs (`02-06-SUMMARY.md`, `02-HUMAN-UAT.md`) | Documentation updates, not source files — handled directly per CONTEXT D-09, no pattern analog needed. |

---

## Pattern Assignments

### `src/lib/pharmacology-corpus.ts` (NEW — lib/domain, transform/data-table)

**Analog:** `src/lib/pharmacology.ts` (specifically `TRIAL_DATA` at lines 63-98 and `HALF_LIVES` at lines 7-18 — same file already exports the canonical typed-constant-table shape this corpus must follow).

**Module-header / file-comment pattern** (copy from `src/lib/pharmacology.ts:1-5`):
```typescript
/**
 * Pharmacokinetic constants — peer-reviewed half-lives and FDA-label
 * titration schedules. Ported verbatim from v1 (leanshot.html:1318-1359).
 */
import type { MedicationId } from '@/types';
```
Phase 3 mirrors this header style — multi-line `/** ... */`, leading import of `@/types`. The corpus comment additionally cites the bridge math `Cavg[ng/mL] = (Aₛₛ_avg × 10⁶) / Vd[mL]` (see RESEARCH §How to bridge).

**Typed-constant-table pattern** (copy from `src/lib/pharmacology.ts:7-18` for `HALF_LIVES`):
```typescript
export const HALF_LIVES: Record<MedicationId, number> = {
  ozempic: 168,
  wegovy: 168,
  // ...
  retatrutide: 144,
};
```
Phase 3's corpus uses an **array of typed interface entries** instead of `Record` (the corpus is keyed by `drugClass`, which is a literal-union sub-type of `MedicationId` mapped via `trialClass()`); the closer shape analog is `TRIAL_DATA` at lines 63-98:

```typescript
export interface TrialPoint {
  w: number;
  pct: number;
}

export const TRIAL_DATA: Record<string, TrialPoint[]> = {
  semaglutide: [
    { w: 4, pct: 2 },
    // ...
  ],
  // ...
};
```
The corpus exports `CorpusEntry` interface + `CORPUS: CorpusEntry[]` — verbatim shape in RESEARCH lines 140-236.

**Import-from-corpus convention** (so consumers stay alias-clean): use `@/lib/pharmacology-corpus` from `MedLevelChart.tsx` (band CV%) and `pharmacology.test.ts` (steady-state assertions). Path alias `@/` is project-wide per `tsconfig.app.json` and `vite.config.ts:36-39`.

---

### `src/lib/pharmacology.test.ts` (NEW — test, request-response)

**Analog:** `src/lib/helpers.test.ts` (pure-fn unit tests, no DOM, no store).

**Imports pattern** (copy from `src/lib/helpers.test.ts:1-15`):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  todayStr,
  lastNDays,
  // ...
} from './helpers';
```
Note **relative imports inside `src/lib/`** (`from './helpers'`, NOT `from '@/lib/helpers'`) — this is the established convention for sibling-file tests in this directory. Verified in `helpers.test.ts:2`, `storage.test.ts:2`, `medLevelWatermarkPlugin.test.ts:2`. Phase 3 corpus test uses `from './pharmacology'` and `from './pharmacology-corpus'`.

**Describe-block + corpus-loop pattern** (copy from `src/lib/helpers.test.ts:31-51`):
```typescript
describe('lastNDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 7 strings in YYYY-MM-DD format', () => {
    const days = lastNDays(7);
    expect(days).toHaveLength(7);
    for (const d of days) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  // ...
});
```
Phase 3 test loops `for (const entry of CORPUS)` and calls `it(\`${entry.drugClass} ...\`, () => { ... })` — same shape as the corpus-driven `REFUSE_CORPUS`/`PASS_CORPUS` pattern in RESEARCH §refusal-list test fixture and the `escapeHtml` block at `helpers.test.ts:203-222`.

**Assertion style** (copy from `src/lib/helpers.test.ts:42-43`):
```typescript
expect(days).toHaveLength(7);
for (const d of days) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
```
Phase 3 uses `expect(avg).toBeGreaterThanOrEqual(entry.lowerBoundMg)` + `expect(avg).toBeLessThanOrEqual(entry.upperBoundMg)` (RESEARCH lines 262-264). `toBeGreaterThanOrEqual` is the established numeric-range idiom in this codebase (also used in `analytics.test.ts`).

---

### `src/lib/insights-refusal.ts` (NEW — lib/domain, transform)

**Analog:** `src/lib/helpers.ts` (pure utility module pattern) co-located with `src/lib/insights.ts` (companion domain module that this file plugs into).

**Module pattern** — single-purpose pure utility module, no React, no store reads:
- Top-of-file `/** ... */` describing the file's purpose (see `src/lib/insights.ts:1-5` for the canonical shape).
- Named-export pure functions (no default export). Examples in the codebase: `src/lib/helpers.ts` exports `todayStr`, `lastNDays`, `cn`, `clamp`, `escapeHtml`, etc.; `src/lib/insights.ts` exports `generateInsights`, `pickFocus`.
- Internal constants `SCREAMING_SNAKE_CASE` (per CLAUDE.md naming conventions — e.g. `STORAGE_KEY` at `storage.ts:26`, `SUPPS_DEFAULT`, `SYMPTOMS_LIST`).

**Imports** — none from `@/types` or `@/lib/store`. Refusal-list helpers are pure string → boolean and array → array. This matches `src/lib/helpers.ts`'s constraint (no app-state coupling).

**Exported function-signature pattern** (copy from `src/lib/helpers.ts` `cn` style):
```typescript
// Exemplar from helpers.ts (signature shape, not exact body):
export function cn(...parts: (string | false | null | undefined)[]): string { /* ... */ }
```
Phase 3 exports `tokenize(s: string): string[]`, `isDoseChangeAdvice(body: string): boolean`, `scrubInsights<T extends { body: string; title: string }>(insights: T[]): T[]` — same pure-fn-with-explicit-return-type style. Full code in RESEARCH lines 340-389.

**Generic-type pattern** for `scrubInsights<T extends ...>`: the closest analog in repo is the generic in `src/lib/storage.ts:88` (`as Record<string, unknown>`) — no perfect match, but `T extends { body: string; title: string }` is idiomatic TS-strict and consistent with `tsconfig.app.json:14`.

---

### `src/lib/insights-refusal.test.ts` (NEW — test, request-response)

**Analog:** `src/lib/helpers.test.ts` — specifically the `escapeHtml` describe block at lines 203-222 (string-in, boolean/string-out, no async, no fake-timers).

**Corpus-loop pattern** (model from RESEARCH lines 399-447, structurally aligned with `helpers.test.ts:203-222`):
```typescript
describe('isDoseChangeAdvice — must REFUSE (true positives)', () => {
  const REFUSE_CORPUS = [
    'You should increase your Ozempic dose to 2mg.',
    // ...15 phrases
  ];
  for (const phrase of REFUSE_CORPUS) {
    it(`refuses: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(true);
    });
  }
});
```
The `for (const x of CORPUS) it(...)` shape is established by `helpers.test.ts:43` (`for (const d of days) expect(...)`). The variant where each corpus row becomes its own `it()` (better failure messages, one assertion per row) matches RESEARCH §refusal-list test fixture lines 417-421.

**Imports** (sibling-relative per the convention noted above):
```typescript
import { describe, expect, it } from 'vitest';
import { isDoseChangeAdvice } from './insights-refusal';
```

---

### `src/lib/insights.ts` (modify — lib/domain, transform)

**Analog:** self. Phase 3 is a minimal additive wrap, not a rewrite.

**Wrapping pattern**: import `scrubInsights` from `./insights-refusal` and apply it just before `return out` at the bottom of `generateInsights`. For `pickFocus`, RESEARCH lines 461-468 prescribe a defense-in-depth guard:

```typescript
// At top of file
import { scrubInsights, isDoseChangeAdvice } from './insights-refusal';

// In generateInsights, replace `return out;` with:
return scrubInsights(out);

// In pickFocus, before returning the computed result, add:
if (isDoseChangeAdvice(result.body) || isDoseChangeAdvice(result.title)) {
  return DEFAULT_FOCUS; // existing "celebrate" default at insights.ts:237-243
}
return result;
```

**Constraint** (from RESEARCH §Project Constraints lines 43-49 + CLAUDE.md ESLint section):
> ESLint flat-config blocks `useStore(generateInsights)` and `useStore(pickFocus)` patterns (`no-restricted-syntax`). Refusal-list test fixtures must call `generateInsights(state)` directly with a constructed `PersistedState`, not via the store.

Tests must construct a `PersistedState` literal (use `initialState` from `storage.ts:57-78` as a base, override fields per test) — never `useStore.getState()`.

---

### `src/components/dashboard/charts/MedLevelChart.tsx` (modify — component, request-response)

**Analog:** self. The current `useMemo` block (lines 15-97) is the only Chart.js config factory in this shape; Phase 3 adds 4 invisible datasets ahead of the existing 2 visible ones.

**Imports pattern** (current — keep + add):
```typescript
import { useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { getChartTokens } from '@/lib/chart-theme';
import { HALF_LIVES, calcMedLevel } from '@/lib/pharmacology';
// ADD per Phase 3:
import { trialClass } from '@/lib/pharmacology';                  // already exported at line 100
import { CV_BY_DRUG_CLASS } from '@/lib/pharmacology-corpus';     // NEW from corpus file
import { useStore } from '@/lib/store';
import { BaseChart } from './BaseChart';
import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';
```
Note: `@/lib/...` alias for cross-directory imports, `./` for siblings. Already enforced by `eslint-plugin-import-x` (alphabetized order — CLAUDE.md ESLint section).

**Existing dataset pattern** (copy from `MedLevelChart.tsx:46-68` — the band datasets sit BEFORE these so the visible lines paint on top):
```typescript
{
  label: 'Past',
  data: past,
  borderColor: t.primary,
  backgroundColor: t.primary + '20',
  fill: true,
  tension: 0.3,
  pointRadius: 0,
  borderWidth: 2.4,
  spanGaps: false,
},
{
  label: 'Projected',
  data: future,
  borderColor: t.rose,
  backgroundColor: t.rose + '20',
  fill: true,
  tension: 0.3,
  pointRadius: 0,
  borderWidth: 2.4,
  borderDash: [5, 5],
  spanGaps: true,
},
```

**Band-dataset additions** (per RESEARCH lines 486-543 — `fill: '+1'` upper points down to lower):
- 4 datasets total, two pairs (past upper/lower + projected upper/lower).
- `borderColor: 'transparent'` so only fill is visible (UI-SPEC line 76: `borderWidth: 0`, `pointRadius: 0`).
- `backgroundColor: t.primary + '20'` (past) and `t.rose + '20'` (projected) — `+'20'` is the **existing hex-alpha idiom** at lines 50 and 61 (`'20'` = 0x20/255 ≈ 12.5% alpha, matching UI-SPEC α=0.12).
- Gate with `showBand = injections.length > 0` per RESEARCH line 494 (empty-state handling).

**Plugin-id update** (D-08):
- Current `MedLevelChart.tsx:79`: `medLevelWatermark: { color: ..., opacity: ... }` (object-key matches plugin id `'medLevelWatermark'` at `medLevelWatermarkPlugin.ts:31`).
- Phase 3: `'medLevelWatermark-v2': { ... }` — quoted key because of the hyphen.

**Legend/tooltip filters** (per UI-SPEC lines 130-131):
```typescript
plugins: {
  legend: {
    labels: {
      color: t.tick,
      filter: (item) => item.text === 'Past' || item.text === 'Projected',
    },
  },
  tooltip: {
    filter: (item) => item.datasetIndex < 2, // exclude bound datasets
  },
  // ...
},
```
Note: with band datasets inserted FIRST in the array per RESEARCH line 500 ("upper FIRST so '+1' on upper points to lower"), `datasetIndex < 2` would EXCLUDE the visible lines. The planner must reconcile: either (a) put visible lines first and bands after (Chart.js still fills correctly because `'+1'` is index-relative), or (b) use `datasetIndex >= 4` for the visible-line filter. RESEARCH lines 502-547 put bands first, then `Past`/`Projected` last — UI-SPEC's tooltip filter (`< 2`) is then wrong as written. **Planner must pick one ordering and adjust both filter and dataset order consistently.**

**Y-axis title update** (UI-SPEC line 62):
- Current `MedLevelChart.tsx:88`: `title: { display: true, text: \`${u.doseUnit} in system\`, color: t.tick }`.
- Phase 3: `title: { display: true, text: 'Estimate · arbitrary units', color: t.tick }` — middle dot is U+00B7 per UI-SPEC line 114.

**aria-label update** (UI-SPEC line 132):
- Current `MedLevelChart.tsx:99`: `ariaLabel="28-day medication level"`.
- Phase 3: `ariaLabel="28-day medication level estimate with inter-individual variability band, not a measured serum level"`.

**Per-instance plugin discipline** (preserve per Phase 2 D-13/D-14/D-15 — RESEARCH §Project Constraints): `plugins: [medLevelWatermarkPlugin]` at line 95 stays. **Never** `Chart.register(medLevelWatermarkPlugin)`.

---

### `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` (modify — utility, event-driven)

**Analog:** self. The whole file is 53 lines; Phase 3 changes 4 of them.

**Plugin-id pattern** (copy from line 31 — keep the same shape, bump the value):
```typescript
export const medLevelWatermarkPlugin: Plugin<'line', MedLevelWatermarkOptions> = {
  id: 'medLevelWatermark',  // ← becomes 'medLevelWatermark-v2'
  afterDraw(chart: Chart<'line'>, _args, options: MedLevelWatermarkOptions) {
    // ...
  },
};
```

**Watermark-text constant pattern** (current line 17):
```typescript
const WATERMARK_TEXT = 'Estimate — not medical advice'; // U+2014 EM DASH — SC#3 verbatim
```
Phase 3 (per RESEARCH lines 622-630, two-line wrap recommended):
```typescript
// Per Phase 3 D-08: longer Phase 3 disclaimer. Em-dash U+2014 preserved.
const WATERMARK_LINE_1 = 'estimate, not measured serum level';
const WATERMARK_LINE_2 = '— based on population pharmacokinetics';
```
**Em-dash byte verification**: the line-2 string starts with U+2014, matching Phase 2's automated check (`02-06-PLAN.md` per CONTEXT D-09 and UI-SPEC line 180).

**Render pattern** (copy from current lines 43-51 — `save → translate → rotate → font → fillText → restore`):
```typescript
ctx.save();
ctx.translate(cx, cy);
ctx.rotate(-Math.PI / 4); // 45° counter-clockwise (D-13)
ctx.font = `bold ${Math.max(14, height * 0.08)}px ${fontFamily}`;
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillStyle = `rgba(${color}, ${opacity})`;
ctx.fillText(text, 0, 0);
ctx.restore();
```
Phase 3 modifications (per RESEARCH lines 622-630):
- Font formula: `Math.max(14, height * 0.08)` → `Math.max(11, height * 0.06)`.
- Single `ctx.fillText(text, 0, 0)` → two calls:
  ```typescript
  const lineHeight = Math.max(13, height * 0.07);
  ctx.fillText(WATERMARK_LINE_1, 0, -lineHeight / 2);
  ctx.fillText(WATERMARK_LINE_2, 0,  lineHeight / 2);
  ```

**Defensive guard** (preserve from line 34): `if (!chartArea) return;` — covered by the existing `bails when chartArea is undefined` test at `medLevelWatermarkPlugin.test.ts:61-67`.

---

### `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` (modify)

**Analog:** self. Update two existing assertions; keep the four others as-is.

**Existing assertion to update** (lines 24-26):
```typescript
it('plugin id is "medLevelWatermark" (D-15)', () => {
  expect(medLevelWatermarkPlugin.id).toBe('medLevelWatermark');
});
```
Becomes:
```typescript
it('plugin id is "medLevelWatermark-v2" (Phase 3 D-08)', () => {
  expect(medLevelWatermarkPlugin.id).toBe('medLevelWatermark-v2');
});
```

**Existing fillText assertion to update** (lines 28-36):
```typescript
it('draws the verbatim SC#3 watermark via fillText', () => {
  const { chart, ctx } = makeChart();
  medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
  expect(ctx.fillText).toHaveBeenCalledWith(
    'Estimate — not medical advice', // U+2014 EM DASH
    0,
    0,
  );
});
```
Becomes (two-line render — two `fillText` calls at line offsets, not `(text, 0, 0)`):
```typescript
it('draws the Phase 3 two-line watermark via fillText (D-08)', () => {
  const { chart, ctx } = makeChart();
  medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
  expect(ctx.fillText).toHaveBeenCalledWith(
    'estimate, not measured serum level',
    0,
    expect.any(Number), // -lineHeight/2
  );
  expect(ctx.fillText).toHaveBeenCalledWith(
    '— based on population pharmacokinetics', // U+2014 EM DASH at index 0
    0,
    expect.any(Number), // +lineHeight/2
  );
});
```

**Mock-chart-context pattern** (preserve from lines 4-21 — copy verbatim for any new tests):
```typescript
function makeChart() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  const chart = {
    ctx,
    chartArea: { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 },
  };
  return { chart, ctx };
}
```

---

### `src/components/dashboard/modals/DoctorReport.tsx` (modify — component, transform)

**Analog:** self. The Modal-based report has one obvious insertion site between `<header>` (line 43-48) and the Summary `<section>` (line 50-82).

**Existing-disclaimer pattern** (copy classes from line 197 — same surface language):
```tsx
<p className="text-[11px] text-[var(--color-text-tertiary)] italic pt-4 border-t border-[var(--color-border)]">
  Generated by LeanShot. This is a tracking summary, not medical documentation. Always defer
  to your healthcare provider.
</p>
```

**Phase 3 insertion** (per RESEARCH lines 662-671 and UI-SPEC line 104 verbatim copy):
- Insert between line 48 (`</header>`) and line 50 (`<section className="rounded-2xl ...">`).
- Element: `<aside role="note">` (not `<p>` — semantic difference: aside is a callout, footer is a closing summary).
- Tailwind classes: copy the surface-elevated style from the existing Summary `<section>` at line 50 (`rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4`) and the typography style from line 197 (`text-[12px] italic text-[var(--color-text-secondary)]`).
- Add `print:border-black` per RESEARCH line 665 for print-friendly degradation.

**Verbatim copy** (UI-SPEC line 104 — implementer MUST not paraphrase):
> `Drug-level curve: estimate, not measured serum level — based on population pharmacokinetics. Shows modeled mean with shaded inter-individual variability band (~30%).`

The em-dash is U+2014; the `~` is ASCII U+007E (UI-SPEC §Punctuation rules lines 113-116).

**Single-source-of-truth refactor** (per RESEARCH lines 682-693): if the planner elects to create `src/lib/disclaimers.ts`, import `PK_DISCLAIMER_FULL` (or the two-line constants) from there into both `medLevelWatermarkPlugin.ts` and `DoctorReport.tsx`. Match `src/lib/constants.ts` shape (single-purpose string constant module, named exports, no React).

---

### `src/types/index.ts` (modify — types)

**Analog:** self. The `Injection` interface at lines 61-67 is the only edit site.

**Existing pattern** (lines 61-67):
```typescript
export interface Injection {
  datetime: string; // ISO
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
}
```

**Phase 3 addition** (per CONTEXT D-07 and RESEARCH lines 707-718): add **optional** `pkEngineVersion?: number` as the last field:
```typescript
export interface Injection {
  datetime: string; // ISO
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  /** PK-05 (Phase 3 D-07): pharmacology engine version that produced this record's
   *  expected curve. Optional so legacy literals + in-memory v5-shaped records
   *  typecheck. Storage v5→v6 migrate back-stamps to 1. New writes stamp 1 via addInjection. */
  pkEngineVersion?: number;
}
```
**Critical constraint** (RESEARCH lines 44, 716): MUST be optional (`?`) — `tsconfig.app.json` `strict: true` plus `noUnusedLocals`/`noUnusedParameters` means every existing `Injection` literal (seeds, test fixtures, `addInjection({ ... })` call sites) would fail typecheck if the field were required.

**JSDoc comment style**: matches existing fields in this file (`// ISO`, `// YYYY-MM-DD`, `// id from SYMPTOMS_LIST`) — brief inline comments. Phase 3's three-line block is justified because the field documents a cross-version migration contract; this style matches the multi-line block on `STORAGE_VERSION` at `storage.ts:28-30`.

---

### `src/lib/storage.ts` (modify — persistence, transform)

**Analog:** self. One-line edit at line 31.

**Existing pattern** (lines 28-31):
```typescript
// D-10: bumped 4 → 5 so the persist `migrate` callback fires for existing v4 users
// and explicitly defaults `acknowledgedDisclaimer` to undefined. Do NOT rename
// STORAGE_KEY — that is the localStorage key, not the schema version.
export const STORAGE_VERSION = 5;
```

**Phase 3 replacement** (per CONTEXT D-07 and RESEARCH lines 723-731):
```typescript
// D-07 (Phase 3): bumped 5 → 6 so persist `migrate` back-stamps existing
// injections with pkEngineVersion: 1 (PK-05). Do NOT rename STORAGE_KEY.
export const STORAGE_VERSION = 6;
```
Comment-block style verbatim from current line 28-30 (multi-line `//` with decision-id prefix + "Do NOT rename" cautionary line preserved).

**No new export, no shape change to `PersistedState` or `initialState`** — the `pkEngineVersion` field lives inside `Injection[]`, which `PersistedState.injections: Injection[]` already references.

---

### `src/lib/store.ts` (modify — state, event-driven on persist rehydrate)

**Analog:** self. The Phase 2 v4→v5 branch at lines 262-267 is the exact template to copy.

**Existing migrate-branch pattern** (copy shape from lines 251-269):
```typescript
migrate: (persistedState, version) => {
  // First boot of v2 with v3 data sitting around.
  if (!persistedState && version < STORAGE_VERSION) {
    const v3 = migrateFromV3();
    if (v3) return { ...initialState, ...v3 };
    return { ...initialState };
  }
  // Phase 2 D-10/D-11/RESEARCH Pitfall 5: existing v4 users must see the
  // dashboard fallback modal on next load. Default acknowledgedDisclaimer
  // to undefined here, NEVER 'v1' — defaulting to 'v1' would silently
  // grandfather every existing user past the disclaimer.
  if (persistedState && version === 4) {
    return {
      ...(persistedState as PersistedState),
      acknowledgedDisclaimer: undefined,
    } as PersistedState;
  }
  return persistedState as PersistedState;
},
```

**Phase 3 v5→v6 addition** (per RESEARCH lines 745-770 — insert a new branch with the SAME shape between the existing v4 branch and the final `return`):
```typescript
// Phase 3 D-07 / PK-05: back-stamp existing injections with pkEngineVersion: 1
// so a future v1.1 2-compartment engine can recompute curves retroactively
// without ambiguity about which model produced each stored record.
if (persistedState && version === 5) {
  const s = persistedState as PersistedState;
  return {
    ...s,
    injections: s.injections.map((inj) =>
      inj.pkEngineVersion ? inj : { ...inj, pkEngineVersion: 1 }
    ),
  } as PersistedState;
}
```
**Important:** the v4 branch at line 262 STAYS — a v4 user upgrading to v6 needs both transformations applied (zustand `persist` calls `migrate` once with `version = oldVersion`, so the planner should chain the branches: `version === 4` falls through after the v4 transform to also apply the v5→v6 transform, OR the branches can be rewritten as additive accumulators on `s`). RESEARCH §storage.ts v5 → v6 lines 745-770 doesn't address this — **planner discretion** (recommendation: change `if (version === 4)` to `if (version <= 4)` for the disclaimer branch, then a separate `if (version <= 5)` for the injection back-stamp, both falling through to the same `return`).

**`addInjection` action pattern** (`src/lib/store.ts:125-138` — stamps `pkEngineVersion: 1` on new writes):
```typescript
addInjection: (inj) =>
  set((s) => {
    const injections = [inj, ...s.injections];
    // ...
  }),
```
Phase 3 addition (per CONTEXT D-07 "New injections stamp `1` on write"):
```typescript
addInjection: (inj) =>
  set((s) => {
    // PK-05: stamp the engine version that produced the expected curve at write time.
    const stamped: Injection = { ...inj, pkEngineVersion: inj.pkEngineVersion ?? 1 };
    const injections = [stamped, ...s.injections];
    // ... rest unchanged
  }),
```

---

### `src/lib/storage.test.ts` (modify — test)

**Analog:** self at lines 11-15 (the only `STORAGE_VERSION` assertion in the repo).

**Existing pattern** (lines 11-15):
```typescript
describe('STORAGE_VERSION', () => {
  it('is bumped to 5 for D-10 versioned disclaimer field', () => {
    expect(STORAGE_VERSION).toBe(5);
  });
});
```

**Phase 3 replacement**:
```typescript
describe('STORAGE_VERSION', () => {
  it('is bumped to 6 for D-07 pkEngineVersion field (Phase 3)', () => {
    expect(STORAGE_VERSION).toBe(6);
  });
});
```

**Add new migration-test pattern** for v5→v6 (model the structure from the existing `migrateFromV3` describe block at lines 17-76 — same `storageMock` + `vi.spyOn(Storage.prototype, ...)` pattern):
```typescript
describe('persist migrate v5 → v6 (PK-05)', () => {
  // ... use useStore.setState or direct migrate call to assert back-stamping
  // Pattern: build a v5-shaped Injection[], call the migrate handler, assert
  // every injection has pkEngineVersion: 1 in the result.
});
```
The exact mock harness from lines 18-33 is reusable verbatim.

---

## Shared Patterns

### Path-alias imports vs sibling-relative

**Source:** `tsconfig.app.json` (paths block) + `vite.config.ts:36-39`.

**Convention** (observed across the codebase):
- **Cross-directory imports**: `@/...` (e.g. `MedLevelChart.tsx:2-7` — `from '@/hooks/useTheme'`, `from '@/lib/store'`).
- **Same-directory siblings**: `./` (e.g. `MedLevelChart.tsx:6` — `from './BaseChart'`, `from './medLevelWatermarkPlugin'`; `helpers.test.ts:2` — `from './helpers'`; `storage.test.ts:2` — `from './storage'`; `medLevelWatermarkPlugin.test.ts:2` — `from './medLevelWatermarkPlugin'`).

**Apply to:** every new file and every modified import. Phase 3 tests in `src/lib/` MUST use `./pharmacology`, `./pharmacology-corpus`, `./insights-refusal` (not `@/lib/...`) per the established sibling-relative pattern.

### Vitest test-file conventions

**Source:** `vite.config.ts:91-99` (inline Vitest config with `include: ['src/**/*.test.{ts,tsx}']`); `src/test-setup.ts` (loaded automatically per `setupFiles`).

**Apply to:** all new `.test.ts` files in Phase 3.

**Patterns (from `src/lib/helpers.test.ts`, `src/lib/storage.test.ts`, `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts`):**
- Filename: `<module>.test.ts` colocated next to the SUT (e.g., `pharmacology.test.ts` next to `pharmacology.ts`).
- Imports: `import { describe, expect, it } from 'vitest';` (add `beforeEach`, `afterEach`, `vi` as needed; see `helpers.test.ts:1` and `storage.test.ts:1`).
- Top-level `describe(<module-or-function-name>, () => { ... })`; nested `describe` for sub-cases (`helpers.test.ts:17-29`).
- Each `it` description is a complete English sentence describing the contract being asserted (`helpers.test.ts:26` — "returns YYYY-MM-DD for the current date").
- Numeric-range assertions: `toBeGreaterThanOrEqual` / `toBeLessThanOrEqual` (used in `analytics.test.ts`).
- Storage/localStorage mocking: `vi.spyOn(Storage.prototype, 'getItem' | 'setItem' | 'removeItem').mockImplementation(...)` (template at `storage.test.ts:21-28`).
- Time mocking: `vi.useFakeTimers()` + `vi.setSystemTime(new Date('YYYY-MM-DDTHH:MM:SSZ'))` in `beforeEach`, `vi.useRealTimers()` in `afterEach` (template at `helpers.test.ts:18-24`).
- Canvas/Chart.js mocking: hand-rolled `vi.fn()` shim returning a `CanvasRenderingContext2D`-typed object (template at `medLevelWatermarkPlugin.test.ts:4-21`).
- NO React Testing Library imports unless the SUT is a component (Phase 3 unit-test scope is pure-fn — no RTL).

### ESLint `no-restricted-syntax` constraint

**Source:** `eslint.config.js` + CLAUDE.md ESLint section: "rules that block `useStore(generateInsights|pickFocus)` and `useStore((s) => generateInsights|pickFocus(s)…)` to prevent unstable-snapshot render loops".

**Apply to:** `insights.test.ts` and `insights-refusal.test.ts` — call `generateInsights(state)` directly with a constructed `PersistedState` literal, NEVER via the store. Base fixture on `initialState` from `storage.ts:57-78`.

### Per-instance Chart.js plugin discipline

**Source:** `MedLevelChart.tsx:93-95` (`plugins: [medLevelWatermarkPlugin]` inside the ChartConfiguration — NOT `Chart.register(...)`); `medLevelWatermarkPlugin.ts:5-8` (file header documenting the constraint).

**Apply to:** Phase 3's `MedLevelChart.tsx` changes. The watermark plugin stays per-instance; the band uses Chart.js's built-in `Filler` plugin (auto-registered via `...registerables` at `BaseChart.tsx`'s `Chart.register(...registerables)` call — RESEARCH line 585), no additional plugin needed.

### Verbatim copy + punctuation discipline

**Source:** UI-SPEC §Copywriting Contract (lines 96-121) — every user-visible string is locked.

**Apply to:** `medLevelWatermarkPlugin.ts` (watermark text), `MedLevelChart.tsx` (Y-axis title, aria-label, band-caption DOM string), `DoctorReport.tsx` (PDF footer paragraph).

**Character-precision constraints (UI-SPEC lines 113-116):**
- Em-dash `—` is U+2014 (NOT U+002D `-` or U+2013 `–`).
- Middle dot `·` in `Estimate · arbitrary units` and `Estimate · ~30% inter-individual variation` is U+00B7 (NOT `•` U+2022 or any interpunct variant).
- Tilde `~` is ASCII U+007E.
- Lowercase initial `estimate` in the watermark is intentional.

Phase 2 already wired an em-dash byte-verification check (CONTEXT D-09, UI-SPEC line 180) — Phase 3's longer string also contains U+2014, same check passes.

### Surface tokens (no new colors)

**Source:** `src/index.css` `@theme` block (live CSS variables); `src/lib/chart-theme.ts:27-45` (`getChartTokens(theme)` returns live values).

**Apply to:** all Phase 3 visual additions.
- Band fill: `t.primary` (past) + `t.rose` (projected), at α=0.12 via the existing `+'20'` hex-alpha idiom (`MedLevelChart.tsx:50, 61`).
- DoctorReport disclaimer: existing `--color-surface-elevated`, `--color-border`, `--color-text-secondary`, `--color-text-tertiary` tokens (already used at `DoctorReport.tsx:50` and `:197`).
- No new tokens introduced (UI-SPEC §Color line 67 — "no new color tokens").

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All Phase 3 files have a close in-repo analog. No greenfield patterns. |

---

## Metadata

**Analog search scope:**
- `src/lib/` (all 14 files inspected for module conventions: `pharmacology.ts`, `insights.ts`, `helpers.ts`, `storage.ts`, `store.ts`, `constants.ts`, `chart-theme.ts`, plus existing tests `helpers.test.ts`, `storage.test.ts`, `analytics.test.ts`, `sentry.test.ts`)
- `src/components/dashboard/charts/` (4 files: `BaseChart.tsx`, `MedLevelChart.tsx`, `medLevelWatermarkPlugin.ts`, `medLevelWatermarkPlugin.test.ts`)
- `src/components/dashboard/modals/` (`DoctorReport.tsx`, `PhotoCompareModal.tsx`)
- `src/types/index.ts`
- Root configs: `vite.config.ts`, `package.json`, `tsconfig.app.json` (mention only)

**Files scanned (read in full or targeted ranges):** 13.

**Pattern extraction date:** 2026-05-11.

**Confidence summary:**
- HIGH on: Vitest conventions (3 working analog test files), Chart.js plugin discipline (full plugin file + test in repo), storage/migrate pattern (Phase 2's v4→v5 branch is the exact template), corpus/constant-table shape (`TRIAL_DATA` and `HALF_LIVES` are textbook analogs).
- MEDIUM on: dataset-ordering reconciliation between RESEARCH's "bands first" recommendation and UI-SPEC's `datasetIndex < 2` tooltip filter — planner must pick one ordering and adjust both filter and dataset order consistently (flagged inline above).
- N/A: no new third-party dependency, no new framework, no new file-type convention introduced.
