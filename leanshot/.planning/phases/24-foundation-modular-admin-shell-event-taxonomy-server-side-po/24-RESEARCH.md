# Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog - Research

**Researched:** 2026-05-17
**Domain:** Admin shell architecture + measurement observability + 2FA TOTP + audit logging + per-chunk bundle CI enforcement
**Confidence:** HIGH (verified against Context7 for posthog-node + Supabase MFA APIs 2026-05-17; v1.2 carry-forward prior art directly inspectable in tree; CONTEXT.md decisions are locked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim)

**Modular admin router**
- **D-01** Module registry = manifest TS file at `src/lib/admin/modules.ts` exporting `ADMIN_MODULES as const … satisfies AdminModule[]`. Each entry `{key, label, route, icon, lazy: () => import(), flagKey, minRole}`. AdminLayout maps over it for nav + Suspense routes. No self-registration; no DB-driven registry.
- **D-02** Module feature flag = PostHog `posthog.isFeatureEnabled(flagKey)`. Bootstrapped to avoid first-paint flash; failure = module hidden.
- **D-03** Route-gating uses Pattern S1 dual-layer (client AdminShell + RPC `is_staff()` + role check at DB function level).
- **D-04** Fixed 3-role model: `staff` / `admin` / `superadmin` stored as `profiles.admin_role` enum. `minRole` per module; ordinal compare. No per-admin permission matrix (anti-feature).
- **D-05** Twelve modules canonically named: Users, Content, Onboarding, Gamification, Reviews, Membership, Analytics, AI, Helpdesk, Billing, Settings, Audit Log.

**2FA TOTP**
- **D-06** Hard-cut at ship — middleware checks `profiles.has_totp`; redirects to `/admin/setup-2fa` if false. No grace window.
- **D-07** TOTP via Supabase Auth `mfa.enroll/challenge/verify` (factor type `totp`).
- **D-08** Recovery = 10 HMAC-hashed backup codes + superadmin `admin.reset_totp(target_user_id)` RPC. Reset is audit-logged.
- **D-09** Re-prompt every admin session, no trust cookie. Supabase Auth `aal2` step-up required for `/admin/*` middleware. No per-action step-up gating in v1.

**Event taxonomy + server-side PostHog**
- **D-10** Schema evolution = additive-only, ESLint-enforced. Once registered, payload fields cannot be removed or have types changed. TAXO-06 acceptance: confirm ESLint rule satisfies the REQ; if not, fall back to version-bump + adapter.
- **D-11** Source-of-truth = `src/lib/analytics/events.ts` zod schemas → JSON schema → CI sync to PostHog event-definitions API on every main-branch deploy. CI fails if PostHog API call fails (block deploy).
- **D-12** PHI gate at event-level boolean. PHI-true events forbidden client-side; rejected by `capture()` (throws dev, logs+drops prod). ESLint blocks `import` of PHI-flagged symbols into client zones via `import-x/no-restricted-paths`. PHI events MUST originate from Edge Functions via `posthog-server.ts`.
- **D-13** Edge Function distinct_id = always Supabase `auth.users.id`. Browser does `identify(supabase_uid)` + `alias(anon_distinct_id, supabase_uid)`. `await client.shutdown()` MANDATORY before Edge return.

**Audit log**
- **D-14** Scope = admin actions + curated PHI-table list (~15 tables: `injections`, `weights`, `meals`, `workouts`, `vials`, `costs`, `mood_logs`, `sleep_logs`, `photos`, `doctor_shares`, `clinic_patients`, `conversations`, `profiles`, `affiliate_payouts`, `audit_logs` itself). Two write paths: explicit (`select log_admin_action(...)`) + trigger-based.
- **D-15** Diff storage = full before/after JSONB. Diff viewer computes diff client-side.
- **D-16** Retention = 90 days hot + Parquet cold archive forever in private Supabase Storage bucket (`audit-archive/YYYY/MM/DD.parquet`). Nightly cron Edge Function.
- **D-17** Append-only RLS — DENY `update` and `delete` for all roles including `service_role`. Inserts only via SECURITY DEFINER `log_admin_action()` function or trigger owner privileges.

**Bundle ceilings**
- **D-18** New ceilings: `admin-shell` 30 kB gz, `helpdesk-widget` 25 kB gz, `i18n-runtime` 15 kB gz, `gamification-burst` 8 kB gz, `community-feed` 20 kB gz, `course-player` 30 kB gz. Index stays 50 kB gz (v1.2 baseline).
- **D-19** Failure mode = hard-fail CI on first overage.
- **D-20** Chunk-name → file mapping via Vite `manualChunks()` deterministic name prefix; ceiling script greps `dist/assets/<name>-*.js`.

### Claude's Discretion
- Exact SQL DDL for `admin_role` enum + `audit_logs` schema (follow v1.2 migration conventions).
- Custom ESLint rule implementation for additive-only event registry.
- Zod-schema generation step (`ts-to-zod` vs hand-written).
- PostHog event-definitions API call shape.
- Whether to ship a 12-module skeleton or only Audit Log + Settings (placeholder for the other 7 acceptable).

### Deferred Ideas (OUT OF SCOPE)
- Two-of-N TOTP reset approval flow.
- Per-sensitive-action step-up TOTP (per-action `aal2`).
- DB-driven `admin_modules` registry.
- JSON-Patch diff column on `audit_logs`.
- Parquet archive data residency / cross-region replication.
- PostHog Boost tier decision.
- Per-clinic / org-scoped admin role gating (P28+).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Modular admin shell with 12 lazy-loaded, feature-flagged, route-gated modules | D-01 manifest pattern; D-02 PostHog flag; D-05 module list; existing `AdminLayout.tsx` Pattern S1 refactor target |
| ADMIN-02 | Audit log (admin actions + curated PHI list) with append-only RLS, diff viewer, 90d hot + Parquet cold | D-14 scope; D-15 full JSONB; D-16 retention; D-17 deny-update/delete; existing `clinic/settings/AuditTab.tsx` reusable basis |
| ADMIN-03 | 2FA TOTP enforced for admin-or-higher; backup codes + superadmin reset RPC | D-06 hard-cut; D-07 Supabase MFA; D-08 backup codes; D-09 aal2 every session; Supabase MFA API verified (Context7) |
| TAXO-01 | Canonical event taxonomy in `src/lib/analytics/events.ts` as single source of truth; ESLint enforces additive-only | D-10 ESLint rule; D-11 zod schemas |
| TAXO-02 | Server-side PostHog from Edge Functions (signup/payment/activation/refund) for adblock-immune events | D-11 source-of-truth; D-13 distinct_id = Supabase uid; posthog-node@5 Deno-compat verified (Context7) |
| TAXO-04 | PHI gate — events flagged `phi: true` cannot originate from browser; client zone import-restricted; PHI events route through Edge Function helper | D-12 PHI gate; D-13 server-side capture |
| TAXO-06 | Schema-evolution policy with migration safety. D-10 reconciliation note: planner MUST confirm ESLint additive-only satisfies acceptance; if reviewer wants the downgrade-map, fall back to version-bump + adapter | D-10 with explicit reconciliation note |
</phase_requirements>

## Summary

Phase 24 ships the measurement + admin foundation v1.3 depends on. Five workstreams entangle: modular admin shell (manifest + flag + role gates), 3-role + TOTP MFA with hard-cut middleware, canonical event registry with ESLint-enforced additive evolution, server-side PostHog from Edge Functions (adblock-immune), append-only audit log (admin actions + ~15 PHI tables) with 90d hot + Parquet cold, and per-chunk bundle ceilings enforced in CI. None of these can ship without the others because: the admin shell needs the role enum to gate modules, audit log needs the role enum to attribute `actor_user_id`, the event taxonomy and PostHog server helper need each other (events define what gets sent; the helper sends them), and CI bundle ceilings catch regressions introduced by the new admin shell + module wiring.

**Primary recommendation:** Ship the manifest + role enum + audit_logs DDL in Wave 1 (foundation), then Wave 2 layers Pattern S1 dual-layer wiring + TOTP enrollment + `posthog-server.ts` helper + events.ts registry + ESLint rule + Parquet archive cron + bundle ceiling script extension. The TAXO-06 reconciliation tension (D-10 additive-only vs REQ wording about a downgrade-map) resolves cleanly: the ESLint rule **is** the migration tool because breakage cannot happen. Document this in `events.ts` header so reviewers see the reconciliation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Module registry + lazy loader | Browser (Vite/React) | — | Module entry definition + `React.lazy` is build-time + render-time |
| Module feature flag resolution | Browser (PostHog SDK) | — | Bootstrapped flags evaluated client-side; failure = hidden |
| Role-based route gate (client) | Browser | API/DB (RPC re-check) | Pattern S1 dual-layer; client gate UX-only, RPC enforces |
| `is_staff()` + `admin_role` enum | DB (Postgres) | — | Enum + SECURITY DEFINER funcs; canonical authority |
| TOTP enroll/challenge/verify | Supabase Auth | Browser (form) | `mfa.enroll/challenge/verify` API; QR code rendered client-side |
| Backup-code generation | Edge Function | DB (hashed storage) | `_shared/totp-backup-codes.ts` issues + HMAC-hashes 10 codes |
| `admin.reset_totp` RPC | DB (SECURITY DEFINER) | Edge Function (email new enrollment link) | RPC clears factor; Edge Fn emails the enrollment URL |
| `aal2` step-up middleware | Vercel Routing Middleware | Supabase Auth | Middleware checks JWT `aal` claim before `/admin/*` |
| Event registry (`events.ts`) | Browser + Edge Function (shared types) | — | TS source-of-truth; both sides import zod schemas |
| Additive-only enforcement | CI (ESLint custom rule) | — | Runs in `npm run lint` + pre-commit + PR check |
| Browser PostHog `capture()` | Browser | — | Wraps `posthog.capture()` with PHI-gate guard |
| Server PostHog `capture()` | Edge Function | — | `_shared/posthog-server.ts` lazy-init + `await client.shutdown()` |
| PostHog event-definitions sync | CI (GitHub Action) | PostHog REST API | Generated JSON schema → PATCH event definitions on main deploy |
| Audit log writes (admin) | DB (`log_admin_action` SECURITY DEFINER) | — | Called from every admin RPC |
| Audit log writes (PHI tables) | DB (per-row trigger) | — | Trigger captures INSERT/UPDATE/DELETE; before/after JSONB |
| Audit log read + diff viewer | Browser (Admin Audit Log module) | DB (`audit_logs` SELECT via RLS) | Component reuses `clinic/settings/AuditTab.tsx` JSON-diff pattern |
| Parquet cold archive | Edge Function (nightly cron) | Supabase Storage | DuckDB-queryable; private HIPAA-eligible bucket |
| Per-chunk bundle ceilings | CI (`assert-bundle-budget.sh`) | Vite (`manualChunks`) | Build emits deterministic names; script greps + gunzips + asserts |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | `^2.x` (already pinned in repo) | Browser MFA enroll/challenge/verify + `auth.refreshSession()` to upgrade to `aal2` | Official client; only way to invoke Supabase Auth MFA endpoints from SPA |
| `posthog-node` | `^5.10.4` via `npm:posthog-node@5.10.4` Deno specifier | Server-side capture from Edge Functions (Deno runtime) | v1.3 STACK research confirmed `posthog-node@5` Deno-compatible; `await client.shutdown()` required |
| `posthog-js` | already wired in `src/main.tsx` | Browser capture + feature flags (`isFeatureEnabled`) + identify/alias | Existing v1.2 wiring; D-02 reuses `posthog.isFeatureEnabled(flagKey)` |
| `zod` | `^3.x` (likely present from v1.2 — verify) | Event-registry typed schemas + JSON-schema generation | TS source-of-truth + runtime validate; standard for type-safe contracts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod-to-json-schema` | `^3.x` | Generate JSON Schema from zod for PostHog event-definitions sync | CI step that PATCHes `/api/projects/<id>/event_definitions` |
| `eslint` | already in repo | Custom rule for additive-only event registry | Loaded via `eslint.config.js` rules + `no-restricted-syntax` for PHI gate |
| `pg_cron` | available on Supabase Pro (already on Pro) | Nightly Parquet archive trigger (`select net.http_post(...)`) | Schedules the `audit-archive` Edge Function at 03:00 UTC |
| `duckdb` (Deno via `npm:duckdb`) | `^1.x` | Edge Function writes Parquet from `audit_logs` SELECT | Single-file Parquet writer; HIPAA-eligible storage path |
| `otplib` (or `@oslojs/otp`) | Backup-code HMAC verification path | Generate + HMAC-hash 10 backup codes; verify on use | Only used if Supabase MFA doesn't provide backup-code primitive; fall back to hand-hash |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `manualChunks` deterministic prefix | `vite-plugin-bundle-analyzer` JSON output | User chose `manualChunks` per Q16; carries v1.2 pattern forward |
| Custom ESLint rule for additive-only | `git diff` Bash gate in CI only | ESLint rule catches in editor + pre-commit + CI; richer feedback |
| `zod-to-json-schema` | Hand-roll JSON schemas | Generated stays in sync with TS types; one source of truth |
| DuckDB Parquet writer | Native Postgres `COPY` + `parquet_fdw` | DuckDB simpler in Edge Function; `parquet_fdw` not on Supabase managed |

**Installation:**
```bash
# In leanshot/ project root
npm install zod-to-json-schema@^3
# zod already installed (verify via `npm ls zod`)
# posthog-node imported via `npm:posthog-node@5.10.4` Deno specifier — NOT installed in package.json
```

**Version verification (executed 2026-05-17):**
- `posthog-node@5.10.4` — verified Context7 `/posthog/posthog-js` exposes Node SDK with `capture`, `identify`, `groupIdentify`, `withContext`, `enterContext`, `shutdown` APIs; explicit "Shutdown properly to flush events" guidance present.
- `@supabase/supabase-js` MFA — verified Context7 `/supabase/supabase` exposes `auth.mfa.enroll({factorType: 'totp', issuer, friendlyName})`, `auth.mfa.challenge({factorId})`, `auth.mfa.verify({factorId, challengeId, code})`, `auth.mfa.listFactors()`, and `auth.jwt() ->> 'aal'` for RLS gates.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `zod-to-json-schema` | npm | 4+ yrs | high (~1M/wk) | github.com/StefanTerdell/zod-to-json-schema | [ASSUMED OK] | Approved (planner adds slopcheck task if available) |
| `posthog-node` | npm | 5+ yrs | high | github.com/PostHog/posthog-js (monorepo) | [VERIFIED via Context7] | Approved |
| `@supabase/supabase-js` | npm | already in repo | already trusted | github.com/supabase/supabase-js | [VERIFIED — existing] | Approved |
| `duckdb` (npm) | npm | 3+ yrs | high | github.com/duckdb/duckdb-node | [ASSUMED OK] | Approved with planner-checkpoint to verify Deno-compat at Wave 2 (an Edge Function smoke test) |

*If slopcheck is unavailable at execution time, the planner must add a `checkpoint:human-verify` task before `npm install zod-to-json-schema`.*

## Architecture Patterns

### System Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (SPA)                                │
│                                                                         │
│  /admin/* request                                                       │
│     │                                                                   │
│     ▼                                                                   │
│  AdminShell (D-01,02,03)                                                │
│    ├─ ADMIN_MODULES.filter(byRole).filter(byFlag)  ← manifest           │
│    ├─ React.lazy() per entry                                            │
│    ├─ <NotAuthorizedCard /> if no match                                 │
│    └─ Pattern S1 client gate                                            │
│                                                                         │
│  posthog-js (browser)                                                   │
│    ├─ identify(supabase_uid)   ← D-13                                   │
│    ├─ alias(anon_id, supabase_uid)                                      │
│    ├─ isFeatureEnabled(flagKey)  ← D-02                                 │
│    └─ capture(event, payload) — REJECTS phi:true events  ← D-12         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                  ┌────────────────┼──────────────────┐
                  ▼                ▼                  ▼
┌──────────────────────┐ ┌──────────────────┐ ┌───────────────────────┐
│ Vercel Routing       │ │  Supabase Auth   │ │   Supabase Edge Fns   │
│ Middleware           │ │                  │ │                       │
│                      │ │ mfa.enroll/      │ │ admin-reset-totp      │
│ /admin/* aal2 check  │ │ challenge/verify │ │ audit-archive (cron)  │
│ has_totp redirect    │ │ aal2 step-up     │ │ stripe-webhook        │
│                      │ │ JWT aal claim    │ │ + posthog-server      │
└──────────────────────┘ └──────────────────┘ │   (capture + shutdown)│
                                              └───────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              POSTGRES                                   │
│                                                                         │
│  profiles.admin_role enum (staff|admin|superadmin), has_totp boolean    │
│  audit_logs (RLS deny update/delete; insert only via SECURITY DEFINER   │
│              or trigger owner)                                          │
│  log_admin_action(action, target, before, after) SECURITY DEFINER       │
│  PHI-table triggers (15 tables) → INSERT audit_logs                     │
│  admin_backup_codes_<hashed>                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                ┌──────────────────────────────────┐
                │  Supabase Storage (private)      │
                │  audit-archive/YYYY/MM/DD.parquet│
                └──────────────────────────────────┘

                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                 CI                                      │
│                                                                         │
│  - npm run lint (additive-only event-registry rule)                     │
│  - npm run build → scripts/assert-bundle-budget.sh                      │
│    asserts per-chunk ceilings: admin-shell 30, helpdesk-widget 25,      │
│    i18n-runtime 15, gamification-burst 8, community-feed 20,            │
│    course-player 30, index 50                                           │
│  - PostHog event-definitions sync on main deploy (CI secret)            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```text
src/
├── lib/
│   ├── admin/
│   │   ├── modules.ts          # D-01 — ADMIN_MODULES manifest
│   │   ├── roles.ts            # D-04 — role ordinal helpers + types
│   │   ├── modules.test.ts     # shape + flag-key uniqueness tests
│   │   └── (existing admin-api.ts, admin-impersonate.ts, …)
│   ├── analytics/
│   │   ├── events.ts           # D-11 — registry { name, version, payload (zod), phi, owner }
│   │   ├── capture.ts          # D-12 — guarded browser wrapper
│   │   ├── identify.ts         # D-13 — identify + alias bridge
│   │   └── events.test.ts
│   └── supabase.ts             # adds assertAal2() helper
├── components/
│   └── admin/
│       ├── AdminLayout.tsx     # refactor — map over ADMIN_MODULES
│       ├── AdminShell.tsx      # NEW — Suspense + flag/role gating
│       ├── AuditLogModule.tsx  # NEW — reuses clinic AuditTab pattern
│       ├── SettingsModule.tsx  # NEW
│       └── pages/
│           └── (existing AdminMembers/Metrics/Cohorts/Affiliates refactored as manifest entries)
├── routes/
│   └── admin/
│       └── setup-2fa.tsx       # NEW — TOTP enrollment + backup codes
└── middleware.ts              # NEW — Vercel routing middleware aal2 + has_totp redirect

supabase/
├── functions/
│   ├── _shared/
│   │   ├── posthog-server.ts   # NEW — Edge-only PostHog helper
│   │   └── audit-helpers.ts    # NEW — actor uid resolution
│   ├── admin-reset-totp/
│   │   └── index.ts            # NEW — superadmin recovery
│   ├── audit-archive/
│   │   └── index.ts            # NEW — nightly cron → DuckDB → Parquet → Storage
│   └── (existing stripe-webhook, etc., gain posthog-server import)
└── migrations/
    ├── 20260518000001_admin_role_enum.sql
    ├── 20260518000002_profiles_admin_role_column.sql
    ├── 20260518000003_audit_logs_table_rls.sql
    ├── 20260518000004_log_admin_action_function.sql
    ├── 20260518000005_audit_phi_table_list_triggers.sql
    ├── 20260518000006_admin_backup_codes_table.sql
    └── 20260518000007_audit_archive_cron.sql

scripts/
├── assert-bundle-budget.sh    # extended — per-chunk ceilings map
└── sync-posthog-event-defs.ts # NEW — CI step

eslint-rules/                  # NEW — local plugin dir
├── additive-only-events.js    # custom rule
└── phi-event-zone.js          # zone gate (or import-x config)
```

### Pattern 1: Manifest-driven admin modules

**What:** Single `ADMIN_MODULES` array as `const … satisfies AdminModule[]` defines every admin module with role + flag + lazy import. AdminShell renders nav + routes by filtering this array.

**When to use:** Always for v1.3 admin surface. Replaces v1.2 hard-coded `ADMIN_NAV`.

**Example:**
```typescript
// src/lib/admin/modules.ts — concrete pattern
import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

export type AdminRole = 'staff' | 'admin' | 'superadmin';
export const ROLE_ORDER: Record<AdminRole, number> = { staff: 0, admin: 1, superadmin: 2 };

export interface AdminModule {
  key: string;
  label: string;
  route: string;             // matches /admin/<route>
  icon: ComponentType;       // lucide-react icon component
  lazy: () => Promise<{ default: ComponentType }>;
  flagKey: string;           // PostHog feature flag name
  minRole: AdminRole;
}

export const ADMIN_MODULES = [
  { key: 'users',         label: 'Users',         route: 'users',         icon: UsersIcon,         lazy: () => import('@/components/admin/UsersModule'),         flagKey: 'admin.users.enabled',         minRole: 'staff' },
  { key: 'content',       label: 'Content',       route: 'content',       icon: FileTextIcon,      lazy: () => import('@/components/admin/PlaceholderModule'),   flagKey: 'admin.content.enabled',       minRole: 'admin' },
  // ... 10 more entries per D-05
  { key: 'audit-log',     label: 'Audit Log',     route: 'audit-log',     icon: ShieldIcon,        lazy: () => import('@/components/admin/AuditLogModule'),       flagKey: 'admin.audit_log.enabled',     minRole: 'superadmin' },
  { key: 'settings',      label: 'Settings',      route: 'settings',      icon: SettingsIcon,      lazy: () => import('@/components/admin/SettingsModule'),       flagKey: 'admin.settings.enabled',      minRole: 'admin' },
] as const satisfies readonly AdminModule[];
```

### Pattern 2: PHI-gated event capture

**What:** Browser `capture()` wrapper reads `phi` flag from event registry; rejects PHI events at runtime; ESLint rule rejects PHI-event imports at lint time in client zones.

**When to use:** Every event emission in browser code. Edge Functions use `posthog-server.ts` which has no client-zone gate.

**Example:**
```typescript
// src/lib/analytics/capture.ts
import posthog from 'posthog-js';
import { EVENTS } from './events';

export function capture<K extends keyof typeof EVENTS>(
  name: K,
  payload: import('zod').infer<typeof EVENTS[K]['payload']>
): void {
  const def = EVENTS[name];
  if (def.phi) {
    const msg = `[analytics] PHI event "${name}" cannot be captured from browser. Route through Edge Function (_shared/posthog-server.ts).`;
    if (import.meta.env.DEV) throw new Error(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
    return;
  }
  posthog.capture(name as string, payload as Record<string, unknown>);
}
```

### Pattern 3: Server-side PostHog helper (Edge Function)

**What:** Lazy-init posthog-node client; `withContext` for distinct_id; `await client.shutdown()` before function return. Health-check pattern from v1.2 `[[reference_vendor_gated_send_health_check]]`.

**Example:**
```typescript
// supabase/functions/_shared/posthog-server.ts
import { PostHog } from 'npm:posthog-node@5.10.4';

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;
  const key = Deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) {
    console.warn('[posthog-server] POSTHOG_PROJECT_KEY missing — capture is a no-op.');
    return null;
  }
  _client = new PostHog(key, { host: Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com' });
  return _client;
}

export async function captureServer(args: {
  userId: string;           // Supabase auth.users.id
  event: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const c = getClient();
  if (!c) return;
  c.capture({ distinctId: args.userId, event: args.event, properties: args.properties });
}

export async function shutdownPostHog(): Promise<void> {
  if (!_client) return;
  try { await _client.shutdown(); } catch (e) { console.error('[posthog-server] shutdown failed', e); }
  _client = null;
}
```

Each Edge Function MUST wrap its handler in try/finally to call `shutdownPostHog()`.

### Pattern 4: Additive-only ESLint rule for event registry

**What:** Custom ESLint rule loaded via flat config; reads previous version of `events.ts` from git (`git show HEAD:src/lib/analytics/events.ts`), parses both with TS AST, compares per-event payload object literal keys + zod-schema member shapes; allows adding, blocks removal/type change.

**Implementation sketch:**
- Create `eslint-rules/additive-only-events.js` exporting an ESLint rule that runs in `Program:exit`.
- Use `child_process.execSync('git show HEAD:src/lib/analytics/events.ts')` (fallback to empty string when first commit).
- Parse both with `@typescript-eslint/parser`; compare event-by-event.
- Tests in `eslint-rules/__tests__/additive-only-events.test.js` using `RuleTester`.
- Wire in `eslint.config.js` with custom plugin definition.

### Pattern 5: PHI-event zone restriction

**What:** Use `eslint-plugin-import-x` `no-restricted-paths` to forbid `src/components/**` and `src/lib/!(analytics)**` from importing the PHI-flagged subset. Easier: keep PHI events in a separate `src/lib/analytics/events.phi.ts` and forbid client zones from importing it.

**Per `[[reference_eslint_import_x_path_gotcha]]`:** use glob targets, not bare file paths.

```javascript
// eslint.config.js excerpt
{
  rules: {
    'import-x/no-restricted-paths': ['error', {
      zones: [
        {
          target: ['src/components/**/*', 'src/main.tsx', 'src/App.tsx', 'src/lib/!(analytics)/**/*'],
          from: 'src/lib/analytics/events.phi.ts',
          message: 'PHI events must originate from Edge Functions; route through _shared/posthog-server.ts.',
        },
      ],
    }],
  },
}
```

### Pattern 6: Vite `manualChunks` deterministic naming

**Example:**
```typescript
// vite.config.ts — augment existing manualChunks
manualChunks: (id: string): string | undefined => {
  if (id.includes('src/components/admin/')) return 'admin-shell';
  if (id.includes('src/components/helpdesk/')) return 'helpdesk-widget';
  if (id.includes('src/lib/i18n/'))           return 'i18n-runtime';
  if (id.includes('src/lib/gamification/'))    return 'gamification-burst';
  if (id.includes('src/components/community/')) return 'community-feed';
  if (id.includes('src/components/course/'))   return 'course-player';
  // ... existing v1.2 returns
  return undefined;
},
output: {
  chunkFileNames: 'assets/[name]-[hash].js',  // deterministic name prefix
},
```

### Anti-Patterns to Avoid

- **DB-driven module registry** — `[[per CONTEXT.md D-01]]` rejected; breaks tree-shaking + runtime RLS chicken-and-egg.
- **Per-admin custom permission matrix** — anti-feature per research SUMMARY; D-04 honors.
- **Sending PHI properties to PostHog** — even from Edge Functions; D-13 keeps it to event names + Supabase uid only.
- **Skipping `await client.shutdown()`** — drops events silently; PITFALL surfaced in v1.3 research.
- **Trusting `posthog.isFeatureEnabled` without bootstrap** — first-paint flash; per D-02 requires bootstrapped flags.
- **Updating audit_logs to "fix" a wrong before-snapshot** — D-17 deny-update RLS prevents this; correct via NEW audit_log row.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TOTP enrollment + verification | Custom HMAC-SHA1 / Speakeasy from scratch | `supabase.auth.mfa.enroll/challenge/verify` | Official; integrates with `aal2`; QR-URI returned ready to render |
| Backup-code HMAC | Roll your own crypto | `crypto.subtle` Web Crypto API or `otplib` HMAC primitive | NEVER hand-roll crypto; use Web Crypto for HMAC-SHA256 |
| Event-property zod-to-JSON-schema | Hand-maintain JSON schema | `zod-to-json-schema` | Auto-syncs with TS types; single source of truth |
| Parquet writing in Edge Function | Manual binary encoding | `npm:duckdb` `COPY (...) TO STDOUT (FORMAT PARQUET)` | DuckDB handles compression + schema; Deno-compat |
| JSONB diff rendering | Manual diff algo | `jsondiffpatch` or simple recursive object-key diff | Library covers edge cases (arrays, nested obj, null vs missing) |
| Vercel Routing Middleware aal2 check | Custom server | Vercel `middleware.ts` + Supabase `auth.getUser()` + JWT `aal` claim | Standard Vercel pattern; same redirect API as v1.2 phase 12 firewall |

**Key insight:** Every primitive here has a battle-tested library or platform feature — custom implementations introduce HIPAA/compliance risk and bugs that lab-test environments miss.

## Common Pitfalls

### Pitfall 1: PostHog client not flushed in Edge Function
**What goes wrong:** Edge Function returns response, runtime shuts down before in-flight `capture()` HTTP requests complete; events lost.
**Why it happens:** Edge runtime kills the isolate immediately on response; `posthog-node` batches sends.
**How to avoid:** ALWAYS `await client.shutdown()` (or `flush()`) before function `return`. Wrap handler in `try { ... } finally { await shutdownPostHog(); }`.
**Warning signs:** Events present in dev (local Deno waits) but missing in production for the same code path.

### Pitfall 2: `manualChunks` receives CSS ids and trips bundle-size logic
**What goes wrong:** Bundle-budget script attributes a `.css` id to a JS chunk; sizes wrong.
**Why it happens:** Per existing `vite.config.ts:67` CSS-module guard, `manualChunks` is called for `.css` ids too.
**How to avoid:** Existing guard returns `undefined` for `.css` ids; carry forward when extending the `manualChunks` chain for the v1.3 ceilings.
**Warning signs:** Script reports a chunk size that exceeds raw `.js` byte sum.

### Pitfall 3: Bootstrapped feature flags missing on first paint
**What goes wrong:** Module hidden then flickers in after PostHog `/decide` response; user sees nav re-layout.
**Why it happens:** `isFeatureEnabled` defaults to `false` until first decide-response arrives.
**How to avoid:** Use PostHog `bootstrap: { featureFlags: {...} }` in init OR persist last-known flag values to localStorage and seed before first render.
**Warning signs:** Network tab shows `/decide` after first render; nav re-paints.

### Pitfall 4: Hash-hyphen bug in bundle-budget script
**What goes wrong:** Per `[[reference_bundle_budget_hash_hyphen]]`, contents-hash with hyphens fooled the v1.2 script.
**Why it happens:** Script used `awk -F'-'` to extract chunk name; hyphen in hash split wrong.
**How to avoid:** Already fixed in v1.2 Plan 10-11; CARRY FORWARD the regex (`^[a-z][a-z0-9-]*?-[a-f0-9]{8,}\\.js$` or similar — verify exact regex in `scripts/assert-clinic-bundle-budget.sh`). Add regression test `scripts/test-hash-hyphen-regression.sh` already exists; extend with per-chunk-ceiling cases.

### Pitfall 5: ESLint rule fires on every diff including unrelated changes
**What goes wrong:** Author edits a comment in `events.ts`; ESLint rule decides "changed" and fails.
**Why it happens:** Naive `git show` comparison + textual diff.
**How to avoid:** Parse both files into AST; compare only event-object-literal payload key sets + zod-schema member types. Whitespace + comments + reordering = no error.
**Warning signs:** PR feedback "ESLint failed on cosmetic edit."

### Pitfall 6: Audit log trigger fires under SECURITY DEFINER without `search_path`
**What goes wrong:** Per `[[reference_supabase_migration_gotchas]]`, SECURITY DEFINER funcs without `set search_path = extensions, public` can resolve to wrong schema.
**How to avoid:** Every SECURITY DEFINER fn: `set search_path = extensions, public, pg_temp;`.

### Pitfall 7: `service_role` deletes are allowed by default
**What goes wrong:** D-17 requires DENY for `service_role`. RLS deny clauses must explicitly include `service_role` because it bypasses RLS by default for grants.
**How to avoid:** REVOKE delete + update on `audit_logs` from `service_role` explicitly via grant statement in migration. Add a denylist test (cross-tenant impersonation per `[[reference_supabase_project]]`).
**Warning signs:** Test "service_role can DELETE from audit_logs" passes.

### Pitfall 8: Hard-cut 2FA on day-of-ship blocks all admins simultaneously
**What goes wrong:** Per D-06, no grace window; if all 2 staff have stale sessions, both locked at once.
**How to avoid:** Communicate cutover; staff enroll TOTP BEFORE deploy on their own time via a preview-env. Document in `STATE.md` operational runbook. NOT changing decision — recording mitigation.

### Pitfall 9: Migration filename letter-suffix silently skipped
**What goes wrong:** Per `[[reference_supabase_migration_filename_regex]]`, `<14digits>a_name.sql` is silently skipped by `supabase db push`.
**How to avoid:** Use 7-digit suffix scheme (`20260518000001` … `20260518000007`) — strict 14-digit-only timestamps. Grep `Skipping` after push.

### Pitfall 10: PostHog event-definitions API key in CI accidentally exposed
**What goes wrong:** API key leaks via CI logs.
**How to avoid:** Use `POSTHOG_PROJECT_API_KEY` as masked GitHub Actions secret; never `echo $POSTHOG_…`; script reads from env only.

## Code Examples

### Browser MFA enrollment + QR rendering

```typescript
// Source: Context7 /supabase/supabase (verified 2026-05-17)
const { data, error } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  issuer: 'LeanShot Admin',
  friendlyName: 'Authenticator',
});
if (error) throw error;
// data.totp.qr_code is an SVG URI — render as <img src={data.totp.qr_code} />
const factorId = data.id;

const challenge = await supabase.auth.mfa.challenge({ factorId });
const verify = await supabase.auth.mfa.verify({
  factorId,
  challengeId: challenge.data!.id,
  code: userEnteredOtp,
});
// On success, session is automatically upgraded to aal2.
```

### `aal2` RLS gate (matches D-09)

```sql
-- Use in policies on admin-action functions / sensitive tables (admin_backup_codes, etc.)
create policy "admin_only_with_aal2"
on admin_backup_codes for select
using (
  (select auth.jwt() ->> 'aal') = 'aal2'
  and (select admin_role from profiles where id = auth.uid()) is not null
);
```

### Vercel middleware aal2 + has_totp redirect

```typescript
// src/middleware.ts (or middleware.ts at repo root depending on Vercel pattern)
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export async function middleware(req: NextRequest) {
  // Skip the setup page itself + auth callback
  if (req.nextUrl.pathname.startsWith('/admin/setup-2fa')) return NextResponse.next();
  // Resolve Supabase session from cookies
  const { user, aal, has_totp } = await resolveAdminSession(req);
  if (!user) return NextResponse.redirect(new URL('/auth/sign-in?next=/admin', req.url));
  if (!has_totp) return NextResponse.redirect(new URL('/admin/setup-2fa', req.url));
  if (aal !== 'aal2') return NextResponse.redirect(new URL('/admin/step-up', req.url));
  return NextResponse.next();
}
```

(Note: LeanShot is a Vite SPA — there is no Next.js. Vercel Routing Middleware can ALSO run for SPAs via `vercel.json` rewrites + an Edge Function — choose the route-handler pattern that mirrors existing P12 firewall middleware in this repo. Concretely, look at `vercel.json` rewrites and the Phase 12 firewall pattern.)

### CI PostHog event-definitions sync

```typescript
// scripts/sync-posthog-event-defs.ts (run by GitHub Action on main deploy)
import { EVENTS } from '../src/lib/analytics/events';
import { zodToJsonSchema } from 'zod-to-json-schema';

const projectId = process.env.POSTHOG_PROJECT_ID!;
const apiKey = process.env.POSTHOG_PROJECT_API_KEY!;
const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

for (const [name, def] of Object.entries(EVENTS)) {
  const schema = zodToJsonSchema(def.payload);
  const res = await fetch(`${host}/api/projects/${projectId}/event_definitions/${encodeURIComponent(name)}/`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: def.description,
      tags: [def.phi ? 'phi' : 'non-phi', `version:${def.version}`],
      // PostHog REST shape — confirm at execution time
    }),
  });
  if (!res.ok) {
    console.error(`Event-def sync failed for ${name}: ${res.status} ${await res.text()}`);
    process.exit(1);  // hard-fail deploy per D-11
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-coded `ADMIN_NAV` array in `AdminLayout` (v1.2) | Manifest-driven `ADMIN_MODULES` + role + flag (v1.3 D-01..05) | This phase | Scales to 12+ modules; per-cohort module rollout via PostHog flags |
| `is_staff` single-bit role (v1.2) | 3-role ordinal (`staff`/`admin`/`superadmin`) (v1.3 D-04) | This phase | Differentiated access; backwards-compatible (existing `is_staff` users default to `admin` via migration) |
| No MFA on admin (v1.2) | TOTP `aal2` step-up + hard-cut middleware (v1.3 D-06..09) | This phase | HIPAA-grade admin posture |
| Per-feature ad-hoc events (v1.2) | Canonical event registry with zod + phi flag (v1.3 D-10..12) | This phase | Single source of truth; ESLint-enforced |
| Browser-only event capture (v1.2) | Browser + server-side Edge Function capture (v1.3 D-13) | This phase | Adblock-immune; uid-bridged identity |
| Single bundle ceiling (v1.2 50kB index) | Per-chunk ceilings (v1.3 D-18..20) | This phase | Catches localized regressions early |

**Deprecated/outdated:**
- v1.2 `ADMIN_NAV` array — refactored away by Phase 24.
- Direct `posthog.capture()` calls in app code — replaced by `src/lib/analytics/capture.ts` wrapper.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `zod` is already installed in repo (v1.2 uses zod for stripe-webhook payload validation) | Standard Stack | Low — planner adds `npm install zod` if missing |
| A2 | `duckdb` npm package works on Deno Edge runtime | Standard Stack | Medium — planner adds a Wave-1 Edge Fn smoke test that writes a tiny Parquet file before relying on it for archive cron |
| A3 | Vercel Routing Middleware can run for non-Next SPAs (LeanShot is Vite SPA) via P12 firewall pattern | Code Examples | Medium — planner references actual `vercel.json` rewrites + the P12 firewall middleware file in repo to mirror, not invent |
| A4 | PostHog REST `/api/projects/<id>/event_definitions/<name>/` accepts PATCH with tags + description | Code Examples | Low — exact shape confirmed at execution time via Context7; if shape differs, CI script's first run errors clearly |
| A5 | `posthog.identify(supabase_uid)` then `posthog.alias(anon_id, supabase_uid)` merges history exactly once per user | D-13 / Pattern 2 | Low — documented PostHog pattern; idempotent in modern PostHog |
| A6 | Existing v1.2 `is_staff` users will be migrated to `admin` role automatically on Phase 24 deploy | D-04 / Migration | Low — single UPDATE in admin_role-column migration; verifiable via post-migration probe |

## Open Questions

1. **Vercel Routing Middleware for Vite SPA — exact wiring**
   - What we know: v1.2 Phase 12 shipped a "two-tunnel firewall" middleware (memory `[[project_phase12_planning_complete]]`).
   - What's unclear: Whether to ship a single combined middleware adding the `/admin/*` aal2 + has_totp gate, or a new middleware file.
   - Recommendation: Planner read the P12 firewall file and ADD the gate inline if the existing middleware is small + same-deployment-boundary; otherwise create new sibling middleware file.

2. **TAXO-06 acceptance interpretation (CONTEXT.md D-10 reconciliation tension)**
   - What we know: REQ TAXO-06 wording suggests a "downgrade-map for stale clients"; D-10 chose additive-only which makes downgrade unnecessary.
   - What's unclear: Whether reviewer / verifier will accept "ESLint rule prevents breaking changes" as satisfying TAXO-06 spirit.
   - Recommendation: Planner adds an explicit `## TAXO-06 Reconciliation` section in `src/lib/analytics/events.ts` header comment AND in `06-PLAN.md` (or equivalent) `must_haves` referencing the decision. If verifier rejects, fall back to a `version: number` field + adapter — additive-only stays in place either way.

3. **PostHog event-definitions sync — what to do when sync fails on a non-main branch**
   - What we know: D-11 says "block the deploy" on main.
   - What's unclear: PR previews — should sync run there? Probably not (would race-clobber definitions across concurrent PRs).
   - Recommendation: CI step gated to `if github.ref == 'refs/heads/main'`.

4. **Backup-code primitive**
   - What we know: Supabase MFA provides `enroll` + `challenge` + `verify` but no documented native backup-code generation API as of 2026-05-17.
   - What's unclear: Whether to issue + store our own (10 codes HMAC-hashed) or rely on per-recovery superadmin reset only.
   - Recommendation: Ship our own backup-code table (`admin_backup_codes`) with `code_hash text not null, used_at timestamptz`. RLS gates: only `aal2` admin user can SELECT own codes (one-time display on enrollment); only superadmin RPC can mark consumed.

5. **Audit-log RLS deny-test for `service_role`** (per `[[feedback_realtime_layer_e2e_pattern]]`)
   - What we know: Memory rule: every RLS surface gets a live cross-tenant impersonation proof test.
   - What's unclear: Exact harness shape for proving service_role DENY (memory `[[reference_rls_fixture_gotruechient_flake]]` notes flake patterns).
   - Recommendation: Planner adds a vitest `audit_logs_rls.test.ts` that uses the project's existing RLS-fixture pattern + the new ES256-compat `admin.generateLink + /auth/v1/verify` path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + ESLint + scripts | ✓ | v22.18.0 (per CLAUDE.md) | — |
| Supabase CLI | Migrations + Edge Fn deploy | ✓ | already used in repo | — |
| Vercel CLI | Middleware deploy | ✓ | already used (per memory `[[reference_vercel_project]]`) | — |
| GitHub Actions | CI bundle assertion + PostHog sync | ✓ | per v1.2 convention | — |
| PostHog REST API | Event-definitions sync | ✓ (existing wired vendor) | — | Phase 24 sync uses standard API; works on any tier |
| Supabase Storage (private bucket) | Parquet cold archive | ✓ ready to provision | — | Bucket creation is a Wave-0 manual ops step |
| `pg_cron` extension | Nightly archive trigger | ✓ on Supabase Pro | — | — |
| `npm:duckdb` Deno-compat | Parquet writer | ✗ to verify | — | Wave-1 smoke test; if fails, alternative is Postgres `COPY ... CSV` + Edge Fn binary Parquet writer (last resort) |

**Missing dependencies with no fallback:** none — all critical pieces are available.
**Missing dependencies with fallback:** DuckDB Deno-compat (A2) — falls back to CSV archive + post-hoc Parquet conversion if needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (already configured in repo; `vitest/config` per `vite.config.ts:1`) |
| Config file | `vite.config.ts` (vitest extension) |
| Quick run command | `npm test -- src/lib/analytics src/lib/admin` |
| Full suite command | `npm test` |
| E2E (Playwright) | `e2e/` directory in repo — `npm run test:e2e -- admin-mfa.spec.ts` |
| Deno tests (Edge Fns) | per `[[reference_deno_test_discovery]]` — `supabase functions test` with `<name>.test.ts` naming |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Manifest renders 12 modules respecting role + flag | unit | `npm test -- src/lib/admin/modules.test.ts` | ❌ Wave 0 |
| ADMIN-01 | AdminShell hides modules when flag false / role insufficient | integration | `npm test -- src/components/admin/__tests__/AdminShell.test.tsx` | ❌ Wave 0 |
| ADMIN-02 | `audit_logs` RLS denies UPDATE + DELETE for all roles including service_role | integration | `npm test -- src/lib/admin/__tests__/audit-logs-rls.test.ts` | ❌ Wave 0 |
| ADMIN-02 | `log_admin_action` inserts row with before/after JSONB | integration | (same file) | ❌ Wave 0 |
| ADMIN-02 | PHI-table trigger captures INSERT/UPDATE/DELETE on `injections` | integration | `npm test -- src/lib/admin/__tests__/audit-trigger.test.ts` | ❌ Wave 0 |
| ADMIN-02 | Diff viewer renders before/after side-by-side | unit | `npm test -- src/components/admin/__tests__/AuditLogModule.test.tsx` | ❌ Wave 0 |
| ADMIN-03 | TOTP enrollment shows QR + writes backup codes hashed | e2e | `npm run test:e2e -- admin-mfa-enroll.spec.ts` | ❌ Wave 0 |
| ADMIN-03 | Middleware redirects unenrolled admin to `/admin/setup-2fa` | e2e | `npm run test:e2e -- admin-mfa-middleware.spec.ts` | ❌ Wave 0 |
| ADMIN-03 | `admin.reset_totp` RPC clears factor + emails enrollment URL + writes audit_log | integration | `npm test -- supabase/functions/admin-reset-totp/index.test.ts` | ❌ Wave 0 (Deno test) |
| TAXO-01 | events.ts registry compiles + zod schemas typecheck | unit | `npm test -- src/lib/analytics/events.test.ts` | ❌ Wave 0 |
| TAXO-01 | ESLint additive-only rule blocks payload field removal | unit | `npm test -- eslint-rules/__tests__/additive-only-events.test.js` | ❌ Wave 0 |
| TAXO-02 | `posthog-server.ts` lazy-init + shutdown works in Edge runtime | integration | `supabase functions test _shared/posthog-server.test.ts` | ❌ Wave 0 |
| TAXO-02 | stripe-webhook captures `payment.completed` server-side | integration | Existing webhook test + new assertion | partial |
| TAXO-04 | Browser `capture()` rejects PHI event in DEV (throws) | unit | `npm test -- src/lib/analytics/__tests__/capture.test.ts` | ❌ Wave 0 |
| TAXO-04 | ESLint `import-x/no-restricted-paths` blocks PHI event import in client zones | unit | `npm test -- src/lib/analytics/__tests__/phi-import-zone.test.ts` (snapshot of lint output) | ❌ Wave 0 |
| TAXO-06 | TAXO-06 reconciliation documented in events.ts header + 24-PLAN must_haves | docs/lint | Visual review + grep assertion in `scripts/check-taxo-06-reconciliation.sh` | ❌ Wave 0 |
| ADMIN-01..03 / TAXO-01..06 | Per-chunk bundle ceiling passes after admin shell + new modules ship | CI | `bash scripts/assert-bundle-budget.sh` | ❌ Wave 0 (extension) |

### Sampling Rate

- **Per task commit:** `npm test -- <affected file(s)>` + `npm run lint`
- **Per wave merge:** `npm test` + `npm run build` + `bash scripts/assert-bundle-budget.sh`
- **Phase gate:** Full vitest suite green + e2e admin-mfa specs green + RLS deny-test passes + bundle script passes + PostHog event-definitions sync dry-runs locally before main merge.

### Wave 0 Gaps

- [ ] `src/lib/analytics/events.ts` — registry source-of-truth
- [ ] `src/lib/analytics/capture.ts` — browser wrapper with PHI gate
- [ ] `src/lib/analytics/__tests__/capture.test.ts`
- [ ] `src/lib/analytics/__tests__/phi-import-zone.test.ts`
- [ ] `src/lib/analytics/events.test.ts`
- [ ] `src/lib/admin/modules.ts` + `modules.test.ts`
- [ ] `src/lib/admin/roles.ts`
- [ ] `src/components/admin/__tests__/AdminShell.test.tsx`
- [ ] `src/components/admin/__tests__/AuditLogModule.test.tsx`
- [ ] `src/lib/admin/__tests__/audit-logs-rls.test.ts`
- [ ] `src/lib/admin/__tests__/audit-trigger.test.ts`
- [ ] `supabase/functions/_shared/posthog-server.ts` + `posthog-server.test.ts`
- [ ] `supabase/functions/admin-reset-totp/index.ts` + `index.test.ts`
- [ ] `supabase/functions/audit-archive/index.ts` + `index.test.ts`
- [ ] `eslint-rules/additive-only-events.js` + `__tests__/additive-only-events.test.js`
- [ ] `scripts/sync-posthog-event-defs.ts`
- [ ] `scripts/assert-bundle-budget.sh` extension for the 6 new chunk ceilings
- [ ] `scripts/check-taxo-06-reconciliation.sh`
- [ ] `e2e/admin-mfa-enroll.spec.ts`, `e2e/admin-mfa-middleware.spec.ts`
- [ ] 7 SQL migrations under `supabase/migrations/` (admin_role enum, profiles.admin_role column, audit_logs table+RLS, log_admin_action function, PHI-table triggers, admin_backup_codes table, audit_archive cron)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth + MFA TOTP `mfa.enroll/challenge/verify` |
| V3 Session Management | yes | `aal2` step-up required for `/admin/*`; per-session re-prompt (D-09) |
| V4 Access Control | yes | 3-role ordinal model (D-04) + Pattern S1 dual-layer (D-03) + RLS deny-update/delete on `audit_logs` (D-17) |
| V5 Input Validation | yes | zod schemas for every event payload (D-10); typed PostHog REST sync; SQL parametrized through SECURITY DEFINER funcs |
| V6 Cryptography | yes | Backup-code HMAC via Web Crypto API; never hand-roll; TOTP itself handled by Supabase |
| V8 Data Protection | yes | PHI fence at event level (D-12); private Supabase Storage bucket for audit Parquet (D-16) |
| V9 Communications | yes | TLS everywhere (Supabase + Vercel + PostHog); no HTTP fallback |
| V10 Malicious Code | yes | Slopcheck on every new npm install; ESLint blocks PHI-event imports in client zones |
| V11 Business Logic | yes | Audit log captures all admin RPC calls (D-14); immutable RLS (D-17) |
| V14 Configuration | yes | All secrets via Supabase Function Secrets / GitHub Actions secrets / Vercel env; never in code |

### Known Threat Patterns for this Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin user without TOTP enrolled bypasses MFA | Spoofing | D-06 hard-cut middleware redirect; deny `/admin/*` if `has_totp=false` |
| Adblocker hides revenue events → wrong reporting | Information disclosure (negative) | D-13 server-side capture from Edge Fns for signup/payment/activation/refund |
| Admin tampers with audit_logs to hide actions | Tampering | D-17 RLS DENY update/delete for all roles incl. service_role; tamper-detection trigger on audit_logs itself |
| PHI leaks into analytics event payload | Information disclosure | D-12 PHI flag + browser-side rejection + ESLint zone restriction + Edge-Fn-only origination |
| Stale backup code reused | Elevation of privilege | `admin_backup_codes.used_at` enforces single-use; RLS denies reuse |
| TOTP factor reset bypass | Elevation of privilege | D-08 `admin.reset_totp` requires superadmin role; audit-logged; emails new enrollment link to target |
| Bundle bloat ships JS sidekick to PHI users | Performance / DoS via fat client | D-18..20 per-chunk hard-fail ceilings on every PR |
| ESLint rule disabled in line comment to skip additive-only check | Tampering with controls | Add CODEOWNERS entry on `events.ts` + `eslint-rules/` requiring 2 approvers (or @superadmin alias) |

## Sources

### Primary (HIGH confidence)
- Context7 `/posthog/posthog-js` (queried 2026-05-17) — `posthog-node` `capture`, `identify`, `groupIdentify`, `withContext`, `enterContext`, `shutdown` APIs; explicit shutdown-to-flush guidance.
- Context7 `/supabase/supabase` (queried 2026-05-17) — `auth.mfa.enroll/challenge/verify/listFactors` + `auth.jwt() ->> 'aal'` RLS policy pattern.
- `.planning/research/STACK.md` (v1.3 milestone-level research) — posthog-node@5.10.4 Deno-compat + `await client.shutdown()` rule.
- `.planning/research/PITFALLS.md` (v1.3) — PostHog/Sentry PHI fence + aal2 + bundle ceilings.
- Existing repo files — `src/components/admin/AdminLayout.tsx`, `vite.config.ts` (manualChunks pattern + CSS-id guard at line 67), `scripts/assert-clinic-bundle-budget.sh` (v1.2 hash-hyphen fix pattern).

### Secondary (MEDIUM confidence)
- WebSearch on PostHog event-definitions REST shape — not directly fetched at research time; planner should verify shape in Wave 1 before wiring CI script.
- `[[reference_supabase_migration_gotchas]]`, `[[reference_supabase_migration_filename_regex]]`, `[[reference_bundle_budget_hash_hyphen]]`, `[[reference_rls_fixture_gotruechient_flake]]`, `[[feedback_realtime_layer_e2e_pattern]]`, `[[reference_eslint_import_x_path_gotcha]]`, `[[reference_vendor_gated_send_health_check]]`, `[[reference_phase7_research_findings]]` — memory rules carried forward.

### Tertiary (LOW confidence)
- Backup-code primitive in Supabase MFA — explicitly not documented in fetched context. Recommendation: own the table.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Context7-verified posthog-node + Supabase MFA APIs; existing v1.2 patterns directly reusable.
- Architecture: HIGH — every component maps to an established v1.2 pattern (manualChunks, SECURITY DEFINER, sync-defer, Pattern S1 dual-layer).
- Pitfalls: HIGH — 10 documented; 8 from project memory + 2 from this research (additive-only ESLint false-positives; service_role explicit REVOKE).

**Research date:** 2026-05-17
**Valid until:** 2026-06-16 (PostHog SDK + Supabase MFA + Vite all stable; revisit if PostHog server-side API or Supabase MFA major-version changes)

## RESEARCH COMPLETE

**Phase:** 24 — Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog
**Confidence:** HIGH

### Key Findings
- All five CONTEXT.md workstreams (admin shell, 3-role+TOTP, event registry, server-side PostHog, audit log + Parquet, bundle ceilings) map cleanly to verified Supabase/PostHog APIs and existing v1.2 patterns; no novel infra needed.
- TAXO-06 D-10 reconciliation tension RESOLVES cleanly with additive-only-as-migration-tool framing; document explicitly in events.ts header + plan must_haves.
- 7 SQL migrations + 3 new Edge Functions + 2 new ESLint rule files + 1 CI script + 1 bundle-script extension required.
- One material assumption to verify in Wave 1: DuckDB Deno-compat (A2). Plan a smoke-test task before relying on it for the archive cron.
- Backup-code primitive is NOT in Supabase MFA SDK — own a small `admin_backup_codes` table with HMAC hashing.

### File Created
`.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Context7-verified + existing repo patterns |
| Architecture | HIGH | All maps to v1.2 patterns |
| Pitfalls | HIGH | 10 documented; 8 from project memory |

### Open Questions
- Vercel middleware exact wiring for Vite SPA (planner reads P12 firewall file).
- TAXO-06 acceptance treatment (reconcile in plan + events.ts header).
- PostHog event-definitions REST exact shape (planner verifies in Wave 1).
- Backup-code primitive source (planner owns the table).
- Service_role RLS deny-test harness (planner uses existing fixture pattern).

### Ready for Planning
Research complete. Planner can now create PLAN.md files.
