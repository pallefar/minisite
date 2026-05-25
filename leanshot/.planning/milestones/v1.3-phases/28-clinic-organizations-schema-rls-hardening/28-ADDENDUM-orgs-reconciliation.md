# Phase 28 ADDENDUM — orgs vs organizations reconciliation

**Issued:** 2026-05-17
**Supersedes (selectively):** `28-CONTEXT.md` decisions D-11..D-29 wherever they reference an "organizations" table.
**Trigger:** `28-RESEARCH.md` Q-A1 + Q-A2 BLOCKER findings (commit `51ece7e`). Phase 9 already shipped live `public.orgs` + `public.invites` + `public.memberships`; CONTEXT.md was written as if greenfield.

> **Downstream agents MUST read this BEFORE planning or implementing.** Where this addendum and CONTEXT.md disagree, this addendum wins.

---

## Decision A1 — Rename Phase 9 `public.orgs` → `organizations` (single ALTER migration)

**Locks Q-A1.** Selected: **Option 1 — ALTER TABLE rename + add columns.**

### What ships in Plan-0 (`28-00-PLAN.md`) — RECONCILE

A single Plan-0 migration runs BEFORE any other P28 migration. Atomic in one transaction:

1. `ALTER TABLE public.orgs RENAME TO organizations;`
2. Add the columns CONTEXT D-11 spec'd:
   - `status org_status default 'active'` (new enum `org_status` with values `'active','suspended','archived'`)
   - `is_public_listing boolean default false` (reserved for v1.4 per CONTEXT D-15)
   - `current_rank_weights_version uuid null` (reserved for P30)
3. Column rename: `owner_user_id` → `created_by` (preserves Phase 9 referential meaning; CONTEXT D-11 spec'd `created_by`). If Phase 9 also stored the creator under a different column (planner verifies via `supabase db query --linked --query "\d organizations"` after rename), reconcile to a single `created_by uuid references auth.users(id) on delete restrict`.
4. FK relabels — every Phase 9 FK pointing at `orgs(id)` is preserved automatically by Postgres on `RENAME TABLE` (FKs reference object id, not name). Verify post-migration: `\d+ memberships`, `\d+ invites`, `\d+ roles`, `\d+ role_permissions` all show `references organizations(id)`.
5. View / function / policy references — Postgres rewrites `pg_depend` automatically on RENAME for direct table refs, but any **string-literal** references inside `EXECUTE format(...)` SECDEF function bodies or RLS `USING` clauses that compose SQL via concatenation will SILENTLY break. Plan-0 must `pg_dump --schema-only` before + after and diff for any remaining literal `'orgs'` token.
6. Rename impact on `clinic.ts` — Phase 9 wrappers go through `supabase.rpc(...)` and `supabase.from('orgs')` (planner greps `clinic.ts` for any direct `.from('orgs')`). If any direct `.from('orgs')` exists, ALTER must be paired with a `clinic.ts` patch in the SAME plan-0 commit so callers don't break between rename and patch (no two-phase deploy gap).
7. Existing RLS policies are preserved verbatim on the renamed table — verify policy names + USING/CHECK expressions match Phase 9 baseline before adding the new P28 policies.

**Why this path (not Option 2 NEW table + data migration, not Option 3 keep `orgs` name forever):** Zero data migration; zero risk of dual-write inconsistency; clean naming asymmetry resolved permanently (downstream tables `org_members`, `org_invites`, `org_subscriptions`, etc. become `references organizations(id)` cleanly — not `references orgs(id)` which would forever read awkwardly against `org_*` siblings). User's aggressive-foundations posture: fix the name now while Phase 9 callsites are still few and abstracted behind `clinic.ts`. Option 3 (keep `orgs`) was rejected for the forever-quirk; Option 2 (data migration) rejected for unnecessary risk on live data.

### CONTEXT.md decisions affected — read AS-IF amended

Every D-11..D-29 reference to "organizations" reads correctly POST-PLAN-0. Specifically:
- D-11: organizations table — POST-RENAME, identical to spec. The columns added in P28 are the ones CONTEXT lists.
- D-12: `org_members` references `organizations(id)` — correct as-spec'd.
- D-13: `org_invites.org_id references organizations` — correct.
- D-14: `org_subscriptions.org_id` PK — correct.
- D-15: `org_settings.org_id` PK — correct.
- D-16: `org_branding.org_id` PK — correct.
- D-17: `org_patient_links.org_id` — correct.
- D-18: `org_consent_grants.org_id` — correct.

### Required pre-plan-0 audit (Plan-0 task #1)

Before the rename, planner MUST emit a task that runs (per `[[reference_supabase_db_query_linked]]`):

```bash
supabase db query --linked --query "
  select n.nspname as schema, c.relname as table, c.reltuples::bigint as approx_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('orgs','organizations','memberships','invites','roles','role_permissions','consents','org_audit_logs')
  order by c.relname;
"
```

Result captured in PLAN-0 SUMMARY for audit. Any unexpected pre-existing `organizations` table → STOP + escalate (likely indicates partial roll-forward from a prior attempt; manual recovery required, not autopilot).

### Required Phase 9 caller verification (Plan-0 task #2)

```bash
grep -rn "from\s*['\"]orgs['\"]\|\.from(['\"]orgs['\"])\|table.*['\"]orgs['\"]" src/ | head
```

Every hit must be patched in the SAME commit as the ALTER (no gap window). If 0 hits, the abstraction held — patch nothing, commit migration alone.

### Required post-rename verification (Plan-0 task #3)

After the migration runs, planner emits a task that runs the existing v1.1 cross-tenant RLS test fixture for the renamed table (`memberships`, `invites`) to confirm Phase 9 isolation behavior is preserved bit-for-bit. Any regression → revert migration via `supabase migration down` (per `[[reference_supabase_migration_gotchas]]`) and escalate.

---

## Decision A2 — `org_invites` ships as a parallel NEW table (not a discriminator on `public.invites`)

**Locks Q-A2.** Selected: **Parallel new table + new Edge Function.**

- `org_invites` schema as CONTEXT D-13 spec'd, with one addition: planner MUST import `makeInviteTokenHash` from `src/lib/clinic.ts` (Phase 9 W-1 fix preserves email-enumeration defense). Do NOT re-implement.
- New Edge Function `clinic-org-invite/send` ships as a sibling to Phase 9's `clinic-invite/send`. Does NOT extend `clinic-invite/send` with a discriminator (per Q-A2 recommendation — keeps blast radius scoped + RLS policies single-shape per table).
- Plan-checker BLOCKER: any `org_invites` PLAN that does NOT explicitly import the Phase 9 token-hash helper fails plan-checker (per W-1 invariant).
- Plan-checker BLOCKER: the new `clinic-org-invite/send` Edge Function MUST replicate Phase 9's identical 200-status return regardless of whether the invitee email exists in `auth.users` (W-1 anti-enumeration response shape).

---

## Decision A3 — JWT propagation: prefer Custom Access Token Hook over the org_members trigger (CONTEXT D-09 amendment)

**Strengthens, does not supersede, CONTEXT D-09.** CONTEXT D-09 left this to researcher discretion. Researcher's recommendation (Q-A4): **Custom Access Token Hook**.

- Hook function is a migration that computes `app_metadata.org_ids` from `org_members` at every token mint → eliminates the 336ms propagation window entirely → CONTEXT D-10 polling UX becomes a defensive fallback rather than a primary path.
- **HUMAN-CHECKPOINT required:** enabling the hook in Supabase Auth is Dashboard-only (Auth → Hooks → Custom Access Token). Plan-checker BLOCKER on any P28 plan that ships the hook function migration WITHOUT a paired HUMAN-CHECKPOINT task that surfaces the Dashboard enable step + verification (`select raw_app_meta_data->'org_ids' from auth.users where id = auth.uid()` after fresh login).
- Org_members trigger path (CONTEXT D-09 original recommendation) is the **fallback** if hook deployment hits unforeseen friction; planner SHOULD ship the hook function but design org.ts to gracefully handle the 336ms window (per D-10) regardless of which mechanism populates the claim.

---

## Decision A4 — Realtime channel auth via SECDEF helper, not inline policy (CONTEXT D-23 amendment)

**Strengthens, does not supersede, CONTEXT D-23.** Researcher (Q-A3) found CONTEXT D-23's inline `realtime.messages` RLS USING-clause is structurally too tight (cannot iterate the JWT's `org_ids[]` to find the HMAC match).

- Helper: `create function realtime_topic_authorized(topic text, claims jsonb) returns boolean security definer set search_path = pg_catalog, public, extensions language plpgsql ...`
- Helper iterates `claims->'app_metadata'->'org_ids'`, recomputes HMAC for each, compares against `topic`. Defense-in-depth: also asserts the org_id is in claims (catches 32-bit HMAC collisions per research Pitfall 2).
- RLS policy becomes a one-liner: `(select realtime_topic_authorized(topic, current_setting('request.jwt.claims', true)::jsonb))`.
- `claim()` helper referenced in CONTEXT D-23 does NOT exist in Postgres — use `current_setting('request.jwt.claims', true)::json -> ...` per Supabase realtime docs.
- Helper is unit-testable: `select realtime_topic_authorized('org-abcd1234-patients', '{"app_metadata":{"org_ids":["..."]}}'::jsonb)`. Plan-checker BLOCKER: helper MUST ship with a paired unit test.

---

## Decision A5 — Plan-0 ownership

`28-00-PLAN.md` (RECONCILE) is a **mandatory non-parallel Wave 0** plan that:
1. Runs the pre-rename audit (above).
2. Runs the ALTER TABLE rename in a single transaction.
3. Verifies Phase 9 RLS preservation.
4. Adds the 3 columns CONTEXT D-11 needs.
5. Adds the `org_status` enum.
6. Patches any direct `.from('orgs')` callers in `src/` (likely zero, given Phase 9 abstraction).

Every subsequent P28 plan (org_members, org_invites, org_subscriptions, org_settings, org_branding, org_patient_links, org_consent_grants, withOrgScope wrapper, JWT hook, HMAC realtime, src/lib/org.ts, cross-tenant test sweep, extension-contract doc) depends on Plan-0 completing successfully.

---

## Decision A6 — ESLint custom rule extension is `.cjs` (CONTEXT D-06 amendment)

**Supersedes CONTEXT D-06 filename.** CONTEXT D-06 names `eslint-rules/no-raw-service-role-client.js` but the project's `package.json` declares `"type": "module"` — so all `.js` files are ESM by default. ESLint custom rules use CommonJS (`require` / `module.exports`) and MUST therefore use the `.cjs` extension. The existing project custom rule is `eslint-rules/additive-only-events.cjs`.

- **Locked filename:** `eslint-rules/no-raw-service-role-client.cjs`.
- VALIDATION.md row 28-02-03 reads `.js`; treat as legacy text — actual file is `.cjs`. Lint command stays correct (`npm run lint -- --rule 'leanshot/no-raw-service-role-client:error'`).
- Plan-checker BLOCKER: any plan that ships the rule as `.js` instead of `.cjs` fails — `eslint.config.js` `require()` paths must match the shipped filename.

---

## Decision A7 — `withOrgScope` lives in `supabase/functions/_shared/`, NOT `src/server/` (CONTEXT D-05/D-06 amendment)

**Supersedes CONTEXT D-05 and D-06 file paths that placed server-only code under `src/`.** CLAUDE.md is explicit: browser-only SPA, no Node.js runtime in production, no SSR. Files under `src/` are bundled by Vite into the browser build. `withOrgScope` and `_createServiceRoleClientUnsafe()` consume `process.env` + `@sentry/node` (or Deno equivalents) — Node/Deno-only APIs that fail or import-error in browsers.

- **Locked paths:**
  - `supabase/functions/_shared/supabase-server.ts` — `_createServiceRoleClientUnsafe()` + brand types `ServiceRoleClient<Unscoped>` + `ServiceRoleClient<OrgScoped>`.
  - `supabase/functions/_shared/with-org-scope.ts` — `withOrgScope(orgId, fn)` Proxy wrapper + `ORG_SCOPED_TABLES` const + `OrgScopeBypassError`.
- **ESLint rule exception path updates accordingly:** `no-raw-service-role-client.cjs` blocks `createClient(..., SERVICE_ROLE_KEY)` everywhere except inside `supabase/functions/_shared/supabase-server.ts`.
- **Sentry choice:** Use `@sentry/deno` (or `Sentry.captureException` via the existing `_shared` Sentry init from Phase 25 D-15, if extended for Edge Functions); NOT `@sentry/node`. If no Edge-Function Sentry init exists yet, ship a minimal one in this plan (small addition; per `[[reference_supabase_edge_function_deploy]]`).
- **Runtime context:** Edge Functions are Deno. `process.env` becomes `Deno.env.get(...)`. Plan-02 implementation MUST use `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, not `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- **Bundle ceiling impact:** With `src/server/` removed from the SPA bundle, P28 client-side adds only `src/lib/org.ts` (~3 kB), `src/lib/org-realtime.ts` (~2 kB), Zustand `org` slice (~1 kB), and the workspace-switcher spinner UI (~1 kB) = ~7 kB gz to admin-shell — well under P24 D-18 30 kB ceiling minus P27's ~18 kB.
- **Vitest implication for Plan-02 Task 2 (`with-org-scope.test.ts`):** test file lives at `supabase/functions/_shared/__tests__/with-org-scope.test.ts` OR `tests/edge/with-org-scope.test.ts` (planner picks per existing convention). Vitest must be configured to pick up Deno-shape files via either `import.meta.url` shim or a dedicated `vitest.edge.config.ts`. Researcher recommendation: use Node-shim test mode for Vitest (mock `Deno.env.get`) since the actual Edge runtime is tested via deployed Edge Function fixtures.

---

## Memory references added

- `[[reference_supabase_db_query_linked]]` — Plan-0 pre-rename audit.
- `[[reference_supabase_migration_gotchas]]` — RENAME TABLE + view/function literal-string breakage.
- `[[reference_supabase_migration_filename_regex]]` — strict 14-digit timestamp.
- `[[feedback_addendum_pattern_for_mid_execution_pivots]]` — this file's existence pattern.
- `[[reference_rls_fixture_gotrueclient_flake]]` — Plan-0 task #3 RLS regression check.

---

*Phase 28 — addendum to 28-CONTEXT.md — issued before any plan was written.*
