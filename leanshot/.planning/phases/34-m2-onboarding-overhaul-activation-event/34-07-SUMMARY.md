---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 07
subsystem: onboarding/activation
tags: [onboarding, activation, first-action, primary_goal, store]
dependency-graph:
  requires: [34-03, 34-06]
  provides:
    - FirstActionSurface (3-card hybrid UI)
    - GOAL_ACTION_MAP + ACTION_CATALOG (D-13 lookup)
    - fireActivation() helper (3-layer fire-once guard)
    - useStore.replayDraftEntries / draftEntriesPending (34-06 hand-off sink)
    - useStore.activationFiredAt / setActivationFiredAt (D-15 browser fire-once)
  affects:
    - Plan 34-10 (will wire `leanshot:open-surface` listener + ship the
      8 destination modals)
tech-stack:
  added: []
  patterns:
    - Three-layer fire-once: store flag + in-module inflight Promise + server advisory lock
    - CustomEvent integration seam for cross-tree navigation (mirrors `leanshot:replay-tour`)
    - Zustand persisted-slice additive extension via `partialize` allow-list
key-files:
  created:
    - leanshot/src/lib/onboarding/first-action-map.ts
    - leanshot/src/lib/onboarding/first-action-map.test.ts
    - leanshot/src/lib/onboarding/activation-hooks.ts
    - leanshot/src/lib/onboarding/activation-hooks.test.ts
    - leanshot/src/components/onboarding/FirstActionSurface.tsx
    - leanshot/src/components/onboarding/FirstActionSurface.test.tsx
  modified:
    - leanshot/src/lib/store.ts (Actions + persist body + partialize)
    - leanshot/src/lib/storage.ts (PersistedState + initialState defaults)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (pickPartialized augment — Rule 3)
decisions:
  - D-12 hybrid 3-card UI shipped: card 0 is the recommended action (border-2 + primary icon chip + Badge + primary Button), cards 1 and 2 are universal fallbacks (interactive Card + ghost Button)
  - D-13 fallback rotation = universal set [first_weight_log, first_injection_log, first_workout_log] probed in order, skip on collision with the recommended (deterministic, no randomization)
  - D-15 browser-side fire-once via persisted store flag `activationFiredAt`; survives reload + goal-change post-signup
  - Concurrent-tap dedup via in-module inflight Promise (single source of truth across StrictMode double-mounts + double-clicks)
  - Navigation seam = `leanshot:open-surface` CustomEvent with `{ surface }` detail. Listener wiring intentionally deferred to Plan 34-10 — surface IDs do not yet exist in the codebase (see Known Stubs)
  - Recommended Badge uses `tone="info"` (existing palette covers primary-soft tints); the recommendation emphasis is reinforced via Card border + primary icon + Button variant so users still read the hierarchy if they only see one of those signals
  - Plan 34-06 ConsumerOnboardingRenderer already calls `replayDraftEntries` defensively (log + clear-cookie even when missing). This plan provides the real sink — additive, non-breaking
metrics:
  duration: "~6 minutes"
  completed: "2026-05-20T18:03:12Z"
  tasks_complete: "2/2"
  files_created: 6
  files_modified: 3
  vitest_cases_added: 25
---

# Phase 34 Plan 34-07: End-of-onboarding 3-card hybrid surface + activation hook Summary

D-12 3-card hybrid first-action UI + D-13 goal→action lookup table + 3-layer
fire-once `fireActivation()` helper shipped end-to-end; the activation pipeline
that 34-03 staged is now live at the browser layer and ONBOARD-05 / ONBOARD-13
ship as user-visible behavior.

## What Shipped

### 1. `leanshot/src/lib/onboarding/first-action-map.ts`

Pure-data module — D-13 lookup table. Exports:

| Symbol | Shape | Purpose |
|---|---|---|
| `PrimaryGoal` | union of 8 string literals | mirrors `profiles.primary_goal` enum from 34-01 + `GOAL_OPTIONS` in `ConsumerOnboardingRenderer.tsx` |
| `ActionType` | union of 8 string literals | catalogue of first-action types (D-13) |
| `ACTION_CATALOG` | `Record<ActionType, { label, icon, surface, description }>` | UI metadata per action |
| `GOAL_ACTION_MAP` | `Record<PrimaryGoal, ActionType>` | recommended-only lookup (alias to internal `RECOMMENDED`) |
| `getCardsForGoal(goal)` | `[FirstActionCard, FirstActionCard, FirstActionCard]` | deterministic 3-card output |

Fallback rotation: universal candidate set `[first_weight_log, first_injection_log, first_workout_log]` probed in order; the slot that collides with the recommended is skipped so the surface always emits 2 fallback cards. Family-supporter sits outside the universal-overlap zone (recommended = `waitlist_join`), so its fallbacks are `first_weight_log` + `first_injection_log` per D-13 "treat caregivers as build-habit proxy".

### 2. `leanshot/src/lib/onboarding/activation-hooks.ts`

Single export: `fireActivation({ goal_type, action_type }): Promise<{ activated, reason? }>`.

Three-layer fire-once guard:

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Browser persisted flag | `useStore.activationFiredAt` (ISO timestamp, partialized) | Reload after a successful tap; user changing `primary_goal` post-signup (D-15) |
| 2. In-module inflight ref | `let inflight: Promise<void> \| null` | StrictMode double-mounts; double-clicks; race between rendered card + auto-dismissed re-entry |
| 3. Server advisory lock | Plan 34-03 Edge Fn's Postgres advisory lock + unique constraint | Cross-device concurrent taps; broken-client retries |

The POST shape matches 34-03's Edge Fn contract: bearer auth via `supabase.auth.getSession()`, `Content-Type: application/json`, body `{ goal_type, action_type }`. Response shapes handled: `{ activated: true, days_since_signup }` (sets flag), `{ already_activated: true }` (still sets flag — idempotent), `{ skipped, reason }` (no-op). Network/JSON failure degrades silently (`console.warn` + retry on next tap) because layer 3 dedupes server-side anyway.

### 3. `leanshot/src/components/onboarding/FirstActionSurface.tsx`

Mounts at the end of `ConsumerOnboardingRenderer` (D-12). Renders `getCardsForGoal(goal)` as 3 cards:

- **Recommended (card 0)** — Card variant `elevated` + `border-2 border-[var(--color-primary)]`; icon chip uses `--color-primary` background + `--color-primary-foreground`; "Recommended for your goal" `Badge tone="info"`; Button variant `primary` with text "Start" + aria-label `Recommended: {label}`.
- **Fallbacks (cards 1+2)** — Card variant `interactive`; surface-elevated icon chip; Button variant `ghost` with text = action label.
- **Layout** — mobile-stacked (`space-y-3`) → `sm:grid sm:grid-cols-3 sm:gap-3` at the responsive breakpoint.
- **Tap handler** — calls `fireActivation` → on resolution dispatches `window.dispatchEvent(new CustomEvent('leanshot:open-surface', { detail: { surface } }))` for the Plan 34-10 listener.
- **A11y** — region landmark + `aria-label="Choose your first action"`; recommended card first in DOM order; decorative icons `aria-hidden`; 44px tap target via Button's `min-h-[44px]` override; `aria-busy` propagated through Button primitive while activation POST is inflight.

### 4. Store extension — `useStore` gains 2 persisted slices

```typescript
// PersistedState additions (storage.ts)
activationFiredAt: string | null;   // D-15 browser fire-once
draftEntriesPending: unknown[];     // 34-06 merge-handshake hand-off queue

// Actions additions (store.ts)
setActivationFiredAt(ts: string): void;
replayDraftEntries(entries: unknown[]): void; // appends; logs queued count
```

Both slices added to `partialize` allow-list (store.ts:1958-1992) so:
- The activation fire-once flag survives reload (otherwise D-15 fails — user reloads after activation, taps again, double-POSTs).
- The merge-handshake hand-off survives a crash between cookie-merge + dashboard drain.

Per-existing pattern `feedback_state_counter_table_needs_upsert_on_event` (single client store, no DB row): plain `set({...})` is correct — no UPSERT needed at this layer.

`SettingsPage.tsx`'s `pickPartialized()` augmented with the 2 new keys (Rule 3 — narrowed `PersistedState` type forced the JSON-export round-trip to include them).

## Integration Seam: `leanshot:open-surface` CustomEvent

The tap handler emits:

```typescript
window.dispatchEvent(
  new CustomEvent('leanshot:open-surface', { detail: { surface } })
);
```

Where `surface` is one of the 8 ACTION_CATALOG entries: `modal:weight-log`, `modal:injection-log`, `modal:workout-log`, `modal:symptom-log`, `modal:share-link`, `modal:vial-config`, `modal:reminder`, `modal:family-waitlist`.

Listener wiring is intentionally deferred to **Plan 34-10** — per PLAN.md `<verification>`: *"The CustomEvent dispatch is the integration seam — Plan 34-10 owns the listener wiring smoke test."*

Same-origin DOM event; no XSS surface (no user-supplied strings — `surface` is sourced from the typed `ACTION_CATALOG` keys at compile time).

## TDD Gate Compliance

Both tasks are `type="auto" tdd="true"`. Gate sequence verified in git log:

| Task | RED commit (`test`) | GREEN commit (`feat`) | REFACTOR |
|---|---|---|---|
| 1: first-action-map + hooks + store | `a4417df` | `4ead489` | n/a (no cleanup needed) |
| 2: FirstActionSurface | `c612ef9` | `21c7d89` | n/a |

Each RED commit failed cleanly (module-not-found at the import boundary) before the GREEN commit went green. 25 vitest cases total — 7 map + 8 hooks + 10 component.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `SettingsPage.pickPartialized()` typing broke**

- **Found during:** Task 1 post-implementation typecheck
- **Issue:** `SettingsPage.tsx:264` constructs a literal of type `PersistedState`. After adding `activationFiredAt` + `draftEntriesPending` to the interface, the literal was missing those keys → TS2739 error → app build broken.
- **Fix:** Added the 2 new keys to the `pickPartialized()` return literal so the JSON-export contract continues to round-trip the full persisted shape.
- **Files modified:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx`
- **Commit:** `4ead489` (rolled into the Task 1 GREEN commit).

### Test Adjustments

**2. Card label appears twice (heading + button) — `getByText` ambiguity**

- **Found during:** Task 2 GREEN first run (9/10 passed)
- **Issue:** The fallback Button uses `meta.label` as its visible text for affordance clarity (matches the heading above the icon). `screen.getByText(/Log your first weight/i)` then sees 2 matches and throws.
- **Fix:** Test asserts via `getAllByText(...).length >= 1` instead. The UI decision (label-on-button for fallbacks) is intentional — keeps the secondary actions self-describing without relying on heading proximity for screen readers.

## Known Stubs

**1. `leanshot:open-surface` listener — no destination modals exist yet**

- **Files:** `leanshot/src/components/onboarding/FirstActionSurface.tsx:64` (CustomEvent dispatch)
- **Reason:** The 8 `surface` IDs in `ACTION_CATALOG` (e.g. `modal:weight-log`, `modal:family-waitlist`) are forward references — none of them are wired in the codebase yet (verified via grep against `src/`). Tap → activation fires correctly → CustomEvent dispatches into the void with no listener consuming it.
- **Resolution plan:** **Plan 34-10** owns the listener wiring + the 8 destination modals (or modal-router) + the smoke test that mounts the surface, clicks each card, and asserts the right modal opens. PLAN.md `<verification>` already specifies this.
- **Why not blocked here:** Per PLAN.md task 2 `<action>`: *"those modal IDs must exist already in the codebase (modal:weight-log, modal:injection-log, etc. — verify via grep; if any are missing, document as a Plan 34-10 follow-up rather than blocking this plan)."* — explicit deferral.

**2. `draftEntriesPending` has no dashboard drain yet**

- **Files:** `leanshot/src/lib/store.ts` (action) — feeds into nothing.
- **Reason:** Per PLAN.md `<behavior>`: *"for v1 it logs the entries and stores them under `useStore.draftEntriesPending` array for the dashboard's existing pipeline to pick up."* The pipeline that drains is owned by a future plan (likely 34-10 or a dashboard-side merge plan).
- **Resolution:** The store stub is what `ConsumerOnboardingRenderer` already calls — its presence resolves the warn-and-clear branch flagged in 34-06 SUMMARY. Draining is observable in the React tree via a `useStore` selector.

## Self-Check: PASSED

Created files (worktree filesystem):
- `FOUND: leanshot/src/lib/onboarding/first-action-map.ts`
- `FOUND: leanshot/src/lib/onboarding/first-action-map.test.ts`
- `FOUND: leanshot/src/lib/onboarding/activation-hooks.ts`
- `FOUND: leanshot/src/lib/onboarding/activation-hooks.test.ts`
- `FOUND: leanshot/src/components/onboarding/FirstActionSurface.tsx`
- `FOUND: leanshot/src/components/onboarding/FirstActionSurface.test.tsx`
- `FOUND: leanshot/.planning/phases/34-m2-onboarding-overhaul-activation-event/34-07-SUMMARY.md`

Commits (git log):
- `FOUND: a4417df` test(34-07): add failing tests for first-action-map + activation-hooks
- `FOUND: 4ead489` feat(34-07): first-action map + activation-hooks + store activation/draft slices
- `FOUND: c612ef9` test(34-07): add failing tests for FirstActionSurface 3-card hybrid UI
- `FOUND: 21c7d89` feat(34-07): FirstActionSurface 3-card hybrid UI (D-12) + open-surface event

Verification:
- `npm run test:unit -- --run src/lib/onboarding/ src/components/onboarding/` → 54/54 passing
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0, no diagnostics
- Store grep gate (PLAN <verify><automated>) → `store extension OK`
