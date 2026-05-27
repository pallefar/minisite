---
artifact: OPS-08 — on-call rotation runbook
status: active
owner: founder
created: 2026-05-27
next_review_due: 2026-08-27  # quarterly review while single-person rotation
phase: 67-operational-runbooks-observability
limitation: single-person rotation until backup contact added
---

# On-Call Rotation Runbook

> **v1.4 launch reality.** This is a single-person rotation (founder). The procedures below assume that, document the limitations, and define the trigger conditions for adding a backup contact.

**Primary on-call:** Founder (`karsten.haldan@gmail.com`)
**Backup contact:** _(unassigned at launch — see "Adding a Backup" section below)_
**Tooling:** Better Stack on-call (built-in feature, included on paid plan)
**Status page:** Better Stack status page (https://status.leanshot.com — pending DNS)

---

## TL;DR

| Question | Answer |
|----------|--------|
| Who's on-call right now? | Founder (always, until backup added) |
| How are pages delivered? | Better Stack → SMS + iOS push to founder phone + email |
| What's the P1 response SLA? | 30 minutes, 24/7 |
| What if founder is unreachable? | **Currently unmitigated.** See "Single-Person Risk" below. |
| When do I add a backup contact? | First of: (a) MAU >500, (b) revenue >$5k/mo, (c) any P1 takes >2h to ack |

---

## Schedule

**Rotation:** None (single-person).
**On-call hours:** 24/7 effectively, but with reduced expectations off-hours per SLA below.

| Period | Cover | Expectation |
|--------|-------|-------------|
| Mon-Fri 09:00–18:00 founder local time | Founder | All severities; P1 within 30 min, P2 within 4h |
| Mon-Fri 18:00–09:00 + all weekend | Founder | P1 only within 30 min; P2/P3/P4 deferred to next business day |
| Holidays (founder OOO) | Founder (still primary) | P1 attempt within 2h; backup escalation = unmitigated risk |

**No formal vacation cover yet.** Plan vacations as:
- Pre-vacation: enable maintenance-mode banner on status page noting reduced response.
- During vacation: founder still receives pages but with explicit "no SLA" comms.
- Post-vacation: catch up on any P3/P4 backlog.

> **HIPAA implications.** §164.308(a)(6) "security incident procedures" requires response capability — being on a beach for 2 weeks with no backup is a documented gap. Document mitigations + monitoring period in `ops_audit_log` before vacation.

---

## Escalation Tree

```
P1 detected
   │
   ▼
Better Stack auto-page → founder phone (SMS + push) + email
   │
   ▼
Acknowledged within 15 min? ──── YES ──► Founder works the incident
   │
   NO
   │
   ▼
Better Stack re-page (every 5 min, up to 3 attempts)
   │
   ▼
All re-pages unack'd after 30 min? ──── YES ──► **CURRENTLY UNMITIGATED**
   │                                              (no backup contact configured)
   │                                              Manual escalation path:
   │                                              - Better Stack auto-posts to status page
   │                                              - Status page subscribers (users) see incident
   │                                              - No human triage until founder available
   │
   ▼ (after backup contact added)
   Better Stack escalates to backup
```

### Future-state escalation (post-backup-added)

```
Founder unack 30min → Backup (SMS + email)
Backup unack 30min  → Status-page auto-incident + Slack `#incidents` @channel
```

---

## Hours & SLA

| Severity | Ack SLA (24/7) | Resolve SLA (business hours) | Resolve SLA (off-hours) |
|----------|---------------|-----------------------------|------------------------|
| P1 | 30 min | 4h | Best-effort same-night |
| P2 | 4h (business) / 8h (off-hours) | 1 business day | Next business day |
| P3 | Next business day | 3 business days | Next sprint |
| P4 | 1 business week | Backlog | Backlog |

Definitions in `incident-response.md`.

---

## Tooling

### Better Stack On-Call (primary)

**Setup.**
1. Better Stack Dashboard → On-call → Schedules → "Create schedule".
2. **Schedule name**: `LeanShot Primary`.
3. **Rotation pattern**: Daily, no rotation (single user).
4. **Primary user**: Founder (configured at https://uptime.betterstack.com/team/members).
5. **Contact methods**: SMS + iOS push + email (in priority order).
6. **Re-page interval**: 5 min, 3 attempts.
7. **Escalation policy**: `LeanShot P1` policy → Primary schedule → (future) Backup schedule → Status-page auto-incident.

**Linking monitors to escalation.**
- Open each Better Stack monitor → Settings → Escalation policy → select `LeanShot P1`.
- Currently monitored: `https://leanshot.com/` (200 OK), `…/api/healthz`, ~6 high-traffic Edge Fns.

**Status:** Configured at Phase 41 + 70 (per `[[reference_v1_4_phase_restructure]]`).

### PagerDuty (deferred)

- Considered for v1.5 if Better Stack on-call proves insufficient.
- Decision criteria: ≥3 on-call rotation members OR existing PagerDuty contract via clinic B2B partner.

### Calendar (manual cover)

- Google Calendar `leanshot-oncall@` (single-event "Founder OOO" entries).
- Calendar URL embedded in this doc once shared (pending — operator action at Phase 70).

---

## Per-Incident Operator Procedure

When you receive a page:

1. **Acknowledge in Better Stack** (mobile or web). Stops re-page loop.
2. **Open `#incidents` Slack channel** on phone or laptop. Post:
   ```
   :wave: On-call ack — investigating. ETA next update: <15min from now>
   ```
3. **Open `incident-response.md`** — follow severity-triage flow.
4. **Communicate every 30 min** until resolved or downgrade in severity.
5. **Resolution comms**:
   - Update Better Stack status page (Mark resolved).
   - Slack: "Resolved. Postmortem coming within 5 business days."
6. **Postmortem** within 5 business days (template in `incident-response.md`).

---

## Handoff Procedure (future-state, when backup exists)

> Currently N/A — single-person rotation. Documented here for forward-readiness.

**Daily handoff (during multi-person rotation):**
1. **Outgoing on-call** posts in `#oncall-handoff` Slack:
   - Any open P3+ incidents (link + status).
   - Anything weird seen in metrics last 24h.
   - Anything scheduled (deploys, migrations, vendor maintenance).
   - "Handing to <next person> at <time>".
2. **Incoming on-call** acks in same thread.
3. Daily window: 09:00 founder-local time.

**Weekly handoff (if rotation is weekly):**
- Same as daily PLUS:
- Recap of incidents in past 7 days.
- Action items from any postmortems still open.
- Pending vendor changes (Stripe webhook URL change, Supabase plan upgrade, etc.).

---

## Single-Person Risk Acknowledgment

> **This is the explicit limitation.** v1.4 launches with a single-person on-call rotation. Document mitigations and exit criteria.

### What can go wrong

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Founder unreachable during P1 (asleep, traveling, sick) | Medium-high | P1 SLA breach; potential PHI breach window | Better Stack re-pages + status-page auto-incident + monitoring runbook |
| Founder burnout from 24/7 page risk | High over time | Cascading slow responses + product velocity hit | Add backup ASAP (see triggers) |
| Founder loses phone | Low | All pages missed until secondary device | Configure email channel + Slack-on-laptop as backup |
| Single point of failure for security incident response | Inherent | HIPAA §164.308 gap | Documented gap; mitigate by adding backup |

### Exit criteria — when to add a backup

Add backup contact when **any** of:
- [ ] MAU exceeds 500 (per PostHog)
- [ ] Monthly recurring revenue exceeds $5,000 (per Stripe)
- [ ] Any P1 incident takes >2h to acknowledge
- [ ] Founder schedules >7 consecutive days of OOO
- [ ] Clinic B2B partner asks (compliance procurement)
- [ ] 12 months elapsed since launch (annual review trigger)

### Adding a Backup Contact

1. **Pick the backup**. Criteria:
   - Available on phone within 30 min, 24/7 (or has co-coverage).
   - Has Better Stack login + Supabase Studio access (read-only OK initially).
   - Knows the basics of `incident-response.md` + `backup-restore.md`.
   - Has signed BAA if accessing PHI per HIPAA.
2. **Provision**:
   - Better Stack → Members → add user with on-call permissions.
   - Supabase Studio → Settings → Team → invite as `Developer` role.
   - Vercel → Project → Settings → Team → invite as `Member`.
   - GitHub → Settings → Collaborators → invite as `Triage`.
3. **Configure rotation**:
   - Better Stack → Schedules → `LeanShot Primary` → add second user → set rotation (weekly recommended).
   - Update this runbook: change "Primary" → list both; update Schedule section.
4. **Onboarding**:
   - Walk through `incident-response.md` end-to-end.
   - Walk through `backup-restore.md` end-to-end (no live restore — read-only).
   - Walk through `secrets-rotation.md` — backup needs to KNOW where secrets live, not necessarily rotate them.
   - Schedule a synthetic-page drill within 30 days of onboarding.
5. **Document**: update this runbook + commit. Audit-log the addition.

---

## Compensation / Burn-out Mitigation (founder)

> Single-person rotation only. Document for self-discipline.

- **Do NOT acknowledge non-P1 pages outside business hours.** Better Stack: scope each monitor's escalation policy to P1-only.
- **Take vacation.** Use the maintenance-mode banner; accept reduced SLA explicitly.
- **Track on-call hours** in `ops_audit_log` (event=`oncall_active_minutes`). Aim to keep <40h/month of active-incident time.
- **If pages exceed 3/week sustained for 4+ weeks**: that's the "MAU>500 / revenue>$5k / pages>3/wk" exit criteria firing — add the backup.

---

## Tooling Cheatsheet

```bash
# Confirm Better Stack escalation reachability (synthetic page)
curl -X POST "https://uptime.betterstack.com/api/v2/incidents" \
     -H "Authorization: Bearer $BETTER_STACK_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"summary":"Synthetic on-call test","severity":"low","escalation_policy_id":"<id>"}'
# Expect page within 60s. Resolve immediately to avoid spam.

# Update status-page maintenance banner (vacation cover)
curl -X PATCH "https://uptime.betterstack.com/api/v2/status-pages/<id>" \
     -H "Authorization: Bearer $BETTER_STACK_TOKEN" \
     -d '{"announcement":"Limited support 2026-06-15 to 2026-06-22. P1-only response."}'

# Audit-log an OOO window
psql "$SUPABASE_DB_URL" -c "INSERT INTO ops_audit_log (event, ts, actor, notes) VALUES ('oncall_ooo_start', now(), 'karsten.haldan@gmail.com', 'Vacation 2026-06-15 to 2026-06-22; reduced SLA');"
```

---

## Open Items (track until closed)

- [ ] Status-page DNS — point status.leanshot.com to Better Stack (Phase 70 operator action)
- [ ] Backup contact — find + onboard before MAU 500 (currently unmitigated)
- [ ] Annual synthetic-page drill — schedule Q3
- [ ] PagerDuty migration evaluation — Q1 2027 review
- [ ] Vacation cover policy — write once backup exists

---

## Lessons learned

- `[[feedback_aggressive_foundations]]` — on infra/foundation phases, default to max-coverage. But for on-call: explicit "single-person + documented gap" beats "pretend we have rotation we don't".
- `[[feedback_regulator_vs_user_audience_pattern]]` — this doc's audience is regulator-leaning (HIPAA §164.308); trim aggressively but DOCUMENT the gaps rather than over-investing in fake rotation.
