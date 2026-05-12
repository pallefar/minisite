---
artifact: COMPL-03 — HBNR incident-response runbook
status: active
owner: founder (sole on-call for v1)
created: 2026-05-12
next_review_due: 2027-05-12
primary_source: 16 CFR Part 318 (Federal Register 2024-10855)
---

# FTC HBNR Incident-Response Runbook

**Purpose.** When (not if) LeanShot discovers a breach of security under the FTC's Health Breach Notification Rule (16 CFR Part 318, as amended effective 2024-07-29), this runbook is the authoritative procedure. The 60-day notification clock is unforgiving. Following this runbook is how a sole-founder operation hits the deadline. Per D-01 of Phase 7 (`.planning/phases/07-compliance-foundations-legal-counsel-led/07-CONTEXT.md`), no outside counsel is on retainer; the founder executes this runbook directly.

**When in doubt, notify.** The HBNR's expanded 2024 breach definition (Federal Register 2024-10855, https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule) includes unauthorized *disclosure*, not just unauthorized acquisition. If you are uncertain whether an event qualifies, default to notifying. Over-notification is an annoyance; under-notification is a federal enforcement action.

## Definitions

The following terms are operative throughout this runbook. Each cites 16 CFR Part 318 where applicable. Write down ambiguity at the moment of incident: every term below has a documented contour, and "we weren't sure what counted" is not a defense against the 60-day clock.

- **Breach of security** — unauthorized acquisition OR unauthorized disclosure of PHR identifiable health information held by a vendor of personal health records (16 CFR §318.2(a); 2024 amendment expanded the definition to explicitly include disclosure, not just acquisition). Acquisition means an unauthorized party obtains the data; disclosure means LeanShot itself releases the data to a party who is not authorized to receive it (e.g., a misconfigured API endpoint that returns another user's photos). Both trigger HBNR. The amended rule is explicit that voluntary, knowing, even well-intentioned disclosure to a party not authorized under the user's privacy choices counts — there is no "but we meant well" carve-out.

- **PHR identifiable health information** — identifiable health information about an individual, drawn from multiple sources, that LeanShot holds or processes. For LeanShot v1, this is the set of cloud-synced tables enumerated in Phase 7 D-04 (`07-CONTEXT.md` §Implementation Decisions): `injections`, `weights`, `meals`, `water`, `food_noise`, `workouts`, `steps`, `supplements`, `mood`, `sleep`, `nsvs`, `photos`, `vials`, `costs`, `symptoms`, `settings` — plus AI conversation history (`ai_messages` table). The annual review checks this list against `supabase/migrations/*.sql` to catch drift. If a new sync table is added between annual reviews, it MUST be added to this list in the same PR.

- **Secured vs unsecured PHR** — "secured" means encrypted per HHS guidance such that the data is unusable, unreadable, or indecipherable to unauthorized persons. Supabase Storage encryption-at-rest plus TLS-in-transit alone do NOT make data "secured" for HBNR purposes — Supabase holds the encryption keys co-resident with the data, so a Supabase-side breach exposes both. Treat all LeanShot PHR as **unsecured** unless and until the upgrade phase under `07-CONTEXT.md` D-02 ships envelope encryption with off-platform key custody. This is significant because HBNR's breach-notification obligation triggers on unsecured data; if a future upgrade phase elevates LeanShot to "secured" by HHS criteria, the breach notification obligation may not apply to bytes intercepted post-encryption (consult counsel before relying on this — see §Annual review).

- **500-record threshold** — breaches involving 500 or more individuals trigger contemporaneous FTC notification AND prominent media notice in the affected state(s); below 500, FTC is notified annually within 60 days of calendar year end (16 CFR §318.5(c)). The threshold is per-breach, not per-year — a single incident affecting 500 individuals crosses the line even if the year's running total is under 500. Count individuals affected, not records affected: if one user has 1,000 injection records exposed, that is 1 individual, not 1,000.

- **Discovery** — a breach is "discovered" the day LeanShot (i.e., the founder, an automated alert, or a third party reporting to support) first knows OR by exercising reasonable diligence would have known of the incident (16 CFR §318.4). The 60-day clock starts on the **calendar date of discovery**, not the date the breach occurred. "Reasonable diligence" is the trap: a Supabase audit-log anomaly that sat unread for two weeks does not delay discovery by two weeks — the FTC will argue discovery was when the log was generated. Daily review of breach-signal channels (Sentry, Supabase abuse flags, user reports) is the operational defense.

## 60-day notification clock

The 60-day clock is the load-bearing element of HBNR enforcement and the single most likely failure mode for a sole-founder operation. Internalize the rules below; do not improvise during an incident.

**Clock start (16 CFR §318.4):** the clock runs from the date of *discovery*, not occurrence. The instant the founder first knows of an incident — or first should have known via reasonable diligence — the 60-day timer is running. Document the discovery timestamp the moment it is known: a commit to this repo, a timestamped note in `.planning/decisions/`, or an entry in `.planning/incidents/YYYY-MM-DD-<slug>.md` is acceptable contemporaneous evidence. Email yourself the timestamp from a dated channel as belt-and-suspenders.

**Clock duration:** 60 calendar days. Not business days. Not weekdays. **60 calendar days** — include weekends and holidays. Federal holidays do not pause the clock. If the 60th day falls on a Sunday, the deadline is Sunday. Build buffer; do not rely on the deadline falling on a workday.

**What must happen by day 60:** (1) every affected individual receives written notice — first-class mail to last-known address, with electronic notice permitted post-2024 if the individual has affirmatively consented to electronic communications from LeanShot (sign-up acceptance of email-as-default is sufficient under the 2024 rule); (2) the FTC receives notice via the Notice of Breach of Health Information form linked in §Primary sources; (3) if ≥500 affected individuals reside in any one state, prominent media notice in that state's major media outlets is required. "Prominent" is judged against the breach's severity — for ≥500 individuals, a press release through a wire service plus targeted notice to that state's largest-circulation newspaper meets the bar.

**FTC notification URL (verified at runbook authoring):** https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0 — the "Notice of Breach" form is the official submission channel. If the URL is dead at incident time, search "FTC Notice of Breach of Health Information form" — do NOT skip notification because a URL changed. The annual review (§Annual review) verifies this URL still resolves.

**Day-by-day target cadence (suggested, not statutory):** D+0 contain the breach (rotate credentials, disable affected endpoint, lock down storage) → D+7 root-cause analysis complete, scope of affected individuals confirmed within ±10% → D+30 individual notices drafted and self-reviewed (or counsel-reviewed if D-01 has flipped per §On-call escalation) → D+45 individual notices sent → D+50 FTC form submitted → D+55 media notice dispatched if ≥500 individuals affected in any one state → D+60 hard deadline, all notifications dispatched. The cadence above is a planning aid: missing an intermediate target is not itself a violation, but it predicts missing the D+60 hard deadline.

**Documentation requirement.** Every step above must produce an artifact (timestamped note, sent-email confirmation, FTC submission receipt). Store them in `.planning/incidents/YYYY-MM-DD-<slug>/` — see §Post-incident review for the directory layout. Absence of contemporaneous evidence is materially worse than weak evidence; the founder must err toward over-documenting.

**Failure-mode reminders.** The two most common ways a sole-founder operation misses the 60-day clock are: (a) under-counting the affected population, which delays the ≥500-threshold determination and the contemporaneous-notice obligation; (b) treating the clock as starting at incident-confirmation rather than discovery, which silently burns 2–5 days while the founder validates the report. Both failures are mitigated by the §Breach decision tree rule "when in doubt, notify" and by the discovery-timestamp documentation step (D+0 of the cadence). If either failure mode is suspected during a review, escalate to outside counsel under the §On-call escalation §4 trigger — do not try to recover the timeline alone.

## Breach decision tree

The tree below is the operative classifier for any candidate incident. Walk it step by step; document the resolution of each branch in the incident folder. Resolution must be in writing, not just held in the founder's head.

1. **Is the event a "breach of security" under 16 CFR §318.2?**
   - Is PHR identifiable health information involved? (See §Definitions for what counts.) If **NO** → not in HBNR scope; document the rationale in `.planning/incidents/` and STOP. If **YES** → continue.
   - Was there unauthorized acquisition OR unauthorized disclosure? (Either branch independently triggers HBNR after the 2024 amendment.) If **NEITHER** → not a breach; document the rationale and STOP. If **EITHER** → continue.

2. **Severity matrix — how many individuals affected?**
   - **0 individuals confirmed, but credible exposure (e.g., publicly leaked credentials, an open S3 bucket that *might* have been crawled):** treat as breach. Notify all potentially-affected individuals. FTC annual roll-up.
   - **1–499 individuals:** individual notice within 60 days. FTC annual roll-up within 60 days of calendar year end (a separate batch submission via the same Notice of Breach form).
   - **≥500 individuals:** individual notice within 60 days AND contemporaneous FTC notice (not annual roll-up) AND prominent media notice in each affected state (where ≥500 of that state's residents are involved).

3. **Default to notify.** If branch resolution is ambiguous — borderline PHR classification, uncertain individual count, debatable "unauthorized" determination — treat as a notifiable breach. Document the rationale for the chosen branch in the incident's post-incident review (§Post-incident review). **When in doubt, notify.** This phrase is repeated intentionally — it is the operative principle when one person is making the call alone, without a peer to challenge the under-notify temptation.

## On-call escalation

LeanShot v1 operates with a degenerate escalation tree: there is one on-call (the founder) and no secondary. This section documents the v1 posture explicitly, including the bus-factor accepted-risk recorded in `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md`.

- **Primary on-call:** the founder. There is no secondary. This is the accepted bus-factor risk; the founder acknowledges it in `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md` and reviews the acceptance annually (§Annual review).

- **Escalation sequence (sole-founder degenerate case):**
  1. Founder validates the event meets the breach-of-security definition (§Definitions) and walks the §Breach decision tree.
  2. Founder creates `.planning/incidents/YYYY-MM-DD-<short-slug>.md` with the discovery timestamp pinned (UTC + local TZ; both are required so the clock is unambiguous across reviewers).
  3. Founder executes the D+0 → D+60 cadence from §60-day notification clock.
  4. **If accepted-risk D-01 (no counsel) flips during a real incident** — i.e., the breach is large, complex, or has litigation exposure that exceeds the founder's risk tolerance — engage outside counsel before day 60. Maintain a contact list (privacy-specialized attorney plus a state bar referral) in the founder's personal records, NOT in this repo. Storing counsel contact details in a public-by-design repo is itself a privacy concern.
  5. **Repo-access continuity (worst-case):** the founder maintains an out-of-band record (outside this repo) of how a designated contact would gain repo plus Supabase admin access if the founder is incapacitated during the 60-day window. This is operational hygiene rather than a Phase 7 deliverable — but its existence is documented here so a successor knows to look for it.

- **Out-of-hours posture:** the 60-day clock does not pause for weekends, holidays, or off-hours. The founder commits to checking for HBNR-trigger signals (Sentry alerts, Supabase abuse flags, user-reported support emails) at least once every 24 hours during normal operating periods. Sustained absence (vacation, illness) without an arranged check-in delegate is itself a deviation from this runbook and should be logged.

- **Channels monitored daily for breach signals:**
  - Sentry error stream — look for spikes in `auth.*` or `storage.*` error categories that suggest credential abuse or object-permission misconfiguration.
  - Supabase project dashboard — abuse flags, anomalous API key usage, RLS-policy denial spikes.
  - Support inbox — user reports of "I see someone else's data" or "my account was used by someone else" are P0 signals; treat as breach until proven otherwise.
  - GitHub — leaked-secret scanning alerts on the repo or any fork.
  - Vercel/CDN logs — unauthorized origins serving the SPA, anomalous traffic patterns.

## Post-incident review

Every incident — even non-notifiable ones — concludes with a written post-incident review. The template below is the required minimum. Save the review to `.planning/incidents/YYYY-MM-DD-<slug>.md` alongside any supporting artifacts (FTC submission receipts, individual notice templates, audit-log queries).

```
# Incident YYYY-MM-DD: <slug>

- **Discovery date:** YYYY-MM-DD HH:MM TZ (UTC + local)
- **Detection channel:** [Sentry | Supabase | user report | other]
- **Affected individuals (estimated):** N (synthetic example: `user-123@example.test` and N-1 others — NEVER list real emails)
- **PHR data categories involved:** [list — pull from §Definitions enumeration]
- **HBNR breach classification:** [breach / not a breach / ambiguous-treated-as-breach]
- **Notification path taken:** [<500 individual + FTC annual / ≥500 contemporaneous + media / not a breach]
- **Root cause:** [technical + process]
- **Audit-log forensic review:** [reference Phase 7 D-04 `audit_logs` query used + findings — synthetic user IDs only in this writeup]
- **Customer comms sent:** [date + summary; full text attached as `.planning/incidents/YYYY-MM-DD-<slug>-notice.md`]
- **Lessons + runbook updates:** [what changed in this runbook as a result]
```

Every post-incident review MUST conclude with either a `## Lessons` section that proposes runbook deltas, or an explicit "no runbook changes" line. The runbook is a living document; an incident that does not sharpen it has been under-analyzed. Synthetic placeholders (`user-123@example.test`, `<user_id>`) are mandatory throughout — never paste real user data into a post-incident review checked into this repo.

## Annual review

This runbook is reviewed every 12 months on or before the date in `next_review_due` in the frontmatter (currently 2027-05-12). The annual review checks the following items, in order:

1. **FTC URLs still resolve.** Open every URL in §Primary sources; for each dead link, locate the current canonical URL via FTC site-search and update inline.
2. **The 9 sync-table list in §Definitions still matches the codebase.** Run `grep -rn "create table" supabase/migrations/` (or the equivalent in the migrations source-of-truth at review time) and diff against the enumeration in §Definitions. Add any new tables that hold PHR identifiable health information.
3. **No statutory changes have occurred.** Skim the Federal Register entry for 16 CFR Part 318 for any amendments since the last review (https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule and any successor entries). If an amendment has shipped, schedule a runbook-update task in the next planning cycle and consult counsel if the amendment changes notification mechanics.
4. **Update `next_review_due`** in this file's frontmatter AND in `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md`'s frontmatter to today + 12 months.
5. **Append a row to the annual review log in `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md`** describing what was checked, what changed, and what (if anything) requires further investigation.

## Primary sources

- **16 CFR Part 318 — Federal Register entry (2024 amendments):** https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule
- **FTC press release (final rule, April 2024):** https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule
- **FTC compliance guidance plus Notice of Breach form:** https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0
- **Cornell LII mirror of 16 CFR Part 318 (durable backup):** https://www.law.cornell.edu/cfr/text/16/part-318
