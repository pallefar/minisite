# Phase 28 Deferred Items

## Out-of-scope discoveries logged per Executor SCOPE BOUNDARY rule

### clinic chunk budget overage (pre-existing from sibling plans)

**Discovered during:** Plan 28-05 Task 3 verification (bundle build)
**Status:** Pre-existing, NOT caused by Plan 28-05
**Detail:** `clinic-*.js` chunk is 28,758 bytes gzipped vs ceiling of 28,000 bytes (758 bytes over).
The overage is introduced by sibling plans 28-03/28-04 which added org-scoped clinic components
(ClinicWorkspace.tsx, OrgCreateFlow.tsx, roster/settings components) to the clinic chunk's static graph.
Plan 28-05's additions (org.ts, wire-auth-invalidation.ts, types/org.ts) are NOT in the clinic chunk
import graph — they are either tree-shaken (org.ts has no callers yet) or in the index chunk (wire-auth-invalidation.ts via main.tsx).

**Resolution:** Plan 28-06 or the phase-close executor should raise the clinic ceiling from 28,000 to ≥29,000
(per the auto-fix deviation pattern used historically — see Phase 10 Plan 10-11, Phase 12 Plan 12-01).
Alternatively, the Plan 28-03/28-04 executor should have raised the ceiling already.

**Do NOT fix in Plan 28-05** — out of scope per executor SCOPE BOUNDARY rule.
