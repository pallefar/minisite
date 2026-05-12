# Phase 8: Doctor Read-Share - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Patient generates a time-bound share link from Settings, hands the link + a 6-digit access code to their doctor over a separate channel; the doctor opens the link in any browser, enters the code, sees a read-only view of the patient's data (drug-level chart, recent injections, symptoms, photos, weight, doctor report — NOT AI conversation history); the patient revokes anytime and the doctor's open page becomes unusable within seconds. All four revocation failure modes (token cache, HTTP cache, JWT TTL, forwarded link) are blocked by the architecture. Every doctor view is audit-logged and visible to the patient in Settings.

Phase 8 closes when:
- All 6 SHARE requirements (SHARE-01..06) shipped and verified against the live deployed app.
- The 4-failure-mode revocation drill runs green in CI.
- Settings → "Active shares" tab is functional and queries the audit log surface.

Out of scope (deferred): doctor accounts for repeat doctors (SHARE-V2-01), doctor annotations (SHARE-V2-02), clinic B2B (Phase 9-10).

</domain>

<decisions>
## Implementation Decisions

### Delivery architecture
- **D-01 (LOCKED, doctor-view delivery):** Same SPA + `/share/<token>` hash route + lazy `SharePage.tsx` component. Top-priority `selectView` branch in `App.tsx` parallel to the existing `'legal'` branch from 07-02. The share route loads its own snapshot via the share Edge Function — it does NOT touch the patient's Zustand store. Reuses the 22.55 kB index + lazy chart/DoctorReport chunks. Risk acknowledged: share-route bugs share the SPA's blast radius; mitigated by tight CSP on share routes and zero-store-access invariant.
  - **Rationale:** matches Phase 2's existing pattern; lowest dev cost; reuses chart/DoctorReport visualization stack. Separate subdomain considered but deferred until B2B Phase 9-10 (which may force the issue anyway).

### Revocation enforcement (SC#3)
- **D-02 (LOCKED, revocation primitive):** Every share-route request hits a Supabase Edge Function (modeled after `ai-chat`) that validates the JWT signature AND queries the `shares` table for `revoked_at IS NULL AND expires_at > now()`. Postgres is the single source of truth; JWT TTL is a fallback, not the primary gate. ~50-150ms latency overhead per request — acceptable for the read-share flow (no per-keystroke latency surface). SC#3 wording explicitly requires "DB-row-checked, not JWT-only", and this honors that verbatim.
  - **Failure-mode coverage:**
    - (a) Doctor's open tab returns 401 within seconds: each chart/symptom poll hits Edge Function → DB check → 401 on revoke
    - (b) `Cache-Control: private, no-store` on every share-route response: Edge Function sets header unconditionally
    - (c) JWT carries opaque `share_id` (not patient `user_id`): planner picks the JWT shape; share token resolves to share row server-side
    - (d) Forwarded link to a different recipient identifier fails: enforced by D-03's cookie binding

### Recipient binding (SC#6)
- **D-03 (LOCKED, recipient binding):** **6-digit access code is single-use → HttpOnly cookie set on first valid code entry.** Edge Function flow on first code entry: (1) validate `access_code_hash` against `shares.access_code_hash`, (2) mark code consumed (set `shares.code_consumed_at = now()`), (3) set `recipient_session` HttpOnly+Secure+SameSite=Strict cookie carrying a server-generated opaque token, (4) store the opaque token's hash in `shares.recipient_session_hash`. Subsequent share-route requests: Edge Function checks cookie hash matches `shares.recipient_session_hash`.
  - **Forward-the-link failure modes:**
    - Doctor forwards link before entering code → recipient hits code-entry screen, code already consumed → fails
    - Doctor forwards link after entering code → recipient has no cookie → fails (would need to re-enter code, already consumed)
    - Doctor copies the cookie too → SameSite=Strict + HttpOnly prevents this in practice; cookie hash is tied to `recipient_session_hash` which can be invalidated if needed
  - **UX:** Doctor enters code once per share-link; cookie persists for the share lifetime (until expiry or revoke). No per-poll re-prompts.
  - **Edge case:** Doctor clears cookies mid-session → must request new share from patient. Documented in user-facing copy.

### Audit log architecture (SHARE-05)
- **D-04 (LOCKED, share audit log):** Extend Phase 7's `audit_logs` table — add `actor_type` (enum: `'user'` | `'share_recipient'` | `'system'`) and `share_id` (nullable FK to new `shares` table). Doctor-view rows: `actor_type='share_recipient'`, `share_id=<uuid>`, `action='share_view'`, `user_id=<share owner>` (for RLS), `table_name='shares'`, `row_id=share_id`. Plus extra metadata columns: `recipient_ua_family`, `recipient_ip_family` (for Settings "Active shares" tab observability — not for binding; binding is D-03's cookie).
  - **Retention:** uses the existing Phase 7 D-04 retention cron (13 months for full per-write history; indefinite for skeleton subset). `share_view` rows are NOT skeleton — fall under the 13mo rolling window. If user-visible audit drift is a concern, planner can extend retention.
  - **Settings "Active shares" tab data source:** `SELECT count() + max(timestamp) FROM audit_logs WHERE actor_type='share_recipient' AND share_id IN (...patient's active shares) GROUP BY share_id`. Filtered by RLS (patient sees only their own rows, since `user_id=patient_id`).

### Claude's Discretion
- **`shares` table schema details** — planner picks columns beyond the load-bearing ones (`id`, `user_id`, `token_hash`, `access_code_hash`, `expires_at`, `revoked_at`, `code_consumed_at`, `recipient_session_hash`, `created_at`). Add `label` (e.g., "Dr. Smith — Q2 review") for patient self-service in the Active shares tab.
- **Edge Function shape** — planner picks. Modeled after `supabase/functions/ai-chat/` per memory. Endpoints: POST `/share/redeem` (code entry → cookie set), GET `/share/snapshot` (returns patient data, cache-controlled). Both require valid `recipient_session` cookie except `/redeem`.
- **Snapshot SQL view** — planner picks shape. SC#2 wants `aiHistory` "structurally excluded by the snapshot SQL view" — so a Postgres view `share_snapshot_view AS SELECT user_id, injections, weights, ... FROM <joined tables>` that does NOT join `ai_messages`. The Edge Function reads from this view. Snapshot must include the chart-overlaid disclaimer payload (Phase 3 PK-04 + reduced-motion-aware).
- **DoctorReport reuse for print mode (SC#5)** — `DoctorReport.tsx:40` already has `window.print()` + print stylesheet. Share view's print mode renders the same component with the share's snapshot data. Planner verifies the chart disclaimer survives print.
- **Active shares tab UX** — Claude's discretion on layout. Plan spec recommends: row per share with audience label, expiry, view count, last-viewed-at, IP family, UA family + one-click revoke button.
- **Revoke action latency** — SC#3 says "doctor's open tab returns 401 within seconds". With D-02's per-request DB check, revoke is effectively instant on the next poll. No client-side push needed (Realtime overkill for this surface).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 8 requirements
- `.planning/REQUIREMENTS.md` §"Doctor Read-Share" — full text of SHARE-01..06
- `.planning/ROADMAP.md` §"Phase 8: Doctor Read-Share" — 5 success criteria
- `.planning/REQUIREMENTS.md` §"Out of Scope" lines 137-143 — doctor accounts deferred to v2, no EHR integration

### Phase 7 carry-forward (load-bearing for D-04 audit-log extension + D-02 Edge Function pattern)
- `leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/07-CONTEXT.md` D-04 — `audit_logs` schema, retention cron, RLS pattern
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000001_audit_logs.sql` — base schema (columns + RLS)
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000002_audit_triggers.sql` — SECURITY DEFINER trigger pattern
- `/Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — GUC bypass pattern (D-04 share_view rows write directly, not via trigger; this matters for the suppress-guc interaction)
- `leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/07-07-PLAN.md` — Edge Function + plpgsql RPC pattern that 08-share follows

### Earlier carry-forwards
- `leanshot/.planning/phases/06-patient-cloud-sync-slice-2-full-data-migration-photos/06-CONTEXT.md` D-07 — photo Storage signed URL pattern (doctor view needs signed URLs for photos)
- `leanshot/.planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md` PK-04 — chart-overlaid "estimate, not measured" disclaimer must survive print in doctor view
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx` — print stylesheet + `window.print()` (SC#5 reuse point)
- `leanshot/src/components/dashboard/charts/MedLevelChart.tsx:192` — chart aria-label with disclaimer language
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx` — extension point for "Active shares" tab (sibling to Phase 7's Privacy + Recovery + Data sections)

### Supabase patterns
- `leanshot/supabase/functions/ai-chat/` — Edge Function template (auth header, rate-limit, structured response, CORS)
- `reference_supabase_migration_gotchas.md` (memory) — IMMUTABLE constraint + `extensions` search_path + Storage delete bypass + audit GUC suppression — apply preventively to new migrations
- `reference_supabase_project.md` (memory) — every NEW RLS surface gets a live cross-tenant impersonation proof test (applies to `shares` table)

### Plan 07-02c carry-forward (NOT folded into Phase 8 — keep separate)
- `leanshot/.planning/deferred-tests.md` — 6 e2e specs still test.fixme'd pending RC5 remediation. Plan 07-02c queued for milestone-close. Phase 8 plans MUST NOT introduce new specs that share the RC5 cold-CI Realtime cluster (no two-context Realtime polling tests in 08 plans without RC5 fixed first).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`audit_logs` table + trigger pattern** — extending with 2 new columns (`actor_type`, `share_id`) is the natural fit; reuses existing RLS + retention.
- **`DoctorReport.tsx` + print stylesheet** — share view's print mode renders this component verbatim with snapshot data.
- **`MedLevelChart.tsx` with disclaimer overlay** — share view's chart reuses this; disclaimer survives print automatically per Phase 3 PK-04.
- **`SettingsPage.tsx` nav array (lines 61-70)** — add `{ id: 'shares', label: 'Active shares', Icon: ... }` between Privacy and Recovery. Section component pattern is well-established.
- **`supabase/functions/ai-chat/`** — Edge Function template (CORS, header parsing, error shape, refusal hook). 08-share Edge Function mirrors this.
- **`Modal.tsx` + `Input.tsx`** — typed-confirm modal pattern (used in 07-07 DeleteAccountModal) — works for "Create share link" + "Revoke share" confirmations.
- **Photo Storage signed URL pattern from 06-04** — Edge Function mints signed URLs server-side for the share's photos; doctor never sees user's raw Storage keys.

### Established Patterns
- **No router** — view selection via `selectView` in App.tsx (the `'legal'` branch from 07-02 + `'auth'` from Phase 5 + `'marketing'`/`'onboarding'`/`'dashboard'` from origins). `'share'` branch is highest-priority (above `'auth'` so anonymous doctors can reach it).
- **`s.user!` is forbidden** (Phase 6 D-12 + Phase 7 D-06 sweep). Share route doesn't access `s.user` at all — it has its own snapshot store/state.
- **Bundle-size ceiling** — index 22.55 kB gz, 50 kB ceiling. SharePage must be lazy-chunked (no static import in `main.tsx` or `App.tsx`).
- **RLS proof rule** — `shares` table needs `e2e/rls-shares.test.ts` proving cross-tenant isolation. Extension to `audit_logs` (new columns) does NOT need new proof — existing `e2e/rls-audit-logs.test.ts` covers the table.

### Integration Points
- **`audit_logs` table extension** — 2 new columns require a schema migration. Trigger function `audit_trigger()` does NOT auto-populate `actor_type` or `share_id` (those are share-route-specific). Share Edge Function inserts `audit_logs` rows directly via SECURITY DEFINER `log_share_view(share_id, ua_family, ip_family)` RPC. The existing `app.suppress_audit` GUC mechanism does NOT apply (share_view rows are written directly, not via trigger).
- **`shares` table (new)** — needs RLS (owner sees own rows; share_recipient role accesses via Edge Function only). Cross-tenant impersonation proof per project rule.
- **`SharePage.tsx` lazy chunk** — `App.tsx` `selectView` adds `'share'` branch; SharePage fetches snapshot via share Edge Function. Renders chart + DoctorReport components.
- **Settings "Active shares" tab** — new Section in `SettingsPage.tsx` between Privacy and Recovery. Queries `audit_logs` + `shares` via Supabase client. Includes create-share modal + revoke buttons.

</code_context>

<specifics>
## Specific Ideas

- **Mental model: "patient is the credential issuer"** — the patient creates the share, generates the 6-digit code, and revokes whenever. There's no doctor-side identity (deferred to V2). All trust flows through the patient's actions.
- **6-digit code threat model** — assume the link itself is leaked (email/SMS forwarded). The 6-digit code is the ONE secret that's transmitted out-of-band. Single-use consumption (D-03) means even an attacker who has the link must intercept the code before the doctor uses it — narrow window. Brute-force protection: rate-limit code attempts to 5/min per share row.
- **Settings "Active shares" copy** — borrow tone from the Phase 7 Privacy section: explicit about "what the doctor can see" (list categories) + "what they cannot see" ("AI coach conversations are never included"). Reinforces SC#3's privacy guarantee for the patient.
- **Share-row lifetime** — patient picks expiry from a fixed list (24h / 7d / 30d, or "until I revoke"). Planner's call on the UX. NEVER an unlimited share.

</specifics>

<deferred>
## Deferred Ideas

- **Doctor accounts (SHARE-V2-01)** — repeat doctors get a lightweight account. v2 concern; explicitly out of v1 scope per ROADMAP.
- **Doctor annotations (SHARE-V2-02)** — read-only stays read-only in v1. v2 concern.
- **Realtime push for revocation** — D-02's per-request DB check is good enough; Supabase Realtime channel to the doctor's tab for instant invalidation is over-engineering at v1 patient-count scale.
- **Plan 07-02c cleanup** — kept separate from Phase 8. Plan 07-02c will: remove VITE_E2E debug seams in `App.tsx` + `store.ts`, delete `e2e/diagnostic-post-signin-view.spec.ts`, raise timeouts + add `afterEach removeAllChannels()` to fix RC5 budget/contamination, re-enable 6 deferred e2e specs. Run BEFORE milestone close; Phase 8 plans shouldn't introduce new two-context Realtime polling specs that would hit RC5.
- **Print stylesheet enhancement** — `DoctorReport.tsx` print already works. If doctors complain about specific print quirks (page breaks, chart sizing), batch into a milestone-close polish pass.
- **Patient notification on doctor view** — "Dr. Smith viewed your share at 2:34pm" toast/email. v2 concern.
- **Share-link rate-limit per patient** — limit how many active shares a patient can have at once (e.g., 10). v2; not load-bearing for v1.

</deferred>

---

*Phase: 08-doctor-read-share*
*Context gathered: 2026-05-12*
