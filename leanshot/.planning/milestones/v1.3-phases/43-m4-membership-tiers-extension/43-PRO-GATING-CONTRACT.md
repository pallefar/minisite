# Phase 43 → Phases 44/46/47 PRO-Gating Contract — MEMBER-04 D-10/D-11/D-12

**Status:** Locked — change only via `/gsd-discuss-phase` on Phase 43 + downstream re-plan.

**Consumers:** Phase 44 (community_spaces), Phase 46 (courses), Phase 47 (events).

**Authoritative source:** This document. Downstream planners MUST paste the SQL snippets in §5 verbatim into their table-create migrations and grep-check their plans against §6.

---

## 1. What Phase 43 ships (already in this plan, runtime-available after `supabase db push --linked`)

| Object | Kind | Migration | Purpose |
|--------|------|-----------|---------|
| `public.current_user_has_pro()` | SECDEF STABLE boolean | `20270715000005_p43_entitlement_helpers.sql` | RLS predicate for `authenticated` callers. Reads `auth.uid()`. |
| `public.user_has_pro(p_user_id uuid)` | SECDEF STABLE boolean | `20270715000005_p43_entitlement_helpers.sql` | Service-role-callable sibling. Takes explicit user_id (no auth.uid() dependency). |
| `public.tier_effective` view | view (extended in 43-02) | `20270715000002_p43_tier_effective_view_v2.sql` | Source of truth for `has_active` + `tier_label`. Both helpers read from this view. |

Both helpers are `SECURITY DEFINER + STABLE + set search_path = public, pg_catalog` and `grant execute … to authenticated`.

The dual-variant shipment mitigates `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` (caught Phase 37-04): service-role Edge Fns and cron jobs that lack `auth.uid()` must call `user_has_pro(p_user_id)`, not `current_user_has_pro()`.

---

## 2. What Phase 44 / 46 / 47 MUST ship in their table-create migrations

For each target table TBL in `{community_spaces, courses, events}`:

### A. Column addition — in the SAME migration that `CREATE TABLE`s

```sql
alter table public.<TBL> add column if not exists pro_only boolean not null default false;
```

> Phase 43 does NOT ship `ALTER TABLE` for these tables — they do not exist on `main` yet. Per `43-RESEARCH.md` OQ-2 RESOLVED.

### B. Partial index for the RLS predicate hot-path

```sql
create index if not exists <TBL>_pro_only_idx on public.<TBL>(pro_only) where pro_only = true;
```

Partial index is intentional — the `pro_only = true` subset is the gated minority; `pro_only = false` rows are evaluated by the policy's left-hand `not pro_only` branch and never touch this index.

### C. RLS policy — soft-gate SELECT (D-11 soft-block)

```sql
create policy pol_<TBL>_pro_only_gate
  on public.<TBL>
  for select
  to authenticated
  using (not pro_only or public.current_user_has_pro());
```

The policy returns rows when EITHER:
- `pro_only = false` (free-tier resource, always visible), OR
- `pro_only = true` AND `current_user_has_pro()` returns true.

For free-tier users hitting a `pro_only = true` row, the policy filters the row out. The API layer (§8 soft-block contract) is responsible for re-fetching metadata-only and rendering the paywall — see §8.

### D. Write-gating happens at the Edge Fn layer, NOT in RLS

Per D-12, writes (`POST /community/post`, `POST /course/enroll`, `POST /event/rsvp`, etc.) return HTTP 403 + `{error: 'pro_required'}` for non-pro callers. The Edge Fn must call `current_user_has_pro()` (or `user_has_pro(target.user_id)` for admin/service-role contexts) BEFORE the INSERT. See §9.

---

## 3. Verbatim SQL block — paste this triplet into each table-create migration

For TBL = `community_spaces`:

```sql
alter table public.community_spaces add column if not exists pro_only boolean not null default false;
create index if not exists community_spaces_pro_only_idx on public.community_spaces(pro_only) where pro_only = true;
create policy pol_community_spaces_pro_only_gate
  on public.community_spaces
  for select
  to authenticated
  using (not pro_only or public.current_user_has_pro());
```

For TBL = `courses`:

```sql
alter table public.courses add column if not exists pro_only boolean not null default false;
create index if not exists courses_pro_only_idx on public.courses(pro_only) where pro_only = true;
create policy pol_courses_pro_only_gate
  on public.courses
  for select
  to authenticated
  using (not pro_only or public.current_user_has_pro());
```

For TBL = `events`:

```sql
alter table public.events add column if not exists pro_only boolean not null default false;
create index if not exists events_pro_only_idx on public.events(pro_only) where pro_only = true;
create policy pol_events_pro_only_gate
  on public.events
  for select
  to authenticated
  using (not pro_only or public.current_user_has_pro());
```

---

## 4. Acceptance grep for downstream plan-checkers

Each Phase 44 / 46 / 47 plan MUST contain `current_user_has_pro` in its migration files. Plan-checker grep:

```bash
grep -l "current_user_has_pro" supabase/migrations/<phase>*.sql | wc -l
# → MUST be ≥ 1 per phase
```

Also greppable for hard validation of the three policy names:

```bash
grep -E "pol_(community_spaces|courses|events)_pro_only_gate" supabase/migrations/<phase>*.sql
```

---

## 5. Boundary statement

Phase 43 does NOT ship:
- `ALTER TABLE community_spaces … ADD COLUMN pro_only …`
- `ALTER TABLE courses … ADD COLUMN pro_only …`
- `ALTER TABLE events … ADD COLUMN pro_only …`

These tables do not exist on `main` as of the close of Phase 43. They are introduced by Phases 44 / 46 / 47 respectively. The `pro_only` column + index + policy MUST be added in the SAME migration that creates each table (avoid the "two-migration race" where a row exists before the column does).

Per `43-RESEARCH.md` OQ-2 RESOLVED.

---

## 6. Soft-block API contract (D-11) — paywall for free-tier readers

When a free-tier user queries a `pro_only = true` resource (e.g., `GET /community-spaces/:id`), the API layer (Edge Fn or PostgREST wrapper) MUST:

1. First call: `SELECT id FROM <TBL> WHERE id = :id` — runs under the user's JWT; RLS filters out the row.
2. Detect zero-row vs not-found. To distinguish:
   - Call: `SELECT id, name, description, thumbnail FROM <TBL> WHERE id = :id` under service-role (bypass RLS).
   - If row exists AND `pro_only = true` AND `user_has_pro(:user_id) = false`, branch to soft-block response.
3. Respond:
   - HTTP **200**
   - JSON: `{ metadata: { id, name, description, thumbnail }, body: null, paywall: true }`

The frontend renders the resource header from `metadata` and replaces `body` with:

```tsx
<PaywallUpsell
  gating_reason="pro_only_resource"
  resource_type="community" | "course" | "event"
  resource_name={metadata.name}
/>
```

The `<PaywallUpsell>` variant ships in Plan 43-05.

---

## 7. Hard-block write API contract (D-12) — 403 for free-tier writers

Edge Fn write endpoints (e.g., `POST /community/post`, `POST /course/enroll`, `POST /event/rsvp`) MUST:

1. Authenticate the caller and extract `user.id` from the JWT.
2. Look up the target resource: `SELECT pro_only FROM <TBL> WHERE id = :resource_id` (service-role).
3. If `pro_only = true`:
   - Call: `SELECT public.user_has_pro(:user_id)` (NOT `current_user_has_pro()` — the admin/service-role client lacks `auth.uid()`).
   - If `false`, respond:
     - HTTP **403**
     - JSON: `{ error: 'pro_required', upgrade_url: '/pricing?upsell=<resource_type>' }`
4. If `pro_only = false` OR user has pro, proceed with INSERT.

> Why `user_has_pro(p_user_id)` and not `current_user_has_pro()` here: per `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]`, service-role contexts (cron jobs, admin RPCs, Edge Fns using the service key) have `auth.uid() IS NULL`, so `current_user_has_pro()` would always return false → all writes 403'd including admin-on-behalf-of. The explicit-param sibling avoids this.

---

## 8. Boundary scope: what's NOT in this contract

- **Lifetime + grandfathered pricing** (`MEMBER-01`, `MEMBER-02`) is the checkout-time concern; consumers in Phases 44/46/47 do NOT need to read `lifetime_purchases` or `grandfathered_prices` directly. `tier_effective.has_active` already covers lifetime per Phase 43-02.
- **Admin UI for toggling `pro_only`** ships in the same migrations that create the tables (Phases 44/46/47); each phase ships its own admin-side `pro_only` mutation RPC.
- **Per-resource entitlement (e.g., "owns this specific course")** is out of scope here — this contract is binary pro/free only.

---

## 9. References

- `43-CONTEXT.md` decisions D-10 (entitlement helper shape), D-11 (soft-block read contract), D-12 (hard-block write contract), D-13 (paywall component placement).
- `43-RESEARCH.md` OQ-2 RESOLVED (boundary: who ships the ADD COLUMN).
- `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` — original auth.uid-vs-service-role trap caught Phase 37-04.
- Migration `20270715000005_p43_entitlement_helpers.sql` — definitions of both helper functions.
- Migration `20270715000002_p43_tier_effective_view_v2.sql` — `has_active` source of truth.
