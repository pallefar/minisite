# Phase 7: Compliance Foundations (Legal-Counsel-Led) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 07-compliance-foundations-legal-counsel-led
**Areas discussed:** Legal counsel engagement, HIPAA BAA / Storage tier, Account-delete UX + safety, Scope of deferred Phase 6 items

---

## Legal counsel engagement

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated privacy attorney engagement | Hire/engage a privacy attorney to draft + review the three policies before launch. Highest quality + defensibility; 4-8 week timeline; $5-15k. Matches user's prior aggressive-foundations preference. | |
| Template service + attorney review | Use Termly / iubenda / similar to generate first drafts, then ~2-4 hrs attorney review for ~$500-2k. 2-4 week timeline. | |
| Self-draft from templates only | OSS template + Termly free tier, no attorney touch. Fastest (1 week) + cheapest, but WMHMDA private right of action carries real litigation risk. | ✓ |
| Don't know yet — figure out in Phase 7 | Treat counsel-selection as a Wave 0 task. | |

**User's choice:** Self-draft from templates only
**Notes:** Surprising relative to the documented aggressive-foundations preference. The pattern that emerged across all four areas in this session: the user invests aggressively where USER trust is on the line (delete, audit log) and trims aggressively where the audience is regulator (counsel, Storage tier). WMHMDA litigation risk explicitly accepted; if it bites, a Phase 7.5 hardening cycle (not a retroactive Phase 7 reopen) handles it.

---

## HIPAA BAA / Storage tier

| Option | Description | Selected |
|--------|-------------|----------|
| Stay free-tier + data-min posture | Keep free-tier Storage. Treat data minimization + visible disclaimer as the HIPAA boundary. No BAA. Photos stay in Storage with RLS + signed URLs. | |
| Upgrade to Team-tier for BAA | $599/mo to unlock BAA-eligible Storage. | |
| Stay free-tier now, plan upgrade trigger | Free-tier now; record an explicit trigger that auto-bumps to Team-tier. | ✓ |
| Move photos off Supabase entirely | Self-host photos on R2/B2 with our own crypto-shred. | |

**User's choice:** Stay free-tier now, plan upgrade trigger
**Notes:** Trigger sub-question asked → "Hybrid: B2B contract OR incident, whichever first" selected. Recorded in CONTEXT.md D-02. Planner is NOT building the upgrade path inside Phase 7 — only the trigger documentation.

### Sub-question: Upgrade trigger

| Option | Description | Selected |
|--------|-------------|----------|
| First B2B clinic contract | Phase 9-10 lands a clinic with PHI handling expectations → upgrade BEFORE the contract goes live. | |
| First incident OR counsel recommendation | Reactive: an actual security incident, breach near-miss, or future counsel review flags the gap. | |
| Specific patient count threshold | e.g., 1000 paying patients, or 10k MAU. Needs a metric pipeline. | |
| Hybrid: B2B contract OR incident, whichever first | The two most operationally meaningful triggers, OR'd. | ✓ |

**User's choice:** Hybrid: B2B contract OR incident, whichever first

---

## Account-delete UX + safety

| Option | Description | Selected |
|--------|-------------|----------|
| Nothing survives | Hard-delete everything including all audit-log rows referencing the user. The only trace is an anonymized counter increment. | |
| Audit-log skeleton survives, photos+rows die | Hard-delete user data + photos + backup. KEEP an audit-log row (timestamp, action=account_deleted, user_id_hash). | |
| Soft-delete with 30-day crypto-shred | Mark account deleted, photos crypto-locked, key destroyed at 30d. Undo window. GDPR-RTBF compliant. | |
| Soft-delete 30d + audit-skeleton retained | Combines undo window + audit skeleton survives forever. Highest complexity; fullest defensibility. | ✓ |

**User's choice:** Soft-delete 30d + audit-skeleton retained
**Notes:** Highest-complexity option. Consistent with the "invest where users see it" pattern — the 30-day window is the trust signal users will read about in the privacy policy. CONTEXT.md D-03 captures the full state machine (T+0 → T+30d → forever-skeleton).

---

## Scope of deferred Phase 6 items

| Option | Description | Selected |
|--------|-------------|----------|
| Audit log — full cloud-writes scope | Beyond just account-delete: log ALL cloud writes (every sync table) for breach-tracking + 'what was overwritten?' recovery. | ✓ |
| Restore-from-backup UI | Surface the 90-day `leanshot_v4_pre_cloud_backup` in Settings. Lets users undo a bad migration. | ✓ |
| Codebase-wide `s.user!` audit | Sweep all non-null assertions on `s.user`. Phase 6 folded only `MedLevelChart.tsx:13`. | ✓ |
| Re-enable 7 deferred e2e specs | Fix the 7 SC-verification specs marked `test.fixme` per deferred-tests.md. | ✓ |

**User's choice:** All four folded in. (multiSelect)
**Notes:** Aggressive-foundations preference re-asserted at the user-facing/test-coverage layer. Phase 7 scope is now substantially larger than the four COMPL requirements alone — planner should expect 8+ plans. The 7 deferred e2e specs become 07-01 (first plan), because every subsequent legal-pages-deploy needs CI green.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` §Claude's Discretion:
- Specific template vendor for D-01 (Termly free / iubenda / OSS / hand-rolled — planner picks, ≥2 sources cross-referenced)
- Audit-log storage shape (single table vs per-table — planner researches Postgres CDC + Supabase patterns)
- Footer wiring (legal pages as SPA routes vs static MD via Vercel)
- Cron mechanism for T+30d shred (pg_cron vs edge fn vs Vercel cron)
- User copy + UX for "same email signs up during pending shred" edge case

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`:
- HIPAA Team-tier BAA upgrade (D-02 trigger fires → separate phase)
- Attorney review of self-drafted policies (Phase 7.5 if needed)
- GDPR-compliant data-portability format (FHIR, vCard) — v2 concern
- Audit-log UI for end-users — v2; v1 ships the data, not a viewer
- Per-user envelope encryption for photos — re-evaluate if/when D-02 trigger fires
