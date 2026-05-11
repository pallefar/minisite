# Phase 5: Patient Cloud Sync Slice 1 — Auth + Injections - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

A patient can sign up with email/password, verify their email, log an injection on browser A, sign in on browser B, and see that injection — Supabase Postgres + Realtime drives cross-device sync for the **`injections` table only** (other data types in Phase 6 Slice 2); RLS policies enforce per-user scoping; the local-first UX (offline logging, instant Zustand updates) survives untouched.

**In scope (Phase 5):**
- New top-level `auth` view in `App.tsx` state machine (signup / signin / verify-email landing / password-reset / set-new-password sub-screens)
- Topbar avatar menu for signed-in users (Account / Sign out)
- `injections` Supabase table with RLS + indexes + `updated_at` column for LWW
- Cross-device sync via Supabase Realtime subscription (single global, on signin)
- Offline write queue (Zustand `pendingSyncIds` slice, persisted via existing middleware)
- Anonymous→permanent UID promotion (silent attach + post-signup toast)
- Pre-Phase-4 local injection migration (silent bulk-upload on first signed-in render)
- Email-verify gate (block sync only; local logging continues to work)
- Signout cache clear (user-data slices cleared; theme/onboarded/tour_seen preserved)
- Multi-account-on-one-browser safety: re-key localStorage by `user_id` hash (`leanshot_v4:<hash>`)
- Password reset via emailed link (AUTH-04)
- Cross-tenant RLS test in CI (SC#5)

**Out of scope (deferred to later phases):**
- Other data tables: weights, photos, meals, supplements, mood, sleep, symptoms, settings (Phase 6 Slice 2)
- Photos via Supabase Storage (Phase 6 Slice 2)
- Account deletion UI + GDPR/CCPA-grade data export (Phase 7 Compliance Foundations)
- Custom branded email templates (planner discretion — Phase 5 ships with Supabase defaults; Phase 7 brand pass can override)
- Per-field merge conflict resolution (LWW is good enough for log-style injections)
- Service Worker / background sync API (defer to v2 if reliability data shows need)
- BroadcastChannel cross-tab Realtime sharing (defer to v2 unless tab-count load matters)
- Magic-link as primary (Phase 5 ships password-primary with magic-link only as "forgot password" alternative)

</domain>

<decisions>
## Implementation Decisions

### Auth surface + flow (D-01..D-04)

- **D-01: New top-level `auth` view in `App.tsx`.** App.tsx's existing view selector becomes `marketing | onboarding | auth | dashboard`. The `auth` view owns 5 sub-screens (signup, signin, verify-email landing, forgot-password, set-new-password). Lazy-loaded like onboarding (`React.lazy + Suspense` boundary). Hash routing inside the auth view for sub-screen state (e.g., `#/auth/verify?token=...`) — keeps the no-router invariant intact while supporting email-link deep-links.
- **D-02: Password-primary, magic-link as "forgot password" alternative.** Default signup + signin: email + password forms. Magic-link surfaces as "Email me a sign-in link" on the signin page AND as the forgot-password flow. Both auth methods stay enabled server-side (already configured in Phase 4 Plan 04-01 Task 4 via `supabase config push`). Power users can use magic-link as a passwordless option without UI promotion.
- **D-03: Three CTA touchpoints from marketing.** (a) Top-right header link "Sign in", (b) hero-section primary CTA "Start tracking", (c) post-onboarding contextual prompt "Save your data to access it across devices" (high-intent moment). Anonymous-first users (already on dashboard via Phase 4 AI Coach) discover signup via the topbar avatar menu (see D-04).
- **D-04: Topbar avatar menu for signed-in nav.** Avatar shows user initials (or generic icon when display name missing). Dropdown contains: "Account", "Sign out", optional "Settings" (or settings stays as the existing drawer). Account screen reuses Settings drawer pattern with a new "Account" section. Avatar menu is the primary signout surface; matches standard SaaS pattern.

### Anon→permanent UID promotion (D-05..D-07)

- **D-05: Silent anon-UID promotion + post-signup toast.** Phase 4's anonymous-auth flow leaves users with an `auth.users` row where `is_anonymous=true`. On signup: `supabase.auth.updateUser({email})` → email confirm → `supabase.auth.updateUser({password})` runs on the SAME UID. AI chat history in `ai_messages` follows automatically (proven live in Phase 4 04-03 Task 5: `anonId === permanentId` after attachment; RLS-scoped rows remain readable). UX is invisible during signup; a friendly toast fires post-signup: "Welcome back — your AI chat history is saved to your account." **Critical: do NOT use `linkIdentity({email, password})` — that API is OAuth-only.** Source-of-truth: `.planning/decisions/supabase.md` + Phase 4 ADDENDUM-MOONSHOT.md doesn't override this — it's the Supabase research correction from `04-RESEARCH.md §Pitfall 5`.
- **D-06: Silent bulk-upload of pre-Phase-4 local injections.** On first signed-in render, the sync engine detects local `injections` rows without server counterparts and bulk-INSERTS to Supabase under the new `user_id`. No "claim your data?" confirm. Idempotency via `(user_id, log_id)` unique constraint where `log_id` is the existing client-generated UUID. Misaligned-with-trust risk of asking "Upload your 42 injections?" is worse than silently-upload-and-show-success for a health-tracking app. Toast post-upload: "Your 42 saved injections are now synced across devices."
- **D-07: Migration order on combined case.** Sequence for a user who has BOTH pre-Phase-4 local injections AND a Phase-4 anon UID with `ai_messages`: (1) `updateUser` on the existing anon UID to attach email/password (D-05); (2) email confirm completes; (3) sync engine flushes — anon UID's `ai_messages` already RLS-scoped to that UID, local injections bulk-upload to same UID (D-06). Single account, no orphans, all history preserved.

### Sync mechanics (D-08..D-10)

- **D-08: Last-write-wins by server `updated_at`.** Each `injections` row has `updated_at timestamptz default now()` set server-side. On sync conflict (same row mutated on two offline devices), the version with the LATER server timestamp wins; loser silently overwritten. Trigger fires `updated_at = now()` on every UPDATE. Avoids client-clock-skew issues. Per-field merge and reject-and-prompt rejected as overkill for log-style data; revisit in v2 if production shows real conflict frequency.
- **D-09: Single global Realtime subscription, top-level `useEffect` in App.tsx.** On `auth.onAuthStateChange` SIGNED_IN, subscribe to `injections` table filtered by `user_id=auth.uid()`. Subscription lives in App.tsx's mount lifecycle, NOT in `InjectionsTab` — avoids missing updates when user is on other tabs. Cleanup: unsubscribe on signout AND on window unload. One channel per signed-in session. BroadcastChannel cross-tab sharing deferred (v2 if multi-tab usage justifies).
- **D-10: Offline writes via Zustand + existing persist middleware.** Mutations (`addInjection`, `removeInjection`, `editInjection`) write to Zustand's `injections` slice immediately (local-first UX, zero-latency). A new `pendingSyncIds: string[]` slice tracks unsynced row IDs. Sync engine: on `navigator.onLine === true` + signed-in + verified, drain `pendingSyncIds` via Supabase `upsert(rows, {onConflict: 'user_id,log_id'})`. localStorage persistence via the existing `persist` middleware (no new IndexedDB dep, no Service Worker). STORAGE_VERSION bump from 6 → 7 to include `pendingSyncIds` + the user_id-namespaced key (D-12).

### Signout + multi-account safety (D-11..D-12)

- **D-11: Signout clears user-data slices; preserves theme + onboarded + tour_seen flags.** Cleared: `injections`, `weights`, `meals`, `photos`, `pendingSyncIds`, `aiHistory`, all date-keyed counters (`water`, `steps`, `foodNoise`, `supplements`, etc), `user` profile slice. Preserved: `theme`, `onboarded`, `tour_seen` (don't force re-onboarding/re-tour on re-signin). Aligns with AUTH-05 "clears local sensitive caches"; intentionally non-destructive on UI-state preferences.
- **D-12: localStorage re-key by user_id hash on signin.** Storage key changes from `leanshot_v4` (universal) to `leanshot_v4:<sha256(user_id).slice(0,16)>` once signed in. Anonymous users get their own namespace (hash of anon UID). Each authenticated user_id gets its own localStorage namespace — friend signs in on the same browser → fresh namespace, no leak path even if signout-clear (D-11) was somehow bypassed. Migration: pre-Phase-5 users opening the app on the upgrade boundary keep their `leanshot_v4` data; on first signin after upgrade, contents migrate to `leanshot_v4:<new_uid_hash>` and the universal key is deleted. STORAGE_VERSION 6 → 7 covers this.

### Email-verify gate + lifecycle (D-13)

- **D-13: Block sync only; local logging works (AUTH-06 wins over AUTH-02's "fully use").** Unverified-but-signed-in users can: view/edit local data, log new injections (queued in `pendingSyncIds`), use AI Coach, complete onboarding. What's blocked: cloud sync upload, Realtime subscription. UI shows a banner at the top of the dashboard: "Verify your email to sync across devices" with a "Resend verification" button. On verification (user clicks emailed link → redirected to `#/auth/verify?token=...`): the app pulls the verified session, runs the one-shot D-06 + D-10 sync, removes the banner. Aligns with the project's local-first invariant ("AI outage = degraded coach, not full-app outage" — same principle applied to verification).

### Account deletion (D-14)

- **D-14: Account deletion deferred entirely to Phase 7 (Compliance Foundations).** Phase 5 ships NO account-deletion UI. Phase 7's privacy/compliance work owns GDPR/CCPA-grade deletion (audit trail, data-export-before-delete, retention windows, legal-counsel sign-off). Phase 5 invite-only beta users can email support for deletion (manual SQL — service-role client deletes `auth.users` row, CASCADE handles `ai_messages` + `injections`). Document the manual support-channel deletion path in `.planning/decisions/account-deletion-interim.md` so support has a runbook.

### Claude's Discretion (not pre-decided)

The following are deferred to research + planner:

- **`injections` table schema** — columns, indexes, `(user_id, log_id)` unique constraint, soft-delete (`deleted_at` column? RLS-aware DELETE? — start with hard delete + LWW + later add soft-delete if Phase 7 needs it for compliance), trigger to set `updated_at = now()` on UPDATE. Researcher proposes; planner authors final SQL.
- **Email-confirm redirect URL strategy** — production URL: `https://leanshot-app.vercel.app/#/auth/verify`. PR previews need wildcard support (Vercel previews have unpredictable hostnames). Supabase's "Redirect URLs" allowlist requires explicit entries — researcher determines whether wildcards (`https://*.vercel.app/*`) work or if a fixed production URL + a `/auth/preview-redirect` proxy is needed.
- **Password policy** — Supabase default 6 chars too weak for a health app. Researcher proposes (likely 8-10 chars min + complexity rules); planner picks final and configures via `supabase config push`.
- **Custom email templates** — Supabase ships with generic defaults. For v1 ship-with-defaults; Phase 7 brand pass can custom-template later. If researcher finds the default is markedly off-brand or has trust-eroding copy, surface for one-line override.
- **Initial sync direction on a new device** — first signin on a fresh browser: pull-all (could be 100s of rows post-Phase-6 once all data types sync) vs pull-recent-365-days vs paginated. For Phase 5 with injections only and typical usage of ~1 injection/week, pull-all is fine (≤ 500 rows for the heaviest user). Reassess at Phase 6 when meals/water/etc multiply the row count.
- **Account screen UX** — D-04 says it reuses Settings drawer pattern. Specific fields: email (read-only, edit triggers `updateUser({email})` → re-verification flow), display name (optional, currently none in `user` slice — defer to a future "profile" phase). Researcher proposes; planner picks.
- **Avatar UX in topbar** — D-04 says initials or generic icon. Defer to UI-SPEC phase output (`/gsd-ui-phase 5` should run after this CONTEXT lands; planner reads both).
- **Marketing CTA copy** — D-03 specifies three CTA touchpoints; exact button copy ("Start tracking", "Save your data", etc.) is UI-SPEC + planner territory.
- **Toast copy + banner copy** — D-05's "Welcome back — your AI chat history is saved", D-06's "Your 42 saved injections are now synced", D-13's "Verify your email to sync across devices" — wording subject to UI-SPEC refinement.
- **Realtime reconnect storm protection** — D-09 ships a single subscription; if reconnect cycles hammer Supabase (e.g., flaky mobile network), planner adds debounce/backoff per Supabase Realtime best-practices. Defer until research surfaces the actual concern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS source-of-truth

- `.planning/ROADMAP.md` §"Phase 5: Patient Cloud Sync Slice 1 — Auth + Injections" — phase goal, SC#1..SC#5, Mode: mvp, Depends on: Phase 4, Requirements list.
- `.planning/REQUIREMENTS.md` §"Authentication" → AUTH-01..AUTH-06.
- `.planning/REQUIREMENTS.md` §"Sync" → SYNC-01 (Phase 5 delivers PARTIAL — injections only; weights/photos/meals/etc deferred to Phase 6), SYNC-05 (RLS for all Supabase tables — Phase 5 establishes the pattern that Phase 6+ inherits).

### Phase 4 outputs that Phase 5 builds on (MANDATORY reading)

- `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-CONTEXT.md` — Phase 4 locked decisions. **Note: D-02 wording about `linkIdentity` is stale — use `updateUser` per the ADDENDUM and Phase 5 D-05.**
- `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-ADDENDUM-MOONSHOT.md` — Moonshot pivot (does NOT affect Phase 5 auth/sync, but downstream agents should know the AI provider is Moonshot Kimi K2.6, not Anthropic).
- `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-RESEARCH.md` §"Pitfall 5" — the `linkIdentity` vs `updateUser` correction. Source-of-truth for D-05.
- `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-VERIFICATION.md` — confirms Phase 4 final state (anon→permanent promotion proven live; RLS pattern validated cross-tenant).
- `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-03-SUMMARY.md` — full implementation reference for the RLS + RPC + pg_cron patterns Phase 5 will mirror for `injections`.
- `.planning/decisions/supabase.md` — live state of Supabase project: ref `ytnsipxxmzgaebkqmokp`, region `eu-west-1`, magic-link + anonymous + manual-linking enabled, key-format choice (legacy JWT anon), service-role retrieval command, Phase 5 contract (use `updateUser`).

### Codebase maps downstream agents should consult

- `.planning/codebase/ARCHITECTURE.md` §"Layers", §"Data Flow → Primary request path — Log an injection", §"Architectural Constraints" (no router; single Zustand store; localStorage-only persistence) — Phase 5 must preserve all three.
- `.planning/codebase/INTEGRATIONS.md` §"Authentication & Identity" (current state post-Phase-4: Supabase Auth, anonymous + email magic-link enabled), §"Data Storage" (localStorage `leanshot_v4` key + STORAGE_VERSION schema).
- `.planning/codebase/STACK.md` — confirms React 19 + Vite + TS strict; localStorage is current; `@supabase/supabase-js@^2.105.4` added in Phase 4.
- `.planning/codebase/CONVENTIONS.md` §"Naming Conventions", §"State Management" — Phase 5 follows existing Zustand action verb-noun pattern (`signUp`, `signIn`, `signOut`, `verifyEmail`, `resetPassword`).
- `.planning/codebase/CONCERNS.md` — read for sync-related risks that downstream agents need to defuse.

### Existing source files Phase 5 modifies

- `src/App.tsx` — view selector extended with `auth` view (lazy-loaded sub-screens).
- `src/lib/store.ts` — adds `signedIn` slice (user, session, verified, anon), `pendingSyncIds` slice, auth actions (`signUp`, `signIn`, `signOut`, `verifyEmail`, `requestPasswordReset`, `setNewPassword`), sync action (`flushSyncQueue`).
- `src/lib/storage.ts` — STORAGE_VERSION 6 → 7; key construction changes from `leanshot_v4` (universal) to `leanshot_v4:<user_id_hash>` once signed in; migration from v6 → v7 namespaces the existing key for whichever UID (anon or signed-in) the user has.
- `src/lib/supabase.ts` — already exists from Phase 4 04-02; Phase 5 adds Realtime subscription setup helpers (`subscribeToInjections(userId)`, `unsubscribeFromInjections()`).
- `src/components/layout/Topbar.tsx` — add avatar menu (signed-in only).
- `src/components/marketing/Landing.tsx` — add "Sign in" header link + hero CTA.
- `src/components/onboarding/OnboardingFlow.tsx` — final step adds optional "Save your data" prompt routing to signup.
- `src/components/dashboard/settings/SettingsPage.tsx` — add "Account" section (email read-only with re-verification on change, manual change-password CTA that triggers password-reset email flow per D-02).
- `src/components/dashboard/tabs/MedicationTab.tsx` (and wherever the injection log form lives) — wire `addInjection` action to enqueue into `pendingSyncIds` rather than only local Zustand.
- `src/main.tsx` — adds `onAuthStateChange` listener at bootstrap (subscribes to Realtime on SIGNED_IN, unsubscribes on SIGNED_OUT).

### New files Phase 5 creates

- `src/components/auth/AuthView.tsx` — top-level auth container with hash-based sub-screen routing.
- `src/components/auth/SignUpForm.tsx`, `SignInForm.tsx`, `VerifyEmailLanding.tsx`, `ForgotPasswordForm.tsx`, `SetNewPasswordForm.tsx`.
- `src/components/auth/EmailVerificationBanner.tsx` — D-13 dashboard banner.
- `src/components/layout/AvatarMenu.tsx` — D-04 topbar avatar dropdown.
- `src/lib/sync.ts` — sync engine: flush-queue logic, conflict resolution (LWW client-side, but mostly server-authoritative).
- `src/lib/auth-migration.ts` — silent migration helpers (D-05 anon→permanent, D-06 local→cloud, D-12 storage re-key).
- `supabase/migrations/<ts>_injections.sql` — table + RLS policies + indexes + `updated_at` trigger.
- `e2e/auth-signup-verify-signin.test.ts` — Playwright smoke covering SC#1 end-to-end.
- `e2e/cross-tenant-rls-injections.test.ts` — SC#5 enforcement test (mirrors Phase 4's `rls-ai-messages.test.ts` pattern).
- `e2e/offline-log-then-sync.test.ts` — SC#4 offline-first smoke.
- `e2e/password-reset.test.ts` — SC#2 password reset flow.
- `.planning/decisions/account-deletion-interim.md` — D-14 manual-support-deletion runbook.

### External docs (researcher must verify current at execution time)

- Supabase Auth docs: `signUp`, `signInWithPassword`, `signInWithOtp` (magic-link), `signOut`, `resetPasswordForEmail`, `updateUser`, `onAuthStateChange`.
- Supabase email-confirm flow + `emailRedirectTo` option + Redirect URLs allowlist behavior (wildcard support for Vercel previews?).
- Supabase Realtime docs: `channel().on('postgres_changes', ...)`, filtering by `user_id=eq.<uid>`, reconnect behavior, subscription cleanup.
- Supabase RLS recipes for INSERT/UPDATE/DELETE policies + `auth.uid()` usage.
- `@supabase/supabase-js@^2.105.4` API surface for v2 client (already installed Phase 4).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (post-Phase-4)

- **`src/lib/supabase.ts`** (Phase 4 04-02) — `createClient` singleton with `storageKey: 'sb-leanshot-auth'`. Phase 5 reuses; adds Realtime helpers.
- **`src/lib/ai.ts` `callAIChat` pattern** (Phase 4 04-02) — fetch wrapper that calls `supabase.auth.signInAnonymously()` first-use if no session, then carries Bearer JWT. Phase 5's `signUp` flow promotes the anon UID via `updateUser` (per D-05); the Bearer JWT mechanism is unchanged.
- **`src/components/ui/Modal.tsx` + `Sheet.tsx`** — existing UI primitives. Auth forms can be implemented as full-page (within the new `auth` view) without needing modals, but the password-reset confirm-email-sent screen could reuse the Modal/Sheet pattern if the planner prefers.
- **Zustand `persist` middleware in `src/lib/store.ts`** — already handles localStorage. Phase 5 adds `pendingSyncIds` to the `partialize` allow-list. STORAGE_VERSION bump to 7 + migration function updates the localStorage key per D-12.
- **`src/lib/insights-refusal.ts` + `shared/refusal.ts`** (Phase 3 + Phase 4) — unchanged by Phase 5. AI Coach refusal continues to work over the existing Edge Function.
- **`leanshot/.planning/decisions/supabase.md`** — service-role key retrieval command (for the cross-tenant e2e test); project URL; tier-1 status confirmed.

### Established Patterns

- **Single Zustand store + persist + partialize** — Phase 5 follows this; no architectural change. New slices added.
- **Lazy-loaded route-equivalents** — `auth` view uses `React.lazy + Suspense` like onboarding/marketing/AIChatPanel.
- **`prefers-reduced-motion` aware animations** (per CLAUDE.md + Phase 1) — auth form transitions respect.
- **localStorage try/catch pattern** — every Phase 5 localStorage read/write follows the existing wrapped pattern in `storage.ts`.
- **RLS pattern from Phase 4 `ai_messages`** — `auth.uid() = user_id`, default-deny on SELECT/INSERT/UPDATE/DELETE; admin-client bypass for server-only writes. `injections` mirrors this; cross-tenant e2e test mirrors `rls-ai-messages.test.ts`.
- **Commit protocol** — `feat`/`fix`/`test`/`docs` separated; one commit per task; RED→GREEN paired when TDD applies; no `--no-verify`.
- **`/auth/v1/settings` curl verification** — Phase 4 04-01 proved this is the canonical "did my config push actually land?" check. Phase 5 can use it for Vercel preview redirect-URL allowlist verification too.

### Integration Points

- **Phase 4 Edge Function `ai-chat`** — works for anonymous AND signed-in users. Phase 5 doesn't touch the function; the JWT verification continues to accept whatever Supabase session is current (anon or permanent).
- **Phase 4 `ai_messages` table** — already RLS-scoped to `user_id = auth.uid()`. Phase 5's anon→permanent UID promotion preserves visibility (proven 04-03 Task 5).
- **Vercel projects `leanshot-app` + `leanshot-marketing`** — Phase 5 deploys to `leanshot-app` only (auth flows are app-side). The marketing site is unchanged except for the new "Sign in" header link added to `Landing.tsx`. `Landing.tsx` lives in `leanshot-app` build per Phase 2 layout? — researcher confirms which Vercel project owns Landing.tsx; if marketing-only, the header link adds a navigation hop to the app preview URL.
- **CI workflow at `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`** — Phase 5 adds Playwright smokes (auth signup+verify+signin, password reset, offline-first, cross-tenant RLS). The existing `lighthouse` + `deno-test` jobs gate merge; Phase 5 adds `playwright-auth` (or extends an existing playwright job).

</code_context>

<specifics>
## Specific Ideas

- **Supabase Auth methods to use** (per D-02 password-primary):
  - Signup: `supabase.auth.signUp({email, password, options: {emailRedirectTo: '<production-or-preview-url>/#/auth/verify'}})`.
  - Signin: `supabase.auth.signInWithPassword({email, password})`.
  - Magic-link (as forgot-password alternative): `supabase.auth.signInWithOtp({email, options: {emailRedirectTo: '<url>/#/auth/verify'}})`.
  - Password reset: `supabase.auth.resetPasswordForEmail(email, {redirectTo: '<url>/#/auth/set-new-password'})`.
  - Anon→permanent (D-05): from an already-anonymous session, `supabase.auth.updateUser({email})` (sends verify email), wait for confirm, then `supabase.auth.updateUser({password})`.
- **Storage-key migration shape** (per D-12):
  ```ts
  // src/lib/storage.ts STORAGE_VERSION = 7 migration
  // Old key: `leanshot_v4` (universal)
  // New key: `leanshot_v4:${sha256(userId).slice(0,16)}`
  // Migration: on first signin after upgrade, read `leanshot_v4`, write to new namespaced key, delete `leanshot_v4`.
  // Anonymous users get their own namespace via their anon UID (Phase 4 already creates the anon UID on first AI Coach use).
  ```
- **Pre-Phase-4 user path** (per D-06): some users have `leanshot_v4` localStorage with NO Supabase session at all (never used AI Coach in Phase 4, never signed up). On Phase 5 signup, the migration must (a) call `signUp` to mint a NEW permanent UID (no anon to promote), (b) read the universal `leanshot_v4` data, (c) bulk-upload injections to the new UID, (d) namespace localStorage to the new UID.
- **`injections` schema seed** (planner authors final SQL):
  ```sql
  create table public.injections (
    user_id uuid not null references auth.users(id) on delete cascade,
    log_id uuid not null,  -- client-generated UUID, stable across sync
    primary key (user_id, log_id),
    medication text not null,
    dose_mg numeric not null,
    site text not null,
    logged_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- consider: notes text, deleted_at timestamptz (soft delete)
  );
  create index injections_user_logged_at_idx on public.injections (user_id, logged_at desc);
  create trigger injections_set_updated_at before update on public.injections
    for each row execute function moddatetime(updated_at);
  alter table public.injections enable row level security;
  create policy "users read own" on public.injections for select using (auth.uid() = user_id);
  create policy "users insert own" on public.injections for insert with check (auth.uid() = user_id);
  create policy "users update own" on public.injections for update using (auth.uid() = user_id);
  create policy "users delete own" on public.injections for delete using (auth.uid() = user_id);
  ```
  Researcher confirms exact column types match the existing TypeScript `Injection` interface in `src/types/index.ts`; planner may adjust.
- **Email-confirm redirect URL allowlist for Vercel previews**: Supabase's "Redirect URLs" page accepts wildcards per recent docs (`https://*.vercel.app/*`). Researcher confirms at execution time. If wildcards don't work, fall back to listing each environment URL explicitly: production + the two preview project URLs (`leanshot-app.vercel.app`, `leanshot-ueqmx*-karstens-projects-16afd0e4.vercel.app` pattern) — Supabase docs allowed `*` as wildcard segment in 2025.
- **Cross-tenant RLS e2e test (SC#5) seed pattern** mirrors Phase 4's `rls-ai-messages.test.ts`: service-role admin client creates two anon users (or signs up two test emails with `emailRedirectTo` short-circuited), inserts a row for user A, then opens an anon-key client as user B and asserts `count = 0` from `select * from public.injections`. The admin client bypass test (user B tries to read user A's row using THEIR own JWT — assertion is "no row visible") is the meaningful security proof.
- **Toast copy seeds** (planner refines):
  - Post-signup: "Welcome! Check your email to verify your account."
  - Post-verify: "Email verified. Your data now syncs across devices."
  - Post-anon-promotion: "Welcome back — your AI chat history is saved to your account."
  - Post-local-injection-upload: "Your saved injections are now synced across devices." (count optional — researcher decides whether to surface the number).
  - Post-signout: "Signed out. Your data on this device has been cleared."

</specifics>

<deferred>
## Deferred Ideas

- **Other data-type sync (weights, photos, meals, supplements, mood, sleep, symptoms, settings)** — Phase 6 Slice 2.
- **Photos via Supabase Storage** — Phase 6 Slice 2 (photo blobs + thumbnails + signed-URL access).
- **Account deletion UI + GDPR/CCPA-grade data export** — Phase 7 Compliance Foundations.
- **Custom branded email templates** — Phase 7 brand pass; Phase 5 ships with Supabase defaults.
- **Per-field merge conflict resolution** — defer until production shows real conflict frequency post-launch.
- **Service Worker / background sync API** — defer until reliability data justifies the additional infrastructure.
- **BroadcastChannel for cross-tab Realtime sharing** — defer until multi-tab usage is shown to cause load issues.
- **Magic-link as primary auth method** — Phase 5 ships password-primary; could revisit post-launch if user research shows password friction.
- **OAuth providers (Google / Apple / Sign-in-with-X)** — explicitly out of scope for v1; "Enable Manual Linking" is already on (Phase 4 04-01 Task 4) so a future phase can add OAuth without re-toggling.
- **Multi-device "trusted devices" management** — like Stripe/GitHub's "see your active sessions" — future phase.
- **Account-wide settings sync (timezone, units, theme)** — settings table is part of Phase 6 Slice 2.
- **Pricing-tier-aware sync (limit free users to N injections)** — explicitly rejected for v1; v2 monetization.

</deferred>

---

*Phase: 05-patient-cloud-sync-slice-1-auth-injections*
*Context gathered: 2026-05-11 via /gsd-discuss-phase*
