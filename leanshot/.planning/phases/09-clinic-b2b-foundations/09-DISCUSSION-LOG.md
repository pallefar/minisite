# Phase 9: Clinic B2B Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 9-Clinic B2B Foundations
**Areas discussed:** Invitation primitive + Pitfall #8 matrix, Consent scope granularity, Roles, Operator UI surface, Revocation latency primitive, Storage RLS for clinic-scoped photos, Multi-org membership UX + switcher, Invitation email + expiry

---

## Invitation primitive + Pitfall #8 matrix

### Q1: How should the invitation flow work mechanically?

| Option | Description | Selected |
|--------|-------------|----------|
| Custom invites table + hashed token (Recommended) | New table: id, email, org_id, invited_by, invite_token_hash, consent_scope (jsonb), expires_at, accepted_at, rejected_at, consumed_at. Email contains magic-link with raw token; Edge Function at /clinic-invite/{accept,reject} validates hash and branches on auth.users existence. | ✓ |
| Supabase auth.admin.inviteUserByEmail only | Use Supabase's built-in invite API. Consent dialog has to live in a post-signup callback; existing-user handling is limited. | |
| Hybrid (Supabase for new users, custom for existing) | Two code paths; harder to satisfy Pitfall #8 matrix uniformly. | |

**User's choice:** Custom invites table + hashed token

### Q2: When the operator types an email to invite, should we check if an account already exists?

| Option | Description | Selected |
|--------|-------------|----------|
| No pre-check — branch on acceptance (Recommended) | Operator UI always says "Invite sent". Edge Function on acceptance does the auth.users lookup. Prevents email enumeration. | ✓ |
| Pre-check, mask the result | Server-side admin API lookup before sending invite; UI says "Invite sent" identically. Adds timing side channel. | |
| Pre-check, reveal to operator | Show "This patient already has a LeanShot account". Faster decision; explicit privacy regression. | |

**User's choice:** No pre-check — branch on acceptance

### Q3: How do we verify the 5-scenario Pitfall #8 matrix in CI?

| Option | Description | Selected |
|--------|-------------|----------|
| e2e tests + RLS impersonation tests (Recommended) | 5 Playwright e2e specs + pgTAP cross-tenant impersonation tests. Belt-and-suspenders. | ✓ |
| e2e only | 5 Playwright specs. Doesn't directly prove RLS surface safety. | |
| RLS impersonation only | Faster CI; doesn't catch UI / Edge Function logic bugs. | |

**User's choice:** e2e tests + RLS impersonation tests

---

## Consent scope granularity

### Q1: What shape should the consent scope take in the acceptance dialog?

| Option | Description | Selected |
|--------|-------------|----------|
| Granular per-data-type checkboxes (Recommended) | Checkboxes per data type; stored as jsonb on memberships. Matches PITFALLS Pitfall #8 explicit recommendation. | ✓ |
| Preset bundles (Basic / Full) | Two radio options; simpler UI; loses fine-grained patient control. | |
| All-or-nothing toggle | Single consent button. Worst privacy stance — flagged in Pitfall #8 warning signs. | |

**User's choice:** Granular per-data-type checkboxes

### Q2: Which data types should be exposable to clinics in Phase 9 MVP?

| Option | Description | Selected |
|--------|-------------|----------|
| Full set minus AI history + photos (Recommended) | Everything except AI history and photos. Lighter slice. | |
| Injections only | Mirror Phase 5; minimal. Reduces Pitfall #8 visible-scope guarantee. | |
| Full set including photos | Everything except AI history. Photos require new clinic-scoped signed-URL Edge Function. | ✓ |

**User's choice:** Full set including photos
**Notes:** Heavier slice — pulls clinic-scoped photo Edge Function into Phase 9. User pattern (end-user-investment) makes this consistent.

### Q3: Can the patient change the consent scope on an existing membership later?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, editable from Settings → Active organizations (Recommended) | Patient edits checkboxes; membership.consent_scope updates; operator's roster reflects on next poll. | ✓ |
| Scope frozen at acceptance; revoke + re-invite to change | Pushes patients toward "revoke and don't come back". | |

**User's choice:** Yes, editable from Settings → Active organizations

---

## Roles in Phase 9 MVP

### Q1: Should Phase 9 introduce roles, or defer everything to Phase 10?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer roles entirely — single implicit 'owner' (Recommended) | memberships.role exists; Phase 9 only writes 'owner' and 'patient'. Phase 10 introduces Owner/Coach/View-only. | |
| Introduce minimum Owner/Member split now | Adds RLS impersonation matrix rows; Phase 10 re-touches. | |
| Full Owner/Coach/View-only in Phase 9 | Phase 10 scope creep. ROADMAP keeps three-role requirement in Phase 10 explicitly. | |

**User's choice:** Other — "add as number 3 and allow the admin to add more roles"
**Notes:** User chose option 3 (full Owner/Coach/View-only) AND wants admin custom-role extensibility. Triggered follow-up.

### Q1-followup: Where does the admin add custom roles?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 9 ships fixed Owner/Coach/View-only; Phase 10 adds custom-role UI (Recommended) | Phase 9 introduces three named roles via a roles table seeded on org-create. Phase 10 adds custom-role admin UI. | |
| Phase 9 ships everything including custom-role admin UI | Schema + 3 default roles + admin UI + permission-jsonb RLS — all in Phase 9. Substantial scope shift. | ✓ |
| Defer it all to Phase 10 — single implicit role in Phase 9 | Original Phase 9 boundary. | |

**User's choice:** Phase 9 ships everything including custom-role admin UI
**Notes:** Triggers ROADMAP/REQUIREMENTS update for Phase 9 + Phase 10 entries before plan-phase.

---

## Operator UI surface

### Q1: Where should the operator land after creating their org, and where does 'Invite patient' live in Phase 9?

| Option | Description | Selected |
|--------|-------------|----------|
| Workspace home with roster shell + 'Invite patient' CTA (Recommended) | Lands at /clinic/{slug}; empty roster shell; "Invite patient" CTA opens modal. Phase 10 fills roster table. | ✓ |
| Settings panel only (no roster shell) | Lands at /clinic/{slug}/settings; harder to demo SC#1. | |
| Both — workspace home + settings panel | Mirrors typical SaaS shape; most surface area. | |

**User's choice:** Workspace home with roster shell + 'Invite patient' CTA
**Notes:** Note both workspace-home AND settings panel ship in this phase — settings tab houses the roles admin UI per D-07.

### Q2: What does the clinic-context bar minimally need to satisfy SC#1?

| Option | Description | Selected |
|--------|-------------|----------|
| Org name + logo + workspace switcher (Recommended) | Top bar; org name, logo, switcher dropdown. Switcher load-bearing for Pitfall #8 single-identity invariant. | ✓ |
| Org name only | Passes letter of SC#1, fails spirit. No switcher. | |

**User's choice:** Org name + logo + workspace switcher

---

## Revocation latency primitive

### Q1: How do we guarantee the operator sees the patient drop within 1 second of revoke (SC#5)?

| Option | Description | Selected |
|--------|-------------|----------|
| Realtime channel broadcast + per-request DB check (Recommended) | Two-layer: Realtime for UX, DB check for security floor. | ✓ |
| Per-request DB check only | Polls every N seconds; revoke takes up to N seconds to disappear from UI. | |
| Realtime only | Loses DB-is-source-of-truth floor; Realtime can desync. | |

**User's choice:** Realtime channel broadcast + per-request DB check

### Q2: What's the operator's drill-in failure mode when revoke happens mid-session?

| Option | Description | Selected |
|--------|-------------|----------|
| Hard 401 + toast "Patient X revoked access" + back to roster (Recommended) | No grace period; matches Phase 8 SC#3 semantics. | ✓ |
| Soft warning banner + 30s grace before redirect | Operator continues seeing data for 30s after revoke. Violates SC#5. | |
| Silent redirect with no notification | 404 page; cleanest patient-side privacy; worst operator UX. | |

**User's choice:** Hard 401 + toast "Patient X revoked access" + back to roster

---

## Storage RLS for clinic-scoped photo access

### Q1: How should operators get scoped read access to patient photos?

| Option | Description | Selected |
|--------|-------------|----------|
| Membership-scoped signed-URL Edge Function (Recommended) | New Edge Function GET /clinic/{orgId}/patient/{userId}/photo/{photoId} verifies membership + consent + permission, mints signed URL. | ✓ |
| Storage RLS policy that joins memberships + consent_scope | Direct Storage policy with JWT org_id claim. CDN cache makes revoke slow. | |
| Pre-computed snapshot signed URLs in a view | Batch-mint URLs per query. | |

**User's choice:** Membership-scoped signed-URL Edge Function

### Q2: What's the signed-URL lifetime for clinic-scoped photos?

| Option | Description | Selected |
|--------|-------------|----------|
| 30 seconds (Recommended) | Stale-URL window <= 30s; tightest security. | |
| 5 minutes | Friendlier for slow networks; stale-URL window 5 min. | ✓ |
| Per-request, no TTL (always re-mint) | Highest security; highest cost. | |

**User's choice:** 5 minutes
**Notes:** Tradeoff acknowledged — saved URLs (DevTools-copied) work for up to 5 min post-revoke. Document in security review when phase ships.

---

## Multi-org membership UX + identity switcher

### Q1: How does the identity switcher render when a user is both a patient and an operator?

| Option | Description | Selected |
|--------|-------------|----------|
| Single switcher grouping by relationship (Recommended) | Dropdown: Personal / Memberships / Workspaces I run. One auth.users → N contexts. | ✓ |
| Two separate switchers (patient + operator) | Avoids cross-role confusion; obscures single-identity invariant. | |
| Hide operator contexts in patient UI; hide patient context in operator UI | Strictest separation; hides multi-tenant nature from end users. | |

**User's choice:** Single switcher grouping by relationship

### Q2: Where does the patient see "who has my data right now"?

| Option | Description | Selected |
|--------|-------------|----------|
| Settings → Active organizations tab (Recommended) | Per-membership row with scope, role, revoke button. Mirrors Phase 8's Active-shares tab. | ✓ |
| Banner in main app shell | Highest visibility; banner fatigue. | |

**User's choice:** Settings → Active organizations tab

---

## Invitation email deliverability + expiry policy

### Q1: Which email service should send the invitation emails?

| Option | Description | Selected |
|--------|-------------|----------|
| Resend with branded template (Recommended) | Same Resend setup as Phase 7. Single stack to operate. | |
| Supabase Auth built-in templates | Restricts customization; ties tokens to Supabase Auth lifecycle. | |
| Both — Resend for branded copy + Supabase Auth for signup magic-link | Two emails per invite if patient is new; existing-user flow short-circuits when authenticated. | ✓ |

**User's choice:** Both — Resend for branded copy + Supabase Auth for signup magic-link
**Notes:** Planner specs the branching state machine: existing-logged-in, existing-logged-out, new-user.

### Q2: Invitation expiry window?

| Option | Description | Selected |
|--------|-------------|----------|
| 7 days (Recommended) | Balance between "not stale" and "patient had time". | ✓ |
| 24 hours | Tight; most patients won't act in a day. | |
| 30 days | Stale-invite attack surface. | |
| No expiry (manual revoke only) | Worst of both worlds. | |

**User's choice:** 7 days

### Q3: What happens after a patient accepts?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the invites row, set consumed_at + accepted_at, link to memberships.invited_from_invite_id (Recommended) | Audit trail for "how this membership was created"; snapshot consent at acceptance. | ✓ |
| Delete the invites row after acceptance — only keep memberships | Loses historical consent record. | |

**User's choice:** Keep the invites row, set consumed_at + accepted_at, link to memberships.invited_from_invite_id

---

## Claude's Discretion

- `orgs` table schema details (planner picks beyond load-bearing columns)
- Slug uniqueness + reserved-words blocklist
- MVP slice ordering across 10+ plans (planner SPIDRs)
- Org-deletion + operator-offboarding semantics (DEFERRED gray area)
- BAA/HIPAA disclosure language at consent (DEFERRED, counsel-led — `[COUNSEL REVIEW NEEDED]` marker)
- Realtime channel cost model for many-org tenants

## Deferred Ideas

- Roster ranking + drill-in (Phase 10)
- Operator audit-log surface (Phase 10)
- Doctor accounts (vNext / SHARE-V2-01)
- EHR integration (out of v1)
- Billing / seat scaffold (not v1)
- ROADMAP/REQUIREMENTS update required before plan-phase: Phase 9 entry absorbs CLINIC-04..07 role/permission scope; Phase 10 entry rewrites to roster + drill-in + operator audit-log surface.
