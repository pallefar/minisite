# Plan 70-07 — NEXT-SESSION-HANDOFF v2 (cascades 8-31 complete)

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
