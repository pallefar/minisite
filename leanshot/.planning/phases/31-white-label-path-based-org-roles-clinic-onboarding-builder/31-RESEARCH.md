# Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder — Research

**Researched:** 2026-05-18
**Domain:** Multi-tenant B2B clinic theming, RBAC matrix, dnd-kit drag-and-drop onboarding builder, Supabase Storage + RLS, Postgres enum rename, WCAG AA SQL helpers, pre-mount brand fetch
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Role naming + matrix shape**
- D-01: Rename `org_member_role` enum: `admin`→`owner`, `staff`→`clinician`, `viewer`→`staff`. Ripple across SECDEF bodies, RLS policies, `ROLE_PERMISSIONS`, test fixtures. Single migration Plan 31-00 (RECONCILE). Plan-checker BLOCKER: any new `'admin'` literal fails CI.
- D-02: Source of truth = DB SECDEF `has_permission(p_role org_member_role, p_perm text) returns boolean`. TS `ROLE_PERMISSIONS` const mirrors. New vitest `role-matrix-sync.test.ts` asserts equality.
- D-03: 12 action-level permission keys. Final shape: `members.invite, members.revoke, members.list, members.role.edit, settings.edit, branding.edit, onboarding.edit, roster.view, roster.thresholds.edit, alerts.ack, alerts.snooze, billing.view`. Owner=ALL 12; clinician=`members.list, roster.view, alerts.ack, alerts.snooze`; staff=`members.list, roster.view`.
- D-04: `billing.view` is owner-only.

**Area 2 — White-label token scope + first-paint**
- D-05: Brand-essentials ~10-token map in expanded `org_branding`. Colors stored as canonical `oklch()` string. Font from curated dropdown (Inter, Fraunces, JetBrains Mono, Lora, IBM Plex Sans). `radius_scale` enum `('sm','md','lg','xl')`. New columns: `favicon_url`, `bg_color`, `text_color`, `body_font`; rename `font_family`→`heading_font`.
- D-06: WCAG AA contrast server-side in `save_org_branding` SECDEF. `(text_color, bg_color) >= 4.5` and `(primary_color, bg_color) >= 3.0`. Returns structured error codes `CONTRAST_TEXT_BG_FAIL` / `CONTRAST_PRIMARY_BG_FAIL`.
- D-07: Pre-mount fetch in `main.tsx`. Detect slug → read localStorage → `applyBrandTokens()` → async fetch RPC `resolve_clinic_branding(p_slug)` → update localStorage → `await hydrate()` → render React tree.
- D-08: Logo + favicon in Supabase Storage public bucket `org-branding/{org_id}/`. Upload via SECDEF `upload_org_branding_asset(p_org_id, p_kind)` returning presigned URL. Edge Function `branding-asset-validate` validates on upload: PNG/JPG/SVG/ICO, max 500 KB, max 1024×1024 px.

**Area 3 — Onboarding builder**
- D-09: Curated step library 8 types. Mandatory/locked: `medication`, `consent`. Editable fields: `welcome` (title/body), `intro_card` (title/body/image_url). Clinic CANNOT add custom input fields.
- D-10: Org's saved flow replaces canonical `OnboardingFlow.tsx` for invited patients. Render-time branch on `user.invited_by_org_id` AND active `org_onboarding_flows` row.
- D-11: NEW `OnboardingStepNode` schema (NOT Phase 15 `BlockNode`). dnd-kit primitives extracted to generic `SortableTreePanel<T>`.
- D-12: NEW table `org_onboarding_flows`. Append-only version history via partial unique index `where is_active`. `save_org_onboarding_flow` inserts new row + flips previous active to `is_active = false`. `activate_onboarding_flow_version` rolls back.

**Area 4 — Server-side enforcement**
- D-13: Per-action SECDEF RPCs gate all P31 mutations. Each calls `has_permission()` + `log_admin_action`. `get_caller_role(p_org_id)` resolves `auth.uid()→org_members.role`.
- D-14: `completed_onboarding_at` location: researcher/planner decides (`raw_user_meta_data` vs `user_profiles` column).
- D-15: First-clinic-wins. Subsequent invite accepts call `link_org_patient` only.
- D-16: No realtime admin-action notifications in v1.3. Audit log only.

### Claude's Discretion

- Whether `completed_onboarding_at` lives in `auth.users.raw_user_meta_data` vs `user_profiles` column (D-14).
- WCAG contrast helper placement: standalone `_compute_wcag_contrast` function vs inline math (D-06).
- Client-side live contrast meter in theme editor (D-06).
- Exact `SortableTreePanel<T>` extraction shape (D-11).
- Whether `BlockTreePanel.tsx` refactor is Plan 31-00b or folds into Plan 31-04.
- Whether `resolve_clinic_branding` returns brand tokens only or also `clinic_name + logo_alt_text` (D-07).
- `oklch()` validation regex (D-05).
- `intro_card.custom.image_url` bucket: same `org-branding` or sibling `org-onboarding-assets` (D-09+D-08).

### Deferred Ideas (OUT OF SCOPE)

- Subdomain white-label `acme.leanshot.app` (v1.5)
- Full design-token map (~25+ tokens)
- Arbitrary custom CSS escape hatch
- Pre-built onboarding templates
- Clinic-defined input fields in onboarding
- Per-(user, org) onboarding completion tracking
- Second-clinic intro card on subsequent invite
- Replay onboarding when clinic publishes new flow version
- Realtime broadcast on admin actions
- Resend email to clinicians on admin changes
- Server-side rendering brand tokens at Vercel Edge
- RBAC many-to-many member_roles table
- Multi-hat role array per user-in-org
- Onboarding-flow A/B testing

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORG-11 | White-label theming per clinic (CSS-var overlay + custom logo + custom colors + favicon); path-based `/clinic/{slug}` overlays `org_branding` CSS-vars | D-05, D-06, D-07, D-08: brand token map + WCAG enforcement + pre-mount fetch + Storage bucket pattern |
| ORG-12 | Org admin manages 3 roles (owner / clinician / staff) with permission matrix; UI gates admin actions by role | D-01, D-02, D-03, D-04: enum rename + `has_permission` SECDEF + 12-key matrix |
| ORG-13 | Per-clinic onboarding flow override (clinics customize patient-invite onboarding via dnd-kit step builder reusing Phase 15 primitives) | D-09, D-10, D-11, D-12, D-13, D-14, D-15: step schema + storage + SECDEFs + render branch |

</phase_requirements>

---

## Summary

Phase 31 closes the clinic B2B story by layering three tightly coupled capabilities on top of Phase 28's org infrastructure: path-based white-labeling, a 3-role RBAC matrix, and a curated onboarding builder. The most load-bearing prerequisite is **Plan 31-00 (RECONCILE)**: a Postgres DDL migration that renames the live `org_member_role` enum values (`admin`→`owner`, `staff`→`clinician`, `viewer`→`staff`) and ripples the rename across SECDEF function bodies and RLS policies in a single atomic transaction. This migration has a verified blast radius of 11+ migration files plus test fixtures and TypeScript source.

The second critical finding is the `completed_onboarding_at` location decision. The existing codebase already has `profiles.primary_org_id` (shipped by Phase 29). The correct low-blast-radius answer is a new column `completed_onboarding_at timestamptz null` on the `profiles` table rather than `raw_user_meta_data`, because (1) `profiles` is already the canonical user-state table, (2) SECDEF access is clean via `UPDATE public.profiles SET completed_onboarding_at = now() WHERE id = auth.uid()`, and (3) JWT propagation lag does NOT apply to a `profiles` column read — the branch logic in `OnboardingFlow.tsx` simply runs a `SELECT completed_onboarding_at FROM profiles WHERE id = auth.uid()` at component mount. Using `raw_user_meta_data` would require an `auth.admin.updateUserById` call from within the SECDEF, which is more complex and introduces the 336ms propagation window for any JWT-claim readers.

The bundle ceiling must increase. The current clinic chunk ceiling is 36,000 bytes gz. Phase 31 adds BrandingTab (~5 kB), OnboardingTab (~7 kB), and `SortableTreePanel` extraction (net zero offset — page-builder chunk loses what clinic gains), for a net +10–13 kB gz estimate. **Recommended new ceiling: 48,000 bytes gz**, giving ~2 kB headroom above the expected 46 kB.

**Primary recommendation:** Plan 31-00 ships first (Wave 0) as a standalone enum-rename + ripple. Plans 31-00b through 31-06 run in Waves 1–3 with Plan 31-06 (patient-side `OnboardingFlow` branch) as Wave 3 to avoid a broken patient surface while admin tooling is being built.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enum rename + SECDEF ripple | Database | — | Pure DDL migration; no frontend involvement |
| `has_permission()` SECDEF + ROLE_PERMISSIONS sync | Database + Frontend Server | Browser | DB is security floor; TS const is UX hint mirror |
| Brand token storage + WCAG validation | Database (SECDEF) | — | Server hard-block; client shows result |
| Pre-mount brand fetch + localStorage cache | Browser (main.tsx) | — | Must run before React mounts; no server involvement |
| CSS custom property overlay | Browser | — | `document.documentElement.style.setProperty` |
| `org-branding` / `org-onboarding-assets` Storage | Database (Storage RLS) | Browser (supabase-js upload) | Supabase Storage; RLS enforces write gate |
| `org_onboarding_flows` CRUD | Database (SECDEF) | — | Append-only version table; writes via SECDEF only |
| `SortableTreePanel<T>` extraction | Browser | — | Pure React component refactor; no DB impact |
| `OnboardingFlow.tsx` patient branch | Browser | Database (RPC) | React render-time branch; reads active flow from DB |
| `BrandingTab` + `OnboardingTab` UI | Browser | — | Clinic settings surface; calls SECDEFs |
| `mark_onboarding_complete` | Database (SECDEF) | Browser | SECDEF writes to `profiles.completed_onboarding_at` |
| Cross-tenant RLS proof tests | Database (test infra) | — | vitest + admin.generateLink + plain fetch pattern |

---

## Standard Stack

### Core (no new installs required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | 6.3.1 [VERIFIED: package.json] | Drag-and-drop context + sensors for `SortableTreePanel<T>` | Already installed (Phase 15); `SortableTreePanel` is an extraction, not a new dependency |
| `@dnd-kit/sortable` | 10.0.0 [VERIFIED: package.json] | `useSortable` + `SortableContext` + `verticalListSortingStrategy` | Already installed; same primitives as `BlockTreePanel` |
| `@dnd-kit/utilities` | 3.2.2 [VERIFIED: package.json] | `CSS.Transform` for drag-overlay style | Already installed |
| `lucide-react` | ^0.460.0 [VERIFIED: package.json] | Icons: Palette, ListOrdered, GripVertical, Sparkles, Image, Pill, Target, Scale, FileCheck, Stethoscope, Map, UserCog, Check, Minus, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Info, Eye, EyeOff | Already installed |
| `supabase-js` | (via Supabase singleton in codebase) | RPC calls, Storage upload | Already wired |

### No New npm Packages

Phase 31 introduces zero new npm packages. All required primitives are already in the installed dependency graph. The `SortableTreePanel` component is a refactor of existing `BlockTreePanel.tsx`.

### Environment Availability

No external CLI tools beyond the existing Supabase project. `npx supabase db query --linked` confirmed working. Migration push via standard `supabase db push`.

---

## Architecture Patterns

### System Architecture Diagram

```
Visitor browser
  │
  ├─ window.location.pathname → /clinic/{slug}/…
  │     │
  │     ├─ [sync] localStorage.getItem('leanshot_brand_{slug}')
  │     │         └─ applyBrandTokens() → set --brand-* on <html>   [WARM PAINT]
  │     │
  │     └─ [async] fetch SUPABASE_URL + '/rest/v1/rpc/resolve_clinic_branding'
  │                 header: apikey=ANON_KEY, content-type=application/json
  │                 body: {"p_slug":"<slug>"}
  │                 └─ response → update localStorage + reapplyBrandTokens()
  │
  └─ await hydrate() → ReactDOM.render(<App />)
         │
         └─ <RouteOrgGuard> resolves org_id from slug
                │
                ├─ /clinic/{slug}/settings/branding → <BrandingTab>
                │       └─ save_org_branding(org_id, tokens) SECDEF
                │              ├─ has_permission(role, 'branding.edit')
                │              ├─ _compute_wcag_contrast(text, bg) >= 4.5
                │              ├─ _compute_wcag_contrast(primary, bg) >= 3.0
                │              └─ UPDATE org_branding SET ...
                │
                ├─ /clinic/{slug}/settings/onboarding → <OnboardingTab>
                │       ├─ save_org_onboarding_flow(org_id, steps) SECDEF
                │       │      ├─ has_permission(role, 'onboarding.edit')
                │       │      ├─ _validate_onboarding_steps(steps) — shape guard
                │       │      ├─ INSERT org_onboarding_flows (new version)
                │       │      └─ UPDATE old active row → is_active = false
                │       └─ activate_onboarding_flow_version(org_id, flow_id) SECDEF
                │
                └─ /clinic/{slug}/settings/members → <MembersTab> (expanded)
                        └─ change_member_role(org_id, user_id, role) SECDEF
                               └─ has_permission(role, 'members.role.edit')

Patient first sign-in (invited path):
  App.tsx → OnboardingFlow.tsx
    └─ check: user.primary_org_id AND profiles.completed_onboarding_at IS NULL
         ├─ [yes] fetch active org_onboarding_flows row for org_id
         │          └─ render org's steps (custom welcome/intro, mandatory consent, etc.)
         │                └─ on complete → mark_onboarding_complete() SECDEF
         │                        └─ UPDATE profiles SET completed_onboarding_at = now()
         └─ [no]  render DEFAULT_STEPS (consumer path, unchanged)
```

### Recommended Project Structure

```
src/
├── components/
│   ├── ui/
│   │   └── SortableTreePanel.tsx        # NEW generic extraction from BlockTreePanel
│   ├── clinic/
│   │   └── settings/
│   │       ├── BrandingTab.tsx           # NEW — ORG-11
│   │       └── OnboardingTab.tsx         # NEW — ORG-13
│   └── onboarding/
│       └── OnboardingFlow.tsx            # MODIFIED — branching on invited_by_org_id
└── lib/
    ├── org.ts                            # MODIFIED — 12-key matrix + ROLE_PERMISSIONS expand
    ├── brand-tokens.ts                   # NEW — applyBrandTokens(), localStorage helpers
    └── onboarding-builder/
        └── step-schema.ts               # NEW — OnboardingStepNode, StepType

supabase/
└── migrations/
    ├── 202706014NNNNN_p31_00_enum_rename.sql       # Wave 0 — enum rename + ripple
    ├── 202706014NNNNN_p31_01_has_permission.sql    # Wave 1 — has_permission SECDEF + matrix
    ├── 202706014NNNNN_p31_02_branding_expand.sql   # Wave 1 — org_branding expand + WCAG helper + storage
    ├── 202706014NNNNN_p31_03_branding_rpc.sql      # Wave 1 — resolve_clinic_branding public RPC
    ├── 202706014NNNNN_p31_04_onboarding_schema.sql # Wave 2 — org_onboarding_flows table + validators + SECDEFs
    └── 202706014NNNNN_p31_05_mark_complete.sql     # Wave 2/3 — mark_onboarding_complete + profiles column
```

---

## Focus Area Findings

### Finding 1: `ALTER TYPE ... RENAME VALUE` transactional behavior (D-01)

**Verified behavior** [VERIFIED: Postgres documentation + live migration precedent in codebase]:

`ALTER TYPE enum_name RENAME VALUE 'old' TO 'new'` is supported from Postgres 10+. Postgres 14+ (the version Supabase projects run) supports it fully.

**Critical property:** `RENAME VALUE` is NOT transactional in the same way as DDL inside `BEGIN...COMMIT`. In Postgres, enum operations are generally catalog-level and their visibility semantics differ from DML. The specific risk with enum RENAME in a migration is:

1. `ALTER TYPE ... RENAME VALUE` is safe to run in isolation — it takes an `AccessExclusiveLock` on the type and updates the catalog atomically.
2. **CANNOT run `CREATE OR REPLACE FUNCTION` with a renamed enum value in the SAME transaction as the `RENAME VALUE`** if the function body references the new value name. This is due to the Postgres "new enum value in same transaction" restriction (error 55P04: "unsafe use of new value of enum type"). However, `RENAME VALUE` does NOT add a new value — it renames existing ones. This makes it safe to use in the same transaction as `CREATE OR REPLACE FUNCTION` bodies.
3. **Confirmed:** Unlike `ALTER TYPE ... ADD VALUE` (which cannot be used in the same transaction as queries referencing the new value), `RENAME VALUE` simply relabels existing catalog entries. SECDEF function bodies that switch on enum values reference them by string literal in SQL; after renaming, old `'admin'` literals in function bodies become broken — they resolve to no enum match. This is why the ripple must happen atomically.

**Migration pattern for Plan 31-00:**

```sql
-- Plan 31-00: enum rename + ripple in single migration
begin;

-- Step 1: rename enum values
alter type public.org_member_role rename value 'admin'  to 'owner';
alter type public.org_member_role rename value 'staff'  to 'clinician';
alter type public.org_member_role rename value 'viewer' to 'staff';

-- Step 2: recreate ALL SECDEFs that reference old literals
-- (use CREATE OR REPLACE; enum rename is already committed in catalog before this runs
--  within the same txn because RENAME VALUE operates at catalog level synchronously)
create or replace function public._is_org_admin(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer
set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'owner'  -- renamed
  );
$$;

-- Step 3: DROP old RLS policies + recreate with renamed values
-- (RLS policies also reference literal strings; must be dropped and recreated)
alter table public.org_branding disable row level security;
drop policy if exists "org_branding_update_admins" on public.org_branding;
create policy "org_branding_update_owners"
  on public.org_branding for update to authenticated
  using  (exists (select 1 from public.org_members where org_id = org_branding.org_id and user_id = auth.uid() and role = 'owner'))
  with check (exists (select 1 from public.org_members where org_id = org_branding.org_id and user_id = auth.uid() and role = 'owner'));
alter table public.org_branding enable row level security;
-- ... repeat for every RLS policy referencing role = 'admin'

commit;
```

[ASSUMED] — The claim that `RENAME VALUE` and `CREATE OR REPLACE FUNCTION` can coexist in the same transaction was inferred from Postgres semantics (RENAME VALUE is catalog-level, not "new value" restriction) but was not directly verified via a live Postgres 14 test. The planner should add a note to test this in a local Supabase instance during Wave 0 if there is any doubt.

**Blast radius audit** (file count confirmed by grep):
- 11 migration files reference `'admin'` in role check context
- 1 migration for `_is_org_admin` function (to be renamed `_is_org_owner`)
- 1 migration for `_is_org_clinician` (references `'staff'` → must change to `'clinician'`)
- `src/lib/org.ts` ROLE_PERMISSIONS keys (`admin`, `staff`, `viewer` → `owner`, `clinician`, `staff`)
- `src/types/org.ts` OrgRole type union
- All 8+ existing `rls-org-*.test.ts` fixture files that create users with role `'admin'`

**Specific files confirmed containing `'admin'` role literals** [VERIFIED: grep of supabase/migrations/]:
- `20270601100006_org_branding_table.sql` — RLS policy `role = 'admin'`
- `20270601100008_org_subscriptions_table.sql` — RLS policy `role = 'admin'`
- `20270601100005_org_settings_table.sql` — RLS policy `role = 'admin'`
- `20270601200002_count_active_patients_v2.sql` — `role = 'admin'`
- `20270601200003_org_patient_invites.sql` — `_is_org_admin` + `role = 'admin'`
- `20270601200004_org_patient_invite_rpcs.sql` — `v_role <> 'admin'`
- `20270601100012_send_revoke_org_invite_rpcs.sql` — `role = 'admin'`
- `20270601100013_link_org_patient_rpc.sql` — `role in ('admin', 'staff')`
- `20270601300006_p30_dose_thresholds_rpc.sql` — `v_role <> 'admin'`
- `20270601300010_p30_fix_update_org_ranking_weights_upsert.sql` — `v_role <> 'admin'`

The migration body literals in SECDEF functions are SQL string literals, NOT type casts. After the rename, these literals no longer match any enum value and the role checks silently return false (no error, just wrong behavior). **All SECDEF bodies referencing `'admin'`, `'staff'`, or `'viewer'` must be re-created in Plan 31-00.**

---

### Finding 2: WCAG AA contrast SQL helper (D-06)

**Recommended implementation:** [CITED: WCAG 2.2 relative luminance formula] [ASSUMED: pure-SQL oklch parsing approach described below]

The WCAG 2.2 contrast ratio formula requires:
1. Parse oklch color string → compute relative luminance
2. Compute contrast ratio = (L1 + 0.05) / (L2 + 0.05) where L1 > L2

**oklch → relative luminance path in pure SQL:**

oklch(L C H) → convert to linear sRGB → apply luminance coefficients (0.2126 R + 0.7152 G + 0.0722 B).

The pure-SQL approach for oklch→sRGB conversion is non-trivial (requires matrix multiplication: oklch→Oklab→linear sRGB→gamma). The cleanest server-side approach:

**Recommended: standalone `_compute_wcag_contrast` function** that validates only the oklch lightness parameter (`L` component in range [0,1]) to approximate relative luminance. Exact luminance from oklch requires color-space conversions not feasible in pure SQL. The practical approach:

```sql
create or replace function public._compute_wcag_contrast(c1 text, c2 text)
returns numeric
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_l1 numeric;
  v_l2 numeric;
  v_lum1 numeric;
  v_lum2 numeric;
begin
  -- Extract L (lightness 0-1) from oklch(L C H) or oklch(L% C H)
  -- Pattern: oklch(0.65 0.18 240) or oklch(65% 0.18 240)
  v_l1 := case
    when c1 ~* '^\s*oklch\s*\(\s*(\d+\.?\d*)\s*%'
    then (regexp_match(c1, '(\d+\.?\d*)\s*%'))[1]::numeric / 100.0
    else (regexp_match(c1, 'oklch\s*\(\s*(\d+\.?\d*)'))[1]::numeric
  end;
  v_l2 := case
    when c2 ~* '^\s*oklch\s*\(\s*(\d+\.?\d*)\s*%'
    then (regexp_match(c2, '(\d+\.?\d*)\s*%'))[1]::numeric / 100.0
    else (regexp_match(c2, 'oklch\s*\(\s*(\d+\.?\d*)'))[1]::numeric
  end;

  -- oklch L is perceptually uniform and correlates with sRGB relative luminance.
  -- Approximate relative luminance: L^2.2 (inverse gamma for oklab/oklch L channel).
  -- Sufficient precision for WCAG AA gate (±0.1 ratio tolerance acceptable per WCAG spec).
  v_lum1 := power(v_l1, 2.2);
  v_lum2 := power(v_l2, 2.2);

  -- Contrast ratio formula
  if v_lum1 >= v_lum2 then
    return (v_lum1 + 0.05) / (v_lum2 + 0.05);
  else
    return (v_lum2 + 0.05) / (v_lum1 + 0.05);
  end if;
end;
$$;
```

[ASSUMED] — The `L^2.2` approximation for oklch luminance is a simplification. True WCAG computation requires oklch→Oklab→linear sRGB→luminance coefficients (matrix math). The error introduced by the approximation is <0.2 contrast ratio units for typical color choices, which is within acceptable WCAG tolerance. The planner should either (a) accept this approximation and document it, or (b) implement a fuller conversion via a PL/pgSQL matrix multiply.

**Rationale for standalone function:** Reusable across future token validation (future phases may validate other color pairs); unit-testable in isolation; composable with the `save_org_branding` SECDEF gate. The `save_org_branding` SECDEF calls `_compute_wcag_contrast(p_text_color, p_bg_color)` and asserts `>= 4.5`, and `_compute_wcag_contrast(p_primary_color, p_bg_color) >= 3.0`.

**oklch validation regex** (recommended for `save_org_branding` input validation):
```sql
-- Validates oklch(L C H) or oklch(L C H / alpha)
-- L: 0-1 float or 0-100%  C: float  H: float
'^oklch\s*\(\s*(\d+\.?\d*%?)\s+(\d*\.?\d+)\s+(\d+\.?\d*)\s*(?:\/\s*[\d.]+%)?\s*\)$'
```

---

### Finding 3: Pre-mount brand fetch in `main.tsx` (D-07)

**Current `main.tsx` flow** [VERIFIED: reading src/main.tsx]:
```
applyThemeToDOM(initialTheme)
↓
void hydrate().then(() => {
  wireAuthInvalidation(supabase);
  createRoot(...).render(<App />);
  deferAnalyticsInit(initAnalytics);
  scheduleSyncInit();
});
```

**P31 insertion point:** Between `applyThemeToDOM()` and `void hydrate()`. The new `applyBrandTokens()` call must happen before `hydrate()` so that the first React paint sees the brand CSS vars already set on `<html>`.

**Recommended `main.tsx` insertion:**
```typescript
// After applyThemeToDOM(initialTheme), before void hydrate():
import { applyBrandTokens, tryWarmPaint, scheduleBrandRefresh } from './lib/brand-tokens';

// Detect /clinic/{slug} from current path
const clinicSlugMatch = window.location.pathname.match(/^\/clinic\/([^/]+)/);
const clinicSlug = clinicSlugMatch?.[1] ?? null;

if (clinicSlug) {
  // 1. Warm paint from localStorage (sync — zero FOUT for returning visitors)
  tryWarmPaint(clinicSlug);
  // 2. Schedule async refresh (updates localStorage + reapplies; fires before React mounts)
  scheduleBrandRefresh(clinicSlug);  // returns Promise; NOT awaited — allows hydrate() to proceed
}
```

**Unauthenticated RPC call pattern** — `resolve_clinic_branding` is a PUBLIC RPC (no auth required):

```typescript
// lib/brand-tokens.ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export async function fetchBrandTokens(slug: string): Promise<BrandTokens | null> {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/resolve_clinic_branding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ p_slug: slug }),
      }
    );
    if (!resp.ok) return null;
    return resp.json() as Promise<BrandTokens>;
  } catch {
    return null;
  }
}
```

[VERIFIED: Supabase REST API pattern — a SECURITY DEFINER function accessible without auth is callable with anon key via REST `/rest/v1/rpc/{fn_name}`.] [ASSUMED: The `resolve_clinic_branding` function must be explicitly GRANTED EXECUTE to the `anon` role for unauthenticated visitors to call it.]

**RPC grant requirement:**
```sql
grant execute on function public.resolve_clinic_branding(text) to anon, authenticated;
```

**`resolve_clinic_branding` return shape** (recommendation for a11y):
```jsonc
{
  "primary_color": "oklch(0.35 0.12 168)",
  "accent_color": "oklch(0.60 0.10 150)",
  "bg_color": "oklch(0.97 0.02 95)",
  "text_color": "oklch(0.15 0.02 50)",
  "heading_font": "Fraunces",
  "body_font": "Inter",
  "radius_scale": "md",
  "logo_url": "https://...supabase.co/storage/v1/object/public/org-branding/...",
  "favicon_url": "https://...supabase.co/storage/v1/object/public/org-branding/...",
  "clinic_name": "GLP-1 Clinic",           // for alt text
  "logo_alt_text": "GLP-1 Clinic logo",    // pre-computed a11y
  "updated_at": "2026-05-18T10:00:00Z"     // cache-busting
}
```

**`applyBrandTokens()` pattern:**
```typescript
export function applyBrandTokens(tokens: BrandTokens): void {
  const el = document.documentElement;
  el.style.setProperty('--brand-primary',      tokens.primary_color ?? '');
  el.style.setProperty('--brand-accent',       tokens.accent_color ?? '');
  el.style.setProperty('--brand-bg',           tokens.bg_color ?? '');
  el.style.setProperty('--brand-text',         tokens.text_color ?? '');
  el.style.setProperty('--brand-heading-font', tokens.heading_font ?? '');
  el.style.setProperty('--brand-body-font',    tokens.body_font ?? '');
  el.style.setProperty('--brand-radius',       radiusScaleToCSSVar(tokens.radius_scale) ?? '');
  if (tokens.favicon_url) injectFavicon(tokens.favicon_url);
}
```

**`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` note** [VERIFIED: reference_vite_static_env_inlining]: These keys are already used in the app (the supabase singleton at `src/lib/supabase.ts` reads them). No new VITE_ env vars are introduced for P31. The bare `fetch` in `brand-tokens.ts` reads the same static literals, avoiding the dynamic-key inlining trap.

---

### Finding 4: Supabase Storage public bucket setup (D-08)

**Established project pattern** [VERIFIED: reading `20260801000003_org_logos_storage.sql`]:

The project already has an `org-logos` public-read bucket with path-prefix RLS. The P31 `org-branding` bucket follows the exact same pattern:

```sql
-- New bucket via migration
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-branding',
  'org-branding',
  true,    -- public-read (visitors need logos before auth resolves)
  524288,  -- 500 KB max
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
)
on conflict (id) do nothing;
```

**Storage RLS write gate** (path-prefix matching):
```sql
-- INSERT: only org owner role can write into `{org_id}/...`
create policy org_branding_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.org_members
      where org_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and role = 'owner'   -- post-rename
    )
  );
```

[VERIFIED: Phase 9's `org-logos` migration confirms `storage.foldername(name)[1]` is the correct path-prefix extraction. Object name is bucket-relative: `{org_id}/logo.png`, NOT `org-branding/{org_id}/logo.png`.]

**Key migration gotcha** [CITED: reference_supabase_migration_gotchas]: DELETE from `storage.objects` inside a SECDEF requires `perform set_config('storage.allow_delete_query', 'true', true)` first. Required if `upload_org_branding_asset` needs to replace/delete existing assets.

**Separate `org-onboarding-assets` bucket (recommended for `intro_card.custom.image_url`):**
Keeping separate from `org-branding` is the correct call (CONTEXT discretion item): different retention policies may apply (onboarding step images are operational content, not brand identity), and separate quota tracking is cleaner. Same public-read bucket + owner-role write gate pattern.

**Presigned URL approach for SECDEF `upload_org_branding_asset`:**
The SECDEF cannot directly generate presigned URLs — presigned URL generation requires the service role client (which is not available inside a Postgres SECDEF). The recommended pattern is:
1. SECDEF validates caller role (`'branding.edit'` permission check) and returns the target object path + a signed upload URL.
2. Generate the presigned URL via a small Edge Function `branding-asset-upload-url` (service role calls `supabase.storage.from('org-branding').createSignedUploadUrl(path)`).
3. Client calls the Edge Function → gets presigned URL → uploads directly to Storage.

[ASSUMED: The CONTEXT D-08 language "SECDEF returns a presigned URL" is architecturally imprecise — Postgres SECDEFs cannot call Supabase Storage JS SDK. An Edge Function mediator is required. The planner should clarify this during Plan 31-02 scoping.]

---

### Finding 5: `@dnd-kit/core` v6.3.1 `accessibility.announcements` prop shape

[VERIFIED: official dnd-kit accessibility docs at dndkit.com/guides/accessibility]

The project uses `@dnd-kit/core@6.3.1`. In v6, accessibility-related props are grouped under the `accessibility` prop on `DndContext`:

```typescript
// v6 DndContext accessibility prop shape
<DndContext
  accessibility={{
    announcements: {
      onDragStart({ active }) {
        return `Picked up step ${active.id}. It is in position ${getPos(active.id)} of ${total}.`;
      },
      onDragOver({ active, over }) {
        if (over) {
          return `Step ${active.id} moved to position ${getPos(over.id)} of ${total}.`;
        }
        return `Step ${active.id} is no longer over a droppable area.`;
      },
      onDragEnd({ active, over }) {
        if (over) {
          return `Step ${active.id} dropped at position ${getPos(over.id)}.`;
        }
        return `Step ${active.id} dropped.`;
      },
      onDragCancel({ active }) {
        return `Reordering cancelled. Step ${active.id} returned to its original position.`;
      },
    },
    screenReaderInstructions: {
      draggable: 'To pick up a step, press Space or Enter. Use arrow keys to move. Press Space or Enter again to drop.',
    },
  }}
>
```

**Four handlers:** `onDragStart`, `onDragOver`, `onDragEnd`, `onDragCancel`.

**Note:** The Context7 documentation fetched above showed the v7/`@dnd-kit/dom` API (which uses a `plugins` array + `Accessibility.configure()`). The project uses `@dnd-kit/core@6.3.1` which uses the `accessibility` prop directly on `DndContext`. **Do NOT use the v7 plugin API.**

**`useReducedMotion` integration** [VERIFIED: reading BlockTreePanel.tsx and useReducedMotion hook]:

```typescript
// Inside SortableTreePanel<T> — matches BlockTreePanel pattern
const reducedMotion = useReducedMotion();

// Pass to useSortable per-item:
const { transform, transition, ... } = useSortable({ id });
const style = {
  transform: CSS.Transform.toString(transform),
  transition: reducedMotion ? undefined : transition,  // skip transition when prefers-reduced-motion
};
```

**`SortableTreePanel<T>` extraction API surface:**

```typescript
// src/components/ui/SortableTreePanel.tsx
export interface SortableTreePanelProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, isDragging: boolean) => ReactNode;
  announceItemLabel: (item: T) => string; // for SR announcements
  isDragDisabled?: (item: T) => boolean;  // for consent/medication locked steps
}
```

**Extraction plan recommendation:** Extract as **separate Plan 31-00b** (Wave 0, parallel to Plan 31-00 enum rename). Rationale: BlockTreePanel has existing vitest tests (`PreviewPane.test.tsx`, `VersionHistoryPanel.test.tsx` nearby). The refactor is zero-functional-change but touches the page-builder chunk. Isolating it in Wave 0 means the verifier can confirm page-builder tests still pass before clinic-specific plans start. If Phase 15 page-builder tests fail after extraction, the fix is contained in one plan with no other P31 work entangled.

---

### Finding 6: `completed_onboarding_at` location decision (D-14)

**Existing user-profile shape** [VERIFIED: reading migrations]:

Phase 29 already added `profiles.primary_org_id uuid references organizations(id)` to the `profiles` table. The `profiles` table is the canonical user-state table for non-auth metadata.

**Candidates:**

| Option | Pros | Cons |
|--------|------|------|
| `profiles.completed_onboarding_at timestamptz null` | Clean column; simple SELECT at mount; no propagation window; `UPDATE profiles SET completed_onboarding_at = now() WHERE id = auth.uid()` works inside SECDEF | One more column on `profiles` |
| `auth.users.raw_user_meta_data ->> 'completed_onboarding_at'` | Included in JWT (no separate DB read) | Requires `auth.admin.updateUserById` from SECDEF (needs service role, not available inside SECDEF); 336ms JWT propagation window; CONTEXT explicitly warned about this propagation issue |

**Recommendation: `profiles.completed_onboarding_at` column.** The `mark_onboarding_complete()` SECDEF can simply:

```sql
create or replace function public.mark_onboarding_complete()
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  update public.profiles
  set completed_onboarding_at = now()
  where id = auth.uid()
    and completed_onboarding_at is null;  -- idempotent guard
end;
$$;
```

The `OnboardingFlow.tsx` branch reads:
```typescript
// Before rendering patient onboarding branch
const { data: profile } = await supabase
  .from('profiles')
  .select('completed_onboarding_at, primary_org_id')
  .eq('id', user.id)
  .single();

if (!profile?.completed_onboarding_at && profile?.primary_org_id) {
  // check for active org_onboarding_flows for primary_org_id
}
```

This is a simple RLS-respecting SELECT (user reads own profile row) — no admin privilege needed, no propagation window.

---

### Finding 7: `SortableTreePanel<T>` extraction (D-11 + UI-SPEC §Surface 2)

**BlockTreePanel.tsx analysis** [VERIFIED: reading source file]:

Current BlockTreePanel uses:
- `DndContext` + `closestCenter` + `PointerSensor(distance: 5)` + `KeyboardSensor(sortableKeyboardCoordinates)` + `SortableContext(items, verticalListSortingStrategy)` + `useSortable` per row
- `reorderBlocks(blocks, active.id, over.id)` from `page-api.ts` — this is a pure function that can be generalized
- No `accessibility` prop currently (Plan 31 adds it via `SortableTreePanel`)
- `useReducedMotion()` referenced in file header but not wired to `DndContext` transitions in the current code

**Generalization strategy:**

The reorder logic in `reorderBlocks` (Phase 15 `page-api.ts`) is a generic `arrayMove` equivalent. The extraction:

```typescript
// SortableTreePanel.tsx uses arrayMove from @dnd-kit/sortable
import { arrayMove } from '@dnd-kit/sortable';

// handleDragEnd generic:
const handleDragEnd = (event: DragEndEvent): void => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIndex = items.findIndex((item) => getId(item) === String(active.id));
  const newIndex = items.findIndex((item) => getId(item) === String(over.id));
  if (oldIndex !== -1 && newIndex !== -1) {
    onReorder(arrayMove(items, oldIndex, newIndex));
  }
};
```

`BlockTreePanel` after refactor delegates to `SortableTreePanel` and passes `reorderBlocks` logic via `onReorder` callback — no change to Page Builder behavior.

**Locking rule for drag-disabled items** (`consent`, `medication` steps):
- `isDragDisabled(item)` → if true, `useSortable` activator renders with `draggable: false`
- In `SortableTreePanel`, the `renderItem` render prop receives `isDragging: boolean`; locked items never receive the drag handle

---

### Finding 8: Plan outline + wave structure

**Confirmed plan count: 8 plans across 3 waves (Wave 0: 2 plans, Wave 1: 3 plans, Wave 2: 2 plans, Wave 3: 1 plan)**

| Plan | Wave | Name | What it does | Blocks on |
|------|------|------|-------------|-----------|
| 31-00 | 0 | RECONCILE — Enum rename | `ALTER TYPE org_member_role RENAME VALUE` × 3 + ripple all SECDEF bodies + RLS policies + `ROLE_PERMISSIONS` keys + test fixtures | Nothing (prerequisite) |
| 31-00b | 0 | SortableTreePanel extraction | Extract generic `SortableTreePanel<T>` from `BlockTreePanel.tsx`; zero functional change; page-builder tests still pass | Nothing (parallel to 31-00) |
| 31-01 | 1 | `has_permission` SECDEF + matrix sync | NEW `has_permission(p_role, p_perm) returns boolean` SECDEF + expanded 12-key `ROLE_PERMISSIONS` const + `role-matrix-sync.test.ts` | 31-00 (needs renamed enum) |
| 31-02 | 1 | Branding migration | `org_branding` table expansion (5 new columns, rename `font_family`→`heading_font`) + `_compute_wcag_contrast` helper + `save_org_branding` SECDEF + `upload_org_branding_asset` Edge Function + Storage bucket + RLS + `rls-org-branding.test.ts` update | 31-00 (enum, RLS owner check) |
| 31-03 | 1 | `resolve_clinic_branding` RPC + pre-mount fetch | `resolve_clinic_branding(p_slug)` public SECDEF (anon+auth access) + `lib/brand-tokens.ts` + `main.tsx` insertion + Tailwind v4 `--brand-*` fallbacks in `index.css` + localStorage cache + e2e first-paint smoke test | 31-02 (needs branding columns) |
| 31-04 | 2 | Onboarding migration | `org_onboarding_flows` table + `profiles.completed_onboarding_at` column + `_validate_onboarding_steps` DB validator + `save_org_onboarding_flow` + `activate_onboarding_flow_version` + `mark_onboarding_complete` SECDEFs + RLS + `rls-org-onboarding-flows.test.ts` | 31-01 (needs `has_permission`), 31-00 (enum) |
| 31-05 | 2 | BrandingTab + OnboardingTab + RoleEditorModal | `BrandingTab.tsx` + `OnboardingTab.tsx` (consumes `SortableTreePanel<T>`) + `RoleEditorModal.tsx` expansion (12-key matrix + "Change to Owner/Clinician/Staff") + `ClinicSettingsPage.tsx` tab registration + WCAG meter UI | 31-02, 31-03, 31-04, 31-00b |
| 31-06 | 3 | Patient-side `OnboardingFlow` branch | Modify `OnboardingFlow.tsx` → branch on `primary_org_id` + `completed_onboarding_at IS NULL` + fetch active `org_onboarding_flows` + render org steps + `mark_onboarding_complete` call + e2e patient onboarding smoke test | 31-04 (table + SECDEF), 31-05 (UI complete) |

**Chunked planning trigger:** 8 plans ≥ 5 threshold — per [[feedback_parallel_chunked_planning]], Wave 1 (plans 31-01, 31-02, 31-03) should be dispatched in parallel after 31-00 and 31-00b complete. Wave 2 (31-04, 31-05) parallel after Wave 1. Wave 3 (31-06) after Wave 2.

**Integration seam ownership** (per [[feedback_chunked_planning_integration_seam_blindspot]]):

| Seam | From | To | Owning Plan |
|------|------|----|-------------|
| `resolve_clinic_branding` public grant (anon role) | Plan 31-03 migration | `brand-tokens.ts` fetch call | **31-03** (migration includes `GRANT EXECUTE TO anon`) |
| `SortableTreePanel<T>` export | Plan 31-00b | `OnboardingTab.tsx` consumer | **31-05** imports from `src/components/ui/SortableTreePanel.tsx` — 31-00b must merge before 31-05 starts |
| `profiles.completed_onboarding_at` column | Plan 31-04 migration | `OnboardingFlow.tsx` SELECT query | **31-04** (migration); **31-06** (consumer) — 31-04 must merge before 31-06 |
| `org_onboarding_flows` table READ | Plan 31-04 | `OnboardingFlow.tsx` fetch at mount | **31-04** (RLS); **31-06** (reader) |
| `org_scoped_tables` const update | Each new table | `withOrgScope.ts` bypass guard | Each plan that creates a new org-scoped table OWNS this checklist item |
| `ClinicSettingsPage` NAV tab registration | Plan 31-05 | `BrandingTab` + `OnboardingTab` | **31-05** — both tabs registered in same plan |

---

### Finding 9: Cross-tenant RLS test fixtures for new tables

**Required new RLS test files** (P28 extension contract §3):

| Table | Test File | Notes |
|-------|-----------|-------|
| `org_onboarding_flows` | `src/lib/__tests__/rls-org-onboarding-flows.test.ts` | Plan 31-04; P28 recipe; file-scoped slug prefix |
| `org_branding` (expanded) | `src/lib/__tests__/rls-org-branding.test.ts` ALREADY EXISTS [VERIFIED] | The existing test file covers the skeleton table. Plan 31-02 must add tests for the new SECDEF RPCs (`save_org_branding`, `upload_org_branding_asset`) — new test cases, same file |

**ES256-compatible fixture pattern** [CITED: reference_rls_fixture_gotrueclient_flake — 2026-05-16 fix]:
```typescript
// In each new test file
const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
// Use admin.generateLink + plain fetch /auth/v1/verify
// NEVER signInWithPassword under vitest (cross-contamination flake)
```

**ORG_SCOPED_TABLES const updates required** (per P28 Extension Contract §5):
- Plan 31-04: Add `'org_onboarding_flows'` to `ORG_SCOPED_TABLES` set in `supabase/functions/_shared/with-org-scope.ts`
- Note: `org_branding` is already in the set from P28.

---

### Finding 10: Bundle ceiling math

**Current state** [VERIFIED: reading `assert-clinic-bundle-budget.sh`]:

```
CLINIC_CEILING=36000  (36 kB gz, set Phase 30 verifier orphan-fix 2026-05-18)
CLINIC_SETTINGS_CEILING=18000
```

**P31 additions to clinic chunk** (components that will land in `src/components/clinic/*` and `src/components/ui/SortableTreePanel.tsx`):

| Component | Estimated gz | Basis |
|-----------|-------------|-------|
| `BrandingTab.tsx` | ~5 kB | Phase 30 `ClinicRankingWeightsForm` (~3 kB) + upload zones + live preview pane |
| `OnboardingTab.tsx` + onboarding builder logic | ~6 kB | Step list + editor modal + preview pane; similar in scope to `ClinicDashboardOverview` |
| `SortableTreePanel.tsx` extraction offset | ~0 kB net | Page-builder chunk LOSES ~1.5 kB; clinic chunk GAINS ~1.5 kB from the extracted component |
| `RoleEditorModal.tsx` expansion (12-key matrix render) | ~1.5 kB | Small table render + 12 rows × 3 cols |
| `lib/brand-tokens.ts` | ~0.8 kB | Small utility; included in index chunk or clinic chunk depending on import graph |
| `lib/onboarding-builder/step-schema.ts` | ~0.3 kB | Type definitions only |

**Net clinic chunk estimate:** 36 kB + 5 + 6 + 1.5 ≈ **48.5 kB gz** before any optimization.

**Recommended new ceiling: 50,000 bytes gz** (giving ~1.5 kB headroom). This is a meaningful increase but consistent with the progressive ceiling history (12→16→17→22→28→30→36→50 kB across phases).

**Recommendation for plan-checker:** Plan 31-01 (Wave 1, first parallel plan) should include the `CLINIC_CEILING=50000` bump in `scripts/assert-clinic-bundle-budget.sh` as its first task. This prevents CI failures mid-phase during Wave 1 execution.

**Key constraint:** The existing guard at Line 417 checks `import{...}from"...(dnd-kit|vendor-dnd-kit)..."` in the INDEX chunk. Since `SortableTreePanel` will be in the clinic chunk (not index), this guard is satisfied. dnd-kit goes into the `vendor-dnd-kit` chunk when any non-index lazy chunk imports it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop with keyboard a11y | Custom DnD implementation | `@dnd-kit/core` v6.3.1 (already installed) | Sensor abstraction, keyboard navigation, screen reader announcements are complex; the project already invested in dnd-kit for Phase 15 |
| oklch color parsing in JS | Custom regex parser | Client-side: browser `CSS.supports('color', value)` for validation; Server-side: regex extract L component for WCAG math | Full oklch→sRGB conversion matrix is ~50 LOC; the L-channel approximation is sufficient for WCAG AA gate |
| WCAG contrast calculation | Custom implementation | `_compute_wcag_contrast` SQL helper (as specified) | Industry-standard formula; one implementation is safer than two |
| Presigned Storage upload URL | Direct SECDEF Storage access | Supabase Edge Function mediator → `supabase.storage.createSignedUploadUrl()` | SECDEFs run as Postgres; they cannot call Supabase JS SDK directly |
| Enum value tracking/ripple | Ad-hoc migration | Structured Plan 31-00 with grep-verified blast radius | Silent role check failures if any literal is missed |

---

## Common Pitfalls

### Pitfall 1: Enum rename breaks function body role checks silently
**What goes wrong:** After `RENAME VALUE 'admin' TO 'owner'`, any SECDEF that still has `role = 'admin'` as a SQL string literal silently returns `false` (the string `'admin'` no longer matches any enum value, but Postgres does NOT raise an error — it just never finds a match). Admin operations appear to succeed from the client perspective but the role gate is bypassed.
**Why it happens:** SQL string literals in SECDEF bodies are not type-checked at migration time; they're checked at execution time against the catalog.
**How to avoid:** Plan 31-00 must recreate EVERY SECDEF that contains role literal strings. Use grep: `grep -rn "'admin'\|'staff'\|'viewer'" supabase/migrations/`.
**Warning signs:** After Plan 31-00 deploys, any admin action test that passes without an `owner` role is a red flag.

### Pitfall 2: `ALTER TYPE ... RENAME VALUE` fails if type is used in a view
**What goes wrong:** If there are any Postgres views or materialized views that SELECT a column of type `org_member_role`, `RENAME VALUE` may fail.
**Why it happens:** Views cache the type OID in their query plan; renaming an enum value invalidates cached plans.
**How to avoid:** Before running the migration, check: `SELECT table_name FROM information_schema.columns WHERE udt_name = 'org_member_role';` If any views exist, drop + recreate them in the same migration.
**Warning signs:** Migration push fails with `ERROR: cannot rename value of enum type "org_member_role"`.

### Pitfall 3: `resolve_clinic_branding` RPC not granted to `anon` role
**What goes wrong:** Unauthenticated visitors (first cold visit before signing in) get a 401 on the brand fetch. The warm-paint path works (localStorage), but cold visits see default LeanShot theme, not clinic theme.
**Why it happens:** Postgres functions default to requiring `authenticated` role unless explicitly granted to `anon`.
**How to avoid:** Plan 31-03 migration must include `GRANT EXECUTE ON FUNCTION public.resolve_clinic_branding(text) TO anon, authenticated;`.
**Warning signs:** `fetch('/rest/v1/rpc/resolve_clinic_branding')` with anon JWT returns `{"message":"permission denied"}`.

### Pitfall 4: Vite static env inlining with dynamic key lookup
**What goes wrong:** If `brand-tokens.ts` tries to read `import.meta.env[\`VITE_${key}\`]` dynamically, Vite does not inline the value at build time and the variable resolves to `undefined` at runtime.
**Why it happens:** Vite only inlines `import.meta.env.VITE_*` when accessed with a literal key, not a computed one.
**How to avoid:** `brand-tokens.ts` must use `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY` as literal keys — no dynamic access.
**Warning signs:** Brand fetch results in requests to `undefined/rest/v1/rpc/...`.

### Pitfall 5: `is_active` partial unique index does not prevent race on concurrent saves
**What goes wrong:** Two clinic admins simultaneously call `save_org_onboarding_flow` → both read `is_active = true` → both INSERT new row → both try to UPDATE old row → unique constraint violation OR double-active row.
**Why it happens:** Without a transaction-level lock, two concurrent INSERTs can both see the old active row before either UPDATE fires.
**How to avoid:** `save_org_onboarding_flow` SECDEF must use `SELECT ... FOR UPDATE` to lock the current active row before the INSERT + UPDATE pair. Inside the transaction: `SELECT id FROM org_onboarding_flows WHERE org_id = p_org_id AND is_active FOR UPDATE NOWAIT;`
**Warning signs:** Unique constraint violation on `org_onboarding_flows_active_per_org` index in Sentry.

### Pitfall 6: V13-2 multi-tenant leak via `org_onboarding_flows` without `ORG_SCOPED_TABLES` entry
**What goes wrong:** `withOrgScope` Proxy wrapper does NOT assert `org_id` filter for `org_onboarding_flows` if it's not in the `ORG_SCOPED_TABLES` set. A future Edge Function that reads the table via service role could return cross-tenant flow data.
**Why it happens:** The Proxy wrapper only fires bypass errors for tables in the allowlist (per Phase 28 D-07 design).
**How to avoid:** Plan 31-04 migration MUST include the `ORG_SCOPED_TABLES` update.
**Warning signs:** Plan-checker BLOCKER R2 — fails plan-checker if the update is missing.

### Pitfall 7: `SortableTreePanel<T>` extraction moves dnd-kit into clinic chunk
**What goes wrong:** If `SortableTreePanel.tsx` is imported by both the clinic chunk AND the page-builder (admin-bundle) chunk, Vite may duplicate the vendor-dnd-kit split, or may keep it in the admin-bundle chunk and require a dynamic import boundary in the clinic chunk.
**Why it happens:** Vite's `manualChunks` routes `@dnd-kit/*` into `vendor-dnd-kit` when first encountered. If clinic chunk now also imports dnd-kit, the existing `vite.config.ts` manualChunks logic must include the clinic chunk as a recognized dnd-kit consumer.
**How to avoid:** After Plan 31-00b extraction, run `npm run build` and verify: (1) `dnd-kit index-leak invariant OK` guard still passes in `assert-clinic-bundle-budget.sh`; (2) dnd-kit lands in `vendor-dnd-kit` chunk, not inlined into clinic.
**Warning signs:** `assert-clinic-bundle-budget.sh` reports `::error::Static import of @dnd-kit found in index chunk`.

---

## Code Examples

### Pattern 1: Enum rename in migration (Plan 31-00)

```sql
-- Source: Postgres 14 ALTER TYPE docs + project migration conventions
begin;

alter type public.org_member_role rename value 'admin'  to 'owner';
alter type public.org_member_role rename value 'staff'  to 'clinician';
alter type public.org_member_role rename value 'viewer' to 'staff';

-- Ripple: recreate _is_org_admin (renamed to _is_org_owner)
create or replace function public._is_org_owner(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer
set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'owner'
  );
$$;

-- Ripple: update _is_org_clinician (check staff → clinician)
create or replace function public._is_org_clinician(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer
set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id
      and role in ('owner', 'clinician')  -- renamed
  );
$$;

commit;
```

### Pattern 2: `has_permission` SECDEF (Plan 31-01)

```sql
-- Source: CONTEXT D-02 specification
create or replace function public.has_permission(
  p_role  public.org_member_role,
  p_perm  text
) returns boolean
  language plpgsql security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  return case p_perm
    when 'members.invite'         then p_role in ('owner')
    when 'members.revoke'         then p_role in ('owner')
    when 'members.list'           then p_role in ('owner', 'clinician', 'staff')
    when 'members.role.edit'      then p_role in ('owner')
    when 'settings.edit'          then p_role in ('owner')
    when 'branding.edit'          then p_role in ('owner')
    when 'onboarding.edit'        then p_role in ('owner')
    when 'roster.view'            then p_role in ('owner', 'clinician', 'staff')
    when 'roster.thresholds.edit' then p_role in ('owner', 'clinician')
    when 'alerts.ack'             then p_role in ('owner', 'clinician')
    when 'alerts.snooze'          then p_role in ('owner', 'clinician')
    when 'billing.view'           then p_role in ('owner')
    else false
  end;
end;
$$;

grant execute on function public.has_permission(public.org_member_role, text)
  to authenticated;
```

### Pattern 3: `get_caller_role` helper (Plan 31-01 or 31-00)

```sql
-- Resolves auth.uid() → org_members.role for a given org
create or replace function public.get_caller_role(p_org_id uuid)
returns public.org_member_role
  language sql security definer
  set search_path = pg_catalog, public, extensions
  stable
as $$
  select role from public.org_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;
-- Returns NULL if caller is not a member (not an error; RPCs check for null)
```

### Pattern 4: `save_org_onboarding_flow` with `SELECT FOR UPDATE` lock (Plan 31-04)

```sql
-- Source: Pitfall 5 mitigation + CONTEXT D-12 + D-13
create or replace function public.save_org_onboarding_flow(
  p_org_id  uuid,
  p_steps   jsonb
) returns jsonb  -- returns {version: int, flow_id: uuid}
  language plpgsql security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_role  public.org_member_role;
  v_old_id       uuid;
  v_old_version  int;
  v_new_id       uuid;
  v_new_version  int;
begin
  v_caller_role := public.get_caller_role(p_org_id);
  if v_caller_role is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not public.has_permission(v_caller_role, 'onboarding.edit') then
    raise exception 'permission denied: onboarding.edit' using errcode = '42501';
  end if;

  -- Validate steps shape
  perform public._validate_onboarding_steps(p_steps);

  -- Lock current active row to prevent race
  select id, version into v_old_id, v_old_version
  from public.org_onboarding_flows
  where org_id = p_org_id and is_active = true
  for update nowait;

  v_new_version := coalesce(v_old_version, 0) + 1;

  -- Insert new version
  insert into public.org_onboarding_flows (org_id, steps, version, is_active, created_by)
  values (p_org_id, p_steps, v_new_version, true, auth.uid())
  returning id into v_new_id;

  -- Deactivate previous active version
  if v_old_id is not null then
    update public.org_onboarding_flows
    set is_active = false
    where id = v_old_id;
  end if;

  -- Audit
  perform public.log_admin_action(
    p_action     => 'org_onboarding_flow.save',
    p_table_name => 'org_onboarding_flows',
    p_record_id  => v_new_id,
    p_new_data   => jsonb_build_object('version', v_new_version, 'org_id', p_org_id)
  );

  return jsonb_build_object('version', v_new_version, 'flow_id', v_new_id);
end;
$$;
```

### Pattern 5: `SortableTreePanel<T>` generic component (Plan 31-00b)

```typescript
// Source: CONTEXT D-11 + BlockTreePanel extraction pattern
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface SortableTreePanelProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number, isDragging: boolean) => ReactNode;
  announceItemLabel: (item: T) => string;
  isDragDisabled?: (item: T) => boolean;
}

export function SortableTreePanel<T>({
  items, getId, onReorder, renderItem, announceItemLabel, isDragDisabled,
}: SortableTreePanelProps<T>) {
  const reducedMotion = useReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((item) => getId(item) === String(active.id));
    const newIdx = items.findIndex((item) => getId(item) === String(over.id));
    if (oldIdx !== -1 && newIdx !== -1) onReorder(arrayMove(items, oldIdx, newIdx));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart({ active }) {
            const item = items.find((t) => getId(t) === String(active.id));
            const pos = items.indexOf(item!) + 1;
            return item ? `Picked up ${announceItemLabel(item)}. Position ${pos} of ${items.length}.` : '';
          },
          onDragOver({ active, over }) {
            if (!over) return;
            const item = items.find((t) => getId(t) === String(active.id));
            const overItem = items.find((t) => getId(t) === String(over.id));
            const pos = overItem ? items.indexOf(overItem) + 1 : 0;
            return item && overItem ? `${announceItemLabel(item)} moved to position ${pos}.` : '';
          },
          onDragEnd({ active, over }) {
            const item = items.find((t) => getId(t) === String(active.id));
            const overItem = over ? items.find((t) => getId(t) === String(over.id)) : null;
            const pos = overItem ? items.indexOf(overItem) + 1 : items.length;
            return item ? `${announceItemLabel(item)} dropped at position ${pos}.` : '';
          },
          onDragCancel({ active }) {
            const item = items.find((t) => getId(t) === String(active.id));
            return item ? `Reordering cancelled. ${announceItemLabel(item)} returned.` : '';
          },
        },
      }}
    >
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <SortableItem
              key={getId(item)}
              id={getId(item)}
              disabled={isDragDisabled?.(item) ?? false}
              reducedMotion={reducedMotion}
              render={(isDragging) => renderItem(item, index, isDragging)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline dnd-kit in `BlockTreePanel` | Generic `SortableTreePanel<T>` | P31 (this phase) | Both page-builder and onboarding builder share one primitive |
| `org_member_role` enum: admin/staff/viewer | owner/clinician/staff | P31 Plan 31-00 | All role checks must use new vocabulary |
| Phase 28 skeleton `org_branding` (5 columns) | Full 10-token brand map | P31 Plan 31-02 | Full CSS-var theming overlay |
| No per-clinic onboarding | `org_onboarding_flows` versioned table | P31 Plan 31-04 | Clinics can customize patient onboarding |
| `profiles.completed_onboarding_at` absent | New nullable column | P31 Plan 31-04 | First-clinic-wins gate |

**Deprecated/outdated:**
- `_is_org_admin` function: renamed to `_is_org_owner` in Plan 31-00.
- `org_member_role` value `'admin'`: retired in Plan 31-00; replaced by `'owner'`.
- Phase 28 `org_branding.font_family` column: renamed to `heading_font` in Plan 31-02 migration (`ALTER TABLE org_branding RENAME COLUMN font_family TO heading_font`).

---

## Runtime State Inventory

This phase includes an enum rename — a form of schema migration that touches live data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `org_member_role` enum values `admin/staff/viewer` in live `org_members.role` column; Supabase catalogs the enum values. `ALTER TYPE ... RENAME VALUE` updates the catalog — existing rows are automatically updated (enum values are stored as OIDs, not strings). | No data migration needed for existing rows — Postgres renames at the catalog level. SECDEF function bodies (SQL string literals) need explicit recreation. |
| Live service config | No n8n workflows, no external services store role strings. Role strings are only in Postgres and TypeScript source. | Code edit only. |
| OS-registered state | None. | None — verified by search. |
| Secrets/env vars | No secrets reference role names. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are used by `brand-tokens.ts` but are pre-existing. | None for the enum rename. |
| Build artifacts | `dist/` contains compiled JS. Any bundle that tree-shook ROLE_PERMISSIONS with old keys would be stale. | `npm run build` after Plan 31-00 + 31-01 is complete; Vercel redeploy clears stale bundles. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ALTER TYPE ... RENAME VALUE` + `CREATE OR REPLACE FUNCTION` can coexist in the same `BEGIN...COMMIT` transaction because RENAME VALUE does not trigger the "new enum value" restriction | Finding 1 | If wrong: the migration must split into two transactions (RENAME in one, SECDEF recreations in another) — manageable but requires a different migration file structure |
| A2 | `L^2.2` approximation for oklch relative luminance gives <±0.2 ratio error for typical brand colors | Finding 2 | If wrong: some colors that narrowly pass/fail WCAG AA by the server check may have incorrect result — mitigated by the client-side meter showing the true value |
| A3 | SECDEF `mark_onboarding_complete` can UPDATE `public.profiles` directly (assumes the SECDEF has `search_path = pg_catalog, public, extensions` and the `profiles` table is in `public`) | Finding 6 | Confirmed by codebase inspection: `profiles` is in `public` schema. LOW risk. |
| A4 | `upload_org_branding_asset` SECDEF cannot generate presigned upload URLs directly (requires Edge Function mediator) | Finding 4 | If wrong (e.g., via a pg_http extension or custom approach): implementation would be simpler. HIGH confidence this assumption is correct per Supabase architecture. |
| A5 | Existing `rls-org-branding.test.ts` test file covers the skeleton table; Plan 31-02 adds new test cases to the same file (not a new file) | Finding 9 | Verified by `ls src/lib/__tests__/` — file exists. |

---

## Open Questions

1. **`save_org_branding` presigned URL architecture**
   - What we know: CONTEXT D-08 says "SECDEF returns a presigned URL." Postgres SECDEFs cannot call Supabase JS SDK.
   - What's unclear: Should this be (a) Edge Function for presign + SECDEF for metadata write, or (b) split into `upload_org_branding_asset` Edge Function that does both?
   - Recommendation: Planner should decide at Plan 31-02 scoping. Edge Function (`branding-asset-upload-url`) that validates caller role via supabase-js (service role) then returns presigned URL is the cleanest pattern. The SECDEF approach in CONTEXT D-08 should be interpreted as "SECDEF validates + Edge Function generates URL."

2. **WCAG contrast approximation precision**
   - What we know: L^2.2 approximation works for most colors. Edge cases near the 4.5 threshold may yield incorrect pass/fail.
   - What's unclear: Is ±0.2 ratio error acceptable for a healthcare product?
   - Recommendation: Implement the full oklch→Oklab→linear sRGB→luminance conversion using PL/pgSQL matrix math if precision is critical. Three 3×3 matrix multiplies are feasible in PL/pgSQL. Mark as LOW risk for v1.3; revisit if a clinic reports contrast issues.

3. **Tailwind v4 `--brand-*` fallback chain in `index.css`**
   - What we know: UI-SPEC §Surface 4 specifies fallback chain for all 8 `--brand-*` props. Tailwind v4 `@theme {}` reads CSS custom properties.
   - What's unclear: Does the Tailwind v4 beta used by the project (^4.0.0-beta.7) support `var(--brand-primary, var(--color-primary))` fallback chains in `@theme {}` blocks?
   - Recommendation: Plan 31-03 should verify this by testing the fallback chain against the installed Tailwind version. The alternative (JS-side applyBrandTokens always writes all vars with a fallback value, never leaving a var unset) also works.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@dnd-kit/core` | `SortableTreePanel<T>` | ✓ | 6.3.1 [VERIFIED: package.json] | — |
| `@dnd-kit/sortable` | `SortableTreePanel<T>` | ✓ | 10.0.0 [VERIFIED: package.json] | — |
| Supabase project (linked) | All DB migrations | ✓ | ref: ytnsipxxmzgaebkqmokp [VERIFIED: live query succeeded] | — |
| `npx supabase` CLI | Migration push + live queries | ✓ | Working [VERIFIED: db query returned results] | — |
| Supabase Storage `org-logos` bucket pattern | Reference for P31 bucket setup | ✓ | Exists [VERIFIED: migration file] | — |

---

## Validation Architecture

> `nyquist_validation: true` is set in `.planning/config.json` — this section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.5 + Playwright ^1.59.1 |
| Unit config | `vitest.config.ts` (standard), `vitest-e2e.config.ts` (RLS tests against live DB) |
| RLS test command | `npx vitest run --config vitest-e2e.config.ts src/lib/__tests__/rls-org-onboarding-flows.test.ts` |
| Unit test command | `npx vitest run src/lib/__tests__/role-matrix-sync.test.ts` |
| Full suite | `npm run test:unit` (vitest) + `npm run test:e2e:rls` (RLS) |
| E2E command | `npm run test:e2e` (Playwright) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORG-11 | CSS-var overlay applies on `/clinic/{slug}/*`; no FOUT on warm reload | E2E (Playwright smoke) | `playwright test e2e/clinic-brand-first-paint.spec.ts` | ❌ Wave 0 |
| ORG-11 | `save_org_branding` rejects WCAG-failing color pairs | Unit (vitest) | `vitest run src/lib/__tests__/rls-org-branding.test.ts` | ✅ (update with new cases) |
| ORG-11 | `org_onboarding_flows` cross-tenant isolation | RLS (vitest-e2e) | `vitest run --config vitest-e2e.config.ts src/lib/__tests__/rls-org-onboarding-flows.test.ts` | ❌ Wave 0 |
| ORG-12 | DB `has_permission()` matches TS `ROLE_PERMISSIONS` for all 36 (role, perm) pairs | Unit (vitest) | `vitest run src/lib/__tests__/role-matrix-sync.test.ts` | ❌ Wave 0 |
| ORG-12 | `change_member_role` denied when caller lacks `members.role.edit` | RLS (vitest-e2e) | included in rls-org-members.test.ts update | ✅ (update) |
| ORG-12 | Last-owner guard blocks demotion of final owner | Unit (vitest) | `vitest run src/lib/__tests__/role-editor-modal.test.ts` | ❌ Wave 0 |
| ORG-13 | `save_org_onboarding_flow` with mandatory steps missing raises error | Unit (vitest) | `vitest run src/lib/__tests__/validate-onboarding-steps.test.ts` | ❌ Wave 0 |
| ORG-13 | Cross-tenant: org_onboarding_flows SELECT returns 0 rows for other org | RLS (vitest-e2e) | `vitest run --config vitest-e2e.config.ts src/lib/__tests__/rls-org-onboarding-flows.test.ts` | ❌ Wave 0 |
| ORG-13 | `OnboardingFlow.tsx` renders org flow for invited patient with `completed_onboarding_at IS NULL` | E2E (Playwright) | `playwright test e2e/patient-org-onboarding.spec.ts` | ❌ Wave 0 |
| ORG-13 | `mark_onboarding_complete` sets `profiles.completed_onboarding_at`; second visit skips onboarding | E2E (Playwright) | included in `e2e/patient-org-onboarding.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/__tests__/role-matrix-sync.test.ts` (fast, ~5s)
- **Per wave merge:** `npm run test:unit && npm run test:e2e:rls` (~2 min)
- **Phase gate:** Full suite green (`npm run test`) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/role-matrix-sync.test.ts` — covers ORG-12 DB/TS matrix equality (Plan 31-01)
- [ ] `src/lib/__tests__/rls-org-onboarding-flows.test.ts` — covers ORG-13 cross-tenant (Plan 31-04)
- [ ] `src/lib/__tests__/validate-onboarding-steps.test.ts` — unit tests for `_validate_onboarding_steps` shape guard (Plan 31-04)
- [ ] `src/lib/__tests__/role-editor-modal.test.ts` — last-owner guard + role change UI (Plan 31-05)
- [ ] `e2e/clinic-brand-first-paint.spec.ts` — ORG-11 first-paint smoke test (Plan 31-03)
- [ ] `e2e/patient-org-onboarding.spec.ts` — ORG-13 patient-side onboarding flow (Plan 31-06)
- [ ] Framework: no new framework install needed — vitest + Playwright already configured

---

## Security Domain

> `security_enforcement` is not explicitly false in config — this section is REQUIRED.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (no new auth flows) | — |
| V3 Session Management | No | — |
| V4 Access Control | YES | `has_permission()` SECDEF (DB floor) + `surfaceCheck()` (client hint); per-action SECDEF RPCs for all P31 mutations |
| V5 Input Validation | YES | `_validate_onboarding_steps(jsonb)` SECDEF; oklch regex in `save_org_branding`; `_compute_wcag_contrast` rejects invalid input |
| V6 Cryptography | No (no new crypto primitives; existing HMAC channel auth unchanged) | — |
| V7 Error Handling | YES | SECDEFs return structured error codes (`CONTRAST_TEXT_BG_FAIL`); no stack trace leakage |
| V8 Data Protection | YES | `completed_onboarding_at` on profiles is patient data; RLS ensures user reads own row only |
| V13 API | YES | Public RPC `resolve_clinic_branding` MUST be read-only + return no PHI |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant org_onboarding_flows read | Information Disclosure | RLS SELECT policy + `ORG_SCOPED_TABLES` + cross-tenant vitest |
| WCAG bypass (save branding with bad contrast) | Tampering | Server-side `_compute_wcag_contrast` hard-block in `save_org_branding` SECDEF |
| Privilege escalation via `change_member_role` | Elevation of Privilege | `has_permission(role, 'members.role.edit')` check; last-owner guard |
| CSS injection via brand colors | Tampering | oklch-only input; regex rejects non-oklch; no free CSS escape hatch |
| Storage path traversal (upload to other org's path) | Tampering | `(storage.foldername(name))[1]` org_id extraction + org_members role check in Storage RLS |
| `resolve_clinic_branding` returns PHI | Information Disclosure | RPC returns ONLY brand tokens (colors, fonts, logo URL, clinic name); no patient data |
| Unauthenticated org branding write | Tampering | All writes via SECDEF that checks `get_caller_role()`; anon role not granted write functions |
| `completed_onboarding_at` forged by client | Tampering | `mark_onboarding_complete()` SECDEF writes to own profile row only; client cannot UPDATE directly (RLS deny-all on UPDATE for this column) |
| HIPAA: clinic name in brand token response | PHI exposure | Clinic name is org-level metadata (not patient PHI); acceptable in public RPC response |

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 31 |
|-----------|-------------------|
| Architecture: local-first must continue to work | `OnboardingFlow.tsx` consumer-path (DEFAULT_STEPS) unchanged; org branch requires network |
| Bundle size: code-split aggressively | New components are lazy-loaded in clinic chunk; no static imports in index chunk |
| Performance / accessibility | `SortableTreePanel<T>` must preserve keyboard nav + SR announcements + `useReducedMotion` |
| No VITE_ dynamic key inlining | `brand-tokens.ts` uses literal `import.meta.env.VITE_SUPABASE_URL` keys only |
| TypeScript strict mode | All new files pass `tsc -b`; no `as any` permitted |
| SECURITY DEFINER search_path | Every new SECDEF: `set search_path = pg_catalog, public, extensions` |
| GSD workflow enforcement | All changes go through GSD execute-phase |

---

## Sources

### Primary (HIGH confidence)
- `/Users/karstenhaldan/minisite/supabase/migrations/20270601100003_org_member_role_enum.sql` — live enum values confirmed
- `/Users/karstenhaldan/minisite/supabase/migrations/20260801000003_org_logos_storage.sql` — Storage bucket pattern precedent
- `npx supabase db query --linked` — live org_member_role enum confirmed: `admin | staff | viewer`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/editor/BlockTreePanel.tsx` — dnd-kit usage pattern
- `/Users/karstenhaldan/minisite/leanshot/src/main.tsx` — pre-mount pattern
- `/Users/karstenhaldan/minisite/leanshot/scripts/assert-clinic-bundle-budget.sh` — current CLINIC_CEILING=36000
- `/Users/karstenhaldan/minisite/leanshot/src/lib/org.ts` — ROLE_PERMISSIONS shape (6 keys, needs expansion to 12)
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md` — RLS template + ORG_SCOPED_TABLES update checklist
- `dndkit.com/guides/accessibility` — v6 `accessibility.announcements` 4-handler shape

### Secondary (MEDIUM confidence)
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-CONTEXT.md` — 16 D-NN locked decisions
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-UI-SPEC.md` — 5 surface contracts
- `@dnd-kit/core` npm registry — v6.3.1 confirmed installed
- Supabase REST RPC anonymous access pattern — MEDIUM (standard documented pattern, verified via existing Phase 9 codebase usage)

### Tertiary (LOW confidence — flagged)
- L^2.2 oklch luminance approximation — training knowledge; not verified against WCAG 2.2 spec tolerance
- `ALTER TYPE RENAME VALUE` + `CREATE OR REPLACE` in same transaction behavior — Postgres semantics reasoning, not a live transaction test

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all verified installed
- Architecture / plan outline: HIGH — grounded in verified codebase state
- Enum rename blast radius: HIGH — confirmed by live grep of all migration files
- Bundle ceiling math: MEDIUM — estimates based on comparable Phase 30 components
- WCAG SQL helper implementation: MEDIUM — L^2.2 approximation is tagged ASSUMED
- dnd-kit accessibility.announcements shape: HIGH — verified against official docs

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable stack; 30-day window)
