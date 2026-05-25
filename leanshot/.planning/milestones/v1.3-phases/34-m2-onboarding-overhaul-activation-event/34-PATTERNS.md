# Phase 34: M2 Onboarding Overhaul + Activation Event — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 22 new/modified artifacts
**Analogs found:** 21 / 22

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/*_p34_anonymous_sessions.sql` | migration | CRUD | `supabase/migrations/20270101000001_affiliates_schema.sql` | role-match |
| `supabase/migrations/*_p34_onboarding_flows_consumer.sql` | migration | CRUD | `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql` | exact |
| `supabase/migrations/*_p34_profiles_primary_goal.sql` | migration | CRUD | `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql` (ALTER pattern) | role-match |
| `supabase/migrations/*_p34_activation_events_alter.sql` | migration | CRUD | `supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql` | exact |
| `supabase/migrations/*_p34_anon_session_ttl_cron.sql` | migration | batch | `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` | exact |
| `supabase/functions/create-anon-session/index.ts` | Edge Function | request-response | `supabase/functions/plan-personalize/index.ts` | role-match |
| `supabase/functions/merge-anon-session/index.ts` | Edge Function | CRUD | `supabase/functions/plan-personalize/index.ts` | role-match |
| `supabase/functions/record-activation/index.ts` | Edge Function | event-driven | `supabase/functions/plan-personalize/index.ts` | role-match |
| `supabase/functions/ship-winner-flag/index.ts` | Edge Function | request-response | `supabase/functions/plan-personalize/index.ts` | role-match |
| `leanshot/src/lib/onboarding-builder/use-consumer-onboarding-flow.ts` | hook | request-response | `leanshot/src/lib/onboarding-builder/use-org-onboarding-flow.ts` | exact |
| `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx` | component | request-response | `leanshot/src/components/onboarding/OnboardingFlow.tsx` (OrgOnboardingFlowRenderer) | exact |
| `leanshot/src/components/onboarding/AnonymousPreviewLayer.tsx` | component | request-response | `leanshot/src/components/onboarding/OnboardingFlow.tsx` | role-match |
| `leanshot/src/components/onboarding/FirstActionSurface.tsx` | component | event-driven | `leanshot/src/components/dashboard/cards/FocusCard.tsx` | role-match |
| `leanshot/src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` | component | CRUD | `leanshot/src/components/admin/cohort/CohortsPage.tsx` | role-match |
| `leanshot/src/components/admin/onboarding-builder/StepPalette.tsx` | component | event-driven | `leanshot/src/components/admin/palette/AdminCommandPalette.tsx` | role-match |
| `leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx` | component | request-response | `leanshot/src/components/admin/cohort/AdminCohortBuilder.tsx` | partial-match |
| `leanshot/src/components/admin/onboarding-builder/OnboardingFunnelTab.tsx` | component | request-response | `leanshot/src/components/admin/growth/CACDashboardPage.tsx` | role-match |
| `leanshot/src/lib/analytics/events.ts` | utility | transform | same file (additive extension) | exact |
| `leanshot/src/lib/analytics/identify.ts` | utility | event-driven | same file (reference) | exact |
| `leanshot/src/lib/org.ts` | utility | request-response | same file (additive extension) | exact |
| `leanshot/src/lib/auth.ts` | utility | request-response | same file (additive `signInWithOAuth` export) | exact |
| `leanshot/src/App.tsx` | config | request-response | same file (`/auth/callback` path branch + `/onboard` view) | exact |

---

## Pattern Assignments

### Domain A: Schema + Migrations

---

#### `supabase/migrations/*_p34_anonymous_sessions.sql`

**Analog:** `supabase/migrations/20270101000001_affiliates_schema.sql`

**Table creation pattern** (lines 27-55):
```sql
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  -- text columns with CHECK constraints (not enums — avoids enum-add-in-same-tx pitfall)
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended')),
  -- timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**RLS deny-all for anon role** — copy from `supabase/migrations/20270101000006_affiliate_rls.sql`. The `anonymous_sessions` table uses NO permissive policies at all (service-role bypasses RLS entirely). Mirror the deny-all pattern but omit any SELECT policy — the merge Edge Function uses service-role which bypasses RLS:
```sql
alter table public.anonymous_sessions enable row level security;
alter table public.anonymous_sessions force row level security;
-- No permissive policies at all: service-role bypasses; anon role denied by default.
-- (Contrast with org_onboarding_flows which has a SELECT policy for org members.)
```

**Partial index pattern** (lines 60-70 of affiliates schema):
```sql
-- Partial-index predicates MUST be IMMUTABLE per reference_supabase_migration_gotchas.
-- `WHERE col IS NULL` and boolean literal comparisons are IMMUTABLE-safe.
create index idx_anon_sessions_ttl
  on public.anonymous_sessions (last_activity_at)
  where merged_user_id is null;
```

**Key difference from analog:** `anonymous_sessions` has NO FK to `organizations`; `population_score` must be a plain `int NOT NULL DEFAULT 0` (NOT a GENERATED ALWAYS column — subquery in generated column is invalid Postgres syntax, per RESEARCH Assumption A3). Update `population_score` in the Edge Function on each draft write.

---

#### `supabase/migrations/*_p34_onboarding_flows_consumer.sql`

**Analog:** `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql`

**Table + partial-unique index pattern** (lines 37-57):
```sql
create table public.org_onboarding_flows (
  id          uuid        not null default gen_random_uuid() primary key,
  org_id      uuid        not null references public.organizations(id) on delete restrict,
  steps       jsonb       not null,
  version     int         not null,
  is_active   boolean     not null default true,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Partial unique: at most one active flow per org (IMMUTABLE-safe predicate)
create unique index org_onboarding_flows_active_per_org
  on public.org_onboarding_flows (org_id)
  where is_active;
```

For `onboarding_flows` (consumer), drop `org_id`; the unique index is global (one active consumer flow at a time):
```sql
-- consumer table omits org_id; unique index is just on is_active
create unique index onboarding_flows_active_one
  on public.onboarding_flows (is_active)
  where is_active;
```

**SECDEF `save_consumer_onboarding_flow`** — copy `save_org_onboarding_flow` (lines 167-225), replacing:
- `p_org_id` parameter → none (consumer flow has no org scope)
- `public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit')` → `profiles.admin_role = 'superadmin'` check (D-18)
- advisory lock key: `hashtext('consumer_onboarding_flow')` (single global resource, not per-org)
- audit log action: `'consumer_onboarding_flow.save'`

**SECDEF `_validate_onboarding_steps`** — reuse the Phase 31 function directly. The consumer step builder uses the same `OnboardingStepNode` type. The Phase 34 step type palette extends the 8 canonical types; update the `v_type not in (...)` check to include the new D-16 types (`text`, `single-select`, `multi-select`, `scale`, `weight`, `date`, `nps`, `custom-component`).

**RLS: INSERT/UPDATE/DELETE deny, SELECT authenticated** (lines 62-99 of P31 migration):
```sql
alter table public.onboarding_flows enable row level security;
alter table public.onboarding_flows force row level security;

-- SELECT: any authenticated user can read the active consumer flow (needed by useConsumerOnboardingFlow)
create policy onboarding_flows_select_authenticated
  on public.onboarding_flows for select
  to authenticated using (true);

-- Mutations: SECDEF only (same deny-all pattern as org_onboarding_flows)
create policy onboarding_flows_insert_deny on public.onboarding_flows
  for insert to authenticated with check (false);
create policy onboarding_flows_update_deny on public.onboarding_flows
  for update to authenticated using (false) with check (false);
create policy onboarding_flows_delete_deny on public.onboarding_flows
  for delete to authenticated using (false);
```

---

#### `supabase/migrations/*_p34_activation_events_alter.sql`

**Analog:** `supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql` (lines 49-55)

**Existing shell** (DO NOT RECREATE — ALTER only):
```sql
-- Already exists from Phase 38:
create table if not exists public.activation_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activated_at timestamptz,
  activation_score numeric(3,2) check (activation_score is null or (activation_score >= 0 and activation_score <= 1)),
  updated_at timestamptz not null default now()
);
```

**Phase 34 ALTER pattern:**
```sql
alter table public.activation_events
  add column if not exists goal_type   text,
  add column if not exists action_type text,
  add column if not exists window_days int,
  add column if not exists source      text;

-- Add RLS if not already present (Phase 38 may have omitted it)
-- RLS: user can read their own row only; no direct write (Edge Fn service-role writes)
alter table public.activation_events enable row level security;
-- If policies already exist: use CREATE POLICY IF NOT EXISTS (Postgres 16+)
-- or guard with a DO block checking pg_policies.
```

---

#### `supabase/migrations/*_p34_anon_session_ttl_cron.sql`

**Analog:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` (lines 1-47, 55-110)

**Pre-flight unschedule pattern** (lines 29-47 — MANDATORY to make re-runs safe):
```sql
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in ('phase34-anon-session-ttl-weekly')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null;  -- cron schema may not be visible on first apply
end $unschedule$;
```

**Named dollar-quote pattern** (CRITICAL — `reference_postgres_dollar_quote_nesting_in_cron_body`):
```sql
-- Outer: $cron$ ... $cron$
-- Inner: UNIQUE named tag — $anon_ttl$ ... $anon_ttl$
-- NEVER use bare $$ inside a $cron$ body — silently closes the outer quote.

select cron.schedule(
  'phase34-anon-session-ttl-weekly',
  '0 3 * * 0',   -- Sunday 03:00 UTC
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

**This cron does NOT need vault + pg_net** (unlike Phase 38's digest cron) — it is a direct SQL DELETE, not an HTTP call to an Edge Function. No service_role_key retrieval needed.

---

#### `supabase/migrations/*_p34_profiles_primary_goal.sql`

**Analog:** Phase 31 profiles ALTER pattern (any migration with `alter table public.profiles add column if not exists`).

```sql
-- CHECK constraint widening MUST ship in the SAME migration as the column add
-- per feedback_planner_missed_status_enum_widening.
alter table public.profiles
  add column if not exists primary_goal text
    check (primary_goal in (
      'lose-weight', 'build-muscle', 'new-prescription', 'build-habit',
      'doctor-monitored', 'family-supporter', 'manage-symptoms', 'track-with-vial-supply'
    ));
```

---

### Domain B: Edge Functions

---

#### `supabase/functions/create-anon-session/index.ts`

**Analog:** `supabase/functions/plan-personalize/index.ts`

**CORS + jsonResponse helpers** (lines 64-85 — copy verbatim):
```typescript
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
```

**Lazy admin singleton** (lines 91-119 — copy verbatim; `_adminInstance` + `getAdmin()` + Proxy for test injection):
```typescript
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
```

**Deno.serve entrypoint + test internals exports** (lines 342-357):
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleXxx);
}
export const __internal = { handleXxx, setAdminForTest, resetAdminForTest };
```

**CRITICAL difference:** `create-anon-session` does NOT call `captureServer`/`shutdownPostHog`. It only does a service-role INSERT. No PostHog in this function — skip the try/finally shutdownPostHog pattern.

---

#### `supabase/functions/record-activation/index.ts`

**Analog:** `supabase/functions/plan-personalize/index.ts` + `supabase/functions/_shared/posthog-server.ts`

**PostHog capture + shutdown pattern** (MANDATORY — `posthog-server.ts` lines 117-154 + 305-313):
```typescript
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

Deno.serve(async (req) => {
  try {
    // ... auth check, DB read for activation_events.activated_at IS NOT NULL ...
    // ... advisory lock on user_id ...
    // ... INSERT into activation_events ...
    captureServer({
      userId: authUserId,  // MUST be Supabase auth.users.id (D-13)
      event: 'activation_completed',
      properties: {
        goal_type: 'lose-weight',      // from request body
        action_type: 'first_weight_log',
        window_days: 7,
        days_since_signup: 3,
        source: 'first_log',
      },
    });
    return jsonResponse(200, { ok: true });
  } finally {
    await shutdownPostHog(); // NEVER omit — isolate tears down after Response
  }
});
```

**Fire-once guard pattern** — check `activation_events.activated_at IS NOT NULL` BEFORE calling `captureServer`. Use advisory lock keyed on `user_id` to prevent concurrent double-fire (same lock pattern as `merge_anon_session`):
```sql
-- In the DB SECDEF (or inline SQL in Edge Fn):
PERFORM pg_advisory_xact_lock(('x' || md5(auth.uid()::text))::bit(64)::bigint);
-- Then check activated_at IS NOT NULL before inserting + capturing.
```

**Cross-phase import:** `_shared/posthog-server.ts` is defined and typed in Phase 24/27/38. Phase 34 adds `'activation_completed'` to the `Phase38Event` union type in that file (additive — no breaking change). The planner must update `posthog-server.ts` line ~214 to include `'activation_completed'` in the `Phase38Event` union.

---

#### `supabase/functions/merge-anon-session/index.ts`

**Analog:** `supabase/functions/plan-personalize/index.ts`

**Race-safe merge pattern** — uses `pg_advisory_xact_lock` keyed on `user_id` (same as `save_org_onboarding_flow` in Phase 31):
```sql
-- In merge_anon_session SECDEF:
PERFORM pg_advisory_xact_lock(('x' || md5(auth.uid()::text))::bit(64)::bigint);
-- SELECT winner anonymous_sessions row WHERE merged_user_id IS NULL
-- Winner = highest population_score; tie-break = most-recent created_at
-- DELETE FROM anonymous_sessions WHERE id = winner_id
-- Copy preferences + draft_entries to profiles + draft tables
```

**PostHog server-side alias** — after merge, call `client.alias({ distinctId: supabaseUid, alias: anonDistinctId })` via posthog-node (from `_shared/posthog-server.ts` client). This is the server-side equivalent of `aliasAnonymousToUid` in `leanshot/src/lib/analytics/identify.ts` (lines 26-40). Note the arg order: `distinctId` = supabaseUid (new canonical), `alias` = anonDistinctId (old anonymous).

**Affiliate propagation** (D-08d) — after merge, call the affiliate-attribute Edge Function or replicate its logic: read `anonymous_sessions.aff_code`, call `supabase.from('affiliate_clicks').update({ user_id: uid })...`. Mirror `supabase/functions/affiliate-attribute/index.ts` pattern.

---

#### `supabase/functions/ship-winner-flag/index.ts`

**Analog:** `supabase/functions/plan-personalize/index.ts` (auth pattern) + PostHog REST API (RESEARCH Pattern 8)

**Admin role gate** — MUST verify `admin_role = 'superadmin'` server-side (not just surfaceCheck client hint):
```typescript
// After Bearer auth verification:
const { data: profileData } = await admin.from('profiles')
  .select('admin_role')
  .eq('id', callerUid)
  .maybeSingle();
if (profileData?.admin_role !== 'superadmin') {
  return jsonError(403, 'forbidden_not_superadmin');
}
```

**PostHog PATCH call** (RESEARCH Pattern 8 — requires `POSTHOG_PERSONAL_API_KEY` Function Secret):
```typescript
const personalApiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
const projectId = Deno.env.get('POSTHOG_PROJECT_ID');
// PATCH /api/projects/{projectId}/feature_flags/{flagId}/
// body: { filters: { groups: [{ properties: [], rollout_percentage: 100 }], multivariate: null } }
```

**No `captureServer` needed** — ship-winner is an admin action; `admin_action` event fires from `log_admin_action` SECDEF. No shutdownPostHog needed in this function.

---

### Domain C: UI Components

---

#### `leanshot/src/lib/onboarding-builder/use-consumer-onboarding-flow.ts`

**Analog:** `leanshot/src/lib/onboarding-builder/use-org-onboarding-flow.ts`

**Full hook structure to mirror** (lines 77-202):
```typescript
// OrgOnboardingFlowState shape → ConsumerOnboardingFlowState shape
export interface ConsumerOnboardingFlowState {
  status: 'loading' | 'consumer' | 'completed';  // no 'org' branch
  flow: ConsumerFlow | null;                        // resolved flow config + variant_id
}

const INITIAL_STATE: ConsumerOnboardingFlowState = { status: 'loading', flow: null };

export function useConsumerOnboardingFlow(): ConsumerOnboardingFlowState {
  const [state, setState] = useState<ConsumerOnboardingFlowState>(INITIAL_STATE);
  const signedInUser = useStore((s) => s.signedIn?.user ?? null);

  useEffect(() => {
    let cancelled = false;
    async function fetchFlowState(): Promise<void> {
      try {
        // 1. Check auth — fail-open to consumer state if no user
        // 2. Check profiles.completed_onboarding_at → COMPLETED_STATE
        // 3. Resolve PostHog flag payload → variant_id
        //    posthog.onFeatureFlags(() => { ... }) to defer until flags loaded
        // 4. Query onboarding_flows WHERE id = versionId OR is_active = true
        // 5. setState with resolved flow config
      } catch (err) {
        if (!cancelled) setState({ status: 'consumer', flow: null }); // fail-open
      }
    }
    void fetchFlowState();
    return () => { cancelled = true; };
  }, [signedInUser?.id]);

  return state;
}
```

**Key differences from `useOrgOnboardingFlow`:**
- No org phases 3-4 (no `organizations` or `org_onboarding_flows` query)
- Adds PostHog flag payload resolution for A/B variant (`posthog.onFeatureFlags` callback guard — RESEARCH Pitfall 9)
- Queries `onboarding_flows` (consumer table) instead of `org_onboarding_flows`
- Status is `'consumer' | 'completed' | 'loading'` (no `'org'` value)

---

#### `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx`

**Analog:** `leanshot/src/components/onboarding/OnboardingFlow.tsx` — specifically the `OrgOnboardingFlowRenderer` component (lines 721-1158)

**Shell structure to copy** (lines 851-876 — card chrome, full-bleed illustration, progress, AnimatePresence):
```tsx
return (
  <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6 safe-top safe-bottom">
    <div className="w-full max-w-[560px]">
      <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden">
        {/* Full-bleed illustration banner */}
        <div className="relative h-[180px] md:h-[200px] bg-gradient-to-br from-[var(--color-primary-soft)] to-[var(--color-surface-elevated)] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
              className="absolute inset-0 flex items-center justify-center">
              {/* step illustration */}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="p-6 md:p-8">
          <ProgressIndicator step={step} total={TOTAL} />
          {/* step content + navigation buttons */}
        </div>
      </div>
    </div>
  </div>
);
```

**Step-content AnimatePresence pattern** (lines 879-883):
```tsx
<AnimatePresence mode="wait">
  <motion.div key={step}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -6 }}
    transition={{ duration: 0.2 }}>
    {/* current step form */}
  </motion.div>
</AnimatePresence>
```

**Navigation button pair** (lines 1120-1152 — Back + Continue/Complete):
```tsx
<div className="flex gap-2 mt-7">
  <Button variant="ghost" onClick={back}
    leadingIcon={<ArrowLeft className="size-4" />} className="flex-1">Back</Button>
  {step < TOTAL - 1
    ? <Button onClick={next} trailingIcon={<ArrowRight className="size-4" />} className="flex-1">Continue</Button>
    : <Button onClick={complete} trailingIcon={<Check className="size-4" />} className="flex-1">Open dashboard</Button>}
</div>
```

**Goal step pattern** — extend the existing `goals` step type (lines 987-1026). Replace the `PillGroup` with 8 `Pill` items for the D-11 goal catalog:
```tsx
{(['lose-weight','build-muscle','new-prescription','build-habit',
   'doctor-monitored','family-supporter','manage-symptoms','track-with-vial-supply'] as const).map((g) => (
  <Pill key={g} active={draft.goal === g} onClick={() => update({ goal: g })}>
    {GOAL_LABELS[g]}
  </Pill>
))}
```

**`mark_onboarding_complete` SECDEF call** — copy lines 242-257 exactly (best-effort void async, try/catch swallowed, NOT blocking `onComplete()`).

---

#### `leanshot/src/components/onboarding/FirstActionSurface.tsx`

**Analog:** `leanshot/src/components/dashboard/cards/FocusCard.tsx` (lines 1-80)

**3-card grid pattern** — `FocusCard` renders one emphasized action; `FirstActionSurface` renders 3 cards, one visually emphasized. Extend the `FocusCard` visual vocabulary:

```tsx
// FocusCard's emphasized icon pattern (lines 49-55):
<motion.span
  initial={{ scale: 0.7, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{ type: 'spring', damping: 18, stiffness: 240 }}
  className="size-12 rounded-2xl bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center shrink-0 shadow-md">
  <Icon className="size-5" strokeWidth={1.9} />
</motion.span>

// For the RECOMMENDED card: add a "Recommended for your goal" pill badge (D-12)
// For secondary cards: use a muted bg-[var(--color-surface-elevated)] icon container
```

**Card grid layout** — use `Card` from `@/components/ui/Card`:
```tsx
// 3-card stacked on mobile, grid on tablet+
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
  {/* Recommended card — larger, primary color, badge */}
  <Card variant="elevated" className="sm:col-span-1 border-[var(--color-primary)] ...">
    {/* "Recommended for your goal" badge */}
    {/* Icon + action label + description */}
    {/* CTA button */}
  </Card>
  {/* 2 secondary cards — interactive variant */}
  <Card variant="interactive" ...>...</Card>
  <Card variant="interactive" ...>...</Card>
</div>
```

**Goal → action mapping** — D-13 table. Planner encodes as a const record:
```typescript
const GOAL_ACTION_MAP: Record<PrimaryGoal, ActionCardConfig> = {
  'lose-weight': { actionType: 'first_weight_log', label: 'Log your first weight', ... },
  'build-muscle': { actionType: 'first_workout_log', label: 'Log your first workout', ... },
  // ...
};
```

---

#### `leanshot/src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` + `StepPalette.tsx`

**Analog (drag-reorder):** `leanshot/src/components/ui/SortableTreePanel.tsx` (lines 1-170)

**SortableTreePanel usage pattern** (RESEARCH Pattern 1 — copy exactly):
```tsx
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';
import type { OnboardingStepNode } from '@/types/onboarding-step';

// MUST be inside a React.lazy boundary — never statically imported from index chunk.
// Place under src/components/admin/onboarding-builder/ — auto-routed to admin-shell
// chunk by vite.config.ts manualChunks rule.

<SortableTreePanel<OnboardingStepNode>
  items={steps}
  getId={(s) => s.id}
  onReorder={(next) => setSteps(next)}
  renderItem={(step, index, isDragging) => (
    <StepRow step={step} index={index} dragging={isDragging} />
  )}
  announceItemLabel={(s) => s.type}
/>
```

**Admin module registration** — add entry to `leanshot/src/lib/admin/modules.ts` (lines 104-110 — the existing `onboarding` placeholder entry):
```typescript
// REPLACE the placeholder at line 104-110:
{
  key: 'onboarding',
  label: 'Onboarding',
  route: 'onboarding',
  icon: RocketIcon,
  lazy: () => import('@/components/admin/onboarding-builder/OnboardingBuilderModule'),
  flagKey: 'admin.onboarding.enabled',
  minRole: 'admin' as AdminRole,
},
```

**Admin module pattern** (mirror `leanshot/src/components/admin/cohort/CohortsPage.tsx`):
- Top-level page component with `<AdminLayout>` wrapper
- Tabs for: Builder | A/B Experiments | Funnel Analytics
- Permission gate via `surfaceCheck('onboarding.ship_winner')` for Ship Winner button (D-18 — CLIENT HINT only; Edge Fn enforces)

---

#### `leanshot/src/components/admin/onboarding-builder/OnboardingFunnelTab.tsx`

**Analog:** `leanshot/src/components/admin/growth/CACDashboardPage.tsx`

**PostHog REST polling pattern** — query PostHog Insights API from the admin panel. Use `fetch` with `POSTHOG_PROJECT_KEY` (browser-readable write-only key is NOT suitable for querying; the Insights REST API requires `POSTHOG_PERSONAL_API_KEY` or a project-level read token). Route through an Edge Function to protect the key — mirror the `ship-winner-flag` Edge Fn pattern for the read path.

**Chart rendering** — use `BaseChart.tsx` for time-series views (step completion rates over time). Use `AdminMetricsKpiStrip.tsx` pattern for summary KPI tiles (total views, completion rate, drop-off %).

---

### Domain D: Analytics + Auth Utilities

---

#### `leanshot/src/lib/analytics/events.ts` — additive extension

**Analog:** Same file (lines 79-89 — `activation_first_log` entry to supersede)

**New event addition pattern** (lines 58-89 — copy shape):
```typescript
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
      'lose-weight','build-muscle','new-prescription','build-habit',
      'doctor-monitored','family-supporter','manage-symptoms','track-with-vial-supply',
    ]),
    action_type: z.string(),
    window_days: z.literal(7),
    days_since_signup: z.number().int().nonnegative(),
    source: z.literal('first_log'),
  }),
},
```

**Deprecating `activation_first_log`** — ADDITIVE-ONLY rule blocks deletion. Add `aem_dropped: true` field and remove `aem_priority` (removing a field is blocked; setting it to a non-AEM sentinel is blocked; adding `aem_dropped` is additive and permitted):
```typescript
activation_first_log: {
  // ... existing fields unchanged ...
  aem_dropped: true,   // ADD this; REMOVE the aem_priority field is BLOCKED.
  // To satisfy the AEM slot constraint: aem_priority stays but add aem_dropped flag.
  // Plan-checker iter-1 must confirm the ESLint rule behavior for co-presence of both.
},
```

---

#### `leanshot/src/lib/auth.ts` — additive extension

**Analog:** Same file (lines 47-53 — `signInWithMagicLink` for the OTP pattern)

**Magic-link pattern** (lines 47-53):
```typescript
export async function signInWithMagicLink(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { error };
}
```

**New OAuth export to add** — `signInWithOAuthProvider` using PKCE (no implicit-grant — RESEARCH Pitfall 1):
```typescript
// ADD to src/lib/auth.ts:
export async function signInWithOAuthProvider(
  provider: 'google' | 'apple',
): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // PKCE default in supabase-js v2 — no extra flag needed.
      // redirectTo MUST be a path-based URL (NOT hash) for OAuth providers.
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  return { error };
}
```

**`/auth/callback` handler** — add to `leanshot/src/App.tsx` `selectView()` (lines 575+):
```typescript
// Add BEFORE the '#/auth/' hash branch in selectView():
if (opts.pathname === '/auth/callback' || opts.pathname === '/auth/callback/') {
  return 'auth-callback';  // new view branch
}
```

The `auth-callback` view renders a minimal component that calls `supabase.auth.exchangeCodeForSession(window.location.href)` then redirects to `/#/onboarding` or `/#/dashboard` based on `completed_onboarding_at`.

**`authRedirectTo` function** (lines 27-31) — reuse as-is; the `/auth/callback` path does NOT use the hash-based `authRedirectTo` helper (which adds `/#` prefix). Pass `'/auth/callback'` directly as `redirectTo` origin-relative path.

---

#### `leanshot/src/lib/org.ts` — additive extension

**Analog:** Same file (lines 46-71 — `ROLE_PERMISSIONS` constant)

**Add `onboarding.ship_winner` to owner set** (line 60 area):
```typescript
owner: new Set([
  // ... existing 12 keys ...
  'onboarding.ship_winner',  // D-18: client hint; Edge Fn enforces superadmin check
]),
```

**`surfaceCheck` is already correct** (lines 110-114) — no change needed to the function body. The `ship-winner-flag` Edge Fn re-verifies `admin_role = 'superadmin'` independently.

---

#### `leanshot/src/lib/analytics/identify.ts` — reference (no change)

**Alias arg order** (lines 26-40 — verify before shipping):
```typescript
// Current: posthog.alias(supabaseUid, anonDistinctId)
// TODO[24-02] still present: verify arg order against posthog-js v1.374.x changelog.
// Server-side posthog-node alias call in merge-anon-session Edge Fn:
// client.alias({ distinctId: supabaseUid, alias: anonDistinctId })
// — different call signature from browser-side posthog.alias(newAlias, originalId)
```

---

### Domain E: App Routing

---

#### `leanshot/src/App.tsx` — additive `/auth/callback` path branch

**Analog:** Same file (lines 575-660 — `selectView` function)

**Path branch insertion point** — add `/auth/callback` BEFORE the `#/auth/` hash branch (line 578) since OAuth providers cannot redirect to `#` fragments:
```typescript
// INSERT before line 578:
if (opts.pathname === '/auth/callback' || opts.pathname === '/auth/callback/') {
  return 'auth-callback';
}
if (opts.hash.startsWith('#/auth/')) return 'auth';
```

**`/onboard` anonymous preview path** — add as path-based route (not hash-based, for Lighthouse crawlability):
```typescript
// Path-based, anonymous OK (preview doesn't require auth):
if (opts.pathname === '/onboard' || opts.pathname === '/onboard/') {
  return 'onboard-preview';
}
```

**Existing `#/auth/` double-hash fix** (lines 51-69 of `main.tsx`) already covers implicit-grant flows. The PKCE flow does NOT produce double-`#` — the `/auth/callback?code=...` URL is path+query, not hash. No change needed to `main.tsx`.

---

## Shared Patterns

### PostHog Server-Side Capture (ALL Edge Functions that capture events)

**Source:** `supabase/functions/_shared/posthog-server.ts` (lines 117-154, 305-313)
**Apply to:** `record-activation/index.ts` (mandatory); `merge-anon-session/index.ts` (for alias call)

```typescript
// MANDATORY: every Edge Fn calling captureServer() MUST wrap in try/finally.
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

Deno.serve(async (req) => {
  try {
    // ... handler body ...
    captureServer({ userId, event, properties });
    return jsonResponse(200, { ok: true });
  } finally {
    await shutdownPostHog(); // NEVER omit — dropped events on isolate teardown
  }
});
```

**Note:** `captureServer()` automatically dual-writes to `public.events_mirror` (Phase 27 extension in `posthog-server.ts` lines 128-153). The `activation_completed` event will appear there automatically.

---

### Service-Role Lazy Admin Singleton (ALL Edge Functions doing DB writes)

**Source:** `supabase/functions/plan-personalize/index.ts` (lines 91-119)
**Apply to:** `create-anon-session`, `merge-anon-session`, `record-activation`, `ship-winner-flag`

```typescript
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
// Plus test injection seam: setAdminForTest / resetAdminForTest (lines 103-110)
```

---

### SECDEF `search_path` Lock (ALL new Postgres functions)

**Source:** `supabase/migrations/20270601400005_p31_04_org_onboarding_flows.sql` (lines 113-115)
**Apply to:** Every new `create or replace function` in Phase 34 migrations

```sql
create or replace function public.some_fn(...)
returns ...
language plpgsql
security definer
set search_path = pg_catalog, public, extensions  -- MANDATORY per reference_supabase_migration_gotchas
as $$ ... $$;
```

---

### Fail-Open Hook Pattern (ALL new data-fetching hooks)

**Source:** `leanshot/src/lib/onboarding-builder/use-org-onboarding-flow.ts` (lines 184-189)
**Apply to:** `use-consumer-onboarding-flow.ts`

```typescript
} catch (err) {
  if (cancelled) return;
  // Fail-open: ANY error → consumer path (CLAUDE.md local-first invariant)
  console.warn('[useConsumerOnboardingFlow] unexpected error, failing open:', err);
  setState(CONSUMER_STATE);
}
```

---

### dnd-kit Lazy Chunk Isolation (Step Builder)

**Source:** `vite.config.ts` `manualChunks` rule (verified in RESEARCH)
**Apply to:** ALL files in `src/components/admin/onboarding-builder/`

Files placed under `src/components/admin/` are auto-routed to the `admin-shell` lazy chunk by `vite.config.ts`. The `OnboardingBuilderModule` MUST be reached only via `React.lazy(() => import(...))` in `src/lib/admin/modules.ts`. Any static import of `@dnd-kit/*` outside a lazy boundary will trip the CI guard `scripts/assert-clinic-bundle-budget.sh` with "dnd-kit index-leak."

---

### Supabase magic-link `emailRedirectTo` (Auth UI)

**Source:** `leanshot/src/lib/auth.ts` (lines 27-31, 47-53)
**Apply to:** Auth step in `ConsumerOnboardingRenderer.tsx`

```typescript
// Magic-link: hash-based redirect (supabase-js handles the double-# fix in main.tsx)
options: { emailRedirectTo: authRedirectTo('/#/auth/verify') }

// OAuth PKCE: path-based redirect (NEVER hash — OAuth providers can't redirect to #)
options: { redirectTo: `${window.location.origin}/auth/callback` }
```

---

## Cross-Phase Import Dependencies

| File | Imports From | Owned By | Risk |
|---|---|---|---|
| `record-activation/index.ts` | `_shared/posthog-server.ts` | Phase 24/27 | Low — file exists; Phase 34 adds `'activation_completed'` to `Phase38Event` union (additive) |
| `merge-anon-session/index.ts` | `_shared/posthog-server.ts` | Phase 24/27 | Low — same file |
| `use-consumer-onboarding-flow.ts` | `@/lib/supabase` | Phase 5 | None |
| `ConsumerOnboardingRenderer.tsx` | `@/lib/onboarding-builder/use-org-onboarding-flow.ts` | Phase 31 | None — reads only; org hook untouched |
| `OnboardingBuilderModule.tsx` | `@/components/ui/SortableTreePanel` | Phase 31 (Plan 31-00b) | None — generic panel |
| `record-activation/index.ts` | `public.activation_events` (DB) | Phase 38 shell | Medium — must use ALTER not CREATE (Pitfall 6) |
| `merge-anon-session/index.ts` | affiliate-attribute Edge Fn logic | Phase 19 | Low — affiliate pattern is stable |
| `ADMIN_MODULES` in `modules.ts` | `@/components/admin/onboarding-builder/OnboardingBuilderModule` | Phase 34 | Ships together — no cross-phase gap |

**Action required for planner:** Update `Phase38Event` union in `supabase/functions/_shared/posthog-server.ts` (line ~214) to add `'activation_completed'`. This is an additive change to a shared file — must be in the same plan that implements `record-activation/index.ts`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `supabase/functions/ship-winner-flag/index.ts` (PostHog REST PATCH) | Edge Function | request-response | No existing Edge Fn performs a REST PATCH to an external API with a personal API key. Closest is the pattern described in RESEARCH Pattern 8. Planner uses RESEARCH.md for this specific call. |

---

## Metadata

**Analog search scope:** `leanshot/src/`, `supabase/migrations/`, `supabase/functions/`
**Files read:** 18 source files
**Pattern extraction date:** 2026-05-20
