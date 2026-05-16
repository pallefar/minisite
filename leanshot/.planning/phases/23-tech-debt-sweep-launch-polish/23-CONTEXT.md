# Phase 23: Tech Debt Sweep + Launch Polish - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Close out the v1.1-audit carry-over items that have been waiting for v1.2 polish, plus add tooling guardrails that prevent the Plan 10-06 `WORKSPACE_LOADED`-style unused-export defects (anti-pattern #6) from recurring.

**In scope (after 2026-05-16 scope-trim):**
- DEBT-01: Clinic operator drill-in "View activity" button wired to a real `PatientActivityModal` (Plan 10-09 carry-forward).
- DEBT-02: Closeout verify of the `s.user!` non-null assertion sweep (already at 0 actual code occurrences; needs a closeout entry + lint rule to prevent regression).
- DEBT-03: Photo trash flow — soft-delete with 30-day restore + permanent-delete cron + Storage bucket cleanup.
- DEBT-04: Codebase audit of all `test.skip` / `test.fixme` / `it.only` / `xtest` / `xdescribe` / `DEFERRED` markers + fold into `deferred-tests.md` + batch-fix the Phase 15 RLS GoTrue flake + add CI lint requiring every new defer to register.
- DEBT-05: `knip` + `ts-unused-exports` CI gate, PR-level, warn-on-new (block when `new_warns > 0` vs `main` baseline) — escalates to fail-on-any-warn once existing warn count hits 0 via a one-time cleanup PR.

**Out of scope (delegated elsewhere):**
- Final ASO polish (preview.mov hand-record, designed launch-quality OG card, copy sign-off) — folded back into Phase 16-08 Task 4 instead of duplicating here.
- Phase 22b revamped onboarding flow — separate phase per Phase 22 CONTEXT D-02.
- Phase 19 follow-up flags (P19-F1..P19-F5 from `14-SECURITY.md` re-audit) — those belong to `/gsd-secure-phase 19` not Phase 23.

</domain>

<decisions>
## Implementation Decisions

### DEBT-01 — PatientActivityModal scope

- **D-01:** `PatientActivityModal` shows **all logged patient data in one chronological timeline**: injections + weights + meals + workouts + symptoms + photo uploads, interleaved by timestamp. Rationale: 'drill-in' framing implies a fuller view than the per-tab cards the operator already sees on the dashboard. Single-domain views (injections-only) wouldn't add value over existing cards. **Operator audit-log** of impersonation events on this patient is OUT of scope here — belongs under `/admin` (Phase 22 ADMIN-06 territory), not under the clinic operator drill-in.
- **D-02:** Re-use existing patient-data SELECT RLS policies — they already scope correctly when operator impersonation context is set (Phase 9 + 22 work). No new policies required.
- **D-03:** Modal opens on the `// View activity callback` stub at `ClinicDrillInPage.tsx:287` (Phase 10 Plan 10-09 leftover). Lazy-imported chunk to keep ClinicDrillInPage entry weight stable.

### DEBT-02 — `s.user!` audit closeout

- **D-04:** Audit verified COMPLETE — `grep '\\.user!' src --include="*.ts" --include="*.tsx"` returns 0 actual code occurrences as of 2026-05-16 (the 8 matches are all docstring/comment lines saying "no `s.user!` non-null assertions"). Someone (likely Phase 22 sweep) already replaced them all. ROADMAP DEBT-02 wording is stale.
- **D-05:** Add an ESLint rule to PREVENT regression: `no-restricted-syntax` for `TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']` (catches `s.user!` and any `state.user!` variant). One-line rule in `eslint.config.js`. CI catches any reintroduction at PR time.

### DEBT-03 — Photo trash UX + retention

- **D-06:** **Trash button lives in the Photos tab** (or wherever the photo grid is — `BodyTab.tsx` per Phase 6) as a small affordance / icon revealing the Trash view. NOT under Settings — keeps the affordance close to where the soft-delete originates.
- **D-07:** Soft-delete sets `photos.trashed_at = NOW()`; main grid filters `WHERE trashed_at IS NULL`. Trash view filters `WHERE trashed_at IS NOT NULL`. Restore action sets `trashed_at = NULL`. "Delete permanently now" action skips the 30-day window.
- **D-08:** Permanent delete is driven by a **Supabase cron Edge Function** (pg_cron schedule → invokes a `photos-trash-purge` Edge Function) that scans `WHERE trashed_at < NOW() - INTERVAL '30 days'` daily, deletes the DB rows, and removes the matching Storage objects from the `photos` bucket. Decoupled from user activity — no stale-trash for inactive users. Logs purges to `audit_logs` (Phase 7 pattern) for compliance.
- **D-09:** Storage bucket lifecycle rule (Supabase Pro) is **NOT a substitute** — the cron is the source of truth (DB-driven). Storage lifecycle stays as a defense-in-depth backstop. Folds gracefully when Supabase Pro upgrade lands (Phase 16 Section F gate).

### DEBT-04 — Deferred test audit + policy

- **D-10:** Phase 23 plan starts with a **codebase audit pass**: grep for `test.skip`, `test.fixme`, `it.only`, `describe.only`, `xtest`, `xdescribe`, `\\b\\.skip\\(`, comment markers `/* DEFERRED */`, `// DEFERRED`, `// SKIP` across `**/*.test.*`, `**/*.spec.*`, `tests/**`, `e2e/**`. All findings folded into `.planning/deferred-tests.md` with target-resolution-phase per existing entry format.
- **D-11:** Batch-fix the known Phase 15 RLS GoTrue flake using the documented fix-plan (replace `buildAnonClient(...).auth.signInWithPassword(...)` with a service-role-minted JWT injected via `headers.Authorization` option on `createClient` — no GoTrue client involvement). Re-enable the 4 affected `is_staff CAN ...` tests.
- **D-12:** Add a **CI policy lint**: every new `test.skip` / `test.fixme` / equivalent MUST be accompanied by a corresponding entry in `deferred-tests.md` (linked by a comment `// see deferred-tests.md#<anchor>`). The lint is a simple script (`scripts/audit-deferred-tests.mjs`) called from the existing GitHub Actions test job — fails the build if a skip lacks the registry link.
- **D-13:** Update ROADMAP DEBT-04 line + REQUIREMENTS.md to reflect the actual deferred-test count discovered by the audit (replace stale "6").

### DEBT-05 — knip + ts-unused-exports CI gate posture

- **D-14:** Install both `knip` and `ts-unused-exports` (npm devDeps in `leanshot/`). Configure both via project root config files (`knip.json` or `knip.config.ts`; `ts-unused-exports.json`).
- **D-15:** **Exclude paths**: `.planning/**`, `supabase/migrations/**`, `e2e/**`, `scripts/**`, `*.config.{ts,js,mjs}`, `src/**/__tests__/**`, `dist/**`, `dist-marketing/**`, `node_modules/**`. Plus framework-specific exclusions (Vite entry points, `main.tsx`, `main.marketing.tsx`, lazy-import targets).
- **D-16:** **PR-level CI gate**, warn-on-new posture initially: capture baseline warn count from `main` branch's latest CI run; PR fails if `current_warns > baseline_warns`. Allows existing tech debt without blocking, blocks any NEW debt from sneaking in. Implementation: a small shell wrapper around `knip --reporter=json` that diffs against the baseline file checked into `.github/workflows/baselines/` (auto-updated on merge to main).
- **D-17:** **Escalation trigger**: a separate one-time cleanup PR drives the warn count to 0; once `main` baseline is 0, the wrapper script flips to `fail-on-any-warn` mode (no special config change needed — `> 0` is `> 0`). Escalation happens organically when the baseline lands at 0, no manual flag flip required.
- **D-18:** Run on every PR (alongside lint / typecheck / build) — NOT nightly cron. Rationale: nightly warns get ignored; PR-time enforcement is the only signal that actually changes behavior.

### Claude's Discretion

- Plan ordering: Plan 23-01 (codebase audit + DEBT-02 closeout + DEBT-04 registry expansion) → Plan 23-02 (DEBT-05 knip/tue install + CI wrapper) → Plan 23-03 (DEBT-01 PatientActivityModal) → Plan 23-04 (DEBT-03 photo trash + cron Edge Function). Audit-first because it surfaces unknowns; CI gates second so subsequent plans land green; UX features last because they're the largest LOC slices.
- Bundle weight: PatientActivityModal lazy-loaded so it stays out of ClinicDrillInPage entry chunk; photo Trash view also lazy under Photos tab. Both must respect the `24.5 kB gz index ceiling` from Phase 12.
- Test coverage: every new code path (PatientActivityModal, Trash view, photos-trash-purge Edge Function) must ship with vitest + Deno-test coverage; no SC tests deferred to `deferred-tests.md` without explicit registry entry (per D-12).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase context + scope
- `.planning/ROADMAP.md` § Phase 23 (line 31 inline + line 267 detail block) — phase scope, dependencies, requirements list, research flag.
- `.planning/REQUIREMENTS.md` § DEBT-01..DEBT-05 — locked requirement statements.
- `.planning/deferred-tests.md` — existing registry, format reference, only Phase 15 RLS flake entry as of 2026-05-16.

### DEBT-01 (PatientActivityModal)
- `src/components/clinic/drill-in/ClinicDrillInPage.tsx:287` — stub callback awaiting wire (`// View activity callback — Plan 10-09 wires the modal.`).
- `src/components/clinic/drill-in/ClinicDrillInPage.tsx:9-29` — header comment describes intended sub-bar (Plan 10-07) and PatientActivityModal (Plan 10-09).
- `src/App.tsx:115-121` — existing lazy-import pattern for ClinicDrillInPage; mirror for PatientActivityModal lazy chunk.
- `.planning/phases/10-clinic-operator-surface/10-*-PLAN.md` (Plans 10-07 + 10-09 if they exist) — original design intent (audit during planning).

### DEBT-03 (photo trash)
- `src/components/dashboard/tabs/BodyTab.tsx` — photos grid lives here (verify during planning).
- `supabase/migrations/` — existing `photos` table schema; add `trashed_at timestamptz NULL` migration.
- `[[reference-supabase-edge-function-deploy]]` — Edge Function deploy gotchas (gateway Content-Type override, verify_jwt default true, bundler ignores import_map.json).
- `[[reference-supabase-migration-gotchas]]` — partial-index expressions must be IMMUTABLE; SECURITY DEFINER functions need `extensions` in search_path; storage.objects DELETE needs `set_config('storage.allow_delete_query', 'true', true)`.
- `[[reference-vendor-gated-send-health-check]]` — applies if photos-trash-purge needs Storage transforms (Supabase Pro gate — Phase 16 Section F).
- `supabase/functions/account-delete/index.ts` — example of a cascade Edge Function (Phase 22 reference); photos-trash-purge follows similar structure (DB delete → Storage delete → audit log).
- `.planning/phases/07-compliance-foundations-legal-counsel-led/` — audit_logs pattern (use for permanent-delete log entries).

### DEBT-04 (deferred test audit)
- `.planning/deferred-tests.md` — registry format (frontmatter + per-test sections with Affected tests / Symptom / Root cause / Why deferred / Fix plan / Workaround).
- `[[feedback-defer-then-batch-fix-pattern]]` — project rule: never permanently skip SC tests; defer with target phase or polish plan.
- `[[reference-rls-fixture-gotruclient-flake]]` — Phase 15 RLS GoTrue cross-contamination + the documented service-role-JWT-via-headers fix.
- `[[feedback-rls-per-file-slug-prefix]]` — related RLS-fixture pattern (file-scoped TEST_SLUG_PREFIX to avoid cross-test cleanup clobber).

### DEBT-05 (knip + ts-unused-exports)
- `package.json` — devDependencies + scripts section (install + npm script `npm run unused-check`).
- `eslint.config.js` — existing flat config + `no-restricted-syntax` rules already present (Phase 1 pattern for the `s.user!` rule from D-05 to mirror).
- `.github/workflows/` — existing CI workflow files (mirror for new `unused-check` job; baseline diff wrapper goes in `scripts/`).
- `[[reference-supabase-migration-filename-regex]]` — keep in mind for any migration knip might suggest as "unused" (don't auto-delete migrations).
- knip docs: https://knip.dev/ (per `feedback_cli_over_paste_back` — fetch via Context7 during planning if API patterns needed).

### Cross-phase
- `[[project-phase19-shipped]]` — Phase 19 affiliate plumbing touched stripe-webhook/checkout (relevant for DEBT-05 audit triage of Stripe-related unused exports).
- `[[project-phase22-planned]]` — Phase 22 cascade Edge Function shape (account-delete) is the closest analog for the photos-trash-purge Edge Function in DEBT-03.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Modal.tsx` + `Sheet.tsx` from `src/components/ui/` — wrap PatientActivityModal contents. role="dialog" + aria-modal already wired.
- `BaseChart.tsx` — Chart.js wrapper; reuse if PatientActivityModal includes a time-series chart of injection cadence.
- `lazy(() => import(...))` pattern in `App.tsx:119` — mirror for PatientActivityModal + photo Trash view chunks.
- `audit_logs` insert pattern from Phase 7 (`supabase/migrations/*audit_logs*.sql`) — reused for photos-trash-purge cron logging.
- `account-delete` Edge Function structure — closest analog for photos-trash-purge (DB delete → Storage delete → audit log → cron pg_cron schedule).
- `tests/rls/page-builder-rls.test.ts` — Phase 15 RLS test fixture that needs the GoTrue → service-role-JWT rewrite (DEBT-04 D-11).
- `.planning/deferred-tests.md` — entry format reference (DEBT-04 D-10).
- Existing CI workflow files in `.github/workflows/` — mirror pattern for DEBT-05 PR-level gate.

### Established Patterns
- **Lazy-loaded route-equivalents** — every tab module + the marketing page + the onboarding flow + the AI panel + the settings drawer + the doctor report + the guided tour are `React.lazy(() => import(...))` in `src/App.tsx` inside `<Suspense>` boundaries. PatientActivityModal MUST follow this pattern (DEBT-01).
- **Hash routing for in-app screens** — `#/legal/*`, `#/auth/*`, `#/settings/*` (verified Phase 16 H+I audit). PatientActivityModal probably overlays on the clinic-drill-in PATH route (not hash) — verify during planning whether modal needs its own routable surface.
- **Soft-delete `_deleted_at` / `trashed_at` columns** — existing pattern in some Phase 22 tables. Check if a generic helper exists to avoid bespoke pattern divergence (DEBT-03).
- **Cron Edge Functions** — Phase 19 has `affiliate-payout-cron` as a pg_cron + Edge Function pair. Mirror that wiring for photos-trash-purge (DEBT-03).
- **CI workflow per-PR gate** — existing `ci.yml` runs lint + typecheck + test + build + bundle-budget. Add `unused-check` step as parallel job (DEBT-05).
- **ESLint `no-restricted-syntax`** — existing rules in `eslint.config.js` for `useStore(generateInsights|...)` patterns (Phase 1). The `s.user!` rule (D-05) follows the same structure.

### Integration Points
- `ClinicDrillInPage.tsx:287` — stub callback wires to PatientActivityModal lazy chunk (DEBT-01).
- `BodyTab.tsx` (Photos section) — Trash button affordance + Trash view route (DEBT-03 D-06).
- `supabase/functions/photos-trash-purge/index.ts` (new) + pg_cron schedule via `select cron.schedule(...)` migration (DEBT-03 D-08).
- `eslint.config.js` (existing) — append `no-restricted-syntax` rule for `*.user!` (DEBT-02 D-05).
- `.github/workflows/ci.yml` (existing) — append `unused-check` job (DEBT-05 D-18).
- `scripts/audit-deferred-tests.mjs` (new) — registry-link enforcement (DEBT-04 D-12).
- `scripts/check-unused-baseline.sh` (new) — baseline diff wrapper for knip+tue (DEBT-05 D-16).

</code_context>

<specifics>
## Specific Ideas

- ROADMAP DEBT-02 wording ("All 15 `s.user!` non-null assertions across 14 files replaced") is **stale** — actual count is 0 as of 2026-05-16. Plan-phase MUST verify the grep before scoping any code work; if confirmed at 0, DEBT-02 closeout is just D-04 (verify + record) + D-05 (lint rule). No file edits required for the assertion replacements themselves.
- ROADMAP DEBT-04 wording ("6 deferred tests batch-fix") is **stale** — registry has 1 entry. The codebase audit in D-10 will produce the actual count; ROADMAP + REQUIREMENTS get updated per D-13.
- Final ASO polish is **NOT in this phase** — folded back into Phase 16-08 Task 4 closeout. Avoids duplicate-decision risk and keeps the ASO context with the rest of the mobile-shells work.
- The DEBT-05 baseline-diff wrapper pattern is novel for this project — first phase using a "warn-on-new" gate. If it works well, generalize to a reusable pattern for future tech-debt PR gates (e.g. test-coverage-on-new).

</specifics>

<deferred>
## Deferred Ideas

- **Phase 22b revamped 7-step onboarding** — per Phase 22 CONTEXT D-02, separate phase. Not Phase 23 scope.
- **Phase 19 follow-up flags P19-F1..P19-F5** — surfaced by the Phase 14 security re-audit (2026-05-16). Belongs to `/gsd-secure-phase 19`, NOT Phase 23.
- **Generalized soft-delete helper** — if photos-trash-purge ends up duplicating Phase 22's account-delete cron pattern, extract a shared `cron-purge-{table}` helper at v1.2.1.
- **`fail-on-any-warn` mode for knip+tue** — DEBT-05 D-17 escalates organically once baseline hits 0; no separate scope item needed.
- **Operator audit-log surface in /admin** — surfaced during DEBT-01 discussion (was option C, rejected for clinic drill-in but valid for admin). Belongs to Phase 22 ADMIN-06 territory or a future admin-polish phase.
- **knip + ts-unused-exports nightly cron mode** — rejected per D-18 (warn-only nightly = ignored). Could revisit at v1.3 if PR-time enforcement creates friction.

</deferred>

---

*Phase: 23-tech-debt-sweep-launch-polish*
*Context gathered: 2026-05-16*
