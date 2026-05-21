---
phase: 37-m6-helpdesk-core
type: carry-over
created: 2026-05-21
deferred_to: v1.3-milestone-close
---

# Phase 37 — Deferred Items (carry to v1.3 milestone close)

Phase 37 shipped 8.5 of 9 plans. The following items are deferred per operator decision (`auto-verify-only` disposition; session auto-chain).

## 37-07 — Admin helpdesk module UX walkthrough

- **Disposition:** auto-verify-only (12 vitest + 10 deno + tsc clean + 3 Phase38Event widening verified)
- **Action required at milestone close:** Sign in as superadmin (`karsten.haldan@gmail.com` / `7be46929-9838-43ea-af46-1cd6937927b6`), visit `/admin/helpdesk`, walk through 12-step script in `37-07-CHECKPOINT-NOTES.md`. Requires `helpdesk-agent-reply-send` Edge Fn deploy (Plan 37-09 Signal A).
- **Source:** `37-07-CHECKPOINT-NOTES.md` Resolution section.

## 37-09 — Multi-signal HUMAN checkpoint

### Signal A: Function Secrets (CLI-runnable, ~5 min)

```bash
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  HELPDESK_HMAC_SECRET=... \
  RESEND_API_KEY=re_... \
  RESEND_WEBHOOK_SECRET=whsec_... \
  HELPDESK_CSAT_SIGNING_SECRET=... \
  SLA_BREACH_DEFAULT_ONCALL_EMAILS=... \
  AI_GATEWAY_API_KEY_CONSUMER=... \
  AI_GATEWAY_API_KEY_CLINICAL=... \
  AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh

# Deploy 5 Edge Fns:
supabase functions deploy helpdesk-inbound --import-map supabase/functions/import_map.json
supabase functions deploy helpdesk-ai-assist --import-map supabase/functions/import_map.json
supabase functions deploy helpdesk-csat-send --import-map supabase/functions/import_map.json
supabase functions deploy helpdesk-sla-breach-cron --import-map supabase/functions/import_map.json
supabase functions deploy helpdesk-agent-reply-send --import-map supabase/functions/import_map.json
```

### Signal B: Resend Inbound MX records (browser-only, 5-90 min DNS propagation)

- Resend dashboard → Inbound → add domain `app.leanshot.app`
- Add MX records via Vercel DNS / domain registrar (records from Resend dashboard)
- Wait for DNS propagation; verify in Resend dashboard
- Configure webhook endpoint pointing at `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-inbound`

### Signal C: E2E smoke (mixed, 15-30 min, gates on A+B)

- 9 steps a-i in `uat-runbook.md` Section 4
- Includes email round-trip (send to `support@app.leanshot.app` → ticket lands → reply via `reply+<HMAC>@app.leanshot.app` → threading verified)
- PHI audit verify queries: `select * from public.phi_access_log where ...`
- SLA breach simulation: insert ticket with old `last_user_message_at`, wait for cron, verify alert email + `ticket_sla_breach_state` row

### D-37-09-1: org_member_role enum gap (v1.4+ deferred)

- `org_member_role` enum currently has only `owner` (+ maybe `clinician`, `staff` per project memory). Phase 37 SECDEF RPCs + RLS policies reference `support_admin` + `support_lead` which don't exist.
- **Symptom:** Today, only `role='owner'` passes Phase 37 admin gates. Non-owner users won't see helpdesk admin module even with the right schema.
- **Fix at v1.4+:** Additive enum-extension migration:
  ```sql
  alter type org_member_role add value if not exists 'support_admin';
  alter type org_member_role add value if not exists 'support_lead';
  ```
- RLS tests written around current state (use `role='owner'` for admin-gated assertions).

## Milestone-close audit (combined with 34-CARRY-OVER + 38-08 + 34-10)

When v1.3 closes, run the following sequence:
1. **Function Secrets sweep** — set all secrets from 34-10 (Apple SSO, PostHog) + 37-09 (Helpdesk x8) in one shot.
2. **DNS / Resend Inbound setup** (Signal B + 34-10 Apple Services ID + 34-10 PostHog domain).
3. **Edge Fn deploy sweep** — all helpdesk Fns + shipped 34-x + 38-x Fns.
4. **UX walkthrough batch** — 34-08, 37-07 (now possible with superadmin row + deployed Fns).
5. **E2E smoke batch** — 37-09 Signal C, 34-10 Task 4 final smoke, 38-10 (AI eval) once that ships.
6. **org_member_role enum extension** to unlock non-owner support roles.
7. Mark Phase 34 + 37 + 38 as fully closed in ROADMAP.md / STATE.md.
