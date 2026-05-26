---
phase: 59-apple-oauth-sign-in-with-apple-onboarding-completion
reviewed: 2026-05-26T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - leanshot/src/lib/native/apple-sign-in.ts
  - leanshot/src/lib/auth.ts
  - leanshot/src/lib/onboarding/anon-merge.ts
  - leanshot/src/components/auth/AuthCallbackView.tsx
  - leanshot/src/components/auth/SignInForm.tsx
  - leanshot/src/components/auth/SignUpForm.tsx
  - leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx
  - leanshot/apps/ios/App/App/App.entitlements
  - leanshot/src/lib/native/apple-sign-in.test.ts
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: resolved
resolved: 2026-05-26T00:00:00Z
resolution: >
  ALL 6 fixed (commit 9d1c39b8). CR-01 (BLOCKER): OAuth nonce now forwarded — sha256(rawNonce) to
  Apple authorize(), raw nonce to signInWithIdToken; test asserts nonce present (closes token-replay).
  WR-01: confirmed genuine inversion via git log (admin flow dead since Phase 34) → removed early-return,
  PostHog variant now runs for all callers (D-16 config-mapping TODO'd — UUID→StepId not yet wired).
  WR-02: res.ok guard + console.warn. WR-03: getSession() via @/lib/auth wrapper. WR-04: authRedirectTo()
  guards window in PKCE path. IN-01: dropped 'email' from Apple scopes. Verified tsc 0, 44 targeted tests
  pass, locale PASS, full suite at flaky baseline.
---

# Phase 59: Code Review Report

**Reviewed:** 2026-05-26T00:00:00Z
**Depth:** deep (cross-file call-chain tracing)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 59 ships the native iOS Apple Sign-In bridge, the platform-fork in `auth.ts`,
the anon-session merge helper, the OAuth callback view, Apple button gating in the
sign-in/sign-up forms, and the `ConsumerOnboardingRenderer` feature-flag fix. The
overall structure is sound and several explicit security properties are correct:
the identityToken is passed server-side for GoTrue validation, no PII is trusted
from the Apple response, the anon-merge helper accepts only the caller's access
token (no userId param, no cross-user vector), the cookie is always cleared in
`finally`, and the Apple button never appears in promote/anon modes. The `App.entitlements`
file adds the `com.apple.developer.applesignin` capability cleanly without clobbering
existing entitlements.

One **blocker** was found: the nonce generated for the Apple `authorize()` call is
never forwarded to `signInWithIdToken`, meaning GoTrue cannot validate the nonce
claim in the Apple JWT. This creates a token-replay attack window.

Four **warnings** surface: a logic inversion in the `ConsumerOnboardingRenderer`
`useMemo` that silently discards admin-configured flow steps, a missing HTTP-status
check in `anon-merge.ts` that masks server errors, a raw `supabase.auth.getSession()`
call bypassing the project-mandated auth wrapper, and an unguarded `window.location`
access in the web PKCE path of `signInWithOAuthProvider`.

---

## Critical Issues

### CR-01: Nonce not forwarded to `signInWithIdToken` — GoTrue cannot verify nonce claim

**File:** `leanshot/src/lib/native/apple-sign-in.ts:37-57`

**Issue:** A fresh nonce is generated at line 42 and embedded in the Apple `authorize()`
request (Apple signs this nonce into the `identityToken` JWT). However, the same
nonce is never passed to `supabase.auth.signInWithIdToken`. GoTrue's Apple JWT
verification includes a nonce check: if the `nonce` field is absent from the
`signInWithIdToken` call, GoTrue will either skip nonce validation entirely or
reject the token depending on configuration. When nonce validation is skipped, any
valid Apple `identityToken` minted for this app (e.g., one captured from another
sign-in or replayed by a man-in-the-middle) can be submitted successfully to GoTrue.
This is a token-replay vulnerability.

The Supabase docs and the `@supabase/supabase-js` `SignInWithIdTokenCredentials` type
include a `nonce` field specifically for this: the raw nonce must be SHA-256-hashed
before embedding in the Apple request (Apple hashes the value before signing it into
the JWT), and the same **raw** nonce is passed to `signInWithIdToken` so GoTrue can
hash it and compare. The current code passes neither.

**Fix:** Hash the raw nonce before passing it to Apple (Apple applies its own SHA-256,
so the value Apple signs into the JWT is `SHA256(rawNonce)`). Then pass the raw nonce
to `signInWithIdToken` so GoTrue can recompute the hash and verify.

```typescript
// apple-sign-in.ts

async function sha256Hex(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signInWithAppleNative(): Promise<{ error: { message: string } | null }> {
  if (detectPlatform() !== 'ios') {
    return { error: { message: 'native_apple_ios_only' } };
  }

  try {
    const rawNonce = crypto.randomUUID();
    const hashedNonce = await sha256Hex(rawNonce);

    const result = await SignInWithApple.authorize({
      clientId: 'app.leanshot.ios',
      redirectURI: '',
      scopes: 'name',            // see IN-01 re: email scope
      state: crypto.randomUUID(),
      nonce: hashedNonce,        // Apple signs SHA256(rawNonce) into the JWT
    });

    const identityToken = result.response?.identityToken;
    if (!identityToken) {
      return { error: { message: 'apple_no_identity_token' } };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,           // GoTrue hashes this and compares to JWT claim
    });

    return { error: error ? { message: error.message } : null };
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : 'apple_native_failed';
    return { error: { message } };
  }
}
```

Note: the existing unit test at `apple-sign-in.test.ts:117` asserts
`signInWithIdToken` is called with `{ provider: 'apple', token: 'mock-identity-token' }`
— it will need to be updated to expect `{ provider: 'apple', token, nonce: rawNonce }`.
The test currently passes only because the mock does not validate the absence of the
nonce field, so the test was not a sufficient guard for this production security property.

---

## Warnings

### WR-01: `ConsumerOnboardingRenderer` discards admin flow config (logic inversion in `useMemo`)

**File:** `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx:136-151`

**Issue:** The comment at line 136 states "When flow.config is present it overrides
the local step logic (D-16 admin config)." But line 142 reads:

```typescript
if (flow?.config && flow.config.length > 0) return DEFAULT_STEPS;
```

This returns `DEFAULT_STEPS` **when** admin config is present — the exact opposite of
the documented intent. When `flow?.config` is populated by `useConsumerOnboardingFlow`
(from `onboarding_flows.config`), the renderer silently ignores it and falls through
to the PostHog A/B variant check. The D-16 admin override never fires.

This is a correctness bug, not a security issue, but it is a significant product
defect: any admin-configured onboarding step variant is permanently dead code.

**Fix:** Either map `flow.config` to step IDs and return them, or (if config-driven
rendering is deferred to a later phase) guard the branch so it does NOT return early:

```typescript
// Option A: if config-to-StepId mapping belongs in this phase
if (flow?.config && flow.config.length > 0) {
  return flow.config.map((node) => node.id as StepId).filter(Boolean);
}

// Option B: if D-16 config-driven rendering is a later phase, simply remove
// the early-return to let the PostHog variant logic run for all callers:
// (remove lines 142-143 entirely)
```

If Option B is chosen, add a TODO comment noting that the `flow?.config` branch is
intentionally a no-op until D-16 config-driven rendering is wired.

### WR-02: `anon-merge.ts` calls `res.json()` without checking `res.ok` — server errors silently become `{ merged: false }`

**File:** `leanshot/src/lib/onboarding/anon-merge.ts:76-91`

**Issue:** After `fetch(...)`, the code calls `await res.json()` at line 88 regardless
of the HTTP status. If the Edge Function returns a 400, 401, 429, or 500, the JSON
body is an error envelope — not the expected `{ merged, draft_entries }` shape. The
cast at line 88 coerces whatever body arrives to the success shape. If the error body
contains `{ merged: false }` it works silently. If the body is HTML (e.g., a Cloudflare
error page) or lacks `merged`, `res.json()` can throw and fall into the `catch` block.

In all cases the actual server error is swallowed. Merge failures on 401 (token
expired between session mint and merge call) or 429 (rate limit) are indistinguishable
from "no anon session to merge."

**Fix:**

```typescript
const res = await fetch(`${getSupabaseUrl()}/functions/v1/merge-anon-session`, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ ... }),
});

if (!res.ok) {
  console.warn('[mergeAnonSession] merge-anon-session returned', res.status);
  return { merged: false };
}

const json = (await res.json()) as { merged?: boolean; draft_entries?: unknown[] };
```

### WR-03: `ConsumerOnboardingRenderer` calls `supabase.auth.getSession()` directly, bypassing the project auth wrapper

**File:** `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx:202`

**Issue:** The merge-handshake `useEffect` at line 202 calls:

```typescript
const access = (await supabase.auth.getSession()).data.session?.access_token;
```

`CLAUDE.md` and `auth.ts` line 8 state: "UI components MUST import auth operations
from here — never call `supabase.auth.*` directly outside this module." The project
exports `getSession()` from `@/lib/auth` for exactly this purpose. Direct calls bypass
the centralized mock seam and any future session-enrichment logic added to the wrapper.

**Fix:**

```typescript
import { getSession } from '@/lib/auth';
// ...
const { session } = await getSession();
const access = session?.access_token;
```

### WR-04: Unguarded `window.location.origin` access in web PKCE path of `signInWithOAuthProvider`

**File:** `leanshot/src/lib/auth.ts:132`

**Issue:** The web PKCE branch of `signInWithOAuthProvider` (line 129-135) reads
`window.location.origin` without an SSR/non-browser guard. For the current browser-only
SPA this is latent — but `authRedirectTo()` (line 31) already demonstrates the
project's established pattern of guarding `window` access for this module:

```typescript
if (typeof window === 'undefined') return `https://leanshot-app.vercel.app${hash}`;
```

The web OAuth path is missing an equivalent guard. If `signInWithOAuthProvider` is
ever called from a test runner without a `window` mock, or from a future SSR context,
it will throw `ReferenceError: window is not defined` rather than returning an error
object (violating the module's "never throws" contract documented at line 7-9).

**Fix:**

```typescript
// Web PKCE path
const origin =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://leanshot-app.vercel.app';

const { error } = await supabase.auth.signInWithOAuth({
  provider,
  options: { redirectTo: `${origin}/auth/callback` },
});
```

---

## Info

### IN-01: `scopes: 'email name'` requests email from Apple despite email being deliberately unused

**File:** `leanshot/src/lib/native/apple-sign-in.ts:40`

**Issue:** The Apple `authorize()` call requests `scopes: 'email name'`. The file
comment at lines 8-11 correctly explains that the returned email is not read and
should not be trusted. However, requesting the `email` scope still causes Apple to
present the "Share My Email / Hide My Email" privacy prompt to the user on first
sign-in. This is confusing UX: the user is asked to make a privacy decision about
email sharing for an app that does not use their email at all in this flow. It also
means returning users who chose "Hide My Email" see Apple's relay address in their
Apple ID settings associated with LeanShot, which may cause confusion.

Since the email is neither read nor stored, removing `email` from the scope avoids
the prompt entirely without any functional impact.

**Fix:**

```typescript
scopes: 'name',   // email scope removed — not read, not stored; avoids relay-email UX prompt
```

If there is a future plan to display the user's first/last name, `name` in the scope
is still valuable. If name is also unused, `scopes: ''` (empty) is valid.

---

_Reviewed: 2026-05-26T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
