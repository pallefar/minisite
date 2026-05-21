---
phase: 35
plan: 10
title: Schema push + Edge Fn deploy + bundle audit + multi-signal HUMAN-UAT
status: checkpoint
checkpoint_type: human-verify
completed: 2026-05-21T13:26:00Z
duration_minutes: 17
tasks_completed: 3
tasks_total: 4
subsystem: gamification-deploy
tags:
  - gamification
  - deploy
  - bundle-audit
  - edge-functions
  - checkpoint

dependency_graph:
  requires:
    - 35-01 through 35-09 (all Phase 35 plans)
  provides:
    - live Phase 35 schema on remote
    - 4 Edge Fns deployed
    - operator handoff runbook + deploy notes
    - HUMAN-UAT checkpoint signals
  affects:
    - xp-event (remote deploy)
    - admin-grant-freeze-token (remote deploy)
    - challenge-evaluate-cron (remote deploy)
    - lifecycle-behavior-triggered (remote deploy)

tech_stack:
  added: []
  patterns:
    - supabase functions deploy --import-map (deprecated but honored per reference_supabase_functions_deploy_import_map_flag)
    - Deno test --allow-env --allow-net --allow-read (correct permission flags for gamification Fns)

key_files:
  created:
    - leanshot/.planning/phases/35-m3-gamification-engine/35-DEPLOY-NOTES.md
    - leanshot/.planning/phases/35-m3-gamification-engine/35-10-SUMMARY.md
  modified:
    - leanshot/.planning/STATE.md (orchestrator-updated)

decisions:
  - "pgTAP remote sweep: `supabase test db --linked --file` flag removed in CLI v2.101.0; correct syntax is path-as-positional-arg; pgTAP extension not enabled on remote = infrastructure gap; tests pass locally but cannot run against linked remote without pg_tap extension install"
  - "Deno sweep: --allow-env --allow-net --allow-read flags required (not documented in deno.json); all 19 tests pass with these flags"
  - "vault.share_token_secret: MISSING — operator MUST insert before OG share cards work; surfaced as Signal 1 in HUMAN-UAT"
  - "runbooks/leaderboard-cohort-criteria.md already existed (created by Wave 1 executor); content verified adequate — covers psychological-fit criteria, decision checklist, disable procedure, ethical guardrails"
  - "ROADMAP.md Phase 35 plan listing already present from earlier execution; no update needed"
---

# Phase 35 Plan 10: Schema push + Edge Fn deploy + bundle audit + multi-signal HUMAN-UAT — Summary

**One-liner:** 4 gamification Edge Fns deployed via supabase functions deploy, bundle audit passed (gamification-burst 1.76 kB gz), all 19 Deno tests + 49 Vitest unit tests green; operator HUMAN-UAT gated on vault secret insertion + Vercel env var + 3 social preview checks + notification copy review.

---

## Tasks Completed

| Task | Name | Commit | Files | Status |
|------|------|--------|-------|--------|
| 1 | DB push verifications (schema/cron/matview/badges/triggers) | (verification-only) | none | PASS |
| 2 | Edge Fn deploys + bundle audit + Deno sweep | (remote deploy) | none local | PASS |
| 3 | Runbook verification + DEPLOY-NOTES + ROADMAP check | chore commit | 35-DEPLOY-NOTES.md | PASS |
| 4 | HUMAN-UAT checkpoint (6 signals) | — | — | CHECKPOINT |

---

## Task 1: DB Push Verifications

**Migration pre-flight:** 22 migrations on disk (21 Phase 35 + 1 Phase 35 follow-up that was split). All file names pass regex `<14-digits>_name.sql`. No collision.

**Post-push verification results:**

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Phase 35 cron jobs | 4 | 4 | PASS |
| phase35-streak-evaluate-hourly | `5 * * * *` | `5 * * * *` | PASS |
| phase35-freeze-monthly-grant | `15 0 1 * *` | `15 0 1 * *` | PASS |
| phase35-leaderboard-refresh | `12,27,42,57 * * * *` | `12,27,42,57 * * * *` | PASS |
| phase35-challenge-evaluate-hourly | `22 * * * *` | `22 * * * *` | PASS |
| leaderboard_matview UNIQUE INDEX | `idx_leaderboard_matview_cohort_user` | present | PASS |
| weekly_challenges.status CHECK | 4 values | `draft`, `active`, `completed`, `archived` | PASS |
| badge_catalog count | 17 | 17 | PASS |
| vault.share_token_secret | PRESENT | **MISSING** | **ACTION REQUIRED** |
| vault.service_role_key | PRESENT | PRESENT | PASS |
| trg_p35_xp_on_injection | present | present | PASS |
| trg_p35_xp_on_weight | present | present | PASS |
| trg_p35_xp_on_symptom | present | present | PASS |
| trg_p35_xp_on_workout | present | present | PASS |
| trg_p35_combo_badge_check | present | present | PASS |
| Additional triggers (bonus) | — | trg_p35_challenge_progress_no_uncomplete, trg_p35_lb_prefs_monotonic | INFO |

**Vault gap:** `share_token_secret` is MISSING — this blocks OG share-card HMAC signing. Surfaced as Signal 1 in HUMAN-UAT.

---

## Task 2: Edge Fn Deploys + Bundle Audit + Test Sweeps

**Edge Function deploys:**

```
admin-grant-freeze-token  → deployed (script size: 1.185MB)
xp-event                  → deployed (script size: 1.185MB)
challenge-evaluate-cron   → deployed (script size: 839kB)
lifecycle-behavior-triggered → deployed (script size: 881.3kB)
```

All 4 deployed successfully. Note: `--import-map` flag deprecated (warning emitted) but honored per `reference_supabase_functions_deploy_import_map_flag` — deploy proceeded correctly.

**Bundle audit result:**

```
CHUNK                      CEILING_KB    ACTUAL_KB   STATUS
-----                      ----------    ---------   ------
gamification-burst                  8         1.76       OK
admin-shell                       130       124.46       OK
index                              50        24.47       OK
[other chunks...]                                        OK/MISSING

PASS: all chunks within gz ceilings.
```

gamification-burst chunk: **4.43 kB uncompressed / 1.76 kB gz** — 78% under the 8 kB gz ceiling.

**Deno test sweep (with --allow-env --allow-net --allow-read):**

```
admin-grant-freeze-token:     5 passed | 0 failed
xp-event:                     4 passed | 0 failed
challenge-evaluate-cron:      4 passed | 0 failed
lifecycle-behavior-triggered: 6 passed | 0 failed
Total:                       19 passed | 0 failed
```

**Vitest unit tests (gamification module):**

```
Test Files  3 passed (3)
Tests       49 passed (49)
Duration    762ms
```

Files covered: `xp.test.ts`, `handle-validate.test.ts`, `share-token.test.ts`

**pgTAP sweep:** SKIPPED — `supabase test db --linked` syntax changed in CLI v2.101.0 (`--file` flag removed); positional-arg syntax works but pgTAP extension not enabled on remote linked project → `plan(integer) does not exist` error. 9 test files exist in `supabase/tests/35_*.sql` but cannot run against remote without `pg_tap` extension. Documented as known infrastructure gap.

**Playwright deploy specs:** Skipped — `LEANSHOT_TEST_BASE_URL` not set (requires deployed preview URL + vault secret insertion first).

---

## Task 3: Runbook + DEPLOY-NOTES + ROADMAP

**`runbooks/leaderboard-cohort-criteria.md`:** Already existed (created by Wave 1 executor). Content verified adequate — covers psychological-fit criteria, 6-item decision checklist, disable procedure, ethical guardrails, references Phase 35 D-11/D-12/D-13/D-16 decisions.

**`35-DEPLOY-NOTES.md`:** Created at `/Users/karstenhaldan/minisite/leanshot/.planning/phases/35-m3-gamification-engine/35-DEPLOY-NOTES.md`. Contains: vault insert commands, Vercel CLI commands, social validator probe instructions, notification copy review, rollback procedure, emergency share-token rotation (REVIEW-F-6), verification summary table with live results.

**ROADMAP.md:** Phase 35 plan listing (10 plans) already present from orchestrator pre-work. No update needed.

---

## Deviations from Plan

### Auto-discovered Issues

**1. [Rule 1 - Bug/Deviation] pgTAP `--file` flag removed in CLI v2.101.0**
- **Found during:** Task 2 pgTAP sweep
- **Issue:** `supabase test db --linked --file <path>` errors "Unrecognized flag: --file in command supabase test db"; correct syntax is `supabase test db --linked <path>`
- **Fix:** Used positional arg syntax — but pgTAP extension not installed on remote; all 9 test files returned "function plan(integer) does not exist"
- **Disposition:** Cannot auto-fix (requires DBA to enable pg_tap extension on remote project). Skipped pgTAP sweep; documented as deferred.
- **Files modified:** None

**2. [Rule 1 - Bug/Deviation] Deno tests require explicit permission flags**
- **Found during:** Task 2 Deno sweep
- **Issue:** `deno test --no-check` fails with `NotCapable: Requires env access to "SUPABASE_URL"` and `NotCapable: Requires net access to "0.0.0.0:8000"` — the deno.json files in each function directory don't configure permissions
- **Fix:** Added `--allow-env --allow-net --allow-read` flags; all 19 tests pass
- **Files modified:** None (flags applied at invocation; deno.json update would be correct long-term fix — deferred to Phase 35 deferred-items)

**3. [Info] vault.share_token_secret MISSING**
- **Found during:** Task 1 vault verification
- **Issue:** Phase 35 deployment of `20270708000019_p35_share_token_secret.sql` creates the vault slot infrastructure but the actual secret value must be inserted by an operator with project-owner PAT (per REVIEW-B-3). The migration cannot insert a real HMAC key.
- **Fix:** Not auto-fixable — requires operator action. Surfaced as HUMAN-UAT Signal 1.
- **Files modified:** None

**4. [Info] runbooks/leaderboard-cohort-criteria.md pre-existed**
- **Found during:** Task 3 runbook step
- **Disposition:** Content verified adequate; no rewrite needed.

**5. [Info] ROADMAP plan listing pre-existed**
- **Found during:** Task 3 ROADMAP step
- **Disposition:** 10-plan listing already present; no update needed.

---

## Test Summary

| Suite | Result | Count |
|-------|--------|-------|
| Deno (4 Edge Fns) | GREEN | 19 tests |
| Vitest (gamification unit) | GREEN | 49 tests |
| pgTAP (Phase 35 SQL) | SKIPPED (pg_tap not installed on remote) | 9 files |
| Playwright (e2e) | SKIPPED (no LEANSHOT_TEST_BASE_URL) | 3 specs |

---

## Known Stubs

None — no stubs in created/modified files.

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: missing_secret | vault.share_token_secret | OG share card HMAC signing blocked until operator inserts secret; 30-day token TTL cannot be enforced without the secret |

---

## Self-Check

- [ ] `35-DEPLOY-NOTES.md` exists: /Users/karstenhaldan/minisite/leanshot/.planning/phases/35-m3-gamification-engine/35-DEPLOY-NOTES.md
- [ ] `35-10-SUMMARY.md` exists: /Users/karstenhaldan/minisite/leanshot/.planning/phases/35-m3-gamification-engine/35-10-SUMMARY.md
- [ ] `runbooks/leaderboard-cohort-criteria.md` exists: verified present
- [ ] ROADMAP.md Phase 35 lists 10 plans: verified present

## Self-Check: PASSED

---

## HUMAN-UAT Checkpoint — 6 Signals

### Signal 1 — Vault secrets (CLI)

**Status:** share_token_secret MISSING — operator must insert.

```bash
# Generate the secret:
openssl rand -hex 32

# Insert into vault via Supabase Dashboard → SQL Editor:
select vault.create_secret(
  '<output-of-openssl-above>',
  'share_token_secret',
  'Phase 35 share-token signing (HMAC-SHA256)'
);

# Verify both secrets present:
npx supabase db query --linked "select name from vault.secrets where name in ('share_token_secret', 'service_role_key') order by name;"
# Expected: 2 rows
```

Resume signal: `vault-ok`

### Signal 2 — Vercel env var (CLI)

```bash
cd /Users/karstenhaldan/minisite/leanshot
echo '<same-value-as-vault-share_token_secret>' | vercel env add SHARE_TOKEN_SECRET production
vercel env ls production | grep SHARE_TOKEN_SECRET
# Expected: 1 row
```

Resume signal: `vercel-env-ok`

### Signal 3 — Twitter Card Validator (browser)

- Mint sample share URL: log in as test user (level >= 5), click "Share level" in LevelUpBurst, copy share URL
- Visit https://cards-dev.twitter.com/validator — paste URL
- Expect: 1200x630 PNG card + title "Reached Level N on LeanShot" + summary_large_image type

Resume signal: `twitter-ok` or `twitter-defer`

### Signal 4 — LinkedIn Post Inspector (browser)

- Same URL as Signal 3
- Visit https://www.linkedin.com/post-inspector/ — paste URL
- Expect: image + title + description

Resume signal: `linkedin-ok` or `linkedin-defer`

### Signal 5 — Instagram DM preview (mobile device)

- iOS or Android with Instagram app
- DM → paste share URL → expect preview card renders

Resume signal: `instagram-ok` or `instagram-defer`

### Signal 6 — Notification copy review

Templates reviewed in `supabase/functions/lifecycle-behavior-triggered/templates.ts`:

- `streak_warn`: "You have time today to log something — your N-day streak is at stake." — FRIENDLY, no urgency, no FOMO
- `challenge_kickoff`: "This week's challenge is live." / uses admin-typed framing — NEUTRAL
- `challenge_nudge`: "You can still hit this week's challenge: <framing> (<progress>/<threshold> so far)." — SUPPORTIVE, not nagging

Pre-assessment: templates appear to pass D-09 ethical-only review. No "URGENT", "BREAKING", "LAST CHANCE", "DON'T LOSE" language found. Operator should confirm.

Resume signal: `copy-ok` or `copy-needs-revision: <specific concern>`

### Composite Approval Options

- `approved` = all 6 ok (full sign-off)
- `approved — auto-verify-only` = signals 1, 2, 6 ok + signals 3-5 deferred to staging close
- `approved — deploy-only` = signals 1, 2 ok + 3-6 deferred
- `blocked: <reason>` = halt close-out; surface to executor
