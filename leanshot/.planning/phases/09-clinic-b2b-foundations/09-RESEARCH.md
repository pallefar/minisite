# Phase 9: Clinic B2B Foundations — Research

**Researched:** 2026-05-12
**Domain:** Multi-tenant clinic workspace (orgs + memberships + invites + roles + permissions) on Supabase Postgres + Edge Functions + Realtime + Storage, with Pitfall #8 single-identity invariant, two-layer revocation, and granular jsonb consent scope.
**Confidence:** HIGH — every load-bearing primary surface (Phase 7/8 audit_logs + GUC suppression hook, Phase 4 Edge Function template, Phase 5/6 sync.ts Realtime pattern, App.tsx selectView, SettingsPage NAV, storage bucket migration, package versions) was read in full. Two MEDIUM-confidence areas flagged: (1) Resend SaaS integration is NEW infrastructure for Phase 9 — `08-CONTEXT.md` references a "Phase 7 transactional template stack" that does NOT exist in code; (2) the existing Phase 5/6 channels use `postgres_changes` but Supabase docs now point at `broadcast` private channels with `realtime.setAuth()` for cross-tenant authorization — Phase 9 should adopt the newer pattern.

## Summary

Phase 9 ships the clinic B2B substrate: an operator creates an org (orgs + slug + logo), invites a patient by email (custom invites table + hashed token + Resend branded email + Supabase Auth signup leg), the patient consents at acceptance with granular per-data-type jsonb scope, and identity stays singular via the canonical Pitfall #8 schema (one `auth.users` per email, memberships is the relationship). The full role system ships in this phase (3 system roles seeded per org via trigger + custom roles + 10-permission grid + `has_permission()` SECURITY DEFINER helper + RLS dispatch). A membership-scoped photo Edge Function mints 5-min signed URLs gated by both operator role permission AND patient consent_scope.photos. Revocation is two-layer (Realtime broadcast for UX + per-request DB check for security floor).

The architecture is **largely a recombination of Phase 4 + Phase 5/6 + Phase 7 + Phase 8 primitives**, with three NET-NEW infrastructure pieces:
1. **Resend SaaS integration** — `08-CONTEXT.md` calls this a "Phase 7 transactional template stack" but **no Resend code exists in the repo today**. Phase 9 must build the integration from scratch (env secret, Edge Function HTTP POST to `api.resend.com/emails`, branded HTML template).
2. **Org-scoped Realtime channels with cross-tenant authorization** — all existing channels filter by `user_id` (the subscriber's own auth.uid). Phase 9 introduces channels filtered by `org_id` where the subscriber is NOT the data owner. This requires Realtime Authorization via `realtime.messages` RLS policies + `setAuth()` + private channels — a NEW pattern in this codebase.
3. **The `has_permission()` SECURITY DEFINER helper** — the single RLS dispatch primitive used by every clinic-scoped surface. Five SQL schemas reference it (memberships, invites, roles, role_permissions, plus org-logos Storage policy + photo Edge Function gate).

**Primary recommendation:** Ten plans across four waves, parallel-eligible per `feedback_parallel_chunked_planning.md` memory. Wave 1 (sequential gate, 1 plan): schema foundation (orgs + memberships + invites + roles + permissions + role_permissions + has_permission helper + audit_logs extension + org-logos bucket + Wave 0 test scaffolds + Pitfall #8 RLS proofs). Wave 2 (parallel, 4 plans): operator workspace UI (clinic chunk), clinic settings + roles admin (clinic-settings chunk), patient invite landing + consent dialog (clinic-invite chunk), patient Active Organizations tab (extends settings chunk). Wave 3 (parallel, 3 plans): invite Edge Function (POST /clinic-invite/{send,accept,reject} + Resend integration), clinic-photo Edge Function (membership + permission + consent gated signed URLs), workspace switcher in app shell (lives in index chunk, deferred-init if budget pressure). Wave 4 (verification gate, 2 plans): Pitfall #8 5-scenario e2e + RLS impersonation proof matrix + revocation latency drill, ROADMAP/REQUIREMENTS sync + 09-VALIDATION traceability sweep.

All net-new migrations carry the four Phase 7 deviation patterns preventively: IMMUTABLE partial-index expressions; SECURITY DEFINER `search_path = public, extensions, pg_catalog`; Storage delete bypass GUC (relevant when deleting org-logos on org-delete); `app.suppress_audit` GUC awareness for cascade deletes (org-delete → memberships → triggers → audit_logs).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (18 — D-01..D-18)

- **D-01:** Custom `invites` table + hashed token. Columns: `id`, `email`, `org_id`, `invited_by`, `invite_token_hash`, `requested_scope` jsonb, `created_at`, `expires_at`, `accepted_at`, `rejected_at`, `consumed_at`. Magic-link URL `app.leanshot.app/clinic-invite/{rawToken}` hashed server-side. Edge Function `POST /clinic-invite/accept` and `POST /clinic-invite/reject` validate hash and branch on `auth.users` email existence. Mirrors Phase 8 D-03 hash-on-disk + token-in-URL pattern verbatim.

- **D-02:** No pre-check on operator email entry. Operator UI always shows "Invite sent" regardless of email's LeanShot account status. Edge Function `/clinic-invite/accept` does the `auth.users` lookup at acceptance time and branches existing-user vs new-user. Prevents email enumeration.

- **D-03:** Pitfall #8 matrix verification in CI. (a) e2e Playwright: 5 specs — existing-personal-user-invited, no-personal-user-invited, existing-personal-user-with-2-invitations-different-orgs, invited-but-never-accepts, accepts-then-rejects. Each asserts data visibility per consent_scope AND single auth.users row per email at end. (b) pgTAP RLS impersonation on memberships, orgs, invites, roles, permissions, role_permissions, org-logos bucket, clinic-scoped data RLS surfaces.

- **D-04:** Granular per-data-type checkboxes in consent dialog. Stored as `memberships.consent_scope` jsonb. 10 keys: injections, weights, photos, symptoms, meals, workouts, supplements, mood, sleep, doctor_report. Operator's invite includes `requested_scope` jsonb that pre-checks the dialog; patient can uncheck before accepting.

- **D-05:** Full exposable data set including photos. Excluded: `ai_messages` (Phase 4/8 privacy guarantee — same structural exclusion at SQL layer for clinic data read paths). Photos require new clinic-scoped signed-URL Edge Function (D-12). Operator-visible types: injections, weights, photos, symptoms, meals, workouts, supplements, mood, sleep, doctor_report + live drug-level chart computed from injections.

- **D-06:** Patient can edit `consent_scope` from Settings → Active organizations → row → edit checkboxes. Update is immediate row UPDATE. Every scope change writes an `audit_logs` row (extends Phase 8 D-04 — new `actor_type='org_member'` value, populates new `org_id` column).

- **D-07:** Full role system in Phase 9. Schema: `roles` (id, org_id, name, description, is_system, created_at), `permissions` (key, description — GLOBAL not per-org), `role_permissions` (role_id, permission_key), `memberships.role_id` FK. Trigger on orgs INSERT seeds 3 system rows (Owner, Coach, View-only). 10 initial permission keys: org.read, org.update, org.delete, members.invite, members.revoke, members.list, roles.manage, patient_data.read, patient_photos.read, audit_log.read. View-only seeded with org.read + members.list + patient_data.read. Coach adds patient_photos.read. Owner has all. RLS policies call `has_permission(member_user_id, org_id, permission_key)` SECURITY DEFINER helper with `extensions` in search_path. Admin UI at `/clinic/{slug}/settings/roles`. ROADMAP/REQUIREMENTS update required: CLINIC-06 absorbed; CLINIC-07 split (capture in Phase 9, surface UI in Phase 10).

- **D-08:** Operator lands at `/clinic/{slug}` after org-create. Workspace home is empty roster shell with prominent "Invite patient" CTA. Settings at `/clinic/{slug}/settings` with tabs: Workspace / Roles / Members.

- **D-09:** Top bar on every `/clinic/{slug}/*` route shows org name + logo (uploaded via new `org-logos` Storage bucket, public-read) + workspace switcher dropdown. Switcher: `Personal account` (always top), `Memberships`, `Workspaces I run`. One `auth.users` → N contexts.

- **D-10:** Two-layer revocation. (Layer 1 — Realtime broadcast) operator workspace home subscribes to channel filtered by `org_id` for memberships UPDATE/DELETE; on revoke (revoked_at set), broadcast removes row within ~100-300ms. Patient-side Active organizations subscribes filtered by `user_id`. (Layer 2 — Per-request DB check) every operator drill-in hits Edge Function that re-reads `memberships.revoked_at` AND `consent_scope` for (user_id, org_id). Phase 8 D-02 primitive applied verbatim. 401 if revoked or scope insufficient.

- **D-11:** Drill-in failure mode on revoke: hard 401 + toast "Patient X revoked access" + route back to `/clinic/{slug}`. No grace period, no cached data display. Matches Phase 8 SC#3.

- **D-12:** Membership-scoped signed-URL Edge Function `GET /clinic-photo/{orgId}/{userId}/{photoId}` checks: (a) operator is active member of orgId (`memberships.revoked_at IS NULL`), (b) operator's role has `patient_photos.read` via `has_permission()`, (c) patient's `memberships.consent_scope.photos = true` AND `revoked_at IS NULL`, then mints `supabase.storage.from('photos').createSignedUrl(path, 300)`. Returns 401/403 on failure.

- **D-13:** Signed-URL TTL = 5 minutes. Stale-URL window for newly-loaded photos is ~5 min worst case post-revoke. Re-mint on every photo request considered but rejected on Edge Function cost. Explicit Phase 9 tradeoff.

- **D-14:** Single switcher grouped by relationship: Personal account → Memberships → Workspaces I run. Each row shows context label + role badge. Selecting routes to context's home.

- **D-15:** Patient-side "Active organizations" tab — new SettingsPage NAV entry parallel to Privacy / Recovery / Data / Active shares (Phase 8). Each row: org name + logo, role, joined_at, consent_scope (clickable → edit modal), Revoke button.

- **D-16:** Dual-email design. Resend handles branded "Clinic X invited you" email (carries Phase 7 transactional template stack — same `noreply@app.leanshot.app` sender, WMHMDA footer carry-forward, clinic logo + org name). Supabase Auth handles signup verification for new users (default magic-link). Three branches: logged-in user → consent; logged-out existing user → magic-link sign-in → consent; new user → signup form → confirmation email → consent. **[ASSUMED]** "Phase 7 transactional template stack" exists — verified by grep: it does NOT yet exist in code; Phase 9 must build the Resend integration from scratch.

- **D-17:** Invitation expiry = 7 days. `invites.expires_at = created_at + 7 days`. Operator UI surfaces expired invites with "Re-send" action creating a fresh invites row + new token (old row retained for audit).

- **D-18:** Invite lifecycle preserved as audit trail. On acceptance: `invites.accepted_at` + `consumed_at` set; `memberships.invited_from_invite_id` FKs back; `invites.consent_scope_at_acceptance` jsonb snapshot frozen at acceptance — separate from `memberships.consent_scope` which is mutable.

### Claude's Discretion (5 items)

- `orgs` table schema details beyond load-bearing (id, slug, name, logo_storage_path, owner_user_id, created_at). Add `description`, `website_url` if useful.
- Slug uniqueness rules + reserved-words list. Recommend: globally unique, lowercased, kebab-case, max length 60, reserved blocklist (`api`, `auth`, `settings`, `admin`, `app`, `clinic`, `legal`, etc.).
- MVP slice ordering across ~10 plans. SPIDR. See **Recommended Wave Plan** below.
- Org-deletion + operator-offboarding semantics — DEFERRED gray area. Planner specs minimal default: org delete cascades memberships, patients notified via email + audit row + Active-orgs UI removes row; owner-removing-self requires ownership transfer OR explicit delete-org.
- BAA/HIPAA disclosure language at consent — DEFERRED, counsel-led. Placeholder copy + `[COUNSEL REVIEW NEEDED]` marker in ConsentDialog code.
- Realtime channel broadcast scope + cost. Recommend per-`org_id` channel for operator surface (one channel per active org); per-`user_id` for patient surface.

### Deferred Ideas (OUT OF SCOPE for Phase 9)

- Roster ranking + `rankPatients(orgState)` (Phase 10)
- Drill-in via SHARE-02 component reuse (Phase 10)
- Operator audit-log surface for patients + org owner UI (Phase 10)
- Doctor accounts (SHARE-V2-01) — vNext
- EHR integration — out of v1
- Billing / seat scaffold — not v1
- BAA / HIPAA business-associate sign-up — counsel-led, tracked separately
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLINIC-01 | Clinic operator can sign up and create an organization workspace | §Standard Stack (`orgs` table + slug-derive + Storage `org-logos` bucket); §Architecture Patterns (OrgCreateFlow + SECURITY DEFINER `create_org` RPC); §Code Examples (orgs schema + slug uniqueness + system-roles seed trigger) |
| CLINIC-02 | Operator can invite a patient by email; one `auth.users` per email, memberships is the relationship table | §Standard Stack (`invites` + hashed token + Resend SaaS); §Architecture Patterns (Pattern 2 invitation state machine); §Common Pitfalls (Pitfall #8 5-scenario matrix); §Validation Architecture (e2e + pgTAP impersonation) |
| CLINIC-03 | Patient explicitly consents at acceptance with scope visible (which fields, revocation path) | §Standard Stack (`memberships.consent_scope` jsonb); §Architecture Patterns (ConsentDialog + accept Edge Function); §Code Examples (consent insert + audit row) |
| CLINIC-06 | Three roles: Owner, Coach, View-only | §Standard Stack (`roles` + `permissions` + `role_permissions` + `has_permission()` helper); §Code Examples (system-roles seed trigger + permission grid); §Architecture Patterns (RLS dispatch via has_permission); §Validation Architecture (custom-role + permission RLS pgTAP) |
| CLINIC-07 (capture half) | Audit-log capture infrastructure — every revoke/scope-change/permission-check writes an `audit_logs` row; org-owner UI surface is Phase 10 | §Standard Stack (audit_logs extension: `actor_type='org_operator'` and `'org_member'` enum values + nullable `org_id` column); §Code Examples (log_membership_change RPC + has_permission audit hook) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **TS strict** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. `s.user!` non-null assertion FORBIDDEN; clinic surfaces must not reintroduce it. New clinic chunk components own local state and read `useStore` only where the typed selector resolves through `signedIn.user`-style narrowing.
- **Local-first must keep working** — clinic chunks are additive; patient-side cloud sync continues independent. Patient's personal data RLS unaffected; clinic surfaces use the cross-tenant projection via `has_permission()`, not direct table reads.
- **Bundle-size discipline** — index gz ≤ 50 kB (currently 21.49 kB at Phase 7/8 close per memory). WorkspaceSwitcher adds ~3 kB to index (per UI-SPEC budget); if over budget, defer-init via `sync-defer.ts` pattern from Phase 6 Plan 06-01. clinic / clinic-settings / clinic-invite are lazy chunks (12 kB / 14 kB / 6 kB budgets).
- **No third-party trackers** — no PostHog/Sentry calls in clinic-invite or operator drill-in surfaces beyond existing global initialization.
- **GSD workflow enforcement** — no direct repo edits outside a GSD workflow.
- **Parallel-executor pathspec rule** — Phase 9 has 10+ plans; every commit MUST use `git commit -- <pathspec>` per `feedback_parallel_executor_git_isolation.md`.
- **Project skill: project_phase5_bundle_regression.md** — heavy SDKs routed through `sync-defer.ts`; static imports in App.tsx/main.tsx/store.ts are CI-blocked. Resend SDK MUST be Edge-Function-only (Deno fetch to `api.resend.com/emails`), not imported into the SPA bundle.
- **Project skill: reference_supabase_project.md** — every RLS surface (table OR Storage bucket) gets a live cross-tenant impersonation proof test. Applies in Phase 9 to: orgs, memberships, invites, roles, role_permissions, permissions, org-logos bucket, plus the `has_permission()` helper used by clinic-photo Edge Function.
- **Project skill: reference_supabase_migration_gotchas.md** — (1) IMMUTABLE partial indexes (no `now()` in WHERE); (2) SECURITY DEFINER `search_path = public, extensions, pg_catalog`; (3) Storage delete bypass `set_config('storage.allow_delete_query', 'true', true)` for org-logo deletion on org-delete; (4) `app.suppress_audit` GUC awareness when cascade DELETE on org → memberships fires audit_trigger.
- **Project skill: reference_deno_test_discovery.md** — new edge-function deno tests must use `<name>.test.ts` (not `<name>-test.ts`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Org-create + slug uniqueness check + logo upload | API / Backend (Postgres SECURITY DEFINER `create_org` RPC + Storage upload) | Browser (RPC invocation + file picker) | Slug uniqueness is a race; must be atomic INSERT with unique constraint, not a SELECT-then-INSERT. RPC returns canonical org row + signed-upload URL. |
| Invitation send (hash + insert + Resend email dispatch) | API / Backend (Edge Function `/clinic-invite/send`) | Database (insert) + 3rd-party (Resend HTTPS) | Raw token must never round-trip through client RNG; hashed in the same atomic INSERT; Resend dispatch is server-only (API key in Edge Function secret). |
| Invitation accept (`auth.users` lookup + branch + membership insert + consent_scope_at_acceptance freeze) | API / Backend (Edge Function `/clinic-invite/accept`) | Database (RPC) | The auth.users existence check is the Pitfall #8 D-02 anti-enumeration boundary; lookup is server-side only. The membership insert + audit row + invite consumed_at must be one transaction. |
| Invitation reject | API / Backend (Edge Function `/clinic-invite/reject`) | Database (UPDATE) | Mirrors accept; records rejected_at; no membership row created. |
| Consent dialog (10 checkboxes + accept + decline) | Browser / Client (ConsentDialog lazy chunk) | API (Edge Function POST) | Pure render + form state; checkbox state is local until accept is clicked, then sent server-side as `consent_scope` jsonb. |
| Active organizations list + edit scope + revoke | Browser / Client (ActiveOrganizationsSection) | Database (RLS-scoped SELECT + UPDATE on memberships) | Patient owns own memberships rows; standard RLS `auth.uid() = user_id` policy gates SELECT/UPDATE; revoke is `update memberships set revoked_at = now()`. |
| Workspace switcher (Personal + Memberships + Workspaces I run) | Browser / Client (WorkspaceSwitcher in index chunk) | API (RLS-scoped SELECT `memberships` + `orgs` JOINs) | Lives in app shell so visible on every authenticated route per D-09/D-14; reads via two RLS-scoped queries (memberships where user_id=auth.uid; orgs where owner_user_id=auth.uid). |
| Operator workspace home + roster (Phase 9 = empty shell) | Browser / Client (ClinicWorkspace lazy chunk) | Realtime (operator-side org_id-filtered channel) | Phase 9 ships the empty-state shell with Invite CTA; Phase 10 fills the roster. Realtime subscription is set up here so revoke-broadcast works in Phase 9. |
| Clinic settings → Workspace tab | Browser / Client (WorkspaceTab) | API (RLS-scoped UPDATE orgs + Storage replace logo) | Owner-gated by `has_permission(uid, org_id, 'org.update')`; logo upload via Storage RLS on `org-logos/{org_id}/*` (operator-write, public-read). |
| Clinic settings → Members tab | Browser / Client (MembersTab) | Realtime + API | Lists active members + pending invites; revoke and cancel-invite calls write to memberships / invites with audit row. |
| Clinic settings → Roles tab + custom-role CRUD | Browser / Client (RolesTab + RoleEditorModal) | API (RLS-scoped INSERT/UPDATE/DELETE on roles + role_permissions) | Gated by `has_permission(uid, org_id, 'roles.manage')`; system roles non-deletable; member-reassignment-to-View-only on custom-role delete handled by SECURITY DEFINER RPC `delete_role`. |
| Clinic-scoped photo access | API / Backend (Edge Function `/clinic-photo/{orgId}/{userId}/{photoId}`) | Database (RLS) + Storage (signed URL mint) | Three-check gate: membership active + role permission + patient consent_scope.photos. Service-role mints 5-min signed URL on `photos` bucket — same physical bucket as patient's own access, gated by cross-tenant projection. |
| `has_permission()` RLS dispatch helper | Database (SECURITY DEFINER plpgsql) | Edge Function (calls via RPC) | Single source of truth for "does X have permission Y in org Z?"; called from RLS policies on memberships/roles/role_permissions AND from Edge Function gates. |
| Realtime org-scoped channels (operator surface) | Database (broadcast via realtime.broadcast_changes trigger) | Browser / Client (subscribe with `realtime.setAuth()` + RLS on realtime.messages) | NEW PATTERN in this codebase. Cross-tenant subscribe requires Realtime Authorization — RLS policy on `realtime.messages` JOIN `memberships` ensures only members of org_id receive that channel's broadcasts. |
| Audit-log capture for revoke / scope-change / permission-check | Database (SECURITY DEFINER RPCs that INSERT audit_logs) | — | Extends Phase 7/8 audit_logs (new actor_type values, new org_id nullable column); writes inline from `revoke_membership`, `update_consent_scope`, and on-demand from `has_permission()` calls flagged for audit (debate: write every call? or only writes?). |

## Runtime State Inventory

> Phase 9 is greenfield in terms of new schema (orgs/memberships/invites/roles/permissions/role_permissions, `org-logos` Storage bucket, has_permission helper). It is additive in terms of `audit_logs` columns and enum values. There is no rename/refactor angle for existing data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — all schema is new. Existing `auth.users`, `audit_logs`, `photos` table, `photos` Storage bucket are READ-ONLY references from new code paths. | None |
| Live service config | None — no external service configurations (Datadog, Tailscale, etc.) reference clinic primitives. **NEW:** Phase 9 must add Resend account + DNS records (SPF/DKIM for `noreply@app.leanshot.app`) + add `RESEND_API_KEY` to Supabase secrets. Phase 7 follow-up: revoke outstanding shares on `initiate_account_deletion` (per Phase 8 Pitfall 6) is unrelated to Phase 9. | New Resend DNS + secret setup (deferred to deploy-side checklist; Edge Function code reads `Deno.env.get('RESEND_API_KEY')`) |
| OS-registered state | None | None |
| Secrets / env vars | NEW: `RESEND_API_KEY` (Supabase Edge Function secret). No existing env vars renamed. | Add via `supabase secrets set RESEND_API_KEY=...` during deploy checklist |
| Build artifacts / installed packages | None — Resend SDK is NOT installed in the SPA (per bundle-size constraint); Edge Function uses `fetch('https://api.resend.com/emails')` directly. No npm packages added. | None |

**Migration ordering:** load-bearing. The recommended order:

1. `20260801000001_audit_logs_org_columns.sql` — extend audit_logs: new enum values `'org_operator'`, `'org_member'` on `audit_actor_type`; add `org_id uuid` nullable column (FK added in step 4 after orgs exists); extend `action` check constraint with `'org_create'`, `'org_update'`, `'org_delete'`, `'membership_invite_sent'`, `'membership_invite_accepted'`, `'membership_invite_rejected'`, `'membership_revoked'`, `'membership_scope_updated'`, `'role_created'`, `'role_updated'`, `'role_deleted'`, `'permission_denied'`.
2. `20260801000002_orgs.sql` — orgs table + RLS + slug unique index + reserved-word check + Realtime publication membership.
3. `20260801000003_org_logos_storage.sql` — org-logos Storage bucket (public-read; operator-write via has_permission); folder layout `org-logos/{org_id}/logo.{ext}`.
4. `20260801000004_audit_logs_org_fk.sql` — `alter table audit_logs add foreign key (org_id) references orgs(id) on delete set null`.
5. `20260801000005_permissions.sql` — global permissions table + seed 10 keys + grant-only-select to authenticated.
6. `20260801000006_roles.sql` — roles table + RLS + role_permissions junction + RLS.
7. `20260801000007_memberships.sql` — memberships table + RLS + Realtime publication + consent_scope jsonb + unique constraint on (user_id, org_id).
8. `20260801000008_invites.sql` — invites table + RLS + token_hash unique index + IMMUTABLE partial index `WHERE accepted_at IS NULL AND rejected_at IS NULL`.
9. `20260801000009_has_permission_fn.sql` — SECURITY DEFINER plpgsql with `search_path = public, extensions, pg_catalog`; joins memberships → roles → role_permissions; returns boolean.
10. `20260801000010_seed_system_roles_trigger.sql` — AFTER INSERT trigger on orgs that inserts 3 system roles + their role_permissions rows.
11. `20260801000011_clinic_rpcs.sql` — SECURITY DEFINER RPCs: `create_org`, `update_org`, `delete_org` (cascades with audit suppress GUC + storage delete bypass), `send_invite`, `accept_invite_existing`, `accept_invite_new`, `reject_invite`, `update_consent_scope`, `revoke_membership`, `create_role`, `update_role`, `delete_role` (member reassignment to View-only), `log_clinic_event` (audit insert helper).
12. `20260801000012_realtime_messages_rls.sql` — RLS on `realtime.messages` for clinic broadcast topics: operator-side `topic = 'org:' || org_id` only allowed if `has_permission(auth.uid(), org_id, 'org.read')`; patient-side `topic = 'user:' || auth.uid()` allowed unconditionally for own user_id.
13. `20260801000013_broadcast_membership_changes_trigger.sql` — AFTER INSERT/UPDATE/DELETE trigger on memberships that calls `realtime.broadcast_changes('org:' || org_id, ...)` AND `realtime.broadcast_changes('user:' || user_id, ...)`.

**Nothing found** for OS-registered state, secrets/env (other than the new Resend key), or build artifacts. Verified by inspecting `supabase/migrations/`, `supabase/functions/`, and grepping leanshot/ for renamed identifiers.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.105.4 | RLS-scoped client (browser) + service-role admin client (Edge Function) | `[VERIFIED: leanshot/package.json]` Existing dep; Phase 4–8 baseline. |
| Deno (Supabase Edge Runtime) | bundled | Edge Function runtime for `/clinic-invite/*` and `/clinic-photo/*` | `[VERIFIED: supabase/functions/ai-chat/]` Template reused. Local Deno 2.7.14 confirmed. |
| Postgres `pgcrypto` | bundled | `digest()` (sha256 token hash), `gen_random_bytes()` (token gen), `gen_random_uuid()` (org_id/role_id) | `[VERIFIED: supabase/migrations/20260601000001_audit_logs.sql:41]` Already `create extension if not exists pgcrypto`. |
| Supabase Storage (`org-logos` bucket) | bundled | Operator-uploaded clinic logos (public-read, non-PHI) | `[CITED: supabase.com/docs/guides/storage]` Phase 6 photos bucket migration template re-applied with `public=true` + 2 MB limit + PNG/JPEG only. |
| Supabase Realtime (private channels + broadcast) | bundled | Org-scoped revoke broadcast to operator; user-scoped revoke broadcast to patient | `[CITED: supabase.com/docs/guides/realtime/getting_started]` NEW PATTERN — Supabase deprecated `postgres_changes` in favor of `broadcast` with `realtime.broadcast_changes` SECURITY DEFINER trigger + `realtime.messages` RLS for authorization + `realtime.setAuth()` on client. |
| Resend API (HTTPS only — no SDK in bundle) | n/a | Branded transactional invite email | `[CITED: resend.com/docs/api-reference/emails/send-email]` `POST https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`. **NET-NEW INFRASTRUCTURE** — no existing Resend integration in code (verified by grep across `supabase/functions/` and `leanshot/src/`); CONTEXT.md D-16's "Phase 7 transactional template stack" is aspirational. |
| Supabase Auth (`signInWithOtp`, `signUp`, `getUser`) | via supabase-js | Invite-acceptance branching (State C magic-link sign-in; State D new-user signup) | `[VERIFIED: leanshot/src/lib/auth.ts]` Existing auth helpers; reuse `supabase.auth.signInWithOtp({email})` and `supabase.auth.signUp({email, password})` patterns. |
| `@playwright/test` | ^1.59.1 | E2E (Pitfall #8 5-scenario matrix + revoke latency drill + happy-path) | `[VERIFIED: leanshot/package.json]` Existing. |
| `vitest` | ^4.1.5 | Unit + RLS cross-tenant proof via `vitest-e2e.config.ts` | `[VERIFIED: leanshot/vitest-e2e.config.ts]` `e2e/rls-*.test.ts` glob already wired. |
| `lucide-react` | ^0.460.0 | Icons for clinic chrome (Building2, Users, Shield, ShieldCheck, KeyRound, ChevronsUpDown, Mail, UserPlus, etc.) | `[VERIFIED: leanshot/package.json]` Existing. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Deno `std/http/cookie` | jsr | Not used in Phase 9 — clinic-invite and clinic-photo Edge Functions are JWT-authed (operator side) and stateless on accept (patient side). No HttpOnly cookie binding required (unlike Phase 8 share which has no JWT). | — |
| Postgres `realtime.broadcast_changes()` | bundled | Server-side trigger function that broadcasts INSERT/UPDATE/DELETE on memberships to two topics: `org:{org_id}` and `user:{user_id}` | Used inside an AFTER INSERT/UPDATE/DELETE SECURITY DEFINER trigger on memberships. `[CITED: supabase.com/docs/guides/realtime/subscribing-to-database-changes]` |
| Edge Function rate-limit pattern | `supabase/functions/ai-chat/rate-limit.ts` | Adapt for per-org per-hour invite rate limit (e.g., 20/hour) and per-token attempt rate limit on `/clinic-invite/accept` (5/min) | `[VERIFIED: supabase/functions/ai-chat/rate-limit.ts]` Reuse the `increment_rate_limit` RPC shape with a new key prefix `'clinic_invite_send_' || org_id` and `'clinic_invite_accept_' || invite_id`. |
| `jspdf` + `jspdf-autotable` | ^4.2.1 / ^5.0.7 | Not used in Phase 9 — drill-in PDF is Phase 10 | `[VERIFIED: leanshot/package.json]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `invites` table + hashed token + Resend (D-01) | Supabase Auth `admin.inviteUserByEmail()` | Rejected by D-01 — Supabase invite is opinionated about user-creation (auto-creates a row in `auth.users` before consent), which collides with the Pitfall #8 anti-enumeration invariant (D-02) and "no guest variants" rule. Custom table also lets us preserve invite history per D-18. |
| Resend SaaS for transactional email | Supabase Auth email (default SMTP) | Supabase Auth handles the SIGNUP confirmation leg (D-16 State D). Branded invite email + WMHMDA footer + clinic logo + dynamic org name CAN'T be sent via Supabase Auth — it's a custom template. Resend is the lowest-cost branded option (free tier: 100 emails/day, $20/month = 50k emails for paid). |
| Realtime `postgres_changes` (existing pattern) | Realtime `broadcast` with `realtime.broadcast_changes` trigger + `realtime.messages` RLS (private channels + `setAuth()`) | **Adopt new pattern.** `[CITED: supabase.com/docs/guides/getting-started/ai-prompts/use-realtime]` Supabase is migrating off `postgres_changes`. For Phase 9's cross-tenant subscribe (operator listens to `org:{org_id}` where they are NOT the data owner), `postgres_changes` would require granting SELECT on memberships across tenants — defeats RLS. Broadcast + RLS on `realtime.messages` keeps the gate at the channel-authorize step. |
| `has_permission()` SECURITY DEFINER helper | Per-table RLS policy joining memberships+roles+role_permissions inline | Helper consolidates the join logic; one place to harden. Inline per-table policies would duplicate the join in 6+ policies (memberships, roles, role_permissions, plus future Phase 10 surfaces). Helper is also callable from Edge Functions and UI components (via service-role admin client) for "can I see this button?" checks. |
| Membership role via `memberships.role_id` FK | Inline role-string on memberships | FK keeps role names rename-able; supports custom roles per D-07. Role_id is also the join key for `has_permission()`. |
| Photo Edge Function mints signed URL per photo (D-12) | Pre-mint all photo URLs in drill-in snapshot | Rejected by D-13 cost analysis — drill-in might show 50+ photos; pre-minting is 50× signed-URL operations vs lazy on-render. Lazy is also more aligned with the 5-min TTL — only photos the operator actually views consume signed-URL operations. |
| Operator-side broadcast topic per org (`org:{org_id}`) | Per-membership broadcast topic per (org_id, user_id) | Per-org channel: O(orgs) subscriptions for an operator (worst case ~5). Per-membership: O(members) — operators in a 100-patient clinic would have 100 channels. Per-org wins on cost; row identification happens in the broadcast payload, not the topic. |

**Installation:** No new top-level dependencies on the SPA side. Edge Functions add the Resend HTTPS dispatch (no SDK install — bare `fetch`).

**Version verification (run before plan-phase finalizes):**
```bash
npm view @supabase/supabase-js version          # confirm 2.105.4 still current
# Resend has no SDK to verify — HTTPS endpoint api.resend.com/emails is the contract
```

`[VERIFIED: package.json read 2026-05-12]` `@supabase/supabase-js ^2.105.4`, `@playwright/test ^1.59.1`, `vitest ^4.1.5`, `lucide-react ^0.460.0`, `framer-motion ^11.11.17`, `react ^19.0.0`, `chart.js ^4.4.6`.

## Architecture Patterns

### System Architecture Diagram

```text
═══════════════════════════════════════════════════════════════════════════════
OPERATOR FLOW                                            PATIENT FLOW
═══════════════════════════════════════════════════════════════════════════════

Operator (signed in)                                     Patient (signed in OR not)
  │                                                        │
  │ 1. POST RPC create_org(name, slug, logo_path)          │
  ▼                                                        │
[Postgres SECURITY DEFINER create_org()]                   │
  │ INSERT orgs                                            │
  │ TRIGGER seeds 3 system roles + role_permissions        │
  │ INSERT memberships (Owner role for creator)            │
  │ → AUDIT row: org_create                                │
  │ returns orgs row                                       │
  │                                                        │
  ▼                                                        │
Operator routes to /clinic/{slug}                          │
ClinicWorkspace lazy chunk mounts                          │
ClinicContextBar shows org logo + name                     │
                                                           │
WorkspaceSwitcher (in index chunk):                        │
   • Personal account (always)                             │
   • Memberships (patient-side rows)                       │
   • Workspaces I run (operator-side rows)                 │
                                                           │
  │ 2. Operator clicks "Invite patient"                    │
  │    InvitePatientModal: email + scope-preselect         │
  │ POST /functions/v1/clinic-invite/send                  │
  ▼                                                        │
[Edge Function /clinic-invite/send]                        │
  │ rate-limit: 20/hour/org via                            │
  │   increment_rate_limit('clinic_invite_send:' || org_id)│
  │ validate operator is active member +                   │
  │   has_permission(uid, org_id, 'members.invite')        │
  │ generate token: gen_random_bytes(16) → base64url       │
  │ INSERT invites (token_hash = sha256(token),            │
  │   email, org_id, invited_by, requested_scope,          │
  │   expires_at = now() + 7d)                             │
  │ → AUDIT row: membership_invite_sent                    │
  │ POST https://api.resend.com/emails {                   │
  │   from: 'noreply@app.leanshot.app',                    │
  │   to: email,                                           │
  │   subject: '{org name} invited you...',                │
  │   html: render(branded_template,                       │
  │     {org_name, org_logo_url, operator_name,            │
  │      invite_url: '.../clinic-invite/' + token})        │
  │ }                                                      │
  ▼                                                        │
  Returns 200 to operator                                  │
                                                           │
Operator UI shows                                          Patient receives Resend email
"Invitation sent" universally                              "{org} invited you to share..."
(D-02 anti-enumeration: no email-existence       ────────► [Click "Review invitation"]
 inference possible)                                       Lands at /clinic-invite/{token}
                                                           ClinicInvitePage lazy chunk mounts
                                                            │
                                                            │ 3. GET /functions/v1/clinic-invite/lookup?token=...
                                                            ▼
                                                          [Edge Function /clinic-invite/lookup]
                                                            │ hash token, SELECT invites
                                                            │ branch on state:
                                                            │   expired → state E
                                                            │   accepted_at|rejected_at set → state F
                                                            │   consumed_at + canceled → state G
                                                            │   valid + auth.getUser() returns user → state B
                                                            │   valid + null + auth.users has email → state C
                                                            │   valid + null + no auth.users row → state D
                                                            ▼
                                                          [State B/C/D rendered by ClinicInvitePage]
                                                          
                                                          State B (logged-in user):
                                                            ConsentDialog with checkboxes
                                                            pre-checked per requested_scope
                                                          State C (logged-out existing user):
                                                            "Sign in to continue" + magic link
                                                            supabase.auth.signInWithOtp({email})
                                                            → email → click → return to URL → state B
                                                          State D (new user):
                                                            Signup form (email + password)
                                                            supabase.auth.signUp({email, password})
                                                            → confirmation email → click → return → state B
                                                            
                                                            │ 4. Patient unchecks unwanted scope, clicks Accept
                                                            │ POST /functions/v1/clinic-invite/accept
                                                            │   {token, consent_scope}
                                                            ▼
                                                          [Edge Function /clinic-invite/accept]
                                                            │ hash token, SELECT invites (must be valid)
                                                            │ rate-limit: 5/min/invite_id
                                                            │ validate auth.getUser() returns user
                                                            │   match invites.email (case-insensitive)
                                                            │ INSERT memberships (user_id, org_id,
                                                            │   role_id=View-only-default, consent_scope,
                                                            │   invited_from_invite_id, joined_at=now())
                                                            │ UPDATE invites SET accepted_at=now(),
                                                            │   consumed_at=now(),
                                                            │   consent_scope_at_acceptance=$consent_scope
                                                            │ → AUDIT row: membership_invite_accepted
                                                            │ TRIGGER broadcasts on memberships INSERT to:
                                                            │   org:{org_id}  → operator's roster sees it
                                                            │   user:{user_id} → patient's Active orgs sees it
                                                            ▼
                                                          ConsentDialog → "You're connected" state
                                                            
═══════════════════════════════════════════════════════════════════════════════
REVOCATION FLOW (D-10 two-layer)                         CLINIC-SCOPED PHOTO ACCESS (D-12)
═══════════════════════════════════════════════════════════════════════════════

Patient → Settings → Active organizations →              Operator → drill-in (Phase 10 builds the rest)
  Revoke membership                                        renders <ClinicPhoto orgId userId photoId />
  │                                                        │
  │ PATCH memberships set revoked_at=now()                  │ GET /clinic-photo/{orgId}/{userId}/{photoId}
  │ → AUDIT row: membership_revoked                         ▼
  │ TRIGGER broadcasts on memberships UPDATE to:          [Edge Function /clinic-photo]
  │   org:{org_id}, user:{user_id}                          │ validate JWT → operator user_id
  ▼                                                        │ SELECT memberships
  Patient sees "Membership revoked" toast                  │   WHERE user_id=operator AND org_id=$orgId
                                                           │     AND revoked_at IS NULL
Operator's already-subscribed channel                      │ has_permission(operator, orgId, 'patient_photos.read')
  org:{org_id} receives UPDATE event                       │ SELECT memberships
  Roster row animates out within ~100-300ms                │   WHERE user_id=$userId AND org_id=$orgId
  Toast: "{patient} is no longer a member"                 │     AND revoked_at IS NULL
                                                           │     AND consent_scope->>'photos' = 'true'
LAYER 2 (security floor):                                  │ SELECT photos WHERE user_id=$userId AND photo_id=$photoId
Operator's next drill-in fetch hits Edge Function          │ → AUDIT row: clinic_photo_view (actor_type=org_operator)
  GET /clinic-photo/... → 401 revoked                      │ storage.from('photos').createSignedUrl(path, 300)
  UI shows hard-401 toast +                                ▼
  routes back to /clinic/{slug}                            Returns 200 {signedUrl} OR 401/403
```

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── components/
│   │   ├── clinic/                            # NEW — `clinic` lazy chunk root
│   │   │   ├── ClinicWorkspace.tsx
│   │   │   ├── ClinicContextBar.tsx
│   │   │   ├── OrgCreateFlow.tsx
│   │   │   ├── InvitePatientModal.tsx
│   │   │   └── settings/                      # NEW — `clinic-settings` lazy chunk root
│   │   │       ├── ClinicSettingsPage.tsx
│   │   │       ├── WorkspaceTab.tsx
│   │   │       ├── MembersTab.tsx
│   │   │       ├── RolesTab.tsx
│   │   │       └── RoleEditorModal.tsx
│   │   ├── clinic-invite/                     # NEW — `clinic-invite` lazy chunk root
│   │   │   ├── ClinicInvitePage.tsx
│   │   │   ├── ConsentDialog.tsx
│   │   │   └── InviteSignupForm.tsx
│   │   ├── layout/
│   │   │   └── WorkspaceSwitcher.tsx          # NEW — lives in index chunk per UI-SPEC budget
│   │   └── dashboard/settings/
│   │       ├── ActiveOrganizationsSection.tsx # NEW — rides existing settings chunk
│   │       └── EditConsentScopeModal.tsx      # NEW — rides existing settings chunk
│   ├── lib/
│   │   ├── clinic.ts                          # NEW — typed wrappers over RPCs (create_org, send_invite, accept_invite, revoke_membership, update_consent_scope, role CRUD)
│   │   ├── clinic-realtime.ts                 # NEW — subscribe/unsubscribe to org:{id} and user:{id} broadcast channels (uses realtime.setAuth() + private channels)
│   │   └── clinic-permissions.ts              # NEW — client-side has_permission caching (purely UX hint; SERVER is the security gate)
│   └── types/
│       └── clinic.ts                          # NEW — Org, Membership, Invite, Role, Permission, ConsentScope types

supabase/
├── functions/
│   ├── clinic-invite/                         # NEW — Edge Function (single function, 4 endpoints: send, lookup, accept, reject)
│   │   ├── index.ts                           # Deno.serve; routes /send + /lookup + /accept + /reject
│   │   ├── cors.ts                            # Echo-Origin CORS (no cookie credentials — pure JWT/no-auth)
│   │   ├── resend.ts                          # HTTPS fetch to api.resend.com/emails
│   │   ├── template-clinic-invite.ts          # Inline HTML email template (operator name, org name, logo, expiry note, WMHMDA footer)
│   │   ├── rate-limit.ts                      # Wraps increment_rate_limit RPC with clinic-specific keys
│   │   └── index.test.ts                      # Deno test (.test.ts per memory reference_deno_test_discovery.md)
│   └── clinic-photo/                          # NEW — Edge Function (3-check gate + signed URL mint)
│       ├── index.ts
│       ├── cors.ts                            # Echo-Origin (no credentials needed — JWT in Authorization header)
│       └── index.test.ts
└── migrations/
    ├── 20260801000001_audit_logs_org_columns.sql
    ├── 20260801000002_orgs.sql
    ├── 20260801000003_org_logos_storage.sql
    ├── 20260801000004_audit_logs_org_fk.sql
    ├── 20260801000005_permissions.sql
    ├── 20260801000006_roles.sql
    ├── 20260801000007_memberships.sql
    ├── 20260801000008_invites.sql
    ├── 20260801000009_has_permission_fn.sql
    ├── 20260801000010_seed_system_roles_trigger.sql
    ├── 20260801000011_clinic_rpcs.sql
    ├── 20260801000012_realtime_messages_rls.sql
    └── 20260801000013_broadcast_membership_changes_trigger.sql

e2e/
├── clinic-pitfall-8-existing-user-invited.spec.ts        # Pitfall #8 matrix scenario (a)
├── clinic-pitfall-8-no-user-invited.spec.ts              #                          (b)
├── clinic-pitfall-8-existing-user-two-invites.spec.ts    #                          (c)
├── clinic-pitfall-8-invited-never-accepts.spec.ts        #                          (d)
├── clinic-pitfall-8-accepts-then-rejects.spec.ts         #                          (e)
├── clinic-revoke-latency.spec.ts                         # SC#5: 1-second revoke broadcast + DB-check 401
├── clinic-photo-access.spec.ts                           # D-12 three-check gate
├── clinic-role-permission-grid.spec.ts                   # SC#6 custom-role creation + permission RLS
├── rls-orgs.test.ts                                      # Cross-tenant impersonation proof
├── rls-memberships.test.ts                               # Cross-tenant impersonation proof
├── rls-invites.test.ts                                   # Cross-tenant impersonation proof
├── rls-roles.test.ts                                     # Cross-tenant impersonation proof + has_permission helper assertions
├── rls-role-permissions.test.ts                          # Cross-tenant impersonation proof
└── rls-org-logos-storage.test.ts                         # Cross-tenant impersonation proof on Storage bucket
```

### Pattern 1: Custom `invites` table + hashed token (D-01, mirrors Phase 8 D-03)

**What:** `invites` row stores only `sha256(token)`. Raw token lives in the Resend email URL `app.leanshot.app/clinic-invite/{token}`. Edge Function `/clinic-invite/{send,lookup,accept,reject}` hashes incoming token and looks up the row.

**When to use:** Single-use email-bearing token for B2B clinic invitations. The pattern is verbatim Phase 8 share-token + access-code architecture minus the access code (the email-delivered token IS the auth — no second factor).

**Example:**
```typescript
// Source: derived from Phase 8 share Edge Function pattern + Phase 9 D-01
// supabase/functions/clinic-invite/index.ts
async function handleSend(req: Request): Promise<Response> {
  const { email, requested_scope } = await req.json();
  const operatorUid = await verifyJWT(req);  // anti-enumeration: rate-limit check FIRST
  await rateLimit(`clinic_invite_send:${operatorUid}`, 20, 3600);  // 20/hour

  const { data: org } = await admin.from('orgs').select('id, name, logo_storage_path, owner_user_id')
    .eq('owner_user_id', operatorUid).maybeSingle();  // simplification — planner generalizes to has_permission
  if (!org) return jsonError(403, 'forbidden');

  const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
  const token = btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const tokenHash = await sha256Hex(token);

  const { data: invite, error } = await admin.rpc('send_invite', {
    p_email: email.toLowerCase().trim(),
    p_org_id: org.id,
    p_invite_token_hash: tokenHash,
    p_requested_scope: requested_scope,
  });
  if (error) return jsonError(500, 'invite_insert_failed');

  // Resend dispatch — server-only key in Deno.env
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'LeanShot <noreply@app.leanshot.app>',
      to: email,
      subject: `${org.name} invited you to share your LeanShot data`,
      html: renderInviteHtml({ org, operatorName: '...', inviteUrl: `https://app.leanshot.app/clinic-invite/${token}` }),
    }),
  });

  // Universal response — D-02 anti-enumeration
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}
```

### Pattern 2: Invitation acceptance state machine (D-16 branching)

**What:** Edge Function `/clinic-invite/lookup` returns a state code; client renders the matching screen. Acceptance flow always ends with `/clinic-invite/accept` which insert-once-only into memberships.

**When to use:** Single state machine driving ClinicInvitePage.tsx. States A (loading), B (consent), C (logged-out existing user), D (new user), E (expired), F (already used), G (canceled), H (load error).

**Example:**
```typescript
// supabase/functions/clinic-invite/index.ts handleLookup
async function handleLookup(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return jsonError(400, 'missing_token');
  const tokenHash = await sha256Hex(token);

  const { data: invite } = await admin.from('invites')
    .select('id, email, org_id, expires_at, accepted_at, rejected_at, consumed_at, requested_scope, orgs(id, name, logo_storage_path)')
    .eq('invite_token_hash', tokenHash).maybeSingle();

  if (!invite) return new Response(JSON.stringify({ state: 'not_found' }), { headers: corsHeaders });
  if (invite.accepted_at) return new Response(JSON.stringify({ state: 'already_used' }), { headers: corsHeaders });
  if (invite.rejected_at) return new Response(JSON.stringify({ state: 'already_used' }), { headers: corsHeaders });
  if (new Date(invite.expires_at) < new Date()) return new Response(JSON.stringify({ state: 'expired' }), { headers: corsHeaders });

  // Check auth.users for this email
  const { data: { users } } = await admin.auth.admin.listUsers({ email: invite.email });
  const emailExistsInAuth = users.length > 0;

  // Get caller's session via JWT if any
  const authHeader = req.headers.get('Authorization');
  const callerUser = authHeader ? (await admin.auth.getUser(authHeader.replace('Bearer ', ''))).data.user : null;

  if (callerUser && callerUser.email?.toLowerCase() === invite.email.toLowerCase()) {
    // State B: consent dialog
    return new Response(JSON.stringify({ state: 'consent', org: invite.orgs, requested_scope: invite.requested_scope }), { headers: corsHeaders });
  }
  if (emailExistsInAuth) {
    // State C: sign-in prompt
    return new Response(JSON.stringify({ state: 'signin_required', org: invite.orgs }), { headers: corsHeaders });
  }
  // State D: signup
  return new Response(JSON.stringify({ state: 'signup_required', org: invite.orgs, email: invite.email }), { headers: corsHeaders });
}
```

### Pattern 3: `has_permission()` SECURITY DEFINER helper (D-07)

**What:** One plpgsql function used by RLS policies AND by Edge Function gates AND by the UI (via service-role admin or by a thin per-user RPC view).

**When to use:** Every clinic-scoped permission check.

**Example:**
```sql
-- Source: derived from Phase 7 SECURITY DEFINER pattern + reference_supabase_migration_gotchas.md memory
-- 20260801000009_has_permission_fn.sql
create or replace function public.has_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key text
)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_catalog
stable  -- CRITICAL: stable lets RLS planners cache the result within a query
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = p_user_id
      and m.org_id = p_org_id
      and m.revoked_at is null
      and rp.permission_key = p_permission_key
  );
$$;

revoke all on function public.has_permission(uuid, uuid, text) from public;
grant execute on function public.has_permission(uuid, uuid, text) to authenticated, service_role;
```

```sql
-- Example RLS use on roles table
create policy roles_select_by_member on public.roles
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'org.read'));

create policy roles_insert_by_manager on public.roles
  for insert to authenticated
  with check (public.has_permission(auth.uid(), org_id, 'roles.manage'));
-- ... and similar for update / delete
```

### Pattern 4: Realtime broadcast with private channels + `realtime.messages` RLS (D-10 Layer 1)

**What:** NEW pattern in this codebase — supersedes the existing `postgres_changes` channels in `src/lib/sync.ts`. Use `realtime.broadcast_changes()` in a SECURITY DEFINER trigger on memberships, plus RLS on `realtime.messages` to gate subscribe.

**When to use:** All Phase 9 cross-tenant subscribe (operator listens to org-scoped broadcasts). Patient-side user-scoped channels can use either; for consistency, use broadcast.

**Example:**
```sql
-- 20260801000013_broadcast_membership_changes_trigger.sql
create or replace function public.broadcast_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_record record;
begin
  v_record := coalesce(new, old);
  -- Broadcast to org-scoped topic (operators receive)
  perform realtime.broadcast_changes(
    'org:' || v_record.org_id::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  -- Broadcast to user-scoped topic (patient receives in their own context)
  perform realtime.broadcast_changes(
    'user:' || v_record.user_id::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return null;
end;
$$;

create trigger memberships_broadcast_trigger
  after insert or update or delete on public.memberships
  for each row execute function public.broadcast_membership_changes();
```

```sql
-- 20260801000012_realtime_messages_rls.sql
-- Authorize listen on org:{id} topic only for active members with org.read
create policy clinic_org_topic_select on realtime.messages
  for select to authenticated
  using (
    case
      when topic like 'org:%' then
        public.has_permission(auth.uid(), substring(topic from 5)::uuid, 'org.read')
      when topic like 'user:%' then
        auth.uid() = substring(topic from 6)::uuid
      else false
    end
  );
```

```typescript
// src/lib/clinic-realtime.ts
import { supabase } from './supabase';

export async function subscribeToOrgChannel(orgId: string, onChange: (payload: any) => void) {
  await supabase.realtime.setAuth();  // sends current JWT — load-bearing for private channels
  const channel = supabase
    .channel(`org:${orgId}`, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, onChange)
    .on('broadcast', { event: 'UPDATE' }, onChange)
    .on('broadcast', { event: 'DELETE' }, onChange);
  await channel.subscribe();
  return channel;
}
```

### Pattern 5: Two-layer revocation (D-10 — Layer 1 Realtime + Layer 2 DB check)

**What:** Realtime is the UX overlay (~100-300ms roster removal); per-request DB check on every drill-in fetch is the security floor. Phase 8 D-02 primitive applied verbatim to memberships.

**When to use:** Every operator drill-in. Phase 9 ships the clinic-photo Edge Function as the first proof; Phase 10 extends to all other patient-data fetches.

**Example:** see clinic-photo Edge Function `Code Examples` section below.

### Pattern 6: Cascade-delete-safe org deletion (preventive deviation pattern)

**What:** Org delete cascades memberships → triggers fire on each row → audit_trigger tries to insert audit_logs row → must be suppressed via `app.suppress_audit` GUC per `reference_supabase_migration_gotchas.md` memory (4). Also: clinic-logo Storage object delete requires `set_config('storage.allow_delete_query', 'true', true)` per memory (3).

**When to use:** `delete_org` SECURITY DEFINER RPC. Apply preventively even though Phase 9 may not exercise full org deletion in the MVP slice.

**Example:**
```sql
create or replace function public.delete_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if not public.has_permission(auth.uid(), p_org_id, 'org.delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Suppress per-row audit during cascade (mirrors Phase 7 finalize_account_deletion)
  perform set_config('app.suppress_audit', 'true', true);
  -- Allow direct Storage DELETE during cascade
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Inline skeleton audit row BEFORE cascade
  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    auth.uid(),
    encode(digest(auth.uid()::text, 'sha256'), 'hex'),
    'orgs',
    p_org_id::text,
    'org_delete',
    'org_operator',
    p_org_id
  );

  -- Delete org-logo storage object
  delete from storage.objects where bucket_id = 'org-logos' and (storage.foldername(name))[1] = p_org_id::text;

  -- Delete org (cascades memberships, invites, roles, role_permissions per FKs)
  delete from public.orgs where id = p_org_id;
end;
$$;
```

### Anti-Patterns to Avoid

- **`findOrCreateUser` on `/clinic-invite/accept`** — Pitfall #8 warning sign #4. NEVER create a new auth.users row in the accept path. Branch on existence; if no auth.users row, redirect to signup wizard (State D) and require Supabase Auth confirmation BEFORE membership insert.
- **Membership insert by client (`supabase.from('memberships').insert(...)`)** — RLS must NOT allow direct INSERT from authenticated role. Only SECURITY DEFINER RPCs (`accept_invite_existing`, `accept_invite_new`) write memberships. Otherwise an attacker with their own auth.users row can self-insert into any org.
- **Realtime `postgres_changes` filtered by `user_id=eq.${otherUid}`** — would require granting SELECT on cross-tenant rows, defeating RLS. Use broadcast + `realtime.messages` RLS instead (Pattern 4).
- **Calling Resend from the SPA** — leaks API key + bloats bundle. Server-only via Edge Function.
- **Pre-checking email existence in `/clinic-invite/send`** — Pitfall #8 D-02 violation (enables enumeration). Lookup happens server-side at acceptance time only.
- **Storing raw invite token anywhere except the email URL** — irrecoverable secret leakage. `invites.invite_token_hash` is the only stored form.
- **Granting role assignment to anyone but `roles.manage` permission holders** — privilege escalation. Same for `members.revoke` / `members.invite`.
- **Reading clinic-scoped tables from the SPA with the operator's JWT directly** — would require RLS on memberships/roles/etc to be loose enough to permit cross-tenant SELECT. Instead, route through SECURITY DEFINER RPCs or Edge Functions that use service-role + `has_permission()` gate.
- **`s.user!` non-null assertion in any new clinic file** — TS strict + project rule. Use `signedIn.user`-guarded selectors.
- **Static-importing clinic chunk components in App.tsx or main.tsx** — bundle-size ceiling regression. Must be `React.lazy()`. Resend SDK MUST NOT be installed in package.json.
- **Calling `useStore` from `src/components/clinic-invite/` (anonymous patient context)** — ClinicInvitePage may render BEFORE auth completes. Read query params + Edge Function lookup result; defer store reads until State B.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invite token generation | `Math.random()` or client-side RNG | Postgres `gen_random_bytes(16)` inside `send_invite` SECURITY DEFINER RPC | CSPRNG server-side; raw bytes only leave via the email URL. |
| Token hash | Custom SHA-256 helper | `encode(digest(token, 'sha256'), 'hex')` in plpgsql + `crypto.subtle.digest` in Deno | Phase 7/8 standard; matches existing `audit_logs.user_id_hash` pattern. |
| Slug uniqueness | Application-layer SELECT-then-INSERT | Postgres UNIQUE constraint on `orgs.slug` + `RAISE unique_violation` retry loop in `create_org` RPC | Race-free; reserved-word check via plpgsql `CHECK` constraint or trigger. |
| Email rate limit | Custom counter table | Reuse `rate_limit_counters` + `increment_rate_limit` RPC (Phase 4) with new key prefix | Same primitive, free re-use. |
| Realtime cross-tenant subscribe | Manual JWT decoding + per-channel auth callback | `realtime.setAuth()` + private channels + RLS on `realtime.messages` | Supabase platform handles JWT verification + RLS evaluation per topic; no client code. |
| Resend HTTP retry / backoff | Custom retry-with-jitter | `fetch(resend_url)` with single attempt; on non-2xx, return 500 + log. Resend has built-in retry on their side for transient. | At 100-day v1 patient counts, simple retry is sufficient. Add backoff in v1.1 if observability flags failures. |
| Role + permission CRUD | UI-only model | Backend-first: `role_permissions` junction table + `permissions` global lookup; UI reads via `has_permission` and writes via RPCs | Permission grid is a checkbox view of `role_permissions` rows; deletes/inserts atomically per save. |
| Pitfall #8 5-scenario fixture setup | Hand-rolled SQL fixtures | Playwright + `supabase.auth.admin.createUser` (Phase 5 pattern from `e2e/fixtures/`) | Existing fixtures cover user creation; extend with org-creation helper. |
| Audit-log insert from Edge Function (not via trigger) | Direct INSERT into audit_logs | SECURITY DEFINER RPC `log_clinic_event(actor_type, action, org_id, target_user_id, ...)` | Phase 7 pattern: audit_logs has no INSERT policy; the RPC is the only authorized write path. Plus the RPC can hash IP/UA and centralize the schema contract. |
| Cross-tenant impersonation test | Custom integration | Existing `vitest-e2e.config.ts` glob `e2e/rls-*.test.ts` with `supabase-js` admin createUser + per-user anon client | Pattern verified in `e2e/rls-injections.test.ts`, `e2e/rls-photos-storage.test.ts`. |

**Key insight:** Phase 9 is **architecturally novel only in two places** — (1) `has_permission()` as the single RLS dispatch primitive, and (2) cross-tenant Realtime broadcast via `realtime.messages` RLS. Everything else is recombination of Phase 4 (Edge Function template), Phase 5/6 (RLS + sync + Storage), Phase 7 (audit_logs + SECURITY DEFINER + GUC suppression), Phase 8 (hashed token + per-request DB check revocation). The plan-phase should lean heavily on copy-with-rename of existing patterns; the dangerous places are (1)+(2) above plus the Pitfall #8 matrix.

## Runtime State Inventory

See above section under "Runtime State Inventory" before Standard Stack — Phase 9 is greenfield + additive, no rename/migration semantics.

## Common Pitfalls

### Pitfall 1: Duplicate `auth.users` rows from race between signup and invite-accept
**What goes wrong:** Patient A receives invite. They open it in tab 1, hit State D, start signup. Meanwhile in tab 2 they sign up directly from marketing landing page using the same email. The Edge Function `accept_invite_new` SELECTs `auth.users` between tab-2's signup and tab-1's signup, gets no row, branches "new user" — but tab-1's signup completes first. Now two signup attempts collide.
**Why it happens:** No serial gate on the email; Supabase Auth's UNIQUE on email rescues the collision but only if signups happen via `supabase.auth.signUp` (which has the constraint), not via custom code.
**How to avoid:** All signup-from-invite goes through `supabase.auth.signUp` on the client (not a server-side admin.createUser). Supabase's UNIQUE(email) on auth.users is the serializer. On collision (existing email), client gets error → re-route to State C (sign-in instead).
**Warning signs:** Pitfall #8 scenario (b) test sometimes returns 2 auth.users rows.

### Pitfall 2: `realtime.messages` RLS misconfigured → operator never receives revoke broadcast
**What goes wrong:** Forget to call `supabase.realtime.setAuth()` before `.subscribe()` on a private channel; the channel subscribes but receives nothing because no JWT was attached. OR the RLS policy on `realtime.messages` uses `auth.uid()` in an ineffectual way (e.g., comparing to NEW.user_id when the message is a broadcast not tied to a row).
**Why it happens:** New pattern in this codebase; easy to miss the `setAuth()` step or mis-author the RLS policy.
**How to avoid:** (a) Wrap all subscribe calls in `subscribeToOrgChannel` / `subscribeToUserChannel` helpers in `src/lib/clinic-realtime.ts` that always call `setAuth()`. (b) RLS policy on `realtime.messages` parses the topic string and calls `has_permission` — the SAME helper used for table RLS. (c) e2e test that verifies a non-member subscriber receives ZERO broadcasts for an org they're not in (the negative-space test).
**Warning signs:** Operator dashboard reports SC#5 latency > 1s consistently in CI; revoke happens but roster row doesn't animate out.

### Pitfall 3: `has_permission()` not `STABLE` → RLS planner can't optimize, query slows to crawl
**What goes wrong:** Function marked `VOLATILE` (default) → Postgres re-evaluates per row per query → slow joins + full-table scans on memberships in RLS predicates.
**Why it happens:** Default plpgsql volatility is VOLATILE.
**How to avoid:** Mark `STABLE` (no side effects, returns same value within a transaction). Verified in Pattern 3 example.
**Warning signs:** Slow `/clinic/{slug}` page loads; EXPLAIN ANALYZE on a `select * from roles where ...` shows repeated has_permission calls.

### Pitfall 4: System-roles trigger fires before owner-membership insert
**What goes wrong:** Trigger on `orgs INSERT` seeds 3 roles. Then `create_org` RPC inserts a membership for the creator with `role_id = (select id from roles where org_id = NEW.id and name = 'Owner')`. If the trigger fires AFTER the RPC's membership insert attempt, the role_id is NULL → FK violation.
**Why it happens:** Trigger ordering inside a transaction — BEFORE/AFTER + statement vs row.
**How to avoid:** Trigger is `AFTER INSERT ON orgs FOR EACH ROW`; the `create_org` RPC ORDER inside its body: (1) insert org, (2) trigger fires and seeds roles, (3) RPC reads the seeded Owner role.id, (4) RPC inserts memberships with role_id. All inside ONE transaction; trigger completes before step 3 because it's `AFTER` on the same INSERT statement.
**Warning signs:** `null value in column "role_id"` during `create_org` integration test.

### Pitfall 5: IMMUTABLE partial-index expression on invites
**What goes wrong:** `create index invites_active_idx on invites (expires_at) where accepted_at is null and rejected_at is null and now() < expires_at` — last predicate uses `now()` → not IMMUTABLE → migration push fails with `42P17`.
**Why it happens:** Memory `reference_supabase_migration_gotchas.md` (1) explicit.
**How to avoid:** Predicate uses only column comparisons and literals: `where accepted_at is null and rejected_at is null`. Defer the "active = not expired" check to the WHERE clause of queries.

### Pitfall 6: Storage RLS policy uses wrong `foldername` index for org-logos
**What goes wrong:** Photos use `(storage.foldername(name))[1]` to extract user_id. For org-logos with path `org-logos/{org_id}/logo.png`, `foldername(name)[1]` returns `'org-logos'` not `'{org_id}'`.
**Why it happens:** Bucket name is the bucket; `storage.foldername` operates on the object path, NOT the bucket+path. For object `name = '{org_id}/logo.png'` inside `bucket_id = 'org-logos'`, `foldername(name)[1]` is `'{org_id}'`. If the dev concatenates `'org-logos/{org_id}/...'` into name, the index shifts.
**How to avoid:** Storage object `name` MUST be `'{org_id}/logo.png'` only (bucket-relative). Verify with: `insert into storage.objects (bucket_id, name) values ('org-logos', '{org_id}/logo.png')`. Storage policies then use `(storage.foldername(name))[1] = $org_id::text`.

### Pitfall 7: Resend free-tier rate limit + missing DKIM = invites silently deferred
**What goes wrong:** Resend free tier: 100 emails/day. Pitfall #8 e2e matrix sends ~50 invites per CI run; multiple PR builds → quota exhausted → invites silently 4xx.
**Why it happens:** Resend doesn't fail open; rate-limited mail is rejected.
**How to avoid:** (a) e2e tests stub the Resend dispatch (set `RESEND_API_KEY=test-stub` env in CI; Edge Function detects stub and returns 200 without HTTP). (b) Production setup: paid Resend tier OR transactional partition (separate Resend account for prod). (c) DKIM + SPF on `app.leanshot.app` MUST be configured before first prod invite; otherwise invites land in spam → patient never sees → silent failure.
**Warning signs:** Pitfall #8 e2e flaky in CI; production invites land in spam.

### Pitfall 8: `consent_scope` jsonb shape drift between client and server
**What goes wrong:** UI ships 10 keys; later someone adds an 11th (e.g., `lab_results`). Operator-side checkbox renders 11; patient's existing memberships have only 10 keys → 11th defaults to false → silently excluded. OR worse: patient defaults to true → silent over-share.
**How to avoid:** (a) Type `ConsentScope` in `src/types/clinic.ts` as a STRICT object with exactly 10 keys; adding a key is a migration. (b) Server defaults: `update_consent_scope` RPC validates the jsonb against a known key list (plpgsql CHECK or function). (c) On display, the UI iterates the type's keys (not the stored object's keys) so missing keys render as unchecked + a "not yet granted" hint.

### Pitfall 9: WorkspaceSwitcher reads memberships before auth completes → empty list flash
**What goes wrong:** Switcher renders on every authenticated route. On hard refresh, it mounts before `supabase.auth.getSession()` resolves → empty memberships query → renders "Personal account" only briefly, then re-renders with full list.
**How to avoid:** Defer-mount the switcher until `signedIn.user` is non-null. Show a skeleton in the trigger position during the auth-resolving window. Already in UI-SPEC State Coverage Checklist § Workspace switcher → "Loading state".

### Pitfall 10: `consent_scope_at_acceptance` not snapshotted → audit trail lies
**What goes wrong:** D-18 mandates `invites.consent_scope_at_acceptance` is FROZEN at acceptance. Easy to confuse with `memberships.consent_scope` which is mutable. If `accept_invite_*` RPCs forget to write the snapshot, the only audit trail of "what did the patient consent to at acceptance" is lost when the patient later edits scope.
**How to avoid:** `accept_invite_existing` and `accept_invite_new` BOTH write `invites.consent_scope_at_acceptance = $consent_scope` in the same transaction as the membership INSERT. e2e test asserts: accept → edit scope → invites row still shows original scope.

### Pitfall 11: Cookie-attach quirk does NOT apply to Phase 9
**What goes wrong:** Phase 8 Pitfalls 3+4 (CORS + cookie credentials) are specific to share. Phase 9 Edge Functions use JWT auth (`Authorization: Bearer`) for operator-side calls and unauthenticated tokens for patient-side `/clinic-invite/*`. No cookies are set or read. Therefore CORS allow `*` origin (matching `ai-chat/cors.ts`) is acceptable.
**Why it happens:** Engineers might over-apply Phase 8 deviations.
**How to avoid:** Document explicitly in Edge Function cors.ts comments: "No credentials; `*` origin OK." Mirrors `ai-chat/cors.ts` template verbatim.

## Code Examples

### `orgs` table + slug uniqueness + reserved-word check
```sql
-- 20260801000002_orgs.sql
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(name) between 1 and 60),
  description text,
  website_url text,
  logo_storage_path text,  -- 'org-logos/{id}/logo.{ext}' or null
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Lowercase + kebab-case + reserved-word + length constraints in one CHECK
alter table public.orgs add constraint orgs_slug_format check (
  slug ~ '^[a-z][a-z0-9-]{1,59}$'  -- starts letter, lowercase, kebab, max 60
  and slug not in ('api', 'auth', 'settings', 'admin', 'app', 'clinic', 'legal',
                   'login', 'logout', 'signup', 'help', 'about', 'home', 'static',
                   'public', 'assets', 'functions')
);
create unique index orgs_slug_idx on public.orgs (lower(slug));

alter table public.orgs enable row level security;
create policy orgs_select_by_member on public.orgs
  for select to authenticated
  using (
    auth.uid() = owner_user_id
    or public.has_permission(auth.uid(), id, 'org.read')
  );
-- NO insert/update/delete policy — only via create_org/update_org/delete_org RPCs

-- Realtime publication membership (broadcast pattern doesn't strictly need this,
-- but adding for parity with Phase 5/6 in case planner mixes broadcast + postgres_changes)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orgs') then
    execute 'alter publication supabase_realtime add table public.orgs';
  end if;
end $$;
```

### `memberships` table + UNIQUE(user_id, org_id) + consent_scope jsonb
```sql
-- 20260801000007_memberships.sql
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  consent_scope jsonb not null default '{}'::jsonb,
  invited_from_invite_id uuid references public.invites(id) on delete set null,
  joined_at timestamptz not null default now(),
  accepted_at timestamptz,                  -- mirrors invites.accepted_at; redundant but indexable
  revoked_at timestamptz,
  last_scope_changed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Pitfall #8 single-identity invariant
create unique index memberships_user_org_idx on public.memberships (user_id, org_id)
  where revoked_at is null;  -- allows re-invite after revoke
-- Active members + Realtime filtering
create index memberships_org_active_idx on public.memberships (org_id) where revoked_at is null;
create index memberships_user_idx on public.memberships (user_id);

alter table public.memberships enable row level security;
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (auth.uid() = user_id);
create policy memberships_select_by_org_member on public.memberships
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'members.list'));
-- NO insert/update/delete — only via RPCs
```

### `invites` table + hashed token + 7-day expiry
```sql
-- 20260801000008_invites.sql
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete set null,
  invite_token_hash text not null,
  requested_scope jsonb not null default '{}'::jsonb,
  consent_scope_at_acceptance jsonb,  -- frozen on accept per D-18; null until accepted
  expires_at timestamptz not null,
  accepted_at timestamptz,
  rejected_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((accepted_at is null) or (rejected_at is null))  -- mutually exclusive
);

create unique index invites_token_hash_idx on public.invites (invite_token_hash);
-- Active invites (IMMUTABLE — no now() in predicate)
create index invites_org_active_idx on public.invites (org_id, expires_at)
  where accepted_at is null and rejected_at is null;
-- Per-email lookup for accept flow
create index invites_email_idx on public.invites (lower(email));

alter table public.invites enable row level security;
create policy invites_select_by_org_manager on public.invites
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'members.list'));
-- NO insert/update/delete — only via send_invite / accept_invite_* / reject_invite RPCs
```

### `permissions` global + `role_permissions` junction
```sql
-- 20260801000005_permissions.sql
create table public.permissions (
  key text primary key,
  description text not null
);
insert into public.permissions (key, description) values
  ('org.read', 'See workspace name, members, and patient roster'),
  ('org.update', 'Change workspace name, URL, and logo'),
  ('org.delete', 'Permanently remove the workspace and all memberships'),
  ('members.invite', 'Send invitations to new patients'),
  ('members.revoke', 'End any active patient membership'),
  ('members.list', 'See the list of patients and pending invitations'),
  ('roles.manage', 'Create, edit, and delete custom roles'),
  ('patient_data.read', 'Read injections, weight, symptoms, and other tracked data (excluding photos)'),
  ('patient_photos.read', 'Read body photos that patients have shared'),
  ('audit_log.read', 'See who accessed what, and when');

-- Global lookup; readable by all authenticated users
alter table public.permissions enable row level security;
create policy permissions_read_all on public.permissions for select to authenticated using (true);
-- NO writes — extending permission set requires migration

-- 20260801000006_roles.sql
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index roles_org_name_idx on public.roles (org_id, lower(name));

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete restrict,
  primary key (role_id, permission_key)
);
```

### System-roles seed trigger
```sql
-- 20260801000010_seed_system_roles_trigger.sql
create or replace function public.seed_system_roles()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_owner_id uuid;
  v_coach_id uuid;
  v_viewonly_id uuid;
begin
  -- Owner — all permissions
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Owner', 'Full access to the workspace, including settings, members, and patient data.', true)
  returning id into v_owner_id;
  insert into public.role_permissions (role_id, permission_key)
  select v_owner_id, key from public.permissions;

  -- Coach — patient data + photos + read members
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Coach', 'Reads patient data and photos. Cannot manage members, roles, or workspace settings.', true)
  returning id into v_coach_id;
  insert into public.role_permissions (role_id, permission_key) values
    (v_coach_id, 'org.read'),
    (v_coach_id, 'members.list'),
    (v_coach_id, 'patient_data.read'),
    (v_coach_id, 'patient_photos.read');

  -- View-only — read patient data only (no photos)
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'View-only', 'Reads patient data without photos. Cannot manage anything.', true)
  returning id into v_viewonly_id;
  insert into public.role_permissions (role_id, permission_key) values
    (v_viewonly_id, 'org.read'),
    (v_viewonly_id, 'members.list'),
    (v_viewonly_id, 'patient_data.read');

  return new;
end;
$$;

create trigger orgs_seed_system_roles_trigger
  after insert on public.orgs
  for each row execute function public.seed_system_roles();
```

### `create_org` RPC (operator's first action; transaction-safe)
```sql
-- inside 20260801000011_clinic_rpcs.sql
create or replace function public.create_org(
  p_name text,
  p_slug text,
  p_description text,
  p_website_url text
)
returns table (org_id uuid, slug text)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_owner_role_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- INSERT orgs (CHECK constraints enforce slug rules; UNIQUE rejects collisions)
  insert into public.orgs (slug, name, description, website_url, owner_user_id)
  values (p_slug, p_name, p_description, p_website_url, v_uid)
  returning id into v_id;

  -- Trigger seeds 3 system roles for this org_id (AFTER INSERT on orgs)
  -- Now we can SELECT the Owner role and insert the operator's membership
  select id into v_owner_role_id from public.roles
    where org_id = v_id and name = 'Owner' and is_system = true;

  insert into public.memberships (user_id, org_id, role_id, accepted_at)
  values (v_uid, v_id, v_owner_role_id, now());

  -- Audit
  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (v_uid, encode(digest(v_uid::text, 'sha256'), 'hex'), 'orgs', v_id::text, 'org_create', 'org_operator', v_id);

  return query select v_id, p_slug;
exception
  when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
end;
$$;
revoke all on function public.create_org(text, text, text, text) from public;
grant execute on function public.create_org(text, text, text, text) to authenticated;
```

### `accept_invite_existing` RPC (Pitfall #8 invariant — one auth.users per email)
```sql
create or replace function public.accept_invite_existing(
  p_invite_token_hash text,
  p_consent_scope jsonb
)
returns table (membership_id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_default_role_id uuid;
  v_membership_id uuid;
  v_user_email text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select email into v_user_email from auth.users where id = v_uid;

  -- Lookup invite (must be valid + not consumed)
  select * into v_invite from public.invites
    where invite_token_hash = p_invite_token_hash
      and accepted_at is null and rejected_at is null
      and expires_at > now()
    for update;
  if v_invite is null then raise exception 'invite_not_found_or_used' using errcode = 'P0002'; end if;
  if lower(v_invite.email) != lower(v_user_email) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  -- Default role = View-only for new memberships (operator can promote post-accept)
  select id into v_default_role_id from public.roles
    where org_id = v_invite.org_id and name = 'View-only' and is_system = true;

  -- Pitfall #8 guard: do not create duplicate membership for same (user_id, org_id) unless prior is revoked
  -- The partial unique index `memberships_user_org_idx WHERE revoked_at IS NULL` enforces this at the DB layer
  insert into public.memberships (user_id, org_id, role_id, consent_scope, invited_from_invite_id, accepted_at)
  values (v_uid, v_invite.org_id, v_default_role_id, p_consent_scope, v_invite.id, now())
  returning id into v_membership_id;

  -- Freeze consent_scope_at_acceptance per D-18; mark invite consumed
  update public.invites
    set accepted_at = now(),
        consumed_at = now(),
        consent_scope_at_acceptance = p_consent_scope
    where id = v_invite.id;

  -- Audit
  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (v_uid, encode(digest(v_uid::text, 'sha256'), 'hex'), 'memberships', v_membership_id::text,
          'membership_invite_accepted', 'org_member', v_invite.org_id);

  return query select v_membership_id, v_invite.org_id;
end;
$$;
revoke all on function public.accept_invite_existing(text, jsonb) from public;
grant execute on function public.accept_invite_existing(text, jsonb) to authenticated;
```

### `revoke_membership` RPC (D-10 Layer 2 source-of-truth)
```sql
create or replace function public.revoke_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_membership record;
  v_can_revoke_self boolean;
  v_can_revoke_other boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_membership from public.memberships where id = p_membership_id;
  if v_membership is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_membership.revoked_at is not null then return; end if;  -- idempotent

  -- Either patient revoking self OR operator with members.revoke on the org
  v_can_revoke_self := (v_membership.user_id = v_uid);
  v_can_revoke_other := public.has_permission(v_uid, v_membership.org_id, 'members.revoke');
  if not (v_can_revoke_self or v_can_revoke_other) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.memberships set revoked_at = now() where id = p_membership_id;
  -- Trigger broadcasts on UPDATE to org:{org_id} and user:{user_id} — Layer 1

  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (v_uid, encode(digest(v_uid::text, 'sha256'), 'hex'), 'memberships', p_membership_id::text,
          'membership_revoked',
          case when v_can_revoke_self then 'org_member' else 'org_operator' end,
          v_membership.org_id);
end;
$$;
revoke all on function public.revoke_membership(uuid) from public;
grant execute on function public.revoke_membership(uuid) to authenticated;
```

### `clinic-photo` Edge Function (D-12 three-check gate + 5-min signed URL)
```typescript
// supabase/functions/clinic-photo/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';  // echo-Origin, no credentials

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TTL_SECONDS = 300;  // D-13 — 5 minutes

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Parse URL: /clinic-photo/{orgId}/{userId}/{photoId}
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);  // ['clinic-photo', orgId, userId, photoId]
  const [, orgId, userId, photoId] = parts;
  if (!orgId || !userId || !photoId) return jsonError(400, 'bad_path');

  // 1. JWT → operator user_id
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError(401, 'no_auth');
  const { data: { user: operator } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (!operator) return jsonError(401, 'invalid_jwt');

  // 2. Operator is active member of orgId
  const { data: opMembership } = await admin.from('memberships')
    .select('id, role_id')
    .eq('user_id', operator.id).eq('org_id', orgId).is('revoked_at', null)
    .maybeSingle();
  if (!opMembership) return jsonError(403, 'not_member');

  // 3. Operator's role has patient_photos.read
  const { data: hasPerm } = await admin.rpc('has_permission', {
    p_user_id: operator.id, p_org_id: orgId, p_permission_key: 'patient_photos.read',
  });
  if (!hasPerm) return jsonError(403, 'permission_denied');

  // 4. Patient's membership covers photos AND is active
  const { data: patientMembership } = await admin.from('memberships')
    .select('id, consent_scope, revoked_at')
    .eq('user_id', userId).eq('org_id', orgId).is('revoked_at', null)
    .maybeSingle();
  if (!patientMembership) return jsonError(403, 'patient_not_member');
  if (patientMembership.consent_scope?.photos !== true) return jsonError(403, 'consent_excluded');

  // 5. Fetch photo storage path (RLS bypass via service-role, but tenant gate already done)
  const { data: photo } = await admin.from('photos')
    .select('storage_path')
    .eq('user_id', userId).eq('photo_id', photoId)
    .maybeSingle();
  if (!photo) return jsonError(404, 'photo_not_found');

  // 6. Mint signed URL
  const { data: signed, error: signErr } = await admin.storage.from('photos')
    .createSignedUrl(photo.storage_path, TTL_SECONDS);
  if (signErr || !signed) return jsonError(500, 'sign_failed');

  // 7. Audit
  await admin.rpc('log_clinic_event', {
    p_actor_type: 'org_operator',
    p_action: 'clinic_photo_view',
    p_org_id: orgId,
    p_target_user_id: userId,
    p_row_id: photoId,
  });

  return new Response(JSON.stringify({ signedUrl: signed.signedUrl, ttl: TTL_SECONDS }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
});
```

### App.tsx selectView extension
```typescript
// Source: extends /Users/karstenhaldan/minisite/leanshot/src/App.tsx:180-190
type View = 'marketing' | 'onboarding' | 'auth' | 'dashboard' | 'legal' | 'share' | 'clinic' | 'clinic-invite';

function selectView(opts: { user: unknown; hash: string; pathname: string }): View {
  // Phase 9 — clinic-invite and clinic routes are PATH-BASED, not hash-based
  // (operator dashboards need shareable URLs that survive page refresh + bookmarks)
  if (opts.pathname.startsWith('/clinic-invite/')) return 'clinic-invite';
  if (opts.pathname.startsWith('/clinic/')) return opts.user ? 'clinic' : 'auth';  // operator must be logged in
  // Existing hash branches:
  if (opts.hash.startsWith('#/share/')) return 'share';
  if (opts.hash.startsWith('#/legal/')) return 'legal';
  if (opts.hash.startsWith('#/auth/')) return 'auth';
  if (opts.user) return 'dashboard';
  return 'marketing';
}

const ClinicWorkspace = lazy(() => import('@/components/clinic/ClinicWorkspace').then((m) => ({ default: m.ClinicWorkspace })));
const ClinicSettingsPage = lazy(() => import('@/components/clinic/settings/ClinicSettingsPage').then((m) => ({ default: m.ClinicSettingsPage })));
const ClinicInvitePage = lazy(() => import('@/components/clinic-invite/ClinicInvitePage').then((m) => ({ default: m.ClinicInvitePage })));
```

> **Path-based routing decision:** CONTEXT.md "specifics" line 203 says `app.leanshot.app/clinic/<slug>` — a path, not a hash. Phase 7/8 used hash routes (`#/legal/`, `#/share/`). Phase 9 introduces path-based for clinic surfaces because operators will bookmark/share these URLs. This requires server-side rewriting (Vercel/Cloudflare Pages rewrite `/clinic/*` and `/clinic-invite/*` to `/index.html` so the SPA boots and reads `window.location.pathname`). Add a `vercel.json` / `_redirects` rewrite rule.

### SettingsPage NAV extension (precise position)
```typescript
// src/components/dashboard/settings/SettingsPage.tsx — insert in NAV array
const NAV: { id: Section; label: string; Icon: typeof UserIcon }[] = [
  { id: 'account', label: 'Account', Icon: UserIcon },
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  { id: 'goals', label: 'Goals', Icon: Target },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'privacy', label: 'Privacy', Icon: Shield },
  // Phase 8 — Active shares
  { id: 'shares', label: 'Active shares', Icon: Link2 },
  // Phase 9 — Active organizations (NEW, between shares and recovery per UI-SPEC §SettingsPage NAV extension)
  { id: 'organizations', label: 'Active organizations', Icon: Building2 },
  { id: 'recovery', label: 'Recovery', Icon: RotateCcw },
  { id: 'subscription', label: 'Subscription', Icon: CreditCard },
  { id: 'data', label: 'Data', Icon: Database },
];
```

### Resend HTTPS dispatch (Edge Function only — no SDK)
```typescript
// supabase/functions/clinic-invite/resend.ts
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = 'LeanShot <noreply@app.leanshot.app>';

export async function sendInviteEmail(params: {
  to: string;
  orgName: string;
  orgLogoUrl: string | null;
  operatorName: string;
  inviteUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'no_api_key' };
  // CI stub: when RESEND_API_KEY === 'test-stub', skip actual dispatch (Pitfall 7 mitigation)
  if (RESEND_API_KEY === 'test-stub') return { ok: true };

  const html = renderInviteHtml(params);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: params.to,
      subject: `${params.orgName} invited you to share your LeanShot data`,
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, error: `resend_${res.status}` };
  }
  return { ok: true };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `postgres_changes` Realtime filtered by `user_id` (Phase 5/6) | Private channels + `broadcast` + `realtime.messages` RLS + `realtime.broadcast_changes` trigger | Supabase migration (deprecation announced; 2025-ish) | Phase 9 cross-tenant subscribe (operator listens to org channel) REQUIRES this — `postgres_changes` cannot cross RLS boundaries without granting cross-tenant SELECT. |
| Auth-only application-layer guards (Phase 4 ai-chat) | `has_permission()` SECURITY DEFINER + RLS dispatch | Phase 9 (NEW for clinic surfaces) | Single source of truth across SQL and Edge Functions; can be UI-mirrored for affordance hints. |
| Direct INSERT/UPDATE on memberships / orgs / roles | All writes through SECURITY DEFINER RPCs; RLS denies direct writes | Phase 7 audit_logs pattern; Phase 8 shares; carried forward | Tamper-resistant; centralized audit hook; centralized permission gate. |
| Magic-link or doctor account for share recipients (Phase 8) | Hashed-token URL + Supabase Auth signup leg for new patients (Phase 9 D-16) | Phase 9 — different audience (B2B patient who needs a real persistent identity, not a one-shot doctor view) | Patient gets a real account that survives beyond the invite; clinic membership is the relationship. |
| Resend SDK in browser | Resend HTTPS in Edge Function only | Phase 9 introduction | API key never reaches browser; SPA bundle unaffected; CI stub via `RESEND_API_KEY=test-stub`. |

**Deprecated/outdated:**
- `postgres_changes` (still works; Supabase has not removed it) — but for cross-tenant Phase 9 broadcasts, broadcast pattern is mandatory. Existing Phase 5/6 patient-side channels can remain on `postgres_changes` for now; migrating them is a separate concern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resend SaaS will be the chosen transactional email provider; CONTEXT.md D-16's "Phase 7 transactional template stack" exists | Standard Stack; D-16 | If user picks SendGrid / Postmark / Mailgun instead, swap the `resend.ts` dispatch helper. Architecture unchanged. **Note:** verified by grep — NO existing Resend code in repo; Phase 9 must build from scratch. |
| A2 | Path-based routing (`/clinic/{slug}`, `/clinic-invite/{token}`) is acceptable; UI-SPEC + CONTEXT.md "specifics" line 203 explicitly says `app.leanshot.app/clinic/<slug>` | App.tsx selectView extension | Requires Vercel/Cloudflare Pages rewrite rule (`/clinic/* → /index.html`, `/clinic-invite/* → /index.html`). If only hash routing is permitted, swap to `#/clinic/{slug}` and `#/clinic-invite/{token}`. |
| A3 | Realtime `broadcast` + `realtime.messages` RLS is available on Supabase free tier and stable as of 2026-05 | Pattern 4 | If feature is paid-tier-only, fall back to per-row polling (1s polling on `memberships` filtered by org_id; operator pays in latency); or rely on Layer 2 DB check alone (SC#5 latency target slips from 1s to "next operator action"). |
| A4 | Pitfall #8 CI matrix can run in foreground-test-mode without tripping the RC5 deferred-test cluster (two-context Realtime polling) | Validation Architecture | If the cluster pattern reproduces, mark Pitfall #8 specs `test.fixme` per `feedback_defer_then_batch_fix_pattern.md` and capture in `.planning/deferred-tests.md`. Phase 10 entry condition: "RC5 fix lands + Phase 9 deferred Pitfall #8 specs re-enabled." Flagged in CONTEXT.md canonical_refs line 168. |
| A5 | Operator can serve as their own first member (membership row inserted for them with Owner role) at org-create time | Code Examples `create_org` | Trivially correct — see `create_org` RPC; trigger seeds roles BEFORE membership insert. If trigger ordering is wrong, FK violation at membership-insert. Verified via Pitfall #4. |
| A6 | Custom slug reserved-words list (api/auth/settings/etc.) is sufficient | Code Examples orgs CHECK | If the list misses entries (e.g., `clinic-invite` → 'clinic-invite' is a slug for a clinic named "Clinic Invite" — confusing but valid since it doesn't conflict with path `/clinic-invite/...` because slugs are nested under `/clinic/{slug}` not `/{slug}`). Planner should extend the list as user research surfaces problems. |
| A7 | One `auth.users.email` is canonically unique (Supabase Auth enforces) | Pitfall #8 D-03 | `[VERIFIED: Supabase Auth docs]` Supabase Auth UNIQUE on `auth.users.email` is platform-default — no override exists. This is the Pitfall #8 single-identity backbone. |
| A8 | `realtime.broadcast_changes` accepts NEW + OLD as record arguments and serializes correctly via JSON broadcast payload | Pattern 4 | `[CITED: supabase.com/docs/guides/realtime/getting_started]` Confirmed by Supabase docs example. |
| A9 | Resend free tier (100/day) is sufficient for prod launch traffic; paid tier for high-volume clinic onboarding | Pitfall 7 | If first clinic adopters send >100 invites/day, upgrade to paid before launch. Deploy checklist item. |
| A10 | Cookie-attach quirk from Phase 8 does NOT recur in Phase 9 because no cookies are issued (JWT-only auth for operators; unauthenticated tokens for patients) | Pitfall 11 | `[VERIFIED via design: ]` Phase 9 Edge Functions return JSON, set no cookies. CORS allow `*` is acceptable, matching `ai-chat/cors.ts`. |
| A11 | The `has_permission()` STABLE marking + RLS planner caching gives acceptable performance at v1 patient-count scale (≤ 100 patients per org × 10 orgs per platform) | Pitfall 3 | If perf bites, add a composite index `(user_id, org_id, revoked_at)` on memberships AND `(role_id, permission_key)` on role_permissions; both are standard B-tree, no special handling. |

## Open Questions

1. **Path-based vs hash-based clinic routes.**
   - What we know: CONTEXT.md "specifics" + UI-SPEC reference `app.leanshot.app/clinic/<slug>` — clearly path-based.
   - What's unclear: Whether the Vercel deploy config supports SPA rewrites for arbitrary nested paths (`/clinic/{slug}/settings/roles`).
   - Recommendation: Add `vercel.json` rewrites for `/clinic/*` and `/clinic-invite/*`. Same for Cloudflare Pages `_redirects`. Hash-based is a viable fallback if rewrites don't work; planner should choose one and stick to it. Plan-phase has a 30-minute spike at the start to verify the rewrite works in a real preview deploy.

2. **Resend vs alternative transactional email provider.**
   - What we know: CONTEXT.md D-16 names Resend; no existing integration in code.
   - What's unclear: Whether user has already signed up for Resend or wants to choose at this stage.
   - Recommendation: Plan-phase opens a `[HUMAN CHECKPOINT]` for Resend account creation + DNS records + API key in Supabase secrets. Architecture (Edge Function dispatch + HTML template) is provider-agnostic; swap is trivial.

3. **Role-based default for new memberships on invite-accept.**
   - What we know: `accept_invite_existing` and `accept_invite_new` default new memberships to View-only.
   - What's unclear: Whether the operator should be able to specify a role in `requested_scope` (e.g., "I'm inviting Dr. Smith as a Coach").
   - Recommendation: v1 — default to View-only. v1.1 — add `requested_role_id` to invites with a server-side check that the role exists in the org. Defer.

4. **Whether `has_permission()` calls should be audit-logged when they fail (permission_denied audit row).**
   - What we know: D-07 says "every revoke/scope-change/permission-check writes an audit_logs row" (per orchestrator brief).
   - What's unclear: Auditing EVERY check (including UI-side affordance checks) could be high-volume.
   - Recommendation: Audit only `permission_denied` results inside Edge Functions and SECURITY DEFINER RPCs (i.e., security-relevant denials, not UI hints). Add `permission_denied` to the `audit_logs.action` check constraint. Document the rule.

5. **Org-deletion semantics for the MVP slice.**
   - What we know: CONTEXT.md gray area — planner picks minimal default.
   - What's unclear: Whether org-delete is part of Phase 9 SC or deferred to Phase 10.
   - Recommendation: Ship `delete_org` RPC (with cascade-safe pattern from `Pattern 6`) but DO NOT surface UI in the Workspace tab — instead, surface a "Delete workspace" CTA that opens a typed-confirm modal (UI-SPEC describes this) and gates on `org.delete` permission. Owner-removing-self deferred to Phase 10.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest, Playwright, build | ✓ | 22.18.0 | — |
| supabase CLI | Migration push, function deploy | ✓ | 2.98.2 (Phase 8 RESEARCH confirmed) | — |
| Deno | Local Edge Function smoke test | ✓ | 2.7.14 (Phase 8 RESEARCH confirmed) | Supabase Edge Runtime supplies it in prod |
| Postgres `pgcrypto` | digest, gen_random_bytes | ✓ | bundled | — |
| Playwright browsers (chromium) | E2E + Pitfall #8 matrix + revoke drill | ✓ | playwright 1.59.1 | — |
| Supabase project `ytnsipxxmzgaebkqmokp` | All cloud ops | ✓ | eu-west-1 free tier | — |
| Resend account + API key + DNS (SPF/DKIM on `app.leanshot.app`) | Branded invitation emails | ✗ | — | **BLOCKING:** must be set up before first prod invite. CI uses `RESEND_API_KEY=test-stub` to skip dispatch. Deploy checklist item. |
| Supabase Realtime broadcast feature | D-10 Layer 1 cross-tenant subscribe | ✓ | ✓ on free tier (per Supabase docs as of 2026-05) | Fall back to 1-second polling on memberships filtered by org_id (degrades SC#5 latency but stays correct); or Layer 2 DB check only (next-action latency). |
| Vercel/Cloudflare Pages rewrite for `/clinic/*` and `/clinic-invite/*` | Path-based clinic routes | ? | Phase 2 deploy decisions deferred | Switch to hash routes (`#/clinic/{slug}`); requires CONTEXT.md update OR addendum. |

**Missing dependencies with fallback:**
- Resend — fallback is CI stub (`RESEND_API_KEY=test-stub`) for local + CI testing. Prod blocked until Resend account + DNS configured. Plan-phase should include a `[HUMAN CHECKPOINT]` task for this.
- Realtime broadcast — fallback is polling. Document tradeoff if used.
- Vercel rewrite — fallback is hash routes.

**Missing dependencies with no fallback:** None.

## Validation Architecture

> nyquist_validation is enabled (default) per `.planning/config.json`. This section establishes the test pyramid for Phase 9.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (unit + RLS impersonation) + Playwright 1.59.1 (e2e) + Deno test (Edge Function unit) |
| Config file | `vitest.config.ts`, `vitest-e2e.config.ts` (glob `e2e/rls-*.test.ts`), `playwright.config.ts`, `supabase/functions/clinic-invite/deno.json` |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm test` (vitest run + playwright) |
| RLS proof command | `npm run test:e2e:rls` |
| Deno test command | `deno test supabase/functions/clinic-invite/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLINIC-01 | Operator signs up + creates org + lands at `/clinic/{slug}` | e2e | `npx playwright test e2e/clinic-pitfall-8-no-user-invited.spec.ts -g "operator creates workspace"` | Wave 0 |
| CLINIC-01 | `create_org` RPC seeds 3 system roles via trigger | unit (Postgres) | `npm run test:e2e:rls -- rls-roles.test.ts -t "system roles seeded on org create"` | Wave 0 |
| CLINIC-01 | Slug uniqueness rejected by RPC | unit (Postgres) | `npm run test:e2e:rls -- rls-orgs.test.ts -t "slug uniqueness"` | Wave 0 |
| CLINIC-01 | Reserved-word slug rejected by CHECK | unit (Postgres) | `npm run test:e2e:rls -- rls-orgs.test.ts -t "slug reserved"` | Wave 0 |
| CLINIC-01 | Logo upload to `org-logos/{org_id}/...` enforced by Storage RLS (operator write, public read) | unit (Postgres + Storage) | `npm run test:e2e:rls -- rls-org-logos-storage.test.ts` | Wave 0 |
| CLINIC-02 | Operator invites patient by email → Resend dispatch returns 200 (stubbed in CI) | unit (Deno) | `deno test supabase/functions/clinic-invite/index.test.ts -- --filter "send"` | Wave 0 |
| CLINIC-02 | Patient with NO prior auth.users accepts → exactly one auth.users row exists | e2e (Pitfall #8 b) | `npx playwright test e2e/clinic-pitfall-8-no-user-invited.spec.ts` | Wave 0 |
| CLINIC-02 | Patient WITH prior auth.users accepts → no duplicate auth.users row | e2e (Pitfall #8 a) | `npx playwright test e2e/clinic-pitfall-8-existing-user-invited.spec.ts` | Wave 0 |
| CLINIC-02 | Existing user accepts 2 invites to 2 different orgs → 1 auth.users + 2 memberships rows | e2e (Pitfall #8 c) | `npx playwright test e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts` | Wave 0 |
| CLINIC-02 | Invited user never accepts → invite expires after 7 days, no memberships row, no auth.users created | e2e (Pitfall #8 d) | `npx playwright test e2e/clinic-pitfall-8-invited-never-accepts.spec.ts` | Wave 0 |
| CLINIC-02 | User accepts then rejects → membership exists, then revoked_at set; auth.users unchanged | e2e (Pitfall #8 e) | `npx playwright test e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts` | Wave 0 |
| CLINIC-02 | D-02 anti-enumeration: send-invite returns identical 200 + "Invitation sent" regardless of email existence | e2e | `npx playwright test e2e/clinic-pitfall-8-existing-user-invited.spec.ts -g "anti-enumeration"` | Wave 0 |
| CLINIC-03 | Patient sees consent dialog with 10 checkboxes pre-filled per requested_scope | e2e | same as Pitfall #8 (a) | Wave 0 |
| CLINIC-03 | Patient unchecks scope → memberships.consent_scope reflects post-uncheck state | e2e | same | Wave 0 |
| CLINIC-03 | `consent_scope_at_acceptance` is FROZEN on invite row after accept (D-18 audit-trail snapshot) | unit (Postgres) | `npm run test:e2e:rls -- rls-invites.test.ts -t "consent scope frozen"` | Wave 0 |
| CLINIC-03 | Edit-scope post-acceptance updates memberships.consent_scope but NOT invites.consent_scope_at_acceptance | e2e | `npx playwright test e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts -g "scope edit"` | Wave 0 |
| CLINIC-06 | 3 system roles seeded on org-create with correct permission grids (Owner=all, Coach=read+photos, View-only=read) | unit (Postgres) | `npm run test:e2e:rls -- rls-roles.test.ts -t "system role permissions"` | Wave 0 |
| CLINIC-06 | Custom role created via UI → `roles` row + `role_permissions` rows match permission grid | e2e | `npx playwright test e2e/clinic-role-permission-grid.spec.ts` | Wave 0 |
| CLINIC-06 | RLS enforces permission grid: Coach with `patient_photos.read` can fetch via /clinic-photo; View-only cannot | unit (Edge Function + RLS) | `deno test supabase/functions/clinic-photo/index.test.ts` + `npm run test:e2e:rls -- rls-role-permissions.test.ts -t "view-only blocked from photos"` | Wave 0 |
| CLINIC-06 | Custom role delete reassigns members to View-only | unit (Postgres) | `npm run test:e2e:rls -- rls-role-permissions.test.ts -t "delete role reassigns"` | Wave 0 |
| CLINIC-06 | System role delete is forbidden | unit (Postgres) | `npm run test:e2e:rls -- rls-role-permissions.test.ts -t "system role delete forbidden"` | Wave 0 |
| CLINIC-06 | Permission grid checkbox toggle persists across UI navigations | e2e | `npx playwright test e2e/clinic-role-permission-grid.spec.ts -g "persist"` | Wave 0 |
| CLINIC-07 (capture) | Every revoke writes `audit_logs` row with action='membership_revoked' + correct actor_type + org_id | unit (Postgres) | `npm run test:e2e:rls -- rls-memberships.test.ts -t "audit on revoke"` | Wave 0 |
| CLINIC-07 (capture) | Every scope change writes audit row with action='membership_scope_updated' | unit (Postgres) | `npm run test:e2e:rls -- rls-memberships.test.ts -t "audit on scope change"` | Wave 0 |
| CLINIC-07 (capture) | Permission-denied from /clinic-photo writes audit row with action='permission_denied' | unit (Edge Function) | `deno test supabase/functions/clinic-photo/index.test.ts -- --filter "audit denied"` | Wave 0 |
| SC#5 (revoke latency) | Patient revokes → operator roster removes within 1 second (Realtime broadcast) AND drill-in /clinic-photo returns 401 | e2e (two-context, NB Pitfall A4) | `npx playwright test e2e/clinic-revoke-latency.spec.ts` | Wave 0 — IF RC5 cluster blocks, mark `test.fixme` + log to deferred-tests.md |
| SC#5 (DB check floor) | Even with stale Realtime channel, next /clinic-photo poll returns 401 within seconds of revoke | e2e | same | Wave 0 |
| Project rule | Cross-tenant impersonation proof on orgs / memberships / invites / roles / role_permissions / org-logos bucket | unit (Postgres + Storage) | `npm run test:e2e:rls -- 'rls-(orgs\|memberships\|invites\|roles\|role-permissions\|org-logos-storage).test.ts'` | Wave 0 — REQUIRED by project rule (reference_supabase_project.md memory) |
| Bundle budget | clinic chunk ≤ 12 kB gz; clinic-settings ≤ 14 kB; clinic-invite ≤ 6 kB; index delta ≤ 3 kB | e2e (bundle-size CI guard) | `npm run build && node scripts/bundle-size-check.cjs` (extend existing Phase 6 Plan 06-01 guard) | Wave 0 — extend existing guard |

### Sampling Rate
- **Per task commit:** `npm run test:unit` + typecheck + `deno test supabase/functions/clinic-*/` (only when those files changed).
- **Per wave merge:** `npm test` + `npm run test:e2e:rls` locally; CI runs full suite + bundle-size guard.
- **Phase gate (before /gsd-verify-work):** Full suite green AND all 5 Pitfall #8 specs return 0 failures AND `e2e/clinic-revoke-latency.spec.ts` returns 0 failures (or is documented in deferred-tests.md if RC5 cluster reproduces) AND all 6 cross-tenant RLS impersonation specs pass.

### Test Pyramid for Phase 9

- **Unit (~25 tests):**
  - Postgres: `has_permission()` returns true/false correctly; system-roles trigger seeds 3 rows; create_org rejects duplicate slug; slug reserved-word CHECK; consent_scope frozen on accept; revoke writes audit; permission-denied writes audit; custom-role delete reassigns; system-role delete forbidden.
  - Deno (Edge Functions): /clinic-invite/send happy path; /clinic-invite/lookup state branches (B/C/D/E/F/G); /clinic-invite/accept email-mismatch rejection; /clinic-photo three-check gate (member check + permission check + consent check); /clinic-photo signed-URL TTL = 300s.
  - React (Vitest + RTL): ConsentDialog renders 10 checkboxes from data-type label table; WorkspaceSwitcher renders 3 groups; OrgCreateFlow slug auto-derive from name; InvitePatientModal shows universal "Invitation sent" post-send state.

- **Integration (~8 tests):**
  - End-to-end RPC flows: create_org → seed roles → insert owner membership → audit row exists. send_invite → invites row + Resend stub. accept_invite_existing → memberships row + invites consumed + audit. revoke_membership → memberships.revoked_at + broadcast + audit. update_consent_scope → memberships.consent_scope + audit.
  - clinic-photo Edge Function with three real users (operator + patient consenting + patient non-consenting): verify 200 / 403 paths.

- **E2E (~10 specs):**
  - 5 Pitfall #8 scenarios (each its own spec for clarity).
  - 1 revoke-latency spec (two-context Realtime + DB check).
  - 1 clinic-photo access spec (D-12 three-check + signed URL).
  - 1 custom-role + permission-grid spec (SC#6).
  - 1 org-create-to-invite happy path (CLINIC-01 + CLINIC-02 stitched).
  - 1 print/visual regression (if applicable to clinic settings — likely defer to Phase 10).

- **RLS impersonation (6 specs):** rls-orgs, rls-memberships, rls-invites, rls-roles, rls-role-permissions, rls-org-logos-storage. Each follows the cross-tenant impersonation template from `e2e/rls-injections.test.ts` + `e2e/rls-photos-storage.test.ts`.

- **Edge Function deno tests (2 files):** `clinic-invite/index.test.ts`, `clinic-photo/index.test.ts`. Per memory `reference_deno_test_discovery.md`, files use `.test.ts` suffix.

- **Security drill (folded into clinic-revoke-latency.spec.ts):** verifies Layer 2 DB-check 401 ALSO fires even if Realtime channel is intentionally disconnected (i.e., security floor independent of UX overlay).

### Wave 0 Gaps

- [ ] `supabase/functions/clinic-invite/deno.json` + `index.test.ts` (Deno test scaffold)
- [ ] `supabase/functions/clinic-photo/deno.json` + `index.test.ts`
- [ ] `e2e/clinic-pitfall-8-existing-user-invited.spec.ts` (Pitfall #8 a)
- [ ] `e2e/clinic-pitfall-8-no-user-invited.spec.ts` (Pitfall #8 b)
- [ ] `e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts` (Pitfall #8 c)
- [ ] `e2e/clinic-pitfall-8-invited-never-accepts.spec.ts` (Pitfall #8 d)
- [ ] `e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts` (Pitfall #8 e)
- [ ] `e2e/clinic-revoke-latency.spec.ts` (SC#5)
- [ ] `e2e/clinic-photo-access.spec.ts` (D-12)
- [ ] `e2e/clinic-role-permission-grid.spec.ts` (SC#6)
- [ ] `e2e/rls-orgs.test.ts`
- [ ] `e2e/rls-memberships.test.ts`
- [ ] `e2e/rls-invites.test.ts`
- [ ] `e2e/rls-roles.test.ts`
- [ ] `e2e/rls-role-permissions.test.ts`
- [ ] `e2e/rls-org-logos-storage.test.ts`
- [ ] `src/types/clinic.ts` (shared TS types)
- [ ] `src/components/clinic-invite/ConsentDialog.test.tsx`
- [ ] `src/components/layout/WorkspaceSwitcher.test.tsx`
- [ ] `src/components/clinic/OrgCreateFlow.test.tsx`
- [ ] `src/components/clinic/InvitePatientModal.test.tsx`
- [ ] Extension to existing bundle-size CI guard: add budgets for `clinic`, `clinic-settings`, `clinic-invite` chunks
- [ ] Vercel/Cloudflare rewrite rules for `/clinic/*` and `/clinic-invite/*`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Operator: Supabase Auth JWT (existing). Patient (anonymous landing): unauthenticated token-in-URL via `/clinic-invite/{token}`. Patient (post-accept): Supabase Auth JWT. No custom auth. |
| V3 Session Management | yes | Standard Supabase Auth session in localStorage + refresh-token rotation (Phase 5 pattern). Invite token is single-use via `accepted_at`/`rejected_at`/`consumed_at` lifecycle. |
| V4 Access Control | yes | RLS + `has_permission()` SECURITY DEFINER + SECURITY DEFINER RPCs for all writes. Edge Function service-role gated by JWT validation + has_permission check. |
| V5 Input Validation | yes | `create_org`: name 1..60, slug regex + reserved blocklist. `send_invite`: email RFC 5322 length 3..254. `accept_invite_*`: consent_scope jsonb shape check (10 known keys, all boolean). `delete_role`: role_id must not be is_system. All validated in plpgsql CHECK + RPC body. |
| V6 Cryptography | yes | sha256 for invite_token_hash + audit_logs user_id_hash. CSPRNG via gen_random_bytes for invite tokens. NEVER hand-rolled. No bcrypt needed in Phase 9 (no access codes — invite-token URL is the auth factor). |
| V7 Error Handling & Logging | yes | Edge Function errors use stable code shape (`{error: '<code>'}`). NEVER echo Postgres error strings. audit_logs row written for every revoke + scope-change + permission-denied. |
| V9 Communication | yes | All clinic routes HTTPS-only (Vercel/Cloudflare enforces). Resend HTTPS to api.resend.com. |
| V13 API & Web Service | yes | CORS: `*` Origin OK (no credentials — mirrors `ai-chat/cors.ts`). |
| V14 Configuration | yes | RESEND_API_KEY in Supabase Function secret (never in repo). DNS SPF/DKIM on `app.leanshot.app` enforced by Resend onboarding. |

### Known Threat Patterns for clinic-route stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email enumeration via invite-send | Information disclosure | D-02: send-invite always returns identical 200 + "Invitation sent" universal copy; auth.users lookup ONLY at accept time, server-side. |
| Duplicate auth.users via race between signup and invite-accept | Tampering / spoofing | Pitfall 1: signup-from-invite goes through `supabase.auth.signUp` (Supabase's UNIQUE(email) enforces serializer); on collision, redirect to State C (sign-in) instead. |
| Privilege escalation via direct INSERT into role_permissions | Elevation of privilege | RLS denies authenticated INSERT; only `create_role` / `update_role` RPCs gate on `roles.manage` permission. |
| Patient bypass: directly INSERT memberships for self into target org | Tampering | RLS denies authenticated INSERT on memberships; only `accept_invite_*` RPCs write, and they require a valid invite-token. |
| Operator extends own access via UPDATE memberships.role_id | Elevation of privilege | RLS denies authenticated UPDATE on memberships; only `update_member_role` RPC (gated on `roles.manage`) writes role_id. |
| Cross-tenant SELECT memberships of unrelated org | Information disclosure | RLS `memberships_select_by_org_member` requires `has_permission(uid, org_id, 'members.list')`. Negative-space test in rls-memberships.test.ts. |
| Photo URL leak post-revoke (within 5-min TTL window) | Information disclosure | Accepted tradeoff (D-13). Mitigated by Layer 2 DB check on every photo fetch; previously-loaded URLs are stale-only, no NEW URLs minted after revoke. |
| Realtime topic subscribe by non-member | Information disclosure | RLS on `realtime.messages` calls `has_permission(uid, parsed_org_id, 'org.read')`. Negative-space test asserts non-member receives ZERO broadcasts. |
| CSRF via cross-site form post to /clinic-invite/accept | Tampering | JWT (Authorization header) required for State B (logged-in accept). Token-in-URL is single-use + email-bound. No cookies involved. |
| Direct INSERT to audit_logs to hide a revoke | Tampering | audit_logs has NO INSERT policy for authenticated role; service_role bypass ONLY inside SECURITY DEFINER RPCs (Phase 7 pattern). |
| Open redirect via invite-token URL | Tampering | Token lives in path segment (not query); no redirect chain; SPA renders ClinicInvitePage which is a fixed local component. |
| Brute-force token guess | Spoofing | 128-bit token entropy via gen_random_bytes(16). Even at 1B guesses/sec for 100 years = 10^17 guesses; trivially infeasible. Rate-limited at /clinic-invite/lookup (10/min/IP) as additional defense. |
| Token reuse after acceptance | Replay | `invites.accepted_at` set → /clinic-invite/lookup returns state F (already_used) → /clinic-invite/accept rejects. |
| Phantom org via slug squatting | Tampering | Slug reserved-word blocklist (api/auth/admin/etc.). UNIQUE(lower(slug)) prevents duplicates. |
| Org-logo XSS via SVG upload | Tampering / XSS | Storage `allowed_mime_types = array['image/png', 'image/jpeg']` — SVG explicitly excluded. PNG/JPEG only. |
| Audit-log row write race condition on permission-denied | Repudiation | `log_clinic_event` RPC runs inside the Edge Function transaction; non-2xx response includes a 500 if audit insert fails. |
| Resend API key leak via Edge Function logs | Information disclosure | Key in `Deno.env`, never echoed; non-2xx Resend response is wrapped as `{error: 'resend_<status>'}` — NEVER `r.text()` echoed (Phase 4 pattern). |
| Patient receives invite while account deletion (Phase 7) in flight | Information disclosure | Phase 7 follow-up: also revoke outstanding shares + invites on `initiate_account_deletion`. Phase 9 follow-up task: extend the cleanup to memberships + outstanding invites. |

## Sources

### Primary (HIGH confidence)
- `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts` + `cors.ts` + `rate-limit.ts` — Edge Function template (Phase 4)
- `/Users/karstenhaldan/minisite/supabase/migrations/20260513000000_injections.sql` — Realtime publication membership pattern + RLS template
- `/Users/karstenhaldan/minisite/supabase/migrations/20260514000009_photos.sql` + `20260514000010_storage_bucket.sql` — photos bucket + Storage RLS via `storage.foldername` pattern
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000001_audit_logs.sql` — audit_logs base schema
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000002_audit_triggers.sql` — SECURITY DEFINER trigger pattern + search_path discipline
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql` — SECURITY DEFINER RPC with `extensions` search_path
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000016_finalize_storage_bypass.sql` — Storage delete bypass GUC
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — app.suppress_audit GUC hook
- `/Users/karstenhaldan/minisite/leanshot/src/App.tsx:60-200` — selectView + lazy chunk pattern (extending the `legal` and `share` branches)
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:55-90` — NAV array extension point
- `/Users/karstenhaldan/minisite/leanshot/src/lib/sync.ts:560-600` — existing Realtime postgres_changes pattern (Phase 5/6) for comparison vs new broadcast pattern
- `/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts` + `e2e/rls-photos-storage.test.ts` — RLS impersonation proof templates
- `/Users/karstenhaldan/minisite/leanshot/package.json` — verified dependency versions
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/08-doctor-read-share/08-RESEARCH.md` — Phase 8 patterns (Edge Function template, audit extension, hashed token, GUC suppression)
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/08-doctor-read-share/08-01-PLAN.md` — Phase 8 audit_logs/shares migration ordering pattern
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/09-clinic-b2b-foundations/09-CONTEXT.md` — 18 locked decisions
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/09-clinic-b2b-foundations/09-UI-SPEC.md` — design contract for 14 surfaces + 3 lazy chunks + 10-permission grid
- `/Users/karstenhaldan/minisite/leanshot/.planning/research/PITFALLS.md` §"Pitfall 8" lines 262-296 — load-bearing for D-01..D-03
- Memory `reference_supabase_migration_gotchas.md` — four reusable migration deviations applied preventively
- Memory `reference_supabase_project.md` — RLS proof rule (every surface gets impersonation proof)
- Memory `feedback_parallel_executor_git_isolation.md` — pathspec commits for parallel execution
- Memory `reference_deno_test_discovery.md` — `.test.ts` convention
- Memory `project_phase5_bundle_regression.md` — bundle-size discipline
- Memory `feedback_parallel_chunked_planning.md` — fire parallel planners for ≥5-plan phases
- Memory `feedback_defer_then_batch_fix_pattern.md` — `test.fixme` + deferred-tests.md for CI-only failures
- Memory `feedback_regulator_vs_user_audience_pattern.md` — invest aggressively on consent dialog + switcher; trim on slug rules

### Secondary (MEDIUM confidence)
- [Supabase Realtime — Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) — `realtime.broadcast_changes` trigger + private channel + `setAuth()` pattern
- [Supabase Realtime — Getting started](https://supabase.com/docs/guides/realtime/getting_started) — `realtime.messages` RLS for authorization
- [Supabase Realtime — Broadcast](https://supabase.com/docs/guides/realtime/broadcast) — JSON payload shape from `realtime.broadcast_changes`
- [Supabase Realtime — `setAuth()` API](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) — JWT preservation across resubscribes
- [Supabase Auth — `signInWithOtp`, `signUp`](https://supabase.com/docs/reference/javascript/auth-signinwithotp) — magic-link + signup flows for invite acceptance branches
- [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) — POST /emails contract
- Context7 `/websites/supabase` (fetched 2026-05-12) — confirmed broadcast + RLS pattern is current as of cutoff

### Tertiary (LOW confidence — flagged in Assumptions Log)
- A1 — Resend SaaS as the chosen provider (no existing integration; user may swap)
- A2 — path-based routing acceptable (depends on Phase 2 deploy decisions)
- A3 — Realtime broadcast available on Supabase free tier (verify in implementation)
- A4 — RC5 deferred-test cluster won't reproduce with new Pitfall #8 specs (verify by running once before committing the spec batch)
- A6 — slug reserved-word list is sufficient (verify with user research post-launch)
- A9 — Resend free tier sufficient (verify after first prod-ish traffic)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library already in dep tree or platform-bundled; Phase 4 Edge Function template + Phase 5/6 RLS + Phase 7 SECURITY DEFINER + Phase 8 hashed-token patterns read in full.
- Architecture: HIGH — recombination of Phase 4 + 5 + 6 + 7 + 8 primitives, with two genuinely novel pieces (has_permission helper + Realtime broadcast cross-tenant); both have Supabase docs precedent.
- Pitfalls: HIGH — 9 of 11 pitfalls are deduced from earlier-phase encounters logged in memory + four reusable migration gotchas; 2 are deduced from Realtime broadcast pattern's first-use risk.
- Security: HIGH — STRIDE register maps directly to existing Phase 7+8 mitigations; new surfaces well-typed; Pitfall #8 matrix has explicit 5-scenario coverage from PITFALLS.md.
- Validation: HIGH — every requirement maps to an explicit test command; 6 RLS impersonation files cover the project rule; Pitfall #8 has 5 dedicated specs.

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — stable infrastructure; if Supabase Realtime broadcast API or Resend pricing change, re-verify Patterns 4 and the Standard Stack table only)

---

*Phase: 09-clinic-b2b-foundations*
*Research authored: 2026-05-12*
*Mode: mvp*
*Spawned by: gsd-plan-phase 9 --auto*
