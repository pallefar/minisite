# Phase 9: Clinic B2B Foundations - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A clinic operator signs up, creates an organization workspace (org name + logo + slug → `app.leanshot.app/clinic/<slug>`), invites a patient by email, the patient explicitly consents at acceptance with a granular per-data-type scope visible, and identity stays singular: one `auth.users` per email; `memberships` is the relationship table; a patient who already has a personal LeanShot account joins via a `memberships` row, never a duplicate `auth.users` record.

**Phase 9 closes when:**
- CLINIC-01..03 are shipped and verified against the live deployed app.
- Pitfall #8 5-scenario matrix (`.planning/research/PITFALLS.md` §262) passes in CI (e2e + pgTAP RLS impersonation).
- Patient revokes membership from Settings → Active organizations → operator's roster removes the patient within 1s and operator's drill-in returns 401 (SC#5).
- Full role system (3 default roles + custom-role admin UI + permission-jsonb RLS) is live in this phase.
- Clinic-scoped photo access via membership-scoped signed-URL Edge Function works for operators whose `consent_scope.photos = true`.

**Scope expansion from original ROADMAP entry (recorded here, ROADMAP update follow-up below):**
Phase 9 absorbs the role/permission scope originally allocated to CLINIC-04..07 (Phase 10). After Phase 9 ships, Phase 10 shrinks to: roster ranking (`rankPatients(orgState)`), drill-in via SHARE-02 component reuse, and operator audit-log surface for both operator and patient.

**Out of scope (deferred):**
- Roster ranking / `rankPatients` (Phase 10)
- Drill-in via SHARE-02 component reuse (Phase 10)
- Operator audit-log surface for patients (Phase 10)
- BAA / HIPAA business-associate sign-up (counsel-led; tracked separately)
- Billing / seat scaffold (not v1)
- EHR integration (out of v1 entirely)

</domain>

<decisions>
## Implementation Decisions

### Invitation primitive + Pitfall #8 matrix

- **D-01 (LOCKED, invitation mechanism):** Custom `invites` table + hashed token. Columns: `id`, `email`, `org_id`, `invited_by`, `invite_token_hash`, `requested_scope` (jsonb — operator-suggested defaults for the consent dialog), `created_at`, `expires_at`, `accepted_at`, `rejected_at`, `consumed_at`. Email contains a magic-link URL `app.leanshot.app/clinic-invite/{rawToken}` whose hash is verified server-side. Edge Function `POST /clinic-invite/accept` and `POST /clinic-invite/reject` validate the hash and branch on whether `auth.users` already has the email. Mirrors Phase 8 D-03's hash-on-disk / token-in-URL pattern verbatim — same risk surface, same review checklist.

- **D-02 (LOCKED, email-existence privacy):** No pre-check on operator email entry. Operator UI always shows "Invite sent" regardless of whether the email has a LeanShot account. The Edge Function at `/clinic-invite/accept` does the `auth.users` lookup at the moment of acceptance and branches: existing-user → consent dialog → `memberships` insert; new-user → signup wizard → consent dialog → `memberships` insert. Prevents email enumeration via operator UI (Pitfall #8 warning sign).

- **D-03 (LOCKED, Pitfall #8 matrix verification):** Both layers required in CI.
  - **e2e (Playwright):** 5 specs covering (a) existing-personal-user + invited, (b) no-personal-user + invited, (c) existing-personal-user + 2 invitations (different orgs), (d) invited-but-never-accepts, (e) accepts-then-rejects. Each spec asserts data visibility per the consent scope and a single `auth.users` row per email at the end.
  - **pgTAP RLS impersonation:** Cross-tenant impersonation tests on `memberships`, `orgs`, `invites`, `roles`, `permissions`, and the new clinic-scoped data RLS surfaces per the project rule from `reference_supabase_project.md` memory. Catches silent RLS holes that e2e happy-paths miss.

### Consent scope granularity

- **D-04 (LOCKED, scope shape):** Granular per-data-type checkboxes in the consent dialog. Stored as `memberships.consent_scope` jsonb, e.g. `{ "injections": true, "weights": true, "photos": true, "symptoms": true, "meals": true, "workouts": true, "supplements": true, "mood": true, "sleep": true, "doctor_report": true }`. Operator's invite includes a `requested_scope` jsonb that pre-checks the dialog; patient can uncheck any field before accepting. Matches PITFALLS Pitfall #8 explicit recommendation ("granular share scope per membership").

- **D-05 (LOCKED, exposable data set):** Full set including photos. Excluded: `ai_history` (Phase 8 D-04 privacy guarantee carries forward — same `share_snapshot_view`-style structural exclusion at the SQL layer for the operator's clinic-data read paths). Photos require a new clinic-scoped signed-URL Edge Function — see D-10/D-11. Operator-visible data types: injections, weights, photos, symptoms, meals, workouts, supplements, mood, sleep, doctor_report, plus the live drug-level chart computed from injections.

- **D-06 (LOCKED, scope editable post-acceptance):** Patient can edit `consent_scope` from Settings → Active organizations → row → edit checkboxes. Update is immediate: `memberships.consent_scope` row UPDATE → operator's UI sees the new scope on next poll (or sooner via Realtime, see D-08). Every scope change writes an `audit_logs` row (extends Phase 8 D-04's `audit_logs` table — new `actor_type='org_member'` value, populates `org_id` column to be added).

### Roles + permissions (scope expansion — pulled forward from Phase 10)

- **D-07 (LOCKED, full role system in Phase 9):** Ship the full role system in this phase.
  - **Schema:** New `roles` table per org (`id`, `org_id`, `name`, `description`, `is_system`, `created_at`). Three system rows seeded on `orgs` row INSERT via trigger: `Owner`, `Coach`, `View-only`. Operator can CREATE/UPDATE/DELETE non-system roles via admin UI. New `permissions` table (`id`, `key`, `description` — global list of permission keys, NOT per-org). New `role_permissions` table (`role_id`, `permission_key`) — many-to-many. `memberships.role_id` FK to `roles`.
  - **Initial permission keys** (seed list — planner can extend): `org.read`, `org.update`, `org.delete`, `members.invite`, `members.revoke`, `members.list`, `roles.manage`, `patient_data.read`, `patient_photos.read`, `audit_log.read`. View-only seeded with `org.read`, `members.list`, `patient_data.read`. Coach seeded with everything View-only has plus `patient_photos.read` and (TBD) annotation perms. Owner seeded with all permissions.
  - **RLS dispatch:** RLS policies on clinic-scoped tables/buckets call a `has_permission(member_user_id, org_id, permission_key)` SQL helper that joins `memberships` → `roles` → `role_permissions`. Helper is `SECURITY DEFINER` with `extensions` in `search_path` per `reference_supabase_migration_gotchas.md` memory.
  - **Admin UI:** `/clinic/{slug}/settings/roles` tab. List of roles (system + custom); create/edit/delete custom roles; permission-key checkbox grid per role.
  - **ROADMAP/REQUIREMENTS update required before plan-phase:** Mark CLINIC-04..07 scope as partially absorbed into Phase 9. Phase 10 entry rewrites to: roster ranking + drill-in + operator audit-log surface. Tracked in Deferred → Follow-ups below.

### Operator UI surface

- **D-08 (LOCKED, operator workspace home + settings):** Operator lands at `/clinic/{slug}` after org-create.
  - Workspace home: empty roster shell ("No patients yet — Invite your first"), prominent "Invite patient" CTA opening an invite modal (email + scope-preselect checkboxes). Phase 10 fills the roster table with rank+drill-in.
  - Settings at `/clinic/{slug}/settings` with tabs: Workspace (name/logo/slug), Roles (D-07 admin UI), Members (invite list + revoke).
  - Smooth handoff to Phase 10; nothing thrown away.

- **D-09 (LOCKED, clinic-context bar):** Top bar on every `/clinic/{slug}/*` route shows org name + logo (logo uploaded via existing Storage path with a `org-logos` bucket, public-read since logos are non-PHI) + workspace switcher dropdown. Switcher renders: `Personal account` (always top), `Memberships` (orgs you share data with as a patient — for Phase 9 likely empty, but the rendering must be there for the Pitfall #8 single-identity invariant to be visible), `Workspaces I run` (orgs you operate). One `auth.users` → N contexts.

### Revocation latency primitive (SC#5)

- **D-10 (LOCKED, two-layer revoke):**
  - **Layer 1 — Realtime broadcast:** Operator's workspace home subscribes to a Supabase Realtime channel filtered by `org_id` for `memberships` UPDATE/DELETE events. On revoke (`memberships.revoked_at` set), the broadcast removes the row from the operator's roster within ~100-300ms. Patient-side `Settings → Active organizations` also subscribes (filtered by `user_id`) for consistency.
  - **Layer 2 — Per-request DB check:** Every operator drill-in request hits an Edge Function that re-reads `memberships.revoked_at` AND `consent_scope` for the (user_id, org_id) pair. Phase 8 D-02 primitive applied to Phase 9. 401 if revoked or `consent_scope` doesn't include the requested resource.
  - **Why both:** Realtime is the happy-path UX; DB check is the security floor. Realtime CAN drop packets (reconnect storms, slow networks); DB check CANNOT. Without Layer 2, SC#5's 1-second guarantee is best-effort, not architected.

- **D-11 (LOCKED, drill-in failure mode on revoke):** Hard 401 + toast "Patient X revoked access" + route back to `/clinic/{slug}`. No grace period; no cached data display. Matches Phase 8 SC#3's revoke semantics. Same revoke contract across all three surfaces (Phase 8 share, Phase 9 clinic, future Phase 10 drill-in via SHARE-02).

### Storage RLS for clinic-scoped photo access

- **D-12 (LOCKED, membership-scoped signed-URL Edge Function):** New Edge Function `GET /clinic/{orgId}/patient/{userId}/photo/{photoId}` that:
  1. Verifies operator is an active member of `orgId` (`memberships.revoked_at IS NULL`).
  2. Verifies operator's role has `patient_photos.read` permission via `has_permission()` helper (D-07).
  3. Verifies patient's `memberships.consent_scope.photos = true` for this org and `memberships.revoked_at IS NULL`.
  4. Generates a short-lived signed URL via `supabase.storage.createSignedUrl('photos', photo_path, TTL_SECONDS)`.
  5. Returns 401 / 403 on any failure.

- **D-13 (LOCKED, signed-URL TTL = 5 minutes):** Pragmatic choice. With D-10's Realtime channel evicting the operator's UI in 1s on revoke, the in-flight stale-URL window for newly-loaded photos is ~5 min worst case. Saved/copied URLs (e.g., DevTools-copied) work for up to 5 min post-revoke — explicitly accepted as a Phase 9 tradeoff. Re-mint on every photo request was considered but rejected on Edge Function cost. Tradeoff documented; planner is free to revisit if it shows up in security review.

### Multi-org membership UX

- **D-14 (LOCKED, single switcher grouped by relationship):** One dropdown switcher in the app shell (visible on all authenticated routes), grouped:
  1. `Personal account` (always top — your B2C app)
  2. `Memberships` — orgs that have data shared with them by you (you're a patient there)
  3. `Workspaces I run` — orgs you operate (you're an operator there)
  Each row shows context label + role badge. Selecting a memberships/workspace row routes to the org's appropriate route (`/clinic/{slug}` for operators; for patient-context viewing of "what does Org X see?" — planner picks UX, likely a read-only mirror of the consent scope).

- **D-15 (LOCKED, patient-side "Active organizations" tab):** New tab in `SettingsPage` parallel to Privacy / Recovery / Data / Active shares (Phase 8). Per-membership row shows: org name + logo, role label, `joined_at`, current `consent_scope` (clickable → edit modal), "Revoke membership" button (writes `memberships.revoked_at = now()` → Realtime broadcast → operator's roster updates). Mirrors Phase 8's Active-shares tab pattern. SettingsPage nav array gets a new entry.

### Invitation email + expiry

- **D-16 (LOCKED, dual-email design):** Resend handles the branded "Clinic X invited you" email (carries Phase 7's transactional template stack — same `noreply@app.leanshot.app` sender, WMHMDA footer carry-forward, clinic logo + org name). Supabase Auth handles the signup verification leg for new users (default Supabase signup magic-link). Flow:
  - **Existing logged-in user:** Resend email → click → already authenticated → consent dialog → accept.
  - **Existing user but logged out:** Resend email → click → land on `/clinic-invite/{rawToken}` → "Sign in to accept this invitation" → Supabase Auth magic-link (or password sign-in) → consent dialog → accept.
  - **New user (no `auth.users` row):** Resend email → click → land on `/clinic-invite/{rawToken}` → signup form → Supabase Auth signup confirmation email → confirm → consent dialog → accept.
  Planner specs the branching state machine.

- **D-17 (LOCKED, invitation expiry = 7 days):** `invites.expires_at = created_at + 7 days`. After expiry, token is rejected at `/clinic-invite/accept` (status='expired'). Operator UI surfaces expired invites with a "Re-send invite" action that creates a fresh `invites` row with a new token (old row retained for audit).

- **D-18 (LOCKED, invite lifecycle preserved as audit trail):** On acceptance, `invites.accepted_at` and `consumed_at` are set; `memberships.invited_from_invite_id` FKs back to the `invites` row. Also snapshot `invites.consent_scope_at_acceptance` (jsonb) frozen at acceptance — separate from `memberships.consent_scope` which is mutable. Row retained per existing audit retention. Critical for the Pitfall #8 matrix evidence trail.

### Claude's Discretion

- **`orgs` table schema details** — planner picks columns beyond load-bearing (`id`, `slug`, `name`, `logo_storage_path`, `owner_user_id`, `created_at`). Add `description`, `website_url` if useful.
- **Slug uniqueness + reserved words** — planner picks rules. Recommend: globally unique, lowercased, kebab-case, max length, reserved-words blocklist (`api`, `auth`, `settings`, `admin`, `app`, `clinic`, `legal`, etc.).
- **MVP slice ordering** — phase mode is `mvp`. Planner SPIDRs across roughly: (1) `orgs` + signup flow + slug + clinic-context bar, (2) `roles` + system-roles trigger + permission helper, (3) `invites` + Resend template + accept/reject Edge Functions, (4) consent dialog + `memberships` insert + Pitfall #8 matrix tests, (5) `Settings → Active organizations` + revoke flow + Realtime + per-request DB check, (6) clinic-scoped photo Edge Function + Storage permission verification, (7) roles admin UI + custom-role CRUD + permission grid, (8) multi-org workspace switcher, (9) operator workspace shell + invite modal, (10) end-to-end SC walkthrough + ROADMAP/REQUIREMENTS update. Final order is the planner's call.
- **Org-deletion + operator-offboarding semantics** — DEFERRED gray area, not discussed. Planner can spec a minimal default: deleting an org cascades `memberships` → patients notified via email + audit row + Active-orgs UI row removed; operator removing themselves from an org they own requires ownership transfer first OR explicit delete-org. Flag for review.
- **BAA/HIPAA disclosure language at consent** — DEFERRED, counsel-led. Planner should add placeholder copy and an explicit `[COUNSEL REVIEW NEEDED]` marker in the consent dialog code so the legal team can sign off before launch.
- **Realtime channel broadcast scope + cost** — planner picks. Recommend: per-`org_id` channel for the operator surface (one channel per active org), per-`user_id` channel for the patient surface. Cost-analyze for many-org tenants.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 9 requirements
- `.planning/REQUIREMENTS.md` §"Clinic / coach B2B" lines 91-93 — CLINIC-01, CLINIC-02, CLINIC-03 full text
- `.planning/ROADMAP.md` §"Phase 9: Clinic B2B Foundations" lines 187-198 — 5 success criteria, mode=mvp, depends on Phase 8
- `.planning/ROADMAP.md` §"Phase 10: Clinic Operator Surface" lines 201-205 — phases sharing the role/permission scope; update needed before plan-phase

### Pitfall #8 (load-bearing for invitation + identity decisions)
- `.planning/research/PITFALLS.md` §"Pitfall 8: B2B onboarding where the patient already has a personal account" lines 262-296 — full 5-scenario matrix, warning signs, schema recommendations

### Phase 8 carry-forward (audit_logs extension + revoke primitive)
- `.planning/phases/08-doctor-read-share/08-CONTEXT.md` D-02 (per-request DB check), D-04 (`audit_logs` schema with `actor_type` enum) — extend `actor_type` with `'org_operator'` and `'org_member'`; add `org_id` column for Phase 9 audit rows
- `.planning/phases/08-doctor-read-share/08-DISCUSSION-LOG.md` — design rationale for the revoke primitive

### Phase 7 carry-forward (audit_logs base + retention + RLS impersonation rule)
- `.planning/phases/07-compliance-foundations-legal-counsel-led/07-CONTEXT.md` D-04 — `audit_logs` retention cron (13mo rolling window)
- `supabase/migrations/20260601000001_audit_logs.sql` — base schema (columns + RLS)
- `supabase/migrations/20260601000002_audit_triggers.sql` — SECURITY DEFINER trigger pattern
- `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — GUC bypass pattern (apply preventively where Phase 9 cascade deletes touch audit_logs)

### Phase 6 carry-forward (photo Storage signed URLs)
- `.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-07 — photo Storage signed URL pattern (extended in D-12 to membership-scoped)

### Phase 5 carry-forward (auth + RLS + Realtime patterns)
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-CONTEXT.md` — RLS on `injections` (the model for clinic-scoped RLS extensions), Realtime channel setup

### Phase 4 carry-forward (Edge Function template)
- `supabase/functions/ai-chat/` — Edge Function template (auth header, rate limit, structured response, CORS) — three new functions follow this pattern: `/clinic-invite/accept`, `/clinic-invite/reject`, `/clinic-photo/{orgId}/{userId}/{photoId}`

### Phase 7 — Resend transactional email stack
- `supabase/functions/send-data-export/` (or equivalent — planner verifies) — Resend setup, sender, branded template structure, WMHMDA footer template

### Existing app entry points (extension targets)
- `src/components/dashboard/settings/SettingsPage.tsx` — extension point for "Active organizations" tab (sibling to Phase 7's Privacy + Recovery + Data and Phase 8's Active shares)
- `src/App.tsx` — `selectView` branching for `/clinic/{slug}/*` and `/clinic-invite/{token}` routes (mirrors Phase 7 `'legal'` and Phase 8 `'share'` branches; same lazy-load pattern)

### Project rules / memories
- `reference_supabase_project.md` (memory) — every new RLS surface gets a live cross-tenant impersonation proof test (applies to `orgs`, `memberships`, `invites`, `roles`, `role_permissions`, `org-logos` bucket, clinic-scoped photo access paths)
- `reference_supabase_migration_gotchas.md` (memory) — IMMUTABLE partial-index expressions; SECURITY DEFINER `extensions` search_path; Storage delete bypass GUC; cascade DELETE + audit_logs GUC suppression
- `feedback_parallel_executor_git_isolation.md` (memory) — Phase 9 likely has 10+ plans → execute waves must use `git commit -- <pathspec>` to avoid index contamination across parallel executors

### Plan 07-02c carry-forward (deferred test cluster — DO NOT touch in Phase 9)
- `.planning/deferred-tests.md` — 6 e2e specs still `test.fixme`'d pending RC5 remediation. Phase 9 plans MUST NOT introduce new specs that share the RC5 cold-CI Realtime cluster failure mode (no two-context Realtime polling tests until RC5 is fixed). Note: Phase 9's revoke flow IS a two-context Realtime polling scenario — planner needs to either gate on RC5 fix, run in foreground-only test mode, or design the test to avoid the failure cluster.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`audit_logs` table + trigger pattern (Phase 7 + Phase 8 extensions)** — extend with `'org_operator'` and `'org_member'` actor_type values; add `org_id` nullable FK column. Same retention surface.
- **`ai-chat` Edge Function (Phase 4)** — copy as template for `/clinic-invite/*` and `/clinic-photo/*` Edge Functions. Same auth header, rate-limit, CORS, structured-response shape.
- **`SettingsPage.tsx` nav-array extension** — add `{ id: 'organizations', label: 'Active organizations', Icon: ... }` between Privacy/Recovery and Active shares. Section-component pattern is established across Phases 6/7/8.
- **`App.tsx` `selectView` branching** — Phase 7 ships `'legal'` lazy branch, Phase 8 ships `'share'` lazy branch. Phase 9 adds `'clinic'` and `'clinic-invite'` branches with the same lazy-load pattern. Bundle-size CI ceiling still 50 kB index gz — clinic surface lazy-loads.
- **Realtime channel subscribe wrapper (Phase 5/6)** — patient-side channels filtered by `user_id`. Phase 9 adds operator-side channels filtered by `org_id` (new pattern; planner specs auth check on subscribe).
- **Photo signed-URL pattern (Phase 6 D-07)** — patient-only today; D-12 generalizes to membership-scoped.
- **Resend transactional email stack (Phase 7)** — branded template + sender + WMHMDA footer. New `clinic-invite` template inherits.

### Established Patterns
- **One `auth.users` per email, relationship tables for context** (Pitfall #8) — `memberships` is the relationship; `auth.users` is the identity. Never duplicate.
- **DB-row-checked revocation + Realtime as UX overlay** (Phase 8 D-02) — applied to Phase 9 memberships verbatim in D-10.
- **RLS impersonation proof per surface** (project rule) — every new table/bucket gets a pgTAP-style cross-tenant test.
- **Granular consent jsonb on the relationship table** (PITFALLS recommendation) — `memberships.consent_scope` is the canonical store.
- **Migration gotchas applied preventively** — see migration memory.

### Integration Points
- Supabase Auth (existing) — invite acceptance branches use `supabase.auth.getUser()` to detect logged-in state.
- Supabase Storage `photos` bucket (Phase 6) — extends to operator-readable via D-12 Edge Function (does NOT add a Storage policy directly; the Edge Function mints the signed URL).
- Supabase Realtime (Phase 5/6) — new org-scoped channels (auth-on-subscribe via JWT claim check).
- Resend (Phase 7) — new transactional template.
- SettingsPage (Phase 6/7/8) — new "Active organizations" tab.

</code_context>

<specifics>
## Specific Ideas

- **Workspace URL shape:** `app.leanshot.app/clinic/<slug>` — path-based, kept consistent with ROADMAP SC#1 wording.
- **Single switcher, grouped by relationship:** Personal account always at top; Memberships group; Workspaces I run group. Critical that even users with 0 memberships and 0 workspaces still see the personal-account entry — it's the Pitfall #8 single-identity affordance.
- **Operator UI on org-create lands at workspace home, not settings.** Empty roster shell with prominent "Invite patient" CTA is what gets demoed for SC#1.
- **5-minute signed-URL TTL is an explicit risk tradeoff** — user accepted the in-flight stale-URL window in exchange for Edge Function cost reduction. Document this in security review notes when the phase ships.
- **Three default roles seeded on org-create** — Owner (everything), Coach (TBD — at minimum read patient_data, read patient_photos, possibly annotations later), View-only (read patient_data only). Custom roles use the same permission grid.

</specifics>

<deferred>
## Deferred Ideas

### Out of scope (other phases or vNext)
- **Roster ranking + drill-in (Phase 10):** `rankPatients(orgState)` + drill-in via SHARE-02 component reuse stay in Phase 10. Phase 10 shrinks but doesn't go away.
- **Operator audit-log surface (Phase 10):** Patient sees the operator's actions in their Active-orgs row; operator's org-owner sees member actions in the Roles tab. Out of Phase 9.
- **Doctor accounts (vNext / SHARE-V2-01):** Not Phase 9.
- **EHR integration (out of v1):** Per PITFALLS — pushes into HIPAA covered status; deliberately out.
- **Billing / seat scaffold:** Not v1.

### Recorded gray areas not deep-dived (planner picks minimal defaults)
- **Org-deletion + operator-offboarding semantics:** Planner specs a minimal default; flag for review.
- **BAA/HIPAA disclosure language at consent:** Counsel-led; planner adds `[COUNSEL REVIEW NEEDED]` placeholder copy.
- **Slug uniqueness rules + reserved-words list:** Planner picks; recommend reserved-words blocklist.
- **Realtime channel cost model for many-org tenants:** Planner cost-analyzes.

### Follow-ups required BEFORE plan-phase
- **ROADMAP/REQUIREMENTS update** — Phase 9 entry needs to absorb the role/permission scope from CLINIC-04..07. Phase 10 entry rewrites to: roster ranking + drill-in + operator audit-log surface. Run `/gsd-phase --edit 9` and `/gsd-phase --edit 10` (or equivalent), or apply an inline ADDENDUM per `feedback_addendum_pattern_for_mid_execution_pivots.md` memory if mid-execution speed matters more than perfect ROADMAP hygiene.

</deferred>

---

*Phase: 9-Clinic B2B Foundations*
*Context gathered: 2026-05-12*
