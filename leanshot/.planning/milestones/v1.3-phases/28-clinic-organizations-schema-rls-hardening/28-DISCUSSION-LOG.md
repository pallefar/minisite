# Phase 28: Clinic Organizations — Schema + RLS Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 28 — Clinic Organizations — Schema + RLS Hardening
**Areas discussed:** src/lib/org.ts vs clinic.ts, withOrgScope enforcement strictness, JWT propagation UX, /clinic/{slug} non-member routing, HMAC channel naming, org_members role shape, 16-table scope

---

## src/lib/org.ts vs existing clinic.ts

| Option | Description | Selected |
|--------|-------------|----------|
| Pure additive sibling (Recommended) | Create org.ts as org-context layer; clinic.ts unchanged; new file reads orgId from org.ts where appropriate. Smallest blast radius. | ✓ |
| Refactor clinic.ts to delegate | Modify every Phase 9 wrapper to call org.ts.getCurrentOrgId(); cleaner but bigger diff. | |
| Replace clinic.ts wholesale | Deprecate clinic.ts; all wrappers move into org.ts. Most disruptive. | |

**User's choice:** Pure additive sibling
**Notes:** Aligns with `[[reference_supabase_project]]` posture of preserving Phase 9 contracts and avoiding regression risk on already-shipped clinic surface. clinic.ts continues as the typed-RPC layer; org.ts owns context resolution + surface helpers + theme overlay.

---

## withOrgScope compile-time enforcement strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Layered: brand types + ESLint rule + runtime assert + Sentry (Recommended) | All three layers; aggressive-foundations posture; HIPAA stakes. | ✓ |
| Brand types + ESLint only | Compile + lint; no defense-in-depth against `as any`. | |
| Brand types only | Just TS brand; falls open against `as any` or lint-uncovered files. | |

**User's choice:** Layered enforcement (all four mechanisms)
**Notes:** Matches the established aggressive-foundations preference for infra/foundation phases and the HIPAA-regulator-class blast radius of a service_role bypass (V13-2 LANDMINE).

---

## JWT app_metadata.org_ids propagation UX (336ms window)

| Option | Description | Selected |
|--------|-------------|----------|
| Skeleton on roster + non-blocking workspace switcher banner (Recommended) | Existing Phase 9 skeleton + inline spinner in workspace switcher chip; no modal. | ✓ |
| Full-page 'switching workspace…' loading screen | Block whole app ~336ms with centered spinner + workspace name. | |
| Optimistic render + retry on first 401 | Render with new orgId immediately; retry once on 401. | |

**User's choice:** Skeleton + non-blocking spinner
**Notes:** Reuses existing UX vocabulary; respects multi-org clinicians (most-affected segment); no perceived-latency hit.

---

## /clinic/{slug} routing for non-members

| Option | Option Description | Selected |
|--------|-------------------|----------|
| Auto-detect pending org_invite — prompt accept; else 404 (Recommended) | resolve_clinic_slug RPC returns state; never leaks org existence to non-members. | ✓ |
| Public clinic landing if org.is_public_listing=true; else 404 | Opt-in marketing surface; expands attack surface. | |
| Redirect to default workspace silently | Cleanest security; confusing UX. | |

**User's choice:** Auto-detect invite, else generic 404
**Notes:** `is_public_listing` column reserved on `organizations` (D-15) so v1.4 can opt-in without a migration if clinic-acquisition ROI later justifies the surface.

---

## HMAC realtime channel naming

| Option | Description | Selected |
|--------|-------------|----------|
| org-{hmac8}-{table} ; HMAC(secret, org_id||table) ; secret in Vault (Recommended) | Single per-deployment secret; HMAC input deterministic; 32-bit truncated. | ✓ |
| Per-org HMAC secret (rotate-able) | Each org gets its own secret; allows per-tenant rotation; higher operational burden. | |
| Static org_id in name + auth callback membership check only | Plaintext channel name; leaks org_ids; defeats SC#4 intent. | |

**User's choice:** Single per-deployment secret in Vault
**Notes:** Per-org secret deferred to operational runbook; revisit if a specific clinic-key leak or enterprise rotation demand arises.

---

## org_members role shape (locks P31 RBAC)

| Option | Description | Selected |
|--------|-------------|----------|
| Single role enum('admin','staff','viewer') per member (Recommended) | One row per (user, org); permission matrix as const TS map in P31. | ✓ |
| Array of roles (text[]) per member | Multi-hat in single row; GIN index complexity; runtime ambiguity. | |
| Many-to-many member_roles + permissions tables | Full RBAC; +2 tables + 2 RLS policies + 2 test suites; overkill v1.3. | |

**User's choice:** Single role enum
**Notes:** Multi-hat users get multiple org_members rows (one per org). RBAC many-to-many deferred to v1.5 enterprise customization (per Phase 31 design intent).

---

## 16-table scope — which 8 downstream tables

| Option | Description | Selected |
|--------|-------------|----------|
| Ship 8 named tables now; defer 8 downstream to owning phases (Recommended) | P28 ships 8 named; downstream phases inherit the RLS template + cross-tenant test recipe via D-29 EXTENSION-CONTRACT.md. | ✓ |
| Lock all 16 schemas now (placeholders) | Pins shape forever; harder to walk back. | |
| Ship 8 + tightly-scoped extension contract doc | (Selected option implicitly includes this — the recommended choice ALSO ships D-29 EXTENSION-CONTRACT.md.) | |

**User's choice:** Ship 8 + extension contract (combines recommended + option 3 intent)
**Notes:** Faithful to phase boundary; smallest blast radius; downstream phases inherit a strict template via D-29 EXTENSION-CONTRACT.md owned by P28. Plan-checker for P29/P30/P31 reads this contract as mandatory input.

---

## Claude's Discretion

(See CONTEXT.md `<decisions>` §Claude's Discretion for the full list.) Summary:
- Custom ESLint rule AST-matching shape.
- supabase-js v2 query-builder interposition mechanism (Proxy vs prototype patch vs method override).
- Supabase trigger vs Custom Access Token Hook for JWT claim population.
- Raw secret vs per-session derived token from `get_realtime_channel_keying()`.
- RLS test file location convention (vitest vs Playwright).
- `_validate_consent_scope` re-use vs new org-scoped variant.
- pg_cron schedule for `org_invites` expiry purge (recommend 04:00 daily).

## Deferred Ideas

(See CONTEXT.md `<deferred>` section for full list.) Headline deferrals:
- Subdomain white-label `acme.leanshot.app` → v1.5.
- Public clinic-landing pages (is_public_listing opt-in) → v1.4.
- Per-org HMAC secret rotation → operational decision.
- RBAC many-to-many permissions tables → v1.5.
- Multi-hat role array → use multiple org_members rows instead.
- Stripe metered org_subscriptions writes → P29.
- Full org_branding theme tokens + onboarding builder → P31.
