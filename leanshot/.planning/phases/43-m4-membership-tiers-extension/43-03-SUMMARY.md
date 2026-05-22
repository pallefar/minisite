---
phase: 43-m4-membership-tiers-extension
plan: 03
subsystem: monetization
tags: [member-02, member-04, secdef, rls-helper, cross-phase-contract]
requires:
  - "20270602000011_cohort_membership_matview.sql (cohort_is_member helper)"
  - "20270715000002_p43_tier_effective_view_v2.sql (tier_effective.has_active)"
  - "20270715000003_p43_grandfathered_prices.sql (grandfathered_prices table)"
  - "20270601000027_profiles_admin_role_column.sql (is_admin_at_least)"
provides:
  - "public.current_user_has_pro() — auth.uid() RLS predicate (boolean)"
  - "public.user_has_pro(p_user_id uuid) — service-role-callable (boolean)"
  - "public.resolve_user_effective_price(uuid, text) — checkout-time price resolver (text)"
  - "public.stripe_price_lookup table — (plan_name → stripe_price_id) fallback"
  - "43-PRO-GATING-CONTRACT.md — verbatim ADD COLUMN + index + RLS policy template for P44/46/47"
affects:
  - "Phase 43-04 (stripe-checkout Edge Fn — consumes resolve_user_effective_price)"
  - "Phase 43-05 (PaywallGate variant — consumes current_user_has_pro)"
  - "Phase 44 (community_spaces — consumes contract)"
  - "Phase 46 (courses — consumes contract)"
  - "Phase 47 (events — consumes contract)"
tech-stack:
  added: []
  patterns: [secdef-stable-search-path-S1, vendor-gated-send, denial-by-default-S2, dual-variant-auth-uid-mitigation]
key-files:
  created:
    - "supabase/migrations/20270715000005_p43_entitlement_helpers.sql"
    - "supabase/migrations/20270715000006_p43_resolve_user_effective_price.sql"
    - "leanshot/.planning/phases/43-m4-membership-tiers-extension/43-PRO-GATING-CONTRACT.md"
  modified: []
decisions:
  - "MEMBER-04 D-10: ship BOTH current_user_has_pro() AND user_has_pro(p_user_id) in the same migration to mitigate [[feedback_rpc_auth_uid_vs_service_role_mismatch]] from Phase 37-04"
  - "MEMBER-02 D-04: grandfathered resolver uses MOST-RECENT effective_from (ORDER BY DESC LIMIT 1) — operator controls precedence by setting later effective_from on the desired override"
  - "stripe_price_lookup seeded with EMPTY strings + vendor-gated 503 fallback: avoids hard-coding Stripe price IDs in migration history; operator fills via Studio post-deploy"
  - "Phase 43 does NOT ship ALTER TABLE for community_spaces/courses/events (RESEARCH OQ-2): tables don't exist on main; contract artifact tells P44/46/47 to bake pro_only into table-create migrations to avoid two-migration race"
metrics:
  duration: "2m 54s"
  completed: "2026-05-22T13:20:19Z"
  tasks_completed: 3
  files_changed: 3
  commits: 3
---

# Phase 43 Plan 03: Entitlement helpers + grandfathered-price resolver + PRO-gating contract Summary

Shipped the MEMBER-04 entitlement helper trio (`current_user_has_pro()` for RLS predicates and `user_has_pro(p_user_id)` for service-role contexts) plus the MEMBER-02 checkout-time resolver `resolve_user_effective_price(p_user_id, p_plan)` that walks grandfathered_prices → stripe_price_lookup → NULL fallback chain. Locked the cross-phase pro-gating contract that Phases 44/46/47 paste verbatim into their table-create migrations.

## What Shipped

### Migration 05 — `20270715000005_p43_entitlement_helpers.sql` (115 lines)

Three objects:

1. **`public.current_user_has_pro()`** — `SECDEF STABLE` boolean, reads `auth.uid()` against `tier_effective.has_active`. Intended as RLS policy predicate for Phases 44/46/47. `revoke all from public; grant execute to authenticated`.

2. **`public.user_has_pro(p_user_id uuid)`** — service-role-callable sibling. Same shape as `current_user_has_pro` but takes an explicit `p_user_id` parameter and never references `auth.uid()`. Mitigates `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` (caught Phase 37-04: SECDEF RPCs referencing `auth.uid()` silently return false when called from service-role Edge Fns / cron jobs).

3. **`public.stripe_price_lookup`** table — `(plan_name PK → stripe_price_id text DEFAULT '')`. Seeded with 5 empty placeholder rows (`plus_monthly`, `plus_yearly`, `clinic_base`, `clinic_overage`, `lifetime`). RLS: admin-read-only policy `pol_stripe_price_lookup_admin_read`; writes via service-role (Studio) only. Empty `stripe_price_id` is the vendor-gated-send sentinel — operator fills via Studio post-deploy; checkout Edge Fn returns 503 `vendor_unconfigured` until populated.

### Migration 06 — `20270715000006_p43_resolve_user_effective_price.sql` (65 lines)

One function:

**`public.resolve_user_effective_price(p_user_id uuid, p_plan text) RETURNS text`** — plpgsql `SECDEF STABLE set search_path = public, pg_catalog`. Body:

1. Look up default `stripe_price_id` from `stripe_price_lookup` for `p_plan`.
2. Look up most-recent grandfathered override: filter `grandfathered_prices` by `cohort_is_member(p_user_id, gp.cohort_id)` + active effective window + `ORDER BY effective_from DESC LIMIT 1` (most-recent wins per RESEARCH OQ-resolution; operator controls precedence).
3. Return `COALESCE(NULLIF(v_grandfathered, ''), NULLIF(v_default_price_id, ''))` — empty string sentinel treated as unset; NULL flows through to checkout Edge Fn 503.

Consumed by Plan 43-04 (`stripe-checkout` Edge Fn, Wave 2).

### Contract artifact — `43-PRO-GATING-CONTRACT.md` (194 lines)

Cross-phase contract that Phases 44/46/47 planners read before drafting table-create migrations. Contents:

- **Inventory** of what Phase 43 ships runtime-side.
- **§3 Verbatim SQL block** — three copy/paste-ready triplets for `community_spaces`, `courses`, `events` (ADD COLUMN `pro_only boolean NOT NULL DEFAULT false` + partial index `(pro_only) WHERE pro_only = true` + RLS policy `pol_<TBL>_pro_only_gate` using `current_user_has_pro()`).
- **§4 Acceptance grep** for downstream plan-checkers (`current_user_has_pro` must appear ≥1× per phase migration set).
- **§5 Boundary statement** — Phase 43 explicitly does NOT ship ADD COLUMN for these tables; they don't exist on main; downstream phases bake `pro_only` into table-create to avoid two-migration race.
- **§6 Soft-block read contract (D-11)** — 200 + `{metadata, body: null, paywall: true}` for free-tier readers hitting `pro_only = true` rows; PaywallUpsell variant ships 43-05.
- **§7 Hard-block write contract (D-12)** — 403 + `{error: 'pro_required', upgrade_url}` for free-tier writers; explicit instruction that Edge Fns MUST call `user_has_pro(p_user_id)`, not `current_user_has_pro()`, because service-role clients lack `auth.uid()`.

## Auth.uid Trap Mitigation

The dual-variant function shipment is the structural mitigation for `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]`. Per the contract artifact §7, downstream Edge Fns invoking writes MUST use:

```ts
const { data: hasPro } = await adminSupabase.rpc('user_has_pro', { p_user_id: user.id });
```

NOT:

```ts
const { data: hasPro } = await adminSupabase.rpc('current_user_has_pro'); // ← returns false; admin client has no auth.uid()
```

The plan-checker for Phases 44/46/47 should grep for `current_user_has_pro` in Edge Fn source files and flag any usage with a service-role client.

## Deviations from Plan

None — plan executed exactly as written. All three task verification blocks passed on first run. No deviation rules triggered.

## Carry-Over

- **`supabase db push --linked`** — deferred to Plan 43-06 (phase close-out). Two migrations (`20270715000005`, `20270715000006`) sit alongside the four shipped by 43-01/02 (`20270715000001..000004`), totaling 6 P43 migrations at the `20270715*` prefix. Per `[[feedback_phase_close_out_db_push_verification]]`, the 43-06 close-out plan owns the single phase-level push step and verifies all 6 migrations land.
- **`stripe_price_lookup` seeding** — vendor-gated; operator fills via Studio post-deploy per the vendor-gated-send pattern (`[[reference_vendor_gated_send_health_check]]`). Until populated, the checkout Edge Fn (43-04) returns 503 `vendor_unconfigured`.

## Downstream Consumers (read this contract verbatim)

- **Phase 44** (`community_spaces`) — paste §3 community_spaces triplet into table-create migration.
- **Phase 46** (`courses`) — paste §3 courses triplet into table-create migration.
- **Phase 47** (`events`) — paste §3 events triplet into table-create migration.
- **Phase 43-04** (`stripe-checkout` Edge Fn) — call `resolve_user_effective_price(user_id, plan_name)` before `stripe.checkout.sessions.create()`; if NULL → 503 `vendor_unconfigured`.
- **Phase 43-05** (`PaywallGate` variant) — call `current_user_has_pro()` (authenticated client; the React PaywallGate is self-only).

## Verification Receipts

Per-task automated verification blocks all passed:

| Task | Verification | Result |
|------|--------------|--------|
| 1 | grep for both function names + STABLE + SECDEF + search_path (≥2 each) + auth.uid in current_user_has_pro + p_user_id in user_has_pro + admin-read policy | ✓ |
| 2 | grep for resolve_user_effective_price signature + plpgsql + STABLE + SECDEF + search_path + cohort_is_member join + ORDER BY effective_from DESC + lookup-table fallback + grant execute | ✓ |
| 3 | file exists + both helper names + all three target tables + ADD COLUMN snippet + RLS policy template + pro_required error string | ✓ |

Final migration count at `20270715*` prefix: **6** (matches expected `4 from 43-01/02 + 2 from this plan`).

## Threat Surface Scan

No new threat surface introduced beyond the threat model already in 43-03-PLAN.md (T-43-03-01 through T-43-03-05). All five mitigations are operative:

- T-43-03-01 (EoP — service-role auth.uid mismatch): **mitigated** via dual-variant function shipment.
- T-43-03-02 (InfoDisc — price reveals cohort): **accepted** — only the public stripe_price_id is returned, no cohort metadata.
- T-43-03-03 (Tampering — user_has_pro called with other-user id): **mitigated** structurally + call-site-review hand-off via §7 of contract.
- T-43-03-04 (DoS — missing lookup row 503 cascades): **mitigated** via explicit vendor_unconfigured error code + operator alert via 43-06.
- T-43-03-05 (InfoDisc — non-admin reads stripe_price_lookup): **mitigated** via admin-read-only RLS; resolve_user_effective_price (SECDEF) is the only public surface.

## Self-Check: PASSED

- ✓ FOUND: supabase/migrations/20270715000005_p43_entitlement_helpers.sql
- ✓ FOUND: supabase/migrations/20270715000006_p43_resolve_user_effective_price.sql
- ✓ FOUND: leanshot/.planning/phases/43-m4-membership-tiers-extension/43-PRO-GATING-CONTRACT.md
- ✓ FOUND commit 2f2f1fa: feat(43-03): entitlement helpers + stripe_price_lookup (Migration 05)
- ✓ FOUND commit 250bb6f: feat(43-03): resolve_user_effective_price() SECDEF (Migration 06)
- ✓ FOUND commit 390e4f9: docs(43-03): 43-PRO-GATING-CONTRACT.md (cross-phase contract for P44/46/47)
