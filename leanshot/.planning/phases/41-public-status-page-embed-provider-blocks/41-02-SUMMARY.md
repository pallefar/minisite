---
phase: 41-public-status-page-embed-provider-blocks
plan: 02
subsystem: page-builder embeds — Custom-iframe foundation
tags:
  - migration
  - schema
  - rpc
  - audit-log
  - foundation
  - embed
requires:
  - public.is_admin_at_least (Phase 24)
  - public.admin_role enum (Phase 24)
  - public.log_admin_action (Phase 24 — canonical 6-arg signature)
  - auth.users (Supabase Auth)
provides:
  - public.iframe_allowlist (table)
  - public.add_iframe_allowlist_hostname(text) returns uuid (SECDEF RPC)
  - public.remove_iframe_allowlist_hostname(uuid) returns void (SECDEF RPC)
  - BlockType union literal 'custom_iframe'
  - validateCustomIframeUrl(raw, allowlist) — pure URL validator
  - buildCustomIframeIframeHtml(content, allowlist) — pure iframe HTML builder
  - EMBED_IFRAME_TITLES.custom_iframe = 'Embedded content'
  - listHostnames / addHostname / removeHostname / AllowlistRow (admin client wrappers)
affects:
  - leanshot/src/lib/page-builder/block-schema.ts (union widening)
  - leanshot/src/lib/page-builder/embed-src.ts (new exports + EMBED_IFRAME_TITLES widening)
tech-stack:
  added: []
  patterns:
    - SECDEF RPC + canonical 6-arg log_admin_action (Phase 24 pattern S1 dual-layer)
    - RLS default-deny + public-SELECT (audit_logs pattern; safe because hostnames appear in served CSP headers)
    - Exact-hostname URL allowlist (D-15; mirrors Phase 15 embed-src parseAndValidateUrl)
    - Fixed-sandbox iframe-HTML builder (D-16; no admin override surface in v1.3)
key-files:
  created:
    - supabase/migrations/20271101000001_p41_iframe_allowlist.sql
    - supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql
    - leanshot/src/lib/page-builder/__tests__/embed-src.custom-iframe.test.ts
    - leanshot/src/lib/admin/iframe-allowlist.ts
  modified:
    - leanshot/src/lib/page-builder/block-schema.ts
    - leanshot/src/lib/page-builder/embed-src.ts
    - leanshot/.planning/ROADMAP.md
decisions:
  - "Migration timestamps renamed from declared 20270711* to 20271101* to clear back-dated-push block (latest applied is 20271001000008). See Deviations."
  - "Public-SELECT RLS policy on iframe_allowlist accepted — hostnames appear in served CSP frame-src headers anyway. Plan 41-03 Vercel Edge Middleware fetches via PostgREST + anon key."
  - "FIXED D-16 sandbox literal 'allow-scripts allow-same-origin' in buildCustomIframeIframeHtml — no parameterisation, no override surface. Plan 41-05 + Plan 41-03 renderer MUST call this helper rather than build iframe attrs ad-hoc."
metrics:
  duration: ~12min
  completed: 2026-05-24
commits:
  - 9469079d feat(41-02): iframe_allowlist table + RLS migration
  - b89a7454 feat(41-02): SECDEF RPCs add/remove_iframe_allowlist_hostname
  - 83b74c70 test(41-02): RED — failing tests for validateCustomIframeUrl + buildCustomIframeIframeHtml
  - 28a9f097 feat(41-02): BlockType custom_iframe + validateCustomIframeUrl + admin client wrappers
---

# Phase 41 Plan 02: Custom-iframe Allowlist Foundation Summary

Data + schema foundation for Custom-iframe embeds — per-deployment hostname allowlist table, two SECDEF RPCs with canonical 6-arg audit logging, BlockType union extension, pure URL validator + HTML builder enforcing D-15 (exact hostname match) and D-16 (FIXED sandbox), plus admin-client wrappers Plan 41-06 consumes.

## What Shipped

### Migrations

`supabase/migrations/20271101000001_p41_iframe_allowlist.sql`

```sql
create table public.iframe_allowlist (
  id                  uuid        primary key default gen_random_uuid(),
  hostname            text        not null unique,
  added_by_user_id    uuid        references auth.users(id) on delete set null,
  added_at            timestamptz not null default now(),
  last_used_at        timestamptz
);
-- + iframe_allowlist_hostname_idx (btree on hostname)
-- + RLS enabled
-- + public-SELECT policy for anon, authenticated (Plan 41-03 middleware fetch)
-- — no INSERT/UPDATE/DELETE policies (audit_logs default-deny pattern)
```

`supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql`

```
add_iframe_allowlist_hostname(p_hostname text) returns uuid
  — SECURITY DEFINER; search_path = extensions, public, pg_temp
  — gate: is_admin_at_least('superadmin'::public.admin_role) → 42501 otherwise
  — reject: null/'' / '%://%' / '%/%' / '%*%' / leading '.' → 22023
  — inserts row, returns id
  — log_admin_action('iframe_allowlist.add', null, 'iframe_allowlist',
                     v_id::text, null, jsonb_build_object('hostname', p_hostname))

remove_iframe_allowlist_hostname(p_id uuid) returns void
  — SECURITY DEFINER; same search_path
  — same superadmin gate (42501) + null-id reject (22023)
  — captures hostname into v_hostname BEFORE delete (for audit p_before payload)
  — delete from iframe_allowlist where id = p_id
  — log_admin_action('iframe_allowlist.remove', null, 'iframe_allowlist',
                     p_id::text, jsonb_build_object('hostname', v_hostname), null)
```

Both `grant execute ... to authenticated;` — the SECDEF body is the security boundary, not the grant.

### TypeScript exports (new + modified)

`leanshot/src/lib/page-builder/block-schema.ts`
- `BlockType` union extended with 13th literal `'custom_iframe'` (positioned at end so the 12 prior JSONB values stay stable).

`leanshot/src/lib/page-builder/embed-src.ts`
- `EMBED_IFRAME_TITLES.custom_iframe = 'Embedded content'`.
- `interface CustomIframeContent { embedUrl: string; iframeTitle: string; widthMode?: boolean }`.
- `validateCustomIframeUrl(raw: unknown, allowlistHostnames: ReadonlyArray<string>): string | null` — D-15 exact-hostname `.includes()` equality on `parsed.hostname` only; rejects non-string, unparseable, non-https.
- `buildCustomIframeIframeHtml(content, allowlistHostnames): string` — wraps `validateCustomIframeUrl`; returns `''` on failure; emits iframe HTML with FIXED `sandbox="allow-scripts allow-same-origin"` (D-16), `loading="lazy"`, `referrerpolicy="no-referrer"`, fallback title `'Embedded content'` if `iframeTitle.length < 3`.

`leanshot/src/lib/admin/iframe-allowlist.ts` (NEW)
- `interface AllowlistRow { id, hostname, added_by_user_id, added_at, last_used_at }`.
- `async function listHostnames(client) → AllowlistRow[]` — SELECT ordered by `added_at desc`.
- `async function addHostname(client, hostname) → { id }` — wraps `add_iframe_allowlist_hostname` RPC.
- `async function removeHostname(client, id) → void` — wraps `remove_iframe_allowlist_hostname` RPC.

All wrappers accept the caller's authenticated `SupabaseClient` so the RPC's `auth.uid()` sees the superadmin JWT (per `feedback_rpc_auth_uid_vs_service_role_mismatch`).

## Verification Results

| Check | Result |
|-------|--------|
| Migration files exist at exact `20271101*` filenames | PASS |
| `ls supabase/migrations/20271101*.sql \| wc -l` | 2 |
| `grep -c "security definer" rpcs migration` | 2 |
| `grep -q "is_admin_at_least.*superadmin"` | PASS |
| `grep -q "'iframe_allowlist.add'"` + `"'iframe_allowlist.remove'"` | PASS |
| `vitest run …embed-src.custom-iframe.test.ts` | 8/8 PASS |
| `tsc -p tsconfig.app.json --noEmit` | clean (exit 0) |
| `eslint` on changed files | clean (exit 0) |
| Negation grep: `endsWith \| startsWith` on hostname outside comments | only comments warning AGAINST the patterns + safe `.includes()` call |
| `grep -c "'custom_iframe'" block-schema.ts` | 1 |
| `grep -c "allow-scripts allow-same-origin" embed-src.ts` | 4 (existing Calendly/YouTube/Tally sandboxes + new Custom-iframe — all FIXED, no parameterisation) |

## Migration Push

**Deferred to Plan 41-06 close-out** per phase migration-aggregation discipline — this plan does NOT run `supabase db push`. Migrations sit untouched in `supabase/migrations/` until Plan 41-06's `[BLOCKING] supabase db push --linked` task.

## TDD Gate Compliance

RED → GREEN → (no refactor needed) cycle observed:
- RED: `83b74c70 test(41-02): RED — failing tests` (7/8 fail; T8 BlockType assignment is type-only)
- GREEN: `28a9f097 feat(41-02): BlockType custom_iframe + validateCustomIframeUrl + admin client wrappers` (8/8 pass; tsc strict-clean)

## Deviations from Plan

### Auto-applied Pre-flight Fix

**1. [Pre-flight pivot — migration timestamp rename] Renamed migrations from `20270711000001/02` → `20271101000001/02`**
- **Why:** Latest applied migration is `20271001000008_p49_pg_cron_schedules.sql` (Oct 2027). Declared July 2027 timestamps are back-dated. Per memory `reference_supabase_back_dated_migration_blocks_push`, Supabase CLI refuses ANY push when local migrations are older than the remote's latest applied — would block Plan 41-06's close-out push. Renamed to Nov 2027 (forward of the Oct tail) to clear the block pre-emptively.
- **Files modified:** `supabase/migrations/20271101000001_p41_iframe_allowlist.sql` (was `20270711000001_*`), `supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql` (was `20270711000002_*`).
- **Note:** PLAN.md `files_modified` still references the original `20270711*` names. Carried in this deviation note rather than rewriting the plan in-flight; downstream plans (41-03 middleware fetch, 41-06 admin UI + close-out push) reference the table/RPC names, not the migration filenames, so they remain valid.
- **Memory match:** `reference_supabase_back_dated_migration_blocks_push` (pre-flight prevention; no operator rescue needed because rename happened pre-push).

### Auto-fixed Issues During Execution

**2. [Rule 3 - Blocking] Worktree `node_modules` not provisioned; vitest fails with "Cannot find dependency 'jsdom'"**
- **Found during:** Task 3 RED phase (first `npx vitest` invocation).
- **Issue:** Fresh worktree has no `leanshot/node_modules`; `npm install` was not run (and per memory `reference_sentry_capacitor_npm_install_blocker` would likely fail anyway).
- **Fix:** Symlinked `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules` (main checkout's installed deps). This is the documented workaround in memory `reference_npm_install_worktree_main_drift`.
- **Memory match:** `reference_npm_install_worktree_main_drift` + `reference_sentry_capacitor_npm_install_blocker`.
- **Side-effect:** `git status` shows `?? leanshot/node_modules` (the symlink itself isn't in the `leanshot/node_modules/` glob in .gitignore). Did NOT commit; kept as untracked worktree-local artifact.

**3. [Rule 3 - Blocking] Vitest 4.x `projects:` config masks default test discovery**
- **Found during:** Task 3 RED phase.
- **Issue:** `npx vitest run` against the new test file returned "No test files found" — the `vitest.config.ts` `projects:` block silently shadowed the default `test:` config (the documented bug in memory `reference_vitest_4_projects_config_masks_default`).
- **Fix:** Used `npx vitest run --config vite.config.ts <file>` per the memory's workaround.
- **Memory match:** `reference_vitest_4_projects_config_masks_default`. The plan's `<verify><automated>` block specifies `npx vitest run …` without `--config` override; the workaround is required.

### Other Notes (no rule violations)

**4. Added leading-dot hostname rejection (`p_hostname like '.%'`).**
- The plan body explicitly lists rejection patterns `'::', '/', '*', leading '.'` in the must-haves truths block, but the planner's verbose `<action>` only enumerates `'://'`, `'/'`, `'*'`. Implemented all four per the must-haves contract (D-15 defensive-layer integrity). Not a deviation — alignment.

## Threat Model Coverage (per plan `<threat_model>`)

| Threat ID | Disposition | Mitigation shipped |
|-----------|-------------|--------------------|
| T-41-02-01 EoP non-superadmin RPC call | mitigate | Both RPCs: `if not is_admin_at_least('superadmin') then raise 42501` server-side. |
| T-41-02-02 Look-alike hostname | mitigate | `validateCustomIframeUrl`: `URL` ctor + `allowlistHostnames.includes(parsed.hostname)` exact equality. Test T2 explicitly asserts `calendly.com.evil.com` returns null. |
| T-41-02-03 Subdomain expansion | mitigate | Same as T-41-02-02; `.includes()` on hostname array, NEVER `endsWith`. Test T1 asserts `sub.meet.example.org` rejected when allowlist has `meet.example.org`. |
| T-41-02-04 Anon reads hostnames | accept | Documented in table comment + RLS policy comment. Hostnames are non-secret. |
| T-41-02-05 Malformed hostname `meet.com/path` | mitigate | RPC second gate: `like '%://%' or '%/%' or '%*%' or '.%'` → 22023. |
| T-41-02-06 Repudiation — allowlist mutation not audited | mitigate | Both RPCs call `log_admin_action` with canonical 6-arg + `action_name = 'iframe_allowlist.{add,remove}'`. 90d retention via existing `audit_retention_cron` (no Phase 41 change). |
| T-41-02-07 Superadmin floods table | accept | Documented (superadmin self-DoS not credible). |
| T-41-02-08 Sandbox bypass | mitigate | `buildCustomIframeIframeHtml` writes the FIXED literal — no parameterisation. Test T5 asserts `allow-popups`/`allow-forms` are NOT in output. |

## Commits

- `9469079d` feat(41-02): iframe_allowlist table + RLS migration
- `b89a7454` feat(41-02): SECDEF RPCs add/remove_iframe_allowlist_hostname
- `83b74c70` test(41-02): RED — failing tests for validateCustomIframeUrl + buildCustomIframeIframeHtml
- `28a9f097` feat(41-02): BlockType custom_iframe + validateCustomIframeUrl + admin client wrappers

## Self-Check: PASSED

All 7 declared files exist on disk; all 4 commit hashes resolve in `git log --all`. Self-check ran from the worktree root with the spawn-time toplevel sentinel intact (cwd-drift guard clear).
