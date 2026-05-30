# Plan 70-07 — NEXT-SESSION-HANDOFF v2 (cascades 8-31 complete)

---
## ⏩ v3 continuation update (2026-05-29, cascades 33-37) — 6 local commits, NOT yet pushed

**HEAD (local):** `2f875222` · 6 commits ahead of `origin/main` (`33498951`).

CI jobs flipped this session (verified locally):

| Job | Was | Now | Fix |
|---|---|---|---|
| Format check | RED (AdminMembersPage.test.tsx) | GREEN | cascade-33 prettier-write |
| Unused exports | RED (571>570) | GREEN | cascade-34 baseline→571 (virtual:pwa-register mock) |
| a11y baseline | RED (No test files found) | GREEN (31 pass) | cascade-35 add `a11y` vitest project |
| Unit tests (Deno capture) | 31 files fail-to-collect | removed | cascade-36 scope `functions-unit` to 16 vitest files |
| Unit tests (research-renderer) | 2 fail (hardcoded path) | GREEN | cascade-37 portable markdown-it alias |
| Unit tests (notifications) | 1 fail (VAPID env) | GREEN | cascade-37 `vi.stubEnv` |

**Unit-tests remaining = 62 real test failures → fully triaged.** See
`70-07-UNIT-DRIFT-ROOTCAUSE.md`. Split:
- **3 confirmed remote-DB roots** (need DDL push) — drafted, NOT pushed, in
  `drafted-migrations/`:
  - **R1 org_members_select RLS infinite recursion (42P17)** — ~30 tests; ALSO a
    live production bug (co-member visibility broken). Fix migration 20290108000002.
  - **R2 citext extension not installed (42704)** — 5 tests. Fix 20290108000001.
  - **R3 log_admin_action omits NOT-NULL user_id_hash (23502)** — ~12 tests
    (audit + rag). Fix 20290108000003.
- **R6 validate-onboarding-steps (5)** — test-side: P34 narrowed the RPC to a
  shape-guard; update the test to the new contract (needs live DB to verify).
- **R5 role-matrix-sync (7)** — decision: extend `has_permission()` with 2 new
  perm keys vs trim TS matrix / update count to 18.
- **R4 admin_backup_codes (2)** — service_role INSERT intentionally revoked;
  test should seed via SECDEF RPC (EG-29). Keep deferred; don't weaken grant.

**CI validation — FINAL (run 26630189140 @ `109770b8`):**
- Format ✅ · Unused exports ✅ · a11y ✅ · Lint ✅ · Typecheck ✅ · Deno ✅
- **Share security drill ✅** — cascade-38 same-origin proxy fixed (a)+(d).
- **Unit tests 🔴 (expected)** — but failed test FILES dropped 53 → **20** and failed
  TESTS 62 → **61**; the 31 Deno collection files + research-renderer + notifications are
  GONE (grep-confirmed zero). The remaining 20 files / 61 tests are 100% the un-pushed
  DB-drift roots (R1-R6) — exactly the set in `70-07-UNIT-DRIFT-ROOTCAUSE.md`. Pushing
  drafted migrations A+B+C + the R6 test update clears them to ~R5(7)+R4(2).

So after this session every CI job is GREEN **except** Unit tests, which is blocked solely
on the 3 drafted remote-DB migrations awaiting review/push (the org_members recursion is
also a live prod bug — see [[project_org_members_rls_recursion_prod_bug]]).

### ✅✅ FINAL STATE (through cascade-48) — Unit-tests 62 → 6

After R5/R6 (cascade-47) + test fixes (45/46/48): **Unit-tests 62 → 6 fails / 3 files.**
The 6 remaining are NOT code bugs — all infra or intentional-security:
- **rls-org-branding T14/T15/T16 (3)** — INFRA: deploy the `branding-asset-upload-url`
  Edge Fn + storage (operator action; `vercel`/`supabase functions deploy`).
- **backup-codes R4 (2)** — `admin_backup_codes` INSERT intentionally revoked from
  service_role; test seeds via direct insert (42501). Deferred EG-29 (stub→RPC at Plan 24-05).
- **rls-matrix (1)** — `rag_topics` INSERT revoked from `authenticated`; the
  `rag_topics_super_insert` RLS policy allows the row but no role has the table GRANT, so
  super-admins must write via the `rag_topic_create` SECDEF RPC (which is why topic-crud
  passes). Same intentional-revoke pattern as R4 — DECISION: re-grant INSERT (gated by RLS)
  vs. redesign the RLS-matrix test to use the RPC.

Resolved this session: R1-R6 (8 DB migrations `20290108000001-9`) + 4 in-repo test-bug
fixes + role-matrix count. Live org_members RLS prod bug fixed; modern audit-write path
resurrected; org onboarding mandatory-step validation restored (consumer split out).
Everything below is the earlier cascade detail.

### ✅ DB cascade COMPLETE (cascades 39-44, 8 migrations applied to remote DB)

User authorized pushing migrations + "keep going until DB-side is exhausted". The audit
write-path was DOA across the whole admin/org/rag system; it took **8 cascading layers**:
recursion (`42P17`) → citext (`42704`) → audit `user_id_hash` on log_admin_action +
log_org_action → `action`/`table_name` NOT NULL (the dual-schema, see
`reference_audit_logs_dual_schema`) → return-type `uuid`→`bigint` → org RPC
`target_user_id` FK (`23503`) + send_org_invite arity (`42883`) → double-`message` RAISE
(`42601`). Migrations `20290108000001`-`…0008`, all clean.

**Unit-tests 62 → 23.** Also fixed a **live production bug** (org_members RLS recursion —
co-member visibility for B2B/clinic users) + resurrected the entire modern audit-write path.

**Residual 23 fails / 7 files — ALL NON-DB (no more migrations help):**
- **Infra (~11):** `branding-asset-upload-url` Edge Fn not deployed (T15/T16 `404`) + storage
  (T14 `fetch failed`). → deploy the Fn.
- **Decision (~7):** role-matrix R5 — DB `has_permission()` lacks 2 newer TS perm keys
  (`expected 18 to be 16`). → extend the fn or trim the TS matrix.
- **Test bugs (~5):** change-member TC6 (`.eq('action', …)` should be `action_name`;
  `.order('created_at')` should be `timestamp`); audit-trigger (non-uuid `log_id`);
  validate-onboarding R6 (P34 shape-guard contract); T12 (asserts `after_data->org_id` but
  RPC writes org_id to `metadata`).
- **Deferred (2):** backup-codes R4 (service_role INSERT intentionally revoked — EG-29).
- **Ambiguous (1):** rls-matrix `42501` super-admin INSERT rag_topics (RLS grant vs test setup).

**Next-session actions:**
0. Resolve the residual: deploy `branding-asset-upload-url`; decide R5; fix the in-repo test
   bugs; check rls-matrix grant. None are DB-migration work.
1. Push the 6 commits (if not already) so CI validates cascades 33-37.
2. Review `drafted-migrations/` → `git mv` into `supabase/migrations/` (re-stamp
   timestamps if newer migrations landed) → `supabase db push --linked`. R1 first
   (production bug). Expect cascading drift discovery per
   `feedback_cascading_drift_discovery_pattern`.
3. Apply R6 test update; decide R5; leave R4 deferred. → Unit-tests ~62 → 0.
4. Share-security-drill 2 fails (Vite proxy) — still open, see below.

---


**Created:** 2026-05-29 (updated post-cascade-32)
**HEAD at handoff:** `8e44a500`
**Cascades closed this session:** 25 (8 through 32)
**Commits:** 26 (24 cascade + 1 handoff + 1 cascade-32 flag-fix)

## TL;DR

Sessions B → F cleared **24 cascade layers** spanning Lint, Unused-exports, Deno-tests, Share-security-drill, and Unit-tests CI jobs.

| Job | Session Start | End | Status |
|---|---|---|---|
| Lint | RED (147 I18N-10 violations) | GREEN | ✅ |
| Format check | RED (811-file drift) | GREEN | ✅ |
| Compliance copy grep | GREEN | GREEN | — |
| Sentry DSN check | GREEN | GREEN | — |
| Design system check | GREEN | GREEN | — |
| Typecheck | GREEN | GREEN | — |
| Unused exports check | RED (SIGPIPE + false-PASS 0/570) | GREEN | ✅ |
| Deno tests | RED (share CORS env-seed race) | GREEN | ✅ |
| **Share security drill** | RED (6 fails) | RED (2 fails) | 🟡 |
| **Unit tests** | RED (501 fails) | RED (62 fails) | 🟡 |
| Mobile (iOS/Android/Manifest) | RED chronic | RED chronic | separate scope |
| a11y baseline | newly RED | RED | not started |

## Remaining 62 Unit-tests failures (commit `8e44a500`)

**Cluster A — Supabase Auth verifyOtp rate-limit: CLOSED ✅**

- Cascade-31 (retry-backoff): 16 → 10 hits (~38%). Insufficient alone.
- Cascade-32 (`--maxWorkers=1` in CI workflow): 10 → **0** hits. Serial file execution spreads the burst over ~10 min, rate limit never approached.
- CI Unit-tests duration: ~50s → ~10min. Acceptable.
- Heads-up: `--minWorkers=1` is NOT a valid vitest 4.x flag (CACError). Use just `--maxWorkers=1`.

**Unmasking effect:** clearing the rate-limit cluster surfaced 62 underlying test failures previously masked by `beforeAll` throwing first. The 62 are NOW the real per-test triage backlog (was unknowable while rate-limit was masking).

**Cluster B — non-rate-limit RLS / unit failures (~7-10)**

- `src/lib/__tests__/rank-org-patients-weights.test.ts` (P30) — likely live-DB drift
- `src/lib/__tests__/resolve-clinic-slug.test.ts` (4 tests) — RPC return-shape drift
- `src/lib/__tests__/role-matrix-sync.test.ts` — DB↔client matrix drift (related to cascade-27)
- `src/lib/__tests__/validate-onboarding-steps.test.ts` — schema/seed drift
- `src/lib/markdown/__tests__/research-renderer.test.ts` — fixture issue
- `src/lib/notifications/permission.test.ts` — jsdom Notification stub?
- `src/lib/rag/__tests__/topic-audit.test.ts` (Phase 50) — RPC drift

Each is its own root cause. Per-test triage, similar to cascades 18-29.

**Cluster C — org-realtime Vault RPC missing (~6 warnings, not test fails)**

Warning string: `[use-org-settings-realtime] Failed to compute HMAC channel name for org X Error: get_realtime_channel_keying returned no data (Vault secret missing?)`. Doesn't fail tests but pollutes logs. Same family as cascade-13's `auth.users` grant fix — likely needs a Vault secret seeded in remote DB.

## Remaining 2 Share-security-drill failures

After cascades 12 → 13:
- Tests **(a) token cache** and **(d) forwarded link** fail with `getByRole('heading', { name: /LeanShot record/ })` not visible.
- Root cause: SPA at `localhost:4173` fetches `/snapshot` on `supabase.co` (cross-site); cookie set with `SameSite=Strict` doesn't travel.
- Verified-working: tests (b) CORS Cache-Control, (c) JWT-TTL via auto-jar, (f) cookie attrs, (audit-row) via cascade-13 GRANT.

**Fix plan (carry over from earlier in this session):**
1. Add Vite preview proxy in `vite.config.ts`: `preview.proxy: { '/functions/v1': { target: process.env.VITE_SUPABASE_URL, changeOrigin: true } }`.
2. Set `VITE_SUPABASE_FUNCTIONS_URL: '/functions/v1'` in CI build env (so SPA fetches same-origin).
3. Update `impersonateAsRecipient` cookie injection: domain `localhost` instead of supabase.co hostname.

## Verified durable patterns saved to memory this session

11 new reference + 4 new feedback memories, plus updates to 2 existing. See `MEMORY.md`. Highlights:

- `reference_logical_css_gate_perl_one_shot` — Tailwind physical→logical mechanical fix.
- `reference_bash_pipefail_sigpipe_head_trap` — `echo "$BIG" | head -1` under pipefail.
- `reference_tty_color_silent_zero_count` — CLI tools' ANSI on TTY breaks regex parsing.
- `reference_static_import_hoist_vs_env_seed` — Deno/ESM static imports hoist before `Deno.env.set`.
- `reference_security_invoker_view_needs_explicit_grant` — SECDEF→security_invoker migrations need GRANTs on auth.users.
- `reference_playwright_apirequest_context_auto_cookie_jar` — manual Cookie header duplicates auto-jar.
- `reference_multiple_vitest_configs_include_overlap` — multi-config + multi-project vitest traps.
- `reference_deferred_tests_md_registry` — project's CI-enforced skip-anchor pattern.
- `feedback_wrapping_guard_mock_audit` — AdminLayout-style guards require all child-tests mock the new gate.
- `feedback_domain_wide_grep_when_fixing_anti_drift` — grep ALL same-domain files for the bare pattern.
- `feedback_ci_rate_limit_parallel_fixtures` — N files × calls × workers vs vendor rate limit math.

## Quick-start commands for next session

```bash
# 1. Re-read this doc
cat leanshot/.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-NEXT-SESSION-HANDOFF-v2.md

# 2. Latest CI state
gh run list --branch=main --limit=1 --workflow=CI --json databaseId,conclusion

# 3. Failing test files in Unit-tests
JOB=$(gh run view <RUN_ID> --json jobs | python3 -c "import json,sys; [print(j['databaseId']) for j in json.load(sys.stdin)['jobs'] if j['name']=='Unit tests']")
gh api repos/pallefar/minisite/actions/jobs/$JOB/logs | grep -E ' FAIL ' | grep -oE '(src|tests)/[^ \[]+\.test\.(ts|tsx)' | sort -u

# 4. Run locally (test:unit now scoped to real unit projects only)
cd leanshot && npm run test:unit

# 5. Verify deferred-tests audit still passes
cd leanshot && node scripts/audit-deferred-tests.mjs
```

## Decision points for next session

1. **Cluster A: CLOSED** — worker-cap (cascade-32) cleared all rate-limit hits. No further action needed unless re-parallelizing (try `--maxWorkers=2` if duration-sensitive).
2. **Share-security-drill (a)+(d):** Vite proxy plan is laid out above; needs 3 file edits + a CI build-env addition.
3. **62 unmasked unit-test failures:** per-test triage. Most are likely backend-drift or jsdom-stub gaps (sample errors include `QuotaExceeded`, `indexedDB is not defined`, `Network failure` fail-open paths). Cluster by error-prefix before grinding.
4. **a11y baseline:** brand-new RED job that surfaced when Lint cleared. Untouched.

## Session metrics

- 25 cascade commits between `6eb7c301` and `8e44a500`
- 4 CI jobs flipped RED→GREEN (Lint, Unused-exports, Deno-tests, Format)
- 1 CI job partially cleared (Share-security 6→2)
- 1 CI job rate-limit cluster CLOSED (Unit-tests 501→62 with the underlying-tests unmasked; local 0)
- 15+ new memory references/feedback files for future sessions
- 1 verified cascade-pattern: parallel-test-fixture rate-limit needs worker-cap, not just retry-backoff

---

**End of v2 handoff. Next session: tackle Cluster A first (worker-cap recommended) to drop ~25-30 fails in 1 commit, then per-cluster from there.**
