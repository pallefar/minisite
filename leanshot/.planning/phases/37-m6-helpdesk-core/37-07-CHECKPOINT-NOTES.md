# Phase 37 Plan 37-07 — Human-Verify Checkpoint Notes

**Status:** Awaiting operator verification (Task 4).
**Commits up to this checkpoint:** 28a2dcc → c608304 → 72c6907 → e3af0a6

## What was built

| Surface | File | Purpose |
|---|---|---|
| Admin manifest | `leanshot/src/lib/admin/modules.ts` | Replaced `placeholderFor('Phase 36+')` with real lazy import to `@/admin/modules/helpdesk` |
| Sub-nav shell | `leanshot/src/admin/modules/helpdesk/HelpdeskLayout.tsx` | 7-route sub-nav (inbox, kb, macros, routing, sla, sentiment, trends); Plan 37-08 will replace kb/macros/routing/sla/trends placeholders |
| Ticket inbox | `leanshot/src/admin/modules/helpdesk/HelpdeskInboxPage.tsx` | Filters (status/priority/assigned/sentiment) + ticket list + row-click opens detail slide-over |
| Detail slide-over | `leanshot/src/admin/modules/helpdesk/TicketDetailPage.tsx` | Thread view + AI suggestion pane + reply composer + Close/Reopen actions. Fires `logPhiAccess` on PHI tickets (dedupe via useRef) |
| AI suggestion pane | `leanshot/src/admin/modules/helpdesk/AiSuggestionPane.tsx` | Sentiment + tags + draft reply preview + "Insert into composer" (no auto-send) |
| Reply composer | `leanshot/src/admin/modules/helpdesk/AgentReplyComposer.tsx` | Explicit-click-only Send; `data-sentry-mask` on textarea; INSERT message → invoke Edge Fn → UPDATE ticket → capture analytics |
| Sentiment queue | `leanshot/src/admin/modules/helpdesk/SentimentQueuePage.tsx` | Read-only list of tickets with `sentiment_alert_fired_at IS NOT NULL` |
| Edge Fn | `supabase/functions/helpdesk-agent-reply-send/index.ts` | Dual-auth (service-role OR session JWT with org-member check); sendEmail via `_shared/email-router.ts`; Reply-To `reply+<HMAC>@app.leanshot.app` |
| Analytics widening | `leanshot/src/lib/analytics/events.ts` + `supabase/functions/_shared/posthog-server.ts` | Added `helpdesk.ticket.closed`, `.reopened` client + server (`.replied` was already present client-side; added server-side this plan) |

## Pre-checks (run BEFORE walkthrough)

```bash
# From repo root — confirm tests + tsc pass.
cd /Users/karstenhaldan/minisite/leanshot && npm run test:unit -- --run --testPathPattern 'admin/modules/helpdesk'
cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit
cd /Users/karstenhaldan/minisite/supabase/functions && deno test --allow-env --allow-read --allow-net helpdesk-agent-reply-send/index.test.ts
```

Expected: 12/12 unit pass, tsc silent, 10/10 deno pass.

## Required environment (Edge Fn deploy)

```bash
# Already-set Function Secrets (verify before deploy):
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E '(HELPDESK_REPLY_HMAC|SUPABASE_SERVICE_ROLE_KEY|AWS_SES_)'

# Deploy helpdesk-agent-reply-send Edge Fn:
cd /Users/karstenhaldan/minisite/supabase
supabase functions deploy helpdesk-agent-reply-send --import-map functions/import_map.json
```

(no `--linked` per [[supabase_functions_deploy_no_linked_flag]])

## 12-step walkthrough

1. `cd /Users/karstenhaldan/minisite/leanshot && npm run build && npm run preview` (or use deployed Vercel preview).
2. Log in as `karsten.haldan@gmail.com` (superadmin, id `7be46929-9838-43ea-af46-1cd6937927b6`).
3. Navigate to `/admin/helpdesk`. Confirm sub-nav shows 7 items: Inbox / Knowledge Base / Macros / Routing Rules / SLA Targets / Sentiment Queue / Trends. "Inbox" is active by default.
4. Inbox loads tickets via RLS. Toggle status filter chips → list narrows. Click priority chip P1 → only P1 rows shown. Click "Sentiment alerts only" → only rows with `sentiment_alert_fired_at IS NOT NULL`.
5. Click any ticket row → slide-over opens with thread on the left, AI suggestion + composer on the right. `aria-modal="true"`; Esc closes; backdrop click closes.
6. If `ticket.phi === true`, verify the audit row appears:
   ```bash
   supabase db query --linked "select id, accessed_user_id, accessed_org_id, reason, created_at from public.phi_access_log where accessed_user_id = '<ticket.user_id>' order by created_at desc limit 3"
   ```
   Close + reopen the same ticket — confirm NO second log row appears (dedupe via `useRef`).
7. AiSuggestionPane shows tags, sentiment score (color-coded: red ≤-0.6, amber -0.3..-0.6, green ≥-0.3), and a draft preview truncated to 400 chars with "Show full" expander.
8. Click "Insert draft into composer" → composer textarea populates. The Send button does NOT auto-fire (verify by watching network panel — no `helpdesk-agent-reply-send` request).
9. Edit the draft, click "Send reply":
   - Network: `POST .../functions/v1/helpdesk-agent-reply-send` returns 200 `{ok:true}`.
   - DB: `select id, author_kind, via, created_at from ticket_messages where ticket_id = '<id>' order by created_at desc limit 3` shows a fresh `author_kind='agent', via='admin'` row.
   - DB: `select last_agent_message_at, status from tickets where id = '<id>'` — `last_agent_message_at` advanced; `status` flipped open→pending if it was open.
   - Recipient inbox (test address) receives an email with header `Reply-To: reply+<token>@app.leanshot.app`.
10. Click "Sentiment Queue" sub-nav → shows tickets with active sentiment alerts.
11. Navigate to `/admin/helpdesk/kb` → renders "Knowledge Base — see Plan 08" placeholder (NOT a 404 — confirms prefix-branch matching in `AdminShell.tsx`).
12. Navigate to `/admin/helpdesk/trends` → renders "Trends — see Plan 08" placeholder.

## Resume signal

Type `approved` if all 12 steps pass.

If a step fails, describe which step + observed behavior; the executor will be resumed with the failure context to apply a fix.

## Notes for operator

- The walkthrough requires at least one open ticket in the operator's org with `phi=true` to verify D-05. If none exists, you can either seed one via `supabase db query --linked` (insert a `tickets` row with `phi=true`, `org_id` matching one you're a member of) OR explicitly skip steps 6 and confirm everything else.
- Auto-verify-only disposition is acceptable per session pattern ([[hitl-walkthrough-deferred-when-fixtures-missing]]) — the automated test suite (12 unit + 10 deno) covers all behavior gates; the walkthrough validates the integration but does not re-validate logic. If you'd rather defer to milestone close, type `auto-verify-only` instead of `approved`.
