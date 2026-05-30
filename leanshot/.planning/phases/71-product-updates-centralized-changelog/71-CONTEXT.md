# Phase 71: Product Updates & Centralized Changelog - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning
**Mode:** Direct context (discovery done this session via 5-agent codebase map; user locked 3 scope decisions)

<domain>
## Phase Boundary

First **feature** phase after the v1.4 launch gate (Phase 70 is UAT-only). Delivers a
single source of truth for product changelog/"What's New" content: an admin authoring
UI that publishes entries which surface IDENTICALLY on web, iOS, and Android in-app AND
auto-populate the App Store Connect + Google Play "What's new in this version" release
notes.

**Why now:** The user gained Apple Developer + Play Console access (2026-05-30) and is
preparing the first store uploads. They want one place to "push new updates with a
changelog" rather than hand-copying release notes into three places.

**In scope:**
- Admin "Push Updates" module (author / edit / publish / archive changelog entries) in the
  existing manifest-driven admin panel.
- Additive DB evolution of `changelog_entries` (version, draft/published/archived status,
  created_by) + RLS so drafts stay admin-only.
- In-app surfacing already works cross-platform (iOS/Android are Capacitor WebView wrappers
  of the same SPA); this phase only adds a `status=published` filter so drafts never leak.
- Centralized changelog → store release notes pipeline: a build-time script that writes the
  latest published entry into `fastlane/metadata/ios/en-US/release_notes.txt` and
  `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.

**Out of scope:**
- AdMob wiring + go-live (separate; operator AdMob account not yet created — scaffold-behind-flag only, NOT this phase).
- The fastlane signing/upload lanes + store credentials themselves (owned by Phase 70 / 70-01 vendor plan + the existing Fastfile). This phase only PRODUCES the release-notes files those lanes consume.
- i18n/localized changelog (single en-US locale for v1), rich media uploads, scheduled/embargoed publishing, analytics on drawer engagement.
- Native (non-WebView) changelog UI — unnecessary because the Capacitor shell renders the same web drawer.

</domain>

<decisions>
## Locked Decisions (user, 2026-05-30)

1. **Centralization model = BOTH.** One admin-authored entry drives (a) the in-app What's New
   drawer on all 3 platforms AND (b) the App Store / Play store release notes via fastlane
   metadata. Single source of truth = `changelog_entries`.
2. **Build order = admin "Push Updates" UI first** (self-contained; table + RLS already exist),
   then the store-notes sync script.
3. **AdMob is out of scope here** (operator account pending; handled separately, scaffold behind a flag).

## Implementation Decisions

- **Reuse, don't rebuild.** `changelog_entries` table, `user_changelog_dismissed`,
  `changelog-mark-read` Edge Fn, `WhatsNewDrawer`, and `useChangelog` already exist (Phase 42
  Plan 42-06). This phase EXTENDS them.
- **Writes go through existing admin RLS** (`is_admin_at_least('admin')` already gates
  INSERT/UPDATE/DELETE on `changelog_entries`). Prefer direct RLS-gated PostgREST writes from a
  `src/lib/admin/product-updates.ts` wrapper; add `log_admin_action` audit calls to match the
  admin write convention (Pattern S1 server-side enforcement is already provided by RLS).
- **Admin module follows the ModerationLayout / AllowlistPage template** — manifest entry in
  `src/lib/admin/modules.ts` (`ADMIN_MODULES`), lazy-loaded, `minRole: 'admin'`, PostHog
  flag-gated (`admin.product-updates.enabled`). Register the lazy import as an explicit FILE
  import (not a directory barrel) to avoid the `index-*.js` chunk-collision guard
  (see cascade-56 / reference_vite_index_chunk_collision_bundle_guards).
- **Markdown live preview reuses the WhatsNewDrawer renderer** (react-markdown + DOMPurify)
  so the admin sees exactly what users see and XSS sanitization is identical.
- **Draft visibility:** non-admin SELECT must be restricted to `status = 'published'`. Tighten
  the RLS SELECT policy (published-to-all-authenticated; drafts admin-only) AND filter in
  `useChangelog` — defense in depth.
- **Store-notes pipeline auth:** the sync script runs in CI at release time with service-role
  (changelog SELECT is authenticated-only); it queries the newest `published` entry for the
  build's `version`, strips markdown → plain text, and writes the two fastlane files. Wire it
  to run BEFORE the existing `upload_testflight` / `upload_play` fastlane lanes (lane edit only;
  signing/secrets remain Phase 70).
- **Migration timestamp** must be ≥ newest applied. Newest applied per project memory is
  `20290108000009`; a working-tree `20290108000011` exists. Use a forward timestamp
  (e.g. `2029011x…`) and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + idempotent policy
  drop/create (CREATE POLICY has no IF NOT EXISTS on remote PG — bare CREATE after DROP).

## Grounded Facts (verified this session)

- `changelog_entries(id uuid pk, slug text unique, title, body_md, published_at, created_at, updated_at)`.
- RLS: authenticated SELECT `USING (true)`; INSERT/UPDATE/DELETE `WITH CHECK is_admin_at_least('admin')`. (`supabase/migrations/20270704000010_*`, `…000012_changelog_rls.sql`.)
- `useChangelog` (`src/lib/changelog/changelog-store.ts`) fetches newest-first limit 20 + computes unread vs `user_changelog_dismissed.last_seen_published_at`. `WhatsNewDrawer` renders sanitized markdown. Topbar shows the unread dot.
- Admin pattern: `ADMIN_MODULES` registry in `src/lib/admin/modules.ts`; AdminShell pathname routing; Pattern S1 dual-layer (role/flag UX gate + SECDEF/RLS server gate). Templates: `src/admin/modules/moderation/ModerationLayout.tsx`, `src/components/admin/embeds/AllowlistPage.tsx`.
- Fastlane: `leanshot/fastlane/Fastfile` (build_unsigned + gated upload_testflight/upload_play lanes); metadata at `leanshot/fastlane/metadata/ios/en-US/release_notes.txt` (exists) and `…/android/en-US/` (needs a `changelogs/` dir).
- iOS/Android are Capacitor 8 wrappers of `dist/` — the web `WhatsNewDrawer` already runs in-app on both.

</decisions>

<success_criteria>
## Success Criteria

- An `admin` can open `/admin/product-updates`, author a changelog entry (title, auto-slug,
  version, markdown body with live preview, status), save it as a draft, and publish it.
- Published entries appear in the in-app What's New drawer on web (and therefore iOS/Android
  via Capacitor); drafts do NOT appear for non-admins (verified by RLS + query filter, with a
  cross-role test).
- Running the store-notes sync script writes the latest published entry (for the current app
  version) to both fastlane release-notes files as plain text.
- All existing changelog tests still pass; new tests cover: admin CRUD wrapper, the draft-hidden
  RLS/query filter, and the markdown→plain-text store-notes transform.
- Migration applies cleanly (idempotent, forward timestamp); no regression to the existing
  WhatsNewDrawer / useChangelog behavior.

## Requirement IDs (new, this phase)

- PU-01 — Admin authoring UI (create/edit/publish/archive) for changelog entries.
- PU-02 — Additive schema (version, status, created_by) + draft-hidden RLS.
- PU-03 — In-app surfacing filters to published (web/iOS/Android share the SPA drawer).
- PU-04 — Centralized changelog → App Store + Play release-notes sync at release time.
</success_criteria>
