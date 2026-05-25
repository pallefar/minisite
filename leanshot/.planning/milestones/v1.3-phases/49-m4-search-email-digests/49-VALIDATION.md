---
phase: 49
slug: m4-search-email-digests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-24
---

# Phase 49 — Validation Strategy

> Per-phase validation contract. Detailed test map + STRIDE register in `49-RESEARCH.md` §Validation Architecture (lines 1084–1173).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno test (Edge Fns + `_shared/` helpers); Vitest + React Testing Library (SPA `src/`); `psql -f` for RLS proofs |
| **Config file** | per-Fn `deno.json`; `leanshot/vite.config.ts` (vitest block); `supabase/tests/*.sql` |
| **Quick run command** | `$HOME/.deno/bin/deno test --no-check supabase/functions/{fn}/index.test.ts` + `cd leanshot && npx vitest run src/components/search/` |
| **Full suite command** | `cd leanshot && npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx vitest run` + `$HOME/.deno/bin/deno test --no-check supabase/functions/community-daily-digest/ supabase/functions/community-weekly-digest/ supabase/functions/unsubscribe-handler/ supabase/functions/_shared/__tests__/` + `for f in supabase/tests/p49_*.sql; do psql ${SUPABASE_DB_URL} -f "$f"; done` |
| **Estimated runtime** | ~5s quick / ~3min full / ~30s RLS proofs |

---

## Sampling Rate

- **Per task commit:** Quick Deno or Vitest run + `tsc --noEmit`.
- **Per wave merge:** Cross-Fn Deno sweep (per memory `feedback_post_merge_deno_sweep_pattern`) + full Vitest + targeted RLS proofs.
- **Phase gate:** Full SPA suite + `supabase db push --linked` green + all RLS-proof SQL files green + 3 Fn deploys + cross-tenant impersonation proof + 1× live staging smoke (cmd+k search + manual cron-fired daily digest).

---

## Per-Task Verification Map

(24 entries — see `49-RESEARCH.md` lines 1096–1124 for the full table.)

- **DIGEST-01** (8 tests): GENERATED column behavior; GIN index used; search_content RPC ranking; RLS inheritance impersonation; Spanish dictionary; ts_headline HTML wrap; cmd+k modal open/close; debounce + min-chars guard.
- **DIGEST-02** (6 tests): Daily Fn auth 401; empty-bucket skip-send; non-empty send + log; idempotent UPSERT on re-fire; cron registration at minute=5; TZ predicate eval at user local 9am.
- **DIGEST-03** (4 tests): Sunday 09:00 weekly fire; course progress delta; upcoming events filter; community top-3 score formula.
- **DIGEST-04** (6 tests): List-Unsubscribe header present; List-Unsubscribe-Post: One-Click; valid HMAC → settings flip; tampered HMAC → 401; expired HMAC → 401; notification_settings CHECK accepts 2 new categories.

---

## Wave 0 Requirements

- [ ] `supabase/functions/community-daily-digest/{index.ts, deno.json, index.test.ts}`
- [ ] `supabase/functions/community-weekly-digest/{index.ts, deno.json, index.test.ts}`
- [ ] `supabase/functions/unsubscribe-handler/{index.ts, deno.json, index.test.ts}`
- [ ] `supabase/functions/_shared/unsubscribe-token.ts` + `unsubscribe-token.test.ts` (HMAC mint+verify)
- [ ] `supabase/functions/_shared/__tests__/fts-schema.test.ts`
- [ ] `supabase/functions/_shared/__tests__/search-content-rpc.test.ts`
- [ ] `supabase/functions/_shared/__tests__/digest-helpers.test.ts`
- [ ] `leanshot/src/components/search/SearchModal.test.tsx`
- [ ] `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` — widen for 2 new categories
- [ ] `supabase/tests/p49_*.sql` — cross-tenant RLS impersonation proofs (per project rule)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend RFC 8058 in-inbox unsubscribe (Gmail UI) | DIGEST-04 | Live email send + Gmail rendering | Wave 3 HUMAN-UAT: send a real daily digest to a test Gmail account; verify Gmail shows "unsubscribe" button next to sender name; click → confirm 1-click POST works |
| Cron fires per-user-TZ at 09:00 local | DIGEST-02 | Real time + multiple TZ users | Wave 3 HUMAN-UAT: seed 3 test users with different IANA TZs; wait for hourly tick; verify each user receives digest only at their local 09:00 (or check digest_send_log) |
| Spanish search matches Spanish content | DIGEST-01 | Live i18n + DB | Wave 3 HUMAN-UAT: post a community post in Spanish; switch UI lang to es; open cmd+k; query "dosis"; confirm post surfaces |
| Cross-tenant RLS impersonation proof | DIGEST-01 | Live multi-org auth | Wave 3 HUMAN-UAT: clinic A user searches; results must NOT include clinic B content |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s full suite
- [ ] `nyquist_compliant: true` set in frontmatter (flip in close-out plan after Wave 0 green)

**Approval:** pending
