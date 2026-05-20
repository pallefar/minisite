# Plan 34-08 — Operator Verification Checkpoint

**Type:** `checkpoint:human-verify`
**Gate:** blocking — Plan 34-08 cannot complete until operator confirms.
**Reached after:** Task 2 commit `a769281` (consumer onboarding builder + tests).
**Worktree branch:** `worktree-agent-a7d88dcf745a247ee` (not yet merged).

---

## What was built (Tasks 1–2)

- `leanshot/src/types/onboarding-step.ts` — added `ConsumerOnboardingStepNode`
  + `ConsumerStepType` (8 D-16 types) + `CONSUMER_STEP_TYPE_LABELS`.
- `leanshot/src/lib/org.ts` — `'onboarding.ship_winner'` + `'onboarding.edit_draft'`
  added to `ROLE_PERMISSIONS.owner` (D-18 client hints; real gate at SECDEF /
  Edge Fn — see RESEARCH Q3 resolution).
- `leanshot/src/lib/admin/modules.ts` — `'onboarding'` manifest entry now
  `lazy() => import('@/components/admin/onboarding-builder/OnboardingBuilderModule')`
  (replaces `placeholderFor('Phase 28+ …')`).
- `leanshot/src/components/admin/onboarding-builder/` — 4 component files +
  2 vitest files:
  - `StepPalette.tsx` (+ `createStepOfType` factory) — 8 chips, click → append.
  - `StepRow.tsx` — sortable-list row.
  - `StepPropertyPanel.tsx` — controlled form (copy / field / options /
    validation / branching JSON).
  - `OnboardingBuilderModule.tsx` — top-level shell with 3 tabs
    (Builder live; A/B + Funnel stubbed for Plan 34-09 via `TabPlaceholder`).
  - `StepPalette.test.tsx` — 9 cases.
  - `OnboardingBuilderModule.test.tsx` — 9 cases.

**Verified automatically before reaching this checkpoint:**

- `tsc -p tsconfig.app.json --noEmit` → clean (no type errors).
- `vitest run src/components/admin/onboarding-builder/` → 18 / 18 pass.
- `vitest run src/lib/__tests__/org.test.ts` → 5 new D-18 tests pass; pre-existing
  2 `patients.link` failures **deferred** (see
  `deferred-items.md`, owned by Phase 28/31).
- `npm run build` → exits 0; admin-shell chunk owns the new files; dnd-kit
  lands in `vendor-dnd-kit-*.js` (separate chunk).
- `scripts/assert-clinic-bundle-budget.sh` →
  > `dnd-kit index-leak invariant OK: no static @dnd-kit imports in index chunk`
  > `clinic bundle topology OK`

---

## Operator UX walk-through (8 steps)

The plan's `<how-to-verify>` script verbatim, plus pre-loaded paths for the
operator to copy-paste.

### Setup (one-time, ~2 min)

1. Push this worktree branch to origin so a Vercel preview deploy spins up
   (or operator deploys locally — `cd leanshot && npm run dev` from this
   worktree gives `http://localhost:5173`).
2. Required test accounts:
   - **Superadmin** — `profiles.admin_role = 'superadmin'`. Pre-existing
     super-admin login from Phase 24 should work; check live with
     `supabase db query --linked "select id, email, admin_role from profiles where admin_role='superadmin' limit 3;"`.
   - **Standard admin** — `profiles.admin_role = 'admin'`. Same query with
     `admin_role='admin'`.
3. Once a super-admin login is verified, capture the URL the deploy
   serves `/admin/onboarding` from (probably
   `https://<vercel-preview>.vercel.app/admin/onboarding` or
   `http://localhost:5173/admin/onboarding`).

### Walk-through (8 steps from the plan)

1. Sign into the deployed (or local) env as a **superadmin** account.
2. Visit `/admin/onboarding`. Expect:
   - Builder tab is the default.
   - A/B and Funnel tabs render the placeholder text
     "*A/B Experiments* tab ships in Plan `34-09`." (likewise for Funnel).
3. Click each of the 8 palette chips in turn (Text input, Single select,
   Multi-select, Scale, Weight, Date, NPS, Custom component). Each click
   appends a new step row. After 8 clicks expect 8 rows.
4. Drag the first step below the second:
   - Pointer: grip the drag handle (right-edge of the row) and drop below row 2.
   - Keyboard: tab to the handle, hit Space, press Down arrow, hit Space again.
     A polite live-region announcement should narrate the move.
   - Confirm the row count stays at 8.
5. Click any step row → the right-side aside renders `StepPropertyPanel` for
   the selected step. Edit the Title field; the row preview should update
   live (controlled form).
6. Click **Save flow** (top-right). Expect a `Saved as new version` toast.
   Confirm at DB level (Supabase studio or CLI):

   ```bash
   supabase db query --linked "select id, version, is_active, jsonb_array_length(config) as step_count from public.onboarding_flows order by version desc limit 3;"
   ```

   Expect: new row's `is_active=true`, prior row's `is_active=false`, step_count
   matches the count you saved.
7. Sign out → sign in as the **standard admin** (admin_role='admin'). Visit
   `/admin/onboarding`. Expect:
   - Page loads (read access permitted).
   - **Save flow** button is `disabled` with `title="Superadmin only"`.
   - Clicking the page doesn't error.
8. Open DevTools → Network tab → reload `/`. Confirm no `@dnd-kit/*` chunk
   loads from the index chunk. Navigate to `/admin/onboarding`; only at that
   point does the `admin-shell-*.js` (and `vendor-dnd-kit-*.js`) chunk get
   fetched.

---

## Sign-off

Respond with one of:

- **`approved`** — all 8 walk-through steps passed. Plan 34-08 closes; merge
  the worktree branch into main and run `/gsd-execute-phase --continue` (or
  let the orchestrator advance).
- **`issue: <description>`** — for each blocker found, file the issue + which
  step number tripped it. The continuation agent re-investigates +
  re-iterates without re-doing Tasks 1–2.

---

## Continuation contract (for the next agent)

If `approved`:

1. Drop the `__cleanup-after-checkpoint__` Edit/Write — none needed; SUMMARY
   write + STATE/ROADMAP/REQUIREMENTS update + final docs commit are the
   completion steps.
2. Mark this checkpoint resolved by appending to this file:
   `### Resolution: approved YYYY-MM-DD HH:MM (operator: <name>)`.
3. Proceed to Plan 34-09 dispatch.

If `issue:`:

1. Diagnose against the failing step number; do NOT redo Tasks 1–2.
2. Fix surgically; re-run `vitest` + `npm run build` + bundle assertion.
3. Re-emit the same `## CHECKPOINT REACHED` with the same Task 1 / Task 2 hashes
   plus the new fix commit.

---

## Quick reference — git state

```
worktree:  /Users/karstenhaldan/minisite/.claude/worktrees/agent-a7d88dcf745a247ee
branch:    worktree-agent-a7d88dcf745a247ee (NOT merged)

commits on this branch beyond main:
  a769281  feat(34-08): consumer onboarding builder — palette + property panel + Builder tab
  ddabe33  feat(34-08): OnboardingStepNode widening + org.ts permissions + admin manifest entry
```

DO NOT merge until operator approves.
