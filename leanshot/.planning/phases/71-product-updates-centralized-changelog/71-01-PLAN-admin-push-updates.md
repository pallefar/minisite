---
plan: "71-01-admin-push-updates"
phase: "71"
wave: 1
depends_on: []
autonomous: true
type: execute
requirements:
  - PU-01
  - PU-02
  - PU-03
files_modified:
  - supabase/migrations/20290110000001_p71_changelog_status_version.sql
  - leanshot/src/lib/admin/product-updates.ts
  - leanshot/src/lib/admin/__tests__/product-updates.test.ts
  - leanshot/src/admin/modules/product-updates/ProductUpdatesLayout.tsx
  - leanshot/src/admin/modules/product-updates/EntryListView.tsx
  - leanshot/src/admin/modules/product-updates/EntryEditorView.tsx
  - leanshot/src/admin/modules/product-updates/__tests__/EntryEditorView.test.tsx
  - leanshot/src/lib/admin/modules.ts
  - leanshot/src/lib/changelog/changelog-store.ts
  - leanshot/src/lib/changelog/__tests__/changelog-store-status-filter.test.ts
  - leanshot/vitest.config.ts
must_haves:
  truths:
    - "admin-can-open-/admin/product-updates"
    - "admin-can-author-entry-title-autoslug-version-markdown-body-status"
    - "admin-sees-live-markdown-preview-matching-whatsnewdrawer-renderer"
    - "admin-can-save-draft-then-publish-then-archive"
    - "non-admins-see-only-status-published-entries-in-drawer"
    - "drafts-and-archived-entries-never-appear-for-non-admins"
    - "all-write-paths-log_admin_action-audit-row"
    - "migration-applies-idempotently-on-forward-timestamp"
    - "existing-whatsnewdrawer-and-usechangelog-behavior-unregressed"
  artifacts:
    - path: "supabase/migrations/20290110000001_p71_changelog_status_version.sql"
      provides: "Additive version/status/created_by columns + draft-hidden RLS SELECT"
      contains: "add column if not exists status"
    - path: "leanshot/src/lib/admin/product-updates.ts"
      provides: "RLS-gated PostgREST CRUD wrapper + log_admin_action audit calls"
      exports: ["listEntries", "createEntry", "updateEntry", "publishEntry", "archiveEntry"]
    - path: "leanshot/src/admin/modules/product-updates/ProductUpdatesLayout.tsx"
      provides: "Pathname-routed admin module (list + editor views)"
      min_lines: 40
    - path: "leanshot/src/admin/modules/product-updates/EntryEditorView.tsx"
      provides: "Authoring form with auto-slug + live WhatsNewDrawer-renderer preview"
      min_lines: 60
  key_links:
    - from: "leanshot/src/lib/admin/modules.ts"
      to: "leanshot/src/admin/modules/product-updates/ProductUpdatesLayout.tsx"
      via: "explicit FILE lazy import (not directory barrel)"
      pattern: "product-updates/ProductUpdatesLayout"
    - from: "leanshot/src/admin/modules/product-updates/EntryEditorView.tsx"
      to: "leanshot/src/components/changelog/WhatsNewDrawer"
      via: "reuse SafeMarkdown renderer for live preview"
      pattern: "WhatsNewDrawer|SafeMarkdown"
    - from: "leanshot/src/lib/changelog/changelog-store.ts"
      to: "changelog_entries.status"
      via: "PostgREST .eq('status','published') filter (defense-in-depth)"
      pattern: "status.*published"
    - from: "leanshot/src/lib/admin/product-updates.ts"
      to: "log_admin_action"
      via: "supabase.rpc audit call after each write"
      pattern: "log_admin_action"
---

<objective>
Plan 01 — Admin "Push Updates" module + draft-hidden schema/RLS + published-only in-app filter.

Delivers the self-contained authoring half of Phase 71 (locked decision 2: admin UI first; the table + RLS already exist from Phase 42). An `admin` opens `/admin/product-updates`, lists existing changelog entries, authors a new one (title → auto-slug, version, markdown body with a live preview rendered through the EXACT WhatsNewDrawer renderer), saves it as a draft, then publishes / archives it. Drafts and archived entries are hidden from non-admins by BOTH a tightened RLS SELECT policy AND a `useChangelog` query filter (defense in depth). All writes route through a `src/lib/admin/product-updates.ts` wrapper that uses RLS-gated PostgREST writes and records a `log_admin_action` audit row per the admin write convention.

Reuse, do NOT rebuild: this plan EXTENDS `changelog_entries` (additive migration only), reuses the `WhatsNewDrawer` markdown renderer for preview, and follows the ModerationLayout / AllowlistPage admin templates.

Purpose: PU-01 (admin authoring UI) + PU-02 (additive schema + draft-hidden RLS) + PU-03 (in-app published-only surfacing). Unblocks Plan 02 (store-notes sync), which queries `status='published'` + `version`.

Output: 1 migration, the admin module (3 components), the CRUD wrapper, the `useChangelog` filter change, and 3 test files registered in the correct vitest projects.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/71-product-updates-centralized-changelog/71-CONTEXT.md

# Closest reuse templates (read before writing — match their patterns):
@leanshot/src/admin/modules/moderation/ModerationLayout.tsx
@leanshot/src/components/admin/embeds/AllowlistPage.tsx
@leanshot/src/components/admin/embeds/AddHostnameForm.tsx
@leanshot/src/lib/admin/iframe-allowlist.ts
@leanshot/src/components/changelog/WhatsNewDrawer.tsx
@leanshot/src/lib/changelog/changelog-store.ts
@leanshot/src/lib/changelog/drawer-trigger.ts
@leanshot/src/lib/admin/modules.ts
@supabase/migrations/20270704000010_changelog_entries.sql
@supabase/migrations/20270704000012_changelog_rls.sql

<interfaces>
<!-- Contracts the executor needs. Use these directly — no extra codebase exploration. -->

Existing changelog_entries schema (20270704000010):
  changelog_entries(id uuid pk, slug text unique NOT NULL, title text NOT NULL,
    body_md text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())
  Index: changelog_entries_published_at_desc_idx (published_at DESC)
  Trigger: changelog_entries_touch_updated_at BEFORE UPDATE sets updated_at = now()

Existing RLS (20270704000012) — EXTEND additively, do NOT recreate the table:
  changelog_entries_select_authenticated  FOR SELECT TO authenticated USING (true)   ← TIGHTEN this
  changelog_entries_insert_admin           FOR INSERT WITH CHECK is_admin_at_least('admin')
  changelog_entries_update_admin           FOR UPDATE USING/CHECK is_admin_at_least('admin')
  changelog_entries_delete_admin           FOR DELETE USING is_admin_at_least('admin')

Audit RPC (20290108000006 — current canonical signature, returns bigint):
  public.log_admin_action(
    p_action_name text, p_target_user_id uuid,
    p_table_name text default null, p_row_pk text default null,
    p_before jsonb default null, p_after jsonb default null
  ) returns bigint   -- gate: is_admin_at_least('staff'); granted to authenticated

ChangelogEntry type (src/lib/changelog/drawer-trigger.ts):
  { id: string; slug: string; title: string; body_md: string; published_at: string }

useChangelog SELECT (src/lib/changelog/changelog-store.ts ~line 69):
  supabase.from('changelog_entries')
    .select('id, slug, title, body_md, published_at')
    .order('published_at', {ascending:false}).limit(20)

WhatsNewDrawer renderer (src/components/changelog/WhatsNewDrawer.tsx):
  internal function SafeMarkdown({ source }: { source: string }) — DOMPurify + react-markdown
  + rehype-raw + urlTransform. NOT currently exported. Export it to reuse in the editor preview.

ADMIN_MODULES entry shape (src/lib/admin/modules.ts):
  { key, label, route, icon, lazy: () => Promise<{default}>, flagKey, minRole }
  cascade-56: register `lazy` as an explicit FILE import
  (import('@/admin/modules/product-updates/ProductUpdatesLayout')) NOT a directory barrel,
  or Rollup names the chunk index-*.js and trips assert-vendor-react-size.sh.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Additive migration — version/status/created_by columns + draft-hidden RLS SELECT</name>
  <files>supabase/migrations/20290110000001_p71_changelog_status_version.sql</files>
  <action>
Create a NEW forward-timestamped migration (20290110000001 — strictly after the newest tree migration 20290108000011 per CONTEXT) that ADDITIVELY evolves `public.changelog_entries`. Do NOT recreate the table, the index, or the existing INSERT/UPDATE/DELETE policies (PU-02).

1. `ALTER TABLE public.changelog_entries ADD COLUMN IF NOT EXISTS version text;` (nullable — historical Phase-42 rows have no version).
2. `ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'` with a named CHECK constraint allowing only `'draft' | 'published' | 'archived'`. Add the CHECK idempotently: guard with `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'changelog_entries_status_check')` inside a `DO $$ ... $$` block, then `ALTER TABLE ... ADD CONSTRAINT changelog_entries_status_check CHECK (status IN ('draft','published','archived'))`. DEFAULT 'published' so existing rows + the WhatsNewDrawer behavior are unchanged (PU-03 non-regression).
3. `ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;` (nullable — backfilled only for new rows).
4. Add a partial index for admin list ordering: `CREATE INDEX IF NOT EXISTS changelog_entries_status_published_at_idx ON public.changelog_entries (status, published_at DESC);`
5. TIGHTEN the SELECT policy so non-admins see only published rows (defense-in-depth half 1). Idempotent drop-then-bare-create (CONTEXT: remote PG has no `CREATE POLICY IF NOT EXISTS`):
   - `DROP POLICY IF EXISTS changelog_entries_select_authenticated ON public.changelog_entries;`
   - `DROP POLICY IF EXISTS changelog_entries_select_published_or_admin ON public.changelog_entries;`
   - `CREATE POLICY changelog_entries_select_published_or_admin ON public.changelog_entries FOR SELECT TO authenticated USING (status = 'published' OR public.is_admin_at_least('admin'::public.admin_role));`
   Leave the existing INSERT/UPDATE/DELETE admin policies untouched (already `is_admin_at_least('admin')`).
6. Add a trailing `COMMENT ON COLUMN public.changelog_entries.status IS 'Phase 71 PU-02: draft|published|archived; non-admins SELECT published only via RLS.';`

Header comment must name Phase 71 / PU-02, the forward-timestamp rationale, and that this is purely additive (no destructive DDL). Do NOT use `CREATE POLICY IF NOT EXISTS` anywhere.
  </action>
  <verify>
    <automated>cd /tmp/leanshot-p71 && grep -v '^--' supabase/migrations/20290110000001_p71_changelog_status_version.sql | grep -qi "add column if not exists status" && grep -v '^--' supabase/migrations/20290110000001_p71_changelog_status_version.sql | grep -qi "status = 'published' or public.is_admin_at_least" && ! grep -i "create policy if not exists" supabase/migrations/20290110000001_p71_changelog_status_version.sql && ! grep -iE "drop table|create table" supabase/migrations/20290110000001_p71_changelog_status_version.sql && echo MIGRATION_OK</automated>
  </verify>
  <done>Migration adds version/status/created_by + CHECK + index idempotently, replaces the open SELECT policy with published-or-admin, uses bare CREATE POLICY after DROP, and contains no destructive DDL.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CRUD wrapper src/lib/admin/product-updates.ts + audit calls + tests</name>
  <files>leanshot/src/lib/admin/product-updates.ts, leanshot/src/lib/admin/__tests__/product-updates.test.ts</files>
  <behavior>
    - listEntries(client) returns all rows (admin sees drafts too via RLS) ordered published_at DESC; maps to a typed ProductUpdateEntry { id, slug, title, body_md, version, status, published_at }.
    - createEntry(client, {title, slug, version, body_md, status}) inserts a row with created_by = auth user id; on success calls log_admin_action('changelog.create', null, 'changelog_entries', <new id>, null, <after jsonb>).
    - updateEntry(client, id, patch) updates the row; calls log_admin_action('changelog.update', null, 'changelog_entries', id, <before>, <after>).
    - publishEntry(client, id) sets status='published' + published_at=now(); audits action 'changelog.publish'.
    - archiveEntry(client, id) sets status='archived'; audits action 'changelog.archive'.
    - slugify(title) helper lowercases, trims, replaces non-alphanumerics with '-', collapses repeats, strips leading/trailing '-'.
    - A PostgREST/RLS denial (code '42501') propagates as a thrown error (caller surfaces dual-layer copy).
  </behavior>
  <action>
Mirror `src/lib/admin/iframe-allowlist.ts` (accept the caller's authenticated `SupabaseClient` so RLS auth.uid() picks up the admin JWT — Pattern S1). Export `ProductUpdateEntry`, `slugify`, `listEntries`, `createEntry`, `updateEntry`, `publishEntry`, `archiveEntry`.

Writes use direct RLS-gated PostgREST (`.insert` / `.update`), NOT a SECDEF RPC (CONTEXT: RLS already gates these). After each successful write call `client.rpc('log_admin_action', { p_action_name, p_target_user_id: null, p_table_name: 'changelog_entries', p_row_pk: <id>, p_before, p_after })` to match the admin write convention; audit failure must NOT roll back the write (best-effort: swallow audit-only errors with a console.warn, never throw from the audit leg). Set `created_by` from `(await client.auth.getUser()).data.user?.id ?? null` on create.

Write `src/lib/admin/__tests__/product-updates.test.ts` in the `src-lib-unit` vitest project (path `src/lib/**/__tests__/*.test.ts` already in its include). Use a chainable supabase mock (see `src/lib/changelog/__tests__` or `src/lib/changelog/changelog-store.test.ts` `makeBuilder` for the chainable-mock style — NOT audit-logs-rls.test.ts, which is a live-DB `describeIfLive` test) asserting: createEntry calls `.insert` then `.rpc('log_admin_action', ...)` with action 'changelog.create'; publishEntry sets status published + published_at and audits 'changelog.publish'; slugify('Hello, World! v2') === 'hello-world-v2'; a 42501 insert error throws.
  </action>
  <verify>
    <automated>cd /tmp/leanshot-p71/leanshot && npx vitest run --config vitest.config.ts --project=src-lib-unit src/lib/admin/__tests__/product-updates.test.ts 2>&1 | grep -qE "Test Files.*passed|passed \(" && echo WRAPPER_TESTS_PASS</automated>
  </verify>
  <done>Wrapper exports the 5 CRUD functions + slugify, every write path calls log_admin_action, audit failures don't throw, and the src-lib-unit test passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Admin module (ProductUpdatesLayout + list + editor with live preview), register in ADMIN_MODULES, add published-filter to useChangelog</name>
  <files>leanshot/src/admin/modules/product-updates/ProductUpdatesLayout.tsx, leanshot/src/admin/modules/product-updates/EntryListView.tsx, leanshot/src/admin/modules/product-updates/EntryEditorView.tsx, leanshot/src/admin/modules/product-updates/__tests__/EntryEditorView.test.tsx, leanshot/src/lib/admin/modules.ts, leanshot/src/lib/changelog/changelog-store.ts, leanshot/src/lib/changelog/__tests__/changelog-store-status-filter.test.ts</files>
  <behavior>
    - EntryEditorView: typing a title auto-fills the slug field (slugify) until the user manually edits slug; the live-preview pane renders body_md through the SAME SafeMarkdown renderer the WhatsNewDrawer uses (identical sanitization).
    - useChangelog SELECT adds .eq('status','published') so even an admin's drawer (the consumer surface) shows only published — drafts never leak to the in-app drawer (defense-in-depth half 2, PU-03).
    - changelog-store-status-filter test asserts the SELECT chain includes status='published'.
  </behavior>
  <action>
Export `SafeMarkdown` from `src/components/changelog/WhatsNewDrawer.tsx` (add `export` to the existing `function SafeMarkdown` — no behavior change) so the editor preview reuses the identical react-markdown + DOMPurify renderer (CONTEXT: admin sees exactly what users see; XSS sanitization identical). Do not duplicate the renderer.

Build the admin module under `leanshot/src/admin/modules/product-updates/` following ModerationLayout (pathname-routed, no react-router):
- `ProductUpdatesLayout.tsx` (default export): resolveView on `/admin/product-updates` (list) vs `/admin/product-updates/new` and `/admin/product-updates/:id` (editor). Page-level admin re-check via `supabase.auth.getUser()` + `profiles.admin_role` like AllowlistPage (Pattern S1), render NotAuthorizedCard on denial.
- `EntryListView.tsx`: calls `listEntries(supabase)`, renders a table with title / version / status badge / published_at + "New update" button and per-row Edit; loading (Skeleton) / empty (EmptyState) / error (Retry) states like AllowlistPage.
- `EntryEditorView.tsx`: form (reuse Input + Button + Card like AddHostnameForm) for title, slug (auto-filled from slugify(title) until manually dirtied), version, status select (draft/published/archived), and a markdown `<textarea>` for body_md with a side-by-side live preview using the exported `SafeMarkdown`. Save calls createEntry / updateEntry; a Publish button calls publishEntry; an Archive button calls archiveEntry. On 42501 show dual-layer denial copy. Toast on success via useToast.

Register the module in `src/lib/admin/modules.ts` ADMIN_MODULES: add ONE entry `{ key: 'product-updates', label: 'Push Updates', route: 'product-updates', icon: <a lucide icon already imported, e.g. RocketIcon or import Megaphone>, lazy: () => import('@/admin/modules/product-updates/ProductUpdatesLayout'), flagKey: 'admin.product-updates.enabled', minRole: 'admin' as AdminRole }`. The lazy import MUST be the explicit FILE path (cascade-56). Add a short comment matching the neighboring entries' style. AdminShell URL-prefix routing covers sub-routes automatically — do NOT add a hardcoded switch branch.

Modify `src/lib/changelog/changelog-store.ts`: add `.eq('status', 'published')` to the `changelog_entries` SELECT chain (PU-03 defense-in-depth half 2). Keep the existing `.select(...)`, `.order('published_at', {ascending:false})`, `.limit(20)`.

Tests:
- `src/admin/modules/product-updates/__tests__/EntryEditorView.test.tsx` in `src-ui-unit` project (include `src/components/**` AND any `src/**` ui test? NOTE: the src-ui-unit include is scoped to `src/components/**`). To land this test in src-ui-unit, EITHER place the test under a path the project already includes OR widen the src-ui-unit include to also match `src/admin/**/__tests__/*.test.tsx`. Choose the include-widen: add `'src/admin/**/__tests__/*.test.tsx'` to the src-ui-unit project `include` array in vitest.config.ts (single-line additive change, keep existing entries). Assert: typing a title sets the slug field; editing the slug stops auto-fill; the preview pane renders sanitized markdown (no `<script>` survives a `<script>alert(1)</script>` body).
- `src/lib/changelog/__tests__/changelog-store-status-filter.test.ts` in `src-lib-unit`: chainable supabase mock asserts the changelog_entries SELECT includes `.eq('status','published')`.
  </action>
  <verify>
    <automated>cd /tmp/leanshot-p71/leanshot && grep -q "export function SafeMarkdown" src/components/changelog/WhatsNewDrawer.tsx && grep -q "product-updates/ProductUpdatesLayout" src/lib/admin/modules.ts && grep -q "\.eq('status', 'published')" src/lib/changelog/changelog-store.ts && npx vitest run --config vitest.config.ts --project=src-ui-unit src/admin/modules/product-updates/__tests__/EntryEditorView.test.tsx 2>&1 | grep -qE "passed \(|Test Files.*passed" && npx vitest run --config vitest.config.ts --project=src-lib-unit src/lib/changelog/__tests__/changelog-store-status-filter.test.ts 2>&1 | grep -qE "passed \(|Test Files.*passed" && echo MODULE_OK</automated>
  </verify>
  <done>Module registered via explicit file import; editor reuses exported SafeMarkdown; useChangelog filters status='published'; both new tests pass in their correct vitest projects; no hardcoded AdminShell switch branch added.</done>
</task>

</tasks>

<verification>
Phase-level checks for this plan:

1. Migration is additive + forward-timestamped (newest tree migration is 20290108000011):
   `cd /tmp/leanshot-p71 && ls supabase/migrations | sort | tail -1` → must be `20290110000001_p71_changelog_status_version.sql`.
2. No destructive DDL and no `CREATE POLICY IF NOT EXISTS`:
   `! grep -iE "drop table|create table|create policy if not exists" supabase/migrations/20290110000001_p71_changelog_status_version.sql`
3. Full new-test sweep green in both projects:
   `cd /tmp/leanshot-p71/leanshot && npx vitest run --config vitest.config.ts --project=src-lib-unit --project=src-ui-unit src/lib/admin/__tests__/product-updates.test.ts src/lib/changelog/__tests__/changelog-store-status-filter.test.ts src/admin/modules/product-updates/__tests__/EntryEditorView.test.tsx`
4. Existing changelog tests unregressed:
   `cd /tmp/leanshot-p71/leanshot && npx vitest run --config vitest.config.ts src/lib/changelog src/components/changelog`
5. Typecheck clean on touched files:
   `cd /tmp/leanshot-p71/leanshot && npx tsc --noEmit`
</verification>

<success_criteria>
- An `admin` can open `/admin/product-updates`, author an entry (title, auto-slug, version, markdown body with live preview matching the WhatsNewDrawer renderer, status), save as draft, then publish and archive (PU-01).
- `changelog_entries` has additive version/status/created_by columns + a status CHECK; the SELECT RLS policy now shows non-admins published rows only (PU-02).
- `useChangelog` filters `status='published'` so drafts never reach the in-app drawer on web/iOS/Android (PU-03).
- Every write path records a `log_admin_action` audit row.
- Migration applies idempotently on a forward timestamp; existing WhatsNewDrawer / useChangelog behavior is unregressed; all new tests register in the correct vitest project includes and pass.

Goal-backward check vs 71-CONTEXT success criteria:
- "admin can open /admin/product-updates, author ... save draft ... publish" → Tasks 2+3 (PU-01). ✓
- "published appear in drawer; drafts do NOT appear for non-admins (RLS + query filter, cross-role test)" → Task 1 RLS + Task 3 useChangelog filter + status-filter test (PU-03). ✓ (live cross-role RLS proof folded into Plan 02 verification against the deployed DB; the query-filter half is unit-tested here.)
- "all existing changelog tests pass; new tests cover admin CRUD wrapper + draft-hidden query filter" → Tasks 2+3 tests + verification step 4. ✓
- "migration applies cleanly (idempotent, forward timestamp); no regression" → Task 1 + verification steps 1-2,4. ✓
- Store-notes transform test + the markdown→plain-text pipeline (PU-04) → Plan 02 (depends on this plan's status/version columns).
</success_criteria>

<output>
Create `.planning/phases/71-product-updates-centralized-changelog/71-01-SUMMARY.md` when done.
</output>
