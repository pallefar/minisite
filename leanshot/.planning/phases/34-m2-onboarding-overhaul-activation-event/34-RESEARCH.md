# Phase 34: M2 Onboarding Overhaul + Activation Event — Research

**Researched:** 2026-05-20
**Domain:** Consumer onboarding funnel — anonymous sessions, OAuth, activation event, A/B step builder
**Confidence:** HIGH (codebase verified) / MEDIUM (PostHog Experiments REST API) / HIGH (existing patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Activation fires when the user completes the first action mapped to their stated goal — NOT universal first-log.
- **D-02:** 7-day activation window from `signup_completed`. After day 7 → `never_activated_within_window` cohort.
- **D-03:** Single event name `activation_completed` with `{ goal_type, action_type, window_days: 7, days_since_signup, source: 'first_log' }`.
- **D-04:** Fire-once per user. Never re-fires even if goal changes.
- **D-05:** Server-side capture via Phase 24 D-13 Edge Function path (`posthog-node` + `await shutdownPostHog()`).
- **D-06:** Cookie-keyed `anonymous_sessions` table. Cookie name `_ls_anon` (recommended; planner picks final name).
- **D-07:** Multi-device race — RICHEST DATA WINS (highest non-null preference + draft entry count). Server-side merge, deterministic, no user prompt.
- **D-08:** Merge carries (a) preferences, (b) draft entries, (c) PostHog alias, (d) `_aff` cookie / aff_code per Phase 19 pattern.
- **D-09:** 30-day TTL — weekly pg_cron deletes `last_activity_at < now() - 30d AND merged_user_id IS NULL`.
- **D-10:** Anonymous_sessions PII posture — RLS deny-all for anon role; service-role-only for merge Edge Fn. Sentry/PostHog masking per Phase 25.
- **D-11:** 8-goal catalog (single-select): `lose-weight`, `build-muscle`, `new-prescription`, `build-habit`, `doctor-monitored`, `family-supporter`, `manage-symptoms`, `track-with-vial-supply`. Stored as `profiles.primary_goal`.
- **D-12:** Hybrid 3-card first-action UI — recommended card visually emphasized; other 2 still clickable. Activation fires on whichever card the user taps.
- **D-13:** Goal → first-action mapping (see CONTEXT.md table). `family-supporter` → "Coming soon" waitlist card; activation treated as `build-habit` proxy.
- **D-14:** Goal editable post-signup in Settings.
- **D-15:** Activation NEVER re-fires after goal change.
- **D-16:** Step builder MVP — question-type palette (text, single-select, multi-select, scale, weight, date, NPS, custom-component) + drag-reorder. Live preview is separate route NOT WYSIWYG side-by-side.
- **D-17:** Ship Winner = write-new-version + flag-flip to 100%. Rollback = flag-flip back.
- **D-18:** Superadmin-only ship permission — `surfaceCheck('onboarding.ship_winner')`.
- **D-19:** Default A/B split 50/50; admin-overridable.
- **D-20:** PostHog Experiments (not raw feature flags) for confidence intervals + sample-size guards.

### Claude's Discretion
- Auth visual hierarchy (primary CTA, button order)
- Smart defaults conflict resolution: prefer profile > browser > IP; no geolocation prompt
- Social proof: live counter (suggest rolling 7d signups), testimonial rotation (suggest 30s), privacy-mode opt-out (suggest single toggle)
- `anonymous_sessions` column shapes, indexes, RLS exact predicates

### Deferred Ideas (OUT OF SCOPE)
- Caregiver / family-supporter data model
- Native iOS Apple Sign In (v1.4 mobile-shell)
- Localized onboarding step copy (ES)
- A/B auto-stop on confidence-interval thresholds
- Personalized recommended-card ordering via Phase 38 recommender
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONBOARD-01 | Value-first anonymous preview; cookie-keyed row; merge to authenticated on signup | D-06..D-10 + anonymous_sessions schema + merge Edge Fn pattern |
| ONBOARD-02 | Magic-link + Google OAuth + Apple OAuth; password optional; ≥44px tap targets | `signInWithOAuth` + `signInWithOtp` patterns + Apple web setup |
| ONBOARD-03 | One question/screen mobile (375px); progress bar; back nav; resumable via Supabase row | `onboarding_flows.config` JSONB step config (mirrors P31) |
| ONBOARD-04 | Smart defaults from Accept-Language + IP | Existing `deriveSignupLocaleAndUnits` pattern + Claude's Discretion |
| ONBOARD-05 | Onboarding ends by completing one real task; activation event fires | D-01..D-05 + activation Edge Fn |
| ONBOARD-06 | Activation event defined in TAXO registry + measured per cohort | Extend `events.ts` with `activation_completed`; server_only flag |
| ONBOARD-07 | Admin drag-drop step builder (question type / copy / validation / branching) | `SortableTreePanel` + `org_onboarding_flows` JSONB mirror |
| ONBOARD-08 | A/B variants via PostHog Experiments + `getFeatureFlagPayload`; ship winner | PostHog REST PATCH /api/projects/:id/feature_flags/:id |
| ONBOARD-09 | Per-step funnel analytics in admin (views/completions/drop-off/time-on-step) | PostHog Experiments insight API + admin module pattern |
| ONBOARD-10 | Mobile Lighthouse ≥90 on /onboard | Deferred-init + lazy chunk + image preload posture |
| ONBOARD-11 | Anon→auth merge handles race (two devices); richest-data wins | D-07 + server-side merge SECDEF RPC |
| ONBOARD-12 | Social proof: live counter + 3 rotating testimonials + privacy-mode opt-out | Supabase Realtime count + Claude's Discretion |
| ONBOARD-13 | First-action surface per goal; D-12 3-card hybrid UI | D-11..D-15 goal mapping |
</phase_requirements>

---

## Summary

Phase 34 rewrites the consumer onboarding funnel into a cookie-keyed anonymous preview → authenticated merge pipeline with goal-aware activation, OAuth methods, and an admin A/B step builder. It also locks the `activation_completed` event contract that Phases 36, 38, and 39 all consume.

The codebase has substantial load-bearing infrastructure already in place: `SortableTreePanel` (dnd-kit v6 reuse from Phase 31), `org_onboarding_flows` JSONB schema to mirror, `posthog-server.ts` capture + `shutdownPostHog()` pattern, `aliasAnonymousToUid()` in `identify.ts`, the Phase 38 `activation_events` table shell (already created — Phase 34 ALTERs it, does not create), and `surfaceCheck()` in `src/lib/org.ts`. Phase 34 predominantly extends and wires these building blocks rather than building from scratch.

Two genuine greenfield pieces: the `anonymous_sessions` table (no prior version exists) and the consumer `onboarding_flows` table (sibling to `org_onboarding_flows`, not the same table). The PostHog "Ship Winner" programmatic flag-flip is a REST PATCH call to `POSTHOG_PERSONAL_API_KEY`-gated endpoint — the personal API key must be stored as a Supabase Function Secret (not a VITE_ var) and called from an Edge Function, not the browser.

**Primary recommendation:** Build in plan order: schema + RLS → auth methods + anonymous merge → consumer step renderer → activation Edge Fn → step builder admin → A/B experiments → analytics + Lighthouse budget. Each layer is independently testable before the next lands.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Anonymous session creation | API / Edge Fn | Browser (cookie write) | Service-role INSERT into `anonymous_sessions`; browser only reads/writes the `_ls_anon` cookie |
| Anonymous → auth merge | API / Edge Fn | — | Requires service-role to read + delete `anonymous_sessions`; race-safe via DB advisory lock or CTE |
| Magic-link / OAuth sign-in | Browser | Supabase Auth | `signInWithOtp` + `signInWithOAuth` client calls; session resolution from Supabase GoTrue |
| Apple OAuth Services ID | External (Apple Developer) | Supabase Auth config | Apple requires a registered Services ID + `.p8` secret; 6-month renewal cadence |
| Goal-aware first-action UI | Browser / Client | — | Pure React rendering; goal stored in `profiles.primary_goal` |
| Activation event capture | API / Edge Fn | — | D-05: server-side only; `captureServer()` + `shutdownPostHog()` |
| Fire-once activation guard | Database / API | — | `activation_events.activated_at IS NOT NULL` check in Edge Fn before capture |
| Step builder drag-reorder | Browser / Client (Admin) | — | dnd-kit `SortableTreePanel` already wired in P31; extend to `OnboardingStepNode` |
| A/B variant resolution | Browser | Supabase Edge Fn | `posthog.getFeatureFlagPayload(flagKey)` in client; `featureFlagPayload` from `posthog-node` server-side |
| Ship Winner flag-flip | API / Edge Fn | — | REST PATCH to PostHog API; personal API key is a Function Secret; never browser-callable |
| Per-step funnel analytics | Browser (read) | PostHog Insights REST | Admin panel queries PostHog REST for step view/completion counts |
| Anonymous session TTL | Database | pg_cron | Weekly direct SQL DELETE on `anonymous_sessions` |
| Lighthouse ≥90 budget | Browser / Build | CDN / Static | Lazy-chunk + deferred-init strategy for onboarding route |

---

## Standard Stack

### Core (all verified in codebase)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@supabase/supabase-js` | `^2.105.4` | Auth (magic-link, OAuth), DB, RLS | `[VERIFIED: package.json]` |
| `posthog-js` | `^1.372.10` (latest 1.374.2) | Client-side feature flag eval, experiment variants, alias | `[VERIFIED: package.json + npm]` |
| `posthog-node` via `npm:posthog-node@5.10.4` | `5.10.4` | Server-side event capture in Edge Fns | `[VERIFIED: posthog-server.ts line 33]` |
| `@dnd-kit/core` | `6.3.1` | Drag context for step builder | `[VERIFIED: package.json]` |
| `@dnd-kit/sortable` | `10.0.0` | `useSortable` + `SortableContext` | `[VERIFIED: package.json]` |
| `@dnd-kit/utilities` | `3.2.2` | `CSS` transform helper | `[VERIFIED: package.json]` |
| `framer-motion` | `^11.11.17` | Step transition animations (already in project) | `[VERIFIED: package.json]` |
| `zod` | (already installed via events.ts) | Step config JSON validation | `[VERIFIED: events.ts import]` |

### No new npm installs required
All dependencies are already present. The only new integration is the PostHog REST API (called from an Edge Function via `fetch`, no new npm package).

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (anonymous visitor)
  │  lands on /onboard
  ▼
[App.tsx view selector]
  │  no auth + no completed_onboarding_at
  ▼
[AnonymousPreviewLayer]  ◄── reads `_ls_anon` cookie
  │  first hit → POST /functions/v1/create-anon-session
  │              (service-role INSERT into anonymous_sessions)
  ▼
[useConsumerOnboardingFlow hook]  ──→  [onboarding_flows] (Supabase)
  │  resolves active flow + variant via PostHog flag payload
  ▼
[ConsumerOnboardingRenderer]  (config-driven, mirrors OrgOnboardingFlowRenderer)
  │  step-by-step questions
  │  draft written to anonymous_sessions.draft_entries JSONB
  ▼
[Auth step: magic-link | Google | Apple OAuth]
  │  supabase.auth.signInWithOtp / signInWithOAuth
  ▼
[merge-anon-session Edge Fn]  (service-role)
  │  reads anonymous_sessions WHERE cookie_id = $_ls_anon
  │  richest-data wins (D-07 population score)
  │  copies preferences + draft_entries → profiles + draft tables
  │  PostHog alias(anonDistinctId → uid)
  │  _aff cookie propagation (D-08d)
  │  DELETE FROM anonymous_sessions WHERE id = winner_id
  ▼
[First-Action Surface (3-card hybrid UI, D-12)]
  │  user taps a card → calls qualifying action Edge Fn
  ▼
[qualifying-action Edge Fn]
  │  checks activation_events WHERE user_id = $uid
  │  if activated_at IS NULL AND days_since_signup ≤ 7:
  │    captureServer(activation_completed, {...})
  │    INSERT INTO activation_events (user_id, activated_at, ...)
  │    await shutdownPostHog()
  ▼
[Dashboard] — completed_onboarding_at stamped

────────────────────────────────────────
Admin path (superadmin)

[OnboardingBuilderModule]
  │  SortableTreePanel<OnboardingStepNode>
  │  Palette → drag into step sequence
  ▼
[save_consumer_onboarding_flow SECDEF]
  │  version append + is_active swap (mirrors save_org_onboarding_flow)
  ▼
[A/B Experiment]
  │  PostHog Experiment flag bound to onboarding_flows.id
  │  useConsumerOnboardingFlow reads getFeatureFlagPayload(flagKey)
  ▼
[Ship Winner button — superadmin only]
  │  surfaceCheck('onboarding.ship_winner') CLIENT HINT
  │  → ship-winner Edge Fn:
  │      INSERT new onboarding_flows version (winner variant config)
  │      PATCH PostHog flag to 100% rollout on new variant
  │      (uses POSTHOG_PERSONAL_API_KEY Function Secret)
```

### Recommended Project Structure

```
src/
├── components/
│   ├── onboarding/                     # REWRITE of existing folder
│   │   ├── OnboardingFlow.tsx          # Top-level; render-branches consumer vs org
│   │   ├── ConsumerOnboardingRenderer.tsx  # NEW: config-driven consumer steps
│   │   ├── AnonymousPreviewLayer.tsx   # NEW: anonymous cookie + preview dashboard
│   │   ├── FirstActionSurface.tsx      # NEW: 3-card hybrid UI (D-12)
│   │   ├── ProgressIndicator.tsx       # KEEP: existing component
│   │   └── UnitToggle.tsx              # KEEP: existing component
│   └── admin/
│       └── onboarding-builder/         # NEW admin module
│           ├── OnboardingBuilderModule.tsx
│           ├── StepPalette.tsx
│           ├── StepPropertyPanel.tsx
│           ├── OnboardingABPanel.tsx
│           └── OnboardingFunnelTab.tsx
├── lib/
│   ├── onboarding-builder/
│   │   ├── use-org-onboarding-flow.ts  # KEEP unchanged
│   │   └── use-consumer-onboarding-flow.ts  # NEW: sibling hook
│   └── analytics/
│       └── events.ts                   # ADD activation_completed event
supabase/
├── migrations/
│   ├── 20270706000001_p34_anonymous_sessions.sql
│   ├── 20270706000002_p34_onboarding_flows_consumer.sql
│   ├── 20270706000003_p34_profiles_primary_goal.sql
│   ├── 20270706000004_p34_activation_events_alter.sql  # ALTER existing shell
│   └── 20270706000005_p34_anon_session_ttl_cron.sql
└── functions/
    ├── create-anon-session/
    ├── merge-anon-session/
    ├── record-activation/
    └── ship-winner-flag/
```

---

## Code Anchors (verified patterns to reuse directly)

### Pattern 1: Existing dnd-kit sortable panel (SortableTreePanel)

`src/components/ui/SortableTreePanel.tsx` — extracted from Phase 15 BlockTreePanel in Plan 31-00b specifically for reuse. The step builder's drag-reorder uses this DIRECTLY with `OnboardingStepNode` as the generic type parameter.

```typescript
// Source: src/components/ui/SortableTreePanel.tsx lines 46-66
// Already used by Plan 31-05 for org_onboarding_flows steps.
// Phase 34 step builder reuses identically.
<SortableTreePanel<OnboardingStepNode>
  items={steps}
  getId={(s) => s.id}
  onReorder={(next) => setSteps(next)}
  renderItem={(step, index, isDragging) => <StepRow step={step} index={index} dragging={isDragging} />}
  announceItemLabel={(s) => s.type}
/>
```

**CRITICAL constraint** `[VERIFIED: vite.config.ts lines]`: `@dnd-kit/*` MUST stay inside the `vendor-dnd-kit` lazy chunk. The CI guard `scripts/assert-clinic-bundle-budget.sh` fails on any static `@dnd-kit` import in the index chunk. The onboarding builder MUST be lazy-loaded behind a `React.lazy()` boundary (it already will be as an admin module).

### Pattern 2: Server-side PostHog capture (MUST follow exactly)

```typescript
// Source: supabase/functions/_shared/posthog-server.ts
// CRITICAL: every Edge Fn handler MUST wrap in try/finally + shutdownPostHog()

import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

Deno.serve(async (req) => {
  try {
    // ... business logic ...
    captureServer({
      userId: authUserId,  // ALWAYS Supabase auth.users.id (D-13)
      event: 'activation_completed',
      properties: {
        goal_type: 'lose-weight',
        action_type: 'first_weight_log',
        window_days: 7,
        days_since_signup: 3,
        source: 'first_log',
      },
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } finally {
    await shutdownPostHog(); // NEVER omit — Deno isolate tears down immediately after Response
  }
});
```

**CRITICAL:** `captureServer()` also dual-writes to `events_mirror` (Phase 27 extension). The `activation_completed` event will appear there automatically.

### Pattern 3: activation_completed event — extend events.ts

The existing `activation_first_log` event (line 79) is SUPERSEDED by `activation_completed`. The plan MUST:
1. Add `activation_completed` with `server_only: true` to `EVENTS` in `src/lib/analytics/events.ts`.
2. Mark `activation_first_log` as deprecated via a `@deprecated` JSDoc comment (ADDITIVE-ONLY rule blocks removal — the lint rule in `eslint-rules/additive-only-events.js` would fail on delete).
3. Update `Phase38Event` union in `posthog-server.ts` to include `'activation_completed'`.

```typescript
// Add to EVENTS in src/lib/analytics/events.ts
activation_completed: {
  name: 'activation_completed',
  version: 1,
  phi: false,
  owner: 'product',
  server_only: true,          // D-05: Edge Fn only; never browser-capturable
  aem_priority: 3,            // replaces activation_first_log at AEM slot 3
  description: 'User completed first qualifying action within the 7-day activation window.',
  payload: z.object({
    goal_type: z.enum([
      'lose-weight', 'build-muscle', 'new-prescription', 'build-habit',
      'doctor-monitored', 'family-supporter', 'manage-symptoms', 'track-with-vial-supply',
    ]),
    action_type: z.string(),           // e.g. 'first_weight_log', 'first_injection_log'
    window_days: z.literal(7),
    days_since_signup: z.number().int().nonnegative(),
    source: z.literal('first_log'),
  }),
},
```

### Pattern 4: PostHog alias at merge time (already in identify.ts)

```typescript
// Source: src/lib/analytics/identify.ts lines 26-39
// aliasAnonymousToUid already exists and is idempotent (localStorage marker).
// D-08c: call during merge-anon-session Edge Fn (server-side alias via posthog-node)
// AND also client-side after merge completes (belt-and-suspenders).
//
// Server-side alias call in Edge Fn:
const ph = getClient();
if (ph) {
  ph.alias({ distinctId: supabaseUid, alias: anonDistinctId });
}
// The posthog-node alias() call merges the pre-auth event stream into the uid.
```

**Note:** The existing `aliasAnonymousToUid` in `identify.ts` uses `posthog.alias(supabaseUid, anonDistinctId)` with a localStorage guard. This is fine for client-side; the server-side version in the Edge Fn uses `posthog-node`'s `client.alias({ distinctId, alias })` API which has a different call signature.

### Pattern 5: surfaceCheck for ship winner gate (already in org.ts)

```typescript
// Source: src/lib/org.ts — surfaceCheck() is already defined.
// D-18: add 'onboarding.ship_winner' to the owner role's permission set.
// ROLE_PERMISSIONS['owner'] already has 14 keys; add the new one.
// The DB-level SECDEF for ship-winner-flag Edge Fn does the real enforcement.
//
// In ROLE_PERMISSIONS constant — add to owner set:
'onboarding.ship_winner',
```

**SECURITY NOTE** from org.ts line 22: `surfaceCheck` is a CLIENT HINT only. The `ship-winner-flag` Edge Fn MUST re-verify the caller is a superadmin via service-role JWT claim or admin role check before performing the PATCH.

### Pattern 6: pg_cron for anonymous session TTL (matches Phase 38 pattern)

```sql
-- Source: supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql
-- Named dollar-quote tags are MANDATORY per [[reference_postgres_dollar_quote_nesting_in_cron_body]]
-- Use: outer $cron$...$cron$, inner $anon_ttl$...$anon_ttl$

select cron.schedule(
  'phase34-anon-session-ttl-weekly',
  '0 3 * * 0',   -- Sunday 03:00 UTC weekly
  $cron$
  do $anon_ttl$
  begin
    delete from public.anonymous_sessions
     where last_activity_at < now() - interval '30 days'
       and merged_user_id is null;
  exception when others then
    raise notice 'phase34-anon-session-ttl-weekly: error % — continuing', sqlerrm;
  end;
  $anon_ttl$;
  $cron$
);
```

### Pattern 7: useOrgOnboardingFlow → useConsumerOnboardingFlow sibling

```typescript
// Source: src/lib/onboarding-builder/use-org-onboarding-flow.ts
// useConsumerOnboardingFlow mirrors this exactly but queries onboarding_flows
// (consumer table) instead of org_onboarding_flows.
//
// Additional concern: resolve variant_id from PostHog flag payload.
// posthog.getFeatureFlagPayload('onboarding-ab') returns { version_id: string } or null.

export function useConsumerOnboardingFlow(): ConsumerOnboardingFlowState {
  const [state, setState] = useState(INITIAL_STATE);
  useEffect(() => {
    async function fetch() {
      // 1. Get PostHog flag payload to resolve variant version_id
      const payload = posthog.getFeatureFlagPayload('onboarding-ab');
      const versionId = (payload as { version_id?: string } | null)?.version_id ?? null;
      // 2. Query onboarding_flows WHERE id = versionId (if set) or is_active = true (control)
      const { data } = await supabase
        .from('onboarding_flows')
        .select('id, config, version')
        .eq(versionId ? 'id' : 'is_active', versionId ?? true)
        .maybeSingle();
      // ...
    }
    void fetch();
  }, []);
  return state;
}
```

### Pattern 8: PostHog Ship Winner REST API call

The "Ship Winner" action calls PostHog's REST API to PATCH the feature flag to 100% rollout. This MUST come from an Edge Function — never the browser.

```typescript
// In ship-winner-flag Edge Fn:
// Source: [CITED: https://posthog.com/docs/api/feature-flags]

const POSTHOG_API_HOST = 'https://us.i.posthog.com';
const personalApiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY'); // Function Secret
const projectId = Deno.env.get('POSTHOG_PROJECT_ID');            // Function Secret
const flagId = body.flag_id; // passed by admin UI

const res = await fetch(
  `${POSTHOG_API_HOST}/api/projects/${projectId}/feature_flags/${flagId}/`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${personalApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        groups: [{ properties: [], rollout_percentage: 100 }],
        multivariate: null,  // flatten to single variant
      },
    }),
  },
);
```

**Required Function Secrets:** `POSTHOG_PERSONAL_API_KEY` (scope: `feature_flag:write`) and `POSTHOG_PROJECT_ID`. The personal API key is different from `POSTHOG_PROJECT_KEY` (the write-only capture key already wired in posthog-server.ts). Store via `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp POSTHOG_PERSONAL_API_KEY=...`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-reorder in step builder | Custom mouse-event drag | `SortableTreePanel<OnboardingStepNode>` | Already exists; keyboard a11y, reduced-motion, `closestCenter`, `verticalListSortingStrategy` all wired |
| PostHog flag evaluation | Custom flag table + logic | `posthog.getFeatureFlagPayload('onboarding-ab')` | Handles bucketing, persistence, experiment exposure tracking |
| PostHog alias/merge | Custom event-stitching | `posthog.alias()` client + `client.alias()` server | PostHog's identity merge is server-side and handles multi-device idempotently |
| Fire-once activation guard | In-memory check | `activation_events.activated_at IS NOT NULL` DB check | Survives process restarts; correct under concurrent Edge Fn invocations |
| Rich-data population score | Custom ranking logic | SQL expression: `(count of non-null jsonb keys) + (jsonb_array_length of draft_entries)` | Deterministic, atomic, no race — single SQL CTE selects the winner row |
| Anonymous session TTL | Application-level cron | `pg_cron` weekly direct DELETE | Exact same pattern as Phase 38; no Edge Fn needed for a simple DELETE |
| Apple OAuth secret | Long-lived credential | `.p8` key → JWT signed with short expiry | Apple REQUIRES client secret refresh every 6 months; Supabase handles the JWT generation from the `.p8` |

---

## Common Pitfalls

### Pitfall 1: Double-`#` URL with OAuth implicit-grant + hash-router

**What goes wrong:** `signInWithOAuth` for Google/Apple defaults to implicit-grant flow. The `redirectTo` uses the `${origin}/#/auth/verify` pattern. The resulting URL is `${origin}/#/auth/verify#access_token=…` — a double-`#`. `supabase-js`'s `parseParametersFromURL` reads post-`#` substring as URLSearchParams; the first key becomes `/auth/verify#access_token` (the whole literal), not `access_token`. Session never materializes.

**Why it happens:** Browser treats only the first `#` as the fragment delimiter. The Phase 6 hotfix in `main.tsx` already handles this for magic-link flows (lines 51-60), but OAuth redirects land on a DIFFERENT URL shape (the provider redirects to a callback URL, not directly to the origin hash).

**How to avoid:** Use PKCE flow for OAuth instead of implicit-grant. With PKCE:
```typescript
// Source: [CITED: supabase.com/docs/guides/auth/social-login/auth-apple]
await supabase.auth.signInWithOAuth({
  provider: 'apple',   // or 'google'
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
    // PKCE is default in supabase-js v2 — no extra flag needed
  },
});
```
Then handle `?code=` query param at `/auth/callback` via `exchangeCodeForSession()`. This route must be added to App.tsx's URL router logic (path-based, not hash-based, because OAuth providers cannot redirect to `#` fragments).

**Warning signs:** Users report being looped back to sign-in after clicking Google/Apple button. Supabase auth debug console shows no session created.

### Pitfall 2: Apple Services ID ≠ App ID + 6-month key expiry

**What goes wrong:** Using the App Bundle ID (`com.example.app`) as the Services ID for web OAuth fails. Apple requires a SEPARATE Services ID (`com.example.app.web`). Also: the `.p8` key used to generate the client secret must be rotated every 6 months or sign-in breaks silently.

**How to avoid:**
- Register a new Services ID in Apple Developer → Certificates, IDs & Profiles → Identifiers → Services IDs.
- Configure the Services ID with domain `ytnsipxxmzgaebkqmokp.supabase.co` and redirect `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`.
- Set calendar reminder 5 months out to regenerate the client secret from the `.p8` file.
- Store the generated client secret as a Supabase Dashboard Auth secret (not in code).

**Warning signs:** `Unknown client` error from Supabase auth endpoint, or 401 errors 6+ months after setup.

### Pitfall 3: Anonymous session merge race — concurrent Edge Fn invocations

**What goes wrong:** Two requests arrive simultaneously (mobile + desktop both hitting the merge endpoint at signup). Both read the anonymous_sessions rows, both select a "winner," and both try to DELETE it — one gets 0 rows but returns success, and the merge fires twice, potentially creating two draft entries or double-aliasing.

**How to avoid:** Wrap the merge CTE in a `SELECT … FOR UPDATE SKIP LOCKED` or use a Postgres advisory lock keyed on `user_id`. The `save_org_onboarding_flow` SECDEF in Phase 31 uses `pg_advisory_xact_lock(org_id::text::bigint)` — use the same pattern with `auth.uid()::text::bigint`.

```sql
-- In merge_anon_session SECDEF body:
PERFORM pg_advisory_xact_lock(('x' || md5(auth.uid()::text))::bit(64)::bigint);
-- Then SELECT winner row and DELETE — now atomic per user
```

**Warning signs:** Multiple `activation_completed` events for the same user, or duplicate draft log entries post-merge.

### Pitfall 4: `activation_first_log` vs `activation_completed` — AEM slot conflict

**What goes wrong:** Both events are at `aem_priority: 3`. The AEM top-8 register enforced by the ESLint rule blocks two events at the same slot. Phase 34's new `activation_completed` supersedes `activation_first_log`, but the ADDITIVE-ONLY rule blocks deletion.

**How to avoid:**
- Set `activation_completed` at `aem_priority: 3`.
- Add `aem_dropped: true` to `activation_first_log` (removing `aem_priority`) — this is additive (adding a field) not removing, so the lint rule permits it.
- Keep `aem_priority` off `activation_first_log` going forward.

### Pitfall 5: dnd-kit static import leaks into index chunk

**What goes wrong:** If any file on the STATIC import graph touches `@dnd-kit/*` (even transitively), the CI guard `scripts/assert-clinic-bundle-budget.sh` fails the build with "dnd-kit index-leak."

**How to avoid:** The `OnboardingBuilderModule` and all files importing `SortableTreePanel` MUST only be reached via `React.lazy(() => import(...))`. The `admin-shell` manualChunks rule in `vite.config.ts` routes `src/components/admin/` to the lazy `admin-shell` chunk — any new builder files placed under `src/components/admin/onboarding-builder/` are safe automatically.

### Pitfall 6: activation_events table — ALTER not CREATE

**What goes wrong:** Phase 38 Plan 38-06 already created `public.activation_events` as a minimal shell (migration `20270705000013_phase38_plan_personalize_facts_fn.sql` lines 49-55). If Phase 34 runs `CREATE TABLE activation_events`, the migration will fail with "relation already exists."

**How to avoid:** Phase 34's migration uses `ALTER TABLE public.activation_events ADD COLUMN IF NOT EXISTS ...` to add `goal_type`, `action_type`, `window_days`, `source`, and to add an index. The `user_id` primary key, `activated_at`, and `updated_at` columns already exist in the shell.

**Existing shell schema:**
```sql
-- Already exists (DO NOT RECREATE):
CREATE TABLE public.activation_events (
  user_id uuid PRIMARY KEY references auth.users(id) on delete cascade,
  activated_at timestamptz,
  activation_score numeric(3,2),
  updated_at timestamptz not null default now()
);
```

Phase 34 adds: `goal_type text`, `action_type text`, `window_days int`, `source text`.

### Pitfall 7: PostHog `posthog.alias()` arg order

**What goes wrong:** `posthog.alias(newAlias, originalDistinctId)` — the anonymous id is the `originalDistinctId`. Getting this backwards merges the auth uid INTO the anon timeline (wrong direction).

**Correct order** per `identify.ts` line 32:
```typescript
posthog.alias(supabaseUid, anonDistinctId);
// supabaseUid = the "new" canonical identity
// anonDistinctId = the "old" anonymous identity to merge FROM
```

The `TODO[24-02]` comment in `identify.ts` still exists. Phase 34 MUST verify this is correct for posthog-js v1.374.x before the plan ships. `[ASSUMED: arg order matches posthog-js v1.3x behavior; verify against changelog]`

### Pitfall 8: Apple OAuth full name only available on first sign-in

**What goes wrong:** Apple only provides `full_name` in the OAuth response on the FIRST sign-in. Subsequent sign-ins return a null name. If onboarding relies on the name from the OAuth payload for step pre-fill, returning users have no name.

**How to avoid:** Do NOT rely on the OAuth response for the user's display name. Use the existing onboarding step "What's your name?" as the data capture. Store `user_metadata.full_name` from the first sign-in in the profile immediately, before any further steps.

### Pitfall 9: `getFeatureFlagPayload` timing — must wait for PostHog to load

**What goes wrong:** `posthog.getFeatureFlagPayload('onboarding-ab')` returns `undefined` if called before PostHog finishes loading. The `useConsumerOnboardingFlow` hook could resolve to the control variant for all users during the flag-loading window.

**How to avoid:** Use `posthog.onFeatureFlags(callback)` to defer the flow query until flags are loaded, or fall back to control gracefully (showing the current active `onboarding_flows` row) if `getFeatureFlagPayload` returns `undefined`. Never block the onboarding render waiting for PostHog.

---

## Database Schema Reference

### anonymous_sessions (new table)

```sql
CREATE TABLE public.anonymous_sessions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  cookie_id         text          NOT NULL UNIQUE,  -- value of _ls_anon cookie
  preferences       jsonb         NOT NULL DEFAULT '{}',
  draft_entries     jsonb         NOT NULL DEFAULT '[]',
  aff_code          text          NULL,              -- D-08d: _aff cookie value
  merged_user_id    uuid          NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  population_score  int           GENERATED ALWAYS AS (
    -- D-07: non-null preference fields + draft entry count
    (SELECT count(*) FROM jsonb_object_keys(preferences) WHERE preferences ->> key IS NOT NULL)
    + jsonb_array_length(draft_entries)
  ) STORED,
  last_activity_at  timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now()
);
-- RLS: deny-all for anon role; service-role bypass only
ALTER TABLE public.anonymous_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anonymous_sessions FORCE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS entirely
CREATE INDEX idx_anon_sessions_cookie ON public.anonymous_sessions (cookie_id);
CREATE INDEX idx_anon_sessions_ttl    ON public.anonymous_sessions (last_activity_at)
  WHERE merged_user_id IS NULL;
```

**Planner note on population_score:** A GENERATED ALWAYS column with a subquery is NOT valid Postgres syntax. Use a plain `int NOT NULL DEFAULT 0` column instead and update it in the Edge Fn on each draft write. The richest-data comparison at merge time can also be computed inline in the SELECT.

### onboarding_flows (new consumer table, mirrors org_onboarding_flows)

```sql
CREATE TABLE public.onboarding_flows (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  config      jsonb       NOT NULL,   -- step sequence (OnboardingStepNode[])
  version     int         NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Partial unique: at most one active flow
CREATE UNIQUE INDEX onboarding_flows_active_one
  ON public.onboarding_flows (is_active)
  WHERE is_active;
```

### profiles additions

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_goal text
    CHECK (primary_goal IN (
      'lose-weight', 'build-muscle', 'new-prescription', 'build-habit',
      'doctor-monitored', 'family-supporter', 'manage-symptoms', 'track-with-vial-supply'
    ));
```

**Pitfall** (`[VERIFIED: feedback_planner_missed_status_enum_widening]`): if `primary_goal` is later referenced in any CHECK constraint expansion, the widening migration must ship in the SAME plan.

### activation_events additions (ALTER of existing shell)

```sql
-- Phase 38 shell already has: user_id (PK), activated_at, activation_score, updated_at
ALTER TABLE public.activation_events
  ADD COLUMN IF NOT EXISTS goal_type   text,
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS window_days int,
  ADD COLUMN IF NOT EXISTS source      text;
```

---

## State of the Art

| Old Approach | Current Approach | Impact for Phase 34 |
|--------------|------------------|---------------------|
| `activation_first_log` event with `tab` property | `activation_completed` with `goal_type + action_type + window_days + days_since_signup` | Richer cohort slicing; P36/P38/P39 filter on `goal_type` |
| Static `DEFAULT_STEPS` in OnboardingFlow.tsx | Config-driven steps from `onboarding_flows.config` JSONB | Enables A/B + admin step builder without code deploys |
| No anonymous preview | Cookie-keyed `anonymous_sessions` + merge Edge Fn | Value-first funnel |
| posthog-js implicit-grant OAuth | PKCE flow for OAuth providers | Eliminates double-`#` hash-route collision |
| Phase 15 `Publish` verb (page builder) | `Ship Winner` verb (onboarding) | User-chosen language; literal label in admin UI |

**Deprecated/outdated in this phase:**
- `activation_first_log`: superseded by `activation_completed`; keep in registry with `aem_dropped: true` (ADDITIVE-ONLY rule)
- Static `DEFAULT_STEPS` array in `OnboardingFlow.tsx`: replaced by `useConsumerOnboardingFlow()` config fetch

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `posthog.alias(supabaseUid, anonDistinctId)` is the correct arg order for posthog-js v1.374.x | Code Anchors #4 | Wrong identity merge direction; anon events attributed to wrong user in PostHog |
| A2 | PostHog `getFeatureFlagPayload` for `'onboarding-ab'` returns `{ version_id: string }` as the payload shape | Pattern 7 | Payload shape is planner's choice; field name could differ |
| A3 | `population_score` GENERATED ALWAYS with subquery is invalid Postgres syntax | DB Schema section | Syntactic; confirmed [ASSUMED] — planner must use plain int column |
| A4 | PostHog personal API key scope `feature_flag:write` is sufficient for the PATCH endpoint | Pattern 8 | Flag flip fails with 403; planner should document scope requirement in Human checkpoint |
| A5 | Apple Services ID domain registration must point to the Supabase GoTrue URL (`ytnsipxxmzgaebkqmokp.supabase.co`), not the app domain | Pitfall 2 | Apple sign-in 401 "Unknown client" |

---

## Open Questions

1. **PKCE callback route in hash-router SPA**
   - What we know: OAuth PKCE requires a non-hash callback URL (e.g. `/auth/callback?code=...`). App.tsx currently does all routing via hash fragments.
   - What's unclear: Does App.tsx's existing path-based routing (clinic-invite uses `window.location.pathname`) have a hook to add a `/auth/callback` path handler, or does Phase 34 need to add a new catch in the path-routing logic?
   - Recommendation: Inspect App.tsx's path routing block (lines ~558-600). Add `/auth/callback` as a recognized path-route that calls `supabase.auth.exchangeCodeForSession(window.location.href)` and then redirects to `/#/onboarding` or `/#/dashboard` based on `completed_onboarding_at`.

2. **Social proof live counter — Supabase Realtime vs RPC polling**
   - What we know: ONBOARD-12 needs a "live user counter." Realtime broadcasts require a channel subscription, which adds ~8 kB gz to the `vendor-supabase` chunk (already present). A simple RPC returning rolling 7d signup count requires 0 additional weight.
   - What's unclear: Whether Realtime is truly "live" enough to be worth the complexity vs polling every 30s.
   - Recommendation: Use a lightweight RPC polling approach (`setInterval` 30s, call `get_rolling_signup_count()`) rather than a Realtime subscription. Simpler and Lighthouse-friendly.

3. **`onboarding.ship_winner` permission scope — owner vs superadmin**
   - What we know: D-18 says "superadmin-only." The current `ROLE_PERMISSIONS` matrix has three roles: `owner`, `clinician`, `staff`. There is no "superadmin" role in the existing org.ts matrix — the closest is `owner`.
   - What's unclear: Is the intent that "superadmin = a specific flag on the user row" (e.g. `profiles.admin_role = 'superadmin'`), or "superadmin = org owner role"?
   - Recommendation: Phase 24 introduced `profiles.admin_role` for admin shell access. Check that column's values and gate `ship-winner-flag` on `admin_role = 'superadmin'` at the Edge Fn level (not org.ts `surfaceCheck`, which is org-scoped). Surface `surfaceCheck('onboarding.ship_winner')` in the UI as a display hint only.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite build, vitest | ✓ | v22.18.0 | — |
| npm | Package management | ✓ | 10.9.3 | — |
| `@dnd-kit/*` (core/sortable/utilities) | Step builder drag-reorder | ✓ | 6.3.1 / 10.0.0 / 3.2.2 | — |
| `posthog-js` | Client flag resolution | ✓ | ^1.372.10 | — |
| `posthog-node` (Deno import) | Activation Edge Fn | ✓ (wired in posthog-server.ts) | 5.10.4 | — |
| `@supabase/supabase-js` | Auth, DB | ✓ | ^2.105.4 | — |
| pg_cron extension | 30-day TTL cron | ✓ [ASSUMED: enabled from Phase 19/22/38] | — | manual delete via maintenance |
| pg_net extension | cron → Edge Fn HTTP | ✓ [ASSUMED: enabled] | — | — |
| Apple Developer account | Apple OAuth | ✓ [ASSUMED: owner has account] | — | Skip Apple; ship Google + magic-link first |
| POSTHOG_PERSONAL_API_KEY secret | Ship Winner flag-flip | ✗ (not yet a Function Secret) | — | Human checkpoint: admin adds secret before Ship Winner plan executes |

**Missing dependencies with no fallback:**
- Apple Developer Services ID registration: requires human action (owner creates Services ID in Apple Developer console and configures Supabase Auth settings). This is a human checkpoint in the Apple OAuth plan.
- `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` as Supabase Function Secrets: human checkpoint before `ship-winner-flag` Edge Fn can operate.

**Missing dependencies with fallback:**
- If Apple OAuth is unblocked later, the auth step ships with magic-link + Google only and Apple is added in a subsequent plan without changing the flow shape.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + Playwright |
| Config file | `vite.config.ts` (vitest config inline) |
| Quick run | `npm run test:unit` |
| Full suite | `npm test` (vitest + playwright) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Status |
|--------|----------|-----------|-------------------|------------|
| ONBOARD-01 | Cookie created on first /onboard visit; merge Edge Fn copies preferences + drafts | unit (merge logic) | `vitest run src/lib/onboarding-builder/__tests__/` | ❌ Wave 0 |
| ONBOARD-02 | `signInWithOAuth` called with PKCE; magic-link OTP fires | unit (auth.ts wrapper) | `vitest run src/lib/auth.test.ts` | ✅ exists (add cases) |
| ONBOARD-03 | Step progression; back nav; resumable from DB | unit (useConsumerOnboardingFlow) | `vitest run` | ❌ Wave 0 |
| ONBOARD-04 | `deriveSignupLocaleAndUnits` returns metric for es locale | unit | `vitest run src/components/onboarding/OnboardingFlow.test.ts` | ✅ (deriveSignupLocaleAndUnits tested) |
| ONBOARD-05 | Activation Edge Fn fires `captureServer(activation_completed)` | unit (Edge Fn Deno test) | `deno test supabase/functions/record-activation/*.test.ts` | ❌ Wave 0 |
| ONBOARD-06 | `activation_completed` present in EVENTS registry with `server_only: true` | unit | `vitest run src/lib/analytics/__tests__/events-registry.test.ts` | ✅ (add assertion) |
| ONBOARD-07 | Steps reorder via drag; config saves to DB | unit (SortableTreePanel + API) | `vitest run` | ✅ SortableTreePanel tested; API test ❌ Wave 0 |
| ONBOARD-08 | `getFeatureFlagPayload` resolves variant_id; Ship Winner calls PATCH | unit (mock PostHog) | `vitest run` | ❌ Wave 0 |
| ONBOARD-09 | Funnel analytics admin page renders with mock PostHog data | unit | `vitest run` | ❌ Wave 0 |
| ONBOARD-10 | Lighthouse ≥90 mobile on /onboard | e2e CI | `playwright test --project=mobile` (existing) | ✅ framework; score gate ❌ Wave 0 |
| ONBOARD-11 | Richest-data merge picks correct row (population score tie-break) | unit | `vitest run` | ❌ Wave 0 |
| ONBOARD-12 | Social proof counter RPC returns number; testimonials rotate | unit | `vitest run` | ❌ Wave 0 |
| ONBOARD-13 | Goal → first-action mapping renders correct recommended card | unit | `vitest run` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `src/lib/onboarding-builder/__tests__/use-consumer-onboarding-flow.test.ts` — REQ ONBOARD-01/03/08
- [ ] `src/lib/onboarding-builder/__tests__/anon-merge.test.ts` — REQ ONBOARD-11
- [ ] `supabase/functions/record-activation/index.test.ts` — REQ ONBOARD-05 (Deno test)
- [ ] `src/components/onboarding/__tests__/FirstActionSurface.test.tsx` — REQ ONBOARD-13
- [ ] `src/components/admin/onboarding-builder/__tests__/ship-winner.test.ts` — REQ ONBOARD-08

### Sampling Rate

- Per task commit: `npm run test:unit` (vitest run only)
- Per wave merge: `npm test` (vitest + playwright)
- Phase gate: full suite green + Lighthouse mobile ≥90 before `/gsd-verify-work`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (magic-link + PKCE OAuth); existing `auth.ts` wrapper |
| V3 Session Management | yes | Supabase JWT; `signOut({ scope: 'local' })` pattern already wired |
| V4 Access Control | yes | `surfaceCheck('onboarding.ship_winner')` client hint + SECDEF server enforcement |
| V5 Input Validation | yes | Zod schema on `activation_completed` payload; step config JSONB validated via `_validate_onboarding_steps` mirror |
| V6 Cryptography | no | No new crypto; OAuth PKCE handled by Supabase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Anonymous session spoofing | Spoofing | `cookie_id` is server-generated UUID; anonymous role has RLS deny-all; only service-role reads `anonymous_sessions` |
| Repeated activation (replay) | Elevation of Privilege | `activation_events.activated_at IS NOT NULL` guard in Edge Fn + advisory lock (D-04 fire-once) |
| Cross-user anonymous session steal | Spoofing | `cookie_id` unguessable UUID; no SELECT policy for anon role — only the merge Edge Fn (service-role) can read |
| Ship Winner unauthorized flag-flip | Elevation of Privilege | Edge Fn validates `admin_role = 'superadmin'` before PATCH; `surfaceCheck` is client hint only |
| Activation telemetry with PHI | Information Disclosure | `activation_completed` has `server_only: true`; payload carries only `goal_type` enum + `days_since_signup` (no PII/PHI) |
| PostHog personal API key exposure | Information Disclosure | Stored as Supabase Function Secret; NEVER in VITE_ vars; Edge Fn access only |

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: codebase]` `src/components/ui/SortableTreePanel.tsx` — dnd-kit v6 exact wiring for step builder
- `[VERIFIED: codebase]` `supabase/functions/_shared/posthog-server.ts` — Phase 24 D-13 pattern with `captureServer` + `shutdownPostHog`
- `[VERIFIED: codebase]` `src/lib/analytics/events.ts` — existing event registry + `activation_first_log` to supersede
- `[VERIFIED: codebase]` `src/lib/analytics/identify.ts` — `aliasAnonymousToUid` for PostHog merge
- `[VERIFIED: codebase]` `src/lib/org.ts` — `surfaceCheck()` + `ROLE_PERMISSIONS` matrix
- `[VERIFIED: codebase]` `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — pg_cron + vault + named dollar-quote pattern
- `[VERIFIED: codebase]` `supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql` — `activation_events` shell already exists
- `[VERIFIED: codebase]` `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql` — JSONB step config + SECDEF pattern to mirror
- `[VERIFIED: codebase]` `src/lib/onboarding-builder/use-org-onboarding-flow.ts` — hook pattern for consumer sibling
- `[VERIFIED: codebase]` `src/components/auth/SignUpForm.tsx` — `_aff` cookie / `leanshot_aff_manual` session storage pattern
- `[VERIFIED: codebase]` `vite.config.ts` — manualChunks + `vendor-dnd-kit` chunk rule + dnd-kit index-leak CI guard
- `[CITED: https://posthog.com/docs/api/feature-flags]` PostHog feature flags PATCH REST API for Ship Winner
- `[CITED: https://supabase.com/docs/guides/auth/social-login/auth-apple]` Apple OAuth web setup (Services ID, `.p8` rotation, `redirectTo`)

### Secondary (MEDIUM confidence)
- `[VERIFIED: npm]` posthog-js latest 1.374.2 (installed ^1.372.10 — no breaking changes in minor)
- `[CITED: posthog.com/docs/experiments/start-here]` PostHog Experiments confidence intervals, ship/conclude flow
- Context7 `/posthog/posthog-js` — `getFeatureFlagPayload`, `useFeatureFlagVariantKey` API shapes

### Tertiary (LOW confidence)
- `[ASSUMED]` `posthog.alias(newAlias, originalId)` arg order for posthog-js v1.374.x — existing `TODO[24-02]` comment in `identify.ts` flags this for verification
- `[ASSUMED]` pg_cron + pg_net extensions already enabled (inferred from Phase 38 cron migration succeeding)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json + codebase
- Architecture patterns: HIGH — existing codebase patterns verified directly
- DB schema: HIGH (structure) / MEDIUM (generated column caveat — A3)
- PostHog Experiments REST API: MEDIUM — cited from official docs, not run against live project
- Apple OAuth: MEDIUM — official Supabase docs; project-specific Services ID setup is human-action dependent

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (PostHog API changes infrequently; Apple `.p8` rotation is the main time-sensitive item)
