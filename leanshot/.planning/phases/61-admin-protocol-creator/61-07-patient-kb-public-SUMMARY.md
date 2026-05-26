---
phase: 61-admin-protocol-creator
plan: "07"
subsystem: protocols-consumer
tags: [protocol-consumer, kb-shortcode, medication-tab, body-tab, public-route]
dependency_graph:
  requires:
    - "61-01: DB tables + RLS (patient_protocol_assignment, protocols, protocol_steps)"
    - "61-02: get_protocol_by_slug RPC"
  provides:
    - "useActiveProtocolAssignment hook"
    - "parseProtocolShortcodes + ProtocolSummaryCard (KB inline card)"
    - "PublicProtocolPage (/protocols/<slug>)"
    - "KnowledgeArticleDetailPage [protocol:<uuid>] shortcode wiring"
  affects:
    - "src/components/dashboard/tabs/MedicationTab.tsx (Expected/Logged deviation row)"
    - "src/components/dashboard/tabs/BodyTab.tsx (Protocol adherence card)"
    - "src/App.tsx (selectView /protocols/* branch)"
    - "src/components/knowledge/KnowledgeArticleDetailPage.tsx (segment-aware rendering)"
tech_stack:
  added:
    - "src/types/protocols.ts (Protocol, ProtocolStep, PatientProtocolAssignment types)"
    - "src/lib/hooks/useActiveProtocolAssignment.ts"
    - "src/lib/markdown/protocol-shortcode-plugin.ts"
    - "src/components/admin/protocols/ProtocolSummaryCard.tsx"
    - "src/components/protocols/PublicProtocolPage.tsx"
  patterns:
    - "Pure pre-parser pattern (mirrors remark-citations.ts): parseProtocolShortcodes returns {segments, protocols}"
    - "Segment-aware ReactMarkdown rendering: text segments → ReactMarkdown, protocol segments → ProtocolSummaryCard"
    - "Sanitize-then-parse ordering: sanitizeRagMarkdown (XSS) before parseProtocolShortcodes"
    - "signedIn?.user?.id pattern for Supabase UID (LeanShot User type lacks id field)"
key_files:
  created:
    - "leanshot/src/types/protocols.ts"
    - "leanshot/src/lib/hooks/useActiveProtocolAssignment.ts"
    - "leanshot/src/lib/markdown/protocol-shortcode-plugin.ts"
    - "leanshot/src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts"
    - "leanshot/src/components/admin/protocols/ProtocolSummaryCard.tsx"
    - "leanshot/src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx"
    - "leanshot/src/components/protocols/PublicProtocolPage.tsx"
    - "leanshot/src/components/protocols/__tests__/PublicProtocolPage.test.tsx"
    - "leanshot/src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx"
  modified:
    - "leanshot/src/App.tsx (View type + lazy import + selectView branch + render branch)"
    - "leanshot/src/components/dashboard/tabs/MedicationTab.tsx (Expected/Logged row)"
    - "leanshot/src/components/dashboard/tabs/BodyTab.tsx (Protocol adherence card)"
    - "leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx (segment-aware rendering)"
decisions:
  - "Use signedIn?.user?.id (Supabase UID) instead of user?.id — LeanShot User type has no id field"
  - "Injection deviation checks only mg units (Injection.dose is string; parse float for comparison)"
  - "ProtocolSummaryCard crosses admin/consumer boundary intentionally — PATTERNS.md approved"
  - "not-prose class on protocol card wrapper prevents prose CSS from re-styling the card"
  - "IIFE pattern in KnowledgeArticleDetailPage keeps change scoped to single expression slot"
metrics:
  duration_seconds: 620
  completed_date: "2026-05-26"
  tasks_completed: 4
  tasks_total: 4
  files_created: 9
  files_modified: 4
---

# Phase 61 Plan 07: Patient KB Public Summary

**One-liner:** Consumer protocol surfaces — KB shortcode parser + ProtocolSummaryCard + PublicProtocolPage + MedicationTab deviation row + BodyTab adherence card with sanitize-then-parse XSS ordering.

## Tasks Completed

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | useActiveProtocolAssignment hook + MedicationTab + BodyTab | de34a303 | Done |
| 2 | parseProtocolShortcodes + ProtocolSummaryCard + tests | fc2cfad4 | Done |
| 3 | PublicProtocolPage + App.tsx /protocols/* branch | af56317f | Done |
| 4 | Wire parseProtocolShortcodes into KnowledgeArticleDetailPage (BLOCKER fix) | 70c283e8 | Done |

## What Was Built

### Task 1: useActiveProtocolAssignment + MedicationTab + BodyTab

**Hook contract (`useActiveProtocolAssignment`):**
- Takes `patientId: string | null`, returns `{ data: ActiveAssignment | null, loading: boolean }`
- `ActiveAssignment` contains: `assignment`, `protocol` (name/compound), `currentWeek` (1-based), `currentStep` (step matching current week or last available), `allSteps`
- Week computation: `Math.floor((Date.now() - startedMs) / (7 * 24 * 60 * 60 * 1000)) + 1`
- Null patientId → immediate null data, no DB round-trip

**MedicationTab Expected/Logged row:**
- Only renders when: `activeAssignment.currentStep` exists, injection unit is `mg`, and `abs(expected - logged) > epsilon`
- Warning color (`var(--color-warning)`) when deviation > 20% (`abs(expected - logged) / expected > 0.2`)
- Purely annotative — existing logged doses never overwritten (non-destructive per CONTEXT.md)

**BodyTab adherence card:**
- Computes adherence over last N weeks (`N = min(currentWeek, 4)`)
- Adherence = injections within 20% of expected dose / total injections with matching protocol step
- Accent color (`var(--color-primary)`) on percentage number — the ONE permitted accent use per UI-SPEC Surface 6 reserved-for #5

**Key deviation:** LeanShot `User` type lacks an `id` field. Used `useStore(s => s.signedIn?.user?.id ?? null)` (Supabase UID from signedIn slice) instead of `user?.id`.

### Task 2: parseProtocolShortcodes + ProtocolSummaryCard

**Shortcode regex format:**
```
/\[protocol:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi
```
Strictly RFC 4122 UUID format — malformed tokens remain plain text (T-61-07-02 mitigation).

**Parser output:**
```typescript
{ segments: ProtocolSegment[]; protocols: ProtocolRef[] }
```
- Deduplication: same UUID → same refIndex (first occurrence wins)
- Edge case: no shortcodes → single text segment, empty protocols array

**Test coverage:** 5 cases — no-match, one match, duplicate, two distinct UUIDs, malformed UUID.

**ProtocolSummaryCard:**
- Fetches with `review_state='published'` filter — unknown/draft UUIDs render "Protocol unavailable" (T-61-07-06 mitigation)
- Skeleton loading state, error fallback, success rendering with title/compound/weeks badge/link
- 3 test cases: loading, success, 404 fallback

### Task 3: PublicProtocolPage + App.tsx selectView branch

**selectView ordering (Pitfall 7):**
```
1. /knowledge/* (public, no-auth) → 'knowledge'
2. /protocols/* (auth-gated) → user ? 'protocols' : 'auth'  ← NEW
3. /auth/callback → 'auth-callback'
4. /clinic/* (auth-gated) → 'clinic' variants
5. /admin/* → admin variants
```

**PublicProtocolPage:**
- Reads slug from `window.location.pathname` (not react-router, per consumer SPA no-router invariant)
- Calls `get_protocol_by_slug` RPC from Plan 61-02 (no new RPC added)
- `<meta name="robots" content="noindex">` via react-helmet-async (T-61-07-01 mitigation)
- Defensive handling: RPC may return array or single object
- 404 EmptyState when slug doesn't resolve

### Task 4: KnowledgeArticleDetailPage KB renderer wiring (BLOCKER fix)

**Problem (iter-1 BLOCKER):** Tasks 2+3 shipped `parseProtocolShortcodes` and `ProtocolSummaryCard` but no consumer wired them. `[protocol:<uuid>]` tokens would render as literal text in KB articles.

**Solution:** Replaced `<ReactMarkdown>{sanitizedBody}</ReactMarkdown>` with IIFE segment-aware rendering:

```tsx
{(() => {
  const { segments } = parseProtocolShortcodes(sanitizedBody);
  return segments.map((seg, i) => {
    if (seg.type === 'protocol') {
      return <div key={`protocol-${i}-${seg.protocolId}`} className="my-4 not-prose">
        <ProtocolSummaryCard protocolId={seg.protocolId} />
      </div>;
    }
    return <ReactMarkdown key={`text-${i}`}>{seg.value}</ReactMarkdown>;
  });
})()}
```

**Sanitize-then-parse ordering (T-60-13-XSS-1 + T-61-07-02):**
1. `sanitizeRagMarkdown(bodyMarkdown)` — XSS defense (Phase 60 T-60-13 pattern)
2. `parseProtocolShortcodes(sanitizedBody)` — shortcode extraction on sanitized string only

**Integration test critical assertions:**
1. Raw `[protocol:<uuid>]` token ABSENT from DOM
2. `ProtocolSummaryCard` rendered in its place ("View full protocol →" link present)
3. Surrounding text segments render correctly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LeanShot User type lacks id field**
- **Found during:** Task 1 TypeScript check
- **Issue:** Plan instructions referenced `user?.id ?? null` but the LeanShot `User` interface (`src/types/index.ts`) has no `id` field — it is the product profile (name, medication, dose, etc.), not the auth identity
- **Fix:** Used `useStore(s => s.signedIn?.user?.id ?? null)` to access the Supabase UID from the `signedIn` slice instead
- **Files modified:** `src/components/dashboard/tabs/MedicationTab.tsx`, `src/components/dashboard/tabs/BodyTab.tsx`
- **Commit:** af56317f (task 3, which re-staged both files)

**2. [Rule 1 - Bug] Integration test: multiple elements matching getByText**
- **Found during:** Task 4 test execution
- **Issue:** `getByText('Tirzepatide titration guide')` found both breadcrumb span AND H1 — throws when multiple matches
- **Fix:** Changed to `getAllByText(...)` with `expect(titles.length).toBeGreaterThanOrEqual(1)`
- **Files modified:** `src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx`
- **Commit:** 70c283e8

**3. [Rule 2 - Missing critical] types/protocols.ts missing (Plan 61-01 dependency)**
- **Found during:** Task 1 setup
- **Issue:** `src/types/protocols.ts` declared as dependency from Plan 61-01 but did not exist in the worktree (Plan 61-01 not yet shipped or in a different wave)
- **Fix:** Created `src/types/protocols.ts` with all required types (`Protocol`, `ProtocolStep`, `PatientProtocolAssignment`, `ProtocolEvidence`) matching the DB schema from 61-CONTEXT.md
- **Commit:** de34a303

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| `protocol-shortcode-plugin.test.ts` | 5 | Passed |
| `ProtocolSummaryCard.test.tsx` | 3 | Passed |
| `PublicProtocolPage.test.tsx` | 3 | Passed |
| `KbProtocolShortcode.integration.test.tsx` | 2 | Passed |
| **Total** | **13** | **All passed** |

## Self-Check: PASSED

All 9 created files exist on disk. All 4 commits exist in git log. 13/13 tests pass. 0 TypeScript errors.

### Files Exist (all FOUND):
- src/types/protocols.ts
- src/lib/hooks/useActiveProtocolAssignment.ts
- src/lib/markdown/protocol-shortcode-plugin.ts
- src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts
- src/components/admin/protocols/ProtocolSummaryCard.tsx
- src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx
- src/components/protocols/PublicProtocolPage.tsx
- src/components/protocols/__tests__/PublicProtocolPage.test.tsx
- src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx

### Commits Exist (all FOUND):
- de34a303: Task 1 — hook + MedicationTab + BodyTab
- fc2cfad4: Task 2 — shortcode parser + ProtocolSummaryCard
- af56317f: Task 3 — PublicProtocolPage + App.tsx
- 70c283e8: Task 4 — KB renderer wiring (BLOCKER fix)
