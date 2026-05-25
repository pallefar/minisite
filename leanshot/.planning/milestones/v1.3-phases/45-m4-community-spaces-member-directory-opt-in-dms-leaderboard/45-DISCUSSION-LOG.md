# Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents. Decisions are in 45-CONTEXT.md.

**Date:** 2026-05-23
**Phase:** 45-M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard
**Areas discussed:** Directory profile + admin scoping, DMs (opt-in + rate + body + abuse), Leaderboard (score + period + scope + tier visibility), Realtime + notifications for DMs

---

## Directory Profile + Admin Scoping

### Q1: Profile card badges (multiSelect)

| Option | Selected |
|--------|----------|
| Tier badge (Free/Pro/Lifetime) | ✓ |
| Level badge (Phase 35 XP) | ✓ |
| Verified-clinician badge (admin-set) | ✓ |
| Streak badge (current streak length) | ✓ |

**Notes:** All 4 enabled. Tier + streak get per-user hide toggle (`profiles.show_tier_badge` + `profiles.show_streak_badge`). Verified-clinician is admin-set, no self-claim. Level badge auto-hides for Phase 35 leaderboard opt-OUTs.

### Q2: Default directory visibility

| Option | Selected |
|--------|----------|
| Two-mode: community-wide for consumer; org-only for clinic-org | ✓ |
| Per-user opt-IN to appear | |
| Always community-wide for everyone | |

**Notes:** Two-mode chosen for Phase 28 cross-tenant strictness. PLUS per-user opt-IN via `profiles.directory_opt_in default false` — user must explicitly enable in Settings before card renders.

### Q3: Directory search shape

| Option | Selected |
|--------|----------|
| Handle prefix + tier filter (no bio FTS) | ✓ |
| Postgres FTS over bio + handle + tier filter | |
| Pagination only, no search | |

**Notes:** Phase 49 owns FTS infrastructure; v1 ships handle prefix only. Forward-compatible.

---

## DMs — Opt-in Default + Rate + Body + Abuse

### Q1: Per-user DM-toggle default

| Option | Selected |
|--------|----------|
| Closed by default (opt-IN to receive) | |
| Open by default (opt-OUT to close) | ✓ |
| Open for Pro/Lifetime; closed for Free | |

**Notes:** OPEN by default maximizes community-building; harassment vector closed by rate limit (3/24h) + block + report combo.

### Q2: Rate limit

| Option | Selected |
|--------|----------|
| 3 new threads per 24h per user | ✓ |
| 10 new threads per 24h per user | |
| 5 new threads per 24h + verified-clinician bypass | |

**Notes:** Operator picked 3 strict + verified-clinician bypass added per D-08 (combining option 1's tightness with option 3's clinician carve-out).

### Q3: DM body shape

| Option | Selected |
|--------|----------|
| Plain text only, 2000-char cap | |
| Markdown subset + 2000-char cap | |
| Markdown subset + image attachments (1 per DM, 5MB) | ✓ |

**Notes:** Reuses Phase 44 dompurify config + signed-URL pattern. New `dm-attachments` Storage bucket mirrors `community-media` RLS shape.

### Q4: Block + report flow

| Option | Selected |
|--------|----------|
| Block (full) + report queue table (Phase 48 consumes) | ✓ |
| Block only — defer report entirely | |
| Block + report → immediate email to admin@leanshot.app | |

**Notes:** `community_reports` queue table + admin daily digest as a bridge so reports aren't invisible until Phase 48 ships.

---

## Leaderboard — Score + Period + Scope + Tier Visibility

### Q1: Score formula

| Option | Selected |
|--------|----------|
| posts × 3 + comments × 1 + reactions_received × 1 | ✓ |
| posts × 5 + comments × 2 + reactions_received × 1 + mentions_received × 2 | |
| Pure reactions_received | |
| posts × 3 + comments × 1 + reactions × 1 + edit-penalty | |

**Notes:** Simple. Posts weighted highest (creation cost). No mentions weight. No edit-penalty (YAGNI).

### Q2: Period

| Option | Selected |
|--------|----------|
| Rolling 7d (matches Phase 35 exactly) | ✓ |
| Calendar month (resets 1st 00:00 UTC) | |
| Both — weekly tab + monthly tab | |

**Notes:** Operator picked Rolling 7d for Phase 35 alignment. **Deviation flag:** ROADMAP success criterion #3 literally says "per month"; interpreting as display granularity (which 7d-rolling continuous refresh satisfies), not calendar-month window. Plan-checker may flag — operator overrides.

### Q3: Scope

| Option | Selected |
|--------|----------|
| Per-space only (admin flag) | ✓ |
| Per-space + per-org cross-space | |

**Notes:** `community_spaces.leaderboard_enabled` mirrors Phase 35 D-11 `cohort_definitions.leaderboard_enabled`. Admin curates psychological-fit.

### Q4: Tier visibility

| Option | Selected |
|--------|----------|
| Mirrors space tier-gating (Free sees only accessible spaces' leaderboards) | ✓ |
| All tiers see all leaderboards (read-only) | |

**Notes:** Consistent with Phase 44 D-08. Locked-card UX for inaccessible leaderboards.

---

## Realtime + Notifications for DMs

### Q1: DM Realtime delivery shape

| Option | Selected |
|--------|----------|
| Per-user inbox channel (filter recipient_user_id=eq.$me) | ✓ |
| Per-thread channel (subscribe only when open) | |
| Per-user inbox + per-thread nested | |

**Notes:** O(N) channels. Lifecycle tied to session. No nested per-thread.

### Q2: In-app notification

| Option | Selected |
|--------|----------|
| Toast + unread-count badge in nav | ✓ |
| Badge only (no toast) | |

**Notes:** Toast persists 5s with "Open" CTA when user is NOT on `/community/dm`. Respects `prefers-reduced-motion`.

### Q3: Email cadence

| Option | Selected |
|--------|----------|
| Single email per new DM, 5-min activity debounce | ✓ |
| Daily digest 9am user-TZ | |
| No email (in-app + push only) | |
| First-DM-of-thread immediate + daily digest for replies | |

**Notes:** Debounce skips email if user has posted/reacted/read in app within last 5 min — toast handles it.

### Q4: Push notification

| Option | Selected |
|--------|----------|
| Yes — web push for opted-in users | ✓ |
| No push in v1 | |

**Notes:** Reuses Phase 42 PWA push infrastructure. Same 5-min debounce as email. Body shows sender handle + first 80 chars (sanitized).

---

## Claude's Discretion

- Leaderboard handle column reuse from Phase 35 (`profiles.leaderboard_handle`) — researcher confirms existence.
- Streak badge data source column from Phase 35.
- DM attachment MIME guard constants reuse from `src/lib/community/community-storage.ts`.
- ROADMAP "per month" → Rolling 7d interpretation (D-13).

## Deferred Ideas

- FTS bio search (Phase 49)
- Per-org cross-space leaderboards
- Group DMs / channels
- Voice / video DMs
- Calendar-month leaderboard period
- DM message reactions
- DM message edit / delete
- Phase 39 paywall-variant routing on locked-leaderboard CTA
- Moderation queue UI (Phase 48 owns)
