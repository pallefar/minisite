---
phase: 03-pharmacology-insights-hardening
reviewed: 2026-05-11T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/lib/disclaimers.ts
  - src/lib/pharmacology-corpus.ts
  - src/lib/pharmacology.test.ts
  - src/lib/insights-refusal.ts
  - src/lib/insights-refusal.test.ts
  - src/lib/insights.ts
  - src/components/dashboard/charts/medLevelWatermarkPlugin.ts
  - src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts
  - src/components/dashboard/charts/MedLevelChart.tsx
  - src/components/dashboard/modals/DoctorReport.test.tsx
  - src/components/dashboard/modals/DoctorReport.tsx
  - src/types/index.ts
  - src/lib/storage.ts
  - src/lib/store.ts
  - src/lib/storage.test.ts
findings:
  critical: 3
  warning: 8
  info: 4
  total: 15
critical_resolved: 3
critical_resolved_commits:
  - 8b682df  # CR-01 fix: walk all stem occurrences
  - 717ed3f  # CR-01 test: second-clause regression
  - ac50823  # CR-02 fix: extend STEM_PATTERN
  - ca55368  # CR-02 test: 7-row clinical-verb corpus
  - 4119dc6  # CR-03 fix: chain v3 bootstrap through v4+v5
  - f70c135  # CR-03 test: v3→v6 pkEngineVersion stamping
status: critical_resolved_warnings_open
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-11
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 3 (pharmacology + insights hardening) lands the PK corpus, refusal list, watermark plugin, DoctorReport disclaimer aside, and v5→v6 storage migration. PK math in `pharmacology-corpus.ts` is correctly derived from `Aₛₛ_avg = Dose × t½ / (τ × ln 2)` and tested against ±15% bounds via Riemann sampling — that part is solid.

However, the **patient-safety refusal-list in `insights-refusal.ts` has a real false-negative path** that can let dose-change copy reach the UI under realistic conditions (CR-01). The refusal list is also missing several clinical dose-change verbs (`discontinue`, `pause`, `hold`, `resume`, `withhold`) that D-05 calls out as "all dose-change phrasings" — these slip past unblocked (CR-02). The v3→v6 migration chain skips the new pkEngineVersion back-stamp transform when the bootstrap path is taken, leaving legacy v3 migrants with unstamped injection records (CR-03).

A spread of WARNINGs covers ordering bugs (`workouts[0]`, `mood.slice(-7)`, `injections.slice(0,12)` all assume insertion-order matches date-order — wrong after back-fill), an unchecked `useStore((s) => s.user!)` non-null assertion that the test file itself documents as a teardown crash vector, double-rehydrate in `hydrate()`, and a few minor type/coverage gaps.

## Critical Issues

### CR-01: `isDoseChangeAdvice` `findIndex` always returns the FIRST stem occurrence, so dose-change phrases AFTER an earlier benign use of the same verb are silently allowed

**File:** `src/lib/insights-refusal.ts:94`
**Issue:** Inside the `while ((match = rx.exec(body)) !== null)` loop, the code computes the stem from `match[0]` and then locates it in `tokens` with `tokens.findIndex((t) => t.startsWith(stem))`. `findIndex` returns the FIRST match, not the position of the current `match.index`. When the same stem appears more than once in `body`, every iteration looks at the window around the first occurrence and the later occurrences are never evaluated for med-noun proximity.

Adversarial input (not covered by `insights-refusal.test.ts`):

```
"Increase your protein and increase your Ozempic dose tomorrow."
```

- regex match #1: "Increase" → stem `increas` → findIndex → 0 → window `["increase","your","protein","and","increase","your"]` → no med-noun → continue
- regex match #2: "increase" → stem `increas` → findIndex → **still 0** → same window → no med-noun → continue
- loop exits → `isDoseChangeAdvice` returns **false**

The "increase your Ozempic dose" half is therefore allowed to render. This is the patient-safety floor (D-05, ROADMAP SC#3) leaking. `scrubInsights` and the `pickFocus` `guard()` both depend on this function and are bypassed identically.

**Fix:** Track each match's character offset and convert it to a token index, instead of looking up by stem:

```ts
export function isDoseChangeAdvice(body: string): boolean {
  const rx = new RegExp(STEM_PATTERN.source, STEM_PATTERN.flags);
  // Tokenize WITH positions so we can map a regex match.index → token index.
  const tokens: { text: string; start: number }[] = [];
  const tokRx = /[\w-]+/g;
  let m: RegExpExecArray | null;
  while ((m = tokRx.exec(body.toLowerCase())) !== null) {
    tokens.push({ text: m[0], start: m.index });
  }
  let match: RegExpExecArray | null;
  while ((match = rx.exec(body)) !== null) {
    const idx = tokens.findIndex((t) => t.start === match!.index);
    if (idx === -1) continue;
    const lo = Math.max(0, idx - 5);
    const hi = Math.min(tokens.length, idx + 6);
    for (let i = lo; i < hi; i++) {
      if (MED_NOUNS.has(tokens[i]!.text)) return true;
    }
  }
  return false;
}
```

Add the adversarial string to `REFUSE_CORPUS` in `insights-refusal.test.ts` so the regression is locked in.

### CR-02: Refusal-list MED_NOUNS / STEM coverage misses common clinical dose-change verbs — `discontinue`, `hold`, `pause`, `resume`, `withhold` all pass through

**File:** `src/lib/insights-refusal.ts:33-68`
**Issue:** D-05 / ROADMAP SC#3 require the refusal list to "block all dose-change phrasings." The current `STEM_PATTERN` only covers `increas|decreas|rais|lower|doubl|halv|skip|stop|start|taper|ramp|escalat|de-escalat|bump|more|less`. Clinically equivalent verbs slip through:

- "Discontinue your Ozempic." → no stem hit → **allowed**
- "Hold your next shot." → no stem hit → **allowed**
- "Pause your dose this week." → no stem hit → **allowed**
- "Resume your weekly injection." → no stem hit → **allowed**
- "Withhold your dose pending labs." → no stem hit → **allowed**
- "Add another mg." → no stem hit → **allowed**
- "Take another shot of your dose." → no stem hit (`take` is not a stem) → **allowed**

Each of these is the exact kind of phrasing a rule branch or a future AI-generated insight could surface, and each is a direct dose-change instruction.

**Fix:** Extend the stem set and add the verbs to the test corpus:

```ts
const STEM_PATTERN =
  /\b(increas|decreas|rais|lower|doubl|halv|skip|stop|start|taper|ramp|escalat|de[-\s]?escalat|bump|more|less|discontinu|paus|hold|resum|withhold|add|cut|reduc|inject)(e|es|ed|ing|s|d)?\b/gi;
```

And add at least these REFUSE rows to `insights-refusal.test.ts`:

```ts
'Discontinue your Ozempic this week.',
'Hold your next shot until labs return.',
'Pause your weekly dose.',
'Resume your Wegovy injection on Monday.',
'Withhold your dose pending labs.',
'Add another mg to your Saturday shot.',
'Cut your dose to 5mg.',
'Reduce your tirzepatide by half a step.',
```

Be careful — `hold`, `add`, `cut`, `paus` are all common in benign coaching copy ("hold a plank", "add vegetables", "cut sugar", "pause before bed"). The ±5-token med-noun context guard should suppress those, but add PASS-corpus rows for each to lock that in.

### CR-03: `migrateState` v3-bootstrap path skips the v5→v6 pk-back-stamp transform, leaving legacy v3 migrants with unstamped injections

**File:** `src/lib/store.ts:123-129`
**Issue:** The bootstrap branch returns early without flowing through the `version <= 4` and `version <= 5` transforms:

```ts
if (!persistedState && version < STORAGE_VERSION) {
  const v3 = migrateFromV3();
  if (v3) return { ...initialState, ...v3 };
  return { ...initialState };
}
```

`migrateFromV3` builds an `Injection[]` from v3's blob without setting `pkEngineVersion`. So a v3-direct-to-v6 user lands at v6 with `pkEngineVersion: undefined` on every legacy injection — which is exactly the state D-07 / PK-05 says we are eliminating (the storage version was bumped specifically to back-stamp these).

Adjacent path — `hydrate()` in `store.ts:312-328` — has the same problem: it calls `migrateFromV3()` and `setState({ ...s, ...v3 })`, never stamping `pkEngineVersion`.

**Fix:** Funnel the bootstrap output through the same chained transforms:

```ts
export function migrateState(persistedState: unknown, version: number): PersistedState {
  let state: PersistedState;
  if (!persistedState && version < STORAGE_VERSION) {
    const v3 = migrateFromV3();
    state = v3 ? { ...initialState, ...v3 } : { ...initialState };
  } else {
    state = persistedState as PersistedState;
  }
  if (state && version <= 4) {
    state = { ...state, acknowledgedDisclaimer: undefined };
  }
  if (state && version <= 5) {
    state = {
      ...state,
      injections: (state.injections ?? []).map((inj) => ({
        ...inj,
        pkEngineVersion: inj.pkEngineVersion ?? 1,
      })),
    };
  }
  return state;
}
```

Mirror the same back-stamp in `hydrate()` after the `migrateFromV3()` setState. Add a `storage.test.ts` case that drives `migrateState(undefined, 3)` against a mocked v3 blob and asserts `pkEngineVersion === 1` on the result.

## Warnings

### WR-01: `insights.ts` uses `s.workouts[0]` / `s.injections[0]` / `s.mood.slice(-7)` assuming insertion-order matches date-order — wrong after back-fill

**File:** `src/lib/insights.ts:107,142,194` and `src/components/dashboard/modals/DoctorReport.tsx:21-22`
**Issue:** Multiple call sites treat array position as a date proxy:

- `insights.ts:107` `const lastWO = s.workouts[0]` — `addWorkout` prepends, so `[0]` is the most-recently-LOGGED workout. A user who back-fills yesterday's session today will show "0 days since" instead of the actual most-recent date.
- `insights.ts:142` `const recentMood = s.mood.slice(-7)` — `upsertMood` does NOT sort. Last 7 by **insertion order**, not by `m.date`.
- `insights.ts:194` `const lastInj = s.injections[0]` — same prepend semantics. Back-filling an older injection puts it at position 0 and breaks the "Today is shot day" check (`daysSinceInj >= 6`).
- `DoctorReport.tsx:21` `const recentInj = injections.slice(0, 12)` — "Recent injections" can contain a back-filled 3-week-old log instead of the actual last 12 by date.

**Fix:** Sort by date before slicing, e.g. `const lastWO = [...s.workouts].sort((a,b) => b.date.localeCompare(a.date))[0];` (and equivalent for mood/injections). Or fix at write-time in the store actions (`addWorkout`, `addInjection`, `upsertMood`) by sorting after insert — the way `upsertWeight` already does at `store.ts:204`.

### WR-02: `useStore((s) => s.user!)` non-null assertion is a documented crash vector

**File:** `src/components/dashboard/modals/DoctorReport.tsx:12`, `src/components/dashboard/charts/MedLevelChart.tsx:13`
**Issue:** `s.user!` lies to TypeScript. The DoctorReport test file itself documents a runtime crash at teardown (`DoctorReport.test.tsx:48-52` comments: "framer-motion's AnimatePresence exit transition still reads `u.units` from the store during teardown; resetting user→null first triggers a 'Cannot read properties of null' unhandled exception"). The same pattern is used in `MedLevelChart.tsx:13`. Any code path that sets `user: null` (e.g. `resetAll()` in `store.ts:165`) while the modal/chart is mounted produces a `TypeError` instead of a clean unmount.

**Fix:** Either early-return inside the component:

```tsx
const u = useStore((s) => s.user);
if (!u) return null;
```

…or render these components only when `user != null` at the caller (App.tsx-level guard). The test-file workaround (`cleanup()` before `setState(initialState)`) is treating the symptom, not the cause.

### WR-03: `hydrate()` calls `useStore.persist.rehydrate()` twice on the v3-bootstrap path

**File:** `src/lib/store.ts:312-328`
**Issue:**

```ts
useStore.setState((s) => ({ ...s, ...v3 }));
useStore.persist.rehydrate();          // first call (synchronous, no await)
...
return useStore.persist.rehydrate();    // second call (returned)
```

When v3 data exists, `rehydrate()` is invoked twice. The first call discards its return value, the second is the one main.tsx awaits. Best case this is wasted work; worst case the in-flight rehydrate from call #1 races with the post-setState write and the second rehydrate clobbers the v3-merged state with whatever was already in `leanshot_v4` (potentially empty / initial).

**Fix:** Drop the first `useStore.persist.rehydrate()` call — the setState already updates in-memory state, and the trailing `return useStore.persist.rehydrate()` is sufficient to settle the persist middleware:

```ts
if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem('leanshot_v3')) {
  const v3 = migrateFromV3();
  if (v3) {
    useStore.setState((s) => ({ ...s, ...v3 }));
  }
}
return useStore.persist.rehydrate() as Promise<void>;
```

### WR-04: `migrateState` blindly casts `persistedState as PersistedState` without shape-checking — only `injections` is guarded

**File:** `src/lib/store.ts:130`
**Issue:** A malformed v5 blob with e.g. `weights: null` or `supplements: "garbage"` flows through unchanged. The only field defensively-coalesced is `injections ?? []` (line 139). Every other field is exposed to whatever shape the persisted JSON had.

**Fix:** Either narrow with a runtime type-guard, or `{...initialState, ...(persistedState as Partial<PersistedState>)}` so missing/null fields fall back to `initialState` defaults. Apply the same `(x ?? default)` pattern uniformly inside the v <= 5 transform.

### WR-05: PK corpus test uses left-endpoint Riemann sum without proving convergence is inside the ±15% envelope

**File:** `src/lib/pharmacology.test.ts:24-26`
**Issue:** The test samples 24 evenly-spaced points across `[now, now+τ)` and averages them. For an exponentially-decaying signal this is biased toward the high end of the interval (the dose is fresh at `t=0`). With τ/24 quantization the error is small (~3% for the worst-case 13h half-life vs 24h interval), so it fits inside the 15% envelope — but the test does not document that headroom. A future engine refinement that legitimately moves the mean by ~10% (still inside the published variance) could flip the test red because the quantization bias is hidden inside the assertion.

**Fix:** Either (a) use the trapezoidal rule (`(samples[0]+samples[N])/2 + Σ samples[1..N-1]`) so the integrand is symmetric, or (b) bump sample count to 168 so the τ/N error drops to <1%, or (c) include both `t=0` and `t=τ` in the sample set and explicitly note in a comment that the test budget for quantization+model variance jointly is 15%.

### WR-06: `STEM_PATTERN` global-regex stem strip drops `e` from `(s|ed|ing|es|d)$` — produces a stem-mismatch on legitimate suffix forms

**File:** `src/lib/insights-refusal.ts:93`
**Issue:** The optional suffix in STEM_PATTERN is `(e|es|ed|ing|s|d)?` (includes `e`), but the stem-strip regex applied to `matchedTokens[0]` is `/(s|ed|ing|es|d)$/` (does NOT include `e`). For "halve" / "double" / "raise" / "lower" / "escalate" / "de-escalate", the regex match includes the trailing `e`, but stem-strip leaves it in — stem becomes `halve`, `double`, etc. `tokens.findIndex(t => t.startsWith(stem))` still finds the token because the token is identical, so the bug doesn't surface today. It IS a latent foot-gun if someone refactors the strip regex or adds plural-stems later, and it interacts with CR-01.

**Fix:** Make the strip set match the regex suffix set exactly:

```ts
const stem = matchedTokens[0]!.replace(/(es|ed|ing|s|d|e)$/, '');
```

…and prefer longest suffixes first to avoid `es` being mis-stripped as `s` then `e`.

### WR-07: Weight insight crashes-on-empty path is masked by truthiness chain, but `s.weights[0]!` / `[length-1]!` use bang-asserts after a `>= 4` length check that does not narrow types

**File:** `src/lib/insights.ts:30-31`
**Issue:** `if (s.weights.length >= 4)` followed by `s.weights[0]!` and `s.weights[s.weights.length - 1]!`. TS does not narrow array-index access from a `.length` check, so the `!` is the only thing keeping `strict` happy. Today this is safe because the length predicate dominates, but a future edit to the predicate (`>= 1`, drop the check, etc.) silently retains the `!` and dereferences `undefined`.

**Fix:** Bind the values, then guard:

```ts
const first = s.weights[0];
const last = s.weights[s.weights.length - 1];
if (!first || !last) return;
```

Same pattern at insights.ts:108-110 (`const lastWO = s.workouts[0]` followed by `daysSinceWO = lastWO ? ... : 999` — the ternary saves it, but it is an inconsistent style with the bang-asserts elsewhere).

### WR-08: DoctorReport modal forEach uses `(s) => sxCounts[s.symptom] = ...` — shadowing the outer prop accessor

**File:** `src/components/dashboard/modals/DoctorReport.tsx:24`
**Issue:** `symptoms.forEach((s) => (sxCounts[s.symptom] = (sxCounts[s.symptom] ?? 0) + 1));` — the parameter `s` shadows the typical `s` used as `store-state`. Cosmetic in this file but worth flagging because in other dashboard tabs the convention is `s = state`. Easy footgun for the next reader. Also note `recentSx.map((s, i) =>` and `weights.slice(-15).reverse().map((w) =>` further down — different single-letter conventions inside the same file.

**Fix:** Rename loop variables to `sx` to match `recent: SymptomLog[]` naming used in `insights.ts`:

```ts
symptoms.forEach((sx) => (sxCounts[sx.symptom] = (sxCounts[sx.symptom] ?? 0) + 1));
```

## Info

### IN-01: `PK_DISCLAIMER_FULL` is exported but never imported anywhere in the tree

**File:** `src/lib/disclaimers.ts:19`
**Issue:** `grep -rn PK_DISCLAIMER_FULL src/` returns only the declaration. Dead export — likely vestigial from an earlier draft where a single-line variant was used somewhere.
**Fix:** Remove the constant, or document the intended consumer in the JSDoc above it.

### IN-02: `medLevelWatermarkPlugin` `text` option overrides line 1 only — undocumented at the option site

**File:** `src/components/dashboard/charts/medLevelWatermarkPlugin.ts:30-32`
**Issue:** The JSDoc on the `text` field explains that line 2 is intentionally not overridable, but the implementation at line 59 silently falls back to `PK_DISCLAIMER_LINE_1` when `options.text` is unset. A future caller passing `{ text: 'Demo' }` will get "Demo" on line 1 and the real line 2 underneath, which reads oddly. Either make the override take a `[string, string]` tuple, or rename the field to `line1Text` for clarity.
**Fix:** Rename `text` → `line1Text` in the options interface and on line 59.

### IN-03: Magic-number font multiplier `0.06` in watermark plugin is justified in a long comment but not extracted

**File:** `src/components/dashboard/charts/medLevelWatermarkPlugin.ts:53-54`
**Issue:** Multipliers `0.06` and `0.07` (line height) live inline with a verbose comment about UI-SPEC values. If UI-SPEC moves, the next change will touch the comment + the constant — easy to miss one.
**Fix:** Extract to named constants at the top of the file:

```ts
const FONT_SIZE_RATIO = 0.06; // UI-SPEC §watermark, two-line variant
const LINE_HEIGHT_RATIO = 0.07;
```

### IN-04: `CV_BY_DRUG_CLASS` is typed `Record<string, number>` rather than the narrower `Record<CorpusEntry['drugClass'], number>`

**File:** `src/lib/pharmacology-corpus.ts:132`
**Issue:** The keys are derived from `CORPUS.map((c) => [c.drugClass, ...])` which is a known string-literal union, but the resulting type is widened to `Record<string, number>`. Consumers (`MedLevelChart.tsx:44`) therefore index with an arbitrary string and fall back to `?? 0.3`. Narrowing the type would surface missing classes at compile time.
**Fix:**

```ts
export const CV_BY_DRUG_CLASS: Record<CorpusEntry['drugClass'], number> =
  Object.fromEntries(CORPUS.map((c) => [c.drugClass, c.cvPercent / 100])) as Record<
    CorpusEntry['drugClass'],
    number
  >;
```

---

_Reviewed: 2026-05-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
