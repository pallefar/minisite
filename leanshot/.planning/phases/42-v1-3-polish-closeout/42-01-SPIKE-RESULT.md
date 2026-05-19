# 42-01 Spike Result — Web Push signing path decision

> **Status: ACCEPTED — Task 3 (browser-push end-to-end verify) SKIPPED by operator decision 2026-05-19.**
> **Decision (provisional, deploy-time only): `npm:web-push@3.6.7` primary path.** Evidence is Task 2 deploy success (128.7 kB bundle, no resolver errors, Fn ACTIVE). Runtime correctness (a real FCM/Mozilla push reaching a browser) is NOT proven here — that risk is deferred to the **first send in Wave 2 plan 42-05/42-08**.
>
> **Wave 2 hot-patch contingency:** If the first production push from `notification-send` throws (e.g. `npm:web-push` runtime-fails in Deno Edge, unknown until exercised), fall back to the `crypto.subtle` ECDSA P-256 path implemented in `supabase/functions/spike-web-push/index.ts` (the helpers `importVapidPrivateKey` + `signVapidJwt` + the `Authorization: vapid t=<jwt>, k=<pubKey>` POST pattern). Spike Fn left deployed for one Wave 2 cycle as the reference; decommission in plan 42-11.

## Task 2 outcome (auto-recorded)

**Deploy**: `npx supabase functions deploy spike-web-push --project-ref ytnsipxxmzgaebkqmokp` → `Deployed Functions on project ytnsipxxmzgaebkqmokp: spike-web-push`. Script size 128.7 kB (proves the `npm:web-push@3.6.7` specifier was resolved + bundled by Supabase's deploy pipeline). No bundler errors. CLI warned only about `import_map.json` fallback (not relevant — we use `npm:` specifier directly).

**Function listed**: `spike-web-push | ACTIVE | 1 | 2026-05-19 07:28:13` per `supabase functions list`.

**Naming deviation**: plan called the directory `_spike_web_push` (leading underscore). Supabase Edge Function names must match `^[A-Za-z][A-Za-z0-9_-]*$` (leading letter required) — deploy command rejected the underscore-prefixed name. **Renamed to `spike-web-push`** (Rule 3 auto-fix). All artifacts updated: `supabase/functions/spike-web-push/{index.ts,README.md}` + `[functions.spike-web-push] verify_jwt = false` in `supabase/config.toml`. Wave 2 (plan 42-08) does NOT inherit this naming constraint — its production Fn will use a real product name (e.g. `notify-web-push`).

**verify_jwt fix**: Plan didn't specify this, but per memory `reference_supabase_edge_function_deploy` the gateway 401s any external curl without a Supabase user JWT before the Fn runs. Added `[functions.spike-web-push] verify_jwt = false` to `supabase/config.toml` so Task 3 curl works end-to-end (Rule 2 — missing critical functionality).

## Implementation summary

The Fn implements BOTH signing paths in a try/catch fan-out:

1. **PRIMARY**: `import("npm:web-push@3.6.7")` → `webpush.setVapidDetails(subject, public, private)` → `webpush.sendNotification({endpoint, keys:{p256dh, auth}}, payload, {TTL: 60, urgency: 'normal'})`. Returns `{ ok: true, path: 'npm:web-push', status: <gateway>, body: <gateway-body> }`.
2. **FALLBACK** (always runs if primary throws): `crypto.subtle.importKey('jwk', {kty:'EC', crv:'P-256', d, x, y})` → `crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, signingInput)` → POST to endpoint with `Authorization: vapid t=<jwt>, k=<pubKey>` + `TTL: 60` + `Content-Length: 0`. Empty body (sufficient to prove VAPID auth; payload encryption is Wave 2's problem). Returns `{ ok: true, path: 'crypto.subtle-fallback', status: <gateway>, ... }`.

Both paths read `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` from Supabase Function Secrets.

## Working import recipe (preliminary — confirm in Task 3)

If Task 3 reports `path: "npm:web-push"` in the JSON response → Wave 2 plan 42-08 imports:

```ts
const mod = await import("npm:web-push@3.6.7");
const webpush = (mod as { default?: typeof mod }).default ?? mod;
// deno-lint-ignore no-explicit-any
const wp = webpush as any;
wp.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
await wp.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload), { TTL, urgency: 'normal' });
```

If Task 3 reports `path: "crypto.subtle-fallback"` → Wave 2 imports the helpers from `supabase/functions/spike-web-push/index.ts` (specifically `importVapidPrivateKey` + `signVapidJwt` + the `Authorization: vapid t=<jwt>, k=<pubkey>` POST pattern). Wave 2 will additionally need to implement AES-128-GCM payload encryption per RFC 8291 — the spike does NOT exercise payload encryption (sends an empty body).

## Sample successful send (filled by Task 3)

**SKIPPED 2026-05-19** per operator decision. Playwright MCP attempt to subscribe + curl was rejected; operator chose "accept Task 2 deploy as proof-of-concept" rather than run the verify in a real browser. No `path` field captured at runtime; `npm:web-push` is the working assumption based on bundler success alone.

**If Wave 2 first send fails**, run the deferred verify by:
1. Subscribe in real Chrome: paste the executor's DevTools snippet from the original Task 3 checkpoint (uses `VITE_VAPID_PUBLIC_KEY`).
2. `curl -X POST https://ytnsipxxmzgaebkqmokp.functions.supabase.co/spike-web-push -H 'Content-Type: application/json' -d '{"endpoint":"...","p256dh":"...","auth":"...","payload":"hello from 42-01"}'`
3. Record the JSON response's `path` field here; if `npm:web-push` → file Wave 2 bug as gateway / payload-encryption issue not signing-path issue. If `crypto.subtle-fallback` → patch `notification-send` Edge Fn to import the spike's helpers per the **Wave 2 hot-patch contingency** above.

## Caveats for Wave 2

- **Naming**: production Fn must NOT start with underscore. `notify-web-push` or similar.
- **verify_jwt**: production Fn invoked by app-internal cron / RPC SHOULD keep `verify_jwt = true` (default). Spike's `false` is the exception, not the rule.
- **Payload encryption**: spike skips this. Wave 2 must implement AES-128-GCM per RFC 8291 if it adopts the fallback signing path.
- **Subscription pubkey format**: subscription's `keys.p256dh` is base64url-encoded uncompressed P-256 point (same format as `VAPID_PUBLIC_KEY`).
- **VAPID JWT `aud`**: must be `<protocol>//<host>` of the push gateway (e.g. `https://fcm.googleapis.com`), NOT the full endpoint URL. `signVapidJwt` in the spike handles this with `new URL(endpoint)` decomposition.
- **JWT exp ≤ 24h**: RFC 8292 caps `exp` at 24h from now; spike uses 12h.
- **`crypto.subtle.sign` ECDSA output**: returns raw `r || s` (64 bytes for P-256) — JWS ES256 format. Do NOT DER-encode.
