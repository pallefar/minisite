# Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 24 — Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog
**Areas discussed:** Modular admin router, 2FA enrollment + grace, Event-taxonomy versioning, Audit log scope + retention, PostHog server-side distinct_id, Bundle-ceiling enforcement

---

## Modular Admin Router Shape

### Q1 — Module registry mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Manifest file (TS array) | `src/lib/admin/modules.ts` exports a const array. Type-safe, one file to grep, ESLint-enforceable shape. | ✓ |
| Self-registration (decorator-ish) | Each module file calls `registerAdminModule({...})` at import time via Vite glob-imports. No central file; risks tree-shaking. | |
| DB-driven registry | `admin_modules` table loaded on shell mount. Toggle without redeploy but adds runtime DB call + chicken-and-egg with RLS. | |

**User's choice:** Manifest file (TS array)
**Notes:** Picked the simplest, most explicit option. Matches research SUMMARY's "extends v1.2, no rewrite" posture.

### Q2 — Feature-flag source per module

| Option | Description | Selected |
|--------|-------------|----------|
| PostHog feature flag | `posthog.isFeatureEnabled(flagKey)`. Cohort + rollout-% support, no redeploy, free exposure events. | ✓ |
| Static env var per module | Zero runtime cost but requires redeploy. Useless for staged rollouts. | |
| Hybrid (PostHog + env-var kill-switch) | Default PostHog, env-var override for emergencies. | |
| DB column on profiles | Per-user override via JSONB. Heavier query path. | |

**User's choice:** PostHog feature flag
**Notes:** PostHog already in stack since v1.2; bootstrapped flags handle first-paint concern.

### Q3 — Route-gating enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Client guard + Edge Fn RPC re-check (Pattern S1) | UX + security layer separate. v1.2 standard. Defensive in depth. | ✓ |
| Edge Function middleware only | Single SoT but causes 200–500ms flash. | |
| Supabase RLS at table layer only | Cleanest but admin shell renders for non-staff; leaks module names. | |

**User's choice:** Pattern S1 dual-layer (v1.2 standard)
**Notes:** Carry forward of v1.2 Plan 22-06 pattern. AdminLayout already implements it.

### Q4 — Admin role model

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 3-role (staff / admin / superadmin) | `minRole` on each module entry. `profiles.admin_role` enum. Matches anti-feature line in SUMMARY. | ✓ |
| 3-role + per-module override list | Same 3 roles + per-user grants JSONB. Flexible without becoming a matrix. | |
| Keep v1.2's boolean `is_staff` | Defer roles until first concrete need. | |

**User's choice:** Fixed 3-role
**Notes:** Aggressive-foundations preference; aligns with audit-log + dangerous-actions needing tighter gating than baseline staff.

---

## 2FA Enrollment + Grace Policy

### Q5 — TOTP cutover for existing staff

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-cut at ship | First /admin/* request post-deploy → forced enrollment, block until done. | ✓ |
| 7-day grace + nag modal | Banner + post-login nag for 7 days, then hard-block. | |
| Hard-cut for /admin + 30-day grace for /clinic | Two policies by risk surface. | |

**User's choice:** Hard-cut at ship
**Notes:** Strongest HIPAA posture; small staff team makes communication easy.

### Q6 — Recovery / emergency-bypass path

| Option | Description | Selected |
|--------|-------------|----------|
| Backup codes + superadmin manual reset | 10 one-time codes; `admin.reset_totp` RPC; audit-logged. | ✓ |
| Backup codes + Supabase Auth admin override (no app UI) | Highest friction; harder to socially engineer. | |
| Backup codes + two-of-N superadmin approval | Defends against compromised superadmin; heavy at 2-staff size. | |

**User's choice:** Backup codes + superadmin manual reset
**Notes:** Operational reality of 2-staff team makes 2-of-N infeasible. Audit-log captures the reset event for tamper-detection.

### Q7 — Re-prompt cadence (trust-this-device)

| Option | Description | Selected |
|--------|-------------|----------|
| Every admin session (no trust cookie) | aal2 step-up per sign-in. HIPAA-friendly. 5–10s friction. | ✓ |
| 7-day trust cookie | httpOnly signed cookie; less friction; bigger attack window. | |
| Per-session + step-up only on sensitive actions | Granular; more wiring. | |

**User's choice:** Every admin session (no trust cookie)
**Notes:** Maximum defensibility for clinic-deal conversations.

---

## Event-Taxonomy Versioning + Migration Story

### Q8 — Breaking-change schema policy

| Option | Description | Selected |
|--------|-------------|----------|
| Additive-only, ESLint-enforced | Never break; new info = new optional field; lint blocks mutation. | ✓ |
| Bump event version + server-side downgrade adapter | `signup_v2` etc.; adapter normalizes old payloads. | |
| Parallel-emit both old + new for N days | Doubles event volume; no server adapter. | |

**User's choice:** Additive-only, ESLint-enforced
**Notes:** Researcher / planner to confirm TAXO-06 acceptance treats lint enforcement as satisfying the spirit. Flagged in D-10.

### Q9 — Registry source-of-truth shape

| Option | Description | Selected |
|--------|-------------|----------|
| TS file only, runtime-validated | zod parse client + server; PostHog UI is descriptive. | |
| TS file generates JSON schema, CI syncs to PostHog API | Upserts event definitions; tagged metadata in PostHog UI. | ✓ |
| TS file + per-event Markdown doc | Doc-as-code; PostHog UI stays bare. | |

**User's choice:** TS file + JSON schema + CI sync to PostHog API
**Notes:** Aggressive foundation — measurement integrity is load-bearing. Accept the extra CI dependency.

### Q10 — PHI gate at event level

| Option | Description | Selected |
|--------|-------------|----------|
| Event-level `phi:boolean`; PHI-true forbidden client-side | Hard separation; PHI events MUST originate from Edge Functions. | ✓ |
| Event-level `phi:boolean`; PHI-true proxied through Edge Fn | Browser sends; proxy scrubs. | |
| Field-level PHI on payload | Per-field annotation + scrubber. | |

**User's choice:** Event-level boolean, PHI-true forbidden client-side
**Notes:** Aligns with TAXO-04 mask-routes. Combined with `import-x/no-restricted-paths` for compile-time safety.

---

## Audit Log Scope + Retention

### Q11 — Mutation scope

| Option | Description | Selected |
|--------|-------------|----------|
| Admin actions only | Captured via explicit `log_admin_action()` calls. Smallest table. | |
| Admin actions + curated PHI-table list | Explicit logging + per-row triggers on ~15 PHI tables. Covers HIPAA "who touched PHI". | ✓ |
| Blanket trigger on every public-schema table | Auto-discover all tables. Biggest storage; needs exclusion list. | |

**User's choice:** Admin actions + curated PHI-table list
**Notes:** Curated list is reviewable + extensible at every phase that adds a PHI table.

### Q12 — Diff storage format

| Option | Description | Selected |
|--------|-------------|----------|
| Full before/after JSONB | Client-side diff render; simplest forensic. | ✓ |
| JSON-Patch (RFC 6902) only | 3–10× smaller; harder point-in-time queries. | |
| Full + computed JSON-Patch column | Belt + suspenders; double storage. | |

**User's choice:** Full before/after JSONB
**Notes:** Storage cost acceptable; query simplicity wins. JSON-Patch can be added later as computed column if needed.

### Q13 — Retention policy

| Option | Description | Selected |
|--------|-------------|----------|
| Hot 90 days + Parquet cold archive forever | Live table fast; nightly cron exports older rows to private Supabase Storage bucket. | ✓ |
| Hot forever (no archive) | Linear growth; needs partitioning. | |
| Hot 365 days + delete after 7 years | Single tier; no cross-tier query. | |

**User's choice:** Hot 90 days + Parquet cold archive forever
**Notes:** Meets HIPAA 7-year retention with manageable hot-table size. Bucket creation is a Wave-0 manual ops step.

---

## PostHog Server-side distinct_id Strategy

### Q14 — distinct_id resolution for Edge Function events

| Option | Description | Selected |
|--------|-------------|----------|
| Always Supabase auth.users.id; alias from browser | One identity; browser does `alias()` for pre-auth events. | ✓ |
| distinct_id from caller context only (webhook metadata) | No ghost persons but brittle for cron / admin / post-hoc fixes. | |
| Hybrid (caller-supplied preferred; fallback to supabase_uid) | Two debug paths; sometimes-alias. | |

**User's choice:** Always Supabase auth.uid + browser-side alias bridging
**Notes:** Predictable single source of identity. `await client.shutdown()` mandatory before Edge return.

---

## Bundle-Ceiling CI Enforcement

### Q15 — Failure mode on overage

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail CI on first overage | Consistent with v1.2 posture (Plan 10-11). | ✓ |
| Soft-warn 1 week, then hard-fail | Discovery window. | |
| Hard-fail on >100% AND warn at 80% | Runway warning. | |

**User's choice:** Hard-fail on first overage
**Notes:** Aggressive foundation; no soft window.

### Q16 — Chunk-name → file mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Vite `manualChunks()` deterministic name prefix | Greps `dist/assets/<name>-*.js` (v1.2 pattern). | ✓ |
| vite-plugin-bundle-analyzer JSON output | Portable; adds build-time dep. | |
| Generalized `assert-bundle-budget.sh` taking a ceilings map | Single script for clinic + v1.3. | |

**User's choice:** Vite `manualChunks()` deterministic name prefix
**Notes:** Extends v1.2 script directly; hash-hyphen bug already fixed.

---

## Claude's Discretion

The following are explicitly left to researcher / planner per CONTEXT.md `<decisions>` "Claude's Discretion" subsection:

- Exact SQL DDL for `admin_role` enum + `audit_logs` schema (follow v1.2 conventions).
- Custom ESLint rule implementation for additive-only event registry.
- zod-schema generation step (`ts-to-zod` vs hand-written).
- PostHog event-definitions API call shape (consult Context7).
- Pre-stubbing strategy for the 7 modules whose features ship in later phases (placeholder vs absent).

## Deferred Ideas

- Two-of-N TOTP reset approval flow (revisit at >5 staff).
- Per-sensitive-action step-up TOTP (revisit if every-session friction becomes drag).
- DB-driven `admin_modules` registry (revisit if non-engineering operators need toggle authority).
- JSON-Patch diff column on `audit_logs` (revisit if storage becomes real problem).
- Parquet archive data residency / cross-region replication (deferred to P25 HIPAA review).
- PostHog Boost tier decision (P25 vendor call).
- Per-clinic / org-scoped admin role gating (P28 + P31 scope).

