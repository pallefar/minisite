# Phase 51: Full Traffic + Conversion Tracking System + Unified Dashboard — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 30 (≈11 SQL migrations + 5 Edge Fns + 7 React components + 4 lib/test files + 1 net-new edge runtime + analogs)
**Analogs found:** 29 / 30 (one genuinely net-new: `leanshot/middleware.ts`)
**Repo layout reminder (memory `reference_minisite_monorepo_layout`):** git root = `/Users/karstenhaldan/minisite`; `leanshot/` and `supabase/` are siblings. All paths below are repo-relative from the monorepo root unless prefixed with `leanshot/`.

> **Important convention** — the researcher's "fall-through" architecture means **every Phase 51 file already has a sibling on `main`**. The single exception is `leanshot/middleware.ts` (Vercel Edge Middleware), where there is no in-tree precedent and the planner MUST mark the task with a deploy-verify gate per RESEARCH Q1.

---

## File Classification

### Backend — Supabase migrations (new)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20270710000001_user_traffic_attribution.sql` | migration (table + RLS + indexes) | CRUD | `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` (table sections) + `20270703000008_ad_revenue_normalized_matview.sql` (RLS revoke) | exact |
| `supabase/migrations/20270710000002_channel_groups.sql` | migration (admin table + seed + classifier fn) | CRUD + transform | `supabase/migrations/20270601100011_resolve_clinic_slug_rpc.sql` (SECDEF + search_path) | role-match |
| `supabase/migrations/20270710000003_referrer_channel_rules_seed.sql` | migration (admin table + ~80 row INSERT seed) | CRUD | Same as `channel_groups.sql` above | role-match |
| `supabase/migrations/20270710000004_traffic_channel_rollup_matview.sql` | migration (matview + unique idx + SECDEF accessor) | batch (refresh) | `20270601300004_p30_matviews_and_cron.sql` lines 73–124 + `20270703000008_ad_revenue_normalized_matview.sql` | exact |
| `supabase/migrations/20270710000005_traffic_funnel_rollup_matview.sql` | migration (matview + accessor) | batch | same as above | exact |
| `supabase/migrations/20270710000006_traffic_landing_page_rollup_matview.sql` | migration (matview + accessor) | batch | same as above | exact |
| `supabase/migrations/20270710000007_traffic_realtime_view_and_rpc.sql` | migration (regular VIEW + SECDEF RPC) | request-response | `20270601100011_resolve_clinic_slug_rpc.sql` (SECDEF + is_admin gate) | exact |
| `supabase/migrations/20270710000008_is_retained_secdef_helper.sql` | migration (SECDEF helper SQL fn) | transform | `20270601300100_p31_00_enum_rename_and_secdef_ripple.sql` `_is_org_clinician(uuid, uuid)` | role-match |
| `supabase/migrations/20270710000009_traffic_matview_refresh_cron.sql` | migration (pg_cron job replace) | event-driven | `20270703000011_ad_etl_cron_schedules.sql` + `20260601000035_funnel_anomaly_cron_schedule.sql` | exact |
| `supabase/migrations/20270710000010_traffic_rls_policies.sql` | migration (RLS policies on 7 surfaces) | CRUD | `20270601300004_p30_matviews_and_cron.sql` policy section | exact |
| `supabase/migrations/20270710000011_traffic_rls_deny_tests.sql` | migration (pgTAP / SQL test stubs) | test | `supabase/tests/*.sql` (existing pgTAP suites) — fallback to vitest if pgTAP missing | role-match |
| `supabase/migrations/20270710000012_upsert_traffic_attribution_rpc.sql` | migration (SECDEF UPSERT RPC with first-touch-immutable ON CONFLICT) | request-response | `20270601100011_resolve_clinic_slug_rpc.sql` + `merge_anon_session` SECDEF | exact |

### Backend — Supabase Edge Functions (new + edits)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/functions/_shared/traffic-attribution.ts` | shared helper (recordTouch) | request-response → CRUD → event | `supabase/functions/_shared/posthog-server.ts` (captureServer + lazy admin) | exact |
| `supabase/functions/traffic-attribution-recorder/index.ts` | Edge Fn (HMAC-bearer ingest) | request-response | `supabase/functions/funnel-anomaly-cron/index.ts` (handler shape + checkServiceRoleBearer) + `merge-anon-session/index.ts` (CORS + jsonResponse) | exact |
| `supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts` | Deno test | test | `supabase/functions/_shared/posthog-server.test.ts` + per-Fn `*.test.ts` | exact |
| `supabase/functions/traffic-attribution-recorder/deno.json` | config | n/a | every other `supabase/functions/*/deno.json` | exact |
| `supabase/functions/merge-anon-session/index.ts` (EDIT) | Edge Fn (extension: read `lt_anon_id`, call `aliasServerSide`, RPC `claim_traffic_attribution`) | request-response | self (existing pattern) — extension only | exact (self) |
| `supabase/functions/funnel-anomaly-cron/index.ts` (EDIT) | Edge Fn (extension: per-channel-stage scan, dedup-key, admin_notifications.upsert) | event-driven | self (existing per-funnel loop at lines 184–249) — extension only | exact (self) |

### Backend — Edge runtime (NET-NEW, no in-tree analog)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/middleware.ts` | Vercel Edge Middleware (cookie set + fire-and-forget to recorder Fn) | request-response | **NONE in-tree** — see RESEARCH Q1 + Pattern 1 | no analog |

### Frontend — React components (new) + edits

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/src/components/admin/growth/TrafficDashboardPage.tsx` | component (page entry + tab router) | request-response | `leanshot/src/components/admin/growth/CACDashboardPage.tsx` | exact |
| `leanshot/src/components/admin/growth/TrafficChannelsTab.tsx` | component (table + Sheet drill-in) | request-response | `CACDashboardPage.tsx` Section 3 + drawer (lines 547–697) | exact |
| `leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx` | component (funnel-stage bars + audience switch) | request-response | `CACDashboardPage.tsx` + `BaseChart.tsx` | role-match |
| `leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx` | component (paged table) | request-response | `CACDashboardPage.tsx` campaign table (lines 627–660) | exact |
| `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx` | component (5-min poll + stale pip) | streaming-ish poll | `CACDashboardPage.tsx` `useEffect`+`useState` patterns (lines 285–289) | role-match |
| `leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx` | component (admin CRUD UI for 2 tables) | CRUD | `CACDashboardPage.tsx` Gaps section (lines 506–545) + Backfill handler (302–322) | role-match |
| `leanshot/src/components/admin/growth/*.test.tsx` (6 files) | tests | test | `leanshot/src/components/admin/growth/CACDashboardPage.test.tsx` | exact |
| `leanshot/src/lib/admin/modules.ts` (EDIT) | manifest entry (`growth-traffic`) | config | self (existing `growth-cac` entry at lines 294–308) | exact (self) |
| `leanshot/src/lib/analytics/events.ts` (EDIT) | additive event defs (`traffic_visit`, `traffic_signup`, `traffic_activation`, `traffic_paid`) | config | self (Phase 38 typed union pattern in `_shared/posthog-server.ts` lines 214+ — additive-only) | exact (self) |

### Frontend — Tests (new)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/test/middleware-cookie.test.ts` | integration test (fetch + Set-Cookie assertion) | test | Existing playwright/vitest fetch tests under `leanshot/test/*.test.ts` | role-match |
| `leanshot/test/rls-traffic-attribution.test.ts` | RLS deny test (two-JWT cross-tenant) | test | Phase 33 RLS test pattern; project memory `reference_rls_fixture_gotrueclient_flake` for ES256 fixture pattern | role-match |
| `leanshot/test/rls-traffic-funnels.test.ts` | RLS deny + matview accessor test | test | same | role-match |
| `supabase/tests/channel_groups.sql` / `referrer_channel_rules.sql` / `is_retained.sql` / `traffic_channel_rollup_cac.sql` | pgTAP SQL tests (with vitest fallback per RESEARCH Wave 0 gap) | test | Existing `supabase/tests/*.sql` if present, else vitest+supabase-js | role-match |

### ESLint config (edit)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/eslint.config.js` (EDIT) | config (`import-x/no-restricted-paths` PHI zone for `user_traffic_attribution`) | config | self (existing `import-x` config) + project memory `reference_eslint_import_x_path_gotcha` (use glob, not file path) | exact (self) |

---

## Pattern Assignments

### `supabase/functions/_shared/traffic-attribution.ts` (shared helper, request-response→CRUD→event)

**Analog:** `supabase/functions/_shared/posthog-server.ts`

**Imports pattern** (posthog-server.ts lines 31–33):
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { PostHog } from 'npm:posthog-node@5.10.4';
```

**Lazy admin singleton pattern** (posthog-server.ts lines 63–80) — copy verbatim, rename `_mirrorAdmin` → `_admin`. The "env-gated no-op with one-time warning" pattern is canonical.

**captureServer call site + best-effort dual-write** (posthog-server.ts lines 117–154) — `recordTouch()` mirrors this two-step shape:
1. `captureServer({ userId: distinctId, event: 'traffic_visit', properties: {...} })` — already dual-writes to `events_mirror` automatically.
2. Authoritative SQL UPSERT via service-role `admin.rpc('upsert_traffic_attribution', ...)` (NOT a direct insert — keep first-touch immutability inside the SECDEF RPC via `ON CONFLICT (anon_id) DO UPDATE SET last_touch_* = EXCLUDED.last_touch_*` only).

**Critical constraint** (posthog-server.ts lines 14–17): callers MUST wrap their handler in `try { … } finally { await shutdownPostHog(); }`. The recorder Fn (consumer) must follow this — pattern is documented in `merge-anon-session/index.ts` PITFALL note (lines 39–41).

---

### `supabase/functions/traffic-attribution-recorder/index.ts` (Edge Fn, request-response)

**Analog:** `supabase/functions/funnel-anomaly-cron/index.ts` (handler skeleton) + `supabase/functions/merge-anon-session/index.ts` (CORS + jsonResponse + jwt parsing)

**Auth pattern** (funnel-anomaly-cron lines 36–46):
```typescript
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
```

The recorder is called from Vercel Edge Middleware (anonymous client; no auth.uid). Use **HMAC-payload auth** (memory `reference_supabase_service_role_key_format_divergence`) — the middleware signs the payload with a shared secret stored in Supabase Function Secrets; the Fn verifies via `constantTimeEqual`. NOT `checkServiceRoleBearer` (that's for cron callers; the middleware should not hold service-role).

**CORS + jsonResponse shape** (merge-anon-session lines 58–73) — copy verbatim. Use `Access-Control-Allow-Origin: 'https://app.leanshot.app'` (NOT `*`) since the middleware sits on the same origin (refines memory `reference_minisite_monorepo_layout` cookie handling).

**Handler body skeleton** (funnel-anomaly-cron lines 143–166) — `handleRun()` shape:
1. Parse body (anon_id, utm fields, referrer, landingPath, org_id?, pageVariantId?).
2. Length-validate utm fields (≤2048 bytes each per RESEARCH §Security V5).
3. Redact PHI paths (`/patient/*`, `/clinic/*/patient/*`, `/dose-log/*`) per RESEARCH §Security V6.
4. Call `await recordTouch({ … })` from the shared helper.
5. Return `jsonResponse(200, { ok: true })`.
6. `finally { await shutdownPostHog(); }`.

**Error handling pattern** (funnel-anomaly-cron lines 162–165): warn-log + return 200 with `{ ok: false, error: 'code' }` — never throw to caller. Middleware is fire-and-forget; throwing would crash a transient middleware retry but not affect SPA delivery.

---

### `supabase/functions/funnel-anomaly-cron/index.ts` (EDIT — per-channel-stage extension)

**Analog:** self (lines 143–333) — pure additive extension.

**Pattern to copy from inside the same file** (lines 184–249) — the existing per-funnel loop is the template:
- Enumerate `anomaly_tracked_funnels` (existing) → enumerate cartesian {tracked_funnel × channel_group × stage_pair}.
- Per pair: `admin.rpc('compute_channel_stage_rate', { p_channel_group, p_audience, p_from, p_to, p_window_days: 7 })`.
- Threshold check (existing line 211): `if (observed_rate < expected_rate - sigma_threshold * expected_stddev) continue;`.
- 4h suppression check **per dedup key** (existing lines 217–232) — adapt: dedup key is `(channel_group, audience, funnel, stage_pair, date)`.
- Upsert into `admin_notifications` with `onConflict: 'dedup_key', ignoreDuplicates: true` (RESEARCH Code Example) — distinct from `funnel_anomaly_alerts` table because the dedup key is **multi-dimensional** and `admin_notifications` is the canonical operator-facing surface (CONTEXT D-08).

**Critical assumption** (RESEARCH A5): `admin_notifications.kind` must accept text `'traffic_funnel_drop'` without enum widening. **Wave 0 task**: `\d admin_notifications` to verify; if enum, ship same-plan widening migration per memory `feedback_planner_missed_status_enum_widening`.

**No new cron entry** — extension runs in the same 5-min tick as the existing schedule (`20260601000035_funnel_anomaly_cron_schedule.sql`).

---

### `supabase/functions/merge-anon-session/index.ts` (EDIT — alias + claim attribution)

**Analog:** self.

**Cookie parsing** — net-add helper at top of file:
```typescript
function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}
```

**Extension hook point**: after the existing SECDEF RPC merge call succeeds, before the `try { aliasServerSide(...) }` block. Pattern from RESEARCH §Pattern 4:
```typescript
const ltAnonId = parseCookie(req.headers.get('cookie'), 'lt_anon_id');
if (ltAnonId) {
  aliasServerSide(supabaseUid, ltAnonId);
  await admin.rpc('claim_traffic_attribution', { p_anon_id: ltAnonId, p_user_id: supabaseUid });
}
```

**Backwards compat invariant** (memory A6): keep `lt_anon_id` as cookie-only read; do NOT add to body schema. Existing browser callers continue to work unchanged.

**try/finally invariant** (existing lines 39–41) — already wired; do not break.

---

### `leanshot/middleware.ts` (NET-NEW — no analog)

**Analog:** NONE in-tree. Use RESEARCH §Pattern 1 (lines 262–305) verbatim as the implementation seed.

**Caveats from RESEARCH** (lines 307–310 + Q1 lines 742–748):
- Vercel's middleware.ts contract is framework-agnostic but Vite preset is less-documented than Next.
- **Plan-task gate**: after deploy, `curl -I https://app.leanshot.app/?utm_source=research_smoke` must return `Set-Cookie: lt_anon_id=` in headers. If absent, fallback path is a Supabase Edge Fn at Vercel-rewritten `/api/touch` called from `main.tsx` first React mount (loses "before SPA boot" guarantee; acceptable for v1.3 first-touch).

**Anti-patterns** (RESEARCH lines 466–474):
- Do NOT bundle `uuid` npm package — use Edge runtime's `crypto.randomUUID()`.
- Do NOT set `Domain=.leanshot.app` — leave domain unset.
- Do NOT call `auth.uid()` inside any SECDEF RPC the middleware path eventually triggers (memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).

**Cookie spec** (CONTEXT §Specific Ideas line 176):
```
HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000   (90d)
```
Refresh `Max-Age` on every visit to keep the 90d sliding window.

**Fire-and-forget shape** — RESEARCH lines 301–304 leave this as "v1.3: SPA's first React-mount POSTs to recorder" because Vercel's `ctx.waitUntil` availability isn't guaranteed for Vite preset. Two acceptable paths:
1. Pure middleware sets cookie + sets transient `lt_clinic_slug_seen` cookie (no fetch). SPA's `main.tsx` does a one-shot POST to the recorder Fn after first paint with cookie value + page metadata.
2. Middleware uses `ctx.waitUntil(fetch(recorder, …))` if available.

Plan-checker should accept either path. Path 1 is safer; planner should default there and only switch to Path 2 if the deploy-verify task confirms `ctx.waitUntil` availability.

---

### `leanshot/src/components/admin/growth/TrafficDashboardPage.tsx` (component, request-response)

**Analog:** `leanshot/src/components/admin/growth/CACDashboardPage.tsx`

**Imports pattern** (CACDashboardPage.tsx lines 17–31):
```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, RefreshCw, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
```

Phase 51 swaps the icon set per UI-SPEC §Design System row Icon library: `Activity`, `Filter`, `Map`, `LayoutList`, `Settings2`, `RefreshCw`, `ChevronRight`, `ExternalLink`. **No new imports beyond lucide-react.**

**Data-fetching pattern** (CACDashboardPage.tsx lines 285–289):
```typescript
useEffect(() => {
  void fetchCac();
  void fetchHealth();
  void fetchGaps();
}, [fetchCac, fetchHealth, fetchGaps]);
```
Native `useEffect + useState + useCallback` — **no TanStack Query** (UI-SPEC line 44 explicit override of CONTEXT D-10). Real-time tab adds `setInterval(fetchRealtime, 5 * 60 * 1000)` + cleanup (UI-SPEC §Real-time polling).

**Toast pattern** (CACDashboardPage.tsx lines 294–297):
```typescript
const showToast = useCallback((msg: string) => {
  setToastMessage(msg);
  setTimeout(() => setToastMessage(null), 4000);
}, []);
```

**Permission-error handling pattern** (CACDashboardPage.tsx lines 311–315):
```typescript
if (error.code === '42501' || error.message.toLowerCase().includes('permission')) {
  showToast('Permission denied — admin role required');
} else {
  showToast(`Backfill error: ${error.message}`);
}
```
Apply to all RPC error handlers (Taxonomy save, RPC fetches).

**Page header pattern** (CACDashboardPage.tsx lines 465–487):
```tsx
<div className="flex items-center justify-between mb-6">
  <div className="flex items-center gap-3">
    <span className="size-9 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-primary)] inline-flex items-center justify-center">
      <Activity size={18} aria-hidden />
    </span>
    <div>
      <h1 className="text-[18px] font-bold">Traffic &amp; Conversion</h1>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Multi-channel acquisition — refreshed {relativeTime} ago
      </p>
    </div>
  </div>
</div>
```
**Important typography drift to avoid**: CAC subtitle uses `text-[12px]`; UI-SPEC line 73 **consolidates 11+12 → single 11px caption**. Use `text-[11px]` (not 12px) in TrafficDashboardPage. This is the headline difference vs CAC and the planner must instruct executor not to inline `text-[12px]`.

**Section eyebrow pattern** (CACDashboardPage.tsx line 491):
```tsx
<h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-[0.06em]">
  Channel Rollup (Last 7 Days)
</h2>
```
**Note**: CAC uses `text-[13px]` for these headers; UI-SPEC ceiling is 11px. Planner explicitly tells executor: consolidate to 11px uppercase + tracking-[0.06em].

---

### `leanshot/src/components/admin/growth/TrafficChannelsTab.tsx` (component, request-response)

**Analog:** `CACDashboardPage.tsx` Section 3 (lines 547–610) + drawer (612–697).

**Card → drill-in pattern** (CACDashboardPage.tsx lines 580–607):
```tsx
<Card
  variant="clickable"
  padding="md"
  span={3}
  role="button"
  tabIndex={0}
  aria-label={`View ${channelGroup} retention curve`}
  onClick={() => openDrawer(channelGroup)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') openDrawer(channelGroup);
  }}
>
  ...
</Card>
```

**Table inside drawer pattern** (CACDashboardPage.tsx lines 627–660) — copy with adapted columns: Channel, Visits, Signups, Activations, Paid, D7 Retained, D30 Retained, CAC.

**Drawer back-navigation pattern** (CACDashboardPage.tsx lines 666–675):
```tsx
<button
  className="flex items-center gap-1 text-[12px] text-[var(--color-primary)] mb-4 hover:underline"
  onClick={() => { setDrawerState('campaign'); setSelectedCampaign(null); }}
  type="button"
>
  ← Back to channels
</button>
```
Typography drift: UI-SPEC ceiling caps body at 13px; demote the `text-[12px]` here to `text-[13px]` per UI-SPEC §Typography.

---

### `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx` (component, streaming poll)

**Analog:** `CACDashboardPage.tsx` (useEffect cleanup pattern) + UI-SPEC §Interaction Contract lines 256–260.

**Polling pattern** (UI-SPEC §Real-time polling — bake into PLAN.md):
```typescript
useEffect(() => {
  if (activeTab !== 'realtime') return;
  void fetchRealtime();
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') void fetchRealtime();
  }, 5 * 60 * 1000);
  return () => clearInterval(id);
}, [activeTab, fetchRealtime]);
```

**Stale-pip pattern** — separate 30s `useState` interval reading `Date.now() - lastSuccessAt`; render colored pip.

---

### `leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx` (component, CRUD)

**Analog:** `CACDashboardPage.tsx` Gaps section (lines 506–545) + Backfill handler (302–322).

**Inline-row + action button** (CACDashboardPage.tsx lines 518–541):
```tsx
<li key={row.id} className="flex items-center justify-between gap-4 text-[13px] py-1">
  <span>...</span>
  <Button variant="tonal" size="sm" leadingIcon={<Edit size={12} aria-hidden />}
    onClick={() => openEditDrawer(row)} aria-label={`Edit ${row.label}`}>
    Edit
  </Button>
</li>
```

**Destructive confirm pattern** (UI-SPEC §Destructive actions) — use existing `src/components/ui/Confirm.tsx`; do NOT introduce a new modal. Verb-only button label (`Delete`, never `OK`/`Yes`).

---

### `leanshot/src/lib/admin/modules.ts` (EDIT — add `growth-traffic` entry)

**Analog:** self (lines 294–308, the `growth-cac` entry).

**Pattern to copy verbatim, with substitutions**:
```typescript
{
  key: 'growth-traffic',
  label: 'Traffic',
  route: 'growth/traffic',
  icon: ActivityIcon,  // import { Activity as ActivityIcon } from 'lucide-react'
  lazy: () =>
    import('@/components/admin/growth/TrafficDashboardPage').then((m) => ({
      default: m.TrafficDashboardPage,
    })),
  flagKey: 'admin.growth.traffic.enabled',
  minRole: 'admin' as AdminRole,
},
```

**Memory gate**: per `feedback_admin_module_manifest_vs_router_branch_drift` (Phase 42-10 caught 6 broken admin routes), the AdminShell uses URL-prefix branching — confirm `/admin/growth/traffic/{channels,funnels,landing,realtime,taxonomy}` all resolve via `pathname.startsWith('/admin/growth/traffic/')` without adding a new switch branch. UI-SPEC line 24 confirms this is already the canonical mechanism; no router edit needed.

---

### `leanshot/src/lib/analytics/events.ts` (EDIT — additive event defs)

**Analog:** self + `supabase/functions/_shared/posthog-server.ts` lines 214+ (Phase38Event typed union pattern).

**Additive-only rule** (CONTEXT canonical refs) — `eslint-rules/additive-only-events.js` enforces. Add to `events.ts`:
```typescript
export const traffic_visit = makeEvent('traffic_visit', { /* properties shape */ });
export const traffic_signup = makeEvent('traffic_signup', { /* … */ });
export const traffic_activation = makeEvent('traffic_activation', { /* … */ });
export const traffic_paid = makeEvent('traffic_paid', { /* … */ });
```
(Use existing `EventDef` factory; do not invent a new shape.)

**Same-plan widening invariant** (memory `feedback_planner_missed_status_enum_widening`): if any of these events are part of a Postgres enum/check constraint (e.g., `events_mirror.event_name` if check-constrained), the widening migration ships in the SAME plan as the event-def addition.

---

### Migration patterns (SQL files 20270710000001..0012)

**Analog:** `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` + `20270703000008_ad_revenue_normalized_matview.sql` + `20270601100011_resolve_clinic_slug_rpc.sql`.

**SECDEF + search_path pattern** (resolve_clinic_slug_rpc.sql + RESEARCH Pattern 5):
```sql
create or replace function public.get_traffic_channel_rollup(...) returns table (...)
language plpgsql security definer stable
set search_path = pg_catalog, public, extensions
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if public.is_admin() then
    return query select * from public.traffic_channel_rollup tcr where ...;
  elsif p_org_id is not null and public._is_org_clinician(p_org_id, v_uid) then
    return query select * from public.traffic_channel_rollup tcr where tcr.org_id = p_org_id and ...;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
```
**Critical**: per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`, this accessor is ONLY called from dashboard reads (user JWT context). The cron-driven matview refresh path does NOT route through this fn — refresh body is plain `refresh materialized view concurrently …;` (RESEARCH §Pitfall 2).

**pg_cron + vault key pattern** (memory `reference_supabase_pg_cron_vault_service_role_pattern` + `reference_postgres_dollar_quote_nesting_in_cron_body`):
```sql
select cron.unschedule('ad_revenue_refresh')
  where exists (select 1 from cron.job where jobname = 'ad_revenue_refresh');

select cron.schedule(
  'ad_revenue_and_traffic_refresh',
  '10 * * * *',
  $body$
    select public.refresh_ad_revenue_normalized();
    refresh materialized view concurrently public.traffic_channel_rollup;
    refresh materialized view concurrently public.traffic_funnel_rollup;
    refresh materialized view concurrently public.traffic_landing_page_rollup;
  $body$
);
```
**Use named dollar-quote tag `$body$...$body$`** — bare `$$...$$` would close prematurely on inner `$$` (memory `reference_postgres_dollar_quote_nesting_in_cron_body`).

**Migration filename + timestamp gate** (memory `reference_supabase_migration_filename_regex` + `reference_migration_timestamp_collision_precheck`):
- Strict `<14-digits>_name.sql` — letter-suffix timestamps SILENTLY SKIPPED.
- Pre-merge: `ls supabase/migrations/20270710*.sql | wc -l` to catch parallel-wave collisions per `feedback_wave_n_push_correction_invalidates_wave_n_plus_1_plans`.

**Matview `now()` invariant** (RESEARCH §Pitfall 6 + memory `reference_supabase_migration_gotchas`): the 3 matviews MUST NOT use `now()` / `current_timestamp` / `current_date` in their SELECT. The regular VIEW `traffic_realtime_v` MAY use `now()`. Plan-checker greps each matview migration body.

**Partial-index IMMUTABLE invariant** (memory `reference_supabase_migration_gotchas`): partial-index predicates must be IMMUTABLE. Phase 51 partial indexes (e.g., `(user_id) WHERE user_id is not null`) are safe; any predicate using `now()` is not.

---

## Shared Patterns

### Authentication / Authorization

**Source:** `supabase/functions/_shared/lifecycle-utils.ts` (`checkServiceRoleBearer`) + `supabase/functions/_shared/posthog-server.ts` (lazy admin) + `supabase/migrations/20270601300100_p31_00_enum_rename_and_secdef_ripple.sql` (`_is_org_clinician`).

**Apply to:**
- All net-new SECDEF accessor RPCs (matview readers + `get_realtime_traffic_summary` + `upsert_traffic_attribution` + `claim_traffic_attribution`) — gate on `is_admin() OR _is_org_clinician(org_id, auth.uid())`.
- `traffic-attribution-recorder` Edge Fn — HMAC-payload auth (not service-role bearer; the middleware caller cannot hold service-role).
- `funnel-anomaly-cron` extension — keeps existing `checkServiceRoleBearer`.

**Cross-tenant deny test invariant** (memory `reference_supabase_project`): every RLS surface gets a live cross-tenant impersonation proof test. Phase 51 has 7 RLS surfaces (`user_traffic_attribution`, 3 matviews, `traffic_realtime_v`, `channel_groups`, `referrer_channel_rules`). RLS deny tests live in `leanshot/test/rls-traffic-*.test.ts` per the Phase 33/30 pattern + memory `reference_rls_fixture_gotrueclient_flake` (use admin.generateLink + verify, not signInWithPassword).

---

### Error Handling

**Source:** `supabase/functions/funnel-anomaly-cron/index.ts` lines 162–165 + `CACDashboardPage.tsx` lines 311–315.

**Apply to:** All Edge Fn handlers, all dashboard RPC consumers.

**Server-side pattern**:
```typescript
if (error) {
  console.warn('[fn-name] op failed', error.message);
  return jsonResponse(200, { ok: false, error: 'op_failed_code' });
}
```
Never throw to caller for cron / fire-and-forget. Warn-log + return 200 with structured error code.

**Client-side pattern**:
```typescript
if (error.code === '42501' || error.message.toLowerCase().includes('permission')) {
  showToast('Permission denied — admin role required');
} else {
  showToast(`Op failed: ${error.message}`);
}
```

**Inline toast** (CACDashboardPage.tsx lines 454–462) — `role="status" aria-live="polite"` + 4s auto-dismiss. Do NOT introduce a new toast primitive.

---

### PostHog send + isolate-shutdown

**Source:** `supabase/functions/_shared/posthog-server.ts` lines 14–17 + every `merge-anon-session/index.ts` consumer.

**Apply to:** Every Edge Fn that calls `captureServer()` or `aliasServerSide()` — including `traffic-attribution-recorder`, `merge-anon-session` (already wired), and any future Fn that calls `recordTouch()`.

**Mandatory contract**:
```typescript
try {
  // ...handler body with captureServer() / aliasServerSide() calls...
  return jsonResponse(200, { ok: true });
} finally {
  await shutdownPostHog();
}
```
Failure mode: batched events dropped when Deno isolate is torn down (PITFALL 1).

---

### Validation

**Source:** Existing zod-free body validation in `supabase/functions/merge-anon-session/index.ts` (lines 42 — "zod-free body validation — keep cold-start lean") + RESEARCH §Security V5.

**Apply to:** `traffic-attribution-recorder` Edge Fn input.

**Pattern**:
- utm fields: each ≤2048 bytes; reject otherwise with `400 invalid_body`.
- ASCII-only on utm/referrer (rejects unicode-confusable injection).
- Path redaction: any landing_path matching `/patient/`, `/clinic/*/patient/`, `/dose-log/`, `/admin/users/` → rewrite to `/<redacted-phi-path>` before write. PHI containment per CONTEXT discretion + memory `reference_hipaa_baa_vendor_matrix`.

---

### Bundle budget guard

**Source:** Phase 24 30 kB admin-shell chunk ceiling + memory `reference_bundle_budget_hash_hyphen` (script gotcha).

**Apply to:** All net-new admin module components.

**Constraints** (UI-SPEC lines 308–313):
- No `@tanstack/react-query` (not in stack).
- No new charting library — reuse `BaseChart` + `Sparkline`.
- No new icon set — `lucide-react` only.
- No new tab-control library — use existing `Pill` PillGroup `role="tablist"` pattern.
- No new date-picker library — use `<select>` Pill toggle.

---

### Cross-cutting memory hits — explicit list for planner

| Memory Entry | Where it Applies in Phase 51 |
|--------------|------------------------------|
| `reference_supabase_pg_cron_vault_service_role_pattern` | `20270710000009_traffic_matview_refresh_cron.sql` |
| `reference_postgres_dollar_quote_nesting_in_cron_body` | same — use `$body$...$body$` |
| `reference_supabase_migration_filename_regex` | all 12 net-new migrations |
| `reference_migration_timestamp_collision_precheck` | pre-merge `ls supabase/migrations/20270710*.sql \| wc -l` |
| `reference_supabase_back_dated_migration_blocks_push` | RESEARCH explicitly bumps CONTEXT's `20270704*` to `20270710000001+` since current tail is `20270709000008` |
| `reference_supabase_migration_gotchas` | matview no-`now()`; partial-index IMMUTABLE; SECDEF `search_path = extensions, public` |
| `feedback_rpc_auth_uid_vs_service_role_mismatch` | cron refresh body uses raw `refresh materialized view`, never accessor RPCs |
| `feedback_planner_missed_status_enum_widening` | Wave 0 verify `admin_notifications.kind` text-typed; verify event_name not enum-constrained |
| `feedback_admin_module_manifest_vs_router_branch_drift` | confirm AdminShell URL-prefix branch covers `/admin/growth/traffic/*` |
| `reference_eslint_import_x_path_gotcha` | new PHI zone rule must use glob, not bare file path |
| `reference_rls_fixture_gotrueclient_flake` | RLS test fixture uses admin.generateLink + verify (ES256-compat) |
| `reference_vercel_project` | deploy-verify task hits `https://app.leanshot.app` |
| `reference_supabase_service_role_key_format_divergence` | recorder Fn uses HMAC-payload (not service-role bearer) for middleware-callable |
| `reference_supabase_functions_deploy_import_map_flag` | required for any Fn importing `_shared/*` aliases |
| `feedback_executor_auto_adds_missing_migration` | merge-time review SQL files outside declared scope (likely zero risk here) |
| `feedback_wave_n_push_correction_invalidates_wave_n_plus_1_plans` | grep dropped column names across upcoming-wave plans before dispatch |
| `reference_supabase_project` | RLS deny test required for all 7 new RLS surfaces |
| `reference_minisite_monorepo_layout` | PLAN.md paths relative to monorepo root, not `/leanshot/` |
| `feedback_planner_iter1_anti_patterns` | no shared-file choreography across plans; planner pre-emptively audits |

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `leanshot/middleware.ts` | Vercel Edge Middleware | request-response (set cookie) | No edge middleware or SSR layer exists in tree — RESEARCH §Pattern 1 + Q1 supply the seed. Planner uses RESEARCH lines 262–305 as the canonical implementation pattern; deploy-verify gate per RESEARCH §Pitfall 1 closes the residual risk. |

---

## Metadata

**Analog search scope:** `leanshot/src/components/admin/`, `leanshot/src/lib/`, `supabase/functions/`, `supabase/migrations/`, `leanshot/test/`.

**Files scanned:** ~30 (focused on the 5 confirmed reuse targets from the orchestrator prompt + 10 supporting migrations + 4 supporting Edge Fns + UI-SPEC source-of-truth references).

**Pattern extraction date:** 2026-05-21
