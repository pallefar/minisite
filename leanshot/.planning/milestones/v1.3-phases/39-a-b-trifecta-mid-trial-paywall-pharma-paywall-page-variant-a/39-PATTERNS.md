---
phase: 39
phase_name: "A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B"
status: pattern-mapping-complete
mapped: 2026-05-22
---

# Phase 39: A/B Trifecta — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 31 new/modified files (16 src, 1 eslint-rule, 1 script, 6 Edge Fn files, 12 migrations) — plus 7 verbatim/extend anchors
**Analogs found:** 31 / 31 (100%)
**Path convention:** Per `[[reference_minisite_monorepo_layout]]`, paths use `leanshot/...` or `supabase/...` rooted at `/Users/karstenhaldan/minisite/`.

---

## File Classification

### A. New Edge Functions (Deno runtime, `supabase/functions/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `supabase/functions/variant-resolver/index.ts` | edge-fn (controller) | request-response + SECDEF read + DB upsert + PostHog capture | `supabase/functions/ship-winner-flag/index.ts` (auth + admin) **+** `supabase/functions/nps-quarterly-respond/index.ts` (JWT-forward write) | exact (combined) |
| `supabase/functions/variant-resolver/deno.json` | config | n/a | `supabase/functions/ship-winner-flag/deno.json` | exact |
| `supabase/functions/variant-resolver/index.test.ts` | test (deno) | n/a | `supabase/functions/ship-winner-flag/index.test.ts` | exact |
| `supabase/functions/slack-alert-experiments/index.ts` | edge-fn (controller) | event-driven webhook fan-out | `supabase/functions/ship-winner-flag/index.ts` (CORS+JSON shape) + nps-followup Slack pattern | role-match |
| `supabase/functions/_shared/bayes-posterior.ts` | utility (pure math) | transform | (no analog — pure math; new file with patterns from `_shared/posthog-server.ts` for module shape only) | no-analog |
| `supabase/functions/_shared/bayes-posterior.test.ts` | test (deno) | n/a | `supabase/functions/_shared/anthropic-baa-allowlist.test.ts` | role-match |

### B. Edge Functions to extend (`supabase/functions/`)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `supabase/functions/page-render/render.ts` | edge-fn (renderer) | request-response w/ ISR cache | existing file (extension only — add `Vary` header + per-variant cache key + `variant_set_id` block-resolver) | self-extend |

### C. Verbatim-reuse Edge Fn (NEVER fork)

| Existing File | Reuse Mode | Role |
|---------------|------------|------|
| `supabase/functions/ship-winner-flag/index.ts` | verbatim — invoke from `ExperimentDashboardPage.tsx` Ship-Winner button | edge-fn (PostHog PATCH) |
| `supabase/functions/_shared/posthog-server.ts` | import `captureServer` + `aliasServerSide` + `shutdownPostHog` | utility |

### D. New React components (`leanshot/src/components/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `leanshot/src/components/paywall/PaywallModal.tsx` | component (modal) | request-response (variant-resolver invoke) | `leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx` (vendor-gated + invoke pattern) + `Modal` primitive | role-match |
| `leanshot/src/components/paywall/PaywallGate.tsx` | component (wrapper) | gating render | `leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx` (vendor-gated soft-banner shape) | role-match |
| `leanshot/src/components/paywall/OnboardingFlowPaywall/index.tsx` | component (state machine, 6-step) | request-response | `leanshot/src/components/onboarding/OnboardingFlow.tsx` (multi-step container) | exact |
| `leanshot/src/components/paywall/OnboardingFlowPaywall/Screen1.tsx`–`Screen6.tsx` | component (presentational) | n/a | sibling shapes in `leanshot/src/components/onboarding/steps/*` (per CLAUDE.md onboarding layer) | role-match |
| `leanshot/src/components/pharma/PharmaContentBlock.tsx` | component (tiered render) | gating render | `PaywallGate.tsx` (sibling, this phase) + Phase 15 page-builder block renderer | role-match |
| `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` | component (admin page) | polling read + table + tabs | `leanshot/src/components/admin/growth/CACDashboardPage.tsx` | exact (sibling) |
| `leanshot/src/components/admin/growth/ShipWinnerConfirmModal.tsx` | component (typed-confirm modal) | request-response | Phase 36 V13-3 typed-confirmation modal (any `Confirm` usage in admin) + `Modal` primitive | role-match |
| `leanshot/src/components/admin/growth/BayesianBadge.tsx` | component (badge wrapper) | n/a | `Badge` primitive + `CACDashboardPage` health-badge pattern | role-match |
| `leanshot/src/components/admin/growth/TrafficSplitSlider.tsx` | component (range input) | n/a | `Pill` primitive (presets) + `Input` primitive | role-match |
| `leanshot/src/components/admin/growth/PharmaVersionList.tsx` | component (admin table) | polling read | `CACDashboardPage.tsx` sort-table section | role-match |
| `leanshot/src/components/admin/growth/PharmaVariantMetricsCard.tsx` | component (metric card) | n/a | `Card` + `BaseChart` (Phase 33 sparkline pattern) | role-match |
| `leanshot/src/components/admin/pages/BlockVariantDrawer.tsx` | component (Sheet drawer) | request-response | `CACDashboardPage.tsx` Sheet drill-in drawer | role-match |

### E. React components to extend

| Modified File | Role | Closest Analog | Match Quality |
|----------|------|----------------|---------------|
| `leanshot/src/components/admin/pages/PageEditorView.tsx` | component (extends Phase 15 editor) | self-extend (already Phase 15 editor) | self-extend |
| `leanshot/src/components/admin/AdminShell.tsx` | shell router | already manifest-driven — adding `growth/experiments` to manifest is sufficient (URL-prefix branch built-in at line 119) | self-extend |

### F. New lib + helper modules (`leanshot/src/lib/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `leanshot/src/lib/pharma/phaCheck.ts` | utility (assertion) | transform | (no exact analog — guard helper; new pattern) | no-analog |
| `leanshot/src/lib/pharma/__tests__/phaCheck.test.ts` | test (vitest) | n/a | any vitest unit-test in `src/lib/**/__tests__/*` | role-match |

### G. Lib files to extend

| Modified File | Role | Closest Analog | Match Quality |
|----------|------|----------------|---------------|
| `leanshot/src/lib/page-builder/block-schema.ts` | type module (extend `BlockNode` w/ `variant_set_id?: string`) | self-extend | self-extend |
| `leanshot/src/lib/admin/modules.ts` | manifest (append `growth/experiments` entry) | self-extend (pattern from 18 existing entries in same file) | self-extend |

### H. ESLint rule + CI script

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `leanshot/eslint-rules/no-paywall-on-safety-category.cjs` | utility (AST rule) | build-time AST walk | `leanshot/eslint-rules/no-conditional-native-review.cjs` | exact |
| `leanshot/eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs` | test (eslint RuleTester) | n/a | `leanshot/eslint-rules/no-conditional-native-review.test.cjs` | exact |
| `leanshot/scripts/check-no-paywall-on-safety-category.sh` | utility (CI grep gate) | batch | `leanshot/scripts/check-taxo-06-reconciliation.sh` (comment-strip + grep pattern) | role-match |

### I. SQL migrations (12 new, `supabase/migrations/`)

| New File (proposed ts; plan-time collision-check required) | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `20270714000001_p39_user_experiments.sql` | migration (table + RLS) | DDL | `20270602000010_cohort_definitions.sql` | exact |
| `20270714000002_p39_variant_config.sql` | migration (table + RLS + cohort FK) | DDL | `20270602000010_cohort_definitions.sql` | exact |
| `20270714000003_p39_utm_variant_map.sql` | migration (table + RLS + seed) | DDL | `20270602000010_cohort_definitions.sql` | exact |
| `20270714000004_p39_pharma_content.sql` | migration (table + `safety_category` col + RLS) | DDL | `20270602000010_cohort_definitions.sql` | role-match |
| `20270714000005_p39_pharma_content_versions.sql` | migration (append-only versioning + clinical signoff) | DDL | `20270602000010_cohort_definitions.sql` | role-match |
| `20270714000006_p39_page_variants.sql` | migration (variant table w/ canonical_page_id FK) | DDL | `20270602000010_cohort_definitions.sql` | role-match |
| `20270714000007_p39_experiment_results_matview.sql` | migration (matview + composite_score) | DDL | `20270602000011_cohort_membership_matview.sql` | exact |
| `20270714000008_p39_cohort_seed_5_default.sql` | migration (seed data via SECDEF RPC) | DML | `20270602000012_cohort_rpcs.sql` callsite pattern | role-match |
| `20270714000009_p39_utm_variant_map_seed.sql` | migration (4 seed rows) | DML | (insert-only — sibling pattern from any seed migration) | role-match |
| `20270714000010_p39_42day_archive_cron.sql` | migration (pg_cron + vault) | scheduled | `20270602000013_cohort_matview_refresh_cron.sql` | exact |
| `20270714000011_p39_refund_rate_kill_cron.sql` | migration (pg_cron) | scheduled | `20270602000013_cohort_matview_refresh_cron.sql` | exact |
| `20270714000012_p39_pharma_nps_kill_cron.sql` | migration (pg_cron) | scheduled | `20270602000013_cohort_matview_refresh_cron.sql` | exact |

> **Migration timestamp pre-check (per `[[reference_migration_timestamp_collision_precheck]]`):** plans MUST `ls supabase/migrations/20270714*` before commit and bump suffix if any sibling already claimed the slot.

---

## Pattern Assignments

### `supabase/functions/variant-resolver/index.ts` (edge-fn, request-response + SECDEF + DB upsert)

**Analog:** `supabase/functions/ship-winner-flag/index.ts` (verified, read)
**Secondary analog:** `supabase/functions/_shared/posthog-server.ts` for `captureServer` + `shutdownPostHog` usage.

**Imports pattern** (lines 47, plus shared import):

```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
```

**CORS + JSON helpers** (lines 53–73 of ship-winner-flag):

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

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}
```

**Lazy admin singleton + test override** (lines 80–108 of ship-winner-flag — copy verbatim, rename `_adminInstance` not required):

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

let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void { _adminOverride = client; }
function resetAdminForTest(): void { _adminOverride = null; _adminInstance = null; }

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;
```

**Vendor health check + JWT validation** (lines 114–177 of ship-winner-flag — copy literally, swap message string):

```typescript
function vendorHealthCheck(): Response | null {
  if (!Deno.env.get('POSTHOG_PROJECT_KEY')) {
    console.warn('[variant-resolver] vendor_unconfigured: POSTHOG_PROJECT_KEY missing.');
    return jsonResponse(503, { error: 'vendor_unconfigured', service: 'posthog' });
  }
  return null;
}

// Inside handler:
const health = vendorHealthCheck();
if (health) return health;

const bearer = jwtFromReq(req);
if (!bearer) return jsonError(401, 'unauthenticated');

const { data: userData, error: userErr } = await (admin.auth as any).getUser(bearer);
if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
const callerUid = userData.user.id;
```

**try/finally with shutdownPostHog** (per RESEARCH Pattern 1 + `posthog-server.ts:382-390` — REQUIRED to avoid event drops):

```typescript
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    // ...handler body...
    return jsonResponse(200, { variant_id, config });
  } finally {
    await shutdownPostHog();
  }
});
```

**captureServer call pattern** (mirrors RESEARCH Pattern 1 line 432-436):

```typescript
captureServer({
  userId: callerUid,                            // D-13 invariant: Supabase auth.users.id
  event: '$feature_flag_called',
  properties: { surface: body.surface, variant_id, $feature_flag: `phase39_${body.surface}` },
});
```

**Body validation pattern** (lines 130–146 of ship-winner-flag — adapt field names):

```typescript
interface ResolveBody { surface: 'paywall' | 'page' | 'pharma'; page_id?: string; block_id?: string; }
function parseBody(raw: unknown): { ok: true; body: ResolveBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  if (r.surface !== 'paywall' && r.surface !== 'page' && r.surface !== 'pharma') {
    return { ok: false, code: 'invalid_body' };
  }
  return { ok: true, body: { surface: r.surface, page_id: r.page_id as string | undefined, block_id: r.block_id as string | undefined } };
}
```

**Test internals export** (lines 264–270 — KEEP this contract; deno tests rely on it):

```typescript
export const __internal = {
  handleResolve,   // rename per Fn
  setAdminForTest,
  resetAdminForTest,
  parseBody,
  vendorHealthCheck,
};
```

**Critical pitfalls (from memory + research):**
- `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` — when resolver calls a SECDEF RPC like `resolve_cohort_for_user`, the RPC body MUST NOT reference `auth.uid()`. Pass `uid` as explicit param OR forward user JWT.
- `[[reference_supabase_functions_deploy_import_map_flag]]` — if importing from `_shared/`, deploy command MUST include `--import-map supabase/functions/import_map.json` even though CLI deprecates it.
- `[[reference_supabase_service_role_key_format_divergence]]` — if any internal-only auth uses `SUPABASE_SERVICE_ROLE_KEY` bearer comparison, use the new `sb_secret_*` token, not legacy HS256 JWT.

---

### `supabase/functions/_shared/bayes-posterior.ts` (utility, pure transform)

**Analog:** None — net-new pure math module. Module shape mirrors `_shared/posthog-server.ts:30-53` (top-of-file header comment block, named exports only, no side effects at import).

**Header comment template** (mirrors `posthog-server.ts:1-29`):

```typescript
/**
 * Phase 39 — Inline Beta-Binomial Bayesian posterior P(variant > control).
 *
 * Closed-form Monte Carlo via Marsaglia-Tsang Gamma sampling. ~30 LOC; NO
 * external dependencies (no @stan/math; no simple-statistics). Verified
 * accuracy at experiment-scale event counts (10²–10⁵ trials) within ±0.5%.
 *
 * Imported by both Edge Fn admin RPCs (server-side dashboard aggregation)
 * AND the Vite-side admin preview (no Deno-only APIs used here — safe to
 * dual-bundle).
 *
 * Unit-test with a seeded Math.random mock (see __tests__).
 */
```

**Core implementation** — verbatim from RESEARCH.md Pattern 2 (lines 481–519, already in research). Plans should `<read_first>` `_shared/posthog-server.ts` for the surrounding module style, then drop in the math.

---

### `supabase/functions/slack-alert-experiments/index.ts` (edge-fn, event-driven)

**Analog:** `supabase/functions/ship-winner-flag/index.ts` for CORS + JSON shell. Webhook POST pattern is simple — outbound `fetch` to `SLACK_WEBHOOK_EXPERIMENTS_URL`.

**Auth model:** Internal-only Fn called by pg_cron via `vault.decrypted_secrets` service-role key OR by admin RPCs. Per `[[reference_supabase_service_role_key_format_divergence]]`: if `constantTimeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY)` gate is used, ensure the env var contains the new `sb_secret_*` token.

**Body**:

```typescript
interface AlertBody {
  kind: 'variant_kill' | 'ship_winner' | 'archive_42d' | 'nps_kill' | 'refund_kill';
  variant_id: string;
  message: string;
  context?: Record<string, unknown>;
}
```

**Vendor-gated send** (per `[[reference_vendor_gated_send_health_check]]`):

```typescript
const webhook = Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL');
if (!webhook) {
  console.warn('[slack-alert-experiments] SLACK_WEBHOOK_EXPERIMENTS_URL unset — alert dropped.');
  return jsonResponse(503, { error: 'vendor_unconfigured', service: 'slack' });
}
```

---

### `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` (component, admin page)

**Analog:** `leanshot/src/components/admin/growth/CACDashboardPage.tsx` (verified, read lines 1–120).

**Imports pattern** (CACDashboardPage lines 17–31):

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

**Inline types (no new types file)** — CACDashboardPage lines 37–87 establish the convention. Phase 39 mirrors:

```typescript
type ExperimentRow = {
  variant_id: string;
  surface: 'paywall' | 'page' | 'pharma';
  composite_score: number | null;
  posterior: number; // 0..1
  // ...
};
```

**State + polling pattern** (CACDashboardPage uses `useEffect + setInterval` per CLAUDE.md "Zustand + setInterval, NO TanStack Query" rule encoded in UI-SPEC Hard Constraint #5):

```typescript
const [rows, setRows] = useState<ExperimentRow[] | null>(null);  // null = loading, [] = empty, [...] = data
useEffect(() => {
  let cancelled = false;
  async function load() {
    const { data, error } = await supabase.rpc('get_experiment_results');
    if (!cancelled) setRows(error ? [] : (data ?? []));
  }
  void load();
  const id = setInterval(load, 30_000);
  return () => { cancelled = true; clearInterval(id); };
}, []);
```

**Tabs via `Pill` primitive (NOT new Tabs)** — per UI-SPEC: 3 Pills for `Paywall / Page-Builder / Pharma`. State as `'paywall' | 'page' | 'pharma'` string union.

**Ship-Winner button — VERBATIM REUSE** — copy the entire invoke shape from `OnboardingABPanel.tsx:98-122`:

```typescript
async function handleShip(flagId: number, variant: string): Promise<void> {
  setBusyKey(`${flagId}:${variant}`);
  try {
    const { data, error } = await supabase.functions.invoke('ship-winner-flag', {
      body: { flag_id: String(flagId), variant },
    });
    const payload = data as ({ ok?: boolean } & InvokeError) | null;
    if (error || payload?.error) {
      const code = payload?.error;
      if (code === 'forbidden_not_superadmin') toast('Superadmin role required', 'error');
      else if (code === 'vendor_unconfigured') { setUnconfigured(true); toast('PostHog not yet configured', 'error'); }
      else toast(`Ship failed: ${error?.message ?? code ?? 'unknown'}`, 'error');
      return;
    }
    toast(`Shipped variant ${variant} to 100%`, 'success');
    await fetchExperiments();
  } finally { setBusyKey(null); }
}
```

**Sheet drill-in pattern** (CACDashboardPage's drawer): use `Sheet` primitive for per-variant detail. Mirrors `BlockVariantDrawer.tsx` Sheet usage.

**vendor-unconfigured soft banner** — copy from `OnboardingABPanel.tsx:56-60` and surface when variant-resolver / ship-winner-flag returns `{ error: 'vendor_unconfigured' }`. UI-SPEC copywriting table dictates exact wording.

---

### `leanshot/src/components/admin/growth/ShipWinnerConfirmModal.tsx` (component, typed-confirmation)

**Analog:** Phase 36 V13-3 typed-confirmation pattern. UI-SPEC enforces the contract (input value must equal `"ship-below-95"` to enable the confirm button).

**Pattern shape:**

```typescript
const [typedValue, setTypedValue] = useState('');
const [reason, setReason] = useState('');
const enabled = typedValue === 'ship-below-95' && reason.trim().length > 0;
// On confirm: write to admin_audit_log via SECDEF RPC + invoke ship-winner-flag
```

**Modal primitive:** uses `Modal.tsx` (already DSv2; `role="dialog"` + `aria-modal="true"` inherited). Input has `aria-describedby` per UI-SPEC accessibility table.

---

### `leanshot/src/components/admin/growth/BayesianBadge.tsx` (component, badge wrapper)

**Analog:** `Badge` primitive + tri-state pattern from CAC health badges.

**Pattern:**

```typescript
export function BayesianBadge({ posterior }: { posterior: number }) {
  const pct = Math.round(posterior * 100);
  if (posterior < 0.80) {
    return <Badge tone="neutral">Insufficient data ({pct}%)</Badge>;
  }
  if (posterior < 0.95) {
    return <Badge tone="warning">Trending ({pct}%)</Badge>;
  }
  return <Badge tone="success">Significant ({pct}%)</Badge>;
}
```

**UI-SPEC color tokens** (lines 177–179 of UI-SPEC):
- `<80%` → `--color-text-tertiary` (gray)
- `80-95%` → `--color-warning`
- `≥95%` → `--color-success` (with soft-bg `--color-primary-soft` when paired with Ship-at-95 CTA)

---

### `leanshot/src/components/admin/growth/PharmaVariantMetricsCard.tsx` (component, metric card)

**Analog:** `Card` primitive + `BaseChart` (existing wrapper). Phase 33 sparkline pattern from CACDashboardPage NetworkSummary cards.

**Pattern:** Sparkline via `Sparkline` primitive for trend. Composite metric copy from UI-SPEC: `"Conversion uplift: {N}% · NPS Δ: {N} · 1★ rate: {ratio}× baseline"`.

---

### `leanshot/src/components/admin/pages/BlockVariantDrawer.tsx` (component, Sheet drawer)

**Analog:** `CACDashboardPage.tsx` Sheet drill-in. Wraps `Sheet` primitive.

**Pattern:** Drawer slides in from right at 480px wide (per UI-SPEC desktop layout). Drag/swipe NOT supported (admin desktop-only). Focus restoration on close goes back to the "Add variant" CTA.

---

### `leanshot/src/components/paywall/OnboardingFlowPaywall/index.tsx` (component, 6-step state machine)

**Analog:** `leanshot/src/components/onboarding/OnboardingFlow.tsx` (multi-step container — referenced in CLAUDE.md feature layer).

**Pattern shape (D-14 fixed 6 screens):**

```typescript
const SCREENS = ['value-pillar-1', 'value-pillar-2', 'value-pillar-3', 'social-proof', 'pricing', 'final-CTA'] as const;
type ScreenKey = typeof SCREENS[number];
const [step, setStep] = useState(0);
// Screens are React components imported per-key; container handles next/back/dismiss
```

**Cookie-consent gate (UI-SPEC Hard Constraint #6):**

```typescript
const consent = useStore((s) => s.cookieConsent);
if (consent?.tracking !== true) return null;  // silent skip; no UI
```

**Per-screen progress (UI-SPEC accessibility):**

```jsx
<p className="sr-only">Step {step + 1} of 6</p>
<div aria-hidden="true" className="flex gap-2">{/* 6 dots */}</div>
```

---

### `leanshot/src/components/paywall/PaywallGate.tsx` (component, wrapper)

**Analog:** `OnboardingABPanel.tsx:36-96` for vendor-gated/error-state mount pattern. Calls `phaCheck(content)` per D-06 layer 2.

**Pattern:**

```typescript
import { phaCheck } from '@/lib/pharma/phaCheck';
export function PaywallGate({ content, children }: PaywallGateProps) {
  phaCheck(content);  // throws in dev/test, warn-logs in prod
  if (content.safety_category) return <>{children}</>;  // never paywall safety info
  // ... resolve variant via supabase.functions.invoke('variant-resolver') ...
}
```

---

### `leanshot/src/lib/pharma/phaCheck.ts` (utility, assertion)

**Analog:** None — net-new. Pattern from RESEARCH.md Pattern 3 Layer 2.

**Pattern shape:**

```typescript
/**
 * Phase 39 D-06 layer 2 — runtime assertion.
 *
 * Throws in dev/test when content with non-null safety_category reaches a
 * paywall render path; warn-logs in prod (defense-in-depth, never crashes
 * the user-facing render). Layer 1 = ESLint AST rule (build-time). Layer 3
 * = CI grep gate.
 */
export interface PharmaContent {
  safety_category?: string | null;
  [k: string]: unknown;
}

export function phaCheck(content: PharmaContent): void {
  if (content.safety_category) {
    const msg = `[phaCheck] safety-category "${content.safety_category}" must never be paywalled (Phase 39 D-05/D-06).`;
    if (import.meta.env.MODE === 'test' || import.meta.env.DEV) throw new Error(msg);
    console.warn(msg);
  }
}
```

---

### `leanshot/eslint-rules/no-paywall-on-safety-category.cjs` (utility, ESLint AST rule)

**Analog:** `leanshot/eslint-rules/no-conditional-native-review.cjs` (verified, read lines 1–145) — EXACT shape.

**Verbatim-reuse skeleton from `no-conditional-native-review.cjs`:**

**Header convention** (lines 1–48 — adapt phase + decision references):

```javascript
// Created in Phase 39 Plan 39-XX to enforce D-05/D-06 safety-info NEVER-paywalled invariant. Mirrors P42 D-20 no-conditional-native-review pattern.
/**
 * ESLint custom rule: no-paywall-on-safety-category
 *
 * Phase 39 D-06 layer 1 (build-time AST gate).
 * ...
 * Per ADDENDUM A6 (and sibling rules `additive-only-events.cjs`,
 * `no-raw-service-role-client.cjs`): filename is `.cjs` because
 * `package.json` declares `"type": "module"`.
 */
'use strict';
```

**Module-level constants** (lines 52–74 — adapt names):

```javascript
const PAYWALL_COMPONENTS = new Set(['Paywall', 'PaywallGate', 'PaywallModal']);
const SAFETY_PROPERTY_NAMES = new Set(['safety_category']);

const FUNCTION_BOUNDARY_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'Program',
]);
```

**module.exports shape** (lines 113–144 — adapt visitor):

```javascript
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Paywall* JSX wrappers over content reading safety_category — Phase 39 D-05/D-06.',
      recommended: false,
    },
    messages: {
      paywallOnSafety:
        '<{{component}}> wraps content reading safety_category — D-05 requires safety-info to be never-paywalled. ' +
        'Move the safety-category content OUTSIDE the paywall wrapper, or split rendering so the safety subset bypasses the gate.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const name = node.openingElement.name;
        if (name.type !== 'JSXIdentifier' || !PAYWALL_COMPONENTS.has(name.name)) return;
        // Walk subtree for safety_category reads (Identifier OR MemberExpression).
        const found = walkForSafetyCategory(node);
        if (!found) return;
        context.report({ node, messageId: 'paywallOnSafety', data: { component: name.name } });
      },
    };
  },
};
```

**Helper walk function** — adapt `findConditionalAncestor` to a forward subtree walk (instead of parent walk) since we want to detect property reads INSIDE the paywall wrapper. Bail at function boundaries per `FUNCTION_BOUNDARY_TYPES`.

**Test file** (`__tests__/no-paywall-on-safety-category.test.cjs`) — verbatim shape from `no-conditional-native-review.test.cjs` (uses ESLint `RuleTester`).

---

### `leanshot/scripts/check-no-paywall-on-safety-category.sh` (utility, CI grep gate)

**Analog:** `leanshot/scripts/check-taxo-06-reconciliation.sh` (sibling — comment-strip + grep pattern).

**Pattern (per `[[reference_grep_gate_comment_strip]]` — strip JS comments BEFORE grep):**

```bash
#!/usr/bin/env bash
set -euo pipefail
HITS=$(grep -rn --include='*.tsx' --include='*.ts' -B 10 -A 10 'safety_category' leanshot/src/ \
  | sed -E 's://.*$::; s:/\*[^*]*\*+([^/*][^*]*\*+)*/::g' \
  | grep -E '(Paywall|PaywallGate|PaywallModal)' || true)
if [ -n "$HITS" ]; then
  echo "FAIL: <Paywall*> proximity to safety_category — see Phase 39 D-05/D-06" >&2
  echo "$HITS" >&2
  exit 1
fi
```

---

### Cron migrations: `20270714000010_p39_42day_archive_cron.sql` (and the 2 sibling crons)

**Analog:** `supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql` (verified, read lines 1–34) — EXACT shape.

**Verbatim skeleton:**

```sql
-- Phase 39 Plan 39-XX — pg_cron schedule for 42-day variant lifecycle (D-11).
--
-- Memory invariants:
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]: pg_cron jobs
--     that invoke Edge Fns MUST use
--     `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')`
--     + hardcoded project URL. `current_setting('app.service_role_key')` does NOT exist.
--   - [[reference_postgres_dollar_quote_nesting_in_cron_body]]: if the cron body
--     contains nested `DO $$...$$` blocks, USE NAMED TAGS like `$body$...$body$` /
--     `$cron$...$cron$` — bare `$$` silently closes the outer quote at the first
--     inner `$$`.
--   - [[reference_supabase_migration_filename_regex]]: strict 14-digit underscore
--     filename. Letter suffix → silently skipped.

create extension if not exists pg_cron;

-- Idempotent: unschedule any prior version first.
do $$
begin
  perform cron.unschedule('p39-variant-42day-archive');
exception when others then null;
end
$$;

-- Stagger off the cohort refresh (7,22,37,52) and the anomaly funnel (*/5).
-- Pick a UTC hour that avoids overlap with P51 traffic matview refresh.
select cron.schedule(
  'p39-variant-42day-archive',
  '0 6 * * *',  -- daily 06:00 UTC per D-11
  $cron$
    select public.p39_variant_42day_archive_scan();
  $cron$
);

-- Rollback hint (manual): select cron.unschedule('p39-variant-42day-archive');
```

**Sibling cron jobs (same template, different time + function):**
- `p39-refund-rate-kill` at `0 3 * * *` (daily 03:00 UTC per D-02)
- `p39-pharma-nps-kill` at `0 4 * * 0` (weekly Sun 04:00 UTC per D-03)

---

### Schema migrations (`20270714000001_p39_user_experiments.sql` + 5 siblings)

**Analog:** `supabase/migrations/20270602000010_cohort_definitions.sql` (verified, read lines 1–60) — EXACT shape for table + RLS + comments.

**Verbatim pattern:**

```sql
-- Phase 39 Plan 39-XX — D-NN <table purpose>.
--
-- CONTEXT references:
--   - D-NN: <decision>
--
-- This migration ships:
--   1. <table_name> — <description>
--   2. RLS — SELECT for admins, NO INSERT/UPDATE/DELETE policies (SECDEF
--      RPCs in 20270714000XXX are the only writers, per Pattern S2).

-- ============================================================================
-- 1. <table_name>
-- ============================================================================
create table if not exists public.<table_name> (
  id           uuid primary key default gen_random_uuid(),
  ...
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.<table_name> is '...';

create index if not exists <table_name>_<col>_idx on public.<table_name>(<col>);

-- ============================================================================
-- 2. RLS
-- ============================================================================
alter table public.<table_name> enable row level security;

-- Admins SELECT only; writes flow via SECDEF RPCs.
create policy "<table_name>_select_admins"
  on public.<table_name>
  for select
  using (public.is_admin_at_least('admin'));
```

**Migration gotchas (per `[[reference_supabase_migration_gotchas]]`):**
- Partial index expressions MUST be IMMUTABLE.
- SECURITY DEFINER functions need `extensions` in `search_path`.
- Status enums (`status text check (status in (...))`) — when widening a status value in a later phase, the CHECK constraint MUST be widened in the SAME plan/migration that emits new values (per `[[feedback_planner_missed_status_enum_widening]]`).

---

### `leanshot/src/lib/page-builder/block-schema.ts` (extend `BlockNode`)

**Self-extend:** Add optional `variant_set_id?: string` to `BlockNode` interface (per D-13 + PAGEAB-06). Touch lines 79–86 of the existing file.

**Critical:** This file is imported by `supabase/functions/page-render/render.ts` (NOT directly — mirrored, per comment at line 17–18). The Deno mirror in `render.ts` MUST be updated in the SAME plan that updates this file, or page-render breaks.

---

### `leanshot/src/lib/admin/modules.ts` (append `growth/experiments` entry)

**Self-extend:** Append a new manifest entry between existing entries (the file at /Users/karstenhaldan/minisite/leanshot/src/lib/admin/modules.ts already has the `growth-cac` entry at line 294-308 — copy that shape exactly).

**Pattern (mirror lines 294–308 of modules.ts):**

```typescript
// Phase 39 Plan 39-XX — A/B Trifecta experiments dashboard (Paywall/Page/Pharma tabs).
// minRole 'admin' for UI gate; SECDEF RPCs re-check at the data layer (Pattern S1).
// Mitigates [[feedback_admin_module_manifest_vs_router_branch_drift]]: AdminShell
// already uses prefix-branch routing at line 119 (pathname.startsWith), so adding
// here is sufficient for both manifest AND router coverage.
{
  key: 'growth-experiments',
  label: 'Experiments',
  route: 'growth/experiments',
  icon: TrendingUpIcon,
  lazy: () =>
    import('@/components/admin/growth/ExperimentDashboardPage').then((m) => ({
      default: m.ExperimentDashboardPage,
    })),
  flagKey: 'admin.growth.experiments.enabled',
  minRole: 'admin' as AdminRole,
},
```

**AdminShell.tsx parity** — per UI-SPEC Hard Constraint #10 + `[[feedback_admin_module_manifest_vs_router_branch_drift]]`: AdminShell.tsx is ALREADY manifest-driven (line 116–120 of AdminShell.tsx — `pathname === \`/admin/${m.route}\` || pathname.startsWith(\`/admin/${m.route}/\`)`). No new branch needed; the manifest add IS the router add. Plan's verification step MUST grep AdminShell.tsx to confirm no hardcoded switch added by another phase.

---

## Shared Patterns

### Pattern A — Vendor-gated send + soft-banner UX

**Source (Edge Fn):** `supabase/functions/ship-winner-flag/index.ts:114-124`
**Source (UI):** `src/components/admin/onboarding-builder/OnboardingABPanel.tsx:56-60` + UI-SPEC copywriting "Slack-channel ops-hint banner"
**Apply to:** `variant-resolver`, `slack-alert-experiments`, AND all admin UIs (ExperimentDashboardPage, ShipWinnerConfirmModal) that consume them.

**Rule:** Every Edge Fn that depends on a vendor secret (PostHog, Slack, Resend) MUST short-circuit BEFORE outbound traffic with `{ error: 'vendor_unconfigured', service: '<name>' }` (503). UIs surface a soft banner with the UI-SPEC copy, never a hard crash.

### Pattern B — JWT-forward auth pattern (per `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]`)

**Source:** `ship-winner-flag/index.ts:166-189` (jwtFromReq + adminClient.auth.getUser(bearer))
**Apply to:** `variant-resolver/index.ts` (already in research skeleton) + any future Edge Fn calling user-context SECDEF RPCs.

**Rule:** Service-role Edge Fns calling SECDEF RPCs that reference `auth.uid()` will FAIL — the RPC sees the service-role identity, not the user. Either (a) pass `uid` as explicit RPC parameter, OR (b) forward user JWT to the RPC via a separate per-request client. Plan-checker must grep RPC bodies for `auth.uid()` and verify caller context.

### Pattern C — Lazy admin singleton + Proxy test override

**Source:** `ship-winner-flag/index.ts:80-108`
**Apply to:** ALL new Edge Fns (`variant-resolver`, `slack-alert-experiments`). The Proxy + `setAdminForTest` / `resetAdminForTest` exports are how deno tests inject mocks without import gymnastics.

### Pattern D — try/finally with shutdownPostHog

**Source:** `_shared/posthog-server.ts:373-390` (REQUIRED contract)
**Apply to:** ANY Edge Fn that calls `captureServer()`. Plans MUST wrap the handler body in:

```typescript
try {
  // ... handler ...
} finally {
  await shutdownPostHog();
}
```

Otherwise the Deno isolate terminates mid-flight and PostHog batches are dropped. Memory `[[feedback_planner_iter1_anti_patterns]]` explicitly lists this as a recurring iter-1 BLOCKER.

### Pattern E — Inline types (NO new types file) in admin pages

**Source:** `CACDashboardPage.tsx:37-87`
**Apply to:** ExperimentDashboardPage, PharmaVersionList, PharmaVariantMetricsCard, ShipWinnerConfirmModal. All inline types stay in the consuming file. `src/types/index.ts` is reserved for domain entities (User, Injection, etc.), NOT admin DTOs.

### Pattern F — Polling via `useEffect + setInterval` (NO TanStack Query)

**Source:** CLAUDE.md state-management section + CACDashboardPage precedent + UI-SPEC Hard Constraint #5
**Apply to:** ExperimentDashboardPage + every admin polling surface in this phase.

**Rule:** Zero `useQuery` / `useMutation` / `QueryClient` imports anywhere in the phase. All async via `useEffect + supabase.functions.invoke()` + cancellation-flag pattern from `OnboardingABPanel.tsx:65-96`.

### Pattern G — Cookie-consent gate before paywall mount

**Source:** UI-SPEC Hard Constraint #6 + Phase 22 cookieConsent surface
**Apply to:** `PaywallModal.tsx`, `OnboardingFlowPaywall/index.tsx`, `PaywallGate.tsx`.

**Rule:** If `useStore((s) => s.cookieConsent?.tracking) !== true`, the component returns `null` silently. NO UI, NO error log shown to user. Internal `console.warn` for dev visibility OK. Test enforces this.

### Pattern H — Migration filename + timestamp collision pre-check

**Source:** `[[reference_supabase_migration_filename_regex]]` + `[[reference_migration_timestamp_collision_precheck]]` + `[[reference_supabase_back_dated_migration_blocks_push]]`
**Apply to:** ALL 12 Phase 39 migrations.

**Rules:**
1. Filename MUST match `\d{14}_<name>.sql` strict regex. Letter suffix → silently skipped on push.
2. Before commit: `ls supabase/migrations/20270714*.sql` and bump if collision.
3. The proposed `20270714000001..12` series must be verified strictly ahead of the current remote tail (last applied migration on the linked project). If a sibling phase has landed something between now and execute-time, plans MUST rebase timestamps forward.
4. NEVER back-date a migration — it blocks `db push` entirely; recovery is operator-fix only.

### Pattern I — pg_cron + vault decrypted_secrets

**Source:** `supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql` + `[[reference_supabase_pg_cron_vault_service_role_pattern]]` + `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`
**Apply to:** All 3 new cron migrations (42-day archive, refund kill, NPS kill).

**Rules:**
1. Each cron schedule MUST first `do $$ begin perform cron.unschedule('<job-name>'); exception when others then null; end $$;` for idempotency.
2. If the cron BODY needs to call an Edge Fn (not a local SQL function), it MUST use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')` + hardcoded project URL. The GUC `current_setting('app.service_role_key')` does NOT exist on this project.
3. If the cron body contains nested `DO $$ ... $$` blocks, USE NAMED TAGS (`$cron$ ... $cron$`, `$body$ ... $body$`). Bare `$$` silently closes the outer quote at the first inner `$$` → "syntax error at or near DECLARE".
4. Stagger cron times to avoid pile-up: cohort refresh = `7,22,37,52`; anomaly funnel = `*/5`; pick non-overlapping minutes/hours for new jobs.

### Pattern J — Per-commit cwd guard for worktree executors

**Source:** `[[feedback_worktree_executor_pwd_drift_leaks_to_main]]` (Phase 25 W1 incident)
**Apply to:** Any plan whose executor runs `supabase db push` or `supabase functions deploy`.

**Rule:** Plans MUST include a per-commit `git rev-parse --show-toplevel` guard to assert the executor has NOT `cd`'d into the primary checkout. Validated W2: per-commit guard works.

### Pattern K — Verbatim-reuse declaration in plan `<read_first>`

**Source:** Specifics in CONTEXT (lines 136–137) + `[[feedback_executor_tdd_scaffolds_sibling_files]]`
**Apply to:** Every plan that mentions Ship-Winner, captureServer, or block-schema.

**Rule:** Plans MUST name the verbatim sibling file in `<read_first>` (and force a `Read` of it before any scaffolding). Otherwise parallel TDD executors will scaffold sibling copies of the file to make their RED→GREEN pass, producing merge conflicts. Specifically:
- Any Ship-Winner plan: `<read_first>` MUST include `supabase/functions/ship-winner-flag/index.ts` + `src/components/admin/onboarding-builder/OnboardingABPanel.tsx`.
- Any variant-assignment plan: `<read_first>` MUST include `supabase/functions/_shared/posthog-server.ts`.
- Any block-A/B plan: `<read_first>` MUST include `src/lib/page-builder/block-schema.ts` + `supabase/functions/page-render/render.ts`.
- The pharma ESLint rule plan: `<read_first>` MUST include `leanshot/eslint-rules/no-conditional-native-review.cjs`.

### Pattern L — Edge Fn deploy with `--import-map` flag

**Source:** `[[reference_supabase_functions_deploy_import_map_flag]]` + `[[reference_supabase_edge_function_deploy]]`
**Apply to:** Deploy step for any Edge Fn importing via `_shared/*` aliases or `import_map.json`.

**Rule:** Even though Supabase CLI deprecates the flag, it still HONORS it. Use:

```bash
supabase functions deploy variant-resolver --import-map supabase/functions/import_map.json
```

Otherwise `_shared/posthog-server.ts` imports may fail to resolve at runtime.

### Pattern M — Verify file count on batched Edits

**Source:** `[[feedback_batched_edits_verify_file_count]]`
**Apply to:** Any plan touching ≥3 files in one executor pass.

**Rule:** Pre-Read each file before Edit. Post-commit: `git show --stat HEAD` to confirm all expected files actually committed. Edits across N un-Read files fail silently per-file.

---

## No Analog Found

Files with no close codebase precedent — planner MUST use RESEARCH.md patterns directly:

| File | Role | Data Flow | Reason | Planner Reference |
|------|------|-----------|--------|-------------------|
| `supabase/functions/_shared/bayes-posterior.ts` | utility (pure math) | transform | No Bayesian/statistical math elsewhere in repo | RESEARCH.md Pattern 2 (lines 481–519) |
| `leanshot/src/lib/pharma/phaCheck.ts` | utility (assertion) | transform | No comparable per-content invariant helper | RESEARCH.md Pattern 3 Layer 2 (lines 562–569) |

Module-shape conventions for these new files still mirror existing siblings (header comment block from `posthog-server.ts:1-29`; export shape from any utility in `src/lib/`).

---

## Metadata

**Analog search scope:**
- `/Users/karstenhaldan/minisite/supabase/functions/` (verified ship-winner-flag, posthog-server, nps-quarterly-respond, page-render)
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/` (verified CACDashboardPage, OnboardingABPanel, AdminShell)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/` (verified modules.ts)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/` (verified block-schema.ts)
- `/Users/karstenhaldan/minisite/leanshot/eslint-rules/` (verified no-conditional-native-review.cjs)
- `/Users/karstenhaldan/minisite/supabase/migrations/` (verified 20270602000010, 20270602000013, 20270706000004, 20270706000006)

**Files scanned (full read):** 8
**Files scanned (partial Read, targeted):** 4
**Verbatim-reuse mandates confirmed on main:** 7/7

**Pattern extraction date:** 2026-05-22
