---
phase: 52-vendor-setup-foundation
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx
  - leanshot/src/lib/admin/modules.ts
autonomous: true
requirements: [VENDOR-11]
user_setup: []

must_haves:
  truths:
    - "A staff user navigating to /admin/vendor-smoke sees a Vendor health table with one row per vendor"
    - "Each row shows status as a Badge (success=ok, danger=fail, neutral=not_configured), last-checked, latency, message"
    - "A 'Run smoke now' button invokes the vendor-smoke Fn and re-fetches results"
    - "Empty, loading, error, and not-authorized states all render"
    - "The module is reachable via the existing AdminShell catch-all router branch (no router edits needed)"
  artifacts:
    - path: "leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx"
      provides: "Staff-gated vendor smoke dashboard component"
      min_lines: 80
      exports: ["AdminVendorSmokeDashboard"]
    - path: "leanshot/src/lib/admin/modules.ts"
      provides: "ADMIN_MODULES entry for vendor-smoke"
      contains: "vendor-smoke"
  key_links:
    - from: "AdminVendorSmokeDashboard.tsx"
      to: "vendor_smoke_log table"
      via: "supabase.from('vendor_smoke_log').select(...)"
      pattern: "from\\('vendor_smoke_log'\\)"
    - from: "AdminVendorSmokeDashboard.tsx"
      to: "vendor-smoke Edge Fn"
      via: "supabase.functions.invoke('vendor-smoke')"
      pattern: "functions\\.invoke\\('vendor-smoke'\\)"
    - from: "leanshot/src/lib/admin/modules.ts"
      to: "AdminVendorSmokeDashboard"
      via: "lazy import in ADMIN_MODULES entry"
      pattern: "AdminVendorSmokeDashboard"
---

<objective>
Build the staff-only `AdminVendorSmokeDashboard` admin module per 52-UI-SPEC.md and register it in `ADMIN_MODULES` so it is reachable at `/admin/vendor-smoke` via the existing catch-all router branch.

Purpose: The dashboard is the live missing-secret tracker — it separates `not_configured` (not provisioned yet) from `fail` (broken) so the team can drive Phase 70 provisioning.
Output: `AdminVendorSmokeDashboard.tsx` + a `vendor-smoke` manifest entry in `modules.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/52-vendor-setup-foundation/52-CONTEXT.md
# AUTHORITATIVE visual + interaction contract — implement EXACTLY (copy, copywriting, states, a11y)
@.planning/phases/52-vendor-setup-foundation/52-UI-SPEC.md

# Reuse table structure, fetch+loading+error+role="alert" pattern, supabase client usage VERBATIM
@leanshot/src/components/admin/compliance/BaaChainTable.tsx
@leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx
# Manifest registration precedent (compliance entry is the exact analog: superadmin, ShieldIcon)
@leanshot/src/lib/admin/modules.ts
# Page wrap precedent (AdminLayout, manifest-gated, no explicit guard in page body)
@leanshot/src/components/admin/pages/AdminCompliancePage.tsx

<interfaces>
<!-- UI primitives + client (VERIFIED). Use directly — no exploration needed. -->

From @/components/ui/Card.tsx:
  interface CardProps { variant?: 'default'|'elevated'|'interactive'|'hero'|'flat'; padding?: 'none'|'sm'|'md'|'lg'; span?: 3|4|5|6|7|8|12 }
  interface CardHeaderProps { title: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }  // renders <h2>
From @/components/ui/Badge.tsx:
  interface BadgeProps { tone?: BadgeTone; leadingIcon?: ReactNode }   // BadgeTone includes 'success' | 'danger' | 'neutral'
From @/components/ui/Button.tsx:
  interface ButtonProps { variant?: 'primary'|...; size?: 'sm'|'md'|...; loading?: boolean; leadingIcon?: ReactNode }  // loading sets aria-busy
From @/components/ui/EmptyState.tsx:
  function EmptyState({ illustration?, title, body, cta?, className?, inline? })
From @/hooks/useToast.ts:
  function useToast(): (message: string, kind?: 'success'|'error'|'info') => void
From @/lib/supabase.ts:
  export const supabase: SupabaseClient   // .from(...).select(...), .functions.invoke(...)
From @/components/admin/AdminShell.tsx:
  export function NotAuthorizedCard()      // reuse verbatim for the not-staff state

vendor_smoke_log row shape (from migration 52-02):
  { vendor_name: string; status: 'ok'|'fail'|'not_configured'; latency_ms: number|null; message: string|null; checked_at: string }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: AdminVendorSmokeDashboard component (table + states + run-now)</name>
  <files>leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx</files>
  <action>
Create `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx` exporting `AdminVendorSmokeDashboard` (named export). Implement EXACTLY the 52-UI-SPEC contract — do not invent additional screens or columns.

Model the data layer on `BaaChainTable.tsx`: `useState` for `rows`/`loading`/`fetchError`; a `fetchRows` async that does `supabase.from('vendor_smoke_log').select('vendor_name,status,latency_ms,message,checked_at').order('vendor_name')`; call it in a `useEffect` on mount. Type rows with the shape from the interfaces block.

Layout per UI-SPEC: `<main className="p-6 min-h-screen bg-[var(--color-bg)]">` with a `<header className="flex justify-between items-center mb-6">` containing `<h1>` "Vendor health" (text-lg font-semibold tracking-tight) and a `<p>` description "Per-vendor smoke test results. Run daily at 08:00 UTC or on demand." (text-xs text-[var(--color-text-secondary)]). NOTE: UI-SPEC copy currently reads "06:00 UTC" — the actual cron is 08:00 UTC (matches plan 52-02); use 08:00. Then a `<Card span={12} variant="default" padding="none">` with `<CardHeader title="Vendor integrations" icon={<ShieldCheck size={16} aria-hidden />} action={<RunSmokeButton .../>} />` and the table OR EmptyState OR error paragraph in the body.

Table per UI-SPEC: columns Vendor | Status | Last checked | Latency | Message. Wrap in `<div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">`. Column header class exactly `text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3`; `<th scope="col">`. Rows: `border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-elevated)]`, `tabIndex={0}` + `focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]`, read-only (no row click). Status cell: `<Badge tone={BADGE_TONE[status]}>` where `BADGE_TONE = { ok:'success', fail:'danger', not_configured:'neutral' }` and label is `ok` / `fail` / `not configured`. Latency cell: `{latency_ms}ms` tabular-nums or `—` when null. Last checked: `new Date(checked_at).toLocaleDateString()`. Message: `text-xs font-mono text-[var(--color-text-secondary)] max-w-[40ch] truncate` or `—`.

States: Loading → `<p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>` in the card body. Empty (zero rows) → `<EmptyState illustration={<ShieldCheck className="size-8" aria-hidden />} title="No smoke results yet" body="Run the smoke check to see per-vendor integration health." cta={<RunSmokeButton .../>} />`. Error → `<Card variant="flat" padding="md"><p role="alert" className="text-sm text-[var(--color-danger)]">Could not load smoke results. Try refreshing — if the problem persists, check Supabase connectivity.</p></Card>`.

`RunSmokeButton` inline sub-component: `<Button variant="primary" size="sm" loading={running} leadingIcon={<Play size={14} aria-hidden />}>{running ? 'Running…' : 'Run smoke now'}</Button>`. On click: set running, `await supabase.functions.invoke('vendor-smoke', { body: {} })`; on success toast `('Smoke check running — results will update in a few seconds.', 'info')` then re-call `fetchRows`; on failure toast `('Could not trigger smoke check. Check staff permissions and Fn health.', 'error')`; always clear running in finally. Use `useToast()`.

All colors via `var(--color-*)` tokens only — no hard-coded hex (project anti-pattern + UI-SPEC). Icons from lucide-react (`ShieldCheck`, `Play`).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -i "AdminVendorSmoke" | head -5; echo "---grep gates---"; F=src/components/admin/AdminVendorSmokeDashboard.tsx; grep -q "from('vendor_smoke_log')" "$F" && grep -q "functions.invoke('vendor-smoke'" "$F" && grep -q "export function AdminVendorSmokeDashboard\|export const AdminVendorSmokeDashboard" "$F" && grep -q "tone=" "$F" && ! grep -qE "#[0-9a-fA-F]{6}" "$F" && echo DASH_OK</automated>
  </verify>
  <done>Component compiles under tsc; renders table + loading/empty/error states + Run-smoke-now wired to functions.invoke + refetch; Badge tones mapped; no hard-coded hex; named export present.</done>
</task>

<task type="auto">
  <name>Task 2: Register vendor-smoke in ADMIN_MODULES manifest</name>
  <files>leanshot/src/lib/admin/modules.ts</files>
  <action>
Add a new entry to the `ADMIN_MODULES` array in `leanshot/src/lib/admin/modules.ts`, mirroring the `compliance` entry exactly (per CONTEXT D-02: register in manifest AND rely on the catch-all router branch — avoids the Phase 42 manifest↔router drift). Entry fields: `key: 'vendor-smoke'`, `label: 'Vendor health'`, `route: 'vendor-smoke'`, `icon: ShieldCheckIcon` (REUSE the existing `ShieldCheck as ShieldCheckIcon` import already present at line ~45 — do NOT add a duplicate `ShieldCheck` import, it causes a TS duplicate-identifier error per RESEARCH Pitfall 3), `lazy: () => import('@/components/admin/AdminVendorSmokeDashboard').then((m) => ({ default: m.AdminVendorSmokeDashboard }))`, `flagKey: 'admin.vendor_smoke.enabled'`, `minRole: 'superadmin' as AdminRole` (staff-only highest-restriction gate, matching the compliance precedent).

Do NOT edit AdminShell routing — `AdminShell.tsx:116-120` already matches `/admin/${m.route}` for any manifest entry. The manifest entry alone makes `/admin/vendor-smoke` reachable.

Verify the array still satisfies `readonly AdminModule[]` (the file ends with `satisfies readonly AdminModule[]`) — the new entry must match the `AdminModule` shape (key/label/route/icon/lazy/flagKey/minRole).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -iE "modules\.ts|duplicate" | head -5; F=src/lib/admin/modules.ts; node -e "const s=require('fs').readFileSync('$F','utf8'); const dup=(s.match(/import \{ ShieldCheck /g)||[]).length; if(dup>1){console.error('duplicate ShieldCheck import');process.exit(1)} if(!s.includes(\"route: 'vendor-smoke'\")){console.error('no vendor-smoke route');process.exit(1)} if(!s.includes('AdminVendorSmokeDashboard')){console.error('no lazy import');process.exit(1)} console.log('MANIFEST_OK')"</automated>
  </verify>
  <done>ADMIN_MODULES has a vendor-smoke entry (route 'vendor-smoke', minRole superadmin, lazy → AdminVendorSmokeDashboard); reuses existing ShieldCheckIcon import; full app tsc passes; no router edits.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → /admin/vendor-smoke | route access; only superadmin should see the module |
| browser → vendor_smoke_log | SELECT gated by RLS (is_staff) — server-enforced even if client gate bypassed |
| browser → vendor-smoke Fn | functions.invoke forwards JWT; Fn re-verifies is_staff |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-52-09 | Elevation of Privilege | dashboard route | mitigate | Dual-layer: manifest `minRole: 'superadmin'` client gate (Pattern S1) + `vendor_smoke_log` RLS `is_staff()` server gate (52-02) — client gate alone is not trusted |
| T-52-10 | Information Disclosure | smoke message column rendered in UI | accept | Fn (52-01) records only fixed error codes, never secrets; UI truncates to 40ch; no PHI involved |
| T-52-11 | Spoofing | run-now invoke | mitigate | Fn (52-01) `isAuthorized` re-validates the forwarded JWT's `is_staff`; UI button is not the security boundary |
| T-52-SC | Tampering | npm installs | accept | No new packages; lucide-react + existing UI primitives only |
</threat_model>

<verification>
- `npx tsc -p tsconfig.app.json --noEmit` passes for the whole app (no errors in the new file or modules.ts).
- Grep gates: select from vendor_smoke_log, functions.invoke('vendor-smoke'), named export, badge tones, no hard-coded hex, single ShieldCheck import, vendor-smoke route present.
- Manual/close-out: navigate to /admin/vendor-smoke as a superadmin → table renders (rolls up to Phase 70 HUMAN-UAT per milestone contract; no per-phase UAT signal here).
</verification>

<success_criteria>
AdminVendorSmokeDashboard implements the UI-SPEC contract (table, 4 status/empty/error states, run-now), is registered in ADMIN_MODULES (superadmin), reachable via the catch-all router, and the full app type-checks.
</success_criteria>

<output>
Create `.planning/phases/52-vendor-setup-foundation/52-03-SUMMARY.md` when done. Record: the 06:00→08:00 UTC copy correction, that no AdminShell router edit was needed, and the superadmin minRole choice.
</output>
