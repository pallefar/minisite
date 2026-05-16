---
project: leanshot
purpose: Central registry of deferred / known-flaky tests with explicit fix plans. Per project rule `feedback_defer_then_batch_fix_pattern`, never permanently skip SC tests — every entry here must have a target phase or polish plan that resolves it.
created: 2026-05-15
---

# Deferred Tests Registry

## Phase 15 (v1.2 / Page Builder)

### 1. `tests/rls/page-builder-rls.test.ts` — `is_staff CAN ...` tests flaky under vitest parallel load

**FIXED 2026-05-16** (commit `d8d212f`) — service-role-JWT swap landed via Plan 23-05; 5 affected
is_staff test fixtures re-wired to JWT-header injection (no GoTrueClient instantiation). 3 consecutive
stable runs confirmed locally (env-gated; live GREEN with CI secrets). `SUPABASE_JWT_SECRET` added to
CI `test-unit` env block (GitHub secret needs to be added to repo settings: Supabase dashboard >
Settings > API > JWT Secret, project `ytnsipxxmzgaebkqmokp`). Note: audit found 5 affected fixtures
(not 4 as originally documented — `site_settings: is_staff CAN UPDATE` was also using the flawed pattern,
fixed proactively per Rule 2).

**Affected tests (5, all re-enabled):**
- `landing_pages: is_staff user CAN INSERT / UPDATE / DELETE`
- `landing_page_revisions: is_staff CAN INSERT a new revision`
- `leads: is_staff CAN SELECT`
- `page-assets: is_staff CAN upload and delete a test image`
- `site_settings: is_staff CAN UPDATE` (Rule 2 extension — same vulnerability)

---

**Historical record (pre-fix):**

**Symptom:** Periodic `42501 new row violates row-level security policy` or `expected 0 to be greater than 0` even though the `is_staff()` helper + RLS policies are provably correct.

**Root cause:** jsdom `Multiple GoTrueClient instances detected` — supabase-js v2.105 GoTrue clients cross-contaminate auth state despite `persistSession: false` + unique `storageKey` per `buildAnonClient`. Live diagnostic script (admin upsert → signIn → `rpc('is_staff')` → `storage.upload`) returns `true` 100% outside the vitest suite.

**Why deferred:** Migrations and policies are correct and live on `ytnsipxxmzgaebkqmokp`. The flake is in the test fixture's auth strategy, not in production code. Re-running the suite usually yields 30/30 GREEN.

**Fix plan:** Replace `buildAnonClient(...).auth.signInWithPassword(...)` with a service-role-minted JWT injected via the `headers.Authorization` option on `createClient`. No GoTrue client involvement, no cross-contamination. Target: a Phase 15 polish plan or the v1.2 closeout sweep.

**Read-back guard already in place:** `createStaffUser` now loops up to ~3s waiting for `profiles.is_staff=true` to read back via admin client. Helps with the post-upsert race but does not fix the GoTrue cross-contamination.

**Workaround for CI:** If the suite goes red, re-run once. If it goes red twice, the failure is real (not this flake) — investigate.
