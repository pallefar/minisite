# Phase 7: Compliance Foundations (Legal-Counsel-Led) - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the legal/compliance + data-governance surface that lets v1 go to **broad public launch**. Four ROADMAP-mandated requirements (COMPL-01 privacy policy, COMPL-02 WMHMDA CHDP, COMPL-03 FTC HBNR registration + incident-response, COMPL-06 data export + account delete) **plus** four deferred items folded in from Phase 6 (full cloud-write audit log, restore-from-backup UI, codebase-wide `s.user!` audit, re-enable 7 deferred e2e specs).

Phase 7 closes when:
- All four COMPL requirements are met against the live deployed app + Supabase project.
- The 7 deferred e2e specs are re-enabled and passing in CI (milestone-close entry condition already wired into ROADMAP.md).
- Account delete + data export work end-to-end with the 30-day soft-delete + crypto-shred model below.

Out of scope (deferred to later phases): doctor read-share (Phase 8), clinic B2B (Phase 9-10), HIPAA Storage BAA upgrade (triggered, not pre-scheduled — see D-02), legal attorney engagement (see D-01 — accepted risk).

</domain>

<decisions>
## Implementation Decisions

### Legal counsel engagement (COMPL-01/02/03)
- **D-01 (LOCKED, counsel model):** Self-draft all three legal documents from public OSS/Termly-free templates. **NO attorney engagement in Phase 7.** WMHMDA's private right of action (in force March 2024) and the associated litigation risk are explicitly accepted by the founder. Phase 7 plans must NOT include "counsel review" as a task or gate. If a future incident, broad-launch milestone, or user complaint flips this, treat it as a separate Phase 7.5 hardening cycle — do not retroactively block Phase 7 closure.

### Supabase Storage tier + HIPAA posture (folded from Phase 6 deferred)
- **D-02 (LOCKED, Storage tier):** Stay on **free-tier Supabase Storage** for v1 launch. Treat data minimization + the visible disclaimer overlay (Phase 2's COMPL-04) as the HIPAA boundary; we are explicitly NOT a HIPAA covered entity. **Upgrade trigger (recorded for future-you):** first B2B clinic contract (Phase 9-10) OR first security incident, whichever first. When the trigger fires, run a dedicated upgrade phase that adds the Team-tier BAA + revisits photo storage semantics. Do NOT pre-build the tier-upgrade path in Phase 7.

### Account-delete model (COMPL-06)
- **D-03 (LOCKED, account-delete model):** **30-day soft-delete + crypto-shred + audit-skeleton retained forever.**
  - **T+0** on user confirm (typed confirmation): account marked deleted in `auth.users`, sign-out forced on all sessions, photos moved to a crypto-locked Storage prefix (e.g., `photos-pending-shred/<user_id>/`), per-user encryption key flagged for destruction, `leanshot_v4_pre_cloud_backup` (if any) wiped from local storage.
  - **T+0..30d**: user can request undo via support email / a magic-link sent at T+0. Within 30d the account can be fully restored. After 30d the operation is irreversible by design.
  - **T+30d** (background job, daily cron on the Supabase project): per-user encryption key destroyed (true crypto-shred — encrypted photo bytes become unrecoverable even if Storage objects somehow survive), all rows in app tables for that `user_id` hard-deleted via cascade-delete RPC, photos hard-deleted from Storage.
  - **Audit-skeleton (survives forever):** A row in `audit_logs` with shape `(timestamp, action='account_deleted_initiated' | 'account_deleted_finalized', user_id_hash, ip_hash)` is retained indefinitely. The skeleton is NOT keyed to the user's PII — only an irreversible hash — so it does not violate GDPR/WMHMDA "right to erasure" while still enabling HBNR-style breach-tracking + post-mortem investigation.
  - **Failure modes the planner must handle:** partial-shred (some rows deleted, some not — needs idempotent re-run), Storage object orphans (delete-cascade misses), and the case where the user signs up again with the same email during the soft-delete window (treat as net-new account; old user_id remains pending shred).

### Scope of Phase 6 deferred items (all 4 fold in)
- **D-04 (LOCKED, audit-log scope):** **Full cloud-writes scope.** New `audit_logs` table records every cloud write across the 9 sync tables: `(timestamp, user_id, table_name, row_id, action='insert'|'update'|'delete', before_hash, after_hash)`. Writes happen server-side (Postgres trigger or RPC) — clients cannot bypass. Audit log feeds: (a) D-03's account-delete skeleton, (b) Phase 6 D-11's "what was overwritten?" recovery (LWW conflict toast users can ask support to investigate), and (c) the HBNR-mandated breach-tracking story. Retention: indefinite for the skeleton subset (action=account_deleted_*), 13 months for the full per-write history. (13 months covers an annual reporting cycle + 1 month buffer; planner can adjust ±90d with rationale.)
- **D-05 (LOCKED, restore-from-backup UI):** Surface the 90-day `leanshot_v4_pre_cloud_backup` in Settings → a new "Recovery" section with a "Restore from local backup" button that re-hydrates the persisted Zustand state from the backup JSON, including a confirmation modal showing the snapshot date and a warning that current cloud-sync state will be overwritten. Read-only access to the backup until the user explicitly opts in. Phase 6 D-03 punted this; Phase 7 closes the loop.
- **D-06 (LOCKED, `s.user!` audit):** Codebase-wide sweep of all non-null assertions on Zustand store selectors (`useStore((s) => s.user!)` and variants). Each one becomes an early-return + a typed null-guard, OR migrates to the existing nullable-selector pattern from Phase 6 D-12 (`MedLevelChart.tsx:13`). One commit per file. Acceptance: `grep -rn "s\.user!" leanshot/src/` returns zero matches AND typecheck stays green AND no behavioral regression in unit/e2e tests.
- **D-07 (LOCKED, re-enable 7 deferred e2e specs):** This is the FIRST plan in Phase 7 (07-01) because every subsequent legal-pages-deploy needs CI green to be safe. The 7 specs are listed in `leanshot/.planning/deferred-tests.md` with phase/SC/failure-mode/likely-fix-shape. Likely shared root causes (timing budgets, fixture isolation, cold realtime connection) — fix as a batch per memory `feedback_defer_then_batch_fix_pattern.md`. Acceptance: `grep -rn "DEFERRED: see leanshot/.planning/deferred-tests.md" leanshot/e2e/` returns zero matches AND `npm run test:e2e` in CI returns 11 pass / 0 fail.

### Claude's Discretion
- **Specific template vendor for D-01** — Termly free tier, iubenda free, GitHub OSS template repos, or hand-rolled from WMHMDA's statute text. Planner picks; only constraint is "no paid attorney engagement". Recommend at least two sources cross-referenced.
- **Audit-log storage shape** — single `audit_logs` table vs per-table audit tables; planner researches Postgres CDC + Supabase patterns. Only constraint is "writes happen server-side, clients cannot bypass".
- **Footer wiring** — `Landing.tsx:578` currently has plain-text placeholders ("Privacy policy", "Terms of service", "Medical disclaimer"). Planner decides if policies are `/legal/*` SPA routes or static MD files served by Vercel. Either is fine; consistency matters more than the choice.
- **Cron mechanism for T+30 shred** — Supabase pg_cron job, edge function on a schedule, or Vercel cron with admin RPC. Planner picks based on what's already in use (Phase 4 introduced pg_cron — likely fits).
- **D-03 unique sign-up during pending shred** — if the same email signs up at T+5d, treat as fresh account (new user_id). Document explicitly in the user-facing copy of the soft-delete flow so users aren't surprised.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 7 requirements + roadmap
- `.planning/REQUIREMENTS.md` §Compliance — full text of COMPL-01, COMPL-02, COMPL-03, COMPL-06
- `.planning/ROADMAP.md` §"Phase 7: Compliance Foundations (Legal-Counsel-Led)" — 5 success criteria + the entry condition I added (re-enable 7 deferred e2e specs)
- `leanshot/.planning/deferred-tests.md` — central tracker for the 7 e2e specs that 07-01 must re-enable

### Phase 6 carry-forward (load-bearing decisions Phase 7 inherits)
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` §`<deferred>` (lines 139-149) — full list of items folded into Phase 7 via D-04/05/06/07
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-03 — backup file format that D-05's restore UI depends on
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-07 — hard-delete cascade pattern that D-03's account-delete extends
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-11 — LWW conflict toast that D-04's audit log makes investigable
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-12 — nullable-selector pattern that D-06 generalizes

### Existing code Phase 7 will modify or extend
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx:94` — current local-only `exportData()` (JSON, no cloud, no PDF). COMPL-06 extends this to include cloud entities + readable PDF.
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx` (Privacy section, line 294) — the host surface for "Recover from backup" (D-05) and "Delete my account" (D-03).
- `leanshot/src/components/marketing/Landing.tsx:543-587` — footer with plain-text "Privacy policy / Terms of service / Medical disclaimer" placeholders that must become real links to the new policy pages.

### Compliance research (legal-counsel context)
- `.planning/research/` — existing project research dir; check for prior WMHMDA / HBNR / CMIA notes before planner re-researches.
- WMHMDA statute text (Washington RCW 19.373) — primary source; researcher should pull directly rather than rely on summaries.
- 16 CFR Part 318 (FTC HBNR rule) — primary source for registration mechanics + 60-day notification clock referenced in COMPL-03.
- `feedback_defer_then_batch_fix_pattern.md` (memory) — the pattern 07-01 follows for the 7 deferred e2e specs.

### Existing test infrastructure (07-01 will modify)
- `leanshot/playwright.config.ts` — e2e test runner config (already understands `test.fixme`)
- `leanshot/e2e/cross-device-sync.spec.ts`, `migrate-resume.spec.ts`, `offline-conflict-toast.spec.ts`, `offline-log-then-sync.spec.ts`, `photo-cross-device.spec.ts`, `signout-cache-clear.spec.ts` — the 7 deferred specs (one file has 2 deferred tests)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`SettingsPage.tsx` Privacy + Data sections** — `Section` wrapper, `Pill`, `Button` components, existing "Export JSON" affordance. The new "Delete my account" and "Restore from backup" buttons slot here without new layout primitives.
- **Modal component** — typed-confirmation pattern is doable with existing `Modal.tsx` + `Input.tsx`. No new UI primitive needed.
- **Existing local export** — `exportData()` in `SettingsPage.tsx:94` is the obvious extension point for COMPL-06's combined cloud+local + PDF export.
- **`apiKeyStorage` pattern** — `storage.ts:111` is the singleton localStorage wrapper template that an "encryption key destroyed at T+30" tracker can mirror.
- **`Toast` + `useToast`** — already in use across the app; account-delete confirmations + restore-from-backup status messages reuse it.
- **`MedLevelChart.tsx:13` nullable-selector pattern (Phase 6 D-12)** — the template D-06 generalizes across the codebase.

### Established Patterns
- **Synchronous hydration before first render** — `src/main.tsx` `await hydrate()` (per CLAUDE.md "Bootstrap" component). Restore-from-backup UI must NOT race this; it operates on a hydrated store.
- **No router** — visible "page" is derived from `useStore((s) => s.user)`. Legal pages either become a top-level `marketing | legal | onboarding | dashboard` switch, OR live as static `/legal/*.html` served outside the SPA. Planner chooses.
- **`s.user!` is a known anti-pattern (Phase 6 D-12 + memory)** — D-06's sweep extends it. Use `useStore((s) => s.user)` + early-return, never the non-null assertion.
- **Persist middleware partialize** — `store.ts:231-250` excludes `currentTab` + `toast`. Restore-from-backup must call `useStore.setState(...)` on the partialized shape only, not the full ephemeral state.

### Integration Points
- **`audit_logs` table (D-04)** is new infrastructure — touches every existing sync write path (insertInjection, updateWeight, etc.) via Postgres triggers. Plan for migration ordering: create table + trigger BEFORE wiring UI, so the first cloud write after deploy is already logged.
- **Account-delete (D-03)** — Supabase admin `auth.admin.deleteUser` already used in e2e teardown (e.g., `auth-signup-verify-signin.spec.ts`). The production path needs the same primitive plus the new soft-delete bookkeeping table.
- **Photo crypto-shred (D-03)** — per-user encryption key strategy depends on whether existing photo storage already uses Storage's encryption-at-rest (Supabase default) OR introduces app-level envelope encryption. Researcher decides; D-02 (free-tier) makes per-user envelope encryption optional — Storage's built-in encryption + key destruction at the DB level (the key never existed for the bytes) is sufficient on free tier.
- **Footer hookup (`Landing.tsx:578`)** — plain-text placeholders need real `<a href="/legal/privacy">` (or React Router/hash route) wiring. Phase 2 didn't link these because the policies didn't exist yet; Phase 7 closes that gap.

</code_context>

<specifics>
## Specific Ideas

- **D-03 mental model: "30-day undo, 30-year accountability"** — the user-facing copy should emphasize the undo window (trust signal) while the technical implementation guarantees the long-tail accountability story (skeleton survives forever, hashed).
- **D-04 audit-log "before_hash / after_hash"** — store cryptographic hashes of row state pre/post-write, not the rows themselves. Lets us prove "this row changed" without storing PII forever. Recovery in D-04(b) is via the user's local Zustand snapshot at the matching timestamp, not server-side.
- **Termly free tier is the leading template candidate for D-01** — well-known WMHMDA-aware generator; planner should evaluate iubenda + GitHub OSS in parallel and document the comparison in 07-RESEARCH.
- **HBNR registration is paperwork, not code** — COMPL-03 has a code component (incident-response runbook in `.planning/runbooks/`) and a paperwork component (filing with FTC). The runbook is in scope; the actual filing is the user's task with a Phase 7 task that confirms completion (typing the confirmation number into `.planning/decisions/`).

</specifics>

<deferred>
## Deferred Ideas

- **HIPAA Team-tier BAA upgrade** — D-02 records the trigger (first B2B contract OR first incident). When fired, run as a separate phase, not retrofitted into Phase 7.
- **Attorney review of self-drafted policies** — D-01 explicitly accepts the risk. If a real privacy incident or a paying-clinic contract surfaces post-launch, schedule a Phase 7.5 hardening cycle to fund + run an attorney review.
- **GDPR-compliant data-portability format (machine-readable interop schema)** — COMPL-06 ships JSON + PDF; a formal portability format (e.g., FHIR for medical data, vCard-style for personal info) is a v2 concern, not v1.
- **Audit-log UI** — D-04 ships the data + retention infrastructure. A user-facing "see what you/cloud did" view in Settings is a v2 concern; for v1, the data feeds support investigation only.
- **Photo crypto-shred via per-user envelope encryption** — D-02's free-tier choice makes Storage's default encryption + key destruction at the DB level sufficient. If D-02's trigger fires AND the upgrade phase happens, revisit envelope encryption as part of the BAA-readiness scope.

### Phase 7 entry condition already wired
- `ROADMAP.md` §Phase 7 "Entry condition (deferred from Phase 5/6 ship)" — re-enable + fix 7 SC-verification e2e specs. **D-07 absorbs this:** plan 07-01 will execute this entry condition as its first deliverable.

</deferred>

---

*Phase: 07-compliance-foundations-legal-counsel-led*
*Context gathered: 2026-05-12*
