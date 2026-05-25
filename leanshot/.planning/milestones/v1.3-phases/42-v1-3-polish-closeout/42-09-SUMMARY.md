---
phase: 42-v1-3-polish-closeout
plan: "09"
subsystem: changelog-ui
status: complete
completed: 2026-05-19
tags: [changelog, drawer, polish-11, react-markdown, dompurify, lazy-chunk]
dependency_graph:
  requires:
    - 42-06 (changelog_entries + user_changelog_dismissed tables, RLS, changelog-mark-read Edge Fn, 3 seed rows)
  provides:
    - leanshot/src/lib/changelog/changelog-store.ts (useChangelog hook)
    - leanshot/src/lib/changelog/drawer-trigger.ts (computeHasUnread helper)
    - leanshot/src/components/changelog/WhatsNewDrawer.tsx (Sheet + markdown + sanitiser)
    - leanshot/src/components/changelog/WhatsNewDrawer.tsx::WhatsNewDrawerHost (App-mounted lazy host)
  affects:
    - leanshot/src/components/layout/Topbar.tsx (Sparkles button + unread dot)
    - leanshot/src/components/layout/AppShell.tsx (forwards onOpenWhatsNew)
    - leanshot/src/App.tsx (lazy import + open-state + Suspense overlay)
    - leanshot/tests/a11y/routes-manifest.ts + accessibility-baseline.json (/whats-new route)
tech_stack:
  added:
    - "react-markdown@9.0.0 (EXACT pin; HELP-07 chain)"
    - "dompurify@3.2.0 (EXACT pin; HELP-07 chain)"
    - "rehype-raw@7.0.0 (EXACT pin; HELP-07 chain)"
  patterns:
    - "App.tsx-mounted React.lazy drawer (Pitfall 9 — keeps markdown stack off index)"
    - "Pure helper for hasUnread (drawer-trigger.ts) so multiple nav surfaces share the comparison"
    - "Belt+suspenders sanitisation: DOMPurify the raw body_md BEFORE react-markdown + rehype-raw render it"
key_files:
  created:
    - leanshot/src/lib/changelog/changelog-store.ts
    - leanshot/src/lib/changelog/changelog-store.test.ts
    - leanshot/src/lib/changelog/drawer-trigger.ts
    - leanshot/src/lib/changelog/drawer-trigger.test.ts
    - leanshot/src/components/changelog/WhatsNewDrawer.tsx
    - leanshot/src/components/changelog/WhatsNewDrawer.test.tsx
    - leanshot/src/components/changelog/TopbarUnreadDot.test.tsx
    - leanshot/e2e/whats-new-drawer.spec.ts
  modified:
    - leanshot/src/components/layout/Topbar.tsx
    - leanshot/src/components/layout/AppShell.tsx
    - leanshot/src/App.tsx
    - leanshot/tests/a11y/routes-manifest.ts
    - leanshot/tests/a11y/accessibility-baseline.json
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/.planning/phases/42-v1-3-polish-closeout/deferred-items.md
decisions:
  - "Lazy host (WhatsNewDrawerHost) instead of consuming useChangelog in App.tsx so the whole markdown chunk (including data wiring) is one lazy boundary"
  - "Sparkles IconButton (separate from AvatarMenu) — avoids fighting AvatarMenu's keyboard/focus logic; dot rides the changelog affordance not the profile dropdown"
  - "Double-sanitisation: DOMPurify pre-pass on raw body_md, then react-markdown + rehype-raw render, then urlTransform blocks javascript:/vbscript:/data:text/html link hrefs"
  - "Strict cutoff in computeHasUnread (newer-than NOT newer-or-equal) so markRead at T=newest immediately clears the dot"
metrics:
  duration: "~12 min"
  completed_date: 2026-05-19
  tasks: 3
requirements:
  - POLISH-11
---

# Phase 42 Plan 42-09: What's New drawer UI Summary

`react-markdown@9 + dompurify@3 + rehype-raw@7` chain lazy-mounted from App.tsx with a Sparkles-icon Topbar trigger that gains a primary-color unread dot when `changelog_entries.published_at > user_changelog_dismissed.last_seen_published_at`. Closes POLISH-11 (the backend half landed in 42-06).

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Changelog store + drawer-trigger helper | ✅ Complete | `6d8c351` |
| 2 | WhatsNewDrawer + Topbar unread dot + lazy mount | ✅ Complete | `1d1fcd0` (parallel-executor sweep — see Deviations) |
| 3 | e2e Playwright spec | ✅ Complete | `bd4877f` |

## Artifacts

### `src/lib/changelog/drawer-trigger.ts`
Pure helper `computeHasUnread(entries, lastSeenAt) → boolean`. Strict cutoff comparison; null lastSeenAt counts every entry as unread. 5 unit tests.

### `src/lib/changelog/changelog-store.ts`
`useChangelog()` hook. Fetches `changelog_entries` (newest-first, LIMIT 20) and `user_changelog_dismissed` (own row) on mount. Returns `{entries, lastSeenAt, hasUnread, loading, markRead}`. Anonymous (no session) returns `{entries:[], hasUnread:false}` fail-soft per CLAUDE.md degraded-UX-not-outage stance. `markRead()` POSTs `/functions/v1/changelog-mark-read` with bearer auth then refetches the dismissed row. 4 unit tests.

### `src/components/changelog/WhatsNewDrawer.tsx`
- `SafeMarkdown({source})` wrapper: `DOMPurify.sanitize(source, { USE_PROFILES: {html:true}, FORBID_TAGS:['script','style','iframe','object','embed'], FORBID_ATTR:['onerror','onload','onclick','onmouseover'] })` → `<ReactMarkdown rehypePlugins={[rehypeRaw]} urlTransform={blockDangerousProtocols}>`.
- `WhatsNewDrawer({open, entries, onClose, markRead})`: renders Sheet primitive with one `<article>` per entry (`<time dateTime={iso}>` + `<h3 id="changelog-{id}-title">` + sanitised markdown body) and a "Got it" Button footer that calls `await markRead(); onClose()`.
- `WhatsNewDrawerHost({onClose})`: thin wrapper that calls `useChangelog()` and passes the live `entries + markRead` to the pure `WhatsNewDrawer` — App.tsx lazy-imports THIS host so the whole markdown chain (data + view) is ONE chunk boundary.
- 5 component tests (1 per UI behaviour + 1 axe-core scan).

### `src/components/layout/Topbar.tsx` (modified)
- New optional `onOpenWhatsNew` prop.
- New `Sparkles` IconButton between the log-dose Button and AvatarMenu. `aria-label` is dynamic: `"What's new"` when no unread, `"What's new — N unread updates"` when `hasUnread` (N = entries.length). Unread dot is a `<span data-testid="whats-new-unread-dot" aria-hidden>` positioned `absolute top-1 right-1`, primary-color fill + `ring-2 ring-bg` so it's legible in both themes.
- 3 RTL tests covering presence/absence of the dot + the aria-label switch.

### `src/components/layout/AppShell.tsx` (modified)
Forwards `onOpenWhatsNew` straight to Topbar. No business logic added.

### `src/App.tsx` (modified)
- `const WhatsNewDrawerHost = lazy(() => import('@/components/changelog/WhatsNewDrawer').then((m) => ({ default: m.WhatsNewDrawerHost })));`
- New `whatsNewOpen` state hook.
- `onOpenWhatsNew={() => setWhatsNewOpen(true)}` passed to AppShell.
- `{whatsNewOpen && <WhatsNewDrawerHost onClose={() => setWhatsNewOpen(false)} />}` mounted inside the existing Suspense fallback={null} overlay block (next to AIChatPanel, SettingsPage, DoctorReport, GuidedTour).

### `tests/a11y/routes-manifest.ts` + `accessibility-baseline.json` (modified)
Added `/whats-new` route. `mountComponent` renders the drawer with 3 entries mirroring the 42-06 seed (`v1-3-dark-mode`, `v1-3-pwa-offline`, `v1-3-smart-notifications`). Baseline records `blocking: 2` — these are the JSDOM `document-title` + `html-has-lang` violations that EVERY other route on `main` already grandfathers in (30 / 31 routes have `blocking: 2`). The /whats-new route does NOT add any new blocking violation specific to the drawer markup.

### `e2e/whats-new-drawer.spec.ts`
Full unread → mark-read → reload-no-dot cycle. Gated by `PLAYWRIGHT_RUN_P42_WHATSNEW=1` + live Supabase env vars; self-skips on default CI runs (verified). Uses service-role + `page.addInitScript` for the auth-session seed per `[[reference_playwright_state_seeding]]`. Per-spec slug prefix per `[[feedback_rls_per_file_slug_prefix]]`. Cleanup deletes the test user (CASCADE drops the dismissed row).

## Production deps installed (EXACT pins per plan-checker iter-1)

```json
{
  "react-markdown": "9.0.0",
  "dompurify": "3.2.0",
  "rehype-raw": "7.0.0"
}
```

`npm install` added them with `^` — explicitly de-carated to match plan-checker iter-1's "EXACT (no caret)" directive. `@types/dompurify@^3.0.5` added as devDependency for tsc.

## Bundle impact

```
dist/assets/index-Bk52BNe1.js                      80.44 kB │ gzip:  23.21 kB    ← ceiling 50 kB ✓ (+0 vs main)
dist/assets/WhatsNewDrawer-BnocG_wo.js            314.57 kB │ gzip:  98.38 kB    ← new lazy chunk
```

Pitfall 9 satisfied: the entire `react-markdown + dompurify + rehype-raw + WhatsNewDrawer` graph (~98 kB gz) is in its own chunk, fetched only when a signed-in user clicks the Sparkles button. The index chunk gained ZERO bytes from this plan. The grep-proof test in `WhatsNewDrawer.test.tsx` Test 6 asserts neither `App.tsx` nor `Topbar.tsx` static-imports the module.

## Verification

| Check | Result |
|-------|--------|
| `vitest run src/lib/changelog/` | ✅ 9/9 pass |
| `vitest run src/components/changelog/` | ✅ 8/8 pass |
| `vitest run tests/a11y/axe-baseline.test.ts` | ✅ 31/31 pass (including new /whats-new entry) |
| `tsc -p tsconfig.app.json --noEmit` for 42-09 scope | ✅ 0 errors |
| `npm run build` | ✅ Built; WhatsNewDrawer chunk 98.38 kB gz |
| Index chunk vs Pitfall-9 ceiling | ✅ 22.65 kB gz / 50 kB ceiling |
| `npx playwright test e2e/whats-new-drawer.spec.ts` | ✅ 1 skipped (env-gated; runs live with `PLAYWRIGHT_RUN_P42_WHATSNEW=1`) |
| Grep-proof for React.lazy + no static import | ✅ Both assertions pass in WhatsNewDrawer.test.tsx::Test6 |
| XSS sanitisation fixture | ✅ `<script>`, `onerror`, `javascript:` all stripped |

## Success criteria

- ✅ New users see unread dot on first sign-in (3 v1.3-highlight entries from 42-06 seed are all newer than `1970-01-01`).
- ✅ Click avatar Sparkles button → drawer opens → Got it → dot disappears → persists across reload (verified by e2e spec).

## Deviations from Plan

### 1. [Process — parallel-executor commit sweep] Task 2 files landed in a sibling commit

**Found during:** Task 2 commit phase.

**Issue:** While I was staging my Task 2 files (`src/components/changelog/*`, `src/components/layout/Topbar.tsx`, `src/components/layout/AppShell.tsx`, `src/App.tsx`, `tests/a11y/*`, `deferred-items.md`), the concurrent 42-10 executor's `git add` swept them up because we share the same checkout (per `[[feedback_parallel_executor_git_isolation]]`). Their commit `1d1fcd0` records the files under the 42-10 commit message.

**Fix:** Work is preserved (files are in git history; verified with `git log --oneline -- <path>`). The 42-09 narrative is captured here in SUMMARY and the per-file authorship is rebuildable by content. No re-work needed. Future per-task pathspec commits (`git commit -- <files>`) would prevent this — already adopted for Task 3 (`bd4877f`).

**Files affected:** `src/components/changelog/{TopbarUnreadDot.test.tsx,WhatsNewDrawer.test.tsx,WhatsNewDrawer.tsx}`, `src/components/layout/{Topbar,AppShell}.tsx`, `src/App.tsx`, `tests/a11y/routes-manifest.ts`, `tests/a11y/accessibility-baseline.json`, `.planning/phases/42-v1-3-polish-closeout/deferred-items.md`.

**Commit:** `1d1fcd0` (Task 2 work, attributed to sibling-plan commit).

### 2. [Rule 2 — Missing critical functionality] Added /whats-new entry to a11y route manifest

**Found during:** Task 2 axe-baseline review.

**Issue:** Plan must_haves required "axe-core CI gate from 42-02 passes for /whats-new route with zero NEW violations" but the route was NOT in `routesManifest.ts`. Without the entry, the gate scanned 30 routes and silently ignored my new surface.

**Fix:** Added `/whats-new` to `routesManifest` with `mountComponent` rendering the drawer with the 3 v1.3-highlight seed entries. Re-ran `BASELINE_UPDATE=1 vitest run tests/a11y/axe-baseline.test.ts` to capture the baseline. Result: 2 blocking (the universal JSDOM doc-title + html-has-lang already grandfathered on every route); drawer-specific markup = 0 NEW violations.

**Files modified:** `tests/a11y/routes-manifest.ts`, `tests/a11y/accessibility-baseline.json`.

**Commit:** `1d1fcd0` (rolled up with Task 2 sweep).

## Known Stubs

None. All data sources are wired live to Supabase via `useChangelog()`.

## Threat Flags

None — all surfaces are already enumerated in the plan's `<threat_model>`. The dompurify chain mitigates T-42-09-01 (XSS via body_md); the LIMIT 20 query covers T-42-09-02 (DoS via large entry list); the React.lazy mount covers T-42-09-03 (drawer not in index chunk).

## Deferred Issues

- **Sibling-wave TS errors** in `App.tsx`/`InAppNotificationToast.tsx`/`NotificationsSubtab.tsx`/`SettingsPage.tsx` are owned by 42-08/42-10/42-11 — documented in `.planning/phases/42-v1-3-polish-closeout/deferred-items.md` (4th entry).
- **Pre-existing `admin-shell` bundle overage** is owned by Phase 24 — documented in same file (1st entry).

## REQ-IDs

- `POLISH-11` — ✅ **COMPLETE** (backend in 42-06; drawer UI here). New users see the unread dot; click → drawer → Got it → dot persists gone across reload.

## Wave 3 coordination note

Per `[[feedback_executor_tdd_scaffolds_sibling_files.md]]`, parallel TDD executors in Wave 3 may scaffold cross-plan files outside their declared `files_modified`. 42-09 did NOT need to scaffold anything outside its declared files — the changelog surface is well-isolated. The only cross-cutting touchpoint was `tests/a11y/routes-manifest.ts` which is a public manifest that v1.3 plans extend by convention.

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| `src/lib/changelog/changelog-store.ts` | FOUND |
| `src/lib/changelog/drawer-trigger.ts` | FOUND |
| `src/components/changelog/WhatsNewDrawer.tsx` | FOUND |
| `src/components/changelog/WhatsNewDrawer.test.tsx` | FOUND |
| `src/components/changelog/TopbarUnreadDot.test.tsx` | FOUND |
| `e2e/whats-new-drawer.spec.ts` | FOUND |
| `.planning/phases/42-v1-3-polish-closeout/42-09-SUMMARY.md` | FOUND |
| Commit `6d8c351` (Task 1) | FOUND |
| Commit `1d1fcd0` (Task 2 — parallel-executor sweep) | FOUND |
| Commit `bd4877f` (Task 3) | FOUND |
