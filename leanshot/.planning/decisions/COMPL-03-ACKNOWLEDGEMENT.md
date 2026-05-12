---
requirement: COMPL-03
status: acknowledged
owner: founder (sole on-call for v1 per `.planning/runbooks/hbnr-incident-response.md`)
acknowledged_date: 2026-05-12
next_review_due: 2027-05-12
runbook: ../runbooks/hbnr-incident-response.md
---

# COMPL-03 — FTC HBNR Compliance Acknowledgement

## What this file is

The Phase 7 ROADMAP requires COMPL-03 to ship before broad public launch. Per researcher Key Finding #6 (`.planning/phases/07-compliance-foundations-legal-counsel-led/07-RESEARCH.md` §4), **there is no FTC-managed "registration" process** for the Health Breach Notification Rule — the rule (16 CFR Part 318, as amended 2024-07-29) applies automatically to in-scope entities. LeanShot is in scope: it is a "vendor of personal health records" not covered by HIPAA, and the 2024 amendment explicitly extended the rule to "health apps and connected devices."

COMPL-03 therefore closes with two artifacts, not three:

1. **An internal incident-response runbook** at [`../runbooks/hbnr-incident-response.md`](../runbooks/hbnr-incident-response.md) (see runbook for incident procedure).
2. **This acknowledgement note** — the founder's documented commitment to operate under the rule.

There is no FTC confirmation number to record. The ROADMAP SC#3 wording has been corrected accordingly (see Task 4 of plan 07-05).

## Acknowledgement

I, the LeanShot founder (sole owner, sole on-call per Phase 7 D-01), acknowledge the following on 2026-05-12:

1. **LeanShot is in scope for 16 CFR Part 318** (FTC Health Breach Notification Rule, 2024 amendment effective 2024-07-29) as a "vendor of personal health records" not covered by HIPAA.
2. **The 60-day notification clock is real and starts at discovery.** If a breach of security (unauthorized acquisition OR unauthorized disclosure of PHR identifiable health information) is discovered, I will execute the procedure in [`../runbooks/hbnr-incident-response.md`](../runbooks/hbnr-incident-response.md) and notify affected individuals, the FTC, and (if ≥500 affected) the media within 60 calendar days of discovery.
3. **I am the sole on-call** for v1. This is an accepted bus-factor risk — explicitly recorded here so a future me, or a future incident reviewer, sees that this was a known tradeoff, not an oversight. Mitigation: I maintain (out of band, not in this repo) a continuity record describing how a designated contact would gain repo + Supabase admin access during the 60-day window if I were incapacitated.
4. **If a real incident exceeds my risk tolerance** (large scope, litigation exposure, ambiguous breach classification), I will engage privacy-specialized outside counsel before day 60 — even though Phase 7 D-01 explicitly accepts the no-counsel posture for routine compliance. Counsel engagement during an active incident is *operational triage*, not a retroactive invalidation of D-01.
5. **Annual review committed.** I will re-review the runbook on or before 2027-05-12 — verifying FTC URLs still resolve, the LeanShot data-category list in the runbook still matches the codebase, and skimming 16 CFR Part 318 for amendments. After each annual review I will update the `next_review_due` field in both this file's frontmatter and the runbook's frontmatter.
6. **No real user data goes in the runbook or this file.** Both artifacts live in a git repo intended to be public eventually; any examples are synthetic placeholders (`user-123@example.test`, `<user_id>`).

## Annual review log

- 2026-05-12 — Acknowledgement created. Next review: 2027-05-12.
- (Add a new row at each annual review.)

## Primary sources

- 16 CFR Part 318 (Federal Register 2024-10855): https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule
- FTC compliance guide + Notice of Breach form: https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0
- Runbook (incident procedure): [`../runbooks/hbnr-incident-response.md`](../runbooks/hbnr-incident-response.md)
