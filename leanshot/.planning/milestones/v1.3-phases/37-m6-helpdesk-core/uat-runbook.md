# Phase 37 UAT Runbook

Operator-facing procedure for Phase 37 (M6 Helpdesk Core) closeout.

All commands are run from the monorepo root: `/Users/karstenhaldan/minisite`
unless otherwise noted.

Per [[feedback_verify_human_uat_via_cli]] + [[feedback_cli_over_paste_back]]:
every step that has a CLI path is encoded here as copy-paste shell. The only
human-only steps are the Resend dashboard MX setup (Section 2) and the
end-to-end email smoke (Section 4).

---

## 0. Pre-flight

```bash
# 0a. Authenticate
supabase login          # if not already

# 0b. Link the leanshot project (skip if .temp/ already populated)
supabase link --project-ref ytnsipxxmzgaebkqmokp

# 0c. Sanity-check the linked project
supabase db query --linked "select current_database() as db, current_user as caller"
```

Expected: `db=postgres`, `caller=postgres` (or your operator role on the
service-role connection).

---

## 1. Function Secrets

### 1a. Fetch existing HMAC secret from Vault

The helpdesk HMAC secret is stored in `vault.secrets` (created Plan 37-01).
Fetch it directly into a shell variable rather than asking the operator to
paste:

```bash
HMAC_SECRET=$(supabase db query --linked \
  "select decrypted_secret from vault.decrypted_secrets where name='helpdesk_hmac_secret'" \
  --json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['decrypted_secret'])")

# Sanity (length check only — never echo the value itself):
test -n "$HMAC_SECRET" && echo "HMAC_SECRET length: ${#HMAC_SECRET}"
```

If empty: vault row missing — re-run the Plan 37-01 vault migration or insert
manually:

```bash
supabase db query --linked \
  "select vault.create_secret('$(openssl rand -hex 32)','helpdesk_hmac_secret')"
```

### 1b. Generate a fresh CSAT signing secret

```bash
CSAT_SECRET=$(openssl rand -hex 32)
echo "CSAT_SECRET length: ${#CSAT_SECRET}"
```

### 1c. Set all non-Resend Function Secrets in one go

```bash
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  HELPDESK_HMAC_SECRET="$HMAC_SECRET" \
  HELPDESK_CSAT_SIGNING_SECRET="$CSAT_SECRET" \
  ANTHROPIC_MODEL_HELPDESK=claude-sonnet-4-6 \
  SLA_BREACH_DEFAULT_ONCALL_EMAILS="ops@leanshot.app,karsten.haldan@gmail.com"
```

(Per [[reference_anthropic_model_id_hyphenated_format]]: hyphenated
`claude-sonnet-4-6`, NOT dotted `claude-sonnet-4.6`.)

### 1d. Verify required secrets are PRESENT (names only — never values)

```bash
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp \
  | grep -E "HELPDESK_HMAC_SECRET|HELPDESK_CSAT_SIGNING_SECRET|ANTHROPIC_MODEL_HELPDESK|SLA_BREACH_DEFAULT_ONCALL_EMAILS|RESEND_API_KEY|RESEND_WEBHOOK_SECRET|ANTHROPIC_API_KEY|ANTHROPIC_API_KEY_BAA"
```

Expected names that MUST be present after Section 1 only (RESEND_WEBHOOK_SECRET
arrives in Section 2):

| Secret                          | Source                  | Section |
| ------------------------------- | ----------------------- | ------- |
| HELPDESK_HMAC_SECRET            | Vault                   | 1c      |
| HELPDESK_CSAT_SIGNING_SECRET    | `openssl rand -hex 32`  | 1c      |
| ANTHROPIC_MODEL_HELPDESK        | literal                 | 1c      |
| SLA_BREACH_DEFAULT_ONCALL_EMAILS| ops distribution list   | 1c      |
| RESEND_API_KEY                  | Resend dashboard (set in Phase 16) | already-set / verify |
| RESEND_WEBHOOK_SECRET           | Resend dashboard        | 2g      |
| ANTHROPIC_API_KEY               | already-set (Phase 24/25) | verify |
| ANTHROPIC_API_KEY_BAA           | already-set (Phase 25)    | verify |

If `RESEND_API_KEY` is missing → it must be re-set from the Resend dashboard
API keys page (https://resend.com/api-keys); ask the operator since the value
is sensitive and not pre-baked in this repo.

### 1e. Known role-gating caveat (DOES NOT BLOCK runbook completion)

The current `publish_kb_article` / `agent_macros` / `helpdesk_routing_rules` /
`sla_targets` admin gates reference `role in ('owner','support_admin',
'support_lead')`. However the `org_member_role` enum only enumerates
`('owner','clinician','staff')` after the Plan 31-00 rename. This means in
practice ONLY users with `role='owner'` pass the admin gate today — there are
no `support_admin` or `support_lead` rows in production. This was caught by
the RLS test suites in Plan 37-09 but is NOT a blocker for v1.3 ship; if
v1.4+ wants finer-grained admin support roles, add the enum values via
`alter type public.org_member_role add value 'support_admin'` migration.

Tracked in `.planning/phases/37-m6-helpdesk-core/deferred-items.md` (append
during plan execution if not already).

---

## 2. Resend Inbound dashboard configuration (HUMAN-ONLY)

This section cannot be automated — Resend's Receiving + Webhook setup has no
public CLI/REST contract per RESEARCH Open Question 2.

### 2a. Confirm domain is already verified for outbound

Open https://resend.com/domains and find `app.leanshot.app`. It should already
be verified (green check) for OUTBOUND from Phase 16. If not — STOP and do
Phase 16 dns setup first.

### 2b. Enable Receiving

In the Resend dashboard → `app.leanshot.app` → Receiving tab → Enable.

Resend will surface an MX record pair, e.g.:

```
Type:     MX
Host:     app.leanshot.app  (or @ if root)
Value:    feedback-smtp.us-east-1.resend.com
Priority: 10
```

Copy these values exactly.

### 2c. Add the MX record at the DNS provider

The DNS for `app.leanshot.app` is managed in Vercel:

https://vercel.com/karstenhaldan-5548/leanshot-marketing/settings/domains

Click `app.leanshot.app` → Edit DNS Records → Add record with the Resend
values above.

If Vercel's UI rejects the host name (e.g. wants `@` instead of the FQDN),
match the existing TXT/SPF records' convention for that subdomain.

### 2d. Wait for MX verification

Resend shows MX status on the Receiving tab. Refresh until green
(~5-15 min; sometimes up to 30 min on slow DNS providers).

### 2e. Add the inbound webhook endpoint

Resend dashboard → Webhooks → Add Endpoint:

```
URL:       https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-inbound
Events:    email.received
```

### 2f. Copy the Signing Secret

After creating the endpoint, click into it. The "Signing Secret" field starts
with `whsec_…`. Copy the WHOLE value.

### 2g. Set the secret

```bash
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2h. Verify webhook secret is now in the list

```bash
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep RESEND_WEBHOOK_SECRET
```

Expected: one row, name only.

---

## 3. Edge Function redeploys (post-secrets)

Re-deploy each helpdesk Edge Function so the new secrets are picked up by the
worker pool. Per [[reference_supabase_functions_deploy_no_linked_flag]]: NO
`--linked` flag.

```bash
cd /Users/karstenhaldan/minisite
supabase functions deploy helpdesk-inbound
supabase functions deploy helpdesk-ai-assist
supabase functions deploy helpdesk-csat-send
supabase functions deploy helpdesk-sla-breach-cron
supabase functions deploy helpdesk-agent-reply-send
```

If any function imports via `supabase/functions/import_map.json` aliases,
pass `--import-map supabase/functions/import_map.json` (per
[[reference_supabase_functions_deploy_import_map_flag]]) — the warning is
ignorable, the flag is still honored.

Sanity-check all 5 deployed:

```bash
supabase functions list --project-ref ytnsipxxmzgaebkqmokp \
  | grep -E "helpdesk-(inbound|ai-assist|csat-send|sla-breach-cron|agent-reply-send)"
```

Expected: 5 rows.

---

## 4. End-to-end smoke (HUMAN-ONLY)

### 4a. External-mailbox send

From an external mailbox (e.g. `karsten.haldan@gmail.com`), send:

```
To:      support@app.leanshot.app
Subject: Phase 37 smoke test
Body:    this is a test
```

### 4b. Confirm ticket appears

Within 30 seconds, open:

```
https://app.leanshot.app/admin/helpdesk/inbox
```

Expected: new ticket with subject "Phase 37 smoke test", source=email,
user_id resolved to the matching profile (or created as a new user if the
sender's email is brand-new).

### 4c. Confirm AI suggestion populates

Click into the ticket. Within 60 seconds (Claude classify latency), the
AiSuggestionPane should show:

- Tags (likely `general`, `support`, or similar)
- Sentiment score (numeric -1..1)
- Draft reply (free-form text)

### 4d. Insert draft + send reply

Click "Insert draft into composer". Confirm composer populates with the
suggested text. Click Send.

### 4e. Confirm outbound reply lands

External mailbox should receive the reply within ~10s. Inspect headers:

```
Reply-To: reply+<token>@app.leanshot.app
```

The `<token>` is the HMAC over the ticket_id (Plan 37-04 schema). Save this
email — you need it for step 4f.

### 4f. Reply to the outbound reply (round-trip)

From the external mailbox, hit reply on the email from 4e and type
"follow-up question". Send.

Within 60 seconds, refresh the ticket detail page. Expected: a new user
message appended to the thread (via Resend Inbound → helpdesk-inbound
idempotent path).

### 4g. Close ticket → CSAT delivery

As agent in admin UI, click "Close ticket".

Within 30 seconds, external mailbox receives the CSAT survey email
(subject: "How did we do?" or similar).

### 4h. PHI smoke (clinical scope audit)

Promote the external test user to `clinician` role in a test org:

```bash
# Find the user_id by email
USER_ID=$(supabase db query --linked --json \
  "select id from auth.users where email='karsten.haldan@gmail.com'" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Find any test org
ORG_ID=$(supabase db query --linked --json \
  "select id from public.organizations limit 1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Insert clinician membership (idempotent)
supabase db query --linked \
  "insert into public.org_members (org_id, user_id, role) values ('$ORG_ID', '$USER_ID', 'clinician') on conflict (org_id, user_id) do update set role='clinician'"
```

Repeat steps 4a-4c with the clinician user. After the agent opens the
ticket in admin UI, verify:

```bash
supabase db query --linked \
  "select actor_user_id, accessed_user_id, reason, accessed_at from public.phi_access_log where reason ilike '%agent-inbox-open%' order by accessed_at desc limit 1"
```

Expected: one row with `reason='agent-inbox-open'`, an `accessed_user_id`
matching the clinician user, and an `actor_user_id` matching the agent.

### 4i. SLA breach smoke (manual back-date)

Back-date the smoke ticket so the breach scanner fires:

```bash
TICKET_ID=$(supabase db query --linked --json \
  "select id from public.tickets where subject ilike '%Phase 37 smoke%' order by created_at desc limit 1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

supabase db query --linked \
  "update public.tickets set created_at = now() - interval '5 hours' where id='$TICKET_ID' returning id, created_at"
```

Wait for the next 5-minute cron tick. The `sla_breach_alert` email should
arrive at `ops@leanshot.app` (or whoever is listed in
`SLA_BREACH_DEFAULT_ONCALL_EMAILS`).

Verify breach state landed:

```bash
supabase db query --linked \
  "select ticket_id, first_response_breach_at, resolution_breach_at, alert_sent_at from public.helpdesk_sla_breach_state where ticket_id='$TICKET_ID'"
```

Expected: at least `first_response_breach_at` populated and
`alert_sent_at` non-null.

### 4j. Wait for MX propagation OR proceed with partial PASS

If the MX records from Section 2 have NOT yet propagated, step 4a..4f
will fail (Resend won't accept the inbound; webhook never fires). In that
case mark 4a-4g as DEFERRED and re-run after propagation completes.

Sections 4h + 4i can proceed independently — they don't depend on MX.

---

## 5. Acceptance

All 5 sections pass → Phase 37 ships and v1.3 milestone closes.

Document any failures in:

```
leanshot/.planning/phases/37-m6-helpdesk-core/uat-failures.md
```

Include: which step failed, observed behavior, time of attempt, any error
messages from the Supabase logs panel.

---

## Appendix A — Pre-loaded resume-signal map

Plan 37-09 was executed under the multi-signal human-verify checkpoint
pattern (see [[feedback_multi_signal_human_verify_checkpoint_pattern]]).
The three discrete resume signals are:

| Signal | Description                            | CLI-runnable? | Section |
| ------ | -------------------------------------- | ------------- | ------- |
| A      | Function Secrets set (8 names present) | YES — Section 1 | 1c+1d |
| B      | Resend Inbound MX + webhook live       | NO — browser only | 2a-2h |
| C      | End-to-end smoke a-i passes            | mixed — emails are human; PHI/SLA assertions are CLI | 4a-4i |

Operator can approve A inline, defer B until DNS propagation finishes, and
defer C until B completes. Per the operator's standing
`auto-verify-only` disposition for HITL fixtures missing in v1.3 milestone
work, signals B + C may be carried over to v1.3 milestone close alongside
Phase 34-10 + Phase 38-08 deferred items.

---

## Appendix B — Quick-recovery commands

```bash
# Re-verify all Function Secrets at once
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp \
  | sort | uniq

# Re-verify all helpdesk Edge Fns are deployed
supabase functions list --project-ref ytnsipxxmzgaebkqmokp \
  | grep helpdesk-

# Run the RLS test suite locally (requires SUPABASE_URL +
# SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in env or .env.local)
cd leanshot && npm run test:e2e:rls -- --run --testNamePattern "RLS impersonation"

# Audit phi_access_log for recent reads
supabase db query --linked \
  "select reason, count(*) from public.phi_access_log where accessed_at > now() - interval '24 hours' group by 1 order by 2 desc"

# Audit SLA breach state for last 7 days
supabase db query --linked \
  "select alert_sent_at::date as day, count(*) from public.helpdesk_sla_breach_state where alert_sent_at > now() - interval '7 days' group by 1 order by 1 desc"
```
