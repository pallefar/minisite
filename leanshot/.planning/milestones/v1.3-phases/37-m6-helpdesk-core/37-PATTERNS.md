# Phase 37: M6 Helpdesk Core — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 28 new/modified artifacts across schema, Edge Functions, frontend, admin, tests
**Analogs found:** 27 / 28 (ClamAV scan has no analog — deferred)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/YYYYMMDD_helpdesk_schema.sql` | migration | CRUD | `supabase/migrations/20270601100009_org_patient_links_table.sql` | role-match (two-axis RLS) |
| `supabase/migrations/YYYYMMDD_helpdesk_fts_index.sql` | migration | transform | `supabase/migrations/20270702000004_phi_access_log.sql` (append-only shape) | partial |
| `supabase/migrations/YYYYMMDD_helpdesk_pg_cron.sql` | migration | event-driven | `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` | exact |
| `supabase/migrations/YYYYMMDD_log_phi_access_rpc.sql` (reuse) | migration | request-response | `supabase/migrations/20270702000005_log_phi_access_rpc.sql` | exact (no change needed) |
| `supabase/functions/helpdesk-inbound/index.ts` | Edge Fn | event-driven | `supabase/functions/clinic-invite/index.ts` | role-match |
| `supabase/functions/helpdesk-inbound/index.test.ts` | test | event-driven | `supabase/functions/clinic-invite/index.test.ts` | role-match |
| `supabase/functions/helpdesk-ai-assist/index.ts` | Edge Fn | request-response | `supabase/functions/_shared/anthropic-summarize.ts` | exact (BAA scope chain) |
| `supabase/functions/helpdesk-ai-assist/index.test.ts` | test | request-response | `supabase/functions/_shared/anthropic-summarize.test.ts` | exact |
| `supabase/functions/helpdesk-csat-send/index.ts` | Edge Fn | request-response | `supabase/functions/nps-quarterly-followup/index.ts` | role-match |
| `supabase/functions/helpdesk-sla-breach-cron/index.ts` | Edge Fn | event-driven | `supabase/functions/winback-scorer/index.ts` | role-match |
| `supabase/functions/_shared/email-router.ts` (extend) | shared util | request-response | `supabase/functions/_shared/email-router.ts` (current) | exact (add template entry) |
| `supabase/functions/_shared/posthog-server.ts` (extend) | shared util | event-driven | `supabase/functions/_shared/posthog-server.ts` lines 214-254 | exact (extend Phase38Event union) |
| `leanshot/src/helpdesk/HelpdeskWidget.tsx` | component | request-response | `leanshot/src/App.tsx` (lazy pattern) + `leanshot/src/components/ui/Sheet.tsx` | role-match |
| `leanshot/src/helpdesk/KBSearchTypeahead.tsx` | component | request-response | `leanshot/src/components/dashboard/cards/ForYouCard` (lazy in tab) | role-match |
| `leanshot/src/helpdesk/KBArticleView.tsx` | component | transform | `leanshot/src/components/changelog/WhatsNewDrawer.tsx` (react-markdown + dompurify) | role-match |
| `leanshot/src/helpdesk/TicketForm.tsx` | component | CRUD | `leanshot/src/components/ui/Input.tsx` + `Button.tsx` | partial |
| `leanshot/src/helpdesk/ReplyComposer.tsx` | component | CRUD | `leanshot/src/helpdesk/TicketForm.tsx` (sibling) | — |
| `leanshot/src/helpdesk/TypingIndicator.tsx` | component | event-driven | `leanshot/src/lib/clinic-realtime.ts` (broadcast pattern) | role-match |
| `leanshot/src/helpdesk/MacroTypeahead.tsx` | component | request-response | `leanshot/src/components/admin/rag/RagTopicsPage.tsx` (cmdk pattern implied) | partial |
| `leanshot/src/lib/admin/modules.ts` (modify line 186) | config | — | `leanshot/src/lib/admin/modules.ts` (current, HITL queue entry pattern) | exact |
| `leanshot/src/admin/modules/helpdesk/` (8 pages) | component | CRUD | `leanshot/src/components/admin/rag/RagLayout.tsx` (multi-page sub-nav module) | exact |
| `leanshot/src/lib/hipaa/phi-access-rpc.ts` (reuse) | utility | request-response | `leanshot/src/lib/hipaa/phi-access-rpc.ts` (current) | exact (no change needed) |
| `leanshot/src/lib/posthog-route-disable.ts` (extend PHI_URL_REGEX) | utility | — | `leanshot/src/lib/posthog-route-disable.ts` lines 40-56 | exact |
| `leanshot/src/lib/analytics/events.ts` (extend) | utility | event-driven | `supabase/functions/_shared/posthog-server.ts` Phase38Event union | role-match |
| `leanshot/src/test/rls-helpdesk-tickets.test.ts` | test | CRUD | `leanshot/src/lib/rag/__tests__/rls-matrix.test.ts` | exact |
| `leanshot/src/helpdesk/KBArticleView.test.tsx` | test | transform | `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx` | role-match |
| `leanshot/src/admin/modules/helpdesk/HelpdeskInboxPage.test.tsx` | test | CRUD | `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx` | exact |
| ClamAV scan in `helpdesk-inbound` | — | — | none | no analog — defer |

---

## Pattern Assignments

### Domain 1: Schema + Migrations

---

#### `supabase/migrations/YYYYMMDD_helpdesk_schema.sql` (tickets + ticket_messages + ticket_attachments + ticket_tags + csat_responses + agent_macros + ticket_inbound_events + ticket_ai_suggestions)

**Analog:** `supabase/migrations/20270601100009_org_patient_links_table.sql` (two-axis RLS: `user_id` AND `org_id`)

**Two-axis RLS pattern** (lines 1-36 of analog):
```sql
-- Two-axis RLS: ticket owner OR org member with helpdesk.agent permission
create table public.tickets (
  id          uuid        not null default gen_random_uuid() primary key,
  org_id      uuid        not null references public.organizations(id) on delete restrict,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  phi         boolean     not null default false,
  status      text        not null default 'open'
              check (status in ('open','pending','resolved','closed','waiting_on_customer','spam')),
  -- ... other columns
);
alter table public.tickets enable row level security;

-- User-side: ticket owner sees own tickets
create policy "tickets_select_owner"
  on public.tickets for select to authenticated
  using (user_id = auth.uid());

-- Agent-side: org members with helpdesk.agent permission see org tickets
create policy "tickets_select_agent"
  on public.tickets for select to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = tickets.org_id
        and user_id = auth.uid()
    )
  );
```

**Status CHECK constraint — enumerate ALL values upfront** (per `feedback_planner_missed_status_enum_widening`):
```sql
-- All status values in ONE migration — never partial. Source: 37-RESEARCH Pitfall 6.
check (status in ('open', 'pending', 'resolved', 'closed', 'waiting_on_customer', 'spam'))
```

**Append-only audit pattern for `ticket_messages`** — analog: `supabase/migrations/20270702000004_phi_access_log.sql` lines 26-37:
```sql
-- ticket_messages: INSERT-only for authenticated (no UPDATE/DELETE for users)
-- Service-role UPDATE/DELETE EXPLICITLY REVOKED.
-- Only the SECDEF close-ticket RPC or agent-reply RPC owns writes.
revoke update, delete on public.ticket_messages from service_role;
```

**csat_responses shape** — analog: `supabase/migrations/20270704000020_quarterly_nps_responses.sql` (1-question rating pattern):
```sql
-- From: supabase/migrations/20270704000020_quarterly_nps_responses.sql lines 16-26
-- Closest shape to csat_responses: single score + comment + unique-per-context constraint
CREATE TABLE public.quarterly_nps_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score         int  NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment       text,
  responded_via text NOT NULL CHECK (responded_via IN ('email', 'in-app')),
  responded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quarterly_nps_responses_user_quarter_uniq UNIQUE (user_id, quarter)
);
-- csat_responses analog: replace 'quarter' with 'ticket_id'; replace score range with 1-5
```

**agent_macros table** — plain CRUD; no special pattern needed beyond org-scoped RLS. Use `org_subscriptions_table.sql` (lines 13-43) as shape reference for an org-owned simple table.

---

#### `supabase/migrations/YYYYMMDD_helpdesk_fts_index.sql` (kb_articles + kb_article_versions + tsvector GIN)

**Analog:** No exact analog in codebase — closest is Phase 38 content_embeddings schema (`supabase/migrations/20270705000002_phase38_content_embeddings.sql`). Use RESEARCH Pattern 3 directly.

**GENERATED ALWAYS AS STORED tsvector** (from 37-RESEARCH.md Pattern 3):
```sql
-- kb_articles — GENERATED columns are simpler than triggers (Postgres 12+)
ALTER TABLE kb_articles
  ADD COLUMN search_vector_en tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  ADD COLUMN search_vector_es tsvector GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(body_es, ''))
  ) STORED;

CREATE INDEX kb_articles_search_en_gin ON kb_articles USING GIN(search_vector_en);
CREATE INDEX kb_articles_search_es_gin ON kb_articles USING GIN(search_vector_es);
```

**Constraint:** Generated columns CANNOT reference other tables. The `search_vector_*` is on `kb_articles.body` (live version) only. Version search is not needed (per RESEARCH Pitfall 5).

---

#### `supabase/migrations/YYYYMMDD_helpdesk_pg_cron.sql` (SLA breach cron)

**Analog:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — exact match.

**Named dollar-quote pattern** (lines 55-107 of analog — load-bearing, DO NOT substitute bare `$$`):
```sql
-- From: supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql lines 29-47
-- Pre-flight unschedule block (idempotency):
do $unschedule$
declare job_name text;
begin
  for job_name in
    select jobname from cron.job where jobname in ('helpdesk-sla-breach-check')
  loop perform cron.unschedule(job_name); end loop;
exception when others then null;
end $unschedule$;

-- Named tags: outer $cron$, inner UNIQUE tag $sla$ — NEVER bare $$
-- Source: 20270705000030_phase38_pg_cron_schedules.sql lines 55-107
select cron.schedule(
  'helpdesk-sla-breach-check',
  '*/5 * * * *',
  $cron$
  do $sla$
  declare v_service_role_key text;
  begin
    select decrypted_secret into v_service_role_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if v_service_role_key is null then
      raise notice 'helpdesk-sla-breach-check: vault entry missing — skipping';
      return;
    end if;
    perform net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-sla-breach-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_role_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  end $sla$;
  $cron$
);
```

**CRITICAL constraints (from memory references):**
- NEVER use `current_setting('app.service_role_key')` — use `vault.decrypted_secrets` only (`reference_supabase_pg_cron_vault_service_role_pattern`)
- Migration filename: `<14-digits>_name.sql` strict (`reference_supabase_migration_filename_regex`)
- Bare inner `$$` silently closes outer `$cron$` → syntax error at DECLARE (`reference_postgres_dollar_quote_nesting_in_cron_body`)

---

### Domain 2: Edge Functions

---

#### `supabase/functions/helpdesk-inbound/index.ts` (Resend Inbound webhook + Svix sig + 2-step body fetch + HMAC reply-threading)

**Analog:** `supabase/functions/clinic-invite/index.ts` (multi-endpoint dispatcher, admin+user-scoped clients, CORS, rate-limit layer)

**Dispatcher structure** (lines 1-80 of analog):
```typescript
// From: supabase/functions/clinic-invite/index.ts lines 52-80
// Pattern: single Deno.serve dispatcher with URL pathname routing
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Two clients: admin (service-role) for auth lookups + user JWT for RLS-scoped writes
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Two-step Resend Inbound body fetch** (from 37-RESEARCH Pattern 1):
```typescript
// Step 1: Parse webhook metadata (body is metadata-only)
const rawBody = await req.text();
const event = JSON.parse(rawBody) as { type: string; data: { email_id: string; from: string; to: string[] } };
if (event.type !== 'email.received') return new Response('ignored', { status: 200 });

// Step 2: Fetch full email body via Resend API (NOT in webhook payload)
const emailRes = await fetch(`https://api.resend.com/emails/receiving/${event.data.email_id}`, {
  headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
});
const email = await emailRes.json();

// Idempotency check BEFORE any DB write (Svix retries on 5xx)
const { data: existing } = await supabase
  .from('ticket_inbound_events')
  .select('id').eq('resend_email_id', event.data.email_id).maybeSingle();
if (existing) return new Response(JSON.stringify({ duplicate: true }), { status: 200 });
```

**HMAC reply-token crypto** (from `_shared/realtime.ts` lines 34-58 — same crypto.subtle pattern):
```typescript
// From: supabase/functions/_shared/realtime.ts lines 34-58 (channelNameFromSecret)
// Helpdesk HMAC token uses same crypto.subtle.sign(HMAC-SHA256) pattern
const key = await crypto.subtle.importKey(
  'raw', bytes.buffer,
  { name: 'HMAC', hash: 'SHA-256' },
  false, ['sign'],
);
const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ticketId}:${userId}`));
// base64url-encode the signature — constant-time compare on verify
```

**Deno test file naming:** `index.test.ts` (NOT `index-test.ts`) per `reference_deno_test_discovery`. Env vars set with `Deno.env.set(...)` BEFORE first import per `clinic-invite/index.test.ts` convention.

---

#### `supabase/functions/helpdesk-ai-assist/index.ts` (Claude tagging + routing + sentiment)

**Analog:** `supabase/functions/_shared/anthropic-summarize.ts` — exact match for BAA scope chain ordering.

**BAA scope chain — CRITICAL ordering** (lines 98-151 of analog):
```typescript
// From: supabase/functions/_shared/anthropic-summarize.ts lines 98-151
// CRITICAL: baa.scope.resolved BEFORE anthropic.messages.create breadcrumb.
// Audit replay fails if reversed. Phase 25 HIPAA-01 audit signal.

// Step 1: resolve BAA scope (emits baa.scope.resolved breadcrumb)
const scope = await resolveBaaScope(supabase, agentUserId);

// Step 2: read model ID + assert scope (throws 403 on clinical-path miss)
const modelId = Deno.env.get('ANTHROPIC_MODEL_HELPDESK');
if (!modelId) throw new BaaScopeError('ANTHROPIC_MODEL_HELPDESK env unset');
assertBaaScope(scope, modelId);  // from _shared/baa-scope.ts

// Step 3: emit anthropic.messages.create breadcrumb (just before fetch)
addBreadcrumb({
  category: 'anthropic.messages.create',
  level: 'info',
  data: { model_id: modelId, is_clinical: scope.isClinical },
});

// Step 4: fetch /v1/messages with scope.credential (NOT raw env var)
const res = await fetch(`${baseUrl}/v1/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${scope.credential}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({ model: modelId, max_tokens: 1024, ... }),
});
```

**Structured output with Zod** (from `_shared/digest-schema.ts` pattern, line 35 of anthropic-summarize.ts):
```typescript
// Zod schema for AI tagging output (not raw string parsing)
import { z } from 'https://esm.sh/zod@3.23.8';
const tagClassificationSchema = z.object({
  tags: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })),
  routing_suggestion: z.string().nullable(),
  draft_reply: z.string().nullable(),
  sentiment_score: z.number().min(-1).max(1),
});
```

**Model ID format:** hyphenated (`claude-sonnet-4-6`, NOT `claude-sonnet-4.6`) per `reference_anthropic_model_id_hyphenated_format`. `claude-sonnet-4-6` is already in `BAA_COVERED_MODELS` — no allowlist update needed.

**PHI gate enforcement:** `helpdesk-ai-assist` MUST read `ticket.phi` from the DB BEFORE calling `resolveBaaScope`. No phi lookup = HIPAA violation. Plan-checker must verify.

---

#### `supabase/functions/_shared/email-router.ts` (extend — add `csat_followup`, `helpdesk_agent_reply`, `sla_breach_alert` templates)

**Analog:** `supabase/functions/_shared/email-router.ts` current file — extend in place.

**EmailTemplate union extension** (lines 44-58 of current file):
```typescript
// From: supabase/functions/_shared/email-router.ts lines 44-58
// ADD to EmailTemplate union (same-plan-as-Edge-Fn rule per feedback_planner_missed_status_enum_widening):
export type EmailTemplate =
  // ... existing members ...
  // Phase 37 helpdesk templates:
  | 'csat_followup'             // non-PHI → Resend (CSAT score link; no patient data in email body)
  | 'helpdesk_agent_reply'      // phi-aware → caller passes ticket.phi as the switch
  | 'sla_breach_alert';         // non-PHI → Resend (internal alert to agent on-call list)
```

**`subjectFor` and `renderTemplate` switches** must be widened in the same migration/commit. Do NOT add a template key without its subject line and render case — this causes the `default:` branch to silently return 'LeanShot Notification' instead of throwing.

**phi flag discipline** (lines 1-30 of current file):
```typescript
// SINGLE phi switch — caller is authoritative. From email-router.ts file header:
// phi=true  → SES (HIPAA BAA boundary). NO silent Resend fallback on SES failure.
// phi=false → Resend.
// The caller (helpdesk-csat-send, helpdesk-sla-breach-cron) reads ticket.phi and passes it.
// The router does NOT infer phi from the template name.
await sendEmail(supabase, {
  template: 'csat_followup',
  to: ticketOwnerEmail,
  vars: { ticket_ref: `#${ticketId.slice(0, 8)}`, csat_url: signedCsatUrl },
  phi: ticket.phi,  // authoritative switch
});
```

---

#### `supabase/functions/_shared/posthog-server.ts` (extend — add helpdesk events to Phase38Event union)

**Analog:** `supabase/functions/_shared/posthog-server.ts` lines 214-254 — exact pattern for union extension.

**Phase38Event union extension** (lines 214-254 of current file):
```typescript
// From: supabase/functions/_shared/posthog-server.ts lines 214-254
// SAME-PLAN-AS-EDGE-FN RULE (feedback_planner_missed_status_enum_widening):
// helpdesk events MUST ship in the same plan as the Edge Fn that fires them.
// Add to Phase38Event union:
export type Phase38Event =
  // ... existing members ...
  // Phase 37 helpdesk events ───────────────────────────────────────────────
  | 'helpdesk.ticket.created'
  | 'helpdesk.ticket.assigned'
  | 'helpdesk.ticket.replied'
  | 'helpdesk.ticket.closed'
  | 'helpdesk.ticket.reopened'
  | 'helpdesk.kb_article.viewed'
  | 'helpdesk.kb_search.performed'
  | 'helpdesk.csat.submitted'
  | 'helpdesk.sentiment_alert.fired'
  | 'helpdesk.inbound_email.received'
  | 'helpdesk.inbound_email.unknown_sender';
```

**Same-plan rule:** The plan that ships `helpdesk-inbound/index.ts` ALSO extends `Phase38Event` in the same commit. The plan that ships `helpdesk-ai-assist/index.ts` extends for `sentiment_alert.fired`. Do not defer union extensions — `captureServer(event: Phase38Event)` will TypeScript-error on unregistered event names.

---

### Domain 3: Frontend Components

---

#### `leanshot/src/helpdesk/HelpdeskWidget.tsx` (lazy chunk root; auth-aware branching)

**Analog:** `leanshot/src/App.tsx` (lazy boundary declaration) + `leanshot/src/components/ui/Sheet.tsx` (bottom-sheet primitive)

**Lazy chunk declaration pattern** (App.tsx lines 135-150):
```typescript
// From: leanshot/src/App.tsx lines 135-139 (WhatsNewDrawerHost pattern)
// Widget must be declared at module level (not inside a component) to preserve
// React's identity across renders.
const HelpdeskWidget = lazy(() =>
  import(/* webpackChunkName: "helpdesk-widget" */ '@/helpdesk/HelpdeskWidget').then((m) => ({
    default: m.HelpdeskWidget,
  }))
);
// Mounted in App.tsx inside a <Suspense fallback={null}> BELOW the main view.
// The suspense fallback is null — widget UI handles its own loading state.
```

**Bundle ceiling:** 25 kB gz for `helpdesk-widget` chunk (Phase 24 D-16..20). Widget, KB search, ticket form, reply composer, macro typeahead, and typing indicator all share this chunk. AI side-pane (suggestions display) MAY be a sub-chunk `helpdesk-agent-pane` if build measurement exceeds the ceiling. Planner assigns the split point.

**PHI route gate** (from `leanshot/src/lib/posthog-route-disable.ts` lines 40-66):
```typescript
// From: leanshot/src/lib/posthog-route-disable.ts line 40
// Existing PHI_URL_REGEX governs widget hide-or-PHI-mode decision (D-17).
// Planner picks: same regex → widget hidden OR widget in KB-only mode.
export const PHI_URL_REGEX = /^\/(clinic|patient|admin\/users|dose-log|share|auth)(\/|$)/i;

// Recommended: widget renders in KB-only mode on PHI routes (cleaner UX — users still need help).
// Auth-aware branching in HelpdeskWidget.tsx:
//   if (isPhiRoute) return <KBOnlyMode />;  // no ticket form, no AI side-pane
//   return <FullWidget />;
```

**Sheet primitive for widget overlay** (`leanshot/src/components/ui/Sheet.tsx` lines 19-82):
```typescript
// From: leanshot/src/components/ui/Sheet.tsx
// Required aria: role="dialog" aria-modal="true" (lines 45-48)
// Required: framer-motion AnimatePresence + useReducedMotion() check
// Required: ESC key close handler (lines 24-26)
// Drag-to-dismiss via useDragControls() (lines 20, 53-57)
export function Sheet({ open, onClose, title, children }: SheetProps) { ... }
```

---

#### `leanshot/src/helpdesk/KBArticleView.tsx` (react-markdown + dompurify)

**Analog:** `leanshot/src/components/changelog/WhatsNewDrawer.tsx` (react-markdown + dompurify + rehype-raw — confirmed in package.json)

**Imports pattern** (from package.json confirmed stack):
```typescript
// react-markdown@9.0.0, dompurify@3.2.0, rehype-raw@7.0.0 — all in package.json
// remark-gfm@4.0.1 — NEW install required before this plan
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';

// Sanitize BEFORE passing to ReactMarkdown — XSS trust boundary
const sanitized = DOMPurify.sanitize(article.body, { USE_PROFILES: { html: true } });
return (
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
    {sanitized}
  </ReactMarkdown>
);
```

---

#### `leanshot/src/helpdesk/TypingIndicator.tsx` (Realtime broadcast)

**Analog:** `leanshot/src/lib/clinic-realtime.ts` (Phase 9 Plan 09-02) — setAuth-before-subscribe invariant.

**setAuth-before-subscribe** (lines 1-10 of clinic-realtime.ts docstring, pattern enforced throughout):
```typescript
// From: leanshot/src/lib/clinic-realtime.ts (Phase 9 Plan 09-02)
// INVARIANT: setAuth() BEFORE subscribe() or private channels get CHANNEL_ERROR forever.

const channel = supabase.channel(`ticket:${ticketId}`, {
  config: { broadcast: { self: false } },
});

// Broadcast typing (500ms throttle — planner sets final value)
channel.send({ type: 'broadcast', event: 'typing', payload: { userId, isTyping: true } });

// Receive typing
channel.on('broadcast', { event: 'typing' }, (payload) => { /* update state */ });

// postgres_changes for live messages
channel.on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'ticket_messages',
  filter: `ticket_id=eq.${ticketId}`,
}, (payload) => { setMessages(prev => [...prev, payload.new]); });

// CRITICAL — must come before subscribe()
await supabase.realtime.setAuth();
channel.subscribe();
```

**Channel name format:** `ticket:<uuid>` (NOT the org-HMAC pattern from Phase 28/29 — ticket channels are user-owned). The org-HMAC pattern in `_shared/realtime.ts` is for org-broadcast channels; ticket channels are per-ticket-id plain strings.

---

#### `leanshot/src/helpdesk/MacroTypeahead.tsx` (Fuse.js + cmdk slash-command)

**Analog:** `cmdk` already in `package.json` (line from confirmed stack). `fuse.js@7.3.0` is a NEW install.

**cmdk usage reference** — no existing full analog; closest is Phase 38 HITL queue filter pills pattern (`HitlQueuePage.tsx` lines 38-50) for the filter/select pattern. `cmdk` command palette wraps `fuse.js` results.

**Installation guard** (per RESEARCH A6):
```bash
# Verify before install — may already be present from a parallel phase
grep fuse leanshot/package.json
cd leanshot && npm install remark-gfm fuse.js  # only if not already present
```

---

### Domain 4: Admin Module

---

#### `leanshot/src/lib/admin/modules.ts` (modify line 182 — replace placeholder)

**Exact edit** (lines 181-189 of current file, confirmed in codebase):
```typescript
// FROM (current at line 182):
{
  key: 'helpdesk',
  label: 'Helpdesk',
  route: 'helpdesk',
  icon: LifeBuoyIcon,
  lazy: placeholderFor('Phase 36+ (Helpdesk ticket inbox)'),
  flagKey: 'admin.helpdesk.enabled',
  minRole: 'staff' as AdminRole,
},

// TO (Phase 37 replacement — same key, same flagKey, same minRole):
{
  key: 'helpdesk',
  label: 'Helpdesk',
  route: 'helpdesk',
  icon: LifeBuoyIcon,
  lazy: () => import('@/admin/modules/helpdesk').then((m) => ({ default: m.HelpdeskLayout })),
  flagKey: 'admin.helpdesk.enabled',
  minRole: 'staff' as AdminRole,
},
```

**Sub-route catch-all** (per `feedback_admin_module_manifest_vs_router_branch_drift`): Admin shell router must match `/admin/helpdesk` as a PREFIX branch, not exact match. Sub-pages (`/admin/helpdesk/kb`, `/admin/helpdesk/trends`, etc.) are handled inside `HelpdeskLayout` via internal navigation state — same as `RagLayout.tsx`.

---

#### `leanshot/src/admin/modules/helpdesk/HelpdeskLayout.tsx` (and 7 sub-pages)

**Analog:** `leanshot/src/components/admin/rag/RagLayout.tsx` — exact structural match (multi-page admin module with sub-nav).

**Sub-nav + lazy sub-route pattern** (RagLayout.tsx lines 161-235):
```typescript
// From: leanshot/src/components/admin/rag/RagLayout.tsx lines 161-235
// SUB_ROUTES array drives both the nav and the content area render.
const SUB_ROUTES = [
  { key: 'inbox',    label: 'Inbox',         path: 'inbox',    Component: HelpdeskInboxPage },
  { key: 'kb',       label: 'Knowledge Base', path: 'kb',       Component: KBEditorPage },
  { key: 'macros',   label: 'Macros',         path: 'macros',   Component: MacroEditorPage },
  { key: 'routing',  label: 'Routing Rules',  path: 'routing',  Component: RoutingRulesPage },
  { key: 'sla',      label: 'SLA Targets',    path: 'sla',      Component: SLATargetsPage },
  { key: 'sentiment',label: 'Sentiment Queue',path: 'sentiment',Component: SentimentQueuePage },
  { key: 'trends',   label: 'Trends',         path: 'trends',   Component: TrendsDashboardPage },
] as const;

// resolveActive: matches /admin/helpdesk/inbox, /admin/helpdesk/kb, etc.
function resolveActive(pathname: string): SubRoute {
  const m = pathname.match(/^\/admin\/helpdesk\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  return SUB_ROUTES.find(r => r.path === seg) ?? SUB_ROUTES[0]!;
}

// Layout: 2-col grid (nav left, content right) — exact same Tailwind classes as RagLayout
return (
  <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
    <nav aria-label="Helpdesk sections">...</nav>
    <main className="max-w-screen-xl">
      <Suspense fallback={<div className="p-6 text-sm ...">Loading…</div>}>
        <Active />
      </Suspense>
    </main>
  </div>
);
```

**Module barrel export pattern** (from `leanshot/src/admin/modules/hitl-queue/index.ts`):
```typescript
// From: leanshot/src/admin/modules/hitl-queue/index.ts
// index.ts exports the root layout AND a manifest-entry object (for documentation)
export { default as HelpdeskLayout } from './HelpdeskLayout';
// Sub-pages are imported inside HelpdeskLayout.tsx via React.lazy — not in the barrel
```

**TrendsDashboardPage + Chart.js** — analog: `leanshot/src/components/admin/cohorts/CACDashboardPage.tsx` (Phase 33 Chart.js pattern). Chart.js is already registered globally via `src/components/dashboard/charts/BaseChart.tsx`.

---

### Domain 5: PHI Audit Call Sites

---

#### `log_phi_access` RPC call in agent ticket-open UI

**Analog:** `leanshot/src/lib/hipaa/phi-access-rpc.ts` (lines 1-60) — exact reuse, fire-and-forget.

**Call site pattern** (phi-access-rpc.ts lines 44-60):
```typescript
// From: leanshot/src/lib/hipaa/phi-access-rpc.ts lines 44-60
// Fire-and-forget — DO NOT await (must not block UI render per D-05)
void logPhiAccess({
  accessedUserId: ticket.user_id,
  accessedFields: ['ticket.body', 'ticket_messages'],
  reason: 'agent-inbox-open',
  accessedOrgId: ticket.org_id,
});
```

**Where to call:** In `TicketDetailPage.tsx` on mount (useEffect), when `ticket.phi === true`. Not on every re-render — use a ref to deduplicate (same pattern as `RouteOrgGuard.tsx` lines 55-73).

**Ref deduplication** (from `leanshot/src/components/clinic/RouteOrgGuard.tsx` lines 55-73):
```typescript
// From: leanshot/src/components/clinic/RouteOrgGuard.tsx lines 55-73
const lastLoggedRef = useRef<string>('');
useEffect(() => {
  if (!ticket.phi) return;
  const logKey = `${ticket.id}:${agentUserId}`;
  if (lastLoggedRef.current === logKey) return;
  lastLoggedRef.current = logKey;
  void logPhiAccess({ ... });
}, [ticket.id, agentUserId, ticket.phi]);
```

---

### Domain 6: Tests

---

#### `leanshot/src/test/rls-helpdesk-tickets.test.ts` (RLS impersonation matrix)

**Analog:** `leanshot/src/lib/rag/__tests__/rls-matrix.test.ts` — exact structural match.

**Test file header pattern** (rls-matrix.test.ts lines 1-55):
```typescript
// From: leanshot/src/lib/rag/__tests__/rls-matrix.test.ts lines 1-55
// FILE-SCOPED slug prefix (per feedback_rls_per_file_slug_prefix — prevents cleanup collision)
const TEST_SLUG_PREFIX = `p37-rls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Live-DB skip guard — test auto-skips when service-role key absent
const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Admin client (service-role) for fixture creation
function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// User client (JWT via admin.generateLink + /auth/v1/verify per reference_rls_fixture_gotrueclient_flake)
// Do NOT use signInWithPassword — ES256 cross-contamination under vitest
function buildUserClient(accessToken: string, storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
```

**Cross-tenant impersonation proof** (per `reference_supabase_project.md` rule):
Every RLS surface needs a live cross-tenant impersonation proof test:
- User A cannot SELECT tickets where `user_id = User B`
- Agent from Org A cannot SELECT tickets where `org_id = Org B`
- PHI ticket agent-open fires `log_phi_access` (verify row appears in `phi_access_log`)

---

#### `leanshot/src/admin/modules/helpdesk/HelpdeskInboxPage.test.tsx` (RTL unit test)

**Analog:** `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx` (lines 1-40) — exact structural match.

**Chainable supabase mock pattern** (HitlQueuePage.test.tsx lines 24-40):
```typescript
// From: leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx lines 24-40
// Chainable mock — avoids per-test vi.mock() overhead
// Use vi.doMock BEFORE dynamic import of the component under test
vi.doMock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
// Then dynamically import the component AFTER mock is registered:
const { HelpdeskInboxPage } = await import('@/admin/modules/helpdesk/HelpdeskInboxPage');
```

**Deno Edge Fn tests** — `index.test.ts` naming (NOT `index-test.ts`) per `reference_deno_test_discovery`. Env vars set with `Deno.env.set(...)` before any module import per `clinic-invite/index.test.ts` convention.

---

## Shared Patterns

### PHI flag end-to-end (HIPAA-critical — applies to ALL email sends + ALL Claude calls)

**Source:** `supabase/functions/_shared/email-router.ts` (lines 1-30, 60-73) + `supabase/functions/_shared/baa-scope.ts` (lines 67-112)
**Apply to:** `helpdesk-inbound`, `helpdesk-ai-assist`, `helpdesk-csat-send`, `helpdesk-sla-breach-cron`

```typescript
// Caller is ALWAYS authoritative on phi flag — router does NOT infer it.
// phi=true → SES (NO silent Resend fallback on SES failure).
// phi=true → BAA credential for Claude calls.
// Read ticket.phi from DB; pass it through to every outbound call.
```

### BAA Scope Chain (Phase 25 HIPAA-01 audit signal)

**Source:** `supabase/functions/_shared/baa-scope.ts` (lines 67-133) + `supabase/functions/_shared/anthropic-summarize.ts` (lines 98-151)
**Apply to:** `helpdesk-ai-assist` ONLY

Order is load-bearing: `resolveBaaScope` → `assertBaaScope` → `addBreadcrumb('anthropic.messages.create')` → `fetch(/v1/messages)`. Out-of-order = audit failure.

### React.lazy + Suspense (widget chunk isolation)

**Source:** `leanshot/src/App.tsx` lines 79-150 (multiple lazy patterns)
**Apply to:** `HelpdeskWidget.tsx` root mount + any AI side-pane sub-chunk

```typescript
// Module-level lazy declaration (NEVER inside a component function)
const HelpdeskWidget = lazy(() => import('@/helpdesk/HelpdeskWidget').then(m => ({ default: m.HelpdeskWidget })));
// In App.tsx render: <Suspense fallback={null}><HelpdeskWidget /></Suspense>
```

### Admin sub-nav layout (multi-page admin module)

**Source:** `leanshot/src/components/admin/rag/RagLayout.tsx` (lines 127-235)
**Apply to:** `HelpdeskLayout.tsx` + all 7 sub-page components

Pattern: `SUB_ROUTES` const array → `resolveActive(pathname)` regex → `<Active />` inside `<Suspense>`. Use `window.addEventListener('popstate', ...)` for back/forward support. Link hrefs use plain `<a href="/admin/helpdesk/{path}">` (no router).

### File-scoped RLS test prefix

**Source:** `leanshot/src/lib/rag/__tests__/rls-matrix.test.ts` line 35
**Apply to:** `rls-helpdesk-tickets.test.ts`

```typescript
const TEST_SLUG_PREFIX = `p37-rls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
```

Never use a shared global prefix across test files — vitest parallelism causes afterAll cleanup collisions.

### log_phi_access fire-and-forget

**Source:** `leanshot/src/lib/hipaa/phi-access-rpc.ts` (lines 44-60)
**Apply to:** `TicketDetailPage.tsx` (agent ticket-open when `ticket.phi === true`)

Always `void logPhiAccess(...)` — never `await`. Errors logged via `console.warn(error.code)` only (T-25-02-S3: never log `error.message`).

### Named dollar-quote migration pattern

**Source:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` lines 55-107
**Apply to:** `YYYYMMDD_helpdesk_pg_cron.sql` ONLY

Outer `$cron$`, inner unique tag `$sla$`. Never bare `$$` inside `cron.schedule(...)`.

---

## Flagged Items

### 1. Admin manifest `helpdesk` placeholder — CONFIRMED EXISTS

File: `leanshot/src/lib/admin/modules.ts` **line 182**

```typescript
// VERIFIED in codebase:
{
  key: 'helpdesk',
  label: 'Helpdesk',
  route: 'helpdesk',
  icon: LifeBuoyIcon,
  lazy: placeholderFor('Phase 36+ (Helpdesk ticket inbox)'),
  flagKey: 'admin.helpdesk.enabled',
  minRole: 'staff' as AdminRole,
},
```

Phase 37 replaces `placeholderFor(...)` with `() => import('@/admin/modules/helpdesk').then(m => ({ default: m.HelpdeskLayout }))`. The `key`, `flagKey`, and `minRole` stay unchanged. The plan that makes this change also wires the admin sub-router prefix-match branch.

### 2. Phase38Event union extension — required in same plan as Edge Functions

File: `supabase/functions/_shared/posthog-server.ts` lines 214-254

The `Phase38Event` union (verified at line 214 in codebase) must be extended with helpdesk events in the SAME plan (same commit) as the Edge Function that fires each event. Splitting to a follow-up plan will cause TypeScript errors in the Edge Fn at compile time.

Events to add per plan:
- Plan that ships `helpdesk-inbound`: `helpdesk.ticket.created`, `helpdesk.inbound_email.received`, `helpdesk.inbound_email.unknown_sender`
- Plan that ships `helpdesk-ai-assist`: `helpdesk.sentiment_alert.fired`, `helpdesk.ticket.assigned`
- Plan that ships `helpdesk-csat-send`: `helpdesk.csat.submitted`
- Plan that ships the widget: `helpdesk.kb_article.viewed`, `helpdesk.kb_search.performed`
- Plan that ships ticket close: `helpdesk.ticket.closed`, `helpdesk.ticket.reopened`, `helpdesk.ticket.replied`

Client-side events (`kb_article.viewed`, `kb_search.performed`, `ticket.created` from widget) also need entries in `leanshot/src/lib/analytics/events.ts` — extend the same-plan rule applies there too.

### 3. ClamAV blocker — confirm deferred, use deferred-items.md pattern

**Recommendation:** Defer ClamAV inline scan to v1.4. Use the established `deferred-items.md` pattern (file exists at `leanshot/.planning/phases/28-clinic-organizations-schema-rls-hardening/deferred-items.md` and `leanshot/.planning/phases/42-v1-3-polish-closeout/deferred-items.md`).

Write `leanshot/.planning/phases/37-m6-helpdesk-core/deferred-items.md` with:
- **Item:** ClamAV attachment scanning for `helpdesk-inbound`
- **Severity:** P0 (unscanned attachments are stored in private Supabase Storage bucket — RLS prevents public access but content is not virus-scanned)
- **Reason:** Supabase Edge Function sandbox has no `clamd` TCP socket sidecar; `npm:pompelmi`/`npm:clamav-client` require a running clamd daemon
- **Workaround in v1.3:** File type allowlist (MIME type check) + 10 MB cap + private bucket RLS as partial mitigation. Document in CONTEXT specifics.
- **v1.4 path:** Either (a) Fly.io ClamAV microservice with HTTP endpoint callable from Edge Fn, or (b) vendor-gated health-check that enables scanning when external clamd URL is set in Function Secrets

The `deferred-items.md` does NOT block Phase 37 execution — it is a living document created at phase-open. The plan that ships `helpdesk-inbound` should include a `// TODO [DEFERRED v1.4]: ClamAV scan` comment at the attachment processing step.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| ClamAV scan in `helpdesk-inbound/index.ts` | — | — | No virus scanning of any kind exists in the codebase; `clamd` TCP socket is unavailable in Edge Fn sandbox; deferred to v1.4 |
| `kb_articles` + `kb_article_versions` tsvector GIN schema | migration | transform | No FTS tables exist yet; Phase 38 content_embeddings uses pgvector not tsvector; use RESEARCH Pattern 3 directly |

---

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `leanshot/src/`, `leanshot/src/lib/`, `leanshot/src/components/admin/`
**Files scanned:** 34
**Pattern extraction date:** 2026-05-21
