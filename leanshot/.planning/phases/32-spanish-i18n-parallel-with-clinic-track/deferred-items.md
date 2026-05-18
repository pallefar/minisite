# Phase 32 — Deferred Items (Out of Scope)

Discovered during Phase 32 execution but caused by pre-existing baseline conditions (NOT regressions from 32-NN changes). Per executor scope-boundary rule: logged here, NOT fixed in this phase.

## Plan 32-01

### admin-shell chunk over baseline ceiling (pre-existing)

- **What:** `scripts/assert-bundle-budget.sh dist/assets` reports `admin-shell 90.62 kB OVER 45 kB ceiling` (over by ~45 kB).
- **Why pre-existing:** Verified by checking out baseline commit `c46b423` (parent of Plan 32-01's HEAD) and running an identical build — admin-shell at baseline was already **90.60 kB** OVER, with no Plan 32-01 changes present. The 32-01 build measurement (90.62) is essentially identical (0.02 kB delta, noise).
- **Root cause (suspected):** Phase 24 D-18 set the target at 30 kB and the script raised to 45 kB to absorb the Phase 15 page-builder editor that landed in admin-shell. Subsequent Phase 27 (admin command palette), Phase 28 (org RLS modules), Phase 29 (admin observability), Phase 30 (clinical-alert admin), Phase 31 (white-label) all added admin modules without re-checking the ceiling. The 45 kB ceiling was the right call AT phase 24; by phase 32 the surface is 2× larger.
- **Fix owner:** NOT Phase 32. Likely candidates: lazy-load Page Builder editor behind a second `React.lazy()` boundary inside admin-shell so it splits OUT, OR raise ceiling to 95 kB after a tree-shake / unused-export pass.
- **Workaround for Plan 32-01:** Plan 32-01 does not touch any admin code; the 90.62 vs 90.60 delta is well within the build-nondeterminism noise floor. CI bundle-budget gate fails on admin-shell regardless of whether Plan 32-01 ships — this is not blocking the plan's goal, it's blocking ALL merges until a separate plan resolves it.

### index chunk MISSING when hash ends in hyphen (bundle-budget script flake)

- **What:** `scripts/assert-bundle-budget.sh` reports `index ... MISSING` for some builds (e.g. when the content hash is `IMEMBw8-` which ends in `-`).
- **Why pre-existing:** The find regex `[A-Za-z0-9_]{8,}` allows alphanumeric + underscore but does NOT allow `-` in the hash. Vite's `base64url`-style hashes include `-` as a valid character. The earlier hash-hyphen bug (per `[[reference_bundle_budget_hash_hyphen]]`) was fixed for INTERIOR hyphens in chunk NAMES (e.g. `course-player-<hex>`), but the regex still rejects TRAILING hyphens in the hash itself.
- **Fix owner:** NOT Phase 32. A 1-character regex change (`[A-Za-z0-9_-]{8,}`) in `scripts/assert-bundle-budget.sh` would fix this; deferred to a follow-up tooling plan.
- **Workaround:** None needed for Plan 32-01 — the i18n-runtime chunk hash didn't trigger the bug in any of our 3 build runs.

### `Circular chunk` warnings during build (pre-existing)

- **What:** Build emits `Circular chunk: share -> admin-shell -> share` and 4 other admin-shell ↔ clinic ↔ read-only-patient-view warnings.
- **Why pre-existing:** These predate Plan 32-01 (verified at c46b423 baseline build). They are Vite warnings, not errors — the build still completes.
- **Fix owner:** NOT Phase 32.
