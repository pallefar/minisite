# Phase 5: Patient Cloud Sync Slice 1 — Auth + Injections — Research

**Researched:** 2026-05-11
**Domain:** Supabase Auth (email/password + magic-link + anon-promote) + Supabase Realtime (postgres_changes row-filtered subscription) + RLS (auth.uid()=user_id on `injections`) + Zustand-backed offline write queue with LWW conflict resolution.
**Confidence:** HIGH for Supabase API surface (Context7 fetched live 2026-05-11; `updateUser`, Realtime postgres_changes, signOut scope, resetPasswordForEmail, resend, Redirect-URL wildcards all verified verbatim against current Supabase docs). MEDIUM for moddatetime extension availability on Supabase free tier (standard contrib; confirm at execution time). MEDIUM for Realtime "initial state on subscribe" behavior (postgres_changes does NOT replay; explicit initial `select` required — confirmed via `stream()` Dart docs that explicitly call out the combine pattern; the bare `channel().on('postgres_changes')` JS API does not). HIGH for verified Phase 4 baseline (live `auth.users` count, RLS pattern, project ref `ytnsipxxmzgaebkqmokp`).

## Summary

Phase 5 is the bridge from "anonymous AI coach + local-only logging" (Phase 4 ship state) to "permanent identity + cross-device sync for injections". The mechanics are well-trodden Supabase patterns — none of the four pillars (anon→permanent promotion via `updateUser`, Realtime postgres_changes with `filter: 'user_id=eq.<uid>'`, RLS `auth.uid() = user_id` default-deny, server-authoritative LWW via `moddatetime`) require novel architecture. The hard parts are local-first integration discipline: when `addInjection` fires, the Zustand write MUST land before any network call (zero-latency UX), and the resulting write must be classified into "synced now / queued for later / blocked by email-verify gate" deterministically.

The non-obvious complications cluster in three places: (1) the existing `Injection` interface has NO stable `id` field — `(user_id, log_id)` composite key requires the planner to add a client-generated `log_id` (UUID) to new injections and back-stamp existing localStorage rows during the v6→v7 migration; (2) the `auth.onAuthStateChange` callback MUST defer all Supabase calls via `setTimeout(fn, 0)` per official docs to avoid deadlocks — a footgun that's not optional; (3) cross-tab signout: Supabase v2 fires `SIGNED_OUT` across tabs automatically via the localStorage `storage` event, so we get cross-tab propagation for free without BroadcastChannel — but the Realtime subscription in tab B must observe this and unsubscribe before its stale JWT fails.

**Primary recommendation:** Three plans matching the CONTEXT canonical_refs layout — 5-01 schema + RLS migration + cross-tenant test, 5-02 auth UI + state machine + storage namespacing migration, 5-03 sync engine + Realtime + offline queue + 4 Playwright SCs. Use `moddatetime` extension (standard contrib, ships with Supabase). Use `crypto.subtle.digest('SHA-256', ...)` (browser-native) for the user_id hash — no new dependency. Subscribe to Realtime AFTER an explicit initial `select` to seed the store (postgres_changes does not replay history). Promote anon UID via the documented two-step `updateUser({email})` → confirm → `updateUser({password})` flow — `linkIdentity` remains forbidden (OAuth-only). For Vercel preview redirect URLs, use Supabase's documented `https://*-karstens-projects-16afd0e4.vercel.app/**` wildcard pattern + production exact URL.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New top-level `auth` view in `App.tsx`; hash routing inside (`#/auth/signup`, `#/auth/signin`, `#/auth/verify`, `#/auth/forgot`, `#/auth/set-new-password`). Lazy-loaded.
- **D-02:** Password-primary; magic-link as "forgot password" alternative. Both providers stay enabled server-side.
- **D-03:** Three CTA touchpoints from marketing — header link + hero CTA + post-onboarding prompt.
- **D-04:** Topbar avatar menu — Account / Sign out / Settings.
- **D-05:** Silent anon→permanent UID promotion via `updateUser({email})` → email confirm → `updateUser({password})` + post-signup toast. NOT `linkIdentity` (OAuth-only).
- **D-06:** Silent bulk-upload of pre-Phase-4 local injections via `(user_id, log_id)` unique constraint.
- **D-07:** Migration order: promote anon UID FIRST, then upload local injections to same UID.
- **D-08:** LWW conflict resolution by server-side `updated_at` (trigger on UPDATE).
- **D-09:** Single global Realtime subscription on signin; top-level useEffect in App.tsx; cleanup on signout + unload.
- **D-10:** Offline queue via Zustand `pendingSyncIds: string[]` slice + existing persist middleware (STORAGE_VERSION 6→7).
- **D-11:** Signout clears user-data slices; preserves theme + onboarded + tour_seen.
- **D-12:** Re-key localStorage by user_id hash (`leanshot_v4:<sha256(user_id).slice(0,16)>`); anon users also get their own namespace.
- **D-13:** Email-verify gate blocks SYNC only; local logging works. Banner with 24h dismissible.
- **D-14:** Account deletion deferred entirely to Phase 7.

### Claude's Discretion

- `injections` schema (columns, indexes, soft-delete decision) — **resolved §4 below**.
- Email-confirm redirect URL strategy for Vercel previews — **resolved §3 below**.
- Password policy — **resolved §9 below**.
- Custom email templates — defer to Phase 7 brand pass; ship Supabase defaults (planner spot-checks at execution time).
- Initial-sync direction — pull-all (≤500 rows even for heaviest user; reassess Phase 6).
- Account screen fields — email (read-only, editable triggers re-verification), password (change → reset email). No display-name (UI-SPEC §10 confirms).
- Realtime reconnect-storm protection — **resolved §5 below** (rely on supabase-js built-in exponential backoff; add nothing custom).

### Deferred Ideas (OUT OF SCOPE)

- Other data-type sync (weights/photos/meals/supplements/mood/sleep/symptoms/settings) — Phase 6.
- Photos via Supabase Storage — Phase 6.
- Account deletion UI + GDPR/CCPA-grade data export — Phase 7.
- Custom branded email templates — Phase 7.
- Per-field merge conflict resolution — v2.
- Service Worker / background sync — v2.
- BroadcastChannel cross-tab Realtime sharing — v2.
- Magic-link as primary — post-launch user research dependent.
- OAuth providers — v2+.
- Multi-device "trusted devices" — future phase.
- Pricing-tier-aware sync — v2 monetization.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User creates account with email+password via Supabase Auth | §1 `signUp` + §2 anon-promotion |
| AUTH-02 | Email verification on signup; gates full app use | §1 `signUp`+`resend` + §8 email-verify lifecycle (D-13 narrows "gates" to "gates SYNC only") |
| AUTH-03 | Sign-in across devices; session persists across refresh | §1 `signInWithPassword` + Supabase auto-refresh (already enabled in `src/lib/supabase.ts:42-46`) |
| AUTH-04 | Password reset via emailed link | §1 `resetPasswordForEmail` + `updateUser({password})` |
| AUTH-05 | Sign-out clears local sensitive caches | §6+§8 (D-11 enumerates cleared slices; D-12 namespaced storage) |
| AUTH-06 | Offline use after sign-in (local logging continues) | §6 offline queue mechanics + §8 email-verify gate honors local-first invariant |
| SYNC-01 (PARTIAL) | `injections` syncs across devices via Supabase | §4 schema + §5 Realtime subscription + §6 offline queue |
| SYNC-05 | All Supabase tables enforce per-user RLS scoping | §4 RLS policies + §11 cross-tenant test mirrors `e2e/rls-ai-messages.test.ts` |

---

## Project Constraints (from CLAUDE.md)

Directives the planner must verify in every plan:

- **Tech stack locked:** React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. Phase 5 introduces no new dependency — `@supabase/supabase-js@^2.105.4` already installed (Phase 4); browser `crypto.subtle.digest` is native.
- **Local-first must keep working:** offline + unverified users continue to log injections locally. The email-verify gate (D-13) blocks SYNC, not LOGGING. Honors AUTH-06 over a strict reading of AUTH-02.
- **AI outage = degraded coach UX, not full-app outage:** same principle extended to Supabase outage in Phase 5 — Realtime down or network gone = degraded SYNC, dashboard stays usable, writes queue in Zustand.
- **Bundle size discipline:** Phase 5 adds NO new runtime dependencies. The new code (`src/lib/auth.ts`, `src/lib/sync.ts`, `src/lib/auth-migration.ts`, `src/components/auth/*`) is all already-included framework + supabase-js surface. Auth view is lazy-loaded (D-01) so its bundle stays out of the dashboard cold path.
- **Strict TypeScript / no `any` / explicit return types on exported functions:** every new file follows this. Existing Phase 4 `src/lib/supabase.ts` is the pattern to copy.
- **Accessibility end-to-end:** new error states + banner follow `role="status" aria-live="polite"` (UI-SPEC §8, §11 enforces).
- **GSD workflow enforcement:** all file changes go through GSD; planner authors plans, executor implements.
- **Commit protocol:** `feat:`/`fix:`/`test:`/`docs:` separated; one commit per task; RED→GREEN paired when TDD applies; no `--no-verify`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth method calls (signUp, signInWithPassword, resetPasswordForEmail, updateUser, resend) | Browser / Client (`@supabase/supabase-js`) | API / Backend (Supabase Auth service) | Session lives in browser localStorage; server validates + mints JWT; auto-refresh runs client-side per `src/lib/supabase.ts:42` |
| Email confirmation + password-reset link issuance | API / Backend (Supabase mailer) | — | Supabase manages SMTP + token minting; client never sees the raw token until it's clicked back into the redirect URL |
| `injections` row write (`addInjection`) | Browser / Client (Zustand store, FIRST) | API / Backend (Supabase Postgres, EVENTUALLY) | Local-first invariant: UI updates before network; sync engine drains queue async |
| Conflict resolution (LWW) | Database / Storage (Postgres trigger `moddatetime` on UPDATE) | — | Server-authoritative timestamp avoids client-clock-skew; clients never compute `updated_at` |
| Realtime fan-out across signed-in user's devices | API / Backend (Supabase Realtime service) | Browser / Client (channel subscription handler) | Server publishes; client merges into Zustand. RLS gates which rows reach the client. |
| RLS enforcement on `injections` | Database / Storage (Postgres RLS policies) | — | Per SYNC-05: RLS is THE primitive; application-layer filtering is defense-in-depth, not the source of truth |
| Cross-tab signout propagation | Browser / Client (supabase-js built-in `storage` event listener) | — | Phase 5 leverages free behavior; BroadcastChannel deferred (D-09 explicit) |
| Storage namespacing by user_id hash | Browser / Client (`src/lib/storage.ts` migration) | — | Per D-12; localStorage layout is browser-side concern |
| Vercel preview redirect URL allowlist | API / Backend (Supabase dashboard config) | — | One wildcard entry covers all PR previews per §3 below |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | `^2.105.4` `[VERIFIED: npm view @supabase/supabase-js version → 2.105.4 latest, 2026-05-11]` | Auth + Realtime + Postgres client. Already installed Phase 4. | Single official client. The `auth`, `channel`, and `from` namespaces cover all Phase 5 needs. No alternative provider considered (Supabase is locked per PROJECT.md). |
| `supabase` CLI | `^2.98.2` `[VERIFIED: npm view supabase version]` | `supabase db push` for the new migration; `supabase config push` for password-policy + redirect-URL allowlist updates. | Already installed via `npx --prefix leanshot supabase` per Phase 4 `.planning/decisions/supabase.md`. |

### Supporting (browser-native — no new dependencies)

| API | Purpose | Where Used |
|-----|---------|------------|
| `crypto.subtle.digest('SHA-256', ...)` | Hash `user.id` into storage namespace `leanshot_v4:<hash16>`. Returns ArrayBuffer; convert to hex via `Uint8Array` + `Array.from`. | `src/lib/storage.ts` v6→v7 migration |
| `crypto.randomUUID()` | Generate stable client-side `log_id` UUID for each `Injection`. Built-in to all modern browsers. | `addInjection` action in `src/lib/store.ts` |
| `window.addEventListener('online' / 'offline' / 'beforeunload')` | Online detection for sync flush; unload cleanup of Realtime channel (D-09 cleanup). | `src/lib/sync.ts` + App.tsx top-level useEffect |
| `navigator.onLine` | Boolean check before flushing offline queue. Note: this is best-effort (`navigator.onLine === true` doesn't guarantee connectivity); the Supabase call itself is the real test. | Sync engine guard |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.subtle.digest` (sync hash) | `js-sha256` npm package | +5kB gz for zero benefit; native API is async but Phase 5's only caller is the storage migration which is already async. |
| BroadcastChannel for cross-tab signout | Built-in supabase-js `storage` event propagation | supabase-js already fires `SIGNED_OUT` across tabs via the localStorage `storage` event (verified Context7: `signOut(options)` — "removes all items from localStorage and triggers a SIGNED_OUT event"; the SDK's `onAuthStateChange` registers a `storage` listener at construction time). BroadcastChannel adds nothing for Phase 5. Defer to v2 per D-09 explicit. |
| IndexedDB queue (SYNC-04 spec — Phase 6) | Zustand `pendingSyncIds` + existing persist middleware | D-10 explicit: STORAGE_VERSION 6→7 covers it. IndexedDB defer until photos (Phase 6) push localStorage past 5MB. |
| Per-table Realtime subscriptions | Single global subscription per user | D-09 explicit: top-level App.tsx, survives tab switches, one channel per session. |

**Version verification:**

```bash
npm view @supabase/supabase-js version    # → 2.105.4 (latest, verified 2026-05-11)
npm view @supabase/supabase-js time.modified  # check publish date
```

Phase 4 confirmed `2.105.4` works against the live project (`auth.signInAnonymously`, `auth.getUser`, `auth.signOut`, JWT Bearer pattern all green). Phase 5 needs the additional surfaces — all documented for v2.x and confirmed present in current docs.

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BROWSER (signed-in patient on device A)                                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  React UI (App.tsx, AuthView, AvatarMenu, EmailVerificationBanner)   │   │
│  └──────────────┬───────────────────────────┬───────────────────────────┘   │
│                 │                            │                                │
│       reads     │                            │   dispatches actions          │
│                 ▼                            ▼                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Zustand store (signedIn slice + pendingSyncIds + existing slices)   │   │
│  │  ↕ persist middleware → localStorage[`leanshot_v4:<user_id_hash>`]   │   │
│  └──┬──────────────┬───────────────────────────────────────────────────┬┘   │
│     │              │                                                    │     │
│     │              │ subscribes (read)                                  │     │
│     │              ▼                                                    │     │
│     │  ┌───────────────────────────┐                                   │     │
│     │  │  src/lib/sync.ts          │                                   │     │
│     │  │  - flushSyncQueue()       │      onAuthStateChange            │     │
│     │  │  - mergeRemoteEvent()     │  ┌─────────────────────┐         │     │
│     │  │  - subscribeInjections()  │  │ src/lib/auth.ts     │         │     │
│     │  └────────┬──────────┬───────┘  │ - signUp            │         │     │
│     │           │          │           │ - signIn            │         │     │
│     │           │          │           │ - signOut           │         │     │
│     │  upsert   │          │ subscribe │ - resetPassword     │         │     │
│     │  (write)  │          │ postgres_ │ - updateUser        │         │     │
│     │           │          │ changes   │   (anon-promote)    │         │     │
│     │           ▼          ▼           └──────┬──────────────┘         │     │
│     │  ┌──────────────────────────────────────┴──────────────┐         │     │
│     │  │  src/lib/supabase.ts (singleton, Phase 4)           │         │     │
│     │  └────────┬──────────────────────────────┬─────────────┘         │     │
│     │           │                              │                        │     │
└─────┼───────────┼──────────────────────────────┼────────────────────────┼─────┘
      │           │  HTTPS                       │  WebSocket (Phoenix)   │
      │           ▼                              ▼                        │
      │  ┌─────────────────────┐    ┌───────────────────────────┐       │
      │  │ Supabase PostgREST  │    │ Supabase Realtime service │       │
      │  │ /rest/v1/injections │    │ postgres_changes broker   │       │
      │  │                     │◀───┤ filter: user_id=eq.<uid>  │       │
      │  └─────────┬───────────┘    └──────────┬────────────────┘       │
      │            │  RLS check                 │  RLS-aware fanout      │
      │            │  auth.uid()=user_id        │                        │
      │            ▼                            ▼                        │
      │  ┌─────────────────────────────────────────────────────────┐   │
      │  │  Postgres (project ref ytnsipxxmzgaebkqmokp, eu-west-1)  │   │
      │  │  ┌────────────────────────────────────────────────────┐ │   │
      │  │  │ public.injections                                   │ │   │
      │  │  │  PK (user_id, log_id)                              │ │   │
      │  │  │  RLS: auth.uid() = user_id (SELECT/INS/UPD/DEL)    │ │   │
      │  │  │  TRIGGER moddatetime BEFORE UPDATE → updated_at     │ │   │
      │  │  └────────────────────────────────────────────────────┘ │   │
      │  │  ┌────────────────────────────────────────────────────┐ │   │
      │  │  │ auth.users  (anon row promotes in-place per D-05)   │ │   │
      │  │  └────────────────────────────────────────────────────┘ │   │
      │  └─────────────────────────────────────────────────────────┘   │
      │                                                                  │
      └──── (device B: same Realtime fanout; merges into its Zustand) ──┘
```

**Reading the diagram:**

- Local write path: UI → Zustand (instant) → `pendingSyncIds` enqueue → `flushSyncQueue` (async, debounced) → `supabase.from('injections').upsert(...)` → Postgres → Realtime broker fans out.
- Remote write path: Other device's write → Postgres → Realtime broker → WebSocket → `subscribeInjections` handler → `mergeRemoteEvent` (LWW via `updated_at`) → Zustand merge.
- Auth path: `auth.ts` calls thin wrappers; `onAuthStateChange` event fires at top-level App.tsx; SIGNED_IN triggers `subscribeInjections` + initial pull + queue flush; SIGNED_OUT triggers `unsubscribeInjections` + Zustand reset (D-11) + storage re-key cleanup.

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── App.tsx                       # extended: 'auth' view in selector + top-level useEffect for onAuthStateChange
│   ├── main.tsx                      # unchanged (hydrate path stays)
│   ├── components/
│   │   ├── auth/                     # NEW
│   │   │   ├── AuthView.tsx          # hash-routed container (UI-SPEC §1)
│   │   │   ├── SignUpForm.tsx        # UI-SPEC §2
│   │   │   ├── SignInForm.tsx        # UI-SPEC §3
│   │   │   ├── VerifyEmailLanding.tsx # UI-SPEC §4
│   │   │   ├── PostSignupSent.tsx    # UI-SPEC §5
│   │   │   ├── ForgotPasswordForm.tsx # UI-SPEC §6
│   │   │   ├── SetNewPasswordForm.tsx # UI-SPEC §7
│   │   │   └── EmailVerificationBanner.tsx # UI-SPEC §8
│   │   ├── layout/
│   │   │   ├── Topbar.tsx            # MODIFIED: render AvatarMenu (signed-in or anon)
│   │   │   └── AvatarMenu.tsx        # NEW (UI-SPEC §9)
│   │   ├── dashboard/
│   │   │   └── settings/
│   │   │       └── SettingsPage.tsx  # MODIFIED: prepend Account section (UI-SPEC §10)
│   │   ├── marketing/
│   │   │   └── Landing.tsx           # MODIFIED: add "Sign in" header link (UI-SPEC §12)
│   │   └── onboarding/
│   │       └── OnboardingFlow.tsx    # MODIFIED: final step "Save your data" prompt (UI-SPEC §11)
│   ├── lib/
│   │   ├── supabase.ts               # unchanged (Phase 4 singleton)
│   │   ├── auth.ts                   # NEW: thin wrappers around supabase.auth.* (testable seam)
│   │   ├── sync.ts                   # NEW: subscribeInjections, flushSyncQueue, mergeRemoteEvent
│   │   ├── auth-migration.ts         # NEW: anon→permanent, local→cloud, storage re-key
│   │   ├── store.ts                  # MODIFIED: + signedIn slice + pendingSyncIds + auth/sync actions
│   │   └── storage.ts                # MODIFIED: STORAGE_VERSION 6→7 + namespaced key
│   └── types/
│       └── index.ts                  # MODIFIED: Injection adds `log_id: string` + `updated_at?: string`
├── e2e/                              # NEW Playwright suites for Phase 5
│   ├── auth-signup-verify-signin.test.ts   # SC#1
│   ├── password-reset.test.ts              # SC#2
│   ├── signout-cache-clear.test.ts         # SC#3 (Playwright half) + co-located vitest
│   ├── offline-log-then-sync.test.ts       # SC#4
│   └── rls-injections.test.ts              # SC#5 (vitest, mirrors rls-ai-messages.test.ts)
└── supabase/
    └── migrations/
        └── 20260513000000_injections.sql   # NEW: table + RLS + indexes + moddatetime trigger
```

### Pattern 1: Auth wrapper module (`src/lib/auth.ts`) — testable seam

**What:** Thin functions wrapping `supabase.auth.*` calls. Centralized so the planner can mock for unit tests; UI components never call `supabase.auth.*` directly.

**When to use:** Every UI component that needs to sign up/in/out/etc imports from `src/lib/auth.ts` instead of `src/lib/supabase.ts`.

**Example:**
```typescript
// src/lib/auth.ts
// Source: Context7 Supabase docs (signUp, signInWithPassword, resetPasswordForEmail, updateUser, resend, signOut, getSession)
import { supabase } from '@/lib/supabase';
import type { AuthError, Session, User } from '@supabase/supabase-js';

export interface AuthResult { user: User | null; session: Session | null; error: AuthError | null; }

/** Build the email-link redirect URL — preferred = window.location.origin (covers prod + previews). */
function authRedirectTo(hash: string): string {
  if (typeof window === 'undefined') return `https://leanshot-app.vercel.app${hash}`;
  return `${window.location.origin}${hash}`;
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { user: data.user, session: data.session, error };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data.user, session: data.session, error };
}

export async function signInWithMagicLink(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { error };
}

export async function signOut(): Promise<{ error: AuthError | null }> {
  // Local scope per Context7 best practice — global signs out EVERY device,
  // which is footgun behavior for the "I'm done on this laptop" use case.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  return { error };
}

export async function requestPasswordReset(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectTo('/#/auth/set-new-password'),
  });
  return { error };
}

export async function setNewPassword(password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { user: data.user, session: null, error };
}

export async function resendVerification(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { error };
}

/** Anon-promotion step 1: attach an email to the current anonymous user. Sends verify email. */
export async function attachEmailToAnon(email: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ email });
  return { user: data.user, session: null, error };
}

/** Anon-promotion step 2: after email is verified, set the password. */
export async function setPasswordOnPromoted(password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { user: data.user, session: null, error };
}

export async function getSession(): Promise<{ session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

export async function getUser(): Promise<{ user: User | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
}
```
`[CITED: https://supabase.com/docs/reference/javascript/auth-signinwithpassword]`
`[CITED: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail]`
`[CITED: https://supabase.com/docs/guides/auth/auth-anonymous]` (updateUser anon-promotion)
`[CITED: https://supabase.com/docs/guides/auth/signout]` (signOut scope)

### Pattern 2: Sync engine (`src/lib/sync.ts`)

**What:** Three pure-ish functions: `subscribeInjections(userId)`, `flushSyncQueue()`, `mergeRemoteEvent(payload)`. App.tsx wires them; Zustand state owns the data.

**When to use:** All cross-device write/read goes through here. UI components never call `supabase.from('injections')` directly.

**Example (skeleton):**
```typescript
// src/lib/sync.ts
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Injection } from '@/types';

let injectionsChannel: RealtimeChannel | null = null;

export async function pullInitialInjections(userId: string): Promise<void> {
  // Realtime postgres_changes does NOT replay history — must explicit-pull on signin.
  const { data, error } = await supabase
    .from('injections')
    .select('*')
    .eq('user_id', userId)        // explicit filter even though RLS enforces — Supabase docs note this helps query planner
    .order('logged_at', { ascending: false });
  if (error) { console.error('[leanshot] pullInitial failed', error); return; }
  // LWW merge: server rows win over local on conflict by log_id; local-only rows preserved.
  useStore.getState().mergeServerInjections(data ?? []);
}

export function subscribeInjections(userId: string): void {
  if (injectionsChannel) return; // already subscribed
  injectionsChannel = supabase
    .channel(`injections:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',                              // INSERT / UPDATE / DELETE
        schema: 'public',
        table: 'injections',
        filter: `user_id=eq.${userId}`,          // RLS gates this server-side too; filter is for narrowing the stream
      },
      (payload) => {
        useStore.getState().applyRealtimePayload(payload);
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[leanshot] injections channel error', status);
        // supabase-js handles reconnect with exponential backoff internally; no custom logic needed.
      }
    });
}

export async function unsubscribeInjections(): Promise<void> {
  if (!injectionsChannel) return;
  await supabase.removeChannel(injectionsChannel);
  injectionsChannel = null;
}

export async function flushSyncQueue(): Promise<void> {
  const state = useStore.getState();
  if (!state.signedIn?.user || !state.signedIn.verified) return;  // gate: D-13
  if (!navigator.onLine) return;
  const pending = state.pendingSyncIds;
  if (pending.length === 0) return;
  const rows = state.injections.filter((i) => pending.includes(i.log_id));
  if (rows.length === 0) { state.clearPendingSyncIds(pending); return; }
  const { error } = await supabase
    .from('injections')
    .upsert(
      rows.map((r) => ({
        user_id: state.signedIn.user.id,
        log_id: r.log_id,
        medication: r.medication,    // mapped from existing Injection.dose/unit/site/notes/datetime
        dose: r.dose,
        unit: r.unit,
        site: r.site,
        notes: r.notes,
        logged_at: r.datetime,
        pk_engine_version: r.pkEngineVersion ?? 1,
      })),
      { onConflict: 'user_id,log_id' },
    );
  if (error) {
    console.error('[leanshot] flushSyncQueue failed', error);
    return; // keep pendingSyncIds for retry on next online/auth event
  }
  state.clearPendingSyncIds(pending);
}
```
`[CITED: https://supabase.com/docs/guides/realtime/postgres-changes?language=js]` (filter syntax)
`[CITED: https://supabase.com/docs/reference/javascript/upsert]` (onConflict)
`[CITED: https://supabase.com/docs/guides/auth/row-level-security]` (explicit filter alongside RLS helps query planner)

### Pattern 3: `onAuthStateChange` orchestration in `src/App.tsx`

**What:** ONE top-level `useEffect` at App.tsx that subscribes to auth state changes and orchestrates: subscribe-on-signin, unsubscribe-on-signout, sync-on-verify, queue-flush-on-online.

**CRITICAL gotcha:** Supabase docs explicitly warn: *"Do not use async functions as callbacks to avoid deadlocks. Do not use other Supabase functions directly in the callback. Dispatch them after the callback finishes using setTimeout."*

**Example:**
```tsx
// src/App.tsx (excerpt)
useEffect(() => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // CRITICAL: defer all supabase.* calls via setTimeout(fn, 0) per official docs.
    setTimeout(() => {
      void handleAuthEvent(event, session);
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}, []);

async function handleAuthEvent(event: AuthChangeEvent, session: Session | null): Promise<void> {
  switch (event) {
    case 'INITIAL_SESSION':
      // Set Zustand from cached session; if user.email_confirmed_at => verified=true.
      useStore.getState().setSession(session);
      if (session?.user && !session.user.is_anonymous && session.user.email_confirmed_at) {
        await pullInitialInjections(session.user.id);
        subscribeInjections(session.user.id);
        await flushSyncQueue();
      }
      break;
    case 'SIGNED_IN':
      // Fires on signin AND on tab refocus per docs; idempotent ops only.
      useStore.getState().setSession(session);
      if (session?.user && !session.user.is_anonymous && session.user.email_confirmed_at) {
        await pullInitialInjections(session.user.id);
        subscribeInjections(session.user.id);
        await runAnonPromotionMigrationIfNeeded(session.user.id);  // §2 below
        await runLocalToCloudMigrationIfNeeded(session.user.id);   // §2 below
        await renameStorageNamespace(session.user.id);             // §7 below
        await flushSyncQueue();
      }
      break;
    case 'SIGNED_OUT':
      await unsubscribeInjections();
      useStore.getState().clearUserDataSlices();  // D-11
      // Note: signOut() already removed Supabase's own storage key; our partialize'd persist will re-emit on next state change.
      break;
    case 'PASSWORD_RECOVERY':
      // User clicked the password-reset link; route to set-new-password.
      window.location.hash = '#/auth/set-new-password';
      break;
    case 'USER_UPDATED':
      // Fires after updateUser({email}) confirms OR updateUser({password}) succeeds.
      useStore.getState().setSession(await getSessionOrNull());
      break;
    case 'TOKEN_REFRESHED':
      // No-op for Phase 5: Zustand session.access_token is read fresh via getSession() when needed.
      break;
  }
}
```
`[CITED: https://supabase.com/docs/reference/javascript/auth-onauthstatechange]` (event types + setTimeout gotcha)

### Anti-Patterns to Avoid

- **Async callback in onAuthStateChange:** see above — deadlocks. Use `setTimeout(fn, 0)` to dispatch.
- **Per-component Realtime subscriptions:** UI mount/unmount races; missed updates when tab is switched. D-09 explicit: single global.
- **Trusting client-supplied `updated_at` in upserts:** breaks LWW. Always let the server trigger set it; if you must send a value, ignore it server-side by NOT including it in the column list of the upsert (Postgres uses the default `now()` on insert; the trigger overwrites on update).
- **Calling `supabase.auth.*` from a synchronous onAuthStateChange handler:** docs forbid it; trips the SDK's internal locks.
- **Filtering postgres_changes by RLS alone:** the SDK still receives all the rows the server emits — explicit `filter: 'user_id=eq.<uid>'` keeps the WebSocket payload minimal.
- **`signOut()` without `scope: 'local'`:** default is `global` — signs out EVERY device of that user, which is a hostile UX. Always pass `{ scope: 'local' }` for the user-facing "Sign out" button.
- **Using `linkIdentity({email, password})` for anon→permanent:** OAuth-only. Phase 4 Pitfall 5 + `.planning/decisions/supabase.md` Phase 5 hand-off contract both lock this down.
- **Mutating `Injection` rows in Zustand without updating `log_id`:** stable identity is the primary key; never mutate `log_id`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email + password auth | Custom JWT issuance, bcrypt password hashing, password-reset token flow | `supabase.auth.signUp` + `signInWithPassword` + `resetPasswordForEmail` | All four endpoints + the mailer + the redirect-URL flow are managed by Supabase; rolling your own is a 6-month project. |
| Cross-device sync transport | Custom WebSocket server, Server-Sent Events, polling | Supabase Realtime `postgres_changes` | Phoenix Channels under the hood; built-in reconnect with exponential backoff; RLS-aware fanout. |
| `updated_at` maintenance on UPDATE | Application-layer "now()" stamping | Postgres `moddatetime` trigger (`extensions.moddatetime`) | Server-authoritative timestamp avoids client-clock-skew (D-08). `moddatetime` is standard PostgreSQL contrib, ships with Supabase free tier — verified via Phase 4 `create extension if not exists pg_cron` precedent. |
| Tenant isolation | Application-layer `WHERE user_id = current_user` everywhere | Postgres RLS (`auth.uid() = user_id`) | SYNC-05 mandates RLS as THE primitive. Application filtering is defense-in-depth — but a forgotten WHERE clause in app code is a P0 data leak; a forgotten WHERE clause WITH RLS in place returns zero rows. |
| Conflict resolution | Per-field merge, vector clocks, CRDTs | Last-write-wins via server `updated_at` | D-08 explicit. Per-field merge premature for log-style data; CRDT overkill. |
| Storage namespace per user | Cookie-based session shard | localStorage key `leanshot_v4:<sha256(user_id).slice(0,16)>` | D-12 explicit; browser-native crypto.subtle.digest is sufficient; no cookies (CSP simpler). |
| Cross-tab signout | BroadcastChannel API, custom sync messages | supabase-js built-in `storage` event listener | Already wired; SIGNED_OUT fires across tabs for free. Verified Context7: signOut "removes all items from localStorage and triggers a SIGNED_OUT event." |
| UUID generation for `log_id` | `uuid` npm package | `crypto.randomUUID()` | Native, supported in all modern browsers; zero dependencies. |
| SHA-256 for storage hash | `js-sha256` npm package | `crypto.subtle.digest('SHA-256', ...)` | Native; the storage migration is already async-tolerant. |
| Reconnect backoff for Realtime | Custom debounce + exponential backoff in app code | supabase-js built-in reconnect logic | The SDK already implements exponential backoff with jitter on WebSocket disconnect. Adding our own would conflict. |
| Password-reset rate limiting | Custom rate-limit table | Supabase Auth's built-in rate limit on `/auth/v1/recover` | Supabase enforces per-email + per-IP; bypassable only via support escalation. Our `max_frequency: 1m0s` config (Phase 4 commit a9850a0) already covers this. |

**Key insight:** Phase 5 should write ZERO bytes of crypto, ZERO bytes of WebSocket plumbing, and ZERO bytes of conflict-resolution mathematics. Every supabase-js + Postgres-trigger boundary is doing the work; our code orchestrates it.

---

## Detailed Resolutions of Open Items

### §1. Supabase Auth API surface for Phase 5

All signatures verified against Context7 Supabase docs 2026-05-11 (live). For each method, this is the exact call site the planner copies into `src/lib/auth.ts` / store actions.

| Method | Call signature | Returns | Notes |
|--------|---------------|---------|-------|
| `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })` | Promise<`{ data: { user, session }, error }`> | session is `null` until email confirmed (D-13); user object always present. | `emailRedirectTo` MUST be on the Redirect URLs allowlist (§3). |
| `supabase.auth.signInWithPassword({ email, password })` | Promise<`{ data: { user, session }, error }`> | session non-null on success. | If email unverified, server returns user + session but `user.email_confirmed_at === null` — client distinguishes. |
| `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` | Promise<`{ data: { user, session }, error }`> | Always returns `{ user: null, session: null }`; magic-link email sent. | Used as the D-02 "Email me a sign-in link instead" option. |
| `supabase.auth.signOut({ scope: 'local' })` | Promise<`{ error }`> | Removes session from localStorage; fires SIGNED_OUT across tabs via storage event. | **MUST pass `{ scope: 'local' }`** — default is `global` (signs out every device, hostile UX). |
| `supabase.auth.resetPasswordForEmail(email, { redirectTo })` | Promise<`{ data, error }`> | Email sent. PASSWORD_RECOVERY event fires on user's other tabs (or this one) when they click the link. | redirectTo MUST be on Redirect URLs allowlist (§3). |
| `supabase.auth.updateUser({ email })` | Promise<`{ data: { user }, error }`> | Sends confirm-email link; USER_UPDATED event fires after user clicks link + session refreshes. | Anon-promotion step 1 (D-05). |
| `supabase.auth.updateUser({ password })` | Promise<`{ data: { user }, error }`> | USER_UPDATED fires immediately. | Anon-promotion step 2 (D-05) AND password-reset finalize (AUTH-04). |
| `supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })` | Promise<`{ error }`> | Re-sends signup confirmation email. | "Resend verification" CTA on UI-SPEC §5 + §8. Rate-limited server-side by Phase 4's `max_frequency: 1m0s`. |
| `supabase.auth.getSession()` | Promise<`{ data: { session }, error }`> | Returns cached session synchronously after the initial hydration; no network call after first load. | Used in INITIAL_SESSION handler to determine current verified state. |
| `supabase.auth.getUser()` | Promise<`{ data: { user }, error }`> | Validates the access_token against the auth server — network call. Use for trust-required checks; `getSession()` is sufficient for UI rendering. | Use sparingly. |
| `supabase.auth.onAuthStateChange((event, session) => {...})` | `{ data: { subscription: { unsubscribe } } }` | Events: `INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `PASSWORD_RECOVERY`, `TOKEN_REFRESHED`, `USER_UPDATED`. | **Gotcha:** never call supabase.* inside the callback synchronously. Wrap in `setTimeout(fn, 0)`. |

### §2. Anon→permanent UID promotion sequence (D-05/D-07)

**Concrete sequence for a user who started anonymous (Phase 4 AI Coach use) and signs up:**

```typescript
// Detect anon state from current session
async function signUpOrPromote(email: string, password: string): Promise<AuthResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const current = sessionData.session?.user;
  if (current && current.is_anonymous) {
    // Branch A: PROMOTE — attach email to existing anon UID. Same auth.uid() throughout.
    const step1 = await supabase.auth.updateUser({
      email,
      // emailRedirectTo: window.location.origin + '/#/auth/verify'
    });
    if (step1.error) return { user: null, session: null, error: step1.error };
    // Password is NOT set yet — Supabase requires email confirmation FIRST before allowing password.
    // Store password in sessionStorage (NOT localStorage; cleared on tab close) so the verify-landing can apply it.
    // OR: have the user re-enter password on first verified signin. Recommend the latter — simpler, more secure.
    return { user: step1.data.user, session: sessionData.session, error: null };
  } else {
    // Branch B: NEW SIGN-UP — no anon to promote.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/#/auth/verify' },
    });
    return { user: data.user, session: data.session, error };
  }
}
```

**Password-set timing for Branch A (promote):**

Two valid approaches — researcher recommends **Approach 2 (re-enter on verified signin)** for security simplicity:

- **Approach 1 (auto-apply):** Store password temporarily in `sessionStorage` keyed by `'pending_password'`; after USER_UPDATED fires with `email_confirmed_at !== null`, call `supabase.auth.updateUser({ password })` and clear `sessionStorage`. Risk: if the user verifies email on a different device than they signed up on, sessionStorage is empty there, the password is lost, user is stuck.
- **Approach 2 (re-enter):** On the verify-landing success state (UI-SPEC §4 success variant), if `current.user.is_anonymous === false && current.user.email_confirmed_at !== null && !current.user.last_sign_in_at`, treat as "freshly verified promote" — route to `#/auth/signin` with a pre-filled email + a contextual sub-heading ("Set your password to finish signing up"). The user enters password once → `setPasswordOnPromoted` calls `updateUser({ password })` → USER_UPDATED → dashboard.

**Recommendation: Approach 2** — works cross-device (verify on phone, finish on laptop), no sessionStorage gymnastics, one fewer footgun.

**`runAnonPromotionMigrationIfNeeded` impl skeleton:**

```typescript
// src/lib/auth-migration.ts
export async function runAnonPromotionMigrationIfNeeded(userId: string): Promise<void> {
  // Called from SIGNED_IN handler. By the time this runs the promotion is DONE
  // (email confirmed + password set). Only post-migration housekeeping:
  // - if Zustand previously cached `signedIn.preAnonId === userId` (i.e., the
  //   anon UID is the same row that now has an email), toast "Welcome back —
  //   your AI chat history is saved to your account." (D-05 toast).
  // - The actual user-row promotion already happened server-side via updateUser.
}
```

### §3. `emailRedirectTo` + Vercel preview wildcard strategy

**Verified at execution time via Context7 (2026-05-11):**

> *"For deployments with Vercel, set your `SITE_URL` to your official site URL. Include `http://localhost:3000/**` and `https://*-<team-or-account-slug>.vercel.app/**` in your redirect URLs for local development and deployment previews."*
> — `[CITED: https://supabase.com/docs/guides/auth/concepts/redirect-urls]`

> *"Supabase allows the use of wildcard match patterns in the redirect URL allow list to support preview URLs from hosting providers."*
> — `[CITED: https://supabase.com/docs/guides/auth/redirect-urls]`

**Concrete recommendation for Phase 5:**

Add the following entries to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs (or via `supabase/config.toml` `additional_redirect_urls` + `supabase config push` — **WARNING: `config push` is destructive — diff first per `.planning/decisions/supabase.md` `<supabase config push gotcha>`**):

```
http://localhost:5173/**
http://localhost:4173/**
https://leanshot-app.vercel.app/**
https://*-karstens-projects-16afd0e4.vercel.app/**
```

- **`SITE_URL` (Authentication → URL Configuration → Site URL):** `https://leanshot-app.vercel.app` (the production SPA, NOT the marketing domain).
- The `*-karstens-projects-16afd0e4.vercel.app` wildcard covers all PR preview URLs from the Vercel team scope `karstens-projects-16afd0e4` (verified live in `.planning/decisions/supabase.md` line 22: `vercel_scope: karstens-projects-16afd0e4`).
- The `localhost:5173/**` and `localhost:4173/**` entries cover Vite dev + `vite preview` (Playwright e2e runs against the latter per `playwright.config.ts`).
- `/**` (not `/*`) wildcards subpaths recursively — critical because the email link redirects to `/#/auth/verify` with the hash route.

**Hash fragment caveat:** The `#/auth/...` fragment is NOT sent to the server (browsers strip it from HTTP requests), so it never appears in the Redirect URL allowlist matching. Supabase matches on the path portion (`https://leanshot-app.vercel.app/`); the client-side router reads `window.location.hash` after the redirect lands.

**Verification command (run by planner before submitting the migration):**

```bash
curl -s https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings | jq '.external.email'
# Phase 4 used the same /auth/v1/settings endpoint to verify provider state — extend the pattern here.
```

After updating Redirect URLs via dashboard or `config push`, smoke-test by triggering a signup against a preview URL and confirming the email link, when clicked, lands on the preview domain (not redirected to production).

**Why no `/auth/preview-redirect` proxy is needed:** wildcards work natively per current docs. No fallback architecture required.

### §4. `injections` table schema + RLS + indexes + trigger

**Concrete SQL ready for the planner to drop into `supabase/migrations/20260513000000_injections.sql`:**

```sql
-- Phase 5 D-08 + SYNC-01 + SYNC-05 + AUTH-06 (Cross-device sync of injection log).
--
-- public.injections — one row per logged injection, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, log_id) composite primary key. `log_id` is client-generated
--     via crypto.randomUUID() at injection-creation time; remains stable
--     across local-only logging, offline queue, and eventual cloud upsert.
--   - `updated_at` is server-authoritative via the moddatetime trigger
--     (D-08 LWW). Clients MUST NOT pass updated_at on insert/upsert; it
--     defaults to now() at INSERT and is forced to now() at every UPDATE.
--   - RLS: auth.uid() = user_id on SELECT/INSERT/UPDATE/DELETE (default-deny).
--     Service-role bypass for admin operations (account deletion in Phase 7).
--
-- Soft-delete decision (Claude's discretion per CONTEXT line 76):
--   Phase 5 ships HARD DELETE (no deleted_at column). Rationale: LWW resolves
--   "I deleted on phone, edited on laptop" deterministically — the later
--   updated_at wins, and a DELETE arrives as a Realtime DELETE event that
--   removes the row from the other client's Zustand cache. Soft-delete adds
--   schema complexity that pays back only when the audit-trail requirement
--   lands (Phase 7 GDPR compliance) — defer until then. The composite-PK
--   shape supports a soft-delete addition later (just add `deleted_at
--   timestamptz` + update RLS SELECT policy to `... and deleted_at is null`).

create extension if not exists moddatetime schema extensions;
-- moddatetime is standard PostgreSQL contrib (ships with Supabase free tier).
-- Phase 4 precedent: 20260512000002_anon_cleanup_pg_cron.sql uses the same
-- "create extension if not exists" pattern for pg_cron.

create table public.injections (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_id uuid not null,
  primary key (user_id, log_id),

  -- Domain fields mirror src/types/index.ts `Injection` interface.
  -- NOTE for planner: existing Injection interface has NO `id`/`log_id` field;
  -- Phase 5 must add `log_id: string` to the interface and back-stamp existing
  -- localStorage rows during the v6→v7 storage migration.
  medication text not null,            -- e.g., 'ozempic', 'mounjaro' (matches MedicationId union)
  dose text not null,                  -- string per existing Injection.dose ('0.5')
  unit text not null check (unit in ('mg', 'units', 'ml')),  -- matches DoseUnit
  site text,                           -- nullable; matches InjectionSite | null
  notes text not null default '',
  logged_at timestamptz not null,      -- ISO datetime the patient logged (UI-controlled, not server-now)
  pk_engine_version integer not null default 1,  -- PK-05 (Phase 3 D-07); planner verifies default matches

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-user listing index (newest first) for initial pull + admin queries.
create index injections_user_logged_at_idx
  on public.injections (user_id, logged_at desc);

-- updated_at maintenance: moddatetime trigger overwrites on UPDATE.
create trigger injections_set_updated_at
  before update on public.injections
  for each row
  execute function extensions.moddatetime(updated_at);

-- RLS: default-deny, then explicit per-user policies (mirrors ai_messages pattern).
alter table public.injections enable row level security;

create policy "injections_select_own"
  on public.injections
  for select
  using (auth.uid() = user_id);

create policy "injections_insert_own"
  on public.injections
  for insert
  with check (auth.uid() = user_id);

create policy "injections_update_own"
  on public.injections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "injections_delete_own"
  on public.injections
  for delete
  using (auth.uid() = user_id);

-- Realtime: enable publication membership so postgres_changes fires.
-- Supabase ships the supabase_realtime publication; new tables must be added.
alter publication supabase_realtime add table public.injections;
```

**Planner verifies at execution time:**
- `select * from pg_available_extensions where name = 'moddatetime';` returns a row (it should — standard contrib).
- `select extname from pg_extension where extname = 'moddatetime';` returns 'moddatetime' after the migration runs.
- The `alter publication` line is sometimes idempotent issue — wrap in a `do $$ ... $$` block if `db push` complains about "relation already in publication".

**Schema-to-TypeScript mapping (planner adds to `src/types/index.ts`):**

```typescript
export interface Injection {
  log_id: string;             // NEW Phase 5: client-generated UUID, PK with user_id
  datetime: string;           // existing — ISO; maps to server `logged_at`
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  pkEngineVersion?: number;   // existing
  // NOT persisted client-side; populated only on rows that came FROM the server:
  updated_at?: string;        // ISO timestamptz from server; used for LWW merge
  user_id?: string;           // present on server-derived rows; not on local-only
}
```

The medication field maps from the existing `user.medication` (already in Zustand `user` slice) — the planner decides whether to denormalize per-row OR fetch via JOIN to a future `user_medications` table. For Phase 5 with one user one medication, **denormalize per row**: simplest, future-proof when patients switch medications mid-titration.

### §5. Realtime subscription pattern

**Concrete code (already shown in Pattern 2 above). Critical specifics:**

- **Channel name uniqueness:** `'injections:<userId>'` — namespacing by user_id ensures no cross-channel state mixing if (somehow) two users open the same browser. Subscribed channel names are also visible in the Supabase Realtime dashboard for debugging.
- **Filter syntax:** `'user_id=eq.<uid>'` — the Supabase filter mini-language (operator `=eq.`, `=neq.`, `=gt.`, etc.). `[CITED: https://supabase.com/docs/guides/realtime/postgres-changes?language=js]`
- **Subscribe callback `status`:** the SDK calls back with `'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'`. We log errors but do not implement custom reconnect — supabase-js handles exponential backoff internally.
- **Initial-sync NOT replayed by postgres_changes:** the JS API `channel().on('postgres_changes', ...)` delivers ONLY events emitted AFTER `.subscribe()` completes. To seed Zustand from server state, do an explicit `select` first (see `pullInitialInjections` in Pattern 2). The Dart `from().stream({...})` API does combine an initial fetch + subscribe, but the JS API does not — we must explicit-pull. `[CITED: https://supabase.com/docs/reference/dart/auth-signinwithpassword stream method explicitly states "emits initial data and subsequent changes"; the JS channel().on() API does not.]`
- **Cleanup:** `supabase.removeChannel(channel)` is the supported teardown; this also closes the WebSocket if no other channels remain.
- **REPLICA IDENTITY:** Supabase docs note that to receive "previous" data on UPDATE/DELETE, set `ALTER TABLE public.injections REPLICA IDENTITY FULL;` — useful for LWW merge to compare old vs new. For Phase 5's MVP merge (which only needs the new row's `updated_at` to win), **REPLICA IDENTITY default (which sends only PK columns on DELETE) is sufficient**. Add FULL only if a future use case needs the old row.
- **RLS-aware fanout:** Postgres RLS gates which rows the Realtime broker emits to which client. Two users on the same channel name pattern do NOT see each other's events — the broker checks RLS per-payload using each client's JWT.
- **Realtime auth refresh:** the SDK auto-refreshes the WebSocket auth token whenever `supabase.auth.refreshSession()` succeeds; no manual `realtime.setAuth()` calls needed for Phase 5 (we use postgres_changes which is permissioned via RLS, not `private` broadcast channels which require setAuth).
- **Reconnect storm protection:** rely on the SDK's built-in backoff. No custom debounce. If Phase 6 reveals reconnect-cycle issues on flaky mobile networks, revisit then.

### §6. Offline write queue mechanics

**Zustand action shape for `addInjection`:**

```typescript
// src/lib/store.ts (excerpt — additions to existing store)
addInjection: (input: Omit<Injection, 'log_id'>) => {
  const log_id = crypto.randomUUID();
  const injection: Injection = { log_id, ...input, pkEngineVersion: 1 };
  set((s) => ({
    injections: [...s.injections, injection],
    pendingSyncIds: [...s.pendingSyncIds, log_id],
  }));
  // Fire-and-forget flush — never block the UI.
  void flushSyncQueue();
},

editInjection: (log_id: string, updates: Partial<Omit<Injection, 'log_id' | 'user_id'>>) => {
  set((s) => ({
    injections: s.injections.map((i) => (i.log_id === log_id ? { ...i, ...updates } : i)),
    pendingSyncIds: s.pendingSyncIds.includes(log_id) ? s.pendingSyncIds : [...s.pendingSyncIds, log_id],
  }));
  void flushSyncQueue();
},

removeInjection: (log_id: string) => {
  set((s) => ({
    injections: s.injections.filter((i) => i.log_id !== log_id),
    // Note: for hard-delete, we need to tell the server too. Use a separate
    // pending list OR enqueue a "delete" marker. Simpler: if the row was
    // synced (server-tier), enqueue a tombstone; if it was only local, drop.
    pendingDeleteIds: [...s.pendingDeleteIds, log_id],
  }));
  void flushSyncQueue();
},

clearPendingSyncIds: (drained: string[]) => {
  set((s) => ({
    pendingSyncIds: s.pendingSyncIds.filter((id) => !drained.includes(id)),
  }));
},
```

**`pendingDeleteIds` design call:** for Phase 5 with HARD DELETE, the simplest approach is a second pending list specifically for deletions. Alternative: a unified `pendingOps: Array<{op: 'upsert' | 'delete'; log_id: string}>`. Recommend the latter for forward-compat with Phase 6's full SYNC-04 spec — a single ordered queue replays deterministically. Planner picks final shape.

**`mergeServerInjections` (initial pull) — LWW merge:**

```typescript
mergeServerInjections: (serverRows: Array<Injection & { updated_at: string }>) => {
  set((s) => {
    const map = new Map<string, Injection>();
    // Seed map with local rows.
    for (const local of s.injections) map.set(local.log_id, local);
    // Overlay server rows IF newer (LWW).
    for (const remote of serverRows) {
      const local = map.get(remote.log_id);
      if (!local || !local.updated_at || new Date(remote.updated_at) > new Date(local.updated_at)) {
        map.set(remote.log_id, remote);
      }
    }
    return { injections: Array.from(map.values()) };
  });
},

applyRealtimePayload: (payload: RealtimePostgresChangesPayload<Injection>) => {
  set((s) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const remote = payload.new as Injection & { updated_at: string };
      const idx = s.injections.findIndex((i) => i.log_id === remote.log_id);
      if (idx === -1) return { injections: [...s.injections, remote] };
      const local = s.injections[idx]!;
      if (!local.updated_at || new Date(remote.updated_at) > new Date(local.updated_at)) {
        const next = [...s.injections];
        next[idx] = remote;
        return { injections: next };
      }
      return {}; // local is newer; ignore
    }
    if (payload.eventType === 'DELETE') {
      const oldRow = payload.old as { log_id: string };
      return { injections: s.injections.filter((i) => i.log_id !== oldRow.log_id) };
    }
    return {};
  });
},
```

**Error classification in `flushSyncQueue`:**

- **Transient (retry):** network failure (`fetch` rejection), Supabase 5xx, Supabase 429 rate-limit. Keep `pendingSyncIds`; the next `online` event or auth re-event re-attempts.
- **Permanent (drop + log):** Supabase 4xx that isn't 429 — e.g., RLS rejection (would indicate a bug), schema mismatch (unknown column). Log via `console.error('[leanshot] sync-permanent-error', error)` and remove from pending so we don't loop forever. Phase 5 ships ONLY logging; Phase 6 SYNC-04 explicit-spec can add a UI "X items failed to sync" surface.
- **Online detection:** wire `window.addEventListener('online', () => void flushSyncQueue())` at App.tsx top-level useEffect. Pair with `'offline'` for UI state (the EmailVerificationBanner-adjacent could show a small "offline" indicator — UI-SPEC didn't spec one; planner's call).

### §7. STORAGE_VERSION 6→7 migration shape

**Concrete migration function code:**

```typescript
// src/lib/storage.ts (NEW additions; existing v3→v4 + v5→v6 chain remains)
export const STORAGE_VERSION = 7;  // bumped from 6
export const STORAGE_KEY = 'leanshot_v4';  // unchanged base key

/** Compute the namespaced key for a given user id. SHA-256 + slice(0,16) per D-12. */
export async function namespacedKey(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hex = hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${STORAGE_KEY}:${hex.slice(0, 16)}`;
}

/**
 * v6→v7 migration:
 *  - Add `pendingSyncIds: []` and `pendingDeleteIds: []` to persisted shape.
 *  - Back-stamp each existing `Injection` with `log_id: crypto.randomUUID()`.
 *  - Re-key from universal `leanshot_v4` to `leanshot_v4:<user_id_hash>`
 *    IFF a session exists at migration time. If no session, leave the
 *    universal key untouched — namespacing happens on first signin via
 *    `renameStorageNamespace(userId)`.
 */
export async function migrateV6ToV7(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* private-mode noop */ }
  if (!raw) return;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

  // Back-stamp injections with log_id if missing.
  const injections = Array.isArray(parsed.injections) ? parsed.injections : [];
  const stamped = (injections as Array<Record<string, unknown>>).map((row) => ({
    log_id: typeof row.log_id === 'string' ? row.log_id : crypto.randomUUID(),
    ...row,
  }));
  parsed.injections = stamped;
  parsed.pendingSyncIds = Array.isArray(parsed.pendingSyncIds) ? parsed.pendingSyncIds : [];
  parsed.pendingDeleteIds = Array.isArray(parsed.pendingDeleteIds) ? parsed.pendingDeleteIds : [];

  // Probe current session to decide whether to namespace now or later.
  let currentUserId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    currentUserId = data.session?.user?.id ?? null;
  } catch { /* fail-soft */ }

  const next = JSON.stringify(parsed);
  if (currentUserId) {
    const targetKey = await namespacedKey(currentUserId);
    try {
      localStorage.setItem(targetKey, next);
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* fail-soft */ }
  } else {
    // Leave universal key in place; renameStorageNamespace handles it on first signin.
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* fail-soft */ }
  }
}

/**
 * On SIGNED_IN: if data still lives in `leanshot_v4` (universal), move it to
 * the namespaced key. Idempotent — no-op if the namespaced key already exists.
 */
export async function renameStorageNamespace(userId: string): Promise<void> {
  const targetKey = await namespacedKey(userId);
  let universalRaw: string | null = null;
  try { universalRaw = localStorage.getItem(STORAGE_KEY); } catch { return; }
  if (!universalRaw) return;
  // Don't overwrite if target already has data — merge collision is rare but possible
  // (e.g., user signed in, signed out, started anon, signed back in).
  let targetRaw: string | null = null;
  try { targetRaw = localStorage.getItem(targetKey); } catch { /* noop */ }
  try {
    if (targetRaw === null) {
      localStorage.setItem(targetKey, universalRaw);
    }
    // Even if target had data, we delete the universal key to avoid leak to next user.
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}
```

**Edge cases the planner verifies:**

- **No session at all (pre-Phase-4 user):** v6→v7 runs, back-stamps log_ids, leaves universal key. On first signup, `renameStorageNamespace` moves it.
- **Anon session:** v6→v7 namespaces under the anon UID hash. On promote (anon→permanent), `auth.uid()` doesn't change (D-05) — same hash, same key, no second move.
- **Permanent session:** v6→v7 namespaces under the permanent UID hash immediately.
- **Multi-user-on-same-browser:** user A signs in (key: `leanshot_v4:<hashA>`), signs out (D-11 clears the key contents but the key itself remains empty), user B signs in (key: `leanshot_v4:<hashB>`). No leak path.

**Zustand persist middleware integration:** the existing `persist` middleware accepts a `name` factory option. Phase 5 changes `name` to a function that reads `currentUserId` from the store and returns the namespaced key. The migration logic above runs ONCE at hydration time; the persist middleware then writes/reads to the namespaced key going forward.

### §8. Cross-tab signout propagation

**Recommendation: rely on supabase-js's built-in `storage` event listener — no BroadcastChannel needed.**

**Mechanism:** supabase-js v2 registers a `window.addEventListener('storage', ...)` at client construction. When tab A calls `signOut({scope:'local'})`, it removes the `sb-leanshot-auth` key from localStorage. The `storage` event fires in tab B (browsers fire `storage` events in OTHER tabs/windows of the same origin, NOT the originating tab). The SDK detects the key removal and fires `SIGNED_OUT` in tab B's `onAuthStateChange` listener.

**Source:** Verified Context7: `signOut(options)` — "Inside a browser context, signOut() will remove the logged in user from the browser session and log them out — removing all items from localstorage and then trigger a 'SIGNED_OUT' event." Combined with: `onAuthStateChange(callback)` — "Events are emitted across tabs to keep your application's UI up-to-date."

**Phase 5 code change:** zero. The handling already wired in Pattern 3 (`case 'SIGNED_OUT'` → `unsubscribeInjections()` → `clearUserDataSlices()`) runs in tab B automatically.

**Verification (Playwright multi-context):**

```typescript
test('cross-tab signout: sign-out in tab A unmounts banner in tab B', async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  // ... both navigate, both signed-in ...
  await tabA.locator('[aria-label="Account menu"]').click();
  await tabA.locator('text=Sign out').click();
  // Tab B should react via the storage event — banner unmounts, redirected to marketing or auth.
  await expect(tabB.locator('[role="region"][aria-label="Email verification reminder"]')).toBeHidden({ timeout: 3000 });
});
```

**Why NOT BroadcastChannel:** Phase 5 gets the behavior for free; adding BroadcastChannel adds API surface, adds polyfill considerations (older Safari), and duplicates a mechanism that already works. D-09 explicit: defer to v2.

### §9. Password policy

**Recommendation: 8-character minimum + at least one digit. Match Supabase's `letters_digits` strength preset.**

- **Why 8 + digit (not 10 / 12 / complex):** OWASP ASVS 4.0.3 §V2.1.1 minimum is 8 characters; the trade-off above 8 is diminishing returns vs UX friction (longer = more password-manager reliance = better, but our audience is chronic-condition patients who may type on a phone). Adding "1 digit" is the smallest complexity rule that defeats trivial dictionary attacks without blocking pass-phrase users. `[ASSUMED: OWASP guidance — verify final wording with security review before launch; the 8+digit threshold is conservative-minimum, not aspirational.]`
- **Why not "no common passwords" check:** Supabase supports a `password_strength_check_against_haveibeenpwned` option, but it requires either k-anonymity API calls (latency on every signup) or local Bloom filter (bundle bloat). Defer to Phase 7 compliance pass; mention in the v2 backlog.

**Supabase configuration (in `supabase/config.toml` `[auth]` section, pushed via `supabase config push` — **CAUTION: diff first per .planning/decisions/supabase.md gotcha**):**

```toml
[auth]
# ... existing settings preserved (mailer_autoconfirm = false, max_frequency = "1m0s", otp_length = 8) ...
password_min_length = 8
password_required_characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789"
# password_required_characters uses Supabase's "character class" syntax:
# colon-separated; here means "at least one letter AND at least one digit".
# Alternative: "letters_digits" preset (verify exact key name at execution time).
```

**Client-side validation regex (matches the policy hint copy "8+ chars including a number"):**

```typescript
// src/components/auth/SignUpForm.tsx + SetNewPasswordForm.tsx
const PASSWORD_POLICY = /^(?=.*\d).{8,}$/;
function isPasswordValid(pw: string): boolean { return PASSWORD_POLICY.test(pw); }
```

**Client-side validation is for UX (instant feedback);** server-side is the source of truth and will reject violations with a clear error message that the SignUpForm renders inline.

### §10. Auth state machine in App.tsx

The view selector becomes a 4-state finite state machine derived from session + verified + onboarded + hash:

```
                                                                     ┌──────────────────────┐
                                                                     │  Hash: #/auth/...    │
                                                                     │  → view = 'auth'     │
                                                                     │  → render <AuthView/> │
                                                                     └─────────┬────────────┘
                                                                               │ onSubmit (signup)
                                                                               │   → signUp() → toast
                                                                               │   → setHash('#/auth/verify-sent')
                                                                               │
        ┌────────────────────────┐     onSubmit            ┌────────────────────┴────────────┐
        │  user === null         │  ←─────────────────────│   AuthView sub-screens          │
        │  view = 'marketing'    │                         │   (signup/signin/verify/forgot/  │
        │  → <Landing/>          │  click "Sign in" header │    set-new-password)             │
        └─────────┬──────────────┘  → setHash('#/auth/signin') └────────────────┬─────────────┘
                  │                                                              │
        click "Start tracking"                              SIGNED_IN event      │
                  │                                       (email_confirmed_at != null)
                  ▼                                                              │
        ┌────────────────────────┐                                               ▼
        │ view = 'onboarding'    │      onComplete()  ┌──────────────────────────────────┐
        │ → <OnboardingFlow/>    │  ─────────────────►│  view = 'dashboard'             │
        │ (TOTAL_STEPS=8)        │   creates `user`   │  signedIn.verified === true      │
        │ final step: "Save data"│   slice in Zustand │  → <AppShell> + <Tabs/>          │
        └─────────┬──────────────┘                    │  → subscribeInjections           │
                  │  click "Sign up — free"           │  → flushSyncQueue                │
                  │  → setHash('#/auth/signup')       └───────────┬──────────────────────┘
                  │  → view = 'auth'                              │
                  └───────────────────────────────────────────────┘
                                                                  │
                                                  SIGNED_IN event AND
                                                  email_confirmed_at === null
                                                                  ▼
                                                  ┌──────────────────────────────────┐
                                                  │  view = 'dashboard'             │
                                                  │  signedIn.verified === false    │
                                                  │  → <AppShell> + <Tabs/>          │
                                                  │  → <EmailVerificationBanner/>    │
                                                  │  (NO subscribe / NO flush — D-13)│
                                                  └───────────┬──────────────────────┘
                                                              │
                                            USER_UPDATED event with
                                            email_confirmed_at !== null
                                                              ▼
                                                  (transitions into "verified" arm,
                                                   subscribe + flush fire)

  SIGNED_OUT event from any state ───► clearUserDataSlices() ───► view = 'marketing' (or 'auth#signin'; see Q6 §12)
  PASSWORD_RECOVERY event from any state ───► setHash('#/auth/set-new-password')
```

**State precedence (App.tsx selector logic):**

```typescript
function selectView(state: StoreState): 'marketing' | 'onboarding' | 'auth' | 'dashboard' {
  // Hash overrides everything when in an auth flow.
  if (window.location.hash.startsWith('#/auth/')) return 'auth';
  // Authenticated takes precedence.
  if (state.signedIn?.user && !state.signedIn.user.is_anonymous) return 'dashboard';
  // Anonymous user with onboarding complete or local data: dashboard (Phase 4 unchanged).
  if (state.user) return 'dashboard';
  // Marketing fallback.
  return 'marketing';
}
```

### §11. Validation Architecture (Nyquist Dimension 8)

**Test Framework**

| Property | Value |
|----------|-------|
| Framework (unit) | Vitest `^4` + React Testing Library — already configured (Phase 1 04-04 plan) |
| Framework (e2e) | Playwright — already configured (`leanshot/playwright.config.ts`) |
| Config file (unit) | `vitest.config.ts` (already in repo) |
| Config file (e2e) | `playwright.config.ts` (already in repo; baseURL = `http://localhost:4173` against `vite preview`) |
| Quick run command (unit) | `npm run test:unit` |
| Quick run command (e2e) | `npm run test:e2e` |
| Full suite command | `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e` |
| RLS test (vitest, gated by env) | `SUPABASE_SERVICE_ROLE_KEY=… npm run test:unit -- rls-injections` (mirrors Phase 4 pattern) |

**Phase Requirements → Test Map**

| SC# | Behavior | Test Type | Automated Command | File |
|-----|----------|-----------|-------------------|------|
| SC#1 | Signup → email link → verify → signin → log injection on browser A → signin on browser B (incognito) → see injection within 5s | Playwright e2e (multi-context) | `npx playwright test e2e/auth-signup-verify-signin.test.ts` | NEW |
| SC#2 | Password reset: request → click link → set new password → sign in with new; previous password rejected | Playwright e2e | `npx playwright test e2e/password-reset.test.ts` | NEW |
| SC#3a | Signout clears `injections`/`pendingSyncIds`/`aiHistory`/etc but preserves `theme`/`onboarded`/`tour_seen` | Vitest unit (clearUserDataSlices fn in isolation) | `npm run test:unit -- clearUserDataSlices` | NEW (`src/lib/store.test.ts`) |
| SC#3b | Signout UX: signed-in user clicks signout → toast → marketing | Playwright e2e | `npx playwright test e2e/signout-cache-clear.test.ts` | NEW |
| SC#4 | Offline-first: turn off network, log 3 injections, all in UI immediately, turn network back on, propagate to second device | Playwright e2e (`context.setOffline(true/false)`) | `npx playwright test e2e/offline-log-then-sync.test.ts` | NEW |
| SC#5 | Cross-tenant RLS: user A inserts, user B's JWT-scoped client sees zero | Vitest + admin client (gated by `SUPABASE_SERVICE_ROLE_KEY`) | `SUPABASE_SERVICE_ROLE_KEY=… npm run test:unit -- rls-injections` | NEW (mirrors `e2e/rls-ai-messages.test.ts`) |

**Sampling Rate**

- **Per task commit:** `npm run lint && npm run typecheck && npm run test:unit` (fast — ≤30s).
- **Per wave merge:** add `npm run test:e2e` against `vite preview` (≤2min on the SC suite).
- **Phase gate (`/gsd-verify-work`):** full suite green + `SUPABASE_SERVICE_ROLE_KEY=…` RLS test green against live Supabase.

**Wave 0 Gaps**

- `e2e/auth-signup-verify-signin.test.ts` — covers SC#1
- `e2e/password-reset.test.ts` — covers SC#2
- `e2e/signout-cache-clear.test.ts` — covers SC#3b
- `e2e/offline-log-then-sync.test.ts` — covers SC#4
- `e2e/rls-injections.test.ts` — covers SC#5 (mirrors `rls-ai-messages.test.ts`)
- `src/lib/store.test.ts` (or extend existing) — `clearUserDataSlices` unit test (SC#3a)
- Email-link automation: Playwright cannot click a real email. Three options:
  1. **Supabase test email helper:** use the admin API `generateLink({type:'signup'/'recovery', email})` → extract `action_link` or `hashed_token` → navigate Playwright directly to that URL. **Recommended** — mirrors the Phase 4 `rls-ai-messages.test.ts` pattern that uses `admin.auth.admin.generateLink`.
  2. **Mailosaur / similar test SMTP:** overkill for Phase 5.
  3. **Mock the email step entirely:** brittle.

**Test environment requirements:**

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — public-safe, fine for CI as repo secrets or `.env.test`.
- `SUPABASE_SERVICE_ROLE_KEY` — PRIVATE — GitHub Actions repo secret only; never committed; mirrors Phase 4's `rls-ai-messages.test.ts` skip-if-absent pattern.
- For e2e signup/signin smokes, the planner decides whether to:
  - **Option A (cleanest):** create disposable users via the admin API per test (mirrors Phase 4 pattern); afterEach: `admin.auth.admin.deleteUser(id)`. Requires service-role key.
  - **Option B (less infrastructure):** use a pool of pre-seeded test users in a separate Supabase project. More setup, less per-run flakiness. Defer.

Recommend Option A.

### §12. Open Questions surfaced by Phase 5 UI-SPEC §Open Questions

The UI-SPEC §Open Questions for Planner has 10 entries; researcher resolves each:

- **UI-SPEC Q1 (Password policy):** Resolved §9. "8 chars + 1 digit." Hint copy matches.
- **UI-SPEC Q2 (Email-confirm redirect):** Resolved §3. Vercel-slug wildcard pattern works; no proxy needed.
- **UI-SPEC Q3 (Anonymous avatar dot color):** **Recommend amber (`--color-warning`)** — UI-SPEC's preferred default. Matches the verify-pending banner semantic ("your sync is incomplete"); teal would feel celebratory which is wrong for an action-requiring state.
- **UI-SPEC Q4 (Custom email template copy):** Phase 7 brand pass owns. Planner spot-checks at execution time:
  ```bash
  curl -s https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings | jq '.mailer_secure_email_change_enabled, .mailer_otp_exp'
  # Visit dashboard → Authentication → Email Templates to view actual current copy.
  ```
  If "Confirm your mail" typo or other egregious copy persists, override with one-line copy patch via `supabase config push` (NOT a Phase 5 plan task; surface as a checkpoint for user to approve).
- **UI-SPEC Q5 (Topbar avatar for pre-Phase-4 users):** Phase 4 anon-mint-on-first-use behavior is wired into `src/lib/ai.ts` ONLY (the AI Coach panel's `callAIChat` is the only consumer). A pre-Phase-4 user who never opens the AI panel will have NO Supabase session. **Recommendation:** on dashboard mount (App.tsx top-level useEffect, alongside `onAuthStateChange`), if `getSession()` returns `null`, call `supabase.auth.signInAnonymously()` — mints the anon UID immediately so the AvatarMenu always has a session to display. This is a one-line addition that closes the gap completely and aligns with Phase 4 D-02's "anon-first" pattern.
- **UI-SPEC Q6 (Onboarding TOTAL_STEPS):** **Recommend keeping TOTAL_STEPS=8 with CTA-pair on final step** (matches UI-SPEC §11 recommendation). Rationale: incrementing to 9 makes "Save your data" feel like an extra required step, which contradicts the soft-ask UX intent. The final step's existing "You're all set" copy becomes a single screen with two CTAs ("Sign up — free" + "Maybe later"). No ProgressIndicator change. Planner verifies this fits the existing OnboardingFlow.tsx final-step shape (line ~545 region per grep above).
- **UI-SPEC Q7 (Error message `role="alert"`):** **Recommend planner adds `role="alert"` to FieldShell error `<p>`.** One-line change to `src/components/ui/Input.tsx`. Cross-phase a11y improvement; no architectural risk.
- **UI-SPEC Q8 (Marketing "Sign in" link sticky-header):** Planner verifies live behavior on `leanshot-marketing` deployment — if sticky has a scroll-state visual change, the link inherits it. Likely zero code change either way.
- **UI-SPEC Q9 (Magic-link prominence):** Keep minimal per D-02. Defer revisit to post-launch.
- **UI-SPEC Q10 (Verify-landing 1.5s auto-redirect):** Keep 1.5s default; screen-reader announcement timing is the binding constraint.

**Additional researcher-identified open items (raise to user at planning time):**

- **Sign-out destination (CTA `<additional_context>` Q6):** UI-SPEC §9 implies signout returns to marketing (no `signedIn.user`, no `state.user` IF state.user is also cleared, which D-11 says it is). **Recommendation: sign out → marketing**, NOT `#/auth/signin`. Rationale: the signed-out state is the marketing landing for a fresh-visitor experience; if they want to sign back in, the header "Sign in" link is one click away. Routing directly to signin would feel like a captive flow.
- **Onboarding state preservation on anon→permanent promote:** when an anonymous user with completed onboarding signs up via the post-onboarding prompt, the `state.user` Zustand slice (the Phase 1-built profile data) MUST survive across the auth-state change. D-11's signout-clear is destructive; the signup flow is NOT a signout. Planner verifies `clearUserDataSlices` is NOT called on SIGNED_IN/USER_UPDATED events — only on SIGNED_OUT. Add an explicit unit test.
- **`acknowledgedDisclaimer` preservation:** Phase 2 D-10 acknowledgment is per-device, not per-user. Preserve across signout (NOT in the D-11 cleared list — planner adds to preserved-set). Update CONTEXT.md drift note: D-11's preserved set should be `theme, onboarded, tour_seen, acknowledgedDisclaimer`.

### §13. Phase 6 hand-off preview

Phase 5 must leave the following primitives generic-enough for Phase 6 to extend without rewrites:

- **Sync engine should be generic over table name.** Don't hardcode `'injections'` in `src/lib/sync.ts`. Author signatures as:
  ```typescript
  subscribeToTable<T>(tableName: string, userId: string, onPayload: (p: RealtimePostgresChangesPayload<T>) => void): RealtimeChannel
  flushSyncQueueForTable<T>(tableName: string, rows: T[], onConflict: string): Promise<{error: ...}>
  ```
  Phase 5 uses these for `injections`; Phase 6 adds `weights`, `meals`, `photos`, etc., each with their own migration + Zustand slice but the SAME sync mechanics.
- **Migration pattern (one migration per new table):** Phase 5's `20260513000000_injections.sql` is the template. Phase 6 copies the shape (composite PK on `(user_id, <natural_key>)`, RLS default-deny + 4 policies, `moddatetime` trigger, publication membership) for each new table.
- **`(user_id, natural_key)` composite PK pattern:** for tables where the natural key is `date` (weights — one per day) or `(date, name)` (meals), the PK shape changes accordingly. The `onConflict` string in upserts changes to match. Document this in the Phase 5 sync.ts so Phase 6 has clear guidance.
- **Realtime subscription factory:** `subscribeToTable` accepts the table name and filter; Phase 6 builds one subscription per table OR consolidates via a single channel listening to multiple tables (Supabase supports multiple `.on('postgres_changes', ...)` calls per channel). For Phase 5 simplicity, one channel per table; Phase 6 can refactor if perf data justifies.
- **`pendingSyncIds` → `pendingOps`:** Phase 5's two pending arrays (`pendingSyncIds`, `pendingDeleteIds`) generalize to `pendingOps: Array<{table: string; op: 'upsert' | 'delete'; key: string}>` in Phase 6. Author Phase 5 with the generalized shape from day one to avoid the Phase 6 refactor.
- **STORAGE_VERSION 7→8:** Phase 6 will bump again for IndexedDB or for unified `pendingOps`. Planner names Phase 5's bump 6→7 with a docstring noting "next bump (7→8) will land in Phase 6 SYNC-04".

### §14. CI smoke gates

**Concrete additions to `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`:**

The existing `test-e2e` job already runs `npm run test:e2e` after building. Phase 5's new e2e files (`e2e/auth-signup-verify-signin.test.ts` etc.) are picked up automatically by Playwright's globbing — no workflow-yaml change needed for the e2e files themselves.

Two NEW additions required:

1. **Cross-tenant RLS test (`e2e/rls-injections.test.ts`)** — vitest unit test (lives in `e2e/` for naming consistency with `e2e/rls-ai-messages.test.ts` but is actually a vitest run, not Playwright). The existing `test-unit` job picks it up. **Required: add `SUPABASE_SERVICE_ROLE_KEY` as a GitHub Actions repo secret** and wire it into the test-unit job:

```yaml
  test-unit:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json
      - run: npm ci
      - run: npm run test:unit
        env:
          # Phase 5 SC#5 (cross-tenant RLS on injections) — same gate pattern as Phase 4 rls-ai-messages.
          # If absent (forks, default PRs), the test self-skips with a console.warn.
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

2. **Playwright auth smokes need `SUPABASE_URL` + `SUPABASE_ANON_KEY` env at e2e runtime** so the production-shaped build can talk to Supabase. Currently the `test-e2e` job sets `VITE_SENTRY_DSN: ''` etc. — extend to ALSO set:

```yaml
      - name: Build (production-shaped, empty env)
        run: npm run build
        env:
          VITE_SENTRY_DSN: ''
          VITE_POSTHOG_KEY: ''
          VITE_POSTHOG_HOST: ''
          VITE_ANALYTICS_ENABLED: 'false'
          # Phase 5: Supabase envs MUST be present at vite build time (VITE_* keys are bundled).
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

And likely a similar block for the `npm run test:e2e` step if Playwright tests want to use the admin client directly (which they need to for the SC#1 multi-context smoke — generate emails, mint magic-links, clean up):

```yaml
      - name: Run Playwright smoke against production build
        run: npm run test:e2e
        env:
          CI: 'true'
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

**Working-directory note:** the workflow's `defaults.run.working-directory: leanshot` applies to all auth + RLS tests because they live under `leanshot/e2e/`. No per-job override needed (the only override is the existing `deno-test` job which already correctly sets `.`).

**Secret-handling guidance for planner to surface to user before CI runs:**

- `SUPABASE_URL` — already public-safe (the Supabase project URL).
- `SUPABASE_ANON_KEY` — public-safe (JWT anon key is intentionally public-by-design).
- `SUPABASE_SERVICE_ROLE_KEY` — **PRIVATE**. Must be added to GitHub repo Settings → Secrets → Actions. Retrieval command per `.planning/decisions/supabase.md`:
  ```bash
  npx --prefix leanshot supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp
  # → pick the `service_role` row, copy the JWT.
  ```

---

## Common Pitfalls

### Pitfall 1: `linkIdentity` vs `updateUser` for anon promotion

**What goes wrong:** Developer reads "link identity" and naturally reaches for `linkIdentity({email, password})`. Supabase silently does nothing useful (the API expects an OAuth provider config, not a credential pair) — or worse, fails with a confusing error.

**Why it happens:** Method name confusion. `linkIdentity` is the OAuth provider linker (Google/Apple/GitHub); `updateUser` is the credential-attach for anonymous users.

**How to avoid:** Phase 4 `04-RESEARCH.md §Pitfall 5` + Phase 5 D-05 + `.planning/decisions/supabase.md` are all consistent: **use `updateUser({email})` → confirm → `updateUser({password})`.** Add a code comment at every anon-promotion call site citing the canonical source.

**Warning signs:** Plan that mentions `linkIdentity` for email/password. Block at plan-check.

### Pitfall 2: Async callback in `onAuthStateChange`

**What goes wrong:** Subtle deadlock — supabase-js's internal lock prevents nested supabase.* calls inside the callback. The app appears to hang on SIGNED_IN; logs show no error.

**Why it happens:** Natural code style — "fetch initial data inside the SIGNED_IN handler". Async function as callback + supabase.from() inside = deadlock.

**How to avoid:** **Wrap the body in `setTimeout(fn, 0)`** to dispatch to the next event loop tick. Pattern shown in §Pattern 3 above. Document at the call site with a `// CRITICAL: ...` comment.

**Warning signs:** code review for `onAuthStateChange(async (event, session) => { await supabase... })`. Block.

### Pitfall 3: `signOut()` without scope: 'local'

**What goes wrong:** User clicks "Sign out" on their work laptop → their phone (signed in same account) ALSO signs out. Confusing, hostile UX.

**Why it happens:** Supabase's `signOut()` default is `'global'` — sign out from every device.

**How to avoid:** **Always pass `{ scope: 'local' }`** for the user-facing sign-out CTA. Reserve `'global'` for an explicit future "Sign out of all devices" affordance (Phase 5 doesn't ship one).

### Pitfall 4: Postgres `updated_at` trigger doesn't fire on INSERT

**What goes wrong:** Test asserts `updated_at !== null` after an INSERT; passes because the column default is `now()`. Then asserts `updated_at` moves on UPDATE; fails because the trigger function name is wrong or the trigger isn't BEFORE UPDATE.

**Why it happens:** `moddatetime` is a BEFORE UPDATE trigger; it does NOT fire on INSERT (the column default handles that). Easy to mis-author when copy-pasting.

**How to avoid:** Both mechanisms (`default now()` on INSERT + `moddatetime` trigger BEFORE UPDATE) must be present. Test BOTH cases:
- Insert a row; assert `updated_at` is now-ish.
- Wait 1s, update the row; assert `updated_at` has advanced.

### Pitfall 5: Realtime postgres_changes does NOT replay history

**What goes wrong:** Developer expects subscribing to a channel to deliver all existing rows. The channel only delivers events emitted AFTER `.subscribe()` resolves. Dashboard shows zero rows on a fresh signin until the user logs a new one.

**Why it happens:** Confusion with the Dart `stream()` API which DOES combine initial-fetch + subscribe. The JS `channel().on('postgres_changes', ...)` API does not.

**How to avoid:** Always do an explicit `pullInitialInjections(userId)` (a `select * from injections where user_id=...`) BEFORE calling `subscribe()` on the channel. Pattern shown in §Pattern 2.

### Pitfall 6: Cross-tab data leak via shared persistName

**What goes wrong:** Zustand `persist` with a static `name: 'leanshot_v4'` means user A's data on one tab is readable from user B's tab if they share the browser. Even with D-11 signout-clear, a malicious user could read pre-clear data if the race is right.

**Why it happens:** Default `persist` name pattern.

**How to avoid:** D-12 namespaced key (`leanshot_v4:<sha256(user_id).slice(0,16)>`). The `persist` middleware's `name` option accepts a function — read the current user_id from getState and return the namespaced key. Re-key on SIGNED_IN; rename on SIGNED_OUT (clear then namespace under anon if a new anon UID is minted).

### Pitfall 7: `supabase config push` overwrites remote config

**What goes wrong:** Pushing `supabase/config.toml` to set the new password policy ALSO resets `mailer_autoconfirm: false` and `max_frequency: 1m0s` to local defaults — silently disabling production-safe email confirmation.

**Why it happens:** Phase 4 04-01 Task 4 documented this exact bug — `config push` is a full overwrite, not a merge. See `.planning/decisions/supabase.md` `<supabase config push gotcha>`.

**How to avoid:** **DIFF BEFORE PUSH.** Run `npx supabase config diff --project-ref ytnsipxxmzgaebkqmokp` and verify every change is intentional. Pair the config push with an immediate post-push curl verification:
```bash
curl -s https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings | jq '.mailer_autoconfirm, .password_min_length'
# Expect: mailer_autoconfirm = false, password_min_length = 8
```

### Pitfall 8: Existing `Injection` interface has no `id`/`log_id`

**What goes wrong:** D-06 + composite PK `(user_id, log_id)` assume a stable client-side `log_id`. The current interface only has `datetime` (an ISO string the user picks) — usable as a natural key but ugly under reconcile (what if the user edits `datetime`?).

**Why it happens:** Phase 1 / Phase 4 didn't anticipate sync.

**How to avoid:** Phase 5 STORAGE_VERSION 6→7 migration MUST back-stamp every existing localStorage injection row with `log_id: crypto.randomUUID()`. New `addInjection` calls mint `log_id` upfront. Document the schema change in `src/types/index.ts` with a Phase 5 docstring.

### Pitfall 9: Anonymous user lacks `email_confirmed_at` AND `is_anonymous` toggles together

**What goes wrong:** App state machine treats `email_confirmed_at === null` as "needs verify banner" — but anonymous users ALSO have `email_confirmed_at === null` because they have no email. Banner shows for anon users, which is wrong.

**Why it happens:** The verified gate needs TWO conditions: NOT anonymous AND email confirmed.

**How to avoid:** In `signedIn.verified` derivation: `verified = !!session?.user && !session.user.is_anonymous && !!session.user.email_confirmed_at`. Three-way check.

### Pitfall 10: Realtime channel filter syntax is string-form, not object-form (in JS)

**What goes wrong:** Following the Dart docs literally produces `filter: {column: 'user_id', value: '<uid>'}` — which JS rejects.

**Why it happens:** Dart API and JS API differ. JS still uses the string-form filter (`'user_id=eq.<uid>'`).

**How to avoid:** Always reference the JS-specific docs: `[CITED: https://supabase.com/docs/guides/realtime/postgres-changes?language=js]`. String form: `'<column>=<op>.<value>'`.

---

## Code Examples

### Common Operation 1 — Anon-promote signup form submission

```typescript
// src/components/auth/SignUpForm.tsx (submit handler)
// Sources:
//   https://supabase.com/docs/reference/javascript/auth-signup
//   https://supabase.com/docs/guides/auth/auth-anonymous (updateUser anon-promote)
import { signUp, attachEmailToAnon, getSession } from '@/lib/auth';

async function onSubmit(email: string, password: string): Promise<void> {
  setSubmitting(true);
  const { session } = await getSession();
  let result;
  if (session?.user?.is_anonymous) {
    // Anon → promote
    result = await attachEmailToAnon(email);
    // Password is set on the post-verify landing, not here (§2 Approach 2).
    // Store the password? NO — re-prompt on verify-landing for cross-device support.
  } else {
    result = await signUp(email, password);
  }
  setSubmitting(false);
  if (result.error) {
    showToast({ kind: 'error', text: parseAuthError(result.error) });
    return;
  }
  showToast({ kind: 'info', text: 'Check your email to verify your account.' });
  window.location.hash = '#/auth/verify-sent';
}
```

### Common Operation 2 — Cross-tenant RLS test (mirrors Phase 4)

```typescript
// e2e/rls-injections.test.ts (vitest, gated by SUPABASE_SERVICE_ROLE_KEY)
// Source: e2e/rls-ai-messages.test.ts (Phase 4 pattern).
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 5 SC#5 — cross-tenant RLS on injections', () => {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  });

  it('user B cannot read user A injections via RLS-scoped client', async () => {
    // Create users A and B (email_confirm: true bypasses verify gate for the test).
    const a = (await admin.auth.admin.createUser({ email: `test-a-${Date.now()}@leanshot.test`, email_confirm: true })).data.user!;
    const b = (await admin.auth.admin.createUser({ email: `test-b-${Date.now()}@leanshot.test`, email_confirm: true })).data.user!;
    createdIds.push(a.id, b.id);

    // Seed via service-role (bypasses RLS).
    await admin.from('injections').insert({
      user_id: a.id, log_id: crypto.randomUUID(),
      medication: 'ozempic', dose: '0.5', unit: 'mg', site: 'thigh-l',
      logged_at: new Date().toISOString(),
    });

    // User B signs in via magic-link OTP exchange (Phase 4 pattern).
    const link = (await admin.auth.admin.generateLink({ type: 'magiclink', email: b.email! })).data;
    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error('no token_hash');
    const bClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await bClient.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });

    const { data, error } = await bClient.from('injections').select('*');
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);  // B sees ZERO of A's rows.
  });
});
```

### Common Operation 3 — Playwright SC#1 multi-context smoke

```typescript
// e2e/auth-signup-verify-signin.test.ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test('SC#1: signup → verify → cross-device sync', async ({ browser }) => {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const email = `test-sc1-${Date.now()}@leanshot.test`;
  const password = 'TestPass123';

  // === Browser A: signup ===
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto('/');
  await pageA.locator('text=Sign in').click();
  await pageA.locator('text=Sign up').click();
  await pageA.locator('input[type=email]').fill(email);
  await pageA.locator('input[type=password]').fill(password);
  await pageA.locator('button:has-text("Create account")').click();
  await expect(pageA).toHaveURL(/#\/auth\/verify-sent/);

  // === Simulate email-click via admin generateLink ===
  const link = (await admin.auth.admin.generateLink({ type: 'signup', email, password })).data;
  await pageA.goto(link.properties!.action_link!);
  await expect(pageA.locator('h1:has-text("Email")')).toContainText('verified');

  // === Browser A: log injection ===
  await pageA.locator('[role=tab][aria-label*=Medication]').click();
  // (planner fills the exact injection-form selectors)
  await pageA.locator('button:has-text("Log injection")').click();
  await pageA.locator('select[name=medication]').selectOption('ozempic');
  await pageA.locator('input[name=dose]').fill('0.5');
  await pageA.locator('button:has-text("Save")').click();

  // === Browser B: incognito context, signin ===
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('/');
  await pageB.locator('text=Sign in').click();
  await pageB.locator('input[type=email]').fill(email);
  await pageB.locator('input[type=password]').fill(password);
  await pageB.locator('button:has-text("Sign in")').click();

  // === Browser B: see injection within 5s via Realtime push ===
  await expect(pageB.locator('text=ozempic')).toBeVisible({ timeout: 5000 });

  // Cleanup
  await admin.auth.admin.deleteUser(link.user!.id).catch(() => {});
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `linkIdentity` for credential-based anon promotion | `updateUser({email})` → `updateUser({password})` two-step | Pre-2025 (Supabase docs updated; `linkIdentity` clarified as OAuth-only) | Phase 4 Pitfall 5 surfaced; Phase 5 D-05 locks |
| `signOut()` default global | `signOut({scope: 'local'})` for per-tab/device behavior | Always supported; default still global as of 2025 (footgun) | Always pass `'local'`. Saved Phase 5 from cross-device sign-out bug. |
| Single-shape filter object for postgres_changes | String-form filter `'<col>=<op>.<val>'` (JS) vs object (Dart) | JS API stable since v2; not a recent change | Documented to prevent Dart-pattern copy mistakes. |
| BYO-key Anthropic chat | Edge Function proxy with Bearer JWT | Phase 4 (commits since `9151f22` Moonshot pivot) | Phase 5 inherits — no changes |
| `aiHistory` in localStorage only | `ai_messages` Postgres + RLS + Edge Function writes | Phase 4 | Phase 5 mirrors the pattern for `injections` |
| `claude-sonnet-4-6` hardcoded model ID | Env-var driven `MOONSHOT_MODEL=kimi-k2-latest` | Phase 4 ADDENDUM-MOONSHOT | Not relevant to Phase 5 |

**Deprecated/outdated:**

- The `.on('UPDATE'|'INSERT'|'DELETE', ...)` generic method on channels — replaced by `.on('postgres_changes', {event, schema, table, filter}, cb)`. Phase 5 uses the new form everywhere.
- `signInWithPassword({ email, password })` rejects empty password (per Supabase docs); validate client-side first.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `moddatetime` extension is available on Supabase free tier without a support ticket. | §4, §Don't Hand-Roll | Migration fails at `create extension if not exists moddatetime`. Mitigation: alternative is a hand-rolled `BEFORE UPDATE` trigger function (10 lines of plpgsql) — planner has fallback. Verify at execution time via `select * from pg_available_extensions where name='moddatetime'`. |
| A2 | Password policy "8 chars + 1 digit" is the right OWASP-aligned floor for a v1 health-tracking app's beta cohort. | §9 | If user/security review wants stricter (12 chars + symbol), the change is ONE TOML line + ONE regex line. No architectural impact. |
| A3 | Supabase free tier's Realtime quota (10k concurrent connections, 2M messages/month per docs) covers v1 beta usage (~100 patients × 2 devices × 1 connection each = 200 concurrent). | §5 | Vastly under limit. Re-evaluate at scale. |
| A4 | Vercel preview wildcard pattern `https://*-karstens-projects-16afd0e4.vercel.app/**` matches the project's actual PR preview URLs. | §3 | Verify at first PR preview by looking at the actual URL Vercel emits — if the slug position differs, adjust the wildcard. Documented Supabase pattern. |
| A5 | The `acknowledgedDisclaimer` field should survive signout (preserved alongside theme/onboarded/tour_seen). | §12 (additional open items) | If wrong, returning users see the disclaimer modal again after signout/signin — annoying but not broken. Recommend updating CONTEXT.md's D-11 preserved set to include it. |
| A6 | Realtime postgres_changes does not replay history on subscribe (must explicit-pull first). | §5, §Pitfall 5 | If wrong (and channels DO replay), the explicit `pullInitialInjections` is harmless duplicate work. Safer to assume no-replay. Verify with a manual smoke during Plan 5-03 execution. |
| A7 | Recommending Approach 2 (re-enter password on verify-landing) over Approach 1 (sessionStorage-pass) for anon promotion. | §2 | If user UX-research feedback prefers no-re-enter, switch to Approach 1 with sessionStorage. Both work; trade-off is "lose password on cross-device verify" vs "type password twice". |
| A8 | Pre-Phase-4 user (no anon session) gets an anon UID minted on dashboard mount via a one-line addition. | §12 UI-SPEC Q5 | If we don't mint, the AvatarMenu has no session and either fails to render OR shows a "Sign up" CTA in its place. Either fallback is acceptable; the one-line mint is cleanest. |

**Empty: no.** This phase has multiple `[ASSUMED]` claims that need user confirmation at planning time — primarily the password policy floor (A2) and the preservation of `acknowledgedDisclaimer` (A5). The rest are low-risk verify-at-execution items.

---

## Open Questions

1. **`acknowledgedDisclaimer` in D-11 preserved set?**
   - What we know: D-11 enumerates `theme`, `onboarded`, `tour_seen` as preserved on signout.
   - What's unclear: Phase 2's disclaimer ack is per-device, not per-user — should it survive signout?
   - Recommendation: **Add to preserved set.** Planner updates CONTEXT.md drift note: "D-11 preserved set includes `acknowledgedDisclaimer`."

2. **Sign-out destination (marketing vs auth#signin)?**
   - What we know: UI-SPEC §9 implies marketing. Per `<additional_context>` Q6, planner needs explicit call.
   - What's unclear: Which feels better — returning to marketing (fresh-visitor framing) or auth#signin (continuity)?
   - Recommendation: **marketing.** Header "Sign in" link is one click away if user wants to re-auth.

3. **Approach 1 vs Approach 2 for anon-promote password timing (§2)?**
   - What we know: Both work; trade-off is cross-device support vs no-double-typing.
   - What's unclear: User preference.
   - Recommendation: **Approach 2 (re-enter on verify-landing).** Simpler, more secure, cross-device-friendly.

4. **Final password policy length: 8 vs 10 vs 12?**
   - What we know: OWASP minimum 8; product norms vary.
   - What's unclear: Security review approval (Phase 7 will own this formally).
   - Recommendation: **8 + 1 digit** for v1 invite-only beta; tighten in Phase 7 if security review demands.

5. **`pendingDeleteIds` vs unified `pendingOps`?**
   - What we know: Either shape works for Phase 5; the unified shape is Phase 6-friendly.
   - What's unclear: Whether planner wants to ship Phase 5 with a minimal two-array shape (simpler) or the unified shape (forward-compat).
   - Recommendation: **Unified `pendingOps`** to avoid the Phase 6 refactor.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + Vite + Playwright + Vitest | ✓ | v22.18.0 (local) / v22 (CI) | — |
| `@supabase/supabase-js` | Auth + Realtime + Postgres client | ✓ | 2.105.4 (in `leanshot/package.json`) | — |
| `supabase` CLI | Migration push + config push | ✓ | 2.98.2 (via npx) | — |
| Supabase project `ytnsipxxmzgaebkqmokp` | All server-side | ✓ | ACTIVE_HEALTHY, eu-west-1, pg 17 | — |
| `moddatetime` PostgreSQL extension | `updated_at` trigger | ⚠ Probable (standard contrib) | Verify at exec | Hand-rolled `BEFORE UPDATE` plpgsql trigger function (10 lines) |
| `pg_cron` extension | NOT needed for Phase 5 (anon-cleanup already in Phase 4) | ✓ | Verified Phase 4 | — |
| `@playwright/test` | E2E suite | ✓ | Phase 1 already installed | — |
| `vitest` | Unit + RLS test | ✓ | Phase 1 already installed | — |
| Vercel project `leanshot-app` | SPA hosting | ✓ | `prj_udGmCEFhEojT6Ul0iqZGmHOV5Zrz` | — |
| Vercel preview URL wildcard support in Supabase | E2E on PRs | ✓ Verified in Context7 | Current docs | If broken at exec time, fall back to explicit per-env URLs |
| `SUPABASE_SERVICE_ROLE_KEY` as GH Actions secret | SC#5 RLS test + SC#1 e2e admin client | ⚠ NEEDS USER SETUP | — | Planner adds explicit setup step to plan 5-03; secret retrievable via `npx supabase projects api-keys` |

**Missing dependencies with no fallback:**
- `SUPABASE_SERVICE_ROLE_KEY` GH secret — user must add it before Plan 5-03 CI green is possible. Surface as a checkpoint.

**Missing dependencies with fallback:**
- `moddatetime` extension (probable but not 100% verified): hand-rolled trigger function works identically.

---

## Validation Architecture

(See §11 above — included inline. Key summary: 5 SCs → 4 Playwright e2e files + 2 vitest files; existing CI jobs picks them up; one new GH Actions secret needed; mirrors Phase 4 patterns.)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (email/password + magic-link); `signInWithPassword` / `signUp` / `resetPasswordForEmail`; never hand-roll |
| V3 Session Management | yes | Supabase session in localStorage (`sb-leanshot-auth`); auto-refresh on; JWT shape is industry-standard; `signOut({scope: 'local'})` explicit |
| V4 Access Control | yes | Postgres RLS (`auth.uid() = user_id`); default-deny posture; per-table policies for SELECT/INSERT/UPDATE/DELETE |
| V5 Input Validation | yes | Client-side: HTML5 `type="email"` + regex for password policy; server-side: Supabase validates emails RFC-shape, Postgres CHECK constraints on `unit` column |
| V6 Cryptography | yes | `crypto.subtle.digest('SHA-256')` (browser-native) for storage namespace hash; never hand-roll. PBKDF2/bcrypt password hashing handled server-side by Supabase. |
| V7 Error Handling | yes | Auth errors surface to user via `parseAuthError` (planner authors) — generic messages on signin failure ("Email or password is incorrect"), specific on signup ("Email already in use"); never leak server stack traces |
| V8 Data Protection | yes | `injections` table contains health data — RLS prevents cross-tenant read; TLS at transport (Supabase default); at-rest encryption handled by Supabase (verify free tier supports — yes per their security docs) |
| V13 API Hardening | yes | RLS is the API hardening; rate-limit on `/auth/v1/recover` and `/auth/v1/otp` enforced by Supabase `max_frequency: 1m0s` config |

### Known Threat Patterns for Phase 5

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account takeover via password-reset token re-use | Spoofing | Supabase resets are single-use; expire 1h after issuance; per Supabase docs |
| Email enumeration via signup or password-reset response timing | Information Disclosure | UI-SPEC §6 explicit: "If an account exists for {email}, we sent a reset link." Generic copy. Supabase auth backend handles consistent response times. |
| Cross-tenant data leak via missed RLS policy | Information Disclosure | E2E SC#5 in CI; default-deny posture; 4 policies (SELECT/INSERT/UPDATE/DELETE) explicit per table |
| Replay of old JWT after server-side password change | Repudiation | Supabase invalidates refresh tokens server-side on `updateUser({password})`; access_token (short-lived JWT) expires within minutes per default config — SC#2 ("previous password invalidated") is partially automatic (refresh tokens revoked) + partially time-bound (existing access tokens stay valid until expiry). For belt-and-suspenders, can explicitly call `supabase.auth.signOut({scope: 'others'})` after password reset succeeds. |
| Anon UID hijack via crafted signup | Elevation of Privilege | `updateUser({email})` only operates on the current session's UID — cannot hijack a different user's UID. |
| Stale JWT in tab B after tab A signs out | Spoofing | Cross-tab `storage` event propagates SIGNED_OUT to tab B; Realtime subscription tears down before any stale-JWT write fires. |
| `signOut({scope: 'global'})` accidental hostile UX | Denial of Service (against user) | Always pass `scope: 'local'`; documented anti-pattern. |
| Storage poisoning by malicious cohabiting user | Tampering | D-12 namespaced storage key by user_id hash; signout clears the namespaced key contents (D-11). |
| Phishing via crafted redirect URL | Spoofing | Supabase Redirect URL allowlist (§3) restricts emailRedirectTo to known hosts; wildcards limited to `<team-slug>.vercel.app` not all-of-vercel.app. |

**Explicit recommendation:** after `setNewPassword`, call `supabase.auth.signOut({ scope: 'others' })` (planner adds to AUTH-04 flow) — ensures ALL other devices the user was signed in on are invalidated, exceeding SC#2's literal requirement. This is one extra line and closes the access_token-still-valid window for paranoid users.

---

## Sources

### Primary (HIGH confidence)

- Context7 `/websites/supabase` — fetched 2026-05-11 for: `updateUser` anon promote, `signUp`, `signInWithPassword`, `signInWithOtp`, `signOut` scope options, `resetPasswordForEmail` + `updateUser({password})`, `resend`, `onAuthStateChange` event types + setTimeout gotcha, `onPostgresChanges`/`channel().on()` filter syntax, `upsert` with `onConflict`, Vercel preview wildcard Redirect URL pattern, `realtime.setAuth`.
- `https://supabase.com/docs/guides/auth/auth-anonymous` — anon-promote two-step.
- `https://supabase.com/docs/guides/auth/concepts/redirect-urls` — wildcard support verbatim.
- `https://supabase.com/docs/guides/auth/redirect-urls` — wildcard match patterns.
- `https://supabase.com/docs/guides/realtime/postgres-changes?language=js` — JS filter syntax.
- `https://supabase.com/docs/guides/auth/row-level-security` — explicit filter alongside RLS.
- `https://supabase.com/docs/guides/auth/signout` — scope options.
- `https://supabase.com/docs/reference/javascript/auth-onauthstatechange` — event types + critical setTimeout gotcha.
- Phase 4 RESEARCH `.planning/phases/04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions/04-RESEARCH.md` §Pitfall 5 — `linkIdentity` vs `updateUser` correction (re-verified Context7).
- `.planning/decisions/supabase.md` — live state of Supabase project, project ref, auth provider state, `supabase config push` gotcha.
- `supabase/migrations/20260512000000_ai_messages.sql` + `20260512000001_rate_limit_counters.sql` + `20260512000002_anon_cleanup_pg_cron.sql` — Phase 4 patterns Phase 5 mirrors.
- `leanshot/e2e/rls-ai-messages.test.ts` — cross-tenant test pattern Phase 5 copies for SC#5.

### Secondary (MEDIUM confidence)

- OWASP ASVS 4.0.3 § V2.1.1 (password minimum length 8) — knowledge-cutoff inference; recommend security review confirmation.
- `moddatetime` extension availability on Supabase free tier — inferred from "standard PostgreSQL contrib" + Phase 4's successful `create extension if not exists pg_cron`; verify at execution time.

### Tertiary (LOW confidence)

- None of the recommendations in this research rely on LOW-confidence sources.

---

## Metadata

**Confidence breakdown:**
- Supabase Auth API surface (§1, §2, §3, §9): HIGH — all verified live via Context7 2026-05-11.
- Schema + RLS pattern (§4): HIGH — mirrors Phase 4's verified ai_messages pattern + Context7 RLS docs.
- Realtime subscription mechanics (§5): HIGH for filter syntax + auth refresh; MEDIUM for "no-replay-on-subscribe" assumption (A6 — verifying at execution time is cheap).
- Offline write queue + LWW merge (§6): HIGH — straightforward Zustand patterns; Postgres LWW is server-authoritative.
- Storage namespace migration (§7): HIGH — browser-native APIs; pattern mirrors existing v3→v4/v5→v6.
- Cross-tab signout (§8): HIGH — verified via Context7 verbatim.
- State machine + onAuthStateChange (§10): HIGH for events; HIGH for setTimeout gotcha (verbatim docs warning).
- Validation architecture (§11): HIGH — mirrors Phase 1 + Phase 4 test infrastructure.
- Phase 6 hand-off (§13): MEDIUM — anticipatory; will be re-verified at Phase 6 research.
- CI gates (§14): HIGH for workflow changes; depends on user adding service-role key as GH secret.

**Research date:** 2026-05-11
**Valid until:** 2026-06-10 (30 days for stable items; recheck Vercel preview wildcard + supabase-js version + `moddatetime` availability if Phase 5 execution starts after this date).

---

## RESEARCH COMPLETE
