# Phase 28: Clinic Organizations — Schema + RLS Hardening - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Lock in the multi-tenant `org_id` axis on top of existing v1.1 Phase 9 `src/lib/clinic.ts` surface so the first clinic deal can close mid-v1.3. Three deliverables ship together:

1. **8 net-new org-scoped tables with full RLS + cross-tenant impersonation proof tests** — `organizations`, `org_members`, `org_invites`, `org_subscriptions`, `org_settings`, `org_branding`, `org_patient_links`, `org_consent_grants`. Each table ships with: RLS policies that JOIN on `org_id` (per [[reference_supabase_project]]); a paired `*-rls.test.ts` using `admin.generateLink + /auth/v1/verify` (per [[reference_rls_fixture_gotrueclient_flake]]); per-file slug prefix (per [[feedback_rls_per_file_slug_prefix]]); proves User A in Org X CANNOT read User B in Org Y.

2. **4-vector leak defense** —
   (a) **`withOrgScope` brand-typed wrapper** with layered enforcement: TS brand types so `createClient(SERVICE_ROLE_KEY)` returns `ServiceRoleClient<Unscoped>` that physically cannot `.from(...)` until wrapped; custom ESLint rule banning raw service-role-client construction outside `src/server/with-org-scope.ts`; runtime assertion in the wrapper + Sentry alert if a bypass somehow lands.
   (b) **JWT `app_metadata.org_ids` claim** propagated via Supabase Auth hook on `org_members` INSERT/DELETE (research at planning time: trigger calling `auth.admin.updateUserById` vs custom claim function); 336ms window handled via skeleton on roster + non-blocking workspace-switcher spinner.
   (c) **HMAC-derived realtime channel names** — channel format `org-{hmac8}-{table}`, HMAC input `org_id || ':' || table_name`, secret in Supabase Vault (extends Phase 22 vault pattern); channel auth callback recomputes HMAC server-side in `realtime.messages` RLS policy.
   (d) **Cross-tenant proof tests per table** (extends project rule from `user_id` axis to `org_id` axis).

3. **`src/lib/org.ts` org-context layer (NEW, additive sibling to Phase 9 `clinic.ts`)** — resolves current org via path `/clinic/{slug}` → `org_members.org_id` lookup → injection into every supabase-js client query via `useCurrentOrg()` hook; exposes `surfaceCheck(permission)`, `withOrgPath(path)`, `overlayBrandingTokens()`. `clinic.ts` stays UNCHANGED — it just reads orgId from `org.ts` instead of taking it as a parameter where appropriate.

REQ coverage: ORG-01, ORG-02, ORG-03, ORG-04, ORG-05, ORG-06, ORG-07 (7/7).

Out of scope: org subscriptions billing logic (Phase 29 owns `org_subscriptions` writes + Stripe metered); clinician dashboard + custom rank weights + alerts (Phase 30); white-label theming + 3-role admin matrix UX + onboarding builder (Phase 31); subdomain white-label `acme.leanshot.app` (deferred to v1.5). The **+8 downstream tables** referenced in ROADMAP ("16+ org-scoped tables") ship in their owning phases (org_subscription_meters → P29; clinician_alerts/ranking_weights/ranking_snapshots → P30; org_branding_themes/onboarding_flows/onboarding_steps/locale_overrides_org → P31), each inheriting the RLS template + cross-tenant test recipe P28 establishes.

</domain>

<decisions>
## Implementation Decisions

### org-context layer + Phase 9 carry-forward

- **D-01 — `src/lib/org.ts` is an additive SIBLING to Phase 9 `src/lib/clinic.ts`; clinic.ts stays unchanged.** org.ts owns org-context (current org resolution, `useCurrentOrg()` hook, `surfaceCheck`, theme overlay, path helpers). clinic.ts continues as the typed-RPC + Result-discriminated-union layer; where wrappers take an explicit `org_id` parameter, P28 callers pass `org.getCurrentOrgId()` rather than re-deriving. Zero Phase 9 wrapper signatures change in P28 — backwards-compat preserved; Phase 9 callsites (workspace switcher, settings, invite acceptance) unaffected. Smallest blast radius given clinic.ts already enforces the Pitfall #8 jsonb shape guards + Result-union contract that downstream agents rely on.
- **D-02 — Current-org resolution precedence:** (1) path `/clinic/{slug}` parsed by `<RouteOrgGuard>` wrapper inside `src/components/clinic/*` route trees; (2) fallback to `org_members.org_id` joined to current `auth.uid()` and SELECT-most-recent `last_active_at`; (3) null when user has no org membership (renders consumer surface). Lookup cached in Zustand slice `org`; invalidated on Auth `USER_UPDATED` events (covers org-membership changes).
- **D-03 — `src/lib/org.ts` exports:** `useCurrentOrg()` (React hook, returns `{org, role, loading}`), `getCurrentOrgId()` (imperative, throws on null), `getCurrentOrgIdOrNull()` (imperative, returns null without throw), `surfaceCheck(permission: PermissionKey)` (boolean against `org_member_role` enum), `withOrgPath(relativePath)` (prefixes with `/clinic/{slug}`), `overlayBrandingTokens(org_branding_row)` (applies CSS custom-property overrides to `<html>`).

### withOrgScope service_role wrapper (SC#3 + V13-2 mitigation 3)

- **D-04 — Layered enforcement: brand types + ESLint rule + runtime assert + Sentry alert.** Per aggressive-foundations posture; HIPAA stakes justify defense-in-depth.
- **D-05 — Brand types:** `createClient(url, SERVICE_ROLE_KEY)` is re-exported from `src/server/supabase-server.ts` as `_createServiceRoleClientUnsafe()` returning `ServiceRoleClient<Unscoped>` — a branded type whose `.from()`/`.rpc()` methods are `never`. `withOrgScope(orgId, fn)` returns `ServiceRoleClient<OrgScoped>` (full surface area) for use inside `fn`. Bypass would require `as any` (forbidden by ESLint `no-explicit-any` in this directory).
- **D-06 — Custom ESLint rule `no-raw-service-role-client`:** lives at `eslint-rules/no-raw-service-role-client.js` (existing custom-rules dir per repo layout). Blocks `createClient(..., SUPABASE_SERVICE_ROLE_KEY)` anywhere except inside `src/server/with-org-scope.ts`. CI step `npm run lint` fails the PR. Uses AST node matching (import + identifier name + arg position).
- **D-07 — Runtime assertion + Sentry alert in the wrapper:** `withOrgScope(orgId, fn)` runs `fn(scopedClient)` inside a try/finally where the scoped client interposes `.from(table)` to inspect the resulting query builder before `.then()` resolves. If no `.eq('org_id', orgId)` and no `.contains('org_ids', [orgId])` was applied AND the table is in the org-scoped allowlist (`org_scoped_tables` const exported from `src/server/with-org-scope.ts`), the wrapper throws `OrgScopeBypassError` + emits `Sentry.captureException` with `level: 'fatal'` and tag `org_scope_bypass: true`. CI lint script greps for any new table inserted into a migration without inserting it into the const list (open PR check).
- **D-08 — Allowlist of org-scoped tables:** const exported from `src/server/with-org-scope.ts`; covers the 8 P28 tables + extension contract requires downstream phases to add their tables here when shipping. Plan-checker BLOCKER on any new `*-rls-test.ts` whose target table is missing from this const.

### JWT app_metadata.org_ids (ORG-02 / V13-2 mitigation 2)

- **D-09 — Claim populated via `org_members` INSERT/UPDATE/DELETE trigger that calls `auth.admin.updateUserById`.** Per [[reference_supabase_app_metadata_jwt_propagation]] — 336ms propagation window. Trigger function runs `SECURITY DEFINER`, search_path explicit (per [[reference_supabase_migration_gotchas]]). Suppresses recursion via `app.suppress_audit` GUC pattern. Single trigger handles INSERT (add org_id to array), DELETE (remove), UPDATE (no-op since org_id is immutable per D-11). Research at planning time may discover Supabase shipped a "custom access token hook" path that's preferable — researcher decides.
- **D-10 — Propagation UX: skeleton on roster + non-blocking workspace-switcher spinner.** On workspace switch OR fresh login post-invite-acceptance, poll `supabase.auth.getSession().user.app_metadata.org_ids` every 100ms up to 600ms ceiling; render existing Phase 9 roster skeleton; workspace-switcher chip shows inline `<Spinner size="xs" />` next to org name. No modal, no full-page block. If claim still absent after 600ms, fall back to `select 1 from org_members where user_id = auth.uid() and org_id = ?` as a freshness probe (gives clinician an explicit "Retry" affordance instead of silent forever-loading).

### Schema (8 tables) + role model

- **D-11 — `organizations` columns:** `id uuid pk default gen_random_uuid()`, `slug text unique not null`, `name text not null`, `created_at timestamptz default now()`, `created_by uuid references auth.users(id) on delete restrict`, `status org_status default 'active'` (enum: 'active','suspended','archived'), `is_public_listing boolean default false` (reserved for v1.4 — see D-15), `current_rank_weights_version uuid null` (reserved for P30). RLS: SELECT for org_members; UPDATE for admin role only; DELETE blocked (use status='archived').
- **D-12 — `org_members` role: SINGLE role enum per row.** `create type org_member_role as enum ('admin','staff','viewer')`. Schema: `id uuid pk`, `org_id uuid references organizations`, `user_id uuid references auth.users on delete cascade`, `role org_member_role not null`, `joined_at timestamptz default now()`, `last_active_at timestamptz`, `unique(org_id, user_id)`. P31 will ship the permission-matrix as a `const ROLE_PERMISSIONS` TypeScript map keyed by role — NO permissions table in v1.3 (deferred to v1.5 enterprise customization per D-30). Multi-hat users get multiple rows (one per org).
- **D-13 — `org_invites`:** `id uuid pk`, `org_id`, `email citext not null`, `invited_role org_member_role not null`, `invite_token_hash text not null` (SHA-256, matches Phase 9 pattern in clinic.ts:makeInviteTokenHash), `expires_at timestamptz default now() + interval '7 days'`, `accepted_at timestamptz null`, `created_by uuid`. RLS: SELECT by org admins only; INSERT via SECDEF RPC `send_org_invite` (re-uses Phase 9 W-1 fix — does NOT reveal whether email matches existing user); DELETE via `revoke_org_invite` SECDEF.
- **D-14 — `org_subscriptions` (skeleton only; P29 owns writes):** `org_id pk`, `stripe_customer_id text`, `stripe_subscription_id text null`, `status text default 'pending'`, `current_period_end timestamptz null`, `seats_paid int default 0`, `seats_used int default 0`. RLS deny-all for v1.3 P28 (only P29's `org-subscription-webhook` Edge Function writes); SELECT for org admins. P28 ships migration + RLS deny matrix + cross-tenant test; P29 adds INSERT/UPDATE policies and Stripe webhook glue.
- **D-15 — `org_settings`:** `org_id pk`, `default_timezone text default 'UTC'`, `enforce_clinician_mfa boolean default true` (per Phase 25 D-10 hard-cut), `auto_revoke_inactive_after_days int default 90` (clinician account hygiene; surfaced in P30), `mask_patient_emails_in_roster boolean default false`, `notification_email citext null`. RLS: SELECT for org_members; UPDATE for admin only.
- **D-16 — `org_branding` (skeleton only; P31 owns full theme overlay):** `org_id pk`, `logo_url text null`, `primary_color text null`, `accent_color text null`, `font_family text null`, `support_email citext null`, `updated_at timestamptz`. RLS: SELECT for org_members; UPDATE for admin only. P28 ships the table + RLS + a minimal `overlayBrandingTokens()` that handles primary_color + accent_color via CSS custom-property override; P31 expands to full token map + onboarding-flow theming.
- **D-17 — `org_patient_links`:** `id uuid pk`, `org_id`, `patient_user_id uuid references auth.users on delete cascade`, `linked_by uuid references auth.users` (the clinician who accepted), `linked_at timestamptz default now()`, `unlinked_at timestamptz null` (soft-delete; preserves audit trail per [[project_v1.1_archived]]), `consent_grant_id uuid references org_consent_grants`. RLS: SELECT for org_members of this org_id JOIN; SELECT for the patient themselves (their own `patient_user_id`); INSERT via SECDEF `link_org_patient` RPC that requires accepted `org_consent_grants` row.
- **D-18 — `org_consent_grants`:** mirrors existing Phase 9 `memberships` consent pattern but at org-axis. `id uuid pk`, `org_id`, `patient_user_id`, `scope jsonb not null` (uses Phase 9 `_validate_consent_scope` strict-shape guard — DO NOT duplicate the shape contract; import existing function per [[feedback_planner_iter1_anti_patterns]] anti-pattern #4), `granted_at timestamptz default now()`, `revoked_at timestamptz null`, `granted_via text` (enum: 'invite','manual','migration'). RLS: SELECT for the patient (their own row); SELECT for org admins of this org_id; INSERT/UPDATE via SECDEF only.

### `/clinic/{slug}` routing for non-members (ORG-07)

- **D-19 — Auto-detect pending `org_invites` row → prompt accept; else 404 generic not-found.** Server-side resolver (in `<RouteOrgGuard>`) calls SECDEF RPC `resolve_clinic_slug(slug)` returning `{state: 'member'|'pending_invite'|'not_found', org_summary?, invite_summary?}`. The RPC does NOT leak organization existence to non-members — `not_found` is returned both when the slug doesn't exist AND when it exists but visitor has no relationship to it. Member → render clinic surface. Pending invite → render invite-acceptance UI (re-uses Phase 9 invite-accept flow). Not found → render generic LeanShot 404. Defers public clinic-landing pages (D-15 `is_public_listing` column reserved) to v1.4 if clinic-acquisition ROI later justifies the attack-surface expansion.

### HMAC realtime channel names (SC#4 / V13-2 mitigation 4)

- **D-20 — Channel name format: `org-{hmac8}-{table}`.** Literal 8-character truncated lowercase-hex HMAC. Examples: `org-7f3c9a1d-patients`, `org-7f3c9a1d-clinic_alerts`. Truncation acceptable per SC#4 + collision risk negligible at clinic-count scale (<10K orgs × <50 tables; 32-bit collision space ~1 in 4B per pair).
- **D-21 — HMAC input: `org_id || ':' || table_name`.** Deterministic; same channel name across all members of an org for a given table.
- **D-22 — Secret source: Supabase Vault, single per-deployment secret `org_realtime_channel_secret`.** Extends Phase 22 Vault pattern. Rotation procedure (deferred to operational runbook): bump secret in Vault → push new claim-derivation migration → all clients re-derive on next session refresh → cleanup old channel subscriptions after 1h. Per-org secret rotation (alternative) NOT pursued — operational burden outweighs threat-model gain at v1.3 trust posture.
- **D-23 — Channel auth callback: `realtime.messages` RLS policy recomputes HMAC server-side.** Policy: `topic ~ ('^org-[0-9a-f]{8}-' || allowed_table_regex)` AND `topic = 'org-' || left(encode(hmac(get_realtime_secret(), claim('sub_org_id') || ':' || split_part(topic, '-', 3), 'sha256'), 'hex'), 8) || '-' || split_part(topic, '-', 3)`. Where `get_realtime_secret()` is a SECDEF function reading Vault. Combined with existing Phase 9 `clinic-realtime.ts` setAuth-before-subscribe pattern (do NOT regress that). Channel subscribe rejected if mismatched.
- **D-24 — Generator: `src/lib/org-realtime.ts` exports `channelNameFor(orgId, table)`.** Browser-side helper computes HMAC via `crypto.subtle` (matches Phase 9 makeInviteTokenHash pattern). HMAC secret fetched from a one-time-per-session SECDEF RPC `get_realtime_channel_keying()` that returns the secret to authenticated users only. Cached in Zustand for session duration. Net-new file; does not modify existing `clinic-realtime.ts` (continues to handle private-channel auth + defer-mount safety per its docstring).

### Cross-tenant impersonation proof tests (SC#1 / ORG-05)

- **D-25 — One `<table>-rls.test.ts` per net-new table.** 8 test files live in `src/lib/__tests__/rls-org-*` or `e2e/rls-org-*` (planner decides — match existing v1.2 convention); use `admin.generateLink + plain fetch /auth/v1/verify` (per [[reference_rls_fixture_gotrueclient_flake]] 2026-05-16 fix on ES256 projects); file-scoped slug prefix (per [[feedback_rls_per_file_slug_prefix]]); afterAll cleanup keyed by file slug. Each test fixture: 2 orgs (Org X, Org Y), 2 users (User A in X, User B in Y). Assertions: User A reading via User B's JWT returns 0 rows on every SELECT path; INSERT for Org Y while authed as User A fails (RLS deny); UPDATE/DELETE same.
- **D-26 — Plan-checker BLOCKER:** any new org-scoped migration without paired `*-rls.test.ts` fails plan-checker (per V13-2 mitigation 1 + extends project rule). Planner adds this check explicitly to plan-checker prompt for P28.
- **D-27 — Realtime-channel cross-tenant test:** drive subscribe via Playwright as User A → assert subscribe to `channelNameFor(orgY, 'patients')` returns CHANNEL_ERROR (per [[feedback_realtime_layer_e2e_pattern]] DB-level invariant pattern, instantiate receiving operator's supabase-js channel.subscribe() directly in test file).
- **D-28 — `withOrgScope` bypass test:** Vitest unit test that constructs `_createServiceRoleClientUnsafe()` and asserts `.from('any_table')` is typed `never` (compile-time fence); runtime test that calls `withOrgScope(orgId, async (c) => c.from('patients').select())` and asserts an `OrgScopeBypassError` is NOT thrown (well-formed); calls `c.from('patients').select().not.eq('org_id', orgId)` and asserts the bypass error IS thrown.

### Extension contract for downstream phases

- **D-29 — `28-EXTENSION-CONTRACT.md` ships alongside CONTEXT.md.** Owned by P28; consumed by P29/P30/P31 (and beyond). Contains: (a) RLS policy template for org-scoped tables (SELECT/INSERT/UPDATE/DELETE shapes with placeholders); (b) cross-tenant test recipe (test fixture skeleton + assertion checklist); (c) naming conventions (table prefix `org_*` mandatory for downstream tables; column `org_id uuid not null references organizations(id) on delete restrict` mandatory); (d) `org_scoped_tables` const update checklist (every new table added to the const in `src/server/with-org-scope.ts`); (e) HMAC channel-name registration checklist (new tables added to `allowed_table_regex` in D-23 RLS policy). Plan-checker for P29/P30/P31 reads this file as mandatory input.

### Claude's Discretion

Researcher and planner have latitude on:
- Exact AST-matching shape for the `no-raw-service-role-client` ESLint rule (D-06) — consult existing custom rules in `eslint-rules/` for stylistic consistency.
- Exact mechanism for `withOrgScope` query-builder interposition (D-07) — supabase-js v2 PostgrestQueryBuilder is a thenable; researcher decides between `Proxy` wrap, prototype patch, or method-override.
- Whether JWT `org_ids` claim is populated via `org_members` trigger (D-09) OR Supabase Custom Access Token Hook (newer; may be cleaner) — researcher checks current Supabase docs.
- Whether SECDEF RPC `get_realtime_channel_keying()` returns the raw secret OR a derived per-session token (D-24) — researcher trades off secret-exposure window vs derivation simplicity.
- Exact location of RLS test files (D-25) — `src/lib/__tests__/` vs `e2e/` per v1.2 convention. Tradeoff: vitest (faster, isolated DB) vs Playwright (closer to prod auth flow).
- Whether `org_consent_grants.scope` validation function is imported from Phase 9 (`_validate_consent_scope`) or a new org-scoped variant — recommend re-use per [[feedback_planner_iter1_anti_patterns]] #4.
- pg_cron schedule for `org_invites` expiry-purge (recommend nightly at 04:00 to avoid existing cron collisions per P26 D-07 idempotency pattern).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 28 (lines 140–149) — Goal + 5 success criteria + 7 REQ list.
- `.planning/REQUIREMENTS.md` lines 116–122 — ORG-01..ORG-07 full text.
- `.planning/REQUIREMENTS.md` lines 463–469 — ORG-NN → phase mapping table.

### v1.3 Research
- `.planning/research/SUMMARY.md` — V13-2 (multi-tenant leak) LANDMINE-class; "Foundation-first then parallel-track" sequencing.
- `.planning/research/PITFALLS.md` §V13-2 (multi-tenant clinic org_id leakage) — 4-vector attack model (service_role bypass, JOIN policy gap, realtime channel collision, email collision); 5 mitigations P28 implements.
- `.planning/research/ARCHITECTURE.md` — `withOrgScope` wrapper pattern; HMAC realtime; org-context layer placement between Zustand and supabase-js.
- `.planning/research/STACK.md` — supabase-js v2 + AWS SES (P25) + Stripe (P29) baseline.

### Phase 24 + 25 + 27 carry-forward (load-bearing prerequisites)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — admin role enum + ADMIN_MODULES manifest; audit_logs schema (P28 RPCs all call `log_admin_action`); TOTP / aal2 (D-06..D-09); bundle ceilings — P28 admin-shell stays ≤30 kB gz.
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — `phi_access_log` (org-side patient detail opens trigger this); MFA hard-cut on `/clinic/*` (D-10); PostHog session-replay regex covers `/clinic/*` (D-16); subprocessor-diff cron (P28 doesn't add subprocessors, but `org_subscriptions` Stripe customer namespace must reference Phase 25's Stripe-NEVER-PHI lint).
- `.planning/phases/27-modular-admin-shell-extensions/27-CONTEXT.md` — cohort builder `has_org` field (P27 D-06) reads `org_id IS NOT NULL`; bulk actions explicitly out-of-scope for per-org (P27 §"Out of scope" — P28 owns org-scoping for bulk actions if needed in v1.4).

### Phase 9 carry-forward (existing clinic surface — NOT touched in P28)
- `src/lib/clinic.ts` lines 1–120 — 16 SECDEF RPC wrappers + Result discriminated unions + `_validate_consent_scope` shape guard pattern. P28 org.ts CONSUMES these; does not modify.
- `src/lib/clinic-realtime.ts` — setAuth-before-subscribe + defer-mount safety + migration-12 private-channel auth pattern. P28 org-realtime.ts COMPOSES with this; does not modify.
- `src/lib/clinic-permissions.ts` + `src/lib/clinic-events.ts` — Phase 9 permission model surface that org.ts `surfaceCheck` extends.
- `src/types/clinic.ts` — ConsentScope type + isConsentScope guard re-used by `org_consent_grants`.

### Project rules (memory)
- `[[reference_supabase_project]]` — Project-level rule: every RLS surface gets a live cross-tenant impersonation proof test. P28 EXTENDS from `user_id` axis to `org_id` axis (per ORG-05).
- `[[reference_rls_fixture_gotrueclient_flake]]` — RLS test fixture pattern (`admin.generateLink + /auth/v1/verify` plain fetch, ES256-compatible 2026-05-16 fix). MANDATORY for all 8 test files.
- `[[feedback_rls_per_file_slug_prefix]]` — File-scoped TEST_SLUG_PREFIX + afterAll cleanup; required because vitest file-parallelism otherwise clobbers shared prefixes.
- `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant verification > UI traversal for realtime tests. Apply to D-27 cross-tenant channel test.
- `[[reference_supabase_app_metadata_jwt_propagation]]` — 336ms claim propagation window; UI loading-state required.
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER needs `extensions` in search_path; partial-index expressions must be IMMUTABLE; audit cascade needs `app.suppress_audit` GUC.
- `[[reference_supabase_migration_filename_regex]]` — strict `<14-digits>_name.sql`; letter-suffix timestamps SILENTLY SKIPPED.
- `[[feedback_planner_iter1_anti_patterns]]` — defensive jsonb contracts: cohort/scope rule shape lives in ONE TS type + ONE DB validator function. D-18 explicitly re-uses Phase 9 `_validate_consent_scope` instead of duplicating.
- `[[feedback_status_machine_transition_owner]]` — every status enum value needs an owning plan+task. P28 `org_invites.status` (pending → accepted | expired | revoked) + `org_subscriptions.status` ownership table required in PLAN.
- `[[reference_vendor_gated_send_health_check]]` — P28 doesn't introduce new vendor send, but `org_consent_grants` granted_via='invite' code path depends on Phase 9 invite-email send (Resend non-PHI path per P25 D-03); inherit health-check pattern.
- `[[feedback_chunked_planning_integration_seam_blindspot]]` — at outline time, name the owner of the wire between org.ts and Phase 9 clinic.ts. Don't leave it unassigned.
- `[[feedback_inline_fix_over_replan]]` — for plan-checker iter-1 BLOCKERs, prefer surgical Edit over re-spawn.
- `[[reference_bundle_budget_hash_hyphen]]` — P28 adds ~5-8 kB gz to admin-shell chunk (org.ts + org-realtime.ts + withOrgScope client wrappers); verify against P24 D-18 chunk ceilings.

### External docs (consult via Context7 at research time)
- Supabase Auth — Custom Access Token Hook (newer alternative to D-09 trigger; researcher decides).
- Supabase `realtime.messages` RLS policy syntax + `claim()` helper.
- Supabase Vault SECDEF read pattern for `get_realtime_secret()` (D-23).
- supabase-js v2 PostgrestQueryBuilder thenable surface (for D-07 interposition).
- Postgres `hmac()` + `encode(... , 'hex')` + `left()` for D-23 RLS policy regex.
- ESLint custom-rule AST-node matching for `CallExpression` with identifier name `createClient` + 2nd-arg identifier `SUPABASE_SERVICE_ROLE_KEY`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/lib/clinic.ts`** — 16 SECDEF RPC wrappers + Result discriminated unions + `mapPgError` + `makeInviteTokenHash` + `_validate_consent_scope` shape guard. P28 `org.ts` CONSUMES these as-is. No signatures change.
- **`src/lib/clinic-realtime.ts`** — setAuth-before-subscribe + defer-mount safety pattern. P28 `org-realtime.ts` COMPOSES with this for HMAC channel names; the underlying private-channel auth and JWT-freshness handling stays.
- **`src/lib/clinic-permissions.ts`** — Phase 9 permission model the `surfaceCheck()` helper (D-03) extends.
- **`src/types/clinic.ts`** — `ConsentScope` + `isConsentScope` guard re-used by `org_consent_grants` (D-18).
- **`src/lib/supabase.ts`** — browser client singleton; pattern target for `src/server/supabase-server.ts` (NEW) hosting `_createServiceRoleClientUnsafe()`.
- **`src/lib/admin/*`** (Phase 24) — `admin-api.ts`, `roles.ts`, `totp.ts` — the admin-role enum + aal2 step-up patterns that gate org-admin destructive RPCs.
- **`eslint-rules/`** — existing custom-rule dir; pattern target for `no-raw-service-role-client.js` (D-06).
- **Phase 24 `audit_logs` + `log_admin_action`** — all P28 SECDEF RPCs (link_org_patient, revoke_org_invite, send_org_invite, etc.) write here.

### Established Patterns
- **Pattern S1 (dual-layer security)** — Phase 24 D-03. Every P28 SECDEF RPC: client gate (org.ts surfaceCheck) + DB SECDEF re-check (role lookup inside the function).
- **Append-only RLS** — Phase 24 D-17 + Phase 27 D-23. Applied to `org_consent_grants` (granted_at/revoked_at additive only — never UPDATE the scope jsonb).
- **Cross-tenant RLS test fixture** — `admin.generateLink + plain fetch /auth/v1/verify` (project rule 2026-05-16 ES256 fix). All 8 new test files MUST use this; never raw `signInWithPassword`.
- **Per-file slug prefix in RLS suites** — vitest file-parallelism otherwise clobbers shared prefixes (P22 lesson).
- **`_validate_consent_scope` shape guard** — Phase 9 jsonb defensive contract; ONE TS type + ONE DB validator. D-18 re-uses; does not duplicate.
- **`p_org_id` parameter convention** — Phase 9 RPC convention (e.g., `createOrg` uses `p_org_id: p.org_id`); all P28 SECDEF RPCs follow.
- **migration filename: `<14-digit-timestamp>_<snake_case_name>.sql`** — strict (letter-suffix silently skipped).
- **SECURITY DEFINER functions explicit search_path** — `set search_path = pg_catalog, public, extensions` (per `reference_supabase_migration_gotchas`).

### Integration Points
- **`<RouteOrgGuard>`** (NEW component in `src/components/clinic/RouteOrgGuard.tsx`) — wraps `/clinic/{slug}/*` routes; resolves slug → org via `resolve_clinic_slug()` RPC (D-19); injects org context.
- **Zustand store slice `org`** (NEW) — `{currentOrg, role, loading}`; subscribed to Auth `USER_UPDATED` for invalidation.
- **`src/lib/admin/modules.ts`** (Phase 24) — register a P28 module entry for an org-admin "Members & Invites" pane (preview only; full UI lives in P31). Bundle-budget impact tracked against admin-shell 30 kB gz.
- **`src/main.tsx`** — Auth `USER_UPDATED` listener (existing) fires `org` slice invalidation.
- **Phase 25 `phi_access_log`** — org-side patient detail opens write here (Phase 25 D-07). P28 `<PatientDetailDrawer>` (existing v1.1 from Phase 10) must be checked to ensure the `select log_phi_access(...)` RPC call lands when accessed via `/clinic/{slug}` route.
- **CI workflow** — adds `npm run lint` step (already runs) now enforces `no-raw-service-role-client`; adds plan-checker step to grep new migrations against `org_scoped_tables` const + paired `*-rls.test.ts`.

</code_context>

<specifics>
## Specific Ideas

- 8 org-scoped tables enumerated in D-11..D-18; +8 downstream tables explicitly OUT-OF-SCOPE for P28 (deferred to P29/P30/P31 per D-29 extension contract).
- Channel name format literal: `org-{8-char-truncated-lowercase-hex-hmac}-{table_name}`.
- HMAC input literal: `org_id || ':' || table_name`.
- HMAC secret single per-deployment, stored in Supabase Vault, key `org_realtime_channel_secret`.
- JWT propagation window: 336ms; polling ceiling 600ms; fallback freshness probe with explicit retry UI.
- `org_member_role` enum values: 'admin', 'staff', 'viewer'.
- `org_status` enum values: 'active', 'suspended', 'archived' (no DELETE).
- Default org_invites expiry: 7 days.
- Default `org_settings.auto_revoke_inactive_after_days`: 90.
- Default `org_settings.enforce_clinician_mfa`: true (per Phase 25 D-10).
- Custom ESLint rule lives at `eslint-rules/no-raw-service-role-client.js`.
- `withOrgScope` wrapper lives at `src/server/with-org-scope.ts`; allowlist `org_scoped_tables` exported from same file.
- `_createServiceRoleClientUnsafe` lives at `src/server/supabase-server.ts`; returns `ServiceRoleClient<Unscoped>` brand-typed.
- HMAC computation client-side via `crypto.subtle` (matches Phase 9 `makeInviteTokenHash` pattern).
- Test fixture: 2 orgs × 2 users per `*-rls.test.ts`.
- `resolve_clinic_slug` RPC returns `{state, org_summary?, invite_summary?}` — 'not_found' covers both non-existent slug AND existing slug with no visitor relationship.
- pg_cron `org_invites` expiry purge: 04:00 daily (avoids audit-archive 03:00, vendor-baa 06:00, subprocessor-diff Mon 07:00, affiliate-lifetime 03:00, P27 funnel-anomaly 5-min, P27 matview 15-min, P27 undo-purge 1-min, all per P27 D-16).

</specifics>

<deferred>
## Deferred Ideas

- **Subdomain white-label `acme.leanshot.app`** — ORG-07 explicit defer to v1.5. P28 ships path-based `/clinic/{slug}` only.
- **Public clinic-landing pages (`organizations.is_public_listing=true` opt-in)** — D-15 reserves the column; D-19 routing defers the surface. Revisit in v1.4 if clinic-acquisition team requests a marketing surface.
- **Per-org HMAC secret rotation** — D-22 explicit defer; single per-deployment secret in v1.3. Revisit if a specific clinic-key-leak incident emerges or enterprise customer demands per-tenant rotation.
- **RBAC many-to-many member_roles + permissions tables** — D-12 explicit defer to v1.5; P28 + P31 ship the const `ROLE_PERMISSIONS` map keyed by enum.
- **Multi-hat role array (`role org_member_role[]`)** — D-12 explicit defer; multi-hat users get multiple org_members rows (one per org) and use separate orgs for the second hat.
- **org_subscriptions write logic + Stripe webhook glue** — D-14 P28 ships skeleton only; P29 owns writes + webhook + metered billing.
- **Full org_branding theme overlay + font/illustration tokens** — D-16 P28 ships primary_color + accent_color only; P31 owns full token map + onboarding-flow theming.
- **Clinician-side custom rank weights + dose-trend alerts** — out-of-scope per ROADMAP §Phase 30 dependency.
- **Clinic onboarding builder (dnd-kit primitives)** — out-of-scope per ROADMAP §Phase 31 dependency.
- **`/es/` path prefix for Spanish i18n on clinic surfaces** — Phase 32 owns; P28 doesn't constrain.
- **Org-side BAA viewer ("download our subprocessor list")** — defers to Phase 30/31 clinic-side surfaces (per Phase 25 D-deferred-list).
- **Per-clinic anomaly tracking view** — Phase 30 (clinician dashboard) owns clinic-scoped anomaly view (per Phase 27 D-deferred-list).
- **Auto-revoke clinician account on `org_settings.auto_revoke_inactive_after_days`** — D-15 reserves the column; P30 surfaces the cron + UI when clinician-account-hygiene work begins.
- **`mask_patient_emails_in_roster` rendering** — D-15 reserves the column; P30 owns the roster surface that consumes it.
- **Cross-org analytics rollup for the founder dashboard** — deferred to v1.4; would require a `superadmin_org_metrics` matview that aggregates across orgs without leaking PHI.

### Reviewed Todos (not folded)
None — STATE.md "Pending Todos" section shows no Phase 28-applicable entries at gather time.

</deferred>

---

*Phase: 28 — Clinic Organizations — Schema + RLS Hardening*
*Context gathered: 2026-05-17*
