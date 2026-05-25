---
phase: 48-m4-moderation
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra mutations deferred
---

# Phase 48 — Carry-Over

Phase 48 shipped 11/12 plans (48-01..48-11) via worktree-executor dispatch. Plan 48-12 close-out was partially executed: pre-flight verifications PASS, but Task 2 (live infra mutations) + Task 3 (4 HUMAN-UAT signals) were deferred per operator decision 2026-05-24 (vendor secrets not yet set; operator-time pressure).

Pattern applied: `feedback_milestone_uat_deferral_consolidation` — phase marked complete on "approved automated-verify-only" disposition; HUMAN-UAT signals roll into milestone UAT.

## Migration push verification matrix

Per memory `feedback_phase_close_out_db_push_verification` — phases with carry-overs leak un-pushed migrations when no plan owns the push step. This matrix records what NEEDS pushing at milestone close.

| Plan | Migration files | db push status |
|------|-----------------|----------------|
| 48-01 | 20270901000001_p48_community_reports_extend.sql | **pending** |
| 48-02 | 20270901000002, 20270901000003, 20270901000004 | **pending** |
| 48-03 | 20270901000005, 20270901000006, 20270901000007 | **pending** |
| 48-04 | 20270901000008, 20270901000009 | **pending** |
| 48-05 | 20270901000010, 20270901000011, 20270901000012 | **pending** |
| 48-06 | 20270901000013, 20270901000014, 20270901000015 | **pending** |
| 48-09 | 20270901000018 (revoke_user_sessions SECDEF RPC) | **pending** |
| 48-10 | 20270901000016 | **pending** |

Total: **17 migrations pending push** (16 baseline + 1 SECDEF RPC at 000018). All filenames pass strict 14-digit regex. Operator command:
```bash
cd /Users/karstenhaldan/minisite/supabase && supabase db push --linked
```
**Order constraint** (per memory `feedback_fn_deploy_before_cron_db_push`): deploy Edge Fns FIRST. Trigger `20270901000014_p48_auto_flag_trigger.sql` fires `pg_net.http_post` to `claude-moderation` on every global-org post/comment INSERT/UPDATE — unprepared db push = flood of 404 pg_net responses.

## Edge Fn deploy status

| Fn | Status | Notes |
|----|--------|-------|
| claude-moderation | **pending deploy** | NEW. Needs ANTHROPIC_API_KEY + AI_GATEWAY_BASE_URL Function Secrets set BEFORE deploy. |
| banned-words-sweep | **pending deploy** | NEW. Needs MODERATION_HMAC_SECRET. |
| ban-enforcement | **pending deploy** | NEW. Uses service-role; no new Function Secret. |
| audit-archive | **pending redeploy** | EXTEND — moderation_audit_log added to TABLES_TO_ARCHIVE registry (Plan 48-04). |

Operator command (per memory `reference_supabase_functions_deploy_no_linked_flag` — omit `--linked`):
```bash
cd /Users/karstenhaldan/minisite/supabase
supabase functions deploy claude-moderation
supabase functions deploy banned-words-sweep
supabase functions deploy ban-enforcement
supabase functions deploy audit-archive
```

## Vendor secret pre-flight status

| Secret | Current status | Action |
|--------|---------------|--------|
| ANTHROPIC_API_KEY | **NOT SET** | Required for `claude-moderation` Fn. `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp ANTHROPIC_API_KEY=sk-ant-...` |
| AI_GATEWAY_BASE_URL | **NOT SET** | Optional; Fn falls back to `https://api.anthropic.com` if unset (auto-fix shipped in 48-07). Set to gateway URL for cost routing. |
| SUPABASE_SERVICE_ROLE_KEY | present (sb_secret_* format) | OK |
| MODERATION_HMAC_SECRET | **NOT SET** | NEW for Phase 48. `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp MODERATION_HMAC_SECRET=$(openssl rand -hex 32)` |

## HUMAN-UAT signal status — ALL DEFERRED to milestone UAT

Per memory `feedback_multi_signal_human_verify_checkpoint_pattern` — 4 discrete signals were planned (one per MOD-NN requirement). All deferred 2026-05-24 because:
1. Vendor secrets not set (signals 1 + 4 require live API + email roundtrip)
2. No live test-org fixtures locally (signal 3 requires Org-A + Org-B + impersonation JWT)
3. Operator-time pressure on multi-hour browser walkthrough

| Signal | MOD-XX | Status | Defer reason |
|--------|--------|--------|--------------|
| 1: Anthropic structured-output auto-flag live | MOD-04 | **deferred** | ANTHROPIC_API_KEY not set; needs live API roundtrip |
| 2: Ban session-revoke + AccountSuspended | MOD-02 | **deferred** | Needs Fn deploy + db push + 2 browser sessions; operator-time |
| 3: Cross-org RLS isolation proof | MOD-01 (D-04) | **deferred** | No live test-org fixtures (Org-A + Org-B + 2 support_admin users) |
| 4: Banned-word escalate email | MOD-03 | **deferred** | Needs MODERATION_HMAC_SECRET + db push + ~30s email roundtrip |

Disposition: all 4 signals to be exercised at v1.3 milestone UAT walkthrough (consolidated with Phase 32 contractor delivery + other deferred HITL gates).

## Pre-flight verification PASS (operator may skip Task 1 at re-attempt)

| Check | Result | Evidence |
|-------|--------|----------|
| Cross-Fn Deno test sweep | **21/21 pass** | `deno test --no-check --allow-env --allow-net --allow-read supabase/functions/{claude-moderation,banned-words-sweep,ban-enforcement}/` |
| tsc clean | **exit 0** | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` |
| Bundle gate (admin-moderation) | **6843 bytes gz / 30720 ceiling** | `bash scripts/assert-moderation-bundle-budget.sh` |
| 17 migration files, valid regex | **PASS** | `ls supabase/migrations/20270901*_p48_*.sql \| wc -l` = 17 |
| Build | **succeeded** | `npm run build` |
| Vitest full suite | **deferred** | vitest.config.ts projects block masks default test config under Vitest 4.x — workaround `--config vite.config.ts` needed; per-Fn tests verified above. See Plan 48-11 SUMMARY "Deferred Issues". |

## Known residuals / accepted

- **Residual JWT window (~1h) after ban-enforcement** — documented per RESEARCH Pitfall 1. Refresh tokens revoked; current access JWT remains valid until exp. `<AccountSuspended/>` blocker (Plan 48-11) + RLS write-deny (Plan 48-06) are durable mitigations. Accepted per CONTEXT D-15.
- **A10 spike outcome:** service-role CAN DML `auth.sessions` (verified 2026-05-23). If future Supabase platform restricts, fallback to Auth Admin REST `/auth/v1/admin/users/:id/logout` per RESEARCH Pitfall 1.
- **48-04 list_user_moderation_roster RPC** — auto-added (Rule 2) by 48-10 executor inside migration 20270901000016 because PostgREST cannot reach `auth.users` directly and `profiles.email` does not exist (per memory `reference_profiles_email_vs_auth_users_email`). is_staff()-gated SECDEF.
- **Vitest config drift** — `leanshot/vitest.config.ts` `projects:` block masks default test config under Vitest 4.x. Per-test workaround works; full fix deferred to future tooling plan.

## Re-attempt close-out (operator)

When ready:
1. Set 3 missing Function Secrets (commands above).
2. Deploy 4 Edge Fns (commands above).
3. `supabase db push --linked` (single command — 17 migrations transactional per file).
4. Walk 4 HUMAN-UAT signals per Plan 48-12 Task 3 script.
5. Flip CARRY-OVER status → "complete (UAT validated)" if all signals pass.
