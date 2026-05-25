# Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Three coupled deliverables that close the clinic-side B2B story on top of Phase 28's org infrastructure:

1. **White-label theming (path-based).** Expand the Phase 28 `org_branding` skeleton (5 columns) into a bounded ~10-token brand-essentials map. Apply CSS-var overlay at `/clinic/{slug}/*` within first paint — visitors must NOT see a flash of unstyled (default) LeanShot theme before clinic theme swaps in. WCAG AA contrast enforced server-side on save.

2. **3-role admin matrix + UX gates.** Reconcile ROADMAP role vocabulary (`owner / clinician / staff`) with the P28 enum (`admin / staff / viewer`) via an enum rename + ripple. Extend the matrix to 12 action-level permission keys. Single source of truth lives in the DB SECDEF `has_permission(role, perm)`; TS `ROLE_PERMISSIONS` const mirrors; vitest sync test asserts equality. UI gates admin actions per role; server enforces via per-action SECDEF RPCs.

3. **Per-clinic onboarding builder.** A curated step library (welcome, intro_card, medication, goals, body_stats, consent, doctor_invite, tour) the clinic admin reorders + toggles skip on, with a small editable surface (welcome text + one custom intro_card title/body/image). Reuse Phase 15's dnd-kit reorder primitives (extracted into a generic `SortableTreePanel<T>`) but a NEW `OnboardingStepNode` schema (Phase 15 `BlockNode` is marketing-oriented, semantically wrong). Saved flows are versioned in a new `org_onboarding_flows` table. Invited patients see the org's flow ONLY on first sign-in; first-clinic-wins if a patient is later invited by a second clinic.

REQ coverage: ORG-11, ORG-12, ORG-13 (3/3).

Out of scope: subdomain white-label `acme.leanshot.app` (deferred to v1.5 per Phase 28 deferred list); free-form custom CSS escape hatch (rejected — healthcare a11y risk); clinic-defined input fields in onboarding steps (rejected — activation funnel + Phase 34 event taxonomy integrity); per-permission RLS policies directly on org_branding / org_onboarding_flows (replaced by per-action SECDEF RPC gate); template-library presets (rejected in favor of curated library + reorder model); audit-action realtime notifications (deferred — v1.3 ships audit_logs only); free-form onboarding fully-custom block builder.

</domain>

<decisions>
## Implementation Decisions

### Role naming + matrix shape (Area 1)

- **D-01 — Rename `org_member_role` enum via migration.** `alter type org_member_role rename value 'admin' to 'owner'; ... 'staff' to 'clinician'; ... 'viewer' to 'staff'`. Ripple-rename `'admin'` references across SECDEF function bodies, `src/lib/org.ts` `ROLE_PERMISSIONS` keys, RLS policies that match on `role = 'admin'`, test fixtures, type aliases. Single source of truth, ROADMAP-aligned vocabulary forever. Migration is non-trivial blast radius (touches ~10 files including P28 + P29 + P30 SECDEFs + 8 cross-tenant RLS test fixtures); a dedicated Plan 31-00 (RECONCILE) ships this rename atomically before any other P31 plan starts. Plan-checker BLOCKER: any new `'admin'` literal added by P31 plans fails CI.
- **D-02 — Source of truth: DB SECDEF `has_permission(p_role org_member_role, p_perm text) returns boolean`.** TS `ROLE_PERMISSIONS` const at `src/lib/org.ts` is the client-side UX-hint mirror. New vitest test `role-matrix-sync.test.ts` queries the DB function for every `(role, permission)` pair in `ROLE_PERMISSIONS` and asserts equality. Plan-checker BLOCKS if a new permission appears in one side without the other. The DB function is the security floor; client matrix is a UX hint for hiding/disabling.
- **D-03 — 12 action-level permission keys.** Extends Phase 28's 6 keys. Final shape:
  ```
  members.invite, members.revoke, members.list, members.role.edit,
  settings.edit, branding.edit, onboarding.edit,
  roster.view, roster.thresholds.edit,
  alerts.ack, alerts.snooze,
  billing.view
  ```
  Role allocation:
  - **owner**: ALL 12.
  - **clinician**: `members.list, roster.view, alerts.ack, alerts.snooze` + onboarding READ (no edit; reading the active flow requires no key — anyone in the org can see it).
  - **staff**: `members.list, roster.view`.
- **D-04 — `billing.view` is owner-only.** Matches Stripe/Slack/Linear convention. Clinicians don't see seat counts or invoices. (When Phase 29 ships a billing UI, the gate is in place.)

### White-label token scope + first-paint (Area 2)

- **D-05 — Brand-essentials ~10-token map** stored in expanded `org_branding`:
  ```
  logo_url            text
  favicon_url         text     (NEW)
  primary_color       text     (P28)
  accent_color        text     (P28)
  bg_color            text     (NEW)
  text_color          text     (NEW)
  heading_font        text     (renamed from font_family)
  body_font           text     (NEW)
  radius_scale        text check in ('sm','md','lg','xl')  (NEW)
  support_email       citext   (P28)
  ```
  Tokens map to CSS custom properties `--brand-{name}` on `<html>`. Colors stored in canonical `oklch()` string (validated server-side; rejects rgb/hex to avoid drift). Font fields are font-family CSS strings; LeanShot bundles a curated short-list (Inter, Fraunces, JetBrains Mono, Lora, IBM Plex Sans) — clinics pick from a dropdown, NOT freeform (avoids hosting third-party fonts + CSP issues). Plan 31-02 migration adds the 5 new columns + drops `font_family` (renamed). NO custom CSS escape hatch.
- **D-06 — WCAG AA contrast enforced server-side inside `save_org_branding` SECDEF.** Computes relative luminance + contrast ratio for two pairs: `(text_color, bg_color) >= 4.5` and `(primary_color, bg_color) >= 3.0`. Returns structured error code (`CONTRAST_TEXT_BG_FAIL` / `CONTRAST_PRIMARY_BG_FAIL`) which the editor surfaces inline. Clinic CANNOT persist a broken theme. Helper SQL function `_compute_wcag_contrast(c1 text, c2 text) returns numeric` lives at the same migration. Client-side live preview is "Claude's discretion" (researcher decides whether to add a meter; server hard-block is the contract).
- **D-07 — First-paint mechanism: pre-mount fetch in `main.tsx`.** Pattern mirrors the existing `applyThemeToDOM()` pre-paint pattern (see CLAUDE.md §Architecture). Flow:
  1. `main.tsx` detects `/clinic/{slug}` from `window.location.pathname` before `await hydrate()`.
  2. If slug present: read `localStorage[`leanshot_brand_${slug}`]` synchronously; if present apply tokens via `applyBrandTokens()` (sets CSS custom properties on `<html>`) — warm reload is instant.
  3. Kick off async `fetch` of public RPC `resolve_clinic_branding(p_slug)` (no auth required); on response, update localStorage + reapply tokens (covers updates).
  4. Then `await hydrate()` → render React tree.

  RPC returns minimal token blob (~500 bytes) plus `etag`/`updated_at` for cache-busting. Cold first-visit: brief default-theme paint (acceptable per SC#1 "within first paint" — the public RPC resolves under typical latency before React mounts; tokens applied to `<html>` before React's first paint). The localStorage cache makes every subsequent visit truly zero-FOUT.
- **D-08 — Logo + favicon storage: Supabase Storage public bucket `org-branding/{org_id}/`.** Upload via SECDEF `upload_org_branding_asset(p_org_id, p_kind text)` that returns a presigned URL (kind in `'logo','favicon'`). Bucket is public-read (visitors need it for first-paint); insert/update RLS on `storage.objects` requires `org_members.role = 'owner'` AND `object_name LIKE org_id || '/%'`. Server-side validation enforced via Edge Function `branding-asset-validate` triggered on upload: format in PNG/JPG/SVG/ICO, max 500 KB, max 1024×1024 px. Invalid uploads deleted + Sentry warning. `logo_url` + `favicon_url` columns store the public CDN URL Supabase returns post-validation.

### Onboarding builder — editable scope + block schema (Area 3)

- **D-09 — Curated step library (8 types).** `StepType` enum:
  ```
  welcome | intro_card | medication | goals | body_stats |
  consent | doctor_invite | tour
  ```
  Customization surface per type:
  | Step | Reorder | Skip toggle | Editable fields |
  |---|---|---|---|
  | welcome | yes | yes | `custom.title`, `custom.body` |
  | intro_card | yes | yes | `custom.title`, `custom.body`, `custom.image_url` |
  | medication | yes | NO (locked, mandatory) | none |
  | goals | yes | yes | none |
  | body_stats | yes | yes | none |
  | consent | NO (locked position) | NO (locked, mandatory) | none |
  | doctor_invite | yes | yes | none |
  | tour | yes | yes | none |
  Clinic CANNOT define new input fields, add arbitrary blocks, or remove mandatory steps. The 5 LeanShot-owned input-collection steps (medication, goals, body_stats, consent, tour) are semantic — they capture data Phase 34's activation event taxonomy depends on. Free-form blocks were rejected to protect the activation funnel and event guarantees.
- **D-10 — Org's saved flow REPLACES the canonical `OnboardingFlow` for invited patients.** Render-time branching at `src/components/onboarding/OnboardingFlow.tsx` (existing component; modified in P31): if `user.invited_by_org_id` AND the org has an active `org_onboarding_flows` row, render that flow's steps. Otherwise render the standard `DEFAULT_STEPS` (consumer signup path). Single render path per patient — simple to reason about; org owns the patient's first impression. Onboarding completion writes the same `completed_onboarding_at` regardless of path (no per-org completion tracking — see D-12).
- **D-11 — Schema: NEW `OnboardingStepNode` + dnd-kit primitives extracted into reusable `SortableTreePanel<T>`.** Phase 15 `BlockNode` is marketing-oriented (hero, pricing, CTA, lead-form) — semantically wrong for input-collection steps. Schema lives at `src/lib/onboarding-builder/step-schema.ts`:
  ```ts
  export type StepType = 'welcome' | 'intro_card' | 'medication' | 'goals'
                       | 'body_stats' | 'consent' | 'doctor_invite' | 'tour';

  export interface OnboardingStepNode {
    id: string;          // stable uuid per step instance
    type: StepType;
    skip?: boolean;
    custom?: { title?: string; body?: string; image_url?: string };
  }

  export interface OnboardingFlow {
    org_id: string;
    steps: OnboardingStepNode[];
    version: number;
  }
  ```
  Reorder primitives extracted from `src/components/admin/pages/editor/BlockTreePanel.tsx` (DndContext + closestCenter + PointerSensor + KeyboardSensor + SortableContext + verticalListSortingStrategy + useSortable + a11y reorder path) into a generic `src/components/ui/SortableTreePanel.tsx` that accepts `items: T[]` + `getId: (t: T) => string` + `renderItem: (t: T) => ReactNode` + `onReorder: (next: T[]) => void`. `BlockTreePanel.tsx` is refactored to consume the new primitive (verifier checks page-builder tests still pass). Onboarding builder UI at `src/components/clinic/onboarding/OnboardingBuilderPage.tsx` consumes the same primitive with `OnboardingStepNode`. Strict shape guard `_validate_onboarding_steps(p_steps jsonb)` SQL function enforces the schema on save (mandatory-steps present, no unknown types, custom fields only set when type allows).
- **D-12 — Storage: NEW table `org_onboarding_flows` with version history.** Schema:
  ```sql
  create table org_onboarding_flows (
    id          uuid pk default gen_random_uuid(),
    org_id      uuid not null references organizations(id) on delete restrict,
    steps       jsonb not null,
    version     int  not null,
    is_active   boolean not null default true,
    created_by  uuid references auth.users(id) on delete set null,
    created_at  timestamptz not null default now()
  );
  create unique index org_onboarding_flows_active_per_org
    on org_onboarding_flows (org_id)
    where is_active;
  ```
  New "save" inserts a new row + atomically flips previous active row to `is_active = false` inside SECDEF `save_org_onboarding_flow(p_org_id, p_steps jsonb)`. Append-only audit trail; clinic can roll back via separate SECDEF `activate_onboarding_flow_version(p_org_id, p_flow_id)`. RLS: SELECT for any `org_members` of the org; INSERT/UPDATE via SECDEFs only. Cross-tenant impersonation proof test required per project rule. Plan-checker BLOCKER: any new status/version field needs an owning task.

### Server-side enforcement + invited-patient flow (Area 4)

- **D-13 — Per-action SECDEF RPCs gate every P31 admin mutation.** RLS denies direct table writes on `org_branding`, `org_onboarding_flows`, and `org_members` (role column update). Mutations flow through:
  ```
  save_org_branding(p_org_id, p_tokens jsonb)        → 'branding.edit'
  upload_org_branding_asset(p_org_id, p_kind)        → 'branding.edit'
  save_org_onboarding_flow(p_org_id, p_steps jsonb)  → 'onboarding.edit'
  activate_onboarding_flow_version(p_org_id, p_flow_id) → 'onboarding.edit'
  change_member_role(p_org_id, p_user_id, p_role)    → 'members.role.edit'
  ```
  Each RPC's first line: `if not has_permission(get_caller_role(p_org_id), '<PERM>') then raise insufficient_privilege`. Every RPC writes to `audit_logs` via `log_admin_action(...)` (Phase 24 wiring). `get_caller_role(p_org_id)` is a SECDEF helper that resolves `auth.uid() → org_members.role` for the given org (returns null if not a member; RPC raises `not_org_member`). Existing `_is_org_admin(p_org_id)` SECDEFs from Phase 28/30 are renamed `_is_org_owner` as part of D-01 ripple.
- **D-14 — Patient sees org's onboarding flow ONLY on first sign-in.** A new column `completed_onboarding_at timestamptz null` on a per-user record (location: `app_metadata` JWT claim populated via Auth hook, OR new `user_profiles.completed_onboarding_at` column — researcher decides which is cheapest given existing user-profile shape; recommend `auth.users.raw_user_meta_data ->> 'completed_onboarding_at'` written via SECDEF `mark_onboarding_complete()` to avoid yet another table). Render-time branch in `OnboardingFlow`: if `completed_onboarding_at IS NULL` AND `invited_by_org_id` resolves to an org with an active flow, render the org flow. On finish, SECDEF writes the timestamp; subsequent `/clinic/{slug}` visits skip onboarding and render the dashboard directly.
- **D-15 — Multi-clinic invites: first-clinic-wins.** Patient onboarded via the FIRST clinic's flow. Acceptance of any subsequent clinic invite calls Phase 28's existing `link_org_patient()` SECDEF + creates the `org_consent_grants` row but does NOT re-trigger onboarding (because `completed_onboarding_at` is now set). Patient sees both clinics' branding via `/clinic/{slug-A}` and `/clinic/{slug-B}`; the LeanShot account itself was set up once. No "second-clinic intro card" surface in v1.3 (deferred — see Deferred Ideas).
- **D-16 — No realtime admin-action notifications in v1.3.** Audit log only (`log_admin_action` writes to `audit_logs`; clinic members read via Phase 24's `/admin/audit` surface). No HMAC channel broadcast on admin actions, no Resend email to clinicians. Keeps P31 scope tight; clinic admins use their own out-of-band channels to communicate changes. Future P37 (helpdesk) may aggregate admin actions into a clinician inbox if needed.

### Claude's Discretion

Researcher and planner have latitude on:
- Whether `completed_onboarding_at` lives in `auth.users.raw_user_meta_data` JSONB vs `user_profiles` column (D-14). Recommendation: `raw_user_meta_data` to avoid yet another table, but researcher should verify Phase 28's JWT claim pattern doesn't already shape user_profiles.
- Exact placement of WCAG contrast helper SQL: standalone migration + `_compute_wcag_contrast` function vs inline `case`/`when` math inside `save_org_branding` body (D-06). Recommend standalone function for reuse + unit-testability.
- Whether to add a client-side live contrast meter in the theme editor (D-06). Server hard-block is the contract; meter is UX sugar. UI-researcher decides.
- Exact extraction shape for `SortableTreePanel<T>` (D-11) — pure presentation vs include header/footer slots vs accept inline edit-buttons. Researcher consults Phase 15 patterns + this phase's needs.
- Whether `BlockTreePanel.tsx` refactor lands as part of Plan 31-04 (onboarding builder) or as a separate Plan 31-00b refactor (no functional change) to limit blast radius. Recommend separate plan if Phase 15 page-builder tests are non-trivial to re-run.
- Whether the public RPC `resolve_clinic_branding(p_slug)` returns just brand tokens or also returns `clinic_name + logo_alt_text` for the cold-paint experience (D-07). Recommend including alt text for a11y.
- Exact `oklch()` validation regex (D-05). Researcher writes a tight regex covering common forms.
- Cron presence check for any new P31 scheduled work (D-12 history table doesn't need one; no other P31 timing).
- Whether `intro_card.custom.image_url` images live in the same `org-branding` bucket or a sibling `org-onboarding-assets` bucket (D-09 + D-08). Recommend separate bucket to keep retention/quota domains clean.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 31 — Goal + 3 success criteria + 3 REQ list (ORG-11, ORG-12, ORG-13).
- `.planning/REQUIREMENTS.md` lines 116–122 (ORG-11/12/13 full text) and lines 463–469 (ORG-NN → phase mapping).
- `.planning/STATE.md` — milestone v1.3 status; Phase 30 marked complete 2026-05-18.

### v1.3 Research (architecture-level inputs)
- `.planning/research/SUMMARY.md` — V13-2 multi-tenant leak LANDMINE-class; org-context layer + per-action SECDEF pattern.
- `.planning/research/ARCHITECTURE.md` — `withOrgScope` wrapper pattern, HMAC realtime; org-context layer placement.
- `.planning/research/STACK.md` — react-i18next not relevant to P31; @dnd-kit/{core,sortable} versions consumed by Phase 15.

### Phase 28 carry-forward (LOAD-BEARING prerequisite — RLS template + extension contract)
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-CONTEXT.md` — `org_member_role` enum (D-12) ← RENAMED here per D-01; `org_branding` skeleton (D-16) ← EXPANDED per D-05; `<RouteOrgGuard>` + `src/lib/org.ts` + `ROLE_PERMISSIONS` matrix consumed and extended; cross-tenant RLS test fixture pattern.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-ADDENDUM-orgs-reconciliation.md` — supersedes parts of 28-CONTEXT.md; respect superseded sections.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md` — RLS policy template + cross-tenant test recipe + naming conventions + `org_scoped_tables` const update checklist. P31 adds `org_onboarding_flows` to the const.
- Live: `supabase/migrations/20270601100003_org_member_role_enum.sql` — current enum values `('admin','staff','viewer')`; renamed in P31 Plan 00.
- Live: `supabase/migrations/20270601100006_org_branding_table.sql` — current 5-column skeleton; expanded in P31 Plan 02.

### Phase 15 carry-forward (dnd-kit primitives + block-builder UX pattern)
- `src/components/admin/pages/editor/BlockTreePanel.tsx` — DndContext + PointerSensor + KeyboardSensor (a11y reorder) + SortableContext + useSortable. Reorder primitives extracted into `src/components/ui/SortableTreePanel.tsx` per D-11. Marketing-oriented `BlockNode` schema NOT reused (semantically wrong for onboarding).
- `src/lib/page-builder/block-schema.ts` — `BlockNode` shape NOT reused. New `OnboardingStepNode` is a parallel schema.
- `src/lib/page-builder/page-api.ts` — `reorderBlocks` callback shape — pattern target for `reorderOnboardingSteps`.

### Phase 24 carry-forward (audit + admin shell)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — `audit_logs` + `log_admin_action` SECDEF; ADMIN_MODULES manifest (P31 may register a clinic-admin module entry if researcher recommends).
- Phase 24 bundle ceilings: admin-shell 30 kB gz; P28 raised clinic chunk to 35 kB (per Phase 30 D-stamp); P31 adds OnboardingBuilderPage + ThemeEditor — verify ceiling at plan-phase, request explicit raise if needed.

### Phase 30 carry-forward (current clinic-settings surface)
- `src/components/clinic/settings/*` (ClinicSettingsPage, ClinicRankingWeightsForm, ClinicDoseTrendThresholdsForm, MembersTab, RolesTab, RoleEditorModal, WorkspaceTab, AuditTab) — sibling pages live here; new BrandingTab + OnboardingTab join the same surface.
- `src/lib/org.ts` lines 31–48 — `ROLE_PERMISSIONS` const; replaced by the expanded 12-key matrix per D-03.

### Phase 9 carry-forward (consent + invite patterns)
- `src/lib/clinic.ts` — `_validate_consent_scope` shape-guard pattern (target for `_validate_onboarding_steps` per [[feedback_planner_iter1_anti_patterns]] #4: one TS type + one DB validator).
- Phase 9 invite-acceptance flow — extended in D-15 to silent-join on subsequent invites (no re-onboarding).

### Project rules (memory)
- `[[reference_supabase_project]]` — every RLS surface gets a live cross-tenant impersonation proof test. `org_onboarding_flows` + expanded `org_branding` BOTH require new RLS test files following the P28 fixture pattern.
- `[[reference_rls_fixture_gotrueclient_flake]]` — RLS tests use `admin.generateLink + plain fetch /auth/v1/verify` (ES256-compatible 2026-05-16 fix). MANDATORY for the 2 new test files.
- `[[feedback_rls_per_file_slug_prefix]]` — file-scoped `TEST_SLUG_PREFIX` + afterAll cleanup.
- `[[reference_supabase_migration_filename_regex]]` — strict `<14-digits>_name.sql` (letter-suffix silently skipped).
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER explicit `set search_path = pg_catalog, public, extensions`; partial-index expressions must be IMMUTABLE (D-12 partial unique index `where is_active` is immutable — fine).
- `[[feedback_planner_iter1_anti_patterns]]` — defensive jsonb contracts: `_validate_onboarding_steps` shape guard is one TS type + one DB validator function.
- `[[feedback_status_machine_transition_owner]]` — `org_onboarding_flows.is_active` transition (true → false on save; false → true on rollback) has named owning SECDEFs in D-12.
- `[[feedback_planner_iter1_anti_patterns]]` — Plan 31-00 enum rename is a Postgres DDL transaction; researcher confirms `ALTER TYPE ... RENAME VALUE` runs in a single transaction (Postgres 12+ supports it; verify).
- `[[reference_bundle_budget_hash_hyphen]]` — P31 adds ~6–10 kB gz to clinic chunk (OnboardingBuilderPage + ThemeEditor + SortableTreePanel extracted from page-builder so net cost partially offset). Verify against ceiling at plan-checker.
- `[[feedback_chunked_planning_integration_seam_blindspot]]` — at outline time, name the owner of the wire between `OnboardingFlow.tsx` (existing patient surface) and the new clinic-side builder. Plan 31-05 owns this seam.
- `[[reference_vite_static_env_inlining]]` — if any new `VITE_` env var is added (recommend NONE for P31; the public RPC pattern avoids it).
- `[[reference_supabase_app_metadata_jwt_propagation]]` — 336ms claim propagation window. If `completed_onboarding_at` lives in `app_metadata` (per D-14 alt), polling-skeleton pattern applies.

### External docs (consult via Context7 at research time)
- Postgres `ALTER TYPE ... RENAME VALUE` transactional behavior (D-01).
- `@dnd-kit/core` + `@dnd-kit/sortable` v6+ API surface — sensor activation distance + accessibility coordinates (D-11 SortableTreePanel extraction).
- Supabase Storage public-bucket RLS pattern for path-prefix matching (`object_name LIKE org_id || '/%'`) (D-08).
- WCAG 2.2 contrast ratio formula (relative luminance from sRGB/oklch).
- Supabase Auth `raw_user_meta_data` write via SECDEF (D-14 alt).
- CSS custom property override pattern + `oklch()` browser support fallbacks.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/lib/org.ts`** — `useCurrentOrg()`, `getCurrentOrgId()`, `surfaceCheck(permission)`, `withOrgPath`, `ROLE_PERMISSIONS` const. P31 EXPANDS the matrix to 12 keys (D-03) and ripples the enum rename (D-01). Public exports stay stable; matrix internals grow.
- **`src/components/clinic/RouteOrgGuard.tsx`** — already resolves `/clinic/{slug}` → org context. P31 piggybacks: branding is applied pre-mount (D-07) so the guard doesn't need to know about it; permission gates live inside child pages calling `surfaceCheck`.
- **`src/components/admin/pages/editor/BlockTreePanel.tsx`** — dnd-kit reorder primitives extracted into `src/components/ui/SortableTreePanel.tsx` (D-11). Verifier checks Phase 15 page-builder tests still green after refactor.
- **`src/components/onboarding/OnboardingFlow.tsx`** — existing patient-side monolithic flow. Modified in P31 to branch on `invited_by_org_id` + active `org_onboarding_flows` row (D-10). Existing `DEFAULT_STEPS` constant becomes the consumer-path fallback.
- **`src/components/onboarding/ProgressIndicator.tsx`** — reused as-is across both consumer and org flows.
- **`src/components/clinic/settings/`** — sibling tabs already exist (Workspace, Members, Roles, Audit, ClinicRankingWeights, ClinicDoseTrendThresholds). NEW: `BrandingTab.tsx` + `OnboardingTab.tsx` join the same surface. Plan-checker BLOCKER if these tabs don't gate on `surfaceCheck('branding.edit')` / `surfaceCheck('onboarding.edit')`.
- **`supabase/migrations/20270601100003_org_member_role_enum.sql`** — current enum; P31 Plan 00 migration renames values via `ALTER TYPE`.
- **`supabase/migrations/20270601100006_org_branding_table.sql`** — current 5-column skeleton; P31 Plan 02 migration adds 5 columns + drops `font_family` (renamed to `heading_font` + adds `body_font` etc.).
- **`scripts/lint-stripe-phi.ts` / sibling lint scripts** — pattern target for `scripts/lint-onboarding-no-input-fields.ts` if needed to enforce D-09 "no custom input fields" at CI level (researcher decides).

### Established Patterns
- **Per-action SECDEF + `has_permission()` gate + `log_admin_action`** — Phase 24/28 baseline; all D-13 RPCs follow.
- **Cross-tenant RLS test fixture** — `admin.generateLink + plain fetch /auth/v1/verify`; per-file slug prefix; 2 orgs × 2 users; assertions: SELECT cross-tenant returns 0 rows; INSERT/UPDATE/DELETE cross-tenant fails.
- **Append-only audit + version table** — Phase 24 audit_logs + Phase 30 `org_settings.ranking_weights` history (deferred there; landed here for onboarding flows per D-12).
- **Pre-paint side-effect in main.tsx** — `applyThemeToDOM()` existing pattern; D-07 follows it.
- **Single TS type + single DB validator function** for jsonb shape contracts (Phase 9 `_validate_consent_scope`); D-12 `_validate_onboarding_steps` follows.
- **Strict `<14-digit-timestamp>_<snake_case>.sql` migration filenames** — letter suffixes silently skipped.
- **`set search_path = pg_catalog, public, extensions` on every SECURITY DEFINER** — non-negotiable.
- **Bundle ceilings declared in P24 and tracked in `scripts/assert-clinic-bundle-budget.sh`** — verify+raise if needed at plan-phase.

### Integration Points
- **Plan 31-00 (RECONCILE) — enum rename** — must be Wave 0 prerequisite for every other P31 plan. Touches: `org_member_role` enum + all SECDEF bodies referencing `'admin'`/`'staff'`/`'viewer'` literals + all RLS policies + `src/lib/org.ts` ROLE_PERMISSIONS keys + test fixtures. Atomic transaction (`ALTER TYPE` + `CREATE OR REPLACE` of SECDEF bodies in same migration).
- **`OnboardingFlow.tsx`** — render-time branch added per D-10; consumes new `useOrgOnboardingFlow(invited_by_org_id)` hook in `src/lib/onboarding-builder/`.
- **`<html>` element** — CSS custom properties `--brand-*` set by `applyBrandTokens()` per D-07. Tailwind v4 `@theme {}` block at `src/index.css` adds fallback values reading from these (e.g., `--color-primary: var(--brand-primary, oklch(...))`). Existing Tailwind tokens reference the new variables.
- **`main.tsx`** — pre-mount logic per D-07: slug detect → localStorage warm-paint → async refresh. Order: theme → brand-tokens → hydrate → render.
- **`org_scoped_tables` const in `src/server/with-org-scope.ts`** — P31 adds `org_onboarding_flows`.
- **Phase 24 `audit_logs`** — all D-13 RPCs call `log_admin_action`. New action types: `org_branding.update`, `org_branding.asset_uploaded`, `org_onboarding_flow.save`, `org_onboarding_flow.activate_version`, `org_member.role_changed`.

</code_context>

<specifics>
## Specific Ideas

- Enum rename via `ALTER TYPE org_member_role RENAME VALUE` (Postgres 12+). Single migration; transactional.
- Final `ROLE_PERMISSIONS` matrix shape (12 keys total) — enumerated in D-03 with per-role allocation.
- Brand tokens: ~10 CSS custom properties prefixed `--brand-*` on `<html>`. Stored in `org_branding` table.
- Colors stored as `oklch()` strings; validated server-side; rgb/hex rejected.
- Font selection from curated dropdown (Inter, Fraunces, JetBrains Mono, Lora, IBM Plex Sans) — NOT freeform.
- Radius scale: enum `('sm','md','lg','xl')`.
- WCAG AA enforcement: `text/bg >= 4.5` and `primary/bg >= 3.0`.
- First-paint localStorage cache key: `leanshot_brand_{slug}`.
- Public RPC: `resolve_clinic_branding(p_slug text) returns jsonb` — minimal token blob + alt text.
- Logo + favicon storage: Supabase Storage public bucket `org-branding/{org_id}/{kind}.{ext}`; format PNG/JPG/SVG/ICO; max 500 KB; max 1024×1024 px.
- `OnboardingStepNode` shape verbatim in D-11.
- `StepType` enum: 8 values (welcome, intro_card, medication, goals, body_stats, consent, doctor_invite, tour).
- Locked-mandatory steps: medication, consent.
- Editable-content steps: welcome (title/body), intro_card (title/body/image).
- `org_onboarding_flows` table schema verbatim in D-12; partial unique index `where is_active` enforces one-active-per-org.
- New SECDEFs: `save_org_branding`, `upload_org_branding_asset`, `save_org_onboarding_flow`, `activate_onboarding_flow_version`, `change_member_role`, `resolve_clinic_branding`, `mark_onboarding_complete`, `_compute_wcag_contrast`, `_validate_onboarding_steps`, `_is_org_owner` (renamed from `_is_org_admin`).
- `completed_onboarding_at` location: prefer `auth.users.raw_user_meta_data ->> 'completed_onboarding_at'`; written via SECDEF.
- First-clinic-wins behavior: subsequent invite accepts call `link_org_patient` only; no re-onboarding.
- Audit-action types added: `org_branding.update`, `org_branding.asset_uploaded`, `org_onboarding_flow.save`, `org_onboarding_flow.activate_version`, `org_member.role_changed`.

</specifics>

<deferred>
## Deferred Ideas

- **Subdomain white-label `acme.leanshot.app`** — ORG-07 deferred to v1.5 (carried from Phase 28 deferred list); P31 ships path-based `/clinic/{slug}` only.
- **Full design-token map (~25+ tokens: per-tone shades, spacing scale, shadow tokens)** — likely v1.5 when "enterprise customization" tier emerges. v1.3 ships brand-essentials only.
- **Arbitrary custom CSS escape hatch for clinics** — rejected on a11y/security grounds (XSS via url(), CSS exfiltration). Revisit only if a specific enterprise customer demands.
- **Pre-built onboarding templates ('Weight Loss Focus', 'Bariatric Pre-Op', 'Standard GLP-1')** — rejected in favor of curated library + reorder. Could ship as default `OnboardingFlow` snapshots clinics start from in a future polish phase.
- **Clinic-defined input fields in onboarding (free-form block builder)** — rejected (breaks activation funnel + Phase 34 event taxonomy guarantees). Revisit only after Phase 34 lock-in event ships and a clinic explicitly requests it.
- **Per-(user, org) onboarding completion tracking** (each clinic gets their own onboarding pass) — first-clinic-wins is the v1.3 model. Revisit if dual-clinic patients turn out to be common in v1.4 telemetry.
- **'Second-clinic intro card' surface** when patient accepts a subsequent clinic invite — D-15 ships silent-join. Lightweight intro-card surface deferable.
- **Replay onboarding when clinic publishes a new flow version** (force re-onboarding for existing patients) — disruptive for patients mid-treatment; deferred.
- **Realtime broadcast on `org-{hmac8}-admin` channel when admin actions land** — audit_logs only in v1.3 per D-16. Revisit when helpdesk inbox (P37) lands.
- **Resend email to clinicians on admin changes** — too noisy; deferred indefinitely.
- **Server-side rendering brand tokens at the Vercel Edge** (true zero-FOUT) — D-07 chose pre-mount fetch + localStorage cache as the cheaper path. Revisit if cold-paint FOUT shows up in field testing.
- **RBAC many-to-many member_roles + permissions tables** — Phase 28 D-12 explicit defer to v1.5; this phase ships the const TS matrix + DB function pair.
- **Multi-hat role array per user-in-org** — Phase 28 D-12 explicit defer; v1.3 keeps single-role-per-row.
- **Onboarding-flow A/B testing per clinic** — would belong with P39 paywall A/B trifecta; out of P31 scope.
- **Pre-publish preview of patient onboarding experience** for clinic admin — UI nicety; researcher may recommend if cheap, otherwise defer.
- **Self-service font upload + CSP additions** — curated dropdown only in v1.3.

### Reviewed Todos (not folded)
None — STATE.md "Pending Todos" section is empty.

</deferred>

---

*Phase: 31 — White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder*
*Context gathered: 2026-05-18*
