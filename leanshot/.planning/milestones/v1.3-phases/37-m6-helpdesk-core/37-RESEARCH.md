# Phase 37: M6 Helpdesk Core — Research

**Researched:** 2026-05-21
**Domain:** Full-stack helpdesk: Supabase schema + RLS, Edge Functions, Resend Inbound webhook, Claude AI assist, Postgres FTS, Supabase Realtime, in-app widget
**Confidence:** HIGH (codebase-verified anchors) / MEDIUM (Resend Inbound payload details)

---

## Summary

Phase 37 ships the complete M6 helpdesk stack for LeanShot. The architecture is an 8-table Postgres schema with two-axis RLS (user_id + org_id), four Edge Functions (inbound webhook receiver, AI assist, CSAT send, SLA breach cron), an in-app React widget lazy-loaded as a ≤25 kB gz chunk, and a full admin module replacing the existing `admin.helpdesk` placeholder. The phase reuses Phase 25's HIPAA controls verbatim: `_shared/email-router.ts` for phi-aware SES/Resend routing, `_shared/anthropic-baa-allowlist.ts` + `_shared/baa-scope.ts` for Claude AI assist on PHI tickets, and the `log_phi_access` SECURITY DEFINER RPC for audit trails.

The load-bearing engineering items are: (1) Resend Inbound webhook with two-step content retrieval (webhook delivers metadata only; body + attachments fetched via API), (2) HMAC reply-threading tokens stored in Supabase vault, (3) Postgres `tsvector` + GIN for multilingual KB search with trigger-maintained index, (4) pg_cron SLA breach detection using the named dollar-quote tag pattern already established in Phases 38 and 42, and (5) ClamAV scanning for inbound email attachments — whose Deno Edge Function compatibility is partially uncertain and may be deferred.

**Primary recommendation:** Implement `helpdesk-inbound` Edge Function as the most complex load-bearing unit first; all other work depends on the ticket row being reliably created. Follow Phase 38's `anthropic-summarize.ts` baa-scope pattern exactly for `helpdesk-ai-assist`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**PHI Routing (HIPAA-critical — inherits P25 D-03)**
- D-01: Clinician-actor → phi=true; patient-actor → phi=false. `tickets.phi boolean default false`. Set to true at ticket-create time via `surfaceCheck()` resolution.
- D-02: `ticket.phi` carries end-to-end. `_shared/email-router.ts` honors the flag for CSAT, reply notifications, agent reply-send, breach alerts. PHI=true → SES. PHI=false → Resend.
- D-03: Claude AI assist on phi=true tickets uses `_shared/anthropic-baa-allowlist.ts` guard. ai=false tickets use consumer credential. Refusal path tested per P25 SC#1 corpus.
- D-04: Ticket attachments inherit `ticket.phi`. RLS predicate includes phi flag. `org_id` RLS axis prevents cross-clinic leak.
- D-05: Audit-log every PHI ticket access by clinician via `log_phi_access` SECURITY DEFINER RPC (P25 Plan 25-02).

**AI Assist Scope + Auto-Action Policy**
- D-06: Auto-tag + auto-route on ticket create. Claude classifies on `ticket_messages` insert. Tags at ≥0.75 confidence.
- D-07: Below 0.75 — suggestion only. Confidence score visible in agent side-pane.
- D-08: Draft replies ALWAYS require agent send. No auto-send in v1.3.
- D-09: Macro suggestion when Claude tag confidence ≥0.75 — top 3 macros for one-click insert.
- D-10: Sentiment-alert at ≤-0.6 negative score OR 3 messages ≤-0.3 in a single ticket.
- D-11: Thresholds hardcoded in v1.3 (0.75 / -0.6). No admin UI.
- D-12: NO PII scrub-before-Claude. BAA-allowlist credential handles PHI directly.

**Widget Surface + KB-First UX**
- D-13: Widget on every authenticated screen + marketing pages. Auth-aware branching.
- D-14: KB-first typeahead. "Still need help? Create a ticket" from second 1.
- D-15: Anonymous = email `support@` ONLY; no in-widget anon ticket form.
- D-16: Widget lazy-loaded, ≤25 kB gz (Phase 24 D-18..20 ceiling).
- D-17: Widget hidden or PHI-mode on PHI-sensitive screens — planner picks pattern from Phase 25 HIPAA-17 route regex.

**Inbound Email + Reply-Threading**
- D-18: `support@app.leanshot.app` for new tickets; `reply+<HMAC>@app.leanshot.app` for replies. Resend Inbound at existing `app.leanshot.app` MX.
- D-19: Per-ticket non-expiring HMAC: `base64url(hmac_sha256(secret, "${ticket_id}:${user_id}"))`. Secret in Supabase vault.
- D-20: Attachments ≤10 MB each, ClamAV-scanned in Edge Fn, stored in `ticket-attachments` Supabase storage. Max 10 per inbound email.
- D-21: Known email → ticket under user_id. Unknown email → auto-reply signup CTA, no ticket created.
- D-22: HMAC verification fail → bounce with auto-reply, NOT silent drop.

### Claude's Discretion
- SLA tiers (planner picks P1=4h/24h, P2=24h/72h, P3=72h/7d initial values) + breach-alert channel.
- KB authoring UX (CodeMirror 6 with markdown mode + side-by-side preview recommended).
- Realtime UX: debounce/throttle values for typing indicators.
- Macro slash-command UX: fuzzy-match library, sort order.
- Per-tag-cluster trend dashboard: planner picks chart (likely Chart.js per Phase 33 pattern).
- Admin routing rules editor: if/then condition builder shape.

### Deferred Ideas (OUT OF SCOPE)
- AI auto-SEND for high-confidence routine tickets (explicit HELP-04 prohibition).
- Admin sentiment-threshold UI (v1.4).
- Mobile native helpdesk (v1.4).
- Voice / phone channel.
- Typesense / Meilisearch (v1.5+).
- Spanish KB content (waits on Phase 32 CARRY-OVER).
- Macro-version-history UI (v1.4).
- Per-clinic / per-org widget branding (v1.4).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HELP-01 | 8-table schema with RLS isolating user-side from agent-side | Two-axis RLS pattern (user_id + org_id) established in Phase 28; `ticket.phi` flag maps directly to D-01..D-04 |
| HELP-02 | In-app widget on every screen (KB search → ticket form fallback) | `sync-defer.ts` lazy-load pattern; Phase 24 D-16..20 25 kB gz ceiling confirmed |
| HELP-03 | Email-to-ticket via Resend Inbound webhook + HMAC reply-threading | Resend Inbound: webhook delivers metadata only; body fetched via `resend.emails.receiving.get(email_id)`. Svix-based signature verification. HMAC pattern per D-19 |
| HELP-04 | AI assist: draft replies + auto-tag + auto-route; agent always sends | `anthropic-summarize.ts` pattern reused; `assertBaaScope` + BAA breadcrumb ordering required |
| HELP-05 | CSAT auto-sent after ticket close via Resend/SES | `sendEmail()` in `email-router.ts` already handles phi flag; new `csat` template needed |
| HELP-06 | SLA breach alerts via pg_cron | Named dollar-quote pattern established in Phases 38 + 42 migrations |
| HELP-07 | KB articles: markdown + react-markdown + dompurify + versioning | `react-markdown@9.0.0` + `dompurify@3.2.0` already in package.json |
| HELP-08 | KB articles Spanish locale (`locale='es'` column) | Postgres multilingual tsvector: separate `search_vector_en` + `search_vector_es` columns with language-specific GIN |
| HELP-09 | Realtime for typing indicator + live message arrival | Phase 9 `clinic-realtime.ts` pattern; `setAuth`-before-subscribe invariant confirmed |
| HELP-10 | Macros / canned responses via `/macro` slash command | Fuse.js fuzzy-match (already at v7.3 in registry); cmdk already in package.json |
| HELP-11 | KB FTS via tsvector + GIN (EN + ES dictionaries) | Trigger-maintained search_vector columns; `ts_rank_cd` for ranking |
| HELP-12 | Admin routing rules, macro editor, SLA targets, sentiment thresholds | Admin manifest already has `helpdesk` placeholder at line 182; needs real lazy import wired |
| HELP-13 | Per-tag-cluster trend dashboard | Chart.js already in stack; reuses Phase 33 pattern |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ticket + message CRUD | Database / Storage (RLS) | API (Edge Fn) | Schema owns the record; Edge Fn validates HMAC / AI before insert |
| Inbound email → ticket | API (Edge Fn: `helpdesk-inbound`) | Database | Resend Inbound posts webhook → Edge Fn fetches body → inserts row |
| HMAC reply-token generation | Database (SECURITY DEFINER RPC) | — | Token tied to ticket_id + user_id; must compute server-side to protect vault secret |
| AI tagging + routing | API (Edge Fn: `helpdesk-ai-assist`) | Database (routing rules table) | Claude call from Edge Fn; rules table drives agent assignment |
| KB full-text search | Database / Storage (tsvector + GIN) | API (RPC or direct SDK query) | Postgres FTS handles ranking natively; no search service needed at v1.3 scale |
| KB article rendering | Browser / Client | — | react-markdown + dompurify runs client-side; no SSR |
| In-app helpdesk widget | Browser / Client | Frontend Server (lazy chunk) | 25 kB gz chunk fetched on widget open via `sync-defer` |
| CSAT delivery | API (Edge Fn: `helpdesk-csat-send`) | — | Reuses `email-router.ts`; phi-aware routing |
| SLA breach detection | Database (pg_cron + SECURITY DEFINER) | API (Edge Fn alarm sender) | Cron fires every 5 min; calls Edge Fn to send alert emails |
| Realtime typing + messages | Browser / Client | Database (Supabase Realtime broadcast) | Broadcast channel per ticket_id; no DB writes for typing events |
| Attachment virus scan | API (Edge Fn: `helpdesk-inbound`) | — | ClamAV scan before Supabase Storage upload; scan in the inbound handler |
| PHI audit logging | Database (SECURITY DEFINER: `log_phi_access`) | — | Phase 25 Plan 25-02 RPC called by every agent ticket-open |
| Admin helpdesk module | Browser / Client (admin shell) | — | Replaces existing `helpdesk` placeholder in `src/lib/admin/modules.ts` L182 |

---

## Standard Stack

### Core (all items already in repo unless noted)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-markdown` | 9.0.0 (VERIFIED: package.json) | KB article markdown rendering | Locked in package.json; used in Phase 41 + COMMUNITY-01 |
| `dompurify` | 3.2.0 (VERIFIED: package.json) | HTML sanitization before render | Locked in package.json; Phase 25 HIPAA dependency |
| `rehype-raw` | 7.0.0 (VERIFIED: package.json) | Allow raw HTML in markdown (embeds) | Already present for Phase 41 EMBED-06 |
| `remark-gfm` | 4.0.1 (VERIFIED: npm registry) | GitHub-Flavored Markdown (tables, strikethrough) | Standard GFM extension; needed for KB articles |
| `fuse.js` | 7.3.0 (VERIFIED: npm registry) | Macro `/` slash-command fuzzy search | Lightweight, no deps, already used in project patterns |
| `cmdk` | 1.1.1 (VERIFIED: package.json) | Command palette component for macro typeahead | Already in package.json |
| `chart.js` | ^4.4.6 (VERIFIED: package.json) | Per-tag-cluster trend dashboard | Phase 33 CAC dashboard reuses; already registered |
| `@supabase/supabase-js` | ^2.105.4 (VERIFIED: package.json) | Realtime channels, storage, RLS queries | Project-wide; no alternative |
| `zod` | via esm.sh in Edge Fns | Structured output validation for AI assist | Phase 38 pattern established in `digest-schema.ts` |

### New packages required (not yet in repo)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `remark-gfm` | 4.0.1 | GFM tables/strikethrough in KB articles | Add to package.json; used in react-markdown `<ReactMarkdown remarkPlugins={[remarkGfm]}>` |
| `fuse.js` | 7.3.0 | Macro slash-command fuzzy-match | Widget + agent reply composer |

**Note:** `remark-gfm` and `fuse.js` are the only net-new frontend packages. Both are small and within bundle budget.

**Installation:**
```bash
cd leanshot && npm install remark-gfm fuse.js
```

**Version verification:**
```bash
npm view remark-gfm version  # 4.0.1 verified 2026-05-21
npm view fuse.js version      # 7.3.0 verified 2026-05-21
```

### ClamAV for Edge Functions

ClamAV integration in Deno Edge Functions is a moderate risk item. `npm:pompelmi` is the current ESM-compatible library and claims Deno support (`import { scan } from 'npm:pompelmi'`), but requires a running `clamd` TCP socket — which does not exist in Supabase Edge Function runtime (no sidecar processes). [ASSUMED: pompelmi or clamav-client cannot establish a TCP socket to clamd in the Supabase Edge Function sandbox without external ClamAV infrastructure.] The CONTEXT already flags this as a potential deferral candidate (D-20 specifics section). **Planner decision required:** either (a) provision external ClamAV service (e.g., a Fly.io sidecar) and call it via HTTP from the Edge Fn, (b) use a file-hash blocklist approach (simpler, lower fidelity), or (c) defer ClamAV scan to v1.4 and add a `deferred-items.md` P0 entry noting unscanned attachments. Option (c) matches the pattern from CONTEXT "if friction, consider deferring scan to a v1.4 polish."

---

## Architecture Patterns

### System Architecture Diagram

```
[User Browser]
     │ opens widget
     ▼
[helpdesk-widget chunk] ─── lazy via sync-defer ──────────────────┐
     │ KB typeahead query                                           │
     │                                                             │
     ▼                                                             ▼
[Supabase: kb_articles + tsvector GIN]        [Supabase: tickets + ticket_messages]
     │ ts_rank_cd results                            │ INSERT ticket (phi resolved)
     │                                               │
     ▼                                               ▼
[User reads KB article]        [helpdesk-ai-assist Edge Fn] ─→ [Claude via BAA gate]
                                       │ tags, route, sentiment
                                       ▼
                               [tickets: auto-tag applied]
                               [ticket_messages: draft stored]
                                       │
                                       ▼
                               [Supabase Realtime broadcast]
                                       │
                                       ▼
                               [Agent browser: live message + suggested draft]
                                       │ agent edits + sends
                                       ▼
                               [email-router.ts] ─── phi=true → SES
                                                 └── phi=false → Resend
                                                         │
                                                         ▼
                               [ticket closed → helpdesk-csat-send]


[Resend Inbound MX: support@app / reply+HMAC@app]
     │ POST email.received webhook (metadata only)
     ▼
[helpdesk-inbound Edge Fn]
     │ 1. Svix verify signature
     │ 2. Fetch body via resend.emails.receiving.get(email_id)
     │ 3. Verify HMAC for reply+* addresses
     │ 4. Known email? → INSERT ticket/message
     │    Unknown email? → auto-reply signup CTA
     │ 5. Fetch attachments via Resend API → ClamAV (if available) → Storage
     ▼
[Supabase: ticket row + ticket_message row + ticket_attachments]
     │
     ▼
[helpdesk-ai-assist invoked inline or via pg_net]


[pg_cron: every 5 min]
     │ SLA breach check SQL
     ▼
[helpdesk-sla-breach-cron Edge Fn]
     │ email-router.ts breach alert
     ▼
[Agent + on-call email]
```

### Recommended Project Structure

```
supabase/
  functions/
    helpdesk-inbound/
      index.ts           # Resend webhook receiver + HMAC verifier + ticket create
      index.test.ts      # Deno tests: sig verify, HMAC, known/unknown email paths
    helpdesk-ai-assist/
      index.ts           # Claude tagging + routing + sentiment + draft reply
      index.test.ts      # Deno tests: BAA gate, confidence threshold, sentiment
    helpdesk-csat-send/
      index.ts           # Post-close CSAT email via email-router
      index.test.ts
    helpdesk-sla-breach-cron/
      index.ts           # pg_cron-triggered SLA breach check + alert
      index.test.ts
  migrations/
    20XXXXXX_helpdesk_schema.sql        # tickets, ticket_messages, etc. + RLS
    20XXXXXX_helpdesk_fts_index.sql     # tsvector GIN + trigger
    20XXXXXX_helpdesk_pg_cron.sql       # SLA breach cron schedule

leanshot/src/
  helpdesk/
    HelpdeskWidget.tsx         # Root widget: auth-aware branching, lazy chunk
    KBSearchTypeahead.tsx      # KB instant search via tsvector RPC
    KBArticleView.tsx          # react-markdown + dompurify render
    TicketForm.tsx             # New ticket submit form
    TicketList.tsx             # User's active ticket list
    ReplyComposer.tsx          # Agent/user reply with /macro command
    MacroTypeahead.tsx         # Fuse.js + cmdk slash command
    TypingIndicator.tsx        # Realtime broadcast receiver
  admin/modules/helpdesk/
    HelpdeskInboxPage.tsx      # Agent inbox
    TicketDetailPage.tsx       # Ticket thread view + AI side-pane
    KBEditorPage.tsx           # CodeMirror 6 markdown editor + version diff
    MacroEditorPage.tsx        # Macro CRUD
    RoutingRulesPage.tsx       # If/then routing config
    SLATargetsPage.tsx         # SLA tier editor
    TrendsDashboardPage.tsx    # Chart.js tag-cluster dashboard
    SentimentQueuePage.tsx     # Needs-attention queue
    index.ts                   # Manifest entry + re-exports
```

---

## Pattern 1: Resend Inbound Webhook Handler

**What:** Resend POSTs an `email.received` event to the Edge Function. The payload contains metadata only (from, to, subject, email_id, attachments list). The Edge Fn must fetch the full body separately.

**Critical detail:** [VERIFIED: Resend docs via WebFetch + WebSearch] Webhook payload is metadata-only. Body text must be fetched via a second API call. Signature verification uses Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`).

**When to use:** `helpdesk-inbound` Edge Function only.

```typescript
// Source: Resend webhook docs + project stripe-webhook/index.test.ts pattern
// Set env vars before imports (Deno pattern established in stripe-webhook tests)
Deno.env.set('RESEND_API_KEY', '...');

// Step 1: Svix signature verification (raw body required)
const rawBody = await req.text();
const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')!;

// Svix verification — use resend.webhooks.verify() or manual Svix SDK
// Headers: svix-id, svix-timestamp, svix-signature
const svixId = req.headers.get('svix-id') ?? '';
const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
const svixSignature = req.headers.get('svix-signature') ?? '';

// Step 2: Parse event
const event = JSON.parse(rawBody) as { type: string; data: { email_id: string; from: string; to: string[]; subject?: string } };
if (event.type !== 'email.received') return new Response('ignored', { status: 200 });

// Step 3: Fetch full body via Resend API (NOT included in webhook)
const emailRes = await fetch(`https://api.resend.com/emails/receiving/${event.data.email_id}`, {
  headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
});
const email = await emailRes.json() as { text?: string; html?: string; /* ... */ };

// Step 4: Idempotency check (delivered-twice prevention)
const existing = await supabase
  .from('ticket_inbound_events')
  .select('id')
  .eq('resend_email_id', event.data.email_id)
  .maybeSingle();
if (existing.data) return new Response(JSON.stringify({ duplicate: true }), { status: 200 });

// Step 5: HMAC verification for reply+ addresses
const toAddr = event.data.to[0] ?? '';
if (toAddr.startsWith('reply+')) {
  const token = toAddr.replace('reply+', '').replace('@app.leanshot.app', '');
  // verify HMAC against vault secret + ticket_id:user_id
}
```

**Idempotency:** `ticket_inbound_events` table stores `resend_email_id`. Check before insert. Svix may deliver the same event twice on retries.

---

## Pattern 2: HMAC Reply Token

**What:** Per-ticket non-expiring token for reply-threading. Token = `base64url(hmac_sha256(vault_secret, "${ticket_id}:${user_id}"))`. Stored secret in Supabase vault.

```typescript
// Source: project realtime.ts + baa-scope.ts HMAC pattern
// Generate token (in ticket-create SECURITY DEFINER RPC)
const secret = await getVaultSecret('helpdesk_hmac_secret'); // vault.decrypted_secrets
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const sig = await crypto.subtle.sign(
  'HMAC',
  key,
  new TextEncoder().encode(`${ticketId}:${userId}`),
);
const token = btoa(String.fromCharCode(...new Uint8Array(sig)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

// Reply-To header value: `reply+${token}@app.leanshot.app`

// Verify incoming reply token
async function verifyReplyToken(token: string, ticketId: string, userId: string): Promise<boolean> {
  const expected = await generateToken(ticketId, userId);
  // constant-time compare to prevent timing attacks
  if (token.length !== expected.length) return false;
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(expected);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
```

**Security notes:** Constant-time comparison required (per `_shared/email-router.ts` T-25-03 pattern). Never log the token or the vault secret.

---

## Pattern 3: Postgres tsvector + GIN Full-Text Search (EN + ES)

**What:** Two separate tsvector columns per `kb_articles` row (one per language), each with a GIN index. Trigger maintains both on INSERT/UPDATE. Multilingual search via `websearch_to_tsquery` with the appropriate dictionary.

[VERIFIED: PostgreSQL official docs; oneuptime.com GIN blog post cross-referenced]

```sql
-- Migration: kb_articles FTS columns
ALTER TABLE kb_articles
  ADD COLUMN search_vector_en tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  ADD COLUMN search_vector_es tsvector GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(body_es, ''))
  ) STORED;

CREATE INDEX kb_articles_search_en_gin ON kb_articles USING GIN(search_vector_en);
CREATE INDEX kb_articles_search_es_gin ON kb_articles USING GIN(search_vector_es);

-- Query pattern (expose via SECURITY DEFINER RPC `search_kb_articles`)
SELECT id, slug, title, locale,
  ts_rank_cd(search_vector_en, query) AS rank
FROM kb_articles,
  websearch_to_tsquery('english', $1) query
WHERE search_vector_en @@ query
  AND locale = 'en'
  AND published_at IS NOT NULL
ORDER BY rank DESC
LIMIT 10;
```

**Generated ALWAYS AS STORED vs trigger:** Postgres 12+ generated columns are simpler and atomic — prefer over trigger approach. Gotcha: generated columns cannot reference other tables; for joining article version content, use a trigger or a manual-refresh pattern.

**For `kb_article_versions` content:** The `search_vector_*` is on `kb_articles` (current content). On version publish, update `kb_articles.body` → triggers automatic regeneration of generated column. No separate tsvector on the versions table needed.

---

## Pattern 4: Claude AI Assist (Tag + Route + Sentiment)

**What:** `helpdesk-ai-assist` Edge Function is invoked after ticket_message INSERT. Follows the exact baa-scope ordering from `anthropic-summarize.ts`.

```typescript
// Source: supabase/functions/_shared/anthropic-summarize.ts
// CRITICAL ordering — must match Phase 25 HIPAA-01 audit signal:
// 1. resolveBaaScope()      → emits baa.scope.resolved breadcrumb
// 2. assertBaaScope()       → model on allowlist if clinical
// 3. addBreadcrumb('anthropic.messages.create')
// 4. fetch /v1/messages

// Structured output schema for tagging
const tagClassificationSchema = z.object({
  tags: z.array(z.object({
    name: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  routing_suggestion: z.string().nullable(),
  draft_reply: z.string().nullable(),
  sentiment_score: z.number().min(-1).max(1),
});

// Model: use ANTHROPIC_MODEL_HELPDESK env var
// Must be in BAA_COVERED_MODELS list in anthropic-baa-allowlist.ts
// Current list: ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6']
// Per [[reference_anthropic_model_id_hyphenated_format]]: hyphenated, NOT dotted

// Auto-apply rule:
// confidence >= 0.75 → apply tag + routing
// confidence < 0.75  → store as suggestion only (ticket_ai_suggestions table)
// sentiment <= -0.6  → add to sentiment_alert_queue view / flag on ticket
```

**BAA allowlist update required:** `helpdesk-ai-assist` will use `claude-sonnet-4-6` (or `claude-haiku-4-5-20251001` for cost) in clinical context. The `BAA_COVERED_MODELS` array in `anthropic-baa-allowlist.ts` already includes `claude-sonnet-4-6` (added Phase 38). No allowlist update needed for that model. Planner must ensure the `ANTHROPIC_MODEL_HELPDESK` env var is set in Function Secrets.

---

## Pattern 5: pg_cron SLA Breach Alert

**What:** Named dollar-quote pattern per [[reference_postgres_dollar_quote_nesting_in_cron_body]] and vault service-role per [[reference_supabase_pg_cron_vault_service_role_pattern]].

```sql
-- Source: supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql
-- Source: supabase/migrations/20270704000023_quarterly_nps_cron.sql

-- REQUIRED: outer $cron$, inner unique tag (e.g. $sla$) — bare $$ silently breaks
DO $unschedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'helpdesk-sla-breach-check') THEN
    PERFORM cron.unschedule('helpdesk-sla-breach-check');
  END IF;
END
$unschedule$;

SELECT cron.schedule(
  'helpdesk-sla-breach-check',
  '*/5 * * * *',    -- every 5 minutes
  $cron$
  DO $sla$
  DECLARE
    v_service_role_key text;
  BEGIN
    SELECT decrypted_secret
    INTO v_service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    PERFORM net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/helpdesk-sla-breach-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_role_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END
  $sla$;
  $cron$
);
```

**SLA tier values (Claude's discretion — planner picks):**
- P1: response 4h, resolution 24h
- P2: response 24h, resolution 72h
- P3: response 72h, resolution 7d

---

## Pattern 6: Supabase Realtime for Ticket Channels

**What:** Broadcast channel per ticket (`ticket:<uuid>`) for typing indicators and live message arrival. `setAuth`-before-subscribe invariant from Phase 9 `clinic-realtime.ts`.

[VERIFIED: Supabase Realtime docs; clinic-realtime.ts source]

```typescript
// Source: leanshot/src/lib/clinic-realtime.ts
// Pattern established in Phase 9 Plan 09-02

// INVARIANT: setAuth() BEFORE subscribe() or private channels get CHANNEL_ERROR
// Typing indicator — broadcast only (no DB persistence)
const channel = supabase.channel(`ticket:${ticketId}`, {
  config: { broadcast: { self: false } },
});

// Typing: send
channel.send({
  type: 'broadcast',
  event: 'typing',
  payload: { userId, isTyping: true },
});

// Typing: receive
channel.on('broadcast', { event: 'typing' }, (payload) => {
  setTypingUsers(/* update state */);
});

// Live message arrival — postgres_changes on ticket_messages
channel.on(
  'postgres_changes',
  {
    event: 'INSERT',
    schema: 'public',
    table: 'ticket_messages',
    filter: `ticket_id=eq.${ticketId}`,
  },
  (payload) => {
    setMessages((prev) => [...prev, payload.new as TicketMessage]);
  }
);

await supabase.realtime.setAuth(); // CRITICAL — before subscribe
channel.subscribe();
```

**Channel name format:** `ticket:<uuid>` (not the org-HMAC pattern from Phase 28/29, since ticket channels are user-owned not org-owned). RLS on `realtime.messages` SELECT must allow: ticket owner OR org members with `helpdesk.agent` permission.

**Typing indicator debounce:** 500ms send throttle; 3s timeout to clear "is typing" state. [ASSUMED: these are reasonable starting values; planner may adjust]

---

## Pattern 7: Widget Lazy-Load (sync-defer)

**What:** Helpdesk widget deferred off index chunk via `sync-defer.ts`. Only fetched on widget open.

```typescript
// Source: leanshot/src/lib/sync-defer.ts (established Phase 24)
// In App.tsx — widget mounted at root, auth-aware
const HelpdeskWidget = React.lazy(() =>
  import(/* webpackChunkName: "helpdesk-widget" */ '@/helpdesk/HelpdeskWidget')
);

// Wrapped in sync-defer so it stays off the static import graph
// until the user interacts with the help button
```

**Bundle ceiling:** 25 kB gz for the entire `helpdesk-widget` chunk (Phase 24 D-16 to D-20). The AI side-pane (suggestions display only — no additional Claude calls on the frontend) MAY be a sub-chunk if it risks the ceiling. Planner measures after initial build.

**PHI-sensitive screen handling (D-17):** Read Phase 25 HIPAA-17 route regex from existing code. Planner picks: same regex → widget hidden entirely, OR widget renders in KB-only mode (no AI suggestions in side-pane). KB-only mode is the cleaner UX because users on PHI screens still need help.

---

## Pattern 8: Admin Module Manifest Entry

**What:** The `helpdesk` placeholder already exists at line 182 of `src/lib/admin/modules.ts`. The plan replaces `placeholderFor(...)` with the real lazy import pointing to `src/admin/modules/helpdesk/HelpdeskInboxPage`.

```typescript
// Source: leanshot/src/lib/admin/modules.ts line 182 — VERIFIED
// Current (placeholder):
{
  key: 'helpdesk',
  label: 'Helpdesk',
  route: 'helpdesk',
  icon: LifeBuoyIcon,
  lazy: placeholderFor('Phase 36+ (Helpdesk ticket inbox)'),
  flagKey: 'admin.helpdesk.enabled',
  minRole: 'staff' as AdminRole,
}

// Phase 37 replaces lazy with:
lazy: () => import('@/admin/modules/helpdesk/HelpdeskInboxPage'),
// The route is /admin/helpdesk — AdminShell's catch-all branch handles sub-routes
// per [[feedback_admin_module_manifest_vs_router_branch_drift]] pattern.
// Sub-routes (/admin/helpdesk/*, /admin/helpdesk/kb/*, etc.) need explicit
// prefix-matching branch in the admin router.
```

---

## Pattern 9: KB Article Versioning

**What:** `kb_article_versions` stores each published version as an immutable snapshot (body + body_es + published_by + published_at). `kb_articles` always reflects the live version.

```sql
-- On KB article publish:
-- 1. INSERT INTO kb_article_versions (article_id, body, body_es, published_by, version)
-- 2. UPDATE kb_articles SET body = $new_body, updated_at = now()
-- Generated column search_vector_en auto-regenerates on UPDATE
-- No manual tsvector refresh needed

-- Version diff: fetch two versions, compute diff client-side or via pg_diff extension
-- Revert: copy old body from kb_article_versions → UPDATE kb_articles
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom HTML parser | `react-markdown` + `remark-gfm` + `dompurify` | XSS surface; `dompurify` is specifically required for HIPAA trust boundary |
| Full-text search | Manual LIKE queries | Postgres `tsvector` + GIN + `ts_rank_cd` | LIKE is O(n) with no ranking; tsvector handles stop words, stemming, ranking |
| HMAC token | UUID or random string | `crypto.subtle.sign(HMAC-SHA256, vault_secret)` | UUID is not tamper-proof; replay attacks; constant-time compare required |
| Webhook verification | Manual header check | Svix SDK or Resend's `webhooks.verify()` | Timing-safe compare, timestamp validation (5-minute tolerance built-in) |
| Fuzzy macro search | Custom levenshtein | `fuse.js` | Handles weighted scoring, tokenization, threshold tuning |
| SLA time math | Manual interval arithmetic | Postgres `INTERVAL` + `TIMESTAMPTZ` arithmetic | Timezone handling, DST edge cases |
| AI output parsing | Regex on Claude response | `zod` schema validation (Phase 38 pattern) | Schema drift, hallucination, type safety |

**Key insight:** Every "simple string operation" in the helpdesk domain has a latent security surface (HMAC), a correctness trap (timezone math), or a production failure mode (webhook replay). Use established primitives.

---

## Common Pitfalls

### Pitfall 1: Resend Inbound Webhook — Metadata-Only Payload
**What goes wrong:** Edge Fn tries to read `event.data.body` or `event.data.text` from the webhook POST body. Field does not exist. Ticket is created with empty/null body.
**Why it happens:** Resend deliberately separates delivery (webhook) from retrieval (API) to keep webhook payloads small and ensure data persistence before your endpoint processes.
**How to avoid:** Always call `resend.emails.receiving.get(email_id)` after parsing the webhook event. Rate limit: Resend API is standard REST; no special limits documented. [ASSUMED: standard Resend rate limits apply]
**Warning signs:** `ticket_messages.body IS NULL` on inbound-created tickets.

### Pitfall 2: Idempotency — Resend May Deliver Twice
**What goes wrong:** Inbound webhook fires twice for the same email (Resend retries on 5xx from Edge Fn). Two ticket rows created.
**Why it happens:** Resend (via Svix) retries webhook delivery on non-2xx responses or timeouts.
**How to avoid:** `ticket_inbound_events` table with `resend_email_id TEXT UNIQUE`. Check before insert. Return 200 on duplicate detection.
**Warning signs:** Duplicate tickets with identical subject + timestamp in test.

### Pitfall 3: pg_cron Dollar-Quote Nesting Crash
**What goes wrong:** SLA breach cron migration uses bare `$$` inside the cron body. Postgres silently closes the outer quote on the FIRST inner `$$`. Migration applies with "syntax error at or near DECLARE."
**Why it happens:** See [[reference_postgres_dollar_quote_nesting_in_cron_body]]. Already burned in Phase 38 planning.
**How to avoid:** Outer tag `$cron$`, inner tag `$sla$`. NEVER use bare `$$` inside `cron.schedule(...)`.
**Warning signs:** `supabase db push` reports syntax error on the cron schedule migration.

### Pitfall 4: Realtime — setAuth Before Subscribe
**What goes wrong:** Channel silently fails with `CHANNEL_ERROR` for private channels. Agent inbox never updates.
**Why it happens:** The JWT needed to pass `realtime.messages` SELECT RLS policy must be set before subscribe. See Phase 9 clinic-realtime.ts Invariant #1.
**How to avoid:** Always `await supabase.realtime.setAuth()` immediately before `.subscribe()`.
**Warning signs:** `CHANNEL_ERROR` in browser console; channel status never reaches `SUBSCRIBED`.

### Pitfall 5: tsvector Generated Column — Cannot Reference Other Tables
**What goes wrong:** Planner tries to join `kb_article_versions` content into the generated column expression.
**Why it happens:** Postgres GENERATED ALWAYS AS columns are restricted to expressions over the same row.
**How to avoid:** Index is on `kb_articles.body` (the live version). Version search is not needed — users search live articles.

### Pitfall 6: tickets.status CHECK Constraint Widening
**What goes wrong:** Planner adds `status = 'waiting_on_customer'` in a later wave without first widening the CHECK constraint. UPDATE fails with `23514 check constraint violation` in production.
**Why it happens:** Postgres CHECK constraints on status enums must be widened in the SAME migration that adds the new value. See [[feedback_planner_missed_status_enum_widening]].
**How to avoid:** Define all status values upfront in the schema migration: `CHECK (status IN ('open', 'pending', 'resolved', 'closed', 'waiting_on_customer', 'spam'))`.

### Pitfall 7: Admin Module Sub-Route Catch-All
**What goes wrong:** `/admin/helpdesk/kb` and `/admin/helpdesk/trends` fall through to the default route (404 or wrong module).
**Why it happens:** Admin shell uses a URL-prefix catch-all branch per [[feedback_admin_module_manifest_vs_router_branch_drift]]. A single manifest entry for `helpdesk` only handles `/admin/helpdesk` exactly.
**How to avoid:** Admin shell router must match `/admin/helpdesk` as a prefix branch, not exact match. Sub-routes handled inside `HelpdeskInboxPage` via internal navigation state.

### Pitfall 8: PHI Flag Absent on AI Assist Call
**What goes wrong:** `helpdesk-ai-assist` calls Claude without checking `ticket.phi`. PHI ticket body sent to non-BAA credential. HIPAA violation.
**Why it happens:** Easy to miss the phi lookup when writing a new Edge Fn.
**How to avoid:** Plan-checker MUST verify that every Claude call in `helpdesk-ai-assist` reads `ticket.phi` first and routes through `resolveBaaScope` + `assertBaaScope`. CI lint for PHI keywords in Claude call sites (per Phase 25 HIPAA-02 pattern).

### Pitfall 9: Svix Webhook Timestamp Tolerance
**What goes wrong:** Edge Fn validates Svix signature but ignores timestamp. Replay attack succeeds with old webhook.
**Why it happens:** Svix requires timestamp validation within 5 minutes. If only the signature is checked, old valid signatures can be replayed.
**How to avoid:** Validate `svix-timestamp` is within 5 minutes of `Date.now()`. Svix SDK does this automatically.

### Pitfall 10: ClamAV TCP Socket Unavailable in Edge Fn
**What goes wrong:** `npm:clamav-client` or `npm:pompelmi` attempts TCP connection to `clamd` on `localhost:3310`. Connection refused. Edge Fn fails or skips scan silently.
**Why it happens:** Supabase Edge Functions run in Deno Deploy-like sandboxes — no sidecar processes, no clamd daemon. ClamAV requires a running `clamd` TCP/Unix socket server.
**How to avoid:** Either (a) skip ClamAV scan in v1.3 and accept risk with documented deferred-items.md P0, or (b) provision external ClamAV microservice (Fly.io) and verify HTTP reachability from Edge Fn before implementing. This is the highest-risk item in Phase 37.

---

## Code Examples

### Verified: email-router.ts Call Site for CSAT (phi-aware)
```typescript
// Source: supabase/functions/_shared/email-router.ts (verified in codebase)
// New 'csat_followup' template needed in EmailTemplate union + renderTemplate + subjectFor
await sendEmail(supabase, {
  template: 'csat_followup',
  to: ticketOwnerEmail,
  vars: { ticket_ref: `#${ticketId.slice(0, 8)}`, csat_url: signedCsatUrl },
  phi: ticket.phi,  // SINGLE switch — caller is authoritative
});
```

### Verified: BAA Scope Call Chain for helpdesk-ai-assist
```typescript
// Source: supabase/functions/_shared/baa-scope.ts + anthropic-summarize.ts
// Exact ordering required for Phase 25 HIPAA-01 audit signal

const scope = await resolveBaaScope(supabase, agentUserId);  // breadcrumb: baa.scope.resolved
const modelId = Deno.env.get('ANTHROPIC_MODEL_HELPDESK')!;
assertBaaScope(scope, modelId);  // throws 403 on clinical-path miss

addBreadcrumb({ category: 'anthropic.messages.create', level: 'info', data: { model_id: modelId } });

const res = await fetch(`${baseUrl}/v1/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${scope.credential}`,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({ model: modelId, max_tokens: 1024, messages: [...] }),
});
```

### Verified: Admin Manifest Placeholder Replacement
```typescript
// Source: leanshot/src/lib/admin/modules.ts (line 182 — verified)
// Replace placeholderFor('Phase 36+ (Helpdesk ticket inbox)') with:
lazy: () => import('@/admin/modules/helpdesk/HelpdeskInboxPage'),
// flagKey: 'admin.helpdesk.enabled' stays unchanged
// minRole: 'staff' stays unchanged (agents are staff-level)
```

### Verified: pg_cron Named Dollar-Quote Pattern
```sql
-- Source: supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql
-- Source: supabase/migrations/20270704000023_quarterly_nps_cron.sql
-- Pattern: $cron$ outer, $sla$ inner — NEVER bare $$
SELECT cron.schedule(
  'helpdesk-sla-breach-check',
  '*/5 * * * *',
  $cron$
  DO $sla$
  DECLARE v text;
  BEGIN
    SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    PERFORM net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/helpdesk-sla-breach-cron',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  END
  $sla$;
  $cron$
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trigger-based tsvector update | GENERATED ALWAYS AS STORED column | Postgres 12 (2019) | No trigger code to maintain; atomically consistent |
| Custom HMAC verification | `crypto.subtle` Web Crypto API | Deno 1.x (2020) | No external dep; works in Edge Fn sandbox |
| regex match on webhook signature | Svix SDK `verify()` | Resend webhook launch (2024) | Timing-safe, timestamp validation built-in |
| Typesense / Meilisearch for any search | Postgres tsvector + GIN for v1.3 | HELP-11 explicit deferral | Avoids external service dep at current scale; upgrade path at v1.5+ |

**Deprecated / outdated:**
- `npm:clamav-client`: Last meaningful update 2021; not Deno-native; requires clamd socket. `npm:pompelmi` is more modern but same clamd socket requirement.
- `websearch_to_tsquery` vs `to_tsquery`: Use `websearch_to_tsquery` for user input (handles quoted phrases, AND/OR naturally). Use `to_tsvector` + `plainto_tsquery` only for simple single-word programmatic queries.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resend Inbound webhook payload does NOT include email body; requires second API call to `resend.emails.receiving.get(email_id)` | Pattern 1, Pitfall 1 | LOW RISK: Verified via multiple sources. If wrong, skip the second API call. |
| A2 | ClamAV TCP socket is unavailable in Supabase Edge Function sandbox (no clamd sidecar) | Pattern 1, Pitfall 10 | HIGH RISK: If wrong (Supabase adds clamd support), ClamAV can be done inline. If correct and scan is attempted anyway, Edge Fn throws on cold start. Planner must decide: defer or external service. |
| A3 | Svix-based signature verification uses headers `svix-id`, `svix-timestamp`, `svix-signature` (not a Resend-specific HMAC secret) | Pattern 1 | MEDIUM RISK: If Resend uses a different scheme, webhook handler breaks. Verify at Resend dashboard when configuring webhook endpoint. |
| A4 | Typing indicator debounce: 500ms send, 3s clear timeout | Pattern 6 | LOW RISK: UX preference only; planner adjusts from production data. |
| A5 | SLA tiers P1=4h/24h, P2=24h/72h, P3=72h/7d are reasonable initial values | Claude's Discretion | LOW RISK: Initial values will be updated from production data regardless. |
| A6 | `fuse.js` is not yet in `package.json` | Standard Stack | MEDIUM RISK: If already added by a parallel phase, duplicate install fails silently (npm dedups). Verify before Wave 0. |
| A7 | `remark-gfm` is not yet in `package.json` | Standard Stack | MEDIUM RISK: Same as A6. `grep remark-gfm leanshot/package.json` before install. |

**If this table were empty:** All claims in this research were verified or cited.

---

## Open Questions

1. **ClamAV strategy for D-20**
   - What we know: ClamAV requires a running `clamd` daemon accessible via TCP or Unix socket. Supabase Edge Functions are sandbox-isolated Deno processes with no sidecar support.
   - What's unclear: Whether `npm:pompelmi` can make outbound TCP to an external ClamAV microservice from the Edge Fn sandbox.
   - Recommendation: Planner picks one of: (a) defer ClamAV to v1.4 + P0 deferred-items entry, (b) provision Fly.io ClamAV microservice and verify HTTP endpoint reachability before implement, (c) file-hash blocklist as a reduced-fidelity alternative. Option (a) is the least risky path for v1.3 timeline.

2. **Resend Inbound MX + existing `app.leanshot.app` domain**
   - What we know: Phase 16 verified the `app.leanshot.app` Resend domain for outbound. Inbound MX requires a separate DNS MX record pointing to Resend's inbound servers.
   - What's unclear: Whether the existing Phase 16 domain verification covers inbound MX or requires a separate Resend dashboard action.
   - Recommendation: Wave 0 task should verify Resend dashboard → Receiving → domain setup. This is a human-UAT checkpoint, not a code change.

3. **`ticket_ai_suggestions` vs inline confidence column**
   - What we know: D-07 requires storing below-threshold suggestions for agent review.
   - What's unclear: Whether suggestions are stored in a separate `ticket_ai_suggestions` table or as nullable columns on `ticket_messages`.
   - Recommendation: Separate table (`ticket_ai_suggestions`) with (ticket_id, tag_name, confidence, suggested_route, draft_reply, created_at). Keeps ticket_messages append-only (parallels audit_logs pattern).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | DB migrations, Edge Fn deploy | ✓ | 2.98.2 (package.json) | — |
| pg_cron extension | SLA breach cron | ✓ | Enabled (verified in Phase 38 migration) | — |
| pg_net extension | SLA breach cron HTTP calls | ✓ | Enabled (Phase 38 migration guards it) | — |
| Supabase Vault | HMAC secret storage | ✓ | Enabled (Phase 25 uses it) | — |
| Resend Inbound MX | Inbound email → ticket | UNKNOWN | — | Manual email handling / no inbound |
| ClamAV / clamd | Attachment virus scan | UNKNOWN (likely unavailable) | — | Skip scan in v1.3 (deferred-items P0) |
| `log_phi_access` SECDEF RPC | PHI audit logging | ✓ | Phase 25 Plan 25-02 | — |
| `_shared/email-router.ts` `csat_followup` template | CSAT delivery | Partial (file exists, template missing) | — | Add template in Wave 0 |
| `BAA_COVERED_MODELS` (allowlist) | AI assist on PHI tickets | ✓ | `claude-sonnet-4-6` already in list | — |

**Missing dependencies with no fallback:**
- Resend Inbound MX: must be configured in Resend dashboard for `app.leanshot.app` before `helpdesk-inbound` Edge Fn can receive emails. This is a DNS + Resend dashboard action, not a code change. Block `helpdesk-inbound` testing on this.

**Missing dependencies with fallback:**
- ClamAV: defer to v1.4 with unscanned-attachment deferred-items P0 entry. Accept risk in v1.3.
- `csat_followup` email template: new template in `email-router.ts` renderTemplate + subjectFor. Wave 0 task.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Vitest 4.1.5 + @testing-library/react 16.3.2 (jsdom) |
| Frontend config | `vite.config.ts` → `test:` block; env: jsdom; globals: true; setup: `./src/test-setup.ts` |
| Frontend quick run | `cd leanshot && npm run test:unit -- --testPathPattern helpdesk` |
| Frontend full suite | `cd leanshot && npm run test:unit` |
| Edge Fn framework | Deno built-in test runner |
| Edge Fn convention | `<name>.test.ts` in function directory (per [[reference_deno_test_discovery]]) |
| Edge Fn quick run | `deno test supabase/functions/helpdesk-inbound/index.test.ts` |
| Edge Fn full suite | `deno test supabase/functions/` |
| RLS / live-DB tests | Vitest live-DB via `vitest-e2e.config.ts`; auto-skip if service-role key absent |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HELP-01 | RLS: user sees own tickets only; agent sees org tickets | RLS (live-DB vitest) | `npm run test:e2e:rls -- --testPathPattern rls-helpdesk` | ❌ Wave 0 |
| HELP-02 | Widget chunk loads lazily; ≤25 kB gz | Bundle budget | `npm run check-bundle-budget` | Partial (budget script exists) |
| HELP-03 | Inbound webhook: known email creates ticket | Deno unit | `deno test supabase/functions/helpdesk-inbound/index.test.ts` | ❌ Wave 0 |
| HELP-03 | Inbound webhook: unknown email → auto-reply, no ticket | Deno unit | same | ❌ Wave 0 |
| HELP-03 | HMAC verify fail → bounce, no ticket | Deno unit | same | ❌ Wave 0 |
| HELP-03 | Idempotency: duplicate resend_email_id returns 200 | Deno unit | same | ❌ Wave 0 |
| HELP-04 | AI assist: phi=true ticket uses BAA credential | Deno unit | `deno test supabase/functions/helpdesk-ai-assist/index.test.ts` | ❌ Wave 0 |
| HELP-04 | BAA breadcrumb order: baa.scope.resolved before anthropic.messages.create | Deno unit | same | ❌ Wave 0 |
| HELP-04 | confidence ≥0.75 → tag auto-applied; <0.75 → suggestion only | Deno unit | same | ❌ Wave 0 |
| HELP-05 | CSAT email: phi=true → SES; phi=false → Resend | Deno unit | `deno test supabase/functions/helpdesk-csat-send/index.test.ts` | ❌ Wave 0 |
| HELP-06 | SLA breach cron: open tickets past SLA trigger alert | Deno unit | `deno test supabase/functions/helpdesk-sla-breach-cron/index.test.ts` | ❌ Wave 0 |
| HELP-07 | KB article renders markdown; dompurify strips XSS | Vitest RTL | `npm run test:unit -- --testPathPattern KBArticleView` | ❌ Wave 0 |
| HELP-09 | Realtime typing indicator: broadcast fires on input | Vitest RTL | `npm run test:unit -- --testPathPattern TypingIndicator` | ❌ Wave 0 |
| HELP-10 | /macro slash command shows fuzzy-matched macros | Vitest RTL | `npm run test:unit -- --testPathPattern MacroTypeahead` | ❌ Wave 0 |
| HELP-11 | FTS: `search_kb_articles('glycemic')` returns ranked results | RLS/live-DB | `npm run test:e2e:rls -- --testPathPattern helpdesk-fts` | ❌ Wave 0 |
| HELP-12 | Admin helpdesk module renders at /admin/helpdesk | Vitest RTL | `npm run test:unit -- --testPathPattern HelpdeskInboxPage` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Run the specific test file for the changed component
- **Per wave merge:** `npm run test:unit && deno test supabase/functions/helpdesk-*/index.test.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `supabase/functions/helpdesk-inbound/index.test.ts` — covers HELP-03 inbound paths
- [ ] `supabase/functions/helpdesk-ai-assist/index.test.ts` — covers HELP-04 BAA gate + confidence threshold
- [ ] `supabase/functions/helpdesk-csat-send/index.test.ts` — covers HELP-05 phi routing
- [ ] `supabase/functions/helpdesk-sla-breach-cron/index.test.ts` — covers HELP-06 SLA logic
- [ ] `leanshot/src/helpdesk/KBArticleView.test.tsx` — covers HELP-07 markdown + XSS
- [ ] `leanshot/src/helpdesk/TypingIndicator.test.tsx` — covers HELP-09
- [ ] `leanshot/src/helpdesk/MacroTypeahead.test.tsx` — covers HELP-10
- [ ] `leanshot/src/test/rls-helpdesk-tickets.test.ts` — covers HELP-01 + HELP-11 RLS
- [ ] `leanshot/src/admin/modules/helpdesk/HelpdeskInboxPage.test.tsx` — covers HELP-12

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Supabase Auth JWT; agent role gates on `helpdesk.agent` permission via `surfaceCheck()` + SECDEF |
| V3 Session Management | Partial | Supabase Auth manages sessions; ticket HMAC reply tokens are stateless (no session) |
| V4 Access Control | Yes | RLS two-axis (user_id + org_id); PHI flag gate on every email send and Claude call |
| V5 Input Validation | Yes | `zod` on AI assist output; `dompurify` on KB markdown; `remark-gfm` for structured parse |
| V6 Cryptography | Yes | `crypto.subtle` HMAC-SHA256 for reply tokens; constant-time compare; vault secret storage |

### Known Threat Patterns for Helpdesk Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email loop (auto-reply storm) | Availability | Check `Reply-To` and `From` headers; reject if `From` matches `noreply@` / `reply+` prefix; log loop-detection events |
| HMAC reply token forgery | Tampering | Constant-time compare; vault secret (not env var); 256-bit entropy |
| Webhook replay (old Svix events) | Spoofing | Svix timestamp check ±5 min; `ticket_inbound_events.resend_email_id UNIQUE` idempotency |
| Cross-tenant ticket attachment access | Information Disclosure | RLS on `ticket_attachments`: `org_id = auth.jwt()->'org_id'` AND `phi` predicate |
| PHI via non-SES path | Information Disclosure | `email-router.ts` hard-blocks Resend fallback on SES failure (T-25-03-S4 pattern) |
| AI hallucination injected into ticket | Tampering | Agent always reviews draft before send (D-08); `validateNoClinicalKeywords` on output (Phase 38 pattern) |
| Spam flood via inbound email | Availability | Rate-limit by sender domain; unknown email → auto-reply + no ticket (D-21); log for analysis |
| Malicious attachment upload | Tampering | ClamAV scan (deferred if unavailable); file type allowlist; 10 MB cap; private storage bucket + RLS |

---

## Project Constraints (from CLAUDE.md)

All Phase 37 work must comply with these directives:

1. **TypeScript strict mode** — all new `src/` code must pass `tsc -b --noEmit` with `strict: true`, `noUnusedLocals`, `noUnusedParameters`.
2. **Path alias `@/*` → `./src/*`** — all cross-directory imports use `@/...`.
3. **Lazy-loading preserved** — helpdesk-widget MUST be loaded via `React.lazy` inside `<Suspense>`, never eagerly.
4. **Bundle size: 25 kB gz ceiling** for `helpdesk-widget` chunk (Phase 24 D-16..20).
5. **Accessibility** — all new interactive elements need `aria-label`, `role`, `aria-live` as appropriate per CLAUDE.md accessibility conventions.
6. **framer-motion animations** — respect `useReducedMotion()` hook.
7. **Naming conventions** — PascalCase components, camelCase hooks (useX), kebab-case lib files, SCREAMING_SNAKE_CASE constants.
8. **State management** — no new global Zustand slices without strong justification; helpdesk widget state stays local to the widget component tree.
9. **HIPAA: `data-sentry-mask`** on all PHI input fields in helpdesk widget (patient ticket body = PHI if actor is clinician).
10. **No `current_setting('app.*')` GUC** in pg_cron bodies — use `vault.decrypted_secrets` (per [[reference_supabase_pg_cron_vault_service_role_pattern]]).
11. **Migration filename regex** — `<14-digits>_name.sql` strict; grep `^Skipping` before push (per [[reference_supabase_migration_filename_regex]]).
12. **`supabase functions deploy` — no `--linked` flag** (CLI v2.100.0 removed it; per [[reference_supabase_functions_deploy_no_linked_flag]]).
13. **Deno test file naming** — `<name>.test.ts` (not `<name>-test.ts`) per [[reference_deno_test_discovery]].
14. **Status enum widening** — `tickets.status` CHECK constraint must enumerate ALL values in the schema migration (per [[feedback_planner_missed_status_enum_widening]]).
15. **Anthropic model IDs** — hyphenated format (`claude-sonnet-4-6`, not `claude-sonnet-4.6`); per [[reference_anthropic_model_id_hyphenated_format]].

---

## Sources

### Primary (HIGH confidence)
- `supabase/functions/_shared/email-router.ts` — phi-aware routing pattern (VERIFIED in codebase)
- `supabase/functions/_shared/anthropic-baa-allowlist.ts` — BAA model list (VERIFIED; last updated Phase 38)
- `supabase/functions/_shared/baa-scope.ts` — BAA scope resolution + breadcrumb ordering (VERIFIED)
- `supabase/functions/_shared/anthropic-summarize.ts` — AI call pattern (VERIFIED)
- `supabase/functions/_shared/realtime.ts` — HMAC channel naming (VERIFIED)
- `leanshot/src/lib/clinic-realtime.ts` — Phase 9 Realtime patterns (VERIFIED)
- `leanshot/src/lib/admin/modules.ts` — admin manifest with helpdesk placeholder at line 182 (VERIFIED)
- `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — named dollar-quote pattern (VERIFIED)
- `supabase/migrations/20270704000023_quarterly_nps_cron.sql` — vault service-role pattern (VERIFIED)
- `leanshot/package.json` — react-markdown@9.0.0, dompurify@3.2.0, rehype-raw@7.0.0, cmdk@1.1.1 (VERIFIED)
- `leanshot/vite.config.ts` test block — Vitest jsdom, globals, setupFiles (VERIFIED)
- PostgreSQL official docs — tsvector GENERATED ALWAYS AS STORED (HIGH confidence)
- [CITED: supabase.com/docs/guides/realtime/postgres-changes] — Realtime postgres_changes + RLS

### Secondary (MEDIUM confidence)
- [CITED: resend.com/docs/dashboard/receiving/introduction] — Resend Inbound: metadata-only webhook, Svix verification, `resend.emails.receiving.get()` required
- [CITED: oneuptime.com/blog/post/2026-01-25-full-text-search-gin-postgresql] — GIN index patterns
- [CITED: froquiz.com/blog/postgresql-full-text-search] — multilingual tsvector, `websearch_to_tsquery`
- npm registry — remark-gfm@4.0.1, fuse.js@7.3.0, @supabase/supabase-js@2.106.1 (VERIFIED via `npm view`)

### Tertiary (LOW confidence / ASSUMED)
- ClamAV TCP socket unavailability in Supabase Edge Fn sandbox — inferred from Deno Deploy sandbox model; not verified against Supabase docs
- Svix 5-minute timestamp tolerance — standard Svix behavior; not re-verified against Resend-specific Svix config

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all library versions registry-verified; all reused shared modules read from disk
- Architecture: HIGH — patterns from Phase 25, 38, 9 read and confirmed; admin manifest line number verified
- Pitfalls: HIGH — most drawn from project memory references ([[reference_postgres_dollar_quote_nesting_in_cron_body]], [[reference_supabase_pg_cron_vault_service_role_pattern]], etc.)
- Resend Inbound specifics: MEDIUM — docs accessible via web search; payload structure confirmed but Svix header names not in-codebase-verified
- ClamAV Edge Fn compatibility: LOW — inferred from Deno sandbox model; not verified

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (Resend Inbound API may evolve; re-verify if >30 days before planning)
