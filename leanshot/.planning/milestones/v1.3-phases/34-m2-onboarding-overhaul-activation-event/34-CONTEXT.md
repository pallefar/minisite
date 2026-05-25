# Phase 34: M2 Onboarding Overhaul + Activation Event - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite the consumer onboarding into an anonymous → activated funnel that is the new front door of LeanShot. Deliver:

1. Anonymous, cookie-keyed value-first dashboard preview that merges into the authenticated user on signup (no data loss).
2. Magic-link + Google + Apple OAuth signup (password optional everywhere); ≥44px mobile tap targets.
3. Goal-aware onboarding ending in a per-goal first-action surface that fires the activation event (LOCKED here; consumed by P36, P38, P39).
4. Admin drag-drop step builder (question-type palette MVP) + PostHog-driven A/B variants with a "Ship Winner" promote-to-version flow.
5. Per-step funnel analytics in the admin module (PostHog-sourced views / completions / drop-off / time-on-step).
6. Mobile Lighthouse ≥ 90 on `/onboard`.

**Out of scope (for this phase — explicitly deferred):**
- Caregiver/family-supporter data model (one user logging for someone else's body). See Deferred section.
- Native mobile-shell SSO (Apple Sign In with the iOS App Store entitlement) — v1.4 with the Capacitor mobile phase.
- Localized onboarding step copy beyond the i18n shim that Phase 32 already provides (no contractor-translated onboarding strings ship from this phase; carries with [[32-CARRY-OVER]]).

</domain>

<decisions>
## Implementation Decisions

### Activation Event (the LOCK consumed by P36/P38/P39)

- **D-01: Goal-dependent activation trigger.** Activation fires when the user completes the first action mapped to their stated goal — NOT a universal "first injection logged" trigger. Per-goal mapping in D-13.
- **D-02: 7-day activation window.** Activation only fires if the qualifying action lands within 7 days of `signup_completed`. After day 7, the user is bucketed as `never_activated_within_window` for downstream cohort treatment (esp. P39 paywall).
- **D-03: Single event name with property-bound shape.** Planner emits ONE event `activation_completed` carrying `{ goal_type, action_type, window_days: 7, days_since_signup, source: 'first_log' }`. Avoids 8 separate event names; lets P36/P38/P39 filter on properties.
- **D-04: Fire-once-per-user.** Activation event never re-fires for the same `user_id`, even if the user changes their goal later (see D-15). Downstream consumers (P39 paywall trigger, P36 review-prompt eligibility) can safely treat this as a monotonic milestone.
- **D-05: Server-side capture via Phase 24 D-13 path.** Event fires from the Edge Function that processes the first qualifying action insert (NOT browser-only, to survive adblockers per Phase 24 D-13). `posthog-node` is already wired with `await client.shutdown()` per the Phase 24 pattern.

### Anonymous → Authenticated Merge (ONBOARD-01/11)

- **D-06: Cookie-keyed `anonymous_sessions` table.** Cookie name + shape to be decided at plan-time (planner picks; `_ls_anon` recommended). Server-side row created on first preview-page hit; same row tracks subsequent activity until signup.
- **D-07: Multi-device race — RICHEST-DATA wins.** Server-side merge picks the anonymous row with the highest population score (count of non-null preference fields + count of draft entries). Deterministic, no user prompt. ROADMAP ONBOARD-11 satisfied.
- **D-08: Merge carries ALL four buckets:** (a) preferences (units / locale / theme / goal selection); (b) draft entries (weight log, dose plan, etc.); (c) PostHog telemetry alias (anonymous distinct_id → authenticated user_id); (d) affiliate `_aff` cookie / aff_code propagation per Phase 19 dual-cookie pattern.
- **D-09: 30-day TTL on orphan anonymous sessions.** Weekly `pg_cron` job deletes rows where `last_activity_at < now() - interval '30 days'` AND `merged_user_id IS NULL`. Aligns with data-minimization posture; longer than the 7-day activation window so a bookmarked preview isn't lost.
- **D-10: PII posture.** Draft entries in anonymous_sessions are NOT PHI yet (no medical record exists pre-signup), but body-weight + symptom drafts ARE sensitive. The row gets RLS deny-all from the anon role; only the merge Edge Function (service-role) reads + deletes. Sentry/PostHog masking lists already include weight + symptom fields per Phase 25.

### First-Action Surface Per Goal (ONBOARD-13)

- **D-11: 8-goal catalog.** Goal pick in onboarding selects from: `lose-weight`, `build-muscle`, `new-prescription`, `build-habit`, `doctor-monitored`, `family-supporter`, `manage-symptoms`, `track-with-vial-supply`. Single-select. Goal stored on `profiles.primary_goal` (new column).
- **D-12: Hybrid 3-card UI at onboarding end.** End-of-onboarding screen renders THREE first-action cards. The card mapped to the user's selected goal is visually emphasized (larger, primary color, "Recommended for your goal" badge). The other two are still clickable. Activation fires whichever the user picks (the action_type property captures which one).
- **D-13: Goal → first-action mapping:**

  | Goal | First action (recommended card) | Notes |
  |------|----------------------------------|-------|
  | lose-weight | First weight log | Most common — primary path |
  | build-muscle | First workout log | Pairs with weight log secondary |
  | new-prescription | First injection log | First-week cohort |
  | build-habit | Any qualifying action (weight, dose, symptom, workout) on day 2 of signup | Two-day persistence trigger |
  | doctor-monitored | Generate first share-link (Phase 8 doctor read-share) | Clinical-supervised tracking |
  | family-supporter | Configure supported-person profile | **Deferred shape — see Deferred Ideas** |
  | manage-symptoms | First symptom log | Side-effect-tracking primary |
  | track-with-vial-supply | Configure first vial | Operations-minded edge case |

  The non-recommended 2 cards shown alongside are the next 2 most-common actions for users in that goal cohort (planner picks deterministically — likely "log first injection" and "log first weight" as universal fallbacks).

- **D-14: Goal editable later in Settings.** Users can change `primary_goal` post-signup (recommender + content adapts).
- **D-15: Activation event NEVER re-fires.** If a user changes goal AFTER they've already activated, no second activation event. Cohort analytics remain monotonic.

### Step Builder + A/B Publish Mechanics (ONBOARD-07/08)

- **D-16: MVP scope — question-type palette + drag-reorder.** Admin drags from a fixed palette (text, single-select, multi-select, scale, weight, date, NPS, custom-component) into the step sequence. Live preview is a separate route, NOT a side-by-side WYSIWYG (defers ~2x scope). Branching = simple if-then routing on output values. Mirrors v1.2 Phase 15 page-builder palette pattern.
- **D-17: Ship-Winner = write-new-version + flip-flag.** Clicking "Ship Winner" creates a new `onboarding_flows` version (or `version_id` bump within the row) where the winning variant's config is copied as the new default, THEN flips the PostHog feature flag to 100% on the new version. Rollback = flag-flip back to the prior version. Mirrors v1.2 Phase 15 page-builder publish pattern.
- **D-18: Superadmin-only ship permission.** Onboarding flow changes affect 100% of signup traffic — highest blast radius. `surfaceCheck('onboarding.ship_winner')` gates only superadmin role. Standard admins can READ analytics and DRAFT variants but cannot promote. Uses existing `src/lib/org.ts` permission surface.
- **D-19: A/B default traffic split is 50/50; admin-overridable.** Drafting a new variant defaults to 50/50; admin may set custom splits (e.g., 90/10 canary). PostHog feature flag payload binds the variant_id.
- **D-20: A/B experiments require PostHog Experiment metadata.** Planner uses PostHog Experiments (not raw feature flags) so confidence intervals + sample-size guards surface natively in admin. (No min-sample-size code gate per D-18 — superadmin trusted judgment; PostHog UI shows the rigor signal.)

### Claude's Discretion

These were intentionally NOT discussed; planner has flexibility within these constraints:

- **Auth methods** — magic-link + Google OAuth + Apple OAuth are LOCKED by ROADMAP ONBOARD-02. Visual hierarchy on the signup screen, primary CTA prominence, mobile primitive choice — Claude's discretion. Apple Sign In in v1.3 is web-only; iOS App Store entitlement is a v1.4 mobile-shell concern.
- **Smart defaults (ONBOARD-04)** — Accept-Language for locale, IP for currency/timezone, profile for units. Conflict resolution: prefer profile > browser > IP. Geolocation prompt: NOT used (cost + privacy). VPN edge case: accept the IP miss; user can override in Settings.
- **Social proof (ONBOARD-12)** — live user counter source (suggest rolling 7d signups), 3 testimonial rotation cadence (suggest 30s), privacy-mode opt-out granularity (suggest single toggle in Settings). Planner picks; surfaces as PLAN content for plan-checker.
- **`anonymous_sessions` schema details** — column shapes, indexes, RLS exact predicates — planner picks (constrained by D-06..D-10).
- **Onboarding step copy** — strings in EN only this phase. Spanish content waits on [[32-CARRY-OVER]] contractor delivery.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 34: M2 Onboarding Overhaul + Activation Event" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS13 lines 163–176 — ONBOARD-01..13 verbatim

### Prior-phase load-bearing decisions
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` D-13 — server-side PostHog capture pattern (`posthog-node` + `await client.shutdown()`)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/` — `events.ts` event-registry shape that the activation event extends
- `.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/` — `org_onboarding_flows` schema + `useOrgOnboardingFlow()` render-branch hook + Plan 31-04/06 SUMMARYs (clinic-onboarding path that this phase complements, not replaces)
- `.planning/phases/19-*/` — affiliate `_aff` + `_aff_v` dual-cookie pattern (D-08 propagation)
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — Sentry mask + PostHog PII regex; D-10 applies to anonymous_sessions

### Codebase
- `leanshot/src/components/onboarding/OnboardingFlow.tsx` — existing consumer flow to be REWRITTEN (not added-alongside)
- `leanshot/src/lib/onboarding-builder/use-org-onboarding-flow.ts` — Phase 31 hook for clinic-invited path; remains source of truth for org-branch decision
- `leanshot/src/lib/analytics/events.ts` — `signup_started`, `signup_completed`, `activation_first_log` already declared (lines 57–124). Plan 34 extends/replaces `activation_first_log` with `activation_completed` (D-03).
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx` — existing `signInWithOtp` wiring for magic-link reference (line 207)
- `leanshot/src/lib/mfa/patient-mfa.ts` — magic-link email OTP flow already in production
- `leanshot/src/lib/org.ts` — `surfaceCheck()` permission surface for D-18 superadmin gate
- `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql` — JSONB step config + RLS pattern to mirror for `onboarding_flows` (consumer-side)

### Codebase maps
- `leanshot/.planning/codebase/ARCHITECTURE.md` — App.tsx view-selection + lazy boundaries
- `leanshot/.planning/codebase/CONVENTIONS.md` — naming + import-path patterns
- `leanshot/.planning/codebase/INTEGRATIONS.md` — Supabase + PostHog wiring conventions

### Memory pointers (project conventions planner MUST honor)
- [[reference_supabase_migration_filename_regex]] — `<14-digits>_name.sql` strict
- [[reference_supabase_migration_gotchas]] — SECDEF search_path, RLS deny patterns
- [[reference_supabase_auth_traps]] — magic-link redirect + free-tier 2/hr rate limit (e2e impact)
- [[feedback_planner_missed_status_enum_widening]] — if planner adds new status enum values, ship the CHECK widening migration in the same plan
- [[reference_supabase_functions_deploy_no_linked_flag]] — `supabase functions deploy` omits `--linked`
- [[reference_vite_static_env_inlining]] — no dynamic `import.meta.env[\`VITE_${x}\`]`
- [[feedback_planner_iter1_anti_patterns]] — 5 BLOCKER patterns to dodge

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `OnboardingFlow.tsx` already has step-state machine + DraftState + UnitToggle + ProgressIndicator — REWRITE keeps the primitives, replaces the static `DEFAULT_STEPS` with config-driven steps from `onboarding_flows.config` (mirroring Phase 31 org branch).
- `useOrgOnboardingFlow()` Phase 31 hook — extend to a sibling `useConsumerOnboardingFlow()` that loads the active `onboarding_flows` row (consumer flow, A/B-variant-resolved). Keep the org branch unchanged.
- `signInWithOtp` already wired in 2 places (ClinicInvitePage + patient-mfa); reuse for magic-link signup.
- `events.ts` event registry + `captureServer` Edge Fn helper from Phase 24 — extend with `activation_completed` event def.
- `surfaceCheck()` in `src/lib/org.ts` — add `onboarding.ship_winner` surface key for D-18.
- Affiliate `_aff` dual-cookie + Phase 19 attribution pattern — D-08(d) inherits directly.
- `org_onboarding_flows` table + JSONB-shape patterns from Plan 31-04 — copy structure to `onboarding_flows` (consumer-side).

### Established Patterns
- Lazy code-split per surface (App.tsx pattern); new `onboarding-preview` chunk for the anonymous value-first dashboard, lazy-loaded.
- Server-side PostHog capture via Edge Fn for all funnel events that adblockers eat (Phase 24 D-13).
- RLS deny + service-role-only access for cross-tenant tables (anonymous_sessions, onboarding_flows).
- A/B variants via PostHog Experiments + feature-flag payload binding (referenced by ONBOARD-08 + Phase 19 affiliate landing variant precedent).
- Status enum widening migration co-shipped with the plan that needs it (per [[feedback_planner_missed_status_enum_widening]] — if `profiles` or new tables add status fields, ship the CHECK widening in the SAME plan).

### Integration Points
- `App.tsx` — view selection between marketing / onboarding / dashboard switches based on auth + completed_onboarding_at. This phase extends the marketing → onboarding branch with the anonymous preview path.
- `profiles` table — adds `primary_goal` column (enum-constrained per D-11) + uses existing `completed_onboarding_at` as the merge-target flag.
- `_shared/posthog-server.ts` Edge Fn helper (Phase 24) — extended with `captureActivation()` wrapper.
- `useStore` (Zustand) — hydrates with merged authenticated state on signup; anonymous preview reads from anonymous_sessions Edge Fn, not the store.

</code_context>

<specifics>
## Specific Ideas

- The hybrid 3-card first-action UI (D-12) is a deliberate departure from "single CTA" minimalism — user wants the personalization signal (recommended card) without locking the user into one path. Visual pattern likely: 3-card grid on mobile (stacked), one with emphasized border + "Recommended for your goal" pill badge.
- "Ship Winner" naming is intentional — phase 15 page-builder used "Publish" verb; user chose explicit promotion language here. Planner: keep the literal label "Ship Winner".
- 8-goal catalog including `family-supporter` is a deliberate stretch — user explicitly chose the broader set. Caregiver-mode data shape is OUT OF SCOPE for this phase (see Deferred); the `family-supporter` goal card in v1.3 ships with a polite "Coming soon — we're building this" landing card as its first-action surface, with a waitlist signup. Activation event for `family-supporter` users still fires on any qualifying action (treats them as `build-habit` proxy until v1.4).

</specifics>

<deferred>
## Deferred Ideas

### Caregiver / family-supporter data model
Selecting `family-supporter` in the goal catalog (D-11) implies "one auth user logging on behalf of another person's body" — a substantial new data shape. **Deferred to a v1.4 follow-up phase (proposed: "Caregiver Mode").** This phase ships the goal CARD + a waitlist landing + activation-as-build-habit-proxy for these users; the actual supported-person profile + impersonation-aware data shape ships in a dedicated phase.

### Native mobile Apple Sign In (iOS App Store entitlement)
ONBOARD-02 ships web-only Apple OAuth. The native-app Apple Sign In entitlement + RevenueCat / Capacitor wiring ships with the v1.4 mobile-shell phase that deferred from v1.2 (Phase 16).

### Localized onboarding step copy (ES native content)
This phase ships EN onboarding copy only. ES content depends on Plan 32-06 contractor delivery (see `.planning/phases/32-spanish-i18n-parallel-with-clinic-track/32-CARRY-OVER.md`). The i18n shim is already wired so when contractor strings land, Spanish onboarding goes live without code changes.

### A/B experiment auto-stop on confidence-interval thresholds
D-20 surfaces PostHog Experiment metadata for the superadmin's judgment but does NOT auto-stop the experiment when significance lands. Could be a v1.4 polish — "auto-pause on 95% lift confidence" feature inside the admin onboarding builder. Deferred.

### Personalized recommended-card ordering via recommender (Phase 38)
The 2 non-recommended cards in the hybrid 3-card UI (D-12) are picked deterministically by the planner now. After Phase 38 ships the AI recommender, those 2 cards could be personalized per-user (e.g., based on cohort behavior). Deferred to a Phase 38 follow-up plan.

</deferred>

---

*Phase: 34-m2-onboarding-overhaul-activation-event*
*Context gathered: 2026-05-18*
