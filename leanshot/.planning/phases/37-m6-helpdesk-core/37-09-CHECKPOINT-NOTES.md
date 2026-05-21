# Phase 37 Plan 37-09 — Checkpoint Notes

Plan 37-09 paused at Task 4 (operator UAT). Tasks 1-3 shipped on the
worktree branch `worktree-agent-a8047894724fdf0c5` and are ready to merge.

This file structures the resume contract per
[[feedback_multi_signal_human_verify_checkpoint_pattern]] — three discrete
resume signals so the operator can approve them piecewise.

---

## Status snapshot

| Task | Description                                                        | Status     | Commit  |
| ---- | ------------------------------------------------------------------ | ---------- | ------- |
| 1    | RLS proof: tickets / messages / attachments / ai_suggestions        | COMPLETE   | bc4c2c7 |
| 2    | RLS proof: kb_articles / versions / macros / routing / sla          | COMPLETE   | 5360c17 |
| 3    | UAT runbook                                                         | COMPLETE   | 6bfe8c6 |
| 4    | Operator UAT (Function Secrets + Resend Inbound + e2e smoke)        | AWAITING   | —       |

---

## Resume signals (3-way)

### Signal A — Function Secrets set (CLI-runnable, ~5 minutes)

**What:** Run Section 1 of `uat-runbook.md`. Verify `supabase secrets list`
shows 8 secret names (HELPDESK_HMAC_SECRET, HELPDESK_CSAT_SIGNING_SECRET,
ANTHROPIC_MODEL_HELPDESK, SLA_BREACH_DEFAULT_ONCALL_EMAILS, RESEND_API_KEY,
RESEND_WEBHOOK_SECRET, ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_BAA).

**Blocker:** None. Operator can do this immediately. `RESEND_WEBHOOK_SECRET`
arrives in Signal B but the other 7 are set in Signal A.

**Resume payload from operator:** `signal-A: approved (7/8 set; RESEND_WEBHOOK_SECRET deferred to Signal B)`
OR `signal-A: failed [reason]`.

---

### Signal B — Resend Inbound MX + webhook live (browser-only, 5-90 minutes)

**What:** Run Section 2 of `uat-runbook.md`. Enable Receiving on Resend
dashboard for `app.leanshot.app`, add MX records to Vercel DNS, wait for
verification, create webhook endpoint pointed at
`https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-inbound`,
copy the Signing Secret into `RESEND_WEBHOOK_SECRET`.

**Blocker:** No CLI path — Resend Receiving + Webhook UI has no public REST
or CLI hook. DNS propagation typically 5-30 min; can extend to 90 min on
slow providers.

**Resume payload from operator:** `signal-B: approved (MX verified at HH:MM, webhook ID whsec_xxx set)`
OR `signal-B: failed [reason]`.

---

### Signal C — End-to-end smoke a-i (depends on A + B, ~15-30 minutes)

**What:** Run Section 4 of `uat-runbook.md`. Send external email → confirm
ticket → confirm AI suggestion → send reply → round-trip user reply → close
+ CSAT → PHI audit row → SLA breach back-date + cron.

**Blocker:** Signals A + B must both be green. Email round-trip requires real
mailbox interaction (3 emails). PHI step (h) + SLA step (i) are CLI-only and
can run independent of email round-trip.

**Resume payload from operator:** Per-step PASS/FAIL with PHI row + SLA row
copied (excluding sensitive PII).

---

## Disposition: auto-verify-only (expected)

Per operator's standing v1.3 disposition for HITL fixtures missing
([Phase 34-08, 38-08, 37-07 precedent]), the most likely resolution is:

```
disposition: auto-verify-only
carry-forward: signal-B + signal-C to v1.3 milestone close
inline-approval: signal-A (CLI-runnable now)
```

The orchestrator should append this resolution below the Status snapshot
above before merging the worktree.

---

## What landed on the worktree branch

Three commits on `worktree-agent-a8047894724fdf0c5`:

```
6bfe8c6  docs(37-09): Task 3 — operator UAT runbook for Phase 37 closeout
5360c17  test(37-09): Task 2 — RLS cross-tenant proof for kb_articles/macros/routing/sla
bc4c2c7  test(37-09): Task 1 — RLS cross-tenant proof for tickets/messages/attachments/ai_suggestions
```

Files:
- `leanshot/src/test/rls-helpdesk-tickets.test.ts` (10 cases)
- `leanshot/src/test/rls-helpdesk-kb.test.ts` (11 cases)
- `leanshot/.planning/phases/37-m6-helpdesk-core/uat-runbook.md`
- `leanshot/vitest-e2e.config.ts` (include glob extended)

No new source code — only tests + docs + a single config entry. No
migrations, no Edge Fn changes.

---

## Out-of-scope deferrals captured during execution

### D-37-09-1 — `org_member_role` enum missing `support_admin` + `support_lead`

The Phase 37 SECDEF RPCs and RLS policies reference enum values
`'support_admin'` and `'support_lead'` (e.g. `publish_kb_article`,
`am_insert_admin`, `hrr_insert_admin`, `sla_insert_admin`, plus several KB
policies). The actual `org_member_role` enum after the Plan 31-00 rename
only has `('owner','clinician','staff')`.

**Impact today:** Only `role='owner'` rows pass the admin gate. There are no
`support_admin` / `support_lead` rows in production today, so the policies
are functionally `role='owner'` only.

**Future fix:** Add an enum-extension migration when v1.4+ introduces
finer-grained support roles:

```sql
alter type public.org_member_role add value if not exists 'support_admin';
alter type public.org_member_role add value if not exists 'support_lead';
```

This is purely additive and won't break existing policies (they already
reference these values; only the enum needs catching up).

**Append to** `leanshot/.planning/phases/37-m6-helpdesk-core/deferred-items.md`
**before merge** (if not already tracked).
