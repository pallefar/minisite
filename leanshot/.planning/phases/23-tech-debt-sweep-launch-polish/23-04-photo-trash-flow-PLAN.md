---
phase: 23-tech-debt-sweep-launch-polish
plan: 04
type: execute
wave: 3
depends_on: [23-01, 23-02, 23-03]
files_modified:
  - supabase/migrations/20270601000024_photos_trashed_at.sql
  - supabase/migrations/20270601000025_photos_trash_purge_cron.sql
  - supabase/functions/photos-trash-purge/index.ts
  - supabase/functions/photos-trash-purge/index.test.ts
  - supabase/functions/photos-trash-purge/deno.json
  - leanshot/src/components/dashboard/tabs/BodyTab.tsx
  - leanshot/src/components/dashboard/photos/PhotoTrashView.tsx
  - leanshot/src/components/dashboard/photos/PhotoTrashView.test.tsx
  - leanshot/src/lib/photo-trash.ts
  - leanshot/src/lib/photo-trash.test.ts
  - leanshot/tests/rls/photo-trash-rls.test.ts
autonomous: true
requirements: [DEBT-03]
tags: [photos, soft-delete, edge-function, cron, vertical-slice, rls]

must_haves:
  truths:
    - "User clicks the Trash icon on a photo in BodyTab → photo immediately disappears from the main grid → entry appears in the Trash view with a 'Restore' + 'Delete permanently now' affordance + 'auto-deletes in N days' label."
    - "User clicks Restore → photo reappears in main grid, disappears from Trash view; underlying row has `trashed_at = NULL`."
    - "User clicks Delete permanently now → row + Storage object are deleted immediately (skips the 30-day window); audit_logs entry written."
    - "Daily Supabase cron (`photos-trash-purge` schedule) invokes the Edge Function, which scans `WHERE trashed_at < NOW() - INTERVAL '30 days'`, deletes the DB rows, removes matching Storage objects from `photos` bucket, and writes one `audit_logs` entry per purge batch."
    - "Cross-tenant RLS holds: user A cannot SELECT, UPDATE (set trashed_at NULL on), or DELETE user B's photo rows via the trash UI's RPC path — live impersonation test confirms."
    - "PhotoTrashView is `React.lazy(() => import(...))` so the BodyTab entry chunk does NOT grow; index gz stays ≤24.5 kB."
  artifacts:
    - path: "supabase/migrations/20270601000024_photos_trashed_at.sql"
      provides: "ALTER TABLE public.photos ADD COLUMN trashed_at timestamptz NULL; partial index WHERE trashed_at IS NULL on (user_id, date desc) replaces the previous index; existing RLS policies extended/replaced to filter trashed status appropriately."
      contains: "trashed_at"
    - path: "supabase/migrations/20270601000025_photos_trash_purge_cron.sql"
      provides: "pg_cron schedule invoking the photos-trash-purge Edge Function via net.http_post once daily."
      contains: "cron.schedule"
    - path: "supabase/functions/photos-trash-purge/index.ts"
      provides: "Edge Function — query expired trash, delete Storage objects + DB rows, write audit log."
      min_lines: 80
    - path: "supabase/functions/photos-trash-purge/index.test.ts"
      provides: "Deno test coverage — happy path + per-row failure resilience + audit log emission."
      min_lines: 60
    - path: "leanshot/src/components/dashboard/photos/PhotoTrashView.tsx"
      provides: "Lazy-loaded trash UI — list trashed photos, Restore + Delete-now actions."
      min_lines: 70
      exports: ["PhotoTrashView"]
    - path: "leanshot/src/lib/photo-trash.ts"
      provides: "Pure RPC helpers: softDeletePhoto, restorePhoto, deletePhotoPermanently."
      min_lines: 40
      exports: ["softDeletePhoto", "restorePhoto", "deletePhotoPermanently"]
    - path: "leanshot/tests/rls/photo-trash-rls.test.ts"
      provides: "Live cross-tenant RLS impersonation test for the trash surface."
      min_lines: 60
  key_links:
    - from: "leanshot/src/components/dashboard/tabs/BodyTab.tsx"
      to: "leanshot/src/lib/photo-trash.ts"
      via: "import + onClick → softDeletePhoto({photo_id, user_id})"
      pattern: "softDeletePhoto"
    - from: "leanshot/src/components/dashboard/photos/PhotoTrashView.tsx"
      to: "supabase.from('photos').select('*').not('trashed_at', 'is', null)"
      via: "Trash-view fetch under user's own auth (RLS scopes)"
      pattern: "trashed_at"
    - from: "supabase/migrations/20270601000025_photos_trash_purge_cron.sql"
      to: "supabase/functions/photos-trash-purge/index.ts"
      via: "pg_cron + net.http_post invocation"
      pattern: "photos-trash-purge"
    - from: "supabase/functions/photos-trash-purge/index.ts"
      to: "storage.objects (photos bucket)"
      via: "supabase.storage.from('photos').remove([...]) after `set_config('storage.allow_delete_query', 'true', true)`"
      pattern: "storage\\.from\\('photos'\\)\\.remove"
    - from: "supabase/functions/photos-trash-purge/index.ts"
      to: "public.audit_logs"
      via: "INSERT one row per purge batch (Phase 7 pattern)"
      pattern: "audit_logs"
---

<objective>
DEBT-03 closeout — vertical-slice photo trash flow: migration + UI affordance + lazy trash view + Edge Function purge + pg_cron schedule + live RLS test, all shipping as one mergeable feature per MVP mode.

Per D-06: Trash affordance lives in the Photos section of `BodyTab.tsx` (close to the soft-delete origin, NOT under Settings).
Per D-07: Soft-delete sets `trashed_at = NOW()`; main grid filters `WHERE trashed_at IS NULL`; Trash view filters opposite. Restore nulls the column; Delete-now skips the 30-day window.
Per D-08: A daily pg_cron schedule invokes the `photos-trash-purge` Edge Function, which scans `WHERE trashed_at < NOW() - INTERVAL '30 days'`, deletes DB rows + Storage objects, logs to `audit_logs`.
Per D-09: Storage bucket lifecycle (Supabase Pro) is defense-in-depth ONLY — the cron is the source of truth.

Purpose: Closes the headline v1 polish item — users who tap "delete" today lose the photo immediately, no undo. Trash UX is the standard pattern users expect; without it any accidental delete is data loss.

Output: Working soft-delete + restore + 30-day auto-purge with cross-tenant RLS proof + audit-log compliance.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/phases/23-tech-debt-sweep-launch-polish/23-CONTEXT.md
@supabase/migrations/20260514000009_photos.sql
@leanshot/src/components/dashboard/tabs/BodyTab.tsx
@supabase/functions/account-delete/index.ts
@supabase/functions/account-delete/deno.json
@supabase/migrations/20260601000013_finalize_account_deletions_cron.sql

# Latest migration timestamp on main: 20270601000023_tier_effective_view.sql.
# New migrations use 20270601000024_ and 20270601000025_ (strict <14-digits>_name.sql per
# [[reference-supabase-migration-filename-regex]] — NO letter suffix).

# Migration pattern gotchas (per [[reference-supabase-migration-gotchas]]):
#   - Partial-index expression must be IMMUTABLE. `WHERE trashed_at IS NULL` qualifies — NULL test is IMMUTABLE.
#   - SECURITY DEFINER functions need `extensions` in search_path if calling digest()/uuid_generate_*.
#   - storage.objects DELETE inside the Edge Function needs `set_config('storage.allow_delete_query', 'true', true)` before the DELETE OR use supabase.storage.from('photos').remove([...]) which handles it via the Storage API. PREFER the Storage API path — cleaner + doesn't bypass any Storage triggers/quota tracking.

# Edge Function deploy gotchas (per [[reference-supabase-edge-function-deploy]]):
#   - Bundler ignores import_map.json — use esm.sh URLs for bare imports OR add to deno.json imports.
#   - verify_jwt defaults true — cron invocation needs a service-role JWT in the Authorization header. The pg_cron net.http_post() call must set headers explicitly.
#   - Gateway overrides response Content-Type to text/plain (no impact here — function returns JSON, not HTML).

# Cron migration pattern reference: 20260601000013_finalize_account_deletions_cron.sql
# Uses cron.schedule(name, cron_expr, $$ ... do-block ...$$). Mirror that shape — but instead of
# calling a SECURITY DEFINER pgsql function, call `net.http_post(url, headers, body)` to invoke
# the Edge Function. URL: https://<project-ref>.supabase.co/functions/v1/photos-trash-purge.
# Authorization header: `Bearer <service-role-jwt>` pulled from `vault.decrypted_secrets` where
# `name = 'service_role_key'` — per [[project-phase19-pre-plan-state]] this Vault entry is still
# pending user-side setup. If absent at deploy time, the cron will fail with 401 and the
# Edge Function's startup health check (see [[reference-vendor-gated-send-health-check]]) should
# log a Sentry breadcrumb + no-op. Document the dependency in the SUMMARY.

# account-delete Edge Function structure (supabase/functions/account-delete/index.ts):
# - Deno.serve handler
# - Auth check (service-role bearer)
# - DB queries + Storage deletes inside a try/catch per-row loop
# - audit_logs INSERT after batch completes
# - Returns { purged: N, errors: K }
# Mirror that shape for photos-trash-purge.

# BodyTab.tsx photos section (lines ~230-280 per current main):
# - photos array from useStore((s) => s.photos)
# - <VirtuosoGrid> renders each photo (Phase 16 Plan 16-01 wrap for 200+ photo OOM fix)
# - storageTransformUrl helper builds the signed/transformed URL
# - Trash button placement: as a small affordance ON HOVER over each grid cell OR a per-photo overflow menu. Recommend overflow menu (3-dot button) → opens a small popover with [Open / Trash]. Keeps the grid visually clean.
# - "View Trash" entry: a small text-link near the Photos section header, hidden when no trashed photos exist (queried separately on mount).

<interfaces>
photos-trashed-at migration shape (20270601000024):
```sql
alter table public.photos
  add column trashed_at timestamptz null;

-- Replace the existing photos_user_date_idx with a partial index that
-- excludes trashed rows from the hot-path (main grid query).
drop index if exists public.photos_user_date_idx;
create index photos_user_date_active_idx on public.photos (user_id, date desc)
  where trashed_at is null;

-- Companion index for the Trash view + cron scan.
create index photos_user_trashed_idx on public.photos (user_id, trashed_at desc)
  where trashed_at is not null;

-- RLS policies — existing select/update/delete policies already scope by auth.uid().
-- No new policies required; trashed_at is a column on rows the user already owns.
-- But document this in a comment block so future readers don't re-add policies.
```

cron migration shape (20270601000025):
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;  -- for net.http_post

select cron.schedule(
  'photos-trash-purge',
  '15 3 * * *',  -- 03:15 UTC daily, offset from existing 03:00/04:00/05:00 crons
  $$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/photos-trash-purge',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```
Replace `<project-ref>` with `ytnsipxxmzgaebkqmokp` at migration write time. Per project rule the cron is a no-op until the Vault service_role_key is loaded — document in SUMMARY as a known-pending dependency.

photos-trash-purge Edge Function shape (TypeScript / Deno):
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';

serve(async (req) => {
  // 1. Auth gate — service-role JWT
  // 2. const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // 3. const { data: expired } = await supabase.from('photos').select('user_id, photo_id, storage_path').lt('trashed_at', new Date(Date.now() - 30*86400e3).toISOString()).limit(500);
  // 4. for each row: try { delete storage object } catch { collect error } then delete DB row
  // 5. INSERT INTO audit_logs (action, target_type, payload) VALUES ('photos_trash_purge', 'photos', {purged: N, errors: K});
  // 6. return new Response(JSON.stringify({purged: N, errors: K}), { headers: {'Content-Type': 'application/json'}});
});
```

src/lib/photo-trash.ts pure helpers:
```typescript
export async function softDeletePhoto(photo_id: string): Promise<void>;
// supabase.from('photos').update({ trashed_at: new Date().toISOString() }).eq('photo_id', photo_id);

export async function restorePhoto(photo_id: string): Promise<void>;
// supabase.from('photos').update({ trashed_at: null }).eq('photo_id', photo_id);

export async function deletePhotoPermanently(photo_id: string, storage_path: string): Promise<void>;
// supabase.storage.from('photos').remove([storage_path]);
// supabase.from('photos').delete().eq('photo_id', photo_id);
// (RLS scopes both to caller's own rows — no explicit user_id filter needed.)
```

PhotoTrashView props:
```typescript
export interface PhotoTrashViewProps {
  open: boolean;
  onClose: () => void;
}
```
Lazy-loaded from BodyTab.tsx. Renders a `<Modal>` or `<Sheet>` containing a grid of trashed photos + per-cell Restore/Delete-now buttons + "auto-deletes in {days_remaining} days" label per photo.

RLS test slug prefix:
```typescript
const PHOTO_TRASH_PREFIX = 'phototrash-';
afterAll(() => cleanupTestPages(PHOTO_TRASH_PREFIX));
```
</interfaces>

# IMPORTANT — parallel-executor git isolation
# If Plans 23-03 + 23-04 land in the same wave (per current wave assignment 23-03 is wave 2 and
# 23-04 is wave 3, so this is SEQUENTIAL — should be safe). But if execute-phase batches them
# together, per [[feedback-parallel-executor-git-isolation]] use `git commit -- <pathspec>` to
# avoid the shared-index sweep. Each task should commit only its own files_modified subset.

# IMPORTANT — Supabase CLI in worktrees
# If executing in a worktree, per [[reference-supabase-worktree-temp-state]] copy
# supabase/.temp/* from main checkout before `supabase db push --linked`.
# Per [[reference-parallel-supabase-migration-push-interference]] do NOT push migrations from
# two worktrees concurrently — serialize via the orchestrator.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration — add photos.trashed_at + replace indexes</name>
  <files>supabase/migrations/20270601000024_photos_trashed_at.sql</files>
  <action>Create the migration per the `<interfaces>` shape. ALTER TABLE adds `trashed_at timestamptz null`. DROP the existing `photos_user_date_idx` and CREATE two partial indexes: one for active (main-grid hot path, `WHERE trashed_at IS NULL`), one for trashed (cron scan + Trash view, `WHERE trashed_at IS NOT NULL`). Add a comment block explaining that NO new RLS policies are required — existing `photos_select_own` / `_update_own` / `_delete_own` already scope by `auth.uid() = user_id` and operate on rows the user already owns regardless of `trashed_at` value. Filename strictly `20270601000024_photos_trashed_at.sql` — NO letter suffix per [[reference-supabase-migration-filename-regex]]. Run `cd /Users/karstenhaldan/minisite && supabase db push --linked --dry-run` first and grep for `^Skipping migration` — if any match, the filename regex is wrong; abort + fix before live push.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db push --linked --dry-run 2>&1 | tee /tmp/migration-dryrun.txt | tail -20; grep -c "^Skipping" /tmp/migration-dryrun.txt | grep -q "^0$" && echo "no skipped migrations"</automated>
  </verify>
  <done>Migration file exists with correct filename, dry-run reports zero skipped migrations, includes both partial indexes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: photo-trash.ts + photo-trash.test.ts pure helpers</name>
  <files>leanshot/src/lib/photo-trash.ts, leanshot/src/lib/photo-trash.test.ts</files>
  <behavior>
    - `softDeletePhoto(photo_id)` calls supabase.from('photos').update({ trashed_at: <ISO now> }).eq('photo_id', photo_id) — RLS scopes to caller's rows.
    - `restorePhoto(photo_id)` updates trashed_at to null.
    - `deletePhotoPermanently(photo_id, storage_path)` calls storage.from('photos').remove([storage_path]) THEN from('photos').delete().eq('photo_id', photo_id). Storage failure must NOT block DB delete (log + continue) — the DB row is authoritative.
    - All three return Promise<void>; throw on DB error so callers can show a toast.
  </behavior>
  <action>Create `leanshot/src/lib/photo-trash.ts` exporting the three helpers per the `<interfaces>` shape. Use the existing `supabase` singleton import (`@/lib/supabase` or wherever). NO `s.user!` — let RLS do the scoping. Create `leanshot/src/lib/photo-trash.test.ts` with vitest mocking the supabase client: cover (a) softDelete passes ISO timestamp; (b) restore passes null; (c) deletePermanently calls storage.remove THEN db.delete in that order; (d) deletePermanently continues to db.delete even when storage.remove rejects; (e) all three reject when db query rejects.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/photo-trash.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>≥5 test cases, all pass, helpers exported.</done>
</task>

<task type="auto">
  <name>Task 3: PhotoTrashView.tsx (lazy) + BodyTab.tsx wire-up</name>
  <files>leanshot/src/components/dashboard/photos/PhotoTrashView.tsx, leanshot/src/components/dashboard/photos/PhotoTrashView.test.tsx, leanshot/src/components/dashboard/tabs/BodyTab.tsx</files>
  <action>Create `leanshot/src/components/dashboard/photos/PhotoTrashView.tsx` exporting PhotoTrashView per the `<interfaces>` props. Internal: useState for trashed photos array; useEffect fetches `supabase.from('photos').select('*').not('trashed_at', 'is', null).order('trashed_at', { ascending: false })` on open; grid renders each with `storageTransformUrl(storage_path)` + Restore button (calls `restorePhoto` from Task 2) + "Delete now" button (calls `deletePhotoPermanently`) + "auto-deletes in {30 - days_since_trashed} days" label. Empty state when array is empty: "No photos in trash." Wraps `<Modal>` or `<Sheet>` from `src/components/ui/`. Edit `BodyTab.tsx`: add `const PhotoTrashView = lazy(() => import('@/components/dashboard/photos/PhotoTrashView').then((m) => ({ default: m.PhotoTrashView })));` at module scope. In the photos section UI: (a) add a per-photo overflow-menu button (3-dot icon) that on click reveals [Open, Trash] — Trash calls `softDeletePhoto(photo.photo_id)` and optimistically removes from the displayed grid; (b) add a "View Trash" text-link in the section header that opens the lazy modal. Run `cd leanshot && npm run build`; confirm a `PhotoTrashView-<hash>.js` chunk appears in `dist/assets/`. Add Vitest spec for PhotoTrashView covering: open=false renders nothing, fetch + render trashed photos, Restore calls restorePhoto + removes from view, Delete-now calls deletePhotoPermanently + removes from view, empty state.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/dashboard/photos/PhotoTrashView.test.tsx --reporter=verbose 2>&1 | tail -20; cd leanshot && npm run build 2>&1 | tail -20; ls leanshot/dist/assets/PhotoTrashView-*.js 2>/dev/null && echo "lazy chunk exists"; cd leanshot && bash scripts/assert-clinic-bundle-budget.sh 2>&1 | tail -5</automated>
  </verify>
  <done>PhotoTrashView lazy-chunked, tests pass, BodyTab wires soft-delete + opens Trash view, bundle budget passes.</done>
</task>

<task type="auto">
  <name>Task 4: photos-trash-purge Edge Function + Deno test + deploy</name>
  <files>supabase/functions/photos-trash-purge/index.ts, supabase/functions/photos-trash-purge/index.test.ts, supabase/functions/photos-trash-purge/deno.json</files>
  <action>Create `supabase/functions/photos-trash-purge/` directory with three files. (1) `index.ts` per the `<interfaces>` shape: Deno.serve handler, auth gate on service-role bearer, query expired trash (`lt('trashed_at', new Date(Date.now() - 30*86400e3).toISOString()).limit(500)`), per-row try/catch loop calling `supabase.storage.from('photos').remove([row.storage_path])` then `supabase.from('photos').delete().eq('photo_id', row.photo_id)`, single `audit_logs` INSERT after batch with payload `{purged, errors, batch_ts}`, return JSON `{purged, errors}`. Use esm.sh URL for `@supabase/supabase-js` per [[reference-supabase-edge-function-deploy]] — do NOT rely on import_map.json. Health check at startup: if `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` missing, log warning + return 500 (per [[reference-vendor-gated-send-health-check]]). (2) `index.test.ts`: Deno test file named per project rule [[reference-deno-test-discovery]] (`<name>.test.ts` exact). Mock supabase client, cover: happy path (5 expired rows → 5 purged + audit_log entry); per-row failure resilience (3 rows, 1 storage delete throws → 3 purged + errors=1 + DB rows for all 3 still deleted? — actually no, if storage throws we SHOULD still delete the DB row, but log it; verify behavior matches that decision); auth gate (no bearer → 401); empty batch (0 expired → 0 purged, no audit log INSERT or single INSERT with `purged:0` — choose one and codify in test). (3) `deno.json`: copy from `supabase/functions/account-delete/deno.json` BUT **strip the `--import-map=../import_map.json` flag from the `test` task** — the index.ts uses direct esm.sh URLs per [[reference-supabase-edge-function-deploy]] and does not depend on import_map.json; leaving the flag in causes Deno to apply two resolution strategies and silently prefer one. Final test task: `deno test --allow-all` (no `--import-map`). Lint + fmt tasks copy verbatim. Deploy: `cd /Users/karstenhaldan/minisite && supabase functions deploy photos-trash-purge --project-ref ytnsipxxmzgaebkqmokp` — confirms function lands.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/supabase/functions/photos-trash-purge && deno test --allow-all 2>&1 | tail -20; cd /Users/karstenhaldan/minisite && supabase functions list 2>&1 | grep photos-trash-purge</automated>
  </verify>
  <done>Edge Function exists, Deno tests pass, function deployed and listed by supabase functions list.</done>
</task>

<task type="auto">
  <name>Task 5: Cron migration + live RLS cross-tenant test</name>
  <files>supabase/migrations/20270601000025_photos_trash_purge_cron.sql, leanshot/tests/rls/photo-trash-rls.test.ts</files>
  <action>(A) Create the cron migration per `<interfaces>` shape: `select cron.schedule('photos-trash-purge', '15 3 * * *', $$ select net.http_post(url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/photos-trash-purge', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), 'Content-Type', 'application/json'), body := '{}'::jsonb); $$);` Filename: `20270601000025_photos_trash_purge_cron.sql`. Apply via `cd /Users/karstenhaldan/minisite && supabase db push --linked` AFTER Task 1's migration is live. Verify cron present via `supabase db query --linked "select jobname, schedule from cron.job where jobname='photos-trash-purge';"` per [[reference-supabase-db-query-linked]]. Note in plan SUMMARY that the cron will fail 401 until the Vault `service_role_key` entry exists (still pending per [[project-phase19-pre-plan-state]]).
  (B) Create `leanshot/tests/rls/photo-trash-rls.test.ts` declaring `const PHOTO_TRASH_PREFIX = 'phototrash-';` at file scope per [[feedback-rls-per-file-slug-prefix]]. Use service-role-minted JWT via headers.Authorization per [[reference-rls-fixture-gotruclient-flake]] — NOT signInWithPassword. Scenarios: (i) user A inserts photo, soft-deletes via softDeletePhoto helper → user B (impersonated via separate auth context) cannot SELECT user A's trashed row; (ii) user B attempts UPDATE `trashed_at = NULL` on user A's photo_id → fails with 0 rows affected (RLS denies) or 42501; (iii) user B attempts DELETE on user A's photo_id → fails; (iv) main-grid SELECT for user A correctly excludes the trashed photo (`WHERE trashed_at IS NULL` partial index hot path); (v) Trash-view SELECT for user A returns the trashed photo. afterAll cleanup uses `PHOTO_TRASH_PREFIX`. describeIfLive guard for env vars.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db push --linked 2>&1 | tail -10; cd /Users/karstenhaldan/minisite && supabase db query --linked "select jobname, schedule from cron.job where jobname='photos-trash-purge';" 2>&1; cd leanshot && SUPABASE_URL="${SUPABASE_URL:-}" SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}" SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}" npx vitest run tests/rls/photo-trash-rls.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>Cron migration applied + visible in cron.job; RLS test ≥5 scenarios pass live OR self-skips cleanly when env vars absent.</done>
</task>

</tasks>

<verification>
1. `cd leanshot && npm run lint && npm run typecheck && npm run test:unit && npm run unused-check` all exit 0 (the last courtesy of Plan 23-02).
2. `cd leanshot && npm run build && bash scripts/assert-clinic-bundle-budget.sh` exits 0; PhotoTrashView lazy chunk emitted, index gz ≤24.5 kB.
3. `cd /Users/karstenhaldan/minisite/supabase/functions/photos-trash-purge && deno test --allow-all` passes.
4. `supabase db query --linked "select jobname, schedule from cron.job where jobname='photos-trash-purge';"` returns one row.
5. Live RLS test: ≥5 scenarios pass against `ytnsipxxmzgaebkqmokp`.
6. Manual smoke: BodyTab → 3-dot menu on a photo → Trash → photo disappears → View Trash → photo appears → Restore → photo returns to main grid.
</verification>

<success_criteria>
- DEBT-03 closed: soft-delete + 30-day restore + permanent-delete + cron purge all live.
- Bundle ceiling preserved (24.5 kB gz index).
- Cross-tenant RLS proof on file via live impersonation test.
- audit_logs entry per purge batch (Phase 7 compliance pattern).
- Cron present on linked project (no-op until Vault service_role_key loaded — flagged in SUMMARY).
</success_criteria>

<output>
After completion, create `.planning/phases/23-tech-debt-sweep-launch-polish/23-04-SUMMARY.md` with: migration filenames + dry-run skip count (must be 0), PhotoTrashView chunk size + BodyTab delta, Deno test pass/fail counts, supabase db query output confirming cron present, RLS test status (live / skipped + which scenarios), and explicit note about the Vault service_role_key dependency for cron's first successful run.
</output>
