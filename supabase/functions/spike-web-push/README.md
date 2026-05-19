# `spike-web-push` — Phase 42 Plan 42-01 disposable spike

> Note: plan-document text references `_spike_web_push` but Supabase Function
> names require a leading letter (`^[A-Za-z][A-Za-z0-9_-]*$`). Renamed to
> `spike-web-push` during Task 2 execution (deviation Rule 3 — blocking
> issue auto-fixed). All curl URLs + deploy commands below use the new name.

## What this is

A throwaway Supabase Edge Function that proves the VAPID ECDSA P-256 signing path
for Web Push works inside the Deno runtime, **before** Wave 2 (plan 42-08) commits
the production notification dispatcher to a specific signing library.

**Will be DELETED in Wave 4 (plan 42-11) phase cleanup.** Do NOT import from it.
Do NOT depend on it from production code paths.

## Resolves

RESEARCH §Open-Questions #2 — "Does `npm:web-push@3.6.7` work inside Deno Edge
Functions, or do we need a hand-rolled `crypto.subtle` ECDSA P-256 signer?"

## Architecture

The Fn implements BOTH signing paths and ALWAYS runs them in sequence per
invocation, so a single end-to-end test surfaces enough data for the decision:

1. **Primary**: dynamic `import("npm:web-push@3.6.7")` →
   `webpush.setVapidDetails(subject, public, private)` →
   `webpush.sendNotification({endpoint, keys:{p256dh, auth}}, payload, {TTL:60, urgency:'normal'})`.
2. **Fallback** (always runs if Primary throws): hand-rolled
   `crypto.subtle.importKey('jwk', {kty:'EC', crv:'P-256', d, x, y})` →
   `crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, signingInput)` →
   POST to the endpoint with `Authorization: vapid t=<jwt>, k=<publicKey>`.

The fallback path sends an EMPTY body (no AES-128-GCM payload encryption). That
suffices to prove the VAPID auth path — service workers still receive a `push`
event (with `event.data == null`) when the gateway accepts the signed request.
Wave 2 will add AES-128-GCM payload encryption per RFC 8291 if `npm:web-push`
turns out to be unusable.

## Contract

```
POST  https://ytnsipxxmzgaebkqmokp.functions.supabase.co/spike-web-push
Body: { "endpoint": <push-gateway-url>, "p256dh": <subscription-pubkey-b64u>, "auth": <subscription-auth-b64u>, "payload": <utf8-string-optional> }

200  { ok: true,  path: 'npm:web-push' | 'crypto.subtle-fallback', status: <push-gateway-status>, body: <gateway-response> }
500  { ok: false, path: 'both-failed', primary_error: ..., fallback_error: ... }
```

`verify_jwt = false` on `[functions.spike-web-push]` (declared in `supabase/config.toml`) so the
human-verify curl in Task 3 works without a Supabase user JWT.

## Secrets consumed

Set in Task 1 of plan 42-01 against project `ytnsipxxmzgaebkqmokp`:

- `VAPID_PRIVATE_KEY` — base64url raw scalar `d` (32 bytes)
- `VAPID_PUBLIC_KEY` — base64url uncompressed P-256 point (`0x04 || x || y`, 65 bytes)
- `VAPID_SUBJECT` — `mailto:karsten.haldan@gmail.com`

## Spike attempt + outcome (filled by Task 2 execution)

| Phase | Status | Notes |
|-------|--------|-------|
| `index.ts` authored | OK | Both paths implemented + try/catch fan-out. |
| Deno typecheck implicit (deploy-time) | TBD | Recorded in commit log if `supabase functions deploy` succeeds. |
| `supabase functions deploy _spike_web_push` | TBD — recorded in 42-01-SPIKE-RESULT.md after Task 2 deploy step. |
| `npm:web-push@3.6.7` import resolves at deploy bundler | TBD — Task 3 human-verify curl will surface this in the JSON response `path` field. |
| `crypto.subtle` fallback ECDSA P-256 sign | TBD — Task 3 also exercises this path if the primary throws. |
| Real browser push delivery | TBD — Task 3 service-worker `console.log("PUSH ...")` is the canonical evidence. |

The definitive decision (which signing path Wave 2 should adopt) is recorded in
`.planning/phases/42-v1-3-polish-closeout/42-01-SPIKE-RESULT.md` after Task 3.

## Deploy

```bash
# (no --linked — supabase CLI v2.100+ removed the flag; project link is read
#  automatically from supabase/.temp/linked-project.json)
npx supabase functions deploy spike-web-push --project-ref ytnsipxxmzgaebkqmokp
```

## Cleanup (Wave 4, plan 42-11)

```bash
npx supabase functions delete spike-web-push --project-ref ytnsipxxmzgaebkqmokp
rm -rf supabase/functions/spike-web-push
# Strip the [functions.spike-web-push] block from supabase/config.toml.
```
