---
phase: 48
slug: m4-moderation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 48 — Validation Strategy

> Per-phase validation contract. Detailed test map + STRIDE register live in `48-RESEARCH.md` §Validation Architecture (lines 1176–1292).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno test (`deno test --no-check`) for Edge Fns; Vitest (TS) for SPA + integration; `psql -f` against linked DB for RLS proofs |
| **Config file** | per-Fn `*.test.ts`; `leanshot/vite.config.ts` (vitest block); `supabase/tests/*.sql` |
| **Quick run command** | `$HOME/.deno/bin/deno test --no-check supabase/functions/{fn}/index.test.ts` (per task) |
| **Full suite command** | `cd leanshot && npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx vitest run` + `$HOME/.deno/bin/deno test --no-check supabase/functions/claude-moderation/ supabase/functions/banned-words-sweep/ supabase/functions/ban-enforcement/` + `for f in supabase/tests/p48_*.sql; do psql ${SUPABASE_DB_URL} -f "$f"; done` |
| **Estimated runtime** | ~5s quick / ~120s full / ~30s RLS proofs |

---

## Sampling Rate

- **Per task commit:** Quick Deno or Vitest run for owning fn/file.
- **Per wave merge:** Cross-Fn Deno sweep (per memory `feedback_post_merge_deno_sweep_pattern`) + tsc --noEmit + targeted vitest.
- **Phase gate:** Full SPA suite + `supabase db push --linked` green + all RLS-proof SQL files green + `supabase functions deploy …` green + cross-tenant impersonation proof live-tested.

---

## Per-Task Verification Map

(19 entries; see `48-RESEARCH.md` lines 1196–1217 for the full table. Summary by requirement:)

- **MOD-01** (3 tests): SECDEF RPC + cooldown UNIQUE; reporter SELECT-own RLS; cross-org isolation impersonation proof.
- **MOD-02** (4 tests): mute silent-suspend RLS; ban write-deny RLS; ban-enforcement DELETE auth.sessions; temp-suspended restore cron (frozen-time).
- **MOD-03** (4 tests): banned-words trigger inserts community_reports; escalate severity fires email-router; sweep idempotent; DMs skip.
- **MOD-04** (3 tests): claude-moderation structured-output → INSERT at ≥0.7; PHI skip on org-scoped spaces; NEVER auto-remove (regression guard).
- **MOD-05** (3 tests): audit immutability (UPDATE/DELETE fail); audit coverage (all admin paths write); audit-archive widening.
- **General** (3 tests): SPA AccountSuspended renders; admin module lazy-loads 5 sub-views; admin-moderation bundle ≤30 kB gz.

---

## Wave 0 Requirements

- [ ] `supabase/tests/p48_*.sql` — 15 RLS-proof + SQL integration files (reconciled iter-1: plan-checker overcounted; 15 unique files scaffolded by 48-06)
- [ ] `supabase/functions/claude-moderation/{index.ts,deno.json,index.test.ts}`
- [ ] `supabase/functions/banned-words-sweep/{index.ts,deno.json,index.test.ts}`
- [ ] `supabase/functions/ban-enforcement/{index.ts,deno.json,index.test.ts}`
- [ ] `leanshot/src/components/AccountSuspended.test.tsx`
- [ ] `leanshot/src/admin/modules/moderation/__tests__/{ModerationLayout,ReportsQueue,BannedWordsEditor,UserBansRoster,AuditLogViewer}.test.tsx`
- [ ] `leanshot/scripts/check-bundle-ceiling.cjs` (or extend existing assert-bundle-budget.sh) — `admin-moderation 30720`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Anthropic moderation call against prod | MOD-04 | Live API; needs consumer ANTHROPIC_API_KEY | Wave 3 HUMAN-UAT: operator triggers a post in a global space with mildly toxic content; confirms community_reports row created with `reason->>'source'='claude_auto_flag'` within ~5s. |
| Real session-revoke on banned user | MOD-02 | Requires real test account + session | Wave 3 HUMAN-UAT: ban a test account in session A; refresh in same session B; confirm AccountSuspended page renders + writes fail. |
| Real cross-org RLS proof | MOD-01 (D-04) | Requires 2+ clinic orgs with admin members | Wave 3 HUMAN-UAT: clinic A support_admin queries community_reports; confirms no clinic B rows visible (live impersonation proof). |
| Real banned-word escalate email | MOD-03 | Live Resend send | Wave 3 HUMAN-UAT: admin marks word with severity='escalate', posts triggering content, confirms staff inbox receives email. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s full suite
- [ ] `nyquist_compliant: true` set in frontmatter (flip in close-out plan after Wave 0 green)

**Approval:** pending
