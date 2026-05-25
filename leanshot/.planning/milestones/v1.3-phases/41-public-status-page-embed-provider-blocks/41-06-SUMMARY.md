---
phase: 41-public-status-page-embed-provider-blocks
plan: 06
subsystem: admin-embeds
tags:
  - admin
  - superadmin
  - allowlist
  - closeout
  - automated-verify-only
  - milestone-uat-deferred
requirements:
  - EMBED-04
  - EMBED-07
  - POLISH-10
dependency-graph:
  requires:
    - 41-02  # iframe-allowlist SECDEF RPCs + listHostnames/addHostname/removeHostname wrappers
    - 41-03  # Vercel CSP middleware (frame-src dynamic injection)
    - 41-04  # Calendly OAuth Edge Fns + popup component
    - 41-05  # Embed block UI types
  provides:
    - "ADMIN_MODULES['embeds'] entry routed at /admin/embeds and /admin/embeds/allowlist"
    - "AllowlistPage with 4 render states (loading / empty / loaded / error)"
    - "AddHostnameForm with 5 client-side validation rules (UI-SPEC §Copywriting Contract)"
    - "RemoveHostnameConfirm with 2 body variants (0-refs vs >=1-refs)"
    - "AllowlistTable with 6 columns + sort + copy + remove + references badge"
    - "ReferencesSheet (v1.4 deferred-scan placeholder per RESEARCH Open Question 4)"
    - "POLISH-10 status-page smoke test at tests/smoke/status-page.smoke.test.ts (3 assertion groups, graceful-skip)"
  affects:
    - "src/lib/admin/modules.ts — appended new 'embeds' entry after 'anomaly' (superadmin sibling)"
tech-stack:
  added:
    - "lucide-react ShieldCheck icon (already in stdlib at v0.460.0; no new dep)"
  patterns:
    - "Pattern S1 dual-layer security — UX gate via ADMIN_MODULES minRole + page-level surfaceCheck via supabase.auth.getUser + profiles.admin_role re-check + DB SECDEF RPC re-check (Plan 41-02 wrappers)"
    - "AdminShell URL-prefix branch routing — route:'embeds' resolves both /admin/embeds and /admin/embeds/allowlist via pathname.startsWith() (feedback_admin_module_manifest_vs_router_branch_drift)"
    - "Client-side validation BEFORE RPC call — 5 verbatim error strings (empty / protocol / path / wildcard / duplicate)"
    - "Server 42501 → inline 'Only superadmins can add hostnames' surface (dual-layer denial copy)"
    - "Optimistic refetch pattern — onAdded callback triggers listHostnames refresh"
    - "Graceful-skip smoke tests with documented carry-over reason text (feedback_milestone_uat_deferral_consolidation)"
key-files:
  created:
    - "leanshot/src/components/admin/embeds/AllowlistPage.tsx"
    - "leanshot/src/components/admin/embeds/AddHostnameForm.tsx"
    - "leanshot/src/components/admin/embeds/AllowlistTable.tsx"
    - "leanshot/src/components/admin/embeds/RemoveHostnameConfirm.tsx"
    - "leanshot/src/components/admin/embeds/ReferencesSheet.tsx"
    - "leanshot/src/components/admin/embeds/__tests__/AllowlistPage.test.tsx"
    - "leanshot/src/components/admin/embeds/__tests__/AddHostnameForm.test.tsx"
    - "leanshot/src/components/admin/embeds/__tests__/RemoveHostnameConfirm.test.tsx"
    - "leanshot/tests/smoke/status-page.smoke.test.ts"
  modified:
    - "leanshot/src/lib/admin/modules.ts (+22 lines: 1 import, 1 module entry)"
decisions:
  - "AUTOMATED-EXTRACT mode applied per feedback_autonomous_false_close_out_partial_execution — Tasks 1 + 2 (auto) executed; Tasks 3 (BLOCKING deploy chain) + 4 (multi-signal HUMAN-UAT) deferred to milestone UAT (v1.3-uat-deferred.md)."
  - "ReferencesSheet ships the v1.4 deferred-scan placeholder copy per RESEARCH Open Question 4 — a JSONB scan over landing_page_revisions.blocks is out of v1.3 scope. AllowlistTable reference_count proxy uses last_used_at IS NULL (Unused) vs not-null (1 page)."
  - "AdminShell route convention: `route: 'embeds'` (NOT 'embeds/allowlist') per feedback_admin_module_manifest_vs_router_branch_drift — the prefix-branch resolver handles the sub-route automatically. PLAN.md W8 note covers this."
  - "Smoke test Group 3 (BETTERSTACK_API_KEY) gracefully skips with explicit reason text — POLISH-10 success criterion 1 classified 'approved automated-verify-only' until vendor wiring lands at v1.3 milestone close."
classification: "complete + approved automated-verify-only"
metrics:
  duration_minutes: 15
  task_count: 2
  file_count: 10
  completed_at: "2026-05-24"
---

# Phase 41 Plan 06: Phase Close-out + Superadmin Allowlist Admin Module Summary

Superadmin admin module landing at `/admin/embeds/allowlist` with 4-state UX (loading / empty / loaded / error), 5-rule client-side validation, 2-variant remove-confirm modal, and POLISH-10 status-page smoke gracefully gated on Better Stack vendor wiring.

## Automated tasks completed

### Task 1 — Admin module manifest + AllowlistPage UI

- 5 new components under `leanshot/src/components/admin/embeds/`:
  - `AllowlistPage.tsx` — page shell with 4 render states; page-level superadmin re-check (Pattern S1).
  - `AddHostnameForm.tsx` — 5 verbatim validation rules per UI-SPEC §Copywriting Contract.
  - `AllowlistTable.tsx` — semantic `<table>` with 6 columns, sortable header buttons, copy-to-clipboard, references badge, Trash2 remove.
  - `RemoveHostnameConfirm.tsx` — Modal-based confirm with 2 body variants (0-refs vs ≥1-refs).
  - `ReferencesSheet.tsx` — DSv2 Sheet primitive with v1.4-deferred-scan caption.
- 3 test files covering 16 behaviors total:
  - `AllowlistPage.test.tsx` — 4 tests (non-superadmin denied / empty state / 3 rows / error).
  - `AddHostnameForm.test.tsx` — 8 tests (5 validation rules + success + 42501 server denial + leading-dot variant).
  - `RemoveHostnameConfirm.test.tsx` — 4 tests (0-refs / ≥1-refs / cancel / confirm).
- 1 modified file: `src/lib/admin/modules.ts` — added `ShieldCheck` import + new `embeds` module entry (route='embeds', minRole='superadmin', flagKey='admin.embeds.enabled').

**Verify results:**

| Check | Result |
|-------|--------|
| `npx vitest run src/components/admin/embeds/__tests__/` | 3 files / 16 tests passed |
| `npx tsc -p tsconfig.app.json --noEmit` | clean (strict) |
| `grep -q "key: 'embeds'" src/lib/admin/modules.ts` | found |
| `grep -q "minRole: 'superadmin'" src/lib/admin/modules.ts` | found |
| `npx vitest run src/components/admin/__tests__/AdminShell.test.tsx` | 7 tests passed (no regression from new module entry) |

### Task 2 — POLISH-10 status-page smoke test

- `leanshot/tests/smoke/status-page.smoke.test.ts` — vitest smoke with 3 assertion groups:
  - **Group 1 (D-05 DNS):** `dig +short CNAME status.leanshot.app` — currently skips (CNAME pending HUMAN-UAT Signal 2).
  - **Group 2 (HTTPS 200):** `curl -sIL https://status.leanshot.app` — skips when Group 1 skipped.
  - **Group 3 (B6 Better Stack API):** authenticated GET `/api/v3/status-pages` + sections + resources; asserts ≥1 status page, ≥7 components (D-01 hybrid), ≥3 integrations (D-02 Sentry+Vercel+Supabase). Currently skips with explicit reason text since `BETTERSTACK_API_KEY` is unset.

**Verify results:**

| Check | Result |
|-------|--------|
| `npx vitest run tests/smoke/status-page.smoke.test.ts` | 1 file / 3 tests skipped (graceful) |
| `grep -q "BETTERSTACK_API_KEY" tests/smoke/status-page.smoke.test.ts` | found |
| `grep -q "/api/v3/status-pages" tests/smoke/status-page.smoke.test.ts` | found |
| `grep -q "component" tests/smoke/status-page.smoke.test.ts` | found |

Per `feedback_milestone_uat_deferral_consolidation`: the skip reason text on Group 3 is the audit trail that flows into `v1.3-uat-deferred.md` — POLISH-10 success criterion 1 (auto-incident detection via D-02 thresholds) classified as "approved automated-verify-only" until vendor secret + DNS lands.

## Carry-over: operator close-out (Task 3 — BLOCKING deploy chain DEFERRED)

Tasks 3 + 4 of the original Plan 41-06 are deferred per AUTOMATED-EXTRACT mode (`feedback_autonomous_false_close_out_partial_execution`) — this executor only ran the autonomous `type="auto"` tasks. The operator close-out runs the following sequence in the canonical primary checkout (`/Users/karstenhaldan/minisite/`):

### Task 3 Step A — Pre-push migration audit
```bash
ls supabase/migrations/ | sort | tail -10
# expect: 20270711000001_p41_iframe_allowlist.sql + 20270711000002_p41_iframe_allowlist_rpcs.sql at the tail
ls supabase/migrations/20270711*.sql | wc -l  # expect 2
```

### Task 3 Step B — `supabase db push --linked`
```bash
cd /Users/karstenhaldan/minisite
git rev-parse --show-toplevel  # verify primary checkout
supabase db push --linked
# verify: no "Skipping" lines, 2 migrations applied
```

### Task 3 Step C — Deploy 3 Edge Functions
```bash
supabase functions deploy calendly-oauth-start --import-map supabase/functions/import_map.json
supabase functions deploy calendly-oauth-callback --import-map supabase/functions/import_map.json
supabase functions deploy page-render --import-map supabase/functions/import_map.json
```

### Task 3 Step D — Set Supabase Function Secrets
```bash
supabase secrets set \
  CALENDLY_OAUTH_CLIENT_ID=<from user_setup> \
  CALENDLY_OAUTH_CLIENT_SECRET=<from user_setup> \
  CALENDLY_OAUTH_REDIRECT_URI=https://app.leanshot.app/api/calendly/oauth-callback \
  LEANSHOT_APP_ORIGIN=https://app.leanshot.app \
  OAUTH_STATE_SECRET=<openssl rand -hex 32>
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp
```

### Task 3 Step E — Vercel deploy + Step F — CSP report URI env
```bash
git push origin main  # triggers Vercel auto-deploy
echo "<sentry-csp-report-uri>" | vercel env add VITE_SENTRY_CSP_REPORT_URI production
```

### Task 3 Step G — BETTERSTACK_API_KEY for smoke
```bash
echo "<betterstack-api-key>" | vercel env add BETTERSTACK_API_KEY production
# Copy to leanshot/.env.test for local smoke runs
cd leanshot && npx vitest run tests/smoke/status-page.smoke.test.ts --config vite.config.ts
# Group 3 should now run inline (not skipped)
```

### Task 3 Step H — Post-deploy verification
```bash
curl -sIL https://app.leanshot.app/embed-test-page 2>/dev/null \
  | grep -i "content-security-policy" \
  | grep -q "calendly\|tally\|youtube"
$HOME/.deno/bin/deno test --no-check --allow-read --allow-env \
  supabase/functions/page-render/ \
  supabase/functions/calendly-oauth-start/ \
  supabase/functions/calendly-oauth-callback/
```

## Carry-over: HUMAN-UAT signals (Task 4 — multi-signal DEFERRED to v1.3 milestone close)

Per `feedback_multi_signal_human_verify_checkpoint_pattern`, the 6 HUMAN-UAT signals are individually approvable. None executed in AUTOMATED-EXTRACT mode — all flow to `v1.3-uat-deferred.md`:

| Signal | Domain | Operator verifies |
|--------|--------|-------------------|
| 1 — `bstack-approved` | Better Stack vendor | Paid-tier active; 7-component hybrid hierarchy; Sentry + Vercel + Supabase integrations wired; LeanShot branding |
| 2 — `cname-live` | DNS (D-05) | `dig +short CNAME status.leanshot.app` non-empty; smoke test runs inline (not skipped) |
| 3 — `calendly-oauth-approved` | Calendly OAuth (EMBED-08) | OAuth app exists; Fn Secrets set; popup → connected-account caption works in PageEditor |
| 4 — `allowlist-approved` | Allowlist superadmin UI (EMBED-07 + D-17) | Sidebar shows "Embeds"; add/remove flow + audit log row |
| 5 — `consent-gating-approved` | Consent gating (EMBED-01..05) | Iframes never fire before consent; placeholder card renders correctly |
| 6 — `custom-iframe-approved` | Custom-iframe end-to-end (EMBED-07) | CSP `frame-src` dynamic injection via Vercel middleware; allowlist add/remove gracefully degrades published pages |

Code-side gates (Signals 4, 5, 6) are unblockable once the Task 3 deploy chain runs — no further code change needed. Vendor-side gates (Signals 1, 2, 3) require operator action documented above.

## Deviations from Plan

### Rule 3 — Worktree pwd-drift recovery

Per `feedback_worktree_executor_pwd_drift_leaks_to_main`, Read/Write tools resolved absolute paths to `/Users/karstenhaldan/minisite/leanshot/...` on first attempt, which lands in the MAIN repo rather than the worktree (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-af4d0da7b372a0e26/leanshot/...`). Recovery: copied all created files into the worktree paths, reverted the main-repo modules.ts change via `git checkout`, and re-ran all verifications from the worktree. All 16 tests + tsc pass cleanly from the worktree position. No work lost; main repo returned to clean state pre-commit.

## Known Stubs

- **ReferencesSheet** intentionally ships a v1.4 deferred-scan placeholder caption ("Reference scanning ships in v1.4; remove with caution if last-used timestamp is recent") per RESEARCH Open Question 4 + Plan 41-06 §Step F explicit guidance. The AllowlistTable reference badge falls back to `last_used_at IS NULL` (Unused) vs not-null (1 page) — middleware-side last-used wiring lands when Plan 41-03 ships. This is the documented acceptable scope per UI-SPEC §Surface E + the plan's "accept simple [N] page badge with Sheet returning a TODO placeholder".

## Threat Flags

None — no new security-relevant surface introduced beyond what Plan 41-02 already registered (T-41-06-01 Pattern S1 dual-layer fully covered by ADMIN_MODULES minRole + page-level surfaceCheck + DB SECDEF re-check).

## Classification

**complete + approved automated-verify-only** — per `feedback_autonomous_false_close_out_partial_execution`. The Task 1 admin module + Task 2 smoke test land deterministically; Tasks 3 + 4 (deploy chain + multi-signal HUMAN-UAT) carry to v1.3 milestone close for vendor-side execution.

## Self-Check: PASSED

- All 10 created files exist at their declared paths in the worktree.
- modules.ts modified file exists with expected `key: 'embeds'` + `minRole: 'superadmin'` entries.
- 16/16 unit tests green; 3/3 smoke tests gracefully-skipped with documented reason text; tsc strict clean; AdminShell regression test still 7/7 green.
- Commits will record per-task atomic units (Task 1 + Task 2 + docs).
