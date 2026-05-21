# Leaderboard Cohort Criteria

**Phase 35 D-11 — Admin ethical responsibility runbook**

This runbook documents the criteria for enabling leaderboards on cohorts via the
Admin > Gamification > Leaderboards panel.

## Who this applies to

Support leads and superadmins with access to the Leaderboard enable/disable toggle
in `/admin/gamification`.

## Core principle

Leaderboards are an **opt-IN, admin-curated feature**. We only enable leaderboards
for cohorts where the competitive framing is likely to be **motivating, not harmful**.
The admin bears ethical responsibility for this judgment call (LeanShot D-11).

## Cohorts that are good candidates for leaderboards

Enable leaderboards when the cohort has:

- **Strong psychological fit** — users are stable, experienced, and unlikely to be
  destabilized by seeing others' progress
- **Long treatment duration** — e.g., "GLP-1 Veterans 6mo+" (users past the initial
  adjustment period)
- **Voluntary, informed participation** — users opted into leaderboard displays
  (via Settings > Leaderboards) after seeing the cohort-specific nudge
- **Experienced user base** — users who have demonstrated consistent logging behavior
  over multiple weeks (not first-timers)

## Cohorts that must NOT have leaderboards enabled

Do not enable leaderboards for cohorts that include:

- **Newly-diagnosed users** — competitive ranking during the adjustment period
  can cause anxiety, shame, or harmful behavior changes
- **Vulnerable populations** — any cohort with significant representation of users
  flagged for mental health concerns, eating-disorder history, or extreme weight
  pressure contexts
- **Early-engagement cohorts** — users in their first 4-6 weeks of treatment
  (adjustment period; erratic data is normal and ranking would be misleading)
- **Crisis-adjacent cohorts** — any cohort where weight loss pressure is clinically
  contraindicated for a significant portion of members

## Decision checklist (run before enabling)

Before enabling a leaderboard for a cohort, confirm ALL of the following:

- [ ] Cohort definition explicitly includes duration filter (e.g., `signup_date < 6 months ago`)
- [ ] No significant representation of newly-diagnosed members in the cohort
- [ ] Cohort has at least 10 opted-in members (leaderboard is meaningless below threshold)
- [ ] Reviewed cohort name and definition with clinical lead (if cohort is clinician-managed)
- [ ] Checked that rank score uses 7-day rolling XP (not all-time) — prevents early-joiner domination

## Disabling leaderboards

If user feedback or clinical concerns surface after enabling:

1. Toggle leaderboard_enabled = false in the admin panel
2. Users see "You're no longer on this leaderboard" on next 15-min matview refresh
3. Document reason in the support ticket or internal Slack thread
4. Consider narrowing the cohort definition to exclude the problematic segment

## Ethical guardrails (non-negotiable)

- Leaderboards show **user-chosen anonymous handles only** — never real names
- Users can **opt out instantly** via Settings > Leaderboards
- Opt-out propagates within **15 minutes** (next matview refresh)
- Score = **7-day rolling XP** (not all-time) — recency-weighted to prevent entrenched rankings
- **One opt-in nudge only** — never re-surfaces after user dismisses

## References

- Phase 35 D-11/D-12/D-13/D-16 — Leaderboard scope + opt-in policy decisions
- Phase 35 CONTEXT.md §"Leaderboard Scope + Opt-In Policy (privacy-default)"
- LeanShot ethical-only positioning: no dark patterns, no FOMO escalation
