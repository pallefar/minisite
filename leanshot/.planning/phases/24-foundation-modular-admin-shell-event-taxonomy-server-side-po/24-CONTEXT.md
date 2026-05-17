# Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 24 is the load-bearing measurement + admin-shell foundation that all of v1.3 leans on. Three workstreams ship together because they're entangled:

1. **Modular admin shell** — refactor v1.2's hard-coded 4-link `AdminLayout` into a manifest-driven router that hosts ~12 lazy-loaded, feature-flagged, route-gated modules. Adds a 3-role model (staff/admin/superadmin) and TOTP enforcement for any admin-or-higher role.
2. **Canonical event taxonomy** — `src/lib/analytics/events.ts` as single source of truth; ESLint-enforced additive-only schema; PHI-flagged events forbidden from browser; CI syncs event definitions to PostHog API.
3. **Server-side PostHog** — `_shared/posthog-server.ts` Edge Function helper for adblock-immune events (signup/payment/activation/refund); always uses Supabase `auth.uid` as distinct_id with browser-side `alias()` bridging.
4. **Audit log v1** — admin actions + curated PHI-table list, full before/after JSONB, 90-day hot + Parquet cold archive forever.
5. **Per-chunk bundle ceilings** — declared in CI, hard-fail on overage, deterministic chunk names via Vite `manualChunks()`.

REQ coverage: ADMIN-01, ADMIN-02, ADMIN-03, TAXO-01, TAXO-02, TAXO-04, TAXO-06.

Out of scope (other phases own these): clinic `org_id` axis (P28), HIPAA legal/vendor work (P25 parallel), bulk actions UI (P27), cohort builder (P27), command palette (P27).

</domain>

<decisions>
## Implementation Decisions

### Modular admin router
- **D-01 — Module registry = manifest TS file.** `src/lib/admin/modules.ts` exports `ADMIN_MODULES` as a `const … satisfies AdminModule[]` array. Each entry: `{key, label, route, icon, lazy: () => import(), flagKey, minRole}`. AdminLayout maps over it for nav + Suspense routes. ESLint can enforce shape. No self-registration (breaks tree-shaking) and no DB-driven registry (chicken-and-egg with RLS, runtime cost).
- **D-02 — Module feature flag = PostHog feature flag.** `flagKey` resolved via `posthog.isFeatureEnabled(flagKey)`. Admin can toggle modules per-cohort / per-rollout without redeploy; bootstrapped flags avoid first-paint flash; failure mode = flag returns false (module hidden). No env-var or DB-column source.
- **D-03 — Route-gating uses Pattern S1 (dual-layer).** Same posture as v1.2 Plan 22-06. Client `AdminShell` checks `profiles.is_staff` + module flag + minRole → renders shell or `<NotAuthorizedCard />`. Every admin RPC ALSO calls `is_staff()` + role check at the DB function level. UX layer and security layer are independent.
- **D-04 — Fixed 3-role model: `staff` / `admin` / `superadmin`.** Stored as `profiles.admin_role` enum. `minRole` on each module entry; comparator does ordinal compare. Mapping: staff → Members, Helpdesk, Reviews; admin → adds Billing, Cohorts, Affiliates, Settings; superadmin → adds AI, Audit Log, dangerous-actions (impersonate, refund, reset_totp, role change). No per-admin permission matrix (anti-feature per research SUMMARY).
- **D-05 — 12 modules canonically named:** Users, Content, Onboarding, Gamification, Reviews, Membership, Analytics, AI, Helpdesk, Billing, Settings, Audit Log. Match REQUIREMENTS ADMIN-01.

### 2FA TOTP
- **D-06 — Hard-cut at ship.** On first `/admin/*` request after Phase 24 deploy, middleware checks `profiles.has_totp` — if false, redirects to `/admin/setup-2fa` and blocks all admin routes until enrolled. No grace window. Trade-off: maximum security posture; disrupts staff mid-task on deploy day (acceptable — communicate cutover internally).
- **D-07 — TOTP via Supabase Auth `mfa.enroll/challenge/verify` (factor type `totp`).** No third-party MFA provider. Aligns with research STACK continuity.
- **D-08 — Recovery: backup codes + superadmin manual reset.** On enrollment, user is shown 10 one-time backup codes (HMAC-hashed at rest, never re-displayable). If lost, superadmin invokes `admin.reset_totp(target_user_id)` RPC which clears the factor + emails a fresh enrollment link to the target. Reset is audit-logged (D-13 audit scope). NOT requiring two-of-N approval (chicken-and-egg with 2 staff total at launch).
- **D-09 — Re-prompt cadence = every admin session, no trust cookie.** TOTP prompted on every sign-in to admin (Supabase Auth `aal2` step-up required for `/admin/*` middleware). No "trust this device for N days" cookie. Maximum HIPAA defensibility; 5–10s friction per session accepted. Does NOT add per-action step-up gating in v1; can revisit if needed for sensitive actions later.

### Event taxonomy + server-side PostHog
- **D-10 — Schema evolution policy = additive-only, ESLint-enforced.** Once an event is registered with `{name, version, payload, phi}`, payload fields cannot be removed or have their type changed. New info = new optional field. ESLint custom rule scans `src/lib/analytics/events.ts` git diffs and blocks PRs that mutate existing entries. Old fields stay forever as canonical history (acceptable bloat — registry growth is bounded by feature velocity, not user activity).
  - **TAXO-06 reconciliation:** Additive-only renders the "downgrade-map for stale clients" tooling in TAXO-06 redundant — if breakage can't happen, you don't need a downgrade adapter. The ESLint rule IS the migration tool. Researcher / planner: confirm TAXO-06 acceptance treats "ESLint rule prevents breaking changes" as satisfying the spirit of the REQ. If not, fall back to the version-bump + adapter approach.
- **D-11 — Source-of-truth = TS file generates JSON schema; CI syncs to PostHog event-definitions API.** `events.ts` zod schemas (hand-written or `ts-to-zod` generated) → JSON schema → CI step calls PostHog event-definitions API on every main-branch deploy to upsert `{name, description, properties, owner_team, phi}`. PostHog UI shows tagged metadata. CI fails if PostHog API call fails (block the deploy — measurement integrity is load-bearing). PostHog API key stored as CI secret.
- **D-12 — PHI gate at event-level boolean; PHI-true events forbidden client-side.** Registry entry includes `phi: boolean`. `capture(eventName, payload)` rejects PHI events from the browser (throws in dev, logs+drops in prod). ESLint rule blocks `import` of PHI-flagged event symbols into client code paths (zone-restricted via `import-x/no-restricted-paths`). PHI events MUST originate from Edge Functions via `posthog-server.ts`. Hard separation aligns with TAXO-04 mask-routes.
- **D-13 — Edge Function distinct_id = always Supabase `auth.users.id`.** `posthog-server.ts` accepts `userId` parameter (required for non-anonymous events) and looks it up from caller context (e.g. Stripe webhook reads `customer.metadata.supabase_uid`). Browser does `posthog.identify(supabase_uid)` on first authenticated load and `posthog.alias(anon_distinct_id, supabase_uid)` to merge pre-auth anonymous events. One identity per user across all surfaces. `await client.shutdown()` MANDATORY before Edge return (research PITFALL).

### Audit log
- **D-14 — Scope = admin actions + curated PHI-table list.** Two write paths:
  1. **Explicit:** Every admin RPC ends with `select log_admin_action(action_name, target_user_id, before_jsonb, after_jsonb)`. Covers impersonate, role change, reset_totp, refund, manual data correction, bulk actions.
  2. **Trigger-based:** Per-row INSERT/UPDATE/DELETE trigger attached to ~15 hand-picked PHI tables (initial list: `injections`, `weights`, `meals`, `workouts`, `vials`, `costs`, `mood_logs`, `sleep_logs`, `photos`, `doctor_shares`, `clinic_patients`, `conversations`, `profiles`, `affiliate_payouts`, `audit_logs` itself — for tamper-detection). Curated list lives at `supabase/migrations/<ts>_audit_phi_table_list.sql` and is reviewed at every phase that adds a PHI table.
- **D-15 — Diff storage = full before/after JSONB.** `audit_logs` row stores complete `before_data jsonb` + `after_data jsonb`. Diff viewer computes the diff client-side via a small JSON-diff library. No JSON-Patch column (simpler; query-direct; storage cost acceptable at scale we expect).
- **D-16 — Retention = 90 days hot + Parquet cold archive forever in private Supabase Storage.** Live `audit_logs` table keeps last 90 days, indexed on `(created_at, actor_user_id, target_user_id, table_name)`. Nightly cron Edge Function exports rows >90 days to Parquet files in a HIPAA-eligible private Supabase Storage bucket (path: `audit-archive/YYYY/MM/DD.parquet`). Queryable out-of-band via DuckDB. Meets HIPAA 7-year retention. Cold-tier reads are rare-by-design.
- **D-17 — Append-only RLS.** `audit_logs` has RLS policies that DENY `update` and `delete` for all roles including `service_role` (matches REQ ADMIN-02). Inserts allowed via SECURITY DEFINER `log_admin_action()` function only (no direct INSERT grant). Trigger-emitted rows insert via trigger's owner privileges.

### Bundle ceilings + CI enforcement
- **D-18 — New ceilings to declare at Phase 24:** `admin-shell` 30 kB gz, `helpdesk-widget` 25 kB gz, `i18n-runtime` 15 kB gz, `gamification-burst` 8 kB gz, `community-feed` 20 kB gz, `course-player` 30 kB gz. Index hard ceiling stays 50 kB gz (v1.2 baseline).
- **D-19 — Failure mode = hard-fail CI on first overage.** Consistent with v1.2 posture (Plan 10-11 hash-hyphen bug fix). No soft-warn window. PR cannot merge until chunk is brought under ceiling (split, dynamic import, `sync-defer.ts` wrapper). Forces author to address inline.
- **D-20 — Chunk-name → file mapping via Vite `manualChunks()` in `vite.config.ts`.** Deterministic name prefix (e.g. `admin-shell-<hash>.js`). Ceiling script greps `dist/assets/<name>-*.js`, gunzips, sums. Builds on v1.2 `scripts/assert-clinic-bundle-budget.sh` pattern with the hash-hyphen fix already merged.

### Claude's Discretion

Researcher and planner have latitude on:
- Exact SQL DDL for `admin_modules` enum/role column + `audit_logs` schema (follow v1.2 migration conventions per `reference_supabase_migration_gotchas.md`).
- Exact ESLint rule implementation for additive-only event registry (custom rule or `eslint-plugin-eslint-comments` extension).
- Exact zod-schema generation step (`ts-to-zod` vs hand-written).
- PostHog event-definitions API call shape (consult Context7 for latest API).
- Whether to ship a 12-module skeleton at Phase 24 or pre-stub only the 4 v1.2 modules + Audit Log + Settings (research SUMMARY suggests Audit Log + Settings join skeleton at minimum; the other 7 modules ship as their owning phases land — manifest entries can exist with `lazy: () => Promise.resolve({default: PlaceholderModule})` until then).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 24 (lines 72–83) — Goal + 5 success criteria + REQ list + UI hint.
- `.planning/REQUIREMENTS.md` — ADMIN-01..03 (lines 22–24); TAXO-01, 02, 04, 06 (lines 31–36); REQ → phase mapping table (lines 396+).
- `.planning/PROJECT.md` — Vendor Accounts table (PostHog tier decision pending P25 vendor calls); v1.3 milestone scope summary.
- `.planning/STATE.md` — accumulated decisions; v1.3 bundle ceiling list; HIPAA chain vendor list.

### v1.3 Research
- `.planning/research/SUMMARY.md` — Executive summary; recommended stack; HIPAA tier cost; foundation-first sequencing.
- `.planning/research/STACK.md` — `posthog-node 5.10.4` Deno import; `react-i18next 15.7.4`; per-chunk ceilings to add at P24.
- `.planning/research/FEATURES.md` — Must-have / should-have / defer / anti-feature lists; admin shell + taxonomy in must-haves; "anti-feature: per-admin custom permission matrix".
- `.planning/research/ARCHITECTURE.md` — Org-context layer (P28+); foundation = event taxonomy + server-side PostHog + modular admin + 2FA.
- `.planning/research/PITFALLS.md` — `await client.shutdown()` on Edge Function exit; HIPAA BAA breakage tail risk; PostHog session-replay PHI mask.

### v1.2 Carry-forward Prior Art (read before designing)
- `.planning/milestones/v1.2-ROADMAP.md` — v1.2 Phase 22 admin foundation (Pattern S1 dual-layer); v1.2 Phase 19 affiliate.
- `src/components/admin/AdminLayout.tsx` — Existing `is_staff` shell + 4-link nav (refactor target).
- `src/components/admin/pages/*` — Existing AdminMembers / Metrics / Cohorts / Affiliates pages (refactor as manifest entries).
- `scripts/assert-clinic-bundle-budget.sh` — v1.2 bundle-ceiling script (extend or generalize per D-20).

### Memory references (decision rationale)
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER search_path, RLS deny patterns.
- `[[reference_supabase_migration_filename_regex]]` — 14-digit timestamp strict.
- `[[reference_bundle_budget_hash_hyphen]]` — Hash-hyphen bug (already fixed; carry forward).
- `[[reference_phase7_research_findings]]` — pgsodium deprecated; favor Vault-based secrets.
- `[[reference_rls_fixture_gotruechient_flake]]` — RLS test pattern for any new admin tables.
- `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant verification > UI traversal.
- `[[reference_vendor_gated_send_health_check]]` — PostHog API may be pending tier upgrade (P25 vendor call); CI sync should health-check gate.

### External docs (consult via Context7 at research time)
- PostHog event-definitions REST API (latest).
- PostHog feature-flags bootstrap pattern.
- Supabase Auth `mfa.enroll/challenge/verify` (factor type `totp`).
- Supabase Auth `aal2` step-up + `assertAuthenticatorAssuranceLevel`.
- Vite `build.rollupOptions.output.manualChunks` typing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AdminLayout` shell** (`src/components/admin/AdminLayout.tsx`) — `is_staff` probe + `<NotAuthorizedCard />` flow; Pattern S1 documented in header comment. Refactor target: replace the hard-coded `ADMIN_NAV` array with `ADMIN_MODULES.filter(byRole).filter(byFlag)`.
- **Existing admin pages** (`src/components/admin/pages/AdminMembersPage.tsx`, `AdminMetricsPage.tsx`, `AdminCohortsPage.tsx`, `AdminAffiliatesPage.tsx`) — become manifest entries with `lazy: () => import(...)`.
- **`AssetLibraryPicker`, `PageEditorView`, `PageListView`, `SiteSettingsPanel`, `TemplatePicker`** (Phase 15 page builder admin) — already lazy-loaded admin surfaces; conform to the new manifest shape.
- **Clinic settings audit tab** (`src/components/clinic/settings/AuditTab.tsx`) — existing audit-viewer pattern; reusable as the basis for the v1.3 admin Audit Log module diff viewer.
- **`AdminAffiliatesScaffold`** — original `is_staff` probe (lines 82–108) per Pattern S1; AdminLayout mirrors it.
- **`scripts/assert-clinic-bundle-budget.sh`** — v1.2 ceiling enforcement script (hash-hyphen bug fixed); extend per D-20.

### Established Patterns
- **Pattern S1 (dual-layer security):** Client gate + RPC re-check. Documented in AdminLayout.tsx header. v1.3 MUST keep both layers.
- **Lazy-loaded admin pages:** Every admin page is already `React.lazy()` in App.tsx wiring (Phase 22 Plan 22-12).
- **`sync-defer.ts` idle-deferred-init wrapper** (per `[[project_phase5_bundle_regression]]`) — heavy SDKs (PostHog, Sentry) route through it; direct static imports = blocked by CI guard. Phase 24 server-side `posthog-node` is Edge-Fn-only (no client bundle impact).
- **Supabase migration filename regex** (per `[[reference_supabase_migration_filename_regex]]`) — `<14-digits>_name.sql` strict.
- **`withOrgScope` wrapper** (P28+) — not relevant to Phase 24 admin tables (super-tenant scope), but audit_logs need a `org_id` nullable column reserved for P28 forward-compat.

### Integration Points
- **PostHog client init in `src/main.tsx`** — already initialized (per memory); Phase 24 adds `disable_session_recording_on_url: /^\/(clinic|admin|share|auth)/`.
- **Vercel Routing Middleware** — adds `/admin/*` aal2 step-up check + `has_totp` redirect to `/admin/setup-2fa`.
- **CI workflow** (`.github/workflows/*` per v1.2 convention) — adds bundle-ceiling job + PostHog event-definitions sync job.
- **ESLint config** (`eslint.config.js`) — adds custom rule for additive-only event registry + `import-x/no-restricted-paths` for PHI-flagged event symbols (per `[[reference_eslint_import_x_path_gotcha]]` — use globs, not bare file paths).
- **`src/lib/supabase.ts`** — Phase 24 augments with `assertAaL2()` helper for sensitive admin RPCs.

</code_context>

<specifics>
## Specific Ideas

- 12 admin modules per ADMIN-01: Users, Content, Onboarding, Gamification, Reviews, Membership, Analytics, AI, Helpdesk, Billing, Settings, Audit Log. v1.2 modules (Members/Metrics/Cohorts/Affiliates) are absorbed under Users / Analytics / Membership categories.
- Audit Log + Settings ship as real modules in Phase 24. Other 7 (Content, Onboarding, Gamification, Reviews, AI, Helpdesk, Billing) can be manifest-registered with placeholder Components that say "Ships in Phase NN — see ROADMAP" so the shell + nav exist end-to-end at Phase 24 ship.
- 10 backup codes per TOTP enrollment (industry default).
- 90-day hot window for `audit_logs`; Parquet archive path `audit-archive/YYYY/MM/DD.parquet` in a NEW private Supabase Storage bucket (HIPAA-eligible; bucket creation = Wave-0 manual ops step before P25 BAA).
- Bundle ceilings list MUST be visible in PR review (e.g., the script prints a table of all chunks + ceilings + actual sizes regardless of pass/fail).
- Per-chunk-ceiling overage messages should hint at remediation (e.g., "admin-shell exceeds 30 kB by 2.3 kB — split a lazy route, defer with sync-defer.ts, or revisit ceiling at next planning cycle").

</specifics>

<deferred>
## Deferred Ideas

- **Two-of-N TOTP reset approval flow** — D-08 explicitly chose superadmin single-approver; revisit if/when staff count grows past 5 or a compromise scare happens.
- **Per-sensitive-action step-up TOTP (aal2 on refund/impersonate/bulk-action only)** — D-09 chose every-session step-up; per-action gating can be added later if every-session friction becomes a productivity drag.
- **Per-admin custom permission matrix** — research SUMMARY lists this as an anti-feature; D-04 honors. Stays anti-feature.
- **DB-driven admin_modules registry** — D-01 considered + rejected. Revisit only if non-engineering operators need to toggle modules without engineer involvement.
- **JSON-Patch diff column on audit_logs** — D-15 chose full before/after only. Add JSON-patch as computed column later if storage becomes a real problem at scale.
- **Audit log retention beyond Parquet archive** — TBD whether Parquet archive lives in same Supabase region (data residency) or replicates to a third-party (Glacier-style). Deferred to P25 HIPAA review.
- **PostHog Boost ($2K/mo) decision** — PROJECT.md flags as P25 vendor decision. Phase 24 CI event-definitions sync uses standard PostHog API (works on any tier); upgrade not required for Phase 24 success.
- **Per-clinic admin role gating** — Phase 24 ships super-tenant admin only. Clinic-scoped admin (org_admin / clinician) is P28 + P31 scope.

### Reviewed Todos (not folded)
None — STATE.md "Pending Todos" section shows none for Phase 24.

</deferred>

---

*Phase: 24 — Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog*
*Context gathered: 2026-05-17*
