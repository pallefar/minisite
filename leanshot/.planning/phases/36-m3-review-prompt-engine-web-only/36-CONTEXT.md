# Phase 36: M3 Review Prompt Engine - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

**SCOPE NOTE:** ROADMAP labels this "Web Only" but user expanded scope during discuss-phase to include **scaffolding** for native App Store + Google Play review triggers that will fire in v1.4 when the Capacitor mobile shell ships. No native code in v1.3 — just the architecture lock-in (shared hook + plugin shim, server-side cooldown contract).

<domain>
## Phase Boundary

1. Internal 5★ NPS surface as INDEPENDENT mechanism — never gates any native rating fire (V13-3 BLOCKER enforced via ESLint AST rule + CI grep gate).
2. Admin rule-builder (single-condition rules: trigger event + optional cohort filter + cooldown check).
3. Cooldown enforcement: per-rule 30d minimum + global 60d/5-lifetime ceiling + 90d detractor-suppression after 1-2★ rating; lifetime caps never reset.
4. Promoter (4-5★) → immediate external-CTA opt-in modal (Trustpilot / G2 / Capterra; cohort-targeted).
5. Non-promoter (1-3★) → single open-text "What could we do better?" field → auto-create helpdesk ticket (P37 D-18 flow) with subject "Feedback from NPS rating".
6. Per-funnel dashboard with A/B variant breakdown (admin module).
7. PostHog A/B for trigger conditions / copy / CTA framings; Ship-Winner version flip per Phase 34/35 pattern.
8. **Scaffolding for native review triggers** — shared `useNativeReviewTrigger()` hook + Capacitor plugin web no-op shim; server-side cooldown table `native_review_prompts(user_id, platform, fired_at)`; v1.4 mobile shell drops in the real Capacitor plugin.

**Out of scope:**
- Live native fire on iOS/Android — deferred to v1.4 with the Capacitor mobile shell (Phase 16 carry-over).
- Trustpilot/G2/Capterra completion-confirmation polling — v1.3 tracks click-out only.
- 0-10 NPS scale — chose 5★ per ROADMAP literal.
- Multi-clause AND/OR rule composition — single-condition rules only in v1.3.
- Reset triggers for the 5-lifetime cap — never reset (most respectful).

</domain>

<decisions>
## Implementation Decisions

### Trigger Rule Semantics + V13-3 BLOCKER Lint (REVIEW-01/02)

- **D-01: Positive-engagement-only trigger whitelist.** Admissible trigger events: `activation_completed` (P34), `level_up` (P35), `streak_milestone_30d` / `streak_milestone_60d` / `streak_milestone_90d` (P35), `weekly_challenge_completed` (P35), `kb_article_helpful_voted` (P37). Admin can ADD events to the whitelist via a `nps_trigger_eligible` flag in `events.ts`; addition is audit-logged. Negative-state events (payment_failed, ticket_escalated, error_thrown) explicitly excluded.
- **D-02: Single-condition rules only.** Schema: `review_prompt_rules` row = 1 trigger event + nullable `cohort_id` filter + cooldown reference. Multiple rules can be simultaneously active; cross-rule cooldown logic is global (D-08). NO AND/OR multi-clause rule trees in v1.3 — covers 95% of targeting needs at a fraction of the complexity.
- **D-03: V13-3 lint = ESLint AST rule.** Custom ESLint rule in `leanshot/eslint-rules/no-conditional-native-review.cjs`:
  - Detects expressions referencing `navigator.requestReview` or Capacitor `Rating.request()` or `InAppReview.requestReview()`.
  - Flags as error if the call site also references any of: `nps_score`, `rating`, `review_state`, `is_promoter`, `is_detractor` (binding identifiers or member expressions).
  - Error message points to this CONTEXT.md D-03 entry.
- **D-04: AST rule + lightweight grep backup.** `scripts/check-no-conditional-native-review.sh` greps for string co-occurrence of `requestReview` + (`nps`|`rating`|`review_state`) within 10 lines, stripping comments per [[reference_grep_gate_comment_strip]]. CI runs both — AST is primary, grep is backup. False-positives go to admin/architecture review.

### Cooldown Rules + Suppression (REVIEW-03)

- **D-05: Hybrid cooldown — per-rule 30d minimum + global 60d/5-lifetime ceiling.**
  - Each individual rule: min 30d between fires for the same user.
  - Across ALL rules globally: min 60d between any NPS prompt fire AND lifetime cap of 5 total prompts.
  - Server enforces both at fire-decision time (Edge Fn checks `review_prompt_history` table before issuing).
- **D-06: Detractor suppression — 90d after 1-2★ rating.** User who rated 1-2★ has cooldown extended to 90d (vs default 30d/60d) before ANY further NPS prompt. Non-promoter routes to helpdesk so the feedback channel exists; no need to re-ask soon.
- **D-07: Lifetime cap is absolute — never reset.** Once a user hits 5 lifetime prompts, no further NPS prompts ever. Most respectful posture (matches the P35 ethical-only theme). No major-version-release reset, no admin manual reset.
- **D-08: Cooldown state is multi-device-respecting.** `review_prompt_history(user_id, fired_at, rule_id, surface_dismissed_at, rating_value)` keyed on user_id; cooldown check is server-side regardless of device. Avoids the "rate on phone, see prompt on web" race.

### NPS Rating UI + Feedback Form (REVIEW-04/05)

- **D-09: 5-star scale, modal sheet (mobile-first).** ROADMAP literal "4-5★". Modal/bottom-sheet at trigger event; dismiss-X visible. Backdrop dismiss = counts as "shown but unrated" (cooldown applied — uses one of the 5 lifetime quota slots).
- **D-10: Non-promoter (1-3★) feedback form = single open-text "What could we do better?".** One field; submit auto-creates helpdesk ticket via P37 D-18 inbound flow (server-side ticket insert; no email round-trip needed). Ticket subject: "Feedback from NPS rating"; body = open-text; tags = `nps-feedback` + auto-detected sentiment tag per P37 D-10.
- **D-11: Promoter (4-5★) flow — immediate external-CTA opt-in modal.** Right after rating: modal "Help others find LeanShot — takes 30s" with platform-specific CTA buttons. User can dismiss; dismiss counts as "rated but not redirected" (analytics).
- **D-12: Skip / dismiss UX — explicit close = cooldown counts.** Both modal dismiss-X and backdrop-click count as a fired prompt (toward cooldown + lifetime cap). Forces respect for the user's "I don't want to engage with this" signal.

### External CTA List + Redirect UX (REVIEW-04/08)

- **D-13: CTA catalog in v1.3 — Trustpilot + G2 + Capterra; native Apple/Google scaffolded for v1.4.** Schema: `review_cta_catalog(slug, display_name, url_pattern, requires_mobile_shell boolean default false, available_for_org_type)`. Apple App Store + Google Play rows exist with `requires_mobile_shell=true`; UI does not surface them in v1.3.
- **D-14: Per-cohort auto-targeting by primary_org_id.** Server-side resolution: user in a clinic org → Show G2 + Capterra CTAs (B2B). Consumer (no org) → Show Trustpilot (consumer). Mixed-membership users see the cohort-appropriate set. Falls back to Trustpilot if cohort lookup is ambiguous. Admin doesn't have to think about per-rule CTAs.
- **D-15: Attribution = redirect-out-only (track click, NOT completion).** PostHog event `external_review_clicked` fires on CTA button click with platform property. We don't track whether the user actually posted (no API polling, no self-reported follow-up — explicit deferral). Honest measurement; simpler implementation.
- **D-16: Trustpilot/G2/Capterra profile claim is a vendor pre-req.** Founder action: claim + verify the three profiles BEFORE Phase 36 ships (otherwise CTA buttons link to a non-existent page). Tracked as a HUMAN-UAT checkpoint in PLAN.md.

### Native Review Scaffolding (architecture lock-in for v1.4)

- **D-17: Native trigger events = SAME positive-engagement whitelist as web NPS (D-01).** Single source of truth for trigger eligibility. Native and web BOTH fire on the same admissible event set. UNCONDITIONAL — neither call gates on the user's prior NPS rating value (V13-3 absolutely enforced).
- **D-18: Server-side cooldown table `native_review_prompts(user_id, platform, fired_at)`.** Tracks each native-prompt fire request. Apple SKStoreReviewController caps 3x per rolling 365d per Apple's policy; Google In-App Review has its own quota. Server REFUSES to issue a fire request beyond the cap (no point sending to OS that will silently no-op). Cross-platform: iOS and Android tracked separately (a user on both gets separate quotas).
- **D-19: Web NPS lifetime quota (5 from D-05) is SEPARATE from native quota (3 per platform from Apple/Google policy).** A user can hit all of: 5 web NPS prompts + 3 iOS native + 3 Android native over their lifetime. Different surfaces; different quotas; both end-user-respectful.
- **D-20: Integration seam = shared `useNativeReviewTrigger()` hook + Capacitor plugin web no-op shim.**
  - v1.3: ships `leanshot/src/hooks/useNativeReviewTrigger.ts` with a web no-op implementation (`return { request: async () => false }`).
  - v1.3: ships `leanshot/src/lib/native/review-shim.ts` with the type contract that v1.4 will replace.
  - v1.3: the hook IS wired into the trigger-event handlers (via the existing event-emitter pattern from P24); the no-op makes it inert on web.
  - v1.4: the Capacitor mobile-shell phase replaces the shim with `@capacitor-community/in-app-review` integration. Hook usage doesn't change.
- **D-21: V13-3 lint covers the native shim too.** The `requestReview` AST detection includes the shim's `request()` method signature. Any future v1.4 wiring that conditions on rating will trip the lint at PR time.

### Claude's Discretion

- **Per-funnel dashboard layout (REVIEW-07).** Admin module `/admin/reviews/funnel`; reuses Phase 33 admin-CAC dashboard chart patterns; planner picks metric layout, time-window selector, A/B-variant filter UI.
- **PostHog A/B variant shape for trigger conditions + copy + CTA wording (REVIEW-06).** Mirrors Phase 34 D-20 + Phase 35 D-20 pattern (PostHog Experiments + Ship-Winner version flip). Planner picks A/B-table schema details.
- **Rule-builder admin UI.** Form-based (per the single-condition decision); planner picks input shape, event-picker UX, cohort-picker UX.
- **Modal vs bottom-sheet animation polish (framer-motion).** Planner picks `useReducedMotion`-respecting variants.

</decisions>

<canonical_refs>
## Canonical References

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 36: M3 Review Prompt Engine (Web Only)" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS15 lines 192–199 — REVIEW-01..08 verbatim

### Prior-phase load-bearing decisions
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-13 server PostHog; admin shell module pattern; events.ts schema
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-CONTEXT.md` — D-03 `activation_completed` event (primary trigger); D-20 PostHog Experiments + Ship-Winner pattern
- `.planning/phases/35-m3-gamification-engine/35-CONTEXT.md` — D-02 `level_up` event; D-07 streak milestone events; D-19 `weekly_challenge_completed`; D-20 PostHog Experiments
- `.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — D-15 ticket-create path (REVIEW-05 routes non-promoters here); D-10 sentiment tagging
- `.planning/phases/27-modular-admin-shell-extensions/` — admin shell module extension pattern
- Phase 16 (mobile-shell deferred) — D-20 references the v1.4 Capacitor integration target

### Codebase
- `leanshot/src/lib/analytics/events.ts` — extend with NPS events (`nps_prompt_shown`, `nps_rated`, `external_review_clicked`, `nps_feedback_submitted`); add `nps_trigger_eligible: boolean` flag on event registry entries
- `leanshot/eslint.config.js` — register new `no-conditional-native-review` AST rule (D-03)
- `leanshot/eslint-rules/no-conditional-native-review.cjs` — NEW rule implementation
- `leanshot/scripts/check-no-conditional-native-review.sh` — NEW grep backup (D-04)
- `leanshot/src/hooks/useNativeReviewTrigger.ts` — NEW hook (D-20)
- `leanshot/src/lib/native/review-shim.ts` — NEW shim (D-20)
- `leanshot/src/lib/org.ts` — `surfaceCheck()` for admin rule-builder gates
- `supabase/functions/_shared/email-router.ts` — feedback-form ticket creation reuses (P37)
- Phase 27 admin shell — new `/admin/reviews/*` module entry

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/STACK.md`

### Memory pointers
- [[reference_grep_gate_comment_strip]] — D-04 grep backup uses comment-strip
- [[reference_supabase_migration_filename_regex]]
- [[reference_supabase_migration_gotchas]]
- [[feedback_planner_missed_status_enum_widening]] — if `review_prompt_history` or rule tables add status enums
- [[feedback_planner_iter1_anti_patterns]]
- [[reference_eslint_import_x_path_gotcha]] — when registering the new AST rule

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- P37 D-15 ticket-create path — REVIEW-05 non-promoter feedback → ticket creation reuses this Edge Fn (no email round-trip).
- P34 `activation_completed` + P35 level/streak events — primary trigger events from D-01.
- PostHog Experiments + Ship-Winner pattern (P34 D-20 / P35 D-20) — REVIEW-06 mirrors directly.
- P27 admin shell module pattern + cohort builder — admin rule-builder UI extends.
- `useReducedMotion` hook — modal/sheet animations respect.
- framer-motion already in v1.2 — modal entry/exit animations.

### Established Patterns
- ESLint AST rules in `leanshot/eslint-rules/*.cjs` (precedent: Phase 24 `additive-only-events.cjs`, Phase 28 `no-raw-service-role-client.cjs`).
- CI grep gate pattern with comment-strip (Phase 32 `check-css-logical-properties.sh`).
- Server-side cooldown enforcement in Edge Fn before client-render decision.
- Append-only history tables (review_prompt_history mirrors v1.2 audit_logs / xp_ledger).
- ROADMAP-locked-then-scaffold pattern for deferred-mobile features (this CONTEXT establishes the v1.4 contract).

### Integration Points
- `App.tsx` — NPS modal renders at root; triggered by event listener subscribed to admissible events from D-01.
- Admin shell — new `/admin/reviews` module (rules + funnel dashboard + CTA-catalog management).
- Edge Fn `nps-trigger-decide` — receives event, evaluates active rules + cooldown, returns fire decision to client.
- Edge Fn `nps-feedback-submit` — creates ticket via P37 path on non-promoter submit.
- PostHog Experiments dashboard (admin sees external link).

</code_context>

<specifics>
## Specific Ideas

- The V13-3 BLOCKER (D-03 + D-04) is the load-bearing safety mechanism for this phase. Plan-checker must verify the AST rule covers the actual call surface (Capacitor plugin method name in v1.4 is `requestReview()` on `InAppReview` — confirm at v1.4 wiring time).
- The native scaffolding (D-17..D-21) is a deliberate architecture lock-in. The v1.4 mobile-shell phase will not need to re-decide WHICH events trigger, WHAT the cooldown contract is, or HOW the server tracks fires — those are settled here. v1.4 only writes the Capacitor plugin call site.
- Lifetime cap (D-07) is absolute. Resist temptation in future polish phases to add a "reset on tier change" mechanism — the explicit user direction is to respect attention budget.
- The cohort-targeting (D-14) assumes consumers route to Trustpilot; if Trustpilot profile setup blocks (vendor onboarding), planner can configure the fallback to a different consumer-CTA (e.g., Apple PWA Store reviews via PWA install path — but per D-13 that's flagged `requires_mobile_shell=true`, so realistic fallback is "no CTA shown for consumers until Trustpilot lands").

</specifics>

<deferred>
## Deferred Ideas

### Multi-clause AND/OR rule composition
v1.3 ships single-condition rules. AND-only or AND/OR composition deferred to v1.4 polish if admin demand surfaces. JSONB expression-tree schema already room for forward-compat.

### Native review fire on iOS/Android
v1.3 scaffolds; v1.4 mobile shell wires the actual Capacitor plugin call. CONTEXT D-17..D-21 is the contract.

### External review completion confirmation (Trustpilot/G2/Capterra API polling)
v1.3 tracks click-out only. API polling for posted-review confirmation deferred to v1.4. Self-reported follow-up explicitly rejected (attention-budget cost).

### 0-10 NPS scale alternative
Considered + rejected for v1.3 (chose 5★ per ROADMAP literal). Could revisit if industry-standard NPS calc becomes business need.

### Reset triggers for lifetime cap
Considered + rejected (D-07). Never reset is the user-respect posture.

### Admin sentiment-threshold UI on review feedback
Inherits from P37 D-11 — hardcoded thresholds in v1.3; admin UI is v1.4 polish.

### PWA store review (Apple PWA via Web Push delegation; Android TWA)
Considered + rejected as a v1.3 path. Native review ships via Capacitor in v1.4 (cleaner reach + better UX). PWA-only reviews not worth the marginal-reach engineering.

### Per-cohort CTA admin-override
v1.3 auto-targets by primary_org_id (D-14). Per-rule CTA whitelist deferred — admin can request later.

</deferred>

---

*Phase: 36-m3-review-prompt-engine-web-only*
*Context gathered: 2026-05-19*
