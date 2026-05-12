---
phase: 6
slug: patient-cloud-sync-slice-2-full-data-migration-photos
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
source: 06-RESEARCH.md §Validation Architecture
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced from `06-RESEARCH.md` §Validation Architecture; populated during execute-phase by the planner + executor agents.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (unit) + Playwright 1.x (e2e/Visual) |
| **Config file** | `leanshot/vite.config.ts` (unit), `leanshot/playwright.config.ts` (e2e), `leanshot/vitest-e2e.config.ts` (RLS cross-tenant) |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test:unit && SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e:rls && npm run test:e2e` |
| **Estimated runtime** | ~4s unit / ~30s RLS / ~90s e2e (when SERVICE_ROLE_KEY is set; specs skip-gate otherwise) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit` (must stay green; baseline = 314 from end of Phase 5)
- **After every plan wave:** Run `npm run test:unit && npm run lint && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite green incl. e2e Playwright specs locally with `SUPABASE_SERVICE_ROLE_KEY` set
- **Max feedback latency:** ~5 seconds per task (unit suite turnaround)

---

## Per-Phase Requirement → Test Map

| Requirement | Plan(s) | Test type | Specific test file(s) | Status |
|---|---|---|---|---|
| SYNC-02 (leanshot_v4 → cloud, no data loss) | 06-02 (migration), 06-03 (entity sync) | unit + e2e | `migration.test.ts` (12-scenario matrix M1..M12), `migrate-cloud-sync.spec.ts` | ⬜ pending |
| SYNC-03 (90-day backup snapshot) | 06-02 | unit | `migration.test.ts` (backup-create + 90d retention test) | ⬜ pending |
| SYNC-04 (IndexedDB offline queue + LWW) | 06-04 (photo storage + queue), 06-05 (LWW conflict toast) | unit + e2e | `photo-queue.test.ts` (idb store), `offline-photo-sync.spec.ts`, `lww-conflict-toast.test.tsx` | ⬜ pending |
| SYNC-06 (photos → Storage, lean Zustand) | 06-04 | unit + e2e + measurement | `photo-storage.test.ts`, `photo-base64-evicted.spec.ts`, post-migration Zustand size assertion | ⬜ pending |

## Per-SC → Test Map (load-bearing, would fail if regressed)

| SC | Plan(s) | Test type | Verification |
|---|---|---|---|
| SC#1 (migration UX + 90d backup) | 06-02 | e2e Playwright | `migrate-resume.spec.ts` — full-flow signin with seeded v4 → modal completes → leanshot_v4_pre_cloud_backup present + dated |
| SC#2 (12-scenario test matrix) | 06-02 | unit + integration | `migration.test.ts` (12 named test cases M1..M12 with explicit fixture per scenario; CI failure blocks merge) |
| SC#3 (photos → Storage + signed URL <5s) | 06-04 | e2e Playwright | `photo-cross-device.spec.ts` — upload on context A → context B fetches signed URL → image loads within 5s |
| SC#4 (offline-edit + LWW + toast) | 06-04, 06-05 | e2e Playwright | `offline-conflict-toast.spec.ts` — two contexts edit same weight offline → both go online → losing device shows toast |
| SC#5 (RLS on 9 tables) | 06-03 | integration (vitest-e2e) | `rls-multi-table.test.ts` — parameterized cross-tenant proof over all 9 tables (extension of `rls-injections.test.ts`) |

---

## Wave 0 Requirements

- [ ] `leanshot/src/lib/migration.ts` — stub exports for v4-to-cloud migration helpers (referenced by 06-02 tests)
- [ ] `leanshot/src/lib/photo-queue.ts` — stub exports for IndexedDB photo queue (referenced by 06-04 tests)
- [ ] `leanshot/src/lib/sync-defer.ts` — stub for deferred-init wrapper (referenced by 06-01 bundle-size assertion)
- [ ] `leanshot/src/lib/migration.test.ts` — stubs for 12 migration scenarios + backup retention test
- [ ] `leanshot/src/lib/photo-queue.test.ts` — stubs for idb integration tests
- [ ] `leanshot/e2e/rls-multi-table.test.ts` — parameterized RLS test stub over all 9 tables (extends Phase 5 pattern)
- [ ] `leanshot/e2e/migrate-resume.spec.ts` — e2e stub for SC#1 full flow

## CI Gate Additions

Plan 06-01 must keep these green; subsequent plans must NOT regress them:

- Bundle-size guard: `dist/index-*.js` gzip ≤ 50 kB (re-prove green via `npm run build` + `.github/workflows/ci.yml` SC#2 assertion)
- Cross-tenant RLS gate: `npm run test:e2e:rls` runs in CI on every PR (already gated by Plan 05-03; Phase 6 extends the parameterized test to cover the 9 new tables)
- Format check: `npm run format:check` (Phase 5 ship left this red; 06-01 brings it green)
- Deno tests: pre-existing failure from Phase 4 era. NOT in Phase 6 scope — separate `/gsd-debug` session per CONTEXT deferred ideas.

---

## Cross-Tenant RLS Proof Template (parameterized over 9 tables)

Per Phase 5's `e2e/rls-injections.test.ts` pattern, extended to handle the 9 new tables.

```ts
// e2e/rls-multi-table.test.ts (Wave 0 stub)
const TABLES_WITH_COMPOSITE_PK = ['weights', 'meals', 'workouts', 'supplements', 'mood', 'sleep', 'symptoms', 'vials'];
const TABLES_WITH_USER_PK = ['settings'];
const ALL_TABLES = [...TABLES_WITH_COMPOSITE_PK, ...TABLES_WITH_USER_PK];

describeIfLive('Phase 6 SC#5 — RLS over all 9 new tables', () => {
  it.each(ALL_TABLES)('table %s — user B reads ZERO of user A rows', async (table) => {
    // 1. Create user A + B via admin API
    // 2. Insert row as user A
    // 3. Query as user B with anon-JWT impersonation
    // 4. Expect [] AND impersonation INSERT rejected with code 42501
  });
});
```

---

## Dimension 8 Compliance Checklist

- [x] Every phase requirement has at least one named test
- [x] Every SC has at least one named test
- [x] Bundle-size + RLS + format CI gates explicit
- [x] Wave 0 stub list enumerated
- [x] Cross-tenant RLS extended to all 9 new tables
- [x] Test commands runnable locally with documented env-var requirements
- [ ] Will populate Wave 0 status during executor agent runs

---

*Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos*
*Sampling rate: per-task quick run + per-wave full run*
*Status: draft (Wave 0 not yet executed)*
