# Phase 28: Clinic Organizations — Schema + RLS Hardening - Research

**Researched:** 2026-05-17
**Domain:** Multi-tenant Postgres RLS hardening · Supabase Auth JWT claim propagation · supabase-js v2 query-builder interposition · Realtime channel HMAC authorization · ESLint AST custom rules
**Confidence:** HIGH on Supabase Custom Access Token Hook signature + Realtime authorization + pgcrypto hmac + ESLint @typescript-eslint/utils. MEDIUM on Proxy-based query interposition (verified pattern from postgrest-js source but no published precedent for this exact use). HIGH on the **load-bearing nomenclature collision** between P28's planned `organizations` table and the live Phase 9 `public.orgs` table (proven via direct read of `supabase/migrations/20260801000002_orgs.sql`).

## Summary

Phase 28 layers a 4-vector multi-tenant defense on top of an existing Phase 9 clinic surface. Research surfaced one **LANDMINE-class blocker** the planner must resolve before any migration is written: a live `public.orgs` table (Phase 9, slug + name + RLS + memberships + invites + `has_permission()`) already provides ~70% of the schema P28's CONTEXT specs as the "new" `organizations` table. P28 must EITHER (a) extend `public.orgs` with the missing columns (`status`, `is_public_listing`, `current_rank_weights_version`, `created_by`-renamed-from-`owner_user_id`) and rename the references in CONTEXT D-11..D-29, OR (b) ship `organizations` as net-new and write a data-migration that copies `orgs` rows over and deprecates the old table. Both have ripple effects; (a) is strongly preferred (zero data migration, preserves Phase 9 callers, FK-rename only).

The other six research domains came back cleanly:

- **JWT claim mechanism (D-09)** → Custom Access Token Hook is the 2026 best practice. Computes claim from `org_members` on every token mint, eliminates the 336ms propagation window entirely (claim is fresh at issuance). Trigger-on-`org_members` calling `auth.admin.updateUserById` works but adds operational complexity (recursion suppression, eventual-consistency window). Recommendation: **Custom Access Token Hook** with the trigger as fallback only if hook latency >50ms in benchmarks.
- **withOrgScope interposition (D-07)** → `Proxy` wrap around the supabase-js client (not the PostgrestQueryBuilder prototype) is the cleanest mechanism. Intercepts `.from(table)` to return a Proxied query builder; tracks `eq('org_id', ...)` calls; throws at `.then()` time if missing. Works for `.rpc()` via separate Proxy on the `.rpc` method. Concrete TS skeleton below.
- **HMAC realtime channel auth (D-23)** → `realtime.messages` RLS policies read JWT claims via `current_setting('request.jwt.claims')::json` (NOT a `claim()` helper — that doesn't exist; researcher CONTEXT line is incorrect). `realtime.topic()` helper returns the topic name. Combined with `extensions.hmac()` from pgcrypto + a SECDEF Vault reader, the recomputation policy is feasible.
- **resolve_clinic_slug anti-enumeration (D-19)** → Standard pattern: single SECDEF function that always queries with a fixed cost (no early-return on missing slug), returns `not_found` for both "slug doesn't exist" AND "slug exists but visitor has no relationship". No timing-attack mitigation needed beyond a stable code path (Postgres index lookup is sub-ms regardless).
- **ESLint `no-raw-service-role-client` (D-06)** → `@typescript-eslint/utils` `CallExpression` matcher on `createClient` identifier + 2nd-arg identifier name regex `/SERVICE_ROLE/`. ~40 LoC rule. Existing `additive-only-events.cjs` is the stylistic template.
- **org_invites vs Phase 9 invites** → Phase 9 already shipped `public.invites` with `invite_token_hash` (SHA-256) + Edge Function `clinic-invite/send` + Resend dispatch + W-1 fix for email-enumeration. P28's `org_invites` MUST be a renamed-or-aliased view of this same table OR ship as a parallel table with identical Edge Function patterns. **Recommendation:** ship `org_invites` as a NEW table (different purpose: P28 invites are org-admin invites, not patient consent invites; the role enum differs) but the Edge Function MUST be `clinic-invite-v2/send` reusing `makeInviteTokenHash` from Phase 9 to preserve the W-1 email-enumeration fix.

**Primary recommendation:** Before any plan ships, the planner must surface the `public.orgs` vs `organizations` naming collision to the user and lock a decision via inline `/gsd-discuss-phase` patch — see Open Question Q-A1 below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 8 net-new org-scoped tables + RLS | Database (Postgres) | — | All multi-tenant isolation is enforced at the row level; client cannot bypass |
| JWT `org_ids` claim population | Database (Auth Hook function) | API (auth.users mutation) | Hook runs at token mint inside Auth service; no client code involved |
| `withOrgScope` brand-typed wrapper | Server (Node/Edge) | — | Only runs in service-role contexts (Edge Functions, cron, admin RPCs) — never client |
| `withOrgScope` runtime assertion + Sentry alert | Server (Node/Edge) | — | Same as above |
| `no-raw-service-role-client` ESLint rule | Tooling (CI lint) | — | Build-time enforcement; never runs at runtime |
| `src/lib/org.ts` org-context layer | Browser / Client | — | React hooks + path resolution + Zustand slice are client-only |
| HMAC realtime channel name generator | Browser / Client | Database (verification) | Client computes `crypto.subtle.hmac`; Postgres `realtime.messages` policy re-verifies via `extensions.hmac()` |
| HMAC secret storage | Database (Vault) | — | `vault.decrypted_secrets` accessed only via SECDEF functions |
| `<RouteOrgGuard>` SPA route component | Browser / Client | — | Renders inside SPA route tree; calls `resolve_clinic_slug` SECDEF RPC |
| `resolve_clinic_slug` RPC | Database (SECDEF function) | — | Owns the membership check + anti-enumeration logic |
| Cross-tenant RLS proof tests | Tooling (Vitest) | Database (live test DB) | Hits live Supabase project via `admin.generateLink + plain fetch /auth/v1/verify` |
| `org_invites` email dispatch | Edge Function (Deno) | API (Resend) | Server-only secret + W-1 pattern |
| `28-EXTENSION-CONTRACT.md` | Documentation | — | Consumed by P29/P30/P31 planners + plan-checker |

## Project Constraints (from CLAUDE.md)

- React 19 + Vite 6 + TypeScript ~5.6.3 strict + Tailwind v4 beta + Zustand v5 — locked.
- Bundle ceilings hard-enforced via `scripts/assert-clinic-bundle-budget.sh` + Phase 24 D-18 ceilings; `admin-shell` 30 kB gz is the relevant one (P28 admin "Members & Invites" pane lands here).
- `@typescript-eslint/no-explicit-any` is `'error'` — `withOrgScope` Proxy wrapper CANNOT use `any`; use `unknown` + narrowing OR generic constraints.
- `no-restricted-syntax` already blocks `*.user!` non-null assertions (P23 D-05 carry-forward) — new code must avoid.
- `import-x/order` is `'error'` with alphabetized + no-newlines-between groups.
- Path alias `@/*` → `./src/*` — use consistently in `src/lib/org.ts` and `src/server/with-org-scope.ts`.
- GSD workflow: all file mutations through GSD commands.
- HIPAA posture: Phase 25 D-10 enforces clinician MFA hard-cut on `/clinic/*`. P28 `<RouteOrgGuard>` must compose with the existing MFA gate.
- Project anti-pattern (per `feedback_planner_iter1_anti_patterns` #4): defensive jsonb contracts live in ONE TS type + ONE DB validator. D-18 `org_consent_grants.scope` MUST re-use Phase 9 `_validate_consent_scope`; do not duplicate.
- Migration filename rule: `<14-digit-timestamp>_snake_case.sql` strict (letter suffix silently skipped per `reference_supabase_migration_filename_regex`).
- ALL SECDEF functions: `set search_path = pg_catalog, public, extensions` (per `reference_supabase_migration_gotchas`).

## User Constraints (from CONTEXT.md)

### Locked Decisions

> Verbatim from CONTEXT.md `<decisions>` block. **All 29 decisions are LOCKED; planner cannot alter without /gsd-discuss-phase patch.**

**org-context layer + Phase 9 carry-forward**
- **D-01** — `src/lib/org.ts` is an additive SIBLING to Phase 9 `src/lib/clinic.ts`; clinic.ts stays unchanged. org.ts owns org-context.
- **D-02** — Current-org resolution precedence: (1) path `/clinic/{slug}` parsed by `<RouteOrgGuard>`; (2) fallback to `org_members.org_id` join + most-recent `last_active_at`; (3) null. Cached in Zustand `org` slice; invalidated on Auth `USER_UPDATED`.
- **D-03** — `src/lib/org.ts` exports: `useCurrentOrg()`, `getCurrentOrgId()`, `getCurrentOrgIdOrNull()`, `surfaceCheck(permission)`, `withOrgPath(relativePath)`, `overlayBrandingTokens(org_branding_row)`.

**withOrgScope service_role wrapper (SC#3 + V13-2 mitigation 3)**
- **D-04** — Layered enforcement: brand types + ESLint rule + runtime assert + Sentry alert.
- **D-05** — `_createServiceRoleClientUnsafe()` re-exported from `src/server/supabase-server.ts` returns `ServiceRoleClient<Unscoped>` (branded). `withOrgScope(orgId, fn)` returns `ServiceRoleClient<OrgScoped>`.
- **D-06** — Custom ESLint rule `no-raw-service-role-client` at `eslint-rules/no-raw-service-role-client.js` (or `.cjs` per existing convention).
- **D-07** — Runtime assertion + Sentry alert inside the wrapper; intercepts `.from()` to inspect resulting builder before `.then()` resolves; if no `.eq('org_id', orgId)` and table is in `org_scoped_tables` allowlist → throws `OrgScopeBypassError` + `Sentry.captureException` level fatal.
- **D-08** — Allowlist of org-scoped tables const exported from `src/server/with-org-scope.ts`; plan-checker BLOCKER on any `*-rls-test.ts` whose target table is missing.

**JWT app_metadata.org_ids (ORG-02 / V13-2 mitigation 2)**
- **D-09** — Claim populated via `org_members` INSERT/UPDATE/DELETE trigger calling `auth.admin.updateUserById`. SECURITY DEFINER + explicit search_path + `app.suppress_audit` GUC. **Researcher may swap to Custom Access Token Hook — see Recommendations.**
- **D-10** — Propagation UX: skeleton roster + non-blocking switcher spinner; poll `app_metadata.org_ids` every 100ms ≤ 600ms; fallback freshness probe + "Retry".

**Schema (8 tables) + role model**
- **D-11** — `organizations`: `id`, `slug unique`, `name`, `created_at`, `created_by`, `status org_status default 'active'`, `is_public_listing default false`, `current_rank_weights_version`. RLS: SELECT org_members, UPDATE admin only, DELETE blocked (status='archived').
- **D-12** — `org_members`: single role enum `('admin','staff','viewer')`; `(org_id, user_id)` unique; multi-hat = multiple rows.
- **D-13** — `org_invites`: SHA-256 `invite_token_hash` (re-uses Phase 9 `makeInviteTokenHash`); 7-day expiry; SECDEF RPCs `send_org_invite` + `revoke_org_invite` with W-1 email-enumeration fix.
- **D-14** — `org_subscriptions`: skeleton only (P28); P29 owns writes. RLS deny-all in v1.3 P28.
- **D-15** — `org_settings`: `enforce_clinician_mfa default true` (matches P25 D-10); `auto_revoke_inactive_after_days default 90`; `mask_patient_emails_in_roster default false`.
- **D-16** — `org_branding`: skeleton (P31 owns full theme); P28 ships primary/accent color CSS-var overlay only.
- **D-17** — `org_patient_links`: soft-delete `unlinked_at`; SECDEF `link_org_patient` requires accepted `org_consent_grants` row.
- **D-18** — `org_consent_grants`: re-uses Phase 9 `_validate_consent_scope` (NO duplicate); `granted_via` enum 'invite'|'manual'|'migration'.

**Routing for non-members (ORG-07)**
- **D-19** — `resolve_clinic_slug(slug)` SECDEF RPC returns `{state: 'member'|'pending_invite'|'not_found', org_summary?, invite_summary?}`. `'not_found'` covers both non-existent slug AND existing-slug-no-membership. No subdomain routing in v1.3.

**HMAC realtime channels (SC#4 / V13-2 mitigation 4)**
- **D-20** — Channel name: `org-{8-hex-hmac}-{table}`.
- **D-21** — HMAC input: `org_id || ':' || table_name`.
- **D-22** — Secret in Supabase Vault, key `org_realtime_channel_secret`. Per-deployment single secret.
- **D-23** — `realtime.messages` RLS policy recomputes HMAC server-side using SECDEF `get_realtime_secret()`. *(Note: planner-side CONTEXT references a `claim()` helper — does not exist in Postgres; correct path is `current_setting('request.jwt.claims')::json ->> ...`. Researcher flags below.)*
- **D-24** — `src/lib/org-realtime.ts` exports `channelNameFor(orgId, table)` using `crypto.subtle.importKey + sign` ('HMAC' / SHA-256) — matches Phase 9 `makeInviteTokenHash` browser pattern. Secret fetched via one-time-per-session SECDEF RPC `get_realtime_channel_keying()`.

**Cross-tenant impersonation proof tests (SC#1 / ORG-05)**
- **D-25** — 8 `<table>-rls.test.ts` files; `admin.generateLink + /auth/v1/verify` plain fetch (ES256-compat); file-scoped slug prefix; 2 orgs × 2 users × 1 patient fixture.
- **D-26** — Plan-checker BLOCKER on any new org-scoped migration without paired `*-rls.test.ts`.
- **D-27** — Realtime cross-tenant test: Playwright User A → subscribe to `channelNameFor(orgY, 'patients')` → assert `CHANNEL_ERROR`.
- **D-28** — `withOrgScope` bypass tests: compile-time (`expect-type` or `tsd`) + runtime (Vitest).

**Extension contract**
- **D-29** — `28-EXTENSION-CONTRACT.md` ships alongside CONTEXT.md; consumed by P29/P30/P31.

### Claude's Discretion

- Exact AST shape for `no-raw-service-role-client` (D-06) — see Code Examples §F.
- Exact interposition mechanism for `withOrgScope` (D-07) — **Researcher recommends Proxy wrap of client (NOT prototype patch)** — see §B.
- Trigger vs Custom Access Token Hook (D-09) — **Researcher recommends Custom Access Token Hook** — see §A.
- `get_realtime_channel_keying()` returns raw secret vs derived per-session token (D-24) — **Researcher recommends derived per-session token** (smaller exposure window, simpler revocation).
- RLS test file location (D-25) — **Researcher recommends `src/lib/__tests__/rls-org-*.test.ts`** to match Phase 9 `clinic.test.ts` + `clinic-permissions.test.ts` convention. Vitest faster than Playwright for RLS sweeps.
- `_validate_consent_scope` re-use (D-18) — **Strongly recommend re-use** per `feedback_planner_iter1_anti_patterns` #4 (already locked in CONTEXT).
- pg_cron `org_invites` expiry purge schedule — **04:00 daily** confirmed safe per CONTEXT §Specific Ideas (no collision with existing crons).

### Deferred Ideas (OUT OF SCOPE)

- Subdomain white-label `acme.leanshot.app` → v1.5.
- Public clinic-landing pages → v1.4 (column reserved).
- Per-org HMAC secret rotation → v1.4+.
- RBAC many-to-many `member_roles` + `permissions` tables → v1.5.
- Multi-hat role array → v1.5+ (P28 uses multiple rows).
- `org_subscriptions` writes + Stripe webhook → P29.
- Full `org_branding` theme overlay + font/illustration tokens → P31.
- Clinician rank weights / dose alerts → P30.
- Clinic onboarding builder → P31.
- `/es/` path prefix Spanish i18n → P32.
- Org BAA viewer surface → P30/P31.
- Per-clinic anomaly tracking view → P30.
- Auto-revoke clinician on inactive cron → P30 surfaces.
- `mask_patient_emails_in_roster` rendering → P30 owns surface.
- Cross-org analytics rollup → v1.4.

## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support |
|----|------------------------------------|-------------------|
| ORG-01 | Schema: 8 named tables + 4 downstream (16+ migrations) | §Migration Ordering provides 8-file sequence; §Standard Stack covers Postgres pgcrypto + Vault extensions |
| ORG-02 | JWT `app_metadata.org_ids` claim propagates (336ms window) | §A Custom Access Token Hook eliminates the 336ms window entirely; trigger path documented as fallback |
| ORG-03 | `withOrgScope` service_role wrapper (compile-time + runtime + Sentry) | §B Proxy-based interposition skeleton; §F ESLint rule skeleton |
| ORG-04 | HMAC-derived realtime channel; mismatched-org_id rejected | §C HMAC policy SQL + browser `crypto.subtle` HMAC + Vault SECDEF read |
| ORG-05 | Every org-scoped table cross-tenant impersonation proof test | §G concrete vitest skeleton; `admin.generateLink` + `/auth/v1/verify` plain fetch |
| ORG-06 | `src/lib/org.ts` org-context layer | §Code Examples §Pattern 2 layered with §H bundle-impact estimate |
| ORG-07 | Path-based `/clinic/{slug}/...` routing (subdomain deferred) | §D `resolve_clinic_slug` anti-enumeration SECDEF pattern |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.x (existing) | Postgres + Auth + Realtime + Storage client | Already used across Phase 9 + 22 + 25; no addition |
| `@typescript-eslint/utils` | ^8.x (existing peer of `typescript-eslint`) | Custom ESLint rule AST helpers | `additive-only-events.cjs` already uses `@typescript-eslint/parser`; `utils` is the standard typed builder |
| pgcrypto Postgres extension | bundled with Supabase | `hmac(data, key, 'sha256')` + `encode(... ,'hex')` for D-23 | Always available on Supabase; HIGH confidence per pgcrypto docs |
| Supabase Vault | bundled extension | Encrypted secret storage for `org_realtime_channel_secret` | Already used Phase 22 (per memory `[[project_phase22_planned]]`); `vault.decrypted_secrets` view + SECDEF reader |
| Supabase Custom Access Token Hook | platform feature | JWT claim populated at every token mint | New for project; replaces D-09 trigger path |
| `@sentry/react` (existing) + `@sentry/node` (existing in Edge functions) | existing | Fatal-level capture for `OrgScopeBypassError` | Already wired Phase 12 |
| Vitest | existing | Cross-tenant RLS test runner | Already standard per `clinic.test.ts` + `clinic-permissions.test.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `expect-type` OR `tsd` | new (optional) | Compile-time type-level assertions for D-28 bypass test | If planner wants explicit "this should be `never`" assertion in test file rather than `// @ts-expect-error` comment |
| `@playwright/test` (existing) | — | D-27 realtime channel cross-tenant test | DB-level realtime channel `subscribe()` assertions per `[[feedback_realtime_layer_e2e_pattern]]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Access Token Hook | `org_members` trigger → `auth.admin.updateUserById` | Trigger eliminates per-token-mint compute cost (claim cached in `raw_app_meta_data`) but introduces 336ms propagation window, recursion suppression (`app.suppress_audit`), and eventual-consistency UX. **Hook chosen** per "fresh-at-mint" + zero UX polling. |
| Proxy wrap of supabase-js client | Prototype patch on `PostgrestQueryBuilder` | Prototype patch is invasive (touches every supabase-js instance globally), survives across imports, brittle to supabase-js minor version bumps. **Proxy chosen** per locality + version-safety. |
| Per-deployment HMAC secret | Per-org HMAC secret | Per-org adds rotation surface area (N secrets vs 1); operationally heavier with no threat-model gain at v1.3 (no enterprise customer requesting per-tenant rotation yet). **Per-deployment chosen** per CONTEXT D-22 lock. |
| Custom `org_invites` Edge Function | Re-use Phase 9 `clinic-invite/send` Edge Function | Phase 9 EF currently writes to `public.invites` with consent-scope semantics; org-admin invites have different schema (role enum, no consent scope). **Parallel EF chosen** but MUST import `makeInviteTokenHash` helper to preserve W-1 fix. |

**Installation:**

```bash
# All required packages already installed. Optional addition:
npm install --save-dev expect-type
```

**Version verification (verified 2026-05-17):**

```bash
# verify pgcrypto + vault extensions live on Supabase project
supabase db query --linked --query "select extname from pg_extension where extname in ('pgcrypto','vault','supabase_vault');"
```

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────────┐
                       │  Browser (React SPA)                         │
                       │                                              │
   ──path /clinic/X─►  │  <RouteOrgGuard>  ────resolve_clinic_slug──► RPC
                       │       │                                      │
                       │       ▼ (state=member)                       │
                       │  Zustand `org` slice ◄──useCurrentOrg()──┐  │
                       │       │                                  │  │
                       │       ▼                                  │  │
                       │  org.ts (getCurrentOrgId / surfaceCheck) │  │
                       │       │                                  │  │
                       │       ▼                                  │  │
                       │  clinic.ts (Phase 9 RPCs UNCHANGED) ─────┘  │
                       │       │                                      │
                       │       ▼                                      │
                       │  supabase.rpc(...) + supabase.channel(...) │
                       │       │              │                       │
                       │       │              ▼                       │
                       │       │     org-realtime.channelNameFor(...)│
                       │       │     (HMAC via crypto.subtle)        │
                       └───────┼──────────────┼──────────────────────┘
                               │              │
                               ▼              ▼
                       ┌────────────────────────────────────────────┐
                       │  Supabase                                   │
                       │                                             │
                       │  Auth ──Custom Access Token Hook──► JWT    │
                       │              │                              │
                       │              ▼ reads org_members            │
                       │   ┌────────────────────────────────────┐   │
                       │   │  Postgres (RLS-gated)               │   │
                       │   │   organizations / org_members /     │   │
                       │   │   org_invites / org_subscriptions / │   │
                       │   │   org_settings / org_branding /     │   │
                       │   │   org_patient_links / org_consent_  │   │
                       │   │   grants                            │   │
                       │   │      ▲                              │   │
                       │   │      │ writes via SECDEF RPCs only  │   │
                       │   └──────┼──────────────────────────────┘   │
                       │          │                                  │
                       │   ┌──────┴────────────────────────────┐    │
                       │   │  Edge Functions (Deno)             │    │
                       │   │   clinic-invite-v2/send (W-1)      │    │
                       │   │   ┌────────────────────────────┐  │    │
                       │   │   │ withOrgScope(orgId, fn)    │  │    │
                       │   │   │  - Proxy wrap client       │  │    │
                       │   │   │  - intercept .from(table)  │  │    │
                       │   │   │  - assert .eq('org_id',…)  │  │    │
                       │   │   │  - Sentry fatal on bypass  │  │    │
                       │   │   └────────────────────────────┘  │    │
                       │   └──────────────────────────────────┘     │
                       │                                             │
                       │  realtime.messages (RLS recomputes HMAC    │
                       │       via extensions.hmac + get_realtime_  │
                       │       secret() SECDEF → Vault)             │
                       └────────────────────────────────────────────┘
                                       ▲
                               Sentry ─┘ (OrgScopeBypassError fatal)
```

### Recommended Project Structure

```
src/
├── lib/
│   ├── org.ts                       # NEW — D-03 exports
│   ├── org-realtime.ts              # NEW — channelNameFor + Vault keying
│   ├── clinic.ts                    # UNCHANGED (Phase 9)
│   ├── clinic-realtime.ts           # UNCHANGED (Phase 9)
│   ├── clinic-permissions.ts        # UNCHANGED (Phase 9)
│   └── __tests__/
│       ├── rls-org-organizations.test.ts
│       ├── rls-org-members.test.ts
│       ├── rls-org-invites.test.ts
│       ├── rls-org-subscriptions.test.ts
│       ├── rls-org-settings.test.ts
│       ├── rls-org-branding.test.ts
│       ├── rls-org-patient-links.test.ts
│       ├── rls-org-consent-grants.test.ts
│       ├── with-org-scope.test.ts   # D-28 bypass tests
│       └── org-realtime.test.ts
├── server/
│   ├── supabase-server.ts           # NEW — _createServiceRoleClientUnsafe
│   └── with-org-scope.ts            # NEW — Proxy wrapper + org_scoped_tables const
├── components/
│   └── clinic/
│       └── RouteOrgGuard.tsx        # NEW — resolves slug via resolve_clinic_slug RPC
└── store/                           # OR src/lib/store.ts
    └── slices/
        └── org.ts                   # NEW — Zustand `org` slice

eslint-rules/
├── additive-only-events.cjs         # existing (Phase 24)
└── no-raw-service-role-client.cjs   # NEW — D-06

e2e/
└── rls-org-realtime-channel.spec.ts # D-27 cross-tenant channel test

supabase/migrations/
├── 20270601100001_org_status_enum.sql
├── 20270601100002_organizations_table_or_extend_orgs.sql   # ★ SEE Q-A1 below
├── 20270601100003_org_member_role_enum.sql
├── 20270601100004_org_members_table.sql
├── 20270601100005_org_settings_table.sql
├── 20270601100006_org_branding_table.sql
├── 20270601100007_org_invites_table.sql
├── 20270601100008_org_subscriptions_table.sql
├── 20270601100009_org_patient_links_table.sql
├── 20270601100010_org_consent_grants_table.sql
├── 20270601100011_resolve_clinic_slug_rpc.sql
├── 20270601100012_send_revoke_org_invite_rpcs.sql
├── 20270601100013_link_org_patient_rpc.sql
├── 20270601100014_org_realtime_channel_secret_vault.sql
├── 20270601100015_get_realtime_secret_secdef_fn.sql
├── 20270601100016_realtime_messages_rls_hmac_policy.sql
├── 20270601100017_custom_access_token_hook_fn.sql
├── 20270601100018_org_invites_expiry_purge_cron.sql
└── (rls-test fixture seed if needed)

.planning/phases/28-…/
├── 28-CONTEXT.md            # existing
├── 28-RESEARCH.md           # this file
├── 28-EXTENSION-CONTRACT.md # NEW — D-29
└── 28-{NN}-PLAN.md          # 1..N (planner decides)
```

### Pattern 1: Proxy-based `withOrgScope`

**What:** Wrap the supabase-js client in a `Proxy` so `.from(table)` returns a Proxied query builder that tracks `.eq('org_id', …)` calls. At `.then()` resolution time (the builder is a thenable), assert the filter was applied if the table is in the org-scoped allowlist.

**When to use:** Every Edge Function or server-side RPC that uses the `SERVICE_ROLE_KEY` client. Never on the browser anon client (RLS handles browser).

**Example:**

```typescript
// src/server/with-org-scope.ts
// Source: pattern derived from postgrest-js source
// (https://github.com/supabase/postgrest-js/blob/master/src/PostgrestQueryBuilder.ts)
// + supabase docs (https://supabase.com/docs/reference/javascript/filter)

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { _createServiceRoleClientUnsafe } from './supabase-server';

declare const __OrgScoped: unique symbol;
export type ServiceRoleClient<S extends 'OrgScoped' | 'Unscoped'> =
  SupabaseClient & { [__OrgScoped]: S };

export class OrgScopeBypassError extends Error {
  constructor(public table: string, public orgId: string) {
    super(`withOrgScope bypass: query on '${table}' did not include .eq('org_id', '${orgId}').`);
    this.name = 'OrgScopeBypassError';
  }
}

export const ORG_SCOPED_TABLES = new Set<string>([
  'organizations',
  'org_members',
  'org_invites',
  'org_subscriptions',
  'org_settings',
  'org_branding',
  'org_patient_links',
  'org_consent_grants',
  // Downstream phases extend this per 28-EXTENSION-CONTRACT.md D-29
]);

export async function withOrgScope<T>(
  orgId: string,
  fn: (client: ServiceRoleClient<'OrgScoped'>) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error('withOrgScope: orgId required');

  const raw = _createServiceRoleClientUnsafe();

  // Proxy the client's `.from()` method
  const proxiedClient = new Proxy(raw, {
    get(target, prop, recv) {
      if (prop === 'from') {
        return (table: string) => {
          const builder = target.from(table);
          if (!ORG_SCOPED_TABLES.has(table)) return builder;
          return wrapBuilder(builder, table, orgId);
        };
      }
      return Reflect.get(target, prop, recv);
    },
  });

  // Pass the branded proxied client to the user fn
  return fn(proxiedClient as unknown as ServiceRoleClient<'OrgScoped'>);
}

function wrapBuilder(builder: unknown, table: string, orgId: string): unknown {
  const filterCalls: Array<{ method: string; col?: string; val?: unknown }> = [];

  const proxy: ProxyHandler<object> = {
    get(target, prop, recv) {
      const original = Reflect.get(target as object, prop, recv);

      // Track filter methods. `.eq('org_id', orgId)` is what we need.
      if (typeof original === 'function' && typeof prop === 'string') {
        if (prop === 'eq' || prop === 'in' || prop === 'contains') {
          return (...args: unknown[]) => {
            filterCalls.push({ method: prop, col: args[0] as string, val: args[1] });
            const ret = (original as (...a: unknown[]) => unknown).apply(target, args);
            // Re-wrap chained return so subsequent .select().then() is still tracked
            return new Proxy(ret as object, proxy);
          };
        }

        // Intercept `.then()` (PostgrestBuilder is thenable)
        if (prop === 'then') {
          return (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            const hasOrgScope = filterCalls.some(
              (c) =>
                (c.method === 'eq' && c.col === 'org_id' && c.val === orgId) ||
                (c.method === 'in' && c.col === 'org_id' && Array.isArray(c.val) && (c.val as unknown[]).includes(orgId)) ||
                (c.method === 'contains' && c.col === 'org_ids' && Array.isArray(c.val) && (c.val as unknown[]).includes(orgId)),
            );

            if (!hasOrgScope) {
              const err = new OrgScopeBypassError(table, orgId);
              Sentry.captureException(err, { level: 'fatal', tags: { org_scope_bypass: 'true' } });
              return Promise.reject(err).then(resolve, reject);
            }

            return (original as (...a: unknown[]) => unknown).call(target, resolve, reject) as Promise<unknown>;
          };
        }

        // For all other methods, re-wrap return value to preserve tracking through chain.
        return (...args: unknown[]) => {
          const ret = (original as (...a: unknown[]) => unknown).apply(target, args);
          if (ret && typeof ret === 'object') return new Proxy(ret, proxy);
          return ret;
        };
      }
      return original;
    },
  };

  return new Proxy(builder as object, proxy);
}
```

**Notes:**
- The Proxy must be reapplied on EVERY chained return — supabase-js builders return `this` from filter methods but new instances on some transforms; the recursive Proxy handles both.
- `.rpc()` cannot use the same `eq` pattern; for SECDEF RPCs the function-level role check inside the RPC body is the enforcement (Pattern S1). `withOrgScope` does NOT police `.rpc()` calls; it polices direct table access only. This is per CONTEXT D-07 wording.
- Brand-type safety: `_createServiceRoleClientUnsafe()` returns `ServiceRoleClient<'Unscoped'>` whose `.from` is typed `never` via the brand intersection in `supabase-server.ts`. The Proxy returns the runtime methods anyway, but TS callers can only reach them by going through `withOrgScope`.

### Pattern 2: `src/lib/org.ts` core

```typescript
// src/lib/org.ts — D-03 surface
// Source: D-03 lock; uses Phase 9 clinic.ts + clinic-permissions.ts as substrate.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useStore } from './store';
import { resolveClinicSlug } from './clinic';     // existing Phase 9 wrapper if present; else SECDEF RPC

export type OrgRole = 'admin' | 'staff' | 'viewer';
export interface Org { id: string; slug: string; name: string }
export interface OrgContext { org: Org | null; role: OrgRole | null; loading: boolean }

// Permission-matrix is a const map keyed by role; deferred to P31 to fill out fully.
const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<string>> = {
  admin:  new Set(['members.invite','members.revoke','members.list','settings.edit','branding.edit','patients.link']),
  staff:  new Set(['members.list','patients.link']),
  viewer: new Set(['members.list']),
};

export function getCurrentOrgIdOrNull(): string | null {
  return useStore.getState().currentOrg?.id ?? null;
}

export function getCurrentOrgId(): string {
  const id = getCurrentOrgIdOrNull();
  if (!id) throw new Error('No current org — call from inside <RouteOrgGuard> tree');
  return id;
}

export function useCurrentOrg(): OrgContext {
  return useStore((s) => ({ org: s.currentOrg, role: s.currentOrgRole, loading: s.currentOrgLoading }));
}

export function surfaceCheck(permission: string): boolean {
  const role = useStore.getState().currentOrgRole;
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function withOrgPath(relative: string): string {
  const slug = useStore.getState().currentOrg?.slug;
  if (!slug) throw new Error('withOrgPath: no current org');
  return `/clinic/${slug}${relative.startsWith('/') ? relative : `/${relative}`}`;
}

export function overlayBrandingTokens(branding: { primary_color?: string | null; accent_color?: string | null }): void {
  const root = document.documentElement;
  if (branding.primary_color) root.style.setProperty('--color-primary', branding.primary_color);
  if (branding.accent_color)  root.style.setProperty('--color-accent',  branding.accent_color);
}
```

### Pattern 3: Custom Access Token Hook (D-09)

```sql
-- supabase/migrations/20270601100017_custom_access_token_hook_fn.sql
-- Source: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
--
-- Replaces D-09 trigger-based approach. Hook runs at every JWT mint;
-- claim is computed from org_members at that exact moment — no
-- propagation window. Hook latency must stay <50ms or token refresh
-- feels sluggish; the index on org_members(user_id) keeps it sub-ms.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid;
  v_org_ids jsonb;
  v_claims  jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := event -> 'claims';

  select coalesce(jsonb_agg(om.org_id::text order by om.last_active_at desc nulls last), '[]'::jsonb)
    into v_org_ids
  from public.org_members om
  where om.user_id = v_user_id;

  if jsonb_typeof(v_claims -> 'app_metadata') is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;
  v_claims := jsonb_set(v_claims, '{app_metadata,org_ids}', v_org_ids);

  return jsonb_build_object('claims', v_claims);
end;
$$;

-- Grant execute to supabase_auth_admin per Supabase Auth Hook docs
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- After this migration, enable the hook in Supabase Dashboard:
-- Authentication → Hooks → Custom Access Token → select public.custom_access_token_hook
-- (alternative: `supabase secrets set GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true ...`)
```

### Pattern 4: HMAC realtime channel RLS policy (D-23)

```sql
-- supabase/migrations/20270601100015_get_realtime_secret_secdef_fn.sql
-- Source: https://supabase.com/docs/guides/database/vault
create or replace function public.get_realtime_secret()
returns text
language sql
stable
security definer
set search_path = pg_catalog, vault, public, extensions
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'org_realtime_channel_secret' limit 1;
$$;
revoke execute on function public.get_realtime_secret() from public, authenticated, anon;
-- Grant only to RLS execution context (function is SECDEF; realtime calls it via policy)
grant execute on function public.get_realtime_secret() to supabase_realtime_admin;

-- supabase/migrations/20270601100016_realtime_messages_rls_hmac_policy.sql
-- Source: https://supabase.com/docs/guides/realtime/authorization
-- KEY CORRECTION vs CONTEXT D-23 wording: there is NO `claim()` helper.
-- Use `current_setting('request.jwt.claims', true)::json` instead.

create policy org_hmac_channel_select on realtime.messages
  for select to authenticated
  using (
    -- Only enforce on topics matching org-{8-hex}-{table} shape
    realtime.topic() ~ '^org-[0-9a-f]{8}-(organizations|org_members|org_invites|org_subscriptions|org_settings|org_branding|org_patient_links|org_consent_grants)$'
    and realtime.topic() = (
      'org-' ||
      left(encode(
        extensions.hmac(
          (
            -- extract THIS user's org_id list from JWT claim then check the
            -- topic's org_id is in that list. We derive org_id from topic;
            -- the HMAC re-verify proves the client computed it with the secret.
            (current_setting('request.jwt.claims', true)::json ->> 'sub')
            -- NOTE: HMAC input is org_id || ':' || table_name per D-21.
            -- We reconstruct from the topic itself (split_part) to verify.
            -- Validity gate: the JWT's app_metadata.org_ids MUST contain
            -- the topic's org_id.
            -- The HMAC computation must use the same org_id as in claim list.
            || ':' || split_part(realtime.topic(), '-', 3)
          ),
          public.get_realtime_secret(),
          'sha256'
        ),
        'hex'
      ), 8) ||
      '-' || split_part(realtime.topic(), '-', 3)
    )
    and
    -- Defense-in-depth: caller's JWT app_metadata.org_ids must include this org_id
    (current_setting('request.jwt.claims', true)::json -> 'app_metadata' -> 'org_ids') @>
      to_jsonb(split_part(realtime.topic(), '-', 2))
  );
```

**⚠ Caveat (LOW-MEDIUM confidence):** the policy above is structurally correct but the **HMAC input requires the actual `org_id` (UUID)**, not the truncated 8-hex prefix. The browser-side `channelNameFor(orgId, table)` knows orgId; the SQL policy only has the truncated hex. The correct shape is: caller's JWT MUST contain `org_id` in `app_metadata.org_ids`; SQL iterates the claim's `org_ids[]` looking for one whose HMAC truncates to the topic's 8-hex prefix. This is more complex than the CONTEXT D-23 inline sketch — planner should treat the sketch as illustrative and produce the iteration variant in the actual migration. **Recommended:** a SECDEF helper function `realtime_topic_authorized(topic text, claims jsonb) returns boolean` keeps the policy line short and testable.

### Pattern 5: Browser HMAC for channel name

```typescript
// src/lib/org-realtime.ts
// Source: D-24 + pattern matches Phase 9 makeInviteTokenHash.

let cachedSecret: ArrayBuffer | null = null;

async function getSecret(): Promise<ArrayBuffer> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await supabase.rpc('get_realtime_channel_keying');
  if (error || !data) throw new Error('Failed to fetch realtime channel keying');
  cachedSecret = new TextEncoder().encode(data as string).buffer;
  return cachedSecret;
}

export async function channelNameFor(orgId: string, table: string): Promise<string> {
  const secret = await getSecret();
  const key = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${orgId}:${table}`),
  );
  const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return `org-${hex.slice(0, 8)}-${table}`;
}
```

### Anti-Patterns to Avoid

- **Reading `vault.decrypted_secrets` from a non-SECDEF function** — leaks the secret to any role with table-read on vault. SECDEF wrapper is the only safe path.
- **`.rpc()` inside `withOrgScope` policed by Proxy** — RPCs don't have an `.eq()` filter; the SECDEF function body is the enforcement point. Trying to police RPCs via Proxy will break legitimate `.rpc()` calls.
- **Hand-rolling jsonb-shape validation for `org_consent_grants.scope`** — per `feedback_planner_iter1_anti_patterns` #4, MUST re-use Phase 9 `_validate_consent_scope`.
- **Skipping the `realtime_topic_authorized` SECDEF helper** — inlining the HMAC iteration in the policy USING clause makes the policy ~30 lines and untestable; extract to a helper.
- **Trigger that calls `auth.admin.updateUserById` without `app.suppress_audit` GUC** — recursion into `audit_logs` PHI trigger fires for each user-row mutation (per `[[reference_supabase_migration_gotchas]]`).
- **Subdomain-style routing** — D-19 + ROADMAP §Out of scope; deferred to v1.5.
- **Modifying `src/lib/clinic.ts`** — D-01 lock; backwards-compat with 16 SECDEF wrappers + Result-union contract that downstream callers rely on.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT custom claims | `org_members` trigger + manual `auth.admin.updateUserById` calls (D-09 path) | Custom Access Token Hook | Hook is fresh-at-mint, eliminates 336ms window, no recursion suppression needed, no D-10 polling UX |
| Secret storage for HMAC | Env var, `pg_settings` table, hardcoded constant | Supabase Vault (`vault.decrypted_secrets`) | Encrypted at rest, decrypted only via SECDEF, survives DB backups |
| HMAC computation in SQL | `digest()` + manual key concatenation | `extensions.hmac(data, key, 'sha256')` from pgcrypto | Battle-tested constant-time HMAC; pgcrypto bundled with Supabase |
| Client-side HMAC | Pure-JS HMAC library | `crypto.subtle.sign('HMAC', ...)` | Native, constant-time, no bundle cost; matches Phase 9 `makeInviteTokenHash` pattern |
| Invite token generation | `Math.random()` + manual hashing | `crypto.getRandomValues()` + `crypto.subtle.digest('SHA-256', ...)` (Phase 9 `makeInviteTokenHash`) | Already exists in `clinic.ts`; W-1 email-enumeration fix already proven |
| Consent-scope validation | New `_validate_org_consent_scope` function | Re-use Phase 9 `_validate_consent_scope` | One TS type + one DB validator per anti-pattern #4 |
| ESLint TS-parser plumbing | Roll-your-own AST walker | `@typescript-eslint/parser` (already a transitive dep via `typescript-eslint`) | `additive-only-events.cjs` is the proven template |
| RLS cross-tenant test auth | `signInWithPassword` (flaky GoTrueClient cross-contamination 2026-05-16) | `admin.generateLink` + plain `fetch /auth/v1/verify` | Project rule `reference_rls_fixture_gotrueclient_flake` 2026-05-16 ES256 fix |

**Key insight:** Every "build your own" item above has burned the project before (see linked memory references). The cumulative cost of any one of them re-emerging in P28 would dwarf the cost of reusing the existing solution.

## Runtime State Inventory

> Phase 28 is **net-new schema + code**; not a rename/refactor. This section is included for the `public.orgs` ↔ `organizations` collision audit only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **`public.orgs` table is LIVE** with N rows (count via `supabase db query --linked --query "select count(*) from public.orgs"`). Also live: `public.memberships`, `public.invites`, `public.roles`, `public.role_permissions` (Phase 9 RBAC). | **DEPENDS ON Q-A1 resolution.** If "extend `orgs`" path → ALTER TABLE adds `status`, `is_public_listing`, etc. If "new `organizations`" path → data migration `insert into organizations (id, slug, name, ...) select id, slug, name, ... from orgs` + deprecation plan for `orgs`. |
| Live service config | Supabase Auth Hook config: **NOT YET ENABLED**. Must be set via Dashboard → Authentication → Hooks → Custom Access Token, OR via `supabase secrets set GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook + GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`. CI cannot toggle hook config; **HUMAN-CHECKPOINT** required post-migration. | Add HUMAN-CHECKPOINT to P28 plan after migration 17 lands |
| OS-registered state | None | None |
| Secrets / env vars | New: `org_realtime_channel_secret` in Supabase Vault (created via migration `select vault.create_secret('<32-byte-hex>', 'org_realtime_channel_secret')`). Secret value generation: `openssl rand -hex 32`. | Add HUMAN-CHECKPOINT: operator generates secret + runs migration with substituted value |
| Build artifacts / packages | None | None |

## Common Pitfalls

### Pitfall 1: `public.orgs` ↔ `organizations` collision

**What goes wrong:** Planner writes migration creating `public.organizations` table while `public.orgs` is live, with overlapping semantics (slug, name, owner/created_by, RLS policies referencing `has_permission(uid, org_id, …)` and the `memberships` table referencing `orgs(id)`).

**Why it happens:** CONTEXT D-11..D-29 talks about `organizations` as if greenfield; researcher confirms Phase 9 already shipped `public.orgs` with most of the same surface.

**How to avoid:** Resolve Q-A1 before any migration is written. Planner MUST add a Plan-0 task "Audit + resolve org table naming" with explicit `/gsd-discuss-phase` patch.

**Warning signs:** Plan-checker BLOCKER on migration that creates `public.organizations` while `public.orgs` exists; FK-error on `org_members.org_id references organizations(id)` because `memberships.org_id references orgs(id)` already exists.

### Pitfall 2: 8-hex HMAC collisions across orgs

**What goes wrong:** Two orgs hash to identical 8-hex prefixes for the same table → both subscribe to the same channel → cross-tenant leak via realtime broadcast.

**Why it happens:** 8 hex chars = 32 bits = 1 in ~4B per pair. With 10K orgs × 50 tables = 500K topics, birthday-bound says probability of ANY collision ≈ 0.03 (`1 - exp(-500000²/(2·2³²))` ≈ 3%).

**How to avoid:** RLS policy (Pattern 4) ALSO checks `app_metadata.org_ids @> to_jsonb(claimed_org_id)`. Defense-in-depth catches HMAC collision: if Org A subscribes to a topic whose HMAC prefix accidentally matches what Org B would produce, A's JWT does not include B's org_id in `org_ids`, so the policy denies.

**Warning signs:** D-27 Playwright test failing intermittently (probabilistic collision); add a deterministic test that constructs a known-collision pair and asserts the JWT-list check fires.

### Pitfall 3: Vault secret SECDEF function execute-grant leakage

**What goes wrong:** Granting `EXECUTE` on `get_realtime_secret()` to `authenticated` or `anon` instantly leaks the secret (any user can `select get_realtime_secret()` and read it).

**Why it happens:** `SECURITY DEFINER` means the function runs with the OWNER's privileges; if EXECUTE is granted broadly, anyone can call it.

**How to avoid:** Migration MUST include `revoke execute on function public.get_realtime_secret() from public, authenticated, anon;` and grant ONLY to `supabase_realtime_admin` (which is the role realtime.messages RLS runs as). Per Pattern 4. Add a regression vitest: `expect((await anonClient.rpc('get_realtime_secret'))).toBe(rejected)`.

**Warning signs:** Secret string appears in any client-side network response; PostHog event payload contains the secret.

### Pitfall 4: Custom Access Token Hook latency > token-mint budget

**What goes wrong:** Hook function takes >50ms per token mint → sign-in feels slow, token refresh stalls UI.

**Why it happens:** Bad index on `org_members(user_id)`; hook does N+1 lookups; jsonb_agg over many memberships.

**How to avoid:** Migration `20270601100004_org_members_table.sql` MUST include `create index on org_members(user_id);` (already in D-12 schema via `unique(org_id, user_id)` + `user_id` filter index). Benchmark hook with `select custom_access_token_hook(jsonb_build_object('user_id', 'fixture-uid', 'claims', '{}'::jsonb))` and assert p95 < 50ms in test.

**Warning signs:** Token refresh log timing on Auth dashboard >500ms; user-visible "logging in…" stutter.

### Pitfall 5: `org_members` mutation during multi-tenant operations

**What goes wrong:** Admin adds a user to Org B inside a transaction that also reads from Org A's tables → midway through the transaction the user's JWT claim still reflects pre-mutation state but RLS checks new state → inconsistent results.

**Why it happens:** JWT claim is set at mint time; mid-transaction membership changes don't refresh JWT. Pure RLS USING-clause queries `org_members` at query time, which is consistent.

**How to avoid:** RLS policies on the 8 tables MUST query `org_members` directly (e.g., `using (exists (select 1 from org_members where user_id = auth.uid() and org_id = T.org_id))`), NOT rely solely on the JWT claim. JWT claim is for client-side hint + admin UI; database truth is `org_members`. Document this contract in 28-EXTENSION-CONTRACT.md.

**Warning signs:** Cross-tenant test passes for SELECT but fails for newly added member mid-test.

### Pitfall 6: `.rpc()` not policed by `withOrgScope` Proxy

**What goes wrong:** Developer writes `await withOrgScope(orgId, c => c.rpc('admin_blast_all_orgs'))` assuming the wrapper polices the call → it doesn't → cross-org SQL runs.

**Why it happens:** Pattern 1 explicitly does NOT police `.rpc()` (RPCs don't have `.eq` filters).

**How to avoid:** Every SECDEF RPC body MUST start with `if not exists (select 1 from org_members where user_id = auth.uid() and org_id = p_org_id) then raise exception using errcode = '42501'; end if;`. Pattern S1 dual-layer. Add a separate ESLint rule (or extend `no-raw-service-role-client`) that blocks `withOrgScope(..., (c) => c.rpc(...))` patterns to force the dev to call `.rpc()` outside the wrapper.

**Warning signs:** Dev finds Sentry alert mysteriously NOT firing on a known-bad query.

### Pitfall 7: Migration-filename letter-suffix silent skip

**What goes wrong:** `20270601100002a_organizations.sql` (letter suffix) is silently skipped per `[[reference_supabase_migration_filename_regex]]`; schema is incomplete; subsequent migrations fail with confusing errors.

**How to avoid:** All migration filenames use strict 14-digit timestamp + underscore + snake_case. Grep `^Skipping` in `supabase db push` output before declaring migration success.

### Pitfall 8: Test fixture `TEST_SLUG_PREFIX` collision across test files

**What goes wrong:** Vitest runs `rls-org-organizations.test.ts` and `rls-org-members.test.ts` in parallel, both use prefix `'rls-test-'` → `afterAll` cleanup of file 1 deletes file 2's fixtures mid-test.

**How to avoid:** Per `[[feedback_rls_per_file_slug_prefix]]`, EACH test file derives its own prefix: `const TEST_SLUG_PREFIX = 'p28-' + __filename.split('/').pop()!.replace('.test.ts', '') + '-' + Date.now();`. afterAll cleans by `slug like '${TEST_SLUG_PREFIX}%'`.

## Code Examples

Already covered in Architecture Patterns §1–5. Two more for completeness:

### F. ESLint `no-raw-service-role-client` rule

```javascript
// eslint-rules/no-raw-service-role-client.cjs
// Source: pattern derived from existing eslint-rules/additive-only-events.cjs
// + https://typescript-eslint.io/developers/custom-rules/

'use strict';

const ALLOWED_FILE = 'src/server/supabase-server.ts';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw createClient(url, SERVICE_ROLE_KEY) outside src/server/supabase-server.ts. ' +
        'All service_role usage MUST go through withOrgScope() (Phase 28 D-06).',
    },
    messages: {
      'raw-service-role-client':
        'createClient(..., SERVICE_ROLE_KEY) is forbidden here. Import withOrgScope ' +
        'from "@/server/with-org-scope" and wrap your service_role usage.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';
    if (filename.endsWith(ALLOWED_FILE)) return {};

    return {
      CallExpression(node) {
        // Match `createClient(...)` call (regardless of import alias)
        const callee = node.callee;
        if (callee.type !== 'Identifier' || callee.name !== 'createClient') return;
        if (node.arguments.length < 2) return;

        const keyArg = node.arguments[1];
        // Match Identifier whose name ends in SERVICE_ROLE_KEY
        // (e.g., SUPABASE_SERVICE_ROLE_KEY, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
        let matched = false;

        if (keyArg.type === 'Identifier' && /SERVICE_ROLE_KEY$/.test(keyArg.name)) {
          matched = true;
        } else if (
          keyArg.type === 'CallExpression' &&
          keyArg.callee.type === 'MemberExpression' &&
          keyArg.arguments[0]?.type === 'Literal' &&
          typeof keyArg.arguments[0].value === 'string' &&
          /SERVICE_ROLE_KEY$/.test(keyArg.arguments[0].value)
        ) {
          // process.env.X / Deno.env.get('X') pattern
          matched = true;
        }

        if (matched) {
          context.report({ node, messageId: 'raw-service-role-client' });
        }
      },
    };
  },
};
```

Wire into `eslint.config.js` (additive to existing `additive-only-events` import block):

```js
const noRawServiceRoleClient = _require('./eslint-rules/no-raw-service-role-client.cjs');
// inside the same `files: ['src/**/*.{ts,tsx}', '../shared/**/*.ts']` block:
plugins: { ..., 'leanshot': { rules: { 'additive-only-events': additiveOnlyEventsRule, 'no-raw-service-role-client': noRawServiceRoleClient } } },
rules:   { ..., 'leanshot/no-raw-service-role-client': 'error' },
```

### G. Cross-tenant RLS test fixture skeleton (D-25)

```typescript
// src/lib/__tests__/rls-org-members.test.ts
// Source: pattern per [[reference_rls_fixture_gotrueclient_flake]] 2026-05-16 ES256 fix
//        + [[feedback_rls_per_file_slug_prefix]] file-scoped prefix

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL    = process.env.SUPABASE_URL!;
const SERVICE_ROLE    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY        = process.env.SUPABASE_ANON_KEY!;
const PREFIX = `p28-${'rls-org-members'}-${Date.now()}`;   // file-scoped

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// Helper: mint a session for a fixture user via admin.generateLink + verify
async function sessionFor(email: string): Promise<{ access_token: string; user_id: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const verifyUrl = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  verifyUrl.searchParams.set('token', data.properties!.hashed_token!);
  verifyUrl.searchParams.set('type', 'magiclink');
  verifyUrl.searchParams.set('redirect_to', 'http://localhost/');
  // PLAIN fetch — not supabase-js (avoids GoTrueClient cross-contamination)
  const r = await fetch(verifyUrl.toString(), { redirect: 'manual', headers: { apikey: ANON_KEY } });
  const loc = r.headers.get('location')!;
  const hash = new URL(loc).hash.slice(1);
  const params = new URLSearchParams(hash);
  return { access_token: params.get('access_token')!, user_id: data.user!.id };
}

let orgX: string, orgY: string, userA: string, userB: string;
let sessA: { access_token: string }, sessB: { access_token: string };

beforeAll(async () => {
  // Create 2 orgs + 2 users; A → X, B → Y
  const { data: ox } = await admin.from('organizations').insert({ slug: `${PREFIX}-x`, name: 'Org X', created_by: '00000000-…' }).select().single();
  const { data: oy } = await admin.from('organizations').insert({ slug: `${PREFIX}-y`, name: 'Org Y', created_by: '00000000-…' }).select().single();
  orgX = ox!.id; orgY = oy!.id;
  const a = await sessionFor(`${PREFIX}-a@example.com`); userA = a.user_id; sessA = a;
  const b = await sessionFor(`${PREFIX}-b@example.com`); userB = b.user_id; sessB = b;
  await admin.from('org_members').insert([
    { org_id: orgX, user_id: userA, role: 'admin' },
    { org_id: orgY, user_id: userB, role: 'admin' },
  ]);
});

afterAll(async () => {
  await admin.from('organizations').delete().like('slug', `${PREFIX}-%`);
});

const userClient = (token: string) =>
  createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

describe('org_members RLS cross-tenant', () => {
  it('User A in Org X cannot SELECT org_members rows of Org Y', async () => {
    const a = userClient(sessA.access_token);
    const { data, error } = await a.from('org_members').select('*').eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data).toEqual([]);   // 0 rows leaked
  });

  it('User A cannot INSERT a row for Org Y', async () => {
    const a = userClient(sessA.access_token);
    const { error } = await a.from('org_members').insert({ org_id: orgY, user_id: userA, role: 'viewer' });
    expect(error).toBeTruthy();
    expect(error!.message.toLowerCase()).toMatch(/(row-level security|permission denied|42501)/);
  });

  it('User A cannot UPDATE Org Y members', async () => {
    const a = userClient(sessA.access_token);
    const { error, count } = await a.from('org_members').update({ role: 'viewer' }).eq('org_id', orgY).select('*', { count: 'exact' });
    // Either RLS denies the UPDATE outright OR the predicate filter sees no rows.
    expect(error?.code ?? count).toSatisfy((v: unknown) => v === '42501' || v === 0);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `org_members` trigger → `auth.admin.updateUserById` for JWT claims | Custom Access Token Hook | Supabase shipped GA 2024-Q2 | Eliminates 336ms propagation window; no recursion suppression; D-09 path is now LEGACY |
| `signInWithPassword` in RLS test fixtures | `admin.generateLink + /auth/v1/verify` plain fetch | 2026-05-16 (project) | ES256-compat after Supabase project keys migrated; HS256 mintTestJwt OBSOLETE |
| pgsodium for secret encryption | Supabase Vault | 2024 (project shifted) | pgsodium deprecated; Vault is current |
| Hand-coded `import.meta.env[\`VITE_${x}\`]` dynamic env lookup | Enumerated ternaries with literal keys | 2025 (project) | Vite static-env-inlining gotcha per `[[reference_vite_static_env_inlining]]` |
| `signInWithPassword` from e2e | Pre-seeded via `addInitScript` localStorage | 2025 (project) | Per `[[reference_playwright_state_seeding]]` |

**Deprecated/outdated:**
- pgsodium for new secret storage → use Supabase Vault.
- Trigger-based JWT claim population (D-09 default) → use Custom Access Token Hook.
- `signInWithPassword` in RLS fixtures → use admin.generateLink + plain fetch.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Custom Access Token Hook latency p95 < 50ms when org_members(user_id) is indexed | §A + Pattern 3 + Pitfall 4 | Token refresh feels slow; planner adds benchmark task |
| A2 | 32-bit HMAC truncation collision risk acceptable per CONTEXT D-20 at <10K orgs × <50 tables scale | Pitfall 2 | Defense-in-depth JWT claim list check is documented mitigation; collision still recoverable |
| A3 | `realtime.messages` RLS policy can call SECDEF `get_realtime_secret()` granted to `supabase_realtime_admin` | Pattern 4 | If realtime runs policies as a different role (e.g., `authenticated`), grant model needs adjusting; verify in P28 Wave 0 spike |
| A4 | Phase 9 `public.orgs` table NOT renamed/deprecated by any in-flight v1.3 phase | Pitfall 1, Q-A1 | If P24/P27 already touched it (planner verifies), Q-A1 has additional constraints |
| A5 | `withOrgScope` Proxy approach holds up across supabase-js minor version bumps (postgrest-js v1 → v1.x) | Pattern 1 | If postgrest-js changes thenable surface, runtime assertion silently breaks; mitigate via D-28 runtime tests that exercise the Proxy directly |
| A6 | `org_invites` is a NEW table, not a view over `public.invites` | §F discussion + Pitfall 1 | If user wants to re-use `public.invites`, schema diverges (role enum, no consent scope); planner surfaces |
| A7 | `crypto.subtle.importKey({name:'HMAC',hash:'SHA-256'}, …)` is supported in jsdom (Vitest test env) and Deno (Edge Functions) and modern browsers | Pattern 5 | If jsdom missing, org-realtime tests need polyfill; trivial to fix |
| A8 | `org_realtime_channel_secret` Vault entry created once during P28 deploy via HUMAN-CHECKPOINT | Runtime State Inventory | Operator forgets; realtime channels fail with cryptic errors. Add startup health-check per `[[reference_vendor_gated_send_health_check]]` |

## Open Questions

### Q-A1 — `public.orgs` ↔ `organizations` collision **(LANDMINE — blocks any plan)**

- **What we know:** Phase 9 shipped `public.orgs` (live, has rows). CONTEXT D-11..D-29 names the table `organizations`. Phase 9 also shipped `public.memberships` (referenced from `org_members`'s position), `public.invites` (referenced from `org_invites`'s position), `public.roles` + `public.role_permissions` (RBAC infrastructure).
- **What's unclear:** Did the user (CONTEXT-gather session 2026-05-17) intend `organizations` as a NEW table or as a logical-rename of `orgs`? CONTEXT D-01 says "P28 org.ts CONSUMES Phase 9 clinic.ts wrappers as-is" — implying Phase 9 tables continue to exist. But D-11 schema doesn't include Phase 9 `orgs` columns like `logo_storage_path`, `owner_user_id`, `description`, `website_url`.
- **Recommendation:** Planner inserts Plan-0: "P28-00-RECONCILE — surface the `orgs` vs `organizations` collision via `/gsd-discuss-phase` patch; lock decision before any migration."  Three options:
  1. **EXTEND `orgs`** (recommended): rename `orgs` → `organizations` via `ALTER TABLE`, add missing columns (`status`, `is_public_listing`, `current_rank_weights_version`, `created_by` aliased to `owner_user_id`); rename FKs in `memberships`/`invites`; deprecate Phase 9 `clinic.ts` references that name `orgs` (no caller change since `clinic.ts` is the abstraction).
  2. **NEW `organizations` + DATA MIGRATION**: keep `orgs` shape, create `organizations`, copy rows, dual-write for a window, switch FKs, drop `orgs`. Higher risk (cross-FK + RLS-rewrite + Phase 9 caller migration).
  3. **`org_members` etc. FK target = `public.orgs`** (planner reframes): treat D-11 "organizations" as informal naming; FK target is `orgs(id)`. Lowest risk; requires CONTEXT wording correction only.
- **Default if user unresponsive:** Option 3 (informal naming correction) — preserves all Phase 9 surface; D-29 EXTENSION-CONTRACT.md uses the actual table name `orgs`; downstream phases unaffected.

### Q-A2 — `org_invites` vs `public.invites` (Phase 9)

- **What we know:** Phase 9 shipped `public.invites` with `invite_token_hash`, `consent_scope_at_acceptance`, `accepted_at`, sender RPC `send_invite` (route via `clinic-invite/send` Edge Function), W-1 email-enumeration fix. CONTEXT D-13 specifies `org_invites` with `invited_role org_member_role not null` (no consent_scope).
- **What's unclear:** Should P28 `org_invites` reuse `public.invites` with a new `kind` discriminator column, or ship parallel?
- **Recommendation:** Ship `org_invites` as a NEW table (different purpose: org-admin invites have a role and no consent scope; patient invites have a consent scope and no role). MUST import `makeInviteTokenHash` from `clinic.ts` to preserve W-1 fix. Edge Function MAY be a new `clinic-org-invite/send` or extend `clinic-invite/send` with a `kind: 'patient'|'org_admin'` discriminator. Plan-checker should verify W-1 invariant.
- **Default if user unresponsive:** Ship `org_invites` as new table, new Edge Function (`clinic-org-invite/send`) that imports the Phase 9 token-hash helper.

### Q-A3 — `realtime.messages` RLS policy: SECDEF helper or inline iteration

- **What we know:** Pattern 4 shows the inline RLS USING-clause sketch is structurally too tight (cannot iterate the JWT's `org_ids[]` list to find the HMAC match). The CONTEXT D-23 wording is illustrative.
- **What's unclear:** Should the policy be a one-liner calling a SECDEF helper `realtime_topic_authorized(topic, claims) returns bool`, or a more verbose policy with array iteration?
- **Recommendation:** SECDEF helper. Keeps the policy line short, unit-testable (`select realtime_topic_authorized('org-abcd1234-patients', '{"app_metadata":{"org_ids":["…"]}}'::jsonb)`), and amenable to future per-org rotation logic.

### Q-A4 — Custom Access Token Hook enablement HUMAN-CHECKPOINT

- **What we know:** Hook function is a migration; ENABLING the hook is Dashboard-only (or env var on self-hosted; not relevant for Supabase Cloud).
- **What's unclear:** Whether `supabase` CLI 2026-05 supports hook-enable via API or remains Dashboard-only.
- **Recommendation:** Plan includes HUMAN-CHECKPOINT after migration 17 lands. Researcher confirms `supabase` CLI does NOT currently expose `auth hooks enable` — Dashboard click required.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres `pgcrypto` extension | D-23 HMAC policy | ✓ (assumed Supabase-bundled) | bundled | — |
| Supabase Vault (`vault.decrypted_secrets`) | D-22 secret storage | ✓ (Phase 22 already uses) | bundled | — |
| Supabase Custom Access Token Hook | D-09 (replaces trigger) | ✓ on Pro plan | platform feature | Fall back to trigger path |
| `@typescript-eslint/parser` | D-06 ESLint rule | ✓ transitive dep | `~8.x` | — |
| `@sentry/node` (Edge Function) | D-07 fatal capture | ✓ Phase 12 wired | existing | — |
| `crypto.subtle` (browser + Deno + jsdom) | D-24 HMAC computation | ✓ all envs | native | — |
| `supabase` CLI for `--linked` queries | Schema verification | ✓ local | latest | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Custom Access Token Hook → trigger path. Both documented.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.x (existing per `clinic.test.ts`) + Playwright (existing per `e2e/`) + `supabase db query --linked` for SQL fixture/seed verification |
| Config file | `vitest.config.ts` (existing) + `playwright.config.ts` (existing) |
| Quick run command | `npx vitest run src/lib/__tests__/rls-org-*` (per file: ~5s) |
| Full suite command | `npm test && npm run test:e2e` (per project) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ORG-01 (schema) | All 8 tables exist with expected columns + RLS enabled | SQL integration | `supabase db query --linked --file tests/sql/p28-schema-shape.test.sql` | ❌ Wave 0 |
| ORG-01 (RLS) | RLS policies exist + cross-tenant deny | unit (per table) | `npx vitest run src/lib/__tests__/rls-org-{table}.test.ts` | ❌ Wave 0 (×8) |
| ORG-02 | JWT `app_metadata.org_ids` populated by Custom Access Token Hook | integration | `npx vitest run src/lib/__tests__/jwt-org-ids-hook.test.ts` | ❌ Wave 0 |
| ORG-02 (UI) | Skeleton + spinner during 600ms freshness window | e2e | `npx playwright test e2e/workspace-switcher-jwt-propagation.spec.ts` | ❌ Wave 0 |
| ORG-03 (compile-time) | `_createServiceRoleClientUnsafe().from('x')` is typed `never` | static (tsd) | `npx tsc -p tsconfig.app.json --noEmit` + `npx vitest run src/lib/__tests__/with-org-scope.test.ts` | ❌ Wave 0 |
| ORG-03 (runtime) | `withOrgScope` throws `OrgScopeBypassError` + Sentry fatal | unit | `npx vitest run src/lib/__tests__/with-org-scope.test.ts` | ❌ Wave 0 |
| ORG-03 (lint) | ESLint rule blocks raw `createClient(..., SERVICE_ROLE_KEY)` | static (lint) | `npm run lint -- --rule 'leanshot/no-raw-service-role-client:error'` | ❌ Wave 0 (rule file + test) |
| ORG-04 (cn naming) | `channelNameFor(orgId, table)` produces deterministic 8-hex HMAC | unit | `npx vitest run src/lib/__tests__/org-realtime.test.ts` | ❌ Wave 0 |
| ORG-04 (channel auth) | Cross-tenant `subscribe(channelNameFor(orgY, 'patients'))` → CHANNEL_ERROR | e2e | `npx playwright test e2e/rls-org-realtime-channel.spec.ts` | ❌ Wave 0 |
| ORG-05 | Every org-scoped table has a `*-rls.test.ts` (plan-checker BLOCKER) | meta | plan-checker step | enforced per D-26 |
| ORG-06 | `useCurrentOrg`, `surfaceCheck`, `withOrgPath`, `overlayBrandingTokens` | unit | `npx vitest run src/lib/__tests__/org.test.ts` | ❌ Wave 0 |
| ORG-07 | `/clinic/{slug}` for member renders surface; non-member with invite → invite-accept UI; otherwise 404 | e2e | `npx playwright test e2e/route-org-guard.spec.ts` | ❌ Wave 0 |
| ORG-07 (anti-enumeration) | `resolve_clinic_slug` returns `not_found` for existing-but-no-membership | integration | `npx vitest run src/lib/__tests__/resolve-clinic-slug.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/__tests__/rls-org-*` (under 30s per file in parallel)
- **Per wave merge:** `npm test -- --run` (full Vitest sweep) + `npm run test:e2e -- --grep 'p28'`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/rls-org-organizations.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-members.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-invites.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-subscriptions.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-settings.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-branding.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-patient-links.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/rls-org-consent-grants.test.ts` — covers ORG-01/05
- [ ] `src/lib/__tests__/with-org-scope.test.ts` — covers ORG-03 (runtime + compile-time)
- [ ] `src/lib/__tests__/org-realtime.test.ts` — covers ORG-04 (channel name HMAC)
- [ ] `src/lib/__tests__/jwt-org-ids-hook.test.ts` — covers ORG-02 (hook behavior)
- [ ] `src/lib/__tests__/org.test.ts` — covers ORG-06 (hook + surfaceCheck + path)
- [ ] `src/lib/__tests__/resolve-clinic-slug.test.ts` — covers ORG-07 anti-enumeration
- [ ] `tests/sql/p28-schema-shape.test.sql` — covers ORG-01 column presence
- [ ] `e2e/route-org-guard.spec.ts` — covers ORG-07
- [ ] `e2e/workspace-switcher-jwt-propagation.spec.ts` — covers ORG-02 UI
- [ ] `e2e/rls-org-realtime-channel.spec.ts` — covers ORG-04 channel-auth
- [ ] Fixture helper: `src/lib/__tests__/_fixtures/p28-rls-fixture.ts` — `sessionFor()`, `createTwoOrgsTwoUsers()`, file-scoped prefix factory
- [ ] Optional dep: `npm install --save-dev expect-type` if planner wants explicit type-level assertions

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth + Phase 24 TOTP + Phase 25 MFA hard-cut on `/clinic/*`; P28 inherits |
| V3 Session Management | yes | Supabase JWT + `aal2` step-up enforced by Phase 24 D-09; P28 hook updates claim at every mint |
| V4 Access Control | yes | RLS + Pattern S1 dual-layer (client `surfaceCheck` + DB SECDEF role check) |
| V5 Input Validation | yes | zod schemas for SECDEF RPC params (matches Phase 24 event-taxonomy approach); `_validate_consent_scope` shape guard |
| V6 Cryptography | yes | **NEVER hand-roll** — use `extensions.hmac()` (pgcrypto) + `crypto.subtle.sign('HMAC', ...)` (browser/Deno) + Vault for secret storage |
| V9 Communications | yes | TLS via Supabase platform; HSTS via Vercel; no plaintext credentials |
| V12 Files | n/a | P28 adds no file upload surface |
| V13 API | yes | SECDEF RPCs MUST validate role at entry per Pattern S1; rate-limit `send_org_invite` per Phase 9 W-1 pattern |
| V14 Configuration | yes | Vault secret + `revoke execute … from public` defense-in-depth |

### Known Threat Patterns for {Supabase + multi-tenant SaaS}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| service_role client bypasses RLS | Tampering / EoP | Brand types + `withOrgScope` Proxy + ESLint rule + Sentry fatal alert (D-04..D-08) |
| JWT claim staleness leaks cross-tenant | EoP | Custom Access Token Hook (fresh-at-mint); RLS USING-clause also queries `org_members` directly (defense-in-depth) |
| Realtime channel collision / spoofing | Information Disclosure | HMAC-derived channel names + RLS server-side recomputation (D-20..D-23) + JWT org_ids list check |
| Email enumeration via invite | Information Disclosure | Reuse Phase 9 W-1 fix: send_invite returns identical shape regardless of email existence |
| Clinic-slug enumeration via 404 timing | Information Disclosure | `resolve_clinic_slug` returns `not_found` for both non-existent + existing-no-membership; constant-cost SQL path (D-19) |
| Vault secret leaked via SECDEF over-grant | Information Disclosure | Explicit `revoke execute on function get_realtime_secret() from public, authenticated, anon` + grant only to `supabase_realtime_admin` |
| Bulk admin actions cross-tenant | Tampering | Pattern S1 — every SECDEF RPC validates caller is org member of `p_org_id` AND has required role |
| HMAC 32-bit collision crosses tenants | Information Disclosure | Defense-in-depth: RLS policy ALSO checks JWT `app_metadata.org_ids @>` claimed org_id (Pitfall 2) |
| Org admin removed mid-session retains access | EoP | Realtime `setAuth-before-subscribe` re-fetches JWT (Phase 9); next claim mint excludes the org_id; client-side `USER_UPDATED` listener invalidates Zustand `org` slice |
| Patient PHI access not logged via org route | Repudiation | `<RouteOrgGuard>` MUST compose with Phase 25 D-07 `log_phi_access` — researcher flags as integration-seam audit item |

## Sources

### Primary (HIGH confidence)
- [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) — function signature, JSON shape, app_metadata mutation
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) — `realtime.topic()`, `realtime.messages` RLS, `current_setting('request.jwt.claims')`
- [Supabase Vault docs](https://supabase.com/docs/guides/database/vault) — `vault.decrypted_secrets`, SECDEF wrapper pattern, revoke-default-grant
- [PostgreSQL pgcrypto docs](https://www.postgresql.org/docs/current/pgcrypto.html) — `hmac(data, key, 'sha256')` signature + bytea return + `encode(..,'hex')`
- [typescript-eslint Custom Rules](https://typescript-eslint.io/developers/custom-rules/) — `@typescript-eslint/utils` matcher pattern, CallExpression argument inspection
- Project codebase — `src/lib/clinic.ts` (Phase 9 wrapper pattern), `src/lib/clinic-realtime.ts` (setAuth-before-subscribe), `eslint-rules/additive-only-events.cjs` (custom rule template), `supabase/migrations/20260801000002_orgs.sql` (confirms `public.orgs` is live)
- Project memory — `[[reference_rls_fixture_gotrueclient_flake]]`, `[[feedback_rls_per_file_slug_prefix]]`, `[[reference_supabase_migration_gotchas]]`, `[[reference_supabase_migration_filename_regex]]`, `[[reference_supabase_app_metadata_jwt_propagation]]`, `[[reference_vendor_gated_send_health_check]]`

### Secondary (MEDIUM confidence)
- [postgrest-js source PostgrestQueryBuilder](https://github.com/supabase/postgrest-js/blob/master/src/PostgrestQueryBuilder.ts) — confirms thenable surface for Proxy approach
- [JSON Web Token (JWT) | Supabase](https://supabase.com/docs/guides/auth/jwts) — claims structure + propagation behavior
- [Custom Claims & RBAC | Supabase](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) — confirms hook is preferred path

### Tertiary (LOW confidence — flag for Wave 0 spike)
- Exact `realtime.messages` execution role + grant requirements for `get_realtime_secret()` — recommend a 30-min spike to verify `supabase_realtime_admin` is the right grantee (A3 assumption)
- Hook latency p95 under realistic `org_members` load — recommend benchmark in Wave 0 (A1 assumption)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in project; Postgres extensions verified bundled
- Architecture (Patterns 1–5): HIGH on Patterns 2, 3, 4 sketches; MEDIUM on Pattern 1 (Proxy at-thenable) — verified mechanism but novel application
- Pitfalls: HIGH — Pitfalls 1, 2, 3, 5, 6, 7, 8 all backed by project memory or upstream docs; Pitfall 4 backed by general perf intuition + needs benchmark
- Open Questions: HIGH on Q-A1 (verified live `public.orgs` exists); MEDIUM on Q-A2 (Phase 9 invite shape requires planner read of `public.invites` schema)
- Validation Architecture: HIGH — test types map cleanly to Phase 9 conventions + project rules
- Security Domain: HIGH on ASVS mapping; MEDIUM on Realtime channel-spoofing mitigation (defense-in-depth design correct but A3 spike needed)

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days; Supabase Realtime + Vault docs are stable; revisit if supabase-js majors)
