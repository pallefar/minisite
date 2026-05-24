---
phase: 46-m4-courses-classroom
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra mutations deferred
---

# Phase 46 — Carry-Over

Phase 46 shipped 10/11 plans (46-01..46-10) via worktree-executor dispatch + 46-11 partial close-out (Task 1 verify + Task 4 metadata only; Tasks 2-3 deferred per operator decision 2026-05-24).

Pattern: `feedback_autonomous_false_close_out_partial_execution` + `feedback_milestone_uat_deferral_consolidation`.

## Migration push verification matrix

| Plan | Migration files | db push status |
|------|-----------------|----------------|
| 46-01 | 20270725000001 (schema), 20270725000002 (rls), 20270725000003 (secdef_rpcs), 20270725000003a (test-fixture — SILENTLY SKIPPED by CLI per memory `reference_supabase_migration_filename_regex`) | **pending** |
| 46-02 | 20270725000004 (certificates_bucket), 20270725000005 (course_resources_bucket) | **pending** |
| 46-08 | 20270725000006 (course_lessons.resources column — Rule 2 auto-add) | **pending** |

Total: **6 migrations pending push** (+ 1 test fixture deliberately skipped). All real-migration filenames pass strict 14-digit regex.

**Operator note on letter-suffix fixture:** `20270725000003a_p46_course_secdef_rpcs_test.sql` exploits CLI silent-skip as a test-fixture-not-migration mechanism (per 46-01 SUMMARY). Future cleanup: relocate to `supabase/tests/` for clarity. Not blocking for v1.3.

## Edge Fn deploy status

**Critical ordering** (per memory `feedback_fn_deploy_before_cron_db_push` + 46-05 SUMMARY pair-deploy warning):

1. **Phase 46 has NO cron migrations** (lesson progress is client-driven, not scheduled) — no Fn-deploy-before-db-push ordering needed for Phase 46 standalone.
2. **mux-create-upload + mux-webhook MUST deploy as a PAIR** — partial deploy causes silent UPDATE-wrong-table because the passthrough envelope shape diverges between Phase 44 + Phase 46 versions.

| Fn | Status | Notes |
|----|--------|-------|
| mux-sign-playback | **pending deploy** | NEW. Needs `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` Function Secrets. |
| lesson-progress-beacon | **pending deploy** | NEW. No new secrets (uses SUPABASE_SERVICE_ROLE_KEY). |
| generate-course-certificate | **pending deploy** | NEW. Needs `CERT_VERIFICATION_SECRET=$(openssl rand -hex 32)`. |
| mux-create-upload | **pending redeploy** | EXTENDED for course-lesson kind. Deploy PAIR with mux-webhook. |
| mux-webhook | **pending redeploy** | EXTENDED for course-lesson dispatch. Deploy PAIR with mux-create-upload. |

Operator commands:
```bash
cd /Users/karstenhaldan/minisite/supabase

# Set 3 NEW Function Secrets first
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  MUX_SIGNING_KEY_ID="<from Mux dashboard>" \
  MUX_SIGNING_KEY_PRIVATE="<from Mux dashboard>" \
  CERT_VERIFICATION_SECRET="$(openssl rand -hex 32)"

# Deploy 5 Fns (mux pair atomically — by hand or scripted; avoid partial)
supabase functions deploy mux-sign-playback
supabase functions deploy lesson-progress-beacon
supabase functions deploy generate-course-certificate
supabase functions deploy mux-create-upload     # PAIR
supabase functions deploy mux-webhook            # PAIR

# THEN push migrations
supabase db push --linked
```

## Vendor secret pre-flight status

Phase 46 introduces **3 new Function Secrets**:

| Secret | Status | Action |
|--------|--------|--------|
| MUX_SIGNING_KEY_ID | **NOT SET** | From Mux dashboard → Settings → Signing Keys → generate keypair. KEEP key ID public-half. |
| MUX_SIGNING_KEY_PRIVATE | **NOT SET** | Private-half of the signing keypair. NEVER browser-exposed. |
| CERT_VERIFICATION_SECRET | **NOT SET** | Random 32-byte hex: `openssl rand -hex 32`. Used by generate-course-certificate Fn for HMAC; NEVER browser-exposed (46-10 chose path (b) — browser fetches stored verification_token via RLS instead). |

Existing-inherited secrets (already-set, no action):
- MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_WEBHOOK_SECRET (Phase 44 — note: PHASE 44 SECRETS MAY ALSO NEED SETTING per earlier session note. If `npx supabase secrets list` shows them missing, set BEFORE deploying mux-* Fns.)
- SUPABASE_SERVICE_ROLE_KEY (sb_secret_*)

## HUMAN-UAT signal status — ALL DEFERRED to v1.3 milestone UAT

6 discrete signals defined in plan 46-11 Task 3. All deferred 2026-05-24:

| Signal | REQ-ID | Status | Defer reason |
|--------|--------|--------|--------------|
| 1: Admin uploads test-lesson.mp4 → Mux transcodes → ready | COURSE-02 | **deferred** | Needs Fn pair deploy + Mux secrets + live admin session |
| 2: Consumer plays lesson with signed-playback JWT | COURSE-02 | **deferred** | Needs MUX_SIGNING_KEY_* + db push + live tier-active user |
| 3: Anti-skip ≥95% gate (onTimeUpdate + complete_lesson) | COURSE-03 | **deferred** | Needs Fn deploy + live video viewer ≥15 min |
| 4: Lesson resource download (Pro-gated) | COURSE-06 | **deferred** | Needs db push + course-resources bucket live + Pro-tier user |
| 5: Certificate PDF generation + signed URL fetch | COURSE-04 | **deferred** | Needs Fn deploy + CERT_VERIFICATION_SECRET + 100%-complete course |
| 6: Public /verify/<cert_id> end-to-end | COURSE-04 | **deferred** | Needs Signal 5 to land first + browser-side `?t=` parity check |

Disposition: all 6 signals exercised at v1.3 milestone UAT walkthrough (consolidated with Phase 32 + Phase 45 + Phase 48 deferred HITL gates).

## Pre-flight verification PASS (operator may skip Task 1 at re-attempt)

| Check | Result | Evidence |
|-------|--------|----------|
| Cross-Fn Deno test sweep | **37/37 pass** | `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net --allow-read supabase/functions/{mux-sign-playback,lesson-progress-beacon,generate-course-certificate}/` |
| tsc clean | **exit 0** | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` |
| 6 real migrations + 1 test fixture present, valid 14-digit regex | **PASS** | `ls supabase/migrations/20270725*_p46_*.sql` |
| HMAC cross-runtime parity vector LOCKED | **PASS** | 46-07 SUMMARY: literal token `VkvWn-pOnuE3pmNb1Y2LyBFhcZmO9gehMViOvszVwsw` verified Deno + Node + browser-side parity |

## Known residuals / accepted

- **`leanshot/vitest.config.ts` projects-config drift** — under Vitest 4.x, projects block masks default test config (per memory `reference_vitest_4_projects_config_masks_default`). Continues to affect `npm run test:unit` for new SPA tests. Full fix deferred to future tooling plan.
- **`@sentry/capacitor` sibling check** — `--ignore-scripts` workaround used in 5+ Phase 46 worktree executors. Per memory `reference_sentry_capacitor_npm_install_blocker`. Project-level fix tracked separately.
- **Letter-suffix test-fixture pattern** — 46-01 ships `20270725000003a_*.sql` deliberately exploiting CLI silent-skip. Future cleanup: relocate to `supabase/tests/`.
- **PHASE 44 mux secrets may also be unset** — earlier session note found NO `MUX_*` in Function Secrets. Verify before deploying mux-create-upload + mux-webhook pair; Phase 44 may also need its `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` / `MUX_WEBHOOK_SECRET` set.

## Re-attempt close-out (operator)

When ready:
1. Set 3 NEW + possibly 3 Phase-44 inherited Function Secrets.
2. Deploy 5 Edge Fns (mux pair atomically; cert-generate; lesson-beacon; mux-sign-playback).
3. `supabase db push --linked` (6 real migrations transactional per file; 1 fixture silently skipped).
4. Walk 6 HUMAN-UAT signals per Plan 46-11 Task 3 script.
5. Flip CARRY-OVER status → "complete (UAT validated)" if all signals pass.
