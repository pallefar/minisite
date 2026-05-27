---
artifact: OPS-06 — incident response runbook
status: active
owner: founder
created: 2026-05-27
next_review_due: 2027-05-27
phase: 67-operational-runbooks-observability
companion: hbnr-incident-response.md (HIPAA-specific breach flow)
---

# Incident Response Runbook

> **Companion doc:** `hbnr-incident-response.md` covers HIPAA Breach Notification Rule §164.404 specifics.
> **This doc** is the general incident-response process (P1-P4 triage, detection, rollback, comms).
> Use BOTH when an incident touches PHI.

**Project ref:** `ytnsipxxmzgaebkqmokp`
**Operator:** Founder (single-person on-call until backup added — see `on-call-rotation.md`).
**Status page:** Better Stack (https://status.leanshot.com — confirm domain at provisioning).

---

## TL;DR — When you suspect an incident

1. **Confirm**: not a flake — see "Detection Signals" below.
2. **Triage severity**: P1-P4 (table below).
3. **Stabilize first, root-cause later**: rollback or feature-flag-off before forensics.
4. **Communicate**: status page within 10 min for P1/P2.
5. **Document**: incident log entry inside `ops_audit_log` + Slack `#incidents`.
6. **Postmortem**: blameless, within 5 business days.

---

## Severity Levels

| Severity | Definition | Examples | First-response SLA |
|----------|-----------|----------|--------------------|
| **P1** | Site fully down / user data exposed / payment processing broken / regulator-reportable | Supabase outage, Stripe webhook silent for >5min, PHI exposed in public, auth bypassed | **30 min** (24/7) |
| **P2** | Single critical feature broken; impacts >10% of users | Sign-in broken, dose-log fails, AI coach 100% errors, sync broken | **4h** business hours (8h after-hours) |
| **P3** | Degraded UX; impacts <10% of users or has workaround | Slow loads, AI rate-limited, single Edge Fn 5xx, charts mis-rendering | **Next business day** |
| **P4** | Non-customer-facing | Admin tool broken, internal alert flooded, log noise | **Within 1 week** |

**Escalation matrix.**
- P1 → page founder immediately (Better Stack auto-page); if no ack in 15 min, page backup contact.
- P2 → Slack `@here` in `#incidents`; founder reviews within SLA.
- P3 → Slack note; triaged at next standup.
- P4 → GitHub issue.

---

## Detection Signals

| Signal | Source | Severity guidance | Auto-page? |
|--------|--------|-------------------|------------|
| Sentry error rate >100/min sustained 2+ min | Sentry | P1 | Yes (Better Stack rule) |
| Sentry error rate >10/min sustained 5+ min | Sentry | P2 | Yes |
| Supabase status: any service degraded | https://status.supabase.com | P1 if DB / auth; P2 if storage | Yes (`bs-status-poller` Fn) |
| Stripe webhook delivery failure rate >5% in 1h | Stripe Dashboard → Webhooks | P1 | Manual review (no auto-page yet) |
| Vercel deployment failed | Vercel Dashboard | P2 | Slack via `_shared/slack-alert.ts` |
| Edge Fn 5xx rate >2% sustained 5min | PostHog `fn_5xx_rate` insight | P2 | PostHog Alert → Slack |
| PostHog activation-funnel WoW drop >20% | PostHog funnel-alert seeder | P3 → P2 escalate if 2 weeks running | PostHog → Slack |
| Better Stack uptime check fails 2 consecutive | Better Stack | P1 if `/` or `/api/healthz`; P2 if Edge Fn | Yes |
| HIPAA-relevant data access anomaly (admin reads >100 users in <5min) | `audit_log_anomaly_cron` | P1 | Yes (escalate to security review) |
| Slack guardrail message arrives | Supabase Function Secret webhook | Context-dependent — read the message | Yes (already routed to Slack) |
| User-reported "site down" via support@ | Resend inbound / Calendly | P1 until confirmed otherwise | Manual |

---

## Log Locations (where to look)

| Source | URL / Path | What it shows | Retention |
|--------|------------|---------------|-----------|
| **Sentry** | https://sentry.io/organizations/<org>/issues/?project=leanshot | Client + Edge Fn exceptions, stack traces, breadcrumbs | 90 days |
| **Supabase Edge Fn logs** | Studio → Functions → `<fn-name>` → Logs | Per-Fn request logs, console output, latency | 7 days (free), 30 days (Pro) |
| **Supabase Postgres logs** | Studio → Logs → Postgres | Query errors, RLS denials, slow queries | 7 days (free), 30 days (Pro) |
| **Supabase Auth logs** | Studio → Logs → Auth | Sign-in/up events, magic-link issuance, OAuth | 30 days |
| **Vercel deployments** | vercel.com/<team>/leanshot/deployments | Build logs, runtime logs (serverless funcs) | 1 hour runtime / 30 days build (Hobby), 7 days runtime / 90 days build (Pro) |
| **Vercel analytics** | vercel.com/<team>/leanshot/analytics | TTFB, error rate per route | Pro plan only |
| **Better Stack** | bettstack.com/team/<team>/monitoring | Uptime checks, incident timeline, status page edits | 1 year |
| **PostHog** | app.posthog.com → Activity → Events | Funnel + retention + per-event drill-down | 1 year |
| **PostHog Session Replays** | app.posthog.com → Replays | Watch user-facing failure context | 30 days (free) |
| **Stripe Events** | https://dashboard.stripe.com/events | All API + webhook events with full payload | Forever |
| **`ops_audit_log` table** | Postgres `public.ops_audit_log` | All operator/incident actions (rotations, restores, escalations) | Forever |

---

## Stabilization Playbooks

### Playbook 1: Edge Fn rollback

**When.** Single Edge Fn 5xx rate elevated; recent deploy correlates.

1. Identify last-known-good commit:
   ```bash
   git log --oneline -- leanshot/supabase/functions/<fn>/
   ```
2. Hot-revert just that Fn:
   ```bash
   git checkout <good-sha> -- leanshot/supabase/functions/<fn>/
   npx supabase functions deploy <fn> --project-ref ytnsipxxmzgaebkqmokp
   ```
3. Verify 5xx rate drops in PostHog (`fn_5xx_rate` insight) within 5 min.
4. Restore working tree (`git checkout HEAD -- leanshot/supabase/functions/<fn>/`) and open a proper revert PR for trunk.

> **Tag-based deploy is DEFERRED** (v1.5). For v1.4 launch the manual `git checkout` flow above is the procedure.

### Playbook 2: Vercel deployment rollback

**When.** SPA broken / build regression / wrong env var pushed.

1. Vercel Dashboard → Project → Deployments → identify last-known-good production deploy (green checkmark).
2. Click `...` → "Promote to Production". Effective in ~30 seconds.
3. Confirm via `curl https://leanshot.com -I` (expect 200 + correct `x-vercel-id`).
4. Open a fix-forward PR on trunk; do NOT leave production on a stale deploy >7 days.

### Playbook 3: Database rollback (PITR)

**When.** Bad migration shipped / mass data corruption / accidental DELETE.

1. **STOP**: Do NOT run `npx supabase db reset --linked` on prod — wipes everything.
2. Open `backup-restore.md` → "PITR Restore" section.
3. Acknowledge that PITR overwrites the live DB — you will lose any writes between target timestamp and now. P1 by definition.

### Playbook 4: Feature-flag kill switch

**When.** A specific feature is causing the incident but rolling back the whole deploy is overkill.

1. Find the feature flag in PostHog → Feature Flags.
2. Flip the flag's "Active" toggle off. Effective within 10s for clients hitting the bootstrap endpoint; up to 5 min for stale-cached sessions.
3. For Edge-Fn-side flags, the Fn reads PostHog at request-time (`_shared/posthog-flag.ts`) — same TTL.

### Playbook 5: Mass logout (suspected session compromise)

**When.** JWT signing key leaked / suspected mass token theft.

1. `npx supabase secrets set SUPABASE_JWT_SECRET="<new>" --project-ref ytnsipxxmzgaebkqmokp` (rotates signing key — ALL existing JWTs invalidated immediately).
2. Force logout via SECDEF RPC (see `[[reference_supabase_auth_admin_signout_takes_jwt]]`):
   ```sql
   SELECT public.ops_force_logout_all();  -- DELETEs auth.sessions + auth.refresh_tokens
   ```
3. Inform users via email blast (Resend) + status page banner.
4. Cleanup in `secrets-rotation.md` flow (vendor-secrets.md updates).

### Playbook 6: Stripe webhook backlog

**When.** `stripe-webhook` returned 5xx for an extended window; Stripe queued retries pile up.

1. Confirm in Stripe Dashboard → Developers → Webhooks → your endpoint → recent attempts.
2. Once `stripe-webhook` healthy: Stripe auto-redelivers per its exponential backoff (up to 3 days).
3. Force-replay specific events: Stripe Dashboard → Events → click event → "Resend".
4. Reconcile via `scripts/stripe/reconcile-subscriptions.ts` (run after window stabilizes).

---

## Status Page Updates (Better Stack)

**P1/P2 timeline:**
- T+0 to T+10min: Acknowledge incident (don't publish yet — confirm scope).
- T+10min: Publish initial status update. Template:
  > "We're investigating reports of [symptom]. [Affected area]. We'll update within 30 minutes."
- T+30min, T+1h, T+2h: Updates with new info; if no new info, post anyway with "still investigating".
- T+resolved: Final update + post-incident link (once postmortem is up).

**Template lives at:** Better Stack → Status Page → Templates → "Standard Incident".

---

## HIPAA Breach Notification Trigger

> Full procedure in `hbnr-incident-response.md`. Summary here.

**Trigger criteria** (any of):
- Unauthorized PHI access (e.g. RLS bypassed, admin tool exposed user data to another user)
- Lost device with cached PHI
- Stolen / leaked secret with PHI access (Supabase service role, DB password)
- PHI sent to wrong recipient (email mis-routed)

**60-day clock starts on date of DISCOVERY** (not date of incident).

Per HIPAA Breach Notification Rule §164.404:
- **Notify affected individuals within 60 days** (by mail, with all required content)
- **Notify HHS Office for Civil Rights within 60 days** (if ≥500 affected) — annually if <500
- **Notify prominent media** within 60 days if breach affects >500 residents of a state/jurisdiction
- **Maintain log of all breaches** (regardless of size) for 6 years

**Risk assessment exception** (§164.402): can avoid notification IF you can demonstrate "low probability of compromise" via 4-factor assessment. Document the assessment in `ops_audit_log` either way.

---

## Communication Templates

### Internal Slack `#incidents`
```
:rotating_light: P1 INCIDENT
Symptom: <user-visible symptom>
Detected: <ISO timestamp>
Detector: <person|system>
Severity: P1
Investigator: <name>
Status: investigating | mitigating | resolved
Next update: <ISO timestamp>
```

### Public status page (P1)
> We're investigating reports of [symptom]. Our team is actively working on it. Next update in 30 minutes.

### Customer email (post-resolution, if user-data-affecting)
Required content per HIPAA §164.404(c):
- Brief description of what happened
- Description of types of unsecured PHI involved
- Steps individuals should take to protect themselves
- Brief description of what we are doing
- Contact procedures (phone, email, postal address, website)

---

## Post-Incident

1. **Blameless postmortem** within 5 business days. Template at `.planning/templates/postmortem-template.md` (deferred — for v1.4 use this 6-section structure):
   - Summary (1 paragraph)
   - Timeline (UTC)
   - Root cause analysis (5 whys minimum)
   - What went well
   - What went poorly
   - Action items (with owners + dates)
2. Add detection signal to this runbook if novel.
3. Update PostHog funnel alert thresholds if related.
4. File action items as GitHub issues with `incident-followup` label.
5. Append entry to `ops_audit_log`:
   ```sql
   INSERT INTO ops_audit_log (event, severity, ts, notes, postmortem_url)
   VALUES ('incident_resolved', 'P1', now(), '<summary>', '<link>');
   ```

---

## Tooling Cheatsheet

```bash
# Sentry trigger test
curl -X POST https://leanshot.com/api/healthz?force-error=1

# Better Stack force re-check (requires Better Stack API token)
curl -X POST https://uptime.betterstack.com/api/v2/monitors/<id>/check \
     -H "Authorization: Bearer $BETTER_STACK_TOKEN"

# Slack incident channel ping (manual)
curl -X POST "$SLACK_GUARDRAIL_WEBHOOK_URL" \
     -H "Content-Type: application/json" \
     -d '{"text":":rotating_light: P1: manual page from incident-response.md"}'

# PostHog query 5xx rate last 15min
curl -G "https://us.posthog.com/api/projects/<id>/insights/trend/" \
     -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
     --data-urlencode "events=[{\"id\":\"fn_5xx\",\"math\":\"total\"}]" \
     --data-urlencode "date_from=-15m"

# Force JWT signing-key rotation (mass logout)
npx supabase secrets set SUPABASE_JWT_SECRET="$(openssl rand -hex 32)" \
    --project-ref ytnsipxxmzgaebkqmokp
```

---

## Lessons learned (operator-applied)

- `[[feedback_fn_deploy_before_cron_db_push]]` — when restoring, redeploy Fns BEFORE pushing migrations that re-enable cron schedules.
- `[[feedback_placeholder_string_runtime_guard_pattern]]` — placeholder strings (`TODO`, `REPLACE_ME`) in production code path must trip 503 + Slack P1; never silently no-op.
- `[[feedback_state_counter_table_needs_upsert_on_event]]` — incident-counter tables need UPSERT not bare UPDATE to fire alerts.
