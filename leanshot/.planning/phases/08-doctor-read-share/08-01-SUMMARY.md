---
phase: 08-doctor-read-share
plan: 01
subsystem: schema-foundation
tags: [share, schema, rls, rpc, audit-logs, snapshot-view]

dependency-graph:
  requires:
    - audit_logs (Phase 7 — 20260601000001..18)
    - injections / weights / meals / workouts / supplements / mood / sleep /
      symptoms / vials / settings / photos (Phase 5/6 sync tables)
    - pgcrypto extension (Supabase managed; `extensions` schema)
  provides:
    - public.shares table + RLS (owner-SELECT-only)
    - public.audit_logs columns: actor_type, share_id, recipient_ua_family,
      recipient_ip_family (+ ME-2 CHECK + share_view action whitelist)
    - public.share_snapshot_view (service_role-readable; SC#3 structural
      exclusion of the AI conversation log table)
    - 6 SECURITY DEFINER RPCs: create_share, revoke_share, redeem_share,
      verify_share_code, log_share_view, increment_share_attempt
    - src/types/share.ts shared types (incl. SnapshotResponse.share_id per BL-1)
    - 10 Wave-0 test scaffolds
  affects:
    - Plan 08-02 (Edge Function calls all 4 service-role RPCs)
    - Plan 08-03 (Active shares Settings UI reads audit_logs aggregates)
    - Plan 08-04 (SharePage renders SnapshotResponse incl. share_id)
    - Plan 08-05 (4-failure-mode revocation drill uses revoke_share + DB-row gate)
    - Plan 08-06 (Print footer reads SnapshotResponse.share_id)

tech-stack:
  added:
    - public.audit_actor_type ENUM
  patterns:
    - SECURITY DEFINER + search_path public/extensions/pg_catalog (Phase 7 pattern)
    - jsonb_agg + correlated subquery per entity (snapshot view shape)
    - pathspec git commits (parallel-executor isolation rule)
    - .test.ts naming (Deno discovery glob)
    - test.skip / it.skip / it.todo for Wave-0 scaffolds

key-files:
  created:
    - supabase/migrations/20260701000001_audit_logs_share_columns.sql
    - supabase/migrations/20260701000002_shares_table.sql
    - supabase/migrations/20260701000003_share_rpcs.sql
    - supabase/migrations/20260701000004_share_snapshot_view.sql
    - supabase/functions/share/deno.json
    - supabase/functions/share/index.test.ts
    - leanshot/src/types/share.ts
    - leanshot/e2e/rls-shares.test.ts
    - leanshot/e2e/share-happy-path.spec.ts
    - leanshot/e2e/share-revocation-drill.spec.ts
    - leanshot/e2e/active-shares.spec.ts
    - leanshot/e2e/share-print.spec.ts
    - leanshot/src/components/share/SharePage.test.tsx
    - leanshot/src/components/dashboard/settings/ActiveSharesSection.test.tsx
  modified: []

decisions:
  - "audit_logs column is `user_id_hash` (NOT `actor_hash`) — confirmed from 20260601000001_audit_logs.sql line 62. log_share_view RPC writes (user_id, user_id_hash, table_name, row_id, action, actor_type, share_id, recipient_ua_family, recipient_ip_family)."
  - "Sync table names (Phase 5/6) confirmed singular for mood + sleep (not `mood_logs`/`sleep_logs`) — verified from create-table statements in 20260514000004_mood.sql and 20260514000005_sleep.sql. Snapshot view joins exactly these 11 tables."
  - "verify_share_code (BL-2) shipped in this plan as the 6th RPC — Plan 08-02 can call it directly without a follow-up migration."
  - "SnapshotResponse.share_id (BL-1) exported from src/types/share.ts — Plan 08-02's snapshot handler populates it; Plan 08-06's print footer reads it. It is the opaque share UUID, NEVER the patient user_id."
  - "CSPRNG 6-digit code uses gen_random_bytes(4) → bit(32) → int32 → modulo 1_000_000 with +1_000_000/%1_000_000 normalization for negative-int safety. The literal token `random()` does not appear anywhere in 20260701000003_share_rpcs.sql per Assumption A5."
  - "audit_logs.share_id FK added in migration 02 (after public.shares exists) — NOT in migration 01 where the column is declared. Migration order is load-bearing."
  - "Structural ai_log-table exclusion in 20260701000004_share_snapshot_view.sql is enforced by grep gate: the forbidden identifier returns 0 matches in the file. Comments rephrase around the literal token so the gate stays green."

metrics:
  duration: "4m 3s"
  completed: "2026-05-13"
  tasks_completed: 2
  tasks_blocked: 1
---

# Phase 8 Plan 08-01: Share Schema Foundation Summary

**One-liner:** Postgres schema slice for doctor read-share — `shares` table + RLS, `audit_logs` extension with ME-2 ip-bucketing CHECK, 6 SECURITY DEFINER RPCs (incl. `verify_share_code` per BL-2), and `share_snapshot_view` with structural exclusion of the AI conversation log surface; live `supabase db push` is the BLOCKING checkpoint at Task 3.

## What was built

### Wave 0 scaffolds (Task 1 — committed `1259a11`)

10 files staged for downstream plans to fill in. Existence is the Wave-0
closure gate per `08-VALIDATION.md`. Each scaffold cites the plan that will
implement it.

- `src/types/share.ts` — full TypeScript contract: `Share`,
  `CreateShareRequest`, `CreateShareResponse`, `RedeemRequest`,
  `RedeemError`, `SnapshotResponse` (with `share_id: string` per D-02(c) /
  BL-1), `SnapshotError`, `ShareStatus`. Block JSDoc at top survives the
  comment-stripping grep filter; zero `ai_messages`/`aiHistory` references
  in non-comment lines.
- `supabase/functions/share/deno.json` — mirrors `ai-chat/deno.json` exactly
  (same `imports`, `tasks`, `lint`, `fmt`).
- `supabase/functions/share/index.test.ts` — Deno test scaffold;
  filename `.test.ts` (NOT `-test.ts`) matches the discovery glob
  `{*_,*.,}test.*` per memory `reference_deno_test_discovery.md`.
- `e2e/rls-shares.test.ts` — cross-tenant RLS impersonation proof. Ships
  ONE real assertion in Wave 1 (user B cannot SELECT user A shares row;
  cannot direct-INSERT impersonating user A); 3 stubs as `it.todo` for
  later plans. Required by project rule `reference_supabase_project.md`.
- `e2e/{share-happy-path,share-revocation-drill,active-shares,share-print}.spec.ts`
  — Playwright spec scaffolds with `test.skip`s mapped to Plans 08-03..08-06.
- `src/components/share/SharePage.test.tsx`,
  `src/components/dashboard/settings/ActiveSharesSection.test.tsx` —
  Vitest scaffolds with `it.skip`s mapped to Plans 08-04 and 08-03.

### Schema migrations (Task 2 — committed `fb3ea38`)

Four sequential SQL migrations. Migration order is load-bearing because
`audit_logs.share_id` references `public.shares.id`, and `shares` is created
in migration 02 — so 01 declares the column without FK, and 02 adds the FK
constraint after the target table exists.

**`20260701000001_audit_logs_share_columns.sql`**

- `audit_actor_type` enum (`user` | `share_recipient` | `system`).
- 4 new columns on `public.audit_logs`: `actor_type` (default `user`),
  `share_id` (no FK yet), `recipient_ua_family`, `recipient_ip_family`.
- **ME-2 CHECK** `audit_logs_recipient_ip_family_bucketed_chk` — only allows
  `/16` IPv4 buckets, `/48` IPv6 buckets, or sentinel `unknown`. Full
  dot-quad IPv4 and full IPv6 addresses are explicitly forbidden by regex.
  Defense-in-depth against T-08-I4 (PII-grade IP precision leaking even if
  upstream parsing regresses).
- Drop + recreate `audit_logs_action_check` to add `'share_view'` while
  preserving all 5 prior values (insert/update/delete/account_deleted_*).
- Partial index `(share_id, timestamp desc) WHERE actor_type='share_recipient'`
  — column-vs-literal only, IMMUTABLE-safe per Pitfall 2.

**`20260701000002_shares_table.sql`**

- `public.shares` with 12 columns including `failed_attempts_count`
  + `last_attempt_at` for per-share rate-limit (Pitfall 5 — per-share, NOT
  per-user). `id uuid primary key default gen_random_uuid()`.
- CHECK constraints: `char_length(label) BETWEEN 1 AND 80`,
  `expires_at > created_at`.
- Unique index on `token_hash` (Edge Function lookup path).
- Partial index `(user_id, expires_at) WHERE revoked_at IS NULL` —
  IMMUTABLE-safe.
- RLS enable + `shares_select_own (auth.uid() = user_id)`. NO authenticated
  INSERT/UPDATE/DELETE policies — RPCs are the only write path
  (T-08-T1/T2 negative-space mitigation).
- `audit_logs_share_id_fkey` ADDED HERE (`on delete set null` so audit
  history survives share-row cascade from `auth.users` account-delete).

**`20260701000003_share_rpcs.sql`**

Six SECURITY DEFINER RPCs. Every function declaration carries
`set search_path = public, extensions, pg_catalog` (Pitfall 1; pgcrypto
resolves on managed Supabase). Verify gate counts ≥6 occurrences (actual: 7,
all in function declarations).

| # | RPC | Grant | Purpose |
|---|-----|-------|---------|
| 1 | `create_share(label, expires_at) → (share_id, raw_token, raw_code)` | authenticated | Patient creates share. CSPRNG token + 6-digit code; hashes stored, raw values returned ONCE. `random()` substring count: 0 (Assumption A5 enforced) |
| 2 | `revoke_share(share_id) → void` | authenticated | Owner-only via `auth.uid()` filter. Sets `revoked_at = now()` AND nulls `recipient_session_hash` (defense-in-depth per Open Question 3). Cannot extend `expires_at` (T-08-T1 mitigation) |
| 3 | `redeem_share(share_id, recipient_session_hash, ua, ip) → void` | service_role | Single-use enforcement via UPDATE filter (`code_consumed_at IS NULL` + `revoked_at IS NULL` + `expires_at > now()`); second redeem raises P0002 |
| 4 | `verify_share_code(share_id, code) → boolean` (BL-2) | service_role | bcrypt compare via `crypt(p_code, access_code_hash)`. NULL coerced to `false` so caller cannot distinguish row-not-found from mismatch |
| 5 | `log_share_view(share_id, ua_family, ip_family) → void` | service_role | Writes audit row with `actor_type='share_recipient'`, `action='share_view'`, recipient metadata. Resolves owner via `select user_id from shares where id=p_share_id`; raises P0002 if missing |
| 6 | `increment_share_attempt(share_id) → int` | service_role | Per-share rate-limit counter (Pitfall 5); returns the new attempts count |

**`20260701000004_share_snapshot_view.sql`**

- `share_snapshot_view` as one row per `auth.users.id`, with 11 entity
  arrays via correlated `jsonb_agg(row_to_json(...))` subqueries.
- 11 tables joined: `injections, weights, meals, workouts, supplements,
  mood, sleep, symptoms, vials, settings, photos` (all singular table
  names — confirmed from Phase 5/6 migration sources).
- **The AI conversation log table is INTENTIONALLY NOT joined.** SC#3
  structural enforcement: `grep -c '<forbidden_identifier>' migration` → 0.
  Comments rephrase around the literal token to keep the gate green.
- `photos.storage_path` is surfaced raw; the Edge Function (Plan 08-02)
  mints short-lived signed URLs at request time per the Phase 6 D-07
  pattern (signed URLs are time-bound; caching them inside a view is wrong).
- `revoke all from public; grant select to service_role` — view is
  server-internal.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Verify gate sensitivity to literal-token mentions in comments**

- **Found during:** Task 2 verify run.
- **Issue:** The Task 2 verify command counts ANY occurrence of `ai_messages` /
  `random()` — including comment text. My initial draft had explanatory
  comments referencing the forbidden tokens in prose form (e.g.,
  "we MUST NOT use random()" and "join to public.ai_messages"), tripping
  the gate.
- **Fix:** Rephrased the affected comments to reference the same concepts
  without the literal substrings: "the non-CSPRNG numeric generator" and
  "the AI conversation log table (created in an earlier phase)". The
  semantic intent + structural-exclusion contract is preserved; only the
  literal forbidden tokens were removed.
- **Files modified:** `supabase/migrations/20260701000003_share_rpcs.sql`,
  `supabase/migrations/20260701000004_share_snapshot_view.sql`.
- **Commit:** rolled into `fb3ea38` (Task 2). Verify gates re-ran clean
  after the rewrites:
  `ai_messages` count = 0, `random()` count = 0, `search_path` count = 7.

**2. [Rule 3 — Blocker] Same comment-leak issue in `src/types/share.ts`**

- **Found during:** Task 1 verify run (post-write check).
- **Issue:** The grep filter `^(//|\*|/\*)` only strips comment lines whose
  first character is `/` or `*` (no leading whitespace). JSDoc continuation
  lines starting ` * ...` and indented `// ...` comments inside method
  bodies fail the strip and surface as non-comment matches.
- **Fix:** Rephrased the JSDoc and the inline note in `SnapshotResponse`'s
  shape to talk about "AI conversation surface" / "AI-chat-history field"
  rather than the literal `ai_messages` / `aiHistory` identifiers. The
  same semantic intent stands; the type contract is unchanged.
- **Files modified:** `leanshot/src/types/share.ts`.
- **Commit:** rolled into `1259a11` (Task 1).

No architectural deviations (Rule 4). No bugs found in plan logic.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wave 0 test scaffolds + shared types + Deno test config | `1259a11` | 10 files (1 type, 2 Deno, 4 e2e, 1 RLS, 2 vitest) |
| 2 | Schema migrations — audit_logs + shares + 6 RPCs + view | `fb3ea38` | 4 SQL migrations (audit_logs ext, shares, RPCs, snapshot view) |

## Task awaiting checkpoint

**Task 3 (BLOCKING):** Push migrations to live Supabase + verify RLS + regen types.

- **Type:** `checkpoint:human-action` (gate=blocking).
- **Why blocking:** `supabase db push` may prompt for confirmation on
  first-time auth or destructive operations; the agent should NOT run it
  unattended per memory `project_worktree_supabase_cli.md`.
- **What the orchestrator must do:**
  1. Confirm the 4 migration SQL files are also present in the MAIN repo
     tree at `supabase/migrations/2026070100000{1..4}_*.sql` (worktree
     migration mirror per `project_worktree_supabase_cli.md`).
  2. Ensure `SUPABASE_ACCESS_TOKEN` env var is set (or run
     `supabase login` interactively).
  3. From `/Users/karstenhaldan/minisite/` run:
     ```bash
     supabase db push --linked
     ```
     If prompted to confirm destructive ops, approve.
  4. **If push errors with `function digest does not exist` or
     `function crypt does not exist`** — Pitfall 1 hit. Every SECURITY
     DEFINER already has `extensions` in the search_path declaration
     (verified pre-push: count = 7), so this should NOT trip. If it does,
     surface the exact error.
  5. **If push errors with `42P17 must be marked IMMUTABLE`** — Pitfall 2
     hit. Both partial indexes use column-vs-literal comparisons only
     (verified pre-push). If this trips, surface the exact error.
  6. Regenerate types:
     ```bash
     supabase gen types typescript --linked > leanshot/src/types/supabase.ts
     ```
  7. Run `npm run typecheck` from `leanshot/` — must pass clean.
  8. Run the cross-tenant RLS proof:
     ```bash
     cd leanshot && npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts -t 'cross-tenant'
     ```
     (Requires `SUPABASE_SERVICE_ROLE_KEY` in env.)
  9. Manual verification via Supabase Studio SQL editor or psql:
     - `select count(*) from public.shares` → 0
     - 4 new columns present on `public.audit_logs` (`actor_type`,
       `share_id`, `recipient_ua_family`, `recipient_ip_family`).
     - 6 RPCs callable: `select count(*) from pg_proc where proname in
       ('create_share', 'revoke_share', 'redeem_share',
       'verify_share_code', 'log_share_view', 'increment_share_attempt')`
       → 6.
     - `select pg_get_viewdef('public.share_snapshot_view'::regclass)`
       contains the 11 sync-table joins and does NOT contain the AI log
       table identifier.
     - `select conname from pg_constraint where
       conrelid='public.audit_logs'::regclass and
       conname='audit_logs_recipient_ip_family_bucketed_chk'` → 1 row.

After push lands, resume signal is "approved" (per plan). On failure,
surface the exact error and resume with `blocked: <error>` so a follow-up
agent can debug the schema before retry.

## Handoffs to downstream plans

- **Plan 08-02 (Edge Function):**
  - All 4 service-role RPCs are callable: `redeem_share`,
    `verify_share_code`, `log_share_view`, `increment_share_attempt`.
  - The snapshot view is at `public.share_snapshot_view`; read via
    `supabase.from('share_snapshot_view').select('*').eq('user_id', :uid)`
    from a service-role client. Photos require per-row signed-URL minting
    on top of the view's `storage_path`.
  - `SnapshotResponse.share_id` is in `src/types/share.ts` (BL-1); the
    handler populates it from the redeem/cookie lookup (the opaque
    `shares.id`, NEVER the patient `user_id`).
  - `recipient_ip_family` MUST be passed in bucketed form (`/16`, `/48`,
    or `'unknown'`); the ME-2 CHECK in 20260701000001 rejects raw IPs
    server-side regardless.

- **Plan 08-03 (Active shares Settings UI):**
  - Aggregate query shape (RLS does the scoping):
    ```sql
    select share_id,
           count(*)        as view_count,
           max(timestamp)  as last_viewed_at
      from public.audit_logs
     where actor_type='share_recipient'
       and share_id = any($1)
     group by share_id;
    ```
    The partial index `audit_logs_share_recipient_idx` supports this.
  - `revoke_share` raises P0002 on already-revoked / not-owned — surface
    as a benign UX state, not an error.

- **Plan 08-04 (SharePage):**
  - Render `SnapshotResponse` shape from `src/types/share.ts`. The chart +
    DoctorReport reuse contract is identical to Phase 3/7 use sites.

- **Plan 08-06 (Print mode):**
  - Print footer reads `SnapshotResponse.share_id` for the display ID.
    NEVER use `snapshot.user_id` — that's the patient identifier and
    would leak across the trust boundary.

## Known Stubs

The 10 Wave-0 scaffolds use `test.skip` / `it.skip` / `it.todo` so CI stays
green. Each is annotated with the responsible plan that will fill it in
(Plans 08-02..08-06). These are intentional placeholders, NOT regressions —
plan 08-01 explicitly defines existence as the Wave-0 closure gate per
`08-VALIDATION.md`.

## Self-Check: PASSED

- File `supabase/migrations/20260701000001_audit_logs_share_columns.sql`: FOUND
- File `supabase/migrations/20260701000002_shares_table.sql`: FOUND
- File `supabase/migrations/20260701000003_share_rpcs.sql`: FOUND
- File `supabase/migrations/20260701000004_share_snapshot_view.sql`: FOUND
- File `supabase/functions/share/deno.json`: FOUND
- File `supabase/functions/share/index.test.ts`: FOUND
- File `leanshot/src/types/share.ts`: FOUND
- File `leanshot/e2e/rls-shares.test.ts`: FOUND
- File `leanshot/e2e/share-happy-path.spec.ts`: FOUND
- File `leanshot/e2e/share-revocation-drill.spec.ts`: FOUND
- File `leanshot/e2e/active-shares.spec.ts`: FOUND
- File `leanshot/e2e/share-print.spec.ts`: FOUND
- File `leanshot/src/components/share/SharePage.test.tsx`: FOUND
- File `leanshot/src/components/dashboard/settings/ActiveSharesSection.test.tsx`: FOUND
- Commit `1259a11`: FOUND
- Commit `fb3ea38`: FOUND
- Verify gates: ai_messages count = 0 (view); random() count = 0 (RPC);
  search_path count = 7 (≥6 required); verify_share_code present;
  ME-2 CHECK present; FK in migration 02 not 01.
