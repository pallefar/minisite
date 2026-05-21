# Phase 36: M3 Review Prompt Engine (Web Only) — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 22 new/modified files
**Analogs found:** 21 / 22 (1 has no analog — `nps-cta-click-log` if planner adopts Pitfall-10 recommendation)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/eslint-rules/no-conditional-native-review.test.cjs` (EXTEND) | test (eslint) | unit | `eslint-rules/no-conditional-native-review.test.cjs` (extend in place) | exact |
| `leanshot/scripts/check-no-conditional-native-review.sh` | utility (CI gate) | batch | `leanshot/scripts/check-css-logical-properties.sh` | exact |
| `supabase/functions/nps-trigger-decide/index.ts` | edge function | request-response | `supabase/functions/ship-winner-flag/index.ts` + `cancellation-feedback-to-ticket/index.ts` | exact (composed) |
| `supabase/functions/nps-feedback-submit/index.ts` | edge function | request-response | `supabase/functions/cancellation-feedback-to-ticket/index.ts` | exact |
| `supabase/functions/nps-cta-click-log/index.ts` (Pitfall-10 opt) | edge function | event-driven | `supabase/functions/_shared/posthog-server.ts` `captureServer` callers | role-match |
| `supabase/migrations/<ts>_p36_review_prompt_rules.sql` | migration (DDL + RLS) | CRUD | `supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` (SECDEF preamble) | role-match |
| `supabase/migrations/<ts>_p36_review_prompt_history.sql` | migration (append-only + RLS) | event-driven | `xp_ledger` migration pattern (P35) | role-match |
| `supabase/migrations/<ts>_p36_native_review_prompts.sql` | migration (event log) | event-driven | same as above | role-match |
| `supabase/migrations/<ts>_p36_review_cta_catalog.sql` | migration (seed table) | CRUD | (no exact codebase analog — small enum-shaped table) | role-match |
| `supabase/migrations/<ts>_p36_review_secdef_rpcs.sql` | migration (SECDEF RPCs) | CRUD | `20270707000009_helpdesk_create_ticket_rpc.sql` | exact |
| `leanshot/src/components/nps/NPSPromptModal.tsx` | component (modal) | request-response | `src/components/dashboard/burst/LevelUpBurst.tsx` + `src/components/ui/Modal.tsx` | role-match |
| `leanshot/src/components/nps/PromoterCtaModal.tsx` | component (modal) | request-response | `src/components/ui/Modal.tsx` (raw shell) | role-match |
| `leanshot/src/components/nps/DetractorFeedbackModal.tsx` | component (modal + form) | request-response | `src/components/ui/Modal.tsx` + (any submit-form modal in repo) | role-match |
| `leanshot/src/hooks/useNPSPromptListener.ts` | hook (event subscriber) | event-driven | `src/components/dashboard/burst/LevelUpBurst.tsx` (event-driven mount) | role-match |
| `leanshot/src/hooks/useNativeReviewTrigger.ts` | hook (shim) | request-response | (no analog — new shim contract) | none |
| `leanshot/src/lib/native/review-shim.ts` | utility (type contract) | request-response | (no analog) | none |
| `leanshot/src/lib/nps/decide-client.ts` | utility (Edge Fn client wrapper) | request-response | `src/components/admin/onboarding-builder/OnboardingABPanel.tsx` `handleShip()` invoke pattern | role-match |
| `leanshot/src/admin/modules/reviews/index.ts` | module entry | request-response | `src/admin/modules/helpdesk/index.ts` (via `lib/admin/modules.ts:204`) | exact |
| `leanshot/src/admin/modules/reviews/RulesListPage.tsx` | admin page (CRUD) | CRUD | `src/components/admin/onboarding-builder/OnboardingABPanel.tsx` (list + actions) | role-match |
| `leanshot/src/admin/modules/reviews/RuleFormPanel.tsx` | admin form | CRUD | (any existing admin form panel — planner picks) | role-match |
| `leanshot/src/admin/modules/reviews/FunnelDashboardPage.tsx` | admin page (chart) | CRUD | `src/components/dashboard/charts/BaseChart.tsx` consumers (Phase 33 admin-CAC) | role-match |
| `leanshot/src/admin/modules/reviews/VariantGrid.tsx` | admin component (A/B grid) | CRUD | `src/components/admin/onboarding-builder/OnboardingABPanel.tsx` (full file is the contract) | exact |
| `leanshot/src/admin/modules/reviews/CtaCatalogPage.tsx` | admin page (read-only table) | CRUD | (any existing admin table page) | role-match |
| `leanshot/src/lib/admin/modules.ts` (MODIFY at line 139) | config (manifest patch) | n/a | self (compare against `helpdesk` entry at line 198-209) | exact |
| `leanshot/src/lib/analytics/events.ts` (MODIFY) | config (event registry extension) | n/a | self (existing `EventDef` type + EVENTS const) | exact |
| `leanshot/eslint.config.js` (MODIFY — `import-x/no-restricted-paths` zones) | config | n/a | self (existing `no-restricted-paths` blocks) | exact |

---

## Pattern Assignments

### `supabase/functions/nps-trigger-decide/index.ts` (edge function, request-response)

**Analog:** `supabase/functions/ship-winner-flag/index.ts` (CORS + admin singleton + Proxy + handler shape) + `supabase/functions/cancellation-feedback-to-ticket/index.ts` (user-JWT-forwarding pattern). **CRITICAL distinction:** `nps-trigger-decide` does **service-role cooldown reads** keyed by JWT-derived `user.id`, NOT a SECDEF RPC that needs `auth.uid()` — so it composes the JWT-derived `user.id` + admin-client reads (ship-winner shape) — it does NOT need the anon-key forwarding client (that's only for the helpdesk RPC in `nps-feedback-submit`).

**CORS + JSON helpers** (`ship-winner-flag/index.ts` lines 53-74) — copy verbatim:
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

**Lazy admin singleton + test-override Proxy** (`ship-winner-flag/index.ts` lines 76-108) — copy and re-name `_adminInstance → _adminInstance` (unchanged):
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
// + setAdminForTest / resetAdminForTest / admin Proxy — unchanged
```

**Bearer validation + JWT-derived user.id** (`ship-winner-flag/index.ts` lines 165-177):
```typescript
const bearer = jwtFromReq(req);
if (!bearer) return jsonError(401, 'unauthenticated');

const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
  data: { user?: { id?: string } | null };
  error: { message?: string } | null;
};
if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
const callerUid = userData.user.id;
```

**Cooldown decision skeleton** (from RESEARCH.md lines 425-505 — code synthesised from this analog composition; planner pastes verbatim):
```typescript
// 3. Cooldown gate — service-role read against review_prompt_history
const { data: history } = await admin
  .from('review_prompt_history')
  .select('fired_at, rule_id, rating_value')
  .eq('user_id', callerUid)
  .order('fired_at', { ascending: false });

if ((history?.length ?? 0) >= 5) return jsonResponse(200, { fire: false, reason: 'lifetime_cap' });

const lastAny = history?.[0]?.fired_at;
const last1or2 = history?.find(h => h.rating_value === 1 || h.rating_value === 2);
const minGlobalDays = last1or2 ? 90 : 60;  // D-06 detractor suppression
if (lastAny && daysSince(lastAny) < minGlobalDays) {
  return jsonResponse(200, { fire: false, reason: 'global_cooldown' });
}
```

**captureServer + shutdownPostHog** (from `_shared/posthog-server.ts` — reuse, don't fork):
```typescript
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
// In handler:
try {
  // ... decision logic ...
  captureServer({ event: 'nps_prompt_shown', userId: callerUid, properties: { rule_id: eligibleRule.id } });
  return jsonResponse(200, { fire: true, copy_variant, cta_set });
} finally {
  await shutdownPostHog();   // MUST — Deno isolate teardown drops batched events
}
```

**Deno.serve entrypoint + test internals** (`ship-winner-flag/index.ts` lines 250-270) — copy shape:
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleDecide);
}

export const __internal = {
  handleDecide,
  setAdminForTest,
  resetAdminForTest,
};
```

---

### `supabase/functions/nps-feedback-submit/index.ts` (edge function, request-response)

**Analog:** `supabase/functions/cancellation-feedback-to-ticket/index.ts` — **near-exact mirror.** Both:
1. Call the same SECDEF RPC `create_ticket_with_first_message`.
2. MUST forward user JWT (RPC references `auth.uid()` — Pitfall 4).
3. Validate text body length + truncate to 4000 chars before RPC.
4. Apply tag post-insert (cancellation: `sentiment:negative` + `cancellation-feedback`; NPS: `nps-feedback` — let P37 `helpdesk-ai-assist` add sentiment async per D-10).

**Imports + constants** (lines 1-22) — paste with subject/default-body swapped:
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';

const SUBJECT = 'Feedback from NPS rating';  // D-10 verbatim
const MAX_BODY_CHARS = 4000;

let _createClient: typeof createClient = createClient;
```

**User-JWT-forwarding client + RPC call** (lines 30-80) — paste verbatim, swap `body.reason_other_text` for `body.feedback_text`:
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) {
  return jsonError(401, 'unauthenticated');
}
const userJwt = authHeader.slice(7);

// ... parse + validate body ...

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const userClient: SupabaseClient = _createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${userJwt}` } },
});

const { data, error } = await userClient.rpc('create_ticket_with_first_message', {
  p_subject: SUBJECT,
  p_body: ticketBody,   // .slice(0, MAX_BODY_CHARS)
  p_priority: 'p3',
});
if (error) return jsonError(500, 'rpc_failed');
const ticketId = data as string;

// Post-insert tag (best-effort, non-fatal)
await userClient.from('tickets').update({ tags: ['nps-feedback'] }).eq('id', ticketId!);

return jsonResponse(200, { ticket_id: ticketId });
```

**Test seam** (lines 97-106) — paste verbatim:
```typescript
export const __internal = {
  handler,
  setCreateClientForTest: (fn: typeof createClient) => { _createClient = fn; },
  resetCreateClientForTest: () => { _createClient = createClient; },
};

Deno.serve(handler);
```

---

### `supabase/migrations/<ts>_p36_review_secdef_rpcs.sql` (migration, SECDEF RPCs)

**Analog:** `supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` — full file is the template. Note: P36 RPCs (e.g. `create_review_prompt_rule`) do NOT need PHI logic; they need `admin_role` re-check.

**SECDEF preamble + search_path + auth.uid()** (lines 9-29) — copy:
```sql
begin;

create or replace function public.create_review_prompt_rule(
  p_name text,
  p_trigger_event text,
  p_cohort_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions   -- [[reference_supabase_migration_gotchas]]
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
  v_rule_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Pattern S1 server-side re-check (mirrors ship-winner-flag client→server gate)
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden_not_admin' using errcode = '42501';
  end if;

  -- ... validate p_name length 1-60, p_trigger_event in whitelist, etc. ...

  insert into public.review_prompt_rules (name, trigger_event, cohort_id, created_by)
    values (p_name, p_trigger_event, p_cohort_id, v_user_id)
    returning id into v_rule_id;
  return v_rule_id;
end;
$fn$;

revoke execute on function public.create_review_prompt_rule(text, text, uuid) from public, anon;
grant execute on function public.create_review_prompt_rule(text, text, uuid) to authenticated;

commit;
```

**Validation block pattern** (lines 30-38) — copy for `p_name`/`p_trigger_event` validation:
```sql
if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 60 then
  raise exception 'invalid_name' using errcode = '22023';
end if;
```

---

### `supabase/migrations/<ts>_p36_review_prompt_history.sql` (append-only event log)

**Analog:** P35 `xp_ledger` migration shape (RESEARCH §"Pattern 6"). DDL skeleton from RESEARCH.md lines 576-587.

**Append-only RLS pattern** — paste:
```sql
ALTER TABLE public.review_prompt_history ENABLE ROW LEVEL SECURITY;

-- User SELECT own history
CREATE POLICY history_user_select ON public.review_prompt_history
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Service-role INSERT only (Edge Fn writes)
CREATE POLICY history_service_insert ON public.review_prompt_history
  FOR INSERT TO service_role
  WITH CHECK (true);

-- No UPDATE / DELETE policies — append-only. RLS denies by default.
```

**Index pattern** (RESEARCH.md line 585):
```sql
CREATE INDEX ON public.review_prompt_history (user_id, fired_at DESC);
```

**Per [[feedback_planner_iter1_anti_patterns]]:** This table is append-only. Do NOT add UPDATE policies for "marking dismissed" — record `surface_dismissed_at` on the original INSERT or use a separate dismissal-event row.

---

### `leanshot/eslint-rules/no-conditional-native-review.test.cjs` (EXTEND in place)

**Analog:** the file already exists. Phase 36 ADDS fixtures — does NOT rewrite. Existing file: `eslint-rules/no-conditional-native-review.test.cjs` (144 lines; RuleTester setup at lines 26-31).

**Existing harness** (lines 19-31) — DO NOT touch:
```javascript
'use strict';
const { test, describe } = require('node:test');
const { RuleTester } = require('eslint');
const rule = require('./no-conditional-native-review.cjs');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});
```

**Fixture pattern to APPEND** (mirror lines 34-62 — `describe('no-conditional-native-review', () => { test(...) })`):
```javascript
test('P36 Fixture: aliased re-export `fireReview = requestReview` inside if → FAILS (Pitfall 7)', () => {
  tester.run('no-conditional-native-review', rule, {
    valid: [],
    invalid: [
      {
        filename: 'src/lib/nps/decide-client.ts',
        code: `
          import { reviewShim } from '@/lib/native/review-shim';
          function decide(rating) {
            if (rating >= 4) {
              reviewShim.request();   // ← conditional on rating; V13-3 violation
            }
          }
        `,
        errors: [{ messageId: 'conditionalSurface' }],
      },
    ],
  });
});

test('P36 Fixture: unconditional reviewShim.request() at top-level → PASSES', () => {
  tester.run('no-conditional-native-review', rule, {
    valid: [
      {
        filename: 'src/hooks/useNativeReviewTrigger.ts',
        code: `
          import { reviewShim } from '@/lib/native/review-shim';
          export function useNativeReviewTrigger() {
            return { request: () => reviewShim.request() };
          }
        `,
      },
    ],
    invalid: [],
  });
});
```

**CRITICAL:** Do NOT delete or overwrite existing fixtures in this file. The Phase 42 P42 fixtures (lines 65-144) must remain. Wave 1 plan executor instruction: "READ file first; APPEND new `test(...)` blocks at the end of the existing `describe(...)` block."

---

### `leanshot/scripts/check-no-conditional-native-review.sh` (CI grep gate)

**Analog:** `leanshot/scripts/check-css-logical-properties.sh` — full file is the template. Per CONTEXT D-04 + [[reference_grep_gate_comment_strip]].

**Header + flag handling** (lines 1-32):
```bash
#!/usr/bin/env bash
# Phase 36 Plan 36-XX (REVIEW-01 D-04) — V13-3 BLOCKER grep backup gate.
#
# Per [[reference_grep_gate_comment_strip]] — strip comments before counting
# so a JSDoc comment does not self-invalidate the gate.
#
# Exit codes:
#   0 — no co-occurrence found
#   1 — at least one violation; report printed
set -u
VERBOSE=0
if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
  VERBOSE=1
fi
SRC_DIR="${PWD}/src"
if [ ! -d "$SRC_DIR" ]; then
  echo "[check-no-conditional-native-review] error: src/ not found in $PWD" >&2
  exit 2
fi
```

**strip_comments function** (lines 80-86) — copy verbatim:
```bash
strip_comments() {
  grep -v -E '^[[:space:]]*(//|/\*|\*)'
}
```

**Pattern + co-occurrence within 10 lines** (NEW logic — extend pattern array, then awk-window):
```bash
TARGET_CALL='requestReview|showReviewPrompt|triggerReviewPrompt|InAppReview\.request|Rating\.request'
RATING_IDS='nps_score|rating|review_state|is_promoter|is_detractor'

# Strategy: for each file under src/, find lines matching TARGET_CALL and check
# whether RATING_IDS appears within 10 lines above/below.
hits=$(
  grep -rnE "($TARGET_CALL)" "$SRC_DIR" --include='*.ts' --include='*.tsx' \
    --exclude-dir=__tests__ --exclude-dir=node_modules 2>/dev/null \
    | strip_comments \
    | while IFS=: read -r file line _; do
        start=$((line > 10 ? line - 10 : 1))
        end=$((line + 10))
        if sed -n "${start},${end}p" "$file" | grep -qE "($RATING_IDS)"; then
          echo "$file:$line"
        fi
      done
)
```

**Exit code conventions** (lines 125-140) — same shape: 0 on clean, 1 on violations.

---

### `leanshot/src/components/nps/NPSPromptModal.tsx` (component, modal)

**Analog:** `src/components/ui/Modal.tsx` (shell — DO NOT reimplement focus trap or entry motion) + `src/components/dashboard/burst/LevelUpBurst.tsx` (reduced-motion gating pattern).

**Modal shell** — wrap consumer surface with the existing `Modal` primitive:
```typescript
import { Modal } from '@/components/ui/Modal';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function NPSPromptModal({ open, onClose, onRate }: Props) {
  // Modal already provides: focus trap, ESC dismiss, backdrop click, entry motion
  return (
    <Modal open={open} onClose={onClose} size="sm" title="…" dismissible>
      {/* star buttons + submit */}
    </Modal>
  );
}
```

**Reduced-motion conditional variants** (`LevelUpBurst.tsx` lines 32, 59-62):
```typescript
const reduced = useReducedMotion();
// ...
initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
transition={{ duration: reduced ? 0.1 : 0.4, ease: 'easeOut' }}
```

**ARIA labelling** (`Modal.tsx` lines 82-84 — already on shell):
```typescript
role="dialog"
aria-modal="true"
aria-label={typeof title === 'string' ? title : 'Dialog'}
```

**Star button radio-group** (NEW — no exact analog; pattern is standard ARIA):
```typescript
<div role="radiogroup" aria-label="How likely are you to recommend LeanShot? 1 to 5 stars.">
  {[1,2,3,4,5].map((n) => (
    <button
      key={n}
      role="radio"
      aria-checked={selected === n}
      aria-label={`Rate ${n} of 5 stars`}
      className="min-w-[44px] min-h-[44px] ..."   // tap target floor per UI-SPEC
      onClick={() => setSelected(n)}
    >
      <Star className={n <= selected ? 'fill-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'} />
    </button>
  ))}
</div>
```

**CRITICAL — V13-3 compliance:** NPSPromptModal MUST NOT import from `@/hooks/useNativeReviewTrigger` or `@/lib/native/review-shim`. Wave 1 plan must add an `import-x/no-restricted-paths` zone preventing this. See eslint.config.js patches below.

---

### `leanshot/src/admin/modules/reviews/VariantGrid.tsx` (admin A/B grid)

**Analog:** `src/components/admin/onboarding-builder/OnboardingABPanel.tsx` — **exact reuse target**. The `data-action="ship-winner"` attribute name is load-bearing for E2E selectors.

**Ship-Winner invoke pattern** (`OnboardingABPanel.tsx` lines 98-124) — copy verbatim:
```typescript
async function handleShip(flagId: number, variant: string): Promise<void> {
  const key = `${flagId}:${variant}`;
  setBusyKey(key);
  try {
    const { data, error } = await supabase.functions.invoke('ship-winner-flag', {
      body: { flag_id: String(flagId), variant },
    });
    const payload = data as ({ ok?: boolean } & InvokeError) | null;
    if (error || payload?.error) {
      const code = payload?.error;
      if (code === 'forbidden_not_superadmin') {
        toast('Superadmin role required', 'error');
      } else if (code === 'vendor_unconfigured') {
        setUnconfigured(true);
        toast('PostHog not yet configured', 'error');
      } else {
        toast(`Ship failed: ${error?.message ?? code ?? 'unknown'}`, 'error');
      }
      return;
    }
    toast(`Shipped variant ${variant} to 100%`, 'success');
    await fetchExperiments();
  } finally {
    setBusyKey(null);
  }
}
```

**Ship-Winner button markup** (lines 180-195) — copy verbatim, swap `Ship "{v}" to 100%` for `Ship variant`:
```typescript
<Button
  key={v}
  variant="primary"
  disabled={!canShip || busyKey === key}
  loading={busyKey === key}
  title={!canShip ? 'Superadmin only' : undefined}
  onClick={() => void handleShip(exp.id, v)}
  data-action="ship-winner"        // ← LOAD-BEARING — do not rename
  data-flag-id={exp.id}
  data-variant={v}
>
  Ship variant
</Button>
```

**Vendor-unconfigured soft banner** (lines 126-140) — copy verbatim:
```typescript
if (unconfigured) {
  return (
    <div role="status" aria-live="polite"
      className="rounded-2xl border border-[var(--color-warning,#a67b00)] bg-[var(--color-surface-elevated)] p-4">
      <p className="font-medium">PostHog API key not yet configured.</p>
      <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
        Plan 34-10 owns the human checkpoint that sets{' '}
        <code>POSTHOG_PERSONAL_API_KEY</code> and <code>POSTHOG_PROJECT_ID</code> as Supabase Function Secrets.
      </p>
    </div>
  );
}
```

**Per [[feedback_admin_module_manifest_vs_router_branch_drift]]:** if `OnboardingABPanel.tsx` still inlines the Ship-Winner button at P36 plan-time, planner decides between (a) extract to shared `src/components/admin/ShipWinnerButton.tsx` (cleaner; P42 polish absorbs migration) OR (b) inline-duplicate in `VariantGrid.tsx` (faster; consolidation TODO).

---

### `leanshot/src/lib/admin/modules.ts` (MODIFY at line 139 — placeholder replacement)

**Analog:** `helpdesk` entry at lines 198-209 — exact shape to mirror. **Compare side-by-side**:

**CURRENT placeholder** (lines 138-146):
```typescript
{
  key: 'reviews',
  label: 'Reviews',
  route: 'reviews',
  icon: StarIcon,
  lazy: placeholderFor('Phase 32+ (Review-prompt moderation)'),
  flagKey: 'admin.reviews.enabled',
  minRole: 'staff' as AdminRole,
},
```

**Wave 4 PATCH** — apply this transformation:
```typescript
{
  key: 'reviews',
  label: 'Reviews',
  route: 'reviews',
  icon: StarIcon,
  lazy: () =>
    import('@/admin/modules/reviews').then((m) => ({
      default: m.default,        // ← module exports default with sub-route table
    })),
  flagKey: 'admin.reviews.enabled',
  minRole: 'admin' as AdminRole,  // UPGRADE from 'staff' per CONTEXT — rule editing is admin op
},
```

**Per [[feedback_admin_module_manifest_vs_router_branch_drift]]:** plan-checker must `grep` for `placeholderFor('Phase 32+')` after the patch and confirm it no longer matches. `AdminShell.tsx:124` (`pathname.startsWith('/admin/${m.route}/')` prefix-branch) already routes all `/admin/reviews/*` sub-paths to this module without any router-switch change.

---

### `leanshot/src/admin/modules/reviews/index.ts` (module entry — sub-route dispatch)

**Analog:** `src/admin/modules/helpdesk/index.ts` (referenced via `lib/admin/modules.ts:204` — `m.HelpdeskLayout` named export). Same shape: default export = layout component that switches on `pathname.split('/').pop()` or similar.

**Skeleton** (planner picks naming, but the contract is `default` export consumed by `lazy()`):
```typescript
// src/admin/modules/reviews/index.ts
import { lazy } from 'react';

const RulesListPage = lazy(() => import('./RulesListPage'));
const FunnelDashboardPage = lazy(() => import('./FunnelDashboardPage'));
const CtaCatalogPage = lazy(() => import('./CtaCatalogPage'));

const SUB_ROUTES: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  '': RulesListPage,                 // /admin/reviews
  'rules': RulesListPage,            // /admin/reviews/rules
  'funnel': FunnelDashboardPage,     // /admin/reviews/funnel
  'cta-catalog': CtaCatalogPage,     // /admin/reviews/cta-catalog
};

export default function ReviewsLayout() {
  const path = window.location.pathname.replace(/^\/admin\/reviews\/?/, '');
  const Page = SUB_ROUTES[path] ?? RulesListPage;
  return <Page />;
}
```

---

### `leanshot/src/lib/analytics/events.ts` (MODIFY — add nps_trigger_eligible field + 4 new events)

**Analog:** existing `EventDef` type (lines 27-55) + EVENTS const (line 57+).

**Type extension** (line 27-55 — ADD field after `aem_dropped`):
```typescript
export type EventDef = {
  readonly name: string;
  readonly version: 1;
  // ... existing fields ...
  /**
   * Phase 36 D-01: positive-engagement trigger whitelist. Events with this
   * flag set to true are admissible as NPS review-prompt trigger events.
   * Negative-state events (payment_failed, ticket_escalated) MUST NOT have it.
   * Admin can flip in this registry — addition is audit-logged via the
   * additive-only-events lint (existing rule catches the registry add).
   */
  readonly nps_trigger_eligible?: true;
};
```

**Per [[feedback_planner_missed_status_enum_widening]]:** This is an additive field — no enum widening. The `additive-only-events.cjs` rule already permits adding OPTIONAL fields (line 14-15 in `events.ts`).

**New event entries to add** (mirror existing entries; planner names them per RESEARCH.md REVIEW-01..08):
- `nps_prompt_shown` — fired by `nps-trigger-decide` Edge Fn via captureServer
- `nps_rated` — fired by `NPSPromptModal` submit (client capture)
- `external_review_clicked` — fired by `PromoterCtaModal` CTA click (client capture + optional `nps-cta-click-log` Edge Fn server dual-write)
- `nps_feedback_submitted` — fired by `nps-feedback-submit` Edge Fn after ticket created

**Pitfall 3 — Phase 35 dependency:** `level_up / streak_milestone_30d / streak_milestone_60d / streak_milestone_90d / weekly_challenge_completed` event entries are owned by Phase 35. Verify at plan-time via `grep "level_up" src/lib/analytics/events.ts` — if absent, Wave 1 plan must either own those entries or hard-depend on Phase 35 merge.

---

### `leanshot/eslint.config.js` (MODIFY — `import-x/no-restricted-paths` zones)

**Analog:** existing `no-restricted-paths` blocks in this same file. Per [[reference_eslint_import_x_path_gotcha]] — use **glob patterns**, not bare file paths (bare paths silently no-op).

**Pattern to follow** (planner finds existing zone block in eslint.config.js; the pattern is):
```javascript
'import-x/no-restricted-paths': [
  'error',
  {
    zones: [
      // ... existing zones ...
      // Phase 36 — V13-3 BLOCKER defence: consumer NPS modal must not import admin code
      {
        target: './src/components/nps/**',
        from: './src/admin/**',
        message: 'NPS consumer modals must not import admin code (bundle budget + V13-3).',
      },
      // Phase 36 — V13-3 BLOCKER: consumer NPS modal must not import native shim/hook
      // (the hook is wired at App.tsx root; modal renders are downstream of decision)
      {
        target: './src/components/nps/**',
        from: ['./src/hooks/useNativeReviewTrigger.ts', './src/lib/native/review-shim.ts'],
        message: 'V13-3 BLOCKER: NPS modal must not import native-review surface.',
      },
    ],
  },
],
```

**Per [[reference_eslint_import_x_path_gotcha]]:** glob `'./src/components/nps/**'` — NOT bare `'./src/components/nps/NPSPromptModal.tsx'`. The bare file form silently no-ops.

---

### `leanshot/src/hooks/useNPSPromptListener.ts` (hook, event-driven)

**Analog:** `src/components/dashboard/burst/LevelUpBurst.tsx` (Phase 35 pattern — root-mounted, event-driven, fires Edge Fn on event). Open Question #3 in RESEARCH resolved: single global subscription at App.tsx root.

**Mount pattern** (mirrors `LevelUpBurst` placement in `App.tsx`):
```typescript
// src/App.tsx — Phase 35 already mounts LevelUpBurst at root; add sibling:
// <NPSPromptModal ... />  with useNPSPromptListener() supplying decision payload
```

**Event subscription + Edge Fn invoke** — pattern composed from `LevelUpBurst.tsx` (event-driven mount) + `OnboardingABPanel.tsx` `handleShip` (functions.invoke pattern):
```typescript
export function useNPSPromptListener() {
  const [decision, setDecision] = useState<DecisionPayload | null>(null);

  useEffect(() => {
    const unsub = subscribeToEvents(['activation_completed','level_up','streak_milestone_30d',
                                     'streak_milestone_60d','streak_milestone_90d',
                                     'weekly_challenge_completed','kb_article_helpful_voted'],
      async (eventName) => {
        const { data, error } = await supabase.functions.invoke('nps-trigger-decide', {
          body: { event_name: eventName },
        });
        if (error) return;
        const payload = data as DecisionPayload;
        if (payload.fire) setDecision(payload);
      });
    return () => { unsub(); };
  }, []);

  return decision;
}
```

**P24 event-emitter:** existing pattern (see CONTEXT canonical_refs). Planner verifies the `subscribeToEvents()` (or equivalent) helper exists in `src/lib/analytics/`; if not, uses the same DOM-event approach used by Phase 35 `leanshot:replay-tour` (see App.tsx).

---

### `leanshot/src/hooks/useNativeReviewTrigger.ts` + `src/lib/native/review-shim.ts` (NEW scaffolding)

**No codebase analog.** RESEARCH.md lines 535-558 supplies the verbatim implementation. Net-new contract for v1.4.

**Hook** (`useNativeReviewTrigger.ts`):
```typescript
import { reviewShim } from '@/lib/native/review-shim';

export function useNativeReviewTrigger() {
  return {
    request: async (): Promise<{ shown: boolean }> => {
      // Web no-op. v1.4 replaces review-shim.ts with Capacitor plugin.
      return reviewShim.request();
    },
  };
}
```

**Shim** (`review-shim.ts`):
```typescript
export const reviewShim = {
  // v1.3 web no-op.
  // v1.4 swap to: import { InAppReview } from '@capacitor-community/in-app-review';
  //               return await InAppReview.requestReview();
  async request(): Promise<{ shown: boolean }> {
    return { shown: false };
  },
};
```

**V13-3 compliance:** The hook IS wired UNCONDITIONALLY into trigger-event handlers. Per D-20: "the hook IS wired into the trigger-event handlers (via the existing event-emitter pattern from P24); the no-op makes it inert on web." Plan-checker confirms hook is called WITHOUT rating-conditional ancestor in the wiring code.

---

## Shared Patterns

### Authentication / Authorization (Pattern S1 dual-layer)

**Source:** `ship-winner-flag/index.ts` (server gate) + `OnboardingABPanel.tsx` (client UI hint).

**Apply to:** All admin SECDEF RPCs (`create_review_prompt_rule`, `update_review_prompt_rule`, `delete_review_prompt_rule`); all admin Edge Fns reading `review_prompt_rules` etc.

**Server-side admin_role re-check** (`ship-winner-flag/index.ts` lines 180-190) — copy verbatim into every admin SECDEF RPC:
```typescript
const { data: prof } = (await ((admin as any)
  .from('profiles').select('admin_role').eq('id', callerUid).maybeSingle())) as {
    data: { admin_role?: string } | null; error: unknown;
  };
if (prof?.admin_role !== 'admin' && prof?.admin_role !== 'superadmin') {
  return jsonError(403, 'forbidden_not_admin');
}
```

**Client surfaceCheck** (admin module pattern):
```typescript
const canEdit = surfaceCheck('admin.reviews.edit');
// Button disabled but visible — server still re-validates
<Button disabled={!canEdit} title={!canEdit ? 'Admin role required' : undefined}>Save rule</Button>
```

---

### User-JWT Forwarding to SECDEF RPC (Pitfall 4 — load-bearing)

**Source:** `cancellation-feedback-to-ticket/index.ts` lines 55-70.

**Apply to:** `nps-feedback-submit` (calls `create_ticket_with_first_message` which references `auth.uid()`). **DO NOT** apply to `nps-trigger-decide` reads (those are pure service-role queries keyed by JWT-derived user.id, not RPC calls).

**Pattern** (paste verbatim):
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) return jsonError(401, 'unauthenticated');
const userJwt = authHeader.slice(7);

const userClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${userJwt}` } },
});

const { data, error } = await userClient.rpc('create_ticket_with_first_message', { ... });
```

**Per [[feedback_rpc_auth_uid_vs_service_role_mismatch]]:** Calling with service-role client → RPC throws `unauthenticated` because `auth.uid()` returns NULL. Verified live in `20270707000009_helpdesk_create_ticket_rpc.sql` line 21-29.

---

### Server-side PostHog capture with shutdown

**Source:** `_shared/posthog-server.ts` `captureServer()` (lines 117+).

**Apply to:** Every Edge Fn that emits a PostHog event — `nps-trigger-decide` (`nps_prompt_shown`), `nps-feedback-submit` (`nps_feedback_submitted`), optional `nps-cta-click-log` (`external_review_clicked`).

**Required wrapping** (per file header comment lines 1-8):
```typescript
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

export async function handler(req: Request): Promise<Response> {
  try {
    // ... handler logic, including captureServer({ userId, event, properties }) ...
    return jsonResponse(200, ...);
  } finally {
    await shutdownPostHog();   // CRITICAL — Deno isolate teardown drops batched events
  }
}
```

**`captureServer()` enforces** `userId` required (line 117-119 — `if (!args.userId) throw`). Always pass JWT-derived `user.id`, never anon ID, never request-body user_id.

---

### Modal scaffolding (focus trap + ESC + backdrop + reduced motion)

**Source:** `src/components/ui/Modal.tsx` (already in DSv2).

**Apply to:** All three consumer modals (Surface A/B/C — `NPSPromptModal`, `PromoterCtaModal`, `DetractorFeedbackModal`) and any admin Confirm dialogs.

**Pattern:** Use the existing `<Modal>` primitive directly — DO NOT reimplement. The shell already supplies:
- `role="dialog"` + `aria-modal="true"` (line 82-84)
- ESC dismiss via `useEffect` keydown listener (lines 56-67)
- `document.body.style.overflow = 'hidden'` (line 62)
- Backdrop click → onClose when `dismissible={true}` (line 81)
- framer-motion entry + exit motion already wired (lines 77-97)
- `mobileFullscreen` prop for Surface C textarea overflow (line 89-92)

```typescript
<Modal open={open} onClose={onClose} size="sm" title="…" dismissible mobileFullscreen={false}>
  {/* surface content — focus trap + motion already handled by shell */}
</Modal>
```

**Reduced-motion conditional inside content** (only needed for custom motion not on the shell — e.g. star-fill transitions):
```typescript
const reduced = useReducedMotion();
className={cn('transition-colors', reduced ? 'duration-0' : 'duration-200')}
```

---

### CI gate exit code conventions

**Source:** `check-css-logical-properties.sh` lines 125-140.

**Apply to:** `check-no-conditional-native-review.sh`.

```bash
if [ "$TOTAL" -eq 0 ]; then
  echo "✓ check-no-conditional-native-review: 0 violations"
  exit 0
else
  echo "✗ check-no-conditional-native-review: $TOTAL violations remain."
  echo "  Per Phase 36 V13-3 BLOCKER (CONTEXT D-03/D-04) — native review prompt must fire unconditionally."
  exit 1
fi
```

---

### Append-only RLS pattern (history tables)

**Source:** Phase 35 `xp_ledger` (research §"Pattern 6") and existing `audit_logs`.

**Apply to:** `review_prompt_history`, `native_review_prompts`.

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
-- User SELECT own only
CREATE POLICY <t>_user_select ON public.<table>
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Service-role INSERT only (Edge Fn writes)
CREATE POLICY <t>_service_insert ON public.<table>
  FOR INSERT TO service_role WITH CHECK (true);
-- NO UPDATE / DELETE policies — append-only by RLS default-deny
```

**Per [[feedback_state_counter_table_needs_upsert_on_event]]:** If a counter column is later added to `review_prompt_history`, use `INSERT … ON CONFLICT DO NOTHING / DO UPDATE`, NEVER bare UPDATE.

---

### Migration timestamp safety

**Source:** memory + RESEARCH.md Pitfall 4.

**Apply to:** All Phase 36 migrations.

- Strict 14-digit prefix per [[reference_supabase_migration_filename_regex]]; underscore separator (`_` not `-`).
- Phase 36 picks timestamps STRICTLY GREATER than `20270709000008_p40_roi_view.sql` (latest on disk 2026-05-21).
- Recommendation: start at `20270710000001_p36_…` to stay safely ahead of Phase 35 in-flight migrations.
- Pre-merge: glob `<prefix>*.sql` >1 → rename collisions to future timestamp + `git mv` + retry push.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner Action |
|------|------|-----------|--------|---------------|
| `src/hooks/useNativeReviewTrigger.ts` | hook (shim wrapper) | request-response | Net-new contract for v1.4 mobile-shell handoff. Web no-op has no prior art. | Use RESEARCH.md lines 537-547 verbatim. |
| `src/lib/native/review-shim.ts` | type contract | request-response | Net-new for v1.4. | Use RESEARCH.md lines 549-557 verbatim. |
| `supabase/functions/nps-cta-click-log/index.ts` (optional — Pitfall 10) | edge function | event-driven | Recommended in Pitfall 10 to dual-write `external_review_clicked` into events_mirror (since client `posthog.capture` does NOT dual-write). | Reuse `_shared/posthog-server.ts` `captureServer({ event:'external_review_clicked', properties:{platform} })` — same template as `nps-feedback-submit` shape but no RPC. Planner may defer to Wave 5 if funnel dashboard accepts PostHog-only read for v1.3. |
| `supabase/migrations/<ts>_p36_review_cta_catalog.sql` (seed table) | migration | CRUD | No exact prior-art for a tiny seed-only enum-shaped catalog table. | Use RESEARCH.md lines 599-616 verbatim; copy SECDEF revoke/grant boilerplate from `helpdesk_create_ticket_rpc.sql`. |

---

## Cross-Cutting Pitfall Mitigations (from RESEARCH.md)

| Pitfall | Where | Mitigation |
|---------|-------|------------|
| **1. ESLint rule already exists** | `eslint-rules/no-conditional-native-review.cjs` | EXTEND `.test.cjs` only — DO NOT recreate `.cjs` file. Plan-checker greps for full file replacement. |
| **2. `auth.uid()` mismatch** | `nps-feedback-submit` | Forward user JWT (anon-key + Authorization header) — NEVER service-role to this RPC. |
| **3. `nps_trigger_eligible` flag missing** | `events.ts` | Wave 1 plan adds the field + seeds D-01 whitelist. If Phase 35 events not yet landed, Wave 1 owns them too OR hard-depends on Phase 35. |
| **4. Migration timestamp collision** | All 6 migrations | Pick `20270710000001+`; pre-merge glob check; rename + `git mv` if collision. |
| **5. `CohortPicker` doesn't exist** | Surface D (`RuleFormPanel`) | Wave 4 builds `src/components/admin/cohort/CohortPicker.tsx` as thin wrapper around `AdminCohortList` OR uses bare `<select>` of cohort IDs. Plan-checker BLOCKER if neither addressed. |
| **6. Bundle ceiling** | `import-x/no-restricted-paths` zones | Wave 1 adds glob zones (NOT bare paths) blocking `src/components/nps/**` ← `src/admin/**` and consumer modals ← native shim. |
| **7. V13-3 lint silent-bypass via aliased re-export** | Existing AST rule | Wave 1 adds P36 fixture proving aliased pattern FAILS. If currently passes, extend rule to track aliased imports from `@/lib/native/review-shim`. |
| **8. `npm install` worktree drift** | Any new dep | P36 should require NO new deps. Flag plan-check failure if a dep is added. |
| **9. `Rule.active = false` not enforced server-side** | `nps-trigger-decide` | Edge Fn query MUST include `.eq('active', true)`. Plan-checker grep for this clause. |
| **10. `events_mirror` write race on `external_review_clicked`** | `PromoterCtaModal` CTA click | Either add tiny `nps-cta-click-log` Edge Fn (preferred) OR query PostHog directly in funnel (slower). |

---

## Metadata

**Analog search scope:**
- `supabase/functions/**` (28 functions scanned)
- `supabase/migrations/*helpdesk*.sql` (RPC patterns)
- `leanshot/eslint-rules/**` + `leanshot/scripts/**` (CI gates)
- `leanshot/src/components/ui/Modal.tsx` (consumer modal shell)
- `leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx` (Ship-Winner full contract)
- `leanshot/src/components/dashboard/burst/LevelUpBurst.tsx` (root-mounted event-driven modal)
- `leanshot/src/lib/admin/modules.ts` (manifest patch target + helpdesk shape)
- `leanshot/src/lib/analytics/events.ts` (registry extension target)
- `leanshot/eslint.config.js` (rule registration + restricted-paths zones)

**Files scanned in detail:** 11

**Pattern extraction date:** 2026-05-21

**Confidence:** HIGH — every analog read end-to-end; every excerpt is direct codebase quote with file path + line numbers. Two genuine net-new contracts (`useNativeReviewTrigger` + `review-shim`) have no analog and use RESEARCH.md verbatim.
