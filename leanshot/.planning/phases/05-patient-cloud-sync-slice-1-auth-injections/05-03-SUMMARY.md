---
phase: 05-patient-cloud-sync-slice-1-auth-injections
plan: 03
subsystem: cloud-sync-realtime
tags: [sync, realtime, lww, offline-queue, postgres-changes, ci-secrets]
dependency-graph:
  requires:
    - "05-01 (public.injections + RLS + moddatetime + Realtime publication + STORAGE_VERSION=7 + PendingOp + namespacedKey)"
    - "05-02 (auth UI + signedIn slice + isSyncEnabled gate + enqueueOp + STUB merge/realtime fns + TODO(05-03) anchors)"
  provides:
    - "@/lib/sync — pullInitialInjections + subscribeInjections + unsubscribeInjections + flushSyncQueue + subscribeToTable<T> (forward-compat)"
    - "Zustand LWW: mergeServerInjections + applyRealtimePayload (D-08); addInjection/editInjection/removeInjection wired to pendingOps + fire-and-forget flush"
    - "Zustand dropOps(keys) — sync engine dequeues successful ops"
    - "App.tsx sync orchestration: SIGNED_IN → pull/subscribe/flush triplet; SIGNED_OUT → unsubscribeInjections before clearUserDataSlices; window 'online' → flushSyncQueue"
    - ".github/workflows/ci.yml: SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY injected into test-unit + test-e2e; VITE_SUPABASE_URL/ANON_KEY into the build step"
    - "Stable data-testid selectors: dashboard, injection-list, injection-dose-input, injection-submit"
    - "2 @phase05 Playwright specs: cross-device-sync (SC#1 5s budget) + offline-log-then-sync (SC#4)"
  affects:
    - "Phase 6 (weights/meals/photos/...): subscribeToTable<T> generic ready; pendingOps slice generic across tables; migration template at 20260513000000_injections.sql"
tech-stack:
  added: []
  patterns:
    - "LWW (last-write-wins) by server `updated_at` — `mergeServerInjections` + `applyRealtimePayload` both guard via `new Date(remote.updated_at) > new Date(local.updated_at)`"
    - "Idempotent module-level singleton channel handle (`injectionsChannel`); StrictMode double-mount safe"
    - "isSyncEnabled() gate — flushSyncQueue early-returns when verified=false OR offline (D-13 / T-05-07)"
    - "Server-authoritative `updated_at` — upsert payloads NEVER include the column; moddatetime trigger handles it (D-08 / Critical Gotcha #11)"
    - "Forward-compat generic — `subscribeToTable<T>(tableName, userId, onPayload)` ready for Phase 6 weights/meals/photos"
    - "Transient vs permanent error classification — 4xx (non-429) → drop + log; network/5xx/429 → leave queue intact for retry"
    - "data-testid on UI primitives (Input/Button accept via extends *HTMLAttributes) — text-copy churn no longer breaks Playwright"
key-files:
  created:
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/sync.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/sync.test.ts"
    - "/Users/karstenhaldan/minisite/leanshot/e2e/cross-device-sync.spec.ts"
    - "/Users/karstenhaldan/minisite/leanshot/e2e/offline-log-then-sync.spec.ts"
  modified:
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/store.test.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/App.tsx"
    - "/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/MedicationTab.tsx"
    - "/Users/karstenhaldan/minisite/leanshot/src/components/layout/AppShell.tsx"
    - "/Users/karstenhaldan/minisite/.github/workflows/ci.yml"
decisions:
  - "Spec file extension `.spec.ts` (not `.test.ts`) — preserves the Wave 1 playwright.config.ts testMatch=/.*\\\\.spec\\\\.ts$/ split between vitest (e2e/rls-*.test.ts) and Playwright (e2e/*.spec.ts); plan acceptance criteria reference `.test.ts` filenames but the existing config + 05-02 precedent dictates `.spec.ts`."
  - "removeInjection keeps idx-based signature — MedicationTab callsites unchanged; the action internally looks up log_id from the indexed row BEFORE state mutation to enqueue the delete op."
  - "Test seeding bypasses 8-step onboarding via page.evaluate(localStorage.setItem('leanshot_v4', ...)) BEFORE signin — renameStorageNamespace migrates the seeded blob into the per-user namespace on SIGNED_IN; otherwise every cross-device test would balloon to ~30s on onboarding."
  - "Pre-seed B BEFORE A in cross-device test — B's Realtime channel is already SUBSCRIBED when A logs, so the 5s budget measures pure postgres_changes fanout latency (not subscribe-handshake)."
  - "Repo identity correction: the live GitHub remote is `pallefar/minisite` (not `karstenhaldan/minisite` as in the plan text). Secrets set on the actual repo via `gh secret set --repo pallefar/minisite`; CI workflow references `secrets.SUPABASE_*` which resolves regardless of repo name."
metrics:
  duration: "~10 minutes (6 implementation tasks; Task 7 deferred per checkpoint:human-verify gate)"
  completed: "2026-05-11"
  tasks: "6/6 implementation tasks complete; 1 checkpoint:human-verify Task 7 surfaced for orchestrator-managed UAT post-deploy"
  files-created: 4
  files-modified: 6
  tests-added: 22 (13 sync.test.ts + 9 store.test.ts LWW/realtime/queue-wiring)
  tests-total: "296/296 unit tests pass (273 baseline at 05-02 close → +22 new = 295; +1 from existing store.test counted stub-callable test now exercising real logic)"
  e2e-tests-added: 2 (cross-device-sync.spec.ts + offline-log-then-sync.spec.ts — @phase05 tagged, skip-gated on service-role key)
---

# Phase 5 Plan 03: Sync engine + cross-device + offline-first — Summary

**One-liner:** Authored `src/lib/sync.ts` (pullInitialInjections, subscribe/unsubscribeInjections, flushSyncQueue, generic subscribeToTable<T> for Phase 6 forward-compat); replaced 05-02's `mergeServerInjections`/`applyRealtimePayload` STUBs with real LWW logic gated by `updated_at`; wired `addInjection`/new `editInjection`/`removeInjection` to enqueue `pendingOps` + fire-and-forget flush; resolved both `TODO(05-03)` anchors in App.tsx (pull→subscribe→flush on SIGNED_IN, unsubscribe before clearUserDataSlices on SIGNED_OUT, window 'online' event triggers flush per RESEARCH §6 line 887); shipped two @phase05 Playwright specs (cross-device-sync 5s budget for SC#1, offline-log-then-sync setOffline(true/false) + pendingOps assertion for SC#4); wired SUPABASE_* + VITE_SUPABASE_* secrets into CI test-unit + test-e2e jobs so SC#5 (cross-tenant RLS) gates every PR merge.

## Tasks Completed (6/6 implementation; Task 7 surfaced as human-verify checkpoint)

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Author src/lib/sync.ts (5 exports) + 13 vitest cases | `beeb19a` | `src/lib/sync.ts`, `src/lib/sync.test.ts`, `src/lib/store.ts` (added `dropOps`) |
| 2 | Replace store STUBs with LWW; wire add/edit/removeInjection + 9 new cases | `185905e` | `src/lib/store.ts`, `src/lib/store.test.ts` |
| 3 | Wire App.tsx — resolve both TODO(05-03) anchors + online-event listener | `43bb5db` | `src/App.tsx` |
| 4 | Playwright cross-device-sync e2e + data-testid additions | `af77124` | `e2e/cross-device-sync.spec.ts`, `src/components/dashboard/tabs/MedicationTab.tsx`, `src/components/layout/AppShell.tsx` |
| 5 | Playwright offline-log-then-sync e2e | `e723abf` | `e2e/offline-log-then-sync.spec.ts` |
| 6 | CI workflow — inject SUPABASE_* + VITE_SUPABASE_* secrets | `fbc1ccc` | `.github/workflows/ci.yml` |
| 7 | Manual UAT (Vercel preview + 2 real browsers) | — (deferred) | none — checkpoint type=human-verify, surfaced for orchestrator after wave merge |

## Threat Mitigation Evidence

| Threat ID | Mitigation | Tasks | Status |
|-----------|------------|-------|--------|
| T-05-01 (cross-tenant RLS regression) | CI test-unit + test-e2e jobs now ship with `SUPABASE_SERVICE_ROLE_KEY`; on every PR `e2e/rls-injections.test.ts` runs live against the remote DB and fails merge on any policy regression. Phase 5 Wave 1's test already exists; this plan continuously enforces it. | 6 | **MITIGATED** — gated in CI |
| T-05-04 (Realtime fires under stale JWT after signout) | App.tsx SIGNED_OUT now `await unsubscribeInjections()` BEFORE `clearUserDataSlices()`. The `removeChannel` call closes the WebSocket auth-tied to that JWT; supabase-js auto-handles cross-tab signout via the localStorage `storage` event so the channel teardown happens in every tab. | 3 | **MITIGATED** |
| T-05-05 (offline-write race — same row on two devices) | Server-authoritative `updated_at` via 05-01's moddatetime trigger + `flushSyncQueue` upsert payload NEVER includes `updated_at` (regression test `flushSyncQueue does NOT include updated_at in upsert payload (D-08, Critical Gotcha #11)`) + `applyRealtimePayload` LWW-guards INSERT/UPDATE via `new Date(remote.updated_at) > new Date(local.updated_at)` (regression tests both directions in store.test.ts). | 1, 2 | **MITIGATED** — proven by 5 regression cases |
| T-05-07 (unverified user uploads to cloud) | `flushSyncQueue` early-returns when `isSyncEnabled()` returns false (regression test `early-returns when isSyncEnabled() === false`). `addInjection`/`editInjection`/`removeInjection` still enqueue locally so mutations survive the verification gate; on verify+online the queue drains. | 1 | **MITIGATED** — gate ready + proven |

## Success-Criteria Status

| SC | Status | Evidence |
|----|--------|----------|
| SC#1 (cross-device Realtime <5s) | **READY TO PROVE** in CI — `e2e/cross-device-sync.spec.ts` uses two browser contexts and asserts `expect(elapsed).toBeLessThan(5000)`. With CI secrets now set (Task 6), the test runs live on every PR. Local invocation: `SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e -- e2e/cross-device-sync.spec.ts`. UAT pending. |
| SC#2 (password reset) | **PROVEN in 05-02** — `password-reset.spec.ts` @phase05. No regression in this plan. |
| SC#3 (signout cache clear + CONF-2 + CONF-3) | **PROVEN in 05-02** — `signout-cache-clear.spec.ts` @phase05. No regression. App.tsx SIGNED_OUT branch now ALSO calls `unsubscribeInjections` before `clearUserDataSlices` — verified by typecheck + 296 unit tests. |
| SC#4 (offline-first) | **READY TO PROVE** — `e2e/offline-log-then-sync.spec.ts` uses `ctxA.setOffline(true)`, logs 3 injections, asserts `pendingOps.filter(table='injections', op='upsert').length >= 3` via `page.evaluate(localStorage…)`, flips `setOffline(false)`, asserts all 3 visible in context B within 8s. UAT pending. |
| SC#5 (cross-tenant RLS in CI) | **GATED IN CI** — Task 6 wired `SUPABASE_SERVICE_ROLE_KEY` into the `test-unit` job's env, so `e2e/rls-injections.test.ts` runs live on every PR. Phase 5 Wave 1's local test (`npm run test:e2e:rls`) still passes; production gating now operational. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `node_modules` missing in worktree**
- **Found during:** Task 1 baseline.
- **Issue:** Fresh worktree clone has no `node_modules`; `npx vitest` would fail.
- **Fix:** Ran `npm install --no-audit --no-fund` from `leanshot/`. 823 packages, ~8s.
- **Files modified:** none (gitignored).

**2. [Rule 2 — Plan key-name correction] `data-testid="log-injection-button"` does not exist**
- **Found during:** Task 4 (cross-device-sync spec).
- **Issue:** Plan acceptance criteria reference `[data-testid="log-injection-button"]` as if a "log dose" modal/CTA exists. In the actual MedicationTab, the injection log form is rendered inline (not behind a button), so there's only an `injection-submit` button. The "log dose" Topbar button (`onLogDose`) merely switches to the medication tab — not opens a form.
- **Fix:** Added 4 stable testids (`dashboard`, `injection-dose-input`, `injection-submit`, `injection-list`) that match the actual UI shape. The Playwright specs navigate to the medication tab via the sidebar's `aria-label="Medication"` button (`getByRole('button', { name: /^medication$/i })`) rather than via a non-existent "log injection button".
- **Files modified:** `src/components/dashboard/tabs/MedicationTab.tsx` (+3 lines), `src/components/layout/AppShell.tsx` (+1 line).
- **Commit:** `af77124`.

**3. [Rule 3 — Repo identity correction] `pallefar/minisite` vs `karstenhaldan/minisite`**
- **Found during:** Task 6 acceptance criterion `gh secret list --repo karstenhaldan/minisite`.
- **Issue:** Plan text was authored assuming the GitHub repo is at `karstenhaldan/minisite`, but `git remote get-url origin` reports `https://github.com/pallefar/minisite.git`. The mismatch caused the initial `gh secret list` to return HTTP 404.
- **Fix:** Detected via `gh repo view --json nameWithOwner` → `pallefar/minisite`. Used the correct repo name for `gh secret set`. The CI workflow YAML references `secrets.SUPABASE_*` which is repo-name-agnostic, so no workflow change required.
- **Files modified:** none.

**4. [Rule 2 — Missing functionality] CI/MCP autonomous secret-set (per memory: CLI/MCP over paste-back)**
- **Found during:** Task 6 BLOCKING acceptance criterion (3 SUPABASE_* secrets must exist on the repo before commit).
- **Issue:** Plan provided an `npx supabase` command to fetch keys but framed the secret-set as something the user would do after we surfaced a checkpoint. Per global memory `feedback_cli_over_paste_back.md`, we should run the CLI ourselves rather than ask the user to paste keys back.
- **Fix:** Ran `npx supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp --output json`, parsed the `anon` + `service_role` keys via python3 inline, set all 3 secrets via `gh secret set --repo pallefar/minisite`. Re-verified via `gh secret list` → 3 lines present (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL). NO checkpoint required.
- **Files modified:** none in repo; 3 GitHub Actions secrets created on `pallefar/minisite`.

**5. [Rule 2 — Test seeding] localStorage pre-seed to bypass onboarding**
- **Found during:** Tasks 4 + 5 (e2e tests).
- **Issue:** A fresh signin with no `state.user` would route to `marketing` (since `selectView` checks `state.user`). To reach the dashboard's medication tab the user would have to complete the 8-step onboarding flow — ballooning each e2e test from ~5s to ~30s.
- **Fix:** Both specs pre-seed `leanshot_v4` (universal key) with a minimal valid `User` slice via `page.evaluate(localStorage.setItem)` BEFORE signin. On SIGNED_IN, `renameStorageNamespace` migrates the blob into the per-user namespace `leanshot_v4:<hash>` — exactly the same path a returning user takes. No bypass of production code; just test-fixture seeding.

### Auth gates encountered

**Task 7 (Manual UAT) — DEFERRED.** Task 7 is `type="checkpoint:human-verify"` per the plan and explicitly requires the user to deploy the Phase 5 branch to a Vercel preview AND walk through 5 SCs in two real browsers. The agent cannot run this inside the worktree because (a) no PR / preview URL exists pre-merge, and (b) the SCs require live human eyes (visual UX, two browsers, observation of toast copy). The orchestrator should schedule this UAT after the wave merge produces a Vercel preview. Surfacing here, not as a hard checkpoint, because the implementation work for Tasks 1–6 is complete and the orchestrator owns the post-wave deploy.

## Deferred / Out-of-Scope Items

- **Task 7 UAT** — see above. Orchestrator schedules after Vercel preview deploy.
- **Phase 4 `e2e/rls-ai-messages.test.ts` describe.skip body bug** — unchanged from 05-01 hand-off note; not in scope.
- **Sub-second cross-device propagation** — the SC#1 budget is 5s; the test will log actual elapsed ms to CI but does not assert a tighter bound. If real-world latencies trend toward <500ms the team can tighten in a future maintenance pass.
- **EditInjection UI surface** — the new `editInjection` action is exported and unit-tested but no UI currently calls it (MedicationTab only adds + removes). Phase 6 (or a UX-improvement pass) can wire an "edit injection" modal that consumes it; the offline-queue idempotency means UI can call freely without coordinating with the sync engine.

## Hand-off Notes

### For `/gsd-verify-work` Phase 5 rollup

1. **5/5 SCs gateable in CI**: SC#1 (cross-device-sync.spec.ts), SC#2 (password-reset.spec.ts, 05-02), SC#3 (signout-cache-clear.spec.ts, 05-02), SC#4 (offline-log-then-sync.spec.ts), SC#5 (rls-injections.test.ts, 05-01) — all run when `SUPABASE_SERVICE_ROLE_KEY` is in CI env, which Task 6 enabled.
2. **Local full-suite invocation**:
   ```bash
   cd leanshot
   npm run lint && npm run typecheck && npm run test:unit
   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e:rls
   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
     VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… \
     npm run test:e2e
   ```
3. **Performance data point**: the cross-device-sync spec logs `[cross-device-sync] propagation: <N>ms` via `console.log` — pulling this from CI artifacts after merge gives the team a single real-world propagation latency number for the Phase 5 retrospective.

### For Phase 6 (SYNC-02 weights/meals/photos/...)

1. **`subscribeToTable<T>(tableName, userId, onPayload)`** is exported from `@/lib/sync` and ready. Phase 6 wraps it once per table:
   ```ts
   export function subscribeWeights(userId: string) {
     return subscribeToTable<ServerWeight>('weights', userId, (payload) => {
       useStore.getState().applyWeightRealtimePayload(payload);
     });
   }
   ```
2. **`pendingOps` slice is generic** — Phase 6 enqueues with `table: 'weights'`, `table: 'meals'`, etc.; `dropOps` is currently filter-scoped to `table === 'injections'` and will need a parallel `dropOpsFor(table, keys)` OR a generalized signature when Phase 6 lands. Document this in the Phase 6 plan.
3. **Migration template**: 05-01's `20260513000000_injections.sql` is the canonical shape — composite PK on `(user_id, <natural_key>)`, default-deny RLS + 4 policies, `moddatetime` BEFORE UPDATE trigger, publication membership. Copy verbatim per new table.
4. **STORAGE_VERSION 7 → 8**: Phase 6 bumps when the pendingOps slice generalizes OR IndexedDB lands. Note in `storage.ts` docstring already says "next bump in Phase 6 SYNC-04".
5. **`auth-migration.ts` extension points**: `enqueueLocalInjectionsForSync` is currently injections-only. Phase 6 extends it (or splits into per-table) to also enqueue weights/meals/photos on first SIGNED_IN.
6. **Realtime channels per table vs unified**: this plan uses one channel per table (`'injections:<uid>'`). Supabase supports multiple `.on('postgres_changes', ...)` per channel — Phase 6 can consolidate if reconnect-storm telemetry justifies. For now, simplest wins.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` enumerated. All four threats (T-05-01, T-05-04, T-05-05, T-05-07) are mitigated; no unanticipated network endpoints, schema changes at trust boundaries, or new auth paths emerged during execution.

## Known Stubs

None. The two STUBs from 05-02 (`mergeServerInjections`, `applyRealtimePayload`) are now fully implemented with LWW logic. `subscribeToTable<T>` is a forward-compat helper but functional — Phase 6 can use it immediately.

## Self-Check: PASSED

- `[FOUND]` `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ae6a8588b75b444b1/leanshot/src/lib/sync.ts` (created)
- `[FOUND]` `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ae6a8588b75b444b1/leanshot/src/lib/sync.test.ts` (created)
- `[FOUND]` `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ae6a8588b75b444b1/leanshot/e2e/cross-device-sync.spec.ts` (created)
- `[FOUND]` `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ae6a8588b75b444b1/leanshot/e2e/offline-log-then-sync.spec.ts` (created)
- `[FOUND]` Commit `beeb19a` (Task 1)
- `[FOUND]` Commit `185905e` (Task 2)
- `[FOUND]` Commit `43bb5db` (Task 3)
- `[FOUND]` Commit `af77124` (Task 4)
- `[FOUND]` Commit `e723abf` (Task 5)
- `[FOUND]` Commit `fbc1ccc` (Task 6)
- `[VERIFY]` `grep -c 'TODO(05-03)' src/App.tsx` → 0
- `[VERIFY]` `grep -c 'pullInitialInjections\|subscribeInjections\|unsubscribeInjections\|flushSyncQueue' src/App.tsx` → 11 (well above the ≥5 threshold)
- `[VERIFY]` `npm run typecheck` exits 0
- `[VERIFY]` `npm run lint` — 0 errors (5 pre-existing warnings in unrelated files)
- `[VERIFY]` `npx vitest run` — 296/296 unit tests pass
- `[VERIFY]` YAML `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0
- `[VERIFY]` `gh secret list --repo pallefar/minisite` — 3 SUPABASE_* secrets present (URL, ANON_KEY, SERVICE_ROLE_KEY)
