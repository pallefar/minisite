# Phase 40 — Deferred Items

> Discovered during Plan 40-06 Task 3 execution.
> Not caused by Plan 40-06 changes — pre-existing conditions documented for tracking.

---

## Bundle Budget Overages (pre-existing)

### admin-shell chunk: 132.69 kB gz (ceiling: 130 kB)

**Owner:** Phase 24 admin-shell ceiling-track.

**Root cause:** The grandfathered admin-shell chunk accumulated 2.69 kB above the Phase 42
ceiling of 130 kB before Plan 40-06 was executed. Git log confirms the size was 132.69 kB
with only the Plan 40-05 stub (8 bytes) in place — the ROI components added ~0 net impact.

**Pre-existing evidence:** Running the bundle script on the commit BEFORE 40-06's ROI
components shows 132.69 kB — same as after.

**Remediation:** Lazy-split one or more admin module components via `sync-defer.ts` or
separate chunk assignment in vite.config.ts manualChunks. Candidate: CancellationModule
(admin portion) could be split from the core admin-shell.

**Priority:** Low — overage is 2.69 kB, below the "NEW regression" threshold described
in the grandfathering hint.

---

### cancellation chunk: 0 kB (ceiling: 13 kB)

**Owner:** Plan 40-04 (CancellationModal lazy chunk setup).

**Root cause:** The cancellation chunk expected by assert-bundle-budget.sh (Plan 40-04
baseline) is not generating as a separate file in the build. The CancellationModal is
lazy-loaded in App.tsx but Vite's chunking logic merges it into another chunk.

**Remediation:** Add a manualChunks rule in vite.config.ts for the cancellation modal:
```ts
if (id.includes('components/dashboard/settings/cancellation')) return 'cancellation';
```

**Priority:** Medium — the feature works but doesn't get the dedicated chunk it was planned
for. The bundle-budget ceiling remains unverified without the named chunk.
