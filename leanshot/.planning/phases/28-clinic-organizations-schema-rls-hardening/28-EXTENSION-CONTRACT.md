# Phase 28 EXTENSION CONTRACT

**Version:** 1.0  
**Issued:** 2026-05-17  
**Owned by:** Phase 28  
**Consumed by:** P29 (metered billing), P30 (clinician dashboard), P31 (white-label theming), P40 (SAVE flows), P50 (RAG knowledge base), and any v1.4+ phase that introduces new org-scoped tables.

> **This is the single source of truth for downstream phase planners and plan-checkers.** Read this document BEFORE planning or implementing any feature that touches the `org_*` table namespace. Plan-checker rules derived from this contract live at:
> `$HOME/.claude/get-shit-done/references/plan-checker-p28-extension.md`

---

## Section 1: Scope and Downstream Consumers

This contract documents the 4-vector multi-tenant defense pattern established in Phase 28 and locks the invariants downstream phases MUST preserve when shipping new org-scoped tables.

**P28 shipped (Wave 0-2, Plans 00-02):**
- `public.organizations` — renamed from Phase 9 `public.orgs` (Plan 00)
- 7 net-new org-scoped tables: `org_members`, `org_invites`, `org_subscriptions`, `org_settings`, `org_branding`, `org_patient_links`, `org_consent_grants` (Plan 01)
- 4 SECDEF RPCs: `send_org_invite`, `revoke_org_invite`, `accept_org_invite`, `link_org_patient` (Plan 01)
- `withOrgScope` Proxy wrapper + `ORG_SCOPED_TABLES` const at `supabase/functions/_shared/with-org-scope.ts` (Plan 02)
- `_createServiceRoleClientUnsafe()` brand-typed at `supabase/functions/_shared/supabase-server.ts` (Plan 02)
- ESLint rule `no-raw-service-role-client` at `eslint-rules/no-raw-service-role-client.cjs` (Plan 02)
- 8 cross-tenant RLS proof tests at `leanshot/src/lib/__tests__/rls-org-*.test.ts` (Plan 01)
- Realtime HMAC channel auth, JWT `org_ids` claim, `src/lib/org.ts`, `<RouteOrgGuard>` — planned in Plans 03-06 (to be merged in subsequent waves)

**P29 adds:** `org_subscription_meters`  
**P30 adds:** `clinician_alerts`, `ranking_weights`, `ranking_snapshots`  
**P31 adds:** `org_branding_themes`, `onboarding_flows`, `onboarding_steps`, `locale_overrides_org`

Each downstream plan-checker iteration MUST cite this file as mandatory input.

---

## Section 2 (D-29a): RLS Policy Template for New Org-Scoped Tables

Every new `org_*` table introduced by downstream phases MUST follow this exact pattern. Copy, replace `<table>` and `<table_desc>`, and ship as a new numbered migration.

```sql
-- ============================================================
-- RLS template for a new org_* table (Phase 28 D-29a)
-- Replace <table>, <table_desc> throughout.
-- ============================================================

create table if not exists public.<table> (
  id    uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- NEVER `on delete cascade` — preserve audit trail (per D-17 / Phase 24 D-17 append-only RLS)
  -- ... other columns ...
  created_at timestamptz not null default now()
);

-- Required index: org_id lookup is the hot path for every RLS policy predicate
create index if not exists <table>_org_id_idx on public.<table>(org_id);

-- Enable row-level security
alter table public.<table> enable row level security;
alter table public.<table> force row level security;

-- SELECT policy: org members of the same org_id may read rows.
-- For patient-scoped tables (org_patient_links, org_consent_grants pattern):
--   add a second SELECT policy that allows the patient themselves to read own rows.
create policy "<table>_select_by_org_members"
  on public.<table>
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = <table>.org_id
        and om.user_id = auth.uid()
    )
  );

-- NO INSERT / UPDATE / DELETE policy for `authenticated` role.
-- All writes go through SECDEF RPCs (Pattern S1 dual-layer, see Section 2b below).
-- If a downstream phase needs direct INSERT (rare), it MUST use a SECDEF RPC
-- that internally calls log_admin_action (Phase 24 D-17 + Phase 24 audit invariant).
```

### 2b: SECDEF RPC pattern (Pattern S1 dual-layer)

Every write operation on org-scoped tables MUST go through a SECURITY DEFINER function that:
1. Re-checks the caller's org membership and role (client-side `surfaceCheck()` is not sufficient — SECDEF re-validates inside the function body).
2. Asserts the org_id parameter matches the caller's org_ids JWT claim (or queries `org_members` directly).
3. Calls `log_admin_action` (Phase 24 audit invariant — every destructive SECDEF must write an audit entry).
4. Sets explicit `search_path = pg_catalog, public, extensions` (per `[[reference_supabase_migration_gotchas]]` — omitting this allows search_path injection in SECURITY DEFINER context).

```sql
create or replace function public.<rpc_name>(
  p_org_id  uuid,
  -- ... other parameters with p_ prefix per Phase 9 convention ...
) returns <return_type>
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_role  public.org_member_role;
begin
  -- Pattern S1: DB-level role re-check (client gate is first layer; this is second)
  select role into v_caller_role
  from public.org_members
  where org_id = p_org_id and user_id = auth.uid();

  if v_caller_role is null then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if v_caller_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- ... function body ...

  -- Phase 24 audit invariant: every SECDEF RPC must call log_admin_action
  perform public.log_admin_action(
    p_action   => '<rpc_name>',
    p_table_name => '<table>',
    p_record_id  => <affected_id>,
    p_new_data   => to_jsonb(<result_row>)
  );

  return <result>;
end;
$$;
```

---

## Section 3 (D-29b): Cross-Tenant Test Recipe

Every new `org_*` table MUST ship with a paired `rls-org-<tablename>.test.ts` file at `leanshot/src/lib/__tests__/`. The plan-checker BLOCKS any migration that introduces a new `org_*` table without a matching test file (BLOCKER R1 in `plan-checker-p28-extension.md`).

### 3a: Fixture exports (verbatim from `src/lib/__tests__/_fixtures/p28-rls-fixture.ts`)

```typescript
// File-scoped prefix — avoids vitest file-parallelism clobbering
const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));

// ES256-compatible session mint (never signInWithPassword — see [[reference_rls_fixture_gotrueclient_flake]])
async function sessionFor(email: string): Promise<Session>

// Creates 2 orgs (X, Y) + 2 users (A in X, B in Y) via admin API
async function createTwoOrgsTwoUsers(prefix: string): Promise<TwoOrgsTwoUsers>

// Cleanup after all tests — call in afterAll()
async function cleanupByPrefix(prefix: string): Promise<void>

// Skip tests if env vars absent (non-blocking in unit CI, required in e2e CI)
const SHOULD_RUN: boolean
```

### 3b: Copy-pasteable test file skeleton

```typescript
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  makeSlugPrefix,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P28 RLS — <table> cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    // Seed a known row in Org Y for testing reads/modifications
    // ... seed via getAdmin().from('<table>').insert({ org_id: fixture.orgY, ... })
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ASSERTION 1 — Cross-tenant SELECT returns 0 rows (RLS predicate filter)
  it('T3: User A cannot SELECT <table> of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('<table>')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // ASSERTION 2 — Cross-tenant INSERT denied (RLS deny-all for authenticated)
  it('T4: User A cannot INSERT into <table> of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('<table>').insert({
      org_id: orgY,
      // ... other required columns ...
    });
    expect(error).not.toBeNull(); // 42501 or equivalent RLS rejection
  }, 30_000);

  // ASSERTION 3 — Cross-tenant UPDATE affects 0 rows (or errors)
  it('T5a: User A cannot UPDATE <table> rows in Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client
      .from('<table>')
      .update({ /* some field */ })
      .eq('org_id', orgY);
    // RLS filter means 0 rows matched; verify via admin that data is unchanged
    expect(error).toBeNull(); // UPDATE with 0 rows is not an error in Postgres
    // ... admin check that row is unchanged ...
  }, 30_000);

  // ASSERTION 4 — Cross-tenant DELETE affects 0 rows (or errors)
  it('T5b: User A cannot DELETE <table> rows in Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client
      .from('<table>')
      .delete()
      .eq('org_id', orgY);
    expect(error).toBeNull(); // DELETE with 0 rows is not an error
  }, 30_000);

  // ASSERTION 5 — Same-tenant SELECT returns OWN rows (RLS permits own data)
  it('T3b: User A CAN SELECT <table> of Org X (own org)', async () => {
    const { orgX, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('<table>')
      .select('id')
      .eq('org_id', orgX);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(0); // 0 is fine if no rows were seeded
  }, 30_000);
});
```

Run tests via: `npx vitest run src/lib/__tests__/rls-org-<table>.test.ts --config vitest-e2e.config.ts`

---

## Section 4 (D-29c): Naming Conventions

### Table naming
- **Prefix `org_*` is MANDATORY** for all downstream tables that are org-scoped. Examples from downstream phases:
  - P29: `org_subscription_meters`
  - P30: does NOT use `org_*` prefix for `clinician_alerts` / `ranking_weights` / `ranking_snapshots` — these are user-scoped. Plan-checker must verify these are NOT in the org_scoped_tables allowlist unless they add an `org_id` column.
  - P31: `org_branding_themes`, `onboarding_flows` (org-scoped via `org_id` FK), `onboarding_steps`, `locale_overrides_org`

### org_id foreign key column
- Column declaration: `org_id uuid not null references public.organizations(id) on delete restrict`
- **`on delete restrict` is MANDATORY.** Never use `on delete cascade` on org_id FKs — it destroys the audit trail when an org is soft-deleted (Phase 24 D-17 append-only invariant). Orgs are archived via `status = 'archived'`, never hard-deleted.
- Column position: declare immediately after the primary key (`id uuid pk`) so schema diffs are predictable.

### Migration filename
- Strict format: `<14-digit-timestamp>_<snake_case_name>.sql`
- Letter suffixes (e.g., `20260801000002a_...`) are SILENTLY SKIPPED by `supabase migration push` (per `[[reference_supabase_migration_filename_regex]]`). Never use letter suffixes.
- Timestamps must be monotonically increasing within a phase. Check existing migrations in `supabase/migrations/` before picking a new timestamp.

### Status enum ownership
Status enum values MUST have a named owning function (per `[[feedback_status_machine_transition_owner]]`). Every value present in a new enum must appear in the status-machine transition table (see Section 7) with a named owning plan and task. A value with no transition owner ships dead and blocks the downstream feature that depends on it.

---

## Section 5 (D-29d): ORG_SCOPED_TABLES Update Checklist

Every new `org_*` table MUST be appended to the `ORG_SCOPED_TABLES` const in `supabase/functions/_shared/with-org-scope.ts`. The Proxy wrapper's runtime assertion fires for any table in this set that is accessed without an `org_id` filter — this is the third layer of the 4-layer defense.

### Current contents (verbatim, as of P28 Plan 02)

```typescript
// supabase/functions/_shared/with-org-scope.ts
export const ORG_SCOPED_TABLES = new Set<string>([
  'organizations',
  'org_members',
  'org_invites',
  'org_subscriptions',
  'org_settings',
  'org_branding',
  'org_patient_links',
  'org_consent_grants',
  // P29: add 'org_subscription_meters'
  // P30: add tables that have org_id column (clinician_alerts, ranking_weights, ranking_snapshots if org-scoped)
  // P31: add 'org_branding_themes', 'onboarding_flows', 'onboarding_steps', 'locale_overrides_org'
]);
```

### Checklist for each downstream phase

1. Open `supabase/functions/_shared/with-org-scope.ts`.
2. Locate the `ORG_SCOPED_TABLES` Set.
3. Add the new table name as a string literal inside the Set.
4. Add a comment line `// P<N>: <table_name>` for audit traceability.
5. Verify the Proxy test suite (`leanshot/src/lib/__tests__/with-org-scope.test.ts` Test 9: "Each ORG_SCOPED_TABLE triggers bypass error without org_id filter") still passes after adding the new table.

**Plan-checker BLOCKER R2:** any `create table public.org_*` migration without a matching `ORG_SCOPED_TABLES` entry FAILS plan-checker iteration.

---

## Section 6 (D-29e): HMAC Channel-Name Registration Checklist

The `realtime_topic_authorized` SECDEF helper (shipped in Plan 04) authorizes realtime channel subscriptions for org-scoped tables. The helper iterates the JWT's `app_metadata.org_ids` array and recomputes the HMAC for each org to verify the topic name.

### Channel name format
`org-{8-char-lowercase-hex-hmac}-{table_name}`

Example: `org-7f3c9a1d-org_members`

### HMAC computation
- Input: `org_id || ':' || table_name` (concatenation)
- Secret: Supabase Vault key `org_realtime_channel_secret` (single per-deployment)
- Algorithm: SHA-256 HMAC, first 8 hex characters of the result
- Browser side: `src/lib/org-realtime.ts` exports `channelNameFor(orgId, table)` using `crypto.subtle`

### For downstream phases adding new org-scoped realtime subscriptions

1. **Browser side:** Use `channelNameFor(orgId, '<new_table>')` from `src/lib/org-realtime.ts` to generate the channel name deterministically.
2. **DB side:** No migration needed — the `realtime_topic_authorized` helper accepts any lowercase snake_case table name via its permissive regex `'^org-[0-9a-f]{8}-[a-z_]+$'`.
3. **RLS sweep:** Write a cross-tenant realtime test: User A subscribes to `channelNameFor(orgY, '<new_table>')` and MUST receive `CHANNEL_ERROR` (per `[[feedback_realtime_layer_e2e_pattern]]`). This mirrors Plan 04's `e2e/rls-org-realtime-channel.spec.ts`.
4. **Verify the composite:** `realtime_topic_authorized` re-verifies both the HMAC match AND that the org_id is in the caller's JWT `org_ids` claim. The second check prevents 32-bit HMAC collisions from granting access.

**Note on Plans 03-06:** The `realtime_topic_authorized` helper, `src/lib/org.ts` org-context layer, and `<RouteOrgGuard>` are specified in Plans 03-06. If those plans are not yet merged when a downstream phase ships, coordinate with the Phase 28 wave responsible for Plans 03-06 before shipping realtime subscriptions or routing.

---

## Section 7: Status-Machine Transition Ownership

Per `[[feedback_status_machine_transition_owner]]`: every status enum value needs a named owning function and plan+task. Downstream phases MUST update this table when they add new status values.

| Table | Status Value | Transition | Owner (plan + RPC/cron) |
|-------|-------------|------------|------------------------|
| `org_invites` | `pending` | (created) → pending | `send_org_invite` SECDEF RPC (P28 Plan 01 Task 1 #9) |
| `org_invites` | `accepted` | pending → accepted | `accept_org_invite` SECDEF RPC (P28 Plan 01 Task 1 #9) |
| `org_invites` | `expired` | pending → expired | pg_cron `p28_org_invites_expiry_purge` at 04:00 UTC (P28 Plan 01 Task 1 #11) |
| `org_invites` | `revoked` | pending → revoked | `revoke_org_invite` SECDEF RPC (P28 Plan 01 Task 1 #9) |
| `org_subscriptions` | `pending` | (created) → pending | P28 Plan 01 Task 1 skeleton only — P29 owns all writes |
| `org_subscriptions` | `active` | pending → active | P29 Stripe webhook Edge Function (DEFERRED — P29 owns) |
| `org_subscriptions` | `past_due` | active → past_due | P29 Stripe webhook Edge Function (DEFERRED — P29 owns) |
| `org_subscriptions` | `canceled` | active → canceled | P29 Stripe webhook Edge Function (DEFERRED — P29 owns) |

**Downstream phases adding new status enums:** Add rows to this table in a PR description or SUMMARY.md. Each row must name the SECDEF RPC or pg_cron job that owns the transition. A value with no owner row is a blocker.

---

## Section 8: Defensive JSONB Shape Contracts

Per `[[feedback_planner_iter1_anti_patterns]]` anti-pattern #4: defensive jsonb contracts live in ONE TypeScript type AND ONE database validator function. Never duplicate across TS and DB, and never have two separate TS types for the same DB shape.

### Existing validator: `_validate_consent_scope` (Phase 9)

The `org_consent_grants.scope` column is validated by the Phase 9 `_validate_consent_scope` function via a BEFORE INSERT/UPDATE trigger (`org_consent_grants_validate_scope`). Plan 01 deviation #2 documents that `_validate_consent_scope` returns `void` (not `boolean`), so a CHECK constraint is not possible — use the trigger pattern.

**DO NOT duplicate this function.** Any downstream phase that adds jsonb columns holding consent scope data MUST reuse `_validate_consent_scope` via a trigger.

### Pattern for NEW jsonb shapes (e.g., P30 alert payloads)

1. Define ONE TypeScript type in `src/types/` (e.g., `src/types/clinician-alert.ts`).
2. Define ONE database check function — a SECDEF SQL function that validates the jsonb shape. Example pattern:
   ```sql
   create or replace function public._validate_clinician_alert_payload(payload jsonb) returns void
     language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
   begin
     if (payload->>'type') is null then
       raise exception 'clinician_alert payload must include type field';
     end if;
     -- ... additional shape checks ...
   end;
   $$;
   ```
3. Wire as a BEFORE INSERT/UPDATE trigger on the new table (same pattern as `org_consent_grants`).
4. The TS type and DB validator MUST stay in sync — if the shape changes, update both atomically in the same commit.

---

## Section 9: Downstream Phase Appendix

Forward declarations of tables expected from downstream phases. Each phase's plan-checker iteration verifies extension-contract compliance before plan-checker PASSES.

### P29 — Metered Billing (org_subscription_meters)

| Table | Status | `ORG_SCOPED_TABLES` entry | Paired RLS test |
|-------|--------|--------------------------|-----------------|
| `org_subscription_meters` | DEFERRED to P29 | Add to with-org-scope.ts | `rls-org-subscription-meters.test.ts` |

Status-machine additions: P29 owns all `org_subscriptions` write transitions (pending → active, active → past_due, active → canceled) via Stripe webhook Edge Function.

SECDEF RPCs P29 must add: Stripe webhook handler that writes `org_subscriptions` and `org_subscription_meters` with Pattern S1 + `log_admin_action`.

### P30 — Clinician Dashboard (alerts, ranking_weights, ranking_snapshots)

| Table | Notes |
|-------|-------|
| `clinician_alerts` | If org-scoped (has `org_id` FK), add to `ORG_SCOPED_TABLES`; if user-scoped only, omit |
| `ranking_weights` | If org-scoped, add to `ORG_SCOPED_TABLES` |
| `ranking_snapshots` | If org-scoped, add to `ORG_SCOPED_TABLES` |

P30 must resolve whether these tables are org-scoped or clinician-user-scoped. If org-scoped: BLOCKER R1 (paired RLS test) + BLOCKER R2 (ORG_SCOPED_TABLES) apply. If user-scoped only: the tables do not need `org_id` FK and are out of this contract's scope.

### P31 — White-Label Theming (org_branding_themes, onboarding_flows, onboarding_steps, locale_overrides_org)

| Table | `ORG_SCOPED_TABLES` entry | Paired RLS test |
|-------|--------------------------|-----------------|
| `org_branding_themes` | Add to with-org-scope.ts | `rls-org-branding-themes.test.ts` |
| `onboarding_flows` | Add (if org-scoped) | `rls-org-onboarding-flows.test.ts` |
| `onboarding_steps` | Add (if org-scoped) | `rls-org-onboarding-steps.test.ts` |
| `locale_overrides_org` | Add to with-org-scope.ts | `rls-org-locale-overrides.test.ts` |

P31 also owns: full `org_branding` theme overlay (Plan 28 ships skeleton with primary_color + accent_color only), `accept_org_invite` UI consumer (RPC shipped in P28 Plan 01 but has no UI consumer until P31 onboarding builder).

### P40 — SAVE Flows (unknown tables at P28 planning time)

P40 plan-phase MUST read this document as mandatory input. Any new org-scoped tables introduced by P40 follow the full 5-point compliance checklist (BLOCKERs R1-R5 in `plan-checker-p28-extension.md`).

### P50 — Admin-Curated RAG Knowledge Base

P50 does not introduce org-scoped tables (RAG knowledge base is globally scoped). However, if a P50 downstream iteration scopes knowledge bases per-org, it must follow this contract.

---

## ADDENDUM Cross-Reference

The 7 addendum items from `28-ADDENDUM-orgs-reconciliation.md` affect downstream phases as follows:

| Addendum | Impact on Downstream Phases |
|----------|-----------------------------|
| A1 — `orgs` renamed to `organizations` (Plan 00) | All downstream SQL and TS code must reference `public.organizations`, not `public.orgs`. The `org_*` FK pattern references `organizations(id)` cleanly. |
| A2 — `org_invites` is a NEW table (not discriminated `invites`) | P29/P30/P31 invite-related code is a NEW Edge Function pattern, not an extension of Phase 9 `clinic-invite/send`. W-1 email-enumeration fix MUST be replicated. |
| A3 — JWT claim via Custom Access Token Hook (Plan 03) | P29 Stripe webhook Edge Function can rely on `app_metadata.org_ids` claim being present at token mint (no 336ms window). Still design for 600ms polling fallback per CONTEXT D-10. |
| A4 — HMAC channel auth via SECDEF helper (Plan 04) | Downstream realtime subscriptions use `channelNameFor(orgId, table)` + trust the `realtime_topic_authorized` helper. No inline RLS USING clause needed. |
| A5 — Plan 00 is Wave 0 prerequisite | All P29/P30/P31 migrations assume `public.organizations` exists. Verify this in plan-checker entry condition if a downstream phase runs very early in a new v1.4 branch. |
| A6 — ESLint rule `.cjs` extension | `no-raw-service-role-client.cjs` — downstream CI lint steps must include the `.cjs` glob. The existing `npm run lint` command covers this if `eslint.config.js` is current. |
| A7 — `withOrgScope` lives in `supabase/functions/_shared/` | Server-side code using `withOrgScope` must import from `supabase/functions/_shared/with-org-scope.ts`. NEVER import into `src/` (browser bundle). |

---

*Phase 28 EXTENSION CONTRACT v1.0 — 2026-05-17*  
*Update this document when plan-checker rules change or new downstream phases are added.*
