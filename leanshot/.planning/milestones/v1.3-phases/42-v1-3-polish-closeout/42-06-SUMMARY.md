---
phase: 42-v1-3-polish-closeout
plan: "06"
status: complete
completed: 2026-05-19
---

# Plan 42-06 Summary — Changelog backend

Backend half of POLISH-11 (What's New drawer). Drawer UI ships in Wave 3 plan 42-09 — POLISH-11 closes when that lands.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Migrations + RLS + seed + cross-tenant test | ✅ Complete | `0ba1cf2` |
| 2 | `changelog-mark-read` Edge Fn + Deno test | ✅ Complete | `b0929f3` |
| 3 | HUMAN deploy bundle (db push + functions deploy + verify) | ✅ Complete (operator auto-run) | `<this commit>` |

## Artifacts

**Migrations applied to production** (project `ytnsipxxmzgaebkqmokp`):
- `20270704000010_changelog_entries.sql` — admin-curated changelog table (uuid pk, slug UNIQUE, published_at DESC index, auto-touch updated_at trigger)
- `20270704000011_user_changelog_dismissed.sql` — per-user last-seen tracker (PK user_id REFERENCES auth.users ON DELETE CASCADE)
- `20270704000012_changelog_rls.sql` — `changelog_entries` SELECT-authenticated + admin INSERT/UPDATE/DELETE (via `is_admin_at_least('admin')`); `user_changelog_dismissed` per-user SELECT/INSERT/UPDATE (no DELETE policy; CASCADE-only)
- `20270704000013_changelog_seed.sql` — 3 v1.3 highlight entries (`ON CONFLICT (slug) DO NOTHING` so admin edits in prod are not clobbered)

**Edge Function deployed:** `changelog-mark-read` (690.6 kB bundle). POST handler; Bearer JWT → UPSERT user_changelog_dismissed via `auth.uid()`. 7 Deno tests passing locally.

**Tests:** `leanshot/tests/rls/changelog-rls.test.ts` — 6 cross-tenant proofs using `admin.generateLink + /auth/v1/verify` plain fetch pattern (per `reference_rls_fixture_gotrueclient_flake`); file-scoped slug prefix `changelog-` per [[rls-per-file-slug-prefix]]. Self-skips without `SUPABASE_SERVICE_ROLE_KEY`.

## Production verification

Live `db query` confirmed all 3 seed rows present in newest-first order:
```
v1-3-dark-mode           → Dark mode, everywhere
v1-3-pwa-offline         → View your data offline
v1-3-smart-notifications → Smart Notifications are here
```

## Operator-driven deploy steps (executed inline this session)

1. Pre-flight: `git rev-parse --show-toplevel` = `/Users/karstenhaldan/minisite` ✓
2. `npx supabase db push --linked` — **batch-applied 15 Wave 2 migrations** in one transaction (42-05 schemas 00001-00007 + 42-06 schemas 00010-00013 + 42-07 schemas 00020-00023). 42-05 / 42-07 schemas land concurrently because their executors had already committed Task 1 (per [[parallel-executor-git-isolation]] migrations land via shared filesystem). Edge Fns for 42-05/42-07 NOT deployed in this step — only the 42-06 Fn.
3. `npx supabase functions deploy changelog-mark-read --project-ref ytnsipxxmzgaebkqmokp` (no `--linked` per [[supabase-functions-deploy-no-linked-flag]]) — 690.6 kB deploy.
4. `npx supabase db query --linked "SELECT slug, title FROM changelog_entries ORDER BY published_at DESC"` → 3 rows ✓
5. Smoke-test curl SKIPPED per operator decision (needs real user JWT; Wave 3 plan 42-09 will exercise the Fn end-to-end).

## Deviations

1. **Plan Task 1 verify referenced `vitest-e2e.config.ts`** — actual project convention is RLS tests run via default `vitest run` (consistent with all other `tests/rls/*.test.ts` files). Plan-text inaccuracy; executor flagged and ran default config instead.
2. **Push collision with deferred RAG migration**: `supabase/migrations/20260519000011_rag_scrape_cron.sql` (from Phase 50-04, awaiting Firecrawl signup before its Edge Fn can deploy) is back-dated relative to the 20270703* remote latest. CLI refused to push. Operator-chosen fix: temp-move the RAG file to `/tmp/`, push, restore. Working tree clean afterward. The RAG cron migration stays deferred per its 50-04 SUMMARY contingency.
3. **Smoke test deferred to Wave 3** — see step 5 above. POLISH-11 stays PARTIAL until 42-09 ships the drawer.

## REQ-IDs

- `POLISH-11` — partial: backend tables + RLS + Edge Fn + seed live. Drawer UI (plan 42-09) closes POLISH-11.

## Wave 2 coordination note

This SUMMARY was written by the orchestrator (not a continuation gsd-executor agent) because background-Agent SendMessage continuation isn't surfaced in this runtime. The 42-06 background executor had returned `status: completed` with the checkpoint message; orchestrator executed the deploy bundle inline and writes this SUMMARY.
