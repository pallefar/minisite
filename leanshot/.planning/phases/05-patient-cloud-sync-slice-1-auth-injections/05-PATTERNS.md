# Phase 5: Patient Cloud Sync Slice 1 — Auth + Injections — Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 25 (13 CREATE + 11 MODIFY + 1 CI config)
**Analogs found:** 24 / 25 (one first-of-kind file: `src/lib/sync.ts`)

Pattern excerpts cite the file path + line range. Planner copies these verbatim where stated and adapts where noted.

---

## File Classification

### Files Phase 5 CREATES

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/lib/auth.ts` | lib / API wrapper | request-response | `src/lib/ai.ts` | exact (thin Supabase wrapper + typed errors) |
| `src/lib/sync.ts` | lib / sync engine | event-driven + CRUD | RESEARCH §5 canonical (no codebase analog) | first-of-kind (use RESEARCH §5 + Pattern 2) |
| `src/lib/auth-migration.ts` | lib / migration utility | batch / one-shot | `src/lib/storage.ts` `migrateFromV3` | role-match (defensive parse + fallback) |
| `src/components/auth/AuthView.tsx` | component / container | request-response (UI state machine) | `src/components/onboarding/OnboardingFlow.tsx` | role-match (multi-step container, AnimatePresence transitions) |
| `src/components/auth/SignUpForm.tsx` | component / form | request-response | `OnboardingFlow.tsx` step 1 (lines 202-229) + `Input.tsx` | exact (Input + Button + useToast error pattern) |
| `src/components/auth/SignInForm.tsx` | component / form | request-response | `OnboardingFlow.tsx` step 1 | exact |
| `src/components/auth/ForgotPasswordForm.tsx` | component / form | request-response | `OnboardingFlow.tsx` step 1 | exact |
| `src/components/auth/SetNewPasswordForm.tsx` | component / form | request-response | `OnboardingFlow.tsx` step 1 | exact |
| `src/components/auth/VerifyEmailLanding.tsx` | component / 3-state screen | event-driven | `OnboardingFlow.tsx` final step (lines 497-525) + `AnimatePresence` mode='wait' (line 160) | role-match |
| `src/components/auth/PostSignupSent.tsx` | component / result screen | request-response | `OnboardingFlow.tsx` final step "all set" panel | role-match (EmptyState shape) |
| `src/components/auth/EmailVerificationBanner.tsx` | component / banner | event-driven | `Toast.tsx` (`role="status"` `aria-live="polite"` — see §"Shared Patterns: Accessibility") | first-of-kind banner, but a11y conventions exist |
| `src/components/layout/AvatarMenu.tsx` | component / dropdown | request-response | `Sidebar.tsx` lines 132-138 (avatar button) + `Modal.tsx` (focus/escape patterns) | role-match (no existing dropdown menu primitive — see Gotcha) |
| `supabase/migrations/<ts>_injections.sql` | migration | DDL | `supabase/migrations/20260512000000_ai_messages.sql` | **exact — copy verbatim, swap columns** |
| `e2e/auth-signup-verify-signin.test.ts` | test (Playwright) | request-response | `e2e/onboarding.spec.ts` | role-match (Playwright `@playwright/test` style) |
| `e2e/rls-injections.test.ts` | test (Vitest + admin) | CRUD | `e2e/rls-ai-messages.test.ts` | **exact — copy verbatim, swap `ai_messages` → `injections`** |
| `e2e/password-reset.test.ts` | test (Playwright) | request-response | `e2e/onboarding.spec.ts` + Phase 4 `rls-ai-messages.test.ts` (admin `generateLink`) | role-match |
| `e2e/offline-log-then-sync.test.ts` | test (Playwright multi-context) | event-driven | `e2e/onboarding.spec.ts` | role-match (new: `context.setOffline()`) |
| `src/lib/auth.test.ts` | test (Vitest unit) | request-response | `src/lib/ai.test.ts` | exact (vi.mock('@/lib/supabase')) |
| `src/lib/sync.test.ts` | test (Vitest unit) | event-driven | `src/lib/ai.test.ts` | exact (vi.mock + Realtime payload fixtures) |
| `src/lib/auth-migration.test.ts` | test (Vitest unit) | batch | `src/lib/storage.test.ts` | exact (Storage.prototype spy pattern) |

### Files Phase 5 MODIFIES

| Modified File | Role | Data Flow | Closest Analog (= itself, plus reference patterns) | Notes |
|---------------|------|-----------|----------------------------------------------------|-------|
| `src/App.tsx` | app router | event-driven (auth listener) | itself + `useEffect` lazy-load pattern (lines 11-57) | add `auth` view + top-level `onAuthStateChange` listener |
| `src/lib/store.ts` | state / store | event-driven | itself (Zustand action verb-noun) | add `signedIn` + `pendingOps` slices + auth/sync actions |
| `src/lib/storage.ts` | persistence | batch (migration) | itself (`migrateFromV3` lines 87-122) | STORAGE_VERSION 6→7 + `namespacedKey` |
| `src/lib/supabase.ts` | client singleton | request-response | itself + add Realtime helpers | only minor additions (see Gotcha — most Realtime code belongs in `sync.ts`) |
| `src/types/index.ts` | types | n/a | itself (`Injection` interface lines 61-71) | add `log_id: string` + optional `updated_at?: string` + `user_id?: string` |
| `src/components/layout/Topbar.tsx` | component | request-response | itself (right-cluster lines 78-118) | add `AvatarMenu` |
| `src/components/marketing/Landing.tsx` | component | request-response | itself (`Nav` lines 42-74) | add "Sign in" link + hero CTA copy |
| `src/components/onboarding/OnboardingFlow.tsx` | component | request-response | itself final step (lines 497-525) | add "Save your data" CTA pair (keep TOTAL_STEPS=8 per RESEARCH §12 Q6) |
| `src/components/dashboard/settings/SettingsPage.tsx` | component | request-response | itself (NAV array lines 37-45) | prepend Account section |
| `src/main.tsx` | bootstrap | event-driven | itself (lines 47-59 hydrate-then-render) | hydrate STAYS pre-render; `onAuthStateChange` subscription lives in `App.tsx` (D-09) — main.tsx unchanged |
| `.github/workflows/ci.yml` | CI | request-response | itself (`test-e2e` lines 71-133, `test-unit` lines 58-69) | add `SUPABASE_*` env to test-unit and test-e2e jobs |

---

## Pattern Assignments

### `src/lib/auth.ts` (lib / API wrapper) — NEW

**Analog:** `src/lib/ai.ts`

**Module header banner** (copy structure, swap purpose) — `src/lib/ai.ts:1-19`:
```ts
/**
 * Browser-side AI proxy wrapper.
 *
 * Phase 4 D-01 + D-02 + D-05: replaces the v1 in-browser Anthropic fetch
 * ...
 */
```
Use the same JSDoc-with-Phase-decision-citations style for `auth.ts`:
```ts
/**
 * Browser-side Supabase Auth wrapper.
 *
 * Phase 5 D-02 (password-primary) + D-05 (anon→permanent via updateUser,
 * NEVER linkIdentity — that's OAuth-only). Thin functions over
 * supabase.auth.* so UI components never touch the SDK directly and
 * unit tests can mock at this seam.
 */
```

**Import pattern** — `src/lib/ai.ts:20-22`:
```ts
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { supabase } from '@/lib/supabase';
```
For `auth.ts`:
```ts
import { supabase } from '@/lib/supabase';
import type { AuthError, Session, User } from '@supabase/supabase-js';
```

**Typed error classes** — `src/lib/ai.ts:46-61`:
```ts
export class RateLimitedError extends Error {
  constructor() {
    super('AI rate limit exceeded');
    this.name = 'RateLimitedError';
  }
}

export class AIUnavailableError extends Error {
  constructor(
    public kind: 'signin' | 'upstream' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}
```
Mirror in `auth.ts` for surface-able auth errors (e.g., `EmailUnconfirmedError`, `WeakPasswordError`) — but: the Supabase SDK already returns `{error: AuthError}` from every method. The CONTEXT/UI-SPEC design has each form render the inline error string; only carry-typed-errors if a UI branch needs to discriminate beyond message strings. Otherwise, return `{user, session, error}` shape (RESEARCH §1 line 276):
```ts
export interface AuthResult { user: User | null; session: Session | null; error: AuthError | null; }
```

**Function shape — async + typed return** — `src/lib/ai.ts:85-95`:
```ts
export async function callAIChat(opts: CallAIChatOpts): Promise<void> {
  const { messages, mode = 'coach', userContext, onText, signal } = opts;
  // 1. Ensure anonymous (or real) session → JWT.
  let jwt: string;
  try {
    jwt = await ensureSession();
  } catch (e) {
    if (e instanceof AIUnavailableError) throw e;
    throw new AIUnavailableError('signin', e instanceof Error ? e.message : 'unknown');
  }
  ...
```
Apply to every exported auth function (signUp, signIn, signOut, etc.) — see RESEARCH lines 284-354 for the canonical signatures.

**Convention notes:**
- Named exports only; `function` declaration for multi-line, arrow for one-liners.
- Explicit `Promise<XxxResult>` return types on every exported function (CONVENTIONS line 396).
- `// 1.` / `// 2.` numbered step comments inside multi-step flows (mirrors ai.ts:88, 96, 124).
- No `console.log`; `console.error('[leanshot] ...', err)` ONLY for unexpected branches (CONVENTIONS lines 306-313).

---

### `src/lib/sync.ts` (lib / sync engine) — NEW, first-of-kind

**Analog:** No existing analog. Use RESEARCH §5 Pattern 2 (lines 367-449) verbatim as the source of truth.

**Convention notes from sibling lib files:**
- Module-level `let injectionsChannel: RealtimeChannel | null = null` — singleton-channel pattern matches `src/lib/storage.ts:26` `STORAGE_KEY` constant style; module-level mutable state IS the convention for client-lifecycle singletons.
- All Realtime + Postgres calls go through `supabase` imported from `@/lib/supabase` (NEVER re-create a client).
- Functions exported as named, typed return values: `export async function pullInitialInjections(userId: string): Promise<void>`.
- Errors swallowed via `console.error('[leanshot] pullInitial failed', error)` per CONVENTIONS line 308.

**Gotchas (RESEARCH §10, §Pitfall 2):**
- `onAuthStateChange` callback MUST defer via `setTimeout(fn, 0)` to avoid SDK deadlock. Wire it in App.tsx (not in sync.ts itself).
- Realtime `postgres_changes` does NOT replay history — `pullInitialInjections` MUST run BEFORE `subscribeInjections` to seed Zustand.
- `signOut({scope: 'local'})` — never plain `signOut()` (default is `global`).
- Channel cleanup via `await supabase.removeChannel(channel)` on signout AND beforeunload.

---

### `src/lib/auth-migration.ts` (lib / migration utility) — NEW

**Analog:** `src/lib/storage.ts` `migrateFromV3` (lines 87-122)

**Defensive try/catch + fallback pattern** — `src/lib/storage.ts:87-122`:
```ts
export function migrateFromV3(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const v3 = JSON.parse(raw) as Record<string, unknown>;
    const merged: Partial<PersistedState> = {
      user: (v3.user as User) ?? null,
      injections: (v3.injections as Injection[]) ?? [],
      // ... every field with `?? defaultValue`
    };
    // Only delete legacy after we've successfully built the merged state.
    localStorage.removeItem(LEGACY_KEY);
    return merged;
  } catch (e) {
    console.error('[leanshot] v3 migration failed', e);
    return null;
  }
}
```
**Mirror for `auth-migration.ts`:**
- `runAnonPromotionMigrationIfNeeded(userId: string): Promise<void>` — D-05 post-promotion housekeeping (toast)
- `runLocalToCloudMigrationIfNeeded(userId: string): Promise<void>` — D-06 bulk-upload, back-stamps `log_id` if absent via `crypto.randomUUID()`
- `renameStorageNamespace(userId: string): Promise<void>` — D-12 storage re-key (RESEARCH §7 lines 958-974 verbatim impl)
- Every fn wraps storage / network calls in `try`/`catch`; `[leanshot]`-prefixed error logging; silent fail-soft return.

**`log_id` back-stamp gotcha** (RESEARCH §7 lines 925-930):
```ts
const stamped = (injections as Array<Record<string, unknown>>).map((row) => ({
  log_id: typeof row.log_id === 'string' ? row.log_id : crypto.randomUUID(),
  ...row,
}));
```
Must run during v6→v7 in `src/lib/storage.ts` `migrateState` chain (NOT in auth-migration.ts — storage migrations are version-driven; auth-migration runs on SIGNED_IN).

---

### `src/components/auth/AuthView.tsx` (component / container) — NEW

**Analog:** `src/components/onboarding/OnboardingFlow.tsx` (multi-step container)

**Container shell pattern** — `OnboardingFlow.tsx:154-180`:
```tsx
return (
  <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6 safe-top safe-bottom">
    <div className="w-full max-w-[560px]">
      <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden">
        {/* Full-bleed illustration banner */}
        <div className="relative h-[180px] md:h-[200px] bg-gradient-to-br from-[var(--color-primary-soft)] to-[var(--color-surface-elevated)] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
              ...
```

**Hash routing inside container** (D-01) — UI-SPEC §1, no codebase analog; planner authors based on `window.location.hash` + `useEffect`:
```tsx
useEffect(() => {
  const onHashChange = (): void => setSubScreen(parseHash(window.location.hash));
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}, []);
```
Pattern echoes `App.tsx:102-106` `leanshot:replay-tour` event listener cleanup style.

**Lazy-load registration** — `App.tsx:39-44`:
```tsx
const Onboarding = lazy(() =>
  import('@/components/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })),
);
```
Apply identically for `AuthView` in `App.tsx`:
```tsx
const AuthView = lazy(() =>
  import('@/components/auth/AuthView').then((m) => ({ default: m.AuthView })),
);
```

**`prefers-reduced-motion` gating** (CLAUDE.md mandate; CONVENTIONS line 452):
- Use `useReducedMotion()` from `@/hooks/useReducedMotion` if RAF / large transitions appear.
- `OnboardingFlow.tsx` already runs `AnimatePresence` with 0.4s transitions; framer-motion respects `prefers-reduced-motion` at the CSS layer via `index.css`. No extra code needed for fade-in transitions; gate only RAF loops / chained animations.

---

### `src/components/auth/SignUpForm.tsx`, `SignInForm.tsx`, `ForgotPasswordForm.tsx`, `SetNewPasswordForm.tsx` (forms) — NEW

**Analog:** `src/components/onboarding/OnboardingFlow.tsx` step 1 (lines 202-229) + `src/components/ui/Input.tsx`

**Form field pattern** — `OnboardingFlow.tsx:215-227`:
```tsx
<Input
  label="Your name"
  placeholder="First name"
  autoComplete="given-name"
  value={draft.name}
  onChange={(e) => update({ name: e.target.value })}
/>
```
Apply for email + password fields with `autoComplete="email" | "current-password" | "new-password"`.

**Inline validation error via FieldShell** — `src/components/ui/Input.tsx:70-79`:
```tsx
{(hint || error) && (
  <p
    className={cn(
      'text-[12px] leading-snug',
      error ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]',
    )}
  >
    {error ?? hint}
  </p>
)}
```
Pass `error="..."` prop to `Input` to surface inline; RESEARCH §12 Q7 recommends adding `role="alert"` to this `<p>` — one-line change in `Input.tsx` if planner accepts.

**Toast on submit error** — `OnboardingFlow.tsx:98`:
```tsx
if (step === 1 && !draft.name.trim()) return toast('Please enter your name', 'error');
```
For auth forms, prefer inline `error` prop on `Input` (UX consistency) and reserve `toast` for non-field-level errors (network down, rate-limited).

**Loading state on submit** — `Button.tsx` `loading` prop + `aria-busy` (CONVENTIONS line 450):
```tsx
<Button loading={submitting} onClick={handleSubmit}>Sign up</Button>
```

**Password policy regex** (RESEARCH §9 line 1036):
```ts
const PASSWORD_POLICY = /^(?=.*\d).{8,}$/;
function isPasswordValid(pw: string): boolean { return PASSWORD_POLICY.test(pw); }
```

---

### `src/components/auth/VerifyEmailLanding.tsx` (3-state success/error/loading) — NEW

**Analog:** `OnboardingFlow.tsx` final step (lines 497-525) for the "all set" success shape; `AnimatePresence mode='wait'` from `OnboardingFlow.tsx:160` for state transitions.

**Three-state finite enum pattern** — `OnboardingFlow.tsx:191-525` (step machine via discriminated `if` blocks):
```tsx
{step === 7 && (
  <div className="space-y-4">
    <div>
      <h1 className="text-[26px] font-bold tracking-tight">
        You&apos;re{' '}
        <span className="font-display italic font-normal text-[var(--color-primary)]">
          all set.
        </span>
      </h1>
      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
        Here&apos;s what&apos;s next:
      </p>
    </div>
    ...
```
Adapt as:
```tsx
{state === 'loading' && <Loading />}
{state === 'success' && <Success onContinue={...} />}
{state === 'error' && <ErrorView onResend={...} />}
```

**Auto-redirect after success** (UI-SPEC §4 — 1.5s; RESEARCH §12 Q10 keeps default):
```tsx
useEffect(() => {
  if (state !== 'success') return;
  const t = window.setTimeout(() => { window.location.hash = '#/auth/signin'; }, 1500);
  return () => window.clearTimeout(t);
}, [state]);
```
Pattern mirrors `App.tsx:87-99` `setTimeout` with cleanup-on-cancel.

---

### `src/components/auth/PostSignupSent.tsx` — NEW

**Analog:** `OnboardingFlow.tsx` step 7 (lines 497-525) + `NextStep` helper (lines 582-594).

Same "centered card with H1 + sub + CTA" shape. Replace illustration with a "Check your email" mark; include "Resend verification email" button calling `auth.resendVerification(email)`.

---

### `src/components/auth/EmailVerificationBanner.tsx` — NEW (first-of-kind banner)

**Analog (closest a11y pattern):** `src/components/ui/Toast.tsx` `role="status"` + `aria-live="polite"` (CONVENTIONS line 449).

**Apply** (UI-SPEC §8 — banner persists, not auto-dismissed; differs from Toast):
```tsx
<div
  role="region"
  aria-label="Email verification reminder"
  className="bg-[var(--color-warning-soft)] border border-[var(--color-warning)] rounded-card px-4 py-3 flex items-center gap-3"
>
  <p className="text-[14px] flex-1">Verify your email to sync across devices.</p>
  <Button variant="ghost" size="sm" onClick={handleResend}>Resend</Button>
</div>
```
Mounts inside `AppShell` only when `signedIn.user && !signedIn.verified` (D-13).

---

### `src/components/layout/AvatarMenu.tsx` — NEW

**Analog:** `src/components/layout/Sidebar.tsx` lines 132-138 (avatar circle) + manual dropdown (no existing dropdown primitive in `src/components/ui/`).

**Avatar circle pattern** — `Sidebar.tsx:132-138`:
```tsx
<button
  onClick={onOpenSettings}
  aria-label="Open profile"
  className="size-10 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] inline-flex items-center justify-center font-bold text-[13px] border-2 border-[var(--color-surface)] hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
>
  {userInitial}
</button>
```
Adapt: replace `onClick={onOpenSettings}` with menu-open toggle + initials computed from email or `user.name?.[0]`.

**Dropdown panel pattern** — no existing dropdown component. Closest reference is the search input expansion in `Topbar.tsx:79-88` + `Modal.tsx` ESC/outside-click handling (lines 56-67):
```tsx
useEffect(() => {
  if (!open) return;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dismissible) onClose();
  };
  document.addEventListener('keydown', onKey);
  ...
```
Apply for AvatarMenu's open-state listener (ESC + click-outside). Anonymous-state amber dot per RESEARCH §12 Q3 → use `var(--color-warning)` ring.

**Convention notes:**
- `aria-label="Account menu"` on trigger button.
- Menu items as `<button>` (not `<a>`) — actions, not navigation.
- Focus trap inside menu while open; restore focus to trigger on close (Modal precedent).

---

### `supabase/migrations/<ts>_injections.sql` — NEW

**Analog:** `supabase/migrations/20260512000000_ai_messages.sql` — copy verbatim, swap table/columns.

**Full file header + RLS block** — `20260512000000_ai_messages.sql:1-46`:
```sql
-- Phase 4 D-04 + AI-05 (Cross-tenant isolation for AI history).
--
-- public.ai_messages — the conversation log written by the `ai-chat` Edge Function.
-- ...
-- Audit invariant: NO update / NO delete policy. ...

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ...
);

create index ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);

alter table public.ai_messages enable row level security;

create policy "ai_messages_select_own"
  on public.ai_messages
  for select
  using (auth.uid() = user_id);

create policy "ai_messages_insert_own"
  on public.ai_messages
  for insert
  with check (auth.uid() = user_id);
```

**Phase 5 deltas vs analog** (per RESEARCH §4 lines 666-756):
- Drop `id uuid primary key`; use composite `primary key (user_id, log_id)` for client-stable identity.
- Add domain columns: `medication`, `dose`, `unit`, `site`, `notes`, `logged_at`, `pk_engine_version`.
- Add `updated_at timestamptz` + `moddatetime` trigger (D-08 LWW; `ai_messages` is append-only, `injections` needs UPDATE).
- Add ALL FOUR policies (select / insert / update / delete) — `ai_messages` ships only select+insert because it's append-only; `injections` needs full CRUD (D-08 LWW edits, D-06 hard delete).
- Add `alter publication supabase_realtime add table public.injections;` (Realtime fanout per D-09).

**File naming** — `20260512000000_ai_messages.sql` uses YYYYMMDD000000 timestamp. New file: `20260513000000_injections.sql` (or any timestamp > Phase 4's, ensuring lexical ordering).

---

### `e2e/rls-injections.test.ts` — NEW

**Analog:** `e2e/rls-ai-messages.test.ts` — **copy verbatim, swap `ai_messages` → `injections`**.

**Header + env-gate** — `rls-ai-messages.test.ts:1-27`:
```ts
/**
 * Phase 4 SC#5 + T-04-04 cross-tenant proof.
 * ...
 * Skipped automatically if `SUPABASE_SERVICE_ROLE_KEY` is not set ...
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;
```

**Admin client + cleanup** — `rls-ai-messages.test.ts:30-43`:
```ts
const admin: SupabaseClient = createClient(URL!, SERVICE!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch { /* best-effort cleanup */ }
  }
});
```

**Magic-link session mint** — `rls-ai-messages.test.ts:81-113`:
```ts
const { data: sessionA } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: userA.email!,
});
const tokenHash = sessionA.properties?.hashed_token;
const userClient = createClient(URL!, ANON!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: verifyRes } = await userClient.auth.verifyOtp({
  type: 'magiclink',
  token_hash: tokenHash,
});
```

**Convention notes:** ALL test files import `vi`, `describe`, `expect`, `it` from `vitest` (not jest globals). Note that despite living in `e2e/`, this is a Vitest test (matches `rls-ai-messages.test.ts` precedent — the `e2e/` directory naming is a convenience, not a Playwright marker).

---

### `e2e/auth-signup-verify-signin.test.ts` — NEW (Playwright)

**Analog:** `e2e/onboarding.spec.ts` (Playwright `@playwright/test` import) + `rls-ai-messages.test.ts` (admin `generateLink` for email-link automation).

**Playwright import + test shape** — `e2e/onboarding.spec.ts:1-7`:
```ts
import { expect, test } from '@playwright/test';

test('onboarding happy path: marketing → 8 steps (Step 0 + 1-7) → HomeTab dashboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).first().click();
  ...
```
**Multi-context (Browser A + Browser B for SC#1)** — RESEARCH §11 line 1131:
```ts
import { test, expect, type BrowserContext } from '@playwright/test';

test('SC#1: signup → verify → cross-device sync', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  ...
});
```

**Email-link extraction via admin** (mirror `rls-ai-messages.test.ts:81-103`):
```ts
const { data } = await admin.auth.admin.generateLink({
  type: 'signup',
  email,
});
const verifyUrl = data.properties?.action_link;
await pageA.goto(verifyUrl!);
```

**Locator style** — `onboarding.spec.ts:11-15`:
```ts
await page.getByRole('button', { name: /get started/i }).first().click();
await expect(page.getByText(/not medical advice/i)).toBeVisible();
await page.getByLabel('Your name').fill('Alex');
```
Always use role/label/text locators (never CSS selectors unless necessary). Case-insensitive regex names.

---

### `src/lib/auth.test.ts`, `sync.test.ts`, `auth-migration.test.ts` — NEW Vitest unit tests

**Analog:** `src/lib/ai.test.ts` (for auth.ts + sync.ts) + `src/lib/storage.test.ts` (for auth-migration.ts).

**Module mock pattern** — `ai.test.ts:20-26`:
```ts
vi.mock('@/lib/supabase', () => {
  const auth = {
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
  };
  return { supabase: { auth } };
});
```
Extend the auth mock for sync.ts tests to include `channel`, `from`, `removeChannel`.

**beforeEach/afterEach env stubbing** — `ai.test.ts:48-72`:
```ts
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'jwt-xyz' } },
  } as unknown as AuthShim);
  ...
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

**Storage spy pattern (for auth-migration.test.ts)** — `storage.test.ts:19-34`:
```ts
let storageMock: Record<string, string>;

beforeEach(() => {
  storageMock = {};
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => storageMock[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    storageMock[k] = String(v);
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => {
    delete storageMock[k];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

---

### `src/App.tsx` — MODIFY

**Current view selector** — `App.tsx:59-84`:
```tsx
type View = 'marketing' | 'onboarding' | 'dashboard';

export function App() {
  const user = useStore((s) => s.user);
  ...
  const [view, setView] = useState<View>(() => (user ? 'dashboard' : 'marketing'));
  ...
  useEffect(() => {
    if (user && view !== 'dashboard') setView('dashboard');
    if (!user && view === 'dashboard') setView('marketing');
  }, [user, view]);
```

**Extend to** (per RESEARCH §10 lines 1097-1109):
```tsx
type View = 'marketing' | 'onboarding' | 'auth' | 'dashboard';

function selectView(state, hash): View {
  if (hash.startsWith('#/auth/')) return 'auth';
  if (state.signedIn?.user && !state.signedIn.user.is_anonymous) return 'dashboard';
  if (state.user) return 'dashboard';
  return 'marketing';
}
```

**Top-level `onAuthStateChange` listener pattern** — combine with existing useEffect style (`App.tsx:81-99`) — RESEARCH §10 lines 463-513:
```tsx
useEffect(() => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // CRITICAL: defer all supabase.* calls via setTimeout(fn, 0) per official docs.
    setTimeout(() => { void handleAuthEvent(event, session); }, 0);
  });
  return () => data.subscription.unsubscribe();
}, []);
```
The `setTimeout(..., 0)` guard is non-optional (RESEARCH §Pitfall 2).

**Lazy-load auth view** — `App.tsx:39-44`:
```tsx
const AuthView = lazy(() =>
  import('@/components/auth/AuthView').then((m) => ({ default: m.AuthView })),
);
```

**`<Suspense>` boundary** — `App.tsx:119-132` already wraps each view; add the `auth` branch:
```tsx
if (view === 'auth') {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AuthView />
    </Suspense>
  );
}
```

---

### `src/lib/store.ts` — MODIFY

**Current action shape** — `store.ts:37-101` (Actions interface) + `store.ts:191-211` (addInjection):

```ts
addInjection: (inj) =>
  set((s) => {
    const stamped: Injection = { ...inj, pkEngineVersion: inj.pkEngineVersion ?? 1 };
    const injections = [stamped, ...s.injections];
    ...
  }),
```

**New action shape for Phase 5** — RESEARCH §6 lines 801-836:
```ts
addInjection: (input: Omit<Injection, 'log_id'>) => {
  const log_id = crypto.randomUUID();  // RESEARCH §Stack — native API, no dep
  const injection: Injection = { log_id, ...input, pkEngineVersion: 1 };
  set((s) => ({
    injections: [injection, ...s.injections],
    pendingSyncIds: [...s.pendingSyncIds, log_id],
  }));
  void flushSyncQueue();  // fire-and-forget; never block UI
},
```

**`partialize` allow-list extension** — `store.ts:309-329`. Add `signedIn`, `pendingSyncIds`, `pendingDeleteIds` (or unified `pendingOps` per RESEARCH §13 — recommended for Phase 6 forward-compat).

**Verb-noun action naming** (CONVENTIONS line 442): `signIn`, `signOut`, `signUp`, `verifyEmail`, `requestPasswordReset`, `setNewPassword`, `setSession`, `clearUserDataSlices`, `flushSyncQueue`, `mergeServerInjections`, `applyRealtimePayload`, `clearPendingSyncIds`.

**Migration chain extension** — `store.ts:131-163` `migrateState`:
```ts
if (state && version <= 6) {
  // Phase 5 D-10/D-12: add pendingSyncIds + back-stamp log_id + namespace storage.
  state = {
    ...state,
    pendingSyncIds: state.pendingSyncIds ?? [],
    pendingDeleteIds: state.pendingDeleteIds ?? [],
    injections: (state.injections ?? []).map((inj) => ({
      ...inj,
      log_id: inj.log_id ?? crypto.randomUUID(),
    })),
  };
}
```

---

### `src/lib/storage.ts` — MODIFY

**Current** — `storage.ts:26-31`:
```ts
export const STORAGE_KEY = 'leanshot_v4';
export const LEGACY_KEY = 'leanshot_v3';
export const STORAGE_VERSION = 6;
```

**Bump to** (RESEARCH §7 lines 895-906):
```ts
export const STORAGE_VERSION = 7;  // Phase 5 D-10/D-12

export async function namespacedKey(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hex = hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${STORAGE_KEY}:${hex.slice(0, 16)}`;
}
```
**Mirror the `migrateFromV3` JSDoc + defensive pattern** for `migrateV6ToV7` (RESEARCH §7 lines 917-952) — try/catch around every `localStorage` call; `[leanshot]`-prefixed console.error.

---

### `src/lib/supabase.ts` — MODIFY (minimally)

**Current** — `supabase.ts:40-47`:
```ts
export const supabase: SupabaseClient = createClient(RESOLVED_URL, RESOLVED_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'sb-leanshot-auth',
  },
});
```
**No change required.** All Realtime + auth helpers live in `src/lib/sync.ts` and `src/lib/auth.ts`. The singleton stays as-is.

---

### `src/types/index.ts` — MODIFY

**Current `Injection`** — `types/index.ts:61-71`:
```ts
export interface Injection {
  datetime: string; // ISO
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  pkEngineVersion?: number;
}
```

**Extend** (RESEARCH §4 lines 766-777):
```ts
export interface Injection {
  log_id: string;            // NEW Phase 5: client-generated UUID, composite PK w/ user_id
  datetime: string;
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  pkEngineVersion?: number;
  // Server-derived only (not persisted client-side from local writes):
  updated_at?: string;       // ISO timestamptz; LWW comparison
  user_id?: string;
}
```

---

### `src/components/layout/Topbar.tsx` — MODIFY

**Right-cluster pattern** — `Topbar.tsx:78-118` (the `<div className="flex items-center gap-2 flex-wrap">` block).

Add `<AvatarMenu />` to the right cluster, after the existing IconButtons and Buttons. UI-SPEC §9 calls for it adjacent to the Sun/Moon theme toggle.

---

### `src/components/marketing/Landing.tsx` — MODIFY

**Current `Nav`** — `Landing.tsx:42-74`:
```tsx
function Nav({ theme, toggle, onStart }) {
  return (
    <nav className="max-w-[1200px] mx-auto px-5 py-4 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[var(--color-primary)]">
        ...LeanShot
      </div>
      <div className="flex items-center gap-2">
        <IconButton ...>{moon/sun}</IconButton>
        <Button onClick={onStart} size="sm" trailingIcon={<ArrowRight ... />}>Get started</Button>
      </div>
    </nav>
  );
}
```
**Insert "Sign in" link** before the "Get started" button — UI-SPEC §12:
```tsx
<a
  href="#/auth/signin"
  className="text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors px-3 py-1.5"
>
  Sign in
</a>
```

---

### `src/components/onboarding/OnboardingFlow.tsx` — MODIFY

**Final step** — `OnboardingFlow.tsx:497-525` ("You're all set."). **Keep TOTAL_STEPS=8** (RESEARCH §12 Q6). Append a secondary CTA pair at the bottom: "Sign up — free" (primary, routes to `#/auth/signup`) + "Maybe later" (ghost, dismisses).

Pattern reference for CTA pair (already in same file `OnboardingFlow.tsx:529-562`):
```tsx
<div className="flex gap-2 mt-7">
  <Button variant="ghost" onClick={...}>Maybe later</Button>
  <Button onClick={...} trailingIcon={<ArrowRight />}>Sign up — free</Button>
</div>
```

---

### `src/components/dashboard/settings/SettingsPage.tsx` — MODIFY

**Section nav array** — `SettingsPage.tsx:37-45`:
```ts
const NAV: { id: Section; label: string; Icon: typeof UserIcon }[] = [
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  { id: 'goals', label: 'Goals', Icon: Target },
  ...
];
```
**Prepend "Account" section** (UI-SPEC §10):
```ts
type Section = 'account' | 'profile' | 'goals' | ...;

const NAV: ... = [
  { id: 'account', label: 'Account', Icon: Mail },   // NEW Phase 5
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  ...
];
```
Section body: email read-only with re-verification on change; password change → triggers `auth.requestPasswordReset`.

---

### `src/main.tsx` — REVIEW (mostly unchanged)

**Current pre-render flow** — `main.tsx:47-59`:
```tsx
void hydrate().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  deferAnalyticsInit(initAnalytics);
});
```
**No change** — the `onAuthStateChange` listener lives in `App.tsx` (D-09, RESEARCH §10), NOT `main.tsx`. The hydrate-then-render order stays.

**Gotcha:** `<StrictMode>` double-mounts components in dev. The `onAuthStateChange` `useEffect` in App.tsx must idempotently handle being called twice — the return-cleanup `data.subscription.unsubscribe()` covers this; verify in `auth.test.ts`.

---

### `.github/workflows/ci.yml` — MODIFY

**Job structure analog** — `ci.yml:58-69` (`test-unit`) + `ci.yml:71-133` (`test-e2e`).

**Add Supabase secrets to existing `test-unit`** (RESEARCH §14 lines 1220-1238):
```yaml
test-unit:
  ...
  steps:
    ...
    - run: npm run test:unit
      env:
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

**Add to `test-e2e` build step** (RESEARCH §14 lines 1242-1265):
```yaml
- name: Build (production-shaped, empty env)
  run: npm run build
  env:
    VITE_SENTRY_DSN: ''
    VITE_POSTHOG_KEY: ''
    VITE_POSTHOG_HOST: ''
    VITE_ANALYTICS_ENABLED: 'false'
    VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}     # NEW Phase 5
    VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}  # NEW Phase 5

- name: Run Playwright smoke against production build
  run: npm run test:e2e
  env:
    CI: 'true'
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

No new job needed — the existing globs auto-discover new `e2e/*.test.ts` (Vitest) and `e2e/*.spec.ts` (Playwright) files. (Note: RESEARCH uses `.test.ts` extension for Vitest-in-e2e per `rls-ai-messages.test.ts` precedent; Playwright config glob in `playwright.config.ts` is the source of truth for which extension Playwright picks up — planner verifies.)

---

## Shared Patterns

### Path aliases (`@/*`)
**Source:** `tsconfig.app.json` + `vite.config.ts:9-11`
**Apply to:** EVERY new file.
- Cross-directory imports: `@/lib/...`, `@/components/...`, `@/hooks/...`, `@/types`.
- Sibling-only imports: `./File` (e.g., `AuthView` importing `./SignUpForm`).
- NEVER use `../` (CONVENTIONS line 77).

### Strict TypeScript signatures
**Source:** `src/lib/ai.ts` + `src/lib/helpers.ts`
**Apply to:** every exported lib function.
- Explicit `Promise<XxxResult>` return type on async functions.
- `Promise<void>` for fire-and-forget.
- No `any`; coerce via explicit `as Type` + `?? fallback` (CONVENTIONS line 26).
- Type-only imports inline via `type` modifier (e.g., `import { foo, type Foo } from '...'`).

### Error handling — `[leanshot]` prefix + silent localStorage
**Source:** `src/lib/storage.ts:119`, `src/main.tsx:39-43`, `src/hooks/useTheme.ts:11-13`
**Apply to:** every `try`/`catch` block.
```ts
try {
  // ...storage / network
} catch (e) {
  console.error('[leanshot] phase-5-sync-failed', e);
  // OR: /* noop */ for non-essential localStorage
}
```
Typed errors thrown ONLY for branchable UI states (analog: `MissingAPIKeyError` in `src/lib/ai.ts:13`). Form-level errors flow through `toast` or `error` prop on `Input`.

### Toast pattern for non-field errors
**Source:** `src/hooks/useToast.ts` (used heavily in `OnboardingFlow.tsx:98`, `SettingsPage.tsx:78`)
**Apply to:** post-action confirmations and non-field errors.
```ts
const toast = useToast();
toast('Welcome! Check your email to verify your account.');
toast('Network unavailable', 'error');
```
Auto-dismiss 2400ms; `role="status" aria-live="polite"`.

### Zustand store subscriptions
**Source:** `src/components/dashboard/cards/HeroCard.tsx:18-22` (per-primitive selectors)
**Apply to:** every component subscribing to new `signedIn` / `pendingSyncIds` slices.
```ts
const session = useStore((s) => s.signedIn?.session);
const verified = useStore((s) => s.signedIn?.verified);
const pendingCount = useStore((s) => s.pendingSyncIds.length);
```
NEVER `useStore((s) => s)` (CONVENTIONS line 199).

### Accessibility
**Source:** `src/components/ui/Toast.tsx:22-23`, `src/components/ui/Modal.tsx:82-84`, `src/components/ui/Input.tsx:114`
**Apply to:** every new component.
- `role="dialog" aria-modal="true"` on AuthView container if rendered as modal-like (Modal.tsx:82-84) — but UI-SPEC §1 indicates full-page layout, so use `role="main"` + descriptive `aria-label`.
- `role="status" aria-live="polite"` on banner messages (Toast.tsx precedent).
- `aria-busy={loading}` on submitting buttons (Button.tsx:51).
- `aria-invalid={!!error}` on errored inputs (Input.tsx:114).
- `aria-label` required on icon-only buttons (CONVENTIONS line 142).
- `focus-visible:` ring on every interactive element (CONVENTIONS line 265).
- `prefers-reduced-motion` already handled via `useReducedMotion()` + `index.css` global; only gate RAF loops.

### Lazy-loading + Suspense
**Source:** `src/App.tsx:11-57` (lazy registration) + `App.tsx:121-131` (Suspense wrapper)
**Apply to:** `AuthView` registration in App.tsx (the auth view's bundle stays out of the cold dashboard path).

### Commit protocol
**Source:** Phase 4 commits (e.g., `feat(04-02):`, `test(04-02):`)
**Apply to:** every Phase 5 commit.
- `feat:` / `fix:` / `test:` / `docs:` prefix.
- One commit per task; RED→GREEN paired when TDD applies.
- No `--no-verify`.
- Reference: `.planning/codebase/CONVENTIONS.md` + CLAUDE.md "Commit protocol".

---

## Critical Gotchas (cross-cutting — planner enforces in every plan)

1. **`onAuthStateChange` `setTimeout(fn, 0)` guard** (RESEARCH §Pitfall 2 + §10 line 466). Mandatory — async-in-callback deadlocks supabase-js's internal lock.
2. **`signOut({scope: 'local'})` — NEVER plain `signOut()`** (RESEARCH §1 line 561). Default scope is `global` (signs out every device).
3. **`crypto.randomUUID()` for log_id back-stamp** (RESEARCH §7 line 927). Use during v6→v7 migration on every existing local injection without a `log_id`. Native API; no `uuid` package.
4. **`crypto.subtle.digest('SHA-256', ...)`** for storage namespace (RESEARCH §7 line 902). Returns ArrayBuffer; convert via `Uint8Array` + hex. Native; no `js-sha256`.
5. **`linkIdentity` is FORBIDDEN** (RESEARCH §Pitfall 1 + Phase 4 `04-RESEARCH.md Pitfall 5` + `.planning/decisions/supabase.md`). Use `updateUser({email})` then after confirm `updateUser({password})`.
6. **Realtime `postgres_changes` does NOT replay history** (RESEARCH §5 line 789). Always `pullInitialInjections` BEFORE `subscribeInjections`.
7. **`alter publication supabase_realtime add table public.injections`** required in the migration SQL — without this, Realtime broker won't fan out events.
8. **`moddatetime` trigger MUST exist** (RESEARCH §4 line 693). `create extension if not exists moddatetime schema extensions;` — standard Postgres contrib, ships with Supabase.
9. **`<StrictMode>` double-mount** (`src/main.tsx:50`). `onAuthStateChange` listener subscribes twice in dev — cleanup function MUST call `data.subscription.unsubscribe()`. Verify in unit test.
10. **`prefers-reduced-motion`** (CLAUDE.md). framer-motion respects via index.css already; only gate manual RAF loops.
11. **Default-deny RLS** (`20260512000000_ai_messages.sql:30` + RESEARCH §4 line 730). `alter table ... enable row level security` THEN create all 4 policies — if any policy is missing, that operation type silently returns 0 rows for non-service-role clients.
12. **REPLICA IDENTITY default is sufficient for Phase 5** (RESEARCH §5 line 791). Do NOT set `REPLICA IDENTITY FULL` — Phase 5's LWW only needs the new row's `updated_at`.
13. **Cross-tab signout is FREE via supabase-js storage event** (RESEARCH §8). Do not add BroadcastChannel; D-09 explicit defer.
14. **`acknowledgedDisclaimer` MUST survive signout** (RESEARCH §12 last paragraph). Add to D-11 preserved set alongside `theme, onboarded, tour_seen`.
15. **`config push` is destructive** (`.planning/decisions/supabase.md`). Diff first before applying password-policy + redirect-URL changes.

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `src/lib/sync.ts` | sync engine (event-driven + CRUD) | No existing Realtime/sync code; first time the codebase needs cross-device sync. Use RESEARCH §5 Pattern 2 (lines 367-449) as canonical reference. |

All other files have at least a role-match analog inside the codebase.

---

## Metadata

**Analog search scope:** `leanshot/src/`, `leanshot/e2e/`, `leanshot/supabase/migrations/` (read-only), `supabase/migrations/` (repo-root), `.github/workflows/`.
**Files scanned:** ~30 (App.tsx, main.tsx, store.ts, storage.ts, supabase.ts, ai.ts, ai.test.ts, supabase.test.ts, storage.test.ts, OnboardingFlow.tsx, Topbar.tsx, Sidebar.tsx, Landing.tsx, SettingsPage.tsx, Modal.tsx, Input.tsx, Confirm.tsx, types/index.ts, rls-ai-messages.test.ts, onboarding.spec.ts, ai_messages migration SQL, ci.yml, CONVENTIONS.md, CLAUDE.md, plus 05-CONTEXT/RESEARCH/UI-SPEC).
**Pattern extraction date:** 2026-05-11

## PATTERN MAPPING COMPLETE
