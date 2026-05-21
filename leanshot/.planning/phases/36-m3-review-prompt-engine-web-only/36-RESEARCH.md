# Phase 36: M3 Review Prompt Engine (Web Only) — Research

**Researched:** 2026-05-21
**Domain:** NPS prompt engine + V13-3 BLOCKER lint + server-side cooldown + admin module + native-review scaffolding
**Confidence:** HIGH

## Summary

Phase 36 ships an internal 5★ NPS surface that fires deterministically (server-side cooldown), routes promoters to external CTAs (Trustpilot / G2 / Capterra) and non-promoters into the P37 helpdesk via the existing `create_ticket_with_first_message` SECDEF RPC, and adds a new `growth/reviews` admin module that replaces the placeholder at `src/lib/admin/modules.ts:139`. It also lays down a `useNativeReviewTrigger()` shim + cooldown table that v1.4's Capacitor mobile-shell will consume without re-deciding any contracts.

**Critical pre-existing infrastructure** — almost every load-bearing primitive Phase 36 needs is already shipped:
- `eslint-rules/no-conditional-native-review.cjs` already exists (Phase 42 D-20 shipped it pre-emptively with the P36 call-name targets `requestReview / showReviewPrompt / triggerReviewPrompt` — DO NOT re-create; the rule's docblock explicitly addresses Phase 36 executors).
- `create_ticket_with_first_message(p_subject, p_body, p_priority)` SECDEF RPC ships in `20270707000009_helpdesk_create_ticket_rpc.sql` and the `cancellation-feedback-to-ticket` Edge Fn proves the call-shape pattern (forward user JWT — NOT service-role — per Pitfall 4).
- `ship-winner-flag` Edge Fn ships at `supabase/functions/ship-winner-flag/index.ts` + the `OnboardingABPanel.tsx` client contract is the literal reuse target for Surface E (`data-action="ship-winner"`, `flag_id + variant` body).
- `captureServer()` + `events_mirror` dual-write live in `supabase/functions/_shared/posthog-server.ts`.
- Admin shell already supports prefix-branch routing (`pathname.startsWith('/admin/${m.route}/')` per `AdminShell.tsx:124`); registering a single `reviews` module entry resolves all `/admin/reviews/*` sub-routes.

**Primary recommendation:** **5 waves, 13-15 plans.** Reuse all existing primitives — DO NOT re-create the ESLint rule, ticket-create RPC, ship-winner Fn, or admin shell routing. Two genuine net-new builds: (1) `nps-trigger-decide` Edge Fn (server-side cooldown enforcement) and (2) the `growth/reviews` admin module (rule-builder + funnel dashboard + CTA catalog + variant grid). Net-new schema is 4 tables (`review_prompt_rules`, `review_prompt_history`, `native_review_prompts`, `review_cta_catalog`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trigger event detection ("did `level_up` fire for this user?") | Browser (event listener) | API (events_mirror read fallback) | Phase 24 P24 event-emitter pattern already lives on the client; client emits, server caches via captureServer dual-write |
| Cooldown decision (fire / suppress) | API (Edge Fn `nps-trigger-decide`) | Database (SECDEF RPC) | Decision is multi-device-respecting per D-08 — MUST run server-side. Client never trusts itself for cap enforcement. |
| Rule storage + admin CRUD | Database (`review_prompt_rules` + SECDEF RPCs) | Admin UI | Single source of truth; SECDEF re-checks admin_role beyond client `surfaceCheck` (Pattern S1 dual-layer) |
| Fire-history append | Database (`review_prompt_history`) | API (Edge Fn writes on decision) | Append-only audit table; service-role writes from Edge Fn; user-scoped read for own history |
| Modal render (Surface A/B/C) | Browser | — | Pure consumer UI; modal mounts at App root per LevelUpBurst precedent |
| Helpdesk ticket creation on detractor submit | API (Edge Fn `nps-feedback-submit` → `create_ticket_with_first_message` SECDEF RPC) | — | RPC references `auth.uid()` — Edge Fn MUST forward user JWT (Pitfall 4 in cancellation-feedback-to-ticket precedent) |
| External CTA click tracking | Browser (captureServer is server-only; client-side `posthog.capture` for `external_review_clicked`) | — | Click-out only; no completion polling per D-15 |
| Per-funnel dashboard query | API (read RPCs over `review_prompt_history` + events_mirror) | Database (SECDEF RPC) | Server aggregates; client renders chart |
| PostHog variant resolution | Browser (PostHog client `getFeatureFlag`) + Edge Fn (`posthog.getAllFlags(userId)`) | — | Variant key resolved server-side by `nps-trigger-decide` for deterministic copy/CTA pick |
| Native review fire (v1.4 only) | Browser (Capacitor plugin) | Database (`native_review_prompts` log) | v1.3 ships shim only; v1.4 wires real `@capacitor-community/in-app-review` |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Positive-engagement-only trigger whitelist — admissible events: `activation_completed` (P34), `level_up` (P35), `streak_milestone_30d` / `streak_milestone_60d` / `streak_milestone_90d` (P35), `weekly_challenge_completed` (P35), `kb_article_helpful_voted` (P37). Admin adds via `nps_trigger_eligible` flag on event registry; addition audit-logged.
- **D-02:** Single-condition rules ONLY (1 trigger event + nullable `cohort_id` + cooldown reference). Multiple rules can be active simultaneously; cross-rule cooldown is global. **NO AND/OR multi-clause rule trees** in v1.3.
- **D-03:** V13-3 lint = ESLint AST rule at `leanshot/eslint-rules/no-conditional-native-review.cjs`. Detects `navigator.requestReview` / `Rating.request()` / `InAppReview.requestReview()` + flags as error if call site references `nps_score / rating / review_state / is_promoter / is_detractor`.
- **D-04:** AST rule + lightweight `scripts/check-no-conditional-native-review.sh` grep backup (string co-occurrence within 10 lines, comments stripped). CI runs both.
- **D-05:** Hybrid cooldown — per-rule 30d min + global 60d/5-lifetime ceiling. Server enforces both at fire-decision time.
- **D-06:** Detractor (1-2★) suppression = 90d before ANY further NPS prompt.
- **D-07:** Lifetime cap is absolute — never reset. Once user hits 5 lifetime prompts, no further NPS prompts ever.
- **D-08:** Cooldown state is multi-device-respecting. `review_prompt_history(user_id, fired_at, rule_id, surface_dismissed_at, rating_value)` keyed on user_id; cooldown check server-side regardless of device.
- **D-09:** 5-star scale (ROADMAP literal "4-5★"). Modal/bottom-sheet at trigger event; dismiss-X visible. Backdrop dismiss = counts as "shown but unrated" (cooldown applied + lifetime quota slot used).
- **D-10:** Non-promoter (1-3★) feedback form = single open-text "What could we do better?". Submit auto-creates helpdesk ticket via P37 D-18 inbound flow (server-side ticket insert). Subject "Feedback from NPS rating"; tags `nps-feedback` + auto-detected sentiment per P37 D-10.
- **D-11:** Promoter (4-5★) flow = immediate external-CTA opt-in modal. Dismiss counts as "rated but not redirected" (analytics).
- **D-12:** Skip/dismiss UX — both modal dismiss-X and backdrop-click count as a fired prompt.
- **D-13:** CTA catalog in v1.3 = Trustpilot + G2 + Capterra; native Apple/Google scaffolded for v1.4. Schema `review_cta_catalog(slug, display_name, url_pattern, requires_mobile_shell boolean default false, available_for_org_type)`.
- **D-14:** Per-cohort auto-targeting by `primary_org_id`. Clinic-org user → G2 + Capterra (B2B); consumer (no org) → Trustpilot. Falls back to Trustpilot if cohort ambiguous.
- **D-15:** Attribution = redirect-out-only. PostHog event `external_review_clicked` with platform property. No completion polling.
- **D-16:** Trustpilot/G2/Capterra profile claim is vendor pre-req. Founder action: claim + verify BEFORE Phase 36 ships. Tracked as HUMAN-UAT checkpoint in PLAN.md.
- **D-17:** Native trigger events = SAME positive-engagement whitelist as web NPS (D-01). UNCONDITIONAL — neither call gates on prior NPS rating value.
- **D-18:** Server-side cooldown table `native_review_prompts(user_id, platform, fired_at)`. iOS + Android tracked separately (3x/365d per Apple policy; Google In-App Review has its own quota).
- **D-19:** Web NPS lifetime quota (5 from D-05) is SEPARATE from native quota (3 per platform). Different surfaces; different quotas.
- **D-20:** Integration seam = shared `useNativeReviewTrigger()` hook + Capacitor plugin web no-op shim. v1.3 ships hook + shim; v1.4 replaces shim with `@capacitor-community/in-app-review`. Hook usage doesn't change.
- **D-21:** V13-3 lint covers the native shim too. The `requestReview` AST detection includes the shim's `request()` method signature.

### Claude's Discretion
- Per-funnel dashboard layout (REVIEW-07) — `/admin/reviews/funnel`; reuses Phase 33 admin-CAC chart patterns.
- PostHog A/B variant shape for trigger conditions + copy + CTA wording (REVIEW-06) — mirrors Phase 34 D-20 + Phase 35 D-20 pattern (Ship-Winner version flip).
- Rule-builder admin UI — form-based per single-condition decision.
- Modal vs bottom-sheet animation polish (framer-motion) — `useReducedMotion`-respecting variants.

### Deferred Ideas (OUT OF SCOPE)
- Multi-clause AND/OR rule composition → v1.4 polish.
- Native review fire on iOS/Android → v1.4 mobile-shell phase.
- Trustpilot/G2/Capterra completion-confirmation polling → v1.4.
- 0-10 NPS scale alternative → rejected (chose 5★ per ROADMAP).
- Reset triggers for lifetime cap → rejected (D-07 absolute).
- Admin sentiment-threshold UI on review feedback → v1.4 polish (inherits P37 D-11 hardcoded thresholds).
- PWA store review (Apple PWA via Web Push; Android TWA) → rejected.
- Per-cohort CTA admin-override → v1.3 auto-targets; admin override deferred.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVIEW-01 | Internal NPS fires as INDEPENDENT surface (NOT gating any store-native prompt); V13-3 BLOCKER active on conditional native-prompt code | ESLint AST rule already shipped at `eslint-rules/no-conditional-native-review.cjs` (Phase 42 D-20). Wave 1 verifies rule covers P36 call names; adds `scripts/check-no-conditional-native-review.sh` grep backup per D-04. |
| REVIEW-02 | Admin defines trigger rules via rule-builder UI | Net-new `growth/reviews` admin module (replaces placeholder at `src/lib/admin/modules.ts:139`); SECDEF RPCs `create_review_prompt_rule / update / delete` over `review_prompt_rules` table. Note: REQUIREMENTS literal text says "if/and/or composition" but CONTEXT D-02 explicitly downgrades to single-condition rules for v1.3 — PLAN.md must cite D-02. |
| REVIEW-03 | Cooldown rules enforced (30d default, 5 lifetime cap) | Net-new `nps-trigger-decide` Edge Fn + `review_prompt_history` table. Server-side enforcement per D-05/D-06/D-07/D-08. |
| REVIEW-04 | Promoter (4-5★) routes to external CTA (Trustpilot / G2 / Capterra) | Surface B modal + `review_cta_catalog` lookup + per-cohort resolution by `primary_org_id` per D-14. Fires `external_review_clicked` PostHog event. |
| REVIEW-05 | Non-promoter (1-3★) routes to in-app feedback form → auto-creates M6 helpdesk ticket | `nps-feedback-submit` Edge Fn → calls existing `create_ticket_with_first_message(p_subject='Feedback from NPS rating', p_body, p_priority='p3')` SECDEF RPC. MUST forward user JWT per `cancellation-feedback-to-ticket` precedent (Pitfall 4). |
| REVIEW-06 | PostHog A/B on prompt copy + timing | Variant key resolved server-side in `nps-trigger-decide` via PostHog `getAllFlags(userId)`. Ship-Winner reuse via `OnboardingABPanel` Edge Fn `ship-winner-flag` (D-19 Claude's Discretion). |
| REVIEW-07 | Admin views per-funnel dashboard (prompt shown → internal rating → external review posted) with per-variant breakdown | Surface E. Reuses Phase 33 admin-CAC `BaseChart` patterns + `ship-winner-flag` Edge Fn. Aggregate queries over `review_prompt_history` joined with `events_mirror` (`external_review_clicked` events). |
| REVIEW-08 | Multi-channel external CTAs (Trustpilot / G2 / Capterra / Apple-PWA-store / Google-Play-PWA when applicable) | `review_cta_catalog` table with `requires_mobile_shell` flag (D-13). v1.3 surfaces only `requires_mobile_shell=false` rows; Surface F catalog page admin-views all rows. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.0.0 | Modal + admin module rendering | Project locked (CLAUDE.md) [VERIFIED: package.json] |
| Tailwind v4 (beta) | ^4.0.0-beta.7 | All styling via existing `@theme` tokens | Project locked [VERIFIED: package.json] |
| framer-motion | ^11.11.17 | Modal entry + funnel-bar animations | Already in index bundle [VERIFIED: package.json] |
| lucide-react | ^0.460.0 | Star / ExternalLink / Filter / Check icons | Already in index bundle [VERIFIED: package.json] |
| chart.js | ^4.4.6 (via `BaseChart` wrapper) | Funnel chart in Surface E | Already in index; theme-aware wrapper exists [VERIFIED: src/components/dashboard/charts/BaseChart.tsx] |
| @supabase/supabase-js | npm:@supabase/supabase-js@2 | Edge Fn + client calls | Project standard [VERIFIED: existing functions] |
| Deno (Edge Fn runtime) | latest stable | `nps-trigger-decide` + `nps-feedback-submit` | Project standard for Supabase Edge Fns |
| posthog-node | ^5.10.4 | `captureServer()` from Edge Fn | Already imported in `_shared/posthog-server.ts` [VERIFIED: existing file] |
| ESLint | ^9.39.4 | Flat-config; custom rule already integrated at `eslint.config.js` lines 16-19 | [VERIFIED: package.json + eslint.config.js] |
| RuleTester (from ESLint) | bundled | Custom-rule unit tests (`.test.cjs`) | Existing pattern in `eslint-rules/__tests__/` [VERIFIED] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1.5 | Unit + RLS tests (`vitest run --config vitest-e2e.config.ts` for RLS) | All TS/TSX unit tests [VERIFIED] |
| @playwright/test | ^1.59.1 | E2E rating-flow + admin rule-builder integration tests | Cross-tab cooldown, modal interaction [VERIFIED] |
| svix | (used by helpdesk-inbound) | Not needed — Phase 36 does not consume webhooks | n/a |
| Capacitor packages | already in deps | v1.4 native plugin target | v1.3 only ships type contract in `review-shim.ts`; no runtime import |

### Native Review (v1.4 target — do NOT install in v1.3)
| Library | Version (v1.4) | Purpose | When |
|---------|---------|---------|-------------|
| `@capacitor-community/in-app-review` | check at v1.4 plan-time | Real native fire | v1.4 mobile-shell phase only [ASSUMED — verify in v1.4] |

**Installation (Wave 1):**
```bash
# NO new top-level npm dependencies required. All needed libs already in package.json.
# (Phase 36 net-new code only — no new vendor lib for v1.3.)
```

**Version verification:** All listed deps verified in `/Users/karstenhaldan/minisite/leanshot/package.json` 2026-05-21.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server-side cooldown Edge Fn | Pure RPC (SECDEF) returning decide payload | RPC works because cooldown read needs no auth.uid() — it reads `review_prompt_history.user_id` directly. Edge Fn chosen because (a) PostHog flag resolution needs `posthog-node`, (b) we need to log `external_review_clicked`-equivalent decision-event via captureServer. Pure RPC would force the client to make 2 calls (decide + flag-resolve). |
| Custom comment-strip in grep gate | Use existing `check-css-logical-properties.sh` pattern (sed-strip comments via `sed 's://.*$::g'`) | Use the existing pattern. Don't reinvent. |
| New PostHog client for variant resolve | Reuse `_shared/posthog-server.ts` getClient() + add `getAllFlagsPayload(userId)` wrapper | Reuse. Don't fork. |

## Architecture Patterns

### System Architecture Diagram

```
[Browser]
   |
   |  (1) User action fires admissible event (level_up | streak_milestone_30d | etc.)
   |       — captured client-side via existing P24 event-emitter
   v
[useNPSPromptListener hook]  ────────────►  [captureServer (Edge Fn already in-flight)]
   |                                              |
   |                                              v
   |                                        [events_mirror table — D-13 dual-write]
   |
   |  (2) Hook calls Edge Fn `nps-trigger-decide` (forwards user JWT)
   v
[Edge Fn nps-trigger-decide]
   |
   |  (3) Look up active rules matching this event
   |       SELECT * FROM review_prompt_rules WHERE trigger_event = $1 AND active = true
   |  (4) Cooldown gate (server-side):
   |       — Per-rule 30d: SELECT max(fired_at) FROM review_prompt_history WHERE user_id=$U AND rule_id=$R
   |       — Global 60d:  SELECT max(fired_at) FROM review_prompt_history WHERE user_id=$U
   |       — Lifetime 5:  SELECT count(*) FROM review_prompt_history WHERE user_id=$U
   |       — Detractor 90d: if any rating_value IN (1,2), extend cooldown
   |  (5) PostHog variant resolve:
   |       posthog.getAllFlags(userId) → pick `nps_prompt_copy` variant
   |  (6) On fire: INSERT INTO review_prompt_history (service-role write) BEFORE returning decision
   v
[Decision payload {fire: true, copy_variant, cta_set: [trustpilot|g2|capterra]}]
   |
   v
[Surface A: NPSPromptModal renders] (5★ rating)
   |
   |  (7a) Promoter (4-5★) → Surface B PromoterCtaModal
   |        — User clicks platform CTA → window.open(url, '_blank')
   |        — Fires `external_review_clicked` PostHog event (client-side capture)
   |
   |  (7b) Non-promoter (1-3★) → Surface C DetractorFeedbackModal
   |        — Submit → Edge Fn `nps-feedback-submit` (user JWT forwarded)
   |              ↓
   |        — RPC create_ticket_with_first_message(p_subject='Feedback from NPS rating',
   |              p_body=<textarea>, p_priority='p3')
   |              ↓
   |        — Returns ticket_id; success modal in-place
   |
   |  (7c) Dismiss (X or backdrop) → fires INSERT with rating_value=NULL (still consumes quota)

[Admin] ────►  /admin/reviews/rules → CRUD over review_prompt_rules (SECDEF RPCs, admin_role gate)
                /admin/reviews/funnel → BaseChart over review_prompt_history + events_mirror
                                       + Ship-Winner button → existing ship-winner-flag Edge Fn
                /admin/reviews/cta-catalog → read-only table over review_cta_catalog

[v1.4 native scaffolding (inert in v1.3)]
   useNativeReviewTrigger() — wired into trigger handlers but returns {shown:false} on web
   review-shim.ts — type contract; v1.4 swaps implementation
   native_review_prompts table — empty in v1.3; v1.4 Capacitor plugin writes to it
```

### Recommended Project Structure
```
leanshot/
├── eslint-rules/
│   └── no-conditional-native-review.cjs  # ALREADY EXISTS — Phase 42 D-20 shipped pre-emptively. Wave 1 verifies covers P36; add P36 fixtures to .test.cjs.
├── scripts/
│   └── check-no-conditional-native-review.sh  # NEW (D-04 grep backup)
└── src/
    ├── components/nps/
    │   ├── NPSPromptModal.tsx                 # Surface A
    │   ├── PromoterCtaModal.tsx               # Surface B
    │   ├── DetractorFeedbackModal.tsx         # Surface C
    │   └── __tests__/*.test.tsx
    ├── hooks/
    │   ├── useNPSPromptListener.ts            # Subscribes to D-01 whitelist events, calls Edge Fn
    │   └── useNativeReviewTrigger.ts          # D-20 web no-op
    ├── lib/
    │   ├── native/review-shim.ts              # D-20 type contract
    │   └── nps/decide-client.ts               # Edge Fn wrapper + types
    └── admin/modules/reviews/                 # NEW module (replaces placeholder at lib/admin/modules.ts:139)
        ├── index.ts                            # Lazy export entry
        ├── RulesListPage.tsx                   # Surface D
        ├── RuleFormPanel.tsx                   # Surface D side-panel
        ├── FunnelDashboardPage.tsx             # Surface E
        ├── VariantGrid.tsx                     # Surface E A/B grid
        └── CtaCatalogPage.tsx                  # Surface F

supabase/
├── migrations/
│   ├── 2026MMDDhhmmss_p36_review_prompt_rules.sql
│   ├── 2026MMDDhhmmss_p36_review_prompt_history.sql
│   ├── 2026MMDDhhmmss_p36_native_review_prompts.sql
│   ├── 2026MMDDhhmmss_p36_review_cta_catalog.sql
│   ├── 2026MMDDhhmmss_p36_review_secdef_rpcs.sql
│   └── 2026MMDDhhmmss_p36_review_rls_policies.sql
└── functions/
    ├── nps-trigger-decide/                    # NEW
    └── nps-feedback-submit/                   # NEW (thin wrapper over create_ticket_with_first_message)
```

### Pattern 1: Server-side decision via Edge Fn with user-JWT forwarding
**What:** All cooldown decisions (and ticket creation) MUST happen server-side with the user's JWT forwarded.
**When to use:** Any SECDEF RPC that references `auth.uid()` — `create_ticket_with_first_message` is one such.
**Example (from `cancellation-feedback-to-ticket`, lines 30-62):**
```typescript
// Source: supabase/functions/cancellation-feedback-to-ticket/index.ts
const authHeader = req.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) return jsonError(401, 'unauthenticated');
const userJwt = authHeader.slice(7);

// User-context client (NOT service-role) so auth.uid() resolves in the RPC
const userClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${userJwt}` } },
});

const { data, error } = await userClient.rpc('create_ticket_with_first_message', {
  p_subject: 'Feedback from NPS rating',
  p_body: feedbackText.slice(0, 4000),
  p_priority: 'p3',
});
```
**Per [[feedback_rpc_auth_uid_vs_service_role_mismatch]]:** `nps-feedback-submit` MUST forward user JWT. The cooldown-check Edge Fn `nps-trigger-decide` can use service-role for the cooldown query (it doesn't need `auth.uid()` — the user_id comes from JWT decode) but the WRITE to `review_prompt_history` and the call to PostHog flag-resolve must still derive user_id from the verified JWT, not from a request body.

### Pattern 2: Existing ESLint custom rule — extend, don't fork
**What:** `eslint-rules/no-conditional-native-review.cjs` already exists (Phase 42 Plan 42-07). It targets `requestReview / showReviewPrompt / triggerReviewPrompt / showQuarterlyNpsModal / triggerQuarterlyNps`.
**Reuse contract:** The rule's docblock at line 45-47 explicitly addresses Phase 36 executors:
```
NOTE TO PHASE 36 EXECUTOR: this file already exists. When P36 ships its
call sites, REUSE this rule — do NOT recreate. Add P36-specific test
fixtures to the existing .test.cjs file if needed.
```
**Implication for plan:** Wave 1 plan SHOULD NOT create the `.cjs` rule. It should:
1. Add P36-specific RuleTester fixtures to `eslint-rules/no-conditional-native-review.test.cjs` (verify P36 conditional patterns FAIL; unconditional `useNativeReviewTrigger().request()` PASSES).
2. Verify `eslint.config.js` lines 16-19 already register the rule (it does — Phase 42 wired it).
3. Add grep backup `scripts/check-no-conditional-native-review.sh` per D-04.

### Pattern 3: Admin module registration via manifest
**What:** Admin shell uses a single `ADMIN_MODULES` manifest (`src/lib/admin/modules.ts`); `AdminShell.tsx:124` routes via `pathname.startsWith('/admin/${m.route}/')` prefix-branch matching.
**When to use:** Adding any new admin module.
**Example (from `src/lib/admin/modules.ts` `reviews` placeholder, lines 139-146):**
```typescript
// Current placeholder (P36 Wave 4 replaces):
{
  key: 'reviews',
  label: 'Reviews',
  route: 'reviews',
  icon: StarIcon,
  lazy: placeholderFor('Phase 32+ (Review-prompt moderation)'),  // ← replaced
  flagKey: 'admin.reviews.enabled',
  minRole: 'staff' as AdminRole,
},
```
**P36 Wave 4 patch:**
```typescript
{
  key: 'reviews',
  label: 'Reviews',
  route: 'reviews',
  icon: StarIcon,
  lazy: () => import('@/admin/modules/reviews'),  // exports default with sub-route table
  flagKey: 'admin.reviews.enabled',
  minRole: 'admin' as AdminRole,  // upgrade from 'staff' per CONTEXT — rule editing is admin op
},
```
**Per [[feedback_admin_module_manifest_vs_router_branch_drift]]:** Verify the plan-checker grep for placeholderFor('Phase 32+') no longer matches after the patch. AdminShell already supports prefix-branch matching, so no router code change needed.

### Pattern 4: Ship-Winner button reuse
**What:** Surface E variant grid reuses the exact `data-action="ship-winner"` + Edge Fn `ship-winner-flag` contract from `OnboardingABPanel.tsx`.
**Reuse target:** `supabase/functions/ship-winner-flag/index.ts` accepts `{ flag_id: string, variant: string }` and PATCHes PostHog. Pattern S1 dual-layer (client surfaceCheck + server admin_role re-verify) already in place.
**Implication:** Do NOT create a new "ship-review-variant" Edge Fn. Wave 4 plan extracts the Ship-Winner button into a shared helper at `src/components/admin/ShipWinnerButton.tsx` if not already extracted (verify at plan-time; if `OnboardingABPanel.tsx` still inlines the button, extract as part of P36 Wave 4 with a follow-up to consolidate in P42 polish).

### Pattern 5: CI grep gate with comment-strip
**What:** `scripts/check-no-conditional-native-review.sh` follows the comment-strip pattern from `scripts/check-css-logical-properties.sh`.
**Example structure:**
```bash
#!/usr/bin/env bash
# Phase 36 Plan 36-XX (REVIEW-01 D-04) — V13-3 grep backup gate.
set -u
SRC_DIR="${PWD}/src"
PATTERNS=(
  # Co-occurrence within 10 lines: requestReview-like + NPS-state identifier
  'requestReview|InAppReview\.request|Rating\.request'
)
RATING_IDS='nps_score|rating|review_state|is_promoter|is_detractor'
# Strip // and /* */ comments before grep (use sed per check-css-logical-properties.sh)
# Then awk-window 10 lines for co-occurrence
```
**Per [[reference_grep_gate_comment_strip]]:** Comment strip first; otherwise a JSDoc comment trips the gate.
**Per [[reference_bundle_budget_hash_hyphen]]:** Use the same exit-code conventions (0=clean, 1=violations).

### Pattern 6: Append-only history table with RLS
**What:** `review_prompt_history` mirrors v1.2 `audit_logs` / Phase 35 `xp_ledger` shape.
**Conventions:**
- Append-only (no UPDATE allowed) — RLS denies UPDATE/DELETE on all rows.
- Service-role INSERTs from Edge Fn `nps-trigger-decide`.
- User-scoped SELECT for own history (`user_id = auth.uid()`).
- Admin SELECT-all for dashboard aggregation (via SECDEF RPC, not direct RLS).
**Per [[reference_supabase_migration_gotchas]]:** SECDEF needs `extensions` in search_path. Partial indexes (e.g., on `fired_at` WHERE `rating_value IS NOT NULL`) need IMMUTABLE expressions.

### Anti-Patterns to Avoid

- **Client-side cooldown counter.** Cooldown state on the client = race conditions across devices (user rates on phone, sees prompt on web). D-08 mandates server-side. **Lint:** Plan-checker should grep for `localStorage` access to anything resembling NPS state.
- **Bare UPDATE on `review_prompt_history`.** This table is append-only. Use `INSERT … ON CONFLICT DO NOTHING` if dedup needed; otherwise straight INSERT. **Per [[feedback_state_counter_table_needs_upsert_on_event]]:** if a counter column is added later, UPSERT not bare UPDATE.
- **Skipping `await shutdownPostHog()` in Edge Fns.** Deno isolate teardown drops batched events. Wrap handler in `try/finally`.
- **Conditional native-review call gated on rating.** This is the V13-3 BLOCKER — ESLint rule catches it. The hook is wired UNCONDITIONALLY into trigger handlers (v1.3 no-op web shim returns false; v1.4 native plugin handles its own cap).
- **`Rule-builder UI implementing AND/OR composition.** REQUIREMENTS literal says "if/and/or" but CONTEXT D-02 explicitly downgrades to single-condition for v1.3. Plan-checker enforce: form has exactly 1 trigger event field + 1 nullable cohort field. JSONB rule schema CAN be future-compat for AND/OR (per deferred-ideas comment) but UI must not surface it.
- **Using `CohortPicker` from `src/components/admin/cohort/`** — **WARNING: NO `CohortPicker` component currently exists.** The UI-SPEC references it but `src/components/admin/cohort/` ships `AdminCohortBuilder.tsx`, `AdminCohortList.tsx`, `CohortFieldPicker.tsx`, `CohortRuleNode.tsx`, `CohortsPage.tsx` only. **Wave 4 must either (a) build a `CohortPicker.tsx` as a thin wrapper around the existing list, or (b) cite `AdminCohortList` directly.** Plan-checker flag this divergence from UI-SPEC.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conditional-native-review AST detection | New ESLint rule for P36 | EXISTING `eslint-rules/no-conditional-native-review.cjs` (Phase 42 shipped pre-emptively for P36) | Same authors, same intent; the rule's docblock explicitly addresses Phase 36 |
| Helpdesk ticket creation | New `nps-create-ticket` Edge Fn | EXISTING `create_ticket_with_first_message(p_subject, p_body, p_priority)` SECDEF RPC | Same RPC powers `cancellation-feedback-to-ticket` and helpdesk-inbound widget. Just call it. |
| Ship-Winner button | New ship-review-variant Edge Fn | EXISTING `ship-winner-flag` Edge Fn + `OnboardingABPanel.tsx` UI contract | Same PostHog PATCH; same superadmin gate. Reuse the data-action attr name. |
| Server-side PostHog capture | Direct `posthog-node` import | `_shared/posthog-server.ts` `captureServer()` | Adds events_mirror dual-write + vendor-gated health check for free |
| Admin module router glue | Custom `<Route>` switch | Manifest entry + AdminShell prefix-branch (already does it) | [[feedback_admin_module_manifest_vs_router_branch_drift]] |
| Funnel chart | Custom canvas | `BaseChart` (chart.js wrapper) — Phase 33 admin-CAC pattern | Theme-aware destroy/recreate already handled |
| Modal scaffolding | Net-new dialog | `ui/Modal.tsx` (focus-trap + entry motion + reduced-motion) | DSv2 primitive |
| Sentiment-tagging the helpdesk ticket | Net-new sentiment classifier in P36 | P37 `helpdesk-ai-assist` Edge Fn (already auto-tags tickets per HELP-04) | P37 D-10 sentiment tag fires async after ticket insert |

**Key insight:** Phase 36 is 70% wiring of existing primitives and 30% net-new code. The genuinely new pieces are: 4 migrations, 2 Edge Fns (`nps-trigger-decide`, `nps-feedback-submit`), 3 consumer modals, 1 admin module with 4 pages, 2 hooks, 1 shim. The ESLint AST rule, ticket-create RPC, Ship-Winner Fn, BaseChart, Modal primitive, and captureServer/events_mirror dual-write are all already in production.

## Runtime State Inventory

> Phase 36 is a NET-NEW feature, not a rename/refactor. No legacy strings to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — net-new tables only | n/a |
| Live service config | PostHog Experiments (admin creates new experiment for `nps_prompt_copy` post-ship) | Documented HUMAN-UAT in Wave 5 PLAN.md |
| OS-registered state | None | n/a |
| Secrets/env vars | None new. `nps-trigger-decide` reuses `POSTHOG_PROJECT_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (already set per Phase 24/34). `nps-feedback-submit` reuses `SUPABASE_ANON_KEY` for user-JWT-forwarding client per `cancellation-feedback-to-ticket` precedent. | None |
| Build artifacts | None — TS compile only; no installed packages | n/a |

**Nothing found in category:** As stated above. No data migration required (net-new feature).

## Common Pitfalls

### Pitfall 1: ESLint rule already exists — recreating it will cause merge conflict
**What goes wrong:** Wave 1 executor reads CONTEXT D-03 ("Custom ESLint rule in `leanshot/eslint-rules/no-conditional-native-review.cjs`") and creates the file fresh, overwriting Phase 42's existing implementation.
**Why it happens:** CONTEXT.md was written before Phase 42 shipped its pre-emptive version.
**How to avoid:** Plan-checker MUST verify the Wave 1 plan READS the existing file first and ADDS test fixtures rather than creates. The existing rule's docblock at lines 45-47 explicitly instructs Phase 36 executor to reuse.
**Warning signs:** `git diff eslint-rules/no-conditional-native-review.cjs` shows full file replacement instead of incremental additions.

### Pitfall 2: `auth.uid()` mismatch in `nps-feedback-submit`
**What goes wrong:** Fn calls `create_ticket_with_first_message` with service-role client → RPC throws `unauthenticated` because `auth.uid()` is null.
**Why it happens:** The RPC is SECDEF + references `auth.uid()` (verified at line 67 of `20270707000009_helpdesk_create_ticket_rpc.sql`).
**How to avoid:** Forward user JWT exactly as `cancellation-feedback-to-ticket` does (anon-key client + Authorization header).
**Per [[feedback_rpc_auth_uid_vs_service_role_mismatch]].**

### Pitfall 3: `nps_trigger_eligible` flag on event registry not yet shipped
**What goes wrong:** CONTEXT D-01 says "Admin can ADD events to the whitelist via a `nps_trigger_eligible` flag in `events.ts`" but the event registry shape in `src/lib/analytics/events.ts` does not yet have such a flag field.
**Why it happens:** Phase 36 is the phase that adds the flag.
**How to avoid:** Wave 1 plan must include a `events.ts` extension task that adds the `nps_trigger_eligible?: boolean` field to the event-definition type AND seeds `true` on the D-01 whitelist events. **NOTE:** Phase 35 is currently EXECUTING (per STATE.md), so `level_up / streak_milestone_30d / streak_milestone_60d / streak_milestone_90d / weekly_challenge_completed` registry entries may not yet exist at P36 plan-time. Verify Phase 35 ship status before plan-check; if Phase 35 events haven't landed, P36 plan must either (a) add the registry entries itself (and Phase 35 merge will resolve the duplicate), or (b) gate Phase 36 execution on Phase 35 completion. Phase 35 is the upstream blocker per ROADMAP "Depends on" wording.

### Pitfall 4: Migration timestamp collision with Phase 35 in-flight
**What goes wrong:** Phase 36 picks `2026MMDDhhmmss_*` but Phase 35 (in-flight) also has migrations queued at adjacent timestamps. Push fails.
**Why it happens:** Two phases ship migrations against the same remote within a small window.
**How to avoid:** Per [[reference_migration_timestamp_collision_precheck]] — pre-merge glob `<prefix>*.sql` >1; rename collisions to future timestamp + `git mv` + retry push. Per [[reference_supabase_back_dated_migration_blocks_push]] — verify Phase 36 timestamps are STRICTLY GREATER than `max(timestamp)` on remote when Phase 36 merges. Latest migration on disk at 2026-05-21: `20270709000008_p40_roi_view.sql`. Phase 36 should pick `20270710000001+` to stay safely ahead.
**Per [[reference_supabase_migration_filename_regex]]:** Strict 14-digit prefix; letter-suffix silently SKIPPED. Use `_` not `-` between digits and name.

### Pitfall 5: `CohortPicker` referenced in UI-SPEC doesn't exist
**What goes wrong:** Surface D rule form imports `CohortPicker` from `@/components/admin/cohort/` but no such component exports it. Build fails or runtime errors.
**Why it happens:** UI-SPEC line 164 references a yet-unbuilt primitive.
**How to avoid:** Wave 4 plan EXPLICITLY creates `src/components/admin/cohort/CohortPicker.tsx` as a thin wrapper around `AdminCohortList` (read-only list + single-select). If Wave 4 plan does not address this, plan-checker BLOCKER. Alternative: rule form uses bare `<select>` of cohort IDs from a `list_cohorts` RPC call — less polished but unblocks shipping.

### Pitfall 6: Bundle ceiling violations
**What goes wrong:** Admin reviews module pushes admin-shell chunk past 30 kB gz; OR NPS consumer modal eagerly imports admin code path.
**Why it happens:** Forgetting `import-x/no-restricted-paths` zones (per [[reference_eslint_import_x_path_gotcha]] — bare file paths silently no-op; use globs).
**How to avoid:** Wave 1 plan must update `eslint.config.js` `import-x/no-restricted-paths` zones to keep `src/components/nps/**` separate from `src/admin/**`. Wave 5 verifies via `npm run check:helpdesk-bundle`-style script (P36 adds its own `assert-reviews-bundle-budget.sh` or extends existing `assert-bundle-budget.sh` per [[reference_bundle_budget_hash_hyphen]] — verify hyphen handling).

### Pitfall 7: V13-3 lint silent-bypass via re-export
**What goes wrong:** A developer wraps `requestReview` in a re-export like `export const fireReview = requestReview` and conditions on rating — the AST rule's `TARGET_CALL_NAMES` only catches direct identifier match.
**Why it happens:** The current rule (Phase 42's version) only walks `CallExpression.callee.name` and `callee.property.name`. Aliased re-exports bypass.
**How to avoid:** Add a P36 test fixture proving aliased re-exports FAIL the rule. If they currently pass, extend the rule (Wave 1) to also track aliased imports from `@/lib/native/review-shim` and `@/hooks/useNativeReviewTrigger`. The grep backup (D-04) catches this by string co-occurrence.

### Pitfall 8: `npm install` worktree drift if any new dep added
**What goes wrong:** Wave 1 worktree adds a dep (unlikely for P36 but possible if e.g. `posthog-node` upgrade); `node_modules` gitignored; merge to main breaks tsc.
**How to avoid:** Per [[reference_npm_install_worktree_main_drift]] — orchestrator runs `npm install` in main after any merge if dependencies changed. P36 should NOT require new deps; flag plan-check failure if a dep is added.

### Pitfall 9: `Rule.active = false` toggle not enforced server-side
**What goes wrong:** Admin pauses a rule client-side, but `nps-trigger-decide` keeps querying ALL rows.
**How to avoid:** `nps-trigger-decide` query MUST filter `WHERE active = true`. Plan-checker grep Edge Fn body for `active = true` clause.

### Pitfall 10: `events_mirror` write race on `external_review_clicked`
**What goes wrong:** Funnel dashboard counts clicks via `events_mirror`; client fires `posthog.capture('external_review_clicked')` but client-side capture does NOT dual-write to events_mirror (only server-side captureServer does).
**Why it happens:** External CTA click is initiated client-side (window.open) — there's no Edge Fn hop to call captureServer.
**How to avoid:** Add a tiny Edge Fn `nps-cta-click-log` (POST { platform }) called by Surface B's CTA button BEFORE window.open — fires captureServer + dual-writes to events_mirror. OR: dashboard query joins PostHog events directly (slower, rate-limit risk). **Recommendation:** ship the small Edge Fn; mirror the pattern used by Phase 33 admin-CAC ad-click logging.

## Code Examples

### Server-side cooldown decide Edge Fn skeleton
```typescript
// Source: pattern from supabase/functions/cancellation-feedback-to-ticket + ship-winner-flag
// Path: supabase/functions/nps-trigger-decide/index.ts

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

const corsHeaders = { /* … */ };

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Auth — user JWT required (we derive user_id from JWT, not body)
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json(401, { error: 'unauthenticated' });
  const userJwt = auth.slice(7);

  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(401, { error: 'invalid_token' });

    const { event_name } = await req.json();

    // 2. Service-role client for read-all (rules + history)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 3. Cooldown gate — server-side
    const { data: history } = await admin
      .from('review_prompt_history')
      .select('fired_at, rule_id, rating_value')
      .eq('user_id', user.id)
      .order('fired_at', { ascending: false });

    if ((history?.length ?? 0) >= 5) return json(200, { fire: false, reason: 'lifetime_cap' });

    const lastAny = history?.[0]?.fired_at;
    const last1or2 = history?.find(h => h.rating_value === 1 || h.rating_value === 2);
    const minGlobalDays = last1or2 ? 90 : 60;  // D-06 detractor suppression
    if (lastAny && daysSince(lastAny) < minGlobalDays) {
      return json(200, { fire: false, reason: 'global_cooldown' });
    }

    // 4. Find a matching active rule
    const { data: rules } = await admin
      .from('review_prompt_rules')
      .select('*')
      .eq('trigger_event', event_name)
      .eq('active', true);
    if (!rules?.length) return json(200, { fire: false, reason: 'no_rule' });

    // 5. Per-rule cooldown
    const eligibleRule = rules.find(r => {
      const lastForRule = history?.find(h => h.rule_id === r.id)?.fired_at;
      return !lastForRule || daysSince(lastForRule) >= 30;  // D-05 per-rule 30d
    });
    if (!eligibleRule) return json(200, { fire: false, reason: 'per_rule_cooldown' });

    // 6. PostHog variant resolve (server-side for determinism)
    // posthog.getAllFlags(user.id) → copy_variant + cta_set

    // 7. INSERT history BEFORE returning fire-decision (idempotency)
    await admin.from('review_prompt_history').insert({
      user_id: user.id,
      rule_id: eligibleRule.id,
      fired_at: new Date().toISOString(),
    });

    captureServer({ event: 'nps_prompt_shown', userId: user.id, properties: { rule_id: eligibleRule.id } });

    return json(200, { fire: true, copy_variant: 'control', cta_set: ['trustpilot'] });
  } catch (err) {
    return json(500, { error: 'decide_failed', detail: String(err) });
  } finally {
    await shutdownPostHog();
  }
}
```

### Feedback ticket-create Edge Fn (thin wrapper)
```typescript
// Source: mirrors supabase/functions/cancellation-feedback-to-ticket/index.ts
// Path: supabase/functions/nps-feedback-submit/index.ts

const auth = req.headers.get('Authorization');
if (!auth?.startsWith('Bearer ')) return jsonError(401, 'unauthenticated');
const userJwt = auth.slice(7);

const { feedback_text } = await req.json();
const body = (feedback_text ?? '').trim();
if (body.length < 10) return jsonError(400, 'too_short');

const userClient = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${userJwt}` } },
});

const { data: ticketId, error } = await userClient.rpc('create_ticket_with_first_message', {
  p_subject: 'Feedback from NPS rating',
  p_body: body.slice(0, 4000),
  p_priority: 'p3',
});
if (error) return jsonError(500, 'rpc_failed');

// P37 helpdesk-ai-assist auto-tags `nps-feedback` + sentiment per HELP-04 (fire-and-forget elsewhere)
return jsonResponse(200, { ticket_id: ticketId });
```

### useNativeReviewTrigger hook (v1.3 no-op)
```typescript
// Path: src/hooks/useNativeReviewTrigger.ts
import { reviewShim } from '@/lib/native/review-shim';

export function useNativeReviewTrigger() {
  return {
    request: async (): Promise<{ shown: boolean }> => {
      // Web no-op. v1.4 replaces review-shim.ts with Capacitor plugin.
      return reviewShim.request();
    },
  };
}

// Path: src/lib/native/review-shim.ts
export const reviewShim = {
  // v1.3 web no-op.
  // v1.4 swap to: import { InAppReview } from '@capacitor-community/in-app-review';
  //               return await InAppReview.requestReview();
  async request(): Promise<{ shown: boolean }> {
    return { shown: false };
  },
};
```

### Database schema (4 migrations)
```sql
-- Migration: 2026MMDDhhmmss_p36_review_prompt_rules.sql
CREATE TABLE public.review_prompt_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  trigger_event text NOT NULL,  -- must match an event in events.ts where nps_trigger_eligible = true
  cohort_id     uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,  -- nullable per D-02
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.review_prompt_rules ENABLE ROW LEVEL SECURITY;
-- Admin SELECT/INSERT/UPDATE/DELETE via SECDEF RPCs only; no direct DML for users.

-- Migration: 2026MMDDhhmmss_p36_review_prompt_history.sql (append-only)
CREATE TABLE public.review_prompt_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id             uuid REFERENCES public.review_prompt_rules(id) ON DELETE SET NULL,
  fired_at            timestamptz NOT NULL DEFAULT now(),
  surface_dismissed_at timestamptz,
  rating_value        int CHECK (rating_value BETWEEN 1 AND 5)
);
CREATE INDEX ON public.review_prompt_history (user_id, fired_at DESC);
ALTER TABLE public.review_prompt_history ENABLE ROW LEVEL SECURITY;
-- User SELECT own; admin SECDEF; service-role INSERT from Edge Fn.

-- Migration: 2026MMDDhhmmss_p36_native_review_prompts.sql
CREATE TABLE public.native_review_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('ios','android')),
  fired_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.native_review_prompts (user_id, platform, fired_at DESC);
-- v1.3: empty table. v1.4 Capacitor plugin writes.

-- Migration: 2026MMDDhhmmss_p36_review_cta_catalog.sql
CREATE TABLE public.review_cta_catalog (
  slug                   text PRIMARY KEY,
  display_name           text NOT NULL,
  url_pattern            text NOT NULL,
  requires_mobile_shell  boolean NOT NULL DEFAULT false,
  available_for_org_type text NOT NULL CHECK (available_for_org_type IN ('consumer','clinic','both')),
  claimed                boolean NOT NULL DEFAULT false,  -- D-16 vendor pre-req
  created_at             timestamptz NOT NULL DEFAULT now()
);
-- Seed in same migration:
INSERT INTO public.review_cta_catalog (slug, display_name, url_pattern, requires_mobile_shell, available_for_org_type) VALUES
  ('trustpilot', 'Trustpilot', 'https://trustpilot.com/review/leanshot.app', false, 'consumer'),
  ('g2',         'G2',         'https://g2.com/products/leanshot/reviews/start',  false, 'clinic'),
  ('capterra',   'Capterra',   'https://capterra.com/p/leanshot/reviews/new', false, 'clinic'),
  ('apple_app_store', 'Apple App Store', 'itms-apps://itunes.apple.com/...', true, 'both'),
  ('google_play',     'Google Play',     'market://details?id=...',           true, 'both');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side cooldown via localStorage | Server-side cooldown via Edge Fn + history table | This phase | Multi-device respect; tamper-proof |
| Conditional native review prompts | Unconditional fire-then-OS-caps (Apple/Google policy enforce server-side) | This phase (V13-3 BLOCKER) | App Store / Play Store policy compliance |
| Custom NPS classifier per rating value | 4-5★=promoter, 1-3★=non-promoter (single threshold) | This phase | Simpler product surface |
| Custom external-review API polling | Click-out tracking only (D-15) | This phase | Honest measurement, simpler implementation |

**Deprecated/outdated:**
- The `placeholderFor('Phase 32+ (Review-prompt moderation)')` entry at `src/lib/admin/modules.ts:139` — replaced by Wave 4.
- Any client-side rating-cooldown counter pattern from pre-v1.3 (none exists; this is pre-emptive).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 35 will land its event registry entries (`level_up`, `streak_milestone_*`, `weekly_challenge_completed`) before Phase 36 plan-checker runs | Pitfall 3 | Phase 36 Wave 1 plan must add the registry entries itself + handle merge conflict if Phase 35 ships in parallel. **Mitigation:** Wave 1 plan should defensively check `events.ts` at plan-time and either own the entries or list Phase 35 as a hard dependency. |
| A2 | Phase 37 helpdesk schema + `create_ticket_with_first_message` RPC is already shipped | Pattern 1, Pitfall 2 | [VERIFIED via `git ls-files supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` exists] — HIGH confidence shipped. |
| A3 | `OnboardingABPanel.tsx` inlines the Ship-Winner button (not yet extracted to shared helper) | Pattern 4 | Wave 4 either extracts or inlines duplicate. Either is acceptable; consolidation is P42 polish work. |
| A4 | `kb_article_helpful_voted` event will be added by Phase 37 (helpdesk KB feedback flow) | D-01 dependency | If Phase 37 doesn't ship it, P36 trigger whitelist is missing 1 event. Low impact — rules can be added later. |
| A5 | PostHog Experiments project + API key (`POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`) are configured per Phase 34-10 HUMAN-UAT | Wave 5 | If unset, Ship-Winner returns 503 with vendor-gated soft banner per existing OnboardingABPanel pattern — not a crash. |
| A6 | Trustpilot/G2/Capterra profiles claimed before Wave 5 (D-16) | Surface B vendor-block fallback | If unclaimed at ship-time, Surface B renders "Thanks for the rating!" no-CTA fallback per UI-SPEC. HUMAN-UAT in PLAN. |
| A7 | `nps_trigger_eligible: boolean` field on event-definition type is added by this phase, not a prior phase | Pitfall 3 | If absent, admin rule-builder event picker has no source of truth. Wave 1 owns this. |

## Open Questions

1. **`nps_feedback_submitted` and `external_review_clicked` events — should they be in the trigger whitelist?**
   - What we know: D-01 explicitly excludes negative-state events. The feedback-submit and CTA-click are positive engagement signals.
   - What's unclear: Whether they should be self-referentially admissible as triggers (would create loops without the cooldown).
   - Recommendation: NOT add to whitelist in v1.3. The cooldown would prevent re-fire but the semantic feels wrong. Add only if admin demand surfaces.

2. **Should `external_review_clicked` log live in `events_mirror` only, or a dedicated `external_review_clicks` table?**
   - What we know: events_mirror is dual-written by every captureServer call. Funnel queries can read it. Phase 33 admin-CAC uses events_mirror successfully.
   - What's unclear: Whether per-CTA-platform attribution requires a normalized table.
   - Recommendation: Use events_mirror only (`properties.platform` JSONB field). Phase 38+ recommender may want a normalized table later.

3. **`useNPSPromptListener` — single global subscription or per-component?**
   - What we know: P24 event-emitter pattern allows multiple subscribers.
   - What's unclear: Whether `App.tsx` mounts one listener or each tab mounts its own.
   - Recommendation: Single global at App.tsx root, mirroring `LevelUpBurst` pattern from Phase 35 (`src/components/dashboard/burst/LevelUpBurst.tsx`).

4. **What happens if admin DELETES a rule that has live `review_prompt_history` rows?**
   - What we know: `review_prompt_history.rule_id` is `ON DELETE SET NULL` per schema above.
   - What's unclear: Whether UI-SPEC's "Existing fires in history are preserved" copy matches this behavior.
   - Recommendation: SET NULL preserves history. UI-SPEC copy is accurate. Confirm in plan.

5. **Does the V13-3 ESLint rule need updating to also catch aliased re-exports?**
   - What we know: Current rule (Phase 42 version) checks `CallExpression.callee.{name|property.name}` directly. Aliased re-exports (`export const fireReview = requestReview`) bypass.
   - What's unclear: Whether the grep backup (D-04) provides sufficient defense-in-depth.
   - Recommendation: Wave 1 adds a test fixture proving the aliased-export pattern is caught. If not caught by AST, extend the rule to track aliased imports from `@/lib/native/review-shim` + `@/hooks/useNativeReviewTrigger`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | All migrations + Edge Fn deploy | ✓ | (project already linked, .temp/ present) | n/a |
| Deno runtime (Edge Fn local) | Edge Fn local tests | ✓ | `$HOME/.deno/bin/deno` per memory | `--no-check` flag for sweeps |
| PostHog (project key + personal API key) | Variant resolve + Ship-Winner | partial | Project key configured P34; personal API key needs HUMAN-UAT in Wave 5 if Ship-Winner is exercised | Vendor-gated soft banner ("PostHog not yet configured") per existing OnboardingABPanel pattern |
| Trustpilot / G2 / Capterra profiles claimed | Surface B external CTAs | ✗ | — | D-16 HUMAN-UAT in PLAN; UI-SPEC fallback renders "Thanks for the rating!" no-CTA modal until claim lands |
| `@capacitor-community/in-app-review` | Native fire (v1.4 only) | n/a | n/a in v1.3 | Web no-op shim in v1.3 per D-20 |
| Resend (email) | n/a — Phase 36 does NOT send email | n/a | n/a | n/a |

**Missing dependencies with no fallback:**
- None blocking for v1.3 web ship.

**Missing dependencies with fallback:**
- Trustpilot/G2/Capterra profile claims → soft fallback UI in Surface B.
- PostHog personal API key (for Ship-Winner) → vendor-gated 503 soft banner.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.5 (unit) + @playwright/test ^1.59.1 (E2E) + Node built-in test runner (ESLint RuleTester) |
| Config file | `vitest.config.ts` (unit), `vitest-e2e.config.ts` (RLS), `playwright.config.ts` (E2E) |
| Quick run command | `npm run test:unit` (vitest run) |
| Full suite command | `npm test` (vitest run && playwright test) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVIEW-01 | V13-3 BLOCKER: conditional native-review call fails lint | unit (ESLint RuleTester) | `node --test eslint-rules/no-conditional-native-review.test.cjs` | ✅ exists (Phase 42) — Wave 1 ADDS P36 fixtures |
| REVIEW-01 | V13-3 BLOCKER: grep backup catches `requestReview` + NPS-state co-occurrence | integration (shell) | `bash scripts/check-no-conditional-native-review.sh` | ❌ Wave 1 owns |
| REVIEW-01 | `useNativeReviewTrigger` hook is wired unconditionally | unit (vitest) | `npm run test:unit -- src/hooks/__tests__/useNativeReviewTrigger.test.ts` | ❌ Wave 2 owns |
| REVIEW-02 | Admin creates a rule via rule-builder UI (single-condition: event + cohort) | E2E (Playwright) | `playwright test e2e/admin/reviews-rule-builder.spec.ts` | ❌ Wave 4 owns |
| REVIEW-02 | SECDEF RPCs reject non-admin callers; admin_role re-checked server-side | RLS (vitest-e2e) | `npm run test:e2e:rls -- review_prompt_rules.test.ts` | ❌ Wave 4 owns |
| REVIEW-02 | Schema: `review_prompt_rules` + indexes + check constraints (name length, active default true) | unit (vitest SQL) | `npm run test:unit -- supabase/migrations/__tests__/p36_rules.test.ts` | ❌ Wave 1 owns |
| REVIEW-03 | Per-rule 30d cooldown enforced server-side | unit (vitest, Deno-native test) | `deno test --no-check supabase/functions/nps-trigger-decide/index.test.ts` | ❌ Wave 2 owns |
| REVIEW-03 | Global 60d + lifetime 5 cap enforced | unit (vitest) | same as above | ❌ Wave 2 owns |
| REVIEW-03 | Detractor 90d suppression after 1-2★ rating | unit (vitest) | same as above | ❌ Wave 2 owns |
| REVIEW-03 | Multi-device respect — cooldown applied across device boundary | E2E (Playwright multi-context) | `playwright test e2e/nps-cooldown-multi-device.spec.ts` | ❌ Wave 5 owns |
| REVIEW-04 | Promoter (4-5★) routes to PromoterCtaModal with cohort-targeted CTA | unit (vitest, RTL) | `npm run test:unit -- src/components/nps/__tests__/PromoterCtaModal.test.tsx` | ❌ Wave 3 owns |
| REVIEW-04 | `external_review_clicked` PostHog event fires with platform property | unit (vitest, mocked posthog) | same as above | ❌ Wave 3 owns |
| REVIEW-04 | Per-cohort CTA resolution by `primary_org_id` (consumer→Trustpilot; clinic→G2+Capterra) | unit (vitest) | `npm run test:unit -- supabase/functions/nps-trigger-decide/cta-resolve.test.ts` | ❌ Wave 2 owns |
| REVIEW-05 | Non-promoter (1-3★) submit creates ticket via `create_ticket_with_first_message` | unit (vitest, Deno) | `deno test --no-check supabase/functions/nps-feedback-submit/index.test.ts` | ❌ Wave 2 owns |
| REVIEW-05 | Subject = "Feedback from NPS rating"; body = textarea; priority = p3 | unit (above) | same | ❌ Wave 2 owns |
| REVIEW-05 | User JWT forwarded (not service-role) per Pitfall 4 | unit (above) | same — assert anon-key client used | ❌ Wave 2 owns |
| REVIEW-06 | PostHog variant key resolved server-side; copy + CTA varied | E2E (Playwright with PostHog mock) | `playwright test e2e/nps-ab-variant.spec.ts` | ❌ Wave 5 owns |
| REVIEW-06 | Ship-Winner button hits `ship-winner-flag` Edge Fn with flag_id + variant | unit (RTL) | `npm run test:unit -- src/admin/modules/reviews/__tests__/VariantGrid.test.tsx` | ❌ Wave 4 owns |
| REVIEW-07 | Funnel dashboard renders 3-bar funnel from `review_prompt_history` + `events_mirror` | unit (RTL with mocked data) | `npm run test:unit -- src/admin/modules/reviews/__tests__/FunnelDashboardPage.test.tsx` | ❌ Wave 4 owns |
| REVIEW-07 | Per-variant breakdown grid renders 1 row per experiment | unit (RTL) | same | ❌ Wave 4 owns |
| REVIEW-08 | CTA catalog seed includes 5 rows (3 web + 2 mobile-shell-gated) | unit (vitest SQL) | `npm run test:unit -- supabase/migrations/__tests__/p36_cta_catalog.test.ts` | ❌ Wave 1 owns |
| REVIEW-08 | Mobile-shell rows hidden in Surface B (web) but visible in Surface F (admin) | unit (RTL) | `npm run test:unit -- src/admin/modules/reviews/__tests__/CtaCatalogPage.test.tsx` | ❌ Wave 4 owns |

### Decision-to-Test Map (D-NN coverage)

| D-NN | Behavior tested | Test type | Where |
|------|------------------|-----------|-------|
| D-01 | Whitelist enforced; admin cannot pick non-whitelist event | unit | RuleFormPanel.test |
| D-02 | Rule form has exactly 1 trigger + 1 cohort field (no AND/OR) | unit | RuleFormPanel.test |
| D-03 | ESLint AST rule catches conditional native-review | unit | no-conditional-native-review.test.cjs (extended) |
| D-04 | Grep backup catches co-occurrence within 10 lines | integration | check-no-conditional-native-review.sh self-test |
| D-05 | Per-rule 30d + global 60d/5-lifetime | unit | nps-trigger-decide cooldown.test |
| D-06 | Detractor 90d after 1-2★ | unit | nps-trigger-decide.cooldown.test |
| D-07 | Lifetime cap absolute — never reset | unit | nps-trigger-decide.cooldown.test |
| D-08 | Multi-device cooldown respect | E2E | playwright multi-context |
| D-09 | 5-star UI; backdrop counts as fired | unit | NPSPromptModal.test |
| D-10 | Non-promoter submit creates ticket subject "Feedback from NPS rating" | unit | nps-feedback-submit.test |
| D-11 | Promoter modal shows platform CTAs | unit | PromoterCtaModal.test |
| D-12 | Dismiss-X + backdrop both count as fired | unit | NPSPromptModal.test |
| D-13 | CTA catalog includes mobile-shell rows but Surface B hides them | unit | CtaCatalogPage.test + PromoterCtaModal.test |
| D-14 | Per-cohort auto-targeting by primary_org_id | unit | nps-trigger-decide.cta-resolve.test |
| D-15 | `external_review_clicked` fires on platform button click | unit | PromoterCtaModal.test |
| D-16 | Unclaimed CTA falls back to "Thanks for rating!" no-CTA | unit | PromoterCtaModal.test |
| D-17 | Native trigger uses same D-01 whitelist | unit | useNativeReviewTrigger.test (verifies trigger handler doesn't filter by web/native) |
| D-18 | `native_review_prompts` table accepts iOS + android entries | unit (SQL) | p36_native_review_prompts.test |
| D-19 | Web quota (5) separate from native quota (3 per platform) | unit | nps-trigger-decide.cooldown.test (asserts web reads from review_prompt_history only, not native_review_prompts) |
| D-20 | `useNativeReviewTrigger()` web returns `{shown:false}` | unit | useNativeReviewTrigger.test |
| D-21 | ESLint rule catches conditional `reviewShim.request()` | unit | no-conditional-native-review.test.cjs (P36 fixtures) |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run typecheck && npm run test:unit -- <touched-file-paths>` + (if eslint-rules/ touched) `node --test eslint-rules/no-conditional-native-review.test.cjs`
- **Per wave merge:** `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e:rls` + (if any SQL touched) `supabase db push --linked`
- **Phase gate:** Full `npm test` (vitest + playwright) green + `npm run check-bundle-budget` green + `bash scripts/check-no-conditional-native-review.sh` exits 0

### Wave 0 Gaps
- [ ] `eslint-rules/no-conditional-native-review.test.cjs` already exists — Wave 1 EXTENDS with P36 fixtures (no new test file)
- [ ] `supabase/migrations/__tests__/` — verify directory + helper exist; create `p36_rules.test.ts`, `p36_cta_catalog.test.ts`, `p36_native_review_prompts.test.ts` SQL assertion tests
- [ ] `supabase/functions/nps-trigger-decide/` — net-new directory; create `index.ts` + `index.test.ts` (Deno) + `cooldown.test.ts` + `cta-resolve.test.ts`
- [ ] `supabase/functions/nps-feedback-submit/` — net-new directory; create `index.ts` + `index.test.ts` (Deno)
- [ ] `src/components/nps/__tests__/` — net-new directory; create per-modal `.test.tsx`
- [ ] `src/hooks/__tests__/useNativeReviewTrigger.test.ts` — net-new
- [ ] `src/admin/modules/reviews/__tests__/` — net-new directory
- [ ] `e2e/admin/reviews-rule-builder.spec.ts` — net-new
- [ ] `e2e/nps-cooldown-multi-device.spec.ts` — net-new
- [ ] `e2e/nps-ab-variant.spec.ts` — net-new
- [ ] `scripts/check-no-conditional-native-review.sh` — net-new (Wave 1)
- [ ] Verify `vitest-e2e.config.ts` covers new RLS tests in `supabase/migrations/__tests__/` (it does — pattern matches per P37)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase GoTrue + JWT verification in every Edge Fn (verify via `auth.getUser()` against admin client) |
| V3 Session Management | partial | Cooldown state is server-side per D-08; client localStorage never stores cooldown |
| V4 Access Control | yes | Pattern S1 dual-layer: client `surfaceCheck('admin.reviews.edit')` (UI hint) + SECDEF RPC re-checks `profiles.admin_role` server-side. RLS policies on `review_prompt_rules` deny direct DML; force RPC path. |
| V5 Input Validation | yes | Feedback textarea: server slice to 4000 chars; client UI enforces min-10. Rule name: 1-60 char CHECK constraint. Trigger event: enum validated against `nps_trigger_eligible` whitelist on insert. |
| V6 Cryptography | n/a | No new HMAC/signing requirements in P36. Existing reply-threading HMAC in P37 handles ticket replies. |

### Known Threat Patterns for {React-19 + Supabase + Tailwind-v4}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client tampers with cooldown state | Tampering | Server-side cooldown via `review_prompt_history` (D-08). Client never trusted. |
| Admin role spoofing to create rules | Elevation of Privilege | SECDEF RPC checks `profiles.admin_role` server-side (Pattern S1 from P34); client `surfaceCheck` is UI hint only. |
| Conditional native-review fire (App Store policy violation) | Tampering/Repudiation (vendor policy) | V13-3 BLOCKER: ESLint AST rule (D-03) + grep backup (D-04); 2-gate defense. |
| User submits feedback as another user (impersonation) | Spoofing | `nps-feedback-submit` forwards user JWT; RPC derives user_id from `auth.uid()` — request body never names another user. |
| External CTA URL injection (admin pastes malicious URL pattern) | Tampering | `review_cta_catalog` is admin-edit-only via SECDEF; URLs CHECK-validated against `^https?://` prefix. Surface B opens with `rel="noopener noreferrer"`. |
| XSS via feedback textarea content stored in ticket body | Tampering | Ticket body rendered via `react-markdown` + dompurify (P37 HELP-07); raw HTML stripped. |
| PII in PostHog events | Information Disclosure | `external_review_clicked` event includes platform only (no rating value, no feedback text). Verify in event registry definition. |
| Rate-limit abuse on `nps-trigger-decide` | Denial of Service | Edge Fn is idempotent; server-side cooldown bounds work-per-user. Add Supabase Function rate limit if outright abuse observed. |
| Sensitive `external_review_clicked` event leak via adblocker | Information Disclosure (low) | Server-side captureServer dual-write to events_mirror per Phase 24 D-13. |

## Project Constraints (from CLAUDE.md)

- **Browser-only SPA. No SSR.** All NPS modal logic runs in browser. Edge Fns are Deno (Supabase) — not Node.js.
- **Local-first preserved.** NPS feature is opt-in surfacing; offline users see nothing (no event → no decide call). Acceptable.
- **Not HIPAA-covered yet.** Avoid pushing P36 into PHI-touching territory. Feedback textarea content goes to helpdesk tickets — those tickets ARE PHI-tagged for clinician role per P37 D-01 (RPC derives `phi` flag server-side from caller's org role). NPS feedback from consumer users is non-PHI by default. ✓ no P36-specific HIPAA escalation.
- **Tailwind v4 unlayered-reset gotcha.** Wrap any new resets in `@layer base`. UI-SPEC says no new tokens — should be safe.
- **chart.js + framer-motion + lucide-react are heavy.** Use existing chunk; do NOT eagerly import chart.js from NPS modals. ESLint `import-x/no-restricted-paths` zone keeps admin code out of consumer modal chunks (Pitfall 6).
- **Strict TypeScript:** No `any`. `@typescript-eslint/no-explicit-any: 'error'` is project policy.
- **Persisted data via Zustand `partialize`.** No NPS state in localStorage — server-side per D-08.
- **`useReducedMotion()` must gate every animation.** UI-SPEC explicit on this for all 6 surfaces.
- **Tap target ≥44px on mobile.** UI-SPEC explicit.
- **GSD workflow enforcement.** All code changes go through `/gsd-execute-phase` — no direct edits.

## Sources

### Primary (HIGH confidence)
- `/Users/karstenhaldan/minisite/leanshot/eslint-rules/no-conditional-native-review.cjs` — existing AST rule (Phase 42 D-20). Lines 45-47 explicitly address Phase 36 executors.
- `/Users/karstenhaldan/minisite/leanshot/eslint.config.js` lines 16-19 — rule already registered.
- `/Users/karstenhaldan/minisite/supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` — `create_ticket_with_first_message` RPC signature + auth.uid() requirement.
- `/Users/karstenhaldan/minisite/supabase/functions/cancellation-feedback-to-ticket/index.ts` — proven pattern for user-JWT-forwarding to SECDEF RPC.
- `/Users/karstenhaldan/minisite/supabase/functions/ship-winner-flag/index.ts` — Ship-Winner Edge Fn contract.
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx` — Ship-Winner client contract reuse target.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/modules.ts` lines 139-146 — `reviews` placeholder to replace.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/analytics/events.ts` — event registry shape + extension target for `nps_trigger_eligible` flag.
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/posthog-server.ts` — captureServer + events_mirror dual-write.

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Phase 35 currently executing (impacts A1 assumption).
- `.planning/phases/35-m3-gamification-engine/35-CONTEXT.md` — `level_up`, `streak_milestone_*`, `weekly_challenge_completed` event ownership.
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/` — `activation_completed` event provenance.

### Tertiary (LOW confidence)
- v1.4 Capacitor `@capacitor-community/in-app-review` API surface — [ASSUMED based on package name + Phase 16 references]; verify at v1.4 plan time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep verified in package.json
- Architecture: HIGH — every primitive verified via direct file read
- Pitfalls: HIGH — derived from existing production code patterns + memory pointers in CONTEXT.md
- D-01 trigger whitelist event availability: MEDIUM — Phase 35 events depend on Phase 35 completion (in-flight per STATE.md)
- v1.4 Capacitor library: LOW — assumed from package naming convention; verify at v1.4

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (30 days for this stable stack; re-verify if Phase 35 or Phase 37 shipping reshuffles dependencies)
