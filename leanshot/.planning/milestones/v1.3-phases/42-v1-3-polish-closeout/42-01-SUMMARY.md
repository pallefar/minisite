---
phase: 42-v1-3-polish-closeout
plan: "01"
status: complete
completed: 2026-05-19
---

# Plan 42-01 Summary — VAPID Deno spike

## Result

Spike decision: **`npm:web-push@3.6.7` primary signing path** (deploy-time evidence; runtime verify deferred to Wave 2 first send). `crypto.subtle` ECDSA P-256 fallback also bundled in the same Fn as a hot-patch contingency.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | HUMAN — Generate VAPID keypair + set Function Secrets | ✅ Complete | (secret-store side effect) |
| 2 | Build disposable web-push spike Edge Function | ✅ Complete | `070ebb3` |
| 3 | HUMAN — Fire one push end-to-end and record decision | ⏭ Skipped (operator decision 2026-05-19) | `<this commit>` |

## Artifacts

- **Supabase Function Secrets** (project `ytnsipxxmzgaebkqmokp`): `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT='mailto:karsten.haldan@gmail.com'`
- **Vite client env**: `VITE_VAPID_PUBLIC_KEY` appended to `leanshot/.env.local` (gitignored)
- **Edge Function**: `supabase/functions/spike-web-push/{index.ts,README.md}` — 128.7 kB bundled, ACTIVE on Supabase
- **Config**: `supabase/config.toml` added `[functions.spike-web-push] verify_jwt = false`
- **Decision doc**: `.planning/phases/42-v1-3-polish-closeout/42-01-SPIKE-RESULT.md`

## Deviations from plan

1. **Naming**: plan called the Fn `_spike_web_push`; Supabase rejects leading underscore (`^[A-Za-z][A-Za-z0-9_-]*$`). Renamed to `spike-web-push`. Production Wave 2 Fn name is `notification-send` so this rename doesn't propagate.
2. **verify_jwt**: plan didn't mention this. Per [[supabase-edge-function-deploy]] memory the gateway 401s any unauthenticated curl; added `verify_jwt = false` to `supabase/config.toml` for the spike Fn only.
3. **Task 3 skipped**: operator opted to accept Task 2 deploy success as the spike decision rather than run the browser-push end-to-end verify. Runtime risk deferred to Wave 2 first send. See SPIKE-RESULT.md "Wave 2 hot-patch contingency".

## Hot-patch contingency for Wave 2

If `notification-send` Edge Fn throws on `npm:web-push.sendNotification(...)` at runtime (i.e. `npm:` resolver works at deploy-time but the imported module crashes at execution-time), patch plan 42-05 to import the `crypto.subtle` helpers from `supabase/functions/spike-web-push/index.ts`:
- `importVapidPrivateKey()` — JWK construction from the base64url private key
- `signVapidJwt()` — ECDSA P-256 SHA-256 JWS ES256 sign with proper `aud` decomposition
- POST pattern: `Authorization: vapid t=<jwt>, k=<pubKey>` + `TTL: 60` header

The spike Fn stays deployed through Wave 2. Plan 42-11 decommissions it.

## REQ-IDs

- `POLISH-05` (smart notifications + push) — partial (spike only; production path lands in Wave 2)

## Blocking unblocked

Wave 2 plan 42-05 (notification backend) is no longer spike-blocked. Can proceed in parallel with Wave 1.
