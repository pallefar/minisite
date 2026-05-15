---
phase: 19
plan: 6a
type: execute
wave: 3
depends_on: [1, 3]
files_modified:
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerLayout.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerDashboard.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerKpiCard.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerTrendChart.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerActivityFeed.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/PartnerDashboard.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/api.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/api.test.ts
autonomous: true
requirements: [AFF-04]
tags: [ui, partner-dashboard, swr, role-gate, w-1-split-a]

must_haves:
  truths:
    - "Authenticated user with auth.users.app_metadata.role='affiliate' navigates /partner/dashboard (once wired by 19-09) and sees 4 KPI cards (clicks 30d, conversions 30d, commissions 30d, pending payout), 30-day trend chart, and recent-activity feed of last 10 conversions"
    - "Non-affiliate user attempting /partner/* sees a forbidden state and zero affiliate data fetched (PartnerLayout enforces)"
    - "Dashboard refreshes every 10 min via SWR-style poll + manual Refresh button; 'Updated N min ago' badge"
    - "PartnerLayout exposes PartnerContext consumed by PartnerDashboard (this plan) AND PartnerLinks/Payouts/Assets pages (Plan 19-06b)"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerLayout.tsx"
      provides: "Shared shell + sub-nav for /partner/* routes; role-gate enforcement; PartnerContext provider"
      contains: "role === 'affiliate'"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerDashboard.tsx"
      provides: "KPI bento + chart + activity feed per UI-SPEC §/partner/dashboard"
      contains: "PartnerKpiCard"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/api.ts"
      provides: "SWR-style data hooks for clicks/conversions/commissions/payouts from Plan 19-01 tables; consumed by both 19-06a and 19-06b"
      contains: "useAffiliateStats"
  key_links:
    - from: "PartnerDashboard"
      to: "affiliate_conversions + affiliate_clicks + payouts tables"
      via: "supabase.from(...).select(...)"
      pattern: "from\\(['\"]affiliate_(conversions|clicks)['\"]\\)|from\\(['\"]payouts['\"]\\)"
    - from: "PartnerLayout"
      to: "partner-account-status Edge Function (Plan 19-03)"
      via: "fetch + 10-min poll + window focus"
      pattern: "partner-account-status"
---

<objective>
**W-1 split (a/2):** Ship the shared partner layout + dashboard surface — PartnerLayout (role gate + PartnerContext), PartnerDashboard composing 4 KPI cards + trend chart + activity feed, plus the shared `src/lib/affiliate/api.ts` data layer. Plan 19-06b ships Links, Payouts, Assets, and the StripeConnectOnboardingCard.

Purpose: AFF-04 (partner dashboard). The 10-min SWR poll (D-10) is the load-bearing UX contract. PartnerLayout's PartnerContext is the integration seam consumed by 19-06b.

**Iter-1 revisions (2026-05-15):**
- **W-1 split:** Original 19-06 had 16 files / 2 tasks (warning ceiling). Now split into 19-06a (this plan, 8 files / 1 task) and 19-06b (8 files / 1 task).
- **BL-4 route registry:** This plan does NOT create the route registry — Plan 19-06b owns `src/routes/partner-routes.ts` (one file per plan keeps pathspec commits clean across the W-1 split).
- **BL-4 NO App.tsx mutation in this plan.** Plan 19-09 wires App.tsx using the route registry from 19-06b.

Output: 6 React component files + 1 affiliate data API module + 1 PartnerDashboard test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/HomeTab.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/cards/StreaksCard.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/clinic/roster/RosterTable.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/clinic/settings/AuditTab.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Card.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/EmptyState.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Skeleton.tsx
@/Users/karstenhaldan/minisite/leanshot/src/hooks/useCountUp.ts
@/Users/karstenhaldan/minisite/leanshot/src/hooks/useReducedMotion.ts

<interfaces>
From `BaseChart`: `<BaseChart config={ChartConfiguration}>` — Chart.js wrapper with theme + reduced-motion + key-on-theme remount semantics.
From `useCountUp(value)`: returns animated value; auto-honors `useReducedMotion`.
From `RosterTable.tsx`: 10-min poll pattern using `setInterval` inside `useEffect` + `lastFetchedAt: Date` state for "Updated N min ago" badge.
Existing `<Card span={1..12}>` + 12-col grid (`grid grid-cols-12 gap-4 md:gap-6`).
Existing `<Badge tone="success|warning|danger|neutral">` for status pills.
Plan 19-01 RLS: affiliates self-select policies permit fetching own rows from all 4 affiliate tables.
Plan 19-03 endpoint: GET `/functions/v1/partner-account-status` returns `{ state, requirements, disabled_reason }`.

**Cross-plan contract (PartnerContext):** This plan defines + exports `PartnerContext` from `PartnerLayout.tsx`. Plan 19-06b consumes it. The shape is:
```
interface PartnerContextValue {
  profile: { id: string; display_name: string; referral_code: string | null; status: string; stripe_payouts_enabled: boolean };
  connectState: 'pending' | 'needs_info' | 'active' | 'restricted';
  requirements: string[];
  refreshAll: () => void;
  lastFetchedAt: Date | null;
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build affiliate data API + PartnerLayout + 3 dashboard primitives + Dashboard composition + tests</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/api.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/api.test.ts, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerLayout.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerDashboard.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerKpiCard.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerTrendChart.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerActivityFeed.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/PartnerDashboard.test.tsx</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§"/partner/dashboard" KPI anatomy; §"Color"; §"Typography" /partner/dashboard budget)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§C.4 PartnerDashboard analog)
    /Users/karstenhaldan/minisite/leanshot/src/components/dashboard/cards/StreaksCard.tsx (Card composition + useCountUp usage)
    /Users/karstenhaldan/minisite/leanshot/src/components/clinic/settings/AuditTab.tsx (paged activity row pattern)
    /Users/karstenhaldan/minisite/leanshot/src/components/clinic/roster/RosterTable.tsx (10-min poll + refresh button + "Updated N min ago" pattern)
    /Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx (chart.js config shape)
  </read_first>
  <acceptance_criteria>
    - `src/lib/affiliate/api.ts` exports the 4 fetchers + 3 interfaces listed in the action body.
    - `PartnerLayout.tsx` exports `PartnerContext` (React Context) + `usePartnerContext()` hook + the default `PartnerLayout` component; gates non-affiliate users to a forbidden state without fetching data.
    - `PartnerDashboard.tsx` consumes `usePartnerContext()` and renders 4 KPI cards + trend chart + activity feed.
    - 10-min interval `setInterval` triggers `refreshAll()` (verified by vi.useFakeTimers).
    - 11 vitest tests pass (5 api.test + 6 PartnerDashboard.test).
    - Bundle delta: partner-dashboard chunk ≤ 8 kB gz (W-1 split shrinks each chunk vs the 12 kB target on the original 19-06).
    - **NO `src/App.tsx` modification.**
    - **NO `src/routes/partner-routes.ts` creation** (Plan 19-06b owns it).
  </acceptance_criteria>
  <action>
**File 1 — `src/lib/affiliate/api.ts`** (shared data layer for 19-06a + 19-06b):
- Export `interface AffiliateStats { clicks30d: number; clicksPrev30d: number; conversions30d: number; conversionsPrev30d: number; commissionsCents30d: number; commissionsCentsPrev30d: number; pendingPayoutCents: number; }`.
- Export `interface ConversionRow { id: string; created_at: string; status: 'pending' | 'confirmed' | 'flagged' | 'rejected' | 'paid'; commission_cents: number; subscription_id: string | null; }`.
- Export `interface DailyPoint { date: string; clicks: number; conversions: number; }`.
- Export `async function fetchAffiliateStats(affiliateId: string, supabase: SupabaseClient): Promise<AffiliateStats>` — runs 3 grouped queries (clicks count for last 30d + prev 30d window; same for conversions; SUM(commission_cents) where status IN ('pending','confirmed') for pending payout).
- Export `async function fetchRecentConversions(affiliateId: string, supabase: SupabaseClient, limit = 10): Promise<ConversionRow[]>` — `from('affiliate_conversions').select(...).eq('affiliate_id', id).order('created_at', { ascending: false }).limit(limit)`.
- Export `async function fetchDailyTrend(affiliateId: string, supabase: SupabaseClient): Promise<DailyPoint[]>` — bucket clicks + conversions by `date_trunc('day', created_at)` for last 30d; returns 30 points (fill gaps with zeros).
- Export `async function fetchAffiliateProfile(userId: string, supabase: SupabaseClient): Promise<{ id: string; display_name: string; referral_code: string | null; status: string; stripe_payouts_enabled: boolean } | null>` — `from('affiliates').select(...).eq('user_id', userId).maybeSingle()`.

**File 2 — `src/lib/affiliate/__tests__/api.test.ts`**:
- T1: fetchAffiliateStats returns zero for affiliate with no clicks/conversions.
- T2: fetchAffiliateStats correctly windows 30d / prev 30d (mock now()).
- T3: fetchRecentConversions returns at most `limit` rows ordered DESC.
- T4: fetchDailyTrend fills 30 days even when gaps in data (`{ clicks: 0, conversions: 0 }` for empty days).
- T5: fetchAffiliateProfile returns null when user has no affiliate row.

**File 3 — `PartnerLayout.tsx`** (NEW — defines the shared shell):
- Reads `user = useStore(s => s.user)`. Role check: `const isAffiliate = user?.app_metadata?.role === 'affiliate';`. If not affiliate → render a forbidden state (heading "This area is for approved affiliates only" + body + link back to `/`). Guard returns early before any fetch.
- Loads affiliate profile via `fetchAffiliateProfile(user.id, supabase)` on mount; while loading shows `<Skeleton>`. If profile is null → forbidden state.
- Renders shared sub-nav at top: 4 links `/partner/dashboard · /partner/links · /partner/payouts · /partner/assets` with active state underline using `--color-primary` (UI-SPEC §Color accent reserved-for list item 3). Active link derived from `window.location.pathname`.
- Renders `{children}` below the sub-nav.
- Loads partner-account-status (Plan 19-03) on mount + 10-min interval + `window` focus listener; exposes `{ connectState, requirements }` via PartnerContext.
- Export `PartnerContext = createContext<PartnerContextValue | null>(null)` + `usePartnerContext()` hook (throws if no provider).
- Export default `PartnerLayout` component.

**File 4 — `PartnerDashboard.tsx`** (per UI-SPEC §"/partner/dashboard"):
- Consumes `usePartnerContext()` for `profile` + `connectState` + `requirements`.
- Top: greeting "Hi {display_name} 👋" (`text-2xl`) + right-side Refresh button + "Updated N min ago" badge.
- **Defer the StripeConnectOnboardingCard render** to a child slot — 19-06b ships the card. PartnerDashboard imports `<StripeConnectOnboardingCard>` from `@/components/partner/StripeConnectOnboardingCard` (file authored by 19-06b). **I-4 cross-wave gate (locked)**: 19-06a is Wave 3, 19-06b is Wave 4 — workspace will be typecheck-red between Wave 3 close and Wave 4 open. **Execute contract**: `/gsd-execute-phase 19` MUST run Waves 3 + 4 back-to-back in the same session WITHOUT an intermediate `npm run build` or `tsc` step. Typecheck and build run only at Wave 4 close. Executor flags any pre-Wave-4 build invocation as a contract violation; 19-06a SUMMARY must note "I-4 cross-wave build gate honored: built only after 19-06b shipped".
- KPI grid: `<div className="grid grid-cols-12 gap-4 md:gap-6">` with 4 `<PartnerKpiCard>` (UI-SPEC labels: "Clicks · 30d", "Conversions · 30d", "Commissions · 30d" (currency), "Pending payout" (currency)) — each `span={3}` on desktop, `col-span-6` on mobile.
- `<PartnerTrendChart data={daily} />` `span={12}`.
- `<PartnerActivityFeed rows={recent} />` `span={12}`.
- Data fetch: on mount, call `fetchAffiliateStats(profile.id)` + `fetchDailyTrend(profile.id)` + `fetchRecentConversions(profile.id, 10)`. Set `lastFetchedAt` state. `setInterval(refresh, 600_000)` (10 min per D-10). Manual Refresh button calls the same refresh fn.
- Show `<Skeleton>` during initial load.
- 4-sizes-per-surface budget honored (verify via grep at the end of file: `text-2xl|text-3xl|text-sm|text-xs` — exactly 4 unique).

**File 5 — `PartnerKpiCard.tsx`** (per UI-SPEC §"/partner/dashboard" KPI card anatomy + PATTERNS.md C.5):
- Props: `{ label: string; value: number; deltaPct: number | null; icon: ReactNode; format?: 'count' | 'currency'; }`.
- Uses `<Card variant="default" padding="md" span={3}>`.
- Top row: `text-xs text-[var(--color-text-secondary)]` label + lucide icon `aria-hidden`.
- Center: `text-3xl font-semibold text-[var(--color-primary)]` value; pass through `useCountUp(value)` for animation; `aria-live="polite"`. When `format='currency'`, render as `$N.NN` with tabular-nums (`numerals-tabular` class if exists else `tabular-nums`).
- Bottom: `text-xs` delta vs prev 30d: positive → `text-[var(--color-success)]` "+12% vs prev 30d"; negative → `text-[var(--color-danger)]` "-12% vs prev 30d"; zero/null → neutral text "—".
- Responsive: `span={3}` on desktop; on mobile (`<md`) becomes `col-span-6` via Tailwind responsive prefix on the Card wrapper.

**File 6 — `PartnerTrendChart.tsx`** (per UI-SPEC §"/partner/dashboard" trend chart + PATTERNS.md C.6):
- Wraps `<BaseChart>` from `src/components/dashboard/charts/BaseChart.tsx`.
- Props: `{ data: DailyPoint[] }`.
- ChartConfiguration: type `'line'`, two datasets (Clicks with `borderColor: 'var(--color-primary)'`, Conversions with `borderColor: 'var(--color-success)'`), x-axis labels = day strings, no chart.js plugin imports beyond what BaseChart already registers (UI-SPEC line 186).
- Tooltips on hover, `responsive: true`, `maintainAspectRatio: false`.
- Container Card: `<Card span={12} padding="md">` with heading "Clicks + conversions (30d)" + legend "Clicks · Conversions" (UI-SPEC copy).

**File 7 — `PartnerActivityFeed.tsx`** (per UI-SPEC §"/partner/dashboard" activity feed):
- Props: `{ rows: ConversionRow[] }`.
- Wrapper `<Card span={12} padding="md">` with heading "Recent conversions" (UI-SPEC copy).
- Empty state via `<EmptyState>` with heading "No conversions yet" + body "Your dashboard updates within 10 minutes of a paid referral. Share your link to get started." (UI-SPEC).
- Each row: 12-col internal grid `grid grid-cols-12 gap-2 py-2 text-sm`: `[date col-span-3] [status badge col-span-2] [commission $ col-span-2] [subscription_id col-span-5 truncate]`.
- Status badge mapping per UI-SPEC §Color §Semantic states: pending→warning, confirmed→success, flagged→danger, paid→success, rejected→neutral.

**File 8 — `__tests__/PartnerDashboard.test.tsx`** (vitest + jsdom):
- T1: non-affiliate user → forbidden state, no data fetch (test against PartnerLayout in isolation OR wrap PartnerDashboard with a mock PartnerContext).
- T2: affiliate user → 4 KPI cards render with values from fetchAffiliateStats; trend chart renders; activity feed shows 10 rows.
- T3: 10-min interval triggers refetch (use vi.useFakeTimers).
- T4: Refresh button click → immediate refetch + lastFetchedAt updates.
- T5: connectState=pending → placeholder where StripeConnectOnboardingCard mounts (stubbed in test).
- T6: connectState=active → card hidden (stub returns null).

**Constraints:**
- 4 sizes / 2 weights per surface (UI-SPEC). Grep verification: `grep -E 'text-(xs|sm|base|lg|xl|2xl|3xl|4xl|display)' src/components/partner/*.tsx | grep -v test | sort -u | awk -F: '{print $2}' | sort -u | wc -l` MUST be ≤ 4 per file family.
- Each partner page is in `src/components/partner/` and will be lazy-imported by the route registry (in 19-06b) — partner-dashboard chunk target ≤ 8 kB gz (W-1 split halves the original 12 kB target).
- DO NOT use `s.user!` non-null assertion — guard via `if (!user) return null;` before destructuring.
- Reuse existing primitives (Card, Button, Badge, Pill, EmptyState, Skeleton, BaseChart) — NO new primitives.
- **NO `src/App.tsx` modification** (BL-4 — Plan 19-09 owns wiring).
- **NO `src/routes/partner-routes.ts` creation** (Plan 19-06b owns the partner route registry).
- This plan IMPORTS `@/components/partner/StripeConnectOnboardingCard` (a file created in Plan 19-06b). Build will only succeed when both plans land in the same Wave-3 execute batch; verify by listing both plan SUMMARYs as `prerequisites_satisfied` in the Wave 3 close.
- Commit with pathspec on this plan's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/lib/affiliate src/components/partner/__tests__/PartnerDashboard.test.tsx --run && (git diff --quiet src/App.tsx || (echo "BL-4 FAIL"; exit 1))</automated>
  </verify>
  <done>API module + PartnerLayout + 4 dashboard component files committed; 11 vitest tests pass; 10-min poll functional via fake timers; role-gate verified; `src/App.tsx` untouched (BL-4); partner-dashboard chunk ≤ 8 kB gz.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser (any user) → /partner/dashboard | Client-side role gate (PartnerLayout) is hint; RLS is enforcement |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-06a-S | Spoofing | Non-affiliate accesses /partner/dashboard | mitigate | RLS `pol_*_self_select` blocks data fetch; client gate (PartnerLayout) returns forbidden state |
| T-19-06a-T | Tampering | Affiliate self-promotes via fake KPI numbers | mitigate | KPI values are computed server-side from RLS-filtered tables; client cannot inject |
| T-19-06a-I | Information Disclosure | Cross-tenant data leak via the dashboard fetchers | mitigate | All fetchers in `api.ts` filter on `affiliate_id = profile.id`; RLS doubles as defense in depth |
| T-19-06a-D | DoS | Refresh-button spam | accept | 10-min interval is the only auto-refresh; manual click is single per user action |
</threat_model>

<verification>
- 5 api.test.ts + 6 PartnerDashboard.test.tsx vitest tests pass
- Role gate verified: non-affiliate users render forbidden state; no data fetched
- 10-min SWR poll functional via fake timers
- `src/App.tsx` UNTOUCHED in this plan (BL-4)
- partner-dashboard bundle chunk ≤ 8 kB gz
- Accent color used ONLY on KPI value text + primary CTA + focus rings + active sub-nav + chart Clicks line — count is 5 instances (UI-SPEC §Color accent reserved-for list)
</verification>

<success_criteria>
- Affiliate user opens /partner/dashboard (once 19-09 wires App.tsx) → sees greeting + 4 KPI cards + 30-day trend chart + recent activity feed
- PartnerContext exposes `profile`, `connectState`, `requirements`, `refreshAll`, `lastFetchedAt` to children
- Refresh badge updates "Updated N min ago" on each refetch; manual Refresh button bumps timestamp
- Non-affiliate users at /partner/* see forbidden state
- StripeConnectOnboardingCard slot reserved for 19-06b's component
</success_criteria>

<output>
After completion, create `19-06a-SUMMARY.md`: list of 8 new files; bundle delta measurement (partner-dashboard chunk); role-gate test results; PartnerContext shape locked for 19-06b consumption; 10-min poll behavior verified; BL-4 note that App.tsx is UNTOUCHED.
</output>
