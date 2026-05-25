# Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 31 — White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder
**Areas discussed:** Role naming + matrix shape; Theme overlay scope + first-paint; Onboarding builder editable scope + block schema; Server-side role enforcement + invited-patient flow

---

## Area 1 — Role naming + matrix shape

### Q1.1 — Reconcile ROADMAP (owner/clinician/staff) vs P28 enum (admin/staff/viewer)

| Option | Description | Selected |
|---|---|---|
| Rename enum via migration | Single SoT; ROADMAP-aligned vocabulary forever. ALTER TYPE + ripple-rename across ~10 files. (Recommended) | ✓ |
| Keep enum, relabel in UI only | DB stays admin/staff/viewer; UI shows new labels. Zero migration; perpetual vocabulary fork. | |
| Extend enum, deprecate old values | Additive; lives in two-name limbo for a milestone. | |
| Add OWNER as a fourth role | Stripe-style billing/delete owner; admin/staff/viewer keep semantics. | |

### Q1.2 — Matrix source of truth + client/server sync

| Option | Description | Selected |
|---|---|---|
| DB SECDEF `has_permission()` SoT; TS const mirrors + sync test | Vitest queries DB for every pair and asserts equality. (Recommended) | ✓ |
| TS const generates DB function via codegen | One file → two artifacts. Build-time machinery. | |
| Postgres `role_permissions` table joined on every check | Most flexible; adds JOIN to every RLS. P28 explicit defer to v1.5. | |
| TS const only; per-action SECDEF inlines role gate | Simplest; duplicates checks across RPCs; drifts easily. | |

### Q1.3 — Permission key granularity

| Option | Description | Selected |
|---|---|---|
| Extend to ~12 keys, action-level | members.{invite,revoke,list,role.edit} + settings/branding/onboarding.edit + roster.{view,thresholds.edit} + alerts.{ack,snooze} + billing.view. (Recommended) | ✓ |
| Stay coarse at 6 keys; per-action gates inside SECDEF | Less ceremony, more drift surface. | |
| Resource.action namespaced (~15+ keys) | Fully RESTful; heavy for v1.3. | |
| Role-tier only (owner > clinician > staff) | Simplest; loses fine-grained distinctions for P30/P31. | |

### Q1.4 — Billing scope

| Option | Description | Selected |
|---|---|---|
| Owner-only for billing.view | Matches Stripe/Slack/Linear; clinicians don't see invoices. (Recommended) | ✓ |
| Owner + clinician can view (read-only) | Useful in small practices; more leakage. | |
| Defer billing.view to Phase 29 | Don't ship the key until billing UI lands. | |

---

## Area 2 — Theme overlay scope + first-paint

### Q2.1 — Editable token surface

| Option | Description | Selected |
|---|---|---|
| Brand-essentials ~10 tokens | logo+favicon+4 colors+radius scale+2 fonts+support_email. Bounded; safe. (Recommended) | ✓ |
| Color-only minimum ~5 tokens | Smallest; minimal differentiation. | |
| Full design-token map (~25+) | Power-user; high a11y risk; v1.5. | |
| Brand-essentials + arbitrary custom CSS escape hatch | XSS + CSS exfil risk; rejected. | |

### Q2.2 — A11y/contrast guards

| Option | Description | Selected |
|---|---|---|
| Server-side WCAG AA check in save SECDEF | Hard-block; structured error. (Recommended) | ✓ |
| Client-only warning, server saves anyway | Soft warning; clinic can ignore. | |
| Both: server hard-block + client live preview | Best UX + strongest guarantee; ~30% more code. | |
| No guards | Trust the clinic; bad for healthcare brand. | |

### Q2.3 — First-paint mechanism

| Option | Description | Selected |
|---|---|---|
| Public RPC + pre-mount fetch in main.tsx + localStorage cache | Mirrors applyThemeToDOM pattern; zero-FOUT on warm reload. (Recommended) | ✓ |
| Synchronous RPC in `<RouteOrgGuard>` | Visible FOUT on first visit. | |
| Pre-generated static manifest per clinic on Vercel | Lower DB load; cache-invalidation complexity. | |
| Vercel Edge inline `<style>` injection | True zero-FOUT; heaviest engineering. | |

### Q2.4 — Asset storage

| Option | Description | Selected |
|---|---|---|
| Supabase Storage public bucket `org-branding/{org_id}/` | Presigned upload SECDEF; format + size validation. (Recommended) | ✓ |
| External URL only (clinic hosts) | No hosting cost; mixed-content/CSP/slow-CDN risks. | |
| Both: upload OR paste URL | Most flexible; most edge cases. | |
| Inline data-URI in row | Bloats first-paint blob; discouraged. | |

---

## Area 3 — Onboarding builder: editable scope + block schema

### Q3.1 — What clinics can edit

| Option | Description | Selected |
|---|---|---|
| Curated step library + reorder + skip toggle + minor field edits | Protects activation funnel + Phase 34 event taxonomy. (Recommended) | ✓ |
| Free-form block builder | Breaks activation analytics; high support burden. | |
| Reorder + skip only (no editable text) | Too thin for B2B sales hook. | |
| Pre-built templates + minor edits | Zero composition; weak differentiation. | |

### Q3.2 — Replace or layer

| Option | Description | Selected |
|---|---|---|
| Replace entirely for invited patients | Single render path; org owns first impression. (Recommended) | ✓ |
| Layer: insert clinic steps before/after fixed core | Preserves funnel; awkward interleaving UX. | |
| Hybrid: org defines step list, locked steps auto-inserted | Schema is the user's flow, with guardrails. | |
| Defer to Phase 34 — ship 'coming soon' | Loses ORG-13 coverage for v1.3. | |

### Q3.3 — Schema reuse

| Option | Description | Selected |
|---|---|---|
| New OnboardingStepNode schema; reuse only dnd-kit reorder primitives | Right semantics; extract `SortableTreePanel<T>`. (Recommended) | ✓ |
| Reuse Phase 15 BlockNode as-is | Marketing-oriented; risk of marketing-side changes breaking onboarding. | |
| Extend BlockNode with onboarding variants | Couples two domains that evolve independently. | |
| No schema — ordered step ID array | Less expressive for custom content. | |

### Q3.4 — Storage

| Option | Description | Selected |
|---|---|---|
| New `org_onboarding_flows` table with version history | Append-only audit; rollback; one-active-per-org partial unique index. (Recommended) | ✓ |
| Single JSONB column on org_settings | No history; loses auditability. | |
| Two columns: active + drafts array | JSONB arrays awkward for diff/restore. | |
| Track via audit_logs only; latest in org_settings | Cheapest; manual restore. | |

---

## Area 4 — Server-side role enforcement + invited-patient flow

### Q4.1 — Server gate shape

| Option | Description | Selected |
|---|---|---|
| Per-action SECDEF RPCs calling has_permission() + log_admin_action | Type-safe; auditable; matches Phase 24/28 pattern. (Recommended) | ✓ |
| Per-permission RLS on org_branding / org_onboarding_flows | Skips RPC layer; loses audit + WCAG hook. | |
| Centralized SECDEF dispatcher `org_admin_action(p_action, p_payload)` | One audit hook; weaker type safety; jsonb everywhere. | |

### Q4.2 — Onboarding flow timing for invited patients

| Option | Description | Selected |
|---|---|---|
| First sign-in only; mark `completed_onboarding_at` | Standard 'onboarding is a setup ritual'. (Recommended) | ✓ |
| Every clinic visit until closed | Annoying; non-standard. | |
| First-time + clinic-flagged 'always-show' steps | Defer unless real use case. | |
| Replay full flow on version bump | Disruptive for patients mid-treatment. | |

### Q4.3 — Multi-clinic invites

| Option | Description | Selected |
|---|---|---|
| First-clinic-wins; subsequent invites silent-join | Account is set up once; clinic-specific branding via routes. (Recommended) | ✓ |
| Each clinic gets their own onboarding pass | Per-(user,org) tracking + fatigue. | |
| Patient picks which clinic's flow on second invite | Opt-in; more state. | |
| Out of scope — manual support | Hostile UX. | |

### Q4.4 — Admin-action notification scope

| Option | Description | Selected |
|---|---|---|
| Audit log only; no in-app notification in v1.3 | Reuses Phase 24 surface; tight P31 scope. (Recommended) | ✓ |
| Audit + realtime broadcast on org-{hmac8}-admin channel | Instant visibility; adds eng cost. | |
| Audit + Resend email to all org clinicians | Likely noisy; defer. | |
| Defer to Phase 37 helpdesk inbox | Coupled to unplanned phase. | |

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` §"Claude's Discretion" — researcher and planner have latitude on:
- `completed_onboarding_at` storage location (raw_user_meta_data vs user_profiles column)
- WCAG helper SQL placement (standalone function vs inline)
- Client-side live contrast meter (UX sugar; server hard-block is the contract)
- Exact `SortableTreePanel<T>` extraction shape
- Whether `BlockTreePanel.tsx` refactor is its own Plan 31-00b (zero-functional-change) or folded into Plan 31-04
- Whether `resolve_clinic_branding` RPC includes `clinic_name + logo_alt_text`
- Exact `oklch()` validation regex
- Whether intro_card images live in the `org-branding` bucket or a sibling `org-onboarding-assets` bucket

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` — full list includes subdomain white-label (v1.5), full design-token map (v1.5), custom CSS escape hatch (rejected), free-form input fields (rejected), pre-built templates, per-(user, org) onboarding completion tracking, second-clinic intro card surface, version-bump onboarding replay, realtime admin-action broadcasts, admin-action emails, Vercel Edge SSR brand injection, RBAC many-to-many tables, multi-hat role arrays, onboarding A/B per clinic, pre-publish patient preview, self-service font upload + CSP additions.
